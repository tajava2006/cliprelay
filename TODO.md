# TODO

구현 완료된 기능 개선 및 미결 과제 목록.

---

## 보안

### client-keypair OS 암호화 저장소 이전

**현재**: `tauri-plugin-store`로 평문(또는 단순 파일) 저장
**목표**: OS 네이티브 암호화 저장소 사용

| 플랫폼 | 저장소 |
|--------|--------|
| macOS | Keychain (securityd) |
| Windows | Credential Manager / DPAPI |
| Linux | Secret Service (GNOME Keyring / KWallet) |
| Android | Android Keystore |

**방법 (검토 필요)**
- Rust `keyring` 크레이트 (v3) — macOS/Windows/Linux 단일 API 추상화
- Android 지원 여부 확인 필요. 미지원 시 `tauri-plugin-stronghold` 또는 Android Keystore 직접 연동 검토
- Tauri 백엔드 command로 노출 → TS에서 `invoke('store_keypair', ...)` 형태로 사용

**왜 중요한가**
- client-keypair는 nostr 사용자 개인키 자체는 아니지만, 통신용 비밀키이므로 평문 저장은 부적절
- OS keychain은 OS 로그인 시 자동 잠금 해제 → 별도 앱 비밀번호 UX 없이 동등한 보안

---

## 미결 기능

### GitHub Actions Android 릴리즈 자동화
- `.github/workflows/release-android.yml`
- 트리거: `android/v*` 태그 push
- `tauri android build` → APK 서명 (키스토어를 GitHub Secrets 저장) → GitHub Release draft 업로드

### Step 10. 설정 화면
- 파일 동기화 on/off, 최대 파일 크기 설정
- kind:30078으로 Nostr에 저장 (NIP-44 암호화 + NIP-46 서명)
- 기기 간 설정 동기화

### 릴레이 수 경고
- write 릴레이가 5개 이상이면 UI에서 경고 표시 (아웃박스 모델 권장사항)

---

## Android 서비스 안정성 강화

Amber 앱 아키텍처 참조. 목표: 앱이 명시적으로 끄기 전까지 절대 죽지 않는 상시 가동.

### BootReceiver — 부팅/업데이트 시 자동 시작

- `BroadcastReceiver`로 `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED` 수신
- 권한: `android.permission.RECEIVE_BOOT_COMPLETED`
- 수신 시 `startForegroundService()` 호출 → ClipboardSyncService 자동 시작
- 참조: `Amber/app/src/main/java/com/greenart7c3/nostrsigner/service/BootReceiver.kt`

### AlarmManager.RTC_WAKEUP — 딥슬립 대응

- 서비스 시작을 `AlarmManager.RTC_WAKEUP`으로 스케줄
- 기기가 딥슬립 상태여도 서비스 시작 보장
- 참조: `Amber/app/src/main/java/com/greenart7c3/nostrsigner/Amber.kt:372-388`

### NetworkCallback — 네트워크 전환 시 WebSocket 재연결

- `ConnectivityManager.registerDefaultNetworkCallback()` 등록
- `onAvailable()`: 네트워크 복구 시 WebView에 재연결 이벤트 전달
- `onCapabilitiesChanged()`: WiFi↔모바일 전환 시 재연결
- `onLost()`: 연결 끊김 감지
- 현재 TS의 15초 헬스체크만으로는 네트워크 전환에 느리게 반응 → 네이티브 콜백으로 즉시 대응
- 참조: `Amber/app/src/main/java/com/greenart7c3/nostrsigner/service/ConnectivityService.kt:27-85`

### 포그라운드 서비스 타입 변경 검토

- 현재: `FOREGROUND_SERVICE_TYPE_DATA_SYNC` — Google Play 심사에서 거부될 수 있음
- Amber 방식: `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` + property 선언
- 변경 시 AndroidManifest.xml의 service 선언과 permission 모두 수정 필요

---

## 검토 중

### 파일 동기화 스코프 아웃 여부
- 대용량 파일: NIP-46 서명 왕복 + Blossom 업로드 직렬화로 레이턴시 큼
- 클립보드 동기화 본질에 반드시 필요한지 재검토 필요
