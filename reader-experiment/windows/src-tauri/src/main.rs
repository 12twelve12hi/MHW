//! Send to Daylight for Windows. Rust does what the web page can't: the notification-area icon and its menu, the
//! window (closing it hides it), files named on the command line (File Explorer's Send to), one running copy at a time,
//! pairing links, the clipboard hotkey, notifications, start at login and a data folder. Pairing, sending, the outbox
//! and the window's contents are JavaScript (../src, with ../../share/js/daylight-share.js).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod args;
mod sendto;
mod store;

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WindowEvent, Wry,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_clipboard_manager::ClipboardExt as _;
use tauri_plugin_deep_link::DeepLinkExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt as _, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt as _;

const MAIN: &str = "main";
const PRODUCT: &str = "Send to Daylight";
/// Something is waiting in the action queue (the page then calls take_actions).
const EV_WAKE: &str = "dls://wake";
/// Time for the outbox's periodic acks and re-sends. The page has a timer too; this one also reaches a page that
/// Windows throttles while the window is hidden.
const EV_TICK: &str = "dls://tick";
const EV_AUTOSTART: &str = "dls://autostart";
const TICK_EVERY: Duration = Duration::from_secs(15 * 60);
/// daylight-share.js refuses items over 64 MB.
const MAX_FILE: u64 = 64 * 1024 * 1024;

/// Work for the page, queued until it asks for it (so nothing is lost while it is still loading).
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Action {
    /// Files to send (Send to, or a launch with file arguments).
    Files { paths: Vec<String> },
    /// A daylightshare: pairing link.
    Pair { link: String },
    /// The clipboard's text, for "Send the link on the clipboard" (the hotkey or the tray menu).
    Clipboard { text: String, error: String },
}

#[derive(Default)]
struct E2e {
    pair: Option<String>,
    status: Option<PathBuf>,
}

#[derive(Default)]
struct AppState {
    actions: Mutex<Vec<Action>>,
    /// Files the page may read: only those named on a command line.
    readable: Mutex<HashSet<PathBuf>>,
    hotkey: Mutex<String>,
    autostart_item: Mutex<Option<CheckMenuItem<Wry>>>,
    send_to: Mutex<sendto::SendTo>,
    e2e: E2e,
}

fn state(app: &AppHandle) -> tauri::State<'_, AppState> {
    app.state::<AppState>()
}

/// Notes a problem: on stderr, and in test mode next to the status file (`<status>.log`), for the CI logs.
fn diag(app: &AppHandle, msg: impl std::fmt::Display) {
    eprintln!("Send to Daylight: {msg}");
    if let Some(status) = &state(app).e2e.status {
        use std::io::Write;
        let mut p = status.clone().into_os_string();
        p.push(".log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{msg}");
        }
    }
}

fn push(app: &AppHandle, actions: Vec<Action>) {
    if actions.is_empty() {
        return;
    }
    state(app).actions.lock().unwrap().extend(actions);
    let _ = app.emit(EV_WAKE, ());
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn clipboard_action(app: &AppHandle) -> Action {
    match app.clipboard().read_text() {
        Ok(text) => Action::Clipboard { text, error: String::new() },
        Err(e) => Action::Clipboard { text: String::new(), error: e.to_string() },
    }
}

/// Turns a launch (ours, or a second one forwarded here) into work for the page.
fn handle_launch(app: &AppHandle, launch: args::Launch, forwarded: bool) {
    let st = state(app);
    let mut actions = Vec::new();
    let show = (forwarded && launch.is_plain() && !launch.autostart) || !launch.links.is_empty();
    if !launch.paths.is_empty() {
        st.readable.lock().unwrap().extend(launch.paths.iter().cloned());
        actions.push(Action::Files { paths: launch.paths.iter().map(|p| p.display().to_string()).collect() });
    }
    for link in launch.links {
        actions.push(Action::Pair { link });
    }
    // The test hooks work only in an app started in test mode.
    if launch.e2e_hotkey && st.e2e.status.is_some() {
        actions.push(clipboard_action(app));
    }
    if launch.e2e_autostart && st.e2e.status.is_some() {
        if let Err(e) = apply_autostart(app, true) {
            diag(app, format!("start at login: {e}"));
        }
    }
    push(app, actions);
    if show {
        show_main(app);
    }
}

// --- commands for the page --------------------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct E2eInfo {
    pair: Option<String>,
    status: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    version: String,
    e2e: E2eInfo,
    send_to: sendto::SendTo,
    autostart: bool,
}

#[tauri::command]
fn app_info(app: AppHandle) -> Info {
    let st = state(&app);
    let send_to = st.send_to.lock().unwrap().clone();
    Info {
        version: app.package_info().version.to_string(),
        e2e: E2eInfo { pair: st.e2e.pair.clone(), status: st.e2e.status.is_some() },
        send_to,
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
    }
}

#[tauri::command]
fn take_actions(app: AppHandle) -> Vec<Action> {
    std::mem::take(&mut *state(&app).actions.lock().unwrap())
}

/// Reads a file named on a command line (the page can't open files by path itself). -> its bytes (an ArrayBuffer).
#[tauri::command]
async fn read_file(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(&path);
    if !state(&app).readable.lock().unwrap().contains(&p) {
        return Err("That file wasn’t offered to Send to Daylight.".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let meta = std::fs::metadata(&p).map_err(|e| format!("Couldn’t open it ({e})."))?;
        if meta.is_dir() {
            return Err("Folders can’t be sent; send the files inside.".into());
        }
        if meta.len() > MAX_FILE {
            return Err("That file is larger than 64 MB.".into());
        }
        std::fs::read(&p).map_err(|e| format!("Couldn’t read it ({e})."))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn read_clipboard(app: AppHandle) -> Result<String, String> {
    app.clipboard().read_text().map_err(|e| e.to_string())
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

#[tauri::command]
fn show_window(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.hide();
    }
}

/// Registers the clipboard hotkey ("" turns it off). -> the accelerator now registered.
#[tauri::command]
async fn set_hotkey(app: AppHandle, accel: String) -> Result<String, String> {
    let accel = accel.trim().to_string();
    let gs = app.global_shortcut();
    let st = state(&app);
    let mut current = st.hotkey.lock().unwrap();
    if !current.is_empty() {
        let _ = gs.unregister(current.as_str());
        current.clear();
    }
    if accel.is_empty() {
        return Ok(String::new());
    }
    Shortcut::from_str(&accel).map_err(|_| "That isn’t a key combination Windows can use.".to_string())?;
    gs.register(accel.as_str())
        .map_err(|_| format!("Another app (or Windows) already uses {}.", accel.replace('+', " + ")))?;
    *current = accel.clone();
    Ok(accel)
}

fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<bool, String> {
    let al = app.autolaunch();
    let r = if enabled { al.enable() } else { al.disable() };
    if enabled && r.is_ok() {
        if let Err(e) = quote_autostart_entry() {
            diag(app, format!("couldn't quote the start-at-login entry: {e}"));
        }
    }
    let now = al.is_enabled().unwrap_or(false);
    if let Some(item) = state(app).autostart_item.lock().unwrap().as_ref() {
        let _ = item.set_checked(now);
    }
    let _ = app.emit(EV_AUTOSTART, now);
    r.map(|_| now).map_err(|e| e.to_string())
}

/// The plugin writes `C:\...\Send to Daylight\send-to-daylight.exe --autostart` to the Run key without quotes, and the
/// install folder has spaces: quote the path, so Windows can't mistake `...\Send` for the program.
#[cfg(windows)]
fn quote_autostart_entry() -> Result<(), String> {
    let key = windows_registry::CURRENT_USER
        .create(r"Software\Microsoft\Windows\CurrentVersion\Run")
        .map_err(|e| e.to_string())?;
    if key.get_string(PRODUCT).is_ok() {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        key.set_string(PRODUCT, format!("\"{}\" --autostart", exe.display())).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn quote_autostart_entry() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    apply_autostart(&app, enabled)
}

#[tauri::command]
fn add_send_to(app: AppHandle) -> Result<sendto::SendTo, String> {
    let s = sendto::create()?;
    *state(&app).send_to.lock().unwrap() = s.clone();
    Ok(s)
}

/// Test mode only: the page's view of the outbox, for the end-to-end test.
#[tauri::command]
async fn e2e_status(app: AppHandle, json: String) -> Result<(), String> {
    let Some(path) = state(&app).e2e.status.clone() else { return Ok(()) };
    store::write_atomic(&path, json.as_bytes()).map_err(|e| e.to_string())
}

// --- the notification-area icon -----------------------------------------------------------------------------------------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let send = MenuItem::with_id(app, "send-clipboard", "Send clipboard link", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start at login", true, autostart_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&send, &open, &PredefinedMenuItem::separator(app)?, &autostart, &PredefinedMenuItem::separator(app)?, &quit],
    )?;
    *state(app).autostart_item.lock().unwrap() = Some(autostart.clone());

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip(PRODUCT)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "send-clipboard" => push(app, vec![clipboard_action(app)]),
            "open" => show_main(app),
            "autostart" => {
                // The menu has already flipped the check mark; make the setting match it.
                let want = state(app).autostart_item.lock().unwrap().as_ref().and_then(|i| i.is_checked().ok()).unwrap_or(false);
                if let Err(e) = apply_autostart(app, want) {
                    diag(app, format!("start at login: {e}"));
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn main() {
    // args_os: a file name that isn't valid Unicode must not crash the app (it then fails to open, with a message).
    let argv: Vec<String> = std::env::args_os().skip(1).map(|a| a.to_string_lossy().into_owned()).collect();
    let cwd = std::env::current_dir().unwrap_or_default();
    let launch = args::parse(&argv, &cwd);
    let e2e = E2e { pair: launch.e2e_pair.clone(), status: launch.e2e_status.clone() };

    let app = tauri::Builder::default()
        // First: a second launch hands its arguments to this one and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let rest: Vec<String> = argv.into_iter().skip(1).collect();
            handle_launch(app, args::parse(&rest, Path::new(&cwd)), true);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::Builder::new().app_name(PRODUCT).arg("--autostart").build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        push(app, vec![clipboard_action(app)]);
                    }
                })
                .build(),
        )
        .manage(AppState { e2e, ..Default::default() })
        .invoke_handler(tauri::generate_handler![
            app_info,
            take_actions,
            read_file,
            read_clipboard,
            notify,
            show_window,
            hide_window,
            set_hotkey,
            set_autostart,
            add_send_to,
            e2e_status,
            store::kv_get,
            store::kv_set,
            store::kv_remove,
        ])
        .on_window_event(|window, event| {
            // Closing the window keeps the app in the notification area.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            // (Never the arguments themselves: a pairing link carries the key.)
            diag(&handle, format!(
                "started {}: {} files, {} links, autostart {}, test mode {}",
                handle.package_info().version, launch.paths.len(), launch.links.len(), launch.autostart, launch.is_e2e()
            ));
            // Without the icon (no notification area, say) the window, Send to and the hotkey still work.
            if let Err(e) = build_tray(&handle) {
                diag(&handle, format!("no notification-area icon: {e}"));
            }

            // daylightshare: links open this app (the installer registers the scheme; this covers the bare .exe).
            let dl = handle.deep_link();
            if !dl.is_registered(args::SCHEME).unwrap_or(false) {
                if let Err(e) = dl.register(args::SCHEME) {
                    diag(&handle, format!("couldn't register {}: links: {e}", args::SCHEME));
                }
            }

            // File Explorer's Send to > Daylight, on the first run.
            let marker = handle.path().app_data_dir().map(|d| d.join("send-to-added")).unwrap_or_default();
            let send_to = sendto::ensure_once(&marker);
            diag(&handle, format!("Send to shortcut {} exists: {} {}", send_to.path, send_to.exists, send_to.error));
            *state(&handle).send_to.lock().unwrap() = send_to;

            // Acks and re-sends every 15 minutes, even while Windows throttles the hidden page.
            let ticker = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(TICK_EVERY);
                let _ = ticker.emit(EV_TICK, ());
            });

            let plain = launch.is_plain() && !launch.autostart && !launch.is_e2e();
            handle_launch(&handle, launch, false);
            if plain {
                show_main(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while starting Send to Daylight");

    app.run(|_app, event| {
        // Stay in the notification area when the last window closes; Quit (app.exit) still exits.
        if let RunEvent::ExitRequested { api, code: None, .. } = event {
            api.prevent_exit();
        }
    });
}
