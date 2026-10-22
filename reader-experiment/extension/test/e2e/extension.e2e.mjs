// End to end in a real Chromium: the unpacked extension (test build: dist/chrome plus access to 127.0.0.1, because
// automation can't click the toolbar button that grants activeTab), the mock ntfy relay, a local site with an article
// and a PDF, and a Receiver from daylight-share.js playing the Daylight.
//
// These are v1.1's flows. They run with Lab off here (the plain app), and again with Lab on, the default
// (extension-lab-on.e2e.mjs sets DLS_E2E_LAB=1), so a Lab-on regression in them fails CI: relay trouble's Retry now
// among them. With Lab on, a row that waits to send is in the queue ("Waiting to send (n)", with Cancel beside v1.1's
// button), a page goes through clean-html.js (F03: its doctype is written lowercase), and the badge shows the most
// recent row (F01: … until the Daylight has it). Lab's Wave 1 itself is lab-w1.e2e.mjs.
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/e2e/extension.e2e.mjs      (HEADED=1 to watch)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { built } from '../helpers/built.mjs';
import { startSite } from '../helpers/server.mjs';
import { makePdf } from '../helpers/pdf.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';
import { labDefaultWritten } from '../helpers/lab-off.mjs';

const LAB = process.env.DLS_E2E_LAB === '1';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'test-results', ...(LAB ? ['extension-lab-on'] : []));
/** Where a row that waits to send is: Lab's queue (F07), or v1.1's history. */
const WAITING_LIST = LAB ? '#lab-queue-list' : '#history';
const PDF = makePdf({ pages: 4, fillerBytes: 300_000 }); // over one ntfy message: travels as an attachment
const LARGE_PDF = makePdf({ pages: 2, fillerBytes: 5_000_000 }); // over the relay's 2 MB per attachment: three pieces
const b = built('chrome-test');
const ds = await b.load('daylight-share.js');
const SENT = /^Sent · waiting for your Daylight\./;

let relay, relay2, site, ctx, sw, extId, receiver, secret;
const received = [];
const relayTrouble = { status: 0 }; // the mock relay answers every publish with this status while it is set

async function receive(n, { timeout = 20000 } = {}) {
  const until = Date.now() + timeout;
  while (received.length < n && Date.now() < until) {
    const { items } = await receiver.pollOnce();
    received.push(...items);
    if (received.length < n) await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(received.length >= n, `expected ${n} items, got ${received.length}`);
  return received;
}

async function tabIdFor(url) {
  return sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, url);
}

/**
 * The status line once a pairing has finished, given the words it should have: the popup shows the sending view first
 * and says how the pairing went once that view is drawn (with Lab on, after the tab's Lab answer too), so this waits up
 * to 10 s for them, then returns what the line says (the assertion shows any difference).
 */
async function pairedStatus(popup, expected) {
  await popup.waitForFunction((t) => document.querySelector('#status').textContent === t, expected, { timeout: 10000 }).catch(() => {});
  return popup.textContent('#status');
}

/**
 * The pairing view puts the focus in its code field 50 ms after it opens: wait for that, so the fields typed next
 * aren't typed into the code field halfway (Playwright fills one field after another faster than that).
 */
const pairViewReady = (popup) => popup.waitForFunction(() => document.activeElement?.id === 'code');

/** Settings › Change pairing, ready to type in. */
async function openRepair(popup) {
  await popup.click('#repair');
  await pairViewReady(popup);
}

async function openPopup(tabId) {
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup.html${tabId != null ? `?tab=${tabId}` : ''}`);
  await popup.waitForSelector('body[data-ready="1"]');
  return popup;
}

before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  relay = await startMockRelay({ failPublish: () => relayTrouble.status || null });
  relay2 = await startMockRelay();
  site = await startSite({ pdf: PDF });
  site.routes.set('/files/large.pdf', { type: 'application/pdf', body: Buffer.from(LARGE_PDF) });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-profile-'));
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', // the full Chromium in new headless mode: extensions work there
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${b.dir}`, `--load-extension=${b.dir}`],
  });
  const ours = (w) => w.url().startsWith('chrome-extension://') && w.url().endsWith('/background.js');
  sw = ctx.serviceWorkers().find(ours) ?? await ctx.waitForEvent('serviceworker', { predicate: ours, timeout: 30000 });
  extId = new URL(sw.url()).host;
  // The worker can be reported before its extension APIs are bound: wait until the background has started.
  for (let i = 0; i < 100; i++) {
    if (await sw.evaluate(() => !!globalThis.chrome?.runtime?.id && !!globalThis.sendToDaylight).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // v1.1's tests: the plain app with Lab off (LAB-PLAN 1.3; the chrome-test build reads a seeded settings.lab, 1.7), or
  // with Lab on (its one-time note seen, so the screens are the ones under test). Lab's Wave 1 is lab-w1.e2e.mjs.
  await labDefaultWritten(sw);
  await sw.evaluate((lab) => chrome.storage.local.set({ settings: lab ? { lab: true, labNoteShown: true } : { lab: false } }), LAB);
  secret = ds.generateSecret();
  receiver = new ds.Receiver({ pairing: { secret, relay: relay.url }, storage: new ds.MemoryStorage() });
});

after(async () => {
  await ctx?.close();
  await relay?.close();
  await relay2?.close();
  await site?.close();
});

test('pair in the popup with the link shown on the Daylight', { timeout: 60000 }, async () => {
  const popup = await openPopup();
  assert.equal(await popup.isVisible('#view-pair'), true);
  await popup.screenshot({ path: path.join(OUT, 'popup-pair.png') });
  await popup.fill('#code', 'not a code');
  await popup.click('#pair-btn');
  await popup.waitForSelector('#pair-error:not(:empty)');
  assert.match(await popup.textContent('#pair-error'), /28 letters/);
  const link = await ds.pairingLink({ secret, relay: relay.url, name: 'E2E Daylight' });
  await popup.fill('#code', link);
  await popup.fill('#from', 'E2E Chrome');
  await popup.click('#pair-btn');
  await popup.waitForSelector('#view-send:not([hidden])');
  assert.equal(await popup.textContent('#daylight-name'), 'E2E Daylight');
  await popup.close();
});

test('"Send this page" delivers the page HTML', { timeout: 60000 }, async () => {
  const page = await ctx.newPage();
  await page.goto(`${site.url}/article.html`);
  const tabId = await tabIdFor(`${site.url}/article.html`);
  const popup = await openPopup(tabId);
  assert.equal(await popup.textContent('#page-title'), 'A quiet article');
  assert.equal(await popup.textContent('#send-page'), 'Send this page');
  await popup.click('#send-page');
  await popup.waitForFunction((re) => new RegExp(re).test(document.querySelector('#status').textContent), SENT.source);
  await popup.waitForSelector('#history li[data-status="sent"], #history li[data-status="delivered"]');
  assert.match(await popup.textContent('#history li .st'), /^Sent · waiting for your Daylight$|^Delivered ✓$/);
  await popup.screenshot({ path: path.join(OUT, 'popup-sent.png') });

  const [item] = await receive(1);
  assert.equal(item.header.kind, 'page');
  assert.equal(item.header.url, `${site.url}/article.html`);
  assert.equal(item.header.title, 'A quiet article');
  assert.equal(item.header.from, 'E2E Chrome');
  assert.match(item.header.app, /^chrome\/\d+\.\d+\.\d+$/);
  assert.equal(item.header.enc, 'deflate-raw');
  const html = new TextDecoder().decode(item.content);
  assert.match(html, LAB ? /^<!doctype html>\n<html lang="en">/ : /^<!DOCTYPE html>\n<html lang="en">/);
  assert.match(html, /Marker paragraph: the slow loris of e-paper ✓ ünïcödé/);
  await popup.close();
  await page.close();
});

test('"Send this PDF" on a PDF tab delivers the PDF bytes as a file', { timeout: 60000 }, async () => {
  const pdfPage = await ctx.newPage();
  await pdfPage.goto(`${site.url}/files/paper.pdf`).catch(() => {}); // the PDF viewer may not fire a normal load
  const url = `${site.url}/files/paper.pdf`;
  let tabId;
  for (let i = 0; i < 50 && tabId == null; i++) { tabId = await tabIdFor(url); if (tabId == null) await new Promise((r) => setTimeout(r, 100)); }
  const popup = await openPopup(tabId);
  assert.equal(await popup.textContent('#send-page'), 'Send this PDF');
  await popup.click('#send-page');
  await popup.waitForFunction((re) => new RegExp(re).test(document.querySelector('#status').textContent), SENT.source, { timeout: 30000 });

  const items = await receive(2);
  const file = items.find((i) => i.header.kind === 'file');
  assert.ok(file, 'a file item arrived');
  assert.equal(file.header.mime, 'application/pdf');
  assert.equal(file.header.name, 'Quiet Paper.pdf');
  assert.equal(file.header.url, url);
  assert.equal(file.header.size, PDF.length);
  assert.deepEqual(file.content, PDF);
  await popup.close();
  await pdfPage.close();
});

test('a 5 MB PDF travels in three pieces, each under the relay’s 2 MB per attachment', { timeout: 90000 }, async () => {
  const before = [...relay.state.topics.values()].flat().filter((m) => m.attachment?.size > 1_000_000).length;
  const url = `${site.url}/files/large.pdf`;
  const pdfPage = await ctx.newPage();
  await pdfPage.goto(url).catch(() => {});
  let tabId;
  for (let i = 0; i < 50 && tabId == null; i++) { tabId = await tabIdFor(url); if (tabId == null) await new Promise((r) => setTimeout(r, 100)); }
  const popup = await openPopup(tabId);
  await popup.click('#send-page');
  await popup.waitForFunction((re) => new RegExp(re).test(document.querySelector('#status').textContent), SENT.source, { timeout: 60000 });
  const items = await receive(3, { timeout: 60000 });
  const file = items.find((i) => i.header.url === url);
  assert.ok(file, 'the large PDF arrived');
  assert.equal(file.header.size, LARGE_PDF.length);
  assert.deepEqual(file.content, LARGE_PDF);
  const big = [...relay.state.topics.values()].flat().filter((m) => m.attachment?.size > 1_000_000);
  assert.equal(big.length - before, 3, 'three frames');
  assert.ok(big.every((m) => m.attachment.size <= 2_000_000), big.map((m) => m.attachment.size).join(', '));
  await popup.close();
  await pdfPage.close();
});

test('"Send link only", a page over 8 MB, the PDF-link menu and the shortcut', { timeout: 90000 }, async () => {
  const page = await ctx.newPage();
  await page.goto(`${site.url}/article.html`);
  const tabId = await tabIdFor(`${site.url}/article.html`);
  const popup = await openPopup(tabId);
  await popup.click('#send-link');
  await popup.waitForFunction((re) => new RegExp(re).test(document.querySelector('#status').textContent), SENT.source);

  const big = await ctx.newPage();
  await big.goto(`${site.url}/big.html`);
  const bigPopup = await openPopup(await tabIdFor(`${site.url}/big.html`));
  await bigPopup.click('#send-page');
  await bigPopup.waitForFunction(() => /^The page is larger than 8 MB, so its link was sent\. Sent · waiting for your Daylight\./.test(document.querySelector('#status').textContent));

  // The context menu and keyboard shortcut handlers, called as Chrome calls them (automation can't open the menu).
  const tab = await sw.evaluate((id) => chrome.tabs.get(id), tabId);
  await sw.evaluate(async ([t, u]) => self.sendToDaylight.onMenu({ menuItemId: 'dls-pdf-link', linkUrl: u, frameId: 0, pageUrl: t.url }, t), [tab, `${site.url}/files/paper.pdf`]);
  await sw.evaluate(async (t) => self.sendToDaylight.onMenu({ menuItemId: 'dls-link', linkUrl: 'https://example.com/next', frameId: 0, pageUrl: t.url }, t), tab);
  await sw.evaluate(async (t) => self.sendToDaylight.onCommand('send-page', t), tab);

  const items = await receive(8);
  const later = items.slice(3);
  const urls = later.filter((i) => i.header.kind === 'url');
  assert.ok(urls.find((i) => i.header.url === `${site.url}/article.html` && i.header.title === 'A quiet article'), 'link only');
  assert.ok(urls.find((i) => i.header.url === `${site.url}/big.html`), 'big page as its link');
  assert.ok(urls.find((i) => i.header.url === 'https://example.com/next' && i.header.title === 'the next story'), 'link menu with the link text');
  const pdfLink = later.find((i) => i.header.kind === 'file');
  assert.equal(pdfLink.header.title, 'Read the paper (PDF)');
  assert.deepEqual(pdfLink.content, PDF);
  assert.ok(later.find((i) => i.header.kind === 'page'), 'shortcut sent the page');
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), LAB ? '…' : '✓', 'Lab: on its way until delivered');
  await Promise.all([popup.close(), bigPopup.close(), page.close(), big.close()]);
});

test('the popup shows Delivered ✓ once the Daylight acknowledges', { timeout: 60000 }, async () => {
  await receiver.pollOnce(); // the Daylight acks everything it has
  const popup = await openPopup();
  // Opening the popup checks for acks; it then polls while anything is on its way.
  await popup.waitForFunction(() => {
    const items = [...document.querySelectorAll('#history li')];
    return items.length === 5 && items.every((li) => li.dataset.status === 'delivered');
  }, null, { timeout: 30000 });
  assert.match(await popup.textContent('#history li .st'), /Delivered ✓/);
  assert.equal(await popup.textContent('#history li .sentence'), 'Saved on your Daylight.');
  const rows = await sw.evaluate(async () => (await chrome.storage.local.get('outbox')).outbox);
  assert.equal(rows.length, 8);
  assert.ok(rows.every((r) => r.status === 'delivered'), JSON.stringify(rows.map((r) => r.status)));
  const keys = await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)));
  assert.equal(keys.filter((k) => k.startsWith('outbox/')).length, 0, 'content copies dropped once delivered');
  await popup.screenshot({ path: path.join(OUT, 'popup-delivered.png') });
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.screenshot({ path: path.join(OUT, 'popup-delivered-dark.png') });
  await popup.close();
});

test('the alarm and context menus are registered', { timeout: 30000 }, async () => {
  const alarm = await sw.evaluate(() => chrome.alarms.get('dls-tick'));
  assert.equal(alarm?.periodInMinutes, 15);
  // Creating a menu with an existing id fails: proves start() created all three (an invalid PDF-link pattern would
  // have made Chrome refuse that one).
  for (const id of ['dls-page', 'dls-link', 'dls-pdf-link']) {
    const err = await sw.evaluate((i) => new Promise((r) => chrome.contextMenus.create({ id: i, title: 'x' }, () => r(chrome.runtime.lastError?.message ?? ''))), id);
    assert.match(err, /duplicate id/i, id);
  }
});

test('relay trouble reads as in every app: Waiting to send with Retry now, the full relay’s sentence, Remove', { timeout: 60000 }, async () => {
  const page = await ctx.newPage();
  await page.goto(`${site.url}/article.html`);
  const popup = await openPopup(await tabIdFor(`${site.url}/article.html`));
  const status = () => popup.textContent('#status');
  try {
    relayTrouble.status = 429;
    await popup.click('#send-link');
    await popup.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Waiting to send.'));
    assert.equal(await status(), 'Waiting to send. Couldn’t send right now. It will try again by itself.');
    const failed = `${WAITING_LIST} li[data-status="failed"]`;
    await popup.waitForSelector(`${failed} .retry`);
    assert.equal(await popup.textContent(`${failed} .st`), 'Waiting to send');
    assert.equal(await popup.textContent(`${failed} .retry`), 'Retry now');
    assert.equal(await popup.textContent(`${failed} .sentence`), 'Couldn’t send right now. It will try again by itself.');
    if (LAB) {
      // F01.4 with Lab on: v1.1's Retry now beside the queue's Cancel, under "Waiting to send (1)".
      assert.equal(await popup.textContent('#lab-queue-h'), 'Waiting to send (1)');
      assert.equal(await popup.textContent(`${failed} .remove`), 'Cancel');
      assert.equal(await popup.locator('#history li[data-status="failed"]').count(), 0, 'in the queue, not in Recent');
    }
    await popup.screenshot({ path: path.join(OUT, 'popup-waiting.png') });
    relayTrouble.status = 0;
    await popup.click(`${failed} .retry`);
    await popup.waitForFunction((re) => new RegExp(re).test(document.querySelector('#status').textContent), SENT.source);

    relayTrouble.status = 413;
    await popup.click('#send-link');
    await popup.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Waiting to send.'));
    assert.equal(await status(), 'Waiting to send. A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.');
    await popup.waitForSelector(failed);
    assert.equal(await popup.$(`${failed} .retry`), null, 'no button: it sends by itself');
    const n = await popup.$$eval('#history li', (li) => li.length);
    const rowsBefore = (await sw.evaluate(async () => (await chrome.storage.local.get('outbox')).outbox)).length;
    await popup.click(`${failed} .remove`);
    await popup.waitForFunction((sel) => !document.querySelector(sel), failed);
    assert.equal(await popup.$$eval('#history li', (li) => li.length), n, 'the list fills up from older rows');
    const rows = await sw.evaluate(async () => (await chrome.storage.local.get('outbox')).outbox);
    assert.equal(rows.length, rowsBefore - 1, 'Remove drops the row');
  } finally {
    relayTrouble.status = 0;
    await popup.close();
    await page.close();
  }
});

test('Change pairing: the relay in use is filled in; the same code on a new relay applies with the module’s notice; another code asks first', { timeout: 60000 }, async () => {
  const page = await ctx.newPage();
  await page.goto(`${site.url}/article.html`);
  const tabId = await tabIdFor(`${site.url}/article.html`);
  const popup = await openPopup(tabId);
  const outbox = async () => (await sw.evaluate(async () => (await chrome.storage.local.get('outbox')).outbox)) ?? [];
  const kept = (await outbox()).length;
  assert.ok(kept > 0);
  await popup.click('#open-settings');
  await openRepair(popup);
  await popup.waitForSelector('#view-pair:not([hidden])');
  assert.equal(await popup.isVisible('#pair-back'), true, 'a way back while paired');
  // Advanced > Relay URL holds the relay in use, so a typed code doesn't silently move this browser to ntfy.sh.
  assert.equal(await popup.inputValue('#relay'), relay.url);
  assert.equal(await popup.evaluate(() => document.querySelector('#advanced').open), true);

  // Another Daylight's code: the question, in the module's words; Cancel changes nothing.
  const other = ds.generateSecret();
  await popup.fill('#code', await ds.formatCode(other));
  await popup.click('#pair-btn');
  await popup.waitForSelector('#view-confirm:not([hidden])');
  const expected = ds.pairingConfirmation({ secret, relay: relay.url, name: 'E2E Daylight' }, { secret: other, relay: relay.url, name: '' }, { source: 'app' });
  assert.equal(await popup.textContent('#confirm-h'), expected.title);
  assert.deepEqual(await popup.$$eval('#confirm-lines p', (ps) => ps.map((p) => p.textContent)), expected.lines);
  assert.equal(await popup.textContent('#confirm-yes'), 'Switch');
  await popup.screenshot({ path: path.join(OUT, 'popup-switch.png') });
  await popup.click('#confirm-no');
  await popup.waitForSelector('#view-pair:not([hidden])');
  await pairViewReady(popup);
  assert.equal((await outbox()).length, kept, 'Cancel keeps the outbox');

  // The same code typed again (to rename this browser): no question, and the relay stays.
  await popup.fill('#code', await ds.formatCode(secret));
  await popup.fill('#from', 'E2E Chrome, renamed');
  await popup.click('#pair-btn');
  await popup.waitForSelector('#view-send:not([hidden])');
  assert.equal(await pairedStatus(popup, 'Pairing updated.'), 'Pairing updated.');
  assert.equal(await sw.evaluate(async () => (await chrome.storage.local.get('pairing')).pairing.relay), relay.url);
  assert.equal((await outbox()).length, kept);

  // The same Daylight on another relay: no question; the outbox stays and the next send goes through the new relay.
  await popup.click('#open-settings');
  await openRepair(popup);
  await popup.fill('#code', await ds.formatCode(secret));
  await popup.fill('#relay', relay2.url);
  await popup.click('#pair-btn');
  await popup.waitForSelector('#view-send:not([hidden])');
  const moved = `Pairing updated: now sending through ${ds.relayHost(relay2.url)}.`;
  assert.equal(await pairedStatus(popup, moved), moved);
  assert.equal(await popup.textContent('#daylight-name'), 'E2E Daylight', 'a typed code keeps the name');
  assert.equal((await outbox()).length, kept);
  await popup.click('#send-link');
  await popup.waitForFunction((re) => new RegExp(re).test(document.querySelector('#status').textContent), SENT.source);
  const r2 = new ds.Receiver({ pairing: { secret, relay: relay2.url }, storage: new ds.MemoryStorage() });
  const { items } = await r2.pollOnce();
  assert.deepEqual(items.map((i) => i.header.url), [`${site.url}/article.html`]);

  // Switch: the old outbox goes.
  await popup.click('#open-settings');
  await openRepair(popup);
  assert.equal(await popup.inputValue('#relay'), relay2.url);
  await popup.fill('#code', await ds.formatCode(other));
  await popup.fill('#relay', relay.url);
  await popup.click('#pair-btn');
  await popup.waitForSelector('#view-confirm:not([hidden])');
  await popup.click('#confirm-yes');
  await popup.waitForSelector('#view-send:not([hidden])');
  assert.equal(await pairedStatus(popup, 'Paired with your Daylight.'), 'Paired with your Daylight.');
  assert.deepEqual(await outbox(), []);
  assert.equal(await popup.$$eval('#history li', (li) => li.length), 0);
  await popup.close();
  await page.close();
});
