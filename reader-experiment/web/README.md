# Send to Daylight: web sender

A single web page that sends links and files (PDF, EPUB, Word, Markdown, text, HTML; up to 64 MB) to your Daylight
DC-1. Nothing to install: it works in any modern browser, on a phone, a tablet or a computer someone else owns. It is
the fallback for devices without the app or the browser extension, and the target of the
[iPhone Shortcut](SHORTCUT.md).

**Address:** <https://12twelve12hi.github.io/MHW/send/> once GitHub Pages is switched on (below). It can also be hosted
anywhere: unzip `send-to-daylight-web.zip` from the
[latest builds](https://github.com/12twelve12hi/MHW/releases/tag/reader-experiment-latest) onto any static web host
(HTTPS needed for offline use and installing).

## Use

1. **Pair:** type the 28-character code from Daylight Share, or paste its pairing link. A link to the page with
   `#pair=<pairing link or code>` at the end pairs in one tap. *Advanced: Relay URL* is only for your own ntfy server.
2. **Send a link:** paste or type it (`example.com/story` is fine) and tap **Send link**.
3. **Send a file:** tap **Choose a file** (or drop files on it on a computer).
4. The history shows *Sent*, then **Delivered ✓** once the Daylight confirms it, or *Not delivered* with **Retry**.

Links into the page can carry what to send, for Shortcuts, bookmarklets and other apps:

| Address | Effect |
|---|---|
| `…/send/?url=<address>&title=<title>` | fills in the link and title |
| `…/send/?text=<text with an address>` | finds the address in the text (the rest becomes the title) |
| add `&autosend=1` | sends at once (the page is cleared so a reload doesn't send again) |
| `…/send/#autosend=1&pair=<pairing link>&url=<address>` | the same in the fragment, which never reaches the server; pairs first if needed. This is what the Shortcut uses (Settings > *Copy*). |

**Android:** open the page in Chrome, then menu > **Add to Home screen** / **Install app**. **Send to Daylight** then
appears in the share sheet for links and files (Web Share Target; files go through the page's service worker).

**iPhone:** see [SHORTCUT.md](SHORTCUT.md) to add **Send to Daylight** to the share sheet.

## How it works

`index.html`, `app.js`, `styles.css`, `web-logic.js`, `web-storage.js`, `sw.js` and `manifest.webmanifest` are the page;
`build.mjs` copies in the protocol library ([`../share/js/daylight-share.js`](../share/js/daylight-share.js)) and the
status helpers (`../extension/src/logic.js`), so each has one source, and stamps the service worker with a hash of
the site. The pairing and the outbox live in this browser's IndexedDB (localStorage if that is unavailable). Items are
end-to-end encrypted in the page before they leave it; the relay (ntfy.sh by default) sees only scrambled data.

The page checks for the Daylight's confirmations when it opens, every minute while open, and shortly after each send,
and re-sends anything unconfirmed that the relay may have dropped. It can't do that while closed: open it now and then
if the Daylight was off for a long time (or use the app or extension, which check in the background).

The service worker caches the page so it opens offline; sends made offline show *Not delivered* and go out with
**Retry** or the next time the page opens online.

**Privacy note for github.io hosting:** every GitHub Pages site of the same account shares one browser origin
(`12twelve12hi.github.io`), so another page on it could read this page's storage, pairing included. Host the zip on its
own domain if that matters to you.

```sh
cd reader-experiment/web
node build.mjs --serve 8080    # builds dist/site and dist/send-to-daylight-web.zip, then serves http://127.0.0.1:8080/
```

Tests live with the extension's (`../extension/test/unit/web-logic.test.mjs`, `../extension/test/e2e/web.e2e.mjs`);
see [the extension README](../extension/README.md#build-and-test).

## GitHub Pages

The workflow [`rx-extension.yml`](../../.github/workflows/rx-extension.yml) deploys the web sender to Pages at
`/send/`, next to the highlights prototype at the root (both workflows deploy the same Pages site; this one includes
the latest highlights prototype so it doesn't remove it). Until Pages is on, that job fails without failing the run.
To switch it on:

1. **Settings > Pages > Build and deployment > Source: GitHub Actions.**
2. If the deploy job then says the branch "is not allowed to deploy to github-pages": **Settings > Environments >
   github-pages > Deployment branches and tags**, add `claude/sweet-goldberg-ej1nb0` (the environment allows only the
   default branch at first).
3. Re-run the *Reader experiment - extension and web sender* workflow (Actions tab > Run workflow). The sender is then
   at <https://12twelve12hi.github.io/MHW/send/>.

The highlights prototype's own workflow deploys only `highlights-prototype/www`, so a later run of it replaces the
site and `/send/` disappears until this workflow runs again.
