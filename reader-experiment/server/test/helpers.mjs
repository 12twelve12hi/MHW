// Test harness: the Worker (the test bundle, built with __TESTING__) in workerd through Miniflare, with in-memory D1
// and R2, the rate-limit binding, and every outbound fetch routed to Node: the mock relay (share's mock relay plus
// Attach:), a mock Claude and per-test web hosts. Node-side code (the protocol Receiver, the client module, a Lab
// Inbox lane) reaches the Worker and the relay through `nodeFetch`.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import * as ds from '../../share/js/daylight-share.js';
import * as srv from '../client/daylight-server.js';
import { startRelay, RELAY_ORIGIN } from './relay.mjs';
import { mockClaude } from './mock-claude.mjs';

export const SERVER = 'https://daylight.test';
export const CLAUDE = 'https://claude.test';
export { RELAY_ORIGIN };
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const BUNDLE = path.join(ROOT, '.build-test', 'index.js');
export const MIGRATIONS = path.join(ROOT, 'migrations');

/** Builds the test bundle unless scripts/test.mjs already did. */
export function ensureBundle() {
  if (fs.existsSync(BUNDLE) && process.env.DLS_SKIP_BUILD) return;
  if (fs.existsSync(BUNDLE)) {
    const newest = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((t, e) => {
      const p = path.join(dir, e.name);
      return Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
    }, 0);
    const src = Math.max(newest(path.join(ROOT, 'src')), newest(path.join(ROOT, 'client')), newest(path.join(ROOT, '..', 'share', 'js')));
    if (fs.statSync(BUNDLE).mtimeMs >= src) return;
  }
  execFileSync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', '.build-test', '--define', '__TESTING__:true', '--no-minify'], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

/** Every migration's statements, in file order (as `wrangler d1 migrations apply` runs them). */
export function migrationStatements() {
  return fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
    .flatMap((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').replace(/--[^\n]*/g, '').split(';'))
    .map((s) => s.trim()).filter(Boolean);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A fixed Worker time for tests that count something per UTC day: 12:00 UTC, an even hour, outside the default 07:00
 * digest. Pass it, plus the test's offsets, as `now` and to `cron`, or give the whole Worker setup({ clock:
 * ticking(NOON) }). The AI, ntfy and email counters reset at 00:00 UTC, so a test that starts from Date.now() fails
 * whenever a later step lands on the next day (rx-server on 82f5f3c ran at 23:47 UTC: T + 25 minutes was the next day).
 * Being in the past, it is never "ahead" for the client (checkConfig refuses a config frame from the future).
 */
export const NOON = Date.parse('2026-10-20T12:00:00Z');
export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
/** A clock that starts at `start` and runs at real speed, for setup({ clock }). */
export function ticking(start) {
  const t0 = Date.now();
  return () => start + (Date.now() - t0);
}

/**
 * Starts a Worker. Options: delivery 'lab' | 'v1', r2, apiKey, emailDomain, plan, knobs (TEST_KNOBS), vars (extra
 * bindings), web (Map host -> handler for outbound fetches), secret (16 bytes), clock (a function -> ms: the Worker's
 * time for every request that names none, the client's and the Receiver's included, and for cron() without one; by
 * default the real time). The email() handler always takes the real time.
 */
export async function setup(opts = {}) {
  ensureBundle();
  const {
    delivery = 'lab', r2 = true, apiKey = 'sk-ant-test-key', emailDomain = 'mail.test', plan = 'free', knobs = {}, vars = {},
    secret = ds.generateSecret(), serverUrl = SERVER, relayOptions = {}, clock = null,
  } = opts;
  const relay = await startRelay(relayOptions);
  const pairing = { secret, relay: RELAY_ORIGIN, name: 'Test Daylight' };
  const seed = await srv.deriveServerSeed(secret);
  const values = await srv.deriveServerValues(seed);
  const keys = await ds.deriveKeys(secret);
  const serverCode = await srv.formatServerCode(seed, { relay: RELAY_ORIGIN });
  const pairingLink = await ds.pairingLink({ secret, relay: RELAY_ORIGIN });
  const claude = mockClaude();
  const web = opts.web ?? new Map();
  // DNS-over-HTTPS (the Worker resolves hosts before writing url items, 9.7): host -> {A, AAAA} | 'nxdomain' | 'fail'.
  // Unlisted names resolve to one public address.
  const dns = opts.dns ?? new Map();
  const dnsLog = [];
  const doh = (req) => {
    const u = new URL(req.url);
    const name = u.searchParams.get('name');
    const type = u.searchParams.get('type');
    dnsLog.push(`${type} ${name}`);
    const rec = dns.get(name) ?? { A: ['93.184.215.14'], AAAA: [] };
    if (rec === 'fail') return new Response('busy', { status: 503 });
    if (rec === 'nxdomain') return Response.json({ Status: 3, Answer: [] });
    const code = type === 'AAAA' ? 28 : 1;
    return Response.json({ Status: 0, Answer: (rec[type] ?? []).map((data) => ({ name, type: code, TTL: 60, data })) });
  };
  const outboundLog = [];
  const outbound = async (req) => {
    const u = new URL(req.url);
    outboundLog.push(`${req.method} ${u.origin}${u.pathname}`);
    if (u.origin === RELAY_ORIGIN) return relay.handle(req);
    if (u.origin === CLAUDE) return claude.handle(req);
    if (u.origin === 'https://cloudflare-dns.com') return doh(req);
    const h = web.get(u.host);
    if (h) return h(req);
    return new Response('no route in the test harness', { status: 502 });
  };
  const bindings = {
    SERVER_URL: serverUrl, DELIVERY: delivery, WORKERS_PLAN: plan, AI_MAX_USD_DAY: '10', AI_MAX_REQ_DAY: '100', GIT_SHA: 'test',
    DAYLIGHT_SERVER_CODE: serverCode,
    ...(delivery === 'v1' ? { DAYLIGHT_PAIRING: pairingLink } : {}),
    ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
    ...(emailDomain ? { DAYLIGHT_EMAIL_DOMAIN: emailDomain } : {}),
    TEST_ANTHROPIC_BASE_URL: CLAUDE,
    TEST_KNOBS: JSON.stringify(knobs),
    ...vars,
  };
  for (const [k, v] of Object.entries(bindings)) if (v === undefined || v === null) delete bindings[k];
  const dbName = `db-${Math.random().toString(16).slice(2)}`;
  const options = (b) => convertV4MiniflareOptions({
    unsafeTriggerHandlers: true,
    modules: true, scriptPath: BUNDLE, compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: dbName },
    ...(r2 ? { r2Buckets: { FILES: 'files' } } : {}),
    ratelimits: { FAILS: { namespace_id: '7301', simple: { limit: 30, period: 60 } } },
    bindings: b,
    outboundService: outbound,
  });
  const mf = new Miniflare(options(bindings));
  let env = await mf.getBindings();
  let db = env.DB;
  await db.batch(migrationStatements().map((s) => db.prepare(s)));

  const dispatch = (url, init = {}) => {
    if (!clock) return mf.dispatchFetch(url, init);
    const headers = new Headers(init.headers);
    if (!headers.has('X-DLS-Test-Now')) headers.set('X-DLS-Test-Now', String(clock()));
    return mf.dispatchFetch(url, { ...init, headers });
  };
  const now = () => (clock ? clock() : Date.now());

  /** Node-side fetch: the Worker's origin through Miniflare, the relay through the mock. */
  const nodeFetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    if (u.origin === new URL(serverUrl).origin) {
      const body = init.body instanceof Uint8Array ? init.body : init.body;
      return dispatch(url, { ...init, body });
    }
    if (u.origin === RELAY_ORIGIN) return relay.handle(url, init);
    if (u.origin === CLAUDE) return claude.handle(url, init);
    const h = web.get(u.host);
    if (h) return h(new Request(url, init));
    throw new TypeError(`no route for ${url}`);
  };

  /** An authenticated API call. -> {status, headers, json, text}. */
  async function api(method, p, { json, body, headers = {}, token = values.authToken, now } = {}) {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (now) h['X-DLS-Test-Now'] = String(now);
    let payload = body;
    if (json !== undefined) { payload = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    if (payload !== undefined && h['Content-Length'] === undefined) {
      h['Content-Length'] = String(typeof payload === 'string' ? Buffer.byteLength(payload) : payload.byteLength);
    }
    const res = await dispatch(`${serverUrl}${p}`, { method, headers: h, body: payload });
    const text = await res.text();
    let parsed = null;
    try { parsed = text.trim() ? JSON.parse(text) : null; } catch { parsed = null; }
    return { status: res.status, headers: res.headers, json: parsed, text };
  }

  async function cron(t = now()) {
    const r = await dispatch(`${serverUrl}/cdn-cgi/local/scheduled?time=${t}&cron=*+*+*+*+*&format=json`);
    await r.text();
    const last = await dispatch(`${serverUrl}/__test/last-cron`);
    return last.json();
  }

  async function email(raw, { from = 'news@example.com', to = null } = {}) {
    const rcpt = to ?? `daylight-${values.emailToken}@${emailDomain}`;
    const r = await dispatch(`${serverUrl}/cdn-cgi/local/email?from=${encodeURIComponent(from)}&to=${encodeURIComponent(rcpt)}&format=json`, { method: 'POST', body: raw });
    return r.json();
  }

  /** The last email() invocation's D1 statements and rows read. */
  async function lastEmail() { return (await dispatch(`${serverUrl}/__test/last-email`)).json(); }

  /**
   * Redeploys the same Worker on the same D1 and R2 with changed bindings (e.g. {WORKERS_PLAN: 'paid'}, or a new
   * DAYLIGHT_SERVER_CODE). Keys set to undefined are removed.
   */
  async function restart(changes = {}) {
    const b = { ...bindings, ...changes };
    for (const [k, v] of Object.entries(b)) if (v === undefined || v === null) delete b[k];
    await mf.setOptions(options(b));
    env = await mf.getBindings();
    db = env.DB;
  }

  const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage(), fetch: nodeFetch, retryDelaysMs: [0, 0, 0] });
  const client = new srv.DaylightServer({ pairing, storage: new ds.MemoryStorage(), fetch: nodeFetch, from: 'Test phone', app: 'test/1' });

  /** The DC-1 Lab Inbox's server lane (5.5): polls the item topic, opens frames with the box key, acks. */
  const lane = {
    reassembler: new ds.Reassembler(),
    since: 'all',
    seen: new Set(),
    async hello(app = 'lab-inbox/test') {
      const frame = await srv.sealBox(values, 'ack', { v: 1, kind: 'ack', ids: [], sent: new Date().toISOString(), 'x-inbox': { app } });
      await relay.handle(`${RELAY_ORIGIN}/${values.ackTopic}`, { method: 'POST', body: ds.toBase64(frame), headers: { 'Content-Type': 'text/plain' } });
    },
    async poll({ ack = true } = {}) {
      const rc = new ds.RelayClient({ relay: RELAY_ORIGIN, fetch: nodeFetch });
      const entries = await rc.poll(values.itemTopic, 'all');
      const items = [];
      const ids = [];
      for (const m of entries) {
        if (!m.frame) continue;
        let opened;
        try { opened = await srv.openBox(values, 'item', m.frame); } catch { continue; }
        const id = opened.header.id;
        if (lane.seen.has(id)) { ids.push(id); continue; }
        const done = await lane.reassembler.add(opened.header, opened.body, { time: m.time, msgId: m.id });
        if (!done) continue;
        lane.seen.add(id);
        ids.push(id);
        items.push({ header: done.header, raw: opened.header, content: done.content });
      }
      if (ack && ids.length) {
        const frame = await srv.sealBox(values, 'ack', { v: 1, kind: 'ack', ids: [...new Set(ids)].slice(0, 70), sent: new Date().toISOString() });
        await relay.handle(`${RELAY_ORIGIN}/${values.ackTopic}`, { method: 'POST', body: ds.toBase64(frame), headers: { 'Content-Type': 'text/plain' } });
      }
      return items;
    },
  };

  /**
   * A raw HTTP request that declares `length` body bytes and sends zeros only while the server reads; it resolves as
   * soon as the answer arrives. -> {status, headers, json, written}.
   */
  async function raw(method, p, { headers = {}, length = 0, token = values.authToken } = {}) {
    const base = await mf.ready;
    return new Promise((resolve, reject) => {
      let written = 0, done = false;
      const req = http.request(new URL(p, base), {
        method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Length': String(length), ...headers },
      }, (res) => {
        done = true;
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let parsed = null;
          try { parsed = JSON.parse(text); } catch { parsed = null; }
          resolve({ status: res.statusCode, headers: res.headers, json: parsed, written });
          req.destroy();
        });
      });
      req.on('error', (e) => { if (!done) reject(e); });
      const chunk = Buffer.alloc(64 * 1024);
      const pump = () => {
        while (!done && written < length) {
          const n = Math.min(chunk.length, length - written);
          written += n;
          if (!req.write(chunk.subarray(0, n))) { req.once('drain', pump); return; }
        }
        if (written >= length && !done) req.end();
      };
      // Headers first; the body only if no answer came from the headers alone (so an early answer is never lost to
      // a connection closed mid-upload).
      req.flushHeaders();
      setTimeout(pump, 300);
    });
  }

  return {
    raw,
    mf, get env() { return env; }, get db() { return db; }, relay, claude, web, values, keys, seed, secret, pairing, serverCode, pairingLink, outboundLog,
    api, cron, email, lastEmail, restart, dispatch, nodeFetch, receiver, client, lane, serverUrl, dns, dnsLog, dbName, now,
    emailAddress: `daylight-${values.emailToken}@${emailDomain}`,
    async close() { await mf.dispose(); await relay.close(); },
    async rows(sql, ...params) { return (await db.prepare(sql).bind(...params).all()).results; },
  };
}

/** A MIME message. parts: [{type, body, headers?}] (multipart/mixed when more than one). */
export function mime({ from = 'Example News <news@example.com>', to = 'reader@mail.test', subject = 'Hello', date = new Date().toUTCString(), headers = [], html, text, attachments = [], messageId } = {}) {
  const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/.{76}/g, '$&\r\n');
  const lines = [
    ...headers,
    `From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Date: ${date}`, `Message-ID: ${messageId ?? `<${Math.random().toString(16).slice(2)}@example.com>`}`, 'MIME-Version: 1.0',
  ];
  const bodyParts = [];
  if (text !== undefined) bodyParts.push(['text/plain; charset=utf-8', b64(text)]);
  if (html !== undefined) bodyParts.push(['text/html; charset=utf-8', b64(html)]);
  const alt = bodyParts.length > 1
    ? ['Content-Type: multipart/alternative; boundary="alt"', '', ...bodyParts.flatMap(([t, b]) => ['--alt', `Content-Type: ${t}`, 'Content-Transfer-Encoding: base64', '', b]), '--alt--']
    : bodyParts.length === 1 ? [`Content-Type: ${bodyParts[0][0]}`, 'Content-Transfer-Encoding: base64', '', bodyParts[0][1]] : ['Content-Type: text/plain', '', ''];
  if (!attachments.length) return [...lines, ...alt, ''].join('\r\n');
  return [
    ...lines, 'Content-Type: multipart/mixed; boundary="mix"', '', '--mix', ...alt,
    ...attachments.flatMap((a) => [
      '--mix', `Content-Type: ${a.type}${a.name ? `; name="${a.name}"` : ''}`, 'Content-Transfer-Encoding: base64',
      ...(a.cid ? [`Content-ID: <${a.cid}>`, 'Content-Disposition: inline'] : [`Content-Disposition: attachment; filename="${a.name}"`]),
      '', b64(a.data),
    ]),
    '--mix--', '',
  ].join('\r\n');
}

export const CF_AUTH = (dmarc = 'pass') => `Authentication-Results: mx.cloudflare.net;\r\n\tdkim=pass header.d=example.com header.s=s1 header.b=abc;\r\n\tdmarc=${dmarc} header.from=example.com policy.dmarc=reject;\r\n\tspf=pass (mx.cloudflare.net: domain of news@example.com designates 192.0.2.1 as permitted sender) smtp.mailfrom=news@example.com`;
