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
import { createPool, restoreSigner } from '@cliprelay/shared'
import { loadAuth } from '../store/auth-store'
import type { UniversalSigner } from './signer'

const OP_TIMEOUT_MS = 20_000

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

  private async op<T>(what: string, fn: (s: BunkerSigner) => Promise<T>): Promise<T> {
    try {
      return await withTimeout(fn(this.inner), what)
    } catch (err) {
      if (!(err instanceof SignerTimeoutError)) throw err
      console.warn(`[signer] ${what} timed out — rebuilding bunker signer`)
      await this.rebuild()
      return await withTimeout(fn(this.inner), `${what} (retry)`)
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
    this.inner = restoreSigner(auth.clientPrivkey, auth.signerPubkey, auth.signerRelays, pool)
    this.innerPool = pool
    console.log('[signer] bunker signer rebuilt with fresh pool')
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
    restoreSigner(clientPrivkeyHex, signerPubkey, signerRelays, pool),
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
