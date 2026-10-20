// Email-in (DESIGN.md 7): a light email() handler that stores the raw message in R2, and a heavy Cron step that parses
// one message and turns it into a page item and file items.

import { Buffer } from 'node:buffer';
import PostalMime, { decodeWords } from 'postal-mime';
import { cleanName, safeFileName } from '../../share/js/daylight-share.js';
import type { Ctx } from './env.ts';
import { DAY, MiB, KiB, iso, logCode, randomHex, requireR2, utcDay } from './env.ts';
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
import { saveStmt } from './settings.ts';
import { featureState } from './status.ts';

const MAX_DOCS = 10;
const MAX_DOC_BYTES = 16 * MiB;
const CID_MAX = 512 * KiB;
const CID_TOTAL = 3 * MiB;
const PAGE_MAX = 8 * MiB;
const REJECT = 'This address is not set up.';

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

/** The email() handler (7.2): no parsing, at most 4 D1 statements. */
export async function receiveEmail(ctx: Ctx, id: Identity | null, message: ForwardableEmailMessage): Promise<void> {
  const r2 = ctx.env.FILES;
  const to = String(message.to ?? '').toLowerCase();
  if (!id || !id.emailAddress || !r2 || to !== id.emailAddress) { message.setReject(REJECT); return; }
  const from = parseFrom(decodeHeader(message.headers.get('from')) || message.from);
  const subject = cleanSubject(decodeHeader(message.headers.get('subject'))).slice(0, 300);
  const dayStart = Date.parse(utcDay(ctx.now) + 'T00:00:00Z');
  const row = await ctx.db.first<{ lock: string | null; today: number; sender: number; domain: number; blocked: string | null }>(
    `SELECT (SELECT v FROM settings WHERE k = 'lock') AS lock,
       (SELECT COUNT(*) FROM mail WHERE received >= ?1) AS today,
       (SELECT COUNT(*) FROM mail WHERE from_addr = ?2 AND received >= ?1) AS sender,
       (SELECT COUNT(*) FROM mail WHERE from_domain = ?3 AND received >= ?1) AS domain,
       (SELECT pattern FROM blocked WHERE pattern IN (SELECT value FROM json_each(?4)) LIMIT 1) AS blocked`,
    dayStart, from.address, from.domain, JSON.stringify(blockPatterns(from.address)),
  );
  let locked = false;
  try { locked = !!row?.lock && JSON.parse(row.lock).fingerprint === id.values.fingerprint; } catch { /* no lock */ }
  if (locked) { message.setReject(REJECT); return; }

  const [headBranch, rawBranch] = message.raw.tee();
  const headers = parseHeaderBlock(await readHeaderBlock(headBranch));
  const dmarc = dmarcFromHeaders(headers);
  const mailId = randomHex(16);
  let drop: string | null = null;
  if (row?.blocked) drop = 'blocked';
  else if (dmarc === 'fail') drop = 'dmarc';
  else if ((row?.today ?? 0) >= ctx.limits.mailPerDay) drop = 'daily-cap';
  else if ((row?.sender ?? 0) >= ctx.limits.mailPerSender) drop = 'sender-cap';
  else if ((row?.domain ?? 0) >= ctx.limits.mailPerDomain) drop = 'domain-cap';
  const insert = (state: string, reason: string | null) => ctx.db.run(
    `INSERT INTO mail (id, received, from_addr, from_domain, from_name, subject, size, state, reason, sent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    mailId, ctx.now, from.address.slice(0, 254), from.domain.slice(0, 254), cleanName(from.name).slice(0, 60), subject,
    message.rawSize, state, reason, decodeHeader(message.headers.get('date')).slice(0, 80),
  );
  if (drop) {
    await rawBranch.cancel().catch(() => {});
    await insert('dropped', drop);
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

/** Builds the items for one parsed email (7.4). Pure apart from the sanitizer. */
export async function itemsForEmail(email: Awaited<ReturnType<typeof PostalMime.parse>>, mailId: string, fallbackFrom: { name: string; address: string }, now: number): Promise<ServerItem[]> {
  const fromMailbox = email.from && 'address' in email.from && email.from.address ? email.from : null;
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
  docs.forEach((d, n) => {
    items.push({
      origin: `email:${mailId}:${n + 1}`, kind: 'file', name: d.name, mime: d.mime, content: d.bytes,
      title: d.name.replace(/\.[^.]{1,10}$/, ''), from, sent, xOrigin: 'email',
    });
  });
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
  await ctx.db.batch(stmts);
  await r2.delete(`m/${row.id}.eml`).catch(() => {});
  return true;
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
    `SELECT 'counts' AS kind, NULL AS a, (SELECT COUNT(*) FROM mail WHERE received >= ?1) AS b,
       (SELECT COUNT(*) FROM mail WHERE received >= ?1 AND state = 'done') AS c,
       (SELECT COUNT(*) FROM mail WHERE received >= ?1 AND state = 'dropped') AS d
     UNION ALL SELECT 'blocked', pattern, added, NULL, NULL FROM (SELECT * FROM blocked ORDER BY added DESC LIMIT 200)`,
    dayStart,
  );
  const counts = rows.find((r) => r.kind === 'counts');
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
    today: { received: counts?.b ?? 0, delivered: counts?.c ?? 0, dropped: counts?.d ?? 0 },
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
