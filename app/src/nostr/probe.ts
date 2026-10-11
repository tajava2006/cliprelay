/**
 * 생사 프로브 — 릴레이별 REQ→EOSE 왕복
 *
 * Tauri 의존이 없는 순수 로직이라 subscribe.ts에서 떼어냈다 (단독 실행·검증 가능).
 */
import type { SimplePool } from 'nostr-tools/pool'

export interface ProbeResult {
  /** 찌른 릴레이 중 하나라도 REQ에 EOSE로 답했는가 */
  alive: boolean
  /** 소켓은 붙어 있는데 답하지 않은 릴레이 (좀비 소켓이거나, EOSE를 안 주는 릴레이) */
  silent: string[]
}

/** 프로브 REQ용 더미 이벤트 id — 존재할 수 없는 id라 limit:0과 함께 즉시 EOSE만 받는다 */
const PROBE_DUMMY_ID = 'a'.repeat(64)

/**
 * 릴레이마다 따로 묻는다. 예전엔 한 구독으로 전부 묶어 "모두가 EOSE를 줘야 통과"였는데,
 * 그러면 REQ에 EOSE를 안 돌려주는 릴레이 하나가 섞인 것만으로 전체가 죽은 것으로
 * 판정된다 (실사고 2026-10-11: nostr.bitcoiner.social이 EOSE를 끊자 사다리가 15초마다
 * hard reset을 돌리고 30분마다 앱을 재시작 — 나머지 두 릴레이는 멀쩡했다). 알고 싶은 건
 * "수신 경로가 하나라도 살아 있는가"이므로, 한 곳이라도 답하면 산 것이다.
 */
export function probeRelays(pool: SimplePool, live: string[], timeoutMs: number): Promise<ProbeResult> {
  return new Promise<ProbeResult>(resolve => {
    const answered = new Set<string>()
    const subs: { close: () => void }[] = []
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      for (const sub of subs) { try { sub.close() } catch { /* ignore */ } }
      resolve({ alive: answered.size > 0, silent: live.filter(url => !answered.has(url)) })
    }
    const timer = setTimeout(finish, timeoutMs)
    for (const url of live) {
      let closed = false
      subs.push(pool.subscribeMany(
        [url],
        { ids: [PROBE_DUMMY_ID], limit: 0 },
        {
          label: '<liveness>',
          oneose: () => {
            // nostr-tools는 접속 실패·구독 종료도 EOSE로 센다(handleClose→handleEose).
            // 그건 답이 아니므로, 같은 동기 스택에서 뒤따르는 onclose를 보고 걸러낸다.
            queueMicrotask(() => {
              if (closed || settled) return
              answered.add(url)
              if (answered.size === live.length) finish()
            })
          },
          onclose: () => { closed = true },
          onevent: () => {},
          // ⚠️ 절대 제거 금지: nostr-tools Subscription은 릴레이가 무응답이어도
          // eoseTimeout(기본 4.4초) 뒤 EOSE를 로컬에서 합성한다. 이 값을 우리
          // 판정 타이머보다 길게 잡지 않으면 좀비 릴레이 위에서도 가짜 EOSE가
          // 떠서 프로브가 영원히 true를 반환한다 (2026-08-09 실사고: 소켓 0개
          // 상태로 몇 시간을 "정상" 오판 — 사다리 완전 침묵).
          maxWait: timeoutMs + 2_000,
        },
      ))
    }
  })
}
