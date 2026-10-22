// server-vectors.json (DESIGN.md 13.4): up to date, and every case holds — derived values, Server code parsing, frames
// and their AADs, the negative vectors, public URLs, and the hosted frames through the protocol's v1 Receiver with
// Attach: messages on the mock relay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ds from '../../share/js/daylight-share.js';
import * as srv from '../client/daylight-server.js';
import { generate } from '../vectors/generate.mjs';
import { startRelay, RELAY_ORIGIN } from './relay.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V = JSON.parse(fs.readFileSync(path.join(root, 'vectors', 'server-vectors.json'), 'utf8'));
const secret = ds.fromHex(V.secretHex);

test('server-vectors.json is up to date (run node vectors/generate.mjs)', async () => {
  assert.deepEqual(await generate(), V);
});

test('derived values', async () => {
  const seed = await srv.deriveServerSeed(secret);
  assert.equal(ds.toHex(seed), V.derived.seedHex);
  const v = await srv.deriveServerValues(seed);
  for (const k of ['authToken', 'configTopic', 'itemTopic', 'ackTopic', 'emailToken', 'fingerprint', 'workerName']) assert.equal(v[k], V.derived[k], k);
  assert.equal((await srv.deriveServerValues(seed, { emailSalt: V.derived.emailTokenWithSalt.salt })).emailToken, V.derived.emailTokenWithSalt.emailToken);
  assert.equal(await srv.formatServerCode(seed), V.derived.serverCode);
  for (const { origin, id } of V.derived.serverItemIds) assert.equal(await srv.serverItemId(seed, origin), id);
});

test('Server code parsing', async () => {
  for (const c of V.serverCodeParsing) {
    if (c.error) {
      await assert.rejects(srv.parseServerCode(c.input), (e) => e.code === 'server-code' && e.reason === c.error, c.input);
    } else {
      const p = await srv.parseServerCode(c.input);
      assert.equal(ds.toHex(p.seed), c.seedHex);
      if (c.relay) assert.equal(p.relay, c.relay);
      if (c.token) assert.equal(p.token, c.token);
    }
  }
});

test('frames open under their own AAD only; the negative vectors fail', async () => {
  const values = await srv.deriveServerValues(await srv.deriveServerSeed(secret));
  const keys = await ds.deriveKeys(secret);
  const aadName = (aad) => aad.split('-').pop();
  for (const name of ['config', 'hello', 'ack']) {
    const f = V.frames[name];
    const { header } = await srv.openBox(values, aadName(f.aad), ds.fromBase64(f.frameBase64));
    assert.deepEqual(header, f.header, name);
    const resealed = await srv.sealBox(values, aadName(f.aad), f.header, new Uint8Array(0), ds.fromHex(f.nonceHex));
    assert.equal(ds.toBase64(resealed), f.frameBase64, `${name} reseals identically`);
  }
  const r = new ds.Reassembler();
  let done = null;
  for (const p of V.frames.item.parts) {
    const o = await srv.openBox(values, 'item', ds.fromBase64(p.frameBase64));
    assert.deepEqual(o.header, p.header);
    done = (await r.add(o.header, o.body)) ?? done;
  }
  assert.equal(ds.toBase64(done.content), V.frames.item.contentBase64);
  const frameOf = (n) => (n.frameBase64 ? ds.fromBase64(n.frameBase64) : ds.fromBase64((V.frames[n.frame].parts?.[0] ?? V.frames[n.frame]).frameBase64));
  for (const n of V.negative) {
    const [kind, purpose] = n.openWith.split(':');
    const open = kind === 'box' ? srv.openBox(values, purpose, frameOf(n)) : ds.decryptFrame(keys, purpose, frameOf(n));
    await assert.rejects(open, (e) => e.code === n.expect, JSON.stringify(n));
  }
});

test('publicUrl', () => {
  for (const { input, output } of V.publicUrl.accepted) assert.equal(srv.publicUrl(input), output, input);
  for (const input of V.publicUrl.refused) assert.equal(srv.publicUrl(input), null, input);
});

test('hosted frames: a v1 Receiver gets the item from Attach: messages and acks it', async () => {
  const relay = await startRelay();
  try {
    const keys = await ds.deriveKeys(secret);
    const files = new Map(V.hosted.parts.map((p, i) => [`https://files.example/f/x/${i}`, ds.fromBase64(p.frameBase64)]));
    const fetchFn = async (url, init) => {
      const u = new URL(url);
      if (u.origin === RELAY_ORIGIN) return relay.handle(url, init);
      const f = files.get(url);
      return f ? new Response(f) : new Response('no', { status: 404 });
    };
    for (const url of files.keys()) {
      const r = await relay.handle(`${RELAY_ORIGIN}/${keys.inboxTopic}`, { method: 'POST', headers: { Attach: url, Filename: 'dls1.bin', Firebase: 'no', Cache: 'yes' }, body: 'dls1' });
      assert.equal(r.status, 200);
    }
    const receiver = new ds.Receiver({ pairing: { secret, relay: RELAY_ORIGIN }, storage: new ds.MemoryStorage(), fetch: fetchFn, retryDelaysMs: [0, 0, 0] });
    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 1, V.hosted.expect);
    const item = got.items[0];
    assert.equal(item.header.id, V.hosted.itemId);
    assert.equal(item.header.name, V.hosted.name);
    assert.equal(ds.toHex(await ds.sha256(item.content)), V.hosted.sha256);
    assert.deepEqual(got.acked, [V.hosted.itemId]);
  } finally { await relay.close(); }
});

// ---- serverState (LAB-PLAN 2.6): the cases Swift and Kotlin must map the same way, checked here through a real client.

const SS = V.serverState;
const ORIGIN = 'https://daylight-6c1f0e9a2b44.example.workers.dev';
const NOW = Date.parse('2026-10-20T06:00:00.000Z');
const READY_STATUS = SS.fromStatus[0].status;

/** A client with a manual server address and a fresh cached status in which every feature is ready. */
async function cachedClient(respond, { status = READY_STATUS } = {}) {
  const storage = new ds.MemoryStorage();
  await storage.set('server/manualUrl', ORIGIN);
  await storage.set('server/configAt', NOW - 60_000);
  if (status) { await storage.set('server/status', status); await storage.set('server/statusAt', NOW - 60_000); }
  const requests = [];
  const fetchFn = async (url, init) => { requests.push(String(url)); return respond(url, init); };
  return { storage, requests, client: new srv.DaylightServer({ pairing: { secret, relay: ds.DEFAULT_RELAY }, storage, fetch: fetchFn, now: () => NOW }) };
}

test('serverState › states: a closed set that every case stays in', () => {
  assert.equal(SS.now, NOW);
  assert.deepEqual(SS.states, srv.SERVER_STATES);
  assert.deepEqual([...SS.states].sort(), ['OFFLINE', 'app-outdated', 'error', 'locked', 'needs-domain', 'needs-key', 'needs-lab-inbox',
    'needs-paid', 'needs-r2', 'needs-server', 'pairing-mismatch', 'ready', 'server-outdated']);
  for (const c of [...SS.fromStatus, ...SS.fromError]) assert.ok(SS.states.includes(c.expect.state), `${c.name}: ${c.expect.state}`);
  // The status path gives the module's text for every state but error, whatever the server sent.
  for (const c of SS.fromStatus) {
    if (c.expect.state === 'ready') assert.equal(c.expect.message, null, c.name);
    else if (c.expect.state !== 'error') assert.equal(c.expect.message, srv.STATE_MESSAGES[c.expect.state], c.name);
  }
  // No state the app decides comes from the status, and no unknown state passes through.
  const fromStatusStates = new Set(SS.fromStatus.map((c) => c.expect.state));
  for (const s of ['needs-server', 'pairing-mismatch', 'server-outdated', 'app-outdated', 'OFFLINE']) assert.ok(!fromStatusStates.has(s), s);
  for (const s of ['needs-server', 'pairing-mismatch', 'server-outdated', 'app-outdated', 'OFFLINE', 'needs-pairing', 'later', 'needs-dns']) {
    assert.ok(SS.fromStatus.some((c) => c.status.features?.[c.feature]?.state === s && c.expect.state === 'error'), `a case for ${s} in the status`);
  }
});

test('serverState › fromError: the codes request() reads', () => {
  const read = (n) => SS.fromError.find((c) => c.name === n);
  assert.equal(read('500 whose code is OFFLINE, a state the app decides, is not read: SERVER_ERROR').error.code, 'SERVER_ERROR');
  assert.equal(read('401 whose code is OFFLINE is not read: BAD_AUTH').error.code, 'BAD_AUTH');
  assert.equal(read('a code of 40 characters is read: an unknown code').error.code.length, 40);
  assert.equal(read('a code of 41 characters is not read').error.code, 'SERVER_ERROR');
  for (const c of SS.fromError) {
    if (!c.response) continue;
    let code = null;
    try { code = JSON.parse(c.response.body)?.error?.code; } catch { /* not JSON */ }
    const readable = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(code) && code !== 'OFFLINE';
    assert.equal(srv.isServerCode(code), readable, c.name);
    assert.equal(c.error.code, readable ? code : c.response.status === 401 ? 'BAD_AUTH' : 'SERVER_ERROR', c.name);
  }
  for (const code of ['OFFLINE', 'needs-server', 'pairing-mismatch', 'server-outdated', 'app-outdated', '', 'A'.repeat(41), 'NEEDS-KEY', 42, null]) {
    assert.equal(srv.isServerCode(code), false, String(code));
  }
  for (const code of ['A', 'NEEDS_KEY', 'LOCKED', 'A'.repeat(40), 'X9_']) assert.equal(srv.isServerCode(code), true, code);
});

test('serverState › fromStatus: a status body and a feature -> {state, message}', async () => {
  assert.ok(SS.fromStatus.length >= 15);
  for (const c of SS.fromStatus) {
    assert.deepEqual(srv.stateFromStatus(c.status, c.feature), c.expect, c.name);
    // state() answers the same from a fresh cached status, without a request.
    const { client, requests } = await cachedClient(() => { throw new Error('no request expected'); }, { status: c.status });
    assert.deepEqual(await client.state(c.feature), c.expect, `state(): ${c.name}`);
    assert.deepEqual(requests, []);
  }
});

test('serverState › fromError: the answer to a call -> the client’s error -> {state, message}', async () => {
  assert.ok(SS.fromError.length >= 25);
  const states = new Set(SS.fromError.map((c) => c.expect.state));
  for (const s of ['needs-key', 'needs-domain', 'needs-r2', 'needs-server', 'needs-lab-inbox', 'locked', 'error', 'OFFLINE', 'pairing-mismatch', 'server-outdated', 'app-outdated']) {
    assert.ok(states.has(s), `a case for ${s}`);
  }
  for (const c of SS.fromError) {
    let err;
    if (c.response || c.network) {
      const { client } = await cachedClient(async () => {
        if (c.network) throw new TypeError('Failed to fetch');
        return new Response(c.response.body, { status: c.response.status });
      });
      await assert.rejects(client.request('POST', '/v1/ai', { json: {} }), (e) => { err = e; return true; });
      assert.ok(err instanceof srv.ServerError, c.name);
      assert.equal(err.code, c.error.code, c.name);
      assert.equal(err.status, c.error.status, c.name);
      for (const k of ['feature', 'missing', 'retryAfter', 'limit', 'resetAt']) assert.deepEqual(err[k], c.error[k], `${c.name}: ${k}`);
    } else {
      err = new srv.ServerError(c.error.code, c.local ? { message: srv.localMessage(c.local) } : {});
    }
    assert.deepEqual(srv.stateFromError(err), c.expect, c.name);
    assert.deepEqual(srv.stateFromError({ ...c.error, message: err.message }), c.expect, `${c.name} (plain error object)`);
  }
});

test('serverState › fromError: the app-decided states come out of state() exactly so', async () => {
  const values = await srv.deriveServerValues(await srv.deriveServerSeed(secret));
  const empty = async () => new Response('');
  const scenarios = {
    'needs-server': async (st) => {},
    'pairing-mismatch': async (st) => st.set('server/pin', { origin: 'https://old.example', fingerprint: '00000000' }),
    'server-outdated': async (st) => { await st.set('server/config', { server: ORIGIN, api: 0, fingerprint: values.fingerprint, delivery: 'lab' }); await st.set('server/configAt', NOW); },
    'app-outdated': async (st) => { await st.set('server/config', { server: ORIGIN, api: srv.SERVER_API + 1, fingerprint: values.fingerprint, delivery: 'lab' }); await st.set('server/configAt', NOW); },
  };
  for (const c of SS.fromError.filter((x) => x.local)) {
    const storage = new ds.MemoryStorage();
    await scenarios[c.local](storage);
    const client = new srv.DaylightServer({ pairing: { secret, relay: ds.DEFAULT_RELAY }, storage, fetch: empty, now: () => NOW });
    assert.deepEqual(await client.state(c.feature), c.expect, c.name);
  }
  const net = SS.fromError.find((x) => x.network);
  const { client } = await cachedClient(async () => { throw new TypeError('offline'); }, { status: null });
  assert.deepEqual(await client.state(net.feature), net.expect, 'no network and no cached status: OFFLINE');
});

test('serverState › fromError › noteError: what it does to the cached status', async () => {
  const effects = new Set(SS.fromError.map((c) => c.noteError.cache));
  assert.deepEqual([...effects].sort(), ['dropped', 'kept', 'updated']);
  assert.ok(SS.fromError.some((c) => c.before?.['server/badAuthAt'] !== undefined && c.noteError.configRefresh === false), 'a second BAD_AUTH');
  for (const c of SS.fromError) {
    const { client, storage, requests } = await cachedClient(async () => { throw new TypeError('offline'); });
    for (const [k, v] of Object.entries(c.before ?? {})) await storage.set(k, v);
    const err = new srv.ServerError(c.error.code, { ...c.error, message: c.expect.state === 'error' ? c.expect.message : undefined });
    assert.deepEqual(await client.noteError(c.feature, err), c.expect, c.name);
    assert.deepEqual(requests, [], `${c.name}: noteError makes no request`);
    const status = await storage.get('server/status');
    const statusAt = await storage.get('server/statusAt');
    const configAt = await storage.get('server/configAt');
    switch (c.noteError.cache) {
      case 'kept':
        assert.deepEqual(status, READY_STATUS, c.name);
        assert.equal(statusAt, NOW - 60_000, c.name);
        assert.deepEqual(await client.state(c.feature), { state: 'ready', message: null }, `${c.name}: the feature stays ready`);
        break;
      case 'updated': {
        const f = c.noteError.feature;
        assert.deepEqual(status.features[f], c.expect, c.name);
        for (const k of Object.keys(READY_STATUS.features)) if (k !== f) assert.deepEqual(status.features[k], READY_STATUS.features[k], `${c.name}: ${k} untouched`);
        assert.equal(statusAt, undefined, `${c.name}: marked for refresh`);
        assert.equal(c.noteError.refresh, true);
        assert.deepEqual(await client.state(f), c.expect, `${c.name}: offline, the next state() falls back to the noted state`);
        assert.ok(requests.some((u) => u.endsWith('/v1/status')), `${c.name}: the next state() asked the server first`);
        break;
      }
      case 'dropped':
        assert.equal(status, undefined, c.name);
        assert.equal(statusAt, undefined, c.name);
        assert.equal(configAt === undefined, c.noteError.configRefresh, `${c.name}: configAt`);
        assert.equal((await storage.get('server/badAuthAt')) ?? null, c.noteError.badAuthAt, `${c.name}: badAuthAt`);
        assert.equal(c.noteError.configRefresh, c.error.code === 'BAD_AUTH' && c.before?.['server/badAuthAt'] === undefined, c.name);
        break;
      default: assert.fail(c.noteError.cache);
    }
  }
});

test('setupLinks: the link format, its token and parsing (3.5)', async () => {
  const L = V.setupLinks;
  const secret = ds.fromHex(L.secretHex);
  assert.equal(await srv.formatSetupLink(L.server, secret), L.link);
  assert.equal(await srv.deriveSetupToken(secret), L.setupToken);
  for (const c of L.parsing) {
    if (c.error) {
      await assert.rejects(srv.parseSetupLink(c.input), (e) => e.reason === c.error, JSON.stringify(c.input));
    } else {
      const r = await srv.parseSetupLink(c.input);
      assert.equal(r.server, c.server);
      assert.equal(ds.toHex(r.secret), c.secretHex);
    }
  }
});
