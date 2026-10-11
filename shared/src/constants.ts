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
 * NIP-46 부트스트랩 릴레이 — 로그인 handshake용.
 * 클립보드 동기화 릴레이(RELAY_LIST_KIND)와 무관.
 *
 * nostrconnect:// URI에 실려서 벙커(Amber)와 처음 만나는 자리다. 만난 직후
 * switch_relays로 세션을 벙커 선호 릴레이로 옮기므로(settleSessionRelays),
 * 벙커가 선호 목록을 주는 한 이 목록은 로그인 순간에만 쓰인다. 벙커가 바꿀 게
 * 없다고 하거나 전환이 검증되지 않으면 세션에도 남는다.
 * 여기가 전부 죽어 QR 로그인이 안 되면 bunker:// URL 로그인으로 우회할 수 있다
 * (그쪽은 벙커가 릴레이를 정한다).
 *
 * 고르는 기준: kind 24133(ephemeral)을 인증·결제 없이 받고 전달할 것, 그리고
 * 상시 접속하는 클라이언트에 관대할 것. 2026-10까지 쓰던 nsec.app(상시 불안정) /
 * damus / nos.lol(재접속이 잦은 IP를 차단)은 그래서 뺐다.
 * nostr.bitcoiner.social도 뺐다(2026-10-11): REQ에 EOSE를 돌려주지 않게 됐다.
 * 같은 날 primal(체감상 불안정)과 offchain.pub도 뺐다. offchain.pub은 IP당
 * 동시 연결을 1개만 받는다(실측: 둘째 소켓부터 핸드셰이크 거절) — 같은 공유기
 * 뒤의 데스크탑·폰·서명기가 한 릴레이에서 만나야 하는 랑데부엔 못 쓴다.
 * 후보를 고를 땐 왕복 전달뿐 아니라 "한 IP에서 소켓 여러 개"도 재볼 것.
 */
export const NIP46_BOOTSTRAP_RELAYS = [
  'wss://relay.wisp.talk',
  'wss://relay.ditto.pub',
  'wss://relay.coinos.io',
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
