import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { built } from '../helpers/built.mjs';
import { manifestFor, bundleClassic, version } from '../../build.mjs';
import { zipDir, unzip, listFiles } from '../../scripts/zip.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const SHARE = path.join(here, '..', '..', '..', 'share', 'js', 'daylight-share.js');
const targets = Object.fromEntries(['chrome', 'safari', 'chrome-test'].map((t) => [t, built(t)]));
const manifest = (t) => JSON.parse(fs.readFileSync(path.join(targets[t].dir, 'manifest.json'), 'utf8'));

function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${file} is a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('the Chrome manifest', () => {
  const m = manifest('chrome');
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.background, { service_worker: 'background.js', type: 'module' });
  for (const p of ['activeTab', 'scripting', 'contextMenus', 'storage', 'unlimitedStorage', 'alarms']) assert.ok(m.permissions.includes(p), p);
  assert.ok(!m.permissions.includes('nativeMessaging'));
  assert.ok(!m.permissions.includes('tabs'), 'activeTab is enough');
  assert.deepEqual(m.host_permissions, ['https://ntfy.sh/*']);
  assert.deepEqual(m.optional_host_permissions, ['<all_urls>']);
  assert.equal(m.commands['send-page'].suggested_key.default, 'Alt+Shift+D');
  assert.equal(m.action.default_popup, 'popup.html');
  for (const [size, file] of Object.entries(m.icons)) assert.deepEqual(pngSize(path.join(targets.chrome.dir, file)), [Number(size), Number(size)]);
  for (const [size, file] of Object.entries(m.action.default_icon)) assert.deepEqual(pngSize(path.join(targets.chrome.dir, file)), [Number(size), Number(size)]);
});

test('the Safari manifest', () => {
  const m = manifest('safari');
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.background, { scripts: ['background.js'], persistent: false });
  assert.ok(m.permissions.includes('nativeMessaging'));
  assert.equal(m.minimum_chrome_version, undefined);
  assert.ok(fs.existsSync(path.join(targets.safari.dir, m.action.default_icon)));
  assert.equal(m.version, manifest('chrome').version);
  const bg = fs.readFileSync(path.join(targets.safari.dir, 'background.js'), 'utf8');
  assert.doesNotMatch(bg, /^\s*(import|export)\b/m, 'a classic script');
  assert.doesNotThrow(() => new Function(bg), 'parses as a classic script');
  assert.match(fs.readFileSync(path.join(targets.safari.dir, 'target.js'), 'utf8'), /'safari'/);
});

test('the test build only adds local host access', () => {
  const a = manifest('chrome'), b = manifest('chrome-test');
  assert.deepEqual(b.host_permissions, [...a.host_permissions, 'http://127.0.0.1/*', 'http://localhost/*']);
  assert.deepEqual({ ...b, host_permissions: 0, name: 0 }, { ...a, host_permissions: 0, name: 0 });
});

test('every build carries an unmodified copy of daylight-share.js and no remote code', () => {
  const lib = fs.readFileSync(SHARE);
  for (const [t, { dir }] of Object.entries(targets)) {
    assert.ok(fs.readFileSync(path.join(dir, 'daylight-share.js')).equals(lib), `${t}: copy of the shared library`);
    for (const f of listFiles(dir).filter((f) => /\.(js|html)$/.test(f))) {
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.doesNotMatch(s, /\beval\(|new Function\(|<script[^>]+src="https?:|importScripts\(/, `${t}/${f}`);
    }
    const html = fs.readFileSync(path.join(dir, 'popup.html'), 'utf8');
    for (const ref of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(dir, ref[1])), `${t}: ${ref[1]} exists`);
  }
});

test('the zip has the extension at its root and unpacks to the same files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-zip-'));
  const zip = path.join(tmp, 'x.zip');
  zipDir(targets.chrome.dir, zip);
  const entries = unzip(fs.readFileSync(zip));
  assert.deepEqual(entries.map((e) => e.name).sort(), listFiles(targets.chrome.dir).sort());
  assert.ok(entries.some((e) => e.name === 'manifest.json'));
  for (const e of entries) assert.ok(e.data.equals(fs.readFileSync(path.join(targets.chrome.dir, e.name))), e.name);
  try { execFileSync('unzip', ['-tq', zip], { stdio: 'pipe' }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
});

test('version: package.json, or the CI run number as the patch', () => {
  const saved = process.env.GITHUB_RUN_NUMBER;
  try {
    delete process.env.GITHUB_RUN_NUMBER;
    assert.match(version(), /^\d+\.\d+\.\d+$/);
    process.env.GITHUB_RUN_NUMBER = '42';
    assert.match(version(), /^\d+\.\d+\.42$/);
    assert.match(manifestFor('chrome').version, /\.42$/);
  } finally {
    if (saved === undefined) delete process.env.GITHUB_RUN_NUMBER; else process.env.GITHUB_RUN_NUMBER = saved;
  }
});

test('the classic bundler refuses module forms it does not handle', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-bundle-'));
  fs.writeFileSync(path.join(tmp, 'a.js'), "import { b } from './b.js';\nexport function a() { return b; }\n");
  fs.writeFileSync(path.join(tmp, 'b.js'), 'export default 1;\n');
  assert.throws(() => bundleClassic(path.join(tmp, 'a.js')), /unsupported export/);
  fs.writeFileSync(path.join(tmp, 'b.js'), "export const b = 2;\nexport { b as c };\n");
  assert.throws(() => bundleClassic(path.join(tmp, 'a.js')), /unsupported export/);
  fs.writeFileSync(path.join(tmp, 'b.js'), "import { a } from './a.js';\nexport const b = 2;\n");
  assert.throws(() => bundleClassic(path.join(tmp, 'a.js')), /cycle/);
  fs.writeFileSync(path.join(tmp, 'b.js'), "export const b = 2;\nexport async function f() {}\nexport class K {}\n");
  const out = bundleClassic(path.join(tmp, 'a.js'));
  assert.equal(new Function(`${out.replace('(() => {', 'return (() => {').replace(/\}\)\(\);\n$/, '').replace(/^\/\/.*\n/, '')}; return __module0.a(); })();`)(), 2);
});

test('lab-wave.json names no Lab wave, or one the release gate knows (LAB-PLAN 6.2)', () => {
  const gate = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', 'lab-release-gate.json'), 'utf8'));
  const { wave } = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'lab-wave.json'), 'utf8'));
  assert.ok(wave === null || typeof gate[wave] === 'boolean', `extension/lab-wave.json: unknown wave ${wave}`);
});

test('the popup’s Comfort switch says exactly what LAB_TEXT says (F27, LAB-PLAN 1.6)', async () => {
  const { LAB_TEXT } = await import('../../../share/js/daylight-lab.js');
  const html = fs.readFileSync(path.join(targets.chrome.dir, 'popup.html'), 'utf8');
  assert.match(html, /<label for="comfort" class="switch-label">([^<]*)<\/label>/);
  assert.equal(/<label for="comfort" class="switch-label">([^<]*)<\/label>/.exec(html)[1], LAB_TEXT.comfort);
  assert.equal(/<p id="comfort-footer"[^>]*>([^<]*)<\/p>/.exec(html)[1], LAB_TEXT.comfortFooter);
  assert.match(html, /<input id="comfort" class="switch" type="checkbox" role="switch" aria-describedby="comfort-footer">/);
  // Comfort is not Lab: no Lab module in a build without Lab.
  assert.doesNotMatch(html, /daylight-lab/);
});
