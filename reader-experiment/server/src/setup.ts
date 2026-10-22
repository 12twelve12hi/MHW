// Setup without the DAYLIGHT_SERVER_CODE secret (DESIGN.md 3.5): the deploy makes a one-time setup link and keeps it in
// D1; the app the user gives it to sends its Server code here. POST /v1/setup is authenticated by the link's token,
// which the deploy uploads as the Worker secret DAYLIGHT_SETUP_TOKEN while the link waits to be used.

import { deriveServerValues, parseServerCode, SERVER_API } from '../client/daylight-server.js';
import type { Ctx } from './env.ts';
import { ServerError, baseHeaders, json } from './errors.ts';
import { failureLimited, rateLimited, readJson } from './auth.ts';
import { forgetStoredServerCode, identity } from './keys.ts';
import { isLocked, loadSettings } from './settings.ts';
import { publishConfig } from './config.ts';

const enc = new TextEncoder();
const HEX64 = /^[0-9a-f]{64}$/;

function bearerMatches(req: Request, expected: string): boolean {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization') ?? '');
  if (!m) return false;
  const a = enc.encode(m[1]);
  const b = enc.encode(expected);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

const sameSeed = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** GET /setup: the page a setup link opens in a browser. Static; it reads nothing and says what to do. */
export function setupPage(rid: string): Response {
  const text = 'This is your Daylight server’s setup link.\n\nCopy the whole link (with the part after #) and paste it into '
    + 'Send to Daylight on your iPhone or Mac: Lab settings › Daylight server › Set up with a link.\n\n'
    + 'It works once, for one pairing. Your other devices and your Daylight then find the server by themselves.\n';
  return new Response(text, { headers: baseHeaders(rid, { 'Content-Type': 'text/plain; charset=utf-8' }) });
}

/**
 * POST /v1/setup {"code": "<Server code or its link form>"} with `Authorization: Bearer <setup token>`. Stores the code
 * once (the same code again is answered as before), publishes the config frame and answers the config fields.
 * 404 when no setup link waits for this Worker; 401 for a wrong token (rate-limited); 400 for a code that does not
 * parse (a pairing code included); 409 SETUP_USED when another pairing used the link; 423 when that pairing is locked.
 */
export async function claimSetup(ctx: Ctx, req: Request): Promise<Response> {
  const env = ctx.env;
  const expected = env.DAYLIGHT_SETUP_TOKEN ?? '';
  const viaSecret = !!env.DAYLIGHT_SERVER_CODE || ((env.DELIVERY ?? 'lab') === 'v1' && !!env.DAYLIGHT_PAIRING);
  if (!HEX64.test(expected) || viaSecret) throw new ServerError(404, 'NOT_FOUND');
  if (!bearerMatches(req, expected)) {
    if (await failureLimited(ctx, req)) throw rateLimited();
    throw new ServerError(401, 'BAD_AUTH');
  }
  const body = await readJson<{ code?: unknown }>(ctx, req, ctx.limits.jsonBody);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  let seed: Uint8Array;
  try { seed = (await parseServerCode(code)).seed; } catch (e) {
    throw new ServerError(400, 'BAD_REQUEST', { message: (e as Error)?.message || 'That request isn’t valid (code).' });
  }
  const row = await ctx.db.first<{ worker: string; code: string | null }>('SELECT worker, code FROM setup WHERE id = 1');
  let host = '';
  try { host = new URL(env.SERVER_URL ?? '').hostname; } catch { host = ''; }
  // The link is for one Worker: a Worker the deploy has since replaced (and is about to delete) never takes it.
  if (!row || !host.startsWith(`${row.worker}.`)) throw new ServerError(404, 'NOT_FOUND');
  const s = await loadSettings(ctx);
  const held = async (c: string | null) => {
    if (!c) return false;
    try { if (sameSeed((await parseServerCode(c)).seed, seed)) return true; } catch { /* a bad stored code is not ours */ }
    throw new ServerError(409, 'SETUP_USED');
  };
  if (!(await held(row.code))) {
    if (isLocked(s, (await deriveServerValues(seed)).fingerprint)) throw new ServerError(423, 'LOCKED');
    const r = await ctx.db.run('UPDATE setup SET code = ?1, claimed = ?2, link = NULL WHERE id = 1 AND code IS NULL', code, ctx.now);
    if ((r.meta?.changes ?? 0) === 0) {
      const again = await ctx.db.first<{ code: string | null }>('SELECT code FROM setup WHERE id = 1');
      await held(again?.code ?? null); // another request stored a code meanwhile: the same one is fine
    }
  }
  forgetStoredServerCode();
  const id = await identity(env);
  if (isLocked(s, id.values.fingerprint)) throw new ServerError(423, 'LOCKED');
  let published = 0;
  try { published = (await publishConfig(ctx, id, s)).status; } catch (e) {
    if ((e as Error)?.name === 'BudgetError') throw e;
    published = 0; // the Cron run announces it within a minute anyway
  }
  return json(ctx.rid, 200, { server: id.serverUrl, api: SERVER_API, fingerprint: id.values.fingerprint, delivery: id.delivery.mode, published });
}
