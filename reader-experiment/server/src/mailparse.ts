// Pure helpers for email-in (DESIGN.md 7.2-7.4): the header block, DMARC from Cloudflare's own
// Authentication-Results, the "view in browser" link, subjects and sender addresses.

import { publicUrl } from '../client/daylight-server.js';
import { decodeEntities, plainText } from './html.ts';

/** Cloudflare Email Routing's authserv-id in the Authentication-Results it prepends. */
export const CLOUDFLARE_AUTHSERV = 'mx.cloudflare.net';

/** The header block (up to the first empty line) -> [{name, value}] in order, folded lines joined. */
export function parseHeaderBlock(block: string): { name: string; value: string }[] {
  const end = block.search(/\r?\n\r?\n/);
  const head = end >= 0 ? block.slice(0, end) : block;
  const out: { name: string; value: string }[] = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length) { out[out.length - 1].value += ' ' + line.trim(); continue; }
    const i = line.indexOf(':');
    if (i <= 0) continue;
    out.push({ name: line.slice(0, i).trim().toLowerCase(), value: line.slice(i + 1).trim() });
  }
  return out;
}

/**
 * DMARC result from the topmost Authentication-Results header, only when its authserv-id is Cloudflare's. A sender's
 * own header lower in the message is ignored. -> 'pass' | 'fail' | 'none' | other result word | null (no verdict).
 */
export function dmarcFromHeaders(headers: { name: string; value: string }[]): string | null {
  const top = headers.find((h) => h.name === 'authentication-results');
  if (!top) return null;
  const authserv = top.value.split(';')[0].trim().split(/\s+/)[0].toLowerCase();
  if (authserv !== CLOUDFLARE_AUTHSERV) return null;
  const m = /(?:^|[;\s])dmarc\s*=\s*([a-z]+)/i.exec(top.value);
  return m ? m[1].toLowerCase() : null;
}

/** "Re: Fwd: Weekly" -> "Weekly". */
export function cleanSubject(s: string | undefined | null): string {
  let t = String(s ?? '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 5; i++) {
    const next = t.replace(/^(re|fwd?|fw|aw|wg|sv|vs)\s*(\[\d+\])?\s*:\s*/i, '');
    if (next === t) break;
    t = next;
  }
  return t;
}

/** "Alice <ALICE@Example.com>" -> {address: 'alice@example.com', domain: 'example.com', name: 'Alice'}. */
export function parseFrom(value: string | null | undefined): { address: string; domain: string; name: string } {
  const v = String(value ?? '').trim();
  const angle = /<([^<>@\s]+@[^<>\s]+)>/.exec(v);
  const bare = /([^\s<>"',;:]+@[^\s<>"',;:]+)/.exec(v);
  const address = (angle?.[1] ?? bare?.[1] ?? '').toLowerCase();
  let name = angle ? v.slice(0, angle.index).trim() : '';
  name = name.replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim();
  const domain = address.includes('@') ? address.slice(address.lastIndexOf('@') + 1) : '';
  return { address, domain, name };
}

/** Block list patterns that match an address: the address itself, @domain and @each parent domain. */
export function blockPatterns(address: string): string[] {
  const a = address.toLowerCase();
  const at = a.lastIndexOf('@');
  if (at < 0) return [a];
  const out = [a];
  const labels = a.slice(at + 1).split('.');
  for (let i = 0; i < labels.length - 1; i++) out.push('@' + labels.slice(i).join('.'));
  return out;
}

/** A block list pattern from user input: 'alice@example.com' or '@example.com'. -> normalized or null. */
export function normalizePattern(p: unknown): string | null {
  const s = String(p ?? '').trim().toLowerCase();
  if (s.length > 254) return null;
  if (/^@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return s;
  if (/^[^\s@<>"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return s;
  return null;
}

const VIEW_RE = /\b(view|read|open|see)\b.{0,40}\b(in (your |a |the )?(web )?browser|online|on (the )?web|as a web ?page)\b/;
const VIEW_EXACT = /^(web version|view online|online version|view (this )?(post|issue|email|newsletter))$/;
const TRACKING = /^(utm_.*|mc_.*|fbclid|gclid)$/i;

/** Removes utm_*, mc_*, fbclid and gclid parameters. */
export function stripTracking(u: string): string {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (TRACKING.test(k)) url.searchParams.delete(k);
    return url.href;
  } catch { return u; }
}

/** The newsletter's "view in browser" link among its first 60 anchors, or null (7.4). */
export function findViewInBrowser(html: string): string | null {
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let n = 0;
  for (let m = re.exec(html); m && n < 60; m = re.exec(html), n++) {
    const hrefM = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
    if (!hrefM) continue;
    const href = decodeEntities(hrefM[2] ?? hrefM[3] ?? hrefM[4] ?? '').trim();
    const text = plainText(m[2].slice(0, 20_000), 200).toLowerCase();
    if (!VIEW_RE.test(text) && !VIEW_EXACT.test(text)) continue;
    if (/unsubscribe|preferences|manage|mailto:/i.test(href)) continue;
    const p = publicUrl(href);
    if (p) return publicUrl(stripTracking(p));
  }
  return null;
}

export const DOC_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  'text/plain': 'txt',
  'text/html': 'html',
};

const DOC_EXT: Record<string, string> = {
  pdf: 'application/pdf', epub: 'application/epub+zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', html: 'text/html', htm: 'text/html',
};

/** A document attachment's MIME type by MIME type or file extension, or null for anything else. */
export function documentMime(mime: string | null | undefined, filename: string | null | undefined): string | null {
  const m = String(mime ?? '').toLowerCase().split(';')[0].trim();
  if (DOC_TYPES[m]) return m === 'text/x-markdown' ? 'text/markdown' : m;
  const ext = /\.([a-z0-9]{1,8})$/i.exec(String(filename ?? ''))?.[1]?.toLowerCase();
  return ext && DOC_EXT[ext] ? DOC_EXT[ext] : null;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${Math.round(bytes / 100_000) / 10} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
