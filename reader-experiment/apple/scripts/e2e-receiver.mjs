// End-to-end check used by the Swift tests (DaylightShareKitTests/EndToEndTests.swift):
// polls the inbox once with the JavaScript reference Receiver, which verifies size and SHA-256 and publishes acks,
// then prints the received items as JSON.
//
//   node e2e-receiver.mjs <relay URL> <pairing code>
import { Receiver, MemoryStorage, parsePairing, sha256, toHex } from '../../share/js/daylight-share.js';

const [relay, code] = process.argv.slice(2);
if (!relay || !code) {
  console.error('usage: node e2e-receiver.mjs <relay URL> <pairing code>');
  process.exit(2);
}
const pairing = await parsePairing(code);
const receiver = new Receiver({ pairing: { ...pairing, relay }, storage: new MemoryStorage(), from: 'JS e2e receiver' });
const { items, acked } = await receiver.pollOnce();
const out = [];
for (const it of items) {
  out.push({ header: it.header, length: it.content.length, contentSha256: toHex(await sha256(it.content)) });
}
console.log(JSON.stringify({ items: out, acked }));
