// The allow-list sanitizer for every HTML page the server makes from outside content (DESIGN.md 7.5), on HTMLRewriter.

import { publicUrl } from '../client/daylight-server.js';
import { decodeEntities } from './html.ts';

const KEEP = new Set([
  'p', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i',
  'u', 's', 'sub', 'sup', 'br', 'hr', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'figure',
  'figcaption', 'span', 'div',
]);

const DROP = new Set([
  'script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'svg',
  'math', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'audio', 'video', 'canvas', 'title',
  'xml', 'param', 'source', 'track', 'dialog',
]);

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;

export interface SanitizeOptions {
  /** Content-ID (without angle brackets, lowercased) -> data: URI, for cid: images in email. */
  cid?: Map<string, string>;
  /** Drop data: images (a page over the Reader's 8 MiB cap). */
  dropDataImages?: boolean;
}

function smallDimension(v: string | null): boolean {
  if (v === null) return false;
  const n = parseFloat(v);
  return Number.isFinite(n) && n <= 2;
}

/** Sanitized HTML (no doctype, no head content). */
export async function sanitize(html: string, opts: SanitizeOptions = {}): Promise<string> {
  const input = String(html ?? '').replace(/<!doctype[^>]*>/gi, '').replace(/<\?xml[^>]*>/gi, '');
  const rewriter = new HTMLRewriter()
    .on('*', {
      element(el) {
        const tag = el.tagName.toLowerCase();
        if (DROP.has(tag) || tag.includes(':')) { el.remove(); return; }
        if (!KEEP.has(tag)) { el.removeAndKeepContent(); return; }
        const attrs = [...el.attributes].map(([n, v]) => [n.toLowerCase(), v] as const);
        if (tag === 'img') {
          const get = (n: string) => attrs.find(([k]) => k === n)?.[1] ?? null;
          if (smallDimension(get('width')) || smallDimension(get('height'))) { el.remove(); return; }
          const raw = decodeEntities(get('src') ?? '').trim();
          let src: string | null = null;
          if (/^cid:/i.test(raw)) {
            src = opts.cid?.get(raw.slice(4).replace(/^<|>$/g, '').toLowerCase()) ?? null;
            if (src && opts.dropDataImages) src = null;
          } else if (/^data:/i.test(raw)) {
            src = !opts.dropDataImages && DATA_IMAGE.test(raw) ? raw.replace(/\s+/g, '') : null;
          } else {
            const p = publicUrl(raw);
            src = p && p.startsWith('https:') ? p : null;
          }
          if (!src) { el.remove(); return; }
          for (const [n] of attrs) el.removeAttribute(n);
          el.setAttribute('src', src);
          const alt = get('alt');
          if (alt !== null) el.setAttribute('alt', decodeEntities(alt).replace(/["<>]/g, ''));
          const title = get('title');
          if (title !== null) el.setAttribute('title', decodeEntities(title).replace(/["<>]/g, ''));
          return;
        }
        for (const [n, v] of attrs) {
          if (n === 'href' && tag === 'a') {
            const p = publicUrl(decodeEntities(v).trim());
            el.removeAttribute(n);
            if (p) el.setAttribute('href', p);
          } else if (n === 'title') {
            el.setAttribute('title', decodeEntities(v).replace(/["<>]/g, ''));
          } else if ((n === 'colspan' || n === 'rowspan') && (tag === 'td' || tag === 'th') && /^\d{1,3}$/.test(v.trim())) {
            el.setAttribute(n, v.trim());
          } else {
            el.removeAttribute(n);
          }
        }
      },
    })
    .onDocument({
      comments(c) { c.remove(); },
    });
  return rewriter.transform(new Response(input)).text();
}
