// Lab in the web sender (LAB-PLAN F00 and F17, web parts; card B0) in node: the built site's web-lab.js with the page's
// storage adapter (memory here: node has no IndexedDB), the mock relay, a stand-in Daylight server and Daylights from
// daylight-lab.js. Also the build (what it copies, what the service worker keeps offline), the page's Lab words, and
// web/scripts/lab-wave.mjs, which holds a Lab build back from the release and Pages (LAB-PLAN 6.2).
//
//   node --test test/unit/web-lab.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { webBuilt } from '../helpers/web-built.mjs';
import { startFakeWorker, statusJson, hangingServer, deadAddress, goneWorker } from '../helpers/fake-worker.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';
import { codeWave, holdFor, releaseGate, readTree, w1Names, waveRank, COPIED, LAB_LIB } from '../../../web/scripts/lab-wave.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const WEB = path.join(here, '..', '..', '..', 'web');
const w = webBuilt();
const WL = await w.load('web-lab.js');
const WS = await w.load('web-storage.js');
const ds = await w.load('daylight-share.js');
const L = await w.load('daylight-lab.js');
const S = await w.load('daylight-server.js');
const VEC = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', 'server', 'vectors', 'server-vectors.json'), 'utf8'));
const quiet = { warn() {}, log() {} };
const MIN = 60000;

/**
 * fetch as the page sees it: the relay and the Daylight server (it answers any origin, DESIGN 10.2); ntfy.sh is out of
 * reach here. Every URL is logged. flags.route = {origin: the stand-in's URL} sends a workers.dev server to the stand-in.
 * flags.holdAnswer(url): a promise to wait for before an answer that has arrived reaches the page (a slow network), or
 * null.
 */
function pageFetch(relayUrl, log, flags) {
  const held = async (url, res) => { await flags.holdAnswer?.(url); return res; };
  return async (url, init) => {
    log.push(`${init?.method ?? 'GET'} ${url}`);
    const u = new URL(url);
    if (flags.relayDown && url.startsWith(relayUrl)) throw new TypeError('Failed to fetch');
    if (u.hostname === 'ntfy.sh') throw new TypeError('Failed to fetch');
    for (const [from, to] of Object.entries(flags.route ?? {})) if (url.startsWith(from)) return held(url, await fetch(to + url.slice(from.length), init));
    return held(url, await fetch(url, init));
  };
}

/**
 * The page's Lab with its storage, a Sender fed into the ledger (as app.js makes it) and pair(), which does what the
 * page's applyPairing does around a pairing change: lock a known server first, then the follow-up.
 */
async function setup({ paired = true, relayUrl = null, now, gateDeadlineMs, status } = {}) {
  const relay = await startMockRelay();
  const worker = await startFakeWorker({ status });
  const { storage } = await WS.openStorage();
  assert.equal(storage.kind, 'memory');
  const log = [];
  const flags = { relayDown: false, route: {} };
  const useRelay = relayUrl ?? relay.url;
  const fetchFn = pageFetch(useRelay, log, flags);
  let sender = null;
  const lab = WL.createWebLab({
    storage, fetch: fetchFn, now, log: quiet, getPairing: () => ds.loadPairing(storage).catch(() => null),
    getSettings: () => storage.get('settings'), deviceName: async () => 'Web test', appId: 'web/1.1.0',
    refreshAcks: async () => { if (sender) await sender.checkAcks(); }, ...(gateDeadlineMs ? { gateDeadlineMs } : {}),
  });
  await lab.ensureDefault();
  const secret = ds.generateSecret();
  const link = await ds.pairingLink({ secret, relay: useRelay, name: 'Lab Daylight' });
  async function pair(input, { relay: r } = {}) {
    const next = await ds.parsePairing(input);
    if (r) next.relay = r;
    const current = await ds.loadPairing(storage).catch(() => null);
    const repair = await lab.beforeRepair(current, next);
    await ds.applyPairingChange(storage, current, next);
    await ds.savePairing(storage, next);
    if (repair.known) await lab.afterRepair();
    const pairing = await ds.loadPairing(storage);
    sender = new ds.Sender({ pairing, storage, from: 'Web test', app: 'web/1.1.0', fetch: fetchFn, now, onAckHeader: lab.hook });
    return repair;
  }
  /** What the page's Unpair does (app.js onUnpair). */
  async function unpair() {
    const current = await ds.loadPairing(storage).catch(() => null);
    await lab.beforeUnpair(current);
    await ds.applyPairingChange(storage, current, null);
    await storage.remove('pairing');
    sender = null;
  }
  if (paired) await pair(link);
  return {
    relay, worker, lab, storage, log, flags, secret, link, pair, unpair, pairing: { secret, relay: useRelay },
    sender: () => sender,
    settings: () => storage.get('settings'),
    /** The worker as the typed Server address (2.6). */
    async useWorker() {
      worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(secret))).authToken;
      return lab.setServerAddress(worker.url);
    },
    close: async () => { await relay.close(); await worker.close(); },
  };
}

// --- the switch (1.2) and the test hook (1.7) -----------------------------------------------------------------------

test('Lab is on by default: the first start writes settings.lab = true, a stored value stays, pairing leaves it', async () => {
  const s = await setup({ paired: false });
  try {
    assert.deepEqual(await s.settings(), { lab: true });
    assert.equal(await s.lab.labOn(), true);
    assert.deepEqual(await s.lab.setLab(false), { lab: false });
    await s.lab.ensureDefault();
    assert.equal((await s.settings()).lab, false, 'a stored value stays');
    assert.equal(await s.lab.labOn(), false);
    await s.pair(s.link);
    assert.equal((await s.settings()).lab, false, 'pairing leaves it');
    await s.storage.set('settings', { from: 'Kept', comfort: true });
    assert.equal(await WL.labOn(s.storage), true, 'a missing key means on');
    await s.lab.setLab(true);
    assert.deepEqual(await s.settings(), { from: 'Kept', comfort: true, lab: true }, 'the switch writes only lab');
    assert.equal(WL.LAB_NOTE_ENABLED, false, 'no one-time note in Wave 0 (1.2)');
    assert.equal((await s.lab.state()).noteEnabled, false);
  } finally { await s.close(); }
});

test('the test hook ?lab=0|1 is honoured only on 127.0.0.1 (1.7), and leaves the address once applied', () => {
  assert.equal(WL.labTestHook({ hostname: '127.0.0.1', search: '?lab=0' }), false);
  assert.equal(WL.labTestHook({ hostname: '127.0.0.1', search: '?url=x&lab=1' }), true);
  assert.equal(WL.labTestHook({ hostname: '127.0.0.1', search: '?lab=yes' }), null);
  assert.equal(WL.labTestHook({ hostname: '127.0.0.1', search: '' }), null);
  for (const hostname of ['localhost', '12twelve12hi.github.io', '127.0.0.2', '[::1]']) {
    assert.equal(WL.labTestHook({ hostname, search: '?lab=0' }), null, hostname);
  }
  assert.equal(WL.withoutLabParam('http://127.0.0.1:8080/?lab=0'), '/');
  assert.equal(WL.withoutLabParam('http://127.0.0.1:8080/send/?url=https%3A%2F%2Fa.org&lab=1#pair=X'), '/send/?url=https%3A%2F%2Fa.org#pair=X');
});

test('Lab off: no discovery and no server call; the gate says how to turn it on; the screens have nothing to show', async () => {
  const s = await setup();
  try {
    await s.lab.setLab(false);
    s.log.length = 0;
    assert.deepEqual(await s.lab.state(), { lab: false, labNoteShown: false, noteEnabled: false, serverState: null, serverSubtitle: null });
    assert.deepEqual(await s.lab.overview(), { lab: false });
    assert.deepEqual(await s.lab.serverView(), { lab: false });
    assert.deepEqual(await s.lab.repaired(), { lab: false, repaired: null });
    const g = await s.lab.gate('F37');
    assert.deepEqual([g.ready, g.state, g.message], [false, 'lab-off', 'Turn on Lab in Send to Daylight to use this.']);
    assert.deepEqual(await s.lab.setServerAddress(s.worker.url), { error: 'Turn on Lab in Send to Daylight to use this.' });
    assert.deepEqual(await s.lab.checkSetupLink('https://daylight-0123456789ab.example.workers.dev/setup#SETUP-AAAA'), { error: 'Turn on Lab in Send to Daylight to use this.' });
    assert.deepEqual(s.log, [], 'nothing went on the network');
    assert.equal(s.worker.hits.length, 0);
  } finally { await s.close(); }
});

// --- What's in Lab and the gates (1.4, 1.5, F00.3, F00.6) ------------------------------------------------------------

test('What’s in Lab: the web lists the four server features (none of its own in Wave 0), under the server’s short state', async () => {
  assert.deepEqual(WL.LAB_FEATURES, []);
  assert.deepEqual(WL.LAB_SERVER_FEATURES, ['F02', 'F37', 'F19', 'F36']);
  assert.deepEqual(WL.LAB_SERVER_FEATURES, L.LAB_TEXT.serverFeatureOrder, 'in 1.4’s order, every one of them a web feature');
  assert.deepEqual(WL.BUILT_FEATURES, []);
  const s = await setup({ paired: false });
  try {
    let o = await s.lab.overview();
    assert.deepEqual(o.server.features.map((f) => [f.id, f.name, f.sentence, f.short]), WL.LAB_SERVER_FEATURES.map((id) => [id, L.LAB_TEXT.features[id].name, L.LAB_TEXT.features[id].sentence, null]));
    assert.deepEqual([o.header, o.fresh, o.server.state, o.server.short], ['Needs Lab on your Daylight', true, 'needs-pairing', 'Pair first']);
    assert.equal((await s.lab.state()).serverSubtitle, 'Optional · Pair first');
    await s.pair(s.link);
    // Without refresh nothing goes on the network and no short state is shown yet.
    s.log.length = 0;
    o = await s.lab.overview({ refresh: false });
    assert.deepEqual([o.fresh, o.server.short, o.server.features.map((f) => f.short)], [false, null, [null, null, null, null]]);
    assert.deepEqual(s.log, []);
    o = await s.lab.overview();
    assert.deepEqual([o.fresh, o.cached, o.server.state, o.server.short], [true, false, 'needs-server', 'Not set up']);
    assert.deepEqual(o.server.features.map((f) => f.short), [null, null, null, null], 'the rows don’t repeat the heading');
    assert.equal((await s.lab.state()).serverSubtitle, 'Optional · Not set up');
    // Opened again: the last answer at once, from storage (1.5), and nothing on the network.
    s.log.length = 0;
    o = await s.lab.overview({ refresh: false });
    assert.deepEqual([o.fresh, o.cached, o.server.state, o.server.short], [true, true, 'needs-server', 'Not set up']);
    assert.deepEqual(s.log, []);
    // An answer older than 10 minutes isn't used: no short states until the server answers.
    await s.storage.set(WL.SERVER_KEY, { state: 'needs-server', at: Date.now() - 11 * MIN });
    o = await s.lab.overview({ refresh: false });
    assert.deepEqual([o.fresh, o.cached, o.server.state, o.server.short], [false, false, null, null]);
  } finally { await s.close(); }
});

test('What’s in Lab: a ready server’s cached status gives each row its own short state without asking (1.5)', async () => {
  const s = await setup({ status: statusJson({ features: { ai: 'needs-key' } }) });
  try {
    await s.useWorker();
    let o = await s.lab.overview();
    assert.deepEqual([o.cached, o.server.state, o.server.short], [false, 'ready', 'Ready']);
    const live = o.server.features.map((f) => f.short);
    assert.ok(live.includes('Needs a Claude key'), live.join(', '));
    const asked = s.worker.count('GET /v1/status');
    s.log.length = 0;
    o = await s.lab.overview({ refresh: false });
    assert.deepEqual([o.fresh, o.cached, o.server.state], [true, true, 'ready']);
    assert.deepEqual(o.server.features.map((f) => f.short), live, 'the same rows from the cached status');
    assert.deepEqual([s.log, s.worker.count('GET /v1/status')], [[], asked], 'nothing went on the network');
  } finally { await s.close(); }
});

test('What’s in Lab opening reads the ack topic and asks the server at the same time, each within the 5 s', async () => {
  const hang = await hangingServer();
  const s = await setup({ relayUrl: hang.url, gateDeadlineMs: 400 });
  try {
    const t0 = Date.now();
    const o = await s.lab.overview();
    const took = Date.now() - t0;
    assert.deepEqual([o.fresh, o.cached, o.server.state, o.server.short], [true, false, 'OFFLINE', 'Can’t reach the server']);
    assert.ok(took >= 380 && took < 750, `one deadline, not two after each other (${took} ms)`);
  } finally { await s.close(); await hang.close(); }
});

test('the gate: needs-pairing, then needs-server with the Server code to copy, within 5 s (F00.3, F00.5, F00.6)', async () => {
  const s = await setup({ paired: false });
  try {
    let g = await s.lab.gate('F37');
    assert.deepEqual([g.state, g.message, g.short, g.button], ['needs-pairing', L.LAB_TEXT.needs['needs-pairing'], 'Pair first', null]);
    await s.pair(s.link);
    const t0 = Date.now();
    g = await s.lab.gate('F37');
    assert.ok(Date.now() - t0 < 5000);
    assert.deepEqual([g.state, g.message, g.short, g.button], ['needs-server', L.LAB_TEXT.needs['needs-server'], 'Needs your Daylight server', 'Copy Server code']);
    assert.equal(g.serverCode, await S.formatServerCode(await S.deriveServerSeed(s.secret), { relay: s.relay.url }));
    // The vector pairing (on ntfy.sh, out of reach here: OFFLINE) still has the vectors' Server code (F00.5).
    await s.pair(VEC.pairingCode);
    const v = await s.lab.serverView();
    assert.equal(v.serverCode, VEC.derived.serverCode);
    assert.equal(v.fingerprint, S.showFingerprint(VEC.derived.fingerprint));
    assert.deepEqual([v.state, v.message], ['OFFLINE', S.STATE_MESSAGES.OFFLINE]);
    g = await s.lab.gate('F02');
    assert.deepEqual([g.state, g.message], ['OFFLINE', S.STATE_MESSAGES.OFFLINE]);
  } finally { await s.close(); }
});

test('the gate offline: a refused connection is OFFLINE at once, a relay that never answers is OFFLINE at the deadline', async () => {
  const dead = await deadAddress();
  let s = await setup({ relayUrl: dead });
  try {
    const t0 = Date.now();
    const g = await s.lab.gate('F37');
    assert.deepEqual([g.state, g.message, g.short], ['OFFLINE', S.STATE_MESSAGES.OFFLINE, 'Can’t reach the server']);
    assert.ok(Date.now() - t0 < 3000);
  } finally { await s.close(); }
  const hang = await hangingServer();
  s = await setup({ relayUrl: hang.url, gateDeadlineMs: 400 });
  try {
    const t0 = Date.now();
    const g = await s.lab.gate('F19');
    const took = Date.now() - t0;
    assert.deepEqual([g.state, g.message], ['OFFLINE', S.STATE_MESSAGES.OFFLINE]);
    assert.ok(took >= 350 && took < 3000, `at the deadline (${took} ms)`);
    const st = await s.lab.state();
    assert.equal(st.serverSubtitle, 'Optional · Can’t reach the server');
  } finally { await s.close(); await hang.close(); }
});

test('the gate with a server: its states; ready but not built is `later`; the server section’s lines (F00.3, 2.6)', async () => {
  const s = await setup({ status: statusJson({ features: { ai: 'needs-key', email: 'needs-domain' }, lastSeen: new Date(Date.now() - 5 * MIN).toISOString(), usd: 0.227, limitUsd: 3 }) });
  try {
    const bad = await s.lab.setServerAddress('ftp://nope');
    assert.equal(bad.error, 'That isn’t a server address (https://…).');
    assert.deepEqual(await s.useWorker(), { manualUrl: s.worker.url });
    const later = await s.lab.gate('F02');
    assert.deepEqual([later.state, later.message, later.short], ['later', 'Your Daylight server is ready. Files over 9 MB comes to this app in a later Lab update.', 'In a later update']);
    const key = await s.lab.gate('F37');
    assert.deepEqual([key.state, key.message, key.short, key.button], ['needs-key', S.STATE_MESSAGES['needs-key'], 'Needs a Claude key', null]);
    assert.equal((await s.lab.gate('F19')).state, 'needs-domain');
    const o = await s.lab.overview();
    assert.deepEqual([o.server.state, o.server.short], ['ready', 'Ready']);
    assert.deepEqual(o.server.features.map((f) => f.short), ['In a later update', 'Needs a Claude key', 'Needs an email domain', 'In a later update']);
    assert.equal((await s.lab.state()).serverSubtitle, 'Optional · Ready');
    const v = await s.lab.serverView();
    assert.deepEqual([v.state, v.message, v.host, v.manualUrl, v.button, v.setupFirst], ['ready', 'Ready', 'localhost', s.worker.url, null, false]);
    assert.equal(v.labInbox, 'Lab Inbox last seen 5 min ago');
    assert.equal(v.aiToday, 'AI today: US$0.23 of US$3');
    assert.equal(v.rerun, S.RERUN_HELP);
    assert.match(v.serverCode, /^daylightserver:\/\/setup\?c=/, 'the link form on a relay other than ntfy.sh');
    // A server answers any origin (DESIGN 10.2): the page calls it itself, with the bearer token.
    assert.ok(s.log.some((l) => l === `GET ${s.worker.url}/v1/status`));
    assert.deepEqual(await s.lab.setServerAddress(''), { manualUrl: '' });
    assert.equal(await s.storage.get('server/manualUrl'), undefined);
  } finally { await s.close(); }
});

test('Set up with a link (2.6, DESIGN 3.5): read here first, sent only on Use it, then the server is pinned and ready', async () => {
  const s = await setup();
  const origin = 'https://daylight-0123456789ab.example.workers.dev';
  try {
    let v = await s.lab.serverView();
    assert.deepEqual([v.state, v.setupFirst], ['needs-server', true], 'its message says to paste a setup link');
    let r = await s.lab.checkSetupLink('not a link');
    await assert.rejects(S.parseSetupLink('not a link'), (e) => e.message === r.error);
    r = await s.lab.checkSetupLink(s.link);
    await assert.rejects(S.parseSetupLink(s.link), (e) => e.message === r.error && e.reason === 'pairing-code');
    const secret = Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3);
    const link = await S.formatSetupLink(origin, secret);
    r = await s.lab.checkSetupLink(link);
    assert.deepEqual(r, { server: origin, confirm: L.setupConfirmText(origin) });
    assert.equal(s.worker.count('POST /v1/setup'), 0, 'nothing sent before Use it');

    s.flags.route = { [origin]: s.worker.url };
    s.worker.state.setup = { token: 'another link', answer: {} };
    assert.deepEqual(await s.lab.setupServer(link), { error: S.errorMessage('SETUP_INVALID') });
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    s.worker.state.setup = { token: await S.deriveSetupToken(secret), answer: { server: origin, api: 1, fingerprint: values.fingerprint, delivery: 'lab' } };
    s.worker.state.token = values.authToken;
    assert.deepEqual(await s.lab.setupServer(link), { done: L.LAB_TEXT.serverSection.setupDone });
    assert.deepEqual(await s.storage.get('server/pin'), { origin, fingerprint: values.fingerprint });
    v = await s.lab.serverView();
    assert.deepEqual([v.state, v.host, v.setupFirst], ['ready', 'daylight-0123456789ab.example.workers.dev', false]);
  } finally { await s.close(); }
});

// --- the server moved (2.6, server DESIGN 4.3) -------------------------------------------------------------------------

const OLD = 'https://daylight-aaaaaaaaaaaa.example.workers.dev';
const MOVED = 'https://daylight-bbbbbbbbbbbb.example.workers.dev';

test('the server moved (2.6): the section asks “moved to {host}. Use it?”, also while the old address fails; Use it pins the new one', async () => {
  const s = await setup({ status: statusJson() });
  const dead = await deadAddress();
  try {
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    s.worker.state.token = values.authToken;
    // This pairing's server was pinned at OLD, whose Worker the deploy deleted when it made a new setup link (server
    // DESIGN 3.5); the new Worker announces itself at MOVED.
    s.flags.route = { [OLD]: dead, [MOVED]: s.worker.url };
    await s.storage.set('server/pin', { origin: OLD, fingerprint: values.fingerprint });
    await new ds.RelayClient({ relay: s.relay.url }).publish(values.configTopic, await S.buildConfigFrame(values, { server: MOVED }));
    let v = await s.lab.serverView();
    assert.deepEqual([v.state, v.host], ['OFFLINE', 'daylight-aaaaaaaaaaaa.example.workers.dev'], 'still on the old pin');
    assert.equal(v.moved, 'Your Daylight server moved to daylight-bbbbbbbbbbbb.example.workers.dev. Use it?');
    assert.equal(v.moved, L.serverMovedText(MOVED));
    assert.deepEqual(await s.storage.get('server/pendingMove'), { origin: MOVED, fingerprint: values.fingerprint });
    assert.equal(s.worker.count('GET /v1/status'), 0, 'nothing went to the new address before Use it');
    // Not answered (Cancel changes nothing): asked again the next time.
    assert.equal((await s.lab.serverView()).moved, L.serverMovedText(MOVED));

    // Use it: the module pins the new origin, and the server is ready there.
    assert.deepEqual(await s.lab.confirmMove(), { moved: true });
    assert.deepEqual(await s.storage.get('server/pin'), { origin: MOVED, fingerprint: values.fingerprint });
    assert.equal(await s.storage.get('server/pendingMove'), undefined);
    v = await s.lab.serverView();
    assert.deepEqual([v.state, v.host, v.moved], ['ready', 'daylight-bbbbbbbbbbbb.example.workers.dev', null]);
    assert.deepEqual(await s.lab.confirmMove(), { moved: false }, 'nothing left to confirm');
    // A typed Server address wins over discovery: no question then.
    await s.storage.set('server/pin', { origin: OLD, fingerprint: values.fingerprint });
    await s.useWorker();
    v = await s.lab.serverView();
    assert.deepEqual([v.state, v.moved], ['ready', null]);
    // Lab off: nothing to confirm.
    await s.lab.setLab(false);
    assert.deepEqual(await s.lab.confirmMove(), { moved: false });
  } finally { await s.close(); }
});

test('the server moved and the old address never answers: the question still shows when the 5 s run out', async () => {
  const hang = await hangingServer();
  const s = await setup({ gateDeadlineMs: 400 });
  try {
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    s.flags.route = { [OLD]: hang.url };
    await s.storage.set('server/pin', { origin: OLD, fingerprint: values.fingerprint });
    await new ds.RelayClient({ relay: s.relay.url }).publish(values.configTopic, await S.buildConfigFrame(values, { server: MOVED }));
    const v = await s.lab.serverView();
    assert.deepEqual([v.state, v.moved], ['OFFLINE', L.serverMovedText(MOVED)]);
    // Once the config names the pinned origin again, an old pendingMove asks nothing.
    await s.storage.set('server/config', { ...(await s.storage.get('server/config')), server: OLD });
    assert.equal((await s.lab.serverView()).moved, null);
  } finally { await s.close(); await hang.close(); }
});

test('the server moved while a fresh config is cached: opening What’s in Lab or the section reads the config topic now and asks (DESIGN 4.3, 2.6)', async () => {
  // The config read on the relay is kept for 6 hours (CONFIG_REFRESH_MS); a deploy with "New setup link" moves the
  // server well within them. Lab settings opening reads the config topic whatever the cached config's age.
  for (const was of ['deleted', 'refused']) {
    const gone = await goneWorker();
    const dead = await deadAddress();
    const s = await setup({ status: statusJson() });
    try {
      const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
      const relay = new ds.RelayClient({ relay: s.relay.url });
      const polls = () => s.log.filter((l) => l.includes(`/${values.configTopic}/json`)).length;
      s.worker.state.token = values.authToken;
      // Found at OLD on the relay and ready there: the config is cached, fresh, and pinned.
      s.flags.route = { [OLD]: s.worker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: OLD, sent: new Date(Date.now() - 2 * MIN).toISOString() }));
      let v = await s.lab.serverView();
      assert.deepEqual([v.state, v.host, v.moved], ['ready', 'daylight-aaaaaaaaaaaa.example.workers.dev', null]);
      assert.equal((await s.storage.get('server/config')).server, OLD);
      assert.ok(Date.now() - (await s.storage.get('server/configAt')) < S.CONFIG_REFRESH_MS, 'the cached config is fresh');

      // The deploy deleted the old Worker (workers.dev answers 404 with its own page), or its address refuses
      // connections; the new Worker announces itself at MOVED.
      s.flags.route = { [OLD]: was === 'deleted' ? gone.url : dead, [MOVED]: s.worker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: MOVED, sent: new Date(Date.now() - MIN).toISOString() }));
      const statusAsked = s.worker.count('GET /v1/status');
      let p = polls();
      const o = await s.lab.overview();
      assert.equal(polls(), p + 1, `${was}: What’s in Lab read the config topic`);
      assert.deepEqual(await s.storage.get('server/pendingMove'), { origin: MOVED, fingerprint: values.fingerprint });
      assert.equal(o.server.state, was === 'deleted' ? 'error' : 'ready');

      p = polls();
      v = await s.lab.serverView();
      assert.equal(polls(), p + 1, `${was}: the section read the config topic`);
      assert.equal(v.moved, L.serverMovedText(MOVED), `${was}: the section asks at once`);
      assert.equal(v.host, 'daylight-aaaaaaaaaaaa.example.workers.dev', 'still on the old pin until Use it');
      if (was === 'deleted') assert.deepEqual([v.state, v.message], ['error', S.errorMessage('SERVER_ERROR')]);
      else assert.equal(v.state, 'ready', 'a refused connection keeps the cached status (the module’s OFFLINE fallback)');
      assert.equal(s.worker.count('GET /v1/status'), statusAsked, 'nothing went to the new address before Use it');

      assert.deepEqual(await s.lab.confirmMove(), { moved: true });
      v = await s.lab.serverView();
      assert.deepEqual([v.state, v.host, v.moved], ['ready', 'daylight-bbbbbbbbbbbb.example.workers.dev', null]);
    } finally { await s.close(); await gone.close(); }
  }
});

test('a server feature tapped while a fresh config is cached: a failing server sends discovery back to the config topic (2.6)', async () => {
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
      s.flags.route = { [OLD]: s.worker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: OLD, sent: new Date(Date.now() - 2 * MIN).toISOString() }));
      assert.equal((await s.lab.serverView()).state, 'ready');

      s.flags.route = { [OLD]: answer === 'SERVER_ERROR' ? gone.url : other.url, [MOVED]: s.worker.url };
      await relay.publish(values.configTopic, await S.buildConfigFrame(values, { server: MOVED, sent: new Date(Date.now() - MIN).toISOString() }));
      t += 11 * MIN; // the status (10 minutes) is stale, the config (6 hours) fresh: the tap reads no config first
      let p = polls();
      let g = await s.lab.gate('F37');
      assert.deepEqual([g.ready, g.state, g.message], [false, 'error', S.errorMessage(answer)]);
      assert.equal(polls(), p + 1, `${answer}: the config topic was read once, after the server failed`);
      assert.deepEqual(await s.storage.get('server/pendingMove'), { origin: MOVED, fingerprint: values.fingerprint });

      // Tapped again: a server that keeps answering 401 costs no more relay polls (server/badAuthAt, the module's
      // episode); a server that is gone is looked for again.
      t += MIN;
      p = polls();
      g = await s.lab.gate('F37');
      assert.equal(g.state, 'error');
      assert.equal(polls(), p + (answer === 'BAD_AUTH' ? 0 : 1));

      const v = await s.lab.serverView();
      assert.deepEqual([v.state, v.moved], ['error', L.serverMovedText(MOVED)]);
      assert.equal(v.setupFirst, answer === 'BAD_AUTH', 'after a BAD_AUTH, Set up with a link comes first');
    } finally { await s.close(); await gone.close(); await other.close(); }
  }
});

test('Unpair forgets a typed Server address, so another Daylight’s pairing says pairing-mismatch, not BAD_AUTH (2.6)', async () => {
  const s = await setup({ status: statusJson() });
  const pinned = 'https://daylight-0123456789ab.example.workers.dev';
  try {
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    await s.useWorker();
    // The server was found on the relay once too: pinned for this pairing.
    await s.storage.set('server/pin', { origin: pinned, fingerprint: values.fingerprint });
    assert.equal((await s.lab.serverView()).state, 'ready');
    await s.unpair();
    assert.equal(await s.storage.get('server/manualUrl'), undefined, 'the typed address went with the pairing');
    assert.deepEqual(await s.storage.get('server/pin'), { origin: pinned, fingerprint: values.fingerprint }, 'the pin stays: it tells pairing-mismatch');
    assert.equal(s.worker.count('POST /v1/admin/lock'), 0, 'unpairing locks nothing: the same Daylight may come back');

    const statusCalls = s.worker.count('GET /v1/status');
    await s.pair(await ds.pairingLink({ secret: ds.generateSecret(), relay: s.relay.url }));
    const v = await s.lab.serverView();
    assert.deepEqual([v.state, v.message, v.manualUrl, v.setupFirst], ['pairing-mismatch', S.STATE_MESSAGES['pairing-mismatch'], '', true]);
    assert.equal(s.worker.count('GET /v1/status'), statusCalls, 'the old server wasn’t asked with the new pairing');
    assert.equal(await s.storage.get('server/badAuthAt'), undefined);
  } finally { await s.close(); }
});

// --- F17: the ledger ---------------------------------------------------------------------------------------------------

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
  return { pollOnce: () => { skew += MIN; return sim.pollOnce(); } };
}

test('F17: every ack-topic frame feeds the ledger, Lab on or off; What’s in Lab says what the Daylight said (F17.2)', async () => {
  const s = await setup();
  try {
    let o = await s.lab.overview({ refresh: false });
    assert.equal(o.header, 'Needs Lab on your Daylight', 'nothing heard yet');
    // A v1.1 Daylight: the row is Delivered ✓, the header says Lab isn't confirmed, with the check-in time.
    await s.sender().send({ kind: 'url', url: 'https://example.com/one', title: 'One' });
    await new ds.Receiver({ pairing: s.pairing, storage: new ds.MemoryStorage() }).pollOnce();
    o = await s.lab.overview();
    assert.equal(o.header, 'Needs Lab on your Daylight · checked in just now', 'opening What’s in Lab reads the ack topic');
    const rows = await s.storage.get('outbox');
    assert.equal(rows[0].status, 'delivered');
    assert.equal(ds.describeRow(rows[0], Date.now()).label, 'Delivered ✓', 'a v1.1 row stays a v1.1 row');

    // A Lab Daylight says hello and reports states.
    const day = await labDaylight(s.pairing);
    const two = await s.sender().send({ kind: 'url', url: 'https://example.com/two', title: 'Two' });
    assert.ok((await day.pollOnce()).lab, 'the Daylight published a Lab frame');
    o = await s.lab.overview();
    assert.equal(o.header, 'Your Daylight: Lab on · checked in just now');
    assert.equal((await s.lab.ledger.state(two.id))?.s, 'reader');
    assert.deepEqual(await s.lab.ledger.caps(), ['reader-link', 'st', 'tap']);

    // Lab off: the ledger keeps learning (1.3), through the page's ordinary ack checks.
    await s.lab.setLab(false);
    const three = await s.sender().send({ kind: 'url', url: 'https://example.com/three', title: 'Three' });
    await day.pollOnce();
    await s.sender().checkAcks();
    assert.equal((await s.lab.ledger.state(three.id))?.s, 'reader');

    // Pruned to the outbox's ids (the page prunes after each tick).
    await s.sender().remove(two.id);
    await s.lab.prune();
    assert.equal(await s.lab.ledger.state(two.id), null);
    assert.equal((await s.lab.ledger.state(three.id))?.s, 'reader');

    // Another Daylight: every lab/ key goes with the outbox (applyPairingChange, with the adapter's keys()).
    await s.lab.setLab(true);
    await s.lab.state();
    assert.ok(await s.storage.get(WL.SERVER_KEY), 'the server row’s last state is kept under lab/');
    await s.storage.set('lab/anything', 1);
    await s.pair(await ds.pairingLink({ secret: ds.generateSecret(), relay: s.relay.url }));
    assert.deepEqual((await s.storage.keys()).filter((k) => k.startsWith('lab/')), []);
    assert.equal((await s.settings()).lab, true, 'the switch stays');
    o = await s.lab.overview({ refresh: false });
    assert.equal(o.header, 'Needs Lab on your Daylight');
  } finally { await s.close(); }
});

test('F00.4: an item queued offline goes once back online with Lab off; pairing, history and the server pin stay', async () => {
  let clock = Date.now();
  const s = await setup({ now: () => clock });
  try {
    await s.storage.set('server/pin', { origin: 'https://daylight-0123456789ab.example.workers.dev', fingerprint: '0123abcd' });
    const old = await s.sender().send({ kind: 'url', url: 'https://example.com/kept', title: 'Kept' });
    s.flags.relayDown = true;
    const row = await s.sender().send({ kind: 'url', url: 'https://example.com/offline', title: 'Offline' });
    assert.deepEqual([row.status, row.errorCode], ['failed', 'network']);
    await s.lab.setLab(false);
    s.flags.relayDown = false;
    clock += 60 * MIN;
    const { maintain } = await w.load('logic.js');
    await maintain(s.sender(), clock);
    const rows = await s.storage.get('outbox');
    assert.equal(rows.find((r) => r.id === row.id).status, 'sent', 'sent once back online');
    assert.ok(rows.some((r) => r.id === old.id), 'history kept');
    assert.equal((await ds.loadPairing(s.storage)).secret.join(), s.secret.join(), 'pairing kept');
    assert.deepEqual(await s.storage.get('server/pin'), { origin: 'https://daylight-0123456789ab.example.workers.dev', fingerprint: '0123abcd' });
    const { items } = await new ds.Receiver({ pairing: s.pairing, storage: new ds.MemoryStorage() }).pollOnce();
    assert.ok(items.some((i) => i.header.id === row.id));
  } finally { await s.close(); }
});

// --- re-pairing (2.6) ----------------------------------------------------------------------------------------------------

test('re-pairing with another Daylight locks a server that knows the old pairing first, Lab on or off; the follow-up until OK', async () => {
  const s = await setup();
  try {
    await s.useWorker();
    await s.lab.setLab(false);
    // The same Daylight again (a rename): no lock, no follow-up.
    assert.deepEqual(await s.pair(s.link), { known: false, locked: false });
    assert.equal(s.worker.count('POST /v1/admin/lock'), 0);
    const next = ds.generateSecret();
    assert.deepEqual(await s.pair(await ds.pairingLink({ secret: next, relay: s.relay.url })), { known: true, locked: true });
    assert.equal(s.worker.count('POST /v1/admin/lock'), 1, 'locked with the old pairing’s token');
    assert.equal(await s.storage.get('server/manualUrl'), undefined, 'the old server’s typed address is forgotten');
    assert.deepEqual(await s.lab.repaired(), { lab: false, repaired: null }, 'Lab off: nothing to show (1.3)');
    assert.ok(await s.storage.get(WL.REPAIRED_KEY));
    await s.lab.setLab(true);
    assert.deepEqual((await s.lab.repaired()).repaired, {
      state: 'locked', message: S.STATE_MESSAGES.locked,
      serverCode: await S.formatServerCode(await S.deriveServerSeed(next), { relay: s.relay.url }), rerun: S.RERUN_HELP,
    });
    await s.lab.repairSeen();
    assert.deepEqual(await s.lab.repaired(), { lab: true, repaired: null });
  } finally { await s.close(); }
});

test('the follow-up shows when the lock didn’t reach the server too, and goes once the new server answers ready', async () => {
  const s = await setup();
  try {
    const values = await S.deriveServerValues(await S.deriveServerSeed(s.secret));
    await s.storage.set('server/pin', { origin: await deadAddress(), fingerprint: values.fingerprint });
    const next = ds.generateSecret();
    assert.deepEqual(await s.pair(await ds.pairingLink({ secret: next, relay: s.relay.url })), { known: true, locked: false });
    assert.equal((await s.lab.repaired()).repaired?.message, S.STATE_MESSAGES.locked);
    assert.equal((await s.lab.serverView()).state, 'pairing-mismatch', 'the old pin is an earlier pairing’s');
    assert.equal((await s.lab.serverView()).setupFirst, true);
    assert.ok((await s.lab.repaired()).repaired, 'still there');
    s.worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(next))).authToken;
    assert.deepEqual(await s.lab.setServerAddress(s.worker.url), { manualUrl: s.worker.url });
    assert.equal((await s.lab.serverView()).state, 'ready');
    assert.deepEqual(await s.lab.repaired(), { lab: true, repaired: null });
    assert.equal(await s.storage.get(WL.REPAIRED_KEY), undefined);
  } finally { await s.close(); }
});

/**
 * Holds the worker's next GET /v1/status answer once it has arrived: -> {reached (the check is waiting on it),
 * release()}.
 */
function holdStatus(s) {
  let release, asked;
  const answer = new Promise((r) => { release = r; });
  const reached = new Promise((r) => { asked = r; });
  s.flags.holdAnswer = (url) => {
    if (!url.startsWith(s.worker.url) || new URL(url).pathname !== '/v1/status') return null;
    s.flags.holdAnswer = null;
    asked();
    return answer;
  };
  return { reached, release };
}

test('a server check that outlives a pairing change keeps nothing: the follow-up and the row stay the new pairing’s (2.6)', async () => {
  const s = await setup();
  try {
    // Settings opened (a check starts), the old pairing's server answers ready, but slowly: meanwhile the user pairs
    // with another Daylight here, which locks that server and shows the follow-up.
    await s.useWorker();
    let hold = holdStatus(s);
    let check = s.lab.probe({ force: true });
    await hold.reached;
    const next = ds.generateSecret();
    assert.deepEqual(await s.pair(await ds.pairingLink({ secret: next, relay: s.relay.url })), { known: true, locked: true });
    hold.release();
    assert.equal((await check).state, 'ready', 'the old server did answer ready');
    assert.equal(await s.storage.get(WL.SERVER_KEY), undefined, 'not kept as the new pairing’s answer');
    assert.equal((await s.lab.repaired()).repaired?.message, S.STATE_MESSAGES.locked, 'the follow-up stays');
    assert.equal((await s.lab.state({ refresh: false })).serverSubtitle, null, 'the row doesn’t say Optional · Ready');

    // Another tab re-pairs while this tab's check runs: this tab's Lab hears of it only through the stored pairing.
    s.worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(next))).authToken;
    assert.deepEqual(await s.lab.setServerAddress(s.worker.url), { manualUrl: s.worker.url });
    hold = holdStatus(s);
    check = s.lab.probe({ force: true });
    await hold.reached;
    const current = await ds.loadPairing(s.storage);
    const third = await ds.parsePairing(await ds.pairingLink({ secret: ds.generateSecret(), relay: s.relay.url }));
    await ds.applyPairingChange(s.storage, current, third);
    await ds.savePairing(s.storage, third);
    await s.storage.set(WL.REPAIRED_KEY, { at: Date.now() });
    hold.release();
    assert.equal((await check).state, 'ready');
    assert.equal(await s.storage.get(WL.SERVER_KEY), undefined);
    assert.ok(await s.storage.get(WL.REPAIRED_KEY), 'the other tab’s follow-up stays');

    // A check of the pairing in use is kept as before, and its ready answer ends the follow-up.
    s.worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(third.secret))).authToken;
    await s.lab.setServerAddress(s.worker.url);
    assert.equal((await s.lab.probe({ force: true })).state, 'ready');
    assert.equal((await s.storage.get(WL.SERVER_KEY))?.state, 'ready');
    assert.equal(await s.storage.get(WL.REPAIRED_KEY), undefined);
  } finally { await s.close(); }
});

// --- the page: its build, its words, its storage -----------------------------------------------------------------------

test('the build copies the Lab modules from their one source, and the service worker keeps every module offline', () => {
  const same = (name, src) => assert.ok(fs.readFileSync(path.join(w.dir, name)).equals(fs.readFileSync(src)), name);
  same('daylight-lab.js', LAB_LIB);
  same('lab-ui.js', COPIED['lab-ui.js']);
  same('logic.js', COPIED['logic.js']);
  const server = fs.readFileSync(path.join(w.dir, 'daylight-server.js'), 'utf8');
  const src = fs.readFileSync(path.join(WEB, '..', 'server', 'client', 'daylight-server.js'), 'utf8');
  assert.equal(server, src.replace("from '../../share/js/daylight-share.js';", "from './daylight-share.js';"), 'only its import changes');
  const sw = fs.readFileSync(path.join(w.dir, 'sw.js'), 'utf8');
  const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]+\])/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  for (const f of fs.readdirSync(w.dir).filter((f) => f.endsWith('.js') && f !== 'sw.js')) assert.ok(shell.includes(f), `sw.js keeps ${f} for offline use`);
});

test('the page’s Lab words are LAB_TEXT’s (1.6)', () => {
  const html = fs.readFileSync(path.join(w.dir, 'index.html'), 'utf8');
  assert.equal(/<label for="lab" class="switch-label">([^<]*)<\/label>/.exec(html)?.[1], L.LAB_TEXT.lab);
  assert.equal(/<p id="lab-footer"[^>]*>([^<]*)<\/p>/.exec(html)?.[1], L.LAB_TEXT.switchFooter);
  assert.match(html, /<input id="lab" class="switch" type="checkbox" role="switch" aria-describedby="lab-footer">/);
  assert.equal(/id="open-whats-in-lab"[^>]*><span class="nav-text"><span class="nav-label">([^<]*)</.exec(html)?.[1], L.LAB_TEXT.whatsInLab);
  assert.equal(/id="open-server"[^>]*><span class="nav-text"><span class="nav-label">([^<]*)</.exec(html)?.[1], L.LAB_TEXT.serverRow);
  assert.equal(/<h2 id="whats-h">([^<]*)<\/h2>/.exec(html)[1], L.LAB_TEXT.whatsInLab);
  // The server section's heading takes the focus after the move question's Use it (tabindex -1).
  assert.equal(/<h2 id="server-h" tabindex="-1">([^<]*)<\/h2>/.exec(html)[1], L.LAB_TEXT.serverRow);
  // Settings starts with Lab, then Comfort (1.1).
  assert.ok(html.indexOf('id="lab-row"') < html.indexOf('id="comfort"'));
  assert.ok(html.indexOf('<h2>Settings</h2>') < html.indexOf('id="lab-row"'));
});

test('the page’s storage lists its keys, so a pairing change can remove every lab/ key (2.2.6)', async () => {
  const m = (await WS.openStorage()).storage;
  await m.set('lab/repaired', { at: 1 });
  await m.set('outbox', []);
  assert.deepEqual((await m.keys()).sort(), ['lab/repaired', 'outbox']);
  // localStorage, as a browser without IndexedDB has it.
  const store = new Map();
  globalThis.localStorage = {
    get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
  };
  try {
    store.set('someone-else', '1');
    const a = WS.localStorageAdapter();
    await a.set('lab/server', { state: 'ready', at: 1 });
    await a.set('pairing', { code: 'X' });
    assert.deepEqual((await a.keys()).sort(), ['lab/server', 'pairing']);
    await ds.applyPairingChange(a, { secret: new Uint8Array(16) }, { secret: new Uint8Array(16).fill(1) });
    assert.deepEqual((await a.keys()).sort(), ['pairing']);
  } finally { delete globalThis.localStorage; }
});

// --- the release gate (LAB-PLAN 6.2) ---------------------------------------------------------------------------------------

test('web/scripts/lab-wave.mjs reads the Lab wave from the code: W0 now, W1 for W1 code, can’t tell for a later wave', () => {
  const w1 = w1Names(fs.readFileSync(LAB_LIB, 'utf8'));
  const tree = readTree();
  assert.deepEqual(codeWave(tree, { w1 }).wave, 'w0', 'B0 is Wave 0');
  assert.ok(codeWave(tree, { w1 }).why.includes('web-lab.js'));
  assert.deepEqual(codeWave([{ name: 'app.js', text: 'import x from "./logic.js";' }], { w1 }), { wave: null, why: [] });
  const with1 = (name, text) => codeWave([...tree.filter((f) => f.name !== name), { name, text: `${tree.find((f) => f.name === name)?.text ?? ''}\n${text}` }], { w1 }).wave;
  // B1 lists a feature, turns the note on, or uses W1 code, and leaves lab-wave.json at w0: held for w1 all the same.
  assert.equal(with1('web-lab.js', "export const LAB_FEATURES = ['F07'];"), 'w1');
  assert.equal(with1('web-lab.js', 'export const LAB_NOTE_ENABLED = true;'), 'w1');
  assert.equal(with1('app.js', 'const d = describeLabRow(row, now, ctx);'), 'w1');
  assert.equal(with1('app.js', 'await sender.send(item, { defer: true });'), 'w1');
  assert.equal(with1('app.js', `const u = ${w1[0]};`), 'w1');
  // The extension's copied files ship here too: W1 code in lab-ui.js holds this build.
  assert.equal(with1('lab-ui.js', "if (f.id === 'F34') return;"), 'w1');
  assert.throws(() => with1('web-lab.js', "const X = 'F06';"), /later wave/);
  assert.throws(() => w1Names('export const A = 1;'), /W1 \(L1\)/);
  assert.equal(waveRank(null), -1);
  assert.throws(() => waveRank('wave1'), /not a Lab wave/);
});

test('web/lab-wave.json names the code’s wave (not behind it), and the publish and Pages jobs hold a Lab build by it', () => {
  const gate = JSON.parse(fs.readFileSync(path.join(WEB, '..', 'lab-release-gate.json'), 'utf8'));
  const { wave } = JSON.parse(fs.readFileSync(path.join(WEB, 'lab-wave.json'), 'utf8'));
  assert.equal(wave, 'w0', 'the web sender has Lab code from B0 on');
  assert.equal(typeof gate[wave], 'boolean');
  const { declared, code, own, hold, why } = holdFor();
  assert.ok(waveRank(declared) >= waveRank(own), `web/lab-wave.json says ${declared}, but this folder's code is ${own} (${why.join('; ')})`);
  assert.equal(hold, waveRank(code) > waveRank(declared) ? code : declared, 'held for the later of the two');
  assert.ok(waveRank(hold) >= waveRank('w0'));
  assert.deepEqual(releaseGate().open, gate[hold] === true);
  // A gate file with the wave open lets it through; closed holds it.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-gate-'));
  for (const open of [false, true]) {
    const g = path.join(tmp, `gate-${open}.json`);
    fs.writeFileSync(g, JSON.stringify({ w0: open, w1: open }));
    assert.deepEqual(releaseGate({ gate: g }), { hold, open, why });
  }
  // Extension code the build copies holds the build for its wave too, without failing this folder's --check.
  const copied = path.join(tmp, 'lab-ui.js');
  fs.writeFileSync(copied, `${fs.readFileSync(COPIED['lab-ui.js'], 'utf8')}\nconst LIST = ['F34'];\n`);
  const h = holdFor(WEB, LAB_LIB, { ...COPIED, 'lab-ui.js': copied });
  assert.deepEqual([h.code, h.own, h.hold], ['w1', 'w0', 'w1']);
  // The publish job (ext lane) holds send-to-daylight-web.zip by this script; the Pages job (web lane) holds the deploy
  // by it too, and both say why in the log.
  const wf = fs.readFileSync(path.join(WEB, '..', '..', '.github', 'workflows', 'rx-extension.yml'), 'utf8');
  const publish = wf.slice(wf.indexOf('\n  publish:'), wf.indexOf('\n  pages:'));
  assert.match(publish, /node "\$1\/scripts\/lab-wave\.mjs"/);
  assert.match(publish, /check "Web sender" reader-experiment\/web out\/send-to-daylight-web\.zip/);
  const pages = wf.slice(wf.indexOf('\n  pages:'));
  assert.match(pages, /set -euo pipefail/);
  assert.match(pages, /node reader-experiment\/web\/scripts\/lab-wave\.mjs/);
  assert.match(pages, /::notice title=Lab release gate::Web sender: NOT deploying to Pages/);
  const web = wf.slice(wf.indexOf('\n  web:'), wf.indexOf('\n  # lane: ext (shared'));
  assert.match(web, /node \.\.\/web\/scripts\/lab-wave\.mjs --check/);
});
