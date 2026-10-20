# Daylight server: design

The Daylight server is a small Cloudflare Worker on the user's own Cloudflare account (free plan). It adds four things
the relay alone cannot do, and nothing else:

1. **Email-in**: a private address for newsletters and documents (needs a domain on Cloudflare; optional).
2. **Feeds and digests**: RSS/Atom/JSON feeds checked on a schedule, sent one by one or as a daily digest page.
3. **Large files**: files beyond ntfy.sh's limits. The sending app encrypts them with the pairing key; the server
   stores and serves only ciphertext it cannot decrypt.
4. **AI**: summaries, key points, "explain this" and "ask about this document" with Claude, using the user's
   `ANTHROPIC_API_KEY`.

It builds on the Daylight Share protocol (`../share/PROTOCOL.md`, revision 1.1 in `../share/CHANGES-v1.1.md`): the
same frame format, the same pairing key, inbox and ack topics. Large files reach **any** Daylight Inbox, v1 included,
as ordinary frames. Items the server makes (email, feeds, digests, AI results) go to the Daylight on a separate server
lane that the Lab Inbox reads (5.1). The rules from `../LAB-DECISIONS.md` apply throughout. The features are always
visible in Lab. Tapping one that is not set up shows one sentence that names what is missing and where to add it
(section 14).

This document is the spec for `reader-experiment/server/` (Worker, migrations, deploy workflow) and for the app-side
client module `reader-experiment/server/client/daylight-server.js`. Swift and Kotlin follow the same spec later.

**Revision 2 (Oct 20, 2026)** answers the security review and the simplicity/operations review. Every point and what
was done with it is in the Critique log at the end. The big changes:

- **The server never holds the pairing secret by default.** It gets a one-way **Server code** instead, which the
  iPhone/Mac app shows. Giving it the pairing code is an explicit, honestly worded opt-in (3.1).
- **Large files are ordinary v1 frames hosted by the Worker** and announced on ntfy with `Attach:`. This works with
  today's Inbox. There is no pointer frame, no per-item key and no special receiver (6).
- **A bearer token replaces HMAC request signing** (3.3). The direct lane is gone, and the config frame is minimal (4).
- **Free-plan limits are stated as they are.** D1 allows 50 queries per invocation. R2 needs a card on file and is
  optional. Email-in needs Workers Paid in practice (2).
- **Email, feeds and AI are cut to a first release.** Email has an open policy plus a block list. Feeds have one digest
  time. AI has one endpoint and one user setting (7–9).

---

## 0. Decisions at a glance

| Question | Decision |
|---|---|
| What the server knows | Repo secret **`DAYLIGHT_SERVER_CODE`**: a 16-byte seed derived one-way from the pairing secret, copied from Lab settings in the iPhone/Mac app. All of the server's keys, topics and tokens come from it. It cannot decrypt anything apps send to the Daylight (3.1). |
| Delivery of server-made items | **Lab delivery** (default): on the server's own item topic, under a seed-derived key, read by the DC-1 Lab Inbox. **v1 delivery** (opt-in, repo variable `DAYLIGHT_DELIVERY=v1` plus secret `DAYLIGHT_PAIRING`): on the inbox topic under the pairing key, read by any Inbox, with the honest warning that the server can then read everything sent to the Daylight (5.1). |
| How apps authenticate | `Authorization: Bearer <authToken>`, a 64-hex token derived from the seed. It is compared in constant time before the body is read. No signatures, nonces or clock checks (3.3). |
| How apps find the server | An encrypted **config frame** `{server, api, fingerprint, delivery, sent}` on the server's config topic. It is published at deploy (by the GitHub runner and by the Worker) and every 6 h. Apps pin the server's origin on first sight (TOFU). Feature states come from `GET /v1/status` (4). |
| Large files | Encoded size over the relay's largest item (9 MB on ntfy.sh), up to 16 × 12 MiB. The sender builds normal v1 frames with the pairing key and uploads them with idempotent `PUT /v1/files/{id}/{i}`. It then publishes one small `Attach: https://<worker>/f/<id>/<i>` message per frame on the inbox topic, re-sends those until acked, and deletes the file. Needs R2 (6). |
| Email-in | `daylight-<10 chars from the seed>@<your domain>` → Email Routing → Worker. Policy **open** with a block list; `dmarc=fail` dropped; caps never bounce mail. Needs a domain, R2 and, in practice, Workers Paid (7). |
| Feeds | Stored in D1, checked hourly. Each feed is set to `each` (every new article as a `url` item) or `digest`. There is one daily digest at a chosen hour and time zone (8). |
| AI | `POST /v1/ai` with `op`. `@anthropic-ai/sdk`, model `claude-opus-5-5`, `client.beta.messages.create` with `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`, explicit `output_config.effort`, structured outputs for JSON. PDFs are base64 `document` blocks spliced from validated R2 parts. Worst-case cost is reserved before each call, under deploy-time ceilings (9). |
| Storage | **D1** for state and for the server's own item frames. **R2** (optional) for hosted large files, raw email and PDF sources. No KV (11). |
| Deploy | GitHub Actions `rx-server.yml`: always test. Deploy when `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `DAYLIGHT_SERVER_CODE` exist. Secrets are given only to the steps that need them. New secrets apply when the user opens the latest run and chooses **Re-run all jobs** (12). |
| CPU budget | Large bodies stream; JavaScript never touches them. Each invocation has a D1-query and subrequest budget. One heavy step per Cron run, with attempt counting. A deploy-time CPU canary tells the user what needs Workers Paid (2). |

---

## 1. Architecture

```
                  end-to-end encrypted (pairing key)                   ┌──────────── Daylight DC-1 ─────────────┐
 iPhone / Mac  ─────────── frames, small Attach: messages ──▶ ntfy.sh ─▶│ Daylight Share Inbox ──▶ Reader         │
 Android / ext ─┐                                             ▲  ▲  ▲   │  v1: inbox topic                        │
 web sender     │                                             │  │  │   │  Lab: + server item topic (5.1)         │
                │ large file frames (ciphertext, PUT)         │  │  │   └──────┬──────────────▲───────────────────┘
                ├────────────▶ ┌──────────────────────────────┴──┴──┴─┐  GET    │ hosted frames │ (any Inbox)
                │ AI requests  │ Daylight server (Worker)              │◀────────┴───────────────┘
                ├────────────▶ │  D1: state, server item frames        │  /f/<id>/<i>, /o/<token>/<i>
                │ feeds/email  │  R2 (optional): files, mail, PDFs      │
                └──settings──▶ │  Cron: every minute                    │
                               │  email() ◀── Email Routing ◀─── newsletters, forwarded documents
                               │  ──▶ Claude API (Anthropic)            │
                               └────────────────────────────────────────┘
```

What stays end-to-end encrypted, and what does not:

| Path | Who can read the content |
|---|---|
| Links, pages and files sent from an app over ntfy (as today) | Only devices holding the pairing secret. With Lab delivery the server cannot read them: it never has the pairing secret or key and never learns the inbox topic. |
| Large files through the server | Only devices holding the pairing secret. The server stores and serves frames encrypted with the pairing key, which it does not have (6.6). |
| Items the server makes (email, feeds, digests, AI results) | The server sees them in plain text because it makes them. ntfy sees ciphertext under the server's key. Any app holding the pairing secret can derive that key. |
| Email-in, the feed list, AI requests | **Not end-to-end encrypted.** Email arrives in plain text, feed URLs are stored in D1, and AI content goes to the Worker and to Anthropic. The apps say so the first time (14.3). |
| **v1 delivery (opt-in) only** | The server holds the pairing secret. Anyone who controls the Worker can read **everything** sent to this Daylight: the Cloudflare account, the API token, or whoever can change the deploy. The apps say so in Lab settings (14.3). |

The server holds the Server code (as a Worker secret). Anyone who controls the Worker gets the server's powers and no
more. They can read what the server stores in plain text, forge server-made items (which the Lab Inbox labels "From
your server") and spend the Anthropic key within its caps. Section 15 covers the rest.

---

## 2. Cloudflare free plan: the limits that shape this design

### 2.1 Limits (Workers Free plan, as documented in October 2026)

| Product | Free-plan limit | How the design stays inside it |
|---|---|---|
| Workers requests | 100,000 / day (resets 00:00 UTC) | Cron 1,440 + app traffic (hundreds) + hosted-frame downloads (tens) ≈ 2,000 / day. Failed authentications are rate-limited (3.3). |
| CPU time | **10 ms per HTTP request and per Cron run.** Each isolate has some flexibility for *infrequent* overruns; a Worker that overruns consistently is terminated (error 1102, `exceededCpu`). | 2.2. |
| Wall-clock time | No limit for an HTTP request while the client stays connected; **15 min** for a Cron run; `waitUntil` ≤ 30 s after the response | AI calls run inside the request (with keepalives, 9.5) or inside a Cron run (jobs); never in `waitUntil`. |
| Subrequests | **50 external** per invocation; calls to Cloudflare services count separately; 6 simultaneous outgoing connections | Fixed allowances per Cron step, ≤ 40 in total (2.3). Redirects count. |
| D1 queries | **50 per Worker invocation** (1,000 on Paid). Neither workerd nor Miniflare enforces this. | Every invocation has a budget of 40 statements, counted by a wrapper around `env.DB` that the tests also use (2.3). |
| Memory | 128 MB per isolate | Bodies stream; the largest buffer is one ≤ 1 MiB server frame or one ≤ 4 MiB PDF part. |
| Worker size | 3 MB compressed | SDK + postal-mime + our code ≈ 0.5 MB; CI checks the gzipped bundle (12.4). |
| Cron Triggers | 5 per account | The server uses **one**: `* * * * *`. |
| Request body | 100 MB (workers.dev) | Largest upload is one hosted-file frame (≤ 12,713,984 bytes) or one PDF part (4 MiB). `Content-Length` is required and checked before reading (3.3). |
| D1 | 5 M rows read / day, 100 k rows written / day, 500 MB per database, **2,000,000 bytes per row**, 10 databases | One database. Server frames are ≤ 1 MiB rows. Writes are ≪ 10 k / day. A guard pauses optional writes past 400 MB (11.1). |
| R2 | 10 GB-month, 1 M Class A / month, 10 M Class B / month, free egress. **Switching R2 on requires a payment method on file, even for the free tier.** | Optional. Without R2 the deploy leaves out the binding. Large files, email-in and PDF AI then answer `needs-r2`; everything else works (12.0). |
| KV | 1,000 writes / day; eventually consistent (up to 60 s) | **Not used.** A just-written frame could 404 at another location, and v1 receivers treat 404 as "expired". |
| Email Routing | Free, inbound unlimited; **25 MiB** per message; 200 rules; domain's DNS must be on Cloudflare | One literal rule → the Worker. |
| Rate limiting binding | `[[ratelimits]]` binding, counted per location | 30 failed requests per minute per IP (3.3). If an account rejects the binding, the deploy drops it (12.4). |

### 2.2 The 10 ms rule

CPU measured on the build box (Node 22, the same V8 family as workerd; Cloudflare's servers are not slower):

| Operation | CPU |
|---|---|
| AES-GCM encrypt 1 MiB / SHA-256 1 MiB / SHA-256 16 MiB | 2.3 ms / 3.4 ms / 59 ms |
| deflate-raw a 304 KiB page | 2.7 ms |
| Base64-encode 20 MiB (`Buffer`) / `JSON.stringify` a body holding 27 MB of base64 | 26 ms / **124 ms** |
| postal-mime parse of a 74 KiB newsletter: cold / warm; 186 KiB warm | **36 ms** / 6.5 ms / 19 ms |
| Scan 30 MB for `"` and `\`: `Buffer.indexOf` / `Uint8Array.prototype.indexOf` / per-byte table loop | 8.7 ms / **44–56 ms** / 92 ms |
| Scan one 4 MiB PDF part the same way (worst method) | ≈ 7 ms |
| Scan a 69 KiB RSS feed (50 items) | 0.3 ms |

Rules for the implementation:

1. **Large bodies never pass through JavaScript.** Hosted-file frames and raw emails go from the request (or
   `message.raw`) to R2 as streams. They come back from R2 (or from D1 for server frames) as response bodies. Hosted
   frames are checked by the receiver (AES-GCM and SHA-256), never by the server.
2. **The only scans are small and bounded.** A PDF is uploaded in parts of at most 4 MiB, and each part is scanned in
   its own request (9.2). A single 30 MB scan does not fit in 10 ms with typed arrays.
3. **PDFs reach Claude without `JSON.stringify` touching them.** The SDK builds the request with a short placeholder.
   A custom `fetch` splices the validated parts in as a stream (9.4).
4. **Steps are small, budgeted and alone.** A Cron run does at most one heavy step: parse one email, or build one
   server item over 256 KiB. Beside it run light steps, each with its own D1 and subrequest allowance (2.3).
5. **Every queued step counts attempts before it starts.** A step killed for CPU is retried by a later run. After 3
   attempts a job fails with `SERVER_LIMIT`. Mail is not failed: it waits as `waiting-paid` in R2 for up to 7 days,
   so switching to Workers Paid delivers it.
6. **What needs Workers Paid, plainly.** postal-mime alone takes 36 ms cold, and Cron isolates are often cold. So on
   Free, **email-in is best effort: most real newsletters and every forwarded document will not get through.** Other
   things that tend to exceed 10 ms are digests over 256 KiB (capped on Free) and AI on long URL pages (1 MiB of HTML
   on Free). Feeds, short digests, text AI, PDF AI and large files are designed to fit.
7. **CPU canary.** After every deploy the workflow calls `POST /v1/admin/selftest` three times. Each call parses a
   150 KiB newsletter fixture and builds a 256 KiB server item. If Cloudflare kills a call (1102 or 503), the job
   summary and `GET /v1/status` say "email-in needs Workers Paid". The email feature state is then `needs-paid` (14).
8. **Workers Paid** (US$5/month) lifts this. Set the repo variable `DAYLIGHT_WORKERS_PLAN=paid` and re-run the
   deploy. That adds `[limits] cpu_ms = 60000` and raises the caps: 4 heavy steps per run, 500 feeds, 4 MiB digests,
   and a 1,000-query D1 budget. The code is the same.

### 2.3 Per-invocation budgets

A wrapper around `env.DB` counts statements, counting each statement in a `db.batch()` separately to stay
conservative. A wrapper around `fetch` counts external subrequests. Each step gets an allowance and stops cleanly
(leaving its work for the next run) when the allowance is used. Each step runs in its own `try/catch`, so one failing
step never fails the others.

| Cron step (in this order) | Runs | D1 statements | External subrequests |
|---|---|---|---|
| Settings and lock check | every run | 1 | 0 |
| Config publish | every 6 h, or when the server origin or delivery mode changed | 1 | 1 |
| Ack poll (5.4) | every 30 min while something awaits an ack | 2 | 1 |
| Outbox publish | every run with due items | 3 | ≤ 6 |
| Feeds (8.2) | every run with due feeds | ≤ 14 | ≤ 15 (≤ 3 feeds × ≤ 5 with redirects) |
| Digest (8.3) | once a day | ≤ 5 | 0 |
| One heavy step: an email **or** an AI job | when queued | ≤ 5 | ≤ 3 (R2 is not external; Claude: count + call) |
| Hourly cleanup | once an hour | ≤ 6 | 0 |
| **Worst case, everything due** | | **≤ 37** | **≤ 26** |

HTTP requests use ≤ 6 statements each. `email()` uses ≤ 4. The integration tests run the worst-case Cron (every step
due at once) through the counting wrappers. They fail if any invocation passes 50 D1 statements or 50 subrequests.

---

## 3. The Server code, derived values and authentication

### 3.1 Decision: the server gets a one-way Server code, not the pairing code

The pairing secret is the master secret. With it, anyone derives the AES key and the inbox and ack topics and can read
everything any app sends. So the server never gets it unless the user explicitly opts in (below). Instead:

- Each Lab app holding the pairing derives `seed` (3.2) and shows it under **Lab settings › Daylight server ›
  Server code**, with a **Copy** button: `SERVER-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` (28 base32 characters of
  `seed ‖ check`, check = `SHA-256("dlshare/v1/server-code-check" ‖ 0x00 ‖ seed)[0]`). If the pairing uses another
  relay or an ntfy access token, Copy gives the link form `daylightserver://setup?c=<28 chars>&r=<relay>&k=<token>`.
- The user pastes it into the repo secret **`DAYLIGHT_SERVER_CODE`**. It is pasted, not typed, so typos are not an
  issue.
- The deploy validates it with `parseServerCode`, which checks the `SERVER` prefix, the format and the check byte.
  **If the value parses as a pairing code, the deploy fails** with: "That is your pairing code. The server needs the
  Server code instead (Lab settings › Daylight server › Copy). Replace the secret's value." So the master secret is
  never uploaded by accident.

`seed` is SHA-256 of the secret, so the secret cannot be recovered from it. A copy of the Server code (from the
Cloudflare account, the token, the deploy logs, R2 or D1) gives exactly the server's powers. It does not give the
pairing key, so it cannot read what apps send to the Daylight.

Why not a claim flow: a claim flow lets whoever claims an unclaimed Worker first own it. Gating the claim needs a
secret anyway. It also needs the server URL in an app first, copied from an Actions log.

**v1 delivery (explicit opt-in).** The DC-1 Lab Inbox is last in LAB-DECISIONS' build order. Items the server makes
under the Server code reach only a Lab Inbox. To deliver them to a v1 Inbox before then, the user can do both of these:

1. Set the repo **variable** `DAYLIGHT_DELIVERY=v1`.
2. Add the secret **`DAYLIGHT_PAIRING`** (the pairing code).

The deploy then uploads the pairing code too. The config says `"delivery": "v1"`, and every app shows this in Lab
settings: "Your Daylight server holds your pairing code, so whoever controls your Cloudflare or GitHub account can
read everything sent to this Daylight." `DAYLIGHT_PAIRING` without the variable is **not** uploaded, and the deploy
warns. The deploy also refuses if `DAYLIGHT_PAIRING` and `DAYLIGHT_SERVER_CODE` belong to different pairings. With
v1 delivery, `DAYLIGHT_SERVER_CODE` may be left out, because the seed is derived from the pairing code.

**Recommended build order (a decision for the user).** The Lab Inbox's server lane is small: poll one more topic, open
frames with one more key, ack them and say hello (5.5). The iPhone/Mac server features depend on it. It should ship
with the first server release, ahead of the rest of the DC-1 Lab work, so that v1 delivery stays an exception.

### 3.2 Derived values

`‖` is byte concatenation. Labels are ASCII, and every label ends with a `0x00` separator byte. `secret` is the
16-byte pairing secret, and `seed` is 16 bytes.

```
seed          = SHA-256("dlshare/v1/server-seed\0"        ‖ secret)[0:16]              apps only; the Server code
authToken     = hex(SHA-256("dlshare/v1/server-auth\0"    ‖ seed))                     64 hex; Authorization: Bearer
boxKey        = SHA-256("dlshare/v1/server-box\0"         ‖ seed)                      AES-256-GCM key (3 AADs below)
configTopic   = "dls-" + hex(SHA-256("dlshare/v1/server-config-topic\0" ‖ seed))[0:32]
itemTopic     = "dls-" + hex(SHA-256("dlshare/v1/server-item-topic\0"   ‖ seed))[0:32]   Lab delivery (5.1)
ackTopic      = "dls-" + hex(SHA-256("dlshare/v1/server-ack-topic\0"    ‖ seed))[0:32]   Lab delivery (5.4)
emailToken    = lowercase(BASE32(SHA-256("dlshare/v1/server-email\0" ‖ seed ‖ UTF-8(DAYLIGHT_EMAIL_SALT or ""))))[0:10]
fingerprint   = hex(SHA-256("dlshare/v1/server-fingerprint\0" ‖ seed))[0:8]               shown as "3f9a-1c2e"
workerName    = "daylight-" + hex(SHA-256("dlshare/v1/server-worker\0" ‖ seed))[0:12]
serverItemId(origin) = hex(SHA-256("dlshare/v1/server-item-id\0" ‖ seed ‖ 0x00 ‖ UTF-8(origin)))[0:32]
```

| AAD (ASCII) | Used for | Sealed by | Opened by |
|---|---|---|---|
| `dlshare/v1/server-config` | Config frames on `configTopic` (4) | Worker, deploy job | Apps, Lab Inbox |
| `dlshare/v1/server-item` | Server-made item frames on `itemTopic` (Lab delivery) | Worker | Lab Inbox |
| `dlshare/v1/server-ack` | Acks and hellos on `ackTopic` (Lab delivery) | Lab Inbox | Worker |

- Frames under `boxKey` use the protocol's frame layout (`DLS1 ‖ nonce ‖ AES-GCM(len ‖ header ‖ body)`) and the
  protocol's item and ack headers. Only the key and AAD differ. They are sealed and opened with the client module's
  own AES-GCM calls (`sealBox`, `openBox`), never through share/js `sealFrame`/`decryptFrame`. Those map any purpose
  other than `ack` to the inbox AAD, which would silently undo the separation. Negative vectors pin it (13.4).
- In v1 delivery, server-made items use the pairing key and inbox AAD through share/js `encryptFrame(keys, 'inbox', …)`,
  exactly like any sender's.
- `fingerprint` is shown in Lab settings next to the server's host, and in the deploy job summary. It lets the user see
  that the server holds the Server code of the current pairing.
- `serverItemId` makes server-made item ids deterministic per origin (`feed:<feedId>:<entryKey>`,
  `digest:<localDate>`, `email:<mailId>:<n>`, `ai:<jobOrRequestId>`). A step that crashes after publishing and runs
  again produces the same id, and the Inbox's dedupe absorbs it.
- `workerName` makes the Worker's address unguessable and rotates it with the pairing (12.7).
- `DAYLIGHT_EMAIL_SALT` (optional) changes the email address without re-pairing (7.1).

### 3.3 Authentication

Every endpoint except those in 10.3 needs `Authorization: Bearer <authToken>`.

The Worker handles each request in this order, and nothing touches the body before step 6:

1. `OPTIONS` → `204` with the CORS headers (10.2).
2. An unknown route → `404`. The unauthenticated routes (10.3) are answered here; they never read a body.
3. The header must be `Bearer` followed by 64 lowercase hex characters. It is compared with the expected token using
   `crypto.subtle.timingSafeEqual` (equal lengths). A mismatch is `401 BAD_AUTH`.
4. The server is locked (3.4) → `423 LOCKED`.
5. For methods with a body: `Content-Length` must be present (`411 LENGTH_REQUIRED`) and within the endpoint's cap
   (`413 TOO_LARGE`, 10.1). Chunked bodies without a length are refused.
6. The body is read through a byte counter that cancels the stream at the cap.

Failures at steps 2 (only for `/f/` and `/o/`) and 3 call the rate-limiting binding, keyed by `CF-Connecting-IP`.
Over 30 a minute the answer is `429` with no further work. An unauthenticated request therefore costs microseconds of
CPU and never touches the body or D1. An integration test sends a 50 MB body with a bad token and checks the
rejection: no body read, no D1 call.

Why a bearer token and not request signatures: this is a one-user server behind TLS. Signatures would need an 8-line
canonical string implemented four times, nonces (a D1 write per request), clock-skew handling and a list of unsigned
exceptions. They would protect only against replay by someone who can already read the TLS traffic. The token is
derived, never typed, and rotates with the pairing.

### 3.4 Re-pairing, lost devices and the lock

- **Re-pairing.** Before an app replaces a pairing while it knows a server, it sends `POST /v1/admin/lock` with the
  **old** token. This covers a new code scanned after "Reset pairing" on the Daylight. Whether the lock succeeds or
  fails, the re-pair goes ahead. The app then shows: "Copy the new Server code into DAYLIGHT_SERVER_CODE, then re-run
  the deploy."
- **Lock.** The server records `locked = {fingerprint, at}`. From then on every authenticated request gets
  `423 LOCKED`, hosted frames get `410`, and the Cron publishes and fetches nothing (cleanup still runs). A lock is
  lifted only by deploying a different Server code. That deploys a new Worker under a new `workerName` and deletes the
  old one (12.7). A lost phone holding the old token can lock the server, but nothing more, and the owner is
  re-pairing anyway.
- **On the first run with a new fingerprint**, the Worker expires outbox rows, hosted files and AI sources made under
  the old one, because they are sealed for the old pairing. It keeps feeds, the digest time, the block list and
  usage.

---

## 4. Discovery: the config frame

### 4.1 Topic, key and frame

- Topic: `configTopic`, on the pairing's relay (`r=` of the Server code link, else `https://ntfy.sh`). v1 apps never
  read it.
- Frame: `sealBox` with AAD `dlshare/v1/server-config`, body empty. It is always a small frame (a text message).
- Header (stable fields only):

```json
{ "v": 1, "kind": "config", "id": "2b8e…(32 hex, random per publish)", "sent": "2026-10-20T06:00:03.000Z",
  "server": "https://daylight-6c1f0e9a2b44.anjan.workers.dev", "api": 1, "fingerprint": "3f9a1c2e", "delivery": "lab" }
```

| Field | Meaning |
|---|---|
| `server` | Origin of the Worker (`https://`, no path, no trailing slash). The only origin apps send the token to. |
| `api` | Major API version. An app whose minimum is higher shows `server-outdated`, and one whose maximum is lower shows `app-outdated`. Additive changes keep the number. |
| `delivery` | `lab` or `v1` (3.1, 5.1). |

Feature states, the email address, usage and the Lab Inbox's presence are not in the frame. They change often, so
they come from `GET /v1/status` (10.5).

### 4.2 When it is published

- **At deploy**, by the GitHub runner. It has `DAYLIGHT_SERVER_CODE`, and it reaches ntfy.sh from GitHub's
  addresses, not Cloudflare's shared ones.
- **At deploy and every 6 hours**, by the Worker (`POST /v1/admin/announce`, then the Cron run at 00:03, 06:03, 12:03
  and 18:03 UTC). ntfy.sh's 12-hour cache therefore always holds one. The announce call also polls the topic once and
  reports whether the frame is listed. That proves the Worker can reach the relay (12.4).

### 4.3 How apps use it

1. Lab on: on app start, when Lab settings open, and when a server feature is tapped with no config cached, poll
   `GET {relay}/{configTopic}/json?poll=1&since=all`. Read at most 256 KiB and 50 messages. **Ignore every message
   that has an `attachment`**, and never download one. Open each with `openBox` (AAD `server-config`). Keep
   headers with `kind == "config"`, `v == 1`, an `https:` `server` and `sent` at most 5 minutes ahead of local time.
   Take the newest `sent`.
2. **Pin on first sight (TOFU).** The first config's `server` origin is stored. A later config naming a different
   origin is shown for confirmation: "Your Daylight server moved to <host>. Use it?" The app keeps using the pinned
   origin until the user confirms. The pinned host is shown next to the fingerprint in Lab settings.
3. The last config is kept indefinitely and refreshed when older than 6 h. Feature states come from
   `GET /v1/status`, cached for 10 minutes.
4. No config found:
   - The app holds a pinned origin from an **earlier** pairing: show `pairing-mismatch` (the server still has the old
     Server code). No network call is needed to decide this.
   - Otherwise: `needs-server`.
5. **Fallback: Lab settings › Daylight server › "Server address"** (optional). If set, it overrides discovery. The app
   checks `GET {url}/v1/hello`, then `GET /v1/status` with its token. Use it for relays that drop the topic, or to
   debug.
6. The DC-1 Lab Inbox uses the same procedure.

---

## 5. Server-made items: outbox and delivery

Email, feeds, digests and AI results become ordinary items (`url`, `page`, `file`) with the protocol's item header.
They are built once into frames and stored in D1. Each frame is a row of the `frames` table, at most 1 MiB of chunk
(`SERVER_CHUNK` = 1,048,576; ≤ 16 parts, so server items are ≤ 16 MiB encoded). Each item gets an `outbox` row.
Header fields the server sets:

| Field | Value |
|---|---|
| `id` | `serverItemId(origin)` (3.2) |
| `from` | `"Email · <sender name>"`, `"Feed · <feed title>"`, `"Digest"` or `"Claude"` (≤ 60 characters) |
| `app` | `"server/<version>"` |
| `sent` | When the server made the item (email: the message's `Date`, if within the last 7 days and not in the future) |
| `url` | Only URLs that pass `publicUrl` (9.7). Otherwise `https://daylight.invalid/i/<itemId>`, which never resolves, so it can neither leak the server's address nor be fetched. |
| `x-origin` | `"email"`, `"feed"`, `"digest"` or `"ai"` |
| `x-about` | AI results only: `{"url": "<article>", "id": "<original item id>", "sha256": "<document hash>"}` (whichever are known; `url` only if it passes `publicUrl`) |

Server items are always `enc: identity` when over 1 MiB, and `deflate-raw` only for pages up to 1 MiB.

### 5.1 Delivery modes

| | **Lab delivery** (default) | **v1 delivery** (opt-in, 3.1) |
|---|---|---|
| Key and AAD | `boxKey`, `dlshare/v1/server-item` | pairing key, `dlshare/v1/inbox` |
| Topic | `itemTopic` | the pairing's inbox topic |
| Acks read from | `ackTopic` (`boxKey`, `dlshare/v1/server-ack`) | the pairing's ack topic (pairing key, `dlshare/v1/ack`) |
| Who receives | The DC-1 Lab Inbox's server lane (5.5) | Any Inbox |
| Before a Lab Inbox has said hello | Delivering features answer `needs-lab-inbox` (14.1); AI results still go to the app | Not applicable |

Everything else is identical: building, storage, publishing, re-sending and ack handling. One function returns the
mode's `{seal, topic, ackTopic, openAck}`, and the integration tests run every delivery test in both modes.

### 5.2 Publishing

- Each frame is one ntfy message, with the headers `Firebase: no` and `Cache: yes`.
  - **Small frame** (`len(base64(frame)) ≤ 3800`): `POST {relay}/{topic}`, body `base64(frame)`, as PROTOCOL 3.1.
  - **Any larger frame is hosted:** `POST {relay}/{topic}` with the headers
    `Attach: https://<worker>/o/<token>/<i>` and `Filename: dls1.bin`, and body `dls1`. `token` is 32 random hex per
    item, not the item id. ntfy stores a small message whose `attachment.url` is the Worker. Every Inbox downloads
    `attachment.url` from any `https` host (JS, Kotlin and Swift today; v1.1 keeps it, 17). `GET /o/<token>/<i>`
    serves the frame from D1 without authentication. The token is the capability, and the content is ciphertext.
- **The Worker never uploads an attachment to ntfy.** This removes the 2 MiB attachment limit and the 20 MB per-address
  total, which the Worker would share with strangers' Workers behind Cloudflare's egress addresses.
- At most 6 messages per Cron run. Re-send per PROTOCOL 3.3's message rule (every message is small): 11 h after the
  last publish, until acked or 7 days. Then the row is `expired` and its frames are deleted. Frames are also deleted as
  soon as the item is acked.
- Relay answers follow v1.1 3.1. `429`, `5xx` or a network error means try at a later run (1, 2, 4 … 60 min). Any other
  `4xx` makes the row `rejected` and logs the code. The server never sends a frame over 3800 base64 characters as a
  body, so `413` never means "too large".

### 5.3 ntfy budget and token

The server counts its own messages in the `usage` table: **100 messages per UTC day**. Digests use 1, `each`-mode
feed items up to 60, email items, AI deliveries and config frames ≤ 8. Over the budget, frames wait in the outbox. The
phone's and Daylight's own traffic comes from the home address, so the server never eats into it.

ntfy.sh limits by IP address unless the visitor is a user **with a paid tier**. A free registered account is still
limited by IP. So the optional `NTFY_TOKEN` secret helps only with a **paid ntfy.sh tier** or a self-hosted relay that
needs a login. The token is taken from the Server code link's `k`, or from the secret, and sent exactly as v1.1 3.5
says: as the `auth=` query parameter, **only on requests to the relay's origin** (publish, poll), never on any other
URL. `GET /v1/status` reports the last relay status codes.

### 5.4 Acks

Every 30 minutes, while any outbox item awaits an ack, the Cron run polls the mode's ack topic
(`GET {relay}/{topic}/json?poll=1&since=<id of the newest message processed>`). An id ntfy no longer knows returns
everything, which is harmless because acks are idempotent. The poll is hardened against junk, because anyone who
knows a topic name can publish to it:

- Read at most 256 KiB of the answer and process at most 200 messages.
- **Ignore every message that has an `attachment`; never download anything.** Acks are always small frames (v1.1 2.4).
- Stop after 20 frames in a row that do not open.
- Read only `ids` (32-hex strings, ≤ 280 per frame) from frames that open. Matching outbox rows → `delivered`, and
  their frames are deleted.

This is the server's own small poll function. The server does not use share/js `RelayClient.poll`, which downloads
attachments.

### 5.5 The Lab Inbox's server lane, and its presence

The Lab Inbox derives `seed` from its pairing (3.2) and then:

1. Polls `itemTopic` on the same schedule as the inbox topic, with the same v1.1 rules: download rule and limits,
   cursor, dedupe, bounded inflate. Frames are opened with `openBox(…, 'server-item')` and fed to the same
   Reassembler. Items are labelled "From your server" and handed to the Reader like any item.
2. Acks complete items on `ackTopic`, sealed with `sealBox(…, 'server-ack')`, using the protocol's ack header
   (≤ 70 ids, always a small frame).
3. **Says hello**: an ack frame with `ids: []` and `"x-inbox": {"app": "<app/version>"}`. It sends one when Lab is
   turned on, and one with its 11-hourly ack digest.

The server records `inbox.lastSeen` from any valid frame on `ackTopic`. Presence is an explicit event from the
Inbox's own code path. It is never inferred from API calls, and delivery never depends on it: items are published to
`itemTopic` either way. It only decides whether delivering features show `needs-lab-inbox` before the first hello.
Forging a hello or an ack needs `boxKey`, which only the server and paired devices can derive. The worst a forged ack
does is stop re-sends of an item early.

---

## 6. Large files

### 6.1 When

A Lab sender uses the server for a file whose **encoded length exceeds the relay's largest item**
(`relayLimits(pairing).maxEncoded`, v1.1 3.5: 9,000,000 bytes on ntfy.sh). The file state must be `ready` (server
found, R2 on). The maximum is **`HOSTED_MAX` = 16 × `CHUNK_MAX`** = 201,326,592 bytes (192 MiB) encoded, within v1.1's
256 MiB decoded cap. Pages never need it: they are at most 8 MiB, and deflated well under 9 MB.

### 6.2 Frames: ordinary v1 frames

The sender builds the item's frames with the **pairing key** and AAD `dlshare/v1/inbox`. The frames are exactly what a
v1 receiver expects:

- Header fields as `buildItemFrames` builds them: `id`, `kind: "file"`, `name`, `mime`, `size`, `sha256`, `part`,
  `parts`, `sent`, `from`, `app`, optional `url` and `title`.
- **`enc: identity` always.** Large files are PDFs, EPUBs and media that do not compress.
- **`HOSTED_CHUNK` = `CHUNK_MAX`** = 12,582,912 bytes, ≤ 16 parts. The largest frame is 12,582,912 + 8,192 + 36 =
  12,591,140 bytes. That is within every receiver's download cap: Kotlin v1.0 and v1.1 accept 12,713,984 bytes, and
  Swift v1.0 accepts 16 MiB.

share/js `buildItemFrames` refuses content over the relay's largest item, so the client module builds these frames
itself (`buildHostedFrames`) with share/js `encryptFrame(keys, 'inbox', …)`, `sha256` and `safeFileName`.
`checkItemHeader` in v1.0 and v1.1 accepts them as they are.

### 6.3 Upload, announce, re-send, delete (sender)

1. Pick `fileId` = 32 random hex. It is not the item id, so the URL reveals nothing about the item.
2. `PUT /v1/files/{fileId}/{i}?n=<parts>` for each frame: the raw frame, `Content-Type: application/octet-stream`, and
   `Content-Length` ≤ 12,713,984. Each PUT is independent and idempotent, and any order or parallelism works. The
   Worker streams `request.body` into R2 `f/<fileId>/<i>` with a known length and records the part in D1. The iPhone
   uses background `URLSession` uploads of N files. `GET /v1/files/{fileId}` lists the stored parts, so an interrupted
   upload resumes.
3. When all N parts are stored, the sender itself publishes one small message per part on the **inbox topic**:
   `POST {relay}/{inboxTopic}` with `Attach: https://<worker>/f/<fileId>/<i>`, `Filename: dls1.bin`, `Firebase: no`
   and `Cache: yes`, body `dls1`. The server never learns the inbox topic and never publishes these.
4. The sender keeps a small **hosted outbox** row: `{itemId, fileId, parts, urls, sent, lastPublish, status}`.
   - It re-publishes the N small messages per PROTOCOL 3.3's message rule (11 h) until acked or 7 days. Nothing is
     re-uploaded while the server still has the parts.
   - It reads acks from the pairing's ack topic with the protocol module's v1.1 ack reader.
   - On `delivered`, it sends `DELETE /v1/files/{fileId}`.
   - If `GET /v1/files/{fileId}` answers `404`/`410` and the sender still has the content, it uploads again.
5. The Daylight's Inbox, v1 or Lab, polls the inbox topic. It sees messages whose `attachment.url` is the Worker,
   downloads each frame with a plain `GET` (`/f/` needs no authentication), and reassembles, verifies and acks the item
   as it would any item. The Kotlin Inbox spools parts to disk and inflates with a bound, so 192 MiB is fine on the
   DC-1.

### 6.4 Why this works with today's Inbox, and what to verify

- Every receiver already treats `attachment.url` as "download the frame from here", from any `https` host. JS v1.0
  reads it with no cap, Kotlin with `CHUNK + 128 KiB`, Swift with 16 MiB, and v1.1 with `https` or the relay origin
  and 12,713,984 bytes.
- Hosted frames are not stored on ntfy, so ntfy.sh's 2 MB per attachment, 20 MB per sender and 3 h expiry do not
  apply. The attachment-bandwidth count is not touched either, because the bytes come from the Worker. Each part is
  one message out of 250 a day.
- **To verify on the first CI run** (informational job `live-ntfy-attach`, on the GitHub runner, which can reach
  ntfy.sh), with a stand-in https URL:
  - a message published with `Attach:` lists `attachment.url` equal to that URL;
  - it is kept as a message for 12 h;
  - it is not refused for size.

  The ntfy docs say external attachments are not subject to the attachment limits. If ntfy.sh behaved otherwise, the
  feature state would stay `needs-…`. The fallback would be the Lab Inbox's server lane, which is not needed today.

### 6.5 Retention, storage cap, serving

- Parts live **14 days** after the first PUT. The sender gives up after 7. R2 lifecycle `dls-files` deletes `f/`
  after 14 days regardless, and `DELETE /v1/files/{id}` deletes at once.
- Storage cap: the sum of live hosted bytes ≤ **8 GiB** (R2 free is 10 GB-month), else `507 STORAGE_FULL`.
- `GET /f/<fileId>/<i>` streams the R2 object with `Content-Length` and `application/octet-stream`. It answers `404`
  for an unknown id (counted as a failure for rate limiting, 3.3) and `410` after expiry or a lock. Range requests are
  not supported: no receiver uses them.

### 6.6 What the server can and cannot see

The server sees: the file's frame count and sizes, upload and download times and IP addresses, and how long the file
waited. It cannot see the name, type or content. Those are inside frames encrypted with the pairing key, which it
never has under Lab delivery. The relay additionally sees the Worker's hostname and the `fileId` in the `Attach:`
URLs. Anyone who learns those URLs can download the ciphertext, exactly as with any ntfy attachment today. Under v1
delivery the server holds the pairing code and *could* decrypt these files. The apps say so (14.3).

### 6.7 Without R2 or without a server

Without R2, the files state is `needs-r2` (14.1). Without a server, a file over the relay's largest item shows
`needs-server`. Either way the protocol's own message applies too ("That file is larger than 9 MB, the most your
Daylight's relay can carry."), with the server message appended.

