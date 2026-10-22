// The Daylight server: the app-side client module (DESIGN.md section 13).
// One ES module with no dependencies beyond the protocol module. It runs in browsers, extension service workers,
// Node 22 and the Worker itself (WebCrypto, fetch). The extension and the web sender use it as is; Swift and Kotlin
// follow the same names and pass ../vectors/server-vectors.json.

import {
  ShareError, PROTOCOL_VERSION, DEFAULT_RELAY, MAGIC, MAX_PAGE_HTML, MAX_PARTS,
  utf8, fromUtf8, concat, toHex, toBase32, fromBase32, toBase64, fromBase64, randomBytes, sha256, deflateRaw,
  parseCode, normalizeRelay, deriveKeys, encryptFrame, decryptFrame, webUrl, cleanTitle, cleanName, safeFileName,
  nowIso, RelayClient,
} from '../../share/js/daylight-share.js';

// ---------------------------------------------------------------------------------------------------------------
// Constants (13.1)

export const SERVER_API = 1;
export const SERVER_API_MIN = 1;
export const HOSTED_CHUNK = 12_582_912; // = the protocol's 12 MiB chunk of v1.0, which every receiver accepts (6.2)
export const HOSTED_MAX = 16 * HOSTED_CHUNK; // 192 MiB encoded
export const HOSTED_FRAME_MAX = 12_713_984; // receivers' attachment download cap
export const SERVER_CHUNK = 1_048_576; // server item frames (5)
export const SERVER_MAX_PARTS = 16;
export const SOURCE_PART = 2_097_152; // base64 characters per PDF part (9.2)
export const SOURCE_PART_BYTES = 1_572_864; // PDF bytes per part (no padding inside)
export const SOURCE_MAX_PARTS = 15;
export const SOURCE_MAX = 30_000_000; // base64 characters of one PDF
export const RELAY_MAX_ITEM = 9_000_000; // the most an item over the relay alone can be (protocol MAX_ITEM)
export const CONFIG_REFRESH_MS = 6 * 3600 * 1000;
export const STATUS_REFRESH_MS = 10 * 60 * 1000;
export const CONFIG_MAX_AHEAD_MS = 5 * 60 * 1000;
export const HOSTED_RESEND_MS = 11 * 3600 * 1000;
export const HOSTED_EXPIRY_MS = 7 * 86400 * 1000;
export const SMALL_FRAME_BYTES = 2850; // base64(frame) <= 3800 characters
export const FEATURES = ['ai', 'pdf', 'email', 'feeds', 'files', 'deliver'];

const SERVER_SCHEME = 'daylightserver:';
const PAIR_SCHEME = 'daylightshare:';
const AADS = { config: 'dlshare/v1/server-config', item: 'dlshare/v1/server-item', ack: 'dlshare/v1/server-ack' };
const MAX_HEADER = 65536;
const label = (name) => utf8(`dlshare/v1/${name}\0`);
const subtle = () => globalThis.crypto.subtle;

// ---------------------------------------------------------------------------------------------------------------
// User-facing messages (14). The apps show the server's `message` for an error code (14.2) and for the state `error`;
// every other state shows this module's text for it (STATE_MESSAGES), whatever the server sent with it.

export const RERUN_HELP = 'In GitHub › Actions, open the latest ‘Reader experiment - Daylight server’ run and choose Re-run all jobs.';

export const STATE_MESSAGES = {
  'needs-server': 'Needs the Daylight server. Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in GitHub › Settings › Secrets, then paste the setup link the deploy makes in Lab settings › Daylight server.',
  'pairing-mismatch': 'The Daylight server still has your previous pairing. Re-run the deploy and paste its new setup link in Lab settings › Daylight server, or copy the new Server code into DAYLIGHT_SERVER_CODE.',
  'server-outdated': 'Update the Daylight server to use this: open the latest “Reader experiment - Daylight server” run in GitHub › Actions and choose Re-run all jobs.',
  'app-outdated': 'Update this app to use the Daylight server.',
  locked: 'The Daylight server was locked when this device was re-paired. Re-run the deploy and paste its new setup link in Lab settings › Daylight server, or copy the new Server code into DAYLIGHT_SERVER_CODE.',
  'needs-key': 'Needs a Claude API key. Add ANTHROPIC_API_KEY to the Daylight server (GitHub › Settings › Secrets), then re-run the deploy, to turn this on.',
  'needs-domain': 'Needs an email domain. Add DAYLIGHT_EMAIL_DOMAIN (a domain on your Cloudflare account) in GitHub › Settings › Secrets, then re-run the deploy.',
  'needs-r2': 'Needs R2 storage on your Cloudflare account. Turn on R2 in the Cloudflare dashboard (it asks for a card; the free tier isn’t charged), then re-run the deploy.',
  'needs-lab-inbox': 'Your Daylight server hasn’t heard from your Daylight yet. Open Daylight Share on it with Lab on.',
  'needs-paid': 'Email-in needs Cloudflare’s Workers Paid plan. Subscribe in the Cloudflare dashboard, set the variable DAYLIGHT_WORKERS_PLAN to paid in GitHub › Settings, then re-run the deploy.',
  OFFLINE: 'Couldn’t reach the Daylight server. Check your connection and try again.',
};

const fmtMB = (n) => `${Math.round((Number(n) / 1_000_000) * 10) / 10} MB`;
const fmtUsd = (n) => `US$${Number(n).toFixed(2).replace(/\.00$/, '')}`;
const fmtTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'midnight UTC' : `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
};

export const ERROR_MESSAGES = {
  AI_KEY_INVALID: () => 'Claude didn’t accept the API key. Check ANTHROPIC_API_KEY in GitHub › Settings › Secrets, then re-run the deploy.',
  AI_BILLING: () => 'Your Anthropic account is out of credit. Add credit in the Claude Console to keep using AI.',
  AI_DAILY_LIMIT: (x) => (Number(x.limitRequests) >= 0 && x.limitRequests !== undefined && x.limitRequests !== null
    // The request ceiling (9.3), set at deploy only: the dollar limit in Lab settings would not help.
    ? `You’ve used today’s ${x.limitRequests} AI request${Number(x.limitRequests) === 1 ? '' : 's'} (the server’s daily limit). It resets at ${fmtTime(x.resetAt)}. To change the limit, set the repo variable DAYLIGHT_AI_MAX_REQ_DAY in GitHub › Settings › Secrets and variables › Actions › Variables, then re-run the deploy.`
    : Number(x.needUsd) > 0
      ? `This request could cost up to ${fmtUsd(x.needUsd)} with Claude, more than today’s AI limit. Raise the limit in Lab settings (up to ${fmtUsd(x.ceilingUsd ?? 10)}).`
      : `Today’s AI limit is used up. It resets at ${fmtTime(x.resetAt)}, or raise it in Lab settings (up to ${fmtUsd(x.ceilingUsd ?? 10)}).`),
  AI_TOO_LARGE: (x) => `This is too long for one AI request (about ${Number(x.tokens ?? 0).toLocaleString('en-US')} tokens; the limit is ${Number(x.limit ?? 200000).toLocaleString('en-US')}).`,
  AI_QUEUE_FULL: () => 'Too many AI requests are waiting. Try again in a few minutes.',
  AI_REFUSED: () => 'Claude declined to work on this one.',
  AI_BUSY: () => 'Claude is busy right now. Try again in a minute.',
  AI_TIMEOUT: () => 'Claude took too long to answer. Try again.',
  AI_INCOMPLETE: () => 'Claude’s answer was cut off. Try a shorter length.',
  AI_BAD_INPUT: () => 'Claude couldn’t read this document.',
  URL_BLOCKED: () => 'The Daylight server can’t open that address.',
  FETCH_FAILED: () => 'The Daylight server couldn’t load that page.',
  FEED_INVALID: () => 'That address isn’t a feed, and the page doesn’t link to one.',
  FEED_EXISTS: () => 'You already follow that feed.',
  FEED_LIMIT: (x) => `You follow the most feeds the server allows (${x.limit ?? 100}). Remove one to add another.`,
  FEED_FLOOD: () => 'This feed was paused because it published too many new items at once.',
  TOO_LARGE: (x) => `That’s larger than the Daylight server takes (${fmtMB(x.limit ?? 0)}).`,
  STORAGE_FULL: () => 'The Daylight server’s storage is full. Try again once your Daylight has picked up waiting files.',
  GONE: () => 'That file has expired on the Daylight server. Send it again.',
  RATE_LIMITED: () => 'Too many requests. Try again in a minute.',
  BAD_AUTH: () => 'The Daylight server doesn’t recognise this device’s pairing. Re-run the deploy and paste its new setup link in Lab settings › Daylight server, or check DAYLIGHT_SERVER_CODE.',
  SETUP_USED: () => 'That setup link was already used for another pairing. Run the deploy with “New setup link” for a fresh one.',
  SETUP_INVALID: () => 'That setup link isn’t current. Copy it again: the deploy’s summary in GitHub › Actions says where to find it.',
  SERVER_LIMIT: () => 'This was too big for the Daylight server on Cloudflare’s Free plan. It works on the Workers Paid plan.',
  NEEDS_KEY: () => STATE_MESSAGES['needs-key'],
  NOT_CONFIGURED: (x) => STATE_MESSAGES[notConfiguredState(x.missing)],
  NEEDS_LAB_INBOX: () => STATE_MESSAGES['needs-lab-inbox'],
  LOCKED: () => STATE_MESSAGES.locked,
  OFFLINE: () => STATE_MESSAGES.OFFLINE,
};

/** Every code the server can answer with; each has a message (tests check this). */
export const ERROR_CODES = [
  'BAD_REQUEST', 'BAD_AUTH', 'NOT_FOUND', 'NEED_SOURCE', 'NEEDS_KEY', 'NOT_CONFIGURED', 'NEEDS_LAB_INBOX', 'FEED_EXISTS',
  'GONE', 'LENGTH_REQUIRED', 'TOO_LARGE', 'AI_TOO_LARGE', 'UNSUPPORTED_TYPE', 'FEED_INVALID', 'URL_BLOCKED', 'AI_REFUSED',
  'AI_BAD_INPUT', 'LOCKED', 'RATE_LIMITED', 'AI_DAILY_LIMIT', 'AI_QUEUE_FULL', 'FEED_LIMIT', 'FETCH_FAILED',
  'AI_INCOMPLETE', 'AI_BUSY', 'AI_KEY_INVALID', 'AI_BILLING', 'AI_TIMEOUT', 'STORAGE_FULL', 'SERVER_LIMIT', 'BAD_EMAIL',
  'FEED_FLOOD', 'SERVER_ERROR', 'SETUP_USED',
];

/** The message for an error code (14.2); unknown codes get the generic sentence. */
export function errorMessage(code, extra = {}) {
  const f = ERROR_MESSAGES[code];
  return f ? f(extra ?? {}) : `Something went wrong on the Daylight server (${code}). Try again later.`;
}

/** Text for the states the app decides itself (14.1): needs-server, pairing-mismatch, server-outdated, app-outdated, OFFLINE. */
export function localMessage(state) { return STATE_MESSAGES[state] ?? errorMessage(state); }

/**
 * NOT_CONFIGURED's `missing` -> the state. Read in this order (LAB-PLAN 2.6): DAYLIGHT_SERVER_CODE, then
 * DAYLIGHT_EMAIL_DOMAIN, then R2; anything else, a `missing` that is not an array included, is needs-server.
 */
export function notConfiguredState(missing) {
  const m = Array.isArray(missing) ? missing : [];
  if (m.includes('DAYLIGHT_SERVER_CODE')) return 'needs-server';
  if (m.includes('DAYLIGHT_EMAIL_DOMAIN')) return 'needs-domain';
  if (m.includes('R2')) return 'needs-r2';
  return 'needs-server';
}

/** The states the app decides itself (4.3, 14.1). No answer from the server can give one of them. */
const LOCAL_STATES = ['needs-server', 'pairing-mismatch', 'server-outdated', 'app-outdated', 'OFFLINE'];
/** The states GET /v1/status may give a feature besides `ready` and `error` (10.5, 14.1). Any other is `error`. */
const STATUS_STATES = ['needs-key', 'needs-domain', 'needs-r2', 'needs-lab-inbox', 'needs-paid', 'locked'];
/** Every state state() and noteError() return: a closed set (server-vectors.json › serverState › states). */
export const SERVER_STATES = ['ready', 'needs-server', 'pairing-mismatch', 'server-outdated', 'app-outdated', 'needs-key',
  'needs-domain', 'needs-r2', 'needs-lab-inbox', 'needs-paid', 'locked', 'error', 'OFFLINE'];
const SERVER_CODE = /^[A-Z][A-Z0-9_]{0,39}$/; // what an error JSON's `code` must look like to be read (10.4)

/**
 * Whether an error JSON's `code` is read (10.4): 1 to 40 characters of A-Z, 0-9 and _, starting with a letter, and not
 * a state the app decides itself (OFFLINE), so a server's answer can never pose as one.
 */
export function isServerCode(code) {
  return typeof code === 'string' && SERVER_CODE.test(code) && !LOCAL_STATES.includes(code);
}

/**
 * A feature's entry in GET /v1/status -> {state, message} (14.1). `ready` has no message. needs-key, needs-domain,
 * needs-r2, needs-lab-inbox, needs-paid and locked show this module's text for the state, whatever the server sent.
 * `error` shows the server's `message` when it is a non-empty string, else SERVER_ERROR's sentence. Any other state
 * (a state the app decides itself, such as needs-server or OFFLINE, a Lab state such as needs-pairing, a state of a
 * newer server) is `error` in the same way, so the set of states stays closed. A status without the feature, or with
 * an entry that has no state, is {error, NOT_FOUND's message}. Pinned by server-vectors.json › serverState › fromStatus.
 */
export function stateFromStatus(status, feature) {
  const fs = status && typeof status === 'object' ? status.features : null;
  const f = fs && typeof fs === 'object' && Object.hasOwn(fs, feature) ? fs[feature] : null;
  if (!f || typeof f !== 'object' || typeof f.state !== 'string' || !f.state) return { state: 'error', message: errorMessage('NOT_FOUND') };
  if (f.state === 'ready') return { state: 'ready', message: null };
  if (STATUS_STATES.includes(f.state)) return { state: f.state, message: STATE_MESSAGES[f.state] };
  return { state: 'error', message: typeof f.message === 'string' && f.message ? f.message : errorMessage('SERVER_ERROR') };
}

/**
 * An error from the server, the network or discovery -> {state, message} (LAB-PLAN 2.6). The states the app decides
 * itself and every state an error code maps to show the module's text for that state; `error` shows the server's
 * message (BAD_AUTH: always the module's). An error without a code is OFFLINE. Pinned by server-vectors.json ›
 * serverState › fromError.
 */
export function stateFromError(err) {
  const code = typeof err?.code === 'string' && err.code ? err.code : 'OFFLINE';
  if (LOCAL_STATES.includes(code)) return { state: code, message: localMessage(code) };
  const mapped = code === 'LOCKED' ? 'locked' : code === 'NEEDS_KEY' ? 'needs-key' : code === 'NEEDS_LAB_INBOX' ? 'needs-lab-inbox'
    : code === 'NOT_CONFIGURED' ? notConfiguredState(err.missing) : null;
  if (mapped) return { state: mapped, message: STATE_MESSAGES[mapped] };
  if (code === 'BAD_AUTH') return { state: 'error', message: errorMessage('BAD_AUTH') };
  return { state: 'error', message: typeof err.message === 'string' && err.message ? err.message : errorMessage(code, err) };
}

/** Notices shown once per feature (14.3), with Continue and Cancel. */
export function noticeText(feature, { delivery = 'lab' } = {}) {
  const v1 = delivery === 'v1';
  switch (feature) {
    case 'ai': case 'pdf':
      return 'Not end-to-end encrypted: to use AI, the text or file goes to your Daylight server and to Claude (Anthropic) in readable form.'
        + (v1 ? '' : ' Links, pages and files you send to your Daylight stay end-to-end encrypted.');
    case 'email': return 'Not end-to-end encrypted: email reaches your Daylight server in readable form, like any email. The server encrypts it before it goes on to your Daylight.';
    case 'feeds': return 'Your feed list is kept on your Daylight server in readable form, so it can check feeds while your devices sleep.';
    case 'files': return v1
      ? 'Large files wait on your Daylight server for up to 14 days, encrypted with your pairing key, which your Daylight server also holds.'
      : 'Large files wait on your Daylight server for up to 14 days, encrypted with your pairing key; the server can’t open them.';
    case 'v1': return 'Your Daylight server holds your pairing code, so whoever controls your Cloudflare or GitHub account can read everything sent to this Daylight.';
    default: return null;
  }
}

export class ServerError extends Error {
  /** code: the server's error code (or OFFLINE); extra: status, message, feature, missing, retryAfter, limit, resetAt, missingParts, tokens, estimateUsd, needUsd. */
  constructor(code, extra = {}) {
    super(extra.message || errorMessage(code, extra));
    this.name = 'ServerError';
    this.code = code;
    this.status = extra.status ?? 0;
    for (const k of ['feature', 'missing', 'retryAfter', 'limit', 'resetAt', 'missingParts', 'tokens', 'estimateUsd', 'needUsd', 'limitRequests', 'reason']) {
      if (extra[k] !== undefined) this[k] = extra[k];
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The Server code and derived values (3.1, 3.2)

/** secret (16 bytes) -> seed (16 bytes). Apps only: the server never sees the secret under Lab delivery. */
export async function deriveServerSeed(secret) {
  if (!(secret instanceof Uint8Array) || secret.length !== 16) throw new ShareError('secret', 'secret must be 16 bytes');
  return (await sha256(concat(label('server-seed'), secret))).slice(0, 16);
}

async function codeCheck(seed) { return (await sha256(concat(label('server-code-check'), seed)))[0]; }

/** -> "SERVER-XXXX-…-XXXX", or "daylightserver://setup?c=…&r=…&k=…" when the pairing uses another relay or a token. */
export async function formatServerCode(seed, { relay, token } = {}) {
  if (!(seed instanceof Uint8Array) || seed.length !== 16) throw new ShareError('seed', 'seed must be 16 bytes');
  const c = toBase32(concat(seed, Uint8Array.of(await codeCheck(seed))));
  const r = relay ? normalizeRelay(relay) : DEFAULT_RELAY;
  if (r === DEFAULT_RELAY && !token) return 'SERVER-' + c.match(/.{1,4}/g).join('-');
  const p = new URLSearchParams();
  p.set('c', c);
  if (r !== DEFAULT_RELAY) p.set('r', r);
  if (token) p.set('k', token);
  return `daylightserver://setup?${p.toString()}`;
}

const PAIRING_CODE_MESSAGE = 'That is your pairing code. The server needs the Server code instead (Lab settings › Daylight server › Copy). Replace the secret’s value.';

async function decodeServerChars(chars) {
  let s = String(chars ?? '').toUpperCase().replace(/[\s\-_.]/g, '');
  s = s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');
  if (s.length !== 28 || !/^[A-Z2-7]+$/.test(s)) {
    throw new ShareError('server-code', 'A Server code is SERVER- followed by 28 letters and digits. Copy it again from Lab settings › Daylight server.', 'format');
  }
  const bytes = fromBase32(s);
  const seed = bytes.slice(0, 16);
  if ((await codeCheck(seed)) !== bytes[16]) {
    throw new ShareError('server-code', 'That Server code doesn’t check out. Copy it again from Lab settings › Daylight server.', 'checksum');
  }
  return seed;
}

/**
 * A Server code (either form) -> {seed, relay, token}. Throws ShareError('server-code') with a user-facing message;
 * a pairing code or pairing link gets "That is your pairing code…", so the master secret is never uploaded by mistake.
 */
export async function parseServerCode(input) {
  const s = String(input ?? '').trim();
  if (s.toLowerCase().startsWith(PAIR_SCHEME)) throw new ShareError('server-code', PAIRING_CODE_MESSAGE, 'pairing-code');
  if (s.toLowerCase().startsWith(SERVER_SCHEME)) {
    const q = s.includes('?') ? s.slice(s.indexOf('?') + 1).split('#')[0] : '';
    const p = new URLSearchParams(q);
    const seed = await decodeServerChars(p.get('c') ?? '');
    return { seed, relay: normalizeRelay(p.get('r') ?? ''), token: (p.get('k') ?? '').trim() };
  }
  const compact = s.toUpperCase().replace(/[\s\-_.]/g, '');
  if (!compact.startsWith('SERVER')) {
    let isPairing = false;
    try { await parseCode(s); isPairing = true; } catch { /* not a pairing code either */ }
    if (isPairing) throw new ShareError('server-code', PAIRING_CODE_MESSAGE, 'pairing-code');
    throw new ShareError('server-code', 'A Server code starts with SERVER-. Copy it from Lab settings › Daylight server › Server code.', 'format');
  }
  return { seed: await decodeServerChars(compact.slice(6)), relay: DEFAULT_RELAY, token: '' };
}

const hexOf = async (name, ...parts) => toHex(await sha256(concat(label(name), ...parts)));

/** -> {authToken, boxKey: CryptoKey, configTopic, itemTopic, ackTopic, emailToken, fingerprint, workerName} */
export async function deriveServerValues(seed, { emailSalt = '' } = {}) {
  if (!(seed instanceof Uint8Array) || seed.length !== 16) throw new ShareError('seed', 'seed must be 16 bytes');
  const boxBytes = await sha256(concat(label('server-box'), seed));
  const boxKey = await subtle().importKey('raw', boxBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const emailHash = await sha256(concat(label('server-email'), seed, utf8(String(emailSalt ?? ''))));
  return {
    authToken: await hexOf('server-auth', seed),
    boxKey,
    configTopic: 'dls-' + (await hexOf('server-config-topic', seed)).slice(0, 32),
    itemTopic: 'dls-' + (await hexOf('server-item-topic', seed)).slice(0, 32),
    ackTopic: 'dls-' + (await hexOf('server-ack-topic', seed)).slice(0, 32),
    emailToken: toBase32(emailHash).toLowerCase().slice(0, 10),
    fingerprint: (await hexOf('server-fingerprint', seed)).slice(0, 8),
    workerName: 'daylight-' + (await hexOf('server-worker', seed)).slice(0, 12),
  };
}

/** Deterministic item ids for server-made items: feed:<feedId>:<entryKey>, digest:<date>, email:<mailId>:<n>, ai:<id>. */
export async function serverItemId(seed, origin) {
  return (await hexOf('server-item-id', seed, Uint8Array.of(0), utf8(String(origin)))).slice(0, 32);
}

/** "3f9a1c2e" -> "3f9a-1c2e", as Lab settings and the deploy summary show it. */
export const showFingerprint = (fp) => `${String(fp).slice(0, 4)}-${String(fp).slice(4, 8)}`;

// ---------------------------------------------------------------------------------------------------------------
// The setup link (3.5): the deploy's one-time link that lets one app give a new server its Server code

const SETUP_PATH = '/setup';
async function setupCheck(secret) { return (await sha256(concat(label('server-setup-check'), secret)))[0]; }

/**
 * The only hosts a setup link may name: the deploy's Worker, daylight-<12 hex>.<account subdomain>.workers.dev. The app
 * sends this pairing's Server code to that host, so a link to any other host (a look-alike sent by a stranger) is
 * refused before anything is sent. Anyone can name a Worker like this on their own account, so this stops look-alikes,
 * not a determined attacker: the app also shows the address before it sends (3.5). The ports apply the same rule.
 */
export const SETUP_HOST = /^daylight-[0-9a-f]{12}\.[a-z0-9-]+\.workers\.dev$/;
const SETUP_HOST_TEXT = 'That link isn’t for a Daylight server: a setup link starts with https://daylight- and its address ends in .workers.dev. Copy it again: the deploy’s summary in GitHub › Actions says where to find it.';

function setupOrigin(server) {
  const u = new URL(String(server));
  if (u.protocol !== 'https:' || u.username || u.password) throw new ShareError('setup-link', SETUP_FORMAT, 'format');
  if (u.port || !SETUP_HOST.test(u.hostname)) throw new ShareError('setup-link', SETUP_HOST_TEXT, 'host');
  return u.origin;
}

/**
 * The deploy: the server's origin and a 16-byte random secret -> "https://<worker host>/setup#SETUP-XXXX-…-XXXX"
 * (28 base32 characters of secret ‖ check, check = SHA-256("dlshare/v1/server-setup-check" ‖ 0x00 ‖ secret)[0]).
 */
export async function formatSetupLink(server, secret) {
  if (!(secret instanceof Uint8Array) || secret.length !== 16) throw new ShareError('secret', 'secret must be 16 bytes');
  const c = toBase32(concat(secret, Uint8Array.of(await setupCheck(secret))));
  return `${setupOrigin(server)}${SETUP_PATH}#SETUP-${c.match(/.{1,4}/g).join('-')}`;
}

const SETUP_FORMAT = 'A setup link starts with https://daylight- and ends with #SETUP- and 28 letters and digits. Copy it again: the deploy’s summary in GitHub › Actions says where to find it.';

/**
 * A setup link -> {server (origin), secret (16 bytes)}. Throws ShareError('setup-link') with a user-facing message and
 * a reason: 'format', 'host' (not a daylight-<12 hex>.<subdomain>.workers.dev address), 'checksum', 'server-code' (the
 * Server code was pasted) or 'pairing-code'.
 */
export async function parseSetupLink(input) {
  const s = String(input ?? '').trim();
  const compact = s.toUpperCase().replace(/[\s\-_.]/g, '');
  if (s.toLowerCase().startsWith(SERVER_SCHEME) || compact.startsWith('SERVER')) {
    throw new ShareError('setup-link', 'That is the Server code. Paste the setup link here instead: it starts with https:// and ends with #SETUP-….', 'server-code');
  }
  if (s.toLowerCase().startsWith(PAIR_SCHEME)) throw new ShareError('setup-link', 'That is your pairing code. Paste the setup link here instead: it starts with https:// and ends with #SETUP-….', 'pairing-code');
  let u;
  try { u = new URL(s); } catch {
    let isPairing = false;
    try { await parseCode(s); isPairing = true; } catch { /* not a pairing code either */ }
    if (isPairing) throw new ShareError('setup-link', 'That is your pairing code. Paste the setup link here instead: it starts with https:// and ends with #SETUP-….', 'pairing-code');
    throw new ShareError('setup-link', SETUP_FORMAT, 'format');
  }
  let server;
  try { server = setupOrigin(u.href); } catch (e) { throw e?.reason === 'host' ? e : new ShareError('setup-link', SETUP_FORMAT, 'format'); }
  if (u.search || (u.pathname !== SETUP_PATH && u.pathname !== `${SETUP_PATH}/`)) throw new ShareError('setup-link', SETUP_FORMAT, 'format');
  let chars = decodeURIComponent(u.hash.slice(1)).toUpperCase().replace(/[\s\-_.]/g, '');
  if (!chars.startsWith('SETUP')) throw new ShareError('setup-link', SETUP_FORMAT, 'format');
  chars = chars.slice(5).replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');
  if (chars.length !== 28 || !/^[A-Z2-7]+$/.test(chars)) throw new ShareError('setup-link', SETUP_FORMAT, 'format');
  const bytes = fromBase32(chars);
  const secret = bytes.slice(0, 16);
  if ((await setupCheck(secret)) !== bytes[16]) {
    throw new ShareError('setup-link', 'That setup link doesn’t check out. Copy it again: the deploy’s summary in GitHub › Actions says where to find it.', 'checksum');
  }
  return { server, secret };
}

/** The setup link's bearer token for POST /v1/setup: hex(SHA-256("dlshare/v1/server-setup-auth" ‖ 0x00 ‖ secret)). */
export async function deriveSetupToken(secret) {
  if (!(secret instanceof Uint8Array) || secret.length !== 16) throw new ShareError('secret', 'secret must be 16 bytes');
  return hexOf('server-setup-auth', secret);
}

// ---------------------------------------------------------------------------------------------------------------
// Frames under the server's box key (3.2). Never through the protocol's sealFrame, which maps unknown purposes to the
// inbox AAD.

function aadBytes(aad) {
  const s = AADS[aad];
  if (!s) throw new ShareError('aad', `unknown box AAD ${aad}`);
  return utf8(s);
}

/** Seals a header (object) and body with boxKey and the AAD 'config' | 'item' | 'ack'. */
export async function sealBox(values, aad, header, body = new Uint8Array(0), nonce = randomBytes(12)) {
  if (nonce.length !== 12) throw new ShareError('nonce', 'nonce must be 12 bytes');
  const headerBytes = utf8(JSON.stringify(header));
  if (headerBytes.length > MAX_HEADER) throw new ShareError('header', `header of ${headerBytes.length} bytes`);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, headerBytes.length, false);
  const ct = new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aadBytes(aad), tagLength: 128 }, values.boxKey, concat(len, headerBytes, body)));
  return concat(utf8(MAGIC), nonce, ct);
}

/** -> {header, body}. Throws ShareError('frame') for anything that is not a valid frame under this key and AAD. */
export async function openBox(values, aad, frame) {
  const additionalData = aadBytes(aad);
  if (!(frame instanceof Uint8Array) || frame.length < 4 + 12 + 16 + 4) throw new ShareError('frame', 'too short');
  for (let i = 0; i < 4; i++) if (frame[i] !== MAGIC.charCodeAt(i)) throw new ShareError('frame', 'bad magic');
  let plain;
  try {
    plain = new Uint8Array(await subtle().decrypt(
      { name: 'AES-GCM', iv: frame.subarray(4, 16), additionalData, tagLength: 128 }, values.boxKey, frame.subarray(16)));
  } catch {
    throw new ShareError('frame', 'does not decrypt');
  }
  if (plain.length < 4) throw new ShareError('frame', 'short plaintext');
  const hlen = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(0, false);
  if (hlen > plain.length - 4 || hlen > MAX_HEADER) throw new ShareError('frame', 'bad header length');
  let header;
  try { header = JSON.parse(fromUtf8(plain.subarray(4, 4 + hlen))); } catch { throw new ShareError('frame', 'bad header'); }
  if (!header || typeof header !== 'object' || Array.isArray(header) || header.v !== PROTOCOL_VERSION) {
    throw new ShareError('frame', 'unsupported header');
  }
  return { header, body: plain.subarray(4 + hlen) };
}

/** A config frame (4.1): header {v, kind: 'config', id, sent, server, api, fingerprint, delivery}, empty body. */
export async function buildConfigFrame(values, header, nonce) {
  const h = {
    v: 1, kind: 'config', id: header.id ?? toHex(randomBytes(16)), sent: header.sent ?? nowIso(),
    server: header.server, api: header.api ?? SERVER_API, fingerprint: header.fingerprint ?? values.fingerprint,
    delivery: header.delivery ?? 'lab',
  };
  return sealBox(values, 'config', h, new Uint8Array(0), nonce);
}

/** The 4.3 rules for an opened config header. -> a clean config or null. */
export function checkConfig(header, { now = Date.now() } = {}) {
  const h = header ?? {};
  if (h.v !== 1 || h.kind !== 'config') return null;
  let origin;
  try {
    const u = new URL(String(h.server));
    if (u.protocol !== 'https:' || u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null;
    origin = u.origin;
  } catch { return null; }
  if (String(h.server).replace(/\/$/, '') !== origin) return null;
  const sent = Date.parse(h.sent);
  if (!Number.isFinite(sent) || sent > now + CONFIG_MAX_AHEAD_MS) return null;
  if (!Number.isInteger(h.api) || h.api < 1) return null;
  if (typeof h.fingerprint !== 'string' || !/^[0-9a-f]{8}$/.test(h.fingerprint)) return null;
  const delivery = h.delivery === 'v1' ? 'v1' : 'lab';
  return { server: origin, api: h.api, fingerprint: h.fingerprint, delivery, sent: new Date(sent).toISOString(), id: String(h.id ?? '') };
}

// ---------------------------------------------------------------------------------------------------------------
// Items

const SERVER_COMPRESS_MAX = SERVER_CHUNK; // deflate only pages of at most 1 MiB (cheap enough on the Free plan)

/**
 * Server and tests: one server-made item -> frames, for either delivery mode (5.1).
 * seal: async (header, body, nonce) => frame (sealBox(values, 'item', …) for Lab delivery; the protocol's
 *       encryptFrame(keys, 'inbox', …) for v1 delivery).
 * item: {id (32 hex, from serverItemId), kind: 'url'|'page'|'file', url?, title?, name?, mime?, content?, sent?,
 *        from?, app?, extra?: {'x-origin', 'x-about'}}
 * opts: {chunkSize?, nonces?, compress?}
 * -> {id, header, frames, encodedLength}
 */
export async function buildServerItemFrames(seal, item, opts = {}) {
  const kind = item.kind;
  if (!['url', 'page', 'file'].includes(kind)) throw new ShareError('kind', `unknown kind ${kind}`);
  const id = item.id;
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) throw new ShareError('id', 'bad item id');
  const header = { v: PROTOCOL_VERSION, id, kind };
  const url = item.url ? webUrl(item.url) : null;
  if ((kind === 'url' || kind === 'page') && !url) throw new ShareError('url', 'A url or page item needs a web address.');
  if (url) header.url = url;
  const title = cleanTitle(item.title);
  if (title) header.title = title;
  let content = new Uint8Array(0);
  if (kind !== 'url') {
    content = typeof item.content === 'string' ? utf8(item.content) : item.content;
    if (!(content instanceof Uint8Array)) throw new ShareError('content', 'missing content');
    if (kind === 'page') {
      header.mime = 'text/html';
      if (content.length > MAX_PAGE_HTML) throw new ShareError('too-large', 'page over 8 MiB');
    } else {
      header.name = safeFileName(item.name, 'document');
      header.mime = String(item.mime || 'application/octet-stream').toLowerCase().slice(0, 100);
    }
    header.size = content.length;
    header.sha256 = toHex(await sha256(content));
  }
  let encoded = content;
  const compress = opts.compress ?? (kind === 'page' && content.length <= SERVER_COMPRESS_MAX);
  if (compress && content.length > 0) {
    const z = await deflateRaw(content);
    if (z.length < content.length) { encoded = z; header.enc = 'deflate-raw'; }
  }
  header.sent = item.sent ?? nowIso();
  const from = cleanName(item.from);
  if (from) header.from = from;
  if (item.app) header.app = String(item.app).slice(0, 60);
  for (const [k, v] of Object.entries(item.extra ?? {})) if (k.startsWith('x-') && v != null) header[k] = v;
  const chunkSize = opts.chunkSize ?? SERVER_CHUNK;
  const parts = Math.max(1, Math.ceil(encoded.length / chunkSize));
  if (parts > SERVER_MAX_PARTS) throw new ShareError('too-large', 'server item over 16 parts');
  const frames = [];
  for (let i = 0; i < parts; i++) {
    const h = parts > 1 ? { ...header, part: i, parts } : header;
    frames.push(await seal(h, encoded.subarray(i * chunkSize, Math.min(encoded.length, (i + 1) * chunkSize)), opts.nonces?.[i]));
  }
  return { id, header, frames, encodedLength: encoded.length };
}

/**
 * Senders: a large file -> ordinary v1 frames under the pairing key, `enc: identity`, HOSTED_CHUNK (6.2).
 * item: {id?, name, mime?, content: Uint8Array, title?, url?, from?, app?, sent?}
 * -> {id, header, frames, encodedLength}
 */
export async function buildHostedFrames(pairingKeys, item, { nonces, chunkSize = HOSTED_CHUNK } = {}) {
  const content = item.content;
  if (!(content instanceof Uint8Array)) throw new ShareError('content', 'missing content');
  if (content.length > HOSTED_MAX) throw new ShareError('too-large', `Files can be up to ${Math.floor(HOSTED_MAX / 1048576)} MB through your Daylight server.`);
  const id = item.id ?? toHex(randomBytes(16));
  if (!/^[0-9a-f]{32}$/.test(id)) throw new ShareError('id', 'bad item id');
  const header = { v: PROTOCOL_VERSION, id, kind: 'file' };
  const url = item.url ? webUrl(item.url) : null;
  if (url) header.url = url;
  const title = cleanTitle(item.title);
  if (title) header.title = title;
  header.name = safeFileName(item.name, 'document');
  header.mime = String(item.mime || 'application/octet-stream').toLowerCase().slice(0, 100);
  header.size = content.length;
  header.sha256 = toHex(await sha256(content));
  header.sent = item.sent ?? nowIso();
  const from = cleanName(item.from);
  if (from) header.from = from;
  if (item.app) header.app = String(item.app).slice(0, 60);
  const parts = Math.max(1, Math.ceil(content.length / chunkSize));
  if (parts > MAX_PARTS) throw new ShareError('too-large', 'too many parts');
  const frames = [];
  for (let i = 0; i < parts; i++) {
    const h = parts > 1 ? { ...header, part: i, parts } : header;
    frames.push(await encryptFrame(pairingKeys, 'inbox', h, content.subarray(i * chunkSize, Math.min(content.length, (i + 1) * chunkSize)), nonces?.[i]));
  }
  return { id, header, frames, encodedLength: content.length };
}

// ---------------------------------------------------------------------------------------------------------------
// Public URLs (9.7)

const BLOCKED_V4 = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
  [0xc0000000, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xe0000000, 4], [0xf0000000, 4],
];

function parseV4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const b = m.slice(1).map(Number);
  if (b.some((x) => x > 255)) return null;
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
}

const v4Blocked = (n) => BLOCKED_V4.some(([net, bits]) => ((n >>> (32 - bits)) === (net >>> (32 - bits))));

/** "[::ffff:a00:1]" or "::1" -> 8 numbers, or null. */
export function parseV6(host) {
  let s = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  if (s.includes('%')) return null;
  let tail4 = null;
  const lastColon = s.lastIndexOf(':');
  if (s.slice(lastColon + 1).includes('.')) {
    tail4 = parseV4(s.slice(lastColon + 1));
    if (tail4 === null) return null;
    s = s.slice(0, lastColon + 1) + (tail4 >>> 16).toString(16) + ':' + (tail4 & 0xffff).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (part) => (part === '' ? [] : part.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some(Number.isNaN)) return null;
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length > 7) return null;
  return [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
}

function v6Blocked(g) {
  const zeros = (from, to) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 6)) return true; // ::, ::1, IPv4-compatible
  if (zeros(0, 5) && g[5] === 0xffff) return true; // IPv4-mapped
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return v4Blocked(((g[6] << 16) | g[7]) >>> 0); // NAT64
  if (g[0] === 0x2002) return v4Blocked(((g[1] << 16) | g[2]) >>> 0); // 6to4
  return false;
}

/** True when a WHATWG-normalized hostname is a public host (9.7). */
export function isPublicHost(hostname) {
  let h = String(hostname ?? '').toLowerCase();
  if (!h) return false;
  if (h.startsWith('[')) {
    const g = parseV6(h);
    return g !== null && !v6Blocked(g);
  }
  h = h.replace(/\.$/, '');
  const v4 = parseV4(h);
  if (v4 !== null) return !v4Blocked(v4);
  if (/^[0-9.]+$/.test(h) || /^0x/i.test(h)) return false; // numeric forms WHATWG did not normalize
  if (!h.includes('.')) return false; // single-label names resolve on the local network
  if (h === 'home.arpa') return false;
  return !/\.(localhost|local|internal|lan|home\.arpa)$/.test(h);
}

/** The 9.7 rule: the protocol's webUrl, then a WHATWG parse, http(s) and public hosts. -> the normalized URL or null. */
export function publicUrl(u) {
  const s = webUrl(u);
  if (!s) return null;
  let p;
  try { p = new URL(s); } catch { return null; }
  if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
  if (p.username || p.password) return null;
  if (!isPublicHost(p.hostname)) return null;
  return webUrl(p.href) ? p.href : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The client

const KEY = {
  config: 'server/config', configAt: 'server/configAt', pin: 'server/pin', pendingMove: 'server/pendingMove',
  status: 'server/status', statusAt: 'server/statusAt', badAuthAt: 'server/badAuthAt', manualUrl: 'server/manualUrl', hosted: 'server/hosted',
  hostedAckCursor: 'server/hostedAckCursor', emailAddress: 'server/emailAddress', notices: 'server/notices',
};

async function readCapped(res, cap) {
  if (!res.body?.getReader) {
    const b = new Uint8Array(await res.arrayBuffer());
    return b.subarray(0, cap);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = cap - total;
    chunks.push(value.length > room ? value.subarray(0, room) : value);
    total += Math.min(value.length, room);
    if (total >= cap) { reader.cancel().catch(() => {}); break; }
  }
  return concat(...chunks);
}

/**
 * Polls a server topic the hardened way (4.3, 5.4): at most `maxBytes` of the answer and `maxMessages` lines, messages
 * with an attachment ignored (never downloaded). -> [{id, time, frame}] for lines whose message is base64.
 */
export async function pollServerTopic(fetchFn, relay, topic, { since = 'all', maxBytes = 262144, maxMessages = 200, token = '' } = {}) {
  const base = normalizeRelay(relay);
  const q = new URLSearchParams({ poll: '1', since: String(since) });
  if (token) q.set('auth', token);
  const res = await fetchFn(`${base}/${topic}/json?${q}`, { method: 'GET' });
  if (!res.ok) { try { await res.body?.cancel(); } catch { /* ignore */ } throw new ServerError('OFFLINE', { status: res.status }); }
  const text = new TextDecoder().decode(await readCapped(res, maxBytes));
  const lines = text.split('\n');
  if (!text.endsWith('\n')) lines.pop(); // a line cut by the byte cap
  const out = [];
  for (const line of lines) {
    if (out.length >= maxMessages) break;
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (!m || m.event !== 'message' || typeof m.id !== 'string') continue;
    const entry = { id: m.id, time: Number(m.time) || 0, frame: null };
    out.push(entry);
    if (m.attachment || typeof m.message !== 'string') continue;
    try { entry.frame = fromBase64(m.message); } catch { /* junk */ }
  }
  return out;
}

function partBase64(pdf, i) {
  return toBase64(pdf.subarray(i * SOURCE_PART_BYTES, Math.min(pdf.length, (i + 1) * SOURCE_PART_BYTES)));
}

export class DaylightServer {
  /**
   * pairing: {secret, relay, name?} as the protocol module parses it. storage: the protocol's storage adapter
   * ({get, set, remove}). fetch: the platform's fetch. from / app: shown on items this device sends.
   */
  constructor({ pairing, storage, fetch: f, now = () => Date.now(), from = '', app = '' }) {
    if (!pairing?.secret) throw new ShareError('pairing', 'Not paired yet.');
    this.pairing = { ...pairing, relay: normalizeRelay(pairing.relay) };
    this.storage = storage;
    this.fetch = f ?? ((...a) => globalThis.fetch(...a));
    this.now = now;
    this.from = from; this.app = app;
    this._values = null; this._seed = null; this._keys = null;
    this._contents = new Map(); // itemId -> frames, for re-uploads within this session
    this.files = { sendLarge: (item, o) => this._sendLarge(item, o), tick: () => this._filesTick(), remove: (id) => this._filesRemove(id), list: () => this._hosted() };
    this.feeds = {
      list: () => this.request('GET', '/v1/feeds'),
      add: (url, mode) => this.request('POST', '/v1/feeds', { json: { url, ...(mode ? { mode } : {}) } }),
      update: (id, patch) => this.request('PATCH', `/v1/feeds/${encodeURIComponent(id)}`, { json: patch }),
      remove: (id) => this.request('DELETE', `/v1/feeds/${encodeURIComponent(id)}`),
      check: (id) => this.request('POST', `/v1/feeds/${encodeURIComponent(id)}/check`, { json: {} }),
      importOpml: (opml, mode) => this.request('POST', '/v1/feeds/import', { body: opml, headers: { 'Content-Type': 'text/x-opml' }, query: mode ? { mode } : undefined }),
      sendDigestNow: () => this.request('POST', '/v1/digest/send', { json: {} }),
    };
    this.email = {
      info: () => this._emailInfo(),
      block: (pattern) => this.request('POST', '/v1/email/block', { json: { pattern } }),
      unblock: (pattern) => this.request('POST', '/v1/email/unblock', { json: { pattern } }),
      recent: () => this.request('GET', '/v1/email/recent'),
    };
    this.ai = {
      summarize: (source, o = {}) => this._ai({ op: 'summary', mode: o.mode, length: o.length, lang: o.lang, deliver: o.deliver, about: o.about }, source),
      explain: (passage, o = {}) => this._ai({ op: 'explain', passage, question: o.question, lang: o.lang, deliver: o.deliver, about: o.about }, o.source),
      ask: (source, question, o = {}) => this._ai({ op: 'ask', question, history: o.history, lang: o.lang, deliver: o.deliver, about: o.about }, source),
      job: (body) => this.request('POST', '/v1/ai/jobs', { json: body }),
      jobStatus: (id) => this.request('GET', `/v1/ai/jobs/${encodeURIComponent(id)}`),
    };
    this.settings = {
      get: () => this.request('GET', '/v1/settings'),
      update: (patch) => this.request('PATCH', '/v1/settings', { json: patch }),
    };
  }

  async seed() { return (this._seed ??= await deriveServerSeed(this.pairing.secret)); }
  async values() { return (this._values ??= await deriveServerValues(await this.seed())); }
  async pairingKeys() { return (this._keys ??= await deriveKeys(this.pairing.secret)); }

  /** The Server code to show in Lab settings, with Copy. */
  async serverCode({ token } = {}) { return formatServerCode(await this.seed(), { relay: this.pairing.relay, token }); }

  async _get(k) { try { return await this.storage.get(k); } catch { return undefined; } }

  /** -> {config, source: 'relay' | 'manual' | 'cache', moved?} or null; applies TOFU (4.3). */
  async discover({ force = false } = {}) {
    const manual = await this._get(KEY.manualUrl);
    if (manual) {
      return { config: { server: manual, api: SERVER_API, fingerprint: (await this.values()).fingerprint, delivery: 'lab' }, source: 'manual' };
    }
    const cached = await this._get(KEY.config);
    const at = (await this._get(KEY.configAt)) ?? 0;
    const values = await this.values();
    if (!force && cached && cached.fingerprint === values.fingerprint && this.now() - at < CONFIG_REFRESH_MS) {
      return this._applyPin(cached, 'cache');
    }
    let found = null;
    try {
      const entries = await pollServerTopic(this.fetch, this.pairing.relay, values.configTopic, { maxMessages: 50 });
      for (const e of entries) {
        if (!e.frame) continue;
        let opened;
        try { opened = await openBox(values, 'config', e.frame); } catch { continue; }
        const c = checkConfig(opened.header, { now: this.now() });
        if (c && c.fingerprint === values.fingerprint && (!found || c.sent > found.sent)) found = c;
      }
    } catch (e) {
      if (cached && cached.fingerprint === values.fingerprint) return this._applyPin(cached, 'cache');
      throw e instanceof ServerError ? e : new ServerError('OFFLINE');
    }
    if (!found) {
      if (cached && cached.fingerprint === values.fingerprint) return this._applyPin(cached, 'cache');
      return null;
    }
    await this.storage.set(KEY.config, found);
    await this.storage.set(KEY.configAt, this.now());
    return this._applyPin(found, 'relay');
  }

  async _applyPin(config, source) {
    const pin = await this._get(KEY.pin);
    if (!pin || pin.fingerprint !== config.fingerprint) {
      await this.storage.set(KEY.pin, { origin: config.server, fingerprint: config.fingerprint });
      return { config, source };
    }
    if (pin.origin !== config.server) {
      await this.storage.set(KEY.pendingMove, { origin: config.server, fingerprint: config.fingerprint });
      return { config: { ...config, server: pin.origin }, source, moved: config.server };
    }
    return { config, source };
  }

  /** Accepts a changed server origin after the user said yes to "Your Daylight server moved to <host>. Use it?". */
  async confirmMove() {
    const p = await this._get(KEY.pendingMove);
    if (!p) return false;
    await this.storage.set(KEY.pin, p);
    await this.storage.remove(KEY.pendingMove);
    await this.storage.remove(KEY.status);
    return true;
  }

  /**
   * Lab settings › Daylight server › Set up with a link (3.5): sends this pairing's Server code to a newly deployed
   * server with the deploy's one-time setup link, then pins the server's origin (the user gave it) and caches its
   * config. The server announces itself on the config topic, so the other apps and the Daylight find it as usual.
   * token: the pairing's ntfy access token, if any (it goes into the Server code link). -> {server, fingerprint,
   * delivery}. Throws ServerError: BAD_REQUEST (not a setup link; `message` says why), SETUP_INVALID (an old or
   * wrong link), SETUP_USED (used for another pairing), OFFLINE, or the server's own error.
   */
  async setup(link, { token } = {}) {
    let parsed;
    try { parsed = await parseSetupLink(link); } catch (e) {
      throw new ServerError('BAD_REQUEST', { message: e?.message || SETUP_FORMAT, reason: e?.reason });
    }
    const values = await this.values();
    let res;
    try {
      res = await this.fetch(`${parsed.server}/v1/setup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await deriveSetupToken(parsed.secret)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: await this.serverCode({ token }) }),
      });
    } catch {
      throw new ServerError('OFFLINE');
    }
    const text = await res.text().catch(() => '');
    let data = null;
    if (text.trim()) { try { data = JSON.parse(text); } catch { data = null; } }
    const err = data && typeof data === 'object' ? data.error : null;
    if (!res.ok || err) {
      // 401 (a wrong or replaced link) and 404 (no server, or no setup pending there) both mean: not the current link.
      if (res.status === 401 || res.status === 404) throw new ServerError('SETUP_INVALID', { status: res.status });
      if (err && typeof err === 'object' && isServerCode(err.code)) {
        const extra = { ...err, status: res.status };
        if (typeof extra.message !== 'string') delete extra.message;
        throw new ServerError(err.code, extra);
      }
      throw new ServerError('SERVER_ERROR', { status: res.status });
    }
    const config = checkConfig({ v: 1, kind: 'config', id: '', sent: new Date(this.now()).toISOString(), ...(data ?? {}) }, { now: this.now() });
    if (!config || config.server !== parsed.server || config.fingerprint !== values.fingerprint) {
      throw new ServerError('SERVER_ERROR', { status: res.status, message: 'The Daylight server answered for another pairing. Run the deploy with “New setup link” and try again.' });
    }
    if (config.api < SERVER_API_MIN) throw new ServerError('server-outdated', { message: localMessage('server-outdated') });
    if (config.api > SERVER_API) throw new ServerError('app-outdated', { message: localMessage('app-outdated') });
    await this.storage.set(KEY.config, config);
    await this.storage.set(KEY.configAt, this.now());
    await this.storage.set(KEY.pin, { origin: config.server, fingerprint: config.fingerprint });
    for (const k of [KEY.pendingMove, KEY.status, KEY.statusAt, KEY.badAuthAt, KEY.manualUrl]) await this.storage.remove(k);
    return { server: config.server, fingerprint: config.fingerprint, delivery: config.delivery };
  }

  /** Lab settings › Daylight server › Server address: validates with GET /v1/hello, then /v1/status. */
  async setManualUrl(url) {
    let origin;
    try {
      const u = new URL(String(url).trim());
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) throw new Error('scheme');
      origin = u.origin;
    } catch { throw new ServerError('BAD_REQUEST', { message: 'That isn’t a server address (https://…).' }); }
    let hello;
    try { hello = await (await this.fetch(`${origin}/v1/hello`)).json(); } catch { throw new ServerError('OFFLINE'); }
    if (hello?.service !== 'daylight-server') throw new ServerError('NOT_FOUND', { message: 'No Daylight server answers at that address.' });
    await this.storage.set(KEY.manualUrl, origin);
    await this.storage.remove(KEY.status);
    try { await this.status({ force: true }); } catch (e) { await this.storage.remove(KEY.manualUrl); throw e; }
    return origin;
  }

  async clearManualUrl() { await this.storage.remove(KEY.manualUrl); await this.storage.remove(KEY.status); }

  async _origin() {
    const d = await this.discover();
    if (!d) {
      const pin = await this._get(KEY.pin);
      const values = await this.values();
      throw new ServerError(pin && pin.fingerprint !== values.fingerprint ? 'pairing-mismatch' : 'needs-server',
        { message: localMessage(pin && pin.fingerprint !== values.fingerprint ? 'pairing-mismatch' : 'needs-server') });
    }
    if (d.config.api < SERVER_API_MIN) throw new ServerError('server-outdated', { message: localMessage('server-outdated') });
    // Additive changes keep the major version; a higher major means this app is too old for the server.
    if (d.config.api > SERVER_API) throw new ServerError('app-outdated', { message: localMessage('app-outdated') });
    return d.config.server;
  }

  /** Bearer request; maps error JSON to ServerError; a network failure -> ServerError('OFFLINE'). */
  async request(method, path, { json, body, query, headers = {}, raw = false } = {}) {
    const origin = await this._origin();
    const values = await this.values();
    const q = query ? `?${new URLSearchParams(query)}` : '';
    const h = { Authorization: `Bearer ${values.authToken}`, ...headers };
    let payload = body;
    if (json !== undefined) { payload = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    let res;
    try {
      res = await this.fetch(`${origin}${path}${q}`, { method, headers: h, body: payload });
    } catch {
      throw new ServerError('OFFLINE');
    }
    if (raw) return res;
    const text = await res.text().catch(() => '');
    let data = null;
    if (text.trim()) { try { data = JSON.parse(text); } catch { data = null; } }
    const err = data && typeof data === 'object' ? data.error : null;
    // Only an error object whose code is a server code (isServerCode, 10.4) is read, so an answer can never pose as a
    // state the app decides itself (needs-server, OFFLINE …); a message that is not a string is left out.
    if (err && typeof err === 'object' && isServerCode(err.code)) {
      const extra = { ...err, status: res.status };
      if (typeof extra.message !== 'string') delete extra.message;
      throw new ServerError(err.code, extra);
    }
    if (!res.ok) throw new ServerError(res.status === 401 ? 'BAD_AUTH' : 'SERVER_ERROR', { status: res.status });
    return data ?? {};
  }

  /** GET /v1/status, cached for 10 minutes. */
  async status({ force = false, waitMs = 5000 } = {}) {
    const cached = await this._get(KEY.status);
    const at = (await this._get(KEY.statusAt)) ?? 0;
    if (!force && cached && this.now() - at < STATUS_REFRESH_MS) return cached;
    try {
      const s = await Promise.race([
        this.request('GET', '/v1/status'),
        new Promise((_, reject) => setTimeout(() => reject(new ServerError('OFFLINE')), waitMs)),
      ]);
      await this.storage.set(KEY.status, s);
      await this.storage.set(KEY.statusAt, this.now());
      await this.storage.remove(KEY.badAuthAt); // the server knows this device again: a later BAD_AUTH re-reads the config
      return s;
    } catch (e) {
      if (cached && e?.code === 'OFFLINE') return cached;
      throw e;
    }
  }

  /**
   * From the cached config and status: {state, message} where state is 'ready' | 'needs-server' | 'pairing-mismatch'
   * | 'server-outdated' | 'app-outdated' | 'locked' | 'needs-key' | 'needs-domain' | 'needs-r2' | 'needs-lab-inbox' |
   * 'needs-paid' | 'error' | 'OFFLINE'. Refreshes a status older than 10 minutes (the status request waits at most
   * 5 s). Discovery and its relay poll have no deadline of their own, so a gate races this against its own 5 s
   * (LAB-PLAN 2.6, labGate). An error goes through noteError, so LOCKED and BAD_AUTH drop the cached status here too.
   */
  async state(feature) {
    let s;
    try {
      await this._origin();
      s = await this.status();
    } catch (e) {
      return this.noteError(feature, e);
    }
    return stateFromStatus(s, feature);
  }

  /**
   * After a server call for `feature` failed with `err` (LAB-PLAN 2.6, DESIGN 10.4): updates the cached status and
   * returns {state, message} to show now (stateFromError). Only this module writes `server/status`. Never throws.
   * - NEEDS_KEY, NEEDS_LAB_INBOX, and NOT_CONFIGURED for the email domain or R2: the feature the server names in the
   *   error's `feature` (else `feature`) takes that state in the cached status, and the cache is marked for refresh:
   *   the next state() asks the server, which knows every feature this affects, and falls back to this cache offline.
   * - LOCKED, BAD_AUTH and NOT_CONFIGURED for DAYLIGHT_SERVER_CODE concern the whole server: the cached status is
   *   dropped. The first BAD_AUTH of an episode also sets server/badAuthAt and removes server/configAt, so the next
   *   discovery re-reads the config topic (discover({force: true}), once); while server/badAuthAt is set, a later
   *   BAD_AUTH leaves the config alone, so a server that keeps answering 401 costs no more relay polls. A successful
   *   GET /v1/status (and lockBeforeRepair) removes server/badAuthAt and so ends the episode.
   * - Anything else (OFFLINE, RATE_LIMITED, AI_BUSY, AI_QUEUE_FULL, TOO_LARGE …) leaves the cache as it is, so the
   *   feature stays ready; the app shows the message and waits `err.retryAfter` when there is one.
   */
  async noteError(feature, err) {
    const out = stateFromError(err);
    const code = typeof err?.code === 'string' ? err.code : '';
    try {
      if (code === 'LOCKED' || code === 'BAD_AUTH' || (code === 'NOT_CONFIGURED' && out.state === 'needs-server')) {
        await this.storage.remove(KEY.status);
        await this.storage.remove(KEY.statusAt);
        if (code === 'BAD_AUTH' && (await this._get(KEY.badAuthAt)) === undefined) {
          await this.storage.set(KEY.badAuthAt, this.now());
          await this.storage.remove(KEY.configAt);
        }
      } else if (code === 'NEEDS_KEY' || code === 'NEEDS_LAB_INBOX' || code === 'NOT_CONFIGURED') {
        const key = FEATURES.includes(err.feature) ? err.feature : FEATURES.includes(feature) ? feature : null;
        const cached = await this._get(KEY.status);
        if (key && cached && typeof cached === 'object') {
          const features = cached.features && typeof cached.features === 'object' ? cached.features : {};
          await this.storage.set(KEY.status, { ...cached, features: { ...features, [key]: { state: out.state, message: out.message } } });
          await this.storage.remove(KEY.statusAt);
        }
      }
    } catch { /* storage trouble: the message is still shown */ }
    return out;
  }

  /** The first-use notice for a feature (14.3), or null once shown. Call markNoticeShown after Continue. */
  async notice(feature) {
    const shown = (await this._get(KEY.notices)) ?? {};
    if (shown[feature === 'pdf' ? 'ai' : feature]) return null;
    const delivery = (await this._get(KEY.config))?.delivery ?? 'lab';
    return noticeText(feature, { delivery });
  }

  async markNoticeShown(feature) {
    const shown = (await this._get(KEY.notices)) ?? {};
    shown[feature === 'pdf' ? 'ai' : feature] = true;
    await this.storage.set(KEY.notices, shown);
  }

  /** Before re-pairing: POST /v1/admin/lock with the old token (3.4). Never throws. */
  async lockBeforeRepair() {
    try { await this.storage.remove(KEY.status); await this.storage.remove(KEY.badAuthAt); } catch { /* ignore */ }
    try { await this.request('POST', '/v1/admin/lock', { json: {} }); return true; } catch { return false; }
  }

  // ---- email

  async _emailInfo() {
    const info = await this.request('GET', '/v1/email');
    const last = await this._get(KEY.emailAddress);
    const changed = !!(info.address && last && last !== info.address);
    if (info.address) await this.storage.set(KEY.emailAddress, info.address);
    return { ...info, changedSinceShown: changed, changedMessage: changed ? 'Your Daylight email address changed. Update your newsletter subscriptions.' : null };
  }

  // ---- AI

  async _ai(body, source) {
    const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    if (source?.pdf instanceof Uint8Array) {
      const pdf = source.pdf;
      const sourceId = toHex(await sha256(pdf)).slice(0, 32);
      const n = Math.max(1, Math.ceil(pdf.length / SOURCE_PART_BYTES));
      const ask = () => this.request('POST', '/v1/ai', { json: { ...clean, source: { sourceId } } });
      try {
        return await ask();
      } catch (e) {
        if (e?.code !== 'NEED_SOURCE') throw e;
        for (const i of e.missingParts ?? [...Array(n).keys()]) {
          await this.request('PUT', `/v1/ai/sources/${sourceId}/${i}`, {
            body: partBase64(pdf, i), query: { n: String(n) },
            headers: { 'Content-Type': 'text/plain', 'X-DLS-Source-Name': encodeURIComponent(source.name ?? 'document.pdf') },
          });
        }
        return ask();
      }
    }
    return this.request('POST', '/v1/ai', { json: source ? { ...clean, source } : clean });
  }

  // ---- large files (6.3)

  async _hosted() { return (await this._get(KEY.hosted)) ?? []; }

  async _publishAttach(urls) {
    const keys = await this.pairingKeys();
    for (const url of urls) {
      const res = await this.fetch(`${this.pairing.relay}/${keys.inboxTopic}`, {
        method: 'POST', headers: { Attach: url, Filename: 'dls1.bin', Firebase: 'no', Cache: 'yes' }, body: 'dls1',
      });
      if (!res.ok) { try { await res.body?.cancel(); } catch { /* ignore */ } throw new ServerError('OFFLINE', { status: res.status, message: `The relay answered ${res.status}.` }); }
      try { await res.body?.cancel(); } catch { /* ignore */ }
    }
  }

  async _upload(origin, fileId, frames, only) {
    for (let i = 0; i < frames.length; i++) {
      if (only && !only.includes(i)) continue;
      await this.request('PUT', `/v1/files/${fileId}/${i}`, {
        body: frames[i], query: { n: String(frames.length) }, headers: { 'Content-Type': 'application/octet-stream' },
      });
    }
  }

  /**
   * Sends a file larger than the relay's largest item through the Daylight server (6.3): uploads ordinary v1 frames,
   * publishes one small Attach: message per frame on the inbox topic and keeps a hosted outbox row.
   * item: {name, mime?, content: Uint8Array, title?, url?}. -> the hosted row.
   */
  async _sendLarge(item) {
    const origin = await this._origin();
    const keys = await this.pairingKeys();
    const built = await buildHostedFrames(keys, { ...item, from: item.from ?? this.from, app: item.app ?? this.app });
    const fileId = toHex(randomBytes(16));
    await this._upload(origin, fileId, built.frames);
    const urls = built.frames.map((_, i) => `${origin}/f/${fileId}/${i}`);
    await this._publishAttach(urls);
    const now = this.now();
    const row = {
      id: built.id, fileId, parts: built.frames.length, urls, name: built.header.name, size: built.header.size,
      title: built.header.title ?? '', sent: built.header.sent, created: now, lastPublish: now, status: 'sent',
    };
    this._contents.set(built.id, built.frames);
    const rows = (await this._hosted()).filter((r) => r.id !== row.id);
    rows.unshift(row);
    await this.storage.set(KEY.hosted, rows);
    return row;
  }

  /** Acks, re-sends and deletes for hosted files. -> {delivered, republished, expired}. */
  async _filesTick() {
    const rows = await this._hosted();
    const pending = rows.filter((r) => r.status === 'sent');
    const out = { delivered: 0, republished: 0, expired: 0 };
    if (!pending.length) return out;
    const keys = await this.pairingKeys();
    const acked = new Set();
    try {
      const relay = new RelayClient({ relay: this.pairing.relay, fetch: this.fetch });
      const since = (await this._get(KEY.hostedAckCursor)) ?? 'all';
      const entries = await relay.poll(keys.ackTopic, since);
      let newest = 0;
      for (const m of entries) {
        newest = Math.max(newest, m.time ?? 0);
        if (!m.frame) continue;
        try {
          const { header } = await decryptFrame(keys, 'ack', m.frame);
          if (header.kind === 'ack' && Array.isArray(header.ids)) for (const id of header.ids) acked.add(id);
        } catch { /* junk */ }
      }
      if (newest) await this.storage.set(KEY.hostedAckCursor, Math.max(0, newest - 1800));
    } catch { /* offline: re-send anyway */ }
    const now = this.now();
    for (const r of pending) {
      if (acked.has(r.id)) {
        r.status = 'delivered'; r.delivered = now; out.delivered++;
        this._contents.delete(r.id);
        try { await this.request('DELETE', `/v1/files/${r.fileId}`); } catch { /* the server expires it anyway */ }
        continue;
      }
      if (now - r.created > HOSTED_EXPIRY_MS) {
        r.status = 'expired'; out.expired++;
        try { await this.request('DELETE', `/v1/files/${r.fileId}`); } catch { /* ignore */ }
        continue;
      }
      if (now - r.lastPublish < HOSTED_RESEND_MS) continue;
      try {
        let info = null;
        try { info = await this.request('GET', `/v1/files/${r.fileId}`); } catch (e) {
          if (!['NOT_FOUND', 'GONE'].includes(e?.code)) throw e;
        }
        const missing = info ? [...Array(r.parts).keys()].filter((i) => !(info.stored ?? []).includes(i)) : [...Array(r.parts).keys()];
        if (missing.length) {
          const frames = this._contents.get(r.id);
          if (!frames) { r.status = 'expired'; r.error = 'gone'; out.expired++; continue; }
          await this._upload(await this._origin(), r.fileId, frames, missing);
        }
        await this._publishAttach(r.urls);
        r.lastPublish = now; out.republished++;
      } catch { /* try again on the next tick */ }
    }
    await this.storage.set(KEY.hosted, rows);
    return out;
  }

  async _filesRemove(itemId) {
    const rows = await this._hosted();
    const r = rows.find((x) => x.id === itemId);
    if (!r) return false;
    try { await this.request('DELETE', `/v1/files/${r.fileId}`); } catch { /* ignore */ }
    this._contents.delete(itemId);
    await this.storage.set(KEY.hosted, rows.filter((x) => x.id !== itemId));
    return true;
  }
}
