# Cross-device transfer UX research (raw notes)

Angle: AirDrop, LocalSend, KDE Connect / GSConnect, Pushbullet, Join, PairDrop/Snapdrop, Google Quick Share, Handoff / Universal Clipboard, Send Anywhere, Tailscale Taildrop, Microsoft Phone Link, plus adjacent tools (magic-wormhole, ntfy, Warpinator, NearDrop, rquickshare, OpenDrop).
Purpose: extract patterns that make "send to my device" feel seamless, for Send to Daylight (phone/Mac/Chrome/Safari/web senders -> Daylight DC-1 Inbox -> Reader).
Researcher: Sonnet subagent. Written 2026-10-20.

## 0. METHOD LIMITS (read this first)

- The shared WebSearch budget for this workflow run was already exhausted (every WebSearch call returned "web search budget is used up"). NO web searches were possible. I did not work around this with other search engines or reader/proxy services.
- The sandbox network only resolved: github.com, raw.githubusercontent.com, developer.android.com, developer.apple.com. Every other host failed DNS (ENOTFOUND): reddit, HN, tailscale.com, kdeconnect.kde.org, localsend.org, wikipedia, support.apple.com, support.google.com, support.microsoft.com, play.google.com, apps.apple.com, send-anywhere.com, youtube.com, f-droid.org, learn.microsoft.com, developer.mozilla.org, docs.github.com, invent.kde.org, wiki.archlinux.org.
- So the evidence base is: official READMEs / protocol docs / release notes on GitHub, and GitHub issue trackers (real user voice, with reaction counts and verbatim comments, many from 2025-2026). There are NO Reddit/YouTube/app-store review quotes in this file. Anything marked [BACKGROUND] below is from my own prior knowledge, NOT fetched this session, and should be treated as unverified until someone with search access confirms it.
- WebFetch results are produced by a small summarizer model, so "verbatim" quotes below are as returned by that tool; spot-check before putting in user-facing copy.
- Dates: today is 2026-10-20; issue dates in 2026 are real as shown on the pages.

---

## 1. LOCALSEND (open source, Flutter + Rust; Windows/macOS/Linux/Android/iOS/Fire OS)

Sources:
- README https://github.com/localsend/localsend
- Protocol v2.x https://github.com/localsend/protocol
- Releases https://github.com/localsend/localsend/releases
- Issues sorted by reactions https://github.com/localsend/localsend/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc
- Discussions https://github.com/localsend/localsend/discussions

### What it does (docs)
- "a free, open-source app that allows you to securely share files and messages with nearby devices over your local network without needing an internet connection."
- Secure: "All data is sent securely over HTTPS, and the TLS/SSL certificate is generated on the fly on each device." REST API + HTTPS.
- Minimums: Android 7, iOS 13 (sharing from other apps needs iOS 14+), macOS 11, Windows 10. Port TCP+UDP 53317. "Also make sure to disable AP isolation on your router."
- Troubleshooting list in README (devices not visible): AP isolation, set Windows network to Private, toggle macOS/iOS Local Network permission, allow LAN through VPNs. "Manual sending by IP address is suggested when discovery fails. Adding the device to favorites means 'it is probed directly.'"
- CLI exists (v1.18.0): `--to` takes alias or IP; "An alias must uniquely identify a discovered device."; text >64 KB is sent as a .txt file.

### Protocol (https://github.com/localsend/protocol)
- Discovery: multicast UDP 224.0.0.167:53317, announce with `announce:true`, peers reply via HTTP POST /api/localsend/v2/register (UDP reply fallback). Legacy HTTP scan: client POSTs /register to every local IP when multicast fails.
- Device info: alias, version, deviceModel, deviceType (mobile/desktop/web/headless/server), fingerprint (SHA-256 of cert in HTTPS mode), port, protocol, download flag.
- Upload flow: sender POST /prepare-upload (file metadata, optional sha256, preview) -> receiver accepts / partially accepts / rejects -> returns sessionId + per-file tokens -> sender POST /upload per file (parallel allowed) -> POST /cancel?sessionId. Codes: 403 rejected, 409 blocked by another session, 422 sha256 mismatch, 429 too many requests.
- PIN: `?pin=123456` on prepare-upload; 401 = PIN required/invalid.
- Reverse transfer ("receive via link" / download API): sender hosts plain HTTP, receiver opens URL in any browser (plain HTTP because browsers reject self-signed certs).
- "Only needs one party to set up an HTTP server."

### Feature timeline from release notes (shows what the maintainers/users prioritised)
- v1.15.4: "add button to retry a failed file transfer"; any URI is a clickable link on the receiver; receive history limited to 30 items.
- v1.16.0 (Nov): Favorites with "add option to automatically receive files only from favorites" (Quick Save for favorites); clipboard button on Android/iOS; macOS share extension ("include LocalSend as a share target in the share menu"), drag files/text onto menu-bar icon, starts hidden in menu bar; alias regeneration button; Rust HTTP client for faster sends.
- v1.17.0 (Feb): advanced setting to filter network interfaces; mobile swipe gesture to select multiple media files; Windows pasted images converted to PNG; Android option to open gallery after auto-save; path-traversal security fix.
- v1.18.0 (10 Aug 2026): first CLI; "receive via link"; IPv6; checksums on by default; Favorites "automatically accept files by favorite devices by default"; "Android: run file transfer in background"; "Android: quick settings tile for instant app launch"; "Windows: LocalSend added to the share sheet"; better remaining-time display; duplicate names become "file (1).txt"; wake lock released after transfers; macOS user-friendly computer name and Dock-icon text drop.
- v1.18.1: Android 17+ needs a Local Network permission (added). v1.18.2: stops following HTTP redirects from peers (security); auto-restarts HTTP/multicast server if it stops or app resumes; ignores system proxies (fixes "TLS info not found"); drag-drop on receive-via-link page.

### What users ask for most (GitHub reactions; user voice)
- Headless/CLI mode #11: 36 reactions (shipped 1.18).
- Faster large transfers #384: 39 reactions. Reported speeds: ~20 MB/s on 5 GHz vs 50-100 MB/s FTP; HTTPS 7 MB/s vs HTTP 50 MB/s on Android; "51 kbps" Windows->Android (2026); "With encryption off, I get 103MB/s." Cause: "the slow speed is caused by the inefficient HTTPS implementation" (Dart). Closed Aug 2026 "Should be solved in the upcoming release v1.18.0". Workarounds: disable encryption, disable battery restrictions, set download dir to final folder (files were first written to temp then copied).
- Socket Exception / port 53317 blocked on Windows #125: 59 reactions, open since Feb 2023. Windows reserves ephemeral/Hyper-V/WSL port ranges including 53317. "It's both frustrating and disheartening to see users resorting to manually opening ports in Windows" (adam-ah); "This is not very reliable. Even though 53317 is in the list of excludedportrange" (user1823); suggestion: "make it automatic on first setup" (JdotCarver). Maintainer idea: lower default port with 53317 as fallback. (https://github.com/localsend/localsend/issues/125)
- Bluetooth discovery #850: 27 reactions, open. "a certain kind of public WiFi that doesn't allow device discovery" breaks the app while "AirDrop still works"; "my University WiFi doesn't allow device discovery" (MMachado05); "all without the two devices having to be on the same wifi network initially" (jayb-g); "The most important thing is that it doesn't fail with older devices (or iOS ones)." Maintainer: Wi-Fi Direct is impossible on iOS; BLE discovery + transfer "more reasonable"; PairDrop relies on third-party server, hosting one isn't the goal. (https://github.com/localsend/localsend/issues/850) Also Wi-Fi Direct with QR #189, Wi-Fi Aware #2523, Bluetooth transfer #144 (15).
- Background/always-on receive on Android #2153 (16) + #275 + #3326: "I cannot seem to be able to run the app in the background"; "Would be much more convenient. Along with notifications and/or overlays." ; a forker warns "the battery may drain (since there is a background service)." #3326: "It doesn't work in the background; you have to open the app for it to automatically accept and save the data." (https://github.com/localsend/localsend/issues/2153, /3326). Quick Save for favorites (#861) shipped 1.16/1.18 but only while app is in foreground on mobile. A v1.18 compromise: background file transfer + Quick Settings tile.
- Chat/conversation view #462: "It would be nice to have the history page replaced by a conversation page." ; "Chat conversations view is IDEAL for this." Wishlist: clipboard image paste, drag-drop attachments, message expiry. Maintainer: chat apps rely on a server so messages reach offline devices; "not possible in LocalSend that is designed to be completely autonomous." Complaint in the issue: text received is saved as a .txt; "sending file" page stays open until user clicks "done." (https://github.com/localsend/localsend/issues/462)
- Tailscale/VPN detection #1123 (12): "worked when I specify ip address though the app(localsend) can not detect the device." Reason: "tailscale does not support multicast/broadcast yet so there is no efficient way to detect other localsend peer." Workaround: add peer IP to favorites (favorites are probed directly). (https://github.com/localsend/localsend/issues/1123)
- Windows context menu #115 (19) and Windows share sheet (shipped 1.18); UI redesign #300 (27); IPv6 #549 (17); skip existing files #443; Windows signing cert #3270 (31 reactions: "Waiting for SignPath certificate for Windows").
- Discussions: top-voted are troubleshooting ("Unable to transfer files even though my Android phone and Windows device are connected to same network" 7 votes), a request for a completion sound + notification on Windows (6 votes), and "Upload / Download All" (6).

### Takeaways for Send to Daylight
- Retry button on a failed item, per-file status, and clear "receiver declined / PIN required / checksum mismatch" error states are cheap and users ask for them.
- Quick Save / auto-accept for a trusted target is the single most-requested trust feature; "background receive on mobile" is the most requested and hardest (OS limits). Daylight DC-1 is Android 13 and always-on-ish tablet, so a receiving Inbox with a foreground service is feasible; flag battery cost (e-ink tablet makes this nicer).
- Discovery on hostile networks (hotspots, campus Wi-Fi, AP isolation, VPN) is the #1 support burden of LAN-only tools. A cloud relay (Send to Daylight already has an E2E relay) avoids this entirely; this is a selling point versus LocalSend.
- "Text saved as .txt" was called out as unfriendly; links should arrive as links.
