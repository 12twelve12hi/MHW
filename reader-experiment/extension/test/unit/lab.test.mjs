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
import { startFakeWorker, statusJson, hangingServer, deadAddress } from '../helpers/fake-worker.mjs';
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
    // W0 shows no one-time note (1.2: only from a build with F01 or F04).
    assert.equal(labMod.LAB_NOTE_ENABLED, false);
    const st = await s.msg({ type: 'labState' });
    assert.equal(st.lab, true);
    assert.equal(st.noteEnabled, false);
  } finally { await s.close(); }
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

test('What’s in Lab: Chrome lists the four server features and Safari one, under the server’s short state', async () => {
  for (const target of ['chrome', 'safari']) {
    const s = await setup({ target, paired: false });
    try {
      let o = await s.msg({ type: 'labOverview' });
      const ids = target === 'chrome' ? ['F02', 'F37', 'F19', 'F36'] : ['F37'];
      assert.deepEqual(o.features, [], 'W0: no Lab feature of its own yet');
      assert.deepEqual(o.server.features.map((f) => f.id), ids);
      assert.deepEqual(o.server.features.map((f) => [f.name, f.sentence]), ids.map((id) => [L.LAB_TEXT.features[id].name, L.LAB_TEXT.features[id].sentence]));
      assert.equal(o.header, 'Needs Lab on your Daylight', 'never heard from the Daylight (F17.2)');
      assert.deepEqual([o.server.state, o.server.short], ['needs-pairing', 'Pair first']);
      assert.ok(o.server.features.every((f) => f.short === null), 'a row repeats no short state of the heading');

      await s.app.pair({ input: s.link });
      o = await s.msg({ type: 'labOverview' });
      assert.deepEqual([o.server.state, o.server.short], ['needs-server', 'Not set up']);
      assert.ok(o.server.features.every((f) => f.short === null));
      const cached = await s.msg({ type: 'labOverview', refresh: false });
      assert.equal(cached.fresh, false);
      assert.ok(cached.server.features.every((f) => f.short === null));
    } finally { await s.close(); }
  }
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
    assert.deepEqual([v.state, v.message, v.host, v.manualUrl], ['ready', 'Ready', 'localhost', s.worker.url]);
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
    assert.equal(v.host, 'daylight-0123456789ab.example.workers.dev');
    assert.equal(v.v1Notice, S.noticeText('v1'));
    assert.deepEqual(await s.storage('server/pin'), { origin, fingerprint: values.fingerprint }, 'the module pinned it');
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
    // The same Daylight again (a rename): no lock.
    await s.app.pair({ input: s.link, from: 'Renamed' });
    assert.equal(s.worker.count('POST /v1/admin/lock'), 0);
    const r = await s.app.pair({ input: await ds.pairingLink({ secret: ds.generateSecret(), relay: s.relay.url }) });
    assert.ok(r.needsConfirm, 'another Daylight asks first');
    assert.equal(s.worker.count('POST /v1/admin/lock'), 0, 'nothing before the answer');
    await s.app.pair({ input: await ds.pairingLink({ secret: ds.generateSecret(), relay: s.relay.url }), confirm: true });
    assert.equal(s.worker.count('POST /v1/admin/lock'), 1, 'locked with the old pairing’s token');
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
  assert.equal(/<h2 id="server-h">([^<]*)<\/h2>/.exec(lab)[1], L.LAB_TEXT.serverRow);
});
