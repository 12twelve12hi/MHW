// The settings table: small JSON values under fixed keys (DESIGN.md 11.1).

import type { Ctx } from './env.ts';
import { HOUR } from './env.ts';

export interface DigestSettings { hour: number; tz: string }
export interface Lock { fingerprint: string; at: number }
/**
 * The Lab Inbox's presence on the delivery mode's ack topic (5.5). `lastSeen`: the last valid frame there. `pubs`: per
 * publisher (the part of x-inbox.app before the first '/': android, reader-lab, other; LAB-PLAN 2.2.6), the last
 * frame with x-inbox, and whether it said `lab: 0` (Lab turned off). Older rows have no `pubs`.
 */
export interface InboxSeen { lastSeen: number; app?: string; pubs?: Record<string, { at: number; off?: true }> }
export interface ConfigState { slot: number; origin: string; delivery: string; at: number; status: number; id?: string }
export interface RelayState { lastStatus: number; lastPublish: number; fails: number; retryAt: number }
export interface AiError { code: string; keyFp: string; at: number }

export interface Settings {
  fp?: string;
  lock?: Lock;
  digest?: DigestSettings;
  ai?: { dailyUsd: number };
  ackSince?: string;
  ackAt?: number;
  inbox?: InboxSeen | null;
  config?: ConfigState | null;
  relay?: RelayState;
  cleanupAt?: number;
  canary?: 'ok' | 'killed';
  aiError?: AiError;
  digestNow?: boolean;
  digestLast?: string;
  announceAt?: number;
  selftest?: { at: number; n: number };
  emailAddr?: { address: string; changed: number | null };
  d1Bytes?: number;
  // Counters the cron settings statement reads alongside the rows (never stored).
  _awaiting?: number;
  _due?: number;
  _mail?: number;
  _jobs?: number;
  _feeds?: number;
  _pending?: number;
  /** POST /v1/ai holds past their `until` (9.5). */
  _holds?: number;
  [k: string]: unknown;
}

export const DEFAULT_DIGEST: DigestSettings = { hour: 7, tz: 'UTC' };
export const DEFAULT_AI_USD = 3;

/** All settings in one statement. */
export async function loadSettings(ctx: Ctx): Promise<Settings> {
  const rows = await ctx.db.all<{ k: string; v: string }>('SELECT k, v FROM settings');
  return parseRows(rows);
}

export function parseRows(rows: { k: string; v: unknown }[]): Settings {
  const out: Settings = {};
  for (const r of rows) {
    if (r.k.startsWith('_')) { out[r.k] = Number(r.v) || 0; continue; }
    try { out[r.k] = JSON.parse(String(r.v)); } catch { /* ignore a bad row */ }
  }
  return out;
}

/** Settings plus the counters the Cron needs to decide which steps are due, in one statement (2.3). */
export async function loadCronSettings(ctx: Ctx, fp: string): Promise<Settings> {
  const now = ctx.now;
  const rows = await ctx.db.all<{ k: string; v: unknown; a: number | null; b: number | null; c: number | null; d: number | null; e: number | null; f: number | null; g: number | null }>(
    `SELECT k, v, NULL AS a, NULL AS b, NULL AS c, NULL AS d, NULL AS e, NULL AS f, NULL AS g FROM settings
     UNION ALL SELECT '_counts', NULL,
       (SELECT COUNT(*) FROM outbox WHERE state = 'sent' AND fp = ?1),
       (SELECT COUNT(*) FROM outbox WHERE fp = ?1 AND (state = 'queued' OR (state = 'sent' AND last_publish <= ?2))),
       (SELECT COUNT(*) FROM mail WHERE state = 'queued' OR (state = 'running' AND lease < ?3) OR state = 'waiting-paid'),
       (SELECT COUNT(*) FROM jobs WHERE state = 'queued' OR (state = 'running' AND lease < ?3)),
       (SELECT COUNT(*) FROM feeds WHERE paused = 0 AND next_check <= ?3),
       (SELECT COUNT(*) FROM entries WHERE state = 'pending'),
       (SELECT COUNT(*) FROM holds WHERE until < ?3)`,
    fp, now - ctx.limits.outboxResend, now,
  );
  const s = parseRows(rows.filter((r) => r.k !== '_counts'));
  const c = rows.find((r) => r.k === '_counts');
  if (c) {
    s._awaiting = Number(c.a) || 0; s._due = Number(c.b) || 0; s._mail = Number(c.c) || 0;
    s._jobs = Number(c.d) || 0; s._feeds = Number(c.e) || 0; s._pending = Number(c.f) || 0; s._holds = Number(c.g) || 0;
  }
  return s;
}

/** One statement that upserts several settings. */
export function saveStmt(ctx: Ctx, values: Partial<Settings>): D1PreparedStatement {
  const pairs = Object.entries(values).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, JSON.stringify(v ?? null)]);
  return ctx.db.stmt(
    `INSERT INTO settings (k, v) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?) WHERE 1
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
    JSON.stringify(pairs),
  );
}

export async function saveSettings(ctx: Ctx, values: Partial<Settings>): Promise<void> {
  if (!Object.keys(values).length) return;
  await ctx.db.batch([saveStmt(ctx, values)]);
}

/** Past 400 MB of D1 (80 % of 500 MB) optional writes pause: new feed entries, text sources and mail rows (11.1). */
export function d1Paused(ctx: Ctx, s: Pick<Settings, 'd1Bytes'>): boolean {
  return (Number(s.d1Bytes) || 0) > ctx.limits.d1PauseBytes;
}

/**
 * Whether the Lab Inbox is present (5.5): a valid frame was seen and, once any frame carried x-inbox, some publisher's
 * latest x-inbox is not `lab: 0`. Delivering features answer needs-lab-inbox without it (Lab delivery only).
 */
export function inboxPresent(s: Pick<Settings, 'inbox'>): boolean {
  const i = s.inbox;
  if (!i || !i.lastSeen) return false;
  const pubs = i.pubs && typeof i.pubs === 'object' ? Object.values(i.pubs) : [];
  return !pubs.length || pubs.some((p) => !p?.off);
}

const PUBLISHERS = ['android', 'reader-lab'];

/** x-inbox.app as LAB-PLAN 2.2.5 reads it: printable ASCII, its first 60 characters; anything else is "". */
export function inboxApp(app: unknown): string {
  return typeof app === 'string' && /^[\x20-\x7e]*$/.test(app) ? app.slice(0, 60) : '';
}

/**
 * The presence after one valid frame on the ack topic at `now`. `xi` is the frame's x-inbox object, or null. With
 * x-inbox, the frame replaces its publisher's entry; `lab` exactly 0 (a JSON number, -0 included) marks it off. A frame
 * without x-inbox (a plain ack) only refreshes `lastSeen`.
 */
export function inboxAfter(prev: InboxSeen | null | undefined, now: number, xi: Record<string, unknown> | null): InboxSeen {
  const out: InboxSeen = { lastSeen: now };
  const app = xi ? inboxApp(xi.app) : prev?.app;
  if (app !== undefined) out.app = app;
  const pubs = { ...(prev?.pubs && typeof prev.pubs === 'object' ? prev.pubs : {}) };
  if (xi) {
    const head = (app ?? '').split('/')[0];
    pubs[PUBLISHERS.includes(head) ? head : 'other'] = xi.lab === 0 ? { at: now, off: true } : { at: now };
  }
  if (Object.keys(pubs).length) out.pubs = pubs;
  return out;
}

export function isLocked(s: Settings, fingerprint: string): boolean {
  return !!s.lock && s.lock.fingerprint === fingerprint;
}

export function digestSettings(s: Settings): DigestSettings {
  const d = s.digest ?? DEFAULT_DIGEST;
  return { hour: Number.isInteger(d.hour) && d.hour >= 0 && d.hour <= 23 ? d.hour : 7, tz: validTz(d.tz) ? d.tz : 'UTC' };
}

export function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** The relay is backing off after 429 / 5xx / network errors (1, 2, 4 … 60 min). */
export function relayBackingOff(s: Settings, now: number): boolean {
  return !!s.relay && s.relay.retryAt > now;
}

export function relayAfter(prev: RelayState | undefined, status: number, now: number, ok: boolean): RelayState {
  const fails = ok ? 0 : (prev?.fails ?? 0) + 1;
  const retryAt = ok ? 0 : now + Math.min(60, 2 ** Math.max(0, fails - 1)) * 60_000;
  return { lastStatus: status, lastPublish: ok ? now : prev?.lastPublish ?? 0, fails, retryAt };
}

export const SIX_HOURS = 6 * HOUR;
