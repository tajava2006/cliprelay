# CLAUDE.md

AI 코딩 어시스턴트가 이 코드베이스를 다룰 때 참조하는 지침.

## 프로젝트 요약

**ClipRelay** — 내 제어하에 있는 기기들의 클립보드를 자동으로 통일하는 툴.
Ctrl+C / Cmd+C 하는 것만으로 다른 기기에서 Ctrl+V / Cmd+V 가 되어야 한다.
모든 기기간 통신은 **Nostr 릴레이**를 통하고, 콘텐츠는 **NIP-44**로 자기 자신에게 암호화한다.
인증은 **NIP-46 (bunker, QR코드 방식)** 을 사용한다. Android에서는 **Amber Intent** 우선, 폴백으로 NIP-46.
파일(텍스트 외) 전송은 **Blossom (BUD-02)** 서버를 통한다.

**Phase 1**: 데스크탑 (Mac / Windows / Linux) — GUI 앱 + 시스템 트레이 (완료)
**Phase 2**: Android — Tauri Mobile 기반, 데스크탑 코드 공유 (완료)
iOS는 OS 정책상 백그라운드 클립보드 접근 불가로 스코프 외.

## 헌법 (반드시 준수)

### 1. 암호화 — 절대 원칙

- 클립보드 이벤트의 content는 **항상** NIP-44 자기암호화(self-encryption)로 암호화한다.
- 자기암호화: `conversation_key = get_conversation_key(userPrivKey, userPubKey)`
- **암호화 실패 시 절대 발행하지 않는다.** 평문을 릴레이에 올리는 코드는 절대 작성하지 않는다.
- **복호화된 클립보드 내용은 앱 자체 저장소(히스토리 스토어, OS 클립보드) 외에 그 어디에도 저장·전달하지 않는다.** OS 알림, 로그(logcat/console), Intent extras, SharedPreferences, 크래시 리포트 등 앱 외부에서 읽을 수 있는 경로에 복호화된 내용을 절대 넣지 않는다. 알림에는 고정 안내 문구만 사용한다.

### 2. 릴레이 디스커버리 — 하드코딩 금지

- 사용 릴레이는 **항상** 사용자의 `kind:10002` 이벤트에서 동적으로 읽는다.
- 릴레이 URL을 코드에 하드코딩하지 않는다.
- Blossom 서버도 사용자의 `kind:10063` 이벤트에서 읽는다.

### 3. NIP-46 전용 인증

- 개인키를 앱 내에서 직접 보관하거나 입력받는 코드를 작성하지 않는다.
- 모든 서명은 NIP-46 bunker를 통해 위임한다.

## 코딩 규칙

- TypeScript strict 모드. `any` 금지.
- Nostr 관련 코드는 각 앱의 `nostr/` 디렉토리에 모듈화.

## 레포지토리 구조

```
ClipRelay/                ← pnpm workspace 모노레포
  shared/                   ← 공통 Nostr 로직 (키, 릴레이, 이벤트 타입, NIP-44)
  app/                      ← 데스크탑 + Android 통합 앱 (Tauri v2)
    src/                    ← React + TypeScript (플랫폼 공유)
    src-tauri/              ← Rust 백엔드 + Android Kotlin 플러그인
```

## 참고 레포

- `../web-parser` — Nostr 프로토콜 패턴(NIP-46, NIP-65, NIP-44) 참고용 별도 앱. **단, web-parser는 "여러 UI가 동일 Nostr 데이터를 소비하는 뷰어"라는 근본이 다르므로 그쪽의 UI/스토어/서비스 레이어링은 ClipRelay에 적용하지 않는다.** 릴레이 디스커버리, QR코드 NIP-46 로그인, 이벤트 서명 위임 같은 **프로토콜 레벨 패턴만** 참조할 것.

## 문서 가이드

| 문서 | 참조 시점 |
|------|----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 플랫폼별 구조, 데이터 흐름, Kotlin 플러그인, 기술 스택 |
| [PROTOCOL.md](PROTOCOL.md) | Nostr 이벤트 kind/tag, 암호화 방식, Blossom 연동 확인 시 |
| [TODO.md](TODO.md) | 미결 과제, 향후 개선 계획 확인 시 |
