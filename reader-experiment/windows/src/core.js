// The app's logic, with no DOM and no Tauri: pairing, sending, the outbox and its timers, and Lab (lab.js). app.js
// draws the window around it and wires it to Tauri (bridge.js); the unit tests drive it with a fake bridge and the
// mock relay.

import * as ds from './daylight-share.js';
import { LAB_TEXT, normaliseShare, labUseOn, fillText, needsMessage, FAST_CHECK_MS } from './daylight-lab.js';
import {
  createLab, isLabOn, labRowText, wantsStates, wantsFaster, parseSendLink, APP_NAME, PLATFORM, QUICK_SENDS_PER_MINUTE,
} from './lab.js';
import {
  fileNameFor, mimeFor, titleFromName, nameFromPath, isInternetShortcut, urlFromInternetShortcut, maintain,
  sendSummary, hostOf, rowView,
} from './logic.js';

/** How items show as sent on the Daylight. */
export const FROM = 'Windows PC';
/** PROTOCOL 3.3: look for acks right after a send and again about 30 s later... */
export const SOON_MS = 30 * 1000;
/** ...and every 15 minutes while the app runs (acks, and re-sends of anything not acknowledged yet). */
export const TICK_MS = 15 * 60 * 1000;
/** Opening the window checks for acks, at most this often. */
export const SHOW_TICK_MS = 10 * 1000;
/** F07: passes of the offline queue (flushNetwork) at least this far apart (LAB-PLAN 2.7.1). */
export const FLUSH_GAP_MS = 3 * 60 * 1000;
/**
 * The largest file this app sends: the protocol's one limit for every relay (MAX_ITEM, 9 MB, protocol 1.1). Larger
 * files aren't even read (PROTOCOL 3.3: refuse at once, before reading).
 */
export const MAX_FILE = ds.MAX_ITEM;

/** The library's sentence for a file over MAX_FILE: "Too big to send. Files can be up to 9 MB; this one is … MB." */
export const tooBig = (size) => ds.tooBigMessage(size);

/** A row waiting for a connection (F07): failed with error code network, whatever made it fail. */
export const isWaitingRow = (row) => row?.status === 'failed' && row?.errorCode === 'network';

/**
 * daylight-share's Sender with F07's one rule (LAB-PLAN 2.7.1, F07 "Common"): while `holdNetwork` is true (Lab on), a
 * row waiting for a connection is never due in a re-send pass. That pass (resendDue, in every tick) has no caps, so
 * once the rows' v1.1 back-off has run out it would send all of them at once and empty the request bucket the
 * household shares with the Daylight. Such rows leave only through flushOffline's passes (flushNetwork: at most 30
 * frames and 18 MB, passes at least 3 minutes apart). With Lab off, v1.1's back-off re-sends them (LAB-PLAN 1.3). The
 * library's re-send pass asks _due about every row; the unit tests pin that (lab-w1.test.mjs, F07.3 with ntfy.sh's
 * limits).
 */
export class AppSender extends ds.Sender {
  constructor(opts) { super(opts); this.holdNetwork = false; }
  _due(row, now) { return this.holdNetwork && isWaitingRow(row) ? false : super._due(row, now); }
  /** Whether v1.1's back-off says the row is due for a re-send, holdNetwork or not. */
  dueByBackoff(row, now) { return super._due(row, now); }
}

/**
 * Whether a capped pass is due (F07, Lab on): the oldest row waiting for a connection, the one flushNetwork tries first,
 * is due by v1.1's back-off. The back-off of the pass's head keeps a pass from repeating every 3 minutes while the
 * network stays down; a pass that got through sets its own next pass (flushOffline).
 */
export function flushDue(sender, rows, now) {
  const head = (rows ?? []).filter((r) => isWaitingRow(r) && now - r.created <= ds.OUTBOX_EXPIRY_MS)
    .sort((a, b) => a.created - b.created)[0];
  return !!head && sender.dueByBackoff(head, now);
}

/** Runs async functions one at a time, in call order (the outbox is read-modify-write). */
export function serial() {
  let chain = Promise.resolve();
  return (fn) => {
    const p = chain.then(fn, fn);
    chain = p.then(() => {}, () => {});
    return p;
  };
}

/**
 * A storage adapter that reports changes to the outbox, the pairing and the settings, and to what Lab's ledger heard
 * from the Daylight (What's in Lab's header line and the timeline's rows follow it) and Setup check's activity log.
 */
export const WATCHED_KEYS = ['outbox', 'pairing', 'settings', 'lab/inbox', 'lab/heard', 'lab/states', 'lab/activity'];
export function watchedStorage(storage, onChange) {
  const watched = (k) => WATCHED_KEYS.includes(k);
  return {
    get: (k) => storage.get(k),
    async set(k, v) { await storage.set(k, v); if (watched(k)) onChange(k); },
    async remove(k) { await storage.remove(k); if (watched(k)) onChange(k); },
  };
}

/**
 * bridge: {notify(title, body), showWindow(), readFile(path, max) -> Uint8Array (rejects "too-large:<size>" over max)}
 * storage: a daylight-share storage adapter (get/set/remove of JSON values).
 * gateDeadlineMs: Lab's gate deadline (LAB-PLAN 1.5: 5 s; tests shorten it).
 * online(): false while Windows says this PC is offline (navigator.onLine; F07); onReader(row): a row the ledger says
 * is in the Reader now (F01's toast, which the window shows only while it is hidden).
 */
export function createApp({
  bridge, storage: baseStorage, fetch, now = () => Date.now(), version = '0', timers = globalThis, log = console,
  gateDeadlineMs, online = () => true, onReader = null,
} = {}) {
  const listeners = new Set();
  const storage = watchedStorage(baseStorage, (key) => {
    for (const fn of listeners) { try { fn(key); } catch (e) { log.warn?.('Send to Daylight: listener failed', e); } }
  });
  const run = serial();
  const app = `windows/${version}`;
  let cache = null;
  let soonTimer = null;
  let interval = null;
  let lastTick = 0;
  /** Things to send that arrived before the app was paired: sent once it is. */
  const waiting = [];
  const settingsRun = serial();
  let visible = false; // the window shows (F01's faster checks)
  let fastTimer = null;
  let flushTimer = null;
  let lastFlush = -Infinity;
  const flushRun = serial(); // F07: one pass decision at a time (a tick's and the online event's)
  const quickSends = []; // F09: times of the last quick sends (QUICK_SENDS_PER_MINUTE)
  const toldReader = new Set(); // F01: rows onReader was told about, so two ticks that overlap tell it once

  /**
   * Lab (LAB-PLAN 1, 2.2.6, 2.6): the switch, the sender ledger (fed by every Sender below through onAckHeader, Lab on
   * or off), the gates and the Daylight server.
   */
  const lab = createLab({
    storage, fetch, now, log, getPairing, getSettings, updateSettings, from: FROM, app,
    refreshAcks: () => checkAcksNow(), gateDeadlineMs,
  });

  const notify = (n) => { try { Promise.resolve(bridge?.notify?.(n.title, n.body)).catch(() => {}); } catch { /* no notifications */ } };

  // --- pairing ------------------------------------------------------------------------------------------------------

  async function getPairing() {
    try { return await ds.loadPairing(storage); } catch { return null; }
  }

  async function getSender() {
    const pairing = await getPairing();
    if (!pairing) return null;
    const key = `${pairing.code}|${pairing.relay}`;
    if (cache?.key !== key) cache = { key, sender: new AppSender({ pairing, storage, from: FROM, app, fetch, now, onAckHeader: lab.hook }) };
    return cache.sender;
  }

  function requireSender(s) {
    if (!s) throw new ds.ShareError('pairing', 'Pair with your Daylight first.');
    return s;
  }

  /**
   * Runs fn(sender) under the app's outbox lock, with the Sender of the pairing in use when fn runs (null when
   * unpaired). A send, retry, removal or tick queued behind a pairing change therefore uses the new pairing: a row is
   * only ever published with the keys and relay of the outbox it sits in (CHANGES-v1.1 note a; PROTOCOL 3.3 step 6).
   */
  const withSender = (fn) => run(async () => fn(await getSender()));

  /**
   * A pairing that arrives, and what the protocol says to do with it (PROTOCOL 1.3 "Confirmation", 3.3 step 6), in
   * the module's own words: input is a daylightshare:// link or a code; relay, the Advanced override for a typed code.
   * source: 'link' (from outside the app: a clicked link, a launch argument) or 'app' (typed or pasted on the pairing
   * screen). -> {next, current, confirm: {ask, title, lines, button, notice}}; nothing is saved yet. When confirm.ask,
   * show title and lines with the buttons `button` and Cancel, and call applyPairing(next) only on `button`; otherwise
   * call it at once and show `notice` when there is one. Throws ShareError for a bad link, code or relay.
   */
  async function preparePairing(input, { source = 'link', relay } = {}) {
    const next = await ds.parsePairing(input);
    if (relay != null && String(relay).trim()) next.relay = ds.normalizeRelay(relay);
    const current = await getPairing();
    return { next, current, confirm: ds.pairingConfirmation(current, next, { source }) };
  }

  /**
   * Saves a pairing from preparePairing. The same secret (a new relay or name) keeps the outbox, whose pending items
   * then go through the new relay; another secret deletes it (ds.applyPairingChange, under the sender lock), with Lab's
   * ledger; a Daylight server that knows the old pairing is locked first, Lab on or off (LAB-PLAN 2.6).
   * expect: the code of the pairing in use when the user was asked ('' for none): if it changed since, nothing is
   * saved and this throws. -> {name, relay, serverLocked?: true when a known server was locked (or tried)}
   */
  async function applyPairing(next, { expect } = {}) {
    const p = { ...next };
    let repair = {};
    await run(async () => {
      const current = await getPairing();
      if (expect !== undefined && (current?.code ?? '') !== expect) {
        throw new ds.ShareError('pairing', 'The pairing changed in the meantime. Open the pairing link again.');
      }
      // A typed code, or a link without a name, for the Daylight already paired keeps the name it has.
      if (!ds.cleanName(p.name) && current && ds.samePairingSecret(current, p)) p.name = current.name;
      repair = await lab.beforeRepair(current, p);
      await ds.applyPairingChange(storage, current, p);
      await ds.savePairing(storage, p);
      cache = null;
      await lab.afterPairingChange(current, p, repair);
    });
    const queued = waiting.splice(0);
    if (queued.length) {
      (async () => { for (const a of queued) await handleAction(a); })().catch((e) => log.warn?.('Send to Daylight:', e));
    }
    const out = { name: ds.cleanName(p.name), relay: ds.normalizeRelay(p.relay) };
    if (repair.known) out.serverLocked = true;
    return out;
  }

  /** Pairs without asking (a typed code on the pairing screen when nothing is paired, and the e2e test's --e2e-pair). */
  async function pair(input, { relay } = {}) {
    const { next, current } = await preparePairing(input, { source: 'app', relay });
    return applyPairing(next, { expect: current?.code ?? '' });
  }

  async function unpair() {
    await run(async () => {
      const current = await getPairing();
      await lab.beforeUnpair(current); // a typed Server address goes with the pairing (LAB-PLAN 2.6)
      await ds.applyPairingChange(storage, current, null);
      await storage.remove('pairing');
      cache = null;
      await lab.afterPairingChange(current, null);
    });
  }

  async function state() {
    const p = await getPairing();
    return {
      paired: !!p, name: p?.name ?? '', relay: p?.relay ?? '', defaultRelay: !p || p.relay === ds.DEFAULT_RELAY,
      codeStart: p?.code?.slice(0, 4) ?? '',
    };
  }

  const rows = async () => (await storage.get('outbox')) ?? [];

  async function getSettings() { return (await storage.get('settings')) ?? {}; }
  /**
   * Changes the settings (the hotkey, Comfort, Lab), one change at a time so none is lost: fn(settings) -> the new
   * settings, or the same object to write nothing. -> the settings
   */
  function updateSettings(fn) {
    return settingsRun(async () => {
      const cur = await getSettings();
      const s = fn(cur);
      if (s !== cur) await storage.set('settings', s);
      return s;
    });
  }
  /** Merges patch into the settings. -> the settings */
  function setSettings(patch) { return updateSettings((s) => ({ ...s, ...patch })); }

  // --- sending ------------------------------------------------------------------------------------------------------

  /** The activity log's status for a row (F26): its status, and why it waits or failed. */
  const statusOf = (row) => (row?.errorCode ? `${row.status}/${row.errorCode}` : row?.status ?? '');

  /**
   * Sends one item: the item, or an async function that makes it (run under the outbox lock, so a send keeps its place
   * in call order behind or before a pairing change, CHANGES-v1.1 note a). With Lab on and Windows offline (F07),
   * nothing is published: the row is kept as waiting for a connection (Sender.send with defer), and goes when the PC
   * is back online (flushOffline). -> the outbox row
   */
  async function sendItem(item) {
    let defer = false;
    const row = await withSender(async (s) => {
      const it = typeof item === 'function' ? await item() : item;
      const sender = requireSender(s);
      defer = online() === false && isLabOn(await getSettings());
      return sender.send(it, defer ? { defer: true } : undefined);
    });
    lab.logEvent({ type: defer ? 'queue' : 'send', id: row.id, kind: row.kind, status: statusOf(row) });
    if (!defer) afterSend();
    return row;
  }

  const NOT_WEB = 'Only web addresses (http and https) can be sent.';

  /**
   * A link as it arrived (a typed or dropped address with its title, a dropped or copied text, a .url file, a send
   * link) -> {url, title, orig}: what is sent. With Lab on, smart intake (F16): normaliseShare finds the URL in the text,
   * unwraps redirectors and removes tracking (unless Clean links' Use switch is off), takes a headline as the title, and
   * keeps the address as shared in `orig` (x-orig) when it changed. Lab off: the address as given (or the text's first
   * one), exactly as v1.1. Throws ShareError('url') when there is no web address.
   */
  async function intake({ url = '', text = '', title = '' } = {}) {
    const s = await getSettings();
    if (!isLabOn(s)) {
      const u = url ? ds.webUrl(url) : ds.findUrl(text);
      if (!u) throw new ds.ShareError('url', NOT_WEB);
      const t = ds.cleanTitle(title);
      return { url: u, title: t && t !== u ? t : '', orig: null };
    }
    const n = normaliseShare({ text, url, subject: title, clean: labUseOn(s, 'F16') });
    if (n.kind !== 'link' || !n.url) throw new ds.ShareError('url', NOT_WEB);
    const t = n.title ?? '';
    return { url: n.url, title: t && t !== n.url ? t : '', orig: n.orig ?? null };
  }

  /** The item for what intake() made: x-orig (2.3) goes along only with Lab on, the only time intake sets it. */
  const linkItem = (p) => ({ kind: 'url', url: p.url, title: p.title, ...(p.orig ? { extras: { 'x-orig': p.orig } } : {}) });

  /** Sends what intake() made. -> the outbox row */
  function sendIntake(p) { return sendItem(linkItem(p)); }

  /** -> the outbox row. Throws ShareError for something that can't be sent. text: a dropped text (Lab's intake). */
  function sendLink(url, title = '', { text = '' } = {}) {
    return sendItem(async () => linkItem(await intake({ url, text, title })));
  }

  /** {name, bytes, mime?} -> the outbox row. An Internet Shortcut (.url) sends its address instead. */
  async function sendFile({ name, bytes, mime = '' }) {
    if (isInternetShortcut(name)) {
      const url = urlFromInternetShortcut(new TextDecoder().decode(bytes));
      if (url) return sendLink(url, titleFromName(name));
    }
    const fileName = fileNameFor(name);
    return sendItem({ kind: 'file', name: fileName, mime: mimeFor(fileName, mime), title: titleFromName(fileName), content: bytes });
  }

  /** Runs one send; never throws. -> {row} | {name, error} */
  async function settle(name, fn) {
    try {
      return { row: await fn() };
    } catch (e) {
      return { name, error: e?.message ?? String(e), code: e?.code ?? '' };
    }
  }

  /** Files by path (Send To, or a launch with file arguments). -> [{row} | {name, error}] */
  async function sendPaths(paths) {
    const results = [];
    for (const p of paths) {
      const name = nameFromPath(p) || 'document';
      results.push(await settle(name, async () => {
        let bytes;
        try {
          bytes = await bridge.readFile(p, MAX_FILE);
        } catch (e) {
          const big = /^too-large:(\d+)$/.exec(String(e?.message ?? e));
          if (big) throw new ds.ShareError('too-large', tooBig(Number(big[1])));
          throw e;
        }
        return sendFile({ name, bytes });
      }));
    }
    return results;
  }

  /**
   * The clipboard's link (F33 with Lab on): what the clipboard command would send, without sending it, so the window's
   * button can show the host first. -> {link: {url, title, orig}, host} | {error, code: 'no-link'}
   */
  async function prepareClipboard({ text = '', error = '' } = {}) {
    try {
      const link = await intake({ text });
      return { link, host: hostOf(link.url) || link.url };
    } catch {
      const why = error ? `Couldn’t read the clipboard (${error}).` : 'Copy a web address (http or https), then try again.';
      return { error: why, code: 'no-link' };
    }
  }

  /** The clipboard's text (hotkey, tray menu): sends the first web address in it. -> [{row} | {name, error}] */
  async function sendClipboard(clip = {}) {
    const p = await prepareClipboard(clip);
    if (p.error) return [{ name: 'clipboard', error: p.error, code: 'no-link' }];
    return [await settle(p.host, () => sendIntake(p.link))];
  }

  /** "Send to {name}" (F08, F09): the pairing's name, else "your Daylight". */
  async function daylightName() {
    return ds.cleanName((await getPairing())?.name) || LAB_TEXT.shareInPlace.yourDaylight;
  }

  /** The timeline's words for rows, while Lab is on (2.5), or null: rowMessage's `describe`. */
  async function describer() {
    const tl = await lab.timeline();
    const on = online() !== false;
    return tl.lab ? (row, n) => labRowText(row, tl, { online: on, now: n }) : null;
  }

  /**
   * The words after a share, in a notification or the window's status line: v1.1's (sendSummary), and with Lab on the
   * timeline's (Waiting for connection, F07) and, for a notification, "Sent to {name}" (F08); the clipboard's items are
   * named by their host there (F33). -> sendSummary's {title, body, bad}
   */
  async function summary(results, { notification = false, clipboard = false } = {}) {
    if (!isLabOn(await getSettings())) return sendSummary(results);
    return sendSummary(results, {
      describe: await describer(),
      sentTo: notification ? fillText(LAB_TEXT.sentTo, { name: await daylightName() }) : null,
      name: clipboard ? (r) => hostOf(r.row?.url) : null,
    });
  }

  /**
   * An action from outside the window (Rust's queue): {type: 'files', paths} or {type: 'clipboard', text, error}.
   * Shows a notification with the outcome. Before pairing, keeps it for later and opens the window.
   * -> results, or null when it waits for pairing.
   */
  async function handleAction(a) {
    if (a?.type !== 'files' && a?.type !== 'clipboard') return null;
    if (!(await getPairing())) {
      waiting.push(a);
      notify({ title: 'Pair with your Daylight first', body: 'Send to Daylight sends it as soon as it is paired.' });
      try { await bridge?.showWindow?.(); } catch { /* ignore */ }
      return null;
    }
    const results = a.type === 'files' ? await sendPaths(a.paths ?? []) : await sendClipboard(a);
    if (results.length === 1 && results[0].code === 'no-link') notify({ title: 'No link to send', body: results[0].error });
    else if (results.length) notify(await summary(results, { notification: true, clipboard: a.type === 'clipboard' }));
    return results;
  }

  // --- F09: daylightshare://send links ----------------------------------------------------------------------------------

  /**
   * A send link (F09): daylightshare://send?url=…&title=…[&text=…][&quick=1]. Nothing is sent here.
   * -> {error, state}: Lab off ("Turn on Lab in Send to Daylight to use this."), not paired (needs-pairing), or no web
   *    address in it (LAB_TEXT.automation.notWebAddress);
   *    {ask: true, link, title: "Send to {name}?", lines: [the title, the host]}: show the question, Send and Cancel;
   *    {ask: false, link}: a quick send (quick=1, "Allow quick sends from other apps" on, at most 10 a minute).
   */
  async function prepareSendLink(raw) {
    const A = LAB_TEXT.automation;
    const parsed = parseSendLink(raw);
    const s = await getSettings();
    if (!isLabOn(s)) return { error: fillText(LAB_TEXT.labOff, { app: APP_NAME }), state: 'lab-off' };
    if (!(await getPairing())) return { error: needsMessage('needs-pairing', { platform: PLATFORM }), state: 'needs-pairing' };
    let link;
    try {
      if (!parsed) throw new Error('not a send link');
      link = await intake({ url: parsed.url, text: parsed.text, title: parsed.title });
    } catch { return { error: A.notWebAddress, state: 'not-web' }; }
    const t = now();
    while (quickSends.length && t - quickSends[0] > 60000) quickSends.shift();
    if (parsed.quick && s.labQuickSends === true && quickSends.length < QUICK_SENDS_PER_MINUTE) {
      quickSends.push(t);
      return { ask: false, link };
    }
    const host = hostOf(link.url) || link.url;
    return { ask: true, link, title: fillText(A.confirmTitle, { name: await daylightName() }), lines: [link.title, host].filter(Boolean) };
  }

  /** The notification after sends that came from outside the window (a quick send, F09): summary's words. */
  async function notifyResults(results, opts = {}) {
    if (results?.length) notify(await summary(results, { notification: true, ...opts }));
  }

  /** Sends a link prepareSendLink or prepareClipboard made (after Send, or a quick send). -> [{row} | {name, error}] */
  async function sendPrepared(link) {
    return [await settle(hostOf(link.url) || link.url, () => sendIntake(link))];
  }

  /** "Retry now" (a failed row) and "Try again" (an expired one), as the library allows. -> the row */
  async function retry(id) {
    const row = await withSender((s) => requireSender(s).retry(id));
    if (row) lab.logEvent({ type: 'retry', id: row.id, kind: row.kind, status: statusOf(row) });
    afterSend();
    return row;
  }

  /** "Remove" (Cancel in Lab's queue, F07): the row and its stored content. -> true when there was such a row */
  async function remove(id) {
    const gone = await withSender((s) => (s ? s.remove(id) : false));
    if (gone) lab.logEvent({ type: 'remove', id });
    return gone;
  }

  // --- acks and re-sends ----------------------------------------------------------------------------------------------

  /**
   * Acks and re-sends (PROTOCOL 3.3, logic.maintain): the local re-send pass always runs (it ends week-old rows and
   * drops expired rows' content after 14 days); the ack topic is read only while a row could still be acked. With Lab
   * on (F07), rows waiting for a connection are left out of that pass (AppSender): when the oldest of them is due by
   * v1.1's back-off, the tick runs flushOffline's capped pass instead, which waits for the rest of the 3 minutes when
   * the last pass was sooner. This covers the tick right after a pass, the 15-minute tick and the one at start (rows
   * queued in an earlier run), and rows that failed for want of a network while Windows said it was online.
   */
  async function tick() {
    lastTick = now();
    const before = await rowStates();
    let flush = false;
    const r = await withSender(async (s) => {
      if (!s) return { delivered: 0, resent: 0 };
      try {
        const labOn = isLabOn(await getSettings());
        s.holdNetwork = labOn;
        // With Lab on, the timeline (F01) reads the ack topic after delivery too, while a row waits for its state.
        const tl = await lab.timeline();
        const out = await maintain(s, now(), { readAcks: wantsStates(await s.list(), tl, now()) });
        flush = labOn && flushDue(s, await s.list(), now());
        return out;
      } catch (e) { log.warn?.('Send to Daylight: tick failed', e); return { delivered: 0, resent: 0 }; }
    });
    // Lab's ledger keeps the states of the rows still here (LAB-PLAN 2.2.6).
    await lab.prune();
    await afterAcks(before);
    scheduleFast();
    if (flush) await flushOffline().catch((e) => log.warn?.('Send to Daylight: flush failed', e));
    return r;
  }

  /**
   * Each row's status and what the timeline says of it, while Lab is on (null with Lab off): what afterAcks compares.
   * -> Map id -> {status, s, label}
   */
  async function rowStates() {
    try {
      const tl = await lab.timeline();
      if (!tl.lab) return null;
      const on = online() !== false;
      return new Map((await rows()).map((row) => [row.id, { status: row.status, s: tl.states?.[row.id]?.s ?? null, label: labRowText(row, tl, { online: on, now: now() }).label }]));
    } catch { return null; }
  }

  /**
   * After the ack topic was read, with Lab on: Setup check's activity log gets each row's new status and state (F26),
   * and a row that is now in the Reader is told to onReader (F01's toast). Never throws.
   */
  async function afterAcks(before) {
    if (!before) return;
    const after = await rowStates();
    if (!after) return;
    const reader = LAB_TEXT.rows.reader.label;
    for (const row of await rows()) {
      const b = before.get(row.id);
      const a = after.get(row.id);
      if (!b || !a) continue;
      if (a.status !== b.status) lab.logEvent({ type: 'status', id: row.id, kind: row.kind, status: statusOf(row) });
      if (a.s && a.s !== b.s) lab.logEvent({ type: 'state', id: row.id, kind: row.kind, status: a.s });
      if (a.label === reader && b.label !== reader && !toldReader.has(row.id)) {
        toldReader.add(row.id);
        try { onReader?.(row); } catch (e) { log.warn?.('Send to Daylight: onReader', e); }
      }
    }
  }

  /** Reads the ack topic now, whatever the outbox holds (What's in Lab opening: its header line is then current). */
  function checkAcksNow() {
    return withSender(async (s) => (s ? s.checkAcks() : 0));
  }

  /**
   * F01's faster checks (2.5): while the window shows and a delivered row of the last 10 minutes has no settled state,
   * a tick every 30 s instead of every 15 minutes (whether a hello has been heard yet or not: wantsFaster).
   */
  async function scheduleFast() {
    if (fastTimer || !visible) return;
    try {
      if (!wantsFaster(await rows(), await lab.timeline(), now())) return;
    } catch { return; }
    if (fastTimer || !visible) return;
    fastTimer = timers.setTimeout(() => { fastTimer = null; return visible ? tick().catch(() => {}) : undefined; }, FAST_CHECK_MS);
  }

  /** The window shows (true) or is hidden (false): the faster checks run only while it shows. */
  function setVisible(v) {
    visible = !!v;
    if (!visible) { timers.clearTimeout(fastTimer); fastTimer = null; } else scheduleFast();
  }

  /**
   * F07: back online. With Lab on, the rows that wait for a connection go now (Sender.flushNetwork: oldest first, at
   * most 30 frames and 18 MB of attachments a pass, nothing more after a 429, no attachments after a 413), passes at
   * least 3 minutes apart; another pass follows while the last one stopped at a cap and nothing failed, and otherwise
   * when a tick finds the oldest waiting row due by v1.1's back-off. These passes are the only way such rows leave while
   * Lab is on (AppSender). With Lab off, v1.1's back-off does it (LAB-PLAN 1.3). -> the rows attempted
   */
  function flushOffline() { return flushRun(flushOnce); }

  async function flushOnce() {
    if (online() === false || !isLabOn(await getSettings())) return [];
    const wait = lastFlush + FLUSH_GAP_MS - now();
    if (wait > 0) {
      // Too soon after the last pass: the next one comes at the end of the 3 minutes, if anything still waits then.
      if ((await rows()).some(isWaitingRow)) scheduleFlush(wait);
      return [];
    }
    lastFlush = now();
    const attempted = await withSender(async (s) => (s ? s.flushNetwork() : []));
    for (const r of attempted) lab.logEvent({ type: 'flush', id: r.id, kind: r.kind, status: statusOf(r) });
    if (attempted.length) afterSend();
    const left = (await rows()).some(isWaitingRow);
    if (left && attempted.length && attempted.every((r) => r.status !== 'failed' && r.status !== 'expired')) scheduleFlush(FLUSH_GAP_MS);
    return attempted;
  }

  function scheduleFlush(ms) {
    if (flushTimer) return;
    flushTimer = timers.setTimeout(() => { flushTimer = null; return flushOffline().catch(() => {}); }, ms);
  }

  /** Windows says the PC is back online (the window's `online` event). */
  function onOnline() { return flushOffline().catch((e) => { log.warn?.('Send to Daylight: flush failed', e); return []; }); }

  /** Setup check's test article (F26): sent as a page with x-cap "test"; the checklist follows its row. -> the row */
  async function sendTestArticle() {
    return sendItem(lab.testItem());
  }

  const tickQuietly = () => { tick().catch(() => {}); };

  /** After a send: look for acks now and again in about 30 s. */
  function afterSend() {
    tickQuietly();
    timers.clearTimeout(soonTimer);
    soonTimer = timers.setTimeout(() => { soonTimer = null; tickQuietly(); }, SOON_MS);
  }

  /** The window was opened: a fresh look at the acks, unless one was just taken. */
  function tickIfStale() {
    if (now() - lastTick >= SHOW_TICK_MS) tickQuietly();
  }

  function start() {
    tickQuietly();
    timers.clearInterval(interval);
    interval = timers.setInterval(tickQuietly, TICK_MS);
    // Items queued offline in an earlier run (F07) are due by now (their back-off is a minute): with Lab on, this first
    // tick sends them in a capped pass (flushOffline), and the rest 3 minutes later; with Lab off, as v1.1 does.
  }

  function stop() {
    timers.clearInterval(interval);
    timers.clearTimeout(soonTimer);
    timers.clearTimeout(fastTimer);
    timers.clearTimeout(flushTimer);
    interval = soonTimer = fastTimer = flushTimer = null;
  }

  /**
   * The state as the end-to-end test reads it (the window draws the same), with Lab's (LAB-PLAN 1.7): each row's v1.1
   * words (label, sentence, action) and, with Lab on, the timeline's (labRow: {label, sentence, action, stepLine,
   * final}, F01), and whether Windows says the PC is online (F07).
   */
  async function snapshot() {
    const tl = await lab.timeline();
    const on = online() !== false;
    return {
      at: new Date(now()).toISOString(),
      ...(await state()),
      ...(await lab.status()),
      online: on,
      waiting: waiting.length,
      rows: (await rows()).map((r) => {
        const v = rowView(r, now());
        return {
          id: r.id, kind: r.kind, title: r.title, name: r.name, url: r.url, mime: r.mime, size: r.size,
          status: r.status, errorCode: r.errorCode ?? '', error: r.error, attempts: r.attempts,
          label: v.label, sentence: v.sentence, action: v.action,
          labRow: tl.lab ? labRowText(r, tl, { online: on, now: now() }) : null,
        };
      }),
    };
  }

  return {
    storage, lab, preparePairing, applyPairing, pair, unpair, state, rows, getSettings, setSettings, updateSettings,
    sendLink, sendFile, sendPaths, sendClipboard, handleAction, retry, remove, tick, tickIfStale, checkAcksNow, start,
    stop, snapshot, settle, intake, prepareClipboard, prepareSendLink, sendPrepared, summary, daylightName, describer,
    flushOffline, onOnline, setVisible, sendTestArticle, notifyResults,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
