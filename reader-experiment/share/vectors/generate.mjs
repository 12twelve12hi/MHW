// Writes test-vectors.json from the JavaScript reference implementation. Run: node generate.mjs
// The vectors are deterministic (fixed secrets and nonces) except the deflate-raw bytes, which come from whatever
// zlib the generator ran with: implementations must DECODE those frames, not reproduce them byte for byte.

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  formatCode, pairingLink, deriveKeys, sealFrame, buildItemFrames, buildAckFrame, utf8, toHex, toBase64, fromHex,
  PURPOSE_INBOX, PURPOSE_ACK,
} from '../js/daylight-share.js';

const h = (s) => createHash('sha256').update(s).digest();
const secretFrom = (label) => new Uint8Array(h(label).subarray(0, 16));
const nonceFrom = (label) => new Uint8Array(h('nonce/' + label).subarray(0, 12));

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
const codeParsing = [
  { name: 'canonical with dashes', input: pairing[0].code, secretHex: pairing[0].secretHex },
  { name: 'compact', input: code1, secretHex: pairing[0].secretHex },
  { name: 'lowercase with spaces', input: lowerSpaced, secretHex: pairing[0].secretHex },
  { name: 'look-alike digits 0 1 8', input: swapped, secretHex: pairing[0].secretHex },
  { name: 'underscores and dots', input: code1.match(/.{1,4}/g).join('_').replace(/_/, '.'), secretHex: pairing[0].secretHex },
  { name: 'pairing link', input: pairing[0].link, secretHex: pairing[0].secretHex, relay: 'https://ntfy.sh', nameExpected: '' },
  { name: 'pairing link with relay and name', input: pairing[0].linkWithRelayAndName, secretHex: pairing[0].secretHex, relay: 'https://relay.example.org/ntfy', nameExpected: 'Anjan’s Daylight & co' },
  { name: 'one character changed (checksum)', input: typo, error: 'checksum' },
  { name: 'too short', input: code1.slice(0, 27), error: 'format' },
  { name: 'too long', input: code1 + 'A', error: 'format' },
  { name: 'bad character', input: code1.slice(0, 27) + '9', error: 'format' },
  { name: 'empty', input: '', error: 'format' },
];

// Low-level seal vectors: exact header bytes + body + nonce -> exact frame. Every implementation must reproduce these.
const seal = async (name, purpose, headerJson, body, nonceLabel) => {
  const nonce = nonceFrom(nonceLabel);
  const frame = await sealFrame(k1, purpose, utf8(headerJson), body, nonce);
  return { name, purpose, secretHex: toHex(s1), nonceHex: toHex(nonce), headerJson, bodyHex: toHex(body), frameHex: toHex(frame), frameBase64: toBase64(frame) };
};
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
];

// Whole-item decode vectors: frames as a sender would publish them -> expected header and content after reassembly.
const html = `<!doctype html><html><head><title>Walden</title></head><body><article><h1>Where I Lived</h1>${'<p>I went to the woods because I wished to live deliberately, to front only the essential facts of life.</p>'.repeat(40)}</article></body></html>`;
const pageBuilt = await buildItemFrames(k1, { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', kind: 'page', url: 'https://example.com/walden', title: 'Walden', content: html, sent: '2026-10-17T22:03:00.000Z', from: 'Chrome', app: 'chrome/1.0.0' }, { nonces: [nonceFrom('page')] });
const fileBytes = new Uint8Array(1000).map((_, i) => (i * 37 + 11) & 0xff);
const fileBuilt = await buildItemFrames(k1, { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', kind: 'file', name: 'paper.pdf', mime: 'application/pdf', title: 'A paper', content: fileBytes, sent: '2026-10-17T22:04:00.000Z', from: 'Android' }, { chunkSize: 400, nonces: [0, 1, 2].map((i) => nonceFrom('chunk' + i)) });
const textBuilt = await buildItemFrames(k1, { id: 'cccccccccccccccccccccccccccccccc', kind: 'file', name: 'notes.txt', mime: 'text/plain', content: 'plain text '.repeat(500), sent: '2026-10-17T22:05:00.000Z' }, { chunkSize: 300, nonces: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => nonceFrom('text' + i)) });
const urlBuilt = await buildItemFrames(k1, { id: 'dddddddddddddddddddddddddddddddd', kind: 'url', url: 'https://www.newyorker.com/magazine/2026/10/19/example', title: 'Example', sent: '2026-10-17T22:06:00.000Z' }, { nonces: [nonceFrom('url2')] });

const items = [
  { name: 'page, deflate-raw, one frame', framesHex: pageBuilt.frames.map(toHex), expect: { header: { ...pageBuilt.header }, contentUtf8: html } },
  { name: 'pdf file, identity, 3 parts (chunk 400)', framesHex: fileBuilt.frames.map(toHex), expect: { header: { ...fileBuilt.header }, contentHex: toHex(fileBytes) } },
  { name: 'text file, deflate-raw, chunked (chunk 300)', framesHex: textBuilt.frames.map(toHex), expect: { header: { ...textBuilt.header }, contentUtf8: 'plain text '.repeat(500) } },
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
const invalidFrames = [
  { name: 'one ciphertext bit flipped', purpose: PURPOSE_INBOX, frameHex: toHex(tampered) },
  { name: 'bad magic', purpose: PURPOSE_INBOX, frameHex: toHex(badMagic) },
  { name: 'ack frame read as an inbox frame (aad differs)', purpose: PURPOSE_INBOX, frameHex: toHex(ackFrame) },
  { name: 'inbox frame read as an ack frame', purpose: PURPOSE_ACK, frameHex: sealVectors[0].frameHex },
  { name: 'sealed with another pairing', purpose: PURPOSE_INBOX, frameHex: toHex(otherFrame) },
  { name: 'truncated', purpose: PURPOSE_INBOX, frameHex: sealVectors[0].frameHex.slice(0, 60) },
];

// Item headers a receiver must refuse even though they decrypt (untrusted input).
const badHeaders = [
  { name: 'javascript url', header: { v: 1, id: '00112233445566778899aabbccddeeff', kind: 'url', url: 'javascript:alert(1)', sent: '' } },
  { name: 'file url scheme', header: { v: 1, id: '00112233445566778899aabbccddeeff', kind: 'url', url: 'file:///etc/passwd', sent: '' } },
  { name: 'short id', header: { v: 1, id: '0011', kind: 'url', url: 'https://example.com', sent: '' } },
  { name: 'unknown kind', header: { v: 1, id: '00112233445566778899aabbccddeeff', kind: 'exe', url: 'https://example.com', sent: '' } },
  { name: 'file without sha256', header: { v: 1, id: '00112233445566778899aabbccddeeff', kind: 'file', name: 'a.pdf', mime: 'application/pdf', size: 3, sent: '' } },
  { name: 'part out of range', header: { v: 1, id: '00112233445566778899aabbccddeeff', kind: 'file', name: 'a.pdf', mime: 'application/pdf', size: 3, sha256: '0'.repeat(64), part: 3, parts: 3, sent: '' } },
  { name: 'unknown enc', header: { v: 1, id: '00112233445566778899aabbccddeeff', kind: 'file', name: 'a.pdf', mime: 'application/pdf', size: 3, sha256: '0'.repeat(64), enc: 'gzip', sent: '' } },
];
const fileNames = [
  { input: '../../etc/passwd', expect: 'etc passwd' },
  { input: 'C:\\Users\\me\\report.pdf', expect: 'C Users me report.pdf' },
  { input: '  .hidden.pdf ', expect: 'hidden.pdf' },
  { input: '', expect: 'document' },
  { input: 'a'.repeat(200) + '.pdf', expect: 'a'.repeat(116) + '.pdf' },
];

const out = {
  protocol: 'Daylight Share v1 (reader-experiment/share/PROTOCOL.md)',
  generatedBy: 'reader-experiment/share/vectors/generate.mjs',
  notes: [
    'All hex is lowercase. Strings are UTF-8.',
    'pairing: derive code, link and topics/key from secretHex; also parse code and link back to the secret.',
    'codeParsing: parse input; expect secretHex, or an error ("checksum" = well-formed but the check byte is wrong, "format" = wrong length or characters; implementations may word errors differently). For links also check relay and nameExpected.',
    'seal: with key from secretHex, seal headerJson bytes exactly as given + body with nonceHex, AAD from purpose; must equal frameHex. Also open frameHex back to headerJson/body.',
    'items: open each frame (purpose inbox), feed headers/bodies to the reassembler in the given order; the completed item must match expect.header (minus part/parts) and the content.',
    'invalidFrames: opening must fail. badHeaders: the frame would decrypt, but header validation must refuse it.',
    'fileNames: the receiver-side safe file name for an untrusted name.',
  ],
  pairing, codeParsing, seal: sealVectors, items, invalidFrames, badHeaders, fileNames,
};
writeFileSync(new URL('./test-vectors.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote test-vectors.json: ${pairing.length} pairing, ${codeParsing.length} code, ${sealVectors.length} seal, ${items.length} items, ${invalidFrames.length} invalid frames, ${badHeaders.length} bad headers`);
