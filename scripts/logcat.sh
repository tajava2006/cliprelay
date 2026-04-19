#!/usr/bin/env bash
# ClipRelay 관련 Android 로그만 필터링해서 보여준다.
# 사용법: ./scripts/logcat.sh

adb logcat -c  # 기존 로그 비우기
adb logcat \
  ClipboardSyncService:D \
  NativeRelayClient:D \
  ForegroundServicePlugin:D \
  ClipboardActionActivity:D \
  AmberPlugin:D \
  *:S
