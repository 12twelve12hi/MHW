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
  assert.equal(V.statusText.length, 14, 'the 12 rows of CHANGES-v1.1 2.5, plus failed and expired rows saved by v1.0');
  assert.ok(V.statusText.filter((s) => !('errorCode' in s.row)).length === 2, 'two v1.0 rows without errorCode');
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
  for (const i of [0, 8, 15]) {
    const b = a.slice(); b[i] ^= 1;
    assert.ok(!ds.samePairingSecret({ secret: a }, { secret: b }), `all 16 bytes are compared (byte ${i})`);
  }
  const last = a.slice(); last[15] ^= 1;
  const conf = ds.pairingConfirmation({ secret: a, relay: '', name: 'Old' }, { secret: last, relay: '', name: 'New' });
  assert.equal(conf.ask, true);
  assert.equal(conf.button, 'Switch');
});

test('relayHost names a relay by its normalised host and port, as text', () => {
  assert.equal(ds.relayHost(''), 'ntfy.sh');
  assert.equal(ds.relayHost('https://Relay.Example.org:8443/ntfy/'), 'relay.example.org:8443');
  assert.equal(ds.relayHost('https://relay.example.org:443/ntfy'), 'relay.example.org');
  assert.equal(ds.relayHost('http://[::1]:8080/'), '[::1]:8080');
  assert.equal(ds.relayHost('https://relay.example.org:0443'), 'relay.example.org:0443');
  assert.throws(() => ds.relayHost('ftp://x'), (e) => e.code === 'relay');
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
  for (const bad of ['ftp://x', 'ws://relay.example.org', 'https://', 'https://relay.example.org/../x', 'https://réseau.example', 'https://relay.example.org:x1',
    'https://relay.example.org/a\tb', 'https://relay.example.org/\u2028x', 'http://[fe80::1%en0]/', 'https://[::1]x/', 'https://.', 'https://-x.example/']) {
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

/** Runs fn with a DecompressionStream that counts what it produces. -> the byte count. */
async function countInflated(fn) {
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
    await fn();
    await ds.sleep(50);
  } finally { globalThis.DecompressionStream = Original; }
  return produced;
}

const openBomb = async () => {
  const bomb = V.invalidItems.find((i) => /bomb/.test(i.name));
  const keys = await ds.deriveKeys(ds.fromHex(V.pairing[0].secretHex));
  return ds.decryptFrame(keys, 'inbox', ds.fromHex(bomb.framesHex[0]));
};

test('inflateRaw stops at the limit: a deflate bomb never inflates far', async () => {
  const { body } = await openBomb();
  const produced = await countInflated(() => assert.rejects(ds.inflateRaw(body, 10), (e) => e.code === 'integrity'));
  assert.ok(produced < 70 * 1024, `inflated ${produced} bytes`);
  assert.equal((await ds.inflateRaw(body)).length, 1048576, 'without a limit it is a megabyte');
});

test('the Reassembler inflates no more than the header’s size (the deflate bomb through Reassembler.add)', async () => {
  const { header, body } = await openBomb();
  const produced = await countInflated(() => assert.rejects(new ds.Reassembler().add(header, body), (e) => e.code === 'integrity'));
  assert.ok(produced < 70 * 1024, `inflated ${produced} bytes`);
});

// A RelayClient whose fetch answers a poll with `lines` and attachment GETs with download(url).
const scripted = (lines, download) => new ds.RelayClient({ relay: 'https://relay.example.org', retryDelaysMs: [0, 0, 0],
  fetch: async (url) => (url.includes('/json?') ? new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n') : download(url)) });
const attachmentLine = (id, url = `https://files.example/${id}.bin`) => ({ id, time: 1, event: 'message', message: 'dls1', attachment: { url } });
const zeros = (n, onPull = () => {}) => {
  let o = 0;
  return new ReadableStream({ pull(c) { const k = Math.min(1 << 20, n - o); o += k; onPull(k); c.enqueue(new Uint8Array(k)); if (o >= n) c.close(); } });
};

test('attachment downloads stop at 12,713,984 bytes: a v1.0 12 MiB frame fits, one byte more is junk', async () => {
  assert.equal(ds.MAX_ATTACHMENT, 12713984, 'a literal (v1.0’s 12 MiB chunk + 128 KiB), not derived from CHUNK');
  let pulledDeclared = 0;
  const sizes = { ok: ds.MAX_ATTACHMENT, over: ds.MAX_ATTACHMENT + 1 };
  const rc = scripted(['ok', 'over', 'declared'].map((id) => attachmentLine(id)), async (url) => {
    const id = url.split('/').pop().replace('.bin', '');
    if (id === 'declared') {
      return new Response(zeros(ds.MAX_ATTACHMENT + 1, (k) => { pulledDeclared += k; }), { headers: { 'content-length': String(ds.MAX_ATTACHMENT + 1) } });
    }
    return new Response(zeros(sizes[id])); // no Content-Length: the read itself must stop
  });
  const entries = await rc.poll('t', 'all');
  assert.deepEqual(entries.map((e) => e.outcome), ['frame', 'junk', 'junk']);
  assert.equal(entries[0].frame.length, 12713984);
  assert.equal(entries[1].frame, null, 'nothing of an over-cap body is kept');
  assert.ok(pulledDeclared <= 2 << 20, `an over-cap Content-Length is junk without reading (${pulledDeclared} bytes pulled)`);
});

test('download outcomes: 2xx frame, 404/410 expired, other statuses and network errors retry, a foreign http URL junk', async () => {
  const cases = { a: 200, b: 404, c: 410, d: 403, e: 500, f: 418, g: 'throw' };
  const lines = [...Object.keys(cases).map((id) => attachmentLine(id)), attachmentLine('h', 'http://elsewhere.example/h.bin'),
    { id: 'i', time: 1, event: 'message', message: 'not base64!' }];
  const rc = scripted(lines, async (url) => {
    const s = cases[url.split('/').pop().replace('.bin', '')];
    if (s === 'throw') throw new TypeError('fetch failed');
    return new Response(s === 200 ? new Uint8Array(10) : 'x', { status: s });
  });
  assert.deepEqual((await rc.poll('t', 'all')).map((e) => [e.id, e.outcome]),
    [['a', 'frame'], ['b', 'expired'], ['c', 'expired'], ['d', 'retry'], ['e', 'retry'], ['f', 'retry'], ['g', 'retry'], ['h', 'junk'], ['i', 'junk']]);
});

test('a poll answer over 64 MiB fails the poll with relay, whether declared or streamed', async () => {
  const declared = async () => new Response(zeros(10), { headers: { 'content-length': String(ds.MAX_POLL_RESPONSE + 1) } });
  await assert.rejects(new ds.RelayClient({ relay: 'https://relay.example.org', fetch: declared }).poll('t', 'all'), (e) => e.code === 'relay');
  const chunk = new Uint8Array(8 << 20).fill(10); // newlines
  const streamed = async () => {
    let n = 0;
    return new Response(new ReadableStream({ pull(c) { if (n++ < 8) c.enqueue(chunk); else { c.enqueue(Uint8Array.of(10)); c.close(); } } }));
  };
  await assert.rejects(new ds.RelayClient({ relay: 'https://relay.example.org', fetch: streamed }).poll('t', 'all'), (e) => e.code === 'relay');
});

test('publish maps answers to codes: other 4xx refused at once, 413 full, 429 network at once, 408/5xx/no answer retried in the call', async () => {
  const pub = async (answers, retryAfter) => {
    let calls = 0;
    const f = async () => {
      const a = answers[Math.min(calls++, answers.length - 1)];
      if (a === 'throw') throw new TypeError('fetch failed');
      return new Response('{}', { status: a, headers: retryAfter ? { 'Retry-After': retryAfter } : {} });
    };
    const rc = new ds.RelayClient({ relay: 'https://relay.example.org', fetch: f, retryDelaysMs: [0, 0, 0] });
    try { await rc.publish('t', ds.randomBytes(100)); return { ok: true, calls }; } catch (e) { return { code: e.code, status: e.status, calls }; }
  };
  for (const s of [400, 401, 403, 404, 405, 409, 451]) assert.deepEqual(await pub([s]), { code: 'refused', status: s, calls: 1 }, String(s));
  assert.deepEqual(await pub([413]), { code: 'full', status: 413, calls: 1 });
  assert.deepEqual(await pub([429]), { code: 'network', status: 429, calls: 1 });
  for (const s of [408, 500, 502, 503]) assert.deepEqual(await pub([s]), { code: 'network', status: s, calls: 4 }, String(s));
  assert.deepEqual(await pub(['throw']), { code: 'network', status: 0, calls: 4 });
  assert.deepEqual(await pub([502, 200]), { ok: true, calls: 2 });
  assert.deepEqual(await pub(['throw', 200]), { ok: true, calls: 2 });
});

test('a Retry-After on a 5xx is honoured in the call, at most 60 s', async () => {
  const waits = []; // the in-call waits of 1 s or more (the request deadlines are set below 1 s here)
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => { if (ms >= 1000) { waits.push(ms); ms = 0; } return realSetTimeout(fn, ms, ...a); };
  try {
    let calls = 0;
    const f = async () => { calls++; return new Response('{}', { status: calls <= 2 ? 503 : 200, headers: { 'Retry-After': calls === 1 ? '2' : '600' } }); };
    const rc = new ds.RelayClient({ relay: 'https://relay.example.org', fetch: f, retryDelaysMs: [0, 0, 0], timeouts: { short: 999, long: 999 } });
    await rc.publish('t', ds.randomBytes(100));
    assert.equal(calls, 3);
  } finally { globalThis.setTimeout = realSetTimeout; }
  assert.deepEqual(waits, [2000, 60000]);
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
