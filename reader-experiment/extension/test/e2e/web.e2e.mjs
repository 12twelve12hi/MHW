// End to end for the web sender in a real Chromium: pairing from a #pair= link, sending a link and a PDF, the iPhone
// Shortcut's ?url=…&autosend=1 and #…&url= forms, Android's share target (POST through the service worker),
// offline use, and "Delivered ✓" after the Daylight (a Receiver from daylight-share.js) acknowledges.
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/e2e/web.e2e.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { webBuilt } from '../helpers/web-built.mjs';
import { makePdf } from '../helpers/pdf.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'test-results');
const PDF = makePdf({ pages: 2, fillerBytes: 50_000 });
const w = webBuilt();
const ds = await w.load('daylight-share.js');

let relay, site, browser, receiver, secret, link;
const received = [];

async function receive(n, timeout = 20000) {
  const until = Date.now() + timeout;
  while (received.length < n && Date.now() < until) {
    received.push(...(await receiver.pollOnce()).items);
    if (received.length < n) await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(received.length >= n, `expected ${n} items, got ${received.length}`);
  return received;
}

async function ready(page) {
  await page.waitForSelector('body[data-ready="1"]');
}

before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  relay = await startMockRelay();
  site = await w.serve();
  browser = await chromium.launch({ channel: 'chromium', headless: !process.env.HEADED });
  secret = ds.generateSecret();
  link = await ds.pairingLink({ secret, relay: relay.url, name: 'Web Daylight' });
  receiver = new ds.Receiver({ pairing: { secret, relay: relay.url }, storage: new ds.MemoryStorage() });
});

after(async () => {
  await browser?.close();
  await relay?.close();
  await site?.close();
});

let ctx, page;

test('pair in one tap from a #pair= link, then send a typed link and a PDF', { timeout: 60000 }, async () => {
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await ctx.newPage();
  await page.goto(`${site.url}/`);
  await ready(page);
  assert.equal(await page.isVisible('#view-pair'), true);
  await page.screenshot({ path: path.join(OUT, 'web-pair.png') });

  await page.goto(`${site.url}/#pair=${encodeURIComponent(link)}`);
  await page.waitForFunction(() => document.querySelector('#daylight-name')?.textContent === 'Web Daylight');
  assert.equal(new URL(page.url()).hash, '', 'the pairing secret is removed from the address');

  await page.fill('#url', 'example.com/story');
  await page.fill('#title', 'A typed story');
  await page.click('#send-url');
  await page.waitForFunction(() => /^Sent ✓/.test(document.querySelector('#status').textContent));
  assert.equal(await page.inputValue('#url'), '');

  await page.setInputFiles('#file', { name: 'Field notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from(PDF) });
  await page.waitForFunction(() => /^Sent ✓ The file/.test(document.querySelector('#status').textContent));

  const items = await receive(2);
  const url = items.find((i) => i.header.kind === 'url');
  assert.equal(url.header.url, 'https://example.com/story');
  assert.equal(url.header.title, 'A typed story');
  assert.match(url.header.from, /\(web\)$/);
  assert.equal(url.header.app, 'web/1.0.0');
  const file = items.find((i) => i.header.kind === 'file');
  assert.equal(file.header.name, 'Field notes.pdf');
  assert.equal(file.header.title, 'Field notes');
  assert.equal(file.header.mime, 'application/pdf');
  assert.deepEqual(file.content, PDF);
});

test('an iPhone Shortcut link (?url=…&title=…&autosend=1) sends at once', { timeout: 60000 }, async () => {
  await page.goto(`${site.url}/?url=${encodeURIComponent('https://example.com/a?b=1&c=2')}&title=${encodeURIComponent('From the Shortcut')}&autosend=1`);
  await page.waitForFunction(() => /^Sent ✓ The link/.test(document.querySelector('#status').textContent));
  assert.equal(new URL(page.url()).search, '', 'a reload does not send it again');
  const items = await receive(3);
  const it = items.at(-1);
  assert.equal(it.header.url, 'https://example.com/a?b=1&c=2');
  assert.equal(it.header.title, 'From the Shortcut');
});

test('Android share sheet: the service worker takes the POSTed file and link and the page sends them', { timeout: 60000 }, async () => {
  await page.goto(`${site.url}/`);
  await ready(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await ready(page);
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true, 'the service worker controls the page');

  // A share of a file, posted the way Chrome posts to a share target.
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const form = Object.assign(document.createElement('form'), { method: 'POST', action: 'share-target', enctype: 'multipart/form-data' });
    const input = Object.assign(document.createElement('input'), { type: 'file', name: 'files' });
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'shared paper.pdf', { type: 'application/pdf' }));
    input.files = dt.files;
    const title = Object.assign(document.createElement('input'), { name: 'title', value: 'Shared paper' });
    form.append(input, title);
    document.body.append(form);
    form.submit();
  }, Buffer.from(PDF).toString('base64'));
  await page.waitForURL((u) => u.pathname === '/' && u.search === '');
  await page.waitForFunction(() => /^Sent ✓ The file/.test(document.querySelector('#status')?.textContent ?? ''));

  // A share of a link from Chrome on Android: the address comes in "text".
  await page.evaluate(() => {
    const form = Object.assign(document.createElement('form'), { method: 'POST', action: 'share-target', enctype: 'multipart/form-data' });
    form.append(Object.assign(document.createElement('input'), { name: 'title', value: 'Shared story' }));
    form.append(Object.assign(document.createElement('input'), { name: 'text', value: 'https://example.com/shared' }));
    document.body.append(form);
    form.submit();
  });
  await page.waitForFunction(() => /^Sent ✓ The link/.test(document.querySelector('#status')?.textContent ?? ''));

  const items = await receive(5);
  const file = items.find((i) => i.header.name === 'shared paper.pdf');
  assert.ok(file, 'the shared file arrived');
  assert.deepEqual(file.content, PDF);
  const shared = items.find((i) => i.header.url === 'https://example.com/shared');
  assert.equal(shared.header.title, 'Shared story');
});

test('offline: the page still opens, a send fails with Retry, and Retry sends it once back online', { timeout: 60000 }, async () => {
  await ctx.setOffline(true);
  await page.reload();
  await ready(page);
  assert.equal(await page.textContent('#daylight-name'), 'Web Daylight');
  await page.fill('#url', 'https://example.com/offline');
  await page.click('#send-url');
  await page.waitForSelector('#history li[data-status="failed"] .retry', { timeout: 30000 });
  await ctx.setOffline(false);
  await page.click('#history li[data-status="failed"] .retry');
  await page.waitForFunction(() => /^Sent ✓/.test(document.querySelector('#status').textContent));
  const items = await receive(6);
  assert.ok(items.find((i) => i.header.url === 'https://example.com/offline'));
});

test('Delivered ✓ once the Daylight acknowledges', { timeout: 60000 }, async () => {
  await receiver.pollOnce(); // acks everything
  await page.reload();
  await ready(page);
  await page.waitForFunction(() => {
    const li = [...document.querySelectorAll('#history li')];
    return li.length === 6 && li.every((x) => x.dataset.status === 'delivered');
  }, null, { timeout: 20000 });
  await page.screenshot({ path: path.join(OUT, 'web-delivered.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(OUT, 'web-delivered-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.click('#open-settings');
  const prefix = await page.textContent('#shortcut-link');
  assert.ok(prefix.startsWith(`${site.url}/#autosend=1&pair=daylightshare%3A%2F%2Fpair%3Fc%3D`), prefix);
  assert.ok(prefix.endsWith('&url='));
  await page.screenshot({ path: path.join(OUT, 'web-settings.png'), fullPage: true });
  await ctx.close();
});

test('a fresh browser opening the Shortcut link (#autosend=1&pair=…&url=…) pairs and sends', { timeout: 60000 }, async () => {
  const c = await browser.newContext();
  const p = await c.newPage();
  const prefix = `${site.url}/#autosend=1&pair=${encodeURIComponent(link)}&url=`;
  await p.goto(prefix + encodeURIComponent('https://example.com/via-shortcut'));
  await p.waitForFunction(() => /^Sent ✓ The link/.test(document.querySelector('#status')?.textContent ?? ''));
  const items = await receive(7);
  assert.equal(items.at(-1).header.url, 'https://example.com/via-shortcut');
  await c.close();
});

test('unpaired autosend waits for pairing, then sends', { timeout: 60000 }, async () => {
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(`${site.url}/?url=${encodeURIComponent('https://example.com/later')}&autosend=1`);
  await ready(p);
  await p.waitForSelector('#pending-share:not([hidden])');
  await p.fill('#code', await ds.formatCode(secret));
  await p.click('#view-pair summary'); // Advanced
  await p.fill('#relay', relay.url);
  await p.click('#pair-btn');
  await p.waitForFunction(() => /^Sent ✓ The link/.test(document.querySelector('#status')?.textContent ?? ''));
  const items = await receive(8);
  assert.equal(items.at(-1).header.url, 'https://example.com/later');
  await c.close();
});
