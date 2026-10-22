// CI helper for the deploy job (DESIGN.md 12.4). The repo is public, so Actions logs are world-readable: every form of
// the codes and every derived value is masked with ::add-mask:: before anything else, input is never echoed (not even
// in an error), and the summary holds only the fingerprint, the states and the next step.
//
//   node scripts/derive.mjs gate             validates the secrets; writes ok, fingerprint, delivery to $GITHUB_OUTPUT
//                                            and WORKER_NAME to $GITHUB_ENV. Missing secrets: a notice, ok=false, exit 0.
//   node scripts/derive.mjs email            prints the email-in address (masked first)
//   node scripts/derive.mjs announce <url>   waits for the Worker, publishes the config frame from the runner, calls
//                                            /v1/admin/announce and the CPU canary, and prints the summary (Markdown)
//
// Environment: DAYLIGHT_SERVER_CODE, DAYLIGHT_PAIRING, DELIVERY (lab | v1), HAS_TOKEN, HAS_ACCOUNT,
// DAYLIGHT_EMAIL_DOMAIN, DAYLIGHT_EMAIL_LOCAL, DAYLIGHT_EMAIL_SALT, NTFY_TOKEN.

import fs from 'node:fs';
import * as ds from '../../share/js/daylight-share.js';
import * as srv from '../client/daylight-server.js';

const env = process.env;
const out = (k, v) => { if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const setEnv = (k, v) => { if (env.GITHUB_ENV) fs.appendFileSync(env.GITHUB_ENV, `${k}=${v}\n`); };
const mask = (v) => { const s = String(v ?? '').trim(); if (s.length >= 4) console.log(`::add-mask::${s}`); };
const fail = (msg) => { console.log(`::error title=Daylight server::${msg}`); process.exit(1); };

function maskCodeForms(raw) {
  if (!raw) return;
  mask(raw);
  const s = String(raw).trim();
  mask(s.toUpperCase());
  mask(s.replace(/[\s-]/g, ''));
  mask(s.toUpperCase().replace(/[\s\-_.]/g, ''));
  const c = /[?&]c=([^&#]+)/.exec(s)?.[1];
  if (c) { mask(c); mask(decodeURIComponent(c)); }
  const k = /[?&]k=([^&#]+)/.exec(s)?.[1];
  if (k) { mask(k); mask(decodeURIComponent(k)); }
  if (/^SERVER/i.test(s)) mask(s.replace(/^SERVER-?/i, ''));
}

async function maskValues(seed, values, emailAddr) {
  mask(ds.toHex(seed));
  mask(await srv.formatServerCode(seed));
  for (const k of ['authToken', 'configTopic', 'itemTopic', 'ackTopic', 'emailToken', 'workerName']) mask(values[k]);
  mask(values.workerName.slice('daylight-'.length));
  if (emailAddr) { mask(emailAddr); mask(emailAddr.split('@')[0]); }
}

/** -> {seed, relay, token, delivery, pairing?} or exits with an error; null when the code is missing. */
export async function resolve({ quiet = false } = {}) {
  const codeRaw = (env.DAYLIGHT_SERVER_CODE ?? '').trim();
  const pairingRaw = (env.DAYLIGHT_PAIRING ?? '').trim();
  maskCodeForms(codeRaw);
  maskCodeForms(pairingRaw);
  const wantsV1 = (env.DELIVERY ?? 'lab') === 'v1';
  let fromCode = null, fromPairing = null;
  if (codeRaw) {
    try { fromCode = await srv.parseServerCode(codeRaw); } catch (e) {
      if (e?.reason === 'pairing-code') fail('DAYLIGHT_SERVER_CODE holds your pairing code. The server needs the Server code instead (Lab settings › Daylight server › Copy). Replace the secret’s value, then Re-run all jobs.');
      fail('DAYLIGHT_SERVER_CODE isn’t a Server code. Copy it again from Lab settings › Daylight server › Server code, then Re-run all jobs.');
    }
  }
  if (pairingRaw && wantsV1) {
    try {
      const p = await ds.parsePairing(pairingRaw);
      fromPairing = { seed: await srv.deriveServerSeed(p.secret), relay: p.relay, token: '', pairing: p };
      mask(ds.toHex(p.secret));
      const keys = await ds.deriveKeys(p.secret);
      mask(keys.inboxTopic); mask(keys.ackTopic);
    } catch {
      fail('DAYLIGHT_PAIRING isn’t a pairing code. Copy the pairing code from the Daylight again, then Re-run all jobs.');
    }
    if (fromCode && ds.toHex(fromCode.seed) !== ds.toHex(fromPairing.seed)) {
      fail('DAYLIGHT_PAIRING and DAYLIGHT_SERVER_CODE belong to different pairings. Update one of them, then Re-run all jobs.');
    }
  } else if (pairingRaw && !quiet) {
    console.log('::warning title=DAYLIGHT_PAIRING is not uploaded::DAYLIGHT_PAIRING is set but the repo variable DAYLIGHT_DELIVERY is not v1, so the server does not get your pairing code. Remove the secret, or set DAYLIGHT_DELIVERY=v1 to opt in to v1 delivery.');
  }
  const chosen = fromPairing ?? fromCode;
  if (!chosen) return null;
  const values = await srv.deriveServerValues(chosen.seed, { emailSalt: env.DAYLIGHT_EMAIL_SALT ?? '' });
  const emailAddr = emailAddress(values);
  await maskValues(chosen.seed, values, emailAddr);
  return {
    ...chosen, values, emailAddr, delivery: fromPairing ? 'v1' : 'lab',
    token: (env.NTFY_TOKEN ?? '').trim() || fromCode?.token || '',
    relay: chosen.relay,
  };
}

export function emailAddress(values) {
  const domain = (env.DAYLIGHT_EMAIL_DOMAIN ?? '').trim().toLowerCase();
  if (!domain) return null;
  const local = (env.DAYLIGHT_EMAIL_LOCAL ?? '').trim().toLowerCase();
  return `${/^[a-z0-9][a-z0-9.-]{2,39}$/.test(local) ? local : `daylight-${values.emailToken}`}@${domain}`;
}

async function gate() {
  const r = await resolve();
  const missing = [];
  if (env.HAS_TOKEN !== 'true') missing.push('CLOUDFLARE_API_TOKEN');
  if (env.HAS_ACCOUNT !== 'true') missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!r) missing.push((env.DELIVERY ?? 'lab') === 'v1' ? 'DAYLIGHT_SERVER_CODE (or DAYLIGHT_PAIRING)' : 'DAYLIGHT_SERVER_CODE');
  if (missing.length) {
    const msg = `The Daylight server is built and tested but not deployed. Add ${missing.join(', ')} in GitHub › Settings › Secrets and variables › Actions, then open this run and choose Re-run all jobs.`;
    console.log(`::notice title=Daylight server not deployed::${msg}`);
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `### Daylight server\n\n${msg}\n\nNext: add ${missing[0]}.\n`);
    out('ok', 'false');
    return;
  }
  const local = (env.DAYLIGHT_EMAIL_LOCAL ?? '').trim();
  if (local && (local.length < 12 || !/\d/.test(local))) {
    console.log('::warning title=DAYLIGHT_EMAIL_LOCAL is easy to guess::Use at least 12 characters including a digit, or leave it out to use the derived address.');
  }
  if (local && !/^[a-z0-9][a-z0-9.-]{2,39}$/i.test(local)) console.log('::warning::DAYLIGHT_EMAIL_LOCAL is not a valid local part; the derived address is used.');
  out('ok', 'true');
  out('fingerprint', srv.showFingerprint(r.values.fingerprint));
  out('delivery', r.delivery);
  setEnv('WORKER_NAME', r.values.workerName);
  console.log(`Server code fingerprint ${srv.showFingerprint(r.values.fingerprint)}, delivery: ${r.delivery}.`);
}

async function email() {
  const r = await resolve({ quiet: true });
  if (!r?.emailAddr) process.exit(0);
  process.stdout.write(r.emailAddr);
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function call(url, path, init = {}, token) {
  const headers = { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  try {
    const res = await fetch(`${url}${path}`, { ...init, headers, signal: AbortSignal.timeout(120_000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text };
  } catch { return { status: 0, json: null, text: '' }; }
}

const STATE_WORDS = {
  ready: 'ready', 'needs-key': 'needs ANTHROPIC_API_KEY', 'needs-domain': 'needs DAYLIGHT_EMAIL_DOMAIN', 'needs-r2': 'needs R2',
  'needs-lab-inbox': 'waiting for the Lab Inbox on the Daylight', 'needs-paid': 'needs Workers Paid', error: 'error',
};

async function announce(url) {
  const r = await resolve({ quiet: true });
  if (!r || !url) fail('announce needs DAYLIGHT_SERVER_CODE and the server URL.');
  mask(url);
  mask(new URL(url).hostname);
  const lines = [];
  // 1. Wait for the Worker (a new workers.dev subdomain can take minutes to resolve).
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    const h = await call(url, '/v1/hello');
    up = h.status === 200 && h.json?.service === 'daylight-server';
    if (!up) await sleep(10_000);
  }
  // 2. Publish the config frame from the runner, which reaches ntfy.sh from GitHub's addresses.
  const frame = await srv.buildConfigFrame(r.values, { server: new URL(url).origin, delivery: r.delivery });
  const relay = ds.normalizeRelay(r.relay);
  const q = r.token ? `?auth=${encodeURIComponent(r.token)}` : '';
  let relayStatus = 0;
  try {
    const res = await fetch(`${relay}/${r.values.configTopic}${q}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain', Firebase: 'no', Cache: 'yes' }, body: ds.toBase64(frame), signal: AbortSignal.timeout(30_000),
    });
    relayStatus = res.status;
    await res.text();
  } catch { relayStatus = 0; }
  if (!up) {
    console.log('::warning title=Daylight server not reachable yet::The Worker did not answer within 5 minutes. A new workers.dev address can take a while; the Worker announces itself on its next Cron run.');
    lines.push(`Daylight server deployed (not reachable yet). Server code fingerprint ${srv.showFingerprint(r.values.fingerprint)}. Config published from GitHub: ${relayStatus}.`);
    console.log(lines.join('\n'));
    return;
  }
  // 3. The Worker publishes and polls the config topic itself; then the CPU canary three times.
  const ann = await call(url, '/v1/admin/announce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, r.values.authToken);
  let killed = false;
  for (let i = 0; i < 3; i++) {
    const st = await call(url, '/v1/admin/selftest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, r.values.authToken);
    if (st.status === 503 || /1102|exceeded/i.test(st.text) || (st.status >= 500 && !st.json)) killed = true;
  }
  if (killed) await call(url, '/v1/admin/selftest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"result":"killed"}' }, r.values.authToken);
  const status = (await call(url, '/v1/status', {}, r.values.authToken)).json ?? {};
  const f = status.features ?? {};
  const word = (k) => STATE_WORDS[f[k]?.state] ?? f[k]?.state ?? 'unknown';
  const next = f.ai?.state === 'needs-key' ? 'add ANTHROPIC_API_KEY for AI (optional).'
    : f.files?.state === 'needs-r2' ? 'turn on R2 in the Cloudflare dashboard for large files, email-in and PDF AI (optional), then Re-run all jobs.'
      : f.email?.state === 'needs-domain' ? 'add DAYLIGHT_EMAIL_DOMAIN for email-in (optional).'
        : f.deliver?.state === 'needs-lab-inbox' ? 'open Daylight Share on the Daylight with Lab on, so the server hears from it.'
          : f.email?.state === 'needs-paid' ? 'Workers Paid makes email-in reliable (optional).' : 'nothing; everything is set up.';
  lines.push(`### Daylight server is live`, '',
    `Server code fingerprint ${srv.showFingerprint(r.values.fingerprint)}. Delivery: ${r.delivery === 'v1' ? 'v1 (the server holds your pairing code)' : 'Lab'}.`,
    `AI: ${word('ai')}. Email: ${word('email')}. Feeds: ${word('feeds')}. Large files: ${word('files')}.`,
    `Config from GitHub: ${relayStatus}. Relay from the Worker: ${ann.json?.published ?? ann.status}${ann.json?.listed ? ', listed' : ', not listed'}. CPU canary: ${killed ? 'killed (email-in needs Workers Paid)' : 'ok'}.`,
    '', `Next: ${next}`);
  console.log(lines.join('\n'));
}

const [cmd, arg] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (cmd === 'gate') await gate();
    else if (cmd === 'email') await email();
    else if (cmd === 'announce') await announce(arg);
    else fail('usage: derive.mjs gate | email | announce <url>');
  } catch {
    fail('derive.mjs failed (details are not printed, because they could contain a secret).');
  }
}
