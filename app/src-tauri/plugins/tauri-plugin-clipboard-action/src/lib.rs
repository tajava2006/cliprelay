use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.hoppe.cliprelay.clipaction";

/// 클립보드 액션 플러그인 초기화.
///
/// ClipboardActionActivity가 읽은 클립보드 데이터를 TS로 전달하는 브릿지.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("clipboard-action")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(PLUGIN_IDENTIFIER, "ClipboardActionPlugin")?;
            Ok(())
        })
        .build()
}
