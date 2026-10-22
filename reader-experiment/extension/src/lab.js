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
  GATE_DEADLINE_MS, SERVER_FEATURES, SERVER_KEYS,
} from './daylight-lab.js';
import {
  DaylightServer, localMessage, stateFromStatus, showFingerprint, noticeText, parseSetupLink, RERUN_HELP,
  SERVER_API, SERVER_API_MIN, STATUS_REFRESH_MS,
} from './daylight-server.js';
import { originPattern } from './logic.js';

/** The one-time note (1.2) needs F01 or F04 in this build: from X1 (W1) on. W0 shows none. */
export const LAB_NOTE_ENABLED = false;

/**
 * What's in Lab (1.4), per browser: the Lab features this build has, then the server features (listed from W0 as
 * LAB-DECISIONS asks; Safari has only F37 of the four). W1 (X1) adds F01, F03, F04, F07, F10, F11, F16, F26, F33 and F34.
 */
export const LAB_FEATURES = { chrome: [], safari: [] };
export const LAB_SERVER_FEATURES = { chrome: ['F02', 'F37', 'F19', 'F36'], safari: ['F37'] };
/** The Lab features this build runs (labGate's `built`). A server feature that is ready but not built is `later`. */
export const BUILT_FEATURES = [];

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

  const row = (id, short) => ({ id, name: featureName(id), sentence: LAB_TEXT.features[id].sentence, short });

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
    if (!p) {
      return {
        lab: true, header, fresh: false, cached: false,
        features: LAB_FEATURES[platform].map((id) => row(id, null)),
        server: { state: null, short: null, features: LAB_SERVER_FEATURES[platform].map((id) => row(id, null)) },
      };
    }
    const heading = SERVER_WIDE.includes(p.state) ? p.state : 'ready';
    const features = [];
    for (const id of LAB_FEATURES[platform]) features.push(row(id, (await gate(id, { probeResult: p })).short ?? LAB_TEXT.ready));
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
      default: return undefined;
    }
  }

  return {
    ledger, hook, built, ensureDefault, setLab, labOn: async () => built && labOn(storage), state, overview, gate, serverView,
    setServerAddress, confirmMove, checkSetupLink, setupServer, beforeRepair, beforeUnpair, afterRepair, repaired, prune,
    probe, onMessage,
  };
}
