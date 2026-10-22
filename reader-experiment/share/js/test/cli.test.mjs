// The command line, daylight-send (LAB-PLAN F09): the one-file build that CI publishes, run as a process against the
// mock relay. Exit codes, --json, --wait and --wait-for, files, smart intake, tick() on every run, the pairing file,
// and two runs at once losing no rows (the lock file and atomic renames of cli-store.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, mkdirSync, truncateSync, utimesSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ds from '../daylight-share.js';
import * as lab from '../daylight-lab.js';
import { startMockRelay } from '../mock-relay.mjs';
import { buildCli } from '../bin/build.mjs';
import { FileStorage, FileLock } from '../bin/cli-store.mjs';

const ROOT = mkdtempSync(path.join(tmpdir(), 'dls-cli-'));
const BIN = buildCli(path.join(ROOT, 'bin', 'daylight-send.mjs'));
const SOURCE = fileURLToPath(new URL('../bin/daylight-send.mjs', import.meta.url));
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));
let dirs = 0;

function run(args, { dir, env = {}, bin = BIN, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [bin, ...args], {
      env: { ...process.env, DAYLIGHT_SEND_DIR: dir, DAYLIGHT_SEND_POLL_MS: '100', DAYLIGHT_FROM: 'Test Mac', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timed out: ${args.join(' ')}\n${stderr}`)); }, timeout);
    child.on('close', (code) => {
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(stdout.trim().split('\n').at(-1)); } catch { json = null; }
      resolve({ code, stdout, stderr, json, ms: Date.now() - started, ended: Date.now() });
    });
  });
}

/** A mock relay, a pairing and an empty DAYLIGHT_SEND_DIR. */
async function setup(relayOpts = {}) {
  const relay = await startMockRelay(relayOpts);
  const secret = ds.generateSecret();
  const pairing = { secret, relay: relay.url, name: 'Test Daylight' };
  const link = await ds.pairingLink(pairing);
  const keys = await ds.deriveKeys(secret);
  const dir = path.join(ROOT, `home-${++dirs}`);
  mkdirSync(dir, { recursive: true });
  const env = { DAYLIGHT_PAIRING: link };
  const inbox = async () => {
    const out = [];
    for (const m of relay.state.topics.get(keys.inboxTopic) ?? []) {
      const body = m.attachment ? relay.state.files.get(m.id)?.bytes : ds.fromBase64(m.message);
      out.push((await ds.decryptFrame(keys, 'inbox', new Uint8Array(body))).header);
    }
    return out;
  };
  const outbox = async () => {
    const sub = readdirSync(dir).find((n) => n.startsWith('outbox-'));
    return sub ? ((await new FileStorage(path.join(dir, sub)).get('outbox')) ?? []) : [];
  };
  const receiver = () => new ds.Receiver({ pairing, storage: new ds.MemoryStorage(), accept: async () => {} });
  return { relay, pairing, link, keys, dir, env, inbox, outbox, receiver, close: () => relay.close() };
}

/** Polls a receiver (or a LabInboxSim) every 100 ms until stopped. */
function polling(r) {
  let on = true;
  const done = (async () => { while (on) { try { await r.pollOnce(); } catch { /* relay going away */ } await ds.sleep(100); } })();
  return async () => { on = false; await done; };
}

const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (!(await fn())) { if (Date.now() > end) throw new Error('condition not met'); await ds.sleep(20); }
};

test('F09.4: daylight-send <url> --json prints {"id","status":"sent",…} and exits 0', async () => {
  const s = await setup();
  try {
    const r = await run(['https://example.com', '--json'], { dir: s.dir, env: s.env });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.json.id, /^[0-9a-f]{32}$/);
    assert.equal(r.json.status, 'sent');
    assert.equal(r.json.label, 'Sent · waiting for your Daylight');
    const [h] = await s.inbox();
    assert.equal(h.id, r.json.id);
    assert.equal(h.url, 'https://example.com');
    assert.equal(h.from, 'Test Mac');
    assert.equal(h.app, 'cli/1.0.0');
    assert.ok(!Object.keys(h).some((k) => k.startsWith('x-')), 'a clean URL carries no x-orig');
    const human = await run(['https://example.com/two'], { dir: s.dir, env: s.env });
    assert.equal(human.code, 0);
    assert.match(human.stdout, /^Sent · waiting for your Daylight\nSent ✓ · On your Daylight … · In the Reader\nid [0-9a-f]{32}\n$/);
  } finally { await s.close(); }
});

test('F09.4: --wait exits 0 once delivered and 2 on timeout', async () => {
  const s = await setup();
  try {
    const stop = polling(s.receiver());
    const r = await run(['https://example.com/delivered', '--json', '--wait=20'], { dir: s.dir, env: s.env });
    await stop();
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.status, 'delivered');
    assert.equal(r.json.label, 'Delivered ✓', 'a v1.1 Inbox reads as today');
    const t = await run(['https://example.com/nobody', '--json', '--wait=1'], { dir: s.dir, env: s.env });
    assert.equal(t.code, 2);
    assert.equal(t.json.status, 'sent');
    assert.match(t.stderr, new RegExp(`Stopped waiting after 1 s\\. Run daylight-send status ${t.json.id} to check again\\.`));
  } finally { await s.close(); }
});

test('--wait-for reader: 0 once a Lab Daylight reports reader (a link) or handed (a document)', async () => {
  const s = await setup();
  try {
    const labInbox = new lab.LabInbox({
      storage: new ds.MemoryStorage(), relay: new ds.RelayClient({ relay: s.relay.url }), keys: s.keys, from: 'Test Daylight',
      info: { lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'] }, autoFlushMs: null, now: (() => { let t = Date.now(); return () => (t += 31000); })(),
    });
    const sim = new lab.LabInboxSim({ receiver: s.receiver(), labInbox });
    const link = run(['https://example.com/read-me', '--json', '--wait-for', 'reader', '--wait=20'], { dir: s.dir, env: s.env });
    await until(async () => (await s.inbox()).length === 1);
    await sim.pollOnce();
    const r = await link;
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.state, 'reader');
    assert.equal(r.json.label, 'In your Reader ✓');
    const pdf = path.join(s.dir, 'paper.pdf');
    writeFileSync(pdf, '%PDF-1.4\n% a small test document\n');
    const doc = run([pdf, '--json', '--wait-for=reader', '--wait=20'], { dir: s.dir, env: s.env });
    await until(async () => (await s.inbox()).length === 2);
    await sim.pollOnce();
    const d = await doc;
    assert.equal(d.code, 0, d.stderr);
    assert.equal(d.json.state, 'handed');
    assert.equal(d.json.label, 'Handed to the Reader');
    // status shows the Lab state too
    const st = await run(['status', d.json.id.slice(0, 8)], { dir: s.dir, env: s.env });
    assert.equal(st.code, 0);
    assert.match(st.stdout, /^paper\.pdf\nHanded to the Reader\nYour Daylight passed it to the Reader\. The Reader doesn’t confirm documents yet\.\nSent ✓ · On your Daylight ✓ · Handed to the Reader\nid /);
  } finally { await s.close(); }
});

test('smart intake: tracking removed, x-orig sent, --title kept (F16)', async () => {
  const s = await setup();
  try {
    const r = await run(['https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa%3Futm_source%3Dx%26id%3D1', '--title', 'A title', '--json'], { dir: s.dir, env: s.env });
    assert.equal(r.code, 0, r.stderr);
    const [h] = await s.inbox();
    assert.equal(h.url, 'https://example.com/a?id=1');
    assert.equal(h.title, 'A title');
    assert.equal(h['x-orig'], 'https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa%3Futm_source%3Dx%26id%3D1');
    // a text fragment does not make an excerpt (6.5 Q1 b): the link keeps its fragment and the title given
    const f = await run(['https://example.com/a#:~:text=hello', '--title', 'My title', '--json'], { dir: s.dir, env: s.env });
    assert.equal(f.code, 0, f.stderr);
    const [, hf] = await s.inbox();
    assert.deepEqual([hf.kind, hf.url, hf.title], ['url', 'https://example.com/a#:~:text=hello', 'My title']);
    assert.ok(!('x-cap' in hf) && !('x-orig' in hf));
  } finally { await s.close(); }
});

test('files: sent with their type; empty, unreadable and missing files fail with a sentence; too big exits 3 (F09.5)', async () => {
  const s = await setup();
  try {
    const epub = path.join(s.dir, 'Book One.epub');
    writeFileSync(epub, Buffer.from('PK\u0003\u0004 not really a book'));
    const ok = await run([epub, '--title', 'Book One', '--json'], { dir: s.dir, env: s.env });
    assert.equal(ok.code, 0, ok.stderr);
    const [h] = await s.inbox();
    assert.deepEqual([h.kind, h.name, h.mime, h.title], ['file', 'Book One.epub', 'application/epub+zip', 'Book One']);

    const empty = path.join(s.dir, 'empty.pdf');
    writeFileSync(empty, '');
    const e = await run([empty], { dir: s.dir, env: s.env });
    assert.equal(e.code, 1);
    assert.equal(e.stderr.trim(), 'This file is empty, so nothing was sent.');
    const ej = await run([empty, '--json'], { dir: s.dir, env: s.env });
    assert.deepEqual(ej.json, { id: null, status: 'error', error: 'empty', label: 'This file is empty, so nothing was sent.' });
    const folder = await run([s.dir], { dir: s.dir, env: s.env });
    assert.equal(folder.code, 1);
    assert.equal(folder.stderr.trim(), 'Couldn’t read this file, so nothing was sent.');
    const missing = await run(['no-such-file.pdf'], { dir: s.dir, env: s.env });
    assert.equal(missing.code, 1);
    assert.equal(missing.stderr.trim(), 'That isn’t a web address or a file.');
    const big = path.join(s.dir, 'big.pdf');
    writeFileSync(big, '');
    truncateSync(big, 14_000_000);
    const b = await run([big], { dir: s.dir, env: s.env });
    assert.equal(b.code, 3);
    assert.equal(b.stderr.trim(), 'Too big to send. Files can be up to 9 MB; this one is 14 MB.');
    assert.equal((await s.inbox()).length, 1, 'nothing else was published');
    assert.equal((await s.outbox()).length, 1, 'and nothing else was stored');
  } finally { await s.close(); }
});

test('a relay that refuses the item exits 3 with the v1.1 sentence; other failures exit 1', async () => {
  let fail = 0;
  const s = await setup({ failPublish: () => (fail ? fail : null) });
  try {
    fail = 400;
    const refused = 'The relay set on your Daylight turned this down. It will try again in about 3 hours.';
    const r = await run(['https://example.com/refused', '--json'], { dir: s.dir, env: s.env });
    assert.equal(r.code, 3);
    assert.equal(r.json.status, 'failed');
    assert.equal(r.json.label, 'Waiting to send');
    assert.equal(r.json.sentence, refused);
    assert.equal(r.stderr.trim(), refused);
    // without --json too: the sentence on stderr (F09, SEND-API.md), the label and id on stdout
    const rh = await run(['https://example.com/refused-too'], { dir: s.dir, env: s.env });
    assert.equal(rh.code, 3);
    assert.equal(rh.stderr.trim(), refused);
    assert.match(rh.stdout, /^Waiting to send\n(?:.*\n)?id [0-9a-f]{32}\n$/);
    assert.ok(!rh.stdout.includes('turned this down'));
    fail = 413;
    const f = await run(['https://example.com/full'], { dir: s.dir, env: s.env });
    assert.equal(f.code, 1);
    assert.match(f.stderr, /^A lot has been sent from this network/);
    assert.match(f.stdout, /^Waiting to send\n(?:.*\n)?id [0-9a-f]{32}\n$/);
    const fj = await run(['https://example.com/full-json', '--json'], { dir: s.dir, env: s.env });
    assert.equal(fj.code, 1);
    assert.equal(fj.stderr.trim(), fj.json.sentence);
    assert.match(fj.json.sentence, /^A lot has been sent from this network/);
  } finally { await s.close(); }
});

test('every run does tick() first: status sees acks, tick re-sends what is due', async () => {
  let fail = 400;
  const s = await setup({ failPublish: () => fail || null });
  try {
    const r = await run(['https://example.com/later', '--json'], { dir: s.dir, env: s.env });
    assert.equal(r.code, 3);
    fail = 0;
    // make the refused row due (refused rows wait 185 minutes)
    const sub = readdirSync(s.dir).find((n) => n.startsWith('outbox-'));
    const store = new FileStorage(path.join(s.dir, sub));
    const rows = await store.get('outbox');
    rows[0].lastPublish -= 4 * 3600e3;
    await store.set('outbox', rows);
    const t = await run(['tick', '--json'], { dir: s.dir, env: s.env });
    assert.equal(t.code, 0, t.stderr);
    assert.deepEqual(t.json, { delivered: 0, resent: 1 });
    assert.equal((await s.inbox()).length, 1);
    assert.equal((await s.outbox())[0].status, 'sent');
    await s.receiver().pollOnce(); // the Daylight acks
    const st = await run(['status', r.json.id, '--json'], { dir: s.dir, env: s.env });
    assert.equal(st.code, 0, st.stderr);
    assert.equal(st.json.status, 'delivered', 'status ran tick() first, so it saw the ack');
    const human = await run(['tick'], { dir: s.dir, env: s.env });
    assert.equal(human.stdout.trim(), '0 delivered, 0 sent again.');
    const newest = await run(['status', '--json'], { dir: s.dir, env: s.env });
    assert.equal(newest.json.id, r.json.id);
    const none = await run(['status', 'ffffffff'], { dir: s.dir, env: s.env });
    assert.equal(none.code, 1);
    assert.equal(none.stderr.trim(), 'Nothing with the id ffffffff in this outbox.');
  } finally { await s.close(); }
});

test('two runs at once lose no rows: concurrent sends, one of them waiting, then status (F09)', async () => {
  const s = await setup();
  try {
    for (let round = 0; round < 3; round++) {
      const stop = polling(s.receiver());
      const waiting = run([`https://example.com/wait-${round}`, '--json', '--wait=30'], { dir: s.dir, env: s.env });
      const sends = Array.from({ length: 7 }, (_, i) => run([`https://example.com/r${round}-${i}`, '--json'], { dir: s.dir, env: s.env }));
      // status starts once this round's first row is stored (in round 0 an empty outbox would rightly exit 1), while
      // the waiting run and most sends are still going
      const status = until(async () => (await s.outbox()).length > 8 * round, 30000)
        .then(() => run(['status', '--json'], { dir: s.dir, env: s.env }));
      const results = await Promise.all([waiting, ...sends, status]);
      await stop();
      for (const r of results) assert.equal(r.code, 0, r.stderr);
      assert.equal(results[0].json.status, 'delivered');
      const rows = await s.outbox();
      assert.equal(rows.length, 8 * (round + 1), `round ${round}: every row kept`);
      assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
      for (const r of results.slice(0, 8)) assert.ok(rows.some((row) => row.id === r.json.id));
      assert.equal((await s.inbox()).length, 8 * (round + 1), 'each item published once');
    }
    const leftovers = readdirSync(s.dir, { recursive: true }).filter((n) => /\.tmp$|lock/.test(String(n)));
    assert.deepEqual(leftovers, [], 'no temporary files and no lock left behind');
  } finally { await s.close(); }
});

test('the lock: a stale lock is taken over; a live one is waited for', async () => {
  const s = await setup();
  try {
    const lockFile = path.join(s.dir, 'lock');
    writeFileSync(lockFile, '999999:dead');
    const old = new Date(Date.now() - 120000);
    utimesSync(lockFile, old, old);
    const r = await run(['https://example.com/stale', '--json'], { dir: s.dir, env: s.env });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(lockFile));

    writeFileSync(lockFile, '999998:alive');
    const beat = setInterval(() => { const n = new Date(); try { utimesSync(lockFile, n, n); } catch { /* removed */ } }, 200);
    const waiting = run(['https://example.com/waits', '--json'], { dir: s.dir, env: s.env });
    await ds.sleep(1500);
    clearInterval(beat);
    const released = Date.now();
    rmSync(lockFile);
    const w = await waiting;
    assert.equal(w.code, 0, w.stderr);
    assert.ok(w.ended >= released, 'it waited for the live lock');
  } finally { await s.close(); }
});

test('FileLock and FileStorage in one process: turns are taken, writes are whole', async () => {
  const dir = path.join(ROOT, 'unit');
  const a = new FileLock(path.join(dir, 'lock'), { pollMs: 5 });
  const b = new FileLock(path.join(dir, 'lock'), { pollMs: 5 });
  const store = new FileStorage(path.join(dir, 'store'));
  await store.set('n', 0);
  const bump = (lock) => lock.run(async () => { const n = await store.get('n'); await ds.sleep(2); await store.set('n', n + 1); });
  await Promise.all(Array.from({ length: 20 }, (_, i) => bump(i % 2 ? a : b)));
  assert.equal(await store.get('n'), 20);
  await store.set('outbox/abc', { x: 1 });
  assert.deepEqual((await store.keys()).sort(), ['n', 'outbox/abc']);
  await store.remove('outbox/abc');
  assert.equal(await store.get('outbox/abc'), undefined);
  assert.equal(statSync(path.join(dir, 'store', 'n.json')).mode & 0o777, 0o600);
  writeFileSync(path.join(dir, 'store', 'bad.json'), '{not json');
  assert.equal(await store.get('bad'), undefined);
});

test('pairing: from the pairing file (daylight-send pair), and a clear sentence without one', async () => {
  const s = await setup();
  try {
    const none = await run(['https://example.com/x'], { dir: s.dir, env: { DAYLIGHT_PAIRING: '' } });
    assert.equal(none.code, 1);
    assert.equal(none.stderr.trim(), 'Not paired yet. Run daylight-send pair with the code Daylight Share shows on your Daylight, or set DAYLIGHT_PAIRING.');
    const bad = await run(['pair', 'ABCD-EFGH'], { dir: s.dir, env: { DAYLIGHT_PAIRING: '' } });
    assert.equal(bad.code, 1);
    assert.equal(bad.stderr.trim(), 'A pairing code has 28 letters and digits (7 groups of 4).');
    const p = await run(['pair', s.link], { dir: s.dir, env: { DAYLIGHT_PAIRING: '' } });
    assert.equal(p.code, 0, p.stderr);
    assert.match(p.stdout, /^Paired with Test Daylight\. Items go through 127\.0\.0\.1:\d+\.\n$/);
    assert.equal(statSync(path.join(s.dir, 'pairing')).mode & 0o777, 0o600);
    const r = await run(['https://example.com/x', '--json'], { dir: s.dir, env: { DAYLIGHT_PAIRING: '' } });
    assert.equal(r.code, 0, r.stderr);
    const flag = await run(['https://example.com/y', '--json', '--pairing', s.link], { dir: s.dir, env: { DAYLIGHT_PAIRING: '' } });
    assert.equal(flag.code, 0, flag.stderr);
    assert.equal((await s.inbox()).length, 2);
  } finally { await s.close(); }
});

test('usage: help, version, unknown options', async () => {
  const dir = path.join(ROOT, 'usage');
  const h = await run(['--help'], { dir });
  assert.equal(h.code, 0);
  assert.match(h.stdout, /^daylight-send 1\.0\.0: send links and files to your Daylight/);
  assert.match(h.stdout, /\*\/15 \* \* \* \* daylight-send tick/);
  const v = await run(['--version'], { dir });
  assert.equal(v.stdout.trim(), 'daylight-send 1.0.0 (Daylight Share protocol 1, Lab 1)');
  const u = await run(['--nope', 'https://example.com'], { dir });
  assert.equal(u.code, 1);
  assert.match(u.stderr, /^Unknown option --nope\./);
  const w = await run(['https://example.com', '--wait-for', 'soon'], { dir });
  assert.equal(w.code, 1);
  const n = await run([], { dir });
  assert.equal(n.code, 1);
});

test('the built file is one module with no relative imports, and the source runs the same', async () => {
  const text = readFileSync(BIN, 'utf8');
  assert.ok(text.startsWith('#!/usr/bin/env node\n'));
  assert.ok(!/^import .* from '\./m.test(text), 'no relative imports');
  for (const m of text.matchAll(/^import .* from '([^']+)';$/gm)) assert.match(m[1], /^node:/);
  assert.equal(statSync(BIN).mode & 0o111, 0o111, 'executable');
  const s = await setup();
  try {
    const r = await run(['https://example.com/source', '--json'], { dir: s.dir, env: s.env, bin: SOURCE });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.status, 'sent');
  } finally { await s.close(); }
});
