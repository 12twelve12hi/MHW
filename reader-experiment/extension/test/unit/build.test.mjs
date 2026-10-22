import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { built } from '../helpers/built.mjs';
import { manifestFor, bundleClassic, version, serverModule, labFor, LAB_PAGES } from '../../build.mjs';
import { zipDir, unzip, listFiles } from '../../scripts/zip.mjs';
import {
  LAB_LIB, W1_FEATURES, codeWave, holdFor, laterWave, releaseGate, w1Names, waveRank,
} from '../../scripts/lab-wave.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const SHARE = path.join(here, '..', '..', '..', 'share', 'js', 'daylight-share.js');
const LAB = path.join(here, '..', '..', '..', 'share', 'js', 'daylight-lab.js');
const SERVER = path.join(here, '..', '..', '..', 'server', 'client', 'daylight-server.js');
const targets = {
  chrome: built('chrome'),
  // The Safari build with Lab, and as it is while its Lab wave is closed (LAB-PLAN 6.2; build.mjs labFor).
  safari: built('safari', { lab: true }),
  'safari-held': built('safari', { lab: false }),
  'chrome-test': built('chrome-test'),
};
const manifest = (t) => JSON.parse(fs.readFileSync(path.join(targets[t].dir, 'manifest.json'), 'utf8'));
const labBuilt = (dir) => /^export const LAB_BUILT = (true|false);$/m.exec(fs.readFileSync(path.join(dir, 'target.js'), 'utf8'))?.[1];

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

test('every build carries unmodified copies of daylight-share.js and daylight-lab.js, the server module, and no remote code', () => {
  const lib = fs.readFileSync(SHARE);
  const labLib = fs.readFileSync(LAB);
  const server = fs.readFileSync(SERVER, 'utf8');
  for (const [t, { dir }] of Object.entries(targets)) {
    assert.ok(fs.readFileSync(path.join(dir, 'daylight-share.js')).equals(lib), `${t}: copy of the shared library`);
    assert.ok(fs.readFileSync(path.join(dir, 'daylight-lab.js')).equals(labLib), `${t}: copy of the Lab module (LAB-PLAN 2.7.2)`);
    // The server client module, next to the protocol library: only its one import changes.
    const copy = fs.readFileSync(path.join(dir, 'daylight-server.js'), 'utf8').split('\n');
    const src = server.split('\n');
    assert.equal(copy.length, src.length, `${t}: daylight-server.js`);
    const changed = src.map((l, i) => [l, copy[i]]).filter(([a, c]) => a !== c);
    assert.deepEqual(changed, [["} from '../../share/js/daylight-share.js';", "} from './daylight-share.js';"]], `${t}: daylight-server.js changes only its import`);
    for (const f of listFiles(dir).filter((f) => /\.(js|html)$/.test(f))) {
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.doesNotMatch(s, /\beval\(|new Function\(|<script[^>]+src="https?:|importScripts\(/, `${t}/${f}`);
    }
    for (const page of ['popup.html', 'lab.html']) {
      if (page === 'lab.html' && t === 'safari-held') continue; // a build without Lab has no lab.html
      const html = fs.readFileSync(path.join(dir, page), 'utf8');
      for (const ref of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(dir, ref[1])), `${t}: ${page}: ${ref[1]} exists`);
    }
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

test('scripts/lab-wave.mjs reads the Lab wave from the code: W0 for any Lab code, W1 for W1 code (LAB-PLAN 6.2)', () => {
  const w1 = w1Names(fs.readFileSync(LAB_LIB, 'utf8'));
  // The plan's W1 additions (2.7.2) are W1 names; W0's reference (L0) is not.
  for (const n of ['normaliseShare', 'classifyShare', 'excerptHtml', 'testArticle', 'redactDiagnostics', 'USE_FEATURES', 'labUseOn', 'fillText']) assert.ok(w1.includes(n), n);
  for (const n of ['LabLedger', 'labHook', 'labGate', 'LAB_TEXT', 'needsMessage', 'serverRowSubtitle', 'inboxLabText']) assert.ok(!w1.includes(n), n);
  assert.throws(() => w1Names('export const A = 1;\n'), /no "\/\/ W1 \(L1\)" heading/);
  const wave = (files) => codeWave(files.map(([name, text]) => ({ name, text })), { w1 }).wave;
  const core = ['src/core.js', "import * as ds from './daylight-share.js';\nconst x = { deferred: 1 };\n"];
  assert.equal(wave([core, ['build.mjs', "fs.copyFileSync(SHARE_LIB, 'daylight-share.js');"]]), null);
  assert.equal(wave([core, ['src/lab.js', 'export const on = true;']]), 'w0');
  assert.equal(wave([['src/popup.js', "import { LAB_TEXT } from './daylight-lab.js';"]]), 'w0');
  assert.equal(wave([core, ['build.mjs', "fs.copyFileSync(path.join(share, 'daylight-lab.js'), out);"]]), 'w0');
  // W0's own: the server features listed from W0, and the plan's W0 items.
  assert.equal(wave([['src/lab.js', "export const LAB_SERVER_FEATURES = { chrome: ['F02', 'F37', 'F19', 'F36'] }; // F00, F17"]]), 'w0');
  // The reviewer's case: X1 lists its features, turns the note on or imports W1 code, and leaves lab-wave.json at w0.
  assert.equal(wave([['src/lab.js', "export const LAB_FEATURES = { chrome: ['F01', 'F04'], safari: [] };"]]), 'w1');
  assert.equal(wave([['src/lab.js', 'export const BUILT_FEATURES = ["F16"];']]), 'w1');
  assert.equal(wave([['src/lab.js', 'export const LAB_NOTE_ENABLED = true;']]), 'w1');
  assert.equal(wave([['src/lab.js', 'export const LAB_NOTE_ENABLED = false;']]), 'w0');
  assert.equal(wave([['src/core.js', "import { normaliseShare } from './daylight-lab.js';"]]), 'w1');
  assert.equal(wave([['src/lab-ui.js', 'if (USE_FEATURES.includes(f.id)) {}']]), 'w1');
  assert.equal(wave([['src/popup.js', 'const d = describeLabRow(row, now, ctx);']]), 'w1');
  assert.equal(wave([['src/core.js', 'await sender.flushNetwork();']]), 'w1');
  assert.equal(wave([['src/core.js', 'await sender.send(item, { defer: true });']]), 'w1');
  for (const id of W1_FEATURES) assert.equal(wave([['src/lab.js', `const a = ['${id}'];`]]), 'w1', id);
  // A Lab feature of a later wave: nobody can tell which wave holds it, so nothing is published.
  assert.throws(() => wave([['src/lab.js', "const a = ['F05'];"]]), /a Lab feature of a later wave/);
  // A copy of the module itself isn't the extension's code; a longer name that merely contains a W1 name isn't one.
  assert.equal(wave([['src/daylight-lab.js', 'export function normaliseShare() {}']]), 'w0');
  assert.equal(wave([core, ['src/core.js', 'const myfillText2 = 1;']]), null);
  assert.equal(laterWave(null, 'w0'), 'w0');
  assert.equal(laterWave('w1', 'w0'), 'w1');
  assert.equal(laterWave(null, null), null);
  assert.throws(() => waveRank('wave1'), /not a Lab wave/);
});

test('lab-wave.json names the Lab wave of this code (not behind it), one the release gate knows (LAB-PLAN 6.2)', () => {
  const gate = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', 'lab-release-gate.json'), 'utf8'));
  const { wave } = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'lab-wave.json'), 'utf8'));
  assert.ok(wave === null || typeof gate[wave] === 'boolean', `extension/lab-wave.json: unknown wave ${wave}`);
  // The extension has Lab code from X0 on, so its builds wait for the iPhone and Mac builds of that wave.
  assert.notEqual(wave, null, 'the extension has Lab code: lab-wave.json must name its wave');
  // Not behind the code: a W1 build can't reach the release with lab-wave.json still at "w0".
  const { declared, code, why, hold } = holdFor();
  assert.equal(declared, wave);
  assert.ok(waveRank(wave) >= waveRank(code), `extension/lab-wave.json says ${wave}, but the code is ${code} (${why.join('; ')}): set "wave": "${code}"`);
  assert.equal(hold, wave);
  assert.equal(code, 'w0', 'X0 is Wave 0');
  const g = releaseGate();
  assert.deepEqual([g.hold, g.open], [hold, gate[hold] === true]);
  // The publish job holds the Chrome zip for the code's own wave too (the script), and uploads nothing when it can't
  // tell (set -e: the step fails).
  const wf = fs.readFileSync(path.join(here, '..', '..', '..', '..', '.github', 'workflows', 'rx-extension.yml'), 'utf8');
  const publish = wf.slice(wf.indexOf('\n  publish:'), wf.indexOf('\n  pages:'));
  assert.match(publish, /set -euo pipefail/);
  assert.match(publish, /node "\$1\/scripts\/lab-wave\.mjs"/);
  assert.match(publish, /check "Chrome extension" reader-experiment\/extension out\/send-to-daylight-chrome\.zip/);
  assert.match(publish, /node-version: 22/);
});

test('a Safari build has Lab only once its Lab wave is open in lab-release-gate.json (LAB-PLAN 6.2)', () => {
  // Chrome builds always have it: the publish job holds their zip instead.
  for (const t of ['chrome', 'chrome-test']) assert.equal(labFor(t).lab, true, t);
  assert.equal(labBuilt(targets.chrome.dir), 'true');
  assert.equal(labBuilt(targets['chrome-test'].dir), 'true');
  // Safari, which ships inside the iPhone and Mac apps (rx-apple.yml runs build.mjs --target safari).
  let d = labFor('safari', { gate: { hold: 'w0', open: false } });
  assert.equal(d.lab, false);
  assert.match(d.why, /its wave w0 waits for the iPhone and Mac builds of that wave \(lab-release-gate\.json has "w0": false\)/);
  assert.equal(labFor('safari', { gate: { hold: 'w0', open: true } }).lab, true);
  assert.equal(labFor('safari', { gate: { hold: null, open: true } }).lab, true);
  d = labFor('safari', { gate: () => { throw new Error('daylight-lab.js has no heading'); } });
  assert.equal(d.lab, false, 'can’t tell: no Lab');
  assert.match(d.why, /can't tell the Lab wave/);
  assert.equal(labFor('safari', { lab: true, gate: { hold: 'w0', open: false } }).lab, true, '--lab');
  assert.equal(labFor('chrome', { lab: false }).lab, false, '--no-lab');
  // What build.mjs --target safari does today follows the real gate file.
  const g = releaseGate();
  const now = built('safari');
  assert.equal(labBuilt(now.dir), String(g.hold == null || g.open));
  // Without Lab: LAB_BUILT false and no Lab page; the popup's module graph is whole (it imports lab-ui.js).
  const held = targets['safari-held'].dir;
  assert.equal(labBuilt(held), 'false');
  for (const f of LAB_PAGES) assert.equal(fs.existsSync(path.join(held, f)), false, f);
  for (const f of ['lab-ui.js', 'lab.js', 'daylight-lab.js', 'daylight-server.js']) assert.ok(fs.existsSync(path.join(held, f)), f);
  assert.equal(labBuilt(targets.safari.dir), 'true');
  for (const f of LAB_PAGES) assert.ok(fs.existsSync(path.join(targets.safari.dir, f)), f);
  for (const [t, { dir }] of Object.entries(targets)) {
    for (const f of listFiles(dir).filter((x) => /\.js$/.test(x) && x !== 'background.js')) {
      for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^import [^;]* from '\.\/([^']+)';/gm)) {
        assert.ok(fs.existsSync(path.join(dir, m[1])), `${t}/${f} imports ${m[1]}`);
      }
    }
  }
});

test('serverModule refuses a client module whose imports it can’t point at the copy next to it', () => {
  assert.throws(() => serverModule("import { a } from './x.js';\n"), /expected one import/);
  assert.throws(() => serverModule("import { a } from '../../share/js/daylight-share.js';\nimport { b } from '../y.js';\n"), /outside the module folder/);
  assert.equal(serverModule("import {\n  a,\n} from '../../share/js/daylight-share.js';\n"), "import {\n  a,\n} from './daylight-share.js';\n");
});

test('the popup’s Comfort switch says exactly what LAB_TEXT says (F27, LAB-PLAN 1.6)', async () => {
  const { LAB_TEXT } = await import('../../../share/js/daylight-lab.js');
  const html = fs.readFileSync(path.join(targets.chrome.dir, 'popup.html'), 'utf8');
  assert.match(html, /<label for="comfort" class="switch-label">([^<]*)<\/label>/);
  assert.equal(/<label for="comfort" class="switch-label">([^<]*)<\/label>/.exec(html)[1], LAB_TEXT.comfort);
  assert.equal(/<p id="comfort-footer"[^>]*>([^<]*)<\/p>/.exec(html)[1], LAB_TEXT.comfortFooter);
  assert.match(html, /<input id="comfort" class="switch" type="checkbox" role="switch" aria-describedby="comfort-footer">/);
  // Comfort is not Lab: it comes after the Lab block and outside it (LAB-PLAN 1.1), so Lab off never hides it.
  assert.ok(html.indexOf('id="comfort"') > html.indexOf('id="lab-footer"'));
  assert.ok(!/<div id="lab-rows"[\s\S]*id="comfort"[\s\S]*<\/div>\s*<p id="lab-footer"/.test(html));
});
