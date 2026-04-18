/**
 * Android Foreground Service 래퍼
 *
 * WebView의 WebSocket 연결(SimplePool)을 백그라운드에서 유지하기 위해
 * Android Foreground Service를 시작/정지한다.
 * 데스크탑에서는 호출해도 아무 일도 일어나지 않는다.
 */
import { invoke, addPluginListener } from '@tauri-apps/api/core'
import { isAndroid } from './detect'

export async function startForegroundService(relays?: string[], userPubkey?: string): Promise<void> {
  if (!isAndroid()) return
  const args: Record<string, string> = {}
  if (relays && userPubkey) {
    args.relaysJson = JSON.stringify(relays)
    args.userPubkey = userPubkey
  }
  await invoke('plugin:foreground-service|start_service', args)
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
  receiverChannelIsHigh: boolean
}

/** 알림 권한, 배터리 최적화 예외, 수신 알림 채널 importance 상태를 반환한다. */
export async function getPermissionStatus(): Promise<PermissionStatus> {
  if (!isAndroid()) return { notificationGranted: true, batteryExempted: true, receiverChannelIsHigh: true }
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

/** 수신 알림 채널 설정 화면으로 이동한다. importance를 High로 올리도록 안내. */
export async function requestReceiverChannelHigh(): Promise<void> {
  if (!isAndroid()) return
  await invoke('plugin:foreground-service|request_receiver_channel_high')
}

// --- 네이티브 릴레이 구독 ---

export interface NativeEvent {
  id: string
  createdAt: number
  content: string
}

/** OkHttp 기반 네이티브 릴레이 구독 시작. WebView와 독립적으로 백그라운드에서 동작. */
export async function startNativeSubscription(relays: string[], userPubkey: string): Promise<void> {
  if (!isAndroid()) return
  await invoke('plugin:foreground-service|start_native_subscription', {
    relaysJson: JSON.stringify(relays),
    userPubkey,
  })
}

/** 네이티브 릴레이 구독 중지. */
export async function stopNativeSubscription(): Promise<void> {
  if (!isAndroid()) return
  await invoke('plugin:foreground-service|stop_native_subscription')
}

/** 네이티브 구독이 수신한 이벤트를 소비한다. 포그라운드 복귀 시 히스토리 동기화용. */
export async function consumeNativeEvents(): Promise<NativeEvent[]> {
  if (!isAndroid()) return []
  const result = await invoke<{ eventsJson: string }>('plugin:foreground-service|consume_native_events')
  return JSON.parse(result.eventsJson) as NativeEvent[]
}

/** 앱 포그라운드/백그라운드 상태를 네이티브에 알린다. 백그라운드일 때만 수신 알림 표시. */
export async function setAppForeground(foreground: boolean): Promise<void> {
  if (!isAndroid()) return
  await invoke('plugin:foreground-service|set_app_foreground', { foreground })
}

/**
 * 네트워크 상태 변경 리스너를 등록한다.
 * Android의 ConnectivityManager.NetworkCallback이 감지한 네트워크 전환을
 * WebView에 전달하여 WebSocket 즉시 재연결을 트리거한다.
 */
export async function onNetworkChanged(callback: (type: 'available' | 'lost') => void): Promise<() => void> {
  if (!isAndroid()) return () => {}
  const listener = await addPluginListener<{ type: 'available' | 'lost' }>(
    'foreground-service',
    'network-changed',
    (payload) => callback(payload.type),
  )
  return () => { void listener.unregister() }
}
