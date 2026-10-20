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

---

## 2. PAIRDROP / SNAPDROP (web, WebRTC, PWA)

Sources:
- README https://github.com/schlagmichdoch/PairDrop
- FAQ https://raw.githubusercontent.com/schlagmichdoch/PairDrop/master/docs/faq.md
- How-to https://raw.githubusercontent.com/schlagmichdoch/PairDrop/master/docs/how-to.md
- Releases https://github.com/schlagmichdoch/PairDrop/releases
- Snapdrop https://github.com/RobinLinus/snapdrop ("The easiest way to share files between devices." "local file sharing in your browser. Inspired by Apple's Airdrop.")
- Issues: https://github.com/schlagmichdoch/PairDrop/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc

### Docs: feature set (the closest existing thing to our "web sender page")
- Same-network discovery plus "Join temporary public rooms to transfer files easily over the Internet." Room entry "via a 5-letter code or a QR-code." "Public rooms are temporary. Closing PairDrop leaves all rooms."
- Pairing: "Pair devices via a 6-digit code or a QR-Code." "Paired devices always find each other via shared secrets independently of their local network." "Pairing is persistent." "You can edit and unpair devices easily."
- "Files are auto-downloaded upon completing a transfer, if possible." Multiple files -> ZIP, with "an overall progress indicator." "Prevent devices from sleeping on file transfer." "Warn user before PairDrop is closed on file transfer." Video/audio preview.
- "Paste files/text and choose the recipient afterwards" (paste first, pick target second).
- Share-in surfaces: Android PWA share target ("When the PWA is installed, it will register itself to the share-menu of the device automatically."), iOS via a third-party Shortcut (from RoutineHub), Windows "Send to" via a CLI zip + Git Bash + PowerShell (manual, several steps), Ubuntu Nautilus context menu, CLI (`pairdrop file`, `pairdrop -t "text"`; opens browser to pick the receiver).
- Display name changeable "to easily differentiate your devices."
- Device uses WebRTC P2P; signaling server only; devices behind different NATs "are auto-connected via the PairDrop TURN server." FAQ: "PairDrop doesn't even use a database."
- FAQ (security): WebRTC encrypts in transit but "users must trust the PairDrop server"; zero-trust design planned in issue #180.
- FAQ #11 "Why isn't feature xyz implemented?": project prioritises simplicity; maintainer "may decline requests for simplicity's sake." Maintainer on progress UI: "I'm not a fan of options as this adds complexity for the user."
- Keyboard: Enter accepts, Esc declines, Ctrl+Enter sends message.

### User voice / complaints (GitHub)
- Always-on receive #479: "I would like the web app to be always online in the background so that it sends a notification that someone is trying to send me something then I can accept." / "Airdrop on Apple does not need receiving device to be inside an app to receive." Reply: works only "as long as the pairdrop.net website ... is open and in the foreground on the mobile device"; "the apps and the web-browsers are often halted by the system when not in the foreground." No maintainer reply. (https://github.com/schlagmichdoch/PairDrop/issues/479)
- Progress UI #122 (open since 2023, bikeshedded for a year): users want percentage, MB/s and ETA ("Would be great if you could see a percentage of the transfer."). Maintainer thought a percentage was redundant to the progress ring and proposed cycling text messages every 5 s; a user pushed back "I personally dislike the switching between messages." Final proposal: only for transfers >10 s, show "14.3 MB/s - 1min 25s". Lesson: show percent + speed + ETA together, not rotating text. (https://github.com/schlagmichdoch/PairDrop/issues/122)
- Slow transfers #44 (18 comments): 300-400 KB/s on mobile; "Devices that are behind a NAT need a TURN server to establish the peer-to-peer connection."; mismatched Wi-Fi band (2.4 vs 5 GHz) cited as late as Dec 2025; chunker rewritten in 2024 -> ~15 MB/s. (https://github.com/schlagmichdoch/PairDrop/issues/44)
- Large files disconnect #120: browser RAM. "When the browser runs out of RAM the site crashes and is often simply reloaded."; iOS Safari gives pages ~200 MB so PairDrop blocks >200 MB sends to iOS; still failing in Apr 2026 (4.4 GB). (https://github.com/schlagmichdoch/PairDrop/issues/120)
- iOS Safari reconnect loop #128: "Tried using it on my 12 mini, but the Safari page keeps connecting all the time, it's a loop." User switched to LocalSend meanwhile. Accept auto-opens the share sheet "by design, to reduce the amount of clicks needed when receiving a file." (https://github.com/schlagmichdoch/PairDrop/issues/128)
- Android share menu #11: PWA share target did not show in Edge for Android, only Chrome; "the API 'only works together with the platform the browser is hosted on'"; fixed in v1.5.2 / SW rewrite. (https://github.com/schlagmichdoch/PairDrop/issues/11)
- Rename device #51 (11 reactions, closed Mar 2023); set name via URL param #334; unpredictable "Windows Firewall blocks self-hosted PairDrop" #121 (16).
- Verification #180 (open since Oct 2023): detailed Signal-style design: per-user public/private key; encrypt signaling between paired peers; "security number" = hash of both sorted public keys, or short word phrase like "apron-cedar-baton"; a `verify` label under each peer; `verified` badge; web clients show `web client (i)` because a web page can't prove its own code; QR scan to compare keys. "You need to trust this URL/server." (https://github.com/schlagmichdoch/PairDrop/issues/180)
- Native apps would unblock speed/background: #292 "Native clients via Flutter".

### Takeaways
- Our web sender page is inherently the weakest-trust surface (user must trust the server serving the JS). PairDrop's own analysis says verification only makes sense for native apps/extensions. For Send to Daylight the E2E key should live in the paired companion, and the web page should be labelled as lower-trust or use a fragment-key/QR scheme.
- "Paste first, choose recipient after" and "auto-download on complete" are loved micro-flows.

---

## 3. TAILSCALE TAILDROP (private mesh, OS-integrated send)

Sources:
- Code: https://github.com/tailscale/tailscale/tree/main/feature/taildrop (doc.go, resume.go, peerapi.go, send.go) and https://raw.githubusercontent.com/tailscale/tailscale/main/cmd/tailscale/cli/file.go
- Issues: https://github.com/tailscale/tailscale/issues?q=is%3Aissue+taildrop+sort%3Areactions-%2B1-desc
- tailscale.com docs were unreachable in this sandbox.

### How it works (from source)
- Receive endpoint `PUT /v0/put/<filename>`; optional `Range` header for resumed uploads (single range starting at offset). `GET /v0/put/` lists partial files; `GET /v0/put/<filename>` returns block hashes of the partial file. Errors: 403 (no capability / unsigned peer / not allowed), 409 (file exists), 400 (bad name/range), 500.
- Resume: partial files named `baseName + clientID.partialSuffix`; receiver hashes the partial file in 64 KiB blocks (SHA-256 each); the sender compares its own prefix block-by-block and resumes at the first mismatch ("If it mismatches, then resume from this point."). So resume is content-verified, not just size-based.
- Authorisation: sender must be the node itself (untagged) or hold the file-sharing-send capability; code comment: "This package does not validate permissions, the caller should be responsible for ensuring correct authorization." The CLI error strings show the model: "cannot send files: peer is owned by a different user", "target is not advertising a file sharing API", "unknown target; not in your Tailnet".
- Offline peers: CLI tries anyway and, if no bytes reach the peer within 3 s, prints "# warning: <peer> is reportedly offline; trying anyway" or "is not replying; trying anyway".
- Progress: shown only on TTY; shows name, bytes, smoothed rate, percent, ETA; driven by the daemon's `OutgoingFile.Sent` events (the true bytes delivered to the receiver, not local bytes read). `--targets` lists devices with `offline`/`unknown-status` and "last seen" age.
- Receive side CLI: `tailscale file get [--wait] [--loop] [--conflict=skip|overwrite|rename]`; rename produces `name (N).ext`; files get a quarantine attribute before content is written.
- As of Tailscale v1.104.1 (issue #4996, closed 13 Oct 2026): Android, iOS and macOS share sheets support text selections and URLs; on Android/iOS the receiver taps the item to copy or open it; Windows/Linux/older clients receive text as .txt and links as .url / .inetloc files; Windows/macOS click-to-copy/open "later".

### What users complain about (highest-signal list for us)
1. No notification on delivery (Android) #8626 (27 reactions, open since July 2023, still reproduced Aug 2026 on Pixel, Samsung, Xiaomi): "I also do not receive notifications when a file is delivered on android." (jstebbins); "I get the files in internal storage but no notification of any kind." (njfife); a Pixel 8 user says files now appear instantly "but the notifications still don't appear." Maintainer: "The notification is generated on the device, GCM is never used." Also Xiaomi/MIUI: sender sees "peer is offline" because the OS blocks incoming connections. Also #9459 (6). (https://github.com/tailscale/tailscale/issues/8626)
2. Receiver not shown as a target / flaky target list #14393 (33): "my PC never shows up on the list of devices on Android."; "Rarely do my Windows computers show as Taildrop targets."; "it seems like that logic is not working properly when the client first starts on login." Workaround users found: toggling exit node. (https://github.com/tailscale/tailscale/issues/14393)
3. No share-sheet/context-menu integration on Windows 11 #8509: "Baking support for Windows 11 Context Menus is now desperately needed for Send via Taildrop feature."; workaround "Click on 'Show more options'". Also notes sharing from share sheet "would bypass the need for files to first be saved from the relevant program." Open since June 2023, no maintainer reply. (https://github.com/tailscale/tailscale/issues/8509)
4. Links/text: #4996 (13): sender used Telegram-to-self as workaround; "AirDrop handles links well"; "Sharing links from one tailscale app to another would make this app more than essential." Shipped Oct 2026. #4896 clipboard: "share text on phone, open file, copy to clipboard takes far more steps than share text". (https://github.com/tailscale/tailscale/issues/4996 , /4896)
5. Receive friction on Linux #2312 (17): files do not land in Downloads automatically; needs `tailscale file get` per file (open since 2021). Windows saving to Desktop rather than Downloads #5934. (https://github.com/tailscale/tailscale/issues/2312)
6. Silent CLI #3621: "The command provided no feedback and took several minutes to complete."; fixed by progress after ~1 s; users still ask for ETA. (https://github.com/tailscale/tailscale/issues/3621)
7. Security/consent #15670: always-auto-accept from same user. A macOS .command file "appeared directly in Downloads without recipient approval or a visible notification" (macOS refused to execute it for lack of exec bit); user asks for "explicit acceptance, clear sender identity, notifications, and stronger documentation." Open. (https://github.com/tailscale/tailscale/issues/15670)
8. Sending to tagged devices #10695 (18), cross-tailnet sharing #2101, "Windows client does not show as target".
9. Battery #3363 (76, locked): always-on VPN. "Device runtime cut by half running tailscale always on." (2021); "This continues to be a crippling issue for many" (2024); iOS v1.62 improved to "typically 5-10%" 24/7; ideas: let mobile devices disable incoming connections; explore Apple silent push instead of persistent control connection. (https://github.com/tailscale/tailscale/issues/3363)
10. Browser extension demand #11362 (34): wanted mostly for locked-down machines ("Sometimes it would just not possible to install anything but a browser extension."); official ts-browser-ext exists; community Tailchrome needs a native messaging host (breaks on ChromeOS). (https://github.com/tailscale/tailscale/issues/11362)

### Takeaways
- Receiver-side notification is the make-or-break piece. Android OEM battery managers (MIUI/HyperOS) silently kill the always-on listener; for a Daylight tablet we control the device image, so a foreground-service Inbox with its own notification channel is feasible, but we should show "last seen / online" for the receiver in the senders so failure is visible, not silent.
- Show sender-side "delivered to device" vs "opened in Reader" as distinct states, with the receiver's last-seen time (Taildrop CLI `--targets` pattern).
- Content-verified resume (hash blocks) is the gold standard if we ever chunk large PDFs.

---

## 4. KDE CONNECT / GSCONNECT / VALENT (LAN, TLS, plugin protocol)

Sources:
- https://github.com/KDE/kdeconnect-kde (mirror README) ; https://github.com/KDE/kdeconnect-android ; https://github.com/KDE/kdeconnect-ios ; https://github.com/GSConnect/gnome-shell-extension-gsconnect ; https://github.com/andyholmes/valent
- GSConnect issues: https://github.com/GSConnect/gnome-shell-extension-gsconnect/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc
- (kdeconnect.kde.org and invent.kde.org/bugs.kde.org were unreachable; KDE Connect bug reports live on Bugzilla, not GitHub.)

### Docs: what it is
- Feature set: shared clipboard; notification sync with reply ("Read and reply to your Android notifications from the desktop."); file and URL sharing ("Share files and URLs instantly"); media remote; virtual touchpad/keyboard; presentation remote; run commands; SMS/MMS from desktop; "find my phone" (ring). Platforms: Linux (Plasma/GNOME), Android (Play Store, F-Droid), iPhone/iPad (App Store), Windows (Microsoft Store); macOS/Windows "not officially supported".
- Architecture: LinkProviders (discovery + link establishment) / Devices / NetworkPackets (JSON, fields id/type/body/version; optional binary payload via payloadSize + payloadTransferInfo) / Plugins (independent modules per feature). "All this is done completely wirelessly, utilising TLS encryption." Pairing needs the Android app and desktop app both installed.
- Valent (GTK implementation) lists: "Sync contacts, notifications and clipboard content; Control media players and volume; Share files, links and text; Virtual touchpad and keyboard; Call and text notification; Execute custom commands." Status "alpha".
- GSConnect home: "allows devices to securely share content like notifications or files"; "GSConnect does not have dedicated developers working on new features or bug fixes." (maintenance risk of a community reimplementation).
- KDE Connect iOS README: "iOS is very much designed around foreground interactions." ; unresponsive in background "is more or less intended"; "Notification syncing doesn't work because iOS applications can't access notifications of other apps."

### User pain (GSConnect issues, which is the best public window onto KDE Connect users)
- Protocol/Update breakage #1932 (63 comments): KDE Connect Android 1.33.0 auto-update stopped pairing with GSConnect. Play changelog: "Verification key now changes every second (only if both devices support it)". Users: "Can reproduce exactly. What the heck."; "I can't pair any device."; workaround = install 1.32.11 from F-Droid/APKMirror, then F-Droid auto-updated again. Maintainer: "had anticipated this kind of change" but too slow. Lesson: companion + receiver must ship protocol changes with explicit versioning and backwards compatibility. (https://github.com/GSConnect/gnome-shell-extension-gsconnect/issues/1932)
- Discovery failures #1758 / #1480: phones and PCs "can't see each other"; causes: VPN on phone blocks it, firewall ports; "Need more logs."; wiki has "Firewall Configuration" and "Connecting an Android Device" help pages. A 138 KB thread with no resolution. (https://github.com/GSConnect/gnome-shell-extension-gsconnect/issues/1758)
- SFTP mount #1203 (90 comments, open since 2021): "the android app mounts the fs root of the phone i.e. / which is inaccessible without root"; Android 11+ scoped storage and ssh-rsa host-key deprecation broke it; "This location could not be displayed." Lesson: features that depend on scoped storage rot.
- Desktop integration requests: tighter Nautilus integration #83 (30), call from PC #575 (39), mouse control #1111.
- Performance: GSConnect "causes gnome-shell to lag and possibly memory leak" #1028 (84 comments).

### Takeaways
- KDE Connect's *plugin-per-feature* architecture and JSON packet envelope (id/type/body/version + out-of-band payload) is a good model for a Lab feature flag system: each Lab feature = an independent packet type that older receivers can ignore.
- Pairing model [BACKGROUND for the request/accept steps]: request on one device, accept on the other, with a verification key to compare (the Play changelog line in #1932 confirms a 'verification key' exists and was changed). Users complain mainly when the scheme changes silently between app versions.

---

## 5. GOOGLE QUICK SHARE / NEARBY SHARE AND THE THIRD-PARTY CLIENTS (RQuickShare, NearDrop), + AIRDROP INTEROP

Sources:
- https://github.com/Martichou/rquickshare (README + issues: https://github.com/Martichou/rquickshare/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc)
- https://github.com/grishka/NearDrop (issues: https://github.com/grishka/NearDrop/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc)
- https://github.com/google/nearby (Nearby Connections; README says "A peer-to-peer networking API that allows apps to easily discover, connect to, and exchange data with nearby devices"; Nearby Presence: "extensible identity model for authentication and restricted visibility"; "not an officially supported Google product")
- Google/Apple support pages unreachable.

### How the third-party clients interoperate (docs)
- RQuickShare README: Android "doesn't broadcast its mDNS service all the time, even when in 'Everyone' mode"; desktop must broadcast a Bluetooth advertisement so Android turns mDNS on, or the user opens the Files app Nearby Share tab; "Wi-Fi LAN only. Your devices need to be on the same network"; public networks may block mDNS; firewall may block; Samsung's changes may break workarounds; app minimizes to tray ("Stop app on close" to quit).
- NearDrop README: macOS menu-bar app; "saves files to your downloads folder"; Android shows a PIN, Mac shows notification ("Make sure you have 'do not disturb' off"); send from Finder Share menu -> NearDrop; links via File->Share; "Visible to everyone on your network at all times while the app is running."; limited visibility "requires talking to Google servers"; Android must scan NearDrop's QR code to see the Mac; "Wi-Fi direct isn't supported on macOS".
- NearDrop v2.2.0 (Aug 2025): QR code with ECDSA public key used "for auto-accept and device discovery" (maintainer in #152) - i.e. QR scanning doubles as trust establishment.

### User pain and demand (GitHub; best proxy for Reddit)
- Discovery is the failure mode, again. NearDrop #152 (67 reactions, closed Aug 2025): "Can't send from Mac to a Samsung device after the Quick Share update". Maintainer: macOS APIs cannot send the BLE advertisements Android expects (#140, 54 reactions: "Android expects BLE advertisements that are impossible to send using any macOS APIs I tried, both public and private."). Users: "none of the two workarounds to receive files from Mac are working"; fixed by QR flow: "that worked perfectly! I hope it will be put in the README soon"; "It worked! Thank you very much." (https://github.com/grishka/NearDrop/issues/152, /140)
- Pixel 10 AirDrop interop broke third-party receivers: RQuickShare #425 (11 reactions, open, May 2026): "Can't send to rquickshare from Pixel 10 Pro since AirDrop update." Reporter: the phone drops its Wi-Fi to run Quick Share + AirDrop discovery so mDNS cannot find LAN receivers; ChromeOS receivers still work because discovery is over Bluetooth; community forks add BLE GATT receiver advertising + Wi-Fi handoff. #358 (17 reactions): "Since AirDrop compatibility was added to Quick Share, enabling Quick Share turns off Wi-Fi."; workaround "disable 'Share with Apple devices'". (https://github.com/Martichou/rquickshare/issues/425 , /358) -- also confirms (from user reports) that Pixel Quick Share can talk to Apple devices in 2026 and that Samsung has an equivalent toggle ("Galaxy S26").
- Auto-accept from known devices: RQuickShare #224 (3), #89, #316; NearDrop #117 (3), #42: "The connection and negotiation takes time and you have to sit glued to mac waiting for notification to accept." If missed, "the Android device times out, and transfers have to be restarted." Maintainer (Martichou, May 2025): "it won't be enabled by default... there's no real verification of the device." One fork added auto-download and a user called it "perfect... Rather simple changes that make the entire experience perfect." (https://github.com/Martichou/rquickshare/issues/224 ; https://github.com/grishka/NearDrop/issues/117)
- Received links/text should act: RQuickShare #245: auto-open link / copy text to clipboard "to my eyes would make the app simply perfect"; #182 "Add a `copy` action on notification"; #67 "send Text from RQuickShare to Android" (9); NearDrop #16 "Can't receive text and links on Mac", #110 "Add text share support". (https://github.com/Martichou/rquickshare/issues/245)
- Other: rename device #87; start minimized #45; hide dock icon #264; "Scan QR?" #368; send destination path unavailable error message #194; NearDrop pause button #218; "Specify where file is saved" #19.
- NearDrop users note large-file limits ("it only can send around 5MB or 10MB at top" in Apr 2024 comment).

### Takeaways
- QR as trust bootstrap + wake-up beats hoping BLE/mDNS works.
- Any approach reliant on OS-vendor discovery (Quick Share, AirDrop) breaks on OS updates; a relay-based pairing code is more durable. This is the strongest argument for our architecture.
- Inbox UX: when an item arrives, offer one-tap actions (Open in Reader / Copy link / Dismiss) on the notification itself (see #182, #245).

---

## 6. AIRDROP, HANDOFF, UNIVERSAL CLIPBOARD (Apple)  [mostly BACKGROUND]

Fetched evidence:
- OpenDrop README https://github.com/seemoo-lab/opendrop : "As AirDrop exclusively runs over Apple Wireless Direct Link (AWDL)..."; "Apple devices start their AWDL interface and AirDrop server only after receiving a custom advertisement" (BLE trigger); OpenDrop "only supports sending to Apple devices that are discoverable by everybody" because "the default contacts only mode requires" Apple-signed certificates; Apple AirDrop supports multiple files at once.
- Continuity research https://github.com/furiousMAC/continuity : lists reverse-engineered BLE message types (AirDrop, Handoff, Nearby Info, Tethering/Instant Hotspot, Magic Switch...) and PETS 2019 "Handoff All Your Privacy" re: tracking despite randomised addresses. (Handoff/Universal Clipboard internals are not described on the page.)
- PrivateDrop https://github.com/seemoo-lab/privatedrop : USENIX Security '21; uses Private Set Intersection for contact matching (flaw itself not described on the page).
- developer.apple.com pages were JS-rendered shells; the summaries returned were the summariser's general knowledge, not page text. Treat as [BACKGROUND].

[BACKGROUND, not fetched, unverified - confirm before relying on]
- AirDrop UX that people hold up as the gold standard: no pairing at all for Contacts; sender picks a nearby target (avatar tiles) from the share sheet; receiver sees a preview + Accept/Decline; progress ring around the avatar; links/files open in the right app automatically. Receiving options Contacts Only / Everyone for 10 Minutes (the 10-minute limit was introduced in iOS 16.2 after hash-cracking concerns). Praise: "it just works" for iPhone-to-Mac and for sending links. Complaints: Apple-only, doesn't work with Android until Pixel 10 interop (user reports above confirm it exists in 2026); "Contacts Only" fails when the other person isn't in contacts or isn't signed into iCloud; "Waiting..." forever with no reason; phone numbers/emails hash leakage.
- Handoff: BLE advertisement of the current NSUserActivity to nearby devices on the same Apple ID; Safari page appears as an icon in the Mac Dock / iPhone app switcher; webpageURL fallback. Universal Clipboard: copy on one device, paste on another within ~2 minutes, built on Handoff. Praised as "magic" but complaints: flaky, silently stops working, requires Bluetooth+Wi-Fi+same Apple ID. Pattern for us: "continue where you left off" = after a send, the Reader on the DC-1 offers the item at top of the home screen (the Handoff "badge") instead of requiring navigation to the Inbox.

---

## 7. PUSHBULLET, JOIN, PHONE LINK, SEND ANYWHERE  [mostly BACKGROUND]

Fetched:
- GitHub: Pushbullet org has NO public repos (https://github.com/pushbullet); the old `pushbullet/api` repo path 404s from this sandbox. Join's author has JoinDesktop ("An official desktop app for Join by Joaoapps built in Electron", https://github.com/joaomgcd/JoinDesktop, 30 open issues) and JoinChrome ("This is the code for the Join Chrome extension ... created because many users asked for a better extension design", https://github.com/joaomgcd/JoinChrome). Join's own site/docs were not reachable.
- Tailscale issue #4996 commenters: workaround for pushing links is Telegram/messages-to-self "because Pushbullet has no iOS app" (feynon); another cites AirDrop as the benchmark for links.

[BACKGROUND, not fetched, unverified]
- Pushbullet (2013, SF): "push" notes/links/files to any device, universal copy-paste, notification mirroring + reply, SMS from desktop, channels, Chrome/Firefox/Opera extensions, Windows app, iOS app (iOS cannot mirror notifications). Added paid Pro (free tier limits on messages/storage). Perceived as stale since ~2019 and community talk is mostly "what replaced Pushbullet". What people loved: the browser right-click "Push this page / link / image to my phone" and instant phone notification with the link tappable; devices shown by name; per-device targeting and "all my devices"; the notification-to-desktop mirror. What hurt: free caps, unreliability/lag, no iOS notification mirroring, security/privacy worries (server sees content; E2E only for mirrored notifications/clipboard).
- Join (joaoapps, Android-first, Tasker-friendly): Chrome/Firefox extension and Windows Electron app; push page/link/file/clipboard to a chosen device; context menu in the browser; "send to" device list; automations. Loved by power users for being free/cheap and scriptable; criticised for Android-only mobile and ageing UI. Treat as Pushbullet's closest successor for Android users.
- Phone Link (Microsoft): Windows <-> Android (deepest; Samsung's "Link to Windows" tighter) and iPhone (limited: calls, messages, notifications only). QR/Microsoft-account pairing; notifications mirrored on the PC taskbar; cross-device copy/paste and drag-drop files (Android); recent photos on the PC; battery shown. Complaints: flaky reconnects, needs Bluetooth + same Microsoft account, battery-optimisation killing the background link (a recurring "Phone Link stopped syncing" thread), iPhone side very limited. Takeaway is the QR pairing and the persistent "paired phone" panel.
- Send Anywhere: 6-digit key that works for ~10 minutes, or a link valid 48 h; direct device-to-device when both online, cloud fallback; cross-platform incl. TV; Wi-Fi Direct. Praised for "6-digit code and done" with no account. Complaints: ads on free tier, link storage limits. Takeaway: short numeric code as a zero-account fallback and an expiring link.

---

## 8. ADJACENT TOOLS WORTH STEALING FROM

- magic-wormhole (https://github.com/magic-wormhole/magic-wormhole): "Wormhole codes are single-use and do not need to be memorized."; code like `7-crossover-clockwork`; PAKE (SPAKE2) so a short low-entropy code gives a strong key; one guess per code, "a 1-in-65536 chance of success" for the default 16 bits, failed guess is visible to the intended peers; mailbox server = "a simple WebSocket-based relay"; transit relay is a fallback only when direct fails; receiver gets tab-completion on code words and an accept prompt (ok? y/n) before writing; sender waits for the receiver's confirmation; no built-in timeouts but "both clients will be run within an hour or so of each other"; "Both clients must be left running until the transfer has finished" (the key weakness vs store-and-forward).
- croc (https://github.com/schollz/croc): code phrase -> PAKE; "p2p with relay fallback"; "Allows resuming transfers that are interrupted"; `croc send --text` for URLs/short text; multiple files/folders.
- ntfy (https://github.com/binwiederhier/ntfy ; docs/subscribe/phone.md ; docs/faq.md): publish by plain HTTP PUT/POST; Android has two delivery modes: Firebase (no extra battery, can be delayed "sometimes many minutes, or even hours") vs "instant delivery" via a foreground service shown as a permanent notification; F-Droid build always uses instant delivery; instant delivery "consumes about 0-1% of battery in 17h of use (on my phone)"; server caches messages 12 hours by default so offline devices catch up; per-priority notification channels (priority >=4 pops over, can override DND); connection-error warning icon in app bar with a dialog and logs; "Without access control... the topic name serves as the password" (random topic = good password). 
- Warpinator (https://github.com/linuxmint/warpinator): group code (default "Warpinator", 8-32 chars) is the trust boundary; Secure Mode requires manual approval of every incoming transfer and is enabled by changing the group code; Landlock/Bubblewrap isolate the incoming folder; also analyses incoming files for harmful content; compression speeds up transfers.
- ClipCascade (https://github.com/Sathvik-Rao/ClipCascade): always-on clipboard sync. Shows how hard Android is: background clipboard access (Android 10+) needs ADB-granted READ_LOGS and a "Display over other apps" overlay trick; text limited to ~1 MiB; E2E encryption must be enabled on all devices. => "send clipboard" from Android must be explicit (a share target or a button), not a background watcher.
- Android Sharing Shortcuts (developer.android.com/training/sharing/direct-share-targets): you can publish each paired target (e.g. "Daylight DC-1 - Rooted 2") as a long-lived shortcut so it appears in the top "Direct Share" row of the system share sheet. Rules: `<share-target>` in shortcuts.xml with data MIME types + category; `ShortcutInfoCompat` with `setCategories()` (required), `setLongLived(true)` (better ranking), full name in long label; push the shortcut again each time the user sends ("Reporting usage... is functionally similar to clicking the 'send' button"); do not change the shortcut ID; stale after 30 days; tapping a Direct Share target must go straight to the action, no disambiguation UI; ChooserTargetService deprecated since Android 11. Also Android 14 `ChooserAction` custom actions and share-result callbacks (developer.android.com/training/sharing/send).
- iOS equivalents [BACKGROUND]: background `URLSession` with `sharedContainerIdentifier` (App Group) so a share extension can hand off an upload that continues after the extension is dismissed; uploads must be from files; user force-quit stops background transfers. Share extensions have a tight memory limit (~120 MB) so big PDFs must be streamed from disk, not loaded.

---

## 9. CROSS-CUTTING PATTERNS (evidence-ranked)

### A. Pairing / onboarding
- Best-loved: no pairing at all for nearby (AirDrop, LocalSend alias list), or one-time QR/code that persists (PairDrop: "Pairing is persistent"; NearDrop QR with ECDSA key -> auto-accept; magic-wormhole code single-use).
- Persistent pair + auto-accept from paired devices is the thing users request in every tool (LocalSend #861 shipped as Favorites Quick Save; RQuickShare #224; NearDrop #117).
- Risk: pairing schemes that change silently (KDE Connect 1.33 verification key) cause mass breakage.
### B. Device discovery and naming
- LAN discovery (mDNS/multicast/BLE) is the #1 source of "can't see my device" threads in LocalSend, GSConnect, RQuickShare, NearDrop, PairDrop (AP isolation, VPN, firewall, Windows port reservation, Android 17 Local Network permission, Pixel Wi-Fi drop). Mitigations users use: manual IP + favorites (LocalSend), QR (NearDrop), BLE (RQuickShare forks), TURN (PairDrop).
- Naming: editable display names are a repeatedly requested basic (PairDrop #51 11 reactions, RQuickShare #87, NearDrop); LocalSend added "alias regeneration" and "user-friendly computer name" on macOS. Taildrop targets are named from the hostname and listed with offline/last-seen.
### C. Multi-device targets
- One-tap send to a *named* target in the OS share sheet (Android Sharing Shortcuts; macOS/iOS share extension; Windows share sheet - requested by Taildrop users, shipped by LocalSend in 1.18). Favorites list per tool. "Send to all my devices" (Pushbullet [BACKGROUND]).
### D. Delivery confirmation / state
- Distinct states users can see: queued -> sent -> received/accepted -> (opened). LocalSend gives accept/reject/partial and sha256 verification (422 on mismatch); wormhole sender waits for receiver confirm; Taildrop reports bytes actually delivered by the receiver, and warns "reportedly offline; trying anyway". Users hate silent failure (Taildrop CLI silence, Android no-notification, AirDrop "Waiting..." [BACKGROUND]).
### E. Progress and ETA
- Percentage + speed + ETA together (PairDrop #122 debate; Taildrop #3621; LocalSend "Better remaining-time display for long transfers"). Don't rotate messages. Users ask for pause (NearDrop #218) and "close warning during transfer" (PairDrop).
### F. Retries / offline queue
- LocalSend: retry button (1.15.4), "skip existing files" is a top annoyance (#443: users lose hours and end with "7 copies"), resumable transfers requested (discussion, 8 votes). Taildrop: content-verified resume. ntfy: 12 h server-side cache so offline devices catch up. Store-and-forward is exactly what LAN-only/live-session tools cannot do (wormhole: both must stay running; LocalSend maintainer: chat needs a server to reach offline devices) and what our relay does natively.
### G. Notifications on the receiving side
- Must exist, must be reliable, must carry actions. Evidence: Taildrop Android #8626; NearDrop "turn off DND"; RQuickShare #182 copy action on notification; Tailscale 1.104 "tap to copy/open"; LocalSend discussion "sound and notification when finished" (6 votes); ntfy per-priority channels.
### H. History
- LocalSend keeps 30 receive-history items and users want a conversation/thread view (#462: "It would be nice to have the history page replaced by a conversation page."). Wishlist: message expiry. Pattern: Inbox with read/unread, source device, time, re-open.
### I. Clipboard / link handoff
- Links should arrive as links that open (LocalSend 1.15.4: "any URI is treated as a clickable link on the receiver"; Taildrop shipped .url + tap-to-open in Oct 2026; RQuickShare #245). Clipboard buttons (LocalSend 1.16 Android/iOS) over background watchers (ClipCascade shows the Android hacks required).
### J. Battery behaviour
- Tailscale: always-on VPN 3-10% battery on phones; ntfy instant delivery 0-1% per 17 h but costs a permanent notification; LocalSend: release the wake lock after transfers, background service battery worry; PairDrop: prevent sleep only during transfer. For the DC-1 Inbox: prefer FCM-less long-poll/WebSocket in a foreground service only while charging or on schedule, or a periodic poll (store-and-forward relay makes polling safe) - to confirm with the Android team; e-ink tablet idle drain matters.
### K. Security model
- LAN-only: self-signed TLS with fingerprint (LocalSend), PIN option; no verification of "known" device is the maintainers' stated blocker for auto-accept (RQuickShare #224: "there's no real verification of the device").
- Cloud-assisted: PairDrop (trust the server for signalling; #180 verify with safety numbers), ntfy (topic = password; self-host for sensitive), magic-wormhole (PAKE, one guess).
- Same-account trust: Taildrop auto-accepts from same user; backlash #15670 about no consent prompt for files from a different human on the same login.
- Quarantine/safe handling of received files (Taildrop quarantine attribute; Warpinator content analysis; LocalSend path-traversal fix 1.17 and "no longer follows HTTP redirects from peers" 1.18.2).
### L. Surfaces users ask for (ranked by reactions/votes seen)
1. Background/auto receive on phone (LocalSend discussion 55 votes + 21 + 10 + ...). 2. Windows share sheet/right-click send (LocalSend 23 + 19 + 15; Taildrop 33 + ...). 3. CLI/headless (LocalSend 36). 4. Browser extension (Tailscale 34). 5. iOS Shortcuts (LocalSend 12). 6. Global hotkey (12). 7. Quick Settings tile (shipped). 8. Menu-bar drop target (shipped macOS). 9. Dock drop (shipped).
### M. Protocol evolution
- Backwards compatibility breaks are felt immediately: KDE Connect/GSConnect #1932, LocalSend 1.18.0 -> 1.18.2 compat hotfixes ("Fixes compatibility with v1.17.0 and earlier", "Fixes older devices being unable to add 1.18.0+ devices as favorites"), NearDrop/RQuickShare vs Google changes.

---

## 10. TOP FRUSTRATIONS (distilled)
1. "Can't see my device" on hostile networks (AP isolation, campus Wi-Fi, VPN, firewall, OS permission, ephemeral port reserved by Windows).
2. Receiver must have the app open/foreground; background receive is blocked or killed by OEM battery managers.
3. Silent failure: no notification on arrival, no progress, no reason when stuck.
4. Slow transfers caused by encryption implementation, relay (TURN) or Wi-Fi band; large files (GB) fail with no resume.
5. Having to sit at the receiver to tap Accept, and a timeout if you miss it.
6. Links and text arriving as .txt files rather than as tappable links / clipboard.
7. No OS share-sheet / right-click integration on desktop (Windows 11 especially).
8. Updates that silently change the protocol and break pairing.
9. Trust: no way to know the "known device" is really yours; web pages can't prove their own code.
10. Battery: always-on listeners (VPN/mesh/foreground services) are the main reason users turn these tools off.

---

## 11. IDEAS FOR SEND TO DAYLIGHT "LAB" (my synthesis; not evidence)
(see structured summary for the ranked list)
- Delivery timeline per item in the sender: Queued -> Uploaded -> Delivered to DC-1 -> Opened in Reader, with last-seen of the tablet and retry; notifications on the tablet with actions.
- Named-target Direct Share shortcut(s) on Android, share extension target tiles on iOS/macOS, Windows share sheet via the Chrome extension/PWA? (needs Windows app, out of current scope).
- "Paste first, choose target after" / "Send clipboard link" button.
- Quick Send trust: paired devices auto-accept; one-time guest code (wormhole-style words) for sending from someone else's computer.
- Chrome/Safari right-click: send page / link / selection / image-as-PDF, plus keyboard shortcut and toolbar badge showing delivery.
- Inbox history/thread view with expiry; "Continue on tablet" Handoff-style prompt.

## END
