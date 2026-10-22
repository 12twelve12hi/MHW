// Pure helpers for the web sender (no DOM), so node tests can run them.

import { webUrl, findUrl, cleanTitle, safeFileName } from './daylight-share.js';

/** The web sender's version, and the `app` its items carry (PROTOCOL 2.1); the service worker's sends carry it too. */
export const VERSION = '1.1.0';
export const APP = `web/${VERSION}`;

const KEYS = ['pair', 'url', 'text', 'title', 'autosend', 'share'];

/**
 * The parameters a page load carries, from the query (?url=…, what iOS Shortcuts and share targets send) and the
 * fragment (#pair=…&url=…, which never reaches the web server). The fragment wins.
 */
export function readParams(search = '', hash = '') {
  const out = {};
  for (const src of [search.replace(/^\?/, ''), hash.replace(/^#/, '')]) {
    const p = new URLSearchParams(src);
    for (const k of KEYS) if (p.has(k)) out[k] = p.get(k);
  }
  const tail = trailingUrl(hash.replace(/^#/, ''));
  if (tail) out.url = tail;
  out.autosend = /^(1|true|yes)$/i.test(out.autosend ?? '');
  return out;
}

/**
 * The Shortcut link ends in "&url=" and the shared address is appended, encoded or not (a raw "&" or "+" would
 * break URLSearchParams). When url= is the last parameter, everything after it is the address.
 */
function trailingUrl(fragment) {
  const m = /(?:^|&)url=([^]*)$/.exec(fragment);
  if (!m || /&(title|text|pair|autosend|share)=/.test(m[1])) return null;
  let decoded = null;
  try { decoded = decodeURIComponent(m[1]); } catch { /* not encoded */ }
  return webUrl(decoded) ?? webUrl(m[1]);
}

export const hasShareParams = (p) => !!(p.pair || p.url || p.text || p.title || p.share || p.autosend);

/** What a shared {url, text, title} means: the first web address in url or text, and a title. */
export function sharedLink({ url = '', text = '', title = '' } = {}) {
  const u = webUrl(url) ?? findUrl(url) ?? findUrl(text);
  let t = cleanTitle(title);
  if (!t && text) {
    // Android shares "Some title https://…": the rest of the text is the title.
    const rest = cleanTitle(String(text).replace(/https?:\/\/[^\s<>"']+/gi, ' '));
    if (rest && rest !== u) t = rest;
  }
  return { url: u, title: t };
}

/** A typed address: adds https:// to "example.com/story". */
export function normalizeUserUrl(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  const direct = webUrl(s) ?? findUrl(s);
  if (direct) return direct;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(s)) return webUrl(`https://${s}`);
  return null;
}

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  mobi: 'application/x-mobipocket-ebook',
};

/** The MIME type to send for a file: the browser's when it knows, else from the extension. */
export function mimeFor(name = '', type = '') {
  const t = String(type || '').toLowerCase();
  if (t && t !== 'application/octet-stream') return t;
  const ext = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export const fileNameFor = (name) => safeFileName(name, 'document');

/** A default name for this device from the user agent: "iPhone (web)", "Mac (web)", … */
export function deviceName(ua = '', maxTouchPoints = 0) {
  let d = 'Browser';
  if (/iPhone/.test(ua)) d = 'iPhone';
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) d = 'iPad';
  else if (/Android/.test(ua)) d = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  else if (/Macintosh|Mac OS X/.test(ua)) d = 'Mac';
  else if (/Windows/.test(ua)) d = 'Windows PC';
  else if (/CrOS/.test(ua)) d = 'Chromebook';
  else if (/Linux/.test(ua)) d = 'Linux';
  return `${d} (web)`;
}

/** The link an iPhone Shortcut opens, with the shared address appended URL-encoded. */
export function shortcutPrefix(pageUrl, pairingLink) {
  const base = String(pageUrl).split('#')[0].split('?')[0];
  return `${base}#autosend=1&pair=${encodeURIComponent(pairingLink)}&url=`;
}

/** Runs async functions one at a time (used when the Web Locks API is missing). */
export function serial() {
  let chain = Promise.resolve();
  return (fn) => {
    const p = chain.then(fn, fn);
    chain = p.then(() => {}, () => {});
    return p;
  };
}
