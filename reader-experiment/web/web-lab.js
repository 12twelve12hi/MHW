// Lab in the web sender (LAB-PLAN 1, 2.2.6 and 2.6; card B0, Wave 0): the Lab switch, the sender ledger, the gates and
// the Daylight server, as data for the page (web-lab-page.js draws it). No DOM here, so node tests run it as it is.
// It follows the extension's src/lab.js, without what only an extension has: the page calls the Daylight server itself
// (the server answers any origin, server DESIGN 10.2), so there is no site access to ask for.
//
//   settings.lab           the Lab switch: missing means on, and the first start writes true (1.2); never synced and
//                          never in a pairing link, so pairing, unpairing and renaming leave it as it is
//   settings.labNoteShown  the one-time note (1.2), shown only from a build with the timeline or share in place:
//                          LAB_NOTE_ENABLED, false in Wave 0
//   lab/inbox, lab/heard, lab/states   the ledger (daylight-lab.js LabLedger), fed by every ack-topic frame that
//                          decrypts, Lab on or off, through the Sender's onAckHeader
//   lab/server             the last server answer {state, at}, for the "Daylight server ›" row's subtitle and What's
//                          in Lab's cached states (with the module's server/status, while 10 minutes old or less)
//   lab/repaired           {at}: this browser re-paired with another Daylight while it knew a Daylight server, which it
//                          locked first (2.6, DESIGN 3.4); the send view shows the locked text with the new Server code,
//                          Copy and the re-run help (DESIGN 12.7) until OK, or until the server answers ready again
//   server/*               the server module's own keys (DESIGN 13.1); only daylight-server.js writes them
//
// Discovery and every server call run only with Lab on (DESIGN 4.3). A pairing change with another secret removes every
// lab/* key with the outbox (applyPairingChange); before it, a server that knows the old pairing is locked
// (lockBeforeRepair, 2.6), Lab on or off, and a typed Server address (the old server's) is forgotten, as on Unpair.

import * as ds from './daylight-share.js';
import {
  LAB_TEXT, LabLedger, labHook, labGate, needsMessage, inboxLabText, featureName, serverHeadingShort,
  serverRowSubtitle, serverFeatureShort, labInboxSeenText, aiTodayText, setupConfirmText, serverMovedText,
  GATE_DEADLINE_MS,
} from './daylight-lab.js';
import {
  DaylightServer, localMessage, stateFromStatus, showFingerprint, noticeText, parseSetupLink, RERUN_HELP,
  SERVER_API, SERVER_API_MIN, STATUS_REFRESH_MS,
} from './daylight-server.js';
import { hostOf } from './logic.js';

/** needsMessage's platform and LAB_TEXT.appName's key (1.6: {app} is "Send to Daylight"). */
export const PLATFORM = 'web';

/** The one-time note (1.2) waits for a build with the timeline or share in place: none in Wave 0. */
export const LAB_NOTE_ENABLED = false;

/**
 * What's in Lab (1.4) for the web sender: the Lab features this build has (none in Wave 0; B1 adds the web's Wave 1
 * features), then the four server features, listed from Wave 0 as LAB-DECISIONS asks.
 */
export const LAB_FEATURES = [];
export const LAB_SERVER_FEATURES = ['F02', 'F37', 'F19', 'F36'];
/** The Lab features this build runs (labGate's `built`): a server feature that is ready but not built is `later`. */
export const BUILT_FEATURES = [];

export const SERVER_KEY = 'lab/server';
/** The re-pairing follow-up (2.6): {at}. Under lab/, so the next pairing change removes it. */
export const REPAIRED_KEY = 'lab/repaired';

/** The server states whose messages say to paste a new setup link: Set up with a link comes first then (2.6). */
const SETUP_FIRST = ['needs-server', 'pairing-mismatch', 'locked'];

/** The states that belong to the whole server, not to one feature: the What's in Lab heading's line. */
const SERVER_WIDE = ['needs-pairing', 'needs-server', 'pairing-mismatch', 'server-outdated', 'app-outdated', 'locked',
  'OFFLINE', 'error'];

/** The Lab switch as one value (1.2): a missing key means on. */
export const isLabOn = (settings) => settings?.lab !== false;

/** The one accessor of 1.2 for JS: the Lab switch from the page's storage adapter. */
export async function labOn(storage) {
  try { return isLabOn(await storage.get('settings')); } catch { return true; }
}

/**
 * The test hook (1.7): ?lab=0 or ?lab=1 sets the switch, honoured only when the page is served from 127.0.0.1 (the
 * tests' server and `node build.mjs --serve`). loc: {hostname, search}. -> true | false | null (no hook).
 */
export function labTestHook(loc) {
  if (loc?.hostname !== '127.0.0.1') return null;
  const v = new URLSearchParams(String(loc.search ?? '')).get('lab');
  return v === '1' ? true : v === '0' ? false : null;
}

/** The page address without its ?lab= (the hook applies once; a reload doesn't undo a later tap on the switch). */
export function withoutLabParam(href) {
  const u = new URL(href);
  u.searchParams.delete('lab');
  return `${u.pathname}${u.search}${u.hash}`;
}

function withDeadline(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); })])
    .finally(() => clearTimeout(timer));
}

/**
 * storage: the page's storage adapter (web-storage.js); fetch: the page's; run: serialises settings writes;
 * getPairing, getSettings, deviceName, appId: the page's; refreshAcks: reads the ack topic now (What's in Lab opening),
 * or null; gateDeadlineMs: labGate's 5 s (tests shorten it).
 */
export function createWebLab({
  storage, fetch: fetchFn, now = () => Date.now(), log = console, run = (fn) => fn(), getPairing, getSettings,
  deviceName = async () => '', appId = '', refreshAcks = null, gateDeadlineMs = GATE_DEADLINE_MS,
} = {}) {
  const app = LAB_TEXT.appName[PLATFORM];
  const ledger = new LabLedger({ storage, now });
  const hook = labHook(ledger);
  let serverCache = null; // {key, server}
  let probing = null; // {key, force, era, promise}: one discovery at a time
  // Bumped by every change of the pairing or the server (re-pairing, Unpair, Use it, setup, a typed address): a server
  // answer asked before it is the old one's, so it is not kept (lab/server, the re-pairing follow-up).
  let era = 0;
  /** A new pairing or server from now on: the check in flight is no longer this one's, and none is shared. */
  const forget = () => { era++; probing = null; };
  const keyOf = (pairing) => (pairing ? `${pairing.code}|${pairing.relay}` : null);

  const settings = async () => { try { return (await getSettings()) ?? {}; } catch { return {}; } };
  const pairingNow = async () => { try { return await getPairing(); } catch { return null; } };

  // --- the switch ---------------------------------------------------------------------------------------------------

  /** The first start of a build with Lab writes lab = true when the key is missing (1.2); a stored value stays. */
  async function ensureDefault() {
    await run(async () => {
      const s = await settings();
      if (s.lab === undefined) await storage.set('settings', { ...s, lab: true });
    });
  }

  /** -> {lab} */
  async function setLab(want) {
    await run(async () => storage.set('settings', { ...(await settings()), lab: !!want }));
    return { lab: isLabOn(await settings()) };
  }

  // --- the Daylight server ------------------------------------------------------------------------------------------

  async function serverFor(pairing) {
    const key = keyOf(pairing);
    if (serverCache?.key !== key) {
      serverCache = { key, server: new DaylightServer({ pairing, storage, fetch: fetchFn, now, from: await deviceName(), app: appId }) };
    }
    return serverCache.server;
  }

  /**
   * The server as a whole: discovery (the pin, the move, the API level), then GET /v1/status (cached 10 minutes).
   * force: Lab settings opened (the section or What's in Lab), so the config topic is read now whatever the cached
   * config's age (server DESIGN 4.3 rule 1) and the status is asked now: a server that moved is asked about at once, not
   * after the config's 6 hours. One relay poll at most, two when a server found from the cached config fails (below).
   * -> {state, message, config?, status?, moved?}; state is 'ready' or a state of SERVER_WIDE.
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
    if (config.api < SERVER_API_MIN) return { state: 'server-outdated', message: localMessage('server-outdated'), config, moved: d.moved };
    if (config.api > SERVER_API) return { state: 'app-outdated', message: localMessage('app-outdated'), config, moved: d.moved };
    try {
      const status = await server.status({ force });
      return { state: 'ready', message: null, config, status, moved: d.moved };
    } catch (e) {
      // The pinned server may be gone because it moved (a deploy with "New setup link" deletes the old Worker): the
      // move goes with the error, so the section can ask about it. A config that came from the cache is read again
      // from the config topic once in this check (2.6): after a 401, discover() polls only on the first BAD_AUTH of an
      // episode (noteError removed server/configAt: 2.6's "discover({force: true}) once"); after a server that is gone
      // or failing (OFFLINE, SERVER_ERROR), discover({force: true}). A forced check read the topic already.
      const out = await server.noteError('', e);
      let moved = d.moved;
      const code = e?.code;
      if (!force && d.source === 'cache' && (code === 'BAD_AUTH' || code === 'OFFLINE' || code === 'SERVER_ERROR')) {
        try { moved = (await server.discover(code === 'BAD_AUTH' ? {} : { force: true }))?.moved ?? moved; } catch { /* the relay is out of reach too */ }
      }
      return { ...out, config, moved };
    }
  }

  /**
   * The answer of a check is kept (lab/server; a ready server ends the re-pairing follow-up) only while the pairing and
   * the server it asked about are still the ones in use: a pairing change (forget(), or another tab's, which only the
   * stored pairing shows) or a server change while it ran makes it the old one's. A check can outlive both: discovery's
   * relay poll has no deadline of its own, only the callers' 5 s.
   */
  async function stillCurrent(p) {
    if (p.era !== era) return false;
    const key = keyOf(await pairingNow());
    return p.era === era && key === p.key; // the era again: a change may have begun while the pairing was read
  }

  async function probe({ force = false } = {}) {
    const pairing = await pairingNow();
    if (!pairing) return { state: 'needs-pairing', message: needsMessage('needs-pairing', { platform: PLATFORM }) };
    const key = keyOf(pairing);
    if (!probing || probing.key !== key || (force && !probing.force)) {
      const p = { key, force, era, promise: null };
      p.promise = probeNow(pairing, force).catch((e) => ({ state: 'error', message: e?.message ?? null })).then(async (r) => {
        try {
          if (!(await stillCurrent(p))) return r;
          await storage.set(SERVER_KEY, { state: r.state, at: now() });
          // The new pairing's server answers: the re-pairing follow-up has done its job.
          if (r.state === 'ready' && p.era === era) await storage.remove(REPAIRED_KEY);
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
    if (p.state !== 'ready') return { state: p.state, message: p.message ?? localMessage(p.state) };
    return stateFromStatus(p.status, key);
  }

  /**
   * The gate (1.5, 2.7.2) as the web sender runs it. -> labGate's {ready, state, message, short, button}, plus
   * `serverCode` for needs-server (Copy Server code). probeResult: an answer to reuse (What's in Lab's states), else
   * the server is asked (within labGate's 5 s).
   */
  async function gate(feature, { probeResult = null } = {}) {
    const s = await settings();
    const pairing = await pairingNow();
    const r = await labGate(feature, {
      lab: isLabOn(s), paired: !!pairing, app, platform: PLATFORM,
      hasCap: (token) => ledger.hasCap(token),
      local: () => null, // nothing on this device to allow first: no OS permission, no site access (DESIGN 10.2)
      server: { state: async (key) => featureState(probeResult ?? (await probe()), key) },
      serverMessage: localMessage, deadlineMs: gateDeadlineMs,
      built: (f) => BUILT_FEATURES.includes(f),
    });
    const out = { ...r };
    if (r.state === 'needs-server' && pairing) {
      try { out.serverCode = await (await serverFor(pairing)).serverCode(); } catch { /* the button copies nothing */ }
    }
    return out;
  }

  // --- what the screens show ----------------------------------------------------------------------------------------

  /**
   * Settings: the switch and the "Daylight server ›" row's subtitle (1.1). refresh: ask the server when its last answer
   * is older than 10 minutes (within the gate's 5 s). -> {lab, labNoteShown, noteEnabled, serverState, serverSubtitle}
   */
  async function state({ refresh = true } = {}) {
    const s = await settings();
    const lab = isLabOn(s);
    const out = { lab, labNoteShown: !!s.labNoteShown, noteEnabled: LAB_NOTE_ENABLED, serverState: null, serverSubtitle: null };
    if (!lab) return out;
    let last = null;
    try { last = await storage.get(SERVER_KEY); } catch { /* none */ }
    let st = last?.state ?? null;
    if (!(await pairingNow())) st = 'needs-pairing';
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
    try { last = await storage.get(SERVER_KEY); } catch { return null; }
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
    if (!isLabOn(await settings())) return { lab: false };
    const pairing = await pairingNow();
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
   * -> {lab, paired, state, message, button, host, fingerprint, delivery, v1Notice, moved, serverCode, labInbox,
   *     aiToday, manualUrl, setupFirst, rerun}
   * moved: "Your Daylight server moved to {host}. Use it?" while the server moved (2.6), also when the old address
   * failed or ran out of time (pendingMove); else null.
   */
  async function serverView() {
    if (!isLabOn(await settings())) return { lab: false };
    const pairing = await pairingNow();
    if (!pairing) {
      return { lab: true, paired: false, state: 'needs-pairing', message: needsMessage('needs-pairing', { platform: PLATFORM }), button: null, rerun: RERUN_HELP };
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
      // The section has its own Copy for the Server code, and the web has no site access to allow: no state button.
      button: null,
      host: config ? hostOf(config.server) || config.server : '',
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

  const labOffText = () => LAB_TEXT.labOff.replace('{app}', app);

  /**
   * "Your Daylight server moved to {host}. Use it?" answered Use it (2.6): the module's confirmMove pins the new
   * origin. The web has no site access to ask for first (DESIGN 10.2). -> {moved: true when it moved}
   */
  async function confirmMove() {
    const pairing = await pairingNow();
    if (!pairing || !isLabOn(await settings())) return { moved: false };
    const server = await serverFor(pairing);
    forget();
    try { return { moved: await server.confirmMove() }; } catch { return { moved: false }; } finally { forget(); }
  }

  /**
   * Set up with a link (2.6 "Setup link", DESIGN 3.5), step 2: the link is read here, and nothing is sent.
   * -> {server, confirm} (the confirmation's text) | {error} (the module's message for its reason)
   */
  async function checkSetupLink(link) {
    if (!(await pairingNow())) return { error: needsMessage('needs-pairing', { platform: PLATFORM }) };
    if (!isLabOn(await settings())) return { error: labOffText() };
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
    const server = await serverFor(await pairingNow());
    forget();
    try {
      await server.setup(link);
      return { done: LAB_TEXT.serverSection.setupDone };
    } catch (e) {
      return { error: e?.message || String(e) };
    } finally {
      forget();
    }
  }

  /**
   * The Server address field (2.6): a typed origin, checked with GET /v1/hello and /v1/status; empty clears it.
   * -> {manualUrl} | {error}
   */
  async function setServerAddress(url) {
    const pairing = await pairingNow();
    if (!pairing) return { error: needsMessage('needs-pairing', { platform: PLATFORM }) };
    if (!isLabOn(await settings())) return { error: labOffText() };
    const server = await serverFor(pairing);
    forget();
    try {
      if (!String(url ?? '').trim()) { await server.clearManualUrl(); return { manualUrl: '' }; }
      return { manualUrl: await server.setManualUrl(url) };
    } catch (e) {
      return { error: e?.message || String(e) };
    } finally {
      forget();
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
    forget(); // a pairing change is on its way: a check still running asked about this pairing's server (stillCurrent)
    if (!current || !next || ds.samePairingSecret(current, next)) return { known: false, locked: false };
    let pin = null, manual = null;
    try { pin = await storage.get('server/pin'); manual = await storage.get('server/manualUrl'); } catch { /* none */ }
    if (!pin && !manual) return { known: false, locked: false };
    let server;
    try {
      server = new DaylightServer({ pairing: current, storage, fetch: fetchFn, now, from: await deviceName(), app: appId });
    } catch { return { known: true, locked: false }; }
    serverCache = null;
    forget();
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
    forget(); // a check still running asked about this pairing's server (stillCurrent)
    let manual = null;
    try { manual = await storage.get('server/manualUrl'); } catch { /* none */ }
    serverCache = null;
    if (!manual) return;
    try {
      await new DaylightServer({ pairing: current, storage, fetch: fetchFn, now, from: '', app: appId }).clearManualUrl();
    } catch (e) { log.warn?.('Send to Daylight: the typed Server address was kept', e); }
  }

  /**
   * After that pairing change (applyPairingChange removed the lab/* keys): the send view's follow-up (DESIGN 12.7),
   * shown while Lab is on, whether the lock reached the server or not (DESIGN 3.4).
   */
  async function afterRepair() {
    try { await storage.set(REPAIRED_KEY, { at: now() }); } catch (e) { log.warn?.('Send to Daylight: re-pairing note not kept', e); }
  }

  /**
   * The re-pairing follow-up (2.6, DESIGN 12.7) while Lab is on and until OK or a ready server:
   * -> {lab, repaired: null | {state: 'locked', message, serverCode, rerun}}. Nothing goes on the network.
   */
  async function repaired() {
    if (!isLabOn(await settings())) return { lab: false, repaired: null };
    const pairing = await pairingNow();
    let mark = null, last = null;
    try { mark = await storage.get(REPAIRED_KEY); last = await storage.get(SERVER_KEY); } catch { /* none */ }
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

  /** OK on the re-pairing follow-up. */
  async function repairSeen() {
    try { await storage.remove(REPAIRED_KEY); } catch { /* shown again next time */ }
  }

  /** Keeps the ledger's states for ids still in the outbox or the hosted outbox (2.2.6). */
  async function prune() {
    try {
      const ids = [...((await storage.get('outbox')) ?? []), ...((await storage.get('server/hosted')) ?? [])].map((r) => r?.id).filter(Boolean);
      await ledger.prune(ids);
    } catch (e) { log.warn?.('Send to Daylight: Lab ledger prune failed', e); }
  }

  return {
    ledger, hook, ensureDefault, setLab, labOn: () => labOn(storage), state, overview, gate, serverView, setServerAddress,
    confirmMove, checkSetupLink, setupServer, beforeRepair, beforeUnpair, afterRepair, repaired, repairSeen, prune, probe,
  };
}
