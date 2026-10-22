// The Lab screens' building blocks (LAB-PLAN 1.4, 1.5 and 2.6): the needs-setup note, What's in Lab and the Daylight
// server section. The extension's lab.html uses them (lab-page.js), and the web sender's build copies this file (B0).
// DOM only: no extension, storage or network APIs. The caller passes the data (the background's answers) and what a
// button does. Every word comes from LAB_TEXT, the server module or the data.
//
// Class names (styled in popup.css; the web sender styles the same names): .lab-note, .lab-note-text, .lab-note-acts,
// .lab-inbox, .lab-features, .lab-feature, .lab-row, .lab-name, .lab-sentence, .lab-short, .lab-use (W1's Use switch),
// .lab-group, .lab-group-state, .lab-server-*, .lab-repaired*.

import { LAB_TEXT } from './daylight-lab.js';

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function button(text, cls = 'btn secondary') {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}

/**
 * A box for notes, to put right under a control. It is a polite live region from the start, so screen readers say
 * what appears in it (1.5), and it is empty until then.
 */
export function noteBox() {
  const box = el('div', 'lab-note');
  box.setAttribute('aria-live', 'polite');
  return box;
}

/**
 * The needs-setup note (1.5) in `box`: exactly one sentence, at most one button that fixes it from here (Open
 * Settings, Open setting, Copy Server code or Allow), and OK, which closes it. Never a toast, never a dialog: it stays
 * until OK, a tap on another control (dismissNotesOnOtherControls) or leaving the screen.
 * ok: false for a note that is on its way to its answer ("Checking your Daylight server…").
 * -> the note's element (data-state carries `state` for tests).
 */
export function labNote(box, message, { state = '', button: label = null, onButton = null, ok = true } = {}) {
  box.textContent = '';
  const note = el('div', 'lab-note-body');
  if (state) note.dataset.state = state;
  note.append(el('p', 'lab-note-text', message ?? ''));
  if (label || ok) {
    const acts = el('div', 'lab-note-acts');
    if (label) {
      const b = button(label);
      b.classList.add('lab-note-fix');
      b.addEventListener('click', (ev) => { ev.stopPropagation(); onButton?.(b, note); });
      acts.append(b);
    }
    if (ok) {
      const b = button(LAB_TEXT.noteButton);
      b.classList.add('lab-note-ok');
      b.addEventListener('click', (ev) => { ev.stopPropagation(); clearNote(box); });
      acts.append(b);
    }
    note.append(acts);
  }
  box.append(note);
  box.closest('.lab-feature, .lab-server-state')?.classList.add('has-note');
  return note;
}

/** A short line added under a note's sentence ("Copied"), said by the same live region. */
export function noteFollowUp(note, text) {
  note.querySelector('.lab-note-follow')?.remove();
  note.append(el('p', 'lab-note-text lab-note-follow', text));
}

export function clearNote(box) {
  box.textContent = '';
  box.closest('.has-note')?.classList.remove('has-note');
}

/** Closes every note under `root` except the one in `keep` (the server section's state line is not a note to close). */
export function clearNotes(root, keep = null) {
  for (const box of root.querySelectorAll('.lab-note:not(.lab-note-fixed)')) if (box !== keep && box.firstChild) clearNote(box);
}

/** A tap on any control outside a note's own row closes the open notes (1.5). */
export function dismissNotesOnOtherControls(root) {
  root.addEventListener('click', (ev) => {
    const control = ev.target.closest?.('button, input, select, textarea, a, summary');
    if (!control) return;
    const own = control.closest('.lab-feature, .lab-server-state');
    clearNotes(root, own?.querySelector('.lab-note') ?? null);
  }, true);
}

/**
 * Copies text to the clipboard: the async Clipboard API, else (it failed, or gave no answer within a second and a half,
 * as in a page without focus) a selected textarea and execCommand('copy'). -> true when it was copied.
 */
export async function copyText(text) {
  try {
    const wrote = navigator.clipboard?.writeText?.(text);
    if (wrote && await Promise.race([wrote.then(() => true, () => false), new Promise((r) => { setTimeout(() => r(false), 1500); })])) return true;
  } catch { /* try the old way */ }
  const t = el('textarea');
  t.value = text;
  t.setAttribute('readonly', '');
  t.style.position = 'fixed';
  t.style.opacity = '0';
  document.body.append(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  t.remove();
  return ok;
}

/**
 * One feature of What's in Lab (1.4): a control with its name (the accessible name), its sentence and its short state
 * (both its description), then W1's Use switch (6.5 Q5) when there is one, and the note box under them.
 * f: {id, name, sentence, short (null: nothing shown)}. onTap(f, box, row) runs the feature's gate.
 * use(f): an element for the feature's Use switch (X1, for the features that have one), or null; it goes in a .lab-use
 * block.
 */
export function featureRow(f, { onTap, use = null } = {}) {
  const li = el('li', 'lab-feature');
  li.dataset.feature = f.id;
  const row = button(null, 'lab-row');
  const name = el('span', 'lab-name', f.name);
  name.id = nextId('lab-name');
  const sentence = el('span', 'lab-sentence', f.sentence);
  sentence.id = nextId('lab-sentence');
  row.append(name, sentence);
  row.setAttribute('aria-labelledby', name.id);
  row.setAttribute('aria-describedby', sentence.id);
  setShort(row, f.short);
  const box = noteBox();
  row.addEventListener('click', () => onTap?.(f, box, row));
  li.append(row);
  const control = use?.(f);
  if (control) {
    const slot = el('div', 'lab-use');
    slot.append(control);
    li.append(slot);
  }
  li.append(box);
  return li;
}

/** A feature row's short state (part of its description), or none (null). */
function setShort(row, short) {
  let span = row.querySelector('.lab-short');
  const described = (row.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id && id !== span?.id);
  if (!short) {
    span?.remove();
  } else {
    if (!span) {
      span = el('span', 'lab-short');
      span.id = nextId('lab-short');
      row.append(span);
    }
    span.textContent = short;
    described.push(span.id);
  }
  row.setAttribute('aria-describedby', described.join(' '));
}

/**
 * What's in Lab (1.4) into `box`: the Inbox's Lab state as the header line, one row per feature this build has, then
 * the server features under their heading, with the server's short state as the heading's line. A server feature's
 * row shows its own short state only when it differs from the heading's (the data says so: short null).
 * model: the background's overview {header, features, server: {short, features}}; checking: true while the server's
 * state is on its way (the heading's line then says LAB_TEXT.checking); use: featureRow's.
 */
export function renderWhatsInLab(box, model, { onTap, use = null, checking = false } = {}) {
  box.textContent = '';
  box.append(el('p', 'lab-inbox', model.header ?? ''));
  if (model.features?.length) {
    const ul = el('ul', 'lab-features');
    for (const f of model.features) ul.append(featureRow(f, { onTap, use }));
    box.append(ul);
  }
  if (model.server?.features?.length) {
    const group = el('section', 'lab-group');
    const h = el('h3', 'lab-group-h', LAB_TEXT.serverHeading);
    h.id = nextId('lab-group-h');
    group.setAttribute('aria-labelledby', h.id);
    group.append(h, el('p', 'lab-group-state', checking ? LAB_TEXT.checking : (model.server.short ?? '')));
    const ul = el('ul', 'lab-features');
    for (const f of model.server.features) ul.append(featureRow(f, { onTap, use }));
    group.append(ul);
    box.append(group);
  }
}

/** The feature ids of a What's in Lab model, in order. */
const modelIds = (model) => [...(model.features ?? []), ...(model.server?.features ?? [])].map((f) => f.id);

/**
 * A newer What's in Lab answer for the list already in `box` (renderWhatsInLab's): the header line, the server
 * heading's line and each row's short state change in place, so an open note and the focus stay (1.4: every row shows
 * its short state, a tap or not). model.fresh false (no server answer in it yet): only the header line changes.
 * -> false when the list on screen has other features (then render it again).
 */
export function updateWhatsInLab(box, model) {
  const shown = [...box.querySelectorAll('li.lab-feature')].map((li) => li.dataset.feature);
  if (shown.join(' ') !== modelIds(model).join(' ')) return false;
  const header = box.querySelector('.lab-inbox');
  if (header) header.textContent = model.header ?? '';
  if (!model.fresh) return true;
  const state = box.querySelector('.lab-group-state');
  if (state) state.textContent = model.server?.short ?? '';
  const rows = new Map([...box.querySelectorAll('li.lab-feature')].map((li) => [li.dataset.feature, li.querySelector('.lab-row')]));
  for (const f of [...(model.features ?? []), ...(model.server?.features ?? [])]) {
    const row = rows.get(f.id);
    if (row) setShort(row, f.short);
  }
  return true;
}

/**
 * After this device re-paired with another Daylight while it knew a Daylight server (2.6, DESIGN 3.4 and 12.7): under
 * the "Daylight server" heading, the locked text, the new pairing's Server code with Copy, the re-run help, and OK,
 * which closes it. Every word is LAB_TEXT's or the server module's (model).
 * model: {message, serverCode, rerun}; on: {copy(code) -> Promise<boolean>, ok()}.
 */
export function renderRepaired(box, model, on = {}) {
  const S = LAB_TEXT.serverSection;
  box.textContent = '';
  const h = el('h2', 'lab-repaired-h', LAB_TEXT.serverRow);
  h.id = nextId('lab-repaired-h');
  box.setAttribute('aria-labelledby', h.id);
  const codeH = el('h3', 'lab-server-h', S.serverCode);
  codeH.id = nextId('lab-code-h');
  const copy = button(S.copy);
  copy.classList.add('lab-server-copy');
  copy.setAttribute('aria-describedby', codeH.id);
  const copied = el('p', 'hint small lab-server-copied');
  copied.setAttribute('role', 'status');
  copy.addEventListener('click', async () => {
    copied.textContent = '';
    if (await on.copy?.(model.serverCode)) copied.textContent = LAB_TEXT.setup.copied;
  });
  const acts = el('div', 'lab-note-acts');
  const ok = button(LAB_TEXT.noteButton);
  ok.classList.add('lab-repaired-ok');
  ok.addEventListener('click', () => on.ok?.());
  acts.append(ok);
  box.append(
    h, el('p', 'lab-repaired-text', model.message ?? ''), codeH, el('p', 'lab-server-code', model.serverCode ?? ''), copy,
    copied, el('p', 'hint small lab-server-rerun', model.rerun ?? ''), acts,
  );
}

/**
 * The Daylight server section (2.6) into `box`. model: the background's server view {paired, state, message,
 * button, origins, host, fingerprint, v1Notice, serverCode, labInbox, aiToday, manualUrl, rerun}.
 * on: {fix(button, note, model) for the state's one button (Allow), copy(code) -> Promise<boolean>,
 *      saveAddress(url) -> Promise<{error?}>}.
 */
export function renderServerSection(box, model, on = {}) {
  const S = LAB_TEXT.serverSection;
  box.textContent = '';
  const state = el('div', 'lab-server-state');
  const stateBox = noteBox();
  stateBox.classList.add('lab-note-fixed');
  state.append(stateBox);
  box.append(state);
  if (model.state === 'ready') stateBox.append(el('p', 'lab-server-ready', model.message ?? LAB_TEXT.ready));
  else {
    labNote(stateBox, model.message, {
      state: model.state, button: model.button, ok: false, onButton: (b, note) => on.fix?.(b, note, model),
    });
  }
  if (!model.paired) {
    box.append(el('p', 'hint small lab-server-rerun', model.rerun ?? ''));
    return;
  }
  const where = [model.host, model.fingerprint].filter(Boolean).join(' · ');
  if (where) box.append(el('p', 'lab-server-where', where));
  if (model.v1Notice) box.append(el('p', 'note lab-server-v1', model.v1Notice));

  const codeH = el('h3', 'lab-server-h', S.serverCode);
  codeH.id = nextId('lab-code-h');
  const code = el('p', 'lab-server-code', model.serverCode ?? '');
  code.id = nextId('lab-code');
  const copy = button(S.copy);
  copy.classList.add('lab-server-copy');
  copy.setAttribute('aria-describedby', codeH.id);
  const copied = el('p', 'hint small lab-server-copied');
  copied.setAttribute('role', 'status');
  copy.addEventListener('click', async () => {
    copied.textContent = '';
    if (await on.copy?.(model.serverCode)) copied.textContent = LAB_TEXT.setup.copied;
  });
  box.append(codeH, code, copy, copied);

  if (model.labInbox) box.append(el('p', 'lab-server-inbox', model.labInbox));
  if (model.aiToday) box.append(el('p', 'lab-server-ai', model.aiToday));

  const form = el('form', 'lab-server-address');
  const label = el('label', null, S.serverAddress);
  const input = el('input');
  input.id = nextId('lab-address');
  label.htmlFor = input.id;
  Object.assign(input, { type: 'url', value: model.manualUrl ?? '', autocomplete: 'off', spellcheck: false, placeholder: 'https://' });
  input.setAttribute('inputmode', 'url');
  const save = el('button', 'btn secondary', on.saveLabel ?? 'Save');
  save.type = 'submit';
  const row = el('div', 'row');
  row.append(input, save);
  const said = el('p', 'error lab-server-address-error');
  said.setAttribute('role', 'alert');
  form.append(label, row, said);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    said.textContent = '';
    save.disabled = true;
    try {
      const r = await on.saveAddress?.(input.value.trim());
      if (r?.error) said.textContent = r.error;
    } finally { save.disabled = false; }
  });
  box.append(form);
  box.append(el('p', 'hint small lab-server-rerun', model.rerun ?? ''));
}
