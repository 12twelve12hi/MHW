// Runs the Safari build's bundled classic background script (exactly as Safari loads it) against a fake `browser`: with
// Lab, and as build.mjs makes it while its Lab wave is closed in lab-release-gate.json (LAB-PLAN 6.2), when the Safari
// build that ships inside the iPhone and Mac apps must be the extension's last non-Lab build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { built } from '../helpers/built.mjs';
import { fakeBrowser } from '../helpers/fake-browser.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

/** Loads a Safari build's background.js the way Safari does: one classic script in the global scope. */
function loadBackground(b, fb) {
  globalThis.browser = fb.api;
  (0, eval)(fs.readFileSync(path.join(b.dir, 'background.js'), 'utf8'));
}

test('the Safari background script pairs from the app, sends, and runs Lab', async () => {
  const b = built('safari', { lab: true });
  const ds = await b.load('daylight-share.js');
  const relay = await startMockRelay();
  try {
    const secret = ds.generateSecret();
    const fb = fakeBrowser({ os: 'ios', contextMenus: false, commands: false, native: async (_, msg) => (msg.type === 'getPairing' ? { code: await ds.formatCode(secret), relay: relay.url, name: 'Desk Daylight' } : null) });
    loadBackground(b, fb);
    assert.equal(fb.listeners.message.length, 1);
    assert.equal(fb.listeners.alarm.length, 1);
    assert.equal(typeof globalThis.sendToDaylight?.sendTab, 'function');

    const st = await fb.api.runtime.sendMessage({ type: 'state' });
    assert.equal(st.ok, true);
    assert.equal(st.result.paired, true);
    assert.equal(st.result.name, 'Desk Daylight');
    assert.equal(st.result.defaultFrom, 'Safari on iPhone');
    assert.equal(st.result.shortcut, '', 'no commands on iOS');

    const tabId = fb.addTab({ url: 'https://example.com/read', title: 'Read me', html: '<html><body><p>Safari page</p></body></html>' });
    const sent = await fb.api.runtime.sendMessage({ type: 'sendTab', tabId });
    assert.equal(sent.ok, true, sent.error);
    assert.equal(sent.result.row.status, 'sent');

    const receiver = new ds.Receiver({ pairing: { secret, relay: relay.url }, storage: new ds.MemoryStorage() });
    const { items } = await receiver.pollOnce();
    assert.equal(items.length, 1);
    assert.equal(items[0].header.kind, 'page');
    assert.equal(items[0].header.app, 'safari/1.2.3');
    assert.equal(items[0].header.from, 'Safari on iPhone');
    assert.match(new TextDecoder().decode(items[0].content), /Safari page/);

    await fb.api.runtime.sendMessage({ type: 'tick' });
    const rows = (await fb.api.storage.local.get('outbox')).outbox;
    assert.equal(rows[0].status, 'delivered');

    // Protocol 1.1 pairing in the bundle: the same code applies with the module's notice; another code asks first.
    const same = await fb.api.runtime.sendMessage({ type: 'pair', input: await ds.formatCode(secret), relay: relay.url });
    assert.equal(same.ok, true, same.error);
    assert.equal(same.result.notice, 'Pairing updated.');
    assert.equal(same.result.name, 'Desk Daylight', 'a typed code keeps the name');
    const other = await fb.api.runtime.sendMessage({ type: 'pair', input: await ds.formatCode(ds.generateSecret()) });
    assert.equal(other.result.needsConfirm.button, 'Switch');
    assert.equal(other.result.needsConfirm.lines.at(-1), 'This replaces Desk Daylight. Items not yet delivered to it will not be sent.');
    assert.equal((await fb.api.runtime.sendMessage({ type: 'state' })).result.name, 'Desk Daylight', 'nothing changed before the answer');

    // Lab (X0) in the bundle: on by default, What's in Lab with Safari's one server feature, its gate, the server section.
    const L = await b.load('daylight-lab.js');
    for (let i = 0; i < 50 && (await fb.api.storage.local.get('settings')).settings?.lab === undefined; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal((await fb.api.storage.local.get('settings')).settings.lab, true, 'the first start wrote lab = true');
    const lab = await fb.api.runtime.sendMessage({ type: 'labState' });
    assert.equal(lab.ok, true, lab.error);
    assert.deepEqual([lab.result.lab, lab.result.serverState, lab.result.serverSubtitle], [true, 'needs-server', 'Optional · Not set up']);
    const o = (await fb.api.runtime.sendMessage({ type: 'labOverview' })).result;
    assert.deepEqual(o.server.features.map((f) => f.id), ['F37']);
    assert.equal(o.header, 'Needs Lab on your Daylight · checked in just now');
    const g = (await fb.api.runtime.sendMessage({ type: 'labGate', feature: 'F37' })).result;
    assert.deepEqual([g.state, g.message, g.button], ['needs-server', L.LAB_TEXT.needs['needs-server'], 'Copy Server code']);
    assert.match(g.serverCode, /^daylightserver:\/\/setup\?c=/);
    const v = (await fb.api.runtime.sendMessage({ type: 'labServer' })).result;
    assert.equal(v.serverCode, g.serverCode);
    assert.equal((await fb.api.runtime.sendMessage({ type: 'setLab', lab: false })).result.lab, false);
    assert.equal((await fb.api.runtime.sendMessage({ type: 'labGate', feature: 'F37' })).result.state, 'lab-off');
  } finally {
    await relay.close();
    delete globalThis.browser;
  }
});

test('a Safari build without Lab (its wave closed) is the last non-Lab build: no switch, nothing written, no ledger', async () => {
  const b = built('safari', { lab: false });
  const ds = await b.load('daylight-share.js');
  const L = await b.load('daylight-lab.js');
  const relay = await startMockRelay();
  try {
    const secret = ds.generateSecret();
    const pairing = { secret, relay: relay.url };
    const fb = fakeBrowser({ os: 'macos', native: async (_, msg) => (msg.type === 'getPairing' ? { code: await ds.formatCode(secret), relay: relay.url, name: 'Desk Daylight' } : null) });
    loadBackground(b, fb);
    const send = async (m) => { const r = await fb.api.runtime.sendMessage(m); assert.equal(r.ok, true, r.error); return r.result; };
    const st = await send({ type: 'state' });
    assert.equal(st.paired, true);
    assert.deepEqual([st.lab, st.labBuilt], [false, false]);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await fb.api.storage.local.get('settings')).settings?.lab, undefined, 'no Lab default written');
    assert.deepEqual(await send({ type: 'setLab', lab: true }), { lab: false }, 'Lab can’t be turned on');
    assert.equal((await fb.api.storage.local.get('settings')).settings?.lab, undefined);
    assert.equal((await send({ type: 'labState' })).lab, false);
    assert.deepEqual(await send({ type: 'labOverview' }), { lab: false });
    assert.deepEqual(await send({ type: 'labServer' }), { lab: false });
    assert.equal((await send({ type: 'labGate', feature: 'F37' })).state, 'lab-off');
    // A Lab Daylight's hello and states reach no ledger: nothing under lab/ (protocol 1.1 acks still work).
    const tabId = fb.addTab({ url: 'https://example.com/plain', title: 'Plain', html: '<html><body><p>Plain</p></body></html>' });
    assert.equal((await send({ type: 'sendTab', tabId })).row.status, 'sent');
    const storage = new ds.MemoryStorage();
    const labInbox = new L.LabInbox({
      storage, relay: new ds.RelayClient({ relay: relay.url }), keys: await ds.deriveKeys(secret),
      info: { lab: 1, app: 'android/1.5.0', caps: ['st', 'tap'], live: false }, from: 'Daylight', autoFlushMs: null,
    });
    const polled = await new L.LabInboxSim({ receiver: new ds.Receiver({ pairing, storage }), labInbox }).pollOnce();
    assert.ok(polled.lab, 'the Daylight published a Lab frame');
    await send({ type: 'tick' });
    assert.equal((await fb.api.storage.local.get('outbox')).outbox[0].status, 'delivered');
    assert.deepEqual(Object.keys(await fb.api.storage.local.get(null)).filter((k) => k.startsWith('lab/')), []);
    assert.equal(fs.existsSync(path.join(b.dir, 'lab.html')), false, 'no Lab page');
  } finally {
    await relay.close();
    delete globalThis.browser;
  }
});
