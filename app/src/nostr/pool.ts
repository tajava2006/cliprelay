/**
 * 앱 전체에서 공유하는 SimplePool 싱글턴
 *
 * 모든 구독(클립보드, 릴레이, Blossom, 프로필)과 발행이 이 pool을 사용한다.
 * 동일 릴레이에 WebSocket 연결을 하나만 유지해 연결 수와 ping 트래픽을 줄인다.
 *
 * ⚠️ 연결 상태 조회에 `pool.ensureRelay(url)`를 쓰면 안 된다.
 *    ensureRelay는 "없으면 새로 만들어 접속한다"는 부작용이 있어서,
 *    죽은 구독은 살려주지 않으면서 소켓만 새로 띄운다
 *    (= 화면은 초록불인데 수신은 안 되는 상태를 만든다).
 *    조회는 부작용 없는 peekRelay()로 한다.
 */
import { createPool, type GuardedPool } from '@cliprelay/shared'

/** 클립보드 구독 라벨. nostr-tools가 구독 id를 `<label>:<serial>`로 만든다. */
export const CLIPBOARD_SUB_LABEL = 'clipboard'

let pool: GuardedPool | null = null

/** 앱 전체 공유 pool 반환. 최초 호출 시 생성. 설정은 shared의 createPool() 참고. */
export function getSharedPool(): GuardedPool {
  if (!pool) pool = createPool()
  return pool
}

/**
 * pool 파괴 (로그아웃, 헬스체크 hardReset). 다음 getSharedPool() 호출 시 새로 생성된다.
 * destroy()가 던져도 싱글턴은 무조건 비운다 — 꼬인 pool을 붙들고 있는 것보다
 * 새로 시작하는 쪽이 항상 안전하다.
 */
export function destroySharedPool(): void {
  const old = pool
  pool = null
  old?.destroy()
}

/**
 * 해당 릴레이에 `label`로 시작하는 구독이 실제로 열려 있고 소켓도 살아 있는가.
 *
 * nostr-tools는 연결이 끊기면 상황에 따라
 *   (a) relay 객체를 pool 맵에서 지우거나 (onclose → pool.relays.delete)
 *   (b) relay는 남기고 openSubs만 비우거나 (closeAllSubscriptions)
 *   (c) 재접속에 성공해 openSubs를 다시 fire
 * 하는데, 앱이 알아야 하는 건 "지금 이 릴레이로 이벤트가 들어올 수 있나" 하나다.
 * 세 경우를 한 번에 판정한다.
 */
export function relayHasLiveSubscription(url: string, label: string): boolean {
  const relay = getSharedPool().peekRelay(url)
  if (!relay || !relay.connected) return false
  for (const id of relay.openSubs.keys()) {
    if (id.startsWith(label + ':')) return true
  }
  return false
}

/**
 * 소켓을 강제로 버린다 (좀비 소켓 대응).
 *
 * 맥이 잠들었다 깨어나면 WebSocket이 readyState=OPEN인 채로 죽어 있는 경우가 있다
 * (peer가 RST를 안 보내서 close/error 이벤트가 영영 안 온다). 이때 relay.connected는
 * true라 어떤 상태 판정으로도 구분이 안 되므로, 의심되면 그냥 끊고 새로 붙는 게
 * 유일하게 확실한 방법이다. close()된 relay는 pool 맵에서도 빠져서
 * 다음 구독 때 새 소켓으로 연결된다.
 */
export function dropRelayConnections(urls: string[]): void {
  if (urls.length === 0) return
  getSharedPool().close(urls)
}
