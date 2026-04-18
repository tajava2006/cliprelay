const COMMANDS: &[&str] = &[
    "start_service",
    "stop_service",
    "is_running",
    "get_permission_status",
    "request_notification_permission",
    "request_battery_exemption",
    "start_native_subscription",
    "stop_native_subscription",
    "consume_native_events",
    "set_app_foreground",
    "request_receiver_channel_high",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
