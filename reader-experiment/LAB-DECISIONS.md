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
