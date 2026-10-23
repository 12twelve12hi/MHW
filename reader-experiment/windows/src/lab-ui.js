// The Lab screens' building blocks for the Windows window (LAB-PLAN 1.4, 1.5, 2.5 and 2.6): the needs-setup note, What's
// in Lab with its switches, the Daylight server section, the re-pairing follow-up, and Wave 1's: the timeline's rows
// (F01), the one-time note (1.2), the questions before a send link or the copied link goes (F09, F33), F02's entry
// point and Setup check (F26). DOM only: no Tauri, storage or network. app.js passes the data (lab.js's answers) and
// what a button does. Every word comes from LAB_TEXT, the server module, the protocol module or the data.
//
// Text fields are one-line textareas that wrap (as the relay field is), so a pasted link or address is shown whole,
// also at 225% text with Comfort (F27.4); Enter submits, and a pasted line break goes.

import { LAB_TEXT, hostLineText, labRowA11yLabel, fillText, activityLine } from './daylight-lab.js';
import { ACTION_LABELS } from './logic.js';

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
 * ok: false for a note on its way to its answer (LAB_TEXT.checking) and for the server section’s state. onOk: where
 * the focus goes after OK (by default, the row of the note's feature).
 * -> the note's element (data-state carries `state`, for tests).
 */
export function labNote(box, message, { state = '', button: label = null, onButton = null, ok = true, onOk = null } = {}) {
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
        if (onOk) onOk(); else row?.focus();
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

/** A small heading of the server section (the Server code, the host line, the delivery mode, the steps), with an id. */
function sectionHeading(text, prefix) {
  const h = el('h3', 'lab-server-h', text);
  h.id = nextId(prefix);
  return h;
}

/** The Server code under its heading, with Copy (described by the heading) and the line that says it was copied. */
function serverCodeBlock(code, copy) {
  const S = LAB_TEXT.serverSection;
  const h = sectionHeading(S.serverCode, 'lab-code-h');
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
 * delivery, v1Notice, moved, serverCode, labInbox, aiToday, manualUrl, setupFirst, rerun}. host: the server's origin or
 * host; the line under its heading (hostLabel) is hostLineText(host, fingerprint). delivery: 'lab' | 'v1' | null (no server found:
 * no Delivery line).
 * on: {copy(code) -> Promise<true | why>, move(yes) for "moved … Use it?", saveAddress(url) -> Promise<{error?}>,
 *      and setupForm's setupCheck, setup and setupSaid}.
 * Order (2.6, "The rest of the server section's copy"): the state; Set up with a link, right here while the state's
 * message says to paste a setup link (model.setupFirst), else last; while the state is needs-server, stepsHeading with
 * the five steps, numbered (how to get that link), and where every step is; the move question; hostLabel with the
 * host and fingerprint; deliveryLabel (then the v1 notice under v1 delivery); the Server code with Copy; the Lab Inbox and AI
 * lines; the Server address field with Save and its footer; the re-run help. Every word is LAB_TEXT.serverSection's, the
 * server module's or the model's.
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
  if (model.state === 'needs-server') {
    // The steps (2.6): only while the server is not set up; step 2 is the module's RERUN_HELP, word for word.
    const steps = el('section', 'lab-server-steps');
    const h = sectionHeading(S.stepsHeading, 'lab-steps-h');
    steps.setAttribute('aria-labelledby', h.id);
    const ol = el('ol', 'lab-server-steps-list');
    for (const step of S.steps) ol.append(el('li', null, step));
    steps.append(h, ol, el('p', 'hint small lab-server-steps-more', S.stepsMore));
    box.append(steps);
  }
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
  const where = hostLineText(model.host, model.fingerprint);
  if (where) box.append(sectionHeading(S.hostLabel, 'lab-host-h'), el('p', 'lab-server-where', where));
  if (model.delivery === 'lab' || model.delivery === 'v1') {
    box.append(sectionHeading(S.deliveryLabel, 'lab-delivery-h'),
      el('p', 'lab-server-delivery', model.delivery === 'v1' ? S.deliveryV1 : S.deliveryLab));
  }
  if (model.v1Notice) box.append(el('p', 'note lab-server-v1', model.v1Notice));
  box.append(...serverCodeBlock(model.serverCode, on.copy));
  if (model.labInbox) box.append(el('p', 'lab-server-inbox', model.labInbox));
  if (model.aiToday) box.append(el('p', 'lab-server-ai', model.aiToday));

  const form = el('form', 'lab-server-address');
  form.noValidate = true;
  const footer = el('p', 'hint small lab-server-address-footer', S.addressFooter);
  footer.id = nextId('lab-address-footer');
  const { label, field } = oneLineField({ label: S.serverAddress, placeholder: S.addressPlaceholder, value: model.manualUrl ?? '', describedBy: footer.id });
  const save = el('button', 'btn secondary', S.addressSave);
  save.type = 'submit';
  const said = el('p', 'error lab-server-address-error');
  said.setAttribute('role', 'alert');
  form.append(label, field, footer, save, said);
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

// --- Wave 1 --------------------------------------------------------------------------------------------------------

/**
 * A switch on a feature's row in What's in Lab: its Use switch (6.5 Q5: label "Use", named "Use {feature}") or F09's
 * "Allow quick sends from other apps", with its footer as its description. onChange(want) -> Promise<the value now>;
 * a value that can't be saved is put back and says why.
 */
export function featureSwitch({ label, name = null, footer, checked = false, onChange }) {
  const wrap = el('div', 'lab-switch');
  const row = el('div', 'switch-row');
  const id = nextId('lab-switch');
  const lab = el('label', 'switch-label', label);
  lab.htmlFor = id;
  const input = el('input', 'switch');
  Object.assign(input, { type: 'checkbox', id, checked: !!checked });
  input.setAttribute('role', 'switch');
  if (name) input.setAttribute('aria-label', name);
  const foot = el('p', 'hint small switch-footer', footer);
  foot.id = nextId('lab-switch-footer');
  input.setAttribute('aria-describedby', foot.id);
  const said = el('p', 'hint small lab-switch-msg');
  said.setAttribute('role', 'status');
  input.addEventListener('change', async () => {
    said.textContent = '';
    const want = input.checked;
    try { input.checked = !!(await onChange?.(want)); } catch (e) {
      input.checked = !want;
      said.textContent = `Couldn’t change that: ${e?.message ?? e}`;
    }
  });
  row.append(lab, input);
  wrap.append(row, foot, said);
  return wrap;
}

/** A Use switch (6.5 Q5) for feature f: {id, name}; on: true while it is on. */
export function useSwitch(f, on, onChange) {
  const U = LAB_TEXT.use;
  return featureSwitch({ label: U.label, name: fillText(U.a11y, { feature: f.name }), footer: U.footers[f.id] ?? '', checked: on, onChange });
}

/** The one-time note (1.2): LAB_TEXT.note with OK, which calls onOk (the caller marks it seen). */
export function renderLabNote(box, { onOk } = {}) {
  box.textContent = '';
  const body = el('div', 'lab-note-body');
  const text = el('p', 'lab-note-text', LAB_TEXT.note);
  text.id = nextId('lab-note');
  body.setAttribute('role', 'note');
  body.setAttribute('aria-labelledby', text.id);
  const acts = el('div', 'lab-note-acts');
  const ok = button(LAB_TEXT.noteButton);
  ok.classList.add('lab-note-ok');
  ok.addEventListener('click', () => onOk?.());
  acts.append(ok);
  body.append(text, acts);
  box.append(body);
  box.hidden = false;
}

/**
 * One history row with Lab on (2.5, "What a row shows"). d: the timeline's {label, sentence, action, stepLine, final}
 * for it. A row from describeLabRow's rules 1 and 4 (stepLine null: Lab off on the Daylight, or v1.1's own words) keeps
 * v1.1's layout exactly (v11: rowView's {label, tone, sentence, retry, retryLabel}). Otherwise every row shows its
 * title and label, and the sentence and step line show on the newest row and on every row that is not final;
 * elsewhere the title opens them (its details). The row's accessible text is "{label}. {sentence}" (labRowA11yLabel);
 * the label, sentence and step line on screen are hidden from screen readers, which read that instead.
 * row: {id, status, kind}; title, kind, when: the texts; on: {retry(id, button), remove(id, button)}; cancel: the
 * queue's Cancel instead of Remove (F07); tone: the label's style ('ok', 'sent', 'busy', 'bad').
 */
export function renderLabRow(row, d, { v11, title, kind, when, newest = false, on = {}, cancel = false, tone = 'sent' } = {}) {
  const li = el('li');
  li.dataset.id = row.id;
  li.dataset.status = row.status;
  const lab = d.stepLine !== null && d.stepLine !== undefined;
  const showAll = !lab || newest || !d.final;
  const line = el('div', 'item-line');
  let titleEl;
  if (showAll) titleEl = el('span', 'item-title', title);
  else {
    titleEl = button(title, 'item-title item-open');
    titleEl.setAttribute('aria-expanded', 'false');
  }
  line.append(el('span', 'kind', kind), titleEl);
  const meta = el('div', 'item-meta');
  if (lab) {
    const label = el('span', `st ${tone}`, d.label);
    label.setAttribute('aria-hidden', 'true');
    meta.append(label, el('span', 'sr-only lab-row-a11y', labRowA11yLabel(d)));
  } else {
    meta.append(el('span', `st ${v11.tone}`, v11.label));
  }
  meta.append(el('span', 'when', when));
  const acts = el('span', 'acts');
  const retryLabel = lab ? (ACTION_LABELS[d.action] ?? '') : v11.retryLabel;
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
  if (!lab) {
    if (v11.sentence) li.append(el('p', `note sentence${v11.tone === 'bad' ? ' bad' : ''}`, v11.sentence));
    return li;
  }
  const details = [];
  if (d.sentence) {
    const p = el('p', `note sentence${tone === 'bad' ? ' bad' : ''}`, d.sentence);
    p.setAttribute('aria-hidden', 'true');
    details.push(p);
  }
  if (d.stepLine) {
    const p = el('p', 'note lab-steps', d.stepLine);
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
 * A question before something is sent (F09's send link, F33's copied link) in `box`: a title, lines, and Send and
 * Cancel. on: {send(), cancel()}. note: {message, state, button, onButton, onOk} for a needs-setup note (1.5) under
 * Send and Cancel, in its polite live region: F09's needs-quick-sends with Open setting, when the link asked to go
 * without the question; its OK gives Send the focus. -> the group (role group, named by its title); Send has the focus.
 */
export function renderQuestion(box, { title, lines = [], note = null } = {}, on = {}) {
  box.textContent = '';
  const ask = el('div', 'lab-note-body lab-question-body');
  const h = el('p', 'lab-question-title', title);
  h.id = nextId('lab-question');
  ask.setAttribute('role', 'group');
  ask.setAttribute('aria-labelledby', h.id);
  ask.append(h);
  for (const t of lines) ask.append(el('p', 'lab-note-text lab-question-line', t));
  const yes = button(LAB_TEXT.automation.send, 'btn primary lab-question-send');
  const no = button(LAB_TEXT.automation.cancel, 'btn secondary lab-question-cancel');
  yes.addEventListener('click', () => on.send?.(yes));
  no.addEventListener('click', () => on.cancel?.());
  const acts = el('div', 'row');
  acts.append(yes, no);
  ask.append(acts);
  box.append(ask);
  box.hidden = false;
  if (note) {
    const notes = noteBox();
    notes.classList.add('lab-question-note');
    ask.append(notes);
    const shown = labNote(notes, note.message, {
      state: note.state ?? '', button: note.button ?? null, onButton: note.onButton ?? null,
      onOk: () => { yes.focus(); note.onOk?.(); },
    });
    // The question's description too, so a screen reader says it with the question when the focus lands on Send.
    const text = shown.querySelector('.lab-note-text');
    text.id = nextId('lab-question-note');
    ask.setAttribute('aria-describedby', text.id);
  }
  yes.focus();
  return ask;
}

/**
 * The F02 entry point (3.1) in `box`, under the too-big sentence: "Send files over 9 MB ›", which runs the gate and
 * shows its note (needs-server with Copy Server code, later, OFFLINE…) under it. gate() -> the gate's answer;
 * fix(r, note, button) for the note's one button.
 */
export function renderBigFiles(box, { gate, fix } = {}) {
  box.textContent = '';
  const li = el('div', 'lab-feature lab-big-files');
  const b = button(null, 'nav-row lab-big-files-row');
  const text = el('span', 'nav-text');
  text.append(el('span', 'nav-label', LAB_TEXT.bigFiles));
  b.append(text);
  const notes = noteBox();
  b.addEventListener('click', async () => {
    const r = await gate?.();
    if (!r || r.ready) { clearNote(notes); return; }
    const note = labNote(notes, r.message, { state: r.state, button: r.button, onButton: (btn) => fix?.(r, note, btn) });
  });
  li.append(b, notes);
  box.append(li);
  box.hidden = false;
}

/**
 * Setup check (F26) into `box`. model: {checks: lab.js setupChecks()'s lines, test: null | {title, label, delivered,
 * reader}, activity: [events, oldest first]}. on: {fix(check, button), test(button), copy() -> Promise<true | why>}.
 */
export function renderSetupCheck(box, model, on = {}) {
  const S = LAB_TEXT.setup;
  box.textContent = '';
  const list = el('ul', 'lab-checks');
  for (const c of model.checks ?? []) {
    const li = el('li', `lab-check${c.ok ? ' ok' : ' unmet'}`);
    li.dataset.check = c.id;
    li.append(el('span', 'lab-check-text', c.text));
    if (c.button) {
      const b = button(c.button, 'btn secondary small-btn lab-check-fix');
      b.setAttribute('aria-label', `${c.button}: ${c.text.replace(/^[!✓] /, '')}`);
      b.addEventListener('click', () => on.fix?.(c, b));
      li.append(b);
    }
    list.append(li);
  }
  box.append(list);

  const test = el('div', 'lab-test');
  const go = button(S.testSend, 'btn secondary lab-test-send');
  const foot = el('p', 'hint small lab-test-footer', S.testFooter);
  foot.id = nextId('lab-test-footer');
  go.setAttribute('aria-describedby', foot.id);
  go.addEventListener('click', () => on.test?.(go));
  const progress = el('div', 'lab-test-progress');
  progress.setAttribute('aria-live', 'polite');
  test.append(go, foot, progress);
  box.append(test);

  const log = el('details', 'lab-activity');
  const sum = el('summary', null, S.activity);
  const ol = el('ol', 'lab-activity-list');
  log.append(sum, ol);
  box.append(log);
  updateSetupCheck(box, model);

  const copy = button(S.copyDiagnostics, 'btn secondary lab-diagnostics');
  const said = el('p', 'hint small lab-diagnostics-said');
  said.setAttribute('role', 'status');
  copy.addEventListener('click', async () => {
    said.textContent = '';
    const r = await on.copy?.();
    if (r === true) said.textContent = S.copied;
    else if (typeof r === 'string') said.textContent = r;
  });
  box.append(copy, said);
}

/**
 * Setup check's parts that change while it shows, in place (the focus stays): the test article's progress, as far as
 * it got ("✓ Delivered", "✓ In your Reader"; the row's label meanwhile, Waiting for a tap among them, F26.1), and the
 * activity log, newest first. model: {test, activity}.
 */
export function updateSetupCheck(box, model) {
  const S = LAB_TEXT.setup;
  const progress = box.querySelector('.lab-test-progress');
  if (progress) {
    const lines = [];
    const t = model.test;
    if (t) {
      if (t.title) lines.push(['lab-test-title', t.title]);
      lines.push(['lab-test-label', t.label]);
      if (t.delivered) lines.push(['lab-test-tick', fillText(S.ok, { check: S.delivered })]);
      if (t.reader) lines.push(['lab-test-tick', fillText(S.ok, { check: S.inReader })]);
    }
    const now = [...progress.children].map((p) => `${p.className}\n${p.textContent}`).join('\n\n');
    if (now !== lines.map(([c, x]) => `${c}\n${x}`).join('\n\n')) {
      progress.textContent = '';
      for (const [c, x] of lines) progress.append(el('p', c, x));
    }
  }
  const ol = box.querySelector('.lab-activity-list');
  if (ol) {
    ol.textContent = '';
    for (const e of [...(model.activity ?? [])].reverse()) ol.append(el('li', null, activityLine(e)));
  }
}
