package com.hoppe.cliprelay

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.hoppe.cliprelay.foreground.ClipboardSyncService

/**
 * 부팅 완료 / 앱 업데이트 시 Foreground Service를 자동 시작한다.
 *
 * AlarmManager.RTC_WAKEUP을 사용하여 기기가 딥슬립 상태에서도
 * 서비스 시작을 보장한다 (Amber 앱 패턴 참조).
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
        private const val ALARM_REQUEST_CODE = 10
    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                Log.d(TAG, "Received: ${intent.action}")
                try {
                    val serviceIntent = Intent(context, ClipboardSyncService::class.java)
                    val operation = PendingIntent.getForegroundService(
                        context,
                        ALARM_REQUEST_CODE,
                        serviceIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    )
                    val alarmManager = context.getSystemService(AlarmManager::class.java)
                    alarmManager.set(
                        AlarmManager.RTC_WAKEUP,
                        System.currentTimeMillis() + 1000,
                        operation,
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to schedule service on boot: ${e.javaClass.simpleName}")
                }
            }
        }
    }
}
