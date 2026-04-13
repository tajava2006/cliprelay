/**
 * Android 수신 알림 래퍼
 *
 * 릴레이에서 클립보드 이벤트를 수신하면 (복호화하지 않고)
 * 암호화된 content를 알림 Intent에 전달한다.
 * 알림 탭 → ClipboardActionActivity → Amber 직접 복호화 → 클립보드 쓰기.
 * 데스크탑에서는 호출해도 아무 일도 일어나지 않는다.
 */
import { invoke } from '@tauri-apps/api/core'
import { isAndroid } from './detect'

/**
 * 수신 클립보드 알림 표시.
 * @param body 알림 본문 텍스트 (i18n된 안내 문구)
 * @param encryptedContent NIP-44 암호화된 event.content
 * @param userPubkey Amber 복호화에 필요한 사용자 공개키
 * @returns 알림 ID (dismiss 시 사용)
 */
export async function showReceivedNotification(
  body: string,
  encryptedContent: string,
  userPubkey: string,
): Promise<number> {
  if (!isAndroid()) return -1
  const result = await invoke<{ id: number }>(
    'plugin:notification-android|show_received',
    { body, encryptedContent, userPubkey },
  )
  return result.id
}

/**
 * 알림 제거.
 */
export async function dismissNotification(id: number): Promise<void> {
  if (!isAndroid()) return
  await invoke('plugin:notification-android|dismiss', { id })
}
