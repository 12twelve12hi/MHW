// Runs the Safari build's bundled classic background script (exactly as Safari loads it) against a fake `browser`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { built } from '../helpers/built.mjs';
import { fakeBrowser } from '../helpers/fake-browser.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

test('the Safari background script pairs from the app and sends', async () => {
  const b = built('safari');
  const ds = await b.load('daylight-share.js');
  const relay = await startMockRelay();
  try {
    const secret = ds.generateSecret();
    const fb = fakeBrowser({ os: 'ios', contextMenus: false, commands: false, native: async (_, msg) => (msg.type === 'getPairing' ? { code: await ds.formatCode(secret), relay: relay.url, name: 'Desk Daylight' } : null) });
    globalThis.browser = fb.api;
    // Load it the way Safari does: one classic script in the global scope.
    (0, eval)(fs.readFileSync(path.join(b.dir, 'background.js'), 'utf8'));
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
  } finally {
    await relay.close();
    delete globalThis.browser;
  }
});
