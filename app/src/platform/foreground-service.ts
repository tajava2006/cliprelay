/**
 * Android Foreground Service 래퍼
 *
 * WebView의 WebSocket 연결(SimplePool)을 백그라운드에서 유지하기 위해
 * Android Foreground Service를 시작/정지한다.
 * 데스크탑에서는 호출해도 아무 일도 일어나지 않는다.
 */
import { invoke } from '@tauri-apps/api/core'
import { isAndroid } from './detect'

export async function startForegroundService(): Promise<void> {
  if (!isAndroid()) return
  await invoke('plugin:foreground-service|start_service')
}

export async function stopForegroundService(): Promise<void> {
  if (!isAndroid()) return
  await invoke('plugin:foreground-service|stop_service')
}

export async function isForegroundServiceRunning(): Promise<boolean> {
  if (!isAndroid()) return false
  const result = await invoke<{ running: boolean }>('plugin:foreground-service|is_running')
  return result.running
}

export interface PermissionStatus {
  notificationGranted: boolean
  batteryExempted: boolean
}

/** 알림 권한 및 배터리 최적화 예외 여부를 반환한다. */
export async function getPermissionStatus(): Promise<PermissionStatus> {
  if (!isAndroid()) return { notificationGranted: true, batteryExempted: true }
  return await invoke<PermissionStatus>('plugin:foreground-service|get_permission_status')
}

/** 알림 권한 시스템 다이얼로그를 요청한다 (Android 13+). */
export async function requestNotificationPermission(): Promise<void> {
  if (!isAndroid()) return
  await invoke('plugin:foreground-service|request_notification_permission')
}

/**
 * 설명 다이얼로그를 보여준 뒤 배터리 최적화 예외 설정창으로 이동한다.
 * 이미 예외 상태이면 아무 일도 하지 않는다.
 */
export async function requestBatteryExemption(): Promise<void> {
  if (!isAndroid()) return
  await invoke('plugin:foreground-service|request_battery_exemption')
}
