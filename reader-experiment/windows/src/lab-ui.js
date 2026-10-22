// The Lab screens' building blocks for the Windows window (LAB-PLAN 1.4, 1.5 and 2.6): the needs-setup note, What's in
// Lab, the Daylight server section and the re-pairing follow-up. DOM only: no Tauri, storage or network. app.js passes
// the data (lab.js's answers) and what a button does. Every word comes from LAB_TEXT, the server module or the data.
//
// Text fields are one-line textareas that wrap (as the relay field is), so a pasted link or address is shown whole,
// also at 225% text with Comfort (F27.4); Enter submits, and a pasted line break goes.

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
 * what appears in it (1.5), and it is empty (and takes no room) until then.
 */
export function noteBox() {
  const box = el('div', 'lab-note');
  box.setAttribute('aria-live', 'polite');
  return box;
}

/**
 * The needs-setup note (1.5) in `box`: exactly one sentence, at most one button that fixes it from here (Copy Server
 * code on Windows) and OK, which closes it. Never a toast, never a dialog: it stays until OK, a click on another
 * control (dismissNotesOnOtherControls) or leaving the screen.
 * ok: false for a note on its way to its answer (LAB_TEXT.checking) and for the server section’s state.
 * -> the note's element (data-state carries `state`, for tests).
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
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const row = box.closest('.lab-feature')?.querySelector('.lab-row');
        clearNote(box);
        row?.focus();
      });
      acts.append(b);
    }
    note.append(acts);
  }
  box.append(note);
  return note;
}

/** A short line added under a note's sentence ("Copied"), said by the same live region. */
export function noteFollowUp(note, text) {
  note.querySelector('.lab-note-follow')?.remove();
  note.append(el('p', 'lab-note-text lab-note-follow', text));
}

export function clearNote(box) { box.textContent = ''; }

/** Closes every note under `root` except the one in `keep` (the server section's state line is not a note to close). */
export function clearNotes(root, keep = null) {
  for (const box of root.querySelectorAll('.lab-note:not(.lab-note-fixed)')) if (box !== keep && box.firstChild) clearNote(box);
}

/** A click on any control outside a note's own feature closes the open notes (1.5). */
export function dismissNotesOnOtherControls(root) {
  root.addEventListener('click', (ev) => {
    const control = ev.target.closest?.('button, input, select, textarea, a, summary');
    if (!control) return;
    const own = control.closest('.lab-feature');
    clearNotes(root, own?.querySelector('.lab-note') ?? null);
  }, true);
}

/**
 * A one-line field that wraps instead of scrolling (F27.4): Enter submits its form, as in a one-line field, and a
 * pasted line break goes.
 */
function oneLineField({ label, placeholder = '', value = '', describedBy = null }) {
  const field = el('textarea', 'one-line');
  field.id = nextId('lab-field');
  Object.assign(field, { rows: 1, value, placeholder, spellcheck: false, autocomplete: 'off' });
  field.setAttribute('inputmode', 'url');
  field.setAttribute('autocapitalize', 'off');
  field.setAttribute('aria-multiline', 'false');
  if (describedBy) field.setAttribute('aria-describedby', describedBy);
  const lab = el('label', null, label);
  lab.htmlFor = field.id;
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); field.form?.requestSubmit(); }
  });
  field.addEventListener('input', () => {
    if (/[\r\n]/.test(field.value)) field.value = field.value.replace(/\s*[\r\n]+\s*/g, '');
  });
  return { label: lab, field };
}

/**
 * One feature of What's in Lab (1.4): a control with its name (the accessible name), its sentence and its short state
 * (both its description), then W1's Use switch when the feature has one (LAB-PLAN 6.5 Q5: `use(f)` gives its control,
 * which goes in a .lab-use block), and the note box under them.
 * f: {id, name, sentence, short (null: nothing shown)}. onTap(f, box, row) runs the feature's gate.
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
 * model: lab.overview()'s {header, features, server: {short, features}}; checking: true while the server's state is on
 * its way (the heading's line then says LAB_TEXT.checking); use: featureRow's.
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

const modelIds = (model) => [...(model.features ?? []), ...(model.server?.features ?? [])].map((f) => f.id);

/**
 * A newer What's in Lab answer for the list already in `box`: the header line, the server heading's line and each
 * row's short state change in place, so an open note and the focus stay (1.4: every row shows its short state, a tap
 * or not). model.fresh false (no server answer in it yet): only the header line changes.
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

/** The Server code under its heading, with Copy (described by the heading) and the line that says it was copied. */
function serverCodeBlock(code, copy) {
  const S = LAB_TEXT.serverSection;
  const h = el('h3', 'lab-server-h', S.serverCode);
  h.id = nextId('lab-code-h');
  const text = el('p', 'lab-server-code', code ?? '');
  const b = button(S.copy, 'btn secondary small-btn lab-server-copy');
  b.setAttribute('aria-describedby', h.id);
  const said = el('p', 'hint small lab-server-copied');
  said.setAttribute('role', 'status');
  b.addEventListener('click', async () => {
    said.textContent = '';
    const r = await copy?.(code ?? '');
    if (r === true) said.textContent = LAB_TEXT.setup.copied;
    else if (typeof r === 'string') said.textContent = r; // why it couldn't (the system's words)
  });
  return [h, text, b, said];
}

/**
 * After this PC re-paired with another Daylight while it knew a Daylight server (2.6, DESIGN 3.4 and 12.7): the
 * locked text, the new pairing's Server code with Copy, the re-run help, and OK, which closes it.
 * model: {message, serverCode, rerun}; on: {copy(code) -> Promise<true | why>, ok()}.
 */
export function renderRepaired(box, model, on = {}) {
  box.textContent = '';
  // h2, as the send view's "Recent": the page's headings go h1, h2 (F27, axe's heading order).
  const h = el('h2', 'lab-repaired-h', LAB_TEXT.serverRow);
  h.id = nextId('lab-repaired-h');
  box.setAttribute('aria-labelledby', h.id);
  const acts = el('div', 'lab-note-acts');
  const ok = button(LAB_TEXT.noteButton, 'btn secondary small-btn lab-repaired-ok');
  ok.addEventListener('click', () => on.ok?.());
  acts.append(ok);
  box.append(h, el('p', 'lab-repaired-text', model.message ?? ''), ...serverCodeBlock(model.serverCode, on.copy),
    el('p', 'hint small lab-server-rerun', model.rerun ?? ''), acts);
}

/**
 * Set up with a link (2.6 "Setup link", DESIGN 3.5): a field and Set up; the link is read first (a refused one shows
 * the module's message, and nothing is sent), then a confirmation names the server's address, and only Use it sends
 * this pairing's Server code ("Setting up…", then the done line or the module's message).
 * on: {setupCheck(link) -> Promise<{server, confirm} | {error}>, setup(link) -> Promise<{done} | {error}>, setupSaid: a
 * line to say once it is drawn (the done line, after the section is drawn again)}.
 */
function setupForm(on) {
  const S = LAB_TEXT.serverSection;
  const form = el('form', 'lab-server-setup');
  form.noValidate = true;
  const footer = el('p', 'hint small lab-server-setup-footer', S.setupFooter);
  footer.id = nextId('lab-setup-footer');
  const { label, field } = oneLineField({ label: S.setupRow, placeholder: S.setupPlaceholder, describedBy: footer.id });
  const go = el('button', 'btn secondary', S.setupButton);
  go.type = 'submit';
  // The confirmation (step 3): nothing is sent before Use it.
  const ask = el('div', 'lab-note-body lab-server-setup-confirm');
  ask.hidden = true;
  const askTitle = el('p', 'lab-server-setup-confirm-title', S.setupConfirmTitle);
  askTitle.id = nextId('lab-setup-confirm');
  ask.setAttribute('role', 'group');
  ask.setAttribute('aria-labelledby', askTitle.id);
  const askBody = el('p', 'lab-note-text');
  const yes = button(S.setupConfirm, 'btn primary');
  const no = button(S.setupCancel);
  const acts = el('div', 'row');
  acts.append(yes, no);
  ask.append(askTitle, askBody, acts);
  const said = el('p', 'lab-server-setup-said');
  said.setAttribute('role', 'status');
  form.append(label, field, footer, go, ask, said);

  let link = '';
  let checked = null;
  const say = (text, bad = false) => { said.textContent = text ?? ''; said.classList.toggle('error', bad); };
  const busy = (b) => { for (const c of [field, go, yes, no]) c.disabled = b; };
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    ask.hidden = true;
    say('');
    link = field.value.trim();
    busy(true);
    try { checked = await on.setupCheck?.(link); } catch (e) { checked = { error: e.message }; } finally { busy(false); }
    if (!checked || checked.error) { say(checked?.error, true); field.focus(); return; }
    askBody.textContent = checked.confirm;
    ask.hidden = false;
    yes.focus();
  });
  no.addEventListener('click', () => { ask.hidden = true; checked = null; field.focus(); });
  yes.addEventListener('click', async () => {
    if (!checked) return;
    ask.hidden = true;
    say(S.setupWorking);
    busy(true);
    let r;
    try { r = await on.setup?.(link); } catch (e) { r = { error: e.message }; } finally { busy(false); }
    if (!r || r.error) { say(r?.error, true); field.focus(); } else say(r.done);
  });
  // A line for after the section was drawn again (the done line): said once it is on screen, so it is announced.
  if (on.setupSaid) setTimeout(() => say(on.setupSaid), 50);
  return form;
}

/**
 * The Daylight server section (2.6) into `box`. model: lab.serverView()'s {paired, state, message, host, fingerprint,
 * v1Notice, moved, serverCode, labInbox, aiToday, manualUrl, setupFirst, rerun}.
 * on: {copy(code) -> Promise<true | why>, move(yes) for "moved … Use it?", saveAddress(url) -> Promise<{error?}>,
 *      saveLabel, and setupForm's setupCheck, setup and setupSaid}. Set up with a link comes right after the state while
 * the state's message says to paste a setup link (model.setupFirst), else last.
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
  else labNote(stateBox, model.message, { state: model.state, ok: false });
  if (!model.paired) {
    box.append(el('p', 'hint small lab-server-rerun', model.rerun ?? ''));
    return;
  }
  const setup = on.setupCheck ? setupForm(on) : null;
  if (setup && model.setupFirst) box.append(setup);
  if (model.moved) {
    // "Your Daylight server moved to {host}. Use it?" (2.6): on.move(true) confirms the move and draws the section
    // again. Cancel closes the question and changes nothing (it asks again next time); the focus goes to Copy, next.
    const moved = el('div', 'lab-note-body lab-server-moved');
    const q = el('p', 'lab-note-text', model.moved);
    q.id = nextId('lab-moved');
    moved.setAttribute('role', 'group');
    moved.setAttribute('aria-labelledby', q.id);
    const yes = button(S.setupConfirm, 'btn primary');
    const no = button(S.setupCancel);
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      no.disabled = true;
      try { await on.move?.(true); } finally { yes.disabled = false; no.disabled = false; }
    });
    no.addEventListener('click', () => {
      const next = box.querySelector('.lab-server-copy');
      moved.remove();
      on.move?.(false);
      next?.focus();
    });
    const acts = el('div', 'row');
    acts.append(yes, no);
    moved.append(q, acts);
    box.append(moved);
  }
  const where = [model.host, model.fingerprint].filter(Boolean).join(' · ');
  if (where) box.append(el('p', 'lab-server-where', where));
  if (model.v1Notice) box.append(el('p', 'note lab-server-v1', model.v1Notice));
  box.append(...serverCodeBlock(model.serverCode, on.copy));
  if (model.labInbox) box.append(el('p', 'lab-server-inbox', model.labInbox));
  if (model.aiToday) box.append(el('p', 'lab-server-ai', model.aiToday));

  const form = el('form', 'lab-server-address');
  form.noValidate = true;
  const { label, field } = oneLineField({ label: S.serverAddress, placeholder: 'https://', value: model.manualUrl ?? '' });
  const save = el('button', 'btn secondary', on.saveLabel ?? 'Save');
  save.type = 'submit';
  const said = el('p', 'error lab-server-address-error');
  said.setAttribute('role', 'alert');
  form.append(label, field, save, said);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    said.textContent = '';
    save.disabled = true;
    try {
      const r = await on.saveAddress?.(field.value.trim());
      if (r?.error) said.textContent = r.error;
    } finally { save.disabled = false; }
  });
  box.append(form);
  if (setup && !model.setupFirst) box.append(setup);
  box.append(el('p', 'hint small lab-server-rerun', model.rerun ?? ''));
}
