// The end-to-end test's "phone": a Daylight Share sender (protocol revision 1.1 with Lab Wave 0, the JS reference)
// driven from the command line, keeping its outbox and its Lab ledger in a JSON file between commands (E2E_STATE,
// default e2e-out/sender-state.json).
//   node sender.mjs pair <relay>              -> prints the 28-character pairing code (a fresh secret)
//   node sender.mjs send-page <tag>           -> sends an article page, prints the item id
//   node sender.mjs send-url <url>            -> sends a link, prints the item id
//   node sender.mjs send-pdf <tag> [bytes]    -> sends a generated PDF (about <bytes> long), prints the item id
//   node sender.mjs check-too-large <bytes>   -> a PDF over 9 MB must be refused before anything is queued or sent;
//                                                prints the sentence (CHANGES-v1.1 2.2, 2.5)
//   node sender.mjs status                    -> one line per outbox row: id, kind, size, then the words the phone
//                                                shows (the Lab timeline's, LAB-PLAN 2.5, with its step line)
//   node sender.mjs wait-acks <n> <seconds>   -> waits until n items are delivered (acked); exits 1 on timeout
//   node sender.mjs lab-states [<id>...]      -> reads the ack topic once and prints what the phone's Lab ledger knows
//                                                (LAB-PROTOCOL 2.2.6): What's in Lab's header line, each Inbox's
//                                                latest hello, and per id (default: every outbox row) its state and
//                                                the row as the Lab timeline shows it
//   node sender.mjs wait-lab <seconds> <want>...  -> reads the ack topic every 3 s until every <want> holds, then
//                                                prints as lab-states; exits 1 on timeout with what is missing:
//        lab=<n>                    the Daylight Share Inbox's latest hello (publisher "android", fresh) has Lab level n
//        caps=<token>[,<token>...]  ... and carries these caps
//        <id>=<state>[|<state>...]  the item's state is one of these (waiting, held, inbox, handed, failed, queued,
//                                   reader; "none": no state)
// Every Sender reads the ack topic through the Lab ledger (Sender onAckHeader = labHook), so no command loses a Lab
// frame: the ack cursor moves past what it read.
// E2E_PEER=v1.0 or v1.1 makes an old phone instead: the Sender as it shipped, from the skew suite's fixtures
// (share/js/test/fixtures/daylight-share-<v>.js, LAB-PROTOCOL 2.8), not today's module. It has no ledger and no Lab
// commands, is named "E2E <v> phone", and shows its own words: v1.1's describeRow; v1.0 had no shared words, so a v1.0
// row shows its status alone. A second and third phone on the same pairing, to show a Lab Inbox changes nothing for
// apps in the field (F17.1). It sends pages, links and PDFs (check-too-large needs v1.1: v1.0 had no 9 MB limit).
// Every publish is logged on stderr as `publish <POST|PUT> <bytes> -> <status>`, so a test can see how an item was
// split into frames (a 5 MB file goes as 3 attachments of at most 1,966,116 bytes).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as lab from '../share/js/daylight-lab.js';
import { makePdf } from './make-pdf.mjs';

const STATE = process.env.E2E_STATE || 'e2e-out/sender-state.json';
const PEERS = ['v1.0', 'v1.1'];
const PEER = process.env.E2E_PEER || '';
if (PEER && !PEERS.includes(PEER)) {
  console.error(`E2E_PEER must be ${PEERS.join(' or ')} (an old phone) or unset (the Lab phone), not "${PEER}"`);
  process.exit(2);
}
const ds = await import(PEER ? `../share/js/test/fixtures/daylight-share-${PEER}.js` : '../share/js/daylight-share.js');

class FileStorage {
  constructor(path) { this.path = path; this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}; }
  save() { mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(this.path, JSON.stringify(this.data)); }
  async get(k) { return this.data[k]; }
  async set(k, v) { this.data[k] = v; this.save(); }
  async remove(k) { delete this.data[k]; this.save(); }
}

const storage = new FileStorage(STATE);
const ledger = PEER ? null : new lab.LabLedger({ storage });
const [cmd, a1, a2, ...rest] = process.argv.slice(2);

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
  if (PEER) return new ds.Sender({ pairing, storage, from: `E2E ${PEER} phone`, app: 'e2e/1', fetch: loggingFetch });
  return new ds.Sender({ pairing, storage, from: 'E2E phone', app: 'e2e/1', fetch: loggingFetch, onAckHeader: lab.labHook(ledger) });
}

// v1.1's words (describeRow), as every sender showed them before Lab; null for a v1.0 phone, which had no shared words.
const words = (row) => {
  if (typeof ds.describeRow !== 'function') return null;
  const d = ds.describeRow(row);
  return d.sentence ? `${d.label}. ${d.sentence}` : d.label;
};
// ": <words>", or nothing for a v1.0 row.
const said = (row) => { const w = words(row); return w === null ? '' : `: ${w}`; };

// The Lab timeline's words for a row (LAB-PLAN 2.5; Lab on in this phone): "{label}. {sentence}" and the step line.
function labWords(row, snap, now = Date.now()) {
  const d = lab.describeLabRow(row, now, { lab: true, inboxLab: snap.inboxLab, hasCap: snap.hasCap, state: snap.states[row.id] ?? null });
  return `${lab.labRowA11yLabel(d)}${d.stepLine ? ` [${d.stepLine}]` : ''}`;
}

// A send that did not reach the relay fails the step, with the words a user would see and the technical detail.
function sent(row) {
  if (row.status !== 'sent') throw new Error(`send failed: ${row.status}/${row.errorCode ?? ''} (${row.error})${said(row)}`);
  console.log(row.id);
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : '-');

// The Daylight Share Inbox's latest hello, while fresh (36 h): the "android" publisher (LAB-PROTOCOL 2.2.6).
const android = (snap, now = Date.now()) => snap.publishers.find((p) => p.publisher === 'android' && now - p.at <= lab.INBOX_STALE_MS) ?? null;

// What the ledger knows, as lines: the header line, the publishers' hellos, then each id's state and row.
async function labReport(s, ids) {
  const now = Date.now();
  const snap = await ledger.snapshot();
  const rows = new Map((await s.list()).map((r) => [r.id, r]));
  const out = [`daylight: ${lab.inboxLabText(snap, now)}`];
  if (!snap.publishers.length) out.push('hello: none yet');
  for (const p of snap.publishers) {
    out.push(`hello: ${p.publisher} lab=${p.lab} app=${p.app || '-'} caps=${p.caps.join(',') || '-'} live=${p.live} `
      + `poll=${iso(p.poll)} at=${iso(p.at)}${now - p.at > lab.INBOX_STALE_MS ? ' (stale)' : ''}`);
  }
  for (const id of ids.length ? ids : [...rows.keys()]) {
    const st = snap.states[id] ?? null;
    const row = rows.get(id);
    out.push(`${id} ${row?.kind ?? '-'} ${st ? st.s : 'none'}${row ? `: ${labWords(row, snap, now)}` : ''}`);
  }
  return { snap, lines: out };
}

// A wait-lab <want>: {text, id?, ok(snap)}.
function parseWant(w) {
  let m;
  if ((m = /^lab=(\d+)$/.exec(w))) return { text: w, ok: (snap) => android(snap)?.lab === Number(m[1]) };
  if ((m = /^caps=([a-z0-9-]{1,16}(?:,[a-z0-9-]{1,16})*)$/.exec(w))) {
    const caps = m[1].split(',');
    return { text: w, ok: (snap) => { const p = android(snap); return !!p && caps.every((c) => p.caps.includes(c)); } };
  }
  if ((m = /^([0-9a-f]{32})=([a-z]+(?:\|[a-z]+)*)$/.exec(w))) {
    const id = m[1], states = m[2].split('|');
    const bad = states.filter((x) => x !== 'none' && !lab.LAB_STATES.includes(x));
    if (bad.length) throw new Error(`unknown state ${bad.join(', ')} in "${w}"`);
    return { text: w, id, ok: (snap) => states.includes(snap.states[id]?.s ?? 'none') };
  }
  throw new Error(`cannot read "${w}": want lab=<n>, caps=<a,b> or <id>=<state>[|<state>]`);
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

function needLedger() {
  if (ledger) return;
  console.error(`${cmd}: an old phone (E2E_PEER=${PEER}) has no Lab ledger`);
  process.exit(2);
}

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
  if (typeof ds.tooBigMessage !== 'function') { console.error('check-too-large: a v1.0 phone had no 9 MB limit'); process.exit(2); }
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
  const snap = ledger ? await ledger.snapshot() : null;
  for (const r of await s.list()) {
    console.log(`${r.id} ${r.kind} ${r.size} ${r.status}${r.errorCode ? '/' + r.errorCode : ''}${snap ? `: ${labWords(r, snap)}` : said(r)}`);
  }
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
  for (const r of rows) console.error(`  ${r.id} ${r.kind} ${r.status}${said(r)}`);
  process.exit(1);
} else if (cmd === 'lab-states') {
  needLedger();
  const s = await sender();
  try { await s.checkAcks(); } catch (e) { console.error(`ack poll: ${e.message}`); }
  for (const l of (await labReport(s, [a1, a2, ...rest].filter(Boolean))).lines) console.log(l);
} else if (cmd === 'wait-lab') {
  needLedger();
  let wants;
  try { wants = [a2, ...rest].filter(Boolean).map(parseWant); } catch (e) { console.error(`wait-lab: ${e.message}`); process.exit(2); }
  if (!(Number(a1) > 0) || !wants.length) { console.error('usage: sender.mjs wait-lab <seconds> <want>...'); process.exit(2); }
  const ids = [...new Set(wants.filter((w) => w.id).map((w) => w.id))];
  const s = await sender();
  const t0 = Date.now(), deadline = t0 + Number(a1) * 1000;
  let report;
  for (;;) {
    try { await s.checkAcks(); } catch (e) { console.error(`ack poll: ${e.message}`); }
    report = await labReport(s, ids);
    const missing = wants.filter((w) => !w.ok(report.snap));
    if (!missing.length) {
      for (const l of report.lines) console.log(l);
      console.log(`lab: ${wants.map((w) => w.text).join(' ')} after ${Math.round((Date.now() - t0) / 1000)} s`);
      process.exit(0);
    }
    if (Date.now() >= deadline) {
      for (const l of report.lines) console.error(l);
      console.error(`lab: still missing after ${a1} s: ${missing.map((w) => w.text).join(' ')}`);
      process.exit(1);
    }
    await ds.sleep(3000);
  }
} else {
  console.error('usage: sender.mjs pair|send-page|send-url|send-pdf|check-too-large|status|wait-acks|lab-states|wait-lab');
  process.exit(2);
}
