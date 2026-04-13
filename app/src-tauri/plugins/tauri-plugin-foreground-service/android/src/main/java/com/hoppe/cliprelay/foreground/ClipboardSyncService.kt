package com.hoppe.cliprelay.foreground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground Service — WebView의 WebSocket 연결을 백그라운드에서 유지한다.
 *
 * 상시 알림을 스와이프해서 지우면 = 앱 종료.
 * 앱이 포그라운드로 올라올 때 JS 측에서 startService()를 다시 호출해 알림을 복원한다.
 *
 * START_STICKY: OS가 서비스를 kill해도 자동 재시작 (사용자가 명시적으로 끄기 전까지).
 */
class ClipboardSyncService : Service() {

    companion object {
        const val CHANNEL_ID = "clipboard_sync_v2"
        const val NOTIFICATION_ID = 1
        /** 알림 스와이프 dismiss 시 deleteIntent로 전달되는 액션 */
        const val ACTION_DISMISS = "com.hoppe.cliprelay.ACTION_DISMISS"
        var isRunning = false
            private set
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 알림 스와이프 dismiss → 서비스 + 앱 프로세스 완전 종료
        if (intent?.action == ACTION_DISMISS) {
            isRunning = false
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
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

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
