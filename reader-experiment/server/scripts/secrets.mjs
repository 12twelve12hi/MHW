// CI helper (DESIGN.md 12.3): splits the Worker's secrets into the ones to upload (put.json, for
// `wrangler deploy --secrets-file`) and the optional ones that disappeared from GitHub (delete.txt, one name a line,
// deleted from the Worker after the deploy). DAYLIGHT_PAIRING is uploaded only with the variable DELIVERY=v1.
// DAYLIGHT_SETUP_TOKEN is not a GitHub secret: setup.mjs writes it to $RUNNER_TEMP/dls-setup-token while a setup link
// waits to be used (3.5), and it is deleted from the Worker once the link is used or replaced.
//
// The D1 `deploy` row (migration 0005) says whether the deployed Worker may hold DAYLIGHT_PAIRING: set before a v1
// deploy uploads it (that deploy stops when it can't be set), cleared once a listing shows the Worker without it. So a
// Lab deploy whose listing keeps failing fails only when the Worker may really still hold the pairing code: not for a
// Worker this run created (NEW_WORKER=true), nor for one whose row says it holds none.
//
//   node scripts/secrets.mjs <put.json> <delete.txt>
//   node scripts/secrets.mjs remove <delete.txt> <wrangler config>    (after the deploy: --secrets-file only adds)
//
// Environment for the D1 row: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_ID, WORKER_NAME; NEW_WORKER (remove).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { cfD1 } from './setup.mjs';

export const WORKER_SECRETS = [
  'DAYLIGHT_SERVER_CODE', 'ANTHROPIC_API_KEY', 'DAYLIGHT_EMAIL_DOMAIN', 'DAYLIGHT_EMAIL_LOCAL', 'DAYLIGHT_EMAIL_SALT', 'NTFY_TOKEN', 'DAYLIGHT_PAIRING',
  'DAYLIGHT_SETUP_TOKEN',
];

/** The environment with DAYLIGHT_SETUP_TOKEN read from DLS_SETUP_TOKEN_FILE (default $RUNNER_TEMP/dls-setup-token). */
export function withSetupToken(env) {
  let token = '';
  const file = env.DLS_SETUP_TOKEN_FILE || (env.RUNNER_TEMP ? `${env.RUNNER_TEMP}/dls-setup-token` : '');
  try { token = file ? fs.readFileSync(file, 'utf8').trim() : ''; } catch { token = ''; }
  return { ...env, DAYLIGHT_SETUP_TOKEN: /^[0-9a-f]{64}$/.test(token) ? token : '' };
}

/** env -> {put: {NAME: value}, remove: [NAME]} */
export function split(env) {
  const put = {};
  const remove = [];
  for (const name of WORKER_SECRETS) {
    const v = (env[name] ?? '').trim();
    const allowed = name !== 'DAYLIGHT_PAIRING' || (env.DELIVERY ?? 'lab') === 'v1';
    if (v && allowed) put[name] = v;
    else remove.push(name);
  }
  if (put.DAYLIGHT_EMAIL_DOMAIN) put.DAYLIGHT_EMAIL_DOMAIN = put.DAYLIGHT_EMAIL_DOMAIN.toLowerCase();
  return { put, remove };
}

const PAIRING = 'DAYLIGHT_PAIRING';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** fn() up to `tries` times, 2 s then 4 s apart: its first result other than null; null when every try failed or threw. */
async function retry(fn, { tries, sleep }) {
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(2000 * 2 ** (i - 1));
    try {
      const r = await fn();
      if (r !== null && r !== undefined) return r;
    } catch { /* tried again */ }
  }
  return null;
}

/**
 * The D1 `deploy` row (migration 0005) about `worker`, over `query` (setup.mjs's cfD1; a D1 binding in tests).
 * mayHold() is false only when the row names this Worker and says it holds no DAYLIGHT_PAIRING: no row, another
 * Worker's row, a row that says it may, or a D1 error all leave it true. set(mayHold) writes the row, or throws.
 */
export function pairingRecord({ query, worker, now = () => Date.now() }) {
  return {
    async mayHold() {
      try {
        const [row] = await query('SELECT worker, pairing FROM deploy WHERE id = 1');
        return !(row && row.worker === worker && Number(row.pairing) === 0);
      } catch { return true; }
    },
    async set(mayHold) {
      await query('INSERT OR REPLACE INTO deploy (id, worker, pairing, at) VALUES (1, ?1, ?2, ?3)', [worker, mayHold ? 1 : 0, now()]);
    },
  };
}

/** The deploy row for $WORKER_NAME over the Cloudflare API, or null without the names it needs. */
export function recordFromEnv(env) {
  const worker = (env.WORKER_NAME ?? '').trim();
  if (!worker || !env.D1_ID || !env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return null;
  return pairingRecord({ query: cfD1({ account: env.CLOUDFLARE_ACCOUNT_ID, database: env.D1_ID, token: env.CLOUDFLARE_API_TOKEN }), worker });
}

/**
 * Before a deploy that uploads DAYLIGHT_PAIRING (DELIVERY=v1): the row says "may hold" first, so no later Lab deploy
 * whose listing fails takes this Worker for one without it. When the row can't be written (tried `tries` times) the
 * deploy must not go ahead: an ::error and ok=false. -> {ok}
 */
export async function beforeUpload(put, { record, say = console.log, sleep = pause, tries = 3 }) {
  if (!put[PAIRING]) return { ok: true };
  if (record && await retry(async () => { await record.set(true); return true; }, { tries, sleep })) return { ok: true };
  say('::error title=Worker secrets::Couldn’t record in D1 that the Worker gets DAYLIGHT_PAIRING (delivery v1), so nothing was deployed. Re-run all jobs.');
  return { ok: false };
}

/**
 * Deletes from the Worker the named secrets it has. `wrangler(args)` -> {status, stdout} runs `wrangler <args>` for the
 * deploy config. The list and each delete are tried `tries` times (a 429 or 5xx is common, and wrangler does not retry
 * them). A secret that could not be removed, or checked, is a ::warning; for DAYLIGHT_PAIRING it is an ::error and
 * ok=false, because the job summary and the apps would then say the server does not hold the pairing code (3.1) while
 * it does. Not when the Worker can't hold it: `newWorker` (this run's deploy created it, with put.json alone, so it
 * holds none of `names`) or a `record` that says so (Lab deploys never upload it). The record is updated from what
 * the listing shows. Prints names only, never wrangler's output. -> {ok, removed, failed}
 */
export async function removeSecrets(names, { wrangler, say = console.log, sleep = pause, tries = 3, newWorker = false, record = null }) {
  const attempt = (args) => retry(async () => { const r = await wrangler(args); return r.status === 0 ? r : null; }, { tries, sleep });
  const want = names.filter(Boolean);
  const removed = [], failed = [];
  const checksPairing = want.includes(PAIRING);
  // What the record says after this: DAYLIGHT_PAIRING not in the list was uploaded; null leaves the record as it is.
  let holds = checksPairing ? null : true;
  const problem = (name, why, pairingWhy = '') => {
    failed.push(name);
    if (name === PAIRING) {
      say(`::error title=Worker secrets::${why} DAYLIGHT_PAIRING${pairingWhy}, so the Worker may still hold your pairing code although delivery is Lab. Re-run all jobs; if this repeats, delete it in Cloudflare › Workers & Pages › the daylight- Worker › Settings › Variables and Secrets.`);
    } else {
      say(`::warning title=Worker secrets::${why} ${name}, which is no longer a GitHub secret. Re-run all jobs to try again.`);
    }
  };
  const finish = async () => {
    if (removed.length) say(`Removed from the Worker: ${removed.join(', ')}.`);
    if (record && holds !== null) {
      try { await record.set(holds); } catch { say('Couldn’t record in D1 whether the Worker holds DAYLIGHT_PAIRING; a later deploy whose secret listing fails then fails safe.'); }
    }
    return { ok: !failed.includes(PAIRING), removed, failed };
  };
  if (newWorker) {
    if (want.length) say('Nothing to remove: this run created the Worker, with only the secrets it uploaded.');
    if (checksPairing) holds = false;
    return finish();
  }
  if (!want.length) return finish();
  const listing = await attempt(['secret', 'list', '--format', 'json']);
  let existing = null;
  try {
    const text = String(listing?.stdout ?? '');
    existing = new Set(JSON.parse(text.slice(text.indexOf('['))).map((x) => x?.name));
  } catch { existing = null; }
  if (!existing) {
    const mayHold = checksPairing && (!record || await record.mayHold());
    for (const name of want) {
      if (name !== PAIRING || mayHold) problem(name, 'Couldn’t list the Worker’s secrets to remove', ', and D1 doesn’t show this Worker without it');
    }
    if (checksPairing && !mayHold) say('DAYLIGHT_PAIRING: not on the Worker. Its secrets couldn’t be listed, but D1 shows it without DAYLIGHT_PAIRING since an earlier deploy, and Lab deploys never upload it.');
    return finish();
  }
  for (const name of want) {
    if (!existing.has(name)) continue;
    if (await attempt(['secret', 'delete', name])) removed.push(name);
    else problem(name, 'Couldn’t remove the Worker secret');
  }
  if (checksPairing) holds = failed.includes(PAIRING);
  return finish();
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'remove') {
  const [deletePath, config] = process.argv.slice(3);
  if (!deletePath || !config) { console.log('::error::usage: secrets.mjs remove <delete.txt> <wrangler config>'); process.exit(1); }
  const names = fs.readFileSync(deletePath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const wrangler = async (args) => {
    // CI=true answers wrangler's delete confirmation; its output (names and errors only) is not printed.
    const r = spawnSync('npx', ['wrangler', ...args, '-c', config], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true' } });
    return { status: r.status ?? 1, stdout: r.stdout ?? '' };
  };
  const { ok } = await removeSecrets(names, { wrangler, newWorker: process.env.NEW_WORKER === 'true', record: recordFromEnv(process.env) });
  process.exit(ok ? 0 : 1);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const [putPath, deletePath] = process.argv.slice(2);
  if (!putPath || !deletePath) { console.log('::error::usage: secrets.mjs <put.json> <delete.txt>'); process.exit(1); }
  const { put, remove } = split(withSetupToken(process.env));
  if (!(await beforeUpload(put, { record: recordFromEnv(process.env) })).ok) process.exit(1);
  fs.writeFileSync(putPath, JSON.stringify(put), { mode: 0o600 });
  fs.writeFileSync(deletePath, remove.join('\n') + (remove.length ? '\n' : ''), { mode: 0o600 });
  console.log(`Secrets to upload: ${Object.keys(put).join(', ') || 'none'}. Optional secrets not set: ${remove.join(', ') || 'none'}.`);
}
