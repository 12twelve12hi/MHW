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

test('statusInfo: Sent, Delivered ✓, Not delivered with Retry', () => {
  assert.deepEqual(
    [L.statusInfo({ status: 'sent' }).label, L.statusInfo({ status: 'delivered' }).label, L.statusInfo({ status: 'failed' }).label],
    ['Sent', 'Delivered ✓', 'Not delivered'],
  );
  assert.equal(L.statusInfo({ status: 'failed', error: 'The relay refused the file as too large.' }).hint, 'The relay refused the file as too large.');
  assert.equal(L.statusInfo({ status: 'failed' }).retry, true);
  assert.equal(L.statusInfo({ status: 'expired' }).retry, true);
  assert.equal(L.statusInfo({ status: 'delivered' }).retry, false);
  assert.equal(L.statusInfo({ status: 'sending' }).label, 'Sending…');
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

test('sendSummary: "Sent <title or host>" or why not', () => {
  const sent = { row: { status: 'sent', title: '', url: 'https://www.example.com/a' } };
  const failed = { row: { status: 'failed', name: 'big.pdf', title: 'big', error: 'The relay refused the file as too large.' } };
  assert.deepEqual(L.sendSummary([sent]), { title: 'Sent example.com', body: 'On its way to your Daylight.' });
  const failedBody = L.libraryWords() ? ds.describeRow(failed.row).sentence : 'The relay refused the file as too large. It will try again.';
  assert.deepEqual(L.sendSummary([failed]), { title: 'Couldn’t send big', body: failedBody });
  assert.deepEqual(L.sendSummary([{ name: 'folder', error: 'Folders can’t be sent.' }]), { title: 'Couldn’t send folder', body: 'Folders can’t be sent.' });
  assert.equal(L.sendSummary([sent, sent]).title, 'Sent 2 items');
  const mixed = L.sendSummary([sent, failed]);
  assert.equal(mixed.title, 'Sent 1 of 2 items');
  assert.ok(mixed.body.startsWith('big: '), mixed.body);
});

test('rowView: the library’s own words when it has them, else Sent / Delivered ✓ / Not delivered + the reason', () => {
  const now = Date.now();
  const rows = ['sending', 'sent', 'delivered', 'failed', 'expired'].map((status) => ({
    id: 'a'.repeat(32), kind: 'file', name: 'x.pdf', status, created: now, error: 'The relay refused the file as too large.', errorCode: '',
  }));
  for (const row of rows) {
    const v = L.rowView(row, now);
    const expected = L.libraryWords() ? ds.describeRow(row, now).label : L.statusInfo(row).label;
    assert.equal(v.label, expected, row.status);
    if (row.status === 'delivered') { assert.match(v.label, /Delivered ✓/); assert.equal(v.sentence, ''); assert.equal(v.retry, false); }
    if (row.status === 'failed' || row.status === 'expired') assert.ok(v.sentence, `${row.status} says why`);
  }
  if (!L.libraryWords()) {
    assert.deepEqual(L.rowView(rows[3]), { label: 'Not delivered', tone: 'bad', sentence: 'The relay refused the file as too large.', retry: true, retryLabel: 'Retry' });
    assert.equal(L.rowView(rows[1]).label, 'Sent');
  } else {
    assert.equal(L.rowView(rows[3]).retry, !!ds.describeRow(rows[3]).action);
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
