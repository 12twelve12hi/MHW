// The accessibility baseline (LAB-PLAN F27; not Lab) of the Windows window, dist/index.html, in a real Chromium (the
// engine of WebView2) with a fake bridge in place of Rust:
//
//   F27.1  axe-core (@axe-core/playwright, pinned in package.json) reports no violations on every view, light and dark,
//          Comfort off and on;
//   F27.4  with Comfort on, at the narrowest window, no text is cut short or clipped (scrollWidth <= clientWidth and
//          scrollHeight <= clientHeight + 1 for every element with text), and status text still wraps at 200% text;
//   and    every control has a name; Comfort is a switch in Settings outside Lab (off by default, before pairing too,
//          kept across pairing changes); a row's new state ("Delivered ✓", "Not delivered") is announced through a
//          polite live region; states are words; typed-code pairing is always one step away.
//
// Screenshots go to test-results/a11y/ (uploaded by CI for review, not compared).
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test --test-concurrency=1 test/ui/   (HEADED=1 to watch)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  startUi, ds, kvOf, pairingValue, historyRows, axeBoth, assertAxeSees, assertNotClipped, clipped, shot, scaleText,
  FIXED_SECRET, OTHER_SECRET, NARROWEST, MIN_WIDTH,
} from '../helpers/ui.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const { LAB_TEXT } = await import('../../../share/js/daylight-lab.js');
const STATUS_TEXT = '.status, .st, .note, .error, [role=status], [role=alert]';

let ui, relay;
before(async () => { relay = await startMockRelay(); ui = await startUi(); });
after(async () => { await ui?.close(); await relay?.close(); });

const comfortOn = (page) => page.evaluate(() => document.body.classList.contains('comfort'));
const stored = (page, key) => page.evaluate((k) => window.__fake.json(k), key);

/** The Comfort switch: LAB_TEXT's words, described by its footer. */
async function comfortSwitch(page) {
  const sw = page.getByRole('switch', { name: LAB_TEXT.comfort, exact: true });
  await sw.waitFor();
  assert.equal(await page.textContent('#comfort-footer'), LAB_TEXT.comfortFooter);
  assert.equal(await sw.getAttribute('aria-describedby'), 'comfort-footer');
  return sw;
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('#view-settings:not([hidden])');
}

async function paired(extra = {}) {
  return kvOf({ pairing: await pairingValue({ relay: relay.url }), ...extra });
}

test('the tests lay the page out at the narrowest window tauri.conf.json allows, less a scrollbar', () => {
  const conf = JSON.parse(fs.readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(conf.app.windows[0].minWidth, MIN_WIDTH);
  assert.equal(NARROWEST, MIN_WIDTH - 17);
});

test('not paired: typed-code pairing; Settings before pairing with Comfort, off by default; Comfort on is kept', { timeout: 120000 }, async () => {
  const page = await ui.open();
  assert.equal(await page.getByLabel('Pairing code or link').isVisible(), true, 'typed-code pairing');
  assert.equal(await comfortOn(page), false, 'Comfort is off by default');
  await assertAxeSees(page);
  await axeBoth(page, 'pairing');
  await shot(page, 'pair');

  await openSettings(page);
  const sw = await comfortSwitch(page);
  assert.equal(await sw.isChecked(), false);
  assert.equal(await page.isVisible('#settings-paired'), false, 'nothing about a pairing before there is one');
  assert.equal(await page.isVisible('#unpair'), false);
  await axeBoth(page, 'settings, not paired');
  await shot(page, 'settings-unpaired');

  const plain = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  await sw.click();
  await page.waitForFunction(() => document.body.classList.contains('comfort'));
  assert.equal(await sw.isChecked(), true);
  assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize)), plain * 1.25, 'text at 125%');
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('button')].filter((x) => x.checkVisibility()).every((x) => x.getBoundingClientRect().height >= 48)), 'buttons at least 48 px high');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#comfort')).transitionDuration), '0s', 'no motion');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#comfort')).borderTopWidth), '2px', '2 px borders');
  for (let i = 0; i < 20 && !(await stored(page, 'settings'))?.comfort; i++) await page.waitForTimeout(50);
  assert.deepEqual(await stored(page, 'settings'), { comfort: true }, 'kept in the app’s settings');
  await axeBoth(page, 'settings, not paired, Comfort');
  await assertNotClipped(page, 'settings, not paired, Comfort');
  await shot(page, 'settings-unpaired-comfort');

  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('#view-pair:not([hidden])');
  await page.click('#advanced summary');
  await axeBoth(page, 'pairing, Comfort');
  await assertNotClipped(page, 'pairing, Comfort');
  await page.click('#pair-btn');
  assert.equal(await page.textContent('#pair-error'), 'Type the code shown on your Daylight, or paste its pairing link.');
  await assertNotClipped(page, 'pairing with its error, Comfort');
  await shot(page, 'pair-comfort');

  // The next start opens in Comfort.
  const kv = await page.evaluate(() => Object.fromEntries(window.__fake.kv));
  await page.context().close();
  const again = await ui.open({ kv });
  assert.equal(await comfortOn(again), true);
  await again.context().close();
});

test('paired, every history state: no axe violations, light and dark, Comfort off and on; with Comfort nothing is clipped at the narrowest window', { timeout: 240000 }, async () => {
  const other = await ds.formatCode(OTHER_SECRET);
  for (const comfort of [false, true]) {
    const tag = comfort ? ', Comfort' : '';
    const page = await ui.open({ kv: await paired({ outbox: historyRows(), settings: { comfort } }) });
    assert.equal(await comfortOn(page), comfort);
    assert.equal(await page.locator('#history li').count(), 6);
    // States are words (the library's labels), never colour alone.
    const labels = await page.locator('#history .st').allTextContents();
    assert.deepEqual(labels, ['Sent · waiting for your Daylight', 'Waiting to send', 'Delivered ✓', 'Not delivered', 'Not delivered', 'Waiting to send']);
    await axeBoth(page, `send${tag}`);
    if (comfort) await assertNotClipped(page, 'send, Comfort');
    await shot(page, `send${comfort ? '-comfort' : ''}`);
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot(page, `send${comfort ? '-comfort' : ''}-dark`);
    await page.emulateMedia({ colorScheme: 'light' });

    // A long sentence in the status line, and the drop zone while something is dragged over it.
    await page.evaluate(() => {
      document.querySelector('#status').textContent = 'Waiting to send. A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.';
      document.querySelector('#drop').classList.add('over');
    });
    await axeBoth(page, `send, status and drop${tag}`);
    if (comfort) await assertNotClipped(page, 'send, status and drop, Comfort');
    await page.evaluate(() => document.querySelector('#drop').classList.remove('over'));

    await openSettings(page);
    assert.equal(await (await comfortSwitch(page)).isChecked(), comfort);
    assert.equal(await page.isVisible('#settings-paired'), true);
    await axeBoth(page, `settings${tag}`);
    if (comfort) await assertNotClipped(page, 'settings, Comfort');
    await shot(page, `settings${comfort ? '-comfort' : ''}`);

    // The hotkey recorder, listening.
    await page.getByRole('button', { name: 'Change…' }).click();
    await page.waitForFunction(() => document.querySelector('#hotkey-now').textContent === 'Press the keys…');
    await axeBoth(page, `settings, recording the hotkey${tag}`);
    if (comfort) await assertNotClipped(page, 'settings, recording the hotkey, Comfort');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#hotkey-now').textContent !== 'Press the keys…');

    // Typed-code pairing is one step away while paired: Change pairing… Another code asks first; Cancel keeps it.
    await page.getByRole('button', { name: 'Change pairing…' }).click();
    await page.waitForSelector('#view-pair:not([hidden])');
    assert.equal(await page.isVisible('#pair-back'), true, 'Back to sending');
    await axeBoth(page, `change pairing${tag}`);
    if (comfort) await assertNotClipped(page, 'change pairing, Comfort');
    await page.getByLabel('Pairing code or link').fill(other);
    await page.click('#pair-btn');
    await page.waitForSelector('#view-confirm:not([hidden])');
    assert.equal(await page.textContent('#confirm-yes'), 'Switch');
    await axeBoth(page, `replace the pairing?${tag}`);
    if (comfort) await assertNotClipped(page, 'replace the pairing?, Comfort');
    await shot(page, `confirm${comfort ? '-comfort' : ''}`);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForSelector('#view-send:not([hidden])');
    assert.equal((await stored(page, 'pairing')).code, await ds.formatCode(FIXED_SECRET), 'Cancel keeps the pairing');
    assert.equal((await stored(page, 'settings'))?.comfort ?? false, comfort, 'and Comfort as it was');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  }
});

test('status text wraps at 200% text; with Comfort at 200% the window still never scrolls sideways', { timeout: 120000 }, async () => {
  for (const comfort of [false, true]) {
    const page = await ui.open({ kv: await paired({ outbox: historyRows(), settings: { comfort } }) });
    await page.evaluate(() => { document.querySelector('#status').textContent = 'Not delivered. The relay set on your Daylight keeps turning this down. Check that setting on your Daylight, then try again.'; });
    await scaleText(page, 2);
    await assertNotClipped(page, `send: status text at 200%${comfort ? ', Comfort' : ''}`, { only: STATUS_TEXT });
    if (comfort) await assertNotClipped(page, 'send at 200%, Comfort');
    await shot(page, `send-200${comfort ? '-comfort' : ''}`);
    await openSettings(page);
    await assertNotClipped(page, `settings: status text at 200%${comfort ? ', Comfort' : ''}`, { only: STATUS_TEXT });
    if (comfort) await assertNotClipped(page, 'settings at 200%, Comfort');
    await shot(page, `settings-200${comfort ? '-comfort' : ''}`);
    await page.context().close();
  }
});

test('a row that reaches Delivered ✓ or Not delivered is said through a polite live region', { timeout: 120000 }, async () => {
  const now = Date.now();
  const rows = historyRows(now).slice(0, 3);
  // A link the Daylight is about to ack, and one shared a week ago that the first tick ends as Not delivered.
  rows.unshift({ ...rows[0], id: 'a11y-week', title: 'Shared a week ago', created: now - 7 * 24 * 3600000 - 60000, lastPublish: now - 3600000 });
  const page = await ui.open({ kv: await paired({ outbox: rows }) });
  const live = page.locator('#announce');
  assert.equal(await live.getAttribute('role'), 'status');
  assert.equal(await live.getAttribute('aria-live'), 'polite');
  await page.waitForFunction(() => document.querySelector('#announce').textContent === 'Not delivered: Shared a week ago');
  assert.equal(await page.locator('li[data-id="a11y-week"] .st').textContent(), 'Not delivered');

  // The Daylight acks the waiting link; the next check (Rust's 15-minute tick) marks it Delivered ✓ and says so.
  const keys = await ds.deriveKeys(FIXED_SECRET);
  await new ds.RelayClient({ relay: relay.url }).publish(keys.ackTopic, await ds.buildAckFrame(keys, ['a11y-sent']));
  await page.evaluate(() => window.__fake.emit('dls://tick'));
  const title = rows.find((r) => r.id === 'a11y-sent').title;
  await page.waitForFunction((t) => document.querySelector('#announce').textContent === `Delivered ✓: ${t}`, title);
  assert.equal(await page.locator('li[data-id="a11y-sent"] .st').textContent(), 'Delivered ✓');
  // Nothing that didn't change is said again, and the announcement is not visible text.
  assert.ok(await live.evaluate((e) => e.classList.contains('sr-only') && e.getBoundingClientRect().width <= 1));
  // Status labels and sentences wrap, Comfort or not (only titles end in "…" without Comfort).
  assert.deepEqual(await clipped(page, { only: '#history .st, #history .note' }), []);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a Comfort that can’t be saved is put back and says why', { timeout: 60000 }, async () => {
  const page = await ui.open({ failWrites: ['settings'] });
  await openSettings(page);
  const sw = await comfortSwitch(page);
  await sw.click();
  await page.waitForFunction(() => document.querySelector('#comfort-msg').textContent !== '');
  assert.match(await page.textContent('#comfort-msg'), /^Couldn’t change that: .*disk full/);
  assert.equal(await sw.isChecked(), false);
  assert.equal(await comfortOn(page), false);
  await page.context().close();
});
