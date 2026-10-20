// safeFetch (DESIGN.md 9.7): the only way the server fetches feeds and pages from the web.

import { isPublicHost, publicUrl } from '../client/daylight-server.js';
import { ServerError } from './errors.ts';
import { decodeEntities } from './html.ts';

export const USER_AGENT = 'DaylightServer/1 (+https://github.com/12twelve12hi/MHW)';

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  headers?: Record<string, string>;
  /** The Worker's own host, never fetched. */
  selfHost?: string;
  maxRedirects?: number;
}

export interface SafeResponse {
  status: number;
  url: string;
  headers: Headers;
  body: Uint8Array;
}

/** Checks a URL the server is about to fetch: http(s), port empty/80/443, no user info, a public host. */
export function checkFetchUrl(raw: string, selfHost = ''): URL {
  const p = publicUrl(raw);
  if (!p) throw new ServerError(422, 'URL_BLOCKED');
  const u = new URL(p);
  if (u.port && u.port !== '80' && u.port !== '443') throw new ServerError(422, 'URL_BLOCKED');
  if (u.username || u.password) throw new ServerError(422, 'URL_BLOCKED');
  if (!isPublicHost(u.hostname)) throw new ServerError(422, 'URL_BLOCKED');
  if (selfHost && u.hostname.toLowerCase() === selfHost.toLowerCase()) throw new ServerError(422, 'URL_BLOCKED');
  return u;
}

/**
 * Reads a body through a counter that cancels at `max` decoded bytes. -> the bytes, or throws 413 TOO_LARGE.
 * Code never calls .text(), .json() or .arrayBuffer() on a fetched Response directly.
 */
export async function readCappedBody(body: ReadableStream<Uint8Array> | null, max: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new ServerError(502, 'FETCH_FAILED');
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw new ServerError(413, 'TOO_LARGE', { limit: max });
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ServerError) throw e;
    throw new ServerError(502, 'FETCH_FAILED');
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** GET with every 9.7 rule. Redirects (at most 5) are followed by hand and each hop is checked again. */
export async function safeFetch(fetchFn: FetchFn, url: string, opts: SafeFetchOptions): Promise<SafeResponse> {
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let current = checkFetchUrl(url, opts.selfHost);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetchFn(current.href, {
        method: 'GET', redirect: 'manual', signal,
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...(opts.headers ?? {}) },
      });
    } catch (e) {
      if ((e as Error)?.name === 'BudgetError') throw e;
      throw new ServerError(502, 'FETCH_FAILED');
    }
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      const loc = res.headers.get('Location');
      if (!loc || hop >= (opts.maxRedirects ?? 5)) throw new ServerError(502, 'FETCH_FAILED');
      let next: string;
      try { next = new URL(loc, current).href; } catch { throw new ServerError(502, 'FETCH_FAILED'); }
      current = checkFetchUrl(next, opts.selfHost);
      continue;
    }
    const len = res.headers.get('Content-Length');
    if (len !== null && Number(len) > opts.maxBytes) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      throw new ServerError(413, 'TOO_LARGE', { limit: opts.maxBytes });
    }
    const body = res.status === 304 ? new Uint8Array(0) : await readCappedBody(res.body, opts.maxBytes, signal);
    return { status: res.status, url: current.href, headers: res.headers, body };
  }
}

/** Cloudflare's DNS-over-HTTPS resolver (JSON API). Workers can't fetch an IP address, so this is the name. */
export const DOH_URL = 'https://cloudflare-dns.com/dns-query';

/**
 * True when `host` resolves, in public DNS, to public addresses only (every A and AAAA record passes isPublicHost and
 * there is at least one). A name that doesn't resolve publicly (NXDOMAIN; a LAN-only name like fritz.box), one that
 * resolves to a private address (192.168.1.1.nip.io) and one that can't be checked (resolver error) is not public.
 * An IP literal is judged by isPublicHost alone. Costs 2 subrequests. It can't see split-horizon answers or DNS
 * rebinding on the home network, which is why the Reader should check the address it connects to as well (9.7).
 */
export async function resolvesPublic(fetchFn: FetchFn, host: string, timeoutMs = 5000): Promise<boolean> {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!isPublicHost(h)) return false;
  if (h.startsWith('[') || /^[0-9.]+$/.test(h)) return true;
  let found = false;
  for (const [type, code] of [['A', 1], ['AAAA', 28]] as const) {
    let res: Response;
    try {
      res = await fetchFn(`${DOH_URL}?name=${encodeURIComponent(h)}&type=${type}`, {
        headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if ((e as Error)?.name === 'BudgetError') throw e;
      return false;
    }
    if (res.status !== 200) { try { await res.body?.cancel(); } catch { /* ignore */ } return false; }
    let j: { Status?: number; Answer?: { type?: number; data?: string }[] };
    try { j = JSON.parse(new TextDecoder().decode(await readCappedBody(res.body, 64 * 1024))); } catch { return false; }
    if (j.Status !== 0) return false;
    for (const a of j.Answer ?? []) {
      if (a.type !== code) continue;
      const addr = String(a.data ?? '');
      if (!isPublicHost(code === 28 ? `[${addr}]` : addr)) return false;
      found = true;
    }
  }
  return found;
}

/** Visible text of an HTML page for AI (9.2): p, h1–h6, li, blockquote, pre, td, figcaption; never script, style,
 *  nav, footer, aside or form. -> {title, text}. */
export async function extractText(html: string): Promise<{ title: string; text: string }> {
  let skip = 0;
  const out: string[] = [];
  let title = '';
  let inTitle = false;
  const rewriter = new HTMLRewriter()
    .on('script, style, nav, footer, aside, form, noscript, template, svg', {
      element(el) {
        skip++;
        try { el.onEndTag(() => { skip--; }); } catch { skip--; }
      },
    })
    .on('title', {
      element(el) { inTitle = true; try { el.onEndTag(() => { inTitle = false; }); } catch { inTitle = false; } },
      text(t) { if (inTitle && title.length < 600) title += t.text; },
    })
    .on('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, figcaption', {
      element() { out.push('\n\n'); },
      text(t) { if (!skip) out.push(t.text); },
    });
  await rewriter.transform(new Response(html)).text();
  const text = decodeEntities(out.join('')).replace(/[ \t\r\f\v]+/g, ' ').replace(/\n[ \n]*\n/g, '\n\n').trim();
  return { title: decodeEntities(title).replace(/\s+/g, ' ').trim(), text };
}
