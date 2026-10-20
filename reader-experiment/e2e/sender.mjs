// The end-to-end test's "phone": a Daylight Share sender (protocol revision 1.1, the JS reference) driven from the
// command line, keeping its outbox in a JSON file between commands (E2E_STATE, default e2e-out/sender-state.json).
//   node sender.mjs pair <relay>              -> prints the 28-character pairing code (a fresh secret)
//   node sender.mjs send-page <tag>           -> sends an article page, prints the item id
//   node sender.mjs send-url <url>            -> sends a link, prints the item id
//   node sender.mjs send-pdf <tag> [bytes]    -> sends a generated PDF (about <bytes> long), prints the item id
//   node sender.mjs check-too-large <bytes>   -> a PDF over 9 MB must be refused before anything is queued or sent;
//                                                prints the sentence (CHANGES-v1.1 2.2, 2.5)
//   node sender.mjs status                    -> one line per outbox row: id, kind, size, then the shared status words
//   node sender.mjs wait-acks <n> <seconds>   -> waits until n items are delivered (acked); exits 1 on timeout
// Every publish is logged on stderr as `publish <POST|PUT> <bytes> -> <status>`, so a test can see how an item was
// split into frames (a 5 MB file goes as 3 attachments of at most 1,966,116 bytes).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as ds from '../share/js/daylight-share.js';
import { makePdf } from './make-pdf.mjs';

const STATE = process.env.E2E_STATE || 'e2e-out/sender-state.json';

class FileStorage {
  constructor(path) { this.path = path; this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}; }
  save() { mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(this.path, JSON.stringify(this.data)); }
  async get(k) { return this.data[k]; }
  async set(k, v) { this.data[k] = v; this.save(); }
  async remove(k) { delete this.data[k]; this.save(); }
}

const storage = new FileStorage(STATE);
const [cmd, a1, a2] = process.argv.slice(2);

// Logs each publish (method, body bytes, answer) on stderr; polls and downloads pass through quietly.
async function loggingFetch(url, init = {}) {
  const res = await fetch(url, init);
  if (init.method === 'PUT' || init.method === 'POST') {
    const n = typeof init.body === 'string' ? Buffer.byteLength(init.body) : init.body?.byteLength ?? 0;
    console.error(`publish ${init.method} ${n} -> ${res.status}`);
  }
  return res;
}

async function sender() {
  const pairing = await ds.loadPairing(storage);
  if (!pairing) throw new Error('not paired: run pair first');
  return new ds.Sender({ pairing, storage, from: 'E2E phone', app: 'e2e/1', fetch: loggingFetch });
}

const words = (row) => { const d = ds.describeRow(row); return d.sentence ? `${d.label}. ${d.sentence}` : d.label; };

// A send that did not reach the relay fails the step, with the words a user would see and the technical detail.
function sent(row) {
  if (row.status !== 'sent') throw new Error(`send failed: ${row.status}/${row.errorCode} (${row.error}): ${words(row)}`);
  console.log(row.id);
}

const article = (tag) => `<!doctype html><html><head><meta charset="utf-8"><title>Walden, sent from a phone (${tag})</title>
<meta name="author" content="Henry David Thoreau"></head><body><article><h1>Where I Lived, and What I Lived For (${tag})</h1>
${['I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.',
  'I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary.',
  'I wanted to live deep and suck out all the marrow of life, to live so sturdily and Spartan-like as to put to rout all that was not life, to cut a broad swath and shave close, to drive life into a corner, and reduce it to its lowest terms.',
  'Still we live meanly, like ants; though the fable tells us that we were long ago changed into men; like pygmies we fight with cranes; it is error upon error, and clout upon clout.',
  'Our life is frittered away by detail. An honest man has hardly need to count more than his ten fingers. Simplicity, simplicity, simplicity!'].map((p) => `<p>${p}</p>`).join('\n').repeat(3)}
</article></body></html>`;

const pdf = (tag, bytes = 0) => ({
  kind: 'file', name: `daylight-share-${tag}.pdf`, mime: 'application/pdf', title: `Test PDF (${tag})`,
  content: new Uint8Array(makePdf(`Test PDF (${tag})`, ['Sent from a test phone through the relay.',
    'If you can read this in the Daylight Reader, the PDF path works.'], { bytes })),
});

if (cmd === 'pair') {
  const secret = ds.generateSecret();
  await ds.savePairing(storage, { secret, relay: a1, name: 'E2E Daylight' });
  console.log(await ds.formatCode(secret, { dashes: false }));
} else if (cmd === 'send-page') {
  const s = await sender();
  sent(await s.send({ kind: 'page', url: `https://example.com/walden-${a1}`, title: `Walden, sent from a phone (${a1})`, content: article(a1) }));
} else if (cmd === 'send-url') {
  const s = await sender();
  sent(await s.send({ kind: 'url', url: a1, title: 'A link sent from a phone' }));
} else if (cmd === 'send-pdf') {
  const s = await sender();
  const item = pdf(a1, Number(a2 || 0));
  console.error(`pdf ${item.name}: ${item.content.length} bytes`);
  sent(await s.send(item));
} else if (cmd === 'check-too-large') {
  const s = await sender();
  const before = (await s.list()).length;
  const item = pdf('too-large', Number(a1));
  let error = null;
  try { await s.send(item); } catch (e) { error = e; }
  const after = (await s.list()).length;
  const want = ds.tooBigMessage(item.content.length);
  if (!error || error.code !== 'too-large' || error.message !== want || after !== before) {
    console.error(`expected a too-large refusal ("${want}") with nothing queued; got ${error ? `${error.code}: ${error.message}` : 'a send'}, rows ${before} -> ${after}`);
    process.exit(1);
  }
  console.log(`${item.content.length} bytes refused before sending: ${error.message}`);
} else if (cmd === 'status') {
  const s = await sender();
  for (const r of await s.list()) console.log(`${r.id} ${r.kind} ${r.size} ${r.status}${r.errorCode ? '/' + r.errorCode : ''}: ${words(r)}`);
} else if (cmd === 'wait-acks') {
  const s = await sender();
  const want = Number(a1), deadline = Date.now() + Number(a2 || 120) * 1000;
  let rows = [];
  while (Date.now() < deadline) {
    try { await s.checkAcks(); } catch (e) { console.error(`ack poll: ${e.message}`); }
    rows = await s.list();
    const delivered = rows.filter((r) => r.status === 'delivered').length;
    if (delivered >= want) { console.log(`delivered ${delivered}/${rows.length}`); process.exit(0); }
    await ds.sleep(3000);
  }
  console.error(`acks timed out (want ${want}):`);
  for (const r of rows) console.error(`  ${r.id} ${r.kind} ${r.status}: ${words(r)}`);
  process.exit(1);
} else {
  console.error('usage: sender.mjs pair|send-page|send-url|send-pdf|check-too-large|status|wait-acks'); process.exit(2);
}
