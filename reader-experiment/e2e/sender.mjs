// The end-to-end test's "phone": a Daylight Share sender driven from the command line, keeping its outbox in a JSON
// file between commands (E2E_STATE, default e2e-out/sender-state.json).
//   node sender.mjs pair <relay>            -> prints the 28-character pairing code (a fresh secret)
//   node sender.mjs send-page <tag>         -> sends an article page, prints the item id
//   node sender.mjs send-url <url>          -> sends a link, prints the item id
//   node sender.mjs send-pdf <tag>          -> sends a generated PDF, prints the item id
//   node sender.mjs wait-acks <n> <seconds> -> waits until n items are delivered (acked); exits 1 on timeout
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

async function sender() {
  const pairing = await ds.loadPairing(storage);
  if (!pairing) throw new Error('not paired: run pair first');
  return new ds.Sender({ pairing, storage, from: 'E2E phone', app: 'e2e/1' });
}

const article = (tag) => `<!doctype html><html><head><meta charset="utf-8"><title>Walden, sent from a phone (${tag})</title>
<meta name="author" content="Henry David Thoreau"></head><body><article><h1>Where I Lived, and What I Lived For (${tag})</h1>
${['I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.',
  'I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary.',
  'I wanted to live deep and suck out all the marrow of life, to live so sturdily and Spartan-like as to put to rout all that was not life, to cut a broad swath and shave close, to drive life into a corner, and reduce it to its lowest terms.',
  'Still we live meanly, like ants; though the fable tells us that we were long ago changed into men; like pygmies we fight with cranes; it is error upon error, and clout upon clout.',
  'Our life is frittered away by detail. An honest man has hardly need to count more than his ten fingers. Simplicity, simplicity, simplicity!'].map((p) => `<p>${p}</p>`).join('\n').repeat(3)}
</article></body></html>`;

if (cmd === 'pair') {
  const secret = ds.generateSecret();
  await ds.savePairing(storage, { secret, relay: a1, name: 'E2E Daylight' });
  console.log(await ds.formatCode(secret, { dashes: false }));
} else if (cmd === 'send-page') {
  const s = await sender();
  const row = await s.send({ kind: 'page', url: `https://example.com/walden-${a1}`, title: `Walden, sent from a phone (${a1})`, content: article(a1) });
  if (row.status !== 'sent') throw new Error(`send failed: ${row.error}`);
  console.log(row.id);
} else if (cmd === 'send-url') {
  const s = await sender();
  const row = await s.send({ kind: 'url', url: a1, title: 'A link sent from a phone' });
  if (row.status !== 'sent') throw new Error(`send failed: ${row.error}`);
  console.log(row.id);
} else if (cmd === 'send-pdf') {
  const s = await sender();
  const row = await s.send({ kind: 'file', name: `daylight-share-${a1}.pdf`, mime: 'application/pdf', title: `Test PDF (${a1})`,
    content: new Uint8Array(makePdf(`Test PDF (${a1})`, ['Sent from a test phone through the relay.', 'If you can read this in the Daylight Reader, the PDF path works.'])) });
  if (row.status !== 'sent') throw new Error(`send failed: ${row.error}`);
  console.log(row.id);
} else if (cmd === 'wait-acks') {
  const s = await sender();
  const want = Number(a1), deadline = Date.now() + Number(a2 || 120) * 1000;
  let rows = [];
  while (Date.now() < deadline) {
    await s.checkAcks();
    rows = await s.list();
    const delivered = rows.filter((r) => r.status === 'delivered').length;
    if (delivered >= want) { console.log(`delivered ${delivered}/${rows.length}`); process.exit(0); }
    await ds.sleep(3000);
  }
  console.error('acks timed out:', rows.map((r) => `${r.kind}:${r.status}`).join(' '));
  process.exit(1);
} else {
  console.error('usage: sender.mjs pair|send-page|send-url|send-pdf|wait-acks'); process.exit(2);
}
