// Pure helpers shared by the background and the popup. No browser APIs here, so the unit tests run them in node.

import { safeFileName, cleanTitle, webUrl, describeRow, normalizeRelay, MAX_ITEM, OUTBOX_EXPIRY_MS } from './daylight-share.js';

export const PDF_MIME = 'application/pdf';
/** The PDF is read out of the page in pieces of this many bytes (each piece crosses the extension boundary as base64). */
export const PDF_CHUNK = 4 * 1024 * 1024;
/** The largest PDF sent as a file (protocol 1.1: 9 MB for every item); a larger one goes as its link. */
export const MAX_PDF = MAX_ITEM;

/** True when a URL's path ends in .pdf (ignoring case, query and fragment). */
export function looksLikePdfUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep it raw */ }
  return /\.pdf$/i.test(path.replace(/\/+$/, ''));
}

/** The match pattern that covers a URL's origin, for permissions.request, or null for non-web URLs. */
export function originPattern(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return `${u.protocol}//${u.hostname}/*`;
}

/** The file name in a Content-Disposition header ('' when none). Prefers RFC 5987 filename*= over filename=. */
export function filenameFromDisposition(header) {
  const h = String(header ?? '');
  const star = /filename\*\s*=\s*"?([^'";]*)'[^']*'([^;"]+)"?/i.exec(h);
  if (star) {
    try { return decodeURIComponent(star[2].trim()); } catch { /* fall through to filename= */ }
  }
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/i.exec(h);
  if (plain) return (plain[1] != null ? plain[1].replace(/\\(.)/g, '$1') : plain[2]).trim();
  return '';
}

function lastPathSegment(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    try { return decodeURIComponent(seg); } catch { return seg; }
  } catch { return ''; }
}

/**
 * A file name for a downloaded PDF: the server's Content-Disposition name, else the URL's last path segment when it
 * ends in .pdf, else the tab title, else the last path segment; always ending in .pdf and safe (PROTOCOL 5).
 */
export function pdfFileName({ url = '', disposition = '', title = '' } = {}) {
  const seg = lastPathSegment(url);
  const t = cleanTitle(title);
  let name = filenameFromDisposition(disposition);
  if (!name && /\.pdf$/i.test(seg)) name = seg;
  if (!name && t && t !== url && !/^https?:\/\//i.test(t)) name = t;
  if (!name) name = seg;
  // Clean the base name first, so "Title?" becomes "Title.pdf", not "Title .pdf".
  const base = safeFileName(String(name || '').replace(/\.pdf$/i, ''), 'document').replace(/[.\s]+$/, '') || 'document';
  return safeFileName(`${base}.pdf`, 'document.pdf');
}

/** True when the bytes look like a PDF: "%PDF-" within the first 1024 bytes (the spec allows leading junk). */
export function isPdfBytes(bytes) {
  const n = Math.min(bytes.length - 4, 1024);
  for (let i = 0; i < n; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
  }
  return false;
}

/** The title to show for a file: its name without the extension. */
export const titleFromName = (name) => String(name ?? '').replace(/\.[A-Za-z0-9]{1,8}$/, '');

/**
 * What to send for a captured tab. cap: the result of inject.capturePage (or null when the page couldn't be scripted).
 * -> {kind: 'page'|'url'|'pdf'|'html-file'|'none', reason?}
 */
export function planForCapture(cap, tabUrl) {
  if (!cap) {
    if (looksLikePdfUrl(tabUrl)) return { kind: 'pdf' };
    return webUrl(tabUrl) ? { kind: 'url', reason: 'unscriptable' } : { kind: 'none' };
  }
  const ct = String(cap.contentType || '').toLowerCase();
  const url = webUrl(cap.url) ? cap.url : tabUrl;
  if (ct === PDF_MIME) return { kind: 'pdf' };
  if (/^(image|video|audio)\//.test(ct)) return webUrl(url) ? { kind: 'url', reason: 'media' } : { kind: 'none' };
  if (!webUrl(url)) {
    if (/^file:/i.test(cap.url || tabUrl || '') && cap.html != null) return { kind: 'html-file' };
    return { kind: 'none' };
  }
  if (cap.tooLarge || cap.html == null) return { kind: 'url', reason: 'too-large' };
  return { kind: 'page' };
}

export const NOTES = {
  'unscriptable': 'Extensions can’t read this page, so its link was sent.',
  'too-large': 'The page is larger than 8 MB, so its link was sent.',
  'pdf-too-large': 'The PDF is over 9 MB, so its link was sent.',
  'pdf-failed': 'Couldn’t download the PDF, so its link was sent.',
  'pdf-denied': 'Without access to the site the PDF can’t be downloaded, so its link was sent.',
};

/** The default sender name: "Chrome on Mac", "Safari on iPhone", ... */
export function defaultDeviceName(target, os = '') {
  const browser = target === 'safari' ? 'Safari' : 'Chrome';
  const where = { mac: 'Mac', win: 'Windows', linux: 'Linux', cros: 'ChromeOS', android: 'Android', ios: 'iPhone', ipados: 'iPad', openbsd: 'OpenBSD', fuchsia: 'Fuchsia' }[String(os).toLowerCase()];
  return where ? `${browser} on ${where}` : browser;
}

/** True for a daylightshare:// pairing link (it names its own relay; no r= means ntfy.sh), false for a typed code. */
export const isPairingLink = (input) => /^daylightshare:/i.test(String(input ?? '').trim());

/**
 * The relay for a pairing typed or pasted on an app's own pairing screen (PROTOCOL 1.3): a link's own, else the
 * Advanced > Relay URL field's when it is filled in, else ntfy.sh. -> a normalised relay URL.
 */
export function relayForInput(parsed, input, advanced) {
  if (!isPairingLink(input) && String(advanced ?? '').trim()) return normalizeRelay(advanced);
  return parsed.relay;
}

/** The words on a row's button, by describeRow's action. */
export const ACTION_LABELS = { 'retry-now': 'Retry now', 'try-again': 'Try again' };

const TONES = { sending: 'busy', failed: 'busy', sent: 'sent', delivered: 'ok', expired: 'bad' };

/**
 * How a history row reads, in the words every Send to Daylight app uses (CHANGES-v1.1 2.5, from the protocol library's
 * describeRow): {label, tone, hint, action, retry}. hint is the sentence under the label ('' for none); retry is the
 * button's words ("Retry now" or "Try again"), or null when the row has no button. Every row can also be removed.
 */
export function statusInfo(row, now = Date.now()) {
  const d = describeRow(row, now);
  return { label: d.label, tone: TONES[row?.status] ?? 'sent', hint: d.sentence ?? '', action: d.action, retry: ACTION_LABELS[d.action] ?? null };
}

/** What to say after a share (CHANGES-v1.1 2.5): the row's label, then its sentence when it has one. */
export function rowMessage(row, now = Date.now()) {
  const d = describeRow(row, now);
  if (!d.label) return '';
  const label = /[.…✓]$/.test(d.label) ? d.label : `${d.label}.`;
  return d.sentence ? `${label} ${d.sentence}` : label;
}

/** True when a share's outcome is worth a warning: the item is not on its way (yet). */
export const isTrouble = (row) => row?.status === 'failed' || row?.status === 'expired';

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

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
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
export const isPending = (row) => row && (row.status === 'sending' || row.status === 'sent' || row.status === 'failed');

/**
 * How long after a share (`created`) an ack can still arrive: the outbox's 7 days of re-sends, then the 8 days the
 * Daylight keeps listing ids it received in its acks (DIGEST_WINDOW, CHANGES-v1.1 2.1). An expired row can still be
 * delivered in that time: the Daylight may come online and pick up the last re-send still on the relay.
 */
export const ACK_WINDOW_MS = OUTBOX_EXPIRY_MS + 8 * 86400000;

/** True while an ack is worth reading: some row isn't delivered and was shared less than ACK_WINDOW_MS ago. */
export const wantsAcks = (rows, now = Date.now()) =>
  (rows ?? []).some((r) => r && r.status !== 'delivered' && now - (r.created ?? 0) < ACK_WINDOW_MS);

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
