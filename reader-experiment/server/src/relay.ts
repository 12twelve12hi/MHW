// The server's own ntfy calls (DESIGN.md 5.2-5.4): small messages, Attach: messages and a hardened poll. The server
// never uploads an attachment and never downloads one.

import { toBase64 } from '../../share/js/daylight-share.js';
import { pollServerTopic } from '../client/daylight-server.js';
import type { Ctx } from './env.ts';
import type { Identity } from './keys.ts';

export interface PublishResult { ok: boolean; status: number; retry: boolean }

function topicUrl(id: Identity, topic: string): string {
  const q = id.relayToken ? `?auth=${encodeURIComponent(id.relayToken)}` : '';
  return `${id.relay}/${topic}${q}`;
}

async function publish(ctx: Ctx, url: string, init: RequestInit): Promise<PublishResult> {
  let res: Response;
  try {
    res = await ctx.fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    if ((e as Error)?.name === 'BudgetError') throw e;
    return { ok: false, status: 0, retry: true };
  }
  try { await res.body?.cancel(); } catch { /* ignore */ }
  const s = res.status;
  if (res.ok) return { ok: true, status: s, retry: false };
  return { ok: false, status: s, retry: s === 429 || s >= 500 || s === 408 };
}

/** A small frame as the message text (PROTOCOL 3.1); `b64` is base64(frame), at most 3800 characters. */
export function publishSmall(ctx: Ctx, id: Identity, topic: string, b64: string): Promise<PublishResult> {
  return publish(ctx, topicUrl(id, topic), {
    method: 'POST', headers: { 'Content-Type': 'text/plain', Firebase: 'no', Cache: 'yes' }, body: b64,
  });
}

export function publishFrame(ctx: Ctx, id: Identity, topic: string, frame: Uint8Array): Promise<PublishResult> {
  return publishSmall(ctx, id, topic, toBase64(frame));
}

/** A hosted frame: a small message whose attachment.url is the Worker (5.2). */
export function publishAttach(ctx: Ctx, id: Identity, topic: string, url: string): Promise<PublishResult> {
  return publish(ctx, topicUrl(id, topic), {
    method: 'POST', headers: { Attach: url, Filename: 'dls1.bin', Firebase: 'no', Cache: 'yes' }, body: 'dls1',
  });
}

/** -> [{id, time, frame}] (frame null for attachments and junk); at most 256 KiB and `maxMessages` lines. */
export async function poll(ctx: Ctx, id: Identity, topic: string, since: string, maxMessages = 200) {
  return pollServerTopic(
    (url: string, init: RequestInit) => ctx.fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }),
    id.relay, topic, { since, maxBytes: 262144, maxMessages, token: id.relayToken },
  );
}
