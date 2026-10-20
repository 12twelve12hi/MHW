// Large files in the Worker (DESIGN.md 6, 10.6): parts in any order, resume, n mismatch, idempotent re-upload, the
// storage cap, expiry, unauthenticated download, delete, and the needs-r2 state without R2.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, SERVER } from './helpers.mjs';

let t;
before(async () => { t = await setup({ knobs: { fileStorage: 3_000_000 } }); });
after(async () => { await t?.close(); });

const bin = { 'Content-Type': 'application/octet-stream' };
const part = (n, seed) => new Uint8Array(n).map((_, i) => (i * 31 + seed) & 0xff);
const put = (id, i, n, body) => t.api('PUT', `/v1/files/${id}/${i}?n=${n}`, { body, headers: bin });

test('parts upload in any order, the listing resumes, re-uploads are idempotent, downloads stream the bytes', async () => {
  const id = '1'.repeat(32);
  const parts = [part(300_000, 1), part(300_000, 2), part(123_456, 3)];
  assert.equal((await put(id, 2, 3, parts[2])).status, 204);
  assert.equal((await put(id, 0, 3, parts[0])).status, 204);
  let info = await t.api('GET', `/v1/files/${id}`);
  assert.deepEqual({ n: info.json.n, stored: info.json.stored, bytes: info.json.bytes }, { n: 3, stored: [0, 2], bytes: 423_456 });
  assert.ok(Date.parse(info.json.expires) > Date.now() + 13 * 86400_000);
  assert.equal((await put(id, 1, 3, parts[1])).status, 204);
  assert.equal((await put(id, 1, 3, parts[1])).status, 204, 'idempotent');
  info = await t.api('GET', `/v1/files/${id}`);
  assert.deepEqual(info.json.stored, [0, 1, 2]);
  assert.equal(info.json.bytes, 723_456, 'a repeated part is not counted twice');
  for (let i = 0; i < 3; i++) {
    const r = await t.dispatch(`${SERVER}/f/${id}/${i}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/octet-stream');
    assert.equal(r.headers.get('content-length'), String(parts[i].length));
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), parts[i]);
  }
  assert.equal((await t.dispatch(`${SERVER}/f/${id}/7`)).status, 404);
});

test('bad requests: n differing from earlier parts, an index out of range, a wrong type, an empty or oversized body', async () => {
  const id = '2'.repeat(32);
  assert.equal((await put(id, 0, 2, part(100, 1))).status, 204);
  const mismatch = await put(id, 1, 3, part(100, 2));
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.json.error.message, /n differs/);
  assert.equal((await put(id, 2, 2, part(10, 1))).status, 400);
  assert.equal((await put(id, 0, 17, part(10, 1))).status, 400);
  assert.equal((await t.api('PUT', `/v1/files/${id}/0?n=2`, { body: part(100, 1), headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await t.api('PUT', `/v1/files/${id}/0?n=2`, { body: new Uint8Array(0), headers: bin })).status, 400);
  const tooBig = await t.raw('PUT', `/v1/files/${id}/1?n=2`, { headers: bin, length: 12_713_985 });
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.json.error.limit, 12_713_984);
  assert.ok(tooBig.written < 12_713_985, 'answered before the body was read');
});

test('the storage cap answers 507 STORAGE_FULL', async () => {
  const id = '3'.repeat(32);
  const r = await put(id, 0, 1, part(2_500_000, 9));
  assert.equal(r.status, 507);
  assert.equal(r.json.error.code, 'STORAGE_FULL');
  assert.match(r.json.error.message, /storage is full/);
});

test('expiry: 410 GONE after 14 days for the listing, uploads and downloads', async () => {
  const id = '4'.repeat(32);
  assert.equal((await put(id, 0, 1, part(500, 4))).status, 204);
  const later = Date.now() + 15 * 86400_000;
  assert.equal((await t.api('GET', `/v1/files/${id}`, { now: later })).status, 410);
  assert.equal((await t.api('PUT', `/v1/files/${id}/0?n=1`, { body: part(500, 4), headers: bin, now: later })).json.error.code, 'GONE');
  const dl = await t.dispatch(`${SERVER}/f/${id}/0`, { headers: { 'X-DLS-Test-Now': String(later) } });
  assert.equal(dl.status, 410);
});

test('DELETE removes the parts at once and answers 204 also when already gone', async () => {
  const id = '5'.repeat(32);
  assert.equal((await put(id, 0, 1, part(500, 5))).status, 204);
  assert.equal((await t.api('DELETE', `/v1/files/${id}`)).status, 204);
  assert.equal((await t.api('GET', `/v1/files/${id}`)).status, 404);
  assert.equal((await t.dispatch(`${SERVER}/f/${id}/0`)).status, 404);
  assert.equal((await t.api('DELETE', `/v1/files/${id}`)).status, 204);
  assert.equal((await t.api('DELETE', `/v1/files/nothex`)).status, 404);
});

test('without R2: files and PDFs answer needs-r2, uploads 409 NOT_CONFIGURED', async () => {
  const no = await setup({ r2: false });
  try {
    const s = (await no.api('GET', '/v1/status')).json;
    assert.equal(s.features.files.state, 'needs-r2');
    assert.equal(s.features.pdf.state, 'needs-r2');
    assert.match(s.features.files.message, /Turn on R2/);
    assert.equal(s.features.email.state, 'needs-r2');
    const r = await no.api('PUT', `/v1/files/${'6'.repeat(32)}/0?n=1`, { body: part(10, 1), headers: bin });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'NOT_CONFIGURED');
    assert.deepEqual(r.json.error.missing, ['R2']);
    assert.equal((await no.dispatch(`${SERVER}/f/${'6'.repeat(32)}/0`)).status, 404);
  } finally { await no.close(); }
});
