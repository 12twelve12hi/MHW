//! The webview's storage (the pairing, the settings and the outbox of daylight-share.js): one JSON file per key in
//! `%APPDATA%\com.daylight.share.windows\store`, written atomically. Values arrive as JSON text and are not parsed.

use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use tauri::{AppHandle, Manager};

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

/// Writes through a temporary file and a rename, retrying briefly when another program (a virus scanner, say)
/// holds the file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    static N: AtomicU64 = AtomicU64::new(0);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    fs::write(&tmp, bytes)?;
    let mut attempt = 0;
    loop {
        match fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) if attempt < 6 && e.kind() != ErrorKind::NotFound => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(15 * attempt));
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                return Err(e);
            }
        }
    }
}

#[tauri::command]
pub async fn kv_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = file_for(&dir(&app)?, &key)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
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
