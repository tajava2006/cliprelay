/**
 * 플랫폼별 서명자(Signer) 추상화
 *
 * publish, subscribe, upload 등에서 getSigner()를 호출해
 * signEvent / nip44Encrypt / nip44Decrypt 을 사용한다.
 *
 * BunkerSigner(nostr-tools)가 이미 이 메서드들을 제공하므로
 * 데스크탑에서는 변경 없이 동작한다.
 *
 * Android에서 Amber를 사용할 경우, 같은 인터페이스를 구현하는
 * AmberSigner를 만들어 setSigner()로 주입하면 된다. (Step 3에서 구현)
 */
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure'

/**
 * 서명자가 제공해야 하는 최소 인터페이스.
 * BunkerSigner는 이미 이 메서드들을 모두 갖고 있다.
 */
export interface UniversalSigner {
  signEvent(event: EventTemplate): Promise<VerifiedEvent>
  nip44Encrypt(pubkey: string, plaintext: string): Promise<string>
  nip44Decrypt(pubkey: string, ciphertext: string): Promise<string>
  close?(): void
  /** 연결이 의심될 때 선제 재생성 (ResilientBunkerSigner만 구현, Amber는 무관) */
  kick?(reason: string): void
}

let _signer: UniversalSigner | null = null

export function setSigner(signer: UniversalSigner): void {
  _signer = signer
}

export function getSigner(): UniversalSigner {
  if (!_signer) throw new Error('Signer not initialized — login required')
  return _signer
}

export function clearSigner(): void {
  try { _signer?.close?.() } catch { /* ignore */ }
  _signer = null
}

export function hasSigner(): boolean {
  return _signer !== null
}

/**
 * 연결 의심 신호를 signer에 전달 — SyncEngine 사다리(forceReconnect/hardReset)가
 * 클립보드 pool을 못 믿겠다고 판단한 시점에 signer pool도 같이 재생성한다.
 * signer가 없거나 kick을 구현하지 않으면(Amber) 무해한 no-op.
 */
export function kickSigner(reason: string): void {
  try { _signer?.kick?.(reason) } catch { /* ignore */ }
}
