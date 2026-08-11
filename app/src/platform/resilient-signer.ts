/**
 * bunker signer 셀프힐링 래퍼
 *
 * BunkerSigner는 두 가지 사각지대가 있다:
 *
 * 1. sendRequest에 타임아웃이 없다 — 응답 이벤트가 안 오면 encrypt/decrypt/sign이
 *    영원히 pending. 발행은 "encrypting..."에서 멈추고, 수신 큐는 순차 처리라
 *    매달린 decrypt 하나가 뒤 이벤트 전부를 막는다 (실사고: 2026-08-05).
 * 2. 자기 전용 pool을 쓴다 — SyncEngine의 헬스체크/사다리가 공유 pool만 고치므로
 *    signer 연결이 죽으면 아무도 되살리지 않는다.
 *
 * 대응: 모든 RPC에 타임아웃을 걸고, 타임아웃이 나면 저장된 auth로 signer를
 * 통째로 재생성(새 pool 포함)한 뒤 한 번 재시도한다. 재생성은 connect RPC 없이
 * 로컬 구성만이라 싸다.
 *
 * 클립보드 싱크는 bunker가 자동승인이라는 전제 위에 있으므로(복사할 때마다 수동
 * 승인이면 애초에 못 쓴다) 타임아웃 20초는 "죽었다"의 신호로 충분하다.
 */
import type { BunkerSigner } from 'nostr-tools/nip46'
import type { SimplePool } from 'nostr-tools/pool'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure'
import { createPool, restoreSigner, NIP46_BOOTSTRAP_RELAYS } from '@cliprelay/shared'
import { loadAuth } from '../store/auth-store'
import { logConn } from '../nostr/connlog'
import type { UniversalSigner } from './signer'

/**
 * 세션 릴레이와 부트스트랩 릴레이의 합집합 — NIP-46 랑데부 그물을 넓게 친다.
 *
 * 실사고(2026-08-12): 저장된 signerRelays(로그인 때 switch_relays로 받은 Amber
 * 선호 목록)의 유효 릴레이가 전부 죽자 요청이 Amber에 도달할 길 자체가 사라졌다.
 * bp.relays는 발행과 응답 구독 양쪽에 쓰이므로, 여기에 부트스트랩(로그인 URI에
 * 실려서 벙커도 이 세션용으로 알고 있는 릴레이들)을 합치면 죽은 릴레이가 있어도
 * 남은 경로로 랑데부가 성립한다. 죽은 릴레이로의 발행 실패는 Promise.any가 무시.
 */
function widenRelays(sessionRelays: string[]): string[] {
  return [...new Set([...sessionRelays, ...NIP46_BOOTSTRAP_RELAYS.map(r => r.replace(/\/?$/, '/'))])]
}

const OP_TIMEOUT_MS = 20_000
/** kick(선제 재생성) 최소 간격 — 사다리 churn 중 15초마다 재생성하는 낭비 방지 */
const KICK_MIN_INTERVAL_MS = 60_000

export class SignerTimeoutError extends Error {
  constructor(what: string) {
    super(`${what} timed out after ${OP_TIMEOUT_MS / 1000}s`)
    this.name = 'SignerTimeoutError'
  }
}

function withTimeout<T>(run: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SignerTimeoutError(what)), OP_TIMEOUT_MS)
    run.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

class ResilientBunkerSigner implements UniversalSigner {
  private inner: BunkerSigner
  /** 우리가 만든 pool일 때만 보관 — 재생성 시 직접 destroy해야 하므로 */
  private innerPool: SimplePool | null
  private rebuilding: Promise<void> | null = null
  private lastRebuildAt: number = 0

  constructor(inner: BunkerSigner, innerPool: SimplePool | null = null) {
    this.inner = inner
    this.innerPool = innerPool
  }

  signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return this.op('signEvent', s => s.signEvent(event))
  }

  nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return this.op('nip44Encrypt', s => s.nip44Encrypt(pubkey, plaintext))
  }

  nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return this.op('nip44Decrypt', s => s.nip44Decrypt(pubkey, ciphertext))
  }

  close(): void {
    void this.inner.close().catch(() => {})
    try { this.innerPool?.destroy() } catch { /* ignore */ }
    this.innerPool = null
  }

  /**
   * 연결이 의심될 때 외부(SyncEngine 사다리)에서 호출 — signer pool을 선제 재생성.
   *
   * 클립보드 pool은 probe+사다리로 좀비를 잡아내지만 signer pool엔 그런 감시가
   * 없어서, 슬립 복귀 때 클립보드만 살아나고 signer는 좀비로 남는 사고가 났다
   * (2026-08-11: 수신은 되는데 encrypt/decrypt만 실패). 사다리가 "연결을 못
   * 믿겠다"고 판단한 시점이면 signer 연결도 못 믿는 게 맞다.
   */
  kick(reason: string): void {
    const now = Date.now()
    if (now - this.lastRebuildAt < KICK_MIN_INTERVAL_MS) return
    console.warn(`[signer] kicked (${reason}) — rebuilding bunker signer`)
    void this.rebuild().catch(err => console.warn('[signer] kick rebuild failed:', err))
  }

  private async op<T>(what: string, fn: (s: BunkerSigner) => Promise<T>): Promise<T> {
    try {
      return await withTimeout(fn(this.inner), what)
    } catch (err) {
      // 타임아웃(20초 무응답)만이 아니라 빠른 실패도 rebuild 대상이다.
      // 좀비 pool에선 publish가 4.4초 만에 AggregateError로 거절되는데, 이걸
      // 타임아웃이 아니라고 그대로 던지면 rebuild가 영영 발동하지 않는다
      // (2026-08-11 실사고). 진짜 bunker 거절(권한 등)이어도 rebuild 후 한 번 더
      // 시도하고 같은 에러를 받게 되므로 손해는 중복 요청 1회뿐이다.
      const kind = err instanceof SignerTimeoutError ? 'timeout' : 'error'
      console.warn(`[signer] ${what} failed (${kind}) — rebuilding bunker signer:`, err)
      logConn(`signer ${what} failed (${kind}) — rebuilding`)
      await this.rebuild()
      try {
        return await withTimeout(fn(this.inner), `${what} (retry)`)
      } catch (retryErr) {
        logConn(`signer ${what} failed after rebuild`)
        throw retryErr
      }
    }
  }

  /** 저장된 auth로 signer를 재생성. 동시 호출은 한 번의 재생성을 공유한다. */
  private rebuild(): Promise<void> {
    if (!this.rebuilding) {
      this.rebuilding = this.doRebuild().finally(() => { this.rebuilding = null })
    }
    return this.rebuilding
  }

  private async doRebuild(): Promise<void> {
    const auth = await loadAuth()
    if (!auth?.clientPrivkey || !auth.signerPubkey || !auth.signerRelays?.length) {
      throw new Error('cannot rebuild signer — stored auth incomplete')
    }

    void this.inner.close().catch(() => {})
    try { this.innerPool?.destroy() } catch { /* ignore */ }

    const pool = createPool()
    const relays = widenRelays(auth.signerRelays)
    this.inner = restoreSigner(auth.clientPrivkey, auth.signerPubkey, relays, pool)
    this.innerPool = pool
    this.lastRebuildAt = Date.now()
    console.log('[signer] bunker signer rebuilt with fresh pool, relays:', relays)
    logConn(`signer pool rebuilt (${relays.length} relays)`)
  }
}

/**
 * 저장된 auth에서 셀프힐링 bunker signer 생성 (앱 부팅 세션 복원용).
 * ping/자동재연결이 켜진 전용 pool을 함께 만든다.
 */
export function restoreResilientSigner(
  clientPrivkeyHex: string,
  signerPubkey: string,
  signerRelays: string[],
): UniversalSigner {
  const pool = createPool()
  return new ResilientBunkerSigner(
    restoreSigner(clientPrivkeyHex, signerPubkey, widenRelays(signerRelays), pool),
    pool,
  )
}

/**
 * 로그인 직후의 BunkerSigner를 감싼다. 이 signer의 내부 pool은 nostr-tools
 * 기본값(재연결 없음)이지만, 첫 타임아웃 때 rebuild가 튼튼한 pool로 교체한다.
 */
export function makeResilientSigner(inner: BunkerSigner): UniversalSigner {
  return new ResilientBunkerSigner(inner, null)
}
