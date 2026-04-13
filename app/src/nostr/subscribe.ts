/**
 * kind:9372 클립보드 이벤트 구독
 *
 * write 릴레이 전체를 구독해 자신이 발행한 클립보드 이벤트를 수신한다.
 * 다른 기기에서 복사한 내용이 이쪽 릴레이로 도착하면:
 *
 * 데스크탑: 복호화 → 클립보드 자동 쓰기 + 히스토리 저장
 * Android: 알림 표시 (복호화하지 않음) → 알림 탭 → 투명 Activity가 Amber로 복호화 → 클립보드 쓰기
 *
 * since: 구독 시작 시각 (재시작 이전 이벤트 재수신 방지)
 */
import { CLIPBOARD_KIND, CLIENT_TAG } from '@cliprelay/shared'
import { getSharedPool } from './pool'
import type { ClipboardPayload } from '@cliprelay/shared'
import { Image } from '@tauri-apps/api/image'
import { getSigner } from '../platform/signer'
import { writeClipboardText, writeClipboardImage } from '../clipboard/writer'
import { toast } from '../toast'
import { t } from '../i18n'
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { downloadAndDecrypt } from '../blossom/download'
import { appendHistory } from '../store/history-store'
import { isAndroid } from '../platform/detect'
import { showReceivedNotification } from '../platform/notification-android'

async function notifyClipboardUpdated(detail: string): Promise<void> {
  try {
    let granted = await isPermissionGranted()
    if (!granted) granted = (await requestPermission()) === 'granted'
    if (granted) sendNotification({ title: 'ClipRelay', body: detail })
  } catch { /* fire-and-forget */ }
}

/** monitor.ts와 동일한 핑거프린트 형식 */
function headHex(bytes: Uint8Array, n: number): string {
  return Array.from(bytes.subarray(0, n), b => b.toString(16).padStart(2, '0')).join('')
}

export interface ClipboardSubscription {
  close: () => void
  isAlive: () => boolean
  getRelayStatus: () => Promise<Record<string, boolean>>
}

/**
 * 데스크탑 수신: 복호화 → 클립보드 자동 쓰기 + 히스토리 저장
 */
async function processDesktopEvent(
  event: { id: string; created_at: number; content: string },
  userPubkey: string,
  onTextWritten: (text: string) => void,
  onImageWritten: (fingerprint: string, pngBytes: Uint8Array) => void,
): Promise<void> {
  toast(t('toast.received'))
  let payload: ClipboardPayload
  try {
    console.log('[subscribe] decrypting, userPubkey:', userPubkey.slice(0, 8))
    toast(t('toast.decrypt.start'))
    const plaintext = await getSigner().nip44Decrypt(userPubkey, event.content)
    payload = JSON.parse(plaintext) as ClipboardPayload
    toast(t('toast.decrypt.ok'), 'ok')
    console.log('[subscribe] decrypted, type:', payload.type)
  } catch (err) {
    console.error('[subscribe] decrypt failed:', err)
    toast(t('toast.decrypt.fail'), 'error')
    return
  }

  let fingerprint: string | undefined

  if (payload.type === 'text') {
    try {
      onTextWritten(payload.content)
      await writeClipboardText(payload.content)
      toast(t('toast.clipboard.updated'), 'ok')
      void notifyClipboardUpdated(payload.content.slice(0, 60))
      console.log('[subscribe] text received', event.id.slice(0, 8))
    } catch (err) {
      console.error('[subscribe] clipboard write failed:', err)
    }
  } else if (payload.type === 'file') {
    try {
      console.log('[subscribe] file download starting:', payload.filename, payload.mimeType)
      const pngBytes = await downloadAndDecrypt(payload.url, payload.sha256, payload.key, payload.iv)
      const img = await Image.fromBytes(pngBytes)
      const [rgba, size] = await Promise.all([img.rgba(), img.size()])
      fingerprint = `${size.width}x${size.height}:${headHex(rgba, 32)}`
      onImageWritten(fingerprint, pngBytes)
      await writeClipboardImage(pngBytes)
      toast(t('toast.clipboard.updated'), 'ok')
      void notifyClipboardUpdated(t('toast.clipboard.image'))
      console.log('[subscribe] image received', event.id.slice(0, 8))
    } catch (err) {
      console.error('[subscribe] file download failed:', err)
    }
  }

  await appendHistory({
    id: event.id,
    createdAt: event.created_at,
    payload,
    fingerprint,
  }).catch(err => console.error('[subscribe] history save failed:', err))
}

export function startClipboardSubscription(
  userPubkey: string,
  writeRelays: string[],
  onTextWritten: (text: string) => void,
  onImageWritten: (fingerprint: string, pngBytes: Uint8Array) => void,
): ClipboardSubscription {
  if (writeRelays.length === 0) {
    console.warn('[subscribe] no write relays — skipping subscription')
    return { close: () => {}, isAlive: () => false, getRelayStatus: async () => ({}) }
  }

  const pool = getSharedPool()
  const since = Math.floor(Date.now() / 1000)
  console.log('[subscribe] starting, relays:', writeRelays, 'since:', since)

  // EOSE를 받은 시각. 0이면 아직 구독 확인 안 됨.
  let lastActivityAt = 0
  // 릴레이가 CLOSED를 보내 구독이 종료된 상태.
  let subscriptionClosed = false
  // SimplePool의 enableReconnect가 자동 재연결 시 원래 since로 REQ를 재전송하므로
  // 이미 처리한 이벤트 ID를 추적해 중복 수신을 방지한다.
  const processedIds = new Set<string>()

  const sub = pool.subscribeMany(
    writeRelays,
    {
      kinds: [CLIPBOARD_KIND],
      authors: [userPubkey],
      since,
    },
    {
      oneose: () => {
        lastActivityAt = Date.now()
        console.log('[subscribe] EOSE received — subscription confirmed')
      },
      onclose: (reasons: string[]) => {
        subscriptionClosed = true
        lastActivityAt = 0
        console.warn('[subscribe] subscription closed by relay(s):', reasons)
      },
      onevent: (event: { id: string; created_at: number; content: string; tags: string[][] }) => {
        lastActivityAt = Date.now()
        if (processedIds.has(event.id)) {
          console.log('[subscribe] duplicate event, skipping:', event.id.slice(0, 8))
          return
        }
        processedIds.add(event.id)
        console.log('[subscribe] event received id:', event.id.slice(0, 8), 'created_at:', event.created_at)
        const clientTag = event.tags.find(tag => tag[0] === 'client')
        if (clientTag?.[1] !== CLIENT_TAG) {
          console.log('[subscribe] client tag mismatch, ignoring (tag:', clientTag?.[1], ')')
          return
        }

        if (isAndroid() && document.visibilityState === 'hidden') {
          // Android 백그라운드: 복호화하지 않음. 알림만 표시.
          // 알림 탭 → ClipboardActionActivity → Amber 직접 복호화 → 클립보드 쓰기.
          console.log('[subscribe] android background — showing notification for event:', event.id.slice(0, 8))
          void showReceivedNotification(
            t('notification.received.tap'),
            event.content,
            userPubkey,
          ).catch(err => console.error('[subscribe] android notification failed:', err))
          return
        }

        // 데스크탑 또는 Android 포그라운드: 즉시 복호화 → 클립보드 쓰기
        void processDesktopEvent(event, userPubkey, onTextWritten, onImageWritten)
      },
    },
  )

  return {
    close: () => {
      sub.close()
    },
    /** EOSE를 수신했고 아직 CLOSED를 받지 않은 경우에만 true */
    isAlive: () => !subscriptionClosed && lastActivityAt > 0,
    getRelayStatus: async () => {
      const status: Record<string, boolean> = {}
      for (const url of writeRelays) {
        try {
          const relay = await pool.ensureRelay(url)
          status[url] = relay.connected
        } catch {
          status[url] = false
        }
      }
      return status
    },
  }
}
