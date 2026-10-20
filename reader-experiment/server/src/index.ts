// The Daylight server: fetch, scheduled and email handlers and the router (DESIGN.md 3.3, 10).
// Order for every request: OPTIONS -> unknown route (404) / unauthenticated routes -> bearer token (401) -> lock (423)
// -> Content-Length and caps (411 / 413) -> the body. Nothing reads the body before the token is checked.

import type { Env, Ctx } from './env.ts';
import { makeCtx, requestNow, flushLog, logCode, BudgetError } from './env.ts';
import type { Identity } from './keys.ts';
import { identity } from './keys.ts';
import { ServerError, CORS, baseHeaders, errorResponse, json, empty } from './errors.ts';
import { checkBearer, failureLimited, rateLimited, readBody, readJson } from './auth.ts';
import type { Settings } from './settings.ts';
import { loadSettings, isLocked } from './settings.ts';
import { status, getSettings, patchSettings, lockServer } from './status.ts';
import { announce } from './config.ts';
import { selftest } from './selftest.ts';
import { putPart, fileInfo, deleteFile, serveFile } from './files.ts';
import { serveItemFrame, buildItem, storeManyStatements } from './outbox.ts';
import { emailInfo, blockSender, unblockSender, recentMail, receiveEmail, itemsForEmail } from './email.ts';
import PostalMime from 'postal-mime';
import { sanitize } from './sanitize.ts';
import { extractText } from './safefetch.ts';
import { listFeeds, addFeed, patchFeed, deleteFeed, checkFeedNow, importOpml } from './feeds.ts';
import { saveSettings } from './settings.ts';
import { aiRequest, aiJobCreate, aiJobGet } from './ai.ts';
import { putSourcePart } from './sources.ts';
import { runCron } from './cron.ts';
import type { CronReport } from './cron.ts';
import { SERVER_API } from '../client/daylight-server.js';

interface Call { ctx: Ctx; id: Identity; s: Settings; req: Request; p: string[] }
type Handler = (c: Call) => Promise<Response> | Response;
interface Route { method: string; re: RegExp; handler: Handler }

const ID32 = '([0-9a-f]{32})';
const json64 = (c: Call) => readJson(c.ctx, c.req, c.ctx.limits.jsonBody);

const ROUTES: Route[] = [
  { method: 'GET', re: /^\/v1\/status$/, handler: (c) => status(c.ctx, c.id, c.s) },
  { method: 'GET', re: /^\/v1\/settings$/, handler: (c) => getSettings(c.ctx, c.s) },
  { method: 'PATCH', re: /^\/v1\/settings$/, handler: async (c) => patchSettings(c.ctx, c.s, await json64(c)) },
  { method: 'POST', re: /^\/v1\/admin\/announce$/, handler: async (c) => {
    await json64(c);
    if (c.s.announceAt && c.ctx.now - c.s.announceAt < 60_000) throw new ServerError(429, 'RATE_LIMITED', { retryAfter: 60 });
    await saveSettings(c.ctx, { announceAt: c.ctx.now });
    return json(c.ctx.rid, 200, await announce(c.ctx, c.id, c.s));
  } },
  { method: 'POST', re: /^\/v1\/admin\/selftest$/, handler: async (c) => selftest(c.ctx, c.id, c.s, await json64(c)) },
  { method: 'POST', re: /^\/v1\/admin\/lock$/, handler: async (c) => { await json64(c); await lockServer(c.ctx, c.id); return empty(c.ctx.rid, 204); } },
  { method: 'PUT', re: new RegExp(`^/v1/files/${ID32}/(\\d{1,2})$`), handler: (c) => putPart(c.ctx, c.id, c.req, c.p[0], c.p[1]) },
  { method: 'GET', re: new RegExp(`^/v1/files/${ID32}$`), handler: (c) => fileInfo(c.ctx, c.id, c.p[0]) },
  { method: 'DELETE', re: new RegExp(`^/v1/files/${ID32}$`), handler: (c) => deleteFile(c.ctx, c.p[0]) },
  { method: 'GET', re: /^\/v1\/email$/, handler: (c) => emailInfo(c.ctx, c.id, c.s) },
  { method: 'POST', re: /^\/v1\/email\/block$/, handler: async (c) => blockSender(c.ctx, c.id, await json64(c)) },
  { method: 'POST', re: /^\/v1\/email\/unblock$/, handler: async (c) => unblockSender(c.ctx, c.id, await json64(c)) },
  { method: 'GET', re: /^\/v1\/email\/recent$/, handler: (c) => recentMail(c.ctx, c.id) },
  { method: 'GET', re: /^\/v1\/feeds$/, handler: (c) => listFeeds(c.ctx, c.s) },
  { method: 'POST', re: /^\/v1\/feeds$/, handler: async (c) => addFeed(c.ctx, c.id, c.s, await json64(c)) },
  { method: 'POST', re: /^\/v1\/feeds\/import$/, handler: async (c) => importOpml(c.ctx, c.id, c.s, c.req, await readBody(c.ctx, c.req, c.ctx.limits.opmlBody)) },
  { method: 'PATCH', re: /^\/v1\/feeds\/([0-9a-f]{12})$/, handler: async (c) => patchFeed(c.ctx, c.p[0], await json64(c)) },
  { method: 'DELETE', re: /^\/v1\/feeds\/([0-9a-f]{12})$/, handler: (c) => deleteFeed(c.ctx, c.p[0]) },
  { method: 'POST', re: /^\/v1\/feeds\/([0-9a-f]{12})\/check$/, handler: async (c) => { await json64(c); return checkFeedNow(c.ctx, c.id, c.s, c.p[0]); } },
  { method: 'POST', re: /^\/v1\/digest\/send$/, handler: async (c) => {
    await json64(c);
    await saveSettings(c.ctx, { digestNow: true });
    return json(c.ctx.rid, 202, { queued: true });
  } },
  { method: 'PUT', re: new RegExp(`^/v1/ai/sources/${ID32}/(\\d{1,2})$`), handler: (c) => putSourcePart(c.ctx, c.id, c.req, c.p[0], c.p[1]) },
  { method: 'POST', re: /^\/v1\/ai$/, handler: (c) => aiRequest(c.ctx, c.id, c.s, c.req) },
  { method: 'POST', re: /^\/v1\/ai\/jobs$/, handler: (c) => aiJobCreate(c.ctx, c.id, c.s, c.req) },
  { method: 'GET', re: new RegExp(`^/v1/ai/jobs/${ID32}$`), handler: (c) => aiJobGet(c.ctx, c.p[0]) },
];

function match(method: string, path: string): { route: Route; p: string[] } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const m = route.re.exec(path);
    if (m) return { route, p: m.slice(1) };
  }
  return null;
}

let lastCron: CronReport | null = null;

/** Test-only routes that run workerd-only code (HTMLRewriter, postal-mime) for unit tests. Not in deploy bundles. */
async function testRoute(ctx: Ctx, req: Request, path: string): Promise<Response> {
  if (__TESTING__) {
    if (path === '/__test/last-cron') return json(ctx.rid, 200, lastCron ?? {});
    const body = new Uint8Array(await req.arrayBuffer());
    if (path === '/__test/sanitize') {
      const j = JSON.parse(new TextDecoder().decode(body));
      return json(ctx.rid, 200, { html: await sanitize(j.html, { cid: new Map(Object.entries(j.cid ?? {})), dropDataImages: !!j.dropDataImages }) });
    }
    if (path === '/__test/extract') return json(ctx.rid, 200, await extractText(new TextDecoder().decode(body)));
    if (path === '/__test/enqueue') {
      const j = JSON.parse(new TextDecoder().decode(body));
      const id = await identity(ctx.env);
      const content = j.b64 ? Uint8Array.from(atob(j.b64), (c) => c.charCodeAt(0)) : j.text;
      const built = await buildItem(id, { origin: j.origin, kind: j.kind, url: j.url, title: j.title, name: j.name, mime: j.mime, content, from: j.from ?? 'Test', xOrigin: j.xOrigin ?? 'ai' });
      await ctx.db.batch(storeManyStatements(ctx, id.values.fingerprint, [built]));
      return json(ctx.rid, 200, { id: built.id, parts: built.frames.length });
    }
    if (path === '/__test/email-items') {
      const email = await PostalMime.parse(body, { attachmentEncoding: 'arraybuffer', maxNestingDepth: 32 });
      const items = await itemsForEmail(email, 'm'.repeat(32), { name: '', address: '' }, Number(new URL(req.url).searchParams.get('now')) || Date.now());
      return json(ctx.rid, 200, items.map((i) => ({
        ...i, content: undefined,
        text: i.kind === 'page' ? String(i.content) : undefined,
        size: typeof i.content === 'string' ? new TextEncoder().encode(i.content).byteLength : i.content?.byteLength ?? 0,
      })));
    }
  }
  return errorResponse(ctx.rid, new ServerError(404, 'NOT_FOUND'));
}

/** Every response carries X-DLS-Request-Id, Cache-Control: no-store and the CORS headers (10.1, 10.2); the test bundle
 *  adds the invocation's counters. */
function finalize(ctx: Ctx, res: Response): Response {
  const missing = !res.headers.has('X-DLS-Request-Id');
  if (!missing && !__TESTING__) return res;
  const h = new Headers(res.headers);
  if (missing) {
    h.set('X-DLS-Request-Id', ctx.rid);
    h.set('Cache-Control', 'no-store');
    for (const [k, v] of Object.entries(CORS)) if (!h.has(k)) h.set(k, v);
  }
  if (__TESTING__) {
    h.set('X-DLS-Test-D1', String(ctx.budget.d1));
    h.set('X-DLS-Test-Sub', String(ctx.budget.sub));
    h.set('X-DLS-Test-Body-Read', ctx.bodyRead ? '1' : '0');
  }
  return new Response(res.body, { status: res.status, headers: h });
}

async function handle(ctx: Ctx, req: Request, env: Env, ectx: ExecutionContext): Promise<Response> {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS } });
    const url = new URL(req.url);
    const path = url.pathname;
    // Unauthenticated routes (10.3). They never read a body.
    if (req.method === 'GET' && path === '/v1/hello') return json(ctx.rid, 200, { service: 'daylight-server', api: SERVER_API });
    if (req.method === 'GET' && path === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', { headers: baseHeaders(ctx.rid, { 'Content-Type': 'text/plain' }) });
    }
    if (__TESTING__) {
      if (path.startsWith('/__test/')) return testRoute(ctx, req, path);
    }
    const hosted = /^\/(f|o)\/([0-9a-f]{32})\/(\d{1,2})$/.exec(path);
    if (hosted && req.method === 'GET') {
      let id: Identity;
      try { id = await identity(env); } catch { return errorResponse(ctx.rid, new ServerError(404, 'NOT_FOUND')); }
      const res = hosted[1] === 'f'
        ? await serveFile(ctx, id, hosted[2], hosted[3])
        : await serveItemFrame(ctx, id, hosted[2], Number(hosted[3]));
      if (res) return res;
      if (await failureLimited(ctx, req)) return errorResponse(ctx.rid, rateLimited());
      return errorResponse(ctx.rid, new ServerError(404, 'NOT_FOUND'));
    }
    const m = match(req.method, path);
    if (!m) return errorResponse(ctx.rid, new ServerError(404, 'NOT_FOUND'));
    let id: Identity;
    try { id = await identity(env); } catch (e) {
      return errorResponse(ctx.rid, e instanceof ServerError ? e : new ServerError(503, 'NOT_CONFIGURED', { missing: ['DAYLIGHT_SERVER_CODE'] }));
    }
    if (!checkBearer(req, id)) {
      if (await failureLimited(ctx, req)) return errorResponse(ctx.rid, rateLimited());
      return errorResponse(ctx.rid, new ServerError(401, 'BAD_AUTH'));
    }
    const s = await loadSettings(ctx);
    if (isLocked(s, id.values.fingerprint)) return errorResponse(ctx.rid, new ServerError(423, 'LOCKED'));
    return await m.route.handler({ ctx, id, s, req, p: m.p });
  } catch (e) {
    if (e instanceof ServerError) return errorResponse(ctx.rid, e);
    const code = e instanceof BudgetError ? 'BUDGET' : 'SERVER_ERROR';
    if (__TESTING__) console.log('test bundle: unexpected error', (e as Error)?.stack ?? e);
    logCode(ctx, code);
    return errorResponse(ctx.rid, new ServerError(e instanceof BudgetError ? 503 : 500, 'SERVER_ERROR', e instanceof BudgetError ? { retryAfter: 60 } : {}));
  } finally {
    if (ctx.errors.length) ectx.waitUntil(flushLog(ctx));
  }
}

export default {
  async fetch(req: Request, env: Env, ectx: ExecutionContext): Promise<Response> {
    const ctx = makeCtx(env, requestNow(req), (p) => ectx.waitUntil(p));
    return finalize(ctx, await handle(ctx, req, env, ectx));
  },

  async scheduled(controller: ScheduledController, env: Env, ectx: ExecutionContext): Promise<void> {
    let id: Identity;
    try { id = await identity(env); } catch { return; }
    const ctx = makeCtx(env, controller.scheduledTime || Date.now(), (p) => ectx.waitUntil(p));
    const report = await runCron(ctx, id);
    if (__TESTING__) lastCron = report;
  },

  async email(message: ForwardableEmailMessage, env: Env, ectx: ExecutionContext): Promise<void> {
    let id: Identity | null = null;
    try { id = await identity(env); } catch { id = null; }
    const ctx = makeCtx(env, Date.now(), (p) => ectx.waitUntil(p));
    try {
      await receiveEmail(ctx, id, message);
    } catch (e) {
      // Never bounce on our own failure: accept and log (providers unsubscribe addresses that bounce).
      logCode(ctx, e instanceof BudgetError ? 'BUDGET' : 'EMAIL_STORE_FAILED');
    }
    await flushLog(ctx);
  },
} satisfies ExportedHandler<Env>;

