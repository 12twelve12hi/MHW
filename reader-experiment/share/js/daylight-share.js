// Daylight Share protocol, version 1 (revision 1.1): the JavaScript reference implementation (see ../PROTOCOL.md).
// One ES module with no dependencies. Runs in browsers, extension service workers and Node 22+ (WebCrypto,
// CompressionStream, fetch). The Chrome and Safari extensions and the web sender use it as is; the Kotlin and Swift
// implementations are checked against the vectors this module generates (../vectors/test-vectors.json).
// Why each rule is the way it is: ../CHANGES-v1.1.md.

export const PROTOCOL_VERSION = 1;
export const DEFAULT_RELAY = 'https://ntfy.sh';
export const MAGIC = 'DLS1';

// Sizes (PROTOCOL 2.3, 3.5, 4). All in bytes.
export const CHUNK = 1900544; // 29 × 64 KiB: a frame is at most CHUNK + MAX_HEADER + 36 = 1,966,116 bytes
export const MAX_PARTS = 16; // accepted; a sender needs at most 5
export const MAX_ITEM = 9000000; // the largest content (`size`, before compression) a sender sends
export const MAX_DECODED = 268435456; // the largest file `size` a receiver accepts
export const MAX_HEADER = 65536; // header JSON
export const MAX_ATTACHMENT = 12713984; // attachment downloads (v1.0 senders' 12 MiB chunks + 128 KiB)
export const MAX_POLL_RESPONSE = 67108864; // a poll answer
export const MAX_PAGE_HTML = 8 * 1024 * 1024;
export const MAX_URL = 4096;
export const MAX_TITLE = 300;
export const MAX_NAME = 60;
export const MAX_ACK_IDS = 70; // every ack frame stays a small frame, whatever `from`
export const SMALL_FRAME_B64_MAX = 3800;

// Times (PROTOCOL 3.2-3.4).
export const CURSOR_OVERLAP_S = 1800;
export const RESEND_MESSAGE_MS = 11 * 3600000;
export const ATTACHMENT_WAIT_MS = 185 * 60000;
export const RESEND_FAST_WINDOW_MS = 6 * 3600000;
export const RESEND_SLOW_MS = 12 * 3600000;
export const SLOW_FAIL_LIMIT = 3;
export const SENDING_STALE_MS = 15 * 60000;
export const OUTBOX_EXPIRY_MS = 7 * 86400000;
export const CONTENT_KEEP_MS = 14 * 86400000;
export const OUTBOX_MAX_ROWS = 200;
export const SEEN_TTL_MS = 14 * 86400000;
export const SEEN_MSG_TTL_MS = 2 * 86400000;
export const INCOMPLETE_TTL_MS = 86400000;
export const TIMEOUT_SHORT_MS = 60000; // polls and message publishes
export const TIMEOUT_LONG_MS = 1800000; // attachment uploads and downloads

export const PURPOSE_INBOX = 'inbox';
export const PURPOSE_ACK = 'ack';
// Lab lanes (LAB-PROTOCOL 2.4): built in W2 and W3, their AADs fixed now.
export const PURPOSE_LAB_RETURN = 'lab-return';
export const PURPOSE_LAB_RETURN_ACK = 'lab-return-ack';
export const PURPOSE_LAB_CONTROL = 'lab-control';
export const PURPOSE_LAB_CONTROL_ACK = 'lab-control-ack';

/**
 * The Lab storage keys: the Sender ledger's (LAB-PROTOCOL 2.2.6) and the JS LabInbox's `lab/out`. A pairing with
 * another secret removes them (applyPairingChange).
 */
export const LAB_STORAGE_KEYS = ['lab/inbox', 'lab/heard', 'lab/states', 'lab/out'];

/** The values of the `x-cap` item header field (LAB-PROTOCOL 2.3). */
export const X_CAP_VALUES = ['seen', 'clean', 'excerpt', 'test'];
/** The longest `x-orig` a sender writes (LAB-PROTOCOL 2.3); receivers do not apply it. */
export const X_ORIG_MAX = 1024;

const LABEL_KEY = 'dlshare/v1/key';
const LABEL_INBOX = 'dlshare/v1/inbox';
const LABEL_ACK = 'dlshare/v1/ack';
const PAIR_SCHEME = 'daylightshare:';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TEXT_MIMES = /^(text\/|application\/(xhtml\+xml|json|xml|javascript|x-markdown))/i;

/**
 * Every error the library throws. `code` says what failed: for relay publishes 'network', 'full' (413) or 'refused'
 * (another 4xx), with `status` the HTTP status (0 when there was no answer).
 */
export class ShareError extends Error {
  constructor(code, message, reason = '', status = 0) {
    super(message);
    this.name = 'ShareError'; this.code = code; this.reason = reason; this.status = status;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Bytes

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export const utf8 = (s) => enc.encode(s);
export const fromUtf8 = (b) => dec.decode(b);

export function concat(...parts) { return concatList(parts); }

function concatList(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex) {
  if (hex.length % 2 || /[^0-9a-f]/i.test(hex)) throw new ShareError('hex', 'not hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();

export function toBase64(bytes) {
  const out = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out.push(B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]);
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8);
    out.push(B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + '=');
  }
  return out.join('');
}

/** Strict standard base64 (padding optional, no whitespace inside). Throws on anything else. */
export function fromBase64(s) {
  s = s.trim();
  if (s.length % 4 === 1) throw new ShareError('base64', 'bad base64 length');
  const clean = s.replace(/=+$/, '');
  if (s.length - clean.length > 2) throw new ShareError('base64', 'bad padding');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const v = c < 128 ? B64_INV[c] : -1;
    if (v < 0) throw new ShareError('base64', 'bad base64 character');
    buf = ((buf << 6) | v) & 0xffffff; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

export function toBase32(bytes) {
  let out = '', buf = 0, bits = 0;
  for (const b of bytes) {
    buf = (buf << 8) | b; bits += 8;
    while (bits >= 5) { bits -= 5; out += B32[(buf >> bits) & 31]; }
    buf &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(buf << (5 - bits)) & 31];
  return out;
}

export function fromBase32(s) {
  const out = [];
  let buf = 0, bits = 0;
  for (const ch of s) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new ShareError('base32', 'bad base32 character');
    buf = (buf << 5) | v; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
    buf &= (1 << bits) - 1;
  }
  return new Uint8Array(out);
}

export function randomBytes(n) {
  const b = new Uint8Array(n);
  // getRandomValues fills at most 65,536 bytes per call.
  for (let o = 0; o < n; o += 65536) globalThis.crypto.getRandomValues(b.subarray(o, Math.min(n, o + 65536)));
  return b;
}

const subtle = () => globalThis.crypto.subtle;

export async function sha256(bytes) {
  return new Uint8Array(await subtle().digest('SHA-256', bytes));
}

export async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Inflates raw DEFLATE as a stream and stops with ShareError('integrity') as soon as the output is longer than
 * `limit`, so a small frame can never make the receiver hold more than `limit` bytes (PROTOCOL 2.3).
 */
export async function inflateRaw(bytes, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const out = [];
  let total = 0;
  for (;;) {
    let r;
    try { r = await reader.read(); } catch { throw new ShareError('integrity', 'bad deflate data'); }
    if (r.done) break;
    total += r.value.length;
    if (total > limit) { await reader.cancel().catch(() => {}); throw new ShareError('integrity', 'size mismatch'); }
    out.push(r.value);
  }
  return concatList(out);
}

// ---------------------------------------------------------------------------------------------------------------
// Pairing (PROTOCOL 1)

export function generateSecret() { return randomBytes(16); }

export async function formatCode(secret, { dashes = true } = {}) {
  if (!(secret instanceof Uint8Array) || secret.length !== 16) throw new ShareError('secret', 'secret must be 16 bytes');
  const check = (await sha256(secret))[0];
  const code = toBase32(concat(secret, Uint8Array.of(check)));
  return dashes ? code.match(/.{1,4}/g).join('-') : code;
}

/** A typed or pasted code -> the 16-byte secret. Throws ShareError('code', ...) with a user-facing message. */
export async function parseCode(input) {
  let s = String(input ?? '').toUpperCase().replace(/[\s\-_.]/g, '');
  s = s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');
  if (s.length !== 28 || !/^[A-Z2-7]+$/.test(s)) {
    throw new ShareError('code', 'A pairing code has 28 letters and digits (7 groups of 4).', 'format');
  }
  const bytes = fromBase32(s);
  const secret = bytes.slice(0, 16);
  if ((await sha256(secret))[0] !== bytes[16]) {
    throw new ShareError('code', 'That code doesn’t check out. Look for a typo.', 'checksum');
  }
  return secret;
}

/**
 * The relay URL rule (PROTOCOL 1.3; vectors > relays). Textual, the same in every language:
 * trim; empty -> https://ntfy.sh; whitespace or a control character left inside is an error; a scheme other than
 * http(s) is an error (never turned into https://…), no scheme -> https://; drop the query, fragment and user info;
 * the host is required and lowercased: ASCII letters, digits, '-' and '.' starting with a letter or digit, or a
 * bracketed IPv6 address of hex digits, ':' and '.' only (no zone id); a port is digits, and is dropped when it is
 * the text "443" (https) or "80" (http), so ":0443" stays; no '.' or '..' path segments; trailing slashes removed.
 * Throws ShareError('relay').
 */
export function normalizeRelay(relay) {
  const bad = (message = 'That relay address isn’t valid.') => { throw new ShareError('relay', message); };
  let s = String(relay ?? '').trim();
  if (!s) return DEFAULT_RELAY;
  if (/[\s\p{Cc}]/u.test(s)) bad();
  let scheme = 'https';
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(s);
  if (m) {
    scheme = m[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') bad('The relay must be an http(s) address.');
    s = s.slice(m[0].length);
  }
  const end = s.search(/[/?#]/);
  const authority = end < 0 ? s : s.slice(0, end);
  let path = end < 0 ? '' : s.slice(end).split(/[?#]/, 1)[0];
  const hostport = authority.slice(authority.lastIndexOf('@') + 1);
  let host, port = '';
  if (hostport.startsWith('[')) {
    const close = hostport.indexOf(']');
    if (close < 0) bad();
    host = hostport.slice(0, close + 1).toLowerCase();
    const after = hostport.slice(close + 1);
    if (after && !/^:[0-9]*$/.test(after)) bad();
    port = after.slice(1);
    if (!/^\[[0-9a-f:.]+\]$/.test(host)) bad();
  } else {
    const colon = hostport.indexOf(':');
    host = (colon < 0 ? hostport : hostport.slice(0, colon)).toLowerCase();
    if (colon >= 0) port = hostport.slice(colon + 1);
    if (!/^[0-9]*$/.test(port)) bad();
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(host)) bad();
  }
  if ((scheme === 'https' && port === '443') || (scheme === 'http' && port === '80')) port = '';
  if (path.split('/').some((seg) => seg === '.' || seg === '..')) bad();
  path = path.replace(/\/+$/, '');
  return `${scheme}://${host}${port ? ':' + port : ''}${path}`;
}

/**
 * The relay as people see it: the normalised relay's host and port, as text (no URL parser), e.g.
 * "relay.example.org", "relay.example.org:8443", "[::1]:8080". Throws ShareError('relay') like normalizeRelay.
 */
export function relayHost(relay) {
  const r = normalizeRelay(relay);
  return r.slice(r.indexOf('://') + 3).split('/', 1)[0];
}

export function cleanName(name) {
  const s = String(name ?? '').replace(/[\p{Cc}\s]+/gu, ' ').trim();
  return s ? [...s].slice(0, MAX_NAME).join('') : '';
}

export async function pairingLink({ secret, relay = DEFAULT_RELAY, name = '' }) {
  const p = new URLSearchParams();
  p.set('c', await formatCode(secret, { dashes: false }));
  const r = normalizeRelay(relay);
  if (r !== DEFAULT_RELAY) p.set('r', r);
  const n = cleanName(name);
  if (n) p.set('n', n);
  return `daylightshare://pair?${p.toString().replace(/\+/g, '%20')}`;
}

/** A pairing link, a typed code, or a code with dashes -> {secret, relay, name, code}. */
export async function parsePairing(input) {
  const s = String(input ?? '').trim();
  if (s.toLowerCase().startsWith(PAIR_SCHEME)) {
    const q = s.includes('?') ? s.slice(s.indexOf('?') + 1).split('#')[0] : '';
    const p = new URLSearchParams(q);
    const secret = await parseCode(p.get('c') ?? '');
    return { secret, relay: normalizeRelay(p.get('r') ?? ''), name: cleanName(p.get('n') ?? ''), code: await formatCode(secret) };
  }
  const secret = await parseCode(s);
  return { secret, relay: DEFAULT_RELAY, name: '', code: await formatCode(secret) };
}

/** True when two pairings ({secret: Uint8Array, …}) share the same secret: the outbox stays (PROTOCOL 3.3 step 6). */
export function samePairingSecret(a, b) {
  const sa = a?.secret, sb = b?.secret;
  if (!(sa instanceof Uint8Array) || !(sb instanceof Uint8Array) || sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

/**
 * What an app does with a pairing that arrives (PROTOCOL 1.3 "Confirmation"; vectors > pairingConfirmation).
 * current: the pairing in use, or null. next: the parsed pairing. source: 'link' (a QR code scanned with the camera,
 * a tapped link, the web sender's #pair=) or 'app' (typed, pasted or scanned on the app's own pairing screen).
 * -> {ask, title, lines, button, notice}: when `ask`, show title, lines and the buttons `button` and "Cancel", and pair
 * only on `button`; otherwise pair at once and show `notice` when it is not null. The relay is named by relayHost()
 * (host and port, e.g. "relay.example.org:8443"). Pairing (or switching) is then applyPairingChange() + saving it.
 */
export function pairingConfirmation(current, next, { source = 'link' } = {}) {
  const nextRelay = normalizeRelay(next?.relay);
  if (current && samePairingSecret(current, next)) {
    const moved = normalizeRelay(current.relay) !== nextRelay;
    return { ask: false, title: null, lines: [], button: null,
      notice: moved ? `Pairing updated: now sending through ${relayHost(nextRelay)}.` : 'Pairing updated.' };
  }
  const replaces = !!current?.secret;
  if (source === 'app' && !replaces) return { ask: false, title: null, lines: [], button: null, notice: null };
  const lines = [`Code starts ${toBase32(next.secret).slice(0, 4)}. Check it matches the code on your Daylight.`];
  if (nextRelay !== DEFAULT_RELAY) lines.push(`Sends through ${relayHost(nextRelay)}.`);
  if (replaces) {
    lines.push(`This replaces ${cleanName(current.name) || 'your current Daylight'}. Items not yet delivered to it will not be sent.`);
  }
  return { ask: true, title: `Pair with ${cleanName(next.name) || 'a Daylight'}?`, lines, button: replaces ? 'Switch' : 'Pair', notice: null };
}

/** The derived values (PROTOCOL 1.4). `key` is a non-extractable WebCrypto AES-GCM key. */
export async function deriveKeys(secret) {
  const keyBytes = await sha256(concat(utf8(LABEL_KEY), secret));
  const inboxTopic = 'dls-' + toHex(await sha256(concat(utf8(LABEL_INBOX), secret))).slice(0, 32);
  const ackTopic = 'dls-' + toHex(await sha256(concat(utf8(LABEL_ACK), secret))).slice(0, 32);
  const key = await subtle().importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { key, keyBytes, inboxTopic, ackTopic };
}

// ---------------------------------------------------------------------------------------------------------------
// Frames (PROTOCOL 2)

const AADS = {
  inbox: LABEL_INBOX,
  ack: LABEL_ACK,
  'lab-return': 'dlshare/v1/lab-return',
  'lab-return-ack': 'dlshare/v1/lab-return-ack',
  'lab-control': 'dlshare/v1/lab-control',
  'lab-control-ack': 'dlshare/v1/lab-control-ack',
};

/** The AAD bytes of a purpose: an explicit map (LAB-PROTOCOL 2.4). An unknown purpose throws ShareError('purpose'). */
export function aadFor(purpose) {
  if (typeof purpose !== 'string' || !Object.hasOwn(AADS, purpose)) throw new ShareError('purpose', `unknown purpose ${purpose}`);
  return utf8(AADS[purpose]);
}

/** Low level: seal already-serialised header bytes and a body (no header size check). Used by the vectors. */
export async function sealFrame(keys, purpose, headerBytes, body = new Uint8Array(0), nonce = randomBytes(12)) {
  if (nonce.length !== 12) throw new ShareError('nonce', 'nonce must be 12 bytes');
  const aad = aadFor(purpose);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, headerBytes.length, false);
  const plain = concat(len, headerBytes, body);
  const ct = new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, keys.key, plain));
  return concat(utf8(MAGIC), nonce, ct);
}

/** Seals a header object and a body. A sender never seals a header longer than MAX_HEADER bytes. */
export async function encryptFrame(keys, purpose, header, body, nonce) {
  const headerBytes = utf8(JSON.stringify(header));
  if (headerBytes.length > MAX_HEADER) throw new ShareError('header', `header of ${headerBytes.length} bytes (at most ${MAX_HEADER})`);
  return sealFrame(keys, purpose, headerBytes, body, nonce);
}

/** Frame bytes -> {header, body}. Throws ShareError('frame', ...) for anything that is not a valid frame. */
export async function decryptFrame(keys, purpose, frame) {
  const aad = aadFor(purpose);
  if (!(frame instanceof Uint8Array) || frame.length < 4 + 12 + 16 + 4) throw new ShareError('frame', 'too short');
  for (let i = 0; i < 4; i++) if (frame[i] !== MAGIC.charCodeAt(i)) throw new ShareError('frame', 'bad magic');
  let plain;
  try {
    plain = new Uint8Array(await subtle().decrypt(
      { name: 'AES-GCM', iv: frame.subarray(4, 16), additionalData: aad, tagLength: 128 },
      keys.key, frame.subarray(16)));
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

// ---------------------------------------------------------------------------------------------------------------
// Items (PROTOCOL 2.1-2.3)

export function newItemId() { return toHex(randomBytes(16)); }
export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();

/**
 * The web URL rule (PROTOCOL 4 "Web URL"; vectors > urls): the trimmed input unchanged, or null. Textual, so every
 * language decides the same way: no whitespace or control characters, at most 4096 UTF-16 units, http:// or https://
 * (any case), a non-empty host that does not start with '.' and has none of < > ^ | \, and a port of digits only.
 */
export function webUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > MAX_URL || /[\s\p{Cc}]/u.test(s)) return null;
  const head = s.slice(0, 8).toLowerCase();
  if (!head.startsWith('http://') && !head.startsWith('https://')) return null;
  const rest = s.slice(s.indexOf('://') + 3);
  const authority = rest.split(/[/?#]/, 1)[0];
  const hostport = authority.slice(authority.lastIndexOf('@') + 1);
  let host;
  if (hostport.startsWith('[')) {
    const close = hostport.indexOf(']');
    if (close < 0) return null;
    host = hostport.slice(0, close + 1);
    const after = hostport.slice(close + 1);
    if (after && !/^:[0-9]*$/.test(after)) return null;
  } else {
    const colon = hostport.indexOf(':');
    host = colon < 0 ? hostport : hostport.slice(0, colon);
    if (colon >= 0 && !/^[0-9]*$/.test(hostport.slice(colon + 1))) return null;
  }
  if (!host || host.startsWith('.') || /[<>^|\\]/.test(host)) return null;
  return s;
}

/** The first http(s) URL in a piece of shared text (Android share sheets send "Title https://..."). */
export function findUrl(text) {
  const m = String(text ?? '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? webUrl(m[0].replace(/[),.;!?]+$/, '')) : null;
}

export function cleanTitle(t) {
  const s = String(t ?? '').replace(/[\p{Cc}\s]+/gu, ' ').trim();
  return s ? [...s].slice(0, MAX_TITLE).join('') : '';
}

const utf8Length = (s) => enc.encode(s).length;

/** Removes UTF-16 code units D800-DFFF that are not part of a surrogate pair. */
function dropLoneSurrogates(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { out += s[i] + s[i + 1]; i++; }
    } else if (c < 0xdc00 || c > 0xdfff) {
      out += s[i];
    }
  }
  return out;
}

/**
 * A safe file name for an untrusted one (PROTOCOL 5; vectors > fileNames, fileNamesUtf16): remove lone surrogates;
 * split on runs of / and \; in each segment turn each run of control characters and : * ? " < > | into one space,
 * each run of whitespace into one space, drop leading dots and whitespace, trim; drop empty segments; join with one
 * space; empty -> fallback. Over 120 UTF-16 units or 200 UTF-8 bytes: keep the extension (from the last '.', if that
 * is not the first character and 1-10 units follow it) and remove whole code points from the end of the rest until
 * both limits hold.
 */
export function safeFileName(name, fallback = 'document') {
  const segs = dropLoneSurrogates(String(name ?? '')).split(/[\\/]+/)
    .map((seg) => seg.replace(/[\p{Cc}:*?"<>|]+/gu, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+/, '').trim())
    .filter(Boolean);
  const s = segs.join(' ') || fallback;
  if (s.length <= 120 && utf8Length(s) <= 200) return s;
  const dot = s.lastIndexOf('.');
  const ext = dot > 0 && s.length - dot - 1 >= 1 && s.length - dot - 1 <= 10 ? s.slice(dot) : '';
  const base = [...s.slice(0, s.length - ext.length)];
  let units = base.reduce((n, cp) => n + cp.length, 0) + ext.length;
  let bytes = utf8Length(base.join('')) + utf8Length(ext);
  while (base.length && (units > 120 || bytes > 200)) {
    const cp = base.pop();
    units -= cp.length; bytes -= utf8Length(cp);
  }
  return base.join('') + ext;
}

/** Sizes for people: ceil(bytes / 100,000) / 10 without a trailing ".0" (9,000,001 -> "9.1", 12,000,000 -> "12"). */
export function formatMB(bytes) {
  const tenths = Math.ceil(Number(bytes) / 100000);
  return tenths % 10 ? `${Math.floor(tenths / 10)}.${tenths % 10}` : String(tenths / 10);
}

/** The sentence for content over MAX_ITEM, at share time and on an expired / too-large row. */
export const tooBigMessage = (size) => `Too big to send. Files can be up to 9 MB; this one is ${formatMB(size)} MB.`;

const shouldCompress = (mime) => TEXT_MIMES.test(mime || '');

/**
 * Builds the frames for one item.
 * item: {kind: 'url'|'page'|'file', url?, title?, name?, mime?, content?: Uint8Array|string, from?, app?, id?, sent?,
 *        extras?: {'x-cap'?, 'x-orig'?}}
 * opts: {compress?: boolean (default: text types only), chunkSize? (tests), nonces?: Uint8Array[] (tests)}
 * -> {id, header (of part 0, without the Lab fields), frames: Uint8Array[], encodedLength, attachment: boolean,
 *     extras (the Lab fields part 0 carries: labHeaderFields)}
 * Lab senders pass `extras` only with Lab on (LAB-PROTOCOL 2.3); without it the frames are exactly v1.1's.
 * Throws ShareError('too-large', tooBigMessage(size)) for content over MAX_ITEM bytes (before compression).
 */
export async function buildItemFrames(keys, item, opts = {}) {
  const kind = item.kind;
  if (!['url', 'page', 'file'].includes(kind)) throw new ShareError('kind', `unknown kind ${kind}`);
  const id = item.id ?? newItemId();
  if (!/^[0-9a-f]{32}$/.test(id)) throw new ShareError('id', 'bad item id');
  const header = { v: PROTOCOL_VERSION, id, kind };
  const url = item.url != null && item.url !== '' ? webUrl(item.url) : null;
  if ((kind === 'url' || kind === 'page') && !url) throw new ShareError('url', 'That isn’t a web address.');
  if (url) header.url = url;
  const title = cleanTitle(item.title);
  if (title) header.title = title;

  let content = new Uint8Array(0);
  if (kind !== 'url') {
    content = typeof item.content === 'string' ? utf8(item.content) : item.content;
    if (!(content instanceof Uint8Array)) throw new ShareError('content', 'missing content');
    if (kind === 'page') {
      header.mime = 'text/html';
      if (content.length > MAX_PAGE_HTML) throw new ShareError('too-large', 'The page is too large; send the link instead.');
    } else {
      header.name = safeFileName(item.name, 'document');
      header.mime = String(item.mime || 'application/octet-stream').toLowerCase().slice(0, 100);
    }
    if (content.length > MAX_ITEM) throw new ShareError('too-large', tooBigMessage(content.length));
    header.size = content.length;
    header.sha256 = toHex(await sha256(content));
  }

  const compress = kind !== 'url' && (opts.compress ?? (kind === 'page' || shouldCompress(header.mime)));
  let encoded = content;
  if (compress && content.length > 0) {
    const z = await deflateRaw(content);
    if (z.length < content.length) { encoded = z; header.enc = 'deflate-raw'; }
  }

  header.sent = item.sent ?? nowIso();
  const from = cleanName(item.from);
  if (from) header.from = from;
  if (item.app) header.app = String(item.app).slice(0, 60);

  const chunkSize = opts.chunkSize ?? CHUNK;
  const parts = Math.max(1, Math.ceil(encoded.length / chunkSize));
  if (parts > MAX_PARTS) throw new ShareError('too-large', 'That file is too large to send.');
  const extras = labHeaderFields(item.extras);
  const frames = [];
  let attachment = false;
  for (let i = 0; i < parts; i++) {
    const h = parts > 1 ? { ...header, part: i, parts } : header;
    const chunk = encoded.subarray(i * chunkSize, Math.min(encoded.length, (i + 1) * chunkSize));
    let frame;
    if (i === 0 && (extras['x-cap'] || extras['x-orig'])) {
      // The Lab fields ride on part 0 only, where receivers read them. x-orig is left out when it alone would turn a
      // small frame into a large one (an attachment: kept 3 h, re-sent at 185 minutes).
      frame = await encryptFrame(keys, PURPOSE_INBOX, { ...h, ...extras }, chunk, opts.nonces?.[i]);
      if (extras['x-orig'] && !isSmallFrame(frame)) {
        const { 'x-orig': _orig, ...rest } = extras;
        const without = await encryptFrame(keys, PURPOSE_INBOX, { ...h, ...rest }, chunk, opts.nonces?.[i]);
        if (isSmallFrame(without)) { delete extras['x-orig']; frame = without; }
      }
    } else {
      frame = await encryptFrame(keys, PURPOSE_INBOX, h, chunk, opts.nonces?.[i]);
    }
    if (!isSmallFrame(frame)) attachment = true;
    frames.push(frame);
  }
  return { id, header, frames, encodedLength: encoded.length, attachment, extras };
}

/**
 * The Lab item header fields a sender may write (LAB-PROTOCOL 2.3), from a request {'x-cap'?, 'x-orig'?}: `x-cap`
 * when it is one of X_CAP_VALUES; `x-orig` when it passes the web URL rule (the trimmed value) and is at most
 * X_ORIG_MAX characters. Anything else is left out. -> {} or {'x-cap'?, 'x-orig'?}. buildItemFrames also leaves
 * x-orig out when it would make a small frame large.
 */
export function labHeaderFields(extras) {
  const out = {};
  if (!extras || typeof extras !== 'object') return out;
  if (typeof extras['x-cap'] === 'string' && X_CAP_VALUES.includes(extras['x-cap'])) out['x-cap'] = extras['x-cap'];
  if (typeof extras['x-orig'] === 'string') {
    const u = webUrl(extras['x-orig']);
    if (u && u.length <= X_ORIG_MAX) out['x-orig'] = u;
  }
  return out;
}

/** An ack frame for at most MAX_ACK_IDS ids (the rest are cut: callers slice into frames of MAX_ACK_IDS). */
export async function buildAckFrame(keys, ids, { from = 'Daylight', sent = nowIso(), nonce } = {}) {
  const header = { v: PROTOCOL_VERSION, kind: 'ack', ids: ids.slice(0, MAX_ACK_IDS), sent };
  const f = cleanName(from);
  if (f) header.from = f;
  return encryptFrame(keys, PURPOSE_ACK, header, new Uint8Array(0), nonce);
}

/**
 * The Lab extras of an item header (LAB-PROTOCOL 2.3; vectors > labHeaderExtras): `x-cap` when it is one of
 * X_CAP_VALUES and `x-orig` when it passes the web URL rule (the trimmed value), read from part 0 only. Every other
 * `x-` field is dropped. -> {} or {'x-cap'?, 'x-orig'?}
 */
export function itemHeaderExtras(h) {
  const out = {};
  if (!h || typeof h !== 'object' || (h.part ?? 0) !== 0) return out;
  if (typeof h['x-cap'] === 'string' && X_CAP_VALUES.includes(h['x-cap'])) out['x-cap'] = h['x-cap'];
  if (typeof h['x-orig'] === 'string') {
    const u = webUrl(h['x-orig']);
    if (u) out['x-orig'] = u;
  }
  return out;
}

/**
 * Validates an incoming item header (untrusted). Returns a cleaned copy or throws ShareError('header'). The copy has
 * `extras`: the Lab fields of part 0 (itemHeaderExtras), {} on later parts. Reassembler.add moves them out of the
 * header into the item's own `extras`.
 */
export function checkItemHeader(h) {
  const bad = (why) => { throw new ShareError('header', why); };
  if (typeof h.id !== 'string' || !/^[0-9a-f]{32}$/.test(h.id)) bad('id');
  if (!['url', 'page', 'file'].includes(h.kind)) bad('kind');
  const out = { v: 1, id: h.id, kind: h.kind };
  if (h.url != null) { const u = webUrl(h.url); if (!u) bad('url'); out.url = u; }
  if ((h.kind === 'url' || h.kind === 'page') && !out.url) bad('url required');
  const title = cleanTitle(h.title);
  if (title) out.title = title;
  if (h.kind !== 'url') {
    const maxSize = h.kind === 'page' ? MAX_PAGE_HTML : MAX_DECODED;
    if (!Number.isSafeInteger(h.size) || h.size < 0 || h.size > maxSize) bad('size');
    if (typeof h.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(h.sha256)) bad('sha256');
    out.size = h.size; out.sha256 = h.sha256;
    out.mime = h.kind === 'page' ? 'text/html' : String(h.mime || 'application/octet-stream').toLowerCase().slice(0, 100);
    if (h.kind === 'file') out.name = safeFileName(h.name, 'document');
  }
  const e = h.enc ?? 'identity';
  if (e !== 'identity' && e !== 'deflate-raw') bad('enc');
  out.enc = e;
  const parts = h.parts ?? 1, part = h.part ?? 0;
  if (!Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS || !Number.isInteger(part) || part < 0 || part >= parts) bad('parts');
  out.parts = parts; out.part = part;
  out.sent = typeof h.sent === 'string' ? h.sent.slice(0, 40) : '';
  const from = cleanName(h.from);
  if (from) out.from = from;
  if (typeof h.app === 'string') out.app = h.app.slice(0, 60);
  out.extras = part === 0 ? itemHeaderExtras(h) : {};
  return out;
}

/**
 * Collects parts. add() returns {header, content, msgIds, extras} once an item is complete and verified, else null.
 * `extras` holds the Lab fields of part 0 (checkItemHeader); `header` is the cleaned header without part, parts and
 * extras.
 * meta: {time (relay seconds, default now), msgId} of the message that carried the part; a pending item remembers its
 * earliest time and its message ids. On an integrity failure the item is dropped and the thrown ShareError carries
 * `msgIds`. A deflate-raw stream runs across parts, so parts are joined before decoding (PROTOCOL 2.3).
 */
export class Reassembler {
  constructor({ now = () => Date.now() } = {}) { this.pending = new Map(); this.now = now; }

  isPending(id) { return this.pending.has(id); }

  /** Forgets a pending item. -> the message ids of its held parts. */
  drop(id) {
    const p = this.pending.get(id);
    this.pending.delete(id);
    return p ? [...p.msgIds] : [];
  }

  /** Drops pending items whose first part is older than maxAgeMs. -> their ids. */
  prune(maxAgeMs) {
    const now = this.now();
    const out = [];
    for (const [id, p] of this.pending) if (now - p.first * 1000 > maxAgeMs) { this.pending.delete(id); out.push(id); }
    return out;
  }

  async add(rawHeader, body, { time, msgId } = {}) {
    const h = checkItemHeader(rawHeader);
    const t = Number.isFinite(time) ? time : Math.floor(this.now() / 1000);
    if (h.kind === 'url') {
      const { part, parts, extras, ...header } = h;
      return { header, content: new Uint8Array(0), msgIds: msgId ? [msgId] : [], extras };
    }
    let p = this.pending.get(h.id);
    if (!p || p.parts !== h.parts) {
      p = { parts: h.parts, chunks: new Map(), header: h, first: t, msgIds: new Set() };
      this.pending.set(h.id, p);
    }
    p.first = Math.min(p.first, t);
    if (msgId) p.msgIds.add(msgId);
    p.chunks.set(h.part, body.slice());
    if (h.part === 0) p.header = h;
    if (p.chunks.size < p.parts) return null;
    this.pending.delete(h.id);
    const msgIds = [...p.msgIds];
    try {
      const encoded = concatList(Array.from({ length: p.parts }, (_, i) => p.chunks.get(i)));
      const content = p.header.enc === 'deflate-raw' ? await inflateRaw(encoded, p.header.size) : encoded;
      if (content.length !== p.header.size) throw new ShareError('integrity', 'size mismatch');
      if (toHex(await sha256(content)) !== p.header.sha256) throw new ShareError('integrity', 'sha256 mismatch');
      const { part, parts, extras, ...header } = p.header;
      return { header, content, msgIds, extras };
    } catch (e) {
      if (e instanceof ShareError) e.msgIds = msgIds;
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Transport over ntfy (PROTOCOL 3)

export const isSmallFrame = (frame) => Math.ceil(frame.length / 3) * 4 <= SMALL_FRAME_B64_MAX;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A timer that aborts a request and rejects race()d promises, even for a fetch that ignores its signal. */
function deadline(ms) {
  const ctrl = new AbortController();
  let fail;
  const expired = new Promise((_, reject) => { fail = reject; });
  expired.catch(() => {});
  const timer = setTimeout(() => {
    const e = new ShareError('network', `timed out after ${ms} ms`, 'timeout');
    ctrl.abort(e); fail(e);
  }, ms);
  return { signal: ctrl.signal, race: (p) => Promise.race([p, expired]), clear: () => clearTimeout(timer) };
}

const discard = (res) => { try { res.body?.cancel?.()?.catch?.(() => {}); } catch { /* already used */ } };

/** Reads a response body up to `cap` bytes. -> the bytes, or null when it is longer (the read stops there). */
async function readCapped(res, cap) {
  const len = res.headers?.get?.('content-length');
  if (len != null && len !== '' && Number(len) > cap) { discard(res); return null; }
  if (!res.body?.getReader) {
    const b = new Uint8Array(await res.arrayBuffer());
    return b.length > cap ? null : b;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) { reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return concatList(chunks);
}

/** The cursor after a poll (PROTOCOL 3.2): max(0, min(newest, held) - 1800); never backwards when nothing is held. */
function nextCursor(since, newest, held) {
  const c = Math.max(0, Math.min(newest, held) - CURSOR_OVERLAP_S);
  return held === Infinity && typeof since === 'number' && since > c ? since : c;
}

export class RelayClient {
  /**
   * timeouts: {short (polls, message publishes), long (attachment uploads and downloads)} in ms.
   * retryDelaysMs: waits before the in-call retries of a publish after a network error, 408 or 5xx.
   */
  constructor({ relay = DEFAULT_RELAY, fetch: f, timeouts = {}, retryDelaysMs = [1000, 2000, 4000] } = {}) {
    this.relay = normalizeRelay(relay);
    this.origin = new URL(this.relay).origin;
    this.fetch = f ?? ((...a) => globalThis.fetch(...a));
    this.timeouts = { short: timeouts.short ?? TIMEOUT_SHORT_MS, long: timeouts.long ?? TIMEOUT_LONG_MS };
    this.retryDelaysMs = retryDelaysMs;
  }

  async _request(url, init, ms, read) {
    const d = deadline(ms);
    try {
      const res = await d.race(this.fetch(url, { ...init, signal: d.signal }));
      const body = await d.race(read(res));
      return { res, body };
    } finally { d.clear(); }
  }

  /**
   * Publishes one frame (PROTOCOL 3.1). -> {id, time, attachment}. Throws ShareError with code 'network' (no answer,
   * timeout, 408 or 5xx after the in-call retries; or 429, never retried here), 'full' (413) or 'refused' (any other
   * 4xx), and `status` (0 when there was no answer).
   */
  async publish(topic, frame, { retries = this.retryDelaysMs.length } = {}) {
    const small = isSmallFrame(frame);
    const init = small
      ? { method: 'POST', headers: { 'Content-Type': 'text/plain', Firebase: 'no', Cache: 'yes' }, body: toBase64(frame) }
      : { method: 'PUT', headers: { Filename: 'dls1.bin', Message: 'dls1', Firebase: 'no', Cache: 'yes' }, body: frame };
    const ms = small ? this.timeouts.short : this.timeouts.long;
    for (let attempt = 0; ; attempt++) {
      let res, body;
      try {
        ({ res, body } = await this._request(`${this.relay}/${topic}`, init, ms,
          async (r) => (r.ok ? r.json().catch(() => ({})) : (discard(r), null))));
      } catch (e) {
        if (attempt < retries) { await sleep(this.retryDelaysMs[attempt] ?? 0); continue; }
        throw new ShareError('network', `network error: ${e?.message ?? e}`, 'network', 0);
      }
      if (res.ok) return { id: body?.id ?? null, time: body?.time ?? null, attachment: !small };
      const s = res.status;
      if (s === 429) throw new ShareError('network', 'HTTP 429', 'rate-limited', s);
      if (s === 413) throw new ShareError('full', 'HTTP 413', 'full', s);
      if (s >= 400 && s < 500 && s !== 408) throw new ShareError('refused', `HTTP ${s}`, 'refused', s);
      if (attempt < retries) {
        const ra = Number(res.headers?.get?.('Retry-After'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : this.retryDelaysMs[attempt] ?? 0);
        continue;
      }
      throw new ShareError('network', `HTTP ${s}`, 'server', s);
    }
  }

  /** Downloads one attachment under the download rule (PROTOCOL 3.2). -> {outcome, frame?, status?} */
  async _download(url) {
    let u;
    try { u = new URL(url); } catch { return { outcome: 'junk' }; }
    if (u.protocol !== 'https:' && u.origin !== this.origin) return { outcome: 'junk' };
    try {
      const { res, body } = await this._request(u.href, { method: 'GET' }, this.timeouts.long,
        async (r) => (r.ok ? readCapped(r, MAX_ATTACHMENT) : (discard(r), null)));
      if (res.ok) return body ? { outcome: 'frame', frame: body, status: res.status } : { outcome: 'junk', status: res.status };
      if (res.status === 404 || res.status === 410) return { outcome: 'expired', status: res.status };
      return { outcome: 'retry', status: res.status };
    } catch {
      return { outcome: 'retry', status: 0 };
    }
  }

  /**
   * Polls cached messages (PROTOCOL 3.2). since: 'all' | unix seconds. skip(msgId): true for handled messages.
   * -> [{id, time, attachment, outcome, frame, status?}], one per message line, where outcome is
   *    'frame' (frame holds the bytes), 'skipped', 'expired' (404/410), 'junk' (not base64, a URL that is not https
   *    or the relay's origin, or over MAX_ATTACHMENT) or 'retry' (429, 5xx, any other status, network error,
   *    timeout; after a 429 every later attachment entry is 'retry' without a request). An entry whose attachment
   *    was requested also has `status`: the download's HTTP status, 0 when there was no answer.
   * Throws ShareError: 'network' (no answer, status 0), 'relay' (an error status, or an answer over 64 MiB).
   */
  async poll(topic, since = 'all', { skip = () => false } = {}) {
    let res, body;
    try {
      ({ res, body } = await this._request(`${this.relay}/${topic}/json?poll=1&since=${encodeURIComponent(since)}`,
        { method: 'GET' }, this.timeouts.short, async (r) => (r.ok ? readCapped(r, MAX_POLL_RESPONSE) : (discard(r), null))));
    } catch (e) {
      throw new ShareError('network', `Couldn’t reach the relay (${e?.message ?? e}).`, 'network', 0);
    }
    if (!res.ok) throw new ShareError('relay', `The relay answered ${res.status}.`, 'status', res.status);
    if (!body) throw new ShareError('relay', 'The relay’s answer is too long.', 'too-long', res.status);
    const out = [];
    let stopDownloads = false;
    for (const line of new TextDecoder().decode(body).split('\n')) {
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (!m || m.event !== 'message' || typeof m.id !== 'string') continue;
      const entry = { id: m.id, time: Number(m.time) || 0, attachment: !!m.attachment, outcome: 'junk', frame: null };
      out.push(entry);
      if (skip(m.id)) { entry.outcome = 'skipped'; continue; }
      if (m.attachment) {
        if (typeof m.attachment.url !== 'string') continue;
        if (stopDownloads) { entry.outcome = 'retry'; continue; }
        const d = await this._download(m.attachment.url);
        entry.outcome = d.outcome;
        if (d.frame) entry.frame = d.frame;
        if (d.status !== undefined) entry.status = d.status;
        if (d.status === 429) stopDownloads = true;
      } else if (typeof m.message === 'string') {
        try { entry.frame = fromBase64(m.message); entry.outcome = 'frame'; } catch { /* junk */ }
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Storage adapters: {get(key) -> value|undefined, set(key, value), remove(key)}; values are JSON-serialisable.

export class MemoryStorage {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? structuredClone(this.m.get(k)) : undefined; }
  async set(k, v) { this.m.set(k, structuredClone(v)); }
  async remove(k) { this.m.delete(k); }
}

/** Saves and loads the pairing ({code, relay, name}) under one key. */
export async function savePairing(storage, pairing) {
  await storage.set('pairing', { code: await formatCode(pairing.secret), relay: normalizeRelay(pairing.relay), name: cleanName(pairing.name) });
}

export async function loadPairing(storage) {
  const p = await storage.get('pairing');
  if (!p?.code) return null;
  return { secret: await parseCode(p.code), relay: normalizeRelay(p.relay), name: p.name ?? '', code: p.code };
}

// One promise chain per storage object and role, so two Senders (or Receivers) on the same storage take turns.
const LOCKS = new WeakMap();
function locked(storage, role, fn) {
  if (storage === null || (typeof storage !== 'object' && typeof storage !== 'function')) return fn();
  let l = LOCKS.get(storage);
  if (!l) { l = {}; LOCKS.set(storage, l); }
  const run = (l[role] ?? Promise.resolve()).then(() => fn());
  l[role] = run.then(() => {}, () => {});
  return run;
}

/**
 * The outbox rule for a pairing change (PROTOCOL 3.3 step 6), applied to the storage a Sender uses, under the same
 * lock. current: the pairing in use (or null); next: the one being applied. The same secret (a new relay or name)
 * keeps the outbox: build a new Sender with `next` and pending rows go through the new relay. A different secret (or
 * no current pairing) deletes every row, their stored content, the ack cursor and the Lab ledger (every `lab/*` key:
 * LAB_STORAGE_KEYS, and any other `lab/` key when the storage can list its keys with `keys()`). -> true when it
 * deleted them.
 */
export function applyPairingChange(storage, current, next) {
  return locked(storage, 'sender', async () => {
    if (current && samePairingSecret(current, next)) return false;
    const rows = (await storage.get('outbox')) ?? [];
    for (const r of rows) if (r?.id) await storage.remove(`outbox/${r.id}`);
    await storage.remove('outbox');
    await storage.remove('ackSince');
    const lab = new Set(LAB_STORAGE_KEYS);
    if (typeof storage.keys === 'function') {
      try { for (const k of await storage.keys()) if (String(k).startsWith('lab/')) lab.add(k); } catch { /* the known keys only */ }
    }
    for (const k of lab) await storage.remove(k);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Status and copy (CHANGES-v1.1 2.5; vectors > statusText): the same words on every surface.

/**
 * -> {label, sentence, action} for an outbox row: sentence is null or one sentence to show under the label; action is
 * null, 'retry-now' (button "Retry now") or 'try-again' (button "Try again"). Every row can also be removed.
 */
export function describeRow(row, now = Date.now()) {
  const out = (label, sentence = null, action = null) => ({ label, sentence, action });
  const code = row?.errorCode ?? '';
  switch (row?.status) {
    case 'sending': return out('Sending…');
    case 'sent':
      return out('Sent · waiting for your Daylight', now - (row.created ?? 0) < 86400000 ? null
        : 'Your Daylight hasn’t picked this up yet. It is sent again twice a day.');
    case 'delivered': return out('Delivered ✓', 'Saved on your Daylight.');
    case 'failed':
      if (code === 'full') return out('Waiting to send', 'A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.');
      if (code === 'refused') return out('Waiting to send', 'The relay set on your Daylight turned this down. It will try again in about 3 hours.');
      return out('Waiting to send', 'Couldn’t send right now. It will try again by itself.', 'retry-now');
    case 'expired':
      if (code === 'full') return out('Not delivered', 'Too much was sent from this network for hours, so it stopped trying. Try again later.', 'try-again');
      if (code === 'refused') return out('Not delivered', 'The relay set on your Daylight keeps turning this down. Check that setting on your Daylight, then try again.', 'try-again');
      if (code === 'too-large') return out('Not delivered', tooBigMessage(row.size ?? 0));
      if (code === 'gone') return out('Not delivered', 'This is no longer stored on this device. Share it again.');
      return out('Not delivered', 'Your Daylight didn’t pick this up within a week. Is it on and online?', 'try-again');
    default: return out('');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Sender (PROTOCOL 3.3)

const PENDING = new Set(['sending', 'sent', 'failed']);
const SLOW_CODES = new Set(['full', 'refused']);

/** A stored row with every v1.1 field (rows saved by v1.0 lack errorCode, slowFails and attemptStarted). */
function normRow(r) {
  return {
    ...r,
    title: r.title ?? '', url: r.url ?? '', name: r.name ?? '', mime: r.mime ?? '', size: r.size ?? 0, sent: r.sent ?? '',
    created: r.created ?? 0, errorCode: r.errorCode ?? '', attempts: r.attempts ?? 0, slowFails: r.slowFails ?? 0,
    lastPublish: r.lastPublish ?? 0, attemptStarted: r.attemptStarted ?? 0, attachment: !!r.attachment,
    error: r.error ?? '', delivered: r.delivered ?? 0,
  };
}

/**
 * The outbox lives in storage under 'outbox' (a list of small rows, newest first), 'outbox/<id>' (the content, base64,
 * kept until delivered, removed or 14 days after the share) and 'ackSince' (the ack cursor).
 * Row: {id, kind, title, url, name, mime, size, sent, created, status, errorCode, attempts, slowFails, lastPublish,
 *       attemptStarted, attachment, error, delivered, extras?}
 * status: sending | sent | delivered | failed | expired. errorCode, for failed and expired: '' | 'network' | 'full' |
 * 'refused' | 'too-large' | 'gone'. `error` is technical detail for logs; show describeRow(row) instead. `extras`
 * (only on rows shared with Lab header fields, item.extras) is what every attempt writes: labHeaderFields.
 * Every public method runs under a lock shared by all Senders on the same storage object.
 *
 * onAckHeader(header, {time, msgId}): called for every ack-topic frame that decrypts and whose `kind` is "ack" (acks
 * and Lab frames alike), in the order the poll returns them, before rows are updated (LAB-PROTOCOL 2.2.6). `time` is
 * the message's relay time in seconds. It may be async; its errors are caught and logged. daylight-lab.js's
 * labHook(ledger) is the Lab one.
 */
export class Sender {
  constructor({ pairing, storage, from = '', app = '', fetch: f, now = () => Date.now(), chunkSize, timeouts, retryDelaysMs, onAckHeader = null } = {}) {
    if (!pairing?.secret) throw new ShareError('pairing', 'Not paired yet.');
    this.pairing = pairing;
    this.storage = storage;
    this.from = from; this.app = app; this.now = now; this.chunkSize = chunkSize;
    this.onAckHeader = typeof onAckHeader === 'function' ? onAckHeader : null;
    this.relay = new RelayClient({ relay: pairing.relay, fetch: f, timeouts, retryDelaysMs });
    this._keys = null;
  }

  async keys() { return (this._keys ??= await deriveKeys(this.pairing.secret)); }

  _lock(fn) { return locked(this.storage, 'sender', fn); }

  async list() { return ((await this.storage.get('outbox')) ?? []).map(normRow); }

  async _content(id) {
    const b64 = await this.storage.get(`outbox/${id}`);
    if (typeof b64 !== 'string') return null;
    try { return fromBase64(b64); } catch { return null; }
  }

  async _dropContent(id) { try { await this.storage.remove(`outbox/${id}`); } catch { /* nothing to drop */ } }

  /** Writes the rows: every pending row, then the newest finished rows up to OUTBOX_MAX_ROWS; drops the rest's content. */
  async _writeRows(rows) {
    rows.sort((a, b) => b.created - a.created);
    const finished = rows.filter((r) => !PENDING.has(r.status));
    const room = Math.max(0, OUTBOX_MAX_ROWS - (rows.length - finished.length));
    const dropped = new Set(finished.slice(room));
    await this.storage.set('outbox', rows.filter((r) => !dropped.has(r)));
    for (const r of dropped) await this._dropContent(r.id);
  }

  async _saveRow(row) {
    const rows = await this.list();
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = row; else rows.unshift(row); // a row keeps its place among rows shared at the same ms
    await this._writeRows(rows);
  }

  /**
   * Shares one item now. -> the outbox row. Throws ShareError for bad input (nothing is stored); relay failures mark the
   * row. With `defer` (offline, F07) nothing is published: the row is stored as failed with code 'network',
   * `attempts` 0 and `lastPublish` now, and the content is kept as usual, for flushNetwork() or the next re-send pass.
   */
  send(item, { defer = false } = {}) { return this._lock(() => this._send(item, { defer })); }

  async _send(item, { defer = false } = {}) {
    const keys = await this.keys();
    const built = await buildItemFrames(keys, { ...item, from: item.from ?? this.from, app: item.app ?? this.app },
      { chunkSize: this.chunkSize });
    const now = this.now();
    const row = {
      id: built.id, kind: item.kind, title: built.header.title ?? '', url: built.header.url ?? '',
      name: built.header.name ?? '', mime: built.header.mime ?? '', size: built.header.size ?? 0,
      sent: built.header.sent, created: now, status: 'sending', errorCode: '', attempts: 0, slowFails: 0,
      lastPublish: 0, attemptStarted: now, attachment: built.attachment, error: '', delivered: 0,
    };
    const extras = labHeaderFields(item.extras);
    if (extras['x-cap'] || extras['x-orig']) row.extras = extras; // re-sends carry the same Lab fields (LAB-PLAN 1.3)
    if (defer) Object.assign(row, { status: 'failed', errorCode: 'network', lastPublish: now, error: 'deferred while offline' });
    await this._saveRow(row);
    if (row.kind !== 'url') {
      const content = typeof item.content === 'string' ? utf8(item.content) : item.content;
      try {
        await this.storage.set(`outbox/${row.id}`, toBase64(content));
      } catch (e) {
        // A browser storage quota: publish once anyway; when a re-send comes due the row becomes expired / gone.
        globalThis.console?.warn?.('Send to Daylight: could not keep a copy for re-sending', e);
      }
    }
    if (defer) return row;
    return (await this._attempt(row, built.frames)).row;
  }

  /** One attempt: publishes the frames in part order and records the outcome (CHANGES-v1.1 2.4). -> {row, error} */
  async _attempt(row, frames) {
    const keys = await this.keys();
    row.status = 'sending'; row.attemptStarted = this.now();
    await this._saveRow(row);
    let error = null;
    try {
      for (const frame of frames) {
        await this.relay.publish(keys.inboxTopic, frame);
        row.attemptStarted = this.now(); await this._saveRow(row); // progress: `sending` is stale 15 min after this
      }
    } catch (e) { error = e; }
    if (!error) {
      Object.assign(row, { status: 'sent', errorCode: '', attempts: 0, slowFails: 0, error: '' });
    } else {
      const code = ['network', 'full', 'refused'].includes(error.code) ? error.code : 'network';
      row.status = 'failed'; row.errorCode = code; row.attempts += 1;
      row.slowFails = SLOW_CODES.has(code) ? row.slowFails + 1 : 0;
      if (row.slowFails >= SLOW_FAIL_LIMIT) row.status = 'expired';
      row.error = String(error?.message ?? error);
    }
    row.lastPublish = this.now();
    await this._saveRow(row);
    return { row, error };
  }

  /**
   * Rebuilds a row's frames from its stored content. -> {built}, or {ended: true} after ending the row (no content:
   * expired/gone; over MAX_ITEM: expired/too-large).
   */
  async _buildStored(row) {
    const end = async (errorCode, dropContent) => {
      row.status = 'expired'; row.errorCode = errorCode;
      await this._saveRow(row);
      if (dropContent) await this._dropContent(row.id);
      return { built: null, ended: true };
    };
    let content = new Uint8Array(0);
    if (row.kind !== 'url') {
      content = await this._content(row.id);
      if (!content) return end('gone', false);
    }
    if (row.size > MAX_ITEM) return end('too-large', true);
    try {
      const built = await buildItemFrames(await this.keys(), {
        id: row.id, kind: row.kind, url: row.url || undefined, title: row.title, name: row.name, mime: row.mime,
        content, sent: row.sent, from: this.from, app: this.app, extras: row.extras,
      }, { chunkSize: this.chunkSize });
      return { built, ended: false };
    } catch (e) {
      return e?.code === 'too-large' ? end('too-large', true) : end('gone', false);
    }
  }

  /** Re-sends a row from its stored content, or ends it (no content: gone; over MAX_ITEM: too-large). */
  async _attemptStored(row) {
    const { built } = await this._buildStored(row);
    if (!built) return { row, error: null, attempted: false };
    row.attachment = built.attachment;
    return { ...(await this._attempt(row, built.frames)), attempted: true };
  }

  _due(row, now) {
    switch (row.status) {
      case 'sending': return now - (row.attemptStarted || row.lastPublish || row.created) >= SENDING_STALE_MS;
      case 'sent':
        if (!row.attachment) return now - row.lastPublish >= RESEND_MESSAGE_MS;
        return now - row.lastPublish >= (row.lastPublish - row.created < RESEND_FAST_WINDOW_MS ? ATTACHMENT_WAIT_MS : RESEND_SLOW_MS);
      case 'failed':
        if (SLOW_CODES.has(row.errorCode)) return now - row.lastPublish >= ATTACHMENT_WAIT_MS;
        return now - row.lastPublish >= 60000 * Math.min(60, 2 ** row.attempts);
      default: return false;
    }
  }

  /** Reads the ack topic and marks delivered rows. -> number of rows newly delivered. Throws when the poll fails. */
  checkAcks() { return this._lock(() => this._checkAcks()); }

  async _checkAcks() {
    const keys = await this.keys();
    const since = (await this.storage.get('ackSince')) ?? 'all';
    const entries = await this.relay.poll(keys.ackTopic, since);
    const acked = new Set();
    let newest = 0, held = Infinity;
    for (const m of entries) {
      newest = Math.max(newest, m.time);
      if (m.outcome === 'retry') held = Math.min(held, m.time);
      if (m.outcome !== 'frame') continue;
      let header;
      try { ({ header } = await decryptFrame(keys, PURPOSE_ACK, m.frame)); } catch { continue; /* junk */ }
      if (header.kind !== 'ack') continue;
      if (this.onAckHeader) {
        try {
          await this.onAckHeader(header, { time: m.time, msgId: m.id });
        } catch (e) {
          globalThis.console?.warn?.('Send to Daylight: onAckHeader failed', e);
        }
      }
      if (Array.isArray(header.ids)) header.ids.forEach((id) => typeof id === 'string' && acked.add(id));
    }
    if (entries.length) await this.storage.set('ackSince', nextCursor(since, newest, held));
    const rows = await this.list();
    const now = this.now();
    const delivered = [];
    for (const row of rows) {
      if (row.status !== 'delivered' && acked.has(row.id)) {
        Object.assign(row, { status: 'delivered', delivered: now, errorCode: '' });
        delivered.push(row.id);
      }
    }
    if (delivered.length) {
      await this._writeRows(rows);
      for (const id of delivered) await this._dropContent(id);
    }
    return delivered.length;
  }

  /**
   * One re-send pass, oldest row first (PROTOCOL 3.3 steps 3-4). Expires week-old rows, drops expired rows' content
   * after 14 days, re-sends rows that are due; after a 429 it publishes nothing more and after a 413 no attachment.
   * -> the rows it attempted.
   */
  resendDue() { return this._lock(() => this._resendDue()); }

  async _resendDue() {
    const pass = { stopAll: false, stopAttachments: false };
    const out = [];
    const rows = (await this.list()).reverse().sort((a, b) => a.created - b.created); // oldest first
    for (const row of rows) {
      const now = this.now();
      if (row.status === 'delivered') continue;
      if (row.status === 'expired') {
        if (now - row.created > CONTENT_KEEP_MS) await this._dropContent(row.id);
        continue;
      }
      if (now - row.created > OUTBOX_EXPIRY_MS) {
        row.status = 'expired'; row.errorCode = '';
        await this._saveRow(row);
        continue;
      }
      if (!this._due(row, now)) continue;
      if (pass.stopAll || (pass.stopAttachments && row.attachment)) continue;
      const r = await this._attemptStored(row);
      if (r.attempted) out.push(r.row);
      if (r.error?.status === 429) pass.stopAll = true;
      else if (r.error?.code === 'full') pass.stopAttachments = true;
    }
    return out;
  }

  /**
   * Coming back online (F07): attempts the rows waiting with errorCode 'network' (status failed) now, oldest first,
   * whatever their back-off. A pass stops before a row that would take it over `maxFrames` frames or
   * `maxAttachmentBytes` bytes of attachment frames (a pass always takes its first row, so a row larger than the caps
   * cannot block the queue). It follows resendDue's pass rules: after a 429 it publishes nothing more, and after a 413
   * no more attachments. Rows past OUTBOX_EXPIRY_MS are left to resendDue, which expires them. Callers space passes at
   * least 3 minutes apart. -> the rows it attempted.
   */
  flushNetwork(opts) { return this._lock(() => this._flushNetwork(opts)); }

  async _flushNetwork({ maxFrames = 30, maxAttachmentBytes = 18_000_000 } = {}) {
    const pass = { stopAll: false, stopAttachments: false };
    let frames = 0, bytes = 0;
    const out = [];
    const rows = (await this.list()).reverse().sort((a, b) => a.created - b.created); // oldest first
    for (const row of rows) {
      if (pass.stopAll) break;
      if (row.status !== 'failed' || row.errorCode !== 'network') continue;
      if (this.now() - row.created > OUTBOX_EXPIRY_MS) continue;
      if (pass.stopAttachments && row.attachment) continue;
      const { built } = await this._buildStored(row);
      if (!built) continue;
      const attachmentBytes = built.frames.reduce((n, f) => n + (isSmallFrame(f) ? 0 : f.length), 0);
      if (pass.stopAttachments && attachmentBytes > 0) continue;
      const first = out.length === 0;
      if (!first && (frames + built.frames.length > maxFrames || bytes + attachmentBytes > maxAttachmentBytes)) break;
      frames += built.frames.length; bytes += attachmentBytes;
      row.attachment = built.attachment;
      const r = await this._attempt(row, built.frames);
      out.push(r.row);
      if (r.error?.status === 429) pass.stopAll = true;
      else if (r.error?.code === 'full') pass.stopAttachments = true;
    }
    return out;
  }

  /**
   * "Retry now" (a failed row) and "Try again" (an expired row, with errorCode '', 'full' or 'refused'): publishes it
   * again with the same id and header. Any other row is left as it is. -> the row, or null when there is none.
   */
  retry(id) { return this._lock(() => this._retry(id)); }

  async _retry(id) {
    const row = (await this.list()).find((r) => r.id === id);
    if (!row) return null;
    if (row.status === 'failed') return (await this._attemptStored(row)).row;
    if (row.status === 'expired' && ['', 'full', 'refused'].includes(row.errorCode)) {
      Object.assign(row, { created: this.now(), attempts: 0, slowFails: 0, errorCode: '' });
      return (await this._attemptStored(row)).row;
    }
    return row;
  }

  /** Removes a row and its content. -> true when there was such a row. */
  remove(id) {
    return this._lock(async () => {
      const rows = await this.list();
      const left = rows.filter((r) => r.id !== id);
      if (left.length !== rows.length) await this.storage.set('outbox', left);
      await this._dropContent(id);
      return left.length !== rows.length;
    });
  }

  /** One maintenance pass: acks (errors ignored), then re-sends. Call on start, after a share, and from timers. */
  tick() {
    return this._lock(async () => {
      let delivered = 0;
      try { delivered = await this._checkAcks(); } catch { /* offline: re-send anyway */ }
      const resent = await this._resendDue();
      return { delivered, resent: resent.length };
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Receiver (PROTOCOL 3.2, 3.4). The Daylight Inbox is the Android app; this one serves tests, demos and the web inbox.
// It keeps held parts in memory (and downloads them again after a restart); the digest is the Inbox's alone.

export class Receiver {
  /**
   * accept: async ({header, content, extras}) => void stores an item durably; it runs before the id is remembered or
   * acked. `extras` holds the item's Lab header fields (checkItemHeader).
   * When it throws, the item's messages are handled but its id is not remembered and it is not acked: it comes back
   * with the sender's next re-send, and pollOnce returns `storeError`.
   */
  constructor({ pairing, storage, fetch: f, from = 'Daylight', now = () => Date.now(), accept = async () => {}, timeouts, retryDelaysMs }) {
    this.pairing = pairing; this.storage = storage; this.from = from; this.now = now; this.accept = accept;
    this.relay = new RelayClient({ relay: pairing.relay, fetch: f, timeouts, retryDelaysMs });
    this.reassembler = new Reassembler({ now });
    this._keys = null;
  }

  async keys() { return (this._keys ??= await deriveKeys(this.pairing.secret)); }

  /**
   * Polls once. -> {items: [{header, content, extras}] (new items, stored), acked: [ids whose ack was published],
   * ackError: string|null, storeError: string|null, limited: 429 or 413 when the relay refused this poll's ack
   * publish for its limits, else 429 when it answered an attachment download with 429 (that item waits for a later
   * poll), else 0}. A Lab Inbox gives way for an hour after any of them (LAB-PROTOCOL 2.2.4). Throws only when the
   * poll itself fails (a 429 on the poll is the error's `status`); acks never throw.
   */
  pollOnce() { return locked(this.storage, 'receiver', () => this._pollOnce()); }

  async _pollOnce() {
    const keys = await this.keys();
    const now = this.now();
    const get = async (k) => (await this.storage.get(k)) ?? {};
    const seen = await get('seenItems');
    const seenMsgs = await get('seenMsgs');
    const incomplete = await get('incomplete');
    for (const [k, t] of Object.entries(seen)) if (now - t > SEEN_TTL_MS) delete seen[k];
    for (const [k, t] of Object.entries(seenMsgs)) if (now - t > SEEN_MSG_TTL_MS) delete seenMsgs[k];
    for (const [k, t] of Object.entries(incomplete)) {
      if (now - t * 1000 > INCOMPLETE_TTL_MS) { delete incomplete[k]; this.reassembler.drop(k); }
    }
    for (const k of this.reassembler.prune(INCOMPLETE_TTL_MS)) delete incomplete[k];

    const since = (await this.storage.get('inboxSince')) ?? 'all';
    const entries = await this.relay.poll(keys.inboxTopic, since, { skip: (id) => Object.hasOwn(seenMsgs, id) });
    const items = [];
    const ack = new Set();
    const handled = (ids) => { for (const id of ids) seenMsgs[id] = now; };
    let newest = 0, held = Infinity, storeError = null, downloadLimited = 0;
    for (const m of entries) {
      newest = Math.max(newest, m.time);
      if (m.status === 429) downloadLimited = 429;
      if (m.outcome === 'skipped') continue;
      if (m.outcome === 'retry') { held = Math.min(held, m.time); continue; }
      if (m.outcome !== 'frame') { handled([m.id]); continue; }
      let frame;
      try { frame = await decryptFrame(keys, PURPOSE_INBOX, m.frame); } catch { handled([m.id]); continue; }
      const rawId = typeof frame.header.id === 'string' ? frame.header.id : null;
      if (rawId !== null && Object.hasOwn(seen, rawId)) { seen[rawId] = now; handled([m.id]); ack.add(rawId); continue; }
      let done;
      try {
        done = await this.reassembler.add(frame.header, frame.body, { time: m.time, msgId: m.id });
      } catch (e) {
        handled([m.id, ...(e?.msgIds ?? []), ...(rawId !== null ? this.reassembler.drop(rawId) : [])]);
        if (rawId !== null) delete incomplete[rawId];
        continue;
      }
      if (!done) { incomplete[rawId] = Math.min(incomplete[rawId] ?? m.time, m.time); continue; }
      handled([m.id, ...done.msgIds]);
      delete incomplete[done.header.id];
      try {
        await this.accept({ header: done.header, content: done.content, extras: done.extras });
      } catch (e) {
        storeError = String(e?.message ?? e);
        continue;
      }
      seen[done.header.id] = now;
      ack.add(done.header.id);
      items.push({ header: done.header, content: done.content, extras: done.extras });
    }
    for (const t of Object.values(incomplete)) held = Math.min(held, t);
    if (entries.length) await this.storage.set('inboxSince', nextCursor(since, newest, held));
    await this.storage.set('seenItems', seen);
    await this.storage.set('seenMsgs', seenMsgs);
    await this.storage.set('incomplete', incomplete);

    const ids = [...ack];
    const acked = [];
    let ackError = null, limited = downloadLimited;
    for (let i = 0; i < ids.length; i += MAX_ACK_IDS) {
      const batch = ids.slice(i, i + MAX_ACK_IDS);
      try {
        await this.relay.publish(keys.ackTopic, await buildAckFrame(keys, batch, { from: this.from, sent: nowIso(now) }));
        acked.push(...batch);
      } catch (e) {
        ackError = String(e?.message ?? e);
        if (e?.status === 429 || e?.status === 413) limited = e.status;
        break;
      }
    }
    return { items, acked, ackError, storeError, limited };
  }
}
