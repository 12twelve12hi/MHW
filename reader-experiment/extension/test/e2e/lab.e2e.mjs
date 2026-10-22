// Lab in a real Chromium (LAB-PLAN F00 and F17, extension parts; card X0): the popup's Lab row and lab.html, against
// the mock relay, a stand-in Daylight server (test/helpers/fake-worker.mjs) and Daylights from daylight-lab.js.
//
//   F00.1  a fresh install has Lab on, with the one-time note (W1); an update over the last non-Lab build turns Lab on
//          and keeps the pairing, the history, the device name and Comfort
//   F00.2  with Lab on, W1 leaves the popup's pairing screen as the non-Lab baseline and adds its pieces to the sending
//          screen, which is the baseline again with Lab off, every Lab setting used (lab-off-parity.e2e.mjs: Lab off);
//          with Lab off, the popup and lab.html show only the switch
//   F00.3  a server feature's tap shows exactly its sentence under it, announced, never greyed out
//   F00.5  the Server code shown for the vector pairing, and Copy
//   F00.6  needs-server within 5 s; a relay that never answers: "Checking your Daylight server…", then OFFLINE at 5 s
//   F00.7  no setup sentence or secret name on a screen before a feature is tapped or the server section opened
//   F17.2  What's in Lab's header from the ledger: nothing heard, a v1.1 ack, a Lab hello
//   1.5    What's in Lab opened again within 10 minutes shows the cached states at once, then the server's new answer
//   2.6    re-pairing with another Daylight while a server is known: the popup's follow-up (the locked text, the new
//          Server code with Copy, the re-run help) until OK; a fresh What's in Lab answer updates the rows' short
//          states with a note open; the server moved ("… moved to {host}. Use it?", Cancel, Use it); Set up with a
//          link (a bad link, the address confirmation, Cancel, a refused site); Unpair forgets a typed Server address
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
/**
 * Unpairs, which forgets a typed Server address with the pairing (checked here, 2.6), then forgets the rest of the
 * Daylight server too, so the next test starts without it: the pin and the caches outlive a pairing (DESIGN 13.1).
 */
const unpair = async () => {
  const kept = await sw.evaluate(async () => {
    await globalThis.sendToDaylight.unpair();
    return (await chrome.storage.local.get('server/manualUrl'))['server/manualUrl'] ?? null;
  });
  assert.equal(kept, null, 'Unpair forgot the typed Server address');
  await sw.evaluate(async () => {
    await chrome.storage.local.remove(Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('server/')));
  });
};

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

test('a fresh install has Lab on and, in W1, the one-time note; Settings starts with the switch, whose rows open lab.html', { timeout: 90000 }, async () => {
  assert.deepEqual(await labDefaultWritten(sw), { lab: true }, 'the first start wrote lab = true (F00.1)');
  const popup = await openPopup();
  assert.equal(await popup.getByText(LAB_TEXT.note).count(), 1, 'the one-time note in a build with F01 and F04 (lab-w1.e2e.mjs: once)');
  // Once the note is seen, W1 adds nothing to the pairing screen: with Lab on it is the non-Lab baseline too.
  await storageSet({ settings: { lab: true, labNoteShown: true, from: 'Parity Chrome' } });
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

test('F00.1 upgrade: the update over a non-Lab build turns Lab on at its first start and keeps the pairing, history, name and Comfort', { timeout: 150000 }, async () => {
  // Its own browser profile: the release build without Lab, used for a while, then the Lab build in its folder with a
  // higher version, as an update leaves it: the same extension and its storage. Chrome keeps the background scripts of
  // an extension loaded from the command line in its service-worker store whatever the folder holds, so that store goes
  // with the update (a store update registers the new worker); chrome.storage.local is elsewhere and stays.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-upgrade-'));
  const folder = path.join(dir, 'extension');
  const profile = path.join(dir, 'profile');
  const install = (opts, bump = false) => {
    const from = built('chrome', opts);
    fs.rmSync(folder, { recursive: true, force: true });
    fs.cpSync(from.dir, folder, { recursive: true });
    const file = path.join(folder, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.version = `${manifest.version.split('.').slice(0, 3).join('.')}${bump ? '.1' : ''}`;
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    return manifest.version;
  };
  const ours = (x) => x.url().startsWith('chrome-extension://') && x.url().endsWith('/background.js');
  /** Starts the browser; -> {c, w: the extension's service worker once sendToDaylight is up, built: that build's Lab}. */
  const launch = async () => {
    const c = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: !process.env.HEADED, args: [`--disable-extensions-except=${folder}`, `--load-extension=${folder}`],
    });
    const w = c.serviceWorkers().find(ours) ?? await c.waitForEvent('serviceworker', { predicate: ours, timeout: 30000 });
    for (let i = 0; i < 100; i++) {
      const r = await w.evaluate(() => (globalThis.sendToDaylight ? [chrome.runtime.getManifest().version, globalThis.sendToDaylight.lab.built] : null)).catch(() => null);
      if (r) return { c, w, version: r[0], built: r[1] };
      await new Promise((res) => setTimeout(res, 100));
    }
    await c.close();
    throw new Error('the extension never started');
  };
  const all = (w) => w.evaluate(() => chrome.storage.local.get(null));

  const v1 = install({ lab: false });
  let { c, w, version, built: hasLab } = await launch();
  let was, id;
  try {
    id = new URL(w.url()).host;
    assert.deepEqual([version, hasLab], [v1, false], 'the build without Lab');
    const secret = ds.generateSecret();
    await w.evaluate(async (i) => globalThis.sendToDaylight.pair({ input: i, from: 'Old laptop', confirm: true }),
      await ds.pairingLink({ secret, relay: relay.url, name: 'Upgraded Daylight' }));
    await w.evaluate(async () => globalThis.sendToDaylight.setComfort(true));
    await w.evaluate(async () => globalThis.sendToDaylight.sendUrl('https://example.com/before-lab', 'Sent before Lab'));
    await new ds.Receiver({ pairing: { secret, relay: relay.url }, storage: new ds.MemoryStorage() }).pollOnce();
    await w.evaluate(async () => globalThis.sendToDaylight.tick());
    was = await all(w);
    assert.deepEqual(was.settings, { from: 'Old laptop', comfort: true }, 'a non-Lab build writes no Lab switch');
    assert.deepEqual(was.outbox.map((r) => [r.title, r.status]), [['Sent before Lab', 'delivered']]);
    assert.ok(was.pairing);
  } finally { await c.close(); }

  // The update.
  const v2 = install({ lab: true }, true);
  fs.rmSync(path.join(profile, 'Default', 'Service Worker'), { recursive: true, force: true });
  ({ c, w, version, built: hasLab } = await launch());
  try {
    assert.equal(new URL(w.url()).host, id, 'the same extension');
    assert.deepEqual([version, hasLab], [v2, true], 'updated to the Lab build');
    assert.deepEqual(await labDefaultWritten(w), { from: 'Old laptop', comfort: true, lab: true }, 'the first start wrote lab = true and kept the rest');
    const now = await all(w);
    assert.deepEqual(now.pairing, was.pairing, 'the pairing is kept');
    assert.deepEqual(now.outbox, was.outbox, 'the history is kept');
    const popup = await c.newPage();
    await popup.setViewportSize({ width: 360, height: 640 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForSelector('body[data-ready="1"]');
    assert.equal(await popup.evaluate(() => document.body.classList.contains('comfort')), true, 'Comfort is still on');
    assert.equal(await popup.locator('#history li').count(), 1);
    assert.equal(await popup.textContent('#history li .st'), 'Delivered ✓');
    await popup.getByRole('button', { name: 'Settings' }).click();
    await popup.waitForSelector('#view-settings:not([hidden])');
    assert.equal(await popup.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).isChecked(), true, 'Lab is on');
    assert.equal(await popup.getByRole('switch', { name: LAB_TEXT.comfort, exact: true }).isChecked(), true);
    await shot(popup, 'popup-settings-after-upgrade');
  } finally { await c.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('with Lab on, W1 adds its pieces to the sending screen; turned off, with every Lab setting used, it is the non-Lab baseline (F00.2)', { timeout: 90000 }, async () => {
  await labDefaultWritten(sw);
  await storageSet({ settings: { lab: true, labNoteShown: true, from: 'Parity Chrome' } });
  await pair(await ds.pairingLink({ secret: FIXED_SECRET, relay: relay.url, name: 'Parity Daylight' }));
  await storageSet({ outbox: parityRows() });
  const page = await ctx.newPage();
  await page.goto(`${site.url}/parity.html`);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `${site.url}/parity.html`);
  const popup = await openPopup(tabId);
  await popup.waitForSelector('.send-as-btn');
  for (const sel of ['.send-as-btn', '.lab-paste-btn', '#lab-checkin', '#lab-queue li']) assert.equal(await popup.locator(sel).first().isVisible(), true, sel);
  // Lab off, after its settings were used (the Use switches, the card, Review, the menu boxes): the plain screen.
  await storageSet({ settings: { lab: false, labNoteShown: true, from: 'Parity Chrome', labUse: { F04: false, F16: false }, labClickSend: true, labReview: true, labMenus: { image: false } } });
  await popup.reload();
  await popup.waitForSelector('body[data-ready="1"]');
  await expectBaseline(popup, 'popup-send');
  await popup.close();
  await page.close();
  await storageSet({ settings: { lab: true, labNoteShown: true } });
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
  // Not set up: "Turn it on" with the five steps, numbered, and where every step is (2.6, LAB_TEXT.serverSection).
  const SS = LAB_TEXT.serverSection;
  assert.equal(await server.textContent('.lab-server-steps h3'), SS.stepsHeading);
  assert.deepEqual(await server.locator('.lab-server-steps ol > li').allTextContents(), SS.steps);
  assert.equal(SS.steps[1], S.RERUN_HELP);
  assert.equal(await server.textContent('.lab-server-steps-more'), SS.stepsMore);
  assert.equal(await server.locator('.lab-server-delivery').count(), 0, 'no server found: no Delivery line');
  const address = server.getByLabel(SS.serverAddress);
  assert.equal(await address.getAttribute('placeholder'), SS.addressPlaceholder);
  assert.equal(await server.textContent('.lab-server-address-footer'), SS.addressFooter);
  await server.getByRole('button', { name: SS.addressSave, exact: true }).waitFor();
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
  await server.getByRole('button', { name: LAB_TEXT.serverSection.addressSave, exact: true }).click();
  await server.waitForFunction(() => document.querySelector('.lab-server-ready')?.textContent === 'Ready', null, { timeout: 15000 });
  // "Your server": the typed address's host and port, then the fingerprint (hostLineText); the delivery mode.
  const fp = S.showFingerprint((await S.deriveServerValues(await S.deriveServerSeed(secret))).fingerprint);
  assert.equal(await server.textContent('.lab-server-where'), `${new URL(worker.url).host} · ${fp}`);
  assert.equal(await server.textContent('.lab-server-where'), L.hostLineText(worker.url, fp));
  assert.deepEqual(await server.locator('.lab-server-h').allTextContents(),
    [LAB_TEXT.serverSection.hostLabel, LAB_TEXT.serverSection.deliveryLabel, LAB_TEXT.serverSection.serverCode]);
  assert.equal(await server.textContent('.lab-server-delivery'), LAB_TEXT.serverSection.deliveryLab);
  assert.equal(await server.locator('.lab-server-steps').count(), 0, 'set up: no steps');
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

  // Opened again within 10 minutes: the cached states at once, while the server is asked again (1.5).
  worker.state.statusDelayMs = 2000;
  try {
    const again = await ctx.newPage();
    await again.setViewportSize({ width: 360, height: 760 });
    await again.goto(`chrome-extension://${extId}/lab.html#whats-in-lab`);
    await again.waitForSelector('body[data-ready="1"]');
    assert.equal(await again.locator('body[data-fresh="1"]').count(), 0, 'the server’s new answer is still on its way');
    assert.equal(await again.textContent('.lab-group-state'), 'Ready', 'not “Checking your Daylight server…”');
    const cached = {};
    for (const id of ['F02', 'F37', 'F19', 'F36']) cached[id] = await featureRow(again, id).locator('.lab-short').textContent().catch(() => null);
    assert.deepEqual(cached, shorts);
    await again.waitForSelector('body[data-fresh="1"]', { timeout: 9000 });
    assert.equal(await again.textContent('.lab-group-state'), 'Ready');
    await again.close();
  } finally { worker.state.statusDelayMs = 0; }

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
    assert.equal(await page.locator('.lab-group .lab-short').count(), 0, 'no server states yet');
    assert.equal(await featureRow(page, 'F04').locator('.lab-short').textContent(), 'Ready', 'W1’s own features have theirs at once');
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

test('the server moved: the section asks “Your Daylight server moved to {host}. Use it?”; Cancel keeps the old server, Use it asks for the new site and pins it (2.6)', { timeout: 120000 }, async () => {
  await storageSet({ settings: { lab: true, comfort: true } });
  const secret = ds.generateSecret();
  await pair(await ds.pairingLink({ secret, relay: relay.url, name: 'Moved Daylight' }));
  const values = await S.deriveServerValues(await S.deriveServerSeed(secret));
  const S2 = LAB_TEXT.serverSection;
  // Pinned at `old`; the deploy made a new setup link, so a new Worker announces itself at `moved` (server DESIGN
  // 3.5). This browser has neither site, so nothing is asked of either server here.
  const old = 'https://daylight-aaaaaaaaaaaa.example.workers.dev';
  const moved = 'https://daylight-bbbbbbbbbbbb.example.workers.dev';
  // The config read on the relay a minute ago is cached, fresh for 6 hours (CONFIG_REFRESH_MS): opening the section
  // reads the config topic anyway (DESIGN 4.3), so the question comes at once.
  await storageSet({
    'server/pin': { origin: old, fingerprint: values.fingerprint },
    'server/config': { server: old, api: 1, fingerprint: values.fingerprint, delivery: 'lab', sent: new Date(Date.now() - MIN).toISOString(), id: '' },
    'server/configAt': Date.now() - MIN,
  });
  await new ds.RelayClient({ relay: relay.url }).publish(values.configTopic, await S.buildConfigFrame(values, { server: moved }));
  const server = await openLab('server');
  const question = 'Your Daylight server moved to daylight-bbbbbbbbbbbb.example.workers.dev. Use it?';
  assert.equal(L.serverMovedText(moved), question);
  let ask = server.getByRole('group', { name: question });
  await ask.waitFor();
  assert.equal(await ask.locator('.lab-note-text').textContent(), question);
  assert.deepEqual(await ask.getByRole('button').allTextContents(), [S2.setupConfirm, S2.setupCancel]);
  assert.equal(await server.textContent('.lab-server-where'), `daylight-aaaaaaaaaaaa.example.workers.dev · ${S.showFingerprint(values.fingerprint)}`, 'still the old server');
  // F27: no axe violations, every control named, nothing clipped at 360 px with Comfort.
  await axe(server, 'lab.html: Daylight server, the server moved');
  assert.deepEqual(await unnamed(server), []);
  await assertNotClipped(server, 'lab.html: Daylight server, the server moved, Comfort');
  await shot(server, 'server-moved');

  // Cancel: the question closes, the focus goes on to Copy, nothing changes; it is asked again next time.
  await ask.getByRole('button', { name: S2.setupCancel, exact: true }).click();
  await ask.waitFor({ state: 'detached' });
  assert.equal(await server.evaluate(() => document.activeElement?.classList.contains('lab-server-copy')), true);
  assert.deepEqual(await storageGet('server/pin'), { origin: old, fingerprint: values.fingerprint });
  await server.reload();
  await server.waitForSelector('body[data-fresh="1"]', { timeout: 20000 });
  ask = server.getByRole('group', { name: question });
  await ask.waitFor();

  // Use it: the new server's site is asked for (refused here), then the move is confirmed and the section drawn again.
  await server.evaluate(() => { window.__asked = []; chrome.permissions.request = async (p) => { window.__asked.push(...(p?.origins ?? [])); return false; }; });
  await ask.getByRole('button', { name: S2.setupConfirm, exact: true }).click();
  await server.waitForFunction(() => !document.querySelector('.lab-server-moved') && document.body.dataset.fresh === '1', null, { timeout: 15000 });
  assert.deepEqual(await server.evaluate(() => window.__asked), [`${moved}/*`]);
  assert.deepEqual(await storageGet('server/pin'), { origin: moved, fingerprint: values.fingerprint });
  assert.equal(await storageGet('server/pendingMove'), undefined);
  assert.equal(await server.textContent('.lab-server-where'), `daylight-bbbbbbbbbbbb.example.workers.dev · ${S.showFingerprint(values.fingerprint)}`);
  assert.equal(await server.getAttribute('.lab-server-state .lab-note-body', 'data-state'), 'needs-site-access', 'the new server’s site is still to allow');
  assert.equal(await server.evaluate(() => document.activeElement?.id), 'server-h', 'the focus is on the section, whose state is read next');
  await server.close();
  await storageSet({ settings: { lab: true } });
  await unpair();
});

test('Set up with a link in the server section: first while not set up; a bad link says why; the address is confirmed before anything is sent (2.6)', { timeout: 120000 }, async () => {
  await storageSet({ settings: { lab: true } });
  await pair(await ds.pairingLink({ secret: ds.generateSecret(), relay: relay.url, name: 'Setup Daylight' }));
  const server = await openLab('server');
  const S2 = LAB_TEXT.serverSection;
  // Not set up: the setup row comes right after the state, whose message says to paste the link.
  const order = await server.$$eval('#server > *', (els) => els.map((e) => e.classList[0]));
  assert.deepEqual(order.slice(0, 2), ['lab-server-state', 'lab-server-setup']);
  const field = server.getByLabel(S2.setupRow, { exact: true });
  assert.equal(await field.getAttribute('placeholder'), S2.setupPlaceholder);
  assert.equal(await server.textContent('.lab-server-setup-footer'), S2.setupFooter);
  assert.equal(await field.evaluate((i) => document.getElementById(i.getAttribute('aria-describedby')).textContent), S2.setupFooter);

  // The Server code pasted by mistake: the module's message, nothing asked.
  const code = await server.textContent('.lab-server-code');
  await field.fill(code);
  await server.getByRole('button', { name: S2.setupButton, exact: true }).click();
  await server.waitForFunction(() => document.querySelector('.lab-server-setup-said')?.textContent !== '');
  const said = await server.textContent('.lab-server-setup-said');
  await assert.rejects(S.parseSetupLink(code), (e) => e.reason === 'server-code' && e.message === said);
  assert.equal(await server.isVisible('.lab-server-setup-confirm'), false);

  // A setup link: the confirmation names its address; Cancel sends nothing.
  const origin = 'https://daylight-0123456789ab.example.workers.dev';
  const link = await S.formatSetupLink(origin, Uint8Array.from({ length: 16 }, (_, i) => i + 1));
  await field.fill(link);
  await server.getByRole('button', { name: S2.setupButton, exact: true }).click();
  const ask = server.getByRole('group', { name: S2.setupConfirmTitle });
  await ask.waitFor();
  assert.equal(await ask.locator('.lab-note-text').textContent(), L.setupConfirmText(origin));
  assert.equal(await server.evaluate(() => document.activeElement?.textContent), S2.setupConfirm);
  await axe(server, 'lab.html: Daylight server, the setup link’s confirmation');
  assert.deepEqual(await unnamed(server), []);
  await shot(server, 'server-setup-confirm');
  await ask.getByRole('button', { name: S2.setupCancel, exact: true }).click();
  await ask.waitFor({ state: 'hidden' });
  assert.equal(await server.textContent('.lab-server-setup-said'), '');

  // Use it, and the browser refuses the server's site: the needs-site-access sentence, nothing sent.
  await server.evaluate(() => { chrome.permissions.request = async () => false; });
  await server.getByRole('button', { name: S2.setupButton, exact: true }).click();
  await ask.getByRole('button', { name: S2.setupConfirm, exact: true }).click();
  await server.waitForFunction((t) => document.querySelector('.lab-server-setup-said')?.textContent === t, LAB_TEXT.needs['needs-site-access']);
  assert.equal(await storageGet('server/pin'), undefined);
  await server.close();
  await unpair();
});
