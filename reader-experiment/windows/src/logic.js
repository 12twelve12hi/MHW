// Pure helpers for the Windows app (no DOM, no Tauri), so the unit tests run them in node.

import * as ds from './daylight-share.js';

const { webUrl, findUrl, safeFileName, cleanTitle, describeRow } = ds;

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

const TONES = { sending: 'busy', failed: 'busy', sent: 'sent', delivered: 'ok', expired: 'bad' };
const BUTTONS = { 'retry-now': 'Retry now', 'try-again': 'Try again' };

/**
 * How a history row reads, in the words every Send to Daylight app uses (CHANGES-v1.1 2.5, from the protocol library's
 * describeRow): {label, tone, sentence, action, retry, retryLabel}. sentence is '' when there is none; retry is true
 * when the row has a button, whose words are retryLabel ("Retry now" or "Try again"). Every row can also be removed.
 */
export function rowView(row, now = Date.now()) {
  const d = describeRow(row, now);
  return {
    label: d.label, tone: TONES[row?.status] ?? 'sent', sentence: d.sentence ?? '', action: d.action,
    retry: !!d.action, retryLabel: BUTTONS[d.action] ?? '',
  };
}

/** What to say after a share (CHANGES-v1.1 2.5): the row's label, then its sentence when it has one. */
export function rowMessage(row, now = Date.now()) {
  const d = describeRow(row, now);
  if (!d.label) return '';
  const label = /[.…✓]$/.test(d.label) ? d.label : `${d.label}.`;
  return d.sentence ? `${label} ${d.sentence}` : label;
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
 * How long after a share (`created`) an ack can still arrive: the outbox's 7 days of re-sends, then the 8 days the
 * Daylight keeps listing ids it received in its acks (DIGEST_WINDOW, CHANGES-v1.1 2.1). An expired row can still be
 * delivered in that time: the Daylight may come online and pick up the last re-send still on the relay.
 */
export const ACK_WINDOW_MS = ds.OUTBOX_EXPIRY_MS + 8 * 86400000;

/** True while an ack is worth reading: some row isn't delivered and was shared less than ACK_WINDOW_MS ago. */
export const wantsAcks = (rows, now = Date.now()) =>
  (rows ?? []).some((r) => !!r && r.status !== 'delivered' && now - (r.created ?? 0) < ACK_WINDOW_MS);

/**
 * The outbox's acks and re-sends (PROTOCOL 3.3; CHANGES-v1.1 2.4 tick). The library's resendDue always runs: it makes
 * no request unless something is due, and it ends week-old rows and drops expired rows' content after 14 days
 * (CONTENT_KEEP). The ack topic is read only while wantsAcks(), so an idle outbox stays off the relay.
 * sender: a daylight-share Sender; call it under the app's own outbox lock. -> {delivered, resent}
 */
export async function maintain(sender, now = Date.now()) {
  if (wantsAcks(await sender.list(), now)) return sender.tick();
  return { delivered: 0, resent: (await sender.resendDue()).length };
}

/**
 * The notification after sending: {title, body, bad}. results: [{row} | {name, error}] in the order sent. bad: one of
 * them isn't sent and won't be by itself (an error, or Not delivered).
 * One item: its name, then the row's label and sentence (CHANGES-v1.1 2.5), or "Couldn’t send <name>" and why. Several:
 * a count, then one line when they all ended alike, else what each one did.
 */
export function sendSummary(results) {
  const say = (r) => (r.row ? rowMessage(r.row) : r.error || 'Something went wrong.');
  const nameOf = (r) => (r.row ? shortName(r.row) : r.name || 'it');
  const bad = results.some((r) => !r.row || r.row.status === 'expired');
  if (results.length === 1) {
    const r = results[0];
    return r.row ? { title: nameOf(r), body: say(r), bad } : { title: `Couldn’t send ${nameOf(r)}`, body: say(r), bad };
  }
  const said = [...new Set(results.map(say))];
  if (said.length === 1 && results.every((r) => r.row)) return { title: `${results.length} items`, body: said[0], bad };
  const lines = results.slice(0, 4).map((r) => `${nameOf(r)}: ${say(r)}`);
  if (results.length > 4) lines.push(`and ${results.length - 4} more`);
  return { title: `${results.length} items`, body: lines.join('\n'), bad };
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
