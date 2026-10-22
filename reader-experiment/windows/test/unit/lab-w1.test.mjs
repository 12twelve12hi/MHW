// Lab's Wave 1 on Windows (LAB-PLAN 3.3; card WIN1) in node: the built core.js and lab.js against the mock relay, with
// Daylights from daylight-share.js (a v1.1 Receiver) and daylight-lab.js (LabInboxSim, a Lab Daylight):
//
//   F01  the timeline's words for each row (describeLabRow), the check-in header, reading the ack topic after delivery
//        while a row waits for its state, the faster checks while the window shows, the toast's hook (onReader);
//   F02  the entry point's gate (needs-server, later);
//   F07  sending while Windows is offline (deferred: Waiting for connection), the flush when it is back online, passes
//        at least 3 minutes apart and within the caps;
//   F08  "Sent to {name}" on the notifications;
//   F09  daylightshare://send links: Lab off, not paired, not a web address, the question, quick sends and their limit;
//   F16  smart intake at every entry point (the clipboard, a dropped text, a .url file, a send link), its Use switch,
//        x-orig on the wire, and v1.1 exactly with Lab off;
//   F26  the test article, the activity log, diagnostics (redacted) and the checks' lines;
//   F33  the copied link prepared without sending (the window's question), the hotkey's toast naming the host;
//   6.5 Q5  the Use switches.
//
//   node --test test/unit/lab-w1.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../helpers/built.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const ds = await load('daylight-share.js');
const core = await load('core.js');
const labMod = await load('lab.js');
const L = await load('daylight-lab.js');
const { LAB_TEXT } = L;
const quiet = { warn() {}, log() {} };
const MIN = 60000;

let relay;
before(async () => { relay = await startMockRelay(); });
after(async () => { await relay?.close(); });

function fakeTimers() {
  const t = { timeouts: [], intervals: [] };
  t.setTimeout = (fn, ms) => { const h = { fn, ms }; t.timeouts.push(h); return h; };
  t.clearTimeout = (h) => { t.timeouts = t.timeouts.filter((x) => x !== h); };
  t.setInterval = (fn, ms) => { const h = { fn, ms }; t.intervals.push(h); return h; };
  t.clearInterval = (h) => { t.intervals = t.intervals.filter((x) => x !== h); };
  /** Runs the timeouts set for `ms` (and takes them off the list). */
  t.run = async (ms) => {
    const due = t.timeouts.filter((h) => h.ms === ms);
    t.timeouts = t.timeouts.filter((h) => h.ms !== ms);
    for (const h of due) await h.fn();
    return due.length;
  };
  return t;
}

function fakeBridge(files = {}) {
  const b = { notes: [], shown: 0 };
  b.notify = async (title, body) => { b.notes.push({ title, body }); };
  b.showWindow = async () => { b.shown++; };
  b.readFile = async (p) => {
    if (!(p in files)) throw new Error('Couldn’t open it (not found).');
    return files[p];
  };
  return b;
}

/**
 * An app paired with a Daylight on the mock relay. opts: online (a function), now, settings (merged in before the app
 * starts), lab (a Lab Daylight: LabInboxSim, its states by stateFor), files (Send To's).
 */
async function setup({ online = () => true, now = () => Date.now(), settings = {}, lab = false, stateFor = undefined, files = {}, name = 'Desk Daylight' } = {}) {
  const storage = new ds.MemoryStorage();
  if (Object.keys(settings).length) await storage.set('settings', settings);
  const bridge = fakeBridge(files);
  const timers = fakeTimers();
  const readers = [];
  const app = core.createApp({
    bridge, storage, timers, version: '1.2.0', log: quiet, now, online: () => online(), onReader: (row) => readers.push(row.id),
  });
  await app.lab.ensureDefault();
  const secret = ds.generateSecret();
  const pairing = { secret, relay: relay.url };
  await app.pair(await ds.pairingLink({ secret, relay: relay.url, name }));
  const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage(), from: 'Daylight' });
  let day = null;
  if (lab) {
    let skew = 0;
    const labInbox = new L.LabInbox({
      storage: new ds.MemoryStorage(), relay: new ds.RelayClient({ relay: relay.url }), keys: await ds.deriveKeys(secret),
      info: () => ({ lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'], live: false }), from: 'Daylight',
      now: () => Date.now() + skew, autoFlushMs: null,
    });
    const sim = new L.LabInboxSim({ receiver, labInbox, stateFor });
    day = {
      labInbox,
      /** One poll: acks first, then the states, past the 30 s between Lab frames. */
      pollOnce: () => { skew += MIN; return sim.pollOnce(); },
      /** A state the Daylight reports later (a tap, the Reader's answer), published now. */
      async report(id, s) { skew += MIN; await labInbox.record(id, s, Math.floor((Date.now() + skew) / 1000)); return labInbox.flush(); },
    };
  }
  return { app, lab: app.lab, storage, bridge, timers, readers, secret, pairing, receiver, day, get: (k) => storage.get(k) };
}

const labelOf = async (app, id) => (await app.snapshot()).rows.find((r) => r.id === id)?.labRow;

// --- F16 smart intake ---------------------------------------------------------------------------------------------------

test('F16: with Lab on, every entry point cleans the link, takes a headline as its title and sends the original as x-orig', async () => {
  const s = await setup({ files: { 'C:\\Links\\Story.url': ds.utf8('[InternetShortcut]\r\nURL=https://www.example.com/a?utm_source=x&id=3\r\n') } });
  try {
    // The clipboard (hotkey, tray): "headline + link" stays a link, with the headline as its title (LAB-DECISIONS Q1).
    const clip = await s.app.sendClipboard({ text: 'Quiet reading on e-paper https://example.com/story?utm_source=news&id=7&fbclid=abc' });
    assert.deepEqual([clip[0].row.url, clip[0].row.title], ['https://example.com/story?id=7', 'Quiet reading on e-paper']);
    assert.deepEqual(clip[0].row.extras, { 'x-orig': 'https://example.com/story?utm_source=news&id=7&fbclid=abc' });
    // A dropped text, and a dropped address with its link text as the title.
    const dropped = await s.app.sendLink('', '', { text: 'Opinion | Why paper https://nyti.ms/abc?smid=tw-share' });
    assert.deepEqual([dropped.url, dropped.title], ['https://nyti.ms/abc?smid=tw-share', 'Opinion | Why paper'], 'smid goes only on nytimes.com');
    const amp = await s.app.sendLink('https://www.google.com/amp/s/example.org/news/1.amp', 'A story');
    assert.deepEqual([amp.url, amp.title, amp.extras?.['x-orig']], ['https://example.org/news/1.amp', 'A story', 'https://www.google.com/amp/s/example.org/news/1.amp']);
    // An Internet Shortcut (.url) from Send To.
    const [file] = await s.app.sendPaths(['C:\\Links\\Story.url']);
    assert.deepEqual([file.row.kind, file.row.url, file.row.title], ['url', 'https://www.example.com/a?id=3', 'Story']);
    // A plain address is sent as it is, with no x-orig.
    const plain = await s.app.sendLink('https://example.com/plain?b=2&a=1#frag');
    assert.deepEqual([plain.url, plain.extras], ['https://example.com/plain?b=2&a=1#frag', undefined]);
    // On the wire: the Daylight gets the cleaned URL, and x-orig among the item's extras (2.3).
    const { items } = await s.receiver.pollOnce();
    const got = items.find((i) => i.header.id === clip[0].row.id);
    assert.equal(got.header.url, 'https://example.com/story?id=7');
    assert.equal(got.header.title, 'Quiet reading on e-paper');
    assert.deepEqual(got.extras, { 'x-orig': 'https://example.com/story?utm_source=news&id=7&fbclid=abc' });
    assert.deepEqual(items.find((i) => i.header.id === plain.id).extras, {});
  } finally { s.app.stop(); }
});

test('F16’s Use switch off: links go exactly as shared (no x-orig); Lab off: v1.1 exactly (the first address, no title from the text)', async () => {
  const s = await setup();
  try {
    assert.equal(await s.lab.setUse('F16', false), false);
    assert.equal(await s.lab.useOn('F16'), false);
    const r = await s.app.sendClipboard({ text: 'Quiet reading https://example.com/story?utm_source=news&id=7' });
    assert.deepEqual([r[0].row.url, r[0].row.title, r[0].row.extras], ['https://example.com/story?utm_source=news&id=7', 'Quiet reading', undefined]);
    await s.lab.setLab(false);
    assert.equal(await s.lab.useOn('F16'), false, 'Lab off: no Lab feature is in use');
    await s.lab.setUse('F16', true);
    const v11 = await s.app.sendClipboard({ text: 'Quiet reading https://example.com/story?utm_source=news&id=7' });
    assert.deepEqual([v11[0].row.url, v11[0].row.title, v11[0].row.extras], ['https://example.com/story?utm_source=news&id=7', '', undefined]);
    const { items } = await s.receiver.pollOnce();
    assert.ok(items.every((i) => !i.extras?.['x-orig']), 'no x-orig with Lab off or F16 off');
    await assert.rejects(s.lab.setUse('F07', false), /no Use switch/);
  } finally { s.app.stop(); }
});

// --- F07 the offline outbox ------------------------------------------------------------------------------------------------

test('F07: shared while Windows is offline, an item waits for a connection (nothing published), then goes when it is back', async () => {
  let online = false;
  let clock = Date.now();
  const s = await setup({ online: () => online, now: () => clock });
  try {
    const before = relay.state.published;
    const row = await s.app.sendLink('https://example.com/offline', 'Offline');
    assert.deepEqual([row.status, row.errorCode, row.attempts], ['failed', 'network', 0]);
    assert.equal(relay.state.published, before, 'nothing was published');
    assert.deepEqual(await labelOf(s.app, row.id), { label: 'Waiting for connection', sentence: 'It will send when this device is back online.', action: null, stepLine: 'Sent … · On your Daylight · In the Reader', final: false });
    // The window and the notification say so, not Not delivered (F07.1).
    const said = await s.app.summary([{ row }]);
    assert.equal(said.body, 'Waiting for connection. It will send when this device is back online.');
    const queued = (await s.lab.activity()).at(-1);
    assert.deepEqual([queued.type, queued.id8, queued.status], ['queue', row.id.slice(0, 8), 'failed/network']);
    // Still offline: no flush.
    assert.deepEqual(await s.app.onOnline(), []);
    online = true;
    const sent = await s.app.onOnline();
    assert.deepEqual(sent.map((r) => [r.id, r.status]), [[row.id, 'sent']]);
    assert.deepEqual((await s.receiver.pollOnce()).items.map((i) => i.header.url), ['https://example.com/offline']);
    // Another pass within 3 minutes waits for the rest of the 3 minutes (FLUSH_GAP_MS).
    online = false;
    const two = await s.app.sendLink('https://example.com/offline-2');
    online = true;
    clock += MIN;
    assert.deepEqual(await s.app.onOnline(), [], 'too soon');
    const later = s.timers.timeouts.find((h) => h.ms === core.FLUSH_GAP_MS - MIN);
    assert.ok(later, 'the next pass is set for 3 minutes after the last');
    clock += 2 * MIN;
    await s.timers.run(core.FLUSH_GAP_MS - MIN);
    assert.equal((await s.app.rows()).find((r) => r.id === two.id).status, 'sent');
  } finally { s.app.stop(); }
});

test('F07.3 on Windows: 70 links queued offline go out in passes of at most 30 frames, 3 minutes apart, oldest first, with no 429', async () => {
  let online = false;
  let clock = Date.now();
  const s = await setup({ online: () => online, now: () => clock });
  try {
    const rows = [];
    for (let i = 0; i < 70; i++) { clock += 1; rows.push(await s.app.sendLink(`https://example.com/queued/${i}`)); }
    const published = () => relay.state.publishLog.length;
    const at = published();
    online = true;
    const first = await s.app.onOnline();
    assert.equal(first.length, 30, 'the first pass stops at 30 frames');
    assert.deepEqual(first.map((r) => r.url), rows.slice(0, 30).map((r) => r.url), 'oldest first');
    assert.equal(published() - at, 30);
    assert.ok(s.timers.timeouts.some((h) => h.ms === core.FLUSH_GAP_MS), 'the next pass in 3 minutes');
    clock += core.FLUSH_GAP_MS;
    await s.timers.run(core.FLUSH_GAP_MS);
    clock += core.FLUSH_GAP_MS;
    await s.timers.run(core.FLUSH_GAP_MS);
    assert.equal(published() - at, 70);
    assert.ok((await s.app.rows()).every((r) => r.status === 'sent'));
    assert.equal(s.timers.timeouts.filter((h) => h.ms === core.FLUSH_GAP_MS).length, 0, 'nothing left: no more passes');
    assert.deepEqual(relay.state.limited, []);
  } finally { s.app.stop(); }
});

test('F07 with Lab off: an offline PC tries as v1.1 does (no deferring, no flush); the queue keeps v1.1’s rows', async () => {
  const s = await setup({ online: () => false, settings: { lab: false } });
  try {
    const row = await s.app.sendLink('https://example.com/v11');
    assert.equal(row.status, 'sent', 'v1.1 publishes whatever Windows says (the relay is reachable here)');
    assert.deepEqual(await s.app.onOnline(), []);
    assert.equal((await s.app.snapshot()).rows[0].labRow, null, 'no timeline words with Lab off');
    assert.equal(labMod.isQueued({ status: 'failed' }), true);
    assert.equal(labMod.isQueued({ status: 'sent' }), false);
  } finally { s.app.stop(); }
});

// --- F01 the timeline -----------------------------------------------------------------------------------------------------

test('F01: a Lab Daylight’s states make the rows’ words, In your Reader ✓ among them; a v1.1 Daylight’s rows stay Delivered ✓', async () => {
  const s = await setup({ lab: true });
  try {
    const link = await s.app.sendLink('https://example.com/read', 'Read');
    const file = await s.app.sendFile({ name: 'Paper.pdf', bytes: ds.utf8('%PDF-1.4\n') });
    assert.deepEqual((await labelOf(s.app, link.id)).stepLine, 'Sent ✓ · On your Daylight … · In the Reader');
    await s.day.pollOnce(); // acks first, then reader (the link) and handed (the file)
    await s.app.tick();
    const rows = (await s.app.snapshot()).rows;
    const linkRow = rows.find((r) => r.id === link.id);
    const fileRow = rows.find((r) => r.id === file.id);
    assert.deepEqual([linkRow.label, linkRow.labRow.label, linkRow.labRow.final], ['Delivered ✓', 'In your Reader ✓', true], 'v1.1’s words stay in label');
    assert.deepEqual(fileRow.labRow, { label: 'Handed to the Reader', sentence: LAB_TEXT.rows.handedFile.sentence, action: null, stepLine: 'Sent ✓ · On your Daylight ✓ · Handed to the Reader', final: true });
    assert.deepEqual(s.readers, [link.id], 'the toast’s hook: the link is in the Reader now (once)');
    await s.app.tick();
    assert.deepEqual(s.readers, [link.id], 'not again');
    // The check-in header (2.5).
    assert.equal((await s.lab.timeline()).checkedInText, 'Your Daylight checked in just now.');
    assert.equal((await s.app.snapshot()).checkedInText, 'Your Daylight checked in just now.');

    // A v1.1 Daylight (no hello): rule 4, the rows read as v1.1’s, with no step line.
    const v = await setup();
    try {
      const r = await v.app.sendLink('https://example.com/v11', 'v1.1');
      await v.receiver.pollOnce();
      await v.app.tick();
      assert.deepEqual(await labelOf(v.app, r.id), { label: 'Delivered ✓', sentence: 'Saved on your Daylight.', action: null, stepLine: null, final: false });
      assert.deepEqual(v.readers, []);
      assert.equal((await v.lab.gate('F01')).state, 'needs-inbox', 'What’s in Lab: Needs Lab on your Daylight');
    } finally { v.app.stop(); }
    assert.equal((await s.lab.gate('F01')).state, 'ready');
  } finally { s.app.stop(); }
});

test('F01: after delivery the app keeps reading the ack topic while a row waits for its state (Waiting for a tap, then Handed), and only then', async () => {
  let clock = Date.now();
  const s = await setup({ lab: true, stateFor: (h) => (h.kind === 'file' ? 'waiting' : 'reader'), now: () => clock });
  try {
    const file = await s.app.sendFile({ name: 'Ask.pdf', bytes: ds.utf8('%PDF-1.4\n') });
    await s.day.pollOnce();
    await s.app.tick();
    assert.equal((await labelOf(s.app, file.id)).label, 'Waiting for a tap on your Daylight');
    // The tap comes later. The 15-minute tick reads the ack topic though every row is delivered: one waits for a state.
    await s.day.report(file.id, 'handed');
    const polls = () => relay.state.requests.filter((r) => /\/json/.test(r)).length;
    let at = polls();
    clock += 15 * MIN;
    await s.app.tick();
    assert.ok(polls() > at, 'it read the ack topic');
    assert.equal((await labelOf(s.app, file.id)).label, 'Handed to the Reader');
    // Settled: the next ticks stay off the relay, as v1.1’s do.
    at = polls();
    clock += 15 * MIN;
    await s.app.tick();
    assert.equal(polls(), at, 'nothing to wait for: no poll');
  } finally { s.app.stop(); }
});

test('F01’s faster checks (2.5): every 30 s while the window shows and a delivered row of the last 10 minutes waits; none while hidden', async () => {
  let clock = Date.now();
  const s = await setup({ lab: true, stateFor: () => 'waiting', now: () => clock });
  try {
    const link = await s.app.sendLink('https://example.com/tap');
    await s.day.pollOnce();
    await s.app.tick();
    assert.equal((await labelOf(s.app, link.id)).label, 'Waiting for a tap on your Daylight');
    // The send's own check ~30 s later (SOON_MS, v1.1) has the same delay: leave it out.
    s.timers.timeouts = [];
    const fast = () => s.timers.timeouts.filter((h) => h.ms === L.FAST_CHECK_MS).length;
    await s.app.tick();
    assert.equal(fast(), 0, 'hidden: no faster checks');
    s.app.setVisible(true);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(fast(), 1, 'shown: a check in 30 s');
    s.app.setVisible(false);
    assert.equal(fast(), 0, 'hidden again: cancelled');
    s.app.setVisible(true);
    await new Promise((r) => setTimeout(r, 30));
    await s.day.report(link.id, 'reader');
    await s.timers.run(L.FAST_CHECK_MS);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await labelOf(s.app, link.id)).label, 'In your Reader ✓');
    assert.equal(fast(), 0, 'settled: no more');
    // Ten minutes after delivery the faster checks end anyway.
    clock += 11 * MIN;
    assert.equal(labMod.wantsFaster(await s.app.rows(), { lab: true, inboxLab: true, states: {} }, clock), false);
  } finally { s.app.stop(); }
});

// --- F08 and F33: the notifications -----------------------------------------------------------------------------------------

test('F08 and F33: with Lab on, a notification names the Daylight ("Sent to {name}"); the hotkey’s names the host', async () => {
  const s = await setup({ files: { 'C:\\Docs\\Paper.pdf': ds.utf8('%PDF-1.4\n'), 'C:\\Docs\\notes.txt': ds.utf8('notes') } });
  try {
    await s.app.handleAction({ type: 'files', paths: ['C:\\Docs\\Paper.pdf'] });
    assert.deepEqual(s.bridge.notes.at(-1), { title: 'Sent to Desk Daylight', body: 'Paper: Sent · waiting for your Daylight.' });
    await s.app.handleAction({ type: 'files', paths: ['C:\\Docs\\Paper.pdf', 'C:\\Docs\\notes.txt'] });
    assert.deepEqual(s.bridge.notes.at(-1), { title: 'Sent to Desk Daylight', body: 'Paper: Sent · waiting for your Daylight.\nnotes: Sent · waiting for your Daylight.' });
    await s.app.handleAction({ type: 'clipboard', text: 'A long headline about calm reading https://www.example.com/story?id=7', error: '' });
    assert.deepEqual(s.bridge.notes.at(-1), { title: 'Sent to Desk Daylight', body: 'example.com: Sent · waiting for your Daylight.' }, 'the host, as today');
    // Something that didn't go keeps v1.1's words.
    await s.app.handleAction({ type: 'files', paths: ['C:\\Docs\\missing.pdf'] });
    assert.equal(s.bridge.notes.at(-1).title, 'Couldn’t send missing.pdf');
    // A Daylight without a name.
    const n = await setup({ name: '' });
    try {
      await n.app.handleAction({ type: 'clipboard', text: 'https://example.com/x', error: '' });
      assert.equal(n.bridge.notes.at(-1).title, 'Sent to your Daylight');
    } finally { n.app.stop(); }
  } finally { s.app.stop(); }
});

test('F33: the copied link is prepared without being sent, with its host (the window asks first); no link says why', async () => {
  const s = await setup();
  try {
    const before = relay.state.published;
    const p = await s.app.prepareClipboard({ text: 'Read https://www.example.com/a?utm_medium=x later' });
    assert.deepEqual(p, { link: { url: 'https://www.example.com/a', title: 'Read later', orig: 'https://www.example.com/a?utm_medium=x' }, host: 'example.com' });
    assert.equal(relay.state.published, before, 'nothing sent before Send');
    assert.equal(L.fillText(LAB_TEXT.copiedLink.confirm, { host: p.host, name: await s.app.daylightName() }), 'Send example.com to Desk Daylight?');
    const [r] = await s.app.sendPrepared(p.link);
    assert.deepEqual([r.row.url, r.row.title, r.row.extras], ['https://www.example.com/a', 'Read later', { 'x-orig': 'https://www.example.com/a?utm_medium=x' }]);
    assert.deepEqual(await s.app.prepareClipboard({ text: 'no link here' }), { error: 'Copy a web address (http or https), then try again.', code: 'no-link' });
    assert.deepEqual(await s.app.prepareClipboard({ text: '', error: 'busy' }), { error: 'Couldn’t read the clipboard (busy).', code: 'no-link' });
    assert.equal(await s.lab.setUse('F33', false), false);
    assert.equal(await s.lab.useOn('F33'), false);
    assert.deepEqual((await s.lab.overview({ refresh: false })).settings, { use: { F16: true, F33: false }, quickSends: false });
  } finally { s.app.stop(); }
});

// --- F09 send links -----------------------------------------------------------------------------------------------------

test('F09: parseSendLink reads daylightshare://send links and nothing else; it never takes a file path', () => {
  assert.deepEqual(labMod.parseSendLink('daylightshare://send?url=https%3A%2F%2Fexample.com%2Fa&title=A%20story&quick=1'),
    { url: 'https://example.com/a', title: 'A story', text: '', quick: true });
  assert.deepEqual(labMod.parseSendLink('DaylightShare://SEND/?text=Hi%20https%3A%2F%2Fexample.com#x'), { url: '', title: '', text: 'Hi https://example.com', quick: false });
  assert.deepEqual(labMod.parseSendLink('daylightshare://send'), { url: '', title: '', text: '', quick: false });
  assert.equal(labMod.parseSendLink('daylightshare://send?quick=true').quick, false, 'quick only as quick=1');
  for (const no of ['daylightshare://pair?c=ABC', 'daylightshare://sender?url=x', 'https://example.com/send?url=x', '', null]) {
    assert.equal(labMod.parseSendLink(no), null, String(no));
  }
});

test('F09: a send link asks "Send to {name}?" with the title and host; quick sends only when allowed, at most 10 a minute', async () => {
  let clock = Date.now();
  const s = await setup({ now: () => clock });
  try {
    const A = LAB_TEXT.automation;
    const link = 'daylightshare://send?url=https%3A%2F%2Fexample.com%2Fstory%3Futm_source%3Dx&title=A%20story&quick=1';
    let r = await s.app.prepareSendLink(link);
    assert.deepEqual(r, { ask: true, link: { url: 'https://example.com/story', title: 'A story', orig: 'https://example.com/story?utm_source=x' }, title: 'Send to Desk Daylight?', lines: ['A story', 'example.com'] });
    assert.equal(r.title, L.fillText(A.confirmTitle, { name: 'Desk Daylight' }));
    // text= goes through smart intake; a link without a title shows its host only.
    r = await s.app.prepareSendLink('daylightshare://send?text=' + encodeURIComponent('Worth a read https://example.org/p?fbclid=1'));
    assert.deepEqual([r.ask, r.link.url, r.link.title, r.lines], [true, 'https://example.org/p', 'Worth a read', ['Worth a read', 'example.org']]);
    r = await s.app.prepareSendLink('daylightshare://send?url=https%3A%2F%2Fexample.org%2Fbare');
    assert.deepEqual(r.lines, ['example.org']);
    // Not a web address (a file path among them): nothing to send.
    for (const bad of ['daylightshare://send?url=C%3A%5CUsers%5Cme%5Csecret.pdf', 'daylightshare://send?url=file%3A%2F%2F%2FC%3A%2Fx.pdf', 'daylightshare://send?text=no%20link', 'daylightshare://send']) {
      assert.deepEqual(await s.app.prepareSendLink(bad), { error: A.notWebAddress, state: 'not-web' }, bad);
    }
    // Quick sends: off by default (the question shows); on, at most 10 a minute, then the question again.
    assert.equal(await s.lab.setQuickSends(true), true);
    for (let i = 0; i < 10; i++) assert.equal((await s.app.prepareSendLink(link)).ask, false, `quick send ${i + 1}`);
    assert.equal((await s.app.prepareSendLink(link)).ask, true, 'the 11th within a minute asks');
    assert.equal((await s.app.prepareSendLink(link.replace('&quick=1', ''))).ask, true, 'without quick=1 it asks');
    clock += 61000;
    assert.equal((await s.app.prepareSendLink(link)).ask, false, 'a minute later, quick again');
    const [sent] = await s.app.sendPrepared((await s.app.prepareSendLink(link)).link);
    assert.equal(sent.row.url, 'https://example.com/story');
    await s.app.notifyResults([sent]);
    assert.equal(s.bridge.notes.at(-1).title, 'Sent to Desk Daylight');
    // Lab off: the Lab-off sentence; not paired: how to pair.
    await s.lab.setLab(false);
    assert.deepEqual(await s.app.prepareSendLink(link), { error: 'Turn on Lab in Send to Daylight to use this.', state: 'lab-off' });
    await s.lab.setLab(true);
    await s.app.unpair();
    assert.deepEqual(await s.app.prepareSendLink(link), { error: LAB_TEXT.needs['needs-pairing'], state: 'needs-pairing' });
  } finally { s.app.stop(); }
});

// --- F02's entry point ------------------------------------------------------------------------------------------------------

test('F02’s entry point: Files over 9 MB needs the Daylight server (Copy Server code) until one exists', async () => {
  const s = await setup();
  try {
    const g = await s.lab.gate('F02');
    assert.deepEqual([g.ready, g.state, g.button], [false, 'needs-server', 'Copy Server code']);
    assert.ok(g.serverCode);
    assert.equal(LAB_TEXT.bigFiles, 'Send files over 9 MB ›');
  } finally { s.app.stop(); }
});

// --- F26 Setup check ----------------------------------------------------------------------------------------------------------

test('F26: the test article goes as a page with x-cap "test" and is followed to the Reader; the activity log and diagnostics', async () => {
  const s = await setup({ lab: true });
  try {
    const row = await s.app.sendTestArticle();
    assert.deepEqual([row.kind, row.title, row.url], ['page', 'Test article from Windows PC', `https://daylight.invalid/test/${row.id}`]);
    await s.day.pollOnce();
    await s.app.tick();
    const got = (await new ds.Receiver({ pairing: s.pairing, storage: new ds.MemoryStorage() }).pollOnce()).items[0];
    assert.equal(got.header.kind, 'page');
    assert.deepEqual(got.extras, { 'x-cap': 'test' });
    assert.ok(ds.fromUtf8(got.content).split(/\s+/).length > 350, 'about 400 words, so the Reader keeps it');
    assert.equal((await labelOf(s.app, row.id)).label, 'In your Reader ✓');
    const log = await s.lab.activity();
    assert.deepEqual(log.map((e) => e.type), ['send', 'status', 'state']);
    assert.ok(log.every((e) => e.id8 === row.id.slice(0, 8)));
    assert.deepEqual(log.map((e) => e.status), ['sent', 'delivered', 'reader']);
    const text = await s.lab.diagnostics({ version: '1.2.0', rows: await s.app.rows() });
    assert.match(text, /^Send to Daylight diagnostics\nApp: Send to Daylight 1\.2\.0 \(windows\)\nLab: on\nLab caps from your Daylight: reader-link, st, tap\n/);
    assert.match(text, /Outbox: sending 0 · sent 0 · delivered 1 · failed 0 · expired 0/);
    assert.match(text, /Relay: custom relay/);
    // No URL, title, pairing code, topic or Server code (F26.2).
    const code = await ds.formatCode(s.secret);
    for (const no of ['http', 'daylight.invalid', 'Test article', code, code.replace(/-/g, ''), (await ds.deriveKeys(s.secret)).inboxTopic, 'Desk Daylight']) {
      assert.ok(!text.includes(no), `diagnostics carry no ${no}`);
    }
    // With Lab off nothing more is logged (1.3).
    await s.lab.setLab(false);
    await s.app.sendLink('https://example.com/off');
    await s.lab.logEvent({ type: 'x' });
    assert.equal((await s.lab.activity()).length, 3);
  } finally { s.app.stop(); }
});

test('F26: Setup check’s lines on Windows, in LAB_TEXT’s words, each unmet one with its button', () => {
  const S = LAB_TEXT.setup;
  const all = labMod.setupChecks({ paired: true, sendTo: true, autostart: true, hotkey: true, notifications: 'on' });
  assert.deepEqual(all.map((c) => [c.id, c.ok, c.text, c.button]), [
    ['paired', true, `✓ ${S.checks.paired}`, null],
    ['sendTo', true, `✓ ${S.checks.sendTo}`, null],
    ['loginItem', true, `✓ ${S.checks.loginItem}`, null],
    ['hotkey', true, `✓ ${S.checks.hotkey}`, null],
    ['notifications', true, `✓ ${S.checks.notifications}`, null],
  ]);
  const none = labMod.setupChecks({ notifications: 'off' });
  assert.deepEqual(none.map((c) => [c.text, c.fix, c.button]), [
    ['! Pairing', 'pairing', 'Open setting'],
    ['! Send to shortcut', 'sendTo', 'Open setting'],
    ['! Open at login', 'autostart', 'Open setting'],
    ['! Hotkey', 'hotkey', 'Open setting'],
    ['! Notifications', 'notifications', 'Open Settings'],
  ]);
  assert.equal(labMod.setupChecks({ notifications: 'unknown' }).at(-1).ok, true, 'Windows didn’t say: not reported as unmet');
});
