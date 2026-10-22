// Writes lab-vectors.json from the JavaScript reference (../js/daylight-lab.js and the 2.7.1 additions of
// ../js/daylight-share.js). Run: node generate-lab.mjs. Everything is deterministic (fixed secrets, nonces and clocks;
// no deflate), so CI regenerates it and requires no diff. The rules are LAB-PROTOCOL.md section 2.

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as ds from '../js/daylight-share.js';
import * as lab from '../js/daylight-lab.js';
import { buildW1 } from './lab-w1-cases.mjs';

const h = (s) => createHash('sha256').update(s).digest();
const secretFrom = (label) => new Uint8Array(h(label).subarray(0, 16));
const nonceFrom = (label) => new Uint8Array(h('lab-nonce/' + label).subarray(0, 12));
const idFrom = (label) => h('lab-id/' + label).toString('hex').slice(0, 32);
const SENT = '2026-10-20T08:00:00.000Z';
const T = 1792483198; // 2026-10-20T07:59:58Z in Unix seconds
const POLL = '2026-10-20T07:59:58.000Z';
const POLL_MS = Date.UTC(2026, 9, 20, 7, 59, 58);
assert.equal(POLL_MS / 1000, T);

const secrets = [
  { label: 'vector-secret-1', secret: secretFrom('vector-secret-1') },
  { label: 'vector-secret-2', secret: secretFrom('vector-secret-2') },
  { label: 'all-zero', secret: new Uint8Array(16) },
  { label: 'all-ff', secret: new Uint8Array(16).fill(0xff) },
];
const s1 = secrets[0].secret;
const k1 = await ds.deriveKeys(s1);

// ---------------------------------------------------------------------------------------------------------------
// labTopics (2.4)

const topics = [];
for (const { label, secret } of secrets) {
  const t = await lab.deriveLabTopics(secret);
  const manual = async (name) => 'dls-' + h(Buffer.concat([Buffer.from(`dlshare/v1/${name}\0`), Buffer.from(secret)])).toString('hex').slice(0, 32);
  assert.equal(t.returnTopic, await manual('lab-return'));
  assert.equal(t.controlAckTopic, await manual('lab-control-ack'));
  topics.push({ label, secretHex: ds.toHex(secret), ...t });
}
const returnHeader = {
  v: 1, id: idFrom('return-1'), kind: 'url', url: 'https://example.com/from-the-daylight', title: 'Shared on the Daylight',
  sent: SENT, from: 'Anjan’s Daylight', 'x-rk': 'share',
};
const returnHeaderJson = JSON.stringify(returnHeader);
const returnFrame = await ds.sealFrame(k1, ds.PURPOSE_LAB_RETURN, ds.utf8(returnHeaderJson), new Uint8Array(0), nonceFrom('return'));
for (const other of ['inbox', 'ack', 'lab-return-ack', 'lab-control', 'lab-control-ack']) {
  await assert.rejects(ds.decryptFrame(k1, other, returnFrame), (e) => e.code === 'frame');
}
await assert.rejects(ds.decryptFrame(k1, 'lab', returnFrame), (e) => e.code === 'purpose');
const labTopics = {
  aads: {
    inbox: 'dlshare/v1/inbox', ack: 'dlshare/v1/ack', 'lab-return': 'dlshare/v1/lab-return',
    'lab-return-ack': 'dlshare/v1/lab-return-ack', 'lab-control': 'dlshare/v1/lab-control',
    'lab-control-ack': 'dlshare/v1/lab-control-ack',
  },
  topics,
  returnFrame: {
    secretHex: ds.toHex(s1), purpose: 'lab-return', nonceHex: ds.toHex(nonceFrom('return')), headerJson: returnHeaderJson,
    frameHex: ds.toHex(returnFrame), frameBase64: ds.toBase64(returnFrame),
    refusedPurposes: ['inbox', 'ack', 'lab-return-ack', 'lab-control', 'lab-control-ack'],
  },
};

// ---------------------------------------------------------------------------------------------------------------
// labFrames (2.2.1) and v1Safety (2.1 rule 4)

const loneFrom = '\ud800'.repeat(60);
const worstCaps = Array.from({ length: 16 }, (_, i) => String.fromCharCode(97 + i).repeat(16));
const worstStates = Array.from({ length: 24 }, (_, i) => ({ i: idFrom('worst-' + i), s: 'waiting', t: T }));
const frameCases = [
  { name: 'hello', inbox: { lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'], poll: POLL, live: true }, states: [], from: 'Anjan’s Daylight' },
  { name: 'three states', inbox: { lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link', 'cap-kind'], poll: POLL, live: false },
    states: [{ i: idFrom('a'), s: 'reader', t: T }, { i: idFrom('b'), s: 'waiting', t: T - 8 }, { i: idFrom('c'), s: 'handed', t: T - 2 }], from: 'Anjan’s Daylight' },
  { name: 'Lab turned off (lab 0, no caps)', inbox: { lab: 0, app: 'android/1.5.0', caps: [], poll: POLL, live: false }, states: [], from: 'Anjan’s Daylight' },
  { name: 'Lab Reader hello', inbox: { lab: 1, app: 'reader-lab/0.27.900', caps: ['st', 'reader-link', 'reader-doc', 'quiet'], poll: POLL, live: true }, states: [], from: 'Daylight Reader (lab)' },
  { name: 'worst case: 60 lone surrogates in from, lab 99 (2.2.1)', loneSurrogates: true,
    inbox: { lab: 99, app: 'a'.repeat(60), caps: worstCaps, poll: POLL, live: false }, states: worstStates, from: loneFrom },
  { name: 'worst case at Lab level 1', loneSurrogates: true,
    inbox: { lab: 1, app: 'a'.repeat(60), caps: worstCaps, poll: POLL, live: false }, states: worstStates, from: loneFrom },
];
const labFrames = [];
for (const c of frameCases) {
  const nonce = nonceFrom('frame/' + c.name);
  const frame = await lab.buildLabFrame(k1, { inbox: c.inbox, states: c.states, from: c.from, sent: SENT, nonce });
  const { header } = await ds.decryptFrame(k1, 'ack', frame);
  const headerJson = JSON.stringify(header);
  assert.deepEqual(await ds.sealFrame(k1, 'ack', ds.utf8(headerJson), new Uint8Array(0), nonce), frame);
  labFrames.push({
    name: c.name, ...(c.loneSurrogates ? { loneSurrogates: true } : {}), nonceHex: ds.toHex(nonce), headerJson,
    headerBytes: ds.utf8(headerJson).length, frameLength: frame.length, base64Length: ds.toBase64(frame).length,
    small: ds.isSmallFrame(frame), frameBase64: ds.toBase64(frame), parse: lab.parseLabAck(header),
  });
}
const worst = labFrames.find((f) => f.name.startsWith('worst case: '));
assert.deepEqual([worst.headerBytes, worst.frameLength, worst.base64Length], [2572, 2608, 3480], 'the 2.2.1 bound');
assert.deepEqual(worst.parse, { inbox: null, states: [] }, 'a later level is unknown');
assert.equal(labFrames.at(-1).parse.states.length, 24);
assert.ok(labFrames.every((f) => f.small));
// One more state, or a header one byte over, is refused before anything is published.
await assert.rejects(lab.buildLabFrame(k1, { inbox: frameCases[0].inbox, states: [...worstStates, worstStates[0]] }), (e) => e.reason === 'too-many');

const v1Safety = labFrames.map((f) => ({ name: f.name, ...(f.loneSurrogates ? { loneSurrogates: true } : {}), frameBase64: f.frameBase64, kind: 'ack', ackIds: [] }));

// ---------------------------------------------------------------------------------------------------------------
// labParse (2.2.5): headers as JSON text -> {inbox, states}

const I = (o) => ({ v: 1, kind: 'ack', ids: [], sent: SENT, from: 'Daylight', ...o });
const X = (o = {}) => ({ lab: 1, app: 'android/1.5.0', caps: ['st', 'tap'], poll: POLL, live: true, ...o });
const id1 = idFrom('p1'), id2 = idFrom('p2'), id3 = idFrom('p3');
const E = (i, s = 'reader', t = T) => ({ i, s, t });
const J = (o) => JSON.stringify(o);
// Raw JSON texts: numbers written the way the case needs (1.0, 1e0, -0) and headers that are not objects.
const withLab = (labText, extra = '') => `{"v":1,"kind":"ack","ids":[],"sent":"${SENT}","x-inbox":{"lab":${labText},"app":"android/1.5.0","caps":["st"],"poll":"${POLL}","live":true},"x-st":[{"i":"${id1}","s":"reader","t":${T}}]${extra}}`;
const withT = (tText) => `{"v":1,"kind":"ack","ids":[],"sent":"${SENT}","x-st":[{"i":"${id1}","s":"reader","t":${tText}}]}`;
const withPoll = (poll) => J(I({ 'x-inbox': X({ poll }) }));
const many = (n, junk = 0) => Array.from({ length: n }, (_, k) => (k < junk ? { i: 'junk', s: 'reader', t: T } : E(idFrom('many-' + k), 'reader', T - k)));
const parseCases = [
  ['valid hello', J(I({ 'x-inbox': X() }))],
  ['valid hello with two states', J(I({ 'x-inbox': X(), 'x-st': [E(id1), E(id2, 'waiting', T - 5)] }))],
  ['valid: unknown header and x-inbox fields are ignored', J(I({ 'x-inbox': X({ extra: 1 }), 'x-st': [{ ...E(id1), x: 1 }], 'x-other': true, note: 'hi' }))],
  ['junk caps are dropped', J(I({ 'x-inbox': X({ caps: ['ST', 'st', 5, null, 'a b', '', 'x'.repeat(17), 'reader-link', { t: 'st' }] }) }))],
  ['caps not an array', J(I({ 'x-inbox': X({ caps: 'st' }) }))],
  ['17 valid caps: the first 16', J(I({ 'x-inbox': X({ caps: Array.from({ length: 17 }, (_, k) => 'c' + k) }) }))],
  ['16 junk caps before a valid one: none', J(I({ 'x-inbox': X({ caps: [...Array(16).fill('JUNK'), 'st'] }) }))],
  ['repeated caps after junk: the first of each', J(I({ 'x-inbox': X({ caps: ['JUNK', 'st', 'st', 'tap', 'st', 'tap'] }) }))],
  ['bad ids are dropped', J(I({ 'x-st': [E(id1.toUpperCase()), E(id1.slice(1)), E(id1 + '0'), { i: 5, s: 'reader', t: T }, E('g'.repeat(32)), E(id2)] }))],
  ['ids not empty: Lab fields ignored', J({ v: 1, kind: 'ack', ids: [id3], sent: SENT, 'x-inbox': X(), 'x-st': [E(id1)] })],
  ['ids missing', J({ v: 1, kind: 'ack', sent: SENT, 'x-inbox': X(), 'x-st': [E(id1)] })],
  ['ids not an array', J({ v: 1, kind: 'ack', ids: '', sent: SENT, 'x-inbox': X() })],
  ['ids is null', J({ v: 1, kind: 'ack', ids: null, sent: SENT, 'x-inbox': X() })],
  ['kind is not ack', J({ v: 1, kind: 'item', ids: [], sent: SENT, 'x-inbox': X() })],
  ['kind missing', J({ v: 1, ids: [], sent: SENT, 'x-inbox': X() })],
  ['unknown state token', J(I({ 'x-st': [E(id1, 'done'), E(id2, 'Reader'), E(id3, '__proto__'), E(id1, 'queued')] }))],
  ['t out of range', J(I({ 'x-st': [E(id1, 'reader', -1), E(id2, 'reader', 4102444801), E(id3, 'reader', 4102444800), E(id1, 'held', 0)] }))],
  ['missing x-inbox: states still read', J(I({ 'x-st': [E(id1)] }))],
  ['x-inbox is an array', J(I({ 'x-inbox': [X()], 'x-st': [E(id1)] }))],
  ['x-inbox is null', J(I({ 'x-inbox': null }))],
  ['x-inbox without lab', J(I({ 'x-inbox': { app: 'android/1', caps: ['st'] } }))],
  ['lab 0 (Lab turned off)', J(I({ 'x-inbox': X({ lab: 0, caps: [] }) }))],
  ['70 entries: the first 64 are read', J(I({ 'x-st': many(70) }))],
  ['70 entries with 6 junk first: 58 read', J(I({ 'x-st': many(70, 6) }))],
  ['x-st is an object', J(I({ 'x-st': { i: id1, s: 'reader', t: T } }))],
  ['x-st elements that are not objects', J(I({ 'x-st': [[id1, 'reader', T], null, 'x', 5, E(id2)] }))],
  ['the same i twice: both, in order', J(I({ 'x-st': [E(id1, 'waiting', T - 10), E(id1, 'reader', T)] }))],
  ['poll on Feb 30', withPoll('2026-02-30T08:00:00.000Z')],
  ['poll at T24:00', withPoll('2026-10-20T24:00:00.000Z')],
  ['poll with second 60', withPoll('2026-10-20T07:59:60.000Z')],
  ['poll with minute 60', withPoll('2026-10-20T07:60:00.000Z')],
  ['poll in month 13', withPoll('2026-13-01T00:00:00.000Z')],
  ['poll in month 00', withPoll('2026-00-10T00:00:00.000Z')],
  ['poll on day 00', withPoll('2026-10-00T00:00:00.000Z')],
  ['poll on Feb 29 of a leap year (2028)', withPoll('2028-02-29T12:00:00.000Z')],
  ['poll on Feb 29 of 2026 (not leap)', withPoll('2026-02-29T12:00:00.000Z')],
  ['poll on Feb 29, 2000 (leap: divisible by 400)', withPoll('2000-02-29T00:00:00.000Z')],
  ['poll on Feb 29, 2100 (not leap: divisible by 100)', withPoll('2100-02-29T00:00:00.000Z')],
  ['poll on Apr 31', withPoll('2026-04-31T00:00:00.000Z')],
  ['poll without a fraction', withPoll('2026-10-20T07:59:58Z')],
  ['poll with one fraction digit (.5 = 500 ms)', withPoll('2026-10-20T07:59:58.5Z')],
  ['poll with two fraction digits (.05 = 50 ms)', withPoll('2026-10-20T07:59:58.05Z')],
  ['poll with four fraction digits', withPoll('2026-10-20T07:59:58.0000Z')],
  ['poll with an offset instead of Z', withPoll('2026-10-20T07:59:58.000+00:00')],
  ['poll with lowercase t and z', withPoll('2026-10-20t07:59:58.000z')],
  ['poll with a space instead of T', withPoll('2026-10-20 07:59:58.000Z')],
  ['poll with Arabic-Indic digits', withPoll('٢٠٢٦-10-20T07:59:58.000Z')],
  ['poll with fullwidth digits', withPoll('２０２６-10-20T07:59:58.000Z')],
  ['poll before 1970', withPoll('1969-12-31T23:59:59.999Z')],
  ['poll as a number', J(I({ 'x-inbox': X({ poll: POLL_MS }) }))],
  ['lab as 1.0', withLab('1.0')],
  ['lab as 1e0', withLab('1e0')],
  ['lab as 1E0', withLab('1E0')],
  ['lab as 0.1e1', withLab('0.1e1')],
  ['lab as "1"', withLab('"1"')],
  ['lab as true', withLab('true')],
  ['lab as null', withLab('null')],
  ['lab 2 (above LAB_LEVEL): the whole frame is unknown', withLab('2')],
  ['lab 1e300: above LAB_LEVEL', withLab('1e300')],
  ['lab 1.5', withLab('1.5')],
  ['lab -1: no inbox, states read', withLab('-1')],
  ['lab -0 is 0', withLab('-0')],
  ['t as -0 is 0', withT('-0')],
  ['t as 1.5', withT('1.5')],
  ['t as a string', withT(`"${T}"`)],
  ['t as 1.792483198e9', withT('1.792483198e9')],
  ['t as true', withT('true')],
  ['app with an emoji', J(I({ 'x-inbox': X({ app: 'android/1.5.0 📚' }) }))],
  ['app with a combining mark', J(I({ 'x-inbox': X({ app: 'android/1.5.0é' }) }))],
  ['app with a control character', J(I({ 'x-inbox': X({ app: 'android/1.5.0\u0007' }) }))],
  ['app with DEL', J(I({ 'x-inbox': X({ app: 'android/1.5.0\u007f' }) }))],
  ['app of 61 characters: the first 60', J(I({ 'x-inbox': X({ app: 'android/' + '1'.repeat(53) }) }))],
  ['app empty', J(I({ 'x-inbox': X({ app: '' }) }))],
  ['app a number', J(I({ 'x-inbox': X({ app: 15 }) }))],
  ['app with a lone surrogate', J(I({ 'x-inbox': X({ app: 'android/\ud800' }) })), true],
  ['live as "true"', J(I({ 'x-inbox': X({ live: 'true' }) }))],
  ['live as 1', J(I({ 'x-inbox': X({ live: 1 }) }))],
  ['live missing', J(I({ 'x-inbox': { lab: 1, app: 'android/1', caps: [], poll: POLL } }))],
  ['header is an array', J([I({ 'x-inbox': X() })])],
  ['header is a string', J('ack')],
  ['header is null', 'null'],
  ['header is not JSON', '{"v":1,"kind":"ack","ids":[],'],
];
const parseJson = (text) => { try { return JSON.parse(text); } catch { return undefined; } };
const labParse = parseCases.map(([name, headerJson, lone]) => ({
  name, ...(lone ? { loneSurrogates: true } : {}), headerJson, expect: lab.parseLabAck(parseJson(headerJson)),
}));
assert.ok(labParse.length >= 45);
const P = (name) => labParse.find((c) => c.name === name).expect;
assert.deepEqual(P('junk caps are dropped').inbox.caps, ['st', 'reader-link']);
assert.deepEqual(P('16 junk caps before a valid one: none').inbox.caps, []);
assert.deepEqual(P('repeated caps after junk: the first of each').inbox.caps, ['st', 'tap']);
assert.deepEqual(P('bad ids are dropped').states.map((s) => s.id), [id2]);
assert.deepEqual(P('ids not empty: Lab fields ignored'), { inbox: null, states: [] });
assert.equal(P('70 entries: the first 64 are read').states.length, 64);
assert.equal(P('70 entries with 6 junk first: 58 read').states.length, 58);
assert.equal(P('poll on Feb 30').inbox.poll, null);
assert.equal(P('poll at T24:00').inbox.poll, null);
assert.equal(P('poll with second 60').inbox.poll, null);
assert.equal(P('poll on Feb 29 of a leap year (2028)').inbox.poll, Date.UTC(2028, 1, 29, 12));
assert.equal(P('poll on Feb 29 of 2026 (not leap)').inbox.poll, null);
assert.equal(P('poll on Feb 29, 2000 (leap: divisible by 400)').inbox.poll, Date.UTC(2000, 1, 29));
assert.equal(P('poll on Feb 29, 2100 (not leap: divisible by 100)').inbox.poll, null);
assert.equal(P('poll with one fraction digit (.5 = 500 ms)').inbox.poll, POLL_MS + 500);
assert.equal(P('poll with two fraction digits (.05 = 50 ms)').inbox.poll, POLL_MS + 50);
assert.equal(P('poll before 1970').inbox.poll, -1);
assert.equal(P('poll with Arabic-Indic digits').inbox.poll, null);
assert.equal(P('lab as 1.0').inbox.lab, 1);
assert.equal(P('lab as 1e0').inbox.lab, 1);
assert.equal(P('lab as "1"').inbox, null);
assert.equal(P('lab as "1"').states.length, 1);
assert.equal(P('lab as true').inbox, null);
assert.deepEqual(P('lab 2 (above LAB_LEVEL): the whole frame is unknown'), { inbox: null, states: [] });
assert.equal(P('lab -1: no inbox, states read').inbox, null);
assert.equal(P('lab -1: no inbox, states read').states.length, 1);
assert.ok(Object.is(P('lab -0 is 0').inbox.lab, 0));
assert.ok(Object.is(P('t as -0 is 0').states[0].t, 0));
assert.deepEqual(P('t as 1.5').states, []);
assert.equal(P('t as 1.792483198e9').states[0].t, T);
assert.equal(P('app with an emoji').inbox.app, '');
assert.equal(P('app with a combining mark').inbox.app, '');
assert.equal(P('app of 61 characters: the first 60').inbox.app.length, 60);
assert.deepEqual(P('the same i twice: both, in order').states.map((s) => s.s), ['waiting', 'reader']);
assert.deepEqual(P('header is not JSON'), { inbox: null, states: [] });
assert.deepEqual(P('t out of range').states.map((s) => s.t), [4102444800, 0]);

// ---------------------------------------------------------------------------------------------------------------
// labLedger (2.2.6): sequences of (header, relay time in seconds) -> the ledger at `now` (ms)

const hello = (app, caps, extra = {}) => I({ 'x-inbox': { lab: 1, app, caps, poll: POLL, live: false, ...extra } });
const off = (app) => I({ 'x-inbox': { lab: 0, app, caps: [], poll: POLL, live: false } });
const states = (...st) => I({ 'x-st': st });
const ack = (...ids) => ({ v: 1, kind: 'ack', ids, sent: SENT, from: 'Daylight' });
const A = 'android/1.5.0', R = 'reader-lab/0.27.900';
const capsA = ['st', 'tap', 'reader-link'], capsR = ['st', 'reader-link', 'reader-doc', 'quiet'];
const H = 3600, NOW = (T + 60) * 1000;
const ledgerCases = [
  ['a v1.1 ack only: heard, no Lab', [[ack(id1), T]], NOW],
  ['a hello: Lab on, its caps, checked in at poll or heard', [[hello(A, capsA), T + 2]], NOW],
  ['equal rank with a later t replaces', [[states(E(id1, 'held', T - 100)), T], [states(E(id1, 'inbox', T - 50)), T + 1]], NOW],
  ['equal rank with an earlier t is ignored', [[states(E(id1, 'inbox', T - 50)), T], [states(E(id1, 'held', T - 100)), T + 1]], NOW],
  ['equal rank and equal t: the first stays', [[states(E(id1, 'handed', T)), T], [states(E(id1, 'failed', T)), T + 1]], NOW],
  ['a lower rank is ignored', [[states(E(id1, 'reader', T - 10)), T], [states(E(id1, 'handed', T)), T + 1]], NOW],
  ['held after waiting, then a re-announced waiting', [[states(E(id1, 'waiting', T - 100)), T - 90], [states(E(id1, 'held', T - 50)), T - 40], [states(E(id1, 'waiting', T)), T + 1]], NOW],
  ['repeats of an id within one frame merge in order', [[states(E(id1, 'waiting', T - 10), E(id1, 'reader', T - 5), E(id1, 'handed', T)), T]], NOW],
  ['a hello exactly 36 h old is still fresh', [[hello(A, capsA), T]], T * 1000 + 36 * H * 1000],
  ['a hello gone stale at 36 h + 1 ms', [[hello(A, capsA), T]], T * 1000 + 36 * H * 1000 + 1],
  ['two publishers, android first: caps are the union', [[hello(A, capsA), T], [hello(R, capsR), T + 5]], NOW],
  ['two publishers, reader-lab first: caps are the union', [[hello(R, capsR), T], [hello(A, capsA), T + 5]], NOW],
  ['two publishers within the same relay second', [[hello(A, capsA), T], [hello(R, capsR), T]], NOW],
  ['the same publisher twice in one relay second: the later message wins', [[hello(A, capsA), T], [hello(A, ['st']), T]], NOW],
  ['an older message after a newer one is ignored', [[hello(A, ['st']), T], [hello(A, capsA), T - 10]], NOW],
  ['lab 0 from one of two publishers', [[hello(A, capsA), T], [hello(R, capsR), T + 1], [off(A), T + 2]], NOW],
  ['lab 0 from the only publisher ends Lab at once', [[hello(A, capsA), T], [off(A), T + 2]], NOW],
  ['handover 5.3.4: Daylight Share hands over to the Lab Reader', [[hello(A, capsA), T - 60], [states(E(id1, 'handed', T - 50)), T - 50], [off(A), T - 30], [hello(R, capsR), T - 20], [states(E(id2, 'reader', T - 10)), T - 10]], NOW],
  ['handover back: the Lab Reader stops, Daylight Share receives again', [[hello(R, capsR), T - 60], [off(R), T - 30], [hello(A, capsA), T - 20]], NOW],
  ['a poll later than its relay time is clamped', [[hello(A, capsA, { poll: '2026-10-20T09:00:00.000Z' }), T]], NOW],
  ['heard later than the newest poll', [[hello(A, capsA, { poll: '2026-10-20T07:00:00.000Z' }), T - 100], [ack(id2), T]], NOW],
  ['states without x-inbox are kept; no Lab', [[states(E(id1, 'reader', T)), T]], NOW],
  ['an unknown or empty app is the publisher other', [[hello('ios/2.0', ['st']), T], [hello('', ['tap']), T + 1]], NOW],
  ['a later Lab level is ignored, but heard', [[I({ 'x-inbox': { lab: 2, app: A, caps: capsA }, 'x-st': [E(id1)] }), T]], NOW],
  ['a header whose kind is not ack is ignored', [[{ v: 1, kind: 'item', ids: [], 'x-inbox': X() }, T]], NOW],
];
const CAP_TOKENS = ['st', 'tap', 'reader-link', 'cap-kind', 'reader-doc', 'quiet'];
const labLedger = [];
for (const [name, steps, now] of ledgerCases) {
  const ledger = new lab.LabLedger({ storage: new ds.MemoryStorage(), now: () => now });
  for (const [header, time] of steps) await ledger.record(header, { time });
  const snap = await ledger.snapshot();
  const states = {};
  for (const id of [id1, id2, id3]) { const s = await ledger.state(id); if (s) states[id] = s; }
  labLedger.push({
    name, steps: steps.map(([header, time]) => ({ headerJson: J(header), time })), now,
    expect: {
      states, inboxLab: snap.inboxLab, caps: snap.caps,
      hasCap: Object.fromEntries(CAP_TOKENS.map((t) => [t, snap.hasCap(t)])), checkedIn: snap.checkedIn,
      publishers: Object.fromEntries(snap.publishers.map(({ publisher, ...e }) => [publisher, e])),
    },
  });
}
const L = (name) => labLedger.find((c) => c.name === name).expect;
assert.equal(L('equal rank with a later t replaces').states[id1].s, 'inbox');
assert.equal(L('a lower rank is ignored').states[id1].s, 'reader');
assert.equal(L('held after waiting, then a re-announced waiting').states[id1].s, 'held');
assert.equal(L('a hello exactly 36 h old is still fresh').inboxLab, true);
assert.equal(L('a hello gone stale at 36 h + 1 ms').inboxLab, false);
assert.deepEqual(L('two publishers within the same relay second').caps, ['quiet', 'reader-doc', 'reader-link', 'st', 'tap']);
assert.deepEqual(L('the same publisher twice in one relay second: the later message wins').caps, ['st']);
assert.deepEqual(L('lab 0 from one of two publishers').caps, capsR.slice().sort());
assert.equal(L('lab 0 from the only publisher ends Lab at once').inboxLab, false);
assert.equal(L('handover 5.3.4: Daylight Share hands over to the Lab Reader').hasCap['reader-doc'], true);
assert.equal(L('a poll later than its relay time is clamped').checkedIn, T * 1000);
assert.equal(L('a v1.1 ack only: heard, no Lab').checkedIn, T * 1000);
assert.equal(L('a header whose kind is not ack is ignored').checkedIn, null);

// ---------------------------------------------------------------------------------------------------------------
// labGate (1.5, 2.6, 2.7.2): a stubbed ctx -> {ready, state, short, message, button, serverKey}

const SERVER_TEXT = { // stand-ins for the server module's messages: the gate passes them through unchanged
  OFFLINE: 'Couldn’t reach the Daylight server. Check your connection and try again.',
};
const gateCases = [
  ['Lab off', 'F01', { lab: false, platform: 'iphone' }],
  ['Lab off (Android names Daylight Share)', 'F09', { lab: false, platform: 'android' }],
  ['not paired', 'F37', { lab: true, paired: false, platform: 'iphone' }],
  ['the timeline without a Lab hello', 'F01', { lab: true, paired: true, caps: [], platform: 'iphone' }],
  ['the timeline with st', 'F01', { lab: true, paired: true, caps: ['st'], platform: 'iphone' }],
  ['a feature with no Inbox capability needed', 'F16', { lab: true, paired: true, caps: [], platform: 'chrome' }],
  ['notifications off on the iPhone', 'F04', { lab: true, paired: true, caps: [], local: 'needs-notifications', platform: 'iphone' }],
  ['notifications off on the Mac', 'F04', { lab: true, paired: true, caps: [], local: 'needs-notifications', platform: 'mac' }],
  ['notifications off on Android', 'F04', { lab: true, paired: true, caps: [], local: 'needs-notifications', platform: 'android' }],
  ['notifications off on Windows', 'F04', { lab: true, paired: true, caps: [], local: 'needs-notifications', platform: 'windows' }],
  ['notifications off in Chrome (no settings path)', 'F04', { lab: true, paired: true, caps: [], local: 'needs-notifications', platform: 'chrome' }],
  ['quick sends off', 'F09', { lab: true, paired: true, caps: [], local: 'needs-quick-sends', platform: 'iphone' }],
  ['site access', 'F03', { lab: true, paired: true, caps: [], local: 'needs-site-access', platform: 'chrome' }],
  ['pairing comes before the local check', 'F04', { lab: true, paired: false, local: 'needs-notifications', platform: 'iphone' }],
  ['the local check comes before the server', 'F37', { lab: true, paired: true, local: 'needs-site-access', server: { state: 'ready' }, platform: 'safari' }],
  ['no server object', 'F37', { lab: true, paired: true, server: null, platform: 'iphone' }],
  ['server: needs-server (the short sentence)', 'F37', { lab: true, paired: true, server: { state: 'needs-server', message: 'the module’s long text' }, platform: 'iphone' }],
  ['server: needs-lab-inbox (the short sentence)', 'F36', { lab: true, paired: true, server: { state: 'needs-lab-inbox', message: 'the module’s text' }, platform: 'mac' }],
  ['server: needs-key', 'F37', { lab: true, paired: true, server: { state: 'needs-key', message: 'Needs a Claude API key. Add ANTHROPIC_API_KEY to the Daylight server (GitHub › Settings › Secrets), then re-run the deploy, to turn this on.' }, platform: 'iphone' }],
  ['server: needs-domain', 'F19', { lab: true, paired: true, server: { state: 'needs-domain', message: 'domain text' }, platform: 'iphone' }],
  ['server: needs-r2', 'F02', { lab: true, paired: true, server: { state: 'needs-r2', message: 'r2 text' }, platform: 'iphone' }],
  ['server: needs-paid', 'F19', { lab: true, paired: true, server: { state: 'needs-paid', message: 'paid text' }, platform: 'iphone' }],
  ['server: pairing-mismatch', 'F37', { lab: true, paired: true, server: { state: 'pairing-mismatch', message: 'mismatch text' }, platform: 'iphone' }],
  ['server: locked', 'F37', { lab: true, paired: true, server: { state: 'locked', message: 'locked text' }, platform: 'iphone' }],
  ['server: server-outdated', 'F37', { lab: true, paired: true, server: { state: 'server-outdated', message: 'outdated text' }, platform: 'iphone' }],
  ['server: app-outdated', 'F37', { lab: true, paired: true, server: { state: 'app-outdated', message: 'update text' }, platform: 'iphone' }],
  ['server: OFFLINE', 'F37', { lab: true, paired: true, server: { state: 'OFFLINE', message: SERVER_TEXT.OFFLINE }, platform: 'iphone' }],
  ['server: error with the server’s message', 'F37', { lab: true, paired: true, server: { state: 'error', message: 'Something went wrong on the Daylight server (X). Try again later.' }, platform: 'iphone' }],
  ['server: an unknown state is an error', 'F37', { lab: true, paired: true, server: { state: 'weird', message: 'odd' }, platform: 'iphone' }],
  ['a server that never answers: OFFLINE at the deadline', 'F37', { lab: true, paired: true, server: 'never', serverMessages: SERVER_TEXT, platform: 'iphone' }],
  ['a server that throws OFFLINE', 'F37', { lab: true, paired: true, server: 'throws-offline', platform: 'iphone' }],
  ['server ready, feature not built yet: later', 'F37', { lab: true, paired: true, server: { state: 'ready' }, built: false, platform: 'iphone' }],
  ['server ready, files not built yet: later', 'files', { lab: true, paired: true, server: { state: 'ready' }, built: false, platform: 'android' }],
  ['server ready and built', 'F02', { lab: true, paired: true, server: { state: 'ready' }, built: true, platform: 'iphone' }],
  ['the server key for files', 'files', { lab: true, paired: true, server: { state: 'needs-server' }, platform: 'iphone' }],
  ['the server key for a PDF summary', 'pdf', { lab: true, paired: true, server: { state: 'needs-key', message: 'key text' }, platform: 'iphone' }],
  ['email-in asks the email feature', 'F19', { lab: true, paired: true, server: { state: 'ready' }, platform: 'web' }],
];
/** Builds the gate's ctx from a vector's stub (the test runner does the same). */
function gateCtx(stub, asked, deadlineMs = 20) {
  const server = stub.server === undefined || stub.server === null ? null
    : stub.server === 'never' ? { state: (key) => { asked.push(key); return new Promise(() => {}); } }
      : stub.server === 'throws-offline' ? { state: async (key) => { asked.push(key); const e = new Error('Couldn’t reach the Daylight server. Check your connection and try again.'); e.code = 'OFFLINE'; throw e; } }
        : { state: async (key) => { asked.push(key); return { state: stub.server.state, message: stub.server.message ?? null }; } };
  return {
    lab: stub.lab, paired: stub.paired, platform: stub.platform, hasCap: stub.caps ?? [],
    local: stub.local ? async () => stub.local : undefined, server,
    serverMessage: stub.serverMessages ? (s) => stub.serverMessages[s] ?? null : undefined,
    built: stub.built === undefined ? undefined : async () => stub.built, deadlineMs,
  };
}
const labGate = [];
for (const [name, feature, stub] of gateCases) {
  const asked = [];
  const r = await lab.labGate(feature, gateCtx(stub, asked));
  labGate.push({ name, feature, ctx: stub, expect: { ...r, serverKey: asked[0] ?? null } });
}
const G = (name) => labGate.find((c) => c.name === name).expect;
assert.equal(G('Lab off').state, 'lab-off');
assert.equal(G('Lab off (Android names Daylight Share)').message, 'Turn on Lab in Daylight Share to use this.');
assert.equal(G('the timeline without a Lab hello').state, 'needs-inbox');
assert.equal(G('the timeline with st').ready, true);
assert.equal(G('a server that never answers: OFFLINE at the deadline').state, 'OFFLINE');
assert.equal(G('a server that never answers: OFFLINE at the deadline').short, 'Can’t reach the server');
assert.equal(G('server: needs-server (the short sentence)').message, lab.LAB_TEXT.needs['needs-server']);
assert.equal(G('server: needs-server (the short sentence)').button, 'Copy Server code');
assert.equal(G('server ready, feature not built yet: later').message, 'Your Daylight server is ready. Summaries with Claude comes to this app in a later Lab update.');
assert.equal(G('the server key for a PDF summary').serverKey, 'pdf');
assert.equal(G('notifications off in Chrome (no settings path)').message, 'Needs notifications for Send to Daylight.');

// ---------------------------------------------------------------------------------------------------------------
// labHeaderExtras (2.3): item headers -> the extras checkItemHeader returns

const base = (o) => ({ v: 1, id: idFrom('x'), kind: 'page', url: 'https://example.com/a', size: 10, sha256: 'a'.repeat(64), sent: SENT, ...o });
const longOrig = 'https://example.com/' + 'a'.repeat(1100);
const extrasCases = [
  ['page with x-cap seen and x-orig', base({ 'x-cap': 'seen', 'x-orig': 'https://example.com/a?utm_source=x' })],
  ['x-cap clean', base({ 'x-cap': 'clean' })],
  ['x-cap excerpt on a file', base({ kind: 'file', url: undefined, name: 'e.html', mime: 'text/html', 'x-cap': 'excerpt' })],
  ['x-cap test', base({ 'x-cap': 'test' })],
  ['x-cap in another case', base({ 'x-cap': 'Seen' })],
  ['x-cap unknown', base({ 'x-cap': 'summary' })],
  ['x-cap a number', base({ 'x-cap': 1 })],
  ['x-cap an array', base({ 'x-cap': ['seen'] })],
  ['x-orig on a url item', { v: 1, id: idFrom('u'), kind: 'url', url: 'https://example.com/a', sent: SENT, 'x-orig': 'https://t.co/abc' }],
  ['x-orig with spaces around: trimmed', base({ 'x-orig': '  https://example.com/orig  ' })],
  ['x-orig not a web URL (ftp)', base({ 'x-orig': 'ftp://example.com/a' })],
  ['x-orig with a space inside', base({ 'x-orig': 'https://example.com/a b' })],
  ['x-orig not a string', base({ 'x-orig': { url: 'https://example.com' } })],
  ['x-orig of 1,120 characters: kept (the 1,024 limit is the sender’s)', base({ 'x-orig': longOrig })],
  ['x-orig of 4,097 characters: dropped', base({ 'x-orig': 'https://example.com/' + 'a'.repeat(4077) })],
  ['x-cap and x-orig on part 0 of 2', base({ kind: 'file', url: undefined, name: 'b.pdf', mime: 'application/pdf', part: 0, parts: 2, 'x-cap': 'seen', 'x-orig': 'https://example.com/b' })],
  ['x-cap and x-orig on part 1 of 2: nothing', base({ kind: 'file', url: undefined, name: 'b.pdf', mime: 'application/pdf', part: 1, parts: 2, 'x-cap': 'seen', 'x-orig': 'https://example.com/b' })],
  ['unknown x- fields are dropped', base({ 'x-note': 'hi', 'x-tags': ['a'], 'x-foo': 1, 'x-inbox': {}, 'x-st': [] })],
  ['no Lab fields', base({})],
];
const labHeaderExtras = extrasCases.map(([name, header]) => {
  const clean = JSON.parse(J(header));
  return { name, headerJson: J(clean), expect: ds.checkItemHeader(clean).extras };
});
const XE = (name) => labHeaderExtras.find((c) => c.name === name).expect;
assert.deepEqual(XE('page with x-cap seen and x-orig'), { 'x-cap': 'seen', 'x-orig': 'https://example.com/a?utm_source=x' });
assert.deepEqual(XE('x-orig with spaces around: trimmed'), { 'x-orig': 'https://example.com/orig' });
assert.deepEqual(XE('x-cap and x-orig on part 1 of 2: nothing'), {});
assert.deepEqual(XE('unknown x- fields are dropped'), {});
assert.equal(XE('x-orig of 1,120 characters: kept (the 1,024 limit is the sender’s)')['x-orig'], longOrig);

// ---------------------------------------------------------------------------------------------------------------
// labRowText (2.5): (row, now, ctx) -> {label, sentence, action, stepLine, final} and the accessibility label

const NOW_ROW = Date.UTC(2026, 9, 20, 9);
const row = (o) => ({ id: idFrom('row'), kind: 'url', title: 'A story', status: 'sent', errorCode: '', created: NOW_ROW - 60000, size: 0, ...o });
const LAB = { lab: true, inboxLab: true, hasCap: ['st', 'tap', 'reader-link'], state: null, online: true };
const rowCases = [
  ['Lab off: v1.1 delivered', row({ status: 'delivered' }), { ...LAB, lab: false, state: { s: 'reader', t: T } }],
  ['Lab off: v1.1 sending, even offline', row({ status: 'sending' }), { ...LAB, lab: false, online: false }],
  ['offline: sending waits for connection', row({ status: 'sending' }), { ...LAB, online: false }],
  ['offline: failed (network) waits for connection', row({ status: 'failed', errorCode: 'network' }), { ...LAB, online: false }],
  ['offline: failed (full) stays v1.1’s', row({ status: 'failed', errorCode: 'full' }), { ...LAB, online: false }],
  ['offline: sent stays sent', row({ status: 'sent' }), { ...LAB, online: false }],
  ['online unknown: sending', row({ status: 'sending' }), { ...LAB, online: undefined }],
  ['sending', row({ status: 'sending' }), LAB],
  ['sent', row({ status: 'sent' }), LAB],
  ['sent a day ago', row({ status: 'sent', created: NOW_ROW - 86400000 }), LAB],
  ['failed (network)', row({ status: 'failed', errorCode: 'network' }), LAB],
  ['failed (full)', row({ status: 'failed', errorCode: 'full' }), LAB],
  ['failed (refused)', row({ status: 'failed', errorCode: 'refused' }), LAB],
  ['expired', row({ status: 'expired', errorCode: '' }), LAB],
  ['expired (full)', row({ status: 'expired', errorCode: 'full' }), LAB],
  ['expired (refused)', row({ status: 'expired', errorCode: 'refused' }), LAB],
  ['expired (too large)', row({ kind: 'file', status: 'expired', errorCode: 'too-large', size: 14000000 }), LAB],
  ['expired (gone)', row({ status: 'expired', errorCode: 'gone' }), LAB],
  ['delivered, the Inbox is not Lab: v1.1', row({ status: 'delivered' }), { ...LAB, inboxLab: false, state: { s: 'reader', t: T } }],
  ['delivered, a Lab Inbox without st: v1.1', row({ status: 'delivered' }), { ...LAB, hasCap: ['tap'], state: { s: 'reader', t: T } }],
  ['delivered, no state yet', row({ status: 'delivered' }), LAB],
  ['delivered, an unknown state', row({ status: 'delivered' }), { ...LAB, state: { s: 'done', t: T } }],
  ['waiting', row({ status: 'delivered', kind: 'file' }), { ...LAB, state: { s: 'waiting', t: T } }],
  ['held', row({ status: 'delivered', kind: 'file' }), { ...LAB, state: { s: 'held', t: T } }],
  ['inbox', row({ status: 'delivered', kind: 'file' }), { ...LAB, state: { s: 'inbox', t: T } }],
  ['handed, a file', row({ status: 'delivered', kind: 'file' }), { ...LAB, state: { s: 'handed', t: T } }],
  ['handed, a link', row({ status: 'delivered', kind: 'url' }), { ...LAB, state: { s: 'handed', t: T } }],
  ['handed, a page', row({ status: 'delivered', kind: 'page' }), { ...LAB, state: { s: 'handed', t: T } }],
  ['failed (Reader)', row({ status: 'delivered', kind: 'file' }), { ...LAB, state: { s: 'failed', t: T } }],
  ['queued', row({ status: 'delivered' }), { ...LAB, state: { s: 'queued', t: T } }],
  ['reader', row({ status: 'delivered' }), { ...LAB, state: { s: 'reader', t: T } }],
  ['reader, the state given as a token', row({ status: 'delivered' }), { ...LAB, state: 'reader' }],
  ['offline does not change a delivered row', row({ status: 'delivered' }), { ...LAB, online: false, state: { s: 'reader', t: T } }],
];
const labRowText = rowCases.map(([name, r, ctx]) => {
  const d = lab.describeLabRow(r, NOW_ROW, ctx);
  return { name, row: r, now: NOW_ROW, ctx: JSON.parse(J(ctx)), expect: { ...d, a11y: lab.labRowA11yLabel(d) } };
});
const RT = (name) => labRowText.find((c) => c.name === name).expect;
assert.equal(RT('reader').label, 'In your Reader ✓');
assert.equal(RT('reader').stepLine, 'Sent ✓ · On your Daylight ✓ · In the Reader ✓');
assert.equal(RT('handed, a file').stepLine, 'Sent ✓ · On your Daylight ✓ · Handed to the Reader');
assert.equal(RT('handed, a file').final, true);
assert.equal(RT('waiting').final, false);
assert.equal(RT('offline: sending waits for connection').label, 'Waiting for connection');
assert.equal(RT('delivered, the Inbox is not Lab: v1.1').label, 'Delivered ✓');
assert.equal(RT('delivered, the Inbox is not Lab: v1.1').stepLine, null);
assert.equal(RT('sent').stepLine, 'Sent ✓ · On your Daylight … · In the Reader');
assert.equal(RT('failed (network)').action, 'retry-now');
assert.equal(RT('reader').a11y, 'In your Reader ✓. Saved in the Daylight Reader.');

// ---------------------------------------------------------------------------------------------------------------
// labText (1.4, 1.6, 2.5, 2.6): every string id -> text, the per-platform messages, short states, the headers and the
// Daylight server section's lines

function flatten(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (Array.isArray(v)) out[key] = v.join(',');
    else flatten(v, key, out);
  }
  return out;
}
const PLATFORMS = ['iphone', 'ipad', 'mac', 'chrome', 'safari', 'web', 'windows', 'android', 'inbox'];
const STATES = ['ready', 'needs-pairing', 'needs-inbox', 'needs-notifications', 'needs-quick-sends', 'needs-site-access',
  'needs-server', 'needs-lab-inbox', 'later', 'pairing-mismatch', 'locked', 'server-outdated', 'app-outdated', 'needs-key',
  'needs-r2', 'needs-domain', 'needs-paid', 'OFFLINE', 'error'];
const messages = [];
for (const state of STATES) {
  messages.push({ state, short: true, expect: lab.needsMessage(state, { short: true }) });
  if (state === 'needs-server') messages.push({ state, short: true, heading: true, expect: lab.needsMessage(state, { short: true, heading: true }) });
}
for (const platform of PLATFORMS) {
  for (const state of ['needs-pairing', 'needs-inbox', 'needs-notifications', 'needs-quick-sends', 'needs-site-access', 'needs-server', 'needs-lab-inbox']) {
    messages.push({ state, platform, expect: lab.needsMessage(state, { platform }) });
  }
}
for (const feature of ['F02', 'F37', 'F19', 'F36', 'files', 'ai', 'pdf', 'email', 'feeds', 'deliver']) {
  messages.push({ state: 'later', platform: 'iphone', feature, expect: lab.needsMessage('later', { platform: 'iphone', feature }) });
}
messages.push({ state: 'needs-key', platform: 'iphone', message: 'the server’s text', expect: lab.needsMessage('needs-key', { message: 'the server’s text' }) });
messages.push({ state: 'needs-key', platform: 'iphone', expect: lab.needsMessage('needs-key', { platform: 'iphone' }) });
messages.push({ state: 'nonsense', platform: 'iphone', expect: lab.needsMessage('nonsense', { platform: 'iphone' }) });
const M = 60000, HR = 3600000;
const checkedIn = [
  [null, NOW_ROW], [NOW_ROW, NOW_ROW], [NOW_ROW - 59999, NOW_ROW], [NOW_ROW - M, NOW_ROW], [NOW_ROW - 4 * M - 30000, NOW_ROW],
  [NOW_ROW - 59 * M - 59999, NOW_ROW], [NOW_ROW - HR, NOW_ROW], [NOW_ROW - 47 * HR - 59 * M, NOW_ROW], [NOW_ROW - 48 * HR, NOW_ROW],
  [NOW_ROW - 30 * 86400000, NOW_ROW], [NOW_ROW + 5 * M, NOW_ROW],
].map(([ms, now]) => ({ ms, now, expect: lab.checkedInText(ms, now) }));
const inboxHeader = [
  [true, NOW_ROW - 4 * M], [false, NOW_ROW - 4 * M], [false, null], [true, NOW_ROW - 3 * HR],
].map(([inboxLab, at]) => ({ inboxLab, checkedIn: at, now: NOW_ROW, expect: lab.inboxLabText({ inboxLab, checkedIn: at }, NOW_ROW) }));
// The server's short state for the whole server: What's in Lab's server heading line and the "Daylight server ›" row
const SERVER_ROW_STATES = ['ready', 'needs-pairing', 'needs-server', 'pairing-mismatch', 'locked', 'server-outdated',
  'app-outdated', 'needs-key', 'needs-r2', 'needs-domain', 'needs-paid', 'needs-lab-inbox', 'OFFLINE', 'error', 'later', 'nonsense'];
const serverRow = SERVER_ROW_STATES.map((state) => ({ state, heading: lab.serverHeadingShort(state), subtitle: lab.serverRowSubtitle(state) }));
const serverFeature = [
  ['needs-server', 'needs-server'], ['needs-key', 'ready'], ['ready', 'ready'], ['later', 'ready'], ['needs-key', 'needs-key'],
  ['needs-lab-inbox', 'ready'], ['OFFLINE', 'OFFLINE'], ['needs-r2', 'needs-server'], ['nonsense', 'error'], ['nonsense', 'ready'],
].map(([state, headingState]) => ({ state, headingState, expect: lab.serverFeatureShort(state, headingState) }));
const serverSection = {
  moved: ['https://daylight-3f9a.example.workers.dev', 'https://daylight.example.org:8443', 'https://daylight.example.org/',
    'daylight.example.org'].map((moved) => ({ moved, expect: lab.serverMovedText(moved) })),
  labInboxSeen: [
    [null], ['2026-10-20T08:56:00.000Z'], ['2026-10-20T09:00:00Z'], ['2026-10-19T07:00:00.000Z'], ['2026-10-14T09:00:00.000Z'],
    [NOW_ROW - 90 * M], ['2026-02-30T00:00:00.000Z'], ['2026-10-20T08:56:00+00:00'], ['yesterday'], [true], [''],
  ].map(([lastSeen]) => ({ lastSeen, now: NOW_ROW, expect: lab.labInboxSeenText(lastSeen, NOW_ROW) })),
  aiToday: [
    [0, 3], [0.227, 3], [2.5, 10], [2.999, 3], [0.004, 3], [1.005, 3], [0.015, 3], [12.345, 10], [3, 3], [null, 3], [-1, 3], ['0.5', 3],
  ].map(([used, cap]) => ({ used, cap, expect: lab.aiTodayText(used, cap) })),
};
const w1 = await buildW1();
const labText = {
  strings: flatten(lab.LAB_TEXT), messages, checkedIn, inboxHeader, serverRow, serverFeature, serverSection,
  features: [...lab.LAB_TEXT.featureOrder, ...lab.LAB_TEXT.serverFeatureOrder].map((id) => ({ id, ...lab.LAB_TEXT.features[id] })),
  // W1 (L1)
  kindLines: w1.kindLines, cleanedFrom: w1.cleanedFrom, use: w1.use,
  useFeatures: lab.USE_FEATURES.map((id) => ({ id, footer: lab.LAB_TEXT.use.footers[id], a11y: lab.fillText(lab.LAB_TEXT.use.a11y, { feature: lab.LAB_TEXT.features[id].name }) })),
};
assert.equal(serverRow.find((c) => c.state === 'needs-server').subtitle, 'Optional · Not set up', 'plan 1.1');
assert.equal(serverRow.find((c) => c.state === 'needs-key').subtitle, 'Optional · Needs a Claude key');
assert.equal(serverFeature[0].expect, null);
assert.equal(serverFeature[1].expect, 'Needs a Claude key', 'plan 1.4');
assert.equal(serverSection.moved[0].expect, 'Your Daylight server moved to daylight-3f9a.example.workers.dev. Use it?');
assert.equal(serverSection.labInboxSeen[0].expect, 'Your Daylight hasn’t said hello to the server yet.');
assert.equal(serverSection.labInboxSeen[1].expect, 'Lab Inbox last seen 4 min ago');
assert.equal(serverSection.aiToday[1].expect, 'AI today: US$0.23 of US$3');
assert.equal(serverSection.aiToday[5].expect, 'AI today: US$1 of US$3', '1.005 × 100 is 100.49999999999999');
assert.equal(serverSection.aiToday[6].expect, 'AI today: US$0.02 of US$3', '0.015 × 100 is 1.5');
assert.equal(labText.strings['short.needs-inbox'], 'Needs Lab on your Daylight');
assert.equal(labText.checkedIn[4].expect, 'Your Daylight checked in 4 min ago.');
assert.equal(labText.checkedIn[0].expect, 'Your Daylight hasn’t checked in since this device paired.');
assert.equal(labText.checkedIn[8].expect, 'Your Daylight checked in 2 days ago.');
assert.equal(labText.inboxHeader[0].expect, 'Your Daylight: Lab on · checked in 4 min ago');
assert.equal(messages.find((m) => m.state === 'needs-notifications' && m.platform === 'android').expect,
  'Needs notifications for Daylight Share. Turn them on in Settings › Apps › Daylight Share › Notifications.');
assert.ok(Object.values(labText.strings).every((s) => !/[A-Za-z]'[A-Za-z]/.test(s)), 'typographic apostrophes only');

// ---------------------------------------------------------------------------------------------------------------

const constants = Object.fromEntries(['LAB_LEVEL', 'MAX_ST_PER_FRAME', 'MAX_ST_READ', 'MAX_CAPS', 'APP_MAX', 'T_MAX',
  'HELLO_EVERY_MS', 'STATE_DIGEST_WINDOW_MS', 'STATE_DIGEST_MAX', 'INBOX_STALE_MS', 'PENDING_MAX', 'LEDGER_STATES_MAX',
  'LAB_FRAME_GAP_MS', 'LAB_FRAMES_PER_DAY', 'LAB_YIELD_MS', 'LAB_OFF_REPEAT_MS', 'LAB_OFF_REPEATS', 'LAB_FLUSH_DELAY_MS',
  'GATE_DEADLINE_MS', 'FAST_CHECK_MS', 'FAST_CHECK_WINDOW_MS', 'STATE_RANK', 'LAB_STATES', 'CAPS', 'FEATURE_CAPS',
  'SERVER_FEATURES', 'SERVER_KEYS',
  // W1 (L1)
  'USE_FEATURES', 'EXCERPT_MAX_CHARS', 'EXCERPT_LINE_MAX', 'EXCERPT_NAME_WORDS', 'TEXT_FRAGMENT_WORDS', 'ACTIVITY_MAX',
  'DIAGNOSTICS_EVENTS', 'TEST_URL_PREFIX', 'EXCERPT_TAGS', 'EXCERPT_AS_P', 'EXCERPT_DROP', 'TRACKING_PARAMS',
  'TRACKING_BY_SITE'].map((k) => [k, lab[k]]));

const out = {
  protocol: 'Daylight Share Lab (reader-experiment/share/LAB-PROTOCOL.md) on protocol v1, revision 1.1',
  generatedBy: 'reader-experiment/share/vectors/generate-lab.mjs',
  notes: [
    'Everything here is deterministic: CI regenerates this file and requires no diff. Secrets are those of test-vectors.json (pairing[0] is vector-secret-1). Times: `time` is a relay time in Unix seconds, `now`, `at`, `poll` and `checkedIn` are milliseconds since 1970 (UTC), and a state\'s `t` is Unix seconds.',
    'loneSurrogates: the case holds a UTF-16 lone surrogate (written as a \\ud800 escape). Swift skips these cases (Swift strings cannot hold one); JS and Kotlin run them.',
    'constants: the Lab constants every port uses (2.2, 2.7.2).',
    'labTopics: the four derived topics (2.4) for each secret: "dls-" + the first 32 hex digits of SHA-256(label + 0x00 + secret). aads: the AAD of every purpose; an unknown purpose is an error ("purpose"), never a default. returnFrame: seal headerJson bytes with the pairing key, nonceHex and the lab-return AAD; it must equal frameHex, open back, and fail to open (an error "frame") with each of refusedPurposes.',
    'labFrames: Lab frames (2.2.1) sealed like acks (pairing key of vector-secret-1, AAD dlshare/v1/ack). Seal headerJson bytes with nonceHex: the frame must equal frameBase64; open it and run parseLabAck: it must equal `parse`. headerBytes, frameLength and base64Length pin the worst case of 2.2.1 (2,572, 2,608 and 3,480), and every frame is small. A builder (buildLabFrame / LabFrame.build) refuses more than 24 states and any frame that is not small.',
    'labParse: parse headerJson with the platform JSON parser; a parse failure, or anything that is not an object, is step 1 of 2.2.5. Then parseLabAck must give expect exactly: inbox null or {lab, app, caps, poll (ms or null), live}, and states [{id, s, t}] in order. Rule I (integers by value: 1.0, 1e0 and 0.1e1 are 1, -0 is 0, "1", true and 1.5 are not), rule D (dates checked field by field, ASCII digits only) and the clamps are all exercised.',
    'labLedger: feed each step (headerJson parsed, relay `time` in seconds) to LabLedger.record in order, then read the ledger at `now`: states (for the ids that have one), inboxLab, caps (the union of fresh publishers with lab >= 1, sorted), hasCap per token, checkedIn (the later of heard and the newest clamped poll, or null) and publishers (android, reader-lab or other: lab, app, caps, poll clamped to its message\'s relay time, live, at). A publisher is fresh while now - at <= 36 h. A message replaces its publisher\'s entry when its at is the same or later. A header whose kind is not "ack" is ignored, heard included.',
    'labGate: build the gate\'s ctx from the stub: lab, paired, caps (hasCap is true for these tokens), local (the app\'s own check answers this state), server (null: no server object; {state, message}: what server.state(key) answers; "never": it never answers, so the gate\'s deadline gives OFFLINE; "throws-offline": it throws an OFFLINE error whose message is the OFFLINE text), serverMessages (the server module\'s texts, for an OFFLINE the deadline decided), built (absent = built) and platform. expect: ready, state, message, short, button, and serverKey (the key server.state was asked for, or null). Run "never" with a short deadline in tests; the real one is GATE_DEADLINE_MS.',
    'labHeaderExtras: checkItemHeader (ItemHeader.check) of headerJson must succeed and its extras must equal expect: x-cap when it is seen, clean, excerpt or test; x-orig when it passes the web URL rule (the trimmed value; receivers do not apply the sender\'s 1,024-character limit); both from part 0 only; every other x- field dropped.',
    'labRowText: describeLabRow(row, now, ctx) (LabRowText) must equal expect.label, sentence, action (null, "retry-now" or "try-again"), stepLine (null for v1.1 rows) and final; expect.a11y is the row\'s accessibility label ("{label}. {sentence}"). ctx.hasCap is the list of tokens for which hasCap is true; ctx.state is {s, t}, a bare token or null; ctx.online false means offline.',
    'labText: strings is LAB_TEXT flattened to dotted ids (arrays joined with ","); every app shows exactly these. messages: needsMessage(state, {platform, feature, short, heading, message}) -> expect (null = no text of its own: the server module\'s text is used). checkedIn: checkedInText(ms, now). inboxHeader: the What\'s in Lab header line. features: the name and sentence of each Lab feature, in list order (the four server features last). serverRow: the server\'s state for the whole server -> heading (serverHeadingShort: the line under What\'s in Lab\'s server heading; needs-server is "Not set up"; an unknown state is error) and subtitle (serverRowSubtitle: the "Daylight server ›" row, "Optional · {short}" with that heading form). serverFeature: serverFeatureShort(state, headingState) -> a server feature row\'s own short state, or null when its state equals the heading\'s (unknown states count as error). serverSection (2.6, the Daylight server section): moved: serverMovedText(moved) fills {host} with discover()\'s new origin minus its scheme and any path, as text (the port stays); labInboxSeen: labInboxSeenText(lastSeen, now) with GET /v1/status\'s inbox.lastSeen (an ISO time read by rule D, or ms; anything else is the not-yet line); aiToday: aiTodayText(used, cap), where an amount is n × 100 in double precision rounded half up to cents (so 1.005 is "1" and 0.015 is "0.02"; never printf or toFixed), ".00" left out, and anything but a finite number above 0 is "0".',
    'v1Safety: each labFrames frame as a v1.0 or v1.1 ack reader sees it: it opens as an ack whose ids are [], so it acks nothing and no row changes. Kotlin\'s AckHeader.idsOf and Swift\'s AckHeader.ids(in:) must return [] for each.',
    'W1 (L1; LAB-PROTOCOL 2.9). normalise.json holds smart intake (F16). labText also has: kindLines (inboxKindLine: the line under an Inbox row, F03), cleanedFrom (cleanedFromText(orig): "Cleaned from {host}" or null), use (labUseOn(settings, feature): Lab on and the feature\'s Use switch not off; a missing key is on) and useFeatures (the features with a Use switch, their footers and the switch\'s accessibility label).',
    'labExcerpt (F11): items: excerptItem(input) -> the item to send ({kind, mime, name, url?, title, content, extras}) or null; sanitize: sanitizeExcerptHtml(html, maxChars) -> {html, trimmed}; textHtml: excerptTextHtml(text, maxChars); fragments: textFragment(url, text) (null for a URL that fails the web URL rule); dates: excerptDate(date) ("" when the date is not a valid YYYY-MM-DD); fileNames: excerptFileName(text, {note}); classify: classifyShare(input) -> {kind, url, text} (6.5 Q1 = b: rules 1-3 only); limits: the input text is textRepeat repeated `times` times, then trimmed; excerptItem (text alone, and with html "<p>" + text + "</p>") and excerptMarkdown must give a content of `length` UTF-16 units with that SHA-256 (of its UTF-8) and that ending.',
    'diagnostics (F26): redact: redactDiagnostics(text) -> expect; activity: activityEvent(input) -> event, activityLine(event) -> line; reports: diagnosticsReport(input) -> expect (input.now is the clock for the check-in\'s relative time).',
    'testArticle (F26): testArticle({id, device}) -> the item to send ({id, kind, url, title, content, extras}).',
  ],
  constants, labTopics, labFrames, labParse, labLedger, labGate, labHeaderExtras, labRowText, labText, v1Safety,
  labExcerpt: w1.labExcerpt, diagnostics: w1.diagnostics, testArticle: w1.testArticle,
};
writeFileSync(new URL('./lab-vectors.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
writeFileSync(new URL('./normalise.json', import.meta.url), JSON.stringify(w1.normalise, null, 2) + '\n');
console.log(`wrote lab-vectors.json: ${labFrames.length} labFrames, ${labParse.length} labParse, ${labLedger.length} labLedger, `
  + `${labGate.length} labGate, ${labHeaderExtras.length} labHeaderExtras, ${labRowText.length} labRowText, `
  + `${Object.keys(labText.strings).length} strings and ${messages.length} messages, ${v1Safety.length} v1Safety, `
  + `${w1.labExcerpt.items.length} excerpt items, ${w1.labExcerpt.sanitize.length} sanitize, ${w1.labExcerpt.classify.length} classify, `
  + `${w1.diagnostics.redact.length} redact`);
console.log(`wrote normalise.json: ${w1.normalise.cases.length} cases, ${w1.normalise.xOrigFrames.length} xOrigFrames, ${w1.normalise.appleNews.length} appleNews`);
