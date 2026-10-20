// A live round trip through the real relay (default https://ntfy.sh), run from CI where the network allows it.
// node js/live-ntfy.mjs [relay]   -> exits non-zero if anything the protocol relies on does not hold:
//   - a 5,000,000-byte file goes in 3 parts, every frame under ntfy.sh's 2 MiB attachment limit, and arrives byte for
//     byte, with a link, a page and a small file;
//   - acks come back;
//   - an over-limit PUT (2,100,000 bytes) reaches fetch as a 413 (not a reset);
//   - ntfy.sh still reports at least 2,000,000 bytes per attachment and 20,000,000 per visitor (a canary: no client
//     reads /v1/account);
//   - the stream endpoint answers (live delivery) and CORS lets the web sender publish.
import * as ds from './daylight-share.js';

const relay = process.argv[2] || ds.DEFAULT_RELAY;
const LARGEST_FRAME = ds.CHUNK + ds.MAX_HEADER + 36; // 1,966,116
const NTFY_ATTACHMENT_LIMIT = 2097152; // measured: 2 MiB accepted, one byte more refused (NTFY-FACTS.md)
const log = (...a) => console.log('[live]', ...a);
const fail = (m) => { console.error('[live] FAIL:', m); process.exit(1); };
setTimeout(() => fail('timed out after 10 minutes'), 600000).unref();

// Every publish request the sender makes, in-call retries included: its body size, and its status once answered
// (0 while unanswered or when the request failed without an answer).
const frames = [];
const recording = async (url, init) => {
  const f = { method: init?.method ?? 'GET', bytes: init?.body?.length ?? 0, status: 0 };
  if (f.method === 'PUT' || f.method === 'POST') frames.push(f);
  const res = await fetch(url, init);
  f.status = res.status;
  return res;
};
const secret = ds.generateSecret();
const pairing = { secret, relay, name: 'CI Daylight' };
const sender = new ds.Sender({ pairing, storage: new ds.MemoryStorage(), from: 'CI', app: 'ci/1', fetch: recording });
const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage(), from: 'CI Daylight' });
const keys = await sender.keys();

log('relay', relay, 'inbox topic', keys.inboxTopic);

// CORS, for the web sender page (extensions and native apps do not need it).
const pre = await fetch(`${relay}/${keys.inboxTopic}`, { method: 'OPTIONS', headers: {
  Origin: 'https://example.github.io', 'Access-Control-Request-Method': 'PUT',
  'Access-Control-Request-Headers': 'filename,message,firebase,cache,content-type' } });
log('CORS preflight', pre.status, 'allow-origin:', pre.headers.get('access-control-allow-origin'),
  'allow-headers:', pre.headers.get('access-control-allow-headers'), 'allow-methods:', pre.headers.get('access-control-allow-methods'));
if (pre.status >= 400 || pre.headers.get('access-control-allow-origin') !== '*') fail('CORS preflight refused');

// Canary: the limits v1.1's sizes depend on (CHANGES-v1.1 2.3).
if (ds.normalizeRelay(relay) === ds.DEFAULT_RELAY) {
  const res = await fetch(`${relay}/v1/account`);
  const text = await res.text();
  let limits = null;
  try { limits = JSON.parse(text).limits; } catch { /* reported below */ }
  log('/v1/account', res.status, 'attachment_file_size', limits?.attachment_file_size, 'attachment_total_size', limits?.attachment_total_size);
  if (!limits) fail(`/v1/account answered ${res.status} without limits: ${text.slice(0, 300)}`);
  if (!(limits.attachment_file_size >= 2000000)) fail(`ntfy.sh now takes attachments of at most ${limits.attachment_file_size} bytes (v1.1 needs 2,000,000)`);
  if (!(limits.attachment_total_size >= 20000000)) fail(`ntfy.sh now keeps at most ${limits.attachment_total_size} attachment bytes per visitor (v1.1 needs 20,000,000)`);
}

// An over-limit PUT must reach fetch as 413, so senders classify it as "full", not as a network error.
{
  const topic = 'dls-' + ds.toHex(ds.randomBytes(16));
  let res;
  try {
    res = await fetch(`${relay}/${topic}`, { method: 'PUT', headers: { Filename: 'probe.bin', Firebase: 'no' }, body: ds.randomBytes(2100000) });
  } catch (e) {
    fail(`a 2,100,000-byte PUT did not come back as an answer: ${e?.cause?.code ?? ''} ${e.message}`);
  }
  const body = await res.text();
  log('2,100,000-byte PUT:', res.status, body.trim().slice(0, 120));
  if (res.status === 200) log('NOTE: ntfy.sh accepted 2,100,000 bytes: it has raised its attachment limit');
  else if (res.status !== 413) fail(`a 2,100,000-byte PUT got ${res.status}, not 413`);
  else if (!/41301/.test(body)) fail('the 413 is not ntfy’s 41301');
}

const big = ds.randomBytes(5000000);
const noise = ds.randomBytes(200000);
const rows = [];
rows.push(await sender.send({ kind: 'url', url: 'https://example.com/live-test', title: 'Live test link' }));
rows.push(await sender.send({ kind: 'page', url: 'https://example.com/live-page', title: 'Live page',
  content: `<html><body><p>${ds.toBase64(ds.randomBytes(30000))}</p></body></html>` }));
rows.push(await sender.send({ kind: 'file', name: 'live.pdf', mime: 'application/pdf', content: noise }));
rows.push(await sender.send({ kind: 'file', name: 'live-5mb.pdf', mime: 'application/pdf', content: big }));
for (const r of rows) log('sent', r.kind, r.name || r.url, r.status, r.attachment ? 'as attachment' : 'as message', r.error || '');
if (rows.some((r) => r.status !== 'sent')) fail('publish failed: ' + rows.map((r) => `${r.status}/${r.errorCode} ${r.error}`).join('; '));

log('publish requests:', frames.map((f) => `${f.method} ${f.bytes} → ${f.status || 'no answer'}`).join(', '));
// Only the 5 MB file has frames over 1 MB. Count the accepted ones, so an in-call retry after a blip does not count twice.
const bigFrames = frames.filter((f) => f.method === 'PUT' && f.bytes > 1000000 && f.status >= 200 && f.status < 300);
if (bigFrames.length !== 3) fail(`the 5 MB file went in ${bigFrames.length} accepted large frames, not 3`);
for (const f of frames) { // every request, accepted or not
  if (f.bytes > LARGEST_FRAME) fail(`a frame of ${f.bytes} bytes is over ${LARGEST_FRAME}`);
  if (f.bytes >= NTFY_ATTACHMENT_LIMIT) fail(`a frame of ${f.bytes} bytes is not under ntfy.sh's 2 MiB`);
}
log(`every frame is at most ${Math.max(...frames.map((f) => f.bytes))} bytes (limit ${NTFY_ATTACHMENT_LIMIT})`);

let got = [];
for (let i = 0; i < 6 && got.length < 4; i++) {
  await ds.sleep(1500);
  const res = await receiver.pollOnce();
  got = got.concat(res.items);
  log('poll', i, 'items', res.items.length, 'acked', res.acked.length, res.ackError ? `ack error: ${res.ackError}` : '');
  if (res.ackError) fail('ack publish failed: ' + res.ackError);
}
if (got.length !== 4) fail(`received ${got.length} of 4 items`);
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const small = got.find((g) => g.header.name === 'live.pdf');
if (!small || !same(small.content, noise)) fail('file content differs');
const large = got.find((g) => g.header.name === 'live-5mb.pdf');
if (!large || !same(large.content, big)) fail('the 5 MB file differs');

let delivered = 0;
for (let i = 0; i < 6 && delivered < 4; i++) { await ds.sleep(1500); delivered += await sender.checkAcks(); }
if (delivered !== 4) fail(`only ${delivered} of 4 acks seen`);

// The stream endpoint answers and stays open (live delivery).
const ctrl = new AbortController();
const s = await fetch(`${relay}/${keys.inboxTopic}/json?since=all`, { signal: ctrl.signal });
const reader = s.body.getReader();
const first = new TextDecoder().decode((await reader.read()).value ?? new Uint8Array());
ctrl.abort();
log('stream first line:', first.split('\n')[0].slice(0, 120));

log('OK: 4 items (one of 5 MB in 3 frames) delivered and acknowledged through', relay);
process.exit(0);
