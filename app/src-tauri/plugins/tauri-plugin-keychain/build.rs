const COMMANDS: &[&str] = &["set_secret", "get_secret", "delete_secret"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
