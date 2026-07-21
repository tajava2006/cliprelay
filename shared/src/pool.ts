/**
 * SimplePool 생성 규약
 *
 * 디스커버리 함수들은 보통 앱의 공유 pool을 주입받지만, 주입이 없을 때를 위한
 * 폴백 pool도 만든다. 그 폴백에도 같은 설정이 적용되어야 해서 여기 한 곳으로 모았다.
 */
import { SimplePool } from 'nostr-tools/pool'

/**
 * 상시 연결용 SimplePool 생성.
 *
 * ⚠️ `idleTimeout = 0`은 필수다. nostr-tools 2.23.11부터 기본값이 20초인데,
 * `<forced-ping>` 구독이 ongoingOperations를 증가는 건너뛰고 감소는 그대로 해서
 * ping 한 번마다 카운터가 1씩 깎인다. 0이 되는 순간 유휴로 판정돼 20초 뒤
 * relay.close() + skipReconnection=true → 구독이 통째로 죽고 재연결도 안 된다.
 * (생성자 옵션으로는 못 끈다 — SimplePool이 enablePing/enableReconnect만 받고,
 * 0은 falsy라 AbstractRelay 쪽에서도 무시된다.)
 */
export function createPool(): SimplePool {
  const pool = new SimplePool({ enablePing: true, enableReconnect: true })
  pool.idleTimeout = 0
  return pool
}
