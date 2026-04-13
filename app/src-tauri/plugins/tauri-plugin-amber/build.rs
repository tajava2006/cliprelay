const COMMANDS: &[&str] = &[
    "is_installed",
    "get_public_key",
    "sign_event",
    "nip44_encrypt",
    "nip44_decrypt",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
