// The web sender's Lab screens (LAB-PLAN 1.1, 1.4, 1.5 and 2.6; card B0, Wave 0): the Lab switch at the top of
// Settings with its two rows, What's in Lab, the Daylight server section and the re-pairing follow-up in the send view.
// The data comes from web-lab.js (createWebLab); lab-ui.js (the extension's, copied by build.mjs) builds the parts, so
// the page says exactly what the extension's lab.html says. Every word is LAB_TEXT's or the server module's.
//
//   Settings › Lab                the switch (on by default), its footer, and while Lab is on "What’s in Lab ›" and
//                                 "Daylight server ›" ("Optional · Not set up")
//   #view-whats-in-lab            short states only (the cached ones at once, 1.5); a feature's one sentence shows under
//                                 it when it is tapped
//   #view-server                  the Daylight server section, with the long texts and the move question (2.6)
//   #repaired (the send view)     after a re-pairing that locked the server, until OK or a ready server (DESIGN 12.7)
//
// With Lab off only the switch and its footer show (1.3): the Lab views close and the follow-up hides.

import { LAB_TEXT } from './daylight-lab.js';
import {
  labNote, noteFollowUp, clearNote, clearNotes, dismissNotesOnOtherControls, copyText, renderWhatsInLab,
  updateWhatsInLab, renderServerSection, renderRepaired,
} from './lab-ui.js';

/** How long a gate may take before its note says "Checking your Daylight server…" (1.5). */
const CHECKING_AFTER_MS = 150;
export const LAB_VIEWS = ['view-whats-in-lab', 'view-server'];

/**
 * lab: createWebLab's. $: the page's getElementById. show(view): the page's view switch. toSettings(): back to
 * Settings. announce(text): the send view's polite live region. changed(): tells the page's other tabs. isPaired():
 * whether the page is paired now. afterRepairSeen(): where focus goes after OK on the follow-up.
 */
export function createLabPage({ lab, $, show, toSettings, announce = () => {}, changed = () => {}, isPaired = () => false, afterRepairSeen = () => {} }) {
  let on = true;
  let seq = 0; // the Lab view drawn last; an older answer is dropped
  let setupSaid = null; // the setup's done line, said once the section is drawn again

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
    if (r.ready) { clearNote(box); return; }
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
  function updateLines(box, model) {
    if (!updateWhatsInLab(box, model) && !box.querySelector('.lab-note > *')) renderWhatsInLab(box, model, { onTap: onFeature });
    if (model.fresh && !model.cached) fresh(true);
  }

  /**
   * What's in Lab: the cached states at once (the server's answer of the last 10 minutes, 1.5), else "Checking your
   * Daylight server…" on the heading; then the ack topic and the server, asked now, update the lines in place.
   */
  async function openWhats() {
    if (!on) return;
    const s = ++seq;
    fresh(false);
    show('view-whats-in-lab');
    const box = $('whats');
    let model;
    try { model = await lab.overview({ refresh: false }); } catch (e) { box.textContent = e?.message ?? String(e); return; }
    if (s !== seq || !model.lab) return;
    renderWhatsInLab(box, model, { onTap: onFeature, checking: !model.fresh });
    $('view-whats-in-lab').querySelector('[data-lab-back]').focus();
    // It opened: read the ack topic and ask the server now (1.4).
    try { model = await lab.overview({ refresh: true }); } catch { return; }
    if (s !== seq || !model.lab) return;
    updateLines(box, model);
  }

  /**
   * The ledger learnt something (an ack check ran): What's in Lab's header line follows, with no network. Once the
   * server's live answer is on screen, the rows keep it (the cached states can be older than an answer that ran out of
   * time).
   */
  async function ledgerChanged() {
    if (current() !== 'view-whats-in-lab') return;
    const s = seq;
    let model;
    try { model = await lab.overview({ refresh: false }); } catch { return; }
    if (s === seq && model.lab) updateWhatsInLab($('whats'), document.body.dataset.fresh === '1' ? { ...model, fresh: false } : model);
  }

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
      saveLabel: 'Save',
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
    $('open-whats-in-lab').addEventListener('click', openWhats);
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
    // A tap on another control closes an open note (1.5); leaving the screen does too (each view is drawn anew).
    for (const v of LAB_VIEWS) dismissNotesOnOtherControls($(v));
  }

  return { wire, apply, loadSubtitle, openWhats, openServer, loadRepaired, ledgerChanged, current, get on() { return on; } };
}
