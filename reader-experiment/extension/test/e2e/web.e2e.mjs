// End to end for the web sender in a real Chromium: pairing from a #pair= link (asked first on the page, protocol 1.1),
// sending a link, a PDF and a 5 MB file (three pieces under the relay's 2 MB), refusing one over 9 MB before reading
// it, the iPhone Shortcut's ?url=…&autosend=1 and #…&url= forms, Android's share target (POST through the service
// worker; one over 9 MB is refused by name and size), offline use with Retry now, another Daylight's link, Change
// pairing (the relay in use filled in), and "Delivered ✓" after the Daylight (a Receiver from daylight-share.js)
// acknowledges.
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
const LARGE_PDF = makePdf({ pages: 2, fillerBytes: 5_000_000 }); // over the relay's 2 MB per attachment: three pieces
const w = webBuilt();
const ds = await w.load('daylight-share.js');
const SENT = 'Sent · waiting for your Daylight.';
/** The question on the page (PROTOCOL 1.3): -> {title, lines, button}. */
async function question(page) {
  await page.waitForSelector('#view-confirm:not([hidden])');
  return {
    title: await page.textContent('#confirm-h'),
    lines: await page.$$eval('#confirm-lines p', (ps) => ps.map((p) => p.textContent)),
    button: await page.textContent('#confirm-yes'),
  };
}
/** Waits until #status starts with text. */
const statusStarts = (page, text, opts) => page.waitForFunction((t) => (document.querySelector('#status')?.textContent ?? '').startsWith(t), text, opts);

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

  // A pairing from outside the page asks first (PROTOCOL 1.3), on the page, in the protocol module's words.
  await page.goto(`${site.url}/#pair=${encodeURIComponent(link)}`);
  const q = await question(page);
  const c = ds.pairingConfirmation(null, await ds.parsePairing(link), { source: 'link' });
  assert.deepEqual(q, { title: c.title, lines: c.lines, button: 'Pair' });
  assert.equal(q.title, 'Pair with Web Daylight?');
  assert.match(q.lines.join('\n'), /^Code starts [A-Z2-7]{4}\. Check it matches the code on your Daylight\.\nSends through 127\.0\.0\.1:\d+\.$/);
  assert.equal(await page.textContent('#confirm-lines .code-start'), c.lines[0].slice(12, 16));
  await page.screenshot({ path: path.join(OUT, 'web-pair-question.png') });
  await page.click('#confirm-yes');
  await page.waitForFunction(() => document.querySelector('#daylight-name')?.textContent === 'Web Daylight');
  // The status line is set with the view (app.js renderSend), but wait for it all the same: under load the history and
  // the Lab follow-up still load after it, and nothing here should depend on how long they take.
  await statusStarts(page, 'Paired with Web Daylight.');
  assert.equal(await page.textContent('#status'), 'Paired with Web Daylight.');
  assert.equal(new URL(page.url()).hash, '', 'the pairing secret is removed from the address');

  await page.fill('#url', 'example.com/story');
  await page.fill('#title', 'A typed story');
  await page.click('#send-url');
  await statusStarts(page, SENT);
  assert.equal(await page.inputValue('#url'), '');

  await page.setInputFiles('#file', { name: 'Field notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from(PDF) });
  await page.waitForFunction(() => document.querySelector('#history li .item-title')?.textContent === 'Field notes');
  await statusStarts(page, SENT);

  const items = await receive(2);
  const url = items.find((i) => i.header.kind === 'url');
  assert.equal(url.header.url, 'https://example.com/story');
  assert.equal(url.header.title, 'A typed story');
  assert.match(url.header.from, /\(web\)$/);
  assert.equal(url.header.app, 'web/1.1.0');
  const file = items.find((i) => i.header.kind === 'file');
  assert.equal(file.header.name, 'Field notes.pdf');
  assert.equal(file.header.title, 'Field notes');
  assert.equal(file.header.mime, 'application/pdf');
  assert.deepEqual(file.content, PDF);
});

test('a 5 MB file travels in three pieces, each under the relay’s 2 MB per attachment', { timeout: 90000 }, async () => {
  const big = () => [...relay.state.topics.values()].flat().filter((m) => m.attachment?.size > 1_000_000);
  const before = big().length;
  await page.setInputFiles('#file', { name: 'Large scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(LARGE_PDF) });
  await page.waitForFunction(() => document.querySelector('#history li .item-title')?.textContent === 'Large scan');
  await statusStarts(page, SENT, { timeout: 60000 });
  const items = await receive(3, 60000);
  const file = items.find((i) => i.header.name === 'Large scan.pdf');
  assert.deepEqual(file.content, LARGE_PDF);
  assert.equal(big().length - before, 3, 'three frames');
  assert.ok(big().every((m) => m.attachment.size <= 2_000_000), big().map((m) => m.attachment.size).join(', '));
});

test('a file over 9 MB is refused before it is read, in the protocol’s words', { timeout: 60000 }, async () => {
  await page.evaluate(() => {
    window.__reads = 0;
    for (const m of ['arrayBuffer', 'text', 'stream', 'slice']) {
      const orig = Blob.prototype[m];
      Blob.prototype[m] = function (...a) { window.__reads++; return orig.apply(this, a); };
    }
  });
  const rows = await page.$$eval('#history li', (li) => li.length);
  await page.setInputFiles('#file', { name: 'Too big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(9_000_001, 1) });
  await statusStarts(page, 'Too big to send.');
  assert.equal(await page.textContent('#status'), ds.tooBigMessage(9_000_001));
  assert.equal(await page.textContent('#status'), 'Too big to send. Files can be up to 9 MB; this one is 9.1 MB.');
  assert.equal(await page.evaluate(() => window.__reads), 0, 'the file was not read');
  assert.equal(await page.$$eval('#history li', (li) => li.length), rows, 'nothing was queued');
  await page.reload(); // drop the patched Blob
  await ready(page);
});

test('an iPhone Shortcut link (?url=…&title=…&autosend=1) sends at once', { timeout: 60000 }, async () => {
  await page.goto(`${site.url}/?url=${encodeURIComponent('https://example.com/a?b=1&c=2')}&title=${encodeURIComponent('From the Shortcut')}&autosend=1`);
  await page.waitForFunction(() => document.querySelector('#history li .item-title')?.textContent === 'From the Shortcut');
  await statusStarts(page, SENT);
  assert.equal(new URL(page.url()).search, '', 'a reload does not send it again');
  const items = await receive(4);
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
  await page.waitForFunction(() => document.querySelector('#history li .item-title')?.textContent === 'shared paper');
  await statusStarts(page, SENT);

  // A share of a link from Chrome on Android: the address comes in "text".
  await page.evaluate(() => {
    const form = Object.assign(document.createElement('form'), { method: 'POST', action: 'share-target', enctype: 'multipart/form-data' });
    form.append(Object.assign(document.createElement('input'), { name: 'title', value: 'Shared story' }));
    form.append(Object.assign(document.createElement('input'), { name: 'text', value: 'https://example.com/shared' }));
    document.body.append(form);
    form.submit();
  });
  await page.waitForFunction(() => document.querySelector('#history li .item-title')?.textContent === 'Shared story');
  await statusStarts(page, SENT);

  const items = await receive(6);
  const file = items.find((i) => i.header.name === 'shared paper.pdf');
  assert.ok(file, 'the shared file arrived');
  assert.deepEqual(file.content, PDF);
  const shared = items.find((i) => i.header.url === 'https://example.com/shared');
  assert.equal(shared.header.title, 'Shared story');

  // A file over 9 MB: the service worker keeps only its name and size (never a copy of it) ...
  const stored = await page.evaluate(async () => {
    const fd = new FormData();
    fd.append('files', new File([new Uint8Array(9_000_001)], 'Huge scan.pdf', { type: 'application/pdf' }));
    fd.append('files', new File([new Uint8Array(10)], 'small.txt', { type: 'text/plain' }));
    await fetch('share-target', { method: 'POST', body: fd }); // through the service worker, as a share arrives
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('send-to-daylight', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    // What the service worker kept for the page (the page never opened it: take it out of the store here).
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction('shared', 'readwrite');
      const st = tx.objectStore('shared');
      const g = st.getAll();
      g.onsuccess = () => { st.clear(); resolve(g.result); };
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const e = all.find((x) => x.files?.some((f) => f.name === 'Huge scan.pdf'));
    return e.files.map((f) => ({ name: f.name, size: f.size, kept: f.blob ? f.blob.size : null, noSpace: !!f.noSpace }));
  });
  assert.deepEqual(stored, [
    { name: 'Huge scan.pdf', size: 9_000_001, kept: null, noSpace: false },
    { name: 'small.txt', size: 10, kept: 10, noSpace: false },
  ]);
  // ... and the page refuses it in the protocol's words.
  const rows = await page.$$eval('#history li', (li) => li.length);
  await page.evaluate(() => {
    const form = Object.assign(document.createElement('form'), { method: 'POST', action: 'share-target', enctype: 'multipart/form-data' });
    const input = Object.assign(document.createElement('input'), { type: 'file', name: 'files' });
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(9_000_001)], 'Huge scan.pdf', { type: 'application/pdf' }));
    input.files = dt.files;
    form.append(input);
    document.body.append(form);
    form.submit();
  });
  await statusStarts(page, 'Too big to send.', { timeout: 30000 });
  assert.equal(await page.textContent('#status'), 'Too big to send. Files can be up to 9 MB; this one is 9.1 MB.');
  assert.equal(await page.$$eval('#history li', (li) => li.length), rows, 'nothing was queued');
  assert.equal(new URL(page.url()).search, '');
});

test('offline: the page still opens, a send waits with Retry now, and Retry now sends it once back online', { timeout: 60000 }, async () => {
  await ctx.setOffline(true);
  await page.reload();
  await ready(page);
  assert.equal(await page.textContent('#daylight-name'), 'Web Daylight');
  await page.fill('#url', 'https://example.com/offline');
  await page.click('#send-url');
  const failed = '#history li[data-status="failed"]';
  await page.waitForSelector(`${failed} .retry`, { timeout: 30000 });
  await statusStarts(page, 'Waiting to send.'); // the history row can show before the send's status line is set
  assert.equal(await page.textContent('#status'), 'Waiting to send. Couldn’t send right now. It will try again by itself.');
  assert.equal(await page.textContent(`${failed} .st`), 'Waiting to send');
  assert.equal(await page.textContent(`${failed} .retry`), 'Retry now');
  assert.equal(await page.textContent(`${failed} .sentence`), 'Couldn’t send right now. It will try again by itself.');
  await page.screenshot({ path: path.join(OUT, 'web-waiting.png') });
  await ctx.setOffline(false);
  await page.click(`${failed} .retry`);
  await statusStarts(page, SENT);
  const items = await receive(7);
  assert.ok(items.find((i) => i.header.url === 'https://example.com/offline'));
});

test('#pair= for another Daylight asks and says it replaces this one; Cancel keeps it; the same link applies at once', { timeout: 60000 }, async () => {
  const other = await ds.pairingLink({ secret: ds.generateSecret(), relay: relay.url, name: 'Other Daylight' });
  await page.goto(`${site.url}/#pair=${encodeURIComponent(other)}`);
  const q = await question(page);
  const c = ds.pairingConfirmation({ secret, relay: relay.url, name: 'Web Daylight' }, await ds.parsePairing(other), { source: 'link' });
  assert.deepEqual(q, { title: c.title, lines: c.lines, button: 'Switch' });
  assert.equal(q.lines.at(-1), 'This replaces Web Daylight. Items not yet delivered to it will not be sent.');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'confirm-no', 'Enter means Cancel');
  await page.screenshot({ path: path.join(OUT, 'web-switch-question.png') });
  await page.click('#confirm-no');
  await statusStarts(page, 'Still sending to Web Daylight.');
  assert.equal(await page.textContent('#daylight-name'), 'Web Daylight');
  assert.equal(await page.$$eval('#history li', (li) => li.length), 7, 'the history is kept');

  // The paired Daylight's own link (the iPhone Shortcut carries it every time): no question.
  await page.goto(`${site.url}/#pair=${encodeURIComponent(link)}`);
  await statusStarts(page, 'Pairing updated.');
  assert.equal(await page.isVisible('#view-confirm'), false, 'no question for the same Daylight');
  assert.equal(await page.$$eval('#history li', (li) => li.length), 7);
});

test('Change pairing…: the relay in use is filled in, so the same code keeps it; another code asks on the page', { timeout: 60000 }, async () => {
  await page.click('#open-settings');
  await page.click('#repair');
  await page.waitForSelector('#view-pair:not([hidden])');
  assert.equal(await page.inputValue('#relay'), relay.url, 'Advanced > Relay URL holds the relay in use');
  assert.equal(await page.evaluate(() => document.querySelector('#advanced').open), true);
  // The same code typed again, to rename this device: no question, the relay stays.
  await page.fill('#code', await ds.formatCode(secret));
  await page.fill('#from', 'Renamed browser');
  await page.click('#pair-btn');
  await page.waitForSelector('#view-send:not([hidden])');
  await statusStarts(page, 'Pairing updated.');
  assert.equal(await page.textContent('#status'), 'Pairing updated.');
  await page.click('#open-settings');
  assert.equal(await page.textContent('#set-relay-2'), relay.url.replace(/^https?:\/\//, ''));
  assert.equal(await page.$$eval('#history li', (li) => li.length), 7);

  // Another Daylight's code: the page's own question, Switch and Cancel; Cancel returns to the form as typed.
  await page.click('#repair');
  const otherCode = await ds.formatCode(ds.generateSecret());
  await page.fill('#code', otherCode);
  await page.click('#pair-btn');
  const q = await question(page);
  assert.equal(q.button, 'Switch');
  assert.ok(q.lines.includes(`Sends through ${ds.relayHost(relay.url)}.`), q.lines.join(' | '));
  assert.equal(q.lines.at(-1), 'This replaces Web Daylight. Items not yet delivered to it will not be sent.');
  await page.click('#confirm-no');
  await page.waitForSelector('#view-pair:not([hidden])');
  assert.equal(await page.inputValue('#code'), otherCode);
  await page.click('#pair-back');
  await page.waitForSelector('#view-send:not([hidden])');
  assert.equal(await page.textContent('#daylight-name'), 'Web Daylight');
  assert.equal(await page.$$eval('#history li', (li) => li.length), 7);
});

test('Delivered ✓ once the Daylight acknowledges', { timeout: 60000 }, async () => {
  await receiver.pollOnce(); // acks everything
  await page.reload();
  await ready(page);
  await page.waitForFunction(() => {
    const li = [...document.querySelectorAll('#history li')];
    return li.length === 7 && li.every((x) => x.dataset.status === 'delivered');
  }, null, { timeout: 20000 });
  assert.equal(await page.textContent('#history li .sentence'), 'Saved on your Daylight.');
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
  const q = await question(p);
  assert.equal(q.title, 'Pair with Web Daylight?');
  assert.equal(q.button, 'Pair');
  await p.click('#confirm-yes');
  await statusStarts(p, SENT);
  const items = await receive(8);
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
  await statusStarts(p, SENT);
  const items = await receive(9);
  assert.equal(items.at(-1).header.url, 'https://example.com/later');
  await c.close();
});
