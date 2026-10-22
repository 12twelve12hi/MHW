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
import { startFakeWorker, statusJson, hangingServer, deadAddress } from '../helpers/fake-worker.mjs';
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
 */
function pageFetch(relayUrl, log, flags) {
  return async (url, init) => {
    log.push(`${init?.method ?? 'GET'} ${url}`);
    const u = new URL(url);
    if (flags.relayDown && url.startsWith(relayUrl)) throw new TypeError('Failed to fetch');
    if (u.hostname === 'ntfy.sh') throw new TypeError('Failed to fetch');
    for (const [from, to] of Object.entries(flags.route ?? {})) if (url.startsWith(from)) return fetch(to + url.slice(from.length), init);
    return fetch(url, init);
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
  if (paired) await pair(link);
  return {
    relay, worker, lab, storage, log, flags, secret, link, pair, pairing: { secret, relay: useRelay },
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
    assert.deepEqual([o.server.state, o.server.short], ['needs-server', 'Not set up']);
    assert.deepEqual(o.server.features.map((f) => f.short), [null, null, null, null], 'the rows don’t repeat the heading');
    assert.equal((await s.lab.state()).serverSubtitle, 'Optional · Not set up');
  } finally { await s.close(); }
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
  assert.equal(/<h2 id="server-h">([^<]*)<\/h2>/.exec(html)[1], L.LAB_TEXT.serverRow);
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
  const { declared, code, hold, why } = holdFor();
  assert.ok(waveRank(declared) >= waveRank(code), `web/lab-wave.json says ${declared}, but the code is ${code} (${why.join('; ')})`);
  assert.equal(hold, 'w0');
  assert.deepEqual(releaseGate().open, gate.w0 === true);
  // A gate file with w0 open lets it through; closed holds it.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-gate-'));
  for (const open of [false, true]) {
    const g = path.join(tmp, `gate-${open}.json`);
    fs.writeFileSync(g, JSON.stringify({ w0: open, w1: false }));
    assert.deepEqual(releaseGate({ gate: g }), { hold: 'w0', open, why });
  }
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
