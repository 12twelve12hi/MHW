// Lab's Wave 1 in the web sender, in a real Chromium (LAB-PLAN 3.3; card B1), against the mock relay and Daylights from
// daylight-lab.js (LabInboxSim: a Lab Inbox that acks and reports states):
//
//   F01  the timeline's rows: "In your Reader ✓", "Waiting for a tap on your Daylight", "Handed to the Reader"; the
//        sentence and step line only on the newest row and rows that are not final (F01.6); the check-in header; a row
//        whose label changes is announced, and screen readers get "{label}. {sentence}", never the step line
//   F07  offline: "Waiting for connection" in "Waiting to send (1)" with Cancel; back online it goes by itself; with the
//        page closed, the service worker's Background Sync sends it (dls-flush, dispatched through DevTools)
//   F16  a typed link loses its tracking and carries the link as typed in x-orig; F16's Use switch off sends it as typed
//   F33  Paste and send: "Send {host}?", Send and Cancel; "No link on the clipboard."; gone with its Use switch off
//   F09  the bookmarklet, dragged or copied from Shortcuts and automation, sends the page it runs on
//   F26  Setup check: the lines, the test article followed to "In your Reader", the activity log, Copy diagnostics
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
async function openPaired({ paired = true, settings = {}, width = 390, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.url });
  const page = await ctx.newPage();
  await page.goto(`${site.url}/`);
  await ready(page);
  const secret = ds.generateSecret();
  const pairing = { secret, relay: relay.url, name: 'Lab Daylight' };
  const items = { settings: { from: 'W1 web', lab: true, labNoteShown: true, ...settings } };
  if (paired) items.pairing = { code: await ds.formatCode(secret), relay: relay.url, name: 'Lab Daylight' };
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

test('F09: Shortcuts and automation gives the bookmarklet; run on a page, it sends that page with its title', { timeout: 90000 }, async () => {
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
  } finally { await ctx.close(); }
});

// --- F26 ----------------------------------------------------------------------------------------------------------------

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
