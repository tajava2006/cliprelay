package com.hoppe.cliprelay.foreground

import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.os.Bundle
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject

@InvokeArg
class StartNativeSubArgs {
    lateinit var relaysJson: String
    lateinit var userPubkey: String
}

@InvokeArg
class SetAppForegroundArgs {
    var foreground: Boolean = true
}

@TauriPlugin
class ForegroundServicePlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        private const val TAG = "ForegroundServicePlugin"
        private const val REQUEST_NOTIFICATION_PERMISSION_CODE = 2001
    }

    private var networkCallbackRegistered = false

    /**
     * WebView keepalive — 백그라운드에서 JS 엔진이 서스펜드되는 것을 방지한다.
     * 네이티브 Handler로 ~25초마다 evaluateJavascript()를 호출해
     * Android가 WebView의 JS 타이머/WebSocket을 throttle하지 못하게 한다.
     */
    private var webViewRef: WebView? = null
    private val keepaliveHandler = Handler(Looper.getMainLooper())
    private val keepaliveRunnable = object : Runnable {
        override fun run() {
            webViewRef?.evaluateJavascript("1", null)
            keepaliveHandler.postDelayed(this, 25_000L)
        }
    }

    /**
     * 네트워크 상태 변경을 감지하여 WebView에 이벤트를 전달한다.
     * WiFi↔모바일 전환, 네트워크 복구 시 WebSocket 재연결을 즉시 트리거한다.
     */
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        private var lastNetwork: Network? = null

        override fun onAvailable(network: Network) {
            if (lastNetwork != null && lastNetwork != network) {
                Log.d(TAG, "Network changed — notifying WebView")
                val payload = JSObject()
                payload.put("type", "available")
                trigger("network-changed", payload)
            }
            lastNetwork = network
        }

        override fun onLost(network: Network) {
            lastNetwork = null
            Log.d(TAG, "Network lost — notifying WebView")
            val payload = JSObject()
            payload.put("type", "lost")
            trigger("network-changed", payload)
        }
    }

    override fun load(webView: WebView) {
        super.load(webView)
        registerNetworkCallback()
        registerLifecycleCallbacks()
        webViewRef = webView
        keepaliveHandler.removeCallbacks(keepaliveRunnable)
        keepaliveHandler.postDelayed(keepaliveRunnable, 25_000L)
        Log.d(TAG, "WebView keepalive timer started (25s interval)")
    }

    /**
     * Activity 라이프사이클로 포그라운드/백그라운드를 네이티브에서 직접 감지한다.
     * JS visibilitychange → IPC 경로는 WebView throttle 시 실패할 수 있으므로
     * 이쪽이 훨씬 신뢰성이 높다.
     */
    private var lifecycleRegistered = false
    private fun registerLifecycleCallbacks() {
        if (lifecycleRegistered) return
        activity.application.registerActivityLifecycleCallbacks(
            object : Application.ActivityLifecycleCallbacks {
                override fun onActivityResumed(a: Activity) {
                    ClipboardSyncService.appInForeground = true
                    Log.d(TAG, "App resumed — suppressing native notifications")
                }
                override fun onActivityPaused(a: Activity) {
                    ClipboardSyncService.appInForeground = false
                    Log.d(TAG, "App paused — enabling native notifications")
                }
                override fun onActivityCreated(a: Activity, s: Bundle?) {}
                override fun onActivityStarted(a: Activity) {}
                override fun onActivityStopped(a: Activity) {}
                override fun onActivitySaveInstanceState(a: Activity, s: Bundle) {}
                override fun onActivityDestroyed(a: Activity) {}
            }
        )
        lifecycleRegistered = true
        Log.d(TAG, "ActivityLifecycleCallbacks registered")
    }

    private fun registerNetworkCallback() {
        if (networkCallbackRegistered) return
        try {
            val cm = activity.getSystemService(ConnectivityManager::class.java)
            cm.registerDefaultNetworkCallback(networkCallback)
            networkCallbackRegistered = true
            Log.d(TAG, "NetworkCallback registered")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register NetworkCallback: ${e.javaClass.simpleName}")
        }
    }

    @Command
    fun startService(invoke: Invoke) {
        requestBatteryOptimizationExemption()

        val intent = Intent(activity, ClipboardSyncService::class.java)

        // Optional: relay/pubkey 데이터가 있으면 Intent extras로 전달
        // → ClipboardSyncService.onStartCommand에서 네이티브 구독 시작
        try {
            val args = invoke.parseArgs(StartNativeSubArgs::class.java)
            if (args.relaysJson.isNotEmpty() && args.userPubkey.isNotEmpty()) {
                intent.putExtra("relaysJson", args.relaysJson)
                intent.putExtra("userPubkey", args.userPubkey)
                Log.d(TAG, "startService with native sub: pubkey=${args.userPubkey.take(8)}")
            }
        } catch (_: Exception) {
            // relay/pubkey 없이 호출 — 순수 포그라운드 서비스만 시작
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startForegroundService(intent)
        } else {
            activity.startService(intent)
        }
        val result = JSObject()
        result.put("started", true)
        invoke.resolve(result)
    }

    /**
     * 배터리 최적화 예외를 요청한다.
     * 이미 예외 상태면 아무 일도 하지 않는다.
     * 예외가 아닌 경우 설명 다이얼로그를 먼저 보여준 뒤 설정창으로 이동한다.
     */
    private fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val pm = activity.getSystemService(PowerManager::class.java)
        if (pm.isIgnoringBatteryOptimizations(activity.packageName)) return

        activity.runOnUiThread {
            AlertDialog.Builder(activity)
                .setTitle("Background execution required")
                .setMessage(
                    "To keep the clipboard subscription running without interruption, " +
                    "battery optimization must be disabled for this app.\n\n" +
                    "Please select 'Allow' on the next screen."
                )
                .setPositiveButton("Go to settings") { _, _ ->
                    val intent = Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
                    ).apply {
                        data = Uri.parse("package:${activity.packageName}")
                    }
                    activity.startActivity(intent)
                }
                .setNegativeButton("Later", null)
                .show()
        }
    }

    @Command
    fun stopService(invoke: Invoke) {
        val intent = Intent(activity, ClipboardSyncService::class.java)
        activity.stopService(intent)
        val result = JSObject()
        result.put("stopped", true)
        invoke.resolve(result)
    }

    @Command
    fun isRunning(invoke: Invoke) {
        val result = JSObject()
        result.put("running", ClipboardSyncService.isRunning)
        invoke.resolve(result)
    }

    /** 알림 권한 및 배터리 최적화 예외 상태를 반환한다. */
    @Command
    fun getPermissionStatus(invoke: Invoke) {
        val notificationGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            true // Android 12 이하는 런타임 알림 권한 불필요
        }

        val batteryExempted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = activity.getSystemService(PowerManager::class.java)
            pm.isIgnoringBatteryOptimizations(activity.packageName)
        } else {
            true
        }

        val result = JSObject()
        result.put("notificationGranted", notificationGranted)
        result.put("batteryExempted", batteryExempted)
        invoke.resolve(result)
    }

    /** 알림 권한 시스템 다이얼로그를 요청한다 (Android 13+). */
    @Command
    fun requestNotificationPermission(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                REQUEST_NOTIFICATION_PERMISSION_CODE
            )
        }
        invoke.resolve(JSObject())
    }

    /**
     * 설명 다이얼로그를 보여준 뒤 배터리 최적화 예외 설정창으로 이동한다.
     * 이미 예외 상태이면 아무 일도 하지 않는다.
     */
    @Command
    fun requestBatteryExemption(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = activity.getSystemService(PowerManager::class.java)
            if (!pm.isIgnoringBatteryOptimizations(activity.packageName)) {
                activity.runOnUiThread {
                    AlertDialog.Builder(activity)
                        .setTitle("Background execution required")
                        .setMessage(
                            "To keep the clipboard subscription running without interruption, " +
                            "battery optimization must be disabled for this app.\n\n" +
                            "Please select 'Allow' on the next screen."
                        )
                        .setPositiveButton("Go to settings") { _, _ ->
                            val intent = Intent(
                                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
                            ).apply {
                                data = Uri.parse("package:${activity.packageName}")
                            }
                            startActivityForResult(invoke, intent, "onBatteryExemptionResult")
                        }
                        .setNegativeButton("Later") { _, _ ->
                            invoke.resolve(JSObject())
                        }
                        .setCancelable(false)
                        .show()
                }
                return
            }
        }
        invoke.resolve(JSObject())
    }

    @ActivityCallback
    fun onBatteryExemptionResult(invoke: Invoke, result: ActivityResult) {
        invoke.resolve(JSObject())
    }

    // --- 네이티브 릴레이 구독 커맨드 ---

    /** OkHttp 기반 네이티브 릴레이 구독을 시작한다. WebView 독립적으로 동작. */
    @Command
    fun startNativeSubscription(invoke: Invoke) {
        Log.d(TAG, ">>> startNativeSubscription command invoked")
        try {
            val args = invoke.parseArgs(StartNativeSubArgs::class.java)
            Log.d(TAG, "Args parsed OK: pubkey=${args.userPubkey.take(8)}")
            val relaysArray = JSONArray(args.relaysJson)
            val relays = (0 until relaysArray.length()).map { relaysArray.getString(it) }
            ClipboardSyncService.startNativeSubscription(activity, relays, args.userPubkey)
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            Log.e(TAG, "startNativeSubscription FAILED: ${e.javaClass.simpleName}: ${e.message}")
            invoke.reject("startNativeSubscription failed: ${e.message}")
        }
    }

    /** 네이티브 릴레이 구독을 중지한다. */
    @Command
    fun stopNativeSubscription(invoke: Invoke) {
        ClipboardSyncService.stopNativeSubscription()
        invoke.resolve(JSObject())
    }

    /** 네이티브 구독이 수신한 이벤트를 소비한다. 큐가 비워진다. */
    @Command
    fun consumeNativeEvents(invoke: Invoke) {
        val events = mutableListOf<NativeRelayClient.NostrEvent>()
        while (true) {
            val e = ClipboardSyncService.eventQueue.poll() ?: break
            events.add(e)
        }

        val arr = JSONArray()
        for (event in events) {
            arr.put(JSONObject().apply {
                put("id", event.id)
                put("createdAt", event.createdAt)
                put("content", event.content)
            })
        }
        val result = JSObject()
        result.put("eventsJson", arr.toString())
        invoke.resolve(result)
    }

    /** WebView가 포그라운드인지 설정. 백그라운드일 때만 수신 알림 표시. */
    @Command
    fun setAppForeground(invoke: Invoke) {
        val args = invoke.parseArgs(SetAppForegroundArgs::class.java)
        ClipboardSyncService.appInForeground = args.foreground
        invoke.resolve(JSObject())
    }
}
