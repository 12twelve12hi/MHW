// Email-in (DESIGN.md 7): a light email() handler that stores the raw message in R2, and a heavy Cron step that parses
// one message and turns it into a page item and file items.

import { Buffer } from 'node:buffer';
import PostalMime, { decodeWords } from 'postal-mime';
import { cleanName, safeFileName } from '../../share/js/daylight-share.js';
import type { Ctx } from './env.ts';
import { BudgetError, DAY, MiB, KiB, iso, logCode, randomHex, requireR2, utcDay } from './env.ts';
import type { Identity } from './keys.ts';
import { ServerError, json, empty } from './errors.ts';
import { sanitize } from './sanitize.ts';
import { esc, plainText, textToHtml, wrapPage } from './html.ts';
import {
  blockPatterns, cleanSubject, dmarcFromHeaders, documentMime, findViewInBrowser, formatSize, normalizePattern,
  parseFrom, parseHeaderBlock,
} from './mailparse.ts';
import type { BuiltItem, ServerItem } from './outbox.ts';
import { buildItem, storeManyStatements } from './outbox.ts';
import type { Settings } from './settings.ts';
import { d1Paused, saveStmt } from './settings.ts';
import { featureState } from './status.ts';

const MAX_DOCS = 10;
const MAX_DOC_BYTES = 16 * MiB;
const CID_MAX = 512 * KiB;
const CID_TOTAL = 3 * MiB;
const PAGE_MAX = 8 * MiB;
const REJECT = 'This address is not set up.';
/** Mail rows are written for the first 2 × the daily cap of messages; after that only the day's counter rises (7.2). */
const ROW_CEILING = 2;
/** The states of a mail row that was not dropped. */
const KEPT_STATES = `('queued', 'running', 'done', 'waiting-paid', 'failed')`;

/** Reads a stream up to the first empty line (at most `cap` bytes), then cancels it. */
async function readHeaderBlock(stream: ReadableStream<Uint8Array>, cap = 64 * KiB): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder('utf-8');
  let text = '';
  let bytes = 0;
  try {
    while (bytes < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += dec.decode(value, { stream: true });
      if (/\r?\n\r?\n/.test(text)) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return text.slice(0, cap);
}

function decodeHeader(v: string | null): string {
  if (!v) return '';
  try { return decodeWords(v); } catch { return v; }
}

/**
 * The email() handler (7.2): no parsing, at most 3 D1 statements. The day's message count is a counter in `usage`
 * (kind email_in), raised and read in one statement; the per-sender and per-domain counts read only that sender's or
 * domain's rows of today through their indexes, and only while the day is under its cap. Rows are written for the
 * first 2 × 200 messages a day, so a flood costs neither D1 reads nor rows (15.2).
 */
export async function receiveEmail(ctx: Ctx, id: Identity | null, message: ForwardableEmailMessage): Promise<void> {
  const r2 = ctx.env.FILES;
  const to = String(message.to ?? '').toLowerCase();
  if (!id || !id.emailAddress || !r2 || to !== id.emailAddress) { message.setReject(REJECT); return; }
  // The address comes from the raw header (RFC 5322); only the display name is decoded (encoded-words).
  const from = parseFrom(message.headers.get('from') || message.from, decodeHeader);
  const subject = cleanSubject(decodeHeader(message.headers.get('subject'))).slice(0, 300);
  const day = utcDay(ctx.now);
  const dayStart = Date.parse(day + 'T00:00:00Z');
  const cap = ctx.limits.mailPerDay;
  const [counted, looked] = await ctx.db.batch([
    ctx.db.stmt(`INSERT INTO usage (day, kind, n) VALUES (?, 'email_in', 1) ON CONFLICT(day, kind) DO UPDATE SET n = n + 1 RETURNING n`, day),
    ctx.db.stmt(
      `SELECT (SELECT v FROM settings WHERE k = 'lock') AS lock, (SELECT v FROM settings WHERE k = 'd1Bytes') AS d1,
         (SELECT pattern FROM blocked WHERE pattern IN (SELECT value FROM json_each(?4)) LIMIT 1) AS blocked,
         CASE WHEN (SELECT n FROM usage WHERE day = ?5 AND kind = 'email_in') <= ?6
           THEN (SELECT COUNT(*) FROM mail WHERE from_addr = ?2 AND received >= ?1) END AS sender,
         CASE WHEN (SELECT n FROM usage WHERE day = ?5 AND kind = 'email_in') <= ?6
           THEN (SELECT COUNT(*) FROM mail WHERE from_domain = ?3 AND received >= ?1) END AS domain`,
      dayStart, from.address, from.domain, JSON.stringify(blockPatterns(from.address)), day, cap,
    ),
  ]);
  const today = Number((counted?.results?.[0] as { n?: number } | undefined)?.n ?? 0);
  const row = looked?.results?.[0] as { lock: string | null; d1: string | null; blocked: string | null; sender: number | null; domain: number | null } | undefined;
  let locked = false;
  try { locked = !!row?.lock && JSON.parse(row.lock).fingerprint === id.values.fingerprint; } catch { /* no lock */ }
  if (locked) { message.setReject(REJECT); return; }

  const [headBranch, rawBranch] = message.raw.tee();
  const headers = parseHeaderBlock(await readHeaderBlock(headBranch));
  const dmarc = dmarcFromHeaders(headers);
  const mailId = randomHex(16);
  // Past 400 MB of D1, mail rows are paused (11.1): a message can't be queued without one, so it is dropped silently.
  const full = d1Paused(ctx, { d1Bytes: Number(row?.d1 ?? 0) });
  let drop: string | null = null;
  if (row?.blocked) drop = 'blocked';
  else if (dmarc === 'fail') drop = 'dmarc';
  else if (today > cap) drop = 'daily-cap';
  else if ((row?.sender ?? 0) >= ctx.limits.mailPerSender) drop = 'sender-cap';
  else if ((row?.domain ?? 0) >= ctx.limits.mailPerDomain) drop = 'domain-cap';
  else if (full) drop = 'storage-full';
  const insert = (state: string, reason: string | null) => ctx.db.run(
    `INSERT INTO mail (id, received, from_addr, from_domain, from_name, subject, size, state, reason, sent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    mailId, ctx.now, from.address.slice(0, 254), from.domain.slice(0, 254), cleanName(from.name).slice(0, 60), subject,
    message.rawSize, state, reason, decodeHeader(message.headers.get('date')).slice(0, 80),
  );
  if (drop) {
    await rawBranch.cancel().catch(() => {});
    if (full) logCode(ctx, 'D1_FULL');
    else if (today <= cap * ROW_CEILING) await insert('dropped', drop);
    return;
  }
  const waiting = ctx.plan === 'free' && message.rawSize > ctx.caps.emailMaxFree;
  const { readable, writable } = new FixedLengthStream(message.rawSize);
  const piping = rawBranch.pipeTo(writable).catch(() => {});
  await r2.put(`m/${mailId}.eml`, readable, { httpMetadata: { contentType: 'message/rfc822' } });
  await piping;
  await insert(waiting ? 'waiting-paid' : 'queued', waiting ? 'too-large-for-free' : null);
}

interface MailRow { id: string; received: number; from_addr: string; from_name: string; subject: string; size: number; state: string; reason: string | null; attempts: number; sent: string | null }

function sentTime(date: string | undefined | null, now: number): string | undefined {
  const t = date ? Date.parse(date) : NaN;
  return Number.isFinite(t) && t <= now && t >= now - 7 * DAY ? iso(t) : undefined;
}

function toBytes(c: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof c === 'string') return new TextEncoder().encode(c);
  return c instanceof Uint8Array ? c : new Uint8Array(c);
}

/** An HTML attachment's text: the charset its <meta> declares (within the first 2 KiB), else UTF-8. */
function decodeHtml(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const label = /<meta\b[^>]{0,300}?charset\s*=\s*["']?([A-Za-z0-9._-]{1,40})/i.exec(head)?.[1];
  try { return new TextDecoder(label ?? 'utf-8').decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

/** Builds the items for one parsed email (7.4). Pure apart from the sanitizer. */
export async function itemsForEmail(email: Awaited<ReturnType<typeof PostalMime.parse>>, mailId: string, fallbackFrom: { name: string; address: string }, now: number): Promise<ServerItem[]> {
  // Not email.from: postal-mime decodes encoded-words before it looks for the address (see parseFrom).
  const rawFrom = (email.headers ?? []).find((h) => h.key === 'from')?.value;
  const fromMailbox = rawFrom ? parseFrom(rawFrom, decodeHeader) : null;
  const senderName = cleanName(fromMailbox?.name || fallbackFrom.name || fromMailbox?.address || fallbackFrom.address || 'Email');
  const from = cleanName(`Email · ${senderName}`).slice(0, 60);
  const subject = cleanSubject(email.subject) || '(no subject)';
  const sent = sentTime(email.date, now);
  const docs: { name: string; mime: string; bytes: Uint8Array }[] = [];
  const skipped: string[] = [];
  const cid = new Map<string, string>();
  let cidTotal = 0;
  for (const a of email.attachments ?? []) {
    const bytes = toBytes(a.content);
    const mime = (a.mimeType ?? '').toLowerCase();
    if (a.contentId && /^image\/(png|jpeg|gif|webp)$/.test(mime)) {
      if (bytes.byteLength <= CID_MAX && cidTotal + bytes.byteLength <= CID_TOTAL) {
        cid.set(a.contentId.replace(/^<|>$/g, '').toLowerCase(), `data:${mime};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`);
        cidTotal += bytes.byteLength;
      }
      if (a.related || a.disposition === 'inline') continue;
    }
    const docMime = documentMime(mime, a.filename);
    const name = safeFileName(a.filename || `attachment.${mime.split('/')[1] ?? 'bin'}`, 'attachment');
    if (docMime && docs.length < MAX_DOCS && bytes.byteLength <= MAX_DOC_BYTES && bytes.byteLength > 0) {
      docs.push({ name, mime: docMime, bytes });
    } else if (!(a.related && /^image\//.test(mime))) {
      skipped.push(`${name}, ${formatSize(bytes.byteLength)}`);
    }
  }
  const bodyText = (email.text ?? (email.html ? plainText(email.html) : '')).trim();
  const items: ServerItem[] = [];
  const onlyFiles = docs.length > 0 && bodyText.length < 300;
  if (!onlyFiles) {
    const source = email.html ?? textToHtml(email.text ?? '');
    const viewUrl = email.html ? findViewInBrowser(email.html) : null;
    const notDelivered = skipped.length ? `<hr><p>${esc('Not delivered: ' + skipped.join('; '))}</p>` : '';
    const meta = { title: subject, author: senderName, published: sent, source: 'email' };
    let html = wrapPage(meta, (await sanitize(source, { cid })) + notDelivered);
    if (new TextEncoder().encode(html).byteLength > PAGE_MAX) html = wrapPage(meta, (await sanitize(source, { cid, dropDataImages: true })) + notDelivered);
    if (new TextEncoder().encode(html).byteLength > PAGE_MAX) html = wrapPage(meta, textToHtml(bodyText.slice(0, 2_000_000)) + notDelivered);
    items.push({ origin: `email:${mailId}:0`, kind: 'page', url: viewUrl, title: subject, content: html, from, sent, xOrigin: 'email' });
  }
  for (const [n, d] of docs.entries()) {
    const title = d.name.replace(/\.[^.]{1,10}$/, '');
    // An HTML document from an email sender is outside content like the body: sanitized and wrapped (7.5).
    const content = d.mime === 'text/html'
      ? new TextEncoder().encode(wrapPage({ title, author: senderName, published: sent, source: 'email' }, await sanitize(decodeHtml(d.bytes))))
      : d.bytes;
    items.push({ origin: `email:${mailId}:${n + 1}`, kind: 'file', name: d.name, mime: d.mime, content, title, from, sent, xOrigin: 'email' });
  }
  return items;
}

/** Cron heavy step: claims and processes one email. -> true when it did work. */
export async function processOneEmail(ctx: Ctx, id: Identity): Promise<boolean> {
  const r2 = ctx.env.FILES;
  if (!r2) return false;
  const day = utcDay(ctx.now);
  const row = await ctx.db.first<MailRow>(
    `UPDATE mail SET state = 'running', lease = ?1, attempts = attempts + 1
     WHERE id = (SELECT id FROM mail WHERE state = 'queued' OR (state = 'running' AND lease < ?2) OR (state = 'waiting-paid' AND ?3 = 'paid')
                 ORDER BY received LIMIT 1)
       AND (state = 'queued' OR (state = 'running' AND lease < ?2) OR (state = 'waiting-paid' AND ?3 = 'paid'))
       AND COALESCE((SELECT n FROM usage WHERE day = ?4 AND kind = 'email_items'), 0) < ?5
     RETURNING id, received, from_addr, from_name, subject, size, state, reason, attempts, sent`,
    ctx.now + 15 * 60_000, ctx.now, ctx.plan, day, ctx.limits.mailItemsPerDay,
  );
  if (!row) return false;
  if (row.attempts > 3) {
    // Killed three times without an exception: almost always the Free plan's CPU limit (2.2 rule 5).
    if (ctx.plan === 'free') {
      await ctx.db.run(`UPDATE mail SET state = 'waiting-paid', reason = 'SERVER_LIMIT', attempts = 0, lease = 0 WHERE id = ?`, row.id);
    } else {
      await ctx.db.run(`UPDATE mail SET state = 'failed', reason = 'SERVER_LIMIT' WHERE id = ?`, row.id);
      await r2.delete(`m/${row.id}.eml`).catch(() => {});
    }
    logCode(ctx, 'SERVER_LIMIT');
    return true;
  }
  let items: ServerItem[];
  try {
    const obj = await r2.get(`m/${row.id}.eml`);
    if (!obj) throw new Error('missing');
    const raw = await obj.arrayBuffer();
    const email = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer', maxNestingDepth: 32 });
    items = await itemsForEmail(email, row.id, { name: row.from_name, address: row.from_addr }, ctx.now);
  } catch (e) {
    if ((e as Error)?.name === 'BudgetError') throw e;
    const failed = row.attempts >= 3;
    await ctx.db.run(`UPDATE mail SET state = ?, reason = 'BAD_EMAIL', lease = 0 WHERE id = ?`, failed ? 'failed' : 'queued', row.id);
    if (failed) await r2.delete(`m/${row.id}.eml`).catch(() => {});
    logCode(ctx, 'BAD_EMAIL');
    return true;
  }
  const built: BuiltItem[] = [];
  for (const item of items) built.push(await buildItem(id, item));
  const stmts = storeManyStatements(ctx, id.values.fingerprint, built);
  stmts.push(ctx.db.stmt(`UPDATE mail SET state = 'done', reason = NULL, lease = 0, items = ? WHERE id = ?`, JSON.stringify(built.map((b) => b.id)), row.id));
  stmts.push(ctx.db.stmt(
    `INSERT INTO usage (day, kind, n) VALUES (?, 'email_items', ?) ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n`, day, built.length,
  ));
  try {
    // One statement per ~1.5 MB of frames: a mail with 7 MiB of documents needs ~10. The step's allowance grows to
    // what the items need, within the invocation's budget (2.3).
    ctx.budget.extendStep(stmts.length);
    await ctx.db.batch(stmts);
  } catch (e) {
    if (e instanceof BudgetError) {
      // Not an attempt (2.2 rule 5 counts CPU kills): the mail goes back to wait for a run with room. A mail that can
      // never fit one invocation on Free waits for Workers Paid.
      const never = ctx.plan === 'free' && stmts.length + 2 > ctx.budget.d1Limit;
      await ctx.db.batchAlways([ctx.db.stmt(
        `UPDATE mail SET state = ?, reason = ?, attempts = MAX(0, attempts - 1), lease = 0 WHERE id = ?`,
        never ? 'waiting-paid' : 'queued', never ? 'too-large-for-free' : 'BUDGET', row.id,
      )]);
      logCode(ctx, 'MAIL_BUDGET');
    }
    throw e;
  }
  await r2.delete(`m/${row.id}.eml`).catch(() => {});
  return true;
}

/**
 * Today's mail counts as three columns b, c, d (received, done, kept), reading only today's kept rows through the
 * (state, received) index; dropped mail beyond the row ceiling exists only in the email_in counter.
 */
export const mailCountsSql = (dayStart: string, day: string) =>
  `(SELECT n FROM usage WHERE day = ${day} AND kind = 'email_in') AS b,
   (SELECT COUNT(*) FROM mail WHERE state = 'done' AND received >= ${dayStart}) AS c,
   (SELECT COUNT(*) FROM mail WHERE state IN ${KEPT_STATES} AND received >= ${dayStart}) AS d`;

export function mailCounts(received: unknown, done: unknown, kept: unknown) {
  const r = Number(received ?? 0) || 0, k = Number(kept ?? 0) || 0;
  return { received: Math.max(r, k), delivered: Number(done ?? 0) || 0, dropped: Math.max(0, r - k) };
}

function requireEmail(ctx: Ctx, id: Identity) {
  if (!ctx.env.DAYLIGHT_EMAIL_DOMAIN || !id.emailAddress) throw new ServerError(409, 'NOT_CONFIGURED', { missing: ['DAYLIGHT_EMAIL_DOMAIN'], feature: 'email' });
  requireR2(ctx);
}

/** GET /v1/email */
export async function emailInfo(ctx: Ctx, id: Identity, s: Settings): Promise<Response> {
  requireEmail(ctx, id);
  const dayStart = Date.parse(utcDay(ctx.now) + 'T00:00:00Z');
  const rows = await ctx.db.all<{ kind: string; a: string | null; b: number | null; c: number | null; d: number | null }>(
    `SELECT 'counts' AS kind, NULL AS a, ${mailCountsSql('?1', '?2')}
     UNION ALL SELECT 'blocked', pattern, added, NULL, NULL FROM (SELECT * FROM blocked ORDER BY added DESC LIMIT 200)`,
    dayStart, utcDay(ctx.now),
  );
  const counts = rows.find((r) => r.kind === 'counts');
  const today = mailCounts(counts?.b, counts?.c, counts?.d);
  const address = id.emailAddress!;
  let emailAddr = s.emailAddr;
  if (!emailAddr || emailAddr.address !== address) {
    emailAddr = { address, changed: emailAddr ? ctx.now : null };
    await ctx.db.batch([saveStmt(ctx, { emailAddr })]);
  }
  const st = featureState(ctx, id, s, 'email');
  return json(ctx.rid, 200, {
    state: st.state, ...(st.message ? { message: st.message } : {}),
    address, addressChanged: emailAddr.changed ? iso(emailAddr.changed) : null,
    blocked: rows.filter((r) => r.kind === 'blocked').map((r) => ({ pattern: r.a, added: iso(Number(r.b)) })),
    today,
  });
}

export async function blockSender(ctx: Ctx, id: Identity, body: Record<string, unknown>): Promise<Response> {
  requireEmail(ctx, id);
  const pattern = normalizePattern(body.pattern);
  if (!pattern) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (pattern).' });
  await ctx.db.run('INSERT OR IGNORE INTO blocked (pattern, added) VALUES (?, ?)', pattern, ctx.now);
  return json(ctx.rid, 201, { pattern });
}

export async function unblockSender(ctx: Ctx, id: Identity, body: Record<string, unknown>): Promise<Response> {
  requireEmail(ctx, id);
  const pattern = normalizePattern(body.pattern);
  if (!pattern) throw new ServerError(400, 'BAD_REQUEST', { message: 'That request isn’t valid (pattern).' });
  await ctx.db.run('DELETE FROM blocked WHERE pattern = ?', pattern);
  return empty(ctx.rid, 204);
}

export async function recentMail(ctx: Ctx, id: Identity): Promise<Response> {
  requireEmail(ctx, id);
  const rows = await ctx.db.all<MailRow & { items: string | null }>(
    'SELECT id, received, from_addr, from_name, subject, state, reason, items FROM mail ORDER BY received DESC LIMIT 30',
  );
  return json(ctx.rid, 200, rows.map((r) => ({
    id: r.id, from: r.from_name ? `${r.from_name} <${r.from_addr}>` : r.from_addr, subject: r.subject, received: iso(r.received),
    state: r.state === 'running' ? 'queued' : r.state, reason: r.reason, items: r.items ? JSON.parse(r.items) : [],
  })));
}

/** Hourly: mail rows after 30 days; raw mail waiting for Paid after 7 days. */
export async function mailCleanup(ctx: Ctx): Promise<D1PreparedStatement[]> {
  const old = await ctx.db.all<{ id: string }>(
    `SELECT id FROM mail WHERE state IN ('waiting-paid', 'queued') AND received <= ? LIMIT 100`, ctx.now - ctx.limits.waitingPaidKeep,
  );
  if (old.length && ctx.env.FILES) await ctx.env.FILES.delete(old.map((r) => `m/${r.id}.eml`)).catch(() => {});
  return [
    ...(old.length ? [ctx.db.stmt(`UPDATE mail SET state = 'failed', reason = 'SERVER_LIMIT' WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(old.map((r) => r.id)))] : []),
    ctx.db.stmt('DELETE FROM mail WHERE received <= ?', ctx.now - ctx.limits.mailKeep),
  ];
}
