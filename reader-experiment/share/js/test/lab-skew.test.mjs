// F17 version skew and the household soak (LAB-PROTOCOL 2.8), through the mock relay with ntfy.sh's limits.
// - The matrix: {v1.0 Sender, v1.1 Sender, Lab Sender} x {v1.0 Receiver, v1.1 Receiver, LabInboxSim} x {url, page,
//   file}. The v1.0 and v1.1 peers are the references as they shipped (fixtures/), so this proves what apps in the
//   field do with Lab frames.
// - Two Lab publishers on one ack topic (Daylight Share and the Lab Reader), in both handover orders (5.3.4).
// - The soak: 7 simulated days of a busy household behind one address, polling every 15 minutes and with Instant
//   delivery, then again with a forced 429.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ds from '../daylight-share.js';
import * as lab from '../daylight-lab.js';
import * as v10 from './fixtures/daylight-share-v1.0.js';
import * as v11 from './fixtures/daylight-share-v1.1.js';
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
