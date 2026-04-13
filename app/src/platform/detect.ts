/**
 * 플랫폼 감지 유틸리티
 *
 * Tauri 2의 내부 `__TAURI_OS_PLUGIN_INTERNALS__` 을 사용하지 않고
 * 빌드 시 Vite가 주입하는 userAgent 문자열로 판별한다.
 * Android WebView UA에는 항상 'Android' 문자열이 포함된다.
 */
let _isAndroid: boolean | null = null

export function isAndroid(): boolean {
  if (_isAndroid === null) {
    _isAndroid = /android/i.test(navigator.userAgent)
  }
  return _isAndroid
}

export function isDesktop(): boolean {
  return !isAndroid()
}
