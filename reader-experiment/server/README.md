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

## Turn it on

Two GitHub secrets turn it on. Everything is done in the browser.

| # | Where | What |
|---|---|---|
| 1 | [dash.cloudflare.com](https://dash.cloudflare.com) | Create a Cloudflare account (free). |
| 2 | Cloudflare › My Profile › API Tokens › **Create Token** | Use the **Edit Cloudflare Workers** template and add **Account › D1 › Edit**. For email-in later, also add **Zone › Zone › Read**, **Zone › Email Routing Rules › Edit** and **Zone › DNS › Edit** for that domain now. Copy the token. |
| 3 | GitHub › this repo › Settings › Secrets and variables › Actions › **New repository secret** | `CLOUDFLARE_API_TOKEN` = the token, and `CLOUDFLARE_ACCOUNT_ID` = the Account ID (Cloudflare › Workers & Pages, right-hand column). |
| 4 | (optional) [console.anthropic.com](https://console.anthropic.com) | An API key for AI, ideally in a workspace with a monthly spend limit, as the secret `ANTHROPIC_API_KEY`. Without it the AI features say they need it. |
| 5 | GitHub › Actions › **Reader experiment - Daylight server** | Open the latest run and choose **Re-run all jobs**. GitHub offers that for 30 days after a run; if the latest run is older, push a change under `reader-experiment/server/`, or run `gh workflow run rx-server.yml --ref claude/sweet-goldberg-ej1nb0` (**Run workflow** appears once this file is on the default branch). |

**What happens next.** The deploy job creates the D1 database, applies its migrations, uses R2 if your account has it,
deploys the Worker, checks the live Worker (it answers, CORS works, requests without the right token are refused) and
makes a one-time **setup link**. The job summary ends with **Next: …**:

1. Read the setup link in Cloudflare: dashboard › Storage & Databases › D1 SQL Database › **daylight-server** ›
   Console, run `SELECT link FROM setup;`. (Or, with Node.js, in any folder: `npx wrangler d1 execute daylight-server
   --remote --command "SELECT link FROM setup"`.) It is never shown in GitHub, whose logs are public.
2. Paste it in the iPhone or Mac app: Lab settings › Daylight server › **Set up with a link**. The app gives the server
   its Server code; your other devices and the Daylight then find the server by themselves. The app takes only a link
   to `https://daylight-<12 letters and digits>.<your subdomain>.workers.dev` and shows the address before it sends:
   never paste a setup link someone sent you.

**Check it worked.** Run the workflow again (Re-run all jobs): its summary says **Daylight server is live** with your
Server code's fingerprint (e.g. `3f9a-1c2e`), which Lab settings › Daylight server shows too, and the state of each
feature. In the app, the server row says Ready.

**No "Set up with a link" in your app yet?** Copy Lab settings › Daylight server › Server code into the secret
`DAYLIGHT_SERVER_CODE` (it starts with `SERVER-`, or `daylightserver://` with another relay; **not** the pairing code,
which the deploy refuses) and run the workflow again. When that secret is set it always wins.

**After re-pairing** the app locks the old server; run the workflow again and paste the new setup link (if the summary
still says the server is set up, run the workflow by hand with **New setup link**; re-running that run later deploys
the same server, it does not make another link). With the secret, paste the new Server code into
`DAYLIGHT_SERVER_CODE` instead.

Recommended: GitHub › Settings › Environments › `daylight-server` (created by the first run): limit deployment
branches to `claude/sweet-goldberg-ej1nb0` and move the secrets there.

Optional settings:

| GitHub secret or variable | What it does |
|---|---|
| `DAYLIGHT_EMAIL_DOMAIN` (secret) | A domain (or subdomain such as `read.example.com`) on your Cloudflare account, for email-in. For a subdomain, add it once under Cloudflare › Email › Email Routing › Settings › Subdomains. Needs R2; Workers Paid is recommended. |
| `DAYLIGHT_EMAIL_LOCAL` (secret) | A fixed local part for the email address that survives re-pairing (at least 12 characters with a digit). |
| `DAYLIGHT_EMAIL_SALT` (secret) | Change it to get a new email address without re-pairing (if the address leaked). |
| `NTFY_TOKEN` (secret) | An ntfy access token, only useful with a paid ntfy.sh tier or a self-hosted relay that needs a login. |
| `DAYLIGHT_WORKERS_PLAN` (variable) | `paid` after subscribing to Workers Paid (US$5/month): CPU limit 60 s, reliable email-in, larger digests. |
| `DAYLIGHT_AI_MAX_USD_DAY`, `DAYLIGHT_AI_MAX_REQ_DAY` (variables) | Hard daily AI ceilings (default US$10 and 100 requests); the apps can only set lower caps. |
| `DAYLIGHT_DELIVERY=v1` (variable) + `DAYLIGHT_PAIRING` (secret) | Opt-in: server-made items reach a v1 Daylight Inbox before the Lab Inbox exists. The server then holds your pairing code, so whoever controls your Cloudflare or GitHub account can read everything sent to this Daylight. Without the variable, `DAYLIGHT_PAIRING` is never uploaded. |
| R2 (Cloudflare dashboard) | Turn it on (it asks for a card; the free tier is not charged) for large files, email-in and PDF AI. |

After changing any of them: open the latest run and choose **Re-run all jobs** (any re-run deploys; older than 30
days, use a push or `gh workflow run` as in step 5). A manual run (**Run workflow**, or
`gh workflow run rx-server.yml --ref claude/sweet-goldberg-ej1nb0 -f new_setup_link=true`) has two boxes: **deploy**
(off: only build and test) and **new setup link** (a link that may have leaked, or a re-pairing whose lock did not reach
the server; the server moves to a new address). A manual run is a one-off: its boxes apply to its first attempt only, and
Re-run all jobs of it always deploys and never makes another link.

## What the apps show

Every server feature is a normal, enabled control in Lab. Tapping one that is not set up shows one sentence:

| State | Message |
|---|---|
| needs-server | Needs the Daylight server. Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in GitHub › Settings › Secrets, then paste the setup link the deploy makes in Lab settings › Daylight server. |
| needs-key | Needs a Claude API key. Add ANTHROPIC_API_KEY to the Daylight server (GitHub › Settings › Secrets), then re-run the deploy, to turn this on. |
| needs-r2 | Needs R2 storage on your Cloudflare account. Turn on R2 in the Cloudflare dashboard (it asks for a card; the free tier isn't charged), then re-run the deploy. |
| needs-domain | Needs an email domain. Add DAYLIGHT_EMAIL_DOMAIN (a domain on your Cloudflare account) in GitHub › Settings › Secrets, then re-run the deploy. |
| needs-lab-inbox | Your Daylight server hasn’t heard from your Daylight yet. Open Daylight Share on it with Lab on. |
| needs-paid | Email-in needs Cloudflare's Workers Paid plan. Subscribe in the Cloudflare dashboard, set the variable DAYLIGHT_WORKERS_PLAN to paid in GitHub › Settings, then re-run the deploy. |
| pairing-mismatch | The Daylight server still has your previous pairing. Re-run the deploy and paste its new setup link in Lab settings › Daylight server, or copy the new Server code into DAYLIGHT_SERVER_CODE. |
| locked | The Daylight server was locked when this device was re-paired. Re-run the deploy and paste its new setup link in Lab settings › Daylight server, or copy the new Server code into DAYLIGHT_SERVER_CODE. |

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
pairing). Apps find the server through an encrypted config frame on the server's config topic on the relay; the first
app is given it with the setup link (`DaylightServer.setup(link)`, DESIGN 3.5).

| Route | Purpose |
|---|---|
| `GET /v1/hello` | `{"service": "daylight-server", "api": 1}` (unauthenticated) |
| `POST /v1/setup`, `GET /setup` | The setup link: an app sends its Server code with the link's own token, once (DESIGN 3.5) |
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
gate/email/announce with the smoke test, `setup.mjs` for the Worker's name, address and setup link, `cf-check.mjs`,
`secrets.mjs`, `test.mjs`), `vectors/`, `test/` (with `test/live/ntfy-attach.mjs`, an informational probe of
ntfy.sh's `Attach:` handling that runs on the GitHub runner). `test/e2e-setup.test.mjs` rehearses the first deploy:
the scripts as the workflow runs them, the live Worker's checks, an app setting the server up, and a server-made item
reaching the Lab Inbox's lane through the mock relay.
