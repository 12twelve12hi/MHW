import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as ds from '../daylight-share.js';

const V = JSON.parse(readFileSync(new URL('../../vectors/test-vectors.json', import.meta.url), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');

test('pairing vectors: code, link, key and topics', async () => {
  for (const p of V.pairing) {
    const secret = ds.fromHex(p.secretHex);
    assert.equal(await ds.formatCode(secret), p.code, p.label);
    assert.equal(await ds.formatCode(secret, { dashes: false }), p.codeCompact);
    assert.equal(await ds.pairingLink({ secret }), p.link);
    assert.equal(await ds.pairingLink({ secret, relay: 'https://relay.example.org/ntfy/', name: 'Anjan’s Daylight & co' }), p.linkWithRelayAndName);
    const k = await ds.deriveKeys(secret);
    assert.equal(ds.toHex(k.keyBytes), p.keyHex);
    assert.equal(k.inboxTopic, p.inboxTopic);
    assert.equal(k.ackTopic, p.ackTopic);
    assert.match(k.inboxTopic, /^dls-[0-9a-f]{32}$/);
    assert.deepEqual(ds.toHex(await ds.parseCode(p.code)), p.secretHex);
  }
});

test('code parsing vectors', async () => {
  for (const c of V.codeParsing) {
    if (c.error) {
      await assert.rejects(ds.parsePairing(c.input), (e) => e instanceof ds.ShareError && e.reason === c.error, c.name);
    } else {
      const p = await ds.parsePairing(c.input);
      assert.equal(ds.toHex(p.secret), c.secretHex, c.name);
      if (c.relay) assert.equal(p.relay, c.relay, c.name);
      if (c.nameExpected !== undefined) assert.equal(p.name, c.nameExpected, c.name);
    }
  }
  assert.ok(V.codeParsing.some((c) => /0/.test(c.input) && /1/.test(c.input) && /8/.test(c.input) && !c.error));
});

test('relay vectors: the relay URL rule', () => {
  for (const r of V.relays) {
    if (r.error) assert.throws(() => ds.normalizeRelay(r.input), (e) => e instanceof ds.ShareError && e.code === 'relay', r.input);
    else assert.equal(ds.normalizeRelay(r.input), r.expect, r.input);
  }
  assert.throws(() => ds.normalizeRelay('ftp://x'), /http\(s\)/);
});

test('sizing vectors: one chunk and one item limit', async () => {
  assert.equal(V.sizing.chunk, ds.CHUNK);
  assert.equal(V.sizing.maxItem, ds.MAX_ITEM);
  assert.equal(V.sizing.maxHeader, ds.MAX_HEADER);
  assert.equal(V.sizing.largestFrame, ds.CHUNK + ds.MAX_HEADER + 36);
  assert.ok(V.sizing.largestFrame <= 2000000, 'under ntfy.sh’s 2 MB, read as decimal');
  for (const c of V.sizing.cases) {
    if (c.error) assert.ok(c.size > ds.MAX_ITEM);
    else assert.equal(Math.max(1, Math.ceil(c.size / ds.CHUNK)), c.parts, String(c.size));
  }
  const keys = await ds.deriveKeys(ds.generateSecret());
  for (const c of V.sizing.cases.filter((x) => x.size <= 1900545)) {
    const built = await ds.buildItemFrames(keys, { kind: 'file', name: 'x.pdf', mime: 'application/pdf', content: ds.randomBytes(c.size) });
    assert.equal(built.frames.length, c.parts, String(c.size));
  }
});

test('url vectors: the web URL rule', () => {
  for (const u of V.urls) assert.equal(ds.webUrl(u.input), u.expect, JSON.stringify(u.input).slice(0, 80));
});

test('seal vectors reproduce byte for byte and open back', async () => {
  for (const s of V.seal) {
    const keys = await ds.deriveKeys(ds.fromHex(s.secretHex));
    const frame = await ds.sealFrame(keys, s.purpose, ds.utf8(s.headerJson), ds.fromHex(s.bodyHex), ds.fromHex(s.nonceHex));
    assert.equal(ds.toHex(frame), s.frameHex, s.name);
    assert.equal(ds.toBase64(frame), s.frameBase64);
    assert.deepEqual(ds.fromBase64(s.frameBase64), frame);
    const opened = await ds.decryptFrame(keys, s.purpose, frame);
    assert.deepEqual(opened.header, JSON.parse(s.headerJson));
    assert.equal(ds.toHex(opened.body), s.bodyHex);
  }
  assert.ok(V.seal.some((s) => ds.utf8(s.headerJson).length === 65536), 'the 64 KiB header vector');
});

test('item vectors reassemble', async () => {
  const keys = await ds.deriveKeys(ds.fromHex(V.pairing[0].secretHex));
  for (const it of V.items) {
    const r = new ds.Reassembler();
    let done = null;
    for (const fh of it.framesHex) {
      const { header, body } = await ds.decryptFrame(keys, 'inbox', ds.fromHex(fh));
      const res = await r.add(header, body);
      if (res) { assert.equal(done, null, 'completes once'); done = res; }
    }
    assert.ok(done, it.name);
    const { part, parts, ...expectHeader } = it.expect.header;
    for (const [k, v] of Object.entries(expectHeader)) assert.deepEqual(done.header[k], v, `${it.name}: ${k}`);
    if (it.expect.contentUtf8 !== undefined) assert.equal(ds.fromUtf8(done.content), it.expect.contentUtf8);
    else assert.equal(ds.toHex(done.content), it.expect.contentHex);
  }
  const split = V.items.find((i) => /deflate-raw, 3 parts/.test(i.name));
  assert.ok(split.framesHex.length > 1 && split.expect.header.enc === 'deflate-raw', 'a deflate stream split across parts');
});

test('invalid frames, items and headers are refused', async () => {
  const keys = await ds.deriveKeys(ds.fromHex(V.pairing[0].secretHex));
  for (const f of V.invalidFrames) {
    await assert.rejects(ds.decryptFrame(keys, f.purpose, ds.fromHex(f.frameHex)), ds.ShareError, f.name);
  }
  for (const it of V.invalidItems) {
    const r = new ds.Reassembler();
    let failed = null;
    for (const fh of it.framesHex) {
      const { header, body } = await ds.decryptFrame(keys, 'inbox', ds.fromHex(fh));
      ds.checkItemHeader(header); // passes the header checks
      try { await r.add(header, body); } catch (e) { failed = e; }
    }
    assert.ok(failed instanceof ds.ShareError && failed.code === it.error, it.name);
  }
  for (const b of V.badHeaders) {
    assert.match(b.header.sent, /^\d{4}-\d\d-\d\dT/, 'a valid sent');
    assert.throws(() => ds.checkItemHeader(b.header), ds.ShareError, b.name);
  }
});

test('file name vectors', () => {
  for (const f of V.fileNames) assert.equal(ds.safeFileName(f.input), f.expect, f.input);
  for (const f of V.fileNamesUtf16) assert.equal(ds.safeFileName(String.fromCharCode(...f.inputUtf16)), f.expect, f.name);
  for (const f of [...V.fileNames, ...V.fileNamesUtf16]) {
    assert.ok(f.expect.length <= 120 && ds.utf8(f.expect).length <= 200, f.expect);
  }
});

test('ack vectors: 70 ids with the worst `from` stay a small frame', async () => {
  const keys = await ds.deriveKeys(ds.fromHex(V.pairing[0].secretHex));
  for (const a of V.acks) {
    const ids = a.idLabels.map((l) => sha(l).slice(0, 32));
    const header = { v: 1, kind: 'ack', ids, sent: a.sent, from: a.from };
    assert.equal(JSON.stringify(header), a.headerJson, a.name);
    const frame = await ds.encryptFrame(keys, 'ack', header, new Uint8Array(0));
    assert.equal(frame.length, a.frameLength, a.name);
    assert.equal(ds.isSmallFrame(frame), a.small, a.name);
    const built = await ds.buildAckFrame(keys, ids, { from: a.from, sent: a.sent });
    assert.ok(ds.isSmallFrame(built), 'buildAckFrame always makes a small frame');
    const { header: opened } = await ds.decryptFrame(keys, 'ack', built);
    assert.equal(opened.ids.length, Math.min(ids.length, ds.MAX_ACK_IDS));
  }
  assert.equal(ds.MAX_ACK_IDS, 70);
});

test('status text vectors: describeRow and formatMB', () => {
  assert.equal(V.statusText.length, 12);
  for (const s of V.statusText) {
    assert.deepEqual(ds.describeRow(s.row, s.now), { label: s.label, sentence: s.sentence, action: s.action }, s.name);
  }
  for (const f of V.formatMB) assert.equal(ds.formatMB(f.bytes), f.expect, String(f.bytes));
  assert.equal(ds.tooBigMessage(14200000), 'Too big to send. Files can be up to 9 MB; this one is 14.2 MB.');
});

test('pairing confirmation vectors', () => {
  const p = (x) => x && { secret: ds.fromHex(x.secretHex), relay: x.relay, name: x.name };
  for (const c of V.pairingConfirmation) {
    assert.deepEqual(ds.pairingConfirmation(p(c.current), p(c.next), { source: c.source }), c.expect, c.name);
  }
  const a = ds.generateSecret();
  assert.ok(ds.samePairingSecret({ secret: a }, { secret: a.slice() }));
  assert.ok(!ds.samePairingSecret({ secret: a }, { secret: ds.generateSecret() }));
  assert.ok(!ds.samePairingSecret(null, { secret: a }));
});

test('base32/base64 round trips at every length', () => {
  for (let n = 0; n < 70; n++) {
    const b = ds.randomBytes(n);
    assert.deepEqual(ds.fromBase64(ds.toBase64(b)), b);
    assert.equal(ds.toBase64(b), Buffer.from(b).toString('base64'));
  }
  assert.throws(() => ds.fromBase64('ab$d'));
  assert.throws(() => ds.fromBase64('a'));
});

test('url helpers', () => {
  assert.equal(ds.findUrl('Read this: https://example.com/a?b=1. Great'), 'https://example.com/a?b=1');
  assert.equal(ds.findUrl('no link here'), null);
  assert.equal(ds.findUrl('see https:/example.com/x'), null);
  assert.equal(ds.webUrl('ftp://x.org'), null);
  assert.equal(ds.webUrl('https://exa mple.com'), null);
  assert.equal(ds.webUrl(' https://example.com/x '), 'https://example.com/x');
  assert.equal(ds.normalizeRelay(''), 'https://ntfy.sh');
  assert.equal(ds.normalizeRelay('ntfy.example.org/'), 'https://ntfy.example.org');
});

test('normalizeRelay refuses what is not an http(s) relay', () => {
  for (const bad of ['ftp://x', 'ws://relay.example.org', 'https://', 'https://relay.example.org/../x', 'https://réseau.example', 'https://relay.example.org:x1']) {
    assert.throws(() => ds.normalizeRelay(bad), (e) => e.code === 'relay', bad);
  }
});

test('fresh frames round trip for every kind, with and without compression', async () => {
  const keys = await ds.deriveKeys(ds.generateSecret());
  const big = new Uint8Array(30000).map(() => Math.floor(Math.random() * 256));
  const cases = [
    { kind: 'url', url: 'https://example.com/' },
    { kind: 'page', url: 'https://example.com/', content: '<p>hi</p>'.repeat(5000) },
    { kind: 'file', name: 'x.pdf', mime: 'application/pdf', content: big },
    { kind: 'file', name: 'x.md', mime: 'text/markdown', content: '# t\n'.repeat(3000) },
  ];
  for (const c of cases) {
    const built = await ds.buildItemFrames(keys, c, { chunkSize: 7000 });
    const r = new ds.Reassembler();
    let done;
    for (const f of built.frames.reverse()) {
      const { header, body } = await ds.decryptFrame(keys, 'inbox', f);
      done = (await r.add(header, body)) ?? done;
    }
    assert.ok(done, c.kind);
    if (c.content) assert.deepEqual(done.content, typeof c.content === 'string' ? ds.utf8(c.content) : c.content);
    if (c.mime === 'text/markdown' || c.kind === 'page') assert.equal(done.header.enc, 'deflate-raw');
    if (c.mime === 'application/pdf') assert.equal(done.header.enc, 'identity');
  }
});

test('a deflate-raw stream split across parts reassembles (finding 23)', async () => {
  const keys = await ds.deriveKeys(ds.generateSecret());
  const content = '# t\n'.repeat(3000);
  // It deflates to 35 bytes, so chunks of 16 split the one deflate stream into 3 parts.
  const built = await ds.buildItemFrames(keys, { kind: 'file', name: 'x.md', mime: 'text/markdown', content }, { chunkSize: 16 });
  assert.equal(built.header.enc, 'deflate-raw');
  assert.ok(built.frames.length > 1, `${built.frames.length} parts`);
  const r = new ds.Reassembler();
  let done = null;
  for (const f of built.frames) {
    const { header, body } = await ds.decryptFrame(keys, 'inbox', f);
    done = (await r.add(header, body)) ?? done;
  }
  assert.equal(ds.fromUtf8(done.content), content);
});

test('inflateRaw stops at the limit: a deflate bomb never inflates far', async () => {
  const bomb = V.invalidItems.find((i) => /bomb/.test(i.name));
  const keys = await ds.deriveKeys(ds.fromHex(V.pairing[0].secretHex));
  const { body } = await ds.decryptFrame(keys, 'inbox', ds.fromHex(bomb.framesHex[0]));
  const Original = globalThis.DecompressionStream;
  let produced = 0;
  globalThis.DecompressionStream = class {
    constructor(format) {
      const d = new Original(format);
      const counter = new TransformStream({ transform(chunk, ctl) { produced += chunk.length; ctl.enqueue(chunk); } });
      d.readable.pipeTo(counter.writable).catch(() => {});
      this.writable = d.writable; this.readable = counter.readable;
    }
  };
  try {
    await assert.rejects(ds.inflateRaw(body, 10), (e) => e.code === 'integrity');
    await ds.sleep(50);
  } finally { globalThis.DecompressionStream = Original; }
  assert.ok(produced < 70 * 1024, `inflated ${produced} bytes`);
  assert.equal((await ds.inflateRaw(body)).length, 1048576, 'without a limit it is a megabyte');
});

test('size limits', async () => {
  const keys = await ds.deriveKeys(ds.generateSecret());
  await assert.rejects(ds.buildItemFrames(keys, { kind: 'page', url: 'https://e.com', content: new Uint8Array(ds.MAX_PAGE_HTML + 1) }), /too large/);
  await assert.rejects(ds.buildItemFrames(keys, { kind: 'url', url: 'javascript:alert(1)' }), /web address/);
  await assert.rejects(ds.buildItemFrames(keys, { kind: 'url', url: 'https:/example.com/x' }), /web address/);
  await assert.rejects(ds.buildItemFrames(keys, { kind: 'file', name: 'a', content: new Uint8Array(100) }, { chunkSize: 5 }), /too large/);
});

test('a 9,000,000-byte PDF goes in 5 frames, each at most 1,966,116 bytes', async () => {
  const keys = await ds.deriveKeys(ds.generateSecret());
  const built = await ds.buildItemFrames(keys, { kind: 'file', name: 'big.pdf', mime: 'application/pdf', content: ds.randomBytes(9000000) });
  assert.equal(built.frames.length, 5);
  for (const f of built.frames) assert.ok(f.length <= 1966116, String(f.length));
  assert.ok(built.attachment);
});

test('content over 9,000,000 bytes is refused before compression, with the size in the message', async () => {
  const keys = await ds.deriveKeys(ds.generateSecret());
  await assert.rejects(ds.buildItemFrames(keys, { kind: 'file', name: 'big.pdf', mime: 'application/pdf', content: new Uint8Array(9000001) }),
    (e) => e.code === 'too-large' && e.message === 'Too big to send. Files can be up to 9 MB; this one is 9.1 MB.');
  await assert.rejects(ds.buildItemFrames(keys, { kind: 'file', name: 'big.txt', mime: 'text/plain', content: new Uint8Array(9000001).fill(65) }),
    (e) => e.code === 'too-large' && /9\.1 MB/.test(e.message), 'the limit is on size, though it compresses');
});

test('a header over 65,536 bytes is never sealed', async () => {
  const keys = await ds.deriveKeys(ds.generateSecret());
  const base = '{"v":1,"x-pad":""}'.length;
  await ds.encryptFrame(keys, 'inbox', { v: 1, 'x-pad': 'a'.repeat(65536 - base) }, new Uint8Array(0));
  await assert.rejects(ds.encryptFrame(keys, 'inbox', { v: 1, 'x-pad': 'a'.repeat(65537 - base) }, new Uint8Array(0)),
    (e) => e.code === 'header');
});

test('describeRow treats rows saved by v1.0 (no errorCode) as plain failures and expiries', () => {
  const now = Date.now();
  assert.equal(ds.describeRow({ status: 'failed', created: now }, now).action, 'retry-now');
  assert.equal(ds.describeRow({ status: 'expired', created: now }, now).action, 'try-again');
});

test('the Reassembler keeps first-part times and message ids, and prunes', async () => {
  let clock = 1_000_000_000_000;
  const keys = await ds.deriveKeys(ds.generateSecret());
  const built = await ds.buildItemFrames(keys, { kind: 'file', name: 'x.pdf', mime: 'application/pdf', content: ds.randomBytes(3000) }, { chunkSize: 1000 });
  const r = new ds.Reassembler({ now: () => clock });
  const open = async (f) => ds.decryptFrame(keys, 'inbox', f);
  const f0 = await open(built.frames[0]);
  assert.equal(await r.add(f0.header, f0.body, { time: clock / 1000, msgId: 'm0' }), null);
  assert.ok(r.isPending(built.id));
  clock += ds.INCOMPLETE_TTL_MS + 1000;
  assert.deepEqual(r.prune(ds.INCOMPLETE_TTL_MS), [built.id]);
  assert.ok(!r.isPending(built.id));
  for (const [i, f] of built.frames.entries()) {
    const { header, body } = await open(f);
    const done = await r.add(header, body, { time: clock / 1000, msgId: `n${i}` });
    if (i === 2) assert.deepEqual(done.msgIds.sort(), ['n0', 'n1', 'n2']);
  }
  const g = await open(built.frames[1]);
  await r.add(g.header, g.body, { msgId: 'x' });
  assert.deepEqual(r.drop(built.id), ['x']);
});
