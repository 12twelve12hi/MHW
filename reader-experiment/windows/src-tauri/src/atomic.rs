//! Writing a file so that it is either the old content or the new, never a mix or nothing: the new content goes to a
//! temporary file in the same folder, is flushed to the disk, then renamed over the old one. Without the flush, a
//! power cut or a crash of Windows soon after the rename can leave the file empty or zero-filled (NTFS may keep the
//! rename but not the data), and the outbox is rewritten several times per send.
//!
//! Plain std, so the tests run anywhere: `rustc --edition 2021 --test src/atomic.rs -o atomic-test && ./atomic-test`

use std::{
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

fn temp_for(path: &Path) -> PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    path.with_extension(format!("tmp{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)))
}

/// Writes `bytes` to `path` atomically and durably, creating the folder if needed. The rename is retried briefly
/// when another program (a virus scanner, say) holds the file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = temp_for(path);
    let written = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
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

/// Renames a damaged file aside to `<name>.bad` (replacing an older one), so the next read finds nothing and a later
/// write starts afresh, while the damaged content stays for a look. Nothing there is fine.
pub fn set_aside(path: &Path) -> std::io::Result<()> {
    let mut bad = path.as_os_str().to_owned();
    bad.push(".bad");
    match fs::rename(path, PathBuf::from(bad)) {
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        r => r,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("dls-atomic-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn writes_replaces_and_leaves_no_temporary_file() {
        let d = dir("write");
        let p = d.join("store").join("outbox.json");
        write_atomic(&p, b"[1]").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"[1]");
        write_atomic(&p, "[{\"title\":\"Ünï ✓\"}]".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "[{\"title\":\"Ünï ✓\"}]");
        let names: Vec<_> = fs::read_dir(p.parent().unwrap()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("outbox.json")]);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn sets_a_damaged_file_aside() {
        let d = dir("aside");
        fs::create_dir_all(&d).unwrap();
        let p = d.join("outbox.json");
        fs::write(&p, [0u8; 16]).unwrap();
        set_aside(&p).unwrap();
        assert!(!p.exists());
        assert_eq!(fs::read(d.join("outbox.json.bad")).unwrap(), [0u8; 16]);
        fs::write(&p, b"").unwrap();
        set_aside(&p).unwrap();
        assert_eq!(fs::read(d.join("outbox.json.bad")).unwrap(), b"", "a newer damaged file replaces the older one");
        set_aside(&p).unwrap();
        let _ = fs::remove_dir_all(&d);
    }
}
