// Lab in the extension's background (LAB-PLAN 1, 2.2.6 and 2.6; card X0, Wave 0). createApp (core.js) makes one with
// createLab() and passes Lab's messages to it. Everything that needs the pairing secret or the server token runs here,
// in the service worker (DESIGN 13.2): the Lab switch, the sender ledger, the gates and the Daylight server.
//
//   settings.lab           the Lab switch: missing means on, and the first start writes true (1.2); never synced and
//                          never in a pairing link, so pairing, unpairing and renaming leave it as it is
//   settings.labNoteShown  the one-time note (1.2), shown only from a build with F01 or F04: LAB_NOTE_ENABLED
//   lab/inbox, lab/heard, lab/states   the ledger (daylight-lab.js LabLedger), fed by every ack-topic frame that
//                          decrypts, Lab on or off, through the Sender's onAckHeader
//   lab/server             this file's last server answer {state, at}, for the popup's "Daylight server ›" row
//   server/*               the server module's own keys (DESIGN 13.1); only daylight-server.js writes them
//
// Discovery and every server call run only with Lab on (DESIGN 4.3). A pairing change with another secret removes
// every lab/* key with the outbox (applyPairingChange); before it, a server that knows the old pairing is locked
// (lockBeforeRepair, 2.6), Lab on or off.

import * as ds from './daylight-share.js';
import {
  LAB_TEXT, LabLedger, labHook, labGate, needsMessage, inboxLabText, featureName, serverHeadingShort,
  serverRowSubtitle, serverFeatureShort, labInboxSeenText, aiTodayText, fillText, GATE_DEADLINE_MS, SERVER_FEATURES,
  SERVER_KEYS,
} from './daylight-lab.js';
import {
  DaylightServer, localMessage, stateFromStatus, showFingerprint, noticeText, RERUN_HELP,
  SERVER_API, SERVER_API_MIN, STATUS_REFRESH_MS,
} from './daylight-server.js';
import { originPattern, hostOf } from './logic.js';

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
 * topic now (What's in Lab opening), or null; gateDeadlineMs: labGate's 5 s (tests shorten it).
 */
export function createLab({
  api, target = 'chrome', storage, fetch: fetchFn, now = () => Date.now(), log = console, run, getPairing, getSettings,
  deviceName, appId = '', refreshAcks = null, gateDeadlineMs = GATE_DEADLINE_MS,
} = {}) {
  const platform = target === 'safari' ? 'safari' : 'chrome';
  const app = LAB_TEXT.appName[platform];
  const ledger = new LabLedger({ storage, now });
  const hook = labHook(ledger);
  let serverCache = null; // {key, server}
  let probing = null; // {key, force, promise}: one discovery at a time

  const settings = async () => (await getSettings()) ?? {};

  // --- the switch ---------------------------------------------------------------------------------------------------

  /** The first start of a build with Lab writes lab = true when the key is missing (1.2); a stored value stays. */
  async function ensureDefault() {
    await run(async () => {
      const s = await settings();
      if (s.lab === undefined) await storage.set('settings', { ...s, lab: true });
    });
  }

  /** -> {lab} */
  async function setLab(on) {
    await run(async () => storage.set('settings', { ...(await settings()), lab: !!on }));
    return { lab: isLabOn(await settings()) };
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
   * GET /v1/status (cached 10 minutes; force: ask now). One relay poll at most.
   * -> {state, message, config?, status?, moved?, origins?}; state is 'ready' or a state of SERVER_WIDE.
   */
  async function probeNow(pairing, force) {
    const server = await serverFor(pairing);
    let d;
    try { d = await server.discover(); } catch (e) { return server.noteError('', e); }
    if (!d) {
      let pin = null;
      try { pin = await storage.get('server/pin'); } catch { /* none */ }
      const state = pin && pin.fingerprint !== (await server.values()).fingerprint ? 'pairing-mismatch' : 'needs-server';
      return { state, message: localMessage(state) };
    }
    const { config } = d;
    if (!(await hasOrigin(config.server))) return { ...siteAccess(config.server), config, moved: d.moved };
    if (config.api < SERVER_API_MIN) return { state: 'server-outdated', message: localMessage('server-outdated'), config };
    if (config.api > SERVER_API) return { state: 'app-outdated', message: localMessage('app-outdated'), config };
    try {
      const status = await server.status({ force });
      return { state: 'ready', message: null, config, status, moved: d.moved };
    } catch (e) {
      return { ...(await server.noteError('', e)), config };
    }
  }

  async function probe({ force = false } = {}) {
    const pairing = await getPairing();
    if (!pairing) return { state: 'needs-pairing', message: needsMessage('needs-pairing', { platform }) };
    const key = `${pairing.code}|${pairing.relay}`;
    if (!probing || probing.key !== key || (force && !probing.force)) {
      const p = { key, force, promise: null };
      p.promise = probeNow(pairing, force).catch((e) => ({ state: 'error', message: e?.message ?? null })).then(async (r) => {
        try { await storage.set('lab/server', { state: r.state, at: now() }); } catch { /* shown anyway */ }
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
      lab: isLabOn(s), paired: !!pairing, app, platform,
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
    const lab = isLabOn(s);
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
   * What's in Lab (1.4): the Inbox's Lab state, the features with their short states, then the server group.
   * refresh: it opened, so read the ack topic first (the header is then current) and ask the server now, within the
   * gate's 5 s. Without refresh nothing goes on the network: the server's last state, and no short states yet (null).
   * -> {lab, header, features: [{id, name, sentence, short}], server: {state, short, features: [...]}}
   */
  async function overview({ refresh = true } = {}) {
    const s = await settings();
    if (!isLabOn(s)) return { lab: false };
    const pairing = await getPairing();
    if (pairing && refresh && refreshAcks) await withDeadline(refreshAcks().catch(() => {}), gateDeadlineMs, () => {});
    const snap = await ledger.snapshot();
    const header = inboxLabText({ inboxLab: snap.inboxLab, checkedIn: snap.checkedIn }, now());
    let p = null;
    if (!pairing) p = { state: 'needs-pairing' };
    else if (refresh) p = await probeInTime({ force: true });
    if (!p) {
      return {
        lab: true, header, fresh: false,
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
    return { lab: true, header, fresh: true, features, server: { state: heading, short: serverHeadingShort(heading), features: serverRows } };
  }

  /**
   * The Daylight server section (2.6): where setup happens, so it carries the long texts.
   * -> {lab, paired, state, message, button, origins, host, fingerprint, delivery, v1Notice, serverCode, labInbox,
   *     aiToday, manualUrl, rerun}
   */
  async function serverView() {
    const s = await settings();
    if (!isLabOn(s)) return { lab: false };
    const pairing = await getPairing();
    if (!pairing) {
      return { lab: true, paired: false, state: 'needs-pairing', message: needsMessage('needs-pairing', { platform }), rerun: RERUN_HELP };
    }
    const server = await serverFor(pairing);
    const p = await probeInTime({ force: true });
    const config = p.config ?? null;
    const status = p.status ?? null;
    let manualUrl = '';
    try { manualUrl = (await storage.get('server/manualUrl')) ?? ''; } catch { /* none */ }
    return {
      lab: true, paired: true, state: p.state,
      message: p.state === 'ready' ? LAB_TEXT.ready : (p.message ?? localMessage(p.state)),
      // The section has its own Copy for the Server code; only site access gets the state's button here (Allow).
      button: p.state === 'needs-site-access' ? LAB_TEXT.buttons[p.state] : null, origins: p.origins ?? null,
      host: config ? hostOf(config.server) || config.server : '',
      fingerprint: showFingerprint((await server.values()).fingerprint),
      delivery: config?.delivery ?? null,
      v1Notice: config?.delivery === 'v1' ? noticeText('v1') : null,
      serverCode: await server.serverCode(),
      labInbox: status ? labInboxSeenText(status.inbox?.lastSeen ?? null, now()) : null,
      aiToday: status?.usage?.ai ? aiTodayText(status.usage.ai.usd, status.usage.ai.limitUsd) : null,
      manualUrl,
      rerun: RERUN_HELP,
    };
  }

  /**
   * The Server address field (2.6): a typed origin, checked with GET /v1/hello and /v1/status; empty clears it.
   * The page asks for the host permission first. -> {manualUrl} | {error}
   */
  async function setServerAddress(url) {
    const pairing = await getPairing();
    if (!pairing) return { error: needsMessage('needs-pairing', { platform }) };
    if (!isLabOn(await settings())) return { error: fillText(LAB_TEXT.labOff, { app }) };
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
   * locked, Lab on or off, when a pin exists. Never throws; gives up after `ms`.
   */
  async function beforeRepair(current, next, ms = 10000) {
    if (!current || !next || ds.samePairingSecret(current, next)) return false;
    let pin = null, manual = null;
    try { pin = await storage.get('server/pin'); manual = await storage.get('server/manualUrl'); } catch { /* none */ }
    if (!pin && !manual) return false;
    const server = new DaylightServer({ pairing: current, storage, fetch: fetchFn, now, from: await deviceName(), app: appId });
    serverCache = null;
    probing = null;
    return withDeadline(server.lockBeforeRepair().catch(() => false), ms, () => false);
  }

  /** Keeps the ledger's states for ids still in the outbox or the hosted outbox (2.2.6). */
  async function prune() {
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
      default: return undefined;
    }
  }

  return { ledger, hook, ensureDefault, setLab, labOn: () => labOn(storage), state, overview, gate, serverView, setServerAddress, beforeRepair, prune, probe, onMessage };
}
