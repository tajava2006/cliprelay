use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.hoppe.cliprelay.notification";

/// Android 알림 플러그인 초기화.
///
/// 수신 클립보드 이벤트를 알림으로 표시하고 "복사" 액션 버튼을 제공한다.
/// 데스크탑에서는 등록만 되고 커맨드 호출 시 무시된다.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("notification-android")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(PLUGIN_IDENTIFIER, "NotificationPlugin")?;
            Ok(())
        })
        .build()
}
