# TODO

구현 완료된 기능 개선 및 미결 과제 목록.

---

## 보안

### Android 네이티브 구독의 이벤트 서명 검증

WebView 쪽은 nostr-tools pool이 수신 이벤트 서명을 검증하지만, 백그라운드용 네이티브
구독(`NativeRelayClient.kt`, OkHttp)은 검증 없이 알림을 띄운다. 위조 이벤트는 복호화가
실패하므로 클립보드가 오염되지는 않고, 가짜 "새 클립보드" 알림이 뜨는 수준이다.

---

## 미결 기능

### Step 10. 설정 화면
- 파일 동기화 on/off, 최대 파일 크기 설정
- kind:30078으로 Nostr에 저장 (NIP-44 암호화 + NIP-46 서명)
- 기기 간 설정 동기화

### 릴레이 수 경고
- write 릴레이가 5개 이상이면 UI에서 경고 표시 (아웃박스 모델 권장사항)

---

## Android 서비스 안정성 강화

Amber 앱 아키텍처 참조. 목표: 앱이 명시적으로 끄기 전까지 절대 죽지 않는 상시 가동.

### ~~BootReceiver — 부팅/업데이트 시 자동 시작~~ (스킵 — 명시적 실행만 허용)

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

---

## 구조 정리 (남은 것)

2026-04의 리팩토링 검토(REFACTOR.md)는 대부분 반영돼 문서를 지웠다. 남은 세 가지:

- `ForegroundServicePlugin.kt`(300줄대) 파일 분할
- `ClipboardActionActivity.kt`가 `gen/android/` 아래에 있다 — 플러그인 내부로 이전 검토
- Blossom 다운로드 + AES-GCM 복호화가 TS와 Kotlin에 각각 있다 (알림 탭 경로가 Kotlin 쪽을 씀)

## 알려진 한계

- **Android에서 예전 텍스트 재복사**: 프로세스가 재시작된 직후 첫 포그라운드 진입에서는
  클립보드 내용이 새 복사인지 알 수 없어 히스토리 전체와 대조한다. 그 순간에 한해, 히스토리에
  있는 텍스트를 다시 복사한 것은 발행되지 않는다. (데스크탑과, 프로세스가 살아 있는 Android는
  직전 항목과만 대조한다.)

