package com.hoppe.cliprelay.clipaction

/**
 * ClipboardActionActivity(앱 모듈)와 ClipboardActionPlugin(플러그인 모듈) 사이의 데이터 전달.
 *
 * copy 액션: 백그라운드 알림의 "복사" 탭 시 플래그 설정 → TS가 확인 후 클립보드 직접 쓰기.
 * 앱 모듈은 플러그인 모듈에 의존하므로 이 방향의 import가 가능하다.
 */
object SyncBridge {
    /** "복사" 버튼 탭으로 앱이 올라온 경우 true → 복호화 후 알림 대신 클립보드 직접 쓰기 */
    @Volatile
    var pendingCopy: Boolean = false

    /** 복사 대상 알림 ID (dismiss 용) */
    @Volatile
    var pendingNotificationId: Int = -1
}
