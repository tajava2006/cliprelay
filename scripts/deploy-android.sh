#!/usr/bin/env bash
set -euo pipefail

# Android release APK 빌드 → USB 기기 전송
# Usage: ./scripts/deploy-android.sh

export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/29.0.13846066"

APK_PATH="app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
DEVICE_PATH="/sdcard/Download/cliprelay.apk"

cd "$(git rev-parse --show-toplevel)"

# 1. 포트 정리
echo "==> Killing processes on ports 1420, 1421..."
lsof -ti:1420,1421 2>/dev/null | xargs -r kill -9 2>/dev/null || true

# 2. 빌드
echo "==> Building release APK..."
pnpm tauri android build --target aarch64

# 3. 기기 확인
if ! adb devices | grep -q 'device$'; then
  echo "ERROR: No Android device connected."
  exit 1
fi

# 4. 전송
echo "==> Pushing APK to device..."
adb shell rm -f "$DEVICE_PATH"
adb push "$APK_PATH" "$DEVICE_PATH"
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://$DEVICE_PATH" >/dev/null

echo "==> Done! Install from Downloads/cliprelay.apk"
