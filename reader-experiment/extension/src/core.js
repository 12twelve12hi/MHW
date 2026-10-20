// The extension's background logic. createApp() takes the browser API object (chrome or browser) instead of reading
// globals, so the unit tests drive it with a fake one; background.js wires it to the real events.

import * as ds from './daylight-share.js';
import { capturePage, pdfStart, pdfChunk, pdfEnd, linkText } from './inject.js';
import {
  PDF_MIME, PDF_CHUNK, MAX_PDF, NOTES, originPattern, pdfFileName, isPdfBytes, titleFromName,
  planForCapture, defaultDeviceName, isTrouble, maintain, relayForInput,
} from './logic.js';

export const MENU = { page: 'dls-page', link: 'dls-link', pdfLink: 'dls-pdf-link' };
export const ALARM_TICK = 'dls-tick';
export const ALARM_SOON = 'dls-soon';
export const COMMAND_SEND = 'send-page';
// Match patterns compare against path + query, so these catch ".../paper.pdf" and ".../paper.pdf?download=1".
export const PDF_LINK_PATTERNS = ['*://*/*.pdf', '*://*/*.PDF', '*://*/*.Pdf', '*://*/*.pdf?*', '*://*/*.PDF?*'];
const PENDING_PDF_MS = 5 * 60 * 1000;

/**
 * A chrome.storage area as a daylight-share storage adapter. Every failed write is reported: the library keeps sending
 * an item whose re-send copy ('outbox/<id>') can't be stored (it goes once), and must know when anything else fails.
 */
export function areaStorage(area) {
  return {
    async get(k) { const o = await area.get(k); return o?.[k]; },
    async set(k, v) { await area.set({ [k]: v }); },
    async remove(k) { await area.remove(k); },
  };
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
 * A response's body, read only up to max bytes (protocol 1.1: refuse a file over MAX_ITEM before reading it all).
 * -> {bytes} | {tooLarge, size}: size is the declared Content-Length, or, without one, the bytes read when it went
 * over max (a lower bound).
 */
export async function readCapped(res, max) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (declared > max) {
    try { await res.body?.cancel?.(); } catch { /* nothing to cancel */ }
    return { tooLarge: true, size: declared };
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length > max ? { tooLarge: true, size: bytes.length } : { bytes };
  }
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      reader.cancel().catch(() => {});
      return { tooLarge: true, size };
    }
    parts.push(value);
  }
  return { bytes: ds.concat(...parts) };
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), ms); })])
    .finally(() => clearTimeout(t));
}

function makeBadge(action) {
  let busy = 0;
  let timer = null;
  const set = async (text, color) => {
    try {
      await action?.setBadgeText?.({ text });
      if (color) {
        await action?.setBadgeBackgroundColor?.({ color });
        await action?.setBadgeTextColor?.({ color: '#ffffff' });
      }
    } catch { /* not supported here */ }
  };
  return {
    async start() { busy++; clearTimeout(timer); await set('…', '#222222'); },
    /** outcome: 'ok' | 'error' | 'idle' */
    async done(outcome) {
      busy = Math.max(0, busy - 1);
      if (busy) return;
      if (outcome === 'ok') { await set('✓', '#222222'); timer = setTimeout(() => set(''), 6000); }
      else if (outcome === 'error') await set('!', '#b3261e');
      else await set('');
    },
    async clear() { if (!busy) { clearTimeout(timer); await set(''); } },
  };
}

export function createApp({
  api, target = 'chrome', storage, fetch: fetchImpl, now = () => Date.now(), log = console, pdfChunkSize = PDF_CHUNK,
} = {}) {
  storage ??= areaStorage(api.storage.local);
  const fetchFn = fetchImpl ?? ((...a) => globalThis.fetch(...a));
  const run = serial();
  const badge = makeBadge(api.action ?? api.browserAction);
  const version = (() => { try { return api.runtime.getManifest().version; } catch { return '0'; } })();
  const appId = `${target}/${version}`;
  let cache = null;
  let osName = null;
  let pendingPdf = null; // {token, url, title, origins, at}: a PDF waiting for the user to grant a host permission
  const claimed = new Set();

  // --- settings and pairing ---------------------------------------------------------------------------------------

  async function platformOs() {
    if (osName == null) {
      try { osName = (await api.runtime.getPlatformInfo())?.os ?? ''; } catch { osName = ''; }
    }
    return osName;
  }
  const getSettings = async () => (await storage.get('settings')) ?? {};
  const defaultFrom = async () => defaultDeviceName(target, await platformOs());
  const deviceName = async () => (await getSettings()).from || defaultFrom();
  async function getPairing() {
    try { return await ds.loadPairing(storage); } catch { return null; }
  }

  async function getSender() {
    const pairing = await getPairing();
    if (!pairing) return null;
    const from = await deviceName();
    const key = `${pairing.code}|${pairing.relay}|${from}`;
    if (cache?.key !== key) cache = { key, sender: new ds.Sender({ pairing, storage, from, app: appId, fetch: fetchFn, now }) };
    return cache.sender;
  }

  async function requireSender() {
    const s = await getSender();
    if (!s) throw new ds.ShareError('pairing', 'Pair with your Daylight first.');
    return s;
  }

  /**
   * The popup's pairing field: a typed or pasted code or link (PROTOCOL 1.3, the app's own pairing screen). It pairs at
   * once, unless it would replace a Daylight with a different code: then nothing changes and it answers
   * {needsConfirm: {title, lines, button, expect}} in the protocol module's words (pairingConfirmation), and pairs when
   * the popup sends it again with confirm: true and that expect (the code in use when it asked). The same code with a
   * new relay or name keeps the outbox, whose items then go through the new relay; a different code deletes it
   * (applyPairingChange). relay: the Advanced field, for a typed code (a link names its own relay). from: this
   * browser's name.
   * -> {name, relay, notice} (notice: "Pairing updated…" for the same code, else null) | {needsConfirm}
   */
  async function pair({ input, from, relay, confirm = false, expect } = {}) {
    const next = await ds.parsePairing(input);
    next.relay = relayForInput(next, input, relay);
    return run(async () => {
      const current = await getPairing();
      const c = ds.pairingConfirmation(current, next, { source: 'app' });
      if (confirm) {
        if (expect != null && (current?.code ?? '') !== expect) {
          throw new ds.ShareError('pairing', 'The pairing changed in the meantime. Try again.');
        }
      } else if (c.ask) {
        return { needsConfirm: { title: c.title, lines: c.lines, button: c.button, expect: current?.code ?? '' } };
      }
      // A typed code (or a link without a name) for the Daylight already paired keeps the name it has.
      if (!ds.cleanName(next.name) && current && ds.samePairingSecret(current, next)) next.name = current.name;
      await ds.applyPairingChange(storage, current, next);
      await ds.savePairing(storage, next);
      if (from != null) await storage.set('settings', { ...(await getSettings()), from: ds.cleanName(from) });
      cache = null;
      return { name: ds.cleanName(next.name), relay: ds.normalizeRelay(next.relay), notice: c.notice };
    });
  }

  async function unpair() {
    return run(async () => {
      await ds.applyPairingChange(storage, await getPairing(), null);
      await storage.remove('pairing');
      cache = null;
      await badge.clear();
      return {};
    });
  }

  async function setDeviceName(from) {
    await storage.set('settings', { ...(await getSettings()), from: ds.cleanName(from) });
    cache = null;
    return { from: (await getSettings()).from };
  }

  /** Safari: the Mac or iPhone app may already be paired; its native handler shares the pairing. */
  async function pairFromApp() {
    if (target !== 'safari' || typeof api.runtime?.sendNativeMessage !== 'function') return false;
    if (await getPairing()) return false;
    let answer;
    try {
      answer = await withTimeout(Promise.resolve(api.runtime.sendNativeMessage('application.id', { type: 'getPairing' })), 4000);
    } catch { return false; }
    const a = answer?.pairing ?? answer;
    const code = a?.code ?? a?.link;
    if (typeof code !== 'string' || !code) return false;
    try {
      const p = await ds.parsePairing(code);
      if (a.relay) p.relay = ds.normalizeRelay(a.relay);
      if (a.name) p.name = ds.cleanName(a.name);
      // The user's own app: no question (PROTOCOL 1.3). Only when nothing is paired, so there is no outbox to keep.
      await run(async () => {
        if (await getPairing()) return;
        await ds.applyPairingChange(storage, null, p);
        await ds.savePairing(storage, p);
      });
      cache = null;
      return true;
    } catch { return false; }
  }

  async function shortcut() {
    try {
      const all = await api.commands?.getAll?.();
      return all?.find((c) => c.name === COMMAND_SEND)?.shortcut || '';
    } catch { return ''; }
  }

  async function state() {
    let pairing = await getPairing();
    if (!pairing && (await pairFromApp())) pairing = await getPairing();
    const settings = await getSettings();
    return {
      paired: !!pairing, name: pairing?.name ?? '', relay: pairing?.relay ?? '',
      defaultRelay: !pairing || pairing.relay === ds.DEFAULT_RELAY,
      from: settings.from ?? '', defaultFrom: await defaultFrom(), target, version, shortcut: await shortcut(),
    };
  }

  // --- sending ------------------------------------------------------------------------------------------------------

  async function patchRow(id, fields) {
    const rows = (await storage.get('outbox')) ?? [];
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    Object.assign(r, fields);
    await storage.set('outbox', rows);
  }

  function scheduleSoon() {
    try { api.alarms?.create(ALARM_SOON, { delayInMinutes: 0.5 }); } catch { /* ignore */ }
  }

  async function sendItem(item, reason) {
    const sender = await requireSender();
    const note = NOTES[reason] ?? '';
    const row = await run(async () => {
      const r = await sender.send(item);
      if (note) { r.note = note; await patchRow(r.id, { note }); }
      return r;
    });
    scheduleSoon();
    // Check for acks right away (PROTOCOL 3.3); the Daylight may be listening live.
    run(() => sender.checkAcks()).catch(() => {});
    return { row, note };
  }

  async function sendUrl(url, title, reason) {
    const u = ds.webUrl(url);
    if (!u) throw new ds.ShareError('url', 'Only web pages (http and https) can be sent to the Daylight.');
    return sendItem({ kind: 'url', url: u, title: title && title !== u ? title : '' }, reason);
  }

  async function inject(tabId, func, args = [], frameId) {
    const t = { tabId };
    if (frameId) t.frameIds = [frameId];
    const res = await api.scripting.executeScript({ target: t, func, args });
    const first = res?.[0];
    if (!first) throw new Error('the script returned nothing');
    if (first.error) throw new Error(String(first.error?.message ?? first.error));
    return first.result;
  }

  async function pdfViaTab(tabId, url, frameId) {
    const head = await inject(tabId, pdfStart, [url ?? null, MAX_PDF], frameId);
    if (!head || head.error) return null;
    if (head.tooLarge) return { tooLarge: true, size: head.size };
    try {
      const parts = [];
      for (let off = 0; off < head.size; off += pdfChunkSize) {
        const b64 = await inject(tabId, pdfChunk, [off, pdfChunkSize], frameId);
        if (typeof b64 !== 'string') return null;
        parts.push(ds.fromBase64(b64));
      }
      const bytes = ds.concat(...parts);
      if (bytes.length !== head.size || !isPdfBytes(bytes)) return null;
      return { bytes, disposition: head.disposition ?? '' };
    } finally {
      inject(tabId, pdfEnd, [], frameId).catch(() => {});
    }
  }

  async function pdfViaExtension(url, credentials) {
    const res = await fetchFn(url, { credentials, redirect: 'follow' });
    if (!res.ok) return null;
    const got = await readCapped(res, MAX_PDF);
    if (got.tooLarge) return got;
    if (!isPdfBytes(got.bytes)) return null;
    return { bytes: got.bytes, disposition: res.headers.get('content-disposition') ?? '' };
  }

  async function hasOrigins(origins) {
    try { return !!(await api.permissions.contains({ origins })); } catch { return false; }
  }

  async function requestOrigins(origins) {
    try { return !!(await api.permissions.request({ origins })); } catch { return false; }
  }

  /**
   * Sends a PDF as a file item: read inside the tab first (same origin, the user's cookies), else downloaded by the
   * extension (servers that allow CORS, or with the site's host permission), else sends the link.
   * prompt: may ask for the host permission here. asked: the popup already asked (don't return needsPermission).
   * -> {row, note} | {needsPermission: {origins}, url, title, token}
   */
  async function sendPdf({ url, title = '', tabId = null, frameId, prompt = false, asked = false } = {}) {
    const u = ds.webUrl(url);
    let got = null;
    if (tabId != null) {
      try { got = await pdfViaTab(tabId, url, frameId); } catch { got = null; }
    }
    if (!got && u) {
      const origins = [originPattern(u)];
      let allowed = await hasOrigins(origins);
      if (!allowed) {
        try { got = await pdfViaExtension(u, 'omit'); } catch { got = null; }
      }
      if (!got && !allowed) {
        if (prompt) allowed = await requestOrigins(origins);
        else if (!asked && api.permissions?.request) {
          const token = ds.newItemId();
          pendingPdf = { token, url: u, title, origins, at: now() };
          return { needsPermission: { origins }, url: u, title, token };
        }
      }
      if (!got && allowed) {
        try { got = await pdfViaExtension(u, 'include'); } catch { got = null; }
      }
      if (!got) return sendUrl(u, title, allowed ? 'pdf-failed' : 'pdf-denied');
    }
    if (!got) throw new ds.ShareError('pdf', 'Couldn’t read this PDF.');
    if (got.tooLarge) {
      if (u) return sendUrl(u, title, 'pdf-too-large');
      throw new ds.ShareError('too-large', ds.tooBigMessage(got.size > MAX_PDF ? got.size : MAX_PDF + 1));
    }
    const t = ds.cleanTitle(title);
    const usable = t && t !== u && !/^https?:\/\//i.test(t) ? t : '';
    const name = pdfFileName({ url: u ?? url, disposition: got.disposition, title: usable });
    const itemTitle = usable && !/\.pdf$/i.test(usable) ? usable : titleFromName(name);
    return sendItem({ kind: 'file', url: u ?? undefined, title: itemTitle, name, mime: PDF_MIME, content: got.bytes });
  }

  /** Claims a PDF waiting for a permission, so the popup and permissions.onAdded never both send it. -> won? */
  function claim(token) {
    if (!token) return true;
    if (claimed.has(token)) return false;
    claimed.add(token);
    if (pendingPdf?.token === token) pendingPdf = null;
    return true;
  }

  /**
   * "Send this page": the page's HTML as a page item, a PDF as a file item, the link when the page can't be read.
   * -> {row, note} | {needsPermission, ...}
   */
  async function sendTab(tab, { linkOnly = false, prompt = false } = {}) {
    await requireSender();
    const tabUrl = tab?.url || tab?.pendingUrl || '';
    const tabTitle = tab?.title || '';
    if (linkOnly) return sendUrl(tabUrl, tabTitle);
    let cap = null;
    if (tab?.id != null) {
      try { cap = await inject(tab.id, capturePage, [ds.MAX_PAGE_HTML]); } catch { cap = null; }
    }
    const plan = planForCapture(cap, tabUrl);
    const url = cap && ds.webUrl(cap.url) ? cap.url : tabUrl;
    const title = cap?.title || tabTitle;
    switch (plan.kind) {
      case 'pdf':
        return sendPdf({ url: cap?.url || tabUrl, title: tabTitle || cap?.title, tabId: cap ? tab.id : null, prompt });
      case 'url':
        return sendUrl(url, title, plan.reason);
      case 'none':
        throw new ds.ShareError('url', 'This page can’t be sent: only web pages (http and https) can.');
      case 'html-file': {
        const seg = decodeURIComponent((cap.url || tabUrl).split(/[?#]/)[0].split('/').pop() || '') || 'page.html';
        return sendItem({ kind: 'file', name: seg, mime: 'text/html', title, content: cap.html });
      }
      default: {
        const html = ds.utf8(cap.html);
        if (html.length > ds.MAX_PAGE_HTML) return sendUrl(url, title, 'too-large');
        return sendItem({ kind: 'page', url, title, content: html });
      }
    }
  }

  /** "Retry now" (a failed row) and "Try again" (an expired one), as the library allows. -> {row} */
  async function retry(id) {
    const s = await requireSender();
    const row = await run(() => s.retry(id));
    scheduleSoon();
    return { row };
  }

  /** "Remove": the row and its stored content. -> {removed} */
  async function remove(id) {
    const s = await getSender();
    return { removed: s ? await run(() => s.remove(id)) : false };
  }

  /**
   * Acks and re-sends (PROTOCOL 3.3, logic.maintain): the local re-send pass always runs (it ends week-old rows and
   * drops expired rows' content after 14 days); the ack topic is read only while a row could still be acked.
   */
  async function tick() {
    const s = await getSender();
    if (!s) return { delivered: 0, resent: 0 };
    return run(async () => {
      try { return await maintain(s, now()); } catch (e) { log.warn?.('Send to Daylight: tick failed', e); return { delivered: 0, resent: 0 }; }
    });
  }

  async function withBadge(fn) {
    await badge.start();
    let outcome = 'error';
    try {
      const r = await fn();
      outcome = r?.needsPermission ? 'idle' : isTrouble(r?.row) ? 'error' : 'ok';
      return r;
    } finally {
      await badge.done(outcome);
    }
  }

  // --- events -------------------------------------------------------------------------------------------------------

  async function openPairing() {
    try {
      if (api.action?.openPopup) { await api.action.openPopup(); return; }
    } catch { /* no window to show it in: fall back to a tab */ }
    try { await api.tabs.create({ url: api.runtime.getURL('popup.html?standalone=1') }); } catch { /* ignore */ }
  }

  async function titleOfLink(tab, info) {
    if (info.linkText) return info.linkText;
    if (tab?.id == null) return info.selectionText ?? '';
    try { return (await withTimeout(inject(tab.id, linkText, [info.linkUrl], info.frameId), 1500)) || info.selectionText || ''; } catch { return info.selectionText ?? ''; }
  }

  async function onMenu(info, tab) {
    try {
      if (!(await getPairing())) return await openPairing();
      if (info.menuItemId === MENU.page) return await withBadge(() => sendTab(tab, { prompt: true }));
      if (info.menuItemId === MENU.link) {
        const title = await titleOfLink(tab, info);
        return await withBadge(() => sendUrl(info.linkUrl, title));
      }
      if (info.menuItemId === MENU.pdfLink) {
        const title = await titleOfLink(tab, info);
        return await withBadge(() => sendPdf({ url: info.linkUrl, title, tabId: tab?.id ?? null, frameId: info.frameId, prompt: true }));
      }
    } catch (e) {
      log.warn?.('Send to Daylight:', e?.message ?? e);
    }
    return undefined;
  }

  async function onCommand(command, tab) {
    if (command !== COMMAND_SEND) return undefined;
    try {
      if (!tab) [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!(await getPairing())) return await openPairing();
      return await withBadge(() => sendTab(tab, { prompt: true }));
    } catch (e) {
      log.warn?.('Send to Daylight:', e?.message ?? e);
      return undefined;
    }
  }

  async function onAlarm(alarm) {
    if (alarm?.name === ALARM_TICK || alarm?.name === ALARM_SOON) await tick();
  }

  /** The user granted a site from the popup's prompt; if the popup closed meanwhile, send the PDF from here. */
  async function onPermissionsAdded(perms) {
    const p = pendingPdf;
    if (!p || now() - p.at > PENDING_PDF_MS || !perms?.origins?.some((o) => p.origins.includes(o))) return;
    // Let the popup claim it first if it is still open.
    await new Promise((r) => setTimeout(r, 1500));
    if (claim(p.token)) await withBadge(() => sendPdf({ url: p.url, title: p.title, asked: true })).catch(() => {});
  }

  async function setupMenus() {
    const menus = api.contextMenus ?? api.menus;
    if (!menus?.create) return;
    try { await menus.removeAll(); } catch { /* ignore */ }
    const create = (props) => new Promise((resolve) => {
      try { menus.create(props, () => { void api.runtime.lastError; resolve(); }); } catch { resolve(); }
    });
    await create({ id: MENU.page, title: 'Send page to Daylight', contexts: ['page', 'frame'] });
    await create({ id: MENU.link, title: 'Send link to Daylight', contexts: ['link'] });
    await create({ id: MENU.pdfLink, title: 'Send PDF link to Daylight', contexts: ['link'], targetUrlPatterns: PDF_LINK_PATTERNS });
  }

  async function ensureAlarms() {
    if (!api.alarms) return;
    try {
      if (!(await api.alarms.get(ALARM_TICK))) api.alarms.create(ALARM_TICK, { delayInMinutes: 1, periodInMinutes: 15 });
    } catch { /* ignore */ }
  }

  /** Browser start or install/update: menus, alarm, a Safari app pairing, then acks and re-sends. */
  async function start() {
    await setupMenus();
    await ensureAlarms();
    await pairFromApp();
    await tick().catch(() => {});
  }

  async function onMessage(msg) {
    switch (msg?.type) {
      case 'state': return state();
      case 'pair': return pair(msg);
      case 'unpair': return unpair();
      case 'setName': return setDeviceName(msg.from);
      case 'sendTab': {
        const tab = await api.tabs.get(msg.tabId);
        return withBadge(() => sendTab(tab, { linkOnly: !!msg.linkOnly }));
      }
      case 'sendPdf':
        if (!claim(msg.token)) return { handled: true }; // permissions.onAdded already sent it
        return withBadge(() => sendPdf({ url: msg.url, title: msg.title, asked: true }));
      case 'retry': return withBadge(() => retry(msg.id));
      case 'remove': return remove(msg.id);
      case 'tick': return tick();
      case 'clearBadge': await badge.clear(); return {};
      default: throw new ds.ShareError('message', `unknown message ${msg?.type}`);
    }
  }

  /** runtime.onMessage listener: answers {ok: true, result} or {ok: false, error, code}. */
  function handleMessage(msg, sender, sendResponse) {
    if (sender?.id && api.runtime?.id && sender.id !== api.runtime.id) return false;
    onMessage(msg).then(
      (result) => sendResponse({ ok: true, result: result ?? {} }),
      (e) => sendResponse({ ok: false, error: e?.message ?? String(e), code: e?.code ?? '' }),
    );
    return true;
  }

  return {
    storage, state, pair, unpair, setDeviceName, pairFromApp, sendTab, sendPdf, sendUrl, retry, remove, tick, start,
    setupMenus, ensureAlarms, onMenu, onCommand, onAlarm, onPermissionsAdded, onMessage, handleMessage,
    getSender, getPairing, claim,
  };
}
