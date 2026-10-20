import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../helpers/built.mjs';

const L = await load('logic.js');
const ds = await load('daylight-share.js');

test('mimeFor: the dropped file type wins, else the extension', () => {
  assert.equal(L.mimeFor('Paper.PDF'), 'application/pdf');
  assert.equal(L.mimeFor('book.epub'), 'application/epub+zip');
  assert.equal(L.mimeFor('notes.md'), 'text/markdown');
  assert.equal(L.mimeFor('x.bin'), 'application/octet-stream');
  assert.equal(L.mimeFor('x', 'text/plain'), 'text/plain');
  assert.equal(L.mimeFor('a.pdf', 'application/octet-stream'), 'application/pdf');
});

test('nameFromPath and titleFromName', () => {
  assert.equal(L.nameFromPath('C:\\Users\\me\\Desktop\\Field notes – draft.pdf'), 'Field notes – draft.pdf');
  assert.equal(L.nameFromPath('\\\\server\\share\\a.txt'), 'a.txt');
  assert.equal(L.nameFromPath('/home/me/b.epub'), 'b.epub');
  assert.equal(L.nameFromPath(''), '');
  assert.equal(L.titleFromName('Field notes – draft.pdf'), 'Field notes – draft');
  assert.equal(L.titleFromName('README'), 'README');
});

test('Internet Shortcut (.url) files', () => {
  assert.equal(L.isInternetShortcut('Story.URL'), true);
  assert.equal(L.isInternetShortcut('story.pdf'), false);
  const text = '[{000214A0-0000-0000-C000-000000000046}]\r\nProp3=19,11\r\n[InternetShortcut]\r\nIDList=\r\nURL=https://example.com/story?a=1\r\n';
  assert.equal(L.urlFromInternetShortcut(text), 'https://example.com/story?a=1');
  assert.equal(L.urlFromInternetShortcut('[InternetShortcut]\nURL=file:///C:/x'), null);
  assert.equal(L.urlFromInternetShortcut('nothing'), null);
});

test('linkFromDrop prefers text/uri-list, skips comments, falls back to text', () => {
  assert.equal(L.linkFromDrop({ uriList: '# comment\r\nhttps://example.com/a\r\nhttps://example.com/b' }), 'https://example.com/a');
  assert.equal(L.linkFromDrop({ uriList: '', text: 'Read this: https://example.com/c.' }), 'https://example.com/c');
  assert.equal(L.linkFromDrop({ uriList: 'file:///C:/x.txt', text: 'plain words' }), null);
  assert.equal(L.linkFromDrop({}), null);
});

test('isPending', () => {
  assert.equal(L.isPending({ status: 'sending' }), true);
  assert.equal(L.isPending({ status: 'sent' }), true);
  assert.equal(L.isPending({ status: 'failed' }), true);
  assert.equal(L.isPending({ status: 'delivered' }), false);
  assert.equal(L.isPending({ status: 'expired' }), false);
});

test('kindLabel, displayTitle, shortName', () => {
  assert.equal(L.kindLabel({ kind: 'url' }), 'Link');
  assert.equal(L.kindLabel({ kind: 'file', mime: 'application/pdf' }), 'PDF');
  assert.equal(L.kindLabel({ kind: 'file', name: 'a.epub' }), 'File');
  assert.equal(L.displayTitle({ kind: 'url', url: 'https://www.example.com/story/' }), 'example.com/story');
  assert.equal(L.displayTitle({ kind: 'file', name: 'a.pdf' }), 'a.pdf');
  assert.equal(L.shortName({ url: 'https://www.example.com/x' }), 'example.com');
  assert.equal(L.shortName({ title: 'A quiet article', url: 'https://example.com/x' }), 'A quiet article');
  assert.equal([...L.shortName({ title: 'x'.repeat(100) })].length, 60);
});

test('sendSummary: the item, then its label and sentence (CHANGES-v1.1 2.5); several: what each one did', () => {
  const now = Date.now();
  const sent = { row: { status: 'sent', title: '', url: 'https://www.example.com/a', created: now } };
  const waiting = { row: { status: 'failed', errorCode: 'full', name: 'big.pdf', title: 'big', error: 'HTTP 413', created: now } };
  const gone = { row: { status: 'expired', errorCode: 'too-large', name: 'huge.pdf', title: 'huge', size: 14_200_000, created: now } };
  assert.deepEqual(L.sendSummary([sent]), { title: 'example.com', body: 'Sent · waiting for your Daylight.', bad: false });
  assert.deepEqual(L.sendSummary([waiting]), {
    title: 'big', bad: false,
    body: 'Waiting to send. A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.',
  });
  assert.deepEqual(L.sendSummary([gone]), { title: 'huge', body: `Not delivered. ${ds.tooBigMessage(14_200_000)}`, bad: true });
  assert.deepEqual(L.sendSummary([{ name: 'folder', error: 'Folders can’t be sent.' }]), { title: 'Couldn’t send folder', body: 'Folders can’t be sent.', bad: true });
  assert.deepEqual(L.sendSummary([sent, sent]), { title: '2 items', body: 'Sent · waiting for your Daylight.', bad: false });
  const mixed = L.sendSummary([sent, waiting, { name: 'x.pdf', error: ds.tooBigMessage(9_000_001) }]);
  assert.equal(mixed.title, '3 items');
  assert.equal(mixed.bad, true);
  assert.deepEqual(mixed.body.split('\n'), [
    'example.com: Sent · waiting for your Daylight.',
    'big: Waiting to send. A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.',
    'x.pdf: Too big to send. Files can be up to 9 MB; this one is 9.1 MB.',
  ]);
  const many = L.sendSummary(Array.from({ length: 6 }, (_, i) => (i % 2 ? sent : waiting)));
  assert.equal(many.body.split('\n').at(-1), 'and 2 more');
});

test('rowView follows describeRow for every row of CHANGES-v1.1 2.5 (vectors > statusText)', async () => {
  const fs = await import('node:fs');
  const V = JSON.parse(fs.readFileSync(new URL('../../../share/vectors/test-vectors.json', import.meta.url), 'utf8'));
  assert.ok(V.statusText.length >= 12);
  const tones = { sending: 'busy', failed: 'busy', sent: 'sent', delivered: 'ok', expired: 'bad' };
  for (const c of V.statusText) {
    const v = L.rowView(c.row, c.now);
    assert.equal(v.label, c.label, c.name);
    assert.equal(v.sentence, c.sentence ?? '', c.name);
    assert.equal(v.action, c.action, c.name);
    assert.equal(v.retry, !!c.action, c.name);
    assert.equal(v.retryLabel, { 'retry-now': 'Retry now', 'try-again': 'Try again' }[c.action] ?? '', c.name);
    assert.equal(v.tone, tones[c.row.status], c.name);
    const label = /[.…✓]$/.test(c.label) ? c.label : `${c.label}.`;
    assert.equal(L.rowMessage(c.row, c.now), c.sentence ? `${label} ${c.sentence}` : label, c.name);
  }
});

test('accelFromEvent records combinations the global-shortcut plugin parses', () => {
  const k = (code, mods = {}) => L.accelFromEvent({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
  assert.equal(k('KeyD', { ctrlKey: true, altKey: true }), 'Ctrl+Alt+D');
  assert.equal(k('Digit5', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+5');
  assert.equal(k('F8', { altKey: true }), 'Alt+F8');
  assert.equal(k('Space', { metaKey: true, shiftKey: true }), 'Shift+Super+Space');
  assert.equal(k('KeyD'), null, 'a lone key would swallow typing');
  assert.equal(k('KeyD', { shiftKey: true }), null, 'Shift alone too');
  assert.equal(k('ControlLeft', { ctrlKey: true }), null, 'only modifiers so far');
  assert.equal(k('IntlRo', { ctrlKey: true }), null);
  assert.equal(L.describeAccel('Ctrl+Alt+D'), 'Ctrl + Alt + D');
  assert.equal(L.describeAccel('Super+ArrowUp'), 'Win + Up');
  assert.equal(L.describeAccel(''), 'Off');
  assert.equal(L.DEFAULT_HOTKEY, 'Ctrl+Alt+D');
});

test('relativeTime', () => {
  const now = 1_000_000_000_000;
  assert.equal(L.relativeTime(now - 10_000, now), 'just now');
  assert.equal(L.relativeTime(now - 5 * 60_000, now), '5 min ago');
  assert.equal(L.relativeTime(now - 3 * 3600_000, now), '3 h ago');
  assert.equal(L.relativeTime(now - 26 * 3600_000, now), 'yesterday');
});
