// lab.html (LAB-PLAN 1.1, 1.4, 1.5, 2.6): the Lab switch, What's in Lab and the Daylight server section. Every answer
// comes from the background (lab.js), which holds the pairing and talks to the server; this page asks for the server's
// host permission, because only a page can (on the first server tap, then with Allow), and copies the Server code.
//
//   lab.html#lab            the switch, with "What's in Lab ›" and "Daylight server ›" while Lab is on
//   lab.html#lab-off        the same, with the Lab-off sentence above it (the omnibox's, F34, while Lab is off)
//   lab.html#whats-in-lab   What's in Lab: short states only; a feature's sentence shows when it is tapped (1.5, F00.7);
//                           the Use switches of the features that change how sharing behaves (6.5 Q5)
//   lab.html#server         the Daylight server section, with the long texts (2.6)
//   lab.html#f04, #f10, #f34  a feature's own settings (3.4), opened from its row: F04's "Send when I click the
//                           toolbar button" and "Always show Options before sending", F10's "Review before sending",
//                           F34's "Show in the right-click menu" boxes and the shortcuts
//   lab.html#setup          Setup check (F26): the checklist, the test article along its way, the activity log and
//                           Copy diagnostics

import { api } from './api.js';
import { LAB_TEXT, fillText } from './daylight-lab.js';
import {
  el, labNote, noteFollowUp, clearNote, dismissNotesOnOtherControls, copyText, renderWhatsInLab, updateWhatsInLab,
  renderServerSection,
} from './lab-ui.js';
import { MENU_ENTRIES } from './lab-send.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['lab', 'whats-in-lab', 'server', 'f04', 'f10', 'f34', 'setup'];
/** The feature each settings view belongs to (its heading is the feature's name). */
const VIEW_FEATURE = { f04: 'F04', f10: 'F10', f34: 'F34', setup: 'F26' };
/** While the test article (F26) is on its way, Setup check reads the ack topic this often. */
const TEST_CHECK_MS = 10e3;
let testTimer = null;
/** How long a gate may take before its note says "Checking your Daylight server…" (1.5). */
const CHECKING_AFTER_MS = 150;

let lab = true;
let view = 'lab';
let renderSeq = 0;
let setupSaid = null; // the setup's done line, said once the section is drawn again

document.documentElement.classList.add('wide');

async function call(type, extra = {}) {
  let res;
  try {
    res = await api.runtime.sendMessage({ type, ...extra });
  } catch {
    throw new Error('Send to Daylight isn’t responding. Close this and try again.');
  }
  if (!res) throw new Error('Send to Daylight isn’t responding. Close this and try again.');
  if (!res.ok) throw new Error(res.error || 'Something went wrong.');
  return res.result;
}

const ready = (on) => {
  $('app').setAttribute('aria-busy', on ? 'false' : 'true');
  document.body.dataset.ready = on ? '1' : '0';
};

/** Asks for a server's host permission (DESIGN 13.2). It needs the click's user activation; false when refused. */
async function askSite(origins) {
  if (!origins?.length) return false;
  try { return !!(await api.permissions.request({ origins })); } catch { return false; }
}

// --- the switch ---------------------------------------------------------------------------------------------------

function applyComfort(on) { document.body.classList.toggle('comfort', !!on); }

async function onLab() {
  const want = $('lab').checked;
  try { lab = (await call('setLab', { lab: want })).lab; } catch { lab = !want; }
  await render();
}

// --- What's in Lab --------------------------------------------------------------------------------------------------

/**
 * A tap on a feature runs its gate (1.5). Not ready: its one sentence under the row. A server feature's first tap
 * asks for the server's host permission; a refusal is needs-site-access, whose note asks again with Allow.
 */
async function onFeature(f, box, retried = false) {
  const timer = setTimeout(() => labNote(box, LAB_TEXT.checking, { state: 'checking', ok: false }), CHECKING_AFTER_MS);
  let r;
  try {
    r = await call('labGate', { feature: f.id });
  } catch (e) {
    r = { ready: false, state: 'error', message: e.message };
  } finally {
    clearTimeout(timer);
  }
  if (r.state === 'needs-site-access' && !retried && (await askSite(r.origins))) return onFeature(f, box, true);
  if (r.ready) {
    clearNote(box);
    // A ready feature with settings of its own opens them (3.4); the others have nothing to open here.
    if (f.view) go(f.view);
    return undefined;
  }
  const note = labNote(box, r.message, {
    state: r.state, button: r.button,
    onButton: async (b) => {
      if (r.state === 'needs-server') {
        if (await copyText(r.serverCode ?? '')) noteFollowUp(note, LAB_TEXT.setup.copied);
      } else if (r.state === 'needs-site-access') {
        if (await askSite(r.origins)) await onFeature(f, box, true);
      }
      b.focus?.();
    },
  });
  return undefined;
}

/**
 * What's in Lab: the cached states at once (the server's answer of the last 10 minutes, 1.5), else "Checking your
 * Daylight server…" on the heading; then the ack topic and the server, asked now, update the lines in place.
 */
async function renderWhats(seq) {
  const box = $('whats');
  let model;
  try { model = await call('labOverview', { refresh: false }); } catch (e) { box.textContent = e.message; return; }
  if (seq !== renderSeq || !model.lab) return;
  renderWhatsInLab(box, model, { onTap: onFeature, use: useSwitch, checking: !model.fresh });
  ready(true);
  // It opened: read the ack topic and ask the server now (1.4).
  try { model = await call('labOverview', { refresh: true }); } catch { return; }
  if (seq !== renderSeq || !model.lab) return;
  updateLines(box, model);
}

/**
 * A newer answer for the list on screen: the header, the heading's line and every row's short state change in place,
 * so a note that is open (a feature tapped while the server was asked) and the focus stay. A list with other features
 * is drawn again, unless a note is open in it.
 */
function updateLines(box, model) {
  if (!updateWhatsInLab(box, model) && !box.querySelector('.lab-note > *')) renderWhatsInLab(box, model, { onTap: onFeature, use: useSwitch });
  if (model.fresh && !model.cached) document.body.dataset.fresh = '1';
}

/** A switch with a visible label and a footer (its description), as Comfort's and Lab's. -> {row, footer, input} */
function switchRow(id, label, footerText, checked, { a11y = null } = {}) {
  const row = el('div', 'switch-row');
  const l = el('label', 'switch-label', label);
  const input = el('input', 'switch');
  Object.assign(input, { type: 'checkbox', id, checked: !!checked });
  input.setAttribute('role', 'switch');
  if (a11y) input.setAttribute('aria-label', a11y);
  l.htmlFor = input.id;
  row.append(l, input);
  let footer = null;
  if (footerText) {
    footer = el('p', 'hint small switch-footer', footerText);
    footer.id = `${id}-footer`;
    input.setAttribute('aria-describedby', footer.id);
  }
  return { row, footer, input };
}

/**
 * A feature's Use switch (6.5 Q5; LAB-PROTOCOL 2.9.6): "Use", read as "Use {feature}", on by default, with its footer
 * saying what turning it off does. The background keeps it in settings.labUse.
 */
function useSwitch(f) {
  if (!f.use) return null;
  const { row, footer, input } = switchRow(`lab-use-${f.id}`, LAB_TEXT.use.label, LAB_TEXT.use.footers[f.id], f.use.on,
    { a11y: fillText(LAB_TEXT.use.a11y, { feature: f.name }) });
  input.addEventListener('change', async () => {
    const want = input.checked;
    try { input.checked = (await call('labSetUse', { feature: f.id, on: want })).on; } catch { input.checked = !want; }
  });
  const box = el('div');
  box.append(row);
  if (footer) box.append(footer);
  return box;
}

// --- a feature's own settings (3.4) ---------------------------------------------------------------------------------

/** One of Lab's yes/no settings as a switch (labClickSend, labAlwaysOptions, labReview). */
function optionSwitch(key, label, checked) {
  const { row, input } = switchRow(`opt-${key}`, label, null, checked);
  input.addEventListener('change', async () => {
    const want = input.checked;
    try {
      const v = await call('labSetOption', { key, value: want });
      input.checked = { labClickSend: v.clickSend, labAlwaysOptions: v.alwaysOptions, labReview: v.review }[key] ?? want;
    } catch { input.checked = !want; }
  });
  return row;
}

async function renderFeature(seq, view) {
  const box = $(view);
  $(`${view}-h`).textContent = LAB_TEXT.features[VIEW_FEATURE[view]].name;
  let v;
  try { v = await call('labFeatureView'); } catch (e) { box.textContent = e.message; return; }
  if (seq !== renderSeq || !v.lab) return;
  box.textContent = '';
  if (view === 'f04') {
    box.append(optionSwitch('labClickSend', LAB_TEXT.shareInPlace.toolbarSend, v.clickSend),
      optionSwitch('labAlwaysOptions', LAB_TEXT.shareInPlace.alwaysOptions, v.alwaysOptions));
  } else if (view === 'f10') {
    box.append(optionSwitch('labReview', LAB_TEXT.sendAs.review, v.review));
  } else if (view === 'f34') {
    // "Show in the right-click menu", one box per entry: the background rebuilds the menu when one changes.
    const set = el('fieldset', 'lab-menus');
    set.append(el('legend', null, LAB_TEXT.contextMenu.showInMenu));
    for (const entry of MENU_ENTRIES) {
      const label = el('label', 'lab-check');
      const input = el('input');
      Object.assign(input, { type: 'checkbox', checked: v.menus[entry] !== false, name: `menu-${entry}` });
      input.addEventListener('change', async () => {
        const want = input.checked;
        try { input.checked = (await call('labSetOption', { key: `labMenus.${entry}`, value: want })).menus[entry]; } catch { input.checked = !want; }
      });
      label.append(input, document.createTextNode(LAB_TEXT.contextMenu[entry]));
      set.append(label);
    }
    box.append(set);
    if (v.commands.length) {
      const dl = el('dl', 'facts lab-shortcuts');
      for (const c of v.commands) dl.append(el('dt', null, c.description), el('dd', null, c.shortcut || '—'));
      box.append(dl);
    }
    if (v.shortcutsPage) {
      const b = el('button', 'btn secondary', LAB_TEXT.buttons['needs-quick-sends']);
      b.type = 'button';
      b.addEventListener('click', () => openTab('chrome://extensions/shortcuts'));
      box.append(b);
    }
  }
  ready(true);
}

async function openTab(url) {
  try { await api.tabs.create({ url }); } catch { /* not allowed here */ }
}

// --- Setup check (F26) -----------------------------------------------------------------------------------------------

async function renderSetup(seq, { focus = null } = {}) {
  const S = LAB_TEXT.setup;
  $('setup-h').textContent = S.title;
  const box = $('setup');
  let r;
  try { r = await call('labChecks'); } catch (e) { box.textContent = e.message; return; }
  if (seq !== renderSeq || !r.lab) return;
  box.textContent = '';
  const list = el('ul', 'lab-checks');
  for (const c of r.checks) {
    const li = el('li', `lab-check-item${c.ok ? ' ok' : ''}`);
    li.dataset.check = c.id;
    li.append(el('span', 'lab-check-line', c.line));
    if (c.button) {
      const b = el('button', 'btn secondary lab-check-fix', c.button);
      b.type = 'button';
      b.setAttribute('aria-label', `${c.button}: ${c.name}`);
      b.addEventListener('click', () => fixCheck(c));
      li.append(b);
    }
    list.append(li);
  }
  box.append(list);

  // The test article (F26): sent once tapped, then followed along the timeline.
  const test = el('section', 'lab-test');
  const send = el('button', 'btn primary lab-test-send', S.testSend);
  send.type = 'button';
  const footer = el('p', 'hint small lab-test-footer', S.testFooter);
  footer.id = 'lab-test-footer';
  send.setAttribute('aria-describedby', footer.id);
  const said = el('div', 'lab-test-progress');
  said.id = 'lab-test-progress';
  said.setAttribute('aria-live', 'polite');
  showTest(said, r.test);
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      await call('labTestSend');
      await updateTest();
    } catch (e) { said.textContent = ''; said.append(el('p', 'error', e.message)); }
    send.disabled = false;
    send.focus();
  });
  test.append(send, footer, said);
  box.append(test);

  // The activity log and Copy diagnostics.
  const log = el('details', 'lab-activity');
  log.append(el('summary', null, S.activity));
  const lines = el('pre', 'lab-activity-lines');
  log.append(lines);
  log.addEventListener('toggle', async () => {
    if (!log.open) return;
    try { lines.textContent = (await call('labActivity')).lines.join('\n'); } catch (e) { lines.textContent = e.message; }
  });
  const copy = el('button', 'btn secondary lab-diagnostics', S.copyDiagnostics);
  copy.type = 'button';
  const copied = el('p', 'hint small lab-diagnostics-copied');
  copied.setAttribute('role', 'status');
  copy.addEventListener('click', async () => {
    copied.textContent = '';
    try {
      const { text } = await call('labDiagnostics');
      if (await copyText(text)) copied.textContent = S.copied;
    } catch (e) { copied.textContent = e.message; }
  });
  box.append(log, copy, copied);
  if (focus === 'test') send.focus();
  ready(true);
  document.body.dataset.fresh = '1';
  followTest(r.test);
}

/** The test article's lines: "✓ Delivered", "✓ In your Reader" (or the name alone until then), and its label meanwhile. */
function showTest(box, test) {
  box.textContent = '';
  if (!test) return;
  box.dataset.reader = test.reader ? '1' : '0';
  for (const line of test.lines) box.append(el('p', 'lab-check-line', line));
  if (!test.reader) box.append(el('p', 'note lab-test-label', test.label));
}

/** The ledger or the outbox changed: only the test article's lines change, so focus and the open log stay. */
async function updateTest() {
  const box = $('lab-test-progress');
  if (!box || view !== 'setup') return;
  let r;
  try { r = await call('labChecks'); } catch { return; }
  if (!r.lab || view !== 'setup') return;
  showTest(box, r.test);
  followTest(r.test);
}

/** While the test article is on its way, Setup check reads the ack topic now and then: its lines follow (F26.1). */
function followTest(test) {
  if (test && !test.reader) {
    if (!testTimer) testTimer = setInterval(() => { if (view === 'setup') call('labCheckAcks').catch(() => {}); else { clearInterval(testTimer); testTimer = null; } }, TEST_CHECK_MS);
  } else { clearInterval(testTimer); testTimer = null; }
}

/** An unmet check's button: pair (the popup's pairing in a tab), the shortcuts page, or site access. */
async function fixCheck(c) {
  if (c.action === 'sites') { await askSite(['<all_urls>']); await render(); return; }
  if (c.action === 'shortcuts') { await openTab('chrome://extensions/shortcuts'); return; }
  if (c.action === 'pair') await openTab(api.runtime.getURL('popup.html?standalone=1'));
}

// --- the Daylight server ----------------------------------------------------------------------------------------------

async function renderServer(seq) {
  const box = $('server');
  let model;
  try { model = await call('labServer'); } catch (e) { box.textContent = e.message; return; }
  if (seq !== renderSeq || !model.lab) return;
  const said = setupSaid;
  setupSaid = null;
  renderServerSection(box, model, {
    fix: async () => { if (model.state === 'needs-site-access' && (await askSite(model.origins))) await render(); },
    copy: (code) => copyText(code ?? ''),
    // "Your Daylight server moved to {host}. Use it?" (2.6): the new origin's site while the click still counts, then
    // the module's confirmMove; the section is drawn again with the new server's state, and the focus goes to its
    // heading, so the state is read next. Cancel changes nothing.
    move: async (yes, m) => {
      if (!yes) return;
      await askSite(m.movedOrigins);
      await call('labConfirmMove');
      await render();
      $('server-h').focus();
    },
    // Set up with a link (2.6): the host permission for the link's server on Use it, while the click still counts.
    setupCheck: (link) => call('labSetupCheck', { link }),
    setup: async (link, checked) => {
      await askSite(checked.origins);
      const r = await call('labSetup', { link });
      if (r.done) { setupSaid = r.done; await render(); }
      return r;
    },
    setupSaid: said ?? undefined,
    saveAddress: async (url) => {
      // The host permission for a typed server first, while the click still counts.
      if (url) {
        let pattern = null;
        try { const u = new URL(url); pattern = `${u.protocol}//${u.hostname}/*`; } catch { /* the background says why */ }
        if (pattern) await askSite([pattern]);
      }
      const r = await call('labServerAddress', { url });
      if (!r.error) await render();
      return r;
    },
  });
  document.body.dataset.fresh = '1';
}

// --- views ------------------------------------------------------------------------------------------------------------

async function loadSubtitle(seq) {
  try {
    let r = await call('labState', { refresh: false });
    if (seq === renderSeq && r.serverSubtitle) $('server-sub').textContent = r.serverSubtitle;
    r = await call('labState', { refresh: true });
    if (seq === renderSeq && r.serverSubtitle) $('server-sub').textContent = r.serverSubtitle;
  } catch { /* the row still opens the section */ }
}

async function render() {
  const seq = ++renderSeq;
  ready(false);
  delete document.body.dataset.fresh;
  const asked = location.hash.replace(/^#/, '');
  view = lab && VIEWS.includes(asked) ? asked : 'lab';
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  document.body.dataset.view = view;
  $('lab').checked = lab;
  $('lab-rows').hidden = !lab;
  // The omnibox with Lab off (F34): the Lab-off sentence, above the switch that turns Lab on.
  const off = $('lab-off-said');
  off.hidden = lab || asked !== 'lab-off';
  off.textContent = off.hidden ? '' : fillText(LAB_TEXT.labOff, { app: LAB_TEXT.appName.chrome });
  if (view !== 'setup') { clearInterval(testTimer); testTimer = null; }
  if (view === 'lab') {
    ready(true);
    if (lab) await loadSubtitle(seq);
    if (seq === renderSeq) document.body.dataset.fresh = '1';
  } else if (view === 'whats-in-lab') {
    await renderWhats(seq);
  } else if (view === 'setup') {
    await renderSetup(seq);
  } else if (VIEW_FEATURE[view]) {
    await renderFeature(seq, view);
    if (seq === renderSeq) document.body.dataset.fresh = '1';
  } else {
    await renderServer(seq);
    if (seq === renderSeq) ready(true);
  }
}

function go(to) {
  if (location.hash !== `#${to}`) location.hash = to; else render();
}

async function init() {
  $('lab').addEventListener('change', onLab);
  $('open-whats-in-lab').addEventListener('click', () => go('whats-in-lab'));
  $('open-server').addEventListener('click', () => go('server'));
  for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', () => go('lab'));
  for (const b of document.querySelectorAll('[data-back-to]')) b.addEventListener('click', () => go(b.dataset.backTo));
  dismissNotesOnOtherControls($('app'));
  window.addEventListener('hashchange', () => render());
  try {
    const settings = (await api.storage.local.get('settings'))?.settings;
    applyComfort(settings?.comfort);
    lab = settings?.lab !== false;
  } catch { /* the background says */ }
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      applyComfort(changes.settings.newValue?.comfort);
      const on = changes.settings.newValue?.lab !== false;
      if (on !== lab) { lab = on; render(); }
    }
    // The ledger learnt something: What's in Lab's header line follows. Once the server's live answer is on screen,
    // the rows keep it (the cached states can be older than an answer that ran out of time).
    // Setup check follows the test article along its way.
    if (view === 'setup' && (changes.outbox || changes['lab/states'] || changes['lab/testId'])) updateTest();
    if (view === 'whats-in-lab' && (changes['lab/inbox'] || changes['lab/heard'])) {
      call('labOverview', { refresh: false }).then((m) => {
        if (m.lab) updateLines($('whats'), document.body.dataset.fresh === '1' ? { ...m, fresh: false } : m);
      }, () => {});
    }
  });
  try {
    lab = (await call('labState', { refresh: false })).lab;
  } catch { /* shown as stored */ }
  await render();
}

init();
