// Lab's Wave 1 in the extension's background (LAB-PLAN 3.3, card X1) in node: the built core.js and lab.js with a fake
// browser API (test/helpers/fake-browser.mjs, whose stand-ins play clean-html.js and Readability: the real ones run in
// Chromium, test/e2e/lab-w1.e2e.mjs), the mock relay, Daylights from daylight-share.js and daylight-lab.js.
//
//   F01  the badge from the most recent row (…, ✓, ⌛, !); states read after delivery; the timeline's data
//   F03  pages go through clean-html.js with x-cap "seen"; Lab off is v1.1's capture
//   F04  the countdown runs in the background: it sends unless Options cancels it, and never runs for Comfort or
//        "Always show Options before sending"
//   F07  offline: the row waits for a connection, the dls-offline alarm sends it once back online, then goes
//   F10  Send as: clean article (x-cap "clean"), the thin-page question, the mode kept per site, Review
//   F11  Send selection (menu, command, Selection mode): an excerpt document with x-cap "excerpt"
//   F16  links and pages lose tracking (x-orig keeps the link as shared); F16's Use switch off sends them as they are
//   F26  the test article, Setup check, the activity log and diagnostics (no URL, title or code)
//   F33  Paste and send's text: a link, or "no link"; F33's Use switch off
//   F34  the menus with Lab on and off, their boxes, the commands and the omnibox
//   6.5 Q5  the Use switches and the feature settings
//
//   node --test test/unit/lab-send.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { built } from '../helpers/built.mjs';
import { fakeBrowser } from '../helpers/fake-browser.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const b = built('chrome');
const core = await b.load('core.js');
const LS = await b.load('lab-send.js');
const labMod = await b.load('lab.js');
const ds = await b.load('daylight-share.js');
const L = await b.load('daylight-lab.js');
const quiet = { warn() {}, log() {} };
const MIN = 60000;
const { LAB_TEXT } = L;
const NORMALISE = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'share', 'vectors', 'normalise.json'), 'utf8'));

async function setup({ target = 'chrome', paired = true, settings = {}, now, countdownMs = 60, popupHoldMs = 200, omnibox = true, commands, popupApi, relay: relayOpts = {} } = {}) {
  const relay = await startMockRelay(relayOpts);
  const fb = fakeBrowser({ os: 'mac', omnibox, popupApi, commands: commands ?? [
    { name: 'send-page', shortcut: 'Alt+Shift+D', description: 'Send this page to Daylight' },
    { name: 'send-selection', shortcut: 'Alt+Shift+S', description: 'Send selection to Daylight' },
    { name: 'send-clean', shortcut: '', description: 'Send clean article to Daylight' },
    { name: 'send-link', shortcut: '', description: 'Send link to Daylight' },
  ] });
  const flags = { online: true, relayDown: false };
  await fb.api.storage.local.set({ settings: { lab: true, ...settings } });
  const fetchFn = async (url, init) => {
    if (flags.relayDown || !flags.online) throw new TypeError('Failed to fetch');
    return fetch(url, init);
  };
  const app = core.createApp({ api: fb.api, target, fetch: fetchFn, log: quiet, now, online: () => flags.online, countdownMs, popupHoldMs });
  fb.api.runtime.onMessage.addListener(app.handleMessage);
  const secret = ds.generateSecret();
  const pairing = { secret, relay: relay.url };
  if (paired) await app.pair({ input: await ds.pairingLink({ secret, relay: relay.url, name: 'Desk Daylight' }) });
  const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage() });
  const msg = async (m) => {
    const r = await fb.api.runtime.sendMessage(m);
    assert.equal(r.ok, true, r.error);
    return r.result;
  };
  const storage = async (k) => (await fb.api.storage.local.get(k))[k];
  return {
    relay, fb, app, flags, secret, pairing, receiver, msg, storage,
    rows: async () => (await storage('outbox')) ?? [],
    receive: async () => (await receiver.pollOnce()).items,
    close: () => relay.close(),
  };
}

/** A Lab Daylight (LabInboxSim) whose clock runs a minute ahead at each poll, past the 30 s between Lab frames. */
async function labDaylight(pairing, { stateFor = null, caps = ['st', 'tap', 'reader-link', 'cap-kind'] } = {}) {
  let skew = 0;
  const now = () => Date.now() + skew;
  const storage = new ds.MemoryStorage();
  const receiver = new ds.Receiver({ pairing, storage, from: 'Daylight' });
  const labInbox = new L.LabInbox({
    storage, relay: new ds.RelayClient({ relay: pairing.relay }), keys: await ds.deriveKeys(pairing.secret),
    info: () => ({ lab: 1, app: 'android/1.6.0', caps, live: false }), from: 'Daylight', now, autoFlushMs: null,
  });
  const sim = new L.LabInboxSim({ receiver, labInbox, stateFor });
  return { receiver, labInbox, items: [], async pollOnce() { skew += MIN; const r = await sim.pollOnce(); this.items.push(...r.items); return r; } };
}

const ARTICLE = '<html><head><title>A long read</title><script>track()</script><script type="application/ld+json">{"@type":"Article"}</script></head>'
  + '<body onload="x()"><p>Words</p><script>more()</script></body></html>';

// --- lab-send.js: the rules as pure functions -----------------------------------------------------------------------

test('lab-send.js: the menus with Lab off (v1.1’s three) and on (six, each with its box), and the commands', () => {
  const off = LS.menuEntries({ lab: false });
  assert.deepEqual(off.map((m) => [m.id, m.title, m.contexts]), [
    ['dls-page', 'Send page to Daylight', ['page', 'frame']],
    ['dls-link', 'Send link to Daylight', ['link']],
    ['dls-pdf-link', 'Send PDF link to Daylight', ['link']],
  ]);
  assert.deepEqual(off[2].targetUrlPatterns, core.PDF_LINK_PATTERNS);
  const on = LS.menuEntries({ lab: true });
  assert.deepEqual(on.map((m) => m.title), ['page', 'clean', 'link', 'selection', 'image', 'pdf'].map((e) => LAB_TEXT.contextMenu[e]));
  assert.deepEqual(on.map((m) => m.contexts), [['page', 'frame'], ['page', 'frame'], ['link'], ['selection'], ['image'], ['link']]);
  assert.deepEqual(LS.menuEntries({ lab: true, menus: { clean: false, image: false } }).map((m) => m.entry), ['page', 'link', 'selection', 'pdf']);
  assert.deepEqual(LS.LAB_COMMANDS, ['send-selection', 'send-clean', 'send-link']);
});

test('lab-send.js: Send as by context (selection, PDF, the site’s mode, Page) and the mode kept for 500 sites', () => {
  assert.equal(LS.defaultMode({ selection: true, pdf: true, url: 'https://a.example/x', remembered: { 'a.example': 'clean' } }), 'selection');
  assert.equal(LS.defaultMode({ pdf: true, url: 'https://a.example/x.pdf', remembered: { 'a.example': 'clean' } }), 'pdf');
  assert.equal(LS.defaultMode({ url: 'https://www.a.example/x', remembered: { 'a.example': 'clean' } }), 'clean');
  assert.equal(LS.defaultMode({ url: 'https://b.example/x', remembered: { 'a.example': 'clean' } }), 'page');
  assert.equal(LS.defaultMode({ url: 'https://a.example/x', remembered: { 'a.example': 'selection' } }), 'page', 'a selection is never kept');
  let map = {};
  for (let i = 0; i < 520; i++) map = LS.rememberMode(map, `https://s${i}.example/`, 'link');
  assert.equal(Object.keys(map).length, 500);
  assert.equal(Object.keys(map)[0], 's519.example', 'the most recent first');
  assert.equal(map['s19.example'], undefined, 'the oldest went');
  map = LS.rememberMode(map, 'https://s100.example/', 'clean');
  assert.deepEqual([Object.keys(map)[0], map['s100.example'], Object.keys(map).length], ['s100.example', 'clean', 500]);
  assert.equal(LS.rememberMode(map, 'https://s1.example/', 'selection'), map, 'a selection changes nothing');
});

test('lab-send.js: the badge mark of the most recent row (F01), and whether states are still worth reading', () => {
  const B = LAB_TEXT.badge;
  const row = (status, extra = {}) => ({ id: 'x', status, errorCode: '', ...extra });
  assert.equal(LS.badgeMark(null), '');
  assert.equal(LS.badgeMark(row('sending')), B.sending);
  assert.equal(LS.badgeMark(row('sent')), B.sending);
  assert.equal(LS.badgeMark(row('failed', { errorCode: 'network' })), B.sending, 'waiting for a connection is on its way');
  assert.equal(LS.badgeMark(row('failed', { errorCode: 'full' })), B.error);
  assert.equal(LS.badgeMark(row('expired')), B.error);
  assert.equal(LS.badgeMark(row('delivered')), B.delivered);
  assert.equal(LS.badgeMark(row('delivered'), { s: 'reader' }), B.delivered);
  assert.equal(LS.badgeMark(row('delivered'), { s: 'waiting' }), B.waiting);
  assert.equal(LS.badgeMark(row('delivered'), { s: 'held' }), B.waiting);
  assert.deepEqual([B.sending, B.delivered, B.error, B.waiting], ['…', '✓', '!', '⌛']);
  const now = Date.now();
  const d = { id: 'd', status: 'delivered', delivered: now - MIN };
  assert.equal(LS.wantsStates([d], {}, now), true);
  assert.equal(LS.wantsStates([d], { d: { s: 'waiting', t: 1 } }, now), true, 'a tap is still to come');
  assert.equal(LS.wantsStates([d], { d: { s: 'reader', t: 1 } }, now), false);
  assert.equal(LS.wantsStates([{ ...d, delivered: now - 49 * 60 * MIN }], {}, now), false, 'past the 48 h digest');
});

test('lab-send.js: the omnibox’s address, the clean article page, who gets no countdown, and the queue', () => {
  assert.equal(LS.typedUrl('example.com/story'), 'https://example.com/story');
  assert.equal(LS.typedUrl('  https://a.example/x?y=1 '), 'https://a.example/x?y=1');
  // Words around an address make it text for smart intake (textLinkItem), never v1.1's findUrl (F16 step 1).
  assert.equal(LS.typedUrl('read https://a.example/x now'), null);
  assert.equal(LS.typedUrl('“https://a.example/q”'), null);
  assert.equal(LS.typedUrl('not an address'), null);
  assert.equal(LS.typedUrl(''), null);
  assert.deepEqual(LS.textLinkItem('read https://a.example/x?utm_source=z now'), { kind: 'url', url: 'https://a.example/x', title: 'read now', extras: { 'x-orig': 'https://a.example/x?utm_source=z' } });
  assert.deepEqual(LS.textLinkItem('He said “https://example.com/q”'), { kind: 'url', url: 'https://example.com/q', title: 'He said' });
  assert.deepEqual(LS.textLinkItem('https://a.example/x?utm_source=z', { lab: true, labUse: { F16: false } }), { kind: 'url', url: 'https://a.example/x?utm_source=z', title: '' });
  assert.equal(LS.textLinkItem('just words'), null);
  assert.equal(LS.cleanArticleHtml({ title: 'A <b>title</b>', url: 'https://a.example/p?q="1"', byline: 'Ann', site: 'A & B', content: '<p>Body</p>' }),
    '<!doctype html><html><head><meta charset="utf-8"><title>A &lt;b&gt;title&lt;/b&gt;</title><base href="https://a.example/p?q=&quot;1&quot;">'
    + '<meta name="dl:capture" content="clean"></head><body><article><h1>A &lt;b&gt;title&lt;/b&gt;</h1><p>Ann · A &amp; B</p><p>Body</p></article></body></html>');
  assert.match(LS.cleanArticleHtml({ title: 'T', content: '<p>B</p>' }), /<article><h1>T<\/h1><p>B<\/p>/, 'no byline line without one');
  assert.equal(LS.noCountdown({}), false);
  assert.equal(LS.noCountdown({ comfort: true }), true);
  assert.equal(LS.noCountdown({ labAlwaysOptions: true }), true);
  assert.equal(LS.clickToSend({ lab: true }), false, 'off by default');
  assert.equal(LS.clickToSend({ lab: true, labClickSend: true }), true);
  assert.equal(LS.clickToSend({ lab: true, labClickSend: true, labUse: { F04: false } }), false, 'F04’s Use switch');
  assert.equal(LS.clickToSend({ lab: false, labClickSend: true }), false);
  assert.deepEqual(LS.queueRows([{ id: 'a', status: 'failed' }, { id: 'b', status: 'sent' }, { id: 'c', status: 'failed' }]).map((r) => r.id), ['a', 'c']);
});

// --- F03, F16: pages and links --------------------------------------------------------------------------------------

test('F03, F16: a page goes through clean-html.js with x-cap "seen", its URL without tracking (x-orig as shared); a link likewise', async () => {
  const s = await setup();
  try {
    const tab = s.fb.addTab({ url: 'https://news.example/story?id=7&utm_source=x&fbclid=abc', title: 'A long read', html: ARTICLE });
    const r = await s.msg({ type: 'sendTab', tabId: tab });
    assert.equal(r.row.status, 'sent');
    assert.deepEqual(s.fb.tabFiles(tab), ['clean-html.js']);
    const [page] = await s.receive();
    assert.equal(page.header.kind, 'page');
    assert.equal(page.header.url, 'https://news.example/story?id=7');
    assert.deepEqual(page.extras, { 'x-cap': 'seen', 'x-orig': 'https://news.example/story?id=7&utm_source=x&fbclid=abc' });
    const html = new TextDecoder().decode(page.content);
    assert.match(html, /^<!doctype html>\n<html data-fake-clean="1">/, 'cleanHtml made it');
    assert.doesNotMatch(html, /track\(\)|more\(\)|onload/);
    assert.match(html, /application\/ld\+json/, 'JSON-LD stays');

    // A link from the right-click menu: the redirect unwrapped and the tracking gone.
    await s.app.onMenu({ menuItemId: core.MENU.link, linkUrl: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fa.example%2Fp%3Futm_medium%3Dsocial', linkText: 'A post' }, { id: tab });
    const [link] = await s.receive();
    assert.deepEqual([link.header.kind, link.header.url, link.header.title], ['url', 'https://a.example/p', 'A post']);
    assert.equal(link.extras['x-orig'], 'https://l.facebook.com/l.php?u=https%3A%2F%2Fa.example%2Fp%3Futm_medium%3Dsocial');

    // F16's Use switch off: links and pages go exactly as shared (2.9.6); the capture still cleans (F03 isn't gated).
    assert.deepEqual(await s.msg({ type: 'labSetUse', feature: 'F16', on: false }), { feature: 'F16', on: false });
    await s.msg({ type: 'sendTab', tabId: tab });
    await s.msg({ type: 'sendTab', tabId: tab, linkOnly: true });
    const [p2, l2] = await s.receive();
    assert.equal(p2.header.url, 'https://news.example/story?id=7&utm_source=x&fbclid=abc');
    assert.deepEqual(p2.extras, { 'x-cap': 'seen' });
    assert.equal(l2.header.url, 'https://news.example/story?id=7&utm_source=x&fbclid=abc');
    assert.deepEqual(l2.extras, {});
  } finally { await s.close(); }
});

test('Lab off: the page is v1.1’s capture, byte for byte, with no x- fields and no capture code loaded', async () => {
  const s = await setup({ settings: { lab: false } });
  try {
    const tab = s.fb.addTab({ url: 'https://news.example/story?utm_source=x', title: 'A long read', html: ARTICLE });
    await s.msg({ type: 'sendTab', tabId: tab, mode: 'clean' });
    assert.deepEqual(s.fb.tabFiles(tab), []);
    const [page] = await s.receive();
    assert.equal(page.header.url, 'https://news.example/story?utm_source=x');
    assert.deepEqual(page.extras, {});
    assert.equal(new TextDecoder().decode(page.content), `<!DOCTYPE html>\n${ARTICLE}`);
    assert.equal(s.fb.badge.text, '✓', 'v1.1’s badge');
  } finally { await s.close(); }
});

// --- F10, F11: Send as and selections -------------------------------------------------------------------------------

test('F10: Clean article (x-cap "clean"); under 150 words the popup asks, Send anyway sends it, a menu sends the page', async () => {
  const s = await setup();
  try {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const tab = s.fb.addTab({
      url: 'https://news.example/long', title: 'Long – News', html: ARTICLE,
      article: { title: 'Long', byline: 'Ann Lee', siteName: 'News', content: '<div><p onclick="x()">Body</p></div>', textContent: long },
    });
    const r = await s.msg({ type: 'sendTab', tabId: tab, mode: 'clean' });
    assert.equal(r.row.status, 'sent');
    assert.deepEqual(s.fb.tabFiles(tab), ['Readability.js', 'clean-html.js']);
    const [item] = await s.receive();
    assert.deepEqual([item.header.kind, item.header.title, item.extras['x-cap']], ['page', 'Long', 'clean']);
    const html = new TextDecoder().decode(item.content);
    assert.match(html, /^<!doctype html><html><head><meta charset="utf-8"><title>Long<\/title><base href="https:\/\/news\.example\/long"><meta name="dl:capture" content="clean"><\/head><body><article><h1>Long<\/h1><p>Ann Lee · News<\/p><div><p>Body<\/p><\/div><\/article><\/body><\/html>$/);
    assert.equal((await s.storage('lab/sendAs'))['news.example'], 'clean', 'kept for the site (F10.3)');
    assert.equal((await s.msg({ type: 'labTabInfo', tabId: tab })).mode, 'clean');

    // Thin: 40 words.
    const thin = s.fb.addTab({ url: 'https://news.example/brief', title: 'Brief', html: ARTICLE, article: { title: 'Brief', content: '<p>x</p>', textContent: Array(40).fill('w').join(' ') } });
    assert.deepEqual(await s.msg({ type: 'sendTab', tabId: thin, mode: 'clean' }), { thin: { n: 40 } });
    assert.deepEqual(await s.receive(), [], 'nothing sent before the answer');
    await s.msg({ type: 'sendTab', tabId: thin, mode: 'clean', force: true });
    assert.equal((await s.receive())[0].extras['x-cap'], 'clean', 'Send anyway');
    await s.msg({ type: 'sendTab', tabId: thin, mode: 'page' });
    assert.equal((await s.receive())[0].extras['x-cap'], 'seen', 'Send full page');
    // A menu can't ask: the full page goes.
    await s.app.onMenu({ menuItemId: core.MENU.clean }, { id: thin, url: 'https://news.example/brief', title: 'Brief' });
    assert.equal((await s.receive())[0].extras['x-cap'], 'seen');

    // F10's Use switch off: the popup's modes are Page and Link only (2.9.6); the menu's clean article still works.
    await s.msg({ type: 'labSetUse', feature: 'F10', on: false });
    assert.equal((await s.msg({ type: 'labTabInfo', tabId: tab })).mode, 'page');
    await s.app.onMenu({ menuItemId: core.MENU.clean }, { id: tab, url: 'https://news.example/long', title: 'Long' });
    assert.equal((await s.receive())[0].extras['x-cap'], 'clean');
    // A clean article the popup didn't ask for by name (the card's countdown) is the page as you see it.
    await s.app.sendTab({ id: tab, url: 'https://news.example/long', title: 'Long' }, { mode: 'clean', thin: 'page' });
    assert.equal((await s.receive())[0].extras['x-cap'], 'seen');
  } finally { await s.close(); }
});

test('F11: Send selection (menu, command, Selection mode) sends one excerpt document with the quote, its link and the date', async () => {
  const s = await setup();
  try {
    const tab = s.fb.addTab({
      url: 'https://news.example/long?utm_source=x', title: 'Long – News', html: ARTICLE,
      selection: { text: 'The quick brown fox jumps over the lazy dog, again and again.', html: '<p>The <b>quick</b> brown fox <script>x()</script>jumps over the lazy dog, again and again.</p>' },
    });
    assert.deepEqual(await s.msg({ type: 'labTabInfo', tabId: tab }), {
      readable: true, selection: true, pdf: false, url: 'https://news.example/long?utm_source=x', site: 'news.example', mode: 'selection',
    });
    const r = await s.app.onMenu({ menuItemId: core.MENU.selection, selectionText: 'ignored when the page answers', frameId: 0 }, { id: tab, url: 'https://news.example/long?utm_source=x', title: 'Long – News' });
    assert.equal(r.excerpt, true);
    const [item] = await s.receive();
    assert.equal(item.header.kind, 'file');
    assert.equal(item.header.mime, 'text/html');
    assert.equal(item.header.name, 'Excerpt - The quick brown fox jumps over.html');
    assert.equal(item.header.title, '“The quick brown fox jumps over the lazy dog, again and again.” · Long – News');
    assert.equal(item.header.url, 'https://news.example/long#:~:text=The%20quick%20brown%20fox%20jumps%20over%20the%20lazy');
    assert.deepEqual(item.extras, { 'x-cap': 'excerpt' });
    const html = new TextDecoder().decode(item.content);
    assert.match(html, /<blockquote><p>The <b>quick<\/b> brown fox jumps over the lazy dog, again and again\.<\/p><\/blockquote>/);
    assert.match(html, /<a href="https:\/\/news\.example\/long">Long – News<\/a> · news\.example · \d+ \w+ \d{4}/);
    assert.doesNotMatch(html, /script/);

    // The command and Selection mode send the same; with nothing selected they send nothing (and the mode, the page).
    await s.app.onCommand('send-selection', { id: tab, url: 'https://news.example/long', title: 'Long' });
    assert.equal((await s.receive())[0].extras['x-cap'], 'excerpt');
    await s.msg({ type: 'sendTab', tabId: tab, mode: 'selection' });
    assert.equal((await s.receive())[0].extras['x-cap'], 'excerpt');
    s.fb.setPage(tab, { selection: null });
    await s.app.onCommand('send-selection', { id: tab, url: 'https://news.example/long', title: 'Long' });
    assert.deepEqual(await s.receive(), []);
    await s.msg({ type: 'sendTab', tabId: tab, mode: 'selection' });
    assert.equal((await s.receive())[0].extras['x-cap'], 'seen', 'nothing selected any more: the page');
    // Never remembered for the site.
    assert.equal((await s.storage('lab/sendAs'))?.['news.example'], undefined);
  } finally { await s.close(); }
});

test('F10 Review: the item waits for review.html; Send sends it with the edited title; Cancel drops it', async () => {
  const s = await setup({ settings: { labReview: true } });
  try {
    const tab = s.fb.addTab({ url: 'https://news.example/r', title: 'To review', html: ARTICLE, text: 'one two three four' });
    const r = await s.msg({ type: 'sendTab', tabId: tab, mode: 'page' });
    assert.ok(r.review);
    assert.deepEqual(s.fb.opened, [`chrome-extension://fake-extension-id/review.html#${r.review}`]);
    assert.deepEqual(await s.receive(), [], 'nothing sent before Send');
    const v = await s.msg({ type: 'labReviewGet', token: r.review });
    assert.deepEqual([v.title, v.words, v.kind], ['To review', 4, 'page']);
    assert.ok(v.size > 0 && v.size < ARTICLE.length + 20, 'the deflated size');
    assert.match(v.html, /data-fake-clean/);
    assert.deepEqual(await s.msg({ type: 'labReviewGet', token: 'other' }), { gone: true });
    const sent = await s.msg({ type: 'labReviewSend', token: r.review, title: '  Edited   title ' });
    assert.equal(sent.row.title, 'Edited title');
    const [item] = await s.receive();
    assert.deepEqual([item.header.title, item.extras['x-cap']], ['Edited title', 'seen']);
    assert.deepEqual(await s.msg({ type: 'labReviewSend', token: r.review, title: 'again' }), { gone: true }, 'once');
    // Cancel.
    const again = await s.msg({ type: 'sendTab', tabId: tab, mode: 'page' });
    await s.msg({ type: 'labReviewCancel', token: again.review });
    assert.equal(await s.storage('lab/review'), undefined);
    // A link isn't reviewed; with Review off nothing is.
    assert.ok((await s.msg({ type: 'sendTab', tabId: tab, linkOnly: true })).row);
    await s.msg({ type: 'labSetOption', key: 'labReview', value: false });
    assert.ok((await s.msg({ type: 'sendTab', tabId: tab, mode: 'page' })).row);
  } finally { await s.close(); }
});

test('2.9.6: F10’s Use switch off keeps F11’s selection: the tab says text is selected, Send as excerpt sends it, the page goes as you see it', async () => {
  const s = await setup({ settings: { labUse: { F10: false } } });
  try {
    const tab = s.fb.addTab({
      url: 'https://news.example/sel', title: 'Sel – News', html: ARTICLE,
      selection: { text: 'A passage worth keeping, from the middle of the piece.', html: '<p>A passage worth keeping, from the middle of the piece.</p>' },
    });
    assert.deepEqual(await s.msg({ type: 'labTabInfo', tabId: tab }), {
      readable: true, selection: true, pdf: false, url: 'https://news.example/sel', site: 'news.example', mode: 'page',
    }, 'the selection is F11’s; the mode stays the page (no Send as switching by itself)');
    // The popup's "Send as excerpt" (Selection mode by name).
    const r = await s.msg({ type: 'sendTab', tabId: tab, mode: 'selection' });
    assert.equal(r.excerpt, true);
    let [item] = await s.receive();
    assert.deepEqual([item.header.kind, item.header.mime, item.extras['x-cap']], ['file', 'text/html', 'excerpt']);
    assert.equal(item.header.title, '“A passage worth keeping, from the middle of the piece.” · Sel – News');
    // Send this page: the page as you see it (F03), not the selection; and no mode kept for the site.
    await s.msg({ type: 'sendTab', tabId: tab, mode: 'page' });
    [item] = await s.receive();
    assert.deepEqual([item.header.kind, item.extras['x-cap']], ['page', 'seen']);
    // The menu and the command are F11's too.
    await s.app.onMenu({ menuItemId: core.MENU.selection, frameId: 0 }, { id: tab, url: 'https://news.example/sel', title: 'Sel – News' });
    await s.app.onCommand('send-selection', { id: tab, url: 'https://news.example/sel', title: 'Sel – News' });
    assert.deepEqual((await s.receive()).map((i) => i.extras['x-cap']), ['excerpt', 'excerpt']);
    assert.equal((await s.storage('lab/sendAs'))?.['news.example'], undefined);
    // Lab off: nothing of the kind.
    await s.msg({ type: 'setLab', lab: false });
    assert.equal((await s.msg({ type: 'labTabInfo', tabId: tab })).selection, false);
  } finally { await s.close(); }
});

// --- F04: the countdown ---------------------------------------------------------------------------------------------

test('F04: the background sends after the countdown, also with the popup gone; Options cancels it; no countdown for those who need more time', async () => {
  const s = await setup({ settings: { labClickSend: true }, countdownMs: 80 });
  try {
    const tab = s.fb.addTab({ url: 'https://news.example/c', title: 'Countdown', html: ARTICLE });
    const t0 = Date.now();
    const r = await s.msg({ type: 'labScheduleSend', tabId: tab, mode: 'page' });
    assert.ok(Date.now() - t0 >= 70, 'after the countdown');
    assert.equal(r.row.status, 'sent');
    assert.equal((await s.receive())[0].extras['x-cap'], 'seen');
    // Options: cancelled, nothing sent.
    const p = s.msg({ type: 'labScheduleSend', tabId: tab, mode: 'link' });
    assert.deepEqual(await s.msg({ type: 'labCancelScheduled', tabId: tab }), { cancelled: true });
    assert.deepEqual(await p, { cancelled: true });
    await new Promise((res) => setTimeout(res, 120));
    assert.deepEqual(await s.receive(), []);
    assert.deepEqual(await s.msg({ type: 'labCancelScheduled', tabId: tab }), { cancelled: false });
    // Comfort, or "Always show Options before sending": no countdown at all (WCAG 2.2.1); and only with the setting on.
    for (const settings of [{ comfort: true }, { labAlwaysOptions: true }, { labClickSend: false }, { labUse: { F04: false } }]) {
      await s.fb.api.storage.local.set({ settings: { lab: true, labClickSend: true, ...settings } });
      assert.deepEqual(await s.msg({ type: 'labScheduleSend', tabId: tab, mode: 'page' }), { cancelled: true, refused: true }, JSON.stringify(settings));
    }
    await new Promise((res) => setTimeout(res, 120));
    assert.deepEqual(await s.receive(), []);
  } finally { await s.close(); }
});

for (const popupApi of ['contexts', 'views']) {
  test(`F04: a PDF that needs its site’s permission: the open popup gets {needsPermission} to ask; with the popup gone its link goes, never nothing (${popupApi === 'contexts' ? 'Chrome: runtime.getContexts' : 'Safari: extension.getViews'})`, async () => {
    const s = await setup({ settings: { labClickSend: true }, countdownMs: 40, popupApi });
    try {
      // A PDF the tab can't read and the extension can't fetch without the site's permission (a closed port here).
      const url = 'http://127.0.0.1:9/files/locked.pdf';
      const tab = s.fb.addTab({ url, title: 'Locked paper', scriptable: false });
      // The popup is open: the answer is for its Allow button, and the popup takes it; nothing went yet.
      s.fb.popupOpen(true);
      const ask = await s.msg({ type: 'labScheduleSend', tabId: tab, mode: 'page' });
      assert.deepEqual(ask.needsPermission, { origins: ['http://127.0.0.1/*'] });
      assert.ok(ask.token);
      assert.deepEqual(await s.msg({ type: 'labHoldPdf', token: ask.token }), { held: true });
      await new Promise((res) => setTimeout(res, 300)); // past the hold time: the popup has it, so nothing goes by itself
      assert.deepEqual(await s.receive(), []);
      // The popup's "Send the link" (or a refused permission): the link, with v1.1's sentence.
      const viaPopup = await s.msg({ type: 'sendPdf', url: ask.url, title: ask.title, token: ask.token });
      assert.equal(viaPopup.row.kind, 'url');
      // The popup closed before the countdown ended: nobody can answer, so the link goes now with that sentence. The
      // pairing page open in a tab (popup.html?standalone=1, from openPairing or Setup check) is not the card's popup.
      s.fb.pageOpen('popup.html?standalone=1');
      s.fb.popupOpen(false);
      const r = await s.msg({ type: 'labScheduleSend', tabId: tab, mode: 'page' });
      assert.equal(r.row.kind, 'url');
      assert.equal(r.row.url, url);
      assert.equal(r.note, 'Without access to the site the PDF can’t be downloaded, so its link was sent.');
      const items = await s.receive();
      assert.deepEqual(items.map((i) => [i.header.kind, i.header.url]), [['url', url], ['url', url]]);
      // The popup's answer counts once: a second Allow or Send the link for the same question sends nothing more.
      assert.deepEqual(await s.msg({ type: 'sendPdf', url, title: 'Locked paper', token: ask.token }), { handled: true });
    } finally { await s.close(); }
  });
}

test('F04: a PDF question no popup takes within the hold time (the card’s popup closed, another one is open) goes as its link', async () => {
  const s = await setup({ settings: { labClickSend: true }, countdownMs: 40, popupHoldMs: 150 });
  try {
    const url = 'http://127.0.0.1:9/files/locked.pdf';
    const tab = s.fb.addTab({ url, title: 'Locked paper', scriptable: false });
    // A toolbar popup is open (in another window, say), but the card's popup that would get the answer closed.
    s.fb.popupOpen(true);
    const lost = await s.msg({ type: 'labScheduleSend', tabId: tab, mode: 'page' });
    assert.ok(lost.needsPermission);
    assert.deepEqual(await s.receive(), [], 'nothing before the hold time');
    await new Promise((res) => setTimeout(res, 400));
    const items = await s.receive();
    assert.deepEqual(items.map((i) => [i.header.kind, i.header.url]), [['url', url]]);
    const row = (await s.rows()).find((x) => x.url === url);
    assert.equal(row.note, 'Without access to the site the PDF can’t be downloaded, so its link was sent.');
    // A popup that comes too late is told so, and its Allow or Send the link sends nothing more.
    assert.deepEqual(await s.msg({ type: 'labHoldPdf', token: lost.token }), { handled: true });
    assert.deepEqual(await s.msg({ type: 'sendPdf', url, title: 'Locked paper', token: lost.token }), { handled: true });
    await new Promise((res) => setTimeout(res, 300));
    assert.deepEqual(await s.receive(), []);
  } finally { await s.close(); }
});

test('F04: where an open popup can’t be told (neither getContexts nor getViews), the link goes rather than nothing', async () => {
  const s = await setup({ settings: { labClickSend: true }, countdownMs: 40, popupApi: null });
  try {
    const url = 'http://127.0.0.1:9/files/locked.pdf';
    const tab = s.fb.addTab({ url, title: 'Locked paper', scriptable: false });
    const r = await s.msg({ type: 'labScheduleSend', tabId: tab, mode: 'page' });
    assert.deepEqual([r.row.kind, r.row.url], ['url', url]);
  } finally { await s.close(); }
});

// --- F07: offline ---------------------------------------------------------------------------------------------------

test('F07: shared offline, the row waits for a connection; the dls-offline alarm sends it once back online, then goes', async () => {
  let clock = Date.now();
  const s = await setup({ now: () => clock });
  try {
    s.flags.online = false;
    const r = await s.app.sendUrl('https://example.com/offline', 'Offline');
    assert.deepEqual([r.row.status, r.row.errorCode, r.row.attempts], ['failed', 'network', 0]);
    assert.ok(s.fb.alarms.get(core.ALARM_OFFLINE), 'the alarm exists while a row waits');
    assert.equal(s.fb.alarms.get(core.ALARM_OFFLINE).periodInMinutes, 1);
    const ctx = { lab: true, online: false };
    assert.equal(L.describeLabRow(r.row, clock, ctx).label, 'Waiting for connection');
    assert.equal(s.fb.badge.text, '…', 'on its way');
    assert.deepEqual(await s.app.offlinePass(), [], 'still offline: nothing');
    // Back online: the next alarm sends it, at most one pass every 3 minutes.
    s.flags.online = true;
    clock += MIN;
    const sent = await s.app.offlinePass();
    assert.deepEqual(sent.map((x) => [x.id, x.status]), [[r.row.id, 'sent']]);
    assert.equal(s.fb.alarms.get(core.ALARM_OFFLINE), undefined, 'gone with nothing left to wait for');
    assert.equal((await s.receive())[0].header.url, 'https://example.com/offline');
    const log = (await s.msg({ type: 'labActivity' })).lines;
    assert.ok(log.some((l) => / defer [0-9a-f]{8} url failed /.test(l)));
    assert.ok(log.some((l) => / flush [0-9a-f]{8} url sent /.test(l)));

    // Two queued while offline, back online: passes 3 minutes apart (a pass of 1 frame here).
    s.flags.online = false;
    await s.app.sendUrl('https://example.com/a', 'A');
    await s.app.sendUrl('https://example.com/b', 'B');
    s.flags.online = true;
    clock += 3 * MIN;
    const first = await s.app.offlinePass();
    assert.equal(first.length, 2, 'both in one pass (2 frames, under 30)');
    s.flags.online = false;
    await s.app.sendUrl('https://example.com/c', 'C');
    s.flags.online = true;
    clock += MIN;
    assert.deepEqual(await s.app.offlinePass(), [], 'within 3 minutes of the last pass');
    clock += 3 * MIN;
    assert.equal((await s.app.offlinePass()).length, 1);

    // The relay down while this device is online: v1.1's back-off sends it, not the alarm.
    s.flags.relayDown = true;
    const down = (await s.app.sendUrl('https://example.com/down', 'Down')).row;
    assert.deepEqual([down.status, down.errorCode, down.attempts], ['failed', 'network', 1]);
    assert.equal(L.describeLabRow(down, clock, { lab: true, online: true }).label, 'Waiting to send');
    clock += 4 * MIN;
    s.flags.relayDown = false;
    assert.deepEqual(await s.app.offlinePass(), []);
    // Lab off: the alarm goes, and v1.1's back-off sends what waits (F00.4).
    await s.msg({ type: 'setLab', lab: false });
    assert.equal(s.fb.alarms.get(core.ALARM_OFFLINE), undefined);
  } finally { await s.close(); }
});

// --- F01: the badge and the states ----------------------------------------------------------------------------------

test('F01: the badge follows the most recent row (…, ✓, ⌛, !); a tick reads the ack topic for a delivered row’s state', async () => {
  const s = await setup();
  try {
    const day = await labDaylight(s.pairing, { stateFor: (h) => (h.kind === 'file' ? 'waiting' : 'reader') });
    const link = (await s.app.sendUrl('https://example.com/r', 'R')).row;
    assert.equal(s.fb.badge.text, '…');
    await day.pollOnce();
    await s.app.tick();
    let rows = await s.rows();
    assert.equal(rows[0].status, 'delivered');
    assert.equal((await s.app.lab.ledger.state(link.id))?.s, 'reader');
    assert.equal(s.fb.badge.text, '✓');
    // A PDF that waits for a tap: ⌛ once the state comes, after delivery (the tick reads it: wantsStates).
    const tab = s.fb.addTab({ url: 'https://example.com/doc.html', title: 'Doc', html: '<p>doc</p>' });
    await s.msg({ type: 'sendTab', tabId: tab, mode: 'selection' }); // no selection: the page; a page goes as `reader`
    await day.pollOnce();
    await s.app.tick();
    assert.equal(s.fb.badge.text, '✓');
    const file = (await s.app.sendPdf({ url: 'https://example.com/none.pdf' }).catch(() => null));
    assert.ok(file, 'a PDF the extension can’t read goes as its link');
    // Relay trouble: !
    const prev = s.fb.badge.history.length;
    await s.relay.close();
    const failed = (await s.app.sendUrl('https://example.com/x', 'X')).row;
    assert.equal(failed.status, 'failed');
    assert.equal(s.fb.badge.history.slice(prev).at(-1), '…', 'a network failure while online is v1.1’s Waiting to send, its mark on its way');
    rows = await s.rows();
    assert.equal(LS.badgeMark(rows[0], null), '…');
  } finally { await s.close().catch(() => {}); }
});

test('F01: a document waiting for a tap shows ⌛; its row reads "Waiting for a tap on your Daylight", then "Handed to the Reader"', async () => {
  const s = await setup();
  try {
    let state = 'waiting';
    const day = await labDaylight(s.pairing, { stateFor: () => state });
    const tab = s.fb.addTab({ url: 'https://example.com/a', title: 'Article', html: ARTICLE, selection: { text: 'A short passage to keep.', html: '' } });
    const r = await s.msg({ type: 'sendTab', tabId: tab, mode: 'selection' });
    await day.pollOnce();
    await s.app.tick();
    assert.equal(s.fb.badge.text, '⌛');
    const t = await s.msg({ type: 'labTimeline' });
    assert.equal(t.inboxLab, true);
    assert.deepEqual(t.caps, ['cap-kind', 'reader-link', 'st', 'tap']);
    assert.equal(t.checkedInText, 'Your Daylight checked in just now.');
    let row = (await s.rows()).find((x) => x.id === r.row.id);
    const ctx = (tl) => ({ lab: true, inboxLab: tl.inboxLab, hasCap: tl.caps, state: tl.states[row.id], online: true });
    assert.equal(L.describeLabRow(row, Date.now(), ctx(t)).label, 'Waiting for a tap on your Daylight');
    // The tap: handed (a document).
    state = 'handed';
    await day.labInbox.record(r.row.id, 'handed', Math.floor(Date.now() / 1000) + 120);
    await day.pollOnce();
    await s.app.tick();
    row = (await s.rows()).find((x) => x.id === r.row.id);
    const t2 = await s.msg({ type: 'labTimeline' });
    const d = L.describeLabRow(row, Date.now(), ctx(t2));
    assert.deepEqual([d.label, d.sentence, d.final], ['Handed to the Reader', 'Your Daylight passed it to the Reader. The Reader doesn’t confirm documents yet.', true]);
    assert.equal(s.fb.badge.text, '✓');
  } finally { await s.close(); }
});

test('F01: a send that fails or makes no row shows "!" (as v1.1), never the ✓ of an older delivered row; a question shows the most recent row’s mark', async () => {
  const s = await setup();
  try {
    const day = await labDaylight(s.pairing);
    await s.app.sendUrl('https://example.com/first', 'First');
    await day.pollOnce();
    await s.app.tick();
    assert.equal((await s.rows())[0].status, 'delivered');
    assert.equal(s.fb.badge.text, '✓');
    const settings = s.fb.addTab({ url: 'chrome://settings', title: 'Settings', scriptable: false });
    const local = s.fb.addTab({ url: 'file:///Users/me/notes.html', title: 'notes.html', scriptable: false }); // no file access
    const plain = s.fb.addTab({ url: 'https://news.example/plain', title: 'Plain', html: ARTICLE }); // nothing selected
    const failed = [
      ['Alt+Shift+D on chrome://settings', () => s.app.onCommand('send-page', { id: settings, url: 'chrome://settings', title: 'Settings' })],
      ['the popup’s Send this page on chrome://settings', () => s.fb.api.runtime.sendMessage({ type: 'sendTab', tabId: settings })],
      ['right-click Send page on a file:// page without file access', () => s.app.onMenu({ menuItemId: core.MENU.page }, { id: local, url: 'file:///Users/me/notes.html', title: 'notes.html' })],
      ['Paste and send with no link', () => s.msg({ type: 'labSendCopied', text: 'Remember the milk' })],
      ['Send selection with nothing selected', () => s.app.onCommand('send-selection', { id: plain, url: 'https://news.example/plain', title: 'Plain' })],
    ];
    for (const [what, act] of failed) {
      await s.app.labBadge({ force: true });
      assert.equal(s.fb.badge.text, '✓', `${what}: the delivered row’s mark before`);
      const before = s.fb.badge.history.length;
      const rowsBefore = (await s.rows()).length;
      await act();
      assert.equal((await s.rows()).length, rowsBefore, `${what}: no row`);
      assert.deepEqual(s.fb.badge.history.slice(before), ['…', '!'], what);
    }
    // A question isn't a failure: the thin-page one leaves the most recent row's mark.
    const thin = s.fb.addTab({ url: 'https://news.example/brief', title: 'Brief', html: ARTICLE, article: { title: 'Brief', content: '<p>x</p>', textContent: Array(40).fill('w').join(' ') } });
    await s.app.labBadge({ force: true });
    const before = s.fb.badge.history.length;
    assert.deepEqual(await s.msg({ type: 'sendTab', tabId: thin, mode: 'clean' }), { thin: { n: 40 } });
    assert.deepEqual(s.fb.badge.history.slice(before), ['…', '✓']);
    // A send that makes a row shows that row's mark: on its way.
    await s.msg({ type: 'sendTab', tabId: plain, mode: 'link' });
    assert.equal(s.fb.badge.text, '…');
  } finally { await s.close(); }
});

// --- F34: menus, commands, omnibox ------------------------------------------------------------------------------------

test('F34: the menus follow Lab and their boxes; the commands and the omnibox send with Lab on and do nothing (or say so) with it off', async () => {
  const s = await setup();
  try {
    await s.app.setupMenus();
    assert.deepEqual([...s.fb.menus.keys()], ['dls-page', 'dls-clean', 'dls-link', 'dls-selection', 'dls-image', 'dls-pdf-link']);
    assert.equal(s.fb.menus.get('dls-image').title, 'Send this image’s page to Daylight');
    const v = await s.msg({ type: 'labSetOption', key: 'labMenus.image', value: false });
    assert.equal(v.menus.image, false);
    assert.deepEqual([...s.fb.menus.keys()], ['dls-page', 'dls-clean', 'dls-link', 'dls-selection', 'dls-pdf-link'], 'unticked: gone from the menu (F34.2)');
    await assert.rejects(s.msg({ type: 'labSetOption', key: 'labMenus.nope', value: false }).catch((e) => { throw e; }), /unknown Lab setting/).catch(() => {});
    const bad = await s.fb.api.runtime.sendMessage({ type: 'labSetOption', key: 'lab', value: false });
    assert.equal(bad.ok, false, 'only Lab’s feature settings');

    // Each entry sends its kind (F34.1).
    const tab = s.fb.addTab({ url: 'https://news.example/p', title: 'P', html: ARTICLE, article: { title: 'P', content: '<p>x</p>', textContent: Array(200).fill('w').join(' ') }, selection: { text: 'Quoted words here.', html: '' } });
    const t = { id: tab, url: 'https://news.example/p', title: 'P' };
    await s.app.onMenu({ menuItemId: 'dls-page' }, t);
    await s.app.onMenu({ menuItemId: 'dls-clean' }, t);
    await s.app.onMenu({ menuItemId: 'dls-link', linkUrl: 'https://news.example/next', linkText: 'Next' }, t);
    await s.app.onMenu({ menuItemId: 'dls-selection', selectionText: 'Quoted words here.' }, t);
    await s.app.onMenu({ menuItemId: 'dls-image', srcUrl: 'https://news.example/i.png' }, t);
    const got = await s.receive();
    assert.deepEqual(got.map((i) => [i.header.kind, i.extras['x-cap'] ?? null]), [['page', 'seen'], ['page', 'clean'], ['url', null], ['file', 'excerpt'], ['page', 'seen']]);
    assert.equal(got[4].header.url, 'https://news.example/p', 'the image’s page, not the image');

    // Commands.
    await s.app.onCommand('send-link', t);
    await s.app.onCommand('send-clean', t);
    assert.deepEqual((await s.receive()).map((i) => [i.header.kind, i.extras['x-cap'] ?? null]), [['url', null], ['page', 'clean']]);
    // The omnibox: "dl example.com/story".
    assert.ok((await s.app.onOmnibox('example.com/story?utm_campaign=z')).row);
    const [o] = await s.receive();
    assert.deepEqual([o.header.kind, o.header.url, o.extras['x-orig']], ['url', 'https://example.com/story', 'https://example.com/story?utm_campaign=z']);
    assert.deepEqual(await s.app.onOmnibox('not a link'), { noLink: true });
    assert.equal(s.fb.badge.text, '!');
    assert.deepEqual(await s.receive(), []);

    // F34's view lists the commands as the browser does.
    const fv = await s.msg({ type: 'labFeatureView' });
    assert.deepEqual(fv.commands.map((c) => [c.name, c.shortcut]), [['send-page', 'Alt+Shift+D'], ['send-selection', 'Alt+Shift+S'], ['send-clean', ''], ['send-link', '']]);
    assert.equal(fv.shortcutsPage, true);

    // Lab off: v1.1's menus, the Lab commands do nothing, the omnibox opens lab.html with the Lab-off sentence.
    await s.msg({ type: 'setLab', lab: false });
    assert.deepEqual([...s.fb.menus.keys()], ['dls-page', 'dls-link', 'dls-pdf-link']);
    assert.equal(await s.app.onCommand('send-clean', t), undefined);
    assert.equal(await s.app.onMenu({ menuItemId: 'dls-clean' }, t), undefined);
    assert.deepEqual(await s.app.onOmnibox('example.com'), { labOff: true });
    assert.equal(s.fb.opened.at(-1), 'chrome-extension://fake-extension-id/lab.html#lab-off');
    assert.deepEqual(await s.receive(), []);
    // The page from the menu is v1.1's.
    await s.app.onMenu({ menuItemId: 'dls-page' }, t);
    assert.deepEqual((await s.receive())[0].extras, {});
  } finally { await s.close(); }
});

// --- F33, F26, 6.5 Q5 ---------------------------------------------------------------------------------------------

test('F33: Paste and send sends the link in copied text, cleaned; no link says so; F33’s Use switch off sends nothing', async () => {
  const s = await setup();
  try {
    const r = await s.msg({ type: 'labSendCopied', text: 'Look at this https://www.youtube.com/watch?v=abc&si=track' });
    assert.equal(r.row.kind, 'url');
    const [item] = await s.receive();
    assert.deepEqual([item.header.url, item.header.title, item.extras['x-orig']], ['https://www.youtube.com/watch?v=abc', 'Look at this', 'https://www.youtube.com/watch?v=abc&si=track']);
    assert.deepEqual(await s.msg({ type: 'labSendCopied', text: 'just words' }), { noLink: true });
    await s.msg({ type: 'labSetUse', feature: 'F33', on: false });
    assert.deepEqual(await s.msg({ type: 'labSendCopied', text: 'https://example.com/x' }), { noLink: true });
    assert.deepEqual(await s.receive(), []);
  } finally { await s.close(); }
});

test('F16: the omnibox and Paste and send give shared text whole to normaliseShare: every text-only case of normalise.json', async () => {
  // The text-only cases: shared text with no URL of its own, which is all these two entry points carry. They have no
  // subject and no selection (a selection is the menu's, F11), so for a case with either the vector pins the URL and
  // x-orig, and the title is the text's own.
  const cases = NORMALISE.cases.filter((c) => c.input.url === undefined && c.input.text !== undefined);
  assert.equal(cases.length, 39);
  const s = await setup();
  try {
    let links = 0;
    for (const c of cases) {
      const i = c.input;
      await s.msg({ type: 'labSetUse', feature: 'F16', on: i.clean !== false });
      for (const [via, send] of [
        ['omnibox', () => s.app.onOmnibox(i.text)],
        ['Paste and send', () => s.msg({ type: 'labSendCopied', text: i.text })],
      ]) {
        const what = `${c.name} (${via})`;
        const r = await send();
        if (!c.expect.url) {
          assert.deepEqual(r, { noLink: true }, what);
          assert.deepEqual(await s.receive(), [], what);
          continue;
        }
        assert.ok(r?.row, what);
        const [item] = await s.receive();
        assert.equal(item.header.kind, 'url', what);
        assert.equal(item.header.url, c.expect.url, what);
        assert.deepEqual(item.extras ?? {}, c.expect.orig ? { 'x-orig': c.expect.orig } : {}, what);
        if (!i.subject && !i.source) assert.equal(item.header.title ?? '', c.expect.title && c.expect.title !== c.expect.url ? c.expect.title : '', what);
        links++;
      }
    }
    assert.equal(links, 2 * cases.filter((c) => c.expect.url).length);
    // B1's four: the parentheses, curly quotes, single curly quotes and », and brackets come out as the vectors say.
    for (const [text, url] of [
      ['See (https://en.wikipedia.org/wiki/Foo_(bar)).', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
      ['He said “https://example.com/q”', 'https://example.com/q'],
      ['Link: ‘https://example.com/s’ and «https://example.com/t»', 'https://example.com/s'],
      ['[https://example.com/x]', 'https://example.com/x'],
    ]) assert.equal(NORMALISE.cases.find((c) => c.input.text === text && !c.input.url)?.expect.url, url, text);
  } finally { await s.close(); }
});

test('6.5 Q5: the Use switches (F04, F10, F16, F33) are on by default, kept in settings.labUse; F03 and others have none', async () => {
  const s = await setup();
  try {
    assert.deepEqual(labMod.EXT_USE_FEATURES, ['F04', 'F10', 'F16', 'F33']);
    let p = await s.msg({ type: 'labPopup' });
    assert.deepEqual(p.use, { F04: true, F10: true, F16: true, F33: true });
    assert.deepEqual([p.clickSend, p.alwaysOptions, p.review], [false, false, false], 'the feature settings are off by default');
    assert.deepEqual(await s.msg({ type: 'labSetUse', feature: 'F03', on: false }), { feature: 'F03', on: false });
    assert.equal((await s.storage('settings')).labUse?.F03, undefined, 'no switch to keep');
    await s.msg({ type: 'labSetUse', feature: 'F04', on: false });
    await s.msg({ type: 'labSetOption', key: 'labClickSend', value: true });
    p = await s.msg({ type: 'labPopup' });
    assert.deepEqual([p.use.F04, p.clickSend], [false, true]);
    const st = await s.storage('settings');
    assert.deepEqual([st.labUse, st.labClickSend], [{ F04: false }, true]);
    // The one Lab switch still turns all of Lab off, and keeps the feature settings (1.3).
    await s.msg({ type: 'setLab', lab: false });
    assert.deepEqual(await s.msg({ type: 'labPopup' }), { lab: false });
    await s.msg({ type: 'setLab', lab: true });
    assert.deepEqual((await s.msg({ type: 'labPopup' })).use.F04, false);
  } finally { await s.close(); }
});

test('F26: Setup check’s lines and buttons, the test article along the timeline, the activity log and diagnostics without URLs or codes', async () => {
  const s = await setup();
  try {
    let c = await s.msg({ type: 'labChecks' });
    // Chrome has no Site access line: the tab the user chose is all it reads (activeTab), and a PDF's site or the
    // Daylight server's is asked for one at a time when it's needed. Nothing here asks for every site (Safari: below).
    assert.deepEqual(c.checks.map((x) => [x.id, x.ok, x.line, x.button]), [
      ['paired', true, '✓ Pairing', null],
      ['shortcut', true, '✓ Keyboard shortcut', null],
    ]);
    assert.ok(c.checks.every((x) => !x.origins));
    assert.equal(c.test, null);
    // Chrome's toolbar pin (action.getUserSettings's isOnToolbar; the fake has no such call until pinned()). Unpinned,
    // its button is Show steps with LAB_TEXT's steps, since no page can open where the pin is (F26.3, LAB-PLAN 1.6's
    // "Copy added Oct 22"); pinned, the line is met and has no button.
    s.fb.pinned(false);
    c = await s.msg({ type: 'labChecks' });
    assert.deepEqual(c.checks.map((x) => x.id), ['paired', 'toolbarButton', 'shortcut']);
    assert.deepEqual(c.checks[1], {
      id: 'toolbarButton', name: 'Toolbar button', ok: false, line: '! Toolbar button', button: 'Show steps', action: 'steps',
      steps: 'Click the puzzle piece in Chrome’s toolbar, then the pin next to Send to Daylight.',
    });
    assert.deepEqual([c.checks[1].button, c.checks[1].steps], [LAB_TEXT.setup.showSteps, LAB_TEXT.setup.steps.toolbarButton]);
    s.fb.pinned(true);
    c = await s.msg({ type: 'labChecks' });
    assert.deepEqual(c.checks[1], { id: 'toolbarButton', name: 'Toolbar button', ok: true, line: '✓ Toolbar button', button: null, action: null, steps: null });
    // The test article: a page of about 400 words at daylight.invalid, x-cap "test".
    const day = await labDaylight(s.pairing, { stateFor: () => 'waiting' });
    const sent = await s.msg({ type: 'labTestSend' });
    c = await s.msg({ type: 'labChecks' });
    assert.deepEqual(c.test.lines, ['Delivered', 'In your Reader']);
    assert.equal(c.test.label, 'Sent · waiting for your Daylight');
    await day.pollOnce();
    const [item] = day.items;
    assert.equal(item.header.url, `https://daylight.invalid/test/${sent.row.id}`);
    assert.equal(item.header.title, 'Test article from Chrome on Mac');
    assert.deepEqual(item.extras, { 'x-cap': 'test' });
    await s.msg({ type: 'labCheckAcks' });
    c = await s.msg({ type: 'labChecks' });
    assert.deepEqual([c.test.delivered, c.test.reader, c.test.lines, c.test.label], [true, false, ['✓ Delivered', 'In your Reader'], 'Waiting for a tap on your Daylight']);
    await day.labInbox.record(sent.row.id, 'reader', Math.floor(Date.now() / 1000) + 120);
    await day.pollOnce();
    await s.msg({ type: 'labCheckAcks' });
    c = await s.msg({ type: 'labChecks' });
    assert.deepEqual([c.test.reader, c.test.lines], [true, ['✓ Delivered', '✓ In your Reader']]);

    // Not paired: the pairing line with its button.
    await s.app.sendUrl('https://secret.example/private?token=abc', 'A private title');
    const diag = (await s.msg({ type: 'labDiagnostics' })).text;
    assert.match(diag, /^Send to Daylight diagnostics\nApp: Send to Daylight 1\.2\.3 \(chrome\)\nLab: on\nLab caps from your Daylight: cap-kind, reader-link, st, tap\n/);
    assert.match(diag, /\nRelay: custom relay\n/);
    assert.match(diag, / send [0-9a-f]{8} url sent /);
    for (const secret of ['secret.example', 'private', 'A private title', 'daylight.invalid', 'Test article', s.relay.url]) assert.ok(!diag.includes(secret), secret);
    const log = (await s.msg({ type: 'labActivity' })).lines;
    assert.ok(log.length >= 3);
    assert.ok(log.every((l) => !l.includes('example')));
    await s.app.unpair();
    c = await s.msg({ type: 'labChecks' });
    assert.deepEqual(c.checks[0], { id: 'paired', name: 'Pairing', ok: false, line: '! Pairing', button: 'Open setting', action: 'pair', steps: null });
    // Lab off: no Setup check.
    await s.msg({ type: 'setLab', lab: false });
    assert.deepEqual(await s.msg({ type: 'labChecks' }), { lab: false });
  } finally { await s.close(); }
});

test('F26: the activity log shows the HTTP status of a row’s last failed publish (413, 429), from a send, a retry and the re-send pass', async () => {
  let fail = null; // the mock relay's answer to the next publishes (failPublish), or null to take them
  let clock = Date.now();
  const s = await setup({ now: () => clock, relay: { failPublish: () => fail } });
  try {
    const line = (l) => l.split(' ').slice(1).join(' '); // the activity line without its time
    fail = 429;
    const r = await s.app.sendUrl('https://example.com/limited', 'Limited');
    const id8 = r.row.id.slice(0, 8);
    assert.deepEqual([r.row.status, r.row.http], ['failed', 429]);
    fail = 413;
    const again = (await s.msg({ type: 'retry', id: r.row.id })).row;
    assert.deepEqual([again.status, again.http], ['failed', 413]);
    fail = null;
    const ok = (await s.msg({ type: 'retry', id: r.row.id })).row;
    assert.deepEqual([ok.status, ok.http], ['sent', 0]);
    // The re-send pass (tick): an unacked row goes again after RESEND_MESSAGE_MS; refused, its 429 is logged.
    clock += ds.RESEND_MESSAGE_MS + MIN;
    fail = 429;
    await s.app.tick();
    fail = null;
    const lines = (await s.msg({ type: 'labActivity' })).lines.map(line);
    assert.deepEqual(lines, [
      `send ${id8} url failed 429`,
      `retry ${id8} url failed 413`,
      `retry ${id8} url sent -`,
      `failed ${id8} url failed 429`,
    ]);
    // Copy diagnostics carries them too (its last 50 events).
    assert.match((await s.msg({ type: 'labDiagnostics' })).text, new RegExp(` send ${id8} url failed 429\n`));
  } finally { await s.close(); }
});

test('F02 entry point: a PDF over 9 MB goes as its link with the reason; Send files over 9 MB runs the files gate', async () => {
  const s = await setup();
  try {
    const big = new Uint8Array(9_500_000);
    big.set(new TextEncoder().encode('%PDF-1.4\n'));
    const tab = s.fb.addTab({ url: 'https://files.example/big.pdf', title: 'big.pdf', contentType: 'application/pdf', fetch: async () => new Response(big, { headers: { 'content-type': 'application/pdf', 'content-length': String(big.length) } }) });
    const r = await s.msg({ type: 'sendTab', tabId: tab });
    assert.equal(r.reason, 'pdf-too-large');
    assert.equal(r.note, 'The PDF is over 9 MB, so its link was sent.');
    assert.equal(r.row.kind, 'url');
    const g = await s.msg({ type: 'labGate', feature: 'F02' });
    assert.deepEqual([g.ready, g.state, g.message, g.button], [false, 'needs-server', LAB_TEXT.needs['needs-server'], 'Copy Server code']);
    assert.match(g.serverCode, /^daylightserver:\/\/setup\?c=/, 'the Copy Server code button copies it');
  } finally { await s.close(); }
});
