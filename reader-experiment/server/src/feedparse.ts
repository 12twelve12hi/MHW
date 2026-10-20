// A small dependency-free feed scanner (DESIGN.md 8.2): RSS 2.0, RSS 1.0 (RDF), Atom 1.0 and JSON Feed 1.x.
// <!DOCTYPE> and <!ENTITY> are ignored entirely; only the five predefined XML entities and numeric references are
// expanded, so there is no entity expansion and no billion-laughs. At most 100 entries per document.

import { plainText } from './html.ts';

export interface FeedEntry {
  id: string;
  url: string | null;
  title: string;
  author: string;
  published: number | null;
  excerpt: string;
}

export interface ParsedFeed {
  format: 'rss' | 'rdf' | 'atom' | 'json';
  title: string;
  site: string | null;
  entries: FeedEntry[];
}

export const MAX_ENTRIES = 100;

/** Decodes feed bytes, honouring an XML encoding declaration or a charset. */
export function decodeFeed(bytes: Uint8Array, contentType = ''): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const declared = /encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1] ?? /charset=([A-Za-z0-9._-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(declared && !/^utf-?8$/i.test(declared) ? declared : 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Only &lt; &gt; &amp; &quot; &apos; and numeric references. */
export function xmlDecode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);/g, (_, r: string) => {
    switch (r) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const n = r[1] === 'x' ? parseInt(r.slice(2), 16) : parseInt(r.slice(1), 10);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�';
      }
    }
  });
}

/** Removes the DOCTYPE (with its internal subset), comments and processing instructions. */
export function stripProlog(xml: string): string {
  return xml
    .replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');
}

/** Inner text of an element's content: CDATA unwrapped, XML entities decoded. */
function textOf(inner: string): string {
  let out = '';
  let rest = inner;
  for (;;) {
    const i = rest.indexOf('<![CDATA[');
    if (i < 0) { out += xmlDecode(rest); break; }
    out += xmlDecode(rest.slice(0, i));
    const j = rest.indexOf(']]>', i + 9);
    if (j < 0) { out += rest.slice(i + 9); break; }
    out += rest.slice(i + 9, j);
    rest = rest.slice(j + 3);
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function element(xml: string, names: string[]): { attrs: string; inner: string } | null {
  for (const n of names) {
    const re = new RegExp(`<${esc(n)}(\\s[^>]*)?(/>|>([\\s\\S]*?)</${esc(n)}\\s*>)`, 'i');
    const m = re.exec(xml);
    if (m) return { attrs: m[1] ?? '', inner: m[3] ?? '' };
  }
  return null;
}

function elements(xml: string, name: string, max: number): { attrs: string; inner: string }[] {
  const re = new RegExp(`<${esc(name)}(\\s[^>]*)?(/>|>([\\s\\S]*?)</${esc(name)}\\s*>)`, 'gi');
  const out: { attrs: string; inner: string }[] = [];
  for (let m = re.exec(xml); m && out.length < max; m = re.exec(xml)) out.push({ attrs: m[1] ?? '', inner: m[3] ?? '' });
  return out;
}

export function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${esc(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m ? xmlDecode(m[2] ?? m[3] ?? '') : null;
}

const text = (xml: string, names: string[]) => {
  const e = element(xml, names);
  return e ? textOf(e.inner).trim() : '';
};

function parseDate(s: string): number | null {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : null;
}

function resolve(u: string | null | undefined, base: string): string | null {
  if (!u) return null;
  try { return new URL(u.trim(), base).href; } catch { return null; }
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? [...t].slice(0, n).join('').trim() : t;
}

function excerptOf(html: string): string { return plainText(html.slice(0, 200_000), 600); }

function atomLink(xml: string, base: string): string | null {
  let fallback: string | null = null;
  for (const l of elements(xml, 'link', 20)) {
    const rel = (attr(l.attrs, 'rel') ?? 'alternate').toLowerCase();
    const href = attr(l.attrs, 'href');
    if (!href) continue;
    if (rel === 'alternate') return resolve(href, base);
    fallback ??= rel === 'self' ? null : resolve(href, base);
  }
  return fallback;
}

/** Parses a feed document. -> ParsedFeed, or null when it is not a feed. */
export function parseFeed(body: string, baseUrl: string): ParsedFeed | null {
  const trimmed = body.replace(/^﻿/, '').trimStart();
  if (trimmed.startsWith('{')) return parseJsonFeed(trimmed, baseUrl);
  const xml = stripProlog(trimmed);
  const root = (/<([A-Za-z][\w:.-]*)/.exec(xml)?.[1] ?? '').toLowerCase();
  const rootRss = root === 'rss';
  const rootRdf = root === 'rdf:rdf';
  const rootAtom = root === 'feed';
  if (rootAtom) {
    const firstEntry = xml.search(/<entry[\s>]/i);
    const headXml = firstEntry >= 0 ? xml.slice(0, firstEntry) : xml;
    const entries = elements(xml, 'entry', MAX_ENTRIES).map((e) => {
      const url = atomLink(e.inner, baseUrl);
      const title = clip(plainText(text(e.inner, ['title'])), 300);
      const authorEl = element(e.inner, ['author']);
      const author = clip(authorEl ? text(authorEl.inner, ['name']) || textOf(authorEl.inner) : '', 100);
      const published = parseDate(text(e.inner, ['published', 'updated', 'issued', 'modified']));
      const id = text(e.inner, ['id']);
      const excerpt = excerptOf(text(e.inner, ['summary', 'content']));
      return { id, url, title, author, published, excerpt };
    });
    return { format: 'atom', title: clip(plainText(text(headXml, ['title'])), 300), site: atomLink(headXml, baseUrl), entries };
  }
  if (rootRss || rootRdf) {
    const firstItem = xml.search(/<item[\s>]/i);
    const headXml = firstItem >= 0 ? xml.slice(0, firstItem) : xml;
    const channel = element(headXml, ['channel'])?.inner ?? headXml;
    const entries = elements(xml, 'item', MAX_ENTRIES).map((e) => {
      const link = text(e.inner, ['link']) || (attr(element(e.inner, ['link'])?.attrs ?? '', 'href') ?? '');
      const guidEl = element(e.inner, ['guid']);
      const guid = guidEl ? textOf(guidEl.inner).trim() : '';
      const guidIsLink = guidEl && (attr(guidEl.attrs, 'isPermaLink') ?? 'true').toLowerCase() !== 'false' && /^https?:\/\//i.test(guid);
      const url = resolve(link || (guidIsLink ? guid : ''), baseUrl);
      const title = clip(plainText(text(e.inner, ['title'])), 300);
      const author = clip(text(e.inner, ['dc:creator', 'author']), 100);
      const published = parseDate(text(e.inner, ['pubDate', 'dc:date', 'published']));
      const id = guid || attr(e.attrs, 'rdf:about') || '';
      const excerpt = excerptOf(text(e.inner, ['description', 'content:encoded', 'summary']));
      return { id, url, title, author, published, excerpt };
    });
    const site = resolve(text(channel, ['link']), baseUrl);
    return { format: rootRdf ? 'rdf' : 'rss', title: clip(plainText(text(channel, ['title'])), 300), site, entries };
  }
  return null;
}

function parseJsonFeed(body: string, baseUrl: string): ParsedFeed | null {
  let j: Record<string, unknown>;
  try { j = JSON.parse(body); } catch { return null; }
  if (!j || typeof j !== 'object' || !String(j.version ?? '').includes('jsonfeed.org')) return null;
  const items = Array.isArray(j.items) ? j.items.slice(0, MAX_ENTRIES) : [];
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const entries = items.filter((i) => i && typeof i === 'object').map((i: Record<string, unknown>) => {
    const authors = Array.isArray(i.authors) ? i.authors : i.author ? [i.author] : [];
    const a = authors.find((x: unknown) => x && typeof x === 'object') as Record<string, unknown> | undefined;
    return {
      id: str(i.id) || (typeof i.id === 'number' ? String(i.id) : ''),
      url: resolve(str(i.url) || str(i.external_url), baseUrl),
      title: clip(str(i.title), 300),
      author: clip(str(a?.name), 100),
      published: parseDate(str(i.date_published) || str(i.date_modified)),
      excerpt: str(i.summary) ? clip(str(i.summary), 600) : excerptOf(str(i.content_html) || str(i.content_text)),
    };
  });
  return { format: 'json', title: clip(str(j.title), 300), site: resolve(str(j.home_page_url), baseUrl), entries };
}

/** <link rel="alternate" type="application/rss+xml|atom+xml|feed+json" href> in an HTML page, resolved. */
export function discoverFeed(html: string, baseUrl: string): string | null {
  const head = html.slice(0, 512 * 1024);
  const re = /<link\b([^>]*)>/gi;
  for (let m = re.exec(head); m; m = re.exec(head)) {
    const rel = (attr(m[1], 'rel') ?? '').toLowerCase().split(/\s+/);
    const type = (attr(m[1], 'type') ?? '').toLowerCase();
    if (!rel.includes('alternate')) continue;
    if (!/^application\/(rss\+xml|atom\+xml|feed\+json)$/.test(type)) continue;
    const href = attr(m[1], 'href');
    const u = resolve(href ? href.replace(/&amp;/g, '&') : null, baseUrl);
    if (u) return u;
  }
  return null;
}

/** OPML -> [{url, title}] from outline xmlUrl attributes. */
export function parseOpml(xml: string): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  const re = /<outline\b([^>]*)>/gi;
  const clean = stripProlog(xml);
  for (let m = re.exec(clean); m && out.length < 1000; m = re.exec(clean)) {
    const url = attr(m[1], 'xmlUrl') ?? attr(m[1], 'xmlurl');
    if (!url) continue;
    out.push({ url: url.trim(), title: clip(attr(m[1], 'title') ?? attr(m[1], 'text') ?? '', 300) });
  }
  return out;
}

/** The URL key for de-duplicating articles across feeds (8.3). */
export function normalizeArticleUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    for (const k of [...url.searchParams.keys()]) if (/^(utm_.*|fbclid|gclid)$/i.test(k)) url.searchParams.delete(k);
    return url.href.replace(/\/+$/, '').replace(/\/(\?)/, '$1');
  } catch { return null; }
}
