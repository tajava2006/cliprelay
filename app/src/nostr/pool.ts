/**
 * 앱 전체에서 공유하는 SimplePool 싱글턴
 *
 * 모든 구독(클립보드, 릴레이, Blossom, 프로필)과 발행이 이 pool을 사용한다.
 * 동일 릴레이에 WebSocket 연결을 하나만 유지해 연결 수와 ping 트래픽을 줄인다.
 */
import { SimplePool } from 'nostr-tools/pool'

let pool: SimplePool | null = null

/** 앱 전체 공유 SimplePool 반환. 최초 호출 시 생성. */
export function getSharedPool(): SimplePool {
  if (!pool) {
    pool = new SimplePool({ enablePing: true, enableReconnect: true })
  }
  return pool
}

/** 로그아웃 시 pool 파괴. 다음 getSharedPool() 호출 시 새로 생성된다. */
export function destroySharedPool(): void {
  if (pool) {
    pool.destroy()
    pool = null
  }
}
