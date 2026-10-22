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
// With Lab off, only the Lab switch row in Settings and its footer, which 1.3 keeps, may be left out of the comparison
// (LAB_SWITCH, through expectBaseline's omit); every other line must match. Lab off is reached three ways: stored
// (seeded), the switch clicked off in Settings, and --e2e-lab 0 in test mode (1.7). axe-core checks each Lab-off screen
// too, light and dark, Comfort off and on (F27.1 with Lab off; Lab on is a11y.test.mjs and lab.test.mjs).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startUi, kvOf, pairingValue, parityRows, expectBaseline, snapshot, readBaseline, appInfo, axeBoth,
} from '../helpers/ui.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const { LAB_TEXT } = await import('../../../share/js/daylight-lab.js');
const NOW = Date.UTC(2026, 9, 20, 8, 0, 0);
const LAB_OFF = { lab: false };
/** What Lab off keeps in Settings (1.3): the switch row, off, and its footer. Nothing else may differ. */
const LAB_SWITCH = [`- text: ${LAB_TEXT.lab}`, `- switch "${LAB_TEXT.lab}"`, `- paragraph: ${LAB_TEXT.switchFooter}`];

let ui, relay;
before(async () => { relay = await startMockRelay(); ui = await startUi(); });
after(async () => { await ui?.close(); await relay?.close(); });

/** Opens a window and lets its first tick and redraw settle, so the tree is the one a user meets. */
async function open(kv, extra = {}) {
  const page = await ui.open({ kv, now: NOW, ...extra });
  await page.waitForTimeout(400);
  return page;
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('#view-settings:not([hidden])');
}

/** Settings with Lab off: the switch and its footer are there, off, with nothing of Lab under them. */
async function expectLabOffSettings(page, name) {
  const snap = await snapshot(page);
  for (const line of LAB_SWITCH) assert.ok(snap.split('\n').some((l) => l.trim() === line), `Settings keeps ${line}\n${snap}`);
  assert.equal(await page.isVisible('#lab-rows'), false, 'no What’s in Lab › or Daylight server › with Lab off');
  await expectBaseline(page, name, { omit: LAB_SWITCH });
}

const paired = async (settings = LAB_OFF) => kvOf({
  pairing: await pairingValue({ relay: relay.url, name: 'Desk Daylight' }),
  outbox: parityRows(NOW),
  settings,
});

test('Lab off, not paired: the pairing screen and Settings equal the non-Lab baseline', { timeout: 60000 }, async () => {
  const page = await open(kvOf({ settings: LAB_OFF }));
  await expectBaseline(page, 'main-pair');
  await axeBoth(page, 'pairing, Lab off');
  await openSettings(page);
  await expectLabOffSettings(page, 'settings-unpaired');
  await axeBoth(page, 'Settings, not paired, Lab off');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('Lab off, paired: the main window with a row in every state, and Settings, equal the non-Lab baseline', { timeout: 60000 }, async () => {
  const page = await open(await paired());
  assert.equal(await page.locator('#history li').count(), 6);
  await expectBaseline(page, 'main-send');
  await axeBoth(page, 'send, Lab off');
  await openSettings(page);
  await expectLabOffSettings(page, 'settings');
  await axeBoth(page, 'Settings, Lab off');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('Lab off with Comfort on: the same trees (Comfort changes how it looks, not what it says)', { timeout: 60000 }, async () => {
  const page = await open(await paired({ ...LAB_OFF, comfort: true }));
  assert.equal(await page.evaluate(() => document.body.classList.contains('comfort')), true);
  await expectBaseline(page, 'main-send');
  await axeBoth(page, 'send, Lab off, Comfort');
  await openSettings(page);
  // Only the switch's state differs from the baseline recorded with Comfort off.
  const snap = (await snapshot(page)).split('\n').filter((l) => !LAB_SWITCH.includes(l.trim())).join('\n');
  assert.ok(snap.includes('- switch "Comfort" [checked]'), snap);
  assert.equal(snap.replace('- switch "Comfort" [checked]', '- switch "Comfort"'), readBaseline('settings'));
  await axeBoth(page, 'Settings, Lab off, Comfort');
  await page.context().close();
});

test('Lab switched off in Settings: Settings and the main window equal the baseline at once, and the switch is kept', { timeout: 60000 }, async () => {
  // A store from the last non-Lab build: no lab key, so Lab starts on (1.2) and the first start writes it.
  const page = await open(await paired({}));
  const lab = page.getByRole('switch', { name: LAB_TEXT.lab, exact: true });
  await openSettings(page);
  assert.equal(await lab.isChecked(), true, 'Lab is on by default');
  assert.equal(await page.isVisible('#lab-rows'), true);
  await lab.click();
  await page.waitForFunction(() => window.__fake.json('settings')?.lab === false);
  await expectLabOffSettings(page, 'settings');
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('#view-send:not([hidden])');
  await expectBaseline(page, 'main-send');
  // The next start keeps it off.
  const kv = await page.evaluate(() => Object.fromEntries(window.__fake.kv));
  await page.context().close();
  const again = await open(kv);
  await expectBaseline(again, 'main-send');
  await openSettings(again);
  await expectLabOffSettings(again, 'settings');
  assert.deepEqual(again.errors, []);
  await again.context().close();
});

test('--e2e-lab 0 in test mode turns Lab off before the window draws: the baselines hold', { timeout: 60000 }, async () => {
  const info = appInfo({ e2e: { pair: null, status: true, lab: false } });
  const page = await open(await paired({}), { info });
  assert.equal((await page.evaluate(() => window.__fake.json('settings'))).lab, false, 'stored, as the switch would');
  await expectBaseline(page, 'main-send');
  await openSettings(page);
  await expectLabOffSettings(page, 'settings');
  await page.context().close();
  // Outside test mode the option is never passed to the page (main.rs), and a value there is ignored.
  const plain = await open(await paired({}), { info: appInfo({ e2e: { pair: null, status: false, lab: false } }) });
  assert.equal((await plain.evaluate(() => window.__fake.json('settings'))).lab, true);
  await plain.context().close();
});

test('Lab on, Wave 0: the pairing screen and the main window are unchanged (W0’s Lab lives in Settings)', { timeout: 60000 }, async () => {
  const page = await open(kvOf({ settings: { lab: true } }));
  await expectBaseline(page, 'main-pair');
  await page.context().close();
  const sending = await open(await paired({ lab: true }));
  await expectBaseline(sending, 'main-send');
  assert.deepEqual(sending.errors, []);
  await sending.context().close();
});
