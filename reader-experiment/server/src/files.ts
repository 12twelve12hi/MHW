// Large files (DESIGN.md 6): ordinary v1 frames under the pairing key, uploaded by the sender, stored in R2 as
// ciphertext and served to any Inbox from /f/<fileId>/<i>. The server never decrypts them.

import type { Ctx } from './env.ts';
import { iso, requireR2 } from './env.ts';
import type { Identity } from './keys.ts';
import { ServerError, empty, json } from './errors.ts';
import { uploadLength } from './auth.ts';

const FILE_ID = /^[0-9a-f]{32}$/;

interface FileRow { id: string; fp: string; n: number; stored: string; bytes: number; created: number; expires: number }

export function checkFileId(fileId: string) {
  if (!FILE_ID.test(fileId)) throw new ServerError(404, 'NOT_FOUND');
}

/** PUT /v1/files/{fileId}/{i}?n=<parts>: streams the frame into R2 f/<fileId>/<i>. Idempotent, any order. */
export async function putPart(ctx: Ctx, id: Identity, req: Request, fileId: string, iRaw: string): Promise<Response> {
  checkFileId(fileId);
  const r2 = requireR2(ctx);
  const url = new URL(req.url);
  const n = Number(url.searchParams.get('n'));
  const i = Number(iRaw);
  if (!Number.isInteger(n) || n < 1 || n > 16) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (n).' });
  if (!/^\d{1,2}$/.test(iRaw) || i >= n) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (part index).' });
  const ct = (req.headers.get('Content-Type') ?? '').toLowerCase();
  if (ct && !ct.startsWith('application/octet-stream')) throw new ServerError(415, 'UNSUPPORTED_TYPE');
  const len = uploadLength(req, ctx.limits.hostedFrame, 36);
  const row = await ctx.db.first<FileRow & { live: number }>(
    `SELECT f.*, (SELECT COALESCE(SUM(bytes), 0) FROM files WHERE expires > ?2) AS live FROM (SELECT 1) LEFT JOIN files f ON f.id = ?1`,
    fileId, ctx.now,
  );
  const exists = !!row?.id;
  if (exists) {
    if (row!.n !== n) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (n differs from earlier parts).' });
    if (row!.expires <= ctx.now || row!.fp !== id.values.fingerprint) throw new ServerError(410, 'GONE');
  }
  const stored: number[] = exists ? JSON.parse(row!.stored || '[]') : [];
  if (!stored.includes(i) && (row?.live ?? 0) + len > ctx.limits.fileStorage) throw new ServerError(507, 'STORAGE_FULL');
  ctx.bodyRead = true;
  const { readable, writable } = new FixedLengthStream(len);
  const piping = req.body!.pipeTo(writable).catch(() => {});
  try {
    await r2.put(`f/${fileId}/${i}`, readable, { httpMetadata: { contentType: 'application/octet-stream' } });
  } catch {
    throw new ServerError(400, 'BAD_REQUEST', { message: 'The upload ended early. Send the part again.' });
  }
  await piping;
  const created = exists ? row!.created : ctx.now;
  await ctx.db.run(
    `INSERT INTO files (id, fp, n, stored, bytes, created, expires) VALUES (?1, ?2, ?3, json_array(?4), ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET
       bytes = files.bytes + CASE WHEN EXISTS (SELECT 1 FROM json_each(files.stored) WHERE value = ?4) THEN 0 ELSE ?5 END,
       stored = CASE WHEN EXISTS (SELECT 1 FROM json_each(files.stored) WHERE value = ?4) THEN files.stored
                ELSE json_insert(files.stored, '$[#]', ?4) END`,
    fileId, id.values.fingerprint, n, i, len, created, created + ctx.limits.filesTtl,
  );
  return empty(ctx.rid, 204);
}

/** GET /v1/files/{fileId}: which parts are stored, so an interrupted upload resumes. */
export async function fileInfo(ctx: Ctx, id: Identity, fileId: string): Promise<Response> {
  checkFileId(fileId);
  requireR2(ctx);
  const row = await ctx.db.first<FileRow>('SELECT * FROM files WHERE id = ?', fileId);
  if (!row) throw new ServerError(404, 'NOT_FOUND');
  if (row.expires <= ctx.now || row.fp !== id.values.fingerprint) throw new ServerError(410, 'GONE');
  const stored = (JSON.parse(row.stored || '[]') as number[]).sort((a, b) => a - b);
  return json(ctx.rid, 200, { n: row.n, stored, bytes: row.bytes, expires: iso(row.expires) });
}

/** DELETE /v1/files/{fileId}: 204, also when it is already gone. */
export async function deleteFile(ctx: Ctx, fileId: string): Promise<Response> {
  checkFileId(fileId);
  const r2 = requireR2(ctx);
  const row = await ctx.db.first<FileRow>('SELECT n FROM files WHERE id = ?', fileId);
  const n = row?.n ?? 16;
  await r2.delete([...Array(n).keys()].map((i) => `f/${fileId}/${i}`));
  if (row) await ctx.db.run('DELETE FROM files WHERE id = ?', fileId);
  return empty(ctx.rid, 204);
}

/** GET /f/<fileId>/<i>: unauthenticated; streams the R2 object. -> null for an unknown id (404, rate-limited). */
export async function serveFile(ctx: Ctx, id: Identity, fileId: string, iRaw: string): Promise<Response | null> {
  if (!FILE_ID.test(fileId) || !/^\d{1,2}$/.test(iRaw)) return null;
  const r2 = ctx.env.FILES;
  if (!r2) return null;
  const row = await ctx.db.first<FileRow & { lock: string | null }>(
    "SELECT id, fp, n, stored, expires, (SELECT v FROM settings WHERE k = 'lock') AS lock FROM files WHERE id = ?", fileId,
  );
  if (!row) return null;
  let locked = false;
  try { locked = !!row.lock && JSON.parse(row.lock).fingerprint === id.values.fingerprint; } catch { /* no lock */ }
  if (locked || row.expires <= ctx.now || row.fp !== id.values.fingerprint) throw new ServerError(410, 'GONE');
  const obj = await r2.get(`f/${fileId}/${Number(iRaw)}`);
  if (!obj) return null;
  return new Response(obj.body, {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(obj.size), 'Cache-Control': 'no-store' },
  });
}

/** Hourly: rows of expired files go 24 h after expiry; their objects are deleted (the R2 lifecycle rule is the backstop). */
export async function filesCleanup(ctx: Ctx, fingerprint: string): Promise<D1PreparedStatement[]> {
  const gone = await ctx.db.all<{ id: string; n: number }>(
    'SELECT id, n FROM files WHERE expires <= ? OR fp != ? LIMIT 50', ctx.now - 86_400_000, fingerprint,
  );
  if (gone.length && ctx.env.FILES) {
    const keys = gone.flatMap((f) => [...Array(f.n).keys()].map((i) => `f/${f.id}/${i}`)).slice(0, 1000);
    try { await ctx.env.FILES.delete(keys); } catch { /* the lifecycle rule deletes them anyway */ }
  }
  return gone.length ? [ctx.db.stmt('DELETE FROM files WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(gone.map((g) => g.id)))] : [];
}
