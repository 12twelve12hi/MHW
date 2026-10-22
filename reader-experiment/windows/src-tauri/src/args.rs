//! What a launch asks for: the app's own command line, or a second launch's, which the single-instance plugin
//! forwards to the running app. File Explorer's "Send to > Daylight" starts `send-to-daylight.exe <file>...`; a
//! clicked `daylightshare://pair?...` link starts `send-to-daylight.exe "daylightshare://pair?..."`, and a
//! `daylightshare://send?url=...` link (Lab, LAB-PLAN F09) `send-to-daylight.exe "daylightshare://send?..."`.
//!
//! Plain std, so the tests run anywhere: `rustc --edition 2021 --test src/args.rs -o args-test && ./args-test`

use std::path::{Path, PathBuf};

/// The pairing link scheme (PROTOCOL 1.3).
pub const SCHEME: &str = "daylightshare";

#[derive(Debug, Default, PartialEq)]
pub struct Launch {
    /// Files to send, absolute (relative arguments are taken against the launch's working folder).
    pub paths: Vec<PathBuf>,
    /// `daylightshare:` pairing links.
    pub links: Vec<String>,
    /// `daylightshare://send?url=...&title=...[&text=...][&quick=1]` links (Lab, LAB-PLAN F09): the page reads them,
    /// asks before sending (unless the user allowed quick sends) and answers with Lab off. Never a file path.
    pub sends: Vec<String>,
    /// Started at sign-in by the autostart entry: stay in the notification area.
    pub autostart: bool,
    /// Test mode: pair with this link without showing anything.
    pub e2e_pair: Option<String>,
    /// Test mode: keep this file updated with the outbox as JSON.
    pub e2e_status: Option<PathBuf>,
    /// Test hook: do what the clipboard hotkey does (only a running app in test mode honours it).
    pub e2e_hotkey: bool,
    /// Test hook: turn start at login on, as the tray menu does (only a running app in test mode honours it).
    pub e2e_autostart: bool,
    /// Test hooks: press the pairing question's button, or Cancel (only a running app in test mode honours them).
    pub e2e_confirm: bool,
    pub e2e_cancel: bool,
    /// Test mode: `--e2e-lab 0|1` sets the Lab switch (LAB-PLAN 1.7) before the window draws, as the user would in
    /// Settings, and keeps it. Read at start, and only by an app started in test mode; any other value is ignored.
    pub e2e_lab: Option<bool>,
}

impl Launch {
    /// Nothing to send or pair: a plain launch (from the Start menu, say).
    pub fn is_plain(&self) -> bool {
        self.paths.is_empty()
            && self.links.is_empty()
            && self.sends.is_empty()
            && !self.e2e_hotkey
            && !self.e2e_autostart
            && !self.e2e_confirm
            && !self.e2e_cancel
    }

    /// Started by the end-to-end test.
    pub fn is_e2e(&self) -> bool {
        self.e2e_pair.is_some() || self.e2e_status.is_some()
    }
}

/// True for `daylightshare:...` in any letter case.
pub fn is_pairing_link(s: &str) -> bool {
    s.len() > SCHEME.len() && s.is_char_boundary(SCHEME.len() + 1) && s[..SCHEME.len() + 1].eq_ignore_ascii_case("daylightshare:")
}

/// True for a `daylightshare://send` link (F09), in any letter case: `send` is the link's host, followed by nothing, a
/// `/`, a `?` or a `#`. Every other `daylightshare:` link stays a pairing link, as it always was.
pub fn is_send_link(s: &str) -> bool {
    if !is_pairing_link(s) {
        return false;
    }
    let rest = &s[SCHEME.len() + 1..];
    let Some(rest) = rest.strip_prefix("//") else { return false };
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    rest[..host_end].eq_ignore_ascii_case("send")
}

/// Parses arguments (without the program name). Unknown `--options` are ignored.
pub fn parse<S: AsRef<str>>(args: &[S], cwd: &Path) -> Launch {
    let mut out = Launch::default();
    let mut i = 0;
    while i < args.len() {
        let raw = args[i].as_ref();
        i += 1;
        let a = raw.trim().trim_matches('"');
        if a.is_empty() {
            continue;
        }
        if let Some(opt) = a.strip_prefix("--") {
            let (name, inline) = match opt.split_once('=') {
                Some((n, v)) => (n, Some(v.to_string())),
                None => (opt, None),
            };
            let mut value = || -> Option<String> {
                if inline.is_some() {
                    return inline.clone();
                }
                let v = args.get(i).map(|s| s.as_ref().to_string());
                if v.is_some() {
                    i += 1;
                }
                v
            };
            match name {
                "autostart" => out.autostart = true,
                "e2e-pair" => out.e2e_pair = value().filter(|v| !v.is_empty()),
                "e2e-status" => out.e2e_status = value().filter(|v| !v.is_empty()).map(|v| absolute(&v, cwd)),
                "e2e-hotkey" => out.e2e_hotkey = true,
                "e2e-autostart" => out.e2e_autostart = true,
                "e2e-confirm" => out.e2e_confirm = true,
                "e2e-cancel" => out.e2e_cancel = true,
                "e2e-lab" => {
                    out.e2e_lab = match value().as_deref().map(str::trim) {
                        Some("1") => Some(true),
                        Some("0") => Some(false),
                        _ => None,
                    }
                }
                _ => {}
            }
            continue;
        }
        if is_send_link(a) {
            out.sends.push(a.to_string());
            continue;
        }
        if is_pairing_link(a) {
            out.links.push(a.to_string());
            continue;
        }
        out.paths.push(absolute(a, cwd));
    }
    out
}

fn absolute(p: &str, cwd: &Path) -> PathBuf {
    let path = PathBuf::from(p);
    if path.is_absolute() || p.starts_with("\\\\") {
        path
    } else {
        cwd.join(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cwd() -> PathBuf {
        if cfg!(windows) { PathBuf::from("C:\\Users\\me\\Documents") } else { PathBuf::from("/home/me/docs") }
    }

    #[test]
    fn files_from_send_to() {
        let abs = if cfg!(windows) { "C:\\Users\\me\\Desktop\\Field notes – draft.pdf" } else { "/home/me/Field notes – draft.pdf" };
        let l = parse(&[abs, "relative.txt"], &cwd());
        assert_eq!(l.paths, vec![PathBuf::from(abs), cwd().join("relative.txt")]);
        assert!(l.links.is_empty());
        assert!(!l.is_plain());
        assert!(!l.is_e2e());
    }

    #[test]
    fn pairing_links_in_any_case() {
        let l = parse(&["DaylightShare://pair?c=ABC&n=Desk", "\"daylightshare://pair?c=X\""], &cwd());
        assert_eq!(l.links, vec!["DaylightShare://pair?c=ABC&n=Desk".to_string(), "daylightshare://pair?c=X".to_string()]);
        assert!(l.paths.is_empty());
        assert!(!is_pairing_link("daylight"));
        assert!(!is_pairing_link("https://daylightshare.example/"));
    }

    #[test]
    fn options() {
        let l = parse(&["--autostart"], &cwd());
        assert!(l.autostart);
        assert!(l.is_plain());

        let l = parse(&["--e2e-pair", "daylightshare://pair?c=Q", "--e2e-status=status.json", "--unknown", "--e2e-hotkey"], &cwd());
        assert!(!l.e2e_autostart);
        assert!(!parse(&["--e2e-autostart"], &cwd()).is_plain());
        let yes = parse(&["--e2e-confirm"], &cwd());
        assert!(yes.e2e_confirm && !yes.e2e_cancel && !yes.is_plain() && !yes.is_e2e());
        let no = parse(&["--e2e-cancel"], &cwd());
        assert!(no.e2e_cancel && !no.e2e_confirm && !no.is_plain());
        assert_eq!(l.e2e_pair.as_deref(), Some("daylightshare://pair?c=Q"));
        assert_eq!(l.e2e_status, Some(cwd().join("status.json")));
        assert!(l.e2e_hotkey);
        assert!(l.links.is_empty(), "the --e2e-pair value is not a link to handle twice");
        assert!(l.is_e2e());
        assert!(!l.is_plain());
    }

    /// What Windows runs for a clicked link (`"exe" "%1"`): the link alone, or with the test-mode status option.
    #[test]
    fn a_clicked_link_and_a_cold_start_with_one() {
        let link = "daylightshare://pair?c=E4AYBMQQ6AYE7PJTJCDJ6YJ7ME&r=http%3A%2F%2F127.0.0.1%3A5000&n=Test%20Daylight";
        let l = parse(&[link], &cwd());
        assert_eq!(l.links, vec![link.to_string()]);
        assert!(l.paths.is_empty() && !l.is_plain() && !l.is_e2e());
        let l = parse(&[link, "--e2e-status", "s.json"], &cwd());
        assert_eq!(l.links, vec![link.to_string()]);
        assert_eq!(l.e2e_status, Some(cwd().join("s.json")));
        assert_eq!(l.e2e_pair, None, "a link is never paired headlessly");
    }

    /// LAB-PLAN 1.7: `--e2e-lab 0|1` in test mode; nothing else sets it, and it pairs or sends nothing.
    #[test]
    fn lab_switch_for_tests() {
        let on = parse(&["--e2e-status", "s.json", "--e2e-lab", "1"], &cwd());
        assert_eq!(on.e2e_lab, Some(true));
        assert!(on.is_e2e() && on.is_plain() && on.paths.is_empty());
        assert_eq!(parse(&["--e2e-lab=0", "--e2e-status=s.json"], &cwd()).e2e_lab, Some(false));
        assert_eq!(parse(&["--e2e-lab", "yes"], &cwd()).e2e_lab, None);
        assert_eq!(parse(&["--e2e-lab"], &cwd()).e2e_lab, None);
        assert_eq!(parse(&["file.pdf"], &cwd()).e2e_lab, None);
        // Its value is taken as the option's, never as a file to send.
        let l = parse(&["--e2e-lab", "0", "notes.txt"], &cwd());
        assert_eq!(l.e2e_lab, Some(false));
        assert_eq!(l.paths, vec![cwd().join("notes.txt")]);
    }

    /// LAB-PLAN F09: `daylightshare://send?...` (any case) is a send link, never a pairing link or a file; the page
    /// decides what it does (it asks first, or answers with Lab off). A file path in it is just text for the page.
    #[test]
    fn send_links() {
        let link = "daylightshare://send?url=https%3A%2F%2Fexample.com%2Fstory&title=A%20story";
        let l = parse(&[link], &cwd());
        assert_eq!(l.sends, vec![link.to_string()]);
        assert!(l.links.is_empty() && l.paths.is_empty());
        assert!(!l.is_plain() && !l.is_e2e());
        for s in [
            "DaylightShare://SEND?url=x",
            "daylightshare://send",
            "daylightshare://send/?url=x&quick=1",
            "daylightshare://send#frag",
            "\"daylightshare://send?text=Hi%20https%3A%2F%2Fexample.com\"",
        ] {
            let l = parse(&[s], &cwd());
            assert_eq!(l.sends.len(), 1, "{s}");
            assert!(l.links.is_empty() && l.paths.is_empty(), "{s}");
        }
        // Pairing links, and anything else on the scheme, stay pairing links (v1.1).
        for s in ["daylightshare://pair?c=ABC", "daylightshare://sender?url=x", "daylightshare://sendx", "daylightshare:send?url=x"] {
            let l = parse(&[s], &cwd());
            assert!(l.sends.is_empty(), "{s}");
            assert_eq!(l.links.len(), 1, "{s}");
        }
        assert!(!is_send_link("https://example.com/send"));
        assert!(!is_send_link("send"));
        // With files and a pairing link, each goes its own way.
        let l = parse(&["a.pdf", "daylightshare://send?url=https%3A%2F%2Fexample.com", "daylightshare://pair?c=Q"], &cwd());
        assert_eq!((l.paths.len(), l.sends.len(), l.links.len()), (1, 1, 1));
    }

    #[test]
    fn empty_and_plain() {
        let none: [&str; 0] = [];
        assert!(parse(&none, &cwd()).is_plain());
        assert!(parse(&["", "  "], &cwd()).is_plain());
        assert_eq!(parse(&["--e2e-pair"], &cwd()).e2e_pair, None);
    }
}
