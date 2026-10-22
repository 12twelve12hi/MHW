// Lab-off parity (LAB-PLAN 1.7, F00.2) for the Windows window: with Lab off, the main window and Settings must read
// exactly as the last non-Lab build did. The baselines in test/lab-off-baseline/*.yml were recorded from the P0
// close-out (protocol 1.1 plus the F27 baseline with Comfort, no Lab code) as Playwright's
// locator('body').ariaSnapshot(): roles, names and values, in order (stable across Playwright releases, unlike
// page.accessibility.snapshot()).
//
// Each screen is seeded the same way every run: settings.lab = false (the store's Lab key, 1.2), a fixed pairing, rows
// at fixed ages under a fixed clock, app_info from the fake bridge. Only the mock relay's port is normalised.
// Re-record only together with a matching non-Lab change:
//
//   UPDATE_LAB_OFF_BASELINE=1 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/ui/lab-off-parity.test.mjs
//
// WIN0 keeps these screens equal with Lab off; only the Lab switch row in Settings (and its footer), which 1.3 keeps
// with Lab off, may be left out of the comparison with expectBaseline's omit option.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startUi, kvOf, pairingValue, parityRows, expectBaseline, snapshot, BASELINES } from '../helpers/ui.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const NOW = Date.UTC(2026, 9, 20, 8, 0, 0);
const LAB_OFF = { lab: false };

let ui, relay;
before(async () => { relay = await startMockRelay(); ui = await startUi(); });
after(async () => { await ui?.close(); await relay?.close(); });

/** Opens a window and lets its first tick and redraw settle, so the tree is the one a user meets. */
async function open(kv) {
  const page = await ui.open({ kv, now: NOW });
  await page.waitForTimeout(400);
  return page;
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('#view-settings:not([hidden])');
}

const paired = async () => kvOf({
  pairing: await pairingValue({ relay: relay.url, name: 'Desk Daylight' }),
  outbox: parityRows(NOW),
  settings: LAB_OFF,
});

test('Lab off, not paired: the pairing screen and Settings equal the non-Lab baseline', { timeout: 60000 }, async () => {
  const page = await open(kvOf({ settings: LAB_OFF }));
  await expectBaseline(page, 'main-pair');
  await openSettings(page);
  await expectBaseline(page, 'settings-unpaired');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('Lab off, paired: the main window with a row in every state, and Settings, equal the non-Lab baseline', { timeout: 60000 }, async () => {
  const page = await open(await paired());
  assert.equal(await page.locator('#history li').count(), 6);
  await expectBaseline(page, 'main-send');
  await openSettings(page);
  await expectBaseline(page, 'settings');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('Lab off with Comfort on: the same trees (Comfort changes how it looks, not what it says)', { timeout: 60000 }, async () => {
  const kv = await paired();
  kv.settings = JSON.stringify({ ...LAB_OFF, comfort: true });
  const page = await open(kv);
  assert.equal(await page.evaluate(() => document.body.classList.contains('comfort')), true);
  await expectBaseline(page, 'main-send');
  await openSettings(page);
  // Only the switch's state differs from the baseline recorded with Comfort off.
  const snap = await snapshot(page);
  assert.ok(snap.includes('- switch "Comfort" [checked]'), snap);
  const got = snap.replace('- switch "Comfort" [checked]', '- switch "Comfort"');
  assert.equal(got, fs.readFileSync(path.join(BASELINES, 'settings.yml'), 'utf8'));
  await page.context().close();
});
