// CI helper for the deploy job (DESIGN.md 12.4). The repo is public, so Actions logs are world-readable: every form of
// the codes and every derived value is masked with ::add-mask:: before anything else, input is never echoed (not even
// in an error), and the summary holds only the fingerprint, the states and the next step.
//
//   node scripts/derive.mjs gate             validates the secrets; writes ok, mode (code | setup), fingerprint and
//                                            delivery to $GITHUB_OUTPUT, and WORKER_NAME to $GITHUB_ENV when a Server
//                                            code is known. Missing Cloudflare secrets: a notice, ok=false, exit 0.
//                                            Without DAYLIGHT_SERVER_CODE the deploy makes a setup link (setup.mjs).
//   node scripts/derive.mjs email <file>     writes the email-in address to <file> (mode 0600; masked first); no file
//                                            before setup
//   node scripts/derive.mjs announce <url>   the post-deploy smoke test (hello, CORS, unauthenticated requests refused),
//                                            then, with a Server code, publishes the config frame from the runner and
//                                            calls /v1/admin/announce and the CPU canary; appends the summary (Markdown)
//                                            to $GITHUB_STEP_SUMMARY and exits 1 when the live Worker fails a check
//
// Workflow commands (::add-mask:: first of all) go to stdout, which the runner reads; so stdout is never redirected
// into a summary or captured into a variable: the summary and the address are written to files.
//
// Environment: DAYLIGHT_SERVER_CODE (or the file DLS_SERVER_CODE_FILE, default $RUNNER_TEMP/dls-server-code: the code an
// app sent with the setup link),
// DAYLIGHT_PAIRING, DELIVERY (lab | v1), HAS_TOKEN, HAS_ACCOUNT, DAYLIGHT_EMAIL_DOMAIN, DAYLIGHT_EMAIL_LOCAL,
// DAYLIGHT_EMAIL_SALT, NTFY_TOKEN; for announce also SETUP (none | pending | claimed), SETUP_REASON and R2 (on | off).

import fs from 'node:fs';
import * as ds from '../../share/js/daylight-share.js';
import * as srv from '../client/daylight-server.js';

const say = (line) => console.log(line);
const outTo = (env) => (k, v) => { if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const mask = (v) => { const s = String(v ?? '').trim(); if (s.length >= 4) say(`::add-mask::${s}`); };
const fail = (msg) => { say(`::error title=Daylight server::${msg}`); process.exit(1); };

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

/** The Server code: the secret, else the one an app sent with the setup link (a file setup.mjs wrote). */
function serverCodeOf(env) {
  const fromSecret = (env.DAYLIGHT_SERVER_CODE ?? '').trim();
  if (fromSecret) return fromSecret;
  const file = env.DLS_SERVER_CODE_FILE || (env.RUNNER_TEMP ? `${env.RUNNER_TEMP}/dls-server-code` : '');
  try { return file ? fs.readFileSync(file, 'utf8').trim() : ''; } catch { return ''; }
}

/** -> {seed, relay, token, delivery, pairing?} or exits with an error; null when no Server code is known. */
export async function resolve(env = process.env, { quiet = false } = {}) {
  const codeRaw = serverCodeOf(env);
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
    say('::warning title=DAYLIGHT_PAIRING is not uploaded::DAYLIGHT_PAIRING is set but the repo variable DAYLIGHT_DELIVERY is not v1, so the server does not get your pairing code. Remove the secret, or set DAYLIGHT_DELIVERY=v1 to opt in to v1 delivery.');
  } else if (wantsV1 && !quiet) {
    say('::warning title=v1 delivery needs DAYLIGHT_PAIRING::The repo variable DAYLIGHT_DELIVERY is v1 but the secret DAYLIGHT_PAIRING is missing, so the server uses Lab delivery.');
  }
  const chosen = fromPairing ?? fromCode;
  if (!chosen) return null;
  const values = await srv.deriveServerValues(chosen.seed, { emailSalt: env.DAYLIGHT_EMAIL_SALT ?? '' });
  const emailAddr = emailAddress(values, env);
  await maskValues(chosen.seed, values, emailAddr);
  return {
    ...chosen, values, emailAddr, delivery: fromPairing ? 'v1' : 'lab',
    token: (env.NTFY_TOKEN ?? '').trim() || fromCode?.token || '',
    relay: chosen.relay,
  };
}

export function emailAddress(values, env = process.env) {
  const domain = (env.DAYLIGHT_EMAIL_DOMAIN ?? '').trim().toLowerCase();
  if (!domain) return null;
  const local = (env.DAYLIGHT_EMAIL_LOCAL ?? '').trim().toLowerCase();
  return `${/^[a-z0-9][a-z0-9.-]{2,39}$/.test(local) ? local : `daylight-${values.emailToken}`}@${domain}`;
}

async function gate(env) {
  const out = outTo(env);
  const r = await resolve(env);
  const missing = [];
  if (env.HAS_TOKEN !== 'true') missing.push('CLOUDFLARE_API_TOKEN');
  if (env.HAS_ACCOUNT !== 'true') missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (missing.length) {
    const msg = `The Daylight server is built and tested but not deployed. Add ${missing.join(' and ')} in GitHub › Settings › Secrets and variables › Actions, then open this run and choose Re-run all jobs.`;
    say(`::notice title=Daylight server not deployed::${msg}`);
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `### Daylight server\n\n${msg}\n\nNext: add ${missing[0]}.\n`);
    out('ok', 'false');
    return;
  }
  const local = (env.DAYLIGHT_EMAIL_LOCAL ?? '').trim();
  if (local && (local.length < 12 || !/\d/.test(local))) {
    say('::warning title=DAYLIGHT_EMAIL_LOCAL is easy to guess::Use at least 12 characters including a digit, or leave it out to use the derived address.');
  }
  if (local && !/^[a-z0-9][a-z0-9.-]{2,39}$/i.test(local)) say('::warning::DAYLIGHT_EMAIL_LOCAL is not a valid local part; the derived address is used.');
  out('ok', 'true');
  if (!r) {
    out('mode', 'setup');
    out('delivery', 'lab');
    say('No DAYLIGHT_SERVER_CODE: the deploy makes or keeps a one-time setup link for the apps.');
    return;
  }
  out('mode', 'code');
  out('fingerprint', srv.showFingerprint(r.values.fingerprint));
  out('delivery', r.delivery);
  if (env.GITHUB_ENV) fs.appendFileSync(env.GITHUB_ENV, `WORKER_NAME=${r.values.workerName}\n`);
  say(`Server code fingerprint ${srv.showFingerprint(r.values.fingerprint)}, delivery: ${r.delivery}.`);
}

async function email(env, file) {
  if (!file) fail('usage: derive.mjs email <file>');
  const r = await resolve(env, { quiet: true });
  if (!r?.emailAddr) return;
  fs.writeFileSync(file, r.emailAddr, { mode: 0o600 });
}

const sleepMs = (ms) => new Promise((res) => setTimeout(res, ms));

async function call(fetchFn, url, path, init = {}, token) {
  const headers = { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  try {
    const res = await fetchFn(`${url}${path}`, { ...init, headers, signal: AbortSignal.timeout(120_000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text, headers: res.headers };
  } catch { return { status: 0, json: null, text: '', headers: new Headers() }; }
}

const STATE_WORDS = {
  ready: 'ready', 'needs-key': 'needs ANTHROPIC_API_KEY', 'needs-domain': 'needs DAYLIGHT_EMAIL_DOMAIN', 'needs-r2': 'needs R2',
  'needs-lab-inbox': 'waiting for the Lab Inbox on the Daylight', 'needs-paid': 'needs Workers Paid', error: 'error',
};

/**
 * The live Worker's smoke test (12.4). `serverKnown`: the Worker has a Server code (the secret, or one an app sent).
 * -> {up, ok, checks: [{name, ok, detail}]}: GET /v1/hello (waits up to `tries` × 10 s for a new workers.dev
 * address), the CORS preflight, GET /v1/status without a token and with a wrong one (401, or 503 NOT_CONFIGURED before
 * setup; never 200), and POST /v1/setup with a wrong setup token (401, or 404 when no link waits; never 200).
 */
export async function smoke(url, { fetchFn = fetch, sleep = sleepMs, tries = 30, serverKnown = true } = {}) {
  let up = false;
  for (let i = 0; i < tries && !up; i++) {
    const h = await call(fetchFn, url, '/v1/hello');
    up = h.status === 200 && h.json?.service === 'daylight-server';
    if (!up && i < tries - 1) await sleep(10_000);
  }
  if (!up) return { up, ok: false, checks: [{ name: 'hello', ok: false, detail: 'no answer' }] };
  const checks = [{ name: 'hello', ok: true, detail: '200' }];
  const pre = await call(fetchFn, url, '/v1/status', {
    method: 'OPTIONS', headers: { Origin: 'https://example.github.io', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
  });
  const allowHeaders = (pre.headers.get('access-control-allow-headers') ?? '').toLowerCase();
  checks.push({ name: 'CORS', ok: pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*' && allowHeaders.includes('authorization'), detail: String(pre.status) });
  const refused = (r) => r.status === 401 || (!serverKnown && r.status === 503 && r.json?.error?.code === 'NOT_CONFIGURED');
  const none = await call(fetchFn, url, '/v1/status');
  checks.push({ name: 'no token refused', ok: refused(none), detail: String(none.status) });
  const wrong = await call(fetchFn, url, '/v1/status', {}, '0'.repeat(64));
  checks.push({ name: 'wrong token refused', ok: refused(wrong), detail: String(wrong.status) });
  const setup = await call(fetchFn, url, '/v1/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"code":""}' }, 'f'.repeat(64));
  checks.push({ name: 'wrong setup token refused', ok: setup.status === 401 || setup.status === 404, detail: String(setup.status) });
  return { up, ok: checks.every((c) => c.ok), checks };
}

const checksLine = (s) => `Checks: ${s.checks.map((c) => `${c.name} ${c.ok ? 'ok' : `FAILED (${c.detail})`}`).join(' · ')}.`;

const SETUP_STEPS = (reason) => [
  `**Next: give the server your pairing, once.**${reason === 'locked' ? ' (A device re-paired and locked the old server, so this is a new server address and a new link.)' : reason === 'requested' ? ' (You asked for a new setup link: the old one and the old server address no longer work.)' : ''}`,
  '',
  '1. Copy the setup link. It is kept in your Cloudflare account and never shown here, because this repository’s logs are public. Either:',
  '   - [dash.cloudflare.com](https://dash.cloudflare.com) › Storage & Databases › D1 SQL Database › **daylight-server** › Console: run `SELECT link FROM setup;` and copy the link (it starts with `https://daylight-`); or',
  '   - on a computer with Node.js, after `npx wrangler login`: `npx wrangler d1 execute daylight-server --remote --command "SELECT link FROM setup"`.',
  '2. Paste it in the iPhone or Mac app: Lab settings › Daylight server › **Set up with a link**. The link works once. Your other devices and the Daylight then find the server by themselves.',
  '3. Check: the next run of this workflow says “Daylight server is live” with your Server code’s fingerprint, which Lab settings › Daylight server shows too.',
  '',
  'No “Set up with a link” in your app yet? Copy Lab settings › Daylight server › Server code into the repo secret `DAYLIGHT_SERVER_CODE` and run this workflow again instead.',
];

/** The announce step: smoke test, then (with a Server code) config, announce and canary. -> {ok, lines}. */
export async function announce(url, { env = process.env, fetchFn = fetch, sleep = sleepMs, tries = 30 } = {}) {
  if (!url) fail('announce needs the server URL.');
  mask(url);
  mask(new URL(url).hostname);
  const r = await resolve(env, { quiet: true });
  const s = await smoke(url, { fetchFn, sleep, tries, serverKnown: !!r });
  const lines = [];
  if (!s.up) {
    say('::warning title=Daylight server not reachable yet::The Worker did not answer within 5 minutes. A new workers.dev address can take a while: run this workflow again in a few minutes to finish the checks.');
    lines.push('### Daylight server deployed, not reachable yet', '',
      'A new workers.dev address can take a few minutes. Next: in GitHub › Actions, open this run and choose **Re-run all jobs** in a few minutes; it repeats the checks.');
    return { ok: true, lines };
  }
  if (!s.ok) {
    say(`::error title=Daylight server smoke test::${s.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ')}`);
  }
  if (!r) {
    lines.push(`### Daylight server is live: one step left`, '', checksLine(s), `Large files, email-in and PDF AI: ${env.R2 === 'on' ? 'R2 is on' : 'need R2 (optional)'}. AI: ${env.HAS_AI === 'true' ? 'key added' : 'needs ANTHROPIC_API_KEY (optional)'}.`, '', ...SETUP_STEPS(env.SETUP_REASON));
    return { ok: s.ok, lines };
  }
  // The Worker has a Server code: publish the config frame from the runner, which reaches ntfy.sh from GitHub's
  // addresses, then let the Worker publish and poll it, then the CPU canary three times.
  const frame = await srv.buildConfigFrame(r.values, { server: new URL(url).origin, delivery: r.delivery });
  const relay = ds.normalizeRelay(r.relay);
  const q = r.token ? `?auth=${encodeURIComponent(r.token)}` : '';
  let relayStatus = 0;
  try {
    const res = await fetchFn(`${relay}/${r.values.configTopic}${q}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain', Firebase: 'no', Cache: 'yes' }, body: ds.toBase64(frame), signal: AbortSignal.timeout(30_000),
    });
    relayStatus = res.status;
    await res.text();
  } catch { relayStatus = 0; }
  const json = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
  const ann = await call(fetchFn, url, '/v1/admin/announce', { ...json, body: '{}' }, r.values.authToken);
  let killed = false;
  for (let i = 0; i < 3; i++) {
    const st = await call(fetchFn, url, '/v1/admin/selftest', { ...json, body: '{}' }, r.values.authToken);
    if (st.status === 503 || /1102|exceeded/i.test(st.text) || (st.status >= 500 && !st.json)) killed = true;
  }
  if (killed) await call(fetchFn, url, '/v1/admin/selftest', { ...json, body: '{"result":"killed"}' }, r.values.authToken);
  const statusRes = await call(fetchFn, url, '/v1/status', {}, r.values.authToken);
  const status = statusRes.json ?? {};
  const authed = statusRes.status === 200 && status.fingerprint === r.values.fingerprint;
  if (!authed) say(`::error title=Daylight server smoke test::GET /v1/status with the Server code's token answered ${statusRes.status}.`);
  const f = status.features ?? {};
  const word = (k) => STATE_WORDS[f[k]?.state] ?? f[k]?.state ?? 'unknown';
  const next = status.inbox?.lab === false && r.delivery === 'lab' && f.deliver?.state === 'needs-lab-inbox'
    ? 'open Daylight Share on the Daylight with Lab on, so the server hears from it (feeds, email and “send to my Daylight” wait for that).'
    : f.ai?.state === 'needs-key' ? 'add ANTHROPIC_API_KEY for AI (optional), then run this workflow again.'
      : f.files?.state === 'needs-r2' ? 'turn on R2 in the Cloudflare dashboard for large files, email-in and PDF AI (optional), then Re-run all jobs.'
        : f.email?.state === 'needs-domain' ? 'add DAYLIGHT_EMAIL_DOMAIN for email-in (optional).'
          : f.email?.state === 'needs-paid' ? 'Workers Paid makes email-in reliable (optional).' : 'nothing; everything is set up.';
  lines.push(`### Daylight server is live`, '',
    `Server code fingerprint ${srv.showFingerprint(r.values.fingerprint)} (Lab settings › Daylight server shows the same). Delivery: ${r.delivery === 'v1' ? 'v1 (the server holds your pairing code)' : 'Lab'}.${env.SETUP === 'claimed' ? ' Set up with the setup link.' : ''}`,
    `${checksLine(s)} Token accepted: ${authed ? 'yes' : `no (${statusRes.status})`}.`,
    `AI: ${word('ai')}. Email: ${word('email')}. Feeds: ${word('feeds')}. Large files: ${word('files')}. Lab Inbox: ${status.inbox?.lab ? 'heard from' : 'not heard from yet'}.`,
    `Config from GitHub: ${relayStatus}. Relay from the Worker: ${ann.json?.published ?? ann.status}${ann.json?.listed ? ', listed' : ', not listed'}. CPU canary: ${killed ? 'killed (email-in needs Workers Paid)' : 'ok'}.`,
    '', `Next: ${next}`);
  return { ok: s.ok && authed, lines };
}

const [cmd, arg] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (cmd === 'gate') await gate(process.env);
    else if (cmd === 'email') await email(process.env, arg);
    else if (cmd === 'announce') {
      // The test suite shortens the 5-minute wait for a new address (DLS_TEST_HELLO_TRIES); the workflow never sets it.
      const r = await announce(arg, { tries: Math.max(1, Math.min(30, Number(process.env.DLS_TEST_HELLO_TRIES) || 30)) });
      const md = `${r.lines.join('\n')}\n`;
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
      else say(md);
      say(r.ok ? 'Daylight server: checks passed (the job summary has the details).' : 'Daylight server: a check failed (the job summary has the details).');
      if (!r.ok) process.exitCode = 1;
    } else fail('usage: derive.mjs gate | email | announce <url>');
  } catch {
    fail('derive.mjs failed (details are not printed, because they could contain a secret).');
  }
}
