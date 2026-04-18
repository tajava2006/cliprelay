# Android 앱 (Tauri Mobile) — 아키텍처 참조

## 아키텍처

```
┌─────────────────────────────────┐
│   WebView (TS/React)            │  ← 데스크탑과 공유: UI, 릴레이 연결,
│   shared/ 모듈 그대로 사용        │     암호화, 구독, 발행, Blossom
├─────────────────────────────────┤
│   Rust (Tauri Core + 플러그인)   │  ← 브릿지: TS ↔ Kotlin 연결
├─────────────────────────────────┤
│   Kotlin (Android 전용 기능)     │  ← Foreground Service, 알림,
│                                 │     투명 Activity, Amber Intent,
│                                 │     ClipboardManager
├─────────────────────────────────┤
│   Android OS                    │
└─────────────────────────────────┘
```

### 데스크탑과의 차이점

| 항목 | 데스크탑 | Android |
|------|---------|---------|
| 발신 | Ctrl+C → 자동 감지 → 발신 | 복사 → 알림바 "동기화" 버튼 탭 → 발신 |
| 수신 | 자동 수신 → 클립보드 자동 갱신 | 자동 수신 → 알림 표시 → 알림 탭 → 클립보드 갱신 |
| 백그라운드 | 시스템 트레이 (항상 실행) | Foreground Service (항상 실행) |
| 인증 | NIP-46 (QR코드 + bunker URL) | NIP-46 (Amber Intent 연동 + bunker URL) |
| 클립보드 접근 | 언제든 가능 | 포그라운드에서만 가능 (Android 10+) |

### 코드 재사용 전략

| 계층 | 재사용 | 설명 |
|------|--------|------|
| `shared/` 모듈 | **100%** | 타입, 상수, 릴레이/Blossom/프로필 디스커버리 |
| 릴레이 연결 (nostr-tools SimplePool) | **100%** | WebView 내 TS에서 동작 |
| NIP-44 암호화/복호화 | **부분** | 데스크탑은 BunkerSigner 경유, Android는 Amber Intent 경유 |
| Blossom 업로드/다운로드 | **100%** | TS fetch로 동작 |
| 파일 암호화 | **100%** | Web Crypto API |
| 클립보드 모니터 | **0%** | Android는 폴링 불가, 알림 버튼 방식으로 대체 |
| UI (React) | **80%** | Login, Main, History 레이아웃 유사. 모바일 최적화 필요 |
| 로컬 저장소 | **100%** | Tauri Store 플러그인 동일 사용 |

### Android 클립보드 제약

Android 10(API 29)부터 백그라운드 앱의 클립보드 읽기/쓰기가 차단된다.
클립보드 접근이 필요한 시점에 반드시 포그라운드 전환이 필요하다.

**발신**: 알림바 "동기화" 버튼 탭 → 투명 Activity 포그라운드 전환 → 클립보드 읽기 → TS 전달 → 암호화 → 발행 → Activity 종료

**수신**: WebSocket 이벤트 수신 → 알림 표시 → 알림 자체를 탭 → 투명 Activity 포그라운드 전환 → Amber nip44_decrypt → 클립보드 쓰기 → Activity 종료

투명 Activity(`Theme.Translucent.NoTitleBar`)가 포그라운드를 획득해서 클립보드를 조작하고 즉시 `finish()`한다.
Amber 복호화도 투명 Activity에서 직접 Intent를 발사한다. **앱(MainActivity)은 켜지지 않는다.**

---

## 기술 스택

| 항목 | 선택 |
|------|------|
| 프레임워크 | Tauri 2 (Mobile) |
| WebView 로직 | TypeScript + React (데스크탑과 공유) |
| Nostr 라이브러리 | nostr-tools (데스크탑과 동일) |
| 암호화 | Web Crypto API, BunkerSigner/Amber (NIP-44) |
| HTTP | TS fetch (Blossom 업/다운로드) |
| 로컬 저장소 | Tauri Store 플러그인 |
| Foreground Service | Kotlin (Tauri 플러그인으로 래핑) |
| 알림 | Kotlin (Tauri 플러그인으로 래핑) |
| 투명 Activity | Kotlin (포그라운드 전환용) |
| 클립보드 읽기/쓰기 | Kotlin (Tauri 플러그인으로 래핑) |
| NIP-46 (Amber) | Kotlin Intent (Tauri 플러그인으로 래핑) |
| 빌드 | Gradle (Kotlin DSL) + Tauri CLI |

---

## Tauri 플러그인 목록 (Kotlin 브릿지)

Android 전용 기능을 TS에서 호출하기 위해 Tauri 플러그인으로 감싼다.
각 플러그인은 Rust 레이어에서 Kotlin을 호출하는 브릿지 역할을 한다.

### 1. `plugin-clipboard-android`
- `readText()` → String | null
- `writeText(text)` → void
- `readImage()` → Uint8Array | null
- `writeImage(bytes)` → void
- **제약**: 투명 Activity가 포그라운드일 때만 호출 가능

### 2. `plugin-foreground-service`
- `startService()` → void
- `stopService()` → void
- `isRunning()` → boolean
- Service 내부에서 WebSocket 유지 (TS 측 SimplePool이 담당)
- `START_STICKY` 반환 → OS가 죽여도 재시작

### 3. `plugin-notification-android`
- `showPersistent(title, body, actions)` → void — 상시 알림
- `showReceived(title, body, data)` → void — 수신 알림 (알림 탭 시 바로 복사 동작)
- `dismiss(id)` → void
- Notification Channel 2개: `sync_service` (낮은 중요도), `clipboard_received` (기본 중요도)

### 4. `plugin-amber`
- `isInstalled()` → boolean
- `getPublicKey()` → String
- `signEvent(eventJson)` → String (서명된 이벤트 JSON)
- `nip44Encrypt(pubkey, plaintext)` → String
- `nip44Decrypt(pubkey, ciphertext)` → String
- Amber 없을 때: BunkerSigner 폴백

### 5. `plugin-clipboard-action`
- 알림 탭 → 투명 Activity 실행 → 클립보드 조작 → 결과를 TS로 콜백
- 발신: `SyncBridge`에 클립보드 내용 저장 → `trigger("sync-clipboard", data)` → TS에 이벤트 전달
- 수신: Amber nip44_decrypt → `ClipboardManager.setPrimaryClip()`
- 히스토리: SharedPreferences 임시 저장 → 앱 열릴 때 TS가 수거하여 history-store에 저장

---

## 구현 상태

| Step | 내용 | 상태 |
|------|------|------|
| 1 | Tauri Mobile 프로젝트 초기화 | 완료 |
| 2 | 플랫폼 분기 구조 설계 | 완료 |
| 3 | Amber Intent 플러그인 | 완료 |
| 4 | 로그인 화면 | 완료 |
| 5 | Foreground Service 플러그인 | 완료 |
| 6 | 알림 플러그인 | 완료 |
| 7 | 투명 Activity 클립보드 액션 (텍스트+이미지 수신) | 완료 |
| 8 | 발신 흐름 통합 (텍스트+이미지) | 완료 |
| 9 | 수신 흐름 통합 | 완료 |
| 10 | 메인 화면 + 히스토리 모바일 최적화 | 스킵 (UI가 단순하여 불필요) |
| 11 | GitHub Actions 릴리즈 | 완료 |
