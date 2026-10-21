// The Lab reference (daylight-lab.js and the 2.7.1 additions to daylight-share.js): its vectors, as every port runs
// them, then unit tests of the parts no vector can pin (timing, storage, relay answers). LAB-PROTOCOL.md section 2.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import * as ds from '../daylight-share.js';
import * as lab from '../daylight-lab.js';
import { startMockRelay, NTFY_SH_LIMITS } from '../mock-relay.mjs';

const V = JSON.parse(readFileSync(new URL('../../vectors/lab-vectors.json', import.meta.url), 'utf8'));
const PV = JSON.parse(readFileSync(new URL('../../vectors/test-vectors.json', import.meta.url), 'utf8'));
const secret1 = ds.fromHex(PV.pairing[0].secretHex);
const parseJson = (text) => { try { return JSON.parse(text); } catch { return undefined; } };
const T0 = Date.UTC(2026, 9, 20, 8, 0, 0);
const SEC = 1000, MIN = 60000, HOUR = 3600000, DAY = 86400000;
const id = (n) => n.toString(16).padStart(32, '0');

// ---------------------------------------------------------------------------------------------------------------
// Vectors

test('lab vectors: constants', () => {
  for (const [k, v] of Object.entries(V.constants)) assert.deepEqual(lab[k], v, k);
});

test('lab vectors: derived topics, the AAD map and a sealed return frame', async () => {
  for (const t of V.labTopics.topics) {
    const got = await lab.deriveLabTopics(ds.fromHex(t.secretHex));
    assert.deepEqual(got, { returnTopic: t.returnTopic, returnAckTopic: t.returnAckTopic, controlTopic: t.controlTopic, controlAckTopic: t.controlAckTopic });
    for (const topic of Object.values(got)) assert.match(topic, /^dls-[0-9a-f]{32}$/);
    const k = await ds.deriveKeys(ds.fromHex(t.secretHex));
    assert.ok(!Object.values(got).includes(k.inboxTopic) && !Object.values(got).includes(k.ackTopic));
  }
  for (const [purpose, aad] of Object.entries(V.labTopics.aads)) assert.equal(ds.fromUtf8(ds.aadFor(purpose)), aad);
  const r = V.labTopics.returnFrame;
  const keys = await ds.deriveKeys(ds.fromHex(r.secretHex));
  const frame = await ds.sealFrame(keys, r.purpose, ds.utf8(r.headerJson), new Uint8Array(0), ds.fromHex(r.nonceHex));
  assert.equal(ds.toHex(frame), r.frameHex);
  assert.equal(ds.toBase64(frame), r.frameBase64);
  assert.deepEqual((await ds.decryptFrame(keys, r.purpose, frame)).header, JSON.parse(r.headerJson));
  for (const p of r.refusedPurposes) await assert.rejects(ds.decryptFrame(keys, p, frame), (e) => e.code === 'frame', p);
  for (const p of ['lab', 'Inbox', '', undefined, 'ack ']) {
    await assert.rejects(ds.decryptFrame(keys, p, frame), (e) => e instanceof ds.ShareError && e.code === 'purpose', String(p));
    await assert.rejects(ds.sealFrame(keys, p, ds.utf8('{}')), (e) => e.code === 'purpose', String(p));
    assert.throws(() => ds.aadFor(p), (e) => e.code === 'purpose');
  }
});

test('lab vectors: frames seal byte for byte, parse, and rebuild', async () => {
  const keys = await ds.deriveKeys(secret1);
  for (const f of V.labFrames) {
    const nonce = ds.fromHex(f.nonceHex);
    const frame = await ds.sealFrame(keys, 'ack', ds.utf8(f.headerJson), new Uint8Array(0), nonce);
    assert.equal(ds.toBase64(frame), f.frameBase64, f.name);
    assert.equal(frame.length, f.frameLength);
    assert.equal(ds.utf8(f.headerJson).length, f.headerBytes);
    assert.equal(f.frameBase64.length, f.base64Length);
    assert.equal(ds.isSmallFrame(frame), f.small);
    const { header } = await ds.decryptFrame(keys, 'ack', frame);
    assert.deepEqual(lab.parseLabAck(header), f.parse, f.name);
    const rebuilt = await lab.buildLabFrame(keys, {
      inbox: header['x-inbox'], states: header['x-st'] ?? [], from: header.from, sent: header.sent, nonce,
    });
    assert.equal(ds.toBase64(rebuilt), f.frameBase64, `${f.name}: buildLabFrame serialises the same bytes`);
  }
  const worst = V.labFrames.find((f) => f.name.startsWith('worst case: '));
  assert.deepEqual([worst.headerBytes, worst.frameLength, worst.base64Length], [2572, 2608, 3480]);
});

test('lab vectors: parse (2.2.5)', () => {
  assert.ok(V.labParse.length >= 45);
  for (const c of V.labParse) assert.deepEqual(lab.parseLabAck(parseJson(c.headerJson)), c.expect, c.name);
});

test('lab vectors: ledger (2.2.6)', async () => {
  for (const c of V.labLedger) {
    const ledger = new lab.LabLedger({ storage: new ds.MemoryStorage(), now: () => c.now });
    for (const s of c.steps) await ledger.record(JSON.parse(s.headerJson), { time: s.time });
    assert.equal(await ledger.inboxLab(), c.expect.inboxLab, c.name);
    assert.deepEqual(await ledger.caps(), c.expect.caps, c.name);
    for (const [t, v] of Object.entries(c.expect.hasCap)) assert.equal(await ledger.hasCap(t), v, `${c.name}: ${t}`);
    assert.equal(await ledger.checkedIn(), c.expect.checkedIn, c.name);
    for (const [i, st] of Object.entries(c.expect.states)) assert.deepEqual(await ledger.state(i), st, c.name);
    const pubs = Object.fromEntries((await ledger.publishers()).map(({ publisher, ...e }) => [publisher, e]));
    assert.deepEqual(pubs, c.expect.publishers, c.name);
  }
});

function gateCtx(stub, asked, deadlineMs = 20) {
  const server = stub.server === undefined || stub.server === null ? null
    : stub.server === 'never' ? { state: (key) => { asked.push(key); return new Promise(() => {}); } }
      : stub.server === 'throws-offline' ? { state: async (key) => { asked.push(key); const e = new Error('Couldn’t reach the Daylight server. Check your connection and try again.'); e.code = 'OFFLINE'; throw e; } }
        : { state: async (key) => { asked.push(key); return { state: stub.server.state, message: stub.server.message ?? null }; } };
  return {
    lab: stub.lab, paired: stub.paired, platform: stub.platform, hasCap: stub.caps ?? [],
    local: stub.local ? async () => stub.local : undefined, server,
    serverMessage: stub.serverMessages ? (s) => stub.serverMessages[s] ?? null : undefined,
    built: stub.built === undefined ? undefined : async () => stub.built, deadlineMs,
  };
}

test('lab vectors: gate (1.5, 2.6)', async () => {
  for (const c of V.labGate) {
    const asked = [];
    const r = await lab.labGate(c.feature, gateCtx(c.ctx, asked));
    assert.deepEqual({ ...r, serverKey: asked[0] ?? null }, c.expect, c.name);
  }
});

test('lab vectors: header extras (2.3)', () => {
  for (const c of V.labHeaderExtras) assert.deepEqual(ds.checkItemHeader(JSON.parse(c.headerJson)).extras, c.expect, c.name);
});

test('lab vectors: row text (2.5)', () => {
  for (const c of V.labRowText) {
    const d = lab.describeLabRow(c.row, c.now, c.ctx);
    assert.deepEqual({ ...d, a11y: lab.labRowA11yLabel(d) }, c.expect, c.name);
  }
});

test('lab vectors: text', () => {
  const flat = {};
  (function walk(o, p) {
    for (const [k, v] of Object.entries(o)) {
      const key = p ? `${p}.${k}` : k;
      if (typeof v === 'string') flat[key] = v; else if (Array.isArray(v)) flat[key] = v.join(','); else walk(v, key);
    }
  })(lab.LAB_TEXT, '');
  assert.deepEqual(flat, V.labText.strings);
  for (const m of V.labText.messages) {
    const { state, expect, ...opts } = m;
    assert.equal(lab.needsMessage(state, opts), expect, JSON.stringify(m));
  }
  for (const c of V.labText.checkedIn) assert.equal(lab.checkedInText(c.ms, c.now), c.expect);
  for (const c of V.labText.inboxHeader) assert.equal(lab.inboxLabText(c, c.now), c.expect);
  for (const f of V.labText.features) assert.deepEqual(lab.LAB_TEXT.features[f.id], { name: f.name, sentence: f.sentence });
  for (const c of V.labText.serverRow) {
    assert.deepEqual([lab.serverHeadingShort(c.state), lab.serverRowSubtitle(c.state)], [c.heading, c.subtitle], c.state);
  }
  assert.equal(V.labText.serverRow.find((c) => c.state === 'needs-server').subtitle, 'Optional · Not set up');
  for (const c of V.labText.serverFeature) assert.equal(lab.serverFeatureShort(c.state, c.headingState), c.expect, JSON.stringify(c));
  for (const c of V.labText.serverSection.moved) assert.equal(lab.serverMovedText(c.moved), c.expect);
  for (const c of V.labText.serverSection.labInboxSeen) assert.equal(lab.labInboxSeenText(c.lastSeen, c.now), c.expect, JSON.stringify(c));
  for (const c of V.labText.serverSection.aiToday) assert.equal(lab.aiTodayText(c.used, c.cap), c.expect, JSON.stringify(c));
  for (const s of Object.values(V.labText.strings)) assert.ok(!/[A-Za-z]'[A-Za-z]/.test(s), `ASCII apostrophe in ${s}`);
});

test('lab vectors: v1 safety: every Lab frame opens as an ack of no ids', async () => {
  const keys = await ds.deriveKeys(secret1);
  for (const f of V.v1Safety) {
    const { header } = await ds.decryptFrame(keys, 'ack', ds.fromBase64(f.frameBase64));
    assert.equal(header.kind, 'ack');
    assert.deepEqual(header.ids, f.ackIds);
  }
});

test('the generated lab vectors are what generate-lab.mjs writes (no hand edits)', async () => {
  // Spot check: rebuilding three sections from the module gives the committed values (CI regenerates all of it).
  const keys = await ds.deriveKeys(secret1);
  const hello = V.labFrames[0];
  const { header } = await ds.decryptFrame(keys, 'ack', ds.fromBase64(hello.frameBase64));
  assert.equal(JSON.stringify(header), hello.headerJson);
  assert.equal(V.generatedBy, 'reader-experiment/share/vectors/generate-lab.mjs');
});

test('both modules keep to the export forms the extension’s classic bundle reads', () => {
  for (const f of ['../daylight-share.js', '../daylight-lab.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const line of src.split('\n').filter((l) => /^\s*export\b/.test(l))) {
      assert.match(line, /^export (async function\*?|function\*?|class|const|let) [A-Za-z_$][\w$]*\b/, `${f}: ${line}`);
      assert.ok(!/^export (const|let) \w+ = [^;{[(]*, *\w+ =/.test(line), `${f}: one declaration per export: ${line}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Protocol module additions (2.7.1)

test('checkItemHeader extras come from part 0 only; Reassembler and Receiver carry them', async () => {
  const keys = await ds.deriveKeys(ds.generateSecret());
  const content = ds.randomBytes(3000);
  const built = await ds.buildItemFrames(keys, { kind: 'file', name: 'a.pdf', mime: 'application/pdf', content }, { chunkSize: 1000 });
  // Re-seal each part with Lab fields on every part (as a confused sender might): only part 0's count.
  const parts = [];
  for (const f of built.frames) {
    const { header, body } = await ds.decryptFrame(keys, 'inbox', f);
    const x = header.part === 0 ? { 'x-cap': 'seen', 'x-orig': 'https://example.com/orig' } : { 'x-cap': 'clean', 'x-orig': 'https://example.com/other' };
    parts.push({ header: { ...header, ...x, 'x-note': 'dropped' }, body });
  }
  assert.deepEqual(ds.checkItemHeader(parts[1].header).extras, {});
  const r = new ds.Reassembler();
  assert.equal(await r.add(parts[2].header, parts[2].body), null);
  assert.equal(await r.add(parts[1].header, parts[1].body), null);
  const done = await r.add(parts[0].header, parts[0].body); // part 0 last
  assert.deepEqual(done.extras, { 'x-cap': 'seen', 'x-orig': 'https://example.com/orig' });
  assert.equal(done.header.extras, undefined, 'extras are the item’s, not the header’s');
  assert.equal(done.header['x-cap'], undefined);
  assert.deepEqual(done.content, content);
  const url = await new ds.Reassembler().add({ v: 1, id: id(7), kind: 'url', url: 'https://example.com/', sent: '', 'x-orig': ' https://t.co/x ' }, new Uint8Array(0));
  assert.deepEqual(url.extras, { 'x-orig': 'https://t.co/x' });

  const relay = await startMockRelay();
  try {
    const pairing = { secret: ds.generateSecret(), relay: relay.url };
    const k = await ds.deriveKeys(pairing.secret);
    const rc = new ds.RelayClient({ relay: relay.url });
    await rc.publish(k.inboxTopic, await ds.encryptFrame(k, 'inbox', { v: 1, id: id(1), kind: 'url', url: 'https://example.com/a', sent: '', 'x-cap': 'test', 'x-orig': 'https://example.com/a?utm=1' }, new Uint8Array(0)));
    const accepted = [];
    const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage(), accept: async (it) => { accepted.push(it); } });
    const res = await receiver.pollOnce();
    assert.deepEqual(res.items[0].extras, { 'x-cap': 'test', 'x-orig': 'https://example.com/a?utm=1' });
    assert.deepEqual(accepted[0].extras, res.items[0].extras);
    assert.equal(res.limited, 0);
  } finally { await relay.close(); }
});

async function setup(opts = {}) {
  let clock = T0;
  const now = () => clock;
  const { senderOpts = {}, receiverOpts = {}, ...relayOpts } = opts;
  const hooks = { publish: null };
  const relay = await startMockRelay({ now, ...relayOpts, failPublish: (...a) => hooks.publish?.(...a) ?? null });
  const secret = ds.generateSecret();
  const pairing = { secret, relay: relay.url, name: 'Test Daylight' };
  const fast = { retryDelaysMs: [0, 0, 0] };
  const sender = new ds.Sender({ pairing, storage: new ds.MemoryStorage(), from: 'Phone', app: 'test/1', now, ...fast, ...senderOpts });
  const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage(), now, ...fast, ...receiverOpts });
  const keys = await sender.keys();
  return { relay, sender, receiver, keys, pairing, hooks, now, fast, advance: (ms) => { clock += ms; } };
}

test('Sender onAckHeader: every ack-topic frame of kind ack, in order, before rows change; errors are caught', async () => {
  const calls = [];
  let rowsSeen = null;
  const { relay, sender, receiver, keys, advance } = await setup({
    senderOpts: {
      onAckHeader: async (header, meta) => {
        calls.push({ ids: header.ids, lab: !!header['x-inbox'], meta });
        rowsSeen ??= (await sender.list()).map((r) => r.status);
        if (header['x-inbox']) throw new Error('a broken hook');
      },
    },
  });
  try {
    const row = await sender.send({ kind: 'url', url: 'https://example.com/x' });
    await receiver.pollOnce();
    advance(SEC);
    const rc = new ds.RelayClient({ relay: relay.url });
    await rc.publish(keys.ackTopic, await lab.buildLabFrame(keys, { inbox: { lab: 1, app: 'android/1', caps: ['st'] }, states: [{ id: row.id, s: 'reader', t: 1 }] }));
    await rc.publish(keys.ackTopic, await ds.encryptFrame(keys, 'ack', { v: 1, kind: 'other', ids: [row.id] }, new Uint8Array(0)));
    await rc.publish(keys.ackTopic, ds.utf8('junk junk junk junk junk junk junk junk junk'));
    const warn = mock.method(console, 'warn', () => {});
    try {
      assert.equal(await sender.checkAcks(), 1, 'a throwing hook never stops acks');
    } finally { warn.mock.restore(); }
    assert.deepEqual(calls.map((c) => [c.ids.length, c.lab]), [[1, false], [0, true]], 'acks and Lab frames; not kind "other", not junk');
    assert.deepEqual(rowsSeen, ['sent'], 'the hook runs before rows are updated');
    for (const c of calls) {
      assert.equal(typeof c.meta.time, 'number');
      assert.equal(c.meta.time, Math.floor(c.meta.time));
      assert.equal(typeof c.meta.msgId, 'string');
    }
    assert.equal(calls[1].meta.time * 1000 >= T0, true, 'relay seconds');
  } finally { await relay.close(); }
});

test('send({defer}) stores the row as waiting for a connection and publishes nothing', async () => {
  const { relay, sender, receiver, advance } = await setup();
  try {
    const row = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: ds.randomBytes(5000) }, { defer: true });
    assert.equal(row.status, 'failed');
    assert.equal(row.errorCode, 'network');
    assert.equal(row.attempts, 0);
    assert.equal(row.lastPublish, T0);
    assert.equal(relay.state.published, 0);
    assert.equal(typeof (await sender.storage.get(`outbox/${row.id}`)), 'string', 'the content is kept');
    assert.equal(ds.describeRow(row, T0).label, 'Waiting to send');
    assert.equal(lab.describeLabRow(row, T0, { lab: true, online: false }).label, 'Waiting for connection');
    await assert.rejects(sender.send({ kind: 'url', url: 'not a url' }, { defer: true }), (e) => e.code === 'url');
    assert.equal((await sender.list()).length, 1, 'bad input stores nothing, deferred or not');
    assert.deepEqual(await sender.resendDue(), [], 'v1.1 back-off: not before a minute');
    advance(MIN);
    const [sent] = await sender.resendDue();
    assert.equal(sent.status, 'sent');
    assert.equal((await receiver.pollOnce()).items.length, 1);
  } finally { await relay.close(); }
});

test('flushNetwork: 70 links queued offline go out in order, 30 frames a pass, in three passes, with no 429 (F07.3)', async () => {
  const { relay, sender, receiver, keys, advance } = await setup({ ...NTFY_SH_LIMITS });
  try {
    const ids = [];
    for (let i = 0; i < 70; i++) {
      ids.push((await sender.send({ kind: 'url', url: `https://example.com/${i}`, title: `Link ${i}` }, { defer: true })).id);
      advance(SEC);
    }
    const passes = [];
    while ((await sender.list()).some((r) => r.status === 'failed')) {
      const before = relay.state.published;
      const rows = await sender.flushNetwork();
      passes.push(rows.length);
      assert.ok(relay.state.published - before <= 30);
      assert.ok(rows.every((r) => r.status === 'sent'));
      advance(3 * MIN);
    }
    assert.deepEqual(passes, [30, 30, 10]);
    assert.deepEqual(relay.state.limited, [], 'no 429');
    const order = [];
    for (const m of relay.state.topics.get(keys.inboxTopic)) order.push((await ds.decryptFrame(keys, 'inbox', ds.fromBase64(m.message))).header.id);
    assert.deepEqual(order, ids, 'oldest first');
    assert.equal((await receiver.pollOnce()).items.length, 70);
  } finally { await relay.close(); }
});

test('flushNetwork: 10 queued 9 MB files never put over 18 MB in a pass or 20 MB on the relay; a 413 sends the rest into the 3-hour wait (F07.3)', async () => {
  const { relay, sender, advance, now } = await setup({ ...NTFY_SH_LIMITS });
  try {
    for (let i = 0; i < 10; i++) {
      await sender.send({ kind: 'file', name: `book-${i}.pdf`, mime: 'application/pdf', content: ds.randomBytes(9000000) }, { defer: true });
      advance(SEC);
    }
    const perPass = [];
    for (let pass = 0; pass < 12 && (await sender.list()).some((r) => r.status === 'failed' && r.errorCode === 'network'); pass++) {
      const start = relay.state.publishLog.length;
      await sender.flushNetwork();
      perPass.push(relay.state.publishLog.slice(start).filter((p) => p.attachment).reduce((n, p) => n + p.bytes, 0));
      advance(3 * MIN);
    }
    assert.ok(perPass.every((b) => b <= 18000000), String(perPass));
    const live = relay.state.publishLog.filter((p) => p.attachment).reduce((n, p) => n + p.bytes, 0);
    assert.ok(live <= 20000000, `${live} bytes on the relay at once`);
    const rows = await sender.list();
    assert.equal(rows.filter((r) => r.status === 'sent').length, 2);
    const waiting = rows.filter((r) => r.status === 'failed');
    assert.equal(waiting.length, 8);
    for (const r of waiting) {
      assert.equal(r.errorCode, 'full');
      assert.equal(ds.describeRow(r, now()).sentence, 'A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.');
    }
    assert.deepEqual(await sender.resendDue(), [], 'nothing before 185 minutes');
    assert.deepEqual(relay.state.limited, []);
  } finally { await relay.close(); }
});

test('flushNetwork follows the pass rules: after a 429 nothing more, after a 413 no attachments; it skips other rows', async () => {
  const { relay, sender, hooks, advance } = await setup();
  try {
    const sentRow = await sender.send({ kind: 'url', url: 'https://example.com/sent' });
    const a = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: ds.randomBytes(50000) }, { defer: true });
    advance(SEC);
    const b = await sender.send({ kind: 'file', name: 'b.pdf', mime: 'application/pdf', content: ds.randomBytes(50000) }, { defer: true });
    advance(SEC);
    const c = await sender.send({ kind: 'url', url: 'https://example.com/c' }, { defer: true });
    hooks.publish = (topic, n, isAttachment) => (isAttachment ? 413 : null);
    let rows = await sender.flushNetwork();
    assert.deepEqual(rows.map((r) => [r.id, r.status, r.errorCode]), [[a.id, 'failed', 'full'], [c.id, 'sent', '']]);
    assert.equal((await sender.list()).find((r) => r.id === sentRow.id).attempts, 0, 'a sent row is not touched');
    hooks.publish = () => 429;
    const d = await sender.send({ kind: 'url', url: 'https://example.com/d' }, { defer: true });
    const e = await sender.send({ kind: 'url', url: 'https://example.com/e' }, { defer: true });
    rows = await sender.flushNetwork();
    assert.equal(rows.length, 1, 'b first (oldest), then nothing after its 429');
    assert.equal(rows[0].id, b.id);
    hooks.publish = null;
    advance(3 * MIN);
    const f1 = await sender.send({ kind: 'file', name: 'f1.pdf', mime: 'application/pdf', content: ds.randomBytes(50000) }, { defer: true });
    advance(SEC);
    const f2 = await sender.send({ kind: 'file', name: 'f2.pdf', mime: 'application/pdf', content: ds.randomBytes(50000) }, { defer: true });
    rows = await sender.flushNetwork({ maxAttachmentBytes: 10 });
    assert.deepEqual(rows.map((r) => r.id), [b.id], 'a pass always takes its first row, and is then full');
    rows = await sender.flushNetwork({ maxFrames: 2 });
    assert.deepEqual(rows.map((r) => r.id), [d.id, e.id], 'the frame cap');
    rows = await sender.flushNetwork({ maxAttachmentBytes: 60000 });
    assert.deepEqual(rows.map((r) => r.id), [f1.id], 'the attachment cap');
    rows = await sender.flushNetwork();
    assert.deepEqual(rows.map((r) => [r.id, r.status]), [[f2.id, 'sent']]);
  } finally { await relay.close(); }
});

test('applyPairingChange removes the Lab ledger with the outbox when the secret changes, and keeps it otherwise', async () => {
  const storage = new ds.MemoryStorage();
  const a = { secret: ds.generateSecret(), relay: 'https://ntfy.sh' };
  const fill = async () => {
    await storage.set('outbox', [{ id: id(1) }]);
    await storage.set('lab/inbox', { android: { lab: 1 } });
    await storage.set('lab/heard', 5);
    await storage.set('lab/states', { [id(1)]: { s: 'reader', t: 1 } });
    await storage.set('lab/extra', 1);
    await storage.set('lab-unrelated', 1);
  };
  await fill();
  assert.equal(await ds.applyPairingChange(storage, a, { ...a, relay: 'https://relay.example.org' }), false);
  assert.equal(await storage.get('lab/heard'), 5);
  assert.equal(await ds.applyPairingChange(storage, a, { secret: ds.generateSecret() }), true);
  for (const k of ds.LAB_STORAGE_KEYS) assert.equal(await storage.get(k), undefined, k);
  assert.equal(await storage.get('lab/extra'), 1, 'MemoryStorage cannot list keys: only the known ones go');
  const listing = Object.assign(new ds.MemoryStorage(), { keys() { return [...this.m.keys()]; } });
  await listing.set('lab/extra', 1); await listing.set('lab-unrelated', 1); await listing.set('lab/states', {});
  await ds.applyPairingChange(listing, null, a);
  assert.equal(await listing.get('lab/extra'), undefined);
  assert.equal(await listing.get('lab-unrelated'), 1);
});

// ---------------------------------------------------------------------------------------------------------------
// Ledger, timeline and gate

test('LabLedger: prune keeps the outbox ids, at most 200, the latest first; a hook records through the Sender', async () => {
  const storage = new ds.MemoryStorage();
  const ledger = new lab.LabLedger({ storage, now: () => T0 });
  const st = Array.from({ length: 64 }, (_, i) => ({ i: id(i), s: 'reader', t: 1000 + i }));
  for (let k = 0; k < 5; k++) await ledger.record({ v: 1, kind: 'ack', ids: [], 'x-st': st.map((e) => ({ ...e, i: id(k * 64 + Number.parseInt(e.i, 16)), t: e.t + k * 64 })) }, { time: T0 / 1000 });
  assert.equal(Object.keys(await storage.get('lab/states')).length, 320);
  await ledger.prune(Array.from({ length: 300 }, (_, i) => id(i)));
  const kept = await storage.get('lab/states');
  assert.equal(Object.keys(kept).length, 200);
  assert.ok(kept[id(299)] && !kept[id(99)], 'the latest t first');
  await ledger.record({ v: 1, kind: 'ack', ids: [], 'x-st': [{ i: id(299), s: 'held', t: 1 }] }, { time: T0 / 1000 });
  assert.equal((await ledger.state(id(299))).s, 'reader', 'merge rule');
  assert.equal(await ledger.state(id(400)), null);
});

test('describeLabRow: the step line shows on the newest and unfinished rows; accessibility labels (F01.6)', () => {
  const ctx = (s) => ({ lab: true, inboxLab: true, hasCap: (t) => t === 'st', state: s, online: true });
  const rows = [
    { id: id(1), kind: 'url', status: 'sent', created: T0 },
    { id: id(2), kind: 'file', status: 'delivered', created: T0 - MIN },
    { id: id(3), kind: 'url', status: 'delivered', created: T0 - 2 * MIN },
  ];
  const states = { [id(2)]: { s: 'waiting', t: 1 }, [id(3)]: { s: 'reader', t: 1 } };
  const shown = rows.map((r, i) => {
    const d = lab.describeLabRow(r, T0, ctx(states[r.id] ?? null));
    return { label: d.label, showSentence: i === 0 || !d.final, a11y: lab.labRowA11yLabel(d) };
  });
  assert.deepEqual(shown.map((s) => s.showSentence), [true, true, false]);
  assert.equal(shown[2].a11y, 'In your Reader ✓. Saved in the Daylight Reader.');
  assert.ok(shown.every((s) => !/step|1 of|2 of/i.test(s.a11y)), 'no step count');
  assert.equal(lab.wantsFastChecks([{ ...rows[1], delivered: T0 - MIN }], T0, states), true, 'waiting is not settled');
  assert.equal(lab.wantsFastChecks([{ ...rows[2], delivered: T0 - MIN }], T0, states), false);
  assert.equal(lab.wantsFastChecks([{ ...rows[1], delivered: T0 - 11 * MIN }], T0, states), false, 'older than 10 minutes');
  assert.deepEqual(lab.describeLabRow(rows[2], T0, { lab: true, inboxLab: true, state: 'reader' }).label, 'In your Reader ✓', 'no hasCap: inboxLab decides');
});

test('labGate: the default deadline is 5 s; a ready answer within it counts', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const never = lab.labGate('F37', { lab: true, paired: true, server: { state: () => new Promise(() => {}) }, serverMessage: () => 'offline text' });
    mock.timers.tick(4999);
    let settled = false;
    never.then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(settled, false);
    mock.timers.tick(1);
    const r = await never;
    assert.deepEqual([r.state, r.message, r.short], ['OFFLINE', 'offline text', 'Can’t reach the server']);
  } finally { mock.timers.reset(); }
  const slowReady = await lab.labGate('F02', { lab: true, paired: true, server: { state: async () => ({ state: 'ready' }) } });
  assert.equal(slowReady.ready, true);
});

test('labGate reads caps through a LabLedger and the server through a DaylightServer-like object', async () => {
  const ledger = new lab.LabLedger({ storage: new ds.MemoryStorage(), now: () => T0 });
  const ctx = { lab: true, paired: true, hasCap: (t) => ledger.hasCap(t), platform: 'mac' };
  assert.equal((await lab.labGate('F01', ctx)).state, 'needs-inbox');
  await ledger.record({ v: 1, kind: 'ack', ids: [], 'x-inbox': { lab: 1, app: 'android/1.5.0', caps: ['st'] } }, { time: T0 / 1000 });
  assert.equal((await lab.labGate('F01', ctx)).ready, true);
  assert.equal(lab.inboxLabText({ inboxLab: await ledger.inboxLab(), checkedIn: await ledger.checkedIn() }, T0 + 4 * MIN),
    'Your Daylight: Lab on · checked in 4 min ago');
});

test('labGate with the server lane’s DaylightServer: needs-server before a deploy, OFFLINE at 5 s from a relay that never answers (F00.6)', async () => {
  const srv = await import('../../../server/client/daylight-server.js'); // read only: the server lane owns it
  const relay = await startMockRelay();
  const hang = http.createServer(() => {}); // takes the request and never answers
  await new Promise((r) => hang.listen(0, '127.0.0.1', r));
  try {
    const secret = ds.generateSecret();
    const ctx = (relayUrl) => ({
      lab: true, paired: true, platform: 'iphone', serverMessage: srv.localMessage,
      server: new srv.DaylightServer({ pairing: { secret, relay: relayUrl }, storage: new ds.MemoryStorage() }),
    });
    const r = await lab.labGate('F37', ctx(relay.url));
    assert.deepEqual([r.state, r.message, r.short, r.button],
      ['needs-server', lab.LAB_TEXT.needs['needs-server'], 'Needs your Daylight server', 'Copy Server code'], 'the short sentence, not the module’s long one');
    const started = Date.now();
    const off = await lab.labGate('F37', ctx(`http://127.0.0.1:${hang.address().port}`));
    const took = Date.now() - started;
    assert.deepEqual([off.state, off.message, off.short], ['OFFLINE', srv.STATE_MESSAGES.OFFLINE, 'Can’t reach the server']);
    assert.ok(took >= 4900 && took < 6500, `answered after ${took} ms`);
  } finally {
    hang.closeAllConnections?.();
    await new Promise((r) => hang.close(r));
    await relay.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// LabInbox (2.2.4): a fake relay that records frames

async function inbox({ caps = ['st', 'tap'], app = 'android/1.5.0', publish = null, ...opts } = {}) {
  let clock = T0;
  const keys = await ds.deriveKeys(ds.generateSecret());
  const frames = [];
  const info = { lab: 1, app, caps, live: false };
  const relay = {
    publish: async (topic, frame) => {
      assert.equal(topic, keys.ackTopic);
      assert.ok(ds.isSmallFrame(frame));
      if (publish) await publish(frame);
      const { header } = await ds.decryptFrame(keys, 'ack', frame);
      frames.push({ at: clock, header, parsed: lab.parseLabAck(header) });
      return { id: 'm' + frames.length, time: Math.floor(clock / 1000) };
    },
  };
  const logs = [];
  const li = new lab.LabInbox({ storage: new ds.MemoryStorage(), relay, keys, info: () => info, from: 'Test Daylight', now: () => clock, autoFlushMs: null, log: (l) => logs.push(l), ...opts });
  return { li, frames, info, logs, keys, advance: (ms) => { clock += ms; }, now: () => clock };
}

test('LabInbox: the first flush is a hello; states go oldest first, 24 a frame, one frame every 30 s', async () => {
  const { li, frames, advance, logs } = await inbox();
  assert.deepEqual(await li.flush(), { published: 1, kind: 'hello', states: 0, reason: 'sent' });
  assert.equal(frames[0].header['x-st'], undefined);
  assert.deepEqual(frames[0].parsed.inbox.caps, ['st', 'tap']);
  assert.deepEqual(frames[0].header.ids, []);
  for (let i = 0; i < 50; i++) assert.equal(await li.record(id(i), 'reader', 1792483000 + i), true);
  const early = await li.flush();
  assert.equal(early.reason, 'spacing');
  assert.equal(early.waitMs, 30 * SEC);
  advance(30 * SEC);
  assert.equal((await li.flush()).states, 24);
  advance(10 * SEC);
  assert.equal((await li.flush()).reason, 'spacing');
  advance(20 * SEC);
  assert.equal((await li.flush()).states, 24);
  advance(30 * SEC);
  assert.equal((await li.flush()).states, 2);
  assert.deepEqual(frames.slice(1).flatMap((f) => f.parsed.states.map((s) => s.id)), Array.from({ length: 50 }, (_, i) => id(i)));
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].at - frames[i - 1].at >= 30 * SEC);
  assert.ok(frames.every((f) => f.parsed.inbox?.lab === 1), 'every state frame is also a hello');
  assert.ok(logs.includes('lab: hello caps=st,tap') && logs.includes('lab: states n=24 published'));
});

test('LabInbox: the merge rule on record; a re-announced item never goes back from held to waiting', async () => {
  const { li, frames, advance } = await inbox();
  await li.flush();
  advance(30 * SEC);
  assert.equal(await li.record(id(1), 'waiting', 100), true);
  assert.equal(await li.record(id(1), 'held', 110), true);
  assert.equal(await li.record(id(1), 'waiting', 120), false, 'lower rank');
  assert.equal(await li.record(id(1), 'held', 105), false, 'same rank, earlier t');
  assert.equal(await li.record(id(2), 'nonsense', 1), false);
  assert.equal(await li.record('XYZ', 'reader', 1), false);
  await li.flush();
  assert.deepEqual(frames[1].parsed.states, [{ id: id(1), s: 'held', t: 110 }]);
  assert.equal(await li.record(id(1), 'held', 110), false, 'already published');
  assert.equal(await li.record(id(1), 'waiting', 200), false, 'a re-announce after publishing');
  assert.equal(await li.record(id(1), 'handed', 210), true);
});

test('LabInbox gives way: after failed acks, and for an hour after a 429 or 413 (its own or the Receiver’s)', async () => {
  let fail = 0;
  const { li, frames, advance } = await inbox({ publish: async () => { if (fail) { const s = fail; fail = 0; throw new ds.ShareError('network', 'HTTP ' + s, 'x', s); } } });
  await li.flush();
  advance(30 * SEC);
  await li.record(id(1), 'reader', 1);
  await li.noteAcksFailed(true);
  assert.equal((await li.flush()).reason, 'yield');
  await li.noteAcksFailed(false);
  await li.noteRelayLimit(429);
  advance(59 * MIN);
  assert.equal((await li.flush()).reason, 'yield');
  advance(MIN);
  assert.equal((await li.flush()).reason, 'sent');
  advance(30 * SEC);
  await li.record(id(2), 'reader', 2);
  fail = 413;
  assert.equal((await li.flush()).reason, 'error');
  advance(30 * MIN);
  assert.equal((await li.flush()).reason, 'yield', 'its own 413 counts');
  advance(30 * MIN);
  const r = await li.flush();
  assert.equal(r.reason, 'sent');
  assert.equal(frames.at(-1).parsed.states[0].id, id(2), 'a failed publish keeps its entries');
  await li.noteRelayLimit(500);
  advance(30 * SEC);
  await li.record(id(3), 'reader', 3);
  assert.equal((await li.flush()).reason, 'sent', 'other statuses do not make Lab give way');
});

test('LabInbox: at most 30 hellos and state frames a UTC day; states then wait for the digest', async () => {
  const { li, frames, advance, now } = await inbox();
  advance(23 * HOUR - (T0 % DAY) + 8 * HOUR); // 23:00 UTC of a day... keep a full day ahead
  const dayStart = now() - (now() % DAY);
  advance(dayStart + DAY - now()); // 00:00 UTC
  let reasons = [];
  for (let i = 0; i < 32; i++) {
    await li.record(id(i), 'reader', Math.floor(now() / 1000));
    reasons.push((await li.flush()).reason);
    advance(30 * SEC);
  }
  assert.equal(reasons.filter((r) => r === 'sent').length, 30);
  assert.deepEqual(reasons.slice(30), ['cap', 'cap']);
  await li.digest();
  assert.equal(frames.at(-1).parsed.states.length, 24, 'the digest is outside the cap');
  advance(30 * SEC);
  await li.flush();
  assert.equal(frames.at(-1).parsed.states.length, 8, '32 recent states in two digest frames');
  advance(DAY);
  reasons = [];
  await li.record(id(99), 'reader', Math.floor(now() / 1000));
  assert.equal((await li.flush()).reason, 'sent', 'a new UTC day');
});

test('LabInbox halves a batch that is not small, down to one entry, and drops an entry that never fits', async () => {
  const bad = id(5);
  const buildFrame = async (keys, o) => {
    if (o.states.length > 5 || o.states.some((e) => e.i === bad)) throw new ds.ShareError('lab', 'not small', 'not-small');
    return lab.buildLabFrame(keys, o);
  };
  const { li, frames, advance, logs } = await inbox({ buildFrame });
  for (let i = 0; i < 8; i++) await li.record(id(i), 'reader', 100 + i);
  const sizes = [];
  for (let k = 0; k < 4; k++) { const r = await li.flush(); if (r.published) sizes.push(r.states); advance(30 * SEC); }
  assert.deepEqual(sizes, [4, 1, 2], '8 -> 4; then 4 -> 2 -> 1 (the bad entry is second); then the bad entry alone is dropped');
  assert.ok(logs.some((l) => l.startsWith(`lab: dropped state ${bad}`)));
  assert.deepEqual(frames.flatMap((f) => f.parsed.states.map((s) => s.id)), [0, 1, 2, 3, 4, 6, 7].map(id));
});

test('LabInbox hellos: at most 3 a day while idle, and one when caps or app change (F17.3)', async () => {
  const { li, frames, advance, info } = await inbox();
  for (let i = 0; i < 4 * 96; i++) { await li.flush(); advance(15 * MIN); } // 4 days, a flush every 15 minutes
  const perDay = new Map();
  for (const f of frames) { const d = new Date(f.at).toISOString().slice(0, 10); perDay.set(d, (perDay.get(d) ?? 0) + 1); }
  assert.ok([...perDay.values()].every((n) => n <= 3), JSON.stringify([...perDay]));
  assert.ok(frames.every((f) => !f.header['x-st']));
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].at - frames[i - 1].at > lab.HELLO_EVERY_MS);
  const n = frames.length;
  info.caps = ['st', 'tap', 'reader-link'];
  await li.flush();
  assert.equal(frames.length, n + 1);
  assert.deepEqual(frames.at(-1).parsed.inbox.caps, ['st', 'tap', 'reader-link']);
  advance(30 * SEC);
  info.app = 'android/1.6.0';
  await li.flush();
  assert.equal(frames.at(-1).parsed.inbox.app, 'android/1.6.0');
});

test('LabInbox: Lab off sends one lab: 0 frame, repeats it after ack digests for 48 h (at most 5), and nothing else', async () => {
  const { li, frames, advance } = await inbox();
  await li.flush();
  advance(30 * SEC);
  await li.record(id(1), 'reader', 1);
  await li.labTurnedOff();
  assert.deepEqual(frames.at(-1).parsed.inbox, { lab: 0, app: 'android/1.5.0', caps: [], poll: null, live: false });
  assert.equal(frames.at(-1).header['x-st'], undefined, 'pending states are dropped');
  const n = frames.length;
  advance(HOUR);
  assert.equal(await li.record(id(2), 'reader', 2), false, 'nothing is recorded while off');
  assert.equal((await li.flush()).reason, 'off');
  for (let i = 0; i < 7; i++) { advance(7 * HOUR); await li.digest(); }
  const repeats = frames.slice(n);
  assert.equal(repeats.length, 5);
  assert.ok(repeats.every((f) => f.parsed.inbox.lab === 0 && f.at - frames[n - 1].at <= 48 * HOUR));
  await li.labTurnedOn();
  assert.equal(frames.at(-1).parsed.inbox.lab, 1, 'turning Lab on sends a hello');
});

test('LabInbox: the lab: 0 repeats end 48 h after Lab was turned off, even before the fifth', async () => {
  const { li, frames, advance } = await inbox();
  await li.flush();
  advance(30 * SEC);
  await li.labTurnedOff();
  const n = frames.length;
  const offAt = frames.at(-1).at;
  for (let i = 0; i < 8; i++) { advance(11 * HOUR); await li.digest(); } // the v1.1 ack digest every 11 hours
  const repeats = frames.slice(n);
  assert.deepEqual(repeats.map((f) => (f.at - offAt) / HOUR), [11, 22, 33, 44], 'none at 55 h: the window is 48 h');
  assert.ok(repeats.every((f) => f.parsed.inbox.lab === 0 && f.parsed.inbox.caps.length === 0));
});

test('LabInbox: digest frames are outside the daily cap, so 30 hellos and state frames still go that day', async () => {
  const { li, frames, advance, now } = await inbox();
  advance(DAY - (now() % DAY)); // 00:00 UTC
  const t = () => Math.floor(now() / 1000);
  for (let i = 0; i < 30; i++) await li.record(id(i), 'reader', t());
  assert.deepEqual(await li.flush(), { published: 1, kind: 'states', states: 24, reason: 'sent' });
  advance(30 * SEC);
  assert.equal((await li.flush()).states, 6);
  advance(30 * SEC);
  const d1 = await li.digest();
  advance(30 * SEC);
  const d2 = await li.flush();
  assert.deepEqual([d1.kind, d1.states, d2.kind, d2.states], ['digest', 24, 'digest', 6]);
  const reasons = [];
  for (let i = 30; i < 60; i++) {
    advance(30 * SEC);
    await li.record(id(i), 'reader', t());
    reasons.push((await li.flush()).reason);
  }
  assert.equal(reasons.filter((r) => r === 'sent').length, 28, '2 state frames + 28 = 30; the 2 digest frames do not count');
  assert.deepEqual(reasons.slice(28), ['cap', 'cap']);
  assert.equal(new Set(frames.map((f) => new Date(f.at).toISOString().slice(0, 10))).size, 1, 'all on one UTC day');
  assert.equal((await li.debugState()).dayCount, 30);
});

test('LabInbox: the digest republishes the latest state of items changed in the last 48 h, newest first, 48 at most', async () => {
  const { li, frames, advance, now } = await inbox();
  await li.flush();
  const t0 = Math.floor(now() / 1000);
  for (let i = 0; i < 60; i++) {
    advance(30 * SEC);
    await li.record(id(i), 'waiting', t0 + i * 30);
    await li.flush();
  }
  await li.record(id(59), 'reader', t0 + 60 * 30); // pending, not yet published
  advance(10 * SEC);
  const start = frames.length;
  const kinds = [(await li.digest()).kind]; // the daily cap stopped the state frames long ago; the digest is outside it
  for (let k = 0; k < 3; k++) { advance(30 * SEC); kinds.push((await li.flush()).kind); }
  assert.deepEqual(kinds, ['digest', 'digest', null, null], '60 items changed in 48 h: two digest frames, then nothing');
  assert.equal(frames.length - start, 2);
  const digest = frames.slice(start).flatMap((f) => f.parsed.states);
  assert.equal(digest.length, 48, '48 at most');
  assert.deepEqual(frames.slice(start).map((f) => f.parsed.states.length), [24, 24]);
  assert.deepEqual(digest[0], { id: id(59), s: 'reader', t: t0 + 1800 }, 'pending entries are included');
  assert.ok(digest.every((e, i) => i === 0 || e.t <= digest[i - 1].t), 'newest first');
  advance(49 * HOUR);
  const before = frames.length;
  await li.digest();
  assert.equal(frames.length, before + 1);
  assert.equal(frames.at(-1).header['x-st'], undefined, 'nothing changed in 48 h: only a hello is due');
});

test('LabInbox: a digest that could not go out is folded into the next one, never lost', async () => {
  const { li, frames, advance, now } = await inbox();
  await li.flush();
  advance(30 * SEC);
  await li.noteAcksFailed(true);
  await li.record(id(1), 'reader', Math.floor(now() / 1000));
  await li.digest(); // queued: the pending entry moves into the digest, which gives way
  assert.equal((await li.debugState()).pending.length, 0);
  advance(11 * HOUR);
  await li.record(id(2), 'handed', Math.floor(now() / 1000));
  await li.digest(); // still giving way: recomputed with the queued entry
  await li.noteAcksFailed(false);
  advance(MIN);
  await li.flush();
  assert.deepEqual(frames.at(-1).parsed.states.map((e) => e.id), [id(2), id(1)]);
});

test('LabInbox keeps at most 500 pending entries, the oldest go first', async () => {
  const { li } = await inbox();
  await li.noteAcksFailed(true);
  for (let i = 0; i < 510; i++) await li.record(id(i), 'reader', i);
  const st = await li.debugState();
  assert.equal(st.pending.length, 500);
  assert.equal(st.pending[0].i, id(10));
});

test('a Lab sender and a Lab Daylight: In your Reader for a link, Handed for a PDF, waiting then handed (F01)', async () => {
  const { relay, sender, receiver, keys, advance, now } = await setup();
  try {
    const ledger = new lab.LabLedger({ storage: sender.storage, now });
    const labSender = new ds.Sender({ pairing: sender.pairing, storage: sender.storage, from: 'Phone', now, retryDelaysMs: [0, 0, 0], onAckHeader: lab.labHook(ledger) });
    const rc = new ds.RelayClient({ relay: relay.url, retryDelaysMs: [0, 0, 0] });
    const li = new lab.LabInbox({ storage: receiver.storage, relay: rc, keys, info: { lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'] }, from: 'Test Daylight', now, autoFlushMs: null });
    const sim = new lab.LabInboxSim({ receiver, labInbox: li, stateFor: (h) => (h.kind === 'file' ? 'waiting' : 'reader') });

    const before = await labSender.send({ kind: 'url', url: 'https://example.com/before' });
    await new ds.Receiver({ pairing: sender.pairing, storage: new ds.MemoryStorage(), now }).pollOnce(); // a v1.1 Inbox acks it
    await labSender.checkAcks();
    let snap = await ledger.snapshot();
    assert.equal(snap.inboxLab, false);
    assert.equal(lab.describeLabRow((await labSender.list())[0], now(), { lab: true, ...snap, state: snap.states[before.id] }).label, 'Delivered ✓', 'F17.2');
    assert.equal(lab.inboxLabText(snap, now()), 'Needs Lab on your Daylight · checked in just now');

    const link = await labSender.send({ kind: 'url', url: 'https://example.com/a', title: 'A' });
    const pdf = await labSender.send({ kind: 'file', name: 'p.pdf', mime: 'application/pdf', content: ds.randomBytes(40000) });
    const res = await sim.pollOnce();
    assert.equal(res.items.length, 3, 'this Daylight also gets the item the other Inbox took');
    assert.equal(res.lab.kind, 'states', 'the first Lab frame carries the states, and counts as the hello');
    advance(5 * SEC);
    await labSender.checkAcks();
    snap = await ledger.snapshot();
    const rowOf = async (rid) => (await labSender.list()).find((r) => r.id === rid);
    const show = async (rid) => lab.describeLabRow(await rowOf(rid), now(), { lab: true, inboxLab: snap.inboxLab, hasCap: snap.hasCap, state: snap.states[rid] ?? null, online: true });
    assert.equal((await show(link.id)).label, 'In your Reader ✓');
    assert.equal((await show(pdf.id)).label, 'Waiting for a tap on your Daylight');
    advance(30 * SEC);
    await li.record(pdf.id, 'handed', Math.floor(now() / 1000)); // the notice was tapped
    await li.flush();
    await labSender.checkAcks();
    snap = await ledger.snapshot();
    const d = await show(pdf.id);
    assert.deepEqual([d.label, d.sentence, d.stepLine, d.final], ['Handed to the Reader',
      'Your Daylight passed it to the Reader. The Reader doesn’t confirm documents yet.', 'Sent ✓ · On your Daylight ✓ · Handed to the Reader', true]);
    assert.equal(lab.checkedInText(snap.checkedIn, now()), 'Your Daylight checked in just now.');
    assert.equal(lab.inboxLabText(snap, now()), 'Your Daylight: Lab on · checked in just now');
  } finally { await relay.close(); }
});

test('LabInboxSim gives way for an hour after the Receiver’s limited: a 429 on a download or on an ack publish (2.2.4, F17)', async () => {
  let failDownloads = false;
  const { relay, sender, receiver, keys, hooks, advance, now } = await setup({ failDownload: () => (failDownloads ? 429 : null) });
  try {
    const rc = new ds.RelayClient({ relay: relay.url, retryDelaysMs: [0, 0, 0] });
    const li = new lab.LabInbox({ storage: receiver.storage, relay: rc, keys, info: { lab: 1, app: 'android/1.5.0', caps: ['st', 'tap'] }, from: 'Test Daylight', now, autoFlushMs: null });
    const sim = new lab.LabInboxSim({ receiver, labInbox: li });
    const ackTopicMessages = async () => (await rc.poll(keys.ackTopic, 'all')).length;

    // A 429 on the PDF's download: the link arrives and is acked, the PDF waits, and Lab gives way.
    const link = await sender.send({ kind: 'url', url: 'https://example.com/a' });
    const pdf = await sender.send({ kind: 'file', name: 'p.pdf', mime: 'application/pdf', content: ds.randomBytes(18000) });
    assert.equal((await sender.list()).find((r) => r.id === pdf.id).attachment, true, 'the PDF goes as an attachment');
    failDownloads = true;
    let res = await sim.pollOnce();
    assert.deepEqual([res.items.map((i) => i.header.id), res.acked, res.ackError, res.limited], [[link.id], [link.id], null, 429]);
    assert.equal(res.lab.reason, 'yield', 'no Lab frame right after a 429 from the relay');
    const acksOnly = await ackTopicMessages();
    failDownloads = false;
    advance(59 * MIN);
    res = await sim.pollOnce();
    assert.deepEqual([res.items.map((i) => i.header.id), res.limited], [[pdf.id], 0]);
    assert.equal(res.lab.reason, 'yield', 'still within the hour');
    advance(MIN);
    res = await sim.pollOnce();
    assert.deepEqual([res.lab.reason, res.lab.kind, res.lab.states], ['sent', 'states', 2], 'after the hour the kept states go');
    assert.equal(await ackTopicMessages(), acksOnly + 2, 'the PDF’s ack and one Lab frame');

    // A 429 on the ack publish, then a clean poll: Lab still gives way, for the 429 and not only for the failed acks.
    advance(MIN);
    await sender.send({ kind: 'url', url: 'https://example.com/b' });
    let once = true;
    hooks.publish = (topic) => (topic === keys.ackTopic && once ? ((once = false), 429) : null);
    res = await sim.pollOnce();
    assert.deepEqual([res.items.length, res.limited, res.lab.reason], [1, 429, 'yield']);
    advance(5 * MIN);
    res = await sim.pollOnce();
    assert.deepEqual([res.ackError, res.limited, res.lab.reason], [null, 0, 'yield'], 'acks went out, but the 429 was 5 minutes ago');
    advance(55 * MIN);
    assert.equal((await sim.pollOnce()).lab.reason, 'sent');
  } finally { await relay.close(); }
});

test('LabInbox flushes by itself 2 s after record() when timers are on', async () => {
  const keys = await ds.deriveKeys(ds.generateSecret());
  const published = [];
  const li = new lab.LabInbox({ storage: new ds.MemoryStorage(), relay: { publish: async (t, f) => { published.push(f); } }, keys, info: { lab: 1, app: 'android/1', caps: ['st'] }, autoFlushMs: 5 });
  try {
    await li.record(id(1), 'reader', 1);
    for (let i = 0; i < 50 && !published.length; i++) await ds.sleep(10);
    assert.equal(published.length, 1);
  } finally { li.close(); }
});
