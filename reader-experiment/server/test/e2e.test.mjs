// End to end in the local workerd runtime: the Worker (Miniflare), share's mock relay (plus Attach:), the protocol's
// JS Receiver and the client module. An email-in newsletter and a 30 MB file (far over ntfy.sh's 2 MiB attachments,
// hosted by the Worker in R2) reach the Receiver intact, are acked, and the server and the sender see the acks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setup, SERVER, mime, CF_AUTH } from './helpers.mjs';

const MIN = 60_000;
const sha = (b) => createHash('sha256').update(b).digest('hex');

const NEWSLETTER = (n) => `<html><head><title>x</title></head><body>
<p><a href="https://letters.example/web/${n}?utm_campaign=c">View in browser</a></p>
<h1>Letters from the Coast, issue ${n}</h1>
${Array.from({ length: 400 }, (_, i) => `<p>Paragraph ${i}: the tide went out at ${i % 12} o’clock and the gulls ${i % 3 ? 'cried' : 'slept'}. <script>evil(${i})</script></p>`).join('\n')}
<img src="cid:mast@letters" alt="Masthead"><p><a href="https://letters.example/unsubscribe">Unsubscribe</a></p></body></html>`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function sendNewsletter(t, n) {
  const raw = mime({
    headers: [CF_AUTH('pass')], from: 'Letters from the Coast <editor@letters.example>', subject: `Letters #${n}`,
    html: NEWSLETTER(n), text: 'Plain text version '.repeat(50), attachments: [{ type: 'image/png', cid: 'mast@letters', data: PNG }],
  });
  const res = await t.email(raw, { from: 'editor@letters.example' });
  assert.equal(res.outcome, 'ok');
  assert.equal(res.rejectReason, undefined);
}

function checkNewsletterItem(item, n) {
  assert.equal(item.header.kind, 'page');
  assert.equal(item.header.title, `Letters #${n}`);
  assert.equal(item.header.url, `https://letters.example/web/${n}`, 'the "view in browser" link, without tracking');
  assert.equal(item.header.from, 'Email · Letters from the Coast');
  assert.equal(item.header.size, item.content.length);
  assert.equal(item.header.sha256, sha(item.content), 'verified by the Receiver, checked again here');
  const html = new TextDecoder().decode(item.content);
  assert.match(html, new RegExp(`<h1>Letters from the Coast, issue ${n}</h1>`));
  assert.match(html, /Paragraph 399: the tide went out at 3 o’clock/);
  assert.doesNotMatch(html, /<script|evil\(/);
  assert.match(html, /<img src="data:image\/png;base64,/);
}

test('v1 delivery: an email-in newsletter reaches the protocol’s JS Receiver intact and the server sees its ack', async () => {
  const t = await setup({ delivery: 'v1' });
  try {
    const T = Date.now();
    await sendNewsletter(t, 7);
    let r = await t.cron(T);
    assert.ok(Object.keys(r.steps).some((s) => s.startsWith('email')), JSON.stringify(r));
    r = await t.cron(T + MIN);
    assert.ok(Number(r.steps.outbox) >= 1, JSON.stringify(r));
    const got = await t.receiver.pollOnce();
    assert.equal(got.items.length, 1);
    assert.equal(got.storeError, null);
    checkNewsletterItem(got.items[0], 7);
    assert.deepEqual(got.acked, [got.items[0].header.id]);
    r = await t.cron(T + 40 * MIN);
    assert.equal(r.steps.acks, '1');
    const [row] = await t.rows('SELECT state FROM outbox WHERE id = ?', got.items[0].header.id);
    assert.equal(row.state, 'delivered');
    assert.deepEqual((await t.api('GET', '/v1/email/recent')).json[0].items, [got.items[0].header.id]);
  } finally { await t.close(); }
});

test('Lab delivery: the same newsletter reaches the DC-1 Lab Inbox’s server lane, never the v1 inbox topic', async () => {
  const t = await setup();
  try {
    const T = Date.now();
    await t.lane.hello();
    await sendNewsletter(t, 8);
    await t.cron(T);
    await t.cron(T + MIN);
    const v1 = await t.receiver.pollOnce();
    assert.deepEqual(v1.items, [], 'server items under Lab delivery are not on the inbox topic');
    const items = await t.lane.poll();
    assert.equal(items.length, 1);
    checkNewsletterItem(items[0], 8);
    assert.equal(items[0].raw['x-origin'], 'email');
    await t.cron(T + 40 * MIN);
    assert.equal((await t.rows('SELECT state FROM outbox'))[0].state, 'delivered');
  } finally { await t.close(); }
});

test('a 30 MB file through the Worker: hosted v1 frames in R2, Attach: messages, the JS Receiver, acks, then deleted', async () => {
  const t = await setup();
  try {
    await t.cron(Date.now()); // publishes the config frame the client discovers
    assert.deepEqual(await t.client.state('files'), { state: 'ready', message: null });
    const content = new Uint8Array(30_000_000);
    for (let i = 0; i < content.length; i += 4) content[i] = (i * 2654435761) >>> 24;
    const row = await t.client.files.sendLarge({ name: 'Field notes.pdf', mime: 'application/pdf', content, title: 'Field notes' });
    assert.equal(row.parts, 3);
    assert.equal(row.status, 'sent');
    const info = (await t.api('GET', `/v1/files/${row.fileId}`)).json;
    assert.deepEqual(info.stored, [0, 1, 2]);
    assert.equal(t.relay.state.files.size, 0, 'nothing was uploaded to the relay');
    const inbox = t.relay.messages(t.keys.inboxTopic);
    assert.equal(inbox.length, 3);
    assert.deepEqual(inbox.map((m) => t.relay.externalUrl(m.id)), row.urls);
    for (const u of row.urls) assert.match(u, /^https:\/\/daylight\.test\/f\/[0-9a-f]{32}\/\d$/);

    const got = await t.receiver.pollOnce();
    assert.equal(got.items.length, 1);
    const item = got.items[0];
    assert.equal(item.header.kind, 'file');
    assert.equal(item.header.name, 'Field notes.pdf');
    assert.equal(item.header.title, 'Field notes');
    assert.equal(item.header.from, 'Test phone');
    assert.equal(item.content.length, content.length);
    assert.equal(sha(item.content), sha(content), 'intact');
    assert.deepEqual(got.acked, [row.id]);

    const tick = await t.client.files.tick();
    assert.equal(tick.delivered, 1);
    assert.equal((await t.client.files.list())[0].status, 'delivered');
    assert.equal((await t.api('GET', `/v1/files/${row.fileId}`)).status, 404, 'deleted on the server once delivered');
    assert.equal((await t.dispatch(`${SERVER}/f/${row.fileId}/0`)).status, 404);
  } finally { await t.close(); }
});
