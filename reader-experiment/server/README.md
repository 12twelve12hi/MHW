# Daylight server

A small Cloudflare Worker on your own Cloudflare account (free plan) that adds what the ntfy relay alone cannot do:

1. **Email-in**: a private address for newsletters and forwarded documents (optional; needs a domain on Cloudflare).
2. **Feeds and digests**: RSS, Atom and JSON feeds checked every hour, sent one by one or as one daily digest page.
3. **Large files**: files over the relay's 9 MB limit (up to 192 MB). The sending app encrypts them with the pairing
   key; the server stores and serves only ciphertext from R2.
4. **AI with Claude**: summaries, key points, "explain this" and "ask about this document", with your
   `ANTHROPIC_API_KEY`. Content sent for AI is **not** end-to-end encrypted (it goes to the Worker and to Anthropic),
   and the apps say so the first time.

The full spec is [DESIGN.md](DESIGN.md). The app-side module is [client/daylight-server.js](client/daylight-server.js)
(used as is by the extension and the web sender; Swift and Kotlin follow the same names and pass
[vectors/server-vectors.json](vectors/server-vectors.json)).

Until the Cloudflare secrets exist, GitHub Actions builds and tests the Worker on every push and the apps show its
features with a one-line "Needs the Daylight server…" message when tapped.

## Turning it on

Everything below is done once in the browser. Nothing is typed into a terminal.

| # | Where | What |
|---|---|---|
| 1 | [dash.cloudflare.com](https://dash.cloudflare.com) | Create a Cloudflare account (free). |
| 2 | Cloudflare › My Profile › API Tokens › **Create Token** | Use the **Edit Cloudflare Workers** template. Under Permissions add **Account › D1 › Edit**. If you may want email-in later, also add **Zone › Zone › Read**, **Zone › Email Routing Rules › Edit** and **Zone › DNS › Edit** for that domain's zone now. Create it and copy the token. |
| 3 | GitHub › this repo › Settings › Secrets and variables › Actions › **New repository secret** | `CLOUDFLARE_API_TOKEN` = the token from step 2. |
| 4 | Cloudflare › Workers & Pages (the account ID is in the right-hand column) | Copy the **Account ID** into the secret `CLOUDFLARE_ACCOUNT_ID`. |
| 5 | iPhone or Mac app › Lab settings › Daylight server › Server code › **Copy** | Paste it into the secret `DAYLIGHT_SERVER_CODE` (it starts with `SERVER-`, or `daylightserver://` when you use another relay). **Not** your pairing code: the deploy refuses a pairing code. Do this again after every re-pairing. |
| 6 | (optional) [console.anthropic.com](https://console.anthropic.com) | Create an API key, ideally in a workspace with a monthly spend limit, and save it as the secret `ANTHROPIC_API_KEY`. |
| 7 | (optional) Cloudflare › R2 | Turn on R2 (it asks for a card; the free tier is not charged). Needed for large files, email-in and PDF AI. |
| 8 | (optional) GitHub › Settings › Secrets | `DAYLIGHT_EMAIL_DOMAIN` = a domain (or subdomain such as `read.example.com`) on your Cloudflare account, for email-in. For a subdomain, add it once under Cloudflare › Email › Email Routing › Settings › Subdomains. Workers Paid is recommended for email-in (see below). |
| 9 | (recommended) GitHub › Settings › Environments › `daylight-server` (created by the first run) | Limit deployment branches to `claude/sweet-goldberg-ej1nb0` and move the secrets there. |
| 10 | GitHub › Actions › **Reader experiment - Daylight server** › the latest run › **Re-run all jobs** | Applies the secrets. A re-run reads the current secrets; a push that changes `reader-experiment/server/` also deploys. ("Run workflow" appears only for workflows on the default branch.) |

The deploy job's summary ends with **"Next: …"**, the first thing still missing. It shows the Server code's
fingerprint (e.g. `3f9a-1c2e`), which Lab settings also shows, so you can check the server has the current pairing.

Optional settings:

| GitHub secret or variable | What it does |
|---|---|
| `DAYLIGHT_EMAIL_LOCAL` (secret) | A fixed local part for the email address that survives re-pairing (at least 12 characters with a digit). |
| `DAYLIGHT_EMAIL_SALT` (secret) | Change it to get a new email address without re-pairing (if the address leaked). |
| `NTFY_TOKEN` (secret) | An ntfy access token, only useful with a paid ntfy.sh tier or a self-hosted relay that needs a login. |
| `DAYLIGHT_WORKERS_PLAN` (variable) | `paid` after subscribing to Workers Paid (US$5/month): CPU limit 60 s, reliable email-in, larger digests. |
| `DAYLIGHT_AI_MAX_USD_DAY`, `DAYLIGHT_AI_MAX_REQ_DAY` (variables) | Hard daily AI ceilings (default US$10 and 100 requests); the apps can only set lower caps. |
| `DAYLIGHT_DELIVERY=v1` (variable) + `DAYLIGHT_PAIRING` (secret) | Opt-in: server-made items reach a v1 Daylight Inbox before the Lab Inbox exists. The server then holds your pairing code, so whoever controls your Cloudflare or GitHub account can read everything sent to this Daylight. Without the variable, `DAYLIGHT_PAIRING` is never uploaded. |

After changing any of them: open the latest run and choose **Re-run all jobs**.

## What the apps show

Every server feature is a normal, enabled control in Lab. Tapping one that is not set up shows one sentence:

| State | Message |
|---|---|
| needs-server | Needs the Daylight server. Add CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and DAYLIGHT_SERVER_CODE (Lab settings › Daylight server › Server code) in GitHub › Settings › Secrets to turn this on. |
| needs-key | Needs a Claude API key. Add ANTHROPIC_API_KEY to the Daylight server (GitHub › Settings › Secrets), then re-run the deploy, to turn this on. |
| needs-r2 | Needs R2 storage on your Cloudflare account. Turn on R2 in the Cloudflare dashboard (it asks for a card; the free tier isn't charged), then re-run the deploy. |
| needs-domain | Needs an email domain. Add DAYLIGHT_EMAIL_DOMAIN (a domain on your Cloudflare account) in GitHub › Settings › Secrets, then re-run the deploy. |
| needs-lab-inbox | Your Daylight server hasn’t heard from your Daylight yet. Open Daylight Share on it with Lab on. |
| needs-paid | Email-in needs Cloudflare's Workers Paid plan. Subscribe in the Cloudflare dashboard, set the variable DAYLIGHT_WORKERS_PLAN to paid in GitHub › Settings, then re-run the deploy. |
| pairing-mismatch | The Daylight server still has your previous pairing. Copy the new Server code into DAYLIGHT_SERVER_CODE, then re-run the deploy. |
| locked | The Daylight server was locked when this device was re-paired. Copy the new Server code into DAYLIGHT_SERVER_CODE, then re-run the deploy. |

"Re-run the deploy" means: in GitHub › Actions, open the latest "Reader experiment - Daylight server" run and choose
Re-run all jobs. The first time a feature is used the app shows its notice (AI and email are not end-to-end
encrypted; the feed list is kept on the server; large files wait encrypted for up to 14 days). Every server error
carries its own one-line `message`, which the apps show as is; the states above always show the client module's
text for them. The full table is DESIGN.md section 14 and `ERROR_MESSAGES` in the client module.

### For the Lab apps (LAB-PLAN 2.6)

- A tap runs the app's gate, which races `state(feature)` against 5 s (a timeout reads as `OFFLINE`); the state comes
  from the cached `GET /v1/status` (10 minutes) through `stateFromStatus`. The states form a closed set
  (`SERVER_STATES`): a status state the app decides itself, a Lab state or an unknown one reads as `error`.
- When a server call fails, the app calls `noteError(feature, error)` and shows the `{state, message}` it returns
  (`stateFromError`). `NEEDS_KEY`, `NOT_CONFIGURED` and `NEEDS_LAB_INBOX` update the cached status for the feature the
  server names and mark it for refresh; `LOCKED` and `BAD_AUTH` drop it (the first `BAD_AUTH` until the status
  answers again also re-reads the config topic, once); `RATE_LIMITED`, `AI_BUSY` and the like leave the feature ready.
  Only the module writes `server/status`. An error JSON whose `code` is `OFFLINE`, or not a server code, is not read.
- Swift and Kotlin port this W0 subset under the same names and pass `vectors/server-vectors.json`, including its
  `serverState` section (status JSON or the server's answer in, `{state, message}` and the cache effect out, with
  `NOT_CONFIGURED`'s order: `DAYLIGHT_SERVER_CODE`, `DAYLIGHT_EMAIL_DOMAIN`, `R2`).
- Lab frames (`ids: []` with `x-inbox`, maybe `x-st`) deliver nothing on the server (on either ack topic) or in the
  hosted outbox (`files.tick`). They are the Lab Inbox's presence; `x-inbox.lab: 0` ends it for its publisher
  (DESIGN 5.5). Lab delivery's features answer `needs-lab-inbox` without it; v1 delivery never gates on it.

## HTTP API (summary)

All authenticated routes take `Authorization: Bearer <authToken>` (derived from the Server code; apps derive it from the
pairing). Apps find the server through an encrypted config frame on the server's config topic on the relay.

| Route | Purpose |
|---|---|
| `GET /v1/hello` | `{"service": "daylight-server", "api": 1}` (unauthenticated) |
| `GET /f/<fileId>/<i>`, `GET /o/<token>/<i>` | Hosted frames for any Inbox (unauthenticated; ciphertext behind 128-bit capability ids) |
| `GET /v1/status` | Config fields, feature states and messages, usage, storage, relay and CPU canary |
| `GET`, `PATCH /v1/settings` | Daily AI cap (up to the ceiling), digest hour and time zone |
| `POST /v1/admin/announce`, `/selftest`, `/lock` | Publish the config now, the CPU canary, lock before re-pairing |
| `PUT /v1/files/<fileId>/<i>?n=`, `GET`, `DELETE /v1/files/<fileId>` | Large files: upload frames, resume, delete |
| `GET /v1/email`, `POST /v1/email/block`, `/unblock`, `GET /v1/email/recent` | Email-in address, block list, recent mail |
| `GET`, `POST /v1/feeds`, `PATCH`, `DELETE /v1/feeds/<id>`, `POST /v1/feeds/<id>/check`, `POST /v1/feeds/import`, `POST /v1/digest/send` | Feeds and the digest |
| `PUT /v1/ai/sources/<sourceId>/<i>?n=`, `POST /v1/ai`, `POST /v1/ai/jobs`, `GET /v1/ai/jobs/<id>` | AI: PDF parts, requests (keepalive newlines, then one JSON object), queued jobs |

Claude is called with the official `@anthropic-ai/sdk`: model `claude-opus-5-5`, `client.beta.messages.create` with
`betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"`, an explicit `output_config.effort`, structured
outputs for summaries, `max_tokens` 16000, no sampling parameters, not streamed (the Free plan's CPU), no retries;
`stop_reason` is checked before content and errors are mapped by the SDK's typed classes. The worst-case cost,
including a fallback model's attempt, is reserved atomically in D1 before every call (DESIGN 9.3).

## Development

```
npm ci
npx tsc --noEmit        # type check
npm test                # builds the test bundle, then unit tests (Node) and Worker/e2e tests (workerd via Miniflare)
npm run vectors         # regenerates vectors/server-vectors.json
```

The tests need no Cloudflare account and no network: the Worker runs in the local workerd runtime with in-memory D1
and R2; every outbound fetch goes to share's mock ntfy relay (plus `Attach:`), a mock Claude API or per-test web hosts.
The end-to-end tests send an email-in newsletter and a 30 MB file through the Worker to the protocol's JS `Receiver`.
Test-only code is behind the build-time constant `__TESTING__`, which is `false` in every deploy bundle; CI checks
the bundle contains none of it.

Layout: `src/` (the Worker), `client/` (the app module), `migrations/` (D1), `scripts/` (CI helpers: `derive.mjs`
gate/email/announce, `cf-check.mjs`, `secrets.mjs`, `test.mjs`), `vectors/`, `test/` (with `test/live/ntfy-attach.mjs`,
an informational probe of ntfy.sh's `Attach:` handling that runs on the GitHub runner).
