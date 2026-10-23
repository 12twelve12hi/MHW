// The extension's background logic. createApp() takes the browser API object (chrome or browser) instead of reading
// globals, so the unit tests drive it with a fake one; background.js wires it to the real events.

import * as ds from './daylight-share.js';
import { LAB_TEXT, labUseOn, normaliseShare, cleanShareUrl, excerptItem, testArticle } from './daylight-lab.js';
import { createLab } from './lab.js';
import { capturePage, pdfStart, pdfChunk, pdfEnd, linkText, pageInfo, captureSelection, captureArticle } from './inject.js';
import {
  PDF_MIME, PDF_CHUNK, MAX_PDF, NOTES, originPattern, pdfFileName, isPdfBytes, titleFromName,
  planForCapture, defaultDeviceName, isTrouble, maintain, relayForInput, wantsAcks, looksLikePdfUrl,
} from './logic.js';
import {
  MENU_IDS, PDF_LINK_PATTERNS as LINK_PDF_PATTERNS, COMMANDS, menuEntries, defaultMode, rememberMode, cleanArticleHtml,
  THIN_WORDS, COUNTDOWN_MS, FLUSH_GAP_MS, ALARM_OFFLINE as OFFLINE_ALARM, badgeMark, wantsStates, waitingForConnection, typedUrl, textLinkItem, clickToSend,
  noCountdown, siteOf,
} from './lab-send.js';

export const MENU = { page: MENU_IDS.page, link: MENU_IDS.link, pdfLink: MENU_IDS.pdf, clean: MENU_IDS.clean, selection: MENU_IDS.selection, image: MENU_IDS.image };
export const ALARM_TICK = 'dls-tick';
export const ALARM_SOON = 'dls-soon';
export const ALARM_OFFLINE = OFFLINE_ALARM;
export const PDF_LINK_PATTERNS = LINK_PDF_PATTERNS;
export const COMMAND_SEND = COMMANDS.page;
const PENDING_PDF_MS = 5 * 60 * 1000;
/** F04: how long the card's popup has to take a PDF question (labHoldPdf) before its link goes instead. */
const POPUP_HOLD_MS = 3000;
/** Lab's capture code (LAB-PLAN F03, F10): build.mjs copies them from share/js/capture/; injected before a capture. */
export const CLEAN_FILES = ['clean-html.js'];
export const ARTICLE_FILES = ['Readability.js', 'clean-html.js'];
/** F10's Review: the one item waiting for Send or Cancel on review.html (lab/ goes with a pairing change). */
const REVIEW_KEY = 'lab/review';
const SEND_AS_KEY = 'lab/sendAs';
const BADGE_KEY = 'lab/badge';
const FLUSH_KEY = 'lab/flushAt';
const OFFLINE_KEY = 'lab/offlineAt';
const TEST_KEY = 'lab/testId';

/**
 * A chrome.storage area as a daylight-share storage adapter. Every failed write is reported: the library keeps sending
 * an item whose re-send copy ('outbox/<id>') can't be stored (it goes once), and must know when anything else fails.
 */
export function areaStorage(area) {
  return {
    async get(k) { const o = await area.get(k); return o?.[k]; },
    async set(k, v) { await area.set({ [k]: v }); },
    async remove(k) { await area.remove(k); },
    // applyPairingChange removes every lab/* key of another pairing, the ones it doesn't know by name too.
    async keys() { return Object.keys((await area.get(null)) ?? {}); },
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
    /** Lab (F01): a send is over without v1.1's outcome mark; the most recent row's mark follows (show). */
    release() { busy = Math.max(0, busy - 1); return busy === 0; },
    busy: () => busy > 0,
    /** Lab (F01): the most recent row's mark (LAB_TEXT.badge): ✓ for 6 s, the others until the next mark. */
    async show(mark) {
      if (busy) return;
      clearTimeout(timer);
      if (!mark) { await set(''); return; }
      await set(mark, mark === LAB_TEXT.badge.error ? '#b3261e' : '#222222');
      if (mark === LAB_TEXT.badge.delivered) timer = setTimeout(() => set(''), 6000);
    },
  };
}

/**
 * labBuilt: false in a build made while its Lab wave is closed (target.js LAB_BUILT, written by build.mjs; LAB-PLAN 6.2):
 * then nothing of Lab runs or shows, and the extension is its last non-Lab build.
 */
export function createApp({
  api, target = 'chrome', storage, fetch: fetchImpl, now = () => Date.now(), log = console, pdfChunkSize = PDF_CHUNK,
  gateDeadlineMs, labBuilt = true, online = () => globalThis.navigator?.onLine !== false, countdownMs = COUNTDOWN_MS,
  popupHoldMs = POPUP_HOLD_MS,
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
  const held = new Set(); // F04: PDF questions the card's popup took (holdPdf)

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

  // Lab (lab.js): the switch, the ledger every ack-topic frame feeds (Lab on or off), the gates and the server.
  const lab = createLab({
    api, target, storage, fetch: fetchFn, now, log, run, getPairing, getSettings, deviceName: () => deviceName(), appId,
    refreshAcks: async () => { const s = await getSender(); if (s) await run(() => s.checkAcks()); },
    ...(gateDeadlineMs ? { gateDeadlineMs } : {}), built: labBuilt,
  });

  async function getSender() {
    const pairing = await getPairing();
    if (!pairing) return null;
    const from = await deviceName();
    const key = `${pairing.code}|${pairing.relay}|${from}`;
    if (cache?.key !== key) {
      const onAckHeader = labBuilt ? lab.hook : undefined; // a build without Lab keeps no ledger, as before Lab
      cache = { key, sender: new ds.Sender({ pairing, storage, from, app: appId, fetch: fetchFn, now, onAckHeader }) };
    }
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
   * browser's name. Another Daylight while a Daylight server was known: the server is locked first, and the popup then
   * shows the re-pairing follow-up (LAB-PLAN 2.6, DESIGN 12.7; lab.js `repaired`, while Lab is on).
   * -> {name, relay, notice, serverLocked?} (notice: "Pairing updated…" for the same code, else null; serverLocked:
   * true when a server was known, so the follow-up waits) | {needsConfirm}
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
      // Another Daylight: a Daylight server that knows this pairing is locked first (LAB-PLAN 2.6), Lab on or off.
      const repair = await lab.beforeRepair(current, next);
      await ds.applyPairingChange(storage, current, next);
      await ds.savePairing(storage, next);
      if (repair.known) await lab.afterRepair();
      if (from != null) await storage.set('settings', { ...(await getSettings()), from: ds.cleanName(from) });
      cache = null;
      const out = { name: ds.cleanName(next.name), relay: ds.normalizeRelay(next.relay), notice: c.notice };
      if (repair.known) out.serverLocked = true;
      return out;
    });
  }

  async function unpair() {
    return run(async () => {
      const current = await getPairing();
      await lab.beforeUnpair(current); // a typed Server address goes with the pairing (LAB-PLAN 2.6)
      await ds.applyPairingChange(storage, current, null);
      await storage.remove('pairing');
      cache = null;
      await badge.clear();
      return {};
    });
  }

  async function setDeviceName(from) {
    // Under the lock, like every settings write, so a name and Comfort saved together both stay.
    await run(async () => storage.set('settings', { ...(await getSettings()), from: ds.cleanName(from) }));
    cache = null;
    return { from: (await getSettings()).from };
  }

  /**
   * Comfort (F27, the accessibility baseline; not Lab): settings.comfort, off by default. Pairing, unpairing and Lab
   * leave it as it is. -> {comfort}
   */
  async function setComfort(on) {
    await run(async () => storage.set('settings', { ...(await getSettings()), comfort: !!on }));
    return { comfort: !!(await getSettings()).comfort };
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
      comfort: !!settings.comfort, lab: labBuilt && settings.lab !== false, labBuilt,
    };
  }

  // --- sending ------------------------------------------------------------------------------------------------------

  /** Lab as this build reads it now: {on, s: the settings}. A build without Lab has it off. */
  async function labCtx() {
    const s = await getSettings();
    return { on: labBuilt && s.lab !== false, s };
  }

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

  /**
   * Shares one item. With Lab on (F07): while this device is offline the row is stored to wait for a connection
   * (Sender.send defer), and the dls-offline alarm sends it once the device is back online; every send goes into the
   * activity log (F26).
   */
  async function sendItem(item, reason, { lab: c = null } = {}) {
    const sender = await requireSender();
    const note = NOTES[reason] ?? '';
    c ??= await labCtx();
    const defer = c.on && !online();
    const row = await run(async () => {
      const r = await sender.send(item, { defer });
      if (note) { r.note = note; await patchRow(r.id, { note }); }
      return r;
    });
    if (c.on) {
      await lab.logEvent({ type: defer ? 'defer' : 'send', id: row.id, kind: row.kind, status: row.status, http: row.http });
      if (defer) await markOffline();
      if (waitingForConnection(row)) ensureOfflineAlarm();
      await labBadge();
    }
    scheduleSoon();
    // Check for acks right away (PROTOCOL 3.3); the Daylight may be listening live.
    if (!defer) run(() => sender.checkAcks()).catch(() => {});
    return reason && c.on ? { row, note, reason } : { row, note };
  }

  /**
   * Lab (F16): a link as Lab sends it: normaliseShare unwraps redirectors and drops tracking (unless F16's Use switch
   * is off), and the link as shared goes as x-orig. -> the url item.
   */
  function labLinkItem(url, title, s) {
    const n = normaliseShare({ url, subject: title ?? '', clean: labUseOn(s, 'F16') });
    const u = n.url ?? url;
    const t = n.title && n.title !== u && n.title !== url ? n.title : '';
    const item = { kind: 'url', url: u, title: t };
    if (n.orig) item.extras = { 'x-orig': n.orig };
    return item;
  }

  /** Lab (F16): a page's URL, cleaned as a link's is; the URL as shared goes as x-orig. -> {url, extras} */
  function labPageUrl(url, s) {
    const cleaned = labUseOn(s, 'F16') ? cleanShareUrl(url) : null;
    if (!cleaned || cleaned === url) return { url, extras: {} };
    return { url: cleaned, extras: url.length <= ds.X_ORIG_MAX ? { 'x-orig': url } : {} };
  }

  async function sendUrl(url, title, reason, { lab: c = null } = {}) {
    const u = ds.webUrl(url);
    if (!u) throw new ds.ShareError('url', 'Only web pages (http and https) can be sent to the Daylight.');
    c ??= await labCtx();
    const item = c.on ? labLinkItem(u, title, c.s) : { kind: 'url', url: u, title: title && title !== u ? title : '' };
    return sendItem(item, reason, { lab: c });
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

  /** Lab: loads the capture code (clean-html.js, Readability.js) into the tab's extension world, then runs func. */
  async function injectWith(files, tabId, func, args = [], frameId) {
    const t = { tabId };
    if (frameId) t.frameIds = [frameId];
    await api.scripting.executeScript({ target: t, files });
    return inject(tabId, func, args, frameId);
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
    held.delete(token);
    if (pendingPdf?.token === token) pendingPdf = null;
    return true;
  }

  /**
   * "Send this page": the page's HTML as a page item, a PDF as a file item, the link when the page can't be read.
   * With Lab on, `mode` (F10's Send as: page, clean, link, selection; from the popup, a menu or a command) says how,
   * and the page goes through clean-html.js (F03). -> {row, note} | {needsPermission, ...} | Lab: {thin: {n}} (F10's
   * thin-page question, from the popup) | {review: token} (F10's Review opened)
   */
  async function sendTab(tab, opts = {}) {
    await requireSender();
    const c = await labCtx();
    if (c.on) return labSendTab(tab, opts, c);
    const { linkOnly = false, prompt = false } = opts;
    const tabUrl = tab?.url || tab?.pendingUrl || '';
    const tabTitle = tab?.title || '';
    if (linkOnly) return sendUrl(tabUrl, tabTitle, undefined, { lab: c });
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
        return sendUrl(url, title, plan.reason, { lab: c });
      case 'none':
        throw new ds.ShareError('url', 'This page can’t be sent: only web pages (http and https) can.');
      case 'html-file': {
        const seg = decodeURIComponent((cap.url || tabUrl).split(/[?#]/)[0].split('/').pop() || '') || 'page.html';
        return sendItem({ kind: 'file', name: seg, mime: 'text/html', title, content: cap.html }, undefined, { lab: c });
      }
      default: {
        const html = ds.utf8(cap.html);
        if (html.length > ds.MAX_PAGE_HTML) return sendUrl(url, title, 'too-large', { lab: c });
        return sendItem({ kind: 'page', url, title, content: html }, undefined, { lab: c });
      }
    }
  }

  /**
   * sendTab with Lab on. opts: {linkOnly, prompt (may ask for a PDF's site), mode (F10: page | clean | link |
   * selection; F10's Use switch off leaves page, link and F11's selection, LAB-PROTOCOL 2.9.6; a clean article then
   * only when asked for by name: a menu or a command), force (F10: send a thin article anyway), thin ('ask': return
   * {thin} under 150 words; 'page': send the full page instead, for menus, commands and the card), remember (F10: keep
   * the mode for the site), review (F10: open Review first when "Review before sending" is on)}.
   */
  async function labSendTab(tab, opts, c) {
    const { linkOnly = false, prompt = false, force = false, thin = 'page', remember = false, review = false } = opts;
    const sendAs = labUseOn(c.s, 'F10');
    let mode = opts.mode ?? 'page';
    if (!sendAs && mode === 'clean' && !opts.explicit) mode = 'page';
    if (linkOnly) mode = 'link';
    const tabUrl = tab?.url || tab?.pendingUrl || '';
    const tabTitle = tab?.title || '';
    if (remember && sendAs) await rememberSendAs(tabUrl, mode);
    if (mode === 'link') return sendUrl(tabUrl, tabTitle, undefined, { lab: c });
    if (mode === 'selection') {
      const r = await labSendSelection(tab, { lab: c, review: review && sendAs });
      if (r) return r;
      mode = 'page'; // nothing selected any more: the page
    }
    if (mode === 'clean' && tab?.id != null && !looksLikePdfUrl(tabUrl)) {
      const r = await labSendClean(tab, { lab: c, force, thin, review: review && sendAs });
      if (r) return r;
    }
    let cap = null;
    if (tab?.id != null) {
      const words = review && sendAs && !!c.s.labReview; // Review shows the word count
      try { cap = await injectWith(CLEAN_FILES, tab.id, capturePage, [ds.MAX_PAGE_HTML, { clean: true, words }]); } catch { cap = null; }
      if (cap?.error) cap = null;
    }
    const plan = planForCapture(cap, tabUrl);
    const url = cap && ds.webUrl(cap.url) ? cap.url : tabUrl;
    const title = cap?.title || tabTitle;
    switch (plan.kind) {
      case 'pdf':
        return sendPdf({ url: cap?.url || tabUrl, title: tabTitle || cap?.title, tabId: cap ? tab.id : null, prompt });
      case 'url':
        return sendUrl(url, title, plan.reason, { lab: c });
      case 'none':
        throw new ds.ShareError('url', 'This page can’t be sent: only web pages (http and https) can.');
      case 'html-file': {
        const seg = decodeURIComponent((cap.url || tabUrl).split(/[?#]/)[0].split('/').pop() || '') || 'page.html';
        return sendItem({ kind: 'file', name: seg, mime: 'text/html', title, content: cap.html, extras: { 'x-cap': 'seen' } }, undefined, { lab: c });
      }
      default: {
        const html = ds.utf8(cap.html);
        if (html.length > ds.MAX_PAGE_HTML) return sendUrl(url, title, 'too-large', { lab: c });
        const clean = labPageUrl(url, c.s);
        const item = { kind: 'page', url: clean.url, title, content: html, extras: { 'x-cap': 'seen', ...clean.extras } };
        if (review && sendAs && c.s.labReview) return openReview(item, cap.words ?? null);
        return sendItem(item, undefined, { lab: c });
      }
    }
  }

  /**
   * F10's Clean article: Readability in the tab, cleaned, wrapped as the page sent with x-cap "clean". Under 150 words
   * it is thin: {thin: {n}} for the popup's question (thin 'ask', unless force), else (menus, commands, the card) the
   * full page goes instead (null). null too when nothing could be extracted (the full page goes).
   */
  async function labSendClean(tab, { lab: c, force, thin, review }) {
    let a = null;
    try { a = await injectWith(ARTICLE_FILES, tab.id, captureArticle, []); } catch { a = null; }
    if (!a || a.error || a.empty || !a.content) {
      if (thin === 'ask' && !force) return { thin: { n: 0 } };
      return null;
    }
    if (!force && a.words < THIN_WORDS) {
      if (thin === 'ask') return { thin: { n: a.words } };
      return null;
    }
    const url = ds.webUrl(a.url) ?? ds.webUrl(tab.url);
    if (!url) return null; // a page item needs its web address (a file:// page goes as the page)
    const title = ds.cleanTitle(a.articleTitle) || ds.cleanTitle(a.title) || tab.title || '';
    const html = cleanArticleHtml({ title, url, byline: a.byline, site: a.site, content: a.content });
    if (ds.utf8(html).length > ds.MAX_PAGE_HTML) return null;
    const clean = labPageUrl(url, c.s);
    const item = { kind: 'page', url: clean.url, title, content: html, extras: { 'x-cap': 'clean', ...clean.extras } };
    if (review && c.s.labReview) return openReview(item, a.words);
    return sendItem(item, undefined, { lab: c });
  }

  /**
   * F11's explicit paths (and F10's Selection mode): the selection as an excerpt document (excerptItem: the quote, its
   * source link and the date; x-cap "excerpt"). info: a context-menu click (its frame, its selectionText).
   * -> {row, note, excerpt: true} | {review} | null when nothing is selected.
   */
  async function labSendSelection(tab, { lab: c, info = null, review = false } = {}) {
    let cap = null;
    if (tab?.id != null) {
      try { cap = await inject(tab.id, captureSelection, [], info?.frameId); } catch { cap = null; }
    }
    const text = String(cap?.text || info?.selectionText || '').trim();
    if (!text) return null;
    const pageUrl = ds.webUrl(cap?.url) ?? ds.webUrl(info?.frameUrl) ?? ds.webUrl(info?.pageUrl) ?? ds.webUrl(tab?.url) ?? '';
    const n = normaliseShare({ text, url: pageUrl, source: 'selection', clean: labUseOn(c.s, 'F16') });
    const item = excerptItem({
      text: n.excerpt ?? text, html: cap?.text ? cap.html : '', url: n.url ?? pageUrl, pageTitle: cap?.title || tab?.title || '', date: now(),
    });
    if (!item) return null;
    if (review && c.s.labReview) return openReview(item, text.split(/\s+/).filter(Boolean).length);
    return { ...(await sendItem(item, undefined, { lab: c })), excerpt: true };
  }

  async function rememberSendAs(url, mode) {
    try {
      await run(async () => {
        const map = (await storage.get(SEND_AS_KEY)) ?? {};
        const next = rememberMode(map, url, mode);
        if (next !== map) await storage.set(SEND_AS_KEY, next);
      });
    } catch (e) { log.warn?.('Send to Daylight: Send as not remembered', e); }
  }

  // --- F10's Review ---------------------------------------------------------------------------------------------------

  /** Keeps the item for review.html and opens it in a tab. -> {review: token} */
  async function openReview(item, words) {
    const token = ds.newItemId();
    const content = typeof item.content === 'string' ? item.content : ds.fromUtf8(item.content);
    let size = 0;
    try { size = (await ds.deflateRaw(ds.utf8(content))).length; } catch { size = ds.utf8(content).length; }
    await storage.set(REVIEW_KEY, { token, item: { ...item, content }, words: words ?? null, size, at: now() });
    try { await api.tabs.create({ url: api.runtime.getURL(`review.html#${token}`) }); } catch (e) { log.warn?.('Send to Daylight: Review not opened', e); }
    return { review: token };
  }

  /** -> {token, title, html, words, size, kind} for review.html, or {gone: true} when that review was sent or dropped. */
  async function reviewGet(token) {
    const r = await storage.get(REVIEW_KEY);
    if (!r || r.token !== token) return { gone: true };
    return { token, title: r.item.title ?? '', html: r.item.content, words: r.words, size: r.size, kind: r.item.kind };
  }

  /** Review's Send: the item with the edited title. -> {row, note} | {gone: true} */
  async function reviewSend(token, title) {
    const r = await storage.get(REVIEW_KEY);
    if (!r || r.token !== token) return { gone: true };
    await storage.remove(REVIEW_KEY);
    const t = ds.cleanTitle(title);
    return sendItem({ ...r.item, title: t || r.item.title });
  }

  async function reviewCancel(token) {
    const r = await storage.get(REVIEW_KEY);
    if (r?.token === token) await storage.remove(REVIEW_KEY);
    return {};
  }

  // --- F04's share in place: the countdown runs here, so closing the popup still sends --------------------------------

  const scheduled = new Map(); // tabId -> {timer, resolve}

  /**
   * Whether the toolbar's popup is open: Chrome's runtime.getContexts (116+, its POPUP contexts), or extension.getViews
   * where the background is a page (Safari). Only popup.html itself counts: popup.html?standalone=1, the pairing page
   * openPairing and Setup check open in a tab, is not the card's and never answers it. False where it can't be told.
   */
  async function popupOpen() {
    let page = '';
    try { page = api.runtime.getURL('popup.html'); } catch { return false; }
    const toolbar = (u) => String(u ?? '').split('#')[0] === page;
    try {
      if (typeof api.runtime?.getContexts === 'function') {
        return ((await api.runtime.getContexts({ contextTypes: ['POPUP'] })) ?? []).some((x) => toolbar(x?.documentUrl));
      }
      if (typeof api.extension?.getViews === 'function') {
        return api.extension.getViews().some((w) => toolbar(w?.location?.href));
      }
    } catch { /* can't be told */ }
    return false;
  }

  /**
   * F04: the card's popup took a PDF question (labHoldPdf, as soon as the answer reaches it), so its Allow and Send the
   * link answer it. -> {held: true}, or {handled: true} when its link already went (the popup came too late).
   */
  function holdPdf(token) {
    if (!token || claimed.has(token)) return { handled: true };
    held.add(token);
    return { held: true };
  }

  /**
   * F04: sends the tab after `ms` (1.5 s) unless Options cancels it (cancelScheduled). Only with Lab on, F04 in use and
   * "Send when I click the toolbar button" ticked, and never for someone who needs more time (noCountdown).
   * A PDF the extension may only download with its site's permission can't be asked for here (no click any more): the
   * answer is {needsPermission} for the popup, which takes it (labHoldPdf) and asks with its Allow button, as "Send
   * this PDF" does. With the toolbar's popup gone (popupOpen), nobody could answer, so its link goes at once with v1.1's
   * sentence for a site not allowed; and when no popup takes the question within popupHoldMs (3 s), its link goes then
   * (never nothing).
   * -> the send's answer, or {cancelled: true}
   */
  async function scheduleSend(tabId, { mode = 'page', ms = countdownMs } = {}) {
    cancelScheduled(tabId);
    // Registered at once, so an Options tap that comes before the settings are read still cancels it.
    const entry = { timer: null, resolve: null, cancelled: false };
    scheduled.set(tabId, entry);
    const c = await labCtx();
    if (entry.cancelled) return { cancelled: true };
    if (!c.on || !clickToSend(c.s) || noCountdown(c.s)) {
      if (scheduled.get(tabId) === entry) scheduled.delete(tabId);
      return { cancelled: true, refused: true };
    }
    return new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.timer = setTimeout(async () => {
        if (scheduled.get(tabId) === entry) scheduled.delete(tabId);
        try {
          const tab = await api.tabs.get(tabId);
          let r = await withBadge(() => sendTab(tab, { mode, thin: 'page', prompt: false }));
          if (r?.needsPermission) {
            const p = r;
            const sendLink = () => (claim(p.token) ? withBadge(() => sendUrl(p.url, p.title, 'pdf-denied')) : { handled: true });
            if (!(await popupOpen())) r = await sendLink();
            else {
              // The answer goes to the popup that started the countdown; if that one closed meanwhile (another popup,
              // in another window, can't answer it), nobody holds the question, and its link goes.
              setTimeout(() => {
                if (!held.has(p.token)) Promise.resolve(sendLink()).catch((e) => log.warn?.('Send to Daylight: PDF link not sent', e));
              }, popupHoldMs);
            }
          }
          resolve(r);
        } catch (e) { reject(e); }
      }, ms);
    });
  }

  /** F04's Options: stops the countdown. -> {cancelled: true when one was running} */
  function cancelScheduled(tabId) {
    const s = scheduled.get(tabId);
    if (!s) return { cancelled: false };
    clearTimeout(s.timer);
    scheduled.delete(tabId);
    s.cancelled = true;
    s.resolve?.({ cancelled: true });
    return { cancelled: true };
  }

  // --- F07: offline ---------------------------------------------------------------------------------------------------

  async function markOffline() {
    try { if (!(await storage.get(OFFLINE_KEY))) await storage.set(OFFLINE_KEY, now()); } catch { /* the alarm still runs */ }
  }

  function ensureOfflineAlarm() {
    try { api.alarms?.create(OFFLINE_ALARM, { delayInMinutes: 1, periodInMinutes: 1 }); } catch { /* ignore */ }
  }

  async function clearOfflineAlarm() {
    try { await api.alarms?.clear?.(OFFLINE_ALARM); } catch { /* ignore */ }
  }

  /**
   * The dls-offline alarm (F07), every minute while a row waits for a connection: offline, it notes that; back online,
   * it sends the waiting rows (flushNetwork: oldest first, at most 30 frames and 18 MB of attachments a pass, passes
   * at least 3 minutes apart) until a pass has tried them all. Gone when no row waits, and with Lab off (v1.1's
   * back-off then sends them). -> the rows a pass attempted, or [].
   */
  async function offlinePass() {
    const c = await labCtx();
    const sender = await getSender();
    const rows = sender ? await sender.list() : [];
    const waiting = rows.filter(waitingForConnection);
    if (!c.on || !sender || !waiting.length) {
      await clearOfflineAlarm();
      if (!waiting.length) await storage.remove(OFFLINE_KEY).catch(() => {});
      return [];
    }
    ensureOfflineAlarm();
    if (!online()) { await markOffline(); return []; }
    const since = await storage.get(OFFLINE_KEY);
    const fresh = waiting.some((r) => (r.attempts ?? 0) === 0);
    if (!since && !fresh) return []; // the relay, not this device, failed: v1.1's back-off sends these
    if (now() - ((await storage.get(FLUSH_KEY)) ?? 0) < FLUSH_GAP_MS) return [];
    await storage.set(FLUSH_KEY, now());
    const attempted = await run(() => sender.flushNetwork());
    for (const r of attempted) await lab.logEvent({ type: 'flush', id: r.id, kind: r.kind, status: r.status, http: r.http });
    if (attempted.length >= waiting.length) await storage.remove(OFFLINE_KEY);
    if (!(await sender.list()).some(waitingForConnection)) await clearOfflineAlarm();
    await labBadge();
    return attempted;
  }

  // --- F01's badge ----------------------------------------------------------------------------------------------------

  /**
   * With Lab on, the toolbar badge shows the most recent row's state (F01): … on its way, ✓ on your Daylight, ⌛
   * waiting for a tap, ! not on its way. A mark shows when it changes (lab/badge keeps the last one, so a wake-up
   * doesn't show it again); force: after a send, whatever was shown before.
   */
  async function labBadge({ force = false } = {}) {
    if (badge.busy()) return; // a send is on its way: "…" stays until it ends (withBadge)
    const c = await labCtx();
    if (!c.on) return;
    try {
      const rows = (await storage.get('outbox')) ?? [];
      let newest = null;
      for (const r of rows) if (!newest || (r.created ?? 0) > (newest.created ?? 0)) newest = r;
      const state = newest?.status === 'delivered' ? await lab.ledger.state(newest.id) : null;
      const mark = badgeMark(newest, state);
      const key = `${newest?.id ?? ''}|${mark}`;
      if (!force && key === (await storage.get(BADGE_KEY))) return;
      await storage.set(BADGE_KEY, key);
      await badge.show(mark);
    } catch (e) { log.warn?.('Send to Daylight: badge not updated', e); }
  }

  /** "Retry now" (a failed row) and "Try again" (an expired one), as the library allows. -> {row} */
  async function retry(id) {
    const s = await requireSender();
    const row = await run(() => s.retry(id));
    scheduleSoon();
    if ((await labCtx()).on && row) await lab.logEvent({ type: 'retry', id: row.id, kind: row.kind, status: row.status, http: row.http });
    return { row };
  }

  /** "Remove": the row and its stored content. -> {removed} */
  async function remove(id) {
    const s = await getSender();
    const removed = s ? await run(() => s.remove(id)) : false;
    if (removed && (await labCtx()).on) await lab.logEvent({ type: 'remove', id });
    return { removed };
  }

  /**
   * Acks and re-sends (PROTOCOL 3.3, logic.maintain): the local re-send pass always runs (it ends week-old rows and
   * drops expired rows' content after 14 days); the ack topic is read only while a row could still be acked. With Lab
   * on it is also read while a row delivered in the last 48 hours has no settled Lab state (F01), and what changed goes
   * into the activity log (F26).
   */
  async function tick() {
    const s = await getSender();
    if (!s) return { delivered: 0, resent: 0 };
    const c = await labCtx();
    const before = c.on ? await s.list() : null;
    const r = await run(async () => {
      try {
        const out = await maintain(s, now());
        if (c.on) {
          const rows = await s.list();
          if (!wantsAcks(rows, now()) && wantsStates(rows, (await storage.get('lab/states')) ?? {}, now())) await s.checkAcks().catch(() => {});
        }
        return out;
      } catch (e) { log.warn?.('Send to Daylight: tick failed', e); return { delivered: 0, resent: 0 }; }
    });
    await lab.prune();
    if (c.on) {
      await logChanges(before, await s.list());
      await labBadge();
    }
    return r;
  }

  /**
   * F26's activity log: each row whose status changed between two reads of the outbox, or that went again, with the HTTP
   * status of its last failed publish (`http`: 413, 429, …; 0 when there was none, LAB-PROTOCOL 2.7.1).
   */
  async function logChanges(before, after) {
    const was = new Map((before ?? []).map((x) => [x.id, x]));
    for (const row of after ?? []) {
      const old = was.get(row.id);
      if (old && (old.status !== row.status || old.lastPublish !== row.lastPublish)) {
        await lab.logEvent({ type: old.status !== row.status ? row.status : 'resend', id: row.id, kind: row.kind, status: row.status, http: row.http });
      }
    }
  }

  /** F01's faster checks (2.5): the popup asks every 30 s while a delivered row's state is still on its way. */
  async function checkAcksNow() {
    const s = await getSender();
    if (!s) return { delivered: 0 };
    const c = await labCtx();
    const before = c.on ? await s.list() : null;
    let delivered = 0;
    try { delivered = await run(() => s.checkAcks()); } catch { /* offline */ }
    if (c.on) { await logChanges(before, await s.list()); await labBadge(); }
    return { delivered };
  }

  async function withBadge(fn) {
    await badge.start();
    let outcome = 'error';
    let r;
    let threw = true;
    try {
      r = await fn();
      threw = false;
      outcome = r?.needsPermission || r?.thin || r?.review || r?.cancelled ? 'idle' : isTrouble(r?.row) ? 'error' : 'ok';
      return r;
    } finally {
      // With Lab on, the most recent row's mark replaces the "…" the send showed (shown again, whatever it was). A send
      // that failed or made no row (a page the extension may not send, no link in the copied text, no selection) shows
      // "!" as v1.1 does: the most recent row's mark would be an older item's (a false ✓). A question, the thin-page
      // one, Review, a cancelled countdown and a review already gone show the most recent row's mark.
      if ((await labCtx()).on) {
        const asked = r?.needsPermission || r?.thin || r?.review || r?.cancelled || r?.gone || r?.handled;
        if (badge.release()) {
          if (threw || (!r?.row && !asked)) await badge.show(LAB_TEXT.badge.error);
          else await labBadge({ force: true });
        }
      } else await badge.done(outcome);
    }
  }

  // --- Lab's other ways to send (F11, F26, F33, F34) ------------------------------------------------------------------

  /** F33's "Paste and send": text read from the clipboard. -> {row, note} | {noLink: true} */
  async function sendCopied(text) {
    const c = await labCtx();
    if (!c.on || !labUseOn(c.s, 'F33')) return { noLink: true };
    const item = textLinkItem(text, c.s);
    if (!item) return { noLink: true };
    return sendItem(item, undefined, { lab: c });
  }

  /** F26's "Send a test article": testArticle() as a page with x-cap "test", followed by Setup check. -> {row} */
  async function sendTest() {
    const c = await labCtx();
    if (!c.on) throw new ds.ShareError('lab', LAB_TEXT.labOff.replace('{app}', LAB_TEXT.appName[target === 'safari' ? 'safari' : 'chrome']));
    const item = testArticle({ device: await deviceName() });
    const r = await sendItem(item, undefined, { lab: c });
    await storage.set(TEST_KEY, r.row.id);
    return r;
  }

  /**
   * What the popup needs about its tab before it offers anything (F04, F10, F11): whether the extension can read it,
   * whether text is selected (F11's, so with F10's Use switch off too: LAB-PROTOCOL 2.9.6), and the Send as mode by
   * context (with F10's switch off, the page as you see it, or the PDF). -> {readable, selection, pdf, mode, url, site}
   */
  async function tabInfo(tabId) {
    const c = await labCtx();
    let tab = null;
    try { tab = await api.tabs.get(tabId); } catch { tab = null; }
    const url = tab?.url || tab?.pendingUrl || '';
    let info = null;
    if (tab) { try { info = await inject(tab.id, pageInfo, []); } catch { info = null; } }
    const pdf = looksLikePdfUrl(url) || info?.contentType === 'application/pdf';
    const selection = !!info?.selection;
    let remembered = {};
    try { remembered = (await storage.get(SEND_AS_KEY)) ?? {}; } catch { /* none */ }
    const sendAs = c.on && labUseOn(c.s, 'F10');
    return {
      readable: !!info, selection: c.on && selection, pdf, url, site: siteOf(url),
      mode: sendAs ? defaultMode({ selection, pdf, url, remembered }) : (pdf ? 'pdf' : 'page'),
    };
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

  /**
   * The right-click menu. With Lab off: v1.1's three entries. With Lab on (F34): page (as you see it), clean article,
   * link, selection (F11), an image's page (the page, not the image) and PDF link; links go through normaliseShare.
   */
  async function onMenu(info, tab) {
    try {
      if (!(await getPairing())) return await openPairing();
      const c = await labCtx();
      if (info.menuItemId === MENU.page) return await withBadge(() => sendTab(tab, { prompt: true }));
      if (info.menuItemId === MENU.link) {
        const title = await titleOfLink(tab, info);
        return await withBadge(() => sendUrl(info.linkUrl, title));
      }
      if (info.menuItemId === MENU.pdfLink) {
        const title = await titleOfLink(tab, info);
        return await withBadge(() => sendPdf({ url: info.linkUrl, title, tabId: tab?.id ?? null, frameId: info.frameId, prompt: true }));
      }
      if (!c.on) return undefined; // Lab's entries do nothing with Lab off (they are gone from the menu)
      if (info.menuItemId === MENU.clean) return await withBadge(() => sendTab(tab, { mode: 'clean', explicit: true, prompt: true, thin: 'page' }));
      if (info.menuItemId === MENU.image) return await withBadge(() => sendTab(tab, { mode: 'page', prompt: true }));
      if (info.menuItemId === MENU.selection) return await withBadge(async () => (await labSendSelection(tab, { lab: c, info })) ?? {});
    } catch (e) {
      log.warn?.('Send to Daylight:', e?.message ?? e);
    }
    return undefined;
  }

  /** Keyboard shortcuts: send-page in every build; with Lab on (F34) also send-selection, send-clean and send-link. */
  async function onCommand(command, tab) {
    const lab = { [COMMANDS.selection]: 'selection', [COMMANDS.clean]: 'clean', [COMMANDS.link]: 'link' }[command];
    if (command !== COMMAND_SEND && !lab) return undefined;
    try {
      const c = await labCtx();
      if (lab && !c.on) return undefined;
      if (!tab) [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!(await getPairing())) return await openPairing();
      if (lab === 'selection') return await withBadge(async () => (await labSendSelection(tab, { lab: c })) ?? {});
      if (lab) return await withBadge(() => sendTab(tab, { mode: lab, explicit: true, prompt: true, thin: 'page' }));
      return await withBadge(() => sendTab(tab, { prompt: true }));
    } catch (e) {
      log.warn?.('Send to Daylight:', e?.message ?? e);
      return undefined;
    }
  }

  /**
   * Chrome's omnibox (F34): "dl example.com/story" sends that link (typedUrl, then normaliseShare through sendUrl);
   * anything else typed is text, which goes to normaliseShare whole (textLinkItem, F16), so "dl see (https://…)." finds
   * the URL by smart intake's rules and the words around it are the title. With Lab off it opens lab.html with the
   * Lab-off sentence; a text with no web address sends nothing and shows "!".
   */
  async function onOmnibox(text) {
    try {
      const c = await labCtx();
      if (!c.on) {
        await api.tabs.create({ url: api.runtime.getURL('lab.html#lab-off') });
        return { labOff: true };
      }
      if (!(await getPairing())) { await openPairing(); return { paired: false }; }
      const url = typedUrl(text);
      if (url) return await withBadge(() => sendUrl(url, ''));
      const item = textLinkItem(text, c.s);
      if (!item) { await badge.show(LAB_TEXT.badge.error); return { noLink: true }; }
      return await withBadge(() => sendItem(item, undefined, { lab: c }));
    } catch (e) {
      log.warn?.('Send to Daylight:', e?.message ?? e);
      return undefined;
    }
  }

  async function onAlarm(alarm) {
    if (alarm?.name === ALARM_TICK || alarm?.name === ALARM_SOON) await tick();
    if (alarm?.name === OFFLINE_ALARM) await offlinePass();
  }

  /** The user granted a site from the popup's prompt; if the popup closed meanwhile, send the PDF from here. */
  async function onPermissionsAdded(perms) {
    const p = pendingPdf;
    if (!p || now() - p.at > PENDING_PDF_MS || !perms?.origins?.some((o) => p.origins.includes(o))) return;
    // Let the popup claim it first if it is still open.
    await new Promise((r) => setTimeout(r, 1500));
    if (claim(p.token)) await withBadge(() => sendPdf({ url: p.url, title: p.title, asked: true })).catch(() => {});
  }

  /** The right-click menu for the Lab switch and F34's "Show in the right-click menu" boxes (settings.labMenus). */
  async function setupMenus() {
    const menus = api.contextMenus ?? api.menus;
    if (!menus?.create) return;
    try { await menus.removeAll(); } catch { /* ignore */ }
    const create = (props) => new Promise((resolve) => {
      try { menus.create(props, () => { void api.runtime.lastError; resolve(); }); } catch { resolve(); }
    });
    const c = await labCtx();
    for (const m of menuEntries({ lab: c.on, menus: c.s.labMenus })) {
      const props = { id: m.id, title: m.title, contexts: m.contexts };
      if (m.targetUrlPatterns) props.targetUrlPatterns = m.targetUrlPatterns;
      await create(props);
    }
  }

  async function ensureAlarms() {
    if (!api.alarms) return;
    try {
      if (!(await api.alarms.get(ALARM_TICK))) api.alarms.create(ALARM_TICK, { delayInMinutes: 1, periodInMinutes: 15 });
    } catch { /* ignore */ }
  }

  /** Browser start or install/update: Lab's default, menus, alarm, a Safari app pairing, then acks and re-sends. */
  async function start() {
    await lab.ensureDefault();
    await setupMenus();
    await ensureAlarms();
    await pairFromApp();
    await tick().catch(() => {});
    if ((await labCtx()).on) await offlinePass().catch(() => {});
  }

  /**
   * storage.onChanged in the background: the Lab switch or F34's menu boxes changed, wherever that happened (lab.html,
   * the popup, a test's seeded settings), so the menus and the alarms follow.
   */
  function onStorageChanged(changes, area) {
    if (area !== 'local' || !changes?.settings || !labBuilt) return;
    const was = changes.settings.oldValue ?? {}, is = changes.settings.newValue ?? {};
    if ((was.lab !== false) !== (is.lab !== false) || JSON.stringify(was.labMenus ?? {}) !== JSON.stringify(is.labMenus ?? {})) {
      labSettingsChanged().catch(() => {});
    }
  }

  /** Lab settings that change what the background does: the switch and the menus. */
  async function labSettingsChanged() {
    await setupMenus();
    const c = await labCtx();
    if (!c.on) { await clearOfflineAlarm(); for (const id of [...scheduled.keys()]) cancelScheduled(id); return; }
    await offlinePass().catch(() => {});
  }

  async function onMessage(msg) {
    switch (msg?.type) {
      case 'state': return state();
      case 'pair': return pair(msg);
      case 'unpair': return unpair();
      case 'setName': return setDeviceName(msg.from);
      case 'setComfort': return setComfort(msg.comfort);
      case 'sendTab': {
        const tab = await api.tabs.get(msg.tabId);
        if (!(await labCtx()).on) return withBadge(() => sendTab(tab, { linkOnly: !!msg.linkOnly }));
        // The popup (Lab): F10's mode, the thin-page question, the mode kept for the site, Review.
        return withBadge(() => sendTab(tab, {
          linkOnly: !!msg.linkOnly, mode: msg.mode ?? 'page', explicit: !!msg.mode, force: !!msg.force, thin: 'ask',
          remember: !!msg.mode && !msg.linkOnly, review: !msg.linkOnly && msg.review !== false,
        }));
      }
      case 'sendPdf':
        if (!claim(msg.token)) return { handled: true }; // permissions.onAdded already sent it
        return withBadge(() => sendPdf({ url: msg.url, title: msg.title, asked: true }));
      case 'retry': return withBadge(() => retry(msg.id));
      case 'remove': return remove(msg.id);
      case 'tick': return tick();
      case 'clearBadge': await badge.clear(); return {};
      // Lab, Wave 1 (each one refuses or does nothing with Lab off)
      case 'labTabInfo': return tabInfo(msg.tabId);
      case 'labScheduleSend': return scheduleSend(msg.tabId, { mode: msg.mode });
      case 'labCancelScheduled': return cancelScheduled(msg.tabId);
      case 'labHoldPdf': return holdPdf(String(msg.token ?? ''));
      case 'labSendCopied': return withBadge(() => sendCopied(msg.text));
      case 'labTestSend': return withBadge(() => sendTest());
      case 'labCheckAcks': return checkAcksNow();
      case 'labOnline': return { attempted: (await offlinePass()).length };
      case 'labReviewGet': return reviewGet(String(msg.token ?? ''));
      case 'labReviewSend': return withBadge(() => reviewSend(String(msg.token ?? ''), msg.title));
      case 'labReviewCancel': return reviewCancel(String(msg.token ?? ''));
      case 'labOmnibox': return onOmnibox(msg.text);
      default: {
        const r = await lab.onMessage(msg);
        if (r === undefined) throw new ds.ShareError('message', `unknown message ${msg?.type}`);
        // (storage.onChanged follows the switch and the menu boxes too; this makes the answer wait for it.)
        if (msg?.type === 'setLab' || msg?.type === 'labSetOption') await labSettingsChanged();
        return r;
      }
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
    storage, state, pair, unpair, setDeviceName, setComfort, pairFromApp, sendTab, sendPdf, sendUrl, retry, remove, tick, start,
    setupMenus, ensureAlarms, onMenu, onCommand, onAlarm, onPermissionsAdded, onMessage, handleMessage,
    getSender, getPairing, claim, lab,
    // Lab, Wave 1
    onOmnibox, scheduleSend, cancelScheduled, offlinePass, labBadge, sendCopied, sendTest, tabInfo, checkAcksNow,
    labSettingsChanged, onStorageChanged,
  };
}
