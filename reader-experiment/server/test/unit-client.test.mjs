// Unit tests for the client module (DESIGN.md 3, 4, 6.2, 9.7, 13, 14): derived values, the Server code, frames under
// the box key and their AAD separation, item builders, public URLs and the user-facing messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ds from '../../share/js/daylight-share.js';
import * as srv from '../client/daylight-server.js';

const SECRET = ds.fromHex('27018efa6c00e0fec24d663e1119f9a1'); // the protocol's vector secret
const PAIRING_CODE = 'E4AY-56TM-ADQP-5QSN-MY7B-CGPZ-UFRA';

test('derived values are deterministic, distinct and well formed', async () => {
  const seed = await srv.deriveServerSeed(SECRET);
  assert.equal(seed.length, 16);
  const v = await srv.deriveServerValues(seed);
  assert.match(v.authToken, /^[0-9a-f]{64}$/);
  for (const t of [v.configTopic, v.itemTopic, v.ackTopic]) assert.match(t, /^dls-[0-9a-f]{32}$/);
  assert.equal(new Set([v.configTopic, v.itemTopic, v.ackTopic]).size, 3);
  const keys = await ds.deriveKeys(SECRET);
  assert.ok(![keys.inboxTopic, keys.ackTopic].includes(v.itemTopic), 'server topics differ from the pairing topics');
  assert.match(v.emailToken, /^[a-z2-7]{10}$/);
  assert.match(v.fingerprint, /^[0-9a-f]{8}$/);
  assert.match(v.workerName, /^daylight-[0-9a-f]{12}$/);
  const salted = await srv.deriveServerValues(seed, { emailSalt: 'rotate-1' });
  assert.notEqual(salted.emailToken, v.emailToken, 'the salt changes the email address');
  assert.equal(salted.authToken, v.authToken, 'and nothing else');
  assert.equal(srv.showFingerprint('3f9a1c2e'), '3f9a-1c2e');
  const a = await srv.serverItemId(seed, 'feed:abc:1');
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, await srv.serverItemId(seed, 'feed:abc:1'));
  assert.notEqual(a, await srv.serverItemId(seed, 'feed:abc:2'));
});

test('the seed is one-way: another secret gives another seed and every value changes', async () => {
  const other = await srv.deriveServerSeed(ds.generateSecret());
  const seed = await srv.deriveServerSeed(SECRET);
  assert.notDeepEqual(other, seed);
  assert.notEqual((await srv.deriveServerValues(other)).fingerprint, (await srv.deriveServerValues(seed)).fingerprint);
});

test('Server code: both forms round-trip; typos, pairing codes and pairing links are refused', async () => {
  const seed = await srv.deriveServerSeed(SECRET);
  const code = await srv.formatServerCode(seed);
  assert.match(code, /^SERVER(-[A-Z2-7]{4}){7}$/);
  assert.deepEqual((await srv.parseServerCode(code)).seed, seed);
  assert.deepEqual((await srv.parseServerCode(code.toLowerCase().replace(/-/g, ' '))).seed, seed, 'forgiving about case and separators');
  const link = await srv.formatServerCode(seed, { relay: 'https://relay.example.org/', token: 'tk_abc' });
  assert.match(link, /^daylightserver:\/\/setup\?c=[A-Z2-7]{28}&r=https%3A%2F%2Frelay\.example\.org&k=tk_abc$/);
  const parsed = await srv.parseServerCode(link);
  assert.deepEqual(parsed.seed, seed);
  assert.equal(parsed.relay, 'https://relay.example.org');
  assert.equal(parsed.token, 'tk_abc');
  for (const pairing of [PAIRING_CODE, PAIRING_CODE.replace(/-/g, ''), await ds.pairingLink({ secret: SECRET })]) {
    await assert.rejects(srv.parseServerCode(pairing), (e) => e.code === 'server-code' && /That is your pairing code/.test(e.message));
  }
  const chars = code.slice(7).replace(/-/g, '');
  const bad = 'SERVER-' + (chars[0] === 'A' ? 'B' : 'A') + chars.slice(1);
  await assert.rejects(srv.parseServerCode(bad), (e) => e.reason === 'checksum');
  await assert.rejects(srv.parseServerCode('SERVER-ABC'), (e) => e.reason === 'format');
  await assert.rejects(srv.parseServerCode('hello world'), (e) => e.reason === 'format');
});

test('sealBox / openBox: each AAD opens only its own frames, and never the protocol’s', async () => {
  const seed = await srv.deriveServerSeed(SECRET);
  const v = await srv.deriveServerValues(seed);
  const keys = await ds.deriveKeys(SECRET);
  const header = { v: 1, kind: 'config', id: 'x' };
  const config = await srv.sealBox(v, 'config', header);
  assert.deepEqual((await srv.openBox(v, 'config', config)).header, header);
  for (const aad of ['item', 'ack']) await assert.rejects(srv.openBox(v, aad, config), (e) => e.code === 'frame');
  for (const purpose of ['inbox', 'ack']) await assert.rejects(ds.decryptFrame(keys, purpose, config), (e) => e.code === 'frame');
  const inbox = await ds.encryptFrame(keys, 'inbox', { v: 1, id: '0'.repeat(32), kind: 'url', url: 'https://e.com', sent: '' }, new Uint8Array(0));
  for (const aad of ['config', 'item', 'ack']) await assert.rejects(srv.openBox(v, aad, inbox));
  await assert.rejects(srv.sealBox(v, 'inbox', header), (e) => e.code === 'aad', 'an unknown AAD throws instead of falling back');
  const body = ds.utf8('hello');
  const item = await srv.sealBox(v, 'item', { v: 1, id: 'y' }, body);
  assert.equal(ds.fromUtf8((await srv.openBox(v, 'item', item)).body), 'hello');
  const tampered = item.slice(); tampered[tampered.length - 1] ^= 1;
  await assert.rejects(srv.openBox(v, 'item', tampered));
  await assert.rejects(srv.openBox(v, 'item', await srv.sealBox(v, 'item', { v: 2 })), /unsupported/);
});

test('config frames: checkConfig refuses a future sent, non-https or pathful servers and bad fields', async () => {
  const v = await srv.deriveServerValues(await srv.deriveServerSeed(SECRET));
  const now = Date.parse('2026-10-20T06:00:00Z');
  const frame = await srv.buildConfigFrame(v, { server: 'https://daylight-abc.example.workers.dev', sent: '2026-10-20T06:00:03.000Z' });
  const { header } = await srv.openBox(v, 'config', frame);
  assert.equal(header.kind, 'config');
  assert.equal(header.delivery, 'lab');
  assert.equal(header.fingerprint, v.fingerprint);
  const ok = srv.checkConfig(header, { now });
  assert.equal(ok.server, 'https://daylight-abc.example.workers.dev');
  assert.equal(srv.checkConfig({ ...header, sent: '2026-10-20T06:06:00.000Z' }, { now }), null, 'more than 5 minutes ahead');
  assert.ok(srv.checkConfig({ ...header, sent: '2026-10-20T06:04:59.000Z' }, { now }), 'within 5 minutes is fine');
  for (const server of ['http://x.example', 'https://x.example/path', 'https://u:p@x.example', 'javascript:alert(1)', 'https://x.example/?q']) {
    assert.equal(srv.checkConfig({ ...header, server }, { now }), null, server);
  }
  assert.equal(srv.checkConfig({ ...header, kind: 'item' }, { now }), null);
  assert.equal(srv.checkConfig({ ...header, fingerprint: 'zz' }, { now }), null);
  assert.equal(srv.checkConfig({ ...header, delivery: 'v1' }, { now }).delivery, 'v1');
});

test('buildServerItemFrames: deterministic ids, 1 MiB chunks, deflate for small pages only, x- fields kept', async () => {
  const v = await srv.deriveServerValues(await srv.deriveServerSeed(SECRET));
  const seal = (h, b, n) => srv.sealBox(v, 'item', h, b, n);
  const id = 'a'.repeat(32);
  const page = await srv.buildServerItemFrames(seal, { id, kind: 'page', url: 'https://daylight.invalid/i/' + id, title: 'T', content: '<p>x</p>'.repeat(5000), from: 'Digest', extra: { 'x-origin': 'digest' } });
  assert.equal(page.frames.length, 1);
  assert.equal(page.header.enc, 'deflate-raw');
  assert.equal(page.header['x-origin'], 'digest');
  const big = new Uint8Array(2.5 * 1048576).map((_, i) => (i * 7919) & 0xff);
  const file = await srv.buildServerItemFrames(seal, { id, kind: 'file', name: 'a/../b.pdf', mime: 'application/pdf', content: big });
  assert.equal(file.frames.length, 3);
  assert.equal(file.header.enc, undefined, 'files are identity');
  assert.equal(file.header.name, 'a b.pdf', 'the protocol\u2019s safe file name');
  const r = new ds.Reassembler();
  let done = null;
  for (const f of file.frames) {
    const o = await srv.openBox(v, 'item', f);
    assert.ok(f.length <= 1048576 + 65536 + 36);
    done = (await r.add(o.header, o.body)) ?? done;
  }
  assert.deepEqual(done.content, big, 'the protocol reassembler accepts server items');
  await assert.rejects(srv.buildServerItemFrames(seal, { id: 'nothex', kind: 'url', url: 'https://e.com' }));
  await assert.rejects(srv.buildServerItemFrames(seal, { id, kind: 'url', url: 'javascript:x' }));
});

test('buildHostedFrames: ordinary v1 frames under the pairing key, 12 MiB chunks, identity', async () => {
  const keys = await ds.deriveKeys(SECRET);
  const content = new Uint8Array(12_582_912 + 1000).map((_, i) => i & 0xff);
  const built = await srv.buildHostedFrames(keys, { name: 'big.pdf', mime: 'application/pdf', content, from: 'Phone', app: 'ios/1' });
  assert.equal(built.frames.length, 2);
  assert.ok(built.frames[0].length <= srv.HOSTED_FRAME_MAX);
  const r = new ds.Reassembler();
  let done = null;
  for (const f of built.frames) {
    const { header, body } = await ds.decryptFrame(keys, 'inbox', f);
    assert.equal(header.enc, undefined);
    ds.checkItemHeader(header);
    done = (await r.add(header, body)) ?? done;
  }
  assert.equal(done.header.name, 'big.pdf');
  assert.equal(done.content.length, content.length);
  await assert.rejects(srv.buildHostedFrames(keys, { name: 'x', content: { length: srv.HOSTED_MAX + 1 } }));
});

test('publicUrl: every 9.7 form is refused, public URLs pass normalized', () => {
  const refused = [
    'http://192.168.1.1/reboot', 'http://10.0.0.1/', 'http://172.16.5.4/', 'http://127.0.0.1:8080/', 'http://169.254.169.254/latest',
    'http://100.64.0.1/', 'http://0.0.0.0/', 'http://198.18.0.1/', 'http://224.0.0.1/', 'http://240.0.0.1/', 'http://192.0.0.8/',
    'http://2130706433/', 'http://0x7f.1/', 'http://127.1/', 'http://017700000001/',
    'http://[::1]/', 'http://[::]/', 'http://[::ffff:10.0.0.1]/', 'http://[::ffff:8.8.8.8]/', 'http://[::10.0.0.1]/',
    'http://[fc00::1]/', 'http://[fd12:3456::1]/', 'http://[fe80::1]/', 'http://[64:ff9b::a00:1]/', 'http://[64:ff9b::c0a8:101]/',
    'http://[2002:c0a8:101::1]/', 'http://[ff02::1]/',
    'http://localhost/', 'http://foo.localhost/', 'http://printer.local/', 'http://db.internal/', 'http://router.lan/',
    'http://nas.home.arpa/', 'http://router/', 'http://user:pw@example.com/',
    'javascript:alert(1)', 'data:text/html,<b>', 'ftp://example.com/', 'file:///etc/passwd', '/relative', '', null,
    'https://exa mple.com/',
  ];
  for (const u of refused) assert.equal(srv.publicUrl(u), null, String(u));
  const accepted = [
    ['https://example.com/a?b=1#c', 'https://example.com/a?b=1#c'],
    ['HTTPS://EXAMPLE.COM', 'https://example.com/'],
    ['http://8.8.8.8/', 'http://8.8.8.8/'],
    ['http://[2001:db8::1]/', 'http://[2001:db8::1]/'],
    ['http://[64:ff9b::808:808]/', 'http://[64:ff9b::808:808]/'],
    ['https://example.com:8443/x', 'https://example.com:8443/x'],
    ['http://example.com\\@evil.com', 'http://example.com/@evil.com'],
  ];
  for (const [u, want] of accepted) assert.equal(srv.publicUrl(u), want, u);
});

test('every error code has a message; states and notices name what is missing', () => {
  for (const code of srv.ERROR_CODES) {
    const m = srv.errorMessage(code, { limit: 1000, tokens: 300000, resetAt: '2026-10-21T00:00:00.000Z' });
    assert.ok(m && m.length > 10, code);
  }
  assert.match(srv.errorMessage('NEEDS_KEY'), /ANTHROPIC_API_KEY/);
  assert.match(srv.errorMessage('NOT_CONFIGURED', { missing: ['DAYLIGHT_EMAIL_DOMAIN'] }), /DAYLIGHT_EMAIL_DOMAIN/);
  assert.match(srv.errorMessage('NOT_CONFIGURED', { missing: ['R2'] }), /R2/);
  assert.match(srv.errorMessage('AI_DAILY_LIMIT', { resetAt: '2026-10-21T00:00:00.000Z', ceilingUsd: 10 }), /00:00 UTC.*US\$10/);
  assert.equal(srv.errorMessage('AI_DAILY_LIMIT', { resetAt: '2026-10-21T00:00:00.000Z', ceilingUsd: 10, limit: 3, needUsd: 3.07 }),
    'This request could cost up to US$3.07 with Claude, more than today’s AI limit. Raise the limit in Lab settings (up to US$10).');
  assert.match(srv.errorMessage('AI_TOO_LARGE', { tokens: 250000, limit: 200000 }), /250,000.*200,000/);
  assert.match(srv.errorMessage('WHATEVER'), /Something went wrong on the Daylight server \(WHATEVER\)/);
  for (const s of ['needs-server', 'pairing-mismatch', 'server-outdated', 'app-outdated', 'OFFLINE']) assert.ok(srv.localMessage(s));
  assert.match(srv.localMessage('needs-server'), /Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID .*paste the setup link/);
  for (const s of ['pairing-mismatch', 'locked']) assert.match(srv.localMessage(s), /new setup link.*DAYLIGHT_SERVER_CODE/, s);
  assert.match(srv.noticeText('ai'), /Not end-to-end encrypted.*stay end-to-end encrypted/);
  assert.doesNotMatch(srv.noticeText('ai', { delivery: 'v1' }), /stay end-to-end encrypted/);
  assert.match(srv.noticeText('v1'), /holds your pairing code/);
  const e = new srv.ServerError('AI_BUSY', { status: 503, retryAfter: 30 });
  assert.equal(e.retryAfter, 30);
  assert.match(e.message, /busy/);
});

test('pollServerTopic ignores attachments, caps bytes and lines', async () => {
  const v = await srv.deriveServerValues(await srv.deriveServerSeed(SECRET));
  const frame = await srv.buildConfigFrame(v, { server: 'https://a.example' });
  const lines = [];
  lines.push(JSON.stringify({ id: 'a1', time: 1, event: 'message', message: ds.toBase64(frame), attachment: { name: 'x', url: 'https://evil.example/x' } }));
  lines.push(JSON.stringify({ id: 'a2', time: 2, event: 'message', message: ds.toBase64(frame) }));
  for (let i = 0; i < 300; i++) lines.push(JSON.stringify({ id: `j${i}`, time: 3, event: 'message', message: 'junk' }));
  let fetched = [];
  const f = async (url) => { fetched.push(url); return new Response(lines.join('\n') + '\n'); };
  const out = await srv.pollServerTopic(f, 'https://relay.example', 'dls-x', { maxMessages: 50 });
  assert.equal(out.length, 50);
  assert.equal(out[0].frame, null, 'an attachment message is never used');
  assert.ok(out[1].frame);
  assert.deepEqual(fetched, ['https://relay.example/dls-x/json?poll=1&since=all'], 'nothing downloaded');
  const small = await srv.pollServerTopic(f, 'https://relay.example', 'dls-x', { maxBytes: 600, token: 'tk' });
  assert.ok(small.length < 5, 'byte cap');
  assert.match(fetched[1], /auth=tk/);
});

test('DaylightServer: needs-server without a config, pairing-mismatch after re-pairing, OFFLINE without a network', async () => {
  const pairing = { secret: ds.generateSecret(), relay: 'https://relay.example' };
  const empty = async () => new Response('');
  const storage = new ds.MemoryStorage();
  const c = new srv.DaylightServer({ pairing, storage, fetch: empty });
  for (const f of srv.FEATURES) {
    const st = await c.state(f);
    assert.equal(st.state, 'needs-server');
    assert.match(st.message, /Needs the Daylight server/);
  }
  await storage.set('server/pin', { origin: 'https://old.example', fingerprint: '00000000' });
  assert.equal((await c.state('files')).state, 'pairing-mismatch');
  const offline = new srv.DaylightServer({ pairing, storage: new ds.MemoryStorage(), fetch: async () => { throw new TypeError('offline'); } });
  assert.equal((await offline.state('ai')).state, 'OFFLINE');
  assert.match(await c.serverCode(), /^daylightserver:\/\/setup\?c=[A-Z2-7]{28}&r=https%3A%2F%2Frelay\.example$/);
});

test('DaylightServer: TOFU pin, a moved server needs confirmation, newer API majors need an app update', async () => {
  const secret = ds.generateSecret();
  const pairing = { secret, relay: 'https://relay.example' };
  const values = await srv.deriveServerValues(await srv.deriveServerSeed(secret));
  let configs = [];
  const fetchFn = async (url) => {
    if (String(url).includes(values.configTopic)) {
      return new Response(configs.map((f, i) => JSON.stringify({ id: `m${i}`, time: i, event: 'message', message: ds.toBase64(f) })).join('\n') + '\n');
    }
    return Response.json({ features: Object.fromEntries(srv.FEATURES.map((f) => [f, { state: 'ready' }])) });
  };
  const storage = new ds.MemoryStorage();
  const c = new srv.DaylightServer({ pairing, storage, fetch: fetchFn });
  configs = [await srv.buildConfigFrame(values, { server: 'https://a.example', sent: new Date(Date.now() - 60_000).toISOString() })];
  assert.equal((await c.discover({ force: true })).config.server, 'https://a.example');
  configs.push(await srv.buildConfigFrame(values, { server: 'https://b.example', sent: new Date(Date.now() - 30_000).toISOString() }));
  const moved = await c.discover({ force: true });
  assert.equal(moved.config.server, 'https://a.example', 'keeps the pinned origin until the user confirms');
  assert.equal(moved.moved, 'https://b.example');
  assert.equal(await c.confirmMove(), true);
  assert.equal((await c.discover({ force: true })).config.server, 'https://b.example');
  configs.push(await srv.buildConfigFrame(values, { server: 'https://b.example', api: 2, sent: new Date().toISOString() }));
  await c.discover({ force: true });
  assert.equal((await c.state('ai')).state, 'app-outdated');
  configs.push(await srv.buildConfigFrame(values, { server: 'https://evil.example', sent: new Date(Date.now() + 3600_000).toISOString() }));
  const d = await c.discover({ force: true });
  assert.equal(d.config.server, 'https://b.example', 'a config from the future is ignored');
  assert.equal(d.moved, undefined);
});

// ---- noteError and the state mapping (LAB-PLAN 2.6; the cases themselves are server-vectors.json › serverState)

/** A fake server: GET /v1/status answers `status()`, every other path `call()`; the relay answers `relay()`. */
async function fakeServer({ status, call, relay } = {}) {
  const secret = ds.generateSecret();
  const values = await srv.deriveServerValues(await srv.deriveServerSeed(secret));
  const log = [];
  let now = Date.parse('2026-10-20T06:00:00Z');
  const config = await srv.buildConfigFrame(values, { server: 'https://dls.example', sent: new Date(now - 60_000).toISOString() });
  const fetchFn = async (url) => {
    const u = new URL(url);
    log.push(u.origin === 'https://dls.example' ? u.pathname : `relay${u.pathname}`);
    if (u.origin === 'https://relay.example') {
      if (relay) return relay(u);
      return new Response(JSON.stringify({ id: 'c1', time: 1, event: 'message', message: ds.toBase64(config) }) + '\n');
    }
    if (u.pathname === '/v1/status') return status();
    return call(u);
  };
  const storage = new ds.MemoryStorage();
  const client = new srv.DaylightServer({ pairing: { secret, relay: 'https://relay.example' }, storage, fetch: fetchFn, now: () => now });
  return { client, storage, log, values, tick: (ms) => { now += ms; } };
}
const allReady = (over = {}) => ({ features: { ...Object.fromEntries(srv.FEATURES.map((f) => [f, { state: 'ready' }])), ...over } });
const errorAnswer = (status, error) => new Response(JSON.stringify({ error }), { status });
const caught = async (p) => { try { await p; } catch (e) { return e; } assert.fail('expected a rejection'); };

test('noteError: NEEDS_LAB_INBOX marks the feature the server names, and the next state() asks the server', async () => {
  let server = allReady({ deliver: { state: 'needs-lab-inbox', message: srv.STATE_MESSAGES['needs-lab-inbox'] } });
  const s = await fakeServer({ status: () => Response.json(server), call: () => errorAnswer(409, { code: 'NEEDS_LAB_INBOX', feature: 'deliver' }) });
  assert.deepEqual(await s.client.state('ai'), { state: 'ready', message: null });
  // The cached status is a minute old; the app had cached deliver as ready, as an older server said.
  await s.storage.set('server/status', allReady());
  const err = await caught(s.client.ai.summarize({ text: 'x' }, { deliver: 'both' }));
  assert.equal(err.code, 'NEEDS_LAB_INBOX');
  s.log.length = 0;
  assert.deepEqual(await s.client.noteError('ai', err), { state: 'needs-lab-inbox', message: srv.STATE_MESSAGES['needs-lab-inbox'] });
  assert.deepEqual(s.log, [], 'no request');
  assert.equal((await s.storage.get('server/status')).features.deliver.state, 'needs-lab-inbox');
  assert.equal((await s.storage.get('server/status')).features.ai.state, 'ready', 'AI without delivery still works');
  assert.deepEqual(await s.client.state('ai'), { state: 'ready', message: null });
  assert.deepEqual(s.log, ['/v1/status'], 'the noted status was refreshed from the server');
  assert.deepEqual(await s.client.state('deliver'), { state: 'needs-lab-inbox', message: srv.STATE_MESSAGES['needs-lab-inbox'] });
  assert.deepEqual(s.log, ['/v1/status'], 'then cached again for 10 minutes');
  server = allReady();
  s.tick(srv.STATUS_REFRESH_MS);
  assert.deepEqual(await s.client.state('deliver'), { state: 'ready', message: null }, 'the server’s word wins on the next refresh');
});

test('noteError: NEEDS_KEY offline keeps the noted state; RATE_LIMITED keeps the feature ready', async () => {
  let online = true;
  const s = await fakeServer({
    status: () => { if (!online) throw new TypeError('offline'); return Response.json(allReady()); },
    call: (u) => (u.pathname === '/v1/feeds' ? errorAnswer(429, { code: 'RATE_LIMITED', retryAfter: 60 }) : errorAnswer(409, { code: 'NEEDS_KEY', feature: 'ai', missing: ['ANTHROPIC_API_KEY'] })),
  });
  assert.equal((await s.client.state('ai')).state, 'ready');
  const limited = await caught(s.client.feeds.add('https://example.com/feed'));
  assert.equal(limited.retryAfter, 60);
  assert.deepEqual(await s.client.noteError('feeds', limited), { state: 'error', message: srv.errorMessage('RATE_LIMITED') });
  assert.equal(await s.storage.get('server/statusAt'), Date.parse('2026-10-20T06:00:00Z'), 'the cache is kept as it was');
  assert.equal((await s.client.state('feeds')).state, 'ready');
  const nokey = await caught(s.client.ai.summarize({ text: 'x' }));
  online = false;
  assert.equal((await s.client.noteError('ai', nokey)).state, 'needs-key');
  assert.deepEqual(await s.client.state('ai'), { state: 'needs-key', message: srv.STATE_MESSAGES['needs-key'] }, 'offline: the noted state');
  assert.deepEqual(await s.client.state('feeds'), { state: 'ready', message: null });
});

test('noteError: BAD_AUTH drops the status and re-reads the config topic once; LOCKED from state() drops a stale status', async () => {
  let statusAnswer = () => Response.json(allReady());
  const s = await fakeServer({ status: () => statusAnswer(), call: () => errorAnswer(401, { code: 'BAD_AUTH' }) });
  assert.equal((await s.client.state('files')).state, 'ready');
  const relayPolls = () => s.log.filter((l) => l.startsWith('relay/')).length;
  assert.equal(relayPolls(), 1);
  const err = await caught(s.client.feeds.list());
  assert.deepEqual(await s.client.noteError('feeds', err), { state: 'error', message: srv.errorMessage('BAD_AUTH') });
  assert.equal(await s.storage.get('server/status'), undefined);
  assert.equal(typeof (await s.storage.get('server/badAuthAt')), 'number', 'a BAD_AUTH episode began');
  assert.equal((await s.client.state('files')).state, 'ready');
  assert.equal(relayPolls(), 2, 'the config was read again');
  assert.equal(await s.storage.get('server/badAuthAt'), undefined, 'the status answered, so the episode is over');
  assert.equal((await s.client.state('files')).state, 'ready');
  assert.equal(relayPolls(), 2, 'once');

  s.tick(srv.STATUS_REFRESH_MS + 1);
  statusAnswer = () => errorAnswer(423, { code: 'LOCKED' });
  assert.deepEqual(await s.client.state('ai'), { state: 'locked', message: srv.STATE_MESSAGES.locked });
  assert.equal(await s.storage.get('server/status'), undefined, 'the stale status is gone, so offline it cannot answer ready');
  statusAnswer = () => { throw new TypeError('offline'); };
  assert.equal((await s.client.state('ai')).state, 'OFFLINE');
});

test('BAD_AUTH: a server that keeps answering 401 makes one config re-read per episode, not one per state()', async () => {
  let statusAnswer = () => errorAnswer(401, { code: 'BAD_AUTH' });
  const s = await fakeServer({ status: () => statusAnswer(), call: () => errorAnswer(401, { code: 'BAD_AUTH' }) });
  const relayPolls = () => s.log.filter((l) => l.startsWith('relay/')).length;
  const statusCalls = () => s.log.filter((l) => l === '/v1/status').length;
  const badAuth = { state: 'error', message: srv.errorMessage('BAD_AUTH') };
  // What's in Lab refreshing its four server rows, twice, an hour apart.
  for (const f of ['ai', 'email', 'feeds', 'files']) assert.deepEqual(await s.client.state(f), badAuth, f);
  assert.equal(relayPolls(), 2, 'the first discovery and one forced re-read');
  assert.equal(statusCalls(), 4);
  const episode = await s.storage.get('server/badAuthAt');
  assert.equal(typeof episode, 'number');
  s.tick(3600e3);
  for (const f of ['ai', 'email', 'feeds', 'files']) assert.deepEqual(await s.client.state(f), badAuth, f);
  const err = await caught(s.client.feeds.list());
  assert.deepEqual(await s.client.noteError('feeds', err), badAuth);
  assert.equal(relayPolls(), 2, 'no more relay polls in the same episode');
  assert.equal(await s.storage.get('server/badAuthAt'), episode, 'the episode keeps its start');
  assert.ok(await s.storage.get('server/configAt'), 'the re-read config is kept');

  // After CONFIG_REFRESH_MS the config is refreshed as usual, once.
  s.tick(srv.CONFIG_REFRESH_MS);
  await s.client.state('ai'); await s.client.state('files');
  assert.equal(relayPolls(), 3, 'the six-hourly refresh');

  // The server knows this device again: the episode ends, and a new one re-reads the config once more.
  statusAnswer = () => Response.json(allReady());
  assert.deepEqual(await s.client.state('ai'), { state: 'ready', message: null });
  assert.equal(await s.storage.get('server/badAuthAt'), undefined);
  statusAnswer = () => errorAnswer(401, { code: 'BAD_AUTH' });
  await s.client.noteError('ai', await caught(s.client.feeds.list()));
  for (const f of ['ai', 'email', 'feeds', 'files']) assert.deepEqual(await s.client.state(f), badAuth, f);
  assert.equal(relayPolls(), 4, 'one re-read for the new episode');

  // lockBeforeRepair ends the episode too, so the next pairing starts clean.
  await s.client.lockBeforeRepair();
  assert.equal(await s.storage.get('server/badAuthAt'), undefined);
});

test('state(): a /v1/status answer cannot pose as OFFLINE and so revive an hour-old cached status', async () => {
  let statusAnswer = () => Response.json(allReady());
  const s = await fakeServer({ status: () => statusAnswer(), call: () => errorAnswer(500, { code: 'OFFLINE' }) });
  assert.deepEqual(await s.client.state('ai'), { state: 'ready', message: null });
  s.tick(3600e3);
  statusAnswer = () => errorAnswer(500, { code: 'OFFLINE', message: 'Fake.' });
  const err = await caught(s.client.status());
  assert.equal(err.code, 'SERVER_ERROR', 'the code OFFLINE is not read');
  assert.equal(err.status, 500);
  const generic = { state: 'error', message: srv.errorMessage('SERVER_ERROR') };
  assert.deepEqual(await s.client.state('ai'), generic, 'a server error, not the cached ready');
  assert.deepEqual(srv.stateFromError(err), generic, 'and not OFFLINE');
  assert.equal((await caught(s.client.feeds.list())).code, 'SERVER_ERROR');
  // A real network failure still falls back to the cached status.
  statusAnswer = () => { throw new TypeError('offline'); };
  assert.deepEqual(await s.client.state('ai'), { state: 'ready', message: null });
});

test('state(): the status path keeps to the closed set and the module’s text', async () => {
  const s = await fakeServer({
    status: () => Response.json(allReady({
      ai: { state: 'needs-server', message: srv.STATE_MESSAGES['needs-server'] },
      email: { state: 'needs-pairing' },
      feeds: { state: 'needs-lab-inbox', message: 'A newer server’s own text.' },
      files: { state: 'OFFLINE' },
      deliver: { state: 'needs-dns', message: 'Add the DNS record.' },
    })),
    call: () => Response.json({}),
  });
  const generic = srv.errorMessage('SERVER_ERROR');
  assert.deepEqual(await s.client.state('ai'), { state: 'error', message: srv.STATE_MESSAGES['needs-server'] });
  assert.deepEqual(await s.client.state('email'), { state: 'error', message: generic });
  assert.deepEqual(await s.client.state('feeds'), { state: 'needs-lab-inbox', message: srv.STATE_MESSAGES['needs-lab-inbox'] });
  assert.deepEqual(await s.client.state('files'), { state: 'error', message: generic });
  assert.deepEqual(await s.client.state('deliver'), { state: 'error', message: 'Add the DNS record.' });
  for (const f of srv.FEATURES) assert.ok(srv.SERVER_STATES.includes((await s.client.state(f)).state), f);
  // noteError's text and the status path's text agree for a state the server decides.
  const noted = await s.client.noteError('feeds', new srv.ServerError('NEEDS_LAB_INBOX', { message: 'A newer server’s own text.' }));
  assert.deepEqual(noted, await s.client.state('feeds'));
});

test('noteError never throws: storage that fails, odd errors and odd features', async () => {
  const broken = { get: async () => { throw new Error('disk'); }, set: async () => { throw new Error('disk'); }, remove: async () => { throw new Error('disk'); } };
  const c = new srv.DaylightServer({ pairing: { secret: ds.generateSecret(), relay: 'https://relay.example' }, storage: broken, fetch: async () => new Response('') });
  for (const code of ['NEEDS_KEY', 'NOT_CONFIGURED', 'NEEDS_LAB_INBOX', 'LOCKED', 'BAD_AUTH', 'AI_BUSY']) {
    assert.ok((await c.noteError('ai', new srv.ServerError(code))).message, code);
  }
  assert.equal((await c.noteError('ai', undefined)).state, 'OFFLINE');
  assert.equal((await c.noteError('ai', new TypeError('x'))).state, 'OFFLINE');
  assert.equal((await c.noteError('nope', { code: 'NEEDS_KEY' })).state, 'needs-key');
  assert.deepEqual(await c.noteError('ai', new ds.ShareError('too-large', 'Files can be up to 192 MB through your Daylight server.')),
    { state: 'error', message: 'Files can be up to 192 MB through your Daylight server.' });
  const storage = new ds.MemoryStorage();
  await storage.set('server/status', { features: null });
  const d = new srv.DaylightServer({ pairing: { secret: ds.generateSecret(), relay: 'https://relay.example' }, storage, fetch: async () => new Response('') });
  await d.noteError('__proto__', { code: 'NEEDS_KEY' });
  await d.noteError('files', { code: 'NOT_CONFIGURED', missing: ['R2'] });
  assert.deepEqual((await storage.get('server/status')).features, { files: { state: 'needs-r2', message: srv.STATE_MESSAGES['needs-r2'] } });
  assert.equal(Object.getPrototypeOf((await storage.get('server/status')).features), Object.prototype);
});

test('request(): only an error object with a server-shaped code is read; the message must be a string', async () => {
  const s = await fakeServer({
    status: () => Response.json(allReady()),
    call: (u) => ({
      '/v1/feeds': () => errorAnswer(400, { code: 'OFFLINE ', message: 'x' }),
      '/v1/feeds/import': () => errorAnswer(500, { code: 'OFFLINE', message: 'x' }),
      '/v1/digest/send': () => errorAnswer(400, { code: 'A'.repeat(40), message: 'Forty.' }),
      '/v1/email': () => errorAnswer(409, { code: 'NEEDS_KEY', message: { html: '<b>x</b>' } }),
      '/v1/settings': () => Response.json({ error: 'not an object', ok: true }),
    }[u.pathname] ?? (() => errorAnswer(418, { code: 'x'.repeat(41).toUpperCase() })))(),
  });
  assert.equal((await caught(s.client.feeds.list())).code, 'SERVER_ERROR');
  const e = await caught(s.client.email.info());
  assert.equal(e.code, 'NEEDS_KEY');
  assert.equal(e.message, srv.STATE_MESSAGES['needs-key']);
  assert.deepEqual(await s.client.settings.get(), { error: 'not an object', ok: true }, 'a 200 answer is the result');
  assert.equal((await caught(s.client.feeds.check('a'))).code, 'SERVER_ERROR', 'a code over 40 characters');
  assert.equal((await caught(s.client.feeds.importOpml('<opml/>'))).code, 'SERVER_ERROR', 'OFFLINE is the app’s, never the server’s');
  const forty = await caught(s.client.feeds.sendDigestNow());
  assert.equal(forty.code, 'A'.repeat(40), 'a code of 40 characters is read');
  assert.equal(forty.message, 'Forty.');
});

test('notConfiguredState and errorMessage read missing in one order: the Server code, the email domain, R2', () => {
  const cases = [
    [['R2', 'DAYLIGHT_EMAIL_DOMAIN', 'DAYLIGHT_SERVER_CODE'], 'needs-server'], [['R2', 'DAYLIGHT_EMAIL_DOMAIN'], 'needs-domain'],
    [['R2'], 'needs-r2'], [[], 'needs-server'], ['R2', 'needs-server'], [undefined, 'needs-server'], [['ANTHROPIC_API_KEY'], 'needs-server'],
  ];
  for (const [missing, state] of cases) {
    assert.equal(srv.notConfiguredState(missing), state, JSON.stringify(missing));
    assert.equal(srv.errorMessage('NOT_CONFIGURED', { missing }), srv.STATE_MESSAGES[state]);
    assert.deepEqual(srv.stateFromError({ code: 'NOT_CONFIGURED', missing }), { state, message: srv.STATE_MESSAGES[state] });
  }
});

test('files.tick: Lab frames on the pairing ack topic (hello, x-st naming the hosted item, lab: 0) deliver nothing', async () => {
  const { startRelay, RELAY_ORIGIN } = await import('./relay.mjs');
  const relay = await startRelay();
  try {
    const secret = ds.generateSecret();
    const keys = await ds.deriveKeys(secret);
    const storage = new ds.MemoryStorage();
    const fetchFn = async (url, init) => (new URL(url).origin === RELAY_ORIGIN ? relay.handle(url, init) : new Response('', { status: 404 }));
    const c = new srv.DaylightServer({ pairing: { secret, relay: RELAY_ORIGIN }, storage, fetch: fetchFn });
    const id = 'ab'.repeat(16);
    const now = Date.now();
    await storage.set('server/hosted', [{ id, fileId: 'cd'.repeat(16), parts: 1, urls: [], name: 'big.pdf', size: 1, title: '', sent: '', created: now, lastPublish: now, status: 'sent' }]);
    const sent = new Date().toISOString();
    const info = (lab) => ({ lab, app: 'android/1.5.0', caps: lab ? ['st', 'tap', 'reader-link'] : [], poll: sent, live: true });
    const post = async (header) => relay.handle(`${RELAY_ORIGIN}/${keys.ackTopic}`, { method: 'POST', body: ds.toBase64(await ds.encryptFrame(keys, 'ack', header, new Uint8Array(0))) });
    await post({ v: 1, kind: 'ack', ids: [], sent, from: 'Daylight', 'x-inbox': info(1) });
    await post({ v: 1, kind: 'ack', ids: [], sent, from: 'Daylight', 'x-inbox': info(1), 'x-st': [{ i: id, s: 'reader', t: Math.floor(now / 1000) }] });
    await post({ v: 1, kind: 'ack', ids: [], sent, from: 'Daylight', 'x-inbox': info(0) });
    assert.deepEqual(await c.files.tick(), { delivered: 0, republished: 0, expired: 0 });
    assert.equal((await c.files.list())[0].status, 'sent');
    await post({ v: 1, kind: 'ack', ids: [id], sent, from: 'Daylight' });
    assert.equal((await c.files.tick()).delivered, 1, 'the Inbox’s own ack still delivers it');
  } finally { await relay.close(); }
});
