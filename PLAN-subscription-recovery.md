# PLAN: 구독 장시간 유지 실패 (Subscription Death) 근본 해결

## 현상

- 앱을 8시간 이상 켜두면 **구독이 죽어** 클립보드 동기화가 안 됨
- Android: 상단 알림바(Foreground Service)는 살아있어서 정상 동작처럼 보이지만 실제로는 수신 불가
- Desktop: 동일 증상. visibilitychange 이벤트가 발생하지 않아 복구 로직도 트리거되지 않음
- **발행은 항상 성공** — 발행만 되고 수신이 안 되는 비대칭 상태

---

## 근본 원인 분석

### 원인 1: 발행과 구독의 SimplePool 분리

**파일**: `app/src/nostr/publish.ts:57`, `app/src/nostr/subscribe.ts:116`

- **publish.ts**: 매 발행마다 `new SimplePool()` 생성 → 발행 → 즉시 `pool.destroy()`
- **subscribe.ts**: 앱 시작 시 `new SimplePool({ enablePing: true, enableReconnect: true })` 생성 후 장기간 유지

발행은 항상 fresh 연결이라 성공하지만, 구독 쪽 pool의 릴레이 연결이 죽으면 수신만 멈춘다. 발행이 성공하므로 사용자는 문제를 인지하기 어렵다.

### 원인 2: EOSE 타임아웃에 의한 구독 조용한 사망

**라이브러리**: `nostr-tools/abstract-pool.ts` — `baseEoseTimeout: 4400ms`

nostr-tools의 subscribeMany 동작:
1. 릴레이 재연결 성공 → 구독 필터를 다시 전송 (REQ)
2. 릴레이가 4.4초 내에 EOSE를 보내야 함
3. **EOSE가 늦으면** → 해당 릴레이의 `eosed` 플래그가 false인 채로 남음
4. 이후 해당 릴레이에서 오는 이벤트가 **조용히 무시됨** (에러 없이)

릴레이가 재연결 직후 느리게 응답하는 경우(네트워크 불안정, 서버 부하), 구독이 영구적으로 dead 상태에 빠진다. 로그에 아무 에러도 남지 않는다.

### 원인 3: `since` 타임스탬프 고정

**파일**: `app/src/nostr/subscribe.ts:117`

```typescript
const since = Math.floor(Date.now() / 1000) // 구독 시작 시 1번만 설정
```

- 구독 시작 시각에 고정되어 **이후 갱신되지 않음**
- nostr-tools 내부적으로 재연결 시 `since`를 `lastEmitted + 1`로 업데이트하는 로직이 있으나, 이벤트를 한 번도 수신하지 못한 릴레이에서는 원래 `since` 값이 유지됨
- 8시간 후 재연결 시 8시간 전의 `since`로 필터링 → 릴레이가 대량의 과거 이벤트를 보내야 할 수도 있고, 일부 릴레이는 이를 거부하거나 느리게 응답 → 원인 2를 유발

### 원인 4: 데스크탑에서 헬스체크가 동작하지 않음

**파일**: `app/src/App.tsx:207-224`

```typescript
const onVisibilityChange = () => {
  if (document.visibilityState !== 'visible') return
  // ... 릴레이 상태 체크 → 전부 죽었으면 재시작
}
document.addEventListener('visibilitychange', onVisibilityChange)
```

- **Android**: 앱이 백그라운드→포그라운드로 전환될 때 `visibilitychange` 발생 → 헬스체크 트리거
- **Desktop**: Tauri 윈도우는 항상 `visible` 상태. 최소화해도 `visibilitychange`가 발생하지 않음
- 결과: 데스크탑에서는 구독이 죽어도 복구 로직이 **절대** 실행되지 않음

### 원인 5: 부분적 릴레이 사망 미감지

**라이브러리**: `nostr-tools/abstract-pool.ts` — `handleClose` 콜백

- pool.subscribeMany의 `onclosed` 콜백은 **모든** 릴레이의 구독이 닫혔을 때만 호출됨
- 3개 릴레이 중 2개가 죽어도 1개가 살아있으면 `onclosed`가 발생하지 않음
- 부분적으로 릴레이가 죽은 상태가 **감지되지 않고 지속**됨

### 보조 원인: 모든 구독이 독립적 SimplePool 사용

**파일**: `shared/src/relay-discovery.ts:73`, `shared/src/blossom-discovery.ts:59`, `shared/src/profile-discovery.ts:75`

- 클립보드 구독, 릴레이 디스커버리, Blossom 디스커버리, 프로필 디스커버리가 **각각 별도의 SimplePool**을 생성
- 동일 릴레이에 4개의 별도 WebSocket 연결 = 4배의 연결 수, 4배의 ping 트래픽
- 하나가 죽어도 다른 것들의 상태를 알 수 없음

---

## 해결 방안

### Phase A: 주기적 헬스체크 + 자동 재시작 (최우선)

**목표**: 구독이 죽었을 때 빠르게 감지하고 복구

1. **타이머 기반 헬스체크 도입** (visibilitychange 의존 제거)
   - `setInterval`로 60초마다 모든 구독의 릴레이 연결 상태 확인
   - 연결된 릴레이 수가 기준 미달이면 전체 구독 재시작
   - Desktop과 Android 모두에서 동작

2. **구독 재시작 시 `since` 갱신**
   - 재시작 시 `since = now - 30` (30초 여유) 로 설정
   - 재시작 직전 짧은 시간의 이벤트 누락 방지

3. **visibilitychange 헬스체크 유지** (Android용 보조)
   - 기존 로직은 그대로 두되, 타이머 기반이 주력

**영향 범위**: `app/src/App.tsx`
**난이도**: 낮음
**효과**: 구독 사망 후 최대 60초 내 복구

### Phase B: SimplePool 공유 (연결 효율화)

**목표**: 릴레이 연결 수 감소, 상태 일관성 확보

1. **앱 전체에서 단일 SimplePool 인스턴스 공유**
   - `app/src/nostr/pool.ts` 신규 모듈: 싱글턴 pool 관리
   - `enablePing: true`, `enableReconnect: true` 설정
   - 모든 구독(클립보드, 릴레이, Blossom, 프로필)이 이 pool 사용

2. **publish도 동일 pool 사용**
   - 매번 새 pool 생성/파괴 대신 공유 pool로 발행
   - 발행 시 이미 연결된 릴레이 재활용 → 발행 속도 향상
   - 발행 성공 = 해당 릴레이 연결 살아있음 확인 효과

3. **shared 패키지의 디스커버리 함수에 pool 주입 옵션**
   - `fetchWriteRelays(pubkey, pool?)` — pool 전달 시 외부 pool 사용
   - `subscribeWriteRelays(pubkey, onUpdate, pool?)` — 동일
   - 하위호환 유지: pool 미전달 시 기존처럼 내부 생성

**영향 범위**: `app/src/nostr/`, `shared/src/*.ts`
**난이도**: 중간
**효과**: 릴레이당 WebSocket 1개로 감소, 연결 상태 일관성 확보

### Phase C: 구독 레이어 추상화 (장기 안정성)

**목표**: 라이브러리 레벨의 조용한 실패를 감지하고 대응

1. **Subscription wrapper 도입**
   - `pool.subscribeMany` 를 감싸는 래퍼
   - 마지막 이벤트 수신 시각 추적
   - 일정 시간(5분) 동안 이벤트 없으면 구독 재생성
   - EOSE 수신 여부 추적 → 미수신 시 재시도

2. **릴레이별 상태 모니터링**
   - 각 릴레이의 연결/구독 상태를 개별 추적
   - 부분 사망 감지 → 죽은 릴레이만 선별 재연결
   - `pool.ensureRelay(url).connected` 를 주기적 확인

3. **이벤트 수신 확인 (echo check)**
   - 발행 후 일정 시간 내에 구독으로 echo가 돌아오는지 확인
   - echo 미수신 = 구독 사망으로 판단 → 즉시 재시작
   - 가장 확실한 사망 감지 방법

**영향 범위**: 신규 모듈 `app/src/nostr/subscription-manager.ts`
**난이도**: 높음
**효과**: EOSE 타임아웃, 부분 사망 등 모든 edge case 대응

---

## 구현 우선순위

| 순서 | Phase | 이유 |
|------|-------|------|
| 1 | **A: 주기적 헬스체크** | 최소 코드 변경으로 즉시 효과. 데스크탑 사각지대 해소 |
| 2 | **B: Pool 공유** | 연결 수 1/4로 감소. 모바일 배터리·네트워크 절약 |
| 3 | **C: 구독 래퍼** | 근본 해결이지만 복잡도 높음. A+B로 대부분 해결 후 진행 |

Phase A만으로도 **"8시간 후 구독 사망"** 문제는 해결된다. 구독이 죽더라도 60초 내에 자동 복구되기 때문이다. Phase B는 연결 효율, Phase C는 장기 안정성을 위한 것이다.

---

## 검증 방법

1. **로그 기반 확인**: 헬스체크가 사망을 감지하고 재시작하는 로그 (`[app] restarting all subscriptions`) 확인
2. **강제 사망 테스트**: 릴레이 서버를 수동으로 끊거나, Wi-Fi를 10분간 끄고 다시 켜서 복구 확인
3. **장시간 방치 테스트**: 앱을 12시간 이상 방치 후 클립보드 동기화 동작 확인 (Desktop + Android 각각)
4. **부분 사망 테스트**: 3개 릴레이 중 1-2개만 다운시킨 상태에서 동기화 확인
