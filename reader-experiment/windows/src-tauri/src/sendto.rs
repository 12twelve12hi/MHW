//! File Explorer's "Send to > Daylight": a shortcut to the app in the user's SendTo folder. Explorer starts its target
//! with the chosen files as arguments; the single-instance plugin hands them to the running app.
//!
//! The installer creates the shortcut and the uninstaller removes it (windows/installer-hooks.nsh). The app creates it
//! on its first run too (for the bare .exe), and again when asked in Settings, but never behind the user's back after
//! they deleted it.

use std::path::{Path, PathBuf};

use serde::Serialize;

pub const LINK_NAME: &str = "Daylight.lnk";

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SendTo {
    pub path: String,
    pub exists: bool,
    /// Why the first run couldn't add it ('' when it could).
    pub error: String,
}

pub fn shortcut_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("Microsoft").join("Windows").join("SendTo").join(LINK_NAME))
}

pub fn status() -> SendTo {
    match shortcut_path() {
        Some(p) => SendTo { exists: p.exists(), path: p.display().to_string(), error: String::new() },
        None => SendTo::default(),
    }
}

/// Creates (or replaces) the shortcut, pointing at this executable.
pub fn create() -> Result<SendTo, String> {
    let lnk = shortcut_path().ok_or("no APPDATA folder")?;
    let exe = plain_path(std::env::current_exe().map_err(|e| e.to_string())?);
    if let Some(dir) = lnk.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // COM on a thread of its own, so the UI thread's apartment is left alone.
    let (l, x) = (lnk.clone(), exe.clone());
    std::thread::spawn(move || imp::create_link(&l, &x))
        .join()
        .map_err(|_| "the shortcut thread failed".to_string())??;
    Ok(status())
}

/// The Shell's link APIs refuse verbatim paths (`\\?\C:\...`, what canonicalize returns) with "The parameter is
/// incorrect": give them the plain form.
fn plain_path(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p
    }
}

/// First run: make sure the shortcut exists; later runs leave it alone. `marker` records that the first run happened.
pub fn ensure_once(marker: &Path) -> SendTo {
    if !marker.exists() {
        let made = if status().exists { Ok(status()) } else { create() };
        match made {
            Ok(_) => {
                let _ = crate::store::write_atomic(marker, b"1");
            }
            Err(e) => return SendTo { error: e, ..status() },
        }
    }
    status()
}

#[cfg(windows)]
mod imp {
    use std::path::Path;

    use windows::{
        core::{Interface, HSTRING},
        Win32::{
            System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED},
            UI::Shell::{IShellLinkW, ShellLink},
        },
    };

    pub fn create_link(lnk: &Path, exe: &Path) -> Result<(), String> {
        unsafe {
            let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let result = (|| -> windows::core::Result<()> {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                link.SetPath(&HSTRING::from(exe.as_os_str()))?;
                if let Some(dir) = exe.parent() {
                    link.SetWorkingDirectory(&HSTRING::from(dir.as_os_str()))?;
                }
                link.SetDescription(&HSTRING::from("Send to your Daylight"))?;
                link.SetIconLocation(&HSTRING::from(exe.as_os_str()), 0)?;
                let file: IPersistFile = link.cast()?;
                file.Save(&HSTRING::from(lnk.as_os_str()), true)?;
                Ok(())
            })();
            if init.is_ok() {
                CoUninitialize();
            }
            result.map_err(|e| e.message().to_string())
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn create_link(_lnk: &std::path::Path, _exe: &std::path::Path) -> Result<(), String> {
        Err("Send to shortcuts exist only on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_paths() {
        assert_eq!(plain_path(PathBuf::from(r"\\?\C:\Apps\a.exe")), PathBuf::from(r"C:\Apps\a.exe"));
        assert_eq!(plain_path(PathBuf::from(r"\\?\UNC\srv\share\a.exe")), PathBuf::from(r"\\srv\share\a.exe"));
        assert_eq!(plain_path(PathBuf::from(r"C:\Apps\a.exe")), PathBuf::from(r"C:\Apps\a.exe"));
    }
}
