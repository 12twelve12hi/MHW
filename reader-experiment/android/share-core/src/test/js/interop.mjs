// Drives the JavaScript reference implementation for the Kotlin interop and skew tests (RelayTest, LabSkewTest).
//   node interop.mjs <daylight-share.js> send <relay> <code> <json item>   -> prints the outbox row
//        (the item's content: `content` (a string), `contentHex`, or `contentFile` (a path, for large files); with
//        `chunkSize`, the Sender cuts its parts that small; `extras` are the Lab header fields, LAB-PROTOCOL 2.3)
//   node interop.mjs <daylight-share.js> receive <relay> <code> [outDir]   -> prints {items: [{header, contentHex |
//        contentFile, size, extras}], acked, ackError, storeError}; with outDir, contents are written there instead of as hex
//   node interop.mjs <daylight-share.js> acks <relay> <code> <id>          -> prints {delivered: n, status}
// The library may be the current reference or one of its shipped versions (share/js/test/fixtures), so old peers run
// as they did in the field. The Lab commands use the current reference and daylight-lab.js next to it:
//   node interop.mjs <daylight-share.js> receive-lab <relay> <code> [json opts]   a Lab Daylight (LabInboxSim): polls,
//        records each new item's state (opts.state, else reader for url and page, handed for file) and flushes; opts:
//        {app, caps, from, state} -> prints {items: [{id, kind, extras}], acked, ackError, lab: the flush's result}
//   node interop.mjs <daylight-share.js> lab-off <relay> <code> [json opts]   that Daylight turns Lab off: its lab: 0
//        frame -> prints the flush's result
//   node interop.mjs <daylight-share.js> acks-lab <relay> <code> <json {id, kind}>   a Lab sender with its ledger reads
//        the acks -> prints {delivered, status, inboxLab, caps, state, publishers, row: describeLabRow(…)}
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , lib, cmd, relay, code, arg] = process.argv;
const ds = await import(pathToFileURL(lib).href);
const pairing = { secret: await ds.parseCode(code), relay, name: '' };
const storage = new ds.MemoryStorage();
const labLib = async () => import(pathToFileURL(join(dirname(lib), 'daylight-lab.js')).href);

async function labDaylight(opts = {}) {
  const lab = await labLib();
  const app = opts.app ?? 'android/1.5.0';
  const from = opts.from ?? 'JS Daylight';
  const receiver = new ds.Receiver({ pairing, storage, from, retryDelaysMs: [0, 0, 0] });
  const keys = await ds.deriveKeys(pairing.secret);
  const rc = new ds.RelayClient({ relay, retryDelaysMs: [0, 0, 0] });
  const labInbox = new lab.LabInbox({ storage, relay: rc, keys, info: { lab: 1, app, caps: opts.caps ?? ['st', 'tap', 'reader-link'], live: false }, from, autoFlushMs: null });
  const sim = new lab.LabInboxSim({ receiver, labInbox, stateFor: opts.state ?? null });
  return { lab, labInbox, sim };
}

if (cmd === 'send') {
  const item = JSON.parse(arg);
  if (item.contentHex) { item.content = ds.fromHex(item.contentHex); delete item.contentHex; }
  if (item.contentFile) { item.content = new Uint8Array(readFileSync(item.contentFile)); delete item.contentFile; }
  const chunkSize = item.chunkSize;
  delete item.chunkSize;
  const sender = new ds.Sender({ pairing, storage, from: 'node', app: 'node/test', ...(chunkSize ? { chunkSize } : {}) });
  const row = await sender.send(item);
  console.log(JSON.stringify(row));
} else if (cmd === 'receive') {
  const r = new ds.Receiver({ pairing, storage, from: 'JS Daylight' });
  const { items, acked, ackError, storeError } = await r.pollOnce();
  const out = items.map((i) => {
    if (!arg) return { header: i.header, contentHex: ds.toHex(i.content), size: i.content.length, extras: i.extras ?? null };
    const f = join(arg, i.header.id + '.bin');
    writeFileSync(f, i.content);
    return { header: i.header, contentFile: f, size: i.content.length, extras: i.extras ?? null };
  });
  console.log(JSON.stringify({ items: out, acked, ackError, storeError }));
} else if (cmd === 'acks') {
  const sender = new ds.Sender({ pairing, storage });
  await storage.set('outbox', [{ id: arg, kind: 'url', status: 'sent', created: Date.now(), lastPublish: Date.now(), attempts: 1 }]);
  const n = await sender.checkAcks();
  console.log(JSON.stringify({ delivered: n, status: (await sender.list())[0].status }));
} else if (cmd === 'receive-lab') {
  const { sim } = await labDaylight(arg ? JSON.parse(arg) : {});
  const res = await sim.pollOnce();
  console.log(JSON.stringify({
    items: res.items.map((i) => ({ id: i.header.id, kind: i.header.kind, extras: i.extras ?? null })),
    acked: res.acked, ackError: res.ackError ?? null, lab: { ...res.lab, error: res.lab.error ? String(res.lab.error) : undefined },
  }));
} else if (cmd === 'lab-off') {
  const { labInbox } = await labDaylight(arg ? JSON.parse(arg) : {});
  const r = await labInbox.labTurnedOff();
  console.log(JSON.stringify({ ...r, error: r.error ? String(r.error) : undefined }));
} else if (cmd === 'acks-lab') {
  const lab = await labLib();
  const { id, kind } = JSON.parse(arg);
  const ledger = new lab.LabLedger({ storage });
  const sender = new ds.Sender({ pairing, storage, onAckHeader: lab.labHook(ledger) });
  await storage.set('outbox', [{ id, kind, status: 'sent', errorCode: '', created: Date.now(), lastPublish: Date.now(), attempts: 1, size: 0 }]);
  const n = await sender.checkAcks();
  const row = (await sender.list())[0];
  const snap = await ledger.snapshot();
  const state = snap.states[id] ?? null;
  console.log(JSON.stringify({
    delivered: n, status: row.status, inboxLab: snap.inboxLab, caps: snap.caps, state,
    publishers: snap.publishers.map((p) => ({ publisher: p.publisher, lab: p.lab, app: p.app })),
    row: lab.describeLabRow(row, Date.now(), { lab: true, inboxLab: snap.inboxLab, hasCap: snap.hasCap, state, online: true }),
  }));
} else {
  throw new Error('unknown command ' + cmd);
}
