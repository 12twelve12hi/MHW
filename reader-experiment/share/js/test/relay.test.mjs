// End-to-end tests through the mock relay, which runs with the limits PROTOCOL 3.5 promises (2,000,000 bytes per
// attachment, 20,000,000 per visitor; ntfy.sh itself takes 2 MiB per attachment).
// The clock is injected into the library and the mock alike; `advance` moves both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ds from '../daylight-share.js';
import { startMockRelay } from '../mock-relay.mjs';

const T0 = Date.UTC(2026, 9, 17, 22, 0, 0);
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

async function setup(opts = {}) {
  let clock = T0;
  const now = () => clock;
  const { senderOpts = {}, receiverOpts = {}, ...relayOpts } = opts;
  const hooks = { download: null, publish: null };
  const relay = await startMockRelay({
    now, ...relayOpts,
    failDownload: (...a) => hooks.download?.(...a) ?? null,
    failPublish: (...a) => hooks.publish?.(...a) ?? null,
  });
  const secret = ds.generateSecret();
  const pairing = { secret, relay: relay.url, name: 'Test Daylight' };
  const fast = { retryDelaysMs: [0, 0, 0] };
  const sender = new ds.Sender({ pairing, storage: new ds.MemoryStorage(), from: 'Test phone', app: 'test/1', now, ...fast, ...senderOpts });
  const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage(), now, ...fast, ...receiverOpts });
  const keys = await sender.keys();
  const requests = (method, topic = keys.inboxTopic) => relay.state.requests.filter((r) => r === `${method} /${topic}`).length;
  const messages = (topic = keys.inboxTopic) => relay.state.topics.get(topic) ?? [];
  return {
    relay, sender, receiver, keys, pairing, hooks, now, requests, messages, fast,
    advance: (ms) => { clock += ms; },
    puts: () => requests('PUT'), posts: () => requests('POST'),
  };
}

const pdf = (n, seed = 1) => new Uint8Array(n).map((_, i) => (i * 31 + seed * 7 + (i >> 9)) & 0xff);
const row = async (sender, id) => (await sender.list()).find((r) => r.id === id);

test('send, receive, ack, delivered', async () => {
  const { relay, sender, receiver } = await setup();
  try {
    const link = await sender.send({ kind: 'url', url: 'https://example.com/story', title: 'A story' });
    assert.equal(link.status, 'sent');
    const page = await sender.send({ kind: 'page', url: 'https://example.com/page', title: 'Page', content: '<html><body>' + '<p>words</p>'.repeat(2000) + '</body></html>' });
    const file = await sender.send({ kind: 'file', name: 'paper.pdf', mime: 'application/pdf', content: new Uint8Array(50000).fill(7) });
    assert.equal(file.attachment, true);
    assert.equal(page.attachment, false, 'a very compressible page fits in a message');
    for (const r of [link, page, file]) assert.deepEqual(ds.describeRow(r, r.created), { label: 'Sent · waiting for your Daylight', sentence: null, action: null });

    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 3);
    assert.deepEqual(got.items.map((i) => i.header.kind).sort(), ['file', 'page', 'url']);
    assert.equal(got.items.find((i) => i.header.kind === 'file').content.length, 50000);
    assert.equal(got.acked.length, 3);
    assert.equal(got.ackError, null);
    assert.equal(got.storeError, null);

    assert.equal(await sender.checkAcks(), 3);
    assert.ok((await sender.list()).every((r) => r.status === 'delivered'));
    assert.equal(await sender.storage.get(`outbox/${file.id}`), undefined, 'content dropped once delivered');

    const again = await receiver.pollOnce();
    assert.equal(again.items.length, 0, 'nothing new on the next poll');
  } finally { await relay.close(); }
});

test('a 5 MB PDF goes in 3 parts and arrives', async () => {
  const { relay, sender, receiver, puts } = await setup();
  try {
    const sizes = [];
    relay.server.on('request', (req) => { if (req.method === 'PUT') sizes.push(Number(req.headers['content-length'])); });
    const bytes = ds.randomBytes(5000000);
    const r = await sender.send({ kind: 'file', name: 'big.pdf', mime: 'application/pdf', content: bytes });
    assert.equal(r.status, 'sent');
    assert.equal(puts(), 3);
    assert.equal(sizes.length, 3);
    for (const s of sizes) assert.ok(s <= 1966116, `frame of ${s} bytes`);
    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 1);
    assert.deepEqual(got.items[0].content, bytes);
    assert.equal(await sender.checkAcks(), 1);
  } finally { await relay.close(); }
});

test('413: failed/full, no publish before 185 min, then sent', async () => {
  const { relay, sender, receiver, advance, puts } = await setup({ visitorAttachmentTotalBytes: 3000000 });
  try {
    const a = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(1500000, 1) });
    assert.equal(a.status, 'sent');
    const b = await sender.send({ kind: 'file', name: 'b.pdf', mime: 'application/pdf', content: pdf(1800000, 2) });
    assert.equal(b.status, 'failed');
    assert.equal(b.errorCode, 'full');
    assert.equal(b.slowFails, 1);
    assert.match(ds.describeRow(b, b.created).sentence, /about 3 hours/);
    assert.equal((await receiver.pollOnce()).items.length, 1);
    assert.equal(await sender.checkAcks(), 1);

    const before = puts();
    advance(184 * MIN);
    assert.deepEqual(await sender.resendDue(), []);
    assert.equal(puts(), before, 'no upload within 185 min of a 413');
    advance(MIN);
    const [resent] = await sender.resendDue();
    assert.equal(resent.id, b.id);
    assert.equal(resent.status, 'sent');
    assert.equal(resent.slowFails, 0);
    assert.equal((await receiver.pollOnce()).items[0].header.id, b.id);
  } finally { await relay.close(); }
});

test('three full in a row → expired/full; Try again starts over and sends', async () => {
  const { relay, sender, hooks, advance, puts, now } = await setup();
  try {
    let full = 3;
    hooks.publish = (topic, n, isAttachment) => (isAttachment && full > 0 ? (full--, 413) : null);
    const r = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(300000) });
    assert.equal(r.errorCode, 'full');
    advance(185 * MIN);
    assert.equal((await sender.resendDue())[0].slowFails, 2);
    advance(185 * MIN);
    const [last] = await sender.resendDue();
    assert.equal(last.status, 'expired');
    assert.equal(last.errorCode, 'full');
    assert.deepEqual(ds.describeRow(last, now()), {
      label: 'Not delivered', sentence: 'Too much was sent from this network for hours, so it stopped trying. Try again later.', action: 'try-again' });
    const before = puts();
    advance(185 * MIN);
    assert.deepEqual(await sender.resendDue(), []);
    advance(DAY);
    await sender.resendDue();
    assert.equal(puts(), before, 'nothing goes after the third slow failure until Try again');
    const again = await sender.retry(r.id);
    assert.equal(again.status, 'sent');
    assert.equal(again.slowFails, 0);
    assert.equal(again.created, now());
    assert.equal(again.sent, r.sent, 'the header is not changed');
  } finally { await relay.close(); }
});

test('early 413: the row ends failed, and the pass publishes no further attachment', async (t) => {
  const { relay, sender, advance, puts } = await setup({ early413: true, attachmentMaxBytes: 1000000 });
  try {
    const a = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(1200000, 1) });
    const b = await sender.send({ kind: 'file', name: 'b.pdf', mime: 'application/pdf', content: pdf(1200000, 2) });
    assert.equal(a.status, 'failed');
    t.diagnostic(`Node's fetch reports an early 413 as: ${a.errorCode}`);
    assert.ok(['full', 'network'].includes(a.errorCode));
    advance(185 * MIN);
    const before = puts();
    const attempted = await sender.resendDue();
    if (a.errorCode === 'full') {
      assert.deepEqual(attempted.map((r) => r.id), [a.id]);
      assert.equal(puts(), before + 1, 'after the 413 no further attachment goes');
      assert.equal((await row(sender, b.id)).lastPublish, b.lastPublish);
    } else {
      assert.equal(attempted.length, 2);
    }
  } finally { await relay.close(); }
});

test('400 → failed/refused, retried after 185 min, the third → expired/refused; a url item still goes', async () => {
  const { relay, sender, receiver, advance, puts, now } = await setup({ attachments: false });
  try {
    const f = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(100000) });
    assert.equal(f.status, 'failed');
    assert.equal(f.errorCode, 'refused');
    assert.match(ds.describeRow(f, now()).sentence, /turned this down/);
    assert.equal(ds.describeRow(f, now()).action, null);
    const u = await sender.send({ kind: 'url', url: 'https://example.com/still-goes' });
    assert.equal(u.status, 'sent');
    assert.equal((await receiver.pollOnce()).items.length, 1);

    const before = puts();
    advance(184 * MIN);
    await sender.resendDue();
    assert.equal(puts(), before);
    advance(MIN);
    assert.equal((await sender.resendDue())[0].slowFails, 2);
    advance(185 * MIN);
    const [last] = await sender.resendDue();
    assert.equal(last.status, 'expired');
    assert.equal(last.errorCode, 'refused');
    assert.match(ds.describeRow(last, now()).sentence, /keeps turning this down/);
  } finally { await relay.close(); }
});

test('a v1.0 row over 9 MB becomes expired/too-large when due, its content is dropped and nothing is published', async () => {
  const { relay, sender, advance, puts, posts, now } = await setup();
  try {
    const id = ds.newItemId();
    await sender.storage.set('outbox', [{
      id, kind: 'file', title: 'Big', url: '', name: 'big.pdf', mime: 'application/pdf', size: 10000000,
      sent: ds.nowIso(T0), created: T0, status: 'sent', lastPublish: T0, attachment: true, attempts: 1, error: '',
    }]);
    await sender.storage.set(`outbox/${id}`, ds.toBase64(pdf(1000)));
    advance(185 * MIN);
    assert.deepEqual(await sender.resendDue(), []);
    const r = await row(sender, id);
    assert.equal(r.status, 'expired');
    assert.equal(r.errorCode, 'too-large');
    assert.equal(await sender.storage.get(`outbox/${id}`), undefined);
    assert.equal(puts() + posts(), 0);
    assert.deepEqual(ds.describeRow(r, now()), { label: 'Not delivered', sentence: 'Too big to send. Files can be up to 9 MB; this one is 10 MB.', action: null });
  } finally { await relay.close(); }
});

test('a download 429 holds the cursor and no further attachment is fetched in that poll', async () => {
  const { relay, sender, receiver, hooks, messages } = await setup();
  try {
    await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000, 1) });
    await sender.send({ kind: 'file', name: 'b.pdf', mime: 'application/pdf', content: pdf(50000, 2) });
    const [ma, mb] = messages();
    hooks.download = (id, n) => (id === ma.id && n === 0 ? 429 : null);
    const first = await receiver.pollOnce();
    assert.equal(first.items.length, 0);
    assert.equal(relay.state.downloadsById[ma.id], 1);
    assert.equal(relay.state.downloadsById[mb.id], undefined, 'no request after the 429');
    assert.ok((await receiver.storage.get('inboxSince')) <= ma.time - 1800);
    const second = await receiver.pollOnce();
    assert.equal(second.items.length, 2);
  } finally { await relay.close(); }
});

for (const failure of [503, 'reset']) {
  test(`a download ${failure} holds the cursor; the item arrives at the next poll`, async () => {
    const { relay, sender, receiver, hooks, messages } = await setup();
    try {
      const r = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
      const [m] = messages();
      hooks.download = (id, n) => (n === 0 ? failure : null);
      assert.equal((await receiver.pollOnce()).items.length, 0);
      assert.ok((await receiver.storage.get('inboxSince')) <= m.time - 1800);
      const got = await receiver.pollOnce();
      assert.equal(got.items.length, 1);
      assert.equal(got.items[0].header.id, r.id);
    } finally { await relay.close(); }
  });
}

test('an expired attachment (404) lets the cursor pass and is requested once over three polls', async () => {
  const { relay, sender, receiver, hooks, messages, advance } = await setup();
  try {
    await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
    const [m] = messages();
    hooks.download = () => 404;
    advance(10 * MIN);
    await sender.send({ kind: 'url', url: 'https://example.com/later' });
    const linkTime = messages()[1].time;
    assert.equal((await receiver.pollOnce()).items.length, 1);
    assert.equal(await receiver.storage.get('inboxSince'), linkTime - 1800, 'not held at the expired attachment');
    await receiver.pollOnce();
    await receiver.pollOnce();
    assert.equal(relay.state.downloadsById[m.id], 1);
  } finally { await relay.close(); }
});

test('a late-landing attachment is not skipped', async () => {
  const { relay, sender, receiver, keys, advance, now, messages } = await setup({ control: true });
  try {
    const built = await ds.buildItemFrames(keys, { kind: 'file', name: 'slow.pdf', mime: 'application/pdf', content: pdf(50000), sent: ds.nowIso(now()) });
    const slow = fetch(`${relay.url}/${keys.inboxTopic}`, { method: 'PUT', headers: { Filename: 'dls1.bin', Message: 'dls1', 'X-Mock-Hold': '500' }, body: built.frames[0] });
    while (!relay.state.requests.includes(`PUT /${keys.inboxTopic}`)) await ds.sleep(5);
    advance(MIN); // the upload is stamped at its start, but lands after this link
    await sender.send({ kind: 'url', url: 'https://example.com/quick' });
    const first = await receiver.pollOnce();
    assert.deepEqual(first.items.map((i) => i.header.kind), ['url']);
    assert.equal((await slow).status, 200);
    const [link, file] = messages();
    assert.ok(!link.attachment && file.attachment, 'the premise: the upload became visible after the link…');
    assert.ok(file.time < link.time, '…but is stamped earlier (time at request start)');
    assert.ok((await receiver.storage.get('inboxSince')) <= file.time, 'so only the overlap lets the next poll list it');
    const second = await receiver.pollOnce();
    assert.deepEqual(second.items.map((i) => i.header.id), [built.id]);
  } finally { await relay.close(); }
});

test('large file in several parts survives a receiver restart between parts', async () => {
  const { relay, sender, keys, pairing, advance, now } = await setup();
  try {
    const bytes = new Uint8Array(70000).map((_, i) => i & 0xff);
    const built = await ds.buildItemFrames(keys, { kind: 'file', name: 'big.pdf', mime: 'application/pdf', content: bytes }, { chunkSize: 20000 });
    assert.equal(built.frames.length, 4);
    const storage = new ds.MemoryStorage();
    const rc = new ds.RelayClient({ relay: relay.url });
    await rc.publish(keys.inboxTopic, built.frames[0]);
    await rc.publish(keys.inboxTopic, built.frames[1]);
    let r = new ds.Receiver({ pairing, storage, now });
    assert.equal((await r.pollOnce()).items.length, 0);
    advance(MIN);
    await sender.send({ kind: 'url', url: 'https://example.com/unrelated' });
    assert.equal((await r.pollOnce()).items.length, 1);
    assert.ok((await storage.get('inboxSince')) <= Math.floor(T0 / 1000) - 1800, 'held at the first part');
    r = new ds.Receiver({ pairing, storage, now }); // a new process: the held parts are gone
    advance(MIN);
    await rc.publish(keys.inboxTopic, built.frames[2]);
    await rc.publish(keys.inboxTopic, built.frames[3]);
    const got = await r.pollOnce();
    assert.equal(got.items.length, 1);
    assert.deepEqual(got.items[0].content, bytes);
    assert.deepEqual(await storage.get('incomplete'), {});
  } finally { await relay.close(); }
});

test('accept() throwing → storeError, not acked, not downloaded again; delivered after the 185-min re-send', async () => {
  let full = true;
  const { relay, sender, receiver, messages, advance } = await setup({
    receiverOpts: { accept: async () => { if (full) throw new Error('No space left on device'); } },
  });
  try {
    const r = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
    const [m] = messages();
    const first = await receiver.pollOnce();
    assert.deepEqual(first.items, []);
    assert.deepEqual(first.acked, []);
    assert.equal(first.storeError, 'No space left on device');
    const second = await receiver.pollOnce();
    assert.equal(second.storeError, null);
    assert.equal(relay.state.downloadsById[m.id], 1, 'its message is handled');
    full = false;
    advance(185 * MIN);
    assert.deepEqual(await sender.tick(), { delivered: 0, resent: 1 });
    const third = await receiver.pollOnce();
    assert.equal(third.items.length, 1);
    assert.deepEqual(third.acked, [r.id]);
    assert.equal(await sender.checkAcks(), 1);
  } finally { await relay.close(); }
});

test('an ack publish failure → items still returned, with ackError; nothing thrown', async () => {
  const { relay, sender, receiver, keys, hooks } = await setup();
  try {
    hooks.publish = (topic) => (topic === keys.ackTopic ? 503 : null);
    await sender.send({ kind: 'url', url: 'https://example.com/a' });
    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 1);
    assert.deepEqual(got.acked, []);
    assert.match(got.ackError, /503/);
    hooks.publish = (topic) => (topic === keys.ackTopic ? 429 : null);
    await sender.send({ kind: 'url', url: 'https://example.com/b' });
    assert.match((await receiver.pollOnce()).ackError, /429/);
  } finally { await relay.close(); }
});

test('a duplicate 13 days later is acked, not delivered; 15 days after the last sighting it is delivered again', async () => {
  const { relay, sender, receiver, keys, advance, now } = await setup();
  try {
    const r = await sender.send({ kind: 'url', url: 'https://example.com/replayed' });
    assert.equal((await receiver.pollOnce()).items.length, 1);
    const rc = new ds.RelayClient({ relay: relay.url });
    const replay = async () => {
      const built = await ds.buildItemFrames(keys, { id: r.id, kind: 'url', url: r.url, sent: r.sent });
      await rc.publish(keys.inboxTopic, built.frames[0]);
    };
    advance(13 * DAY);
    await replay();
    const dup = await receiver.pollOnce();
    assert.equal(dup.items.length, 0);
    assert.deepEqual(dup.acked, [r.id]);
    assert.equal((await receiver.storage.get('seenItems'))[r.id], now(), 'the sighting is refreshed');
    advance(15 * DAY);
    await replay();
    const late = await receiver.pollOnce();
    assert.equal(late.items.length, 1, 'the accepted replay risk (PROTOCOL 5)');
  } finally { await relay.close(); }
});

test('a duplicate re-send is acked again but not delivered twice', async () => {
  const { relay, sender, receiver, advance } = await setup();
  try {
    const r = await sender.send({ kind: 'url', url: 'https://example.com/x' });
    assert.equal((await receiver.pollOnce()).items.length, 1);
    // The sender never saw the ack (it was offline) and re-sends after 11 h.
    advance(11 * HOUR);
    assert.equal((await sender.resendDue()).length, 1);
    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 0);
    assert.deepEqual(got.acked, [r.id]);
    assert.equal(await sender.checkAcks(), 1);
  } finally { await relay.close(); }
});

test('Try again on an expired file sends it with the original `sent`; after 14 days it says share it again', async () => {
  const { relay, sender, receiver, advance, now } = await setup();
  try {
    const a = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000, 1) });
    advance(7 * DAY + MIN);
    await sender.resendDue();
    let r = await row(sender, a.id);
    assert.equal(r.status, 'expired');
    assert.equal(r.errorCode, '');
    assert.equal(ds.describeRow(r, now()).action, 'try-again');
    assert.equal(typeof (await sender.storage.get(`outbox/${a.id}`)), 'string', 'content kept');
    r = await sender.retry(a.id);
    assert.equal(r.status, 'sent');
    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 1);
    assert.equal(got.items[0].header.sent, a.sent);

    const b = await sender.send({ kind: 'file', name: 'b.pdf', mime: 'application/pdf', content: pdf(50000, 2) });
    advance(7 * DAY + MIN);
    await sender.resendDue();
    advance(7 * DAY);
    await sender.resendDue();
    assert.equal(await sender.storage.get(`outbox/${b.id}`), undefined, 'dropped 14 days after the share');
    r = await sender.retry(b.id);
    assert.equal(r.status, 'expired');
    assert.equal(r.errorCode, 'gone');
    assert.deepEqual(ds.describeRow(r, now()), { label: 'Not delivered', sentence: 'This is no longer stored on this device. Share it again.', action: null });
  } finally { await relay.close(); }
});

test('the outbox cap keeps pending rows and drops the content of evicted finished rows', async () => {
  const { relay, sender } = await setup();
  try {
    const base = { kind: 'file', title: '', url: '', name: 'x.pdf', mime: 'application/pdf', size: 10, sent: ds.nowIso(T0), attachment: false, attempts: 0, error: '' };
    const sent = Array.from({ length: 100 }, (_, i) => ({ ...base, id: ds.newItemId(), status: 'sent', created: T0 - 50 * DAY - i, lastPublish: T0 }));
    const expired = Array.from({ length: 120 }, (_, i) => ({ ...base, id: ds.newItemId(), status: 'expired', created: T0 - (i + 1) * MIN, lastPublish: T0 }));
    await sender.storage.set('outbox', [...sent, ...expired]);
    for (const r of expired) await sender.storage.set(`outbox/${r.id}`, ds.toBase64(pdf(10)));
    await sender.send({ kind: 'url', url: 'https://example.com/one-more' });
    const rows = await sender.list();
    assert.equal(rows.length, 200);
    const ids = new Set(rows.map((r) => r.id));
    assert.ok(sent.every((r) => ids.has(r.id)), 'every pending row is kept, however old');
    assert.ok(expired.slice(0, 99).every((r) => ids.has(r.id)), 'the newest finished rows fill the room');
    for (const [i, r] of expired.entries()) {
      const kept = await sender.storage.get(`outbox/${r.id}`);
      if (i < 99) assert.equal(typeof kept, 'string');
      else assert.equal(kept, undefined, 'evicted rows lose their content');
    }
  } finally { await relay.close(); }
});

test('a quota error on the content copy still sends once; when the re-send is due the row becomes expired/gone', async () => {
  class QuotaStorage extends ds.MemoryStorage {
    async set(k, v) { if (k.startsWith('outbox/')) throw new Error('QuotaExceededError'); return super.set(k, v); }
  }
  const { relay, sender: s0, receiver, pairing, advance, now, puts, fast } = await setup();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const sender = new ds.Sender({ pairing, storage: new QuotaStorage(), now, ...fast });
    const r = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
    assert.equal(r.status, 'sent');
    assert.equal(puts(), 1);
    assert.equal((await receiver.pollOnce()).items.length, 1, 'the one publish arrives');
    advance(185 * MIN);
    assert.deepEqual(await sender.resendDue(), []);
    const after = await row(sender, r.id);
    assert.equal(after.status, 'expired');
    assert.equal(after.errorCode, 'gone');
    assert.equal(puts(), 1, 'nothing to re-send it from');
    assert.equal(await sender.checkAcks(), 1, 'an ack still makes it delivered');
    assert.equal(s0.storage instanceof ds.MemoryStorage, true);
  } finally { console.warn = warn; await relay.close(); }
});

test('concurrent send() and tick() on one Sender, and on two Senders sharing one storage, lose no rows and publish each item once', async () => {
  const { relay, sender, pairing, receiver, now, posts, fast } = await setup();
  try {
    const twin = new ds.Sender({ pairing, storage: sender.storage, now, ...fast });
    const url = (i) => ({ kind: 'url', url: `https://example.com/${i}` });
    const done = await Promise.all([sender.send(url(1)), sender.tick(), twin.send(url(2)), twin.tick(), sender.send(url(3)), twin.send(url(4)), sender.tick()]);
    const rows = await sender.list();
    assert.equal(rows.length, 4);
    assert.equal(new Set(rows.map((r) => r.id)).size, 4);
    assert.ok(rows.every((r) => r.status === 'sent'));
    assert.equal(posts(), 4);
    assert.equal(done.filter((d) => d?.status === 'sent').length, 4);
    const both = await Promise.all([receiver.pollOnce(), receiver.pollOnce()]);
    assert.equal(both[0].items.length + both[1].items.length, 4, 'two overlapping polls deliver once');
  } finally { await relay.close(); }
});

test('re-send timing: publishes at 0, 185 and 370 min, then every 12 h; message-only items every 11 h', async () => {
  const { relay, sender, advance, puts, posts } = await setup();
  try {
    await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
    await sender.send({ kind: 'url', url: 'https://example.com/link' });
    const at = { file: [0], url: [0] };
    let p = puts(), q = posts();
    for (let m = 5; m <= 3 * 24 * 60; m += 5) {
      advance(5 * MIN);
      await sender.resendDue();
      if (puts() > p) { at.file.push(m); p = puts(); }
      if (posts() > q) { at.url.push(m); q = posts(); }
    }
    assert.deepEqual(at.file, [0, 185, 370, 1090, 1810, 2530, 3250, 3970]);
    assert.deepEqual(at.url, [0, 660, 1320, 1980, 2640, 3300, 3960]);
  } finally { await relay.close(); }
});

test('the pass stops: after a 429 nothing more is published; after a 413 no attachment goes but a due url item does', async () => {
  {
    const { relay, sender, hooks, advance, posts } = await setup();
    try {
      hooks.publish = () => 503;
      const rows = [];
      for (let i = 0; i < 3; i++) rows.push(await sender.send({ kind: 'url', url: `https://example.com/${i}` }));
      assert.ok(rows.every((r) => r.status === 'failed' && r.errorCode === 'network'));
      assert.deepEqual(ds.describeRow(rows[0], rows[0].created).action, 'retry-now');
      let once = true;
      hooks.publish = () => (once ? ((once = false), 429) : null);
      advance(2 * MIN);
      const before = posts();
      const attempted = await sender.resendDue();
      assert.deepEqual(attempted.map((r) => r.id), [rows[0].id]);
      assert.equal(posts(), before + 1, 'one request, then the pass stopped');
      assert.equal(attempted[0].errorCode, 'network');
      assert.equal(attempted[0].attempts, 2);
      for (const r of rows.slice(1)) assert.equal((await row(sender, r.id)).lastPublish, r.lastPublish);
    } finally { await relay.close(); }
  }
  {
    const { relay, sender, hooks, advance } = await setup();
    try {
      hooks.publish = () => 503;
      const a = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000, 1) });
      const b = await sender.send({ kind: 'file', name: 'b.pdf', mime: 'application/pdf', content: pdf(50000, 2) });
      const c = await sender.send({ kind: 'url', url: 'https://example.com/c' });
      let once = true;
      hooks.publish = (topic, n, isAttachment) => (isAttachment && once ? ((once = false), 413) : null);
      advance(2 * MIN);
      const attempted = await sender.resendDue();
      assert.deepEqual(attempted.map((r) => r.id), [a.id, c.id]);
      assert.equal((await row(sender, a.id)).errorCode, 'full');
      assert.equal((await row(sender, b.id)).lastPublish, b.lastPublish, 'no attachment after the 413');
      assert.equal((await row(sender, c.id)).status, 'sent', 'a due url item still goes');
    } finally { await relay.close(); }
  }
});

test('a v1.0-style 150-id ack attachment is still read by checkAcks', async () => {
  const { relay, sender, keys } = await setup();
  try {
    const a = await sender.send({ kind: 'url', url: 'https://example.com/a' });
    const b = await sender.send({ kind: 'url', url: 'https://example.com/b' });
    const ids = [...Array.from({ length: 148 }, () => ds.newItemId()), a.id, b.id];
    const frame = await ds.encryptFrame(keys, 'ack', { v: 1, kind: 'ack', ids, sent: ds.nowIso(T0), from: 'Daylight' }, new Uint8Array(0));
    assert.ok(!ds.isSmallFrame(frame));
    const res = await new ds.RelayClient({ relay: relay.url }).publish(keys.ackTopic, frame);
    assert.equal(res.attachment, true);
    assert.equal(await sender.checkAcks(), 2);
  } finally { await relay.close(); }
});

test('a fetch that never answers is aborted (timeouts injected small) and the lock is released', async () => {
  const pairing = { secret: ds.generateSecret(), relay: 'https://relay.invalid', name: '' };
  const never = () => new Promise(() => {});
  const stalled = async (url) => (url.includes('/json')
    ? new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { status: 200 })
    : never());
  for (const f of [never, stalled]) {
    const sender = new ds.Sender({ pairing, storage: new ds.MemoryStorage(), fetch: f, timeouts: { short: 30, long: 30 }, retryDelaysMs: [0, 0, 0] });
    const r = await sender.send({ kind: 'url', url: 'https://example.com/hang' });
    assert.equal(r.status, 'failed');
    assert.equal(r.errorCode, 'network');
    await assert.rejects(sender.checkAcks(), (e) => e.code === 'network' && /timed out/.test(e.message));
    assert.deepEqual(await sender.tick(), { delivered: 0, resent: 0 });
    assert.equal((await sender.list()).length, 1);
  }
});

test('retry() on a sent row publishes nothing', async () => {
  const { relay, sender, posts } = await setup();
  try {
    const r = await sender.send({ kind: 'url', url: 'https://example.com/x' });
    const again = await sender.retry(r.id);
    assert.equal(again.status, 'sent');
    assert.equal(again.lastPublish, r.lastPublish);
    assert.equal(posts(), 1);
    assert.equal(await sender.retry('0'.repeat(32)), null);
  } finally { await relay.close(); }
});

test('remove() drops the row and its content', async () => {
  const { relay, sender } = await setup();
  try {
    const r = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(1000) });
    assert.equal(await sender.remove(r.id), true);
    assert.deepEqual(await sender.list(), []);
    assert.equal(await sender.storage.get(`outbox/${r.id}`), undefined);
    assert.equal(await sender.remove(r.id), false);
  } finally { await relay.close(); }
});

test('re-send after the relay forgets an unacknowledged attachment', async () => {
  const { relay, sender, receiver, advance } = await setup();
  try {
    const r = await sender.send({ kind: 'file', name: 'paper.pdf', mime: 'application/pdf', content: new Uint8Array(20000).fill(1) });
    advance(4 * HOUR); // the Daylight was off; the attachment expired
    assert.equal((await receiver.pollOnce()).items.length, 0);
    const t = await sender.tick();
    assert.equal(t.resent, 1);
    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 1);
    assert.equal(got.items[0].header.id, r.id);
    await sender.tick();
    assert.equal((await sender.list())[0].status, 'delivered');
  } finally { await relay.close(); }
});

test('junk on the topic is ignored', async () => {
  const { relay, sender, receiver, keys } = await setup();
  try {
    await fetch(`${relay.url}/${keys.inboxTopic}`, { method: 'POST', body: 'hello there' });
    await fetch(`${relay.url}/${keys.inboxTopic}`, { method: 'PUT', headers: { Filename: 'x.bin' }, body: new Uint8Array(5000) });
    await sender.send({ kind: 'url', url: 'https://example.com/ok' });
    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 1);
    assert.equal(Object.keys(await receiver.storage.get('seenMsgs')).length, 3, 'junk is handled too');
  } finally { await relay.close(); }
});

test('an attachment URL on another origin is junk and never fetched', async () => {
  const { relay, receiver, keys } = await setup();
  try {
    let fetched = 0;
    const evil = (await import('node:http')).createServer((req, res) => { fetched++; res.end('x'); });
    await new Promise((r) => evil.listen(0, '127.0.0.1', r));
    const fake = { id: 'abcdefghijkl', time: Math.floor(T0 / 1000), event: 'message', topic: keys.inboxTopic, message: 'dls1',
      attachment: { name: 'dls1.bin', url: `http://127.0.0.1:${evil.address().port}/file/x.bin` } };
    const f = async (url, init) => (url.includes('/json') ? new Response(JSON.stringify(fake) + '\n') : fetch(url, init));
    const r = new ds.Receiver({ pairing: { ...receiver.pairing, relay: relay.url }, storage: new ds.MemoryStorage(), fetch: f, now: () => T0 });
    const got = await r.pollOnce();
    assert.equal(got.items.length, 0);
    assert.equal(fetched, 0);
    assert.ok(Object.hasOwn(await r.storage.get('seenMsgs'), fake.id));
    evil.close();
  } finally { await relay.close(); }
});

test('relay errors mark the row failed and retry later', async () => {
  const { relay, sender, advance } = await setup();
  await relay.close();
  const r = await sender.send({ kind: 'url', url: 'https://example.com/offline' });
  assert.equal(r.status, 'failed');
  assert.equal(r.errorCode, 'network');
  assert.equal(r.attempts, 1);
  advance(MIN);
  assert.deepEqual(await sender.resendDue(), [], 'the backoff is 2 min after one failure');
  advance(MIN);
  const again = await sender.resendDue();
  assert.equal(again.length, 1);
  assert.equal(again[0].status, 'failed');
  assert.equal(again[0].attempts, 2);
});

test('expired after a week', async () => {
  const { relay, sender, advance } = await setup();
  try {
    const r = await sender.send({ kind: 'url', url: 'https://example.com/never' });
    advance(8 * DAY);
    await sender.resendDue();
    const after = (await sender.list())[0];
    assert.equal(after.status, 'expired');
    assert.equal(after.errorCode, '');
    assert.equal(after.id, r.id);
  } finally { await relay.close(); }
});

test('the mock relay behaves like ntfy.sh where the protocol depends on it', async () => {
  {
    const { relay, keys } = await setup();
    try {
      const put = (size) => fetch(`${relay.url}/${keys.inboxTopic}`, { method: 'PUT', headers: { Filename: 'x.bin' }, body: new Uint8Array(size) });
      const res = await put(2000001);
      assert.equal(res.status, 413, 'by default the per-file limit is the 2,000,000 PROTOCOL 3.5 promises');
      assert.equal((await res.json()).code, 41301);
      assert.equal((await put(2000000)).status, 200);
    } finally { await relay.close(); }
  }
  const { relay, keys } = await setup({ attachmentMaxBytes: 2097152, visitorAttachmentTotalBytes: 3000000 }); // ntfy.sh exactly
  try {
    const put = (size, visitor) => fetch(`${relay.url}/${keys.inboxTopic}`, { method: 'PUT', headers: { Filename: 'x.bin', ...(visitor ? { 'X-Mock-Visitor': visitor } : {}) }, body: new Uint8Array(size) });
    let res = await put(2097153);
    assert.equal(res.status, 413);
    assert.equal((await res.json()).code, 41301);
    assert.equal((await put(2097152)).status, 200, '2 MiB is accepted');
    res = await put(1000000);
    assert.equal(res.status, 413, 'over the visitor total');
    const poll = async (since) => (await (await fetch(`${relay.url}/${keys.inboxTopic}/json?poll=1&since=${since}`)).text()).trim().split('\n').filter(Boolean);
    assert.equal((await poll('all')).length, 1);
    assert.equal((await poll('unknownid123')).length, 1, 'an unknown id returns everything');
    const [first] = (await poll('all')).map((l) => JSON.parse(l));
    assert.equal((await poll(String(first.time))).length, 1, 'since=<time> is inclusive');
    assert.equal((await poll(String(first.time + 1))).length, 0);
  } finally { await relay.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------
// Cursors: retry entries hold the inbox and the ack cursor (CHANGES-v1.1 2.6, finding 15)

for (const failure of [503, 429]) {
  test(`a download ${failure} holds the inbox cursor below a message 40 min later; the item still arrives`, async () => {
    const { relay, sender, receiver, hooks, messages, advance } = await setup();
    try {
      const a = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
      const [ma] = messages();
      hooks.download = (id) => (id === ma.id ? failure : null);
      advance(40 * MIN);
      await sender.send({ kind: 'url', url: 'https://example.com/later' });
      const first = await receiver.pollOnce();
      assert.deepEqual(first.items.map((i) => i.header.kind), ['url']);
      assert.ok((await receiver.storage.get('inboxSince')) <= ma.time - 1800, 'held at the retry entry, not at the newest');
      hooks.download = null;
      advance(MIN);
      const second = await receiver.pollOnce();
      assert.deepEqual(second.items.map((i) => i.header.id), [a.id]);
    } finally { await relay.close(); }
  });
}

test('checkAcks holds the ack cursor at a retry download, keeps a 1,800 s overlap, and saves it', async () => {
  const { relay, sender, keys, hooks, messages, advance } = await setup();
  try {
    const a = await sender.send({ kind: 'url', url: 'https://example.com/a' });
    const rc = new ds.RelayClient({ relay: relay.url, retryDelaysMs: [0, 0, 0] });
    const ids = [...Array.from({ length: 149 }, () => ds.newItemId()), a.id]; // a v1.0 Daylight's attachment-sized ack
    await rc.publish(keys.ackTopic, await ds.encryptFrame(keys, 'ack', { v: 1, kind: 'ack', ids, sent: ds.nowIso(T0), from: 'Daylight' }, new Uint8Array(0)));
    const [big] = messages(keys.ackTopic);
    assert.ok(big.attachment);
    hooks.download = (id) => (id === big.id ? 503 : null);
    advance(40 * MIN);
    await rc.publish(keys.ackTopic, await ds.buildAckFrame(keys, [ds.newItemId()]));
    const small = messages(keys.ackTopic)[1];
    assert.equal(await sender.checkAcks(), 0);
    assert.ok((await sender.storage.get('ackSince')) <= big.time - 1800, 'the ack cursor is held at the retry entry');
    hooks.download = null;
    assert.equal(await sender.checkAcks(), 1);
    assert.equal((await row(sender, a.id)).status, 'delivered');
    assert.equal(await sender.storage.get('ackSince'), small.time - 1800, 'newest − 1800 once nothing is held');
  } finally { await relay.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------
// Receiver: acks, ordering, download outcomes, integrity failures, incomplete items

test('a poll with 75 new items acks all of them, in two ack messages of at most 70 ids', async () => {
  const { relay, sender, receiver, keys, messages } = await setup();
  try {
    for (let i = 0; i < 75; i++) await sender.send({ kind: 'url', url: `https://example.com/${i}` });
    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 75);
    assert.equal(got.acked.length, 75);
    const acks = messages(keys.ackTopic);
    assert.equal(acks.length, 2);
    assert.ok(acks.every((m) => !m.attachment), 'every ack frame is a message');
    assert.equal(await sender.checkAcks(), 75);
  } finally { await relay.close(); }
});

test('pollOnce saves its state before it publishes acks, and stops at the first failed ack', async () => {
  const log = [];
  const { relay, sender, keys, pairing, now, hooks } = await setup();
  try {
    class Logged extends ds.MemoryStorage { async set(k, v) { log.push(`set ${k}`); return super.set(k, v); } }
    const f = (url, init) => { if (url.endsWith(keys.ackTopic)) log.push('ack'); return fetch(url, init); };
    const r = new ds.Receiver({ pairing, storage: new Logged(), fetch: f, now, retryDelaysMs: [] });
    for (let i = 0; i < 75; i++) await sender.send({ kind: 'url', url: `https://example.com/${i}` });
    hooks.publish = (topic) => (topic === keys.ackTopic ? 503 : null);
    const got = await r.pollOnce();
    assert.equal(got.items.length, 75);
    assert.match(got.ackError, /503/);
    assert.ok(log.indexOf('set seenItems') >= 0 && log.indexOf('set seenItems') < log.indexOf('ack'), log.join(','));
    assert.equal(log.filter((l) => l === 'ack').length, 1, 'no second ack frame after the first failed');
  } finally { await relay.close(); }
});

test('tick reads acks before re-sending: an acked item that is due is not uploaded again', async () => {
  const { relay, sender, receiver, advance, puts } = await setup();
  try {
    await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
    await receiver.pollOnce();
    advance(185 * MIN);
    const before = puts();
    assert.deepEqual(await sender.tick(), { delivered: 1, resent: 0 });
    assert.equal(puts(), before);
  } finally { await relay.close(); }
});

for (const [status, outcome] of [[410, 'expired'], [403, 'retry'], [500, 'retry'], [418, 'retry']]) {
  test(`a download ${status} is ${outcome === 'expired' ? 'expired: handled and not asked for again' : 'a retry: the item arrives at the next poll'}`, async () => {
    const { relay, sender, receiver, hooks, messages } = await setup();
    try {
      const r = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
      const [m] = messages();
      hooks.download = (id, n) => (n === 0 ? status : null);
      assert.equal((await receiver.pollOnce()).items.length, 0);
      const second = await receiver.pollOnce();
      if (outcome === 'expired') {
        assert.equal(second.items.length, 0);
        assert.equal(relay.state.downloadsById[m.id], 1, 'an expired attachment is not asked for again');
      } else {
        assert.deepEqual(second.items.map((i) => i.header.id), [r.id]);
      }
    } finally { await relay.close(); }
  });
}

test('after a download 429 later message entries still decode; after a 503 later downloads still go', async () => {
  {
    const { relay, sender, receiver, hooks, messages } = await setup();
    try {
      await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
      await sender.send({ kind: 'url', url: 'https://example.com/b' });
      const [ma] = messages();
      hooks.download = (id) => (id === ma.id ? 429 : null);
      assert.deepEqual((await receiver.pollOnce()).items.map((i) => i.header.kind), ['url']);
    } finally { await relay.close(); }
  }
  {
    const { relay, sender, receiver, hooks, messages } = await setup();
    try {
      await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000, 1) });
      await sender.send({ kind: 'file', name: 'b.pdf', mime: 'application/pdf', content: pdf(50000, 2) });
      const [ma] = messages();
      hooks.download = (id) => (id === ma.id ? 503 : null);
      assert.deepEqual((await receiver.pollOnce()).items.map((i) => i.header.name), ['b.pdf']);
    } finally { await relay.close(); }
  }
});

test('an item that fails its integrity check has every part message handled, and holds nothing', async () => {
  const { relay, receiver, keys, messages } = await setup();
  try {
    const built = await ds.buildItemFrames(keys, { kind: 'file', name: 'x.pdf', mime: 'application/pdf', content: pdf(3000) }, { chunkSize: 1000 });
    const rc = new ds.RelayClient({ relay: relay.url });
    const p2 = await ds.decryptFrame(keys, 'inbox', built.frames[2]);
    const bad = await ds.encryptFrame(keys, 'inbox', p2.header, pdf(1000, 9)); // part 2 with other bytes: sha256 fails
    for (const f of built.frames.slice(0, 2)) await rc.publish(keys.inboxTopic, f);
    await receiver.pollOnce();
    assert.deepEqual(Object.keys(await receiver.storage.get('incomplete')), [built.id]);
    await rc.publish(keys.inboxTopic, bad);
    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 0);
    const handled = await receiver.storage.get('seenMsgs');
    assert.equal(messages().length, 3);
    assert.ok(messages().every((m) => Object.hasOwn(handled, m.id)), 'all three part messages are handled');
    assert.deepEqual(await receiver.storage.get('incomplete'), {});
  } finally { await relay.close(); }
});

test('an incomplete item is given up 24 h after its first part, also after a restart: the cursor is no longer held at it', async () => {
  const { relay, sender, receiver, keys, pairing, messages, advance, now } = await setup();
  try {
    const built = await ds.buildItemFrames(keys, { kind: 'file', name: 'x.pdf', mime: 'application/pdf', content: pdf(3000) }, { chunkSize: 1000 });
    await new ds.RelayClient({ relay: relay.url }).publish(keys.inboxTopic, built.frames[0]);
    await receiver.pollOnce();
    assert.ok(Object.hasOwn(await receiver.storage.get('incomplete'), built.id));
    const restarted = new ds.Receiver({ pairing, storage: receiver.storage, now }); // its held parts are gone; `incomplete` is not
    advance(24 * HOUR + MIN);
    await sender.send({ kind: 'url', url: 'https://example.com/next-day' });
    const link = messages().at(-1);
    assert.equal((await restarted.pollOnce()).items.length, 1);
    assert.deepEqual(await receiver.storage.get('incomplete'), {});
    assert.equal(await receiver.storage.get('inboxSince'), link.time - 1800);
  } finally { await relay.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------
// Sender: counters, staleness, expiry, retry, pass breakers, refusing big items (CHANGES-v1.1 2.4)

test('attempts counts failures since the last success; slowFails counts slow failures in a row', async () => {
  const { relay, sender, hooks, advance } = await setup();
  try {
    hooks.publish = () => 503;
    const u = await sender.send({ kind: 'url', url: 'https://example.com/u' });
    assert.equal(u.attempts, 1);
    hooks.publish = null;
    advance(2 * MIN);
    assert.equal((await sender.resendDue())[0].attempts, 0, 'reset by the success');

    let answer = 413;
    hooks.publish = (topic, n, isAttachment) => (isAttachment ? answer : null);
    const f = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
    assert.equal(f.slowFails, 1);
    answer = 503;
    advance(185 * MIN);
    const pick = async () => (await sender.resendDue()).find((x) => x.id === f.id);
    let r = await pick();
    assert.equal(r.errorCode, 'network');
    assert.equal(r.slowFails, 0, 'a network failure breaks the run');
    answer = 413;
    for (let i = 1; i <= 2; i++) { advance(185 * MIN); r = await pick(); assert.equal(r.status, 'failed', `slow failure ${i} of the new run`); }
    advance(185 * MIN);
    r = await pick();
    assert.equal(r.status, 'expired', 'the third in a row');
    assert.equal(r.errorCode, 'full');
  } finally { await relay.close(); }
});

test('the network backoff is capped at 60 min', async () => {
  const { relay, sender, advance, posts } = await setup();
  try {
    const id = ds.newItemId();
    await sender.storage.set('outbox', [{ id, kind: 'url', url: 'https://example.com/b', title: '', name: '', mime: '', size: 0, sent: ds.nowIso(T0),
      created: T0, status: 'failed', errorCode: 'network', attempts: 7, slowFails: 0, lastPublish: T0, attachment: false, error: '' }]);
    advance(59 * MIN);
    assert.deepEqual(await sender.resendDue(), []);
    advance(MIN);
    assert.equal((await sender.resendDue())[0].status, 'sent');
    assert.equal(posts(), 1);
  } finally { await relay.close(); }
});

test('a sending row left by a stopped process is re-sent only after 15 min without progress; each accepted frame is progress', async () => {
  const { relay, sender, pairing, advance, now, posts, fast } = await setup();
  try {
    const id = ds.newItemId();
    await sender.storage.set('outbox', [{ id, kind: 'url', url: 'https://example.com/stuck', title: '', name: '', mime: '', size: 0,
      sent: ds.nowIso(T0), created: T0 - HOUR, status: 'sending', attemptStarted: T0, lastPublish: 0, attachment: false, attempts: 0, error: '' }]);
    advance(14 * MIN);
    assert.deepEqual(await sender.resendDue(), []);
    advance(MIN);
    assert.equal((await sender.resendDue())[0].status, 'sent');
    assert.equal(posts(), 1);

    // A network where each request takes 5 min: the row records progress after every accepted frame, the last included,
    // so a process killed right after the relay took the last frame leaves a row that is not due for 15 min.
    const saved = [];
    class Snapshots extends ds.MemoryStorage { async set(k, v) { if (k === 'outbox') saved.push(...structuredClone(v)); return super.set(k, v); } }
    const slowNet = (url, init) => { advance(5 * MIN); return fetch(url, init); };
    const s2 = new ds.Sender({ pairing, storage: new Snapshots(), now, fetch: slowNet, chunkSize: 20000, ...fast });
    const start = now();
    const r = await s2.send({ kind: 'file', name: 'b.pdf', mime: 'application/pdf', content: pdf(50000) });
    assert.equal(r.status, 'sent');
    const sending = saved.filter((x) => x.id === r.id && x.status === 'sending').map((x) => x.attemptStarted - start);
    assert.deepEqual([...new Set(sending)], [0, 5 * MIN, 10 * MIN, 15 * MIN], 'saved at the start and after each of the 3 frames');
    assert.equal(r.lastPublish, start + 15 * MIN, 'lastPublish is the end of the attempt');
  } finally { await relay.close(); }
});

test('a failed/full row that reaches 7 days becomes expired with no error code', async () => {
  const { relay, sender, hooks, advance, now } = await setup();
  try {
    hooks.publish = (topic, n, isAttachment) => (isAttachment ? 413 : null);
    const f = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
    assert.equal(f.errorCode, 'full');
    advance(7 * DAY + MIN);
    await sender.resendDue();
    const r = await row(sender, f.id);
    assert.equal(r.status, 'expired');
    assert.equal(r.errorCode, '');
    assert.match(ds.describeRow(r, now()).sentence, /within a week/);
  } finally { await relay.close(); }
});

test('Retry now sends a failed row at once; Try again resets the counters; other rows are left alone', async () => {
  const { relay, sender, hooks, advance, posts, puts } = await setup();
  try {
    hooks.publish = () => 503;
    const u = await sender.send({ kind: 'url', url: 'https://example.com/u' });
    hooks.publish = null;
    const before = posts();
    const r = await sender.retry(u.id);
    assert.equal(r.status, 'sent');
    assert.equal(posts(), before + 1, 'Retry now publishes without waiting for the backoff');

    let answer = 413;
    hooks.publish = (topic, n, isAttachment) => (isAttachment ? answer : null);
    const f = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
    for (let i = 0; i < 2; i++) { advance(185 * MIN); await sender.resendDue(); }
    assert.equal((await row(sender, f.id)).status, 'expired');
    const t = await sender.retry(f.id);
    assert.equal(t.status, 'failed', 'one more full after Try again does not end it at once');
    assert.equal(t.slowFails, 1);
    assert.equal(t.attempts, 1);

    answer = null;
    const others = [
      { status: 'sending', errorCode: '', attemptStarted: T0 },
      { status: 'sent', errorCode: '' },
      { status: 'delivered', errorCode: '' },
      { status: 'expired', errorCode: 'gone' },
      { status: 'expired', errorCode: 'too-large', size: 10000000 },
    ].map((o) => ({ id: ds.newItemId(), kind: 'url', url: 'https://example.com/o', title: '', name: '', mime: '', size: 0, sent: ds.nowIso(T0),
      created: T0, lastPublish: T0, attachment: false, attempts: 0, error: '', ...o }));
    await sender.storage.set('outbox', [...others, ...(await sender.list())]);
    const p0 = posts() + puts();
    for (const o of others) {
      const back = await sender.retry(o.id);
      assert.deepEqual([back.status, back.errorCode, back.lastPublish, back.created], [o.status, o.errorCode, o.lastPublish, o.created], `${o.status}/${o.errorCode}`);
    }
    assert.equal(posts() + puts(), p0, 'no publish');
  } finally { await relay.close(); }
});

test('a pass keeps going after a 5xx and after a refused attachment', async () => {
  {
    const { relay, sender, hooks, advance } = await setup();
    try {
      hooks.publish = () => 503;
      const a = await sender.send({ kind: 'url', url: 'https://example.com/a' });
      const b = await sender.send({ kind: 'url', url: 'https://example.com/b' });
      let left = 4; // one publish call and its three in-call retries
      hooks.publish = () => (left-- > 0 ? 503 : null);
      advance(2 * MIN);
      const attempted = await sender.resendDue();
      assert.deepEqual(attempted.map((r) => [r.id, r.status]), [[a.id, 'failed'], [b.id, 'sent']]);
    } finally { await relay.close(); }
  }
  {
    const { relay, sender, hooks, advance } = await setup();
    try {
      hooks.publish = () => 503;
      const a = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000, 1) });
      const b = await sender.send({ kind: 'file', name: 'b.pdf', mime: 'application/pdf', content: pdf(50000, 2) });
      let once = true;
      hooks.publish = (t, n, isAttachment) => (isAttachment && once ? ((once = false), 403) : null);
      advance(2 * MIN);
      const attempted = await sender.resendDue();
      assert.deepEqual(attempted.map((r) => [r.id, r.status, r.errorCode]), [[a.id, 'failed', 'refused'], [b.id, 'sent', '']]);
    } finally { await relay.close(); }
  }
});

test('Sender.send refuses content over 9 MB: nothing stored, nothing published', async () => {
  const { relay, sender, puts, posts } = await setup();
  try {
    await assert.rejects(sender.send({ kind: 'file', name: 'big.pdf', mime: 'application/pdf', content: new Uint8Array(9000001) }),
      (e) => e.code === 'too-large' && e.message === 'Too big to send. Files can be up to 9 MB; this one is 9.1 MB.');
    assert.deepEqual(await sender.list(), []);
    assert.equal(puts() + posts(), 0);
  } finally { await relay.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------
// The outbox lock, and the pairing-change rule (note a; PROTOCOL 3.3 step 6)

test('two Senders on one slow storage: concurrent sends lose no rows, concurrent passes publish each due row once', async () => {
  class SlowStorage extends ds.MemoryStorage {
    async get(k) { await ds.sleep(Math.random() * 4); return super.get(k); }
    async set(k, v) { await ds.sleep(Math.random() * 4); return super.set(k, v); }
  }
  const { relay, pairing, now, posts, advance, fast } = await setup();
  try {
    const storage = new SlowStorage();
    const a = new ds.Sender({ pairing, storage, now, ...fast });
    const b = new ds.Sender({ pairing, storage, now, ...fast });
    const url = (i) => ({ kind: 'url', url: `https://example.com/${i}` });
    await Promise.all([a.send(url(1)), b.send(url(2)), a.send(url(3)), b.send(url(4)), a.send(url(5)), b.send(url(6))]);
    assert.equal((await a.list()).length, 6, 'no row lost');
    const rows = (await a.list()).map((r) => ({ ...r, status: 'failed', errorCode: 'network', attempts: 1, lastPublish: now() }));
    await storage.set('outbox', rows);
    advance(2 * MIN);
    const before = posts();
    await Promise.all([a.tick(), b.tick(), a.resendDue(), b.resendDue()]);
    assert.equal(posts() - before, 6, 'each due row published once');
    assert.ok((await a.list()).every((r) => r.status === 'sent'));
  } finally { await relay.close(); }
});

test('applyPairingChange: the same secret keeps the outbox for the new relay; another secret deletes rows, content and ack cursor', async () => {
  const { relay, sender, pairing, hooks, advance, now, fast } = await setup();
  const relay2 = await startMockRelay({ now });
  try {
    const storage = sender.storage;
    hooks.publish = () => 503;
    const f = await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(50000) });
    assert.equal(f.status, 'failed');
    await storage.set('ackSince', 123);

    const moved = { ...pairing, relay: relay2.url, name: 'Renamed' };
    assert.equal(await ds.applyPairingChange(storage, pairing, moved), false, 'same secret: kept');
    const s2 = new ds.Sender({ pairing: moved, storage, now, ...fast });
    advance(2 * MIN);
    assert.equal((await s2.resendDue())[0].status, 'sent', 'the pending row goes through the new relay');
    assert.equal(relay2.state.topics.get((await s2.keys()).inboxTopic).length, 1);

    const other = { secret: ds.generateSecret(), relay: relay2.url, name: 'Another Daylight' };
    assert.equal(await ds.applyPairingChange(storage, moved, other), true, 'another secret: deleted');
    assert.deepEqual(await storage.get('outbox'), undefined);
    assert.equal(await storage.get(`outbox/${f.id}`), undefined);
    assert.equal(await storage.get('ackSince'), undefined);
    assert.equal(await ds.applyPairingChange(new ds.MemoryStorage(), null, other), true, 'nothing paired before: a fresh outbox');

    // Under the sender lock: a share in flight finishes first, then its row is deleted with the rest.
    hooks.publish = null;
    const s3 = new ds.Sender({ pairing: moved, storage, now, ...fast });
    const [sent, cleared] = await Promise.all([s3.send({ kind: 'url', url: 'https://example.com/in-flight' }), ds.applyPairingChange(storage, moved, other)]);
    assert.equal(sent.status, 'sent');
    assert.equal(cleared, true);
    assert.deepEqual(await s3.list(), []);
  } finally { await relay.close(); await relay2.close(); }
});
