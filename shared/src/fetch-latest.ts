/**
 * 교체형 이벤트(kind:10002·10063 등) 한 번 조회 — "없다"와 "못 물어봤다"를 구분한다.
 *
 * pool.get()은 릴레이에 닿지 못했을 때도 null을 준다. 그 null을 "이 사용자는
 * 아직 목록을 안 만들었다"로 읽으면, 네트워크가 잠깐 나빴을 뿐인데 디폴트
 * 목록을 서명·발행해서 사용자의 진짜 목록을 덮어쓰게 된다. 그래서 실제로 답한
 * 릴레이 수를 같이 돌려준다 — 답한 곳이 하나도 없으면 호출자는 아무것도 단정하면 안 된다.
 */
import type { SimplePool } from 'nostr-tools/pool'
import type { Event } from 'nostr-tools/core'
import type { Filter } from 'nostr-tools/filter'

export interface LatestResult {
  /** 답한 릴레이들이 준 것 중 가장 최신 이벤트. 없으면 null */
  event: Event | null
  /** 이벤트든 EOSE든 실제로 답한 릴레이 수. 0이면 event=null은 "모름"이다 */
  answered: number
}

const FETCH_TIMEOUT_MS = 8_000

export function fetchLatest(
  pool: SimplePool,
  relays: string[],
  filter: Filter,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<LatestResult> {
  return new Promise<LatestResult>(resolve => {
    if (relays.length === 0) { resolve({ event: null, answered: 0 }); return }
    const answered = new Set<string>()
    const done = new Set<string>()
    const subs: { close: () => void }[] = []
    let latest: Event | null = null
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      for (const sub of subs) { try { sub.close() } catch { /* ignore */ } }
      resolve({ event: latest, answered: answered.size })
    }
    const timer = setTimeout(finish, timeoutMs)
    const relayDone = (url: string) => {
      done.add(url)
      if (done.size === relays.length) finish()
    }
    // 릴레이마다 따로 묻는다 — 한 구독으로 묶으면 누가 답했는지 알 수 없다.
    for (const url of relays) {
      let closed = false
      subs.push(pool.subscribeMany([url], filter, {
        onevent: (event: Event) => {
          answered.add(url)
          if (!latest || event.created_at > latest.created_at) latest = event
        },
        oneose: () => {
          // nostr-tools는 접속 실패·구독 종료도 EOSE로 센다. 같은 동기 스택에서
          // 뒤따르는 onclose를 보고 걸러낸다 (app/src/nostr/probe.ts와 같은 수법).
          queueMicrotask(() => {
            if (settled) return
            if (!closed) answered.add(url)
            relayDone(url)
          })
        },
        onclose: () => { closed = true },
        // 무응답 릴레이 위에서 nostr-tools가 합성하는 가짜 EOSE가 우리 타이머보다
        // 먼저 뜨지 않게 한다.
        maxWait: timeoutMs + 2_000,
      }))
    }
  })
}
