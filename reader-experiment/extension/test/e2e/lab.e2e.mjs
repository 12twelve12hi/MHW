// Lab in a real Chromium (LAB-PLAN F00 and F17, extension parts; card X0): the popup's Lab row and lab.html, against
// the mock relay, a stand-in Daylight server (test/helpers/fake-worker.mjs) and Daylights from daylight-lab.js.
//
//   F00.1  a fresh install has Lab on, with no one-time note in W0
//   F00.2  with Lab on, W0 leaves the popup's pairing and sending screens as the non-Lab baselines (Lab off is
//          lab-off-parity.e2e.mjs); with Lab off, the popup and lab.html show only the switch
//   F00.3  a server feature's tap shows exactly its sentence under it, announced, never greyed out
//   F00.5  the Server code shown for the vector pairing, and Copy
//   F00.6  needs-server within 5 s; a relay that never answers: "Checking your Daylight server…", then OFFLINE at 5 s
//   F00.7  no setup sentence or secret name on a screen before a feature is tapped or the server section opened
//   F17.2  What's in Lab's header from the ledger: nothing heard, a v1.1 ack, a Lab hello
//   2.6    re-pairing with another Daylight while a server is known: the popup's follow-up (the locked text, the new
//          Server code with Copy, the re-run help) until OK; a fresh What's in Lab answer updates the rows' short
//          states with a note open
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/e2e/lab.e2e.mjs      (HEADED=1 to watch)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { built } from '../helpers/built.mjs';
import { startSite } from '../helpers/server.mjs';
import { expectBaseline, parityRows, FIXED_SECRET, labDefaultWritten } from '../helpers/lab-off.mjs';
import { startFakeWorker, statusJson, hangingServer } from '../helpers/fake-worker.mjs';
import { axe, assertNotClipped, unnamed } from '../helpers/a11y.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const b = built('chrome-test');
const ds = await b.load('daylight-share.js');
const L = await b.load('daylight-lab.js');
const S = await b.load('daylight-server.js');
const { LAB_TEXT } = L;
const VEC = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'server', 'vectors', 'server-vectors.json'), 'utf8'));
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'test-results', 'lab');
const MIN = 60000;

let relay, site, worker, ctx, sw, extId;

const storageSet = (items) => sw.evaluate((i) => chrome.storage.local.set(i), items);
const storageGet = async (key) => (await sw.evaluate((k) => chrome.storage.local.get(k), key))[key];
const pair = (input) => sw.evaluate(async (i) => globalThis.sendToDaylight.pair({ input: i, confirm: true }), input);
/** Unpairs, and forgets the Daylight server too (a typed Server address outlives a pairing: DESIGN 13.1's keys). */
const unpair = () => sw.evaluate(async () => {
  await globalThis.sendToDaylight.unpair();
  await chrome.storage.local.remove(Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('server/')));
});

async function openPopup(tabId) {
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.goto(`chrome-extension://${extId}/popup.html${tabId != null ? `?tab=${tabId}` : ''}`);
  await popup.waitForSelector('body[data-ready="1"]');
  return popup;
}

/** lab.html at a view, once the background's fresh answer is on it. */
async function openLab(view = 'lab', page = null) {
  const p = page ?? await ctx.newPage();
  await p.setViewportSize({ width: 360, height: 760 });
  await p.goto(`chrome-extension://${extId}/lab.html#${view}`);
  await p.waitForSelector('body[data-fresh="1"]', { timeout: 20000 });
  return p;
}

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

/**
 * Records what the page copies. A test browser can't read the system clipboard of an extension page (no focus, and no
 * permission grant for its origin), so writeText is wrapped: the page still writes, and the text is kept.
 */
async function recordCopies(page) {
  await page.evaluate(() => {
    window.__copied = [];
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__copied.push(t); write(t).catch(() => {}); return Promise.resolve(); };
  });
  return async () => page.evaluate(() => window.__copied.at(-1) ?? null);
}

/** A row of What's in Lab, by the feature's id. */
const featureRow = (page, id) => page.locator(`li.lab-feature[data-feature="${id}"]`);

before(async () => {
  relay = await startMockRelay();
  site = await startSite();
  site.routes.set('/parity.html', { type: 'text/html; charset=utf-8', body: Buffer.from('<!doctype html><title>A page to send</title><p>Parity</p>') });
  worker = await startFakeWorker();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-lab-'));
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
  await worker?.close();
});

// --- F00.1, F00.2 ------------------------------------------------------------------------------------------------------

test('a fresh install has Lab on and no one-time note in W0; Settings starts with the switch, whose rows open lab.html', { timeout: 90000 }, async () => {
  assert.deepEqual(await labDefaultWritten(sw), { lab: true }, 'the first start wrote lab = true (F00.1)');
  const popup = await openPopup();
  assert.equal(await popup.getByText(LAB_TEXT.note).count(), 0, 'no one-time note in a W0 build');
  // W0 changes nothing outside Settings: with Lab on the pairing screen is the non-Lab baseline too.
  await storageSet({ settings: { lab: true, from: 'Parity Chrome' } });
  await popup.reload();
  await popup.waitForSelector('body[data-ready="1"]');
  await expectBaseline(popup, 'popup-pair');

  await popup.getByRole('button', { name: 'Settings' }).click();
  await popup.waitForSelector('#view-settings:not([hidden])');
  const sw1 = popup.getByRole('switch', { name: LAB_TEXT.lab, exact: true });
  assert.equal(await sw1.isChecked(), true);
  // The first row of Settings (1.1): the switch, then its two rows, then its footer, then Comfort.
  const order = await popup.$$eval('#view-settings .switch-row input, #view-settings .nav-row, #view-settings #lab-footer', (els) => els.map((e) => e.id));
  assert.deepEqual(order, ['lab', 'open-whats-in-lab', 'open-server', 'lab-footer', 'comfort']);
  await popup.waitForFunction(() => document.querySelector('#server-sub').textContent !== '');
  assert.equal(await popup.textContent('#server-sub'), 'Optional · Pair first');
  await shot(popup, 'popup-settings-lab-on');

  const [page] = await Promise.all([ctx.waitForEvent('page'), popup.click('#open-whats-in-lab')]);
  await page.waitForSelector('body[data-ready="1"]');
  assert.equal(new URL(page.url()).pathname, '/lab.html');
  assert.equal(new URL(page.url()).hash, '#whats-in-lab');
  assert.equal(await page.getByRole('heading', { name: LAB_TEXT.whatsInLab, level: 2 }).isVisible(), true);
  await page.close();
  const [server] = await Promise.all([ctx.waitForEvent('page'), popup.click('#open-server')]);
  await server.waitForSelector('body[data-ready="1"]');
  assert.equal(new URL(server.url()).hash, '#server');
  assert.equal(await server.getByRole('heading', { name: LAB_TEXT.serverRow, level: 2 }).isVisible(), true);
  await server.close();
  await popup.close();
});

test('with Lab on, W0 leaves the popup’s sending screen as the non-Lab baseline (F00.2)', { timeout: 90000 }, async () => {
  await labDefaultWritten(sw);
  await storageSet({ settings: { lab: true, from: 'Parity Chrome' } });
  await pair(await ds.pairingLink({ secret: FIXED_SECRET, relay: relay.url, name: 'Parity Daylight' }));
  await storageSet({ outbox: parityRows() });
  const page = await ctx.newPage();
  await page.goto(`${site.url}/parity.html`);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `${site.url}/parity.html`);
  const popup = await openPopup(tabId);
  await expectBaseline(popup, 'popup-send');
  await popup.close();
  await page.close();
  await unpair();
});

test('Lab off: the popup and lab.html show only the switch, wherever lab.html was opened; turning it on there brings the rows back', { timeout: 90000 }, async () => {
  await storageSet({ settings: { lab: true } });
  const popup = await openPopup();
  await popup.getByRole('button', { name: 'Settings' }).click();
  await popup.waitForSelector('#view-settings:not([hidden])');
  await popup.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).click();
  await popup.waitForSelector('#lab-rows', { state: 'hidden' });
  for (let i = 0; i < 40 && (await storageGet('settings'))?.lab !== false; i++) await popup.waitForTimeout(50);
  assert.equal((await storageGet('settings')).lab, false);

  for (const view of ['whats-in-lab', 'server', 'lab']) {
    const page = await openLab(view);
    assert.equal(await page.getAttribute('body', 'data-view'), 'lab', `${view}: only the switch`);
    assert.equal(await page.isVisible('#lab-rows'), false);
    assert.equal(await page.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).isChecked(), false);
    assert.equal(await page.textContent('#lab-footer'), LAB_TEXT.switchFooter);
    assert.equal(await page.isVisible('#view-whats-in-lab'), false);
    assert.equal(await page.isVisible('#view-server'), false);
    if (view !== 'lab') { await page.close(); continue; }
    await shot(page, 'lab-off');
    // On again, from lab.html: the rows come back here and in the open popup.
    await page.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).click();
    await page.waitForSelector('#lab-rows:not([hidden])');
    await popup.waitForSelector('#lab-rows:not([hidden])');
    assert.equal(await popup.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).isChecked(), true);
    await page.close();
  }
  await popup.close();
});

// --- F00.7 -------------------------------------------------------------------------------------------------------------

const SECRET_NAMES = /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|ANTHROPIC_API_KEY|DAYLIGHT_[A-Z_]+|NTFY_TOKEN/;
/** Every needs-setup sentence (LAB_TEXT's and the server module's), each up to its first template slot. */
const SETUP_SENTENCES = [...Object.values(LAB_TEXT.needs), ...Object.values(S.STATE_MESSAGES), S.RERUN_HELP]
  .map((t) => t.split('{')[0].trim()).filter((t) => t.length >= 12);

async function assertNoSetupText(page, what) {
  const text = await page.evaluate(() => document.body.innerText);
  assert.doesNotMatch(text, SECRET_NAMES, `${what}: a secret name before anything was tapped`);
  for (const s of SETUP_SENTENCES) assert.ok(!text.includes(s), `${what}: “${s}” before anything was tapped`);
}

test('F00.7: no screen shows a setup sentence or a secret name before a feature is tapped or the server section opened', { timeout: 120000 }, async () => {
  await unpair();
  await storageSet({ settings: { lab: true } });
  for (const paired of [false, true]) {
    if (paired) await pair(await ds.pairingLink({ secret: ds.generateSecret(), relay: relay.url, name: 'Fresh Daylight' }));
    const popup = await openPopup();
    await assertNoSetupText(popup, `popup (${paired ? 'paired' : 'pairing'})`);
    await popup.getByRole('button', { name: 'Settings' }).click();
    await popup.waitForFunction(() => document.querySelector('#server-sub').textContent !== '');
    await assertNoSetupText(popup, 'popup settings');
    await popup.close();
    for (const view of ['lab', 'whats-in-lab']) {
      const page = await openLab(view);
      await assertNoSetupText(page, `lab.html#${view}`);
      await page.close();
    }
  }
  // The server section is where setup happens: it may (and with no server does) show both.
  const server = await openLab('server');
  assert.match(await server.evaluate(() => document.body.innerText), SECRET_NAMES);
  await server.close();
  await unpair();
});

// --- F00.3, F00.5, F00.6 ---------------------------------------------------------------------------------------------

test('a server feature’s tap shows exactly its sentence under it, announced and never greyed out; Copy Server code; OK or another tap closes it', { timeout: 120000 }, async () => {
  await storageSet({ settings: { lab: true } });
  // The server vectors' pairing, on the mock relay: the Server code is the link form with the vectors' seed.
  await sw.evaluate(async ({ code, r }) => globalThis.sendToDaylight.pair({ input: code, relay: r, confirm: true }), { code: VEC.pairingCode, r: relay.url });
  const page = await openLab('whats-in-lab');
  assert.equal(await page.textContent('.lab-group-state'), 'Not set up');
  assert.equal(await page.textContent('.lab-group-h'), LAB_TEXT.serverHeading);
  for (const id of ['F02', 'F37', 'F19', 'F36']) {
    const row = featureRow(page, id).locator('button.lab-row');
    assert.equal(await row.isEnabled(), true, `${id}: never disabled`);
    assert.equal(await row.getAttribute('aria-disabled'), null);
    assert.equal(await row.evaluate((e) => getComputedStyle(e).opacity), '1', `${id}: never greyed out`);
    assert.equal(await row.textContent(), `${LAB_TEXT.features[id].name}${LAB_TEXT.features[id].sentence}`, `${id}: no short state that repeats the heading`);
  }

  const t0 = Date.now();
  await page.getByRole('button', { name: LAB_TEXT.features.F37.name, exact: true }).click();
  const note = featureRow(page, 'F37').locator('.lab-note');
  await note.locator('.lab-note-body[data-state="needs-server"]').waitFor({ timeout: 5000 });
  assert.ok(Date.now() - t0 < 5000, 'within 5 s (F00.6)');
  assert.equal(await note.locator('.lab-note-text').textContent(), LAB_TEXT.needs['needs-server']);
  assert.equal(await note.getAttribute('aria-live'), 'polite', 'said to screen readers');
  assert.equal(await featureRow(page, 'F37').evaluate((li) => li.children[1].classList.contains('lab-note')), true, 'directly under the row');
  await shot(page, 'whats-in-lab-note');

  // Copy Server code (F00.5): the vectors' seed, in the link form for this relay.
  const lastCopy = await recordCopies(page);
  await note.getByRole('button', { name: LAB_TEXT.buttons['needs-server'] }).click();
  await note.getByText(LAB_TEXT.setup.copied).waitFor();
  const copied = await lastCopy();
  const expected = await S.formatServerCode(await S.deriveServerSeed(Uint8Array.from(Buffer.from(VEC.secretHex, 'hex'))), { relay: relay.url });
  assert.equal(copied, expected);
  assert.equal(new URLSearchParams(copied.split('?')[1]).get('c'), VEC.derived.serverCode.replace(/^SERVER-/, '').replace(/-/g, ''));

  // Another control closes it; OK closes the next one.
  await page.getByRole('button', { name: LAB_TEXT.features.F02.name, exact: true }).click();
  await featureRow(page, 'F02').locator('.lab-note-body[data-state="needs-server"]').waitFor();
  assert.equal(await note.textContent(), '', 'the first note closed');
  await featureRow(page, 'F02').getByRole('button', { name: LAB_TEXT.noteButton }).click();
  assert.equal(await featureRow(page, 'F02').locator('.lab-note').textContent(), '');

  // The server section shows the same Server code, with the long state text (F00.5).
  const server = await openLab('server');
  assert.equal(await server.textContent('.lab-server-code'), expected);
  assert.equal(await server.textContent('.lab-server-state .lab-note-text'), S.STATE_MESSAGES['needs-server']);
  assert.equal(await server.textContent('.lab-server-where'), S.showFingerprint(VEC.derived.fingerprint));
  const serverCopy = await recordCopies(server);
  await server.getByRole('button', { name: LAB_TEXT.serverSection.copy, exact: true }).click();
  await server.getByText(LAB_TEXT.setup.copied).waitFor();
  assert.equal(await serverCopy(), expected);
  await shot(server, 'server-needs-server');
  await server.close();
  await page.close();
});

test('with a server: the typed Server address, then Ready, the rows’ own states, `later` and needs-key (F00.3)', { timeout: 120000 }, async () => {
  await storageSet({ settings: { lab: true } });
  const secret = ds.generateSecret();
  await pair(await ds.pairingLink({ secret, relay: relay.url, name: 'Server Daylight' }));
  worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(secret))).authToken;
  worker.state.status = statusJson({ features: { ai: 'needs-key', email: 'needs-domain' }, lastSeen: new Date(Date.now() - 5 * MIN).toISOString(), usd: 0.227, limitUsd: 3 });
  const server = await openLab('server');
  await server.getByLabel(LAB_TEXT.serverSection.serverAddress).fill(worker.url);
  await server.getByRole('button', { name: 'Save' }).click();
  await server.waitForFunction(() => document.querySelector('.lab-server-ready')?.textContent === 'Ready', null, { timeout: 15000 });
  assert.equal(await server.textContent('.lab-server-where'), `localhost · ${S.showFingerprint((await S.deriveServerValues(await S.deriveServerSeed(secret))).fingerprint)}`);
  assert.equal(await server.textContent('.lab-server-inbox'), 'Lab Inbox last seen 5 min ago');
  assert.equal(await server.textContent('.lab-server-ai'), 'AI today: US$0.23 of US$3');
  assert.equal(await server.inputValue('input[type=url]'), worker.url);
  assert.equal(await server.textContent('.lab-server-rerun'), S.RERUN_HELP);
  await shot(server, 'server-ready');
  await server.close();

  const page = await openLab('whats-in-lab');
  assert.equal(await page.textContent('.lab-group-state'), 'Ready');
  const shorts = {};
  for (const id of ['F02', 'F37', 'F19', 'F36']) shorts[id] = await featureRow(page, id).locator('.lab-short').textContent().catch(() => null);
  assert.deepEqual(shorts, { F02: 'In a later update', F37: 'Needs a Claude key', F19: 'Needs an email domain', F36: 'In a later update' });
  await page.getByRole('button', { name: LAB_TEXT.features.F02.name, exact: true }).click();
  await featureRow(page, 'F02').locator('.lab-note-body[data-state="later"]').waitFor();
  assert.equal(await featureRow(page, 'F02').locator('.lab-note-text').textContent(), 'Your Daylight server is ready. Files over 9 MB comes to this app in a later Lab update.');
  await page.getByRole('button', { name: LAB_TEXT.features.F37.name, exact: true }).click();
  await featureRow(page, 'F37').locator('.lab-note-body[data-state="needs-key"]').waitFor();
  assert.equal(await featureRow(page, 'F37').locator('.lab-note-text').textContent(), S.STATE_MESSAGES['needs-key']);
  assert.equal(await featureRow(page, 'F37').locator('.lab-note-fix').count(), 0, 'no button: nothing on this device fixes it');
  await shot(page, 'whats-in-lab-ready');
  await page.close();

  const popup = await openPopup();
  await popup.getByRole('button', { name: 'Settings' }).click();
  await popup.waitForFunction(() => document.querySelector('#server-sub').textContent === 'Optional · Ready');
  await popup.close();
  await unpair();
});

test('a relay that never answers: “Checking your Daylight server…”, then OFFLINE at 5 s (F00.6)', { timeout: 120000 }, async () => {
  const hang = await hangingServer();
  try {
    await storageSet({ settings: { lab: true } });
    const secret = ds.generateSecret();
    await sw.evaluate(async ({ code, r }) => globalThis.sendToDaylight.pair({ input: code, relay: r, confirm: true }), { code: await ds.formatCode(secret), r: hang.url });
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 360, height: 760 });
    await page.goto(`chrome-extension://${extId}/lab.html#whats-in-lab`);
    await page.waitForSelector('body[data-ready="1"]');
    assert.equal(await page.textContent('.lab-group-state'), LAB_TEXT.checking, 'the heading says so while the server is asked');
    const t0 = Date.now();
    await page.getByRole('button', { name: LAB_TEXT.features.F37.name, exact: true }).click();
    const note = featureRow(page, 'F37').locator('.lab-note');
    await note.locator('[data-state="checking"]').waitFor({ timeout: 2000 });
    assert.equal(await note.locator('.lab-note-text').textContent(), LAB_TEXT.checking);
    await note.locator('[data-state="OFFLINE"]').waitFor({ timeout: 9000 });
    const took = Date.now() - t0;
    assert.ok(took >= 4500 && took < 8000, `OFFLINE at the 5 s deadline (${took} ms)`);
    assert.equal(await note.locator('.lab-note-text').textContent(), S.STATE_MESSAGES.OFFLINE);
    await page.close();
  } finally {
    await unpair();
    await hang.close();
  }
});

// --- F17 ----------------------------------------------------------------------------------------------------------------

test('What’s in Lab’s header follows the Daylight: nothing heard, a v1.1 Daylight’s ack, then a Lab Daylight’s hello (F17.2)', { timeout: 120000 }, async () => {
  await storageSet({ settings: { lab: true } });
  const secret = ds.generateSecret();
  const pairing = { secret, relay: relay.url };
  await pair(await ds.pairingLink({ secret, relay: relay.url, name: 'Ledger Daylight' }));
  let page = await openLab('whats-in-lab');
  assert.equal(await page.textContent('.lab-inbox'), LAB_TEXT.short['needs-inbox']);
  await page.close();

  // A v1.1 Daylight acks: the row says Delivered ✓, the header still needs Lab, with the check-in time.
  await sw.evaluate(async () => globalThis.sendToDaylight.sendUrl('https://example.com/ledger', 'Ledger'));
  await new ds.Receiver({ pairing, storage: new ds.MemoryStorage() }).pollOnce();
  page = await openLab('whats-in-lab');
  assert.equal(await page.textContent('.lab-inbox'), 'Needs Lab on your Daylight · checked in just now');
  assert.equal((await storageGet('outbox'))[0].status, 'delivered');
  const popup = await openPopup();
  assert.equal(await popup.textContent('#history li .st'), 'Delivered ✓', 'a v1.1 row');
  await popup.close();

  // A Lab Daylight says hello (with the state of a new item): the open page's header follows the ledger.
  await sw.evaluate(async () => globalThis.sendToDaylight.sendUrl('https://example.com/ledger-2', 'Ledger 2'));
  const storage = new ds.MemoryStorage();
  const labInbox = new L.LabInbox({
    storage, relay: new ds.RelayClient({ relay: relay.url }), keys: await ds.deriveKeys(secret),
    info: { lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'], live: false }, from: 'Daylight', autoFlushMs: null,
  });
  await new L.LabInboxSim({ receiver: new ds.Receiver({ pairing, storage }), labInbox }).pollOnce();
  await sw.evaluate(async () => globalThis.sendToDaylight.tick());
  await page.waitForFunction(() => document.querySelector('.lab-inbox').textContent.startsWith('Your Daylight: Lab on'));
  assert.equal(await page.textContent('.lab-inbox'), 'Your Daylight: Lab on · checked in just now');
  await shot(page, 'whats-in-lab-inbox-lab');
  await page.close();
  await unpair();
});

// --- 2.6: what a fresh answer and a re-pairing show -------------------------------------------------------------------

test('a fresh What’s in Lab answer gives every row its short state, also with a note open (F00.3)', { timeout: 120000 }, async () => {
  await storageSet({ settings: { lab: true } });
  const secret = ds.generateSecret();
  await pair(await ds.pairingLink({ secret, relay: relay.url, name: 'Slow Daylight' }));
  worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(secret))).authToken;
  worker.state.status = statusJson({ features: { ai: 'needs-key', email: 'needs-domain' } });
  await storageSet({ 'server/manualUrl': worker.url });
  // The server takes 2 s to answer, so a feature can be tapped before What's in Lab has its states.
  worker.state.statusDelayMs = 2000;
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 360, height: 760 });
    await page.goto(`chrome-extension://${extId}/lab.html#whats-in-lab`);
    await page.waitForSelector('body[data-ready="1"]');
    assert.equal(await page.textContent('.lab-group-state'), LAB_TEXT.checking);
    assert.equal(await page.locator('.lab-short').count(), 0, 'no states yet');
    await page.getByRole('button', { name: LAB_TEXT.features.F02.name, exact: true }).click();
    await featureRow(page, 'F02').locator('.lab-note-body[data-state="later"]').waitFor({ timeout: 9000 });
    await page.waitForSelector('body[data-fresh="1"]', { timeout: 9000 });
    // The note stays, and every row has its short state now.
    assert.equal(await featureRow(page, 'F02').locator('.lab-note-text').textContent(), 'Your Daylight server is ready. Files over 9 MB comes to this app in a later Lab update.');
    assert.equal(await page.textContent('.lab-group-state'), 'Ready');
    const shorts = {};
    for (const id of ['F02', 'F37', 'F19', 'F36']) shorts[id] = await featureRow(page, id).locator('.lab-short').textContent().catch(() => null);
    assert.deepEqual(shorts, { F02: 'In a later update', F37: 'Needs a Claude key', F19: 'Needs an email domain', F36: 'In a later update' });
    // ...in each row's description, for screen readers.
    const row = featureRow(page, 'F37').locator('button.lab-row');
    const described = await row.evaluate((b) => b.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id)?.textContent));
    assert.deepEqual(described, [LAB_TEXT.features.F37.sentence, 'Needs a Claude key']);
    await shot(page, 'whats-in-lab-fresh-note');
    await page.close();
  } finally {
    worker.state.statusDelayMs = 0;
    await unpair();
  }
});

test('re-pairing with another Daylight while a server is known: the popup shows the locked text, the new Server code with Copy and the re-run help, until OK (2.6)', { timeout: 120000 }, async () => {
  await storageSet({ settings: { lab: true, comfort: true } });
  const secret = ds.generateSecret();
  await pair(await ds.pairingLink({ secret, relay: relay.url, name: 'Old Daylight' }));
  worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(secret))).authToken;
  worker.state.status = statusJson();
  await storageSet({ 'server/manualUrl': worker.url });
  const locks = worker.count('POST /v1/admin/lock');
  const page = await ctx.newPage();
  await page.goto(`${site.url}/parity.html`);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `${site.url}/parity.html`);
  let popup = await openPopup(tabId);
  assert.equal(await popup.isVisible('#repaired'), false, 'nothing before a re-pairing');
  await popup.click('#open-settings');
  await popup.click('#repair');
  const next = ds.generateSecret();
  await popup.fill('#code', await ds.formatCode(next));
  await popup.click('#pair-btn');
  await popup.waitForSelector('#view-confirm:not([hidden])');
  await popup.click('#confirm-yes');
  await popup.waitForSelector('#view-send:not([hidden])');
  await popup.waitForSelector('#repaired:not([hidden])');
  assert.equal(worker.count('POST /v1/admin/lock'), locks + 1, 'the old server was locked first');
  assert.equal(await storageGet('server/manualUrl'), undefined, 'the old server’s typed address is gone');

  const panel = popup.getByRole('region', { name: LAB_TEXT.serverRow });
  assert.equal(await panel.isVisible(), true);
  const code = await S.formatServerCode(await S.deriveServerSeed(next), { relay: relay.url });
  assert.equal(await popup.textContent('#repaired .lab-repaired-text'), S.STATE_MESSAGES.locked);
  assert.equal(await popup.textContent('#repaired .lab-server-h'), LAB_TEXT.serverSection.serverCode);
  assert.equal(await popup.textContent('#repaired .lab-server-code'), code);
  assert.equal(await popup.textContent('#repaired .lab-server-rerun'), S.RERUN_HELP);
  // Said to screen readers, through the send view's polite live region.
  await popup.waitForFunction((t) => document.querySelector('#announce').textContent === t, S.STATE_MESSAGES.locked);
  // F27: no axe violations, every control named, nothing clipped at 360 px with Comfort.
  await axe(popup, 'popup: the re-pairing follow-up');
  assert.deepEqual(await unnamed(popup), []);
  await assertNotClipped(popup, 'popup: the re-pairing follow-up, Comfort');
  await shot(popup, 'popup-repaired');
  const lastCopy = await recordCopies(popup);
  await panel.getByRole('button', { name: LAB_TEXT.serverSection.copy, exact: true }).click();
  await panel.getByText(LAB_TEXT.setup.copied).waitFor();
  assert.equal(await lastCopy(), code);

  // It stays until OK: the popup opened again still shows it; with Lab off it doesn't (1.3).
  await popup.close();
  popup = await openPopup(tabId);
  assert.equal(await popup.isVisible('#repaired'), true);
  await storageSet({ settings: { lab: false, comfort: true } });
  await popup.waitForSelector('#repaired', { state: 'hidden' });
  await storageSet({ settings: { lab: true, comfort: true } });
  await popup.waitForSelector('#repaired:not([hidden])');
  await popup.getByRole('region', { name: LAB_TEXT.serverRow }).getByRole('button', { name: LAB_TEXT.noteButton, exact: true }).click();
  await popup.waitForSelector('#repaired', { state: 'hidden' });
  assert.equal(await popup.evaluate(() => document.activeElement?.id), 'send-page');
  assert.equal(await storageGet('lab/repaired'), undefined);
  await popup.close();
  popup = await openPopup(tabId);
  assert.equal(await popup.isVisible('#repaired'), false, 'gone after OK');
  await popup.close();
  await page.close();
  await storageSet({ settings: { lab: true } });
  await unpair();
});
