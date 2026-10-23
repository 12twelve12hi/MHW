// The window: pairing, the drop zone, "Send the link on the clipboard", the history and the settings, with Lab's
// switch and screens (LAB-PLAN 1, 2.6) and, with Lab on, Wave 1 (card WIN1): the delivery timeline and its toast
// (F01), F02's entry point, the offline queue (F07), "Sent to {name}" (F08), send links (F09), smart intake (F16),
// Setup check (F26), the copied link's question (F33) and the Use switches (6.5 Q5). Sending and the outbox live in
// core.js (with daylight-share.js), Lab's logic in lab.js and its screens' parts in lab-ui.js; bridge.js talks to the
// Rust side. The window can be hidden (closed to the tray) for days: this page keeps running, handles Send To and the
// hotkey, and keeps the outbox moving. With Lab off, every view is v1.1's (the Lab-off baselines).

import { bridge, appStorage } from './bridge.js';
import { createApp, serial, MAX_FILE, tooBig } from './core.js';
import { ShareError } from './daylight-share.js';
import { LAB_TEXT, fillText, needsMessage } from './daylight-lab.js';
import { LAB_NOTE_ENABLED, USE_SWITCHES, PLATFORM, isQueued, labRowText, setupChecks } from './lab.js';
import {
  labNote, noteFollowUp, clearNote, noteBox, dismissNotesOnOtherControls, renderWhatsInLab, updateWhatsInLab,
  renderServerSection, renderRepaired, renderLabNote, renderLabRow, renderQuestion, renderBigFiles, renderSetupCheck,
  updateSetupCheck, useSwitch, featureSwitch,
} from './lab-ui.js';
import {
  rowView, kindLabel, displayTitle, relativeTime, sendSummary, accelFromEvent, describeAccel,
  hostOf, DEFAULT_HOTKEY,
} from './logic.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['view-pair', 'view-confirm', 'view-send', 'view-settings', 'view-whats', 'view-server', 'view-setup'];
/** The v1.1 words of the window's clipboard button and the tray's entry (Lab F33 reads "Send copied link"). */
const CLIP_BUTTON = 'Send the link on the clipboard';
const CLIP_TRAY = 'Send clipboard link';
const HISTORY_SHOWN = 50;

let app = null;
let info = null; // from Rust: version, e2e options, Send To shortcut, start at login
let st = { paired: false, name: '', relay: '' };
let rows = [];
let view = '';
let hotkey = { accel: '', error: '' };
let recording = null; // {previous} while the hotkey recorder listens
let unpairArmed = null;
let pendingPair = null; // a pairing waiting for the user's answer: {next, expect, confirm}
let dataProblem = ''; // saved data that couldn't be read and was set aside, said once the window is drawn
let ready = false; // the first view is drawn: actions from Rust can be handled
let comfort = false; // F27 Comfort (settings.comfort), not Lab
let labIsOn = true; // the Lab switch as last read (LAB-PLAN 1.2: a missing key means on)
let labSettings = {}; // the settings as last read: the Use switches (labUse), quick sends, the note (Lab, WIN1)
let labTl = null; // the timeline's ledger read (lab.timeline()), for the rows and the check-in header (F01)
let pendingSend = null; // a send link's question (F09): prepareSendLink's {link, title, lines}
let testId = ''; // Setup check's test article (F26): the row it follows
let testError = '';
/** The window is on screen, as Rust says (WebView2 tells a hidden window's page it is visible): F01's toast and checks. */
let onScreen = true;
let settingsFrom = 'view-send'; // the view Settings' Back returns to
const lastLabel = new Map(); // row id -> the label last drawn, to announce a row's new state (F27)
const log = []; // recent events, for the end-to-end test's status file

function note(text) {
  log.push(`${new Date().toISOString()} ${text}`);
  if (log.length > 100) log.splice(0, log.length - 100);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function setStatus(text, bad = false) {
  const s = $('status');
  s.textContent = text || '';
  s.classList.toggle('bad', !!bad);
  hideBox('lab-after'); // F02's entry point belongs to the sentence it was under
  writeStatusSoon();
}

/** Empties and hides one of Lab's boxes in the send view. */
function hideBox(id) {
  const b = $(id);
  b.hidden = true;
  b.textContent = '';
}

function show(v) {
  view = v;
  for (const id of VIEWS) $(id).hidden = id !== v;
  // Settings (Comfort among them) is one click away before pairing too.
  $('open-settings').hidden = v !== 'view-send' && v !== 'view-pair';
  renderNote();
  writeStatusSoon();
}

// --- accessibility (F27, not Lab) -----------------------------------------------------------------------------------

/** Comfort: the comfort class on <body> (styles.css): larger text and buttons, more contrast, no motion. */
function applyComfort(on) {
  comfort = !!on;
  document.body.classList.toggle('comfort', comfort);
  $('comfort').checked = comfort;
}

async function onComfort() {
  const want = $('comfort').checked;
  applyComfort(want);
  $('comfort-msg').textContent = '';
  try {
    applyComfort((await app.setSettings({ comfort: want })).comfort);
    note(`comfort ${want ? 'on' : 'off'}`);
  } catch (e) {
    applyComfort(!want);
    $('comfort-msg').textContent = `Couldn’t change that: ${e?.message ?? e}`;
  }
  writeStatusSoon();
}

/** Says history rows' new states to screen readers (the rows change without moving focus). */
function announce(text) {
  const a = $('announce');
  a.textContent = '';
  // A fresh text after a tick, so the same words twice are still read.
  setTimeout(() => { a.textContent = text; }, 50);
}

// --- pairing --------------------------------------------------------------------------------------------------------

function renderPair(error = '') {
  show('view-pair');
  // Reached from Settings › Change pairing… while paired: Back returns to sending.
  $('pair-back').hidden = !st.paired;
  $('pair-error').textContent = error;
  setTimeout(() => { if (view === 'view-pair') $('code').focus(); }, 30);
}

async function paired(r, notice = null) {
  st = await app.state();
  rows = await app.rows();
  renderSend();
  const said = notice || `Paired with ${r.name || 'your Daylight'}. Drop something here to send it.`;
  setStatus(said);
  note(`paired with ${r.name || '(no name)'} at ${r.relay}: ${said}`);
}

/** The view the window had before a question: the send view when paired, else the pairing screen. */
function backToMain() {
  if (st.paired) renderSend(); else renderPair();
}

/** Asks before pairing (PROTOCOL 1.3), in the protocol module's words: "Pair with …?", "Code starts …", the relay. */
function renderConfirm(c) {
  show('view-confirm');
  $('confirm-h').textContent = c.title;
  const box = $('confirm-lines');
  box.textContent = '';
  for (const line of c.lines) {
    const p = el('p', 'confirm-line');
    // Make the code's first group stand out: it is what the user compares with the Daylight's screen.
    const m = /^(Code starts )(\S+?)(\..*)$/.exec(line);
    if (m) p.append(m[1], el('strong', 'code-start', m[2]), m[3]); else p.textContent = line;
    box.append(p);
  }
  $('confirm-yes').textContent = c.button;
  // Replacing a pairing loses what wasn't delivered: then Enter means Cancel.
  (c.button === 'Switch' ? $('confirm-no') : $('confirm-yes')).focus();
}

/**
 * A pairing link or code: asks first when the protocol says so (a link from outside, or a code that replaces another
 * Daylight), else pairs at once and shows the module's notice ("Pairing updated: now sending through …").
 * -> 'asked' | 'paired'. Throws ShareError for a bad link, code or relay.
 */
async function offerPairing(input, { source, relay } = {}) {
  const pre = await app.preparePairing(input, { source, relay });
  const expect = pre.current?.code ?? '';
  if (pre.confirm.ask) {
    pendingPair = { next: pre.next, expect, confirm: pre.confirm };
    note(`asking: ${pre.confirm.title} ${pre.confirm.lines.join(' ')}`);
    renderConfirm(pre.confirm);
    return 'asked';
  }
  pendingPair = null;
  await paired(await app.applyPairing(pre.next, { expect }), pre.confirm.notice);
  return 'paired';
}

async function onPairSubmit(ev) {
  ev.preventDefault();
  const input = $('code').value.trim();
  const err = $('pair-error');
  err.textContent = '';
  if (!input) { err.textContent = 'Type the code shown on your Daylight, or paste its pairing link.'; $('code').focus(); return; }
  const btn = $('pair-btn');
  btn.disabled = true;
  btn.textContent = 'Pairing…';
  try {
    if (await offerPairing(input, { source: 'app', relay: $('relay').value }) === 'paired') $('code').value = '';
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Pair';
  }
}

/** A daylightshare://pair?… link opened on this PC (a click in a browser, or the app started with it). */
async function onPairLink(link) {
  bridge.showWindow().catch(() => {});
  try {
    await offerPairing(link, { source: 'link' });
  } catch (e) {
    note(`pairing link refused: ${e.message}`);
    pendingPair = null;
    if (!st.paired) renderPair(`That pairing link didn’t work: ${e.message}`);
    else { renderSend(); setStatus(`That pairing link didn’t work: ${e.message}`, true); }
  }
}

/** The answer to the pairing question: pair (or switch) only on its button. */
async function onConfirm(yes) {
  const p = pendingPair;
  pendingPair = null;
  if (!p) { if (view === 'view-confirm') backToMain(); return; }
  if (!yes) {
    note(`pairing cancelled: ${p.confirm.title}`);
    backToMain();
    if (st.paired) setStatus(`Still sending to ${st.name || 'your Daylight'}.`);
    return;
  }
  const btn = $('confirm-yes');
  btn.disabled = true;
  try {
    await paired(await app.applyPairing(p.next, { expect: p.expect }));
  } catch (e) {
    note(`pairing failed: ${e.message}`);
    st = await app.state().catch(() => st);
    if (st.paired) { renderSend(); setStatus(e.message, true); } else renderPair(e.message);
  } finally {
    btn.disabled = false;
  }
}

/** Test mode only (Rust forwards these only to an app started with --e2e-status): answer the pairing question. */
async function onTestHook(hook) {
  if (!info?.e2e?.status) return;
  note(`test hook ${hook}`);
  // The pairing question first; else a send link's question (Lab, F09).
  if (view !== 'view-confirm' && pendingSend) { await answerSend(hook === 'confirm'); return; }
  if (hook === 'confirm') await onConfirm(true);
  else if (hook === 'cancel') await onConfirm(false);
}

// --- sending --------------------------------------------------------------------------------------------------------

function setBusy(busy) {
  $('choose').disabled = busy;
  $('send-clip').disabled = busy;
  $('app').setAttribute('aria-busy', busy ? 'true' : 'false');
}

/**
 * After a share (CHANGES-v1.1 2.5): the row's label, then its sentence; for several, what each one did. With Lab on in
 * the timeline's words (Waiting for connection while offline, F07), and under a file refused as too big, F02's entry
 * point (3.1).
 */
async function showResults(results) {
  if (!results?.length) return;
  for (const r of results) note(r.row ? `sent ${r.row.kind} ${r.row.id} (${r.row.status}${r.row.errorCode ? '/' + r.row.errorCode : ''}${r.row.error ? ': ' + r.row.error : ''})` : `not sent ${r.name}: ${r.error}`);
  if (results.length === 1 && results[0].code === 'no-link') { setStatus(`No link on the clipboard. ${results[0].error}`, true); return; }
  let s;
  try { s = await app.summary(results); } catch { s = sendSummary(results); }
  setStatus(results.length === 1 && results[0].row ? s.body : `${s.title}: ${s.body.replace(/\n/g, ' ')}`, s.bad);
  if (labIsOn && results.some((r) => r.code === 'too-large')) {
    renderBigFiles($('lab-after'), {
      gate: () => app.lab.gate('F02').catch((e) => ({ ready: false, state: 'error', message: e?.message ?? String(e) })),
      fix: async (r, shown, b) => {
        if (r.state === 'needs-server') {
          const done = await copyText(r.serverCode ?? '');
          noteFollowUp(shown, done === true ? LAB_TEXT.setup.copied : done);
        }
        b?.focus();
      },
    });
  }
}

async function sendFiles(files) {
  setBusy(true);
  setStatus(files.length === 1 ? `Sending ${files[0].name}…` : `Sending ${files.length} items…`);
  const results = [];
  try {
    for (const f of files) {
      results.push(await app.settle(f.name, async () => {
        if (f.size > MAX_FILE) throw new ShareError('too-large', tooBig(f.size));
        let bytes;
        try { bytes = new Uint8Array(await f.arrayBuffer()); } catch { throw new ShareError('read', 'Couldn’t read it. Folders can’t be sent; drop the files inside.'); }
        return app.sendFile({ name: f.name, bytes, mime: f.type });
      }));
    }
  } finally {
    setBusy(false);
  }
  await showResults(results);
}

/** The text of the dropped link (browsers put an <a> in text/html), or ''. */
function titleFromHtml(html, link) {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const anchors = [...doc.querySelectorAll('a[href]')];
    const a = anchors.find((x) => x.getAttribute('href') === link) ?? anchors[0];
    const t = (a?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return t && t !== link ? t : '';
  } catch { return ''; }
}

/** A dropped link: prepareDrop's {url, text, link}. With Lab on, a dropped text goes whole to smart intake (F16). */
async function sendLinkFromWindow({ url, text, link }, title) {
  setBusy(true);
  setStatus('Sending the link…');
  try {
    await showResults([await app.settle(hostOf(link) || link, () => app.sendLink(url, title, { text }))]);
  } finally {
    setBusy(false);
  }
}

let dragDepth = 0;
function onDragEnter(e) {
  if (view !== 'view-send') return;
  e.preventDefault();
  dragDepth++;
  $('drop').classList.add('over');
}
function onDragOver(e) {
  e.preventDefault(); // allow the drop (anywhere in the window)
  if (e.dataTransfer) e.dataTransfer.dropEffect = view === 'view-send' ? 'copy' : 'none';
}
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('drop').classList.remove('over');
}
function onDrop(e) {
  e.preventDefault();
  dragDepth = 0;
  $('drop').classList.remove('over');
  if (view !== 'view-send') return;
  const dt = e.dataTransfer;
  if (!dt) return;
  // DataTransfer is only readable during the event: take everything before the first await.
  const files = [...(dt.files ?? [])];
  const uriList = dt.getData('text/uri-list');
  const text = dt.getData('text/plain');
  const html = dt.getData('text/html');
  if (files.length) { sendFiles(files); return; }
  // A link from text/uri-list as it is; else the dropped text: v1.1's first address with Lab off, the whole text to
  // smart intake with Lab on (core's prepareDrop).
  app.prepareDrop({ uriList, text }).then((d) => {
    if (!d) { setStatus('Only files and web links (http and https) can be sent.', true); return; }
    return sendLinkFromWindow(d, titleFromHtml(html, d.link));
  }).catch((err) => setStatus(err?.message ?? String(err), true));
}

/** F33 with Lab on: the clipboard command shows the host and Send first (its Use switch on). */
const clipAsks = () => labIsOn && labSettings.labUse?.F33 !== false;

/** The clipboard button's words: v1.1's, or "Send copied link" (F33); the tray's entry follows (Rust). */
function renderClipLabel() {
  $('send-clip').textContent = clipAsks() ? LAB_TEXT.copiedLink.chip : CLIP_BUTTON;
  if (!clipAsks()) hideBox('lab-clip');
  bridge.setClipboardLabel?.(clipAsks() ? LAB_TEXT.copiedLink.chip : CLIP_TRAY).catch(() => {});
}

async function onSendClipboard() {
  let clip;
  try { clip = { text: await bridge.readClipboard(), error: '' }; } catch (e) { clip = { text: '', error: String(e?.message ?? e) }; }
  if (!clipAsks()) {
    setBusy(true);
    try { await showResults(await app.sendClipboard(clip)); } finally { setBusy(false); }
    return;
  }
  // F33: read on the click, then "Send {host} to {name}?" with Send and Cancel; nothing is sent unseen.
  hideBox('lab-clip');
  const p = await app.prepareClipboard(clip);
  if (p.error) { setStatus(`No link on the clipboard. ${p.error}`, true); return; }
  setStatus('');
  const title = fillText(LAB_TEXT.copiedLink.confirm, { host: p.host, name: await app.daylightName() });
  note(`clipboard asks: ${p.host}`);
  renderQuestion($('lab-clip'), { title }, {
    send: async () => {
      hideBox('lab-clip');
      setBusy(true);
      try { await showResults(await app.sendPrepared(p.link)); } finally { setBusy(false); }
      $('send-clip').focus();
    },
    cancel: () => { hideBox('lab-clip'); $('send-clip').focus(); },
  });
  writeStatusSoon();
}

// --- F09: daylightshare://send links (Lab) --------------------------------------------------------------------------

/** A send link from outside (a browser, Shortcuts, a script): its question, a quick send, or why it can't. */
async function onSendLink(link) {
  let r;
  try { r = await app.prepareSendLink(link); } catch (e) { r = { error: e?.message ?? String(e), state: 'error' }; }
  note(`send link: ${r.error ? r.state : r.ask ? 'asks' : 'quick'}`);
  if (r.error) {
    bridge.showWindow().catch(() => {});
    if (view === 'view-confirm') return;
    if (st.paired) { renderSend(); setStatus(r.error, true); } else renderPair(r.error);
    return;
  }
  if (!r.ask) {
    // A quick send (allowed in What's in Lab): it goes, and the notification says so (F08), as the hotkey's does.
    const results = await app.sendPrepared(r.link);
    await app.notifyResults(results);
    await showResults(results);
    return;
  }
  pendingSend = r;
  bridge.showWindow().catch(() => {});
  if (view !== 'view-confirm') renderSend();
  renderSendQuestion();
}

/**
 * Whether the send link's question says why it asked (F09, LAB-PLAN 1.6 needs-quick-sends): the link asked to go
 * without it while "Allow quick sends from other apps" is off, the setting is still off, and OK hasn't closed the note.
 */
const quickNoteDue = () => !!pendingSend?.quickOff && !pendingSend.noteClosed && labSettings.labQuickSends !== true;

/**
 * The send link's question in the send view (F09): "Send to {name}?", the title and host, Send and Cancel; under them,
 * when quickNoteDue, the needs-quick-sends note with Open setting (as Android's sheet), which opens What's in Lab at
 * the switch and leaves the question here for when the send view shows again.
 */
function renderSendQuestion() {
  const box = $('lab-sendlink');
  if (!pendingSend || !labIsOn) { hideBox('lab-sendlink'); return; }
  const why = quickNoteDue() ? {
    message: needsMessage('needs-quick-sends', { platform: PLATFORM }), state: 'needs-quick-sends',
    button: LAB_TEXT.buttons['needs-quick-sends'], onButton: openQuickSendsSetting,
    // OK closes it for this question: it doesn't come back when the send view is drawn again.
    onOk: () => { if (pendingSend) pendingSend.noteClosed = true; writeStatusSoon(); },
  } : null;
  renderQuestion(box, { title: pendingSend.title, lines: pendingSend.lines, note: why }, {
    send: () => answerSend(true),
    cancel: () => answerSend(false),
  });
  writeStatusSoon();
}

/**
 * "Open setting" (1.5) on the needs-quick-sends note: What's in Lab, at "Allow quick sends from other apps" (F09's
 * row), in view with its footer and focused. It never changes the setting; Back returns to Settings, as from there.
 */
function openQuickSendsSetting() {
  note('open setting: quick sends');
  if (view === 'view-pair' || view === 'view-send') settingsFrom = view;
  openWhats({ focus: 'F09' });
}

async function answerSend(yes) {
  const r = pendingSend;
  pendingSend = null;
  hideBox('lab-sendlink');
  if (!r) return;
  note(`send link ${yes ? 'sent' : 'cancelled'}`);
  if (yes) {
    setBusy(true);
    try { await showResults(await app.sendPrepared(r.link)); } finally { setBusy(false); }
  }
  if (view === 'view-send') $('send-clip').focus();
  writeStatusSoon();
}

async function retry(id, button) {
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const row = await app.retry(id);
    if (row) await showResults([{ row }]); // null: the row was removed meanwhile
  } catch (e) { setStatus(e.message, true); }
}

async function remove(id, button) {
  button.disabled = true;
  try { await app.remove(id); note(`removed ${id}`); } catch (e) { setStatus(e.message, true); button.disabled = false; }
}

// --- actions from outside the window (Rust's queue) ----------------------------------------------------------------

const drainRun = serial();

function drain() {
  return drainRun(async () => {
    let actions = [];
    try { actions = await bridge.takeActions(); } catch (e) { note(`take_actions failed: ${e}`); return; }
    for (const a of actions) {
      note(`action ${a.type}${a.paths ? ` (${a.paths.length} files)` : ''}`);
      try {
        if (a.type === 'pair') await onPairLink(a.link);
        else if (a.type === 'send') await onSendLink(a.link);
        else if (a.type === 'test') await onTestHook(a.hook);
        else await showResults(await app.handleAction(a));
      } catch (e) {
        note(`action ${a.type} failed: ${e?.message ?? e}`);
      }
    }
    writeStatusSoon();
  });
}

// --- history --------------------------------------------------------------------------------------------------------

/**
 * The rows whose label changed since they were last drawn to a state worth saying (F27: Delivered ✓, and Waiting to
 * send or Not delivered), as "label: title"; a share's own outcome is said in #status. Remembers every row's label.
 */
function changedStates(all, labelOf = (row) => rowView(row).label) {
  const said = [];
  for (const row of all) {
    const label = labelOf(row);
    const was = lastLabel.get(row.id);
    if (was !== undefined && was !== label && ['delivered', 'failed', 'expired'].includes(row.status)) said.push(`${label}: ${displayTitle(row)}`);
    lastLabel.set(row.id, label);
  }
  return said;
}

function renderHistory() {
  if (labIsOn) { renderLabHistory(); return; }
  $('lab-queue-list').textContent = '';
  $('lab-queue').hidden = true;
  $('lab-checkin').hidden = true;
  const list = $('history');
  list.textContent = '';
  const shown = rows.slice(0, HISTORY_SHOWN);
  $('recent-h').hidden = shown.length === 0;
  const said = changedStates(rows);
  if (said.length) { announce(said.join('. ')); note(`announced ${said.join('. ')}`); }
  for (const row of shown) {
    const li = el('li');
    li.dataset.id = row.id;
    li.dataset.status = row.status;
    const line = el('div', 'item-line');
    const title = el('span', 'item-title', displayTitle(row));
    title.title = row.url || row.name || '';
    line.append(el('span', 'kind', kindLabel(row)), title);
    // The protocol library's words (describeRow): the same label, sentence and button in every Send to Daylight app.
    const v = rowView(row);
    const meta = el('div', 'item-meta');
    meta.append(el('span', `st ${v.tone}`, v.label), el('span', 'when', `· ${relativeTime(row.created)}`));
    const acts = el('span', 'acts');
    if (v.retry) {
      const b = el('button', 'retry', v.retryLabel);
      b.type = 'button';
      b.setAttribute('aria-label', `${v.retryLabel}: ${displayTitle(row)}`);
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
    if (v.sentence) li.append(el('p', `note sentence${v.tone === 'bad' ? ' bad' : ''}`, v.sentence));
    list.append(li);
  }
}

/**
 * The history with Lab on (2.5, F07): the check-in header, "Waiting to send ({n})" with Cancel on each row, then
 * Recent, in the timeline's words; a row whose label changes to Delivered, In your Reader, Waiting or Not delivered is
 * said, as v1.1's are.
 */
function renderLabHistory() {
  const tl = labTl ?? { lab: true, inboxLab: false, caps: [], states: {}, checkedInText: null };
  const now = Date.now();
  const online = navigator.onLine !== false;
  const text = (row) => labRowText(row, tl, { online, now });
  const said = changedStates(rows, (row) => text(row).label);
  if (said.length) { announce(said.join('. ')); note(`announced ${said.join('. ')}`); }
  const checkin = $('lab-checkin');
  checkin.textContent = st.paired ? (tl.checkedInText ?? '') : '';
  checkin.hidden = !checkin.textContent;
  const newest = rows[0]?.id;
  const on = { retry, remove };
  const draw = (row, cancel) => {
    const v = rowView(row);
    return renderLabRow(row, text(row), {
      v11: v, title: displayTitle(row), kind: kindLabel(row), when: `· ${relativeTime(row.created)}`, newest: row.id === newest,
      on, cancel, tone: v.tone,
    });
  };
  const queue = rows.filter(isQueued);
  const qList = $('lab-queue-list');
  qList.textContent = '';
  $('lab-queue').hidden = queue.length === 0;
  $('lab-queue-h').textContent = fillText(LAB_TEXT.queue.heading, { n: queue.length });
  for (const row of queue.slice(0, HISTORY_SHOWN)) qList.append(draw(row, true));
  const list = $('history');
  list.textContent = '';
  const shown = rows.filter((r) => !isQueued(r)).slice(0, HISTORY_SHOWN);
  $('recent-h').hidden = shown.length === 0;
  for (const row of shown) list.append(draw(row, false));
}

/** What the ledger knows, for the timeline (F01): read again when it learns something, then the rows follow. */
async function refreshTimeline() {
  try { labTl = await app.lab.timeline(); } catch { /* the last read stays */ }
}

let refreshTimer = null;
function onStorageChange(key) {
  if (key === 'lab/activity') {
    if (view === 'view-setup') updateSetup();
    return;
  }
  if (key.startsWith('lab/')) {
    // The ledger learnt something (LAB-PLAN 2.2.6): What's in Lab's header line follows.
    // Once the server's live answer is on screen, the rows keep it (the cached states can be older than an answer that
    // ran out of time).
    if (view === 'view-whats') {
      app.lab.overview({ refresh: false }).then((m) => {
        const box = $('whats');
        if (m.lab && view === 'view-whats') updateWhats(box, box.dataset.fresh === '1' ? { ...m, fresh: false } : m);
      }, () => {});
    }
    // ...and the timeline's rows, the check-in header and Setup check's test (F01, F26).
    refreshTimeline().then(() => {
      if (view === 'view-send' && labIsOn) renderHistory();
      if (view === 'view-setup') updateSetup();
      writeStatusSoon();
    });
    writeStatusSoon();
    return;
  }
  if (key === 'settings') readLabSettings();
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      rows = await app.rows();
      if (key === 'pairing') st = await app.state();
    } catch (e) { note(`couldn’t read the history: ${e?.message ?? e}`); }
    if (key === 'outbox' || key === 'pairing') await refreshTimeline();
    if (view === 'view-send') { $('daylight-name').textContent = st.name || 'your Daylight'; renderHistory(); }
    if (view === 'view-setup') updateSetup();
  }, 50);
  writeStatusSoon();
}

// --- settings -------------------------------------------------------------------------------------------------------

function renderHotkey() {
  const k = $('hotkey-now');
  k.classList.toggle('recording', !!recording);
  k.textContent = recording ? 'Press the keys…' : describeAccel(hotkey.accel);
  $('hotkey-change').textContent = recording ? 'Cancel' : 'Change…';
  $('hotkey-off').hidden = !!recording || !hotkey.accel;
  const hint = $('hotkey-hint');
  if (hotkey.error) hint.textContent = `The hotkey isn’t working: ${hotkey.error} Choose another in Settings.`;
  else if (hotkey.accel) hint.textContent = `Or press ${describeAccel(hotkey.accel)} anywhere in Windows.`;
  else hint.textContent = 'Set a hotkey in Settings to send it from anywhere.';
}

/** Registers a hotkey ('' = none) and, with save, remembers it. -> '' or why Windows refused it. */
async function applyHotkey(accel, { save = true } = {}) {
  try {
    const now = await bridge.setHotkey(accel);
    hotkey = { accel: now, error: '' };
    if (save) await app.setSettings({ hotkey: now });
    note(`hotkey ${now || 'off'}`);
    return '';
  } catch (e) {
    const msg = String(e?.message ?? e);
    note(`hotkey ${accel} refused: ${msg}`);
    hotkey = { accel: '', error: msg };
    return msg;
  } finally {
    renderHotkey();
    writeStatusSoon();
  }
}

async function startRecording() {
  if (recording) { await cancelRecording(); return; }
  recording = { previous: hotkey.accel };
  $('hotkey-msg').textContent = 'Press a combination with Ctrl, Alt or Win, such as Ctrl + Alt + D. Esc cancels.';
  renderHotkey();
  // Free the current combination, so pressing it again reaches this window instead of sending.
  try { await bridge.setHotkey(''); } catch { /* ignore */ }
}

async function cancelRecording() {
  const previous = recording?.previous ?? '';
  recording = null;
  $('hotkey-msg').textContent = '';
  await applyHotkey(previous, { save: false });
}

async function onRecordKey(e) {
  if (!recording) return;
  if (e.key === 'Tab') { await cancelRecording(); return; }
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') { await cancelRecording(); return; }
  const accel = accelFromEvent(e);
  if (!accel) {
    if (!['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(e.key)) {
      $('hotkey-msg').textContent = 'Use Ctrl, Alt or Win together with a letter, a digit or an F key.';
    }
    return;
  }
  const previous = recording.previous;
  recording = null;
  const err = await applyHotkey(accel, { save: true });
  if (!err) { $('hotkey-msg').textContent = `Saved. ${describeAccel(accel)} now sends the clipboard’s link.`; return; }
  await applyHotkey(previous, { save: false });
  $('hotkey-msg').textContent = `${describeAccel(accel)} can’t be used: ${err}`;
}

function renderSendTo() {
  const s = info?.sendTo ?? {};
  $('sendto-text').innerHTML = '';
  $('sendto-text').append('File Explorer: ', el('b', '', 'Send to › Daylight'), s.exists ? ' is set up.' : ' isn’t set up.');
  $('sendto-add').hidden = !!s.exists || !s.path;
}

function renderSettings({ focus = 'close-settings' } = {}) {
  if (view === 'view-pair' || view === 'view-send') settingsFrom = view;
  show('view-settings');
  renderLabBlock();
  $('comfort').checked = comfort;
  $('comfort-msg').textContent = '';
  // Before pairing, only what works without a Daylight: Comfort, the hotkey and the Windows settings.
  $('settings-paired').hidden = !st.paired;
  $('settings-unpair').hidden = !st.paired;
  $('set-daylight').textContent = st.name || 'Your Daylight (no name given)';
  $('set-relay').textContent = st.relay.replace(/^https:\/\//, '');
  $('autostart').checked = !!info?.autostart;
  $('windows-msg').textContent = '';
  $('hotkey-msg').textContent = hotkey.error || '';
  renderHotkey();
  renderSendTo();
  $('version').textContent = `Send to Daylight ${info?.version ?? ''} for Windows`;
  unpairArmed = null;
  $('unpair').textContent = 'Unpair this PC';
  $(focus).focus();
}

async function onAutostart() {
  const want = $('autostart').checked;
  try {
    info.autostart = await bridge.setAutostart(want);
    $('autostart').checked = info.autostart;
    $('windows-msg').textContent = info.autostart ? 'Send to Daylight starts when you sign in to Windows.' : '';
  } catch (e) {
    $('autostart').checked = !want;
    $('windows-msg').textContent = `Couldn’t change that: ${e?.message ?? e}`;
  }
}

async function onAddSendTo() {
  try {
    info.sendTo = await bridge.addSendTo();
    renderSendTo();
    $('windows-msg').textContent = 'Added. Right-click a file, then Send to › Daylight.';
  } catch (e) {
    $('windows-msg').textContent = `Couldn’t add it: ${e?.message ?? e}`;
  }
}

async function onUnpair() {
  const b = $('unpair');
  if (!unpairArmed) {
    b.textContent = 'Click again to unpair (unsent items are discarded)';
    unpairArmed = setTimeout(() => { unpairArmed = null; b.textContent = 'Unpair this PC'; }, 5000);
    return;
  }
  clearTimeout(unpairArmed);
  unpairArmed = null;
  try {
    await app.unpair();
    st = await app.state();
    rows = [];
    setStatus('');
    renderPair();
  } catch (e) { b.textContent = e.message; }
}

// --- Lab (LAB-PLAN 1, 1.5, 2.6; card WIN0) ---------------------------------------------------------------------------

/** How long a gate may take before its note says LAB_TEXT.checking (1.5). */
const CHECKING_AFTER_MS = 150;
let labSeq = 0; // the Lab view drawn last: a slower answer for an earlier one is dropped
let labBlockSeq = 0;
let setupSaid = null; // the setup's done line, said once the server section is drawn again

/** Lab's Copy: Rust writes the clipboard. -> true, or why it couldn't (the system's words). */
async function copyText(text, what = 'the Server code') {
  try { await bridge.writeClipboard(text); note(`copied ${what}`); return true; } catch (e) { return String(e?.message ?? e); }
}

/** The settings Lab's Wave 1 reads in the window: the switch, the Use switches, the note (1.2, 6.5 Q5). */
async function readLabSettings() {
  try { labSettings = (await app.getSettings()) ?? {}; } catch { return; }
  const was = labIsOn;
  labIsOn = labSettings.lab !== false;
  renderClipLabel();
  renderNote();
  if (was !== labIsOn) {
    // The rows' words change with Lab (v1.1's or the timeline's): that is no new state to announce.
    lastLabel.clear();
    await refreshTimeline();
    if (view === 'view-send') renderSend();
  }
}

/** The one-time note (1.2): above the pairing screen or the send view, while Lab is on, until OK. */
function renderNote() {
  const box = $('lab-note');
  const due = LAB_NOTE_ENABLED && labIsOn && !labSettings.labNoteShown && (view === 'view-pair' || view === 'view-send');
  if (!due) { hideBox('lab-note'); return; }
  if (box.firstChild) { box.hidden = false; return; }
  renderLabNote(box, {
    onOk: async () => {
      hideBox('lab-note');
      labSettings = { ...labSettings, labNoteShown: true };
      try { await app.lab.noteSeen(); } catch (e) { note(`note not kept: ${e?.message ?? e}`); }
      (view === 'view-send' ? $('send-clip') : $('code')).focus();
    },
  });
}

/**
 * Settings' Lab block (1.1): the switch; with Lab on, What's in Lab › and Daylight server ›, whose subtitle is the
 * server's short state ("Optional · Not set up"): the last answer at once, then a fresh one when it is over 10 minutes
 * old (within the gate's 5 s). With Lab off only the switch and its footer show (1.3).
 */
async function renderLabBlock() {
  const seq = ++labBlockSeq;
  $('lab').checked = labIsOn;
  $('lab-rows').hidden = !labIsOn;
  if (!labIsOn) return;
  try {
    let r = await app.lab.state({ refresh: false });
    if (seq !== labBlockSeq) return;
    $('server-sub').textContent = r.serverSubtitle ?? '';
    r = await app.lab.state({ refresh: true });
    if (seq === labBlockSeq && r.lab) $('server-sub').textContent = r.serverSubtitle ?? '';
  } catch (e) { note(`Lab state: ${e?.message ?? e}`); }
  writeStatusSoon();
}

async function onLab() {
  const want = $('lab').checked;
  $('lab-msg').textContent = '';
  labIsOn = want;
  $('lab-rows').hidden = !want;
  try {
    labIsOn = (await app.lab.setLab(want)).lab;
    lastLabel.clear(); // the rows' words change with Lab: no new state to announce
    note(`lab ${labIsOn ? 'on' : 'off'}`);
  } catch (e) {
    labIsOn = !want;
    $('lab-msg').textContent = `Couldn’t change that: ${e?.message ?? e}`;
  }
  renderLabBlock();
  await readLabSettings();
  await refreshTimeline();
  writeStatusSoon();
}

/** A click on a feature runs its gate (1.5). Not ready: its one sentence under the row, with Copy Server code for needs-server. */
async function onFeature(f, box) {
  const timer = setTimeout(() => labNote(box, LAB_TEXT.checking, { state: 'checking', ok: false }), CHECKING_AFTER_MS);
  let r;
  try {
    r = await app.lab.gate(f.id);
  } catch (e) {
    r = { ready: false, state: 'error', message: e?.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
  note(`lab gate ${f.id}: ${r.state}`);
  if (r.ready) {
    // Ready: the feature opens (Setup check), or its switch takes the focus; the others live in the send view.
    clearNote(box);
    if (f.id === 'F26') { openSetup(); return; }
    box.closest('li.lab-feature')?.querySelector('input.switch')?.focus();
    return;
  }
  const shown = labNote(box, r.message, {
    state: r.state, button: r.button,
    onButton: async (b) => {
      if (r.state === 'needs-server') {
        const done = await copyText(r.serverCode ?? '');
        noteFollowUp(shown, done === true ? LAB_TEXT.setup.copied : done);
      }
      b.focus();
    },
  });
  writeStatusSoon();
}

/**
 * A newer What's in Lab answer: lines change in place; a list with other features is drawn again, unless a note is
 * open. data-fresh="1" once the server's live answer is on screen (not the cached states).
 */
function updateWhats(box, model) {
  if (!updateWhatsInLab(box, model) && !box.querySelector('.lab-note > *')) renderWhatsInLab(box, model, { onTap: onFeature, use: useControls(model) });
  if (model.fresh && !model.cached) box.dataset.fresh = '1';
}

/**
 * The switches on What's in Lab's rows: a Use switch (6.5 Q5) on Clean links and Send copied link, and "Allow quick
 * sends from other apps" with its footer on Shortcuts and automation (F09). model.settings: lab.overview()'s.
 */
function useControls(model) {
  const set = model.settings ?? { use: {}, quickSends: false };
  return (f) => {
    if (USE_SWITCHES.includes(f.id)) {
      return useSwitch(f, set.use?.[f.id] !== false, async (want) => {
        const now = await app.lab.setUse(f.id, want);
        note(`use ${f.id} ${now ? 'on' : 'off'}`);
        await readLabSettings();
        return now;
      });
    }
    if (f.id === 'F09') {
      const A = LAB_TEXT.automation;
      return featureSwitch({
        label: A.quickSends, footer: A.quickSendsFooter, checked: set.quickSends,
        onChange: async (want) => { const now = await app.lab.setQuickSends(want); note(`quick sends ${now ? 'on' : 'off'}`); return now; },
      });
    }
    return null;
  };
}

/**
 * What's in Lab (1.4): the cached states at once (the server's answer of the last 10 minutes, 1.5), else "Checking your
 * Daylight server…" on the heading; then the ack topic and the server, asked now, update the lines in place.
 * focus: a feature whose switch gets the focus, in view with its footer ("Open setting", 1.5), else Back has it.
 */
async function openWhats({ focus = null } = {}) {
  const seq = ++labSeq;
  show('view-whats');
  const box = $('whats');
  box.textContent = '';
  box.dataset.fresh = '0';
  $('whats-back').focus();
  let model;
  try { model = await app.lab.overview({ refresh: false }); } catch (e) { box.textContent = e?.message ?? String(e); return; }
  if (seq !== labSeq || view !== 'view-whats') return;
  if (!model.lab) { renderSettings(); return; }
  renderWhatsInLab(box, model, { onTap: onFeature, checking: !model.fresh, use: useControls(model) });
  if (focus) showFeatureSwitch(box, focus);
  try { model = await app.lab.overview({ refresh: true }); } catch { return; }
  if (seq !== labSeq || view !== 'view-whats' || !model.lab) return;
  updateWhats(box, model);
  // The live answer's lines can move the switch (and a list drawn again loses the focus): the switch again, in view
  // with its footer, unless the user has moved on.
  const at = document.activeElement;
  if (focus && (!at || at === document.body || at === switchOf(box, focus))) showFeatureSwitch(box, focus);
  writeStatusSoon();
}

/** A feature's switch on What's in Lab, or null. */
const switchOf = (box, id) => box.querySelector(`li.lab-feature[data-feature="${id}"] .lab-use input.switch`);

/** A feature's switch on What's in Lab ("Open setting", 1.5): focused, and scrolled into view with its footer. */
function showFeatureSwitch(box, id) {
  const input = switchOf(box, id);
  if (!input) return;
  input.focus({ preventScroll: true });
  input.closest('.lab-use').scrollIntoView({ block: 'nearest' });
}

/** The Daylight server section (2.6). Drawn again after a setup, a move or a new address. */
async function renderServer() {
  const seq = ++labSeq;
  const box = $('server');
  box.dataset.fresh = '0';
  if (!box.firstChild) {
    // While the server is asked (within the gate's 5 s): the checking line where the state goes.
    const b = noteBox();
    labNote(b, LAB_TEXT.checking, { state: 'checking', ok: false });
    box.append(b);
  }
  let model;
  try { model = await app.lab.serverView(); } catch (e) { box.textContent = e?.message ?? String(e); return; }
  if (seq !== labSeq || view !== 'view-server') return;
  if (!model.lab) { renderSettings(); return; }
  const said = setupSaid;
  setupSaid = null;
  renderServerSection(box, model, {
    copy: copyText,
    // "Moved … Use it?" (2.6): the new address is pinned and the section drawn again from it; the focus goes to its
    // heading, so the new state is read next.
    move: async (yes) => {
      if (!yes) return;
      note(`server moved: ${await app.lab.confirmMove()}`);
      await renderServer();
      $('server-h').focus();
    },
    setupCheck: (link) => app.lab.checkSetupLink(link),
    setup: async (link) => {
      const r = await app.lab.setupServer(link);
      note(`server setup: ${r.done ? 'done' : r.error}`);
      if (r.done) { setupSaid = r.done; await renderServer(); }
      return r;
    },
    setupSaid: said ?? undefined,
    saveAddress: async (url) => {
      const r = await app.lab.setServerAddress(url);
      if (!r.error) await renderServer();
      return r;
    },
  });
  box.dataset.fresh = '1';
  writeStatusSoon();
}

async function openServer() {
  show('view-server');
  $('server').textContent = '';
  $('server-back').focus();
  await renderServer();
}

/** The re-pairing follow-up in the send view (2.6, DESIGN 12.7), while Lab is on and until OK. */
async function renderRepairedBlock() {
  const box = $('lab-repaired');
  let r = null;
  try { r = (await app.lab.repaired()).repaired; } catch { r = null; }
  box.hidden = !r;
  if (!r) { box.textContent = ''; return; }
  renderRepaired(box, r, {
    copy: copyText,
    ok: async () => {
      try { await app.lab.repairSeen(); } catch { /* shown again next time */ }
      box.hidden = true;
      box.textContent = '';
      $('send-clip').focus();
    },
  });
}

/** Back from a Lab view: Settings, with the focus on the row that opened it (Setup check: What's in Lab). */
function backToSettings() {
  if (view === 'view-setup') { openWhats(); return; }
  renderSettings({ focus: view === 'view-server' ? 'open-server' : 'open-whats' });
}

// --- Setup check (F26) ----------------------------------------------------------------------------------------------

/** Setup check's test article, as far as it got: its title, the timeline's label and the two ticks (F26.1). */
function testModel() {
  const row = rows.find((r) => r.id === testId);
  if (testError) return { title: '', label: testError, delivered: false, reader: false };
  if (!row) return null;
  const tl = labTl ?? { lab: true, states: {} };
  const s = tl.states?.[row.id]?.s;
  return {
    title: displayTitle(row), label: labRowText(row, tl, { online: navigator.onLine !== false }).label,
    delivered: row.status === 'delivered', reader: row.status === 'delivered' && (s === 'reader' || s === 'queued'),
  };
}

/** Setup check's lines, from what this PC says (F26): pairing, Send to, start at login, the hotkey, notifications. */
async function setupModel() {
  let notifications = 'unknown';
  try { notifications = await bridge.notificationsState(); } catch { /* not said */ }
  return {
    checks: setupChecks({
      paired: st.paired, sendTo: !!info?.sendTo?.exists, autostart: !!info?.autostart, hotkey: !!hotkey.accel && !hotkey.error,
      notifications,
    }),
    test: testModel(),
    activity: await app.lab.activity().catch(() => []),
  };
}

async function openSetup() {
  const seq = ++labSeq;
  show('view-setup');
  $('setup').textContent = '';
  $('setup-back').focus();
  const model = await setupModel();
  if (seq !== labSeq || view !== 'view-setup') return;
  renderSetupCheck($('setup'), model, { fix: onCheckFix, test: onTestSend, copy: copyDiagnostics });
  writeStatusSoon();
}

/** The test's progress and the activity log change in place (the focus stays). */
async function updateSetup() {
  if (view !== 'view-setup' || !$('setup').firstChild) return;
  updateSetupCheck($('setup'), { test: testModel(), activity: await app.lab.activity().catch(() => []) });
  writeStatusSoon();
}

/** An unmet check's button opens where it is set (F26.3): this app's Settings, the pairing screen, or Windows'. */
async function onCheckFix(c) {
  note(`setup fix ${c.id}`);
  if (c.fix === 'notifications') { bridge.openNotificationSettings().catch((e) => note(`open settings: ${e?.message ?? e}`)); return; }
  if (c.fix === 'pairing') { $('code').value = ''; $('relay').value = ''; renderPair(); return; }
  const focus = c.fix === 'sendTo' ? (info?.sendTo?.path ? 'sendto-add' : 'sendto-text') : c.fix === 'autostart' ? 'autostart' : 'hotkey-change';
  renderSettings({ focus: focus === 'sendto-text' ? 'close-settings' : focus });
}

/** "Send a test article" (F26): the checklist then follows it along the timeline. */
async function onTestSend(button) {
  button.disabled = true;
  testError = '';
  try {
    const row = await app.sendTestArticle();
    testId = row.id;
    note(`test article ${row.id} (${row.status})`);
  } catch (e) {
    testError = e?.message ?? String(e);
  } finally {
    button.disabled = false;
  }
  await refreshTimeline();
  await updateSetup();
}

/** "Copy diagnostics" (F26): redacted, onto the clipboard. -> true or why not */
async function copyDiagnostics() {
  let text;
  try { text = await app.lab.diagnostics({ version: info?.version ?? '', rows }); } catch (e) { return String(e?.message ?? e); }
  return copyText(text, 'the diagnostics');
}

// --- start ----------------------------------------------------------------------------------------------------------

function renderSend() {
  show('view-send');
  $('daylight-name').textContent = st.name || 'your Daylight';
  renderHotkey();
  renderClipLabel();
  renderHistory();
  renderRepairedBlock();
  renderSendQuestion();
}

/** The send link question's note as the window shows it (F09's needs-quick-sends): {note, noteButton}, or none. */
function sendQuestionNote() {
  const n = $('lab-sendlink').querySelector('.lab-question-note .lab-note-body');
  if (!n) return {};
  return { note: n.querySelector('.lab-note-text')?.textContent ?? '', noteButton: n.querySelector('.lab-note-fix')?.textContent ?? '' };
}

/** The end-to-end test reads the outbox from a file (only with --e2e-status; Rust ignores this otherwise). */
let statusTimer = null;
function writeStatusSoon() {
  if (!info?.e2e?.status) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(async () => {
    try {
      const snap = await app.snapshot();
      const c = view === 'view-confirm' ? pendingPair?.confirm : null;
      Object.assign(snap, {
        version: info.version, hotkey, autostart: !!info.autostart, sendTo: info.sendTo, view, comfort,
        confirm: c ? { title: c.title, lines: c.lines, button: c.button } : null,
        statusText: $('status').textContent, pairError: $('pair-error').textContent, log: log.slice(-50),
        // Lab, Wave 1: the send link's question (F09), the clipboard button's words (F33), the one-time note (1.2),
        // the check-in header (F01) and whether the window was hidden (F01's toast shows only then).
        sendQuestion: pendingSend && labIsOn ? { title: pendingSend.title, lines: pendingSend.lines, ...sendQuestionNote() } : null,
        clipButton: $('send-clip').textContent, noteShown: !$('lab-note').hidden, checkInShown: $('lab-checkin').hidden ? '' : $('lab-checkin').textContent,
        hidden: !seen(),
      });
      await bridge.e2eStatus(JSON.stringify(snap, null, 2));
    } catch (e) { console.warn('Send to Daylight: status file', e); }
  }, 80);
}

/** Settings' Back (and Esc): to the view Settings was opened from. */
function closeSettings() {
  if (settingsFrom === 'view-pair' || !st.paired) renderPair(); else renderSend();
  $('open-settings').focus();
}

function onKey(e) {
  if (recording) { onRecordKey(e); return; }
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (view === 'view-whats' || view === 'view-server') backToSettings();
  else if (view === 'view-settings') closeSettings();
  else if (view === 'view-confirm') onConfirm(false);
  else if (view === 'view-pair' && st.paired) { renderSend(); $('open-settings').focus(); }
  else if (view === 'view-send') bridge.hideWindow().catch(() => {});
}

/** Saved data that couldn't be read (a power cut mid-write, say) was set aside by appStorage: say so, carry on. */
function onBadData(key, e) {
  const what = key === 'pairing' ? 'The saved pairing couldn’t be read. Pair again.'
    : key === 'outbox' ? 'The history couldn’t be read, so it starts afresh. Send again anything not yet delivered.'
      : 'Some settings couldn’t be read and were reset.';
  note(`set aside ${key}: ${e?.message ?? e}`);
  if (!dataProblem) dataProblem = what;
  if (ready) { if (st.paired) setStatus(what, true); else $('pair-error').textContent = what; }
  writeStatusSoon();
}

/** Whether someone can see the window: Rust says it is on screen and the page isn't hidden. */
const seen = () => onScreen && !document.hidden;

function onShown() {
  if (!app) return;
  app.setVisible(seen());
  if (!seen()) return;
  app.tickIfStale();
  if (view === 'view-send') renderHistory();
}

/**
 * F01's toast (2.5): a row the ledger says is in the Reader now, while the window is hidden: "In your Reader: {title}".
 * With the window showing, its row says so.
 */
async function onReader(row) {
  if (!labIsOn) return;
  // Asked of Rust now: the window may have been hidden or shown since the last event.
  try { onScreen = await bridge.windowShown(); } catch { /* the last word stays */ }
  if (seen()) { note(`in the Reader ${row.id.slice(0, 8)} (window shown: no toast)`); return; }
  const title = fillText(LAB_TEXT.readerToast, { title: displayTitle(row) });
  note(`toast: ${title}`);
  notifyNow(title, LAB_TEXT.rows.reader.sentence).catch(() => {});
}

/** A notification through Rust; in test mode the status file's log says what it said (F08's "Sent to {name}", F01). */
function notifyNow(title, body) {
  if (info?.e2e?.status) note(`notified: ${title} — ${body}`);
  return bridge.notify(title, body);
}

async function init() {
  window.addEventListener('error', (e) => { note(`error: ${e.message}`); writeStatusSoon(); });
  window.addEventListener('unhandledrejection', (e) => { note(`unhandled: ${e.reason?.message ?? e.reason}`); writeStatusSoon(); });
  $('pair-form').addEventListener('submit', onPairSubmit);
  // The relay is one line that wraps (F27.4): Enter pairs, as in a one-line field, and a pasted line break goes.
  $('relay').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('pair-form').requestSubmit(); }
  });
  $('relay').addEventListener('input', () => {
    const r = $('relay');
    if (/[\r\n]/.test(r.value)) r.value = r.value.replace(/\s*[\r\n]+\s*/g, '');
  });
  $('confirm-yes').addEventListener('click', () => onConfirm(true));
  $('confirm-no').addEventListener('click', () => onConfirm(false));
  $('choose').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', () => {
    const files = [...$('file').files];
    $('file').value = '';
    if (files.length) sendFiles(files);
  });
  $('send-clip').addEventListener('click', onSendClipboard);
  $('open-settings').addEventListener('click', () => renderSettings());
  $('close-settings').addEventListener('click', closeSettings);
  $('comfort').addEventListener('change', onComfort);
  $('lab').addEventListener('change', onLab);
  $('open-whats').addEventListener('click', () => openWhats());
  $('open-server').addEventListener('click', openServer);
  $('whats-back').addEventListener('click', backToSettings);
  $('server-back').addEventListener('click', backToSettings);
  $('setup-back').addEventListener('click', backToSettings);
  dismissNotesOnOtherControls($('app'));
  $('repair').addEventListener('click', () => { $('code').value = ''; $('relay').value = ''; renderPair(); });
  $('pair-back').addEventListener('click', () => { renderSend(); $('open-settings').focus(); });
  $('hotkey-change').addEventListener('click', startRecording);
  $('hotkey-off').addEventListener('click', async () => { if (!(await applyHotkey(''))) $('hotkey-msg').textContent = 'The hotkey is off.'; });
  $('autostart').addEventListener('change', onAutostart);
  $('sendto-add').addEventListener('click', onAddSendTo);
  $('unpair').addEventListener('click', onUnpair);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('dragenter', onDragEnter);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('dragleave', onDragLeave);
  document.addEventListener('drop', onDrop);
  document.addEventListener('visibilitychange', onShown);
  window.addEventListener('focus', onShown);
  // F07: back online, the items that waited for a connection go (Lab on); the rows say Waiting for connection meanwhile.
  window.addEventListener('online', () => { note('online'); app?.onOnline(); if (view === 'view-send') renderHistory(); writeStatusSoon(); });
  window.addEventListener('offline', () => { note('offline'); if (view === 'view-send') renderHistory(); writeStatusSoon(); });

  try {
    info = await bridge.info();
  } catch (e) {
    show('view-send');
    setStatus(`Send to Daylight couldn’t start: ${e?.message ?? e}`, true);
    $('app').setAttribute('aria-busy', 'false');
    return;
  }
  app = createApp({
    bridge: { ...bridge, notify: notifyNow }, storage: appStorage(console, onBadData), version: info.version,
    online: () => navigator.onLine !== false, onReader,
  });
  app.onChange(onStorageChange);
  note(`started ${info.version}${info.e2e?.status ? ' (test mode)' : ''}`);

  // Listen before reading anything saved, so a read that fails can't leave Send To, links and the hotkey unheard.
  // Their actions wait in Rust's queue until the first view is drawn (drain() below).
  await bridge.onWake(() => { if (ready) drain(); });
  await bridge.onTick(() => app.tick().catch(() => {}));
  await bridge.onAutostart((on) => { info.autostart = !!on; $('autostart').checked = !!on; note(`start at login ${on ? 'on' : 'off'}`); writeStatusSoon(); });
  await bridge.onShownChange((on) => { onScreen = !!on; onShown(); writeStatusSoon(); });
  try { onScreen = !!(await bridge.windowShown()); } catch { onScreen = !document.hidden; }

  // Lab (LAB-PLAN 1.2): a missing switch means on, and the first start of a build with Lab writes it. In test mode,
  // --e2e-lab 0|1 sets it (1.7), as a click on the switch would.
  try {
    await app.lab.ensureDefault();
    if (info.e2e?.status && typeof info.e2e.lab === 'boolean') {
      await app.lab.setLab(info.e2e.lab);
      note(`lab ${info.e2e.lab ? 'on' : 'off'} (--e2e-lab)`);
    }
  } catch (e) { note(`couldn’t save the Lab switch: ${e?.message ?? e}`); }

  let settings = {};
  try { settings = await app.getSettings(); } catch (e) { onBadData('settings', e); }
  applyComfort(settings.comfort);
  labIsOn = settings.lab !== false;
  labSettings = settings ?? {};
  await refreshTimeline();
  renderClipLabel(); // the tray's clipboard entry too (F33)
  await applyHotkey(settings.hotkey ?? DEFAULT_HOTKEY, { save: false });

  if (info.e2e?.pair) {
    try {
      const r = await app.pair(info.e2e.pair);
      note(`paired with ${r.name} at ${r.relay}`);
    } catch (e) { note(`pairing failed: ${e?.message ?? e}`); }
  }

  try {
    st = await app.state();
    rows = await app.rows();
  } catch (e) {
    rows = [];
    dataProblem ||= `Couldn’t read the history (${e?.message ?? e}).`;
    note(dataProblem);
  }
  if (st.paired) renderSend(); else renderPair();
  if (dataProblem) {
    if (st.paired) setStatus(dataProblem, true); else $('pair-error').textContent = dataProblem;
  }

  ready = true;
  app.setVisible(seen());
  drain();
  app.start();
  setInterval(() => { if (!document.hidden && view === 'view-send') renderHistory(); }, 60 * 1000);

  $('app').setAttribute('aria-busy', 'false');
  document.body.dataset.ready = '1';
  writeStatusSoon();
}

init();
