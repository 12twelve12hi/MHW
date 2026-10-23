// The return lane (LAB-PROTOCOL 2.4; LAB-PLAN 4.1.1, L2): the returnLane and returnParse vectors, then the return
// Sender (the Daylight) and Receiver (a phone or computer) through the mock relay, case by case: L2.1-L2.8, F06.14.
// The W2 soak and the return matrix are in lab-skew.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ds from '../daylight-share.js';
import * as lab from '../daylight-lab.js';
import * as w1 from './fixtures/w1/daylight-share.js';
import { startMockRelay } from '../mock-relay.mjs';

const V = JSON.parse(readFileSync(new URL('../../vectors/lab-vectors.json', import.meta.url), 'utf8'));
const SEC = 1000, MIN = 60000, HOUR = 3600000, DAY = 86400000;
const fast = { retryDelaysMs: [0, 0, 0] };
const T0 = Date.UTC(2026, 9, 26, 6, 0, 0); // a Monday, 06:00 UTC
const pdf = (n, seed = 1) => new Uint8Array(n).map((_, i) => (i * 31 + seed * 7 + (i >> 9)) & 0xff);

// ---------------------------------------------------------------------------------------------------------------
// The vectors (every port runs the same ones)

test('returnParse vectors: returnItemExtras and returnAck, junk included (L2.8)', () => {
  const parse = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
  for (const c of V.returnParse.items) assert.deepEqual(ds.returnItemExtras(parse(c.headerJson)), c.expect, c.name);
  for (const c of V.returnParse.acks) assert.deepEqual(ds.returnAck(parse(c.headerJson)), c.expect, c.name);
  assert.ok(V.returnParse.items.length >= 20 && V.returnParse.acks.length >= 25);
});

test('returnLane vectors: topics, sealed frames, the worst device frame (L2.2, L2.5)', async () => {
  const L = V.returnLane;
  for (const t of L.topics) {
    const secret = ds.fromHex(t.secretHex);
    const k = await ds.deriveReturnKeys(secret);
    assert.equal(k.returnTopic, t.returnTopic);
    assert.equal(k.returnAckTopic, t.returnAckTopic);
    for (const [dev, topic] of Object.entries(t.devTopics)) {
      assert.equal(await ds.returnDevTopic(secret, dev), topic);
      assert.equal(await lab.returnDevTopic(secret, dev), topic);
    }
  }
  const secret = ds.fromHex(L.topics[0].secretHex);
  for (const dev of L.refusedDevs) await assert.rejects(ds.returnDevTopic(secret, dev), (e) => e.code === 'device');
  const keys = await ds.deriveKeys(secret);
  for (const f of L.frames) {
    const frame = await ds.sealFrame(keys, f.purpose, ds.utf8(f.headerJson), new Uint8Array(0), ds.fromHex(f.nonceHex));
    assert.equal(ds.toBase64(frame), f.frameBase64, f.name);
    assert.deepEqual((await ds.decryptFrame(keys, f.purpose, frame)).header, JSON.parse(f.headerJson));
    for (const p of f.refusedPurposes) await assert.rejects(ds.decryptFrame(keys, p, frame), (e) => e.code === 'frame', `${f.name} under ${p}`);
  }
  const w = L.worstAck;
  const header = JSON.parse(w.headerJson);
  const frame = await ds.buildReturnAckFrame(keys, { ids: header.ids, dev: header['x-dev'], from: header.from, sent: header.sent, rx: header['x-rx'], want: header['x-want'], nonce: ds.fromHex(w.nonceHex) });
  assert.equal(ds.toBase64(frame), w.frameBase64);
  assert.deepEqual([frame.length, ds.toBase64(frame).length, ds.isSmallFrame(frame)], [w.frameLength, w.base64Length, true]);
  assert.ok(w.base64Length <= ds.SMALL_FRAME_B64_MAX);
});

test('returnLane vectors: due, settle, devices, budget and cadence (L2.3, L2.4, L2.5, L2.7)', async () => {
  const L = V.returnLane;
  for (const [k, v] of Object.entries(L.constants)) assert.deepEqual(k in ds ? ds[k] : lab[k], v, k);
  for (const c of L.due) assert.equal(ds.returnDue(c.row, c.dev, c.heard, c.now), c.expect, c.name);
  for (const c of L.settle) assert.deepEqual(ds.settleReturnRow(c.row, c.now, (d) => c.settled.includes(d)), c.expect, c.name);
  for (const c of L.devices) {
    const rd = new lab.ReturnDevices({ storage: new ds.MemoryStorage(), now: () => c.now });
    for (const s of c.steps) await rd.record(s.ack, { time: s.time });
    const v = await rd.snapshot(c.now);
    assert.deepEqual(v.devices.map(({ dev, from, first, heard, rx, want, retired, current, n }) => ({ dev, from, first, heard, rx, want, retired, current, n })), c.expect.devices, c.name);
    assert.deepEqual(v.names, c.expect.names, c.name);
    assert.deepEqual(v.targets, c.expect.targets, c.name);
    for (const [d, s] of Object.entries(c.expect.settled)) assert.equal(v.settled(d), s, `${c.name}: settled ${d}`);
  }
  for (const c of L.budget) {
    let b = ds.newReturnBudget();
    for (const s of c.steps) {
      if (s.op === 'check') { assert.equal(ds.returnBudgetCheck(b, s.attempt, s.now), s.expect, c.name); continue; }
      if (s.op === 'charge') b = ds.chargeReturnBudget(b, s.frame, s.now);
      if (s.op === 'limit') b = ds.limitReturnBudget(b, s.status, s.now);
      if (s.op === 'bytes') b = ds.noteReturnBudgetBytes(b, s.bytes, s.now);
      assert.deepEqual(b, s.expect, c.name);
    }
  }
  for (const c of L.cadence) {
    let st = ds.newDeviceFrameState();
    for (const s of c.steps) {
      let frame = null;
      if (s.op === 'hello') Object.assign(st, { helloDue: true, off: false });
      if (s.op === 'limit' && (s.status === 429 || s.status === 413)) st.limitUntil = Math.max(st.limitUntil, s.now + ds.RETURN_YIELD_MS);
      if (s.op === 'off') {
        if (!st.off && st.firstHello) {
          const ids = st.pending.slice(0, 60);
          st = ds.deviceFramePublished(st, { now: s.now, time: s.time, ids, rx: false });
          frame = { reason: 'off', ids, want: false };
        }
        st.off = true;
      }
      if (s.op === 'read' && !st.off) {
        st = ds.deviceAfterRead(st, { ids: s.ids ?? [], stored: s.stored ?? {}, expired: s.expired ?? {} });
        const reason = ds.deviceFrameDue(st, s.now);
        if (reason) {
          const ids = st.pending.slice(0, 60);
          st = ds.deviceFramePublished(st, { now: s.now, time: s.time, ids, want: reason === 'want' });
          frame = { reason, ids, want: reason === 'want' };
        }
      }
      assert.deepEqual({ frame, state: st }, s.expect, `${c.name}: ${s.op} at ${s.now}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// A household on the mock relay: a Daylight (its return Sender and devices) and devices (return Receivers), each
// device fetching as its own visitor so the relay's logs say who downloaded what.

async function household({ offsetMs = 0, start = T0, failPublish = null, limits = {} } = {}) {
  let clock = start;
  const relayNow = () => clock;
  const relay = await startMockRelay({ now: relayNow, control: true, failPublish: (...a) => failPublish?.(...a) ?? null, ...limits });
  const pairing = { secret: ds.generateSecret(), relay: relay.url, name: 'Daylight' };
  const as = (visitor) => (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), 'X-Mock-Visitor': visitor } });
  const daylightNow = () => clock + offsetMs;
  const dl = new ds.MemoryStorage();
  const devices = new lab.ReturnDevices({ storage: dl, now: daylightNow });
  const back = new ds.Sender({ pairing, storage: dl, lane: 'return', devices, from: 'Anjan’s Daylight', app: 'android/2.0.0', now: daylightNow, fetch: as('daylight'), ...fast });
  const keys = await ds.deriveReturnKeys(pairing.secret);
  const made = {};
  async function device(name, { kinds, combined } = {}) {
    const storage = new ds.MemoryStorage();
    const dev = await lab.returnDeviceId(storage);
    const received = [];
    const rx = new ds.Receiver({
      pairing, storage, lane: 'return', device: { dev, from: name }, now: relayNow, fetch: as(name), ...fast, kinds, combined,
      accept: async (it) => { received.push({ id: it.header.id, kind: it.header.kind, sha256: it.header.sha256 ?? null, extras: it.extras, bytes: it.content.length }); },
    });
    const d = { name, dev, rx, storage, received, topic: await ds.returnDevTopic(pairing.secret, dev) };
    made[name] = d;
    return d;
  }
  /** Publishes a device frame directly (no cadence): for timing cases. -> its relay time (s). */
  async function frameFrom(d, { ids = [], want = false, rx = true } = {}) {
    const rc = new ds.RelayClient({ relay: relay.url, fetch: as(d.name), ...fast });
    const r = await rc.publish(keys.returnAckTopic, await ds.buildReturnAckFrame(keys, { ids, dev: d.dev, from: d.name, want, rx }));
    return r.time;
  }
  const publishesTo = (topic) => relay.state.publishLog.filter((p) => p.topic === topic);
  const downloadsBy = (visitor) => relay.state.downloadLog.filter((d) => d.visitor === visitor).map((d) => d.id);
  return {
    relay, pairing, keys, back, devices, device, frameFrom, publishesTo, downloadsBy, made,
    advance: (ms) => { clock += ms; }, now: relayNow, daylightNow, close: () => relay.close(),
  };
}

const rowOf = async (h, id) => (await h.back.list()).find((r) => r.id === id);

// ---------------------------------------------------------------------------------------------------------------
// L2.1, L2.2: lanes and keys

test('L2.1: without lane, Sender and Receiver read and write exactly W1’s keys and rows', async () => {
  const run = async (mod) => {
    const relay = await startMockRelay();
    try {
      const pairing = { secret: ds.fromHex('00112233445566778899aabbccddeeff'), relay: relay.url, name: 'Daylight' };
      const phone = new mod.MemoryStorage(), daylight = new mod.MemoryStorage();
      const s = new mod.Sender({ pairing, storage: phone, from: 'Phone', now: () => T0, ...fast });
      const r = new mod.Receiver({ pairing, storage: daylight, now: () => T0, ...fast });
      await s.send({ kind: 'url', url: 'https://example.com/a', title: 'A' });
      await s.send({ kind: 'file', name: 'b.pdf', mime: 'application/pdf', content: pdf(50000) });
      const got = await r.pollOnce();
      await s.checkAcks();
      const norm = (k) => k.replace(/[0-9a-f]{32}/, '<id>');
      const rows = (await s.list()).map(({ id, created, sent, lastPublish, attemptStarted, delivered, ...rest }) => rest); // eslint-disable-line no-unused-vars
      return { phone: [...phone.m.keys()].map(norm).sort(), daylight: [...daylight.m.keys()].map(norm).sort(), rows, items: got.items.length, acked: got.acked.length };
    } finally { await relay.close(); }
  };
  const before = await run(w1), now = await run(ds);
  assert.deepEqual(now, before);
  assert.deepEqual(now.phone, ['ackSince', 'outbox']);
  assert.equal(now.items, 2);
});

test('L2.2: a pairing-lane and a return-lane Sender (and Receiver) on one storage share no key', async () => {
  const h = await household();
  try {
    const shared = new ds.MemoryStorage();
    const pairingSender = new ds.Sender({ pairing: h.pairing, storage: shared, now: h.now, ...fast });
    const back = new ds.Sender({ pairing: h.pairing, storage: shared, lane: 'return', devices: new lab.ReturnDevices({ storage: shared, now: h.now }), now: h.now, ...fast });
    const inbox = new ds.Receiver({ pairing: h.pairing, storage: shared, now: h.now, ...fast });
    const iphone = await h.device('iPhone');
    await iphone.rx.hello();
    await back.checkAcks();
    const before = new Set(shared.m.keys());
    await pairingSender.send({ kind: 'url', url: 'https://example.com/to-the-daylight' });
    await inbox.pollOnce();
    await pairingSender.checkAcks();
    const pairingKeys = [...shared.m.keys()].filter((k) => !before.has(k));
    const r = await back.send({ kind: 'url', url: 'https://example.com/back' });
    const all = [...shared.m.keys()];
    const returnKeys = all.filter((k) => k.startsWith('lane/return/'));
    assert.ok(returnKeys.includes('lane/return/outbox') && returnKeys.includes('lane/return/devices'));
    assert.ok(pairingKeys.every((k) => !k.startsWith('lane/')));
    assert.deepEqual((await pairingSender.list()).map((x) => x.status), ['delivered']);
    assert.deepEqual((await back.list()).map((x) => x.id), [r.id], 'each Sender sees only its own rows');
    assert.equal((await pairingSender.list()).some((x) => x.id === r.id), false);
  } finally { await h.close(); }
});

test('L2.2: the shared and the device topics in one request (multi-topic) or two give the same items', async () => {
  for (const combined of [false, true]) {
    const h = await household();
    try {
      const iphone = await h.device('iPhone', { combined });
      await iphone.rx.hello();
      await h.back.checkAcks();
      const a = await h.back.send({ kind: 'url', url: 'https://example.com/everyone' });
      const b = await h.back.send({ kind: 'file', name: 'you.pdf', mime: 'application/pdf', content: pdf(30000) }, { to: iphone.dev });
      h.advance(MIN);
      await iphone.rx.pollOnce();
      assert.deepEqual(iphone.received.map((x) => x.id).sort(), [a.id, b.id].sort(), `combined ${combined}`);
      assert.equal(iphone.received.find((x) => x.id === b.id).extras.to, iphone.dev);
      const gets = h.relay.state.requests.filter((r) => r.startsWith('GET /dls-') && r.includes(iphone.topic));
      assert.equal(gets.some((r) => r.includes(',')), combined, 'one request for both topics only when combined');
    } finally { await h.close(); }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// L2.3: delivery per device

test('L2.3: per-device delivery: the iPhone’s ack leaves the row waiting for the Mac; no x-dev counts for nobody; the Mac’s x-rx: false completes it', async () => {
  const h = await household();
  try {
    const iphone = await h.device('iPhone'), mac = await h.device('Mac');
    await iphone.rx.hello(); await mac.rx.hello();
    await h.back.checkAcks();
    const row = await h.back.send({ kind: 'url', url: 'https://example.com/note', title: 'A note' });
    assert.deepEqual(row.to.slice().sort(), [iphone.dev, mac.dev].sort());
    assert.equal(row.status, 'sent');
    h.advance(31 * MIN);
    const r = await iphone.rx.pollOnce();
    assert.deepEqual([r.frame?.reason, r.acked], ['acks', [row.id]]);
    await h.back.tick();
    let now = await rowOf(h, row.id);
    assert.equal(now.status, 'sent');
    assert.deepEqual(Object.keys(now.got), [iphone.dev]);
    // An ack without x-dev: counts for no device.
    const rc = new ds.RelayClient({ relay: h.relay.url, ...fast });
    const keys = await ds.deriveKeys(h.pairing.secret);
    await rc.publish(h.keys.returnAckTopic, await ds.encryptFrame(keys, 'lab-return-ack', { v: 1, kind: 'ack', ids: [row.id], sent: ds.nowIso(h.now()), from: 'Mac' }, new Uint8Array(0)));
    await h.back.tick();
    now = await rowOf(h, row.id);
    assert.equal(now.status, 'sent');
    assert.deepEqual(Object.keys(now.got), [iphone.dev]);
    // The Mac turns F06 off: one x-rx: false frame completes the row.
    const off = await mac.rx.hello({ rx: false });
    assert.equal(off.published, true);
    await h.back.tick();
    now = await rowOf(h, row.id);
    assert.deepEqual([now.status, now.missing], ['delivered', []]);
    assert.deepEqual(await h.back.devices.targets(h.daylightNow()), [iphone.dev], 'the Mac is no longer a target');
    // Then the Mac reads nothing until its next hello.
    const later = await mac.rx.pollOnce();
    assert.equal(later.off, true);
  } finally { await h.close(); }
});

test('L2.3: a 7-day-old row acked by the iPhone alone is delivered, with the Mac missing; nobody: expired', async () => {
  const h = await household();
  try {
    const iphone = await h.device('iPhone'), mac = await h.device('Mac');
    await iphone.rx.hello(); await mac.rx.hello();
    await h.back.checkAcks();
    const a = await h.back.send({ kind: 'url', url: 'https://example.com/a' });
    const b = await h.back.send({ kind: 'url', url: 'https://example.com/b' });
    h.advance(31 * MIN);
    const read = await iphone.rx.pollOnce(); // the iPhone acks both; the Mac never shows up
    assert.deepEqual(read.acked.slice().sort(), [a.id, b.id].sort());
    await h.back.tick();
    assert.equal((await rowOf(h, a.id)).status, 'sent');
    h.advance(7 * DAY);
    await h.back.tick();
    const ra = await rowOf(h, a.id), rb = await rowOf(h, b.id);
    assert.deepEqual([ra.status, ra.missing], ['delivered', [mac.dev]]);
    assert.deepEqual(Object.keys(ra.got), [iphone.dev]);
    assert.deepEqual([rb.status, rb.missing], ['delivered', [mac.dev]]);
    const c = await h.back.send({ kind: 'url', url: 'https://example.com/c' });
    h.advance(7 * DAY + MIN);
    await h.back.tick();
    assert.deepEqual([(await rowOf(h, c.id)).status, (await rowOf(h, c.id)).missing.length], ['expired', 2], 'nobody acked: expired');
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// L2.4: re-sends follow presence, on the device's own topic, with one follow-up after an x-want

async function windowCase({ attachment, heardAfterH, offsetMs }) {
  const h = await household({ offsetMs });
  try {
    const iphone = await h.device('iPhone'), mac = await h.device('Mac');
    await h.frameFrom(iphone); await h.frameFrom(mac);
    await h.back.checkAcks();
    const item = attachment ? { kind: 'file', name: 'p.pdf', mime: 'application/pdf', content: pdf(40000) } : { kind: 'url', url: 'https://example.com/m' };
    const row = await h.back.send(item);
    assert.equal(row.attachment, attachment);
    const firstTime = h.publishesTo(h.keys.returnTopic).at(-1).time;
    h.advance(heardAfterH * HOUR);
    const t = await h.frameFrom(mac);
    assert.equal(t, firstTime + heardAfterH * 3600);
    await h.back.tick();
    const resends = h.publishesTo(mac.topic);
    return { resends: resends.length, h, row, iphone, mac };
  } finally { await h.close(); }
}

test('L2.4: the copy windows: 2.9 h no re-send and 3.1 h a re-send for an attachment; 11.9 h and 12.1 h for a message; the Daylight’s clock 5 h off changes nothing', async () => {
  for (const offsetMs of [0, 5 * HOUR, -5 * HOUR]) {
    assert.equal((await windowCase({ attachment: true, heardAfterH: 2.9, offsetMs })).resends, 0, `attachment 2.9 h, offset ${offsetMs}`);
    assert.equal((await windowCase({ attachment: true, heardAfterH: 3.1, offsetMs })).resends, 1, `attachment 3.1 h, offset ${offsetMs}`);
    assert.equal((await windowCase({ attachment: false, heardAfterH: 11.9, offsetMs })).resends, 0, `message 11.9 h, offset ${offsetMs}`);
    assert.equal((await windowCase({ attachment: false, heardAfterH: 12.1, offsetMs })).resends, 1, `message 12.1 h, offset ${offsetMs}`);
  }
});

test('L2.4: the re-send goes on the Mac’s own topic with x-to; the iPhone downloads nothing of it, and a frame that acks the row in the same read gets none', async () => {
  const h = await household();
  try {
    const iphone = await h.device('iPhone'), mac = await h.device('Mac');
    await iphone.rx.hello(); await mac.rx.hello();
    h.advance(MIN); // the Daylight hears the hellos, then sends: its copy is newer than their first frames
    await h.back.checkAcks();
    const row = await h.back.send({ kind: 'file', name: 'p.pdf', mime: 'application/pdf', content: pdf(3_000_000) });
    assert.equal(row.frames, 2);
    h.advance(31 * MIN);
    await iphone.rx.pollOnce(); // the iPhone gets and acks the first copy
    h.advance(4 * HOUR); // the Mac was away: its copy is gone
    const read = await mac.rx.pollOnce();
    assert.equal(read.frame?.reason, 'want', 'it finds the expired copy and asks for it again (x-want)');
    await h.back.tick();
    const resend = h.publishesTo(mac.topic);
    assert.equal(resend.length, 2, 'both parts, on the Mac’s topic');
    h.advance(MIN);
    const got = await mac.rx.pollOnce();
    assert.deepEqual(got.items.map((i) => i.header.id), [row.id]);
    assert.equal(got.items[0].extras.to, mac.dev);
    assert.equal(mac.received[0].sha256, ds.toHex(await ds.sha256(pdf(3_000_000))));
    const resendIds = new Set(resend.map((p) => p.id));
    assert.deepEqual(h.downloadsBy('iPhone').filter((id) => resendIds.has(id)), [], 'the iPhone downloads nothing of the re-send');
    assert.equal(h.downloadsBy('Mac').filter((id) => resendIds.has(id)).length, 2);
    // The iPhone's ack frame and a later frame of its own cause no re-send to it.
    h.advance(DAY);
    await h.frameFrom(iphone);
    await h.back.tick();
    assert.equal(h.publishesTo(iphone.topic).length, 0);
  } finally { await h.close(); }
});

test('L2.4: after a re-send that an x-want caused, one follow-up 185 minutes later if no ack came, then none', async () => {
  for (const offsetMs of [0, 5 * HOUR]) {
    const h = await household({ offsetMs });
    try {
      const mac = await h.device('Mac');
      await h.frameFrom(mac);
      await h.back.checkAcks();
      const row = await h.back.send({ kind: 'file', name: 'p.pdf', mime: 'application/pdf', content: pdf(40000) });
      h.advance(4 * HOUR);
      await h.frameFrom(mac, { want: true });
      await h.back.tick();
      assert.equal(h.publishesTo(mac.topic).length, 1, 'the re-send');
      let r = await rowOf(h, row.id);
      const fu = r.followUps[mac.dev];
      assert.equal(fu, h.daylightNow() + ds.RETURN_FOLLOW_UP_MS);
      h.advance(ds.RETURN_FOLLOW_UP_MS - MIN);
      await h.back.tick();
      assert.equal(h.publishesTo(mac.topic).length, 1, 'not before 185 minutes');
      h.advance(MIN);
      await h.back.tick();
      assert.equal(h.publishesTo(mac.topic).length, 2, 'the follow-up');
      r = await rowOf(h, row.id);
      assert.equal(r.followUps[mac.dev], undefined);
      h.advance(ds.RETURN_FOLLOW_UP_MS + HOUR);
      await h.back.tick();
      assert.equal(h.publishesTo(mac.topic).length, 2, 'then none');
      // A frame without x-want after the copy is gone: a re-send, and no follow-up.
      h.advance(3 * HOUR);
      await h.frameFrom(mac);
      await h.back.tick();
      assert.equal(h.publishesTo(mac.topic).length, 3);
      assert.equal((await rowOf(h, row.id)).followUps[mac.dev], undefined);
    } finally { await h.close(); }
  }
});

test('F06.14: an iPhone opened for a minute 5 hours later and again 9 hours later gets the file at the second opening, from the follow-up', async () => {
  const h = await household();
  try {
    const iphone = await h.device('iPhone');
    await iphone.rx.hello();
    h.advance(MIN);
    await h.back.checkAcks();
    const row = await h.back.send({ kind: 'file', name: 'paper.pdf', mime: 'application/pdf', content: pdf(5_000_000) });
    const t0 = h.now();
    const opened = [5 * HOUR, 9 * HOUR];
    let got = null;
    for (let t = 15 * MIN; t <= 10 * HOUR; t += 30 * SEC) {
      h.advance(t0 + t - h.now());
      if (t % (15 * MIN) === 0) await h.back.tick(); // the Daylight's 15-minute run
      for (const o of opened) {
        if (t >= o && t <= o + MIN) { // the app is in front for a minute: reads every 30 s
          const r = await iphone.rx.pollOnce();
          if (r.items.length) got = { t, opening: opened.indexOf(o) };
        }
      }
    }
    assert.deepEqual(got && { opening: got.opening, id: iphone.received[0].id }, { opening: 1, id: row.id });
    const resends = h.publishesTo(iphone.topic).map((p) => Math.round((p.time * 1000 - t0) / MIN));
    assert.equal(new Set(resends).size, 2, `a re-send and its follow-up (minutes ${[...new Set(resends)]})`);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// L2.5: a device's frames

test('L2.5: a device publishes only right after a read, at most 3 a day with the third for x-want, acks 30 minutes apart, the idle hello after 24 h', async () => {
  const h = await household();
  try {
    const iphone = await h.device('iPhone');
    const frames = () => h.publishesTo(h.keys.returnAckTopic).length;
    await iphone.rx.hello();
    assert.equal(frames(), 1, 'the first hello: after its read');
    await h.back.checkAcks();
    for (let k = 0; k < 4; k++) await h.back.send({ kind: 'url', url: `https://example.com/${k}` });
    h.advance(10 * MIN);
    let r = await iphone.rx.pollOnce();
    assert.equal(r.frame, null, 'acks wait 30 minutes after the last frame');
    h.advance(20 * MIN);
    r = await iphone.rx.pollOnce();
    assert.equal(r.frame.reason, 'acks');
    assert.equal(r.acked.length, 4);
    await h.back.send({ kind: 'url', url: 'https://example.com/5' });
    h.advance(HOUR);
    r = await iphone.rx.pollOnce();
    assert.equal(r.frame, null, 'two frames today: the third is kept for x-want');
    assert.equal(frames(), 2);
    // An expired attachment newer than its first frame: the third frame, with x-want.
    const f = await h.back.send({ kind: 'file', name: 'p.pdf', mime: 'application/pdf', content: pdf(40000) });
    h.advance(4 * HOUR);
    r = await iphone.rx.pollOnce();
    assert.deepEqual([r.frame?.reason, r.frame?.want], ['want', true]);
    assert.ok(r.frame.ids.length >= 1, 'it carries the pending acks too');
    h.advance(HOUR);
    await h.back.tick();
    assert.equal((await rowOf(h, f.id)).resent, 1, 'the Daylight re-sends it on the iPhone’s topic');
    const day1 = frames();
    assert.equal(day1, 3);
    // Next day: the idle hello only after 24 h without a frame.
    h.advance(DAY);
    r = await iphone.rx.pollOnce();
    assert.ok(r.items.length === 0 || r.items.every((i) => i.header.id === f.id));
    assert.ok(r.frame, 'acks or the idle hello');
    const st = await iphone.rx.frameState();
    assert.ok(st.count <= 3);
    // Every device frame is small, and no day has more than 3.
    const perDay = new Map();
    for (const p of h.publishesTo(h.keys.returnAckTopic)) { const d = new Date(p.time * 1000).toISOString().slice(0, 10); perDay.set(d, (perDay.get(d) ?? 0) + 1); }
    assert.ok([...perDay.values()].every((n) => n <= 3), JSON.stringify([...perDay]));
    assert.ok(h.publishesTo(h.keys.returnAckTopic).every((p) => !p.attachment));
  } finally { await h.close(); }
});

test('L2.5: no x-want for an expired copy older than the device’s first frame; one x-rx: false when Lab goes off, even past the cap', async () => {
  const h = await household();
  try {
    const mac = await h.device('Mac'), late = await h.device('Late Mac');
    await mac.rx.hello();
    h.advance(MIN);
    await h.back.checkAcks();
    await h.back.send({ kind: 'file', name: 'old.pdf', mime: 'application/pdf', content: pdf(40000) });
    h.advance(4 * HOUR);
    let r = await late.rx.hello(); // a device that joins after the copy expired
    assert.equal(r.want, false, 'sent before it joined: no x-want');
    assert.equal(r.frame.reason, 'first');
    // The Mac uses its three frames, then Lab goes off: one more frame, x-rx false.
    r = await mac.rx.pollOnce();
    assert.equal(r.frame.reason, 'want');
    h.advance(HOUR);
    await h.back.tick();
    h.advance(MIN);
    r = await mac.rx.pollOnce();
    assert.equal(r.items.length, 1);
    assert.equal(r.frame, null, 'its acks wait: two frames used for acks and hellos is the cap');
    assert.equal((await mac.rx.frameState()).count, 2);
    h.advance(30 * MIN);
    r = await late.rx.pollOnce();
    const before = h.publishesTo(h.keys.returnAckTopic).length;
    const off = await mac.rx.hello({ rx: false });
    assert.equal(off.published, true);
    assert.equal(h.publishesTo(h.keys.returnAckTopic).length, before + 1);
    const again = await mac.rx.hello({ rx: false });
    assert.equal(again.published, false, 'once');
    await h.back.checkAcks();
    const snap = await h.devices.snapshot(h.daylightNow());
    assert.equal(snap.settled(mac.dev), true);
    assert.deepEqual(snap.targets, [late.dev]);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// L2.6: replaces

test('L2.6: replaces removes every older un-delivered row with the same key, and its content', async () => {
  const h = await household();
  try {
    const iphone = await h.device('iPhone');
    await iphone.rx.hello();
    await h.back.checkAcks();
    const m1 = await h.back.send({ kind: 'file', rk: 'queue', name: 'queue.json', mime: 'application/vnd.daylight.queue+json', content: '{"v":1,"n":1}' }, { replaces: 'queue' });
    const other = await h.back.send({ kind: 'url', url: 'https://example.com/keep' });
    assert.ok(await h.back.storage.get(`lane/return/outbox/${m1.id}`));
    const m2 = await h.back.send({ kind: 'file', rk: 'queue', name: 'queue.json', mime: 'application/vnd.daylight.queue+json', content: '{"v":1,"n":2}' }, { replaces: 'queue' });
    const ids = (await h.back.list()).map((r) => r.id);
    assert.deepEqual(ids.sort(), [other.id, m2.id].sort());
    assert.equal(await h.back.storage.get(`lane/return/outbox/${m1.id}`), undefined, 'its content too');
    // A W2 device acks and drops the queue manifest (it knows only share), and stores the link.
    h.advance(31 * MIN);
    const r = await iphone.rx.pollOnce();
    assert.deepEqual(r.items.map((i) => i.header.id), [other.id]);
    assert.ok(r.acked.includes(m2.id), 'an unknown kind is acked');
    await h.back.tick();
    assert.equal((await rowOf(h, m2.id)).status, 'delivered');
    // A delivered manifest is kept when a newer one replaces it; pairing-lane Senders take replaces too.
    const m3 = await h.back.send({ kind: 'file', rk: 'queue', name: 'queue.json', mime: 'application/vnd.daylight.queue+json', content: '{"v":1,"n":3}' }, { replaces: 'queue' });
    assert.ok((await h.back.list()).some((x) => x.id === m2.id) && (await h.back.list()).some((x) => x.id === m3.id));
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// L2.7: the caps and giving way

test('L2.7: the 13th F06 frame of a day waits until the next UTC day; a 5-part row with 4 frames left waits whole', async () => {
  const h = await household({ start: Date.UTC(2026, 9, 26, 1, 0, 0) });
  try {
    const iphone = await h.device('iPhone');
    await iphone.rx.hello();
    await h.back.checkAcks();
    const links = [];
    for (let k = 0; k < 8; k++) links.push(await h.back.send({ kind: 'url', url: `https://example.com/${k}` }));
    const big = await h.back.send({ kind: 'file', name: 'big.pdf', mime: 'application/pdf', content: pdf(9_000_000) });
    assert.equal(big.frames, 5);
    assert.deepEqual([big.status, big.errorCode, big.wait], ['failed', 'cap', 'cap'], '8 + 5 > 12: it waits whole');
    assert.equal(h.publishesTo(h.keys.returnTopic).length, 8, 'no part of it went');
    for (let k = 8; k < 12; k++) links.push(await h.back.send({ kind: 'url', url: `https://example.com/${k}` }));
    assert.ok(links.every((l) => l.status === 'sent'), 'a later row that fits goes');
    const thirteenth = await h.back.send({ kind: 'url', url: 'https://example.com/13' });
    assert.deepEqual([thirteenth.status, thirteenth.wait], ['failed', 'cap']);
    h.advance(2 * HOUR);
    await h.back.tick();
    assert.equal((await rowOf(h, thirteenth.id)).status, 'failed', 'still today');
    h.advance(Date.UTC(2026, 9, 27, 0, 1) - h.now());
    await h.back.tick();
    assert.equal((await rowOf(h, big.id)).status, 'sent', 'the oldest first, the next day');
    assert.equal((await rowOf(h, thirteenth.id)).status, 'sent');
    assert.equal((await h.back.budget()).frames, 6);
  } finally { await h.close(); }
});

test('L2.7: F06 bytes past 60 MB a day wait (an attachment counts once plus once per downloader), and go the next day', async () => {
  const h = await household({ start: Date.UTC(2026, 9, 26, 0, 30, 0) });
  try {
    for (const n of ['iPhone', 'Mac', 'Android', 'Windows', 'Chrome']) await h.frameFrom(await h.device(n));
    await h.back.checkAcks();
    const a = await h.back.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: pdf(8_000_000, 1) });
    assert.equal(a.status, 'sent');
    let b = await h.back.budget();
    assert.ok(b.bytes > 48_000_000 && b.bytes < 48_100_000, `8 MB to 5 devices counts 6 times: ${b.bytes}`);
    h.advance(3 * HOUR); // its copy is off the relay, so only the day's bytes count now
    const big = await h.back.send({ kind: 'file', name: 'b.pdf', mime: 'application/pdf', content: pdf(2_200_000, 2) });
    assert.deepEqual([big.status, big.wait], ['failed', 'cap'], '48 + 2.2 x 6 > 60 MB');
    const link = await h.back.send({ kind: 'url', url: 'https://example.com/fits' });
    assert.equal(link.status, 'sent', 'a row with no attachment still fits');
    h.advance(Date.UTC(2026, 9, 27, 0, 5) - h.now());
    await h.back.tick();
    assert.equal((await rowOf(h, big.id)).status, 'sent');
    b = await h.back.budget();
    assert.ok(b.bytes > 13_200_000 && b.bytes < 13_300_000, `${b.bytes}`);
  } finally { await h.close(); }
});

test('L2.7: an attachment row waits while the attachments on the relay (its own and those the Daylight downloaded) would pass 10 MB', async () => {
  const h = await household();
  try {
    const mac = await h.device('Mac');
    await h.frameFrom(mac);
    await h.back.checkAcks();
    await h.back.noteRelayBytes(5_700_000); // three parts of the phone's PDF the Daylight downloaded
    const row = await h.back.send({ kind: 'file', name: 'p.pdf', mime: 'application/pdf', content: pdf(4_500_000) });
    assert.deepEqual([row.status, row.errorCode, row.wait], ['failed', 'relay', 'relay']);
    const link = await h.back.send({ kind: 'url', url: 'https://example.com/a-link' });
    assert.equal(link.status, 'sent', 'a link has no attachment: it goes');
    h.advance(2 * HOUR);
    await h.back.tick();
    assert.equal((await rowOf(h, row.id)).status, 'failed');
    h.advance(HOUR + MIN);
    await h.back.tick();
    assert.equal((await rowOf(h, row.id)).status, 'sent', 'once the downloaded bytes are off the relay');
    const live = ds.returnLiveBytes(await h.back.budget(), h.daylightNow());
    assert.ok(live > 4_500_000 && live < 4_600_000);
  } finally { await h.close(); }
});

test('L2.7: a device’s 7th re-sent frame of a day waits; another device’s re-sends still go', async () => {
  const h = await household({ start: Date.UTC(2026, 9, 26, 0, 30, 0) });
  try {
    const mac = await h.device('Mac'), iphone = await h.device('iPhone');
    await h.frameFrom(mac); await h.frameFrom(iphone);
    await h.back.checkAcks();
    const rows = [];
    for (let k = 0; k < 4; k++) rows.push(await h.back.send({ kind: 'url', url: `https://example.com/${k}` }));
    // Day 1: the Mac and the iPhone show up after every copy is gone (12 h): 4 re-sends each.
    h.advance(Date.UTC(2026, 9, 27, 0, 30) - h.now());
    await h.frameFrom(mac); await h.frameFrom(iphone);
    await h.back.tick();
    assert.equal(h.publishesTo(mac.topic).length, 4);
    assert.equal(h.publishesTo(iphone.topic).length, 4);
    // 13 h later, again: the Mac gets 2 more (its 6 for the day), the iPhone 2 as well (8 frames + 4 = 12 for the day).
    h.advance(13 * HOUR);
    await h.frameFrom(mac);
    await h.back.tick();
    assert.equal(h.publishesTo(mac.topic).length, 6, 'the Mac’s 6 re-sent frames for the day');
    const budget = await h.back.budget();
    assert.equal(budget.resends[mac.dev], 6);
    const waiting = (await h.back.list()).filter((r) => r.wait === 'cap');
    assert.equal(waiting.length, 2, 'two rows wait for the Mac until tomorrow');
    await h.frameFrom(iphone);
    await h.back.tick();
    assert.equal(h.publishesTo(iphone.topic).length, 6, 'the iPhone’s re-sends still go: it has its own 6');
    assert.equal((await h.back.budget()).frames, 12);
  } finally { await h.close(); }
});

test('L2.7: after a 413 on any publish (a re-send included), no F06 attachment goes for an hour, and the phone’s own sends still go', async () => {
  let fail = null;
  const h = await household({ failPublish: (topic, n, isAttachment) => (fail && fail(topic, isAttachment) ? 413 : null) });
  try {
    const mac = await h.device('Mac');
    await h.frameFrom(mac);
    await h.back.checkAcks();
    const row = await h.back.send({ kind: 'file', name: 'p.pdf', mime: 'application/pdf', content: pdf(40000) });
    h.advance(4 * HOUR);
    await h.frameFrom(mac);
    let once = true;
    fail = (topic) => topic === mac.topic && once && !(once = false);
    await h.back.tick(); // the re-send gets a 413
    assert.equal((await rowOf(h, row.id)).http, 413);
    assert.equal((await h.back.budget()).limitUntil, h.daylightNow() + HOUR);
    const other = await h.back.send({ kind: 'file', name: 'q.pdf', mime: 'application/pdf', content: pdf(40000, 3) });
    assert.deepEqual([other.status, other.wait], ['failed', 'yield'], 'nothing goes for an hour');
    // The phone's own send to the Daylight (the pairing lane) still goes.
    const phone = new ds.Sender({ pairing: h.pairing, storage: new ds.MemoryStorage(), now: h.now, ...fast });
    assert.equal((await phone.send({ kind: 'file', name: 'mine.pdf', mime: 'application/pdf', content: pdf(40000, 4) })).status, 'sent');
    h.advance(59 * MIN);
    await h.back.tick();
    assert.equal((await rowOf(h, other.id)).status, 'failed');
    h.advance(MIN);
    await h.back.tick();
    assert.equal((await rowOf(h, other.id)).status, 'sent');
    assert.equal(h.publishesTo(mac.topic).length, 0, 'the re-send the 413 refused waits for the Mac, not for the hour');
    await h.frameFrom(mac);
    await h.back.tick();
    assert.equal(h.publishesTo(mac.topic).length, 1, 'it goes once the Mac is heard again');
    // The Inbox's own 429 (its acks, its Lab frames) makes the return lane give way as well.
    await h.back.noteRelayLimit(429);
    const third = await h.back.send({ kind: 'url', url: 'https://example.com/later' });
    assert.equal(third.wait, 'yield');
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// L2.8: x-to

test('L2.8: a frame whose x-to names another device is skipped before dedupe: neither stored nor acked, a duplicate included', async () => {
  const h = await household();
  try {
    const iphone = await h.device('iPhone'), mac = await h.device('Mac');
    await iphone.rx.hello();
    await h.back.checkAcks();
    const row = await h.back.send({ kind: 'url', url: 'https://example.com/shared' });
    h.advance(31 * MIN);
    await iphone.rx.pollOnce(); // stored and acked
    // Copies of the same id that name the Mac: on the shared topic and on the iPhone's own topic.
    const keys = await ds.deriveKeys(h.pairing.secret);
    const rc = new ds.RelayClient({ relay: h.relay.url, ...fast });
    const header = { v: 1, id: row.id, kind: 'url', url: 'https://example.com/shared', sent: ds.nowIso(h.now()), 'x-rk': 'share', 'x-to': mac.dev };
    await rc.publish(h.keys.returnTopic, await ds.encryptFrame(keys, 'lab-return', header, new Uint8Array(0)));
    await rc.publish(iphone.topic, await ds.encryptFrame(keys, 'lab-return-dev', header, new Uint8Array(0)));
    const other = { ...header, id: ds.newItemId(), url: 'https://example.com/for-the-mac' };
    await rc.publish(h.keys.returnTopic, await ds.encryptFrame(keys, 'lab-return', other, new Uint8Array(0)));
    const junk = { ...other, id: ds.newItemId(), 'x-to': mac.dev.toUpperCase() };
    await rc.publish(h.keys.returnTopic, await ds.encryptFrame(keys, 'lab-return', junk, new Uint8Array(0)));
    h.advance(MIN);
    const r = await iphone.rx.pollOnce();
    assert.deepEqual(r.items, []);
    const st = await iphone.rx.frameState();
    assert.deepEqual(st.pending, [], 'not acked again: the duplicate for the Mac was skipped before dedupe');
    assert.equal(iphone.received.length, 1);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// No device yet, pairing changes, the Lab frame cap

test('No device yet: a row waits (no-device), goes to the first device heard within 24 hours, else it is removed', async () => {
  const h = await household();
  try {
    const row = await h.back.send({ kind: 'file', name: 'p.pdf', mime: 'application/pdf', content: pdf(40000) });
    assert.deepEqual([row.status, row.errorCode, row.wait, row.to], ['failed', 'no-device', 'no-device', []]);
    assert.equal(h.publishesTo(h.keys.returnTopic).length, 0, 'nothing published');
    h.advance(5 * HOUR);
    const mac = await h.device('Mac');
    await mac.rx.hello();
    await h.back.tick(); // the card reads returnAckTopic once first: a hello of a moment ago counts
    const r = await rowOf(h, row.id);
    assert.deepEqual([r.status, r.to], ['sent', [mac.dev]]);
    h.advance(MIN);
    await mac.rx.pollOnce();
    assert.deepEqual(mac.received.map((x) => x.id), [row.id]);
    // With nobody for 24 hours: removed, with its content.
    const h2 = await household();
    try {
      const lonely = await h2.back.send({ kind: 'file', name: 'q.pdf', mime: 'application/pdf', content: pdf(40000) });
      h2.advance(24 * HOUR);
      await h2.back.tick();
      assert.ok(await rowOf(h2, lonely.id), 'still waiting at 24 h');
      h2.advance(MIN);
      await h2.back.tick();
      assert.equal(await rowOf(h2, lonely.id), undefined);
      assert.equal(await h2.back.storage.get(`lane/return/outbox/${lonely.id}`), undefined);
    } finally { await h2.close(); }
  } finally { await h.close(); }
});

test('Pairing changes: a new secret removes lane/return/* and the device id; the same secret keeps them', async () => {
  const h = await household();
  try {
    const iphone = await h.device('iPhone');
    await iphone.rx.hello();
    await h.back.checkAcks();
    await h.back.send({ kind: 'url', url: 'https://example.com/x' });
    h.advance(MIN);
    await iphone.rx.pollOnce();
    const keysOf = (st) => [...st.m.keys()].filter((k) => k.startsWith('lane/'));
    assert.ok(keysOf(iphone.storage).includes('lane/return/devId'));
    assert.equal(await ds.applyPairingChange(iphone.storage, h.pairing, { ...h.pairing, relay: h.relay.url + '/' }), false);
    assert.ok(keysOf(iphone.storage).length > 3, 'the same secret keeps them');
    assert.equal(await ds.applyPairingChange(iphone.storage, h.pairing, { secret: ds.generateSecret(), relay: h.relay.url }), true);
    assert.deepEqual(keysOf(iphone.storage), []);
    const fresh = await lab.returnDeviceId(iphone.storage);
    assert.notEqual(fresh, iphone.dev, 'a new device id');
    assert.ok(keysOf(h.back.storage).length >= 4);
    assert.equal(await ds.applyPairingChange(h.back.storage, h.pairing, { secret: ds.generateSecret(), relay: h.relay.url }), true);
    assert.deepEqual(keysOf(h.back.storage), [], 'the Daylight’s return outbox, budget and devices too');
  } finally { await h.close(); }
});

test('LabInbox takes framesPerDay: 18 while the hello carries return (2.2.4)', async () => {
  const relay = await startMockRelay();
  try {
    let clock = Date.UTC(2026, 9, 26, 0, 0, 0);
    const pairing = { secret: ds.generateSecret(), relay: relay.url };
    const keys = await ds.deriveKeys(pairing.secret);
    let caps = ['st', 'tap', 'return'];
    const inbox = new lab.LabInbox({
      storage: new ds.MemoryStorage(), relay: new ds.RelayClient({ relay: relay.url, ...fast }), keys, now: () => clock, autoFlushMs: null,
      info: () => ({ lab: 1, app: 'android/2.0.0', caps }), framesPerDay: () => (caps.includes('return') ? lab.LAB_FRAMES_PER_DAY_RETURN : lab.LAB_FRAMES_PER_DAY),
    });
    let sent = 0;
    for (let k = 0; k < 40; k++) {
      await inbox.record(ds.newItemId(), 'reader', Math.floor(clock / 1000));
      const r = await inbox.flush();
      sent += r.published;
      clock += MIN;
    }
    assert.equal(sent, 18);
    caps = ['st', 'tap', 'return-off'];
    for (let k = 0; k < 20; k++) {
      await inbox.record(ds.newItemId(), 'reader', Math.floor(clock / 1000));
      sent += (await inbox.flush()).published;
      clock += MIN;
    }
    assert.equal(sent, 30, 'back to 30 without the return lane (one hello for the new caps among them)');
  } finally { await relay.close(); }
});
