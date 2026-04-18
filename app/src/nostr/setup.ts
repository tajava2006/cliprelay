/**
 * 최초 로그인 사용자(kind:10002 미발행)를 위한 디폴트 릴레이/Blossom 자동 설정.
 * 발행 실패 시 예외를 던지지 않고 null 반환 — 앱 진입을 막지 않는다.
 */
import { RELAY_LIST_KIND, BLOSSOM_SERVER_LIST_KIND, NIP65_DISCOVERY_RELAYS } from '@cliprelay/shared'
import { getSigner } from '../platform/signer'
import { getSharedPool } from './pool'

export async function publishDefaultRelayList(relays: string[]): Promise<boolean> {
  try {
    const signer = getSigner()
    const event = await signer.signEvent({
      kind: RELAY_LIST_KIND,
      content: '',
      created_at: Math.floor(Date.now() / 1000),
      tags: relays.map(url => ['r', url]),
    })
    const pool = getSharedPool()
    const results = await Promise.allSettled(pool.publish(NIP65_DISCOVERY_RELAYS, event))
    const ok = results.some(r => r.status === 'fulfilled')
    if (ok) console.log('[setup] published default kind:10002')
    return ok
  } catch (err) {
    console.warn('[setup] failed to publish default kind:10002:', err)
    return false
  }
}

export async function publishDefaultBlossomList(servers: string[], writeRelays: string[]): Promise<boolean> {
  try {
    const signer = getSigner()
    const event = await signer.signEvent({
      kind: BLOSSOM_SERVER_LIST_KIND,
      content: '',
      created_at: Math.floor(Date.now() / 1000),
      tags: servers.map(url => ['server', url]),
    })
    const pool = getSharedPool()
    const results = await Promise.allSettled(pool.publish(writeRelays, event))
    const ok = results.some(r => r.status === 'fulfilled')
    if (ok) console.log('[setup] published default kind:10063')
    return ok
  } catch (err) {
    console.warn('[setup] failed to publish default kind:10063:', err)
    return false
  }
}
