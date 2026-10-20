// Unit tests (Node) for safeFetch (DESIGN.md 9.7): host checks on every hop, manual redirects, decoded-byte caps that
// cancel the stream (a gzip bomb and a 10 MB chunked answer), Content-Length refusal and timeouts.
import './testing-global.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { checkFetchUrl, safeFetch, readCappedBody, USER_AGENT } from '../src/safefetch.ts';

const blocked = (fn) => assert.throws(fn, (e) => e.code === 'URL_BLOCKED' && e.status === 422);

test('checkFetchUrl: schemes, ports, user info, private hosts and the Worker itself', () => {
  for (const u of ['http://127.0.0.1/', 'http://[::1]/', 'http://192.168.1.1/', 'http://router.lan/', 'http://2130706433/',
    'http://[64:ff9b::a00:1]/', 'http://[::ffff:10.0.0.1]/', 'ftp://example.com/', 'https://example.com:8443/', 'https://a:b@example.com/',
    'http://metadata.internal/', 'file:///etc/passwd']) blocked(() => checkFetchUrl(u));
  blocked(() => checkFetchUrl('https://daylight-x.acct.workers.dev/v1/status', 'daylight-x.acct.workers.dev'));
  assert.equal(checkFetchUrl('https://example.com:443/feed').href, 'https://example.com/feed');
  assert.equal(checkFetchUrl('http://example.com:80/x').href, 'http://example.com/x');
});

test('redirects are followed by hand, at most 5, and every hop is checked again', async () => {
  const seen = [];
  const chain = { 'https://a.example/1': 'https://b.example/2', 'https://b.example/2': '/3', 'https://b.example/3': null };
  const f = async (url, init) => {
    seen.push([url, init.redirect, init.headers['User-Agent']]);
    const next = chain[url];
    return next ? new Response(null, { status: 301, headers: { Location: next } }) : new Response('ok');
  };
  const r = await safeFetch(f, 'https://a.example/1', { maxBytes: 100, timeoutMs: 1000 });
  assert.equal(r.url, 'https://b.example/3');
  assert.equal(new TextDecoder().decode(r.body), 'ok');
  assert.deepEqual(seen.map((s) => s[1]), ['manual', 'manual', 'manual']);
  assert.equal(seen[0][2], USER_AGENT);
  const toLan = async (url) => (url.includes('a.example') ? new Response(null, { status: 302, headers: { Location: 'http://192.168.1.1/admin' } }) : new Response('never'));
  await assert.rejects(safeFetch(toLan, 'https://a.example/', { maxBytes: 100, timeoutMs: 1000 }), (e) => e.code === 'URL_BLOCKED');
  let n = 0;
  const loop = async () => new Response(null, { status: 302, headers: { Location: `https://l.example/${++n}` } });
  await assert.rejects(safeFetch(loop, 'https://l.example/0', { maxBytes: 100, timeoutMs: 1000 }), (e) => e.code === 'FETCH_FAILED');
  assert.equal(n, 6, 'the 6th redirect is not followed');
});

test('Content-Length over the cap is refused before reading', async () => {
  let pulled = 0;
  const body = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1000)); } });
  const f = async () => new Response(body, { headers: { 'Content-Length': '5000000' } });
  await assert.rejects(safeFetch(f, 'https://x.example/', { maxBytes: 2_000_000, timeoutMs: 1000 }), (e) => e.code === 'TOO_LARGE' && e.extra.limit === 2_000_000);
  assert.ok(pulled <= 1);
});

test('a 10 MB chunked answer without Content-Length is cancelled at the cap', async () => {
  let sent = 0, cancelled = false;
  const body = new ReadableStream({
    pull(c) { if (sent >= 10_000_000) return c.close(); sent += 65536; c.enqueue(new Uint8Array(65536)); },
    cancel() { cancelled = true; },
  });
  const f = async () => new Response(body);
  await assert.rejects(safeFetch(f, 'https://x.example/', { maxBytes: 2 * 1024 * 1024, timeoutMs: 5000 }), (e) => e.code === 'TOO_LARGE');
  assert.ok(cancelled, 'the stream is cancelled');
  assert.ok(sent < 3 * 1024 * 1024, `read ${sent} bytes`);
});

test('a gzip bomb (1 MB -> 1 GB) stops at the decoded-byte cap', async () => {
  // Workers' fetch decompresses gzip; simulate that by handing safeFetch the decoded stream.
  const chunk = gzipSync(new Uint8Array(64 * 1024 * 1024)); // ~65 KB of gzip -> 64 MiB
  let inflated = 0;
  const f = async () => {
    const decoded = new Blob([chunk]).stream().pipeThrough(new DecompressionStream('gzip'))
      .pipeThrough(new TransformStream({ transform(c, ctl) { inflated += c.byteLength; ctl.enqueue(c); } }));
    return new Response(decoded);
  };
  const t0 = Date.now();
  await assert.rejects(safeFetch(f, 'https://x.example/', { maxBytes: 2 * 1024 * 1024, timeoutMs: 5000 }), (e) => e.code === 'TOO_LARGE');
  assert.ok(inflated < 8 * 1024 * 1024, `inflated only ${inflated} bytes`);
  assert.ok(Date.now() - t0 < 2000);
});

test('timeouts end the fetch with FETCH_FAILED', async () => {
  const slow = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('timeout', 'TimeoutError'))));
  const keepAlive = setTimeout(() => {}, 2000); // AbortSignal.timeout's timer does not hold Node's event loop open
  await assert.rejects(safeFetch(slow, 'https://x.example/', { maxBytes: 100, timeoutMs: 50 }), (e) => e.code === 'FETCH_FAILED');
  clearTimeout(keepAlive);
  const empty = await readCappedBody(null, 10);
  assert.equal(empty.length, 0);
});
