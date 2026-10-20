// Authentication, rate limiting of failures and capped body reading (DESIGN.md 3.3).

import type { Ctx } from './env.ts';
import type { Identity } from './keys.ts';
import { ServerError } from './errors.ts';

const enc = new TextEncoder();

/** Step 3: `Bearer` + 64 lowercase hex, compared in constant time. Never touches the body. */
export function checkBearer(req: Request, id: Identity): boolean {
  const h = req.headers.get('Authorization') ?? '';
  const m = /^Bearer ([0-9a-f]{64})$/.exec(h);
  if (!m) return false;
  const a = enc.encode(m[1]);
  const b = enc.encode(id.values.authToken);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

/** Counts a failure against the per-IP limit. -> true when the caller is over it (answer 429, do nothing else). */
export async function failureLimited(ctx: Ctx, req: Request): Promise<boolean> {
  const rl = ctx.env.FAILS;
  if (!rl) return false;
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  try { return !(await rl.limit({ key: ip })).success; } catch { return false; }
}

export const rateLimited = () => new ServerError(429, 'RATE_LIMITED', { retryAfter: 60 });

/**
 * Steps 5 and 6: Content-Length must be present and within `cap`; the body is read through a counter that cancels at
 * the cap. A request without a body reads as empty.
 */
export async function readBody(ctx: Ctx, req: Request, cap: number): Promise<Uint8Array> {
  const lenHeader = req.headers.get('Content-Length');
  if (lenHeader === null) {
    if (req.body === null) return new Uint8Array(0);
    throw new ServerError(411, 'LENGTH_REQUIRED');
  }
  const len = Number(lenHeader);
  if (!Number.isSafeInteger(len) || len < 0) throw new ServerError(411, 'LENGTH_REQUIRED');
  if (len > cap) throw new ServerError(413, 'TOO_LARGE', { limit: cap });
  if (!req.body || len === 0) return new Uint8Array(0);
  ctx.bodyRead = true;
  const reader = req.body.getReader();
  const out = new Uint8Array(len);
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > cap || total + value.byteLength > len) {
      await reader.cancel().catch(() => {});
      throw new ServerError(413, 'TOO_LARGE', { limit: cap });
    }
    out.set(value, total);
    total += value.byteLength;
  }
  return total === len ? out : out.subarray(0, total);
}

export async function readJson<T = Record<string, unknown>>(ctx: Ctx, req: Request, cap: number): Promise<T> {
  const ct = (req.headers.get('Content-Type') ?? '').toLowerCase();
  const bytes = await readBody(ctx, req, cap);
  if (bytes.length === 0) return {} as T;
  if (ct && !ct.startsWith('application/json')) throw new ServerError(415, 'UNSUPPORTED_TYPE');
  let v: unknown;
  try { v = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid JSON.' }); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t a JSON object.' });
  return v as T;
}

/** Content-Length of a streaming upload, checked against `cap` (and at least `min`) without reading the body. */
export function uploadLength(req: Request, cap: number, min = 1): number {
  const lenHeader = req.headers.get('Content-Length');
  if (lenHeader === null) throw new ServerError(411, 'LENGTH_REQUIRED');
  const len = Number(lenHeader);
  if (!Number.isSafeInteger(len) || len < 0) throw new ServerError(411, 'LENGTH_REQUIRED');
  if (len > cap) throw new ServerError(413, 'TOO_LARGE', { limit: cap });
  if (len < min || !req.body) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (empty body).' });
  return len;
}
