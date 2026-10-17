import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { webBuilt } from '../helpers/web-built.mjs';

const w = webBuilt();
const W = await w.load('web-logic.js');

test('readParams merges the query and the fragment (fragment wins)', () => {
  const p = W.readParams('?url=https%3A%2F%2Fa.org%2Fx%3Fy%3D1&title=Hi&autosend=1', '#pair=ABCD&url=https%3A%2F%2Fb.org');
  assert.deepEqual(p, { url: 'https://b.org', title: 'Hi', autosend: true, pair: 'ABCD' });
  assert.equal(W.readParams('', '').autosend, false);
  assert.equal(W.hasShareParams(W.readParams('', '')), false);
  assert.equal(W.hasShareParams(W.readParams('?text=hello', '')), true);
  assert.equal(W.readParams('?autosend=true').autosend, true);
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
  // Every module import resolves inside the site.
  for (const f of fs.readdirSync(w.dir).filter((f) => f.endsWith('.js'))) {
    for (const m of fs.readFileSync(path.join(w.dir, f), 'utf8').matchAll(/from '\.\/([^']+)'/g)) assert.ok(fs.existsSync(path.join(w.dir, m[1])), `${f} imports ${m[1]}`);
  }
});
