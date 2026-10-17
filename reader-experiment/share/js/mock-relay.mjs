// A small stand-in for an ntfy server, for tests and local demos. It implements the parts of ntfy the Daylight Share
// protocol uses (PROTOCOL.md section 3) with ntfy's default limits, and lets tests shorten the retention times.
//
//   node mock-relay.mjs [--port 8787] [--host 127.0.0.1] [--message-ttl 43200] [--attachment-ttl 10800]
//
// Endpoints: POST|PUT /<topic> (publish), GET /<topic>/json (poll=1 or stream), GET /<topic>/sse,
// GET /file/<id>.bin (attachments), GET /v1/health. CORS is open, as on ntfy.sh.

import http from 'node:http';
import { randomBytes } from 'node:crypto';

const TOPIC_RE = /^[-_A-Za-z0-9]{1,64}$/;

export function startMockRelay({
  port = 0, host = '127.0.0.1', messageTtlSec = 12 * 3600, attachmentTtlSec = 3 * 3600,
  messageMaxBytes = 4096, attachmentMaxBytes = 15 * 1024 * 1024, keepaliveSec = 45, now = () => Date.now(),
} = {}) {
  const topics = new Map(); // topic -> [message]
  const files = new Map(); // id -> {bytes, expires}
  const listeners = new Map(); // topic -> Set<fn>
  const state = { topics, files, published: 0, downloads: 0, requests: [] };
  let base = '';

  const nowSec = () => Math.floor(now() / 1000);
  const newId = () => randomBytes(9).toString('base64url').slice(0, 12);

  function prune() {
    const t = nowSec();
    for (const [topic, list] of topics) topics.set(topic, list.filter((m) => m.expires > t));
    for (const [id, f] of files) if (f.expires <= t) files.delete(id);
  }

  function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
  }

  function send(res, status, obj, type = 'application/json') {
    cors(res);
    res.writeHead(status, { 'Content-Type': type });
    res.end(typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj) + '\n');
  }

  function parseSince(since, list) {
    if (since == null || since === '' || since === 'all') return list;
    if (since === 'none') return [];
    if (since === 'latest') return list.slice(-1);
    if (/^\d+$/.test(since)) return list.filter((m) => m.time >= Number(since));
    const d = since.match(/^(\d+)([smhd])$/);
    if (d) {
      const sec = Number(d[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[d[2]];
      return list.filter((m) => m.time >= nowSec() - sec);
    }
    const i = list.findIndex((m) => m.id === since);
    return i < 0 ? [] : list.slice(i + 1); // an expired id returns nothing (clients must not rely on ids)
  }

  const server = http.createServer(async (req, res) => {
    prune();
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    state.requests.push(`${req.method} ${url.pathname}${url.search}`);
    if (req.method === 'OPTIONS') return send(res, 200, '');

    if (req.method === 'GET' && url.pathname === '/v1/health') return send(res, 200, { healthy: true });

    if (req.method === 'GET' && parts[0] === 'file' && parts.length === 2) {
      const f = files.get(parts[1].replace(/\.bin$/, ''));
      if (!f) return send(res, 404, { code: 40401, http: 404, error: 'not found' });
      state.downloads++;
      cors(res);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': f.bytes.length });
      return res.end(f.bytes);
    }

    if ((req.method === 'POST' || req.method === 'PUT') && parts.length === 1 && TOPIC_RE.test(parts[0])) {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > attachmentMaxBytes + 1) { req.destroy(); return send(res, 413, { code: 41301, http: 413, error: 'too large' }); }
        chunks.push(c);
      }
      const body = Buffer.concat(chunks);
      const filename = req.headers['filename'] ?? req.headers['x-filename'] ?? req.headers['file'] ?? req.headers['f'];
      let text = null;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { text = null; }
      const t = nowSec();
      const msg = { id: newId(), time: t, expires: t + messageTtlSec, event: 'message', topic: parts[0] };
      if (filename || text === null || body.length > messageMaxBytes) {
        if (body.length > attachmentMaxBytes) return send(res, 413, { code: 41301, http: 413, error: 'too large' });
        const fid = msg.id;
        const expires = t + Math.min(attachmentTtlSec, messageTtlSec);
        files.set(fid, { bytes: body, expires });
        msg.message = req.headers['message'] ?? req.headers['x-message'] ?? `You received a file: ${filename ?? 'attachment.bin'}`;
        msg.attachment = { name: String(filename ?? 'attachment.bin'), type: 'application/octet-stream', size: body.length, expires, url: `${base}/file/${fid}.bin` };
      } else {
        msg.message = text;
      }
      const list = topics.get(parts[0]) ?? [];
      list.push(msg);
      topics.set(parts[0], list);
      state.published++;
      for (const fn of listeners.get(parts[0]) ?? []) fn(msg);
      return send(res, 200, msg);
    }

    if (req.method === 'GET' && parts.length === 2 && TOPIC_RE.test(parts[0]) && (parts[1] === 'json' || parts[1] === 'sse')) {
      const topic = parts[0];
      const list = parseSince(url.searchParams.get('since') ?? (url.searchParams.has('poll') ? 'all' : 'none'), topics.get(topic) ?? []);
      const sse = parts[1] === 'sse';
      const line = (m) => (sse ? `id: ${m.id}\nevent: ${m.event}\ndata: ${JSON.stringify(m)}\n\n` : JSON.stringify(m) + '\n');
      cors(res);
      if (url.searchParams.get('poll') === '1') {
        res.writeHead(200, { 'Content-Type': sse ? 'text/event-stream' : 'application/x-ndjson' });
        return res.end(list.map(line).join(''));
      }
      res.writeHead(200, { 'Content-Type': sse ? 'text/event-stream' : 'application/x-ndjson', 'Cache-Control': 'no-cache' });
      res.write(line({ id: newId(), time: nowSec(), event: 'open', topic }));
      for (const m of list) res.write(line(m));
      const fn = (m) => res.write(line(m));
      const set = listeners.get(topic) ?? new Set();
      set.add(fn);
      listeners.set(topic, set);
      const ka = setInterval(() => res.write(line({ id: newId(), time: nowSec(), event: 'keepalive', topic })), keepaliveSec * 1000);
      req.on('close', () => { clearInterval(ka); set.delete(fn); });
      return;
    }

    return send(res, 404, { code: 40401, http: 404, error: 'page not found' });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const a = server.address();
      base = `http://${host}:${a.port}`;
      resolve({
        url: base, state, server,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
  const relay = await startMockRelay({
    port: Number(arg('port', 8787)), host: arg('host', '127.0.0.1'),
    messageTtlSec: Number(arg('message-ttl', 43200)), attachmentTtlSec: Number(arg('attachment-ttl', 10800)),
  });
  console.log(`mock ntfy relay listening on ${relay.url}`);
}
