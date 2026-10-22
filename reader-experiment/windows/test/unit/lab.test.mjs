// Lab for Windows (LAB-PLAN F00 and F17, Windows parts; card WIN0) in node: the built core.js and lab.js with the
// mock relay, a stand-in Daylight server (test/helpers/fake-worker.mjs) and Daylights from daylight-lab.js
// (LabInboxSim), plus the build, the CSP and the window's Lab words.
//
//   node --test test/unit/lab.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dist, load } from '../helpers/built.mjs';
import { startFakeWorker, statusJson, hangingServer, deadAddress, goneWorker } from '../helpers/fake-worker.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';
import { LAB_LIB, SERVER_LIB, serverModule } from '../../build.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ds = await load('daylight-share.js');
const core = await load('core.js');
const labMod = await load('lab.js');
const L = await load('daylight-lab.js');
const S = await load('daylight-server.js');
const VEC = JSON.parse(fs.readFileSync(path.join(root, '..', 'server', 'vectors', 'server-vectors.json'), 'utf8'));
const quiet = { warn() {}, log() {} };
const MIN = 60000;
const WORKER_ORIGIN = 'https://daylight-0123456789ab.example.workers.dev';

function fakeTimers() {
  const t = { setTimeout: () => ({}), clearTimeout() {}, setInterval: () => ({}), clearInterval() {} };
  return t;
}

/**
 * fetch as the window has it (the CSP lets it reach any http(s) origin, the Worker answers CORS), with every URL
 * logged; ntfy.sh is out of reach here. flags.relayDown: the relay refuses; flags.route: {origin: where it really is}
 * (a workers.dev server answering from the stand-in).
 */
function windowFetch(relayUrl, log, flags) {
  return async (url, init) => {
    log.push(`${init?.method ?? 'GET'} ${url}`);
    if (new URL(url).hostname === 'ntfy.sh') throw new TypeError('Failed to fetch');
    if (flags.relayDown && url.startsWith(relayUrl)) throw new TypeError('Failed to fetch');
    for (const [from, to] of Object.entries(flags.route ?? {})) if (url.startsWith(from)) return fetch(to + url.slice(from.length), init);
    return fetch(url, init);
  };
}

async function setup({ paired = true, relayUrl = null, now, gateDeadlineMs, status } = {}) {
  const relay = await startMockRelay();
  const worker = await startFakeWorker({ status });
  const log = [];
  const flags = { relayDown: false };
  const useRelay = relayUrl ?? relay.url;
  const storage = new ds.MemoryStorage();
  const app = core.createApp({
    bridge: { notify: async () => {}, showWindow: async () => {} }, storage, timers: fakeTimers(), version: '1.2.0', log: quiet,
    fetch: windowFetch(useRelay, log, flags), now, gateDeadlineMs,
  });
  await app.lab.ensureDefault();
  const secret = ds.generateSecret();
  const link = await ds.pairingLink({ secret, relay: useRelay, name: 'Lab Daylight' });
  if (paired) await app.pair(link);
  const get = (k) => storage.get(k);
  return {
    relay, worker, app, lab: app.lab, log, flags, secret, link, storage, get, pairing: { secret, relay: useRelay },
    settings: () => get('settings'),
    /** Another Daylight's pairing, confirmed as the window would (a link that asks first). */
    async repair(nextSecret = ds.generateSecret(), name = 'Other Daylight') {
      const pre = await app.preparePairing(await ds.pairingLink({ secret: nextSecret, relay: useRelay, name }), { source: 'link' });
      assert.equal(pre.confirm.ask, true, 'another Daylight asks first');
      return app.applyPairing(pre.next, { expect: pre.current?.code ?? '' });
    },
    /** The stand-in as the typed Server address (2.6), knowing this pairing's token. */
    async useWorker(forSecret = secret) {
      worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(forSecret))).authToken;
      return app.lab.setServerAddress(worker.url);
    },
    close: async () => { await relay.close(); await worker.close(); },
  };
}

// --- the switch (1.2, 1.3) ----------------------------------------------------------------------------------------------

test('Lab is on by default: the first start writes settings.lab = true, a stored value stays, pairing and Comfort leave it', async () => {
  const s = await setup({ paired: false });
  try {
    assert.deepEqual(await s.settings(), { lab: true }, 'the first start wrote it');
    assert.equal(await s.lab.labOn(), true);
    assert.equal(await labMod.labOn(new ds.MemoryStorage()), true, 'a missing key means on');
    assert.deepEqual(await s.lab.setLab(false), { lab: false });
    await s.lab.ensureDefault();
    assert.equal((await s.settings()).lab, false, 'a stored value stays');
    assert.equal(await s.lab.labOn(), false);
    // Never in a pairing: pairing, re-pairing and unpairing leave it, and it leaves Comfort and the hotkey (F27.6).
    await s.app.setSettings({ comfort: true, hotkey: 'Ctrl+Alt+D' });
    await s.app.pair(s.link);
    await s.repair();
    await s.app.unpair();
    assert.deepEqual(await s.settings(), { lab: false, comfort: true, hotkey: 'Ctrl+Alt+D' });
    await s.lab.setLab(true);
    assert.deepEqual(await s.settings(), { lab: true, comfort: true, hotkey: 'Ctrl+Alt+D' }, 'Comfort stays when Lab changes');
    // The one-time note (1.2) comes with the first build that has F01 or F04: Wave 1 (WIN1) has F01.
    assert.equal(labMod.LAB_NOTE_ENABLED, true);
    const st = await s.lab.state();
    assert.deepEqual([st.lab, st.noteEnabled, st.labNoteShown], [true, true, false]);
    assert.equal(await s.lab.noteDue(), true);
    await s.lab.noteSeen();
    assert.equal(await s.lab.noteDue(), false, 'once dismissed, never again');
    assert.equal((await s.settings()).labNoteShown, true);
    await s.lab.setLab(false);
    await s.app.setSettings({ labNoteShown: false });
    assert.equal(await s.lab.noteDue(), false, 'never with Lab off');
  } finally { await s.close(); }
});

test('a switch that can’t be saved throws, so the window puts it back', async () => {
  const storage = new ds.MemoryStorage();
  const app = core.createApp({ bridge: {}, storage: { get: (k) => storage.get(k), set: async () => { throw new Error('disk full'); }, remove: (k) => storage.remove(k) }, timers: fakeTimers(), log: quiet });
  await assert.rejects(app.lab.setLab(false), /disk full/);
  assert.equal(await app.lab.labOn(), true);
});

test('Lab off: no discovery and no server call; the gate says how to turn it on; the screens have nothing to show', async () => {
  const s = await setup();
  try {
    await s.lab.setLab(false);
    s.log.length = 0;
    const g = await s.lab.gate('F02');
    assert.deepEqual([g.ready, g.state, g.message], [false, 'lab-off', 'Turn on Lab in Send to Daylight to use this.']);
    assert.deepEqual(await s.lab.overview(), { lab: false });
    assert.deepEqual(await s.lab.serverView(), { lab: false });
    assert.equal((await s.lab.checkSetupLink('x')).error, 'Turn on Lab in Send to Daylight to use this.');
    assert.equal((await s.lab.setServerAddress(s.worker.url)).error, 'Turn on Lab in Send to Daylight to use this.');
    const st = await s.lab.state();
    assert.deepEqual([st.lab, st.serverState, st.serverSubtitle], [false, null, null]);
    assert.deepEqual(s.log, [], 'nothing went on the network');
    assert.equal(s.worker.hits.length, 0);
  } finally { await s.close(); }
});

// --- What's in Lab (1.4) and the gate (1.5, 2.6) -------------------------------------------------------------------------

test('What’s in Lab on Windows: its Wave 1 features (1.4’s Apps column), then Files over 9 MB under the server heading, with the server’s short state', async () => {
  // 1.4's Apps column: F01, F07, F09, F16, F26 and F33 list Windows; F08 is Android's share-sheet row (on Windows only
  // the toast's words). Files over 9 MB is the one server feature that lists Windows; it comes in Wave S (`later`).
  assert.deepEqual(labMod.LAB_FEATURES, ['F01', 'F07', 'F09', 'F16', 'F26', 'F33']);
  assert.deepEqual(labMod.LAB_FEATURES, L.LAB_TEXT.featureOrder.filter((f) => labMod.LAB_FEATURES.includes(f)), 'in 1.4’s order');
  assert.deepEqual(labMod.LAB_SERVER_FEATURES, ['F02']);
  assert.deepEqual(labMod.BUILT_FEATURES, labMod.LAB_FEATURES);
  assert.deepEqual(labMod.USE_SWITCHES, ['F16', 'F33'], 'the Use switches of the features here that change how sending behaves (6.5 Q5)');
  const s = await setup({ paired: false });
  try {
    let o = await s.lab.overview();
    assert.deepEqual(o.features.map((f) => [f.id, f.name, f.sentence, f.short]), labMod.LAB_FEATURES.map((id) => [id, L.LAB_TEXT.features[id].name, L.LAB_TEXT.features[id].sentence, 'Pair first']));
    assert.deepEqual(o.settings, { use: { F16: true, F33: true }, quickSends: false }, 'Use switches on by default; quick sends off');
    assert.deepEqual(o.server.features.map((f) => [f.id, f.name, f.sentence]), [['F02', 'Files over 9 MB', 'Big PDFs and books go through your Daylight server.']]);
    assert.equal(o.header, 'Needs Lab on your Daylight', 'never heard from the Daylight (F17.2)');
    assert.deepEqual([o.server.state, o.server.short], ['needs-pairing', 'Pair first']);
    assert.equal(o.server.features[0].short, null, 'a row repeats no short state of the heading');

    await s.app.pair(s.link);
    o = await s.lab.overview();
    assert.deepEqual([o.fresh, o.server.state, o.server.short, o.server.features[0].short], [true, 'needs-server', 'Not set up', null]);
    // Paired, no Lab heard from the Daylight: the timeline needs Lab on it (F01's capability, `st`); the rest is Ready.
    assert.deepEqual(o.features.map((f) => [f.id, f.short]), [['F01', 'Needs Lab on your Daylight'], ['F07', 'Ready'], ['F09', 'Ready'], ['F16', 'Ready'], ['F26', 'Ready'], ['F33', 'Ready']]);
    assert.equal(o.cached, false, 'asked now');
    // Opened again: the last answer at once, from storage (1.5), and nothing on the network.
    const asked = s.log.length;
    let cached = await s.lab.overview({ refresh: false });
    assert.deepEqual([cached.fresh, cached.cached, cached.server.state, cached.server.short, cached.server.features[0].short], [true, true, 'needs-server', 'Not set up', null]);
    assert.equal(s.log.length, asked, 'nothing went on the network');
    assert.deepEqual(await s.lab.state(), { lab: true, noteEnabled: true, labNoteShown: false, serverState: 'needs-server', serverSubtitle: 'Optional · Not set up' });
    // An answer older than 10 minutes isn't used: no short states until the server answers.
    await s.storage.set('lab/server', { state: 'needs-server', at: Date.now() - 11 * MIN });
    cached = await s.lab.overview({ refresh: false });
    assert.deepEqual([cached.fresh, cached.cached, cached.server.state, cached.server.short, cached.server.features[0].short], [false, false, null, null, null]);
    assert.equal(s.log.length, asked, 'still nothing on the network');
  } finally { await s.close(); }
});

test('the gate: needs-pairing, then needs-server with the Server code to copy, within 5 s (F00.3, F00.6)', async () => {
  const s = await setup({ paired: false });
  try {
    let g = await s.lab.gate('F02');
    assert.deepEqual([g.state, g.short, g.button, g.message], ['needs-pairing', 'Pair first', null, L.LAB_TEXT.needs['needs-pairing']]);
    await s.app.pair(s.link);
    const t0 = Date.now();
    g = await s.lab.gate('F02');
    assert.ok(Date.now() - t0 < 5000);
    assert.deepEqual([g.ready, g.state, g.short, g.button], [false, 'needs-server', 'Needs your Daylight server', 'Copy Server code']);
    assert.equal(g.message, L.LAB_TEXT.needs['needs-server'], 'LAB_TEXT’s sentence under a control, not the long one');
    const seed = await S.deriveServerSeed(s.secret);
    assert.equal(g.serverCode, await S.formatServerCode(seed, { relay: s.relay.url }));
    const { configTopic } = await S.deriveServerValues(seed);
    assert.ok(s.log.some((l) => l.includes(configTopic)), 'discovery read the config topic');
    for (const f of ['F37', 'F19', 'F36', 'files', 'ai']) assert.equal((await s.lab.gate(f)).state, 'needs-server', f);
  } finally { await s.close(); }
});

test('the gate offline: a refused connection is OFFLINE at once, a relay that never answers is OFFLINE at the deadline', async () => {
  assert.equal(L.GATE_DEADLINE_MS, 5000, 'Windows uses the plan’s 5 s unless a test shortens it');
  let s = await setup({ relayUrl: await deadAddress() });
  try {
    const g = await s.lab.gate('F02');
    assert.deepEqual([g.state, g.short, g.message], ['OFFLINE', 'Can’t reach the server', S.STATE_MESSAGES.OFFLINE]);
  } finally { await s.close(); }

  const hang = await hangingServer();
  s = await setup({ relayUrl: hang.url, gateDeadlineMs: 400, paired: false });
  try {
    // Pairing with a relay that never answers: the pairing itself doesn't touch the relay.
    await s.app.pair(s.link);
    let t0 = Date.now();
    const g = await s.lab.gate('F02');
    let took = Date.now() - t0;
    assert.equal(g.state, 'OFFLINE');
    assert.equal(g.message, S.STATE_MESSAGES.OFFLINE);
    assert.ok(took >= 380 && took < 3000, `answered at the deadline (${took} ms)`);
    // What's in Lab asks the ack topic and the server at once: one deadline, not two.
    t0 = Date.now();
    const o = await s.lab.overview();
    took = Date.now() - t0;
    assert.equal(o.server.state, 'OFFLINE');
    assert.ok(took < 800 + 400, `What’s in Lab answered within about one deadline (${took} ms)`);
  } finally { await s.close(); await hang.close(); }
});

test('the gate with a server: its states; ready but not built is `later`; a fresh status answers at once (F00.3)', async () => {
  const s = await setup({ status: statusJson({ features: { files: 'needs-r2' } }) });
  try {
    // An earlier pairing's pinned server: discovery finds none for this pairing.
    await s.storage.set('server/pin', { origin: WORKER_ORIGIN, fingerprint: '0123abcd' });
    let g = await s.lab.gate('F02');
    assert.deepEqual([g.state, g.short, g.message], ['pairing-mismatch', 'Needs the new Server code', S.STATE_MESSAGES['pairing-mismatch']]);
    await s.storage.remove('server/pin');

    assert.equal((await s.useWorker()).manualUrl, s.worker.url);
    g = await s.lab.gate('F02');
    assert.deepEqual([g.state, g.short, g.message, g.button], ['needs-r2', 'Needs R2 storage', S.STATE_MESSAGES['needs-r2'], null]);
    s.worker.state.status = statusJson();
    await s.lab.serverView(); // asks now
    g = await s.lab.gate('F02');
    assert.deepEqual([g.ready, g.state, g.short], [false, 'later', 'In a later update']);
    assert.equal(g.message, 'Your Daylight server is ready. Files over 9 MB comes to this app in a later Lab update.');
    const asked = s.worker.count('GET /v1/status');
    assert.equal((await s.lab.gate('F02')).state, 'later');
    assert.equal(s.worker.count('GET /v1/status'), asked, 'a status 10 minutes old or less answers at once');

    const o = await s.lab.overview();
    assert.deepEqual([o.server.state, o.server.short, o.server.features[0].short], ['ready', 'Ready', 'In a later update']);
    // Opened again within 10 minutes: the same states at once, from the cached status (1.5), with nothing asked.
    const before = [s.log.length, s.worker.count('GET /v1/status')];
    const cached = await s.lab.overview({ refresh: false });
    assert.deepEqual([cached.fresh, cached.cached, cached.server.state, cached.server.short], [true, true, 'ready', 'Ready']);
    assert.deepEqual(cached.server.features.map((f) => [f.id, f.short]), o.server.features.map((f) => [f.id, f.short]));
    assert.deepEqual([s.log.length, s.worker.count('GET /v1/status')], before);
    // Without the module's cached status, a ready answer has no states to give.
    await s.storage.remove('server/status');
    assert.deepEqual((await s.lab.overview({ refresh: false })).server.state, null);
    const st = await s.lab.state({ refresh: false });
    assert.deepEqual([st.serverState, st.serverSubtitle], ['ready', 'Optional · Ready']);
  } finally { await s.close(); }
});

// --- the Daylight server section (2.6) ----------------------------------------------------------------------------------

test('the server section: the vector pairing’s Server code and fingerprint (F00.5), then a ready server’s lines', async () => {
  const s = await setup({ paired: false, status: statusJson({ lastSeen: new Date(Date.now() - 5 * MIN).toISOString(), usd: 0.227, limitUsd: 3 }) });
  try {
    let v = await s.lab.serverView();
    assert.deepEqual([v.paired, v.state, v.message, v.rerun], [false, 'needs-pairing', L.LAB_TEXT.needs['needs-pairing'], S.RERUN_HELP]);

    // The protocol vectors' pairing on ntfy.sh (out of reach here): the Server code is derived locally all the same.
    await s.app.pair(VEC.pairingCode);
    v = await s.lab.serverView();
    assert.equal(v.serverCode, VEC.derived.serverCode);
    assert.equal(await s.lab.serverCode(), VEC.derived.serverCode, 'what Copy puts on the clipboard');
    assert.equal(v.fingerprint, S.showFingerprint(VEC.derived.fingerprint));
    assert.deepEqual([v.state, v.message], ['OFFLINE', S.STATE_MESSAGES.OFFLINE]);
    assert.deepEqual([v.host, v.delivery, v.labInbox, v.aiToday, v.manualUrl, v.moved, v.v1Notice], ['', null, null, null, '', null, null]);

    // A pairing on another relay shows the link form, with the same seed; the long text names the secrets.
    await s.repair(s.secret, 'Lab Daylight');
    v = await s.lab.serverView();
    assert.equal(v.serverCode, await S.formatServerCode(await S.deriveServerSeed(s.secret), { relay: s.relay.url }));
    assert.match(v.serverCode, /^daylightserver:\/\/setup\?c=/);
    assert.deepEqual([v.state, v.message, v.setupFirst], ['needs-server', S.STATE_MESSAGES['needs-server'], true]);

    assert.equal((await s.lab.setServerAddress('ftp://nope')).error, 'That isn’t a server address (https://…).');
    assert.equal((await s.useWorker()).manualUrl, s.worker.url);
    v = await s.lab.serverView();
    const port = new URL(s.worker.url).port;
    assert.deepEqual([v.state, v.message, v.host, v.delivery, v.manualUrl, v.setupFirst], ['ready', 'Ready', `localhost:${port}`, 'lab', s.worker.url, false]);
    assert.equal(v.labInbox, 'Lab Inbox last seen 5 min ago');
    assert.equal(v.aiToday, 'AI today: US$0.23 of US$3');
    assert.deepEqual(await s.lab.setServerAddress(''), { manualUrl: '' });
    assert.equal(await s.get('server/manualUrl'), undefined);
  } finally { await s.close(); }
});

test('a server found on the relay: its host and the v1 notice; a move asks first and confirmMove pins the new origin', async () => {
  const s = await setup();
  try {
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    const relay = new ds.RelayClient({ relay: s.relay.url });
    await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: WORKER_ORIGIN, delivery: 'v1' }));
    s.flags.route = { [WORKER_ORIGIN]: s.worker.url };
    s.worker.state.token = values.authToken;
    let v = await s.lab.serverView();
    assert.deepEqual([v.state, v.host, v.delivery, v.v1Notice, v.moved], ['ready', 'daylight-0123456789ab.example.workers.dev', 'v1', S.noticeText('v1'), null]);
    assert.deepEqual(await s.get('server/pin'), { origin: WORKER_ORIGIN, fingerprint: values.fingerprint }, 'the module pinned it');

    // The same server announces another origin: the section asks, in LAB_TEXT's words; the pin stays until yes.
    const moved = 'https://daylight-ba9876543210.example.workers.dev';
    s.flags.route[moved] = s.worker.url;
    await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: moved, delivery: 'lab' }));
    assert.ok(Date.now() - (await s.get('server/configAt')) < S.CONFIG_REFRESH_MS, 'the cached config is fresh');
    const polls = s.log.filter((l) => l.includes(`/${values.configTopic}/json`)).length;
    v = await s.lab.serverView();
    assert.equal(s.log.filter((l) => l.includes(`/${values.configTopic}/json`)).length, polls + 1, 'opening the section read the config topic');
    assert.equal(v.moved, 'Your Daylight server moved to daylight-ba9876543210.example.workers.dev. Use it?');
    assert.equal(v.host, 'daylight-0123456789ab.example.workers.dev', 'still the pinned one');
    assert.equal(await s.lab.confirmMove(), true);
    v = await s.lab.serverView();
    assert.deepEqual([v.moved, v.host], [null, 'daylight-ba9876543210.example.workers.dev']);
  } finally { await s.close(); }
});

test('the server moved and the old address never answers: the question still shows when the 5 s run out (2.6)', async () => {
  const hang = await hangingServer();
  const s = await setup({ gateDeadlineMs: 400 });
  const old = 'https://daylight-aaaaaaaaaaaa.example.workers.dev';
  const moved = 'https://daylight-bbbbbbbbbbbb.example.workers.dev';
  try {
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    const relay = new ds.RelayClient({ relay: s.relay.url });
    const announce = async (server, agoMin) => relay.publish(values.configTopic, await S.buildConfigFrame(values, { server, sent: new Date(Date.now() - agoMin * MIN).toISOString() }));
    // This pairing's server was found at `old` on the relay an hour ago (the config is cached and fresh: 6 hours) and
    // now never answers; the deploy's new Worker announces `moved`.
    s.flags.route = { [old]: hang.url, [moved]: s.worker.url };
    await s.storage.set('server/pin', { origin: old, fingerprint: values.fingerprint });
    await s.storage.set('server/config', { server: old, api: S.SERVER_API, fingerprint: values.fingerprint, delivery: 'lab', sent: new Date(Date.now() - 60 * MIN).toISOString(), id: 'a' });
    await s.storage.set('server/configAt', Date.now() - 60 * MIN);
    await announce(moved, 4);
    const t0 = Date.now();
    let v = await s.lab.serverView();
    assert.ok(Date.now() - t0 < 2000, 'answered at the gate’s deadline');
    assert.deepEqual([v.state, v.moved], ['OFFLINE', L.serverMovedText(moved)], 'the question is not lost with the probe');
    assert.deepEqual(await s.get('server/pendingMove'), { origin: moved, fingerprint: values.fingerprint });
    assert.equal(s.worker.count('GET /v1/status'), 0, 'nothing went to the new address before Use it');
    // Asked again the next time (Cancel changes nothing).
    assert.equal((await s.lab.serverView()).moved, L.serverMovedText(moved));
    // From here the old address refuses at once. One discovery runs at a time: the one still waiting on the old
    // address ends with its connection, and each opening after it reads the relay afresh.
    s.flags.route[old] = await deadAddress();
    await hang.close();
    assert.equal((await s.lab.probe({ force: true })).state, 'OFFLINE');
    // A typed Server address wins over discovery: no question then.
    await s.storage.set('server/manualUrl', s.worker.url);
    assert.equal((await s.lab.serverView()).moved, null);
    await s.storage.remove('server/manualUrl');
    // Once the server announces the pinned origin again, an old pendingMove asks nothing.
    await announce(old, 3);
    assert.equal((await s.lab.serverView()).moved, null);
    assert.equal((await s.get('server/config')).server, old);
    await announce(moved, 2);
    // Use it: the module pins the new origin, and the server is ready there.
    s.worker.state.token = values.authToken;
    assert.equal(await s.lab.confirmMove(), true);
    assert.deepEqual(await s.get('server/pin'), { origin: moved, fingerprint: values.fingerprint });
    v = await s.lab.serverView();
    assert.deepEqual([v.state, v.host, v.moved], ['ready', 'daylight-bbbbbbbbbbbb.example.workers.dev', null]);
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
      s.flags.route = { [old]: s.worker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: old, sent: new Date(Date.now() - 2 * MIN).toISOString() }));
      let v = await s.lab.serverView();
      assert.deepEqual([v.state, v.host, v.moved], ['ready', 'daylight-aaaaaaaaaaaa.example.workers.dev', null]);
      assert.equal((await s.get('server/config')).server, old);
      assert.ok(Date.now() - (await s.get('server/configAt')) < S.CONFIG_REFRESH_MS, 'the cached config is fresh');

      // The deploy deleted the old Worker (workers.dev answers 404 with its own page), or its address refuses
      // connections; the new Worker announces itself at `moved`.
      s.flags.route = { [old]: was === 'deleted' ? gone.url : dead, [moved]: s.worker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: moved, sent: new Date(Date.now() - MIN).toISOString() }));
      const statusAsked = s.worker.count('GET /v1/status');
      let p = polls();
      const o = await s.lab.overview();
      assert.equal(polls(), p + 1, `${was}: What’s in Lab read the config topic`);
      assert.deepEqual(await s.get('server/pendingMove'), { origin: moved, fingerprint: values.fingerprint });
      assert.equal(o.server.state, was === 'deleted' ? 'error' : 'ready');
      if (was === 'deleted') assert.equal(o.server.short, L.serverHeadingShort('error'));

      p = polls();
      v = await s.lab.serverView();
      assert.equal(polls(), p + 1, `${was}: the section read the config topic`);
      assert.equal(v.moved, L.serverMovedText(moved), `${was}: the section asks at once`);
      assert.equal(v.host, 'daylight-aaaaaaaaaaaa.example.workers.dev', 'still on the old pin until Use it');
      if (was === 'deleted') assert.deepEqual([v.state, v.message], ['error', S.errorMessage('SERVER_ERROR')]);
      else assert.equal(v.state, 'ready', 'a refused connection keeps the cached status (the module’s OFFLINE fallback)');
      assert.equal(s.worker.count('GET /v1/status'), statusAsked, 'nothing went to the new address before Use it');
      if (was === 'deleted') assert.ok(gone.count('GET /v1/status') >= 1, 'the old address was asked');

      assert.equal(await s.lab.confirmMove(), true);
      v = await s.lab.serverView();
      assert.deepEqual([v.state, v.host, v.moved], ['ready', 'daylight-bbbbbbbbbbbb.example.workers.dev', null]);
      assert.equal((await s.lab.overview()).server.state, 'ready');
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
      s.flags.route = { [old]: s.worker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: old, sent: new Date(Date.now() - 2 * MIN).toISOString() }));
      assert.equal((await s.lab.serverView()).state, 'ready');

      s.flags.route = { [old]: answer === 'SERVER_ERROR' ? gone.url : other.url, [moved]: s.worker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: moved, sent: new Date(Date.now() - MIN).toISOString() }));
      t += 11 * MIN; // the status (10 minutes) is stale, the config (6 hours) fresh: the tap reads no config first
      let p = polls();
      let g = await s.lab.gate('F02');
      assert.deepEqual([g.ready, g.state, g.message], [false, 'error', S.errorMessage(answer)]);
      assert.equal(polls(), p + 1, `${answer}: the config topic was read once, after the server failed`);
      assert.deepEqual(await s.get('server/pendingMove'), { origin: moved, fingerprint: values.fingerprint });

      // Tapped again: a server that keeps answering 401 costs no more relay polls (server/badAuthAt, the module's
      // episode); a server that is gone is looked for again.
      t += MIN;
      p = polls();
      g = await s.lab.gate('F02');
      assert.equal(g.state, 'error');
      assert.equal(polls(), p + (answer === 'BAD_AUTH' ? 0 : 1));

      const v = await s.lab.serverView();
      assert.deepEqual([v.state, v.moved], ['error', L.serverMovedText(moved)]);
      assert.equal(v.setupFirst, answer === 'BAD_AUTH', 'after a BAD_AUTH, Set up with a link comes first');
      assert.equal(s.worker.count('GET /v1/status'), 1, 'nothing went to the new address before Use it');
    } finally { await s.close(); await gone.close(); await other.close(); }
  }
});

test('Set up with a link (2.6, DESIGN 3.5): read here first, sent only on Use it, then the server is pinned and ready', async () => {
  const s = await setup();
  try {
    let v = await s.lab.serverView();
    assert.deepEqual([v.state, v.setupFirst], ['needs-server', true], 'its message says to paste a setup link');
    // A link that isn't one: the module's message, and nothing is sent.
    for (const bad of ['not a link', s.link, 'https://daylight-0123456789ab.evil.example/setup#SETUP-AAAA']) {
      const r = await s.lab.checkSetupLink(bad);
      await assert.rejects(S.parseSetupLink(bad), (e) => e.message === r.error, bad);
    }
    const secret = Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3);
    const link = await S.formatSetupLink(WORKER_ORIGIN, secret);
    let r = await s.lab.checkSetupLink(link);
    assert.deepEqual(r, { server: WORKER_ORIGIN, confirm: L.setupConfirmText(WORKER_ORIGIN) });
    assert.equal(r.confirm, 'daylight-0123456789ab.example.workers.dev will get this pairing’s Server code. Continue only if this address is on your own Cloudflare account.');
    assert.equal(s.worker.count('POST /v1/setup'), 0, 'nothing sent before Use it');

    s.flags.route = { [WORKER_ORIGIN]: s.worker.url };
    s.worker.state.setup = { token: 'another link', answer: {} };
    assert.deepEqual(await s.lab.setupServer(link), { error: S.errorMessage('SETUP_INVALID') });
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    s.worker.state.setup = { token: await S.deriveSetupToken(secret), answer: { server: WORKER_ORIGIN, api: 1, fingerprint: values.fingerprint, delivery: 'lab' } };
    s.worker.state.token = values.authToken;
    r = await s.lab.setupServer(link);
    assert.deepEqual(r, { done: L.LAB_TEXT.serverSection.setupDone });
    assert.deepEqual(await s.get('server/pin'), { origin: WORKER_ORIGIN, fingerprint: values.fingerprint });
    v = await s.lab.serverView();
    assert.deepEqual([v.state, v.host, v.setupFirst], ['ready', 'daylight-0123456789ab.example.workers.dev', false]);
  } finally { await s.close(); }
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
  return { receiver, labInbox, pollOnce: () => { skew += MIN; return sim.pollOnce(); }, advance: (ms = MIN) => { skew += ms; } };
}

test('F17: every ack-topic frame feeds the ledger, Lab on or off; What’s in Lab and the status file say what the Daylight said', async () => {
  const s = await setup();
  try {
    // A v1.1 Daylight: rows say Delivered ✓, the header says Lab isn't confirmed, with the check-in time (F17.2).
    const one = await s.app.sendLink('https://example.com/one', 'One');
    await new ds.Receiver({ pairing: s.pairing, storage: new ds.MemoryStorage() }).pollOnce();
    await s.app.tick();
    let snap = await s.app.snapshot();
    assert.deepEqual(snap.rows.map((r) => [r.id, r.label]), [[one.id, 'Delivered ✓']]);
    assert.deepEqual([snap.lab, snap.inboxLab, snap.caps], [true, false, []]);
    assert.equal(snap.labHeader, 'Needs Lab on your Daylight · checked in just now');
    assert.equal((await s.lab.overview()).header, 'Needs Lab on your Daylight · checked in just now');

    // A Lab Daylight says hello and reports states: opening What's in Lab reads the ack topic, whatever the outbox.
    const day = await labDaylight(s.pairing);
    const two = await s.app.sendLink('https://example.com/two', 'Two');
    assert.ok((await day.pollOnce()).lab, 'the Daylight published a Lab frame');
    assert.equal((await s.lab.overview({ refresh: false })).header, 'Needs Lab on your Daylight · checked in just now', 'not read yet');
    assert.equal((await s.lab.overview()).header, 'Your Daylight: Lab on · checked in just now');
    assert.equal((await s.lab.ledger.state(two.id))?.s, 'reader');
    snap = await s.app.snapshot();
    assert.deepEqual([snap.inboxLab, snap.caps], [true, ['reader-link', 'st', 'tap']]);
    assert.equal(snap.labStates[two.id].s, 'reader');
    // The status file keeps v1.1's words in `label`; the timeline's (F01, Wave 1) are labRow's.
    assert.equal(snap.rows.find((r) => r.id === two.id).label, 'Delivered ✓');
    assert.equal(snap.rows.find((r) => r.id === two.id).labRow.label, 'In your Reader ✓');

    // Lab off: the ledger keeps learning (1.3), so turning Lab on shows the right state at once.
    await s.lab.setLab(false);
    const three = await s.app.sendFile({ name: 'Three.pdf', bytes: ds.utf8('%PDF-1.4\n') });
    await day.pollOnce();
    await s.app.tick();
    assert.equal((await s.lab.ledger.state(three.id))?.s, 'handed');
    assert.equal((await s.app.snapshot()).lab, false);

    // Pruned to the outbox's ids after a tick.
    await s.app.remove(two.id);
    await s.app.tick();
    assert.equal(await s.lab.ledger.state(two.id), null);
    assert.equal((await s.lab.ledger.state(three.id))?.s, 'handed');

    // Another Daylight: every lab/* key goes with the outbox, the switch stays.
    await s.lab.setLab(true);
    await s.lab.state();
    assert.ok(await s.get('lab/server'), 'the server row’s last state is kept under lab/');
    await s.repair();
    for (const k of ['lab/inbox', 'lab/heard', 'lab/states', 'lab/server', 'lab/repaired']) assert.equal(await s.get(k), undefined, k);
    assert.equal((await s.settings()).lab, true);
    assert.equal((await s.lab.overview({ refresh: false })).header, 'Needs Lab on your Daylight');
    assert.deepEqual(await s.app.rows(), [], 'the outbox went too');
  } finally { await s.close(); }
});

test('F17: a frame from a later Lab level, junk and a lab: 0 frame are read safely; nothing of Lab delays an ack', async () => {
  const s = await setup();
  try {
    const keys = await ds.deriveKeys(s.secret);
    const relay = new ds.RelayClient({ relay: s.relay.url });
    const row = await s.app.sendLink('https://example.com/acked', 'Acked');
    // A later level is unknown (2.1 rule 7); junk is ignored; the ack still marks the row delivered.
    await relay.publish(keys.ackTopic, await ds.encryptFrame(keys, 'ack', { v: 1, kind: 'ack', ids: [], sent: ds.nowIso(), 'x-inbox': { lab: 2, app: 'android/9', caps: ['st'] } }, new Uint8Array(0)));
    await relay.publish(keys.ackTopic, await ds.encryptFrame(keys, 'ack', { v: 1, kind: 'ack', ids: [], sent: ds.nowIso(), 'x-inbox': 'junk', 'x-st': 7 }, new Uint8Array(0)));
    await relay.publish(keys.ackTopic, await ds.buildAckFrame(keys, [row.id]));
    await s.app.tick();
    assert.equal((await s.app.rows())[0].status, 'delivered');
    assert.equal(await s.lab.ledger.inboxLab(), false);
    // Lab on, then a lab: 0 frame from the same publisher ends its Lab at once (2.2.6).
    const day = await labDaylight(s.pairing);
    await day.labInbox.labTurnedOn();
    await s.app.checkAcksNow();
    assert.equal(await s.lab.ledger.inboxLab(), true);
    day.advance(); // past the 30 s between Lab frames
    assert.equal((await day.labInbox.labTurnedOff()).kind, 'off');
    await s.app.checkAcksNow();
    assert.equal(await s.lab.ledger.inboxLab(), false);
    assert.equal((await s.app.snapshot()).labHeader.startsWith('Needs Lab on your Daylight · checked in'), true);
  } finally { await s.close(); }
});

// --- F00.4 and re-pairing ------------------------------------------------------------------------------------------------

test('F00.4: an item queued offline goes once back online with Lab off; pairing, history and the server pin stay', async () => {
  let clock = Date.now();
  const s = await setup({ now: () => clock });
  try {
    await s.storage.set('server/pin', { origin: WORKER_ORIGIN, fingerprint: '0123abcd' });
    const old = await s.app.sendLink('https://example.com/kept', 'Kept');
    s.flags.relayDown = true;
    const row = await s.app.sendLink('https://example.com/offline', 'Offline');
    assert.deepEqual([row.status, row.errorCode], ['failed', 'network']);
    await s.lab.setLab(false);
    s.flags.relayDown = false;
    clock += 60 * MIN;
    await s.app.tick();
    const rows = await s.app.rows();
    assert.equal(rows.find((r) => r.id === row.id).status, 'sent', 'sent once back online');
    assert.ok(rows.some((r) => r.id === old.id), 'history kept');
    assert.equal((await s.app.state()).paired, true, 'pairing kept');
    assert.deepEqual(await s.get('server/pin'), { origin: WORKER_ORIGIN, fingerprint: '0123abcd' });
    const { items } = await new ds.Receiver({ pairing: s.pairing, storage: new ds.MemoryStorage() }).pollOnce();
    assert.ok(items.some((i) => i.header.id === row.id));
  } finally { await s.close(); }
});

test('re-pairing with another Daylight locks a server that knows the old pairing first, Lab on or off (2.6)', async () => {
  const s = await setup();
  try {
    await s.useWorker();
    await s.lab.setLab(false);
    // The same Daylight again (a rename): no lock, no follow-up.
    const same = await s.app.pair(await ds.pairingLink({ secret: s.secret, relay: s.relay.url, name: 'Renamed' }));
    assert.equal(same.serverLocked, undefined);
    assert.equal(s.worker.count('POST /v1/admin/lock'), 0);
    // Asking first: nothing is locked before the answer.
    const next = ds.generateSecret();
    const pre = await s.app.preparePairing(await ds.pairingLink({ secret: next, relay: s.relay.url }), { source: 'link' });
    assert.equal(s.worker.count('POST /v1/admin/lock'), 0, 'nothing before the answer');
    const done = await s.app.applyPairing(pre.next, { expect: pre.current.code });
    assert.equal(s.worker.count('POST /v1/admin/lock'), 1, 'locked with the old pairing’s token');
    assert.equal(done.serverLocked, true);
    assert.equal(await s.get('server/manualUrl'), undefined, 'the typed address was the old server’s: forgotten (DESIGN 12.7)');
    // Lab off: nothing to show (1.3); it waits for Lab.
    assert.deepEqual(await s.lab.repaired(), { lab: false, repaired: null });
    assert.ok(await s.get('lab/repaired'));

    await s.lab.setLab(true);
    const { repaired } = await s.lab.repaired();
    assert.deepEqual(repaired, {
      state: 'locked', message: S.STATE_MESSAGES.locked,
      serverCode: await S.formatServerCode(await S.deriveServerSeed(next), { relay: s.relay.url }), rerun: S.RERUN_HELP,
    });
    await s.lab.repairSeen();
    assert.deepEqual(await s.lab.repaired(), { lab: true, repaired: null });
  } finally { await s.close(); }
});

test('the re-pairing follow-up shows when the lock didn’t reach the server too, and goes once the new server answers', async () => {
  const s = await setup();
  try {
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    await s.storage.set('server/pin', { origin: await deadAddress(), fingerprint: values.fingerprint });
    const next = ds.generateSecret();
    const done = await s.repair(next);
    assert.equal(done.serverLocked, true);
    assert.equal((await s.lab.repaired()).repaired?.message, S.STATE_MESSAGES.locked);
    assert.equal((await s.lab.serverView()).state, 'pairing-mismatch', 'the old pin is an earlier pairing’s');
    assert.ok((await s.lab.repaired()).repaired, 'still there');
    assert.equal((await s.useWorker(next)).manualUrl, s.worker.url);
    assert.equal((await s.lab.serverView()).state, 'ready');
    assert.deepEqual(await s.lab.repaired(), { lab: true, repaired: null });
    assert.equal(await s.get('lab/repaired'), undefined);

    // No server known: no lock and no follow-up; unpairing takes Lab's keys too and keeps the switch.
    await s.storage.remove('server/pin');
    await s.storage.remove('server/manualUrl');
    assert.equal((await s.repair()).serverLocked, undefined);
    assert.deepEqual(await s.lab.repaired(), { lab: true, repaired: null });
    await s.lab.state();
    await s.app.unpair();
    for (const k of ['lab/inbox', 'lab/heard', 'lab/states', 'lab/server', 'lab/repaired']) assert.equal(await s.get(k), undefined, k);
    assert.equal((await s.settings()).lab, true);
  } finally { await s.close(); }
});

test('Unpair forgets a typed Server address, so another Daylight’s pairing says pairing-mismatch, not BAD_AUTH, and finds its own server (2.6)', async () => {
  const s = await setup({ status: statusJson() });
  try {
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    await s.useWorker();
    // The server was found on the relay once too: pinned for this pairing.
    await s.storage.set('server/pin', { origin: WORKER_ORIGIN, fingerprint: values.fingerprint });
    assert.equal((await s.lab.serverView()).state, 'ready');
    await s.app.unpair();
    assert.equal(await s.get('server/manualUrl'), undefined, 'the typed address went with the pairing');
    assert.equal(await s.get('server/status'), undefined, 'and the status it answered');
    assert.deepEqual(await s.get('server/pin'), { origin: WORKER_ORIGIN, fingerprint: values.fingerprint }, 'the pin stays: it tells pairing-mismatch');
    assert.equal(s.worker.count('POST /v1/admin/lock'), 0, 'unpairing locks nothing: the same Daylight may come back');

    const statusCalls = s.worker.count('GET /v1/status');
    const other = ds.generateSecret();
    await s.app.pair(await ds.pairingLink({ secret: other, relay: s.relay.url }));
    let v = await s.lab.serverView();
    assert.deepEqual([v.state, v.message, v.manualUrl, v.setupFirst], ['pairing-mismatch', S.STATE_MESSAGES['pairing-mismatch'], '', true]);
    assert.equal((await s.lab.gate('F02')).state, 'pairing-mismatch');
    assert.equal(s.worker.count('GET /v1/status'), statusCalls, 'the old server wasn’t asked with the new pairing');
    assert.equal(await s.get('server/badAuthAt'), undefined);

    // The other Daylight's own server, announced on the relay, is found and pinned for it.
    const otherValues = await S.deriveServerValues(await S.deriveServerSeed(other));
    const otherOrigin = 'https://daylight-ba9876543210.example.workers.dev';
    s.flags.route = { [otherOrigin]: s.worker.url };
    s.worker.state.token = otherValues.authToken;
    await new ds.RelayClient({ relay: s.relay.url }).publish(otherValues.configTopic, await S.buildConfigFrame(otherValues, { server: otherOrigin }));
    v = await s.lab.serverView();
    assert.deepEqual([v.state, v.host], ['ready', 'daylight-ba9876543210.example.workers.dev']);
    assert.deepEqual(await s.get('server/pin'), { origin: otherOrigin, fingerprint: otherValues.fingerprint });
  } finally { await s.close(); }
});

test('Unpair forgets the server’s cached status: another Daylight’s gates and the Settings row ask its own server (2.6)', async () => {
  // A's server is ready and its status cached (10 minutes); after Unpair, B is paired. B's server is announced on the
  // relay and reports files: needs-r2 (or doesn't know B yet: 401). Nothing may answer from A's status.
  for (const b of ['needs-r2', 'BAD_AUTH']) {
    const s = await setup({ status: statusJson() });
    const bWorker = await startFakeWorker({ status: statusJson({ features: { files: 'needs-r2' } }) });
    try {
      const relay = new ds.RelayClient({ relay: s.relay.url });
      const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
      const aOrigin = 'https://daylight-aaaaaaaaaaaa.example.workers.dev';
      const bOrigin = 'https://daylight-bbbbbbbbbbbb.example.workers.dev';
      s.worker.state.token = values.authToken;
      s.flags.route = { [aOrigin]: s.worker.url, [bOrigin]: bWorker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: aOrigin }));
      assert.equal((await s.lab.gate('F02')).state, 'later', 'A’s server is ready');
      assert.deepEqual((await s.lab.state()).serverSubtitle, 'Optional · Ready');
      assert.ok(await s.get('server/status'), 'A’s status is cached');

      await s.app.unpair();
      assert.equal(await s.get('server/status'), undefined, `${b}: the status went with the pairing`);
      assert.deepEqual(await s.get('server/pin'), { origin: aOrigin, fingerprint: values.fingerprint }, 'the pin stays');
      assert.equal(s.worker.count('POST /v1/admin/lock'), 0, 'unpairing locks nothing');

      const other = ds.generateSecret();
      const otherValues = await S.deriveServerValues(await S.deriveServerSeed(other));
      bWorker.state.token = b === 'BAD_AUTH' ? 'another pairing’s token' : otherValues.authToken;
      await relay.publish(otherValues.configTopic, await S.buildConfigFrame(otherValues, { server: bOrigin }));
      await s.app.pair(await ds.pairingLink({ secret: other, relay: s.relay.url, name: 'Other Daylight' }));
      const aAsked = s.worker.count('GET /v1/status');

      const g = await s.lab.gate('F02');
      if (b === 'needs-r2') assert.deepEqual([g.state, g.message], ['needs-r2', S.STATE_MESSAGES['needs-r2']], 'B’s own status');
      else assert.deepEqual([g.state, g.message], ['error', S.errorMessage('BAD_AUTH')]);
      assert.ok(bWorker.count('GET /v1/status') >= 1, 'B’s server was asked');
      assert.equal(s.worker.count('GET /v1/status'), aAsked, 'A’s server wasn’t');
      const st = await s.lab.state();
      assert.equal(st.serverSubtitle, b === 'needs-r2' ? 'Optional · Ready' : L.serverRowSubtitle('error'));
      assert.deepEqual(await s.get('server/pin'), { origin: bOrigin, fingerprint: otherValues.fingerprint });
    } finally { await s.close(); await bWorker.close(); }
  }
});

test('a typed Server address kept with no pairing is forgotten when a pairing arrives', async () => {
  const s = await setup({ paired: false });
  try {
    await s.storage.set('server/manualUrl', s.worker.url);
    await s.storage.set('server/status', statusJson());
    await s.app.pair(s.link);
    assert.equal(await s.get('server/manualUrl'), undefined);
    assert.equal(await s.get('server/status'), undefined);
    assert.equal((await s.lab.serverView()).state, 'needs-server');
    assert.equal(s.worker.hits.length, 0, 'the old address wasn’t asked');
    // A status alone (no typed address) is an earlier pairing's too.
    await s.app.unpair();
    await s.storage.set('server/status', statusJson());
    await s.app.pair(s.link);
    assert.equal(await s.get('server/status'), undefined);
  } finally { await s.close(); }
});

// --- the build, the CSP and the words ----------------------------------------------------------------------------------

test('the build copies daylight-lab.js unchanged and daylight-server.js with only its import pointed next to it', () => {
  const out = dist();
  assert.deepEqual(fs.readFileSync(path.join(out, 'daylight-lab.js')), fs.readFileSync(LAB_LIB));
  const server = fs.readFileSync(path.join(out, 'daylight-server.js'), 'utf8');
  const source = fs.readFileSync(SERVER_LIB, 'utf8');
  assert.equal(server, source.replace("from '../../share/js/daylight-share.js';", "from './daylight-share.js';"));
  assert.doesNotMatch(server, /from '\.\.\//);
  assert.throws(() => serverModule("import { x } from '../../share/js/other.js';\n"), /expected one import/);
  assert.throws(() => serverModule("import a from '../../share/js/daylight-share.js';\nimport b from '../x.js';\n"), /outside the module folder/);
});

/** Whether a CSP source list lets the page connect to `url` (scheme, host and wildcard sources; enough for this CSP). */
function cspAllows(sources, url) {
  const u = new URL(url);
  return sources.some((src) => {
    if (src === `${u.protocol}`) return true;
    const m = /^(https?:)\/\/(\*\.)?([^/:]+)(:\d+|:\*)?$/.exec(src);
    if (!m || m[1] !== u.protocol) return false;
    return m[2] ? u.hostname.endsWith(`.${m[3]}`) : u.hostname === m[3];
  });
}

test('the window’s CSP lets Lab reach the Daylight server and any relay, and still refuses inline code and styles', () => {
  const conf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const csp = Object.fromEntries(conf.app.security.csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  // The deploy's Worker (2.6, DESIGN 3.5), a typed Server address on any https origin, ntfy.sh and a self-hosted relay.
  for (const url of [`${WORKER_ORIGIN}/v1/status`, 'https://daylight.example.org/v1/hello', 'https://ntfy.sh/dls-abc/json', 'http://127.0.0.1:8080/dls-abc/json']) {
    assert.ok(cspAllows(csp['connect-src'], url), `connect-src allows ${url}`);
  }
  // Named as well as covered by https: (LAB-PLAN F00), so a narrower list later can't drop the deploy's Worker.
  assert.ok(csp['connect-src'].includes('https://*.workers.dev'), 'connect-src names the Workers origin');
  assert.deepEqual(csp['script-src'], ["'self'"]);
  assert.deepEqual(csp['style-src'], ["'self'"], 'the Lab screens set no inline styles');
  assert.deepEqual(csp['object-src'], ["'none'"]);
  for (const f of ['lab.js', 'lab-ui.js', 'app.js']) {
    const js = fs.readFileSync(path.join(root, 'src', f), 'utf8');
    assert.doesNotMatch(js, /\.style\.|setAttribute\('style'|\binnerHTML\s*=(?!\s*'';)/, `${f} sets no inline style and no HTML`);
  }
});

test('the window’s Lab words are LAB_TEXT’s, the switch comes first in Settings, and Comfort stays outside Lab', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const settings = html.slice(html.indexOf('<section id="view-settings"'), html.indexOf('</section>', html.indexOf('<section id="view-settings"')));
  assert.equal(/<label for="lab" class="switch-label">([^<]*)<\/label>/.exec(settings)?.[1], L.LAB_TEXT.lab);
  assert.match(settings, /<input id="lab" class="switch" type="checkbox" role="switch" aria-describedby="lab-footer">/);
  assert.equal(/<p id="lab-footer"[^>]*>([^<]*)<\/p>/.exec(settings)?.[1], L.LAB_TEXT.switchFooter);
  assert.equal(/id="open-whats"[^>]*><span class="nav-text"><span class="nav-label">([^<]*)</.exec(settings)?.[1], L.LAB_TEXT.whatsInLab);
  assert.equal(/id="open-server"[^>]*><span class="nav-text"><span class="nav-label">([^<]*)</.exec(settings)?.[1], L.LAB_TEXT.serverRow);
  assert.ok(settings.indexOf('id="lab"') < settings.indexOf('id="comfort"'), 'Lab is Settings’ first row (1.1); Comfort follows, outside it');
  assert.ok(settings.indexOf('id="lab-footer"') < settings.indexOf('id="comfort"'));
  assert.match(html, /<div id="lab-rows" class="nav-rows" hidden>/, 'the rows show only once Lab is known to be on');
  assert.equal(/<h2 id="whats-h">([^<]*)<\/h2>/.exec(html)[1], L.LAB_TEXT.whatsInLab);
  assert.equal(/<h2 id="server-h"[^>]*>([^<]*)<\/h2>/.exec(html)[1], L.LAB_TEXT.serverRow);
  assert.match(html, /<div id="lab-repaired" class="lab-repaired" role="region" hidden><\/div>/);
  // The Lab screens take their words from LAB_TEXT: no Lab sentence is written out as a string in them.
  for (const f of ['lab-ui.js', 'lab.js', 'app.js']) {
    const js = fs.readFileSync(path.join(root, 'src', f), 'utf8');
    const SS = L.LAB_TEXT.serverSection;
    for (const t of [L.LAB_TEXT.checking, L.LAB_TEXT.serverHeading, SS.setupDone, L.LAB_TEXT.switchFooter, ...Object.values(L.LAB_TEXT.needs),
      SS.stepsHeading, ...SS.steps, SS.stepsMore, SS.hostLabel, SS.deliveryLabel, SS.deliveryLab, SS.deliveryV1, SS.addressPlaceholder,
      SS.addressSave, SS.addressFooter]) {
      for (const q of ["'", '"', '`']) assert.ok(!js.includes(`${q}${t}${q}`), `${f} writes out “${t}”`);
    }
  }
  // The server section's lines are LAB_TEXT.serverSection's (2.6, "The rest of the server section's copy"), not the
  // window's own: its setup steps, host line, delivery mode and the Server address field's placeholder, Save and footer.
  const ui = fs.readFileSync(path.join(root, 'src', 'lab-ui.js'), 'utf8');
  for (const key of ['stepsHeading', 'steps', 'stepsMore', 'hostLabel', 'deliveryLabel', 'deliveryLab', 'deliveryV1', 'addressPlaceholder', 'addressSave', 'addressFooter']) {
    assert.match(ui, new RegExp(`\\bS\\.${key}\\b`), `lab-ui.js shows LAB_TEXT.serverSection.${key}`);
  }
  assert.match(ui, /\bhostLineText\(model\.host, model\.fingerprint\)/, 'the host line is hostLineText’s');
});

test('the window’s Lab code is Wave 1, and the release gate reads it so (LAB-PLAN 6.2)', async () => {
  const { codeWave, readTree, w1Names } = await import('../../scripts/lab-wave.mjs');
  const { wave, why } = codeWave(readTree(root), { w1: w1Names(fs.readFileSync(LAB_LIB, 'utf8')) });
  assert.equal(wave, 'w1', why.join('; '));
  // Each of WIN1's pieces alone is enough to hold the build for W1: the timeline, the offline queue, smart intake,
  // Setup check, the Use switches, the note, the features it lists.
  for (const reason of ['uses describeLabRow', 'sends with defer (F07)', 'uses normaliseShare', 'uses testArticle', 'uses labUseOn', 'sets LAB_NOTE_ENABLED = true', 'builds F01']) {
    assert.ok(why.some((w) => w.includes(reason)), `${reason}: ${why.join('; ')}`);
  }
  const gate = JSON.parse(fs.readFileSync(path.join(root, '..', 'lab-release-gate.json'), 'utf8'));
  assert.equal(typeof gate.w1, 'boolean', 'the gate knows W1');
});
