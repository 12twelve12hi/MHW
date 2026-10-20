// Writes test-vectors.json from the JavaScript reference implementation. Run: node generate.mjs
// The vectors are deterministic (fixed secrets and nonces) except the deflate-raw bytes in `items`, which come from
// whatever zlib the generator ran with: implementations must DECODE those frames, not reproduce them byte for byte.
// (The deflate bomb in `invalidItems` is built by hand below, so it is the same everywhere.)

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import assert from 'node:assert/strict';
import {
  formatCode, pairingLink, deriveKeys, sealFrame, encryptFrame, buildItemFrames, buildAckFrame, utf8, toHex, toBase64,
  fromHex, isSmallFrame, describeRow, formatMB, pairingConfirmation, normalizeRelay, webUrl, safeFileName,
  PURPOSE_INBOX, PURPOSE_ACK, CHUNK, MAX_ITEM, MAX_HEADER, MAX_ACK_IDS,
} from '../js/daylight-share.js';

const h = (s) => createHash('sha256').update(s).digest();
const secretFrom = (label) => new Uint8Array(h(label).subarray(0, 16));
const nonceFrom = (label) => new Uint8Array(h('nonce/' + label).subarray(0, 12));
const SENT = '2026-10-17T22:00:00.000Z';

const secrets = [
  { label: 'vector-secret-1', secret: secretFrom('vector-secret-1') },
  { label: 'vector-secret-2', secret: secretFrom('vector-secret-2') },
  { label: 'all-zero', secret: new Uint8Array(16) },
  { label: 'all-ff', secret: new Uint8Array(16).fill(0xff) },
];

const pairing = [];
for (const { label, secret } of secrets) {
  const k = await deriveKeys(secret);
  pairing.push({
    label,
    secretHex: toHex(secret),
    code: await formatCode(secret),
    codeCompact: await formatCode(secret, { dashes: false }),
    link: await pairingLink({ secret }),
    linkWithRelayAndName: await pairingLink({ secret, relay: 'https://relay.example.org/ntfy/', name: 'Anjan’s Daylight & co' }),
    keyHex: toHex(k.keyBytes),
    inboxTopic: k.inboxTopic,
    ackTopic: k.ackTopic,
  });
}

const s1 = secrets[0].secret;
const code1 = pairing[0].codeCompact;
const k1 = await deriveKeys(s1);

// Typed-code parsing: inputs a user might type, and ones that must be refused.
const lowerSpaced = code1.toLowerCase().match(/.{1,4}/g).join(' ');
const swapped = code1.replace(/O/g, '0').replace(/I/g, '1').replace(/B/g, '8');
const typo = code1.slice(0, 5) + (code1[5] === 'A' ? 'B' : 'A') + code1.slice(6);
const lookalike = secretFrom('vector-lookalike-5');
const lookalikeCode = await formatCode(lookalike, { dashes: false });
assert.equal(lookalikeCode, 'V5NHVYBMSZPOPZIDLP2OP6P54VLA');
const lookalikeInput = lookalikeCode.replace(/O/g, '0').replace(/I/g, '1').replace(/B/g, '8');
assert.equal(lookalikeInput, 'V5NHVY8MSZP0PZ1DLP20P6P54VLA');
const codeParsing = [
  { name: 'canonical with dashes', input: pairing[0].code, secretHex: pairing[0].secretHex },
  { name: 'compact', input: code1, secretHex: pairing[0].secretHex },
  { name: 'lowercase with spaces', input: lowerSpaced, secretHex: pairing[0].secretHex },
  { name: 'look-alike digits 0 1 8', input: swapped, secretHex: pairing[0].secretHex },
  { name: 'look-alike digits 0 and 1 (and 8): O, I and B typed as digits', input: lookalikeInput, secretHex: toHex(lookalike) },
  { name: 'underscores and dots', input: code1.match(/.{1,4}/g).join('_').replace(/_/, '.'), secretHex: pairing[0].secretHex },
  { name: 'pairing link', input: pairing[0].link, secretHex: pairing[0].secretHex, relay: 'https://ntfy.sh', nameExpected: '' },
  { name: 'pairing link with relay and name', input: pairing[0].linkWithRelayAndName, secretHex: pairing[0].secretHex, relay: 'https://relay.example.org/ntfy', nameExpected: 'Anjan’s Daylight & co' },
  { name: 'one character changed (checksum)', input: typo, error: 'checksum' },
  { name: 'too short', input: code1.slice(0, 27), error: 'format' },
  { name: 'too long', input: code1 + 'A', error: 'format' },
  { name: 'bad character', input: code1.slice(0, 27) + '9', error: 'format' },
  { name: 'empty', input: '', error: 'format' },
];

// The relay URL rule (PROTOCOL 1.3).
const relayCases = [
  ['', 'https://ntfy.sh'],
  ['ntfy.sh', 'https://ntfy.sh'],
  ['https://ntfy.sh/', 'https://ntfy.sh'],
  ['https://NTFY.sh:443', 'https://ntfy.sh'],
  ['HTTPS://Relay.Example.org:443/ntfy//', 'https://relay.example.org/ntfy'],
  ['http://192.168.1.10:8080', 'http://192.168.1.10:8080'],
  ['relay.example.org:8443/', 'https://relay.example.org:8443'],
  ['https://relay.example.org/ntfy?x=1#y', 'https://relay.example.org/ntfy'],
  ['https://user:pw@relay.example.org', 'https://relay.example.org'],
  ['http://[::1]:8080/', 'http://[::1]:8080'],
  ['  https://relay.example.org/ntfy/  ', 'https://relay.example.org/ntfy'],
  ['http://relay.example.org:80/', 'http://relay.example.org'],
  ['https://relay.example.org:/ntfy', 'https://relay.example.org/ntfy'],
  ['https://xn--bcher-kva.example/', 'https://xn--bcher-kva.example'],
  ['ftp://x', null],
  ['https://', null],
  ['https://relay.example.org/a/../ntfy', null],
  ['https://relay.example.org/./ntfy', null],
  ['https://bücher.example/', null],
  ['https://relay.example.org:84a/', null],
  ['https://relay example.org/', null],
];
const relays = relayCases.map(([input, expect]) => {
  let got;
  try { got = normalizeRelay(input); } catch (e) { assert.equal(e.code, 'relay'); got = null; }
  assert.equal(got, expect, input);
  return expect === null ? { input, error: 'relay' } : { input, expect };
});

// Sizing: the one chunk and item limit every sender uses (PROTOCOL 2.3, 3.5).
const largestFrame = CHUNK + MAX_HEADER + 36;
assert.equal(largestFrame, 1966116);
const sizingCases = [1, 1900544, 1900545, 9000000, 9000001];
const sizing = { chunk: CHUNK, maxItem: MAX_ITEM, maxHeader: MAX_HEADER, largestFrame, cases: [] };
for (const size of sizingCases) {
  const content = new Uint8Array(size).map((_, i) => (i * 131 + (i >> 8) * 7) & 0xff);
  try {
    const built = await buildItemFrames(k1, { kind: 'file', name: 'sizing.pdf', mime: 'application/pdf', content, sent: SENT });
    assert.equal(built.frames.length, Math.ceil(size / CHUNK));
    for (const f of built.frames) assert.ok(f.length <= largestFrame);
    sizing.cases.push({ size, parts: built.frames.length });
  } catch (e) {
    assert.equal(e.code, 'too-large', String(e));
    sizing.cases.push({ size, error: 'too-large' });
  }
}
assert.deepEqual(sizing.cases.map((c) => c.parts ?? c.error), [1, 1, 2, 5, 'too-large']);

// The web URL rule (PROTOCOL 4): refused (null) or accepted unchanged after trimming.
const url4096 = 'https://example.com/' + 'a'.repeat(4096 - 20);
assert.equal(url4096.length, 4096);
const urlCases = [
  ['https:/example.com/story', null],
  ['https:example.com/story', null],
  ['https:\\\\example.com\\story', null],
  ['https://.example.com/story', null],
  ['https://example.com:8a/x', null],
  ['https://a.b:1:2/', null],
  ['https://example.com/a b', null],
  ['https://[::1', null],
  ['javascript:alert(1)', null],
  ['https://', null],
  ['https://?q=1', null],
  ['https://exa|mple.com/', null],
  ['https://example.com\\story', null],
  ['https://example.com/\u0000', null],
  ['https://example.com/\u00a0x', null],
  [url4096 + 'a', null],
  ['ftp://example.com/', null],
  ['https://example.com:99999/x', 'https://example.com:99999/x'],
  ['HTTPS://EXAMPLE.COM/A', 'HTTPS://EXAMPLE.COM/A'],
  ['https://bücher.de/', 'https://bücher.de/'],
  ['https://user:pw@example.com/', 'https://user:pw@example.com/'],
  ['https://[::1]:8080/', 'https://[::1]:8080/'],
  ['https://example.com:/x', 'https://example.com:/x'],
  ['https://example.com/\u200bx', 'https://example.com/\u200bx'],
  [url4096, url4096],
  [' https://example.com/x ', 'https://example.com/x'],
  ['http://example.com', 'http://example.com'],
];
const urls = urlCases.map(([input, expect]) => {
  assert.equal(webUrl(input), expect, input);
  return { input, expect };
});

// Low-level seal vectors: exact header bytes + body + nonce -> exact frame. Every implementation must reproduce these.
const seal = async (name, purpose, headerJson, body, nonceLabel) => {
  const nonce = nonceFrom(nonceLabel);
  const frame = await sealFrame(k1, purpose, utf8(headerJson), body, nonce);
  return { name, purpose, secretHex: toHex(s1), nonceHex: toHex(nonce), headerJson, bodyHex: toHex(body), frameHex: toHex(frame), frameBase64: toBase64(frame) };
};
const padHeader = (bytes) => { const base = '{"v":1,"x-pad":""}'; return `{"v":1,"x-pad":"${'a'.repeat(bytes - base.length)}"}`; };
const headerMax = padHeader(MAX_HEADER);
assert.equal(utf8(headerMax).length, 65536);
const sealVectors = [
  await seal('url item', PURPOSE_INBOX,
    JSON.stringify({ v: 1, id: '00112233445566778899aabbccddeeff', kind: 'url', url: 'https://example.com/articles/42?ref=share#top', title: 'An article — with “quotes” and ünïcödé', sent: '2026-10-17T22:00:00.000Z', from: 'iPhone', app: 'ios/1.0.0' }),
    new Uint8Array(0), 'url'),
  await seal('ack', PURPOSE_ACK,
    JSON.stringify({ v: 1, kind: 'ack', ids: ['00112233445566778899aabbccddeeff', 'ffeeddccbbaa99887766554433221100'], sent: '2026-10-17T22:01:00.000Z', from: 'Daylight' }),
    new Uint8Array(0), 'ack'),
  await seal('file item, identity body', PURPOSE_INBOX,
    JSON.stringify({ v: 1, id: '0123456789abcdef0123456789abcdef', kind: 'file', name: 'note.md', mime: 'text/markdown', size: 27, sha256: toHex(h('# Hello\n\nFrom the vectors.\n')), sent: '2026-10-17T22:02:00.000Z', from: 'Mac' }),
    utf8('# Hello\n\nFrom the vectors.\n'), 'file'),
  await seal('empty-object header with v only (receivers reject as an item, but it decrypts)', PURPOSE_INBOX, '{"v":1}', Uint8Array.of(1, 2, 3), 'empty'),
  await seal('header of exactly 65,536 bytes (the largest a receiver accepts)', PURPOSE_INBOX, headerMax, new Uint8Array(0), 'header-max'),
];

// Whole-item decode vectors: frames as a sender would publish them -> expected header and content after reassembly.
const html = `<!doctype html><html><head><title>Walden</title></head><body><article><h1>Where I Lived</h1>${'<p>I went to the woods because I wished to live deliberately, to front only the essential facts of life.</p>'.repeat(40)}</article></body></html>`;
const pageBuilt = await buildItemFrames(k1, { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', kind: 'page', url: 'https://example.com/walden', title: 'Walden', content: html, sent: '2026-10-17T22:03:00.000Z', from: 'Chrome', app: 'chrome/1.0.0' }, { nonces: [nonceFrom('page')] });
const fileBytes = new Uint8Array(1000).map((_, i) => (i * 37 + 11) & 0xff);
const fileBuilt = await buildItemFrames(k1, { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', kind: 'file', name: 'paper.pdf', mime: 'application/pdf', title: 'A paper', content: fileBytes, sent: '2026-10-17T22:04:00.000Z', from: 'Android' }, { chunkSize: 400, nonces: [0, 1, 2].map((i) => nonceFrom('chunk' + i)) });
const textContent = 'plain text '.repeat(500);
const textBuilt = await buildItemFrames(k1, { id: 'cccccccccccccccccccccccccccccccc', kind: 'file', name: 'notes.txt', mime: 'text/plain', content: textContent, sent: '2026-10-17T22:05:00.000Z' }, { chunkSize: 16, nonces: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => nonceFrom('text' + i)) });
// A deflate-raw stream split across parts: receivers must join the parts before inflating.
assert(textBuilt.header.enc === 'deflate-raw' && 1 < textBuilt.frames.length && textBuilt.frames.length <= 8, `text item: ${textBuilt.frames.length} parts`);
const urlBuilt = await buildItemFrames(k1, { id: 'dddddddddddddddddddddddddddddddd', kind: 'url', url: 'https://www.newyorker.com/magazine/2026/10/19/example', title: 'Example', sent: '2026-10-17T22:06:00.000Z' }, { nonces: [nonceFrom('url2')] });
const rotate = (frames) => [frames[frames.length - 1], ...frames.slice(0, -1)]; // 3 parts: [2, 0, 1]

const items = [
  { name: 'page, deflate-raw, one frame', framesHex: pageBuilt.frames.map(toHex), expect: { header: { ...pageBuilt.header }, contentUtf8: html } },
  { name: 'pdf file, identity, 3 parts (chunk 400)', framesHex: fileBuilt.frames.map(toHex), expect: { header: { ...fileBuilt.header }, contentHex: toHex(fileBytes) } },
  { name: 'text file, deflate-raw, 3 parts (chunk 16)', framesHex: textBuilt.frames.map(toHex), expect: { header: { ...textBuilt.header }, contentUtf8: textContent } },
  { name: 'text file, deflate-raw, parts out of order', framesHex: rotate(textBuilt.frames).map(toHex), expect: { header: { ...textBuilt.header }, contentUtf8: textContent } },
  { name: 'url', framesHex: urlBuilt.frames.map(toHex), expect: { header: { ...urlBuilt.header }, contentHex: '' } },
  { name: 'pdf file, parts delivered out of order', framesHex: [fileBuilt.frames[2], fileBuilt.frames[0], fileBuilt.frames[1]].map(toHex), expect: { header: { ...fileBuilt.header }, contentHex: toHex(fileBytes) } },
];

// Frames every implementation must refuse.
const urlFrame = fromHex(sealVectors[0].frameHex);
const tampered = urlFrame.slice(); tampered[tampered.length - 20] ^= 1;
const badMagic = urlFrame.slice(); badMagic[3] = 0x32;
const ackFrame = await buildAckFrame(k1, ['00112233445566778899aabbccddeeff'], { sent: '2026-10-17T22:07:00.000Z', nonce: nonceFrom('ack2') });
const otherKeys = await deriveKeys(secrets[1].secret);
const otherFrame = await sealFrame(otherKeys, PURPOSE_INBOX, utf8(sealVectors[0].headerJson), new Uint8Array(0), nonceFrom('other'));
const headerOver = await sealFrame(k1, PURPOSE_INBOX, utf8(padHeader(MAX_HEADER + 1)), new Uint8Array(0), nonceFrom('header-over'));
const invalidFrames = [
  { name: 'one ciphertext bit flipped', purpose: PURPOSE_INBOX, frameHex: toHex(tampered) },
  { name: 'bad magic', purpose: PURPOSE_INBOX, frameHex: toHex(badMagic) },
  { name: 'ack frame read as an inbox frame (aad differs)', purpose: PURPOSE_INBOX, frameHex: toHex(ackFrame) },
  { name: 'inbox frame read as an ack frame', purpose: PURPOSE_ACK, frameHex: sealVectors[0].frameHex },
  { name: 'sealed with another pairing', purpose: PURPOSE_INBOX, frameHex: toHex(otherFrame) },
  { name: 'truncated', purpose: PURPOSE_INBOX, frameHex: sealVectors[0].frameHex.slice(0, 60) },
  { name: 'header of 65,537 bytes', purpose: PURPOSE_INBOX, frameHex: toHex(headerOver) },
];

// Raw DEFLATE (fixed Huffman codes) of n zero bytes: a literal 0, then matches of up to 258 bytes at distance 1.
// Built by hand so the bytes do not depend on a zlib version.
function zerosDeflate(n) {
  const out = [];
  let acc = 0, nb = 0;
  const bits = (v, k) => { for (let i = 0; i < k; i++) { acc |= ((v >> i) & 1) << nb; if (++nb === 8) { out.push(acc); acc = 0; nb = 0; } } };
  const code = (c, k) => { for (let i = k - 1; i >= 0; i--) bits((c >> i) & 1, 1); };
  const sym = (s) => (s <= 143 ? code(0x30 + s, 8) : s <= 255 ? code(0x190 + s - 144, 9) : s <= 279 ? code(s - 256, 7) : code(0xc0 + s - 280, 8));
  const LENGTHS = [[3, 257, 0], [4, 258, 0], [5, 259, 0], [6, 260, 0], [7, 261, 0], [8, 262, 0], [9, 263, 0], [10, 264, 0],
    [11, 265, 1], [13, 266, 1], [15, 267, 1], [17, 268, 1], [19, 269, 2], [23, 270, 2], [27, 271, 2], [31, 272, 2],
    [35, 273, 3], [43, 274, 3], [51, 275, 3], [59, 276, 3], [67, 277, 4], [83, 278, 4], [99, 279, 4], [115, 280, 4],
    [131, 281, 5], [163, 282, 5], [195, 283, 5], [227, 284, 5]];
  const match = (len) => {
    if (len === 258) sym(285);
    else { const [base, s, extra] = LENGTHS.filter(([b]) => b <= len).pop(); sym(s); bits(len - base, extra); }
    code(0, 5); // distance 1
  };
  bits(1, 1); bits(1, 2); // BFINAL = 1, BTYPE = 01 (fixed Huffman)
  sym(0);
  let left = n - 1;
  while (left >= 258) { match(258); left -= 258; }
  if (left >= 3) { match(left); left = 0; }
  while (left-- > 0) sym(0);
  sym(256);
  if (nb) out.push(acc);
  return Uint8Array.from(out);
}
const bomb = zerosDeflate(1048576);
const bombOut = inflateRawSync(bomb);
assert(bombOut.length === 1048576 && bombOut.every((b) => b === 0));

// Items whose frames decrypt and whose headers pass the checks, but which must fail reassembly with an integrity error,
// without inflating more than `size` bytes.
const fileHeader = (id, extra) => ({ v: 1, id, kind: 'file', name: 'x.txt', mime: 'text/plain', sent: SENT, ...extra });
const twenty = utf8('twenty bytes of text');
const invalidItems = [
  { name: 'deflate bomb: size 10, body inflates to 1,048,576 zero bytes', frames: [await encryptFrame(k1, PURPOSE_INBOX,
    fileHeader('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', { size: 10, sha256: toHex(h(new Uint8Array(10))), enc: 'deflate-raw' }), bomb, nonceFrom('bomb'))] },
  { name: 'size too small: identity body of 20 bytes, size 10', frames: [await encryptFrame(k1, PURPOSE_INBOX,
    fileHeader('ffffffffffffffffffffffffffffffff', { size: 10, sha256: toHex(h(twenty)) }), twenty, nonceFrom('size-small'))] },
  { name: 'sha256 mismatch', frames: [await encryptFrame(k1, PURPOSE_INBOX,
    fileHeader('abababababababababababababababab', { size: 11, sha256: toHex(h('hello world!')) }), utf8('hello world'), nonceFrom('sha-mismatch'))] },
].map(({ name, frames }) => ({ name, framesHex: frames.map(toHex), error: 'integrity' }));

// Item headers a receiver must refuse even though they decrypt (untrusted input).
const ID = '00112233445566778899aabbccddeeff';
const badHeaders = [
  { name: 'javascript url', header: { v: 1, id: ID, kind: 'url', url: 'javascript:alert(1)', sent: SENT } },
  { name: 'file url scheme', header: { v: 1, id: ID, kind: 'url', url: 'file:///etc/passwd', sent: SENT } },
  { name: 'short id', header: { v: 1, id: '0011', kind: 'url', url: 'https://example.com', sent: SENT } },
  { name: 'unknown kind', header: { v: 1, id: ID, kind: 'exe', url: 'https://example.com', sent: SENT } },
  { name: 'file without sha256', header: { v: 1, id: ID, kind: 'file', name: 'a.pdf', mime: 'application/pdf', size: 3, sent: SENT } },
  { name: 'part out of range', header: { v: 1, id: ID, kind: 'file', name: 'a.pdf', mime: 'application/pdf', size: 3, sha256: '0'.repeat(64), part: 3, parts: 3, sent: SENT } },
  { name: 'unknown enc', header: { v: 1, id: ID, kind: 'file', name: 'a.pdf', mime: 'application/pdf', size: 3, sha256: '0'.repeat(64), enc: 'gzip', sent: SENT } },
  { name: 'page size over 8 MiB', header: { v: 1, id: ID, kind: 'page', url: 'https://example.com/', mime: 'text/html', size: 8388609, sha256: '0'.repeat(64), sent: SENT } },
  { name: 'file size over 256 MiB', header: { v: 1, id: ID, kind: 'file', name: 'a.pdf', mime: 'application/pdf', size: 268435457, sha256: '0'.repeat(64), sent: SENT } },
];

const fileNameCases = [
  ['../../etc/passwd', 'etc passwd'],
  ['C:\\Users\\me\\report.pdf', 'C Users me report.pdf'],
  ['  .hidden.pdf ', 'hidden.pdf'],
  ['', 'document'],
  ['a'.repeat(200) + '.pdf', 'a'.repeat(116) + '.pdf'],
  ['. .hidden', 'hidden'],
  ['.. ..profile', 'profile'],
  ['x/ . .bashrc', 'x bashrc'],
  ['a'.repeat(115) + '😀'.repeat(5) + '.pdf', 'a'.repeat(115) + '.pdf'],
  ['x'.repeat(150) + '.webarchive', 'x'.repeat(109) + '.webarchive'],
  ['x'.repeat(150) + '.properties1', 'x'.repeat(120)],
  ['日本語のファイル名'.repeat(12) + '.pdf', [...'日本語のファイル名'.repeat(12)].slice(0, 65).join('') + '.pdf'],
  ['한국어파일이름'.repeat(15) + '.epub', [...'한국어파일이름'.repeat(15)].slice(0, 65).join('') + '.epub'],
  ['a\u00a0\u3000b\ufeff.pdf', 'a b .pdf'],
  ['a\u0000b\u007fc\u0085d.pdf', 'a b c d.pdf'],
  ['report.', 'report.'],
  ['...', 'document'],
];
const fileNames = fileNameCases.map(([input, expect]) => {
  assert.equal(safeFileName(input), expect, input);
  return { input, expect };
});
assert.equal(utf8(fileNames[11].expect).length, 199);
assert.equal(utf8(fileNames[12].expect).length, 200);

const fileNamesUtf16 = [
  { name: 'a lone high surrogate is removed', inputUtf16: [97, 0xd83d, 98, 46, 112, 100, 102], expect: 'ab.pdf' },
  { name: 'a lone low surrogate is removed', inputUtf16: [97, 0xde00, 98, 46, 112, 100, 102], expect: 'ab.pdf' },
  { name: 'a pair is kept, a lone high surrogate after it is removed', inputUtf16: [120, 0xd83d, 0xde00, 0xd83d, 46, 112, 100, 102], expect: 'x😀.pdf' },
];
for (const f of fileNamesUtf16) assert.equal(safeFileName(String.fromCharCode(...f.inputUtf16)), f.expect, f.name);

// Ack frames with the worst `from` cleanName allows (60 emoji, 240 bytes): 70 ids is the most that stays a message.
const ackFrom = '😀'.repeat(60);
const ackIds = (n) => Array.from({ length: n }, (_, i) => `ack-id-${i}`);
const acks = [];
for (const [n, expectLength, expectSmall] of [[70, 2798, true], [71, 2833, true], [72, 2868, false]]) {
  const idLabels = ackIds(n);
  const header = { v: 1, kind: 'ack', ids: idLabels.map((l) => toHex(h(l)).slice(0, 32)), sent: '2026-10-17T22:01:00.000Z', from: ackFrom };
  const frame = await encryptFrame(k1, PURPOSE_ACK, header, new Uint8Array(0), nonceFrom('acks'));
  assert.equal(frame.length, expectLength, `${n} ids`);
  assert.equal(isSmallFrame(frame), expectSmall, `${n} ids small`);
  if (n === MAX_ACK_IDS) {
    const built = await buildAckFrame(k1, header.ids, { from: ackFrom, sent: header.sent, nonce: nonceFrom('acks') });
    assert.equal(toHex(built), toHex(frame));
  }
  acks.push({
    name: `${n} ids, from = 60 × U+1F600: ${expectSmall ? 'a small frame (a message)' : 'not a small frame (it would become an attachment)'}`,
    idLabels, from: ackFrom, sent: header.sent, headerJson: JSON.stringify(header), frameLength: frame.length, small: expectSmall,
  });
}

// The shared status vocabulary (CHANGES-v1.1 2.5).
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const HOUR = 3600000;
const statusRows = [
  ['sending', { kind: 'url', status: 'sending', errorCode: '', size: 0, created: NOW - 60000 }],
  ['sent, created 23 h ago', { kind: 'page', status: 'sent', errorCode: '', size: 120000, created: NOW - 23 * HOUR }],
  ['sent, created 25 h ago', { kind: 'file', status: 'sent', errorCode: '', size: 4000000, created: NOW - 25 * HOUR }],
  ['delivered', { kind: 'url', status: 'delivered', errorCode: '', size: 0, created: NOW - 2 * HOUR }],
  ['failed / network', { kind: 'file', status: 'failed', errorCode: 'network', size: 2500000, created: NOW - HOUR }],
  ['failed / full', { kind: 'file', status: 'failed', errorCode: 'full', size: 8000000, created: NOW - HOUR }],
  ['failed / refused', { kind: 'file', status: 'failed', errorCode: 'refused', size: 300000, created: NOW - HOUR }],
  ['expired (a week without the Daylight)', { kind: 'url', status: 'expired', errorCode: '', size: 0, created: NOW - 8 * 24 * HOUR }],
  ['expired / full', { kind: 'file', status: 'expired', errorCode: 'full', size: 8000000, created: NOW - 7 * HOUR }],
  ['expired / refused', { kind: 'file', status: 'expired', errorCode: 'refused', size: 300000, created: NOW - 7 * HOUR }],
  ['expired / too-large (a v1.0 row)', { kind: 'file', status: 'expired', errorCode: 'too-large', size: 14200000, created: NOW - 3 * HOUR }],
  ['expired / gone', { kind: 'file', status: 'expired', errorCode: 'gone', size: 500000, created: NOW - 3 * HOUR }],
];
const statusText = statusRows.map(([name, row]) => ({ name, row, now: NOW, ...describeRow(row, NOW) }));
assert.equal(statusText[10].sentence, 'Too big to send. Files can be up to 9 MB; this one is 14.2 MB.');
const formatMBCases = [[9000001, '9.1'], [12000000, '12'], [14200000, '14.2'], [9000000, '9'], [1, '0.1']]
  .map(([bytes, expect]) => { assert.equal(formatMB(bytes), expect); return { bytes, expect }; });

// What an app does with an incoming pairing (PROTOCOL 1.3 "Confirmation").
const s2 = secrets[1].secret;
const P = (secret, relay, name) => ({ secretHex: toHex(secret), relay, name });
const confirmCases = [
  ['a link, not paired yet', 'link', null, P(s1, 'https://ntfy.sh', 'Anjan’s Daylight')],
  ['a link without a name, through another relay', 'link', null, P(s1, 'https://relay.example.org/ntfy', '')],
  ['a link with a different secret: replaces the current pairing', 'link', P(s2, 'https://ntfy.sh', 'Kitchen Daylight'), P(s1, 'https://ntfy.sh', 'Anjan’s Daylight')],
  ['a link with the same secret and a new relay: applied, the notice names it', 'link', P(s1, 'https://ntfy.sh', 'Anjan’s Daylight'), P(s1, 'https://relay.example.org/ntfy', 'Anjan’s Daylight')],
  ['a link with the same secret and the same relay (a re-scan or a new name)', 'link', P(s1, 'https://ntfy.sh', 'Anjan’s Daylight'), P(s1, 'https://ntfy.sh', 'Living-room Daylight')],
  ['a link with the same secret moving back to ntfy.sh', 'link', P(s1, 'http://192.168.1.10:8080', ''), P(s1, 'https://ntfy.sh', '')],
  ['a code typed in the app, not paired yet: no question', 'app', null, P(s1, 'https://ntfy.sh', '')],
  ['a code typed in the app that replaces a different secret (current has no name)', 'app', P(s2, 'https://ntfy.sh', ''), P(s1, 'https://ntfy.sh', '')],
];
const toPairing = (p) => p && { secret: fromHex(p.secretHex), relay: p.relay, name: p.name };
const pairingConfirmationVectors = confirmCases.map(([name, source, current, next]) => ({
  name, source, current, next, expect: pairingConfirmation(toPairing(current), toPairing(next), { source }),
}));
assert.equal(pairingConfirmationVectors[2].expect.button, 'Switch');
assert.equal(pairingConfirmationVectors[3].expect.notice, 'Pairing updated: now sending through relay.example.org.');

const out = {
  protocol: 'Daylight Share v1, revision 1.1 (reader-experiment/share/PROTOCOL.md)',
  generatedBy: 'reader-experiment/share/vectors/generate.mjs',
  notes: [
    'All hex is lowercase. Strings are UTF-8 (in this file, JSON with \\u escapes where needed). Every implementation runs every group; Swift skips fileNamesUtf16 (Swift strings cannot hold lone surrogates).',
    'pairing: derive code, link and topics/key from secretHex; also parse code and link back to the secret.',
    'codeParsing: parse input; expect secretHex, or an error ("checksum" = well-formed but the check byte is wrong, "format" = wrong length or characters; implementations may word errors differently). For links also check relay and nameExpected. The two look-alike cases type O, I and B as 0, 1 and 8.',
    'relays: normalise input with the relay URL rule (PROTOCOL 1.3); expect the string, or an error ("relay") for {error}. The rule is textual: no WHATWG parsing, no IDN conversion.',
    'sizing: the fixed sizes every sender uses (CHUNK, MAX_ITEM, MAX_HEADER, largestFrame = chunk + maxHeader + 36) and, for content of `size` bytes that does not compress, the number of parts a sender makes, or "too-large" (refused before anything is queued). This checks arithmetic, not crypto.',
    'urls: the web URL rule (PROTOCOL 4): expect is the accepted string (the trimmed input, unchanged) or null (refused). Senders and receivers both use it.',
    'seal: with key from secretHex, seal headerJson bytes exactly as given + body with nonceHex, AAD from purpose; must equal frameHex. Also open frameHex back to headerJson/body. "header of exactly 65,536 bytes" is the largest header a receiver accepts.',
    'items: open each frame (purpose inbox), feed headers/bodies to the reassembler in the given order; the completed item must match expect.header (minus part/parts) and the content. The text file is one deflate-raw stream cut into parts of 16 bytes: join the parts, then inflate.',
    'invalidFrames: opening must fail ("header of 65,537 bytes": the header length is over 65,536). badHeaders: the frame would decrypt, but header validation must refuse it (every entry has a valid `sent`, so each fails for the reason its name gives).',
    'invalidItems: every frame opens and its header passes the checks, but reassembly must fail with an integrity error ("integrity"), and must not inflate more than `size` bytes on the way (the bomb inflates to 1 MiB; its deflate bytes are built by hand, so they are the same for every zlib).',
    'fileNames: the safe file name for an untrusted name (PROTOCOL 5): at most 120 UTF-16 units and 200 UTF-8 bytes, whole code points only. fileNamesUtf16: the same, with the input given as UTF-16 code units (lone surrogates are removed).',
    'acks: an ack header with ids = the first 32 hex digits of SHA-256(idLabel) and the worst `from` (60 emoji); headerJson is the serialisation (no escaping of non-ASCII), frameLength the sealed frame (headerJson bytes + 36) and small whether base64(frame) fits a message (<= 3800 characters). 70 ids (MAX_ACK_IDS) must be small. This checks serialisation and arithmetic, not crypto.',
    'statusText: what every app shows for an outbox row at time `now` (ms): label, sentence (null = none) and action (null, "retry-now" = button "Retry now", "try-again" = button "Try again"). The copy uses typographic apostrophes (U+2019), "…" (U+2026), "·" (U+00B7) and "✓" (U+2713). formatMB: sizes in the copy, ceil(bytes / 100,000) / 10 without a trailing ".0". These check copy and arithmetic, not crypto.',
    'pairingConfirmation: what an app does with a pairing that arrives, given the current pairing (or null) and the source ("link": camera, tapped link or #pair=; "app": typed, pasted or scanned on the app\'s own pairing screen). expect.ask: show title and lines with the buttons `button` and "Cancel", and pair only on `button`; otherwise pair at once and show `notice` when it is not null.',
  ],
  pairing, codeParsing, relays, sizing, urls, seal: sealVectors, items, invalidFrames, invalidItems, badHeaders, fileNames,
  fileNamesUtf16, acks, statusText, formatMB: formatMBCases, pairingConfirmation: pairingConfirmationVectors,
};
writeFileSync(new URL('./test-vectors.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
const count = Object.entries(out).filter(([, v]) => Array.isArray(v) && v !== out.notes).map(([k, v]) => `${v.length} ${k}`);
console.log(`wrote test-vectors.json: ${count.join(', ')}, sizing ${sizing.cases.length} cases`);
