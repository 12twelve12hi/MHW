// The Worker in workerd (Miniflare): authentication and request handling order (DESIGN.md 3.3, 3.4, 10.1-10.3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, SERVER } from './helpers.mjs';

let t;
before(async () => { t = await setup(); });
after(async () => { await t?.close(); });

test('unauthenticated routes: hello (no version), robots, CORS preflight, unknown paths', async () => {
  const hello = await t.dispatch(`${SERVER}/v1/hello`);
  assert.equal(hello.status, 200);
  assert.deepEqual(await hello.json(), { service: 'daylight-server', api: 1 });
  assert.equal(hello.headers.get('cache-control'), 'no-store');
  assert.match(hello.headers.get('x-dls-request-id'), /^[0-9a-f]{16}$/);
  const robots = await t.dispatch(`${SERVER}/robots.txt`);
  assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
  const pre = await t.dispatch(`${SERVER}/v1/ai`, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.equal(pre.headers.get('access-control-allow-headers'), 'Authorization, Content-Type, X-DLS-Source-Name');
  assert.equal(pre.headers.get('access-control-allow-methods'), 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  for (const p of ['/', '/admin', '/v1/nothing', '/v1/files/notanid', '/.env']) {
    const r = await t.dispatch(`${SERVER}${p}`);
    assert.equal(r.status, 404, p);
    assert.equal(r.headers.get('x-dls-test-d1'), '0', 'no D1 lookup for unknown paths');
  }
});

test('a missing, malformed or wrong token is 401 BAD_AUTH, with no D1 work', async () => {
  for (const token of [null, 'abc', 'A'.repeat(64), 'f'.repeat(64)]) {
    const r = await t.api('GET', '/v1/status', { token });
    assert.equal(r.status, 401);
    assert.equal(r.json.error.code, 'BAD_AUTH');
    assert.match(r.json.error.message, /DAYLIGHT_SERVER_CODE/);
    assert.equal(r.headers.get('x-dls-test-d1'), '0');
  }
  const ok = await t.api('GET', '/v1/status');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.fingerprint, t.values.fingerprint);
});

test('a 50 MB body with a bad token is rejected without being read', async () => {
  // A raw HTTP request that sends the headers and then the body only while nobody has answered.
  const r = await t.raw('PUT', `/v1/files/${'a'.repeat(32)}/0?n=1`, {
    token: '0'.repeat(64), length: 50_000_000, headers: { 'Content-Type': 'application/octet-stream' },
  });
  const { status, headers, written } = r;
  assert.equal(status, 401);
  assert.equal(headers['x-dls-test-body-read'], '0');
  assert.equal(headers['x-dls-test-d1'], '0');
  assert.ok(written < 16 * 1024 * 1024, `only transport buffering was sent (${written} bytes)`);
});

test('411 without Content-Length, 413 over the cap, 415 for the wrong type', async () => {
  const chunked = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{}')); c.close(); } });
  const r411 = await t.dispatch(`${SERVER}/v1/settings`, {
    method: 'PATCH', body: chunked, duplex: 'half', headers: { Authorization: `Bearer ${t.values.authToken}`, 'Content-Type': 'application/json' },
  });
  assert.equal(r411.status, 411);
  assert.equal((await r411.json()).error.code, 'LENGTH_REQUIRED');
  const big = await t.api('PATCH', '/v1/settings', { body: JSON.stringify({ x: 'y'.repeat(70_000) }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(big.status, 413);
  assert.equal(big.json.error.code, 'TOO_LARGE');
  assert.equal(big.json.error.limit, 65536);
  assert.equal(big.headers.get('x-dls-test-body-read'), '0');
  const form = await t.api('PATCH', '/v1/settings', { body: 'a=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 415);
  const badJson = await t.api('PATCH', '/v1/settings', { body: '{nope', headers: { 'Content-Type': 'application/json' } });
  assert.equal(badJson.status, 400);
  assert.doesNotMatch(badJson.text, /nope/, 'error messages never quote input');
});

test('settings: AI cap up to the deploy ceiling, digest hour and time zone', async () => {
  const get = await t.api('GET', '/v1/settings');
  assert.deepEqual(get.json, { ai: { dailyUsd: 3, ceilingUsd: 10, maxRequests: 100 }, digest: { hour: 7, tz: 'UTC' } });
  const up = await t.api('PATCH', '/v1/settings', { json: { ai: { dailyUsd: 7.5 }, digest: { hour: 6, tz: 'Europe/Berlin' } } });
  assert.deepEqual(up.json, { ai: { dailyUsd: 7.5, ceilingUsd: 10, maxRequests: 100 }, digest: { hour: 6, tz: 'Europe/Berlin' } });
  assert.equal((await t.api('PATCH', '/v1/settings', { json: { ai: { dailyUsd: 11 } } })).status, 400, 'apps can only go lower than the ceiling');
  assert.equal((await t.api('PATCH', '/v1/settings', { json: { digest: { tz: 'Mars/Olympus' } } })).status, 400);
  assert.equal((await t.api('PATCH', '/v1/settings', { json: { digest: { hour: 24 } } })).status, 400);
});

test('status reports the config fields, feature states and usage', async () => {
  const s = (await t.api('GET', '/v1/status')).json;
  assert.equal(s.server, SERVER);
  assert.equal(s.api, 1);
  assert.equal(s.delivery, 'lab');
  assert.equal(s.plan, 'free');
  assert.deepEqual(Object.keys(s.features).sort(), ['ai', 'deliver', 'email', 'feeds', 'files', 'pdf']);
  assert.equal(s.features.ai.state, 'ready');
  assert.equal(s.features.files.state, 'ready');
  assert.equal(s.features.deliver.state, 'needs-lab-inbox', 'Lab delivery before the Lab Inbox said hello');
  assert.match(s.features.deliver.message, /hasn’t heard from your Daylight yet/);
  assert.equal(s.usage.ai.limitUsd, 7.5);
  assert.ok(s.usage.ai.resetAt.endsWith('T00:00:00.000Z'));
  assert.equal(s.storage.limit, 8 * 1024 * 1024 * 1024);
});

test('lock: every authenticated request answers 423 and hosted frames 410 until a new Server code', async () => {
  // A stored hosted file first.
  const fileId = 'c'.repeat(32);
  const frame = new Uint8Array(1000).fill(3);
  assert.equal((await t.api('PUT', `/v1/files/${fileId}/0?n=1`, { body: frame, headers: { 'Content-Type': 'application/octet-stream' } })).status, 204);
  assert.equal((await t.dispatch(`${SERVER}/f/${fileId}/0`)).status, 200);
  const lock = await t.api('POST', '/v1/admin/lock', { json: {} });
  assert.equal(lock.status, 204);
  const st = await t.api('GET', '/v1/status');
  assert.equal(st.status, 423);
  assert.equal(st.json.error.code, 'LOCKED');
  assert.match(st.json.error.message, /re-paired/);
  assert.equal((await t.dispatch(`${SERVER}/f/${fileId}/0`)).status, 410);
  const report = await t.cron();
  assert.deepEqual(Object.keys(report.steps).filter((k) => !['settings', 'cleanup'].includes(k)), [], 'the Cron publishes and fetches nothing');
  assert.equal(report.sub, 0);
  await t.db.prepare("DELETE FROM settings WHERE k = 'lock'").run();
});

test('after 30 failures a minute from one address, the answer is 429 with no further work', async () => {
  let last;
  for (let i = 0; i < 32; i++) last = await t.api('GET', '/v1/status', { token: 'e'.repeat(64), headers: { 'CF-Connecting-IP': '203.0.113.9' } });
  assert.equal(last.status, 429);
  assert.equal(last.json.error.code, 'RATE_LIMITED');
  assert.equal(last.headers.get('retry-after'), '60');
  const other = await t.api('GET', '/v1/status', { token: 'e'.repeat(64), headers: { 'CF-Connecting-IP': '203.0.113.10' } });
  assert.equal(other.status, 401, 'counted per address');
  for (let i = 0; i < 31; i++) await t.dispatch(`${SERVER}/f/${'9'.repeat(32)}/0`, { headers: { 'CF-Connecting-IP': '203.0.113.11' } });
  assert.equal((await t.dispatch(`${SERVER}/o/${'9'.repeat(32)}/0`, { headers: { 'CF-Connecting-IP': '203.0.113.11' } })).status, 429, 'unknown hosted ids count too');
});

test('without a Server code, or with a pairing code in its place, the server is not configured', async () => {
  const pairingInstead = await setup({ vars: { DAYLIGHT_SERVER_CODE: 'E4AY-56TM-ADQP-5QSN-MY7B-CGPZ-UFRA' } });
  try {
    const r = await pairingInstead.api('GET', '/v1/status');
    assert.equal(r.status, 503);
    assert.equal(r.json.error.code, 'NOT_CONFIGURED');
    assert.deepEqual(r.json.error.missing, ['DAYLIGHT_SERVER_CODE']);
    assert.equal((await pairingInstead.dispatch(`${SERVER}/v1/hello`)).status, 200);
  } finally { await pairingInstead.close(); }
});
