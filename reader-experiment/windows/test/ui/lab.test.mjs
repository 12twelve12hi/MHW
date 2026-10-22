// Lab in the Windows window (LAB-PLAN F00, Windows parts; card WIN0): dist/index.html in Chromium (WebView2's engine)
// with the window's CSP and a fake bridge in place of Rust (test/helpers/ui.mjs), the mock relay, and a stand-in Daylight
// server (test/helpers/fake-worker.mjs).
//
//   F00.1  Lab is on by default and the first start writes it; a W0 build shows no one-time note;
//   F00.3  What's in Lab shows each feature's short state; clicking one in a needs-setup state shows exactly its sentence
//          under it, in a polite live region, on a control that is never greyed out; OK, another control or leaving
//          the screen closes it;
//   F00.5  the vector pairing's Server code is shown and Copy puts it on the clipboard (the note's Copy Server code
//          too);
//   F00.6  with no server, the needs-server sentence within 5 s; with a relay that never answers, "Checking your
//          Daylight server…" and then OFFLINE at 5 s;
//   F00.7  with nothing set up, no screen reachable without clicking a Lab feature or opening the Daylight server
//          section shows a secret name or a needs-setup sentence;
//   F27    axe-core finds no violations on the Lab screens with Lab on, light and dark, Comfort off and on (with Lab
//          off: lab-off-parity.test.mjs; the other views with Lab on: a11y.test.mjs); with Comfort at 100%, 200% and
//          225% text nothing is clipped at the narrowest window (Settings' Lab rows, What's in Lab with a note, the
//          server section with its setup link and its question, the re-pairing follow-up).
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/ui/lab.test.mjs   (HEADED=1 to watch)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startUi, ds, kvOf, pairingValue, axeBoth, assertNotClipped, shot, scaleText, FIXED_SECRET, OTHER_SECRET,
} from '../helpers/ui.mjs';
import { startFakeWorker, statusJson, hangingServer } from '../helpers/fake-worker.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const L = await import('../../../share/js/daylight-lab.js');
const S = await import('../../../server/client/daylight-server.js');
const VEC = JSON.parse(fs.readFileSync(path.join(root, '..', 'server', 'vectors', 'server-vectors.json'), 'utf8'));
const { LAB_TEXT } = L;
const NOW = Date.UTC(2026, 9, 20, 8, 0, 0);
const MIN = 60000;
const WORKER_ORIGIN = 'https://daylight-0123456789ab.example.workers.dev';
/** Every needs-setup sentence a control can show (1.6): LAB_TEXT's and the server module's. */
const NEEDS_SENTENCES = [...Object.values(LAB_TEXT.needs), ...Object.values(S.STATE_MESSAGES), S.RERUN_HELP];
/** A secret or variable name, as the needs-setup sentences write them (CLOUDFLARE_API_TOKEN, DAYLIGHT_SERVER_CODE …). */
const SECRET_NAME = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]\b/;

let ui, relay;
before(async () => { relay = await startMockRelay(); ui = await startUi(); });
after(async () => { await ui?.close(); await relay?.close(); });

const stored = (page, key) => page.evaluate((k) => window.__fake.json(k), key);
const paired = async (extra = {}, { relayUrl = relay.url, secret = FIXED_SECRET } = {}) => kvOf({ pairing: await pairingValue({ relay: relayUrl, secret }), ...extra });

async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('#view-settings:not([hidden])');
}

/** Settings › What's in Lab, once the ack topic and the server were asked (data-fresh). */
async function openWhats(page) {
  await openSettings(page);
  await page.getByRole('button', { name: LAB_TEXT.whatsInLab, exact: true }).click();
  await page.waitForSelector('#view-whats:not([hidden]) #whats[data-fresh="1"]', { timeout: 15000 });
}

/** Settings › Daylight server, once it is drawn from the server's answer. */
async function openServer(page) {
  await openSettings(page);
  await page.locator('#open-server').click();
  await page.waitForSelector('#view-server:not([hidden]) #server[data-fresh="1"]', { timeout: 15000 });
}

const feature = (page, id) => page.locator(`li.lab-feature[data-feature="${id}"]`);

/** The visible text of the window (what a user can read on the screen as it is). */
const screenText = (page) => page.locator('#app').innerText();

function assertNoSetupText(text, what) {
  assert.doesNotMatch(text, SECRET_NAME, `${what}: no secret name before anything is clicked (F00.7)`);
  for (const t of NEEDS_SENTENCES) assert.ok(!text.includes(t), `${what}: no needs-setup sentence before anything is clicked: “${t}”`);
}

test('F00.1: Lab is on by default, first in Settings with What’s in Lab › and Daylight server ›; a W0 build shows no note', { timeout: 120000 }, async () => {
  const page = await ui.open();
  assert.deepEqual(await stored(page, 'settings'), { lab: true }, 'the first start writes it');
  assert.ok(!(await screenText(page)).includes(LAB_TEXT.note), 'no one-time note in W0');
  await openSettings(page);
  const lab = page.getByRole('switch', { name: LAB_TEXT.lab, exact: true });
  assert.equal(await lab.isChecked(), true);
  assert.equal(await lab.getAttribute('aria-describedby'), 'lab-footer');
  assert.equal(await page.textContent('#lab-footer'), LAB_TEXT.switchFooter);
  // The first control after Back: Lab, then its rows, then Comfort (outside Lab).
  const order = await page.evaluate(() => [...document.querySelectorAll('#view-settings button, #view-settings input')].filter((e) => e.checkVisibility()).map((e) => e.id));
  assert.deepEqual(order.slice(0, 5), ['close-settings', 'lab', 'open-whats', 'open-server', 'comfort']);
  await page.waitForFunction(() => document.querySelector('#server-sub').textContent !== '');
  assert.equal(await page.textContent('#server-sub'), 'Optional · Pair first');
  assert.equal(await page.getByRole('button', { name: 'Daylight server Optional · Pair first', exact: true }).count(), 1);
  await axeBoth(page, 'Settings with Lab on, not paired');
  await shot(page, 'lab-settings-unpaired');
  // Off hides the rows at once and is kept; on brings them back.
  await lab.click();
  assert.equal(await page.isVisible('#lab-rows'), false);
  await page.waitForFunction(() => window.__fake.json('settings')?.lab === false);
  await lab.click();
  await page.waitForSelector('#lab-rows:not([hidden])');
  await page.waitForFunction(() => window.__fake.json('settings')?.lab === true);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('a Lab switch that can’t be saved is put back and says why', { timeout: 60000 }, async () => {
  const page = await ui.open({ kv: kvOf({ settings: { lab: true } }), failWrites: ['settings'] });
  await openSettings(page);
  const lab = page.getByRole('switch', { name: LAB_TEXT.lab, exact: true });
  await lab.click();
  await page.waitForFunction(() => document.querySelector('#lab-msg').textContent !== '');
  assert.match(await page.textContent('#lab-msg'), /^Couldn’t change that: .*disk full/);
  assert.equal(await lab.isChecked(), true);
  assert.equal(await page.isVisible('#lab-rows'), true);
  await page.context().close();
});

test('F00.3: What’s in Lab, paired, no server: short states only; a click shows the needs-server sentence under the row, said politely, with Copy Server code', { timeout: 120000 }, async () => {
  const page = await ui.open({ kv: await paired() });
  await openWhats(page);
  assert.equal(await page.textContent('.lab-inbox'), LAB_TEXT.short['needs-inbox'], 'never heard from the Daylight (F17.2)');
  // What's in Lab asked the server: Settings' row says so too.
  await page.waitForFunction(() => document.querySelector('#server-sub').textContent === 'Optional · Not set up');
  assert.equal(await page.textContent('.lab-group-h'), LAB_TEXT.serverHeading);
  assert.equal(await page.textContent('.lab-group-state'), 'Not set up');
  assert.deepEqual(await page.locator('li.lab-feature').evaluateAll((lis) => lis.map((li) => li.dataset.feature)), ['F02']);
  const row = feature(page, 'F02').locator('.lab-row');
  assert.equal(await row.textContent(), `${LAB_TEXT.features.F02.name}${LAB_TEXT.features.F02.sentence}`, 'no short state repeats the heading’s');
  // Never greyed out (1.5): an enabled control like any other.
  assert.equal(await row.isEnabled(), true);
  assert.equal(await row.getAttribute('aria-disabled'), null);
  assert.equal(await row.evaluate((e) => getComputedStyle(e).opacity), '1');
  assertNoSetupText(await screenText(page), 'What’s in Lab');
  await axeBoth(page, 'What’s in Lab');
  await shot(page, 'lab-whats');

  const box = feature(page, 'F02').locator('.lab-note');
  assert.equal(await box.getAttribute('aria-live'), 'polite', 'a live region before anything is in it');
  await row.click();
  await page.waitForSelector('.lab-note-body[data-state="needs-server"]', { timeout: 6000 });
  assert.equal(await box.locator('.lab-note-text').textContent(), LAB_TEXT.needs['needs-server'], 'exactly its sentence');
  const fix = page.getByRole('button', { name: LAB_TEXT.buttons['needs-server'], exact: true });
  await axeBoth(page, 'What’s in Lab with a note');
  await shot(page, 'lab-whats-note');
  await fix.click();
  await page.waitForSelector('.lab-note-follow');
  assert.equal(await page.textContent('.lab-note-follow'), LAB_TEXT.setup.copied);
  const code = await S.formatServerCode(await S.deriveServerSeed(FIXED_SECRET), { relay: relay.url });
  assert.deepEqual(await page.evaluate(() => window.__fake.clipboard), [code], 'Copy Server code puts it on the clipboard');
  // OK closes it and gives the focus back to the row.
  await page.getByRole('button', { name: LAB_TEXT.noteButton, exact: true }).click();
  assert.equal(await box.evaluate((e) => e.childElementCount), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('lab-row')), true);
  // Another control closes it too, and so does leaving the screen.
  await row.click();
  await page.waitForSelector('.lab-note-body[data-state="needs-server"]');
  await page.locator('#whats-back').click();
  await page.waitForSelector('#view-settings:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'open-whats', 'back on the row that opened it');
  await page.getByRole('button', { name: LAB_TEXT.whatsInLab, exact: true }).click();
  await page.waitForSelector('#whats[data-fresh="1"]');
  assert.equal(await page.locator('.lab-note-body').count(), 0);
  // Esc goes back to Settings too.
  await page.keyboard.press('Escape');
  await page.waitForSelector('#view-settings:not([hidden])');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('What’s in Lab before pairing says Pair first, and a click on a feature says how to pair', { timeout: 60000 }, async () => {
  const page = await ui.open();
  await openWhats(page);
  assert.equal(await page.textContent('.lab-group-state'), LAB_TEXT.short['needs-pairing']);
  await feature(page, 'F02').locator('.lab-row').click();
  await page.waitForSelector('.lab-note-body[data-state="needs-pairing"]');
  assert.equal(await page.textContent('.lab-note-text'), LAB_TEXT.needs['needs-pairing']);
  assert.equal(await page.locator('.lab-note-fix').count(), 0, 'no button: nothing on this PC fixes it');
  await page.context().close();
});

test('What’s in Lab’s header is the Daylight’s Lab state from the ledger (F17)', { timeout: 60000 }, async () => {
  const at = NOW - 4 * MIN;
  const kv = await paired({ 'lab/inbox': { android: { lab: 1, app: 'android/1.5.0', caps: ['reader-link', 'st', 'tap'], poll: at, live: false, at } }, 'lab/heard': at });
  const page = await ui.open({ kv, now: NOW });
  await openWhats(page);
  assert.equal(await page.textContent('.lab-inbox'), 'Your Daylight: Lab on · checked in 4 min ago');
  await page.context().close();
});

test('F00.6: a relay that never answers: “Checking your Daylight server…” at once, then OFFLINE at 5 s', { timeout: 60000 }, async () => {
  const hang = await hangingServer();
  try {
    const page = await ui.open({ kv: await paired({}, { relayUrl: hang.url }) });
    await openSettings(page);
    await page.getByRole('button', { name: LAB_TEXT.whatsInLab, exact: true }).click();
    await page.waitForSelector('#view-whats:not([hidden]) li.lab-feature');
    assert.equal(await page.textContent('.lab-group-state'), LAB_TEXT.checking, 'the heading’s line while the server is asked');
    const t0 = Date.now();
    await feature(page, 'F02').locator('.lab-row').click();
    await page.waitForSelector('.lab-note-body[data-state="checking"]', { timeout: 2000 });
    assert.equal(await page.textContent('.lab-note-text'), LAB_TEXT.checking);
    await page.waitForSelector('.lab-note-body[data-state="OFFLINE"]', { timeout: 8000 });
    const took = Date.now() - t0;
    assert.ok(took < 6500, `OFFLINE within the 5 s deadline (${took} ms)`);
    assert.equal(await page.textContent('.lab-note-text'), S.STATE_MESSAGES.OFFLINE);
    await page.waitForSelector('#whats[data-fresh="1"]', { timeout: 8000 });
    assert.equal(await page.textContent('.lab-group-state'), LAB_TEXT.short.OFFLINE);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  } finally { await hang.close(); }
});

test('F00.5: the Daylight server section shows the vector pairing’s Server code and fingerprint, and Copy puts the code on the clipboard', { timeout: 60000 }, async () => {
  // The vectors' pairing is on ntfy.sh, which the tests never reach: the server is OFFLINE, the code derived here.
  const page = await ui.open({ kv: kvOf({ pairing: { code: VEC.pairingCode, relay: ds.normalizeRelay(undefined), name: 'Vector Daylight' } }) });
  await openServer(page);
  assert.equal(await page.textContent('.lab-server-code'), VEC.derived.serverCode);
  assert.equal(await page.textContent('.lab-server-where'), S.showFingerprint(VEC.derived.fingerprint));
  assert.equal(await page.textContent('.lab-server-state .lab-note-text'), S.STATE_MESSAGES.OFFLINE);
  await page.locator('.lab-server-copy').click();
  await page.waitForSelector('.lab-server-copied:not(:empty)');
  assert.equal(await page.textContent('.lab-server-copied'), LAB_TEXT.setup.copied);
  assert.deepEqual(await page.evaluate(() => window.__fake.clipboard), [VEC.derived.serverCode]);
  await page.context().close();

  // A clipboard that can't be written: the system's words, never "Copied".
  const busy = await ui.open({ kv: kvOf({ pairing: { code: VEC.pairingCode, relay: ds.normalizeRelay(undefined), name: 'Vector Daylight' } }), failClipboard: true });
  await openServer(busy);
  await busy.locator('.lab-server-copy').click();
  await busy.waitForSelector('.lab-server-copied:not(:empty)');
  assert.match(await busy.textContent('.lab-server-copied'), /in use by another app/);
  await busy.context().close();
});

test('the Daylight server section: not set up, its long text and Set up with a link; then a typed address that answers Ready', { timeout: 120000 }, async () => {
  const worker = await startFakeWorker({ status: statusJson({ lastSeen: new Date(NOW - 5 * MIN).toISOString(), usd: 0.227, limitUsd: 3 }) });
  try {
    const page = await ui.open({ kv: await paired(), now: NOW });
    await page.route(`${WORKER_ORIGIN}/**`, (r) => r.abort('connectionrefused'));
    await openServer(page);
    assert.equal(await page.textContent('.lab-server-state .lab-note-text'), S.STATE_MESSAGES['needs-server'], 'the long text, with the secret names');
    // Set up with a link comes first while the message says to paste one (2.6).
    const order = await page.evaluate(() => [...document.querySelectorAll('#server > *')].map((e) => e.className));
    assert.ok(order.indexOf('lab-server-setup') < order.indexOf('lab-server-h'), order.join(', '));
    assert.equal(await page.textContent('.lab-server-rerun'), S.RERUN_HELP);
    const setup = page.getByLabel(LAB_TEXT.serverSection.setupRow, { exact: true });
    assert.equal(await setup.getAttribute('placeholder'), LAB_TEXT.serverSection.setupPlaceholder);
    assert.equal(await page.textContent('.lab-server-setup-footer'), LAB_TEXT.serverSection.setupFooter);
    await axeBoth(page, 'Daylight server, not set up');
    await shot(page, 'lab-server');

    // A link that isn't a setup link: the module's message; nothing sent.
    await setup.fill(await ds.pairingLink({ secret: OTHER_SECRET, relay: relay.url }));
    await page.getByRole('button', { name: LAB_TEXT.serverSection.setupButton, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lab-server-setup-said').textContent !== '');
    const refused = await S.parseSetupLink(await ds.pairingLink({ secret: OTHER_SECRET, relay: relay.url })).catch((e) => e.message);
    assert.equal(await page.textContent('.lab-server-setup-said'), refused);
    // A setup link: the question names the address; Cancel sends nothing; Use it, with the server out of reach, says so.
    const link = await S.formatSetupLink(WORKER_ORIGIN, Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3));
    await setup.fill(`${link}\n`);
    assert.equal(await setup.inputValue(), link, 'a pasted line break goes');
    await setup.press('Enter');
    await page.waitForSelector('.lab-server-setup-confirm:not([hidden])');
    assert.equal(await page.textContent('.lab-server-setup-confirm-title'), LAB_TEXT.serverSection.setupConfirmTitle);
    assert.equal(await page.textContent('.lab-server-setup-confirm .lab-note-text'), L.setupConfirmText(WORKER_ORIGIN));
    await axeBoth(page, 'Daylight server, the setup question');
    await shot(page, 'lab-server-setup-confirm');
    await page.getByRole('button', { name: LAB_TEXT.serverSection.setupCancel, exact: true }).click();
    assert.equal(await page.isVisible('.lab-server-setup-confirm'), false);
    await setup.press('Enter');
    await page.getByRole('button', { name: LAB_TEXT.serverSection.setupConfirm, exact: true }).click();
    await page.waitForFunction((t) => document.querySelector('.lab-server-setup-said').textContent === t, S.errorMessage('OFFLINE'));

    // The stand-in as the typed Server address: Ready, its host, the Lab Inbox line and AI today.
    worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(FIXED_SECRET))).authToken;
    await page.getByLabel(LAB_TEXT.serverSection.serverAddress, { exact: true }).fill(worker.url);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForSelector('.lab-server-ready', { timeout: 10000 });
    assert.equal(await page.textContent('.lab-server-ready'), LAB_TEXT.ready);
    assert.match(await page.textContent('.lab-server-where'), /^localhost:\d+ · [0-9a-f]{4}-[0-9a-f]{4}$/);
    assert.equal(await page.textContent('.lab-server-inbox'), 'Lab Inbox last seen 5 min ago');
    assert.equal(await page.textContent('.lab-server-ai'), 'AI today: US$0.23 of US$3');
    assert.equal(await page.getByLabel(LAB_TEXT.serverSection.serverAddress, { exact: true }).inputValue(), worker.url);
    await axeBoth(page, 'Daylight server, ready');
    await shot(page, 'lab-server-ready');
    // What's in Lab follows: the server is Ready, and Files over 9 MB comes in a later update (Wave S).
    await page.locator('#server-back').click();
    await page.waitForFunction(() => document.querySelector('#server-sub').textContent === 'Optional · Ready');
    await page.getByRole('button', { name: LAB_TEXT.whatsInLab, exact: true }).click();
    await page.waitForSelector('#whats[data-fresh="1"]');
    assert.equal(await page.textContent('.lab-group-state'), 'Ready');
    assert.equal(await feature(page, 'F02').locator('.lab-short').textContent(), LAB_TEXT.short.later);
    await feature(page, 'F02').locator('.lab-row').click();
    await page.waitForSelector('.lab-note-body[data-state="later"]');
    assert.equal(await page.textContent('.lab-note-text'), 'Your Daylight server is ready. Files over 9 MB comes to this app in a later Lab update.');
    assert.deepEqual(page.errors.filter((e) => !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(e)), []);
    await page.context().close();
  } finally { await worker.close(); }
});

test('F00.7: with nothing set up, no screen reachable without clicking a Lab feature or opening the server section shows a secret name or a needs-setup sentence', { timeout: 120000 }, async () => {
  for (const kv of [undefined, await paired()]) {
    const page = await ui.open({ kv });
    const what = kv ? 'paired' : 'fresh install';
    await page.waitForTimeout(300);
    assertNoSetupText(await screenText(page), `${what}: the main window`);
    await openSettings(page);
    await page.waitForFunction(() => document.querySelector('#server-sub').textContent !== '');
    assertNoSetupText(await screenText(page), `${what}: Settings`);
    await page.getByRole('button', { name: LAB_TEXT.whatsInLab, exact: true }).click();
    await page.waitForSelector('#whats[data-fresh="1"]');
    assertNoSetupText(await screenText(page), `${what}: What’s in Lab`);
    await page.context().close();
  }
});

test('the re-pairing follow-up: with Lab on, the locked text, the new Server code with Copy and the re-run help until OK; nothing with Lab off', { timeout: 120000 }, async () => {
  const kv = await paired({ 'lab/repaired': { at: NOW - MIN } });
  const page = await ui.open({ kv, now: NOW });
  const box = page.locator('#lab-repaired');
  await box.waitFor();
  assert.equal(await page.getByRole('region', { name: LAB_TEXT.serverRow, exact: true }).count(), 1);
  assert.equal(await box.locator('.lab-repaired-text').textContent(), S.STATE_MESSAGES.locked);
  const code = await S.formatServerCode(await S.deriveServerSeed(FIXED_SECRET), { relay: relay.url });
  assert.equal(await box.locator('.lab-server-code').textContent(), code);
  assert.equal(await box.locator('.lab-server-rerun').textContent(), S.RERUN_HELP);
  await axeBoth(page, 'the re-pairing follow-up');
  await shot(page, 'lab-repaired');
  await box.locator('.lab-server-copy').click();
  await page.waitForFunction(() => window.__fake.clipboard.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__fake.clipboard), [code]);
  await box.getByRole('button', { name: LAB_TEXT.noteButton, exact: true }).click();
  assert.equal(await box.isHidden(), true);
  await page.waitForFunction(() => window.__fake.json('lab/repaired') === undefined);
  await page.context().close();

  const off = await ui.open({ kv: await paired({ settings: { lab: false }, 'lab/repaired': { at: NOW - MIN } }), now: NOW });
  await off.waitForTimeout(300);
  assert.equal(await off.locator('#lab-repaired').isHidden(), true, 'Lab off hides it (1.3), and keeps it for later');
  assert.ok(await stored(off, 'lab/repaired'));
  await off.context().close();
});

for (const scale of [1, 2, 2.25]) {
  const pct = `${Math.round(scale * 100)}%`;
  test(`with Comfort at ${pct} text, the Lab screens clip nothing at the narrowest window, and axe finds nothing`, { timeout: 180000 }, async () => {
    const worker = await startFakeWorker();
    try {
      const kv = await paired({ settings: { comfort: true }, 'lab/repaired': { at: Date.now() - MIN } }, { secret: FIXED_SECRET });
      const page = await ui.open({ kv });
      await page.route(`${WORKER_ORIGIN}/**`, (r) => r.abort('connectionrefused'));
      await page.route('https://*.example.org/**', (r) => r.abort('namenotresolved'));
      await scaleText(page, scale);
      const check = async (what) => {
        await assertNotClipped(page, `${what}, Comfort, ${pct} text`);
        if (scale !== 1) return;
        await axeBoth(page, `${what}, Comfort`);
      };
      await page.locator('#lab-repaired').waitFor();
      await check('the send view with the re-pairing follow-up');
      await openSettings(page);
      await page.waitForFunction(() => document.querySelector('#server-sub').textContent !== '');
      await check('Settings with Lab’s rows');
      await page.getByRole('button', { name: LAB_TEXT.whatsInLab, exact: true }).click();
      await page.waitForSelector('#whats[data-fresh="1"]');
      await feature(page, 'F02').locator('.lab-row').click();
      await page.waitForSelector('.lab-note-body[data-state="needs-server"]');
      await page.getByRole('button', { name: LAB_TEXT.buttons['needs-server'], exact: true }).click();
      await page.waitForSelector('.lab-note-follow');
      await check('What’s in Lab with a note');
      await shot(page, `lab-whats-note-${pct.replace('%', '')}-comfort`);
      await page.locator('#whats-back').click();
      await page.locator('#open-server').click();
      await page.waitForSelector('#server[data-fresh="1"]');
      await check('the Daylight server section, not set up (its placeholders)');
      const setup = page.getByLabel(LAB_TEXT.serverSection.setupRow, { exact: true });
      await setup.fill(await S.formatSetupLink(WORKER_ORIGIN, Uint8Array.from({ length: 16 }, (_, i) => i + 1)));
      await page.getByLabel(LAB_TEXT.serverSection.serverAddress, { exact: true }).fill('https://a-very-long-server-address-for-a-narrow-window.example.org');
      await setup.press('Enter');
      await page.waitForSelector('.lab-server-setup-confirm:not([hidden])');
      await check('the Daylight server section: a typed link and address, the setup question');
      await shot(page, `lab-server-${pct.replace('%', '')}-comfort`);
      await page.getByRole('button', { name: LAB_TEXT.serverSection.setupConfirm, exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.lab-server-setup-said').textContent.length > 20);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.lab-server-address-error').textContent !== '');
      await check('the Daylight server section: its errors');
      assert.deepEqual(page.errors.filter((e) => !/ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(e)), []);
      await page.context().close();
    } finally { await worker.close(); }
  });
}
