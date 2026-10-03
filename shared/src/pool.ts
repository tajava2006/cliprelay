/**
 * SimplePool 생성 규약
 *
 * 디스커버리 함수들은 보통 앱의 공유 pool을 주입받지만, 주입이 없을 때를 위한
 * 폴백 pool도 만든다. 그 폴백에도 같은 설정이 적용되어야 해서 여기 한 곳으로 모았다.
 */
import { SimplePool } from 'nostr-tools/pool'
import type { AbstractRelay } from 'nostr-tools/abstract-relay'
import { normalizeURL } from 'nostr-tools/utils'
import { relayAttemptAllowed, noteRelayFailure, noteRelaySuccess } from './relay-backoff.ts'

/**
 * nostr-tools 내부 재연결 루프의 간격. 기본값은 10s·10s·10s·20s·20s·30s·60s에서
 * 60초로 영원히 반복 — 우리를 차단한 릴레이를 하루 1,440번 두드린다.
 * 5분 상한으로 늘린다 (슬립 복귀·네트워크 복구 때는 어차피 소켓을 통째로 버리고
 * 새로 붙으므로 이 루프의 속도에 복구가 달려 있지 않다).
 */
const RECONNECT_BACKOFF_MS = [10_000, 20_000, 40_000, 80_000, 160_000, 300_000]

/**
 * 접속 시도를 통제하는 SimplePool.
 *
 * 두 가지를 막는다:
 *
 * 1. 백오프 중인 릴레이로의 새 접속 (relay-backoff.ts).
 *
 * 2. nostr-tools 내부 재연결 루프와의 경합. 루프가 돌고 있는 릴레이에 pool
 *    경유(ensureRelay)로 접속을 시도해서 실패하면, pool은 그 relay 객체를 맵에서
 *    지우는데 객체는 혼자 계속 재접속한다. 다음 ensureRelay는 객체를 새로 만든다
 *    → **장애 한 번마다 살아있는 소켓이 하나씩 누적**되고(실측: 장애 2회 뒤 한
 *    릴레이에 소켓 3개), pool이 아는 쪽 객체엔 구독이 없어서 화면엔 "죽음"으로
 *    뜬다. 15초 프로브·발행·재구독이 전부 이 경합의 방아쇠였다.
 *    루프가 도는 동안은 접속 요청을 거절해 루프에 맡긴다.
 */
export class GuardedPool extends SimplePool {
  constructor() {
    super({ enablePing: true, enableReconnect: true })
    // ⚠️ `idleTimeout = 0`은 필수다. nostr-tools 2.23.11부터 기본값이 20초인데,
    // `<forced-ping>` 구독이 ongoingOperations를 증가는 건너뛰고 감소는 그대로 해서
    // ping 한 번마다 카운터가 1씩 깎인다. 0이 되는 순간 유휴로 판정돼 20초 뒤
    // relay.close() + skipReconnection=true → 구독이 통째로 죽고 재연결도 안 된다.
    // (생성자 옵션으로는 못 끈다 — SimplePool이 enablePing/enableReconnect만 받고,
    // 0은 falsy라 AbstractRelay 쪽에서도 무시된다.)
    this.idleTimeout = 0

    this.allowConnectingToRelay = url => {
      const relay = this.peekRelay(url)
      if (relay?.connected) return true
      if (relay && isReconnecting(relay)) return false
      return relayAttemptAllowed(url)
    }
    this.onRelayConnectionFailure = url => noteRelayFailure(url)
    this.onRelayConnectionSuccess = url => {
      noteRelaySuccess(url)
      const relay = this.peekRelay(url)
      if (relay) relay.resubscribeBackoff = RECONNECT_BACKOFF_MS
    }
  }

  /** 부작용 없이 pool 내부 relay 조회. 연결을 새로 만들지 않는다. */
  peekRelay(url: string): AbstractRelay | undefined {
    return this.relays.get(normalizeURL(url))
  }
}

/** relay가 nostr-tools 내부 재연결 루프(대기 또는 시도 중)에 있는가. */
function isReconnecting(relay: AbstractRelay): boolean {
  // reconnect()가 올리고 onopen이 0으로 되돌리는 카운터 — 타입상 private이라 캐스팅
  return (relay as unknown as { reconnectAttempts: number }).reconnectAttempts > 0
}

/** 상시 연결용 pool 생성. */
export function createPool(): GuardedPool {
  return new GuardedPool()
}
