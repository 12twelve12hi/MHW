// The deploy helpers (DESIGN.md 12.4): the secret gate (a pairing code in DAYLIGHT_SERVER_CODE fails, missing secrets
// only notify, every derived value is masked and nothing secret is printed in the clear), the secrets split and the
// rate-limit fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ds from '../../share/js/daylight-share.js';
import * as srv from '../client/daylight-server.js';
import { split, withSetupToken } from '../scripts/secrets.mjs';
import { dropRatelimit } from '../scripts/cf-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = ds.fromHex('27018efa6c00e0fec24d663e1119f9a1');
const PAIRING = 'E4AY-56TM-ADQP-5QSN-MY7B-CGPZ-UFRA';

function gate(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const files = { GITHUB_OUTPUT: path.join(dir, 'out'), GITHUB_ENV: path.join(dir, 'env'), GITHUB_STEP_SUMMARY: path.join(dir, 'summary') };
  for (const f of Object.values(files)) fs.writeFileSync(f, '');
  const r = spawnSync(process.execPath, ['scripts/derive.mjs', 'gate'], { cwd: root, env: { PATH: process.env.PATH, ...files, ...env }, encoding: 'utf8' });
  const read = (k) => fs.readFileSync(files[k], 'utf8');
  return { status: r.status, stdout: r.stdout + r.stderr, out: read('GITHUB_OUTPUT'), env: read('GITHUB_ENV'), summary: read('GITHUB_STEP_SUMMARY') };
}

const visible = (stdout) => stdout.split('\n').filter((l) => !l.startsWith('::add-mask::')).join('\n');

test('gate: a valid Server code passes, writes ok, the fingerprint and WORKER_NAME, and masks every derived value', async () => {
  const seed = await srv.deriveServerSeed(SECRET);
  const code = await srv.formatServerCode(seed);
  const v = await srv.deriveServerValues(seed);
  const r = gate({ DAYLIGHT_SERVER_CODE: code, HAS_TOKEN: 'true', HAS_ACCOUNT: 'true' });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.out, /^ok=true$/m);
  assert.match(r.out, new RegExp(`^fingerprint=${srv.showFingerprint(v.fingerprint)}$`, 'm'));
  assert.equal(r.env.trim(), `WORKER_NAME=${v.workerName}`);
  for (const secret of [code, code.replace(/-/g, ''), v.authToken, v.configTopic, v.itemTopic, v.ackTopic, v.workerName, ds.toHex(seed)]) {
    assert.ok(r.stdout.includes(`::add-mask::${secret}`), `masked: ${secret.slice(0, 12)}…`);
    assert.ok(!visible(r.stdout).includes(secret), 'never printed in the clear');
  }
});

test('gate: a pairing code in DAYLIGHT_SERVER_CODE fails the deploy with the explanation, without echoing it', () => {
  for (const value of [PAIRING, PAIRING.replace(/-/g, ''), `daylightshare://pair?c=${PAIRING.replace(/-/g, '')}`]) {
    const r = gate({ DAYLIGHT_SERVER_CODE: value, HAS_TOKEN: 'true', HAS_ACCOUNT: 'true' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error title=Daylight server::DAYLIGHT_SERVER_CODE holds your pairing code/);
    assert.ok(!visible(r.stdout).includes(PAIRING.replace(/-/g, '')));
  }
  const junk = gate({ DAYLIGHT_SERVER_CODE: 'SERVER-NOPE', HAS_TOKEN: 'true', HAS_ACCOUNT: 'true' });
  assert.equal(junk.status, 1);
  assert.match(junk.stdout, /isn’t a Server code/);
  assert.ok(!visible(junk.stdout).includes('NOPE'));
});

test('gate: missing Cloudflare secrets give a notice naming them and ok=false, and the job still passes', () => {
  const r = gate({});
  assert.equal(r.status, 0);
  assert.match(r.out, /^ok=false$/m);
  assert.match(r.stdout, /::notice title=Daylight server not deployed::.*Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in GitHub › Settings/);
  assert.doesNotMatch(r.stdout, /Add [^.]*DAYLIGHT_SERVER_CODE/, 'the Server code is not needed to deploy');
  assert.match(r.summary, /Re-run all jobs/);
  assert.match(r.summary, /Next: add CLOUDFLARE_API_TOKEN/);
  const half = gate({ HAS_TOKEN: 'true' });
  assert.match(half.stdout, /Add CLOUDFLARE_ACCOUNT_ID in GitHub/);
});

test('gate: the two Cloudflare secrets alone are enough: setup mode, no Worker name yet (the setup link names it)', () => {
  const r = gate({ HAS_TOKEN: 'true', HAS_ACCOUNT: 'true' });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.out, /^ok=true$/m);
  assert.match(r.out, /^mode=setup$/m);
  assert.equal(r.env.trim(), '', 'no WORKER_NAME: setup.mjs decides it');
  const v1 = gate({ HAS_TOKEN: 'true', HAS_ACCOUNT: 'true', DELIVERY: 'v1' });
  assert.match(v1.stdout, /::warning title=v1 delivery needs DAYLIGHT_PAIRING::/);
  assert.match(v1.out, /^mode=setup$/m);
});

test('gate: v1 delivery needs the variable; mismatched pairings fail; DAYLIGHT_PAIRING alone only warns', async () => {
  const seed = await srv.deriveServerSeed(SECRET);
  const code = await srv.formatServerCode(seed);
  const v1 = gate({ DAYLIGHT_PAIRING: PAIRING, DELIVERY: 'v1', HAS_TOKEN: 'true', HAS_ACCOUNT: 'true' });
  assert.equal(v1.status, 0, v1.stdout);
  assert.match(v1.out, /^delivery=v1$/m);
  assert.ok(v1.stdout.includes(`::add-mask::${ds.toHex(SECRET)}`));
  const warn = gate({ DAYLIGHT_SERVER_CODE: code, DAYLIGHT_PAIRING: PAIRING, HAS_TOKEN: 'true', HAS_ACCOUNT: 'true' });
  assert.equal(warn.status, 0);
  assert.match(warn.stdout, /::warning title=DAYLIGHT_PAIRING is not uploaded::/);
  assert.match(warn.out, /^delivery=lab$/m);
  const other = await srv.formatServerCode(await srv.deriveServerSeed(ds.generateSecret()));
  const mismatch = gate({ DAYLIGHT_SERVER_CODE: other, DAYLIGHT_PAIRING: PAIRING, DELIVERY: 'v1', HAS_TOKEN: 'true', HAS_ACCOUNT: 'true' });
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stdout, /belong to different pairings/);
});

test('secrets: optional secrets that are gone are deleted; DAYLIGHT_PAIRING only with DELIVERY=v1; the setup token from its file', () => {
  const lab = split({ DAYLIGHT_SERVER_CODE: 'SERVER-X', ANTHROPIC_API_KEY: 'sk', DAYLIGHT_PAIRING: 'P', DAYLIGHT_EMAIL_DOMAIN: 'Read.Example.COM ' });
  assert.deepEqual(lab.put, { DAYLIGHT_SERVER_CODE: 'SERVER-X', ANTHROPIC_API_KEY: 'sk', DAYLIGHT_EMAIL_DOMAIN: 'read.example.com' });
  assert.deepEqual(lab.remove, ['DAYLIGHT_EMAIL_LOCAL', 'DAYLIGHT_EMAIL_SALT', 'NTFY_TOKEN', 'DAYLIGHT_PAIRING', 'DAYLIGHT_SETUP_TOKEN']);
  const v1 = split({ DAYLIGHT_PAIRING: 'P', DELIVERY: 'v1' });
  assert.equal(v1.put.DAYLIGHT_PAIRING, 'P');
  // Without ANTHROPIC_API_KEY it is deleted from the Worker, whose AI features then answer NEEDS_KEY.
  assert.ok(split({}).remove.includes('ANTHROPIC_API_KEY'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-'));
  const token = 'ab'.repeat(32);
  fs.writeFileSync(path.join(dir, 'dls-setup-token'), `${token}\n`);
  assert.equal(split(withSetupToken({ RUNNER_TEMP: dir })).put.DAYLIGHT_SETUP_TOKEN, token, 'uploaded while a link waits');
  assert.ok(split(withSetupToken({ RUNNER_TEMP: path.join(dir, 'none') })).remove.includes('DAYLIGHT_SETUP_TOKEN'), 'deleted once used');
  fs.writeFileSync(path.join(dir, 'dls-setup-token'), 'not-a-token');
  assert.ok(split(withSetupToken({ RUNNER_TEMP: dir })).remove.includes('DAYLIGHT_SETUP_TOKEN'));
  // A secret named DAYLIGHT_SETUP_TOKEN in GitHub is never what is uploaded: only the file counts.
  assert.ok(split(withSetupToken({ DAYLIGHT_SETUP_TOKEN: token })).remove.includes('DAYLIGHT_SETUP_TOKEN'));
});

test('the rate-limit binding can be dropped from the deploy config', () => {
  const toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
  const dropped = dropRatelimit(toml);
  assert.doesNotMatch(dropped, /ratelimits|namespace_id|simple = /);
  assert.match(dropped, /\[vars\]/);
  assert.match(dropped, /\[\[d1_databases\]\]/);
});

test('workers.dev subdomain: kept when it exists, created only on "none", never after a transient or auth error', async () => {
  const { ensureSubdomain } = await import('../scripts/cf-check.mjs');
  const calls = [];
  const api = (answers) => async (url, init = {}) => {
    calls.push(init.method ?? 'GET');
    const a = answers.shift();
    if (a === 'network') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'Content-Type': 'application/json' } });
  };
  const sleep = async () => {};
  const base = { account: 'a'.repeat(32), token: 't', sleep, random: '0123456789' };
  calls.length = 0;
  assert.deepEqual(await ensureSubdomain({ ...base, fetchFn: api([{ status: 200, body: { success: true, result: { subdomain: 'mine' } } }]) }), { subdomain: 'mine', created: false });
  assert.deepEqual(calls, ['GET']);
  calls.length = 0;
  const none = { status: 404, body: { success: false, errors: [{ code: 10007, message: 'workers.api.error.not_found' }] } };
  const made = await ensureSubdomain({ ...base, fetchFn: api([none, { status: 200, body: { success: true, result: { subdomain: 'dl-0123456789' } } }]) });
  assert.deepEqual(made, { subdomain: 'dl-0123456789', created: true });
  assert.deepEqual(calls, ['GET', 'PUT']);
  for (const transient of [{ status: 500, body: {} }, { status: 429, body: {} }, { status: 503, body: { success: false } }, 'network']) {
    calls.length = 0;
    const answers = [transient, transient, transient, transient];
    await assert.rejects(ensureSubdomain({ ...base, fetchFn: api(answers) }), /nothing was changed/);
    assert.ok(!calls.includes('PUT'), `no PUT after ${JSON.stringify(transient)}`);
    assert.equal(calls.length, 4, 'retried');
  }
  calls.length = 0;
  await assert.rejects(ensureSubdomain({ ...base, fetchFn: api([{ status: 403, body: { success: false } }]) }), /HTTP 403/);
  assert.deepEqual(calls, ['GET'], 'an auth error is not retried and never creates');
  calls.length = 0;
  const later = await ensureSubdomain({ ...base, fetchFn: api([{ status: 502, body: {} }, { status: 200, body: { success: true, result: { subdomain: 'mine' } } }]) });
  assert.deepEqual(later, { subdomain: 'mine', created: false }, 'a transient error, then the real answer');
  assert.ok(!calls.includes('PUT'));
});

test('the deploy workflow reads the subdomain through setup.mjs and cf-check (no swallowed errors before a PUT)', () => {
  const wf = fs.readFileSync(path.join(root, '..', '..', '.github', 'workflows', 'rx-server.yml'), 'utf8');
  const step = wf.slice(wf.indexOf('- name: Server code or setup link'), wf.indexOf('- name: R2 bucket'));
  assert.match(step, /run: node scripts\/setup\.mjs$/m);
  assert.doesNotMatch(step, /\|\| true|-X PUT/);
  assert.match(fs.readFileSync(path.join(root, 'scripts', 'setup.mjs'), 'utf8'), /import \{ ensureSubdomain \} from '\.\/cf-check\.mjs'/);
});

test('smoke: a live Worker that answers without the token, or without CORS, fails the check', async () => {
  const { smoke } = await import('../scripts/derive.mjs');
  const worker = (over = {}) => async (url, init = {}) => {
    const p = new URL(url).pathname;
    const auth = (init.headers ?? {}).Authorization;
    if (p === '/v1/hello') return Response.json({ service: 'daylight-server', api: 1 });
    if (init.method === 'OPTIONS') return new Response(null, { status: over.cors ?? 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } });
    if (p === '/v1/status') return over.open ? Response.json({ fingerprint: 'x' }) : Response.json({ error: { code: 'BAD_AUTH' } }, { status: 401 });
    if (p === '/v1/setup') return Response.json({ error: { code: auth ? 'BAD_AUTH' : 'NOT_FOUND' } }, { status: over.setup ?? 401 });
    return new Response('?', { status: 404 });
  };
  assert.equal((await smoke('https://w.example', { fetchFn: worker(), tries: 1 })).ok, true);
  const open = await smoke('https://w.example', { fetchFn: worker({ open: true }), tries: 1 });
  assert.equal(open.ok, false);
  assert.deepEqual(open.checks.filter((c) => !c.ok).map((c) => c.name), ['no token refused', 'wrong token refused']);
  assert.equal((await smoke('https://w.example', { fetchFn: worker({ cors: 200 }), tries: 1 })).ok, false);
  assert.equal((await smoke('https://w.example', { fetchFn: worker({ setup: 200 }), tries: 1 })).ok, false);
  const down = await smoke('https://w.example', { fetchFn: async () => { throw new TypeError('fetch failed'); }, tries: 3, sleep: async () => {} });
  assert.deepEqual([down.up, down.ok], [false, false]);
});
