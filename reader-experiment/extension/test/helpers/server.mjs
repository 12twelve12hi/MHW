// A local web server for the tests: an article page, PDFs (with and without CORS), a page over 8 MiB, a link page.
// A route can be served without Content-Length (chunked: true).
import http from 'node:http';

export async function startSite({ pdf, bigPdf } = {}) {
  const hits = [];
  const routes = new Map();
  const article = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>A quiet article</title></head>
<body><article><h1>A quiet article</h1><p id="marker">Marker paragraph: the slow loris of e-paper ✓ ünïcödé.</p>
<p>${'Calm words on a calm page. '.repeat(200)}</p>
<p><a id="pdf-link" href="/files/paper.pdf">Read the paper (PDF)</a> and <a id="web-link" href="https://example.com/next">the next story</a>.</p>
</article></body></html>`;
  routes.set('/article.html', { type: 'text/html; charset=utf-8', body: Buffer.from(article) });
  routes.set('/big.html', { type: 'text/html; charset=utf-8', body: Buffer.from(`<!DOCTYPE html><html><head><title>Huge page</title></head><body><p>${'x'.repeat(8 * 1024 * 1024 + 100)}</p></body></html>`) });
  if (pdf) {
    routes.set('/files/paper.pdf', { type: 'application/pdf', body: Buffer.from(pdf), headers: { 'Content-Disposition': 'inline; filename="Quiet Paper.pdf"' } });
    routes.set('/cors/paper.pdf', { type: 'application/pdf', body: Buffer.from(pdf), headers: { 'Access-Control-Allow-Origin': '*' } });
    routes.set('/download', { type: 'application/pdf', body: Buffer.from(pdf), headers: { 'Content-Disposition': "attachment; filename*=UTF-8''R%C3%A9sum%C3%A9%20final.pdf" } });
  }
  if (bigPdf) routes.set('/files/big.pdf', { type: 'application/pdf', body: Buffer.from(bigPdf) });
  routes.set('/files/fake.pdf', { type: 'text/html', body: Buffer.from('<!doctype html><title>Sign in</title><p>Please sign in') });

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push(`${req.method} ${u.pathname}`);
    const r = routes.get(u.pathname);
    if (!r) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    // chunked: no Content-Length (the body's size shows only while reading it).
    res.writeHead(200, { 'Content-Type': r.type, ...(r.chunked ? {} : { 'Content-Length': r.body.length }), ...(r.headers ?? {}) });
    if (req.method === 'HEAD') return res.end();
    if (r.chunked) { res.on('error', () => {}); res.write(r.body); return res.end(); }
    res.end(r.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, hits, routes, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}
