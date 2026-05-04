/**
 * Android 전용 라이프사이클 훅
 *
 * App.tsx의 visibility change 핸들러에서 호출되는 Android 분기 로직을 모은다.
 * Foreground Service / 네이티브 구독 재시작, 백그라운드에서 수신한 이벤트의
 * 히스토리 동기화, 그리고 포그라운드 복귀 시 클립보드 변경 감지·발행 루프.
 */
import { invoke } from '@tauri-apps/api/core'
import { isAndroid } from '../detect'
import { getSigner } from '../signer'
import { startForegroundService, startNativeSubscription, consumeNativeEvents } from './foreground-service'
import { readClipboardImage } from './clipboard-action'
import { publishClipboard } from '../../nostr/publish'
import { uploadImage } from '../../blossom/upload'
import { appendHistory, hasHistoryId } from '../../store/history-store'
import { fingerprintPng } from '../../clipboard/fingerprint'
import type { ClipboardPayload } from '@cliprelay/shared'
import type { SyncEngine } from '../../clipboard/sync'

/**
 * 포그라운드 복귀 시 Android 전용 처리.
 *
 * 1. 상시 알림 강제 복원 + 네이티브 구독 재시작 (스와이프로 사라졌을 수 있으므로)
 * 2. 백그라운드 동안 네이티브가 수신한 이벤트를 히스토리에 동기화
 * 3. 포그라운드 진입 시 클립보드를 읽어 변경된 내용이 있으면 발행
 *    (Amber 흐름 중 visibilitychange가 반복 발생하므로 isPublishing 플래그로 가드)
 */
export async function androidOnForeground(userPubkey: string, sync: SyncEngine): Promise<void> {
  if (!isAndroid()) return

  const writeRelays = sync.getWriteRelays()
  const blossomServers = sync.getBlossomServers()

  void startForegroundService().catch(err => console.warn('[foreground-service] restart failed:', err))
  void startNativeSubscription(writeRelays, userPubkey).catch(err => console.warn('[native-sub] restart failed:', err))

  void consumeNativeEvents().then(async (events) => {
    if (events.length === 0) return
    console.log(`[app] consuming ${events.length} native event(s) for history`)
    for (const evt of events) {
      try {
        if (await hasHistoryId(evt.id)) continue
        const plaintext = await getSigner().nip44Decrypt(userPubkey, evt.content)
        const payload = JSON.parse(plaintext) as ClipboardPayload
        await appendHistory({ id: evt.id, createdAt: evt.createdAt, payload })
      } catch (err) {
        console.warn('[app] native event history sync failed:', err)
      }
    }
  }).catch(err => console.warn('[app] consumeNativeEvents failed:', err))

  if (sync.getIsPublishing()) return

  sync.setIsPublishing(true)
  try {
    let published = false
    try {
      const img = await readClipboardImage()
      if (img.hasImage && img.base64) {
        const binary = atob(img.base64)
        const pngBytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) pngBytes[i] = binary.charCodeAt(i)
        const fp = fingerprintPng(pngBytes)
        if (fp !== sync.getLastSyncedImageFp()) {
          sync.setLastSyncedImageFp(fp)
          if (blossomServers.length > 0) {
            console.log('[sync] clipboard image changed, publishing…')
            const payload = await uploadImage(pngBytes, blossomServers)
            await publishClipboard(payload, writeRelays)
          }
        }
        published = true
      }
    } catch { /* image read failed, fall through to text */ }

    if (!published) {
      try {
        const { text } = await invoke<{ text: string }>('plugin:clipboard-action|read_clipboard_text')
        if (text && text !== sync.getLastSyncedText()) {
          sync.setLastSyncedText(text)
          console.log('[sync] clipboard changed, publishing…')
          await publishClipboard(
            { type: 'text', content: text },
            writeRelays,
          ).catch(err => console.error('[sync] publish failed:', err))
        }
      } catch { /* ignore */ }
    }
  } finally {
    sync.setIsPublishing(false)
  }
}
