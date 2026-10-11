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
import { bytesToHex, hexToBytes, normalizeURL } from 'nostr-tools/utils'
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
 * skipSwitchRelays: nostr-tools가 연결 직후 자동으로 보내는 switch_relays를 끈다.
 * 기능을 안 쓰겠다는 게 아니라 우리가 직접 한다는 뜻이다(settleSessionRelays).
 * 자동 호출은 응답을 1초만 기다리고 넘어가는데, 그 뒤에 응답이 오면 signer는
 * 조용히 새 릴레이로 옮겨가고 호출자는 옛 목록을 저장한 채로 남는다.
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

// ─── 세션 릴레이 협상 (switch_relays) ────────────────────────

/** 벙커의 switch_relays 응답을 기다리는 시간 */
const SWITCH_WAIT_MS = 8_000
/** 옮긴 릴레이에서 벙커가 실제로 응답하는지 확인하는 시간 */
const VERIFY_WAIT_MS = 10_000

export type RelaySettlement =
  /** 벙커가 바꿀 게 없다고 했거나(null·같은 목록) 제때 답하지 않았다 */
  | 'kept'
  /** 벙커 선호 릴레이로 옮겼고, 그 릴레이로 응답이 돌아오는 것까지 확인했다 */
  | 'switched'
  /** 벙커가 새 목록을 줬지만 거기서 응답이 없다 — 옛 목록과 합쳐서 쓴다 */
  | 'unverified'

export interface RelayNegotiation {
  outcome: RelaySettlement
  /**
   * 저장할 세션 릴레이. 'unverified'면 옛∪새 합집합인데, 넘겨준 signer는 새
   * 목록만 구독하고 있으므로 호출자가 이 목록으로 signer를 다시 만들어야 한다.
   */
  relays: string[]
}

/**
 * 세션 릴레이를 벙커가 선호하는 목록으로 옮긴다 (NIP-46 switch_relays).
 *
 * 왜 하나: nostrconnect:// URI엔 우리가 하드코딩한 릴레이가 실린다. 그 릴레이가
 * 시원찮아지면 앱을 다시 배포해야 했다. 벙커에게 물어서 옮기면 유저가 벙커 쪽
 * 기본 릴레이만 바꾸면 된다. 로그인 때와 앱을 켤 때마다 묻는다.
 *
 * 왜 검증하나: 이 전환은 양쪽이 따로 반영한다. 벙커는 응답을 내보낸 뒤 자기
 * 목록을 고치고 클라는 응답을 받은 뒤 고치는데, 한쪽만 반영되면 서로 다른
 * 릴레이를 보게 된다(실사고 2026-08-12: 클라만 옮겨가서 영구 불통). 그래서 옮긴
 * 직후 새 릴레이로만 get_public_key를 보내 답이 오는지 본다. 답이 오면 벙커가
 * 거기서 듣고 있다는 뜻이니 새 목록만 채택하고, 안 오면 옛 목록과 합친다 —
 * 벙커가 어느 쪽에 있든 닿는다.
 *
 * 응답이 SWITCH_WAIT_MS를 넘겨 늦게 오면 signer는 그때 옮겨간다. 그 경우엔
 * onLateSwitch로 합집합을 넘기니 호출자가 저장을 갱신해야 한다.
 */
export async function negotiateSessionRelays(
  signer: BunkerSigner,
  onLateSwitch?: (relays: string[]) => void,
): Promise<RelayNegotiation> {
  const before = [...signer.bp.relays]
  const switching = signer.switchRelays()
  const changed = await Promise.race([
    switching,
    new Promise<'late'>(resolve => setTimeout(() => resolve('late'), SWITCH_WAIT_MS)),
  ])

  if (changed === 'late') {
    void switching.then(lateChanged => {
      if (lateChanged) onLateSwitch?.(unionRelays(before, signer.bp.relays))
    })
  }
  if (changed !== true) return { outcome: 'kept', relays: before }

  const after = [...signer.bp.relays]
  // 순서만 다른 같은 목록에도 nostr-tools는 "바뀌었다"고 답한다. 옮길 게 없다.
  if (sameRelaySet(before, after)) return { outcome: 'kept', relays: before }
  try {
    // get_public_key는 signer가 결과를 캐시한다. 캐시가 차 있으면 릴레이를
    // 타지 않아 검증이 되지 않으므로 비우고 보낸다.
    ;(signer as unknown as { cachedPubKey?: string }).cachedPubKey = undefined
    await withDeadline(signer.getPublicKey(), VERIFY_WAIT_MS)
    return { outcome: 'switched', relays: after }
  } catch {
    return { outcome: 'unverified', relays: unionRelays(before, after) }
  }
}

export interface SettledSession extends RelayNegotiation {
  /** 이후에 쓸 signer. 'unverified'면 넘겨받은 것과 다른 새 객체다. */
  signer: BunkerSigner
  userPubkey: string
}

/** 로그인 직후용: 협상하고, 검증이 안 됐으면 합집합을 구독하는 signer로 갈아탄다. */
export async function settleSessionRelays(
  signer: BunkerSigner,
  clientSecretKey: Uint8Array,
  onLateSwitch?: (relays: string[]) => void,
): Promise<SettledSession> {
  const result = await negotiateSessionRelays(signer, onLateSwitch)
  if (result.outcome !== 'unverified') {
    return { ...result, signer, userPubkey: await signer.getPublicKey() }
  }
  void signer.close().catch(() => {})
  const wide = BunkerSigner.fromBunker(clientSecretKey, {
    pubkey: signer.bp.pubkey,
    relays: result.relays,
    secret: null,
  })
  return { ...result, signer: wide, userPubkey: await wide.getPublicKey() }
}

function sameRelaySet(a: string[], b: string[]): boolean {
  const norm = (urls: string[]) => [...new Set(urls.map(canonical))].sort().join(' ')
  return norm(a) === norm(b)
}

function canonical(url: string): string {
  try { return normalizeURL(url) } catch { return url }
}

function unionRelays(a: string[], b: string[]): string[] {
  const seen = new Set<string>()
  return [...a, ...b].filter(url => {
    const key = canonical(url)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function withDeadline<T>(run: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    run.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
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
