package com.hoppe.cliprelay.foreground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.concurrent.ConcurrentLinkedQueue
import org.json.JSONArray

/**
 * Foreground Service — WebView의 WebSocket 연결을 백그라운드에서 유지한다.
 *
 * 프로세스 유지뿐만 아니라 CPU/WiFi가 잠들지 않도록 Wake Lock을 잡아
 * WebView의 JS 실행이 throttle되는 것을 방지한다.
 *
 * 상시 알림을 스와이프해서 지우면 = 앱 종료.
 * 앱이 포그라운드로 올라올 때 JS 측에서 startService()를 다시 호출해 알림을 복원한다.
 *
 * START_STICKY: OS가 서비스를 kill해도 자동 재시작 (사용자가 명시적으로 끄기 전까지).
 */
class ClipboardSyncService : Service() {

    companion object {
        private const val TAG = "ClipboardSyncService"
        const val CHANNEL_ID = "clipboard_sync_v2"
        const val NOTIFICATION_ID = 1
        /** 알림 스와이프 dismiss 시 deleteIntent로 전달되는 액션 */
        const val ACTION_DISMISS = "com.hoppe.cliprelay.ACTION_DISMISS"
        var isRunning = false
            private set

        // --- 네이티브 릴레이 구독 ---
        const val RECEIVED_CHANNEL_ID = "clipboard_received"
        val eventQueue = ConcurrentLinkedQueue<NativeRelayClient.NostrEvent>()
        @Volatile var appInForeground = true
        private var relayClient: NativeRelayClient? = null
        private var appContext: Context? = null
        private var nextNativeNotificationId = 200

        /**
         * 네이티브 OkHttp 릴레이 구독 시작.
         * @param context Activity 또는 Application context — 알림 생성에 사용
         */
        fun startNativeSubscription(context: Context, relays: List<String>, userPubkey: String) {
            stopNativeSubscription()
            appContext = context.applicationContext
            ensureReceivedChannel(appContext!!)
            val since = System.currentTimeMillis() / 1000
            relayClient = NativeRelayClient(relays, userPubkey, since) { event ->
                eventQueue.add(event)
                Log.d(TAG, "Native event queued: ${event.id.take(8)}, appInForeground=$appInForeground")
                if (!appInForeground) {
                    showReceivedNotification(appContext!!, event, userPubkey)
                }
            }
            relayClient?.start()
            Log.d(TAG, "Native subscription started: ${relays.size} relay(s)")
        }

        fun stopNativeSubscription() {
            relayClient?.stop()
            relayClient = null
        }

        /** 수신 알림 표시. Application context 사용 — serviceInstance 불필요. */
        private fun showReceivedNotification(context: Context, event: NativeRelayClient.NostrEvent, userPubkey: String) {
            try {
                val notificationId = nextNativeNotificationId++
                val tapIntent = Intent().apply {
                    component = ComponentName(context.packageName, "${context.packageName}.ClipboardActionActivity")
                    putExtra("action", "copy")
                    putExtra("encrypted_content", event.content)
                    putExtra("user_pubkey", userPubkey)
                    putExtra("notification_id", notificationId)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }
                val tapPendingIntent = PendingIntent.getActivity(
                    context, notificationId, tapIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                val notification = NotificationCompat.Builder(context, RECEIVED_CHANNEL_ID)
                    .setContentTitle("ClipRelay")
                    .setContentText("Tap to copy received clipboard")
                    .setSmallIcon(android.R.drawable.ic_menu_agenda)
                    .setAutoCancel(true)
                    .setContentIntent(tapPendingIntent)
                    .build()
                val manager = context.getSystemService(NotificationManager::class.java)
                manager.notify(notificationId, notification)
                Log.d(TAG, "Notification shown: ${event.id.take(8)}, id=$notificationId")
            } catch (e: Exception) {
                Log.e(TAG, "showReceivedNotification failed: ${e.message}")
            }
        }

        private fun ensureReceivedChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    RECEIVED_CHANNEL_ID,
                    "Clipboard Received",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply { description = "Notifications for received clipboard data" }
                context.getSystemService(NotificationManager::class.java)
                    .createNotificationChannel(channel)
            }
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        acquireWakeLocks()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 알림 스와이프 dismiss → 서비스 + 앱 프로세스 완전 종료
        if (intent?.action == ACTION_DISMISS) {
            isRunning = false
            stopNativeSubscription()
            releaseWakeLocks()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
            stopSelf()
            android.os.Process.killProcess(android.os.Process.myPid())
            return START_NOT_STICKY
        }

        val notification = buildNotification()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        isRunning = true

        // Intent extras로 relay/pubkey가 전달되면 네이티브 구독 시작
        val relaysJson = intent?.getStringExtra("relaysJson")
        val userPubkey = intent?.getStringExtra("userPubkey")
        if (relaysJson != null && userPubkey != null) {
            try {
                val arr = JSONArray(relaysJson)
                val relays = (0 until arr.length()).map { arr.getString(it) }
                Log.d(TAG, "Starting native subscription from Intent: ${relays.size} relay(s), pubkey=${userPubkey.take(8)}")
                startNativeSubscription(this, relays, userPubkey)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start native subscription from Intent: ${e.message}")
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        stopNativeSubscription()
        releaseWakeLocks()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /**
     * PARTIAL_WAKE_LOCK: 화면이 꺼져도 CPU가 잠들지 않게 한다.
     * 이것이 없으면 Android가 WebView의 JS 타이머/WebSocket을 throttle하여
     * 릴레이 연결이 끊긴다.
     *
     * WiFi Lock: WiFi가 절전 모드로 전환되지 않게 한다.
     * Doze 모드에서 WiFi가 꺼지면 WebSocket이 끊기므로 필수.
     */
    private fun acquireWakeLocks() {
        try {
            val pm = getSystemService(PowerManager::class.java)
            wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "ClipRelay::SyncWakeLock"
            ).apply {
                acquire()
            }
            Log.d(TAG, "WakeLock acquired")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to acquire WakeLock: ${e.javaClass.simpleName}")
        }

        try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            @Suppress("DEPRECATION")
            wifiLock = wm.createWifiLock(
                WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                "ClipRelay::SyncWifiLock"
            ).apply {
                acquire()
            }
            Log.d(TAG, "WifiLock acquired")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to acquire WifiLock: ${e.javaClass.simpleName}")
        }
    }

    private fun releaseWakeLocks() {
        wakeLock?.let {
            if (it.isHeld) it.release()
            wakeLock = null
            Log.d(TAG, "WakeLock released")
        }
        wifiLock?.let {
            if (it.isHeld) it.release()
            wifiLock = null
            Log.d(TAG, "WifiLock released")
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Clipboard Sync",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Keeps clipboard sync running in the background"
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        // 알림 탭 → 앱 열기
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 스와이프 dismiss → ACTION_DISMISS → 서비스 + 앱 종료
        val dismissIntent = Intent(this, ClipboardSyncService::class.java).apply {
            action = ACTION_DISMISS
        }
        val dismissPendingIntent = PendingIntent.getService(
            this, 2, dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ClipRelay")
            .setContentText("Clipboard sync running — swipe to stop")
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            // setOngoing(true) 제거: 스와이프로 종료할 수 있어야 함
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(pendingIntent)
            .setDeleteIntent(dismissPendingIntent)
            .build()
    }
}
