// The toolbar popup: pairing when not paired; "Send this page", "Send link only" and the recent sends when paired.
// All sending happens in the background (it outlives the popup); the popup reads the outbox from storage to show it.

import { api } from './api.js';
import { TARGET, LAB_BUILT } from './target.js';
import { webUrl } from './daylight-share.js';
import { LAB_TEXT, normaliseShare, wantsFastChecks, FAST_CHECK_MS } from './daylight-lab.js';
import { copyText, renderRepaired, noteFollowUp } from './lab-ui.js';
import {
  renderLabNote, renderLabRow, labRowText, rowAnnouncement, renderCheckIn, renderSendAs, renderThin, renderBigFiles,
  renderLine, renderCard, renderPaste,
} from './lab-popup.js';
import { queueRows } from './lab-send.js';
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
let backTo = 'view-send'; // the view Settings' Back returns to
const lastStatus = new Map(); // row id -> the status last shown, to announce changes (F27)
// Lab, Wave 1 (LAB-PLAN 3.3): what the background says when the popup opens (labPopup: the Use switches, F04's and
// F10's settings, the one-time note), the tab as Lab sees it (labTabInfo), the timeline's data, and the Send as line.
let labw = null;
let tabLab = null;
let timeline = null;
let sendAs = null;
let card = null;
let fastTimer = null;
const lastLabel = new Map(); // row id -> the Lab label last shown, to announce changes (2.5)

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
  // Settings (Comfort among them) is one tap away before pairing too.
  $('open-settings').hidden = view !== 'view-send' && view !== 'view-pair';
}

// --- accessibility (F27, not Lab) -----------------------------------------------------------------------------------

/** Comfort: the comfort class on <body> (popup.css): larger text and buttons, more contrast, no motion. */
function applyComfort(on) {
  document.body.classList.toggle('comfort', !!on);
  $('comfort').checked = !!on;
  if (st) st.comfort = !!on;
}

async function onComfort() {
  const want = $('comfort').checked;
  applyComfort(want);
  try {
    applyComfort((await call('setComfort', { comfort: want })).comfort);
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

// --- Lab (LAB-PLAN 1.1) ---------------------------------------------------------------------------------------------

/**
 * A build without Lab (LAB_BUILT false: its Lab wave is still closed, LAB-PLAN 6.2) has no Lab switch either: the
 * popup is its last non-Lab build's.
 */
function removeLab() {
  for (const id of ['lab-row', 'lab-rows', 'lab-footer', 'lab-note', 'lab-card', 'lab-send-as', 'lab-paste', 'lab-after', 'lab-checkin', 'lab-queue']) $(id)?.remove();
}

/** Lab is on and this build has it: the popup shows Wave 1's pieces. */
const labOnNow = () => LAB_BUILT && !!labw?.lab;

/** The background's Lab answer for the popup (labPopup), or null with Lab off. */
async function loadLab() {
  labw = null;
  timeline = null;
  if (!LAB_BUILT || !st?.lab) return;
  try { labw = await call('labPopup'); } catch { labw = null; }
  if (!labw?.lab) { labw = null; return; }
  timeline = labw.timeline ?? null;
}

/** The one-time note (1.2), until OK. */
function showLabNote() {
  const box = $('lab-note');
  if (!box) return;
  if (!labOnNow() || !labw.noteEnabled || labw.labNoteShown) { box.hidden = true; box.textContent = ''; return; }
  renderLabNote(box, {
    onOk: async () => {
      box.hidden = true;
      box.textContent = '';
      labw.labNoteShown = true;
      try { await call('labSeen', { key: 'labNoteShown' }); } catch { /* shown again next time */ }
      ($('view-send').hidden ? $('code') : $('send-page').hidden ? $('open-settings') : $('send-page'))?.focus();
    },
  });
}

/** The Lab switch, and the two rows under it while Lab is on. */
function applyLab(on) {
  if (!LAB_BUILT) return;
  $('lab').checked = !!on;
  $('lab-rows').hidden = !on;
  if (st) st.lab = !!on;
}

/** The "Daylight server ›" row's subtitle ("Optional · Not set up"): the last answer at once, then a fresh one. */
async function loadServerSubtitle(refresh = true) {
  if (!st?.lab) return;
  try {
    const r = await call('labState', { refresh });
    if (r.serverSubtitle) $('server-sub').textContent = r.serverSubtitle;
  } catch { /* the row still opens the section */ }
}

async function onLab() {
  const want = $('lab').checked;
  applyLab(want);
  try {
    applyLab((await call('setLab', { lab: want })).lab);
  } catch {
    applyLab(!want);
  }
  if (st?.lab) loadServerSubtitle();
}

/**
 * After a re-pairing that locked the Daylight server (LAB-PLAN 2.6, DESIGN 12.7): the locked text with the new Server
 * code, Copy and the re-run help, at the top of the send view while Lab is on, until OK or the server answers ready.
 */
async function loadRepaired({ say = false } = {}) {
  const box = $('repaired');
  let r = null;
  if (LAB_BUILT && st?.lab && st?.paired) {
    try { r = (await call('labRepaired')).repaired; } catch { r = null; }
  }
  box.hidden = !r;
  if (!r) { box.textContent = ''; return; }
  renderRepaired(box, r, {
    copy: (code) => copyText(code ?? ''),
    ok: async () => {
      box.hidden = true;
      box.textContent = '';
      try { await call('labRepairSeen'); } catch { /* shown again next time */ }
      ($('send-page').hidden ? $('open-settings') : $('send-page')).focus();
    },
  });
  if (say) announce(r.message);
}

/** What's in Lab and the Daylight server open the extension page lab.html (1.1), in a tab. */
async function openLab(view) {
  const url = api.runtime.getURL(`lab.html#${view}`);
  try { await api.tabs.create({ url }); } catch { location.href = url; }
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
  await renderSend({ say: !!r.serverLocked });
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

/**
 * After a share (CHANGES-v1.1 2.5): why its link went instead, if it did; then the row's label and sentence. With Lab
 * on, the timeline's (2.5): "Waiting for connection" while offline, the Lab Inbox's states once delivered.
 */
function resultMessage(r) {
  const row = r?.row;
  if (!row) return { text: '' }; // {handled}: the background sent it already; the history shows it
  if (labOnNow()) {
    const d = labRowText(row, { ...(timeline ?? {}), online: navigator.onLine });
    const label = /[.…✓]$/.test(d.label) ? d.label : `${d.label}.`;
    return { text: [r.note, d.sentence ? `${label} ${d.sentence}` : label].filter(Boolean).join(' '), bad: row.status === 'expired' };
  }
  return { text: [r.note, rowMessage(row)].filter(Boolean).join(' '), bad: row.status === 'expired' };
}

/** A send's answer in the popup: the status line, then what Lab adds under it (labAfter). */
function showResult(r) {
  if (!r) return;
  const m = resultMessage(r);
  if (m.text) setStatus(m.text, m.bad);
  labAfter(r);
}

// --- Lab, Wave 1: what the send view adds (LAB-PLAN 3.3) ---------------------------------------------------------------

/** F10's mode for the next send: the Send as line's, else the tab's default (labTabInfo), else Page. */
function currentMode() {
  const m = sendAs?.get() ?? tabLab?.mode;
  return m && m !== 'pdf' ? m : 'page';
}

/**
 * The tab as Lab sees it, then Send as (F10), Paste and send (F33) and, when "Send when I click the toolbar button" is
 * ticked, the share-in-place card (F04).
 */
async function renderTabLab() {
  for (const id of ['lab-card', 'lab-send-as', 'lab-paste', 'lab-after']) {
    const box = $(id);
    if (box) { box.hidden = true; box.textContent = ''; }
  }
  sendAs = null;
  card = null;
  tabLab = null;
  const target = document.querySelector('#view-send .target');
  if (target) target.hidden = false;
  if (!labOnNow() || !st?.paired) return;
  if (labw.use?.F33) renderPaste($('lab-paste'), { read: readClipboard, parse: parseCopied, send: sendCopiedLink });
  if (!tab || !webUrl(tab.url || tab.pendingUrl || '')) return;
  try { tabLab = await call('labTabInfo', { tabId: tab.id }); } catch { tabLab = null; }
  if (!tabLab || !labOnNow()) return;
  if (labw.use?.F10 && !tabLab.pdf) sendAs = renderSendAs($('lab-send-as'), { mode: currentMode() });
  if (labw.use?.F04 && labw.clickSend) startCard(); // F04: "Send when I click the toolbar button" (lab-send.js clickToSend)
}

/**
 * F04's card: "Sending to {name}", and the send 1.5 s later by the background (which owns the timer, so closing the
 * popup still sends) unless Options stops it; for someone who needs more time (Comfort, "Always show Options before
 * sending"), the choices and Send at once, and nothing goes before Send.
 */
function startCard() {
  const linkOnly = !tabLab.readable && !tabLab.pdf;
  const choices = !!labw.comfort || !!labw.alwaysOptions; // no countdown for those who need more time (noCountdown)
  for (const id of ['send-page', 'send-link', 'lab-send-as', 'lab-paste']) $(id).hidden = true;
  const target = document.querySelector('#view-send .target');
  if (target) target.hidden = true;
  const mode = linkOnly ? 'link' : currentMode();
  card = renderCard($('lab-card'), {
    name: st.name, linkOnly, choices,
    on: {
      options: () => { call('labCancelScheduled', { tabId: tab.id }).catch(() => {}); },
      choices: (box) => {
        if (labw.use?.F10 && !tabLab.pdf && !linkOnly) {
          const line = document.createElement('div');
          line.className = 'lab-send-as';
          box.append(line);
          sendAs = renderSendAs(line, { mode });
          box.append(reviewSwitch());
        }
      },
      send: () => cardSend(linkOnly),
      sendLink: () => cardSend(true),
    },
  });
  if (choices) return;
  call('labScheduleSend', { tabId: tab.id, mode }).then((r) => {
    if (r?.cancelled) return;
    card?.done();
    showResult(r);
    startPolling();
  }, (e) => { card?.done(); setStatus(e.message, true); });
}

/** F10's "Review before sending" as a switch among the card's choices (the setting itself, as in What's in Lab). */
function reviewSwitch() {
  const row = document.createElement('div');
  row.className = 'switch-row';
  const label = el('label', 'switch-label', LAB_TEXT.sendAs.review);
  const input = document.createElement('input');
  Object.assign(input, { type: 'checkbox', className: 'switch', id: 'lab-card-review', checked: !!labw.review });
  input.setAttribute('role', 'switch');
  label.htmlFor = input.id;
  input.addEventListener('change', async () => {
    try { labw.review = (await call('labSetOption', { key: 'labReview', value: input.checked })).review; } catch { input.checked = !!labw.review; }
  });
  row.append(label, input);
  return row;
}

async function cardSend(link) {
  card?.done();
  await send(link);
}

/** What Lab adds under the status: the F02 entry point (Chrome), or F11's excerpt line once. */
function labAfter(r, error = null) {
  const box = $('lab-after');
  if (!box || !labOnNow()) return;
  box.hidden = true;
  box.textContent = '';
  if (TARGET === 'chrome' && (r?.reason === 'pdf-too-large' || error?.code === 'too-large')) {
    renderBigFiles(box, { gate: () => call('labGate', { feature: 'F02' }).catch((e) => ({ ready: false, state: 'error', message: e.message })), fix: bigFilesFix });
    return;
  }
  if (r?.excerpt && !labw.excerptNoteShown) {
    renderLine(box, LAB_TEXT.excerpt.waitsOnce);
    labw.excerptNoteShown = true;
    call('labSeen', { key: 'labExcerptNoteShown' }).catch(() => {});
  }
}

/** The F02 note's one button: Copy Server code, or Allow for the server's site. */
async function bigFilesFix(r, note, btn) {
  if (r.state === 'needs-site-access') {
    try { await api.permissions.request({ origins: r.origins }); } catch { /* asked again on the next tap */ }
  } else if (r.state === 'needs-server' && (await copyText(r.serverCode ?? ''))) {
    noteFollowUp(note, LAB_TEXT.setup.copied);
  }
  btn?.focus?.();
}

/** F33: the clipboard, read on the click (Chrome asks for the clipboardRead permission the first time). */
async function readClipboard() {
  if (TARGET === 'chrome') {
    try { await api.permissions.request({ permissions: ['clipboardRead'] }); } catch { /* the read says */ }
  }
  return navigator.clipboard.readText();
}

/** F33: a link in copied text (normaliseShare), with the host the question shows; null for no link. */
function parseCopied(text) {
  const n = normaliseShare({ text: String(text ?? ''), clean: labw?.use?.F16 !== false });
  if (n.kind !== 'link' || !n.url) return null;
  return { url: n.url, host: hostOf(n.url) || n.url };
}

async function sendCopiedLink(text) {
  setBusy(true);
  setStatus('Sending the link…');
  try {
    const r = await call('labSendCopied', { text });
    if (r.noLink) setStatus(LAB_TEXT.copiedLink.noLink); else showResult(r);
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    setBusy(false);
    startPolling();
  }
}

function setBusy(busy) {
  $('send-page').disabled = busy || !(tab && (webUrl(tab.url) || /^file:/i.test(tab.url || '')));
  $('send-link').disabled = busy || !(tab && webUrl(tab.url));
  $('app').setAttribute('aria-busy', busy ? 'true' : 'false');
}

/**
 * "Send this page" and "Send link only". With Lab on: F10's mode (Send as), and its answers: the thin-page question
 * ({thin}: Send full page or Send anyway), Review opened in a tab ({review}), or the row.
 */
async function send(linkOnly, { mode = null, force = false } = {}) {
  if (!tab) return;
  $('permission').hidden = true;
  const lab = labOnNow();
  if (lab && $('lab-after')) { $('lab-after').hidden = true; $('lab-after').textContent = ''; }
  setBusy(true);
  const pdf = looksLikePdfUrl(tab.url || '');
  // A PDF tab sends the file: no mode (and nothing kept for its site).
  const m = lab && !tabLab?.pdf ? (mode ?? currentMode()) : null;
  setStatus(linkOnly || m === 'link' ? 'Sending the link…' : pdf ? 'Getting the PDF…' : 'Getting the page…');
  try {
    const req = { tabId: tab.id, linkOnly };
    if (m) Object.assign(req, { mode: m, force });
    let r = await call('sendTab', req);
    if (r.needsPermission) r = await askPermission(r);
    if (r?.thin) {
      setStatus('');
      renderThin($('lab-after'), r.thin.n, { full: () => send(false, { mode: 'page' }), anyway: () => send(false, { mode: m, force: true }) });
      return;
    }
    if (r?.review) { setStatus(''); return; }
    if (r) showResult(r);
  } catch (e) {
    setStatus(e.message, true);
    labAfter(null, e);
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
  if (labOnNow()) { renderLabHistory(); return; }
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

/**
 * The history with Lab on (2.5, F07): "Waiting to send ({n})" with Cancel on each row, then Recent, in the timeline's
 * words; the check-in header above them; a row whose label changes is announced.
 */
function renderLabHistory() {
  const ctx = { ...(timeline ?? {}), online: navigator.onLine };
  const now = Date.now();
  const changed = [];
  for (const row of rows) {
    const label = labRowText(row, ctx, now).label;
    const was = lastLabel.get(row.id);
    if (was && was !== label && row.status !== 'sending') changed.push(rowAnnouncement(row, ctx, now));
    lastLabel.set(row.id, label);
    lastStatus.set(row.id, row.status);
  }
  if (changed.length) announce(changed.join('. '));
  const waiting = queueRows(rows);
  const rest = rows.filter((r) => !waiting.includes(r));
  const newestId = rows[0]?.id;
  const on = { retry, remove };
  const queueList = $('lab-queue-list');
  queueList.textContent = '';
  $('lab-queue').hidden = waiting.length === 0;
  $('lab-queue-h').textContent = LAB_TEXT.queue.heading.replace('{n}', String(waiting.length));
  for (const row of waiting) queueList.append(renderLabRow(row, ctx, { newest: row.id === newestId, now, on, cancel: true }));
  const list = $('history');
  list.textContent = '';
  const shown = rest.slice(0, HISTORY_SHOWN);
  $('recent-h').hidden = shown.length === 0;
  for (const row of shown) list.append(renderLabRow(row, ctx, { newest: row.id === newestId, now, on }));
  renderCheckIn($('lab-checkin'), timeline);
  startFastChecks();
}

/** F01's faster checks (2.5): every 30 s while a delivered row of the last 10 minutes has no settled state. */
function startFastChecks() {
  if (fastTimer || !labOnNow() || !wantsFastChecks(rows, Date.now(), timeline?.states ?? {})) return;
  fastTimer = setInterval(async () => {
    if (!labOnNow() || !wantsFastChecks(rows, Date.now(), timeline?.states ?? {})) { clearInterval(fastTimer); fastTimer = null; return; }
    try { await call('labCheckAcks'); } catch { /* offline */ }
  }, FAST_CHECK_MS);
}

/** The ledger learnt something (lab/states, lab/inbox, lab/heard): the rows and the header follow. */
async function refreshTimeline() {
  if (!labOnNow()) return;
  try { timeline = await call('labTimeline'); } catch { return; }
  if (!$('view-send').hidden) renderHistory();
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
  backTo = $('view-pair').hidden ? 'view-send' : 'view-pair';
  show('view-settings');
  $('comfort').checked = !!st.comfort;
  applyLab(st.lab);
  if (st.lab) loadServerSubtitle(false).then(() => loadServerSubtitle(true));
  $('settings-paired').hidden = !st.paired;
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

async function renderSend({ say = false } = {}) {
  show('view-send');
  $('daylight-name').textContent = st.name || 'your Daylight';
  await loadTab();
  renderTab();
  if (LAB_BUILT) await renderTabLab();
  await loadRepaired({ say });
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
  $('close-settings').addEventListener('click', () => (backTo === 'view-pair' || !st?.paired ? renderPair() : renderSend()));
  $('comfort').addEventListener('change', onComfort);
  if (LAB_BUILT) {
    $('lab').addEventListener('change', onLab);
    $('open-whats-in-lab').addEventListener('click', () => openLab('whats-in-lab'));
    $('open-server').addEventListener('click', () => openLab('server'));
  } else removeLab();
  $('name-form').addEventListener('submit', onSaveName);
  $('unpair').addEventListener('click', onUnpair);
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.outbox) { rows = changes.outbox.newValue ?? []; renderHistory(); }
    if (changes.settings) {
      applyComfort(changes.settings.newValue?.comfort);
      // The switch may change in lab.html too.
      const lab = LAB_BUILT && changes.settings.newValue?.lab !== false;
      if (st && lab !== st.lab) {
        applyLab(lab);
        if (lab) loadServerSubtitle(false);
        if (!$('view-send').hidden) loadRepaired();
        // Wave 1's pieces come and go with the switch.
        loadLab().then(() => { showLabNote(); if (!$('view-send').hidden) renderSend(); else renderHistory(); });
      } else if (st?.lab && labw) {
        // A Lab setting changed elsewhere (lab.html): the next popup shows it; the Use switches apply to the next send.
        call('labPopup').then((r) => { if (r?.lab) labw = r; }, () => {});
      }
    }
    if (changes['lab/server'] && st?.lab) loadServerSubtitle(false);
    if (changes['lab/repaired'] && st?.lab && !$('view-send').hidden) loadRepaired();
    if (changes['lab/states'] || changes['lab/inbox'] || changes['lab/heard']) refreshTimeline();
  });
  // F07: the timeline says "Waiting for connection" while offline; back online, the waiting rows go now.
  window.addEventListener('online', () => { if (labOnNow()) { call('labOnline').catch(() => {}); renderHistory(); } });
  window.addEventListener('offline', () => { if (labOnNow()) renderHistory(); });
  // Comfort first, so the popup opens at its size.
  try { applyComfort((await api.storage.local.get('settings'))?.settings?.comfort); } catch { /* the background says */ }

  try {
    st = await call('state');
  } catch (e) {
    show('view-send');
    setStatus(e.message, true);
    $('app').setAttribute('aria-busy', 'false');
    return;
  }
  call('clearBadge').catch(() => {});
  applyComfort(st.comfort);
  await loadLab();
  showLabNote();
  if (!st.paired) renderPair({ fresh: true });
  else {
    await renderSend();
    call('tick').then(() => startPolling(), () => {});
  }
  $('app').setAttribute('aria-busy', 'false');
  document.body.dataset.ready = '1';
}

init();
