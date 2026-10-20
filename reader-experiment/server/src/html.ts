// Generated HTML (DESIGN.md 7.5 escaping rule): every interpolated value is escaped, every href/src passes publicUrl.

import { publicUrl } from '../client/daylight-server.js';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text and double-quoted attribute values. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** An href/src attribute value, or '' when the URL is not public. */
export function safeHref(u: unknown): string {
  const p = publicUrl(String(u ?? ''));
  return p ? esc(p) : '';
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™',
  middot: '·', bull: '•', laquo: '«', raquo: '»', zwnj: '‌', zwj: '‍', shy: '­',
};

/** Decodes the predefined, common named and numeric character references (never anything recursive). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});?/gi, (m, ref: string) => {
    if (ref[0] === '#') {
      const n = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�';
      return String.fromCodePoint(n);
    }
    const v = NAMED[ref.toLowerCase()];
    return v ?? m;
  });
}

/** Tags removed, entities decoded, whitespace collapsed. For excerpts and anchor text. */
export function plainText(html: string, max = Infinity): string {
  const noTags = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ');
  const t = decodeEntities(noTags).replace(/\s+/g, ' ').trim();
  return t.length > max ? [...t].slice(0, max).join('') : t;
}

/** Markdown from the model -> HTML with paragraphs, lists, bold and italic only; everything else is escaped. */
export function renderMarkdown(md: string): string {
  const inline = (s: string) => esc(s)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em>$2</em>');
  const out: string[] = [];
  const blocks = String(md ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const raw of blocks) {
    const lines = raw.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-*+•]\s+/.test(l))) {
      out.push('<ul>' + lines.map((l) => `<li>${inline(l.replace(/^\s*[-*+•]\s+/, ''))}</li>`).join('') + '</ul>');
    } else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      out.push('<ol>' + lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('') + '</ol>');
    } else {
      out.push(`<p>${lines.map((l) => inline(l.replace(/^\s*#{1,6}\s+/, ''))).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}

export interface PageMeta { title: string; author?: string; published?: string; source: string }

/** The wrapper every server page uses (7.4); `bodyHtml` is already sanitized or generated with escaping. */
export function wrapPage(meta: PageMeta, bodyHtml: string, lang = ''): string {
  const head = [
    '<meta charset="utf-8">',
    `<title>${esc(meta.title)}</title>`,
    meta.author ? `<meta name="author" content="${esc(meta.author)}">` : '',
    meta.published ? `<meta property="article:published_time" content="${esc(meta.published)}">` : '',
    `<meta name="dl:source" content="${esc(meta.source)}">`,
  ].filter(Boolean).join('');
  const l = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(lang) ? ` lang="${esc(lang)}"` : '';
  return `<!doctype html><html${l}><head>${head}</head><body>${bodyHtml}</body></html>`;
}

/** Plain text (an email without HTML) -> HTML paragraphs with public URLs linked. */
export function textToHtml(text: string): string {
  const paras = String(text ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  return paras.map((p) => p.trim()).filter(Boolean).map((p) => {
    const parts: string[] = [];
    let last = 0;
    const re = /https?:\/\/[^\s<>"')\]]+/gi;
    for (let m = re.exec(p); m; m = re.exec(p)) {
      const raw = m[0].replace(/[.,;:!?]+$/, '');
      parts.push(esc(p.slice(last, m.index)).replace(/\n/g, '<br>'));
      const href = safeHref(raw);
      parts.push(href ? `<a href="${href}">${esc(raw)}</a>` : esc(raw));
      last = m.index + raw.length;
      re.lastIndex = last;
    }
    parts.push(esc(p.slice(last)).replace(/\n/g, '<br>'));
    return `<p>${parts.join('')}</p>`;
  }).join('\n');
}

export function hostOf(u: string | null | undefined): string {
  try { return u ? new URL(u).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Local date parts in a time zone. */
export function localParts(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const year = Number(p.year), month = Number(p.month), day = Number(p.day);
  const weekday = DAYS.indexOf(p.weekday);
  return {
    year, month, day, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday,
    date: `${p.year}-${p.month}-${p.day}`,
  };
}

export const shortDate = (p: ReturnType<typeof localParts>) => `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}`;
export const longDate = (p: ReturnType<typeof localParts>) => `${DAYS_LONG[p.weekday]} ${p.day} ${MONTHS_LONG[p.month - 1]}`;
export const dayMonthTime = (p: ReturnType<typeof localParts>) =>
  `${p.day} ${MONTHS[p.month - 1]}, ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
