# Daylight Share protocol

How the "Send to Daylight" apps get links, pages and files to a Daylight through an ntfy relay, end-to-end encrypted.

| Path | What it is |
|---|---|
| `PROTOCOL.md` | The spec: version 1, revision 1.1 |
| `CHANGES-v1.1.md` | Why revision 1.1 changed what it did, finding by finding |
| `NTFY-FACTS.md` | What ntfy.sh measurably does where the protocol depends on it |
| `js/daylight-share.js` | The JavaScript reference implementation (one module, no dependencies); the extension and the web sender ship a copy |
| `js/mock-relay.mjs` | A stand-in for ntfy with ntfy.sh's limits, for tests and demos (`node js/mock-relay.mjs --help`) |
| `js/live-ntfy.mjs` | A live round trip through ntfy.sh, run by CI |
| `vectors/test-vectors.json` | The vectors every implementation must pass, made by `vectors/generate.mjs` |
| `LAB-PROTOCOL.md` | **Lab** (normative): hello and item-state frames on the ack topic, header extras, the return and control lanes, the timeline text, the gate, vectors and CI. Section 2 of `../LAB-PLAN.md`, kept here from L0 on |
| `js/daylight-lab.js` | The Lab reference (one module; it imports only `daylight-share.js`): parser, ledger, timeline text, `LAB_TEXT`, `labGate`, `LabInbox` |
| `vectors/lab-vectors.json` | The Lab vectors every port must pass, made by `vectors/generate-lab.mjs` (deterministic: CI requires no diff) |
| `js/test/fixtures/` | The v1.0 (b48752b) and v1.1 (bb8ccfa) references as they shipped: the old peers of the skew suite. Never edited. `articles/` holds F10.1's pages (its README says where each comes from) |
| `vectors/normalise.json` | Smart intake (F16): `normaliseShare` cases, the `x-orig` frame rule and Apple News pages, also made by `vectors/generate-lab.mjs` |
| `js/capture/` | The one source of the capture code every sender copies: `clean-html.js`, Mozilla Readability 0.6.0 and `sync.mjs` (its README) |
| `js/bin/daylight-send.mjs` | The command line (F09); `js/bin/build.mjs` makes the one file CI publishes to the release. `SEND-API.md` is its manual and the list of every entry point |

```sh
npm ci                           # linkedom, the DOM of the capture tests (nothing else needs it)
node --test js/test/*.test.mjs   # unit, mock-relay, Lab, skew and soak tests (the soak takes about 40 s)
node vectors/generate.mjs        # regenerate the vectors after changing the library
node vectors/generate-lab.mjs    # regenerate the Lab vectors (lab-vectors.json, normalise.json) after changing daylight-lab.js
node js/bin/build.mjs            # dist/daylight-send.mjs, the one-file command line
node js/live-ntfy.mjs            # needs network access to ntfy.sh
```

## Lab (L0)

The Lab additions are wire-neutral: `v` stays 1, a Lab frame is an ack frame whose `ids` is `[]`, and v1.0 and v1.1
peers ignore it (the skew suite runs the shipped v1.0 and v1.1 modules against Lab peers). `LAB-PROTOCOL.md` is the
spec; `test-vectors.json` did not change.

**`daylight-share.js` (2.7.1), backward compatible:**

- `aadFor(purpose)` is an explicit map (`inbox`, `ack`, `lab-return`, `lab-return-ack`, `lab-control`,
  `lab-control-ack`); `sealFrame`, `encryptFrame` and `decryptFrame` throw `ShareError('purpose')` for any other
  purpose instead of falling back to the inbox AAD. New constants `PURPOSE_LAB_*`, `LAB_STORAGE_KEYS`, `X_CAP_VALUES`.
- `checkItemHeader(h)` adds `extras` (`itemHeaderExtras`: `x-cap` when it is `seen`, `clean`, `excerpt` or `test`;
  `x-orig` when it passes `webUrl`, trimmed; part 0 only). `Reassembler.add` returns `{header, content, msgIds,
  extras}` with `extras` moved out of `header`; `Receiver` passes `extras` to `accept()` and in `items`.
- `new Sender({…, onAckHeader})`: `onAckHeader(header, {time, msgId})` for every decrypted ack-topic frame of kind
  `ack`, in poll order, before rows change; `time` is the relay time in **seconds**; errors are caught and logged.
- `send(item, {defer: true})` stores the row as `failed`/`network` with `attempts` 0 and publishes nothing.
  `flushNetwork({maxFrames = 30, maxAttachmentBytes = 18_000_000})` sends those rows oldest first with
  `resendDue`'s pass rules (F07).
- `applyPairingChange` also removes `LAB_STORAGE_KEYS` (and any other `lab/` key when the storage has `keys()`) when
  the secret changes.
- `Receiver.pollOnce()` also returns `limited`: 429 or 413 when the relay refused the poll's ack publish for its
  limits, else 429 when it answered an attachment download with 429 (that item waits for a later poll), else 0. A
  Lab Inbox gives way for an hour after any of them (2.2.4). `RelayClient.poll` entries whose attachment was
  requested carry the download's `status`.

**`daylight-lab.js` (2.7.2, W0 list):** `buildInboxInfo`, `buildLabFrame`, `parseLabAck` (2.2.5 exactly),
`LabLedger` (per publisher; `snapshot()` reads it all at once) and `labHook`, `describeLabRow`, `labRowA11yLabel`,
`wantsFastChecks`, `checkedInText`, `inboxLabText`, `LAB_TEXT`, `needsMessage`, `labGate`, `deriveLabTopics`,
`LabInbox` and `LabInboxSim`; for the Daylight server's row and section (1.1, 1.4, 2.6) `serverHeadingShort`,
`serverRowSubtitle`, `serverFeatureShort`, `serverMovedText`, `labInboxSeenText`, `aiTodayText`, `setupConfirmText`, `hostLineText` and `formatUsd`. The extension, web and Windows builds copy it next to `daylight-share.js`; every export is
a single `export const|function|class`, which their classic bundle needs (a test checks it).

**Choices the reference made where LAB-PROTOCOL leaves room** (the vectors pin them; ports follow):

- `LabLedger.record(header, {time})` takes the relay time in seconds and stores ms; it ignores a header whose `kind`
  is not `ack` (`heard` included). It keeps at most 1,000 states between `prune()` calls (the lowest `t` go first);
  `prune(ids)` keeps 200. `caps()` is sorted.
- `describeLabRow`: rule 5 needs `inboxLab` and `hasCap('st')` (F17); `ctx.hasCap` may be a function or a token list
  (absent: `inboxLab` alone decides). Rows of rules 1 and 4 have `final: false`, so their sentence shows as in v1.1.
  "Waiting for connection" has no button. `ctx.state` may be `{s, t}` or a bare token.
- `labGate` returns `{ready, state, message, short, button}`. With Lab off: `state: 'lab-off'` and "Turn on Lab in
  {app} to use this.". Only F01 needs an Inbox capability (`st`). A feature may be named by its id or by a server key
  (`labGate('files')`). An unknown server state is `error`. When the 5 s deadline decides `OFFLINE`, the message comes
  from `ctx.serverMessage` (pass the server module's `localMessage`); `daylight-lab.js` never imports the server module.
- `needsMessage`: the server's states take the server module's text (`message`); `needs-notifications` on a platform
  without a settings path (Chrome, Safari, web) is the first sentence alone.
- The server's row and section: `LAB_TEXT.serverSection` holds 2.6's own lines (the move sheet, "Lab Inbox last seen
  {rel}" and its not-yet line, "AI today: US${used} of US${cap}", the labels Server code, Copy and Server
  address, and the **Set up with a link** row's ten `setup…` strings: row, footer, placeholder, button, confirmation
  title, body, confirm and cancel buttons, working and done lines), and since Oct 22 the rest of 2.6's copy: the steps
  (`stepsHeading` "Turn it on", `steps`, a list of five strings shown numbered and only while the state is
  `needs-server`, whose second is the server module's `RERUN_HELP` word for word, and `stepsMore`), `hostLabel` and
  `hostLine`, `deliveryLabel`, `deliveryLab` and `deliveryV1`, and the address field's `addressPlaceholder`,
  `addressSave` and `addressFooter`. `hostLineText(host, fingerprint)` fills `hostLine` "{host} · {fingerprint}":
  `{host}` as `serverMovedText` makes it, the fingerprint as given (pass `showFingerprint(values.fingerprint)`), and
  when one side is empty the line is the other alone. In lab-vectors.json, `serverSection.steps` is the five steps as
  an array of five strings: ports pin their list against that array, never by splitting `strings`, which holds them
  joined with "," as every list (four steps have commas of their own; every other list's items are comma-free, and the
  generator fails on a new list item with a comma). `serverSection.hostLine` pins `hostLineText`; a test
  reads the ids and texts from LAB-PLAN 2.6's table. The row's `{short}` is the heading form (`serverRowSubtitle('needs-server')` is "Optional · Not set up");
  an unknown server state reads as `error`. A server feature's row shows its short state only when its state differs
  from the heading's (`serverFeatureShort`). `{host}` is the new origin minus its scheme and path, as text.
  `setupConfirmText(server)` fills the setup link's confirmation the same way; `server` is a string, the server
  module's `parseSetupLink(link).server` (ports pass their own parse result's server), never the parse result itself.
  `inbox.lastSeen` is read by rule D. Dollar amounts round n × 100 half up in double precision and drop ".00"
  (never printf or `toFixed`).
- `LabInbox` (storage key `lab/out`): one frame per `flush()`; the order is the `lab: 0` frame, digest frames, states,
  then a due hello. The 30 s spacing and giving way apply to every Lab frame; the daily cap counts hellos and state
  frames only. `record()` beats both the pending and the last published entry for the id, and does nothing while Lab
  is off; turning Lab off drops pending states. `buildLabFrame` writes `lab` 0-99 (99 for the worst-case vector).
- `flushNetwork`: a pass always takes its first row, so a row over the caps cannot block the queue; rows older than
  7 days are left to `resendDue`.

**Test hooks.** `startMockRelay({...NTFY_SH_LIMITS})` (or `--ntfy-limits`) turns on ntfy.sh's per-visitor request,
message and bandwidth buckets; `state.publishLog` and `state.limited` record what passed and what got a 429.
`LabInboxSim` is a Lab Daylight for tests (`reader` for links and pages, `handed` for files unless `stateFor` says
otherwise). The soak (`lab-skew.test.mjs`) prints its daily message counts; CI copies them to the run summary.

## Lab (L1)

W1's JavaScript reference (LAB-PROTOCOL 2.9, normative for A3 and K3). Still wire-neutral: `test-vectors.json` did not
change, and an item sent without Lab extras is byte for byte v1.1's.

**`daylight-share.js`, backward compatible:** `buildItemFrames` and `Sender.send` take `item.extras`
(`labHeaderFields`: `x-cap` of the four values, `x-orig` that passes `webUrl` and is at most `X_ORIG_MAX` = 1,024
characters). They ride on part 0 only, `x-orig` is left out when it alone would make a small frame large, and
`built.extras` says what went. The row keeps them (`row.extras`, only when there are any), so re-sends write the same
fields (LAB-PLAN 1.3: queued items go out as stored).

**`daylight-lab.js` (W1 list):** `normaliseShare`, `classifyShare`, `cleanShareUrl`, `findShareUrl`, `shareTitle`,
`hasTextFragment`, `withoutTextFragment`, `textFragmentText`, `isAppleNewsUrl`, `extractAppleNewsTarget` (F16, F11);
`excerptItem`, `excerptHtml`, `excerptMarkdown`, `excerptTextHtml`, `sanitizeExcerptHtml`, `excerptFileName`,
`excerptFirstLine`, `excerptTitle`, `excerptDate`, `textFragment` (F11); `testArticle`, `redactDiagnostics`,
`activityEvent`, `appendActivity`, `activityLine`, `diagnosticsReport` (F26); `inboxKindLine`, `cleanedFromText` (F03,
2.3); `USE_FEATURES`, `labUseOn` (6.5 Q5); `fillText`; and the W1 strings in `LAB_TEXT` (185 new ids: the Use switches
and their footers, F01's toolbar badge and Windows toast, share in place, the queue, automation and the command line, Send as, excerpts, arrival notices and
Inbox health, Setup check with its checks and steps, the test article, diagnostics, the copied link and the
right-click menu).

**Choices L1 made where the plan leaves room** (the vectors pin them):

- **6.5 Q1 = (b):** `classifyShare` has no word-count rule and no text-fragment rule. An excerpt needs
  `source: 'selection'` (the context menu, Selection mode, a Safari selection, "Send as excerpt"). A URL with
  `#:~:text=` alone stays a link with its title (Google adds fragments to result links); with "Send as excerpt",
  Chrome on Android's shared selection (`"quote"` + URL with a fragment) loses its quotes, and a bare fragment URL
  gives the fragment's text. Text with no URL at all is a note (there is nothing else to send; plan rule 3, still to
  be confirmed with the user under (b)). Everything else, however long, is a link with the text as its title. A
  selection given with its page URL (a Safari selection, "Send as excerpt") keeps the links it holds: only the page
  URL itself is taken out of its text (fixed after review: "Visit https://a.example/x" lost its link).
- **6.5 Q5 = yes:** Use switches on F03 (the link-only hint), F04, F08, F10, F16 and F33. Footers start "When it’s off,
  …". Store keys next to `lab`: `dls.labUse.<id>`, `labUse.<id>`, `settings.labUse[<id>]`; a missing key is on.
  LAB-PROTOCOL 2.9.6 lists what each switch gates: F03's only the hint (the capture stays clean, and its footer says
  so), F16's the URL cleaning (`normaliseShare({…, clean: false})`).
- `normaliseShare` also returns `kind` (`link`, `excerpt`, `note`, `none`), and `orig` is null over 1,024 characters
  (it would never be sent). Unwrapping runs at most 5 steps; LinkedIn's bare `linkedin.com` counts too. Titles lose the
  empty `()` `[]` `""` … a removed URL leaves, and a stray `. , ; ! ?` at their edges.
- Excerpts: block tags (`div`, `section`, …, `tr`) become paragraphs so their text does not run together; `script`,
  `style`, `svg`, `button` and the like go with their content; stray closing tags (`</blockquote>`) are dropped, so a
  selection can never close the excerpt's own elements. The 50,000-character limit counts the text of the sanitised
  HTML (a character reference is one). The date reads "22 October 2026"; a note's footer is "— shared from {app} on
  {date}". Notes carry `x-cap: excerpt` too.
- The test article is about 375 words in six paragraphs (`LAB_TEXT.testArticle`), so ports produce it byte for byte.
- `redactDiagnostics` also redacts any `scheme://…` (pairing links included) and `www.…`; `SERVER-` is matched
  case-sensitively so state names such as `server-outdated` stay readable.
- `clean-html.js` did not exist in `extension/src/` when L1 started, so it was written from F03's rules; it also
  clears `javascript:` from `<area>` and works on a clone when handed the live element. The extension removes its own
  copy in X1. After review it also removes `<template>` elements (their content is out of `querySelectorAll`'s reach
  but `outerHTML` writes it out, so a dialog's CSRF input went along), cleans a `<noscript>`'s markup (one text node
  with scripting on, which `outerHTML` writes as it is), and clears an SVG link's `javascript:` `xlink:href`; checked
  in Chromium as well as linkedom.

**Command line (F09).** `daylight-send` (manual: `SEND-API.md`). The outbox is a `FileStorage` (one JSON file per key,
atomic rename) under a `FileLock` (`O_EXCL` lock file, touched every 10 s, stale after 60 s), one outbox per pairing.
Every run does `tick()` first. Two runs at once lose no rows; `cli.test.mjs` runs eight at once, three times, with one
of them in `--wait` (without the lock the same run loses one or two rows of eight). The command line is always Lab:
smart intake, `x-orig`, and a Lab ledger fed from the ack topic. `--wait-for reader` ends on `reader`, `queued` or
`handed` (documents).

## Lab (W1 review follow-ups, Oct 22)

**Copy added Oct 22** (LAB-PLAN 1.6's table). `LAB_TEXT.setup.steps.toolbarButton` (Chrome's Toolbar button check) and
`setup.steps.readerReadLater` (the Inbox's read-later check, next to `setup.readerTest`), `arrivals.quietHoursFooter`,
`arrivals.excerptOne` (one waiting excerpt; several use `excerptsGroup`), and `handover.*`, the five things LAB-PLAN
5.3.4 puts on screen, word for word: `letReceive` (the Settings › Lab row that arms the 2-minute grant), `armed` (the
line while it is armed), `receivingElsewhere` (the handover line), `receiveHereAgain` (its button) and `unreachable`
(the line while the Lab Reader can't be asked). `lab.test.mjs` reads the plan's table and 5.3.4 and pins every id and
text against them; `generate-lab.mjs` pins them in `labText.strings`. The Android and Apple `LabStrings` files were
regenerated with them (`lab-strings.mjs`, no generator change).

**An outbox row's `http`** (F26's activity log; WIN1 review). `daylight-share.js` rows carry `http`: the HTTP status
of the row's last failed publish (413, 429, another 4xx, or 408 and 5xx after the in-call retries), 0 when that failure
had no HTTP answer, and 0 again once a publish goes or the row is delivered. So `send`, `retry`, `resendDue` and
`flushNetwork` return it on their rows. Rows stored without it (v1.0, v1.1) read as 0, and v1.1 reads the new rows
unchanged. Apps log a row's event as `activityEvent({type, id, kind, status, http: row.http})`; until they pass it,
the log's last column stays "-". `lab-vectors.json` › `diagnostics.rowHttp` pins 15 sequences (each failure kind,
the in-call retries, Retry now, a later failure, and both passes' 429 and 413 rules) with their activity lines.

**F10.1's automated check** (`js/test/readability.test.mjs`). Clean article as its callers run it (below:
`prepareForReadability` and Readability 0.6.0 on a clone, then `cleanHtml` on its article) on 20 of Readability's own
test pages and ten news-style pages written for the test (`js/test/fixtures/articles/`). Words are counted with
repeats. On every Readability page it keeps 100% of the expected body and adds nothing. All ten news pages keep 100%
of their body with the navigation, header, footer, asides, forms, comments and cookie notice gone. An advertisement
placed inside the article's own text keeps its text (`lumen-leaf-ereader`).

**Summary boxes (F10.1, Oct 23).** Readability alone kept 87% of `storm-warning-live`: it scores paragraphs, never
list items, so it dropped the live page's "Key points" box (a heading and a list beside the entries). Readability.js
stays pinned and unpatched; `clean-html.js` now has `prepareForReadability(clone)`, a step its callers run on the
clone before Readability. It moves each summary box inside the article (key points, summaries, highlights, takeaways,
"at a glance" lists, named so by class, id, aria-label or heading, and holding a list) into the element that holds the
article's paragraphs, at its start when the box comes before it and at its end when after, and makes an `<aside>` box
a `<div>`. It moves a box only when no paragraph of the article lies between the box and that element, so the reading
order stays the page's: with article text between them the box stays where it is (an `<aside>` one made a `<div>` in
place), and Readability keeps or drops it as it would alone. A box that holds the article's paragraphs itself is the
article's text and stays as it is. It leaves alone what is not the article: anything in or named as navigation,
related links, a newsletter, an advertisement or other furniture, a box with such an element or name inside it (an
"Advertisement" label), a box that is mostly links or whose items are links or teasers, a box with a form, an iframe
or media, and anything inside a box it turned down (so the list in a newsletter box does not come in on its own, named
by the box's heading). Its comment in `clean-html.js` has every rule. With it, `storm-warning-live` keeps 100% (Key
points first, as on the page). It moves nothing on the 20 Readability pages or the other nine news pages (their
articles are byte for byte Readability's), nor on any of the 128 pages of Readability 0.6.0's test suite (measured
with linkedom, again after the review round below). Four more fixtures (`fixtures/articles/decoys/`) hold boxes named
or titled like summaries that are navigation, related links, a newsletter, an advertisement, a weather box, other news
and teasers for other stories: each stays out, the test shows each would be kept if it were a plain summary box, and
variants of them with one marker left (the newsletter's form alone, an iframe in its place, the advertisement's label
alone...) stay out too. Each rule that keeps a box out, and each tag, role, form control and kind of media the rules
name, also has a small page with and without it, so no rule goes untested. Review round (Oct 23): a list in a box
turned down for its form or its links was rescued as a bare list under the box's heading, and an "Advertisement" label
inside a box was not looked at; both are fixed. Review round 2 (Oct 23): a box that came before the element holding
the article's paragraphs went to that element's start even with other article text between them, and a box's own
paragraphs were left out when finding that element, so pages Readability alone keeps in order came out of order (an
explainer's In brief, Background, Details as Background, In brief, Details; a report's Summary, Methods, Results as
Methods, Summary, Results). Both are fixed, and tests pin those two pages, a box after the text with notes between,
and that headings, short paragraphs, furniture and other boxes between a box and the text do not hold it back. One
layout stays Readability's: "Key points", then an introduction of paragraphs, then the body. The box stays where it is
and Readability drops it, as it would without the step (moved to the body, it would come after the introduction).

**Clean article's call order (F10).** The extension's `captureArticle` (`extension/src/inject.js`) and
`apple/Shared/ShareExtension/GetPage.js` are to run, in the page, on one clone:

```js
var clone = document.cloneNode(true);
prepareForReadability(clone);                    // clean-html.js: summary boxes into the article's text
var article = new Readability(clone).parse();    // Readability.js 0.6.0, unmodified
var doc = document.implementation.createHTMLDocument('');
doc.body.innerHTML = article.content;
var content = cleanHtml(doc.body);               // then drop its '<!doctype html>\n<body>' and '</body>'
```

`prepareForReadability` must run on the clone Readability then parses, and before `new Readability(...)`; given the
live `document` it returns 0 and changes nothing. It is in `clean-html.js`. The extension already copies that file
(its build copies it from here, and `ARTICLE_FILES` injects it with Readability), so it has the function; its
`captureArticle` does not call it yet. `GetPage.js` has no copy yet: today it returns v1.1's `html`, `title` and `url`
only, and LAB-PLAN F03 and F10 have it inline `clean-html.js` between `// BEGIN clean-html` and `// END clean-html`
(and Readability between its own markers), which `sync.mjs --check` then holds to this file. Each consumer lane adds
the one call (6.3): until then its Clean article is Readability's alone, and a live page's Key points go.

### Still to check on a device

- Chrome's Setup check: the `setup.steps.toolbarButton` wording ("puzzle piece", "pin") against the toolbar of the
  Chrome release on the W1 device round.
- DC-1 Inbox Setup check: the Reader's own name for its setting in `setup.steps.readerReadLater` ("allow pages from
  other apps"), on the W1 device round (LAB-PLAN 1.6 says so).
- F10.1 on real pages: Clean article in Chrome and Safari (and from Safari on an iPhone) on a live news page with a
  "Key points" or summary box, once the extension and `GetPage.js` call `prepareForReadability`: the box is in the
  article, where it was on the page, and the page's related links, newsletter sign-up and ads are not.

## Changelog

### 1.1 (revision 1.1 of protocol version 1)

No byte on the wire changes: v1.0 and v1.1 senders and receivers work with each other. What changed:

- **Sizes for ntfy.sh's real limits** (2 MB per attachment, 20 MB per sender): chunks of 1,900,544 bytes, items of at
  most 9,000,000 bytes before compression ("Files can be up to 9 MB"), so every frame is at most 1,966,116 bytes.
  Receivers still accept v1.0's 12 MiB chunks.
- **Relay answers are classified**: `network` (retried with backoff), `full` (413) and `refused` (other 4xx), both
  retried after 185 minutes and given up after the third in a row. A re-send pass stops after a 429 and sends no
  attachment after a 413. Attachment items are re-sent at 185 minutes twice, then every 12 hours.
- **Receiving is robust**: download outcomes (expired, junk, retry), a 30-minute cursor overlap, a cursor held at
  incomplete items and failed downloads, the item stored before it is remembered or acked, acks of at most 70 ids
  (always a message), a 12,713,984-byte download cap, a bounded inflate, a 64 MiB poll cap.
- **One rule each**, pinned by vectors, for web URLs, relay URLs and safe file names (now also capped at 200 UTF-8
  bytes), and one status vocabulary for every app (`describeRow`).
- **Pairing by link asks first**; the same secret keeps the outbox, a different one deletes it.
- **The mock relay behaves like ntfy.sh** by default and has test hooks; the vectors gained `relays`, `sizing`,
  `urls`, `invalidItems`, `fileNamesUtf16`, `acks`, `statusText`, `formatMB` and `pairingConfirmation`.
- **After review** (no wire change): the relay rule refuses whitespace or control characters inside, a host that does
  not start with a letter or digit, and an IPv6 zone id, and compares the default port as text (`:0443` stays); the
  library names a relay by `relayHost()` (host and port, as text) and has `applyPairingChange()` for the outbox rule;
  `attemptStarted` is saved after every accepted frame, the last included; the mock's per-file limit defaults to
  the 2,000,000 bytes PROTOCOL 3.5 promises; the live check counts only accepted frames; 29 more tests pin the
  cursor holds, caps, answer mapping, counters, retry rules, pass breakers and locks.

#### Notes for ports (Kotlin, Swift, the extension and the web sender)

- **Copy.** Every user-facing sentence uses ’ (U+2019), "…", "·" and "✓", including the ones no vector pins (the
  Inbox sentences, the relay check's sentences, the share-time messages). The record's tables use ASCII for
  legibility (CHANGES-v1.1 2.5).
- **Vectors.** `formatMB` is its own top-level group (not inside `statusText`). `sizing` also carries `maxHeader`.
  `statusText` has 14 cases: the 12 rows of 2.5 plus a `failed` and an `expired` row saved by v1.0, which have no
  `errorCode` (read it as `''`; the failed one shows "Retry now"). `pairingConfirmation` (11 cases) pins what an app
  does with an incoming pairing: its `relay` inputs are raw (normalise them first), a relay is named by the
  normalised relay's host and port as text (`relay.example.org:8443`, `[::1]:8080`; Kotlin's `URI.host` and Swift's
  `URL.host` drop the port, so do not use them), secrets are compared on all 16 bytes, and the copy is "Sends
  through <host>.", "Pair with <name or 'a Daylight'>?" and "This replaces <name or 'your current Daylight'>. …".
  The web sender's `confirm()` (CHANGES-v1.1 6.4) is "Pair this page with <name>?" followed by the same `lines`.
- **Relays.** The `relays` vectors pin the edge cases a URL parser would decide differently (see their note).
- **Mock relay.** Defaults: 2,000,000 bytes per attachment, 20,000,000 per visitor; pass `--attachment-max 2097152`
  to mirror ntfy.sh exactly. `since=<message id>` is kept from the v1.0 mock and now answers an unknown id with
  everything, as ntfy.sh does; no client uses id cursors.
- **Pairing change.** `applyPairingChange(storage, current, next)` is the outbox rule of PROTOCOL 3.3 step 6 under
  the sender lock: the same secret keeps the outbox, another secret (or none before) deletes `outbox`, every
  `outbox/<id>` and `ackSince`.

#### JS API changes from 1.0 (`js/daylight-share.js`)

- Constants: `CHUNK` 12,582,912 → 1,900,544; `MAX_ACK_IDS` 200 → 70. Removed `MAX_ENCODED`, `RESEND_ATTACHMENT_MS`.
  Added `MAX_ITEM`, `MAX_DECODED`, `MAX_HEADER`, `MAX_ATTACHMENT`, `MAX_POLL_RESPONSE`, `CURSOR_OVERLAP_S`,
  `ATTACHMENT_WAIT_MS`, `RESEND_FAST_WINDOW_MS`, `RESEND_SLOW_MS`, `SLOW_FAIL_LIMIT`, `SENDING_STALE_MS`,
  `CONTENT_KEEP_MS`, `OUTBOX_MAX_ROWS`, `SEEN_MSG_TTL_MS`, `INCOMPLETE_TTL_MS`, `TIMEOUT_SHORT_MS`, `TIMEOUT_LONG_MS`.
- `ShareError(code, message, reason, status = 0)` gains `.status`. Publish errors are `network` (no answer, with
  `status` 0, or 408, 429 or 5xx), `full` (413) or `refused` (any other 4xx), no longer `too-large`/`relay`.
- New: `formatMB`, `tooBigMessage`, `samePairingSecret`, `pairingConfirmation`, `relayHost`, `applyPairingChange`,
  `describeRow`.
- Changed: `normalizeRelay` (textual rule; errors instead of guessing), `webUrl` (textual rule, no `new URL()`),
  `safeFileName` (200 UTF-8 bytes, leading dots, extension rule), `inflateRaw(bytes, limit)` (bounded; throws
  `integrity`), `encryptFrame` (throws `header` over 65,536 bytes), `buildItemFrames` (`too-large` over `MAX_ITEM`
  before compression; `MAX_ENCODED` check gone), `buildAckFrame` (70 ids), `checkItemHeader` (page/file `size` caps).
- `Reassembler({now})`: `add(header, body, {time, msgId})` returns `{header, content, msgIds}`; new `isPending`,
  `drop`, `prune`; integrity errors carry `msgIds`.
- `RelayClient({relay, fetch, timeouts: {short, long}, retryDelaysMs})`: `publish` follows the 3.1 table (no in-call
  retry for 429); `poll` returns `{id, time, attachment, outcome, frame}` with `outcome` `frame`, `skipped`,
  `expired`, `junk` or `retry`, applies the download rule and caps, and throws `network` or `relay`.
- `Sender({…, timeouts, retryDelaysMs})`: rows gain `errorCode`, `slowFails`, `attemptStarted` (`list()` fills them
  in for v1.0 rows); `send` refuses over 9 MB without storing anything and publishes once even when the content copy
  fails; `retry(id)` re-sends `failed` rows, restarts `expired` ones with code `''`/`full`/`refused`, and returns any
  other row unchanged; `resendDue()` returns the rows it attempted; new `remove(id)`; every method takes a lock shared
  by all Senders on the same storage object.
- `Receiver({…, accept, timeouts, retryDelaysMs})`: `pollOnce()` returns `{items, acked, ackError, storeError}`,
  never throws because of acks, and keeps `incomplete` in storage.
- Mock relay: `startMockRelay` gains `visitorAttachmentTotalBytes`, `attachments`, `early413`, `control`,
  `failDownload`, `failPublish`; `state` gains `visitors`, `downloadsById`; `attachmentMaxBytes` defaults to
  2,000,000 (was 15 MiB).

### 1.0

The first version.
