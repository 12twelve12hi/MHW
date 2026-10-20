// core.js against the mock relay, with a Receiver from daylight-share.js playing the Daylight and a fake bridge in
// place of Rust: pairing, Send To paths, the clipboard link, acks, retries, the waiting queue and the timers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../helpers/built.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const ds = await load('daylight-share.js');
const core = await load('core.js');
const L = await load('logic.js');

/** What the history shows under a row: the protocol library's words (v1.1) or the relay's reason (v1.0). */
const reason = (row) => (L.libraryWords() ? ds.describeRow(row).sentence : row.error);

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

  assert.deepEqual(await app.state(), { paired: false, name: '', relay: '', defaultRelay: true });
  const r = await app.pair(d.link);
  assert.deepEqual(r, { name: 'Desk Daylight', relay: relay.url });
  assert.ok(changes.includes('pairing'));
  const s = await app.state();
  assert.equal(s.paired, true);
  assert.equal(s.defaultRelay, false);

  const files = await app.handleAction({ type: 'files', paths: ['C:\\Docs\\Quiet paper – draft.pdf', 'C:\\Docs\\notes.txt'] });
  assert.equal(files.length, 2);
  assert.ok(files.every((f) => f.row?.status === 'sent'), JSON.stringify(files));
  assert.deepEqual(bridge.notes.at(-1), { title: 'Sent 2 items', body: 'On their way to your Daylight.' });

  const clip = await app.handleAction({ type: 'clipboard', text: 'see https://www.example.com/story?id=7 now', error: '' });
  assert.equal(clip[0].row.url, 'https://www.example.com/story?id=7');
  assert.deepEqual(bridge.notes.at(-1), { title: 'Sent example.com', body: 'On its way to your Daylight.' });

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

test('a 3 MB file arrives intact through the relay’s attachment limit', async () => {
  const d = await daylight();
  const { app } = newApp();
  await app.pair(d.link);
  const bytes = ds.randomBytes(3 * 1024 * 1024);
  const row = await app.sendFile({ name: 'scan.pdf', bytes });
  assert.equal(row.status, 'sent', row.error);
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

test('checkLink: pair, same, or ask before switching; switching discards the old outbox', async () => {
  const d1 = await daylight('First');
  const d2 = await daylight('Second');
  const { app, storage } = newApp();
  assert.equal((await app.checkLink(d1.link)).action, 'pair');
  await app.pair(d1.link);
  assert.deepEqual(await app.checkLink(d1.link), { action: 'same', name: 'First', current: 'First' });
  assert.deepEqual(await app.checkLink(d2.link), { action: 'switch', name: 'Second', current: 'First' });
  await assert.rejects(app.checkLink('daylightshare://pair?c=NOPE'), (e) => e.code === 'code');

  const row = await app.sendFile({ name: 'x.txt', bytes: ds.utf8('for the first Daylight') });
  assert.ok(await storage.get(`outbox/${row.id}`));
  await app.pair(d2.link);
  assert.deepEqual(await app.rows(), []);
  assert.equal(await storage.get(`outbox/${row.id}`), undefined);
  assert.equal((await app.state()).name, 'Second');

  await app.unpair();
  assert.equal((await app.state()).paired, false);
  await assert.rejects(app.sendLink('https://example.com/'), (e) => e.code === 'pairing');
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

test('tick skips the relay when nothing is waiting', async () => {
  const d = await daylight();
  const { app } = newApp();
  await app.pair(d.link);
  const before = relay.state.requests.length;
  assert.deepEqual(await app.tick(), { delivered: 0, resent: 0 });
  assert.equal(relay.state.requests.length, before);
});

test('relay trouble: the row says why, in the module’s words; Retry sends the same item', async () => {
  const d = await daylight();
  let refuse = true;
  const fetch = (url, init) => (refuse && init?.method !== 'GET' ? Promise.resolve(new Response('{}', { status: 400 })) : globalThis.fetch(url, init));
  const { app } = newApp({ extra: { fetch } });
  await app.pair(d.link);
  const row = await app.sendLink('https://example.com/offline');
  assert.equal(row.status, 'failed');
  assert.ok(row.error, 'the module recorded what went wrong');
  const v = L.rowView(row);
  assert.ok(v.sentence);
  assert.equal(v.sentence, reason(row));
  if (!L.libraryWords()) {
    assert.equal(v.label, 'Not delivered');
    assert.equal(v.retry, true);
  }
  refuse = false;
  const again = await app.retry(row.id);
  assert.equal(again.id, row.id);
  assert.equal(again.status, 'sent');
  const items = (await d.receiver.pollOnce()).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].header.id, row.id);
  await app.tick();
  assert.equal((await app.rows())[0].status, 'delivered');
});

test('a file the relay refuses as too large shows the module’s message; Retry re-sends the same item', async () => {
  // ntfy.sh answers 413 to attachments over 2 MB (share/NTFY-FACTS.md); this relay refuses any frame over 1.5 MB.
  const LIMIT = 1.5 * 1024 * 1024;
  const fetch = (url, init) => (init?.method === 'PUT' && init.body.length > LIMIT
    ? Promise.resolve(new Response('{"code":41301,"http":413,"error":"too large"}', { status: 413 }))
    : globalThis.fetch(url, init));
  const d = await daylight('Small');
  const { app } = newApp({ extra: { fetch } });
  await app.pair(d.link);
  const row = await app.sendFile({ name: 'scan.pdf', bytes: ds.randomBytes(2 * 1024 * 1024 + 50_000) });
  assert.equal(row.status, 'failed');
  const shown = (await app.rows())[0];
  assert.equal(L.rowView(shown).sentence, reason(shown));
  if (!L.libraryWords()) assert.equal(L.rowView(shown).sentence, 'The relay refused the file as too large.');

  const ok = await app.sendFile({ name: 'small.pdf', bytes: ds.randomBytes(100_000) });
  assert.equal(ok.status, 'sent');
  const again = await app.retry(row.id);
  assert.equal(again.id, row.id);
  assert.equal(again.status, 'failed');
  assert.equal(again.attempts, 2);
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
