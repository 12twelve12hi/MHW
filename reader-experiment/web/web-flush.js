// F07, the offline-first outbox, in the web sender (LAB-PLAN F07 and 2.7.1; card B1, Wave 1): what the page and its
// service worker share. No DOM here: the page (app.js) runs it on the `online` event and from its ticks, and the
// service worker (sw-sync.js, bundled into sw-lab.js by build.mjs) runs it on Background Sync's `dls-flush`, where the
// browser has it (Chromium): rows queued offline then go even when the page is closed. Elsewhere they go on the next
// open.
//
// The rules, as on Windows (WIN1's review):
//   - while Lab is on, a row waiting for a connection (failed, errorCode 'network') is never due in v1.1's re-send pass
//     (WebSender.holdNetwork): that pass has no caps, and once the rows' back-off ran out it would send all of them at
//     once and empty the request bucket the household shares with the Daylight;
//   - such rows leave only through flushPass: Sender.flushNetwork (oldest first, at most 30 frames and 18 MB of
//     attachments a pass, nothing more after a 429, no attachments after a 413), passes at least 3 minutes apart
//     (lab/flushAt, which the page and the service worker share), under the page's outbox lock;
//   - with Lab off, v1.1's back-off re-sends them (LAB-PLAN 1.3), and flushPass does nothing.

import * as ds from './daylight-share.js';
import { appendActivity } from './daylight-lab.js';

/** Background Sync's tag (LAB-PLAN F07, Web). */
export const SYNC_TAG = 'dls-flush';
/** Passes of flushNetwork are at least this far apart (LAB-PLAN 2.7.1). */
export const FLUSH_GAP_MS = 3 * 60e3;
/** When the last pass ran (ms), shared by every tab and the service worker. Under lab/: a pairing change removes it. */
export const FLUSH_KEY = 'lab/flushAt';
/** F26's activity log: the last 200 events (no title, URL or name ever goes in). */
export const ACTIVITY_KEY = 'lab/activity';
/** The Web Lock the page holds around every outbox change; the service worker takes it too. */
export const OUTBOX_LOCK = 'send-to-daylight-outbox';

/** A row waiting for a connection (F07): failed with error code network, whatever made it fail. */
export const isWaitingRow = (row) => row?.status === 'failed' && row?.errorCode === 'network';

/** The Lab switch as one value (1.2): a missing key means on. */
const labIsOn = (settings) => settings?.lab !== false;

/**
 * daylight-share's Sender with F07's one rule: while `holdNetwork` is true (Lab on), a row waiting for a connection is
 * never due in a re-send pass; flushPass sends it.
 */
export class WebSender extends ds.Sender {
  constructor(opts) { super(opts); this.holdNetwork = false; }
  _due(row, now) { return this.holdNetwork && isWaitingRow(row) ? false : super._due(row, now); }
  /** Whether v1.1's back-off says the row is due for a re-send, holdNetwork or not. */
  dueByBackoff(row, now) { return super._due(row, now); }
}

/**
 * Whether a capped pass is due (Lab on): the oldest row waiting for a connection, the one flushNetwork tries first, is
 * due by v1.1's back-off. The head's back-off keeps a pass from repeating every 3 minutes while the relay stays out of
 * reach with the browser saying it is online.
 */
export function flushDue(sender, rows, now) {
  const head = (rows ?? []).filter((r) => isWaitingRow(r) && now - r.created <= ds.OUTBOX_EXPIRY_MS)
    .sort((a, b) => a.created - b.created)[0];
  return !!head && sender.dueByBackoff(head, now);
}

/** Appends events to the activity log (F26), with Lab on. */
export async function logActivity(storage, events, now = Date.now()) {
  if (!events.length) return;
  let log = (await storage.get(ACTIVITY_KEY)) ?? [];
  for (const e of events) log = appendActivity(log, { time: now, ...e });
  await storage.set(ACTIVITY_KEY, log);
}

/**
 * One capped pass of the rows waiting for a connection (Lab on, online), at least FLUSH_GAP_MS after the last one.
 * Call it under the outbox lock. -> {attempted: rows, again: ms until the next pass worth trying, or null}
 *   again: the rest of the 3 minutes when this one came too soon; 3 minutes when this pass stopped at a cap and every
 *   row it tried went; null when nothing waits, or the pass failed (the head's back-off then decides: flushDue).
 */
export async function flushPass({ storage, sender, now = () => Date.now(), online = true, log = true }) {
  const settings = (await storage.get('settings')) ?? {};
  if (!labIsOn(settings) || online === false || !sender) return { attempted: [], again: null };
  const waiting = (await sender.list()).filter(isWaitingRow);
  if (!waiting.length) return { attempted: [], again: null };
  const last = (await storage.get(FLUSH_KEY)) ?? 0;
  const wait = last + FLUSH_GAP_MS - now();
  if (wait > 0) return { attempted: [], again: wait };
  await storage.set(FLUSH_KEY, now());
  const attempted = await sender.flushNetwork();
  if (log) await logActivity(storage, attempted.map((r) => ({ type: 'flush', id: r.id, kind: r.kind, status: r.status, http: r.http })), now());
  // A pass that reached nothing (every row failed for want of a network) put no request on the relay: the next one
  // needn't wait the 3 minutes. The head row's back-off still spaces the page's passes (flushDue).
  if (attempted.length && attempted.every(isWaitingRow)) await storage.set(FLUSH_KEY, last);
  const left = (await sender.list()).some(isWaitingRow);
  const went = attempted.length && attempted.every((r) => r.status !== 'failed' && r.status !== 'expired');
  return { attempted, again: left && went ? FLUSH_GAP_MS : null };
}
