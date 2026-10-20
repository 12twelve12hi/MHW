// The server's outbox and its relay traffic (DESIGN.md 4, 5): config frames and discovery, small and hosted frames, the
// Lab Inbox's hello, acks, re-sends at 11 h, expiry, the ntfy budget, relay back-off, junk on the ack topic, both
// delivery modes and v1 safety.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as ds from '../../share/js/daylight-share.js';
import * as srv from '../client/daylight-server.js';
import { setup, SERVER, RELAY_ORIGIN } from './helpers.mjs';

const HOUR = 3600_000;
let t;
let failNext = null; // status for the next publish to the item topic
before(async () => {
  t = await setup({ knobs: { ntfyPerDay: 40 }, relayOptions: { failPublish: () => { const s = failNext; failNext = null; return s; } } });
});
after(async () => { await t?.close(); });

const enqueue = async (tt, item, now = Date.now()) => (await tt.dispatch(`${SERVER}/__test/enqueue`, { method: 'POST', body: JSON.stringify(item), headers: { 'X-DLS-Test-Now': String(now) } })).json();
const T0 = Date.now();

test('config: the first Cron run publishes it; the client discovers, checks and pins it; announce lists it', async () => {
  assert.equal(await t.client.discover(), null, 'nothing published yet');
  const report = await t.cron(T0);
  assert.equal(report.steps.config, '200');
  const d = await t.client.discover({ force: true });
  assert.equal(d.source, 'relay');
  assert.equal(d.config.server, SERVER);
  assert.equal(d.config.fingerprint, t.values.fingerprint);
  assert.equal(d.config.delivery, 'lab');
  assert.equal((await t.client.discover()).source, 'cache');
  assert.deepEqual(await t.client.storage.get('server/pin'), { origin: SERVER, fingerprint: t.values.fingerprint });
  const a = await t.api('POST', '/v1/admin/announce', { json: {} });
  assert.deepEqual(a.json, { published: 200, listed: true });
  assert.equal((await t.api('POST', '/v1/admin/announce', { json: {} })).status, 429, 'at most once a minute');
  assert.equal((await t.cron(T0 + 60_000)).steps.config, undefined, 'not again within the 6-hour slot');
  const frames = t.relay.messages(t.values.configTopic);
  assert.ok(frames.length >= 2);
  assert.ok(frames.every((m) => !m.attachment), 'config frames are always small');
});

test('the client applies the Lab feature states and their messages', async () => {
  const st = await t.client.state('deliver');
  assert.equal(st.state, 'needs-lab-inbox');
  assert.match(st.message, /Turn on Lab/);
  assert.deepEqual(await t.client.state('ai'), { state: 'ready', message: null });
});

test('the Lab Inbox’s hello sets inbox.lastSeen and the delivering features become ready', async () => {
  await t.lane.hello('lab-inbox/1.2');
  const r = await t.cron(T0 + 7 * HOUR);
  assert.equal(r.steps.acks, '0');
  const s = (await t.api('GET', '/v1/status')).json;
  assert.equal(s.inbox.lab, true);
  assert.ok(s.inbox.lastSeen);
  assert.equal(s.features.deliver.state, 'ready');
  assert.equal(s.features.feeds.state, 'ready');
});

let pageId, urlId;
test('small frames go as messages, larger ones as Attach: messages served from /o/<token>/<i>', async () => {
  const big = Array.from({ length: 120_000 }, (_, i) => `<p>${(i * 2654435761 >>> 0).toString(36)}</p>`).join('');
  pageId = (await enqueue(t, { origin: 'test:page', kind: 'page', title: 'A large page', text: big })).id;
  urlId = (await enqueue(t, { origin: 'test:url', kind: 'url', url: 'https://example.com/story', title: 'A story' })).id;
  const [row] = await t.rows('SELECT parts, state FROM outbox WHERE id = ?', pageId);
  assert.equal(row.state, 'queued');
  assert.ok(row.parts >= 2, 'over 1 MiB of encoded page: several 1 MiB parts');
  const before = t.relay.messages(t.values.itemTopic).length;
  const r = await t.cron(T0 + 7 * HOUR + 60_000);
  assert.equal(Number(r.steps.outbox), row.parts + 1);
  const msgs = t.relay.messages(t.values.itemTopic).slice(before);
  const attach = msgs.filter((m) => m.attachment);
  assert.equal(attach.length, row.parts);
  for (const m of attach) {
    const url = t.relay.externalUrl(m.id);
    assert.match(url, /^https:\/\/daylight\.test\/o\/[0-9a-f]{32}\/\d$/);
    assert.equal(m.message, 'dls1');
  }
  const items = await t.lane.poll();
  const page = items.find((i) => i.header.id === pageId);
  assert.equal(new TextDecoder().decode(page.content), big, 'the Lab lane reassembles hosted frames intact');
  assert.equal(page.header.title, 'A large page');
  assert.ok(items.find((i) => i.header.id === urlId && i.header.url === 'https://example.com/story'));
  assert.equal(page.header.app, 'server/1');
});

test('acks: delivered items lose their frames and their hosted URLs answer 410', async () => {
  const [row] = await t.rows('SELECT token FROM outbox WHERE id = ?', pageId);
  assert.equal((await t.dispatch(`${SERVER}/o/${row.token}/0`)).status, 200);
  const r = await t.cron(T0 + 8 * HOUR);
  assert.equal(r.steps.acks, '2');
  const states = await t.rows('SELECT id, state FROM outbox WHERE id IN (?, ?)', pageId, urlId);
  assert.ok(states.every((s) => s.state === 'delivered'));
  assert.equal((await t.rows('SELECT COUNT(*) AS n FROM frames WHERE item_id = ?', pageId))[0].n, 0);
  assert.equal((await t.dispatch(`${SERVER}/o/${row.token}/0`)).status, 410);
  assert.equal((await t.dispatch(`${SERVER}/o/${'0'.repeat(32)}/0`)).status, 404);
});

test('unacked items are re-sent 11 h after their last publish, and expire after 7 days', async () => {
  const t1 = T0 + 9 * HOUR;
  const id = (await enqueue(t, { origin: 'test:resend', kind: 'url', url: 'https://example.com/r', title: 'Resend me' }, t1)).id;
  await t.cron(t1);
  const count = () => t.relay.messages(t.values.itemTopic).length;
  const n1 = count();
  await t.cron(t1 + 10 * HOUR);
  assert.equal(count(), n1, 'not before 11 h');
  await t.cron(t1 + 11 * HOUR + 60_000);
  assert.equal(count(), n1 + 1, 're-sent');
  const [row] = await t.rows('SELECT state, publishes FROM outbox WHERE id = ?', id);
  assert.deepEqual(row, { state: 'sent', publishes: 2 });
  await t.cron(t1 + 7 * 24 * HOUR + 2 * HOUR);
  await t.cron(t1 + 7 * 24 * HOUR + 3 * HOUR);
  assert.equal((await t.rows('SELECT state FROM outbox WHERE id = ?', id))[0].state, 'expired');
});

test('relay answers: 429 backs off and retries later; another 4xx rejects the item', async () => {
  const t2 = T0 + 20 * 24 * HOUR;
  const id = (await enqueue(t, { origin: 'test:busy', kind: 'url', url: 'https://example.com/busy' }, t2)).id;
  failNext = 429;
  let r = await t.cron(t2);
  assert.equal(r.steps.outbox, '0');
  assert.equal((await t.rows('SELECT state FROM outbox WHERE id = ?', id))[0].state, 'queued');
  r = await t.cron(t2 + 30_000);
  assert.equal(r.steps.outbox, undefined, 'backing off');
  r = await t.cron(t2 + 2 * 60_000);
  assert.equal(r.steps.outbox, '1');
  const bad = (await enqueue(t, { origin: 'test:bad', kind: 'url', url: 'https://example.com/bad' }, t2)).id;
  failNext = 400;
  await t.cron(t2 + 3 * 60_000);
  const [row] = await t.rows('SELECT state, error FROM outbox WHERE id = ?', bad);
  assert.deepEqual(row, { state: 'rejected', error: 'HTTP_400' });
  const st = (await t.api('GET', '/v1/status')).json;
  assert.ok(st.errors.some((e) => e.code === 'RELAY_400'));
});

test('the daily ntfy budget holds frames in the outbox', async () => {
  const small = await setup({ knobs: { ntfyPerDay: 3 } });
  try {
    await small.cron(T0); // the config frame uses one
    for (let i = 0; i < 4; i++) await enqueue(small, { origin: `test:b${i}`, kind: 'url', url: `https://example.com/${i}` });
    const r = await small.cron(T0 + 60_000);
    assert.equal(r.steps.outbox, '2');
    assert.equal((await small.cron(T0 + 120_000)).steps.outbox, '0');
    assert.equal((await small.rows("SELECT COUNT(*) AS n FROM outbox WHERE state = 'queued'"))[0].n, 2);
    assert.equal((await small.api('GET', '/v1/status')).json.usage.ntfy.messages, 3);
  } finally { await small.close(); }
});

test('junk on the ack topic: attachments never downloaded, 256 KiB and 200 messages per poll, 20 bad frames in a row stop it', async () => {
  const j = await setup({ web: new Map([['evil.example', () => { throw new Error('the server must never download this'); }]]) });
  try {
    const post = (body, headers = {}) => j.relay.handle(`${RELAY_ORIGIN}/${j.values.ackTopic}`, { method: 'POST', body, headers });
    await post('dls1', { Attach: 'https://evil.example/frame.bin', Filename: 'dls1.bin' });
    await post('x'.repeat(300 * 1024));
    for (let i = 0; i < 1000; i++) await post(`junk ${i}`);
    const r = await j.cron(T0);
    assert.equal(r.steps.acks, '0');
    const since = (await j.rows("SELECT v FROM settings WHERE k = 'ackSince'"))[0].v;
    const msgs = j.relay.messages(j.values.ackTopic);
    const idx = msgs.findIndex((m) => m.id === JSON.parse(since));
    assert.ok(idx >= 19 && idx <= 25, `stopped after 20 junk frames (cursor at ${idx})`);
    assert.ok(!j.outboundLog.some((l) => l.includes('evil.example')));
    const polls = j.relay.log.filter((l) => l.includes(`${j.values.ackTopic}/json`));
    assert.equal(polls.length, 1);
  } finally { await j.close(); }
});

test('v1 delivery: server items reach any Inbox under the pairing key, acks come on the pairing ack topic', async () => {
  const v1 = await setup({ delivery: 'v1' });
  try {
    const s = (await v1.api('GET', '/v1/status')).json;
    assert.equal(s.delivery, 'v1');
    assert.equal(s.features.deliver.state, 'ready', 'no Lab Inbox needed');
    const big = 'x'.repeat(3000) + Array.from({ length: 2000 }, (_, i) => `<p>${i * 7919}</p>`).join('');
    const ids = [
      (await enqueue(v1, { origin: 'v1:url', kind: 'url', url: 'https://example.com/v1', title: 'V1 link' })).id,
      (await enqueue(v1, { origin: 'v1:file', kind: 'file', name: 'notes.txt', mime: 'text/plain', b64: Buffer.from(big).toString('base64') })).id,
    ];
    await v1.cron(T0);
    const got = await v1.receiver.pollOnce();
    assert.deepEqual(got.items.map((i) => i.header.id).sort(), ids.sort());
    assert.equal(got.acked.length, 2);
    const file = got.items.find((i) => i.header.kind === 'file');
    assert.equal(new TextDecoder().decode(file.content), big);
    await v1.cron(T0 + HOUR);
    assert.deepEqual((await v1.rows('SELECT state FROM outbox')).map((r) => r.state), ['delivered', 'delivered']);
    assert.equal((await v1.client.discover({ force: true })).config.delivery, 'v1');
  } finally { await v1.close(); }
});

test('v1 safety: a Lab server item on the inbox topic is ignored by a v1 Receiver (no item, no ack, no exception)', async () => {
  const frame = await srv.sealBox(t.values, 'item', { v: 1, id: 'f'.repeat(32), kind: 'url', url: 'https://example.com/x', sent: new Date().toISOString() });
  await t.relay.handle(`${RELAY_ORIGIN}/${t.keys.inboxTopic}`, { method: 'POST', body: ds.toBase64(frame) });
  const got = await t.receiver.pollOnce();
  assert.deepEqual(got.items, []);
  assert.deepEqual(got.acked, []);
  assert.equal(got.ackError, null);
});

test('re-pairing: the old token locks the server; a new Server code expires data sealed for the old pairing', async () => {
  const id = (await enqueue(t, { origin: 'test:old', kind: 'url', url: 'https://example.com/old' })).id;
  assert.equal(await t.client.lockBeforeRepair(), true);
  assert.equal((await t.api('GET', '/v1/status')).status, 423);
  assert.equal(await t.client.lockBeforeRepair(), false, 'never throws');
  const st = await t.client.state('ai');
  assert.equal(st.state, 'locked');
  // Deploy a new Server code on the same D1 and R2, as the real deploy does (12.7): the lock row is still there.
  const secret = ds.generateSecret();
  const seed = await srv.deriveServerSeed(secret);
  const code = await srv.formatServerCode(seed, { relay: RELAY_ORIGIN });
  assert.equal((await t.rows("SELECT k FROM settings WHERE k = 'lock'")).length, 1);
  await t.restart({ DAYLIGHT_SERVER_CODE: code });
  // Earlier tests in this file left the relay backing off at their (later) test clock.
  await t.db.prepare("DELETE FROM settings WHERE k = 'relay'").run();
  const report = await t.cron(Date.now());
  assert.equal(report.steps.config, '200', `the new server announces itself: ${JSON.stringify(report.steps)}`);
  const rows = await t.rows('SELECT state FROM outbox WHERE id = ?', id);
  assert.equal(rows[0].state, 'expired');
  const newValues = await srv.deriveServerValues(seed);
  const status = await t.dispatch(`${SERVER}/v1/status`, { headers: { Authorization: `Bearer ${newValues.authToken}` } });
  assert.equal(status.status, 200, 'the lock belonged to the old fingerprint');
  const old = await t.dispatch(`${SERVER}/v1/status`, { headers: { Authorization: `Bearer ${t.values.authToken}` } });
  assert.equal(old.status, 401, 'the old token is no longer valid at all');
  assert.equal((await status.json()).fingerprint, newValues.fingerprint);
});
