// CI helper for the deploy job (DESIGN.md 3.5, 12.4): the Worker's name and address, and, without the secret
// DAYLIGHT_SERVER_CODE, the one-time setup link. The repo is public, so Actions logs are world-readable: the setup
// link, its secret and token, the Server code an app sent, the Worker's name and its address are masked with
// ::add-mask:: before anything else and never printed; they reach later steps only through files in $RUNNER_TEMP
// (mode 0600).
//
//   node scripts/setup.mjs
//
// With WORKER_NAME set (the gate found DAYLIGHT_SERVER_CODE or, for v1 delivery, DAYLIGHT_PAIRING) it only finds the
// workers.dev address. Without it, it reads the `setup` row in D1 and:
//   - no row, or the server was locked when a device re-paired, or NEW_SETUP_LINK=true on a run's first attempt: a new
//     Worker name and a new setup link (the old Worker is removed later in the job). A re-run replays the run's inputs,
//     so "Re-run all jobs" of a manual "New setup link" run (how changed secrets are applied) never rotates again;
//   - a link waiting to be used: the same link (its host refreshed);
//   - a Server code an app sent with the link: that code, for the announce and email steps.
//
// Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_ID, WORKER_NAME (optional), NEW_SETUP_LINK,
// GITHUB_RUN_ATTEMPT (set by GitHub), RUNNER_TEMP.
// Writes WORKER_NAME and SERVER_URL to $GITHUB_ENV; mode (code | setup), setup (none | pending | claimed), reason
// (first | locked | requested | invalid), fingerprint and new_worker (true when this run's deploy creates the Worker: a
// new setup-link name, or a name Cloudflare says it has no Worker for, as for a new DAYLIGHT_SERVER_CODE; secrets.mjs
// remove then knows it holds only what was uploaded) to $GITHUB_OUTPUT; $RUNNER_TEMP/dls-setup-token while a link
// waits, $RUNNER_TEMP/dls-server-code once an app used it.

import fs from 'node:fs';
import path from 'node:path';
import * as ds from '../../share/js/daylight-share.js';
import * as srv from '../client/daylight-server.js';
import { ensureSubdomain } from './cf-check.mjs';

// The test suite points DLS_TEST_CF_API at a local stand-in to run this file as the workflow does (test/e2e-setup).
const API = process.env.DLS_TEST_CF_API || 'https://api.cloudflare.com/client/v4';

/** A D1 query function over the Cloudflare REST API: (sql, params) -> rows. Throws on any failure, saying nothing secret. */
export function cfD1({ account, database, token, fetchFn = fetch }) {
  return async (sql, params = []) => {
    let res, json = {};
    try {
      res = await fetchFn(`${API}/accounts/${account}/d1/database/${database}/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(30_000),
      });
      json = await res.json().catch(() => ({}));
    } catch (e) {
      throw new Error(`D1 query failed (network error ${e?.name ?? ''})`);
    }
    if (res.status !== 200 || json?.success === false) throw new Error(`D1 query failed (HTTP ${res.status})`);
    return json?.result?.[0]?.results ?? [];
  };
}

/**
 * Whether the account has no Worker called `name`, so this run's deploy creates it. Only Cloudflare's "This Worker does
 * not exist on your account" (HTTP 404 with code 10007, how wrangler tells) says so. Anything else (the Worker, another
 * error, no network) is false, which is safe: secrets.mjs remove then treats it as a Worker that may hold what an
 * earlier deploy gave it.
 */
export async function workerMissing({ account, token, name, fetchFn = fetch, api = API }) {
  try {
    const res = await fetchFn(`${api}/accounts/${account}/workers/services/${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json().catch(() => ({}));
    return res.status === 404 && json?.success === false && Array.isArray(json.errors) && json.errors.some((e) => e?.code === 10007);
  } catch { return false; }
}

const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/**
 * Decides what this deploy does about the setup link (pure, apart from `query`, the D1 query function).
 * -> {state: 'pending' | 'claimed', worker, secret (16 bytes, pending), code (claimed), fingerprint (claimed),
 *     rotate (a new worker and link to write), reason}
 */
export async function planSetup({ query, newLink = false, random = randomBytes }) {
  const [row] = await query('SELECT worker, link, code FROM setup WHERE id = 1');
  const [lockRow] = await query("SELECT v FROM settings WHERE k = 'lock'");
  let lock = null;
  try { lock = lockRow ? JSON.parse(lockRow.v) : null; } catch { lock = null; }
  let claimed = null;
  if (row?.code) { try { claimed = await srv.parseServerCode(row.code); } catch { claimed = null; } }
  const fingerprint = claimed ? (await srv.deriveServerValues(claimed.seed)).fingerprint : null;
  const locked = !!(fingerprint && lock?.fingerprint === fingerprint);
  const validWorker = typeof row?.worker === 'string' && /^daylight-[0-9a-f]{12}$/.test(row.worker);
  if (validWorker && !newLink && claimed && !locked) {
    return { state: 'claimed', worker: row.worker, code: row.code, fingerprint, rotate: false, reason: null };
  }
  if (validWorker && !newLink && !row.code && row.link) {
    try {
      const { secret } = await srv.parseSetupLink(row.link);
      return { state: 'pending', worker: row.worker, secret, rotate: false, reason: null };
    } catch { /* a link that does not parse is replaced */ }
  }
  const reason = !row ? 'first' : newLink ? 'requested' : locked ? 'locked' : 'invalid';
  return { state: 'pending', worker: `daylight-${ds.toHex(random(6))}`, secret: random(16), rotate: true, reason };
}

/**
 * Writes the setup row for a pending plan once the Worker's origin is known. A new link replaces the row (and any code
 * in it: the server was locked, or a new link was asked for). An unchanged link only refreshes its host, and only
 * while nobody has used it, so an app that used the link meanwhile is never undone. -> {link, state} where state is
 * 'claimed' when an app used the link between the plan and this write.
 */
export async function writeSetup({ query, plan, origin, now = Date.now() }) {
  const link = await srv.formatSetupLink(origin, plan.secret);
  if (plan.rotate) {
    await query('INSERT OR REPLACE INTO setup (id, worker, link, code, created, claimed) VALUES (1, ?1, ?2, NULL, ?3, NULL)', [plan.worker, link, now]);
  } else {
    await query('UPDATE setup SET link = ?1 WHERE id = 1 AND worker = ?2 AND code IS NULL AND link IS NOT ?1', [link, plan.worker]);
  }
  const [row] = await query('SELECT link, code FROM setup WHERE id = 1');
  if (row?.code) return { link: null, state: 'claimed', code: row.code };
  return { link, state: 'pending' };
}

/** NEW_SETUP_LINK counts on a run's first attempt only (GITHUB_RUN_ATTEMPT 1, or unset outside Actions). */
export const wantsNewLink = (env) => env.NEW_SETUP_LINK === 'true' && (env.GITHUB_RUN_ATTEMPT ?? '1') === '1';

/** Every form of a secret value worth masking. */
function masks(values) {
  const out = new Set();
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (s.length < 4) continue;
    out.add(s); out.add(s.toUpperCase()); out.add(s.toLowerCase()); out.add(s.replace(/[\s-]/g, ''));
  }
  return [...out].filter((s) => s.length >= 4);
}

async function main() {
  const env = process.env;
  const say = (line) => console.log(line);
  const mask = (...v) => { for (const m of masks(v)) say(`::add-mask::${m}`); };
  const out = (k, v) => { if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`); };
  const setEnv = (k, v) => { if (env.GITHUB_ENV) fs.appendFileSync(env.GITHUB_ENV, `${k}=${v}\n`); };
  const tmp = (name, value) => fs.writeFileSync(path.join(env.RUNNER_TEMP ?? '.', name), value, { mode: 0o600 });
  const account = env.CLOUDFLARE_ACCOUNT_ID, token = env.CLOUDFLARE_API_TOKEN;
  let worker = (env.WORKER_NAME ?? '').trim();
  let plan = null;
  if (!worker) {
    const query = cfD1({ account, database: env.D1_ID, token });
    plan = await planSetup({ query, newLink: wantsNewLink(env) });
    worker = plan.worker;
  }
  mask(worker, worker.slice('daylight-'.length));
  const { subdomain, created } = await ensureSubdomain({ account, token, api: API });
  const host = `${worker}.${subdomain}.workers.dev`;
  mask(subdomain, host, `https://${host}`);
  setEnv('WORKER_NAME', worker);
  setEnv('SERVER_URL', `https://${host}`);
  say(created ? 'Created a workers.dev subdomain for this account.' : 'workers.dev subdomain: ok.');
  // A new setup-link name is new; any other name (a Server code's, or a setup row's whose deploy may have failed) is
  // new only when Cloudflare says it has no such Worker.
  out('new_worker', String(!!plan?.rotate || await workerMissing({ account, token, name: worker, api: API })));
  if (!plan) {
    out('mode', 'code'); out('setup', 'none');
    return;
  }
  out('mode', 'setup');
  let state = plan.state, code = plan.code ?? null;
  if (state === 'pending') {
    // Mask before the link exists anywhere: the secret, its base32 forms and the token.
    const setupToken = await srv.deriveSetupToken(plan.secret);
    mask(ds.toHex(plan.secret), setupToken);
    const link = await srv.formatSetupLink(`https://${host}`, plan.secret);
    const frag = link.split('#')[1];
    mask(link, frag, frag.slice('SETUP-'.length), link.toLowerCase());
    const w = await writeSetup({ query: cfD1({ account, database: env.D1_ID, token }), plan, origin: `https://${host}` });
    state = w.state;
    if (state === 'pending') tmp('dls-setup-token', setupToken);
    else code = w.code;
  }
  if (state === 'claimed') {
    mask(code);
    for (const k of ['c', 'k']) { const v = new RegExp(`[?&]${k}=([^&#]+)`).exec(code)?.[1]; if (v) mask(v, decodeURIComponent(v)); }
    const parsed = await srv.parseServerCode(code);
    const values = await srv.deriveServerValues(parsed.seed);
    mask(ds.toHex(parsed.seed), await srv.formatServerCode(parsed.seed), values.authToken, values.configTopic, values.itemTopic, values.ackTopic, values.emailToken);
    tmp('dls-server-code', code);
    out('fingerprint', srv.showFingerprint(values.fingerprint));
  }
  out('setup', state);
  out('reason', plan.reason ?? '');
  say(state === 'claimed' ? 'Setup: an app has given the server its Server code.'
    : plan.rotate ? `Setup: a new setup link (${plan.reason}).` : 'Setup: the setup link is still waiting to be used.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (e) {
    // Messages from this file name no secret; anything else is not printed.
    const msg = /^(D1 query failed|Couldn.t read the account|Creating a workers\.dev)/.test(e?.message ?? '') ? e.message : 'setup.mjs failed (details are not printed, because they could contain a secret).';
    console.log(`::error title=Daylight server setup::${msg}`);
    process.exit(1);
  }
}
