/**
 * kind:0 프로필 디스커버리
 *
 * 사용자의 kind:0 메타데이터 이벤트에서 프로필 정보를 추출한다.
 * relay-discovery.ts와 동일한 패턴: one-shot fetch + 지속 구독.
 */
import { SimplePool } from 'nostr-tools/pool'
import type { Event } from 'nostr-tools/core'
import { npubEncode } from 'nostr-tools/nip19'
import type { UserProfile } from './types.ts'

const STR_FIELDS: (keyof UserProfile)[] = [
  'name', 'display_name', 'picture', 'banner',
  'about', 'nip05', 'lud06', 'lud16', 'website',
]

// ─── 파싱 ────────────────────────────────────────────────────

/** kind:0 이벤트 content(JSON)에서 UserProfile 추출 */
export function parseProfile(event: Event): UserProfile | null {
  try {
    const raw = JSON.parse(event.content) as Record<string, unknown>
    const profile: UserProfile = {}
    for (const key of STR_FIELDS) {
      if (typeof raw[key] === 'string') {
        (profile as Record<string, string>)[key] = raw[key] as string
      }
    }
    return profile
  } catch {
    return null
  }
}

/** hex pubkey → npub1... bech32 표현 */
export function pubkeyToNpub(hex: string): string {
  return npubEncode(hex)
}

// ─── One-shot fetch ──────────────────────────────────────────

/**
 * 사용자의 kind:0 이벤트를 한 번 조회해 프로필 반환.
 */
export async function fetchProfile(
  userPubkey: string,
  writeRelays: string[],
  externalPool?: SimplePool,
): Promise<UserProfile | null> {
  const pool = externalPool ?? new SimplePool({ enablePing: true, enableReconnect: true })
  try {
    const event = await pool.get(writeRelays, {
      kinds: [0],
      authors: [userPubkey],
    })
    if (!event) return null
    return parseProfile(event)
  } finally {
    if (!externalPool) pool.destroy()
  }
}

// ─── 지속 구독 ───────────────────────────────────────────────

/**
 * kind:0 변경을 실시간 구독한다.
 * 프로필 변경을 즉시 반영한다.
 *
 * @returns 구독 해제 함수
 */
export function subscribeProfile(
  userPubkey: string,
  writeRelays: string[],
  onUpdate: (profile: UserProfile) => void,
  externalPool?: SimplePool,
): () => void {
  const pool = externalPool ?? new SimplePool({ enablePing: true, enableReconnect: true })
  let latestCreatedAt = 0

  const sub = pool.subscribeMany(
    writeRelays,
    { kinds: [0], authors: [userPubkey] },
    {
      onevent: (event: Event) => {
        if (event.created_at <= latestCreatedAt) return
        latestCreatedAt = event.created_at
        const profile = parseProfile(event)
        if (profile) onUpdate(profile)
      },
    },
  )

  return () => {
    sub.close()
    if (!externalPool) pool.destroy()
  }
}
