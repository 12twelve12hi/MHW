// The service worker's part of F07 (LAB-PLAN F07, Web; card B1): Background Sync's `dls-flush`, where the browser has
// it (Chromium). The page registers it when it queues a row offline; the browser fires it once it is online again, even
// with the page closed, and this sends the waiting rows in one capped pass (web-flush.js flushPass), under the page's
// outbox lock, with Lab on only. Pages that are open hear about it on their BroadcastChannel and draw the history again.
// When rows still wait afterwards (a cap, the 3 minutes between passes, a relay still out of reach), the event fails,
// so the browser tries again later with its own back-off; the page's next open sends whatever is left.
//
// build.mjs bundles this module and what it imports into one classic script, sw-lab.js, which sw.js loads with
// importScripts (a module service worker would leave out browsers that run only classic ones).

import * as ds from './daylight-share.js';
import { openDb, idbStorage } from './web-storage.js';
import { APP, deviceName } from './web-logic.js';
import { SYNC_TAG, OUTBOX_LOCK, WebSender, flushPass, isWaitingRow } from './web-flush.js';

/**
 * One Background Sync run: -> {attempted, retry}. retry: rows still wait with Lab on (the caller fails the event).
 * storage: the page's IndexedDB kv; lock(fn): the outbox lock.
 */
export async function syncFlush({ storage, lock = (fn) => fn(), now = () => Date.now(), ua = '' } = {}) {
  return lock(async () => {
    const pairing = await ds.loadPairing(storage).catch(() => null);
    const settings = (await storage.get('settings')) ?? {};
    if (!pairing || settings.lab === false) return { attempted: [], retry: false };
    const sender = new WebSender({ pairing, storage, from: settings.from || deviceName(ua), app: APP, now });
    sender.holdNetwork = true;
    // The browser fires dls-flush when it is online again (or for the last time), so the pass is tried whatever
    // navigator.onLine says here; rows that still can't go fail for want of a network, and wait for the next one.
    const { attempted } = await flushPass({ storage, sender, now });
    return { attempted, retry: (await sender.list()).some(isWaitingRow) };
  });
}

if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  self.addEventListener('sync', (event) => {
    if (event.tag !== SYNC_TAG) return;
    event.waitUntil((async () => {
      const db = await openDb();
      try {
        const locks = self.navigator?.locks;
        const r = await syncFlush({
          storage: idbStorage(db), ua: self.navigator?.userAgent ?? '',
          lock: locks?.request ? (fn) => locks.request(OUTBOX_LOCK, fn) : (fn) => fn(),
        });
        if (r.attempted.length && 'BroadcastChannel' in self) {
          const channel = new BroadcastChannel('send-to-daylight');
          channel.postMessage('changed');
          channel.close();
        }
        if (r.retry) throw new Error('Send to Daylight: items still wait for a connection');
      } finally {
        db.close();
      }
    })());
  });
}
