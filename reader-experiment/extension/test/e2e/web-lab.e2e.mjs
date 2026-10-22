// Lab in the web sender, in a real Chromium (LAB-PLAN F00 and F17, web parts; card B0): Settings' Lab switch and its
// rows, What's in Lab, the Daylight server section and the re-pairing follow-up, against the mock relay, a stand-in
// Daylight server behind the server's own CORS answer (DESIGN 10.2) and Daylights from daylight-lab.js.
//
//   F00.1  a fresh page has Lab on (settings.lab written), with no one-time note in W0
//   F00.2  with Lab on, W0 leaves the pairing and sending screens as the non-Lab baselines (Lab off is
//          web-lab-off-parity.e2e.mjs); with Lab off only the switch shows, and a Lab view open in another tab closes
//   1.7    ?lab=0 and ?lab=1 on 127.0.0.1
//   F00.3  a server feature's tap shows exactly its sentence under it, announced, never greyed out; OK or another tap
//          closes it; with a server: Ready, `later` and the server's own states
//   F00.5  the Server code shown for the vector pairing, and Copy (the clipboard)
//   F00.6  needs-server within 5 s; a relay that never answers: "Checking your Daylight server…", then OFFLINE at 5 s
//   F00.7  no setup sentence or secret name on a screen before a feature is tapped or the server section opened
//   F17.2  What's in Lab's header from the ledger: nothing heard, a v1.1 ack, a Lab hello
//   2.6    re-pairing with another Daylight while a server is known: the follow-up until OK; Set up with a link; the
//          server moved ("Use it?"); What's in Lab's cached states (1.5); Unpair forgets a typed Server address
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/e2e/web-lab.e2e.mjs      (HEADED=1 to watch)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { webBuilt } from '../helpers/web-built.mjs';
import { expectBaseline, parityRows, FIXED_SECRET } from '../helpers/lab-off.mjs';
import { startFakeWorker, statusJson, hangingServer } from '../helpers/fake-worker.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const w = webBuilt();
const ds = await w.load('daylight-share.js');
const L = await w.load('daylight-lab.js');
const S = await w.load('daylight-server.js');
const { LAB_TEXT } = L;
const VEC = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'server', 'vectors', 'server-vectors.json'), 'utf8'));
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'test-results', 'web-lab');
const MIN = 60000;
const SETUP_ORIGIN = 'https://daylight-0123456789ab.example.workers.dev';

let relay, site, worker, front, browser;

/**
 * The stand-in server as the page reaches it: on another origin (http://localhost:<port>), answering the CORS
 * preflight and every request with the server's own CORS headers (DESIGN 10.2), so the page's calls pass a real check.
 */
async function corsFront(target) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-DLS-Source-Name',
    'Access-Control-Expose-Headers': 'Retry-After, Content-Length, X-DLS-Request-Id',
    'Access-Control-Max-Age': '86400',
  };
  const preflights = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { preflights.push(req.url); res.writeHead(204, CORS); return res.end(); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = {};
    for (const h of ['authorization', 'content-type']) if (req.headers[h]) headers[h] = req.headers[h];
    try {
      const r = await fetch(target + req.url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      res.writeHead(r.status, { ...CORS, 'Content-Type': r.headers.get('content-type') ?? 'application/json' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502, CORS); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://localhost:${server.address().port}`, preflights,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

before(async () => {
  relay = await startMockRelay();
  site = await w.serve();
  worker = await startFakeWorker();
  front = await corsFront(worker.url);
  browser = await chromium.launch({ channel: 'chromium', headless: !process.env.HEADED });
});

after(async () => {
  await browser?.close();
  await front?.close();
  await worker?.close();
  await relay?.close();
  await site?.close();
});

/** A fresh browser (its own IndexedDB) with the clipboard allowed for the site, and the page in it. */
async function openWeb(address = '/', { width = 360, height = 760 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.url });
  const page = await ctx.newPage();
  await page.goto(`${site.url}${address}`);
  await ready(page);
  return { ctx, page };
}

const ready = (page) => page.waitForSelector('body[data-ready="1"]');

/** The page's own storage (IndexedDB kv). */
const storageGet = (page, key) => page.evaluate(async (k) => {
  const { openStorage } = await import('./web-storage.js');
  return (await openStorage()).storage.get(k);
}, key);

/** Writes the page's own storage, then reloads it. */
async function store(page, items) {
  await page.evaluate(async (i) => {
    const { openStorage } = await import('./web-storage.js');
    const { storage } = await openStorage();
    for (const [k, v] of Object.entries(i)) await storage.set(k, v);
  }, items);
  await page.reload();
  await ready(page);
}

/** Pairs the page by storing a pairing (code, relay, name), as the page saves one. */
async function pairStored(page, { code, relay: r = relay.url, name = 'Lab Daylight', extra = {} }) {
  await store(page, { pairing: { code, relay: r, name }, ...extra });
}

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('#view-settings:not([hidden])');
}

/** Settings › What's in Lab or Daylight server, once the fresh answer is on it. */
async function openLabView(page, which) {
  if (await page.isHidden('#view-settings')) await openSettings(page);
  await page.click(which === 'server' ? '#open-server' : '#open-whats-in-lab');
  await page.waitForSelector('body[data-fresh="1"]', { timeout: 20000 });
}

/** A row of What's in Lab, by the feature's id. */
const featureRow = (page, id) => page.locator(`li.lab-feature[data-feature="${id}"]`);

/** The token the stand-in server asks for: this pairing's (DESIGN 3.2). */
async function serveFor(secret, status = statusJson()) {
  worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(secret))).authToken;
  worker.state.status = status;
  worker.state.statusDelayMs = 0;
}

// --- F00.1, F00.2, 1.7 ---------------------------------------------------------------------------------------------------

test('a fresh page has Lab on and no one-time note in W0; Settings starts with the switch and its rows; W0 leaves pairing and sending as the baselines', { timeout: 90000 }, async () => {
  const { ctx, page } = await openWeb('/', { width: 390, height: 844 });
  try {
    assert.deepEqual(await storageGet(page, 'settings'), { lab: true }, 'the first start wrote lab = true (F00.1)');
    assert.equal(await page.getByText(LAB_TEXT.note).count(), 0, 'no one-time note in a W0 build');
    await store(page, { settings: { from: 'Parity web', lab: true } });
    await expectBaseline(page, 'web-pair');
    // An upgrade from the last non-Lab build (a pairing, a history, settings without lab): Lab on, the rest kept (F00.1).
    await pairStored(page, { code: await ds.formatCode(FIXED_SECRET), name: 'Parity Daylight', extra: { outbox: parityRows(), settings: { from: 'Parity web' } } });
    assert.deepEqual(await storageGet(page, 'settings'), { from: 'Parity web', lab: true });
    assert.equal(await page.locator('#history li').count(), 6, 'the history is kept');
    await expectBaseline(page, 'web-send');
    assert.equal(await page.getByText(LAB_TEXT.note).count(), 0);

    await openSettings(page);
    const sw = page.getByRole('switch', { name: LAB_TEXT.lab, exact: true });
    assert.equal(await sw.isChecked(), true);
    // The first row of Settings (1.1): the switch, its two rows, its footer, then Comfort.
    const order = await page.$$eval('#view-settings .switch-row input, #view-settings .nav-row, #view-settings #lab-footer', (els) => els.map((e) => e.id));
    assert.deepEqual(order, ['lab', 'open-whats-in-lab', 'open-server', 'lab-footer', 'comfort']);
    assert.equal(await page.textContent('#lab-footer'), LAB_TEXT.switchFooter);
    await page.waitForFunction(() => document.querySelector('#server-sub').textContent !== '');
    assert.equal(await page.textContent('#server-sub'), 'Optional · Not set up');
    assert.equal(await page.getByRole('button', { name: `${LAB_TEXT.serverRow} Optional · Not set up` }).count(), 1, 'the row says its state');
    await shot(page, 'settings-lab-on');

    await page.click('#open-whats-in-lab');
    await page.waitForSelector('#view-whats-in-lab:not([hidden])');
    assert.equal(await page.getByRole('heading', { name: LAB_TEXT.whatsInLab, level: 2 }).isVisible(), true);
    assert.equal(await page.isVisible('#open-settings'), false);
    await page.getByRole('button', { name: '‹ Back' }).click();
    await page.waitForSelector('#view-settings:not([hidden])');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'open-whats-in-lab', 'back where it opened');
    await page.click('#open-server');
    await page.waitForSelector('#view-server:not([hidden])');
    assert.equal(await page.getByRole('heading', { name: LAB_TEXT.serverRow, level: 2 }).isVisible(), true);
    await page.getByRole('button', { name: '‹ Back' }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'open-server');
    // Settings' own ‹ Back still returns to sending.
    await page.click('#close-settings');
    await page.waitForSelector('#view-send:not([hidden])');
  } finally { await ctx.close(); }
});

test('?lab=0 and ?lab=1 set the switch on 127.0.0.1 (1.7); with Lab off only the switch shows; a Lab view closes when another tab turns Lab off', { timeout: 90000 }, async () => {
  const { ctx, page } = await openWeb('/?lab=0');
  try {
    assert.equal((await storageGet(page, 'settings')).lab, false);
    assert.equal(new URL(page.url()).search, '', 'the hook leaves the address');
    await openSettings(page);
    assert.equal(await page.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).isChecked(), false);
    assert.equal(await page.isVisible('#lab-rows'), false, 'no Lab rows with Lab off');
    assert.equal(await page.isVisible('#lab-footer'), true, 'the switch and its footer stay (1.3)');
    await shot(page, 'settings-lab-off');
    await page.goto(`${site.url}/?lab=1&url=${encodeURIComponent('https://example.com/kept')}`);
    await ready(page);
    assert.equal((await storageGet(page, 'settings')).lab, true);
    assert.equal(await page.inputValue('#url'), 'https://example.com/kept', 'the other parameters still count');

    // Two tabs (paired, so Settings has the name field too): one in What's in Lab, the other turns Lab off.
    await pairStored(page, { code: await ds.formatCode(ds.generateSecret()), name: 'Two-tab Daylight' });
    const other = await ctx.newPage();
    await other.goto(`${site.url}/`);
    await ready(other);
    await openLabView(page, 'whats');
    await openSettings(other);
    await other.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).click();
    await other.waitForSelector('#lab-rows', { state: 'hidden' });
    await page.waitForSelector('#view-whats-in-lab', { state: 'hidden' });
    assert.equal(await page.isVisible('#view-settings'), true, 'back to Settings');
    assert.equal(await page.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).isChecked(), false);
    assert.equal(await page.isVisible('#lab-rows'), false);
    assert.equal((await storageGet(page, 'settings')).lab, false);
    // On again here: the rows come back in both.
    await page.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).click();
    await page.waitForSelector('#lab-rows:not([hidden])');
    await other.waitForSelector('#lab-rows:not([hidden])');
    // Saving the device's name afterwards keeps the switch as it is now.
    await other.fill('#set-from', 'Renamed');
    await other.getByRole('button', { name: 'Save', exact: true }).click();
    await other.waitForFunction(() => document.querySelector('#name-saved').textContent !== '');
    assert.deepEqual(await storageGet(page, 'settings'), { lab: true, from: 'Renamed' });
  } finally { await ctx.close(); }
});

// --- F00.7 -----------------------------------------------------------------------------------------------------------------

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
  const { ctx, page } = await openWeb();
  try {
    for (const paired of [false, true]) {
      if (paired) await pairStored(page, { code: await ds.formatCode(ds.generateSecret()), name: 'Fresh Daylight' });
      await assertNoSetupText(page, paired ? 'sending' : 'pairing');
      await openSettings(page);
      await page.waitForFunction(() => document.querySelector('#server-sub').textContent !== '');
      await assertNoSetupText(page, 'settings');
      await openLabView(page, 'whats');
      await assertNoSetupText(page, 'What’s in Lab');
      await page.getByRole('button', { name: '‹ Back' }).click();
      await page.click('#close-settings');
    }
    // The server section is where setup happens: it may (and with no server does) show both.
    await openLabView(page, 'server');
    assert.match(await page.evaluate(() => document.body.innerText), SECRET_NAMES);
  } finally { await ctx.close(); }
});

// --- F00.3, F00.5, F00.6 -------------------------------------------------------------------------------------------------

test('a server feature’s tap shows exactly its sentence under it, announced and never greyed out; Copy Server code; OK or another tap closes it', { timeout: 120000 }, async () => {
  const { ctx, page } = await openWeb();
  try {
    // The server vectors' pairing, on the mock relay: the Server code is the link form with the vectors' seed.
    await pairStored(page, { code: VEC.pairingCode, name: 'Vector Daylight' });
    await openLabView(page, 'whats');
    assert.equal(await page.textContent('.lab-group-state'), 'Not set up');
    assert.equal(await page.textContent('.lab-group-h'), LAB_TEXT.serverHeading);
    assert.equal(await page.textContent('.lab-inbox'), LAB_TEXT.short['needs-inbox']);
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

    // Copy Server code (F00.5): the vectors' seed, in the link form for this relay, on the clipboard.
    await note.getByRole('button', { name: LAB_TEXT.buttons['needs-server'] }).click();
    await note.getByText(LAB_TEXT.setup.copied).waitFor();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
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
    await page.getByRole('button', { name: '‹ Back' }).click();
    await openLabView(page, 'server');
    assert.equal(await page.textContent('.lab-server-code'), expected);
    assert.equal(await page.textContent('.lab-server-state .lab-note-text'), S.STATE_MESSAGES['needs-server']);
    assert.equal(await page.textContent('.lab-server-where'), S.showFingerprint(VEC.derived.fingerprint));
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.locator('#view-server').getByRole('button', { name: LAB_TEXT.serverSection.copy, exact: true }).click();
    await page.locator('#view-server').getByText(LAB_TEXT.setup.copied).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
    await shot(page, 'server-needs-server');
  } finally { await ctx.close(); }
});

test('with a server: the typed Server address, then Ready, the rows’ own states, `later` and needs-key (F00.3)', { timeout: 120000 }, async () => {
  const { ctx, page } = await openWeb();
  try {
    const secret = ds.generateSecret();
    await pairStored(page, { code: await ds.formatCode(secret), name: 'Server Daylight' });
    await serveFor(secret, statusJson({ features: { ai: 'needs-key', email: 'needs-domain' }, lastSeen: new Date(Date.now() - 5 * MIN).toISOString(), usd: 0.227, limitUsd: 3 }));
    await openLabView(page, 'server');
    await page.getByLabel(LAB_TEXT.serverSection.serverAddress).fill(front.url);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lab-server-ready')?.textContent === 'Ready', null, { timeout: 15000 });
    assert.ok(front.preflights.includes('/v1/status'), 'the page’s call passed the server’s CORS preflight (DESIGN 10.2)');
    assert.equal(await page.textContent('.lab-server-where'), `localhost · ${S.showFingerprint((await S.deriveServerValues(await S.deriveServerSeed(secret))).fingerprint)}`);
    assert.equal(await page.textContent('.lab-server-inbox'), 'Lab Inbox last seen 5 min ago');
    assert.equal(await page.textContent('.lab-server-ai'), 'AI today: US$0.23 of US$3');
    assert.equal(await page.inputValue('#view-server input[type=url][placeholder="https://"]'), front.url);
    assert.equal(await page.textContent('.lab-server-rerun'), S.RERUN_HELP);
    await shot(page, 'server-ready');
    await page.getByRole('button', { name: '‹ Back' }).click();

    await openLabView(page, 'whats');
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
    await page.getByRole('button', { name: '‹ Back' }).click();
    await page.waitForFunction(() => document.querySelector('#server-sub').textContent === 'Optional · Ready');

    // Unpair forgets the typed Server address (2.6): another Daylight's pairing must not find this server through it.
    await page.click('#unpair');
    await page.click('#unpair');
    await page.waitForSelector('#view-pair:not([hidden])');
    assert.equal(await storageGet(page, 'server/manualUrl'), undefined);
  } finally { await ctx.close(); }
});

test('the server moved: the section asks “moved to {host}. Use it?”; Cancel asks again next time; Use it pins the new address. What’s in Lab shows the cached states at once (2.6, 1.5)', { timeout: 120000 }, async () => {
  const { ctx, page } = await openWeb();
  const OLD = 'https://daylight-aaaaaaaaaaaa.example.workers.dev';
  const MOVED = 'https://daylight-bbbbbbbbbbbb.example.workers.dev';
  try {
    const secret = ds.generateSecret();
    const values = await S.deriveServerValues(await S.deriveServerSeed(secret));
    await serveFor(secret);
    // The old Worker is gone (its address refuses connections); the new one answers from the stand-in.
    const sent = [];
    await ctx.route(`${OLD}/**`, (route) => route.abort('connectionrefused'));
    await ctx.route(`${MOVED}/**`, async (route) => {
      const u = new URL(route.request().url());
      sent.push(`${route.request().method()} ${u.pathname}`);
      const res = await route.fetch({ url: `${worker.url}${u.pathname}${u.search}` });
      await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
    });
    await pairStored(page, { code: await ds.formatCode(secret), name: 'Moved Daylight', extra: { 'server/pin': { origin: OLD, fingerprint: values.fingerprint } } });
    await new ds.RelayClient({ relay: relay.url }).publish(values.configTopic, await S.buildConfigFrame(values, { server: MOVED }));

    await openLabView(page, 'server');
    const ask = page.locator('.lab-server-moved');
    await ask.waitFor();
    assert.equal(await ask.locator('.lab-note-text').textContent(), L.serverMovedText(MOVED));
    assert.equal(await ask.getAttribute('role'), 'group');
    assert.equal(await page.locator('.lab-server-state .lab-note-body').getAttribute('data-state'), 'OFFLINE', 'still on the old pin');
    assert.ok((await page.textContent('.lab-server-where')).startsWith('daylight-aaaaaaaaaaaa.example.workers.dev · '));
    await shot(page, 'server-moved');
    // Cancel: nothing sent, nothing pinned; the focus goes on to Copy; asked again the next time the section opens.
    await ask.getByRole('button', { name: LAB_TEXT.serverSection.setupCancel, exact: true }).click();
    assert.equal(await ask.count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('lab-server-copy')), true);
    assert.deepEqual(sent, [], 'nothing went to the new address');
    assert.deepEqual(await storageGet(page, 'server/pin'), { origin: OLD, fingerprint: values.fingerprint });
    await page.getByRole('button', { name: '‹ Back' }).click();
    await openLabView(page, 'server');
    await ask.waitFor();

    // Use it: the new address is pinned, the section reads it (Ready) and the focus is on its heading.
    await ask.getByRole('button', { name: LAB_TEXT.serverSection.setupConfirm, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lab-server-ready')?.textContent === 'Ready', null, { timeout: 15000 });
    assert.deepEqual(await storageGet(page, 'server/pin'), { origin: MOVED, fingerprint: values.fingerprint });
    assert.ok((await page.textContent('.lab-server-where')).startsWith('daylight-bbbbbbbbbbbb.example.workers.dev · '));
    assert.equal(await ask.count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'server-h');
    assert.ok(sent.includes('GET /v1/status'));
    await page.getByRole('button', { name: '‹ Back' }).click();

    // What's in Lab opened within 10 minutes of that answer: its states at once, while the server is asked again.
    worker.state.statusDelayMs = 2500;
    await page.click('#open-whats-in-lab');
    await page.waitForSelector('#view-whats-in-lab:not([hidden]) .lab-group-state');
    assert.equal(await page.textContent('.lab-group-state'), 'Ready', 'the cached state, not “Checking your Daylight server…”');
    assert.equal(await page.evaluate(() => document.body.dataset.fresh ?? null), null, 'the live answer is still on its way');
    await page.waitForSelector('body[data-fresh="1"]', { timeout: 20000 });
    assert.equal(await page.textContent('.lab-group-state'), 'Ready');
  } finally {
    worker.state.statusDelayMs = 0;
    await ctx.close();
  }
});

test('a relay that never answers: “Checking your Daylight server…”, then OFFLINE at 5 s (F00.6)', { timeout: 120000 }, async () => {
  const hang = await hangingServer();
  const { ctx, page } = await openWeb();
  try {
    await pairStored(page, { code: await ds.formatCode(ds.generateSecret()), relay: hang.url, name: 'Silent Daylight' });
    await openSettings(page);
    await page.click('#open-whats-in-lab');
    await page.waitForSelector('#view-whats-in-lab:not([hidden]) .lab-group-state');
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
  } finally { await ctx.close(); await hang.close(); }
});

// --- F17 --------------------------------------------------------------------------------------------------------------------

test('What’s in Lab’s header follows the Daylight: nothing heard, a v1.1 Daylight’s ack, then a Lab Daylight’s hello (F17.2)', { timeout: 120000 }, async () => {
  const { ctx, page } = await openWeb();
  try {
    const secret = ds.generateSecret();
    const pairing = { secret, relay: relay.url };
    await pairStored(page, { code: await ds.formatCode(secret), name: 'Ledger Daylight' });
    await openLabView(page, 'whats');
    assert.equal(await page.textContent('.lab-inbox'), LAB_TEXT.short['needs-inbox']);
    await page.getByRole('button', { name: '‹ Back' }).click();
    await page.click('#close-settings');

    // A v1.1 Daylight acks: the row says Delivered ✓, the header still needs Lab, with the check-in time.
    await page.fill('#url', 'https://example.com/ledger');
    await page.click('#send-url');
    await page.waitForSelector('#history li[data-status="sent"]');
    await new ds.Receiver({ pairing, storage: new ds.MemoryStorage() }).pollOnce();
    await openLabView(page, 'whats');
    assert.equal(await page.textContent('.lab-inbox'), 'Needs Lab on your Daylight · checked in just now');
    assert.equal((await storageGet(page, 'outbox'))[0].status, 'delivered');
    // The ack check What's in Lab ran updated the history too (and announced it), before the send view is drawn again.
    assert.equal(await page.textContent('#history li .st'), 'Delivered ✓', 'the history follows the check');
    await page.waitForFunction(() => document.getElementById('announce').textContent.startsWith('Delivered ✓: '), null, { timeout: 2000 });
    await page.getByRole('button', { name: '‹ Back' }).click();
    await page.click('#close-settings');
    assert.equal(await page.textContent('#history li .st'), 'Delivered ✓', 'a v1.1 row');

    // A Lab Daylight says hello (with the state of a new item): the open What's in Lab follows the page's next check.
    await page.fill('#url', 'https://example.com/ledger-2');
    await page.click('#send-url');
    await page.waitForSelector('#history li[data-status="sent"]');
    await openLabView(page, 'whats');
    const storage = new ds.MemoryStorage();
    const labInbox = new L.LabInbox({
      storage, relay: new ds.RelayClient({ relay: relay.url }), keys: await ds.deriveKeys(secret),
      info: { lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'], live: false }, from: 'Daylight', autoFlushMs: null,
    });
    await new L.LabInboxSim({ receiver: new ds.Receiver({ pairing, storage }), labInbox }).pollOnce();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // the page checks when shown
    await page.waitForFunction(() => document.querySelector('.lab-inbox').textContent.startsWith('Your Daylight: Lab on'), null, { timeout: 15000 });
    assert.equal(await page.textContent('.lab-inbox'), 'Your Daylight: Lab on · checked in just now');
    await shot(page, 'whats-in-lab-inbox-lab');
  } finally { await ctx.close(); }
});

// --- 2.6: re-pairing and Set up with a link ----------------------------------------------------------------------------------

test('re-pairing with another Daylight while a server is known: the send view shows the locked text, the new Server code with Copy and the re-run help, until OK (2.6)', { timeout: 120000 }, async () => {
  const { ctx, page } = await openWeb();
  try {
    const secret = ds.generateSecret();
    await pairStored(page, { code: await ds.formatCode(secret), name: 'Old Daylight' });
    await serveFor(secret);
    await store(page, { 'server/manualUrl': front.url });
    const locks = worker.count('POST /v1/admin/lock');
    assert.equal(await page.isVisible('#repaired'), false, 'nothing before a re-pairing');
    await openSettings(page);
    await page.click('#repair');
    const next = ds.generateSecret();
    await page.fill('#code', await ds.formatCode(next));
    await page.click('#pair-btn');
    await page.waitForSelector('#view-confirm:not([hidden])');
    await page.click('#confirm-yes');
    await page.waitForSelector('#view-send:not([hidden])');
    await page.waitForSelector('#repaired:not([hidden])');
    assert.equal(worker.count('POST /v1/admin/lock'), locks + 1, 'the old server was locked first');
    assert.equal(await storageGet(page, 'server/manualUrl'), undefined, 'the old server’s typed address is gone');

    const panel = page.getByRole('region', { name: LAB_TEXT.serverRow });
    const code = await S.formatServerCode(await S.deriveServerSeed(next), { relay: relay.url });
    assert.equal(await page.textContent('#repaired .lab-repaired-text'), S.STATE_MESSAGES.locked);
    assert.equal(await page.textContent('#repaired .lab-server-h'), LAB_TEXT.serverSection.serverCode);
    assert.equal(await page.textContent('#repaired .lab-server-code'), code);
    assert.equal(await page.textContent('#repaired .lab-server-rerun'), S.RERUN_HELP);
    await page.waitForFunction((t) => document.querySelector('#announce').textContent === t, S.STATE_MESSAGES.locked);
    await shot(page, 'send-repaired');
    await panel.getByRole('button', { name: LAB_TEXT.serverSection.copy, exact: true }).click();
    await panel.getByText(LAB_TEXT.setup.copied).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);

    // It stays until OK: after a reload too; with Lab off it doesn't show (1.3).
    await page.reload();
    await ready(page);
    assert.equal(await page.isVisible('#repaired'), true);
    await openSettings(page);
    await page.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).click();
    await page.click('#close-settings');
    assert.equal(await page.isVisible('#repaired'), false);
    await openSettings(page);
    await page.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).click();
    await page.click('#close-settings');
    await page.waitForSelector('#repaired:not([hidden])');
    await page.getByRole('region', { name: LAB_TEXT.serverRow }).getByRole('button', { name: LAB_TEXT.noteButton, exact: true }).click();
    await page.waitForSelector('#repaired', { state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'url');
    await page.waitForFunction(async () => {
      const { openStorage } = await import('./web-storage.js');
      return (await (await openStorage()).storage.get('lab/repaired')) === undefined;
    });
    await page.reload();
    await ready(page);
    assert.equal(await page.isVisible('#repaired'), false, 'gone after OK');
  } finally { await ctx.close(); }
});

test('Set up with a link: first while not set up; a bad link says why; the address is confirmed before anything is sent; Use it sets the server up (2.6)', { timeout: 120000 }, async () => {
  const { ctx, page } = await openWeb();
  try {
    const secret = ds.generateSecret();
    await pairStored(page, { code: await ds.formatCode(secret), name: 'Setup Daylight' });
    // The deploy's workers.dev address answers from the stand-in.
    const sent = [];
    await ctx.route(`${SETUP_ORIGIN}/**`, async (route) => {
      const u = new URL(route.request().url());
      sent.push(`${route.request().method()} ${u.pathname}`);
      const res = await route.fetch({ url: `${worker.url}${u.pathname}${u.search}` });
      await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
    });
    await openLabView(page, 'server');
    const S2 = LAB_TEXT.serverSection;
    const order = await page.$$eval('#server > *', (els) => els.map((e) => e.classList[0]));
    assert.deepEqual(order.slice(0, 2), ['lab-server-state', 'lab-server-setup']);
    const field = page.getByLabel(S2.setupRow, { exact: true });
    assert.equal(await field.getAttribute('placeholder'), S2.setupPlaceholder);
    assert.equal(await page.textContent('.lab-server-setup-footer'), S2.setupFooter);

    // The Server code pasted by mistake: the module's message, nothing asked.
    const code = await page.textContent('.lab-server-code');
    await field.fill(code);
    await page.getByRole('button', { name: S2.setupButton, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lab-server-setup-said')?.textContent !== '');
    const said = await page.textContent('.lab-server-setup-said');
    await assert.rejects(S.parseSetupLink(code), (e) => e.reason === 'server-code' && e.message === said);
    assert.equal(await page.isVisible('.lab-server-setup-confirm'), false);

    // A setup link: its address to confirm; Cancel sends nothing.
    const setupSecret = Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3);
    const link = await S.formatSetupLink(SETUP_ORIGIN, setupSecret);
    await field.fill(link);
    await page.getByRole('button', { name: S2.setupButton, exact: true }).click();
    await page.waitForSelector('.lab-server-setup-confirm:not([hidden])');
    assert.equal(await page.textContent('.lab-server-setup-confirm-title'), S2.setupConfirmTitle);
    assert.equal(await page.textContent('.lab-server-setup-confirm .lab-note-text'), L.setupConfirmText(SETUP_ORIGIN));
    await shot(page, 'server-setup-confirm');
    await page.getByRole('button', { name: S2.setupCancel, exact: true }).click();
    assert.equal(await page.isVisible('.lab-server-setup-confirm'), false);
    assert.deepEqual(sent, [], 'nothing sent before Use it');

    // Use it: this pairing's Server code goes with the link's token; the section then reads the server: Ready.
    const values = await S.deriveServerValues(await S.deriveServerSeed(secret));
    worker.state.setup = { token: await S.deriveSetupToken(setupSecret), answer: { server: SETUP_ORIGIN, api: 1, fingerprint: values.fingerprint, delivery: 'lab' } };
    worker.state.token = values.authToken;
    worker.state.status = statusJson();
    await page.getByRole('button', { name: S2.setupButton, exact: true }).click();
    await page.getByRole('button', { name: S2.setupConfirm, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lab-server-ready')?.textContent === 'Ready', null, { timeout: 15000 });
    await page.waitForFunction((t) => document.querySelector('.lab-server-setup-said')?.textContent === t, S2.setupDone);
    assert.ok(sent.includes('POST /v1/setup'));
    assert.deepEqual(await storageGet(page, 'server/pin'), { origin: SETUP_ORIGIN, fingerprint: values.fingerprint });
    assert.equal(await page.textContent('.lab-server-where'), `daylight-0123456789ab.example.workers.dev · ${S.showFingerprint(values.fingerprint)}`);
    await shot(page, 'server-setup-done');
  } finally {
    delete worker.state.setup;
    await ctx.close();
  }
});
