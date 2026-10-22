// A stand-in for the Daylight server (server/DESIGN.md 10) for the Windows Lab tests: GET /v1/hello, GET /v1/status,
// POST /v1/setup (state.setup) and POST /v1/admin/lock, with the Server code's bearer token when one is given, and
// the Worker's CORS answers (DESIGN 10.2), since the window's page calls it from its own origin (tauri.localhost in
// the app, 127.0.0.1 in the UI tests). The test sets the status it answers (state.status) and may slow it down.
//
// Also: a relay that never answers (hangingServer) and an address where nothing listens (deadAddress), for the gate's
// OFFLINE cases (F00.6), and a deleted Worker's address (goneWorker), for a server that moved.
import http from 'node:http';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-DLS-Source-Name',
  'Access-Control-Max-Age': '86400',
};

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

export async function startFakeWorker({ status = statusJson(), token = null } = {}) {
  const hits = [];
  const state = { status, token, statusDelayMs: 0, setup: null };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify(body));
    };
    req.resume();
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return undefined; }
    hits.push(`${req.method} ${u.pathname}`);
    if (u.pathname === '/v1/hello') return send(200, { service: 'daylight-server', api: 1 });
    // The setup link (DESIGN 3.5): state.setup = {token: the link's setup token, answer: the config fields}.
    if (u.pathname === '/v1/setup' && req.method === 'POST') {
      if (!state.setup || req.headers.authorization !== `Bearer ${state.setup.token}`) return send(401, { error: { code: 'SETUP_INVALID' } });
      return send(200, state.setup.answer);
    }
    if (state.token && req.headers.authorization !== `Bearer ${state.token}`) return send(401, { error: { code: 'BAD_AUTH' } });
    if (u.pathname === '/v1/status' && req.method === 'GET') {
      if (state.statusDelayMs) return void setTimeout(() => send(200, state.status), state.statusDelayMs);
      return send(200, state.status);
    }
    if (u.pathname === '/v1/admin/lock' && req.method === 'POST') return send(200, { locked: true });
    return send(404, { error: { code: 'NOT_FOUND', message: 'Not here.' } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // localhost (not 127.0.0.1): the server module takes http only for localhost and 127.0.0.1 as a typed address.
  const url = `http://localhost:${server.address().port}`;
  return {
    url, hits, state,
    count: (what) => hits.filter((h) => h === what).length,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

/** An HTTP server that accepts requests and never answers them (with CORS, so a page's preflight gets through). */
export async function hangingServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); }
    // Anything else is held: no answer, ever.
  });
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

/**
 * A workers.dev address whose Worker was deleted (a deploy with "New setup link" deletes the old one, server DESIGN
 * 3.5): Cloudflare answers every path 404 with a page of its own and no CORS headers. The server module reads it as
 * SERVER_ERROR in node; in the window (WebView2) the missing CORS headers make it a failed fetch, OFFLINE.
 */
export async function goneWorker() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${new URL(req.url, 'http://x').pathname}`);
    req.resume();
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>There is nothing here yet</title><p>There is nothing here yet.</p>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`, hits,
    count: (what) => hits.filter((h) => h === what).length,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
