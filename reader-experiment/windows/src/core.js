// The app's logic, with no DOM and no Tauri: pairing, sending, the outbox and its timers. app.js draws the window
// around it and wires it to Tauri (bridge.js); the unit tests drive it with a fake bridge and the mock relay.

import * as ds from './daylight-share.js';
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
/**
 * The largest file this app sends: the protocol's one limit for every relay (MAX_ITEM, 9 MB, protocol 1.1). Larger
 * files aren't even read (PROTOCOL 3.3: refuse at once, before reading).
 */
export const MAX_FILE = ds.MAX_ITEM;

/** The library's sentence for a file over MAX_FILE: "Too big to send. Files can be up to 9 MB; this one is … MB." */
export const tooBig = (size) => ds.tooBigMessage(size);

/** Runs async functions one at a time, in call order (the outbox is read-modify-write). */
export function serial() {
  let chain = Promise.resolve();
  return (fn) => {
    const p = chain.then(fn, fn);
    chain = p.then(() => {}, () => {});
    return p;
  };
}

/** A storage adapter that reports changes to the outbox, the pairing and the settings. */
export function watchedStorage(storage, onChange) {
  const watched = (k) => k === 'outbox' || k === 'pairing' || k === 'settings';
  return {
    get: (k) => storage.get(k),
    async set(k, v) { await storage.set(k, v); if (watched(k)) onChange(k); },
    async remove(k) { await storage.remove(k); if (watched(k)) onChange(k); },
  };
}

/**
 * bridge: {notify(title, body), showWindow(), readFile(path, max) -> Uint8Array (rejects "too-large:<size>" over max)}
 * storage: a daylight-share storage adapter (get/set/remove of JSON values).
 */
export function createApp({
  bridge, storage: baseStorage, fetch, now = () => Date.now(), version = '0', timers = globalThis, log = console,
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

  const notify = (n) => { try { Promise.resolve(bridge?.notify?.(n.title, n.body)).catch(() => {}); } catch { /* no notifications */ } };

  // --- pairing ------------------------------------------------------------------------------------------------------

  async function getPairing() {
    try { return await ds.loadPairing(storage); } catch { return null; }
  }

  async function getSender() {
    const pairing = await getPairing();
    if (!pairing) return null;
    const key = `${pairing.code}|${pairing.relay}`;
    if (cache?.key !== key) cache = { key, sender: new ds.Sender({ pairing, storage, from: FROM, app, fetch, now }) };
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
   * then go through the new relay; another secret deletes it (ds.applyPairingChange, under the sender lock).
   * expect: the code of the pairing in use when the user was asked ('' for none): if it changed since, nothing is
   * saved and this throws. -> {name, relay}
   */
  async function applyPairing(next, { expect } = {}) {
    const p = { ...next };
    await run(async () => {
      const current = await getPairing();
      if (expect !== undefined && (current?.code ?? '') !== expect) {
        throw new ds.ShareError('pairing', 'The pairing changed in the meantime. Open the pairing link again.');
      }
      // A typed code, or a link without a name, for the Daylight already paired keeps the name it has.
      if (!ds.cleanName(p.name) && current && ds.samePairingSecret(current, p)) p.name = current.name;
      await ds.applyPairingChange(storage, current, p);
      await ds.savePairing(storage, p);
      cache = null;
    });
    const queued = waiting.splice(0);
    if (queued.length) {
      (async () => { for (const a of queued) await handleAction(a); })().catch((e) => log.warn?.('Send to Daylight:', e));
    }
    return { name: ds.cleanName(p.name), relay: ds.normalizeRelay(p.relay) };
  }

  /** Pairs without asking (a typed code on the pairing screen when nothing is paired, and the e2e test's --e2e-pair). */
  async function pair(input, { relay } = {}) {
    const { next, current } = await preparePairing(input, { source: 'app', relay });
    return applyPairing(next, { expect: current?.code ?? '' });
  }

  async function unpair() {
    await run(async () => {
      await ds.applyPairingChange(storage, await getPairing(), null);
      await storage.remove('pairing');
      cache = null;
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
  async function setSettings(patch) {
    const s = { ...(await getSettings()), ...patch };
    await storage.set('settings', s);
    return s;
  }

  // --- sending ------------------------------------------------------------------------------------------------------

  async function sendItem(item) {
    const row = await withSender((s) => requireSender(s).send(item));
    afterSend();
    return row;
  }

  /** -> the outbox row. Throws ShareError for something that can't be sent. */
  async function sendLink(url, title = '') {
    const u = ds.webUrl(url);
    if (!u) throw new ds.ShareError('url', 'Only web addresses (http and https) can be sent.');
    const t = ds.cleanTitle(title);
    return sendItem({ kind: 'url', url: u, title: t && t !== u ? t : '' });
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

  /** The clipboard's text (hotkey, tray menu): sends the first web address in it. -> [{row} | {name, error}] */
  async function sendClipboard({ text = '', error = '' } = {}) {
    const url = ds.findUrl(text);
    if (!url) {
      const why = error ? `Couldn’t read the clipboard (${error}).` : 'Copy a web address (http or https), then try again.';
      return [{ name: 'clipboard', error: why, code: 'no-link' }];
    }
    return [await settle(hostOf(url) || url, () => sendLink(url))];
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
    else if (results.length) notify(sendSummary(results));
    return results;
  }

  /** "Retry now" (a failed row) and "Try again" (an expired one), as the library allows. -> the row */
  async function retry(id) {
    const row = await withSender((s) => requireSender(s).retry(id));
    afterSend();
    return row;
  }

  /** "Remove": the row and its stored content. -> true when there was such a row */
  async function remove(id) {
    return withSender((s) => (s ? s.remove(id) : false));
  }

  // --- acks and re-sends ----------------------------------------------------------------------------------------------

  /**
   * Acks and re-sends (PROTOCOL 3.3, logic.maintain): the local re-send pass always runs (it ends week-old rows and
   * drops expired rows' content after 14 days); the ack topic is read only while a row could still be acked.
   */
  async function tick() {
    lastTick = now();
    return withSender(async (s) => {
      if (!s) return { delivered: 0, resent: 0 };
      try { return await maintain(s, now()); } catch (e) { log.warn?.('Send to Daylight: tick failed', e); return { delivered: 0, resent: 0 }; }
    });
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
  }

  function stop() {
    timers.clearInterval(interval);
    timers.clearTimeout(soonTimer);
    interval = soonTimer = null;
  }

  /** The state as the end-to-end test reads it (the window draws the same). */
  async function snapshot() {
    return {
      at: new Date(now()).toISOString(),
      ...(await state()),
      waiting: waiting.length,
      rows: (await rows()).map((r) => {
        const v = rowView(r, now());
        return {
          id: r.id, kind: r.kind, title: r.title, name: r.name, url: r.url, mime: r.mime, size: r.size,
          status: r.status, errorCode: r.errorCode ?? '', error: r.error, attempts: r.attempts,
          label: v.label, sentence: v.sentence, action: v.action,
        };
      }),
    };
  }

  return {
    storage, preparePairing, applyPairing, pair, unpair, state, rows, getSettings, setSettings, sendLink, sendFile, sendPaths,
    sendClipboard, handleAction, retry, remove, tick, tickIfStale, start, stop, snapshot, settle,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
