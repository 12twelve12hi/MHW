// CI helper (DESIGN.md 12.3): splits the Worker's secrets into the ones to upload (put.json, for
// `wrangler deploy --secrets-file`) and the optional ones that disappeared from GitHub (delete.txt, one name a line,
// deleted from the Worker after the deploy). DAYLIGHT_PAIRING is uploaded only with the variable DELIVERY=v1.
// DAYLIGHT_SETUP_TOKEN is not a GitHub secret: setup.mjs writes it to $RUNNER_TEMP/dls-setup-token while a setup link
// waits to be used (3.5), and it is deleted from the Worker once the link is used or replaced.
//
//   node scripts/secrets.mjs <put.json> <delete.txt>
//   node scripts/secrets.mjs remove <delete.txt> <wrangler config>    (after the deploy: --secrets-file only adds)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

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

/**
 * Deletes from the Worker the named secrets it has. `wrangler(args)` -> {status, stdout} runs `wrangler <args>` for the
 * deploy config. The list and each delete are tried `tries` times (a 429 or 5xx is common, and wrangler does not retry
 * them). A secret that could not be removed, or checked, is a ::warning; for DAYLIGHT_PAIRING it is an ::error and
 * ok=false, because the job summary and the apps would then say the server does not hold the pairing code (3.1) while
 * it does. Prints names only, never wrangler's output. -> {ok, removed, failed}
 */
export async function removeSecrets(names, { wrangler, say = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), tries = 3 }) {
  const attempt = async (args) => {
    for (let i = 0; i < tries; i++) {
      if (i) await sleep(2000 * 2 ** (i - 1));
      const r = await wrangler(args);
      if (r.status === 0) return r;
    }
    return null;
  };
  const want = names.filter(Boolean);
  const removed = [], failed = [];
  if (!want.length) return { ok: true, removed, failed };
  const listing = await attempt(['secret', 'list', '--format', 'json']);
  let existing = null;
  try {
    const text = String(listing?.stdout ?? '');
    existing = new Set(JSON.parse(text.slice(text.indexOf('['))).map((x) => x?.name));
  } catch { existing = null; }
  const problem = (name, why) => {
    failed.push(name);
    if (name === 'DAYLIGHT_PAIRING') {
      say(`::error title=Worker secrets::${why} DAYLIGHT_PAIRING, so the Worker may still hold your pairing code although delivery is Lab. Re-run all jobs; if this repeats, delete it in Cloudflare › Workers & Pages › the daylight- Worker › Settings › Variables and Secrets.`);
    } else {
      say(`::warning title=Worker secrets::${why} ${name}, which is no longer a GitHub secret. Re-run all jobs to try again.`);
    }
  };
  if (!existing) {
    for (const name of want) problem(name, 'Couldn’t list the Worker’s secrets to remove');
    return { ok: !failed.includes('DAYLIGHT_PAIRING'), removed, failed };
  }
  for (const name of want) {
    if (!existing.has(name)) continue;
    if (await attempt(['secret', 'delete', name])) removed.push(name);
    else problem(name, 'Couldn’t remove the Worker secret');
  }
  if (removed.length) say(`Removed from the Worker: ${removed.join(', ')}.`);
  return { ok: !failed.includes('DAYLIGHT_PAIRING'), removed, failed };
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
  const { ok } = await removeSecrets(names, { wrangler });
  process.exit(ok ? 0 : 1);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const [putPath, deletePath] = process.argv.slice(2);
  if (!putPath || !deletePath) { console.log('::error::usage: secrets.mjs <put.json> <delete.txt>'); process.exit(1); }
  const { put, remove } = split(withSetupToken(process.env));
  fs.writeFileSync(putPath, JSON.stringify(put), { mode: 0o600 });
  fs.writeFileSync(deletePath, remove.join('\n') + (remove.length ? '\n' : ''), { mode: 0o600 });
  console.log(`Secrets to upload: ${Object.keys(put).join(', ') || 'none'}. Optional secrets not set: ${remove.join(', ') || 'none'}.`);
}
