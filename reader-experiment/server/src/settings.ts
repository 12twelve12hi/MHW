// The settings table: small JSON values under fixed keys (DESIGN.md 11.1).

import type { Ctx } from './env.ts';
import { HOUR } from './env.ts';

export interface DigestSettings { hour: number; tz: string }
export interface Lock { fingerprint: string; at: number }
export interface InboxSeen { lastSeen: number; app?: string }
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
  inbox?: InboxSeen;
  config?: ConfigState;
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
  const rows = await ctx.db.all<{ k: string; v: unknown; a: number | null; b: number | null; c: number | null; d: number | null; e: number | null; f: number | null }>(
    `SELECT k, v, NULL AS a, NULL AS b, NULL AS c, NULL AS d, NULL AS e, NULL AS f FROM settings
     UNION ALL SELECT '_counts', NULL,
       (SELECT COUNT(*) FROM outbox WHERE state = 'sent' AND fp = ?1),
       (SELECT COUNT(*) FROM outbox WHERE fp = ?1 AND (state = 'queued' OR (state = 'sent' AND last_publish <= ?2))),
       (SELECT COUNT(*) FROM mail WHERE state = 'queued' OR (state = 'running' AND lease < ?3) OR state = 'waiting-paid'),
       (SELECT COUNT(*) FROM jobs WHERE state = 'queued' OR (state = 'running' AND lease < ?3)),
       (SELECT COUNT(*) FROM feeds WHERE paused = 0 AND next_check <= ?3),
       (SELECT COUNT(*) FROM entries WHERE state = 'pending')`,
    fp, now - ctx.limits.outboxResend, now,
  );
  const s = parseRows(rows.filter((r) => r.k !== '_counts'));
  const c = rows.find((r) => r.k === '_counts');
  if (c) {
    s._awaiting = Number(c.a) || 0; s._due = Number(c.b) || 0; s._mail = Number(c.c) || 0;
    s._jobs = Number(c.d) || 0; s._feeds = Number(c.e) || 0; s._pending = Number(c.f) || 0;
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
