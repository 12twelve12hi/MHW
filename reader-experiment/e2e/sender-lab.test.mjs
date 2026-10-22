// The e2e phone's Lab commands (sender.mjs lab-states, wait-lab, status), without an emulator: the JS reference
// Daylight (Receiver + LabInbox, LAB-PROTOCOL 2.2.4) answers through the mock relay, so a broken command shows here
// before it costs an emulator run. node --test reader-experiment/e2e/sender-lab.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ds from '../share/js/daylight-share.js';
import * as lab from '../share/js/daylight-lab.js';
import { startMockRelay } from '../share/js/mock-relay.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const T = lab.LAB_TEXT;

// Runs sender.mjs with its state in `state` -> {code, out, err}.
const run = (state, args, { plain = false } = {}) => new Promise((resolve) => {
  execFile(process.execPath, [join(here, 'sender.mjs'), ...args],
    { env: { ...process.env, E2E_STATE: state, E2E_PLAIN: plain ? '1' : '' } },
    (e, out, err) => resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out, err }));
});
const ok = async (state, args, opts) => {
  const r = await run(state, args, opts);
  assert.equal(r.code, 0, `sender.mjs ${args.join(' ')} exited ${r.code}\n${r.out}\n${r.err}`);
  return r.out;
};
const v11Words = (row) => { const d = ds.describeRow(row); return `${d.label}. ${d.sentence}`; };
const labLine = (t) => `${t.label}. ${t.sentence}`;

test('the e2e phone reads Lab frames: the hello, states, waiting then handed, Lab off and on, and a v1.1 phone beside it', async (t) => {
  const relay = await startMockRelay();
  const dir = mkdtempSync(join(tmpdir(), 'e2e-sender-'));
  t.after(async () => { await relay.close(); rmSync(dir, { recursive: true, force: true }); });
  const phone = join(dir, 'phone.json');
  const plainPhone = join(dir, 'plain.json');

  const code = (await ok(phone, ['pair', relay.url])).trim();
  copyFileSync(phone, plainPhone); // a second phone on the same pairing, with its own outbox
  const secret = await ds.parseCode(code);
  const pairing = { secret, relay: relay.url };

  // The Daylight: a Receiver that acks, and a LabInbox on a clock that moves past the 30 s spacing on every tick.
  let clock = Date.now();
  let level = 1;
  const daylight = new lab.LabInbox({
    storage: new ds.MemoryStorage(), relay: new ds.RelayClient({ relay: relay.url }), keys: await ds.deriveKeys(secret),
    info: () => ({ lab: level, app: 'android/9.9-e2e', caps: ['st', 'tap', 'reader-link'], live: true }),
    from: 'CI Daylight', now: () => clock, autoFlushMs: null,
  });
  const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage(), from: 'CI Daylight' });
  const poll = async (n) => {
    const res = await receiver.pollOnce();
    assert.equal(res.items.length, n, 'items the Daylight received');
    assert.equal(res.ackError, null);
    await daylight.notePolled(clock);
    return res.items.map((it) => it.header.id);
  };
  const flush = async (kind) => {
    clock += 31_000;
    const r = await daylight.flush();
    assert.equal(r.reason, 'sent', `flush: ${JSON.stringify(r)}`);
    if (kind) assert.equal(r.kind, kind);
  };
  const secs = () => Math.floor(clock / 1000);

  // Before any hello: What's in Lab's header says the Daylight has not confirmed Lab.
  let out = await ok(phone, ['lab-states']);
  assert.match(out, new RegExp(`^daylight: ${T.short['needs-inbox']}$`, 'm'));
  assert.match(out, /^hello: none yet$/m);

  // Pass 1: a page, a link and a PDF; the hello and their states.
  const page = (await ok(phone, ['send-page', 'one'])).trim();
  const link = (await ok(phone, ['send-url', 'https://example.org/'])).trim();
  const doc = (await ok(phone, ['send-pdf', 'one'])).trim();
  assert.deepEqual(new Set(await poll(3)), new Set([page, link, doc]));
  await daylight.record(page, 'reader', secs());
  await daylight.record(link, 'queued', secs());
  await daylight.record(doc, 'handed', secs());
  await flush('states');
  out = await ok(phone, ['wait-lab', '20', 'lab=1', 'caps=st,tap,reader-link', `${page}=reader`, `${link}=reader|queued`, `${doc}=handed`]);
  assert.match(out, /^hello: android lab=1 app=android\/9\.9-e2e caps=st,tap,reader-link live=true /m);
  assert.match(out, new RegExp(`^daylight: ${lab.inboxLabText({ inboxLab: true, checkedIn: Date.now() }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.ok(out.includes(`${page} page reader: ${labLine(T.rows.reader)} [Sent ✓ · On your Daylight ✓ · In the Reader ✓]`), out);
  assert.ok(out.includes(`${link} url queued: ${labLine(T.rows.queued)}`), out);
  assert.ok(out.includes(`${doc} file handed: ${labLine(T.rows.handedFile)} [Sent ✓ · On your Daylight ✓ · Handed to the Reader]`), out);
  assert.match(out, /^lab: lab=1 caps=st,tap,reader-link .* after \d+ s$/m);

  // A state that does not come: exit 1, saying what is missing.
  const miss = await run(phone, ['wait-lab', '1', `${doc}=reader`]);
  assert.equal(miss.code, 1);
  assert.match(miss.err, new RegExp(`still missing after 1 s: ${doc}=reader`));
  assert.equal((await run(phone, ['wait-lab', '5', `${doc}=nope`])).code, 2);
  assert.equal((await run(phone, ['wait-lab', '5', 'bogus'])).code, 2);

  // Pass 2 (Documents = Ask): waiting first, then handed after the tap.
  const asked = (await ok(phone, ['send-pdf', 'ask'])).trim();
  await poll(1);
  await daylight.record(asked, 'waiting', secs());
  await flush('states');
  out = await ok(phone, ['wait-lab', '20', `${asked}=waiting`]);
  assert.ok(out.includes(`${asked} file waiting: ${labLine(T.rows.waiting)} [Sent ✓ · On your Daylight ✓ · In the Reader …]`), out);
  await daylight.record(asked, 'handed', secs());
  await flush('states');
  await ok(phone, ['wait-lab', '20', `${asked}=handed`]);

  // The phone's rows in the Lab timeline's words.
  out = await ok(phone, ['status']);
  assert.ok(out.includes(`${page} page `) && out.includes(`delivered: ${labLine(T.rows.reader)}`), out);
  assert.ok(out.includes(`${asked} file `) && out.includes(`delivered: ${labLine(T.rows.handedFile)}`), out);

  // A v1.1 phone on the same pairing: delivered, in v1.1's words, Lab frames or not; it has no Lab commands.
  const plainPage = (await ok(plainPhone, ['send-page', 'v11'], { plain: true })).trim();
  await poll(1);
  await daylight.record(plainPage, 'reader', secs());
  await flush('states');
  await ok(plainPhone, ['wait-acks', '1', '20'], { plain: true });
  out = await ok(plainPhone, ['status'], { plain: true });
  assert.equal(out.trim(), `${plainPage} page ${out.trim().split(' ')[2]} delivered: ${v11Words({ status: 'delivered', kind: 'page' })}`);
  assert.equal((await run(plainPhone, ['lab-states'], { plain: true })).code, 2);
  await ok(phone, ['wait-lab', '20', `${plainPage}=reader`]); // the Lab phone hears the Daylight's states for every item

  // Lab off on the Daylight: the lab: 0 frame; items get no state, and the Lab phone shows v1.1's row.
  level = 0;
  clock += 31_000;
  assert.equal((await daylight.labTurnedOff()).kind, 'off');
  await ok(phone, ['wait-lab', '20', 'lab=0']);
  const off = (await ok(phone, ['send-page', 'lab-off'])).trim();
  await poll(1);
  assert.equal(await daylight.record(off, 'reader', secs()), false);
  await ok(phone, ['wait-acks', '5', '20']);
  out = await ok(phone, ['lab-states', off]);
  assert.match(out, new RegExp(`^${off} page none: ${v11Words({ status: 'delivered', kind: 'page' }).replace('.', '\\.')}`, 'm'));
  assert.match(out, /^hello: android lab=0 app=android\/9\.9-e2e caps=- /m);
  assert.equal((await run(phone, ['wait-lab', '1', 'lab=1'])).code, 1);

  // Lab on again: a hello; the item from the Lab-off time still has no state.
  level = 1;
  clock += 31_000;
  assert.equal((await daylight.labTurnedOn()).kind, 'hello');
  await ok(phone, ['wait-lab', '20', 'lab=1', 'caps=st,tap', `${off}=none`, `${page}=reader`]);
  out = await ok(phone, ['lab-states', off]);
  assert.match(out, new RegExp(`^${off} page none: ${labLine(T.rows.delivered).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'));
});
