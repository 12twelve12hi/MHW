// Daylight Share protocol v1: the JavaScript reference implementation (see ../PROTOCOL.md).
// One ES module with no dependencies. Runs in browsers, extension service workers and Node 22+ (WebCrypto,
// CompressionStream, fetch). The Chrome and Safari extensions and the web sender use it as is; the Kotlin and Swift
// implementations are checked against the vectors this module generates (../vectors/test-vectors.json).

export const PROTOCOL_VERSION = 1;
export const DEFAULT_RELAY = 'https://ntfy.sh';
export const MAGIC = 'DLS1';
export const CHUNK = 12 * 1024 * 1024;
export const MAX_PARTS = 16;
export const MAX_ENCODED = 64 * 1024 * 1024;
export const MAX_PAGE_HTML = 8 * 1024 * 1024;
export const MAX_URL = 4096;
export const MAX_TITLE = 300;
export const MAX_NAME = 60;
export const MAX_ACK_IDS = 200;
export const SMALL_FRAME_B64_MAX = 3800;
export const RESEND_ATTACHMENT_MS = 150 * 60 * 1000;
export const RESEND_MESSAGE_MS = 11 * 60 * 60 * 1000;
export const OUTBOX_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
export const SEEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const PURPOSE_INBOX = 'inbox';
export const PURPOSE_ACK = 'ack';

const LABEL_KEY = 'dlshare/v1/key';
const LABEL_INBOX = 'dlshare/v1/inbox';
const LABEL_ACK = 'dlshare/v1/ack';
const PAIR_SCHEME = 'daylightshare:';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TEXT_MIMES = /^(text\/|application\/(xhtml\+xml|json|xml|javascript|x-markdown))/i;

export class ShareError extends Error {
  constructor(code, message, reason = '') { super(message); this.name = 'ShareError'; this.code = code; this.reason = reason; }
}

// ---------------------------------------------------------------------------------------------------------------
// Bytes

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export const utf8 = (s) => enc.encode(s);
export const fromUtf8 = (b) => dec.decode(b);

export function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
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
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + '=';
  }
  return out;
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
    buf = (buf << 6) | v; bits += 6;
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
  globalThis.crypto.getRandomValues(b);
  return b;
}

const subtle = () => globalThis.crypto.subtle;

export async function sha256(bytes) {
  return new Uint8Array(await subtle().digest('SHA-256', bytes));
}

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const deflateRaw = (bytes) => pipe(bytes, new CompressionStream('deflate-raw'));
export const inflateRaw = (bytes) => pipe(bytes, new DecompressionStream('deflate-raw'));

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

export function normalizeRelay(relay) {
  let r = String(relay ?? '').trim();
  if (!r) return DEFAULT_RELAY;
  if (!/^https?:\/\//i.test(r)) r = 'https://' + r;
  let u;
  try { u = new URL(r); } catch { throw new ShareError('relay', 'That relay address isn’t a valid URL.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ShareError('relay', 'The relay must be http(s).');
  return (u.origin + u.pathname).replace(/\/+$/, '');
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

const aadFor = (purpose) => utf8(purpose === PURPOSE_ACK ? LABEL_ACK : LABEL_INBOX);

/** Low level: seal already-serialised header bytes and a body. Used by the vectors. */
export async function sealFrame(keys, purpose, headerBytes, body = new Uint8Array(0), nonce = randomBytes(12)) {
  if (nonce.length !== 12) throw new ShareError('nonce', 'nonce must be 12 bytes');
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, headerBytes.length, false);
  const plain = concat(len, headerBytes, body);
  const ct = new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aadFor(purpose), tagLength: 128 }, keys.key, plain));
  return concat(utf8(MAGIC), nonce, ct);
}

export async function encryptFrame(keys, purpose, header, body, nonce) {
  return sealFrame(keys, purpose, utf8(JSON.stringify(header)), body, nonce);
}

/** Frame bytes -> {header, body}. Throws ShareError('frame', ...) for anything that is not a valid frame. */
export async function decryptFrame(keys, purpose, frame) {
  if (!(frame instanceof Uint8Array) || frame.length < 4 + 12 + 16 + 4) throw new ShareError('frame', 'too short');
  for (let i = 0; i < 4; i++) if (frame[i] !== MAGIC.charCodeAt(i)) throw new ShareError('frame', 'bad magic');
  let plain;
  try {
    plain = new Uint8Array(await subtle().decrypt(
      { name: 'AES-GCM', iv: frame.subarray(4, 16), additionalData: aadFor(purpose), tagLength: 128 },
      keys.key, frame.subarray(16)));
  } catch {
    throw new ShareError('frame', 'does not decrypt');
  }
  if (plain.length < 4) throw new ShareError('frame', 'short plaintext');
  const hlen = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(0, false);
  if (hlen > plain.length - 4 || hlen > 64 * 1024) throw new ShareError('frame', 'bad header length');
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

/** An absolute http(s) URL of at most MAX_URL characters with a host, or null. */
export function webUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > MAX_URL || /[\s\p{Cc}]/u.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
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

/**
 * A safe file name for an untrusted one (PROTOCOL 5): split on / and \, in each segment turn control characters and
 * : * ? " < > | into spaces, collapse whitespace, trim, drop leading dots, drop empty segments; join with one space;
 * empty -> fallback; longer than 120 characters -> cut, keeping an extension of up to 10 characters.
 */
export function safeFileName(name, fallback = 'document') {
  const segs = String(name ?? '').split(/[\\/]+/)
    .map((seg) => seg.replace(/[\p{Cc}:*?"<>|]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim())
    .filter(Boolean);
  let s = segs.join(' ');
  if (!s) s = fallback;
  if (s.length > 120) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = s.slice(0, 120 - ext.length) + ext;
  }
  return s;
}

const shouldCompress = (mime) => TEXT_MIMES.test(mime || '');

/**
 * Builds the frames for one item.
 * item: {kind: 'url'|'page'|'file', url?, title?, name?, mime?, content?: Uint8Array|string, from?, app?, id?, sent?}
 * opts: {compress?: boolean (default: text types only), chunkSize?, nonces?: Uint8Array[] (tests)}
 * -> {id, header (of part 0), frames: Uint8Array[], encodedLength, attachment: boolean}
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
    header.size = content.length;
    header.sha256 = toHex(await sha256(content));
  }

  const compress = kind !== 'url' && (opts.compress ?? (kind === 'page' || shouldCompress(header.mime)));
  let encoded = content;
  if (compress && content.length > 0) {
    const z = await deflateRaw(content);
    if (z.length < content.length) { encoded = z; header.enc = 'deflate-raw'; }
  }
  if (encoded.length > MAX_ENCODED) throw new ShareError('too-large', 'That file is larger than 64 MB.');

  header.sent = item.sent ?? nowIso();
  const from = cleanName(item.from);
  if (from) header.from = from;
  if (item.app) header.app = String(item.app).slice(0, 60);

  const chunkSize = opts.chunkSize ?? CHUNK;
  const parts = Math.max(1, Math.ceil(encoded.length / chunkSize));
  if (parts > MAX_PARTS) throw new ShareError('too-large', 'That file is too large to send.');
  const frames = [];
  let attachment = false;
  for (let i = 0; i < parts; i++) {
    const h = parts > 1 ? { ...header, part: i, parts } : header;
    const chunk = encoded.subarray(i * chunkSize, Math.min(encoded.length, (i + 1) * chunkSize));
    const frame = await encryptFrame(keys, PURPOSE_INBOX, h, chunk, opts.nonces?.[i]);
    if (!isSmallFrame(frame)) attachment = true;
    frames.push(frame);
  }
  return { id, header, frames, encodedLength: encoded.length, attachment };
}

export async function buildAckFrame(keys, ids, { from = 'Daylight', sent = nowIso(), nonce } = {}) {
  const header = { v: PROTOCOL_VERSION, kind: 'ack', ids: ids.slice(0, MAX_ACK_IDS), sent };
  const f = cleanName(from);
  if (f) header.from = f;
  return encryptFrame(keys, PURPOSE_ACK, header, new Uint8Array(0), nonce);
}

/** Validates an incoming item header (untrusted). Returns a cleaned copy or throws ShareError('header'). */
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
    if (!Number.isSafeInteger(h.size) || h.size < 0 || h.size > MAX_ENCODED * 4) bad('size');
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
  return out;
}

/** Collects parts. add() returns {header, content} once an item is complete and verified, else null. */
export class Reassembler {
  constructor() { this.pending = new Map(); }

  async add(rawHeader, body) {
    const h = checkItemHeader(rawHeader);
    if (h.kind === 'url') return { header: h, content: new Uint8Array(0) };
    let p = this.pending.get(h.id);
    if (!p || p.parts !== h.parts) { p = { parts: h.parts, chunks: new Map(), header: h }; this.pending.set(h.id, p); }
    p.chunks.set(h.part, body.slice());
    if (h.part === 0) p.header = h;
    if (p.chunks.size < p.parts) return null;
    this.pending.delete(h.id);
    const encoded = concat(...Array.from({ length: p.parts }, (_, i) => p.chunks.get(i)));
    const content = p.header.enc === 'deflate-raw' ? await inflateRaw(encoded) : encoded;
    if (content.length !== p.header.size) throw new ShareError('integrity', 'size mismatch');
    if (toHex(await sha256(content)) !== p.header.sha256) throw new ShareError('integrity', 'sha256 mismatch');
    const { part, parts, ...header } = p.header;
    return { header, content };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Transport over ntfy (PROTOCOL 3)

export const isSmallFrame = (frame) => Math.ceil(frame.length / 3) * 4 <= SMALL_FRAME_B64_MAX;

export class RelayClient {
  constructor({ relay = DEFAULT_RELAY, fetch: f } = {}) {
    this.relay = normalizeRelay(relay);
    this.fetch = f ?? ((...a) => globalThis.fetch(...a));
  }

  /** Publishes one frame. -> {id, time, attachment} */
  async publish(topic, frame, { retries = 3 } = {}) {
    const small = isSmallFrame(frame);
    const init = small
      ? { method: 'POST', headers: { 'Content-Type': 'text/plain', Firebase: 'no', Cache: 'yes' }, body: toBase64(frame) }
      : { method: 'PUT', headers: { Filename: 'dls1.bin', Message: 'dls1', Firebase: 'no', Cache: 'yes' }, body: frame };
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this.fetch(`${this.relay}/${topic}`, init);
      } catch (e) {
        if (attempt >= retries) throw new ShareError('network', `Couldn’t reach the relay (${e.message ?? e}).`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        return { id: j.id ?? null, time: j.time ?? null, attachment: !small };
      }
      if (res.status === 413) throw new ShareError('too-large', 'The relay refused the file as too large.');
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const ra = Number(res.headers.get('Retry-After'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 10000 * (attempt + 1));
        continue;
      }
      throw new ShareError('relay', `The relay answered ${res.status}.`);
    }
  }

  /** Polls cached messages. since: 'all' | unix seconds. -> [{id, time, frame|null}] (frame null = unusable). */
  async poll(topic, since = 'all', { skip = () => false } = {}) {
    const res = await this.fetch(`${this.relay}/${topic}/json?poll=1&since=${encodeURIComponent(since)}`, { method: 'GET' });
    if (!res.ok) throw new ShareError('relay', `The relay answered ${res.status}.`);
    const text = await res.text();
    const out = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.event !== 'message' || typeof m.id !== 'string') continue;
      const entry = { id: m.id, time: Number(m.time) || 0, frame: null };
      out.push(entry);
      if (skip(m.id)) { entry.skipped = true; continue; }
      if (m.attachment && typeof m.attachment.url === 'string') {
        try {
          const r = await this.fetch(m.attachment.url, { method: 'GET' });
          if (r.ok) entry.frame = new Uint8Array(await r.arrayBuffer());
        } catch { /* expired or unreachable: the sender re-sends */ }
      } else if (typeof m.message === 'string') {
        try { entry.frame = fromBase64(m.message); } catch { /* not ours */ }
      }
    }
    return out;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ---------------------------------------------------------------------------------------------------------------
// Sender (PROTOCOL 3.3)

/**
 * The outbox lives in storage under 'outbox' (a list of small rows, newest first) and 'outbox/<id>' (the content,
 * base64, kept until delivered so the item can be re-sent). Row status: sending | sent | delivered | failed | expired.
 */
export class Sender {
  constructor({ pairing, storage, from = '', app = '', fetch: f, now = () => Date.now(), chunkSize } = {}) {
    if (!pairing?.secret) throw new ShareError('pairing', 'Not paired yet.');
    this.pairing = pairing;
    this.storage = storage;
    this.from = from; this.app = app; this.now = now; this.chunkSize = chunkSize;
    this.relay = new RelayClient({ relay: pairing.relay, fetch: f });
    this._keys = null;
  }

  async keys() { return (this._keys ??= await deriveKeys(this.pairing.secret)); }

  async list() { return (await this.storage.get('outbox')) ?? []; }

  async _saveRow(row) {
    const rows = (await this.list()).filter((r) => r.id !== row.id);
    rows.unshift(row);
    rows.sort((a, b) => b.created - a.created);
    await this.storage.set('outbox', rows.slice(0, 200));
  }

  /** Shares one item now. -> the outbox row. Throws ShareError for bad input; relay failures mark the row failed. */
  async send(item) {
    const keys = await this.keys();
    const built = await buildItemFrames(keys, { ...item, from: item.from ?? this.from, app: item.app ?? this.app },
      { chunkSize: this.chunkSize });
    const content = typeof item.content === 'string' ? utf8(item.content) : item.content;
    const row = {
      id: built.id, kind: item.kind, title: built.header.title ?? '', url: built.header.url ?? '',
      name: built.header.name ?? '', mime: built.header.mime ?? '', size: built.header.size ?? 0,
      sent: built.header.sent, created: this.now(), status: 'sending', lastPublish: 0, attachment: built.attachment,
      attempts: 0, error: '',
    };
    await this._saveRow(row);
    if (content && content.length) await this.storage.set(`outbox/${row.id}`, toBase64(content));
    return this._publish(row, built.frames);
  }

  async _publish(row, frames) {
    try {
      for (const f of frames) await this.relay.publish(keysTopic(await this.keys()), f);
      row.status = 'sent'; row.error = '';
    } catch (e) {
      row.status = 'failed'; row.error = e.message ?? String(e);
    }
    row.lastPublish = this.now(); row.attempts += 1;
    await this._saveRow(row);
    return row;
  }

  /** Reads the ack topic and marks delivered rows. -> number of rows newly delivered. */
  async checkAcks() {
    const keys = await this.keys();
    const since = (await this.storage.get('ackSince')) ?? 'all';
    const msgs = await this.relay.poll(keys.ackTopic, since);
    const acked = new Set();
    let maxTime = 0;
    for (const m of msgs) {
      maxTime = Math.max(maxTime, m.time);
      if (!m.frame) continue;
      try {
        const { header } = await decryptFrame(keys, PURPOSE_ACK, m.frame);
        if (header.kind === 'ack' && Array.isArray(header.ids)) header.ids.forEach((id) => typeof id === 'string' && acked.add(id));
      } catch { /* junk */ }
    }
    if (maxTime) await this.storage.set('ackSince', Math.max(0, maxTime - 5));
    let n = 0;
    for (const row of await this.list()) {
      if (row.status !== 'delivered' && acked.has(row.id)) {
        row.status = 'delivered'; row.delivered = this.now(); n++;
        await this._saveRow(row);
        await this.storage.remove(`outbox/${row.id}`);
      }
    }
    return n;
  }

  /** Re-sends undelivered items whose relay copy is about to expire; expires week-old ones. -> rows re-sent. */
  async resendDue() {
    const now = this.now();
    const out = [];
    for (const row of await this.list()) {
      if (row.status === 'delivered' || row.status === 'expired') continue;
      if (now - row.created > OUTBOX_EXPIRY_MS) {
        row.status = 'expired'; await this._saveRow(row); await this.storage.remove(`outbox/${row.id}`); continue;
      }
      const wait = row.status === 'failed' ? 60 * 1000 * Math.min(60, 2 ** row.attempts)
        : row.attachment ? RESEND_ATTACHMENT_MS : RESEND_MESSAGE_MS;
      if (now - row.lastPublish < wait) continue;
      out.push(await this.retry(row.id));
    }
    return out.filter(Boolean);
  }

  /** Publishes an outbox item again (same id, fresh nonces). */
  async retry(id) {
    const row = (await this.list()).find((r) => r.id === id);
    if (!row) return null;
    const b64 = await this.storage.get(`outbox/${id}`);
    const content = b64 ? fromBase64(b64) : new Uint8Array(0);
    if (row.kind !== 'url' && !b64) { row.status = 'expired'; await this._saveRow(row); return row; }
    if (row.status === 'expired') row.created = this.now();
    const built = await buildItemFrames(await this.keys(), {
      id: row.id, kind: row.kind, url: row.url || undefined, title: row.title, name: row.name, mime: row.mime,
      content, sent: row.sent, from: this.from, app: this.app,
    }, { chunkSize: this.chunkSize });
    return this._publish(row, built.frames);
  }

  /** One maintenance pass: acks, then re-sends. Call on start, after a share, and from timers/alarms. */
  async tick() {
    let delivered = 0;
    try { delivered = await this.checkAcks(); } catch { /* offline */ }
    const resent = await this.resendDue();
    return { delivered, resent: resent.length };
  }
}

const keysTopic = (keys) => keys.inboxTopic;

// ---------------------------------------------------------------------------------------------------------------
// Receiver (PROTOCOL 3.4). The Daylight Inbox is the Android app; this one serves tests, demos and the web inbox.

export class Receiver {
  constructor({ pairing, storage, fetch: f, from = 'Daylight', now = () => Date.now() }) {
    this.pairing = pairing; this.storage = storage; this.from = from; this.now = now;
    this.relay = new RelayClient({ relay: pairing.relay, fetch: f });
    this.reassembler = new Reassembler();
    this._keys = null;
  }

  async keys() { return (this._keys ??= await deriveKeys(this.pairing.secret)); }

  /** Polls once. -> {items: [{header, content}] (new complete items), acked: [ids]} */
  async pollOnce() {
    const keys = await this.keys();
    const now = this.now();
    const seen = (await this.storage.get('seenItems')) ?? {};
    const seenMsgs = (await this.storage.get('seenMsgs')) ?? {};
    for (const [k, t] of Object.entries(seen)) if (now - t > SEEN_TTL_MS) delete seen[k];
    for (const [k, t] of Object.entries(seenMsgs)) if (now - t > 2 * 24 * 3600 * 1000) delete seenMsgs[k];
    const since = (await this.storage.get('inboxSince')) ?? 'all';
    const msgs = await this.relay.poll(keys.inboxTopic, since, { skip: (id) => id in seenMsgs });
    const items = [];
    const ack = new Set();
    let maxTime = 0;
    const partTimes = new Map(); // item id -> {time, msgIds} for parts of items not complete yet
    for (const m of msgs) {
      maxTime = Math.max(maxTime, m.time);
      if (m.skipped || !m.frame) continue;
      let frame;
      try { frame = await decryptFrame(keys, PURPOSE_INBOX, m.frame); } catch { seenMsgs[m.id] = now; continue; }
      const id = frame.header.id;
      if (typeof id === 'string' && id in seen) { seenMsgs[m.id] = now; ack.add(id); continue; }
      let done;
      try { done = await this.reassembler.add(frame.header, frame.body); } catch { seenMsgs[m.id] = now; continue; }
      if (!done) {
        const p = partTimes.get(id) ?? { time: m.time, msgIds: [] };
        p.time = Math.min(p.time, m.time); p.msgIds.push(m.id);
        partTimes.set(id, p);
        continue;
      }
      seenMsgs[m.id] = now;
      for (const mid of partTimes.get(id)?.msgIds ?? []) seenMsgs[mid] = now;
      partTimes.delete(id);
      seen[done.header.id] = now;
      ack.add(done.header.id);
      items.push(done);
    }
    // The cursor never passes the first part of an item that is still incomplete (its other parts may come later).
    let cursor = maxTime;
    for (const p of partTimes.values()) cursor = Math.min(cursor, p.time);
    if (cursor) await this.storage.set('inboxSince', Math.max(0, cursor - 5));
    await this.storage.set('seenItems', seen);
    await this.storage.set('seenMsgs', seenMsgs);
    const ids = [...ack];
    for (let i = 0; i < ids.length; i += MAX_ACK_IDS) {
      await this.relay.publish(keys.ackTopic, await buildAckFrame(keys, ids.slice(i, i + MAX_ACK_IDS), { from: this.from }));
    }
    return { items, acked: ids };
  }
}
