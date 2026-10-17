// End to end in a real Chromium: the unpacked extension (test build: dist/chrome plus access to 127.0.0.1, because
// automation can't click the toolbar button that grants activeTab), the mock ntfy relay, a local site with an article
// and a PDF, and a Receiver from daylight-share.js playing the Daylight.
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

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'test-results');
const PDF = makePdf({ pages: 4, fillerBytes: 300_000 }); // over one ntfy message: travels as an attachment
const b = built('chrome-test');
const ds = await b.load('daylight-share.js');

let relay, site, ctx, sw, extId, receiver, secret;
const received = [];

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

async function openPopup(tabId) {
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup.html${tabId != null ? `?tab=${tabId}` : ''}`);
  await popup.waitForSelector('body[data-ready="1"]');
  return popup;
}

before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  relay = await startMockRelay();
  site = await startSite({ pdf: PDF });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-profile-'));
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', // the full Chromium in new headless mode: extensions work there
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${b.dir}`, `--load-extension=${b.dir}`],
  });
  [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  extId = new URL(sw.url()).host;
  secret = ds.generateSecret();
  receiver = new ds.Receiver({ pairing: { secret, relay: relay.url }, storage: new ds.MemoryStorage() });
});

after(async () => {
  await ctx?.close();
  await relay?.close();
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
  await popup.waitForFunction(() => /^Sent\./.test(document.querySelector('#status').textContent));
  await popup.waitForSelector('#history li[data-status="sent"], #history li[data-status="delivered"]');
  await popup.screenshot({ path: path.join(OUT, 'popup-sent.png') });

  const [item] = await receive(1);
  assert.equal(item.header.kind, 'page');
  assert.equal(item.header.url, `${site.url}/article.html`);
  assert.equal(item.header.title, 'A quiet article');
  assert.equal(item.header.from, 'E2E Chrome');
  assert.match(item.header.app, /^chrome\/\d+\.\d+\.\d+$/);
  assert.equal(item.header.enc, 'deflate-raw');
  const html = new TextDecoder().decode(item.content);
  assert.match(html, /^<!DOCTYPE html>\n<html lang="en">/);
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
  await popup.waitForFunction(() => /^Sent\./.test(document.querySelector('#status').textContent), null, { timeout: 30000 });

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

test('"Send link only", a page over 8 MB, the PDF-link menu and the shortcut', { timeout: 90000 }, async () => {
  const page = await ctx.newPage();
  await page.goto(`${site.url}/article.html`);
  const tabId = await tabIdFor(`${site.url}/article.html`);
  const popup = await openPopup(tabId);
  await popup.click('#send-link');
  await popup.waitForFunction(() => /^Sent\. The link/.test(document.querySelector('#status').textContent));

  const big = await ctx.newPage();
  await big.goto(`${site.url}/big.html`);
  const bigPopup = await openPopup(await tabIdFor(`${site.url}/big.html`));
  await bigPopup.click('#send-page');
  await bigPopup.waitForFunction(() => /larger than 8 MB/.test(document.querySelector('#status').textContent));

  // The context menu and keyboard shortcut handlers, called as Chrome calls them (automation can't open the menu).
  const tab = await sw.evaluate((id) => chrome.tabs.get(id), tabId);
  await sw.evaluate(async ([t, u]) => self.sendToDaylight.onMenu({ menuItemId: 'dls-pdf-link', linkUrl: u, frameId: 0, pageUrl: t.url }, t), [tab, `${site.url}/files/paper.pdf`]);
  await sw.evaluate(async (t) => self.sendToDaylight.onMenu({ menuItemId: 'dls-link', linkUrl: 'https://example.com/next', frameId: 0, pageUrl: t.url }, t), tab);
  await sw.evaluate(async (t) => self.sendToDaylight.onCommand('send-page', t), tab);

  const items = await receive(7);
  const later = items.slice(2);
  const urls = later.filter((i) => i.header.kind === 'url');
  assert.ok(urls.find((i) => i.header.url === `${site.url}/article.html` && i.header.title === 'A quiet article'), 'link only');
  assert.ok(urls.find((i) => i.header.url === `${site.url}/big.html`), 'big page as its link');
  assert.ok(urls.find((i) => i.header.url === 'https://example.com/next' && i.header.title === 'the next story'), 'link menu with the link text');
  const pdfLink = later.find((i) => i.header.kind === 'file');
  assert.equal(pdfLink.header.title, 'Read the paper (PDF)');
  assert.deepEqual(pdfLink.content, PDF);
  assert.ok(later.find((i) => i.header.kind === 'page'), 'shortcut sent the page');
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '✓');
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
  const rows = await sw.evaluate(async () => (await chrome.storage.local.get('outbox')).outbox);
  assert.equal(rows.length, 7);
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
  // Creating a menu with an existing id fails: proves start() created them.
  const err = await sw.evaluate(() => new Promise((r) => chrome.contextMenus.create({ id: 'dls-page', title: 'x' }, () => r(chrome.runtime.lastError?.message ?? ''))));
  assert.match(err, /duplicate id/i);
});
