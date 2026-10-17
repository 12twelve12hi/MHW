// A live round trip through the real relay (default https://ntfy.sh), run from CI where the network allows it.
// node js/live-ntfy.mjs [relay]   -> exits non-zero if anything the protocol relies on does not hold.
import * as ds from './daylight-share.js';

const relay = process.argv[2] || ds.DEFAULT_RELAY;
const secret = ds.generateSecret();
const pairing = { secret, relay, name: 'CI Daylight' };
const sender = new ds.Sender({ pairing, storage: new ds.MemoryStorage(), from: 'CI', app: 'ci/1' });
const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage(), from: 'CI Daylight' });
const keys = await sender.keys();
const log = (...a) => console.log('[live]', ...a);
const fail = (m) => { console.error('[live] FAIL:', m); process.exit(1); };

log('relay', relay, 'inbox topic', keys.inboxTopic);

// CORS, for the web sender page (extensions and native apps do not need it).
const pre = await fetch(`${relay}/${keys.inboxTopic}`, { method: 'OPTIONS', headers: {
  Origin: 'https://example.github.io', 'Access-Control-Request-Method': 'PUT',
  'Access-Control-Request-Headers': 'filename,message,firebase,cache,content-type' } });
log('CORS preflight', pre.status, 'allow-origin:', pre.headers.get('access-control-allow-origin'),
  'allow-headers:', pre.headers.get('access-control-allow-headers'), 'allow-methods:', pre.headers.get('access-control-allow-methods'));

const noise = ds.randomBytes(200000);
const rows = [];
rows.push(await sender.send({ kind: 'url', url: 'https://example.com/live-test', title: 'Live test link' }));
rows.push(await sender.send({ kind: 'page', url: 'https://example.com/live-page', title: 'Live page',
  content: `<html><body><p>${ds.toBase64(ds.randomBytes(30000))}</p></body></html>` }));
rows.push(await sender.send({ kind: 'file', name: 'live.pdf', mime: 'application/pdf', content: noise }));
for (const r of rows) log('sent', r.kind, r.status, r.attachment ? 'as attachment' : 'as message', r.error || '');
if (rows.some((r) => r.status !== 'sent')) fail('publish failed');

let got = [];
for (let i = 0; i < 5 && got.length < 3; i++) {
  await ds.sleep(1500);
  const res = await receiver.pollOnce();
  got = got.concat(res.items);
  log('poll', i, 'items', res.items.length, 'acked', res.acked.length);
}
if (got.length !== 3) fail(`received ${got.length} of 3 items`);
const file = got.find((g) => g.header.kind === 'file');
if (!file || ds.toHex(file.content) !== ds.toHex(noise)) fail('file content differs');

let delivered = 0;
for (let i = 0; i < 5 && delivered < 3; i++) { await ds.sleep(1500); delivered += await sender.checkAcks(); }
if (delivered !== 3) fail(`only ${delivered} of 3 acks seen`);

// The stream endpoint answers and stays open (live delivery).
const ctrl = new AbortController();
const s = await fetch(`${relay}/${keys.inboxTopic}/json?since=all`, { signal: ctrl.signal });
const reader = s.body.getReader();
const first = new TextDecoder().decode((await reader.read()).value ?? new Uint8Array());
ctrl.abort();
log('stream first line:', first.split('\n')[0].slice(0, 120));

log('OK: 3 items delivered and acknowledged through', relay);
process.exit(0);
