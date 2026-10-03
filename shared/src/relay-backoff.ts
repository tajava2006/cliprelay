/**
 * 릴레이 접속 백오프 — "지금 이 릴레이에 새 소켓을 열어도 되는가"의 단일 판정처
 *
 * 왜 필요한가: 재접속 경로가 여러 개(15초 헬스체크 사다리, 5분 repair, 발행,
 * signer pool 재생성)인데 전부 과거 실패를 기억하지 않아, 우리를 거절하는
 * 릴레이에도 같은 박자로 계속 두드렸다. 릴레이 입장에선 스팸이고, 실제로
 * 같은 패턴의 다른 앱(arkade-nwc-bridge)이 nos.lol / nostr.mom / relay.damus.io
 * 에서 IP 차단을 당했다 (2026-10).
 *
 * 상태는 모듈 전역이다 — pool은 hardReset·signer rebuild 때마다 새로 만들어지는데,
 * 릴레이가 우리를 거절한다는 사실은 pool과 무관하게 유지돼야 한다.
 *
 * 스케줄: 5s → 10s → 20s … 최대 5분, ±20% 지터. 접속에 성공하면 초기화.
 */
import { normalizeURL } from 'nostr-tools/utils'

const BASE_DELAY_MS = 5_000
const MAX_DELAY_MS = 5 * 60_000
const JITTER = 0.2

interface State {
  failures: number
  blockedUntil: number
}

const states = new Map<string, State>()

function key(url: string): string {
  try { return normalizeURL(url) } catch { return url }
}

/** 백오프 중이 아니면 true. */
export function relayAttemptAllowed(url: string): boolean {
  const s = states.get(key(url))
  return !s || Date.now() >= s.blockedUntil
}

/**
 * 접속 실패 기록. 한 번의 시도에 여러 구독/발행이 합류했다가 함께 실패를
 * 보고하므로, 이미 백오프 창 안이면 중복으로 세지 않는다.
 */
export function noteRelayFailure(url: string): void {
  const k = key(url)
  const s = states.get(k) ?? { failures: 0, blockedUntil: 0 }
  if (s.blockedUntil > Date.now()) return
  s.failures++
  const exp = Math.min(BASE_DELAY_MS * 2 ** (s.failures - 1), MAX_DELAY_MS)
  s.blockedUntil = Date.now() + Math.round(exp * (1 + JITTER * (2 * Math.random() - 1)))
  states.set(k, s)
}

export function noteRelaySuccess(url: string): void {
  states.delete(key(url))
}

/**
 * 백오프를 걷어낸다 — "조건이 바뀌었다"는 외부 신호(슬립 복귀, 네트워크 복구)가
 * 있을 때. 인자가 없으면 전부.
 * @returns 실제로 백오프 중이던 릴레이가 하나라도 있었는가
 */
export function clearRelayBackoff(urls?: string[]): boolean {
  const now = Date.now()
  let hadBlocked = false
  for (const k of urls ? urls.map(key) : [...states.keys()]) {
    const s = states.get(k)
    if (!s) continue
    if (s.blockedUntil > now) hadBlocked = true
    states.delete(k)
  }
  return hadBlocked
}
