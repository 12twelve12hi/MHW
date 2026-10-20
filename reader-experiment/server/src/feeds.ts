// Feeds (DESIGN.md 8.1, 8.2, 8.3 'each' mode): managing, checking on a schedule, and sending new articles.

import { cleanName } from '../../share/js/daylight-share.js';
import { publicUrl } from '../client/daylight-server.js';
import type { Ctx } from './env.ts';
import { HOUR, KiB, MiB, iso, logCode, randomHex, testKillPoint } from './env.ts';
import type { Identity } from './keys.ts';
import { ServerError, json, empty } from './errors.ts';
import { decodeFeed, discoverFeed, parseFeed, parseOpml } from './feedparse.ts';
import type { FeedEntry, ParsedFeed } from './feedparse.ts';
import { checkFetchUrl, resolvesPublic, safeFetch } from './safefetch.ts';
import { buildItem, storeManyStatements } from './outbox.ts';
import type { Settings } from './settings.ts';
import { d1Paused, digestSettings } from './settings.ts';
import { localParts } from './html.ts';

export interface FeedRow {
  id: string; url: string; title: string | null; site: string | null; mode: 'each' | 'digest'; etag: string | null;
  last_modified: string | null; next_check: number; last_check: number | null; last_ok: number | null; errors: number;
  last_error: string | null; floods: number; paused: number; new_day: string | null; new_today: number; created: number;
  checked_by_user: number; sent_today?: number;
}

const FEED_TIMEOUT = 15_000;
const CHECK_INTERVAL = HOUR;
const FLOOD_FOUND = 50;
const FLOOD_RUNS = 3;
/** A check interrupted (CPU) after this many failed checks in a row pauses the feed with SERVER_LIMIT (2.2 rule 5). */
const KILLED_PAUSE_AFTER = 3;
/** Hosts resolved per run before 'each' url items are written (2 DoH subrequests each). */
const EACH_HOSTS_PER_RUN = 4;

/** Feed bytes: 1 MiB per feed and per Cron run on Free (the 10 ms rule), 2 MiB per feed on Paid (8.2). */
export function feedCaps(ctx: Ctx) {
  return ctx.plan === 'paid' ? { perFeed: 2 * MiB, perRun: 6 * MiB } : { perFeed: MiB, perRun: MiB };
}

/** The wait after `errors` failed checks in a row: 1 h × 2^errors, at most 24 h. */
const backoff = (errors: number) => Math.min(24 * HOUR, CHECK_INTERVAL * 2 ** Math.min(errors, 10));

export function feedJson(f: FeedRow) {
  return {
    id: f.id, url: f.url, title: f.title ?? '', site: f.site, mode: f.mode, paused: !!f.paused,
    lastCheck: f.last_check ? iso(f.last_check) : null, lastOk: f.last_ok ? iso(f.last_ok) : null,
    lastError: f.last_error, errors: f.errors, created: iso(f.created), sentToday: f.sent_today ?? 0,
  };
}

const selfHost = (id: Identity) => { try { return id.serverUrl ? new URL(id.serverUrl).hostname : ''; } catch { return ''; } };

async function entryKey(feedId: string, e: FeedEntry): Promise<string> {
  const basis = e.id || e.url || `${e.title}${e.published ?? ''}`;
  const data = new TextEncoder().encode(`${feedId}\u0000${basis}`);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fetches and parses a feed URL; an HTML page is searched for its feed link once. */
async function fetchFeed(ctx: Ctx, id: Identity, url: string, headers: Record<string, string> = {}, discover = false, maxBytes = feedCaps(ctx).perFeed):
  Promise<{ url: string; status: number; feed: ParsedFeed | null; etag: string | null; lastModified: string | null; bytes: number }> {
  const res = await safeFetch(ctx.fetch, url, { maxBytes, timeoutMs: FEED_TIMEOUT, headers, selfHost: selfHost(id) });
  if (res.status === 304) return { url: res.url, status: 304, feed: null, etag: null, lastModified: null, bytes: 0 };
  if (res.status < 200 || res.status >= 300) throw new ServerError(502, 'FETCH_FAILED');
  const text = decodeFeed(res.body, res.headers.get('Content-Type') ?? '');
  const feed = parseFeed(text, res.url);
  if (!feed && discover) {
    const found = discoverFeed(text, res.url);
    if (found) return fetchFeed(ctx, id, found, {}, false, maxBytes);
  }
  return { url: res.url, status: res.status, feed, etag: res.headers.get('ETag'), lastModified: res.headers.get('Last-Modified'), bytes: res.body.byteLength };
}

/**
 * Checks one feed and returns the statements that record the result (8.2). New keys are found with one statement and
 * inserted with one; at most 20 new entries per check and 100 per feed per day; a feed that keeps flooding is paused.
 */
export async function checkFeed(ctx: Ctx, id: Identity, f: FeedRow, s: Settings, maxBytes = feedCaps(ctx).perFeed):
  Promise<{ stmts: D1PreparedStatement[]; found: number; recorded: number; bytes: number; deferred?: boolean }> {
  const today = localParts(ctx.now, digestSettings(s).tz).date;
  const fail = (code: string) => {
    const errors = f.errors + 1;
    logCode(ctx, `FEED_${code}`);
    return {
      stmts: [ctx.db.stmt(`UPDATE feeds SET errors = ?, last_error = ?, last_check = ?, next_check = ? WHERE id = ?`, errors, code, ctx.now, ctx.now + backoff(errors), f.id)],
      found: 0, recorded: 0, bytes: 0,
    };
  };
  let got;
  try {
    const headers: Record<string, string> = {};
    if (f.etag && f.last_ok) headers['If-None-Match'] = f.etag;
    if (f.last_modified && f.last_ok) headers['If-Modified-Since'] = f.last_modified;
    got = await fetchFeed(ctx, id, f.url, headers, false, maxBytes);
  } catch (e) {
    if ((e as Error)?.name === 'BudgetError') throw e;
    // Over what is left of this run's parse budget, not over the feed cap: the next run checks it first.
    if (e instanceof ServerError && e.code === 'TOO_LARGE' && maxBytes < feedCaps(ctx).perFeed) return { stmts: [], found: 0, recorded: 0, bytes: 0, deferred: true };
    return fail(e instanceof ServerError ? e.code : 'FETCH_FAILED');
  }
  if (got.status === 304) {
    return {
      stmts: [ctx.db.stmt(`UPDATE feeds SET errors = 0, last_error = CASE WHEN last_error = 'FEED_FLOOD' THEN last_error END, last_check = ?, last_ok = ?, next_check = ? WHERE id = ?`,
        ctx.now, ctx.now, ctx.now + CHECK_INTERVAL, f.id)],
      found: 0, recorded: 0, bytes: 0,
    };
  }
  if (!got.feed) return fail('FEED_INVALID');
  const keyed: { key: string; e: FeedEntry }[] = [];
  const seen = new Set<string>();
  for (const e of got.feed.entries) {
    const key = await entryKey(f.id, e);
    if (seen.has(key)) continue;
    seen.add(key);
    keyed.push({ key, e });
  }
  const existing = new Set((await ctx.db.all<{ key: string }>(
    'SELECT key FROM entries WHERE feed_id = ? AND key IN (SELECT value FROM json_each(?))', f.id, JSON.stringify(keyed.map((k) => k.key)),
  )).map((r) => r.key));
  const fresh = keyed.filter((k) => !existing.has(k.key));
  const firstCheck = !f.last_ok;
  const floods = !firstCheck && fresh.length > FLOOD_FOUND ? f.floods + 1 : 0;
  const pause = floods >= FLOOD_RUNS;
  const newToday = f.new_day === today ? f.new_today : 0;
  // Past 400 MB of D1 no entries are recorded (11.1); a first check then records its baseline once that lifts.
  const storagePaused = d1Paused(ctx, s);
  const room = storagePaused ? 0 : firstCheck ? fresh.length : Math.max(0, Math.min(ctx.limits.feedNewPerCheck, ctx.limits.feedNewPerDay - newToday));
  const take = fresh.slice(0, room);
  const rows = take.map(({ key, e }) => {
    const url = publicUrl(e.url ?? '');
    const state = firstCheck ? 'baseline' : f.mode === 'each' && url ? 'pending' : 'digest';
    return firstCheck
      ? { key, url: null, title: null, author: null, published: null, excerpt: null, state }
      : { key, url, title: e.title || null, author: e.author || null, published: e.published, excerpt: e.excerpt || null, state };
  });
  const stmts: D1PreparedStatement[] = [];
  if (rows.length) {
    stmts.push(ctx.db.stmt(
      `INSERT OR IGNORE INTO entries (feed_id, key, url, title, author, published, excerpt, first_seen, state)
       SELECT ?1, json_extract(value, '$.key'), json_extract(value, '$.url'), json_extract(value, '$.title'),
         json_extract(value, '$.author'), json_extract(value, '$.published'), json_extract(value, '$.excerpt'), ?2,
         json_extract(value, '$.state') FROM json_each(?3)`,
      f.id, ctx.now, JSON.stringify(rows),
    ));
  }
  stmts.push(ctx.db.stmt(
    `UPDATE feeds SET etag = ?, last_modified = ?, last_check = ?, last_ok = ?, errors = 0, next_check = ?, floods = ?,
       paused = CASE WHEN ? THEN 1 ELSE paused END, last_error = CASE WHEN ? THEN 'FEED_FLOOD' WHEN last_error = 'FEED_FLOOD' THEN last_error END,
       new_day = ?, new_today = ?, title = COALESCE(NULLIF(title, ''), ?), site = COALESCE(site, ?) WHERE id = ?`,
    got.etag, got.lastModified, ctx.now, storagePaused && firstCheck ? null : ctx.now, ctx.now + CHECK_INTERVAL, floods, pause ? 1 : 0, pause ? 1 : 0,
    today, firstCheck ? newToday : newToday + rows.length, got.feed.title || null, publicUrl(got.feed.site ?? ''), f.id,
  ));
  if (pause) logCode(ctx, 'FEED_FLOOD');
  return { stmts, found: fresh.length, recorded: firstCheck ? 0 : rows.length, bytes: got.bytes };
}

/**
 * Cron step: up to 3 due feeds, oldest first, with at most 1 MiB of feed text parsed per run on Free (8.2).
 * Every check is counted before it starts (2.2 rule 5): errors + 1, the next check backed off and last_error
 * SERVER_LIMIT, all undone by the check's own result. A check Cloudflare ends for CPU therefore backs off like any
 * other failure instead of staying first in line on every run, and after 3 failed checks in a row ending in one that
 * was cut short the feed is paused with SERVER_LIMIT, which the apps show.
 */
export async function checkDueFeeds(ctx: Ctx, id: Identity, s: Settings): Promise<number | string> {
  if (d1Paused(ctx, s)) return 'paused';
  const caps = feedCaps(ctx);
  const due = await ctx.db.all<FeedRow>('SELECT * FROM feeds WHERE paused = 0 AND next_check <= ? ORDER BY next_check LIMIT 3', ctx.now);
  let parsed = 0, checked = 0;
  for (const f of due) {
    const room = Math.min(caps.perFeed, caps.perRun - parsed);
    if (room < 64 * KiB) break;
    const claim = await ctx.db.first<{ paused: number }>(
      `UPDATE feeds SET errors = errors + 1, last_check = ?1, next_check = ?2, last_error = 'SERVER_LIMIT',
         paused = CASE WHEN last_error = 'SERVER_LIMIT' AND errors >= ?3 THEN 1 ELSE paused END
       WHERE id = ?4 AND paused = 0 AND next_check = ?5 RETURNING paused`,
      ctx.now, ctx.now + backoff(f.errors + 1), KILLED_PAUSE_AFTER, f.id, f.next_check,
    );
    if (!claim) continue; // an overlapping run has it
    if (claim.paused) { logCode(ctx, 'FEED_SERVER_LIMIT'); continue; }
    testKillPoint(ctx.env, 'feed-check');
    const r = await checkFeed(ctx, id, f, s, room);
    if (r.deferred) {
      await ctx.db.batch([ctx.db.stmt(
        'UPDATE feeds SET errors = ?, last_error = ?, last_check = ?, next_check = ? WHERE id = ?', f.errors, f.last_error, f.last_check, f.next_check, f.id,
      )]);
      break;
    }
    await ctx.db.batch(r.stmts);
    parsed += r.bytes; checked++;
  }
  return checked;
}

/** Cron step: pending entries of 'each' feeds become url items, within 10 per feed and 60 per day (8.1). */
export async function sendEachItems(ctx: Ctx, id: Identity, s: Settings): Promise<number> {
  const tz = digestSettings(s).tz;
  const today = localParts(ctx.now, tz).date;
  const rows = await ctx.db.all<{ feed_id: string; key: string; url: string | null; title: string | null; mode: string; feed_title: string | null; feed_sent: number; all_sent: number }>(
    `SELECT e.feed_id, e.key, e.url, e.title, f.mode, f.title AS feed_title,
       (SELECT COUNT(*) FROM entries x WHERE x.feed_id = e.feed_id AND x.state = 'sent' AND x.sent_day = ?1) AS feed_sent,
       COALESCE((SELECT n FROM usage WHERE day = ?1 AND kind = 'feed_items'), 0) AS all_sent
     FROM entries e JOIN feeds f ON f.id = e.feed_id WHERE e.state = 'pending' ORDER BY e.first_seen LIMIT 8`,
    today,
  );
  if (!rows.length) return 0;
  let allSent = rows[0].all_sent;
  const perFeed = new Map<string, number>();
  const updates: { feed: string; key: string; state: string; item: string | null }[] = [];
  const built = [];
  // The DC-1 fetches a url item itself, from inside the home network (9.7). publicUrl only sees the name, so the host
  // must also resolve, in public DNS, to public addresses only: 192.168.1.1.nip.io or a name that exists only on the
  // LAN (fritz.box) goes to the digest as a link instead.
  const hosts = new Map<string, boolean>();
  for (const r of rows) {
    const sentFeed = perFeed.get(r.feed_id) ?? r.feed_sent;
    const url = r.url ? publicUrl(r.url) : null;
    if (r.mode !== 'each' || !url || sentFeed >= ctx.limits.feedItemsPerFeedDay || allSent >= ctx.limits.feedItemsPerDay) {
      updates.push({ feed: r.feed_id, key: r.key, state: 'digest', item: null });
      continue;
    }
    const host = new URL(url).hostname;
    if (!hosts.has(host)) {
      if (hosts.size >= EACH_HOSTS_PER_RUN) continue; // stays pending for the next run
      hosts.set(host, await resolvesPublic(ctx.fetch, host));
    }
    if (!hosts.get(host)) {
      logCode(ctx, 'FEED_URL_NOT_PUBLIC');
      updates.push({ feed: r.feed_id, key: r.key, state: 'digest', item: null });
      continue;
    }
    const feedTitle = cleanName(r.feed_title || new URL(url).hostname) || 'Feed';
    const b = await buildItem(id, {
      origin: `feed:${r.feed_id}:${r.key}`, kind: 'url', url, title: r.title || feedTitle,
      from: cleanName(`Feed · ${feedTitle}`).slice(0, 60), xOrigin: 'feed',
    });
    built.push(b);
    updates.push({ feed: r.feed_id, key: r.key, state: 'sent', item: b.id });
    perFeed.set(r.feed_id, sentFeed + 1);
    allSent++;
  }
  const stmts = storeManyStatements(ctx, id.values.fingerprint, built);
  stmts.push(ctx.db.stmt(
    `UPDATE entries SET state = j.state, item_id = j.item, sent_day = CASE WHEN j.state = 'sent' THEN ?1 END
     FROM (SELECT json_extract(value, '$.feed') AS feed, json_extract(value, '$.key') AS key, json_extract(value, '$.state') AS state,
             json_extract(value, '$.item') AS item FROM json_each(?2)) AS j
     WHERE entries.feed_id = j.feed AND entries.key = j.key AND entries.state = 'pending'`,
    today, JSON.stringify(updates),
  ));
  if (built.length) {
    stmts.push(ctx.db.stmt(
      `INSERT INTO usage (day, kind, n) VALUES (?, 'feed_items', ?) ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n`, today, built.length,
    ));
  }
  await ctx.db.batch(stmts);
  return built.length;
}

// ---- HTTP

function parseMode(v: unknown, fallback: 'each' | 'digest' = 'digest'): 'each' | 'digest' {
  if (v === undefined || v === null || v === '') return fallback;
  if (v === 'each' || v === 'digest') return v;
  throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (mode).' });
}

/** GET /v1/feeds */
export async function listFeeds(ctx: Ctx, s: Settings): Promise<Response> {
  const d = digestSettings(s);
  const today = localParts(ctx.now, d.tz).date;
  const feeds = await ctx.db.all<FeedRow>(
    `SELECT f.*, (SELECT COUNT(*) FROM entries e WHERE e.feed_id = f.id AND e.state = 'sent' AND e.sent_day = ?) AS sent_today
     FROM feeds f ORDER BY created`, today,
  );
  const pending = await ctx.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM entries WHERE state = 'digest'");
  return json(ctx.rid, 200, { feeds: feeds.map(feedJson), digest: { hour: d.hour, tz: d.tz, pending: pending?.n ?? 0, lastSent: s.digestLast ?? null } });
}

/** POST /v1/feeds {url, mode?}: fetched once; every entry in it becomes the baseline (never sent). */
export async function addFeed(ctx: Ctx, id: Identity, s: Settings, body: Record<string, unknown>): Promise<Response> {
  if (typeof body.url !== 'string') throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (url).' });
  const mode = parseMode(body.mode);
  const start = checkFetchUrl(body.url.trim(), selfHost(id)).href;
  const pre = await ctx.db.first<{ n: number; existing: string | null }>(
    'SELECT (SELECT COUNT(*) FROM feeds) AS n, (SELECT id FROM feeds WHERE url = ?) AS existing', start,
  );
  if (pre?.existing) throw new ServerError(409, 'FEED_EXISTS');
  if ((pre?.n ?? 0) >= ctx.caps.maxFeeds) throw new ServerError(429, 'FEED_LIMIT', { limit: ctx.caps.maxFeeds });
  let got;
  try { got = await fetchFeed(ctx, id, start, {}, true); } catch (e) {
    if (e instanceof ServerError && (e.code === 'URL_BLOCKED' || e.code === 'TOO_LARGE')) throw e;
    if ((e as Error)?.name === 'BudgetError') throw e;
    throw new ServerError(502, 'FETCH_FAILED');
  }
  if (!got.feed) throw new ServerError(422, 'FEED_INVALID');
  if (got.url !== start) {
    const dup = await ctx.db.first<{ id: string }>('SELECT id FROM feeds WHERE url = ?', got.url);
    if (dup) throw new ServerError(409, 'FEED_EXISTS');
  }
  const feedId = randomHex(6);
  const today = localParts(ctx.now, digestSettings(s).tz).date;
  const keys = [];
  for (const e of got.feed.entries) keys.push({ key: await entryKey(feedId, e), state: 'baseline' });
  // Past 400 MB of D1 the baseline is not recorded now (11.1): the feed's first check after that records it.
  const storagePaused = d1Paused(ctx, s);
  const row: FeedRow = {
    id: feedId, url: got.url, title: got.feed.title || null, site: publicUrl(got.feed.site ?? ''), mode, etag: storagePaused ? null : got.etag,
    last_modified: storagePaused ? null : got.lastModified, next_check: ctx.now + CHECK_INTERVAL, last_check: ctx.now,
    last_ok: storagePaused ? null : ctx.now, errors: 0, last_error: null, floods: 0, paused: 0, new_day: today, new_today: 0, created: ctx.now,
    checked_by_user: 0,
  };
  await ctx.db.batch([
    ctx.db.stmt(
      `INSERT INTO feeds (id, url, title, site, mode, etag, last_modified, next_check, last_check, last_ok, new_day, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.url, row.title, row.site, row.mode, row.etag, row.last_modified, row.next_check, row.last_check, row.last_ok, today, row.created,
    ),
    ...(storagePaused ? [] : [ctx.db.stmt(
      `INSERT OR IGNORE INTO entries (feed_id, key, first_seen, state)
       SELECT ?1, json_extract(value, '$.key'), ?2, 'baseline' FROM json_each(?3)`,
      feedId, ctx.now, JSON.stringify(keys),
    )]),
  ]);
  return json(ctx.rid, 201, { feed: feedJson(row) });
}

async function getFeed(ctx: Ctx, feedId: string): Promise<FeedRow> {
  if (!/^[0-9a-f]{12}$/.test(feedId)) throw new ServerError(404, 'NOT_FOUND');
  const f = await ctx.db.first<FeedRow>('SELECT * FROM feeds WHERE id = ?', feedId);
  if (!f) throw new ServerError(404, 'NOT_FOUND');
  return f;
}

/** PATCH /v1/feeds/{id}: mode, paused, title. Un-pausing clears FEED_FLOOD and SERVER_LIMIT. */
export async function patchFeed(ctx: Ctx, feedId: string, body: Record<string, unknown>): Promise<Response> {
  const f = await getFeed(ctx, feedId);
  if (body.mode !== undefined) f.mode = parseMode(body.mode, f.mode);
  if (body.title !== undefined) {
    if (typeof body.title !== 'string') throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (title).' });
    f.title = body.title.replace(/\s+/g, ' ').trim().slice(0, 300);
  }
  if (body.paused !== undefined) {
    if (typeof body.paused !== 'boolean') throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (paused).' });
    if (f.paused && !body.paused) {
      f.floods = 0; f.errors = 0; f.next_check = ctx.now;
      if (f.last_error === 'FEED_FLOOD' || f.last_error === 'SERVER_LIMIT') f.last_error = null;
    }
    f.paused = body.paused ? 1 : 0;
  }
  await ctx.db.run(
    'UPDATE feeds SET mode = ?, title = ?, paused = ?, floods = ?, errors = ?, next_check = ?, last_error = ? WHERE id = ?',
    f.mode, f.title, f.paused, f.floods, f.errors, f.next_check, f.last_error, f.id,
  );
  return json(ctx.rid, 200, { feed: feedJson(f) });
}

/** DELETE /v1/feeds/{id}: its pending entries are dropped. */
export async function deleteFeed(ctx: Ctx, feedId: string): Promise<Response> {
  if (!/^[0-9a-f]{12}$/.test(feedId)) throw new ServerError(404, 'NOT_FOUND');
  await ctx.db.batch([
    ctx.db.stmt('DELETE FROM entries WHERE feed_id = ?', feedId),
    ctx.db.stmt('DELETE FROM feeds WHERE id = ?', feedId),
  ]);
  return empty(ctx.rid, 204);
}

/** POST /v1/feeds/{id}/check: at most once a minute per feed. */
export async function checkFeedNow(ctx: Ctx, id: Identity, s: Settings, feedId: string): Promise<Response> {
  const f = await getFeed(ctx, feedId);
  if (f.last_check && ctx.now - f.last_check < 60_000) throw new ServerError(429, 'RATE_LIMITED', { retryAfter: 60 });
  const r = await checkFeed(ctx, id, f, s);
  await ctx.db.batch(r.stmts);
  const after = await getFeed(ctx, feedId);
  return json(ctx.rid, 200, { feed: feedJson(after), new: r.recorded });
}

/** POST /v1/feeds/import: OPML; feeds are validated on their first check (which records the baseline). */
export async function importOpml(ctx: Ctx, id: Identity, s: Settings, req: Request, bytes: Uint8Array): Promise<Response> {
  const ct = (req.headers.get('Content-Type') ?? '').toLowerCase();
  if (ct && !/^(text\/x-opml|application\/xml|text\/xml|application\/octet-stream)/.test(ct)) throw new ServerError(415, 'UNSUPPORTED_TYPE');
  const mode = parseMode(new URL(req.url).searchParams.get('mode'));
  const outlines = parseOpml(new TextDecoder().decode(bytes));
  const existing = new Set((await ctx.db.all<{ url: string }>('SELECT url FROM feeds')).map((r) => r.url));
  let count = existing.size;
  const added: FeedRow[] = [];
  const skipped: { url: string; reason: string }[] = [];
  const today = localParts(ctx.now, digestSettings(s).tz).date;
  for (const o of outlines) {
    let url: string;
    try { url = checkFetchUrl(o.url, selfHost(id)).href; } catch { skipped.push({ url: o.url.slice(0, 300), reason: 'URL_BLOCKED' }); continue; }
    if (existing.has(url)) { skipped.push({ url, reason: 'FEED_EXISTS' }); continue; }
    if (count >= ctx.caps.maxFeeds) { skipped.push({ url, reason: 'FEED_LIMIT' }); continue; }
    existing.add(url); count++;
    added.push({
      id: randomHex(6), url, title: o.title || null, site: null, mode, etag: null, last_modified: null, next_check: ctx.now,
      last_check: null, last_ok: null, errors: 0, last_error: null, floods: 0, paused: 0, new_day: today, new_today: 0, created: ctx.now,
      checked_by_user: 0,
    });
  }
  if (added.length) {
    await ctx.db.run(
      `INSERT OR IGNORE INTO feeds (id, url, title, mode, next_check, created, new_day)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.url'), json_extract(value, '$.title'), json_extract(value, '$.mode'),
         ?1, ?1, ?2 FROM json_each(?3)`,
      ctx.now, today, JSON.stringify(added.map((a) => ({ id: a.id, url: a.url, title: a.title, mode: a.mode }))),
    );
  }
  return json(ctx.rid, 200, { added: added.map(feedJson), skipped });
}

/** Hourly: entries older than 180 days. */
export const entriesCleanup = (ctx: Ctx) => ctx.db.stmt('DELETE FROM entries WHERE first_seen <= ?', ctx.now - 180 * 24 * HOUR);
