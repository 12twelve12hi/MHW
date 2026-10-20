// Drives the JavaScript reference implementation for the Kotlin interop tests (RelayTest).
//   node interop.mjs <daylight-share.js> send <relay> <code> <json item>   -> prints the outbox row
//        (the item's content: `content` (a string), `contentHex`, or `contentFile` (a path, for large files))
//   node interop.mjs <daylight-share.js> receive <relay> <code> [outDir]   -> prints {items: [{header, contentHex |
//        contentFile, size}], acked, ackError, storeError}; with outDir, contents are written there instead of as hex
//   node interop.mjs <daylight-share.js> acks <relay> <code> <id>          -> prints {delivered: n, status}
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , lib, cmd, relay, code, arg] = process.argv;
const ds = await import(pathToFileURL(lib).href);
const pairing = { secret: await ds.parseCode(code), relay, name: '' };
const storage = new ds.MemoryStorage();

if (cmd === 'send') {
  const item = JSON.parse(arg);
  if (item.contentHex) { item.content = ds.fromHex(item.contentHex); delete item.contentHex; }
  if (item.contentFile) { item.content = new Uint8Array(readFileSync(item.contentFile)); delete item.contentFile; }
  const sender = new ds.Sender({ pairing, storage, from: 'node', app: 'node/test' });
  const row = await sender.send(item);
  console.log(JSON.stringify(row));
} else if (cmd === 'receive') {
  const r = new ds.Receiver({ pairing, storage, from: 'JS Daylight' });
  const { items, acked, ackError, storeError } = await r.pollOnce();
  const out = items.map((i) => {
    if (!arg) return { header: i.header, contentHex: ds.toHex(i.content), size: i.content.length };
    const f = join(arg, i.header.id + '.bin');
    writeFileSync(f, i.content);
    return { header: i.header, contentFile: f, size: i.content.length };
  });
  console.log(JSON.stringify({ items: out, acked, ackError, storeError }));
} else if (cmd === 'acks') {
  const sender = new ds.Sender({ pairing, storage });
  await storage.set('outbox', [{ id: arg, kind: 'url', status: 'sent', created: Date.now(), lastPublish: Date.now(), attempts: 1 }]);
  const n = await sender.checkAcks();
  console.log(JSON.stringify({ delivered: n, status: (await sender.list())[0].status }));
} else {
  throw new Error('unknown command ' + cmd);
}
