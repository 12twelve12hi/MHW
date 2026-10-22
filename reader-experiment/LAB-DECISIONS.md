# Lab version: decisions from the user

The rules every Lab build follows. Each line is the user's decision (Oct 20, 2026) or a rule that comes straight from one.

## The Lab toggle

- Every companion app (iPhone, Mac, Android phone, Chrome and Safari extensions, web sender, the Daylight Share inbox
  on the DC-1) has one **Lab** switch, **on by default**, so the user never forgets to try the new features.
- With Lab off, the app is the plain version: pair, send links, pages and files, see delivery.
- The researched features (`research/FEATURES.md`) are built behind this switch.

## Features that need setup: show them anyway

- Server and AI features are **always visible** in Lab, even before their keys or server exist.
- **Tapping one that isn't set up shows a short message instead of doing nothing.** It names what's missing in one
  plain sentence and says where to add it. Examples:
  - "Needs a Claude API key. Add ANTHROPIC_API_KEY to the Daylight server (GitHub › Settings › Secrets) to turn this on."
  - "Needs the Daylight server. Add the Cloudflare secrets to turn this on."
- The control looks available, not greyed out or hidden. It just explains itself when tapped.

## Server

- A small **Cloudflare Worker** (free tier) on the user's account provides email-in for newsletters,
  scheduled RSS/digests, large files beyond ntfy.sh's limits, and the AI calls.
- It deploys from GitHub Actions once the repo has these secrets: `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`. Optionally the user gives a domain on Cloudflare for the email-in address.
- Until then the Worker is built and tested in CI. The apps show its features with the "needs the server" message.
- Content sent to the server for AI or email-in is not end-to-end encrypted. The app says so the first time.

## AI

- **Claude**, with the user's key (`ANTHROPIC_API_KEY`, kept as a Worker secret, never in an app).
- AI features are off until the key is set. Before then they show the "needs a Claude API key" message.

## Reader-side features

- Features that need the Daylight Reader itself (the inbox built into the Reader, highlights back to the phone, the
  tablet's queue managed from the phone, reading progress) are built by a session on the Mac mini.
- They go into a **side-by-side test copy** of the Reader, behind the Reader's own Labs switch, installed only on
  the lab tablet (Rooted 2). Never on JP4R03005, and never merged or shipped without the user.

## Priority

- **iPhone and Mac first**, then Chrome, Android phone, web, and the DC-1 inbox.

## Answers to the Lab plan's open questions (Oct 22)

- **Excerpts (LAB-PLAN 6.5 Q1): only explicit selections.** Text becomes an excerpt only when the user clearly
  selected it: the Chrome/Safari context menu, Selection mode, a Safari selection, or "Send as excerpt".
  Ordinary "headline + link" shares stay links.
- **Per-feature switches (Q5): yes.** Features that change how sharing behaves (share in place, the copied-link
  prompt, clean links, the "Send as" hints, and similar) each get a **Use** switch in What's in Lab, on by default. The
  one Lab switch still turns all of Lab off.
- **Mac signing (Q6): not now; keep ad-hoc builds.** But build the whole Developer ID path now (signing, hardened
  runtime, notarization, a team-prefixed App Group), switched on only when the secrets exist. The user has an Apple
  Developer account and will add them. Tracked in LOOSE-ENDS.md.
- **Requests to the main Reader (Q8): all three.** Ask the Reader session on the Mac mini for:
  - (a) the ImportActivity race fix;
  - (b) a quiet import entry point for documents that imports without opening and reports the outcome;
  - (c) keeping the Daylight Share item id with what it saves.

  Each is proved first in the side-by-side Lab Reader on the lab tablet.
