//! The webview's storage (the pairing, the settings and the outbox of daylight-share.js): one JSON file per key in
//! `%APPDATA%\com.daylight.share.windows\store`, written atomically and durably (atomic.rs). Values arrive as JSON
//! text and are not parsed here: the page checks what it reads and has a damaged file set aside (kv_set_aside).

use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager};

pub use crate::atomic::write_atomic;

pub fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("store")).map_err(|e| format!("no data folder: {e}"))
}

/// Keys are short ASCII names such as `outbox` or `outbox/<hex id>`; `/` becomes `~` in the file name.
fn file_for(dir: &Path, key: &str) -> Result<PathBuf, String> {
    let ok = !key.is_empty()
        && key.len() <= 120
        && !key.contains("..")
        && key.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'));
    if !ok {
        return Err(format!("bad storage key {key:?}"));
    }
    Ok(dir.join(format!("{}.json", key.replace('/', "~"))))
}

#[tauri::command]
pub async fn kv_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = file_for(&dir(&app)?, &key)?;
    match fs::read(&path) {
        // Damage that isn't valid UTF-8 still reaches the page as text, which then sets the file aside.
        Ok(b) => Ok(Some(String::from_utf8(b).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned()))),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("couldn't read {key}: {e}")),
    }
}

#[tauri::command]
pub async fn kv_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let path = file_for(&dir(&app)?, &key)?;
    write_atomic(&path, value.as_bytes()).map_err(|e| format!("couldn't save {key}: {e}"))
}

#[tauri::command]
pub async fn kv_remove(app: AppHandle, key: String) -> Result<(), String> {
    let path = file_for(&dir(&app)?, &key)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("couldn't remove {key}: {e}")),
    }
}

/// A file the page couldn't read as what its key holds: renamed to `<file>.bad`, so the key reads as missing.
#[tauri::command]
pub async fn kv_set_aside(app: AppHandle, key: String) -> Result<(), String> {
    let path = file_for(&dir(&app)?, &key)?;
    crate::atomic::set_aside(&path).map_err(|e| format!("couldn't set {key} aside: {e}"))
}
