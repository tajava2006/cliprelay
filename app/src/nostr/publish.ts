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
import type { ClipboardPayload } from '@cliprelay/shared'
import { getSigner } from '../platform/signer'
import { loadAuth } from '../store/auth-store'
import { appendHistory } from '../store/history-store'
import { toast } from '../toast'
import { t } from '../i18n'

export async function publishClipboard(
  payload: ClipboardPayload,
  writeRelays: string[],
): Promise<void> {
  if (writeRelays.length === 0) {
    console.warn('[publish] no write relays — skipping publish')
    return
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

  const event = await signer.signEvent({
    kind: CLIPBOARD_KIND,
    content: ciphertext,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['client', CLIENT_TAG],
      ['expiration', String(Math.floor(Date.now() / 1000) + 86400)],
    ],
  })

  // 발행 전 미리 저장 — 릴레이 에코 수신 시 중복 처리(복호화·클립보드 쓰기·알림) 방지
  await appendHistory({
    id: event.id,
    createdAt: event.created_at,
    payload,
  }).catch(err => console.error('[publish] history save failed:', err))

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
