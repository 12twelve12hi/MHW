// The web sender: pair with a Daylight, send links and files, see what arrived. Runs on any modern browser; an iPhone
// Shortcut or Android's share sheet (when installed) hands it a link with ?url=…&autosend=1 or #…&url=….

import * as ds from './daylight-share.js';
import { statusInfo, kindLabel, displayTitle, relativeTime, isPending, titleFromName } from './logic.js';
import { readParams, hasShareParams, sharedLink, normalizeUserUrl, mimeFor, deviceName, shortcutPrefix, serial } from './web-logic.js';
import { openStorage, takeShared, pruneShared } from './web-storage.js';

const VERSION = '1.0.0';
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

async function clearOutbox() {
  for (const r of (await storage.get('outbox')) ?? []) await storage.remove(`outbox/${r.id}`);
  await storage.remove('outbox');
  await storage.remove('ackSince');
}

async function savePairing(p, from) {
  await lock(async () => {
    const old = await ds.loadPairing(storage).catch(() => null);
    if (old && (old.code !== p.code || old.relay !== p.relay)) await clearOutbox();
    if (!p.name && old?.code === p.code) p.name = old.name;
    await ds.savePairing(storage, p);
    if (from != null) await storage.set('settings', { ...settings, from: ds.cleanName(from) });
  });
  await loadState();
  await changed();
}

// --- pairing --------------------------------------------------------------------------------------------------------

function renderPair() {
  show('view-pair');
  $('from').placeholder = defaultFrom;
  const n = $('pending-share');
  n.hidden = !pendingShare;
  if (pendingShare) {
    const what = pendingShare.files?.length ? `${pendingShare.files.length === 1 ? 'Your file' : 'Your files'}` : 'Your link';
    n.textContent = `${what} will be sent as soon as this browser is paired.`;
  }
}

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
    const p = await ds.parsePairing(input);
    const relay = $('relay').value.trim();
    if (relay) p.relay = ds.normalizeRelay(relay);
    await savePairing(p, $('from').value);
    $('code').value = '';
    await renderSend();
    setStatus(`Paired with ${pairing.name || 'your Daylight'}.`, 'ok');
    if (pendingShare) { const s = pendingShare; pendingShare = null; await sendShare(s); }
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Pair';
  }
}

/** #pair=<link or code>: pair in one tap from a link (or from the iPhone Shortcut, every time it runs). */
async function pairFromParam(value) {
  let p;
  try { p = await ds.parsePairing(value); } catch (e) { setStatus(`The pairing in this link didn’t work: ${e.message}`, 'bad'); return; }
  if (pairing && pairing.code === p.code && pairing.relay === p.relay) {
    if (p.name && p.name !== pairing.name) await savePairing(p);
    return;
  }
  if (pairing && !window.confirm(`Send to ${p.name || 'this Daylight'} from now on, instead of ${pairing.name || 'your current Daylight'}?`)) return;
  await savePairing(p);
  await renderSend();
  setStatus(`Paired with ${pairing.name || 'your Daylight'}.`, 'ok');
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
  if (file.size > ds.MAX_ENCODED) throw new ds.ShareError('too-large', `“${file.name}” is larger than 64 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name || 'document';
  const row = await lock(() => sender.send({ kind: 'file', name, mime: mimeFor(name, file.type), title: titleFromName(name), content: bytes }));
  afterSend();
  await changed();
  return row;
}

function describe(rowsSent) {
  const failed = rowsSent.filter((r) => r.status === 'failed');
  if (failed.length) return { text: `Couldn’t reach the relay (${failed[0].error || 'offline?'}). It tries again when you open this page; or use Retry.`, tone: 'bad' };
  const what = rowsSent.length > 1 ? `${rowsSent.length} items are` : rowsSent[0]?.kind === 'file' ? 'The file is' : 'The link is';
  return { text: `Sent ✓ ${what} on the way to ${pairing?.name || 'your Daylight'}.`, tone: 'ok' };
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
  if (sent.length && sent[0].status !== 'failed') { $('url').value = ''; $('title').value = ''; }
}

async function sendFiles(list) {
  const files = [...list].filter((f) => f && f.size >= 0);
  if (!files.length) return [];
  return withBusy(files.length > 1 ? `Sending ${files.length} files…` : `Sending “${files[0].name}”…`, async () => {
    const out = [];
    for (const f of files) out.push(await sendFile(f));
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
    const m = describe([row]);
    setStatus(m.text, m.tone);
    afterSend();
  } catch (e) { setStatus(e.message, 'bad'); }
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
    const info = statusInfo(row);
    const meta = el('div', 'item-meta');
    const st = el('span', `st ${info.tone}`, info.label);
    if (info.hint) st.title = info.hint;
    meta.append(st, el('span', 'when', `· ${relativeTime(row.created)}`));
    if (info.retry && sender) {
      const b = el('button', 'retry', 'Retry');
      b.type = 'button';
      b.addEventListener('click', () => retry(row.id, b));
      meta.append(b);
    }
    li.append(line, meta);
    if (row.status === 'failed' && row.error) li.append(el('p', 'note', row.error));
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
  await lock(async () => { await clearOutbox(); await storage.remove('pairing'); });
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
    if (sent.length && sent.every((r) => r.status !== 'failed')) { $('url').value = ''; $('title').value = ''; }
  }
}

function wire() {
  $('pair-form').addEventListener('submit', onPair);
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
