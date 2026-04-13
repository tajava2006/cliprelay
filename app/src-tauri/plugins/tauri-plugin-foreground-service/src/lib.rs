use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.hoppe.cliprelay.foreground";

/// Foreground Service 플러그인 초기화.
///
/// Android에서만 동작한다.
/// 데스크탑에서는 등록만 되고 커맨드 호출 시 무시된다.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("foreground-service")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(PLUGIN_IDENTIFIER, "ForegroundServicePlugin")?;
            Ok(())
        })
        .build()
}
