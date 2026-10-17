import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ds from '../daylight-share.js';
import { startMockRelay } from '../mock-relay.mjs';

async function setup(opts = {}) {
  let clock = Date.UTC(2026, 9, 17, 22, 0, 0);
  const now = () => clock;
  const relay = await startMockRelay({ now, ...opts });
  const secret = ds.generateSecret();
  const pairing = { secret, relay: relay.url, name: 'Test Daylight' };
  const sender = new ds.Sender({ pairing, storage: new ds.MemoryStorage(), from: 'Test phone', app: 'test/1', now, chunkSize: opts.chunkSize });
  const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage(), now });
  return { relay, sender, receiver, advance: (ms) => { clock += ms; }, now };
}

test('send, receive, ack, delivered', async () => {
  const { relay, sender, receiver } = await setup();
  try {
    const row = await sender.send({ kind: 'url', url: 'https://example.com/story', title: 'A story' });
    assert.equal(row.status, 'sent');
    const page = await sender.send({ kind: 'page', url: 'https://example.com/page', title: 'Page', content: '<html><body>' + '<p>words</p>'.repeat(2000) + '</body></html>' });
    const pdf = await sender.send({ kind: 'file', name: 'paper.pdf', mime: 'application/pdf', content: new Uint8Array(50000).fill(7) });
    assert.equal(pdf.attachment, true);
    assert.equal(page.attachment, false, 'a very compressible page fits in a message');

    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 3);
    assert.deepEqual(got.items.map((i) => i.header.kind).sort(), ['file', 'page', 'url']);
    assert.equal(got.items.find((i) => i.header.kind === 'file').content.length, 50000);
    assert.equal(got.acked.length, 3);

    assert.equal(await sender.checkAcks(), 3);
    assert.ok((await sender.list()).every((r) => r.status === 'delivered'));
    assert.equal(await sender.storage.get(`outbox/${pdf.id}`), undefined, 'content dropped once delivered');

    const again = await receiver.pollOnce();
    assert.equal(again.items.length, 0, 'nothing new on the next poll');
  } finally { await relay.close(); }
});

test('large file in several parts survives a receiver restart between parts', async () => {
  const { relay, sender, now } = await setup({ chunkSize: 20000 });
  try {
    const bytes = new Uint8Array(70000).map((_, i) => i & 0xff);
    const keys = await sender.keys();
    const built = await ds.buildItemFrames(keys, { kind: 'file', name: 'big.pdf', mime: 'application/pdf', content: bytes }, { chunkSize: 20000 });
    assert.equal(built.frames.length, 4);
    const storage = new ds.MemoryStorage();
    const rc = new ds.RelayClient({ relay: relay.url });
    await rc.publish(keys.inboxTopic, built.frames[0]);
    await rc.publish(keys.inboxTopic, built.frames[1]);
    let r = new ds.Receiver({ pairing: sender.pairing, storage, now });
    assert.equal((await r.pollOnce()).items.length, 0);
    r = new ds.Receiver({ pairing: sender.pairing, storage, now }); // a new process: reassembly state lost
    await rc.publish(keys.inboxTopic, built.frames[2]);
    await rc.publish(keys.inboxTopic, built.frames[3]);
    const got = await r.pollOnce();
    assert.equal(got.items.length, 1);
    assert.deepEqual(got.items[0].content, bytes);
  } finally { await relay.close(); }
});

test('re-send after the relay forgets an unacknowledged attachment', async () => {
  const { relay, sender, receiver, advance } = await setup({ attachmentTtlSec: 3 * 3600 });
  try {
    const row = await sender.send({ kind: 'file', name: 'paper.pdf', mime: 'application/pdf', content: new Uint8Array(20000).fill(1) });
    advance(4 * 3600 * 1000); // the Daylight was off; the attachment expired
    assert.equal((await receiver.pollOnce()).items.length, 0);
    const t = await sender.tick();
    assert.equal(t.resent, 1);
    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 1);
    assert.equal(got.items[0].header.id, row.id);
    await sender.tick();
    assert.equal((await sender.list())[0].status, 'delivered');
  } finally { await relay.close(); }
});

test('a duplicate re-send is acked again but not delivered twice', async () => {
  const { relay, sender, receiver, advance } = await setup();
  try {
    const row = await sender.send({ kind: 'url', url: 'https://example.com/x' });
    assert.equal((await receiver.pollOnce()).items.length, 1);
    // The sender never saw the ack (say it was offline for 12 h) and re-sends.
    advance(13 * 3600 * 1000);
    await sender.retry(row.id);
    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 0);
    assert.deepEqual(got.acked, [row.id]);
    assert.equal(await sender.checkAcks(), 1);
  } finally { await relay.close(); }
});

test('junk on the topic is ignored', async () => {
  const { relay, sender, receiver } = await setup();
  try {
    const keys = await sender.keys();
    await fetch(`${relay.url}/${keys.inboxTopic}`, { method: 'POST', body: 'hello there' });
    await fetch(`${relay.url}/${keys.inboxTopic}`, { method: 'PUT', headers: { Filename: 'x.bin' }, body: new Uint8Array(5000) });
    await sender.send({ kind: 'url', url: 'https://example.com/ok' });
    const got = await receiver.pollOnce();
    assert.equal(got.items.length, 1);
  } finally { await relay.close(); }
});

test('relay errors mark the row failed and retry later', async () => {
  const { relay, sender, advance } = await setup();
  await relay.close();
  const row = await sender.send({ kind: 'url', url: 'https://example.com/offline' }).catch((e) => e);
  assert.equal(row.status, 'failed');
  advance(5 * 60 * 1000);
  const again = await sender.resendDue();
  assert.equal(again.length, 1);
  assert.equal(again[0].status, 'failed');
});

test('expired after a week', async () => {
  const { relay, sender, advance } = await setup();
  try {
    await sender.send({ kind: 'url', url: 'https://example.com/never' });
    advance(8 * 24 * 3600 * 1000);
    await sender.resendDue();
    assert.equal((await sender.list())[0].status, 'expired');
  } finally { await relay.close(); }
});
