# ClipRelay 시스템 아키텍처

## 개요

내 제어하에 있는 기기들의 클립보드를 Nostr 릴레이를 통해 실시간으로 동기화한다.
복사(Ctrl+C)를 하면 암호화된 이벤트가 릴레이에 발행되고,
다른 기기는 릴레이를 구독하다가 이를 수신해 클립보드에 자동으로 붙여넣는다.

```
[기기 A]                           [Nostr 릴레이]             [기기 B]
 ┌──────────────────┐               ┌──────────┐               ┌──────────────────┐
 │ 클립보드 모니터   │               │          │               │ 릴레이 구독자     │
 │ (Ctrl+C 감지)    │──암호화 발행──▶│  relay   │──수신 알림──▶ │ (WS 유지)         │
 └──────────────────┘               │          │               └────────┬─────────┘
                                    └──────────┘                        │ 복호화 후
                                                                        ▼
                                                               [기기 B 클립보드]
```

## 데이터 흐름

### 복사 시 (발행)

```
OS 클립보드 변경 감지
       ↓
콘텐츠 타입 판별 (텍스트 / 파일)
       ↓
  ┌────┴────┐
  텍스트    파일
  ↓         ↓
  (없음)    Blossom 서버에 암호화된 바이너리 업로드 (BUD-02)
            → sha256 hash 획득
  ↓         ↓
NIP-44 자기암호화 (payload JSON → ciphertext)
  ↓
kind:9372 이벤트 생성
  ↓
사용자의 kind:10002 에서 읽은 write 릴레이에 발행
```

> **파일 업로드 암호화**: Blossom 서버에는 평문 바이너리가 아닌 NIP-44로 암호화된 바이너리를 업로드한다.
> sha256은 암호화된 바이너리 기준으로 계산한다. 수신 측은 다운로드 후 NIP-44 복호화를 수행한다.

### 수신 시 (구독)

```
릴레이에서 kind:9372 이벤트 수신
       ↓
NIP-44 복호화
       ↓
  ┌────┴────┐
  텍스트    파일 (sha256 + blossom URL 포함)
  ↓         ↓
클립보드 설정   Blossom 서버에서 암호화 바이너리 다운로드
            → NIP-44 복호화
            → 클립보드에 파일 삽입
```

### 앱 초기화 흐름

```
NIP-46 bunker 연결 (QR코드 또는 bunker URL 직접 입력)
       ↓
client-keypair 생성 → 로컬 저장 (재시작 시 재사용)
       ↓
get_public_key 요청 → user_pubkey 확인 및 로컬 저장
       ↓
kind:10002 구독 → 사용 릴레이 목록 로컬 저장
       ↓
kind:10063 구독 → 사용 Blossom 서버 목록 로컬 저장
       ↓
kind:9372 구독 시작 (author=나의 pubkey)
       ↓
kind:10002, kind:10063 변경 이벤트 구독 유지 (릴레이/서버 목록 갱신 대비)
```

## 플랫폼별 구현

### 데스크탑 (Mac / Windows / Linux)

| 항목 | 내용 |
|------|------|
| 형태 | GUI 앱 + 시스템 트레이 (항상 백그라운드 실행) |
| 클립보드 감시 | OS 클립보드 폴링 또는 네이티브 훅 |
| 실시간 동기화 | 가능 (항상 실행 중) |
| 인증 | 최초 실행 시 QR코드 또는 bunker URL 입력, client-keypair 로컬 저장 |
| 히스토리 뷰어 | 앱 내 탭/패널로 통합 |
| 파일 지원 | 가능 (이미지, 바이너리 등) |

기술 스택: Tauri v2 (Rust + WebView). Nostr/암호화 로직은 전부 TS(WebView)에서 동작하고 Rust는 OS API 브릿지 역할만 한다.

트레이 아이콘으로 동기화 상태(연결됨/끊김)를 확인할 수 있으며, 클릭 시 히스토리 창이 열린다.

### Android (Tauri Mobile)

데스크탑과 동일한 TS/React 코드를 WebView에서 공유하고, Android 전용 기능은 Kotlin Tauri 플러그인으로 구현한다.

```
┌─────────────────────────────────┐
│   WebView (TS/React)            │  ← 데스크탑과 공유: UI, 릴레이 연결, 암호화, Blossom
├─────────────────────────────────┤
│   Rust (Tauri Core)             │  ← TS ↔ Kotlin 브릿지
├─────────────────────────────────┤
│   Kotlin 플러그인               │  ← Android 전용 기능
├─────────────────────────────────┤
│   Android OS                    │
└─────────────────────────────────┘
```

#### 클립보드 제약

Android 10(API 29)+ 에서 백그라운드 앱은 클립보드에 접근할 수 없다. 클립보드 조작이 필요한 시점에 반드시 포그라운드 전환이 필요하다. 이를 위해 투명 Activity(`ClipboardActionActivity`)가 포그라운드를 획득하여 조작 후 즉시 `finish()`한다. 앱(MainActivity)은 켜지지 않는다.

#### 데이터 흐름 (Android)

**발신**: TS에서 클립보드 읽기 → `plugin-clipboard-action`의 `readClipboardText()` / `readClipboardImage()` → 암호화 → 발행

**수신**: `NativeRelayClient`(OkHttp WebSocket)가 이벤트 수신 → eventQueue에 적재 → 앱이 포그라운드면 TS가 `consumeNativeEvents()`로 소비하여 직접 처리, 백그라운드면 수신 알림 표시 → 알림 탭 → `ClipboardActionActivity`가 Amber에 직접 nip44_decrypt 요청 → 클립보드 쓰기

#### Kotlin 플러그인 목록

| 플러그인 | 주요 커맨드 |
|---------|------------|
| `plugin-foreground-service` | `startService()`, `stopService()`, `isRunning()`, `startNativeSubscription()`, `stopNativeSubscription()`, `consumeNativeEvents()`, `setAppForeground()`, `getPermissionStatus()`, `requestNotificationPermission()`, `requestBatteryExemption()`, `requestReceiverChannelHigh()` |
| `plugin-amber` | `isInstalled()`, `getPublicKey()`, `signEvent()`, `nip44Encrypt()`, `nip44Decrypt()` |
| `plugin-notification-android` | `showReceived(body, encryptedContent, userPubkey)`, `dismiss(id)` |
| `plugin-clipboard-action` | `readClipboardText()`, `readClipboardImage()`, `writeImageToClipboard()`, `consumePendingCopy()` |
| `plugin-keychain` | `setSecret()`, `getSecret()`, `deleteSecret()` |

#### ClipboardSyncService (Foreground Service)

- `START_STICKY` — OS가 kill해도 자동 재시작
- `PARTIAL_WAKE_LOCK` + `WIFI_MODE_FULL_HIGH_PERF` — 화면 꺼져도 CPU/WiFi 유지
- 상시 알림을 스와이프하면 서비스 + 앱 완전 종료
- `NativeRelayClient`(OkHttp) 내장 — WebView JS와 독립적인 네이티브 WebSocket으로 릴레이 구독

#### NativeRelayClient

OkHttp 기반 WebSocket 클라이언트. WebView가 throttle되거나 일시 중단되어도 Foreground Service + WakeLock 아래에서 릴레이 연결을 유지한다. kind:9372 + `client=cliprelay` 태그만 필터링한다.

#### WebView keepalive

`ForegroundServicePlugin`이 25초마다 `evaluateJavascript("1")`을 호출하여 Android가 WebView의 JS 타이머/WebSocket을 throttle하지 못하게 한다.

#### 네트워크 변경 감지

`ForegroundServicePlugin`이 `ConnectivityManager.NetworkCallback`을 등록하여 WiFi↔모바일 전환, 네트워크 복구 시 `network-changed` 이벤트를 TS에 전달 → WebSocket 즉시 재연결.

#### 알림 채널

| 채널 ID | 용도 | 중요도 |
|--------|------|--------|
| `clipboard_sync_v2` | 포그라운드 서비스 상시 알림 | 낮음 (소리/진동 없음) |
| `clipboard_received` | 클립보드 수신 알림 | 높음 (소리 있음) |

#### Amber (NIP-55 + NIP-46)

`plugin-amber`는 NIP-55 Content Provider(`contentResolver.query()`)를 먼저 시도하고, 권한 없음 또는 실패 시 Intent로 폴백한다. Amber 미설치 시 BunkerSigner(NIP-46)로 폴백.

#### plugin-keychain

Android Keystore 기반 `EncryptedSharedPreferences`(AES-256-GCM)로 민감 정보를 저장한다. 앱 서명 키에 바인딩되므로 다른 앱에서 접근 불가.

### iOS — 스코프 외

| 플랫폼 | 백그라운드 클립보드 모니터 | 비고 |
|--------|--------------------------|------|
| iOS | ❌ 불가 | OS 정책. "열면 동기화" 수준이 최선 |

## 프로세스 배치

ClipRelay는 **"여러 UI가 Nostr 데이터를 소비하는 뷰어"가 아니라 클립보드 싱크 루프**이므로, UI/스토어/서비스의 3층 분리 같은 구조는 쓰지 않는다. 장수하는 주체는 "릴레이 연결"과 "클립보드 모니터" 뿐이며, 이 둘의 배치만 플랫폼별로 다르다.

### 데스크탑

WebView(JS) 단일 프로세스에서 전부 수행한다. 클립보드 모니터, 릴레이 풀(SimplePool), NIP-46 서명 위임, UI가 같은 V8 힙을 공유한다. Rust/Tauri는 OS API 브릿지에 불과하다.

```
┌─────────────────────────────────────────────┐
│  WebView (JS)                               │
│   ┌──────────┬──────────┬───────────┐       │
│   │ UI       │ 싱크 루프 │ 릴레이 풀 │       │
│   └──────────┴──────────┴───────────┘       │
│          │  @tauri-apps/plugin-*            │
├─────────────────────────────────────────────┤
│  Rust (Tauri) — clipboard / tray / store    │
└─────────────────────────────────────────────┘
```

### Android

WebView JS가 throttle되면 릴레이 WebSocket이 끊기므로 **Kotlin Foreground Service가 독립적으로 WebSocket을 보유**한다. 수신 암호문은 서비스의 네이티브 큐에 쌓였다가, 앱이 포그라운드면 WebView로 pull되고, 백그라운드면 알림 → 투명 Activity → Amber 복호화 → 클립보드 쓰기 루트를 탄다.

```
┌─────────────────────────────────────────────┐
│  WebView (JS) — 포그라운드일 때만 활성       │
│    UI / 암호화·발행 / 큐 소비                 │
├─────────────────────────────────────────────┤
│  Kotlin Foreground Service (장수)           │
│    NativeRelayClient (OkHttp WS)            │
│    WakeLock · WiFiLock · WebView keepalive  │
│    eventQueue                               │
├─────────────────────────────────────────────┤
│  ClipboardActionActivity (투명, 단발)        │
│    알림 탭 시 → Amber nip44_decrypt → 쓰기   │
└─────────────────────────────────────────────┘
```

### JS 모듈 배치

플랫폼 공통 JS는 역할별 디렉토리로만 분리하며, 억지로 "서비스 클래스" 계층을 두지 않는다.

| 디렉토리 | 역할 |
|---------|------|
| `nostr/` | SimplePool 래퍼, 발행/구독, 디스커버리 구독 (kind:10002 / 10063 / 0) |
| `clipboard/` | OS 클립보드 모니터, 쓰기 |
| `blossom/` | BUD-02 업로드/다운로드 (AES-GCM 포함) |
| `platform/` | 플랫폼 감지, UniversalSigner, Android 전용 네이티브 브릿지 |
| `store/` | 단순 영속화(Tauri Store). 설정·히스토리·릴레이/Blossom 목록·auth 저장 |

## 기술 스택 선택

### Tauri v2 선택 이유

| | Tauri v2 | Electron |
|--|---------|---------|
| 번들 크기 | ~5MB | ~150MB |
| 메모리 | 시스템 WebView 사용 | Chromium 내장 |
| 클립보드/트레이 | 플러그인 제공 | 내장 API |
| 백엔드 언어 | Rust | Node.js |

Nostr 로직(nostr-tools, NIP-44, NIP-46)은 전부 TypeScript 프론트엔드(WebView)에서 동작한다.
Rust는 클립보드/트레이 같은 OS API를 Tauri 플러그인으로 연결하는 역할만 하므로 직접 Rust 코드를 작성할 일이 거의 없다.

## 우려사항 및 리스크

### 1. 암호화 실패 시 발행 금지

암호화가 실패하면 **절대 발행하지 않는다**. 예외 없이 에러로 처리한다.

### 2. NIP-44 자기암호화의 한계

NIP-44는 forward secrecy가 없다. 개인키 유출 시 과거 이력 전부 복호화 가능.
릴레이가 이벤트를 얼마나 보관하느냐에 따라 노출 범위가 달라진다.
이는 알려진 트레이드오프이며 수용한다.

### 3. 릴레이/Blossom 서버 가용성

릴레이나 Blossom 서버가 데이터를 삭제하는 것은 예상된 동작이다.
이미 동기화가 완료된 데이터는 로컬에 있으므로 서비스 품질 문제이지 데이터 유실은 아니다.
향후 자체 서버 운영(유료) 시 더 안정적인 보장 가능.

### 4. Blossom 인증 레이턴시 (파일)

파일 업로드 시 NIP-46으로 kind:24242 서명 요청이 필요하다.
bunker 응답 대기 시간이 추가되므로 파일 동기화는 텍스트보다 느리다. 수용한다.

### 5. iOS 실시간 동기화 불가 (Phase 2)

iOS는 구조적으로 백그라운드 클립보드 감시가 불가능하다.
"앱을 열면 동기화"를 기본 UX로 수용한다.
