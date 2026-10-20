// The daily digest (DESIGN.md 8.3): one page item at the chosen local hour, from entries in digest state.

import { cleanName } from '../../share/js/daylight-share.js';
import { publicUrl } from '../client/daylight-server.js';
import type { Ctx } from './env.ts';
import type { Identity } from './keys.ts';
import { dayMonthTime, esc, localParts, longDate, shortDate, wrapPage } from './html.ts';
import { normalizeArticleUrl } from './feedparse.ts';
import { buildItem, storeManyStatements } from './outbox.ts';
import type { Settings } from './settings.ts';
import { digestSettings, saveStmt } from './settings.ts';

export interface DigestEntry {
  feed_id: string; key: string; url: string | null; title: string | null; author: string | null; published: number | null;
  excerpt: string | null; first_seen: number; feed_title: string | null;
}

/** True when the Cron should build the digest now: in the digest hour, and none went out for that local date. */
export function digestDue(s: Settings, now: number): { due: boolean; date: string; scheduled: boolean } {
  const d = digestSettings(s);
  const p = localParts(now, d.tz);
  const scheduled = p.hour === d.hour && s.digestLast !== p.date;
  return { due: scheduled || !!s.digestNow, date: p.date, scheduled };
}

/** The digest page (8.3). Every value is escaped and every link passes publicUrl. -> {html, used: entries included}. */
export function buildDigestHtml(entries: DigestEntry[], now: number, tz: string, maxBytes: number, maxArticles = 60): { html: string; title: string; used: DigestEntry[] } {
  const p = localParts(now, tz);
  const title = `Digest · ${shortDate(p)}`;
  const used: DigestEntry[] = [];
  const toc: string[] = [];
  const articles: string[] = [];
  const enc = new TextEncoder();
  let size = 2000;
  for (const e of entries) {
    if (used.length >= maxArticles) break;
    const n = used.length + 1;
    const feed = e.feed_title || 'Feed';
    const t = e.title || e.url || 'Untitled';
    const href = e.url ? publicUrl(e.url) : null;
    const when = dayMonthTime(localParts(e.published ?? e.first_seen, tz));
    const meta = [feed, e.author, when].filter(Boolean).map(esc).join(' · ');
    const li = `<li><a href="#a${n}">${esc(t)}</a> · ${esc(feed)}</li>`;
    const art = `<article id="a${n}"><h2>${href ? `<a href="${esc(href)}">${esc(t)}</a>` : esc(t)}</h2><p>${meta}</p>${e.excerpt ? `<p>${esc(e.excerpt)}</p>` : ''}</article>`;
    const add = enc.encode(li).byteLength + enc.encode(art).byteLength;
    if (size + add > maxBytes) break;
    size += add;
    toc.push(li); articles.push(art); used.push(e);
  }
  const feeds = new Set(used.map((e) => e.feed_id)).size;
  const body = `<h1>${esc(`Digest · ${longDate(p)}`)}</h1>\n<p>${used.length} new article${used.length === 1 ? '' : 's'} from ${feeds} feed${feeds === 1 ? '' : 's'}.</p>\n<ol>${toc.join('')}</ol>\n${articles.join('\n')}`;
  const html = wrapPage({ title, source: 'digest' }, body, 'en');
  return { html, title, used };
}

/** Cron step (and "Send digest now"): builds and stores the digest. -> the number of articles in it. */
export async function runDigest(ctx: Ctx, id: Identity, s: Settings): Promise<number> {
  const due = digestDue(s, ctx.now);
  if (!due.due) return 0;
  const d = digestSettings(s);
  const rows = await ctx.db.all<DigestEntry>(
    `SELECT e.feed_id, e.key, e.url, e.title, e.author, e.published, e.excerpt, e.first_seen, f.title AS feed_title
     FROM entries e JOIN feeds f ON f.id = e.feed_id WHERE e.state = 'digest' ORDER BY e.first_seen DESC LIMIT 200`,
  );
  if (!rows.length) {
    if (s.digestNow) { await ctx.db.batch([saveStmt(ctx, { digestNow: false })]); s.digestNow = false; }
    return 0;
  }
  // Newest first for the selection, listed oldest first; articles in several feeds are listed once.
  const byUrl = new Set<string>();
  const unique: DigestEntry[] = [];
  const dupes: DigestEntry[] = [];
  for (const r of rows) {
    const k = normalizeArticleUrl(r.url);
    if (k && byUrl.has(k)) { dupes.push(r); continue; }
    if (k) byUrl.add(k);
    unique.push(r);
  }
  const chosen = unique.slice(0, ctx.limits.digestMax).reverse();
  const { html, title, used } = buildDigestHtml(chosen, ctx.now, d.tz, ctx.caps.digestBytes, ctx.limits.digestMax);
  const origin = due.scheduled && !s.digestNow ? `digest:${due.date}` : `digest:${due.date}:${ctx.now}`;
  const built = await buildItem(id, {
    origin, kind: 'page', title, content: html, from: cleanName('Digest'), xOrigin: 'digest',
  });
  const done = [...used, ...dupes].map((e) => ({ feed: e.feed_id, key: e.key }));
  const change: Partial<Settings> = { digestNow: false };
  if (due.scheduled) change.digestLast = due.date;
  await ctx.db.batch([
    ...storeManyStatements(ctx, id.values.fingerprint, [built]),
    ctx.db.stmt(
      `UPDATE entries SET state = 'digested', item_id = ?1
       FROM (SELECT json_extract(value, '$.feed') AS feed, json_extract(value, '$.key') AS key FROM json_each(?2)) AS j
       WHERE entries.feed_id = j.feed AND entries.key = j.key`,
      built.id, JSON.stringify(done),
    ),
    // Anything beyond the digest is skipped, never carried forward.
    ctx.db.stmt(`UPDATE entries SET state = 'skipped' WHERE state = 'digest' AND first_seen <= ?`, ctx.now),
    saveStmt(ctx, change),
  ]);
  Object.assign(s, change);
  return used.length;
}
