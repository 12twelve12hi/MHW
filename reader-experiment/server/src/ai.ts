// AI (DESIGN.md 9): POST /v1/ai with keepalives, async jobs, the cost guard and delivery of results to the Daylight.

import { cleanTitle } from '../../share/js/daylight-share.js';
import { publicUrl } from '../client/daylight-server.js';
import type { Ctx, Env } from './env.ts';
import { DAY, iso, logCode, nextUtcMidnight, randomHex, utcDay, flushLog, testKillPoint } from './env.ts';
import type { Identity } from './keys.ts';
import { ServerError, baseHeaders, json } from './errors.ts';
import { readJson } from './auth.ts';
import type { AiInput, DocSource, Length, Mode, Op } from './claude.ts';
import { attemptMicros, buildParams, costMicros, countParams, inputChars, makeClient, mapClaudeError, readResponse, reserveMicros, writesCache } from './claude.ts';
import type { ResolvedSource } from './sources.ts';
import { checkFetchUrl, checkText, fetchUrlSource, loadSource, newPlaceholder, splicingFetch, storeTextSource } from './sources.ts';
import { buildItem, storeManyStatements } from './outbox.ts';
import type { Settings } from './settings.ts';
import { d1Paused, inboxPresent, saveStmt } from './settings.ts';
import { aiLimits, currentKeyFp } from './status.ts';
import { esc, hostOf, localParts, renderMarkdown, wrapPage } from './html.ts';

const COUNT_ABOVE_CHARS = 50_000;

type SourceSpec =
  | { kind: 'text'; text: string; title: string; url: string | null }
  | { kind: 'url'; url: string }
  | { kind: 'id'; sourceId: string };

export interface AiRequest {
  input: AiInput;
  source: SourceSpec | null;
  deliver: 'app' | 'daylight' | 'both';
  about: { id?: string; url?: string };
}

const str = (v: unknown, max: number, field: string, required = false): string | undefined => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ServerError(400, 'BAD_REQUEST', { message: `That request isn’t valid (${field}).` });
    return undefined;
  }
  if (typeof v !== 'string' || v.length > max) throw new ServerError(400, 'BAD_REQUEST', { message: `That request isn’t valid (${field}).` });
  return v;
};

function oneOf<T extends string>(v: unknown, allowed: readonly T[], def: T, field: string): T {
  if (v === undefined || v === null) return def;
  if (!allowed.includes(v as T)) throw new ServerError(400, 'BAD_REQUEST', { message: `That request isn’t valid (${field}).` });
  return v as T;
}

/** A history question: as long as a question or passage may be. */
export const HISTORY_Q_MAX = 4000;
/** A history answer: longer than any answer the server returns (16,000 output tokens), so follow-ups never fail. */
export const HISTORY_A_MAX = 100_000;
/** History the server keeps: the most recent turns up to this many characters of JSON (≈ 12,000 tokens). */
export const HISTORY_KEEP = 48_000;

/**
 * The most recent turns of `history` whose JSON fits HISTORY_KEEP characters (9.1). Older turns are dropped; when the
 * newest turn alone is over, its answer is cut to fit, ending in "…". The client can pass history verbatim.
 */
export function trimHistory(history: { q: string; a: string }[], keep = HISTORY_KEEP): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const size = JSON.stringify(history[i]).length;
    if (used + size <= keep) { out.unshift(history[i]); used += size; continue; }
    if (!out.length) {
      const room = keep - JSON.stringify({ q: history[i].q, a: '…' }).length;
      let cut = Math.max(0, Math.min(history[i].a.length, room));
      while (cut > 0 && JSON.stringify(history[i].a.slice(0, cut)).length - 2 > room) cut = Math.floor(cut * 0.8);
      let a = history[i].a.slice(0, cut);
      if (/[\ud800-\udbff]$/.test(a)) a = a.slice(0, -1);
      out.unshift({ q: history[i].q, a: a + '…' });
    }
    break;
  }
  return out;
}

/** Size of a JSON value as the server would write it (characters). */
const jsonSize = (v: unknown) => JSON.stringify(v ?? null).length;

/** Validates the body of POST /v1/ai and POST /v1/ai/jobs (10.9); `caps`: the plan's text caps (9.2). */
export function validateAi(body: Record<string, unknown>, caps?: { aiTextChars: number; aiTextBytes: number }): AiRequest {
  const op = oneOf<Op>(body.op, ['summary', 'explain', 'ask'], 'summary', 'op');
  if (body.op === undefined) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (op).' });
  const mode = oneOf<Mode>(body.mode, ['summary', 'keypoints', 'both'], 'both', 'mode');
  const length = oneOf<Length>(body.length, ['short', 'medium', 'long'], 'medium', 'length');
  const lang = str(body.lang, 35, 'lang') ?? 'auto';
  if (lang !== 'auto' && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(lang)) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (lang).' });
  const passage = str(body.passage, 4000, 'passage', op === 'explain');
  const question = str(body.question, 2000, 'question', op === 'ask');
  let history: { q: string; a: string }[] | undefined;
  if (body.history !== undefined) {
    if (!Array.isArray(body.history) || body.history.length > 10) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (history).' });
    history = trimHistory(body.history.map((h: { q?: unknown; a?: unknown }) => ({
      q: str(h?.q, HISTORY_Q_MAX, 'history', true)!, a: str(h?.a, HISTORY_A_MAX, 'history', true)!,
    })));
  }
  const deliver = oneOf(body.deliver, ['app', 'daylight', 'both'] as const, 'app', 'deliver');
  const aboutRaw = (body.about ?? {}) as Record<string, unknown>;
  const about: { id?: string; url?: string } = {};
  if (typeof aboutRaw.id === 'string' && /^[0-9a-f]{32}$/.test(aboutRaw.id)) about.id = aboutRaw.id;
  if (typeof aboutRaw.url === 'string') { const u = publicUrl(aboutRaw.url); if (u) about.url = u; }
  let source: SourceSpec | null = null;
  const s = body.source as Record<string, unknown> | undefined;
  if (s !== undefined && s !== null) {
    if (typeof s !== 'object') throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (source).' });
    if (typeof s.sourceId === 'string') source = { kind: 'id', sourceId: s.sourceId };
    else if (typeof s.text === 'string') {
      source = { kind: 'text', text: checkText(s.text, caps), title: cleanTitle(str(s.title, 1000, 'source.title') ?? ''), url: typeof s.url === 'string' ? publicUrl(s.url) : null };
    } else if (typeof s.url === 'string') source = { kind: 'url', url: s.url };
    else throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (source).' });
  }
  if (!source && op !== 'explain') throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (source).' });
  return { input: { op, mode, length, lang, passage, question, history }, source, deliver, about };
}

/** Checks that need no network: the key, R2 for PDFs, the Lab Inbox for deliveries, URL shape, the source id. */
export async function precheck(ctx: Ctx, id: Identity, s: Settings, r: AiRequest): Promise<ResolvedSource | null> {
  if (r.deliver !== 'app' && id.delivery.mode === 'lab' && !inboxPresent(s)) throw new ServerError(409, 'NEEDS_LAB_INBOX', { feature: 'deliver' });
  if (r.source?.kind === 'url') checkFetchUrl(r.source.url);
  if (r.source?.kind === 'id') return loadSource(ctx, id, r.source.sourceId);
  return null;
}

/** Resolves the source to text or PDF parts; text and fetched pages are stored as text sources for 24 h. */
export async function resolveSource(ctx: Ctx, id: Identity, s: Settings, r: AiRequest, pre: ResolvedSource | null): Promise<ResolvedSource | null> {
  if (pre) return pre;
  if (!r.source) return null;
  if (r.source.kind === 'text') {
    const sid = await storeTextSource(ctx, id, r.source.text, r.source.title, r.source.url, d1Paused(ctx, s));
    return { id: sid, type: 'text', title: r.source.title, url: r.source.url, text: r.source.text };
  }
  if (r.source.kind === 'url') {
    const page = await fetchUrlSource(ctx, id, r.source.url);
    const title = cleanTitle(page.title);
    const url = publicUrl(page.url);
    const sid = await storeTextSource(ctx, id, page.text, title, url, d1Paused(ctx, s));
    return { id: sid, type: 'text', title, url, text: page.text };
  }
  return loadSource(ctx, id, r.source.sourceId);
}

function testBaseURL(env: Env): string | undefined {
  // __TESTING__ is a build-time define: false in every deploy bundle, where esbuild drops this block, so a deployed
  // Worker never reads a test variable whatever is set on it. CI greps the bundle to prove it.
  if (__TESTING__) {
    if (env.TEST_ANTHROPIC_BASE_URL) return env.TEST_ANTHROPIC_BASE_URL;
  }
  return undefined;
}

/** A reservation; `hold` names its row in `holds` (POST /v1/ai only: jobs keep theirs on the job row). */
export interface Reservation { day: string; micros: number; hold?: string }

/** A hold is settled by Cron once the call it covers can no longer be running: the Claude timeout plus this margin. */
const HOLD_MARGIN_MS = 5 * 60_000;

/** A job row written in the same batch as its reservation, so one never exists without the other (9.3 rule 4). */
export type JobWrite =
  | { kind: 'insert'; id: string; op: string; input: string; expires: number }
  | { kind: 'update'; id: string };

/**
 * Reserves the worst case atomically (9.3). Throws 429 AI_DAILY_LIMIT. With `job`, the job row is inserted (or its
 * reservation recorded) in the same batch and under the same cap condition, so it takes effect exactly when the
 * reservation does: a run cut short between the two can't leave a reservation nobody will settle. Without one (POST
 * /v1/ai), a hold row plays that part: the Cron run settles it as spent if the request never does (9.5).
 */
export async function reserve(ctx: Ctx, s: Settings, micros: number, job?: JobWrite): Promise<Reservation> {
  const day = utcDay(ctx.now);
  const l = aiLimits(ctx, s);
  const max = Math.round(l.dailyUsd * 1e6);
  const capOk = `EXISTS (SELECT 1 FROM usage WHERE day = ?2 AND kind = 'ai' AND n < ?3 AND usd_micros + reserved_micros + ?1 <= ?4)`;
  const jobStmt = !job ? [] : job.kind === 'insert'
    ? [ctx.db.stmt(
      `INSERT INTO jobs (id, op, state, created, reserved_micros, reserved_day, input, expires)
       SELECT ?5, ?6, 'queued', ?7, ?1, ?2, ?8, ?9 WHERE ${capOk}`,
      micros, day, l.maxRequests, max, job.id, job.op, ctx.now, job.input, job.expires,
    )]
    : [ctx.db.stmt(`UPDATE jobs SET reserved_micros = ?1, reserved_day = ?2 WHERE id = ?5 AND ${capOk}`, micros, day, l.maxRequests, max, job.id)];
  const hold = job ? undefined : randomHex(16);
  const holdStmt = !hold ? [] : [ctx.db.stmt(
    `INSERT INTO holds (id, day, micros, until) SELECT ?5, ?2, ?1, ?6 WHERE ${capOk}`,
    micros, day, l.maxRequests, max, hold, ctx.now + ctx.limits.aiTimeoutMs + HOLD_MARGIN_MS,
  )];
  const res = await ctx.db.batch([
    ctx.db.stmt("INSERT OR IGNORE INTO usage (day, kind) VALUES (?, 'ai')", day),
    ...jobStmt,
    ...holdStmt,
    ctx.db.stmt(
      `UPDATE usage SET n = n + 1, reserved_micros = reserved_micros + ?1
       WHERE day = ?2 AND kind = 'ai' AND n < ?3 AND usd_micros + reserved_micros + ?1 <= ?4`,
      micros, day, l.maxRequests, max,
    ),
  ]);
  if ((res[res.length - 1]?.meta?.changes ?? 0) === 0) {
    // Which condition failed: the request ceiling (set at deploy, so the answer names its variable: limitRequests), or
    // the dollar cap. A request whose worst case alone is over today's cap says so (needUsd), instead of "used up".
    const row = await ctx.db.first<{ n: number }>("SELECT n FROM usage WHERE day = ? AND kind = 'ai'", day);
    const byCount = Number(row?.n ?? 0) >= l.maxRequests;
    const needUsd = !byCount && micros > max ? Math.ceil(micros / 1e4) / 100 : undefined;
    throw new ServerError(429, 'AI_DAILY_LIMIT', {
      limit: l.dailyUsd, resetAt: iso(nextUtcMidnight(ctx.now)), ceilingUsd: l.ceilingUsd,
      ...(byCount ? { limitRequests: l.maxRequests } : {}), ...(needUsd ? { needUsd } : {}),
    });
  }
  return hold ? { day, micros, hold } : { day, micros };
}

/**
 * Releases the reservation and adds the real cost; `spent` keeps it all as spent (unknown outcome). A reservation with
 * a hold is settled only while its hold exists (the Cron run may have kept it as spent already), so it is settled
 * exactly once; holdDoneStmt follows it in the same batch.
 */
export function settleStmt(ctx: Ctx, r: Reservation, actual: number | 'spent', tokensIn = 0, tokensOut = 0): D1PreparedStatement {
  const cost = actual === 'spent' ? r.micros : actual;
  return ctx.db.stmt(
    `UPDATE usage SET reserved_micros = MAX(0, reserved_micros - ?1), usd_micros = usd_micros + ?2,
       tokens_in = tokens_in + ?3, tokens_out = tokens_out + ?4 WHERE day = ?5 AND kind = 'ai'${r.hold ? ' AND EXISTS (SELECT 1 FROM holds WHERE id = ?6)' : ''}`,
    ...[r.micros, cost, tokensIn, tokensOut, r.day, ...(r.hold ? [r.hold] : [])],
  );
}

/** The hold's end, after its settleStmt in the same batch. */
const holdDoneStmt = (ctx: Ctx, r: Reservation) => (r.hold ? [ctx.db.stmt('DELETE FROM holds WHERE id = ?', r.hold)] : []);

/**
 * Cron: POST /v1/ai reservations whose request ended without settling (cut short: a CPU kill, or the client gone for
 * longer than waitUntil's 30 s) are kept as spent once the call can no longer be running (9.3, 9.5). One batch, so
 * each hold is counted once. -> how many.
 */
export async function settleStaleHolds(ctx: Ctx): Promise<number> {
  const stale = '(SELECT COALESCE(SUM(micros), 0) FROM holds h WHERE h.day = usage.day AND h.until < ?1)';
  const res = await ctx.db.batchAlways([
    ctx.db.stmt(
      `UPDATE usage SET reserved_micros = MAX(0, reserved_micros - ${stale}), usd_micros = usd_micros + ${stale}
       WHERE kind = 'ai' AND day IN (SELECT day FROM holds WHERE until < ?1)`,
      ctx.now,
    ),
    ctx.db.stmt('DELETE FROM holds WHERE until < ?', ctx.now),
  ]);
  return res[1]?.meta?.changes ?? 0;
}

/** The job's record of its reservation, cleared in the same batch as the settlement. */
const jobSettledStmt = (ctx: Ctx, jobId: string) => ctx.db.stmt('UPDATE jobs SET reserved_micros = 0 WHERE id = ?', jobId);

export interface AiOutcome {
  result: Record<string, unknown>;
  sourceId: string | null;
  model: string;
  fallback: boolean;
  usage: { inputTokens: number; outputTokens: number; usd: number };
}

function docFor(src: ResolvedSource | null): { doc: DocSource | null; placeholder: string | null } {
  if (!src) return { doc: null, placeholder: null };
  if (src.type === 'pdf') {
    const placeholder = newPlaceholder(src.id);
    return { doc: { kind: 'pdf', placeholder, title: src.title || undefined }, placeholder };
  }
  return { doc: { kind: 'text', text: src.text ?? '', title: src.title || undefined }, placeholder: null };
}

/** Input tokens: counted with countTokens (free) above 50,000 characters and for every PDF, else 1 per character. */
async function inputTokens(ctx: Ctx, client: ReturnType<typeof makeClient>, params: ReturnType<typeof buildParams>, src: ResolvedSource | null): Promise<number> {
  const chars = inputChars(params);
  if (src?.type !== 'pdf' && chars <= COUNT_ABOVE_CHARS) return chars;
  try {
    return (await client.beta.messages.countTokens(countParams(params))).input_tokens;
  } catch (e) {
    throw mapClaudeError(e).error;
  }
}

function clientFor(ctx: Ctx, src: ResolvedSource | null, placeholder: string | null) {
  const base = (input: string | URL | Request, init?: RequestInit) => ctx.fetch(input as string, init);
  const f = src?.type === 'pdf' && placeholder ? splicingFetch(ctx, base, src, placeholder) : base;
  return makeClient(ctx.env.ANTHROPIC_API_KEY!, f, ctx.limits.aiTimeoutMs, testBaseURL(ctx.env));
}

/**
 * Counts, reserves (unless `reserved` is given), calls Claude and settles. Errors are ServerErrors with the 9.4 codes.
 */
export async function runClaude(ctx: Ctx, s: Settings, input: AiInput, src: ResolvedSource | null, reserved?: Reservation, jobId?: string): Promise<AiOutcome> {
  const { doc, placeholder } = docFor(src);
  const params = buildParams(input, doc);
  const client = clientFor(ctx, src, placeholder);
  let reservation = reserved;
  if (!reservation) {
    const tokens = await inputTokens(ctx, client, params, src);
    if (tokens > ctx.limits.aiInputTokens) {
      throw new ServerError(413, 'AI_TOO_LARGE', { tokens, limit: ctx.limits.aiInputTokens, estimateUsd: Math.round(attemptMicros(tokens) / 1e4) / 100 });
    }
    reservation = await reserve(ctx, s, reserveMicros(tokens, { cached: writesCache(params) }), jobId ? { kind: 'update', id: jobId } : undefined);
  }
  testKillPoint(ctx.env, 'ai-after-reserve');
  // A job's own record of the reservation is cleared together with the settlement, so a job retried after the run
  // was cut short can never reuse a reservation that is already settled (9.3). A hold ends with its settlement.
  const settledJob = [...(jobId ? [jobSettledStmt(ctx, jobId)] : []), ...holdDoneStmt(ctx, reservation)];
  let response;
  try {
    response = await client.beta.messages.create(params);
  } catch (e) {
    const m = mapClaudeError(e);
    const stmts = [settleStmt(ctx, reservation, m.reservation === 'kept' ? 'spent' : 0), ...settledJob];
    if (m.record) {
      const aiError = { code: m.record, keyFp: await currentKeyFp(ctx.env.ANTHROPIC_API_KEY), at: ctx.now };
      stmts.push(saveStmt(ctx, { aiError }));
      s.aiError = aiError;
    }
    logCode(ctx, m.error.code);
    await ctx.db.batchAlways(stmts); // money bookkeeping is never skipped for a budget
    throw m.error;
  }
  const cost = costMicros(response);
  const stmts = [settleStmt(ctx, reservation, cost.micros, cost.tokensIn, cost.tokensOut), ...settledJob];
  if (s.aiError) { stmts.push(ctx.db.stmt("DELETE FROM settings WHERE k = 'aiError'")); delete s.aiError; }
  await ctx.db.batchAlways(stmts);
  const read = readResponse(input.op, response);
  return {
    result: read.result, sourceId: src?.id ?? null, model: read.model, fallback: read.fallback,
    usage: { inputTokens: cost.tokensIn, outputTokens: cost.tokensOut, usd: Math.round(cost.micros) / 1e6 },
  };
}

/** The page item for a result sent to the Daylight (9.1). */
export function resultPage(input: AiInput, out: AiOutcome, src: ResolvedSource | null, about: { url?: string }, now: number): { title: string; html: string } {
  const articleUrl = publicUrl(src?.url ?? about.url ?? '');
  const host = hostOf(articleUrl);
  const p = localParts(now, 'UTC');
  const date = `${p.day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][p.month - 1]} ${p.year}`;
  const link = articleUrl ? `<a href="${esc(articleUrl)}">${esc(host)}</a> · ` : '';
  if (input.op === 'summary') {
    const r = out.result as { title: string; summary: string; keyPoints: string[]; language?: string };
    const docTitle = cleanTitle(r.title || src?.title || 'Document');
    const title = cleanTitle(`Summary · ${docTitle}`);
    const body = `<h1>${esc(docTitle)}</h1><p>${link}Summary by Claude · ${esc(date)}</p>`
      + (r.summary ? `<h2>Summary</h2>${renderMarkdown(r.summary)}` : '')
      + (r.keyPoints?.length ? `<h2>Key points</h2><ul>${r.keyPoints.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>` : '');
    return { title, html: wrapPage({ title, source: 'ai' }, body, r.language || '') };
  }
  const docTitle = cleanTitle(src?.title || 'Document');
  const title = cleanTitle(`Q&A · ${docTitle}`);
  const q = input.op === 'explain' ? input.passage ?? '' : input.question ?? '';
  const body = `<h1>${esc(docTitle)}</h1><p>${link}Answer by Claude · ${esc(date)}</p>`
    + `<h2>${input.op === 'explain' ? 'Passage' : 'Question'}</h2><blockquote><p>${esc(q)}</p></blockquote>`
    + (input.op === 'explain' && input.question ? `<p>${esc(input.question)}</p>` : '')
    + `<h2>Answer</h2>${renderMarkdown(String((out.result as { answer?: string }).answer ?? ''))}`;
  return { title, html: wrapPage({ title, source: 'ai' }, body) };
}

/** Stores the result as a page item for the Daylight. -> {id}. */
export async function deliverResult(ctx: Ctx, id: Identity, input: AiInput, out: AiOutcome, src: ResolvedSource | null, about: { id?: string; url?: string }, originId: string): Promise<{ id: string }> {
  const page = resultPage(input, out, src, about, ctx.now);
  const xAbout: Record<string, string> = {};
  const aboutUrl = publicUrl(src?.url ?? about.url ?? '');
  if (aboutUrl) xAbout.url = aboutUrl;
  if (about.id) xAbout.id = about.id;
  if (src?.type === 'pdf') xAbout.sha256 = src.id;
  const built = await buildItem(id, { origin: `ai:${originId}`, kind: 'page', title: page.title, content: page.html, from: 'Claude', xOrigin: 'ai', xAbout });
  await ctx.db.batchAlways(storeManyStatements(ctx, id.values.fingerprint, [built]));
  return { id: built.id };
}

/** Starts a 200 response at once and writes a newline every 15 s, then exactly one JSON object (9.5). */
function keepaliveResponse(ctx: Ctx, work: () => Promise<unknown>): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const timer = setInterval(() => { writer.write(enc.encode('\n')).catch(() => {}); }, ctx.limits.keepaliveMs);
  const done = (async () => {
    let body: unknown;
    try {
      body = await work();
    } catch (e) {
      const err = e instanceof ServerError ? e : mapClaudeError(e).error;
      body = err.body();
    }
    clearInterval(timer);
    try {
      await writer.write(enc.encode(JSON.stringify(body)));
      await writer.close();
    } catch { /* the client went away */ }
    await flushLog(ctx);
  })();
  done.catch(() => clearInterval(timer));
  // If the client goes away (a phone locks), Cloudflare cancels the request's work: waitUntil keeps it going for up to
  // 30 s more, so a call that ends by then is still settled (and delivered). Longer, the hold is settled by Cron (9.5).
  ctx.waitUntil(done.catch(() => {}));
  return new Response(readable, { status: 200, headers: baseHeaders(ctx.rid, { 'Content-Type': 'application/json; charset=utf-8' }) });
}

/** POST /v1/ai */
export async function aiRequest(ctx: Ctx, id: Identity, s: Settings, req: Request): Promise<Response> {
  if (!ctx.env.ANTHROPIC_API_KEY) throw new ServerError(409, 'NEEDS_KEY', { feature: 'ai', missing: ['ANTHROPIC_API_KEY'] });
  const body = await readJson(ctx, req, ctx.limits.aiBody);
  const r = validateAi(body, ctx.caps);
  // Only a text source makes a large body; history may be long too (each answer as long as the server wrote it), so
  // the 64 KiB rule applies to the rest.
  if (r.source?.kind !== 'text' && jsonSize({ ...body, history: undefined }) > ctx.limits.jsonBody) {
    throw new ServerError(413, 'TOO_LARGE', { limit: ctx.limits.jsonBody });
  }
  const pre = await precheck(ctx, id, s, r);
  const requestId = randomHex(16);
  return keepaliveResponse(ctx, async () => {
    const src = await resolveSource(ctx, id, s, r, pre);
    const out = await runClaude(ctx, s, r.input, src);
    let delivered: { id: string } | null = null;
    if (r.deliver !== 'app') delivered = await deliverResult(ctx, id, r.input, out, src, r.about, requestId);
    return { result: out.result, sourceId: out.sourceId, model: out.model, fallback: out.fallback, usage: out.usage, delivered };
  });
}

// ---- jobs

interface JobRow { id: string; op: string; state: string; created: number; attempts: number; reserved_micros: number; reserved_day: string | null; input: string; result: string | null; error: string | null; delivered: string | null; expires: number }

function jobJson(j: JobRow) {
  const out: Record<string, unknown> = { id: j.id, state: j.state === 'running' ? 'running' : j.state, created: iso(j.created) };
  if (j.result) out.result = JSON.parse(j.result);
  if (j.error) out.error = new ServerError(0, j.error).body().error;
  if (j.delivered) out.delivered = JSON.parse(j.delivered);
  return out;
}

/** POST /v1/ai/jobs: validates, resolves the source, reserves the worst case and queues (9.1, 9.3 rule 4). */
export async function aiJobCreate(ctx: Ctx, id: Identity, s: Settings, req: Request): Promise<Response> {
  if (!ctx.env.ANTHROPIC_API_KEY) throw new ServerError(409, 'NEEDS_KEY', { feature: 'ai', missing: ['ANTHROPIC_API_KEY'] });
  const r = validateAi(await readJson(ctx, req, ctx.limits.aiBody), ctx.caps);
  if (id.delivery.mode === 'lab' && !inboxPresent(s)) throw new ServerError(409, 'NEEDS_LAB_INBOX', { feature: 'deliver' });
  const queued = await ctx.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('queued', 'running')");
  if ((queued?.n ?? 0) >= ctx.limits.aiQueue) throw new ServerError(429, 'AI_QUEUE_FULL', { retryAfter: 300 });
  const pre = await precheck(ctx, id, s, { ...r, deliver: 'app' });
  const src = await resolveSource(ctx, id, s, r, pre);
  // Every check comes before the reservation, which is written together with the job row.
  const input = JSON.stringify({ input: r.input, sourceId: src?.id ?? null, about: r.about });
  if (input.length > ctx.limits.jsonBody) throw new ServerError(413, 'TOO_LARGE', { limit: ctx.limits.jsonBody });
  const { doc, placeholder } = docFor(src);
  const params = buildParams(r.input, doc);
  const tokens = await inputTokens(ctx, clientFor(ctx, src, placeholder), params, src);
  if (tokens > ctx.limits.aiInputTokens) {
    throw new ServerError(413, 'AI_TOO_LARGE', { tokens, limit: ctx.limits.aiInputTokens, estimateUsd: Math.round(attemptMicros(tokens) / 1e4) / 100 });
  }
  const jobId = randomHex(16);
  await reserve(ctx, s, reserveMicros(tokens, { cached: writesCache(params) }), { kind: 'insert', id: jobId, op: r.input.op, input, expires: ctx.now + ctx.limits.jobTtl });
  return json(ctx.rid, 202, { job: { id: jobId, state: 'queued', created: iso(ctx.now) } });
}

/** GET /v1/ai/jobs/{id} */
export async function aiJobGet(ctx: Ctx, jobId: string): Promise<Response> {
  if (!/^[0-9a-f]{32}$/.test(jobId)) throw new ServerError(404, 'NOT_FOUND');
  const j = await ctx.db.first<JobRow>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!j || j.expires <= ctx.now) throw new ServerError(404, 'NOT_FOUND');
  return json(ctx.rid, 200, { job: jobJson(j) });
}

/** Cron heavy step: runs one queued job and delivers its result to the Daylight. -> true when it did work. */
export async function processOneJob(ctx: Ctx, id: Identity, s: Settings): Promise<boolean> {
  const j = await ctx.db.first<JobRow>(
    `UPDATE jobs SET state = 'running', lease = ?1, attempts = attempts + 1
     WHERE id = (SELECT id FROM jobs WHERE state = 'queued' OR (state = 'running' AND lease < ?2) ORDER BY created LIMIT 1)
       AND (state = 'queued' OR (state = 'running' AND lease < ?2))
     RETURNING *`,
    ctx.now + 20 * 60_000, ctx.now,
  );
  if (!j) return false;
  let reservation: Reservation | undefined = j.reserved_micros > 0 && j.reserved_day ? { day: j.reserved_day, micros: j.reserved_micros } : undefined;
  if (reservation && j.attempts > 1) {
    // An earlier run ended (CPU) between reserving and settling, so whether Claude was called is unknown: the
    // reservation is kept as spent, like a timeout (9.3), and this attempt reserves anew within the cap.
    await ctx.db.batchAlways([settleStmt(ctx, reservation, 'spent'), jobSettledStmt(ctx, j.id)]);
    reservation = undefined;
  }
  const fail = async (code: string) => {
    await ctx.db.batchAlways([...(reservation ? [settleStmt(ctx, reservation, 0)] : []),
      ctx.db.stmt(`UPDATE jobs SET state = 'failed', error = ?, reserved_micros = 0 WHERE id = ?`, code, j.id)]);
    logCode(ctx, code);
    return true;
  };
  if (j.attempts > 3) return fail('SERVER_LIMIT');
  if (!ctx.env.ANTHROPIC_API_KEY) return fail('NEEDS_KEY');
  const saved = JSON.parse(j.input) as { input: AiInput; sourceId: string | null; about: { id?: string; url?: string } };
  let src: ResolvedSource | null = null;
  try {
    src = saved.sourceId ? await loadSource(ctx, id, saved.sourceId) : null;
  } catch (e) {
    return fail(e instanceof ServerError ? e.code : 'SERVER_ERROR');
  }
  testKillPoint(ctx.env, 'job-before-claude');
  let out: AiOutcome;
  try {
    out = await runClaude(ctx, s, saved.input, src, reservation, j.id);
  } catch (e) {
    // runClaude settled the reservation (kept or released) and cleared the job's record of it.
    const err = e instanceof ServerError ? e : mapClaudeError(e).error;
    if (err.code === 'AI_BUSY' && j.attempts < 3) {
      // Each attempt reserves anew on the next run.
      await ctx.db.run(`UPDATE jobs SET state = 'queued', lease = 0, reserved_micros = 0, error = ? WHERE id = ?`, err.code, j.id);
      return true;
    }
    await ctx.db.run(`UPDATE jobs SET state = 'failed', error = ?, reserved_micros = 0 WHERE id = ?`, err.code, j.id);
    logCode(ctx, err.code);
    return true;
  }
  // From here on the cost is settled. A run cut short now leaves the job 'running'; its retry reserves anew.
  testKillPoint(ctx.env, 'job-delivery');
  const delivered = await deliverResult(ctx, id, saved.input, out, src, saved.about, j.id);
  const result = { result: out.result, sourceId: out.sourceId, model: out.model, fallback: out.fallback, usage: out.usage };
  await ctx.db.batchAlways([ctx.db.stmt(`UPDATE jobs SET state = 'done', result = ?, delivered = ?, reserved_micros = 0 WHERE id = ?`, JSON.stringify(result), JSON.stringify(delivered), j.id)]);
  return true;
}

/** Hourly: jobs 24 h after expiry. */
export const jobsCleanup = (ctx: Ctx) => ctx.db.stmt('DELETE FROM jobs WHERE expires <= ?', ctx.now - DAY);
