// Lab's Wave 1 in the web sender, in a real Chromium (LAB-PLAN 3.3; card B1), against the mock relay and Daylights from
// daylight-lab.js (LabInboxSim: a Lab Inbox that acks and reports states):
//
//   F01  the timeline's rows: "In your Reader ✓", "Waiting for a tap on your Daylight", "Handed to the Reader"; the
//        sentence and step line only on the newest row and rows that are not final (F01.6); the check-in header; a row
//        whose label changes is announced, and screen readers get "{label}. {sentence}", never the step line
//   F07  offline: "Waiting for connection" in "Waiting to send (1)" with Cancel; back online it goes by itself; with the
//        page closed, the service worker's Background Sync sends it (dls-flush, dispatched through DevTools)
//   F16  a typed link loses its tracking and carries the link as typed in x-orig; F16's Use switch off sends it as typed;
//        every text-only case of normalise.json shared with ?text= arrives as the vectors say, and so do words around a
//        link in the Link field, a share the page fills the form with, and the share sheet's text (B1); an address on
//        its own in the Link field or from the Shortcut by the same text rules; one given as one (?url=) as given,
//        also when the form holds it and Send sends it; a Shortcut with no web address says v1.1's sentence and fills
//        the Link field, Lab on as off; Lab off is v1.1
//   F33  Paste and send: "Send {host}?", Send and Cancel; "No link on the clipboard."; gone with its Use switch off
//   F09  the bookmarklet, dragged or copied from Shortcuts and automation, sends the page it runs on, its address
//        exactly (one ending in a full stop too)
//   F26  Setup check: the lines, the test article followed to "In your Reader", the activity log, Copy diagnostics; the
//        browser's install offer kept but never cancelled; needs-pairing in LAB_TEXT's words after another tab unpairs
//   F00.3  W1's rows in What's in Lab: their short states, and the sentence under a tapped one (needs-pairing,
//        needs-inbox); the Use switches' names and footers (6.5 Q5)
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/e2e/web-lab-w1.e2e.mjs      (HEADED=1 to watch)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { webBuilt } from '../helpers/web-built.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const w = webBuilt();
const ds = await w.load('daylight-share.js');
const L = await w.load('daylight-lab.js');
const WL = await w.load('web-lab.js');
const { LAB_TEXT } = L;
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'test-results', 'web-lab');
const MIN = 60000;

let relay, site, browser;

before(async () => {
  relay = await startMockRelay();
  site = await w.serve();
  browser = await chromium.launch({ channel: 'chromium', headless: !process.env.HEADED });
});

after(async () => {
  await browser?.close();
  await relay?.close();
  await site?.close();
});

const ready = (page) => page.waitForSelector('body[data-ready="1"]');

/** The page's own storage (IndexedDB kv). */
const storageGet = (page, key) => page.evaluate(async (k) => {
  const { openStorage } = await import('./web-storage.js');
  return (await openStorage()).storage.get(k);
}, key);

async function store(page, items) {
  await page.evaluate(async (i) => {
    const { openStorage } = await import('./web-storage.js');
    const { storage } = await openStorage();
    for (const [k, v] of Object.entries(i)) await storage.set(k, v);
  }, items);
  await page.reload();
  await ready(page);
}

/**
 * A fresh browser with the clipboard allowed, the page paired with a new Daylight (or not), Lab on and its one-time
 * note seen. -> {ctx, page, pairing, secret}
 */
async function openPaired({ paired = true, settings = {}, width = 390, height = 900, relayUrl = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.url });
  const page = await ctx.newPage();
  await page.goto(`${site.url}/`);
  await ready(page);
  const secret = ds.generateSecret();
  const pairing = { secret, relay: relayUrl ?? relay.url, name: 'Lab Daylight' };
  const items = { settings: { from: 'W1 web', lab: true, labNoteShown: true, ...settings } };
  if (paired) items.pairing = { code: await ds.formatCode(secret), relay: pairing.relay, name: 'Lab Daylight' };
  await store(page, items);
  if (paired) await page.waitForSelector('#view-send:not([hidden])');
  return { ctx, page, pairing, secret };
}

/**
 * A Lab Daylight (LabInboxSim) for a pairing: pollOnce() receives and acks what was sent, and reports stateFor(header)
 * (`reader` for links by default); record(id, s) reports a later state. Its clock runs a minute ahead per call, so the
 * Lab frames' 30 s spacing never holds a report back.
 */
async function labDaylight(pairing, { stateFor } = {}) {
  let skew = 0;
  const now = () => Date.now() + skew;
  const storage = new ds.MemoryStorage();
  const receiver = new ds.Receiver({ pairing, storage, from: 'Daylight', now });
  const labInbox = new L.LabInbox({
    storage, relay: new ds.RelayClient({ relay: pairing.relay }), keys: await ds.deriveKeys(pairing.secret),
    info: () => ({ lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'], live: false }), from: 'Daylight', now,
    autoFlushMs: null,
  });
  const sim = new L.LabInboxSim({ receiver, labInbox, ...(stateFor ? { stateFor } : {}) });
  const items = [];
  return {
    items,
    async pollOnce() { skew += MIN; const r = await sim.pollOnce(); items.push(...(r.items ?? [])); return r; },
    async record(id, s) { skew += MIN; labInbox.record(id, s, Math.floor(now() / 1000)); await labInbox.flush(); },
  };
}

/** What a plain v1.1 Daylight received so far on this pairing (it acks too). */
async function receiveAll(pairing, n, timeout = 20000) {
  const r = new ds.Receiver({ pairing, storage: new ds.MemoryStorage() });
  const got = [];
  const until = Date.now() + timeout;
  while (got.length < n && Date.now() < until) {
    got.push(...(await r.pollOnce()).items);
    if (got.length < n) await new Promise((res) => setTimeout(res, 300));
  }
  assert.ok(got.length >= n, `expected ${n} items, got ${got.length}`);
  return got;
}

/**
 * Records the tags the page asks Background Sync for (SyncManager.register), from now on, without registering them.
 * Playwright's offline mode doesn't always reach the service worker, and Chromium, really online, fires a registered
 * dls-flush at once: the worker would then send what a test means to keep waiting. The test of the worker's own run
 * fires dls-flush itself, through DevTools.
 */
const spySync = (page) => page.evaluate(() => {
  window.__syncTags = [];
  SyncManager.prototype.register = async function (tag) { window.__syncTags.push(tag); };
});

const row = (page, title) => page.locator('#history li, #lab-queue-list li').filter({ has: page.locator('.item-title', { hasText: title }) });

async function sendLink(page, url, title = '') {
  await page.fill('#url', url);
  await page.fill('#title', title);
  await page.click('#send-url');
  await page.waitForFunction(() => document.querySelector('#status')?.textContent && !/^Sending/.test(document.querySelector('#status').textContent));
}

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

async function openWhats(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.click('#open-whats-in-lab');
  await page.waitForSelector('body[data-fresh="1"]', { timeout: 20000 });
}

// --- F01 ----------------------------------------------------------------------------------------------------------------

test('F01: the timeline’s rows and check-in header; step lines on the newest row and rows not final; label changes are announced (F01.1, F01.6)', { timeout: 120000 }, async () => {
  const { ctx, page, pairing } = await openPaired();
  try {
    assert.equal(await page.textContent('#lab-checkin'), LAB_TEXT.neverCheckedIn);
    await sendLink(page, 'https://example.com/read', 'Read it');
    await sendLink(page, 'https://example.com/tap', 'Tap it');
    const day = await labDaylight(pairing, { stateFor: (h) => (h.title === 'Tap it' ? 'waiting' : 'reader') });
    await day.pollOnce();
    await sendLink(page, 'https://example.com/newest', 'The newest');
    await page.reload(); // opening the page reads the ack topic
    await ready(page);
    await page.waitForFunction(() => document.querySelector('#history li[data-lab-state="waiting"]'), null, { timeout: 20000 });
    assert.equal(await page.textContent('#lab-checkin'), 'Your Daylight checked in just now.');

    const read = row(page, 'Read it');
    assert.equal(await read.getAttribute('data-lab-state'), 'reader');
    assert.equal(await read.locator('.st').textContent(), 'In your Reader ✓');
    // Final and not the newest: the sentence and the step line are in its details, behind its title.
    assert.equal(await read.locator('.sentence').isHidden(), true);
    assert.equal(await read.locator('.lab-steps').isHidden(), true);
    const open = read.getByRole('button', { name: 'Read it', exact: true });
    assert.equal(await open.getAttribute('aria-expanded'), 'false');
    await open.click();
    assert.equal(await read.locator('.lab-steps').textContent(), 'Sent ✓ · On your Daylight ✓ · In the Reader ✓');
    assert.equal(await read.locator('.sentence').textContent(), 'Saved in the Daylight Reader.');
    // Screen readers: "{label}. {sentence}", never the step line (2.5).
    assert.equal(await read.locator('.lab-row-a11y').textContent(), 'In your Reader ✓. Saved in the Daylight Reader.');
    assert.equal(await read.locator('.lab-steps').getAttribute('aria-hidden'), 'true');

    const tap = row(page, 'Tap it');
    assert.equal(await tap.locator('.st').textContent(), 'Waiting for a tap on your Daylight');
    assert.equal(await tap.locator('.sentence').isVisible(), true, 'not final: its sentence shows');
    assert.equal(await tap.locator('.lab-steps').textContent(), 'Sent ✓ · On your Daylight ✓ · In the Reader …');

    const newest = row(page, 'The newest');
    assert.equal(await newest.locator('.st').textContent(), 'Sent · waiting for your Daylight');
    assert.equal(await newest.locator('.lab-steps').textContent(), 'Sent ✓ · On your Daylight … · In the Reader');
    await shot(page, 'w1-timeline');

    // The tapped item reaches the Reader as a shared link: the row changes, and the change is said (2.5).
    const tapId = await tap.getAttribute('data-id');
    await day.record(tapId, 'handed');
    await page.evaluate(async () => { new BroadcastChannel('send-to-daylight').postMessage('changed'); });
    await page.reload();
    await ready(page);
    await page.waitForFunction((id) => document.querySelector(`#history li[data-id="${id}"]`)?.dataset.labState === 'handed', tapId, { timeout: 20000 });
    assert.equal(await tap.locator('.st').textContent(), 'Handed to the Reader');
    assert.equal(await tap.locator('.lab-row-a11y').textContent(), 'Handed to the Reader. Your Daylight passed it to the Reader as a shared link. The Reader doesn’t confirm those.');

    // A label that changes while the page is open is announced: the newest row is delivered to the Daylight.
    await day.pollOnce();
    await page.evaluate(async () => {
      // What a tick does: the ack topic, then the page draws the history again (as after any check).
      new BroadcastChannel('send-to-daylight').postMessage('changed');
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.click('#open-whats-in-lab'); // opening What's in Lab reads the ack topic (1.4)
    await page.waitForSelector('body[data-fresh="1"]', { timeout: 20000 });
    await page.getByRole('button', { name: '‹ Back' }).first().click();
    await page.click('#close-settings');
    // The ack and the Daylight's state come in one check: the row goes straight to "In your Reader ✓", said once.
    await page.waitForFunction(() => document.querySelector('#announce').textContent.includes('The newest'), null, { timeout: 20000 });
    assert.equal(await page.textContent('#announce'), 'In your Reader ✓: The newest');
  } finally { await ctx.close(); }
});

// --- F07 ----------------------------------------------------------------------------------------------------------------

test('F07: offline, a send waits for a connection in “Waiting to send (1)” with Cancel; back online it goes; Cancel removes one (F07.1, F07.2)', { timeout: 90000 }, async () => {
  const { ctx, page, pairing } = await openPaired();
  try {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await spySync(page);
    await ctx.setOffline(true);
    await sendLink(page, 'https://example.com/first-offline', 'First offline');
    await sendLink(page, 'https://example.com/second-offline', 'Second offline');
    assert.equal(await page.textContent('#status'), 'Waiting for connection. It will send when this device is back online.');
    assert.equal(await page.textContent('#lab-queue-h'), 'Waiting to send (2)');
    const first = row(page, 'First offline');
    assert.equal(await first.locator('.st').textContent(), 'Waiting for connection');
    assert.equal(await first.locator('.lab-steps').textContent(), 'Sent … · On your Daylight · In the Reader');
    assert.equal(await first.locator('.retry').count(), 0, 'it goes by itself: no Retry now');
    await shot(page, 'w1-offline');
    await row(page, 'Second offline').getByRole('button', { name: 'Cancel: Second offline' }).click();
    await page.waitForFunction(() => document.querySelector('#lab-queue-h')?.textContent === 'Waiting to send (1)');
    // Background Sync is asked for (Chromium), so it goes even if the page is closed.
    assert.deepEqual(await page.evaluate(() => window.__syncTags), ['dls-flush', 'dls-flush']);
    await ctx.setOffline(false);
    await page.waitForSelector('#lab-queue', { state: 'hidden', timeout: 30000 });
    assert.equal(await row(page, 'First offline').locator('.st').textContent(), 'Sent · waiting for your Daylight');
    const items = await receiveAll(pairing, 1);
    assert.deepEqual(items.map((i) => i.header.url), ['https://example.com/first-offline'], 'the cancelled one never went');
    const log = await storageGet(page, 'lab/activity');
    assert.deepEqual(log.map((e) => e.type), ['defer', 'defer', 'remove', 'flush']);
  } finally { await ctx.close(); }
});

test('F07: with the page closed, the service worker’s Background Sync (dls-flush) sends what waits', { timeout: 90000 }, async () => {
  const { ctx, page, pairing } = await openPaired();
  try {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await ready(page);
    assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true);
    await spySync(page); // the only dls-flush is the one this test fires
    await ctx.setOffline(true);
    await sendLink(page, 'https://example.com/while-closed', 'While closed');
    await page.waitForSelector('#lab-queue:not([hidden])');
    const cdp = await ctx.newCDPSession(page);
    const regs = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
    await cdp.send('ServiceWorker.enable');
    for (let i = 0; i < 50 && !regs.some((r) => r.scopeURL.startsWith(site.url)); i++) await new Promise((r) => setTimeout(r, 100));
    const reg = regs.find((r) => r.scopeURL.startsWith(site.url));
    await page.goto('about:blank'); // the page is gone; only its service worker is left
    await ctx.setOffline(false);
    // What the browser does once it is online again (Chromium fires it by itself; DevTools fires it now).
    await cdp.send('ServiceWorker.dispatchSyncEvent', { origin: site.url, registrationId: reg.registrationId, tag: 'dls-flush', lastChance: false });
    const items = await receiveAll(pairing, 1, 30000);
    assert.equal(items[0].header.url, 'https://example.com/while-closed');
    assert.equal(items[0].header.from, 'W1 web');
    assert.equal(items[0].header.app, 'web/1.1.0');
    // The next open shows it sent.
    await page.goto(`${site.url}/`);
    await ready(page);
    assert.equal(await page.isHidden('#lab-queue'), true);
    assert.notEqual(await row(page, 'While closed').getAttribute('data-status'), 'failed', 'sent (or delivered already)');
  } finally { await ctx.close(); }
});

// --- F16, F33 -------------------------------------------------------------------------------------------------------------

test('F16: a typed link loses its tracking and carries the link as typed (x-orig); with the Use switch off it goes as typed', { timeout: 90000 }, async () => {
  const { ctx, page, pairing } = await openPaired();
  try {
    await sendLink(page, 'example.com/story?utm_source=news&id=7&fbclid=abc', 'Clean me');
    await openWhats(page);
    const use = page.getByRole('switch', { name: 'Use Clean links', exact: true });
    assert.equal(await use.isChecked(), true);
    assert.equal(await page.textContent('#lab-use-F16-footer'), LAB_TEXT.use.footers.F16);
    await use.click();
    await page.waitForFunction(async () => {
      const { openStorage } = await import('./web-storage.js');
      return (await (await openStorage()).storage.get('settings'))?.labUse?.F16 === false;
    });
    await page.getByRole('button', { name: '‹ Back' }).first().click();
    await page.click('#close-settings');
    await sendLink(page, 'https://example.com/story?utm_source=news&id=8', 'As typed');
    const items = await receiveAll(pairing, 2);
    const clean = items.find((i) => i.header.title === 'Clean me');
    assert.equal(clean.header.url, 'https://example.com/story?id=7');
    assert.deepEqual(clean.extras, { 'x-orig': 'https://example.com/story?utm_source=news&id=7&fbclid=abc' });
    const typed = items.find((i) => i.header.title === 'As typed');
    assert.equal(typed.header.url, 'https://example.com/story?utm_source=news&id=8');
    assert.deepEqual(typed.extras ?? {}, {});
  } finally { await ctx.close(); }
});

test('F16: every text-only case of normalise.json shared with ?text= arrives as the vectors say; words around a link in the Link field, a share filled into the form, the share sheet’s text; Lab off is v1.1’s (B1)', { timeout: 300000 }, async () => {
  const VECTORS = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'share', 'vectors', 'normalise.json'), 'utf8'));
  const cases = VECTORS.cases.filter((c) => c.input.url === undefined && c.input.text !== undefined);
  assert.equal(cases.length, 39);
  const enc = encodeURIComponent;
  const { ctx, page, pairing } = await openPaired();
  // One Daylight for the whole test, so each poll brings only what the page sent since.
  const day = new ds.Receiver({ pairing, storage: new ds.MemoryStorage() });
  const next = async (what) => {
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      const { items } = await day.pollOnce();
      if (items.length) { assert.equal(items.length, 1, `${what}: one item`); return items[0]; }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`${what}: nothing arrived`);
  };
  const outbox = async () => ((await storageGet(page, 'outbox')) ?? []).length;
  const done = () => page.waitForFunction(() => /^(?!Sending)./.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 20000 });
  try {
    // ?text= with autosend, as an installed page's share or a link opens it; F16's Use switch off for clean: false.
    let sent = 0;
    let useOn = true;
    const order = [...cases.filter((c) => c.input.clean !== false), ...cases.filter((c) => c.input.clean === false)];
    for (const c of order) {
      const i = c.input;
      if ((i.clean !== false) !== useOn) {
        useOn = i.clean !== false;
        await store(page, { settings: { from: 'W1 web', lab: true, labNoteShown: true, labUse: { F16: useOn } } });
      }
      await page.goto(`${site.url}/?autosend=1&text=${enc(i.text)}${i.subject ? `&title=${enc(i.subject)}` : ''}`);
      await ready(page);
      if (!c.expect.url) {
        // No web address (a note, or nothing): nothing goes, as with v1.1.
        await page.waitForFunction(() => location.search === '');
        await page.waitForTimeout(400);
        assert.equal(await outbox(), sent, `${c.name}: nothing sent`);
        continue;
      }
      await done();
      sent += 1;
      const item = await next(c.name);
      assert.equal(item.header.url, c.expect.url, c.name);
      assert.deepEqual(item.extras ?? {}, c.expect.orig ? { 'x-orig': c.expect.orig } : {}, c.name);
      // The web sender has no selections (F11 isn't one of its features): a selection case is a plain share, whose
      // URL and orig are the vector's.
      if (!i.source) assert.equal(item.header.title ?? '', c.expect.title && c.expect.title !== c.expect.url ? c.expect.title : '', c.name);
    }
    assert.equal(await outbox(), sent);
    assert.equal(sent, cases.filter((c) => c.expect.url).length);
    await store(page, { settings: { from: 'W1 web', lab: true, labNoteShown: true } });

    // The Link field with words around the link: normaliseShare finds it; the words are the title.
    await sendLink(page, 'See (https://en.wikipedia.org/wiki/Foo_(bar)).');
    let item = await next('Link field, parentheses');
    assert.deepEqual([item.header.url, item.header.title], ['https://en.wikipedia.org/wiki/Foo_(bar)', 'See']);
    await sendLink(page, 'He said “https://example.com/q?utm_source=x”');
    item = await next('Link field, curly quotes');
    assert.deepEqual([item.header.url, item.header.title, item.extras], ['https://example.com/q', 'He said', { 'x-orig': 'https://example.com/q?utm_source=x' }]);

    // A share without autosend fills the form with the link as found and its title; Send sends what the share would.
    await page.goto(`${site.url}/?text=${enc('Worth a read: “https://example.com/s?fbclid=1”.')}`);
    await ready(page);
    await page.waitForFunction(() => document.querySelector('#url').value !== '');
    assert.equal(await page.inputValue('#url'), 'https://example.com/s?fbclid=1');
    assert.equal(await page.inputValue('#title'), 'Worth a read');
    await page.click('#send-url');
    await done();
    item = await next('the form, filled from a share');
    assert.deepEqual([item.header.url, item.header.title, item.extras], ['https://example.com/s', 'Worth a read', { 'x-orig': 'https://example.com/s?fbclid=1' }]);

    // Android's share sheet: Chrome posts the shared text to the share target, through the service worker.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await ready(page);
    await page.evaluate(() => {
      const form = Object.assign(document.createElement('form'), { method: 'POST', action: 'share-target', enctype: 'multipart/form-data' });
      form.append(Object.assign(document.createElement('input'), { name: 'text', value: '[https://example.com/x]' }));
      document.body.append(form);
      form.submit();
    });
    await page.waitForURL((u) => u.pathname === '/' && u.search === '');
    await ready(page);
    item = await next('the share sheet');
    assert.equal(item.header.url, 'https://example.com/x');

    // Lab off: the page is v1.1's, which reads shared text with findUrl (so this link loses its closing parenthesis).
    await store(page, { settings: { from: 'W1 web', lab: false, labNoteShown: true } });
    await page.goto(`${site.url}/?autosend=1&text=${enc('See (https://en.wikipedia.org/wiki/Foo_(bar)).')}`);
    await ready(page);
    await done();
    item = await next('Lab off');
    assert.equal(item.header.url, ds.findUrl('See (https://en.wikipedia.org/wiki/Foo_(bar)).'));
    assert.equal(item.header.url, 'https://en.wikipedia.org/wiki/Foo_(bar');
    assert.deepEqual(item.extras ?? {}, {});
  } finally { await ctx.close(); }
});

test('F16: an address typed or shared on its own follows the text rules (Link field, Shortcut); one given as one (?url=) goes as given, from the form too; a Shortcut with no web address says v1.1’s sentence and fills the Link field, Lab on as off', { timeout: 120000 }, async () => {
  const NOT_A_WEB_ADDRESS = 'That isn’t a web address. It should look like https://example.com/story.';
  const enc = encodeURIComponent;
  const { ctx, page, pairing, secret } = await openPaired();
  const link = await ds.pairingLink({ secret, relay: pairing.relay, name: 'Lab Daylight' });
  const shortcut = (shared) => `${site.url}/#autosend=1&pair=${enc(link)}&url=${enc(shared)}`;
  const day = new ds.Receiver({ pairing, storage: new ds.MemoryStorage() });
  const next = async (what) => {
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      const { items } = await day.pollOnce();
      if (items.length) { assert.equal(items.length, 1, `${what}: one item`); return items[0]; }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`${what}: nothing arrived`);
  };
  const open = async (url) => {
    await page.goto('about:blank');
    await page.goto(url);
    await ready(page);
    await page.waitForFunction(() => location.hash === '' && /^(?!Sending)./.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 20000 });
  };
  const outbox = async () => ((await storageGet(page, 'outbox')) ?? []).length;
  try {
    // Lab on: a full stop after an address typed on its own, and a stray bracket after one the Shortcut shares, are
    // not part of the link, as when the same text comes with ?text= or Paste and send.
    await sendLink(page, 'https://example.com/a/b.');
    let item = await next('Link field');
    assert.deepEqual([item.header.url, item.header.title ?? ''], ['https://example.com/a/b', '']);
    await open(shortcut('https://en.wikipedia.org/wiki/Foo_(bar)).'));
    item = await next('Shortcut');
    assert.equal(item.header.url, 'https://en.wikipedia.org/wiki/Foo_(bar)');
    // An address given as one (?url=, a script's or a link's) goes as given (F16 step 1): its full stop is part of it.
    await open(`${site.url}/?autosend=1&url=${enc('https://en.wikipedia.org/wiki/U.S.')}`);
    item = await next('?url=');
    assert.deepEqual([item.header.url, item.extras ?? {}], ['https://en.wikipedia.org/wiki/U.S.', {}]);
    // Without autosend it fills the form with the address as given, and Send sends it so; typed over, the Link field is
    // typed text again.
    await page.goto(`${site.url}/?url=${enc('https://en.wikipedia.org/wiki/Washington,_D.C.')}&title=${enc('Washington, D.C.')}`);
    await ready(page);
    await page.waitForFunction(() => document.querySelector('#url').value !== '');
    assert.equal(await page.inputValue('#url'), 'https://en.wikipedia.org/wiki/Washington,_D.C.');
    assert.equal(await page.inputValue('#title'), 'Washington, D.C.');
    await page.click('#send-url');
    item = await next('the form, filled from ?url=');
    assert.deepEqual([item.header.url, item.header.title, item.extras ?? {}], ['https://en.wikipedia.org/wiki/Washington,_D.C.', 'Washington, D.C.', {}]);
    await sendLink(page, 'https://en.wikipedia.org/wiki/Washington,_D.C.');
    item = await next('the Link field, typed');
    assert.equal(item.header.url, 'https://en.wikipedia.org/wiki/Washington,_D.C');
    // A Shortcut with words and no web address: v1.1's sentence, and the words in the Link field to correct; nothing sent.
    const sent = await outbox();
    const said = {};
    for (const lab of [true, false]) {
      await store(page, { settings: { from: 'W1 web', lab, labNoteShown: true } });
      await open(shortcut('just words'));
      await page.waitForFunction((t) => document.querySelector('#status')?.textContent === t, NOT_A_WEB_ADDRESS, { timeout: 10000 });
      said[lab ? 'on' : 'off'] = { status: await page.textContent('#status'), url: await page.inputValue('#url'), title: await page.inputValue('#title') };
      assert.equal(await outbox(), sent, `Lab ${lab ? 'on' : 'off'}: nothing sent`);
    }
    assert.deepEqual(said.on, { status: NOT_A_WEB_ADDRESS, url: 'just words', title: '' }, 'Lab on');
    assert.deepEqual(said.on, said.off, 'Lab on says and fills what Lab off does');
    // Lab off types and shares as v1.1 does: the address as given.
    await sendLink(page, 'https://example.com/a/b.');
    item = await next('Link field, Lab off');
    assert.equal(item.header.url, 'https://example.com/a/b.');
  } finally { await ctx.close(); }
});

test('F33: Paste and send shows the host and sends on Send; no link says so; Cancel sends nothing; gone with its Use switch off (F33.3)', { timeout: 90000 }, async () => {
  const { ctx, page, pairing } = await openPaired();
  try {
    const paste = page.getByRole('button', { name: LAB_TEXT.copiedLink.pasteAndSend, exact: true });
    await page.evaluate(() => navigator.clipboard.writeText('nothing to see'));
    await paste.click();
    await page.locator('.lab-paste-none').waitFor();
    assert.equal(await page.textContent('.lab-paste-none'), LAB_TEXT.copiedLink.noLink);

    await page.evaluate(() => navigator.clipboard.writeText('Look: https://www.example.org/piece?utm_campaign=x'));
    await paste.click();
    const ask = page.locator('.lab-paste-confirm');
    await ask.waitFor();
    assert.equal(await ask.locator('.lab-note-text').textContent(), 'Send example.org?');
    assert.equal(await ask.getAttribute('role'), 'group');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), LAB_TEXT.automation.send);
    await shot(page, 'w1-paste');
    await ask.getByRole('button', { name: LAB_TEXT.automation.cancel }).click();
    assert.equal(await ask.count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), LAB_TEXT.copiedLink.pasteAndSend);
    await paste.click();
    await page.locator('.lab-paste-confirm').getByRole('button', { name: LAB_TEXT.automation.send }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Sent'));
    const [item] = await receiveAll(pairing, 1);
    assert.equal(item.header.url, 'https://www.example.org/piece');
    assert.equal(item.header.title, 'Look');
    assert.deepEqual(item.extras, { 'x-orig': 'https://www.example.org/piece?utm_campaign=x' });

    await openWhats(page);
    await page.getByRole('switch', { name: 'Use Send copied link', exact: true }).click();
    await page.getByRole('button', { name: '‹ Back' }).first().click();
    await page.click('#close-settings');
    assert.equal(await page.isHidden('#lab-paste'), true, 'Use off: no Paste and send');
  } finally { await ctx.close(); }
});

// --- F09 ----------------------------------------------------------------------------------------------------------------

test('F09: Shortcuts and automation gives the bookmarklet; run on a page, it sends that page with its title, its address exactly', { timeout: 90000 }, async () => {
  const { ctx, page, pairing } = await openPaired();
  try {
    await openWhats(page);
    await page.locator('li[data-feature="F09"] .lab-row').click();
    await page.waitForSelector('#view-f09:not([hidden])');
    assert.equal(await page.textContent('#f09-h'), LAB_TEXT.features.F09.name);
    const link = page.getByRole('link', { name: LAB_TEXT.appName.web, exact: true });
    const code = await link.getAttribute('href');
    assert.equal(code, WL.bookmarklet(`${site.url}/`));
    assert.equal(await page.textContent('#lab-bookmarklet-code'), code);
    await shot(page, 'w1-f09');
    // Activating it here copies it (run here, it would send this page).
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await link.click();
    await page.locator('.lab-bookmarklet-copied').getByText(LAB_TEXT.setup.copied).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
    assert.equal(new URL(page.url()).hash, '', 'nothing ran');
    await page.getByRole('button', { name: '‹ Back' }).first().click();
    await page.waitForFunction(() => document.activeElement?.closest('li')?.dataset.feature === 'F09', null, { timeout: 20000 }); // back on its row

    // Run on another page (a bookmark click): it opens the web sender, which sends that page.
    const other = await ctx.newPage();
    await other.goto(`${relay.url}/__mock/state`);
    await other.evaluate((c) => { document.title = 'A page to keep'; window.eval(c.slice('javascript:'.length)); }, code);
    await other.waitForURL((u) => u.origin === site.url);
    await ready(other);
    await other.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Sent'));
    const [item] = await receiveAll(pairing, 1);
    assert.equal(item.header.url, `${relay.url}/__mock/state`);
    assert.equal(item.header.title, 'A page to keep');
    assert.equal(new URL(other.url()).hash, '', 'a reload doesn’t send it again');

    // Lab on, a page whose address ends in a full stop ("…/wiki/Washington,_D.C."): it goes exactly, with no x-orig, as
    // with Lab off (F16 step 1: the bookmarklet's url= is the page's address, given as one, not shared text).
    const dotted = `${relay.url}/__mock/state?wiki=Washington,_D.C.`;
    const third = await ctx.newPage();
    await third.goto(dotted);
    assert.equal(await third.evaluate(() => location.href), dotted);
    await third.evaluate((c) => { document.title = 'Washington, D.C.'; window.eval(c.slice('javascript:'.length)); }, code);
    await third.waitForURL((u) => u.origin === site.url);
    await ready(third);
    await third.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Sent'));
    const got = await receiveAll(pairing, 2);
    const last = got.find((i) => i.header.title === 'Washington, D.C.');
    assert.ok(last, 'the page ending in a full stop arrived');
    assert.equal(last.header.url, dotted);
    assert.deepEqual(last.extras ?? {}, {});
  } finally { await ctx.close(); }
});

// --- F26 ----------------------------------------------------------------------------------------------------------------

test('F26: a send the relay refuses shows its HTTP status in the activity log (429), and a send that goes shows none', { timeout: 90000 }, async () => {
  let fail = 429; // the refusing relay's answer to each publish, or null to take it
  const refusing = await startMockRelay({ failPublish: () => fail });
  const { ctx, page } = await openPaired({ relayUrl: refusing.url });
  try {
    await sendLink(page, 'https://example.com/limited', 'Limited');
    const [limited] = (await storageGet(page, 'outbox')) ?? [];
    assert.deepEqual([limited.status, limited.http], ['failed', 429]);
    fail = null;
    await sendLink(page, 'https://example.com/fine', 'Fine');
    const fine = ((await storageGet(page, 'outbox')) ?? []).find((r) => r.title === 'Fine');
    await openWhats(page);
    await page.locator('li[data-feature="F26"] .lab-row').click();
    await page.waitForSelector('#view-setup:not([hidden])');
    await page.locator('.lab-activity summary').click();
    await page.waitForFunction(() => document.querySelector('.lab-activity-lines').textContent.includes(' send '));
    const lines = (await page.textContent('.lab-activity-lines')).split('\n').map((l) => l.split(' ').slice(1).join(' '));
    assert.ok(lines.includes(`send ${limited.id.slice(0, 8)} url failed 429`), lines.join(' | '));
    assert.ok(lines.includes(`send ${fine.id.slice(0, 8)} url sent -`), lines.join(' | '));
  } finally { await ctx.close(); await refusing.close(); }
});

test('F26: Setup check’s lines; the test article is followed to “In your Reader”; the activity log; Copy diagnostics is redacted (F26.1–3)', { timeout: 120000 }, async () => {
  const { ctx, page, pairing } = await openPaired();
  try {
    await sendLink(page, 'https://secret.example/private?token=abc', 'A private title');
    await openWhats(page);
    await page.locator('li[data-feature="F26"] .lab-row').click();
    await page.waitForSelector('#view-setup:not([hidden])');
    await page.waitForSelector('body[data-fresh="1"]');
    assert.equal(await page.textContent('#setup-h'), LAB_TEXT.setup.title);
    assert.deepEqual(await page.$$eval('.lab-check-line', (l) => l.map((x) => x.textContent)), ['✓ Pairing', '! Installed as an app', '! Storage kept by the browser']);
    // Each unmet check has a button where this page can act: here, asking the browser to keep the storage (Allow).
    assert.equal(await page.getByRole('button', { name: `${LAB_TEXT.buttons['needs-site-access']}: ${LAB_TEXT.setup.checks.storage}` }).count(), 1);
    assert.equal(await page.textContent('.lab-test-footer'), LAB_TEXT.setup.testFooter);
    await shot(page, 'w1-setup');

    const day = await labDaylight(pairing, { stateFor: () => 'waiting' });
    await page.getByRole('button', { name: LAB_TEXT.setup.testSend, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#lab-test-progress')?.dataset.reader === '0');
    assert.deepEqual(await page.$$eval('#lab-test-progress p', (l) => l.map((x) => x.textContent)), ['Delivered', 'In your Reader', 'Sent · waiting for your Daylight']);
    await day.pollOnce();
    // Setup check reads the ack topic now and then while the article is on its way: it waits for the tap ...
    await page.waitForFunction(() => document.querySelector('#lab-test-progress .lab-test-label')?.textContent === 'Waiting for a tap on your Daylight', null, { timeout: 30000 });
    assert.deepEqual(await page.$$eval('#lab-test-progress .lab-check-line', (l) => l.map((x) => x.textContent)), ['✓ Delivered', 'In your Reader']);
    const test = day.items.find((i) => i.extras?.['x-cap'] === 'test');
    assert.equal(test.header.title, 'Test article from W1 web');
    assert.ok(test.header.url.startsWith(L.TEST_URL_PREFIX));
    // ... and ticks In your Reader once the Reader has it.
    await day.record(test.header.id, 'reader');
    await page.waitForFunction(() => document.querySelector('#lab-test-progress')?.dataset.reader === '1', null, { timeout: 30000 });
    assert.deepEqual(await page.$$eval('#lab-test-progress p', (l) => l.map((x) => x.textContent)), ['✓ Delivered', '✓ In your Reader']);

    await page.locator('.lab-activity summary').click();
    await page.waitForFunction(() => document.querySelector('.lab-activity-lines').textContent.includes(' send '));
    const log = await page.textContent('.lab-activity-lines');
    assert.doesNotMatch(log, /secret\.example|private|Test article/);
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.getByRole('button', { name: LAB_TEXT.setup.copyDiagnostics }).click();
    await page.locator('.lab-diagnostics-copied').getByText(LAB_TEXT.setup.copied).waitFor();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(text, /^Send to Daylight diagnostics\nApp: Send to Daylight 1\.1\.0 \(web\)\nLab: on\nLab caps from your Daylight: reader-link, st, tap\n/);
    const code = await ds.formatCode(pairing.secret);
    const keys = await ds.deriveKeys(pairing.secret);
    for (const bad of ['secret.example', 'token=abc', 'A private title', 'Test article', code, keys.inboxTopic, keys.ackTopic, '127.0.0.1']) {
      assert.ok(!text.includes(bad), `no ${bad} in the diagnostics`);
    }
    await page.getByRole('button', { name: '‹ Back' }).first().click();
    await page.waitForFunction(() => document.activeElement?.closest('li')?.dataset.feature === 'F26', null, { timeout: 20000 });
  } finally { await ctx.close(); }
});

/**
 * Fires a stand-in for the browser's beforeinstallprompt (Chromium fires the real one only when it decides to offer the
 * install), whose prompt() counts in window.__prompted. -> whether the page cancelled it (hiding the browser's banner).
 */
const offerInstall = (page) => page.evaluate(() => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  window.__prompted = 0;
  e.prompt = async () => { window.__prompted += 1; };
  e.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
  window.dispatchEvent(e);
  return e.defaultPrevented;
});

test('F26: the browser’s install offer is kept, never cancelled (its own banner still shows, Lab on or off), and Open setting opens it; a test article after another tab unpaired says LAB_TEXT’s needs-pairing sentence', { timeout: 90000 }, async () => {
  const { ctx, page } = await openPaired();
  try {
    assert.equal(await offerInstall(page), false, 'Lab on: the browser still shows its own install banner');
    await openWhats(page);
    await page.locator('li[data-feature="F26"] .lab-row').click();
    await page.waitForSelector('#view-setup:not([hidden]) .lab-check-line');
    const install = page.getByRole('button', { name: `${LAB_TEXT.buttons['needs-quick-sends']}: ${LAB_TEXT.setup.checks.installed}`, exact: true });
    assert.equal(await install.count(), 1, 'Open setting while the browser offers to install the page');
    await install.click();
    await page.waitForFunction(() => window.__prompted === 1);
    await page.waitForFunction(() => !document.querySelector('#view-setup li[data-check="installed"] button'));
    assert.equal(await page.textContent('#view-setup li[data-check="installed"] .lab-check-line'), `! ${LAB_TEXT.setup.checks.installed}`);

    // Another tab unpairs while Setup check is open; the test article then asks for the pairing in LAB_TEXT's words.
    assert.equal(await page.evaluate(() => document.getElementById('lab-paste').hidden), false, 'Paste and send is drawn while paired');
    const other = await ctx.newPage();
    await other.goto(`${site.url}/`);
    await ready(other);
    await other.getByRole('button', { name: 'Settings', exact: true }).click();
    await other.click('#unpair');
    await other.click('#unpair');
    await other.waitForSelector('#view-pair:not([hidden])');
    await page.waitForFunction(() => document.getElementById('lab-paste').hidden, null, { timeout: 20000 });
    await page.getByRole('button', { name: LAB_TEXT.setup.testSend, exact: true }).click();
    await page.locator('#view-setup .lab-test .error').waitFor();
    assert.equal(await page.textContent('#view-setup .lab-test .error'), L.needsMessage('needs-pairing', { platform: 'web' }));
    assert.equal(await page.textContent('#view-setup .lab-test .error'), LAB_TEXT.needs['needs-pairing']);
    await other.close();
  } finally { await ctx.close(); }

  // Lab off: the page is v1.1's and leaves the browser's offer alone too.
  const off = await openPaired({ settings: { lab: false } });
  try {
    assert.equal(await offerInstall(off.page), false, 'Lab off: the browser still shows its own install banner');
  } finally { await off.ctx.close(); }
});

// --- What's in Lab (F00.3 for W1, 6.5 Q5) -------------------------------------------------------------------------------

test('What’s in Lab lists W1’s features with their states; a tap says what is missing; the Use switches say what they do', { timeout: 90000 }, async () => {
  const { ctx, page } = await openPaired({ paired: false });
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.click('#open-whats-in-lab');
    await page.waitForSelector('#view-whats-in-lab:not([hidden]) .lab-feature');
    const ids = await page.$$eval('#whats li.lab-feature', (l) => l.map((x) => x.dataset.feature));
    assert.deepEqual(ids, ['F01', 'F07', 'F09', 'F16', 'F26', 'F33', 'F02', 'F37', 'F19', 'F36']);
    assert.deepEqual(await page.$$eval('#whats > .lab-features .lab-short', (l) => l.map((x) => x.textContent)), Array(6).fill('Pair first'));
    await page.locator('li[data-feature="F01"] .lab-row').click();
    const note = page.locator('li[data-feature="F01"] .lab-note');
    await note.locator('.lab-note-body[data-state="needs-pairing"]').waitFor();
    assert.equal(await note.locator('.lab-note-text').textContent(), LAB_TEXT.needs['needs-pairing']);
    assert.equal(await note.getAttribute('aria-live'), 'polite');
    for (const [id, name] of [['F16', 'Use Clean links'], ['F33', 'Use Send copied link']]) {
      const sw = page.getByRole('switch', { name, exact: true });
      assert.equal(await sw.isChecked(), true, `${id}: on by default`);
      assert.equal(await page.textContent(`label[for="lab-use-${id}"]`), LAB_TEXT.use.label);
      assert.equal(await sw.getAttribute('aria-describedby'), `lab-use-${id}-footer`);
      assert.equal(await page.textContent(`#lab-use-${id}-footer`), LAB_TEXT.use.footers[id]);
    }
    assert.equal(await page.locator('#whats input[role="switch"]').count(), 2, 'only the features that change how sharing behaves');
    await shot(page, 'w1-whats-in-lab');
  } finally { await ctx.close(); }

  // Paired, no Lab hello yet: the timeline needs Lab on the Daylight; the others are ready.
  const p = await openPaired();
  try {
    await openWhats(p.page);
    assert.deepEqual(await p.page.$$eval('#whats > .lab-features .lab-short', (l) => l.map((x) => x.textContent)), ['Needs Lab on your Daylight', 'Ready', 'Ready', 'Ready', 'Ready', 'Ready']);
    await p.page.locator('li[data-feature="F01"] .lab-row').click();
    await p.page.locator('li[data-feature="F01"] .lab-note-body[data-state="needs-inbox"]').waitFor();
    assert.equal(await p.page.textContent('li[data-feature="F01"] .lab-note-text'), LAB_TEXT.needs['needs-inbox']);
    await p.page.locator('li[data-feature="F07"] .lab-row').click();
    assert.equal(await p.page.textContent('li[data-feature="F01"] .lab-note'), '', 'another tap closes the note');
    assert.equal(await p.page.textContent('li[data-feature="F07"] .lab-note'), '', 'a ready feature with nothing to open says nothing');
  } finally { await p.ctx.close(); }
});

test('Lab off: none of Wave 1 shows: no Paste and send, check-in, queue or note; a send made offline is v1.1’s “Waiting to send” (1.3)', { timeout: 90000 }, async () => {
  const { ctx, page } = await openPaired({ settings: { lab: false, labNoteShown: false } });
  try {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await spySync(page);
    for (const id of ['lab-note', 'lab-paste', 'lab-checkin', 'lab-queue', 'lab-after']) assert.equal(await page.isHidden(`#${id}`), true, id);
    await ctx.setOffline(true);
    await sendLink(page, 'https://example.com/plain-offline', 'Plain offline');
    await page.waitForSelector('#history li[data-status="failed"] .retry');
    assert.equal(await page.textContent('#history li[data-status="failed"] .st'), 'Waiting to send');
    assert.equal(await page.isHidden('#lab-queue'), true);
    assert.deepEqual(await page.evaluate(() => window.__syncTags), [], 'no Background Sync with Lab off');
    assert.equal(await storageGet(page, 'lab/activity'), undefined, 'no activity log with Lab off');
  } finally { await ctx.close(); }
});
