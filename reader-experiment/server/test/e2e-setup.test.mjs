// The one-step first deploy, rehearsed end to end in workerd (DESIGN.md 3.5, 12.4): the deploy's plan and setup row
// (scripts/setup.mjs) on the Worker's own D1, the post-deploy smoke test and summary (scripts/derive.mjs), an app
// giving the new server its Server code with the setup link, a second device and the Lab Inbox finding it through the
// config frame on the mock relay, a server-made item (an AI summary sent to the Daylight) reaching the Lab Inbox's
// server lane through the relay, its ack, the Inbox's presence, the next deploy, and a re-pairing's new link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import * as ds from '../../share/js/daylight-share.js';
import * as srv from '../client/daylight-server.js';
import { buildInboxInfo } from '../../share/js/daylight-lab.js';
import { setup, RELAY_ORIGIN, ROOT } from './helpers.mjs';
import { planSetup, writeSetup, cfD1 } from '../scripts/setup.mjs';
import { smoke, announce } from '../scripts/derive.mjs';

const WORKER = 'daylight-0123456789ab';
const ORIGIN = `https://${WORKER}.example.workers.dev`;
const MIN = 60_000;

/** Deterministic "random" bytes: the Worker name 0123456789ab, then a fixed secret. */
const fixedRandom = (...seq) => (n) => {
  const next = seq.shift();
  if (!next || next.length !== n) throw new Error(`random(${n}) not scripted`);
  return next;
};
const SECRET = ds.fromHex('00112233445566778899aabbccddeeff');
const WORKER_BYTES = ds.fromHex('0123456789ab');

/** The D1 binding as the deploy's query function (setup.mjs talks to the same SQL over Cloudflare's REST API). */
const d1Query = (t) => async (sql, params = []) => (await t.db.prepare(sql).bind(...params).all()).results;

/** Runs fn with console.log captured (the scripts print ::add-mask:: lines). -> {result, logs} */
async function captured(fn) {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try { return { result: await fn(), logs }; } finally { console.log = orig; }
}

/** Every line that is not a mask command: what a public Actions log or summary would show. */
const visible = (logs) => logs.filter((l) => !l.startsWith('::add-mask::')).join('\n');

test('first deploy with only the Cloudflare secrets: setup link, smoke test, an app sets it up, the item path, the next deploy, re-pairing', async () => {
  const t = await setup({ serverUrl: ORIGIN, vars: { DAYLIGHT_SERVER_CODE: undefined } });
  try {
    const query = d1Query(t);
    // 1. The deploy: plan (no row: first), the setup row once the address is known, then the Worker with the token.
    const plan = await planSetup({ query, random: fixedRandom(WORKER_BYTES, SECRET) });
    assert.deepEqual({ state: plan.state, worker: plan.worker, rotate: plan.rotate, reason: plan.reason }, { state: 'pending', worker: WORKER, rotate: true, reason: 'first' });
    const written = await writeSetup({ query, plan, origin: ORIGIN, now: 1 });
    assert.equal(written.state, 'pending');
    const link = written.link;
    assert.equal(link, await srv.formatSetupLink(ORIGIN, SECRET));
    assert.deepEqual(await query('SELECT worker, link, code FROM setup'), [{ worker: WORKER, link, code: null }]);
    const again = await planSetup({ query, random: () => { throw new Error('no new link'); } });
    assert.deepEqual({ state: again.state, worker: again.worker, rotate: again.rotate }, { state: 'pending', worker: WORKER, rotate: false }, 'a re-run keeps the waiting link');
    assert.equal(ds.toHex(again.secret), ds.toHex(SECRET));
    const setupToken = await srv.deriveSetupToken(SECRET);
    await t.restart({ DAYLIGHT_SETUP_TOKEN: setupToken });

    // 2. The post-deploy smoke test and summary, before setup.
    const s0 = await smoke(ORIGIN, { fetchFn: t.nodeFetch, sleep: async () => {}, tries: 1, serverKnown: false });
    assert.ok(s0.ok, JSON.stringify(s0.checks));
    assert.deepEqual(Object.fromEntries(s0.checks.map((c) => [c.name, c.detail])),
      { hello: '200', CORS: '204', 'no token refused': '503', 'wrong token refused': '503', 'wrong setup token refused': '401' });
    const pre = await captured(() => announce(ORIGIN, { env: { R2: 'on', SETUP: 'pending', SETUP_REASON: 'first' }, fetchFn: t.nodeFetch, sleep: async () => {}, tries: 1 }));
    assert.equal(pre.result.ok, true);
    const md = pre.result.lines.join('\n');
    assert.match(md, /^### Daylight server is live: one step left$/m);
    assert.match(md, /SELECT link FROM setup;/);
    assert.match(md, /npx wrangler d1 execute daylight-server --remote --command "SELECT link FROM setup"/);
    assert.match(md, /Lab settings › Daylight server › \*\*Set up with a link\*\*/);
    assert.match(md, /DAYLIGHT_SERVER_CODE/, 'the fallback for apps without the button');
    const secretForms = [link, link.split('#')[1], setupToken, ds.toHex(SECRET), WORKER, ORIGIN];
    for (const x of secretForms) {
      assert.ok(!md.includes(x), 'the summary never shows the link, its token or the address');
      assert.ok(!visible(pre.logs).includes(x), 'nor does the log');
    }
    assert.ok(pre.logs.includes(`::add-mask::${ORIGIN}`) || pre.logs.includes(`::add-mask::${new URL(ORIGIN).hostname}`));
    const page = await t.dispatch(`${ORIGIN}/setup`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Set up with a link/);

    // 3. Before setup the apps say needs-server; a wrong paste is explained; the link sets the server up.
    const phone = t.client;
    assert.equal((await phone.state('ai')).state, 'needs-server');
    await assert.rejects(phone.setup(t.serverCode), (e) => e.code === 'BAD_REQUEST' && e.reason === 'server-code' && /That is the Server code/.test(e.message));
    await assert.rejects(phone.setup(await srv.formatSetupLink(ORIGIN, ds.fromHex('ff'.repeat(16)))), (e) => e.code === 'SETUP_INVALID' && /isn’t current/.test(e.message));
    const done = await phone.setup(link);
    assert.deepEqual(done, { server: ORIGIN, fingerprint: t.values.fingerprint, delivery: 'lab' });
    assert.deepEqual(await query('SELECT worker, link, code FROM setup'), [{ worker: WORKER, link: null, code: t.serverCode }], 'the link is used up');
    assert.deepEqual(await phone.storage.get('server/pin'), { origin: ORIGIN, fingerprint: t.values.fingerprint });
    assert.ok(t.relay.messages(t.values.configTopic).length >= 1, 'the Worker announced itself at once');
    assert.equal((await phone.setup(link)).server, ORIGIN, 'the same app again (a retry) is fine');
    const strangerSecret = ds.generateSecret();
    const stranger = new srv.DaylightServer({ pairing: { secret: strangerSecret, relay: RELAY_ORIGIN }, storage: new ds.MemoryStorage(), fetch: t.nodeFetch });
    await assert.rejects(stranger.setup(link), (e) => e.code === 'SETUP_USED' && e.status === 409 && /already used/.test(e.message));

    // 4. Another device with the same pairing finds the server through the config frame on the relay.
    const mac = new srv.DaylightServer({ pairing: t.pairing, storage: new ds.MemoryStorage(), fetch: t.nodeFetch, from: 'Mac', app: 'test/2' });
    const found = await mac.discover();
    assert.equal(found.source, 'relay');
    assert.equal(found.config.server, ORIGIN);
    const st = await mac.status({ force: true });
    assert.equal(st.fingerprint, t.values.fingerprint);
    assert.equal(st.inbox.lab, false);
    assert.deepEqual(await mac.state('ai'), { state: 'ready', message: null });
    assert.equal((await mac.state('deliver')).state, 'needs-lab-inbox');

    // 5. The Lab Inbox's server lane says hello (x-inbox as buildInboxInfo makes it); the Cron records the presence.
    const T = Date.now();
    const hello = await srv.sealBox(t.values, 'ack', { v: 1, kind: 'ack', ids: [], sent: new Date(T).toISOString(), 'x-inbox': buildInboxInfo({ lab: 1, app: 'android/1.6.0', caps: ['st'], live: true }) });
    await t.relay.handle(`${RELAY_ORIGIN}/${t.values.ackTopic}`, { method: 'POST', body: ds.toBase64(hello) });
    await t.cron(T);
    assert.equal((await mac.status({ force: true })).inbox.lab, true);
    assert.deepEqual(await mac.state('deliver'), { state: 'ready', message: null });

    // 6. A server-made item: an AI summary sent to the Daylight goes out on the server item topic, the lane reassembles
    //    it, acks it, and the next poll of the ack topic marks it delivered.
    const out = await mac.ai.summarize({ text: 'The tide went out at noon and the gulls slept.', title: 'Tides' }, { deliver: 'daylight' });
    assert.equal(out.result.title, 'A Mock Title');
    assert.match(out.delivered.id, /^[0-9a-f]{32}$/);
    await t.cron(T + MIN);
    const items = await t.lane.poll();
    assert.equal(items.length, 1);
    assert.equal(items[0].header.id, out.delivered.id);
    assert.equal(items[0].header.from, 'Claude');
    assert.equal(items[0].raw['x-origin'], 'ai');
    assert.match(new TextDecoder().decode(items[0].content), /Summary by Claude/);
    const r = await t.cron(T + 31 * MIN);
    assert.equal(r.steps.acks, '1');
    assert.deepEqual(await t.rows('SELECT state FROM outbox WHERE id = ?', out.delivered.id), [{ state: 'delivered' }]);
    assert.equal((await mac.status({ force: true })).inbox.lab, true);

    // 7. The next deploy: the plan reads the code the app sent; the token is deleted from the Worker; the checks, the
    //    announce from GitHub and the summary run as with the secret.
    const next = await planSetup({ query, random: () => { throw new Error('no new link'); } });
    assert.deepEqual({ state: next.state, worker: next.worker, code: next.code, fingerprint: next.fingerprint }, { state: 'claimed', worker: WORKER, code: t.serverCode, fingerprint: t.values.fingerprint });
    await t.restart({ DAYLIGHT_SETUP_TOKEN: undefined });
    await t.db.prepare("DELETE FROM settings WHERE k = 'announceAt'").run();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-'));
    fs.writeFileSync(path.join(dir, 'dls-server-code'), next.code, { mode: 0o600 });
    const live = await captured(() => announce(ORIGIN, { env: { RUNNER_TEMP: dir, SETUP: 'claimed', R2: 'on' }, fetchFn: t.nodeFetch, sleep: async () => {}, tries: 1 }));
    assert.equal(live.result.ok, true, live.result.lines.join('\n'));
    const liveMd = live.result.lines.join('\n');
    assert.match(liveMd, /^### Daylight server is live$/m);
    assert.match(liveMd, new RegExp(`Server code fingerprint ${srv.showFingerprint(t.values.fingerprint)}`));
    assert.match(liveMd, /no token refused ok · wrong token refused ok · wrong setup token refused ok\. Token accepted: yes/);
    assert.match(liveMd, /Lab Inbox: heard from/);
    assert.match(liveMd, /Relay from the Worker: 200, listed/);
    for (const x of [t.serverCode, t.values.authToken, t.values.configTopic, WORKER, ORIGIN]) {
      assert.ok(!liveMd.includes(x) && !visible(live.logs).includes(x), 'nothing secret in the summary or the log');
    }
    assert.equal((await t.dispatch(`${ORIGIN}/v1/setup`, { method: 'POST', headers: { Authorization: `Bearer ${setupToken}`, 'Content-Type': 'application/json', 'Content-Length': '2' }, body: '{}' })).status, 404, 'no link waits any more');

    // 8. Re-pairing: the app locks the old server; the next deploy makes a new Worker name and a new link.
    assert.equal(await phone.lockBeforeRepair(), true);
    const after = await planSetup({ query, random: fixedRandom(ds.fromHex('ba9876543210'), ds.fromHex('ff'.repeat(16))) });
    assert.deepEqual({ state: after.state, worker: after.worker, rotate: after.rotate, reason: after.reason }, { state: 'pending', worker: 'daylight-ba9876543210', rotate: true, reason: 'locked' });
    const rotated = await writeSetup({ query, plan: after, origin: 'https://daylight-ba9876543210.example.workers.dev', now: 2 });
    assert.equal(rotated.state, 'pending');
    assert.deepEqual(await query('SELECT worker, code FROM setup'), [{ worker: 'daylight-ba9876543210', code: null }]);
    const asked = await planSetup({ query, newLink: true, random: fixedRandom(ds.fromHex('aaaaaaaaaaaa'), ds.fromHex('ee'.repeat(16))) });
    assert.equal(asked.reason, 'requested');
  } finally { await t.close(); }
});

test('POST /v1/setup: only with a waiting link for this Worker, the right token and a Server code; rate-limited; no body read before the token', async () => {
  const t = await setup({ serverUrl: ORIGIN, vars: { DAYLIGHT_SERVER_CODE: undefined } });
  try {
    const query = d1Query(t);
    const post = (token, body, headers = {}) => t.dispatch(`${ORIGIN}/v1/setup`, {
      method: 'POST', body, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), ...headers },
    });
    const token = await srv.deriveSetupToken(SECRET);
    const code = JSON.stringify({ code: t.serverCode });
    assert.equal((await post(token, code)).status, 404, 'no DAYLIGHT_SETUP_TOKEN: no setup waits');
    await t.restart({ DAYLIGHT_SETUP_TOKEN: token });
    assert.equal((await post(token, code)).status, 404, 'no setup row');
    await writeSetup({ query, plan: { worker: 'daylight-ffffffffffff', secret: SECRET, rotate: true }, origin: 'https://daylight-ffffffffffff.example.workers.dev' });
    assert.equal((await post(token, code)).status, 404, 'a row for another Worker: this one was replaced');
    await writeSetup({ query, plan: { worker: WORKER, secret: SECRET, rotate: true }, origin: ORIGIN });
    const big = await t.raw('POST', '/v1/setup', { token: 'f'.repeat(64), length: 5_000_000, headers: { 'Content-Type': 'application/json' } });
    assert.equal(big.status, 401, 'a wrong token is refused before the body is read');
    assert.ok(big.written < 5_000_000);
    const bad = await post(token, JSON.stringify({ code: t.pairingLink }));
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error.message, /That is your pairing code/);
    assert.equal((await post(token, JSON.stringify({ code: 'SERVER-ABCD' }))).status, 400);
    // A pairing locked on this server can't take the link (the re-pairing makes a new link instead).
    const lockedSecret = ds.generateSecret();
    const lockedValues = await srv.deriveServerValues(await srv.deriveServerSeed(lockedSecret));
    await t.db.prepare("INSERT INTO settings (k, v) VALUES ('lock', ?)").bind(JSON.stringify({ fingerprint: lockedValues.fingerprint, at: 1 })).run();
    const lockedCode = await srv.formatServerCode(await srv.deriveServerSeed(lockedSecret), { relay: RELAY_ORIGIN });
    assert.equal((await post(token, JSON.stringify({ code: lockedCode }))).status, 423);
    assert.deepEqual(await query('SELECT code FROM setup'), [{ code: null }]);
    const ok = await post(token, code);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.deepEqual({ ...body, published: undefined }, { server: ORIGIN, api: srv.SERVER_API, fingerprint: t.values.fingerprint, delivery: 'lab', published: undefined });
    assert.equal(body.published, 200);
    // Thirty wrong tokens a minute from one address, then 429 with no further work.
    let last;
    for (let i = 0; i < 31; i++) last = await post('e'.repeat(64), code, { 'CF-Connecting-IP': '203.0.113.9' });
    assert.equal(last.status, 429);
    // With the secret DAYLIGHT_SERVER_CODE the setup link is never used.
    await t.restart({ DAYLIGHT_SERVER_CODE: t.serverCode });
    assert.equal((await post(token, code)).status, 404);
  } finally { await t.close(); }
});

test('an earlier Worker the deploy failed to delete never adopts the new Server code from the shared D1 (3.5, 12.7)', async () => {
  const OLD = 'https://daylight-aaaaaaaaaaaa.example.workers.dev';
  const t = await setup({ serverUrl: OLD, vars: { DAYLIGHT_SERVER_CODE: undefined } });
  try {
    const query = d1Query(t);
    // The rotation made the Worker daylight-0123456789ab and its link, and an app used it: D1 holds this pairing's code.
    await writeSetup({ query, plan: { worker: WORKER, secret: SECRET, rotate: true }, origin: ORIGIN, now: 1 });
    await query('UPDATE setup SET code = ?1, claimed = 2, link = NULL WHERE id = 1', [t.serverCode]);
    const st = await t.api('GET', '/v1/status');
    assert.equal(st.status, 503, 'the old Worker stays unconfigured');
    assert.equal(st.json.error.code, 'NOT_CONFIGURED');
    await t.cron();
    assert.equal(t.relay.messages(t.values.configTopic).length, 0, 'and never announces its own address on the config topic');
    // The Worker the row names reads the code.
    await t.restart({ SERVER_URL: ORIGIN });
    const now = await t.api('GET', '/v1/status');
    assert.equal(now.status, 200);
    assert.equal(now.json.server, ORIGIN);
  } finally { await t.close(); }
});

test('the deploy’s D1 query function speaks Cloudflare’s REST shape and says nothing secret on failure', async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, init });
    if (seen.length === 1) return Response.json({ success: true, result: [{ results: [{ worker: WORKER }], success: true, meta: {} }] });
    return Response.json({ success: false, errors: [{ code: 7500, message: 'token tk_secret_value is bad' }] }, { status: 400 });
  };
  const q = cfD1({ account: 'a'.repeat(32), database: 'db-id', token: 'tk_secret_value', fetchFn });
  assert.deepEqual(await q('SELECT worker FROM setup WHERE id = ?1', [1]), [{ worker: WORKER }]);
  assert.equal(seen[0].url, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/d1/database/db-id/query`);
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer tk_secret_value');
  assert.deepEqual(JSON.parse(seen[0].init.body), { sql: 'SELECT worker FROM setup WHERE id = ?1', params: [1] });
  await assert.rejects(q('SELECT 1'), (e) => e.message === 'D1 query failed (HTTP 400)' && !e.message.includes('tk_secret'));
});

/** Runs a script as the workflow does (its own process, its own environment). -> {status, stdout} */
function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { PATH: process.env.PATH, ...env } });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stdout += d; });
    child.on('close', (status) => resolve({ status, stdout }));
  });
}

/**
 * A stand-in for Cloudflare's API: the workers.dev subdomain, D1 queries (run on the Worker's own D1) and whether a
 * Worker exists (`workers`, the names deployed; `workersDown` answers 500).
 */
async function fakeCloudflare(t, { account, token, workers = [] }) {
  const calls = [];
  const cf = { workers: new Set(workers), workersDown: false };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    calls.push(`${req.method} ${req.url}`);
    const send = (status, json) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
    if (req.headers.authorization !== `Bearer ${token}`) return send(403, { success: false, errors: [{ code: 10000 }] });
    if (req.method === 'GET' && req.url === `/client/v4/accounts/${account}/workers/subdomain`) return send(200, { success: true, result: { subdomain: 'anjan' } });
    const service = new RegExp(`^/client/v4/accounts/${account}/workers/services/([^/?]+)$`).exec(req.url ?? '');
    if (req.method === 'GET' && service) {
      if (cf.workersDown) return send(500, { success: false, errors: [{ code: 10013, message: 'An unknown error has occurred.' }] });
      const name = decodeURIComponent(service[1]);
      return cf.workers.has(name) ? send(200, { success: true, result: { id: name, default_environment: { environment: 'production' } } })
        : send(404, { success: false, errors: [{ code: 10007, message: 'This Worker does not exist on your account.' }] });
    }
    if (req.method === 'POST' && req.url === `/client/v4/accounts/${account}/d1/database/test-d1/query`) {
      const { sql, params } = JSON.parse(body);
      try {
        const r = await t.db.prepare(sql).bind(...(params ?? [])).all();
        return send(200, { success: true, result: [{ results: r.results, success: true, meta: {} }] });
      } catch (e) { return send(400, { success: false, errors: [{ code: 7500, message: String(e) }] }); }
    }
    return send(404, { success: false });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return Object.assign(cf, { api: `http://127.0.0.1:${server.address().port}/client/v4`, calls, close: () => new Promise((r) => server.close(r)) });
}

const readKv = (file) => Object.fromEntries(fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

test('the deploy steps as the workflow runs them: setup.mjs, secrets.mjs and derive.mjs announce, before and after setup', async () => {
  const t = await setup({ serverUrl: ORIGIN, vars: { DAYLIGHT_SERVER_CODE: undefined } });
  const account = 'a'.repeat(32), token = 'cf-test-token';
  const cf = await fakeCloudflare(t, { account, token });
  try {
    const job = () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-job-'));
      const f = { GITHUB_ENV: path.join(dir, 'env'), GITHUB_OUTPUT: path.join(dir, 'out'), GITHUB_STEP_SUMMARY: path.join(dir, 'summary') };
      for (const p of Object.values(f)) fs.writeFileSync(p, '');
      return { dir, ...f, base: { RUNNER_TEMP: dir, ...f } };
    };
    const cfEnv = { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, D1_ID: 'test-d1', DLS_TEST_CF_API: cf.api };

    // The first run: a new Worker name, the setup link in D1, the token in a 0600 file, nothing secret in the log.
    const j1 = job();
    const s1 = await run(['scripts/setup.mjs'], { ...j1.base, ...cfEnv, NEW_SETUP_LINK: 'false' });
    assert.equal(s1.status, 0, s1.stdout);
    const env1 = readKv(j1.GITHUB_ENV), out1 = readKv(j1.GITHUB_OUTPUT);
    assert.match(env1.WORKER_NAME, /^daylight-[0-9a-f]{12}$/);
    assert.equal(env1.SERVER_URL, `https://${env1.WORKER_NAME}.anjan.workers.dev`);
    assert.deepEqual(out1, { new_worker: 'true', mode: 'setup', setup: 'pending', reason: 'first' }, 'a new name: this run creates the Worker');
    const tokenFile = path.join(j1.dir, 'dls-setup-token');
    assert.match(fs.readFileSync(tokenFile, 'utf8'), /^[0-9a-f]{64}$/);
    assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
    const [{ link }] = (await t.db.prepare('SELECT link FROM setup').all()).results;
    assert.ok(link.startsWith(`${env1.SERVER_URL}/setup#SETUP-`));
    const shown = s1.stdout.split('\n').filter((l) => !l.startsWith('::add-mask::')).join('\n');
    for (const x of [link, link.split('#')[1], env1.WORKER_NAME, env1.SERVER_URL, fs.readFileSync(tokenFile, 'utf8')]) {
      assert.ok(!shown.includes(x), 'never printed');
      assert.ok(s1.stdout.includes(`::add-mask::${x}`) || x === link.split('#')[1] && s1.stdout.includes(`::add-mask::${x}`), `masked: ${x.slice(0, 16)}…`);
    }

    // The deploy step's secrets: the setup token goes up; without ANTHROPIC_API_KEY it is deleted (AI: NEEDS_KEY).
    const s2 = await run(['scripts/secrets.mjs', path.join(j1.dir, 'put.json'), path.join(j1.dir, 'delete.txt')], { ...j1.base });
    assert.equal(s2.status, 0, s2.stdout);
    const put = JSON.parse(fs.readFileSync(path.join(j1.dir, 'put.json'), 'utf8'));
    assert.deepEqual(Object.keys(put), ['DAYLIGHT_SETUP_TOKEN']);
    assert.match(fs.readFileSync(path.join(j1.dir, 'delete.txt'), 'utf8'), /^ANTHROPIC_API_KEY$/m);
    await t.restart({ ...put, SERVER_URL: env1.SERVER_URL, ANTHROPIC_API_KEY: undefined });
    cf.workers.add(env1.WORKER_NAME);
    const local = String(await t.mf.ready).replace(/\/$/, '');

    // The deploy row (migration 0005) on the Worker's own D1: this run created the Worker, which D1 then shows without
    // DAYLIGHT_PAIRING; a later Lab deploy whose listing fails reads that, a v1 deploy marks it first.
    const { pairingRecord, recordFromEnv, beforeUpload } = await import('../scripts/secrets.mjs');
    const rec = pairingRecord({ query: d1Query(t), worker: env1.WORKER_NAME });
    assert.equal(await rec.mayHold(), true, 'no row yet');
    await rec.set(false);
    assert.equal(await rec.mayHold(), false);
    assert.equal(await pairingRecord({ query: d1Query(t), worker: 'daylight-ffffffffffff' }).mayHold(), true, 'another Worker');
    assert.deepEqual(await beforeUpload({ DAYLIGHT_PAIRING: 'P' }, { record: rec, say: () => {} }), { ok: true });
    assert.equal(await rec.mayHold(), true);
    await rec.set(false);
    assert.deepEqual((await t.db.prepare('SELECT worker, pairing FROM deploy').all()).results, [{ worker: env1.WORKER_NAME, pairing: 0 }]);
    assert.ok(recordFromEnv({ ...cfEnv, WORKER_NAME: env1.WORKER_NAME }), 'the deploy step has what the row needs');
    assert.equal(recordFromEnv({ ...cfEnv, WORKER_NAME: '' }), null);

    // The announce step before setup: checks pass, the summary says where the link is and never shows it.
    const a1 = await run(['scripts/derive.mjs', 'announce', local], { ...j1.base, SETUP: 'pending', SETUP_REASON: 'first', R2: 'on', HAS_AI: 'false', DLS_TEST_HELLO_TRIES: '1' });
    assert.equal(a1.status, 0, a1.stdout);
    const sum1 = fs.readFileSync(j1.GITHUB_STEP_SUMMARY, 'utf8');
    assert.match(sum1, /### Daylight server is live: one step left/);
    assert.match(sum1, /hello ok · CORS ok · no token refused ok · wrong token refused ok · wrong setup token refused ok/);
    assert.match(sum1, /AI: needs ANTHROPIC_API_KEY \(optional\)/);
    assert.ok(!sum1.includes(link) && !sum1.includes('::add-mask::'), 'no secret and no workflow command in the summary');
    assert.doesNotMatch(a1.stdout, /SETUP-[A-Z2-7]{4}-/);

    // The app sets the server up; AI without the key answers NEEDS_KEY.
    const route = (url, init) => (new URL(url).origin === env1.SERVER_URL ? t.dispatch(url, init) : t.nodeFetch(url, init));
    const phone = new srv.DaylightServer({ pairing: t.pairing, storage: new ds.MemoryStorage(), fetch: route });
    assert.equal((await phone.setup(link)).server, env1.SERVER_URL);
    assert.equal((await phone.state('ai')).state, 'needs-key');
    const ai = await phone.ai.summarize({ text: 'x' }).then(() => null, (e) => e);
    assert.equal(ai?.code, 'NEEDS_KEY');
    assert.equal((await phone.noteError('ai', ai)).message, srv.STATE_MESSAGES['needs-key']);

    // The next run: the code the app sent, no token; the announce step runs the full checks with it.
    const j2 = job();
    const s3 = await run(['scripts/setup.mjs'], { ...j2.base, ...cfEnv });
    assert.equal(s3.status, 0, s3.stdout);
    const out2 = readKv(j2.GITHUB_OUTPUT);
    assert.deepEqual({ ...out2, fingerprint: undefined }, { new_worker: 'false', mode: 'setup', setup: 'claimed', reason: '', fingerprint: undefined });
    assert.equal(out2.fingerprint, srv.showFingerprint(t.values.fingerprint));
    assert.equal(readKv(j2.GITHUB_ENV).WORKER_NAME, env1.WORKER_NAME, 'the same Worker');
    assert.equal(fs.readFileSync(path.join(j2.dir, 'dls-server-code'), 'utf8'), t.serverCode);
    assert.ok(!fs.existsSync(path.join(j2.dir, 'dls-setup-token')));
    assert.ok(!s3.stdout.split('\n').filter((l) => !l.startsWith('::add-mask::')).join('\n').includes(t.serverCode));
    const s4 = await run(['scripts/secrets.mjs', path.join(j2.dir, 'put.json'), path.join(j2.dir, 'delete.txt')], { ...j2.base });
    assert.equal(s4.status, 0);
    assert.match(fs.readFileSync(path.join(j2.dir, 'delete.txt'), 'utf8'), /^DAYLIGHT_SETUP_TOKEN$/m, 'the used token is deleted from the Worker');
    await t.restart({ SERVER_URL: env1.SERVER_URL, ANTHROPIC_API_KEY: undefined, DAYLIGHT_SETUP_TOKEN: undefined }); // restart() starts from the first bindings
    const local2 = String(await t.mf.ready).replace(/\/$/, ''); // a restart may move the local port
    const a2 = await run(['scripts/derive.mjs', 'announce', local2], { ...j2.base, SETUP: 'claimed', R2: 'on', DLS_TEST_HELLO_TRIES: '1' });
    const sum2 = fs.readFileSync(j2.GITHUB_STEP_SUMMARY, 'utf8');
    assert.equal(a2.status, 0, `${a2.stdout}\n${sum2}`);
    assert.match(sum2, /### Daylight server is live\n/);
    assert.match(sum2, new RegExp(`Server code fingerprint ${srv.showFingerprint(t.values.fingerprint)}`));
    assert.match(sum2, /Token accepted: yes/);
    assert.match(sum2, /AI: needs ANTHROPIC_API_KEY/);
    assert.match(sum2, /Next: open Daylight Share on the Daylight with Lab on/);
    assert.ok(!sum2.includes(t.serverCode) && !sum2.includes(t.values.authToken) && !sum2.includes('::add-mask::'));
    assert.ok(cf.calls.every((c) => /\/workers\/subdomain$|\/d1\/database\/test-d1\/query$|^GET \/client\/v4\/accounts\/a{32}\/workers\/services\/daylight-[0-9a-f]{12}$/.test(c)), cf.calls.join('\n'));
    assert.ok(cf.calls.includes(`GET /client/v4/accounts/${account}/workers/services/${env1.WORKER_NAME}`), 'the second run asked whether the Worker exists');

    // No Worker answering /v1/hello at the address (a new workers.dev name not resolving yet): a warning and a summary
    // that says to re-run, not a failure.
    const j3 = job();
    const away = await run(['scripts/derive.mjs', 'announce', cf.api.replace('/client/v4', '')], { ...j3.base, SETUP: 'pending', DLS_TEST_HELLO_TRIES: '1' });
    assert.equal(away.status, 0, away.stdout);
    assert.match(away.stdout, /::warning title=Daylight server not reachable yet::/);
    assert.match(fs.readFileSync(j3.GITHUB_STEP_SUMMARY, 'utf8'), /not reachable yet[\s\S]*Re-run all jobs/);
  } finally { await cf.close(); await t.close(); }
});

test('Re-run all jobs of a manual “New setup link” run keeps the server and its Server code: only attempt 1 rotates (3.5)', async () => {
  const t = await setup({ serverUrl: ORIGIN, vars: { DAYLIGHT_SERVER_CODE: undefined } });
  const account = 'a'.repeat(32), token = 'cf-test-token';
  const cf = await fakeCloudflare(t, { account, token, workers: [WORKER] });
  try {
    const query = d1Query(t);
    await writeSetup({ query, plan: { worker: WORKER, secret: SECRET, rotate: true }, origin: ORIGIN, now: 1 });
    await query('UPDATE setup SET code = ?1, claimed = 2, link = NULL WHERE id = 1', [t.serverCode]);
    const step = async (attempt) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-job-'));
      const f = { GITHUB_ENV: path.join(dir, 'env'), GITHUB_OUTPUT: path.join(dir, 'out') };
      for (const p of Object.values(f)) fs.writeFileSync(p, '');
      const r = await run(['scripts/setup.mjs'], {
        RUNNER_TEMP: dir, ...f, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, D1_ID: 'test-d1', DLS_TEST_CF_API: cf.api,
        GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: String(attempt), NEW_SETUP_LINK: 'true',
      });
      assert.equal(r.status, 0, r.stdout);
      return { env: readKv(f.GITHUB_ENV), out: readKv(f.GITHUB_OUTPUT) };
    };
    // A week later the user adds ANTHROPIC_API_KEY and, as told, re-runs the latest run: that manual run.
    const rerun = await step(2);
    assert.deepEqual({ ...rerun.out, fingerprint: undefined }, { new_worker: 'false', mode: 'setup', setup: 'claimed', reason: '', fingerprint: undefined });
    assert.equal(rerun.env.WORKER_NAME, WORKER, 'the same Worker');
    assert.deepEqual(await query('SELECT worker, code FROM setup'), [{ worker: WORKER, code: t.serverCode }], 'the Server code is kept');
    // The manual run's own first attempt is what makes the new link.
    const first = await step(1);
    assert.deepEqual(first.out, { new_worker: 'true', mode: 'setup', setup: 'pending', reason: 'requested' });
    assert.notEqual(first.env.WORKER_NAME, WORKER);
  } finally { await cf.close(); await t.close(); }
});

/**
 * A stand-in for `npx` on the deploy runner's PATH, for `secrets.mjs remove`: `npx wrangler secret list` prints
 * $STUB_SECRETS (a JSON list) or, when it is "fail", fails; `npx wrangler secret delete` works. Every call is logged
 * to $STUB_LOG.
 */
function stubNpx() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-npx-'));
  fs.writeFileSync(path.join(dir, 'npx'), [
    '#!/bin/sh',
    'echo "$*" >> "$STUB_LOG"',
    '[ "$1 $2" = "wrangler secret" ] || exit 1',
    'case "$3" in',
    '  list) [ "$STUB_SECRETS" = fail ] && { echo "A request to the Cloudflare API failed. [code: 10013]" >&2; exit 1; }',
    '        printf "%s\\n" "$STUB_SECRETS"; exit 0 ;;',
    '  delete) exit 0 ;;',
    'esac',
    'exit 1',
    '',
  ].join('\n'), { mode: 0o755 });
  return dir;
}

test('the deploy step’s secrets.mjs as the workflow runs it: a Worker a new Server code names, the D1 row before a v1 upload (12.3)', async () => {
  const t = await setup({ serverUrl: ORIGIN });
  const account = 'a'.repeat(32), token = 'cf-test-token';
  const cf = await fakeCloudflare(t, { account, token, workers: [WORKER] });
  const npx = stubNpx();
  try {
    const query = d1Query(t);
    const row = async () => (await query('SELECT worker, pairing FROM deploy'))[0] ?? null;
    const cfEnv = { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, D1_ID: 'test-d1', DLS_TEST_CF_API: cf.api, DLS_TEST_NO_RETRY_WAIT: 'true' };
    const job = () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-job-'));
      const f = { GITHUB_ENV: path.join(dir, 'env'), GITHUB_OUTPUT: path.join(dir, 'out'), GITHUB_STEP_SUMMARY: path.join(dir, 'summary') };
      for (const p of Object.values(f)) fs.writeFileSync(p, '');
      return { dir, ...f, base: { RUNNER_TEMP: dir, ...f }, put: path.join(dir, 'put.json'), del: path.join(dir, 'delete.txt'), log: path.join(dir, 'npx.log') };
    };
    /** The deploy step's two secrets.mjs calls; `secrets` is what `wrangler secret list` shows (or 'fail'). */
    const deployStep = async (j, env, secrets) => {
      const split = await run(['scripts/secrets.mjs', j.put, j.del], { ...j.base, ...cfEnv, ...env });
      if (split.status !== 0) return { split };
      const remove = await run(['scripts/secrets.mjs', 'remove', j.del, 'wrangler.deploy.toml'], {
        ...j.base, ...cfEnv, ...env, PATH: `${npx}:${process.env.PATH}`, STUB_LOG: j.log,
        STUB_SECRETS: secrets === 'fail' ? 'fail' : JSON.stringify(secrets.map((name) => ({ name, type: 'secret_text' }))),
      });
      const calls = fs.existsSync(j.log) ? fs.readFileSync(j.log, 'utf8').trim().split('\n') : [];
      return { split, remove, calls };
    };
    const listFails = Array(3).fill('wrangler secret list --format json -c wrangler.deploy.toml');

    // The setup-link Worker has run Lab for a while (D1 shows it without DAYLIGHT_PAIRING). The user re-pairs and, as the
    // README says, pastes the new Server code into DAYLIGHT_SERVER_CODE: the gate names a new Worker after the code.
    await query('INSERT INTO deploy (id, worker, pairing, at) VALUES (1, ?1, 0, 1)', [WORKER]);
    const j1 = job();
    const g = await run(['scripts/derive.mjs', 'gate'], { ...j1.base, DAYLIGHT_SERVER_CODE: t.serverCode, HAS_TOKEN: 'true', HAS_ACCOUNT: 'true' });
    assert.equal(g.status, 0, g.stdout);
    const codeWorker = readKv(j1.GITHUB_ENV).WORKER_NAME;
    assert.equal(codeWorker, t.values.workerName);
    const code = { WORKER_NAME: codeWorker, DAYLIGHT_SERVER_CODE: t.serverCode };   // the deploy step's environment
    fs.writeFileSync(j1.GITHUB_ENV, '');
    fs.writeFileSync(j1.GITHUB_OUTPUT, '');
    const s1 = await run(['scripts/setup.mjs'], { ...j1.base, ...cfEnv, WORKER_NAME: codeWorker });
    assert.equal(s1.status, 0, s1.stdout);
    assert.deepEqual(readKv(j1.GITHUB_OUTPUT), { new_worker: 'true', mode: 'code', setup: 'none' }, 'Cloudflare has no Worker of that name: this deploy creates it');
    assert.ok(cf.calls.includes(`GET /client/v4/accounts/${account}/workers/services/${codeWorker}`));
    assert.ok(!s1.stdout.split('\n').filter((l) => !l.startsWith('::add-mask::')).join('\n').includes(codeWorker), 'the name is never printed');

    // Without new_worker that deploy's failed listing would fail the job: D1's row names the setup-link Worker.
    const before = await deployStep(job(), { ...code, NEW_WORKER: 'false' }, 'fail');
    assert.equal(before.remove.status, 1);
    assert.match(before.remove.stdout, /^::error title=Worker secrets::Couldn’t list the Worker’s secrets to remove DAYLIGHT_PAIRING/m);
    assert.deepEqual(await row(), { worker: WORKER, pairing: 0 }, 'left as it was');
    // With it (as the workflow passes it): listed all the same, and a listing that keeps failing is nothing to report.
    const fresh = await deployStep(job(), { ...code, NEW_WORKER: readKv(j1.GITHUB_OUTPUT).new_worker }, 'fail');
    assert.equal(fresh.split.status, 0, fresh.split.stdout);
    assert.equal(fresh.remove.status, 0, fresh.remove.stdout);
    assert.doesNotMatch(fresh.remove.stdout, /::(error|warning)/);
    assert.match(fresh.remove.stdout, /^Nothing to remove: this run created the Worker/m);
    assert.deepEqual(fresh.calls, listFails, 'listed three times, nothing deleted');
    assert.deepEqual(await row(), { worker: codeWorker, pairing: 0 }, 'D1 now shows the new Worker without DAYLIGHT_PAIRING');
    cf.workers.add(codeWorker);

    // The next deploy: the Worker exists, so it is not new, and D1 vouches for it when the listing fails.
    const j2 = job();
    const s2 = await run(['scripts/setup.mjs'], { ...j2.base, ...cfEnv, WORKER_NAME: codeWorker });
    assert.equal(s2.status, 0, s2.stdout);
    assert.equal(readKv(j2.GITHUB_OUTPUT).new_worker, 'false');
    const next = await deployStep(j2, { ...code, NEW_WORKER: 'false' }, 'fail');
    assert.equal(next.remove.status, 0, next.remove.stdout);
    assert.match(next.remove.stdout, /^DAYLIGHT_PAIRING: not on the Worker\./m);
    // Cloudflare's answer unknown (a 5xx): not new, which is safe.
    cf.workersDown = true;
    const j3 = job();
    assert.equal((await run(['scripts/setup.mjs'], { ...j3.base, ...cfEnv, WORKER_NAME: 'daylight-ffffffffffff' })).status, 0);
    assert.equal(readKv(j3.GITHUB_OUTPUT).new_worker, 'false');
    cf.workersDown = false;

    // v1 delivery: the row says "may hold" before the pairing code is uploaded.
    const PAIRING = 'E4AY-56TM-ADQP-5QSN-MY7B-CGPZ-UFRA';
    const v1 = { ...code, NEW_WORKER: 'false', DELIVERY: 'v1', DAYLIGHT_PAIRING: PAIRING };
    const j4 = job();
    const up = await deployStep(j4, v1, ['DAYLIGHT_PAIRING']);
    assert.equal(up.split.status, 0, up.split.stdout);
    assert.ok(!up.split.stdout.includes(PAIRING), 'never printed');
    assert.equal(JSON.parse(fs.readFileSync(j4.put, 'utf8')).DAYLIGHT_PAIRING, PAIRING);
    assert.doesNotMatch(fs.readFileSync(j4.del, 'utf8'), /DAYLIGHT_PAIRING/);
    assert.deepEqual(await row(), { worker: codeWorker, pairing: 1 });
    assert.equal(up.remove.status, 0, up.remove.stdout);
    assert.deepEqual(await row(), { worker: codeWorker, pairing: 1 }, 'a listing that works keeps it: uploaded');
    // Without D1 to mark (no D1_ID, or D1 failing three times), nothing goes up.
    for (const [env, why] of [[{ D1_ID: '' }, 'no D1_ID'], [{ D1_ID: 'gone' }, 'D1 failing']]) {
      const j = job();
      const r = await run(['scripts/secrets.mjs', j.put, j.del], { ...j.base, ...cfEnv, ...v1, ...env });
      assert.equal(r.status, 1, why);
      assert.match(r.stdout, /^::error title=Worker secrets::Couldn’t record in D1 that the Worker gets DAYLIGHT_PAIRING/m, why);
      assert.ok(!fs.existsSync(j.put) && !fs.existsSync(j.del), `${why}: no put.json for wrangler deploy`);
    }
    assert.equal(cf.calls.filter((c) => c.includes('/d1/database/gone/')).length, 3, 'tried three times');

    // Back to Lab: a listing that keeps failing now fails the job (the Worker may hold the pairing code), and one that
    // works removes it and clears the row.
    const stuck = await deployStep(job(), { ...code, NEW_WORKER: 'false' }, 'fail');
    assert.equal(stuck.remove.status, 1);
    assert.match(stuck.remove.stdout, /^::error title=Worker secrets::[^\n]*may still hold your pairing code/m);
    const lab = await deployStep(job(), { ...code, NEW_WORKER: 'false' }, ['DAYLIGHT_PAIRING', 'NTFY_TOKEN']);
    assert.equal(lab.remove.status, 0, lab.remove.stdout);
    assert.deepEqual(lab.calls, ['list --format json', 'delete NTFY_TOKEN', 'delete DAYLIGHT_PAIRING'].map((c) => `wrangler secret ${c} -c wrangler.deploy.toml`), 'NTFY_TOKEN: not a GitHub secret either');
    assert.deepEqual(await row(), { worker: codeWorker, pairing: 0 });
  } finally { await cf.close(); await t.close(); }
});
