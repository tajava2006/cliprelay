#!/usr/bin/env bash
# 의존성 한방 최신화 (주기 실행)
#
# 이 앱은 아무도 라이브러리로 가져다 쓰지 않는 최말단이라, 버전을 붙잡고 있을 이유가 없다.
# 항상 latest를 따라가고 깨지면 그때 고치는 게, 몇 달치 breaking을 한꺼번에 맞는 것보다 싸다.
# 특히 nostr-tools는 연결 수명 관리 버그가 계속 잡히는 중이라 뒤처지면 그대로 손해다.
#
# Tauri major bump는 여기서 안 다룬다: changelog 보고 수동 (bump-stack 정신).
# @tauri-apps/api 단일화는 pnpm-workspace.yaml의 overrides가 지킨다 — 최신화 후에도
# `pnpm why @tauri-apps/api`로 한 벌인지 확인할 것.
set -euo pipefail
cd "$(dirname "$0")"

echo "== JS 의존성 (워크스페이스 전부 latest) =="
pnpm up --latest -r

echo "== Rust =="
(cd app/src-tauri && cargo update)

echo "== @tauri-apps/api 중복 확인 =="
pnpm why -r @tauri-apps/api 2>/dev/null | grep -E "@tauri-apps/api [0-9]" | sort -u || true

echo "== 프론트 빌드 검증 (tsc + vite) =="
pnpm build

echo "== Rust 컴파일 검증 =="
(cd app/src-tauri && cargo check)

echo ""
echo "⚠️ 릴리즈 전 로컬 .app 빌드로 며칠 관찰할 것 (연결 수명 버그는 즉시 안 드러남)."
echo "   릴리즈 순서 함정: updater가 releases/latest를 보므로 desktop을 항상 마지막에 publish."
