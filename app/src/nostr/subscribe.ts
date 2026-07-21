/**
 * kind:9372 클립보드 이벤트 구독
 *
 * write 릴레이 전체를 구독해 자신이 발행한 클립보드 이벤트를 수신한다.
 * 다른 기기에서 복사한 내용이 이쪽 릴레이로 도착하면:
 *
 * 데스크탑: 복호화 → 클립보드 자동 쓰기 + 히스토리 저장
 * Android: 알림 표시 (복호화하지 않음) → 알림 탭 → 투명 Activity가 Amber로 복호화 → 클립보드 쓰기
 *
 * since: 기본은 구독 시작 시각 (앱 실행 이전 이벤트 재수신 방지).
 *        연결 복구로 재시작할 때만 과거로 당겨서 끊긴 동안 놓친 이벤트를 회수한다.
 */
import { CLIPBOARD_KIND, CLIENT_TAG } from '@cliprelay/shared'
import { getSharedPool, relayHasLiveSubscription, CLIPBOARD_SUB_LABEL } from './pool'
import type { ClipboardPayload } from '@cliprelay/shared'
import { Image } from '@tauri-apps/api/image'
import { getSigner } from '../platform/signer'
import { writeClipboardText, writeClipboardImage } from '../clipboard/writer'
import { toast } from '../toast'
import { t } from '../i18n'
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { downloadAndDecrypt } from '../blossom/download'
import { appendHistory, hasHistoryId } from '../store/history-store'
import { isAndroid } from '../platform/detect'
import { fingerprintRgba } from '../clipboard/fingerprint'

/** 구독 생성 직후 릴레이 접속이 끝날 때까지의 유예. 이 사이엔 죽음 판정을 하지 않는다. */
const CONNECT_GRACE_MS = 10_000

async function notifyClipboardUpdated(detail: string): Promise<void> {
  try {
    let granted = await isPermissionGranted()
    if (!granted) granted = (await requestPermission()) === 'granted'
    if (granted) sendNotification({ title: 'ClipRelay', body: detail })
  } catch { /* fire-and-forget */ }
}

export interface ClipboardSubscription {
  close: () => void
  /** 릴레이 중 하나라도 실제로 수신 가능한 상태인가 (구조 판정) */
  isAlive: () => boolean
  /** 릴레이별 수신 가능 여부. 부작용 없음(연결을 새로 만들지 않는다) */
  getRelayStatus: () => Record<string, boolean>
  /** 마지막으로 받은 이벤트의 created_at (초). 없으면 0 */
  getLastEventCreatedAt: () => number
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
      void notifyClipboardUpdated(t('toast.clipboard.updated'))
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
      fingerprint = fingerprintRgba(rgba, size.width, size.height)
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

/**
 * @param since 구독 시작 시점(초). 재시작 시에는 죽어 있던 동안 놓친 이벤트를 받으려고
 *              과거로 당겨서 넣는다. 중복 수신은 processedIds + 히스토리 id로 걸러진다.
 */
export function startClipboardSubscription(
  userPubkey: string,
  writeRelays: string[],
  onTextWritten: (text: string) => void,
  onImageWritten: (fingerprint: string, pngBytes: Uint8Array) => void,
  since: number = Math.floor(Date.now() / 1000),
): ClipboardSubscription {
  if (writeRelays.length === 0) {
    console.warn('[subscribe] no write relays — skipping subscription')
    return {
      close: () => {},
      isAlive: () => false,
      getRelayStatus: () => ({}),
      getLastEventCreatedAt: () => 0,
    }
  }

  const pool = getSharedPool()
  console.log('[subscribe] starting, relays:', writeRelays, 'since:', since)

  // 구독 생성 시각. 릴레이 접속이 끝나기 전에 "죽었다"고 판정하지 않으려는 유예용.
  const startedAt = Date.now()
  // 마지막으로 받은 이벤트의 created_at (재시작 시 since 계산용)
  let lastEventCreatedAt = 0
  // 릴레이가 CLOSED를 보내 구독이 종료된 상태.
  let subscriptionClosed = false
  // SimplePool의 enableReconnect가 자동 재연결 시 원래 since로 REQ를 재전송하므로
  // 이미 처리한 이벤트 ID를 추적해 중복 수신을 방지한다.
  const processedIds = new Set<string>()

  // --- 이벤트 처리 큐 ---
  // 백그라운드 복귀 등으로 이벤트가 한꺼번에 밀려올 때
  // 동시 복호화/저장으로 앱이 터지는 것을 방지한다.
  // 이벤트를 큐에 넣고 하나씩 순차 처리한다.
  type QueuedEvent = { id: string; created_at: number; content: string; tags: string[][] }
  const eventQueue: QueuedEvent[] = []
  let queueProcessing = false

  async function processQueue(): Promise<void> {
    if (queueProcessing) return
    queueProcessing = true
    while (eventQueue.length > 0) {
      const event = eventQueue.shift()!
      try {
        // 발신 에코 감지
        if (await hasHistoryId(event.id)) {
          console.log('[subscribe] own event echo, skipping:', event.id.slice(0, 8))
          continue
        }

        if (isAndroid() && document.visibilityState === 'hidden') {
          // Android 백그라운드: 네이티브 구독(OkHttp)이 알림을 처리한다.
          // JS가 이벤트를 받았다면 히스토리만 저장 (보너스).
          console.log('[subscribe] android background — event:', event.id.slice(0, 8))
          try {
            const plaintext = await getSigner().nip44Decrypt(userPubkey, event.content)
            const payload = JSON.parse(plaintext) as ClipboardPayload
            await appendHistory({ id: event.id, createdAt: event.created_at, payload })
            console.log('[subscribe] android background — history saved:', event.id.slice(0, 8))
          } catch (err) {
            console.warn('[subscribe] android background decrypt/history failed:', err)
          }
        } else {
          // 데스크탑 또는 Android 포그라운드: 즉시 복호화 → 클립보드 쓰기
          await processDesktopEvent(event, userPubkey, onTextWritten, onImageWritten)
        }
      } catch (err) {
        console.error('[subscribe] queue item processing failed:', event.id.slice(0, 8), err)
      }
    }
    queueProcessing = false
  }

  function enqueueEvent(event: QueuedEvent): void {
    eventQueue.push(event)
    void processQueue()
  }
  // --- 큐 끝 ---

  const sub = pool.subscribeMany(
    writeRelays,
    {
      kinds: [CLIPBOARD_KIND],
      authors: [userPubkey],
      since,
    },
    {
      // 구독 id가 `clipboard:<serial>`이 되어, pool 안에 이 구독이 살아 있는지
      // 릴레이별로 직접 확인할 수 있다 (isAlive 판정에 사용).
      label: CLIPBOARD_SUB_LABEL,
      oneose: () => {
        console.log('[subscribe] EOSE received — subscription confirmed')
      },
      onclose: (reasons: string[]) => {
        subscriptionClosed = true
        console.warn('[subscribe] subscription closed by relay(s):', reasons)
      },
      onevent: (event: { id: string; created_at: number; content: string; tags: string[][] }) => {
        if (event.created_at > lastEventCreatedAt) lastEventCreatedAt = event.created_at
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
        enqueueEvent(event)
      },
    },
  )

  return {
    close: () => {
      sub.close()
    },
    /**
     * 살아있음 판정.
     *
     * 예전에는 `!closed && lastActivityAt > 0`이었는데, 이건 사실상 항상 true였다:
     * lastActivityAt은 EOSE를 한 번 받으면 다시 0이 되지 않고, onclose는 **모든**
     * 릴레이의 구독이 닫혀야만 호출된다(nostr-tools abstract-pool의 handleClose).
     * 그래서 연결이 죽어도 헬스체크가 아무것도 감지하지 못했다.
     *
     * 지금은 pool 내부 상태를 직접 본다 — 릴레이 소켓이 붙어 있고 그 위에 우리
     * 구독(clipboard:*)이 실제로 열려 있는 릴레이가 하나라도 있어야 alive.
     * 하나만 살아 있어도 수신은 되므로 some()으로 판정한다 (릴레이 목록에 죽은 URL이
     * 섞여 있을 때 15초마다 전체 재시작하는 churn을 피하려는 의도).
     */
    isAlive: () => {
      if (subscriptionClosed) return false
      if (writeRelays.some(url => relayHasLiveSubscription(url, CLIPBOARD_SUB_LABEL))) return true
      // 아직 접속/구독 중일 수 있으므로 생성 직후 잠깐은 죽었다고 판정하지 않는다
      return Date.now() - startedAt < CONNECT_GRACE_MS
    },
    getRelayStatus: () => {
      const status: Record<string, boolean> = {}
      for (const url of writeRelays) {
        status[url] = relayHasLiveSubscription(url, CLIPBOARD_SUB_LABEL)
      }
      return status
    },
    getLastEventCreatedAt: () => lastEventCreatedAt,
  }
}
