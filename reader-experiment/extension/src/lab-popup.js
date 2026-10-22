// The popup's Lab pieces (LAB-PLAN 3.3, card X1, Wave 1): the delivery timeline's rows and check-in header (F01, 2.5),
// the queue of what waits to send (F07), Send as (F10), the share-in-place card (F04), Paste and send (F33), the F02
// entry point, the thin-page question (F10), the excerpt line (F11) and the one-time note (1.2). popup.js calls them
// only while Lab is on; with Lab off the popup is v1.1's. DOM only: the caller passes the data and what a button does.
// Every word is LAB_TEXT's, the protocol module's (describeRow) or the data's.

import {
  LAB_TEXT, describeLabRow, labRowA11yLabel, fillText,
} from './daylight-lab.js';
import { statusInfo, kindLabel, displayTitle, relativeTime, ACTION_LABELS } from './logic.js';
import { el, noteBox, labNote } from './lab-ui.js';
import { SEND_MODES } from './lab-send.js';

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

function button(text, cls = 'btn secondary') {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}

// --- 1.2: the one-time note -------------------------------------------------------------------------------------------

/** The one-time note (1.2) in `box`: LAB_TEXT.note with OK, which calls onOk (the caller marks it seen). */
export function renderLabNote(box, { onOk } = {}) {
  box.textContent = '';
  const body = el('div', 'lab-note-body');
  body.setAttribute('role', 'note');
  body.append(el('p', 'lab-note-text', LAB_TEXT.note));
  const acts = el('div', 'lab-note-acts');
  const ok = button(LAB_TEXT.noteButton);
  ok.addEventListener('click', () => onOk?.());
  acts.append(ok);
  body.append(acts);
  box.append(body);
  box.hidden = false;
}

// --- F01: the timeline's rows (2.5) -----------------------------------------------------------------------------------

/**
 * The row text as the timeline shows it: describeLabRow's {label, sentence, action, stepLine, final}. ctx: the
 * background's timeline ({inboxLab, caps, states}) and online.
 */
export function labRowText(row, ctx, now = Date.now()) {
  return describeLabRow(row, now, {
    lab: true, inboxLab: !!ctx?.inboxLab, hasCap: ctx?.caps ?? [], state: ctx?.states?.[row.id] ?? null,
    online: ctx?.online !== false,
  });
}

/**
 * One history row with Lab on (2.5, "What a row shows"). Every row shows its title and label. A row from
 * describeLabRow's rules 1 and 4 (no step line) keeps v1.1's layout exactly (statusInfo). Otherwise the sentence and
 * the step line show on the newest row and on every row that is not final; elsewhere the title opens them. The row's
 * accessible text is "{label}. {sentence}" (labRowA11yLabel); the step line is hidden from screen readers.
 * on: {retry(id, button), remove(id, button)}; cancel: the queue's Cancel instead of Remove (F07). v1.1's button
 * (Retry now, Try again) stays beside Cancel wherever describeLabRow keeps it (F01.4): a row waiting for a connection
 * has none, since it goes by itself when the network is back.
 */
export function renderLabRow(row, ctx, { newest = false, now = Date.now(), on = {}, cancel = false } = {}) {
  const d = labRowText(row, ctx, now);
  const li = el('li');
  li.dataset.id = row.id;
  li.dataset.status = row.status;
  const st = ctx?.states?.[row.id]?.s;
  if (row.status === 'delivered' && st) li.dataset.labState = st;
  const title = displayTitle(row);
  const line = el('div', 'item-line');
  const kind = el('span', 'kind', kindLabel(row));
  const lab = d.stepLine !== null;
  const showAll = !lab || newest || !d.final;
  let titleEl;
  if (showAll) {
    titleEl = el('span', 'item-title', title);
  } else {
    // A settled row: its title opens its sentence and step line (its details).
    titleEl = button(title, 'item-title item-open');
    titleEl.setAttribute('aria-expanded', 'false');
  }
  titleEl.title = row.url || row.name || '';
  line.append(kind, titleEl);

  const info = statusInfo(row, now);
  const meta = el('div', 'item-meta');
  if (lab) {
    const label = el('span', `st ${info.tone}`, d.label);
    label.setAttribute('aria-hidden', 'true');
    meta.append(label, el('span', 'sr-only lab-row-a11y', labRowA11yLabel(d)));
  } else {
    meta.append(el('span', `st ${info.tone}`, info.label));
  }
  meta.append(el('span', 'when', `· ${relativeTime(row.created, now)}`));
  const acts = el('span', 'acts');
  const action = lab ? d.action : info.action;
  const retryLabel = ACTION_LABELS[action] ?? null;
  if (retryLabel) {
    const b = el('button', 'retry', retryLabel);
    b.type = 'button';
    b.setAttribute('aria-label', `${retryLabel}: ${title}`);
    b.addEventListener('click', () => on.retry?.(row.id, b));
    acts.append(b);
  }
  const rmText = cancel ? LAB_TEXT.queue.cancel : 'Remove';
  const rm = el('button', 'remove', rmText);
  rm.type = 'button';
  rm.setAttribute('aria-label', `${rmText}: ${title}`);
  rm.addEventListener('click', () => on.remove?.(row.id, rm));
  acts.append(rm);
  meta.append(acts);
  li.append(line, meta);
  if (row.note) li.append(el('p', 'note', row.note));
  if (!lab) {
    if (info.hint) li.append(el('p', `note sentence${info.tone === 'bad' ? ' bad' : ''}`, info.hint));
    return li;
  }
  const details = [];
  if (d.sentence) {
    const p = el('p', `note sentence${row.status === 'expired' ? ' bad' : ''}`, d.sentence);
    p.setAttribute('aria-hidden', 'true');
    details.push(p);
  }
  if (d.stepLine) {
    const p = el('p', 'lab-steps', d.stepLine);
    p.setAttribute('aria-hidden', 'true');
    details.push(p);
  }
  for (const p of details) { p.hidden = !showAll; li.append(p); }
  if (!showAll) {
    titleEl.addEventListener('click', () => {
      const open = titleEl.getAttribute('aria-expanded') !== 'true';
      titleEl.setAttribute('aria-expanded', String(open));
      for (const p of details) p.hidden = !open;
    });
  }
  return li;
}

/**
 * What a share's answer says with Lab on (CHANGES-v1.1 2.5, LAB-PLAN 2.5): why its link went instead, if it did, then
 * the timeline's label and sentence: "Waiting for connection" while offline (rule 2), v1.1's words otherwise until it
 * is delivered. The popup and review.html say the same. r: {row, note}; ctx as labRowText's. -> {text, bad}
 */
export function labResultMessage(r, ctx, now = Date.now()) {
  const row = r?.row;
  if (!row) return { text: '' };
  const d = labRowText(row, ctx, now);
  const label = /[.…✓]$/.test(d.label) ? d.label : `${d.label}.`;
  return { text: [r.note, d.sentence ? `${label} ${d.sentence}` : label].filter(Boolean).join(' '), bad: row.status === 'expired' };
}

/** The words a row's change is announced with (F27, 2.5): "{label}: {title}" for Lab rows and v1.1's alike. */
export function rowAnnouncement(row, ctx, now = Date.now()) {
  return `${labRowText(row, ctx, now).label}: ${displayTitle(row)}`;
}

/** The check-in header above the history (2.5): "Your Daylight checked in {rel}." */
export function renderCheckIn(p, ctx) {
  p.textContent = ctx?.checkedInText ?? '';
  p.hidden = !p.textContent;
}

// --- F10: Send as -------------------------------------------------------------------------------------------------

/**
 * "Send as: Page ▾" (F10) into `box`: a button that opens the four modes as radio buttons (page, clean article, link,
 * selection). onChange(mode) when one is picked; the line then reads the new mode. -> {set(mode), get()}
 */
export function renderSendAs(box, { mode = 'page', onChange } = {}) {
  const S = LAB_TEXT.sendAs;
  box.textContent = '';
  let current = SEND_MODES.includes(mode) ? mode : 'page';
  const toggle = button('', 'send-as-btn');
  toggle.id = nextId('send-as-btn');
  const list = el('div', 'send-as-menu');
  list.id = nextId('send-as');
  list.setAttribute('role', 'radiogroup');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', list.id);
  list.hidden = true;
  const name = nextId('send-as-mode');
  const radios = new Map();
  for (const m of SEND_MODES) {
    const label = el('label', 'send-as-item');
    const r = el('input');
    Object.assign(r, { type: 'radio', name, value: m });
    r.addEventListener('change', () => {
      if (!r.checked) return;
      set(m);
      onChange?.(m);
      close();
      toggle.focus();
    });
    label.append(r, document.createTextNode(S.menu[m]));
    radios.set(m, r);
    list.append(label);
  }
  list.setAttribute('aria-labelledby', toggle.id);
  const close = () => { list.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', () => {
    const open = list.hidden;
    list.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) radios.get(current)?.focus();
  });
  list.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { close(); toggle.focus(); } });
  function set(m) {
    current = SEND_MODES.includes(m) ? m : 'page';
    toggle.textContent = fillText(S.line, { mode: S.short[current] });
    for (const [k, r] of radios) r.checked = k === current;
  }
  set(current);
  box.append(toggle, list);
  box.hidden = false;
  return { set, get: () => current };
}

/**
 * F11's explicit path while F10's Use switch is off (LAB-PROTOCOL 2.9.6: that switch takes away Send as, not a
 * selection): with text selected, "Send as excerpt" in `box`, beside the page's own buttons, which still send the page
 * as you see it. onSend() on a tap. -> the button
 */
export function renderExcerptButton(box, { onSend } = {}) {
  box.textContent = '';
  const b = button(LAB_TEXT.shareInPlace.sendAsExcerpt);
  b.classList.add('lab-excerpt-btn');
  b.addEventListener('click', () => onSend?.());
  box.append(b);
  box.hidden = false;
  return b;
}

// --- F10: the thin-page question, F02's entry point, F11's line ------------------------------------------------------

/**
 * F10's thin check: "This page looks thin ({n} words). Send the full page instead?" with Send full page and Send
 * anyway. on: {full(), anyway()}.
 */
export function renderThin(box, n, on = {}) {
  const S = LAB_TEXT.sendAs;
  box.textContent = '';
  const ask = el('div', 'lab-note-body lab-thin');
  const q = el('p', 'lab-note-text', fillText(S.thin, { n }));
  q.id = nextId('lab-thin');
  ask.setAttribute('role', 'group');
  ask.setAttribute('aria-labelledby', q.id);
  const full = button(S.sendFull, 'btn primary');
  const anyway = button(S.sendAnyway);
  full.addEventListener('click', () => { box.textContent = ''; box.hidden = true; on.full?.(); });
  anyway.addEventListener('click', () => { box.textContent = ''; box.hidden = true; on.anyway?.(); });
  const acts = el('div', 'lab-note-acts');
  acts.append(full, anyway);
  ask.append(q, acts);
  box.append(ask);
  box.hidden = false;
  full.focus();
}

/**
 * The F02 entry point (3.1): under the too-big sentence, "Send files over 9 MB ›", which runs labGate('files') and
 * shows its note (needs-server, later, …) under it. gate() -> the background's gate answer; fix(r, note) for the note's
 * one button (Copy Server code, Allow).
 */
export function renderBigFiles(box, { gate, fix } = {}) {
  box.textContent = '';
  const b = button(null, 'nav-row lab-big-files');
  b.append(el('span', 'nav-text', LAB_TEXT.bigFiles));
  const notes = noteBox();
  b.addEventListener('click', async () => {
    const r = await gate?.();
    if (!r || r.ready) { notes.textContent = ''; return; }
    const note = labNote(notes, r.message, { state: r.state, button: r.button, onButton: (btn) => fix?.(r, note, btn) });
  });
  box.append(b, notes);
  box.hidden = false;
}

/** A line under the status (F11's "Excerpts wait for a tap on your Daylight for now."). */
export function renderLine(box, text) {
  box.textContent = '';
  box.append(el('p', 'note lab-line', text));
  box.hidden = false;
}

// --- F04: the share-in-place card --------------------------------------------------------------------------------------

/**
 * F04's card in `box`: "Sending to {name}" and, while the countdown runs, Options (stops it and shows the choices);
 * with `choices` at once (no countdown: Comfort, "Always show Options before sending") the choices and Send. linkOnly:
 * the extension can't read this page, so the card says its link will be sent.
 * on: {options() when Options is tapped, choices(box) to draw the choices into a box, send(), sendLink()}.
 * -> {showChoices(), done()}
 */
export function renderCard(box, { name, linkOnly = false, choices = false, on = {} } = {}) {
  const T = LAB_TEXT.shareInPlace;
  box.textContent = '';
  const h = el('p', 'lab-card-title', fillText(T.card, { name: name || T.yourDaylight }));
  h.id = nextId('lab-card');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-labelledby', h.id);
  box.append(h);
  if (linkOnly) box.append(el('p', 'note lab-card-link', T.linkOnlyCard));
  const acts = el('div', 'lab-card-acts');
  const options = button(T.options);
  options.classList.add('lab-card-options');
  options.addEventListener('click', () => { on.options?.(); showChoices(); });
  acts.append(options);
  box.append(acts);
  const panel = el('div', 'lab-card-choices');
  panel.hidden = true;
  box.append(panel);
  box.hidden = false;
  function showChoices() {
    options.remove();
    panel.textContent = '';
    const extra = el('div', 'lab-card-extra');
    panel.append(extra);
    on.choices?.(extra);
    const send = button(T.send, 'btn primary big lab-card-send');
    send.addEventListener('click', () => on.send?.());
    const link = button(T.sendLinkInstead);
    link.classList.add('lab-card-send-link');
    link.addEventListener('click', () => on.sendLink?.());
    panel.append(send, link);
    panel.hidden = false;
    send.focus();
  }
  if (choices) showChoices();
  return {
    showChoices,
    /** The send went (or was answered): the card keeps its line, without buttons. */
    done() { options.remove(); panel.remove(); },
  };
}

// --- F33: Paste and send ------------------------------------------------------------------------------------------

/**
 * "Paste and send" (F33) in `box`: the button reads the clipboard on click (read() -> text), then shows "Send {host}?"
 * with Send and Cancel, or "No link on the clipboard.". parse(text) -> {url, host} | null. send(text) on Send.
 */
export function renderPaste(box, { read, parse, send } = {}) {
  const C = LAB_TEXT.copiedLink;
  box.textContent = '';
  const b = button(C.pasteAndSend);
  b.classList.add('lab-paste-btn');
  const said = el('div', 'lab-paste-said');
  said.setAttribute('aria-live', 'polite');
  b.addEventListener('click', async () => {
    said.textContent = '';
    let text = null;
    try { text = await read?.(); } catch { text = null; }
    const got = text == null ? null : parse?.(text);
    if (!got) { said.append(el('p', 'note lab-paste-none', C.noLink)); return; }
    const ask = el('div', 'lab-note-body lab-paste-confirm');
    const q = el('p', 'lab-note-text', fillText(C.confirmShort, { host: got.host }));
    q.id = nextId('lab-paste');
    ask.setAttribute('role', 'group');
    ask.setAttribute('aria-labelledby', q.id);
    const yes = button(LAB_TEXT.automation.send, 'btn primary');
    const no = button(LAB_TEXT.automation.cancel);
    yes.addEventListener('click', async () => { said.textContent = ''; await send?.(text); b.focus(); });
    no.addEventListener('click', () => { said.textContent = ''; b.focus(); });
    const acts = el('div', 'lab-note-acts');
    acts.append(yes, no);
    ask.append(q, acts);
    said.append(ask);
    yes.focus();
  });
  box.append(b, said);
  box.hidden = false;
}
