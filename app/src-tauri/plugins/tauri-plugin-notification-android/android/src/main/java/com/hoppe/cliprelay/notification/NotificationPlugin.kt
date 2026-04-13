package com.hoppe.cliprelay.notification

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class ShowReceivedArgs {
    lateinit var body: String
    lateinit var encryptedContent: String  // NIP-44 암호화된 content (복호화 전)
    lateinit var userPubkey: String        // Amber 복호화에 필요
}

@InvokeArg
class DismissArgs {
    var id: Int = 0
}

/**
 * 수신 클립보드 알림 플러그인.
 *
 * TS에서 릴레이 이벤트를 수신하면 (복호화하지 않고) 이 플러그인을 호출한다.
 * 알림을 탭하면 ClipboardActionActivity가 직접 Amber를 호출하여 복호화 → 클립보드 쓰기.
 * 앱(MainActivity)은 켜지지 않는다.
 */
@TauriPlugin
class NotificationPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        const val CHANNEL_ID = "clipboard_received"
        /** 수신 알림 ID 시작 범위 (Foreground Service가 1을 사용하므로 100부터) */
        private var nextNotificationId = 100
    }

    override fun load(webView: android.webkit.WebView) {
        super.load(webView)
        createNotificationChannel()
    }

    @Command
    fun showReceived(invoke: Invoke) {
        val args = invoke.parseArgs(ShowReceivedArgs::class.java)
        val notificationId = nextNotificationId++

        // 알림 탭 → ClipboardActionActivity (copy 액션)
        // 암호화된 content + userPubkey를 Intent에 전달 → Activity가 Amber에 직접 복호화 요청
        val tapIntent = Intent().apply {
            component = ComponentName(
                activity.packageName,
                "${activity.packageName}.ClipboardActionActivity"
            )
            putExtra("action", "copy")
            putExtra("encrypted_content", args.encryptedContent)
            putExtra("user_pubkey", args.userPubkey)
            putExtra("notification_id", notificationId)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val tapPendingIntent = PendingIntent.getActivity(
            activity, notificationId, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(activity, CHANNEL_ID)
            .setContentTitle("ClipRelay")
            .setContentText(args.body)
            .setSmallIcon(android.R.drawable.ic_menu_agenda)
            .setAutoCancel(true)
            .setContentIntent(tapPendingIntent)  // 알림 탭 자체가 트리거
            .build()

        val manager = activity.getSystemService(NotificationManager::class.java)
        manager.notify(notificationId, notification)

        val result = JSObject()
        result.put("id", notificationId)
        invoke.resolve(result)
    }

    @Command
    fun dismiss(invoke: Invoke) {
        val args = invoke.parseArgs(DismissArgs::class.java)
        val manager = activity.getSystemService(NotificationManager::class.java)
        manager.cancel(args.id)

        val result = JSObject()
        result.put("dismissed", true)
        invoke.resolve(result)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Clipboard Received",
                NotificationManager.IMPORTANCE_DEFAULT  // 소리 있음
            ).apply {
                description = "Notifications for received clipboard data"
            }
            val manager = activity.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
}
