// Lab-off parity for the web sender (LAB-PLAN 1.7, F00.2): with Lab off (settings.lab = false in its IndexedDB; B0
// adds the ?lab=0 hook on 127.0.0.1), the pairing, sending and settings screens' accessibility trees equal the non-Lab
// baselines recorded from the P0 close-out (test/e2e/lab-off-baseline/web-*.yml; helpers in test/helpers/lab-off.mjs).
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/e2e/web-lab-off-parity.e2e.mjs
//   UPDATE_LAB_OFF_BASELINE=1 …   re-records, only together with a matching non-Lab change

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { webBuilt } from '../helpers/web-built.mjs';
import { expectBaseline, parityRows, FIXED_SECRET } from '../helpers/lab-off.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const w = webBuilt();
const ds = await w.load('daylight-share.js');
const LAB_OFF = { from: 'Parity web', lab: false };

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

/** Writes the page's own storage (IndexedDB kv), then reloads it. */
async function store(page, items) {
  await page.evaluate(async (i) => {
    const { openStorage } = await import('./web-storage.js');
    const { storage } = await openStorage();
    for (const [k, v] of Object.entries(i)) await storage.set(k, v);
  }, items);
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]');
}

test('web sender with Lab off: pairing, sending and settings equal the non-Lab baselines', { timeout: 90000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${site.url}/`);
  await page.waitForSelector('body[data-ready="1"]');
  await store(page, { settings: LAB_OFF });
  await expectBaseline(page, 'web-pair');

  const pairing = { secret: FIXED_SECRET, relay: relay.url, name: 'Parity Daylight' };
  await store(page, { pairing: { code: await ds.formatCode(FIXED_SECRET), relay: relay.url, name: pairing.name }, outbox: parityRows() });
  assert.equal(await page.textContent('#daylight-name'), 'Parity Daylight');
  assert.equal(await page.locator('#history li').count(), 6);
  await expectBaseline(page, 'web-send');
  await page.click('#open-settings');
  await page.waitForSelector('#view-settings:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#shortcut-link').textContent !== '');
  await expectBaseline(page, 'web-settings');
  await ctx.close();
});
