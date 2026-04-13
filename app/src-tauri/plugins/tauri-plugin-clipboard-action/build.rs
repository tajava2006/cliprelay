const COMMANDS: &[&str] = &[
    "get_pending_sync",
    "consume_pending_copy",
    "clear_pending_sync",
    "consume_pending_history",
    "write_image_to_clipboard",
    "read_clipboard_text",
    "read_clipboard_image",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
