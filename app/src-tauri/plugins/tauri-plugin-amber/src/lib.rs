use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.hoppe.cliprelay.amber";

/// Amber 플러그인 초기화.
///
/// Rust command를 정의하지 않음 — TS의 invoke('plugin:amber|...')가
/// Kotlin @Command 메서드로 직접 전달된다.
/// startActivityForResult 비동기 패턴이 run_mobile_plugin의 동기 블로킹과
/// 호환되지 않기 때문에 이 방식을 사용한다.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("amber")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(PLUGIN_IDENTIFIER, "AmberPlugin")?;
            Ok(())
        })
        .build()
}
