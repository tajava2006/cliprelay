#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// 비밀번호 매니저들이 클립보드에 붙이는 사실상 표준 마커 (nspasteboard.org).
/// 이 타입이 실려 있으면 "민감 정보 — 오래 남기지 마라"는 뜻이다.
#[cfg(target_os = "macos")]
const CONCEALED_TYPE: &str = "org.nspasteboard.ConcealedType";

/// Windows에서 클립보드 모니터/히스토리 제외를 뜻하는 등록 포맷 (MS 권장 규약)
#[cfg(target_os = "windows")]
const WIN_EXCLUDE_FORMAT: &str = "ExcludeClipboardContentFromMonitorProcessing";

/// 현재 클립보드에 concealed 마커가 있는가.
/// macOS: ConcealedType 타입 존재 / Windows: 제외 포맷 존재 /
/// Linux: 감지 불가(항상 false — X11/Wayland 타깃 조회는 라이브러리 지원이 없다.
/// 쓰기 방향의 KDE 힌트 전파는 지원함)
#[tauri::command]
fn clipboard_is_concealed() -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSPasteboard;
        let pb = NSPasteboard::generalPasteboard();
        if let Some(types) = pb.types() {
            return types.iter().any(|t| t.to_string() == CONCEALED_TYPE);
        }
        false
    }
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::DataExchange::{
            IsClipboardFormatAvailable, RegisterClipboardFormatW,
        };
        let name: Vec<u16> = WIN_EXCLUDE_FORMAT.encode_utf16().chain([0]).collect();
        unsafe {
            let fmt = RegisterClipboardFormatW(name.as_ptr());
            fmt != 0 && IsClipboardFormatAvailable(fmt) != 0
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

/// 텍스트를 concealed 마커와 함께 클립보드에 쓴다 — 받는 기기의 클립보드
/// 매니저/히스토리도 이 항목을 민감 정보로 취급하게 된다.
/// macOS: ConcealedType / Windows: 모니터 제외 포맷 / Linux: KDE 힌트.
/// 실패 시 Err — 호출자가 일반 쓰기로 폴백한다.
#[tauri::command]
fn write_clipboard_text_concealed(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        use objc2_foundation::{NSArray, NSString};
        unsafe {
            let pb = NSPasteboard::generalPasteboard();
            let concealed = NSString::from_str(CONCEALED_TYPE);
            let types = NSArray::from_slice(&[NSPasteboardTypeString, &*concealed]);
            pb.declareTypes_owner(&types, None);
            let ok = pb.setString_forType(&NSString::from_str(&text), NSPasteboardTypeString);
            // 마커는 타입의 존재 자체가 신호 — 값은 빈 문자열이면 충분
            pb.setString_forType(&NSString::from_str(""), &concealed);
            if ok {
                Ok(())
            } else {
                Err("failed to write string to pasteboard".into())
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        use arboard::{Clipboard, SetExtWindows};
        let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
        // exclude_from_monitoring이 히스토리·클라우드까지 포괄한다 (arboard 문서상
        // 이걸 쓰면 나머지 둘은 중복)
        cb.set()
            .exclude_from_monitoring()
            .text(text)
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        use arboard::{Clipboard, SetExtLinux};
        // X11/Wayland은 클립보드 소유 프로세스가 내용을 서빙하는 모델이라,
        // Clipboard 객체가 drop되면 붙여넣기가 실패할 수 있다 — 전역으로 유지.
        static CLIPBOARD: std::sync::Mutex<Option<Clipboard>> = std::sync::Mutex::new(None);
        let mut guard = CLIPBOARD.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            *guard = Some(Clipboard::new().map_err(|e| e.to_string())?);
        }
        // exclude_from_history = x-kde-passwordManagerHint("secret") MIME 동봉
        guard
            .as_mut()
            .unwrap()
            .set()
            .exclude_from_history()
            .text(text)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = text;
        Err("concealed clipboard write unsupported on this platform".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            clipboard_is_concealed,
            write_clipboard_text_concealed
        ])
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_amber::init())
        .plugin(tauri_plugin_foreground_service::init())
        .plugin(tauri_plugin_clipboard_action::init())
        .plugin(tauri_plugin_keychain::init());

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // macOS: 독 아이콘 숨김 (트레이 전용 앱)
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // 트레이 우클릭 메뉴
            let open_item = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        // 창 닫기(X) → 종료 대신 트레이로 숨김
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
