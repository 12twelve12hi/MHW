import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { webBuilt } from '../helpers/web-built.mjs';

const w = webBuilt();
const W = await w.load('web-logic.js');

test('readParams merges the query and the fragment (fragment wins)', () => {
  const p = W.readParams('?url=https%3A%2F%2Fa.org%2Fx%3Fy%3D1&title=Hi&autosend=1', '#pair=ABCD&url=https%3A%2F%2Fb.org');
  // url= ends the fragment, as the Shortcut's link does: appended (Lab's smart intake reads it as shared text).
  assert.deepEqual(p, { url: 'https://b.org', title: 'Hi', autosend: true, pair: 'ABCD', appended: true });
  assert.equal(W.readParams('', '').autosend, false);
  assert.equal(W.hasShareParams(W.readParams('', '')), false);
  assert.equal(W.hasShareParams(W.readParams('?text=hello', '')), true);
  assert.equal(W.readParams('?autosend=true').autosend, true);
});

test('a Shortcut link survives an address that was appended without encoding', () => {
  const pre = '#autosend=1&pair=ABCD&url=';
  assert.equal(W.readParams('', pre + encodeURIComponent('https://a.org/x?b=1&c=a+b')).url, 'https://a.org/x?b=1&c=a+b');
  assert.equal(W.readParams('', pre + 'https://a.org/x?b=1&c=a+b').url, 'https://a.org/x?b=1&c=a+b');
  assert.equal(W.readParams('', pre + 'https://a.org/x?q=%26').url, 'https://a.org/x?q=&', 'decoded once when it decodes');
  assert.equal(W.readParams('', pre + 'https://a.org/a%20b').url, 'https://a.org/a%20b', 'kept raw when decoding breaks it');
  assert.equal(W.readParams('', pre + 'https://a.org/x#frag').url, 'https://a.org/x#frag');
  assert.equal(W.readParams('', pre + 'https://a.org/x').appended, true);
  assert.equal(W.readParams('', `${pre}just%20words`).appended, true, 'appended, whatever it holds');
  const later = W.readParams('', `#url=${encodeURIComponent('https://a.org/x?y=1')}&title=Hi&autosend=1`);
  assert.deepEqual([later.url, later.title, later.autosend, later.appended], ['https://a.org/x?y=1', 'Hi', true, undefined]);
  assert.equal(W.readParams('?url=https%3A%2F%2Fa.org%2Fx', '').appended, undefined, '?url= is never appended');
});

test('sharedLink finds the address and a title in shared text', () => {
  assert.deepEqual(W.sharedLink({ url: 'https://a.org/x' }), { url: 'https://a.org/x', title: '' });
  assert.deepEqual(W.sharedLink({ text: 'Great read https://a.org/story?id=2. ' }), { url: 'https://a.org/story?id=2', title: 'Great read' });
  assert.deepEqual(W.sharedLink({ text: 'https://a.org/x', title: 'T' }), { url: 'https://a.org/x', title: 'T' });
  assert.deepEqual(W.sharedLink({ text: 'no link here' }), { url: null, title: 'no link here' });
});

test('normalizeUserUrl', () => {
  assert.equal(W.normalizeUserUrl('example.com/story'), 'https://example.com/story');
  assert.equal(W.normalizeUserUrl(' https://a.org/x '), 'https://a.org/x');
  assert.equal(W.normalizeUserUrl('see https://a.org/x for more'), 'https://a.org/x');
  assert.equal(W.normalizeUserUrl('localhost:8080/x'), null);
  assert.equal(W.normalizeUserUrl('just words'), null);
  assert.equal(W.normalizeUserUrl('javascript:alert(1)'), null);
  assert.equal(W.normalizeUserUrl(''), null);
  assert.equal(W.normalizeUserUrl('https:/example.com'), null, 'protocol 1.1 webUrl: one slash is not a web address');
});

test('mimeFor and deviceName', () => {
  assert.equal(W.mimeFor('a.pdf', ''), 'application/pdf');
  assert.equal(W.mimeFor('book.EPUB', 'application/octet-stream'), 'application/epub+zip');
  assert.equal(W.mimeFor('notes.md', ''), 'text/markdown');
  assert.equal(W.mimeFor('x.bin', ''), 'application/octet-stream');
  assert.equal(W.mimeFor('x.pdf', 'application/pdf'), 'application/pdf');
  assert.equal(W.deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'iPhone (web)');
  assert.equal(W.deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'iPad (web)');
  assert.equal(W.deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'Mac (web)');
  assert.equal(W.deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari'), 'Android phone (web)');
  assert.equal(W.deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows PC (web)');
});

test('shortcutPrefix keeps everything in the fragment', () => {
  const s = W.shortcutPrefix('https://x.github.io/MHW/send/?url=old#pair=old', 'daylightshare://pair?c=ABC&n=My%20Daylight');
  assert.equal(s, 'https://x.github.io/MHW/send/#autosend=1&pair=daylightshare%3A%2F%2Fpair%3Fc%3DABC%26n%3DMy%2520Daylight&url=');
  const p = W.readParams('', new URL(s + encodeURIComponent('https://a.org/x?y=1&z=2')).hash);
  assert.equal(p.url, 'https://a.org/x?y=1&z=2');
  assert.equal(p.pair, 'daylightshare://pair?c=ABC&n=My%20Daylight');
  assert.equal(p.autosend, true);
});

test('the site has every file the page, the manifest and the service worker refer to', () => {
  const html = fs.readFileSync(path.join(w.dir, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) assert.ok(fs.existsSync(path.join(w.dir, m[1])), m[1]);
  const manifest = JSON.parse(fs.readFileSync(path.join(w.dir, 'manifest.webmanifest'), 'utf8'));
  for (const i of manifest.icons) assert.ok(fs.existsSync(path.join(w.dir, i.src)), i.src);
  assert.equal(manifest.share_target.method, 'POST');
  assert.equal(manifest.share_target.params.files[0].name, 'files');
  const sw = fs.readFileSync(path.join(w.dir, 'sw.js'), 'utf8');
  assert.match(sw, new RegExp(`const BUILD = '${w.build}'`));
  const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]+\])/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  for (const f of shell.filter((f) => f !== './')) assert.ok(fs.existsSync(path.join(w.dir, f)), f);
  // The protocol library and the status helpers are unmodified copies of their one source.
  const share = new URL('../../../share/js/daylight-share.js', import.meta.url);
  assert.ok(fs.readFileSync(path.join(w.dir, 'daylight-share.js')).equals(fs.readFileSync(share)), 'daylight-share.js');
  assert.ok(fs.readFileSync(path.join(w.dir, 'logic.js')).equals(fs.readFileSync(new URL('../../src/logic.js', import.meta.url))), 'logic.js');
  assert.doesNotMatch(html, /64 MB/, 'protocol 1.1: files up to 9 MB');
  assert.match(html, /up to 9 MB/);
  // Every module import resolves inside the site.
  for (const f of fs.readdirSync(w.dir).filter((f) => f.endsWith('.js'))) {
    for (const m of fs.readFileSync(path.join(w.dir, f), 'utf8').matchAll(/from '\.\/([^']+)'/g)) assert.ok(fs.existsSync(path.join(w.dir, m[1])), `${f} imports ${m[1]}`);
  }
});

test('sw.js keeps shared files only up to the protocol’s MAX_ITEM', async () => {
  const ds = await w.load('daylight-share.js');
  const sw = fs.readFileSync(path.join(w.dir, 'sw.js'), 'utf8');
  assert.equal(Number(/const MAX_ITEM = (\d+);/.exec(sw)?.[1]), ds.MAX_ITEM);
});

test('the page’s tick (logic.maintain): an expired copy goes after 14 days, a late ack still delivers, idle is quiet', async () => {
  const { startMockRelay } = await import('../../../share/js/mock-relay.mjs');
  const ds = await w.load('daylight-share.js');
  const L = await w.load('logic.js');
  let clock = Date.now();
  const relay = await startMockRelay({ now: () => clock });
  try {
    const secret = ds.generateSecret();
    const pairing = { secret, relay: relay.url, name: 'D' };
    const storage = new ds.MemoryStorage();
    const sender = new ds.Sender({ pairing, storage, from: 'test (web)', app: 'web/test', now: () => clock });
    const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage() });
    const day = 86400000;
    const t0 = clock;
    assert.deepEqual(await L.maintain(sender, clock), { delivered: 0, resent: 0 });
    assert.equal(relay.state.requests.length, 0, 'an empty outbox makes no request');

    const file = await sender.send({ kind: 'file', name: 'a.txt', mime: 'text/plain', content: ds.utf8('never picked up') });
    const link = await sender.send({ kind: 'url', url: 'https://example.com/late' });
    clock = t0 + 7 * day - 30 * 60000;
    assert.equal((await L.maintain(sender, clock)).resent, 2, 'the last re-sends before the week is up');
    clock = t0 + 7 * day + 60000;
    await L.maintain(sender, clock);
    assert.deepEqual((await sender.list()).map((r) => r.status), ['expired', 'expired']);
    // The Daylight comes back, finds both re-sends still on the relay and acks them: both are delivered.
    clock += 3600000;
    const got = await receiver.pollOnce();
    assert.deepEqual(got.items.map((i) => i.header.id).sort(), [file.id, link.id].sort());
    assert.equal((await L.maintain(sender, clock)).delivered, 2);
    assert.ok((await sender.list()).every((r) => r.status === 'delivered'));

    // A file the Daylight never acks: expired, its copy kept until 14 days after the share, then dropped.
    const t1 = clock;
    const lost = await sender.send({ kind: 'file', name: 'b.txt', mime: 'text/plain', content: ds.utf8('lost') });
    clock = t1 + 8 * day;
    await L.maintain(sender, clock);
    assert.equal((await sender.list()).find((r) => r.id === lost.id).status, 'expired');
    assert.ok(await storage.get(`outbox/${lost.id}`));
    clock = t1 + 37 * day;
    const before = relay.state.requests.length;
    await L.maintain(sender, clock);
    assert.equal(await storage.get(`outbox/${lost.id}`), undefined, 'dropped (CONTENT_KEEP)');
    assert.equal(relay.state.requests.length, before, 'past the ack window nothing reads the relay');
  } finally {
    await relay.close();
  }
});

test('localStorageAdapter reports a failed write, so a file whose re-send copy can’t be kept still goes once (note b)', async () => {
  const { startMockRelay } = await import('../../../share/js/mock-relay.mjs');
  const ds = await w.load('daylight-share.js');
  const S = await w.load('web-storage.js');
  // A localStorage that is full for big values, as Safari's 5 MB quota is for a PDF's base64 copy.
  const m = new Map();
  const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (String(v).length > 4096) throw quota(); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
  let clock = Date.now();
  const relay = await startMockRelay({ now: () => clock });
  try {
    const st = S.localStorageAdapter();
    assert.equal(st.kind, 'localstorage');
    await assert.rejects(st.set('outbox/abc', 'x'.repeat(5000)), /quota/, 'every failed write is reported');
    await st.set('settings', { from: 'Test (web)' });
    assert.deepEqual(await st.get('settings'), { from: 'Test (web)' });
    assert.equal(await st.get('missing'), undefined);

    const secret = ds.generateSecret();
    const pairing = { secret, relay: relay.url, name: 'D' };
    const sender = new ds.Sender({ pairing, storage: st, from: 'Test (web)', app: 'web/test', now: () => clock });
    const row = await sender.send({ kind: 'file', name: 'big.txt', mime: 'text/plain', content: ds.utf8('y'.repeat(20000)) });
    assert.equal(row.status, 'sent');
    assert.equal(relay.state.published, 1, 'sent once');
    assert.equal(await st.get(`outbox/${row.id}`), undefined, 'no copy kept');
    clock += 12 * 3600000; // a re-send is due, with nothing stored to re-send
    await sender.resendDue();
    const [after] = await sender.list();
    assert.deepEqual([after.status, after.errorCode], ['expired', 'gone']);
    assert.equal(relay.state.published, 1, 'nothing more was published');
    const L = await w.load('logic.js');
    assert.equal(L.statusInfo(after).hint, 'This is no longer stored on this device. Share it again.');
  } finally {
    delete globalThis.localStorage;
    await relay.close();
  }
});

test('web/lab-wave.json names no Lab wave, or one the release gate knows (LAB-PLAN 6.2)', () => {
  const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));
  const gate = read('../../../lab-release-gate.json');
  const { wave } = read('../../../web/lab-wave.json');
  assert.ok(wave === null || typeof gate[wave] === 'boolean', `web/lab-wave.json: unknown wave ${wave}`);
});

test('the web sender’s Comfort switch says exactly what LAB_TEXT says (F27, LAB-PLAN 1.6)', async () => {
  const { LAB_TEXT } = await import('../../../share/js/daylight-lab.js');
  const html = fs.readFileSync(path.join(w.dir, 'index.html'), 'utf8');
  assert.equal(/<label for="comfort" class="switch-label">([^<]*)<\/label>/.exec(html)?.[1], LAB_TEXT.comfort);
  assert.equal(/<p id="comfort-footer"[^>]*>([^<]*)<\/p>/.exec(html)?.[1], LAB_TEXT.comfortFooter);
  assert.match(html, /<input id="comfort" class="switch" type="checkbox" role="switch" aria-describedby="comfort-footer">/);
});
