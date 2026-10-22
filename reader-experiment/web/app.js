// The web sender: pair with a Daylight, send links and files, see what arrived. Runs on any modern browser; an iPhone
// Shortcut or Android's share sheet (when installed) hands it a link with ?url=…&autosend=1 or #…&url=….

import * as ds from './daylight-share.js';
import { statusInfo, rowMessage, kindLabel, displayTitle, relativeTime, titleFromName, maintain, relayForInput } from './logic.js';
import { readParams, hasShareParams, sharedLink, normalizeUserUrl, mimeFor, deviceName, shortcutPrefix, serial } from './web-logic.js';
import { openStorage, takeShared, pruneShared } from './web-storage.js';
import { createWebLab, labTestHook, withoutLabParam } from './web-lab.js';
import { createLabPage, LAB_VIEWS } from './web-lab-page.js';

const VERSION = '1.1.0';
const APP = `web/${VERSION}`;
const HISTORY_SHOWN = 8;
const TICK_MS = 60 * 1000;
/** CHANGES-v1.1 2.5: a shared file the device had no room to keep (the share target's copy failed). */
const NO_SPACE = 'This device is out of space, so it can’t send this.';

const $ = (id) => document.getElementById(id);
const local = serial();
const lock = (fn) => (navigator.locks?.request ? navigator.locks.request('send-to-daylight-outbox', () => fn()) : local(fn));
const channel = 'BroadcastChannel' in self ? new BroadcastChannel('send-to-daylight') : null;

let storage = null;
let db = null;
let lab = null; // Lab (web-lab.js): the switch, the ledger, the gates and the Daylight server
let labPage = null; // its screens (web-lab-page.js)
const settingsRun = serial(); // Lab's settings writes, one at a time
let pairing = null;
let settings = {};
let sender = null;
let rows = [];
let pendingShare = null;
let pendingAsk = null; // the open pairing question: {resolve(yes)}
let unpairArmed = null;
let backTo = 'view-send'; // the view Settings' Back returns to
const lastStatus = new Map(); // row id -> the status last shown, to announce changes (F27)
const defaultFrom = deviceName(navigator.userAgent, navigator.maxTouchPoints);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function setStatus(text, tone = '') {
  const s = $('view-send').hidden ? $('pair-error') : $('status'); // the pairing view shows messages in its error line
  s.textContent = text || '';
  s.dataset.tone = tone;
}

function show(view) {
  for (const v of ['view-pair', 'view-confirm', 'view-send', 'view-settings', ...LAB_VIEWS]) $(v).hidden = v !== view;
  // Settings (Comfort among them) is one tap away before pairing too.
  $('open-settings').hidden = view !== 'view-send' && view !== 'view-pair';
}

// --- accessibility (F27, not Lab) -----------------------------------------------------------------------------------

/** Comfort: the comfort class on <body> (styles.css): larger text and buttons, more contrast, no motion. */
function applyComfort(on) {
  document.body.classList.toggle('comfort', !!on);
  $('comfort').checked = !!on;
}

/** settings.comfort, off by default; pairing, unpairing and Lab leave it as it is. Other open tabs follow. */
async function onComfort() {
  const want = $('comfort').checked;
  applyComfort(want);
  try {
    settings = { ...((await storage.get('settings')) ?? {}), comfort: want };
    await storage.set('settings', settings);
    channel?.postMessage('changed');
  } catch {
    applyComfort(!want);
  }
}

/** Says a history row's new state to screen readers (the row itself changes without moving focus). */
function announce(text) {
  const a = $('announce');
  a.textContent = '';
  // A fresh text node after a tick, so the same words twice are still read.
  setTimeout(() => { a.textContent = text; }, 50);
}

// --- state ----------------------------------------------------------------------------------------------------------

async function loadState() {
  pairing = await ds.loadPairing(storage).catch(() => null);
  settings = (await storage.get('settings')) ?? {};
  // Every ack-topic frame that decrypts feeds the Lab ledger, Lab on or off (LAB-PLAN 2.2.6).
  sender = pairing ? new ds.Sender({ pairing, storage, from: settings.from || defaultFrom, app: APP, onAckHeader: lab?.hook }) : null;
  applyComfort(settings.comfort);
  labPage?.apply(settings);
}

async function loadRows() {
  rows = (await storage.get('outbox')) ?? [];
  renderHistory();
}

function changed() {
  channel?.postMessage('changed');
  return loadRows();
}

/**
 * Saves a pairing (PROTOCOL 3.3 step 6, through the protocol module): the same code with a new relay or name keeps the
 * outbox, whose items then go through the new relay; another code deletes it. expect: the code in use when the user was
 * asked ('' for none); when it changed since, nothing is saved. from: this device's name, when given.
 */
async function applyPairing(next, { from, expect } = {}) {
  const p = { ...next };
  await lock(async () => {
    const current = await ds.loadPairing(storage).catch(() => null);
    if (expect !== undefined && (current?.code ?? '') !== expect) {
      throw new ds.ShareError('pairing', 'The pairing changed in the meantime. Try again.');
    }
    // A typed code, or a link without a name, for the Daylight already paired keeps the name it has.
    if (!ds.cleanName(p.name) && current && ds.samePairingSecret(current, p)) p.name = current.name;
    // Another Daylight: a Daylight server that knows this pairing is locked first (LAB-PLAN 2.6), Lab on or off.
    const repair = lab ? await lab.beforeRepair(current, p) : { known: false };
    await ds.applyPairingChange(storage, current, p);
    await ds.savePairing(storage, p);
    if (repair.known) await lab.afterRepair();
    if (from != null) await storage.set('settings', { ...((await storage.get('settings')) ?? {}), from: ds.cleanName(from) });
  });
  await loadState();
  await changed();
}

/**
 * Asks on a sheet in the page, in the protocol module's words (pairingConfirmation): its title and lines, its button
 * ("Pair", or "Switch" when it replaces another Daylight) and Cancel. -> true on the button. A new question answers
 * one still open with Cancel (its caller then leaves the view alone: pendingAsk is set). The caller shows the next
 * view.
 */
function askPairing(c) {
  pendingAsk?.resolve(false);
  show('view-confirm');
  $('confirm-h').textContent = c.title;
  const box = $('confirm-lines');
  box.textContent = '';
  for (const line of c.lines) {
    const p = el('p', 'confirm-line');
    // The code's first group is what the user compares with the Daylight's screen.
    const m = /^(Code starts )(\S+?)(\..*)$/.exec(line);
    if (m) p.append(m[1], el('strong', 'code-start', m[2]), m[3]); else p.textContent = line;
    box.append(p);
  }
  $('confirm-yes').textContent = c.button;
  // Replacing a pairing loses what wasn't delivered: Enter then means Cancel.
  (c.button === 'Switch' ? $('confirm-no') : $('confirm-yes')).focus();
  return new Promise((resolve) => {
    const ask = { resolve: (yes) => { if (pendingAsk === ask) pendingAsk = null; resolve(yes); } };
    pendingAsk = ask;
  });
}

// --- pairing --------------------------------------------------------------------------------------------------------

/**
 * The pairing form: when nothing is paired, or from Settings > "Change pairing…" (then with a way back). fresh: a new
 * visit (not a return from the question), which sets Advanced > Relay URL to the relay in use, so that typing the
 * same Daylight's code again (to rename this device, say) keeps a self-hosted relay instead of moving to ntfy.sh.
 */
function renderPair({ fresh = false } = {}) {
  show('view-pair');
  $('pair-back').hidden = !pairing;
  $('from').placeholder = defaultFrom;
  if (fresh) {
    const own = pairing && pairing.relay !== ds.DEFAULT_RELAY ? pairing.relay : '';
    $('relay').value = own;
    $('advanced').open = !!own;
  }
  const n = $('pending-share');
  n.hidden = !pendingShare;
  if (pendingShare) {
    const what = pendingShare.files?.length ? `${pendingShare.files.length === 1 ? 'Your file' : 'Your files'}` : 'Your link';
    n.textContent = `${what} will be sent as soon as this browser is paired.`;
  }
}

/**
 * The page's own pairing form (PROTOCOL 1.3: a typed or pasted code or link): pairs at once, unless it would replace a
 * Daylight with a different code; then it asks first. Advanced > Relay URL applies to a typed code; a link names its
 * own relay.
 */
async function onPair(ev) {
  ev.preventDefault();
  const err = $('pair-error');
  err.textContent = '';
  const input = $('code').value.trim();
  if (!input) { err.textContent = 'Type the code shown on your Daylight, or paste its pairing link.'; $('code').focus(); return; }
  const btn = $('pair-btn');
  btn.disabled = true;
  btn.textContent = 'Pairing…';
  try {
    const next = await ds.parsePairing(input);
    next.relay = relayForInput(next, input, $('relay').value);
    const expect = pairing?.code ?? '';
    const c = ds.pairingConfirmation(pairing, next, { source: 'app' });
    if (c.ask && !(await askPairing(c))) { if (!pendingAsk) renderPair(); return; } // Cancel: back to the form as it was
    await applyPairing(next, { from: $('from').value, expect });
    $('code').value = '';
    await renderSend({ sayRepaired: true });
    setStatus(c.notice || `Paired with ${pairing.name || 'your Daylight'}.`, 'ok');
    if (pendingShare) { const s = pendingShare; pendingShare = null; await sendShare(s); }
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Pair';
  }
}

/**
 * #pair=<link or code>, from a link or the iPhone Shortcut (every time it runs): a pairing from outside the page, so it
 * asks first (PROTOCOL 1.3), unless it is the Daylight already paired (a new relay or name applies at once). -> paired?
 */
async function pairFromParam(value) {
  let next;
  try { next = await ds.parsePairing(value); } catch (e) { setStatus(`The pairing in this link didn’t work: ${e.message}`, 'bad'); return false; }
  const expect = pairing?.code ?? '';
  const c = ds.pairingConfirmation(pairing, next, { source: 'link' });
  if (c.ask && !(await askPairing(c))) {
    if (pendingAsk) return false; // another question took its place
    if (pairing) { await renderSend(); setStatus(`Still sending to ${pairing.name || 'your Daylight'}.`); } else renderPair();
    return false;
  }
  try {
    await applyPairing(next, { expect });
  } catch (e) {
    if (pairing) await renderSend(); else renderPair();
    setStatus(e.message, 'bad');
    return false;
  }
  await renderSend({ sayRepaired: true });
  setStatus(c.notice || `Paired with ${pairing.name || 'your Daylight'}.`, 'ok');
  return true;
}

// --- sending --------------------------------------------------------------------------------------------------------

function afterSend() {
  // Look for the Daylight's acknowledgement soon after sending (PROTOCOL 3.3), while the page is open.
  setTimeout(tick, 5000);
  setTimeout(tick, 30000);
}

async function sendLink(url, title) {
  const u = normalizeUserUrl(url);
  if (!u) throw new ds.ShareError('url', 'That isn’t a web address. It should look like https://example.com/story.');
  const row = await lock(() => sender.send({ kind: 'url', url: u, title }));
  afterSend();
  await changed();
  return row;
}

async function sendFile(file) {
  if (file.noSpace) throw new ds.ShareError('storage', NO_SPACE);
  // One limit for every relay (protocol 1.1), checked before the file is read. A file shared to the installed app
  // over it arrives as {name, size} only (sw.js never copies it).
  if (file.size > ds.MAX_ITEM) throw new ds.ShareError('too-large', ds.tooBigMessage(file.size));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name || 'document';
  const row = await lock(() => sender.send({ kind: 'file', name, mime: mimeFor(name, file.type), title: titleFromName(name), content: bytes }));
  afterSend();
  await changed();
  return row;
}

/**
 * The status after a share (CHANGES-v1.1 2.5): the row's label, then its sentence. results: outbox rows, or
 * {name, error} for a file that couldn't be sent. Several: one line when they all ended alike, else each one's.
 */
function describe(results) {
  // A row's own `error` is technical detail for logs; only {name, error} entries (no id) show theirs.
  const isRow = (r) => typeof r.id === 'string';
  const say = (r) => (isRow(r) ? rowMessage(r) : r.error);
  const tone = results.some((r) => !isRow(r) || r.status === 'expired') ? 'bad'
    : results.every((r) => r.status === 'sent' || r.status === 'delivered') ? 'ok' : '';
  if (results.length === 1) return { text: say(results[0]), tone };
  const said = [...new Set(results.map(say))];
  if (said.length === 1) return { text: `${results.length} items. ${said[0]}`, tone };
  return { text: results.map((r) => `${isRow(r) ? displayTitle(r) : r.name}: ${say(r)}`).join(' '), tone };
}

async function withBusy(label, fn) {
  $('app').setAttribute('aria-busy', 'true');
  for (const id of ['send-url', 'file']) $(id).disabled = true;
  setStatus(label);
  try {
    const sent = await fn();
    const m = describe(sent);
    setStatus(m.text, m.tone);
    return sent;
  } catch (e) {
    setStatus(e.message ?? String(e), 'bad');
    return [];
  } finally {
    for (const id of ['send-url', 'file']) $(id).disabled = false;
    $('app').setAttribute('aria-busy', 'false');
  }
}

async function onSendUrl(ev) {
  ev.preventDefault();
  const sent = await withBusy('Sending…', async () => [await sendLink($('url').value, $('title').value)]);
  if (sent.length && sent[0].status !== 'failed' && sent[0].status !== 'expired') { $('url').value = ''; $('title').value = ''; }
}

async function sendFiles(list) {
  const files = [...list].filter((f) => f && f.size >= 0);
  if (!files.length) return [];
  return withBusy(files.length > 1 ? `Sending ${files.length} files…` : `Sending “${files[0].name}”…`, async () => {
    if (files.length === 1) return [await sendFile(files[0])];
    const out = [];
    for (const f of files) {
      try { out.push(await sendFile(f)); } catch (e) { out.push({ name: f.name || 'document', error: e.message ?? String(e) }); }
    }
    return out;
  });
}

/** A share from a Shortcut, a link or the Android share sheet: {url, title, files}. */
async function sendShare(share) {
  if (share.files?.length) return sendFiles(share.files); // the files are the content; a link alongside is their source
  if (share.url) return withBusy('Sending…', async () => [await sendLink(share.url, share.title)]);
  return [];
}

async function retry(id, button) {
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const row = await lock(() => sender.retry(id));
    if (row) {
      const m = describe([row]);
      setStatus(m.text, m.tone);
      afterSend();
    }
  } catch (e) { setStatus(e.message, 'bad'); }
  await changed();
}

/** "Remove": the row and its stored content. */
async function remove(id, button) {
  button.disabled = true;
  try { await lock(() => sender.remove(id)); } catch (e) { setStatus(e.message, 'bad'); }
  await changed();
}

/**
 * Acks and re-sends (PROTOCOL 3.3, logic.maintain): the local re-send pass always runs (it ends week-old rows and
 * drops expired rows' content after 14 days); the ack topic is read only while a row could still be acked.
 */
async function tick() {
  if (!sender) return;
  const s = sender;
  try { await lock(() => maintain(s)); } catch { /* offline: next time */ }
  await lab?.prune();
  await changed();
  labPage?.ledgerChanged();
}

// --- rendering ------------------------------------------------------------------------------------------------------

function renderHistory() {
  const list = $('history');
  list.textContent = '';
  const shown = rows.slice(0, HISTORY_SHOWN);
  $('recent-h').hidden = shown.length === 0;
  const changed = [];
  for (const row of rows) {
    const was = lastStatus.get(row.id);
    // Delivered, Waiting to send and Not delivered are said when a row reaches them; a send's own outcome is in #status.
    if (was && was !== row.status && ['delivered', 'failed', 'expired'].includes(row.status)) changed.push(row);
    lastStatus.set(row.id, row.status);
  }
  if (changed.length) announce(changed.map((r) => `${statusInfo(r).label}: ${displayTitle(r)}`).join('. '));
  for (const row of shown) {
    const li = el('li');
    li.dataset.id = row.id;
    li.dataset.status = row.status;
    const line = el('div', 'item-line');
    const title = el('span', 'item-title', displayTitle(row));
    title.title = row.url || row.name || '';
    line.append(el('span', 'kind', kindLabel(row)), title);
    // The protocol library's words (describeRow): the same label, sentence and button in every Send to Daylight app.
    const info = statusInfo(row);
    const meta = el('div', 'item-meta');
    meta.append(el('span', `st ${info.tone}`, info.label), el('span', 'when', `· ${relativeTime(row.created)}`));
    if (sender) {
      const acts = el('span', 'acts');
      if (info.retry) {
        const b = el('button', 'retry', info.retry);
        b.type = 'button';
        b.setAttribute('aria-label', `${info.retry}: ${displayTitle(row)}`);
        b.addEventListener('click', () => retry(row.id, b));
        acts.append(b);
      }
      const rm = el('button', 'remove', 'Remove');
      rm.type = 'button';
      rm.setAttribute('aria-label', `Remove: ${displayTitle(row)}`);
      rm.addEventListener('click', () => remove(row.id, rm));
      acts.append(rm);
      meta.append(acts);
    }
    li.append(line, meta);
    if (info.hint) li.append(el('p', `note sentence${info.tone === 'bad' ? ' bad' : ''}`, info.hint));
    list.append(li);
  }
}

async function renderSend({ sayRepaired = false } = {}) {
  show('view-send');
  $('daylight-name').textContent = pairing.name || 'your Daylight';
  await loadRows();
  await labPage?.loadRepaired({ say: sayRepaired });
}

/** Settings: the Settings button (openSettings) or ‹ Back from a Lab view. focus: the id of the control to focus. */
async function renderSettings({ focus = null } = {}) {
  show('view-settings');
  if (focus) $(focus)?.focus();
  $('comfort').checked = !!settings.comfort;
  labPage?.loadSubtitle();
  $('settings-paired').hidden = !pairing;
  if (!pairing) return;
  $('set-daylight').textContent = pairing.name || 'Your Daylight (no name given)';
  $('set-relay').textContent = pairing.relay.replace(/^https:\/\//, '');
  $('set-relay-2').textContent = pairing.relay.replace(/^https?:\/\//, '');
  $('set-from').value = settings.from || '';
  $('set-from').placeholder = defaultFrom;
  $('name-saved').textContent = '';
  const link = await ds.pairingLink({ secret: pairing.secret, relay: pairing.relay, name: pairing.name });
  $('shortcut-link').textContent = shortcutPrefix(location.href, link);
  $('copy-shortcut').textContent = 'Copy';
  unpairArmed = null;
  $('unpair').textContent = 'Unpair this device';
}

async function onCopyShortcut() {
  const text = $('shortcut-link').textContent;
  try {
    await navigator.clipboard.writeText(text);
    $('copy-shortcut').textContent = 'Copied';
  } catch {
    const r = document.createRange();
    r.selectNodeContents($('shortcut-link'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    $('copy-shortcut').textContent = 'Selected: copy it';
  }
}

async function onSaveName(ev) {
  ev.preventDefault();
  // What is stored now (the Lab switch may have changed since), with the new name.
  settings = { ...((await storage.get('settings')) ?? {}), from: ds.cleanName($('set-from').value) };
  await storage.set('settings', settings);
  await loadState();
  $('name-saved').textContent = `Saved. Items now show as sent from “${settings.from || defaultFrom}”.`;
}

async function onUnpair() {
  const b = $('unpair');
  if (!unpairArmed) {
    b.textContent = 'Tap again to unpair (unsent items are discarded)';
    unpairArmed = setTimeout(() => { unpairArmed = null; b.textContent = 'Unpair this device'; }, 5000);
    return;
  }
  clearTimeout(unpairArmed);
  unpairArmed = null;
  await lock(async () => {
    await ds.applyPairingChange(storage, await ds.loadPairing(storage).catch(() => null), null);
    await storage.remove('pairing');
  });
  await loadState();
  rows = [];
  renderPair({ fresh: true });
  channel?.postMessage('changed');
}

// --- start ----------------------------------------------------------------------------------------------------------

/** Reads a share from the page address (and the service worker's store), then removes it from the address. */
async function takeShareFromAddress() {
  const params = readParams(location.search, location.hash);
  if (!hasShareParams(params)) return { params, share: null };
  history.replaceState(null, '', location.pathname); // so a reload doesn't send it again
  let share = null;
  if (params.share) {
    const e = await takeShared(db, params.share).catch(() => null);
    if (e) {
      // sw.js keeps the bytes of files the page can send; for others ({name, size}, maybe noSpace) the page says why.
      const files = (e.files ?? []).map((f) => {
        if (f.blob instanceof File) return f.blob;
        if (f.blob) return new File([f.blob], f.name || 'document', { type: f.type || '' });
        return { name: f.name || 'document', type: f.type || '', size: Number(f.size) || 0, noSpace: !!f.noSpace };
      });
      const link = sharedLink({ url: e.url, text: e.text, title: e.title });
      share = { url: link.url, title: link.title, files };
    }
  } else if (params.url || params.text || params.title) {
    const link = sharedLink(params);
    share = { url: link.url ?? params.url ?? '', title: link.title, files: [] };
  }
  return { params, share };
}

async function handleAddress() {
  const { params, share } = await takeShareFromAddress();
  if (params.pair) await pairFromParam(params.pair);
  if (!share) return;
  if (!pairing) {
    if (params.autosend || params.share) pendingShare = share;
    if (share.url) $('url').value = share.url;
    renderPair();
    return;
  }
  await renderSend();
  $('url').value = share.url || '';
  $('title').value = share.title || '';
  if (params.autosend || params.share) {
    const sent = await sendShare(share);
    if (sent.length && sent.every((r) => r.status === 'sent' || r.status === 'delivered')) { $('url').value = ''; $('title').value = ''; }
  }
}

function wire() {
  $('pair-form').addEventListener('submit', onPair);
  $('pair-back').addEventListener('click', () => renderSend());
  $('repair').addEventListener('click', () => { $('pair-error').textContent = ''; renderPair({ fresh: true }); });
  $('confirm-yes').addEventListener('click', () => pendingAsk?.resolve(true));
  $('confirm-no').addEventListener('click', () => pendingAsk?.resolve(false));
  $('url-form').addEventListener('submit', onSendUrl);
  $('file').addEventListener('change', async (e) => { const input = e.target; await sendFiles(input.files); input.value = ''; });
  $('open-settings').addEventListener('click', () => {
    backTo = $('view-pair').hidden ? 'view-send' : 'view-pair';
    renderSettings();
  });
  $('close-settings').addEventListener('click', () => (backTo === 'view-pair' || !pairing ? renderPair() : renderSend()));
  $('comfort').addEventListener('change', onComfort);
  $('name-form').addEventListener('submit', onSaveName);
  $('unpair').addEventListener('click', onUnpair);
  $('copy-shortcut').addEventListener('click', onCopyShortcut);
  const drop = $('drop');
  for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const t of ['dragleave', 'drop']) drop.addEventListener(t, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); if (sender) sendFiles(e.dataTransfer?.files ?? []); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('hashchange', async () => {
    await handleAddress();
    if (!pairing) renderPair();
  });
  channel?.addEventListener('message', async () => {
    await loadState();
    if (pairing) await loadRows();
    labPage?.ledgerChanged();
    if (!$('view-send').hidden) await labPage?.loadRepaired();
  });
}

/**
 * Lab (LAB-PLAN 1): the switch (missing means on: the first start writes true), the test hook ?lab=0|1 on 127.0.0.1
 * (1.7), and the screens. Discovery and server calls run only with Lab on; the ledger learns either way.
 */
async function startLab() {
  lab = createWebLab({
    storage, run: settingsRun, getPairing: () => ds.loadPairing(storage), getSettings: () => storage.get('settings'),
    deviceName: async () => settings.from || defaultFrom, appId: APP,
    // What's in Lab opening reads the ack topic (1.4). An ack it finds delivers rows, so the history (announcing
    // Delivered) and the other tabs follow at once, as after a tick, not only when the send view is drawn again.
    refreshAcks: async () => {
      if (!sender) return;
      const s = sender;
      await lock(() => s.checkAcks());
      await changed();
    },
  });
  labPage = createLabPage({
    lab, $, show,
    toSettings: ({ focus } = {}) => renderSettings({ focus }),
    announce,
    changed: async () => { channel?.postMessage('changed'); await loadState(); },
    isPaired: () => !!pairing,
    afterRepairSeen: () => $('url').focus(),
  });
  labPage.wire();
  const hook = labTestHook(location);
  if (hook !== null) {
    await lab.setLab(hook);
    history.replaceState(null, '', withoutLabParam(location.href));
  }
  await lab.ensureDefault();
}

async function init() {
  wire();
  ({ storage, db } = await openStorage());
  await startLab();
  await loadState();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  pruneShared(db).catch(() => {});
  if (pairing) await renderSend(); else renderPair({ fresh: true });
  tick();
  setInterval(tick, TICK_MS);
  $('app').setAttribute('aria-busy', 'false');
  document.body.dataset.ready = '1';
  // A #pair= link may ask on the page and wait for the answer: the page is ready meanwhile.
  await handleAddress();
  if (storage.kind === 'memory') setStatus('This browser blocks site storage, so the pairing is forgotten when you close the page.', 'bad');
}

init().catch((e) => {
  setStatus(`Something went wrong: ${e.message ?? e}`, 'bad');
  document.body.dataset.ready = 'error';
});
