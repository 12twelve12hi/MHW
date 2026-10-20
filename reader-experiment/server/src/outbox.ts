// Server-made items: built once into frames, stored in D1, published over ntfy, re-sent until acked (DESIGN.md 5).

import { Buffer } from 'node:buffer';
import { buildServerItemFrames, SERVER_API } from '../client/daylight-server.js';
import type { Ctx } from './env.ts';
import { randomHex, utcDay, logCode } from './env.ts';
import type { Identity } from './keys.ts';
import { publishAttach, publishSmall, poll } from './relay.ts';
import type { Settings } from './settings.ts';
import { relayAfter, saveStmt } from './settings.ts';
import { ServerError } from './errors.ts';

export const SMALL_B64 = 3800;

export interface ServerItem {
  origin: string;
  kind: 'url' | 'page' | 'file';
  url?: string | null;
  title?: string;
  name?: string;
  mime?: string;
  content?: Uint8Array | string;
  from: string;
  sent?: string;
  xOrigin: 'email' | 'feed' | 'digest' | 'ai';
  xAbout?: Record<string, string>;
}

export interface BuiltItem { id: string; kind: string; title: string; frames: string[]; bytes: number; origin: string }

/** Items whose url does not pass publicUrl get this address, which never resolves (5). */
export const invalidUrl = (itemId: string) => `https://daylight.invalid/i/${itemId}`;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
export const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

/** item -> frames (base64) sealed for the delivery mode. */
export async function buildItem(id: Identity, item: ServerItem): Promise<BuiltItem> {
  const itemId = await id.itemId(item.origin);
  const url = item.url ?? (item.kind === 'file' ? null : invalidUrl(itemId));
  const extra: Record<string, unknown> = { 'x-origin': item.xOrigin };
  if (item.xAbout && Object.keys(item.xAbout).length) extra['x-about'] = item.xAbout;
  const built = await buildServerItemFrames(id.delivery.seal, {
    id: itemId, kind: item.kind, url, title: item.title, name: item.name, mime: item.mime, content: item.content,
    sent: item.sent, from: item.from, app: `server/${SERVER_API}`, extra,
  });
  return {
    id: itemId, kind: item.kind, title: String((built.header as Record<string, unknown>).title ?? ''), origin: item.origin,
    frames: built.frames.map((f: Uint8Array) => b64(f)), bytes: built.encodedLength,
  };
}

/**
 * Statements that store a built item (outbox row + frames). INSERT OR IGNORE: a step that crashed after storing and
 * runs again produces the same id, and nothing is stored twice. Frames are grouped so that each statement's parameter
 * stays under D1's 2 MB.
 */
export function storeStatements(ctx: Ctx, fp: string, built: BuiltItem): D1PreparedStatement[] {
  const out = [ctx.db.stmt(
    `INSERT OR IGNORE INTO outbox (id, token, fp, origin, kind, title, parts, bytes, state, created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    built.id, randomHex(16), fp, built.origin.slice(0, 200), built.kind, built.title.slice(0, 300), built.frames.length, built.bytes, ctx.now,
  )];
  let group: [number, string][] = [];
  let size = 0;
  const flush = () => {
    if (!group.length) return;
    out.push(ctx.db.stmt(
      `INSERT OR IGNORE INTO frames (item_id, i, data)
       SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)`,
      built.id, JSON.stringify(group),
    ));
    group = []; size = 0;
  };
  built.frames.forEach((f, i) => {
    if (size + f.length > 1_500_000) flush();
    group.push([i, f]); size += f.length;
  });
  flush();
  return out;
}

/** How many statements storeStatements makes for an item. */
/** Statements that store several built items at once: one outbox insert and frames grouped under 1.5 MB each. */
export function storeManyStatements(ctx: Ctx, fp: string, list: BuiltItem[]): D1PreparedStatement[] {
  if (!list.length) return [];
  const rows = list.map((b) => ({
    id: b.id, token: randomHex(16), origin: b.origin.slice(0, 200), kind: b.kind, title: b.title.slice(0, 300), parts: b.frames.length, bytes: b.bytes,
  }));
  const out = [ctx.db.stmt(
    `INSERT OR IGNORE INTO outbox (id, token, fp, origin, kind, title, parts, bytes, state, created)
     SELECT json_extract(value, '$.id'), json_extract(value, '$.token'), ?1, json_extract(value, '$.origin'),
       json_extract(value, '$.kind'), json_extract(value, '$.title'), json_extract(value, '$.parts'), json_extract(value, '$.bytes'),
       'queued', ?2 FROM json_each(?3)`,
    fp, ctx.now, JSON.stringify(rows),
  )];
  let group: [string, number, string][] = [];
  let size = 0;
  const flush = () => {
    if (!group.length) return;
    out.push(ctx.db.stmt(
      `INSERT OR IGNORE INTO frames (item_id, i, data)
       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?)`,
      JSON.stringify(group),
    ));
    group = []; size = 0;
  };
  for (const b of list) {
    b.frames.forEach((f, i) => {
      if (size + f.length > 1_500_000) flush();
      group.push([b.id, i, f]); size += f.length;
    });
  }
  flush();
  return out;
}

export function frameStatementCount(built: BuiltItem): number {
  let groups = 0, size = 0, open = false;
  for (const f of built.frames) {
    if (open && size + f.length > 1_500_000) { open = false; size = 0; }
    if (!open) { groups++; open = true; }
    size += f.length;
  }
  return 1 + groups;
}

interface DueRow { id: string; token: string; parts: number; next_part: number; state: string; publishes: number; used: number | null }

/**
 * Cron step: publishes due outbox items, at most `messagesPerRun` messages and within the daily ntfy budget (5.2, 5.3).
 * -> the number of messages published.
 */
export async function publishDue(ctx: Ctx, id: Identity, s: Settings): Promise<number> {
  if (s.relay && s.relay.retryAt > ctx.now) return 0;
  const day = utcDay(ctx.now);
  const rows = await ctx.db.all<DueRow>(
    `SELECT id, token, parts, next_part, state, publishes,
       (SELECT n FROM usage WHERE day = ?1 AND kind = 'ntfy_msgs') AS used
     FROM outbox WHERE fp = ?2 AND created > ?3
       AND (state = 'queued' OR (state = 'sent' AND last_publish <= ?4))
     ORDER BY seq LIMIT ?5`,
    day, id.values.fingerprint, ctx.now - ctx.limits.outboxExpiry, ctx.now - ctx.limits.outboxResend, ctx.limits.messagesPerRun,
  );
  if (!rows.length) return 0;
  let allowance = Math.min(ctx.limits.messagesPerRun, ctx.limits.ntfyPerDay - (rows[0].used ?? 0));
  if (allowance <= 0) return 0;
  const frames = await ctx.db.all<{ item_id: string; i: number; n: number; data: string | null }>(
    `SELECT item_id, i, length(data) AS n, CASE WHEN length(data) <= ${SMALL_B64} THEN data END AS data
     FROM frames WHERE item_id IN (SELECT value FROM json_each(?)) ORDER BY item_id, i`,
    JSON.stringify(rows.map((r) => r.id)),
  );
  const byItem = new Map<string, Map<number, { n: number; data: string | null }>>();
  for (const f of frames) {
    if (!byItem.has(f.item_id)) byItem.set(f.item_id, new Map());
    byItem.get(f.item_id)!.set(f.i, { n: f.n, data: f.data });
  }
  const updates: { id: string; state: string; next: number; lp: number; inc: number; error: string | null }[] = [];
  let sent = 0;
  let relay = s.relay;
  let stop = false;
  for (const row of rows) {
    if (stop || allowance <= 0) break;
    const parts = byItem.get(row.id);
    let next = row.state === 'sent' ? 0 : row.next_part;
    let state = 'queued';
    let error: string | null = null;
    while (next < row.parts && allowance > 0) {
      const f = parts?.get(next);
      if (!f) { state = 'rejected'; error = 'FRAMES_MISSING'; break; }
      let r;
      if (f.data !== null) {
        r = await publishSmall(ctx, id, id.delivery.topic, f.data);
      } else {
        if (!id.serverUrl) { error = 'NO_SERVER_URL'; stop = true; break; }
        r = await publishAttach(ctx, id, id.delivery.topic, `${id.serverUrl}/o/${row.token}/${next}`);
      }
      relay = relayAfter(relay, r.status, ctx.now, r.ok);
      if (r.ok) { sent++; allowance--; next++; continue; }
      if (r.retry) { stop = true; logCode(ctx, `RELAY_${r.status || 'NETWORK'}`); break; }
      state = 'rejected'; error = `HTTP_${r.status}`; logCode(ctx, `RELAY_${r.status}`);
      break;
    }
    if (state !== 'rejected') state = next >= row.parts ? 'sent' : 'queued';
    const done = state === 'sent';
    updates.push({ id: row.id, state, next: done ? 0 : next, lp: done ? ctx.now : 0, inc: done ? 1 : 0, error });
  }
  const stmts: D1PreparedStatement[] = [];
  if (updates.length) {
    stmts.push(ctx.db.stmt(
      `UPDATE outbox SET state = j.state, next_part = j.next, publishes = publishes + j.inc,
         last_publish = CASE WHEN j.lp > 0 THEN j.lp ELSE outbox.last_publish END, error = COALESCE(j.error, outbox.error)
       FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.state') AS state,
               json_extract(value, '$.next') AS next, json_extract(value, '$.lp') AS lp,
               json_extract(value, '$.inc') AS inc, json_extract(value, '$.error') AS error FROM json_each(?)) AS j
       WHERE outbox.id = j.id AND outbox.state IN ('queued', 'sent')`,
      JSON.stringify(updates),
    ));
  }
  if (sent) {
    stmts.push(ctx.db.stmt(
      `INSERT INTO usage (day, kind, n) VALUES (?, 'ntfy_msgs', ?) ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n`,
      day, sent,
    ));
  }
  if (relay !== s.relay) { stmts.push(saveStmt(ctx, { relay })); s.relay = relay; }
  await ctx.db.batch(stmts);
  return sent;
}

const ID32 = /^[0-9a-f]{32}$/;

/**
 * Cron step: reads acks and hellos on the delivery mode's ack topic (5.4, 5.5), hardened against junk: at most
 * 256 KiB and 200 messages, attachments ignored, stop after 20 frames in a row that do not open.
 */
export async function pollAcks(ctx: Ctx, id: Identity, s: Settings): Promise<{ delivered: number; hello: boolean; processed: number }> {
  const since = s.ackSince ?? 'all';
  let entries;
  try {
    entries = await poll(ctx, id, id.delivery.ackTopic, since);
  } catch (e) {
    if ((e as Error)?.name === 'BudgetError') throw e;
    logCode(ctx, 'ACK_POLL_FAILED');
    await ctx.db.batch([saveStmt(ctx, { ackAt: ctx.now })]);
    return { delivered: 0, hello: false, processed: 0 };
  }
  const ids = new Set<string>();
  let junk = 0, hello = false, cursor = since, processed = 0;
  let inbox = s.inbox;
  for (const m of entries) {
    if (junk >= 20) break;
    processed++;
    cursor = m.id;
    if (!m.frame) { junk++; continue; }
    let header: Record<string, unknown>;
    try { header = await id.delivery.openAck(m.frame); } catch { junk++; continue; }
    junk = 0;
    if (header.kind !== 'ack' || !Array.isArray(header.ids)) continue;
    for (const x of (header.ids as unknown[]).slice(0, 280)) if (typeof x === 'string' && ID32.test(x)) ids.add(x);
    const xi = header['x-inbox'] as { app?: unknown } | undefined;
    if (xi || id.delivery.mode === 'lab') {
      hello = hello || !!xi;
      inbox = { lastSeen: ctx.now, app: typeof xi?.app === 'string' ? xi.app.slice(0, 60) : inbox?.app };
    }
  }
  const list = JSON.stringify([...ids]);
  const stmts: D1PreparedStatement[] = [saveStmt(ctx, { ackSince: cursor, ackAt: ctx.now, ...(inbox !== s.inbox ? { inbox } : {}) })];
  let delivered = 0;
  if (ids.size) {
    stmts.push(ctx.db.stmt(
      `UPDATE outbox SET state = 'delivered' WHERE id IN (SELECT value FROM json_each(?)) AND state IN ('queued', 'sent')`, list,
    ));
    stmts.push(ctx.db.stmt(
      `DELETE FROM frames WHERE item_id IN (SELECT id FROM outbox WHERE id IN (SELECT value FROM json_each(?)) AND state = 'delivered')`, list,
    ));
  }
  const res = await ctx.db.batch(stmts);
  if (ids.size) delivered = res[1]?.meta?.changes ?? 0;
  s.ackSince = cursor; s.ackAt = ctx.now; if (inbox) s.inbox = inbox;
  return { delivered, hello, processed };
}

/** GET /o/<token>/<i>: a server item frame from D1, unauthenticated (the token is the capability). */
export async function serveItemFrame(ctx: Ctx, id: Identity, token: string, i: number): Promise<Response | null> {
  const row = await ctx.db.first<{ state: string; fp: string; data: string | null; lock: string | null }>(
    `SELECT o.state, o.fp, f.data, (SELECT v FROM settings WHERE k = 'lock') AS lock
     FROM outbox o LEFT JOIN frames f ON f.item_id = o.id AND f.i = ? WHERE o.token = ?`,
    i, token,
  );
  if (!row) return null;
  let locked = false;
  try { locked = !!row.lock && JSON.parse(row.lock).fingerprint === id.values.fingerprint; } catch { /* no lock */ }
  if (locked || row.fp !== id.values.fingerprint || !row.data || ['expired', 'rejected', 'delivered'].includes(row.state)) {
    throw new ServerError(410, 'GONE');
  }
  const bytes = fromB64(row.data);
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'no-store' },
  });
}

/** Expires week-old items and drops frames that are no longer needed (part of the hourly cleanup). */
export function outboxCleanup(ctx: Ctx): D1PreparedStatement[] {
  return [
    ctx.db.stmt(`UPDATE outbox SET state = 'expired' WHERE state IN ('queued', 'sent') AND created <= ?`, ctx.now - ctx.limits.outboxExpiry),
    ctx.db.stmt(`DELETE FROM frames WHERE item_id IN (SELECT id FROM outbox WHERE state IN ('delivered', 'expired', 'rejected'))`),
    ctx.db.stmt(`DELETE FROM outbox WHERE created <= ?`, ctx.now - ctx.limits.outboxKeep),
  ];
}
