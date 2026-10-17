import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ds from '../daylight-share.js';

const V = JSON.parse(readFileSync(new URL('../../vectors/test-vectors.json', import.meta.url), 'utf8'));

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
});

test('invalid frames and headers are refused', async () => {
  const keys = await ds.deriveKeys(ds.fromHex(V.pairing[0].secretHex));
  for (const f of V.invalidFrames) {
    await assert.rejects(ds.decryptFrame(keys, f.purpose, ds.fromHex(f.frameHex)), ds.ShareError, f.name);
  }
  for (const b of V.badHeaders) {
    assert.throws(() => ds.checkItemHeader(b.header), ds.ShareError, b.name);
  }
  for (const f of V.fileNames) assert.equal(ds.safeFileName(f.input), f.expect, f.input);
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
  assert.equal(ds.webUrl('ftp://x.org'), null);
  assert.equal(ds.webUrl('https://exa mple.com'), null);
  assert.equal(ds.webUrl(' https://example.com/x '), 'https://example.com/x');
  assert.equal(ds.normalizeRelay(''), 'https://ntfy.sh');
  assert.equal(ds.normalizeRelay('ntfy.example.org/'), 'https://ntfy.example.org');
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

test('size limits', async () => {
  const keys = await ds.deriveKeys(ds.generateSecret());
  await assert.rejects(ds.buildItemFrames(keys, { kind: 'page', url: 'https://e.com', content: new Uint8Array(ds.MAX_PAGE_HTML + 1) }), /too large/);
  await assert.rejects(ds.buildItemFrames(keys, { kind: 'url', url: 'javascript:alert(1)' }), /web address/);
  await assert.rejects(ds.buildItemFrames(keys, { kind: 'file', name: 'a', content: new Uint8Array(100) }, { chunkSize: 5 }), /too large/);
});
