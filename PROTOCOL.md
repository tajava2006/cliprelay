# ClipRelay Nostr Protocol Specification

모든 플랫폼이 공통으로 참조하는 Nostr 이벤트 프로토콜 명세.

## 시스템 개요

```
사용자 기기 A ──[kind:9372 암호화 발행]──▶ 릴레이 ──▶ 사용자 기기 B (구독 중)
                                                      ↓ 복호화
                                               기기 B 클립보드 업데이트
```

모든 이벤트의 author는 **사용자 자신의 pubkey**이다.
콘텐츠는 **NIP-44 자기암호화**로 암호화되어 릴레이에 저장된다.

## 사용하는 NIPs / BUDs

| NIP / BUD | kind | 역할 |
|-----------|------|------|
| NIP-65 | `10002` | 사용자 릴레이 목록 |
| Blossom BUD-03 | `10063` | 사용자 Blossom 서버 목록 |
| NIP-78 | `30078` | 앱 설정 저장 |
| NIP-44 | — | 암호화 (ChaCha20, v2) |
| NIP-46 | `24133` | 원격 서명 (bunker) |
| Blossom BUD-02 | — | 파일 업로드/다운로드 |
| Blossom BUD-11 | `24242` | Blossom 업로드 인증 |
| **kind:9372** | `9372` | **클립보드 이벤트** (본 앱 정의) |

> **kind:9372 선택 근거**: kind:9000~9022는 NIP-29(그룹 관리), 9041은 ZapGoal, 9734/9735는 Zap, 9802는 Highlights로 이미 등록되어 있다. 9372는 현재 어떤 NIP에도 등록되지 않은 비어있는 kind이며, 이벤트에 `client` 태그를 포함해 앱 소속을 명시한다.

---

## 릴레이 디스커버리 (NIP-65)

### 읽는 이벤트: kind:10002

앱 초기화 시 사용자의 `kind:10002` 이벤트를 구독한다.

```jsonc
{
  "kind": 10002,
  "pubkey": "<user_pubkey>",
  "tags": [
    ["r", "wss://relay1.example.com"],           // read + write
    ["r", "wss://relay2.example.com", "read"],   // read only
    ["r", "wss://relay3.example.com", "write"]   // write only
  ]
}
```

### 릴레이 선택 원칙

| 동작 | 대상 릴레이 |
|------|------------|
| 클립보드 이벤트 **발행** | 사용자의 **write** 릴레이 전체 |
| 클립보드 이벤트 **구독** | 사용자의 **write** 릴레이 전체 |
| kind:10002 변경 **구독** | 현재 연결된 모든 릴레이 |

> read 릴레이는 남이 나에게 보내는 이벤트(멘션, DM 등)가 저장되는 공간이다.
> 클립보드 이벤트는 나만 발행하고 나만 읽으므로 write 릴레이만 사용한다.

### 변경 감지

`kind:10002`는 replaceable event이므로 `since: last_seen_created_at`으로 변경을 감지한다.
변경 감지 시 릴레이 풀을 즉시 재구성한다.

---

## Blossom 서버 디스커버리 (BUD-03)

### 읽는 이벤트: kind:10063

```jsonc
{
  "kind": 10063,
  "pubkey": "<user_pubkey>",
  "tags": [
    ["server", "https://blossom.primal.net"],
    ["server", "https://cdn.satellite.earth"]
  ]
}
```

- 첫 번째 서버를 우선 사용한다.
- 업로드 실패 시 다음 서버로 폴백한다.
- kind:10063이 없으면 잘 알려진 공개 Blossom 서버를 임시 사용하고, 사용자에게 서버 설정을 안내한다.

---

## 암호화: NIP-44 자기암호화

클립보드 이벤트의 content는 **항상** 암호화한다. 암호화 실패 시 발행하지 않는다.

### Conversation Key 계산

```ts
// 자기 자신의 pubkey를 상대방으로 사용
const conversationKey = nip44.getConversationKey(userPrivKey, userPubKey)
```

- `get_conversation_key(privA, pubA)` — 자기 자신과의 ECDH로 결정론적이고 수학적으로 유효하다.
- 오직 해당 개인키 보유자만 복호화 가능하다.

---

## 클립보드 이벤트: kind:9372

### 텍스트 클립보드

```jsonc
{
  "kind": 9372,
  "pubkey": "<user_pubkey>",
  "content": "<nip44_encrypted(payload)>",
  "tags": [
    ["client", "cliprelay"]   // 릴레이 인덱싱 없음. kind 충돌 시 로컬 필터링용
  ],
  "created_at": 1700000000
}
```

**암호화 전 payload (JSON 문자열)**:

```jsonc
{
  "type": "text",
  "content": "복사된 텍스트 내용"
}
```

### 파일 클립보드

파일은 먼저 NIP-44로 암호화한 바이너리를 Blossom 서버에 업로드하고, sha256과 URL을 payload에 담는다.
sha256은 **암호화된 바이너리** 기준으로 계산한다.

```jsonc
{
  "kind": 9372,
  "pubkey": "<user_pubkey>",
  "content": "<nip44_encrypted(payload)>",
  "tags": [
    ["client", "cliprelay"]   // 릴레이 인덱싱 없음. kind 충돌 시 로컬 필터링용
  ]
}
```

**암호화 전 payload**:

```jsonc
{
  "type": "file",
  "sha256": "b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553",
  "url": "https://blossom.primal.net/b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553",
  "mimeType": "image/png",
  "filename": "screenshot.png",
  "size": 204800
}
```

> `size`는 암호화 전 원본 파일 크기 (bytes).

### 수신 처리 규칙

1. NIP-44 복호화. 복호화 실패 시 조용히 무시 (다른 앱이 같은 kind를 사용하는 경우 대비).
2. payload JSON 파싱.
3. `type === "text"` → 클립보드에 텍스트 삽입.
4. `type === "file"` → Blossom URL에서 암호화 바이너리 다운로드 → NIP-44 복호화 → 클립보드에 파일 삽입.

### 구독 필터

```jsonc
{
  "kinds": [9372],
  "authors": ["<user_pubkey>"],
  "since": "<last_processed_created_at>"
}
```

릴레이 쿼리는 `kinds` + `authors`만으로 충분하다. 수신 후 로컬에서 `client === "cliprelay"` 여부를 확인해 우연한 kind 충돌을 방어한다. `t` 태그는 릴레이가 인덱싱하므로 사용하지 않는다.

---

## 앱 설정: kind:30078 (NIP-78)

앱 설정을 Nostr에 저장해 기기 간 설정을 공유한다.

```jsonc
{
  "kind": 30078,
  "content": "<nip44_encrypted(settings_json)>",
  "tags": [
    ["d", "cliprelay-settings"]
  ]
}
```

**settings_json 예시**:

```jsonc
{
  "sync_files": true,
  "max_file_size_mb": 10
}
```

---

## Blossom 파일 업로드 흐름 (BUD-02 + BUD-11)

```
1. 파일을 NIP-44로 암호화 → 암호화된 바이너리의 SHA256 계산
2. kind:24242 (Authorization) 이벤트 생성 및 NIP-46으로 서명 요청
   {
     "kind": 24242,
     "content": "Upload <filename>",
     "tags": [
       ["t", "upload"],
       ["x", "<sha256_of_encrypted_binary>"],
       ["expiration", "<now + 60>"]
     ]
   }
3. PUT /upload 요청 (Authorization: Nostr <base64(kind:24242)>)
4. 업로드 성공 → sha256, url을 kind:9372 payload에 포함
```

---

## NIP-46 (Remote Signing) 흐름

### 초기 연결

두 가지 방식을 지원한다:

**QR코드 방식** (권장):
1. 앱이 임시 `client-keypair` 생성 → `nostrconnect://` URI 생성
2. QR코드로 렌더링 → 사용자가 bunker 앱(예: Amber)으로 스캔
3. bunker가 `connect` 응답 발행 → 앱이 `remote-signer-pubkey` 확인
4. `get_public_key` 요청 → `user_pubkey` 확인 및 로컬 저장

**bunker URL 직접 입력** (대안):
1. 사용자가 `bunker://<remote-signer-pubkey>?relay=<url>&secret=<secret>` 입력
2. 앱이 `connect` 요청 발행 → bunker 응답 수신
3. `get_public_key` 요청 → `user_pubkey` 확인 및 로컬 저장

`client-keypair`는 로컬에 저장해 재시작 시 재사용한다.
재연결 시 새 connect 요청 없이 기존 키페어로 바로 서명 요청을 보낸다.

### 서명 위임

클립보드 이벤트(kind:9372), Blossom 인증(kind:24242), 설정(kind:30078) 모두 NIP-46을 통해 서명 위임.

---

## 이벤트 Kind 요약

| Kind | 이름 | 역할 | 발행자 |
|------|------|------|--------|
| `9372` | Clipboard Item | 클립보드 동기화 이벤트 | 나 |
| `10002` | Relay List | 사용 릴레이 목록 (NIP-65) | 나 (외부 설정) |
| `10063` | Blossom Server List | 사용 Blossom 서버 목록 | 나 (외부 설정) |
| `24133` | NIP-46 Request | 서명 위임 요청 | 앱 client key |
| `24242` | Blossom Auth | Blossom 업로드 인증 | 나 (NIP-46 서명) |
| `30078` | App Settings | 앱 설정 저장 (NIP-78) | 나 |

---

## 미래 기능: 히스토리

kind:9372는 일반 이벤트(교체되지 않음)이므로 author의 전체 이력 조회가 가능하다.

```jsonc
{
  "kinds": [9372],
  "authors": ["<user_pubkey>"],
  "limit": 100
}
```

릴레이가 삭제한 이벤트는 복구할 수 없으므로,
장기 히스토리가 필요하면 수신 즉시 로컬 DB에 저장하는 방식으로 보완한다.
