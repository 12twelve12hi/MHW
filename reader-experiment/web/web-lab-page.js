// The web sender's Lab screens (LAB-PLAN 1.1, 1.4, 1.5 and 2.6, card B0, Wave 0; 3.3, card B1, Wave 1): the Lab switch
// at the top of Settings with its two rows, What's in Lab (with the Use switches of 6.5 Q5), the Daylight server
// section, the re-pairing follow-up, and Wave 1's pieces of the send view: the one-time note (1.2), the timeline's rows
// and check-in header (F01), the queue of what waits to send (F07), Paste and send (F33), the F02 entry point, Setup
// check (F26) and the bookmarklet (F09). The data comes from web-lab.js (createWebLab); lab-ui.js and lab-popup.js (the
// extension's, copied by build.mjs) build the parts, so the page says exactly what the extension says. Every word is
// LAB_TEXT's, the server module's or the protocol module's (describeRow).
//
//   Settings › Lab                the switch (on by default), its footer, and while Lab is on "What’s in Lab ›" and
//                                 "Daylight server ›" ("Optional · Not set up")
//   #view-whats-in-lab            short states only (the cached ones at once, 1.5); a feature's one sentence shows under
//                                 it when it is tapped; F16's and F33's Use switches; a ready F09 or F26 opens its view
//   #view-server                  the Daylight server section, with the long texts and the move question (2.6)
//   #view-setup                   Setup check (F26): the checklist, the test article along its way, the activity log
//                                 and Copy diagnostics
//   #view-f09                     Shortcuts and automation (F09): the bookmarklet, to drag to the bookmarks bar or copy
//   #lab-note                     the one-time note (1.2), over the pairing and sending views, until OK
//   the send view                 #repaired (after a re-pairing that locked the server, until OK or a ready server,
//                                 DESIGN 12.7); #lab-paste, #lab-after (F02), #lab-checkin, #lab-queue and the rows
//
// With Lab off only the switch and its footer show (1.3): the Lab views close, and the send view is v1.1's.

import { LAB_TEXT, fillText, wantsFastChecks, FAST_CHECK_MS } from './daylight-lab.js';
import {
  el, labNote, noteFollowUp, clearNote, clearNotes, dismissNotesOnOtherControls, copyText, renderWhatsInLab,
  updateWhatsInLab, renderServerSection, renderRepaired,
} from './lab-ui.js';
import {
  renderLabNote, renderLabRow, labRowText, labResultMessage, rowAnnouncement, renderCheckIn, renderBigFiles, renderPaste,
} from './lab-popup.js';
import { queueRows } from './lab-send.js';
import { copiedLink, bookmarklet } from './web-lab.js';

/** How long a gate may take before its note says "Checking your Daylight server…" (1.5). */
const CHECKING_AFTER_MS = 150;
export const LAB_VIEWS = ['view-whats-in-lab', 'view-server', 'view-setup', 'view-f09'];
/** While the test article (F26) is on its way, Setup check reads the ack topic this often. */
const TEST_CHECK_MS = 10e3;
/** The send view's Lab boxes: empty and hidden with Lab off, so the page is v1.1's. */
const SEND_BOXES = ['lab-paste', 'lab-after', 'lab-checkin', 'lab-queue'];
/** How many rows the history shows (app.js's HISTORY_SHOWN, v1.1). */
const HISTORY_SHOWN = 8;

/**
 * lab: createWebLab's. $: the page's getElementById. show(view): the page's view switch. toSettings(): back to
 * Settings. announce(text): the send view's polite live region. changed(): tells the page's other tabs. isPaired():
 * whether the page is paired now. afterRepairSeen(): where focus goes after OK on the follow-up.
 * Wave 1, the page's actions: sendCopied(text) (F33), sendTest() (F26), checkAcks() (F01's faster checks and Setup
 * check's test article), retry(id, button), remove(id, button) (the rows' buttons), toPairing() (Setup check's
 * pairing), install() and persist() (its other two buttons), noteDone() (where focus goes after the one-time note's
 * OK), pageUrl() (the bookmarklet's page), visible() (the page is on screen: the faster checks run only then).
 */
export function createLabPage({
  lab, $, show, toSettings, announce = () => {}, changed = () => {}, isPaired = () => false, afterRepairSeen = () => {},
  sendCopied = async () => {}, sendTest = async () => null, checkAcks = async () => {}, retry = () => {}, remove = () => {},
  toPairing = () => {}, install = async () => {}, persist = async () => {}, noteDone = () => {}, pageUrl = () => '',
  visible = () => true,
}) {
  let on = true;
  let seq = 0; // the Lab view drawn last; an older answer is dropped
  let setupSaid = null; // the setup's done line, said once the section is drawn again
  let labw = null; // lab.page(): the one-time note, the Use switches and the timeline, while Lab is on
  let rows = []; // the outbox as last drawn
  let fastTimer = null; // F01's faster checks
  let testTimer = null; // Setup check's test article
  const lastLabel = new Map(); // row id -> the Lab label last shown, to announce changes (2.5)

  const current = () => LAB_VIEWS.find((v) => !$(v).hidden) ?? null;
  const fresh = (yes) => { if (yes) document.body.dataset.fresh = '1'; else delete document.body.dataset.fresh; };

  // --- the switch -----------------------------------------------------------------------------------------------------

  /** The words of the switch and its rows, from LAB_TEXT (the page's own copy can't drift from it). */
  function words() {
    $('lab-row').querySelector('label').textContent = LAB_TEXT.lab;
    $('lab-footer').textContent = LAB_TEXT.switchFooter;
    $('open-whats-in-lab').querySelector('.nav-label').textContent = LAB_TEXT.whatsInLab;
    $('open-server').querySelector('.nav-label').textContent = LAB_TEXT.serverRow;
    $('whats-h').textContent = LAB_TEXT.whatsInLab;
    $('server-h').textContent = LAB_TEXT.serverRow;
  }

  /**
   * The switch as stored (settings.lab; missing means on): its rows, and with Lab off nothing of Lab on screen. Called
   * at start and whenever settings change (another tab too).
   */
  function apply(settings) {
    const was = on;
    on = settings?.lab !== false;
    $('lab').checked = on;
    $('lab-rows').hidden = !on;
    if (!on) {
      if (current()) { seq++; fresh(false); toSettings(); }
      hideRepaired();
      labw = null;
      hideNote();
      for (const id of SEND_BOXES) $(id).hidden = true;
      for (const id of ['lab-paste', 'lab-after', 'lab-checkin', 'lab-queue-list']) $(id).textContent = '';
      stopFast();
      stopTest();
    } else if (!was && !$('view-settings').hidden) {
      loadSubtitle();
    }
  }

  /** The "Daylight server ›" row's subtitle ("Optional · Not set up"): the last answer at once, then a fresh one. */
  async function loadSubtitle() {
    if (!on) return;
    const sub = $('server-sub');
    for (const refresh of [false, true]) {
      try {
        const r = await lab.state({ refresh });
        if (r.lab && r.serverSubtitle) sub.textContent = r.serverSubtitle;
      } catch { /* the row still opens the section */ }
    }
  }

  async function onSwitch() {
    const want = $('lab').checked;
    let r;
    try { r = await lab.setLab(want); } catch { r = { lab: !want }; }
    apply({ lab: r.lab });
    changed();
  }

  // --- What's in Lab --------------------------------------------------------------------------------------------------

  /**
   * A tap on a feature runs its gate (1.5). Not ready: its one sentence under the row, said by the row's live region,
   * with Copy Server code for needs-server. Wave 0 runs no Lab feature here: a ready server feature is `later`.
   */
  async function onFeature(f, box) {
    const timer = setTimeout(() => labNote(box, LAB_TEXT.checking, { state: 'checking', ok: false }), CHECKING_AFTER_MS);
    let r;
    try {
      r = await lab.gate(f.id);
    } catch (e) {
      r = { ready: false, state: 'error', message: e?.message ?? String(e), button: null };
    } finally {
      clearTimeout(timer);
    }
    if (r.ready) {
      clearNote(box);
      // A ready feature with a view of its own opens it (3.4): F09's bookmarklet, F26's Setup check.
      if (f.view) openFeature(f.view);
      return;
    }
    const note = labNote(box, r.message, {
      state: r.state, button: r.button,
      onButton: async (b) => {
        if (r.state === 'needs-server' && (await copyText(r.serverCode ?? ''))) noteFollowUp(note, LAB_TEXT.setup.copied);
        b.focus?.();
      },
    });
  }

  /**
   * A newer answer for the list on screen: the header, the heading's line and every row's short state change in
   * place, so a note that is open (a feature tapped while the server was asked) and the focus stay. A list with other
   * features is drawn again, unless a note is open in it.
   */
  function updateLines(box, m) {
    if (!updateWhatsInLab(box, m) && !box.querySelector('.lab-note > *')) renderWhatsInLab(box, m, { onTap: onFeature, use: useSwitch });
    if (m.fresh && !m.cached) fresh(true);
  }

  /**
   * What's in Lab: the cached states at once (the server's answer of the last 10 minutes, 1.5), else "Checking your
   * Daylight server…" on the heading; then the ack topic and the server, asked now, update the lines in place.
   */
  async function openWhats({ focusFeature = null } = {}) {
    if (!on) return;
    const s = ++seq;
    fresh(false);
    show('view-whats-in-lab');
    const box = $('whats');
    let model;
    try { model = await lab.overview({ refresh: false }); } catch (e) { box.textContent = e?.message ?? String(e); return; }
    if (s !== seq || !model.lab) return;
    renderWhatsInLab(box, model, { onTap: onFeature, use: useSwitch, checking: !model.fresh });
    // Back from a feature's view: on that feature's row; else on ‹ Back. The rows change in place afterwards.
    (box.querySelector(`li[data-feature="${focusFeature}"] .lab-row`) ?? $('view-whats-in-lab').querySelector('[data-lab-back]')).focus();
    // It opened: read the ack topic and ask the server now (1.4).
    try { model = await lab.overview({ refresh: true }); } catch { return; }
    if (s !== seq || !model.lab) return;
    updateLines(box, model);
  }

  /**
   * The ledger learnt something (an ack check ran): the timeline's rows and check-in header follow (F01), and so do
   * What's in Lab's header line and Setup check's test article, with no network. Once the server's live answer is on
   * screen, What's in Lab's rows keep it (the cached states can be older than an answer that ran out of time).
   */
  async function ledgerChanged() {
    if (on && labw) {
      try { labw.timeline = await lab.timeline(); } catch { /* drawn with what it had */ }
      if (!$('view-send').hidden) history(rows);
    }
    if (current() === 'view-setup') { await updateTest(); return; }
    if (current() !== 'view-whats-in-lab') return;
    const s = seq;
    let model;
    try { model = await lab.overview({ refresh: false }); } catch { return; }
    if (s === seq && model.lab) updateWhatsInLab($('whats'), document.body.dataset.fresh === '1' ? { ...model, fresh: false } : model);
  }

  /**
   * A switch with a visible label and a footer (its description), as Comfort's and Lab's. -> {row, footer, input}
   * a11y: its accessible name, when the visible label is shorter ("Use", read as "Use Clean links").
   */
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
   * A feature's Use switch (6.5 Q5; LAB-PROTOCOL 2.9.6) on its row of What's in Lab: "Use", read as "Use {feature}", on
   * by default, with its footer saying what turning it off does. settings.labUse keeps it; other tabs follow.
   */
  function useSwitch(f) {
    if (!f.use) return null;
    const { row, footer, input } = switchRow(`lab-use-${f.id}`, LAB_TEXT.use.label, LAB_TEXT.use.footers[f.id], f.use.on,
      { a11y: fillText(LAB_TEXT.use.a11y, { feature: f.name }) });
    input.addEventListener('change', async () => {
      const want = input.checked;
      try { input.checked = (await lab.setUse(f.id, want)).on; } catch { input.checked = !want; }
      await refresh();
      changed();
    });
    const box = el('div');
    box.append(row);
    if (footer) box.append(footer);
    return box;
  }

  // --- a feature's own view (3.4): Setup check (F26) and the bookmarklet (F09) ------------------------------------------

  function openFeature(view) {
    if (!on) return;
    seq++;
    fresh(false);
    if (view === 'view-setup') return openSetup();
    if (view === 'view-f09') return openF09();
    return undefined;
  }

  /** Setup check (F26): the checklist, the test article along its way, the activity log and Copy diagnostics. */
  async function openSetup({ focus = 'back' } = {}) {
    const s = seq;
    show('view-setup');
    const S = LAB_TEXT.setup;
    $('setup-h').textContent = S.title;
    const box = $('setup');
    let r;
    try { r = await lab.checks(); } catch (e) { box.textContent = e?.message ?? String(e); return; }
    if (s !== seq || !r.lab) return;
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
    test.setAttribute('aria-label', S.testSend);
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
        await sendTest();
        await updateTest();
      } catch (e) { said.textContent = ''; said.append(el('p', 'error', e?.message ?? String(e))); }
      send.disabled = false;
      send.focus();
    });
    test.append(send, footer, said);
    box.append(test);

    // The activity log and Copy diagnostics.
    const log = el('details', 'lab-activity');
    log.append(el('summary', null, S.activity));
    const lines = el('pre', 'lab-activity-lines');
    lines.tabIndex = 0;
    log.append(lines);
    log.addEventListener('toggle', async () => {
      if (!log.open) return;
      try { lines.textContent = (await lab.activity()).lines.join('\n'); } catch (e) { lines.textContent = e?.message ?? String(e); }
    });
    const copy = el('button', 'btn secondary lab-diagnostics', S.copyDiagnostics);
    copy.type = 'button';
    const copied = el('p', 'hint small lab-diagnostics-copied');
    copied.setAttribute('role', 'status');
    copy.addEventListener('click', async () => {
      copied.textContent = '';
      try {
        const { text } = await lab.diagnostics();
        if (await copyText(text)) copied.textContent = S.copied;
      } catch (e) { copied.textContent = e?.message ?? String(e); }
    });
    box.append(log, copy, copied);
    if (focus === 'back') $('view-setup').querySelector('[data-lab-back]').focus();
    fresh(true);
    followTest(r.test);
  }

  /** The test article's lines: "✓ Delivered", "✓ In your Reader" (or the name alone until then), and its label meanwhile. */
  function showTest(box, test) {
    box.textContent = '';
    if (!test) { delete box.dataset.reader; return; }
    box.dataset.reader = test.reader ? '1' : '0';
    for (const line of test.lines) box.append(el('p', 'lab-check-line', line));
    if (!test.reader) box.append(el('p', 'note lab-test-label', test.label));
  }

  /** The ledger or the outbox changed: only the test article's lines change, so focus and the open log stay. */
  async function updateTest() {
    const box = $('lab-test-progress');
    if (!box || current() !== 'view-setup') return;
    let r;
    try { r = await lab.checks(); } catch { return; }
    if (!r.lab || current() !== 'view-setup') return;
    showTest(box, r.test);
    followTest(r.test);
  }

  /** While the test article is on its way, Setup check reads the ack topic now and then: its lines follow (F26.1). */
  function followTest(test) {
    if (test && !test.reader && on) {
      testTimer ??= setInterval(() => {
        if (current() === 'view-setup' && on) checkAcks().catch(() => {}); else stopTest();
      }, TEST_CHECK_MS);
    } else stopTest();
  }

  function stopTest() { clearInterval(testTimer); testTimer = null; }

  /** An unmet check's button: the pairing form, the browser's install prompt, or asking it to keep this page's storage. */
  async function fixCheck(c) {
    if (c.action === 'pair') { stopTest(); toPairing(); return; }
    if (c.action === 'install') await install();
    else if (c.action === 'persist') await persist();
    if (current() === 'view-setup') await openSetup({ focus: null });
    $('view-setup').querySelector(`li[data-check="${c.id}"] button, li[data-check="${c.id}"] .lab-check-line`)?.focus?.();
  }

  /**
   * Shortcuts and automation (F09): the bookmarklet (LAB-PLAN F09, Web), as a link to drag to the bookmarks bar, named
   * "Send to Daylight" there, and as text with Copy. Activating the link here copies it too (run in this page, it would
   * send this page). The pairing stays in this browser: the bookmarklet carries none.
   */
  function openF09() {
    show('view-f09');
    const F = LAB_TEXT.features.F09;
    $('f09-h').textContent = F.name;
    const box = $('f09');
    box.textContent = '';
    const code = bookmarklet(pageUrl());
    const sentence = el('p', 'hint lab-f09-sentence', F.sentence);
    const link = el('a', 'lab-bookmarklet', LAB_TEXT.appName.web);
    link.href = code;
    link.setAttribute('draggable', 'true');
    const text = el('code', 'lab-bookmarklet-code', code);
    text.id = 'lab-bookmarklet-code';
    const copy = el('button', 'btn secondary', LAB_TEXT.serverSection.copy);
    copy.type = 'button';
    copy.setAttribute('aria-describedby', text.id);
    const copied = el('p', 'hint small lab-bookmarklet-copied');
    copied.setAttribute('role', 'status');
    const doCopy = async () => {
      copied.textContent = '';
      if (await copyText(code)) copied.textContent = LAB_TEXT.setup.copied;
    };
    link.addEventListener('click', (ev) => { ev.preventDefault(); doCopy(); });
    copy.addEventListener('click', doCopy);
    const codeBox = el('div', 'copy-box');
    codeBox.append(text, copy);
    box.append(sentence, link, codeBox, copied);
    $('view-f09').querySelector('[data-lab-back]').focus();
    fresh(true);
  }

  // --- the send view (W1): the one-time note, the timeline, the queue, Paste and send, the F02 entry point ---------------

  function hideNote() {
    const box = $('lab-note');
    box.hidden = true;
    box.textContent = '';
  }

  /** The views the one-time note shows over (1.2): pairing and sending. */
  let noteView = null;

  /** The one-time note (1.2) while Lab is on, until OK; only over the pairing and sending views. */
  function showNote(view = noteView) {
    noteView = view;
    if (!on || !labw?.noteEnabled || labw.labNoteShown || !['view-pair', 'view-send'].includes(view)) { hideNote(); return; }
    if (!$('lab-note').hidden) return;
    renderLabNote($('lab-note'), {
      onOk: async () => {
        hideNote();
        if (labw) labw.labNoteShown = true;
        noteDone();
        try { await lab.seen('labNoteShown'); } catch { /* shown again next time */ }
        changed();
      },
    });
  }

  /**
   * Reads Lab's state for the send view (lab.page(): the note, the Use switches and the timeline) and draws its boxes:
   * Paste and send, while F33's Use switch is on; the note over the views it belongs to. -> labw (null with Lab off)
   */
  async function refresh() {
    // The page keeps Lab's last state while it is read again, so a tick meanwhile still holds rows waiting for a
    // connection back from v1.1's re-send pass (F07).
    let next = null;
    if (on) {
      try { next = await lab.page(); } catch { next = labw; }
      if (!next?.lab || !on) next = null;
    }
    labw = next;
    showNote();
    drawPaste();
    return labw;
  }

  /** Paste and send (F33): always shown while Lab, F33's Use switch and the pairing are on. */
  function drawPaste() {
    const box = $('lab-paste');
    if (!labw || !labw.use?.F33 || !isPaired()) { box.hidden = true; box.textContent = ''; return; }
    if (box.firstChild) return;
    renderPaste(box, {
      read: () => navigator.clipboard.readText(),
      parse: (text) => {
        const got = copiedLink(text, labw?.settings ?? {});
        return got ? { url: got.item.url, host: got.host } : null;
      },
      send: (text) => sendCopied(text),
    });
  }

  /** The F02 entry point (3.1), under the too-big sentence: "Send files over 9 MB ›", which runs labGate('files'). */
  function bigFiles() {
    const box = $('lab-after');
    if (!labw) return;
    renderBigFiles(box, {
      gate: () => lab.gate('F02').catch((e) => ({ ready: false, state: 'error', message: e?.message ?? String(e) })),
      fix: async (r, note, btn) => {
        if (r.state === 'needs-server' && (await copyText(r.serverCode ?? ''))) noteFollowUp(note, LAB_TEXT.setup.copied);
        btn?.focus?.();
      },
    });
  }

  function clearAfter() {
    const box = $('lab-after');
    box.hidden = true;
    box.textContent = '';
  }

  /** Reads the ledger's view again (F01), so rows drawn after an ack check show its states at once. */
  async function refreshTimeline() {
    if (!on || !labw) return;
    try { labw.timeline = await lab.timeline(); } catch { /* drawn with what it had */ }
  }

  /** The timeline's context for a row (2.5): the ledger's view and whether this device is online. */
  const ctx = () => ({ ...(labw?.timeline ?? {}), online: navigator.onLine });

  /**
   * What a send's answer says with Lab on (2.5): "Waiting for connection" while offline (rule 2), v1.1's words otherwise
   * until it is delivered. -> {text, bad} | null with Lab off
   */
  function resultText(row) {
    if (!labw) return null;
    return labResultMessage({ row }, ctx());
  }

  /**
   * The history with Lab on (2.5, F07): "Waiting to send ({n})" with Cancel on each row, then Recent, in the timeline's
   * words; the check-in header above them; a row whose label changes is announced. -> false with Lab off (the page
   * draws v1.1's history).
   */
  function history(list) {
    rows = list ?? [];
    if (!on || !labw) return false;
    const c = ctx();
    const now = Date.now();
    const said = [];
    for (const row of rows) {
      const label = labRowText(row, c, now).label;
      const was = lastLabel.get(row.id);
      if (was && was !== label && row.status !== 'sending') said.push(rowAnnouncement(row, c, now));
      lastLabel.set(row.id, label);
    }
    if (said.length) announce(said.join('. '));
    const waiting = queueRows(rows);
    const rest = rows.filter((r) => !waiting.includes(r));
    const newestId = rows[0]?.id;
    const acts = { retry, remove };
    const queueList = $('lab-queue-list');
    queueList.textContent = '';
    $('lab-queue').hidden = waiting.length === 0;
    $('lab-queue-h').textContent = fillText(LAB_TEXT.queue.heading, { n: waiting.length });
    for (const row of waiting) queueList.append(renderLabRow(row, c, { newest: row.id === newestId, now, on: acts, cancel: true }));
    const shown = rest.slice(0, HISTORY_SHOWN);
    const recent = $('history');
    recent.textContent = '';
    $('recent-h').hidden = shown.length === 0;
    for (const row of shown) recent.append(renderLabRow(row, c, { newest: row.id === newestId, now, on: acts }));
    renderCheckIn($('lab-checkin'), isPaired() ? labw.timeline : null);
    startFast();
    return true;
  }

  /** F01's faster checks (2.5): every 30 s while the page shows and a delivered row of the last 10 minutes has no settled state. */
  function startFast() {
    const want = () => on && !!labw && visible() && wantsFastChecks(rows, Date.now(), labw.timeline?.states ?? {});
    if (fastTimer || !want()) return;
    fastTimer = setInterval(() => {
      if (!want()) { stopFast(); return; }
      checkAcks().catch(() => {});
    }, FAST_CHECK_MS);
  }

  function stopFast() { clearInterval(fastTimer); fastTimer = null; }


  // --- the Daylight server ----------------------------------------------------------------------------------------------

  async function openServer({ focus = true } = {}) {
    if (!on) return;
    const s = ++seq;
    fresh(false);
    show('view-server');
    const box = $('server');
    let model;
    try { model = await lab.serverView(); } catch (e) { box.textContent = e?.message ?? String(e); return; }
    if (s !== seq || !model.lab) return;
    const said = setupSaid;
    setupSaid = null;
    renderServerSection(box, model, {
      copy: (code) => copyText(code ?? ''),
      // "Your Daylight server moved to {host}. Use it?" (2.6): the module's confirmMove, then the section is drawn
      // again with the new server's state and the focus on its heading, so the state is read next. Cancel changes
      // nothing, so the section asks again the next time it opens.
      move: async (yes) => {
        if (!yes) return;
        await lab.confirmMove();
        changed();
        await openServer({ focus: false });
        $('server-h').focus();
      },
      setupCheck: (link) => lab.checkSetupLink(link),
      setup: async (link) => {
        const r = await lab.setupServer(link);
        if (r.done) { setupSaid = r.done; changed(); await openServer({ focus: false }); }
        return r;
      },
      setupSaid: said ?? undefined,
      saveAddress: async (url) => {
        const r = await lab.setServerAddress(url);
        if (!r.error) { changed(); await openServer({ focus: false }); }
        return r;
      },
    });
    if (focus) $('view-server').querySelector('[data-lab-back]').focus();
    fresh(true);
  }

  // --- the re-pairing follow-up -----------------------------------------------------------------------------------------

  function hideRepaired() {
    const box = $('repaired');
    box.hidden = true;
    box.textContent = '';
  }

  /**
   * After a re-pairing that locked the Daylight server (2.6, DESIGN 12.7): the locked text with the new Server code,
   * Copy and the re-run help, in the send view while Lab is on, until OK or the server answers ready. say: announce it
   * (it just appeared after the pairing).
   */
  async function loadRepaired({ say = false } = {}) {
    let r = null;
    if (on && isPaired()) {
      try { r = (await lab.repaired()).repaired; } catch { r = null; }
    }
    if (!r) { hideRepaired(); return; }
    const box = $('repaired');
    const wasShown = !box.hidden;
    box.hidden = false;
    renderRepaired(box, r, {
      copy: (code) => copyText(code ?? ''),
      ok: async () => {
        // The focus goes on at once (OK itself is gone), then the follow-up is forgotten.
        hideRepaired();
        afterRepairSeen();
        await lab.repairSeen();
        changed();
      },
    });
    if (say && !wasShown) announce(r.message);
  }

  // --- wiring -------------------------------------------------------------------------------------------------------------

  function wire() {
    words();
    $('lab').addEventListener('change', onSwitch);
    $('open-whats-in-lab').addEventListener('click', () => openWhats());
    $('open-server').addEventListener('click', () => openServer());
    // ‹ Back: Settings again, with the focus on the row that opened this view.
    for (const [view, row] of [['view-whats-in-lab', 'open-whats-in-lab'], ['view-server', 'open-server']]) {
      $(view).querySelector('[data-lab-back]').addEventListener('click', () => {
        seq++;
        fresh(false);
        clearNotes($(view));
        toSettings({ focus: row });
      });
    }
    // A feature's view: ‹ Back to What's in Lab, with the focus on the feature's row.
    for (const [view, id] of [['view-setup', 'F26'], ['view-f09', 'F09']]) {
      $(view).querySelector('[data-lab-back]').addEventListener('click', () => {
        stopTest();
        return openWhats({ focusFeature: id });
      });
    }
    // A tap on another control closes an open note (1.5); leaving the screen does too (each view is drawn anew).
    for (const v of LAB_VIEWS) dismissNotesOnOtherControls($(v));
    // The page shows again: F01's faster checks may run again.
    document.addEventListener('visibilitychange', () => { if (visible()) startFast(); else stopFast(); });
  }

  return {
    wire, apply, loadSubtitle, openWhats, openServer, loadRepaired, ledgerChanged, current, get on() { return on; },
    // Wave 1
    refresh, refreshTimeline, showNote, history, resultText, bigFiles, clearAfter, openSetup, openF09, updateTest,
    get model() { return labw; },
  };
}
