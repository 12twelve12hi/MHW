// Pure helpers for the Windows app (no DOM, no Tauri), so the unit tests run them in node.

import * as ds from './daylight-share.js';

const { webUrl, findUrl, safeFileName, cleanTitle } = ds;

export const DEFAULT_HOTKEY = 'Ctrl+Alt+D';
export const PDF_MIME = 'application/pdf';

const MIME_BY_EXT = {
  pdf: PDF_MIME,
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
  azw3: 'application/vnd.amazon.ebook',
  fb2: 'application/x-fictionbook+xml',
  cbz: 'application/vnd.comicbook+zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** The MIME type for a file name: the browser's when it knows one (drag and drop), else from the extension. */
export function mimeFor(name = '', type = '') {
  const t = String(type || '').toLowerCase();
  if (t && t !== 'application/octet-stream') return t;
  const ext = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** The last segment of a Windows (or POSIX) path. */
export function nameFromPath(p) {
  return String(p ?? '').split(/[\\/]+/).filter(Boolean).pop() ?? '';
}

/** The title to show for a file: its name without the extension. */
export const titleFromName = (name) => String(name ?? '').replace(/\.[A-Za-z0-9]{1,8}$/, '');

/** A file's name as it travels (PROTOCOL 5). */
export const fileNameFor = (name) => safeFileName(name, 'document');

/** An Internet Shortcut (.url file, what Windows saves for a dragged or favourite link) -> its web address, or null. */
export function urlFromInternetShortcut(text) {
  const m = /^\s*URL\s*=\s*(\S+)\s*$/im.exec(String(text ?? ''));
  return m ? webUrl(m[1]) : null;
}

export const isInternetShortcut = (name) => /\.url$/i.test(String(name ?? ''));

/**
 * What a drop on the window carries, from its DataTransfer strings: the first web address in text/uri-list (lines
 * starting with # are comments), else in text/plain.
 */
export function linkFromDrop({ uriList = '', text = '' } = {}) {
  for (const line of String(uriList).split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const u = webUrl(s);
    if (u) return u;
  }
  return findUrl(text);
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** How a history row reads. */
export function statusInfo(row) {
  switch (row?.status) {
    case 'sending': return { label: 'Sending…', tone: 'busy', retry: false };
    case 'sent': return { label: 'Sent', tone: 'sent', retry: false, hint: 'Waiting for your Daylight to pick it up' };
    case 'delivered': return { label: 'Delivered ✓', tone: 'ok', retry: false };
    case 'expired': return { label: 'Not delivered', tone: 'bad', retry: true, hint: 'Your Daylight didn’t pick it up within a week' };
    case 'failed': return { label: 'Not delivered', tone: 'bad', retry: true, hint: row.error || 'Couldn’t reach the relay' };
    default: return { label: String(row?.status ?? ''), tone: 'sent', retry: false };
  }
}

/** True when the protocol library words the history itself (describeRow, protocol revision 1.1 and later). */
export const libraryWords = () => typeof ds.describeRow === 'function';

/**
 * How a history row reads: {label, tone, sentence, retry, retryLabel}. The protocol library's own words when it has
 * them (the same on every Send to Daylight app); otherwise Sent / Delivered ✓ / Not delivered with the relay's reason.
 */
export function rowView(row, now = Date.now()) {
  if (libraryWords()) {
    const d = ds.describeRow(row, now);
    const tone = { sending: 'busy', sent: 'sent', delivered: 'ok', failed: 'busy', expired: 'bad' }[row?.status] ?? 'sent';
    return {
      label: d.label, tone, sentence: row?.status === 'delivered' ? '' : d.sentence ?? '', retry: !!d.action,
      retryLabel: d.action === 'try-again' ? 'Try again' : 'Retry now',
    };
  }
  const s = statusInfo(row);
  const sentence = row?.status === 'failed' || row?.status === 'expired' ? row.error || s.hint || '' : '';
  return { label: s.label, tone: s.tone, sentence, retry: s.retry, retryLabel: 'Retry' };
}

export function kindLabel(row) {
  if (row?.kind === 'page') return 'Page';
  if (row?.kind === 'url') return 'Link';
  if (row?.mime === PDF_MIME || /\.pdf$/i.test(row?.name ?? '')) return 'PDF';
  return 'File';
}

export function displayTitle(row) {
  if (row?.title) return row.title;
  if (row?.name) return row.name;
  try {
    const u = new URL(row?.url ?? '');
    return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '');
  } catch { return row?.url || 'Untitled'; }
}

/** "Sent <title or host>" names an item by its title, else its file name, else its web site. */
export function shortName(row) {
  const t = cleanTitle(row?.title) || row?.name || hostOf(row?.url) || row?.url || 'it';
  return [...t].length > 60 ? [...t].slice(0, 59).join('') + '…' : t;
}

export function relativeTime(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** A row still waiting for something (an ack or a re-send). */
export const isPending = (row) => !!row && (row.status === 'sending' || row.status === 'sent' || row.status === 'failed');

/**
 * The notification after sending: {title, body}. results: [{row} | {name, error}] in the order sent.
 * One item: "Sent <title or host>" (or why not); several: a count, then what failed.
 */
export function sendSummary(results) {
  const ok = results.filter((r) => r.row && r.row.status !== 'failed');
  const failed = results.filter((r) => !r.row || r.row.status === 'failed');
  const why = (r) => (r.row ? rowView(r.row).sentence || r.row.error : r.error) || 'Something went wrong.';
  const nameOf = (r) => (r.row ? shortName(r.row) : r.name || 'it');
  if (results.length === 1) {
    const r = results[0];
    if (ok.length) return { title: `Sent ${nameOf(r)}`, body: 'On its way to your Daylight.' };
    const retrying = r.row?.status === 'failed' && !libraryWords();
    return { title: `Couldn’t send ${nameOf(r)}`, body: why(r) + (retrying ? ' It will try again.' : '') };
  }
  if (!failed.length) return { title: `Sent ${ok.length} items`, body: 'On their way to your Daylight.' };
  const lines = failed.slice(0, 3).map((r) => `${nameOf(r)}: ${why(r)}`);
  if (failed.length > 3) lines.push(`and ${failed.length - 3} more`);
  return { title: ok.length ? `Sent ${ok.length} of ${results.length} items` : `Couldn’t send ${results.length} items`, body: lines.join('\n') };
}

// --- the clipboard hotkey -------------------------------------------------------------------------------------------

/**
 * A pressed key combination (a KeyboardEvent's fields) -> an accelerator string the global-shortcut plugin parses,
 * such as "Ctrl+Alt+D", or null while only modifiers are down or when no modifier is held (a lone key would swallow
 * normal typing everywhere).
 */
export function accelFromEvent(e) {
  const code = String(e?.code ?? '');
  if (!code || /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(code)) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (!mods.length || (mods.length === 1 && mods[0] === 'Shift')) return null;
  let key = code;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (!/^(F([1-9]|1[0-9]|2[0-4])|Numpad[0-9]|Backquote|Backslash|BracketLeft|BracketRight|Comma|Equal|Minus|Period|Quote|Semicolon|Slash|Space|Insert|Delete|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right)|Pause|PrintScreen)$/.test(code)) return null;
  return [...mods, key].join('+');
}

/** "Ctrl+Alt+D" -> "Ctrl + Alt + D" for reading. */
export function describeAccel(accel) {
  if (!accel) return 'Off';
  return String(accel).split('+').map((k) => k.replace(/^Arrow/, '').replace(/^Super$/, 'Win')).join(' + ');
}
