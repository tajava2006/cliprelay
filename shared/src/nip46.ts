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

/** 벙커가 QR을 스캔할 때까지 대기 */
export async function connectFromURI(
  clientSecretKey: Uint8Array,
  uri: string,
  signal: AbortSignal,
): Promise<BunkerSigner> {
  return BunkerSigner.fromURI(clientSecretKey, uri, {}, signal)
}

// ─── bunker:// URL 방식 ───────────────────────────────────────

/** 사용자가 붙여넣은 bunker:// URL로 연결 */
export async function connectFromBunkerURL(
  clientSecretKey: Uint8Array,
  bunkerUrl: string,
): Promise<BunkerSigner> {
  const bp = await parseBunkerInput(bunkerUrl)
  if (!bp) throw new Error('유효하지 않은 bunker URL입니다.')
  if (bp.relays.length === 0) throw new Error('bunker URL에 릴레이가 없습니다.')
  const signer = BunkerSigner.fromBunker(clientSecretKey, bp)
  await signer.connect()
  return signer
}

// ─── 세션 복원 ───────────────────────────────────────────────

/** 저장된 세션 정보로 BunkerSigner 복원 (connect RPC 없이) */
export function restoreSigner(
  clientPrivkeyHex: string,
  signerPubkey: string,
  signerRelays: string[],
): BunkerSigner {
  return BunkerSigner.fromBunker(hexToBytes(clientPrivkeyHex), {
    pubkey: signerPubkey,
    relays: signerRelays,
    secret: null,
  })
}
