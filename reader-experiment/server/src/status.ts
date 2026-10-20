// GET /v1/status, settings and admin endpoints (DESIGN.md 10.5) and the feature states (14.1).

import { STATE_MESSAGES, errorMessage, SERVER_API, FEATURES } from '../client/daylight-server.js';
import type { Ctx } from './env.ts';
import { iso, nextUtcMidnight, utcDay } from './env.ts';
import type { Identity } from './keys.ts';
import { ServerError, json } from './errors.ts';
import type { Settings } from './settings.ts';
import { DEFAULT_AI_USD, d1Paused, digestSettings, saveStmt, validTz } from './settings.ts';
import { mailCounts, mailCountsSql } from './email.ts';

export interface FeatureState { state: string; message?: string }

async function keyFp(key: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  return [...h.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let keyFpCache: { key: string; fp: string } | null = null;
export async function currentKeyFp(key: string | undefined): Promise<string> {
  if (!key) return '';
  if (keyFpCache?.key !== key) keyFpCache = { key, fp: await keyFp(key) };
  return keyFpCache.fp;
}

const st = (state: string): FeatureState => (state === 'ready' ? { state } : { state, message: (STATE_MESSAGES as Record<string, string>)[state] });

/** A feature's state as the server decides it. `aiKeyFp` is the fingerprint of the current key (to ignore stale errors). */
export function featureState(ctx: Ctx, id: Identity, s: Settings, feature: string, aiKeyFp = ''): FeatureState {
  const labNoInbox = id.delivery.mode === 'lab' && !s.inbox?.lastSeen;
  const aiErr = s.aiError && (!aiKeyFp || s.aiError.keyFp === aiKeyFp) ? s.aiError : null;
  switch (feature) {
    case 'ai':
      if (!ctx.env.ANTHROPIC_API_KEY) return st('needs-key');
      if (aiErr) return { state: 'error', message: errorMessage(aiErr.code) };
      return st('ready');
    case 'pdf':
      if (!ctx.env.ANTHROPIC_API_KEY) return st('needs-key');
      if (!ctx.env.FILES) return st('needs-r2');
      if (aiErr) return { state: 'error', message: errorMessage(aiErr.code) };
      return st('ready');
    case 'email':
      if (!ctx.env.DAYLIGHT_EMAIL_DOMAIN) return st('needs-domain');
      if (!ctx.env.FILES) return st('needs-r2');
      if (labNoInbox) return st('needs-lab-inbox');
      if (ctx.plan === 'free' && s.canary === 'killed') return st('needs-paid');
      return st('ready');
    case 'feeds':
    case 'deliver':
      return labNoInbox ? st('needs-lab-inbox') : st('ready');
    case 'files':
      return ctx.env.FILES ? st('ready') : st('needs-r2');
    default:
      return { state: 'error', message: errorMessage('NOT_FOUND') };
  }
}

export function aiLimits(ctx: Ctx, s: Settings) {
  const ceiling = Math.max(0, Number(ctx.env.AI_MAX_USD_DAY ?? 10) || 0);
  const maxRequests = Math.max(0, Math.floor(Number(ctx.env.AI_MAX_REQ_DAY ?? 100) || 0));
  const daily = Math.min(ceiling, Math.max(0, Number(s.ai?.dailyUsd ?? DEFAULT_AI_USD)));
  return { dailyUsd: daily, ceilingUsd: ceiling, maxRequests };
}

/** GET /v1/status (at most 2 D1 statements beyond the settings already loaded). */
export async function status(ctx: Ctx, id: Identity, s: Settings): Promise<Response> {
  const day = utcDay(ctx.now);
  const dayStart = Date.parse(day + 'T00:00:00Z');
  const rows = await ctx.db.all<Record<string, number | string | null>>(
    `SELECT 'usage' AS r, kind, n, usd_micros, reserved_micros, NULL AS t, NULL AS code, NULL AS x FROM usage WHERE day = ?1
     UNION ALL SELECT 'misc', NULL, (SELECT COALESCE(SUM(bytes), 0) FROM files WHERE expires > ?2), b, c, d, NULL,
       (SELECT json_group_array(json_array(t, code)) FROM (SELECT t, code FROM log ORDER BY t DESC LIMIT 5))
     FROM (SELECT ${mailCountsSql('?3', '?1')})`,
    day, ctx.now, dayStart,
  );
  const misc = rows.find((r) => r.r === 'misc');
  const logRows: [number, string][] = misc?.x ? JSON.parse(String(misc.x)) : [];
  const usage = (kind: string) => rows.find((r) => r.r === 'usage' && r.kind === kind);
  const ai = usage('ai');
  const limits = aiLimits(ctx, s);
  const kfp = await currentKeyFp(ctx.env.ANTHROPIC_API_KEY);
  const features: Record<string, FeatureState> = {};
  for (const f of FEATURES) features[f] = featureState(ctx, id, s, f, kfp);
  return json(ctx.rid, 200, {
    server: id.serverUrl, api: SERVER_API, fingerprint: id.values.fingerprint, delivery: id.delivery.mode,
    version: ctx.env.GIT_SHA || 'dev', plan: ctx.plan,
    inbox: { lab: !!s.inbox?.lastSeen, lastSeen: s.inbox?.lastSeen ? iso(s.inbox.lastSeen) : null },
    features,
    usage: {
      ai: {
        requests: Number(ai?.n ?? 0), usd: Number(ai?.usd_micros ?? 0) / 1e6, reservedUsd: Number(ai?.reserved_micros ?? 0) / 1e6,
        limitUsd: limits.dailyUsd, limitRequests: limits.maxRequests, resetAt: iso(nextUtcMidnight(ctx.now)),
      },
      email: mailCounts(misc?.usd_micros, misc?.reserved_micros, misc?.t),
      ntfy: { messages: Number(usage('ntfy_msgs')?.n ?? 0) },
    },
    // Past 400 MB of D1, new feed entries, text sources and mail rows are paused (11.1).
    storage: {
      fileBytes: Number(misc?.n ?? 0), limit: ctx.limits.fileStorage, d1Bytes: s.d1Bytes ?? null, d1PauseBytes: ctx.limits.d1PauseBytes,
      paused: d1Paused(ctx, s), ...(d1Paused(ctx, s) ? { pausedReason: 'D1_FULL' } : {}),
    },
    relay: { lastStatus: s.relay?.lastStatus ?? null, lastPublish: s.relay?.lastPublish ? iso(s.relay.lastPublish) : null },
    cpu: { canary: s.canary ?? null },
    errors: logRows.map(([t, code]) => ({ t: iso(Number(t)), code })),
    ...(id.warning ? { warning: id.warning } : {}),
  });
}

function settingsBody(ctx: Ctx, s: Settings) {
  const l = aiLimits(ctx, s);
  return { ai: { dailyUsd: l.dailyUsd, ceilingUsd: l.ceilingUsd, maxRequests: l.maxRequests }, digest: digestSettings(s) };
}

export function getSettings(ctx: Ctx, s: Settings): Response {
  return json(ctx.rid, 200, settingsBody(ctx, s));
}

/** PATCH /v1/settings: {"ai": {"dailyUsd"}} and/or {"digest": {"hour", "tz"}}. */
export async function patchSettings(ctx: Ctx, s: Settings, body: Record<string, unknown>): Promise<Response> {
  const change: Partial<Settings> = {};
  const ai = body.ai as Record<string, unknown> | undefined;
  if (ai !== undefined) {
    const v = Number(ai?.dailyUsd);
    const ceiling = aiLimits(ctx, s).ceilingUsd;
    if (!Number.isFinite(v) || v < 0 || v > ceiling) throw new ServerError(400, 'BAD_REQUEST', { message: `The daily AI cap can be 0 to ${ceiling} US dollars.` });
    change.ai = { dailyUsd: Math.round(v * 100) / 100 };
  }
  const d = body.digest as Record<string, unknown> | undefined;
  if (d !== undefined) {
    const cur = digestSettings(s);
    const hour = d?.hour === undefined ? cur.hour : Number(d.hour);
    const tz = d?.tz === undefined ? cur.tz : d.tz;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new ServerError(400, 'BAD_REQUEST', { message: 'The digest hour is 0 to 23.' });
    if (!validTz(tz)) throw new ServerError(400, 'BAD_REQUEST', { message: 'That time zone isn’t known.' });
    change.digest = { hour, tz };
  }
  if (Object.keys(change).length) {
    await ctx.db.batch([saveStmt(ctx, change)]);
    Object.assign(s, change);
  }
  return json(ctx.rid, 200, settingsBody(ctx, s));
}

export async function lockServer(ctx: Ctx, id: Identity): Promise<void> {
  await ctx.db.batch([saveStmt(ctx, { lock: { fingerprint: id.values.fingerprint, at: ctx.now } })]);
}
