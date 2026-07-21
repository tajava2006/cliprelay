/**
 * 연결 워치독 — "이 시점엔 소켓이 죽었을 가능성이 높다"를 알려주는 트리거 모음
 *
 * 데스크탑(특히 맥)에서 유휴 → 디스플레이 슬립 → 시스템 슬립으로 들어가면
 * WebSocket이 조용히 죽는다. 문제는 죽었다는 사실이 JS까지 안 올라온다는 것:
 *
 *   - 시스템이 자는 동안 타이머가 아예 안 돈다 → 라이브러리 ping(29초)도 안 돈다
 *   - 깨어나도 소켓이 half-open이면 readyState는 계속 OPEN,
 *     close/error 이벤트가 안 오거나 TCP 재전송 타임아웃(수 분~십수 분) 뒤에야 온다
 *   - Tauri 창은 최소화해도 항상 visible이라 visibilitychange도 안 뜬다
 *
 * 그래서 "상태를 물어보는" 방식으로는 감지가 안 되고, **슬립이 있었다는 사실 자체**를
 * 감지해야 한다. 1초 타이머의 실제 경과 시간을 재면 된다 — 시스템이 잤거나 WebView가
 * 스로틀링됐으면 1초 타이머가 수십 초/수 분 뒤에 돌아온다. 그 간극이 곧 신호다.
 */

/** 1초 타이머가 이만큼 밀렸으면 슬립/스로틀링으로 간주 */
const WAKE_DRIFT_MS = 10_000
const TICK_MS = 1_000

export interface WatchdogHandlers {
  /** 슬립/스로틀링 복귀 감지 (driftMs = 타이머가 밀린 시간) */
  onWake: (driftMs: number) => void
  /** 네트워크 복구 */
  onOnline: () => void
}

/** 워치독 시작. 반환값을 호출하면 정지. */
export function startWatchdog(handlers: WatchdogHandlers): () => void {
  let expected = Date.now() + TICK_MS

  const tick = () => {
    const now = Date.now()
    const drift = now - expected
    expected = now + TICK_MS
    if (drift > WAKE_DRIFT_MS) {
      console.warn(`[watchdog] timer drift ${Math.round(drift / 1000)}s — 슬립/스로틀링 복귀로 판단`)
      handlers.onWake(drift)
    }
  }
  const timer = setInterval(tick, TICK_MS)

  const onOnline = () => {
    console.log('[watchdog] network online')
    handlers.onOnline()
  }
  const onOffline = () => console.warn('[watchdog] network offline')
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)

  return () => {
    clearInterval(timer)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}
