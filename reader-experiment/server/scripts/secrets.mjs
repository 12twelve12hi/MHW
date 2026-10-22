// CI helper (DESIGN.md 12.3): splits the Worker's secrets into the ones to upload (put.json, for
// `wrangler deploy --secrets-file`) and the optional ones that disappeared from GitHub (delete.txt, one name a line,
// deleted from the Worker after the deploy). DAYLIGHT_PAIRING is uploaded only with the variable DELIVERY=v1.
// DAYLIGHT_SETUP_TOKEN is not a GitHub secret: setup.mjs writes it to $RUNNER_TEMP/dls-setup-token while a setup link
// waits to be used (3.5), and it is deleted from the Worker once the link is used or replaced.
//
//   node scripts/secrets.mjs <put.json> <delete.txt>

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const [putPath, deletePath] = process.argv.slice(2);
  if (!putPath || !deletePath) { console.log('::error::usage: secrets.mjs <put.json> <delete.txt>'); process.exit(1); }
  const { put, remove } = split(withSetupToken(process.env));
  fs.writeFileSync(putPath, JSON.stringify(put), { mode: 0o600 });
  fs.writeFileSync(deletePath, remove.join('\n') + (remove.length ? '\n' : ''), { mode: 0o600 });
  console.log(`Secrets to upload: ${Object.keys(put).join(', ') || 'none'}. Optional secrets not set: ${remove.join(', ') || 'none'}.`);
}
