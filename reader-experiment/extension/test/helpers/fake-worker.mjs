// A stand-in for the Daylight server (server/DESIGN.md 10) for the Lab tests: GET /v1/hello, GET /v1/status,
// POST /v1/setup (state.setup) and POST /v1/admin/lock, with the Server code's bearer token when one is given. The test sets the status it answers
// (state.status), and may slow it down (state.statusDelayMs).
//
// Also: a relay that never answers (hangingServer) and an address where nothing listens (deadAddress), for the gate's
// OFFLINE cases (F00.6).
import http from 'node:http';

/** A GET /v1/status answer (DESIGN 10.5): every feature ready unless `features` says otherwise. */
export function statusJson({ features = {}, lastSeen = null, usd = 0, limitUsd = 3 } = {}) {
  const all = Object.fromEntries(['ai', 'pdf', 'email', 'feeds', 'files', 'deliver'].map((f) => [f, { state: 'ready' }]));
  for (const [f, state] of Object.entries(features)) all[f] = typeof state === 'string' ? { state } : state;
  return {
    api: 1, features: all,
    inbox: { lab: !!lastSeen, lastSeen },
    usage: { ai: { requests: 1, usd, reservedUsd: 0, limitUsd, limitRequests: 100, resetAt: '2026-10-23T00:00:00.000Z' } },
  };
}

/** host: 'localhost' keeps it apart from the mock relay on 127.0.0.1, so their host permissions differ. */
export async function startFakeWorker({ status = statusJson(), token = null, host = 'localhost' } = {}) {
  const hits = [];
  const state = { status, token };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push(`${req.method} ${u.pathname}`);
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(body));
    };
    req.resume();
    if (u.pathname === '/v1/hello') return send(200, { service: 'daylight-server', api: 1 });
    // The setup link (DESIGN 3.5): state.setup = {token: the link's setup token, answer: the config fields}.
    if (u.pathname === '/v1/setup' && req.method === 'POST') {
      if (!state.setup || req.headers.authorization !== `Bearer ${state.setup.token}`) return send(401, { error: { code: 'SETUP_INVALID' } });
      return send(200, state.setup.answer);
    }
    if (state.token && req.headers.authorization !== `Bearer ${state.token}`) return send(401, { error: { code: 'BAD_AUTH' } });
    if (u.pathname === '/v1/status' && req.method === 'GET') {
      // statusDelayMs: a slow answer, for what a screen shows while it waits.
      if (state.statusDelayMs) return void setTimeout(() => send(200, state.status), state.statusDelayMs);
      return send(200, state.status);
    }
    if (u.pathname === '/v1/admin/lock' && req.method === 'POST') return send(200, { locked: true });
    return send(404, { error: { code: 'NOT_FOUND', message: 'Not here.' } });
  });
  await new Promise((r) => server.listen(0, host === 'localhost' ? '127.0.0.1' : host, r));
  const url = `http://${host}:${server.address().port}`;
  return {
    url, hits, state,
    count: (what) => hits.filter((h) => h === what).length,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

/** An HTTP server that accepts requests and never answers them. */
export async function hangingServer() {
  const held = [];
  const server = http.createServer((req, res) => { held.push(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

/** An address where nothing listens (a port that was just closed): connections are refused at once. */
export async function deadAddress() {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  await new Promise((r) => server.close(() => r()));
  return url;
}
