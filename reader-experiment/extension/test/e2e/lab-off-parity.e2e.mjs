// Lab-off parity for the popup (LAB-PLAN 1.7, F00.2): with Lab off (settings.lab = false, the chrome-test build's
// hook), the pairing, sending and settings screens' accessibility trees equal the non-Lab baselines recorded from the
// P0 close-out (test/e2e/lab-off-baseline/popup-*.yml; helpers in test/helpers/lab-off.mjs).
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
import { expectBaseline, parityRows, FIXED_SECRET } from '../helpers/lab-off.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const b = built('chrome-test');
const ds = await b.load('daylight-share.js');
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
  await expectBaseline(popup, 'popup-settings');
  await popup.close();
  await page.close();
});
