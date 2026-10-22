// The deploy helpers (DESIGN.md 12.4): the secret gate (a pairing code in DAYLIGHT_SERVER_CODE fails, missing secrets
// only notify, every derived value is masked and nothing secret is printed in the clear), the secrets split and the
// rate-limit fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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

// ---- The deploy workflow's own steps, run as the deploy job runs them (bash -eo pipefail) with stub commands

const WF = path.join(root, '..', '..', '.github', 'workflows', 'rx-server.yml');
const workflow = () => fs.readFileSync(WF, 'utf8');

/** The `run: |` script of the workflow step whose name starts with `name`. */
function stepScript(name) {
  const lines = workflow().split('\n');
  const i = lines.findIndex((l) => l.trim().startsWith(`- name: ${name}`));
  assert.ok(i >= 0, `no step ${name}`);
  let j = i + 1;
  while (!/^\s+run: \|$/.test(lines[j])) {
    if (j > i + 1 && /^\s{6}- /.test(lines[j])) throw new Error(`no run block in ${name}`);
    j++;
  }
  const indent = lines[j].match(/^\s*/)[0].length + 2;
  const out = [];
  for (let k = j + 1; k < lines.length; k++) {
    if (lines[k].trim() && lines[k].match(/^\s*/)[0].length < indent) break;
    out.push(lines[k].slice(indent));
  }
  return out.join('\n');
}

/** Runs a step's script with stub commands first on PATH. -> {status, stdout, dir} */
function runStep(name, { env = {}, stubs = {}, cwd = root } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const [cmd, body] of Object.entries(stubs)) fs.writeFileSync(path.join(bin, cmd), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  const summary = path.join(dir, 'summary');
  fs.writeFileSync(summary, '');
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', stepScript(name)], {
    cwd: cwd === 'tmp' ? dir : cwd, encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: summary, GITHUB_ENV: path.join(dir, 'env'), ...env },
  });
  return { status: r.status, stdout: r.stdout + r.stderr, dir, summary: fs.readFileSync(summary, 'utf8') };
}

/**
 * GitHub's expression for the given context: the names below, ==, !=, >, &&, || and parentheses (enough for this
 * workflow's `if:` and env expressions).
 */
function evalExpr(expr, ctx) {
  const names = {
    'needs.test.outputs.server_changed': 'changed', 'github.run_attempt': 'attempt', 'github.event_name': 'event',
    'inputs.deploy': 'deploy', 'inputs.new_setup_link': 'newLink',
  };
  let js = expr.replace(/\$\{\{|\}\}/g, '');
  for (const [k, v] of Object.entries(names)) js = js.split(k).join(`ctx.${v}`);
  assert.ok(!/[a-z_]+\.[a-z_]+/i.test(js.replace(/ctx\.\w+/g, '')), `unknown name in ${expr}`);
  return Boolean(new Function('ctx', `return (${js});`)(ctx));
}

test('deploy job: a push that changes the server, Re-run all jobs (of any run) and a manual run with deploy on', () => {
  const m = /\n {2}deploy:\n[\s\S]*?\n {4}if: >-\n((?: {6}.*\n)+)/.exec(workflow());
  const deploys = (ctx) => evalExpr(m[1].replace(/\s+/g, ' '), { changed: 'false', attempt: 1, event: 'push', deploy: null, newLink: null, ...ctx });
  assert.equal(deploys({ changed: 'true' }), true);
  assert.equal(deploys({}), false, 'tested, not deployed');
  assert.equal(deploys({ attempt: 2 }), true, 'Re-run all jobs');
  assert.equal(deploys({ event: 'workflow_dispatch', deploy: true }), true);
  assert.equal(deploys({ event: 'workflow_dispatch', deploy: false }), false, 'deploy off: build and test only');
  assert.equal(deploys({ event: 'workflow_dispatch', deploy: false, attempt: 2 }), true, 'Re-run all jobs applies changed secrets, whatever run it is');
});

test('New setup link counts on a manual run’s first attempt only: Re-run all jobs never moves the server again (3.5)', () => {
  const line = workflow().split('\n').find((l) => /^\s+NEW_SETUP_LINK: /.test(l));
  const expr = line.replace(/^\s+NEW_SETUP_LINK: /, '');
  const asked = (ctx) => evalExpr(expr, { event: 'workflow_dispatch', attempt: 1, newLink: true, ...ctx });
  assert.equal(asked({}), true);
  assert.equal(asked({ attempt: 2 }), false);
  assert.equal(asked({ newLink: false }), false);
  assert.equal(asked({ event: 'push', newLink: null }), false);
});

test('without the Cloudflare secrets the notice gives every way to start the first deploy, not only a re-run', () => {
  const r = runStep('Without the Cloudflare secrets');
  assert.equal(r.status, 0, r.stdout);
  const notice = r.stdout.split('\n').find((l) => l.startsWith('::notice'));
  assert.match(notice, /Re-run all jobs/);
  assert.match(notice, /30 days/, 'GitHub offers a re-run for 30 days after a run');
  assert.match(notice, /gh workflow run rx-server\.yml --ref claude\/sweet-goldberg-ej1nb0/);
  assert.match(notice, /push a change under reader-experiment\/server\//);
  assert.match(r.summary, /gh workflow run rx-server\.yml/);
  const loose = fs.readFileSync(path.join(root, '..', 'LOOSE-ENDS.md'), 'utf8');
  const cf = loose.slice(loose.indexOf('## Deploy the Daylight server'), loose.indexOf('\n## ', loose.indexOf('## Deploy the Daylight server') + 5));
  assert.match(cf, /30 days/);
  assert.match(cf, /gh workflow run rx-server\.yml --ref claude\/sweet-goldberg-ej1nb0/);
});

test('removing earlier Workers: a failed listing or delete is a warning, never silence; this Worker is kept', () => {
  const base = { WORKER_NAME: 'daylight-0123456789ab', CF_API: 'https://api.invalid/client/v4', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' };
  const npxLog = 'echo "$*" >> "$RUNNER_TEMP/npx.log"';
  const down = runStep('Remove the Workers of earlier', { env: base, stubs: { curl: 'exit 22', npx: npxLog } });
  assert.equal(down.status, 0, down.stdout);
  assert.match(down.stdout, /::warning[^\n]*earlier Daylight Worker/i, 'a listing that failed says so');
  assert.ok(!fs.existsSync(path.join(down.dir, 'npx.log')));
  const list = `echo '{"success":true,"result":[{"id":"daylight-0123456789ab"},{"id":"daylight-aaaaaaaaaaaa"},{"id":"other"}]}'`;
  const ok = runStep('Remove the Workers of earlier', { env: base, stubs: { curl: list, npx: npxLog } });
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(fs.readFileSync(path.join(ok.dir, 'npx.log'), 'utf8'), 'wrangler delete --name daylight-aaaaaaaaaaaa --force\n');
  assert.doesNotMatch(ok.stdout, /::warning/);
  const stuck = runStep('Remove the Workers of earlier', { env: base, stubs: { curl: list, npx: 'exit 1' } });
  assert.equal(stuck.status, 0);
  assert.match(stuck.stdout, /::warning[^\n]*earlier Daylight Worker/i);
});

test('the D1 step writes wrangler.deploy.toml with the database id, which the committed wrangler.toml leaves out', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd1-'));
  fs.copyFileSync(path.join(root, 'wrangler.toml'), path.join(dir, 'wrangler.toml'));
  const npx = `case "$*" in
  "wrangler d1 list --json") echo '[{"name":"other","uuid":"x"},{"name":"daylight-server","uuid":"${id}"}]' ;;
  "wrangler d1 migrations apply daylight-server --remote -c wrangler.deploy.toml") echo applied >> "$RUNNER_TEMP/npx.log" ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac`;
  const r = runStep('D1 database', { cwd: dir, stubs: { npx } });
  assert.equal(r.status, 0, r.stdout);
  const toml = fs.readFileSync(path.join(dir, 'wrangler.deploy.toml'), 'utf8');
  const d1 = toml.slice(toml.indexOf('[[d1_databases]]'), toml.indexOf('\n[', toml.indexOf('[[d1_databases]]') + 5));
  assert.match(d1, new RegExp(`^database_id = "${id}"$`, 'm'));
  assert.match(d1, /^database_name = "daylight-server"$/m);
  assert.equal((toml.match(/^database_id/gm) ?? []).length, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8'), /^database_id/m,
    'no placeholder id: wrangler would send `d1 execute daylight-server` in this folder to it instead of looking the name up');
});

test('the documented command for reading the setup link works in the server folder (it looks the database up by name)', async () => {
  const { SETUP_STEPS } = await import('../scripts/derive.mjs');
  const cmd = /`(npx wrangler d1 execute daylight-server --remote --command "SELECT link FROM setup")`/.exec(SETUP_STEPS('first').join('\n'))?.[1];
  assert.ok(cmd, 'the summary gives the command');
  const calls = [];
  const http = await import('node:http');
  const uuid = '11111111-2222-3333-4444-555555555555';
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls.push(`${req.method} ${req.url.split('?')[0]}`);
      res.setHeader('Content-Type', 'application/json');
      const ok = (result) => res.end(JSON.stringify({ success: true, errors: [], messages: [], result }));
      if (req.url.startsWith('/client/v4/accounts/acct/d1/database/daylight-server')) return ok({ uuid, name: 'daylight-server' });
      if (req.url === `/client/v4/accounts/acct/d1/database/${uuid}/query`) return ok([{ results: [{ link: 'https://daylight-0123456789ab.x.workers.dev/setup#SETUP-TEST' }], success: true, meta: {} }]);
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, errors: [{ code: 7404, message: 'not found' }], messages: [], result: null }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    const out = await new Promise((resolve) => {
      const child = spawn('bash', ['-c', cmd], {
        cwd: root,
        env: {
          PATH: process.env.PATH, HOME: home, CI: 'true', WRANGLER_SEND_METRICS: 'false', NO_UPDATE_NOTIFIER: '1',
          CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${server.address().port}/client/v4`, CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acct',
        },
      });
      let text = '';
      child.stdout.on('data', (d) => { text += d; });
      child.stderr.on('data', (d) => { text += d; });
      child.on('close', (status) => resolve({ status, text }));
    });
    assert.equal(out.status, 0, out.text);
    assert.deepEqual(calls, ['GET /client/v4/accounts/acct/d1/database/daylight-server', `POST /client/v4/accounts/acct/d1/database/${uuid}/query`]);
    assert.match(out.text, /SETUP-TEST/);
  } finally { await new Promise((r) => server.close(r)); }
});

test('secrets.mjs remove: deletes what the Worker has, retries, warns, and fails when DAYLIGHT_PAIRING may stay (3.1, 12.3)', async () => {
  const { removeSecrets } = await import('../scripts/secrets.mjs');
  assert.equal(typeof removeSecrets, 'function');
  const names = ['ANTHROPIC_API_KEY', 'DAYLIGHT_PAIRING', 'NTFY_TOKEN', 'DAYLIGHT_SETUP_TOKEN'];
  const worker = (script) => {
    const calls = [];
    return { calls, wrangler: async (args) => { calls.push(args.join(' ')); return script(args, calls); } };
  };
  const listed = (...n) => ({ status: 0, stdout: JSON.stringify(n.map((name) => ({ name, type: 'secret_text' }))) });
  const run = async (w) => {
    const said = [];
    const r = await removeSecrets(names, { wrangler: w.wrangler, say: (l) => said.push(l), sleep: async () => {} });
    return { ...r, said: said.join('\n') };
  };
  // The user withdrew v1 delivery: DAYLIGHT_PAIRING is on the Worker and goes; names it lacks are not touched.
  const ok = worker((a) => (a[0] === 'secret' && a[1] === 'list' ? listed('DAYLIGHT_PAIRING', 'OTHER') : { status: 0, stdout: '' }));
  const r1 = await run(ok);
  assert.deepEqual([r1.ok, r1.removed, r1.failed], [true, ['DAYLIGHT_PAIRING'], []]);
  assert.deepEqual(ok.calls, ['secret list --format json', 'secret delete DAYLIGHT_PAIRING']);
  assert.doesNotMatch(r1.said, /::(warning|error)/);
  // A transient 429 on the list: retried, not taken as "nothing to delete".
  const flaky = worker((a, calls) => (a[1] === 'list' ? (calls.length < 3 ? { status: 1, stdout: '' } : listed('DAYLIGHT_PAIRING')) : { status: 0, stdout: '' }));
  const r2 = await run(flaky);
  assert.deepEqual([r2.ok, r2.removed], [true, ['DAYLIGHT_PAIRING']]);
  // A list that keeps failing: DAYLIGHT_PAIRING may still be there, so the step fails, saying so.
  const down = worker(() => ({ status: 1, stdout: '' }));
  const r3 = await run(down);
  assert.equal(r3.ok, false);
  assert.match(r3.said, /^::error title=Worker secrets::[^\n]*DAYLIGHT_PAIRING/m);
  assert.equal(down.calls.filter((c) => c.includes('list')).length, 3);
  // A delete that keeps failing: a warning for an optional secret, an error for DAYLIGHT_PAIRING.
  const stuck = worker((a) => (a[1] === 'list' ? listed('ANTHROPIC_API_KEY', 'DAYLIGHT_PAIRING') : a[2] === 'DAYLIGHT_PAIRING' ? { status: 0, stdout: '' } : { status: 1, stdout: '' }));
  const r4 = await run(stuck);
  assert.deepEqual([r4.ok, r4.removed, r4.failed], [true, ['DAYLIGHT_PAIRING'], ['ANTHROPIC_API_KEY']]);
  assert.match(r4.said, /^::warning title=Worker secrets::[^\n]*ANTHROPIC_API_KEY/m);
  const pinned = worker((a) => (a[1] === 'list' ? listed('DAYLIGHT_PAIRING') : { status: 1, stdout: '' }));
  const r5 = await run(pinned);
  assert.equal(r5.ok, false);
  assert.match(r5.said, /^::error title=Worker secrets::[^\n]*DAYLIGHT_PAIRING/m);
  // Without DAYLIGHT_PAIRING to remove, a list that keeps failing is a warning.
  const said = [];
  const r6 = await removeSecrets(['ANTHROPIC_API_KEY'], { wrangler: down.wrangler, say: (l) => said.push(l), sleep: async () => {} });
  assert.equal(r6.ok, true);
  assert.match(said.join('\n'), /^::warning title=Worker secrets::/m);
  // The deploy step uses it, with nothing swallowed.
  const step = stepScript('Deploy the Worker with its secrets');
  assert.match(step, /^node scripts\/secrets\.mjs remove "\$RUNNER_TEMP\/delete\.txt" wrangler\.deploy\.toml$/m);
  assert.doesNotMatch(step, /secret (list|delete)/);
});

test('secrets.mjs remove: a failed listing fails the job only when the Worker may really hold DAYLIGHT_PAIRING (12.3)', async () => {
  const { removeSecrets, pairingRecord, beforeUpload } = await import('../scripts/secrets.mjs');
  const W = 'daylight-0123456789ab';
  /** A D1 `deploy` table of one row (migration 0005), or one whose every query fails. */
  const d1 = (row, { fail = false } = {}) => {
    const db = { row, queries: 0 };
    db.query = async (sql, params = []) => {
      db.queries++;
      if (fail) throw new Error('D1 query failed (HTTP 500)');
      if (/^SELECT worker, pairing FROM deploy WHERE id = 1$/.test(sql)) return db.row ? [db.row] : [];
      assert.match(sql, /^INSERT OR REPLACE INTO deploy \(id, worker, pairing, at\) VALUES \(1, \?1, \?2, \?3\)$/);
      db.row = { worker: params[0], pairing: params[1], at: params[2] };
      return [];
    };
    db.record = (worker = W) => pairingRecord({ query: db.query, worker, now: () => 7 });
    return db;
  };
  const worker = (script) => {
    const calls = [];
    return { calls, wrangler: async (args) => { calls.push(args.join(' ')); return script(args); } };
  };
  const listed = (...n) => ({ status: 0, stdout: JSON.stringify(n.map((name) => ({ name, type: 'secret_text' }))) });
  const run = async (names, w, opts = {}) => {
    const said = [];
    const r = await removeSecrets(names, { wrangler: w.wrangler, say: (l) => said.push(l), sleep: async () => {}, ...opts });
    return { ...r, said: said.join('\n') };
  };
  const lab = ['ANTHROPIC_API_KEY', 'DAYLIGHT_PAIRING', 'DAYLIGHT_SETUP_TOKEN'];   // a Lab deploy never uploads DAYLIGHT_PAIRING

  // A Worker this run created holds only what this deploy uploaded: nothing is listed or removed, and nothing is wrong
  // even while the listing would fail. D1 then shows it without DAYLIGHT_PAIRING.
  const down = worker(() => ({ status: 1, stdout: '' }));
  const fresh = d1(null);
  const r1 = await run(lab, down, { newWorker: true, record: fresh.record() });
  assert.deepEqual([r1.ok, r1.removed, r1.failed], [true, [], []]);
  assert.deepEqual(down.calls, []);
  assert.doesNotMatch(r1.said, /::(error|warning)/);
  assert.deepEqual(fresh.row, { worker: W, pairing: 0, at: 7 });

  // Its next deploy can't list the secrets: D1 shows it without DAYLIGHT_PAIRING, so only the others warn.
  const r2 = await run(lab, down, { record: fresh.record() });
  assert.equal(r2.ok, true, r2.said);
  assert.doesNotMatch(r2.said, /::error/);
  assert.match(r2.said, /^::warning title=Worker secrets::[^\n]*ANTHROPIC_API_KEY/m);
  assert.doesNotMatch(r2.said, /::warning[^\n]*DAYLIGHT_PAIRING/);
  assert.equal(down.calls.length, 3, 'the listing was still tried three times');
  assert.deepEqual(fresh.row, { worker: W, pairing: 0, at: 7 }, 'left as it was');

  // Fail safe: no row, another Worker's row, a row that says it may hold it, D1 failing, or no D1 at all.
  for (const [db, why] of [[d1(null), 'no row'], [d1({ worker: 'daylight-ffffffffffff', pairing: 0, at: 1 }), 'another Worker'],
    [d1({ worker: W, pairing: 1, at: 1 }), 'may hold it'], [d1({ worker: W, pairing: 0, at: 1 }, { fail: true }), 'D1 down']]) {
    const r = await run(lab, down, { record: db.record() });
    assert.equal(r.ok, false, why);
    assert.match(r.said, /^::error title=Worker secrets::Couldn’t list the Worker’s secrets to remove DAYLIGHT_PAIRING, and D1 doesn’t show this Worker without it, so the Worker may still hold your pairing code/m, why);
  }
  assert.equal((await run(lab, down)).ok, false, 'no record');

  // A listing that works keeps D1 true: removed or absent -> 0; a delete that keeps failing -> 1 (and the error).
  const had = d1({ worker: W, pairing: 1, at: 1 });
  assert.equal((await run(lab, worker((a) => (a[1] === 'list' ? listed('DAYLIGHT_PAIRING') : { status: 0, stdout: '' })), { record: had.record() })).ok, true);
  assert.equal(had.row.pairing, 0, 'removed');
  const other = d1({ worker: 'daylight-ffffffffffff', pairing: 0, at: 1 });
  assert.equal((await run(lab, worker(() => listed('NTFY_TOKEN')), { record: other.record() })).ok, true);
  assert.deepEqual(other.row, { worker: W, pairing: 0, at: 7 }, 'absent: this Worker’s row now');
  const stuck = d1({ worker: W, pairing: 0, at: 1 });
  const r3 = await run(lab, worker((a) => (a[1] === 'list' ? listed('DAYLIGHT_PAIRING') : { status: 1, stdout: '' })), { record: stuck.record() });
  assert.equal(r3.ok, false);
  assert.equal(stuck.row.pairing, 1, 'a delete that failed: it may still be there');
  // v1: DAYLIGHT_PAIRING was uploaded (it is not in the list to remove), so the row says it may hold it.
  const v1 = d1({ worker: W, pairing: 0, at: 1 });
  assert.equal((await run(['NTFY_TOKEN'], worker(() => listed('DAYLIGHT_PAIRING')), { record: v1.record() })).ok, true);
  assert.equal(v1.row.pairing, 1);
  // A row that can't be written never fails the step: a later failed listing then fails safe.
  const ro = d1({ worker: W, pairing: 1, at: 1 }, { fail: true });
  const r4 = await run(lab, worker(() => listed()), { record: ro.record() });
  assert.equal(r4.ok, true);
  assert.doesNotMatch(r4.said, /::(error|warning)/);

  // Before a v1 deploy uploads the pairing code, the row says the Worker may hold it; if it can't, nothing deploys.
  const before = d1({ worker: W, pairing: 0, at: 1 });
  const said = [];
  assert.deepEqual(await beforeUpload({ DAYLIGHT_PAIRING: 'P' }, { record: before.record(), say: (l) => said.push(l), sleep: async () => {} }), { ok: true });
  assert.deepEqual(before.row, { worker: W, pairing: 1, at: 7 });
  const broken = d1({ worker: W, pairing: 0, at: 1 }, { fail: true });
  assert.deepEqual(await beforeUpload({ DAYLIGHT_PAIRING: 'P' }, { record: broken.record(), say: (l) => said.push(l), sleep: async () => {} }), { ok: false });
  assert.equal(broken.queries, 3, 'tried three times');
  assert.deepEqual(await beforeUpload({ DAYLIGHT_PAIRING: 'P' }, { record: null, say: (l) => said.push(l), sleep: async () => {} }), { ok: false });
  assert.match(said.join('\n'), /^::error title=Worker secrets::Couldn’t record in D1 that the Worker gets DAYLIGHT_PAIRING/m);
  const labPut = d1(null, { fail: true });
  assert.deepEqual(await beforeUpload({ ANTHROPIC_API_KEY: 'sk' }, { record: labPut.record() }), { ok: true });
  assert.equal(labPut.queries, 0, 'a Lab deploy writes nothing before it');

  // The workflow hands the deploy step setup.mjs's new_worker; WORKER_NAME and D1_ID come from the job's environment.
  const wf = workflow();
  const deployStep = wf.slice(wf.indexOf('- name: Deploy the Worker with its secrets'), wf.indexOf('- name: Remove the Workers of earlier'));
  assert.match(deployStep, /^\s+NEW_WORKER: \$\{\{ steps\.setup\.outputs\.new_worker \}\}/m);
  assert.match(deployStep, /^\s+CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/m);
  assert.match(wf, /echo "D1_ID=\$id" >> "\$GITHUB_ENV"/);
  assert.ok(fs.readdirSync(path.join(root, 'migrations')).includes('0005_deploy.sql'));
});

test('change check: against the last deployed commit (a cancelled pending run’s change still ships), and the share/js the Worker bundles', async () => {
  const { serverChanged, bundledShareFiles } = await import('../scripts/changes.mjs');
  assert.deepEqual(bundledShareFiles(root), ['reader-experiment/share/js/daylight-share.js'], 'what src/ and client/ import from share/js');
  const REPO = '12twelve12hi/MHW';
  // Run A deployed commit A; run B (a push of src/feeds.ts) was cancelled while pending; this is run C's push (B..C
  // touches share/js/daylight-lab.js only).
  const github = ({ files, runs, jobs = {}, fail = '' }) => {
    const calls = [];
    const fetchFn = async (url) => {
      const u = new URL(url);
      calls.push(u.pathname + u.search);
      if (fail && u.pathname.includes(fail)) return new Response('{}', { status: 502 });
      if (u.pathname === `/repos/${REPO}/actions/workflows/rx-server.yml/runs`) return Response.json({ workflow_runs: runs });
      const m = /\/actions\/runs\/(\d+)\/jobs$/.exec(u.pathname);
      if (m) return Response.json({ jobs: jobs[m[1]] ?? [] });
      const c = /\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(u.pathname);
      if (c) return Response.json({ files: (files[c[1]] ?? []).map((filename) => ({ filename })) });
      return new Response('{}', { status: 404 });
    };
    return { calls, fetchFn };
  };
  const deployed = [{ name: 'Deploy to Cloudflare (when the secrets exist)', steps: [{ name: 'Deploy the Worker with its secrets', conclusion: 'success', completed_at: '2026-10-01T10:04:00Z' }] }];
  const testedOnly = [{ name: 'Deploy to Cloudflare (when the secrets exist)', steps: [{ name: 'Deploy the Worker with its secrets', conclusion: 'skipped', completed_at: '2026-10-02T10:04:00Z' }] }];
  const runs = [
    { id: 3, head_sha: 'bbbb', conclusion: 'cancelled', status: 'completed', created_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:00:30Z' },
    { id: 2, head_sha: 'aaa1', conclusion: 'success', status: 'completed', created_at: '2026-10-02T10:00:00Z', updated_at: '2026-10-02T10:05:00Z' },
    { id: 1, head_sha: 'aaaa', conclusion: 'success', status: 'completed', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:05:00Z' },
  ];
  const jobs = { 2: testedOnly, 1: deployed };
  const check = (gh, over = {}) => serverChanged({ event: 'push', sha: 'cccc', repo: REPO, branch: 'claude/sweet-goldberg-ej1nb0', token: 't', api: 'https://api.github.test', root, fetchFn: gh.fetchFn, ...over });
  const scenario = github({ runs, jobs, files: { aaaa: ['reader-experiment/server/src/feeds.ts', 'reader-experiment/share/js/daylight-lab.js'] } });
  const r = await check(scenario);
  assert.equal(r.changed, true, r.reason);
  assert.equal(r.base, 'aaaa', 'the last run whose deploy step ran, not the last green run');
  assert.ok(scenario.calls.some((c) => c.includes('/compare/aaaa...cccc')));
  assert.ok(scenario.calls.some((c) => c.includes('/runs/3/jobs')), 'the cancelled run had no jobs, so it is passed over');
  const only = async (fileList) => (await check(github({ runs, jobs, files: { aaaa: fileList } }))).changed;
  assert.equal(await only(['reader-experiment/share/js/daylight-lab.js', 'reader-experiment/server/README.md']), false, 'tested, not deployed');
  assert.equal(await only(['reader-experiment/share/js/daylight-share.js']), true, 'the Worker bundles it');
  assert.equal(await only(['.github/workflows/rx-server.yml']), true);
  assert.equal(await only(['reader-experiment/server/migrations/0004_holds.sql']), true);
  assert.equal(await only([]), false);
  // Safe answers: never deployed, an API error, a manual run or a re-run all deploy.
  assert.equal((await check(github({ runs, jobs: { 2: testedOnly, 1: testedOnly }, files: {} }))).changed, true);
  assert.equal((await check(github({ runs, jobs, files: {}, fail: '/compare/' }))).changed, true);
  assert.equal((await check(github({ runs, jobs, files: {}, fail: '/runs' }))).changed, true);
  assert.equal((await check(github({ runs, jobs, files: {} }), { event: 'workflow_dispatch' })).changed, true);
  // The workflow runs it in place of the push's own compare.
  const wf = workflow();
  const step = wf.slice(wf.indexOf('- name: Did the server change'), wf.indexOf('\n  ntfy-attach:'));
  assert.match(step, /run: node scripts\/changes\.mjs/);
  assert.doesNotMatch(wf, /github\.event\.before/);
  assert.match(wf.slice(wf.indexOf('\n  test:'), wf.indexOf('\n  ntfy-attach:')), /actions: read/);
});

test('change check: the base is the commit whose deploy step finished last, so Re-run all jobs on an older run counts', async () => {
  const { serverChanged } = await import('../scripts/changes.mjs');
  const REPO = '12twelve12hi/MHW';
  const calls = [];
  const deploy = (...steps) => [
    { name: 'Build and test', steps: [] },
    { name: 'Deploy to Cloudflare (when the secrets exist)', steps: steps.map(([conclusion, completed_at]) => ({ name: 'Deploy the Worker with its secrets', conclusion, completed_at })) },
  ];
  // Run 21 (commit bbbb) deployed on Oct 10. On Oct 12 someone chose Re-run all jobs on run 20 (commit aaaa, Oct 1),
  // whose second attempt deployed aaaa: that is live, without bbbb's change to src/feeds.ts. This push (cccc) changes
  // only a README since bbbb, but the server must deploy.
  const day = (d, t = '09:00:00') => `2026-${d}T${t}Z`;
  const runs = [
    { id: 22, run_number: 22, head_sha: 'dddd', created_at: day('10-13'), updated_at: day('10-13', '09:02:00') },
    { id: 21, run_number: 21, head_sha: 'bbbb', created_at: day('10-10'), updated_at: day('10-10', '09:06:00') },
    { id: 20, run_number: 20, head_sha: 'aaaa', created_at: day('10-01'), updated_at: day('10-12', '09:06:00') },
    { id: 19, run_number: 19, head_sha: '9999', created_at: day('09-30'), updated_at: day('09-30', '09:06:00') },
    // A full page: 96 runs from July, then a second page the search never needs.
    ...Array.from({ length: 96 }, (_, i) => ({ id: 100 + i, run_number: 18 - i, head_sha: '7777', created_at: day('07-01'), updated_at: day('07-01', '09:06:00') })),
  ];
  const jobs = {
    22: deploy(['skipped', day('10-13', '09:02:00')]),
    21: deploy(['success', day('10-10', '09:05:00')]),
    20: deploy(['success', day('10-01', '09:05:00')], ['success', day('10-12', '09:05:00')]),
    19: deploy(['success', day('09-30', '09:05:00')]),
  };
  const files = { bbbb: ['reader-experiment/server/README.md'], aaaa: ['reader-experiment/server/src/feeds.ts', 'reader-experiment/server/README.md'], dddd: [] };
  const check = (over = {}) => {
    calls.length = 0;
    const j = { ...jobs, ...over.jobs };
    const fetchFn = async (url) => {
      const u = new URL(url);
      calls.push(u.pathname + u.search);
      if (u.pathname === `/repos/${REPO}/actions/workflows/rx-server.yml/runs`) {
        const page = Number(u.searchParams.get('page') ?? 1), per = Number(u.searchParams.get('per_page') ?? 30);
        return Response.json({ total_count: runs.length + 1, workflow_runs: [...runs, { id: 999, head_sha: '6666', created_at: day('06-01') }].slice((page - 1) * per, page * per) });
      }
      const m = /\/actions\/runs\/(\d+)\/jobs$/.exec(u.pathname);
      if (m) return Response.json({ jobs: j[m[1]] ?? deploy(['skipped', day('07-01')]) });
      const c = /\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(u.pathname);
      if (c) return Response.json({ files: (files[c[1]] ?? []).map((filename) => ({ filename })) });
      return new Response('{}', { status: 404 });
    };
    return serverChanged({ event: 'push', sha: 'cccc', repo: REPO, branch: 'claude/sweet-goldberg-ej1nb0', token: 't', api: 'https://api.github.test', root, fetchFn });
  };
  const r = await check();
  assert.equal(r.base, 'aaaa', 'the re-run of run 20 deployed after run 21');
  assert.equal(r.changed, true, r.reason);
  assert.ok(calls.some((c) => c.includes('/compare/aaaa...cccc')));
  assert.ok(calls.some((c) => /[?&]filter=all/.test(c)), 'jobs of every attempt');
  // Bounded: run 19 was last updated before Oct 12, so it can't have deployed later (its jobs aren't read); the July
  // runs started over 31 days before, too long ago for a re-run, which ends the search (no second page).
  assert.ok(!calls.some((c) => /\/runs\/(19|1\d\d)\/jobs/.test(c)), calls.join('\n'));
  assert.deepEqual(calls.filter((c) => c.includes('/workflows/rx-server.yml/runs')).map((c) => new URL(c, 'https://x').searchParams.get('page')), ['1']);

  // A later deploy is the base again: run 22 deploying dddd on Oct 13.
  const later = await check({ jobs: { 22: deploy(['success', day('10-13', '09:01:00')]) } });
  assert.deepEqual([later.base, later.changed], ['dddd', false], later.reason);
  // The deploy step that finished last failed or was cancelled: what is live isn't known, so the push deploys.
  for (const conclusion of ['failure', 'cancelled']) {
    const failed = await check({ jobs: { 22: deploy([conclusion, day('10-13', '09:01:00')]) } });
    assert.deepEqual([failed.changed, failed.base], [true, null]);
    assert.match(failed.reason, /the last deploy \(run 22\) didn’t finish|the last deploy \(run 22\) didn't finish/);
  }
  // A deploy step without its end time: doubt.
  assert.equal((await check({ jobs: { 22: deploy(['success', null]) } })).changed, true);
});
