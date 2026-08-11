/**
 * 최후 수단 — 페이지 리로드 / 앱 재시작
 *
 * WKWebView는 창이 hidden이 된 지 ~5분 뒤 뷰를 suspend하는데(트레이 앱인 우리는
 * 인생 대부분이 hidden), 깨어난 뒤 페이지의 WebSocket 채널이 반쯤 망가진 채로
 * 남는 경우가 있다 — new WebSocket()이 OS 소켓 생성조차 못 하는 상태(실사고:
 * 2026-08-07, 헬스 사다리가 hardReset까지 돌아도 접속 시도 0회). 이 상태는 JS
 * 레벨에서 복구 불가라 페이지/프로세스를 갈아치우는 것만이 답이다.
 *
 * 오프라인일 때 무한 리로드를 돌지 않도록, WebKit과 독립적인 Rust 쪽
 * 네트워킹(plugin-http)으로 인터넷이 실제로 통하는지 확인한 경우에만 발동한다.
 * "Rust로는 릴레이가 응답하는데 페이지 WebSocket은 안 됨" = WebKit 레이어 고장 확정.
 *
 * 발동 순서: 세션당 리로드 2회 → 그래도 죽어 있으면 앱 재시작(30분에 1회 상한).
 * sessionStorage는 리로드를 견디고 앱 재시작 때 비워지므로 카운터로 적합하다.
 */
import { fetch as rustFetch } from '@tauri-apps/plugin-http'
import { isAndroid } from './detect'
import { logConn } from '../nostr/connlog'

const ORACLE_TIMEOUT_MS = 5_000
/**
 * 리로드는 1회만 시도하고 바로 relaunch로 넘어간다. 실측(2026-08-09): 웨지가
 * 페이지가 아니라 WebKit 네트워킹 프로세스에 있으면 리로드 2회로도 안 살아난다
 * — 새 페이지의 소켓도 같은 죽은 프로세스에서 씹힌다. 프로세스 교체(relaunch)만이
 * 확실한 치료라 리로드에 시간을 낭비하지 않는다.
 */
const RELOAD_LIMIT_PER_SESSION = 1
const RELAUNCH_MIN_INTERVAL_MS = 30 * 60 * 1000
const RELOADS_KEY = 'cliprelay.deadReloads'
const RELAUNCH_KEY = 'cliprelay.lastDeadRelaunch'

/**
 * Rust 쪽 HTTP로 릴레이 호스트가 응답하는지. 상태 코드는 무엇이든 상관없다 —
 * 응답이 왔다는 사실 자체가 "네트워크는 통한다"는 증거다.
 */
async function rustNetworkReachable(writeRelays: string[]): Promise<boolean> {
  for (const relay of writeRelays.slice(0, 3)) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ORACLE_TIMEOUT_MS)
    try {
      await rustFetch(relay.replace(/^wss?:\/\//, 'https://'), {
        method: 'GET',
        headers: { Accept: 'application/nostr+json' },
        signal: ctrl.signal,
      })
      return true
    } catch {
      // 이 릴레이가 죽었을 수도 있으니 다음 릴레이로
    } finally {
      clearTimeout(timer)
    }
  }
  return false
}

/**
 * 죽음이 오래 지속될 때 호출. WebKit 레이어 고장이 확인되면 리로드/재시작한다.
 * (Android는 네이티브 OkHttp 구독이 별도로 있고 relaunch 시맨틱도 달라 제외)
 */
export async function tryLastResort(writeRelays: string[]): Promise<void> {
  if (isAndroid()) return
  if (writeRelays.length === 0) return

  if (!(await rustNetworkReachable(writeRelays))) {
    console.warn('[last-resort] network unreachable via rust too — genuine offline, holding')
    logConn('last resort held: genuinely offline')
    return
  }

  const reloads = Number(sessionStorage.getItem(RELOADS_KEY) ?? '0')
  if (reloads < RELOAD_LIMIT_PER_SESSION) {
    sessionStorage.setItem(RELOADS_KEY, String(reloads + 1))
    console.warn(`[last-resort] webkit socket layer looks dead — reloading page (${reloads + 1}/${RELOAD_LIMIT_PER_SESSION})`)
    logConn(`webkit dead — reloading page (${reloads + 1}/${RELOAD_LIMIT_PER_SESSION})`)
    location.reload()
    return
  }

  const lastRelaunch = Number(localStorage.getItem(RELAUNCH_KEY) ?? '0')
  if (Date.now() - lastRelaunch <= RELAUNCH_MIN_INTERVAL_MS) {
    // 침묵 모드 금지 — 게이트에 막혀 아무것도 안 하는 상태도 로그에 보여야 한다
    // (2026-08-09: dev에서 relaunch 실패 후 이 게이트가 10분간 조용히 막고 있었음)
    logConn('last resort held: relaunch cooldown (30m)')
    return
  }
  localStorage.setItem(RELAUNCH_KEY, String(Date.now()))
  console.warn('[last-resort] reloads exhausted — relaunching app')
  logConn('reloads exhausted — relaunching app')
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (err) {
    // pnpm tauri dev 같은 비번들 실행에선 relaunch가 실패할 수 있다 —
    // 실패도 로그에 남겨야 "relaunch 했는데 왜 그대로지"가 관찰 가능하다
    console.error('[last-resort] relaunch failed:', err)
    logConn(`relaunch FAILED: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 연결이 살아난 뒤 호출 — 다음 사고를 위해 리로드 예산을 되돌린다 */
export function noteRecovered(): void {
  sessionStorage.removeItem(RELOADS_KEY)
}
