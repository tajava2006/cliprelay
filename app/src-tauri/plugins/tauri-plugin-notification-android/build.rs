const COMMANDS: &[&str] = &[
    "show_received",
    "dismiss",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
