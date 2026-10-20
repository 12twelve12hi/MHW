// The toolbar popup: pairing when not paired; "Send this page", "Send link only" and the recent sends when paired.
// All sending happens in the background (it outlives the popup); the popup reads the outbox from storage to show it.

import { api } from './api.js';
import { TARGET } from './target.js';
import { webUrl } from './daylight-share.js';
import {
  statusInfo, rowMessage, kindLabel, displayTitle, relativeTime, hostOf, isPending, looksLikePdfUrl,
} from './logic.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const standalone = params.has('standalone'); // opened in a tab to pair (from a shortcut or menu while unpaired)
const forcedTab = params.get('tab'); // the tab to send (tests open the popup as a page)
const HISTORY_SHOWN = 5;

let st = null; // state from the background
let tab = null; // the tab "Send this page" sends
let rows = [];
let pollTimer = null;
let pendingPerm = null;
let pendingPair = null; // a pairing waiting for the user's answer: {input, from, relay, expect, title, lines, button}
let unpairArmed = null;

const isTouchApple = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
if (standalone || isTouchApple) document.documentElement.classList.add('wide');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

async function call(type, extra = {}) {
  let res;
  try {
    res = await api.runtime.sendMessage({ type, ...extra });
  } catch (e) {
    throw new Error('Send to Daylight isn’t responding. Close this and try again.');
  }
  if (!res) throw new Error('Send to Daylight isn’t responding. Close this and try again.');
  if (!res.ok) {
    const e = new Error(res.error || 'Something went wrong.');
    e.code = res.code;
    throw e;
  }
  return res.result;
}

function setStatus(text, bad = false) {
  const s = $('status');
  s.textContent = text || '';
  s.classList.toggle('bad', !!bad);
}

function show(view) {
  for (const v of ['view-pair', 'view-confirm', 'view-send', 'view-settings']) $(v).hidden = v !== view;
  $('open-settings').hidden = view !== 'view-send';
}

// --- pairing --------------------------------------------------------------------------------------------------------

/**
 * The pairing field: when nothing is paired, or from Settings > "Change pairing…" (then with a way back). fresh: a new
 * visit (not a return from the question), which sets Advanced > Relay URL to the relay in use, so that typing the
 * same Daylight's code again (to rename this browser, say) keeps a self-hosted relay instead of moving to ntfy.sh.
 */
function renderPair({ fresh = false } = {}) {
  show('view-pair');
  $('pair-back').hidden = !st?.paired;
  $('pair-error').textContent = '';
  $('from').placeholder = st?.defaultFrom || 'Chrome on Mac';
  if (!$('from').value && st?.from) $('from').value = st.from;
  if (fresh) {
    const own = st?.paired && !st.defaultRelay ? st.relay : '';
    $('relay').value = own;
    $('advanced').open = !!own;
  }
  setTimeout(() => $('code').focus(), 50);
}

async function paired(r) {
  st = await call('state');
  $('code').value = '';
  await renderSend();
  setStatus(r.notice || `Paired with ${r.name || 'your Daylight'}.`);
}

/** Asks before replacing another Daylight (PROTOCOL 1.3), in the protocol module's words. */
function renderConfirm(c) {
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
}

async function onPair(ev) {
  ev.preventDefault();
  const input = $('code').value.trim();
  const err = $('pair-error');
  err.textContent = '';
  if (!input) { err.textContent = 'Type the code shown on your Daylight, or paste its pairing link.'; $('code').focus(); return; }
  const btn = $('pair-btn');
  btn.disabled = true;
  btn.textContent = 'Pairing…';
  try {
    const req = { input, from: $('from').value, relay: $('relay').value };
    const r = await call('pair', req);
    if (r.needsConfirm) {
      pendingPair = { ...req, ...r.needsConfirm };
      renderConfirm(r.needsConfirm);
      return;
    }
    await paired(r);
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Pair';
  }
}

/** The answer to the question: pair (or switch) only on its button. */
async function onConfirm(yes) {
  const p = pendingPair;
  pendingPair = null;
  if (!p) return;
  if (!yes) {
    renderPair();
    return;
  }
  $('confirm-yes').disabled = true;
  try {
    await paired(await call('pair', { input: p.input, from: p.from, relay: p.relay, confirm: true, expect: p.expect }));
  } catch (e) {
    renderPair();
    $('pair-error').textContent = e.message;
  } finally {
    $('confirm-yes').disabled = false;
  }
}

// --- sending --------------------------------------------------------------------------------------------------------

async function loadTab() {
  tab = null;
  try {
    if (forcedTab) tab = await api.tabs.get(Number(forcedTab));
    else if (!standalone) [tab] = await api.tabs.query({ active: true, currentWindow: true });
  } catch { tab = null; }
}

function renderTab() {
  const card = $('page-card');
  const sendPage = $('send-page');
  const sendLink = $('send-link');
  if (!tab) {
    card.hidden = true;
    sendPage.hidden = true;
    sendLink.hidden = true;
    const key = st?.shortcut ? ` or press ${st.shortcut}` : '';
    setStatus(standalone ? `Paired. To send a page, click the Send to Daylight button in the toolbar${key}.` : '');
    return;
  }
  const url = tab.url || tab.pendingUrl || '';
  const web = !!webUrl(url);
  card.hidden = false;
  sendPage.hidden = false;
  sendLink.hidden = false;
  $('page-title').textContent = tab.title || url || 'This tab';
  $('page-host').textContent = hostOf(url) || url.split(/[?#]/)[0];
  sendPage.textContent = looksLikePdfUrl(url) ? 'Send this PDF' : 'Send this page';
  sendPage.disabled = !(web || /^file:/i.test(url));
  sendLink.disabled = !web;
  if (sendPage.disabled) setStatus(`${TARGET === 'safari' ? 'Safari’s' : 'The browser’s'} own pages can’t be sent. Open a web page first.`);
}

/** After a share (CHANGES-v1.1 2.5): why its link went instead, if it did; then the row's label and sentence. */
function resultMessage(r) {
  const row = r?.row;
  if (!row) return { text: '' }; // {handled}: the background sent it already; the history shows it
  return { text: [r.note, rowMessage(row)].filter(Boolean).join(' '), bad: row.status === 'expired' };
}

function setBusy(busy) {
  $('send-page').disabled = busy || !(tab && (webUrl(tab.url) || /^file:/i.test(tab.url || '')));
  $('send-link').disabled = busy || !(tab && webUrl(tab.url));
  $('app').setAttribute('aria-busy', busy ? 'true' : 'false');
}

async function send(linkOnly) {
  if (!tab) return;
  $('permission').hidden = true;
  setBusy(true);
  const pdf = looksLikePdfUrl(tab.url || '');
  setStatus(linkOnly ? 'Sending the link…' : pdf ? 'Getting the PDF…' : 'Getting the page…');
  try {
    let r = await call('sendTab', { tabId: tab.id, linkOnly });
    if (r.needsPermission) r = await askPermission(r);
    if (r) { const m = resultMessage(r); setStatus(m.text, m.bad); }
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    setBusy(false);
    startPolling();
  }
}

/** The PDF couldn't be read inside the page: ask for the site, then the background downloads it (or sends the link). */
async function askPermission(r) {
  pendingPerm = r;
  setStatus('Asking for access to the site…');
  try {
    await api.permissions.request(r.needsPermission);
  } catch {
    // Too long since the click for the browser to show its prompt: ask with a button instead.
    $('perm-host').textContent = hostOf(r.url) || r.url;
    $('permission').hidden = false;
    setStatus('');
    return null;
  }
  setStatus('Getting the PDF…');
  return call('sendPdf', { url: r.url, title: r.title, token: r.token });
}

async function onPermAllow() {
  const r = pendingPerm;
  if (!r) return;
  try { await api.permissions.request(r.needsPermission); } catch { /* not available: the link goes instead */ }
  $('permission').hidden = true;
  setBusy(true);
  setStatus('Getting the PDF…');
  try {
    const res = await call('sendPdf', { url: r.url, title: r.title, token: r.token });
    const m = resultMessage(res);
    setStatus(m.text, m.bad);
  } catch (e) { setStatus(e.message, true); } finally { setBusy(false); pendingPerm = null; }
}

async function onPermLink() {
  $('permission').hidden = true;
  pendingPerm = null;
  await send(true);
}

async function retry(id, button) {
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const r = await call('retry', { id });
    const m = resultMessage(r);
    setStatus(m.text, m.bad);
  } catch (e) { setStatus(e.message, true); }
  startPolling();
}

async function remove(id, button) {
  button.disabled = true;
  try { await call('remove', { id }); } catch (e) { setStatus(e.message, true); button.disabled = false; }
}

// --- history --------------------------------------------------------------------------------------------------------

async function loadRows() {
  try { rows = (await api.storage.local.get('outbox'))?.outbox ?? []; } catch { rows = []; }
  renderHistory();
}

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
    li.append(line, meta);
    if (row.note) li.append(el('p', 'note', row.note));
    if (info.hint) li.append(el('p', `note sentence${info.tone === 'bad' ? ' bad' : ''}`, info.hint));
    list.append(li);
  }
}

/** While the popup is open and something is on its way, look for acks every few seconds. */
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const waiting = rows.some((r) => isPending(r) && Date.now() - r.created < 6 * 3600 * 1000);
    if (!waiting) { clearInterval(pollTimer); pollTimer = null; return; }
    try { await call('tick'); } catch { /* offline */ }
  }, 8000);
}

// --- settings -------------------------------------------------------------------------------------------------------

function renderSettings() {
  show('view-settings');
  $('set-daylight').textContent = st.name || 'Your Daylight (no name given)';
  $('set-relay').textContent = st.relay.replace(/^https:\/\//, '');
  const hasCommands = !!api.commands;
  $('set-shortcut-dt').hidden = !hasCommands;
  $('set-shortcut').hidden = !hasCommands;
  $('set-shortcut').textContent = st.shortcut
    ? `${st.shortcut} sends the current page`
    : TARGET === 'chrome' ? 'None. Set one at chrome://extensions/shortcuts' : 'None';
  $('set-from').value = st.from || '';
  $('set-from').placeholder = st.defaultFrom;
  $('name-saved').textContent = '';
  $('version').textContent = `Send to Daylight ${st.version} (${TARGET})`;
  unpairArmed = null;
  $('unpair').textContent = 'Unpair this browser';
}

async function onSaveName(ev) {
  ev.preventDefault();
  try {
    const r = await call('setName', { from: $('set-from').value });
    st.from = r.from;
    $('name-saved').textContent = `Saved. Items now show as sent from “${r.from || st.defaultFrom}”.`;
  } catch (e) { $('name-saved').textContent = e.message; }
}

async function onUnpair() {
  const b = $('unpair');
  if (!unpairArmed) {
    b.textContent = 'Click again to unpair (unsent items are discarded)';
    unpairArmed = setTimeout(() => { unpairArmed = null; b.textContent = 'Unpair this browser'; }, 5000);
    return;
  }
  clearTimeout(unpairArmed);
  unpairArmed = null;
  try {
    await call('unpair');
    st = await call('state');
    rows = [];
    renderPair({ fresh: true });
  } catch (e) { b.textContent = e.message; }
}

// --- start ----------------------------------------------------------------------------------------------------------

async function renderSend() {
  show('view-send');
  $('daylight-name').textContent = st.name || 'your Daylight';
  await loadTab();
  renderTab();
  await loadRows();
}

async function init() {
  $('pair-form').addEventListener('submit', onPair);
  $('pair-back').addEventListener('click', () => renderSend());
  $('confirm-yes').addEventListener('click', () => onConfirm(true));
  $('confirm-no').addEventListener('click', () => onConfirm(false));
  $('repair').addEventListener('click', () => renderPair({ fresh: true }));
  $('send-page').addEventListener('click', () => send(false));
  $('send-link').addEventListener('click', () => send(true));
  $('perm-allow').addEventListener('click', onPermAllow);
  $('perm-link').addEventListener('click', onPermLink);
  $('open-settings').addEventListener('click', renderSettings);
  $('close-settings').addEventListener('click', () => renderSend());
  $('name-form').addEventListener('submit', onSaveName);
  $('unpair').addEventListener('click', onUnpair);
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.outbox) { rows = changes.outbox.newValue ?? []; renderHistory(); }
  });

  try {
    st = await call('state');
  } catch (e) {
    show('view-send');
    setStatus(e.message, true);
    $('app').setAttribute('aria-busy', 'false');
    return;
  }
  call('clearBadge').catch(() => {});
  if (!st.paired) renderPair({ fresh: true });
  else {
    await renderSend();
    call('tick').then(() => startPolling(), () => {});
  }
  $('app').setAttribute('aria-busy', 'false');
  document.body.dataset.ready = '1';
}

init();
