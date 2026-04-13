const COMMANDS: &[&str] = &[
    "start_service",
    "stop_service",
    "is_running",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
