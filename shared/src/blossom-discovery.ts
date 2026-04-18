/**
 * Blossom 서버 디스커버리 (BUD-03)
 *
 * kind:10063 이벤트에서 사용자의 Blossom 서버 목록을 추출한다.
 * 릴레이 디스커버리와 동일한 패턴으로 NIP65_DISCOVERY_RELAYS에서 조회한다.
 */
import { SimplePool } from 'nostr-tools/pool'
import type { Event } from 'nostr-tools/core'
import { BLOSSOM_SERVER_LIST_KIND } from './constants.ts'

/** kind:10063 이벤트에서 Blossom 서버 URL 목록 추출 */
export function parseBlossomServers(event: Event): string[] {
  return event.tags
    .filter((tag): tag is [string, string] => tag[0] === 'server' && typeof tag[1] === 'string')
    .map(tag => tag[1])
}

/**
 * 사용자의 kind:10063 이벤트를 한 번 조회해 서버 목록 반환. 없으면 null.
 * @param userPubkey  사용자 공개키
 * @param writeRelays 사용자의 write 릴레이 (이미 알고 있으므로 하드코딩 불필요)
 */
export async function fetchBlossomServers(
  userPubkey: string,
  writeRelays: string[],
  externalPool?: SimplePool,
): Promise<string[] | null> {
  if (writeRelays.length === 0) return null
  const pool = externalPool ?? new SimplePool({ enablePing: true, enableReconnect: true })
  try {
    const event = await pool.get(writeRelays, {
      kinds: [BLOSSOM_SERVER_LIST_KIND],
      authors: [userPubkey],
    })
    if (!event) return null
    const servers = parseBlossomServers(event)
    return servers.length > 0 ? servers : null
  } finally {
    if (!externalPool) pool.destroy()
  }
}

/**
 * kind:10063 변경을 실시간 구독한다.
 * write 릴레이가 변경되면 호출자가 이 함수를 다시 호출해 구독을 재생성한다.
 *
 * @param userPubkey  사용자 공개키
 * @param writeRelays 현재 write 릴레이 목록
 * @param onUpdate    서버 목록 갱신 시 호출
 * @returns 구독 해제 함수
 */
export function subscribeBlossomServers(
  userPubkey: string,
  writeRelays: string[],
  onUpdate: (servers: string[]) => void,
  externalPool?: SimplePool,
): () => void {
  if (writeRelays.length === 0) return () => {}

  const pool = externalPool ?? new SimplePool({ enablePing: true, enableReconnect: true })
  let latestCreatedAt = 0

  const sub = pool.subscribeMany(
    writeRelays,
    { kinds: [BLOSSOM_SERVER_LIST_KIND], authors: [userPubkey] },
    {
      onevent: (event: Event) => {
        if (event.created_at <= latestCreatedAt) return
        latestCreatedAt = event.created_at
        const servers = parseBlossomServers(event)
        if (servers.length > 0) onUpdate(servers)
      },
    },
  )

  return () => {
    sub.close()
    if (!externalPool) pool.destroy()
  }
}
