# Loose ends

Things that are built and waiting on something only the user can provide.

## Sign and notarize the Mac app with your Apple Developer ID

The Mac app ships ad-hoc signed today. That has three effects:
- macOS may warn on first open.
- The Share menu item and the Safari extension can't share the app's pairing (each asks for the code once).
- Safari needs "Allow unsigned extensions".

CI has a signing path that switches on by itself once these GitHub secrets exist (MHW › Settings › Secrets and
variables › Actions). It signs with the Developer ID, enables the hardened runtime and a team-prefixed App Group,
notarizes, and staples. Once they exist, the next CI run publishes a signed, notarized `Send-to-Daylight-mac.zip`.
The names below are final once the signing card lands (see `reader-experiment/apple/README.md` › Signing).

| Secret | What it is |
|---|---|
| `APPLE_TEAM_ID` | Your 10-character Team ID (developer.apple.com › Membership) |
| `MAC_DEVELOPER_ID_P12` | Your "Developer ID Application" certificate and key, exported as .p12, base64-encoded |
| `MAC_DEVELOPER_ID_P12_PASSWORD` | The .p12 export password |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` | An App Store Connect API key (Users and Access › Integrations), used for notarization and TestFlight |

The same Apple account also unlocks TestFlight for the iPhone app. Its job is already written and guarded by
the same secrets.

## Deploy the Daylight server (Cloudflare)

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, plus `ANTHROPIC_API_KEY` for the AI features. Optionally, a
domain on Cloudflare for the email-in address. See `reader-experiment/server/README.md`.

## Turn on GitHub Pages for the web sender

MHW › Settings › Pages › Source: GitHub Actions. The sender then lives at https://12twelve12hi.github.io/MHW/send/.
