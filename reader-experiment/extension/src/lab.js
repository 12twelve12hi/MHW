// Lab in the extension's background (LAB-PLAN 1, 2.2.6 and 2.6; card X0, Wave 0). createApp (core.js) makes one with
// createLab() and passes Lab's messages to it. Everything that needs the pairing secret or the server token runs here,
// in the service worker (DESIGN 13.2): the Lab switch, the sender ledger, the gates and the Daylight server.
//
//   settings.lab           the Lab switch: missing means on, and the first start writes true (1.2); never synced and
//                          never in a pairing link, so pairing, unpairing and renaming leave it as it is
//   settings.labNoteShown  the one-time note (1.2), shown only from a build with F01 or F04: LAB_NOTE_ENABLED
//   lab/inbox, lab/heard, lab/states   the ledger (daylight-lab.js LabLedger), fed by every ack-topic frame that
//                          decrypts, Lab on or off, through the Sender's onAckHeader
//   lab/server             this file's last server answer {state, at}, for the popup's "Daylight server ›" row and
//                          What's in Lab's cached states (with the module's server/status, while 10 minutes old or less)
//   lab/repaired           {at}: this browser re-paired with another Daylight while it knew a Daylight server, which
//                          it locked first (2.6, DESIGN 3.4). The popup shows the locked text with the new Server code,
//                          Copy and the re-run help (DESIGN 12.7) until OK, or until the server answers ready again
//   server/*               the server module's own keys (DESIGN 13.1); only daylight-server.js writes them
//
// Discovery and every server call run only with Lab on (DESIGN 4.3). A pairing change with another secret removes
// every lab/* key with the outbox (applyPairingChange); before it, a server that knows the old pairing is locked
// (lockBeforeRepair, 2.6), Lab on or off, and a typed Server address (the old server's) is forgotten, as on Unpair.
//
// A build made while its Lab wave is closed in lab-release-gate.json (the Safari build that ships inside the iPhone and
// Mac apps, LAB-PLAN 6.2; build.mjs) has `built` false: Lab is off and can't be turned on, nothing is written for it,
// the ledger isn't fed, and the popup shows no Lab switch, so the extension is its last non-Lab build.

import * as ds from './daylight-share.js';
import {
  LAB_TEXT, LabLedger, labHook, labGate, needsMessage, inboxLabText, featureName, serverHeadingShort,
  serverRowSubtitle, serverFeatureShort, labInboxSeenText, aiTodayText, setupConfirmText, serverMovedText,
  GATE_DEADLINE_MS, SERVER_FEATURES, SERVER_KEYS, USE_FEATURES, labUseOn, appendActivity, activityLine,
  diagnosticsReport, describeLabRow, checkedInText, fillText,
} from './daylight-lab.js';
import { MENU_ENTRIES, COMMANDS } from './lab-send.js';
import {
  DaylightServer, localMessage, stateFromStatus, showFingerprint, noticeText, parseSetupLink, RERUN_HELP,
  SERVER_API, SERVER_API_MIN, STATUS_REFRESH_MS,
} from './daylight-server.js';
import { originPattern } from './logic.js';

/** The one-time note (1.2) needs F01 or F04 in this build: this one (X1, Wave 1) has both. */
export const LAB_NOTE_ENABLED = true;

/** The extension's Wave 1 features (LAB-PLAN 3.1, Chrome and Safari), in What's in Lab's order (LAB_TEXT.featureOrder). */
const W1 = ['F01', 'F03', 'F04', 'F07', 'F10', 'F11', 'F16', 'F26', 'F33', 'F34'];

/**
 * What's in Lab (1.4), per browser: the Lab features this build has, then the server features (listed from W0 as
 * LAB-DECISIONS asks; Safari has only F37 of the four). Safari for iPhone has no right-click menu or shortcuts: F34's
 * row still lists them for the Mac, and Selection mode covers the iPhone (F11).
 */
export const LAB_FEATURES = {
  chrome: LAB_TEXT.featureOrder.filter((f) => W1.includes(f)),
  safari: LAB_TEXT.featureOrder.filter((f) => W1.includes(f)),
};
export const LAB_SERVER_FEATURES = { chrome: ['F02', 'F37', 'F19', 'F36'], safari: ['F37'] };
/** The Lab features this build runs (labGate's `built`). A server feature that is ready but not built is `later`. */
export const BUILT_FEATURES = [...W1];

/**
 * The Use switches this build shows (6.5 Q5; LAB-PROTOCOL 2.9.6): the USE_FEATURES the extension has. F03's switch
 * gates only the share sheet's "Only the link came through" line, which the extension never shows (it always reads
 * the page, and says so itself when it can't), so its row has none; F08 is Android's.
 */
export const EXT_USE_FEATURES = USE_FEATURES.filter((f) => ['F04', 'F10', 'F16', 'F33'].includes(f));

/** A feature's settings view in lab.html (3.4: a feature's own settings live inside it). */
export const FEATURE_VIEWS = { F04: 'f04', F10: 'f10', F34: 'f34', F26: 'setup' };

/** Lab's settings with a yes/no value (the Use switches and the menu boxes are maps of them). Off by default. */
export const LAB_OPTIONS = ['labClickSend', 'labAlwaysOptions', 'labReview'];
/**
 * F26's Site access on Safari: the sites Setup check looks for, and that its Allow asks Safari for (the check's
 * `origins`; Safari's own prompt then says how far).
 */
export const SAFARI_SITES = ['<all_urls>'];
const ACTIVITY_KEY = 'lab/activity';

/** The storage key of the re-pairing follow-up (2.6): {at}. Under lab/, so the next pairing change removes it. */
export const REPAIRED_KEY = 'lab/repaired';

/** The server states whose messages say to paste a new setup link: Set up with a link comes first then (2.6). */
const SETUP_FIRST = ['needs-server', 'pairing-mismatch', 'locked'];

/** The states that belong to the whole server, not to one feature: the What's in Lab heading's line. */
const SERVER_WIDE = ['needs-pairing', 'needs-server', 'pairing-mismatch', 'server-outdated', 'app-outdated', 'locked',
  'needs-site-access', 'OFFLINE', 'error'];

/** A Lab feature (F02, F37, F19, F36) or server key ('ai', 'files', …) that runs on the Daylight server (2.6). */
const isServerFeature = (f) => Object.hasOwn(SERVER_FEATURES, f) || Object.hasOwn(SERVER_KEYS, f);

/** The Lab switch as one value (1.2): a missing key means on. */
export const isLabOn = (settings) => settings?.lab !== false;

/** The one accessor of 1.2 for JS: the Lab switch from a storage adapter (with storage.onChanged for changes). */
export async function labOn(storage) {
  try { return isLabOn(await storage.get('settings')); } catch { return true; }
}

function withDeadline(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); })])
    .finally(() => clearTimeout(timer));
}

/**
 * api: the browser API; target: 'chrome' | 'safari'; storage: the protocol's storage adapter (storage.local);
 * run: core's settings and outbox lock; getPairing, getSettings, deviceName, appId: core's; refreshAcks: reads the ack
 * topic now (What's in Lab opening), or null; gateDeadlineMs: labGate's 5 s (tests shorten it); built: false in a build
 * whose Lab wave is still closed (LAB_BUILT, build.mjs): then Lab is off whatever is stored.
 */
export function createLab({
  api, target = 'chrome', storage, fetch: fetchFn, now = () => Date.now(), log = console, run, getPairing, getSettings,
  deviceName, appId = '', refreshAcks = null, gateDeadlineMs = GATE_DEADLINE_MS, built = true,
} = {}) {
  const platform = target === 'safari' ? 'safari' : 'chrome';
  const app = LAB_TEXT.appName[platform];
  const ledger = new LabLedger({ storage, now });
  const hook = labHook(ledger);
  /** The switch as this build reads it: a build without Lab has it off. */
  const on = (s) => built && isLabOn(s);
  let serverCache = null; // {key, server}
  let probing = null; // {key, force, promise}: one discovery at a time

  const settings = async () => (await getSettings()) ?? {};

  // --- the switch ---------------------------------------------------------------------------------------------------

  /** The first start of a build with Lab writes lab = true when the key is missing (1.2); a stored value stays. */
  async function ensureDefault() {
    if (!built) return;
    await run(async () => {
      const s = await settings();
      if (s.lab === undefined) await storage.set('settings', { ...s, lab: true });
    });
  }

  /** -> {lab} */
  async function setLab(want) {
    if (!built) return { lab: false };
    await run(async () => storage.set('settings', { ...(await settings()), lab: !!want }));
    return { lab: on(await settings()) };
  }

  // --- the Daylight server ------------------------------------------------------------------------------------------

  async function serverFor(pairing) {
    const key = `${pairing.code}|${pairing.relay}`;
    if (serverCache?.key !== key) {
      serverCache = { key, server: new DaylightServer({ pairing, storage, fetch: fetchFn, now, from: await deviceName(), app: appId }) };
    }
    return serverCache.server;
  }

  async function hasOrigin(origin) {
    const pattern = originPattern(origin);
    if (!pattern) return false;
    try { return !!(await api.permissions?.contains?.({ origins: [pattern] })); } catch { return false; }
  }

  /** needs-site-access with the origin to ask for (1.5: the Allow button, DESIGN 13.2). */
  const siteAccess = (origin) => ({
    state: 'needs-site-access', message: needsMessage('needs-site-access', { platform }), origins: [originPattern(origin)],
  });

  /**
   * The server as a whole: discovery (the pin, the move, the API level), this browser's host permission for it, then
   * GET /v1/status (cached 10 minutes). force: Lab settings opened (the section or What's in Lab), so the config topic
   * is read now whatever the cached config's age (DESIGN 4.3 rule 1) and the status is asked now: a server that moved
   * is asked about at once, not after the config's 6 hours. One relay poll at most, two when a server found from the
   * cached config fails (see below). -> {state, message, config?, status?, moved?, origins?}; state is 'ready' or a
   * state of SERVER_WIDE.
   */
  async function probeNow(pairing, force) {
    const server = await serverFor(pairing);
    let d;
    try { d = await server.discover({ force }); } catch (e) { return server.noteError('', e); }
    if (!d) {
      let pin = null;
      try { pin = await storage.get('server/pin'); } catch { /* none */ }
      const state = pin && pin.fingerprint !== (await server.values()).fingerprint ? 'pairing-mismatch' : 'needs-server';
      return { state, message: localMessage(state) };
    }
    const { config } = d;
    if (!(await hasOrigin(config.server))) return { ...siteAccess(config.server), config, moved: d.moved };
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
      // after a server that is gone or failing (OFFLINE, SERVER_ERROR), discover({force: true}). A forced check read
      // the topic already.
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
    if (!pairing) return { state: 'needs-pairing', message: needsMessage('needs-pairing', { platform }) };
    const key = `${pairing.code}|${pairing.relay}`;
    if (!probing || probing.key !== key || (force && !probing.force)) {
      const p = { key, force, promise: null };
      p.promise = probeNow(pairing, force).catch((e) => ({ state: 'error', message: e?.message ?? null })).then(async (r) => {
        try {
          await storage.set('lab/server', { state: r.state, at: now() });
          // The new pairing's server answers: the re-pairing follow-up has done its job.
          if (r.state === 'ready') await storage.remove(REPAIRED_KEY);
        } catch { /* shown anyway */ }
        return r;
      }).finally(() => { if (probing === p) probing = null; });
      probing = p;
    }
    return probing.promise;
  }

  /** A probe within the gate's 5 s (2.6): a server that has not answered by then is OFFLINE. */
  const probeInTime = (opts) => withDeadline(probe(opts), gateDeadlineMs, () => ({ state: 'OFFLINE', message: localMessage('OFFLINE') }));

  /** A feature's server state from a probe (2.6): the server's state for a whole-server answer, else the feature's. */
  function featureState(p, key) {
    if (p.state !== 'ready') return { state: p.state, message: p.message ?? localMessage(p.state), origins: p.origins };
    return stateFromStatus(p.status, key);
  }

  /**
   * The typed server's origin, or the pinned one when it belongs to this pairing (an earlier pairing's pin is
   * pairing-mismatch, which discovery says), read from the module's keys without asking anyone (the gate's local check).
   */
  async function knownOrigin(pairing) {
    try {
      const manual = await storage.get('server/manualUrl');
      if (manual) return manual;
      const pin = await storage.get('server/pin');
      if (!pin?.origin) return null;
      return pin.fingerprint === (await (await serverFor(pairing)).values()).fingerprint ? pin.origin : null;
    } catch { return null; }
  }

  /**
   * The gate (1.5, 2.7.2) as this browser runs it. -> labGate's {ready, state, message, short, button}, plus
   * `origins` for needs-site-access (the page asks for them: the first server tap, then Allow) and `serverCode` for
   * needs-server (Copy Server code). probeResult: an answer to reuse (What's in Lab's states), else the server is asked.
   */
  async function gate(feature, { probeResult = null } = {}) {
    const s = await settings();
    const pairing = await getPairing();
    let origins = null;
    const server = {
      state: async (key) => {
        const r = featureState(probeResult ?? (await probe()), key);
        origins = r.origins ?? null;
        return r;
      },
    };
    const r = await labGate(feature, {
      lab: on(s), paired: !!pairing, app, platform,
      hasCap: (token) => ledger.hasCap(token),
      local: async (f) => {
        // Site access comes before the server (step 4): the server's origin is known once it was found or typed.
        if (!isServerFeature(f) || !pairing) return null;
        const origin = await knownOrigin(pairing);
        if (origin && !(await hasOrigin(origin))) { origins = [originPattern(origin)]; return 'needs-site-access'; }
        return null;
      },
      server, serverMessage: localMessage, deadlineMs: gateDeadlineMs,
      built: (f) => BUILT_FEATURES.includes(f),
    });
    const out = { ...r };
    if (r.state === 'needs-site-access') out.origins = origins;
    if (r.state === 'needs-server' && pairing) {
      try { out.serverCode = await (await serverFor(pairing)).serverCode(); } catch { /* the button copies nothing */ }
    }
    return out;
  }

  // --- what the screens show ----------------------------------------------------------------------------------------

  /** The popup's settings: the switch and the "Daylight server ›" row's subtitle (1.1). -> {lab, noteEnabled, ...} */
  async function state({ refresh = true } = {}) {
    const s = await settings();
    const lab = on(s);
    const out = { lab, labNoteShown: !!s.labNoteShown, noteEnabled: LAB_NOTE_ENABLED, serverState: null, serverSubtitle: null };
    if (!lab) return out;
    let last = null;
    try { last = await storage.get('lab/server'); } catch { /* none */ }
    let st = last?.state ?? null;
    if (!(await getPairing())) st = 'needs-pairing';
    else if (refresh && (!last || now() - last.at > STATUS_REFRESH_MS)) st = (await probeInTime()).state;
    out.serverState = st;
    out.serverSubtitle = st ? serverRowSubtitle(st) : null;
    return out;
  }

  /** A row of What's in Lab; a feature with a Use switch (EXT_USE_FEATURES) carries its state: use {on}. */
  const rowOf = (s) => (id, short) => {
    const r = { id, name: featureName(id), sentence: LAB_TEXT.features[id].sentence, short };
    if (EXT_USE_FEATURES.includes(id)) r.use = { on: labUseOn(s, id) };
    if (FEATURE_VIEWS[id]) r.view = FEATURE_VIEWS[id];
    return r;
  };

  /**
   * The server's last answer as a probe result, read from storage without asking anyone (1.5: What's in Lab uses
   * cached states): lab/server when it is 10 minutes old or less, with the module's cached status for a ready server.
   * A pairing change removes lab/server, so it is always this pairing's. -> a probe result, or null (nothing recent).
   */
  async function cachedProbe() {
    let last = null, status = null;
    try { last = await storage.get('lab/server'); } catch { return null; }
    if (!last?.state || !(now() - (last.at ?? 0) <= STATUS_REFRESH_MS)) return null;
    if (last.state !== 'ready') return SERVER_WIDE.includes(last.state) ? { state: last.state, message: localMessage(last.state) } : null;
    try { status = await storage.get('server/status'); } catch { /* none */ }
    return status && typeof status === 'object' ? { state: 'ready', message: null, status } : null;
  }

  /**
   * What's in Lab (1.4): the Inbox's Lab state, the features with their short states, then the server group.
   * refresh: it opened, so read the ack topic (the header is then current) and ask the server now, both at once and
   * each within the gate's 5 s. Without refresh nothing goes on the network: the cached states (cachedProbe; `cached`
   * true), or, with nothing recent, no short states yet (null; `fresh` false).
   * -> {lab, header, fresh, cached, features: [{id, name, sentence, short}], server: {state, short, features: [...]}}
   */
  async function overview({ refresh = true } = {}) {
    const s = await settings();
    if (!on(s)) return { lab: false };
    const row = rowOf(s);
    const pairing = await getPairing();
    const acks = pairing && refresh && refreshAcks ? withDeadline(refreshAcks().catch(() => {}), gateDeadlineMs, () => {}) : null;
    const asked = pairing && refresh ? probeInTime({ force: true }) : null;
    await acks;
    const snap = await ledger.snapshot();
    const header = inboxLabText({ inboxLab: snap.inboxLab, checkedIn: snap.checkedIn }, now());
    let p = null;
    if (!pairing) p = { state: 'needs-pairing' };
    else if (asked) p = await asked;
    else p = await cachedProbe();
    // The features that don't run on the server get their short state here and now, server answer or not (W1).
    const features = [];
    for (const id of LAB_FEATURES[platform]) {
      features.push(row(id, (await gate(id, { probeResult: p ?? { state: 'ready' } })).short ?? LAB_TEXT.ready));
    }
    if (!p) {
      return {
        lab: true, header, fresh: false, cached: false, features,
        server: { state: null, short: null, features: LAB_SERVER_FEATURES[platform].map((id) => row(id, null)) },
      };
    }
    const heading = SERVER_WIDE.includes(p.state) ? p.state : 'ready';
    const serverRows = [];
    for (const id of LAB_SERVER_FEATURES[platform]) {
      const g = await gate(id, { probeResult: p });
      serverRows.push(row(id, serverFeatureShort(g.state, heading)));
    }
    return {
      lab: true, header, fresh: true, cached: !!pairing && !asked, features,
      server: { state: heading, short: serverHeadingShort(heading), features: serverRows },
    };
  }

  /**
   * The server's new address, when discovery found this pairing's server at another origin than the pinned one and
   * the user hasn't said yes yet (2.6: server/pendingMove, which the module keeps). Read from storage, so the question
   * stays when the probe ran out of time; only while the cached config still names that origin and no Server address
   * is typed (it wins over discovery). -> the origin, or null
   */
  async function pendingMove(server) {
    try {
      const [move, pin, config, manual] = await Promise.all(
        ['server/pendingMove', 'server/pin', 'server/config', 'server/manualUrl'].map((k) => storage.get(k)));
      const { fingerprint } = await server.values();
      if (manual || !move?.origin || move.fingerprint !== fingerprint) return null;
      if (pin?.fingerprint !== fingerprint || pin.origin === move.origin) return null;
      return config?.server === move.origin && config.fingerprint === fingerprint ? move.origin : null;
    } catch { return null; }
  }

  /**
   * The Daylight server section (2.6): where setup happens, so it carries the long texts.
   * -> {lab, paired, state, message, button, origins, host (the server's origin, '' while none is found), fingerprint,
   *     delivery ('lab' | 'v1' | null), v1Notice, moved, movedOrigins, serverCode, labInbox, aiToday, manualUrl,
   *     setupFirst, rerun}
   * moved: "Your Daylight server moved to {host}. Use it?" while the server moved (2.6), with movedOrigins, the host
   * permission the page asks for on Use it; else null.
   */
  async function serverView() {
    const s = await settings();
    if (!on(s)) return { lab: false };
    const pairing = await getPairing();
    if (!pairing) {
      return { lab: true, paired: false, state: 'needs-pairing', message: needsMessage('needs-pairing', { platform }), rerun: RERUN_HELP };
    }
    const server = await serverFor(pairing);
    const p = await probeInTime({ force: true });
    const config = p.config ?? null;
    const status = p.status ?? null;
    let manualUrl = '', badAuth = false;
    try {
      manualUrl = (await storage.get('server/manualUrl')) ?? '';
      badAuth = !!(await storage.get('server/badAuthAt'));
    } catch { /* none */ }
    const movedTo = p.moved ?? (await pendingMove(server));
    return {
      lab: true, paired: true, state: p.state,
      message: p.state === 'ready' ? LAB_TEXT.ready : (p.message ?? localMessage(p.state)),
      // The section has its own Copy for the Server code; only site access gets the state's button here (Allow).
      button: p.state === 'needs-site-access' ? LAB_TEXT.buttons[p.state] : null, origins: p.origins ?? null,
      // The server's origin: the section's "Your server" line is hostLineText(host, fingerprint) (2.6), which keeps a
      // port, as serverMovedText does.
      host: config?.server ?? '',
      fingerprint: showFingerprint((await server.values()).fingerprint),
      delivery: config?.delivery ?? null,
      v1Notice: config?.delivery === 'v1' ? noticeText('v1') : null,
      moved: movedTo ? serverMovedText(movedTo) : null,
      movedOrigins: movedTo ? [originPattern(movedTo)] : null,
      serverCode: await server.serverCode(),
      labInbox: status ? labInboxSeenText(status.inbox?.lastSeen ?? null, now()) : null,
      aiToday: status?.usage?.ai ? aiTodayText(status.usage.ai.usd, status.usage.ai.limitUsd) : null,
      manualUrl,
      // Set up with a link (2.6): first while the state's message says to paste a new setup link (BAD_AUTH's too).
      setupFirst: SETUP_FIRST.includes(p.state) || (p.state === 'error' && badAuth),
      rerun: RERUN_HELP,
    };
  }

  /**
   * "Your Daylight server moved to {host}. Use it?" answered Use it (2.6): the module's confirmMove pins the new origin
   * (the page asked for its host permission first). -> {moved: true when it moved}
   */
  async function confirmMove() {
    const pairing = await getPairing();
    if (!pairing || !on(await settings())) return { moved: false };
    const server = await serverFor(pairing);
    probing = null;
    try { return { moved: await server.confirmMove() }; } catch { return { moved: false }; } finally { probing = null; }
  }

  /**
   * Set up with a link (2.6 "Setup link", DESIGN 3.5), step 2: the link is read here, and nothing is sent.
   * -> {server, confirm, origins} (the confirmation's text, and the host permission the page asks for on Use it)
   *  | {error} (the module's message for its reason)
   */
  async function checkSetupLink(link) {
    if (!(await getPairing())) return { error: needsMessage('needs-pairing', { platform }) };
    if (!on(await settings())) return { error: LAB_TEXT.labOff.replace('{app}', app) };
    try {
      const { server } = await parseSetupLink(link);
      return { server, confirm: setupConfirmText(server), origins: [originPattern(server)] };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  }

  /**
   * Step 4, once the user said Use it (and the page asked for the server's host permission):
   * DaylightServer.setup(link) sends this pairing's Server code with the link's one-time token, then pins the server.
   * -> {done} (LAB_TEXT's done line) | {error, state?, origins?} (the module's messages; needs-site-access when the
   * browser refused the server's site)
   */
  async function setupServer(link) {
    const checked = await checkSetupLink(link);
    if (checked.error) return checked;
    if (!(await hasOrigin(checked.server))) {
      const r = siteAccess(checked.server);
      return { error: r.message, state: r.state, origins: r.origins };
    }
    const server = await serverFor(await getPairing());
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

  /**
   * The Server address field (2.6): a typed origin, checked with GET /v1/hello and /v1/status; empty clears it.
   * The page asks for the host permission first. -> {manualUrl} | {error}
   */
  async function setServerAddress(url) {
    const pairing = await getPairing();
    if (!pairing) return { error: needsMessage('needs-pairing', { platform }) };
    if (!on(await settings())) return { error: LAB_TEXT.labOff.replace('{app}', app) };
    const server = await serverFor(pairing);
    probing = null;
    try {
      if (!String(url ?? '').trim()) { await server.clearManualUrl(); return { manualUrl: '' }; }
      return { manualUrl: await server.setManualUrl(url) };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  }

  // --- pairing and housekeeping -------------------------------------------------------------------------------------

  /**
   * Before a pairing with another secret replaces `current` (2.6 Re-pairing): a server that knows the old pairing is
   * locked, Lab on or off, when a pin exists (or a typed Server address). The typed address is then forgotten: it is
   * the old server's, which the next deploy replaces (DESIGN 12.7), and it would hide the new one from discovery.
   * Never throws; gives up on the lock after `ms`. -> {known: a server was known, locked: the lock request succeeded}
   */
  async function beforeRepair(current, next, ms = 10000) {
    if (!current || !next || ds.samePairingSecret(current, next)) return { known: false, locked: false };
    let pin = null, manual = null;
    try { pin = await storage.get('server/pin'); manual = await storage.get('server/manualUrl'); } catch { /* none */ }
    if (!pin && !manual) return { known: false, locked: false };
    const server = new DaylightServer({ pairing: current, storage, fetch: fetchFn, now, from: await deviceName(), app: appId });
    serverCache = null;
    probing = null;
    const locked = await withDeadline(server.lockBeforeRepair().catch(() => false), ms, () => false);
    if (manual) { try { await server.clearManualUrl(); } catch { /* kept: the section can clear it */ } }
    return { known: true, locked };
  }

  /**
   * Before Unpair removes `current`: a typed Server address is forgotten, as a re-pairing forgets it (beforeRepair).
   * It is this pairing's server, and the next pairing may be another Daylight's: kept, it would hide that one's
   * server from discovery and answer BAD_AUTH instead of pairing-mismatch. The pin stays (it tells pairing-mismatch),
   * and nothing is locked: unpairing is not re-pairing, and the same Daylight may come back. Never throws.
   */
  async function beforeUnpair(current) {
    if (!current?.secret) return;
    let manual = null;
    try { manual = await storage.get('server/manualUrl'); } catch { /* none */ }
    serverCache = null;
    probing = null;
    if (!manual) return;
    try {
      await new DaylightServer({ pairing: current, storage, fetch: fetchFn, now, from: '', app: appId }).clearManualUrl();
    } catch (e) { log.warn?.('Send to Daylight: the typed Server address was kept', e); }
  }

  /**
   * After that pairing change (applyPairingChange removed the lab/* keys): the popup's follow-up (DESIGN 12.7), shown
   * while Lab is on, whether the lock reached the server or not (DESIGN 3.4).
   */
  async function afterRepair() {
    try { await storage.set(REPAIRED_KEY, { at: now() }); } catch (e) { log.warn?.('Send to Daylight: re-pairing note not kept', e); }
  }

  /**
   * The re-pairing follow-up (2.6, DESIGN 12.7) for the popup, while Lab is on and until OK or a ready server:
   * -> {lab, repaired: null | {state: 'locked', message, serverCode, rerun}}. Nothing goes on the network.
   */
  async function repaired() {
    if (!on(await settings())) return { lab: false, repaired: null };
    const pairing = await getPairing();
    let mark = null, last = null;
    try { mark = await storage.get(REPAIRED_KEY); last = await storage.get('lab/server'); } catch { /* none */ }
    if (!pairing || !mark) return { lab: true, repaired: null };
    if (last?.state === 'ready' && last.at >= mark.at) {
      try { await storage.remove(REPAIRED_KEY); } catch { /* shown again next time */ }
      return { lab: true, repaired: null };
    }
    return {
      lab: true,
      repaired: { state: 'locked', message: localMessage('locked'), serverCode: await (await serverFor(pairing)).serverCode(), rerun: RERUN_HELP },
    };
  }

  /** Keeps the ledger's states for ids still in the outbox or the hosted outbox (2.2.6). */
  async function prune() {
    if (!built) return; // no ledger to keep
    try {
      const ids = [...((await storage.get('outbox')) ?? []), ...((await storage.get('server/hosted')) ?? [])].map((r) => r?.id).filter(Boolean);
      await ledger.prune(ids);
    } catch (e) { log.warn?.('Send to Daylight: Lab ledger prune failed', e); }
  }

  // --- Wave 1: the settings of Lab's features, the timeline's data, Setup check and the activity log -----------------

  /** Writes settings under core's lock (every settings write is), with Lab on. -> the new settings */
  async function patchSettings(fn) {
    let out = null;
    await run(async () => {
      const s = await settings();
      out = fn({ ...s }) ?? s;
      await storage.set('settings', out);
    });
    return out;
  }

  /** A feature's Use switch (6.5 Q5): settings.labUse[feature]; a missing key is on. -> {feature, on} */
  async function setUse(feature, want) {
    if (!built || !EXT_USE_FEATURES.includes(feature)) return { feature, on: false };
    const s = await patchSettings((x) => ({ ...x, labUse: { ...(x.labUse ?? {}), [feature]: !!want } }));
    return { feature, on: labUseOn(s, feature) };
  }

  /**
   * A feature's own setting (3.4): labClickSend and labAlwaysOptions (F04), labReview (F10), or labMenus.<entry>
   * (F34's "Show in the right-click menu", shown unless false). -> the feature's settings (featureSettings)
   */
  async function setOption(key, value) {
    if (!built) return featureSettings({});
    const k = String(key ?? '');
    const entry = k.startsWith('labMenus.') ? k.slice(9) : null;
    if (!LAB_OPTIONS.includes(k) && !MENU_ENTRIES.includes(entry)) throw new ds.ShareError('setting', `unknown Lab setting ${k}`);
    const s = await patchSettings((x) => (entry
      ? { ...x, labMenus: { ...(x.labMenus ?? {}), [entry]: !!value } }
      : { ...x, [k]: !!value }));
    return featureSettings(s);
  }

  /** The Lab features' own settings as the screens show them. */
  function featureSettings(s) {
    return {
      clickSend: !!s.labClickSend, alwaysOptions: !!s.labAlwaysOptions, review: !!s.labReview,
      menus: Object.fromEntries(MENU_ENTRIES.map((e) => [e, s.labMenus?.[e] !== false])),
    };
  }

  /** F34's view: the menu boxes and the shortcuts as the browser lists them (commands.getAll). */
  async function featureView() {
    const s = await settings();
    let commands = [];
    try {
      const all = (await api.commands?.getAll?.()) ?? [];
      const order = [COMMANDS.page, COMMANDS.selection, COMMANDS.clean, COMMANDS.link];
      commands = order.map((name) => all.find((c) => c.name === name)).filter(Boolean)
        .map((c) => ({ name: c.name, description: c.description ?? '', shortcut: c.shortcut ?? '' }));
    } catch { /* none */ }
    return { lab: on(s), ...featureSettings(s), commands, shortcutsPage: platform === 'chrome' };
  }

  /** The ledger's view for F01's rows and check-in header (2.5): {inboxLab, caps, states, checkedIn, checkedInText}. */
  async function timeline() {
    const snap = await ledger.snapshot();
    return { inboxLab: snap.inboxLab, caps: snap.caps, states: snap.states, checkedIn: snap.checkedIn, checkedInText: checkedInText(snap.checkedIn, now()) };
  }

  /**
   * What the popup needs from Lab when it opens: the switch, the one-time note (1.2), the Use switches, F04's and F10's
   * settings, and the timeline. -> {lab, ...} ({lab: false} with Lab off)
   */
  async function popup() {
    const s = await settings();
    if (!on(s)) return { lab: false };
    return {
      lab: true, noteEnabled: LAB_NOTE_ENABLED, labNoteShown: !!s.labNoteShown, excerptNoteShown: !!s.labExcerptNoteShown,
      use: Object.fromEntries(EXT_USE_FEATURES.map((f) => [f, labUseOn(s, f)])), comfort: !!s.comfort,
      ...featureSettings(s), paired: !!(await getPairing()), timeline: await timeline(),
    };
  }

  /** Marks a once-only line as seen: the one-time note (labNoteShown) or the excerpt line (labExcerptNoteShown). */
  async function seen(key) {
    if (!['labNoteShown', 'labExcerptNoteShown'].includes(key)) return {};
    await patchSettings((x) => ({ ...x, [key]: true }));
    return {};
  }

  let logChain = Promise.resolve();
  /** F26's activity log (lab/activity, the last 200 events; no title, URL or name ever goes in), with Lab on. */
  function logEvent(event) {
    const p = logChain.then(async () => {
      if (!on(await settings())) return;
      const log = (await storage.get(ACTIVITY_KEY)) ?? [];
      await storage.set(ACTIVITY_KEY, appendActivity(log, { time: now(), ...event }));
    }).catch((e) => log?.warn?.('Send to Daylight: activity not logged', e));
    logChain = p;
    return p;
  }

  /** -> {lines}: the activity log, oldest first (activityLine). */
  async function activity() {
    const log = (await storage.get(ACTIVITY_KEY)) ?? [];
    return { lines: log.map(activityLine) };
  }

  /** F26's Copy diagnostics: diagnosticsReport, redacted. -> {text} */
  async function diagnostics() {
    const s = await settings();
    const pairing = await getPairing();
    const snap = await ledger.snapshot();
    const version = String(appId).split('/')[1] ?? '';
    const text = diagnosticsReport({
      app: app, version, platform, lab: on(s), caps: snap.caps, checkedIn: snap.checkedIn,
      rows: (await storage.get('outbox')) ?? [], relay: pairing?.relay ?? ds.DEFAULT_RELAY,
      log: (await storage.get(ACTIVITY_KEY)) ?? [], now: now(),
    });
    return { text };
  }

  /**
   * F26's Setup check (Chrome, Safari): the pairing; the toolbar button (Chrome: action.getUserSettings's isOnToolbar);
   * the keyboard shortcut (commands.getAll; Chrome, which can set one); site access (Safari only: permissions.contains,
   * since Safari asks on each site until it may read pages; Chrome needs only the tab the user chose, activeTab, and
   * asks one site at a time where a PDF or the Daylight server needs more, so it has nothing to report here); then the
   * test article along its way. Each check: {id, name, ok, line ("✓ …" or "! …"), button, action, steps}. Chrome can't
   * open the place where the toolbar button is pinned, so that unmet line's button is Show steps (action "steps"), which
   * shows LAB_TEXT.setup.steps.toolbarButton under it (F26.3; LAB-PLAN 1.6, "Copy added Oct 22").
   * -> {lab, checks, test: null | {id, label, delivered, reader, lines}}
   */
  async function checks() {
    const s = await settings();
    if (!on(s)) return { lab: false };
    const C = LAB_TEXT.setup.checks;
    const out = [];
    const add = (id, name, ok, button = null, action = null, steps = null) => out.push({
      id, name, ok, line: fillText(ok ? LAB_TEXT.setup.ok : LAB_TEXT.setup.notOk, { check: name }),
      button: ok ? null : button, action: ok ? null : action, steps: ok ? null : steps,
    });
    const pairing = await getPairing();
    add('paired', C.paired, !!pairing, LAB_TEXT.buttons['needs-quick-sends'], 'pair');
    if (platform === 'chrome' && typeof api.action?.getUserSettings === 'function') {
      let pinned = null;
      try { pinned = !!(await api.action.getUserSettings())?.isOnToolbar; } catch { pinned = null; /* not told */ }
      if (pinned !== null) add('toolbarButton', C.toolbarButton, pinned, LAB_TEXT.setup.showSteps, 'steps', LAB_TEXT.setup.steps.toolbarButton);
    }
    if (platform === 'chrome' && api.commands?.getAll) {
      let key = '';
      try { key = (await api.commands.getAll()).find((c) => c.name === COMMANDS.page)?.shortcut ?? ''; } catch { key = ''; }
      add('shortcut', C.shortcut, !!key, LAB_TEXT.buttons['needs-quick-sends'], 'shortcuts');
    }
    if (platform === 'safari') {
      let sites = false;
      try { sites = !!(await api.permissions?.contains?.({ origins: SAFARI_SITES })); } catch { sites = false; }
      add('siteAccess', C.siteAccess, sites, LAB_TEXT.buttons['needs-site-access'], 'sites');
      if (!sites) out.at(-1).origins = SAFARI_SITES;
    }
    return { lab: true, checks: out, test: await testProgress() };
  }

  /** The test article along the timeline (F26): its row's Lab label, and whether it was delivered and is in the Reader. */
  async function testProgress() {
    let id = null;
    try { id = await storage.get('lab/testId'); } catch { id = null; }
    const row = id ? ((await storage.get('outbox')) ?? []).find((r) => r.id === id) : null;
    if (!row) return null;
    const snap = await ledger.snapshot();
    const st = snap.states[row.id] ?? null;
    const d = describeLabRow(row, now(), { lab: true, inboxLab: snap.inboxLab, hasCap: snap.caps, state: st });
    const delivered = row.status === 'delivered';
    const reader = delivered && st?.s === 'reader';
    const L = LAB_TEXT.setup;
    const line = (ok, name) => (ok ? fillText(L.ok, { check: name }) : name);
    return { id: row.id, label: d.label, delivered, reader, lines: [line(delivered, L.delivered), line(reader, L.inReader)] };
  }

  /** The Lab messages of runtime.onMessage (core.js passes them on). */
  async function onMessage(msg) {
    switch (msg?.type) {
      case 'labState': return state({ refresh: msg.refresh !== false });
      case 'setLab': return setLab(msg.lab);
      case 'labOverview': return overview({ refresh: msg.refresh !== false });
      case 'labGate': return gate(String(msg.feature ?? ''));
      case 'labServer': return serverView();
      case 'labServerAddress': return setServerAddress(msg.url);
      case 'labConfirmMove': return confirmMove();
      case 'labSetupCheck': return checkSetupLink(String(msg.link ?? ''));
      case 'labSetup': return setupServer(String(msg.link ?? ''));
      case 'labRepaired': return repaired();
      case 'labRepairSeen': await storage.remove(REPAIRED_KEY); return {};
      // Wave 1
      case 'labPopup': return popup();
      case 'labTimeline': return timeline();
      case 'labSeen': return seen(String(msg.key ?? ''));
      case 'labSetUse': return setUse(String(msg.feature ?? ''), msg.on);
      case 'labSetOption': return setOption(msg.key, msg.value);
      case 'labFeatureView': return featureView();
      case 'labChecks': return checks();
      case 'labActivity': return activity();
      case 'labDiagnostics': return diagnostics();
      default: return undefined;
    }
  }

  return {
    ledger, hook, built, ensureDefault, setLab, labOn: async () => built && labOn(storage), state, overview, gate, serverView,
    setServerAddress, confirmMove, checkSetupLink, setupServer, beforeRepair, beforeUnpair, afterRepair, repaired, prune,
    probe, onMessage,
    // Wave 1
    setUse, setOption, featureView, timeline, popup, logEvent, activity, diagnostics, checks,
  };
}
