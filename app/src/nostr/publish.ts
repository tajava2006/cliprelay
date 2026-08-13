/**
 * kind:9372 클립보드 이벤트 발행
 *
 * 1. BunkerSigner.nip44Encrypt(userPubkey, ...) — 버거가 userPrivkey로 자기암호화
 *    (실패 시 예외 → 발행 중단. 평문을 릴레이에 올리는 코드 금지)
 * 2. EventTemplate 생성 (client 태그 포함)
 * 3. BunkerSigner.signEvent() → 서명된 이벤트
 * 4. SimplePool로 write 릴레이 전체에 발행
 */
import { CLIPBOARD_KIND, CLIENT_TAG } from '@cliprelay/shared'
import { getSharedPool } from './pool'
import { noteOwnEvent } from './own-events'
import type { ClipboardPayload } from '@cliprelay/shared'
import { getSigner } from '../platform/signer'
import { loadAuth } from '../store/auth-store'
import { appendHistory, loadHistory } from '../store/history-store'
import { toast } from '../toast'
import { t } from '../i18n'

export async function publishClipboard(
  payload: ClipboardPayload,
  writeRelays: string[],
  opts?: {
    /**
     * 히스토리 중복 가드 무시. 중복 가드는 클립보드 모니터가 같은 내용을 반복
     * 발행하는 노이즈를 막기 위한 것 — 입력란에서 사용자가 명시적으로 보내는
     * 텍스트는 이미 보낸 것과 같아도 보내야 하므로 이걸 켠다.
     */
    force?: boolean
  },
): Promise<void> {
  if (writeRelays.length === 0) {
    console.warn('[publish] no write relays — skipping publish')
    return
  }

  // 텍스트 가드:
  // 1) 빈 문자열 — 유휴 상태 복귀 직후 OS 클립보드가 비어있는 경우 발행 방지
  // 2) 히스토리 중복 — 같은 내용을 반복 발행해 다른 기기에 노이즈를 만들지 않음
  if (payload.type === 'text') {
    if (payload.content === '') {
      console.log('[publish] empty text, skipping')
      return
    }
    if (!opts?.force) {
      const history = await loadHistory()
      const duplicate = history.some(
        item => item.payload.type === 'text' && item.payload.content === payload.content,
      )
      if (duplicate) {
        console.log('[publish] text already in history, skipping')
        return
      }
    }
  }

  const auth = await loadAuth()
  if (!auth) throw new Error('Auth not found')

  const signer = getSigner()

  console.log('[publish] encrypting, userPubkey:', auth.userPubkey.slice(0, 8))
  toast(t('toast.encrypt.start'))
  // 버거가 userPrivkey로 자기 자신과 NIP-44 암호화
  // 암호화 실패 시 예외 → 호출자에서 발행 중단
  let ciphertext: string
  try {
    ciphertext = await signer.nip44Encrypt(auth.userPubkey, JSON.stringify(payload))
  } catch (err) {
    toast(t('toast.encrypt.fail'), 'error')
    throw err
  }
  toast(t('toast.encrypt.ok'), 'ok')
  console.log('[publish] encrypted, requesting signature')

  // concealed는 릴레이 잔류도 짧게 — 전달 창구(수 분)만 확보하면 충분하다
  const concealed = payload.type === 'text' && payload.concealed === true
  const expirationS = concealed ? 600 : 86400

  const event = await signer.signEvent({
    kind: CLIPBOARD_KIND,
    content: ciphertext,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['client', CLIENT_TAG],
      ['expiration', String(Math.floor(Date.now() / 1000) + expirationS)],
    ],
  })

  // 에코(자기 이벤트 재수신) 판별용 — 히스토리에 안 남는 concealed도 걸러야 하므로
  // 인메모리 셋에도 항상 기록한다
  noteOwnEvent(event.id)

  if (concealed) {
    // 민감 정보는 히스토리에 남기지 않는다 — 원본 앱이 붙인 "오래 남기지 마라"
    // 마커를 전달 경로 끝까지 존중. 에코 방지는 위의 noteOwnEvent가 담당.
    console.log('[publish] concealed text — skipping history')
  } else {
    // 발행 전 미리 저장 — 릴레이 에코 수신 시 중복 처리(복호화·클립보드 쓰기·알림) 방지
    await appendHistory({
      id: event.id,
      createdAt: event.created_at,
      payload,
    }).catch(err => console.error('[publish] history save failed:', err))
  }

  toast(t('toast.broadcast.start'))
  const pool = getSharedPool()
  const results = await Promise.allSettled(pool.publish(writeRelays, event))
  for (let i = 0; i < writeRelays.length; i++) {
    const relay = writeRelays[i].replace(/^wss?:\/\//, '')
    if (results[i].status === 'fulfilled') {
      toast(`${relay} — ${t('toast.relay.ok')}`, 'ok')
    } else {
      toast(`${relay} — ${t('toast.relay.fail')}`, 'error')
    }
  }
  const ok = results.filter(r => r.status === 'fulfilled').length
  if (ok === 0) throw new Error('All relays publish failed')
  console.log(`[publish] published ${ok}/${writeRelays.length}`, event.id.slice(0, 8))
}
