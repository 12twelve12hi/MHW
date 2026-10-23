// The server's outbox and its relay traffic (DESIGN.md 4, 5): config frames and discovery, small and hosted frames, the
// Lab Inbox's hello, acks, re-sends at 11 h, expiry, the ntfy budget, relay back-off, junk on the ack topic, both
// delivery modes and v1 safety.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as ds from '../../share/js/daylight-share.js';
import * as srv from '../client/daylight-server.js';
import { buildInboxInfo } from '../../share/js/daylight-lab.js';
import { setup, ticking, SERVER, RELAY_ORIGIN, NOON } from './helpers.mjs';

const HOUR = 3600_000;
const MINUTE = 60_000;
// Every Worker here runs on a clock that starts at T0, and the tests step it from T0. Config frames go out once per
// 6-hour UTC slot (00:03, 06:03, 12:03 and 18:03) and the ntfy budget is per UTC day, so a T0 from Date.now() made
// "not again within the slot" fail whenever the file loaded in the minute before a slot began.
const T0 = NOON;
let t;
let failNext = null; // status for the next publish to the item topic
before(async () => {
  t = await setup({ clock: ticking(T0), knobs: { ntfyPerDay: 40 }, relayOptions: { failPublish: () => { const s = failNext; failNext = null; return s; } } });
});
after(async () => { await t?.close(); });

/** Enqueues a server item at `now`, else at the Worker's clock. */
const enqueue = async (tt, item, now) => (await tt.dispatch(`${SERVER}/__test/enqueue`, { method: 'POST', body: JSON.stringify(item), headers: now === undefined ? {} : { 'X-DLS-Test-Now': String(now) } })).json();

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
  // Announce stores the slot of its own time: give it one in T0's slot (the clock reaches 12:03, the next slot, 3
  // minutes after setup).
  const a = await t.api('POST', '/v1/admin/announce', { json: {}, now: T0 + 1000 });
  assert.deepEqual(a.json, { published: 200, listed: true });
  assert.equal((await t.api('POST', '/v1/admin/announce', { json: {}, now: T0 + 60_000 })).status, 429, 'at most once a minute');
  assert.equal((await t.cron(T0 + 60_000)).steps.config, undefined, 'not again within the 6-hour slot');
  const frames = t.relay.messages(t.values.configTopic);
  assert.ok(frames.length >= 2);
  assert.ok(frames.every((m) => !m.attachment), 'config frames are always small');
});

test('the client applies the Lab feature states and their messages', async () => {
  const st = await t.client.state('deliver');
  assert.equal(st.state, 'needs-lab-inbox');
  assert.equal(st.message, 'Your Daylight server hasn’t heard from your Daylight yet. Open Daylight Share on it with Lab on.');
  assert.deepEqual(await t.client.state('ai'), { state: 'ready', message: null });
});

test('noteError against the Worker: NEEDS_LAB_INBOX for an AI call marks deliver, not AI, until the next status', async () => {
  const err = await t.client.ai.summarize({ text: 'Deliver me.' }, { deliver: 'both' }).then(() => null, (e) => e);
  assert.equal(err?.code, 'NEEDS_LAB_INBOX');
  assert.equal(err.feature, 'deliver');
  assert.deepEqual(await t.client.noteError('ai', err), { state: 'needs-lab-inbox', message: srv.STATE_MESSAGES['needs-lab-inbox'] });
  const cached = await t.client.storage.get('server/status');
  assert.equal(cached.features.deliver.state, 'needs-lab-inbox');
  assert.equal(cached.features.ai.state, 'ready');
  assert.equal(await t.client.storage.get('server/statusAt'), undefined, 'marked for refresh');
  assert.deepEqual(await t.client.state('ai'), { state: 'ready', message: null });
  assert.ok(await t.client.storage.get('server/statusAt'), 'refreshed from the Worker');
  assert.equal((await t.client.state('deliver')).state, 'needs-lab-inbox', 'the Worker says the same');
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
  const small = await setup({ clock: ticking(T0), knobs: { ntfyPerDay: 3 } });
  try {
    const T = T0; // one UTC day: the budget starts again at 00:00 UTC
    await small.cron(T); // the config frame uses one
    for (let i = 0; i < 4; i++) await enqueue(small, { origin: `test:b${i}`, kind: 'url', url: `https://example.com/${i}` }, T);
    const r = await small.cron(T + 60_000);
    assert.equal(r.steps.outbox, '2');
    assert.equal((await small.cron(T + 120_000)).steps.outbox, '0');
    assert.equal((await small.rows("SELECT COUNT(*) AS n FROM outbox WHERE state = 'queued'"))[0].n, 2);
    assert.equal((await small.api('GET', '/v1/status', { now: T + 120_000 })).json.usage.ntfy.messages, 3);
  } finally { await small.close(); }
});

test('junk on the ack topic: attachments never downloaded, 256 KiB and 200 messages per poll, 20 bad frames in a row stop it', async () => {
  const j = await setup({ clock: ticking(T0), web: new Map([['evil.example', () => { throw new Error('the server must never download this'); }]]) });
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
  const v1 = await setup({ clock: ticking(T0), delivery: 'v1' });
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

test('v1 delivery: Lab frames on the pairing ack topic deliver nothing and change no row; presence only, which lab: 0 ends (DESIGN 5.5)', async () => {
  // LAB-PLAN 2.2.1: a Lab frame is sealed like an ack, with ids [] and x-inbox, and maybe x-st (item states). In v1
  // mode the server reads this topic for its acks; the Lab Inbox's frames there must not deliver anything.
  const v1 = await setup({ clock: ticking(T0), delivery: 'v1' });
  try {
    const ids = [
      (await enqueue(v1, { origin: 'lab:url', kind: 'url', url: 'https://example.com/lab', title: 'Lab link' })).id,
      (await enqueue(v1, { origin: 'lab:page', kind: 'page', title: 'Lab page', text: '<p>Lab page</p>' })).id,
    ];
    await v1.cron(T0);
    const rowsOf = () => v1.rows('SELECT id, state, publishes, next_part, last_publish FROM outbox ORDER BY id');
    const frameCount = async () => (await v1.rows('SELECT COUNT(*) AS n FROM frames'))[0].n;
    const before = await rowsOf();
    assert.deepEqual(before.map((r) => r.state), ['sent', 'sent']);
    const framesBefore = await frameCount();
    assert.equal((await v1.api('GET', '/v1/status')).json.inbox.lab, false);

    const sent = new Date(T0).toISOString();
    const xInbox = (lab, app = 'android/1.5.0') => ({ lab, app, caps: lab ? ['st', 'tap', 'reader-link'] : [], poll: sent, live: true });
    const post = async (extra) => {
      const header = { v: 1, kind: 'ack', ids: [], sent, from: 'Anjan’s Daylight', ...extra };
      const frame = await ds.encryptFrame(v1.keys, 'ack', header, new Uint8Array(0));
      assert.ok(ds.toBase64(frame).length <= 3800, 'a Lab frame is a small frame');
      assert.equal((await v1.relay.handle(`${RELAY_ORIGIN}/${v1.keys.ackTopic}`, { method: 'POST', body: ds.toBase64(frame) })).status, 200);
    };
    const t1 = Math.floor(T0 / 1000);
    await post({ 'x-inbox': xInbox(1) }); // hello
    await post({ 'x-inbox': xInbox(1), 'x-st': [{ i: ids[0], s: 'reader', t: t1 }, { i: ids[1], s: 'handed', t: t1 }] }); // states for the server's own items
    await post({ 'x-inbox': xInbox(1), 'x-st': Array.from({ length: 24 }, (_, n) => ({ i: n.toString(16).padStart(32, '0'), s: 'waiting', t: t1 })) });
    await post({ 'x-inbox': xInbox(0, 'android/1.5.0-' + 'x'.repeat(80)) }); // Lab turned off on the Daylight

    const r = await v1.cron(T0 + HOUR);
    assert.equal(r.steps.acks, '0', 'no item delivered');
    assert.deepEqual(await rowsOf(), before, 'no row changed');
    assert.equal(await frameCount(), framesBefore, 'no frame deleted');
    const st = (await v1.api('GET', '/v1/status', { now: T0 + HOUR })).json;
    assert.equal(st.inbox.lab, false, 'the lab: 0 frame ended the presence (S0)');
    assert.ok(st.inbox.lastSeen, 'last seen stays known');
    assert.ok(Object.values(st.features).every((f) => f.state === 'ready'), `v1 delivery never gates on presence: ${JSON.stringify(st.features)}`);
    const inbox = JSON.parse((await v1.rows("SELECT v FROM settings WHERE k = 'inbox'"))[0].v);
    assert.equal(inbox.app.length, 60, 'the 60-character app clamp');
    const since = JSON.parse((await v1.rows("SELECT v FROM settings WHERE k = 'ackSince'"))[0].v);
    assert.equal(since, v1.relay.messages(v1.keys.ackTopic).at(-1).id, 'the cursor moved past the Lab frames');

    // The Inbox's own acks still deliver, after the Lab frames.
    const got = await v1.receiver.pollOnce();
    assert.deepEqual(got.acked.sort(), [...ids].sort());
    assert.equal((await v1.cron(T0 + 2 * HOUR)).steps.acks, '2');
    assert.deepEqual((await rowsOf()).map((x) => x.state), ['delivered', 'delivered']);
  } finally { await v1.close(); }
});

test('Lab delivery (S0): Lab frames on the server ack topic; lab: 0 ends a publisher’s presence, x-st delivers nothing', async () => {
  // LAB-PLAN 4.2 S0: the Lab Inbox's server lane acks on the server ack topic (box key, AAD server-ack) and says hello
  // there with x-inbox exactly as buildInboxInfo makes it for the pairing lane, lab: 0 included.
  const lab = await setup({ clock: ticking(T0) });
  try {
    const status = async (now) => (await lab.api('GET', '/v1/status', { now })).json;
    const sent = new Date(T0).toISOString();
    const post = async (extra) => {
      const header = { v: 1, kind: 'ack', ids: [], sent, from: 'Anjan’s Daylight', ...extra };
      const frame = await srv.sealBox(lab.values, 'ack', header);
      assert.ok(ds.toBase64(frame).length <= 3800, 'a Lab frame is a small frame');
      assert.equal((await lab.relay.handle(`${RELAY_ORIGIN}/${lab.values.ackTopic}`, { method: 'POST', body: ds.toBase64(frame) })).status, 200);
    };
    const hello = (l, app = 'android/1.6.0', caps = ['st', 'tap', 'reader-link']) => ({ 'x-inbox': buildInboxInfo({ lab: l, app, caps: l ? caps : [], poll: sent, live: true }) });
    const ids = [
      (await enqueue(lab, { origin: 's0:url', kind: 'url', url: 'https://example.com/s0', title: 'S0 link' }, T0)).id,
      (await enqueue(lab, { origin: 's0:page', kind: 'page', title: 'S0 page', text: '<p>S0 page</p>' }, T0)).id,
    ];
    await lab.cron(T0);
    const rowsOf = () => lab.rows('SELECT id, state, publishes, next_part, last_publish FROM outbox ORDER BY id');
    const before = await rowsOf();
    assert.deepEqual(before.map((r) => r.state), ['sent', 'sent'], 'published before any hello: delivery never waits for presence');
    let st = await status(T0);
    assert.equal(st.delivery, 'lab');
    assert.equal(st.inbox.lab, false);
    assert.equal(st.features.deliver.state, 'needs-lab-inbox');
    assert.equal(st.features.deliver.message, 'Your Daylight server hasn’t heard from your Daylight yet. Open Daylight Share on it with Lab on.');

    // Hello, then item states naming the server's own items, then a full x-st frame: presence, nothing delivered.
    const t1 = Math.floor(T0 / 1000);
    await post(hello(1));
    await post({ ...hello(1), 'x-st': [{ i: ids[0], s: 'reader', t: t1 }, { i: ids[1], s: 'handed', t: t1 }] });
    await post({ ...hello(1), 'x-st': Array.from({ length: 24 }, (_, n) => ({ i: n.toString(16).padStart(32, '0'), s: 'waiting', t: t1 })) });
    let r = await lab.cron(T0 + HOUR);
    assert.equal(r.steps.acks, '0', 'x-st delivers nothing');
    assert.deepEqual(await rowsOf(), before, 'no row changed');
    st = await status(T0 + HOUR);
    assert.equal(st.inbox.lab, true);
    for (const f of ['deliver', 'feeds', 'email']) assert.equal(st.features[f].state, 'ready', f);
    assert.deepEqual(await lab.client.state('deliver'), { state: 'ready', message: null });

    // Lab turned off on the Daylight: one lab: 0 frame (caps [], an over-long app) ends the presence.
    await post(hello(0, 'android/1.6.0-' + 'x'.repeat(80)));
    r = await lab.cron(T0 + 2 * HOUR);
    assert.equal(r.steps.acks, '0');
    st = await status(T0 + 2 * HOUR);
    assert.equal(st.inbox.lab, false, 'lab: 0 ends presence');
    assert.equal(st.inbox.lastSeen, new Date(T0 + 2 * HOUR).toISOString(), 'and is the last frame seen');
    for (const f of ['deliver', 'feeds', 'email']) assert.equal(st.features[f].state, 'needs-lab-inbox', f);
    const inbox = JSON.parse((await lab.rows("SELECT v FROM settings WHERE k = 'inbox'"))[0].v);
    assert.equal(inbox.app.length, 60, 'the 60-character app clamp');
    assert.deepEqual(Object.keys(inbox.pubs), ['android']);
    const ai = await lab.api('POST', '/v1/ai', { json: { op: 'summary', source: { text: 'Deliver me.' }, deliver: 'both' }, now: T0 + 2 * HOUR });
    assert.equal(ai.status, 409);
    assert.equal(ai.json.error.code, 'NEEDS_LAB_INBOX');
    assert.equal(lab.claude.requests.length, 0, 'refused before Claude is called');

    // Items still go out and the lane's acks still deliver them; a plain ack does not bring the presence back.
    const third = (await enqueue(lab, { origin: 's0:after', kind: 'url', url: 'https://example.com/after' }, T0 + 2 * HOUR)).id;
    await lab.cron(T0 + 2 * HOUR + MINUTE);
    const got = await lab.lane.poll();
    assert.deepEqual(got.map((i) => i.header.id).sort(), [...ids, third].sort());
    r = await lab.cron(T0 + 3 * HOUR);
    assert.equal(r.steps.acks, '3');
    assert.deepEqual((await rowsOf()).map((x) => x.state), ['delivered', 'delivered', 'delivered']);
    assert.equal((await status(T0 + 3 * HOUR)).inbox.lab, false, 'acks alone do not undo lab: 0');

    // Lab on again: its hello brings the presence back (the ack topic is polled every 30 minutes without presence).
    await post(hello(1));
    assert.equal((await lab.cron(T0 + 3 * HOUR + 30 * MINUTE)).steps.acks, '0');
    assert.equal((await status(T0 + 4 * HOUR)).inbox.lab, true);
    // Two publishers (a handover, LAB-PLAN 5.3.4): the Lab Reader's hello keeps the presence when Daylight Share
    // turns Lab off. With presence and nothing awaiting an ack, the topic is read every 6 hours.
    await post(hello(1, 'reader-lab/0.3.0', ['st', 'reader-doc', 'quiet']));
    await post(hello(0));
    assert.equal((await lab.cron(T0 + 5 * HOUR)).steps.acks, undefined, 'not due yet');
    assert.equal((await lab.cron(T0 + 9 * HOUR + 30 * MINUTE)).steps.acks, '0');
    st = await status(T0 + 10 * HOUR);
    assert.equal(st.inbox.lab, true, 'reader-lab is still on');
    assert.equal(st.features.deliver.state, 'ready');
    assert.deepEqual(Object.keys(JSON.parse((await lab.rows("SELECT v FROM settings WHERE k = 'inbox'"))[0].v).pubs).sort(), ['android', 'reader-lab']);
    await post(hello(0, 'reader-lab/0.3.0'));
    assert.equal((await lab.cron(T0 + 15 * HOUR + 30 * MINUTE)).steps.acks, '0');
    assert.equal((await status(T0 + 16 * HOUR)).inbox.lab, false, 'both publishers off');
  } finally { await lab.close(); }
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
  const report = await t.cron();
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
