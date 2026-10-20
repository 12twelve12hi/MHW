# Send to Daylight: web sender

A single web page that sends links and files (PDF, EPUB, Word, Markdown, text, HTML; up to 9 MB) to your Daylight
DC-1. Nothing to install: it works in any modern browser, on a phone, a tablet or a computer someone else owns. It is
the fallback for devices without the app or the browser extension, and the target of the
[iPhone Shortcut](SHORTCUT.md).

**Address:** <https://12twelve12hi.github.io/MHW/send/> once GitHub Pages is switched on (below). It can also be hosted
anywhere: unzip `send-to-daylight-web.zip` from the
[latest builds](https://github.com/12twelve12hi/MHW/releases/tag/reader-experiment-latest) onto any static web host
(HTTPS needed for offline use and installing).

## Use

1. **Pair:** type the 28-character code from Daylight Share, or paste its pairing link. A link to the page with
   `#pair=<pairing link or code>` at the end pairs too: it asks first, on the page (*Pair with …? Code starts
   E4AY…*, and the relay when it isn't ntfy.sh; **Pair** or **Cancel**), unless it is the Daylight already paired,
   whose new relay or name then applies at once (*Pairing updated…*). A link or code for a **different** Daylight says
   that it replaces the current one (**Switch** or **Cancel**), and switching discards what the old one hasn't picked
   up yet. *Advanced: Relay URL* is only for your own ntfy server, with a typed code (a link carries its relay).
   **Settings › Change pairing…** takes a code again, with the relay in use filled in.
2. **Send a link:** paste or type it (`example.com/story` is fine) and tap **Send link**.
3. **Send a file:** tap **Choose a file** (or drop files on it on a computer). Files can be up to 9 MB; a larger one
   is refused before it is read (*Too big to send. Files can be up to 9 MB; this one is 14.2 MB.*); one shared to
   the installed app on Android isn't even copied. The free relay takes 2 MB per attachment, so larger files travel in
   pieces that fit.
4. The history uses the words of every Send to Daylight app: **Sent · waiting for your Daylight**, then
   **Delivered ✓** once the Daylight confirms it; **Waiting to send** with why (and **Retry now** when the relay
   couldn't be reached); **Not delivered** with why (and **Try again** where that can help). Every row has **Remove**.

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
and re-sends anything unconfirmed that the relay may have dropped. An item still undelivered after a week shows *Not
delivered* with **Try again**; its copy is kept for that until two weeks after the share, and a confirmation that
arrives within about two weeks still makes it *Delivered ✓*. With nothing waiting or still to be confirmed, the page
doesn't contact the relay. It can't do that while closed: open it now and then
if the Daylight was off for a long time (or use the app or extension, which check in the background).

The service worker caches the page so it opens offline; sends made offline show *Waiting to send* and go out with
**Retry now** or the next time the page opens online.

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
