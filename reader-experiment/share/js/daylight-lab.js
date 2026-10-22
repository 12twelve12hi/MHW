// Daylight Share Lab: the JavaScript reference for the Lab additions (../LAB-PROTOCOL.md, normative; it is section 2
// of ../../LAB-PLAN.md). One ES module whose only dependency is daylight-share.js. The extension, the web sender and
// Windows copy it next to their copy of the protocol module; the Kotlin and Swift ports follow the same names and pass
// ../vectors/lab-vectors.json, which ../vectors/generate-lab.mjs makes from this module.
//
// Nothing here changes the wire of protocol v1 (revision 1.1): `v` stays 1, Lab frames are ack frames whose `ids` is
// [], and every v1.0 and v1.1 peer ignores them (LAB-PROTOCOL 2.1).
//
// Every `export` is a single `export const|function|class` declaration, so the extension's classic bundle can read
// this file as it reads daylight-share.js.

import {
  ShareError, PROTOCOL_VERSION, PURPOSE_ACK, utf8, toHex, sha256, concat, cleanName, nowIso, encryptFrame,
  isSmallFrame, describeRow, webUrl, cleanTitle, safeFileName, formatMB, MAX_URL, X_CAP_VALUES, X_ORIG_MAX,
  newItemId, normalizeRelay, DEFAULT_RELAY,
} from './daylight-share.js';

// ---------------------------------------------------------------------------------------------------------------
// Constants (LAB-PROTOCOL 2.2, 2.7.2)

export const LAB_LEVEL = 1;
export const CAPS = { st: 'st', tap: 'tap', readerLink: 'reader-link', capKind: 'cap-kind', readerDoc: 'reader-doc', quiet: 'quiet' };
/** Capability tokens kept for later waves (2.2.2): no W0 or W1 code sets or reads them. */
export const RESERVED_CAPS = ['note', 'dest', 'hold', 'lan', 'return', 'stack', 'manifest', 'control', 'marks', 'queue', 'reading', 'server'];
export const LAB_STATES = ['waiting', 'held', 'inbox', 'handed', 'failed', 'queued', 'reader'];
export const STATE_RANK = { waiting: 1, held: 2, inbox: 2, handed: 3, failed: 3, queued: 4, reader: 5 };
/** The states after which a row needs no faster checks (2.5). */
export const SETTLED_STATES = ['reader', 'queued', 'handed', 'inbox', 'failed', 'held'];
export const MAX_ST_PER_FRAME = 24;
export const MAX_ST_READ = 64;
export const MAX_CAPS = 16;
export const APP_MAX = 60;
export const LAB_MAX_LEVEL_WRITTEN = 99;
export const T_MAX = 4102444800;
export const HELLO_EVERY_MS = 11 * 3600e3;
export const STATE_DIGEST_WINDOW_MS = 48 * 3600e3;
export const STATE_DIGEST_MAX = 48;
export const INBOX_STALE_MS = 36 * 3600e3;
export const PENDING_MAX = 500;
export const LEDGER_STATES_MAX = 200;
export const LEDGER_STATES_HARD_MAX = 1000;
export const LAB_FRAME_GAP_MS = 30e3;
export const LAB_FRAMES_PER_DAY = 30;
export const LAB_YIELD_MS = 3600e3;
export const LAB_OFF_REPEAT_MS = 48 * 3600e3;
export const LAB_OFF_REPEATS = 5;
export const LAB_FLUSH_DELAY_MS = 2e3;
export const GATE_DEADLINE_MS = 5e3;
export const FAST_CHECK_MS = 30e3;
export const FAST_CHECK_WINDOW_MS = 10 * 60e3;

/** The publishers a sender keeps apart (2.2.6): the part of `app` before the first '/'; anything else is 'other'. */
export const PUBLISHERS = ['android', 'reader-lab', 'other'];

/** Lab features (1.4) whose gate needs a capability of the Inbox (F17: in W0 and W1 only the timeline, `st`). */
export const FEATURE_CAPS = { F01: CAPS.st };
/** Lab features that run on the Daylight server, by the server's feature key (2.6). */
export const SERVER_FEATURES = { F02: 'files', F37: 'ai', F19: 'email', F36: 'feeds' };
/** The server's feature keys (2.6), with the Lab feature each belongs to. */
export const SERVER_KEYS = { files: 'F02', ai: 'F37', pdf: 'F37', email: 'F19', feeds: 'F36', deliver: 'F37' };

const ID_RE = /^[0-9a-f]{32}$/;
const CAP_RE = /^[a-z0-9-]{1,16}$/;
const ISO_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,3})?Z$/;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Rule I (2.2.5): a JSON number whose value is a whole number. -0 counts as 0; strings, booleans and 1e400 do not. */
const isInt = (v) => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
const rankOf = (s) => STATE_RANK[s] ?? 0;
/** The ledger's merge rule (2.2.6): a higher rank, or the same rank with a later `t`. */
export const beats = (a, b) => !b || rankOf(a.s) > rankOf(b.s) || (rankOf(a.s) === rankOf(b.s) && a.t > b.t);

// ---------------------------------------------------------------------------------------------------------------
// Dates (rule D, 2.2.5): field by field, never with a platform date parser.

function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const monthDays = (y, m) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/** `YYYY-MM-DDTHH:MM:SS(.f{1,3})?Z` with ASCII digits and valid fields -> ms since 1970 (UTC), else null. */
export function parseLabTime(s) {
  if (typeof s !== 'string') return null;
  const m = ISO_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > monthDays(y, mo) || h > 23 || mi > 59 || se > 59) return null;
  const frac = m[7] ? Number(m[7].slice(1).padEnd(3, '0')) : 0;
  return (daysFromCivil(y, mo, d) * 86400 + h * 3600 + mi * 60 + se) * 1000 + frac;
}

const MAX_ISO_MS = 253402300799999; // 9999-12-31T23:59:59.999Z

// ---------------------------------------------------------------------------------------------------------------
// Fields (2.2.1, 2.2.5)

function readApp(v) { return typeof v === 'string' && PRINTABLE_ASCII.test(v) ? v.slice(0, APP_MAX) : ''; }

function readCaps(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const c of v.slice(0, MAX_CAPS)) if (typeof c === 'string' && CAP_RE.test(c) && !out.includes(c)) out.push(c);
  return out;
}

/** The publisher of an `app` (2.2.6): 'android', 'reader-lab' or 'other'. */
export function publisherOf(app) {
  const p = String(app ?? '').split('/', 1)[0];
  return p === 'android' || p === 'reader-lab' ? p : 'other';
}

/**
 * The `x-inbox` object an Inbox publishes (2.2.1), clamped as readers read it (2.2.5): `lab` an integer 0-99 (else
 * ShareError('lab')); `app` printable ASCII cut to 60 characters, anything else ""; `caps` the first 16 elements that
 * are tokens, without repeats; `poll` (ms or an ISO string) as ISO 8601 UTC with milliseconds, left out when unknown;
 * `live` true only for true.
 */
export function buildInboxInfo({ lab, app = '', caps = [], poll = null, live = false } = {}) {
  if (!isInt(lab) || lab < 0 || lab > LAB_MAX_LEVEL_WRITTEN) throw new ShareError('lab', 'lab must be an integer from 0 to 99', 'lab');
  const out = { lab: lab + 0, app: readApp(app), caps: readCaps(caps) };
  const ms = typeof poll === 'string' ? parseLabTime(poll) : (isInt(poll) ? poll : null);
  if (ms !== null && ms >= 0 && ms <= MAX_ISO_MS) out.poll = new Date(ms).toISOString();
  out.live = live === true;
  return out;
}

function checkEntry(e) {
  const i = e?.i ?? e?.id;
  if (typeof i !== 'string' || !ID_RE.test(i) || !Object.hasOwn(STATE_RANK, e?.s) || !isInt(e?.t) || e.t < 0 || e.t > T_MAX) {
    throw new ShareError('lab', 'bad state entry', 'entry');
  }
  return { i, s: e.s, t: e.t + 0 };
}

/**
 * A Lab frame (2.2.1): sealed like an ack (pairing key, AAD dlshare/v1/ack), `ids` [], `x-inbox` from
 * buildInboxInfo(inbox) and, when `states` is not empty, `x-st` ([{i|id, s, t}], at most 24). A hello has no states.
 * -> the frame bytes. Throws ShareError('lab') with reason 'too-many' (over 24 states), 'entry' (a bad entry), 'lab'
 * (a bad level) or 'not-small' (base64 over 3,800 characters; LabInbox halves the batch on this one).
 */
export async function buildLabFrame(keys, { inbox, states = [], from = '', sent = nowIso(), nonce } = {}) {
  if (states.length > MAX_ST_PER_FRAME) throw new ShareError('lab', `more than ${MAX_ST_PER_FRAME} states`, 'too-many');
  const header = { v: PROTOCOL_VERSION, kind: 'ack', ids: [], sent };
  const f = cleanName(from);
  if (f) header.from = f;
  header['x-inbox'] = buildInboxInfo(inbox);
  if (states.length) header['x-st'] = states.map(checkEntry);
  const frame = await encryptFrame(keys, PURPOSE_ACK, header, new Uint8Array(0), nonce);
  if (!isSmallFrame(frame)) throw new ShareError('lab', 'a Lab frame must be a small frame', 'not-small');
  return frame;
}

/**
 * Reads the Lab fields of an ack-topic header (2.2.5, exactly; vectors > labParse). Never throws.
 * -> {inbox: {lab, app, caps, poll (ms or null), live} | null, states: [{id, s, t}]}
 */
export function parseLabAck(header) {
  const none = { inbox: null, states: [] };
  if (!isObject(header) || header.kind !== 'ack' || !Array.isArray(header.ids) || header.ids.length !== 0) return none;
  let inbox = null;
  const x = header['x-inbox'];
  if (isObject(x) && isInt(x.lab)) {
    const lab = x.lab + 0;
    if (lab > LAB_LEVEL) return none;
    if (lab >= 0) {
      const poll = typeof x.poll === 'string' ? parseLabTime(x.poll) : null;
      inbox = { lab, app: readApp(x.app), caps: readCaps(x.caps), poll, live: x.live === true };
    }
  }
  const states = [];
  const st = header['x-st'];
  if (Array.isArray(st)) {
    for (const e of st.slice(0, MAX_ST_READ)) {
      if (!isObject(e) || typeof e.i !== 'string' || !ID_RE.test(e.i)) continue;
      if (typeof e.s !== 'string' || !Object.hasOwn(STATE_RANK, e.s)) continue;
      if (!isInt(e.t) || e.t < 0 || e.t > T_MAX) continue;
      states.push({ id: e.i, s: e.s, t: e.t + 0 });
    }
  }
  return { inbox, states };
}

// ---------------------------------------------------------------------------------------------------------------
// Locks: one promise chain per storage object and role (as the protocol module does for Senders and Receivers).

const LOCKS = new WeakMap();
function locked(storage, role, fn) {
  if (storage === null || (typeof storage !== 'object' && typeof storage !== 'function')) return fn();
  let l = LOCKS.get(storage);
  if (!l) { l = {}; LOCKS.set(storage, l); }
  const run = (l[role] ?? Promise.resolve()).then(() => fn());
  l[role] = run.then(() => {}, () => {});
  return run;
}

// ---------------------------------------------------------------------------------------------------------------
// Sender ledger (2.2.6)

/**
 * What a sender learns from the ack topic, per publisher. Storage keys (the protocol's storage adapter):
 *   lab/inbox  {android?, 'reader-lab'?, other?: {lab, app, caps, poll (ms, clamped to `at`) | null, live, at (ms)}}
 *   lab/heard  the latest relay time (ms) of any ack-topic message that decrypted
 *   lab/states {id: {s, t}}
 * It records every ack-topic message, whether Lab is on or off (wire it with labHook(ledger)). applyPairingChange
 * removes these keys when the secret changes.
 */
export class LabLedger {
  constructor({ storage, now = () => Date.now() } = {}) { this.storage = storage; this.now = now; }

  _lock(fn) { return locked(this.storage, 'lab-ledger', fn); }

  async _get(k, d) { try { return (await this.storage.get(k)) ?? d; } catch { return d; } }

  /**
   * Records one ack-topic header that decrypted. time: the message's relay time in seconds (as the poll gives it).
   * A header whose kind is not "ack" is ignored. Never throws on the header's content.
   */
  record(header, { time } = {}) {
    return this._lock(async () => {
      if (!isObject(header) || header.kind !== 'ack') return;
      const at = Number.isFinite(time) ? Math.round(time * 1000) : this.now();
      if (at > (await this._get('lab/heard', 0))) await this.storage.set('lab/heard', at);
      const { inbox, states } = parseLabAck(header);
      if (inbox) {
        const all = await this._get('lab/inbox', {});
        const pub = publisherOf(inbox.app);
        if (!all[pub] || at >= all[pub].at) {
          all[pub] = { ...inbox, poll: inbox.poll === null ? null : Math.min(inbox.poll, at), at };
          await this.storage.set('lab/inbox', all);
        }
      }
      if (states.length) {
        const map = await this._get('lab/states', {});
        let changed = false;
        for (const e of states) {
          const cur = Object.hasOwn(map, e.id) ? map[e.id] : null;
          if (beats(e, cur)) { map[e.id] = { s: e.s, t: e.t }; changed = true; }
        }
        if (changed) await this.storage.set('lab/states', bound(map, LEDGER_STATES_HARD_MAX));
      }
    });
  }

  /** -> [{publisher, lab, app, caps, poll, live, at}] in PUBLISHERS order. */
  async publishers() {
    const all = await this._get('lab/inbox', {});
    return PUBLISHERS.filter((p) => isObject(all[p])).map((p) => ({ publisher: p, ...all[p] }));
  }

  /** Everything a screen needs in one read: {publishers, inboxLab, caps, hasCap(token), checkedIn, states}. */
  async snapshot() {
    const now = this.now();
    const pubs = await this.publishers();
    const heard = await this._get('lab/heard', 0);
    const states = await this._get('lab/states', {});
    const live = pubs.filter((p) => now - p.at <= INBOX_STALE_MS && p.lab >= 1);
    const caps = [...new Set(live.flatMap((p) => p.caps))].sort();
    let checked = heard > 0 ? heard : null;
    for (const p of pubs) if (p.poll !== null && (checked === null || p.poll > checked)) checked = p.poll;
    return { publishers: pubs, inboxLab: live.length > 0, caps, hasCap: (t) => caps.includes(t), checkedIn: checked, states };
  }

  /** Some fresh publisher (heard within 36 h) has lab >= 1. */
  async inboxLab() { return (await this.snapshot()).inboxLab; }

  /** The union of the caps of the fresh publishers with lab >= 1, sorted. */
  async caps() { return (await this.snapshot()).caps; }

  async hasCap(token) { return (await this.caps()).includes(token); }

  /** The later of `heard` and the newest clamped `poll` (ms), or null. */
  async checkedIn() { return (await this.snapshot()).checkedIn; }

  /** -> {s, t} or null. Show it only on rows whose status is delivered (describeLabRow does). */
  async state(id) {
    const map = await this._get('lab/states', {});
    return Object.hasOwn(map, id) ? map[id] : null;
  }

  /** Keeps the states of `ids` only (the outbox's ids and the hosted outbox's), at most 200, the latest first. */
  prune(ids) {
    return this._lock(async () => {
      const keep = new Set(ids);
      const map = await this._get('lab/states', {});
      const out = {};
      for (const [id, v] of Object.entries(map)) if (keep.has(id)) out[id] = v;
      await this.storage.set('lab/states', bound(out, LEDGER_STATES_MAX));
    });
  }
}

/** Keeps at most `max` entries of an id -> {s, t} map, the latest `t` first (ties: the smaller id first). */
function bound(map, max) {
  const entries = Object.entries(map);
  if (entries.length <= max) return map;
  entries.sort((a, b) => b[1].t - a[1].t || (a[0] < b[0] ? -1 : 1));
  return Object.fromEntries(entries.slice(0, max));
}

/** The Sender's onAckHeader for a ledger: new Sender({…, onAckHeader: labHook(ledger)}). */
export function labHook(ledger) {
  return (header, meta = {}) => ledger.record(header, { time: meta.time });
}

// ---------------------------------------------------------------------------------------------------------------
// Copy (1.4, 1.6, 2.5 and 2.6's Daylight server section). LAB_TEXT is the one source of every Lab string; the vectors
// (labText) pin it. The server section's state lines are the server module's (STATE_MESSAGES, DESIGN 14.1).

const FEATURE_TEXT = {
  F01: { name: 'Delivery timeline', sentence: 'See each item reach your Daylight and its Reader.' },
  F03: { name: 'Pages as you see them', sentence: 'Pages go as you see them, logged-in parts included, without scripts or form contents.' },
  F04: { name: 'Share in place', sentence: 'Share › Daylight closes in a second; Options lets you choose how it goes.' },
  F07: { name: 'Works offline', sentence: 'Items shared offline wait here and go as soon as you’re back online.' },
  F08: { name: 'Your Daylight in the share sheet', sentence: 'Your Daylight appears next to your contacts when you share.' },
  F09: { name: 'Shortcuts and automation', sentence: 'Send from Shortcuts, Siri, scripts and other apps.' },
  F10: { name: 'Send as', sentence: 'Choose page, clean article, link or selection.' },
  F11: { name: 'Send a selection', sentence: 'Send just the passage you selected, with its source.' },
  F15: { name: 'Arrival notices', sentence: 'See what arrived and from where, and act on it.' },
  F16: { name: 'Clean links', sentence: 'Removes tracking from links and finds the real article.' },
  F23: { name: 'Print to Daylight', sentence: 'Print › PDF › Send to Daylight from any app.' },
  F26: { name: 'Setup check', sentence: 'Checks your setup and sends a test article.' },
  F29: { name: 'Drop on the menu bar', sentence: 'Drop files and links on the menu-bar icon to send them.' },
  F33: { name: 'Send copied link', sentence: 'Send a link you copied with one tap.' },
  F34: { name: 'More right-click choices', sentence: 'Send a page, clean article, link, selection or an image’s page from the right-click menu and shortcuts.' },
  // With your Daylight server (optional): listed last, under their own heading.
  F02: { name: 'Files over 9 MB', sentence: 'Big PDFs and books go through your Daylight server.' },
  F37: { name: 'Summaries with Claude', sentence: 'Short summaries and answers about what you send, using your Claude key.' },
  F19: { name: 'Email-in address', sentence: 'Forward newsletters and documents to your Daylight by email.' },
  F36: { name: 'Feeds and daily digest', sentence: 'Follow feeds; new articles arrive one by one or in a morning digest.' },
};

export const LAB_TEXT = {
  // 1.6: the switch, its note and the list
  lab: 'Lab',
  switchFooter: 'New features we’re trying out. Turn Lab off for the plain app; nothing you sent is lost.',
  note: 'Lab is on. New features to try are in Settings › Lab, where you can turn it off.',
  noteButton: 'OK',
  whatsInLab: 'What’s in Lab',
  ready: 'Ready',
  serverRow: 'Daylight server',
  serverRowSubtitle: 'Optional · {short}',
  serverHeading: 'With your Daylight server (optional)',
  // 2.6: the Daylight server section's own lines (W0); serverMovedText, labInboxSeenText and aiTodayText fill them
  serverSection: {
    moved: 'Your Daylight server moved to {host}. Use it?',
    labInboxSeen: 'Lab Inbox last seen {rel}',
    labInboxNever: 'Your Daylight hasn’t said hello to the server yet.',
    aiToday: 'AI today: US${used} of US${cap}',
    serverCode: 'Server code',
    copy: 'Copy',
    serverAddress: 'Server address',
  },
  comfort: 'Comfort',
  comfortFooter: 'Larger text and buttons, more contrast, no motion.',
  labOff: 'Turn on Lab in {app} to use this.',
  checking: 'Checking your Daylight server…',
  adHocMac: 'This copy of the Mac app isn’t signed with a team, so Share › Daylight keeps its own pairing and Lab switch, its sends don’t show here, and it waits until an item is sent before closing.',
  // {app} and {path} per platform
  appName: {
    iphone: 'Send to Daylight', ipad: 'Send to Daylight', mac: 'Send to Daylight', chrome: 'Send to Daylight',
    safari: 'Send to Daylight', web: 'Send to Daylight', windows: 'Send to Daylight', android: 'Daylight Share',
    inbox: 'Daylight Share',
  },
  notificationsPath: {
    iphone: 'Settings › Notifications › Send to Daylight', ipad: 'Settings › Notifications › Send to Daylight',
    mac: 'System Settings › Notifications › Send to Daylight', android: 'Settings › Apps › Daylight Share › Notifications',
    inbox: 'Settings › Apps › Daylight Share › Notifications', windows: 'Settings › System › Notifications › Send to Daylight',
  },
  // 1.4: features, in list order (the four server features last)
  features: FEATURE_TEXT,
  featureOrder: ['F01', 'F03', 'F04', 'F07', 'F08', 'F09', 'F10', 'F11', 'F15', 'F16', 'F23', 'F26', 'F29', 'F33', 'F34'],
  serverFeatureOrder: ['F02', 'F37', 'F19', 'F36'],
  // 1.4: short states. needs-server reads "Not set up" as the server heading's line (serverHeadingShort).
  short: {
    ready: 'Ready',
    'needs-pairing': 'Pair first',
    'needs-inbox': 'Needs Lab on your Daylight',
    'needs-notifications': 'Needs notifications',
    'needs-quick-sends': 'Off in Lab settings',
    'needs-site-access': 'Needs access to this site',
    'needs-server': 'Needs your Daylight server',
    'pairing-mismatch': 'Needs the new Server code',
    locked: 'Needs the new Server code',
    'server-outdated': 'Server needs an update',
    'app-outdated': 'Update this app',
    'needs-key': 'Needs a Claude key',
    'needs-r2': 'Needs R2 storage',
    'needs-domain': 'Needs an email domain',
    'needs-paid': 'Needs Workers Paid',
    'needs-lab-inbox': 'Waiting to hear from your Daylight',
    OFFLINE: 'Can’t reach the server',
    error: 'Server problem',
    later: 'In a later update',
  },
  serverHeadingShort: { 'needs-server': 'Not set up' },
  // 1.6: what a control says when it is not ready. The other server states use the server module's STATE_MESSAGES.
  needs: {
    'needs-pairing': 'Pair with your Daylight first: open Daylight Share on the Daylight and scan or type its code here.',
    'needs-inbox': 'Your Daylight hasn’t confirmed Lab yet. Update Daylight Share on it and open it once.',
    'needs-notifications': 'Needs notifications for {app}. Turn them on in {path}.',
    'needs-quick-sends': 'Quick sends from other apps are off. Turn on “Allow quick sends from other apps” in Lab settings.',
    'needs-site-access': 'Needs access to this site. Choose Allow when your browser asks.',
    'needs-server': 'Needs your Daylight server. Add the Cloudflare secrets to turn this on (Lab › Daylight server shows how).',
    'needs-lab-inbox': 'Your Daylight server hasn’t heard from your Daylight yet. Open Daylight Share on it with Lab on.',
    later: 'Your Daylight server is ready. {feature} comes to this app in a later Lab update.',
  },
  // The one button a note may carry (1.5)
  buttons: {
    'needs-notifications': 'Open Settings',
    'needs-quick-sends': 'Open setting',
    'needs-site-access': 'Allow',
    'needs-server': 'Copy Server code',
  },
  // 2.5: the delivery timeline
  rows: {
    offline: { label: 'Waiting for connection', sentence: 'It will send when this device is back online.' },
    delivered: { label: 'On your Daylight ✓', sentence: 'Saved on your Daylight.' },
    waiting: { label: 'Waiting for a tap on your Daylight', sentence: 'Tap its notice on your Daylight to add it to the Reader.' },
    held: { label: 'Kept for later on your Daylight', sentence: 'It waits in Daylight Share until you add it to the Reader.' },
    inbox: { label: 'In Daylight Share on your Daylight', sentence: 'No Reader on your Daylight takes this, so it waits in Daylight Share.' },
    handedFile: { label: 'Handed to the Reader', sentence: 'Your Daylight passed it to the Reader. The Reader doesn’t confirm documents yet.' },
    handedLink: { label: 'Handed to the Reader', sentence: 'Your Daylight passed it to the Reader as a shared link. The Reader doesn’t confirm those.' },
    failed: { label: 'Not added to the Reader', sentence: 'The Reader couldn’t open this. It waits in the inbox on your Daylight.' },
    queued: { label: 'In your Reader’s queue', sentence: 'The Reader will download it when your Daylight is online.' },
    reader: { label: 'In your Reader ✓', sentence: 'Saved in the Daylight Reader.' },
  },
  steps: { sent: 'Sent', daylight: 'On your Daylight', reader: 'In the Reader', handed: 'Handed to the Reader' },
  marks: { done: '✓', going: '…', stopped: '!' },
  stepJoin: ' · ',
  checkedIn: 'Your Daylight checked in {rel}.',
  neverCheckedIn: 'Your Daylight hasn’t checked in since this device paired.',
  rel: { justNow: 'just now', minutes: '{m} min ago', hours: '{h} h ago', days: '{d} days ago' },
  // 1.4: the header line of What's in Lab
  inboxLabOn: 'Your Daylight: Lab on · checked in {rel}',
  inboxLabNeeds: '{short} · checked in {rel}',

  // ---- W1 (L1): the strings of LAB-PLAN 3.3, plus the per-feature Use switches (6.5 Q5 = yes) ----

  // Use switches: in What's in Lab, on the rows of the features that change how sharing behaves (USE_FEATURES). On by
  // default; the one Lab switch still turns all of Lab off. The footer says what turning it off does.
  use: {
    label: 'Use',
    a11y: 'Use {feature}',
    footers: {
      F03: 'When it’s off, there’s no note when a share brings only the link.',
      F04: 'When it’s off, Share › Daylight stays open until the item is sent, as before.',
      F08: 'When it’s off, your Daylight isn’t offered in the share sheet’s top row.',
      F10: 'When it’s off, pages go as you see them, without Send as or the thin-page check.',
      F16: 'When it’s off, links go exactly as they were shared, tracking and all.',
      F33: 'When it’s off, the app doesn’t offer to send a link you copied.',
    },
  },
  // F01: the extension's toolbar badge (the state of the most recent row)
  badge: { sending: '…', delivered: '✓', error: '!', waiting: '⌛' },
  // F02 entry point, under v1.1's too-big sentence
  bigFiles: 'Send files over 9 MB ›',
  // F03: the link-only hint (once on the device, then in Setup check) and the Inbox's row lines (F03, F11)
  linkOnly: {
    iphone: 'Only the link came through. If this needs your login, open it in Safari and share from there.',
    android: 'Only the link came through. For pages behind a login, send from your computer’s browser with the Send to Daylight extension.',
    openInSafari: 'Open in Safari',
  },
  kindLine: {
    seen: 'Page as you saw it',
    clean: 'Clean article',
    excerpt: 'Excerpt',
    test: 'Test article',
    link: 'Link (the Reader downloads it)',
    document: 'Document · {mb} MB',
    from: ' · from {from}',
  },
  cleanedFrom: 'Cleaned from {host}',
  senderSees: 'Sender sees: {label}',
  // F04: share in place
  shareInPlace: {
    card: 'Sending to {name}',
    yourDaylight: 'your Daylight',
    options: 'Options',
    send: 'Send',
    sendLinkInstead: 'Send the link instead',
    sendAsExcerpt: 'Send as excerpt',
    sendLink: 'Send link',
    title: 'Title',
    linkOnlyCard: 'This page can’t be read here, so its link will be sent.',
    alwaysOptions: 'Always show Options before sending',
    tellFails: 'Tell me when a send fails',
    tellReader: 'Tell me when it’s in my Reader',
    failedTitle: 'Couldn’t send ‘{title}’ to {name}',
    failedText: 'Open to try again.',
    inReader: 'In your Reader ✓: {title}',
    channel: 'Send results',
    toolbarSend: 'Send when I click the toolbar button',
  },
  // F07: the queue in History
  queue: { heading: 'Waiting to send ({n})', cancel: 'Cancel' },
  // F08: Windows toast
  sentTo: 'Sent to {name}',
  // F09: automation (URL scheme, App Intents, the Android intent, the command line)
  automation: {
    confirmTitle: 'Send to {name}?',
    send: 'Send',
    cancel: 'Cancel',
    quickSends: 'Allow quick sends from other apps',
    quickSendsFooter: 'Lets Shortcuts, scripts and other apps send without asking. Any app or web page could then send to your Daylight.',
    spokenSent: 'Sent to {name}.',
    phraseSendCopied: 'Send copied link with {app}',
    phraseCheck: 'Check my Daylight with {app}',
    emptyFile: 'This file is empty, so nothing was sent.',
    unreadableFile: 'Couldn’t read this file, so nothing was sent.',
    notWebAddress: 'That isn’t a web address or a file.',
  },
  // F09: the command line (daylight-send); its usage text lives in the tool
  cli: {
    notPaired: 'Not paired yet. Run daylight-send pair with the code Daylight Share shows on your Daylight, or set DAYLIGHT_PAIRING.',
    paired: 'Paired with {name}. Items go through {relay}.',
    noItem: 'Nothing with the id {id} in this outbox.',
    noItems: 'Nothing sent from here yet.',
    ticked: '{delivered} delivered, {resent} sent again.',
    timedOut: 'Stopped waiting after {secs} s. Run daylight-send status {id} to check again.',
  },
  // F10: Send as
  sendAs: {
    line: 'Send as: {mode} ▾',
    menu: { page: 'Page as you see it', clean: 'Clean article', link: 'Link only', selection: 'Selection' },
    short: { page: 'Page', clean: 'Clean article', link: 'Link only', selection: 'Selection' },
    thin: 'This page looks thin ({n} words). Send the full page instead?',
    sendFull: 'Send full page',
    sendAnyway: 'Send anyway',
    review: 'Review before sending',
    reviewTitle: 'Review',
    reviewStats: '{n} words · about {mb} MB',
  },
  // F11: excerpts. The file names, titles and footers are part of what is sent (excerptItem, excerptMarkdown).
  excerpt: {
    menu: 'Send selection to Daylight',
    waitsOnce: 'Excerpts wait for a tap on your Daylight for now.',
    fileName: 'Excerpt - {words}.html',
    fileNameBare: 'Excerpt.html',
    noteName: 'Note - {words}.md',
    noteNameBare: 'Note.md',
    title: '“{line}” · {page}',
    titleBare: '“{line}”',
    trimmed: '(Excerpt trimmed to 50,000 characters.)',
    sharedFromOn: '— shared from {app} on {date}',
    sharedOn: '— shared on {date}',
    sharedFrom: '— shared from {app}',
    date: '{d} {month} {y}',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
  // F15: arrival notices and Inbox health (DC-1 Inbox)
  arrivals: {
    setting: 'Arrival notices',
    off: 'Off',
    quiet: 'Quiet',
    alert: 'Alert',
    channelQuiet: 'Arrivals',
    channelAlert: 'Arrivals (alert)',
    quietHours: 'Quiet hours',
    addToReader: 'Add to Reader',
    keepForLater: 'Keep for later',
    keptForLater: 'Kept for later',
    saved: 'Saved to the Reader: {title}',
    savedText: 'From {from}',
    dismiss: 'Dismiss',
    savedGroup: '{n} saved from {from}',
    yourDevices: 'your devices',
    excerptsGroup: '{n} excerpts from {from}',
    healthOn: 'Last checked {rel} · Instant delivery on',
    healthOff: 'Last checked {rel} · Instant delivery off',
    stopped: 'Instant delivery stopped. Turn it back on to get items within seconds.',
    turnOn: 'Turn on',
    channelHealth: 'Inbox health',
  },
  // F23 (Mac): Setup check's button
  addToPrintMenu: 'Add to the Print menu',
  // F26: Setup check, the test article, the activity log and diagnostics
  setup: {
    title: 'Setup check',
    ok: '✓ {check}',
    notOk: '! {check}',
    showSteps: 'Show steps',
    testSend: 'Send a test article',
    testFooter: 'It’s added to your Reader library; delete it there when you’re done.',
    readerTest: 'Test the Reader hand-off',
    delivered: 'Delivered',
    inReader: 'In your Reader',
    activity: 'Activity log',
    copyDiagnostics: 'Copy diagnostics',
    copied: 'Copied',
    checks: {
      paired: 'Pairing',
      shareItem: 'Daylight in the share sheet',
      safariExtension: 'Safari extension',
      notifications: 'Notifications',
      backgroundRefresh: 'Background App Refresh',
      shareMenu: 'Share menu extension',
      loginItem: 'Open at login',
      printMenu: 'Print menu',
      batteryOptimisation: 'Battery optimisation',
      newItemsChannel: '“New items” notices',
      overlay: 'Display over other apps',
      instantDelivery: 'Instant delivery',
      reader: 'A Reader that saves pages',
      readerReadLater: 'The Reader’s read-later',
      toolbarButton: 'Toolbar button',
      shortcut: 'Keyboard shortcut',
      siteAccess: 'Site access',
      installed: 'Installed as an app',
      storage: 'Storage kept by the browser',
      sendTo: 'Send to shortcut',
      hotkey: 'Hotkey',
    },
    steps: {
      shareItem: 'In the share sheet, scroll the row of apps to More, tap Edit, and add Daylight.',
      safariExtension: 'Open Settings › Apps › Safari › Extensions and turn on Send to Daylight.',
      shareMenu: 'Open System Settings › General › Login Items & Extensions › Sharing and turn on Daylight.',
    },
  },
  testArticle: {
    title: 'Test article from {device}',
    heading: 'A test article from Send to Daylight',
    p1: 'This short article was sent by Setup check in Send to Daylight. If you are reading it on your Daylight, the whole path works: your device sealed it, the relay carried it, Daylight Share on your Daylight opened it, and the Reader saved it to your library. Nothing in it needs the network, so it reads the same with Wi-Fi off.',
    p2: 'It is written to be long enough that the Reader keeps it as a page of its own. Very short pages make the Reader fetch the address again, and the address of this article leads nowhere on purpose: it ends in .invalid, a name that never resolves. So if you see this text, it came through Send to Daylight and not from the web.',
    p3: 'Back on the device you sent it from, Setup check follows the article along its way. It ticks Delivered when your Daylight confirms that the item arrived, and In your Reader when the Reader says that it saved it. If your Daylight asks before it opens new items, the check waits until you tap the notice there, and says so in the meantime.',
    p4: 'You can send a test article whenever something seems wrong, for example after you change your Wi-Fi, update an app or pair again. Each one has a new address, so the Reader never mistakes one for another, and each one shows up as a new item in your library. When the checks look right, you are ready to send pages, links and documents for real.',
    p5: 'A few things are worth knowing while you are here. Pages you send go as you saw them, logged-in parts included, but without scripts or anything you typed into forms. Links you send are cleaned of tracking first. And items you share while offline wait on your device and go as soon as it is back online.',
    p6: 'When you are done, delete this article in the Reader, as you would delete anything else you read. Deleting it changes nothing in Send to Daylight or in Daylight Share, and sending another test article later works just as this one did. Thank you for trying the Lab version of Send to Daylight.',
  },
  // F26: Copy diagnostics (redactDiagnostics runs over all of it)
  diagnostics: {
    heading: 'Send to Daylight diagnostics',
    app: 'App: {app} {version} ({platform})',
    lab: 'Lab: {state}',
    on: 'on',
    off: 'off',
    caps: 'Lab caps from your Daylight: {caps}',
    noCaps: 'nothing heard',
    checkedIn: 'Last check-in: {time}',
    never: 'never',
    outbox: 'Outbox: {counts}',
    relay: 'Relay: {relay}',
    relayNtfy: 'ntfy.sh',
    relayCustom: 'custom relay',
    events: 'Recent events, oldest first:',
    noEvents: 'none',
  },
  // F33: send the copied link
  copiedLink: {
    chip: 'Send copied link',
    confirm: 'Send {host} to {name}?',
    pasteAndSend: 'Paste and send',
    confirmShort: 'Send {host}?',
    noLink: 'No link on the clipboard.',
  },
  // F34: the browser's right-click menu
  contextMenu: {
    page: 'Send page to Daylight',
    clean: 'Send clean article to Daylight',
    link: 'Send link to Daylight',
    selection: 'Send selection to Daylight',
    image: 'Send this image’s page to Daylight',
    pdf: 'Send PDF link to Daylight',
    showInMenu: 'Show in the right-click menu',
  },
};

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

/** A feature's name: its id's (F01…) or a server key's; anything else as given. */
export function featureName(feature) {
  const id = Object.hasOwn(FEATURE_TEXT, feature) ? feature : SERVER_KEYS[feature];
  return id ? FEATURE_TEXT[id].name : String(feature ?? '');
}

/** The states a server decides, or the server module decides for the app (2.6), whose text is STATE_MESSAGES'. */
const SERVER_TEXT_STATES = new Set(['pairing-mismatch', 'server-outdated', 'app-outdated', 'locked', 'needs-key',
  'needs-domain', 'needs-r2', 'needs-paid', 'OFFLINE', 'error']);

/**
 * The text for a state (1.4, 1.6; vectors > labText).
 * - short: the short state (What's in Lab); with `heading`, needs-server reads "Not set up" (the server heading).
 * - otherwise the one sentence under a tapped control: LAB_TEXT.needs with {app} (from `app`, else the platform's
 *   name), {path} (the platform's notification settings; a platform without one gets the first sentence alone) and
 *   {feature} (a feature id, a server key or a name); for the server's states, `message`: the server module's text
 *   (DaylightServer.state()'s message, or localMessage(state)); null when not given.
 * platform: iphone | ipad | mac | chrome | safari | web | windows | android | inbox. Unknown states -> null.
 */
export function needsMessage(state, { app, platform, feature, short = false, heading = false, message = null } = {}) {
  if (short) {
    if (heading && Object.hasOwn(LAB_TEXT.serverHeadingShort, state)) return LAB_TEXT.serverHeadingShort[state];
    return Object.hasOwn(LAB_TEXT.short, state) ? LAB_TEXT.short[state] : null;
  }
  if (state === 'ready') return LAB_TEXT.ready;
  if (Object.hasOwn(LAB_TEXT.needs, state)) {
    const appName = app ?? LAB_TEXT.appName[platform] ?? 'Send to Daylight';
    const path = Object.hasOwn(LAB_TEXT.notificationsPath, platform) ? LAB_TEXT.notificationsPath[platform] : null;
    let text = LAB_TEXT.needs[state];
    if (state === 'needs-notifications' && !path) text = text.slice(0, text.indexOf('.') + 1);
    return fill(text, { app: appName, path: path ?? '', feature: featureName(feature) });
  }
  if (SERVER_TEXT_STATES.has(state)) return message ?? null;
  return null;
}

/** A state as a short state knows it: a state of LAB_TEXT.short, else 'error' (as labGate maps an unknown state). */
const knownShort = (state) => (Object.hasOwn(LAB_TEXT.short, state) ? state : 'error');

/**
 * The server's short state where it stands for the whole server (1.4): the line under What's in Lab's server heading
 * and the {short} of the "Daylight server ›" row. needs-server reads "Not set up" here; an unknown state is `error`.
 */
export function serverHeadingShort(state) {
  return needsMessage(knownShort(state), { short: true, heading: true });
}

/** The "Daylight server ›" row's subtitle (1.1): "Optional · Not set up", "Optional · Ready", … */
export function serverRowSubtitle(state) {
  return fill(LAB_TEXT.serverRowSubtitle, { short: serverHeadingShort(state) });
}

/**
 * A server feature's row under the server heading (1.4): its own short state ("Needs a Claude key") only when its
 * state differs from the heading's, else null. Unknown states count as `error` on both sides.
 */
export function serverFeatureShort(state, headingState) {
  const s = knownShort(state);
  return s === knownShort(headingState) ? null : needsMessage(s, { short: true });
}

/**
 * The sheet when the server moved (2.6): "Your Daylight server moved to {host}. Use it?". moved: DaylightServer
 * discover()'s `moved` (the new origin); {host} is that text without its scheme and anything from the first '/' after
 * it, read as text (no URL parser: the port stays, as relayHost keeps it).
 */
export function serverMovedText(moved) {
  let host = String(moved ?? '');
  const scheme = host.indexOf('://');
  if (scheme >= 0) host = host.slice(scheme + 3);
  const slash = host.indexOf('/');
  if (slash >= 0) host = host.slice(0, slash);
  return fill(LAB_TEXT.serverSection.moved, { host });
}

/**
 * The server section's Lab Inbox line (2.6). lastSeen: GET /v1/status's `inbox.lastSeen`, an ISO 8601 UTC time read
 * as rule D reads `poll` (2.2.5), or ms since 1970. null or anything else gives the not-yet line.
 */
export function labInboxSeenText(lastSeen, now = Date.now()) {
  const ms = typeof lastSeen === 'number' ? (Number.isFinite(lastSeen) ? lastSeen : null) : parseLabTime(lastSeen);
  if (ms === null) return LAB_TEXT.serverSection.labInboxNever;
  return fill(LAB_TEXT.serverSection.labInboxSeen, { rel: relativeTime(ms, now) });
}

/**
 * A US dollar amount without "US$", for aiTodayText: cents = n × 100 in double precision, rounded half up (never a
 * printf or toFixed, which round the decimal value differently: 1.005 is "1" and 0.015 is "0.02" here), and ".00"
 * left out: 0.227 -> "0.23", 2.5 -> "2.50", 3 -> "3". Anything but a finite number above 0 is "0".
 */
export function formatUsd(n) {
  const cents = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  const whole = Math.floor(cents / 100), frac = cents % 100;
  return frac ? `${whole}.${String(frac).padStart(2, '0')}` : String(whole);
}

/** "AI today: US$0.23 of US$3" (2.6): used = status `usage.ai.usd`, cap = `usage.ai.limitUsd`. */
export function aiTodayText(used, cap) {
  return fill(LAB_TEXT.serverSection.aiToday, { used: formatUsd(used), cap: formatUsd(cap) });
}

/** "just now", "{m} min ago", "{h} h ago" or "{d} days ago" (2.5). A time ahead of `now` is "just now". */
export function relativeTime(ms, now = Date.now()) {
  const d = Math.max(0, now - ms);
  if (d < 60e3) return LAB_TEXT.rel.justNow;
  if (d < 3600e3) return fill(LAB_TEXT.rel.minutes, { m: Math.floor(d / 60e3) });
  if (d < 48 * 3600e3) return fill(LAB_TEXT.rel.hours, { h: Math.floor(d / 3600e3) });
  return fill(LAB_TEXT.rel.days, { d: Math.floor(d / 86400e3) });
}

/** The check-in header above the history (2.5): ms from LabLedger.checkedIn(), or null. */
export function checkedInText(ms, now = Date.now()) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return LAB_TEXT.neverCheckedIn;
  return fill(LAB_TEXT.checkedIn, { rel: relativeTime(ms, now) });
}

/**
 * What's in Lab's header line (1.4): "Your Daylight: Lab on · checked in 4 min ago", or the needs-inbox short state
 * with the check-in time ("Needs Lab on your Daylight", alone before any check-in).
 */
export function inboxLabText({ inboxLab, checkedIn } = {}, now = Date.now()) {
  const known = checkedIn !== null && checkedIn !== undefined && Number.isFinite(checkedIn);
  if (inboxLab && known) return fill(LAB_TEXT.inboxLabOn, { rel: relativeTime(checkedIn, now) });
  if (!known) return LAB_TEXT.short['needs-inbox'];
  return fill(LAB_TEXT.inboxLabNeeds, { short: LAB_TEXT.short['needs-inbox'], rel: relativeTime(checkedIn, now) });
}

// ---------------------------------------------------------------------------------------------------------------
// The delivery timeline (2.5)

const step = (name, mark) => (mark ? `${name} ${mark}` : name);
function stepLine(sent, daylight, reader, readerName = LAB_TEXT.steps.reader) {
  const m = LAB_TEXT.marks;
  const mk = (x) => (x ? m[x] : '');
  return [step(LAB_TEXT.steps.sent, mk(sent)), step(LAB_TEXT.steps.daylight, mk(daylight)), step(readerName, mk(reader))]
    .join(LAB_TEXT.stepJoin);
}

function hasCapIn(ctx, token) {
  const h = ctx.hasCap;
  if (typeof h === 'function') return !!h(token);
  if (Array.isArray(h)) return h.includes(token);
  return true; // no caps given: ctx.inboxLab alone decides
}

/**
 * A row as the Lab timeline shows it (2.5; vectors > labRowText).
 * ctx: {lab, inboxLab, hasCap (a function, or an array of tokens; absent = inboxLab alone decides), state ({s, t},
 *       a state token, or null: the ledger's state for this row), online (false = offline)}.
 * -> {label, sentence, action, stepLine, final}: label, sentence and action as describeRow; stepLine null for v1.1
 *    rows (rules 1 and 4); final true for reader, queued and handed. Show the sentence and step line on the newest
 *    row and every row that is not final; the accessibility label is labRowA11yLabel().
 */
export function describeLabRow(row, now = Date.now(), ctx = {}) {
  const v11 = { ...describeRow(row, now), stepLine: null, final: false };
  if (!ctx?.lab) return v11; // rule 1
  const status = row?.status;
  const code = row?.errorCode ?? '';
  const out = (t, line, final = false) => ({ label: t.label, sentence: t.sentence, action: null, stepLine: line, final });
  if (ctx.online === false && (status === 'sending' || (status === 'failed' && code === 'network'))) {
    return out(LAB_TEXT.rows.offline, stepLine('going', '', '')); // rule 2
  }
  if (status !== 'delivered') { // rule 3
    const line = status === 'sending' ? stepLine('going', '', '')
      : status === 'failed' || status === 'expired' ? stepLine('stopped', '', '')
        : status === 'sent' ? stepLine('done', 'going', '') : null;
    return { ...v11, stepLine: line };
  }
  if (!ctx.inboxLab || !hasCapIn(ctx, CAPS.st)) return v11; // rule 4
  const s = typeof ctx.state === 'string' ? ctx.state : ctx.state?.s; // rule 5
  const R = LAB_TEXT.rows;
  switch (s) {
    case 'waiting': return out(R.waiting, stepLine('done', 'done', 'going'));
    case 'held': return out(R.held, stepLine('done', 'done', 'going'));
    case 'inbox': return out(R.inbox, stepLine('done', 'done', 'stopped'));
    case 'failed': return out(R.failed, stepLine('done', 'done', 'stopped'));
    case 'handed': return out(row?.kind === 'file' ? R.handedFile : R.handedLink, stepLine('done', 'done', '', LAB_TEXT.steps.handed), true);
    case 'queued': return out(R.queued, stepLine('done', 'done', 'done'), true);
    case 'reader': return out(R.reader, stepLine('done', 'done', 'done'), true);
    default: return out(R.delivered, stepLine('done', 'done', 'going'));
  }
}

/** A row's accessibility label (2.5): "{label}. {sentence}", or the label alone; never the step line. */
export function labRowA11yLabel(d) { return d?.sentence ? `${d.label}. ${d.sentence}` : (d?.label ?? ''); }

/**
 * Faster checks (2.5): true while a delivered row from the last 10 minutes has no settled state, so a visible app
 * reads the ack topic every FAST_CHECK_MS. states: the ledger's {id: {s, t}} (LabLedger.snapshot().states).
 */
export function wantsFastChecks(rows, now = Date.now(), states = {}) {
  return (rows ?? []).some((r) => r?.status === 'delivered' && now - (r.delivered ?? 0) <= FAST_CHECK_WINDOW_MS
    && !SETTLED_STATES.includes(states?.[r.id]?.s));
}

// ---------------------------------------------------------------------------------------------------------------
// The gate (1.5, 2.6, 2.7.2)

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve({ state: 'OFFLINE', message: null, deadline: true }), ms); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Runs a feature's gate (1.5). feature: a Lab feature id (F01…) or a server feature key ('files', 'ai', 'pdf',
 * 'email', 'feeds', 'deliver').
 * ctx: {
 *   lab: boolean, paired: boolean,
 *   hasCap: (token) => boolean | Promise<boolean>, or an array of tokens (LabLedger.hasCap),
 *   local: (feature) => null | state (or a promise of one): the app's own checks, e.g. 'needs-notifications',
 *   server: a DaylightServer (server/client/daylight-server.js) or null; its state(key) is raced against
 *           `deadlineMs` (GATE_DEADLINE_MS), and a server that has not answered gives OFFLINE,
 *   serverMessage: (state) => text, the server module's localMessage, for an OFFLINE the deadline decided,
 *   built: (feature) => boolean (default: true): false gives `later` once everything else is ready,
 *   app, platform: for the texts (needsMessage), deadlineMs }
 * Checks in order: Lab on; paired; the Inbox capability; ctx.local; the server state; built.
 * -> {ready, state, message, short, button}. state 'lab-off' when Lab is off (message: "Turn on Lab in {app} to use
 *    this."). When a later server call fails with a ServerError, call ctx.server.noteError(key, err) (2.6).
 */
export async function labGate(feature, ctx = {}) {
  const texts = { app: ctx.app, platform: ctx.platform, feature };
  const result = (state, message) => ({
    ready: state === 'ready', state, message: state === 'ready' ? null : message,
    short: needsMessage(state, { short: true }), button: LAB_TEXT.buttons[state] ?? null,
  });
  const not = (state, message) => result(state, message ?? needsMessage(state, texts));
  if (!ctx.lab) {
    return { ready: false, state: 'lab-off', message: fill(LAB_TEXT.labOff, { app: ctx.app ?? LAB_TEXT.appName[ctx.platform] ?? 'Send to Daylight' }), short: null, button: null };
  }
  if (!ctx.paired) return not('needs-pairing');
  const cap = FEATURE_CAPS[feature];
  if (cap) {
    const h = ctx.hasCap;
    const has = typeof h === 'function' ? await h(cap) : Array.isArray(h) ? h.includes(cap) : false;
    if (!has) return not('needs-inbox');
  }
  const local = ctx.local ? await ctx.local(feature) : null;
  if (local && local !== 'ready') return not(local);
  const key = SERVER_FEATURES[feature] ?? (Object.hasOwn(SERVER_KEYS, feature) ? feature : null);
  if (key) {
    if (!ctx.server) return not('needs-server');
    let r;
    try {
      r = await withDeadline(Promise.resolve().then(() => ctx.server.state(key)), ctx.deadlineMs ?? GATE_DEADLINE_MS);
    } catch (e) {
      r = e?.code === 'OFFLINE' ? { state: 'OFFLINE', message: e.message } : { state: 'error', message: e?.message ?? null };
    }
    const state = typeof r?.state === 'string' ? r.state : 'error';
    if (state !== 'ready') {
      if (state === 'needs-server' || state === 'needs-lab-inbox') return not(state);
      const message = r?.message ?? ctx.serverMessage?.(state) ?? null;
      return result(Object.hasOwn(LAB_TEXT.short, state) ? state : 'error', message);
    }
  }
  if (ctx.built && !(await ctx.built(feature))) return not('later');
  return result('ready', null);
}

// ---------------------------------------------------------------------------------------------------------------
// Return and control lanes (2.4): derived now, used from W2 and W3.

/** -> {returnTopic, returnAckTopic, controlTopic, controlAckTopic}. Labels end in a 0x00 byte. */
export async function deriveLabTopics(secret) {
  if (!(secret instanceof Uint8Array) || secret.length !== 16) throw new ShareError('secret', 'secret must be 16 bytes');
  const topic = async (name) => 'dls-' + toHex(await sha256(concat(utf8(`dlshare/v1/${name}\0`), secret))).slice(0, 32);
  return {
    returnTopic: await topic('lab-return'),
    returnAckTopic: await topic('lab-return-ack'),
    controlTopic: await topic('lab-control'),
    controlAckTopic: await topic('lab-control-ack'),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The Inbox side (2.2.4): the reference for Kotlin's LabInbox. Tests and the Apple e2e receiver use it as the Daylight.

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Publishes the Inbox's hellos and item states on the ack topic (2.2.4).
 * storage: the protocol's storage adapter (one key, `lab/out`); relay: a RelayClient; keys: deriveKeys(secret);
 * info: () => {lab, app, caps, poll?, live?} (or that object): the Inbox's current hello. `poll` defaults to the time
 * notePolled() last recorded; from: the Inbox's name; autoFlushMs: the delay of the flush after record() (2 s), or
 * null for no timers (tests call flush() themselves); log: (line) => void; buildFrame: buildLabFrame (tests replace it).
 * Rules: frames carry at most 24 states, oldest first, at most one every 30 s; nothing goes while the last poll's acks
 * failed or within an hour of a 429 or 413; at most 30 hellos and state frames a UTC day (digest frames and the
 * lab: 0 frames are outside the cap); a batch that is not small is halved down to one entry, and an entry that still
 * does not fit is dropped; at most 500 pending entries (the oldest go first).
 */
export class LabInbox {
  constructor({ storage, relay, keys, info, from = '', now = () => Date.now(), autoFlushMs = LAB_FLUSH_DELAY_MS, log = null, buildFrame = buildLabFrame } = {}) {
    this.storage = storage; this.relay = relay; this.keys = keys; this.info = info; this.from = from; this.now = now;
    this.autoFlushMs = autoFlushMs; this.log = log ?? (() => {}); this.buildFrame = buildFrame;
    this._timer = null;
  }

  _lock(fn) { return locked(this.storage, 'lab-inbox', fn); }

  async _load() {
    let st;
    try { st = await this.storage.get('lab/out'); } catch { st = null; }
    const base = {
      on: null, pending: [], published: [], digest: [], lastFrameAt: 0, lastInfo: null, day: '', dayCount: 0,
      limitUntil: 0, acksFailed: false, helloDue: false, offAt: 0, offRepeats: 0, offPending: false, lastPoll: null,
    };
    st = { ...base, ...(isObject(st) ? st : {}) };
    if (st.on === null) st.on = this._info(st).lab >= 1;
    return st;
  }

  async _save(st) { await this.storage.set('lab/out', st); }

  _info(st) {
    const i = (typeof this.info === 'function' ? this.info() : this.info) ?? {};
    return { lab: i.lab ?? LAB_LEVEL, app: i.app ?? '', caps: i.caps ?? [], poll: i.poll ?? st?.lastPoll ?? null, live: i.live === true };
  }

  _schedule(ms) {
    if (this.autoFlushMs === null || this.autoFlushMs === undefined) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = null; this.flush().catch((e) => this.log(`lab: flush failed ${e?.message ?? e}`)); }, ms);
    this._timer?.unref?.();
  }

  /** Stops the flush timer (tests, shutdown). */
  close() { if (this._timer) clearTimeout(this._timer); this._timer = null; }

  /** The Inbox polled the inbox topic successfully at `ms`: the hello's `poll`. */
  notePolled(ms = this.now()) {
    return this._lock(async () => { const st = await this._load(); st.lastPoll = ms; await this._save(st); });
  }

  /**
   * Records that item `id` reached state `s` at `t` (Unix seconds). It replaces a pending entry for the same id, and
   * is kept at all, only when it beats both the pending and the last published entry (a higher rank, or the same rank
   * with a later t), so a re-announced item never goes back from held to waiting. Ignored while Lab is off and for a
   * bad entry. -> true when recorded.
   */
  record(id, s, t) {
    return this._lock(async () => {
      let e;
      try { e = checkEntry({ i: id, s, t }); } catch { this.log(`lab: bad state ${id} ${s}`); return false; }
      const st = await this._load();
      if (!st.on) return false;
      const pending = st.pending.find((p) => p.i === e.i) ?? null;
      const published = st.published.filter((p) => p.i === e.i).at(-1) ?? null;
      if (!beats(e, pending) || !beats(e, published)) return false;
      st.pending = st.pending.filter((p) => p.i !== e.i);
      st.pending.push(e);
      if (st.pending.length > PENDING_MAX) st.pending.splice(0, st.pending.length - PENDING_MAX);
      await this._save(st);
      this.log(`lab: state ${e.i} ${e.s}`);
      this._schedule(this.autoFlushMs);
      return true;
    });
  }

  /** The last poll's acks failed to publish (true) or went out (false). While true, Lab frames give way. */
  noteAcksFailed(failed = true) {
    return this._lock(async () => { const st = await this._load(); st.acksFailed = !!failed; await this._save(st); });
  }

  /** A 429 or 413 from the relay (any publish or poll of this Inbox): Lab frames give way for an hour. */
  noteRelayLimit(status) {
    if (status !== 429 && status !== 413) return Promise.resolve();
    return this._lock(async () => {
      const st = await this._load();
      st.limitUntil = Math.max(st.limitUntil, this.now() + LAB_YIELD_MS);
      await this._save(st);
    });
  }

  /** Lab was turned on: a hello goes at the next flush (this one). */
  async labTurnedOn() {
    await this._lock(async () => {
      const st = await this._load();
      Object.assign(st, { on: true, helloDue: true, offPending: false, offAt: 0, offRepeats: 0 });
      await this._save(st);
    });
    return this.flush();
  }

  /** Lab was turned off: one frame with lab: 0 and caps: [], repeated after each ack digest for 48 h (digest()). */
  async labTurnedOff() {
    await this._lock(async () => {
      const st = await this._load();
      Object.assign(st, { on: false, pending: [], digest: [], helloDue: false, offPending: true, offAt: this.now(), offRepeats: 0 });
      await this._save(st);
    });
    return this.flush();
  }

  /**
   * Call with the v1.1 ack digest (every 11 hours). Lab on: queues the latest state of every item whose state changed
   * in the last 48 hours (at most 48, newest first, 24 a frame), pending ones included. Lab off within 48 h of turning
   * it off: queues the lab: 0 frame again (at most 5 times). Then flushes.
   */
  async digest() {
    await this._lock(async () => {
      const st = await this._load();
      const now = this.now();
      if (st.on) {
        const latest = new Map();
        for (const e of [...st.published, ...st.pending, ...st.digest.flat()]) { // a digest still queued is folded in
          if (e.t * 1000 < now - STATE_DIGEST_WINDOW_MS) continue;
          if (beats(e, latest.get(e.i) ?? null)) latest.set(e.i, { i: e.i, s: e.s, t: e.t });
        }
        const all = [...latest.values()].sort((a, b) => b.t - a.t || (a.i < b.i ? -1 : 1)).slice(0, STATE_DIGEST_MAX);
        const taken = new Set(all.map((e) => e.i));
        st.pending = st.pending.filter((p) => !taken.has(p.i));
        st.digest = [];
        for (let i = 0; i < all.length; i += MAX_ST_PER_FRAME) st.digest.push(all.slice(i, i + MAX_ST_PER_FRAME));
      } else if (st.offAt && now - st.offAt <= LAB_OFF_REPEAT_MS && st.offRepeats < LAB_OFF_REPEATS) {
        st.offPending = true; st.offRepeats += 1;
      }
      await this._save(st);
    });
    return this.flush();
  }

  /**
   * Publishes at most one Lab frame, in this order: the lab: 0 frame; a digest frame; pending states (a state frame);
   * a hello when one is due (Lab turned on, caps or app changed, or the last Lab frame is over 11 hours old).
   * -> {published: 0 | 1, kind: 'off' | 'digest' | 'states' | 'hello' | null, states, reason, waitMs?}. reason:
   * 'sent', 'yield' (acks failed or a 429/413 within the hour), 'spacing' (30 s since the last Lab frame), 'cap',
   * 'idle', 'off' or 'error' (the publish failed; entries are kept). Schedules the next flush while more waits.
   */
  flush() { return this._lock(() => this._flush()); }

  async _flush() {
    const st = await this._load();
    const now = this.now();
    const day = utcDay(now);
    if (st.day !== day) { st.day = day; st.dayCount = 0; }
    st.published = st.published.filter((e) => e.t * 1000 >= now - STATE_DIGEST_WINDOW_MS || e.at >= now - STATE_DIGEST_WINDOW_MS);
    const none = (reason, extra = {}) => ({ published: 0, kind: null, states: 0, reason, ...extra });
    const info = this._info(st);
    let kind = null, batch = [];
    if (!st.on) {
      if (!st.offPending) { await this._save(st); return none('off'); }
      kind = 'off';
    } else if (st.digest.length) {
      kind = 'digest'; batch = st.digest[0];
    } else if (st.pending.length) {
      kind = 'states'; batch = st.pending.slice(0, MAX_ST_PER_FRAME);
    } else if (st.helloDue || !st.lastInfo || st.lastInfo.app !== readApp(info.app)
      || !sameList(st.lastInfo.caps, readCaps(info.caps)) || now - st.lastFrameAt > HELLO_EVERY_MS) {
      kind = 'hello';
    } else {
      await this._save(st);
      return none('idle');
    }
    if (st.acksFailed || now < st.limitUntil) { await this._save(st); return none('yield'); }
    if (st.lastFrameAt && now - st.lastFrameAt < LAB_FRAME_GAP_MS) {
      const waitMs = st.lastFrameAt + LAB_FRAME_GAP_MS - now;
      await this._save(st);
      this._schedule(waitMs);
      return none('spacing', { waitMs });
    }
    if ((kind === 'states' || kind === 'hello') && st.dayCount >= LAB_FRAMES_PER_DAY) { await this._save(st); return none('cap'); }

    const hello = kind === 'off' ? { ...info, lab: 0, caps: [] } : info;
    let frame = null;
    for (;;) {
      try {
        frame = await this.buildFrame(this.keys, { inbox: hello, states: batch, from: this.from, sent: nowIso(now) });
        break;
      } catch (e) {
        if (e?.reason !== 'not-small' || !batch.length) throw e;
        if (batch.length > 1) { batch = batch.slice(0, Math.ceil(batch.length / 2)); continue; }
        const dropped = batch[0];
        this.log(`lab: dropped state ${dropped.i} ${dropped.s}: the frame is not small`);
        st.pending = st.pending.filter((p) => p !== dropped && p.i !== dropped.i);
        if (kind === 'digest') {
          st.digest[0] = st.digest[0].filter((p) => p.i !== dropped.i);
          if (!st.digest[0].length) st.digest.shift();
        }
        await this._save(st);
        return this._flush();
      }
    }
    try {
      await this.relay.publish(this.keys.ackTopic, frame);
    } catch (e) {
      if (e?.status === 429 || e?.status === 413) st.limitUntil = Math.max(st.limitUntil, now + LAB_YIELD_MS);
      await this._save(st);
      this.log(`lab: publish failed ${e?.message ?? e}`);
      return none('error', { error: e });
    }
    st.lastFrameAt = now;
    st.lastInfo = { app: readApp(hello.app), caps: readCaps(hello.caps) };
    if (kind === 'off') {
      st.offPending = false;
    } else {
      st.helloDue = false;
      if (kind === 'digest') {
        const ids = new Set(batch.map((e) => e.i));
        st.digest[0] = st.digest[0].filter((e) => !ids.has(e.i));
        if (!st.digest[0].length) st.digest.shift();
      } else {
        st.dayCount += 1;
      }
      if (kind === 'states') st.pending = st.pending.filter((p) => !batch.includes(p));
      for (const e of batch) st.published.push({ i: e.i, s: e.s, t: e.t, at: now });
    }
    await this._save(st);
    if (kind === 'hello') this.log(`lab: hello caps=${st.lastInfo.caps.join(',')}${hello.lab === 0 ? ' lab=0' : ''}`);
    else if (kind === 'off') this.log('lab: hello lab=0');
    else this.log(`lab: states n=${batch.length} published`);
    if (st.on && (st.digest.length || (st.pending.length && st.dayCount < LAB_FRAMES_PER_DAY))) this._schedule(LAB_FRAME_GAP_MS);
    return { published: 1, kind, states: batch.length, reason: 'sent' };
  }

  /** The stored state, for tests and diagnostics. */
  async debugState() { return this._lock(() => this._load()); }
}

/**
 * A Lab Daylight for tests: pollOnce() runs receiver.pollOnce(), notes the poll and its ack outcome, records
 * stateFor(header) for each new item (default: reader for url and page, handed for file; a state token for all),
 * then flushes. -> the receiver's result plus `lab` (the flush's result).
 */
export class LabInboxSim {
  constructor({ receiver, labInbox, stateFor = null } = {}) {
    this.receiver = receiver; this.labInbox = labInbox;
    this.stateFor = stateFor ?? ((h) => (h.kind === 'file' ? 'handed' : 'reader'));
  }

  async pollOnce() {
    let res;
    try {
      res = await this.receiver.pollOnce();
    } catch (e) {
      await this.labInbox.noteRelayLimit(e?.status);
      throw e;
    }
    const now = this.labInbox.now();
    await this.labInbox.notePolled(now);
    await this.labInbox.noteAcksFailed(!!res.ackError);
    if (res.limited) await this.labInbox.noteRelayLimit(res.limited);
    for (const it of res.items) {
      const s = typeof this.stateFor === 'function' ? this.stateFor(it.header) : this.stateFor;
      if (s) await this.labInbox.record(it.header.id, s, Math.floor(now / 1000));
    }
    return { ...res, lab: await this.labInbox.flush() };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// W1 (L1): smart intake (F16), excerpts (F11), the test article and diagnostics (F26), the Inbox's row lines (F03)
// and the per-feature Use switches (6.5 Q5). Pure functions with no DOM and no URL parser: every rule is textual, so
// Swift and Kotlin can match it exactly (LAB-PROTOCOL 2.9; vectors: normalise.json, labExcerpt and diagnostics).
// "Whitespace" is ECMAScript's \s: U+0009-000D, U+0020, U+00A0, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F,
// U+3000 and U+FEFF. "Characters" are Unicode code points.

/** The features whose What's in Lab row has a Use switch (6.5 Q5): they change how sharing behaves. */
export const USE_FEATURES = ['F03', 'F04', 'F08', 'F10', 'F16', 'F33'];
export const EXCERPT_MAX_CHARS = 50000;
export const EXCERPT_LINE_MAX = 100;
export const EXCERPT_NAME_WORDS = 6;
export const TEXT_FRAGMENT_WORDS = 8;
export const ACTIVITY_MAX = 200;
export const DIAGNOSTICS_EVENTS = 50;
export const TEST_URL_PREFIX = 'https://daylight.invalid/test/';
/** The tags an excerpt keeps (F11); `href` only on `a`, and only http(s). */
export const EXCERPT_TAGS = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'a', 'ul', 'ol', 'li',
  'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
/** Block tags an excerpt keeps as paragraphs, so that their text does not run together. */
export const EXCERPT_AS_P = ['address', 'article', 'aside', 'caption', 'center', 'dd', 'details', 'div', 'dt',
  'figcaption', 'figure', 'footer', 'header', 'main', 'section', 'summary', 'tr'];
/** Elements an excerpt drops with everything inside them. */
export const EXCERPT_DROP = ['script', 'style', 'template', 'noscript', 'iframe', 'object', 'textarea', 'select',
  'title', 'head', 'svg', 'math', 'canvas', 'video', 'audio', 'button'];
/** Tracking parameters removed from every URL (F16 step 4); names compare exactly, and every utm_* goes too. */
export const TRACKING_PARAMS = ['fbclid', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid',
  'igsh', 'yclid', 'twclid', 'ttclid', '_hsenc', '_hsmi', 'mkt_tok', 'ref_src', 'ref_url', '__s', 'sr_share'];
/** Tracking parameters removed on some sites only: a host matches a domain when it is the domain or ends in "." + it. */
export const TRACKING_BY_SITE = [
  { domains: ['youtube.com', 'youtu.be', 'open.spotify.com'], params: ['si'] },
  { domains: ['twitter.com', 'x.com'], params: ['s', 't'] },
  { domains: ['nytimes.com'], params: ['smid', 'smtyp'] },
  { subdomainsOf: 'substack.com', params: ['r', 'triedRedirect', 'showWelcome'] },
];

/** Fills {slots} in a LAB_TEXT string; a slot without a value stays as it is. */
export function fillText(s, vars = {}) { return fill(String(s ?? ''), vars); }

/**
 * Whether a Lab feature is in use (6.5 Q5): Lab is on and, for a feature with a Use switch (USE_FEATURES), that switch
 * is not off. settings: {lab, labUse: {F04: false, …}}; a missing key means on (1.2). The stores keep the switches
 * next to `lab`: Apple `dls.labUse.<id>` (Bool), Android `labUse.<id>`, JS `settings.labUse[<id>]`.
 */
export function labUseOn(settings, feature) {
  if (settings?.lab === false) return false;
  if (!USE_FEATURES.includes(feature)) return true;
  return settings?.labUse?.[feature] !== false;
}

const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;');
const codePoints = (s) => Array.from(String(s ?? ''));

/** Undoes the character references a serialiser writes: &amp; &lt; &gt; &quot; &#39; &apos; and numeric ones. */
function decodeEntities(s) {
  return String(s).replace(/&(amp|lt|gt|quot|apos|#39|#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6});/g, (m, e) => {
    switch (e) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': case '#39': return '\'';
      default: {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : m;
      }
    }
  });
}

/** An attribute's raw value (quoted with " or ', or unquoted) in a tag's attribute text, or null. */
function attrValue(attrs, name) {
  const re = /(?:^|[\s"'/])([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of String(attrs).matchAll(re)) {
    if (m[1].toLowerCase() === name) return m[2] ?? m[3] ?? m[4] ?? '';
  }
  return null;
}

// ---- URLs, as text (the input has passed webUrl)

function urlParts(u) {
  const i = u.indexOf('://');
  let rest = u.slice(i + 3);
  let fragment = null, query = null;
  const h = rest.indexOf('#');
  if (h >= 0) { fragment = rest.slice(h + 1); rest = rest.slice(0, h); }
  const q = rest.indexOf('?');
  if (q >= 0) { query = rest.slice(q + 1); rest = rest.slice(0, q); }
  const slash = rest.indexOf('/');
  const authority = slash >= 0 ? rest.slice(0, slash) : rest;
  const hostport = authority.slice(authority.lastIndexOf('@') + 1);
  let host;
  if (hostport.startsWith('[')) host = hostport.slice(0, hostport.indexOf(']') + 1);
  else { const c = hostport.indexOf(':'); host = c < 0 ? hostport : hostport.slice(0, c); }
  return { scheme: u.slice(0, i), authority, hostport, host: host.toLowerCase(), path: slash >= 0 ? rest.slice(slash) : '', query, fragment };
}

const urlJoin = (p) => `${p.scheme}://${p.authority}${p.path}${p.query === null ? '' : '?' + p.query}${p.fragment === null ? '' : '#' + p.fragment}`;
const hostIs = (host, domain) => host === domain || host.endsWith('.' + domain);
const paramName = (piece) => { const eq = piece.indexOf('='); return eq < 0 ? piece : piece.slice(0, eq); };

/** The first parameter named exactly `name`, percent-decoded as UTF-8 ('+' stays '+'), or null (also when invalid). */
function queryParam(query, name) {
  if (query === null) return null;
  for (const piece of query.split('&')) {
    if (paramName(piece) !== name) continue;
    const eq = piece.indexOf('=');
    try { return decodeURIComponent(eq < 0 ? '' : piece.slice(eq + 1)); } catch { return null; }
  }
  return null;
}

const GOOGLE_HOST = /^(?:www\.)?google(?:\.[a-z]{2,3}){1,2}$/;

/** One unwrap step of F16 step 3, or null. The caller checks the result with webUrl. */
function unwrapOnce(u) {
  const p = urlParts(u);
  const tail = (from) => p.path.slice(from) + (p.query === null ? '' : '?' + p.query) + (p.fragment === null ? '' : '#' + p.fragment);
  const firstValid = (...vs) => vs.find((v) => v !== null && webUrl(v) !== null) ?? null;
  if (GOOGLE_HOST.test(p.host)) {
    if (p.path.startsWith('/amp/s/')) return 'https://' + tail(7);
    if (p.path === '/url') return firstValid(queryParam(p.query, 'q'), queryParam(p.query, 'url'));
  }
  if (p.host.endsWith('.cdn.ampproject.org')) {
    if (p.path.startsWith('/c/s/') || p.path.startsWith('/v/s/')) return 'https://' + tail(5);
    if (p.path.startsWith('/c/')) return 'http://' + tail(3);
  }
  if ((p.host === 'l.facebook.com' || p.host === 'lm.facebook.com') && p.path === '/l.php') return queryParam(p.query, 'u');
  if (p.host === 'l.instagram.com' && (p.path === '' || p.path === '/')) return queryParam(p.query, 'u');
  if ((p.host === 'www.linkedin.com' || p.host === 'linkedin.com') && (p.path === '/safety/go' || p.path === '/safety/go/')) {
    return queryParam(p.query, 'url');
  }
  if (p.host === 'open.substack.com') {
    const m = /^\/pub\/([A-Za-z0-9-]+)\/p\/([^/]+)(\/.*)?$/.exec(p.path);
    if (m) return `https://${m[1].toLowerCase()}.substack.com/p/${m[2]}${m[3] ?? ''}` + tail(p.path.length);
  }
  return null;
}

function isTracking(name, host) {
  if (name.startsWith('utm_') || TRACKING_PARAMS.includes(name)) return true;
  for (const r of TRACKING_BY_SITE) {
    const site = r.subdomainsOf ? host.endsWith('.' + r.subdomainsOf) : r.domains.some((d) => hostIs(host, d));
    if (site && r.params.includes(name)) return true;
  }
  return false;
}

/** F16 step 4: removes tracking parameters. Nothing else changes; a URL with none to remove comes back unchanged. */
function stripTracking(u) {
  const p = urlParts(u);
  if (p.query === null) return u;
  const pieces = p.query.split('&');
  const keep = pieces.filter((piece) => !isTracking(paramName(piece), p.host));
  if (keep.length === pieces.length) return u;
  const q = keep.filter((piece) => piece !== '').join('&');
  return urlJoin({ ...p, query: q === '' ? null : q });
}

/**
 * F16 steps 3 and 4 on a URL that passes the web URL rule: unwrap redirectors without the network (Google AMP and
 * /url, the AMP cache, Facebook, Instagram, LinkedIn, open.substack.com; at most 5 steps, each result checked with
 * webUrl), then remove tracking parameters. -> the cleaned URL (the input itself when nothing applies), or null for
 * an input that is not a web URL.
 */
export function cleanShareUrl(url) {
  let cur = webUrl(url);
  if (!cur) return null;
  for (let i = 0; i < 5; i++) {
    const next = unwrapOnce(cur);
    const ok = next === null ? null : webUrl(next);
    if (!ok || ok === cur) break;
    cur = ok;
  }
  return stripTracking(cur);
}

const URL_TRAIL = '.,;:!?\'"»”’';
const countOf = (s, c) => s.split(c).length - 1;

/**
 * F16 step 1: the first http(s) URL in shared text: a run of characters other than whitespace, < > and " that starts
 * with http:// or https:// (any case), without trailing . , ; : ! ? ' " » ” ’ and without a trailing ) or ] while it
 * is unbalanced (repeated until none applies), that passes webUrl. -> {url, start, end} (UTF-16 offsets of the URL
 * in `text`), or null.
 */
export function findShareUrl(text) {
  const t = String(text ?? '');
  for (const m of t.matchAll(/https?:\/\/[^\s<>"]+/gi)) {
    const s = m[0];
    const n = { '(': countOf(s, '('), ')': countOf(s, ')'), '[': countOf(s, '['), ']': countOf(s, ']') };
    let end = s.length;
    for (;;) {
      const c = s[end - 1];
      if (URL_TRAIL.includes(c) || (c === ')' && n['('] < n[')']) || (c === ']' && n['['] < n[']'])) {
        if (c in n) n[c] -= 1;
        end -= 1;
        continue;
      }
      break;
    }
    const u = s.slice(0, end);
    if (webUrl(u) === u) return { url: u, start: m.index, end: m.index + u.length };
  }
  return null;
}

/** True when the URL's fragment holds a text directive (`:~:text=`), as Chrome on Android shares a selection. */
export function hasTextFragment(url) {
  const u = String(url ?? '');
  const h = u.indexOf('#');
  return h >= 0 && u.slice(h).includes(':~:text=');
}

/** The URL without its fragment directive (from `:~:` on), and without the '#' when nothing is left before it. */
export function withoutTextFragment(url) {
  const u = String(url ?? '');
  const h = u.indexOf('#');
  if (h < 0) return u;
  const k = u.indexOf(':~:', h);
  if (k < 0) return u;
  return k === h + 1 ? u.slice(0, h) : u.slice(0, k);
}

/**
 * The quoted text of a URL's first text directive: its start and end (prefix- and -suffix left out), each
 * percent-decoded (left as it is when that fails), joined with " … ". "" when there is none.
 */
export function textFragmentText(url) {
  const u = String(url ?? '');
  const h = u.indexOf('#');
  if (h < 0) return '';
  const k = u.indexOf(':~:', h);
  if (k < 0) return '';
  const directive = u.slice(k + 3).split('&').find((d) => d.startsWith('text='));
  if (!directive) return '';
  let parts = directive.slice(5).split(',');
  if (parts.length > 1 && parts[0].endsWith('-')) parts = parts.slice(1);
  if (parts.length > 1 && parts[parts.length - 1].startsWith('-')) parts = parts.slice(0, -1);
  const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  return parts.map(dec).map((s) => s.trim()).filter(Boolean).join(' … ');
}

const QUOTE_PAIRS = [['"', '"'], ['“', '”'], ['\'', '\''], ['‘', '’'], ['«', '»'], ['„', '“']];

/** Removes one pair of quotes around the whole text ("…", “…”, '…', ‘…’, «…», „…“), then trims. */
function unquote(s) {
  for (const [a, b] of QUOTE_PAIRS) {
    if (s.length >= 2 && s.startsWith(a) && s.endsWith(b)) return s.slice(a.length, s.length - b.length).trim();
  }
  return s;
}

/**
 * Link or excerpt (F11, with the user's answer to LAB-PLAN 6.5 Q1 = (b)): text becomes an excerpt only when the share
 * is clearly a selection. Rules, in order:
 *   1. source is 'selection' (the extension's context menu or Selection mode, a Safari share's selectionText, or the
 *      Options choice "Send as excerpt"): an excerpt of the text (without its URL), or a note when there is no URL;
 *   2. the URL carries a text fragment (#:~:text=, Chrome on Android's shared selection): an excerpt of the text
 *      without the URL (one pair of surrounding quotes removed), or else of the fragment's own text;
 *   3. there is no URL at all (Notes, Books, the Mac Services text type): a note;
 *   everything else is a link, with the text left over as its title: "headline + link" shares stay links, however
 *   long. (Rule 4 of the plan, 40 words or 3 sentences, is not used under 6.5 Q1 (b).)
 * text: the shared text; url: a URL shared on its own (used when it passes webUrl; else the first URL in the text);
 * title: the page title or subject (kept in the signature, unused under (b)); source: 'selection' or anything else.
 * -> {kind: 'link' | 'excerpt' | 'note' | 'none', url (or null), text (the text without its URL, trimmed)}
 */
export function classifyShare({ text = '', url = '', title = '', source = '' } = {}) { // eslint-disable-line no-unused-vars
  const t = String(text ?? '');
  const found = findShareUrl(t);
  const u = (url ? webUrl(url) : null) ?? found?.url ?? null;
  const rest = (found ? t.slice(0, found.start) + t.slice(found.end) : t).trim();
  if (source === 'selection') {
    if (rest) return { kind: u ? 'excerpt' : 'note', url: u, text: rest };
    return u ? { kind: 'link', url: u, text: '' } : { kind: 'none', url: null, text: '' };
  }
  if (u && hasTextFragment(u)) {
    const quote = unquote(rest) || textFragmentText(u);
    if (quote) return { kind: 'excerpt', url: u, text: quote };
  }
  if (!u) return rest ? { kind: 'note', url: null, text: rest } : { kind: 'none', url: null, text: '' };
  return { kind: 'link', url: u, text: rest };
}

const TITLE_EDGE = ' -–—:|·"\'“”‘’«»„';
const TITLE_PUNCT = '.,;!?';

/**
 * A title from shared text whose URL was taken out: the empty pairs a URL leaves behind, () [] <> "" “” ‘’ «» (with
 * only whitespace inside), become a space; whitespace is collapsed; then, until none applies, whitespace, - – — : | ·
 * and quotes are trimmed from both ends, . , ; ! ? from the start, and . , ; ! ? from the end when a space comes
 * before them; then cleanTitle.
 */
export function shareTitle(text) {
  const s = String(text ?? '').replace(/\(\s*\)|\[\s*\]|<\s*>|"\s*"|“\s*”|‘\s*’|«\s*»/g, ' ').replace(/\s+/g, ' ');
  let a = 0, b = s.length;
  for (let moved = true; moved;) {
    moved = false;
    while (a < b && (TITLE_EDGE.includes(s[a]) || TITLE_PUNCT.includes(s[a]))) { a += 1; moved = true; }
    while (b > a && TITLE_EDGE.includes(s[b - 1])) { b -= 1; moved = true; }
    let k = b;
    while (k > a && TITLE_PUNCT.includes(s[k - 1])) k -= 1;
    if (k < b && k > a && s[k - 1] === ' ') { b = k; moved = true; }
  }
  return cleanTitle(s.slice(a, b));
}

/**
 * Smart intake (F16), for every entry point while Lab is on (and F16's Use switch, labUseOn).
 * {text, url, subject, source} -> {kind, url, title, excerpt, orig}:
 *   kind and the URL come from classifyShare; url is cleanShareUrl's result (null for a note);
 *   title: for a link, `subject` when it is not empty, else the text without its URL (shareTitle); null when empty and
 *     for every excerpt and note (a headline is always a title, however long);
 *   excerpt: the excerpt's or note's text, else null;
 *   orig: the URL as shared when the cleaned one differs and it is at most X_ORIG_MAX characters, else null. Send it as
 *     x-orig (buildItemFrames also leaves it out when it would make a small frame large).
 * Apple News links (apple.news) stay as they are here: iPhone and Mac resolve them with one fetch and
 * extractAppleNewsTarget, then run normaliseShare on the result.
 */
export function normaliseShare({ text = '', url = '', subject = '', source = '' } = {}) {
  const c = classifyShare({ text, url, title: subject, source });
  const out = { kind: c.kind, url: null, title: null, excerpt: null, orig: null };
  if (c.url) {
    out.url = cleanShareUrl(c.url);
    if (out.url !== c.url && c.url.length <= X_ORIG_MAX) out.orig = c.url;
  }
  if (c.kind === 'excerpt' || c.kind === 'note') out.excerpt = c.text;
  else if (c.kind === 'link') out.title = cleanTitle(subject) || shareTitle(c.text) || null;
  return out;
}

/** True for an Apple News link (apple.news or a subdomain): iPhone and Mac resolve these (F16 step 5). */
export function isAppleNewsUrl(url) {
  const u = webUrl(url);
  return !!u && hostIs(urlParts(u).host, 'apple.news');
}

/**
 * F16 step 5, the pure part: the article an Apple News page points to. The string argument of
 * redirectToUrlAfterTimeout("…") (JavaScript escapes undone), else the first <a href> after <body> whose value
 * (character references undone) passes the web URL rule. -> the URL, or null.
 */
export function extractAppleNewsTarget(html) {
  const s = String(html ?? '');
  const m = /redirectToUrlAfterTimeout\(\s*(["'])((?:\\[\s\S]|(?!\1)[^\\])*)\1/.exec(s);
  if (m) {
    const target = m[2].replace(/\\(u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2}|[\s\S])/g, (_, e) => (
      e.length > 1 ? String.fromCharCode(parseInt(e.slice(1), 16)) : e));
    const u = webUrl(target);
    if (u) return u;
  }
  const body = s.search(/<body[\s>]/i);
  if (body < 0) return null;
  for (const a of s.slice(body).matchAll(/<a(?=[\s>])((?:[^<>"']|"[^<"]*"|'[^<']*')*)>/gi)) {
    const href = attrValue(a[1], 'href');
    const u = href === null ? null : webUrl(decodeEntities(href));
    if (u) return u;
  }
  return null;
}

// ---- Excerpts (F11)

const words = (text, n) => String(text ?? '').trim().split(/\s+/).filter(Boolean).slice(0, n);

/** "Excerpt - {first 6 words}.html", or with note: true "Note - {first 6 words}.md" (through safeFileName). */
export function excerptFileName(text, { note = false } = {}) {
  const E = LAB_TEXT.excerpt;
  const bare = note ? E.noteNameBare : E.fileNameBare;
  const w = words(text, EXCERPT_NAME_WORDS).join(' ');
  return w ? safeFileName(fill(note ? E.noteName : E.fileName, { words: w }), bare) : bare;
}

/** The excerpt's first line: the first line with text, whitespace collapsed, cut to 100 characters with "…". */
export function excerptFirstLine(text) {
  const line = String(text ?? '').split(/\r\n|\r|\n/).map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  const cps = codePoints(line);
  return cps.length <= EXCERPT_LINE_MAX ? line : cps.slice(0, EXCERPT_LINE_MAX).join('').trimEnd() + '…';
}

/** "“{first line}” · {page title}" ("“{first line}”" without one), through cleanTitle. */
export function excerptTitle({ text = '', pageTitle = '' } = {}) {
  const line = excerptFirstLine(text);
  const page = cleanTitle(pageTitle);
  if (!line) return page;
  return cleanTitle(page ? fill(LAB_TEXT.excerpt.title, { line, page }) : fill(LAB_TEXT.excerpt.titleBare, { line }));
}

/**
 * The source URL plus a text fragment of the first 8 words (F11): the URL without its fragment, then
 * "#:~:text=" and the words joined with one space, percent-encoded as UTF-8 except A-Z a-z 0-9 _ . ! ~ * ' ( ) (so
 * '-', ',' and '&' are encoded). The URL unchanged when there are no words, or the result would not pass webUrl or be
 * over 4,096 characters. null when the URL does not pass webUrl.
 */
export function textFragment(url, text) {
  const u = webUrl(url);
  if (!u) return null;
  const w = words(text, TEXT_FRAGMENT_WORDS);
  if (!w.length) return u;
  let enc;
  try { enc = encodeURIComponent(w.join(' ')).replace(/-/g, '%2D'); } catch { return u; }
  const h = u.indexOf('#');
  const out = `${h >= 0 ? u.slice(0, h) : u}#:~:text=${enc}`;
  return out.length <= MAX_URL && webUrl(out) === out ? out : u;
}

/** "22 October 2026" from 'YYYY-MM-DD' (checked as rule D checks dates), or from ms / a Date in local time. '' else. */
export function excerptDate(date) {
  let y, m, d;
  if (typeof date === 'string') {
    const r = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(date);
    if (!r) return '';
    [y, m, d] = r.slice(1).map(Number);
    if (m < 1 || m > 12 || d < 1 || d > monthDays(y, m)) return '';
  } else if ((typeof date === 'number' && Number.isFinite(date)) || date instanceof Date) {
    const x = new Date(date);
    if (Number.isNaN(x.getTime())) return '';
    y = x.getFullYear(); m = x.getMonth() + 1; d = x.getDate();
  } else {
    return '';
  }
  return fill(LAB_TEXT.excerpt.date, { d, month: LAB_TEXT.excerpt.months[m - 1], y });
}

const ENTITY_AT = /^&(?:[A-Za-z][A-Za-z0-9]{0,31}|#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6});/;
const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:[^<>"']|"[^<"]*"|'[^<']*')*)>/g;

/**
 * An excerpt's selection HTML, sanitised (F11; LAB-PROTOCOL 2.9 has the exact steps):
 *   1. remove comments (<!-- to -->, or to the end), then every other <!…> and <?…> (to the next >, or the end);
 *   2. remove each element of EXCERPT_DROP with its content (case-insensitive, to its first closing tag, or the end);
 *   3. read the rest as text and tags. Text: & that does not start a character reference becomes &amp;, < and >
 *      become &lt; and &gt;. Tags: names are lowercased; EXCERPT_AS_P become p; tags outside EXCERPT_TAGS are dropped
 *      (their text stays); br is <br> (its closing tag is dropped); a keeps only an href that passes webUrl once its
 *      character references are undone; every other kept tag loses all its attributes. A closing tag closes the
 *      innermost open element of that name and every element opened after it, and is dropped when none is open;
 *      open elements are closed at the end.
 *   Text past maxChars characters (a character reference counts as one) is cut. -> {html, trimmed}
 */
export function sanitizeExcerptHtml(html, maxChars = EXCERPT_MAX_CHARS) {
  let s = String(html ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<[!?][^>]*>?/g, '');
  for (const name of EXCERPT_DROP) s = s.replace(new RegExp(`<${name}(?=[\\s/>])[^>]*>[\\s\\S]*?(?:</${name}\\s*>|$)`, 'gi'), '');
  let out = '', count = 0, trimmed = false, last = 0;
  const stack = [];
  const text = (raw) => {
    for (let i = 0; i < raw.length;) {
      if (count >= maxChars) { trimmed = true; return false; }
      const c = raw[i];
      if (c === '&') {
        const ref = ENTITY_AT.exec(raw.slice(i, i + 40));
        if (ref) { out += ref[0]; i += ref[0].length; count += 1; continue; }
        out += '&amp;';
      } else if (c === '<') out += '&lt;';
      else if (c === '>') out += '&gt;';
      else {
        const n = raw.codePointAt(i) > 0xffff ? 2 : 1;
        out += raw.slice(i, i + n); i += n; count += 1; continue;
      }
      i += 1; count += 1;
    }
    return true;
  };
  for (const m of s.matchAll(TAG_RE)) {
    if (!text(s.slice(last, m.index))) break;
    last = m.index + m[0].length;
    let name = m[2].toLowerCase();
    if (EXCERPT_AS_P.includes(name)) name = 'p';
    if (!EXCERPT_TAGS.includes(name) || (name === 'br' && m[1])) continue;
    if (m[1]) {
      const k = stack.lastIndexOf(name);
      if (k >= 0) while (stack.length > k) out += `</${stack.pop()}>`;
    } else if (name === 'br') {
      out += '<br>';
    } else {
      const href = name === 'a' ? attrValue(m[3], 'href') : null;
      const u = href === null ? null : webUrl(decodeEntities(href));
      out += u ? `<a href="${escapeAttr(u)}">` : `<${name}>`;
      stack.push(name);
    }
  }
  if (!trimmed) text(s.slice(last));
  while (stack.length) out += `</${stack.pop()}>`;
  return { html: out, trimmed };
}

/** Plain selection text as excerpt HTML: cut to maxChars characters, then paragraphs (split at lines that are only
 * whitespace) of escaped lines joined with <br>. -> {html, trimmed} */
export function excerptTextHtml(text, maxChars = EXCERPT_MAX_CHARS) {
  let cps = codePoints(String(text ?? '').replace(/\r\n?/g, '\n'));
  const trimmed = cps.length > maxChars;
  if (trimmed) cps = cps.slice(0, maxChars);
  const paras = [];
  let cur = [];
  for (const line of cps.join('').split('\n')) {
    if (/^\s*$/.test(line)) { if (cur.length) { paras.push(cur); cur = []; } } else cur.push(line);
  }
  if (cur.length) paras.push(cur);
  return { html: paras.map((p) => `<p>${p.map(escapeText).join('<br>')}</p>`).join(''), trimmed };
}

/**
 * The excerpt document (F11), for a selection with a source URL:
 *   <!doctype html><html><head><meta charset="utf-8"><title>{title}</title></head><body><article>\n
 *   <p><a href="{source url}">{page title}</a> · {site} · {date}</p><blockquote>{selection}</blockquote></article></body></html>
 * title: excerptTitle; source url: `url` without its text fragment; the link reads the page title, else the site;
 * site: `site`, else the URL's host without "www."; it is left out when it equals the link's text, and the date
 * (excerptDate) when there is none. selection: sanitizeExcerptHtml(html) when `html` has text, else
 * excerptTextHtml(text), plus <p>(Excerpt trimmed to 50,000 characters.)</p> when cut.
 */
export function excerptHtml({ text = '', html = '', url = '', pageTitle = '', site = '', date = null } = {}) {
  const src = url ? webUrl(url) : null;
  const source = src ? withoutTextFragment(src) : '';
  const body = String(html ?? '').trim() ? sanitizeExcerptHtml(html) : excerptTextHtml(String(text ?? '').trim());
  const quote = body.html + (body.trimmed ? `<p>${escapeText(LAB_TEXT.excerpt.trimmed)}</p>` : '');
  const page = cleanTitle(pageTitle);
  const host = source ? urlParts(source).host.replace(/^www\./, '') : '';
  const siteName = cleanTitle(site) || host;
  const linkText = page || siteName;
  const parts = [];
  if (source) parts.push(`<a href="${escapeAttr(source)}">${escapeText(linkText || source)}</a>`);
  else if (linkText) parts.push(escapeText(linkText));
  if (siteName && siteName !== linkText) parts.push(escapeText(siteName));
  const d = excerptDate(date);
  if (d) parts.push(escapeText(d));
  const head = parts.length ? `<p>${parts.join(' · ')}</p>` : '';
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeText(excerptTitle({ text, pageTitle }))
    + '</title></head><body><article>\n' + head + '<blockquote>' + quote + '</blockquote></article></body></html>';
}

/**
 * The note for text without a URL (F11): the text (line breaks as \n, trimmed; cut to 50,000 characters, then a blank
 * line and "(Excerpt trimmed to 50,000 characters.)"), a blank line, then "— shared from {app} on {date}" ("— shared
 * on {date}" without an app, "— shared from {app}" without a date, nothing without either), and a final newline.
 */
export function excerptMarkdown({ text = '', app = '', date = null } = {}) {
  const E = LAB_TEXT.excerpt;
  const cps = codePoints(String(text ?? '').replace(/\r\n?/g, '\n').trim());
  const body = cps.length > EXCERPT_MAX_CHARS ? `${cps.slice(0, EXCERPT_MAX_CHARS).join('')}\n\n${E.trimmed}` : cps.join('');
  const a = cleanName(app), d = excerptDate(date);
  const footer = a && d ? fill(E.sharedFromOn, { app: a, date: d }) : d ? fill(E.sharedOn, { date: d }) : a ? fill(E.sharedFrom, { app: a }) : '';
  return footer ? `${body}\n\n${footer}\n` : `${body}\n`;
}

/**
 * The item for a selection (F11), ready for Sender.send: with a source URL, an HTML document (`url` = the source URL
 * with a text fragment, kept as it is when it already has one; name excerptFileName; title excerptTitle); without
 * one, a Markdown note ("Note - ….md", title "“{first line}”"). Both carry x-cap "excerpt". null when the text is
 * empty. date: 'YYYY-MM-DD', or ms in local time; app: where a note came from ("Notes"), when known.
 */
export function excerptItem({ text = '', html = '', url = '', pageTitle = '', site = '', app = '', date = null } = {}) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const src = url ? webUrl(url) : null;
  if (src) {
    return {
      kind: 'file', mime: 'text/html', name: excerptFileName(t), url: hasTextFragment(src) ? src : textFragment(src, t),
      title: excerptTitle({ text: t, pageTitle }), content: excerptHtml({ text: t, html, url: src, pageTitle, site, date }),
      extras: { 'x-cap': 'excerpt' },
    };
  }
  return {
    kind: 'file', mime: 'text/markdown', name: excerptFileName(t, { note: true }), title: excerptTitle({ text: t }),
    content: excerptMarkdown({ text: t, app, date }), extras: { 'x-cap': 'excerpt' },
  };
}

// ---- The Inbox's row lines (F03, F11) and item details (2.3)

/**
 * The line under an Inbox row's title (F03): "Page as you saw it" (page, x-cap seen or none), "Clean article",
 * "Excerpt", "Test article", "Link (the Reader downloads it)" (url) or "Document · {MB} MB" (file), then
 * " · from {from}". extras: the item's checked extras; an unknown x-cap counts as none.
 */
export function inboxKindLine({ kind, extras = {}, size = 0, from = '' } = {}) {
  const K = LAB_TEXT.kindLine;
  const cap = X_CAP_VALUES.includes(extras?.['x-cap']) ? extras['x-cap'] : null;
  let line;
  if (cap === 'excerpt') line = K.excerpt;
  else if (cap === 'test') line = K.test;
  else if (kind === 'url') line = K.link;
  else if (kind === 'page') line = cap === 'clean' ? K.clean : K.seen;
  else line = fill(K.document, { mb: formatMB(size) });
  const f = cleanName(from);
  return f ? line + fill(K.from, { from: f }) : line;
}

/** "Cleaned from {host}" for an item's x-orig (2.3; the host and port, as text), or null without a valid one. */
export function cleanedFromText(orig) {
  const u = webUrl(orig);
  return u ? fill(LAB_TEXT.cleanedFrom, { host: urlParts(u).hostport.toLowerCase() }) : null;
}

// ---- Setup check (F26): the test article, the activity log and diagnostics

/**
 * The test article (F26): a page of about 400 words (LAB_TEXT.testArticle), so the Reader neither fetches it again nor
 * keeps only a link. -> {id, kind: 'page', url: 'https://daylight.invalid/test/<id>', title: 'Test article from
 * {device}', content, extras: {'x-cap': 'test'}}, ready for Sender.send.
 */
export function testArticle({ id = newItemId(), device = '' } = {}) {
  if (!ID_RE.test(String(id))) throw new ShareError('id', 'bad item id');
  const T = LAB_TEXT.testArticle;
  const title = cleanTitle(fill(T.title, { device: cleanName(device) || LAB_TEXT.appName.web }));
  const paras = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((k) => `<p>${escapeText(T[k])}</p>`).join('');
  const content = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(title)}</title>`
    + `<meta name="dl:capture" content="test"></head><body><article><h1>${escapeText(T.heading)}</h1>${paras}</article></body></html>`;
  return { id, kind: 'page', url: TEST_URL_PREFIX + id, title, content, extras: { 'x-cap': 'test' } };
}

/**
 * Removes what diagnostics must never carry (F26), in this order: daylightserver://… links and SERVER- codes ->
 * "[server code]"; anything that looks like a URL (scheme://…, or www.…) -> "[url]"; "dls-" + 32 hex -> "[topic]";
 * 28-character base32 codes, with or without dashes between groups of 4 -> "[code]".
 */
export function redactDiagnostics(text) {
  return String(text ?? '')
    .replace(/daylightserver:\/\/[^\s"'<>]*/gi, '[server code]')
    .replace(/\bSERVER-[A-Za-z0-9-]+/g, '[server code]')
    .replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]*/g, '[url]')
    .replace(/\bwww\.[^\s"'<>]+/gi, '[url]')
    .replace(/\bdls-[0-9a-f]{32}\b/gi, '[topic]')
    .replace(/\b[A-Z2-7]{4}(?:-?[A-Z2-7]{4}){6}\b/gi, '[code]');
}

/** An activity log entry (F26): {time (ms), type, id8, kind, status, http}. Titles, names, URLs and from never go in. */
export function activityEvent({ time = Date.now(), type = '', id = '', kind = '', status = '', http = 0 } = {}) {
  return { time, type: String(type), id8: String(id ?? '').slice(0, 8), kind: String(kind ?? ''), status: String(status ?? ''), http: Number(http) || 0 };
}

/** Appends an event to a log, keeping the last ACTIVITY_MAX (200). -> the new list. */
export function appendActivity(log, event) {
  return [...(Array.isArray(log) ? log : []), activityEvent(event)].slice(-ACTIVITY_MAX);
}

/** One log line: "{ISO time} {type} {id8} {kind} {status} {http}", '-' for an empty field. */
export function activityLine(e) {
  const t = Number.isFinite(e?.time) ? new Date(e.time).toISOString() : '-';
  return [t, e?.type, e?.id8, e?.kind, e?.status, e?.http].map((v) => (v === undefined || v === null || v === '' || v === 0 ? '-' : String(v))).join(' ');
}

const ROW_STATUSES = ['sending', 'sent', 'delivered', 'failed', 'expired'];

/**
 * "Copy diagnostics" (F26): the app and version, platform, Lab on or off, the caps seen, the last check-in, the
 * outbox's counts by status, the relay as "ntfy.sh" or "custom relay", and the last 50 events, all through
 * redactDiagnostics. rows: the outbox rows (only their status is read); log: activity events; checkedIn: ms or null.
 */
export function diagnosticsReport({ app = '', version = '', platform = '', lab = true, caps = [], checkedIn = null, rows = [], relay = '', log = [], now = Date.now() } = {}) {
  const D = LAB_TEXT.diagnostics;
  let ntfy = false;
  try { ntfy = normalizeRelay(relay) === DEFAULT_RELAY; } catch { ntfy = false; }
  const counts = ROW_STATUSES.map((st) => `${st} ${(rows ?? []).filter((r) => r?.status === st).length}`).join(' · ');
  const check = Number.isFinite(checkedIn) ? `${new Date(checkedIn).toISOString()} (${relativeTime(checkedIn, now)})` : D.never;
  const events = (Array.isArray(log) ? log : []).slice(-DIAGNOSTICS_EVENTS).map(activityLine);
  const lines = [
    D.heading,
    fill(D.app, { app, version, platform }),
    fill(D.lab, { state: lab ? D.on : D.off }),
    fill(D.caps, { caps: caps?.length ? caps.join(', ') : D.noCaps }),
    fill(D.checkedIn, { time: check }),
    fill(D.outbox, { counts }),
    fill(D.relay, { relay: ntfy ? D.relayNtfy : D.relayCustom }),
    D.events,
    ...(events.length ? events : [D.noEvents]),
  ];
  return redactDiagnostics(lines.join('\n') + '\n');
}
