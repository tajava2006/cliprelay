/**
 * NIP-46 원격 서명 로직
 *
 * QR 코드 방식 (nostrconnect://):
 *   클라이언트가 URI 생성 → QR 표시 → 벙커가 스캔 → BunkerSigner.fromURI() 완료
 *
 * bunker:// URL 방식:
 *   사용자가 bunker URL 붙여넣기 → parseBunkerInput() → fromBunker() → connect()
 *
 * 세션 복원:
 *   저장된 clientPrivkey + signerPubkey + signerRelays → fromBunker() (connect RPC 없이)
 */
import { BunkerSigner, parseBunkerInput, createNostrConnectURI } from 'nostr-tools/nip46'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'
import type { AbstractSimplePool } from 'nostr-tools/abstract-pool'
import { NIP46_BOOTSTRAP_RELAYS } from './constants.ts'

export { bytesToHex, hexToBytes, NIP46_BOOTSTRAP_RELAYS }

// ─── 클라이언트 키페어 ────────────────────────────────────────

export function generateClientKey(): Uint8Array {
  return generateSecretKey()
}

// ─── QR 코드 방식 (nostrconnect://) ─────────────────────────

/** 클라이언트가 표시할 nostrconnect:// URI 생성 */
export function createConnectURI(clientSecretKey: Uint8Array): string {
  const clientPubkey = getPublicKey(clientSecretKey)
  const secret = crypto.randomUUID().replace(/-/g, '')
  return createNostrConnectURI({
    clientPubkey,
    relays: NIP46_BOOTSTRAP_RELAYS,
    secret,
    perms: ['sign_event', 'get_public_key', 'nip44_encrypt', 'nip44_decrypt'],
    name: 'ClipRelay',
  })
}

/**
 * 벙커가 QR을 스캔할 때까지 대기.
 *
 * skipSwitchRelays: 연결 직후 nostr-tools가 자동으로 switch_relays를 호출해
 * 세션 릴레이를 벙커의 선호 목록으로 갈아치우는 걸 막는다. 실사고(2026-08-12):
 * Amber가 넘겨준 선호 릴레이 중 실제 듣는 것들이 죽자(nsec.app 502, oxtr 다운)
 * 세션 랑데부가 공집합이 돼 영구 불통 — 폰이 깨어있어도 요청 도달 불가.
 * 우리가 검증한 부트스트랩 릴레이를 세션 릴레이로 유지하는 쪽이 안전하다
 * (벙커는 어차피 URI에 실린 릴레이를 이 세션용으로 구독한다).
 */
export async function connectFromURI(
  clientSecretKey: Uint8Array,
  uri: string,
  signal: AbortSignal,
): Promise<BunkerSigner> {
  return BunkerSigner.fromURI(clientSecretKey, uri, { skipSwitchRelays: true }, signal)
}

// ─── bunker:// URL 방식 ───────────────────────────────────────

/**
 * 사용자가 붙여넣거나 QR로 스캔한 bunker:// URL로 연결.
 *
 * timeoutMs: nostr-tools connect()는 자체 타임아웃이 없어서 릴레이/벙커가
 * 무응답이면 영원히 pending — UI가 '연결 중…'에 갇힌다. 여기서 잘라준다.
 */
export async function connectFromBunkerURL(
  clientSecretKey: Uint8Array,
  bunkerUrl: string,
  timeoutMs = 60_000,
): Promise<BunkerSigner> {
  const bp = await parseBunkerInput(bunkerUrl)
  if (!bp) throw new Error('유효하지 않은 bunker URL입니다.')
  if (bp.relays.length === 0) throw new Error('bunker URL에 릴레이가 없습니다.')
  const signer = BunkerSigner.fromBunker(clientSecretKey, bp)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      signer.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('벙커 응답 대기 시간이 초과됐습니다. 서명 앱이 켜져 있는지 확인해 주세요.')),
          timeoutMs,
        )
      }),
    ])
    return signer
  } catch (err) {
    void signer.close().catch(() => {})
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ─── 세션 복원 ───────────────────────────────────────────────

/**
 * 저장된 세션 정보로 BunkerSigner 복원 (connect RPC 없이)
 *
 * @param pool 서명자 전용 pool. 안 주면 nostr-tools가 기본 SimplePool을 만드는데,
 *             그건 ping/자동재연결이 꺼져 있어서 연결이 한 번 끊기면 영영 안 돌아온다.
 *             상시 연결이 필요하면 createPool()로 만든 것을 넘길 것.
 */
export function restoreSigner(
  clientPrivkeyHex: string,
  signerPubkey: string,
  signerRelays: string[],
  pool?: AbstractSimplePool,
): BunkerSigner {
  return BunkerSigner.fromBunker(
    hexToBytes(clientPrivkeyHex),
    {
      pubkey: signerPubkey,
      relays: signerRelays,
      secret: null,
    },
    pool ? { pool } : {},
  )
}
