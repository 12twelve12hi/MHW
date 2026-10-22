// core.js against the mock relay, with a Receiver from daylight-share.js playing the Daylight and a fake bridge in
// place of Rust: pairing, Send To paths, the clipboard link, acks, retries, the waiting queue and the timers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../helpers/built.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const ds = await load('daylight-share.js');
const core = await load('core.js');
const L = await load('logic.js');


let relay;
before(async () => { relay = await startMockRelay(); });
after(async () => { await relay?.close(); });

function fakeTimers() {
  const t = { timeouts: [], intervals: [] };
  t.setTimeout = (fn, ms) => { const h = { fn, ms }; t.timeouts.push(h); return h; };
  t.clearTimeout = (h) => { t.timeouts = t.timeouts.filter((x) => x !== h); };
  t.setInterval = (fn, ms) => { const h = { fn, ms }; t.intervals.push(h); return h; };
  t.clearInterval = (h) => { t.intervals = t.intervals.filter((x) => x !== h); };
  return t;
}

function fakeBridge(files = {}) {
  const b = { notes: [], shown: 0, reads: [] };
  b.notify = async (title, body) => { b.notes.push({ title, body }); };
  b.showWindow = async () => { b.shown++; };
  b.readFile = async (p, max) => {
    b.reads.push({ p, max });
    if (!(p in files)) throw new Error('Couldn’t open it (not found).');
    // {size} stands for a file too big to hold in a test: Rust answers "too-large:<size>" without reading it.
    const f = files[p];
    const size = f.size ?? f.length;
    if (max != null && size > max) throw `too-large:${size}`;
    return f;
  };
  return b;
}

async function daylight(name = 'Desk Daylight', relayUrl = relay.url) {
  const secret = ds.generateSecret();
  const link = await ds.pairingLink({ secret, relay: relayUrl, name });
  const receiver = new ds.Receiver({ pairing: { secret, relay: relayUrl }, storage: new ds.MemoryStorage() });
  return { secret, link, code: await ds.formatCode(secret), receiver };
}

function newApp(opts = {}) {
  const bridge = opts.bridge ?? fakeBridge();
  const timers = opts.timers ?? fakeTimers();
  const storage = opts.storage ?? new ds.MemoryStorage();
  const app = core.createApp({ bridge, storage, timers, version: '1.0.7', log: { warn() {} }, ...opts.extra });
  return { app, bridge, timers, storage };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

test('pairs from a link, sends Send To files and a clipboard link; the Daylight gets them intact and acks', async () => {
  const d = await daylight();
  const pdf = ds.utf8('%PDF-1.4\n% a tiny pdf ✓\n');
  const txt = ds.utf8('Field notes ✓ ünïcödé\n'.repeat(200));
  const { app, bridge } = newApp({ bridge: fakeBridge({ 'C:\\Docs\\Quiet paper – draft.pdf': pdf, 'C:\\Docs\\notes.txt': txt }) });
  const changes = [];
  app.onChange((k) => changes.push(k));

  assert.deepEqual(await app.state(), { paired: false, name: '', relay: '', defaultRelay: true, codeStart: '' });
  const r = await app.pair(d.link);
  assert.deepEqual(r, { name: 'Desk Daylight', relay: relay.url });
  assert.ok(changes.includes('pairing'));
  const s = await app.state();
  assert.equal(s.paired, true);
  assert.equal(s.defaultRelay, false);
  assert.equal(s.codeStart, d.code.slice(0, 4));

  const files = await app.handleAction({ type: 'files', paths: ['C:\\Docs\\Quiet paper – draft.pdf', 'C:\\Docs\\notes.txt'] });
  assert.equal(files.length, 2);
  assert.ok(files.every((f) => f.row?.status === 'sent'), JSON.stringify(files));
  assert.deepEqual(bridge.notes.at(-1), { title: '2 items', body: 'Sent · waiting for your Daylight.' });

  const clip = await app.handleAction({ type: 'clipboard', text: 'see https://www.example.com/story?id=7 now', error: '' });
  assert.equal(clip[0].row.url, 'https://www.example.com/story?id=7');
  assert.deepEqual(bridge.notes.at(-1), { title: 'example.com', body: 'Sent · waiting for your Daylight.' });

  const got = (await d.receiver.pollOnce()).items;
  assert.equal(got.length, 3);
  const byName = Object.fromEntries(got.map((i) => [i.header.name ?? i.header.url, i]));
  const p = byName['Quiet paper – draft.pdf'];
  assert.equal(p.header.kind, 'file');
  assert.equal(p.header.mime, 'application/pdf');
  assert.equal(p.header.title, 'Quiet paper – draft');
  assert.equal(p.header.from, 'Windows PC');
  assert.equal(p.header.app, 'windows/1.0.7');
  assert.deepEqual(p.content, pdf);
  assert.deepEqual(byName['notes.txt'].content, txt);
  assert.equal(byName['notes.txt'].header.mime, 'text/plain');
  assert.equal(byName['https://www.example.com/story?id=7'].header.kind, 'url');

  const t = await app.tick();
  assert.equal(t.delivered, 3);
  assert.deepEqual((await app.rows()).map((x) => x.status), ['delivered', 'delivered', 'delivered']);
  const snap = await app.snapshot();
  assert.equal(snap.paired, true);
  assert.equal(snap.name, 'Desk Daylight');
  assert.equal(snap.rows.length, 3);
  assert.ok(snap.rows.every((x) => x.status === 'delivered'));
  assert.ok(snap.rows.every((x) => x.label === 'Delivered ✓' && x.sentence === 'Saved on your Daylight.' && x.action === null));
  assert.equal(snap.rows.find((x) => x.kind === 'url').url, 'https://www.example.com/story?id=7');
});

test('a typed code pairs with the relay from Advanced', async () => {
  const d = await daylight('', relay.url);
  const { app } = newApp();
  const dashed = d.code.toLowerCase().replace(/-/g, ' - ');
  const r = await app.pair(dashed, { relay: relay.url });
  assert.equal(r.relay, relay.url);
  const row = await app.sendLink('https://example.com/typed', 'Typed');
  assert.equal(row.status, 'sent');
  const items = (await d.receiver.pollOnce()).items;
  assert.equal(items[0].header.title, 'Typed');
  await assert.rejects(app.pair('ABCD-EFGH'), (e) => e.code === 'code');
});

test('clipboard without a link, unreadable files and folders say why', async () => {
  const d = await daylight();
  const { app, bridge } = newApp();
  await app.pair(d.link);
  const none = await app.handleAction({ type: 'clipboard', text: 'just words', error: '' });
  assert.equal(none[0].code, 'no-link');
  assert.equal(bridge.notes.at(-1).title, 'No link to send');
  const err = await app.handleAction({ type: 'clipboard', text: '', error: 'clipboard busy' });
  assert.match(err[0].error, /clipboard busy/);
  const missing = await app.handleAction({ type: 'files', paths: ['C:\\gone.pdf'] });
  assert.equal(missing[0].name, 'gone.pdf');
  assert.equal(bridge.notes.at(-1).title, 'Couldn’t send gone.pdf');
  assert.equal((await app.rows()).length, 0);
});

test('Send To refuses a file over the protocol’s limit before reading it, in the library’s words', async () => {
  const d = await daylight();
  const size = core.MAX_FILE + 1;
  const { app, bridge } = newApp({ bridge: fakeBridge({ 'C:\\Scans\\big.pdf': { size } }) });
  await app.pair(d.link);
  const [r] = await app.handleAction({ type: 'files', paths: ['C:\\Scans\\big.pdf'] });
  assert.equal(r.code, 'too-large');
  assert.equal(r.error, core.tooBig(size));
  assert.equal(bridge.reads[0].max, core.MAX_FILE);
  assert.deepEqual(bridge.notes.at(-1), { title: 'Couldn’t send big.pdf', body: core.tooBig(size) });
  assert.equal((await app.rows()).length, 0);
});

test('a 5 MB file arrives intact in three pieces, each under the relay’s 2 MB per attachment', async () => {
  const d = await daylight();
  const { app } = newApp();
  await app.pair(d.link);
  const bytes = ds.randomBytes(5_000_000);
  const before = [...relay.state.topics.values()].flat().filter((m) => m.attachment).length;
  const row = await app.sendFile({ name: 'scan.pdf', bytes });
  assert.equal(row.status, 'sent', row.error);
  const frames = [...relay.state.topics.values()].flat().filter((m) => m.attachment).slice(before);
  assert.equal(frames.length, 3);
  assert.ok(frames.every((m) => m.attachment.size <= 2_000_000), frames.map((m) => m.attachment.size).join(', '));
  let got = [];
  for (let i = 0; i < 5 && !got.length; i++) got = (await d.receiver.pollOnce()).items;
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].content, bytes);
  await app.tick();
  assert.equal((await app.rows())[0].status, 'delivered');
});

test('an Internet Shortcut (.url) sends its address', async () => {
  const d = await daylight();
  const { app } = newApp({ bridge: fakeBridge({ 'C:\\Links\\Good read.url': ds.utf8('[InternetShortcut]\r\nURL=https://example.com/read\r\n') }) });
  await app.pair(d.link);
  const [r] = await app.handleAction({ type: 'files', paths: ['C:\\Links\\Good read.url'] });
  assert.equal(r.row.kind, 'url');
  assert.equal(r.row.url, 'https://example.com/read');
  assert.equal(r.row.title, 'Good read');
});

test('before pairing, Send To and the hotkey wait, open the window, and go out once paired', async () => {
  const d = await daylight();
  const { app, bridge } = newApp({ bridge: fakeBridge({ 'C:\\a.txt': ds.utf8('hello') }) });
  assert.equal(await app.handleAction({ type: 'files', paths: ['C:\\a.txt'] }), null);
  assert.equal(await app.handleAction({ type: 'clipboard', text: 'https://example.com/later' }), null);
  assert.equal(bridge.shown, 2);
  assert.equal(bridge.notes[0].title, 'Pair with your Daylight first');
  assert.equal((await app.snapshot()).waiting, 2);
  await app.pair(d.link);
  for (let i = 0; i < 40 && (await app.rows()).length < 2; i++) await settle();
  assert.equal((await app.rows()).length, 2);
  const items = (await d.receiver.pollOnce()).items;
  assert.deepEqual(items.map((i) => i.header.name ?? i.header.url).sort(), ['a.txt', 'https://example.com/later']);
});

test('a pairing link asks first, in the module’s words; nothing is saved or sent until the answer', async () => {
  const d = await daylight('My Daylight');
  const { app, bridge, storage } = newApp({ bridge: fakeBridge({ 'C:\\a.txt': ds.utf8('queued before pairing') }) });
  assert.equal(await app.handleAction({ type: 'files', paths: ['C:\\a.txt'] }), null, 'waits for pairing');
  const pre = await app.preparePairing(d.link, { source: 'link' });
  assert.equal(pre.current, null);
  assert.deepEqual(pre.confirm, ds.pairingConfirmation(null, await ds.parsePairing(d.link), { source: 'link' }));
  assert.equal(pre.confirm.ask, true);
  assert.equal(pre.confirm.title, 'Pair with My Daylight?');
  assert.equal(pre.confirm.lines[0], `Code starts ${d.code.slice(0, 4)}. Check it matches the code on your Daylight.`);
  assert.equal(pre.confirm.button, 'Pair');
  assert.equal(await storage.get('pairing'), undefined, 'asking saves nothing');
  assert.equal((await app.snapshot()).waiting, 1, 'and sends nothing');
  assert.equal(bridge.reads.length, 0);

  const r = await app.applyPairing(pre.next, { expect: '' });
  assert.deepEqual(r, { name: 'My Daylight', relay: relay.url });
  for (let i = 0; i < 40 && (await app.rows()).length < 1; i++) await settle();
  assert.equal((await d.receiver.pollOnce()).items[0].header.name, 'a.txt', 'what waited goes out once the user said Pair');
});

test('a typed code pairs without asking when nothing is paired; one that replaces another Daylight asks', async () => {
  const d1 = await daylight('First');
  const d2 = await daylight('');
  const { app } = newApp();
  const typed = await app.preparePairing(d1.code, { source: 'app', relay: relay.url });
  assert.deepEqual(typed.confirm, { ask: false, title: null, lines: [], button: null, notice: null });
  assert.equal(typed.next.relay, relay.url, 'the Advanced relay');
  await app.applyPairing(typed.next, { expect: '' });
  const replace = await app.preparePairing(d2.code, { source: 'app', relay: relay.url });
  assert.equal(replace.confirm.ask, true);
  assert.equal(replace.confirm.button, 'Switch');
  // A typed code carries no name.
  assert.equal(replace.confirm.lines.at(-1), 'This replaces your current Daylight. Items not yet delivered to it will not be sent.');
});

test('a link for another Daylight says it replaces this one; Switch deletes the old outbox, its content and cursor', async () => {
  const d1 = await daylight('First');
  const d2 = await daylight('First'); // a look-alike name: only the code tells them apart
  const { app, storage } = newApp();
  await app.pair(d1.link);
  const row = await app.sendFile({ name: 'x.txt', bytes: ds.utf8('for the first Daylight') });
  await storage.set('ackSince', 123);
  const pre = await app.preparePairing(d2.link, { source: 'link' });
  assert.equal(pre.confirm.ask, true);
  assert.equal(pre.confirm.button, 'Switch');
  assert.equal(pre.confirm.lines[0], `Code starts ${d2.code.slice(0, 4)}. Check it matches the code on your Daylight.`);
  assert.ok(pre.confirm.lines.includes('This replaces First. Items not yet delivered to it will not be sent.'));
  assert.equal((await app.rows()).length, 1, 'nothing changes before the answer');

  await app.applyPairing(pre.next, { expect: pre.current.code });
  assert.deepEqual(await app.rows(), []);
  assert.equal(await storage.get(`outbox/${row.id}`), undefined);
  assert.equal(await storage.get('ackSince'), undefined);
  assert.equal((await app.state()).codeStart, d2.code.slice(0, 4));

  await app.unpair();
  assert.equal((await app.state()).paired, false);
  await assert.rejects(app.sendLink('https://example.com/'), (e) => e.code === 'pairing');
  await assert.rejects(app.preparePairing('daylightshare://pair?c=NOPE'), (e) => e.code === 'code');
});

test('the same Daylight on another relay applies without asking and keeps the outbox: pending items go through the new relay', async () => {
  const relay2 = await startMockRelay();
  try {
    let clock = Date.now();
    const d = await daylight('Desk');
    const { app, storage } = newApp({ extra: { now: () => clock } });
    await app.pair(d.link);
    const delivered = await app.sendLink('https://example.com/delivered');
    await d.receiver.pollOnce();
    await app.tick();
    const pending = await app.sendFile({ name: 'pending.txt', bytes: ds.utf8('not picked up yet') });
    assert.equal(pending.status, 'sent');
    const cursor = await storage.get('ackSince');

    const moved = await ds.pairingLink({ secret: d.secret, relay: relay2.url, name: 'Desk, upstairs' });
    const pre = await app.preparePairing(moved, { source: 'link' });
    assert.deepEqual(pre.confirm, {
      ask: false, title: null, lines: [], button: null, notice: `Pairing updated: now sending through ${ds.relayHost(relay2.url)}.`,
    });
    const r = await app.applyPairing(pre.next, { expect: pre.current.code });
    assert.deepEqual(r, { name: 'Desk, upstairs', relay: relay2.url });
    const st = await app.state();
    assert.equal(st.name, 'Desk, upstairs', 'a new name is saved');
    assert.equal(st.relay, relay2.url);
    assert.deepEqual((await app.rows()).map((x) => [x.id, x.status]), [[pending.id, 'sent'], [delivered.id, 'delivered']]);
    assert.ok(await storage.get(`outbox/${pending.id}`), 'the re-send copy stays');
    assert.equal(await storage.get('ackSince'), cursor);

    // The Daylight now listens on the new relay; the pending item is re-sent there when it comes due, and acked there.
    const r2 = new ds.Receiver({ pairing: { secret: d.secret, relay: relay2.url }, storage: new ds.MemoryStorage() });
    clock += 12 * 3600000;
    await app.tick();
    const got = (await r2.pollOnce()).items;
    assert.deepEqual(got.map((i) => i.header.id), [pending.id]);
    await app.tick();
    assert.equal((await app.rows()).find((x) => x.id === pending.id).status, 'delivered');

    // The same link without a name (or the code typed again) keeps the name.
    const bare = await ds.pairingLink({ secret: d.secret, relay: relay2.url });
    const again = await app.preparePairing(bare, { source: 'link' });
    assert.deepEqual(again.confirm.notice, 'Pairing updated.');
    assert.equal((await app.applyPairing(again.next)).name, 'Desk, upstairs');
  } finally {
    await relay2.close();
  }
});

test('applyPairing refuses when the pairing changed after the user was asked', async () => {
  const d1 = await daylight('One');
  const d2 = await daylight('Two');
  const { app } = newApp();
  const asked = await app.preparePairing(d1.link, { source: 'link' });
  await app.pair(d2.code); // paired some other way meanwhile
  await assert.rejects(app.applyPairing(asked.next, { expect: '' }), (e) => e.code === 'pairing');
  assert.equal((await app.state()).codeStart, d2.code.slice(0, 4));
});

test('a send, retry, removal or tick queued behind a pairing change uses the new pairing (CHANGES-v1.1 note a)', async () => {
  // Before 1.1's close-out the app looked up the Sender before taking its outbox lock: a send queued behind Switch went
  // to the old Daylight while its row sat in the new one's outbox (and was later re-sent there).
  const d1 = await daylight('One');
  const d2 = await daylight('Two');
  const { app } = newApp();
  await app.pair(d1.link);
  const toTwo = await app.preparePairing(d2.link, { source: 'link' });
  const switching = app.applyPairing(toTwo.next, { expect: toTwo.current.code });
  const queued = app.sendLink('https://example.com/after-switch');
  await switching;
  const row = await queued;
  assert.deepEqual((await app.rows()).map((r) => r.id), [row.id]);
  assert.deepEqual((await d1.receiver.pollOnce()).items, [], 'nothing reaches the Daylight it was switched away from');
  assert.deepEqual((await d2.receiver.pollOnce()).items.map((i) => i.header.url), ['https://example.com/after-switch']);

  // A send started before the answer goes to the old Daylight, and Switch then drops its row: it is not sent again.
  const back = await app.preparePairing(d1.link, { source: 'link' });
  const before = app.sendLink('https://example.com/before-switch');
  await app.applyPairing(back.next, { expect: back.current.code });
  await before;
  assert.deepEqual(await app.rows(), []);
  assert.deepEqual((await d2.receiver.pollOnce()).items.map((i) => i.header.url), ['https://example.com/before-switch']);
  assert.deepEqual((await d1.receiver.pollOnce()).items, []);

  // Retry now and Remove look the row up in the outbox in use when they run.
  const unpairing = app.unpair();
  await assert.rejects(app.retry(row.id), (e) => e.code === 'pairing');
  assert.equal(await app.remove(row.id), false);
  await unpairing;
});

test('a tick queued behind a move to another relay re-sends through the new relay', async () => {
  const relay2 = await startMockRelay();
  try {
    let clock = Date.now();
    const d = await daylight('Desk');
    const { app } = newApp({ extra: { now: () => clock } });
    await app.pair(d.link);
    const pending = await app.sendFile({ name: 'pending.txt', bytes: ds.utf8('not picked up yet') });
    await d.receiver.pollOnce(); // the first copy is picked up, but no ack is read yet
    const r2 = new ds.Receiver({ pairing: { secret: d.secret, relay: relay2.url }, storage: new ds.MemoryStorage() });
    clock += 12 * 3600000; // the re-send is due
    const moved = await ds.pairingLink({ secret: d.secret, relay: relay2.url, name: 'Desk' });
    const pre = await app.preparePairing(moved, { source: 'link' });
    const applying = app.applyPairing(pre.next, { expect: pre.current.code });
    const ticking = app.tick();
    await applying;
    assert.deepEqual(await ticking, { delivered: 0, resent: 1 });
    assert.deepEqual((await r2.pollOnce()).items.map((i) => i.header.id), [pending.id], 'the re-send went through the new relay');
    assert.deepEqual((await d.receiver.pollOnce()).items, [], 'and not through the old one');
  } finally {
    await relay2.close();
  }
});

test('vectors > pairingConfirmation: the app asks exactly as the protocol says, for links and typed codes', async () => {
  const fs = await import('node:fs');
  const V = JSON.parse(fs.readFileSync(new URL('../../../share/vectors/test-vectors.json', import.meta.url), 'utf8'));
  assert.ok(V.pairingConfirmation.length >= 10);
  for (const c of V.pairingConfirmation) {
    const { app, storage } = newApp();
    if (c.current) await ds.savePairing(storage, { secret: ds.fromHex(c.current.secretHex), relay: c.current.relay, name: c.current.name });
    const secret = ds.fromHex(c.next.secretHex);
    const input = c.source === 'link'
      ? await ds.pairingLink({ secret, relay: c.next.relay, name: c.next.name })
      : await ds.formatCode(secret);
    const pre = await app.preparePairing(input, { source: c.source, relay: c.source === 'app' ? c.next.relay : undefined });
    assert.deepEqual(pre.confirm, c.expect, c.name);
  }
});

test('timers: tick on start, every 15 minutes, right after a send and ~30 s later', async () => {
  const d = await daylight();
  const timers = fakeTimers();
  const { app } = newApp({ timers });
  await app.pair(d.link);
  app.start();
  assert.equal(timers.intervals.length, 1);
  assert.equal(timers.intervals[0].ms, 15 * 60 * 1000);
  await app.sendLink('https://example.com/t');
  assert.equal(timers.timeouts.length, 1);
  assert.equal(timers.timeouts[0].ms, 30 * 1000);
  await app.sendLink('https://example.com/u');
  assert.equal(timers.timeouts.length, 1, 'one pending "soon" check, not one per send');
  await d.receiver.pollOnce(); // the Daylight picks both up and acks
  await settle();
  timers.timeouts[0].fn(); // ~30 s later
  for (let i = 0; i < 40 && (await app.rows()).some((r) => r.status !== 'delivered'); i++) await settle();
  assert.deepEqual((await app.rows()).map((r) => r.status), ['delivered', 'delivered']);
  app.stop();
  assert.equal(timers.intervals.length, 0);
});

test('tick stays off the relay with nothing to wait for; the local pass still drops an expired item’s copy after 14 days', async () => {
  let clock = Date.now();
  const d = await daylight();
  const { app, storage } = newApp({ extra: { now: () => clock } });
  await app.pair(d.link);
  let before = relay.state.requests.length;
  assert.deepEqual(await app.tick(), { delivered: 0, resent: 0 });
  assert.equal(relay.state.requests.length, before, 'an empty outbox makes no request');

  // A file the Daylight never picks up: Not delivered after a week, its copy kept for Try again until day 14
  // (CHANGES-v1.1 2.4, CONTENT_KEEP), whether or not anything else is waiting.
  const t0 = clock;
  const row = await app.sendFile({ name: 'never.txt', bytes: ds.utf8('never picked up') });
  await app.tick(); // after the ticks a send starts, at the time of the send
  clock = t0 + 7 * 86400000 + 60000;
  await app.tick();
  const expired = (await app.rows())[0];
  assert.deepEqual([expired.status, expired.errorCode], ['expired', '']);
  assert.ok(await storage.get(`outbox/${row.id}`), 'kept for Try again');
  clock = t0 + 10 * 86400000;
  await app.tick();
  assert.ok(await storage.get(`outbox/${row.id}`), 'still kept on day 10');
  clock = t0 + 37 * 86400000;
  before = relay.state.requests.length;
  assert.deepEqual(await app.tick(), { delivered: 0, resent: 0 });
  assert.equal(await storage.get(`outbox/${row.id}`), undefined, 'dropped: more than 14 days after the share');
  assert.equal(relay.state.requests.length, before, 'past the ack window (15 days) nothing reads the relay');
  assert.equal((await app.rows())[0].status, 'expired');

  // A delivered row alone never reads the relay either.
  const { app: app2 } = newApp({ extra: { now: () => clock } });
  await app2.pair(d.link);
  await app2.sendLink('https://example.com/delivered-only');
  await d.receiver.pollOnce();
  assert.equal((await app2.tick()).delivered, 1);
  before = relay.state.requests.length;
  await app2.tick();
  assert.equal(relay.state.requests.length, before);
});

test('an expired link is marked delivered when the Daylight comes back and acks the last re-send', async () => {
  let clock = Date.now();
  const timed = await startMockRelay({ now: () => clock });
  try {
    const d = await daylight('Late', timed.url);
    const { app } = newApp({ extra: { now: () => clock } });
    await app.pair(d.link);
    const t0 = clock;
    const row = await app.sendLink('https://example.com/late', 'Late');
    await app.tick(); // after the ticks a send starts, at the time of the send
    clock = t0 + 7 * 86400000 - 30 * 60000;
    assert.equal((await app.tick()).resent, 1, 'the last re-send, half an hour before the week is up');
    clock = t0 + 7 * 86400000 + 60000;
    await app.tick();
    assert.equal((await app.rows())[0].status, 'expired');
    assert.equal(L.rowView((await app.rows())[0], clock).retryLabel, 'Try again');
    // The Daylight comes online, finds the re-send still on the relay and acks it.
    clock += 3600000;
    const got = (await d.receiver.pollOnce()).items;
    assert.deepEqual(got.map((i) => i.header.id), [row.id]);
    assert.equal((await app.tick()).delivered, 1);
    const done = (await app.rows())[0];
    assert.equal(done.status, 'delivered');
    assert.deepEqual([L.rowView(done, clock).label, L.rowView(done, clock).action], ['Delivered ✓', null]);
  } finally {
    await timed.close();
  }
});

test('wantsAcks: a row that isn’t delivered and was shared less than 15 days ago', () => {
  const now = Date.now();
  const day = 86400000;
  assert.equal(L.ACK_WINDOW_MS, 15 * day);
  assert.equal(L.wantsAcks([], now), false);
  assert.equal(L.wantsAcks([{ status: 'delivered', created: now }], now), false);
  assert.equal(L.wantsAcks([{ status: 'sent', created: now - day }], now), true);
  assert.equal(L.wantsAcks([{ status: 'expired', created: now - 14 * day }], now), true);
  assert.equal(L.wantsAcks([{ status: 'expired', created: now - 15 * day }], now), false);
  assert.equal(L.wantsAcks([{ status: 'failed', created: now - 16 * day }, { status: 'expired', created: now - 2 * day }], now), true);
});

test('a relay that can’t be reached: Waiting to send with Retry now, in the module’s words; Retry now sends the same item', async () => {
  const d = await daylight();
  let busy = true;
  const fetch = (url, init) => (busy && init?.method !== 'GET' ? Promise.resolve(new Response('{}', { status: 429 })) : globalThis.fetch(url, init));
  const { app, bridge } = newApp({ extra: { fetch }, bridge: fakeBridge({ 'C:\\a.txt': ds.utf8('busy relay') }) });
  await app.pair(d.link);
  const row = await app.sendLink('https://example.com/offline');
  assert.deepEqual([row.status, row.errorCode], ['failed', 'network']);
  assert.deepEqual(L.rowView(row), {
    label: 'Waiting to send', tone: 'busy', sentence: 'Couldn’t send right now. It will try again by itself.',
    action: 'retry-now', retry: true, retryLabel: 'Retry now',
  });
  await app.handleAction({ type: 'files', paths: ['C:\\a.txt'] });
  assert.deepEqual(bridge.notes.at(-1), { title: 'a', body: 'Waiting to send. Couldn’t send right now. It will try again by itself.' });
  busy = false;
  const again = await app.retry(row.id);
  assert.equal(again.id, row.id);
  assert.equal(again.status, 'sent');
  const items = (await d.receiver.pollOnce()).items;
  assert.ok(items.some((i) => i.header.id === row.id));
  await app.tick();
  assert.equal((await app.rows()).find((r) => r.id === row.id).status, 'delivered');
});

test('a full relay (413): Waiting to send for about 3 hours; the third time Not delivered with Try again', async () => {
  let clock = Date.now();
  let full = true;
  const fetch = (url, init) => (full && init?.method === 'PUT'
    ? Promise.resolve(new Response('{"code":41301,"http":413,"error":"too large"}', { status: 413 }))
    : globalThis.fetch(url, init));
  const d = await daylight('Small');
  const { app } = newApp({ extra: { fetch, now: () => clock } });
  await app.pair(d.link);
  const row = await app.sendFile({ name: 'scan.pdf', bytes: ds.randomBytes(2_500_000) });
  assert.deepEqual([row.status, row.errorCode], ['failed', 'full']);
  assert.deepEqual(L.rowView(row, clock), {
    label: 'Waiting to send', tone: 'busy', action: null, retry: false, retryLabel: '',
    sentence: 'A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.',
  });
  const ok = await app.sendFile({ name: 'small.txt', bytes: ds.utf8('a small note') });
  assert.equal(ok.status, 'sent', 'a small file still goes (a message, not an attachment)');
  for (let i = 0; i < 2; i++) { clock += 185 * 60000; await app.tick(); }
  const ended = (await app.rows()).find((r) => r.id === row.id);
  assert.deepEqual([ended.status, ended.errorCode, ended.slowFails], ['expired', 'full', 3]);
  const v = L.rowView(ended, clock);
  assert.deepEqual([v.label, v.retryLabel, v.sentence], ['Not delivered', 'Try again', 'Too much was sent from this network for hours, so it stopped trying. Try again later.']);
  full = false;
  const tried = await app.retry(row.id);
  assert.equal(tried.id, row.id);
  assert.equal(tried.status, 'sent', 'Try again sends the same item');
});

test('Remove drops a row and its stored content', async () => {
  const d = await daylight();
  const { app, storage } = newApp();
  await app.pair(d.link);
  const row = await app.sendFile({ name: 'x.txt', bytes: ds.utf8('remove me') });
  assert.ok(await storage.get(`outbox/${row.id}`));
  assert.equal(await app.remove(row.id), true);
  assert.deepEqual(await app.rows(), []);
  assert.equal(await storage.get(`outbox/${row.id}`), undefined);
  assert.equal(await app.remove(row.id), false);
});

test('a re-send copy that can’t be stored: the item is still sent once', async () => {
  const d = await daylight();
  const base = new ds.MemoryStorage();
  const storage = { get: (k) => base.get(k), remove: (k) => base.remove(k), async set(k, v) { if (k.startsWith('outbox/')) throw new Error('disk full'); return base.set(k, v); } };
  const { app } = newApp({ storage });
  await app.pair(d.link);
  const row = await app.sendFile({ name: 'x.txt', bytes: ds.utf8('sent once') });
  assert.equal(row.status, 'sent');
  assert.equal((await d.receiver.pollOnce()).items[0].header.id, row.id);
});

test('watchedStorage reports outbox, pairing and settings changes only', async () => {
  const seen = [];
  const s = core.watchedStorage(new ds.MemoryStorage(), (k) => seen.push(k));
  await s.set('outbox', []);
  await s.set('outbox/abc', 'x');
  await s.set('settings', { hotkey: '' });
  await s.remove('pairing');
  await s.set('ackSince', 1);
  assert.deepEqual(seen, ['outbox', 'settings', 'pairing']);
  assert.deepEqual(await s.get('settings'), { hotkey: '' });
});

test('settings persist', async () => {
  const { app } = newApp();
  assert.deepEqual(await app.getSettings(), {});
  await app.setSettings({ hotkey: 'Ctrl+Shift+F9' });
  assert.deepEqual(await app.getSettings(), { hotkey: 'Ctrl+Shift+F9' });
});

test('Comfort is a setting of its own: writes at once keep each other, and pairing changes leave it as it was (F27)', async () => {
  const d1 = await daylight('One');
  const d2 = await daylight('Two');
  const { app } = newApp();
  // The hotkey recorder and the Comfort switch can save at the same moment; neither write is lost.
  const [a, b] = await Promise.all([app.setSettings({ comfort: true }), app.setSettings({ hotkey: 'Ctrl+Alt+F8' })]);
  assert.deepEqual(a, { comfort: true });
  assert.deepEqual(b, { comfort: true, hotkey: 'Ctrl+Alt+F8' });
  assert.deepEqual(await app.getSettings(), { comfort: true, hotkey: 'Ctrl+Alt+F8' });
  await app.pair(d1.link);
  const pre = await app.preparePairing(d2.link, { source: 'link' });
  await app.applyPairing(pre.next, { expect: pre.current.code });
  await app.unpair();
  assert.deepEqual(await app.getSettings(), { comfort: true, hotkey: 'Ctrl+Alt+F8' }, 'pairing, Switch and Unpair keep it');
});
