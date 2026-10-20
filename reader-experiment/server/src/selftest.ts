// The CPU canary (DESIGN.md 2.2 rule 7): parses a 150 KiB newsletter and builds a 256 KiB server item. The deploy calls
// it three times; if Cloudflare kills a call (1102 / 503) the deploy reports {"result": "killed"} and email-in shows
// needs-paid.

import PostalMime from 'postal-mime';
import { buildServerItemFrames, sealBox } from '../client/daylight-server.js';
import type { Ctx } from './env.ts';
import { MIN } from './env.ts';
import type { Identity } from './keys.ts';
import { ServerError, json } from './errors.ts';
import type { Settings } from './settings.ts';
import { saveStmt } from './settings.ts';
import { sanitize } from './sanitize.ts';

/** A deterministic newsletter of about `kib` KiB (HTML and text alternatives, one inline image). */
export function newsletterFixture(kib = 150): string {
  const para = (i: number) => `<p style="margin:0 0 12px">Paragraph ${i}: the quick brown fox jumps over the lazy dog, `
    + `and <a href="https://example.com/story/${i}?utm_source=news">story ${i}</a> continues with <b>bold</b> words.</p>`;
  const parts: string[] = [];
  let size = 0, i = 0;
  while (size < kib * 1024 * 0.6) { const p = para(i++); parts.push(p); size += p.length; }
  const html = `<html><head><style>p{color:#333}</style></head><body><a href="https://example.com/web">View in browser</a>${parts.join('\n')}<img src="cid:logo@x" width="120"></body></html>`;
  const text = parts.map((p) => p.replace(/<[^>]+>/g, '')).join('\n\n');
  const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/.{76}/g, '$&\r\n');
  return [
    'From: "Example Weekly" <news@example.com>', 'To: reader@example.net', 'Subject: Example Weekly #42',
    'Date: Tue, 20 Oct 2026 07:00:00 +0000', 'Message-ID: <selftest@example.com>', 'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary="rel"', '', '--rel',
    'Content-Type: multipart/alternative; boundary="alt"', '', '--alt',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(text), '--alt',
    'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(html), '--alt--', '--rel',
    'Content-Type: image/png', 'Content-ID: <logo@x>', 'Content-Transfer-Encoding: base64', '',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', '--rel--', '',
  ].join('\r\n');
}

/**
 * POST /v1/admin/selftest: {} runs the canary, at most 3 times a minute (the deploy's three calls); {"result":
 * "killed"} records a canary Cloudflare killed. That report comes right after the three calls, so it is not counted
 * against them: it only writes one setting.
 */
export async function selftest(ctx: Ctx, id: Identity, s: Settings, body: Record<string, unknown>): Promise<Response> {
  if (body.result === 'killed') {
    await ctx.db.batch([saveStmt(ctx, { canary: 'killed' })]);
    return json(ctx.rid, 200, { ok: true, canary: 'killed' });
  }
  const st = s.selftest && ctx.now - s.selftest.at < MIN ? s.selftest : { at: ctx.now, n: 0 };
  if (st.n >= 3) throw new ServerError(429, 'RATE_LIMITED', { retryAfter: 60 });
  const t0 = Date.now();
  const email = await PostalMime.parse(newsletterFixture(150), { attachmentEncoding: 'arraybuffer', maxNestingDepth: 32 });
  const t1 = Date.now();
  let page = await sanitize(email.html ?? '');
  while (page.length < 256 * 1024) page += page;
  const built = await buildServerItemFrames((h: Record<string, unknown>, b: Uint8Array, n?: Uint8Array) => sealBox(id.values, 'item', h, b as never, n as never), {
    id: '0'.repeat(32), kind: 'page', url: 'https://daylight.invalid/i/selftest', title: 'Self-test', content: page.slice(0, 256 * 1024),
  });
  const t2 = Date.now();
  // The deploy reports {"result": "killed"} after its three calls when any of them was killed.
  await ctx.db.batch([saveStmt(ctx, { canary: 'ok', selftest: { at: st.at, n: st.n + 1 } })]);
  return json(ctx.rid, 200, { ok: built.frames.length > 0, ms: { parse: t1 - t0, build: t2 - t1 } });
}
