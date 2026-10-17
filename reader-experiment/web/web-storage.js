// Storage for the web sender: IndexedDB (room for PDFs kept for re-sends), else localStorage, else memory.
// Adapters follow daylight-share.js: async get(key), set(key, value), remove(key) with JSON-serialisable values.
// The service worker opens the same database (sw.js) to hand over files shared to the installed app.

import { MemoryStorage } from './daylight-share.js';

export const DB_NAME = 'send-to-daylight';
export const DB_VERSION = 1;
export const KV = 'kv';
export const SHARED = 'shared';

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(SHARED)) db.createObjectStore(SHARED);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

export function idbRequest(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let result;
    const req = fn(tx.objectStore(store));
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

export function idbStorage(db) {
  return {
    kind: 'indexeddb',
    get: (k) => idbRequest(db, KV, 'readonly', (s) => s.get(k)),
    set: (k, v) => idbRequest(db, KV, 'readwrite', (s) => s.put(v, k)).then(() => undefined),
    remove: (k) => idbRequest(db, KV, 'readwrite', (s) => s.delete(k)).then(() => undefined),
  };
}

export function localStorageAdapter(prefix = 'send-to-daylight:') {
  return {
    kind: 'localstorage',
    async get(k) { const v = localStorage.getItem(prefix + k); return v == null ? undefined : JSON.parse(v); },
    async set(k, v) {
      try { localStorage.setItem(prefix + k, JSON.stringify(v)); }
      catch (e) { if (!String(k).startsWith('outbox/')) throw e; /* no room for the re-send copy: send once */ }
    },
    async remove(k) { localStorage.removeItem(prefix + k); },
  };
}

/** -> {storage, db|null} */
export async function openStorage() {
  try {
    const db = await openDb();
    const s = idbStorage(db);
    await s.get('pairing');
    return { storage: s, db };
  } catch { /* private mode on old browsers */ }
  try {
    localStorage.setItem('send-to-daylight:probe', '1');
    localStorage.removeItem('send-to-daylight:probe');
    return { storage: localStorageAdapter(), db: null };
  } catch { /* storage blocked */ }
  const m = new MemoryStorage();
  m.kind = 'memory';
  return { storage: m, db: null };
}

/** Takes (reads and deletes) what the service worker stored for a share-target id. */
export async function takeShared(db, id) {
  if (!db || !id) return null;
  const entry = await idbRequest(db, SHARED, 'readonly', (s) => s.get(id));
  await idbRequest(db, SHARED, 'readwrite', (s) => s.delete(id));
  return entry ?? null;
}

/** Drops shares older than a day that were never picked up. */
export async function pruneShared(db, now = Date.now()) {
  if (!db) return;
  const keys = await idbRequest(db, SHARED, 'readonly', (s) => s.getAllKeys());
  for (const k of keys ?? []) {
    const e = await idbRequest(db, SHARED, 'readonly', (s) => s.get(k));
    if (!e || now - (e.at ?? 0) > 24 * 3600 * 1000) await idbRequest(db, SHARED, 'readwrite', (s) => s.delete(k));
  }
}
