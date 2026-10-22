//! Send to Daylight for Windows. Rust does what the web page can't: the notification-area icon and its menu, the
//! window (closing it hides it), files named on the command line (File Explorer's Send to), one running copy at a time,
//! pairing links, the clipboard hotkey, notifications, start at login and a data folder. Pairing, sending, the outbox
//! and the window's contents are JavaScript (../src, with ../../share/js/daylight-share.js).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod args;
mod atomic;
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
/// Never read more than this into memory for the page: the protocol's largest item (MAX_ITEM, 9,000,000 bytes, in
/// revision 1.1). The page asks for the same limit.
const MAX_FILE: u64 = 9_000_000;
/// Start at login as the user set it in this app: a file in the data folder that exists while it is on. An update
/// that runs the old uninstaller loses this user's Run entry; the installer (windows/installer-hooks.nsh, which names
/// this file too) and the app's next start put it back.
const AUTOSTART_MARKER: &str = "start-at-login";
#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// Work for the page, queued until it asks for it (so nothing is lost while it is still loading).
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Action {
    /// Files to send (Send to, or a launch with file arguments).
    Files { paths: Vec<String> },
    /// A daylightshare: pairing link.
    Pair { link: String },
    /// A daylightshare://send link (Lab, LAB-PLAN F09): the page asks before sending, unless quick sends are allowed.
    Send { link: String },
    /// The clipboard's text, for "Send the link on the clipboard" (the hotkey or the tray menu).
    Clipboard { text: String, error: String },
    /// Test mode only: "confirm" or "cancel" answers the pairing question, as its buttons do.
    Test { hook: String },
}

#[derive(Default)]
struct E2e {
    pair: Option<String>,
    status: Option<PathBuf>,
    /// `--e2e-lab 0|1` (LAB-PLAN 1.7): kept only when the app was started in test mode.
    lab: Option<bool>,
}

#[derive(Default)]
struct AppState {
    actions: Mutex<Vec<Action>>,
    /// Files the page may read: only those named on a command line.
    readable: Mutex<HashSet<PathBuf>>,
    hotkey: Mutex<String>,
    autostart_item: Mutex<Option<CheckMenuItem<Wry>>>,
    /// The tray's clipboard entry, which the page renames with Lab (F33: "Send copied link").
    send_item: Mutex<Option<MenuItem<Wry>>>,
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
    // The page shows the window when it asks (or says why it can't send); a quick send stays in the notification area.
    for link in launch.sends {
        actions.push(Action::Send { link });
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
    if st.e2e.status.is_some() {
        for (on, hook) in [(launch.e2e_confirm, "confirm"), (launch.e2e_cancel, "cancel")] {
            if on {
                actions.push(Action::Test { hook: hook.into() });
            }
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
    lab: Option<bool>,
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
        e2e: E2eInfo { pair: st.e2e.pair.clone(), status: st.e2e.status.is_some(), lab: st.e2e.lab },
        send_to,
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
    }
}

#[tauri::command]
fn take_actions(app: AppHandle) -> Vec<Action> {
    std::mem::take(&mut *state(&app).actions.lock().unwrap())
}

/// Reads a file named on a command line (the page can't open files by path itself). -> its bytes (an ArrayBuffer).
/// A file over `max` bytes isn't read: the answer is the error "too-large:<size>", which the page words.
#[tauri::command]
async fn read_file(app: AppHandle, path: String, max: Option<u64>) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(&path);
    if !state(&app).readable.lock().unwrap().contains(&p) {
        return Err("That file wasn’t offered to Send to Daylight.".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let meta = std::fs::metadata(&p).map_err(|e| format!("Couldn’t open it ({e})."))?;
        if meta.is_dir() {
            return Err("Folders can’t be sent; send the files inside.".into());
        }
        let limit = max.unwrap_or(MAX_FILE).min(MAX_FILE);
        if meta.len() > limit {
            return Err(format!("too-large:{}", meta.len()));
        }
        // Read at most one byte past the limit, in case the file grew since it was measured.
        use std::io::Read as _;
        let file = std::fs::File::open(&p).map_err(|e| format!("Couldn’t read it ({e})."))?;
        let mut bytes = Vec::with_capacity(meta.len() as usize);
        file.take(limit + 1).read_to_end(&mut bytes).map_err(|e| format!("Couldn’t read it ({e})."))?;
        if bytes.len() as u64 > limit {
            return Err(format!("too-large:{}", std::fs::metadata(&p).map(|m| m.len()).unwrap_or(bytes.len() as u64)));
        }
        Ok(bytes)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn read_clipboard(app: AppHandle) -> Result<String, String> {
    app.clipboard().read_text().map_err(|e| e.to_string())
}

/// Lab's Copy (the Server code, LAB-PLAN 2.6): the clipboard from Rust, which needs no focus or permission in WebView2.
#[tauri::command]
fn write_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

/// The tray's clipboard entry in the page's words: v1.1's "Send clipboard link", or with Lab on "Send copied link"
/// (LAB-PLAN F33). Without a tray (no notification area) there is nothing to rename.
#[tauri::command]
fn set_clipboard_label(app: AppHandle, text: String) -> Result<(), String> {
    let text: String = text.trim().chars().take(60).collect();
    if text.is_empty() {
        return Err("No label.".into());
    }
    match state(&app).send_item.lock().unwrap().as_ref() {
        Some(item) => item.set_text(text).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Whether Windows lets this app show notifications (Setup check, LAB-PLAN F26): "on", "off" (turned off in Settings
/// › System › Notifications, for this app or all, or by policy) or "unknown" (Windows didn't say). It asks about the
/// same app id the notification plugin shows them under: the app's identifier once installed, PowerShell's when it runs
/// from a build folder.
#[tauri::command]
fn notifications_state(app: AppHandle) -> String {
    notification_setting(&app.config().identifier).unwrap_or_else(|e| {
        diag(&app, format!("notifications: {e}"));
        "unknown".into()
    })
}

#[cfg(windows)]
fn notification_setting(identifier: &str) -> Result<String, String> {
    use windows::{
        core::HSTRING,
        UI::Notifications::{NotificationSetting, ToastNotificationManager},
    };
    const POWERSHELL_APP_ID: &str = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().map(|d| d.display().to_string()).unwrap_or_default();
    let from_build = dir.ends_with("\\target\\debug") || dir.ends_with("\\target\\release");
    let id = if from_build { POWERSHELL_APP_ID } else { identifier };
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(id)).map_err(|e| e.to_string())?;
    let setting = notifier.Setting().map_err(|e| e.to_string())?;
    Ok(if setting == NotificationSetting::Enabled { "on" } else { "off" }.into())
}

#[cfg(not(windows))]
fn notification_setting(_identifier: &str) -> Result<String, String> {
    Err("not Windows".into())
}

/// Setup check's Open Settings for notifications (F26): Windows' Settings › System › Notifications. A fixed address:
/// the page can't open anything else with it.
#[tauri::command]
fn open_notification_settings() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe").arg("ms-settings:notifications").spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Err("Only on Windows.".into())
    }
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
        if let Err(e) = autostart_per_user() {
            diag(app, format!("start at login: {e}"));
        }
    }
    let now = al.is_enabled().unwrap_or(false);
    remember_autostart(app, now);
    if let Some(item) = state(app).autostart_item.lock().unwrap().as_ref() {
        let _ = item.set_checked(now);
    }
    let _ = app.emit(EV_AUTOSTART, now);
    r.map(|_| now).map_err(|e| e.to_string())
}

/// Start at login is per user, like the install: the plugin writes the Run entry for every user (HKLM) when the app
/// runs elevated, which the per-user uninstaller wouldn't remove, and leaves the path unquoted though the install
/// folder has spaces. So keep one quoted entry in this user's Run key.
#[cfg(windows)]
fn autostart_per_user() -> Result<(), String> {
    use windows_registry::{CURRENT_USER, LOCAL_MACHINE};
    const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    CURRENT_USER
        .create(RUN_KEY)
        .and_then(|k| k.set_string(PRODUCT, format!("\"{}\" --autostart", exe.display())))
        .map_err(|e| e.to_string())?;
    for path in [RUN_KEY, APPROVED] {
        if let Ok(k) = LOCAL_MACHINE.options().read().write().open(path) {
            if k.get_value(PRODUCT).is_ok() {
                let _ = k.remove_value(PRODUCT);
            }
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn autostart_per_user() -> Result<(), String> {
    Ok(())
}

/// Whether this user's Run key has the app's entry (whatever Task Manager says about it).
#[cfg(windows)]
fn run_entry_exists() -> bool {
    windows_registry::CURRENT_USER.open(RUN_KEY).and_then(|k| k.get_value(PRODUCT)).is_ok()
}

#[cfg(not(windows))]
fn run_entry_exists() -> bool {
    true
}

fn autostart_marker(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(AUTOSTART_MARKER))
}

/// Keeps the user's choice in the data folder (AUTOSTART_MARKER), where an update doesn't reach it.
fn remember_autostart(app: &AppHandle, on: bool) {
    let Some(marker) = autostart_marker(app) else { return };
    let r = if on {
        marker.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|_| std::fs::write(&marker, "on\n"))
    } else {
        match std::fs::remove_file(&marker) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            r => r,
        }
    };
    if let Err(e) = r {
        diag(app, format!("start at login: couldn't remember the setting: {e}"));
    }
}

/// At start: when the user had start at login on and the Run entry is gone (the default "Uninstall before installing"
/// of an update removes it), puts the entry back. Only the entry: a "Disabled" set in Task Manager or Settings > Apps >
/// Startup is kept apart (StartupApproved) and still holds. A choice made by a version from before the marker existed
/// is remembered now.
fn restore_autostart(app: &AppHandle) {
    let Some(marker) = autostart_marker(app) else { return };
    if marker.exists() {
        if !run_entry_exists() {
            match autostart_per_user() {
                Ok(()) => diag(app, "start at login: put this user's Run entry back (an update had removed it)"),
                Err(e) => diag(app, format!("start at login: couldn't put the Run entry back: {e}")),
            }
        }
    } else if app.autolaunch().is_enabled().unwrap_or(false) {
        remember_autostart(app, true);
    }
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
    *state(app).send_item.lock().unwrap() = Some(send.clone());

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
    let e2e = E2e {
        pair: launch.e2e_pair.clone(),
        status: launch.e2e_status.clone(),
        lab: if launch.is_e2e() { launch.e2e_lab } else { None },
    };

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
            write_clipboard,
            notify,
            set_clipboard_label,
            notifications_state,
            open_notification_settings,
            show_window,
            hide_window,
            set_hotkey,
            set_autostart,
            add_send_to,
            e2e_status,
            store::kv_get,
            store::kv_set,
            store::kv_remove,
            store::kv_set_aside,
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
            // Before the tray reads it for its check mark.
            restore_autostart(&handle);
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
