// CI helper (DESIGN.md 12.0, 12.4): checks the Cloudflare API token before anything is created, and names a missing
// permission in plain words. Writes r2=on|off to $GITHUB_OUTPUT (R2 needs a card on file, so it is optional).
//
//   node scripts/cf-check.mjs                          token, Workers, D1, R2 and (with HAS_EMAIL=true) zone access
//   node scripts/cf-check.mjs drop-ratelimit <toml>    removes the [[ratelimits]] block (an account that refuses it)
//   node scripts/cf-check.mjs subdomain                the account's workers.dev subdomain, created only when the
//                                                      API says there is none; writes SERVER_URL to $GITHUB_ENV
//
// Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, HAS_EMAIL, WORKER_NAME (subdomain).

import fs from 'node:fs';

const API = 'https://api.cloudflare.com/client/v4';
const env = process.env;
const out = (k, v) => { if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const fail = (msg) => { console.log(`::error title=Cloudflare API token::${msg}`); process.exit(1); };

async function cf(path) {
  try {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } catch { return { status: 0, json: {} }; }
}

const codes = (r) => (r.json?.errors ?? []).map((e) => e.code);

/** Removes the [[ratelimits]] table (and its keys) from a wrangler TOML file. */
export function dropRatelimit(toml) {
  const lines = toml.split('\n');
  const outLines = [];
  let skipping = false;
  for (const line of lines) {
    if (/^\s*\[\[ratelimits\]\]\s*$/.test(line)) { skipping = true; continue; }
    if (skipping && /^\s*\[/.test(line)) skipping = false;
    if (!skipping) outLines.push(line);
  }
  return outLines.join('\n');
}

/**
 * The account's workers.dev subdomain. A new random one is created only when the API answers that the account has
 * none (HTTP 404, or 200 without a subdomain). Any other answer (429, 5xx, a network error, 401/403) is retried a few
 * times and then fails the deploy: creating a subdomain while one exists would rename every workers.dev URL on the
 * account, including the Daylight server's own address that the apps pinned and hosted /f/ and /o/ links.
 * -> {subdomain, created}. `fetchFn` and `sleep` are injectable for tests.
 */
export async function ensureSubdomain({ account, token, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random, tries = 4, api = API } = {}) {
  const url = `${api}/accounts/${account}/workers/subdomain`;
  const headers = { Authorization: `Bearer ${token}` };
  let last = '';
  for (let attempt = 1; attempt <= tries; attempt++) {
    let res, json = {};
    try {
      res = await fetchFn(url, { headers, signal: AbortSignal.timeout(30_000) });
      json = await res.json().catch(() => ({}));
    } catch (e) {
      last = `network error (${e?.name ?? 'error'})`;
      if (attempt < tries) await sleep(5000 * attempt);
      continue;
    }
    const sub = json?.result?.subdomain;
    if (res.status === 200 && json?.success !== false && typeof sub === 'string' && sub) return { subdomain: sub, created: false };
    if (res.status === 404 || (res.status === 200 && json?.success !== false && !sub)) {
      const name = `dl-${random ?? [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
      const put = await fetchFn(url, {
        method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ subdomain: name }), signal: AbortSignal.timeout(30_000),
      });
      const pj = await put.json().catch(() => ({}));
      if (put.status !== 200 || pj?.success === false) throw new Error(`Creating a workers.dev subdomain failed (HTTP ${put.status}).`);
      return { subdomain: pj?.result?.subdomain || name, created: true };
    }
    last = `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) break;
    if (attempt < tries) await sleep(5000 * attempt);
  }
  throw new Error(`Couldn't read the account's workers.dev subdomain (${last}); nothing was changed. Re-run the deploy.`);
}

async function subdomainStep() {
  try {
    const { subdomain, created } = await ensureSubdomain({ account: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN });
    const host = `${env.WORKER_NAME}.${subdomain}.workers.dev`;
    console.log(`::add-mask::${subdomain}`);
    console.log(`::add-mask::${host}`);
    if (env.GITHUB_ENV) fs.appendFileSync(env.GITHUB_ENV, `SERVER_URL=https://${host}\n`);
    console.log(created ? 'Created a workers.dev subdomain for this account.' : 'workers.dev subdomain: ok.');
  } catch (e) {
    console.log(`::error title=workers.dev address::${e.message}`);
    process.exit(1);
  }
}

async function check() {
  const acct = env.CLOUDFLARE_ACCOUNT_ID;
  if (!/^[0-9a-f]{32}$/.test(acct ?? '')) fail('CLOUDFLARE_ACCOUNT_ID isn’t an account ID (32 hex characters). Copy it from the Cloudflare dashboard (Workers & Pages › right column).');
  let v = await cf(`/accounts/${acct}/tokens/verify`);
  if (v.status !== 200) v = await cf('/user/tokens/verify');
  if (v.status !== 200 || v.json?.result?.status !== 'active') fail('The API token isn’t valid or active. Create one from the “Edit Cloudflare Workers” template and save it as CLOUDFLARE_API_TOKEN.');
  const workers = await cf(`/accounts/${acct}/workers/scripts`);
  if (workers.status !== 200) fail('The API token can’t edit Workers on this account. Create it from the “Edit Cloudflare Workers” template, for the account in CLOUDFLARE_ACCOUNT_ID.');
  const d1 = await cf(`/accounts/${acct}/d1/database?per_page=1`);
  if (d1.status !== 200) fail('The API token can’t edit D1 databases. Add Account › D1 › Edit to it.');
  const r2 = await cf(`/accounts/${acct}/r2/buckets`);
  let r2on = r2.status === 200;
  if (!r2on && codes(r2).includes(10042)) {
    console.log('::notice title=R2 is off::Large files, email-in and PDF AI need R2. Turn it on in the Cloudflare dashboard (R2; it asks for a card, the free tier isn’t charged), then Re-run all jobs.');
  } else if (!r2on) {
    console.log('::warning title=R2::The API token can’t use R2 (the “Edit Cloudflare Workers” template includes Workers R2 Storage › Edit). Large files, email-in and PDF AI stay off.');
  }
  if (env.HAS_EMAIL === 'true') {
    const z = await cf(`/zones?account.id=${acct}&per_page=1`);
    if (z.status !== 200) console.log('::warning title=Email routing::The API token can’t read zones. For email-in, add Zone › Zone › Read, Zone › Email Routing Rules › Edit and Zone › DNS › Edit for your domain.');
  }
  out('r2', r2on ? 'on' : 'off');
  console.log(`Token ok. Workers: ok. D1: ok. R2: ${r2on ? 'on' : 'off'}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === 'drop-ratelimit') {
    fs.writeFileSync(file, dropRatelimit(fs.readFileSync(file, 'utf8')));
  } else if (cmd === 'subdomain') {
    await subdomainStep();
  } else {
    await check();
  }
}
