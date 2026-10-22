# Loose ends

Things that are built and waiting on something only the user can provide, and things to build later so they aren't forgotten.

## Sign and notarize the Mac app with your Apple Developer ID

The Mac app ships ad-hoc signed today. That has three effects:
- macOS may warn on first open.
- The Share menu item and the Safari extension can't share the app's pairing (each asks for the code once).
- Safari needs "Allow unsigned extensions".

CI's signing path is built: the `mac-developer-id` job of `rx-apple.yml` with `apple/scripts/sign-mac.sh`. Until
the secrets exist it runs as a dry run on every Apple build, with a throwaway certificate, and the release stays ad-hoc
signed. It switches on by itself once all six GitHub secrets below exist (MHW › Settings › Secrets and variables ›
Actions). Then it:
- signs the app, its Share extension and its Safari extension with your Developer ID, the hardened runtime, a secure
  timestamp and the App Group `<TEAMID>.com.daylight.share`;
- notarizes and staples the app;
- runs the Mac smoke test on it;
- publishes it as `Send-to-Daylight-mac.zip` instead of the ad-hoc build. If signing or notarizing fails, that run
  publishes nothing, so the release never goes back to an ad-hoc Mac build.

The step-by-step guide covers creating the certificate, exporting the .p12, creating the API key and what changes for
Mac users: `reader-experiment/apple/README.md` › Signing.

| Secret | What it is |
|---|---|
| `APPLE_TEAM_ID` | Your 10-character Team ID (developer.apple.com › Account › Membership details) |
| `MAC_DEVELOPER_ID_P12` | Your "Developer ID Application" certificate and its private key, exported from Keychain Access as .p12, base64-encoded |
| `MAC_DEVELOPER_ID_P12_PASSWORD` | The .p12 export password |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` | An App Store Connect API key with Admin access (Users and Access › Integrations): its Key ID, the Issuer ID, and the contents of its `AuthKey_<KEYID>.p8` file. Used for notarization and TestFlight. |

Before you add them:
- **They also start TestFlight.** `APPLE_TEAM_ID` and the three `ASC_*` secrets also turn on the iPhone app's
  TestFlight upload on every build. That needs the key's Admin access and the iPhone app created in App Store Connect
  (Apps › + › New App, bundle id `com.daylight.share`). Without them the TestFlight job fails on every run.
- **One change still has to land first.** Moving from the ad-hoc build to the signed one carries the pairing, this
  Mac's name and the history into the App Group, but not Comfort, the Lab switch, the one-time Lab note, Lab's
  delivery record (`lab.json`) or the Daylight server's pin and notices (`server.json`). The plan says updates keep
  them (LAB-PLAN 1.2, 1.3). `SharedStore.migrate` in `apple/DaylightShareKit` must carry them too, and it needs a test.
  This is the kit lane's job; remove this item once it lands.

Then push any change under `reader-experiment/apple/`, or choose Re-run all jobs on the latest "Reader experiment –
Apple apps" run. If a secret is missing, the "Mac signing (secrets)" job's log names it. Keep the secrets once the
release is signed: without them CI goes back to the ad-hoc build, which can't read the pairing and history that moved
into the App Group.

## Deploy the Daylight server (Cloudflare)

Two GitHub secrets (MHW › Settings › Secrets and variables › Actions) turn it on:

| Secret | What it is |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token from the "Edit Cloudflare Workers" template, plus Account › D1 › Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Your account ID (Cloudflare › Workers & Pages, right-hand column) |
| `ANTHROPIC_API_KEY` (optional) | For the AI features; without it they say they need it |
| `DAYLIGHT_EMAIL_DOMAIN` (optional) | A domain on Cloudflare for the email-in address (needs R2; Workers Paid recommended) |

Then open the latest "Reader experiment - Daylight server" run in GitHub › Actions and choose Re-run all jobs. GitHub
offers that for 30 days after a run; if the latest run is older, push any change under `reader-experiment/server/`
(or run `gh workflow run rx-server.yml --ref claude/sweet-goldberg-ej1nb0`; the Run workflow button appears only once
the workflow is on the default branch). The run creates the database, deploys the Worker, checks it, and its summary
says where to read a one-time setup link in Cloudflare. Paste that link in the iPhone or Mac app (Lab settings ›
Daylight server › Set up with a link). Until the apps have that button, copy the app's Server code into the secret
`DAYLIGHT_SERVER_CODE` instead. Turning on R2 in the
Cloudflare dashboard (it asks for a card; the free tier isn't charged) adds large files, email-in and PDF AI. Details:
`reader-experiment/server/README.md` › Turn it on.

## Turn on GitHub Pages for the web sender

MHW › Settings › Pages › Source: GitHub Actions. The sender then lives at https://12twelve12hi.github.io/MHW/send/.

## Later: import a library from the previous Reader app (low priority)

Raised by the user on Oct 22. Not started, and behind everything in the Lab plan, but needed before the new Reader
reaches customers. People moving to the new Reader should be able to bring their library from the previous Reader app,
not start over.

To settle when it's picked up:
- which "previous" apps it covers (the earlier Daylight Reader builds only, or others too);
- what comes across: documents, saved pages, collections, highlights and notes, ink, reading position;
- where it runs: inside the new Reader on the tablet, or as a one-time export and import;
- how to avoid duplicates when someone imports twice.

It is Reader-side work, so it belongs to the Reader session on the Mac mini and is proved on the lab tablet first.
