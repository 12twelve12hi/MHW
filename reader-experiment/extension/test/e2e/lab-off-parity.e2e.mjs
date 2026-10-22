// Lab-off parity for the popup (LAB-PLAN 1.7, F00.2): with Lab off (settings.lab = false, the chrome-test build's
// hook), the pairing, sending and settings screens' accessibility trees equal the non-Lab baselines recorded from the
// P0 close-out (test/e2e/lab-off-baseline/popup-*.yml; helpers in test/helpers/lab-off.mjs). Settings keeps one thing
// with Lab off (1.3): the Lab switch row and its footer, which are the only lines left out before comparing.
//
// A build without Lab (its wave still closed in lab-release-gate.json: the Safari build inside the iPhone and Mac apps,
// LAB-PLAN 6.2; build.mjs) must be the last non-Lab build itself: the same screens equal the baselines with nothing left
// out, whatever settings.lab says.
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/e2e/lab-off-parity.e2e.mjs
//   UPDATE_LAB_OFF_BASELINE=1 …   re-records, only together with a matching non-Lab change

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { built } from '../helpers/built.mjs';
import { startSite } from '../helpers/server.mjs';
import { expectBaseline, parityRows, FIXED_SECRET, labSwitchLines, labDefaultWritten } from '../helpers/lab-off.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const b = built('chrome-test');
const ds = await b.load('daylight-share.js');
const { LAB_TEXT } = await b.load('daylight-lab.js');
const LAB_OFF = { from: 'Parity Chrome', lab: false };

let relay, site, ctx, sw, extId;

async function openPopup(tabId) {
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.goto(`chrome-extension://${extId}/popup.html${tabId != null ? `?tab=${tabId}` : ''}`);
  await popup.waitForSelector('body[data-ready="1"]');
  return popup;
}

before(async () => {
  relay = await startMockRelay();
  site = await startSite();
  site.routes.set('/parity.html', { type: 'text/html; charset=utf-8', body: Buffer.from('<!doctype html><title>A page to send</title><p>Parity</p>') });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-parity-'));
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
});

after(async () => {
  await ctx?.close();
  await relay?.close();
  await site?.close();
});

test('popup with Lab off: pairing, sending and settings equal the non-Lab baselines', { timeout: 90000 }, async () => {
  await labDefaultWritten(sw);
  await sw.evaluate((s) => chrome.storage.local.set({ settings: s }), LAB_OFF);
  const unpaired = await openPopup();
  await expectBaseline(unpaired, 'popup-pair');
  await unpaired.close();

  const link = await ds.pairingLink({ secret: FIXED_SECRET, relay: relay.url, name: 'Parity Daylight' });
  await sw.evaluate(async (input) => globalThis.sendToDaylight.pair({ input }), link);
  await sw.evaluate((rows) => chrome.storage.local.set({ outbox: rows }), parityRows());
  assert.deepEqual((await sw.evaluate(() => chrome.storage.local.get('settings'))).settings, LAB_OFF, 'pairing keeps Lab off');
  const page = await ctx.newPage();
  await page.goto(`${site.url}/parity.html`);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `${site.url}/parity.html`);
  const popup = await openPopup(tabId);
  assert.equal(await popup.locator('#history li').count(), 5);
  await expectBaseline(popup, 'popup-send');
  await popup.click('#open-settings');
  await popup.waitForSelector('#view-settings:not([hidden])');
  assert.equal(await popup.isVisible('#lab-rows'), false, 'no Lab rows with Lab off');
  assert.equal(await popup.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).isChecked(), false);
  await expectBaseline(popup, 'popup-settings', { omit: labSwitchLines(LAB_TEXT) });
  await popup.close();
  await page.close();
});

test('a build without Lab (its wave closed, LAB-PLAN 6.2): every screen equals the non-Lab baseline, with nothing left out', { timeout: 90000 }, async () => {
  const held = built('chrome-test', { lab: false });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-parity-held-'));
  const hctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${held.dir}`, `--load-extension=${held.dir}`],
  });
  try {
    const ours = (x) => x.url().startsWith('chrome-extension://') && x.url().endsWith('/background.js');
    const hsw = hctx.serviceWorkers().find(ours) ?? await hctx.waitForEvent('serviceworker', { predicate: ours, timeout: 30000 });
    const id = new URL(hsw.url()).host;
    for (let i = 0; i < 100; i++) {
      if (await hsw.evaluate(() => !!globalThis.chrome?.runtime?.id && !!globalThis.sendToDaylight).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const open = async (tabId) => {
      const p = await hctx.newPage();
      await p.setViewportSize({ width: 360, height: 640 });
      await p.goto(`chrome-extension://${id}/popup.html${tabId != null ? `?tab=${tabId}` : ''}`);
      await p.waitForSelector('body[data-ready="1"]');
      return p;
    };
    // Whatever is stored (an earlier build's lab: true), there is no Lab here.
    await hsw.evaluate((s) => chrome.storage.local.set({ settings: s }), { from: 'Parity Chrome', lab: true });
    const unpaired = await open();
    await expectBaseline(unpaired, 'popup-pair');
    await unpaired.close();
    const link = await ds.pairingLink({ secret: FIXED_SECRET, relay: relay.url, name: 'Parity Daylight' });
    await hsw.evaluate(async (input) => globalThis.sendToDaylight.pair({ input }), link);
    await hsw.evaluate((rows) => chrome.storage.local.set({ outbox: rows }), parityRows());
    const page = await hctx.newPage();
    await page.goto(`${site.url}/parity.html`);
    const tabId = await hsw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `${site.url}/parity.html`);
    const popup = await open(tabId);
    await expectBaseline(popup, 'popup-send');
    await popup.click('#open-settings');
    await popup.waitForSelector('#view-settings:not([hidden])');
    await expectBaseline(popup, 'popup-settings');
    assert.equal(await popup.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).count(), 0, 'no Lab switch');
    assert.equal(await popup.locator('#lab-row, #lab-rows, #lab-footer').count(), 0);
    assert.equal(await hsw.evaluate(async () => (await globalThis.sendToDaylight.lab.state()).lab), false);
    assert.equal(await hsw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.lab), true, 'what was stored stays for a build with Lab');
    await popup.close();
    await page.close();
  } finally {
    await hctx.close();
  }
});
