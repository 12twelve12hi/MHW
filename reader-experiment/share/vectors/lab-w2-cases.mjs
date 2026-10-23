// The W2 (L2) vector cases: lab-vectors.json's returnParse and returnLane sections (LAB-PROTOCOL 2.4). generate-lab.mjs
// imports this and writes them; every expectation comes from the JavaScript reference (../js/daylight-share.js and
// ../js/daylight-lab.js), and the asserts below pin the cases LAB-PLAN 4.1.1 names (L2.2-L2.8).

import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as ds from '../js/daylight-share.js';
import * as lab from '../js/daylight-lab.js';
import { startMockRelay } from '../js/mock-relay.mjs';

const h = (s) => createHash('sha256').update(s).digest();
const secretFrom = (label) => new Uint8Array(h(label).subarray(0, 16));
const nonceFrom = (label) => new Uint8Array(h('return-nonce/' + label).subarray(0, 12));
const idFrom = (label) => h('return-id/' + label).toString('hex').slice(0, 32);
const J = (o) => JSON.stringify(o);
const SENT = '2026-10-23T08:00:00.000Z';
const T = 1792742400; // 2026-10-23T08:00:00Z in Unix seconds: a relay time
const HOUR = 3600000, MIN = 60000, DAY = 86400000;
const D1 = '0f1e2d3c4b5a6978', D2 = 'a1b2c3d4e5f60718', D3 = '00000000000000ff';

export async function buildW2() {
  // -------------------------------------------------------------------------------------------------------------
  // returnParse (2.4.5): headers as JSON text -> returnItemExtras and returnAck

  const item = (o = {}) => ({ v: 1, id: idFrom('item'), kind: 'url', url: 'https://example.com/from-the-daylight', sent: SENT, from: 'Daylight', ...o });
  const itemCases = [
    ['share, no x-to: every device', J(item({ 'x-rk': 'share' }))],
    ['x-to of this device', J(item({ 'x-rk': 'share', 'x-to': D1 }))],
    ['x-to of 15 digits: invalid', J(item({ 'x-rk': 'share', 'x-to': D1.slice(1) }))],
    ['x-to of 17 digits: invalid', J(item({ 'x-rk': 'share', 'x-to': D1 + '0' }))],
    ['x-to in upper case: invalid', J(item({ 'x-rk': 'share', 'x-to': D2.toUpperCase() }))],
    ['x-to a number: invalid', `{"v":1,"id":"${idFrom('item')}","kind":"url","url":"https://example.com/x","sent":"${SENT}","x-rk":"share","x-to":1234567890123456}`],
    ['x-to null: invalid (present, not a device)', J(item({ 'x-rk': 'share', 'x-to': null }))],
    ['x-to empty: invalid', J(item({ 'x-rk': 'share', 'x-to': '' }))],
    ['x-to with spaces: invalid', J(item({ 'x-rk': 'share', 'x-to': ` ${D1}` }))],
    ['x-rk unknown: unknown', J(item({ 'x-rk': 'notes' }))],
    ['x-rk absent: unknown', J(item())],
    ['x-rk in upper case: unknown', J(item({ 'x-rk': 'SHARE' }))],
    ['x-rk a number: unknown', J(item({ 'x-rk': 1 }))],
    ['x-rk marks', J(item({ kind: 'file', 'x-rk': 'marks' }))],
    ['x-rk queue', J(item({ kind: 'file', 'x-rk': 'queue' }))],
    ['x-rk reading', J(item({ kind: 'file', 'x-rk': 'reading' }))],
    ['a later part: x-to read here too', J(item({ kind: 'file', part: 2, parts: 3, 'x-rk': 'share', 'x-to': D2 }))],
    ['not an object: an array', '[{"x-rk":"share"}]'],
    ['not an object: a string', '"x-rk"'],
    ['not an object: null', 'null'],
  ];
  const ack = (o = {}) => ({ v: 1, kind: 'ack', ids: [idFrom('a1'), idFrom('a2')], sent: SENT, from: 'Anjan’s iPhone', 'x-dev': D1, ...o });
  const many = (n) => Array.from({ length: n }, (_, k) => idFrom('many-' + k));
  const ackCases = [
    ['a device frame', J(ack())],
    ['a hello: ids []', J(ack({ ids: [] }))],
    ['x-want true', J(ack({ 'x-want': true }))],
    ['x-want 1: false', J(ack({ 'x-want': 1 }))],
    ['x-want "true": false', J(ack({ 'x-want': 'true' }))],
    ['x-rx false', J(ack({ 'x-rx': false }))],
    ['x-rx 0: true', J(ack({ 'x-rx': 0 }))],
    ['x-rx "false": true', J(ack({ 'x-rx': 'false' }))],
    ['x-rx null: true', J(ack({ 'x-rx': null }))],
    ['61 ids: the first 60 read', J(ack({ ids: many(61) }))],
    ['junk among the first 60 elements: the valid ones of those 60', J(ack({ ids: ['junk', 5, null, ...many(59)] }))],
    ['ids that are not strings', `{"v":1,"kind":"ack","ids":[1,true,null,{"i":"${idFrom('a1')}"},["${idFrom('a2')}"],"${idFrom('a3')}"],"sent":"${SENT}","x-dev":"${D1}"}`],
    ['ids in upper case or of the wrong length', J(ack({ ids: [idFrom('a1').toUpperCase(), idFrom('a2').slice(1), idFrom('a3') + '0', idFrom('a4')] }))],
    ['repeats of an id are kept, in order', J(ack({ ids: [idFrom('a1'), idFrom('a1'), idFrom('a2')] }))],
    ['x-dev of 15 digits: no device', J(ack({ 'x-dev': D1.slice(1) }))],
    ['x-dev of 17 digits: no device', J(ack({ 'x-dev': D1 + '0' }))],
    ['x-dev in upper case: no device', J(ack({ 'x-dev': D2.toUpperCase() }))],
    ['x-dev a number: no device', `{"v":1,"kind":"ack","ids":[],"sent":"${SENT}","x-dev":1234567890123456}`],
    ['x-dev absent: no device', J({ v: 1, kind: 'ack', ids: [idFrom('a1')], sent: SENT, from: 'Mac' })],
    ['from not a string: ""', J(ack({ from: 42 }))],
    ['from with control characters and runs of spaces: cleaned', J(ack({ from: '  Anjan’s\u0007  Mac\n\n ' }))],
    ['from of 70 characters: the first 60', J(ack({ from: 'M'.repeat(70) }))],
    ['kind not ack: null', J(ack({ kind: 'item' }))],
    ['ids not an array: null', J(ack({ ids: idFrom('a1') }))],
    ['ids missing: null', J({ v: 1, kind: 'ack', sent: SENT, 'x-dev': D1 })],
    ['not an object: null', '[1,2]'],
  ];
  const parse = (text) => { try { return JSON.parse(text); } catch { return undefined; } };
  const returnParse = {
    notes: [
      'returnParse (LAB-PROTOCOL 2.4.5): parse headerJson with the platform JSON parser. items: returnItemExtras(header) must equal expect ({rk, to}: rk is share, marks, queue, reading or "unknown"; to is null for no x-to key, the device id, or "invalid"). acks: returnAck(header) must equal expect (null, or {ids, dev, from, rx, want}: ids are the valid item ids among the first 60 elements, in order with repeats; dev null unless 16 lowercase hex digits; from cleanName(from) when a string, else ""; rx false only for false; want true only for true).',
    ],
    items: itemCases.map(([name, headerJson]) => ({ name, headerJson, expect: ds.returnItemExtras(parse(headerJson)) })),
    acks: ackCases.map(([name, headerJson]) => ({ name, headerJson, expect: ds.returnAck(parse(headerJson)) })),
  };
  const PI = (n) => returnParse.items.find((c) => c.name === n).expect;
  const PA = (n) => returnParse.acks.find((c) => c.name === n).expect;
  assert.deepEqual(PI('share, no x-to: every device'), { rk: 'share', to: null });
  assert.deepEqual(PI('x-to of this device'), { rk: 'share', to: D1 });
  for (const n of ['x-to of 15 digits: invalid', 'x-to of 17 digits: invalid', 'x-to in upper case: invalid', 'x-to a number: invalid', 'x-to null: invalid (present, not a device)']) assert.equal(PI(n).to, 'invalid', n);
  assert.equal(PI('x-rk unknown: unknown').rk, 'unknown');
  assert.equal(PA('61 ids: the first 60 read').ids.length, 60);
  assert.equal(PA('junk among the first 60 elements: the valid ones of those 60').ids.length, 57);
  assert.deepEqual(PA('ids that are not strings').ids, [idFrom('a3')]);
  assert.equal(PA('x-rx 0: true').rx, true);
  assert.equal(PA('x-rx "false": true').rx, true);
  assert.equal(PA('x-want 1: false').want, false);
  assert.equal(PA('x-dev of 17 digits: no device').dev, null);
  assert.equal(PA('kind not ack: null'), null);

  // -------------------------------------------------------------------------------------------------------------
  // returnLane.topics: returnDevTopic, and sealed frames of each return purpose

  const secrets = [
    { label: 'vector-secret-1', secret: secretFrom('vector-secret-1') },
    { label: 'all-zero', secret: new Uint8Array(16) },
  ];
  const topics = [];
  for (const { label, secret } of secrets) {
    const k = await ds.deriveReturnKeys(secret);
    const l = await lab.deriveLabTopics(secret);
    assert.equal(k.returnTopic, l.returnTopic);
    assert.equal(k.returnAckTopic, l.returnAckTopic);
    const devTopics = {};
    for (const dev of [D1, D2, '0000000000000000', 'ffffffffffffffff']) {
      const t = await ds.returnDevTopic(secret, dev);
      const manual = 'dls-' + h(Buffer.concat([Buffer.from('dlshare/v1/lab-return-dev\0'), Buffer.from(secret), Buffer.from(dev, 'ascii')])).toString('hex').slice(0, 32);
      assert.equal(t, manual);
      assert.equal(await lab.returnDevTopic(secret, dev), t);
      devTopics[dev] = t;
    }
    topics.push({ label, secretHex: ds.toHex(secret), returnTopic: k.returnTopic, returnAckTopic: k.returnAckTopic, devTopics });
  }
  const refusedDevs = [D1.toUpperCase(), D1.slice(1), D1 + '0', '', 'g'.repeat(16)];
  for (const dev of refusedDevs) await assert.rejects(ds.returnDevTopic(secrets[0].secret, dev), (e) => e.code === 'device');

  const k1 = await ds.deriveReturnKeys(secrets[0].secret);
  const sealed = async (name, purpose, header) => {
    const headerJson = J(header);
    const frame = await ds.sealFrame(k1, purpose, ds.utf8(headerJson), new Uint8Array(0), nonceFrom(name));
    const refused = ['inbox', 'ack', 'lab-return', 'lab-return-ack', 'lab-return-dev'].filter((p) => p !== purpose);
    for (const p of refused) await assert.rejects(ds.decryptFrame(k1, p, frame), (e) => e.code === 'frame');
    return { name, purpose, nonceHex: ds.toHex(nonceFrom(name)), headerJson, frameBase64: ds.toBase64(frame), refusedPurposes: refused };
  };
  const frames = [
    await sealed('an item for every device, on returnTopic', 'lab-return', item({ title: 'Shared on the Daylight', 'x-rk': 'share' })),
    await sealed('an item for one device, on its own topic', 'lab-return-dev', item({ title: 'Shared on the Daylight', 'x-rk': 'share', 'x-to': D1 })),
    await sealed('a device frame on returnAckTopic', 'lab-return-ack', ack()),
  ];
  // buildReturnAckFrame writes exactly that header for those fields.
  const built = await ds.buildReturnAckFrame(k1, { ids: ack().ids, dev: D1, from: 'Anjan’s iPhone', sent: SENT, nonce: nonceFrom('a device frame on returnAckTopic') });
  assert.equal(ds.toBase64(built), frames[2].frameBase64);

  // The worst-case device frame (2.4.4): 60 ids, 60 lone surrogates in from, x-want and x-rx.
  const worstIds = many(60);
  const worstFrame = await ds.buildReturnAckFrame(k1, { ids: worstIds, dev: D1, from: '\ud800'.repeat(60), sent: SENT, rx: false, want: true, nonce: nonceFrom('worst') });
  const worstHeader = (await ds.decryptFrame(k1, 'lab-return-ack', worstFrame)).header;
  const worstAck = {
    loneSurrogates: true, nonceHex: ds.toHex(nonceFrom('worst')), headerJson: J(worstHeader), headerBytes: ds.utf8(J(worstHeader)).length,
    frameLength: worstFrame.length, base64Length: ds.toBase64(worstFrame).length, small: ds.isSmallFrame(worstFrame), frameBase64: ds.toBase64(worstFrame),
  };
  assert.ok(worstAck.small);
  await assert.rejects(ds.buildReturnAckFrame(k1, { ids: many(61), dev: D1 }), (e) => e.reason === 'too-many');
  await assert.rejects(ds.buildReturnAckFrame(k1, { ids: [], dev: D1.toUpperCase() }), (e) => e.reason === 'device');

  // -------------------------------------------------------------------------------------------------------------
  // returnLane.keys: the storage keys each lane's Sender and Receiver use, after the same exchange (JS storage)

  const keys = await laneKeys();

  // -------------------------------------------------------------------------------------------------------------
  // returnLane.due (2.4.8): returnDue(row, dev, heard, now) at the window edges, and with the Daylight's clock off

  const NOW0 = Date.UTC(2026, 9, 23, 8, 0, 0);
  const rowWith = (attachment, extra = {}) => ({
    to: [D1, D2], got: {}, copies: { [D1]: ds.copyUntil(T, attachment), [D2]: ds.copyUntil(T, attachment) }, followUps: {}, ...extra,
  });
  const at = (ms) => T * 1000 + ms;
  const dueCases = [];
  for (const offset of [0, 5 * HOUR]) {
    const off = offset ? ', the Daylight 5 h ahead' : '';
    const now = (ms) => at(ms) + offset;
    const add = (name, row, dev, heard, nowMs) => dueCases.push({ name: name + off, row, dev, heard, now: nowMs, expect: ds.returnDue(row, dev, heard, nowMs) });
    add('attachment row: heard 2.9 h after the copy’s first frame', rowWith(true), D2, at(2.9 * HOUR), now(2.9 * HOUR + MIN));
    add('attachment row: heard 3.1 h after it', rowWith(true), D2, at(3.1 * HOUR), now(3.1 * HOUR + MIN));
    add('attachment row: heard exactly at copyUntil', rowWith(true), D2, at(3 * HOUR), now(3 * HOUR + MIN));
    add('attachment row: heard 1 ms after copyUntil', rowWith(true), D2, at(3 * HOUR) + 1, now(3 * HOUR + MIN));
    add('message row: heard 11.9 h after it', rowWith(false), D2, at(11.9 * HOUR), now(11.9 * HOUR + MIN));
    add('message row: heard 12.1 h after it', rowWith(false), D2, at(12.1 * HOUR), now(12.1 * HOUR + MIN));
    add('message row: heard exactly at copyUntil', rowWith(false), D2, at(12 * HOUR), now(12 * HOUR + MIN));
    add('never heard', rowWith(true), D2, null, now(30 * HOUR));
    add('acked: never due', rowWith(true, { got: { [D2]: now(HOUR) } }), D2, at(5 * HOUR), now(5 * HOUR));
    add('not a target', rowWith(true), D3, at(5 * HOUR), now(5 * HOUR));
    add('no copy for it yet (the first publish has not gone)', { ...rowWith(true), copies: {} }, D2, at(5 * HOUR), now(5 * HOUR));
    const fu = now(4 * HOUR) + ds.RETURN_FOLLOW_UP_MS;
    const withFollowUp = rowWith(true, { copies: { [D1]: ds.copyUntil(T, true), [D2]: at(4 * HOUR) + 3 * HOUR }, followUps: { [D2]: fu } });
    add('follow-up: 1 ms before 185 minutes after the re-send', withFollowUp, D2, at(4 * HOUR), fu - 1);
    add('follow-up: at 185 minutes after the re-send', withFollowUp, D2, at(4 * HOUR), fu);
    add('follow-up: after an ack, none', { ...withFollowUp, got: { [D2]: fu - MIN } }, D2, at(4 * HOUR), fu);
  }
  const dueOf = (n) => dueCases.find((c) => c.name === n).expect;
  for (const off of ['', ', the Daylight 5 h ahead']) {
    assert.equal(dueOf('attachment row: heard 2.9 h after the copy’s first frame' + off), false);
    assert.equal(dueOf('attachment row: heard 3.1 h after it' + off), true);
    assert.equal(dueOf('message row: heard 11.9 h after it' + off), false);
    assert.equal(dueOf('message row: heard 12.1 h after it' + off), true);
    assert.equal(dueOf('attachment row: heard exactly at copyUntil' + off), false);
    assert.equal(dueOf('follow-up: at 185 minutes after the re-send' + off), true);
    assert.equal(dueOf('follow-up: after an ack, none' + off), false);
  }

  // -------------------------------------------------------------------------------------------------------------
  // returnLane.settle (2.4.7): settleReturnRow(row, now, settled)

  const C0 = NOW0;
  const srow = (o) => ({ status: 'sent', errorCode: '', created: C0, to: [D1, D2], got: {}, ...o });
  const settleCases = [
    ['nobody acked yet', srow({}), [], C0 + HOUR],
    ['the iPhone acked: the Mac still open', srow({ got: { [D1]: C0 + MIN } }), [], C0 + HOUR],
    ['both acked: delivered', srow({ got: { [D1]: C0 + MIN, [D2]: C0 + 2 * MIN } }), [], C0 + HOUR],
    ['the iPhone acked, the Mac said x-rx: false: delivered', srow({ got: { [D1]: C0 + MIN } }), [D2], C0 + HOUR],
    ['every target said x-rx: false, nobody acked: expired', srow({}), [D1, D2], C0 + HOUR],
    ['7 days old, the iPhone acked: delivered, the Mac missing', srow({ got: { [D1]: C0 + MIN } }), [], C0 + 7 * DAY + 1],
    ['exactly 7 days old: unchanged', srow({ got: { [D1]: C0 + MIN } }), [], C0 + 7 * DAY],
    ['7 days old, nobody acked: expired, both missing', srow({}), [], C0 + 7 * DAY + 1],
    ['a first publish that never went, 7 days old: expired', srow({ status: 'failed', errorCode: 'network' }), [], C0 + 7 * DAY + 1],
    ['a first publish that never went, every target opted out: unchanged until it goes', srow({ status: 'failed', errorCode: 'cap' }), [D1, D2], C0 + HOUR],
    ['no device yet: unchanged', srow({ status: 'failed', errorCode: 'no-device', to: [] }), [], C0 + 2 * DAY],
  ].map(([name, row, settled, now]) => ({ name, row, settled, now, expect: ds.settleReturnRow(row, now, (d) => settled.includes(d)) }));
  const settleOf = (n) => settleCases.find((c) => c.name === n).expect;
  assert.deepEqual(settleOf('the iPhone acked, the Mac said x-rx: false: delivered'), { status: 'delivered', missing: [] });
  assert.deepEqual(settleOf('7 days old, the iPhone acked: delivered, the Mac missing'), { status: 'delivered', missing: [D2] });
  assert.equal(settleOf('the iPhone acked: the Mac still open'), null);

  // -------------------------------------------------------------------------------------------------------------
  // returnLane.devices (2.4.6): ReturnDevices.record sequences -> the view at `now`

  const fr = (dev, from, o = {}) => ({ ids: [], dev, from, rx: true, want: false, ...o });
  const deviceCases = [
    ['two devices: targets newest first', [[fr(D1, 'iPhone'), T], [fr(D2, 'Mac'), T + 60]], at(HOUR)],
    ['the same name twice: iPhone and iPhone (2), in the order first heard', [[fr(D2, 'iPhone'), T], [fr(D1, 'iPhone'), T + 60]], at(HOUR)],
    ['x-rx: false: no longer a target, settled', [[fr(D1, 'iPhone'), T], [fr(D2, 'Mac'), T + 60], [fr(D2, 'Mac', { rx: false }), T + 120]], at(HOUR)],
    ['x-rx: false, then heard again: a target again', [[fr(D2, 'Mac', { rx: false }), T], [fr(D2, 'Mac'), T + 60]], at(HOUR)],
    ['heard exactly 14 days ago: still a target', [[fr(D1, 'iPhone'), T]], at(14 * DAY)],
    ['heard 14 days and 1 ms ago: stale', [[fr(D1, 'iPhone'), T]], at(14 * DAY) + 1],
    ['reinstalled: a new id with the old name, the old silent for exactly 2 days', [[fr(D1, 'iPhone'), T], [fr(D2, 'iPhone'), T + 3600]], at(HOUR) + 2 * DAY],
    ['reinstalled: the old silent for 2 days and 1 ms: retired', [[fr(D1, 'iPhone'), T], [fr(D2, 'iPhone'), T + 3600]], at(HOUR) + 2 * DAY + 1],
    ['reinstalled, then the old one heard again: back', [[fr(D1, 'iPhone'), T], [fr(D2, 'iPhone'), T + 3600], [fr(D1, 'iPhone'), T + 3 * 86400]], at(3 * DAY + HOUR)],
    ['nine devices: the newest 8 are targets', Array.from({ length: 9 }, (_, k) => [fr(k.toString(16).padStart(16, '0'), 'Device ' + k), T + k * 60]), at(HOUR)],
    ['a frame without a device id counts for no device', [[fr(null, 'Ghost'), T], [fr(D1.toUpperCase(), 'Ghost'), T + 1]], at(HOUR)],
    ['an empty from keeps the name before', [[fr(D1, 'iPhone'), T], [fr(D1, ''), T + 60]], at(HOUR)],
    ['an older frame (a re-listed message): first and want only', [[fr(D1, 'iPhone'), T + 600], [fr(D1, 'Old name', { rx: false, want: true }), T]], at(HOUR)],
    ['x-want: want is that frame’s time', [[fr(D1, 'iPhone'), T], [fr(D1, 'iPhone', { want: true }), T + 300], [fr(D1, 'iPhone'), T + 600]], at(HOUR)],
  ];
  const devices = [];
  for (const [name, steps, now] of deviceCases) {
    const rd = new lab.ReturnDevices({ storage: new ds.MemoryStorage(), now: () => now });
    for (const [a, time] of steps) await rd.record(a, { time });
    const view = await rd.snapshot(now);
    const devs = [...new Set(steps.map(([a]) => a.dev).filter(Boolean))];
    devices.push({
      name, steps: steps.map(([a, time]) => ({ ack: a, time })), now,
      expect: {
        devices: view.devices.map(({ dev, from, first, heard, rx, want, retired, current, n }) => ({ dev, from, first, heard, rx, want, retired, current, n })),
        names: view.names, targets: view.targets,
        settled: Object.fromEntries(devs.map((d) => [d, view.settled(d)])),
      },
    });
  }
  const devOf = (n) => devices.find((c) => c.name === n).expect;
  assert.deepEqual(devOf('two devices: targets newest first').targets, [D2, D1]);
  assert.deepEqual(devOf('the same name twice: iPhone and iPhone (2), in the order first heard').names.map((x) => [x.dev, x.n]), [[D2, 1], [D1, 2]]);
  assert.deepEqual(devOf('x-rx: false: no longer a target, settled').targets, [D1]);
  assert.equal(devOf('x-rx: false: no longer a target, settled').settled[D2], true);
  assert.deepEqual(devOf('heard 14 days and 1 ms ago: stale').targets, []);
  assert.deepEqual(devOf('reinstalled: a new id with the old name, the old silent for exactly 2 days').targets, [D2, D1]);
  assert.deepEqual(devOf('reinstalled: the old silent for 2 days and 1 ms: retired').targets, [D2]);
  assert.equal(devOf('reinstalled: the old silent for 2 days and 1 ms: retired').settled[D1], true);
  assert.deepEqual(devOf('reinstalled, then the old one heard again: back').targets, [D1, D2]);
  assert.equal(devOf('nine devices: the newest 8 are targets').targets.length, 8);
  assert.deepEqual(devOf('a frame without a device id counts for no device').devices, []);

  // -------------------------------------------------------------------------------------------------------------
  // returnLane.budget (2.4.9): returnBudgetCheck / chargeReturnBudget / limitReturnBudget / noteReturnBudgetBytes

  const B0 = Date.UTC(2026, 9, 23, 9, 0, 0);
  const budgetCases = [
    ['twelve message frames, then the 13th waits', [
      ...Array.from({ length: 12 }, (_, k) => ({ op: 'charge', frame: { attachment: 0, downloaders: 3 }, now: B0 + k * MIN })),
      { op: 'check', attempt: { frames: 1, attachmentBytes: 0, downloaders: 3 }, now: B0 + HOUR },
      { op: 'check', attempt: { frames: 1, attachmentBytes: 0, downloaders: 3 }, now: Date.UTC(2026, 9, 24, 0, 0, 0) },
    ]],
    ['a 5-part row with 4 frames left today waits whole', [
      ...Array.from({ length: 8 }, (_, k) => ({ op: 'charge', frame: { attachment: 0, downloaders: 1 }, now: B0 + k * MIN })),
      { op: 'check', attempt: { frames: 5, attachmentBytes: 0, downloaders: 1 }, now: B0 + HOUR },
      { op: 'check', attempt: { frames: 4, attachmentBytes: 0, downloaders: 1 }, now: B0 + HOUR },
    ]],
    ['a device’s 7th re-sent frame waits; another device’s still goes', [
      ...Array.from({ length: 6 }, (_, k) => ({ op: 'charge', frame: { attachment: 0, downloaders: 1, resendFor: D1 }, now: B0 + k * MIN })),
      { op: 'check', attempt: { frames: 1, attachmentBytes: 0, downloaders: 1, resendFor: D1 }, now: B0 + HOUR },
      { op: 'check', attempt: { frames: 1, attachmentBytes: 0, downloaders: 1, resendFor: D2 }, now: B0 + HOUR },
    ]],
    ['bytes: an attachment counts once plus once per downloader; past 60 MB it waits', [
      ...Array.from({ length: 5 }, (_, k) => ({ op: 'charge', frame: { attachment: 1_900_000, downloaders: 5 }, now: B0 + k * 3 * HOUR })),
      { op: 'check', attempt: { frames: 1, attachmentBytes: 1_900_000, downloaders: 5 }, now: B0 + 13 * HOUR },
      { op: 'check', attempt: { frames: 1, attachmentBytes: 500_000, downloaders: 5 }, now: B0 + 13 * HOUR },
      { op: 'check', attempt: { frames: 1, attachmentBytes: 1_400_000, downloaders: 1 }, now: B0 + 13 * HOUR },
      { op: 'check', attempt: { frames: 1, attachmentBytes: 1_400_000, downloaders: 5 }, now: B0 + 13 * HOUR },
    ]],
    ['bytes on the relay: an attachment row waits past 10 MB, and goes 3 hours later', [
      { op: 'bytes', bytes: 5_700_000, now: B0 },
      { op: 'check', attempt: { frames: 3, attachmentBytes: 5_700_000, downloaders: 1 }, now: B0 + MIN },
      { op: 'check', attempt: { frames: 2, attachmentBytes: 3_800_000, downloaders: 1 }, now: B0 + MIN },
      { op: 'check', attempt: { frames: 1, attachmentBytes: 0, downloaders: 1 }, now: B0 + MIN },
      { op: 'check', attempt: { frames: 3, attachmentBytes: 5_700_000, downloaders: 1 }, now: B0 + 3 * HOUR },
    ]],
    ['the largest row, 9 MB, fits on its own', [
      { op: 'check', attempt: { frames: 5, attachmentBytes: 9_000_180, downloaders: 5 }, now: B0 },
    ]],
    ['giving way: a 413 holds everything for an hour', [
      { op: 'limit', status: 413, now: B0 },
      { op: 'check', attempt: { frames: 1, attachmentBytes: 0, downloaders: 1 }, now: B0 + HOUR - 1 },
      { op: 'check', attempt: { frames: 1, attachmentBytes: 1_000_000, downloaders: 1 }, now: B0 + HOUR - 1 },
      { op: 'check', attempt: { frames: 1, attachmentBytes: 1_000_000, downloaders: 1 }, now: B0 + HOUR },
    ]],
    ['giving way: a 429 too; another status changes nothing', [
      { op: 'limit', status: 500, now: B0 },
      { op: 'check', attempt: { frames: 1, attachmentBytes: 0, downloaders: 1 }, now: B0 + MIN },
      { op: 'limit', status: 429, now: B0 + MIN },
      { op: 'check', attempt: { frames: 1, attachmentBytes: 0, downloaders: 1 }, now: B0 + 2 * MIN },
    ]],
  ];
  const budget = [];
  for (const [name, ops] of budgetCases) {
    let b = ds.newReturnBudget();
    const steps = [];
    for (const op of ops) {
      if (op.op === 'check') { steps.push({ ...op, expect: ds.returnBudgetCheck(b, op.attempt, op.now) }); continue; }
      if (op.op === 'charge') b = ds.chargeReturnBudget(b, op.frame, op.now);
      else if (op.op === 'limit') b = ds.limitReturnBudget(b, op.status, op.now);
      else if (op.op === 'bytes') b = ds.noteReturnBudgetBytes(b, op.bytes, op.now);
      steps.push({ ...op, expect: b });
    }
    budget.push({ name, steps });
  }
  const checks = (n) => budget.find((c) => c.name === n).steps.filter((s) => s.op === 'check').map((s) => s.expect);
  assert.deepEqual(checks('twelve message frames, then the 13th waits'), ['cap', 'ok']);
  assert.deepEqual(checks('a 5-part row with 4 frames left today waits whole'), ['cap', 'ok']);
  assert.deepEqual(checks('a device’s 7th re-sent frame waits; another device’s still goes'), ['cap', 'ok']);
  assert.deepEqual(checks('bytes: an attachment counts once plus once per downloader; past 60 MB it waits'), ['cap', 'ok', 'ok', 'cap']);
  assert.deepEqual(checks('bytes on the relay: an attachment row waits past 10 MB, and goes 3 hours later'), ['relay', 'ok', 'ok', 'ok']);
  assert.deepEqual(checks('the largest row, 9 MB, fits on its own'), ['ok']);
  assert.deepEqual(checks('giving way: a 413 holds everything for an hour'), ['yield', 'yield', 'ok']);
  assert.deepEqual(checks('giving way: a 429 too; another status changes nothing'), ['ok', 'yield']);

  // -------------------------------------------------------------------------------------------------------------
  // returnLane.cadence (2.4.4): a device's frames, step by step

  const R0 = Date.UTC(2026, 9, 23, 7, 0, 0);
  const I = (k) => idFrom('c' + k);
  const cadenceCases = [
    ['first hello, then acks 30 minutes apart, then the cap of 2 for acks', [
      { op: 'hello', now: R0 },
      { op: 'read', now: R0, time: R0 / 1000 },
      { op: 'read', now: R0 + 10 * MIN, ids: [I(1)], time: (R0 + 10 * MIN) / 1000 },
      { op: 'read', now: R0 + 30 * MIN - 1, ids: [I(2)] },
      { op: 'read', now: R0 + 30 * MIN, ids: [I(3)], time: (R0 + 30 * MIN) / 1000 },
      { op: 'read', now: R0 + 2 * HOUR, ids: [I(4)] },
    ]],
    ['the third frame of the day is kept for x-want', [
      { op: 'read', now: R0, ids: [I(1)], time: R0 / 1000 },
      { op: 'read', now: R0 + HOUR, ids: [I(2)], time: (R0 + HOUR) / 1000 },
      { op: 'read', now: R0 + 2 * HOUR, ids: [I(3)] },
      { op: 'read', now: R0 + 4 * HOUR, expired: { shared: R0 / 1000 + 3 * 3600 }, time: (R0 + 4 * HOUR) / 1000 },
      { op: 'read', now: R0 + 5 * HOUR, expired: { dev: R0 / 1000 + 4.5 * 3600 } },
      { op: 'read', now: Date.UTC(2026, 9, 24, 0, 0, 1), time: Date.UTC(2026, 9, 24, 0, 0, 1) / 1000 },
    ]],
    ['x-want only for an expired copy newer than the first frame and than what was stored; a newer item clears it', [
      { op: 'read', now: R0, expired: { shared: R0 / 1000 - 3600 }, time: R0 / 1000 },
      { op: 'read', now: R0 + 2 * MIN, expired: { shared: R0 / 1000 - 600 } },
      { op: 'read', now: R0 + HOUR, ids: [I(1)], stored: { shared: R0 / 1000 + 3000 }, expired: { shared: R0 / 1000 + 2000 }, time: (R0 + HOUR) / 1000 },
      { op: 'limit', status: 413, now: R0 + HOUR + MIN },
      { op: 'read', now: R0 + HOUR + 2 * MIN, expired: { shared: R0 / 1000 + 4000 } },
      { op: 'read', now: R0 + HOUR + 3 * MIN, ids: [I(2)], stored: { shared: R0 / 1000 + 5000 } },
      { op: 'read', now: R0 + 2 * HOUR + 2 * MIN },
    ]],
    ['the idle hello after 24 hours', [
      { op: 'read', now: R0, time: R0 / 1000 },
      { op: 'read', now: R0 + 24 * HOUR - 1 },
      { op: 'read', now: R0 + 24 * HOUR, time: (R0 + 24 * HOUR) / 1000 },
    ]],
    ['giving way for an hour after a 429; x-want waits too', [
      { op: 'read', now: R0, time: R0 / 1000 },
      { op: 'limit', status: 429, now: R0 + 40 * MIN },
      { op: 'read', now: R0 + 41 * MIN, ids: [I(1)], expired: { dev: R0 / 1000 + 600 } },
      { op: 'read', now: R0 + 100 * MIN, time: (R0 + 100 * MIN) / 1000 },
    ]],
    ['x-rx: false: one frame past the cap, then nothing until the next hello', [
      { op: 'read', now: R0, ids: [I(1)], time: R0 / 1000 },
      { op: 'read', now: R0 + HOUR, ids: [I(2)], time: (R0 + HOUR) / 1000 },
      { op: 'read', now: R0 + 2 * HOUR, ids: [I(3)] },
      { op: 'off', now: R0 + 3 * HOUR, time: (R0 + 3 * HOUR) / 1000 },
      { op: 'read', now: R0 + 30 * HOUR, ids: [I(4)] },
      { op: 'hello', now: R0 + 31 * HOUR },
      { op: 'read', now: R0 + 31 * HOUR, time: (R0 + 31 * HOUR) / 1000 },
    ]],
    ['x-rx: false from a device that never published: no frame', [
      { op: 'off', now: R0 },
      { op: 'read', now: R0 + HOUR, ids: [I(1)] },
    ]],
    ['70 pending acks: 60 in a frame, 10 wait', [
      { op: 'read', now: R0, ids: Array.from({ length: 70 }, (_, k) => I('p' + k)), time: R0 / 1000 },
      { op: 'read', now: R0 + 30 * MIN, time: (R0 + 30 * MIN) / 1000 },
    ]],
  ];
  const cadence = cadenceCases.map(([name, ops]) => ({ name, steps: runCadence(ops) }));
  const reasons = (n) => cadence.find((c) => c.name === n).steps.filter((s) => s.op === 'read' || s.op === 'off').map((s) => s.expect.frame?.reason ?? null);
  assert.deepEqual(reasons('first hello, then acks 30 minutes apart, then the cap of 2 for acks'), ['first', null, null, 'acks', null]);
  assert.deepEqual(reasons('the third frame of the day is kept for x-want'), ['acks', 'acks', null, 'want', null, 'want']);
  const wantCase = cadence.find((c) => c.name.startsWith('x-want only for an expired copy'));
  assert.deepEqual(reasons(wantCase.name), ['idle', null, 'acks', null, null, null]);
  assert.ok(wantCase.steps[4].expect.state.want.shared > 0, 'a wanted copy, held back by the 413');
  assert.deepEqual(wantCase.steps[5].expect.state.want, {}, 'a newer stored item clears the want');
  assert.deepEqual(reasons('the idle hello after 24 hours'), ['idle', null, 'idle']);
  assert.deepEqual(reasons('giving way for an hour after a 429; x-want waits too'), ['idle', null, 'want']);
  assert.deepEqual(reasons('x-rx: false: one frame past the cap, then nothing until the next hello'), ['acks', 'acks', null, 'off', null, 'first']);
  assert.deepEqual(reasons('x-rx: false from a device that never published: no frame'), [null, null]);
  assert.deepEqual(cadence.find((c) => c.name === '70 pending acks: 60 in a frame, 10 wait').steps.map((s) => s.expect.frame?.ids.length ?? 0), [60, 10]);

  const constants = Object.fromEntries(['RETURN_KINDS', 'RETURN_KINDS_W2', 'RETURN_TARGETS_MAX', 'RETURN_TARGET_STALE_MS',
    'RETURN_SAME_NAME_MS', 'RETURN_DEVICES_KEPT', 'RETURN_ACK_IDS', 'RETURN_PENDING_ACKS_MAX', 'RETURN_DEVICE_FRAMES_PER_DAY',
    'RETURN_ACK_GAP_MS', 'RETURN_IDLE_HELLO_MS', 'RETURN_WANT_READ_MS', 'RETURN_COPY_ATTACH_MS', 'RETURN_COPY_MSG_MS',
    'RETURN_FOLLOW_UP_MS', 'RETURN_FRAMES_PER_DAY', 'RETURN_RESENDS_PER_DEVICE', 'RETURN_BYTES_PER_DAY',
    'RETURN_LIVE_BYTES_MAX', 'RETURN_YIELD_MS', 'RETURN_NO_DEVICE_MS', 'RETURN_EXPIRY_MS', 'RETURN_POLL_COMBINED']
    .map((k) => [k, ds[k]]));
  constants.LAB_FRAMES_PER_DAY_RETURN = lab.LAB_FRAMES_PER_DAY_RETURN;

  const returnLane = {
    notes: [
      'returnLane (LAB-PROTOCOL 2.4; W2, L2). Times: `time` and `heard` are relay times (time in Unix seconds, heard in ms); `now`, `created`, `got` and `followUps` are the Daylight\'s (or the device\'s) clock in ms; `copies` are relay times in ms (copyUntil). Device ids are 16 lowercase hex digits.',
      'constants: the return lane\'s constants (2.4) and LAB_FRAMES_PER_DAY_RETURN (2.2.4).',
      'topics: for each secret, returnTopic, returnAckTopic and returnDevTopic(dev) = "dls-" + the first 32 hex digits of SHA-256("dlshare/v1/lab-return-dev" + 0x00 + secret + the 16 ASCII bytes of dev); refusedDevs are refused (an error "device"). frames: seal headerJson with the pairing key of vector-secret-1, nonceHex and `purpose`: it must equal frameBase64, and fail to open (an error "frame") with each of refusedPurposes; the device frame is what buildReturnAckFrame({ids, dev, from, sent}) writes. worstAck: the longest device frame (60 ids, 60 lone surrogates in from, x-rx false and x-want true): headerBytes, frameLength and base64Length pin its size, and it is small; a builder refuses 61 ids and a device id that is not 16 lowercase hex digits.',
      'keys: the JS storage keys (outbox/<id> for any row id) each lane\'s Sender and Receiver hold after the same exchange; the pairing lane\'s are v1.1\'s, and the two lanes share none. Kotlin and Swift keep the return lane in a lane-return/ folder next to the outbox instead.',
      'due: returnDue(row, dev, heard, now) must equal expect. The cases come twice: with the Daylight\'s clock right, and 5 hours ahead (now and followUps move, relay times do not): the answers are the same.',
      'settle: settleReturnRow(row, now, settled) with settled(dev) true for the ids in `settled` must equal expect (null: unchanged; else {status, missing}).',
      'devices: feed each step\'s ack (a returnAck result) with its relay time (s) to ReturnDevices.record in order, then read the view at `now`: devices (every kept device by first heard: dev, from, first, heard, rx, want, retired, current, n), names (the current devices with n: 1, 2, ... per from, in the order first heard), targets (the current devices with rx, newest heard first, at most 8) and settled per device.',
      'budget: run the steps on a new budget ({day: "", frames: 0, bytes: 0, resends: {}, live: [], limitUntil: 0}): check -> returnBudgetCheck(budget, attempt, now) must equal expect ("ok", "yield", "cap" or "relay"); charge -> chargeReturnBudget(budget, frame, now), limit -> limitReturnBudget(budget, status, now), bytes -> noteReturnBudgetBytes(budget, bytes, now): the budget must then equal expect.',
      'cadence: a device\'s frames (2.4.4), from a new state. hello: helloDue = true and off = false. read: deviceAfterRead(state, {ids, stored, expired}), then deviceFrameDue(state, now); when it gives a reason, the frame carries the first 60 of pending and x-want for "want", and goes: deviceFramePublished(state, {now, time, ids, want}). limit: limitUntil = max(limitUntil, now + 1 h) for a 429 or 413. off: when the device ever published (firstHello), one frame with x-rx false and the first 60 of pending, past the cap (deviceFramePublished with rx false); then off = true either way. expect: {frame: null or {reason, ids, want}, state} after the step.',
    ],
    constants, topics, refusedDevs, frames, worstAck, keys, due: dueCases, settle: settleCases, devices, budget, cadence,
  };
  return { returnParse, returnLane };
}

/** The cadence driver (vectors > returnLane > cadence): what Receiver({lane: 'return'}) does around each read. */
function runCadence(ops) {
  let st = ds.newDeviceFrameState();
  const out = [];
  for (const op of ops) {
    let frame = null;
    if (op.op === 'hello') Object.assign(st, { helloDue: true, off: false });
    else if (op.op === 'limit') { if (op.status === 429 || op.status === 413) st.limitUntil = Math.max(st.limitUntil, op.now + ds.RETURN_YIELD_MS); }
    else if (op.op === 'off') {
      if (!st.off && st.firstHello) {
        const ids = st.pending.slice(0, ds.RETURN_ACK_IDS);
        st = ds.deviceFramePublished(st, { now: op.now, time: op.time, ids, rx: false });
        frame = { reason: 'off', ids, want: false };
      }
      st.off = true;
    } else if (op.op === 'read') {
      if (!st.off) {
        st = ds.deviceAfterRead(st, { ids: op.ids ?? [], stored: op.stored ?? {}, expired: op.expired ?? {} });
        const reason = ds.deviceFrameDue(st, op.now);
        if (reason) {
          const ids = st.pending.slice(0, ds.RETURN_ACK_IDS);
          st = ds.deviceFramePublished(st, { now: op.now, time: op.time, ids, want: reason === 'want' });
          frame = { reason, ids, want: reason === 'want' };
        }
      }
    }
    out.push({ ...op, expect: { frame, state: structuredClone(st) } });
  }
  return out;
}

/** The storage keys each lane uses after one exchange through the mock relay (vectors > returnLane > keys). */
async function laneKeys() {
  const relay = await startMockRelay();
  try {
    const pairing = { secret: secretFrom('vector-secret-1'), relay: relay.url, name: 'Daylight' };
    const fast = { retryDelaysMs: [0, 0, 0] };
    const keysOf = async (storage) => [...storage.m.keys()].map((k) => k.replace(/outbox\/[0-9a-f]{32}$/, 'outbox/<id>')).sort();
    // The pairing lane: a phone sends a link and a file, the Daylight receives and acks them, the phone reads the ack.
    const phone = new ds.MemoryStorage(), daylight = new ds.MemoryStorage();
    const sender = new ds.Sender({ pairing, storage: phone, from: 'Phone', ...fast });
    const receiver = new ds.Receiver({ pairing, storage: daylight, ...fast });
    await sender.send({ kind: 'url', url: 'https://example.com/a' });
    await sender.send({ kind: 'file', name: 'a.pdf', mime: 'application/pdf', content: new Uint8Array(5000) });
    await receiver.pollOnce();
    await sender.checkAcks();
    const pairingSender = await keysOf(phone), pairingReceiver = await keysOf(daylight);
    // The return lane on the same two storage objects: the Daylight sends a link and a file back to every device and a
    // link to the phone alone, the phone reads them as a device and acks them, the Daylight reads the acks.
    const dev = await lab.returnDeviceId(phone);
    const devices = new lab.ReturnDevices({ storage: daylight });
    const back = new ds.Sender({ pairing, storage: daylight, lane: 'return', devices, from: 'Daylight', ...fast });
    const device = new ds.Receiver({ pairing, storage: phone, lane: 'return', device: { dev, from: 'Phone' }, ...fast });
    await device.hello();
    await back.checkAcks();
    await back.send({ kind: 'url', url: 'https://example.com/back' });
    await back.send({ kind: 'file', name: 'b.pdf', mime: 'application/pdf', content: new Uint8Array(5000) });
    await back.send({ kind: 'url', url: 'https://example.com/just-for-you' }, { to: dev });
    const st = await device.storage.get(ds.RETURN_PREFIX + 'device');
    st.lastFrameAt = 0; // let the acks go now
    await device.storage.set(ds.RETURN_PREFIX + 'device', st);
    await device.pollOnce();
    await back.checkAcks();
    const all = { daylight: await keysOf(daylight), phone: await keysOf(phone) };
    const returnSender = all.daylight.filter((k) => !pairingReceiver.includes(k));
    const returnReceiver = all.phone.filter((k) => !pairingSender.includes(k));
    const rows = await back.list();
    assert.ok(rows.every((r) => r.status === 'delivered'), 'the exchange delivered both items');
    for (const k of [...returnSender, ...returnReceiver]) assert.ok(k.startsWith(ds.RETURN_PREFIX), k);
    for (const k of [...pairingSender, ...pairingReceiver]) assert.ok(!k.startsWith('lane/'), k);
    return { pairing: { sender: pairingSender, receiver: pairingReceiver }, return: { sender: returnSender, receiver: returnReceiver } };
  } finally { await relay.close(); }
}
