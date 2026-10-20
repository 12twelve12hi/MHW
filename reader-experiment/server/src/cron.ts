// The Cron run, every minute (DESIGN.md 2.3): each step has its own D1 and subrequest allowance and its own try/catch,
// so one failing step never fails the others. A run does at most one heavy step on the Free plan.

import type { Ctx } from './env.ts';
import { HOUR, MIN, BudgetError, logCode, flushLog } from './env.ts';
import type { Identity } from './keys.ts';
import { configDue, publishConfig } from './config.ts';
import { outboxCleanup, pollAcks, publishDue } from './outbox.ts';
import { checkDueFeeds, entriesCleanup, sendEachItems } from './feeds.ts';
import { digestDue, runDigest } from './digest.ts';
import { mailCleanup, processOneEmail } from './email.ts';
import { jobsCleanup, processOneJob } from './ai.ts';
import { filesCleanup } from './files.ts';
import { sourcesCleanup } from './sources.ts';
import type { Settings } from './settings.ts';
import { isLocked, loadCronSettings, saveStmt } from './settings.ts';

export interface CronReport { steps: Record<string, string>; d1: number; sub: number }

async function step(ctx: Ctx, report: CronReport, name: string, d1: number, sub: number, fn: () => Promise<unknown>) {
  ctx.budget.step(d1, sub);
  try {
    const r = await fn();
    report.steps[name] = r === undefined ? 'ok' : String(r);
  } catch (e) {
    const code = e instanceof BudgetError ? 'BUDGET' : (e as { code?: string })?.code ?? 'STEP_FAILED';
    report.steps[name] = `error:${code}`;
    if (__TESTING__) report.steps[name] += ` ${(e as Error)?.message ?? e}`;
    logCode(ctx, `CRON_${name.toUpperCase()}_${code}`);
  } finally {
    ctx.budget.endStep();
  }
}

/** First run under a new Server code (3.4): data sealed for the old pairing is expired. */
async function rekey(ctx: Ctx, fp: string, s: Settings) {
  const stmts = [
    ctx.db.stmt(`UPDATE outbox SET state = 'expired' WHERE fp != ? AND state IN ('queued', 'sent')`, fp),
    ctx.db.stmt(`DELETE FROM frames WHERE item_id IN (SELECT id FROM outbox WHERE fp != ?)`, fp),
    ctx.db.stmt(`UPDATE files SET expires = 0 WHERE fp != ?`, fp),
    ctx.db.stmt(`UPDATE sources SET expires = 0 WHERE fp != ?`, fp),
    saveStmt(ctx, { fp, ackSince: 'all' }),
  ];
  await ctx.db.batch(stmts);
  s.fp = fp; s.ackSince = 'all';
}

function ackDue(id: Identity, s: Settings, now: number): boolean {
  const since = now - (s.ackAt ?? 0);
  if (since >= 6 * HOUR) return true;
  if (since < 30 * MIN) return false;
  return (s._awaiting ?? 0) > 0 || (id.delivery.mode === 'lab' && !s.inbox?.lastSeen);
}

async function cleanup(ctx: Ctx, id: Identity, s: Settings) {
  const fp = id.values.fingerprint;
  const half = Math.floor(ctx.now / HOUR) % 2;
  const stmts: D1PreparedStatement[] = half === 0
    ? [
      ...outboxCleanup(ctx),
      jobsCleanup(ctx),
      entriesCleanup(ctx),
      ctx.db.stmt('DELETE FROM usage WHERE day < ?', new Date(ctx.now - 90 * 24 * HOUR).toISOString().slice(0, 10)),
      ctx.db.stmt('DELETE FROM log WHERE rowid NOT IN (SELECT rowid FROM log ORDER BY t DESC LIMIT 200)'),
    ]
    : [...(await filesCleanup(ctx, fp)), ...(await sourcesCleanup(ctx, fp)), ...(await mailCleanup(ctx))];
  const res = await ctx.db.batch([...stmts, saveStmt(ctx, { cleanupAt: ctx.now })]);
  const size = res.map((r) => (r.meta as { size_after?: number })?.size_after ?? 0).reduce((a, b) => Math.max(a, b), 0);
  s.cleanupAt = ctx.now;
  if (size) {
    s.d1Bytes = size;
    await ctx.db.batch([saveStmt(ctx, { d1Bytes: size })]);
  }
  return half === 0 ? 'outbox,jobs,entries,usage,log' : 'files,sources,mail';
}

export async function runCron(ctx: Ctx, id: Identity): Promise<CronReport> {
  const report: CronReport = { steps: {}, d1: 0, sub: 0 };
  const fp = id.values.fingerprint;
  let s: Settings = {};
  await step(ctx, report, 'settings', 6, 0, async () => {
    s = await loadCronSettings(ctx, fp);
    if (s.fp !== fp) await rekey(ctx, fp, s);
  });
  const locked = isLocked(s, fp);
  const backingOff = !!s.relay && s.relay.retryAt > ctx.now;
  if (!locked) {
    if (configDue(id, s, ctx.now) && !backingOff) await step(ctx, report, 'config', 2, 1, () => publishConfig(ctx, id, s).then((c) => c.status));
    if (ackDue(id, s, ctx.now)) await step(ctx, report, 'acks', 3, 1, () => pollAcks(ctx, id, s).then((r) => r.delivered));
    if ((s._due ?? 0) > 0 && !backingOff) await step(ctx, report, 'outbox', 5, ctx.limits.messagesPerRun, () => publishDue(ctx, id, s));
    if ((s._feeds ?? 0) > 0) await step(ctx, report, 'feeds', 10, 15, () => checkDueFeeds(ctx, id, s));
    if ((s._pending ?? 0) > 0) await step(ctx, report, 'each', 5, 0, () => sendEachItems(ctx, id, s));
    if (digestDue(s, ctx.now).due) await step(ctx, report, 'digest', 7, 0, () => runDigest(ctx, id, s));
    let heavy = ctx.caps.heavySteps;
    let preferJobs = Math.floor(ctx.now / MIN) % 2 === 0;
    while (heavy-- > 0 && ((s._mail ?? 0) > 0 || (s._jobs ?? 0) > 0)) {
      const doJob = (s._jobs ?? 0) > 0 && (preferJobs || (s._mail ?? 0) === 0);
      if (doJob) {
        await step(ctx, report, `job${heavy}`, 10, 3, () => processOneJob(ctx, id, s));
        s._jobs = (s._jobs ?? 1) - 1;
      } else {
        await step(ctx, report, `email${heavy}`, 10, 0, () => processOneEmail(ctx, id));
        s._mail = (s._mail ?? 1) - 1;
      }
      preferJobs = !preferJobs;
    }
  }
  if (ctx.now - (s.cleanupAt ?? 0) >= HOUR) await step(ctx, report, 'cleanup', 9, 0, () => cleanup(ctx, id, s));
  await flushLog(ctx);
  report.d1 = ctx.budget.d1;
  report.sub = ctx.budget.sub;
  return report;
}
