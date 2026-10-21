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

// ---- serverState (LAB-PLAN 2.6): status JSON or an error in, {state, message} out, and what noteError does to the
// cached status. The expectations come from the module itself; unit-vectors.test.mjs checks them against a client.

export const STATE_NOW = Date.parse('2026-10-20T06:00:00.000Z');
export const STATE_ORIGIN = 'https://daylight-6c1f0e9a2b44.example.workers.dev';

const ready = { state: 'ready' };
const withState = (state, message) => ({ state, ...(message === undefined ? {} : { message }) });
/** A GET /v1/status body as the Worker sends it (10.5), with `features` overridden. */
export function statusBody(features = {}) {
  return {
    server: STATE_ORIGIN, api: 1, fingerprint: '3f9a1c2e', delivery: 'lab', version: 'abc1234', plan: 'free',
    inbox: { lab: true, lastSeen: '2026-10-20T05:58:00.000Z' },
    features: { ai: ready, pdf: ready, email: ready, feeds: ready, files: ready, deliver: ready, ...features },
  };
}

const errJson = (error) => JSON.stringify({ error });
const SERVER_TEXT = (code, extra) => srv.errorMessage(code, extra);

/** [name, feature, status] -> fromStatus cases. */
function statusCases() {
  const M = srv.STATE_MESSAGES;
  return [
    ['ready', 'ai', statusBody()],
    ['needs-key with the server’s message', 'ai', statusBody({ ai: withState('needs-key', M['needs-key']) })],
    ['needs-key without a message: the module’s text', 'pdf', statusBody({ pdf: withState('needs-key') })],
    ['needs-lab-inbox: a newer server’s own text is shown as is', 'deliver', statusBody({ deliver: withState('needs-lab-inbox', 'Your Daylight server hasn’t heard from your Daylight yet. Open Daylight Share on it with Lab on.') })],
    ['needs-domain', 'email', statusBody({ email: withState('needs-domain', M['needs-domain']) })],
    ['needs-r2 without a message', 'files', statusBody({ files: withState('needs-r2') })],
    ['needs-paid', 'email', statusBody({ email: withState('needs-paid', M['needs-paid']) })],
    ['error carries the server’s message for the recorded code', 'ai', statusBody({ ai: withState('error', SERVER_TEXT('AI_KEY_INVALID')) })],
    ['error without a message', 'ai', statusBody({ ai: withState('error') })],
    ['a message that is not a string is ignored', 'feeds', statusBody({ feeds: { state: 'needs-lab-inbox', message: 42 } })],
    ['an empty message is ignored', 'files', statusBody({ files: { state: 'needs-r2', message: '' } })],
    ['an unknown state from a newer server passes through with its message', 'feeds', statusBody({ feeds: withState('needs-dns', 'Add the DNS record your server asks for.') })],
    ['an unknown state without a message gets the generic sentence', 'feeds', statusBody({ feeds: withState('needs-dns') })],
    ['a feature the status does not list', 'deliver', (() => { const b = statusBody(); delete b.features.deliver; return b; })()],
    ['a feature entry without a state', 'ai', statusBody({ ai: { message: 'x' } })],
    ['a feature entry whose state is not a string', 'ai', statusBody({ ai: { state: true } })],
    ['a feature entry that is not an object', 'ai', statusBody({ ai: 'ready' })],
    ['a status without features', 'ai', { server: STATE_ORIGIN, api: 1 }],
    ['an unknown feature name', 'summaries', statusBody()],
    ['an inherited name is not a feature', 'constructor', statusBody()],
  ];
}

/**
 * [name, feature, input] -> fromError cases. input: {response: {status, body}} (the server's answer to a call),
 * {network: true} (fetch failed), {deadline: true} (a gate's 5 s deadline passed first) or {local: state} (decided
 * by the app before any request, 4.3).
 */
function errorCases() {
  const r = (status, body) => ({ response: { status, body } });
  return [
    ['409 NEEDS_KEY names ai; the app asked for pdf', 'pdf', r(409, errJson({ code: 'NEEDS_KEY', message: SERVER_TEXT('NEEDS_KEY'), feature: 'ai', missing: ['ANTHROPIC_API_KEY'] }))],
    ['409 NEEDS_KEY whose message is not a string', 'ai', r(409, errJson({ code: 'NEEDS_KEY', message: 42, feature: 'ai' }))],
    ['409 NEEDS_KEY naming an unknown feature: the app’s feature is noted', 'ai', r(409, errJson({ code: 'NEEDS_KEY', feature: 'summaries' }))],
    ['409 NOT_CONFIGURED, missing the email domain', 'email', r(409, errJson({ code: 'NOT_CONFIGURED', message: SERVER_TEXT('NOT_CONFIGURED', { missing: ['DAYLIGHT_EMAIL_DOMAIN'] }), missing: ['DAYLIGHT_EMAIL_DOMAIN'], feature: 'email' }))],
    ['409 NOT_CONFIGURED, missing R2', 'files', r(409, errJson({ code: 'NOT_CONFIGURED', message: SERVER_TEXT('NOT_CONFIGURED', { missing: ['R2'] }), missing: ['R2'], feature: 'files' }))],
    ['409 NOT_CONFIGURED: the email domain is read before R2', 'email', r(409, errJson({ code: 'NOT_CONFIGURED', missing: ['R2', 'DAYLIGHT_EMAIL_DOMAIN'] }))],
    ['409 NOT_CONFIGURED: DAYLIGHT_SERVER_CODE is read first', 'email', r(409, errJson({ code: 'NOT_CONFIGURED', missing: ['R2', 'DAYLIGHT_EMAIL_DOMAIN', 'DAYLIGHT_SERVER_CODE'] }))],
    ['503 NOT_CONFIGURED: a Worker deployed without DAYLIGHT_SERVER_CODE', 'files', r(503, errJson({ code: 'NOT_CONFIGURED', message: SERVER_TEXT('NOT_CONFIGURED', { missing: ['DAYLIGHT_SERVER_CODE'] }), missing: ['DAYLIGHT_SERVER_CODE'] }))],
    ['409 NOT_CONFIGURED with an empty missing list', 'files', r(409, errJson({ code: 'NOT_CONFIGURED', missing: [] }))],
    ['409 NOT_CONFIGURED whose missing is a string, not a list', 'files', r(409, errJson({ code: 'NOT_CONFIGURED', missing: 'R2' }))],
    ['409 NEEDS_LAB_INBOX names deliver; the app asked for ai', 'ai', r(409, errJson({ code: 'NEEDS_LAB_INBOX', message: SERVER_TEXT('NEEDS_LAB_INBOX'), feature: 'deliver' }))],
    ['409 NEEDS_LAB_INBOX without a feature', 'feeds', r(409, errJson({ code: 'NEEDS_LAB_INBOX' }))],
    ['423 LOCKED', 'ai', r(423, errJson({ code: 'LOCKED', message: SERVER_TEXT('LOCKED') }))],
    ['401 BAD_AUTH: the module’s text, whatever the answer says', 'ai', r(401, errJson({ code: 'BAD_AUTH', message: 'Some other text.' }))],
    ['401 without a JSON body is BAD_AUTH', 'files', r(401, 'Unauthorized')],
    ['429 RATE_LIMITED: the feature stays ready', 'feeds', r(429, errJson({ code: 'RATE_LIMITED', message: SERVER_TEXT('RATE_LIMITED'), retryAfter: 60 }))],
    ['503 AI_BUSY: the feature stays ready', 'ai', r(503, errJson({ code: 'AI_BUSY', message: SERVER_TEXT('AI_BUSY'), retryAfter: 30 }))],
    ['429 AI_QUEUE_FULL: the feature stays ready', 'ai', r(429, errJson({ code: 'AI_QUEUE_FULL', message: SERVER_TEXT('AI_QUEUE_FULL'), retryAfter: 120 }))],
    ['429 AI_DAILY_LIMIT', 'ai', r(429, errJson({ code: 'AI_DAILY_LIMIT', message: SERVER_TEXT('AI_DAILY_LIMIT', { resetAt: '2026-10-21T00:00:00.000Z', ceilingUsd: 10 }), limit: 3, resetAt: '2026-10-21T00:00:00.000Z' }))],
    ['503 AI_KEY_INVALID', 'ai', r(503, errJson({ code: 'AI_KEY_INVALID', message: SERVER_TEXT('AI_KEY_INVALID') }))],
    ['409 FEED_EXISTS', 'feeds', r(409, errJson({ code: 'FEED_EXISTS', message: SERVER_TEXT('FEED_EXISTS') }))],
    ['413 TOO_LARGE without a message: the module’s text with the limit', 'files', r(413, errJson({ code: 'TOO_LARGE', limit: 12713984 }))],
    ['an unknown code with a message', 'feeds', r(400, errJson({ code: 'FEED_PRIVATE', message: 'That feed needs a login.' }))],
    ['an unknown code without a message', 'feeds', r(400, errJson({ code: 'FEED_PRIVATE' }))],
    ['500 without a JSON body is SERVER_ERROR', 'ai', r(500, '<html>Internal error</html>')],
    ['a code that is not a server code is not read (it cannot pose as needs-server)', 'ai', r(502, errJson({ code: 'needs-server', message: 'Fake.' }))],
    ['an error object without a code is not read', 'ai', r(500, errJson({ message: 'No code.' }))],
    ['the network failed', 'ai', { network: true }],
    ['a gate’s 5 s deadline passed before the server answered', 'ai', { deadline: true }],
    ['no config and no pin (4.3)', 'ai', { local: 'needs-server' }],
    ['the pin belongs to an earlier pairing (4.3)', 'files', { local: 'pairing-mismatch' }],
    ['the server’s api is below SERVER_API_MIN', 'ai', { local: 'server-outdated' }],
    ['the server’s api is above SERVER_API', 'ai', { local: 'app-outdated' }],
  ];
}

/** A client whose request() goes to `respond` and whose cached status is `statusBody()`, fresh at STATE_NOW. */
export async function stateClient(secret, respond) {
  const storage = new ds.MemoryStorage();
  await storage.set('server/manualUrl', STATE_ORIGIN);
  await storage.set('server/config', { server: STATE_ORIGIN, api: 1, fingerprint: '3f9a1c2e', delivery: 'lab', sent: '2026-10-20T05:00:00.000Z', id: '' });
  await storage.set('server/configAt', STATE_NOW - 60_000);
  await storage.set('server/status', statusBody());
  await storage.set('server/statusAt', STATE_NOW - 60_000);
  const fetchFn = async (url) => respond(url);
  return { storage, client: new srv.DaylightServer({ pairing: { secret, relay: ds.DEFAULT_RELAY }, storage, fetch: fetchFn, now: () => STATE_NOW }) };
}

/** The error a fromError input produces, as the client sees it. */
export async function errorFor(secret, input) {
  if (input.local) return new srv.ServerError(input.local, { message: srv.localMessage(input.local) });
  if (input.deadline) return new srv.ServerError('OFFLINE');
  const { client } = await stateClient(secret, async () => {
    if (input.network) throw new TypeError('Failed to fetch');
    return new Response(input.response.body, { status: input.response.status });
  });
  try { await client.request('POST', '/v1/ai', { json: {} }); } catch (e) { return e; }
  throw new Error('the request did not fail');
}

/** What noteError(feature, err) did to a fresh cached status: kept, updated (one feature, marked for refresh) or dropped. */
export async function noteEffect(secret, feature, err) {
  const { storage, client } = await stateClient(secret, async () => { throw new Error('noteError must not make requests'); });
  const out = await client.noteError(feature, err);
  const status = await storage.get('server/status');
  const statusAt = await storage.get('server/statusAt');
  const configAt = await storage.get('server/configAt');
  let effect;
  if (status === undefined) effect = { cache: 'dropped', configRefresh: configAt === undefined };
  else if (JSON.stringify(status) === JSON.stringify(statusBody()) && statusAt !== undefined) effect = { cache: 'kept' };
  else {
    const changed = Object.keys(status.features).filter((k) => JSON.stringify(status.features[k]) !== JSON.stringify(statusBody().features[k]));
    effect = { cache: 'updated', feature: changed.join(','), refresh: statusAt === undefined };
  }
  return { out, effect };
}

const errorFields = (e) => {
  const o = { code: e.code, status: e.status };
  for (const k of ['feature', 'missing', 'retryAfter', 'limit', 'resetAt']) if (e[k] !== undefined) o[k] = e[k];
  return o;
};

export async function serverStateVectors(secret) {
  const fromStatus = statusCases().map(([name, feature, status]) => ({ name, feature, status, expect: srv.stateFromStatus(status, feature) }));
  const fromError = [];
  for (const [name, feature, input] of errorCases()) {
    const err = await errorFor(secret, input);
    const { out, effect } = await noteEffect(secret, feature, err);
    const expect = srv.stateFromError(err);
    if (JSON.stringify(out) !== JSON.stringify(expect)) throw new Error(`noteError and stateFromError differ for ${name}`);
    fromError.push({ name, feature, ...input, error: errorFields(err), expect, noteError: effect });
  }
  return {
    note: 'LAB-PLAN 2.6. fromStatus: a GET /v1/status body and a feature -> stateFromStatus. fromError: the server’s answer to a call ({status, body}: body is the response text), a network failure, a gate’s deadline, or a state the app decides before any request -> the error the client makes (code, HTTP status and the fields it keeps) -> stateFromError -> {state, message}; noteError(feature, error) returns the same and does `noteError` to a fresh cached status in which every feature is ready (fromStatus[0].status): kept; updated (that feature now holds `expect`, and server/statusAt is removed so the next state() refreshes); or dropped (server/status and server/statusAt removed; configRefresh: server/configAt removed too, so the next discovery re-reads the config topic).',
    fromStatus, fromError,
  };
}

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
    serverState: await serverStateVectors(secret),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const json = JSON.stringify(await generate(), null, 2) + '\n';
  if (process.argv.includes('--stdout')) process.stdout.write(json);
  else fs.writeFileSync(path.join(here, 'server-vectors.json'), json);
}
