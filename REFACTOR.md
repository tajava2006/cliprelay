# ClipRelay 리팩토링 검토

> 검토일: 2026-04-19
> 범위: `shared/`, `app/src/`, `app/src-tauri/plugins/`, `app/src-tauri/gen/android/`
> 관점: 현대 소프트웨어 공학 기준의 구조·유지보수성. **보안/기능 버그는 [AUDIT.md](AUDIT.md)에서 다루므로 여기서는 중복 언급하지 않는다.**

---

## 한 줄 요약

> 기능은 잘 돌아가지만, 데스크탑 위에 Android를 얹은 자국이 **[App.tsx](app/src/App.tsx)·`platform/`·Kotlin 플러그인** 세 경계면에 똑같이 배어 있다. 큰 리팩토링 하나보다 **"경계 하나당 작은 수술 하나"**가 더 깔끔하다.

---

## 1. 구조적으로 제일 아픈 곳

### 1-1. [App.tsx](app/src/App.tsx) 비대화 (465줄, God Component)

현재 [App.tsx](app/src/App.tsx)는 다음을 **동시에** 책임진다:

- 앱 상태 머신 (`loading` / `login` / `main`)
- 인증 복원 (Bunker / Amber 분기)
- 4종 구독 생명주기 (릴레이 / Blossom / 프로필 / 클립보드)
- 클립보드 모니터 기동 + publish wiring
- **Android 전용 흐름 3종** — visibility 핸들러, native event consume, Amber-trigger publish
- 헬스체크 인터벌 + 쿨다운 관리
- 라우팅 (Login/Main/History)

SRP 관점의 구체적 증상:

- `isAndroid()` 분기가 파일 3군데, Android에서만 의미 있는 refs(`isPublishingRef`, `lastSubRestartRef`)가 데스크탑 경로에서도 생성됨.
- [onVisibilityChange](app/src/App.tsx#L226-L315) **단일 함수가 90줄**. 그 안에 Android-전용 publish 루프 + 히스토리 동기화 + 구독 재시작 + 포그라운드 알림 토글이 섞여 있음.
- cleanup refs(`healthCheckRef`, `visibilityCleanupRef`, ...)가 파일 전반에 흩뿌려져 있고 로그아웃/언마운트마다 수작업 해제 → 누락 시 구독 leak. 과거에 실제로 한 번씩 발생한 흔적.
- 테스트 불가. 렌더링 없이 어떤 단위도 실행할 수 없음.

**여기서 진짜 축은 "서비스 레이어"가 아니라 "데스크탑/Android 혼재"다.** ClipRelay는 웹 뷰어 앱이 아니고 싱크 루프 하나뿐이다 — `sync-engine` / `discovery` / `session` 같은 3단 분리는 간접참조만 늘리므로 하지 않는다. 다음 **2개 수술**이면 충분하다:

**1) Android-전용 블록을 [platform/android/](app/src/platform/)로 추출.**
visibility 핸들러의 Android 분기, Amber-trigger publish 루프, `consumeNativeEvents`, foreground-service wiring을 한 모듈로 모아 App.tsx는 `registerAndroidHooks({ onForeground, onBackground, ... })` 같은 안정 인터페이스 하나만 호출한다. 이 한 수술로 `isAndroid()` 분기 3개가 App.tsx에서 사라지고, 테스트에서도 이 모듈을 mock 가능해진다. **사용자가 지적한 "데스크탑 위에 Android를 얹은 자국"이 가장 크게 드러난 곳.**

**2) 클립보드 싱크 루프를 모듈화.**
현재 [restartAllSubscriptions()](app/src/App.tsx#L120)를 건드리는 트리거가 4개(relay 업데이트 / 15초 헬스체크 / visibility 복귀 / network-changed)이고 하나의 `lastSubRestartRef` 쿨다운을 공유한다. 거의 동시 발동하면 서로 무효화한다 (AUDIT M-7). 이 한 덩어리를 `clipboard/sync.ts` (혹은 `useClipboardSync` 훅) 로 옮겨 **내부 상태머신 + 단일 mutex**로 정돈한다.

```
SyncLoop states: idle → running → degraded → restarting → running
외부 트리거는 requestRestart(reason) 하나로 통일.
```

이 두 수술 후 App.tsx는 라우팅 + 초기화 + 두 모듈 연결만 담는 ~120줄이 된다. 인증 복원(signer + loadAuth/clearAuth)·디스커버리 3종은 그대로 App.tsx의 `useEffect`에 두어도 각각 30~50줄 수준이라 따로 추출할 값어치가 없다 — 억지로 모듈화하면 파일만 늘어난다.

---

### 1-2. `platform/`가 "추상화"와 "Android 전용"을 섞어 담고 있다

[app/src/platform/](app/src/platform/) 현재 구성:

| 파일 | 역할 | 데스크탑에서 의미 있음? |
|------|------|------------------------|
| [detect.ts](app/src/platform/detect.ts) | 플랫폼 감지 | ✅ |
| [signer.ts](app/src/platform/signer.ts) | UniversalSigner 인터페이스 (진짜 추상화) | ✅ |
| [clipboard.ts](app/src/platform/clipboard.ts) | 플랫폼별 모니터 팩토리 | ✅ |
| [amber.ts](app/src/platform/amber.ts) | Android 전용 | ❌ (isAndroid 체크 없음, 다이내믹 import로 방어) |
| [clipboard-action.ts](app/src/platform/clipboard-action.ts) | Android 전용 | ❌ |
| [foreground-service.ts](app/src/platform/foreground-service.ts) | Android 전용 | ❌ (내부에서 no-op 처리) |
| [notification-android.ts](app/src/platform/notification-android.ts) | **사용처 없음 (dead code)** | ❌ |

두 가지가 섞여 있어 "platform/에서 뭘 import해도 안전한가?"를 매번 고민해야 한다.

**권장 레이아웃:**

```
app/src/
  platform/
    detect.ts              ← 유지
    signer.ts              ← UniversalSigner 인터페이스만. (데스크탑 기본 구현도 여기)
    clipboard.ts           ← 팩토리 (내부에서 desktop/android import)
    desktop/               ← 데스크탑 전용 (현재는 대부분 Tauri API 직접 호출이라 비어도 됨)
    android/
      amber.ts
      clipboard-action.ts
      foreground-service.ts
      native-events.ts     ← consumeNativeEvents / setAppForeground 분리
```

이름에 `android`가 붙으면 호출자는 반드시 `if (isAndroid())` 가드를 쓰게 된다 → 현재처럼 각 함수 첫 줄에 `if (!isAndroid()) return`을 숨겨두는 패턴을 없앨 수 있다.

---

### 1-3. Kotlin 플러그인 5개 — **4개로 줄일 수 있다**

| 플러그인 | 실제 역할 | 상태 |
|---------|---------|------|
| `tauri-plugin-amber` | Amber(NIP-55) Content Provider + Intent | 필요 |
| `tauri-plugin-clipboard-action` | readText / readImage / writeImage / consumePendingCopy | 필요 |
| `tauri-plugin-foreground-service` | 서비스 + NativeRelayClient + 권한 + 네트워크 콜백 + WebView keepalive + **수신 알림** | 비대. 한 플러그인이 6가지 역할. |
| `tauri-plugin-notification-android` | `showReceived(body, encryptedContent, userPubkey)` + `dismiss(id)` | **사용처 0** ([app/src/platform/notification-android.ts](app/src/platform/notification-android.ts)가 아무 데서도 import되지 않음) |
| `tauri-plugin-keychain` | macOS Keychain / Android Keystore | 필요, 잘 나뉘어 있음 |

**구체 액션:**

1. **`tauri-plugin-notification-android` 삭제.** 수신 알림은 이미 [ClipboardSyncService.showReceivedNotification](app/src-tauri/plugins/tauri-plugin-foreground-service/android/src/main/java/com/hoppe/cliprelay/foreground/ClipboardSyncService.kt#L77-L105)이 담당한다. TS 래퍼도 같이 삭제.
    - 동시에 [ClipboardSyncService.RECEIVED_CHANNEL_ID](app/src-tauri/plugins/tauri-plugin-foreground-service/android/src/main/java/com/hoppe/cliprelay/foreground/ClipboardSyncService.kt#L44)와 [NotificationPlugin.CHANNEL_ID](app/src-tauri/plugins/tauri-plugin-notification-android/android/src/main/java/com/hoppe/cliprelay/notification/NotificationPlugin.kt#L41)에 **동일 ID(`clipboard_received`)를 두 곳에서 생성**하는 현재 상태가 깔끔해진다. (지금은 먼저 생성된 채널이 IMPORTANCE를 고정시키므로 중복이라 해서 버그는 아니지만, 코드상 혼란이 크다.)
2. **`ForegroundServicePlugin` 분해.** 329줄에 성격이 다른 일이 섞여 있다:
    - 서비스 start/stop → `ForegroundServicePlugin`
    - 권한 3종 → `PermissionsPlugin` (또는 같은 파일 내 `Permissions.kt` 분리)
    - WebView keepalive + ActivityLifecycleCallbacks + NetworkCallback → `BackgroundSurvivalPlugin` (혹은 `load()` 전용 헬퍼로 분리)
    - Native relay subscription / consume events → `NativeRelayPlugin`
    - 커맨드는 그대로 두더라도 **파일은 반드시 나누자**. 한 Plugin 클래스가 Activity 라이프사이클·권한·WebSocket·WebView·네트워크·알림을 다 쥐고 있다.

---

## 2. 중복 / 불일치 (유지보수 시한폭탄)

### 2-1. AES-GCM 복호화가 TS와 Kotlin에 각각 존재

- TS: [app/src/blossom/download.ts](app/src/blossom/download.ts#L18-L38) `decryptFile()`
- Kotlin: [ClipboardActionActivity.kt](app/src-tauri/gen/android/app/src/main/java/com/hoppe/cliprelay/ClipboardActionActivity.kt#L233-L240) `decryptAesGcm()`

플랫폼이 다르니 언어 중복은 불가피. 단, **다운로드 경로 자체**도 중복된다 (Kotlin이 별도로 `HttpURLConnection`으로 Blossom을 받는다). 권장:

- Activity가 Blossom URL을 열지 말고, **알림 시점에 이미 네이티브 릴레이 클라이언트가 큐에 암호문을 갖고 있으므로**, Activity는 "Amber에 복호화 → JSON.type만 읽고, file 케이스면 다시 JS로 넘겨라" 정도로 축소하는 게 논리적. 즉 파일 페이로드는 WebView(JS) 경로로 일원화 — 현재 구조라면 알림 탭 시 WebView를 깨울 수밖에 없지만, JS가 한 번 돌면 TS 구현을 재사용할 수 있고, Blossom fallback 서버 목록도 재사용 가능(지금 Kotlin 쪽에는 fallback 없음 — 기능 비대칭).

한 줄 요약: **복호화는 어차피 네이티브에서 할 것. 하지만 Blossom GET + AES-GCM은 TS에 일원화**해서 "TS에서 하나만 고치면 된다"로 만든다.

---

### 2-2. 이미지 지문(fingerprint) 포맷이 파일마다 다르다

| 위치 | 포맷 | 입력 |
|------|------|------|
| [clipboard/monitor.ts:69](app/src/clipboard/monitor.ts#L69) | `${W}x${H}:${head32Hex}` | RGBA |
| [nostr/subscribe.ts:86](app/src/nostr/subscribe.ts#L86) | `${W}x${H}:${head32Hex}` | RGBA |
| [App.tsx:114](app/src/App.tsx#L114) | `${length}:${head64Hex}` | PNG bytes |
| [App.tsx:283](app/src/App.tsx#L283) | `${length}:${head64Hex}` | PNG bytes |

지금은 "두 개의 ref(`monitor`용·`lastSyncedImageFpRef`용)가 각자 다른 포맷으로 병행 관리"되어 동작하지만, 다음에 "왜 이미지 중복 발행 안 돼?"를 디버깅하는 사람은 반드시 헷갈린다.

**권장:**
```ts
// app/src/clipboard/fingerprint.ts
export type ImageFingerprint = string & { readonly __brand: 'image-fp' }
export function fingerprintRgba(rgba: Uint8Array, w: number, h: number): ImageFingerprint
export function fingerprintPng(png: Uint8Array): ImageFingerprint
```
형식을 다르게 가져가더라도 **단 한 곳에서만 정의**하고 상수처럼 import한다. [headHex](app/src/clipboard/monitor.ts#L26)가 두 파일에 중복 정의된 것도 같이 해소.

---

### 2-3. `startForegroundService(relays?, userPubkey?)` 오버로드가 두 가지 일을 한다

[foreground-service.ts:11](app/src/platform/foreground-service.ts#L11)와 [ForegroundServicePlugin.startService](app/src-tauri/plugins/tauri-plugin-foreground-service/android/src/main/java/com/hoppe/cliprelay/foreground/ForegroundServicePlugin.kt#L142):
- 인자 없음 → 서비스만 켠다
- 인자 있음 → 서비스 + **네이티브 릴레이 구독** 시작

별도 커맨드 `startNativeSubscription`도 따로 있다. App.tsx 측은 "서비스 재시작=네이티브 구독 재시작"을 겸용하려고 인자를 넘기는데, 이 암시적 커플링이 이름에 드러나 있지 않다.

**권장:** 두 커맨드로 명시적 분리. 호출자가 "상시 알림만 원하는 상황"과 "구독도 같이"인 상황을 구분해서 부른다. 내부 구현은 같아도 API가 거짓말하지 않게 한다.

---

## 3. Dead code / 정리 대상

| 대상 | 근거 |
|------|------|
| [app/src/platform/notification-android.ts](app/src/platform/notification-android.ts) 전체 | repo 내 import 0건 |
| [tauri-plugin-notification-android](app/src-tauri/plugins/tauri-plugin-notification-android/) 플러그인 | 위와 동일, 함수가 ForegroundService 쪽으로 이미 이관됨 |
| [clipboard-action.ts](app/src/platform/clipboard-action.ts#L16) `consumePendingCopy()` | 정의만 되어 있고 사용처 없음. [SyncBridge](app/src-tauri/plugins/tauri-plugin-clipboard-action/android/src/main/java/com/hoppe/cliprelay/clipaction/SyncBridge.kt)도 함께 검토 — 실제 데이터 흐름은 `encrypted_content`/`user_pubkey`를 Intent로 전달하므로 `pendingCopy` 불린은 안 쓰인다 |
| [android/](android/) 디렉토리 | 빈 디렉토리 (이전 PLAN.md가 [ARCHITECTURE.md](ARCHITECTURE.md)로 병합된 흔적, 최근 커밋). 삭제. |
| [PLAN-subscription-recovery.md](PLAN-subscription-recovery.md) | 구현 완료 후 남은 설계 문서인지 현행 문서인지 불명. 내용이 살아있다면 ARCHITECTURE.md에 흡수 |

---

## 4. 폴더 재배치 제안 (현실적)

**큰 이사는 하지 않는다.** 제안은 "의미 경계"만 선명하게 만들기:

```
cliprelay/
  shared/
    src/
      constants.ts
      types.ts
      nostr/            ← nip46, relay-discovery, blossom-discovery, profile-discovery
      blossom/          ← upload.ts, download.ts  (★ 신규 이동)
      crypto/           ← 필요 시 nip44 헬퍼 등
  app/
    src/
      nostr/            ← 현재 유지 (pool, publish, subscribe, setup)
      clipboard/
        monitor.ts
        writer.ts
        fingerprint.ts  ← ★ 신규. headHex/이미지 지문 일원화
        sync.ts         ← ★ 신규. 모니터+publish+restart 트리거 통합 (App.tsx에서 추출)
      platform/
        signer.ts
        clipboard.ts
        detect.ts
        android/        ← ★ 신규. visibility hook, Amber publish 루프, consumeNativeEvents 등
                          App.tsx에서 Android-전용 블록을 전부 이리로
      store/
      pages/
      components/
      i18n/
    src-tauri/
      plugins/
        tauri-plugin-amber/
        tauri-plugin-clipboard-action/      ← Activity, SyncBridge 포함
        tauri-plugin-foreground-service/    ← 서비스 + NativeRelayClient + 수신알림
        tauri-plugin-keychain/
        # tauri-plugin-notification-android ← 삭제
      gen/android/app/...ClipboardActionActivity.kt
        ★ 가능하면 plugin-clipboard-action 쪽으로 이동.
        지금은 `gen/` 밑이라 자동 생성 프로젝트 위에 손코드가 얹혀 있어 헷갈림.
```

**Blossom 업/다운로드를 shared로 올리는 이유:** 플랫폼 의존이 `@tauri-apps/plugin-http`뿐인데 이건 WebView 공통이다. shared로 가면 `downloadAndDecrypt`가 향후 어떤 수신 엔진에서도 재사용 가능 → Kotlin 쪽 네이티브 다운로드를 없앨 때도 TS 쪽이 "정본"임이 자연스럽다.

---

## 5. 구현 단계 제안 (작은 것부터)

### P0 — 한 커밋짜리, 리스크 0
1. `tauri-plugin-notification-android` + [app/src/platform/notification-android.ts](app/src/platform/notification-android.ts) 삭제
2. 빈 [android/](android/) 디렉토리 삭제
3. [consumePendingCopy()](app/src/platform/clipboard-action.ts#L16) + [SyncBridge.pendingCopy](app/src-tauri/plugins/tauri-plugin-clipboard-action/android/src/main/java/com/hoppe/cliprelay/clipaction/SyncBridge.kt) 사용처 추적 후 unused면 삭제
4. [headHex()](app/src/clipboard/monitor.ts#L26) 중복 제거 — `clipboard/fingerprint.ts` 신규 파일 하나

### P1 — 작은 리팩토링
5. `platform/android/` 서브디렉토리로 Android 전용 3파일 이동
6. `clipboard/fingerprint.ts` — 지문 타입·함수 일원화 (브랜드 타입 권장)
7. `startForegroundService` / `startNativeSubscription` API 분리

### P2 — App.tsx 해체 (이 리팩토링의 핵심)
8. **Android 블록 이주** — visibility 핸들러의 Android 분기, Amber-trigger publish 루프, `consumeNativeEvents`, foreground-service wiring을 [app/src/platform/android/](app/src/platform/) 하위 모듈로 전부 옮긴다. App.tsx는 `registerAndroidHooks({ onForeground, onBackground })` 같은 stable 한 인터페이스 한 개만 호출. 이 한 수술만으로 `isAndroid()` 분기 3개가 App.tsx에서 사라진다.
9. **싱크 루프 모듈화** — `clipboard/sync.ts` 신설. `startMonitor` / `restartClipboardSubscription` / `restartAllSubscriptions` / 헬스체크 / 4-way restart 트리거를 모두 이리로. 내부에서 단일 mutex + 상태머신으로 경쟁 조건(AUDIT M-7) 정리. 외부 API는 `requestRestart(reason)` 하나.
    - 시작은 **App.tsx에서 로직을 그대로 들어내 이동**. 내부 리팩토링(상태머신화)은 이동이 안정화된 다음.

> 디스커버리 3종(릴레이/Blossom/프로필)과 signer 복원 블록은 App.tsx에 그대로 둔다. 각각 30~50줄이고 호출 지점이 하나뿐이라 별도 모듈로 뽑을 값어치가 없다.

### P3 — 플러그인 정리
10. `ForegroundServicePlugin.kt` 329줄을 3~4 파일로 쪼갬 (Activity lifecycle, NetworkCallback, WebView keepalive, NativeRelay 담당 — 클래스는 그대로 두고 파일만 분할해도 충분)
11. [ClipboardActionActivity.kt](app/src-tauri/gen/android/app/src/main/java/com/hoppe/cliprelay/ClipboardActionActivity.kt)를 `tauri-plugin-clipboard-action`으로 이전 가능한지 검증. 이전되면 [SyncBridge.kt](app/src-tauri/plugins/tauri-plugin-clipboard-action/android/src/main/java/com/hoppe/cliprelay/clipaction/SyncBridge.kt) 가 존재 이유가 더 뚜렷해진다.
12. Blossom 다운로드를 TS로 일원화 — Activity는 `file` 페이로드를 만나면 WebView로 위임(현재 암호문 Intent로 넘기는 방식과 유사).

---

## 6. 하지 말아야 할 것 (억지 추상화 경고)

- **"서비스 레이어" 도입하지 말 것.** ClipRelay는 싱크 루프 한 개짜리 앱이다. `SyncEngine`/`DiscoveryService`/`SessionService` 식으로 뽑아내면 사실상 1:1 호출을 위해 간접참조 층만 쌓는다. web-parser처럼 여러 UI가 Nostr 데이터를 동시에 소비하는 구조일 때만 값어치를 한다 — ClipRelay에는 해당 없음.
- **"UI는 로컬 저장소만 구독하고 릴레이를 모른다" 같은 원칙 적용 금지.** 이 원칙은 참조 레포(web-parser)에서 넘어온 흔적인데 ClipRelay의 데이터 모델과 맞지 않는다. ClipRelay의 UI는 라우팅 + 설정 + 직전 히스토리 표시가 전부이고, 릴레이와 UI 사이에 또 다른 레이어를 끼워넣을 이유가 없다.
- **서비스 인터페이스를 기계적으로 만들지 말 것.** 데스크탑/Android 간 실제로 다른 구현이 필요한 건 `ClipboardMonitor`, `UniversalSigner` 두 개뿐. 나머지(디스커버리/발행/구독/히스토리)는 플랫폼 공통이라 추상화 레이어가 오히려 간접참조만 늘린다.
- **"DI 컨테이너"나 Redux 같은 대형 상태 관리 도입 금지.** 현재 상태의 수는 작고, `useState` + refs로 충분히 감당된다.
- **shared로의 이주는 pure 로직에만.** `@tauri-apps/*` 를 import하면 shared에 들어갈 수 없다(Node 컨텍스트 오염). Blossom 모듈을 shared로 옮기려면 fetch 추상화 한 단계가 필요 — 오버 엔지니어링이라고 판단되면 현재 위치 유지.
- **5개 플러그인을 "하나의 mega 플러그인"으로 합치지 말 것.** 각 플러그인은 Android Manifest 퍼미션·gradle 의존성·라이프사이클이 분리되어 있는 게 옳다. 합치면 퍼미션 축소 분석이 어려워진다.
- **Tauri Store 분리 파일(auth/relay/blossom/profile/history) 통합 금지.** 작아 보이지만 각자 다른 수명과 민감도를 갖는다. 특히 auth는 keychain 연동이 있어 섞으면 그게 무너진다.

---

## 7. 체크리스트 — 즉시 분리 가능한 것

- [ ] `tauri-plugin-notification-android` 제거 + `platform/notification-android.ts` 제거
- [ ] 빈 `/android/` 디렉토리 제거 (git commit `e211266`와 동일 맥락)
- [ ] `headHex` 중복 제거 → `clipboard/fingerprint.ts`
- [ ] 이미지 지문 포맷 2종 문서화 혹은 통합 (현재 실버그 아님, 의도임을 코드/주석에 명시)
- [ ] `consumePendingCopy()` / `SyncBridge.pendingCopy` 살아있는 코드인지 grep → 없으면 제거
- [ ] `platform/android/` 하위 디렉토리 신설, 3파일 이동
- [ ] `startForegroundService(relays, pubkey)` 오버로드를 두 함수로 분리

## 8. 체크리스트 — 큰 리팩토링

- [ ] App.tsx의 Android-전용 블록 → `platform/android/` 로 이주 (visibility hook, Amber publish 루프, consumeNativeEvents, FG service wiring)
- [ ] App.tsx의 싱크 루프 → `clipboard/sync.ts` 로 이주 (모니터 + 4-way restart 트리거 통합)
- [ ] `ForegroundServicePlugin.kt` 파일 분할 (클래스는 분해하지 않아도 됨)
- [ ] `ClipboardActionActivity.kt` 플러그인 내부로 이전 검토
- [ ] Blossom 다운로드의 TS 단일화 (Kotlin 중복 제거)

---

## 부록 — 파일당 라인 수 현황 (300+만)

| 파일 | 라인 | 비고 |
|------|------|------|
| [app/src/i18n/index.ts](app/src/i18n/index.ts) | 583 | 사전 한 덩어리. `i18n/{ko,en}.ts` 로 분할 여지 |
| [app/src/App.tsx](app/src/App.tsx) | 465 | **1-1 참조** |
| [app/src/pages/Main.tsx](app/src/pages/Main.tsx) | 463 | 스타일 포함. inline styles를 CSS module로 뽑으면 ~200줄. 급한 건 아님 |
| [app/src/pages/Login.tsx](app/src/pages/Login.tsx) | 329 | 3 mode × UI. OK |
| [ForegroundServicePlugin.kt](app/src-tauri/plugins/tauri-plugin-foreground-service/android/src/main/java/com/hoppe/cliprelay/foreground/ForegroundServicePlugin.kt) | 329 | **1-3 참조** |
| [AmberPlugin.kt](app/src-tauri/plugins/tauri-plugin-amber/android/src/main/java/com/hoppe/cliprelay/amber/AmberPlugin.kt) | 308 | ContentProvider + Intent 양쪽 — 내용상 복잡도는 정당함. OK |
| [ClipboardSyncService.kt](app/src-tauri/plugins/tauri-plugin-foreground-service/android/src/main/java/com/hoppe/cliprelay/foreground/ClipboardSyncService.kt) | 278 | 서비스 + 네이티브 구독 companion. 분리 후보 |
| [ClipboardActionActivity.kt](app/src-tauri/gen/android/app/src/main/java/com/hoppe/cliprelay/ClipboardActionActivity.kt) | 263 | 복호화/Blossom 다운로드 중복. **2-1 참조** |
| [app/src/nostr/subscribe.ts](app/src/nostr/subscribe.ts) | 231 | 큐 + 데스크탑/Android 분기. OK |

---

_작성 원칙: 기능을 유지한 채 "이 코드를 6개월 뒤 다시 읽을 때 어디서 헤매는가?"를 기준으로 선별. 큰 설계 전환보다 **경계면을 또렷하게** 만드는 쪽으로만 제안._
