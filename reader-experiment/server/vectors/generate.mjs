// Generates server-vectors.json (DESIGN.md 13.4) from the client module, with fixed nonces, for the protocol's vector
// secret. Swift (DaylightShareKit) and Kotlin (share-core) check their implementations against it.
//
//   node vectors/generate.mjs            writes vectors/server-vectors.json
//   node vectors/generate.mjs --stdout   prints it instead

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ds from '../../share/js/daylight-share.js';
import * as srv from '../client/daylight-server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SECRET_HEX = '27018efa6c00e0fec24d663e1119f9a1'; // share/vectors pairing[0]
export const SENT = '2026-10-20T06:00:00.000Z';
const hex = ds.toHex;
const b64 = ds.toBase64;

export async function nonce(label) { return (await ds.sha256(ds.utf8(`server-vector-nonce/${label}`))).slice(0, 12); }

export async function generate() {
  const secret = ds.fromHex(SECRET_HEX);
  const pairing = await ds.parsePairing(await ds.formatCode(secret));
  const keys = await ds.deriveKeys(secret);
  const seed = await srv.deriveServerSeed(secret);
  const values = await srv.deriveServerValues(seed);
  const salted = await srv.deriveServerValues(seed, { emailSalt: 'rotate-1' });
  const code = await srv.formatServerCode(seed);
  const link = await srv.formatServerCode(seed, { relay: 'https://relay.example.org', token: 'tk_live_123' });

  const configHeader = { v: 1, kind: 'config', id: '2b8e0f6c1d4a4e5f9a0b1c2d3e4f5a6b', sent: SENT, server: 'https://daylight-6c1f0e9a2b44.example.workers.dev', api: 1, fingerprint: values.fingerprint, delivery: 'lab' };
  const configFrame = await srv.buildConfigFrame(values, configHeader, await nonce('config'));

  const itemId = await srv.serverItemId(seed, 'digest:2026-10-20');
  const itemContent = ds.utf8('<!doctype html><html><head><meta charset="utf-8"><title>Digest</title></head><body><p>Two parts.</p></body></html>');
  const seal = (h, b, n) => srv.sealBox(values, 'item', h, b, n);
  const item = await srv.buildServerItemFrames(seal, {
    id: itemId, kind: 'page', url: `https://daylight.invalid/i/${itemId}`, title: 'Digest · Tue 20 Oct', content: itemContent, sent: SENT,
    from: 'Digest', app: 'server/1', extra: { 'x-origin': 'digest' },
  }, { chunkSize: 64, compress: false, nonces: [await nonce('item-0'), await nonce('item-1')] });

  const helloHeader = { v: 1, kind: 'ack', ids: [], sent: SENT, 'x-inbox': { app: 'inbox-lab/1.0' } };
  const hello = await srv.sealBox(values, 'ack', helloHeader, new Uint8Array(0), await nonce('hello'));
  const ackHeader = { v: 1, kind: 'ack', ids: [itemId], sent: SENT, from: 'Daylight' };
  const ack = await srv.sealBox(values, 'ack', ackHeader, new Uint8Array(0), await nonce('ack'));

  const inboxFrame = await ds.encryptFrame(keys, 'inbox', { v: 1, id: 'f'.repeat(32), kind: 'url', url: 'https://example.com/', sent: SENT }, new Uint8Array(0), await nonce('inbox'));

  const fileContent = ds.utf8('%PDF-1.4 hosted vector file, split into two small parts for the vectors.\n');
  const hosted = await srv.buildHostedFrames(keys, {
    id: 'a1'.repeat(16), name: 'hosted.pdf', mime: 'application/pdf', content: fileContent, sent: SENT, from: 'Vector', app: 'vectors/1',
  }, { chunkSize: 40, nonces: [await nonce('hosted-0'), await nonce('hosted-1')] });

  const accepted = [
    ['https://example.com/a?b=1#c', 'https://example.com/a?b=1#c'], ['HTTPS://EXAMPLE.COM', 'https://example.com/'],
    ['http://8.8.8.8/', 'http://8.8.8.8/'], ['http://[2001:db8::1]/x', 'http://[2001:db8::1]/x'], ['https://example.com:8443/', 'https://example.com:8443/'],
    ['http://example.com\\@evil.com', 'http://example.com/@evil.com'],
  ];
  const refused = [
    'http://192.168.1.1/reboot', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://127.0.0.1/', 'http://169.254.169.254/', 'http://100.64.0.1/',
    'http://0.0.0.0/', 'http://198.18.0.1/', 'http://224.0.0.1/', 'http://240.0.0.1/', 'http://192.0.0.1/', 'http://2130706433/', 'http://0x7f.1/',
    'http://127.1/', 'http://[::1]/', 'http://[::]/', 'http://[::ffff:10.0.0.1]/', 'http://[::10.0.0.1]/', 'http://[fc00::1]/', 'http://[fe80::1]/',
    'http://[64:ff9b::a00:1]/', 'http://[2002:a00:1::]/', 'http://localhost/', 'http://x.localhost/', 'http://printer.local/', 'http://db.internal/',
    'http://router.lan/', 'http://nas.home.arpa/', 'http://router/', 'http://user:pw@example.com/', 'javascript:alert(1)', 'ftp://example.com/', '',
  ];

  return {
    generatedBy: 'reader-experiment/server/vectors/generate.mjs',
    notes: 'Labels end with a 0x00 byte; AADs do not. Nonces are SHA-256("server-vector-nonce/<label>")[0:12]. All binary values are lowercase hex unless named base64.',
    secretHex: SECRET_HEX,
    pairingCode: pairing.code,
    derived: {
      seedHex: hex(seed), serverCode: code, serverCodeLink: link, authToken: values.authToken, configTopic: values.configTopic,
      itemTopic: values.itemTopic, ackTopic: values.ackTopic, emailToken: values.emailToken, emailTokenWithSalt: { salt: 'rotate-1', emailToken: salted.emailToken },
      fingerprint: values.fingerprint, workerName: values.workerName,
      serverItemIds: [
        { origin: 'digest:2026-10-20', id: itemId },
        { origin: 'feed:3a1b2c4d5e6f:0123456789abcdef0123456789abcdef', id: await srv.serverItemId(seed, 'feed:3a1b2c4d5e6f:0123456789abcdef0123456789abcdef') },
      ],
    },
    serverCodeParsing: [
      { input: code, seedHex: hex(seed) },
      { input: code.toLowerCase().replace(/-/g, ' '), seedHex: hex(seed) },
      { input: link, seedHex: hex(seed), relay: 'https://relay.example.org', token: 'tk_live_123' },
      { input: pairing.code, error: 'pairing-code' },
      { input: await ds.pairingLink({ secret }), error: 'pairing-code' },
      { input: 'SERVER-' + (code.slice(7, 8) === 'A' ? 'B' : 'A') + code.slice(8), error: 'checksum' },
      { input: 'SERVER-ABCD', error: 'format' },
    ],
    frames: {
      config: { aad: 'dlshare/v1/server-config', nonceHex: hex(await nonce('config')), header: configHeader, frameBase64: b64(configFrame) },
      item: {
        aad: 'dlshare/v1/server-item', id: itemId, contentBase64: b64(itemContent), chunkSize: 64,
        parts: await Promise.all(item.frames.map(async (f, i) => ({ nonceHex: hex(await nonce(`item-${i}`)), frameBase64: b64(f), header: (await srv.openBox(values, 'item', f)).header }))),
      },
      hello: { aad: 'dlshare/v1/server-ack', nonceHex: hex(await nonce('hello')), header: helloHeader, frameBase64: b64(hello) },
      ack: { aad: 'dlshare/v1/server-ack', nonceHex: hex(await nonce('ack')), header: ackHeader, frameBase64: b64(ack) },
    },
    negative: [
      { frame: 'config', openWith: 'box:item', expect: 'frame' }, { frame: 'config', openWith: 'box:ack', expect: 'frame' },
      { frame: 'config', openWith: 'pairing:inbox', expect: 'frame' }, { frame: 'config', openWith: 'pairing:ack', expect: 'frame' },
      { frame: 'inbox', openWith: 'box:config', expect: 'frame', frameBase64: b64(inboxFrame) },
      { frame: 'item', openWith: 'pairing:inbox', expect: 'frame' },
    ],
    hosted: {
      note: 'Ordinary v1 frames under the pairing key (enc identity). Publish one message per part with Attach: <url of the frame>; a v1 Receiver receives the item and acks it.',
      itemId: 'a1'.repeat(16), name: 'hosted.pdf', mime: 'application/pdf', contentBase64: b64(fileContent), sha256: hex(await ds.sha256(fileContent)),
      parts: await Promise.all(hosted.frames.map(async (f, i) => ({ nonceHex: hex(await nonce(`hosted-${i}`)), frameBase64: b64(f) }))),
      expect: 'item received',
    },
    publicUrl: { accepted: accepted.map(([input, output]) => ({ input, output })), refused },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const json = JSON.stringify(await generate(), null, 2) + '\n';
  if (process.argv.includes('--stdout')) process.stdout.write(json);
  else fs.writeFileSync(path.join(here, 'server-vectors.json'), json);
}
