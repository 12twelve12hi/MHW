// AI sources (DESIGN.md 9.2): text sources in D1, URL sources fetched with safeFetch, PDF sources uploaded in
// validated base64 parts to R2 and spliced into the Claude request without JSON.stringify touching them (9.4).

import { safeFileName } from '../../share/js/daylight-share.js';
import { SOURCE_PART, SOURCE_MAX, SOURCE_MAX_PARTS } from '../client/daylight-server.js';
import type { Ctx } from './env.ts';
import { iso, randomHex, requireR2 } from './env.ts';
import type { Identity } from './keys.ts';
import { ServerError, json } from './errors.ts';
import { uploadLength } from './auth.ts';
import { extractText, safeFetch, checkFetchUrl } from './safefetch.ts';
import type { FetchLike } from './claude.ts';

export const TEXT_MAX_CHARS = 400_000;
export const TEXT_MAX_BYTES = 1_000_000;
const SOURCE_ID = /^[0-9a-f]{32}$/;

export interface SourceRow {
  id: string; fp: string; type: 'pdf' | 'text'; name: string | null; title: string | null; url: string | null; text: string | null;
  n: number; validated: string; bytes: number; created: number; expires: number;
}

export interface ResolvedSource {
  id: string;
  type: 'pdf' | 'text';
  title: string;
  url: string | null;
  text?: string;
  sizes?: number[];
}

export async function sha256Hex(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stores a text source for 24 h (unless optional writes are paused). -> its id. */
export async function storeTextSource(ctx: Ctx, id: Identity, text: string, title: string, url: string | null, paused: boolean): Promise<string> {
  const sourceId = (await sha256Hex(text)).slice(0, 32);
  if (!paused) {
    await ctx.db.run(
      `INSERT INTO sources (id, fp, type, title, url, text, bytes, created, expires) VALUES (?, ?, 'text', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET expires = excluded.expires, fp = excluded.fp`,
      sourceId, id.values.fingerprint, title.slice(0, 300), url, text, new TextEncoder().encode(text).byteLength, ctx.now, ctx.now + ctx.limits.sourceTtl,
    );
  }
  return sourceId;
}

export function checkText(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (source.text).' });
  if (text.length > TEXT_MAX_CHARS || new TextEncoder().encode(text).byteLength > TEXT_MAX_BYTES) {
    throw new ServerError(413, 'TOO_LARGE', { limit: TEXT_MAX_BYTES });
  }
  return text;
}

/** Fetches a page for AI and extracts its text (1 MiB of HTML on Free, 2 MiB on Paid). */
export async function fetchUrlSource(ctx: Ctx, id: Identity, url: string): Promise<{ text: string; title: string; url: string }> {
  const self = id.serverUrl ? new URL(id.serverUrl).hostname : '';
  const res = await safeFetch(ctx.fetch, url, { maxBytes: ctx.caps.urlHtmlBytes, timeoutMs: 15_000, selfHost: self });
  if (res.status < 200 || res.status >= 300) throw new ServerError(502, 'FETCH_FAILED');
  const type = (res.headers.get('Content-Type') ?? '').toLowerCase();
  const body = new TextDecoder().decode(res.body);
  if (type.startsWith('text/plain')) return { text: body.trim(), title: '', url: res.url };
  if (type && !/html|xml/.test(type)) throw new ServerError(422, 'AI_BAD_INPUT');
  const { title, text } = await extractText(body);
  if (!text) throw new ServerError(422, 'AI_BAD_INPUT');
  return { text: text.slice(0, TEXT_MAX_CHARS), title, url: res.url };
}

export { checkFetchUrl };

/** A source by id. -> the source, or throws 404 NEED_SOURCE (with missingParts for an incomplete PDF) / 410 GONE. */
export async function loadSource(ctx: Ctx, id: Identity, sourceId: string): Promise<ResolvedSource> {
  if (!SOURCE_ID.test(sourceId)) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (sourceId).' });
  const row = await ctx.db.first<SourceRow>('SELECT * FROM sources WHERE id = ?', sourceId);
  if (!row || row.expires <= ctx.now || row.fp !== id.values.fingerprint) throw new ServerError(404, 'NEED_SOURCE');
  if (row.type === 'text') return { id: row.id, type: 'text', title: row.title ?? '', url: row.url, text: row.text ?? '' };
  requireR2(ctx);
  const sizes: (number | null)[] = JSON.parse(row.validated || '[]');
  const missing = [...Array(row.n).keys()].filter((i) => !(Number(sizes[i]) > 0));
  if (missing.length) throw new ServerError(404, 'NEED_SOURCE', { missingParts: missing });
  return { id: row.id, type: 'pdf', title: (row.name ?? '').replace(/\.pdf$/i, ''), url: null, sizes: sizes as number[] };
}

/** PUT /v1/ai/sources/{sourceId}/{i}?n=<parts>[&replace=1]: one validated base64 part of a PDF. */
export async function putSourcePart(ctx: Ctx, id: Identity, req: Request, sourceId: string, iRaw: string): Promise<Response> {
  if (!SOURCE_ID.test(sourceId)) throw new ServerError(404, 'NOT_FOUND');
  const r2 = requireR2(ctx);
  const q = new URL(req.url).searchParams;
  const n = Number(q.get('n'));
  const i = Number(iRaw);
  if (!Number.isInteger(n) || n < 1 || n > SOURCE_MAX_PARTS) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (n).' });
  if (!/^\d{1,2}$/.test(iRaw) || i >= n) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (part index).' });
  const ct = (req.headers.get('Content-Type') ?? '').toLowerCase();
  if (ct && !ct.startsWith('text/plain')) throw new ServerError(415, 'UNSUPPORTED_TYPE');
  const len = uploadLength(req, SOURCE_PART, 1);
  const last = i === n - 1;
  if ((!last && len !== SOURCE_PART) || (last && (n - 1) * SOURCE_PART + len > SOURCE_MAX)) {
    throw new ServerError(422, 'AI_BAD_INPUT');
  }
  let name = 'document.pdf';
  try { name = safeFileName(decodeURIComponent(req.headers.get('X-DLS-Source-Name') ?? 'document.pdf'), 'document.pdf'); } catch { /* keep the default */ }
  const row = await ctx.db.first<SourceRow>('SELECT * FROM sources WHERE id = ?', sourceId);
  const replace = q.get('replace') === '1' && i === 0;
  if (row && row.type !== 'pdf') throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (sourceId).' });
  if (row && !replace && row.n !== n && row.expires > ctx.now) {
    throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (n differs from earlier parts).' });
  }
  if (row && (replace || row.expires <= ctx.now)) {
    await r2.delete([...Array(row.n).keys()].map((k) => `a/${sourceId}/${k}`)).catch(() => {});
  }
  // The only bytes that could end the JSON string a part is spliced into are `"` and `\` (9.2).
  let forbidden = false;
  const scan = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) {
      if (chunk.indexOf(0x22) >= 0 || chunk.indexOf(0x5c) >= 0) { forbidden = true; c.error(new Error('forbidden byte')); return; }
      c.enqueue(chunk);
    },
  });
  ctx.bodyRead = true;
  const fixed = new FixedLengthStream(len);
  const piping = req.body!.pipeThrough(scan).pipeTo(fixed.writable).catch(() => {});
  try {
    await r2.put(`a/${sourceId}/${i}`, fixed.readable, { httpMetadata: { contentType: 'text/plain' } });
  } catch {
    await piping;
    if (forbidden) throw new ServerError(422, 'AI_BAD_INPUT');
    throw new ServerError(400, 'BAD_REQUEST', { message: 'The upload ended early. Send the part again.' });
  }
  await piping;
  if (forbidden) {
    await r2.delete(`a/${sourceId}/${i}`).catch(() => {});
    throw new ServerError(422, 'AI_BAD_INPUT');
  }
  // Whether this part starts a fresh source is decided inside the statement, from the row as it is then: parts
  // uploaded at the same time (each seeing no row in its SELECT) merge instead of resetting each other (9.2).
  const init = JSON.stringify(Array(n).fill(null));
  const res = await ctx.db.first<{ validated: string; expires: number; created: number }>(
    `INSERT INTO sources (id, fp, type, name, n, validated, bytes, created, expires)
     VALUES (?1, ?2, 'pdf', ?3, ?4, json_set(?5, '$[' || CAST(?6 AS INTEGER) || ']', ?7), ?7, ?8, ?8 + ?9)
     ON CONFLICT(id) DO UPDATE SET
       validated = CASE WHEN ?10 OR sources.expires <= ?8 OR sources.n != ?4 OR sources.type != 'pdf'
         THEN json_set(?5, '$[' || CAST(?6 AS INTEGER) || ']', ?7)
         ELSE json_set(sources.validated, '$[' || CAST(?6 AS INTEGER) || ']', ?7) END,
       bytes = CASE WHEN ?10 OR sources.expires <= ?8 OR sources.n != ?4 OR sources.type != 'pdf' THEN ?7 ELSE sources.bytes + ?7 END,
       created = CASE WHEN ?10 OR sources.expires <= ?8 OR sources.n != ?4 OR sources.type != 'pdf' THEN ?8 ELSE sources.created END,
       expires = CASE WHEN ?10 OR sources.expires <= ?8 OR sources.n != ?4 OR sources.type != 'pdf' THEN ?8 ELSE sources.created END + ?9,
       n = ?4, fp = ?2, name = ?3, type = 'pdf'
     RETURNING validated, expires, created`,
    sourceId, id.values.fingerprint, name, n, init, i, len, ctx.now, ctx.limits.sourceTtl, replace ? 1 : 0,
  );
  const sizes: (number | null)[] = JSON.parse(res?.validated ?? init);
  const stored = sizes.map((v, k) => (Number(v) > 0 ? k : -1)).filter((k) => k >= 0);
  return json(ctx.rid, 201, { sourceId, stored, complete: stored.length === n, expires: iso(res?.expires ?? ctx.now + ctx.limits.sourceTtl) });
}

/**
 * The SDK's fetch for a PDF request (9.4): finds the quoted placeholder (exactly once) in the small JSON body, and sends
 * prefix ‖ part 0 ‖ … ‖ part n−1 ‖ suffix through a FixedLengthStream of the exact length. The R2 objects are opened
 * again on every call, so countTokens and the message call each get a fresh stream. On Paid every part is scanned
 * again as it streams.
 */
export function splicingFetch(ctx: Ctx, base: FetchLike, source: ResolvedSource, placeholder: string): FetchLike {
  // Everything this fetch throws reaches mapClaudeError as the cause of the SDK's APIConnectionError. Its refusals are
  // ServerErrors, so the app gets NEED_SOURCE (and re-uploads the parts named) instead of "Claude is busy", and the
  // reservation is released: nothing reached Anthropic.
  return async (input, init) => {
    const body = init?.body;
    if (typeof body !== 'string') return base(input, init);
    const needle = JSON.stringify(placeholder);
    const at = body.indexOf(needle);
    if (at < 0) return base(input, init);
    if (body.indexOf(needle, at + 1) >= 0) throw new ServerError(500, 'SERVER_ERROR');
    const r2 = requireR2(ctx);
    const enc = new TextEncoder();
    const prefix = enc.encode(body.slice(0, at + 1));
    const suffix = enc.encode(body.slice(at + needle.length - 1));
    const sizes = source.sizes ?? [];
    if (!sizes.length || sizes.some((s) => !(s > 0))) throw new ServerError(404, 'NEED_SOURCE', { missingParts: [...sizes.keys()] });
    // Every part must exist with the size it was validated at before a byte is sent (a ?replace=1 re-upload may race).
    const heads = await Promise.all(sizes.map((_, i) => r2.head(`a/${source.id}/${i}`)));
    const missing = heads.map((h, i) => (h && h.size === sizes[i] ? -1 : i)).filter((i) => i >= 0);
    if (missing.length) throw new ServerError(404, 'NEED_SOURCE', { missingParts: missing });
    const total = prefix.byteLength + sizes.reduce((a, b) => a + b, 0) + suffix.byteLength;
    const { readable, writable } = new FixedLengthStream(total);
    const rescan = ctx.plan === 'paid';
    let failure: ServerError | null = null;
    const pump = (async () => {
      const w = writable.getWriter();
      try {
        await w.write(prefix);
        for (let i = 0; i < sizes.length; i++) {
          const obj = await r2.get(`a/${source.id}/${i}`);
          if (!obj || obj.size !== sizes[i]) throw new ServerError(404, 'NEED_SOURCE', { missingParts: [i] });
          const reader = obj.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (rescan && (value.indexOf(0x22) >= 0 || value.indexOf(0x5c) >= 0)) throw new ServerError(422, 'AI_BAD_INPUT');
            await w.write(value);
          }
        }
        await w.write(suffix);
        await w.close();
      } catch (e) {
        failure = e instanceof ServerError ? e : new ServerError(404, 'NEED_SOURCE', { missingParts: [...sizes.keys()] });
        await w.abort(e).catch(() => {});
      }
    })();
    ctx.waitUntil(pump);
    const headers = new Headers(init?.headers);
    headers.delete('content-length');
    try {
      return await base(input, { ...init, headers, body: readable });
    } catch (e) {
      if (failure) throw failure;
      throw e;
    }
  };
}

export const newPlaceholder = (sourceId: string) => `dls-src:${sourceId}:${randomHex(16)}`;

/** Hourly: sources 24 h after expiry, with their R2 parts. */
export async function sourcesCleanup(ctx: Ctx, fingerprint: string): Promise<D1PreparedStatement[]> {
  const old = await ctx.db.all<{ id: string; n: number }>(
    'SELECT id, n FROM sources WHERE expires <= ? OR fp != ? LIMIT 50', ctx.now - ctx.limits.sourceTtl, fingerprint,
  );
  if (!old.length) return [];
  if (ctx.env.FILES) {
    const keys = old.flatMap((s) => [...Array(s.n).keys()].map((i) => `a/${s.id}/${i}`));
    if (keys.length) await ctx.env.FILES.delete(keys.slice(0, 1000)).catch(() => {});
  }
  return [ctx.db.stmt('DELETE FROM sources WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(old.map((s) => s.id)))];
}
