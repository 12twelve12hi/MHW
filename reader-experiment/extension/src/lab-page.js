// lab.html (LAB-PLAN 1.1, 1.4, 1.5, 2.6): the Lab switch, What's in Lab and the Daylight server section. Every answer
// comes from the background (lab.js), which holds the pairing and talks to the server; this page asks for the server's
// host permission, because only a page can (on the first server tap, then with Allow), and copies the Server code.
//
//   lab.html#lab            the switch, with "What's in Lab ›" and "Daylight server ›" while Lab is on
//   lab.html#whats-in-lab   What's in Lab: short states only; a feature's sentence shows when it is tapped (1.5, F00.7)
//   lab.html#server         the Daylight server section, with the long texts (2.6)

import { api } from './api.js';
import { LAB_TEXT } from './daylight-lab.js';
import {
  labNote, noteFollowUp, clearNote, dismissNotesOnOtherControls, copyText, renderWhatsInLab, updateWhatsInLab,
  renderServerSection,
} from './lab-ui.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['lab', 'whats-in-lab', 'server'];
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
  if (r.ready) { clearNote(box); return undefined; } // W0 runs no Lab feature here: a ready server feature is `later`
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
  renderWhatsInLab(box, model, { onTap: onFeature, checking: !model.fresh });
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
  if (!updateWhatsInLab(box, model) && !box.querySelector('.lab-note > *')) renderWhatsInLab(box, model, { onTap: onFeature });
  if (model.fresh && !model.cached) document.body.dataset.fresh = '1';
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
    saveLabel: 'Save',
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
  if (view === 'lab') {
    ready(true);
    if (lab) await loadSubtitle(seq);
    if (seq === renderSeq) document.body.dataset.fresh = '1';
  } else if (view === 'whats-in-lab') {
    await renderWhats(seq);
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
