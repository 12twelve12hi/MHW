// Lab's Wave 1 in a real Chromium (LAB-PLAN 3.3, card X1): the popup, lab.html and review.html of the test build,
// against the mock relay, a local site and Daylights from daylight-share.js (v1.1) and daylight-lab.js (LabInboxSim).
//
//   F00.1  the one-time note shows once in a W1 build
//   F01    the timeline: "In your Reader ✓" from a Lab Daylight, read by the popup's faster checks within 45 s (F01.1);
//          a PDF "Waiting for a tap on your Daylight", then "Handed to the Reader" (F01.2); the check-in header (F01.3);
//          a v1.1 Daylight's rows read "Delivered ✓" (F01.5); the step line only on the newest row and rows not final,
//          the accessible text "{label}. {sentence}" (F01.6)
//   F02e.1 a PDF over 9 MB: the link with the too-big sentence, and "Send files over 9 MB ›" with its note
//   F03    a page shown only with a login cookie arrives with that text (F03.1), with no script, on* or form value
//          (F03.2)
//   F04    the card: sent 1.5 s after the click, also when the popup closes; Options stops it; Comfort: the choices and
//          Send, nothing before Send (F04.5); a PDF that needs its site's permission: the popup asks (Allow, Send the
//          link)
//   F07    offline: "Waiting for connection" and the queue with Cancel; back online it goes (F07.1, F07.2)
//   F10    Send as (the modes, Selection by itself), Clean article with Readability (a live page's "Key points" box kept,
//          F10.1: prepareForReadability runs first), the thin-page question (F10.2),
//          the mode kept for the site across a restart (F10.3), Review renders a 1 MB page within 1 s and sends the
//          edited title (F10.4), and says what the popup says (offline: "Waiting for connection"); F10's Use switch
//          off: no Send as, and a selection still goes (Send as excerpt, LAB-PROTOCOL 2.9.6)
//   F11    Send selection: one excerpt with the quote, its link and the date (F11.1)
//   F26    Setup check: its lines, the test article along the timeline, Copy diagnostics without URLs (F26.1-3)
//   F33    Paste and send: the host before anything is sent (F33.3)
//   F34    the menu entries' kinds (F34.1), the commands, the omnibox (F34.2)
//   6.5 Q5 the Use switches in What's in Lab and the features' own settings
//   F27    axe-core finds nothing on the new screens, light and dark, Comfort off and on; nothing clipped at 360 px
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/e2e/lab-w1.e2e.mjs      (HEADED=1 to watch)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { built } from '../helpers/built.mjs';
import { startSite } from '../helpers/server.mjs';
import { makePdf } from '../helpers/pdf.mjs';
import { labDefaultWritten } from '../helpers/lab-off.mjs';
import { axe, assertNotClipped, unnamed } from '../helpers/a11y.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const b = built('chrome-test');
const ds = await b.load('daylight-share.js');
const L = await b.load('daylight-lab.js');
const { LAB_TEXT } = L;
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'test-results', 'lab-w1');
const MIN = 60000;
const HUGE_PDF = makePdf({ pages: 2, fillerBytes: 14_000_000 });
/** F10.1's news pages (the share lane's fixtures): each page's HTML and the body Clean article must keep (<name>.txt). */
const NEWS = new URL('../../../share/js/test/fixtures/articles/news/', import.meta.url);

let relay, site, ctx, sw, extId, profile;

const storageSet = (items) => sw.evaluate((i) => chrome.storage.local.set(i), items);
const storageGet = async (key) => (await sw.evaluate((k) => chrome.storage.local.get(k), key))[key];
const pair = (input, from = 'W1 Chrome') => sw.evaluate(async ([i, f]) => globalThis.sendToDaylight.pair({ input: i, from: f, confirm: true }), [input, from]);
const unpair = () => sw.evaluate(async () => { await globalThis.sendToDaylight.unpair(); });

/** A new pairing on the mock relay, and the Daylight's receiver for it. -> {secret, pairing, receiver, receive(n)} */
async function newPairing(name = 'W1 Daylight') {
  const secret = ds.generateSecret();
  await pair(await ds.pairingLink({ secret, relay: relay.url, name }));
  const pairing = { secret, relay: relay.url };
  const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage() });
  const got = [];
  return {
    secret, pairing, receiver, got,
    async receive(n = 1, timeout = 20000) {
      const until = Date.now() + timeout;
      while (got.length < n && Date.now() < until) {
        got.push(...(await receiver.pollOnce()).items);
        if (got.length < n) await new Promise((r) => setTimeout(r, 250));
      }
      assert.ok(got.length >= n, `expected ${n} items, got ${got.length}`);
      return got.splice(0, got.length);
    },
  };
}

/** A Lab Daylight (LabInboxSim) on a pairing; its clock runs a minute ahead at each poll (past the 30 s between frames). */
async function labDaylight(pairing, stateFor = null) {
  let skew = 0;
  const now = () => Date.now() + skew;
  const storage = new ds.MemoryStorage();
  const labInbox = new L.LabInbox({
    storage, relay: new ds.RelayClient({ relay: pairing.relay }), keys: await ds.deriveKeys(pairing.secret),
    info: () => ({ lab: 1, app: 'android/1.6.0', caps: ['st', 'tap', 'reader-link', 'cap-kind'], live: false }), from: 'Daylight', now, autoFlushMs: null,
  });
  const sim = new L.LabInboxSim({ receiver: new ds.Receiver({ pairing, storage, from: 'Daylight' }), labInbox, stateFor });
  const items = [];
  return { labInbox, items, async pollOnce() { skew += MIN; const r = await sim.pollOnce(); items.push(...r.items); return r; } };
}

async function openTab(url) {
  const page = await ctx.newPage();
  await page.goto(url).catch(() => {});
  let id;
  for (let i = 0; i < 50 && id == null; i++) {
    // The newest tab at that address (a test that failed may have left another one open).
    id = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u })).sort((a, z) => z.id - a.id)[0]?.id, url);
    if (id == null) await new Promise((r) => setTimeout(r, 100));
  }
  return { page, id };
}

async function openPopup(tabId, { width = 360 } = {}) {
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width, height: 700 });
  await popup.goto(`chrome-extension://${extId}/popup.html${tabId != null ? `?tab=${tabId}` : ''}`);
  await popup.waitForSelector('body[data-ready="1"]');
  return popup;
}

async function openLab(view, page = null) {
  const p = page ?? await ctx.newPage();
  await p.setViewportSize({ width: 360, height: 800 });
  await p.goto(`chrome-extension://${extId}/lab.html#${view}`);
  await p.waitForSelector('body[data-fresh="1"]', { timeout: 20000 });
  return p;
}

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

/** axe in light and dark, as F27.1 asks. */
async function axeBoth(page, what) {
  await axe(page, what);
  await page.emulateMedia({ colorScheme: 'dark' });
  await axe(page, `${what} (dark)`);
  await page.emulateMedia({ colorScheme: 'light' });
}

/** Records what a page copies (an extension page can't read the system clipboard in a test browser). */
async function recordCopies(page) {
  await page.evaluate(() => {
    window.__copied = [];
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__copied.push(t); write(t).catch(() => {}); return Promise.resolve(); };
  });
  return async () => page.evaluate(() => window.__copied.at(-1) ?? null);
}

const settled = (popup, id, label, timeout = 45000) => popup.waitForFunction(([i, l]) => {
  const li = document.querySelector(`li[data-id="${i}"]`);
  return li && li.querySelector('.st')?.textContent === l;
}, [id, label], { timeout });

before(async () => {
  relay = await startMockRelay();
  site = await startSite();
  const words = (n, w = 'calm') => Array.from({ length: n }, (_, i) => `${w}${i % 50}`).join(' ');
  const html = (body, title = 'A page') => Buffer.from(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`);
  // F03: shown only with the member cookie; full of what must not leave the browser.
  site.routes.set('/members.html', {
    type: 'text/html; charset=utf-8',
    body: null,
    dynamic: (req) => {
      const member = /(^|;\s*)member=1(;|$)/.test(req.headers.cookie ?? '');
      return Buffer.from(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Members</title><meta name="csrf-token" content="csrf-abc">
<script>window.tracking = 'track-me';</script><script type="application/ld+json">{"@type":"NewsArticle","headline":"Members"}</script></head>
<body onload="window.loaded=1"><article><h1>Members</h1>${member ? '<p id="secret">Only for members: the slow loris report.</p>' : '<p>Please sign in.</p>'}
<form><input type="hidden" name="token" value="hidden-token-123"><input type="password" value="hunter2"><input type="text" name="q" value="typed words">
<textarea>draft text</textarea><select><option selected>one</option></select><button onclick="alert(1)">Go</button></form>
<a href="javascript:alert(2)">bad</a><iframe srcdoc="<p>inner</p>"></iframe></article></body></html>`);
    },
  });
  site.routes.set('/long-read.html', {
    type: 'text/html; charset=utf-8',
    body: html(`<nav id="site-nav">Home · World · Sport · Navigation links</nav><article><h1>The long read</h1><p class="byline">By Ann Lee</p>
${Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i}: ${words(60)}.</p>`).join('\n')}<p id="quote">The quick brown fox jumps over the lazy dog, again and again.</p></article>
<footer id="site-footer">Copyright footer text and links</footer>`, 'The long read – News'),
  });
  site.routes.set('/brief.html', { type: 'text/html; charset=utf-8', body: html(`<article><h1>Brief</h1><p>${words(40)}.</p></article>`, 'Brief') });
  site.routes.set('/mega.html', { type: 'text/html; charset=utf-8', body: html(`<article><h1>Mega</h1>${Array.from({ length: 2000 }, (_, i) => `<p>Line ${i}: ${words(70, 'word')}</p>`).join('')}</article>`, 'Mega page') });
  site.routes.set('/files/huge.pdf', { type: 'application/pdf', body: Buffer.from(HUGE_PDF) });
  // F10.1: the share lane's live page with a "Key points" box (share/js/test/fixtures/articles/news/).
  site.routes.set('/storm-warning-live.html', { type: 'text/html; charset=utf-8', body: fs.readFileSync(new URL('storm-warning-live.html', NEWS)) });
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-w1-'));
  await launch();
  await labDefaultWritten(sw);
});

/** Starts the browser on this file's profile (again, after closing it: a restart keeps storage.local). */
async function launch() {
  if (ctx) await ctx.close();
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${b.dir}`, `--load-extension=${b.dir}`],
  });
  const ours = (x) => x.url().startsWith('chrome-extension://') && x.url().endsWith('/background.js');
  sw = ctx.serviceWorkers().find(ours) ?? await ctx.waitForEvent('serviceworker', { predicate: ours, timeout: 30000 });
  extId = new URL(sw.url()).host;
  for (let i = 0; i < 100; i++) {
    if (await sw.evaluate(() => !!globalThis.chrome?.runtime?.id && !!globalThis.sendToDaylight).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}

after(async () => {
  await ctx?.close();
  await relay?.close();
  await site?.close();
});

// --- F00.1: the one-time note -------------------------------------------------------------------------------------------

test('F00.1: a W1 build shows the one-time note once; OK puts it away for good', { timeout: 60000 }, async () => {
  const popup = await openPopup();
  const note = popup.getByText(LAB_TEXT.note, { exact: true });
  await note.waitFor();
  await axeBoth(popup, 'popup: the one-time note');
  await shot(popup, 'note');
  await popup.locator('#lab-note').getByRole('button', { name: LAB_TEXT.noteButton }).click();
  assert.equal(await popup.locator('#lab-note').isHidden(), true);
  for (let i = 0; i < 20 && !(await storageGet('settings'))?.labNoteShown; i++) await popup.waitForTimeout(50);
  assert.equal((await storageGet('settings')).labNoteShown, true);
  await popup.reload();
  await popup.waitForSelector('body[data-ready="1"]');
  assert.equal(await popup.getByText(LAB_TEXT.note).count(), 0, 'once');
  await popup.close();
});

// --- F03 ---------------------------------------------------------------------------------------------------------------

test('F03.1, F03.2: a page shown only with a login cookie arrives with that text, without scripts, on* attributes or form contents', { timeout: 90000 }, async () => {
  const day = await newPairing();
  await ctx.addCookies([{ name: 'member', value: '1', url: site.url }]);
  const { page, id } = await openTab(`${site.url}/members.html`);
  assert.equal(await page.textContent('#secret'), 'Only for members: the slow loris report.');
  await page.fill('textarea', 'typed into the page');
  const popup = await openPopup(id);
  assert.equal(await popup.textContent('.send-as-btn'), 'Send as: Page ▾');
  await popup.click('#send-page');
  await popup.waitForFunction(() => /^Sent · waiting for your Daylight\./.test(document.querySelector('#status').textContent));
  const [item] = await day.receive(1);
  assert.equal(item.header.kind, 'page');
  assert.deepEqual(item.extras, { 'x-cap': 'seen' });
  const html = new TextDecoder().decode(item.content);
  assert.match(html, /^<!doctype html>\n<html>/);
  assert.match(html, /Only for members: the slow loris report\./, 'F03.1: the logged-in text');
  assert.match(html, /application\/ld\+json/, 'JSON-LD stays');
  for (const gone of ['track-me', 'onload', 'onclick', 'hidden-token-123', 'hunter2', 'typed words', 'draft text', 'typed into the page', 'csrf-abc', 'javascript:', 'srcdoc', 'selected']) {
    assert.ok(!html.includes(gone), `F03.2: ${gone} is gone`);
  }
  await popup.close();
  await page.close();
  await ctx.clearCookies();
  await unpair();
});

// --- F01 ---------------------------------------------------------------------------------------------------------------

test('F01: the timeline with a Lab Daylight (In your Reader ✓ within 45 s; a PDF waits for a tap, then Handed) and a v1.1 one (Delivered ✓)', { timeout: 180000 }, async () => {
  const day = await newPairing('Timeline Daylight');
  let pdfState = 'waiting';
  const lab = await labDaylight(day.pairing, (h) => (h.kind === 'file' ? pdfState : 'reader'));
  await storageSet({ settings: { lab: true, labNoteShown: true, from: 'W1 Chrome' } });
  // A link, from the popup.
  const { page, id } = await openTab(`${site.url}/long-read.html`);
  const popup = await openPopup(id);
  await popup.click('#send-link');
  await popup.waitForSelector('#history li[data-status="sent"]');
  const linkId = await popup.getAttribute('#history li', 'data-id');
  assert.equal(await popup.textContent('#lab-checkin'), 'Your Daylight hasn’t checked in since this device paired.', 'F01.3, before any check-in');
  await lab.pollOnce();
  // The popup reads the ack topic now and then (8 s while pending, then every 30 s for the state, 2.5).
  const t0 = Date.now();
  await settled(popup, linkId, 'On your Daylight ✓', 30000).catch(() => {});
  await settled(popup, linkId, 'In your Reader ✓', 45000);
  assert.ok(Date.now() - t0 < 45000 + 30000);
  assert.match(await popup.textContent('#lab-checkin'), /^Your Daylight checked in (just now|\d+ min ago)\.$/, 'F01.3');
  const row = popup.locator(`li[data-id="${linkId}"]`);
  assert.equal(await row.locator('.lab-row-a11y').textContent(), 'In your Reader ✓. Saved in the Daylight Reader.', 'F01.6: label and sentence');
  assert.equal(await row.locator('.lab-steps').textContent(), 'Sent ✓ · On your Daylight ✓ · In the Reader ✓');
  assert.equal(await row.locator('.lab-steps').getAttribute('aria-hidden'), 'true', 'the step line is hidden from screen readers');
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})).catch(() => ''), '');

  // A PDF that waits for a tap (Documents = Ask), then is handed (F01.2), on the same popup.
  const pdf = makePdf({ pages: 1, fillerBytes: 1000 });
  site.routes.set('/files/ask.pdf', { type: 'application/pdf', body: Buffer.from(pdf) });
  const r = await sw.evaluate(async (u) => globalThis.sendToDaylight.sendPdf({ url: u, prompt: false, asked: true }), `${site.url}/files/ask.pdf`);
  assert.equal(r.row.kind, 'file');
  await lab.pollOnce();
  await sw.evaluate(() => globalThis.sendToDaylight.checkAcksNow());
  await settled(popup, r.row.id, 'Waiting for a tap on your Daylight', 20000);
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '⌛', 'F01: the badge');

  // F01.6: three rows: `reader` (final, not the newest), `waiting` (not final, not the newest) and the newest, `sent`.
  await popup.click('#send-page');
  await popup.waitForFunction(() => document.querySelectorAll('#history li').length === 3
    && document.querySelector('#history li').dataset.status === 'sent');
  const newest = popup.locator('#history li').first();
  const pdfRow = popup.locator(`li[data-id="${r.row.id}"]`);
  assert.deepEqual(await popup.locator('#history li .st').allTextContents(), ['Sent · waiting for your Daylight', 'Waiting for a tap on your Daylight', 'In your Reader ✓']);
  assert.equal(await newest.locator('.lab-steps').isVisible(), true, 'the newest row shows its step line');
  assert.equal(await newest.locator('.lab-steps').textContent(), 'Sent ✓ · On your Daylight … · In the Reader');
  assert.equal(await pdfRow.locator('.lab-steps').isVisible(), true, 'a row that is not final shows its step line, newest or not');
  assert.equal(await pdfRow.locator('.lab-steps').textContent(), 'Sent ✓ · On your Daylight ✓ · In the Reader …');
  assert.equal(await pdfRow.locator('.sentence').isVisible(), true, 'and its sentence');
  assert.equal(await pdfRow.locator('.lab-row-a11y').textContent(), 'Waiting for a tap on your Daylight. Tap its notice on your Daylight to add it to the Reader.');
  assert.equal(await row.locator('.lab-steps').isVisible(), false, 'a final row that is not the newest keeps it in its details');
  assert.equal(await row.locator('.sentence').isVisible(), false);
  assert.equal(await row.locator('.lab-row-a11y').textContent(), 'In your Reader ✓. Saved in the Daylight Reader.', 'its label and sentence are still read');
  for (const li of [newest, pdfRow, row]) {
    assert.equal(await li.locator('.lab-steps').getAttribute('aria-hidden'), 'true', 'no step count for screen readers');
  }
  await row.getByRole('button', { name: await row.locator('.item-title').textContent(), exact: true }).click();
  assert.equal(await row.locator('.lab-steps').isVisible(), true, 'tapping the row opens its details');
  assert.deepEqual(await unnamed(popup), []);
  await axeBoth(popup, 'popup: the timeline');
  await shot(popup, 'timeline');

  pdfState = 'handed';
  await lab.labInbox.record(r.row.id, 'handed', Math.floor(Date.now() / 1000) + 300);
  await lab.pollOnce();
  await sw.evaluate(() => globalThis.sendToDaylight.checkAcksNow());
  await settled(popup, r.row.id, 'Handed to the Reader', 20000);
  assert.equal(await pdfRow.locator('.lab-row-a11y').textContent(), 'Handed to the Reader. Your Daylight passed it to the Reader. The Reader doesn’t confirm documents yet.');
  assert.equal(await pdfRow.locator('.lab-steps').isVisible(), false, 'handed is final: not the newest, so its step line is in its details');
  await popup.close();

  // F01.5: a v1.1 Daylight (no Lab frames): Delivered ✓, exactly as v1.1.
  await unpair();
  const v11 = await newPairing('Plain Daylight');
  const p2 = await openPopup(id);
  await p2.click('#send-link');
  await p2.waitForSelector('#history li[data-status="sent"]');
  await v11.receive(1);
  await sw.evaluate(() => globalThis.sendToDaylight.tick());
  await p2.waitForSelector('#history li[data-status="delivered"]');
  assert.equal(await p2.textContent('#history li .st'), 'Delivered ✓');
  assert.equal(await p2.locator('#history li .lab-steps').count(), 0, 'no step line: v1.1’s layout');
  assert.equal(await p2.textContent('#history li .sentence'), 'Saved on your Daylight.');
  await p2.close();
  await page.close();
  await unpair();
});

// --- F02 entry point -------------------------------------------------------------------------------------------------

test('F02e.1: a PDF over 9 MB goes as its link with the too-big sentence and “Send files over 9 MB ›”, which shows the needs-server note', { timeout: 120000 }, async () => {
  const day = await newPairing();
  const { page, id } = await openTab(`${site.url}/files/huge.pdf`);
  const popup = await openPopup(id);
  assert.equal(await popup.textContent('#send-page'), 'Send this PDF');
  assert.equal(await popup.locator('#lab-send-as').isHidden(), true, 'a PDF goes as the file: no Send as');
  await popup.click('#send-page');
  await popup.waitForFunction(() => /^The PDF is over 9 MB, so its link was sent\./.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
  const big = popup.getByRole('button', { name: LAB_TEXT.bigFiles });
  await big.click();
  const note = popup.locator('#lab-after .lab-note-body[data-state="needs-server"]');
  await note.waitFor();
  assert.equal(await note.locator('.lab-note-text').first().textContent(), LAB_TEXT.needs['needs-server']);
  assert.equal(await popup.locator('#lab-after .lab-note').getAttribute('aria-live'), 'polite');
  await axeBoth(popup, 'popup: the F02 entry point');
  await shot(popup, 'big-files');
  const [item] = await day.receive(1);
  assert.equal(item.header.kind, 'url');
  await popup.close();
  await page.close();
  await unpair();
});

// --- F10, F11 ----------------------------------------------------------------------------------------------------------

test('F10, F11: Send as switches to Selection by itself; Send selection is one excerpt; Clean article; the thin question; the mode kept for the site', { timeout: 150000 }, async () => {
  const day = await newPairing();
  const { page, id } = await openTab(`${site.url}/long-read.html`);
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#quote'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  let popup = await openPopup(id);
  assert.equal(await popup.textContent('.send-as-btn'), 'Send as: Selection ▾', 'switched to Selection by itself');
  await popup.click('.send-as-btn');
  assert.deepEqual(await popup.locator('.send-as-menu label').allTextContents(), Object.values(LAB_TEXT.sendAs.menu));
  assert.equal(await popup.getByRole('radio', { name: LAB_TEXT.sendAs.menu.selection }).isChecked(), true);
  await axeBoth(popup, 'popup: Send as, open');
  await shot(popup, 'send-as');
  await popup.keyboard.press('Escape');
  await popup.click('#send-page');
  await popup.waitForSelector('#lab-after .lab-line');
  assert.equal(await popup.textContent('#lab-after .lab-line'), LAB_TEXT.excerpt.waitsOnce, 'the first excerpt says so, once');
  let [item] = await day.receive(1);
  assert.deepEqual([item.header.kind, item.header.mime, item.extras['x-cap']], ['file', 'text/html', 'excerpt']);
  assert.equal(item.header.title, '“The quick brown fox jumps over the lazy dog, again and again.” · The long read – News');
  assert.equal(item.header.url, `${site.url}/long-read.html#:~:text=The%20quick%20brown%20fox%20jumps%20over%20the%20lazy`);
  let html = new TextDecoder().decode(item.content);
  assert.match(html, /<blockquote>The quick brown fox jumps over the lazy dog, again and again\.<\/blockquote>/, 'the quote (the paragraph’s text was selected)');
  assert.match(html, new RegExp(`<a href="${site.url}/long-read.html">The long read – News</a> · 127\\.0\\.0\\.1 · \\d+ \\w+ \\d{4}`), 'the source link and the date');
  assert.doesNotMatch(html, /Paragraph 3/, 'F11.1: the full article is not sent');
  // The menu entry (macOS Safari and Chrome): the same excerpt.
  await sw.evaluate(async (t) => globalThis.sendToDaylight.onMenu({ menuItemId: 'dls-selection', frameId: 0, selectionText: 'x' }, t), { id, url: `${site.url}/long-read.html`, title: 'The long read – News' });
  [item] = await day.receive(1);
  assert.equal(item.extras['x-cap'], 'excerpt');
  await popup.close();

  // Clean article: Readability, without navigation and footer, x-cap "clean".
  await page.evaluate(() => getSelection().removeAllRanges());
  popup = await openPopup(id);
  assert.equal(await popup.textContent('.send-as-btn'), 'Send as: Page ▾');
  await popup.click('.send-as-btn');
  await popup.getByRole('radio', { name: LAB_TEXT.sendAs.menu.clean }).check();
  assert.equal(await popup.textContent('.send-as-btn'), 'Send as: Clean article ▾');
  await popup.click('#send-page');
  await popup.waitForFunction(() => /^Sent/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
  [item] = await day.receive(1);
  assert.equal(item.extras['x-cap'], 'clean');
  html = new TextDecoder().decode(item.content);
  assert.match(html, /^<!doctype html><html><head><meta charset="utf-8"><title>The long read/);
  assert.match(html, /<meta name="dl:capture" content="clean">/);
  for (let i = 0; i < 8; i++) assert.match(html, new RegExp(`Paragraph ${i}:`), `F10.1: paragraph ${i} kept`);
  assert.doesNotMatch(html, /Navigation links|Copyright footer/, 'F10.1: navigation and footer dropped');
  await popup.close();

  // Kept for the site (F10.3), also across a restart of the background.
  assert.equal((await storageGet('lab/sendAs'))['127.0.0.1'], 'clean');
  await page.close();
  await launch(); // the browser restarts with the same profile
  const again = await openTab(`${site.url}/long-read.html`);
  const brief = await openTab(`${site.url}/brief.html`);
  popup = await openPopup(again.id);
  assert.equal(await popup.textContent('.send-as-btn'), 'Send as: Clean article ▾', 'F10.3: remembered for the site');
  await popup.close();

  // Thin (40 words): the question; Send full page sends the page (F10.2).
  popup = await openPopup(brief.id);
  await popup.click('.send-as-btn');
  await popup.getByRole('radio', { name: LAB_TEXT.sendAs.menu.clean }).check();
  await popup.click('#send-page');
  const q = popup.locator('.lab-thin');
  await q.waitFor();
  assert.match(await q.locator('.lab-note-text').textContent(), /^This page looks thin \(\d+ words\)\. Send the full page instead\?$/);
  await axeBoth(popup, 'popup: the thin-page question');
  await shot(popup, 'thin');
  await q.getByRole('button', { name: LAB_TEXT.sendAs.sendFull }).click();
  await popup.waitForFunction(() => /^Sent/.test(document.querySelector('#status').textContent));
  [item] = await day.receive(1);
  assert.equal(item.extras['x-cap'], 'seen', 'the full page');
  await popup.close();
  await brief.page.close();
  await again.page.close();
  await unpair();
});

test('F10.1: Clean article keeps a live page’s “Key points” box, first, as on the page (prepareForReadability before Readability)', { timeout: 90000 }, async () => {
  const day = await newPairing();
  const { page, id } = await openTab(`${site.url}/storm-warning-live.html`);
  const popup = await openPopup(id);
  await popup.click('.send-as-btn');
  await popup.getByRole('radio', { name: LAB_TEXT.sendAs.menu.clean }).check();
  assert.equal(await popup.textContent('.send-as-btn'), 'Send as: Clean article ▾');
  await popup.click('#send-page');
  await popup.waitForFunction(() => /^Sent/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
  const [item] = await day.receive(1);
  assert.deepEqual([item.header.kind, item.extras['x-cap']], ['page', 'clean']);
  const html = new TextDecoder().decode(item.content);
  assert.match(html, /<meta name="dl:capture" content="clean">/);
  const flat = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const text = flat(html.slice(html.indexOf('<body>')));
  const at = (s) => text.indexOf(flat(s));
  // The whole body, the box included, in the page's order: the box's heading, its list, then the newest entry.
  const body = fs.readFileSync(new URL('storm-warning-live.txt', NEWS), 'utf8').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  assert.deepEqual(body.filter((p) => at(p) < 0), [], 'F10.1: every paragraph of the body is kept');
  assert.ok(at('Key points') >= 0, 'the Key points box is kept');
  assert.ok(at('Key points') < at('An amber warning for wind covers the whole coast'), 'its heading, then its list');
  assert.ok(at('Gusts of up to 120 kilometres') < at('14:05 Schools to close early'), 'the list, then the newest entry');
  for (const gone of ['All live coverage from our newsroom', 'Check before you travel', 'Coastline Today is an independent regional news service']) {
    assert.ok(at(gone) < 0, `F10.1: “${gone}” (navigation, sidebar, footer) is dropped`);
  }
  // Readability alone (the build's copy, in the page) drops the box: this page tests the step before it.
  await page.addScriptTag({ path: path.join(b.dir, 'Readability.js') });
  const alone = await page.evaluate(() => new Readability(document.cloneNode(true)).parse().textContent); // eslint-disable-line no-undef
  assert.ok(!flat(alone).includes('Key points') && flat(alone).includes('14:05 Schools to close early'), 'Readability alone drops the Key points');
  await popup.close();
  await page.close();
  await unpair();
});

test('F10.4: Review shows a 1 MB page within 1 s, without scripts and in greys, and sends the edited title', { timeout: 120000 }, async () => {
  const day = await newPairing();
  await storageSet({ settings: { lab: true, labNoteShown: true, labReview: true, from: 'W1 Chrome' } });
  const { page, id } = await openTab(`${site.url}/mega.html`);
  const popup = await openPopup(id);
  const [review] = await Promise.all([ctx.waitForEvent('page'), popup.click('#send-page')]);
  await review.waitForSelector('body[data-ready="1"]');
  await review.waitForSelector('body[data-rendered]', { timeout: 10000 });
  const ms = Number(await review.getAttribute('body', 'data-rendered'));
  assert.ok(ms < 1000, `F10.4: rendered in ${ms} ms`);
  assert.equal(await review.getAttribute('#review-frame', 'sandbox'), '', 'JavaScript off: no permissions at all');
  assert.equal(await review.evaluate(() => getComputedStyle(document.querySelector('#review-frame')).filter), 'grayscale(1)');
  assert.match(await review.textContent('#review-stats'), /^\d+ words · about \d+(\.\d+)? MB$/);
  assert.equal(await review.inputValue('#review-title'), 'Mega page');
  assert.deepEqual(await day.receive(0), [], 'nothing before Send');
  await axeBoth(review, 'review.html');
  await assertNotClipped(review, 'review.html');
  await shot(review, 'review');
  await review.fill('#review-title', 'A title of my own');
  await review.click('#review-send');
  await review.waitForSelector('body[data-sent="1"]');
  const [item] = await day.receive(1);
  assert.deepEqual([item.header.title, item.extras['x-cap']], ['A title of my own', 'seen']);
  await review.close();
  await popup.close();
  await page.close();
  await storageSet({ settings: { lab: true, labNoteShown: true, from: 'W1 Chrome' } });
  await unpair();
});

test('F10 Review offline: Send says what the popup says for the same row, “Waiting for connection” (2.5 rule 2); back online it goes', { timeout: 150000 }, async () => {
  const day = await newPairing();
  await storageSet({ settings: { lab: true, labNoteShown: true, labReview: true, from: 'W1 Chrome' } });
  const { page, id } = await openTab(`${site.url}/brief.html`);
  const popup = await openPopup(id);
  const [review] = await Promise.all([ctx.waitForEvent('page'), popup.click('#send-page')]);
  await review.waitForSelector('body[data-ready="1"]');
  await ctx.setOffline(true);
  try {
    await review.click('#review-send');
    await review.waitForSelector('body[data-sent="1"]');
    assert.equal(await review.textContent('#review-said'), 'Waiting for connection. It will send when this device is back online.');
    await popup.waitForSelector('#lab-queue li');
    assert.equal(await popup.textContent('#lab-queue li .st'), 'Waiting for connection', 'the popup’s row: the same words');
  } finally { await ctx.setOffline(false); }
  const [item] = await day.receive(1, 70000);
  assert.equal(item.extras['x-cap'], 'seen');
  await review.close();
  await popup.close();
  await page.close();
  await storageSet({ settings: { lab: true, labNoteShown: true, from: 'W1 Chrome' } });
  await unpair();
});

test('2.9.6: F10’s Use switch off: no Send as, the page as you see it; with text selected, “Send as excerpt” sends the selection', { timeout: 120000 }, async () => {
  const day = await newPairing();
  await storageSet({ settings: { lab: true, labNoteShown: true, labExcerptNoteShown: true, labUse: { F10: false }, from: 'W1 Chrome' } });
  const { page, id } = await openTab(`${site.url}/long-read.html`);
  let popup = await openPopup(id);
  assert.equal(await popup.locator('#lab-send-as').isHidden(), true, 'no Send as');
  assert.equal(await popup.locator('#lab-excerpt').isHidden(), true, 'nothing selected: no excerpt button');
  await popup.close();
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#quote'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  popup = await openPopup(id);
  const excerpt = popup.getByRole('button', { name: LAB_TEXT.shareInPlace.sendAsExcerpt, exact: true });
  await excerpt.waitFor();
  assert.equal(await popup.locator('#lab-send-as').isHidden(), true, 'still no Send as');
  assert.equal(await popup.textContent('#send-page'), 'Send this page');
  assert.deepEqual(await unnamed(popup), []);
  await axeBoth(popup, 'popup: Send as excerpt (F10’s Use switch off)');
  await shot(popup, 'excerpt-f10-off');
  // Send this page: the page as you see it (F03), not the selection.
  await popup.click('#send-page');
  let [item] = await day.receive(1);
  assert.deepEqual([item.header.kind, item.extras['x-cap']], ['page', 'seen']);
  // Send as excerpt: the selection, as an excerpt document (F11).
  await excerpt.click();
  [item] = await day.receive(1);
  assert.deepEqual([item.header.kind, item.header.mime, item.extras['x-cap']], ['file', 'text/html', 'excerpt']);
  assert.match(new TextDecoder().decode(item.content), /<blockquote>The quick brown fox jumps over the lazy dog, again and again\.<\/blockquote>/);
  await popup.close();
  await page.close();
  await storageSet({ settings: { lab: true, labNoteShown: true, from: 'W1 Chrome' } });
  await unpair();
});

// --- F04 ---------------------------------------------------------------------------------------------------------------

test('F04: “Send when I click the toolbar button”: the card sends after 1.5 s, also with the popup closed; Options stops it; Comfort waits for Send', { timeout: 120000 }, async () => {
  const day = await newPairing('Card Daylight');
  await storageSet({ settings: { lab: true, labNoteShown: true, labClickSend: true, from: 'W1 Chrome' } });
  const { page, id } = await openTab(`${site.url}/long-read.html`);
  // The card: "Sending to Card Daylight", Options; sent by itself.
  let popup = await openPopup(id);
  assert.equal(await popup.textContent('.lab-card-title'), 'Sending to Card Daylight');
  assert.equal(await popup.locator('#send-page').isHidden(), true);
  await axeBoth(popup, 'popup: the share-in-place card');
  await shot(popup, 'card');
  await popup.waitForFunction(() => /^Sent/.test(document.querySelector('#status').textContent), null, { timeout: 10000 });
  let [item] = await day.receive(1);
  assert.equal(item.extras['x-cap'], 'seen');
  await popup.close();
  // Closed at once: the background still sends (it owns the timer).
  popup = await openPopup(id);
  await popup.close();
  [item] = await day.receive(1, 10000);
  assert.equal(item.header.kind, 'page');
  // Options: stops the countdown; the choices and Send; Send the link instead.
  popup = await openPopup(id);
  await popup.getByRole('button', { name: LAB_TEXT.shareInPlace.options }).click();
  await popup.waitForSelector('.lab-card-send');
  await popup.waitForTimeout(2500);
  assert.deepEqual(await day.receive(0), [], 'nothing went after Options');
  assert.equal(await popup.textContent('.lab-card-extra .send-as-btn'), 'Send as: Page ▾');
  assert.equal(await popup.getByRole('switch', { name: LAB_TEXT.sendAs.review }).isChecked(), false);
  await axeBoth(popup, 'popup: the card’s choices');
  await shot(popup, 'card-options');
  await popup.getByRole('button', { name: LAB_TEXT.shareInPlace.sendLinkInstead }).click();
  [item] = await day.receive(1);
  assert.equal(item.header.kind, 'url');
  await popup.close();
  // Comfort (or "Always show Options before sending"): the choices and Send, and nothing before Send (F04.5).
  for (const extra of [{ comfort: true }, { labAlwaysOptions: true }]) {
    await storageSet({ settings: { lab: true, labNoteShown: true, labClickSend: true, from: 'W1 Chrome', ...extra } });
    popup = await openPopup(id);
    await popup.waitForSelector('.lab-card-send');
    assert.equal(await popup.getByRole('button', { name: LAB_TEXT.shareInPlace.options }).count(), 0, 'no countdown, no Options');
    await popup.waitForTimeout(2500);
    assert.deepEqual(await day.receive(0), [], `${JSON.stringify(extra)}: nothing before Send`);
    if (extra.comfort) {
      await axeBoth(popup, 'popup: the card, Comfort');
      await assertNotClipped(popup, 'popup: the card, Comfort');
      await shot(popup, 'card-comfort');
    }
    await popup.getByRole('button', { name: LAB_TEXT.shareInPlace.send, exact: true }).click();
    [item] = await day.receive(1);
    assert.equal(item.header.kind, 'page');
    await popup.close();
  }
  // F04's Use switch off: the popup is the ordinary one.
  await storageSet({ settings: { lab: true, labNoteShown: true, labClickSend: true, labUse: { F04: false }, from: 'W1 Chrome' } });
  popup = await openPopup(id);
  assert.equal(await popup.locator('#lab-card').isHidden(), true);
  assert.equal(await popup.locator('#send-page').isVisible(), true);
  await popup.close();
  await storageSet({ settings: { lab: true, labNoteShown: true, from: 'W1 Chrome' } });
  await page.close();
  await unpair();
});

test('F04: a PDF that needs its site’s permission: after the countdown the card’s popup asks, with Allow and Send the link', { timeout: 120000 }, async () => {
  // The background's side (it answers {needsPermission} only while a popup is open, and sends the link otherwise) is
  // lab-send.test.mjs's: in automation the extension has no activeTab, so a tab on a site it may not read has no URL to
  // send. Here the popup gets that answer from its countdown, as it would for such a PDF, and the browser refuses to
  // show its own prompt (as it does once the click is too long ago; automation can't answer the prompt anyway).
  const day = await newPairing('Card Daylight');
  await storageSet({ settings: { lab: true, labNoteShown: true, labClickSend: true, from: 'W1 Chrome' } });
  const { page, id } = await openTab(`${site.url}/brief.html`);
  const popup = await ctx.newPage();
  try {
    await popup.addInitScript(() => {
      const ns = globalThis.browser ?? globalThis.chrome;
      ns.permissions.request = () => Promise.reject(new Error('This function must be called during a user gesture'));
      const rt = ns.runtime;
      const send = rt.sendMessage.bind(rt);
      globalThis.sentTypes = [];
      rt.sendMessage = (msg) => (globalThis.sentTypes.push(msg?.type), msg?.type !== 'labScheduleSend' ? send(msg) : new Promise((resolve) => setTimeout(() => resolve({
        ok: true, result: { needsPermission: { origins: ['https://papers.example/*'] }, url: 'https://papers.example/locked.pdf', title: 'Locked paper', token: 'f'.repeat(32) },
      }), 1500)));
    });
    await popup.setViewportSize({ width: 360, height: 700 });
    await popup.goto(`chrome-extension://${extId}/popup.html?tab=${id}`);
    await popup.waitForSelector('body[data-ready="1"]');
    assert.equal(await popup.textContent('.lab-card-title'), 'Sending to Card Daylight');
    await popup.waitForSelector('#permission:not([hidden])', { timeout: 10000 });
    assert.equal(await popup.textContent('#perm-host'), 'papers.example');
    assert.equal(await popup.textContent('#status'), '', 'no empty result in its place');
    const sent = await popup.evaluate(() => globalThis.sentTypes);
    assert.ok(sent.indexOf('labHoldPdf') > sent.indexOf('labScheduleSend'), 'the popup takes the question, so the background doesn’t send its link');
    assert.deepEqual(await day.receive(0), [], 'nothing before the answer');
    await axeBoth(popup, 'popup: the card asks for a PDF’s site');
    await shot(popup, 'card-permission');
    await popup.click('#perm-link');
    const [item] = await day.receive(1);
    assert.deepEqual([item.header.kind, item.header.url], ['url', `${site.url}/brief.html`]);
  } finally {
    await popup.close();
    await page.close();
    await storageSet({ settings: { lab: true, labNoteShown: true, from: 'W1 Chrome' } });
    await unpair();
  }
});

// --- F07 ---------------------------------------------------------------------------------------------------------------

test('F07: offline, a share reads “Waiting for connection” in the queue with Cancel; back online it goes', { timeout: 150000 }, async () => {
  const day = await newPairing();
  const { page, id } = await openTab(`${site.url}/long-read.html`);
  const popup = await openPopup(id);
  // Offline as the browser sees it (the worker's navigator.onLine and its fetch, the popup's too).
  await ctx.setOffline(true);
  assert.equal(await sw.evaluate(() => navigator.onLine), false);
  await popup.click('#send-link');
  await popup.waitForSelector('#lab-queue:not([hidden]) li');
  assert.equal(await popup.textContent('#lab-queue-h'), 'Waiting to send (1)', 'F07.2: the count');
  assert.equal(await popup.textContent('#lab-queue li .st'), 'Waiting for connection', 'F07.1: not "Not delivered"');
  assert.equal(await popup.textContent('#lab-queue li .lab-steps'), 'Sent … · On your Daylight · In the Reader');
  assert.equal((await storageGet('outbox'))[0].attempts, 0, 'nothing was published');
  assert.ok(await sw.evaluate(() => chrome.alarms.get('dls-offline')), 'the dls-offline alarm waits for the network');
  assert.equal(await popup.getByRole('button', { name: /^Cancel: / }).count(), 1, 'Cancel on the row');
  assert.equal(await popup.locator('#lab-queue li .retry').count(), 0, 'no Retry now: it goes by itself once back online');
  await axeBoth(popup, 'popup: the queue');
  await shot(popup, 'queue');
  // A second one, cancelled.
  await popup.click('#send-link');
  await popup.waitForFunction(() => document.querySelectorAll('#lab-queue li').length === 2);
  await popup.getByRole('button', { name: /^Cancel: / }).first().click();
  await popup.waitForFunction(() => document.querySelectorAll('#lab-queue li').length === 1);
  // Back online: the popup's online event asks the background to send it now (the alarm would within a minute).
  await ctx.setOffline(false);
  const [item] = await day.receive(1, 70000);
  assert.equal(item.header.kind, 'url');
  await popup.waitForFunction(() => document.querySelector('#lab-queue').hidden, null, { timeout: 30000 });
  await popup.close();
  await page.close();
  await unpair();
});

// --- F33 ---------------------------------------------------------------------------------------------------------------

test('F33: Paste and send shows the copied link’s host before anything is sent; no link says so', { timeout: 90000 }, async () => {
  const day = await newPairing();
  // Copied on a web page (which may write the clipboard); the popup reads it with the extension's clipboardRead (the
  // test build has it; Chrome's build asks for it on the first Paste and send).
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.url });
  const { page, id } = await openTab(`${site.url}/brief.html`);
  const copy = async (text) => { await page.bringToFront(); await page.evaluate((t) => navigator.clipboard.writeText(t), text); await popup.bringToFront(); };
  const popup = await openPopup(id);
  await copy('Worth reading https://www.example.org/story?utm_source=mail');
  await popup.getByRole('button', { name: LAB_TEXT.copiedLink.pasteAndSend }).click();
  const ask = popup.locator('.lab-paste-confirm');
  await ask.waitFor();
  assert.equal(await ask.locator('.lab-note-text').textContent(), 'Send example.org?');
  assert.deepEqual(await day.receive(0), [], 'nothing before Send');
  await axeBoth(popup, 'popup: Paste and send');
  await shot(popup, 'paste');
  await ask.getByRole('button', { name: LAB_TEXT.automation.send }).click();
  const [item] = await day.receive(1);
  assert.deepEqual([item.header.url, item.header.title, item.extras['x-orig']], ['https://www.example.org/story', 'Worth reading', 'https://www.example.org/story?utm_source=mail']);
  await copy('just some words');
  await popup.getByRole('button', { name: LAB_TEXT.copiedLink.pasteAndSend }).click();
  await popup.getByText(LAB_TEXT.copiedLink.noLink).waitFor();
  await popup.close();
  await page.close();
  await unpair();
});

// --- F34 ---------------------------------------------------------------------------------------------------------------

test('F34: each menu entry sends its kind; the commands are listed; “dl example.com/story” sends the link, a typed full stop or stray bracket left out', { timeout: 90000 }, async () => {
  const day = await newPairing();
  const { page, id } = await openTab(`${site.url}/long-read.html`);
  const tab = { id, url: `${site.url}/long-read.html`, title: 'The long read – News' };
  const menu = (info) => sw.evaluate(async ([i, t]) => { await globalThis.sendToDaylight.onMenu(i, t); }, [info, tab]);
  await menu({ menuItemId: 'dls-page', frameId: 0 });
  await menu({ menuItemId: 'dls-clean', frameId: 0 });
  await menu({ menuItemId: 'dls-link', linkUrl: 'https://example.com/next?fbclid=x', frameId: 0, linkText: 'Next' });
  await menu({ menuItemId: 'dls-image', srcUrl: `${site.url}/i.png`, frameId: 0 });
  const got = await day.receive(4);
  assert.deepEqual(got.map((i) => [i.header.kind, i.extras['x-cap'] ?? null]), [['page', 'seen'], ['page', 'clean'], ['url', null], ['page', 'seen']]);
  assert.equal(got[2].header.url, 'https://example.com/next');
  const commands = await sw.evaluate(() => chrome.commands.getAll());
  assert.deepEqual(commands.map((c) => c.name).filter((n) => n.startsWith('send-')).sort(), ['send-clean', 'send-link', 'send-page', 'send-selection']);
  assert.equal(commands.find((c) => c.name === 'send-selection').description, LAB_TEXT.contextMenu.selection);
  const r = await sw.evaluate(() => globalThis.sendToDaylight.onOmnibox('example.com/story'));
  assert.equal(r.row.url, 'https://example.com/story');
  assert.equal((await day.receive(1))[0].header.url, 'https://example.com/story');
  // An address typed with a full stop or a stray bracket after it: smart intake's text rules leave them out (F16).
  await sw.evaluate(() => globalThis.sendToDaylight.onOmnibox('https://en.wikipedia.org/wiki/Foo_(bar)).'));
  assert.equal((await day.receive(1))[0].header.url, 'https://en.wikipedia.org/wiki/Foo_(bar)');
  await sw.evaluate(() => globalThis.sendToDaylight.onOmnibox('example.com/a/b.'));
  assert.equal((await day.receive(1))[0].header.url, 'https://example.com/a/b');
  // Lab off: the omnibox opens lab.html with the Lab-off sentence.
  await storageSet({ settings: { lab: false, labNoteShown: true, from: 'W1 Chrome' } });
  const [off] = await Promise.all([ctx.waitForEvent('page'), sw.evaluate(() => globalThis.sendToDaylight.onOmnibox('example.com/story'))]);
  await off.waitForSelector('body[data-fresh="1"]');
  assert.equal(new URL(off.url()).hash, '#lab-off');
  assert.equal(await off.textContent('#lab-off-said'), 'Turn on Lab in Send to Daylight to use this.');
  await axe(off, 'lab.html#lab-off');
  await off.close();
  await storageSet({ settings: { lab: true, labNoteShown: true, from: 'W1 Chrome' } });
  await page.close();
  await unpair();
});

// --- What's in Lab: the Use switches and the features' own settings ---------------------------------------------------

test('6.5 Q5: What’s in Lab’s Use switches and the features’ own settings (F04, F10, F34), Lab on; axe, light and dark, Comfort', { timeout: 150000 }, async () => {
  await newPairing();
  const whats = await openLab('whats-in-lab');
  await whats.waitForFunction(() => document.querySelectorAll('li.lab-feature').length === 14);
  assert.deepEqual(await whats.$$eval('li.lab-feature', (els) => els.map((e) => e.dataset.feature)),
    ['F01', 'F03', 'F04', 'F07', 'F10', 'F11', 'F16', 'F26', 'F33', 'F34', 'F02', 'F37', 'F19', 'F36']);
  for (const f of ['F04', 'F10', 'F16', 'F33']) {
    const sw1 = whats.getByRole('switch', { name: `Use ${LAB_TEXT.features[f].name}`, exact: true });
    assert.equal(await sw1.isChecked(), true, `${f}: on by default`);
    assert.equal(await sw1.evaluate((i) => document.getElementById(i.getAttribute('aria-describedby')).textContent), LAB_TEXT.use.footers[f]);
  }
  assert.equal(await whats.getByRole('switch', { name: /^Use / }).count(), 4, 'F03 has none here');
  await whats.getByRole('switch', { name: 'Use Clean links', exact: true }).click();
  for (let i = 0; i < 20 && (await storageGet('settings'))?.labUse?.F16 !== false; i++) await whats.waitForTimeout(50);
  assert.equal((await storageGet('settings')).labUse.F16, false);
  assert.deepEqual(await unnamed(whats), []);
  await axeBoth(whats, 'lab.html: What’s in Lab with the Use switches');
  await shot(whats, 'whats-in-lab');
  await whats.getByRole('switch', { name: 'Use Clean links', exact: true }).click();

  // F04's row opens its settings.
  await whats.getByRole('button', { name: LAB_TEXT.features.F04.name, exact: true }).click();
  await whats.waitForSelector('#view-f04:not([hidden]) .switch-row');
  assert.equal(await whats.textContent('#f04-h'), LAB_TEXT.features.F04.name);
  const click = whats.getByRole('switch', { name: LAB_TEXT.shareInPlace.toolbarSend, exact: true });
  assert.equal(await click.isChecked(), false, 'off by default');
  await click.click();
  for (let i = 0; i < 20 && !(await storageGet('settings'))?.labClickSend; i++) await whats.waitForTimeout(50);
  assert.equal((await storageGet('settings')).labClickSend, true);
  assert.equal(await whats.getByRole('switch', { name: LAB_TEXT.shareInPlace.alwaysOptions, exact: true }).isChecked(), false);
  await axeBoth(whats, 'lab.html#f04');
  await click.click();
  // F10's: Review before sending. F34's: the menu boxes and the shortcuts.
  const f10 = await openLab('f10', whats);
  assert.equal(await f10.getByRole('switch', { name: LAB_TEXT.sendAs.review, exact: true }).isChecked(), false);
  await axeBoth(f10, 'lab.html#f10');
  const f34 = await openLab('f34', whats);
  assert.equal(await f34.locator('legend').textContent(), LAB_TEXT.contextMenu.showInMenu);
  for (const e of ['page', 'clean', 'link', 'selection', 'image', 'pdf']) {
    assert.equal(await f34.getByRole('checkbox', { name: LAB_TEXT.contextMenu[e], exact: true }).isChecked(), true, e);
  }
  await f34.getByRole('checkbox', { name: LAB_TEXT.contextMenu.image, exact: true }).uncheck();
  for (let i = 0; i < 20 && (await storageGet('settings'))?.labMenus?.image !== false; i++) await f34.waitForTimeout(50);
  assert.equal((await storageGet('settings')).labMenus.image, false, 'unticked: the menu loses it (F34.2)');
  assert.match(await f34.textContent('.lab-shortcuts'), /Send this page to Daylight/);
  await axeBoth(f34, 'lab.html#f34');
  await f34.getByRole('checkbox', { name: LAB_TEXT.contextMenu.image, exact: true }).check();

  // Comfort: nothing clipped at 360 px.
  await storageSet({ settings: { ...(await storageGet('settings')), comfort: true } });
  for (const v of ['whats-in-lab', 'f04', 'f10', 'f34']) {
    const p = await openLab(v, whats);
    await p.waitForFunction(() => document.body.classList.contains('comfort'));
    await axe(p, `lab.html#${v}, Comfort`);
    await assertNotClipped(p, `lab.html#${v}, Comfort`);
  }
  await storageSet({ settings: { lab: true, labNoteShown: true, from: 'W1 Chrome' } });
  await whats.close();
  await unpair();
});

// --- F26 ---------------------------------------------------------------------------------------------------------------

test('F26: Setup check’s lines and buttons; the test article from Waiting for a tap to In your Reader; Copy diagnostics without URLs or codes', { timeout: 150000 }, async () => {
  const day = await newPairing('Setup Daylight');
  let state = 'waiting';
  const lab = await labDaylight(day.pairing, () => state);
  const setup = await openLab('setup');
  assert.equal(await setup.textContent('#setup-h'), LAB_TEXT.setup.title);
  const lines = await setup.locator('.lab-check-line').allTextContents();
  assert.ok(lines.includes('✓ Pairing'));
  assert.ok(lines.includes('✓ Keyboard shortcut'));
  // Chrome's toolbar pin (action.getUserSettings; a new profile has the button unpinned): "! Toolbar button" with Show
  // steps, which shows LAB_TEXT's steps under the line, since no page can open where the pin is (F26.3). The steps stay
  // open for the axe runs below.
  assert.ok(lines.includes('! Toolbar button'), lines.join(' | '));
  const pin = setup.locator('li[data-check="toolbarButton"]');
  const show = pin.getByRole('button', { name: `${LAB_TEXT.setup.showSteps}: ${LAB_TEXT.setup.checks.toolbarButton}`, exact: true });
  assert.equal(await show.textContent(), LAB_TEXT.setup.showSteps);
  assert.equal(await show.getAttribute('aria-expanded'), 'false');
  assert.equal(await pin.locator('.lab-check-steps').isHidden(), true);
  await show.click();
  assert.equal(await show.getAttribute('aria-expanded'), 'true');
  assert.equal(await pin.locator('.lab-check-steps').isVisible(), true);
  assert.equal(await pin.locator('.lab-check-steps').textContent(), 'Click the puzzle piece in Chrome’s toolbar, then the pin next to Send to Daylight.');
  assert.equal(await pin.locator('.lab-check-steps').textContent(), LAB_TEXT.setup.steps.toolbarButton);
  assert.equal(await show.getAttribute('aria-controls'), await pin.locator('.lab-check-steps').getAttribute('id'));
  // Chrome has no Site access line: it reads only the tab the user chose (activeTab) and asks one site at a time where
  // a PDF or the Daylight server needs more, so a fresh install has nothing to fix here and nothing asks for every
  // site (Safari's line: safari.test.mjs).
  assert.equal(await setup.locator('li[data-check="siteAccess"]').count(), 0);
  assert.ok(!lines.some((l) => /Site access/.test(l)), lines.join(' | '));
  assert.equal(await setup.getByText(LAB_TEXT.setup.testFooter).isVisible(), true);
  await setup.getByRole('button', { name: LAB_TEXT.setup.testSend }).click();
  await setup.waitForSelector('#lab-test-progress p');
  await lab.pollOnce();
  await setup.waitForFunction(() => document.querySelector('.lab-test-label')?.textContent === 'Waiting for a tap on your Daylight', null, { timeout: 30000 });
  assert.deepEqual(await setup.locator('#lab-test-progress .lab-check-line').allTextContents(), ['✓ Delivered', 'In your Reader']);
  const [test] = lab.items;
  assert.equal(test.header.title, 'Test article from W1 Chrome');
  assert.equal(test.extras['x-cap'], 'test');
  state = 'reader';
  await lab.labInbox.record(test.header.id, 'reader', Math.floor(Date.now() / 1000) + 300);
  await lab.pollOnce();
  await setup.waitForFunction(() => document.querySelector('#lab-test-progress')?.dataset.reader === '1', null, { timeout: 30000 });
  assert.deepEqual(await setup.locator('#lab-test-progress .lab-check-line').allTextContents(), ['✓ Delivered', '✓ In your Reader']);
  // The activity log and Copy diagnostics.
  await setup.click('.lab-activity summary');
  await setup.waitForFunction(() => document.querySelector('.lab-activity-lines').textContent.length > 0);
  const copies = await recordCopies(setup);
  await setup.getByRole('button', { name: LAB_TEXT.setup.copyDiagnostics }).click();
  await setup.getByText(LAB_TEXT.setup.copied).waitFor();
  const text = await copies();
  assert.match(text, /^Send to Daylight diagnostics\n/);
  for (const secret of ['127.0.0.1', 'daylight.invalid', 'Test article', 'W1 Chrome', 'Setup Daylight', 'http']) assert.ok(!text.includes(secret), `F26.2: ${secret}`);
  assert.deepEqual(await unnamed(setup), []);
  await axeBoth(setup, 'lab.html#setup');
  await shot(setup, 'setup-check');
  await storageSet({ settings: { lab: true, labNoteShown: true, from: 'W1 Chrome', comfort: true } });
  await setup.reload();
  await setup.waitForSelector('body[data-fresh="1"]');
  await setup.click('.lab-activity summary');
  await assertNotClipped(setup, 'lab.html#setup, Comfort');
  await axe(setup, 'lab.html#setup, Comfort');
  await storageSet({ settings: { lab: true, labNoteShown: true, from: 'W1 Chrome' } });
  await setup.close();
  await unpair();
});

// --- F27 on the popup with every W1 piece ----------------------------------------------------------------------------

test('F27: the popup with Lab’s W1 pieces (Send as, Paste and send, the check-in header, the queue, Lab rows): axe, Comfort, nothing clipped', { timeout: 120000 }, async () => {
  await newPairing();
  const now = Date.now();
  const base = { mime: '', size: 0, sent: '', errorCode: '', attempts: 1, slowFails: 0, attemptStarted: 0, attachment: false, error: '', delivered: 0, name: '', url: '' };
  const rows = [
    { ...base, id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', kind: 'page', title: 'A page that is on its way to the Daylight with a long title', url: 'https://example.com/a', status: 'sent', created: now - MIN, lastPublish: now },
    { ...base, id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', kind: 'url', title: 'A link that waits for the network', url: 'https://example.com/b', status: 'failed', errorCode: 'network', created: now - 2 * MIN, lastPublish: now },
    { ...base, id: 'cccccccccccccccccccccccccccccccc', kind: 'file', title: 'A paper', name: 'Paper.pdf', mime: 'application/pdf', status: 'delivered', created: now - 5 * MIN, delivered: now - 4 * MIN },
    { ...base, id: 'dddddddddddddddddddddddddddddddd', kind: 'url', title: 'Already read', url: 'https://example.com/d', status: 'delivered', created: now - 9 * MIN, delivered: now - 8 * MIN },
    { ...base, id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', kind: 'url', title: 'Never picked up', url: 'https://example.org/e', status: 'expired', created: now - 8 * 24 * 60 * MIN },
  ];
  await storageSet({
    outbox: rows,
    'lab/inbox': { android: { lab: 1, app: 'android/1.6.0', caps: ['st', 'tap'], poll: now - 2 * MIN, live: false, at: now - 2 * MIN } },
    'lab/states': { cccccccccccccccccccccccccccccccc: { s: 'waiting', t: Math.floor(now / 1000) }, dddddddddddddddddddddddddddddddd: { s: 'reader', t: Math.floor(now / 1000) } },
  });
  const { page, id } = await openTab(`${site.url}/long-read.html`);
  for (const comfort of [false, true]) {
    await storageSet({ settings: { lab: true, labNoteShown: true, from: 'W1 Chrome', comfort } });
    const popup = await openPopup(id);
    await popup.waitForSelector('#lab-queue li');
    assert.equal(await popup.textContent('#lab-checkin'), 'Your Daylight checked in 2 min ago.');
    assert.deepEqual(await popup.locator('#history li .st').allTextContents(), ['Sent · waiting for your Daylight', 'Waiting for a tap on your Daylight', 'In your Reader ✓', 'Not delivered']);
    assert.equal(await popup.textContent('#lab-queue li .st'), 'Waiting to send');
    assert.deepEqual(await popup.locator('#lab-queue li .acts button').allTextContents(), ['Retry now', 'Cancel'], 'F01.4: v1.1’s Retry now beside Cancel');
    await popup.click('.send-as-btn');
    assert.deepEqual(await unnamed(popup), []);
    await axeBoth(popup, `popup with W1${comfort ? ', Comfort' : ''}`);
    if (comfort) await assertNotClipped(popup, 'popup with W1, Comfort');
    await shot(popup, `popup-w1${comfort ? '-comfort' : ''}`);
    await popup.close();
  }
  await storageSet({ settings: { lab: true, labNoteShown: true, from: 'W1 Chrome' }, outbox: [] });
  await page.close();
  await unpair();
});
