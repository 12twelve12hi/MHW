// Lab for Windows (LAB-PLAN 1, 2.2.6 and 2.6; card WIN0, Wave 0), with no DOM and no Tauri: the Lab switch, the sender
// ledger, the gates and the Daylight server. core.js makes one with createLab() and wires the ledger into its Sender;
// app.js and lab-ui.js draw what it answers. Every word comes from daylight-lab.js (LAB_TEXT and its helpers) or the
// server module (daylight-server.js); both are copied in by build.mjs.
//
// Storage (the app's JSON store, bridge.js; the same adapter as the outbox):
//   settings.lab           the Lab switch: missing means on, and the first start writes true (1.2); never synced and
//                          never in a pairing link, so pairing, unpairing and re-pairing leave it as it is
//   settings.labNoteShown  the one-time note (1.2), shown only from a build with F01 or F04: LAB_NOTE_ENABLED
//   lab/inbox, lab/heard, lab/states   the ledger (LabLedger), fed by every ack-topic frame that decrypts, Lab on or
//                          off, through the Sender's onAckHeader (2.2.6)
//   lab/server             the last server answer {state, at}, for the "Daylight server ›" row's subtitle and What's
//                          in Lab's cached states (with the module's server/status, while 10 minutes old or less, 1.5)
//   lab/repaired           {at}: this PC re-paired with another Daylight while it knew a Daylight server, which it
//                          locked first (2.6, DESIGN 3.4). The send view shows the locked text with the new Server code
//                          and the re-run help (DESIGN 12.7) until OK, or until the new pairing's server answers ready
//   server/*               the server module's own keys (DESIGN 13.1); only daylight-server.js writes them
//
// Discovery and every server call run only with Lab on (DESIGN 4.3). A pairing change with another secret removes the
// lab/* keys with the outbox (applyPairingChange removes the ledger's; this store can't list its keys, so
// afterPairingChange removes this file's own); before it, a server that knows the old pairing is locked
// (lockBeforeRepair, 2.6), Lab on or off, and a typed Server address and the cached server status (the old server's)
// are forgotten through the module, as on Unpair.

import * as ds from './daylight-share.js';
import {
  LAB_TEXT, LabLedger, labHook, labGate, needsMessage, inboxLabText, featureName, serverHeadingShort,
  serverRowSubtitle, serverFeatureShort, labInboxSeenText, aiTodayText, setupConfirmText, serverMovedText,
  GATE_DEADLINE_MS, LEDGER_STATES_MAX,
} from './daylight-lab.js';
import {
  DaylightServer, localMessage, stateFromStatus, showFingerprint, noticeText, parseSetupLink, RERUN_HELP,
  SERVER_API, SERVER_API_MIN, STATUS_REFRESH_MS,
} from './daylight-server.js';

/** The platform of LAB_TEXT's per-platform words ({app}, {path}). */
export const PLATFORM = 'windows';
export const APP_NAME = LAB_TEXT.appName[PLATFORM];

/** The one-time note (1.2) needs F01 or F04 in this build: from WIN1 (W1) on. W0 shows none. */
export const LAB_NOTE_ENABLED = false;

/**
 * What's in Lab (1.4) on Windows: the Lab features this build has (W0: none yet; WIN1 adds F01, F07, F08, F09, F16, F26
 * and F33), then the server features Windows has. Of the four (1.4's "Apps" column), only Files over 9 MB lists
 * Windows: Summaries with Claude, Email-in and Feeds don't.
 */
export const LAB_FEATURES = [];
export const LAB_SERVER_FEATURES = ['F02'];
/** The Lab features this build runs (labGate's `built`). A server feature that is ready but not built is `later`. */
export const BUILT_FEATURES = [];

export const SERVER_KEY = 'lab/server';
export const REPAIRED_KEY = 'lab/repaired';
/** The keys of this file that a pairing change with another secret removes (the ledger's go with applyPairingChange). */
export const LAB_APP_KEYS = [SERVER_KEY, REPAIRED_KEY];

/** The server states whose messages say to paste a new setup link: Set up with a link comes first then (2.6). */
const SETUP_FIRST = ['needs-server', 'pairing-mismatch', 'locked'];

/** The states that belong to the whole server, not to one feature: the What's in Lab heading's line. */
const SERVER_WIDE = ['needs-pairing', 'needs-server', 'pairing-mismatch', 'server-outdated', 'app-outdated', 'locked', 'OFFLINE', 'error'];

/** The Lab switch as one value (1.2): a missing key means on. */
export const isLabOn = (settings) => settings?.lab !== false;

/** The one accessor of 1.2 for JS: the Lab switch from a storage adapter. */
export async function labOn(storage) {
  try { return isLabOn(await storage.get('settings')); } catch { return true; }
}

function withDeadline(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); })])
    .finally(() => clearTimeout(timer));
}

/**
 * storage: the app's storage adapter; fetch: the window's (undefined: the global one); getPairing, getSettings: core's;
 * updateSettings(fn): core's settings lock, fn(settings) -> the new settings (or the same object for no change);
 * refreshAcks(): reads the ack topic now (What's in Lab opening), or null; from, app: on what the server sends;
 * gateDeadlineMs: labGate's 5 s (tests shorten it).
 */
export function createLab({
  storage, fetch: fetchFn, now = () => Date.now(), log = console, getPairing, getSettings, updateSettings,
  refreshAcks = null, from = '', app = '', gateDeadlineMs = GATE_DEADLINE_MS,
} = {}) {
  const ledger = new LabLedger({ storage, now });
  const hook = labHook(ledger);
  let serverCache = null; // {key, server}
  let probing = null; // {key, force, promise}: one discovery at a time

  const settings = async () => (await getSettings()) ?? {};
  const get = async (k) => { try { return await storage.get(k); } catch { return undefined; } };
  const keyOf = (p) => `${p.code}|${p.relay}`;

  // --- the switch ---------------------------------------------------------------------------------------------------

  /** The first start of a build with Lab writes lab = true when the key is missing (1.2); a stored value stays. */
  async function ensureDefault() {
    await updateSettings((s) => (s.lab === undefined ? { ...s, lab: true } : s));
  }

  /** -> {lab}. Throws when the setting can't be saved (the switch is then put back). */
  async function setLab(want) {
    const s = await updateSettings((cur) => ({ ...cur, lab: !!want }));
    probing = null;
    return { lab: isLabOn(s) };
  }

  // --- the Daylight server ------------------------------------------------------------------------------------------

  function serverFor(pairing) {
    if (serverCache?.key !== keyOf(pairing)) {
      serverCache = { key: keyOf(pairing), server: new DaylightServer({ pairing, storage, fetch: fetchFn, now, from, app }) };
    }
    return serverCache.server;
  }

  /**
   * The server as a whole: discovery (the pin, a move, the API level), then GET /v1/status (cached 10 minutes).
   * force: Lab settings opened (the server section or What's in Lab), so the config topic is read now whatever the
   * cached config's age (server DESIGN 4.3 rule 1) and the status is asked now: a server that moved is asked about at
   * once, not after the config's 6 hours. One relay poll at most, two when a server found from the cached config fails
   * (below). -> {state, message, config?, status?, moved?}; state is 'ready' or a state of SERVER_WIDE.
   */
  async function probeNow(pairing, force) {
    const server = serverFor(pairing);
    let d;
    try { d = await server.discover({ force }); } catch (e) { return server.noteError('', e); }
    if (!d) {
      const pin = await get('server/pin');
      const state = pin && pin.fingerprint !== (await server.values()).fingerprint ? 'pairing-mismatch' : 'needs-server';
      return { state, message: localMessage(state) };
    }
    const { config } = d;
    if (config.api < SERVER_API_MIN) return { state: 'server-outdated', message: localMessage('server-outdated'), config, moved: d.moved };
    if (config.api > SERVER_API) return { state: 'app-outdated', message: localMessage('app-outdated'), config, moved: d.moved };
    try {
      const status = await server.status({ force });
      return { state: 'ready', message: null, config, status, moved: d.moved };
    } catch (e) {
      // The pinned server may be gone because it moved (a deploy with "New setup link" deletes the old Worker): the
      // move goes with the error, so the section can ask about it. A config that came from the cache is read again
      // from the config topic once in this check (2.6), so the move is found now: after a 401, discover() polls only
      // on the first BAD_AUTH of an episode (noteError removed server/configAt: 2.6's "discover({force: true}) once");
      // after a server that is gone or failing (OFFLINE, SERVER_ERROR), discover({force: true}). A forced check has
      // read the topic already.
      const out = await server.noteError('', e);
      let moved = d.moved;
      const code = e?.code;
      if (!force && d.source === 'cache' && (code === 'BAD_AUTH' || code === 'OFFLINE' || code === 'SERVER_ERROR')) {
        try { moved = (await server.discover(code === 'BAD_AUTH' ? {} : { force: true }))?.moved ?? moved; } catch { /* the relay is out of reach too */ }
      }
      return { ...out, config, moved };
    }
  }

  async function probe({ force = false } = {}) {
    const pairing = await getPairing();
    if (!pairing) return { state: 'needs-pairing', message: needsMessage('needs-pairing', { platform: PLATFORM }) };
    const key = keyOf(pairing);
    if (!probing || probing.key !== key || (force && !probing.force)) {
      const p = { key, force, promise: null };
      p.promise = probeNow(pairing, force).catch((e) => ({ state: 'error', message: e?.message ?? null })).then(async (r) => {
        try {
          await storage.set(SERVER_KEY, { state: r.state, at: now() });
          // The new pairing's server answers: the re-pairing follow-up has done its job.
          if (r.state === 'ready') await storage.remove(REPAIRED_KEY);
        } catch { /* shown anyway */ }
        return r;
      }).finally(() => { if (probing === p) probing = null; });
      probing = p;
    }
    return probing.promise;
  }

  /** A probe within the gate's 5 s (1.5, 2.6): a server that has not answered by then is OFFLINE. */
  const probeInTime = (opts) => withDeadline(probe(opts), gateDeadlineMs, () => ({ state: 'OFFLINE', message: localMessage('OFFLINE') }));

  /** A feature's server state from a probe (2.6): the server's state for a whole-server answer, else the feature's. */
  function featureState(p, key) {
    if (p.state !== 'ready') return { state: p.state, message: p.message ?? localMessage(p.state) };
    return stateFromStatus(p.status, key);
  }

  /** The Server code to copy (the needs-server note's button, the server section), or '' when not paired. */
  async function serverCode() {
    const pairing = await getPairing();
    if (!pairing) return '';
    try { return await serverFor(pairing).serverCode(); } catch { return ''; }
  }

  /**
   * The gate (1.5, 2.7.2) as Windows runs it. -> labGate's {ready, state, message, short, button}, plus `serverCode`
   * for needs-server (Copy Server code). probeResult: an answer to reuse (What's in Lab's states), else the server is
   * asked (a cached status of 10 minutes or less answers at once; labGate's 5 s deadline gives OFFLINE).
   */
  async function gate(feature, { probeResult = null } = {}) {
    const s = await settings();
    const pairing = await getPairing();
    const r = await labGate(feature, {
      lab: isLabOn(s), paired: !!pairing, app: APP_NAME, platform: PLATFORM,
      hasCap: (token) => ledger.hasCap(token),
      server: { state: async (key) => featureState(probeResult ?? (await probe()), key) },
      serverMessage: localMessage, deadlineMs: gateDeadlineMs,
      built: (f) => BUILT_FEATURES.includes(f),
    });
    const out = { ...r };
    if (r.state === 'needs-server' && pairing) out.serverCode = await serverCode();
    return out;
  }

  // --- what the screens show ----------------------------------------------------------------------------------------

  /**
   * Settings' Lab block (1.1): the switch, and the "Daylight server ›" row's subtitle. refresh: ask the server when
   * the last answer is over 10 minutes old (within the gate's 5 s); otherwise nothing goes on the network.
   * -> {lab, noteEnabled, labNoteShown, serverState, serverSubtitle}
   */
  async function state({ refresh = true } = {}) {
    const s = await settings();
    const lab = isLabOn(s);
    const out = { lab, noteEnabled: LAB_NOTE_ENABLED, labNoteShown: !!s.labNoteShown, serverState: null, serverSubtitle: null };
    if (!lab) return out;
    let st;
    if (!(await getPairing())) st = 'needs-pairing';
    else {
      const last = await get(SERVER_KEY);
      st = last?.state ?? null;
      if (refresh && (!last || now() - last.at > STATUS_REFRESH_MS)) st = (await probeInTime()).state;
    }
    out.serverState = st;
    out.serverSubtitle = st ? serverRowSubtitle(st) : null;
    return out;
  }

  const row = (id, short) => ({ id, name: featureName(id), sentence: LAB_TEXT.features[id].sentence, short });

  /**
   * The server's last answer as a probe result, read from storage without asking anyone (1.5: What's in Lab uses
   * cached states): lab/server when it is 10 minutes old or less, with the module's cached status for a ready server.
   * A pairing change with another secret removes lab/server, so it is always this pairing's. -> a probe result, or null
   */
  async function cachedProbe() {
    const last = await get(SERVER_KEY);
    if (!last?.state || !(now() - (last.at ?? 0) <= STATUS_REFRESH_MS)) return null;
    if (last.state !== 'ready') return SERVER_WIDE.includes(last.state) ? { state: last.state, message: localMessage(last.state) } : null;
    const status = await get('server/status');
    return status && typeof status === 'object' ? { state: 'ready', message: null, status } : null;
  }

  /**
   * What's in Lab (1.4): the Inbox's Lab state, the features with their short states, then the server group.
   * refresh: it opened, so read the ack topic (the header is then current) and ask the server now, both at once and
   * each within the gate's 5 s. Without refresh nothing goes on the network: the cached states (cachedProbe; `cached`
   * true), or, with nothing recent, no short states yet (null; fresh false).
   * -> {lab, header, fresh, cached, features: [{id, name, sentence, short}], server: {state, short, features: [...]}}
   */
  async function overview({ refresh = true } = {}) {
    if (!isLabOn(await settings())) return { lab: false };
    const pairing = await getPairing();
    // The ack topic and the server are asked at the same time, each within the gate's 5 s.
    const asking = pairing && refresh ? probeInTime({ force: true }) : null;
    if (pairing && refresh && refreshAcks) await withDeadline(Promise.resolve().then(refreshAcks).catch(() => {}), gateDeadlineMs, () => {});
    const snap = await ledger.snapshot();
    const header = inboxLabText({ inboxLab: snap.inboxLab, checkedIn: snap.checkedIn }, now());
    let p = null;
    if (!pairing) p = { state: 'needs-pairing' };
    else if (asking) p = await asking;
    else p = await cachedProbe();
    if (!p) {
      return {
        lab: true, header, fresh: false, cached: false,
        features: LAB_FEATURES.map((id) => row(id, null)),
        server: { state: null, short: null, features: LAB_SERVER_FEATURES.map((id) => row(id, null)) },
      };
    }
    const heading = SERVER_WIDE.includes(p.state) ? p.state : 'ready';
    const features = [];
    for (const id of LAB_FEATURES) features.push(row(id, (await gate(id, { probeResult: p })).short ?? LAB_TEXT.ready));
    const serverRows = [];
    for (const id of LAB_SERVER_FEATURES) serverRows.push(row(id, serverFeatureShort((await gate(id, { probeResult: p })).state, heading)));
    return {
      lab: true, header, fresh: true, cached: !!pairing && !asking, features,
      server: { state: heading, short: serverHeadingShort(heading), features: serverRows },
    };
  }

  /**
   * The server's new address, when discovery found this pairing's server at another origin than the pinned one and
   * the user hasn't said yes yet (2.6: server/pendingMove, which the module keeps). Read from storage, so the question
   * stays when the probe ran out of time (an old address that hangs: the gate's 5 s end before the module's own status
   * deadline); only while the cached config still names that origin and no Server address is typed (it wins over
   * discovery). -> the origin, or null
   */
  async function pendingMove(server) {
    try {
      const [move, pin, config, manual] = await Promise.all(['server/pendingMove', 'server/pin', 'server/config', 'server/manualUrl'].map(get));
      const { fingerprint } = await server.values();
      if (manual || !move?.origin || move.fingerprint !== fingerprint) return null;
      if (pin?.fingerprint !== fingerprint || pin.origin === move.origin) return null;
      return config?.server === move.origin && config.fingerprint === fingerprint ? move.origin : null;
    } catch { return null; }
  }

  /**
   * The Daylight server section (2.6): where setup happens, so it carries the long texts.
   * -> {lab, paired, state, message, host, fingerprint, delivery, v1Notice, moved, serverCode, labInbox, aiToday,
   *     manualUrl, setupFirst, rerun}
   * moved: "Your Daylight server moved to {host}. Use it?" while the server moved (2.6), also when the old address
   * failed or ran out of time (pendingMove); else null.
   */
  async function serverView() {
    if (!isLabOn(await settings())) return { lab: false };
    const pairing = await getPairing();
    if (!pairing) {
      return { lab: true, paired: false, state: 'needs-pairing', message: needsMessage('needs-pairing', { platform: PLATFORM }), rerun: RERUN_HELP };
    }
    const server = serverFor(pairing);
    const p = await probeInTime({ force: true });
    const config = p.config ?? null;
    const status = p.status ?? null;
    const manualUrl = (await get('server/manualUrl')) ?? '';
    const badAuth = !!(await get('server/badAuthAt'));
    const movedTo = p.moved ?? (await pendingMove(server));
    return {
      lab: true, paired: true, state: p.state,
      message: p.state === 'ready' ? LAB_TEXT.ready : (p.message ?? localMessage(p.state)),
      host: config ? originHostOf(config.server) : '',
      fingerprint: showFingerprint((await server.values()).fingerprint),
      delivery: config?.delivery ?? null,
      v1Notice: config?.delivery === 'v1' ? noticeText('v1') : null,
      moved: movedTo ? serverMovedText(movedTo) : null,
      serverCode: await server.serverCode(),
      labInbox: status ? labInboxSeenText(status.inbox?.lastSeen ?? null, now()) : null,
      aiToday: status?.usage?.ai ? aiTodayText(status.usage.ai.usd, status.usage.ai.limitUsd) : null,
      manualUrl,
      // Set up with a link (2.6): first while the state's message says to paste a new setup link (BAD_AUTH's too).
      setupFirst: SETUP_FIRST.includes(p.state) || (p.state === 'error' && badAuth),
      rerun: RERUN_HELP,
    };
  }

  /** "Your Daylight server moved to {host}. Use it?" answered yes (2.6): the module's confirmMove. -> true when moved */
  async function confirmMove() {
    const pairing = await getPairing();
    if (!pairing || !isLabOn(await settings())) return false;
    probing = null;
    try { return await serverFor(pairing).confirmMove(); } finally { probing = null; }
  }

  /**
   * Set up with a link (2.6 "Setup link", DESIGN 3.5), step 2: the link is read here, and nothing is sent.
   * -> {server, confirm} (the confirmation's text) | {error} (the module's message for its reason)
   */
  async function checkSetupLink(link) {
    if (!(await getPairing())) return { error: needsMessage('needs-pairing', { platform: PLATFORM }) };
    if (!isLabOn(await settings())) return { error: LAB_TEXT.labOff.replace('{app}', APP_NAME) };
    try {
      const { server } = await parseSetupLink(link);
      return { server, confirm: setupConfirmText(server) };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  }

  /**
   * Step 4, once the user said Use it: DaylightServer.setup(link) sends this pairing's Server code with the link's
   * one-time token, then pins the server. -> {done} (LAB_TEXT's done line) | {error} (the module's messages)
   */
  async function setupServer(link) {
    const checked = await checkSetupLink(link);
    if (checked.error) return checked;
    const server = serverFor(await getPairing());
    probing = null;
    try {
      await server.setup(link);
      return { done: LAB_TEXT.serverSection.setupDone };
    } catch (e) {
      return { error: e?.message || String(e) };
    } finally {
      probing = null;
    }
  }

  /** The Server address field (2.6): a typed origin, checked with GET /v1/hello and /v1/status; empty clears it. */
  async function setServerAddress(url) {
    const pairing = await getPairing();
    if (!pairing) return { error: needsMessage('needs-pairing', { platform: PLATFORM }) };
    if (!isLabOn(await settings())) return { error: LAB_TEXT.labOff.replace('{app}', APP_NAME) };
    const server = serverFor(pairing);
    probing = null;
    try {
      if (!String(url ?? '').trim()) { await server.clearManualUrl(); return { manualUrl: '' }; }
      return { manualUrl: await server.setManualUrl(url) };
    } catch (e) {
      return { error: e?.message || String(e) };
    } finally {
      probing = null;
    }
  }

  // --- pairing and housekeeping -------------------------------------------------------------------------------------

  /**
   * Before a pairing with another secret replaces `current` (2.6 Re-pairing): a server that knows the old pairing is
   * locked, Lab on or off, when a pin exists (or a typed Server address). The typed address is then forgotten: it is
   * the old server's, which the next deploy replaces (DESIGN 12.7), and it would hide the new one from discovery; so is
   * the cached status, the old server's too (lockBeforeRepair drops it; forgetServer whatever was sent). Never throws; gives up on the lock after `ms`. -> {known: a server was known, locked: the lock request succeeded}
   */
  async function beforeRepair(current, next, ms = 10000) {
    // A typed address or a status kept with no pairing is an earlier pairing's (only Unpair leaves none, and it
    // forgets both).
    if (!current && next) await forgetServer(next);
    if (!current || !next || ds.samePairingSecret(current, next)) return { known: false, locked: false };
    const pin = await get('server/pin');
    const manual = await get('server/manualUrl');
    let locked = false;
    if (pin || manual) {
      const server = new DaylightServer({ pairing: current, storage, fetch: fetchFn, now, from, app });
      serverCache = null;
      probing = null;
      locked = await withDeadline(server.lockBeforeRepair().catch(() => false), ms, () => false);
    }
    // The typed address and the status are the old server's, whether a lock was sent or not.
    await forgetServer(current);
    return { known: !!(pin || manual), locked };
  }

  /**
   * Before Unpair removes `current`: a typed Server address and the server's cached status are forgotten, as a
   * re-pairing forgets them (beforeRepair). Both are this pairing's server's, and the next pairing may be another
   * Daylight's: a typed address kept would hide that one's server from discovery (the typed address wins) and answer
   * BAD_AUTH instead of pairing-mismatch; a status kept (the module's server/status is not tied to a pairing) would
   * answer that Daylight's gates and the "Daylight server ›" row for up to 10 minutes with this server's states. The
   * pin stays (it tells pairing-mismatch), and nothing is locked: unpairing is not re-pairing, and the same Daylight
   * may come back. Never throws.
   */
  async function beforeUnpair(current) {
    await forgetServer(current);
  }

  /**
   * Removes a typed Server address and the cached server status through the module (clearManualUrl removes both, and
   * doesn't use the pairing it is made with; nothing outside the module writes server/status, LAB-PLAN 2.6); the
   * server objects start afresh. Never throws.
   */
  async function forgetServer(pairing) {
    serverCache = null;
    probing = null;
    if (!pairing?.secret) return;
    const [manual, status] = await Promise.all([get('server/manualUrl'), get('server/status')]);
    if (manual === undefined && status === undefined) return;
    try {
      await new DaylightServer({ pairing, storage, fetch: fetchFn, now, from, app }).clearManualUrl();
    } catch (e) { log.warn?.('Send to Daylight: the old server’s address or status was kept', e); }
  }

  /**
   * After a pairing change (applyPairingChange has run; next null: unpaired). With another secret, this file's lab/
   * keys go too, and when a server was known (beforeRepair's answer) the follow-up is kept for the send view
   * (DESIGN 12.7), whether the lock reached the server or not (DESIGN 3.4).
   */
  async function afterPairingChange(current, next, repair = {}) {
    if (current && next && ds.samePairingSecret(current, next)) return;
    serverCache = null;
    probing = null;
    for (const k of LAB_APP_KEYS) { try { await storage.remove(k); } catch (e) { log.warn?.(`Send to Daylight: couldn’t remove ${k}`, e); } }
    if (next && repair.known) {
      try { await storage.set(REPAIRED_KEY, { at: now() }); } catch (e) { log.warn?.('Send to Daylight: re-pairing note not kept', e); }
    }
  }

  /**
   * The re-pairing follow-up (2.6, DESIGN 12.7) while Lab is on, until OK or a ready server. Nothing goes on the
   * network. -> {lab, repaired: null | {state: 'locked', message, serverCode, rerun}}
   */
  async function repaired() {
    if (!isLabOn(await settings())) return { lab: false, repaired: null };
    const pairing = await getPairing();
    const mark = await get(REPAIRED_KEY);
    if (!pairing || !mark) return { lab: true, repaired: null };
    const last = await get(SERVER_KEY);
    if (last?.state === 'ready' && last.at >= mark.at) {
      try { await storage.remove(REPAIRED_KEY); } catch { /* shown again next time */ }
      return { lab: true, repaired: null };
    }
    return { lab: true, repaired: { state: 'locked', message: localMessage('locked'), serverCode: await serverCode(), rerun: RERUN_HELP } };
  }

  /** OK on the re-pairing follow-up. */
  async function repairSeen() { await storage.remove(REPAIRED_KEY); }

  /** Keeps the ledger's states for ids still in the outbox or the hosted outbox (2.2.6); writes only when it must. */
  async function prune() {
    try {
      const ids = new Set([...((await get('outbox')) ?? []), ...((await get('server/hosted')) ?? [])].map((r) => r?.id).filter(Boolean));
      const states = (await get('lab/states')) ?? {};
      const keys = Object.keys(states);
      if (keys.length <= LEDGER_STATES_MAX && keys.every((id) => ids.has(id))) return;
      await ledger.prune([...ids]);
    } catch (e) { log.warn?.('Send to Daylight: Lab ledger prune failed', e); }
  }

  /** What the end-to-end test's status file says about Lab (1.7): the switch and what the ledger knows. */
  async function status() {
    const snap = await ledger.snapshot();
    return {
      lab: isLabOn(await settings()), inboxLab: snap.inboxLab, caps: snap.caps, checkedIn: snap.checkedIn,
      labHeader: inboxLabText({ inboxLab: snap.inboxLab, checkedIn: snap.checkedIn }, now()), labStates: snap.states,
    };
  }

  return {
    ledger, hook, ensureDefault, setLab, labOn: () => labOn(storage), state, overview, gate, serverView, serverCode,
    confirmMove, checkSetupLink, setupServer, setServerAddress, beforeRepair, beforeUnpair, afterPairingChange, repaired,
    repairSeen, prune, probe, status,
  };
}

/** {host} of a server origin, as LAB_TEXT's server lines read it: the text without its scheme and any path. */
export function originHostOf(origin) {
  let host = String(origin ?? '');
  const scheme = host.indexOf('://');
  if (scheme >= 0) host = host.slice(scheme + 3);
  const slash = host.indexOf('/');
  return slash >= 0 ? host.slice(0, slash) : host;
}
