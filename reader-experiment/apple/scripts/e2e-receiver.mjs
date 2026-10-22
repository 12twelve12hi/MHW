// End-to-end check used by the Swift tests (DaylightShareKitTests/EndToEndTests.swift and LabSkewTests.swift): polls
// the inbox once with a JavaScript reference Receiver, which verifies size and SHA-256 and publishes acks, then prints
// the received items as JSON.
//
//   node e2e-receiver.mjs <relay URL> <pairing code> [options]
//
// Without options the Daylight is a v1.1 Inbox (the protocol module's Receiver). Options (LAB-PLAN 2.8, the F17 skew
// suite; the Daylight's side is the JS reference: share/js/daylight-lab.js):
//   --peer v1.0 | v1.1     the Receiver as it shipped (share/js/test/fixtures), not a Lab Inbox
//   --lab                  a Lab Daylight (LabInboxSim): after the poll it records each new item's state and publishes
//                          them in one Lab frame on the ack topic (with its hello)
//   --state <token>        the state every item gets (default: reader for links and pages, handed for files)
//   --app <app>            the Lab Inbox's app (default android/1.5.0); --caps a,b,c its capabilities
//   --hello <app>          then a second publisher (for example reader-lab/0.27.900) says hello on the same ack topic,
//                          from its own storage, with --hello-caps (default st,reader-link,reader-doc,quiet)
//   --lab-off              then the Lab Inbox is turned off: it publishes its one lab: 0 frame
import { Receiver, MemoryStorage, RelayClient, parsePairing, deriveKeys, sha256, toHex } from '../../share/js/daylight-share.js';
import { LabInbox, LabInboxSim } from '../../share/js/daylight-lab.js';

const args = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--lab' || a === '--lab-off') opts[a.slice(2)] = true;
  else if (a.startsWith('--')) opts[a.slice(2)] = args[++i];
  else positional.push(a);
}
const [relay, code] = positional;
if (!relay || !code) {
  console.error('usage: node e2e-receiver.mjs <relay URL> <pairing code> [--peer v1.0|v1.1] [--lab [--state <s>] [--app <a>] [--caps a,b] [--hello <app> [--hello-caps a,b]] [--lab-off]]');
  process.exit(2);
}
const caps = (s, d) => (s ? s.split(',').filter(Boolean) : d);

const pairing = { ...(await parsePairing(code)), relay };
const from = 'JS e2e receiver';
const lab = {};
let result;
if (opts.peer === 'v1.0' || opts.peer === 'v1.1') {
  const old = await import(`../../share/js/test/fixtures/daylight-share-${opts.peer}.js`);
  result = await new old.Receiver({ pairing, storage: new old.MemoryStorage(), from }).pollOnce();
} else if (opts.lab) {
  // The Daylight's clock runs ahead between frames so that the 30 s spacing of Lab frames (2.2.4) does not hold the
  // next one back; the relay's own clock stamps each message.
  let ahead = 0;
  const now = () => Date.now() + ahead;
  const storage = new MemoryStorage();
  const keys = await deriveKeys(pairing.secret);
  const relayClient = new RelayClient({ relay });
  const app = opts.app ?? 'android/1.5.0';
  const labInbox = new LabInbox({
    storage, relay: relayClient, keys, from, now, autoFlushMs: null,
    info: { lab: 1, app, caps: caps(opts.caps, ['st', 'tap', 'reader-link']), live: false },
  });
  const stateFor = opts.state ? () => opts.state : null;
  const sim = new LabInboxSim({ receiver: new Receiver({ pairing, storage, from, now }), labInbox, stateFor });
  result = await sim.pollOnce();
  lab.flush = { published: result.lab.published, kind: result.lab.kind, states: result.lab.states, reason: result.lab.reason };
  if (opts.hello) {
    const other = new LabInbox({
      storage: new MemoryStorage(), relay: relayClient, keys, from, now, autoFlushMs: null,
      info: { lab: 1, app: opts.hello, caps: caps(opts['hello-caps'], ['st', 'reader-link', 'reader-doc', 'quiet']), live: false },
    });
    const r = await other.labTurnedOn();
    lab.hello = { published: r.published, kind: r.kind, reason: r.reason };
  }
  if (opts['lab-off']) {
    ahead += 31_000;
    const r = await labInbox.labTurnedOff();
    lab.off = { published: r.published, kind: r.kind, reason: r.reason };
  }
} else {
  result = await new Receiver({ pairing, storage: new MemoryStorage(), from }).pollOnce();
}
const out = [];
for (const it of result.items) {
  out.push({ header: it.header, length: it.content.length, contentSha256: toHex(await sha256(it.content)), extras: it.extras ?? null });
}
console.log(JSON.stringify({ items: out, acked: result.acked, lab }));
