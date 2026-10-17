// Assembles the web sender (static files, no bundling):
//
//   dist/site/                      the site to host (GitHub Pages serves it at …/send/)
//   dist/send-to-daylight-web.zip   the same files, to host anywhere
//
//   node build.mjs [--serve [port]]      (--serve also serves dist/site on http://127.0.0.1:<port>, default 8080)
//
// daylight-share.js (../share/js) and logic.js (../extension/src) are copied in from their one source; sw.js gets a
// hash of the site so browsers pick up each new version.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zipDir, listFiles } from '../extension/scripts/zip.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, 'dist');
const SITE = path.join(DIST, 'site');
const OWN = ['index.html', 'app.js', 'styles.css', 'web-logic.js', 'web-storage.js', 'sw.js', 'manifest.webmanifest', 'icons'];
const SHARED = {
  'daylight-share.js': path.join(here, '..', 'share', 'js', 'daylight-share.js'),
  'logic.js': path.join(here, '..', 'extension', 'src', 'logic.js'),
};

export function buildSite(out = SITE) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of OWN) fs.cpSync(path.join(here, f), path.join(out, f), { recursive: true });
  for (const [name, src] of Object.entries(SHARED)) fs.copyFileSync(src, path.join(out, name));
  const hash = createHash('sha256');
  for (const rel of listFiles(out).filter((f) => f !== 'sw.js')) hash.update(rel).update(fs.readFileSync(path.join(out, rel)));
  const build = hash.digest('hex').slice(0, 12);
  const swPath = path.join(out, 'sw.js');
  fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace("'__BUILD__'", `'${build}'`));
  return { out, build };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

/** A static server for dist/site (tests and local use). */
export function serve(root = SITE, port = 0, host = '127.0.0.1') {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { 'Content-Type': 'text/plain' }); return res.end('405 Not Allowed'); }
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, rel);
    if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({
    server, url: `http://${host}:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { out, build } = buildSite();
  console.log(`built ${path.relative(process.cwd(), out) || '.'} (build ${build})`);
  const zip = path.join(DIST, 'send-to-daylight-web.zip');
  console.log(`wrote ${path.relative(process.cwd(), zip)} (${zipDir(out, zip)} files)`);
  const si = process.argv.indexOf('--serve');
  if (si > 0) {
    const s = await serve(SITE, Number(process.argv[si + 1]) || 8080);
    console.log(`serving ${s.url}/`);
  }
}
