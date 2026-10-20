// A small stand-in for an ntfy server, for tests and local demos. It implements the parts of ntfy the Daylight Share
// protocol uses (PROTOCOL.md section 3) and behaves like ntfy.sh where the protocol depends on it (NTFY-FACTS.md):
//
// - attachments of at most 2,000,000 bytes each (the floor PROTOCOL 3.5 promises; ntfy.sh itself takes 2,097,152, so
//   pass --attachment-max 2097152 to mirror it exactly) and 20,000,000 live bytes per visitor (uploader), freed 3 h
//   after the upload started; over either limit a publish gets 413 {"code":41301} (the body is drained, never reset);
// - a message's `time` is stamped when its request starts, and it becomes visible to polls only when its body has been
//   read, so a slow upload can appear after messages stamped later than it;
// - `since=<unix time>` is inclusive. `since=<message id>` (kept from the v1.0 mock; no client uses id cursors) returns
//   what was stored after it, and an unknown or expired id returns everything, as on ntfy.sh (NTFY-FACTS.md);
// - messages are kept 12 h and attachments 3 h, on the mock's clock (which tests can inject or move).
//
//   node mock-relay.mjs [--port 8787] [--host 127.0.0.1] [--public-url http://10.0.2.2:8787]
//                       [--message-ttl 43200] [--attachment-ttl 10800]
//                       [--attachment-max 2000000] [--visitor-total 20000000] [--no-attachments] [--early-413]
//                       [--control]
//
// --no-attachments  every attachment publish answers 400 {"code":40014} (a server without attachment-cache-dir)
// --early-413       answer an over-limit PUT's 413 before reading its body, then close the connection (a Go ntfy
//                   server without a proxy in front)
// --control         enables the test hooks below
//
// Endpoints: POST|PUT /<topic> (publish), GET /<topic>/json (poll=1 or stream), GET /<topic>/sse,
// GET /file/<id>.bin (attachments), GET /v1/health. CORS is open, as on ntfy.sh.
//
// Test hooks (with --control / control: true; JS tests can also pass the functions to startMockRelay):
//   POST /__mock/fail-downloads?count=N&status=S   the next N attachment downloads answer S (a status, or "reset" to
//                                                  cut the connection mid-body)
//   POST /__mock/fail-publish?count=N&status=S[&topic=T]   the next N publishes (to T) answer S, e.g. 429 or 413
//   POST /__mock/clock?offsetSec=N | ?advanceSec=N  set the clock's offset to N s, or move it N s further
//   GET  /__mock/state                              {published, downloads, downloadsById, offsetSec}
//   X-Mock-Visitor: <name>   on a publish: whose attachment total it counts against (default: the remote address)
//   X-Mock-Hold: <ms>        on a publish: keep the message invisible (and the answer back) for that long after its
//                            body was read
//   failDownload(id, n) -> status | 'reset' | null   n = downloads of that attachment so far
//   failPublish(topic, n, isAttachment) -> status | null   n = publishes to that topic so far

import http from 'node:http';
import { randomBytes } from 'node:crypto';

const TOPIC_RE = /^[-_A-Za-z0-9]{1,64}$/;
const NO_ATTACHMENTS = { code: 40014, http: 400, error: 'invalid request: attachments not allowed' };
const ERRORS = {
  400: [40000, 'invalid request'],
  401: [40101, 'unauthorized'],
  403: [40301, 'forbidden'],
  404: [40401, 'page not found'],
  405: [40501, 'method not allowed'],
  408: [40801, 'request timeout'],
  413: [41301, 'attachment too large, or bandwidth limit reached'],
  429: [42901, 'limit reached: too many requests, please be nice'],
  500: [50001, 'internal server error'],
  502: [50201, 'bad gateway'],
  503: [50301, 'service unavailable'],
};

export function startMockRelay({
  port = 0, host = '127.0.0.1', publicUrl = '', messageTtlSec = 12 * 3600, attachmentTtlSec = 3 * 3600,
  messageMaxBytes = 4096, attachmentMaxBytes = 2000000, visitorAttachmentTotalBytes = 20000000,
  attachments = true, early413 = false, control = false, keepaliveSec = 45, now = () => Date.now(),
  failDownload = null, failPublish = null,
} = {}) {
  const topics = new Map(); // topic -> [message], in the order they became visible
  const files = new Map(); // id -> {bytes, expires}
  const visitors = new Map(); // visitor -> [{bytes, expires}] live attachment bytes
  const listeners = new Map(); // topic -> Set<fn>
  const publishCounts = new Map(); // topic -> publishes so far
  const queued = { downloads: [], publishes: [] }; // control: [{status, topic}]
  let offsetMs = 0;
  const state = { topics, files, visitors, published: 0, downloads: 0, downloadsById: {}, requests: [] };
  let base = '';

  const clock = () => now() + offsetMs;
  const nowSec = () => Math.floor(clock() / 1000);
  const newId = () => randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').slice(0, 12);

  function prune() {
    const t = nowSec();
    for (const [topic, list] of topics) topics.set(topic, list.filter((m) => m.expires > t));
    for (const [id, f] of files) if (f.expires <= t) files.delete(id);
    for (const [v, list] of visitors) visitors.set(v, list.filter((a) => a.expires > t));
  }

  const visitorUsed = (v) => (visitors.get(v) ?? []).reduce((n, a) => n + a.bytes, 0);

  // Attachment URLs as the asking client can reach them: publicUrl if set, else that request's Host header.
  function withBase(m, req) {
    if (!m.attachment) return m;
    const origin = publicUrl || (req.headers.host ? `http://${req.headers.host}` : base);
    return { ...m, attachment: { ...m.attachment, url: origin + m.attachment.url } };
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

  const errorBody = (status) => {
    const [code, error] = ERRORS[status] ?? [status * 100 + 1, 'error'];
    return { code, http: status, error };
  };

  // Answers an error after reading (and discarding) the rest of the request body, as ntfy behind a proxy does.
  function drainThenError(req, res, status, body = errorBody(status)) {
    if (req.readableEnded) return send(res, status, body);
    req.on('end', () => send(res, status, body));
    req.on('error', () => {});
    req.resume();
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
    return i < 0 ? list : list.slice(i + 1); // an unknown or expired id returns everything, as on ntfy.sh
  }

  const takeQueued = (list, topic) => {
    const i = list.findIndex((q) => !q.topic || q.topic === topic);
    if (i < 0) return null;
    const q = list[i];
    if (--q.count <= 0) list.splice(i, 1);
    return q.status;
  };

  function handleControl(req, res, url) {
    const p = url.searchParams;
    const count = Number(p.get('count') ?? 1);
    const status = p.get('status') === 'reset' ? 'reset' : Number(p.get('status'));
    if (url.pathname === '/__mock/fail-downloads') { queued.downloads.push({ count, status }); return send(res, 200, { ok: true }); }
    if (url.pathname === '/__mock/fail-publish') { queued.publishes.push({ count, status, topic: p.get('topic') || null }); return send(res, 200, { ok: true }); }
    if (url.pathname === '/__mock/clock') {
      if (p.has('offsetSec')) offsetMs = Number(p.get('offsetSec')) * 1000;
      if (p.has('advanceSec')) offsetMs += Number(p.get('advanceSec')) * 1000;
      return send(res, 200, { time: nowSec(), offsetSec: offsetMs / 1000 });
    }
    if (url.pathname === '/__mock/state') {
      return send(res, 200, { published: state.published, downloads: state.downloads, downloadsById: state.downloadsById, offsetSec: offsetMs / 1000 });
    }
    return send(res, 404, errorBody(404));
  }

  function handleDownload(req, res, fid) {
    const n = state.downloadsById[fid] ?? 0;
    state.downloadsById[fid] = n + 1;
    const forced = failDownload?.(fid, n) ?? takeQueued(queued.downloads, null);
    const f = files.get(fid);
    if (forced === 'reset') {
      cors(res);
      const bytes = f?.bytes ?? Buffer.alloc(1000);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length });
      res.write(bytes.subarray(0, Math.floor(bytes.length / 2)), () => res.socket?.destroy());
      return;
    }
    if (forced) return send(res, forced, errorBody(forced));
    if (!f) return send(res, 404, { code: 40401, http: 404, error: 'page not found' });
    state.downloads++;
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': f.bytes.length });
    return res.end(f.bytes);
  }

  async function handlePublish(req, res, topic) {
    const t = nowSec(); // ntfy stamps a message when its request starts
    const n = publishCounts.get(topic) ?? 0;
    publishCounts.set(topic, n + 1);
    const filename = req.headers['filename'] ?? req.headers['x-filename'] ?? req.headers['file'] ?? req.headers['f'];
    const lenHeader = req.headers['content-length'];
    const declared = lenHeader != null ? Number(lenHeader) : NaN;
    const likelyAttachment = !!filename || declared > messageMaxBytes;
    const visitor = (control && req.headers['x-mock-visitor']) || req.socket.remoteAddress || 'unknown';
    const hold = control ? Number(req.headers['x-mock-hold'] ?? 0) : 0;

    const forced = failPublish?.(topic, n, likelyAttachment) ?? (control ? takeQueued(queued.publishes, topic) : null);
    if (forced) return drainThenError(req, res, forced);
    if (likelyAttachment && !attachments) return drainThenError(req, res, 400, NO_ATTACHMENTS);
    if (likelyAttachment && Number.isFinite(declared)
        && (declared > attachmentMaxBytes || visitorUsed(visitor) + declared > visitorAttachmentTotalBytes)) {
      if (early413) {
        cors(res);
        res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify(errorBody(413)) + '\n', () => req.socket?.destroy());
        return;
      }
      return drainThenError(req, res, 413);
    }

    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size <= Math.max(attachmentMaxBytes, messageMaxBytes) + 1) chunks.push(c);
    }
    const body = Buffer.concat(chunks);
    let text = null;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { text = null; }
    const msg = { id: newId(), time: t, expires: t + messageTtlSec, event: 'message', topic };
    if (filename || text === null || size > messageMaxBytes) {
      if (!attachments) return send(res, 400, NO_ATTACHMENTS);
      if (size > attachmentMaxBytes || visitorUsed(visitor) + size > visitorAttachmentTotalBytes) return send(res, 413, errorBody(413));
      const expires = t + Math.min(attachmentTtlSec, messageTtlSec);
      const list = visitors.get(visitor) ?? [];
      list.push({ bytes: size, expires: t + attachmentTtlSec });
      visitors.set(visitor, list);
      files.set(msg.id, { bytes: body, expires });
      msg.message = req.headers['message'] ?? req.headers['x-message'] ?? `You received a file: ${filename ?? 'attachment.bin'}`;
      msg.attachment = { name: String(filename ?? 'attachment.bin'), type: 'application/octet-stream', size, expires, url: `/file/${msg.id}.bin` };
    } else {
      msg.message = text;
    }
    if (hold > 0) await new Promise((r) => setTimeout(r, hold));
    const list = topics.get(topic) ?? [];
    list.push(msg);
    topics.set(topic, list);
    state.published++;
    for (const fn of listeners.get(topic) ?? []) fn(msg);
    return send(res, 200, withBase(msg, req));
  }

  const server = http.createServer((req, res) => {
    // A client that goes away mid-request must not take the relay down with an unhandled rejection.
    handle(req, res).catch(() => { try { res.destroy(); } catch { /* gone */ } });
  });

  async function handle(req, res) {
    prune();
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    state.requests.push(`${req.method} ${url.pathname}${url.search}`);
    if (req.method === 'OPTIONS') return send(res, 200, '');

    if (req.method === 'GET' && url.pathname === '/v1/health') return send(res, 200, { healthy: true });

    if (control && parts[0] === '__mock') return handleControl(req, res, url);

    if (req.method === 'GET' && parts[0] === 'file' && parts.length === 2) return handleDownload(req, res, parts[1].replace(/\.bin$/, ''));

    if ((req.method === 'POST' || req.method === 'PUT') && parts.length === 1 && TOPIC_RE.test(parts[0])) {
      return handlePublish(req, res, parts[0]);
    }

    if (req.method === 'GET' && parts.length === 2 && TOPIC_RE.test(parts[0]) && (parts[1] === 'json' || parts[1] === 'sse')) {
      const topic = parts[0];
      const list = parseSince(url.searchParams.get('since') ?? (url.searchParams.has('poll') ? 'all' : 'none'), topics.get(topic) ?? []);
      const sse = parts[1] === 'sse';
      const line = (m0) => { const m = withBase(m0, req); return sse ? `id: ${m.id}\nevent: ${m.event}\ndata: ${JSON.stringify(m)}\n\n` : JSON.stringify(m) + '\n'; };
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
  }

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
  const has = (name) => process.argv.includes(`--${name}`);
  const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
  if (has('help')) {
    console.log('node mock-relay.mjs [--port 8787] [--host 127.0.0.1] [--public-url URL] [--message-ttl 43200] [--attachment-ttl 10800]\n'
      + '                    [--attachment-max 2000000] [--visitor-total 20000000] [--no-attachments] [--early-413] [--control]');
    process.exit(0);
  }
  const relay = await startMockRelay({
    port: Number(arg('port', 8787)), host: arg('host', '127.0.0.1'), publicUrl: arg('public-url', ''),
    messageTtlSec: Number(arg('message-ttl', 43200)), attachmentTtlSec: Number(arg('attachment-ttl', 10800)),
    attachmentMaxBytes: Number(arg('attachment-max', 2000000)), visitorAttachmentTotalBytes: Number(arg('visitor-total', 20000000)),
    attachments: !has('no-attachments'), early413: has('early-413'), control: has('control'),
  });
  console.log(`mock ntfy relay listening on ${relay.url}`);
}
