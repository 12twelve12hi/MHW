// Lab in the extension's background (LAB-PLAN F00 and F17, extension parts; card X0) in node: the built lab.js and
// core.js with a fake browser API, the mock relay, a stand-in Daylight server and Daylights from daylight-lab.js.
//
//   node --test test/unit/lab.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { built } from '../helpers/built.mjs';
import { fakeBrowser } from '../helpers/fake-browser.mjs';
import { startFakeWorker, statusJson, hangingServer, deadAddress, goneWorker } from '../helpers/fake-worker.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const b = built('chrome');
const core = await b.load('core.js');
const labMod = await b.load('lab.js');
const ds = await b.load('daylight-share.js');
const L = await b.load('daylight-lab.js');
const S = await b.load('daylight-server.js');
const VEC = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', 'server', 'vectors', 'server-vectors.json'), 'utf8'));
const quiet = { warn() {}, log() {} };
const MIN = 60000;

/**
 * fetch as the extension sees it: the relay (its host permission) always; any other origin only once its host
 * permission is granted (no CORS for the extension, DESIGN 13.2); ntfy.sh is out of reach here. Every URL is logged.
 */
function extensionFetch(fb, relayUrl, log, flags) {
  return async (url, init) => {
    log.push(`${init?.method ?? 'GET'} ${url}`);
    const u = new URL(url);
    if (flags.relayDown && url.startsWith(relayUrl)) throw new TypeError('Failed to fetch');
    if (u.hostname === 'ntfy.sh') throw new TypeError('Failed to fetch');
    if (!url.startsWith(relayUrl) && !fb.granted.has(`${u.protocol}//${u.hostname}/*`)) throw new TypeError('Failed to fetch');
    // A workers.dev server (a setup link's) answers from the stand-in: flags.route = {origin: the stand-in's URL}.
    for (const [from, to] of Object.entries(flags.route ?? {})) if (url.startsWith(from)) return fetch(to + url.slice(from.length), init);
    return fetch(url, init);
  };
}

async function setup({ target = 'chrome', paired = true, relayUrl = null, now, gateDeadlineMs, status } = {}) {
  const relay = await startMockRelay();
  const worker = await startFakeWorker({ status });
  const fb = fakeBrowser({ os: target === 'safari' ? 'ios' : 'mac' });
  const log = [];
  const flags = { relayDown: false };
  const useRelay = relayUrl ?? relay.url;
  const app = core.createApp({ api: fb.api, target, fetch: extensionFetch(fb, useRelay, log, flags), log: quiet, now, gateDeadlineMs });
  fb.api.runtime.onMessage.addListener(app.handleMessage);
  const secret = ds.generateSecret();
  const link = await ds.pairingLink({ secret, relay: useRelay, name: 'Lab Daylight' });
  if (paired) await app.pair({ input: link });
  const msg = async (m) => {
    const r = await fb.api.runtime.sendMessage(m);
    assert.equal(r.ok, true, r.error);
    return r.result;
  };
  const settings = async () => (await fb.api.storage.local.get('settings')).settings;
  const storage = async (k) => (await fb.api.storage.local.get(k))[k];
  return {
    relay, worker, fb, app, log, flags, secret, link, msg, settings, storage, pairing: { secret, relay: useRelay },
    /** The worker as the typed Server address (2.6), with its host permission granted as the page asks for it. */
    async useWorker({ grant = true } = {}) {
      if (grant) fb.grant('http://localhost/*');
      const token = (await S.deriveServerValues(await S.deriveServerSeed(secret))).authToken;
      worker.state.token = token;
      if (grant) return msg({ type: 'labServerAddress', url: worker.url });
      await fb.api.storage.local.set({ 'server/manualUrl': worker.url });
      return null;
    },
    close: async () => { await relay.close(); await worker.close(); },
  };
}

// --- the switch (1.2) -----------------------------------------------------------------------------------------------

test('Lab is on by default: the first start writes settings.lab = true, a stored value stays, and pairing leaves it', async () => {
  const s = await setup({ paired: false });
  try {
    assert.equal(await s.settings(), undefined);
    assert.equal((await s.app.state()).lab, true, 'a missing key means on');
    assert.equal(await labMod.labOn(s.app.storage), true);
    await s.app.start();
    assert.deepEqual(await s.settings(), { lab: true }, 'the first start writes it');
    assert.deepEqual(await s.msg({ type: 'setLab', lab: false }), { lab: false });
    await s.app.start();
    assert.equal((await s.settings()).lab, false, 'a stored value stays');
    assert.equal(await labMod.labOn(s.app.storage), false);
    // Never in a pairing: pairing, renaming, Comfort and unpairing leave it as it is (and Lab leaves Comfort, F27.6).
    await s.msg({ type: 'setComfort', comfort: true });
    await s.app.pair({ input: s.link, from: 'Lab laptop' });
    await s.app.setDeviceName('Renamed');
    await s.app.unpair();
    assert.deepEqual(await s.settings(), { lab: false, comfort: true, from: 'Renamed' });
    await s.msg({ type: 'setLab', lab: true });
    assert.equal((await s.settings()).comfort, true, 'Comfort stays when Lab changes');
    // W1 has F01 and F04, so it shows the one-time note (1.2), once.
    assert.equal(labMod.LAB_NOTE_ENABLED, true);
    const st = await s.msg({ type: 'labState' });
    assert.equal(st.lab, true);
    assert.equal(st.noteEnabled, true);
    assert.deepEqual([(await s.msg({ type: 'labPopup' })).noteEnabled, (await s.msg({ type: 'labPopup' })).labNoteShown], [true, false]);
    await s.msg({ type: 'labSeen', key: 'labNoteShown' });
    assert.equal((await s.msg({ type: 'labPopup' })).labNoteShown, true);
    assert.equal((await s.settings()).labNoteShown, true);
  } finally { await s.close(); }
});

test('F00.1 upgrade: a Lab build’s first start over a non-Lab build’s state writes lab = true and keeps the pairing, history, name and Comfort', async () => {
  // The last non-Lab build (the Safari build while its wave is closed is one too: build.mjs, LAB-PLAN 6.2) used for a
  // while: paired, renamed, Comfort on, an item sent and delivered, one waiting. It writes no Lab switch.
  const before = built('chrome', { lab: false });
  const oldCore = await before.load('core.js');
  const relay = await startMockRelay();
  const fb = fakeBrowser({ os: 'mac' });
  try {
    const old = oldCore.createApp({ api: fb.api, target: 'chrome', fetch, log: quiet, labBuilt: false });
    await old.start();
    const secret = ds.generateSecret();
    await old.pair({ input: await ds.pairingLink({ secret, relay: relay.url, name: 'Upgraded Daylight' }), from: 'Old laptop' });
    await old.setComfort(true);
    await old.sendUrl('https://example.com/delivered', 'Delivered');
    await new ds.Receiver({ pairing: { secret, relay: relay.url }, storage: new ds.MemoryStorage() }).pollOnce();
    await old.tick();
    await old.sendUrl('https://example.com/waiting', 'Waiting');
    const was = await fb.api.storage.local.get(null);
    assert.deepEqual(was.settings, { from: 'Old laptop', comfort: true }, 'a non-Lab build writes no Lab switch');
    assert.deepEqual(was.outbox.map((r) => [r.title, r.status]), [['Waiting', 'sent'], ['Delivered', 'delivered']]);
    assert.ok(was.pairing);
    assert.deepEqual(Object.keys(was).filter((k) => k.startsWith('lab/') || k.startsWith('server/')), []);

    // The update: the Lab build's first start on the same storage.
    const app = core.createApp({ api: fb.api, target: 'chrome', fetch, log: quiet });
    fb.api.runtime.onMessage.addListener(app.handleMessage);
    await app.start();
    const now = await fb.api.storage.local.get(null);
    assert.deepEqual(now.settings, { from: 'Old laptop', comfort: true, lab: true }, 'lab = true written, the rest kept');
    assert.deepEqual(now.pairing, was.pairing, 'the pairing is kept');
    assert.deepEqual(now.outbox, was.outbox, 'the history and the outbox are kept');
    const st = await app.state();
    assert.deepEqual([st.paired, st.name, st.from, st.comfort, st.lab], [true, 'Upgraded Daylight', 'Old laptop', true, true]);
    assert.equal((await fb.api.runtime.sendMessage({ type: 'labState', refresh: false })).result.lab, true);
    // A later start leaves it, and the waiting item still goes.
    await app.start();
    assert.deepEqual((await fb.api.storage.local.get('settings')).settings, { from: 'Old laptop', comfort: true, lab: true });
    await new ds.Receiver({ pairing: { secret, relay: relay.url }, storage: new ds.MemoryStorage() }).pollOnce();
    await app.tick();
    assert.deepEqual((await fb.api.storage.local.get('outbox')).outbox.map((r) => [r.title, r.status]), [['Waiting', 'delivered'], ['Delivered', 'delivered']]);
  } finally { await relay.close(); }
});

test('Lab off: no discovery and no server call; the gate says how to turn it on; the screens have nothing to show', async () => {
  const s = await setup();
  try {
    await s.msg({ type: 'setLab', lab: false });
    s.log.length = 0;
    const g = await s.msg({ type: 'labGate', feature: 'F37' });
    assert.deepEqual({ ready: g.ready, state: g.state, message: g.message }, { ready: false, state: 'lab-off', message: 'Turn on Lab in Send to Daylight to use this.' });
    assert.deepEqual(await s.msg({ type: 'labOverview' }), { lab: false });
    assert.deepEqual(await s.msg({ type: 'labServer' }), { lab: false });
    const st = await s.msg({ type: 'labState' });
    assert.deepEqual([st.lab, st.serverState, st.serverSubtitle], [false, null, null]);
    assert.deepEqual(s.log, [], 'nothing went on the network');
  } finally { await s.close(); }
});

// --- What's in Lab (1.4) and the gate (1.5, 2.6) -------------------------------------------------------------------------

test('What’s in Lab: the W1 features, then Chrome’s four server features and Safari’s one, under the server’s short state', async () => {
  for (const target of ['chrome', 'safari']) {
    const s = await setup({ target, paired: false });
    try {
      let o = await s.msg({ type: 'labOverview' });
      const ids = target === 'chrome' ? ['F02', 'F37', 'F19', 'F36'] : ['F37'];
      // W1 (X1): the extension's features in LAB_TEXT.featureOrder; not paired, each says "Pair first" (1.5).
      const w1 = ['F01', 'F03', 'F04', 'F07', 'F10', 'F11', 'F16', 'F26', 'F33', 'F34'];
      assert.deepEqual(o.features.map((f) => f.id), w1);
      assert.deepEqual(o.features.map((f) => [f.name, f.sentence]), w1.map((id) => [L.LAB_TEXT.features[id].name, L.LAB_TEXT.features[id].sentence]));
      assert.ok(o.features.every((f) => f.short === 'Pair first'));
      // The Use switches (6.5 Q5) on the rows that change how sharing behaves, on by default; the rows with settings
      // of their own open them (3.4).
      assert.deepEqual(o.features.filter((f) => f.use).map((f) => [f.id, f.use.on]), [['F04', true], ['F10', true], ['F16', true], ['F33', true]]);
      assert.deepEqual(Object.fromEntries(o.features.filter((f) => f.view).map((f) => [f.id, f.view])), { F04: 'f04', F10: 'f10', F26: 'setup', F34: 'f34' });
      assert.deepEqual(o.server.features.map((f) => f.id), ids);
      assert.deepEqual(o.server.features.map((f) => [f.name, f.sentence]), ids.map((id) => [L.LAB_TEXT.features[id].name, L.LAB_TEXT.features[id].sentence]));
      assert.equal(o.header, 'Needs Lab on your Daylight', 'never heard from the Daylight (F17.2)');
      assert.deepEqual([o.server.state, o.server.short], ['needs-pairing', 'Pair first']);
      assert.ok(o.server.features.every((f) => f.short === null), 'a row repeats no short state of the heading');

      await s.app.pair({ input: s.link });
      o = await s.msg({ type: 'labOverview' });
      assert.deepEqual([o.server.state, o.server.short], ['needs-server', 'Not set up']);
      assert.ok(o.server.features.every((f) => f.short === null));
      // Paired: ready, but the timeline (F01) needs a Lab Inbox's hello with the `st` cap (F17).
      assert.deepEqual(o.features.map((f) => f.short), ['Needs Lab on your Daylight', ...Array(9).fill('Ready')]);
      // Opened again: the last answer at once, from storage (1.5), and nothing on the network.
      const asked = s.log.length;
      let cached = await s.msg({ type: 'labOverview', refresh: false });
      assert.deepEqual([cached.fresh, cached.cached, cached.server.state, cached.server.short], [true, true, 'needs-server', 'Not set up']);
      assert.ok(cached.server.features.every((f) => f.short === null));
      assert.equal(s.log.length, asked, 'nothing went on the network');
      // An answer older than 10 minutes isn't used: no short states until the server answers.
      await s.fb.api.storage.local.set({ 'lab/server': { state: 'needs-server', at: Date.now() - 11 * MIN } });
      cached = await s.msg({ type: 'labOverview', refresh: false });
      assert.deepEqual([cached.fresh, cached.cached, cached.server.state, cached.server.short], [false, false, null, null]);
      assert.ok(cached.server.features.every((f) => f.short === null));
      assert.equal(cached.features.length, 10, 'the features that don’t run on the server have their states all the same');
      assert.equal(cached.features[1].short, 'Ready');
    } finally { await s.close(); }
  }
});

test('What’s in Lab opening reads the ack topic and asks the server at the same time, each within the 5 s', async () => {
  const hang = await hangingServer();
  const s = await setup({ relayUrl: hang.url, gateDeadlineMs: 400 });
  try {
    const t0 = Date.now();
    const o = await s.msg({ type: 'labOverview' });
    const took = Date.now() - t0;
    assert.deepEqual([o.fresh, o.cached, o.server.state, o.server.short], [true, false, 'OFFLINE', 'Can’t reach the server']);
    assert.ok(took >= 380 && took < 750, `one deadline, not two after each other (${took} ms)`);
  } finally { await s.close(); await hang.close(); }
});

test('the gate: needs-pairing, then needs-server with the Server code to copy, within 5 s (F00.3, F00.6)', async () => {
  const s = await setup({ paired: false });
  try {
    let g = await s.msg({ type: 'labGate', feature: 'F37' });
    assert.deepEqual([g.state, g.short, g.button], ['needs-pairing', 'Pair first', null]);
    assert.equal(g.message, L.LAB_TEXT.needs['needs-pairing']);

    await s.app.pair({ input: s.link });
    const t0 = Date.now();
    g = await s.msg({ type: 'labGate', feature: 'F37' });
    assert.ok(Date.now() - t0 < 5000);
    assert.deepEqual([g.ready, g.state, g.short, g.button], [false, 'needs-server', 'Needs your Daylight server', 'Copy Server code']);
    assert.equal(g.message, L.LAB_TEXT.needs['needs-server'], 'LAB_TEXT’s sentence under a control, not the long one');
    const seed = await S.deriveServerSeed(s.secret);
    assert.equal(g.serverCode, await S.formatServerCode(seed, { relay: s.relay.url }));
    const { configTopic } = await S.deriveServerValues(seed);
    assert.ok(s.log.some((l) => l.includes(configTopic)), 'discovery read the config topic');
    // Every server feature and key gates the same way; a Lab feature this build doesn't have is not a server one.
    for (const f of ['F02', 'F19', 'F36', 'ai', 'files']) assert.equal((await s.msg({ type: 'labGate', feature: f })).state, 'needs-server', f);
  } finally { await s.close(); }
});

test('the gate offline: a refused connection is OFFLINE at once, a relay that never answers is OFFLINE at the deadline', async () => {
  const dead = await deadAddress();
  let s = await setup({ relayUrl: dead });
  try {
    const g = await s.msg({ type: 'labGate', feature: 'F37' });
    assert.deepEqual([g.state, g.short], ['OFFLINE', 'Can’t reach the server']);
    assert.equal(g.message, S.STATE_MESSAGES.OFFLINE);
  } finally { await s.close(); }

  const hang = await hangingServer();
  s = await setup({ relayUrl: hang.url, gateDeadlineMs: 400 });
  try {
    const t0 = Date.now();
    const g = await s.msg({ type: 'labGate', feature: 'F37' });
    const took = Date.now() - t0;
    assert.equal(g.state, 'OFFLINE');
    assert.equal(g.message, S.STATE_MESSAGES.OFFLINE);
    assert.ok(took >= 380 && took < 3000, `answered at the deadline (${took} ms)`);
    assert.equal(L.GATE_DEADLINE_MS, 5000, 'the extension uses the plan’s 5 s');
  } finally { await s.close(); await hang.close(); }
});

test('the gate with a server: site access first, then the server’s states; ready but not built is `later` (F00.3)', async () => {
  const s = await setup({ status: statusJson({ features: { ai: 'needs-key', email: 'needs-domain' }, lastSeen: new Date(Date.now() - 5 * MIN).toISOString(), usd: 0.227, limitUsd: 3 }) });
  try {
    // An earlier pairing's pinned server is no site to ask for: discovery finds no server for this pairing.
    await s.fb.api.storage.local.set({ 'server/pin': { origin: 'https://daylight-0123456789ab.example.workers.dev', fingerprint: '0123abcd' } });
    let g = await s.msg({ type: 'labGate', feature: 'F02' });
    assert.deepEqual([g.state, g.message], ['pairing-mismatch', S.STATE_MESSAGES['pairing-mismatch']]);
    await s.fb.api.storage.local.remove('server/pin');
    await s.useWorker({ grant: false });
    g = await s.msg({ type: 'labGate', feature: 'F02' });
    assert.deepEqual([g.state, g.short, g.button, g.origins], ['needs-site-access', 'Needs access to this site', 'Allow', ['http://localhost/*']]);
    assert.equal(g.message, L.LAB_TEXT.needs['needs-site-access']);
    assert.equal(s.worker.count('GET /v1/status'), 0, 'nothing reached the server without its host permission');

    s.fb.grant('http://localhost/*');
    g = await s.msg({ type: 'labGate', feature: 'F02' });
    assert.deepEqual([g.ready, g.state, g.short], [false, 'later', 'In a later update']);
    assert.equal(g.message, 'Your Daylight server is ready. Files over 9 MB comes to this app in a later Lab update.');
    g = await s.msg({ type: 'labGate', feature: 'F37' });
    assert.deepEqual([g.state, g.short, g.message], ['needs-key', 'Needs a Claude key', S.STATE_MESSAGES['needs-key']]);
    g = await s.msg({ type: 'labGate', feature: 'F19' });
    assert.deepEqual([g.state, g.message], ['needs-domain', S.STATE_MESSAGES['needs-domain']]);
    // A status 10 minutes old or less answers at once: no new request.
    const asked = s.worker.count('GET /v1/status');
    assert.equal((await s.msg({ type: 'labGate', feature: 'F36' })).state, 'later');
    assert.equal(s.worker.count('GET /v1/status'), asked);

    const o = await s.msg({ type: 'labOverview' });
    assert.deepEqual([o.server.state, o.server.short], ['ready', 'Ready']);
    assert.deepEqual(o.server.features.map((f) => [f.id, f.short]), [['F02', 'In a later update'], ['F37', 'Needs a Claude key'], ['F19', 'Needs an email domain'], ['F36', 'In a later update']]);
    // Opened again within 10 minutes: the same states at once, from the cached status (1.5), with nothing asked.
    const before = [s.log.length, s.worker.count('GET /v1/status')];
    const cached = await s.msg({ type: 'labOverview', refresh: false });
    assert.deepEqual([cached.fresh, cached.cached, cached.server.state, cached.server.short], [true, true, 'ready', 'Ready']);
    assert.deepEqual(cached.server.features.map((f) => [f.id, f.short]), o.server.features.map((f) => [f.id, f.short]));
    assert.deepEqual([s.log.length, s.worker.count('GET /v1/status')], before);
    const st = await s.msg({ type: 'labState' });
    assert.deepEqual([st.serverState, st.serverSubtitle], ['ready', 'Optional · Ready']);
  } finally { await s.close(); }
});

// --- the Daylight server section (2.6) ----------------------------------------------------------------------------------

test('the server section: the vector pairing’s Server code and fingerprint (F00.5), then a ready server’s lines', async () => {
  const s = await setup({ paired: false, status: statusJson({ lastSeen: new Date(Date.now() - 5 * MIN).toISOString(), usd: 0.227, limitUsd: 3 }) });
  try {
    let v = await s.msg({ type: 'labServer' });
    assert.deepEqual([v.paired, v.state, v.message], [false, 'needs-pairing', L.LAB_TEXT.needs['needs-pairing']]);
    assert.equal(v.rerun, S.RERUN_HELP);

    // The protocol vectors' pairing on ntfy.sh (out of reach here): the Server code is derived locally all the same.
    await s.app.pair({ input: VEC.pairingCode });
    v = await s.msg({ type: 'labServer' });
    assert.equal(v.serverCode, VEC.derived.serverCode);
    assert.equal(v.fingerprint, S.showFingerprint(VEC.derived.fingerprint));
    assert.deepEqual([v.state, v.message], ['OFFLINE', S.STATE_MESSAGES.OFFLINE]);
    assert.deepEqual([v.host, v.labInbox, v.aiToday, v.manualUrl, v.button], ['', null, null, '', null]);

    // A pairing on another relay shows the link form, with the same seed.
    await s.app.pair({ input: s.link, confirm: true });
    v = await s.msg({ type: 'labServer' });
    const link = await S.formatServerCode(await S.deriveServerSeed(s.secret), { relay: s.relay.url });
    assert.equal(v.serverCode, link);
    assert.match(v.serverCode, /^daylightserver:\/\/setup\?c=/);
    assert.deepEqual([v.state, v.message], ['needs-server', S.STATE_MESSAGES['needs-server']], 'the long text, with the secret names');

    const bad = await s.msg({ type: 'labServerAddress', url: 'ftp://nope' });
    assert.equal(bad.error, 'That isn’t a server address (https://…).');
    assert.equal((await s.useWorker()).manualUrl, s.worker.url);
    v = await s.msg({ type: 'labServer' });
    assert.deepEqual([v.state, v.message, v.host, v.manualUrl], ['ready', 'Ready', s.worker.url, s.worker.url]);
    assert.equal(v.delivery, 'lab');
    assert.equal(v.labInbox, 'Lab Inbox last seen 5 min ago');
    assert.equal(v.aiToday, 'AI today: US$0.23 of US$3');
    assert.equal(v.v1Notice, null);
    assert.deepEqual(await s.msg({ type: 'labServerAddress', url: '' }), { manualUrl: '' });
    assert.equal(await s.storage('server/manualUrl'), undefined);
  } finally { await s.close(); }
});

test('the server section with a v1-delivery server found on the relay: its host and the v1 notice', async () => {
  const s = await setup();
  const origin = 'https://daylight-0123456789ab.example.workers.dev';
  try {
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    const frame = await S.buildConfigFrame(values, { server: origin, delivery: 'v1' });
    await new ds.RelayClient({ relay: s.relay.url }).publish(values.configTopic, frame);
    // Without its host permission: needs-site-access, with the origin to ask for.
    let v = await s.msg({ type: 'labServer' });
    assert.deepEqual([v.state, v.button, v.origins], ['needs-site-access', 'Allow', [`${origin}/*`]]);
    assert.equal(v.host, origin);
    assert.equal(L.hostLineText(v.host, v.fingerprint), `daylight-0123456789ab.example.workers.dev · ${v.fingerprint}`);
    assert.equal(v.delivery, 'v1');
    assert.equal(v.v1Notice, S.noticeText('v1'));
    assert.deepEqual(await s.storage('server/pin'), { origin, fingerprint: values.fingerprint }, 'the module pinned it');
  } finally { await s.close(); }
});

test('Set up with a link (2.6, DESIGN 3.5): read here first, sent only on Use it, then the server is pinned and ready', async () => {
  const s = await setup();
  const origin = 'https://daylight-0123456789ab.example.workers.dev';
  try {
    let v = await s.msg({ type: 'labServer' });
    assert.deepEqual([v.state, v.setupFirst], ['needs-server', true], 'its message says to paste a setup link');
    // A link that isn't one: the module's message, and nothing is sent.
    let r = await s.msg({ type: 'labSetupCheck', link: 'not a link' });
    await assert.rejects(S.parseSetupLink('not a link'), (e) => e.message === r.error);
    r = await s.msg({ type: 'labSetupCheck', link: s.link });
    await assert.rejects(S.parseSetupLink(s.link), (e) => e.message === r.error && e.reason === 'pairing-code');
    r = await s.msg({ type: 'labSetupCheck', link: 'https://daylight-0123456789ab.evil.example/setup#SETUP-AAAA' });
    await assert.rejects(S.parseSetupLink('https://daylight-0123456789ab.evil.example/setup#SETUP-AAAA'), (e) => e.message === r.error);
    const secret = Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3);
    const link = await S.formatSetupLink(origin, secret);
    r = await s.msg({ type: 'labSetupCheck', link });
    assert.deepEqual(r, { server: origin, confirm: L.setupConfirmText(origin), origins: [`${origin}/*`] });
    assert.equal(r.confirm, 'daylight-0123456789ab.example.workers.dev will get this pairing’s Server code. Continue only if this address is on your own Cloudflare account.');
    assert.equal(s.worker.count('POST /v1/setup'), 0, 'nothing sent before Use it');

    // Use it without the server's site: needs-site-access, nothing sent.
    r = await s.msg({ type: 'labSetup', link });
    assert.deepEqual(r, { error: L.LAB_TEXT.needs['needs-site-access'], state: 'needs-site-access', origins: [`${origin}/*`] });
    assert.equal(s.worker.count('POST /v1/setup'), 0);

    // With it: a link the server doesn't take is SETUP_INVALID, in the module's words.
    s.fb.grant(`${origin}/*`);
    s.flags.route = { [origin]: s.worker.url };
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    s.worker.state.setup = { token: 'another link', answer: {} };
    r = await s.msg({ type: 'labSetup', link });
    assert.deepEqual(r, { error: S.errorMessage('SETUP_INVALID') });

    // The current link: this pairing's Server code goes with its token, the server is pinned, then Ready.
    s.worker.state.setup = { token: await S.deriveSetupToken(secret), answer: { server: origin, api: 1, fingerprint: values.fingerprint, delivery: 'lab' } };
    s.worker.state.token = values.authToken;
    r = await s.msg({ type: 'labSetup', link });
    assert.deepEqual(r, { done: L.LAB_TEXT.serverSection.setupDone });
    assert.deepEqual(await s.storage('server/pin'), { origin, fingerprint: values.fingerprint });
    v = await s.msg({ type: 'labServer' });
    assert.deepEqual([v.state, v.host, v.setupFirst], ['ready', origin, false]);
  } finally { await s.close(); }
});

test('the server moved (2.6): the section asks “moved to {host}. Use it?”, also while the old address fails; Use it pins the new one', async () => {
  const s = await setup({ status: statusJson() });
  const dead = await deadAddress();
  const old = 'https://daylight-aaaaaaaaaaaa.example.workers.dev';
  const moved = 'https://daylight-bbbbbbbbbbbb.example.workers.dev';
  try {
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    s.worker.state.token = values.authToken;
    // This pairing's server was pinned at `old`, whose Worker the deploy deleted when it made a new setup link
    // (server DESIGN 3.5); the new Worker announces itself at `moved`.
    s.fb.grant(`${old}/*`);
    s.flags.route = { [old]: dead, [moved]: s.worker.url };
    await s.fb.api.storage.local.set({ 'server/pin': { origin: old, fingerprint: values.fingerprint } });
    await new ds.RelayClient({ relay: s.relay.url }).publish(values.configTopic, await S.buildConfigFrame(values, { server: moved }));
    let v = await s.msg({ type: 'labServer' });
    assert.deepEqual([v.state, v.host], ['OFFLINE', old], 'still on the old pin');
    assert.equal(v.moved, 'Your Daylight server moved to daylight-bbbbbbbbbbbb.example.workers.dev. Use it?');
    assert.equal(v.moved, L.serverMovedText(moved));
    assert.deepEqual(v.movedOrigins, [`${moved}/*`]);
    assert.deepEqual(await s.storage('server/pendingMove'), { origin: moved, fingerprint: values.fingerprint });
    assert.equal(s.worker.count('GET /v1/status'), 0, 'nothing went to the new address before Use it');
    // Not answered (Cancel changes nothing): asked again the next time.
    assert.equal((await s.msg({ type: 'labServer' })).moved, L.serverMovedText(moved));

    // Use it: the page asked for the new site, then the module pins the new origin, and the server is ready there.
    s.fb.grant(`${moved}/*`);
    assert.deepEqual(await s.msg({ type: 'labConfirmMove' }), { moved: true });
    assert.deepEqual(await s.storage('server/pin'), { origin: moved, fingerprint: values.fingerprint });
    assert.equal(await s.storage('server/pendingMove'), undefined);
    v = await s.msg({ type: 'labServer' });
    assert.deepEqual([v.state, v.host, v.moved, v.movedOrigins], ['ready', moved, null, null]);
    assert.deepEqual(await s.msg({ type: 'labConfirmMove' }), { moved: false }, 'nothing left to confirm');
    // A typed Server address wins over discovery: no question then.
    await s.fb.api.storage.local.set({ 'server/pin': { origin: old, fingerprint: values.fingerprint } });
    await s.useWorker();
    v = await s.msg({ type: 'labServer' });
    assert.deepEqual([v.state, v.moved], ['ready', null]);
  } finally { await s.close(); }
});

test('the server moved and the old address never answers: the question still shows when the 5 s run out', async () => {
  const hang = await hangingServer();
  const s = await setup({ gateDeadlineMs: 400 });
  const old = 'https://daylight-aaaaaaaaaaaa.example.workers.dev';
  const moved = 'https://daylight-bbbbbbbbbbbb.example.workers.dev';
  try {
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    s.fb.grant(`${old}/*`);
    s.flags.route = { [old]: hang.url };
    await s.fb.api.storage.local.set({ 'server/pin': { origin: old, fingerprint: values.fingerprint } });
    await new ds.RelayClient({ relay: s.relay.url }).publish(values.configTopic, await S.buildConfigFrame(values, { server: moved }));
    const v = await s.msg({ type: 'labServer' });
    assert.deepEqual([v.state, v.moved], ['OFFLINE', L.serverMovedText(moved)]);
    // Once the config names the pinned origin again, an old pendingMove asks nothing.
    await s.fb.api.storage.local.set({ 'server/config': { ...(await s.storage('server/config')), server: old } });
    assert.equal((await s.msg({ type: 'labServer' })).moved, null);
  } finally { await s.close(); await hang.close(); }
});

test('the server moved while a fresh config is cached: opening What’s in Lab or the section reads the config topic now and asks (DESIGN 4.3, 2.6)', async () => {
  // The config read on the relay is kept for 6 hours (CONFIG_REFRESH_MS); a deploy with "New setup link" moves the
  // server well within them. Lab settings opening reads the config topic whatever the cached config's age.
  const old = 'https://daylight-aaaaaaaaaaaa.example.workers.dev';
  const moved = 'https://daylight-bbbbbbbbbbbb.example.workers.dev';
  for (const was of ['deleted', 'refused']) {
    const gone = await goneWorker();
    const dead = await deadAddress();
    const s = await setup({ status: statusJson() });
    try {
      const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
      const relay = new ds.RelayClient({ relay: s.relay.url });
      const polls = () => s.log.filter((l) => l.includes(`/${values.configTopic}/json`)).length;
      s.worker.state.token = values.authToken;
      // Found at `old` on the relay and ready there: the config is cached, fresh, and pinned.
      s.fb.grant(`${old}/*`);
      s.flags.route = { [old]: s.worker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: old, sent: new Date(Date.now() - 2 * MIN).toISOString() }));
      let v = await s.msg({ type: 'labServer' });
      assert.deepEqual([v.state, v.host, v.moved], ['ready', old, null]);
      assert.equal((await s.storage('server/config')).server, old);
      assert.ok(Date.now() - (await s.storage('server/configAt')) < S.CONFIG_REFRESH_MS, 'the cached config is fresh');

      // The deploy deleted the old Worker (workers.dev answers 404 with its own page), or its address refuses
      // connections; the new Worker announces itself at `moved`.
      s.flags.route = { [old]: was === 'deleted' ? gone.url : dead, [moved]: s.worker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: moved, sent: new Date(Date.now() - MIN).toISOString() }));
      const statusAsked = s.worker.count('GET /v1/status');
      let p = polls();
      const o = await s.msg({ type: 'labOverview' });
      assert.equal(polls(), p + 1, `${was}: What’s in Lab read the config topic`);
      assert.deepEqual(await s.storage('server/pendingMove'), { origin: moved, fingerprint: values.fingerprint });
      assert.equal(o.server.state, was === 'deleted' ? 'error' : 'ready');

      p = polls();
      v = await s.msg({ type: 'labServer' });
      assert.equal(polls(), p + 1, `${was}: the section read the config topic`);
      assert.equal(v.moved, L.serverMovedText(moved), `${was}: the section asks at once`);
      assert.deepEqual(v.movedOrigins, [`${moved}/*`]);
      assert.equal(v.host, old, 'still on the old pin until Use it');
      if (was === 'deleted') assert.deepEqual([v.state, v.message], ['error', S.errorMessage('SERVER_ERROR')]);
      else assert.equal(v.state, 'ready', 'a refused connection keeps the cached status (the module’s OFFLINE fallback)');
      assert.equal(s.worker.count('GET /v1/status'), statusAsked, 'nothing went to the new address before Use it');

      s.fb.grant(`${moved}/*`);
      assert.deepEqual(await s.msg({ type: 'labConfirmMove' }), { moved: true });
      v = await s.msg({ type: 'labServer' });
      assert.deepEqual([v.state, v.host, v.moved], ['ready', moved, null]);
    } finally { await s.close(); await gone.close(); }
  }
});

test('a server feature tapped while a fresh config is cached: a failing server sends discovery back to the config topic (2.6)', async () => {
  const old = 'https://daylight-aaaaaaaaaaaa.example.workers.dev';
  const moved = 'https://daylight-bbbbbbbbbbbb.example.workers.dev';
  for (const answer of ['SERVER_ERROR', 'BAD_AUTH']) {
    let t = Date.now();
    const gone = await goneWorker();
    // The old Worker still running with another pairing's Server code answers 401 BAD_AUTH.
    const other = await startFakeWorker({ token: 'another pairing’s token' });
    const s = await setup({ status: statusJson(), now: () => t });
    try {
      const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
      const relay = new ds.RelayClient({ relay: s.relay.url });
      const polls = () => s.log.filter((l) => l.includes(`/${values.configTopic}/json`)).length;
      s.worker.state.token = values.authToken;
      s.fb.grant(`${old}/*`);
      s.flags.route = { [old]: s.worker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: old, sent: new Date(Date.now() - 2 * MIN).toISOString() }));
      assert.equal((await s.msg({ type: 'labServer' })).state, 'ready');

      s.flags.route = { [old]: answer === 'SERVER_ERROR' ? gone.url : other.url, [moved]: s.worker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: moved, sent: new Date(Date.now() - MIN).toISOString() }));
      t += 11 * MIN; // the status (10 minutes) is stale, the config (6 hours) fresh: the tap reads no config first
      let p = polls();
      let g = await s.msg({ type: 'labGate', feature: 'F37' });
      assert.deepEqual([g.ready, g.state, g.message], [false, 'error', S.errorMessage(answer)]);
      assert.equal(polls(), p + 1, `${answer}: the config topic was read once, after the server failed`);
      assert.deepEqual(await s.storage('server/pendingMove'), { origin: moved, fingerprint: values.fingerprint });

      // Tapped again: a server that keeps answering 401 costs no more relay polls (server/badAuthAt, the module's
      // episode); a server that is gone is looked for again.
      t += MIN;
      p = polls();
      g = await s.msg({ type: 'labGate', feature: 'F37' });
      assert.equal(g.state, 'error');
      assert.equal(polls(), p + (answer === 'BAD_AUTH' ? 0 : 1));

      const v = await s.msg({ type: 'labServer' });
      assert.deepEqual([v.state, v.moved], ['error', L.serverMovedText(moved)]);
      assert.equal(v.setupFirst, answer === 'BAD_AUTH', 'after a BAD_AUTH, Set up with a link comes first');
    } finally { await s.close(); await gone.close(); await other.close(); }
  }
});

// --- F17: the ledger -----------------------------------------------------------------------------------------------------

/** A Lab Daylight (LabInboxSim). Its clock runs a minute ahead at each poll, past the 30 s between Lab frames. */
async function labDaylight(pairing, { app = 'android/1.5.0', caps = ['st', 'tap', 'reader-link'], lab = 1 } = {}) {
  let skew = 0;
  const now = () => Date.now() + skew;
  const storage = new ds.MemoryStorage();
  const receiver = new ds.Receiver({ pairing, storage, from: 'Daylight' });
  const labInbox = new L.LabInbox({
    storage, relay: new ds.RelayClient({ relay: pairing.relay }), keys: await ds.deriveKeys(pairing.secret),
    info: () => ({ lab, app, caps, live: false }), from: 'Daylight', now, autoFlushMs: null,
  });
  const sim = new L.LabInboxSim({ receiver, labInbox });
  return { receiver, labInbox, pollOnce: () => { skew += MIN; return sim.pollOnce(); } };
}

test('F17: every ack-topic frame feeds the ledger, Lab on or off; What’s in Lab says what the Daylight said', async () => {
  const s = await setup();
  try {
    // A v1.1 Daylight: rows say Delivered ✓, the header says Lab isn't confirmed, with the check-in time (F17.2).
    const { row } = await s.app.sendUrl('https://example.com/one', 'One');
    await new ds.Receiver({ pairing: s.pairing, storage: new ds.MemoryStorage() }).pollOnce();
    await s.app.tick();
    let rows = await s.storage('outbox');
    assert.equal(rows[0].status, 'delivered');
    assert.equal(ds.describeRow(rows[0], Date.now()).label, 'Delivered ✓');
    let o = await s.msg({ type: 'labOverview' });
    assert.equal(o.header, 'Needs Lab on your Daylight · checked in just now');

    // A Lab Daylight says hello and reports states: the header turns, and the ledger has the state.
    const day = await labDaylight(s.pairing);
    const two = (await s.app.sendUrl('https://example.com/two', 'Two')).row;
    const polled = await day.pollOnce();
    assert.ok(polled.lab, 'the Daylight published a Lab frame');
    o = await s.msg({ type: 'labOverview' });
    assert.equal(o.header, 'Your Daylight: Lab on · checked in just now', 'opening What’s in Lab reads the ack topic');
    assert.equal((await s.app.lab.ledger.state(two.id))?.s, 'reader');
    assert.deepEqual(await s.app.lab.ledger.caps(), ['reader-link', 'st', 'tap']);

    // Lab off: the ledger keeps learning (1.3), so turning Lab on shows the right state at once.
    await s.msg({ type: 'setLab', lab: false });
    const three = (await s.app.sendUrl('https://example.com/three', 'Three')).row;
    await day.pollOnce();
    await s.app.tick();
    assert.equal((await s.app.lab.ledger.state(three.id))?.s, 'reader');

    // Pruned to the outbox's ids after a tick.
    await s.app.remove(two.id);
    await s.app.tick();
    assert.equal(await s.app.lab.ledger.state(two.id), null);
    assert.equal((await s.app.lab.ledger.state(three.id))?.s, 'reader');
    assert.ok(row.id);

    // Another Daylight: every lab/* key goes with the outbox (applyPairingChange), the switch stays.
    await s.msg({ type: 'setLab', lab: true });
    await s.msg({ type: 'labState' });
    assert.ok(await s.storage('lab/server'), 'the server row’s last state is kept under lab/');
    await s.app.pair({ input: await ds.pairingLink({ secret: ds.generateSecret(), relay: s.relay.url }), confirm: true });
    const left = Object.keys(await s.fb.api.storage.local.get(null)).filter((k) => k.startsWith('lab/'));
    assert.deepEqual(left, []);
    assert.equal((await s.settings()).lab, true);
    o = await s.msg({ type: 'labOverview', refresh: false });
    assert.equal(o.header, 'Needs Lab on your Daylight');
    assert.deepEqual((await s.storage('outbox')) ?? [], [], 'the outbox went too');
  } finally { await s.close(); }
});

// --- F00.4 and re-pairing ------------------------------------------------------------------------------------------------

test('F00.4: an item queued offline goes once back online with Lab off; pairing, history and the server pin stay', async () => {
  let clock = Date.now();
  const s = await setup({ now: () => clock });
  try {
    await s.fb.api.storage.local.set({ 'server/pin': { origin: 'https://daylight-0123456789ab.example.workers.dev', fingerprint: '0123abcd' } });
    const old = (await s.app.sendUrl('https://example.com/kept', 'Kept')).row;
    s.flags.relayDown = true;
    const { row } = await s.app.sendUrl('https://example.com/offline', 'Offline');
    assert.equal(row.status, 'failed');
    assert.equal(row.errorCode, 'network');
    await s.msg({ type: 'setLab', lab: false });
    s.flags.relayDown = false;
    clock += 60 * MIN;
    await s.app.tick();
    const rows = await s.storage('outbox');
    assert.equal(rows.find((r) => r.id === row.id).status, 'sent', 'sent once back online');
    assert.ok(rows.some((r) => r.id === old.id), 'history kept');
    assert.equal((await s.app.getPairing()).secret.join(), s.secret.join(), 'pairing kept');
    assert.deepEqual(await s.storage('server/pin'), { origin: 'https://daylight-0123456789ab.example.workers.dev', fingerprint: '0123abcd' });
    const { items } = await new ds.Receiver({ pairing: s.pairing, storage: new ds.MemoryStorage() }).pollOnce();
    assert.ok(items.some((i) => i.header.id === row.id));
  } finally { await s.close(); }
});

test('re-pairing with another Daylight locks a server that knows the old pairing first, Lab on or off (2.6)', async () => {
  const s = await setup();
  try {
    await s.useWorker();
    await s.msg({ type: 'setLab', lab: false });
    // The same Daylight again (a rename): no lock, no follow-up.
    const same = await s.app.pair({ input: s.link, from: 'Renamed' });
    assert.equal(same.serverLocked, undefined);
    assert.equal(s.worker.count('POST /v1/admin/lock'), 0);
    const r = await s.app.pair({ input: await ds.pairingLink({ secret: ds.generateSecret(), relay: s.relay.url }) });
    assert.ok(r.needsConfirm, 'another Daylight asks first');
    assert.equal(s.worker.count('POST /v1/admin/lock'), 0, 'nothing before the answer');
    const next = ds.generateSecret();
    const done = await s.app.pair({ input: await ds.pairingLink({ secret: next, relay: s.relay.url }), confirm: true });
    assert.equal(s.worker.count('POST /v1/admin/lock'), 1, 'locked with the old pairing’s token');
    assert.equal(done.serverLocked, true);
    // The typed address was the old server's: forgotten, so discovery can find the new one (DESIGN 12.7).
    assert.equal(await s.storage('server/manualUrl'), undefined);
    // Lab off: nothing to show (1.3); it waits for Lab.
    assert.deepEqual(await s.msg({ type: 'labRepaired' }), { lab: false, repaired: null });
    assert.ok(await s.storage('lab/repaired'));

    // Lab on: the locked text with the new pairing's Server code and the re-run help (DESIGN 12.7).
    await s.msg({ type: 'setLab', lab: true });
    const { repaired } = await s.msg({ type: 'labRepaired' });
    assert.deepEqual(repaired, {
      state: 'locked', message: S.STATE_MESSAGES.locked,
      serverCode: await S.formatServerCode(await S.deriveServerSeed(next), { relay: s.relay.url }), rerun: S.RERUN_HELP,
    });
    // ...until OK.
    assert.deepEqual(await s.msg({ type: 'labRepairSeen' }), {});
    assert.deepEqual(await s.msg({ type: 'labRepaired' }), { lab: true, repaired: null });
  } finally { await s.close(); }
});

test('the re-pairing follow-up shows when the lock didn’t reach the server too, and goes once the new server answers', async () => {
  const s = await setup();
  try {
    // A pinned server for this pairing that can't be reached: the lock fails, the re-pair goes ahead (DESIGN 3.4).
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    await s.fb.api.storage.local.set({ 'server/pin': { origin: await deadAddress(), fingerprint: values.fingerprint } });
    const next = ds.generateSecret();
    const done = await s.app.pair({ input: await ds.pairingLink({ secret: next, relay: s.relay.url }), confirm: true });
    assert.equal(done.serverLocked, true);
    const { repaired } = await s.msg({ type: 'labRepaired' });
    assert.equal(repaired?.message, S.STATE_MESSAGES.locked);
    // The Server section says what discovery finds meanwhile: the old pin is an earlier pairing's.
    assert.equal((await s.msg({ type: 'labServer' })).state, 'pairing-mismatch');
    assert.ok((await s.msg({ type: 'labRepaired' })).repaired, 'still there');
    // The new pairing's server answers ready: the follow-up has done its job.
    s.fb.grant('http://localhost/*');
    s.worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(next))).authToken;
    assert.equal((await s.msg({ type: 'labServerAddress', url: s.worker.url })).manualUrl, s.worker.url);
    assert.equal((await s.msg({ type: 'labServer' })).state, 'ready');
    assert.deepEqual(await s.msg({ type: 'labRepaired' }), { lab: true, repaired: null });
    assert.equal(await s.storage('lab/repaired'), undefined);

    // No server known: no lock and no follow-up (a pairing change takes an earlier follow-up with the other lab/ keys).
    await s.app.pair({ input: await ds.pairingLink({ secret: ds.generateSecret(), relay: s.relay.url }), confirm: true });
    await s.fb.api.storage.local.remove(['server/pin', 'server/manualUrl']);
    const plain = await s.app.pair({ input: await ds.pairingLink({ secret: ds.generateSecret(), relay: s.relay.url }), confirm: true });
    assert.equal(plain.serverLocked, undefined);
    assert.deepEqual(await s.msg({ type: 'labRepaired' }), { lab: true, repaired: null });
  } finally { await s.close(); }
});

test('Unpair forgets a typed Server address, so another Daylight’s pairing says pairing-mismatch, not BAD_AUTH (2.6)', async () => {
  const s = await setup({ status: statusJson() });
  const pinned = 'https://daylight-0123456789ab.example.workers.dev';
  try {
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    await s.useWorker();
    // The server was found on the relay once too: pinned for this pairing.
    await s.fb.api.storage.local.set({ 'server/pin': { origin: pinned, fingerprint: values.fingerprint } });
    assert.equal((await s.msg({ type: 'labServer' })).state, 'ready');
    await s.app.unpair();
    assert.equal(await s.storage('server/manualUrl'), undefined, 'the typed address went with the pairing');
    assert.deepEqual(await s.storage('server/pin'), { origin: pinned, fingerprint: values.fingerprint }, 'the pin stays: it tells pairing-mismatch');
    assert.equal(s.worker.count('POST /v1/admin/lock'), 0, 'unpairing locks nothing: the same Daylight may come back');

    const statusCalls = s.worker.count('GET /v1/status');
    await s.app.pair({ input: await ds.pairingLink({ secret: ds.generateSecret(), relay: s.relay.url }) });
    const v = await s.msg({ type: 'labServer' });
    assert.deepEqual([v.state, v.message, v.manualUrl, v.setupFirst], ['pairing-mismatch', S.STATE_MESSAGES['pairing-mismatch'], '', true]);
    assert.equal(s.worker.count('GET /v1/status'), statusCalls, 'the old server wasn’t asked with the new pairing');
    assert.equal(await s.storage('server/badAuthAt'), undefined);
  } finally { await s.close(); }
});

// --- the words (1.6) -----------------------------------------------------------------------------------------------------

test('the popup’s and lab.html’s Lab words are LAB_TEXT’s', () => {
  for (const page of ['popup.html', 'lab.html']) {
    const html = fs.readFileSync(path.join(b.dir, page), 'utf8');
    assert.equal(/<label for="lab" class="switch-label">([^<]*)<\/label>/.exec(html)?.[1], L.LAB_TEXT.lab, page);
    assert.equal(/<p id="lab-footer"[^>]*>([^<]*)<\/p>/.exec(html)?.[1], L.LAB_TEXT.switchFooter, page);
    assert.match(html, /<input id="lab" class="switch" type="checkbox" role="switch" aria-describedby="lab-footer">/, page);
    assert.equal(/id="open-whats-in-lab"[^>]*><span class="nav-text"><span class="nav-label">([^<]*)</.exec(html)?.[1], L.LAB_TEXT.whatsInLab, page);
    assert.equal(/id="open-server"[^>]*><span class="nav-text"><span class="nav-label">([^<]*)</.exec(html)?.[1], L.LAB_TEXT.serverRow, page);
  }
  const lab = fs.readFileSync(path.join(b.dir, 'lab.html'), 'utf8');
  assert.equal(/<h2 id="lab-h">([^<]*)<\/h2>/.exec(lab)[1], L.LAB_TEXT.lab);
  assert.equal(/<h2 id="whats-h">([^<]*)<\/h2>/.exec(lab)[1], L.LAB_TEXT.whatsInLab);
  assert.equal(/<h2 id="server-h"[^>]*>([^<]*)<\/h2>/.exec(lab)[1], L.LAB_TEXT.serverRow);
});
