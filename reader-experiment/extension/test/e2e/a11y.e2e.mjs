// The accessibility baseline (LAB-PLAN F27; not Lab) in a real Chromium, for the extension's popup and the web sender:
//
//   F27.1  axe-core (@axe-core/playwright, pinned in package.json) reports no violations on every view, light and dark,
//          Comfort off and on;
//   F27.4  with Comfort on, at 360 px, no text is cut short or clipped (scrollWidth <= clientWidth and
//          scrollHeight <= clientHeight + 1 for every element with text), and status text still wraps at 200% text;
//   and    every control has a name, Comfort is a switch outside Lab (off by default, kept across pairing changes),
//          a row's new state is announced, and typed-code pairing is always one step away.
//
// lab.html (X0) is held to the same, with Lab on and off: its switch, What's in Lab (with a note open) and the
// Daylight server section, with no server and with a ready one; the popup's Settings with Lab off too.
//
// Screenshots go to test-results/a11y/ (uploaded by CI for review, not compared).
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/e2e/a11y.e2e.mjs      (HEADED=1 to watch)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { built } from '../helpers/built.mjs';
import { webBuilt } from '../helpers/web-built.mjs';
import { startSite } from '../helpers/server.mjs';
import { axe, assertAxeSees, assertNotClipped, unnamed, shot, scaleText, historyRows } from '../helpers/a11y.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';
import { labDefaultWritten } from '../helpers/lab-off.mjs';
import { startFakeWorker, statusJson } from '../helpers/fake-worker.mjs';

const b = built('chrome-test');
const w = webBuilt();
const ds = await b.load('daylight-share.js');
const LAB_TEXT = (await import('../../../share/js/daylight-lab.js')).LAB_TEXT;
const S = await b.load('daylight-server.js');
const STATUS_TEXT = '.status, .st, .note, .error, [role=status], [role=alert]';
const LONG_PAGE = 'A long page title that needs two lines or more in a popup three hundred and sixty pixels wide, at least';

let relay, site, web, ctx, sw, extId, link, otherLink;

async function openPopup(tabId) {
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.goto(`chrome-extension://${extId}/popup.html${tabId != null ? `?tab=${tabId}` : ''}`);
  await popup.waitForSelector('body[data-ready="1"]');
  return popup;
}

const storageSet = (items) => sw.evaluate((i) => chrome.storage.local.set(i), items);
const storageGet = async (key) => (await sw.evaluate((k) => chrome.storage.local.get(k), key))[key];

/** axe in light and dark, and no unnamed control. */
async function axeBoth(page, what) {
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await axe(page, `${what} (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  assert.deepEqual(await unnamed(page), [], `${what}: every control has a name`);
}

/** The Comfort switch, its text and its place (F27, LAB_TEXT, outside Lab). */
async function checkComfortSwitch(page) {
  const sw = page.getByRole('switch', { name: LAB_TEXT.comfort, exact: true });
  await sw.waitFor();
  assert.equal(await page.textContent('#comfort-footer'), LAB_TEXT.comfortFooter);
  assert.equal(await sw.getAttribute('aria-describedby'), 'comfort-footer');
  return sw;
}

before(async () => {
  relay = await startMockRelay();
  site = await startSite();
  site.routes.set('/long.html', { type: 'text/html; charset=utf-8', body: Buffer.from(`<!doctype html><title>${LONG_PAGE}</title><p>Long</p>`) });
  web = await w.serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-a11y-'));
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
  // The Lab default is written before any test seeds settings (LAB-PLAN 1.2), so it never overwrites them.
  await labDefaultWritten(sw);
  link = await ds.pairingLink({ secret: ds.generateSecret(), relay: relay.url, name: 'A11y Daylight' });
  otherLink = await ds.pairingLink({ secret: ds.generateSecret(), relay: relay.url, name: 'Another Daylight' });
});

after(async () => {
  await ctx?.close();
  await relay?.close();
  await site?.close();
  await web?.close();
});

// --- popup ----------------------------------------------------------------------------------------------------------

test('popup, not paired: typed-code pairing, and Comfort in Settings before pairing (off by default, kept)', { timeout: 90000 }, async () => {
  const popup = await openPopup();
  assert.equal(await popup.getByLabel('Pairing code or link').isVisible(), true, 'typed-code pairing');
  assert.equal(await popup.evaluate(() => document.body.classList.contains('comfort')), false, 'Comfort is off by default');
  await assertAxeSees(popup);
  await axeBoth(popup, 'popup: pairing');
  await shot(popup, 'popup-pair');

  await popup.getByRole('button', { name: 'Settings' }).click();
  await popup.waitForSelector('#view-settings:not([hidden])');
  const comfort = await checkComfortSwitch(popup);
  assert.equal(await comfort.isChecked(), false);
  assert.equal(await popup.isVisible('#settings-paired'), false, 'nothing about a pairing before there is one');
  await axeBoth(popup, 'popup: settings, not paired');

  const plain = await popup.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  await comfort.click();
  await popup.waitForFunction(() => document.body.classList.contains('comfort'));
  assert.equal(await comfort.isChecked(), true);
  assert.equal(await popup.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize)), plain * 1.25, 'text at 125%');
  assert.ok(await popup.evaluate(() => [...document.querySelectorAll('button')].filter((x) => x.checkVisibility()).every((x) => x.getBoundingClientRect().height >= 48)), 'buttons at least 48 px high');
  assert.equal(await popup.evaluate(() => getComputedStyle(document.querySelector('#comfort')).transitionDuration), '0s', 'no motion');
  for (let i = 0; i < 20 && !(await storageGet('settings'))?.comfort; i++) await popup.waitForTimeout(50);
  assert.equal((await storageGet('settings'))?.comfort, true, 'kept in storage.local settings');
  await axeBoth(popup, 'popup: settings, not paired, Comfort');
  await assertNotClipped(popup, 'popup: settings, Comfort');
  await shot(popup, 'popup-settings-unpaired-comfort');

  await popup.getByRole('button', { name: '‹ Back' }).click();
  await popup.waitForSelector('#view-pair:not([hidden])');
  await axeBoth(popup, 'popup: pairing, Comfort');
  await popup.click('#advanced summary');
  await assertNotClipped(popup, 'popup: pairing, Comfort');
  await shot(popup, 'popup-pair-comfort');
  await popup.close();

  // A new popup opens in Comfort.
  const again = await openPopup();
  assert.equal(await again.evaluate(() => document.body.classList.contains('comfort')), true);
  await again.close();
  await storageSet({ settings: { comfort: false } });
});

test('popup, paired, every history state: no axe violations, light and dark, Comfort off and on; nothing clipped at 360 px', { timeout: 180000 }, async () => {
  const paired = await sw.evaluate(async (input) => globalThis.sendToDaylight.pair({ input, from: 'A11y Chrome' }), link);
  assert.equal(paired.name, 'A11y Daylight');
  assert.equal((await storageGet('settings'))?.comfort, false, 'pairing leaves Comfort as it was');
  const page = await ctx.newPage();
  await page.goto(`${site.url}/long.html`);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `${site.url}/long.html`);

  for (const comfort of [false, true]) {
    await storageSet({ settings: { from: 'A11y Chrome', comfort }, outbox: historyRows() });
    const popup = await openPopup(tabId);
    const tag = comfort ? ', Comfort' : '';
    assert.equal(await popup.evaluate(() => document.body.classList.contains('comfort')), comfort);
    // Lab is on (W1): the two rows waiting to send are in their own list above Recent (F07), which shows the other
    // four (of five at most).
    assert.equal(await popup.locator('#lab-queue-list li').count(), 2);
    assert.equal(await popup.locator('#history li').count(), 4);
    await axeBoth(popup, `popup: send${tag}`);
    if (comfort) await assertNotClipped(popup, 'popup: send, Comfort');
    await shot(popup, `popup-send${comfort ? '-comfort' : ''}`);
    await popup.emulateMedia({ colorScheme: 'dark' });
    await shot(popup, `popup-send${comfort ? '-comfort' : ''}-dark`);
    await popup.emulateMedia({ colorScheme: 'light' });

    // The PDF permission card.
    await popup.evaluate(() => { document.querySelector('#perm-host').textContent = 'a-long-host-name-for-pdfs.example.org'; document.querySelector('#permission').hidden = false; });
    await axeBoth(popup, `popup: PDF permission${tag}`);
    if (comfort) await assertNotClipped(popup, 'popup: PDF permission, Comfort');
    await popup.evaluate(() => { document.querySelector('#permission').hidden = true; });

    await popup.getByRole('button', { name: 'Settings' }).click();
    await popup.waitForSelector('#view-settings:not([hidden])');
    assert.equal(await (await checkComfortSwitch(popup)).isChecked(), comfort);
    await axeBoth(popup, `popup: settings${tag}`);
    if (comfort) await assertNotClipped(popup, 'popup: settings, Comfort');
    await shot(popup, `popup-settings${comfort ? '-comfort' : ''}`);

    // Typed-code pairing is one step away while paired: Change pairing… Another code asks first.
    await popup.getByRole('button', { name: 'Change pairing…' }).click();
    await popup.waitForSelector('#view-pair:not([hidden])');
    await popup.getByLabel('Pairing code or link').fill(otherLink);
    await popup.click('#pair-btn');
    await popup.waitForSelector('#view-confirm:not([hidden])');
    await axeBoth(popup, `popup: replace the pairing?${tag}`);
    if (comfort) await assertNotClipped(popup, 'popup: replace the pairing?, Comfort');
    await shot(popup, `popup-confirm${comfort ? '-comfort' : ''}`);
    await popup.getByRole('button', { name: 'Cancel' }).click();
    await popup.waitForSelector('#view-pair:not([hidden])');
    assert.equal((await storageGet('pairing')).name, 'A11y Daylight', 'Cancel keeps the pairing');
    await popup.close();
  }
  await page.close();
});

test('popup: status text wraps at 200% text, and a row that changes state is announced', { timeout: 90000 }, async () => {
  const rows = historyRows();
  await storageSet({ settings: { from: 'A11y Chrome', comfort: false }, outbox: rows });
  const page = await ctx.newPage();
  await page.goto(`${site.url}/long.html`);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `${site.url}/long.html`);
  const popup = await openPopup(tabId);
  await popup.evaluate(() => { document.querySelector('#status').textContent = 'Waiting to send. A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.'; });
  await scaleText(popup, 2);
  await assertNotClipped(popup, 'popup: status text at 200%', { only: STATUS_TEXT });
  await shot(popup, 'popup-send-200');
  await scaleText(popup, 1);

  // The Daylight acknowledges the sent row: its new state is said without moving focus.
  rows[0] = { ...rows[0], status: 'delivered', delivered: Date.now() };
  await storageSet({ outbox: rows });
  await popup.waitForFunction(() => document.querySelector('#announce').textContent !== '');
  assert.equal(await popup.textContent('#announce'), `Delivered ✓: ${rows[0].title}`);
  assert.equal(await popup.getAttribute('#announce', 'aria-live'), 'polite');
  rows[1] = { ...rows[1], status: 'expired', errorCode: '' };
  await storageSet({ outbox: rows });
  await popup.waitForFunction((t) => document.querySelector('#announce').textContent === t, `Not delivered: ${rows[1].title}`);
  await popup.close();
  await page.close();
});

// --- web sender -----------------------------------------------------------------------------------------------------

async function openWeb(hash = '') {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 360, height: 760 });
  await page.goto(`${web.url}/${hash}`);
  await page.waitForSelector('body[data-ready="1"]');
  return page;
}

/** Writes the web sender's own storage (IndexedDB kv), then reloads the page. */
async function webStore(page, items) {
  await page.evaluate(async (i) => {
    const { openStorage } = await import('./web-storage.js');
    const { storage } = await openStorage();
    for (const [k, v] of Object.entries(i)) await storage.set(k, v);
  }, items);
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]');
}

test('web sender, not paired: typed-code pairing, and Comfort in Settings before pairing', { timeout: 90000 }, async () => {
  const page = await openWeb();
  assert.equal(await page.getByLabel('Pairing code or link').isVisible(), true, 'typed-code pairing');
  assert.equal(await page.evaluate(() => document.body.classList.contains('comfort')), false, 'Comfort is off by default');
  await assertAxeSees(page);
  await axeBoth(page, 'web: pairing');
  await shot(page, 'web-pair');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForSelector('#view-settings:not([hidden])');
  const comfort = await checkComfortSwitch(page);
  assert.equal(await comfort.isChecked(), false);
  assert.equal(await page.isVisible('#settings-paired'), false);
  await axeBoth(page, 'web: settings, not paired');
  const plain = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  await comfort.click();
  await page.waitForFunction(() => document.body.classList.contains('comfort'));
  assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize)), plain * 1.25, 'text at 125%');
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('button')].filter((x) => x.checkVisibility()).every((x) => x.getBoundingClientRect().height >= 48)), 'buttons at least 48 px high');
  await axeBoth(page, 'web: settings, not paired, Comfort');
  await assertNotClipped(page, 'web: settings, Comfort');
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('#view-pair:not([hidden])');
  await page.click('#advanced summary');
  await axeBoth(page, 'web: pairing, Comfort');
  await assertNotClipped(page, 'web: pairing, Comfort');
  await shot(page, 'web-pair-comfort');
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]');
  assert.equal(await page.evaluate(() => document.body.classList.contains('comfort')), true, 'kept');
  await page.close();
});

test('web sender, paired, every history state: no axe violations, light and dark, Comfort off and on; nothing clipped at 360 px', { timeout: 180000 }, async () => {
  const page = await openWeb(`#pair=${encodeURIComponent(link)}`);
  await page.waitForSelector('#view-confirm:not([hidden])');
  await axeBoth(page, 'web: pair with a Daylight? (Comfort)');
  await assertNotClipped(page, 'web: pair with a Daylight?, Comfort');
  await page.getByRole('button', { name: 'Pair' }).click();
  await page.waitForFunction(() => document.querySelector('#daylight-name')?.textContent === 'A11y Daylight');
  assert.equal(await page.evaluate(() => document.body.classList.contains('comfort')), true, 'pairing leaves Comfort as it was');

  for (const comfort of [false, true]) {
    await webStore(page, { settings: { from: 'A11y web', comfort }, outbox: historyRows() });
    const tag = comfort ? ', Comfort' : '';
    assert.equal(await page.evaluate(() => document.body.classList.contains('comfort')), comfort);
    assert.equal(await page.locator('#history li').count(), 6);
    await page.fill('#url', 'https://example.com/a-link-typed-in');
    await axeBoth(page, `web: send${tag}`);
    if (comfort) await assertNotClipped(page, 'web: send, Comfort');
    await shot(page, `web-send${comfort ? '-comfort' : ''}`);
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot(page, `web-send${comfort ? '-comfort' : ''}-dark`);
    await page.emulateMedia({ colorScheme: 'light' });

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForSelector('#view-settings:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#shortcut-link').textContent !== '');
    assert.equal(await (await checkComfortSwitch(page)).isChecked(), comfort);
    await axeBoth(page, `web: settings${tag}`);
    if (comfort) await assertNotClipped(page, 'web: settings, Comfort');
    await shot(page, `web-settings${comfort ? '-comfort' : ''}`);

    // Typed-code pairing one step away while paired; a link for another Daylight asks first, and Cancel keeps this one.
    await page.getByRole('button', { name: 'Change pairing…' }).click();
    await page.waitForSelector('#view-pair:not([hidden])');
    assert.equal(await page.getByLabel('Pairing code or link').isVisible(), true);
    await page.evaluate((h) => { location.hash = h; }, `pair=${encodeURIComponent(otherLink)}`);
    await page.waitForSelector('#view-confirm:not([hidden])');
    assert.equal(await page.textContent('#confirm-yes'), 'Switch');
    await axeBoth(page, `web: replace the pairing?${tag}`);
    if (comfort) await assertNotClipped(page, 'web: replace the pairing?, Comfort');
    await shot(page, `web-confirm${comfort ? '-comfort' : ''}`);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForSelector('#view-send:not([hidden])');
    assert.equal(await page.textContent('#daylight-name'), 'A11y Daylight');
  }
  await page.close();
});

test('web sender: status text wraps at 200% text, and a row that changes state is announced', { timeout: 90000 }, async () => {
  const page = await openWeb();
  const rows = historyRows();
  await webStore(page, { settings: { from: 'A11y web', comfort: false }, outbox: rows });
  await page.evaluate(() => { const s = document.querySelector('#status'); s.textContent = 'Not delivered. The relay set on your Daylight keeps turning this down. Check that setting on your Daylight, then try again.'; s.dataset.tone = 'bad'; });
  await scaleText(page, 2);
  await assertNotClipped(page, 'web: status text at 200%', { only: STATUS_TEXT });
  await shot(page, 'web-send-200');
  await scaleText(page, 1);

  // Another tab (here: the page's storage, then its BroadcastChannel) sees the Daylight's ack: the row is announced.
  rows[0] = { ...rows[0], status: 'delivered', delivered: Date.now() };
  await page.evaluate(async (outbox) => {
    const { openStorage } = await import('./web-storage.js');
    const { storage } = await openStorage();
    await storage.set('outbox', outbox);
    new BroadcastChannel('send-to-daylight').postMessage('changed');
  }, rows);
  await page.waitForFunction(() => document.querySelector('#announce').textContent !== '');
  assert.equal(await page.textContent('#announce'), `Delivered ✓: ${rows[0].title}`);
  await page.close();
});

// --- lab.html (X0) ----------------------------------------------------------------------------------------------------

/** lab.html at a view, once the background's fresh answer is on it. */
async function openLab(view) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 360, height: 760 });
  await page.goto(`chrome-extension://${extId}/lab.html#${view}`);
  await page.waitForSelector('body[data-fresh="1"]', { timeout: 20000 });
  return page;
}

test('lab.html, Lab on and off: no axe violations, light and dark, Comfort off and on; nothing clipped at 360 px; notes wrap at 200%', { timeout: 240000 }, async () => {
  const secret = ds.generateSecret();
  await sw.evaluate(async (input) => globalThis.sendToDaylight.pair({ input, from: 'A11y Chrome', confirm: true }), await ds.pairingLink({ secret, relay: relay.url, name: 'A11y Daylight' }));
  const worker = await startFakeWorker({ status: statusJson({ features: { ai: 'needs-key' }, lastSeen: new Date(Date.now() - 300000).toISOString(), usd: 0.5, limitUsd: 3 }) });
  worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(secret))).authToken;
  try {
    for (const comfort of [false, true]) {
      const tag = comfort ? ', Comfort' : '';
      const sfx = comfort ? '-comfort' : '';
      await storageSet({ settings: { from: 'A11y Chrome', lab: true, comfort } });
      await sw.evaluate(async () => chrome.storage.local.remove(['server/manualUrl', 'server/status', 'server/statusAt']));

      const hub = await openLab('lab');
      assert.equal(await hub.evaluate(() => document.body.classList.contains('comfort')), comfort);
      if (!comfort) await assertAxeSees(hub);
      await axeBoth(hub, `lab.html: Lab${tag}`);
      if (comfort) await assertNotClipped(hub, 'lab.html: Lab, Comfort');
      await shot(hub, `lab-hub${sfx}`);
      await hub.close();

      const whats = await openLab('whats-in-lab');
      await axeBoth(whats, `lab.html: What’s in Lab${tag}`);
      await whats.getByRole('button', { name: LAB_TEXT.features.F37.name, exact: true }).click();
      await whats.locator('li[data-feature="F37"] .lab-note-body[data-state="needs-server"]').waitFor();
      await axeBoth(whats, `lab.html: What’s in Lab, a note open${tag}`);
      if (comfort) await assertNotClipped(whats, 'lab.html: What’s in Lab, a note open, Comfort');
      await shot(whats, `lab-whats-note${sfx}`);
      await scaleText(whats, 2);
      await assertNotClipped(whats, `lab.html: What’s in Lab at 200%${tag}`);
      await shot(whats, `lab-whats-note-200${sfx}`);
      await whats.close();

      const server = await openLab('server');
      await axeBoth(server, `lab.html: Daylight server, not set up${tag}`);
      if (comfort) await assertNotClipped(server, 'lab.html: Daylight server, not set up, Comfort');
      await shot(server, `lab-server${sfx}`);
      await server.getByLabel(LAB_TEXT.serverSection.serverAddress).fill(worker.url);
      await server.getByRole('button', { name: 'Save' }).click();
      await server.waitForFunction(() => document.querySelector('.lab-server-ready')?.textContent === 'Ready', null, { timeout: 15000 });
      await axeBoth(server, `lab.html: Daylight server, ready${tag}`);
      if (comfort) await assertNotClipped(server, 'lab.html: Daylight server, ready, Comfort');
      await scaleText(server, 2);
      await assertNotClipped(server, `lab.html: Daylight server at 200%${tag}`);
      await scaleText(server, 1);
      await shot(server, `lab-server-ready${sfx}`);
      await server.close();

      const ready = await openLab('whats-in-lab');
      await axeBoth(ready, `lab.html: What’s in Lab with a server${tag}`);
      if (comfort) await assertNotClipped(ready, 'lab.html: What’s in Lab with a server, Comfort');
      await ready.close();

      // Lab off: lab.html is the switch alone, whatever its address; the popup's Settings has no rows.
      await storageSet({ settings: { from: 'A11y Chrome', lab: false, comfort } });
      const off = await openLab('whats-in-lab');
      assert.equal(await off.getAttribute('body', 'data-view'), 'lab');
      await axeBoth(off, `lab.html: Lab off${tag}`);
      if (comfort) await assertNotClipped(off, 'lab.html: Lab off, Comfort');
      await shot(off, `lab-off${sfx}`);
      await off.close();
      const popup = await openPopup();
      await popup.getByRole('button', { name: 'Settings' }).click();
      await popup.waitForSelector('#view-settings:not([hidden])');
      assert.equal(await popup.isVisible('#lab-rows'), false);
      await axeBoth(popup, `popup: settings, Lab off${tag}`);
      if (comfort) await assertNotClipped(popup, 'popup: settings, Lab off, Comfort');
      await popup.close();
    }
  } finally {
    await worker.close();
    await sw.evaluate(async () => chrome.storage.local.remove(['server/manualUrl', 'server/status', 'server/statusAt']));
    await storageSet({ settings: { from: 'A11y Chrome', lab: true, comfort: false } });
  }
});

test('popup Settings with Lab on: the switch and its two rows, light and dark, Comfort off and on; nothing clipped at 360 px', { timeout: 90000 }, async () => {
  for (const comfort of [false, true]) {
    await storageSet({ settings: { from: 'A11y Chrome', lab: true, comfort } });
    const popup = await openPopup();
    await popup.getByRole('button', { name: 'Settings' }).click();
    await popup.waitForSelector('#lab-rows:not([hidden])');
    await popup.waitForFunction(() => document.querySelector('#server-sub').textContent !== '');
    assert.equal(await popup.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).isChecked(), true);
    await axeBoth(popup, `popup: settings, Lab on${comfort ? ', Comfort' : ''}`);
    if (comfort) await assertNotClipped(popup, 'popup: settings, Lab on, Comfort');
    await shot(popup, `popup-settings-lab${comfort ? '-comfort' : ''}`);
    await popup.close();
  }
  await storageSet({ settings: { from: 'A11y Chrome', lab: true, comfort: false } });
});
