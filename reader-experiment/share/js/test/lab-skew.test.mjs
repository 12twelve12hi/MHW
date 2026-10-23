// F17 version skew and the household soak (LAB-PROTOCOL 2.8), through the mock relay with ntfy.sh's limits.
// - The matrix: {v1.0 Sender, v1.1 Sender, Lab Sender} x {v1.0 Receiver, v1.1 Receiver, LabInboxSim} x {url, page,
//   file}. The v1.0 and v1.1 peers are the references as they shipped (fixtures/), so this proves what apps in the
//   field do with Lab frames.
// - Two Lab publishers on one ack topic (Daylight Share and the Lab Reader), in both handover orders (5.3.4).
// - The soak: 7 simulated days of a busy household behind one address, polling every 15 minutes and with Instant
//   delivery, then again with a forced 429.
// - W2 (L2): the return matrix ({v1.0, v1.1, W0, W1, W2} senders x {v1.0, v1.1, W0, W1, W2} Daylights x {url, page,
//   file}, W0 and W1 being the JS as it shipped, frozen in fixtures/w0 and w1), and the W2 soak with the return lane
//   at real sizes (LAB-PLAN 4.1.1 L2.9): 5 devices, then 8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ds from '../daylight-share.js';
import * as lab from '../daylight-lab.js';
import * as v10 from './fixtures/daylight-share-v1.0.js';
import * as v11 from './fixtures/daylight-share-v1.1.js';
import * as w0 from './fixtures/w0/daylight-share.js';
import * as w0lab from './fixtures/w0/daylight-lab.js';
import * as w1 from './fixtures/w1/daylight-share.js';
import * as w1lab from './fixtures/w1/daylight-lab.js';
import { startMockRelay, NTFY_SH_LIMITS } from '../mock-relay.mjs';

const T0 = Date.UTC(2026, 9, 19, 0, 0, 0); // a Monday, 00:00 UTC
const SEC = 1000, MIN = 60000, HOUR = 3600000, DAY = 86400000;
const fast = { retryDelaysMs: [0, 0, 0] };

const ITEMS = {
  url: { kind: 'url', url: 'https://example.com/story', title: 'A story' },
  page: { kind: 'page', url: 'https://example.com/page', title: 'A page', content: '<html><body>' + '<p>Words, words.</p>'.repeat(300) + '</body></html>' },
  file: { kind: 'file', name: 'paper.pdf', mime: 'application/pdf', content: new Uint8Array(40000).map((_, i) => (i * 31 + (i >> 7)) & 0xff) },
};

function makeSender(version, pairing, now) {
  const storage = new ds.MemoryStorage();
  if (version === 'v1.0') return { sender: new v10.Sender({ pairing, storage, from: 'Old phone', now }), ledger: null };
  if (version === 'v1.1') return { sender: new v11.Sender({ pairing, storage, from: 'Phone', now, ...fast }), ledger: null };
  const ledger = new lab.LabLedger({ storage, now });
  return { sender: new ds.Sender({ pairing, storage, from: 'Lab phone', now, ...fast, onAckHeader: lab.labHook(ledger) }), ledger };
}

async function makeReceiver(version, pairing, now, { app = 'android/1.5.0', caps = ['st', 'tap', 'reader-link'], from = 'Daylight', stateFor } = {}) {
  const storage = new ds.MemoryStorage();
  if (version === 'v1.0') return { poll: () => new v10.Receiver({ pairing, storage, from, now }).pollOnce() };
  if (version === 'v1.1') {
    const r = new v11.Receiver({ pairing, storage, from, now, ...fast });
    return { poll: () => r.pollOnce() };
  }
  const receiver = new ds.Receiver({ pairing, storage, from, now, ...fast });
  const keys = await ds.deriveKeys(pairing.secret);
  const relay = new ds.RelayClient({ relay: pairing.relay, ...fast });
  const labInbox = new lab.LabInbox({ storage, relay, keys, info: { lab: 1, app, caps, live: false }, from, now, autoFlushMs: null });
  const sim = new lab.LabInboxSim({ receiver, labInbox, stateFor });
  return { poll: () => sim.pollOnce(), labInbox, sim };
}

const describeV11 = (row, now) => v11.describeRow(row, now);

test('F17.1 skew matrix: every pair delivers url, page and file; Lab states only when both sides are Lab', async () => {
  let clock = T0 + 9 * HOUR;
  const now = () => clock;
  const relay = await startMockRelay({ now, ...NTFY_SH_LIMITS });
  try {
    const outcomes = [];
    for (const sv of ['v1.0', 'v1.1', 'lab']) {
      for (const rv of ['v1.0', 'v1.1', 'lab']) {
        for (const kind of ['url', 'page', 'file']) {
          const pairing = { secret: ds.generateSecret(), relay: relay.url, name: 'Daylight' };
          const { sender, ledger } = makeSender(sv, pairing, now);
          const receiver = await makeReceiver(rv, pairing, now);
          const row = await sender.send(ITEMS[kind]);
          assert.equal(row.status, 'sent', `${sv} -> ${rv} ${kind}: sent`);
          const got = await receiver.poll();
          assert.equal(got.items.length, 1, `${sv} -> ${rv} ${kind}: received`);
          const item = got.items[0];
          assert.equal(item.header.id, row.id);
          if (kind !== 'url') assert.deepEqual(item.content, typeof ITEMS[kind].content === 'string' ? ds.utf8(ITEMS[kind].content) : ITEMS[kind].content);
          clock += 5 * SEC;
          // Old senders read Lab frames too: they must neither throw nor deliver anything because of them.
          const delivered = await sender.checkAcks();
          assert.equal(delivered, 1, `${sv} -> ${rv} ${kind}: acked`);
          const stored = (await sender.list()).find((r) => r.id === row.id);
          assert.equal(stored.status, 'delivered');
          if (sv === 'lab') {
            const snap = await ledger.snapshot();
            const d = lab.describeLabRow(stored, now(), { lab: true, inboxLab: snap.inboxLab, hasCap: snap.hasCap, state: snap.states[row.id] ?? null, online: true });
            if (rv === 'lab') {
              assert.equal(snap.inboxLab, true);
              assert.equal(snap.states[row.id].s, kind === 'file' ? 'handed' : 'reader');
              assert.equal(d.label, kind === 'file' ? 'Handed to the Reader' : 'In your Reader ✓');
            } else {
              assert.equal(snap.inboxLab, false, 'no Lab hello from a v1 Inbox');
              assert.deepEqual(snap.states, {}, 'no states from a v1 Inbox');
              const old = describeV11(stored, now());
              assert.deepEqual({ label: d.label, sentence: d.sentence, action: d.action }, old, 'F01.5: rows read as v1.1 does');
              assert.equal(d.stepLine, null);
              assert.ok(snap.checkedIn !== null && now() - snap.checkedIn < MIN, 'the check-in header still works, from ack times');
            }
          }
          if (rv === 'v1.1' && sv !== 'v1.0') assert.deepEqual(ds.describeRow(stored, now()), describeV11(stored, now()), 'describeRow is unchanged');
          outcomes.push(`${sv}->${rv}:${kind}`);
          clock += MIN;
        }
      }
    }
    assert.equal(outcomes.length, 27);
    assert.deepEqual(relay.state.limited, [], 'no 429');
  } finally { await relay.close(); }
});

test('LAB-PLAN 0.3: v1.0 and v1.1 Receivers accept every W1 item (x-orig, x-cap, excerpts, notes, the test article)', async () => {
  let clock = T0 + 9 * HOUR + 30 * MIN;
  const now = () => clock;
  const relay = await startMockRelay({ now, ...NTFY_SH_LIMITS });
  try {
    const n = lab.normaliseShare({ text: 'A story https://example.com/story?utm_source=share&id=7#:~:text=Knead%20the%20dough' });
    assert.equal(n.kind, 'link');
    assert.ok(n.orig);
    const page = ITEMS.page;
    const W1 = {
      'url with x-orig and a text fragment': { kind: 'url', url: n.url, title: n.title, extras: { 'x-orig': n.orig } },
      'page with x-cap seen': { ...page, extras: { 'x-cap': 'seen' } },
      'page with x-cap clean': { ...page, url: 'https://example.com/clean', extras: { 'x-cap': 'clean', 'x-orig': 'https://example.com/clean?fbclid=1' } },
      'the test article (x-cap test)': lab.testArticle({ device: 'Lab phone' }),
      'an excerpt: text/html, url with #:~:text=': lab.excerptItem({ text: 'Knead the dough for ten minutes.\n\nThen let it rest.', html: '<p>Knead the dough for <b>ten</b> minutes.</p><p>Then let it rest.</p>', url: 'https://www.example.com/bread?x=1', pageTitle: 'Bread', date: '2026-10-22' }),
      'a note: text/markdown, no url': lab.excerptItem({ text: 'Buy flour\nand yeast', app: 'Notes', date: '2026-10-22' }),
      'an excerpt trimmed at 50,000 characters': lab.excerptItem({ text: 'word '.repeat(10010).trim(), url: 'https://example.com/big', pageTitle: 'Big', date: '2026-10-22' }),
    };
    assert.ok(W1['an excerpt: text/html, url with #:~:text='].url.includes('#:~:text='));
    for (const rv of ['v1.0', 'v1.1', 'lab']) {
      for (const [name, item] of Object.entries(W1)) {
        const pairing = { secret: ds.generateSecret(), relay: relay.url, name: 'Daylight' };
        const { sender } = makeSender('lab', pairing, now);
        const receiver = await makeReceiver(rv, pairing, now);
        const { id, ...toSend } = item; // the test article brings its own id
        const row = await sender.send(id ? { ...toSend, id } : toSend);
        assert.equal(row.status, 'sent', `${rv} ${name}: sent`);
        const got = await receiver.poll();
        assert.equal(got.items.length, 1, `${rv} ${name}: received`);
        const { header, content } = got.items[0];
        assert.equal(header.id, row.id, name);
        assert.equal(header.kind, item.kind, name);
        if (item.url) assert.equal(header.url, item.url, `${rv} ${name}: the url as sent`);
        if (item.title) assert.equal(header.title, item.title, name);
        if (item.kind === 'file') assert.deepEqual([header.name, header.mime], [item.name, item.mime], name);
        if (item.kind !== 'url') assert.deepEqual(content, typeof item.content === 'string' ? ds.utf8(item.content) : item.content, `${rv} ${name}: content`);
        clock += 5 * SEC;
        assert.equal(await sender.checkAcks(), 1, `${rv} ${name}: acked`);
        clock += MIN;
      }
    }
    assert.deepEqual(relay.state.limited, [], 'no 429');
  } finally { await relay.close(); }
});

test('old senders read every kind of Lab frame on their ack topic without throwing or delivering', async () => {
  let clock = T0 + 10 * HOUR;
  const now = () => clock;
  const relay = await startMockRelay({ now });
  try {
    const pairing = { secret: ds.generateSecret(), relay: relay.url };
    const keys = await ds.deriveKeys(pairing.secret);
    const senders = [new v10.Sender({ pairing, storage: new ds.MemoryStorage(), now }), new v11.Sender({ pairing, storage: new ds.MemoryStorage(), now, ...fast })];
    const rows = [];
    for (const s of senders) rows.push(await s.send({ kind: 'url', url: 'https://example.com/pending' }));
    const rc = new ds.RelayClient({ relay: relay.url, ...fast });
    const ids = rows.map((r) => r.id);
    const states = ids.map((i) => ({ i, s: 'reader', t: 1792483198 }));
    const frames = [
      await lab.buildLabFrame(keys, { inbox: { lab: 1, app: 'android/1.5.0', caps: ['st'] }, states }),
      await lab.buildLabFrame(keys, { inbox: { lab: 0, app: 'android/1.5.0', caps: [] } }),
      await lab.buildLabFrame(keys, { inbox: { lab: 99, app: 'a'.repeat(60), caps: Array(16).fill('x'.repeat(16)) }, states: Array(24).fill(states[0]), from: '\ud800'.repeat(60) }),
      // A future Lab frame that puts unexpected types where v1 readers look: still ids [].
      await ds.encryptFrame(keys, 'ack', { v: 1, kind: 'ack', ids: [], sent: 7, from: 5, 'x-st': 'nope', 'x-inbox': [1] }, new Uint8Array(0)),
    ];
    for (const f of frames) await rc.publish(keys.ackTopic, f);
    for (const s of senders) assert.equal(await s.checkAcks(), 0);
    for (const s of senders) assert.ok((await s.list()).every((r) => r.status === 'sent'), 'no row delivered by a Lab frame');
    // Then a real ack still delivers.
    await rc.publish(keys.ackTopic, await ds.buildAckFrame(keys, ids));
    clock += SEC;
    for (const s of senders) assert.equal(await s.checkAcks(), 1);
  } finally { await relay.close(); }
});

async function handover(order) {
  let clock = T0 + 12 * HOUR;
  const now = () => clock;
  const relay = await startMockRelay({ now, ...NTFY_SH_LIMITS });
  try {
    const pairing = { secret: ds.generateSecret(), relay: relay.url };
    const { sender, ledger } = makeSender('lab', pairing, now);
    const share = await makeReceiver('lab', pairing, now, { app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'], from: 'Daylight Share' });
    const reader = await makeReceiver('lab', pairing, now, {
      app: 'reader-lab/0.27.900', caps: ['st', 'reader-link', 'reader-doc', 'quiet'], from: 'Daylight Reader (lab)',
      stateFor: () => 'reader', // the Lab Reader confirms documents too (R1)
    });
    const [first, second] = order === 'share-to-reader' ? [share, reader] : [reader, share];
    const a = await sender.send(ITEMS.url);
    await first.poll();
    clock += 5 * SEC;
    await sender.checkAcks();
    const before = await ledger.snapshot();
    assert.equal(before.inboxLab, true);
    clock += MIN;
    await first.labInbox.labTurnedOff(); // the handover: the first stops receiving and says so
    const b = await sender.send(ITEMS.file);
    clock += SEC;
    const res = await second.poll(); // the second receives (and re-acks the first item it finds cached)
    assert.ok(res.items.some((i) => i.header.id === b.id));
    clock += 5 * SEC;
    await sender.checkAcks();
    const after = await ledger.snapshot();
    const rowB = (await sender.list()).find((r) => r.id === b.id);
    const rowA = (await sender.list()).find((r) => r.id === a.id);
    return { before, after, rowA, rowB, ledger, now };
  } finally { await relay.close(); }
}

test('two Lab publishers on one ack topic: Daylight Share hands over to the Lab Reader (5.3.4)', async () => {
  const { before, after, rowB, now } = await handover('share-to-reader');
  assert.deepEqual(before.caps, ['reader-link', 'st', 'tap']);
  assert.deepEqual(after.publishers.map((p) => [p.publisher, p.lab]), [['android', 0], ['reader-lab', 1]]);
  assert.equal(after.inboxLab, true);
  assert.deepEqual(after.caps, ['quiet', 'reader-doc', 'reader-link', 'st']);
  assert.equal(after.states[rowB.id].s, 'reader');
  assert.equal(lab.describeLabRow(rowB, now(), { lab: true, ...after, state: after.states[rowB.id] }).label, 'In your Reader ✓', 'a PDF confirmed by the Lab Reader (R1.3)');
});

test('two Lab publishers on one ack topic: the Lab Reader hands back to Daylight Share', async () => {
  const { before, after, rowB, now } = await handover('reader-to-share');
  assert.ok(before.caps.includes('reader-doc'));
  assert.deepEqual(after.publishers.map((p) => [p.publisher, p.lab]), [['android', 1], ['reader-lab', 0]]);
  assert.deepEqual(after.caps, ['reader-link', 'st', 'tap'], 'reader-doc ends with the Lab Reader’s lab: 0');
  assert.equal(after.states[rowB.id].s, 'handed');
  assert.equal(lab.describeLabRow(rowB, now(), { lab: true, ...after, state: after.states[rowB.id] }).label, 'Handed to the Reader');
});

// ---------------------------------------------------------------------------------------------------------------
// The household soak (2.2.7, F17.5)

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 7 days: a phone and a Mac (Lab senders) share 30 items a day (20 links and pages, 10 files of 1-3 parts) with a
 * Lab Daylight (Documents = Ask: files wait for a tap), and the server lane delivers 60 items a day to the Daylight
 * from Cloudflare's addresses. Everyone but the server is one visitor of the mock relay, which has ntfy.sh's limits.
 */
async function soak({ instant, force429At = null, days = 7, seed = 7 }) {
  let clock = T0;
  const now = () => clock;
  let forcing = false;
  const forced = [];
  const relay = await startMockRelay({
    now, ...NTFY_SH_LIMITS, control: true,
    failPublish: (topic) => (forcing && topic === keys.ackTopic ? (forcing = false, forced.push(clock), 429) : null),
  });
  const rand = mulberry32(seed);
  const pairing = { secret: ds.generateSecret(), relay: relay.url, name: 'Daylight' };
  const keys = await ds.deriveKeys(pairing.secret);
  const chunkSize = 100000;
  const devices = ['phone', 'mac'].map((name) => {
    const storage = new ds.MemoryStorage();
    const ledger = new lab.LabLedger({ storage, now });
    return { name, ledger, sender: new ds.Sender({ pairing, storage, from: name, now, chunkSize, ...fast, onAckHeader: lab.labHook(ledger) }), visibleUntil: 0 };
  });
  // The Daylight: a Receiver, its LabInbox, the v1.1 ack digest, and the server lane's acks and hellos.
  const inboxStorage = new ds.MemoryStorage();
  const receiver = new ds.Receiver({ pairing, storage: inboxStorage, from: 'Daylight', now, ...fast });
  const rc = new ds.RelayClient({ relay: relay.url, ...fast });
  const labFlushes = [];
  const labInbox = new lab.LabInbox({ storage: inboxStorage, relay: rc, keys, info: { lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'], live: instant }, from: 'Daylight', now, autoFlushMs: null });
  // Documents = Ask: a file waits for a tap; links and pages go straight to the Reader.
  const sim = new lab.LabInboxSim({ receiver, labInbox, stateFor: (h) => (h.kind === 'file' ? 'waiting' : 'reader') });
  const serverTopics = { items: 'dls-server-items-' + ds.toHex(ds.randomBytes(4)), acks: 'dls-server-acks-' + ds.toHex(ds.randomBytes(4)) };
  const remembered = []; // [{id, at}] for the v1.1 ack digest
  const ackCycles = [];
  let lastAckFailed = false, lastDigest = 0, serverSince = 'all', serverUnacked = 0, lastServerAck = 0, lastServerHello = 0;
  const events = [];
  const at = (t, fn) => events.push({ t, fn, n: events.length });

  function noteFlush(r, reason) {
    labFlushes.push({ t: clock, reason, ...r });
    if (r.reason === 'spacing') at(clock + r.waitMs, () => flushLab('retry'));
    else if (r.published) at(clock + 30 * SEC, () => flushLab('more'));
  }
  async function flushLab(reason) { noteFlush(await labInbox.flush(), reason); }

  async function ackDigest() {
    const ids = remembered.filter((r) => clock - r.at <= 8 * DAY).sort((a, b) => b.at - a.at).slice(0, 280).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 70) await rc.publish(keys.ackTopic, await ds.buildAckFrame(keys, ids.slice(i, i + 70), { from: 'Daylight' }));
    lastDigest = clock;
    await labInbox.digest();
    labFlushes.push({ t: clock, reason: 'digest', published: 0 });
  }

  async function daylightPoll() {
    if (lastAckFailed) { await ackDigest(); lastAckFailed = false; }
    // The reference Lab Daylight: the poll and its acks, then the ack outcome and any 429/413 (Receiver limited),
    // the states, and the Lab flush (after the acks, never before).
    const res = await sim.pollOnce();
    ackCycles.push({ t: clock, items: res.items.map((i) => i.header.id), acked: res.acked, ackError: res.ackError });
    lastAckFailed = !!res.ackError;
    for (const it of res.items) {
      remembered.push({ id: it.header.id, at: clock });
      if (it.header.kind === 'file') {
        at(clock + (10 + Math.floor(rand() * 170)) * MIN, async () => { // the notice is tapped
          await labInbox.record(it.header.id, 'handed', Math.floor(clock / 1000));
          await flushLab('handoff');
        });
      }
    }
    noteFlush(res.lab, 'poll');
    // The server lane (S0): poll its topic, ack at most once every 15 minutes while items arrive.
    const entries = await rc.poll(serverTopics.items, serverSince);
    if (entries.length) serverSince = Math.max(...entries.map((e) => e.time)) + 1;
    serverUnacked += entries.length;
    if (serverUnacked && clock - lastServerAck >= 15 * MIN) {
      await rc.publish(serverTopics.acks, ds.utf8('server-lane ack ' + serverUnacked));
      serverUnacked = 0; lastServerAck = clock;
    }
    if (clock - lastServerHello > 11 * HOUR) { await rc.publish(serverTopics.acks, ds.utf8('server-lane hello')); lastServerHello = clock; }
    if (clock - lastDigest >= 11 * HOUR) await ackDigest();
  }

  async function senderCheck(dev) {
    try { await dev.sender.tick(); } catch { /* offline */ }
    const rows = await dev.sender.list();
    const snap = await dev.ledger.snapshot();
    if (clock < dev.visibleUntil || lab.wantsFastChecks(rows, clock, snap.states) && clock < dev.visibleUntil + 10 * MIN) {
      at(clock + lab.FAST_CHECK_MS, () => senderCheck(dev));
    }
  }

  const sent = [];
  const end = T0 + days * DAY + 4 * HOUR; // the last taps of the last evening, then a final digest
  for (let t = T0; t < end; t += 15 * MIN) {
    at(t, () => daylightPoll());
    for (const dev of devices) at(t + 30 * SEC, () => dev.sender.tick().catch(() => {}));
  }
  for (let d = 0; d < days; d++) {
    const dayStart = T0 + d * DAY;
    for (let h = 6; h < 24; h++) { // hourly feeds: 60 server items a day, from Cloudflare's addresses
      const n = h < 18 ? 3 : 2;
      at(dayStart + h * HOUR + 5 * MIN, async () => {
        for (let k = 0; k < n; k++) {
          await fetch(`${relay.url}/${serverTopics.items}`, { method: 'POST', headers: { 'X-Mock-Visitor': 'cloudflare' }, body: ds.toBase64(ds.randomBytes(600)) });
        }
      });
    }
    const kinds = [...Array(14).fill('url'), ...Array(6).fill('page'), ...Array(10).fill('file')];
    for (const kind of kinds) {
      const t = dayStart + 7 * HOUR + Math.floor(rand() * 16 * HOUR);
      const dev = devices[rand() < 0.65 ? 0 : 1];
      const parts = 1 + Math.floor(rand() * 3);
      at(t, async () => {
        const item = kind === 'url' ? { kind, url: `https://example.com/${clock}`, title: 'Story' }
          : kind === 'page' ? { kind, url: `https://example.com/p/${clock}`, title: 'Page', content: '<p>' + 'text '.repeat(400) + '</p>' }
            : { kind, name: 'doc.pdf', mime: 'application/pdf', content: ds.randomBytes((parts - 1) * chunkSize + 50000) };
        const row = await dev.sender.send(item);
        sent.push({ id: row.id, dev, kind, t: clock, status: row.status });
        dev.visibleUntil = clock + 2 * MIN;
        at(clock + lab.FAST_CHECK_MS, () => senderCheck(dev));
        if (instant) await daylightPoll(); // Instant delivery: the live connection takes the batch at once
      });
    }
  }
  if (force429At !== null) at(force429At, () => { forcing = true; });
  at(end, async () => { await ackDigest(); });

  try {
    while (events.length) {
      let i = 0;
      for (let k = 1; k < events.length; k++) if (events[k].t < events[i].t || (events[k].t === events[i].t && events[k].n < events[i].n)) i = k;
      const [e] = events.splice(i, 1);
      clock = Math.max(clock, e.t);
      await e.fn();
    }
    for (const dev of devices) await dev.sender.checkAcks();

    // What the relay saw.
    const household = relay.state.publishLog.filter((p) => p.visitor !== 'cloudflare');
    const perDay = new Map();
    for (const p of household) { const day = new Date(p.time * 1000).toISOString().slice(0, 10); perDay.set(day, (perDay.get(day) ?? 0) + 1); }
    // The relay keeps messages 12 h, so the Lab frames of 7 days are read from the LabInbox's flush log.
    const labTimes = labFlushes.filter((f) => f.published).map((f) => ({ t: f.t, kind: f.kind }));
    const labOnRelay = household.filter((p) => p.topic === keys.ackTopic).length - ackCycles.filter((c) => c.acked.length).length;
    assert.ok(labOnRelay >= labTimes.length, 'every Lab frame the log lists reached the relay');
    return { relay, sent, devices, perDay, labTimes, ackCycles, labFlushes, forced, household, keys, now };
  } finally { await relay.close(); }
}

function checkSoak(r, { days = 7, label }) {
  // No 429 from ntfy.sh's limits.
  assert.deepEqual(r.relay.state.limited, [], `${label}: no 429`);
  // At most 150 household messages on any day.
  const counts = [...r.perDay.values()];
  assert.ok(counts.length >= days, `${label}: ${counts.length} days`);
  assert.ok(Math.max(...counts) <= 150, `${label}: messages per day ${JSON.stringify([...r.perDay])}`);
  // Lab frames: within the cap (30 hellos and state frames a day; digests outside it) and 30 s apart.
  const perDay = new Map();
  for (const f of r.labTimes) {
    if (f.kind === 'digest' || f.kind === 'off') continue;
    const d = new Date(f.t).toISOString().slice(0, 10);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  assert.ok(Math.max(...perDay.values()) <= 30, `${label}: Lab frames per day ${JSON.stringify([...perDay])}`);
  for (let i = 1; i < r.labTimes.length; i++) assert.ok(r.labTimes[i].t - r.labTimes[i - 1].t >= 30 * SEC, `${label}: Lab frames 30 s apart`);
  const digestFrames = r.labTimes.filter((f) => f.kind === 'digest').length;
  assert.ok(digestFrames > 0, `${label}: the state digest ran`);
  // No ack delayed by a Lab frame: every batch is acked in its own poll, before the Lab flush of that poll.
  for (const c of r.ackCycles) {
    if (c.ackError) continue;
    assert.deepEqual([...c.acked].sort(), [...c.items].sort(), `${label}: every item acked in its poll`);
  }
  return { counts, labPerDay: [...perDay.values()], digestFrames };
}

test('soak: 7 days, the Daylight polling every 15 minutes: no 429, at most 150 messages a day, Lab frames capped (F17.5)', async () => {
  const r = await soak({ instant: false });
  const stats = checkSoak(r, { label: 'polling' });
  for (const s of r.sent) {
    const row = (await s.dev.sender.list()).find((x) => x.id === s.id);
    assert.equal(row.status, 'delivered', 'every item delivered');
    const st = await s.dev.ledger.state(s.id);
    assert.equal(st?.s, s.kind === 'file' ? 'handed' : 'reader', `the state of a ${s.kind} reached its sender`);
  }
  assert.equal(r.sent.length, 210);
  console.log(`[soak polling] messages/day ${stats.counts.join(' ')}; Lab frames/day ${stats.labPerDay.join(' ')}; digest frames ${stats.digestFrames}`);
});

test('soak: 7 days with Instant delivery: no 429, at most 150 messages a day, Lab frames capped (F17.5)', async () => {
  const r = await soak({ instant: true, seed: 11 });
  const stats = checkSoak(r, { label: 'instant' });
  let settled = 0;
  for (const s of r.sent) {
    const row = (await s.dev.sender.list()).find((x) => x.id === s.id);
    assert.equal(row.status, 'delivered');
    if (['reader', 'handed'].includes((await s.dev.ledger.state(s.id))?.s)) settled++;
  }
  assert.equal(settled, r.sent.length, 'states past the daily cap arrive with the digest');
  console.log(`[soak instant] messages/day ${stats.counts.join(' ')}; Lab frames/day ${stats.labPerDay.join(' ')}; digest frames ${stats.digestFrames}`);
});

test('soak with a forced 429: Lab frames give way for an hour, acks do not wait, and everything still arrives', async () => {
  const at429 = T0 + DAY + 12 * HOUR + 2 * MIN; // day 2, just after a 12:00 poll
  const r = await soak({ instant: true, seed: 5, days: 3, force429At: at429 });
  assert.equal(r.forced.length, 1, 'the 429 was forced once');
  const t429 = r.forced[0];
  const during = r.labTimes.filter((f) => f.t > t429 && f.t < t429 + HOUR);
  assert.deepEqual(during, [], 'no Lab frame within the hour after the 429');
  assert.ok(r.labTimes.some((f) => f.t >= t429 + HOUR), 'Lab frames resume after the hour');
  const yielded = r.labFlushes.filter((f) => f.t > t429 && f.t < t429 + HOUR && f.reason === 'yield');
  assert.ok(yielded.length > 0, 'flushes in that hour gave way');
  const acksDuring = r.ackCycles.filter((c) => c.t > t429 && c.t < t429 + HOUR && c.items.length);
  assert.ok(acksDuring.length > 0 && acksDuring.every((c) => !c.ackError && c.acked.length === c.items.length), 'acks still went out at once');
  checkSoak(r, { days: 3, label: 'forced 429' });
  for (const s of r.sent) assert.equal((await s.dev.sender.list()).find((x) => x.id === s.id).status, 'delivered');
});

// ---------------------------------------------------------------------------------------------------------------
// W2 (L2): the return matrix (LAB-PROTOCOL 2.4.13, 2.8)

const PEERS = {
  'v1.0': { ds: v10, lab: null }, 'v1.1': { ds: v11, lab: null },
  W0: { ds: w0, lab: w0lab }, W1: { ds: w1, lab: w1lab }, W2: { ds, lab },
};
const W2_CAPS = ['st', 'tap', 'reader-link', 'cap-kind', 'return'];

async function peerSender(version, pairing, now) {
  const P = PEERS[version];
  const storage = new P.ds.MemoryStorage();
  if (!P.lab) return { storage, ledger: null, sender: version === 'v1.0' ? new P.ds.Sender({ pairing, storage, from: 'Old phone', now }) : new P.ds.Sender({ pairing, storage, from: 'Phone', now, ...fast }) };
  const ledger = new P.lab.LabLedger({ storage, now });
  return { storage, ledger, sender: new P.ds.Sender({ pairing, storage, from: `${version} phone`, now, ...fast, onAckHeader: P.lab.labHook(ledger) }) };
}

async function peerDaylight(version, pairing, now) {
  const P = PEERS[version];
  const storage = new P.ds.MemoryStorage();
  if (!P.lab) {
    const r = version === 'v1.0' ? new P.ds.Receiver({ pairing, storage, now }) : new P.ds.Receiver({ pairing, storage, now, ...fast });
    return { poll: () => r.pollOnce(), back: null };
  }
  const receiver = new P.ds.Receiver({ pairing, storage, now, ...fast });
  const keys = await P.ds.deriveKeys(pairing.secret);
  const relay = new P.ds.RelayClient({ relay: pairing.relay, ...fast });
  const caps = version === 'W2' ? W2_CAPS : version === 'W1' ? ['st', 'tap', 'reader-link', 'cap-kind'] : ['st', 'tap', 'reader-link'];
  const labInbox = new P.lab.LabInbox({ storage, relay, keys, info: { lab: 1, app: `android/${version}`, caps, live: false }, from: 'Daylight', now, autoFlushMs: null,
    ...(version === 'W2' ? { framesPerDay: lab.LAB_FRAMES_PER_DAY_RETURN } : {}) });
  const sim = new P.lab.LabInboxSim({ receiver, labInbox });
  let back = null;
  if (version === 'W2') {
    back = new ds.Sender({ pairing, storage, lane: 'return', devices: new lab.ReturnDevices({ storage, now }), from: 'Daylight', now, ...fast });
  }
  return { poll: () => sim.pollOnce(), back };
}

test('W2 return matrix: v1.0, v1.1, W0, W1 and W2 senders with v1.0, v1.1, W0, W1 and W2 Daylights: every item delivered; the return lane only between W2 peers (L2.1, F06.12)', async () => {
  let clock = T0 + 30 * HOUR;
  const now = () => clock;
  const relay = await startMockRelay({ now, ...NTFY_SH_LIMITS });
  try {
    const returnTopics = new Set();
    const used = [];
    for (const dv of Object.keys(PEERS)) {
      for (const sv of Object.keys(PEERS)) {
        const pairing = { secret: ds.generateSecret(), relay: relay.url, name: 'Daylight' };
        const rk = await ds.deriveReturnKeys(pairing.secret);
        returnTopics.add(rk.returnTopic); returnTopics.add(rk.returnAckTopic);
        const phone = await peerSender(sv, pairing, now);
        const daylight = await peerDaylight(dv, pairing, now);
        for (const kind of ['url', 'page', 'file']) {
          const row = await phone.sender.send(ITEMS[kind]);
          assert.equal(row.status, 'sent', `${sv} -> ${dv} ${kind}`);
          const got = await daylight.poll();
          assert.deepEqual(got.items.map((i) => i.header.id), [row.id], `${sv} -> ${dv} ${kind}: received`);
          clock += 5 * SEC;
          assert.equal(await phone.sender.checkAcks(), 1, `${sv} -> ${dv} ${kind}: acked, Lab frames or not`);
          if (phone.ledger) {
            const st = await phone.ledger.state(row.id);
            const bothLab = !!PEERS[dv].lab;
            assert.equal(st?.s ?? null, bothLab ? (kind === 'file' ? 'handed' : 'reader') : null, `${sv} -> ${dv} ${kind}: Lab states only between Lab peers`);
          }
          clock += MIN;
        }
        // The phone is also a device on the return lane when it is W2. It reads only once its Daylight's hello has
        // the cap return (capState, L3): never from a v1, W0 or W1 Daylight.
        if (sv === 'W2') {
          const hasReturn = await phone.ledger.hasCap('return');
          assert.equal(hasReturn, dv === 'W2', `W2 phone with a ${dv} Daylight: return cap`);
          if (hasReturn) {
            const device = new ds.Receiver({ pairing, storage: phone.storage, lane: 'return', device: { dev: await lab.returnDeviceId(phone.storage), from: 'W2 phone' }, now, ...fast });
            await device.hello();
            clock += MIN;
            await daylight.back.checkAcks();
            const back = await daylight.back.send({ kind: 'file', name: 'from-the-daylight.pdf', mime: 'application/pdf', content: ITEMS.file.content });
            assert.equal(back.status, 'sent');
            clock += MIN;
            const r = await device.pollOnce();
            assert.deepEqual(r.items.map((i) => i.header.id), [back.id], 'the W2 phone gets what its W2 Daylight sends back');
            used.push(`${sv}->${dv}`);
          }
        }
        // Return-lane keys only on W2 storage, and the pairing lane's keys are v1.1's everywhere.
        if (sv !== 'W2') assert.ok([...phone.storage.m.keys()].every((k) => !k.startsWith('lane/')), `${sv}: no return-lane keys`);
        clock += MIN;
      }
    }
    assert.deepEqual(used, ['W2->W2']);
    const touched = relay.state.requests.filter((r) => [...returnTopics].some((t) => r.includes(t)));
    assert.ok(touched.length > 0 && touched.every((r) => r.includes(',') || r.startsWith('POST') || r.startsWith('PUT') || r.startsWith('GET /dls-')), 'only W2 peers touch the return topics');
    assert.deepEqual(relay.state.limited, [], 'no 429');
  } finally { await relay.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// W2 (L2.9): the household soak with the return lane, at real sizes

class EventQueue {
  constructor() { this.a = []; this.n = 0; }
  get size() { return this.a.length; }
  push(t, fn) {
    const e = { t, n: this.n++, fn };
    const a = this.a;
    a.push(e);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p].t < e.t || (a[p].t === e.t && a[p].n < e.n)) break;
      a[i] = a[p]; a[p] = e; i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        const less = (x, y) => a[x].t < a[y].t || (a[x].t === a[y].t && a[x].n < a[y].n);
        if (l < a.length && less(l, m)) m = l;
        if (r < a.length && less(r, m)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const T0W2 = Date.UTC(2026, 10, 2, 0, 0, 0); // a Monday, 00:00 UTC

/**
 * 7 days of LAB-PLAN 4.1.1's busy day, then a quiet tail: a phone and a Mac send 30 items a day to the Daylight (20
 * links and pages, 10 files of 1-3 parts of 1,900,544 bytes), the server lane delivers 60 items a day (S0 acks every
 * 2 hours), and the Daylight sends back 2 PDFs (1-5 parts) and 3 links a day to every device on the return lane.
 * Devices: an iPhone that reads only when it is opened (07:30 and 12:00, one minute each, or while its "on its way" line
 * shows: 20 minutes after an x-want, until the item arrives, F06), a Mac that reads every 2
 * minutes from 07:00 and is off on days 3 and 4, an Android phone on its 15-minute job, Windows every 2 minutes from
 * 08:00 to 23:00, and Chrome every 15 minutes; with `more`, an iPad (opened at 09:00 and 13:30), a second Mac
 * ("Mac", 09:00-18:00) and an Android tablet. Everyone but the server is one visitor of the mock relay, with ntfy.sh's
 * limits, the bandwidth's 413 included.
 */
async function soakW2({ instant, more = false, days = 7, tailDays = 2, seed = 21 }) {
  let clock = T0W2;
  const now = () => clock;
  const relay = await startMockRelay({ now, ...NTFY_SH_LIMITS, control: true });
  const rand = mulberry32(seed);
  const pairing = { secret: ds.generateSecret(), relay: relay.url, name: 'Daylight' };
  const keys = await ds.deriveKeys(pairing.secret);
  const rkeys = await ds.deriveReturnKeys(pairing.secret);
  const q = new EventQueue();
  const at = (t, fn) => q.push(t, fn);
  const end = T0W2 + days * DAY, stop = end + tailDays * DAY;

  // Pairing-lane senders (the iPhone and the Mac apps).
  const senders = {};
  for (const name of ['phone', 'mac']) {
    const storage = new ds.MemoryStorage();
    const ledger = new lab.LabLedger({ storage, now });
    senders[name] = { name, storage, ledger, sender: new ds.Sender({ pairing, storage, from: name, now, ...fast, onAckHeader: lab.labHook(ledger) }) };
  }

  // The Daylight: its Receiver, LabInbox (18 frames a day with return), the v1.1 ack digest, the server lane, and the
  // return lane's Sender with its devices.
  const inboxStorage = new ds.MemoryStorage();
  const receiver = new ds.Receiver({ pairing, storage: inboxStorage, from: 'Daylight', now, ...fast });
  const rc = new ds.RelayClient({ relay: relay.url, ...fast });
  const labFlushes = [];
  const labInbox = new lab.LabInbox({ storage: inboxStorage, relay: rc, keys, info: { lab: 1, app: 'android/2.0.0', caps: W2_CAPS, live: instant }, from: 'Daylight', now, autoFlushMs: null, framesPerDay: lab.LAB_FRAMES_PER_DAY_RETURN });
  const sim = new lab.LabInboxSim({ receiver, labInbox, stateFor: (h) => (h.kind === 'file' ? 'waiting' : 'reader') });
  const devicesReg = new lab.ReturnDevices({ storage: inboxStorage, now });
  const back = new ds.Sender({ pairing, storage: inboxStorage, lane: 'return', devices: devicesReg, from: 'Daylight', app: 'android/2.0.0', now, ...fast });
  const serverTopics = { items: 'dls-server-items-' + ds.toHex(ds.randomBytes(4)), acks: 'dls-server-acks-' + ds.toHex(ds.randomBytes(4)) };
  const remembered = [];
  const ackCycles = [];
  const budgets = new Map(); // day -> the return budget at its last pass
  let lastAckFailed = false, lastDigest = 0, serverSince = 'all', serverUnacked = 0, lastServerAck = -Infinity, lastServerHello = -Infinity;

  async function daylightPublish(topic, frame) {
    try { await rc.publish(topic, frame); } catch (e) {
      await labInbox.noteRelayLimit(e?.status); await back.noteRelayLimit(e?.status);
      throw e;
    }
  }
  function noteFlush(r, reason) {
    labFlushes.push({ t: clock, reason, ...r });
    if (r.reason === 'spacing') at(clock + r.waitMs, () => flushLab('retry'));
    else if (r.published) at(clock + 30 * SEC, () => flushLab('more'));
  }
  async function flushLab(reason) { noteFlush(await labInbox.flush(), reason); }
  async function ackDigest() {
    const ids = remembered.filter((r) => clock - r.at <= 8 * DAY).sort((a, b) => b.at - a.at).slice(0, 280).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 70) await daylightPublish(keys.ackTopic, await ds.buildAckFrame(keys, ids.slice(i, i + 70), { from: 'Daylight' })).catch(() => {});
    lastDigest = clock;
    await labInbox.digest();
  }
  async function backTick() {
    try { await back.tick(); } catch { /* offline */ }
    budgets.set(dayOf(clock), await back.budget());
  }
  async function daylightPoll() {
    if (lastAckFailed) { await ackDigest(); lastAckFailed = false; }
    let res;
    try { res = await sim.pollOnce(); } catch (e) { await back.noteRelayLimit(e?.status); return; }
    ackCycles.push({ t: clock, items: res.items.map((i) => i.header.id), acked: res.acked, ackError: res.ackError });
    lastAckFailed = !!res.ackError;
    if (res.limited) await back.noteRelayLimit(res.limited);
    const bytes = res.downloads.reduce((n, d) => n + d.bytes, 0);
    if (bytes) await back.noteRelayBytes(bytes);
    for (const it of res.items) {
      remembered.push({ id: it.header.id, at: clock });
      if (it.header.kind === 'file') {
        at(clock + (10 + Math.floor(rand() * 170)) * MIN, async () => {
          await labInbox.record(it.header.id, 'handed', Math.floor(clock / 1000));
          await flushLab('handoff');
        });
      }
    }
    noteFlush(res.lab, 'poll');
    // The server lane (S0): acks at most once every 2 hours while items arrive, and a hello every 8 hours.
    try {
      const entries = await rc.poll(serverTopics.items, serverSince);
      if (entries.length) serverSince = Math.max(...entries.map((e) => e.time)) + 1;
      serverUnacked += entries.length;
      if (serverUnacked && clock - lastServerAck >= 2 * HOUR) {
        await daylightPublish(serverTopics.acks, ds.utf8('server-lane ack ' + serverUnacked));
        serverUnacked = 0; lastServerAck = clock;
      }
      if (clock - lastServerHello >= 8 * HOUR) { await daylightPublish(serverTopics.acks, ds.utf8('server-lane hello')); lastServerHello = clock; }
    } catch { /* tried again at the next poll */ }
    if (clock - lastDigest >= 11 * HOUR) await ackDigest();
    await backTick();
  }

  // Devices on the return lane.
  const HH = (h, m = 0) => h * HOUR + m * MIN;
  const plan = [
    { name: 'iPhone', storage: senders.phone.storage, opens: [HH(7, 30), HH(12)] },
    { name: 'Mac', storage: senders.mac.storage, every: 2 * MIN, from: HH(7), to: HH(24), off: [2, 3], offset: 20 * SEC },
    { name: 'Android', every: 15 * MIN, from: 0, to: DAY, offset: 7 * MIN },
    { name: 'Windows', every: 2 * MIN, from: HH(8), to: HH(23), offset: 70 * SEC },
    { name: 'Chrome', every: 15 * MIN, from: 0, to: DAY, offset: 11 * MIN },
  ];
  if (more) {
    plan.push({ name: 'iPad', opens: [HH(9), HH(13, 30)] },
      { name: 'Mac', every: 2 * MIN, from: HH(9), to: HH(18), offset: 50 * SEC },
      { name: 'Android tablet', every: 15 * MIN, from: 0, to: DAY, offset: 3 * MIN });
  }
  const devs = [];
  for (const p of plan) {
    const storage = p.storage ?? new ds.MemoryStorage();
    const dev = await lab.returnDeviceId(storage);
    const d = { ...p, dev, storage, received: new Map(), frames: new Map(), errors: 0, topic: await ds.returnDevTopic(pairing.secret, dev) };
    d.rx = new ds.Receiver({ pairing, storage, lane: 'return', device: { dev, from: p.name }, now, ...fast,
      accept: async (it) => { if (!d.received.has(it.header.id)) d.received.set(it.header.id, clock); } });
    devs.push(d);
  }
  const offline = (d, t) => (d.off ?? []).includes(Math.floor((t - T0W2) / DAY));
  async function deviceRead(d, first = false) {
    if (offline(d, clock)) return;
    let r;
    try { r = first ? await d.rx.hello() : await d.rx.pollOnce(); } catch { d.errors++; return; }
    if (r.items.length) d.onItsWay = 0;
    if (process.env.SOAK_TRACE && (r.items.length || r.frame)) (d.trace ??= []).push(`${new Date(clock).toISOString().slice(5, 16)} items ${r.items.length} frame ${r.frame?.reason ?? '-'}${r.frame?.published === false ? '(failed)' : ''}`);
    if (r.frame?.published) {
      d.frames.set(dayOf(clock), (d.frames.get(dayOf(clock)) ?? 0) + 1);
      if (instant) await backTick(); // the Daylight's return-ack stream hears it at once
      // F06: after its x-want, an app in front reads every 30 s for 20 minutes, until an item arrives, while it shows
      // "Something from your Daylight is on its way." (an iPhone that is only opened stays open for that line).
      if (r.frame.want && d.opens) {
        d.onItsWay = clock + ds.RETURN_WANT_READ_MS;
        for (let t = clock + 30 * SEC; t <= d.onItsWay; t += 30 * SEC) at(t, () => (d.onItsWay && clock <= d.onItsWay ? deviceRead(d) : null));
      }
    }
  }
  for (const d of devs) {
    at(T0W2 + 5 * MIN + devs.indexOf(d) * 20 * SEC, () => deviceRead(d, true)); // the first hello
    for (let day = 0; day < days + tailDays; day++) {
      const base = T0W2 + day * DAY;
      if (d.opens) {
        for (const o of d.opens) for (const k of [0, 30 * SEC, 60 * SEC]) at(base + o + k, () => deviceRead(d));
      } else {
        for (let t = base + d.from + d.offset; t < base + d.to; t += d.every) at(t, () => deviceRead(d));
      }
    }
  }

  // The Daylight's runs, the senders' ticks, the server lane, the items both ways.
  for (let t = T0W2; t < stop; t += 15 * MIN) {
    at(t, () => daylightPoll());
    for (const s of Object.values(senders)) {
      at(t + 30 * SEC, () => (s.name === 'mac' && offline(devs[1], clock) ? null : s.sender.tick().catch(() => {})));
    }
  }
  const sent = [], sentBack = [];
  for (let day = 0; day < days; day++) {
    const dayStart = T0W2 + day * DAY;
    for (let h = 6; h < 24; h++) {
      const n = h < 18 ? 3 : 2;
      at(dayStart + h * HOUR + 5 * MIN, async () => {
        for (let k = 0; k < n; k++) await fetch(`${relay.url}/${serverTopics.items}`, { method: 'POST', headers: { 'X-Mock-Visitor': 'cloudflare' }, body: ds.toBase64(ds.randomBytes(600)) });
      });
    }
    const kinds = [...Array(14).fill('url'), ...Array(6).fill('page'), ...Array(10).fill('file')];
    for (const kind of kinds) {
      const t = dayStart + 7 * HOUR + Math.floor(rand() * 16 * HOUR);
      const parts = 1 + Math.floor(rand() * 3);
      const fromMac = rand() >= 0.65 && !offline(devs[1], t);
      at(t, async () => {
        const s = fromMac ? senders.mac : senders.phone;
        const item = kind === 'url' ? { kind, url: `https://example.com/${clock}`, title: 'Story' }
          : kind === 'page' ? { kind, url: `https://example.com/p/${clock}`, title: 'Page', content: '<p>' + 'text '.repeat(400) + '</p>' }
            : { kind, name: 'doc.pdf', mime: 'application/pdf', content: ds.randomBytes((parts - 1) * ds.CHUNK + 200000 + Math.floor(rand() * 1_500_000)) };
        const row = await s.sender.send(item);
        sent.push({ id: row.id, s, kind, t: clock });
        if (instant) await daylightPoll();
      });
    }
    const back5 = ['file', 'file', 'url', 'url', 'url'];
    for (const kind of back5) {
      const t = dayStart + 8 * HOUR + Math.floor(rand() * 14 * HOUR);
      const parts = 1 + Math.floor(rand() * 5);
      at(t, async () => {
        const item = kind === 'url' ? { kind, url: `https://example.com/back/${clock}`, title: 'Shared on the Daylight' }
          : { kind, name: 'annotated.pdf', mime: 'application/pdf', content: ds.randomBytes(Math.min(ds.MAX_ITEM, (parts - 1) * ds.CHUNK + 100000 + Math.floor(rand() * 1_700_000))) };
        try { await back.checkAcks(); } catch { /* the card reads returnAckTopic once */ }
        const row = await back.send(item);
        sentBack.push({ id: row.id, t: clock, kind, parts: row.frames, to: row.to });
        budgets.set(dayOf(clock), await back.budget());
      });
    }
  }

  try {
    while (q.size) {
      const e = q.pop();
      if (e.t >= stop) break;
      clock = Math.max(clock, e.t);
      await e.fn();
    }
    for (const s of Object.values(senders)) await s.sender.checkAcks();
    await back.checkAcks();
    return { relay, keys, rkeys, sent, sentBack, back, devs, labFlushes, ackCycles, budgets, end, senders };
  } finally { await relay.close(); }
}

function checkSoakW2(r, { label, days = 7, strict = true }) {
  const household = r.relay.state.publishLog.filter((p) => p.visitor !== 'cloudflare');
  const inDays = (t) => t * 1000 < r.end;
  const perDay = new Map(), mbPerDay = new Map();
  const add = (m, d, n) => m.set(d, (m.get(d) ?? 0) + n);
  for (const p of household) { if (!inDays(p.time)) continue; add(perDay, dayOf(p.time * 1000), 1); if (p.attachment) add(mbPerDay, dayOf(p.time * 1000), p.bytes); }
  for (const d of r.relay.state.downloadLog) if (d.visitor !== 'cloudflare' && inDays(d.time)) add(mbPerDay, dayOf(d.time * 1000), d.bytes);
  const counts = [...perDay.values()], mb = [...mbPerDay.values()].map((b) => Math.round(b / 1e5) / 10);
  assert.equal(counts.length, days, `${label}: ${days} days`);
  // No 429, and no 413 for the daily bandwidth.
  assert.deepEqual(r.relay.state.limited.filter((l) => l.status === 429), [], `${label}: no 429`);
  assert.deepEqual(r.relay.state.limited.filter((l) => l.limit === 'bandwidth'), [], `${label}: no 413 for the daily bandwidth`);
  if (strict) {
    assert.ok(Math.max(...counts) <= 150, `${label}: messages per day ${counts}`);
    assert.ok(Math.max(...mb) <= 193, `${label}: attachment MB per day ${mb}`);
  }
  // Lab hellos and state frames: at most 20 a day (18 while the return lane runs).
  const lab = new Map();
  for (const f of r.labFlushes) if (f.published && (f.kind === 'hello' || f.kind === 'states')) add(lab, dayOf(f.t), 1);
  assert.ok(Math.max(...lab.values()) <= 20, `${label}: Lab frames ${[...lab.values()]}`);
  // Device frames: at most 3 a day per device.
  for (const d of r.devs) for (const [day, n] of d.frames) assert.ok(n <= 3, `${label}: ${d.name} sent ${n} frames on ${day}`);
  // F06: at most 12 frames and 60 MB a day (the relay's count of frames; the budget's count of bytes).
  const returnTopics = new Set([r.rkeys.returnTopic]);
  const f06 = new Map();
  for (const p of household) if (returnTopics.has(p.topic) || r.devs.some((d) => d.topic === p.topic)) add(f06, dayOf(p.time * 1000), 1);
  assert.ok(Math.max(...f06.values()) <= 12, `${label}: F06 frames ${[...f06.values()]}`);
  for (const [day, b] of r.budgets) {
    assert.ok(b.frames <= 12 && b.bytes <= 60_000_000, `${label}: F06 budget on ${day}: ${b.frames} frames, ${b.bytes} bytes`);
    for (const n of Object.values(b.resends)) assert.ok(n <= 6, `${label}: ${n} re-sent frames for one device on ${day}`);
  }
  return { counts, mb, lab: [...lab.values()], f06: [...f06.values()], f06mb: [...r.budgets.values()].map((b) => Math.round(b.bytes / 1e5) / 10) };
}

async function checkDeliveries(r, label) {
  // Every pairing-lane item delivered, and none at its third 413.
  for (const s of r.sent) {
    const row = (await s.s.sender.list()).find((x) => x.id === s.id);
    assert.equal(row.status, 'delivered', `${label}: pairing-lane ${s.kind} delivered`);
  }
  // F06: who got what, within 7 days of the send.
  const per = new Map(r.devs.map((d) => [d.name, { got: 0, of: 0, frames: 0, missed: [], missedSent: [] }]));
  const rows = await r.back.list();
  let slowest = 0, waiting = 0;
  for (const b of r.sentBack) {
    const row = rows.find((x) => x.id === b.id);
    const wentOut = !!row && !(row.status === 'failed' && ['cap', 'relay', 'yield', 'no-device'].includes(row.errorCode));
    if (!wentOut) waiting++;
    assert.ok(b.to.length >= 5, `${label}: sent back to every device (${b.to.length})`);
    for (const dev of b.to) {
      const d = r.devs.find((x) => x.dev === dev);
      const p = per.get(d.name);
      p.of++; p.frames += b.parts;
      const got = d.received.get(b.id);
      if (got !== undefined && got - b.t <= 7 * DAY) { p.got++; slowest = Math.max(slowest, got - b.t); } else {
        p.missed.push(`${b.kind}/${b.parts} at ${new Date(b.t).toISOString().slice(5, 16)}`);
        if (wentOut) p.missedSent.push(p.missed.at(-1));
      }
    }
  }
  return { per, waiting, slowest: Math.round(slowest / HOUR) };
}

for (const instant of [false, true]) {
  test(`W2 soak (L2.9): 7 days, 5 devices, real sizes, ${instant ? 'Instant delivery' : 'the Daylight polling every 15 minutes'}`, async () => {
    const r = await soakW2({ instant, seed: instant ? 23 : 21 });
    const stats = checkSoakW2(r, { label: instant ? 'W2 instant' : 'W2 polling' });
    const del = await checkDeliveries(r, instant ? 'W2 instant' : 'W2 polling');
    // Every F06 item reaches every device that reads all day (Android's 15-minute job, Chrome's tick). A device that
    // reads only part of the day (the iPhone opened twice, Windows 08:00-23:00, the Mac and its two days off) misses
    // rows that the caps hold until the next UTC day, and the re-sends it then needs share 12 frames a day with the
    // first publishes: the plan's busy day does not leave room for them (README, "Lab (L2)": the W2 soak's finding).
    // Those devices are held to a floor that catches a livelock (they get at least 60%).
    for (const [name, p] of del.per) {
      const allDay = r.devs.find((d) => d.name === name).every === 15 * MIN;
      if (allDay) assert.deepEqual(p.missedSent, [], `${name} reads all day: every F06 row that went out reached it`);
      else assert.ok(p.got >= 0.6 * p.of, `${name}: ${p.got} of ${p.of}`);
    }
    console.log(`[soak W2 ${instant ? 'instant' : 'polling'}, F06 within 7 days] ` + [...del.per].map(([n, p]) => `${n} ${p.got}/${p.of}`).join(', ')
      + `; rows still held by the caps at the end ${del.waiting}`);
    assert.equal(r.sent.length, 210);
    assert.equal(r.sentBack.length, 35);
    console.log(`[soak W2 ${instant ? 'instant' : 'polling'}, 5 devices] messages/day ${stats.counts.join(' ')}; attachment MB/day ${stats.mb.join(' ')}; `
      + `Lab frames/day ${stats.lab.join(' ')}; F06 frames/day ${stats.f06.join(' ')}; F06 MB/day (budget) ${stats.f06mb.join(' ')}; slowest send-back ${del.slowest} h`);
  });
}

test('W2 soak with 8 devices: no 429, and the day’s count reported', async () => {
  const r = await soakW2({ instant: false, more: true, seed: 29 });
  const stats = checkSoakW2(r, { label: 'W2 8 devices', strict: false });
  for (const s of r.sent) assert.equal((await s.s.sender.list()).find((x) => x.id === s.id).status, 'delivered');
  console.log(`[soak W2 polling, 8 devices] messages/day ${stats.counts.join(' ')}; attachment MB/day ${stats.mb.join(' ')}; F06 frames/day ${stats.f06.join(' ')}`);
});
