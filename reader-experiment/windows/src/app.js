// The window: pairing, the drop zone, "Send the link on the clipboard", the history and the settings. Sending and the
// outbox live in core.js (with daylight-share.js); bridge.js talks to the Rust side. The window can be hidden (closed
// to the tray) for days: this page keeps running, handles Send To and the hotkey, and keeps the outbox moving.

import { bridge, appStorage } from './bridge.js';
import { createApp, serial, MAX_FILE, tooBig } from './core.js';
import { ShareError } from './daylight-share.js';
import {
  rowView, kindLabel, displayTitle, relativeTime, sendSummary, linkFromDrop, accelFromEvent, describeAccel,
  hostOf, DEFAULT_HOTKEY,
} from './logic.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['view-pair', 'view-confirm', 'view-send', 'view-settings'];
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
  writeStatusSoon();
}

function show(v) {
  view = v;
  for (const id of VIEWS) $(id).hidden = id !== v;
  $('open-settings').hidden = v !== 'view-send';
  writeStatusSoon();
}

// --- pairing --------------------------------------------------------------------------------------------------------

function renderPair(error = '') {
  show('view-pair');
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
  if (hook === 'confirm') await onConfirm(true);
  else if (hook === 'cancel') await onConfirm(false);
}

// --- sending --------------------------------------------------------------------------------------------------------

function setBusy(busy) {
  $('choose').disabled = busy;
  $('send-clip').disabled = busy;
  $('app').setAttribute('aria-busy', busy ? 'true' : 'false');
}

function showResults(results) {
  if (!results?.length) return;
  for (const r of results) note(r.row ? `sent ${r.row.kind} ${r.row.id} (${r.row.status}${r.row.error ? ': ' + r.row.error : ''})` : `not sent ${r.name}: ${r.error}`);
  if (results.length === 1 && results[0].code === 'no-link') { setStatus(`No link on the clipboard. ${results[0].error}`, true); return; }
  const s = sendSummary(results);
  const bad = results.some((r) => !r.row || r.row.status === 'failed');
  setStatus(`${bad ? '' : '✓ '}${s.title}. ${s.body}`, bad);
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
  showResults(results);
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

async function sendLinkFromWindow(link, title) {
  setBusy(true);
  setStatus('Sending the link…');
  try {
    showResults([await app.settle(hostOf(link) || link, () => app.sendLink(link, title))]);
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
  const link = linkFromDrop({ uriList, text });
  if (!link) { setStatus('Only files and web links (http and https) can be sent.', true); return; }
  sendLinkFromWindow(link, titleFromHtml(html, link));
}

async function onSendClipboard() {
  let clip;
  try { clip = { text: await bridge.readClipboard(), error: '' }; } catch (e) { clip = { text: '', error: String(e?.message ?? e) }; }
  setBusy(true);
  try { showResults(await app.sendClipboard(clip)); } finally { setBusy(false); }
}

async function retry(id, button) {
  button.disabled = true;
  button.textContent = 'Sending…';
  try { showResults([{ row: await app.retry(id) }]); } catch (e) { setStatus(e.message, true); }
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
        else if (a.type === 'test') await onTestHook(a.hook);
        else showResults(await app.handleAction(a));
      } catch (e) {
        note(`action ${a.type} failed: ${e?.message ?? e}`);
      }
    }
    writeStatusSoon();
  });
}

// --- history --------------------------------------------------------------------------------------------------------

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
    const v = rowView(row);
    const meta = el('div', 'item-meta');
    meta.append(el('span', `st ${v.tone}`, v.label), el('span', 'when', `· ${relativeTime(row.created)}`));
    if (v.retry) {
      const b = el('button', 'retry', v.retryLabel);
      b.type = 'button';
      b.setAttribute('aria-label', `${v.retryLabel}: ${displayTitle(row)}`);
      b.addEventListener('click', () => retry(row.id, b));
      meta.append(b);
    }
    li.append(line, meta);
    if (v.sentence) li.append(el('p', `note${v.tone === 'bad' ? ' bad' : ''}`, v.sentence));
    list.append(li);
  }
}

let refreshTimer = null;
function onStorageChange(key) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      rows = await app.rows();
      if (key === 'pairing') st = await app.state();
    } catch (e) { note(`couldn’t read the history: ${e?.message ?? e}`); }
    if (view === 'view-send') { $('daylight-name').textContent = st.name || 'your Daylight'; renderHistory(); }
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

function renderSettings() {
  show('view-settings');
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
  $('close-settings').focus();
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

// --- start ----------------------------------------------------------------------------------------------------------

function renderSend() {
  show('view-send');
  $('daylight-name').textContent = st.name || 'your Daylight';
  renderHotkey();
  renderHistory();
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
        version: info.version, hotkey, autostart: !!info.autostart, sendTo: info.sendTo, view,
        confirm: c ? { title: c.title, lines: c.lines, button: c.button } : null,
        statusText: $('status').textContent, pairError: $('pair-error').textContent, log: log.slice(-50),
      });
      await bridge.e2eStatus(JSON.stringify(snap, null, 2));
    } catch (e) { console.warn('Send to Daylight: status file', e); }
  }, 80);
}

function onKey(e) {
  if (recording) { onRecordKey(e); return; }
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (view === 'view-settings') { renderSend(); $('open-settings').focus(); }
  else if (view === 'view-confirm') onConfirm(false);
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

function onShown() {
  if (!app || document.hidden) return;
  app.tickIfStale();
  if (view === 'view-send') renderHistory();
}

async function init() {
  window.addEventListener('error', (e) => { note(`error: ${e.message}`); writeStatusSoon(); });
  window.addEventListener('unhandledrejection', (e) => { note(`unhandled: ${e.reason?.message ?? e.reason}`); writeStatusSoon(); });
  $('pair-form').addEventListener('submit', onPairSubmit);
  $('confirm-yes').addEventListener('click', () => onConfirm(true));
  $('confirm-no').addEventListener('click', () => onConfirm(false));
  $('choose').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', () => {
    const files = [...$('file').files];
    $('file').value = '';
    if (files.length) sendFiles(files);
  });
  $('send-clip').addEventListener('click', onSendClipboard);
  $('open-settings').addEventListener('click', renderSettings);
  $('close-settings').addEventListener('click', () => { renderSend(); $('open-settings').focus(); });
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

  try {
    info = await bridge.info();
  } catch (e) {
    show('view-send');
    setStatus(`Send to Daylight couldn’t start: ${e?.message ?? e}`, true);
    $('app').setAttribute('aria-busy', 'false');
    return;
  }
  app = createApp({ bridge, storage: appStorage(console, onBadData), version: info.version });
  app.onChange(onStorageChange);
  note(`started ${info.version}${info.e2e?.status ? ' (test mode)' : ''}`);

  // Listen before reading anything saved, so a read that fails can't leave Send To, links and the hotkey unheard.
  // Their actions wait in Rust's queue until the first view is drawn (drain() below).
  await bridge.onWake(() => { if (ready) drain(); });
  await bridge.onTick(() => app.tick().catch(() => {}));
  await bridge.onAutostart((on) => { info.autostart = !!on; $('autostart').checked = !!on; note(`start at login ${on ? 'on' : 'off'}`); writeStatusSoon(); });

  let settings = {};
  try { settings = await app.getSettings(); } catch (e) { onBadData('settings', e); }
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
  drain();
  app.start();
  setInterval(() => { if (!document.hidden && view === 'view-send') renderHistory(); }, 60 * 1000);

  $('app').setAttribute('aria-busy', 'false');
  document.body.dataset.ready = '1';
  writeStatusSoon();
}

init();
