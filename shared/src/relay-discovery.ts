/**
 * NIP-65 릴레이 디스커버리
 *
 * RELAY_LIST_KIND 이벤트에서 write 릴레이 목록을 추출한다.
 * 클립보드 이벤트 발행/구독에는 write 릴레이만 사용한다.
 */
import { SimplePool } from 'nostr-tools/pool'
import type { Event } from 'nostr-tools/core'
import { RELAY_LIST_KIND, NIP65_DISCOVERY_RELAYS } from './constants.ts'

export { NIP65_DISCOVERY_RELAYS }

// ─── 파싱 ────────────────────────────────────────────────────

/**
 * kind:10002 이벤트에서 write 릴레이 목록 추출.
 *
 * NIP-65 규칙:
 *   - 마커 없음 → read + write 양쪽
 *   - 마커 "write" → write 전용
 *   - 마커 "read" → 제외
 */
export function parseWriteRelays(event: Event): string[] {
  return event.tags
    .filter(
      (tag): tag is [string, string, ...string[]] =>
        tag[0] === 'r' && typeof tag[1] === 'string',
    )
    .filter(tag => !tag[2] || tag[2] === 'write')
    .map(tag => tag[1])
}

// ─── One-shot fetch ──────────────────────────────────────────

/**
 * 사용자의 kind:10002 이벤트를 한 번 조회해 write 릴레이 반환.
 * 이벤트 없거나 write 릴레이가 없으면 null 반환.
 */
export async function fetchWriteRelays(userPubkey: string, externalPool?: SimplePool): Promise<string[] | null> {
  const pool = externalPool ?? new SimplePool({ enablePing: true, enableReconnect: true })
  try {
    const event = await pool.get(NIP65_DISCOVERY_RELAYS, {
      kinds: [RELAY_LIST_KIND],
      authors: [userPubkey],
    })
    if (!event) return null
    const relays = parseWriteRelays(event)
    return relays.length > 0 ? relays : null
  } finally {
    if (!externalPool) pool.destroy()
  }
}

// ─── 지속 구독 ───────────────────────────────────────────────

/**
 * kind:10002 변경을 실시간 구독한다.
 * EOSE 이후에도 구독을 유지해 릴레이 목록 변경을 반영한다.
 * 과거 이벤트 재전파는 created_at으로 방어한다.
 *
 * @returns 구독 해제 함수 (컴포넌트 언마운트 또는 로그아웃 시 호출)
 */
export function subscribeWriteRelays(
  userPubkey: string,
  onUpdate: (relays: string[]) => void,
  externalPool?: SimplePool,
): () => void {
  const pool = externalPool ?? new SimplePool({ enablePing: true, enableReconnect: true })
  let latestCreatedAt = 0

  const sub = pool.subscribeMany(
    NIP65_DISCOVERY_RELAYS,
    { kinds: [RELAY_LIST_KIND], authors: [userPubkey] },
    {
      onevent: (event: Event) => {
        if (event.created_at <= latestCreatedAt) return
        latestCreatedAt = event.created_at
        const relays = parseWriteRelays(event)
        if (relays.length > 0) onUpdate(relays)
      },
    },
  )

  return () => {
    sub.close()
    if (!externalPool) pool.destroy()
  }
}
