// Share's mock ntfy relay (../../share/js/mock-relay.mjs) plus ntfy's `Attach:` header (attachments from a URL),
// which the Daylight server and large-file senders use (DESIGN.md 5.2, 6.3). ntfy lists such a message with an
// `attachment` that has only `name` and `url`; the relay never downloads it.
//
// startRelay() -> {origin, handle(request) -> Response, state, attachCount(topic), messages(topic), close()}
// `handle` takes WHATWG Requests addressed to `origin` (https://relay.test), so the Worker (through Miniflare's
// outboundService) and Node test code (through a fetch wrapper) reach the same relay.

import { startMockRelay } from '../../share/js/mock-relay.mjs';
import { randomBytes } from 'node:crypto';

export const RELAY_ORIGIN = 'https://relay.test';

export async function startRelay({ now = () => Date.now(), origin = RELAY_ORIGIN, ...opts } = {}) {
  const relay = await startMockRelay({ publicUrl: origin, now, ...opts });
  const external = new Map(); // message id -> external URL
  const log = [];

  async function publishAttach(topic, req) {
    const body = await req.text();
    const t = Math.floor(now() / 1000);
    const id = randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').slice(0, 12);
    const name = req.headers.get('filename') ?? 'attachment';
    const msg = { id, time: t, expires: t + 12 * 3600, event: 'message', topic, message: body || 'You received a file', attachment: { name, url: `/__ext/${id}` } };
    external.set(id, req.headers.get('attach'));
    const list = relay.state.topics.get(topic) ?? [];
    list.push(msg);
    relay.state.topics.set(topic, list);
    relay.state.published++;
    return Response.json({ ...msg, attachment: { name, url: req.headers.get('attach') } });
  }

  function rewrite(text) {
    return text.split('\n').map((line) => {
      if (!line.includes('/__ext/')) return line;
      try {
        const m = JSON.parse(line);
        const id = /\/__ext\/([^/?#]+)$/.exec(m.attachment?.url ?? '')?.[1];
        if (id && external.has(id)) m.attachment = { name: m.attachment.name, url: external.get(id) };
        return JSON.stringify(m);
      } catch { return line; }
    }).join('\n');
  }

  async function handle(input, init) {
    const req = typeof input === 'string' || input instanceof URL ? new Request(input, init) : input;
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    log.push(`${req.method} ${url.pathname}${url.search}`);
    if ((req.method === 'POST' || req.method === 'PUT') && parts.length === 1 && req.headers.get('attach')) {
      return publishAttach(parts[0], req);
    }
    const target = `${relay.url}${url.pathname}${url.search}`;
    const headers = new Headers(req.headers);
    headers.delete('host');
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : new Uint8Array(await req.arrayBuffer());
    const res = await fetch(target, { method: req.method, headers, body });
    if (req.method === 'GET' && parts.length === 2 && parts[1] === 'json') {
      const text = rewrite(await res.text());
      return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/x-ndjson' } });
    }
    return new Response(res.body, { status: res.status, headers: res.headers });
  }

  return {
    origin, handle, relay, state: relay.state, log,
    messages: (topic) => relay.state.topics.get(topic) ?? [],
    attachCount: (topic) => (relay.state.topics.get(topic) ?? []).filter((m) => m.attachment?.url?.startsWith('/__ext/')).length,
    externalUrl: (id) => external.get(id),
    close: () => relay.close(),
  };
}
