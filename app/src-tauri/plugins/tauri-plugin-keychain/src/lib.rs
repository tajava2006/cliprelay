use serde::Serialize;
use tauri::{
    command,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[derive(Serialize)]
struct GetSecretResponse {
    value: Option<String>,
}

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.hoppe.cliprelay.keychain";

const SERVICE: &str = "com.hoppe.cliprelay";

// ─── 데스크탑 구현 (keyring 크레이트) ────────────────────────────

#[cfg(not(target_os = "android"))]
#[command]
fn set_secret(key: String, value: String) -> Result<(), String> {
    keyring::Entry::new(SERVICE, &key)
        .and_then(|entry| entry.set_secret(value.as_bytes()))
        .map_err(|e| format!("keychain set failed: {e}"))
}

#[cfg(not(target_os = "android"))]
#[command]
fn get_secret(key: String) -> Result<GetSecretResponse, String> {
    let entry = keyring::Entry::new(SERVICE, &key).map_err(|e| format!("keychain entry failed: {e}"))?;
    match entry.get_secret() {
        Ok(val) => {
            let s = String::from_utf8(val).map_err(|e| format!("keychain utf8 decode failed: {e}"))?;
            Ok(GetSecretResponse { value: Some(s) })
        }
        Err(keyring::Error::NoEntry) => Ok(GetSecretResponse { value: None }),
        Err(e) => Err(format!("keychain get failed: {e}")),
    }
}

#[cfg(not(target_os = "android"))]
#[command]
fn delete_secret(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &key).map_err(|e| format!("keychain entry failed: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete failed: {e}")),
    }
}

// ─── Android: Kotlin 플러그인으로 위임 ──────────────────────────

#[cfg(target_os = "android")]
#[command]
fn set_secret() -> Result<(), String> {
    // Android에서는 Kotlin @Command로 직접 처리됨
    Ok(())
}

#[cfg(target_os = "android")]
#[command]
fn get_secret() -> Result<GetSecretResponse, String> {
    Ok(GetSecretResponse { value: None })
}

#[cfg(target_os = "android")]
#[command]
fn delete_secret() -> Result<(), String> {
    Ok(())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("keychain")
        .invoke_handler(tauri::generate_handler![set_secret, get_secret, delete_secret])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(PLUGIN_IDENTIFIER, "KeychainPlugin")?;
            Ok(())
        })
        .build()
}
