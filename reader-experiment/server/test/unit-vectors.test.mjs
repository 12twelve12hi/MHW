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
