/** 클립보드 동기화 이벤트 kind (커스텀, 미등록) */
export const CLIPBOARD_KIND = 9372

/** client 태그 값 — kind 충돌 시 로컬 필터링용 (릴레이 인덱싱 안 됨) */
export const CLIENT_TAG = 'cliprelay'

// ─── Nostr kind 상수 ──────────────────────────────────────────

/** NIP-01 프로필 메타데이터 */
export const PROFILE_KIND = 0

/** NIP-65 릴레이 목록 */
export const RELAY_LIST_KIND = 10002

/** BUD-03 Blossom 서버 목록 */
export const BLOSSOM_SERVER_LIST_KIND = 10063

/** BUD-02 Blossom auth 이벤트 */
export const BLOSSOM_AUTH_KIND = 24242

// ─── 부트스트랩 릴레이 ────────────────────────────────────────

/**
 * NIP-46 핸드쉐이크용 부트스트랩 릴레이.
 * 클립보드 동기화 릴레이(RELAY_LIST_KIND)와 무관 — 로그인 handshake 전용.
 * 연결 수립 후에는 사용자의 write 릴레이로 전환한다.
 */
export const NIP46_BOOTSTRAP_RELAYS = [
  'wss://relay.nsec.app',
  'wss://relay.damus.io',
  'wss://nos.lol',
]

/** RELAY_LIST_KIND 이벤트를 보유한 well-known 디스커버리 릴레이 (purplepag.es) */
export const NIP65_DISCOVERY_RELAYS = [
  'wss://purplepag.es',
  'wss://relay.damus.io',
  'wss://nos.lol',
]

/** kind:10002 미발행 초보자에게 자동으로 설정해줄 디폴트 쓰기 릴레이 */
export const DEFAULT_WRITE_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
]

/** kind:10063 미발행 초보자에게 자동으로 설정해줄 디폴트 Blossom 서버 */
export const DEFAULT_BLOSSOM_SERVERS = [
  'https://nostr.download',
  'https://blossom.primal.net',
]
