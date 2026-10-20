// The web sender: pair with a Daylight, send links and files, see what arrived. Runs on any modern browser; an iPhone
// Shortcut or Android's share sheet (when installed) hands it a link with ?url=…&autosend=1 or #…&url=….

import * as ds from './daylight-share.js';
import { statusInfo, rowMessage, kindLabel, displayTitle, relativeTime, isPending, titleFromName } from './logic.js';
import { readParams, hasShareParams, sharedLink, normalizeUserUrl, mimeFor, deviceName, shortcutPrefix, serial } from './web-logic.js';
import { openStorage, takeShared, pruneShared } from './web-storage.js';

const VERSION = '1.1.0';
const APP = `web/${VERSION}`;
const HISTORY_SHOWN = 8;
const TICK_MS = 60 * 1000;

const $ = (id) => document.getElementById(id);
const local = serial();
const lock = (fn) => (navigator.locks?.request ? navigator.locks.request('send-to-daylight-outbox', () => fn()) : local(fn));
const channel = 'BroadcastChannel' in self ? new BroadcastChannel('send-to-daylight') : null;

let storage = null;
let db = null;
let pairing = null;
let settings = {};
let sender = null;
let rows = [];
let pendingShare = null;
let unpairArmed = null;
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
  for (const v of ['view-pair', 'view-send', 'view-settings']) $(v).hidden = v !== view;
  $('open-settings').hidden = view !== 'view-send';
}

// --- state ----------------------------------------------------------------------------------------------------------

async function loadState() {
  pairing = await ds.loadPairing(storage).catch(() => null);
  settings = (await storage.get('settings')) ?? {};
  sender = pairing ? new ds.Sender({ pairing, storage, from: settings.from || defaultFrom, app: APP }) : null;
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
    await ds.applyPairingChange(storage, current, p);
    await ds.savePairing(storage, p);
    if (from != null) await storage.set('settings', { ...((await storage.get('settings')) ?? {}), from: ds.cleanName(from) });
  });
  await loadState();
  await changed();
}

/** Asks in the protocol module's words (pairingConfirmation): its title and lines; OK stands for its button. */
function confirmPairing(c) {
  return window.confirm([c.title, ...c.lines].join('\n\n'));
}

// --- pairing --------------------------------------------------------------------------------------------------------

/** The pairing form: when nothing is paired, or from Settings > "Change pairing…" (then with a way back). */
function renderPair() {
  show('view-pair');
  $('pair-back').hidden = !pairing;
  $('from').placeholder = defaultFrom;
  const n = $('pending-share');
  n.hidden = !pendingShare;
  if (pendingShare) {
    const what = pendingShare.files?.length ? `${pendingShare.files.length === 1 ? 'Your file' : 'Your files'}` : 'Your link';
    n.textContent = `${what} will be sent as soon as this browser is paired.`;
  }
}

/**
 * The page's own pairing form (PROTOCOL 1.3: a typed or pasted code or link): pairs at once, unless it would replace a
 * Daylight with a different code; then it asks first.
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
    const relay = $('relay').value.trim();
    if (relay) next.relay = ds.normalizeRelay(relay);
    const c = ds.pairingConfirmation(pairing, next, { source: 'app' });
    if (c.ask && !confirmPairing(c)) return;
    await applyPairing(next, { from: $('from').value, expect: pairing?.code ?? '' });
    $('code').value = '';
    await renderSend();
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
  const c = ds.pairingConfirmation(pairing, next, { source: 'link' });
  if (c.ask && !confirmPairing(c)) {
    if (pairing) setStatus(`Still sending to ${pairing.name || 'your Daylight'}.`);
    return false;
  }
  try {
    await applyPairing(next, { expect: pairing?.code ?? '' });
  } catch (e) { setStatus(e.message, 'bad'); return false; }
  await renderSend();
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
  // One limit for every relay (protocol 1.1), checked before the file is read.
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

/** Acks and re-sends (PROTOCOL 3.3); stays off the relay when nothing is waiting. */
async function tick() {
  if (!sender) return;
  try {
    await lock(async () => {
      if (!((await sender.list()).some(isPending))) return;
      await sender.tick();
    });
  } catch { /* offline: next time */ }
  await changed();
}

// --- rendering ------------------------------------------------------------------------------------------------------

function renderHistory() {
  const list = $('history');
  list.textContent = '';
  const shown = rows.slice(0, HISTORY_SHOWN);
  $('recent-h').hidden = shown.length === 0;
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

async function renderSend() {
  show('view-send');
  $('daylight-name').textContent = pairing.name || 'your Daylight';
  await loadRows();
}

async function renderSettings() {
  show('view-settings');
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
  settings = { ...settings, from: ds.cleanName($('set-from').value) };
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
  renderPair();
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
      const files = (e.files ?? []).map((f) => (f.blob instanceof File ? f.blob : new File([f.blob], f.name || 'document', { type: f.type || '' })));
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
  $('repair').addEventListener('click', () => { $('pair-error').textContent = ''; renderPair(); });
  $('url-form').addEventListener('submit', onSendUrl);
  $('file').addEventListener('change', async (e) => { const input = e.target; await sendFiles(input.files); input.value = ''; });
  $('open-settings').addEventListener('click', renderSettings);
  $('close-settings').addEventListener('click', () => renderSend());
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
  channel?.addEventListener('message', async () => { await loadState(); if (pairing) await loadRows(); });
}

async function init() {
  wire();
  ({ storage, db } = await openStorage());
  await loadState();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  pruneShared(db).catch(() => {});
  if (pairing) await renderSend(); else renderPair();
  await handleAddress();
  if (storage.kind === 'memory') setStatus('This browser blocks site storage, so the pairing is forgotten when you close the page.', 'bad');
  tick();
  setInterval(tick, TICK_MS);
  $('app').setAttribute('aria-busy', 'false');
  document.body.dataset.ready = '1';
}

init().catch((e) => {
  setStatus(`Something went wrong: ${e.message ?? e}`, 'bad');
  document.body.dataset.ready = 'error';
});
