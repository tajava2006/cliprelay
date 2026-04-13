package com.hoppe.cliprelay.foreground

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class ForegroundServicePlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        private const val REQUEST_NOTIFICATION_PERMISSION_CODE = 2001
    }

    @Command
    fun startService(invoke: Invoke) {
        requestBatteryOptimizationExemption()

        val intent = Intent(activity, ClipboardSyncService::class.java)
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
}
