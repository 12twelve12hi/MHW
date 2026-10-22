// Bindings, plan caps and the per-invocation context (budgets, clock, counted fetch).

import { ServerError } from './errors.ts';

export interface Env {
  DB: D1Database;
  FILES?: R2Bucket;
  FAILS?: RateLimit;
  SERVER_URL?: string;
  GIT_SHA?: string;
  WORKERS_PLAN?: string;
  DELIVERY?: string;
  AI_MAX_USD_DAY?: string;
  AI_MAX_REQ_DAY?: string;
  DAYLIGHT_SERVER_CODE?: string;
  /** While a setup link waits to be used (3.5): hex(SHA-256("dlshare/v1/server-setup-auth\0" ‖ secret)), set by the deploy. */
  DAYLIGHT_SETUP_TOKEN?: string;
  DAYLIGHT_PAIRING?: string;
  ANTHROPIC_API_KEY?: string;
  DAYLIGHT_EMAIL_DOMAIN?: string;
  DAYLIGHT_EMAIL_LOCAL?: string;
  DAYLIGHT_EMAIL_SALT?: string;
  NTFY_TOKEN?: string;
  // Read only when __TESTING__ (a build-time constant); a deploy bundle never contains these names.
  TEST_ANTHROPIC_BASE_URL?: string;
  TEST_KNOBS?: string;
}

export interface RateLimit { limit(o: { key: string }): Promise<{ success: boolean }> }

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const KiB = 1024;
export const MiB = 1024 * 1024;

export type Plan = 'free' | 'paid';

/** Caps that differ between the Free and Paid plans (2.2 rule 8). */
export function capsFor(plan: Plan) {
  const paid = plan === 'paid';
  return {
    d1Budget: paid ? 900 : 42,
    subBudget: paid ? 900 : 45,
    heavySteps: paid ? 4 : 1,
    maxFeeds: paid ? 500 : 100,
    digestBytes: paid ? 4 * MiB : 256 * KiB,
    urlHtmlBytes: paid ? 2 * MiB : 1 * MiB,
    emailMaxFree: 2 * MiB,
    // Text AI (9.2): on Free the request's passes over the text (parse, check, hash and store, countTokens, the Claude
    // request) stay within 10 ms up to here (2.2 rule 6); longer text needs Workers Paid.
    aiTextChars: paid ? 400_000 : 100_000,
    aiTextBytes: paid ? 1_000_000 : 200_000,
  };
}

/** Fixed limits (DESIGN.md sections 5-9). Tests may lower some through TEST_KNOBS. */
export const LIMITS = {
  jsonBody: 64 * KiB,
  aiBody: 1_100_000,
  opmlBody: 256 * KiB,
  hostedFrame: 12_713_984,
  filesTtl: 14 * DAY,
  fileStorage: 8 * 1024 * MiB,
  outboxResend: 11 * HOUR,
  outboxExpiry: 7 * DAY,
  outboxKeep: 8 * DAY,
  ntfyPerDay: 100,
  messagesPerRun: 6,
  mailPerDay: 200,
  mailPerSender: 20,
  mailPerDomain: 50,
  mailItemsPerDay: 50,
  mailKeep: 30 * DAY,
  waitingPaidKeep: 7 * DAY,
  feedItemsPerFeedDay: 10,
  feedItemsPerDay: 60,
  feedNewPerCheck: 20,
  feedNewPerDay: 100,
  digestMax: 60,
  aiInputTokens: 200_000,
  aiMaxTokens: 16_000,
  aiQueue: 20,
  aiTimeoutMs: 600_000,             // the SDK's own guard for a non-streamed max_tokens 16,000 call (9.4)
  keepaliveMs: 15_000,
  sourceTtl: DAY,
  jobTtl: DAY,
  d1PauseBytes: 400 * 1_000_000,
};

export type Limits = typeof LIMITS;

/** Test knobs (a JSON object in TEST_KNOBS), honoured only in the test bundle. */
export function knobs(env: Env): Partial<Limits> & Record<string, unknown> {
  if (__TESTING__) {
    if (env.TEST_KNOBS) {
      try { return JSON.parse(env.TEST_KNOBS); } catch { return {}; }
    }
  }
  return {};
}

export class BudgetError extends Error {
  constructor(what: string) { super(`budget: ${what}`); this.name = 'BudgetError'; }
}

const testKilled = new Set<string>();

/**
 * Test bundle only: the first time execution reaches the point named by the `kill` knob, the invocation stops there
 * as if Cloudflare had ended it (an error no step records), so tests can check what a CPU kill leaves behind.
 * Deploy bundles drop the body (__TESTING__ is false).
 */
export function testKillPoint(env: Env, point: string): void {
  if (__TESTING__) {
    if (knobs(env).kill === point && !testKilled.has(point)) {
      testKilled.add(point);
      throw new Error(`test: killed at ${point}`);
    }
  }
}

/**
 * Counts D1 statements and external subrequests for one invocation (2.3). Every statement in a batch counts. Steps
 * get their own allowances; when one is used up the step stops cleanly and leaves its work for the next run.
 */
export class Budget {
  d1 = 0;
  sub = 0;
  stepD1 = Infinity;
  stepSub = Infinity;
  private stepBaseD1 = 0;
  private stepBaseSub = 0;
  d1Limit: number;
  subLimit: number;
  constructor(d1Limit: number, subLimit: number) { this.d1Limit = d1Limit; this.subLimit = subLimit; }
  useD1(n = 1) {
    if (this.d1 + n > this.d1Limit) throw new BudgetError('d1');
    if (this.d1 - this.stepBaseD1 + n > this.stepD1) throw new BudgetError('step d1');
    this.d1 += n;
  }
  useSub(n = 1) {
    if (this.sub + n > this.subLimit) throw new BudgetError('subrequests');
    if (this.sub - this.stepBaseSub + n > this.stepSub) throw new BudgetError('step subrequests');
    this.sub += n;
  }
  step(d1: number, sub: number) {
    this.stepBaseD1 = this.d1; this.stepBaseSub = this.sub;
    this.stepD1 = d1; this.stepSub = sub;
  }
  endStep() { this.stepD1 = Infinity; this.stepSub = Infinity; }
  /** Raises the current step's D1 allowance so that `n` more statements fit, within the invocation's budget. */
  extendStep(n: number) {
    if (this.d1 + n > this.d1Limit) throw new BudgetError('d1');
    this.stepD1 = Math.max(this.stepD1, this.d1 - this.stepBaseD1 + n);
  }
  d1Left() { return Math.min(this.d1Limit - this.d1, this.stepD1 - (this.d1 - this.stepBaseD1)); }
}

type Param = string | number | null | ArrayBuffer | Uint8Array;

/** env.DB behind the statement counter. It also adds up D1's rows read (`meta.rows_read`), which the tests check. */
export class Db {
  private db: D1Database;
  private budget: Budget;
  rowsRead = 0;
  constructor(db: D1Database, budget: Budget) { this.db = db; this.budget = budget; }
  stmt(sql: string, ...params: Param[]): D1PreparedStatement {
    return this.db.prepare(sql).bind(...params);
  }
  private count<R extends D1Result | D1Result[]>(r: R): R {
    for (const x of Array.isArray(r) ? r : [r]) this.rowsRead += Number((x?.meta as { rows_read?: number } | undefined)?.rows_read ?? 0) || 0;
    return r;
  }
  async first<T = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<T | null> {
    this.budget.useD1(1);
    return (this.count(await this.stmt(sql, ...params).all<T>()).results ?? [])[0] ?? null;
  }
  async all<T = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<T[]> {
    this.budget.useD1(1);
    return this.count(await this.stmt(sql, ...params).all<T>()).results ?? [];
  }
  async run(sql: string, ...params: Param[]): Promise<D1Result> {
    this.budget.useD1(1);
    return this.count(await this.stmt(sql, ...params).run());
  }
  async batch(stmts: D1PreparedStatement[]): Promise<D1Result[]> {
    if (!stmts.length) return [];
    this.budget.useD1(stmts.length);
    return this.count(await this.db.batch(stmts));
  }
  /** Counted but never refused: bookkeeping that must not be skipped (settling AI spend, storing a paid-for result). */
  async batchAlways(stmts: D1PreparedStatement[]): Promise<D1Result[]> {
    if (!stmts.length) return [];
    this.budget.d1 += stmts.length;
    return this.count(await this.db.batch(stmts));
  }
}

export interface Ctx {
  env: Env;
  now: number;
  plan: Plan;
  caps: ReturnType<typeof capsFor>;
  limits: Limits;
  budget: Budget;
  db: Db;
  /** External fetch, counted against the subrequest budget. */
  fetch: (input: string | Request, init?: RequestInit) => Promise<Response>;
  rid: string;
  errors: string[];
  waitUntil: (p: Promise<unknown>) => void;
  bodyRead: boolean;
}

export function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function makeCtx(env: Env, now: number, waitUntil: (p: Promise<unknown>) => void): Ctx {
  const plan: Plan = env.WORKERS_PLAN === 'paid' ? 'paid' : 'free';
  const caps = capsFor(plan);
  const k = knobs(env);
  const limits = { ...LIMITS } as Limits;
  for (const key of Object.keys(LIMITS) as (keyof Limits)[]) if (typeof k[key] === 'number') limits[key] = k[key] as number;
  const budget = new Budget(typeof k.d1Budget === 'number' ? k.d1Budget : caps.d1Budget, typeof k.subBudget === 'number' ? k.subBudget : caps.subBudget);
  const ctx: Ctx = {
    env, now, plan, caps, limits, budget,
    db: new Db(env.DB, budget),
    fetch: async (input, init) => { budget.useSub(1); return fetch(input, init); },
    rid: randomHex(8),
    errors: [],
    waitUntil,
    bodyRead: false,
  };
  return ctx;
}

/** The request clock: real time, or X-DLS-Test-Now in the test bundle. */
export function requestNow(req: Request): number {
  if (__TESTING__) {
    const t = Number(req.headers.get('X-DLS-Test-Now'));
    if (Number.isFinite(t) && t > 0) return t;
  }
  return Date.now();
}

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const iso = (ms: number) => new Date(ms).toISOString();

export function nextUtcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** Records an error code for the log table (flushed at the end of the invocation). */
export function logCode(ctx: Ctx, code: string) {
  ctx.errors.push(code);
  console.log(JSON.stringify({ rid: ctx.rid, code }));
}

export async function flushLog(ctx: Ctx) {
  if (!ctx.errors.length) return;
  const codes = ctx.errors.splice(0);
  ctx.budget.d1 += 1;
  try {
    // Outside the budget on purpose: losing the log because a step used its allowance would hide the reason.
    await ctx.env.DB.prepare("INSERT INTO log (t, code) SELECT ?, value FROM json_each(?)").bind(ctx.now, JSON.stringify(codes)).run();
  } catch { /* logging must never fail an invocation */ }
}

export function requireR2(ctx: Ctx): R2Bucket {
  if (!ctx.env.FILES) throw new ServerError(409, 'NOT_CONFIGURED', { missing: ['R2'], feature: 'files' });
  return ctx.env.FILES;
}
