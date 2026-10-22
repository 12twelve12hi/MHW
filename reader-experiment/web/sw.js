// Service worker for the web sender: the app works offline (its files are cached; sends wait in the outbox), and the
// installed app on Android receives links and files from the share sheet (Web Share Target, POST to ./share-target).
// build.mjs replaces __BUILD__ with a hash of the site, so each release installs fresh files.

const BUILD = '__BUILD__';

// Lab's F07 (LAB-PLAN F07, Web): Background Sync's `dls-flush` sends rows queued offline once the browser is online
// again, with Lab on (sw-sync.js, bundled by build.mjs). A browser that can't load it keeps everything else here.
try {
  importScripts('sw-lab.js');
} catch (e) {
  console.warn('Send to Daylight: Background Sync is off in this browser', e);
}
/**
 * The largest file the page sends (MAX_ITEM in daylight-share.js, protocol 1.1; a unit test keeps them equal). A larger
 * shared file is never copied: the page gets its name and size and refuses it in the protocol's words.
 */
const MAX_ITEM = 9000000;
const CACHE = `send-to-daylight-${BUILD}`;
const SHELL = [
  './', 'app.js', 'styles.css', 'daylight-share.js', 'logic.js', 'web-logic.js', 'web-storage.js', 'manifest.webmanifest',
  'web-lab.js', 'web-lab-page.js', 'daylight-lab.js', 'daylight-server.js', 'lab-ui.js', 'lab-popup.js', 'lab-send.js',
  'web-flush.js', 'sw-lab.js',
  'icons/icon.svg', 'icons/favicon-32.png', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('send-to-daylight-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return; // the relay etc.
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    event.respondWith(page(req));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? fetch(req)));
});

/** Pages: the network first (so updates show), the cached app when offline or the network hangs. */
async function page(req) {
  const cached = () => caches.match('./', { ignoreSearch: true });
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 5000)),
    ]);
    if (res.ok && new URL(req.url).pathname === new URL(self.registration.scope).pathname) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('./', copy)).catch(() => {});
    }
    return res;
  } catch {
    return (await cached()) ?? Response.error();
  }
}

// The same database web-storage.js opens (keep the two in step).
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('send-to-daylight', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('shared')) db.createObjectStore('shared');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Keeps a share for the page, under a new id. */
async function keepShare(db, entry, id) {
  await new Promise((resolve, reject) => {
    const tx = db.transaction('shared', 'readwrite');
    tx.objectStore('shared').put(entry, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * A share from the Android share sheet: keep it for the page, then open the page to send it. Files over MAX_ITEM keep
 * only their name and size (CHANGES-v1.1 2.2: refused before they are read or copied). When the copy doesn't fit (a
 * storage quota), the names stay with noSpace and the page says this device is out of space.
 */
async function receiveShare(req) {
  const scope = self.registration.scope;
  try {
    const form = await req.formData();
    const files = form.getAll('files').filter((f) => f && typeof f === 'object' && typeof f.size === 'number');
    const base = {
      title: String(form.get('title') ?? ''), text: String(form.get('text') ?? ''), url: String(form.get('url') ?? ''),
      at: Date.now(),
    };
    const about = (f) => ({ name: f.name || 'document', type: f.type || '', size: f.size });
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    const db = await openDb();
    try {
      await keepShare(db, { ...base, files: files.map((f) => (f.size > MAX_ITEM ? about(f) : { ...about(f), blob: f })) }, id);
    } catch {
      await keepShare(db, { ...base, files: files.map((f) => ({ ...about(f), noSpace: f.size <= MAX_ITEM })) }, id);
    }
    return Response.redirect(new URL(`./?share=${id}&autosend=1`, scope).href, 303);
  } catch {
    return Response.redirect(new URL('./', scope).href, 303);
  }
}
