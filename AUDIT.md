# ClipRelay 코드 감사 보고서

> 분석일: 2026-04-12  
> 최종 업데이트: 2026-04-18  
> 대상: 전체 코드베이스 (shared/, app/src/, app/src-tauri/)

---

## 요약

| 등급 | 전체 | 완료 | 잔여 | 설명 |
|------|------|------|------|------|
| CRITICAL | 2 | 1 | 1 | 즉시 수정 필요 |
| HIGH | 8 | 4 | 4 | 다음 릴리스 전 수정 권장 |
| MEDIUM | 10 | 1 | 9 | 개선 권장 |
| LOW | 4 | 0 | 4 | 참고 사항 |

---

## 1. 보안 취약점

### [H-0] 클라이언트 개인키 평문 저장 — HIGH ✅ 완료

**위치:** `app/src/store/auth-store.ts` → `tauri-plugin-store`

NIP-46 세션의 `clientPrivkey`가 tauri-plugin-store를 통해 파일시스템에 평문으로 저장된다. 이 키는 Nostr 신원키(nsec)가 아닌 bunker 통신용 클라이언트 키이므로, 탈취되더라도 bunker 세션이 활성 상태일 때만 악용 가능하다. 다만 기기 탈취 시 세션 하이재킹 위험은 존재한다.

**권장:** OS 키체인으로 마이그레이션 (macOS Keychain, Android Keystore, Windows DPAPI). TODO.md에 이미 기록되어 있으나 미구현 상태.

**완료:** `tauri-plugin-keychain`으로 마이그레이션. `clientPrivkey`는 store에 저장하지 않고 OS 키체인에 별도 보관, 메모리 캐시로 OS 프롬프트 최소화. (`81e8f24`)

---

### [C-2] 수신 이벤트 서명 미검증 — CRITICAL

**위치:** `app/src/nostr/subscribe.ts:146-158`

```typescript
const clientTag = event.tags.find(tag => tag[0] === 'client')
if (clientTag?.[1] !== CLIENT_TAG) {
  return  // client 태그만 확인, 서명 검증 없음
}
```

수신된 kind:9372 이벤트에 대해 `client` 태그만 확인하고 **이벤트 서명(sig)을 검증하지 않는다.** nostr-tools의 SimplePool이 기본적으로 서명을 검증하긴 하지만, 이는 라이브러리 구현에 의존하는 것이며 명시적 검증이 없다. 악의적 릴레이가 위조 이벤트를 주입하면 사용자 클립보드에 임의 내용이 쓰일 수 있다.

**권장:** `nostr-tools/pure`의 `verifyEvent()`로 서명을 명시적으로 검증한 후 처리.

---

### [C-3] CSP(Content Security Policy) 비활성화 — CRITICAL ✅ 완료

**위치:** `app/src-tauri/tauri.conf.json:23-25`

```json
"security": {
  "csp": null
}
```

CSP가 null로 설정되어 모든 인라인 스크립트, 외부 리소스 로딩이 허용된다. Tauri WebView가 XSS 공격에 노출될 경우 방어선이 없다.

**권장:** 최소 권한 CSP 설정: `"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:"`

**완료:** `"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src wss: https:"` 로 설정. (`df79f10`)

---

### [H-1] HTTP 접근 범위 무제한 — HIGH

**위치:** `app/src-tauri/capabilities/default.json:14-17`

```json
{ "identifier": "http:default", "allow": [{ "url": "https://**" }] }
```

모든 HTTPS 도메인에 대한 요청이 허용되어 있다. XSS 등으로 프론트엔드가 침투되면 공격자가 임의 외부 서버로 데이터를 유출할 수 있다.

**권장:** 실제 필요한 도메인 패턴만 허용 — Blossom 서버, Nostr 릴레이(wss → HTTPS 업그레이드 시), purplepag.es 등.

---

### [H-2] `hexToBytes()` 입력 검증 없음 — HIGH ✅ 완료

**위치:** `shared/src/nip46.ts:35-40`, `app/src/blossom/download.ts:14-19` (중복 구현)

```typescript
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}
```

- 홀수 길이 hex → 마지막 바이트 잘림 (경고 없음)
- 비-hex 문자(예: "ZZ") → `NaN` → Uint8Array에서 0으로 변환
- 암호화 키/IV에 사용되므로 잘못된 입력이 암호화 오류로 이어질 수 있음

추가로 동일 함수가 두 곳에 중복 구현되어 있어 한쪽만 수정 시 불일치 발생.

**권장:** shared에서 export 후 재사용. 길이/문자셋 검증 추가.

**완료:** 자체 구현 제거, `nostr-tools/utils`의 `hexToBytes` / `bytesToHex` 사용으로 전환. 중복 구현 해소. (`276ed67`)

---

### [H-3] 복호화된 페이로드 타입 미검증 — HIGH

**위치:** `app/src/nostr/subscribe.ts:60`

```typescript
payload = JSON.parse(plaintext) as ClipboardPayload
```

`as ClipboardPayload`는 런타임 검증이 아닌 TypeScript 타입 단언이다. 악의적이거나 손상된 페이로드가 들어오면 `payload.type`, `payload.content` 등이 undefined가 되어 예측 불가능한 동작이 발생한다.

**권장:** 타입 가드 함수로 런타임 검증:
```typescript
function isTextPayload(obj: unknown): obj is TextPayload {
  return typeof obj === 'object' && obj !== null && 'type' in obj && obj.type === 'text' && typeof obj.content === 'string'
}
```

---

### [H-4] Android SharedPreferences에 히스토리 평문 저장 — HIGH ✅ 완료

**위치:** `app/src-tauri/plugins/tauri-plugin-clipboard-action/android/.../ClipboardActionPlugin.kt:172-191`

ClipboardActionActivity가 복호화한 클립보드 내용을 SharedPreferences에 임시 저장한다. SharedPreferences는 앱 내부 저장소에 XML 평문으로 저장되며, 루팅된 기기에서 접근 가능하다.

**권장:** EncryptedSharedPreferences 사용 또는 메모리 내 전달 방식으로 전환.

**완료:** SharedPreferences 사용 코드 제거. `SyncBridge` 메모리 내 전달 방식으로 전환됨.

---

### [H-5] Debug 로그에 민감 데이터 노출 — HIGH ✅ 완료

**위치:** `app/src-tauri/plugins/tauri-plugin-amber/android/.../AmberPlugin.kt:115, 135, 146`

```kotlin
Log.d(TAG, "ContentProvider query: uri=$uri")
Log.d(TAG, "ContentProvider extracted: ${value?.take(80)}")
Log.e(TAG, "ContentProvider exception: ${e.javaClass.simpleName}: ${e.message} — falling back")
```

서명 요청 URI, 암호화/복호화 결과의 처음 80자가 logcat에 기록된다. 프로덕션 빌드에서도 `Log.d`는 출력되며, 같은 기기의 다른 앱이 logcat을 읽을 수 있다(Android 4.1 미만) 또는 크래시 리포트에 포함될 수 있다.

**권장:** 프로덕션 빌드에서 debug 로그 제거. `BuildConfig.DEBUG` 체크 또는 ProGuard로 strip.

**완료:** 민감 로그를 `if (BuildConfig.DEBUG)` 블록으로 감쌈. 프로덕션 빌드에서 출력되지 않음. (`be808a1`)

---

### [H-6] Intent에 암호화된 콘텐츠 전달 — HIGH

**위치:** `app/src-tauri/plugins/tauri-plugin-notification-android/android/.../NotificationPlugin.kt:58-67`

```kotlin
putExtra("encrypted_content", args.encryptedContent)
putExtra("user_pubkey", args.userPubkey)
```

NIP-44로 암호화된 콘텐츠가 Intent extras로 전달된다. Intent는 시스템 로그에 기록될 수 있고, `ClipboardActionActivity`가 `exported=true`이면 다른 앱에서 호출 가능하다.

**권장:** ClipboardActionActivity에 `android:exported="false"` 확인. Intent 대신 메모리 내 전달(SyncBridge 패턴 확장) 고려.

---

### [H-7] `decryptPayload<T>()` 제네릭 타입 미검증 — HIGH

**위치:** `shared/src/crypto.ts:34-42`

```typescript
export function decryptPayload<T>(ciphertext, privkeyHex, pubkeyHex): T {
  return JSON.parse(decrypt(ciphertext, convKey)) as T
}
```

`as T` 캐스팅으로 인해 호출자가 어떤 타입이든 받을 수 있으나 런타임 검증이 전혀 없다.

**권장:** validator 함수를 파라미터로 받거나, 반환 타입을 `unknown`으로 변경하여 호출자에게 검증 강제.

---

## 2. 성능 문제

### [M-1] `processedIds` Set 무한 증가 — 메모리 누수 — MEDIUM

**위치:** `app/src/nostr/subscribe.ts:127`

```typescript
const processedIds = new Set<string>()
```

중복 이벤트 방지를 위한 Set이 앱 실행 중 계속 커진다. 구독이 재시작되지 않는 한 이벤트 ID가 쌓이며, 장시간 실행 시 메모리를 점진적으로 소모한다.

**권장:** 최대 크기 제한(예: 1000개) 후 가장 오래된 항목 삭제. 또는 구독 재시작 시 Set 초기화(현재 구현에서는 함수 스코프이므로 재시작 시 자동 초기화됨 — 재시작 없이 장기 실행 시에만 문제).

---

### [M-2] 릴레이 상태 5초 폴링 — MEDIUM

**위치:** `app/src/pages/Main.tsx` (POLL_INTERVAL_MS = 5000 추정)

릴레이 연결 상태를 5초마다 폴링하여 `pool.ensureRelay()` → `relay.connected` 확인. 릴레이 수 × 12회/분의 불필요한 호출이 발생한다.

**권장:** 폴링 주기를 30초로 늘리거나, SimplePool의 연결 이벤트를 감지하는 방식으로 전환.

---

### [M-3] 릴레이 변경 시 연쇄 재구독 — MEDIUM

**위치:** `app/src/App.tsx:117-121`

```typescript
startBlossomDiscovery(userPubkey, relays)
startProfileDiscovery(userPubkey, relays)
restartClipboardSubscription(userPubkey)
```

kind:10002 이벤트 수신 시 3개 구독이 동시에 재생성된다. 릴레이 목록이 빠르게 여러 번 변경되면(여러 릴레이에서 같은 이벤트 수신) 구독이 중첩 생성될 수 있다.

**권장:** 릴레이 변경을 debounce(300ms 등)하여 한 번만 재구독.

---

### [M-4] `publishClipboard()` 타임아웃 없음 — MEDIUM

**위치:** `app/src/nostr/publish.ts:58`

```typescript
const results = await Promise.allSettled(pool.publish(writeRelays, event))
```

느린 릴레이가 있으면 전체 발행이 무기한 대기할 수 있다.

**권장:** 각 릴레이 발행에 타임아웃(예: 10초) 적용.

---

### [M-5] Android Amber ContentProvider 타임아웃 없음 — MEDIUM

**위치:** `app/src-tauri/plugins/tauri-plugin-amber/android/.../AmberPlugin.kt:112-149`

```kotlin
Thread {
    val cursor = activity.contentResolver.query(uri, projection, null, null, null)
    // 무기한 블로킹 가능
}.start()
```

Amber 앱이 응답하지 않으면 백그라운드 스레드가 영원히 블로킹된다.

**권장:** Kotlin coroutines + `withTimeout()` 사용.

---

### [M-6] Process.killProcess() 사용 — MEDIUM

**위치:** `app/src-tauri/plugins/tauri-plugin-foreground-service/android/.../ClipboardSyncService.kt:49`

```kotlin
android.os.Process.killProcess(android.os.Process.myPid())
```

알림 스와이프 시 프로세스를 강제 종료한다. 진행 중인 암호화 작업, 파일 쓰기, 구독 정리가 완료되지 않을 수 있다.

**권장:** `stopSelf()` 후 Android가 자연스럽게 프로세스를 회수하도록 두거나, `System.exit(0)`보다는 Activity.finishAffinity() 후 stopSelf() 패턴 사용.

---

## 3. Race Condition

### [H-8] isPublishingRef 경합 — HIGH (보안과 겹침)

**위치:** `app/src/App.tsx:244-287`

```typescript
if (isAndroid() && !isPublishingRef.current) {
  isPublishingRef.current = true
  try {
    // Amber intent 동안 visibilitychange가 여러 번 발생할 수 있음
  } finally {
    isPublishingRef.current = false
  }
}
```

Android에서 Amber intent 호출 시 visibilitychange가 빠르게 연속 발생한다. `isPublishingRef`가 true로 설정되기 전에 두 번째 이벤트가 진입할 수 있는 미세한 창이 존재한다. (실제로는 JS 싱글스레드이므로 동일 tick 내에서는 안전하나, await 이후 다른 visibilitychange가 처리될 수 있음.)

**결과:** 동일 클립보드 내용이 중복 발행될 수 있다.

**권장:** AbortController 또는 발행 전 내용 비교로 이중 방어.

---

### [M-7] 헬스체크 + visibilitychange 쿨다운 공유 — MEDIUM

**위치:** `app/src/App.tsx:233-239, 300-308`

15초 주기 헬스체크와 visibilitychange 핸들러가 같은 `lastSubRestartRef`로 10초 쿨다운을 공유한다. 두 경로가 거의 동시에 발동하면 쿨다운이 서로를 무효화하여 짧은 시간 내 이중 재시작이 발생할 수 있다.

**권장:** 각 경로에 독립 쿨다운 사용, 또는 재시작 함수 자체에 mutex 추가.

---

### [M-8] SyncBridge @Volatile 경합 — MEDIUM

**위치:** `app/src-tauri/plugins/tauri-plugin-clipboard-action/android/.../SyncBridge.kt:11-16`

```kotlin
@Volatile var pendingCopy: Boolean = false
@Volatile var pendingNotificationId: Int = -1
```

두 필드가 원자적으로 업데이트되지 않는다. `pendingCopy = true` 설정 후 `pendingNotificationId` 설정 전에 다른 스레드가 읽으면 불일치 상태가 된다.

**권장:** `AtomicReference<Pair<Boolean, Int>>` 사용 또는 synchronized 블록.

---

## 4. UX 개선점

### [L-1] QR 로그인 타임아웃 안내 부재 — LOW

**위치:** `app/src/pages/Login.tsx`

5분 타임아웃이 있으나 사용자에게 남은 시간이 표시되지 않는다. 타임아웃 후 무슨 일이 일어났는지 명확하지 않을 수 있다.

**권장:** 카운트다운 타이머 표시 또는 만료 시 명확한 메시지.

---

### [L-2] 발행/다운로드 실패 시 사용자 피드백 부족 — LOW

**위치:**
- `app/src/App.tsx:155` — 텍스트 발행 실패: `console.error`만
- `app/src/App.tsx:170` — 이미지 발행 실패: `console.error`만
- `app/src/nostr/subscribe.ts:78-80` — 클립보드 쓰기 실패: `console.error`만

사용자는 동기화가 실패했는지 알 수 없다. 성공 토스트는 뜨지만 실패 토스트가 없는 경로가 있다.

**권장:** 모든 발행/수신 실패 경로에 error 토스트 추가.

---

### [L-3] 알림 ID 오버플로우 — LOW

**위치:** `app/src-tauri/plugins/tauri-plugin-notification-android/android/.../NotificationPlugin.kt:43`

```kotlin
private var nextNotificationId = 100
```

`nextNotificationId`가 `Int.MAX_VALUE`를 넘으면 오버플로우. 현실적으로 21억 회 이상의 알림 후에나 발생하지만 방어 코드가 없다.

**권장:** 최소한 overflow 방어 또는 순환 범위(100-10000) 사용.

---

### [L-4] requestNotificationPermission 비동기 결과 미대기 — LOW

**위치:** `app/src-tauri/plugins/tauri-plugin-foreground-service/android/.../ForegroundServicePlugin.kt`

`ActivityCompat.requestPermissions()` 호출 후 결과를 기다리지 않고 즉시 `invoke.resolve()` 한다. 호출자는 권한이 실제로 부여되었는지 알 수 없다.

**권장:** `onRequestPermissionsResult` 콜백에서 resolve.

---

## 5. 코드 품질

### [M-9] `hexToBytes()` 중복 구현 ✅ 완료

**위치:** `shared/src/nip46.ts:35-40` + `app/src/blossom/download.ts:14-19`

동일한 함수가 두 곳에 존재. 한쪽에 버그 수정 시 다른 쪽에 적용되지 않을 위험.

**권장:** shared에서 단일 export.

**완료:** H-2와 동일 커밋에서 해소. `nostr-tools/utils`로 통일. (`276ed67`)

---

### [M-10] 다수의 unsafe `as` 타입 단언

**위치:**
- `shared/src/crypto.ts:41` — `JSON.parse(...) as T`
- `app/src/nostr/subscribe.ts:60` — `as ClipboardPayload`
- `app/src/blossom/upload.ts:125` — `as { url: string; sha256: string }`
- `app/src/blossom/download.ts:34,40,42` — `as ArrayBuffer`

TypeScript strict 모드에서도 `as` 캐스팅은 런타임 안전성을 보장하지 않는다.

**권장:** 외부 데이터(JSON.parse, fetch 응답)에는 타입 가드 또는 zod 등 런타임 검증 사용.

---

## 우선순위별 정리

### P0 — 즉시 수정
| ID | 제목 | 상태 |
|----|------|------|
| C-2 | 수신 이벤트 서명 미검증 → verifyEvent() 추가 | 미완료 |
| C-3 | CSP 비활성화 → strict CSP 설정 | ✅ 완료 |

### P1 — 다음 릴리스 전
| ID | 제목 | 상태 |
|----|------|------|
| H-0 | 클라이언트 개인키 평문 저장 → OS 키체인 | ✅ 완료 |
| H-1 | HTTP 접근 범위 제한 | 미완료 |
| H-2 | hexToBytes 검증 + 중복 제거 | ✅ 완료 |
| H-3 | 복호화 페이로드 런타임 타입 검증 | 미완료 |
| H-4 | SharedPreferences 암호화 | ✅ 완료 |
| H-5 | 프로덕션 debug 로그 제거 | ✅ 완료 |
| H-6 | Intent extras 민감 데이터 제거 | 미완료 |
| H-7 | decryptPayload 제네릭 안전성 | 미완료 |
| H-8 | 발행 경합 방어 | 미완료 |

### P2 — 개선
| ID | 제목 | 상태 |
|----|------|------|
| M-1 ~ M-8, M-10 | 메모리 누수, 폴링 최적화, debounce, 타임아웃, 코드 품질 | 미완료 |
| M-9 | hexToBytes 중복 구현 제거 | ✅ 완료 |

### P3 — 참고
| ID | 제목 | 상태 |
|----|------|------|
| L-1 ~ L-4 | UX 피드백, 오버플로우 방어, 알림 권한 | 미완료 |
