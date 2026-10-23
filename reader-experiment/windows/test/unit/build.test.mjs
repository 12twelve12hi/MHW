// The build (one source for the protocol library), the Tauri configuration and the bridge's storage adapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dist, load } from '../helpers/built.mjs';
import { SHARE_LIB } from '../../build.mjs';
import { LAB_LIB, codeWave, holdFor, laterWave, w1Names, waveRank } from '../../scripts/lab-wave.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tauriDir = path.join(root, 'src-tauri');
const conf = JSON.parse(fs.readFileSync(path.join(tauriDir, 'tauri.conf.json'), 'utf8'));

test('the build copies daylight-share.js unchanged and every file the page loads', () => {
  const out = dist();
  assert.deepEqual(fs.readFileSync(path.join(out, 'daylight-share.js')), fs.readFileSync(SHARE_LIB));
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  for (const ref of html.matchAll(/(?:src|href)="([^":]+)"/g)) assert.ok(fs.existsSync(path.join(out, ref[1])), `missing ${ref[1]}`);
  // Relative imports between the page's modules resolve inside dist/.
  for (const f of fs.readdirSync(out).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(out, f), 'utf8');
    for (const m of src.matchAll(/^import .* from '(\.\/[^']+)';$/gm)) assert.ok(fs.existsSync(path.join(out, m[1])), `${f} imports missing ${m[1]}`);
  }
});

test('every element app.js looks up exists in index.html', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  for (const v of js.match(/VIEWS = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)) used.add(v[1]);
  for (const id of used) assert.ok(ids.has(id), `index.html has no #${id}`);
});

test('tauri.conf.json: tray app window, HTML drag and drop, NSIS per user, deep link scheme', () => {
  assert.equal(conf.productName, 'Send to Daylight');
  assert.equal(conf.mainBinaryName, 'send-to-daylight');
  assert.equal(conf.build.frontendDist, '../dist');
  assert.equal(conf.app.withGlobalTauri, true);
  const w = conf.app.windows[0];
  assert.equal(w.label, 'main');
  assert.equal(w.visible, false, 'the window opens from main.rs (or not at all when started at login)');
  assert.equal(w.dragDropEnabled, false, 'the page handles drops itself, so links can be dropped too');
  assert.match(conf.app.security.csp, /connect-src[^;]*https:/);
  assert.match(conf.app.security.csp, /connect-src[^;]*ipc:/);
  assert.deepEqual(conf.bundle.targets, ['nsis']);
  assert.equal(conf.bundle.windows.nsis.installMode, 'currentUser');
  assert.ok(fs.existsSync(path.join(tauriDir, conf.bundle.windows.nsis.installerHooks)));
  for (const icon of conf.bundle.icon) assert.ok(fs.existsSync(path.join(tauriDir, icon)), icon);
  assert.ok(fs.existsSync(path.join(tauriDir, 'icons', 'tray.png')));
  assert.deepEqual(conf.plugins['deep-link'].desktop.schemes, ['daylightshare']);
});

test('the installer hooks add and remove Send to > Daylight, and put start at login back after an update', () => {
  const nsh = fs.readFileSync(path.join(tauriDir, conf.bundle.windows.nsis.installerHooks), 'utf8');
  const main = fs.readFileSync(path.join(tauriDir, 'src', 'main.rs'), 'utf8');
  const marker = main.match(/AUTOSTART_MARKER: &str = "([^"]+)"/)[1];
  const post = nsh.slice(nsh.indexOf('!macro NSIS_HOOK_POSTINSTALL'), nsh.indexOf('!macroend'));
  assert.ok(post.includes(`\${If} \${FileExists} "$APPDATA\\\${BUNDLEID}\\${marker}"`), 'checks the app’s marker');
  assert.ok(post.includes(`WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "\${PRODUCTNAME}" '"$INSTDIR\\\${MAINBINARYNAME}.exe" --autostart'`), 'writes the Run entry as the app does');
  assert.equal(conf.productName, main.match(/PRODUCT: &str = "([^"]+)"/)[1], 'the Run entry has one name');
  assert.match(nsh, /!macro NSIS_HOOK_POSTINSTALL[\s\S]*CreateShortcut "\$APPDATA\\Microsoft\\Windows\\SendTo\\Daylight\.lnk" "\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"/);
  assert.match(nsh, /!macro NSIS_HOOK_POSTUNINSTALL[\s\S]*Delete "\$APPDATA\\Microsoft\\Windows\\SendTo\\Daylight\.lnk"/);
  const rs = fs.readFileSync(path.join(tauriDir, 'src', 'sendto.rs'), 'utf8');
  assert.match(rs, /LINK_NAME: &str = "Daylight\.lnk"/, 'the app and the installer use the same shortcut');
});

test('the capability grants only Tauri core to the window; Rust commands match the bridge', () => {
  const cap = JSON.parse(fs.readFileSync(path.join(tauriDir, 'capabilities', 'default.json'), 'utf8'));
  assert.deepEqual(cap.windows, ['main']);
  assert.deepEqual(cap.permissions, ['core:default']);
  const main = fs.readFileSync(path.join(tauriDir, 'src', 'main.rs'), 'utf8');
  const handlers = main.match(/generate_handler!\[([\s\S]*?)\]/)[1].split(',').map((s) => s.trim().replace(/^store::/, '')).filter(Boolean);
  const bridge = fs.readFileSync(path.join(root, 'src', 'bridge.js'), 'utf8');
  const invoked = [...bridge.matchAll(/invoke\('([a-z_]+)'/g)].map((m) => m[1]);
  for (const cmd of invoked) assert.ok(handlers.includes(cmd), `bridge.js calls ${cmd}, main.rs doesn't register it`);
  for (const ev of bridge.matchAll(/listen\('([^']+)'/g)) assert.ok(main.includes(`"${ev[1]}"`), `main.rs never emits ${ev[1]}`);
});

test('the window listens for Send To, links and the hotkey before it reads anything saved', () => {
  const js = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
  const init = js.slice(js.indexOf('async function init()'));
  const wake = init.indexOf('bridge.onWake(');
  const tick = init.indexOf('bridge.onTick(');
  for (const read of ['app.getSettings()', 'app.state()', 'app.rows()']) {
    assert.ok(wake > 0 && tick > 0 && wake < init.indexOf(read) && tick < init.indexOf(read), `listeners come before ${read}`);
  }
});

test('versions are pinned', () => {
  const cargo = fs.readFileSync(path.join(tauriDir, 'Cargo.toml'), 'utf8');
  for (const m of cargo.matchAll(/^(tauri[\w-]*|windows) = (.+)$/gm)) assert.match(m[2], /"=\d+\.\d+\.\d+"/, `${m[1]} is pinned`);
  assert.ok(fs.existsSync(path.join(tauriDir, 'Cargo.lock')));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const [name, v] of Object.entries(pkg.devDependencies)) assert.match(v, /^\d+\.\d+\.\d+$/, `${name} is pinned`);
  assert.ok(fs.existsSync(path.join(root, 'package-lock.json')));
});

test('appStorage keeps JSON values in Rust’s files and reports every failed write', async () => {
  const files = new Map();
  const calls = [];
  globalThis.__TAURI__ = {
    core: {
      async invoke(cmd, args) {
        calls.push(cmd);
        if (cmd === 'kv_get') return files.has(args.key) ? files.get(args.key) : null;
        if (cmd === 'kv_set') {
          if (args.key.startsWith('outbox/') && args.value.length > 100) throw new Error('disk full');
          files.set(args.key, args.value);
          return null;
        }
        if (cmd === 'kv_remove') { files.delete(args.key); return null; }
        if (cmd === 'kv_set_aside') { if (files.has(args.key)) files.set(`${args.key}.bad`, files.get(args.key)); files.delete(args.key); return null; }
        if (cmd === 'read_file') return new Uint8Array([1, 2, 3]).buffer;
        throw new Error(`unexpected ${cmd}`);
      },
    },
    event: { listen: async () => () => {} },
  };
  try {
    const { appStorage, bridge } = await load('bridge.js');
    const s = appStorage({ warn() {} });
    assert.equal(await s.get('pairing'), undefined);
    await s.set('pairing', { code: 'X', name: 'Ünï ✓' });
    assert.deepEqual(await s.get('pairing'), { code: 'X', name: 'Ünï ✓' });
    assert.equal(files.get('pairing'), '{"code":"X","name":"Ünï ✓"}');
    // A failed re-send copy is reported too: the protocol library catches it and sends the item once.
    await assert.rejects(s.set('outbox/abc', 'A'.repeat(200)), /disk full/);
    assert.equal(await s.get('outbox/abc'), undefined);
    const real = globalThis.__TAURI__.core.invoke;
    globalThis.__TAURI__.core.invoke = async () => { throw new Error('disk full'); };
    await assert.rejects(s.set('outbox', []), /disk full/, 'the outbox itself must be saved');
    globalThis.__TAURI__.core.invoke = real;
    await s.remove('pairing');
    assert.equal(files.has('pairing'), false);
    assert.deepEqual(await bridge.readFile('C:\\x'), new Uint8Array([1, 2, 3]));

    // A damaged file (a power cut mid-write leaves it empty or zero-filled) reads as missing and is set aside.
    const bad = [];
    const s2 = appStorage({ warn() {} }, (key) => bad.push(key));
    files.set('outbox', '\0\0\0\0');
    files.set('pairing', '');
    files.set('settings', '[1]');
    files.set('ackSince', '17');
    assert.equal(await s2.get('outbox'), undefined);
    assert.equal(await s2.get('pairing'), undefined);
    assert.equal(await s2.get('settings'), undefined, 'valid JSON of the wrong kind is damage too');
    assert.equal(await s2.get('ackSince'), 17);
    assert.deepEqual(bad, ['outbox', 'pairing', 'settings']);
    assert.equal(files.get('outbox.bad'), '\0\0\0\0');
    assert.equal(files.has('outbox'), false);
    files.set('outbox', JSON.stringify([{ id: 'a', status: 'sent' }, null, 7, { status: 'sent' }]));
    assert.deepEqual(await s2.get('outbox'), [{ id: 'a', status: 'sent' }], 'rows that aren’t rows are left out');
    // ...and the module's Sender carries on over it.
    const ds = await load('daylight-share.js');
    files.set('outbox', '');
    const sender = new ds.Sender({ pairing: { secret: ds.generateSecret(), relay: 'http://127.0.0.1:9' }, storage: s2 });
    assert.deepEqual(await sender.list(), []);
  } finally {
    delete globalThis.__TAURI__;
  }
});

test('Comfort (F27, not Lab): its switch and footer in LAB_TEXT’s words; the comfort class on <body> in the stylesheet', async () => {
  const { LAB_TEXT } = await import('../../../share/js/daylight-lab.js');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.match(html, new RegExp(`<label for="comfort" class="switch-label">${LAB_TEXT.comfort}</label>`));
  assert.match(html, /<input id="comfort" class="switch" type="checkbox" role="switch" aria-describedby="comfort-footer">/);
  assert.ok(html.includes(`<p id="comfort-footer" class="hint small switch-footer">${LAB_TEXT.comfortFooter}</p>`));
  // In Settings, outside Lab (LAB-PLAN 1.1: Lab's own row comes first, with WIN0).
  const settings = html.slice(html.indexOf('<section id="view-settings"'), html.indexOf('</section>', html.indexOf('<section id="view-settings"')));
  assert.ok(settings.includes('id="comfort"'));
  const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  const base = Number(css.match(/^body \{[^}]*font: ([\d.]+)rem\//m)[1]);
  const big = Number(css.match(/^body\.comfort \{ font-size: ([\d.]+)rem;/m)[1]);
  assert.equal(big, base * 1.25, 'text at 125%');
  assert.match(css, /body\.comfort \*, body\.comfort \*::before, body\.comfort \*::after \{ transition: none !important; animation: none !important; \}/);
  assert.match(css, /body\.comfort :is\(button, summary, \.switch-row, \.check\) \{ min-height: 48px; \}/);
  assert.match(css, /body\.comfort :is\(\.btn, \.retry, input, textarea, \.kind, kbd\) \{ border-width: 2px; \}/);
  // Every font size is relative, so Comfort and larger text reach every part.
  const fixed = [...css.matchAll(/font(?:-size)?:[^;]*\b\d+(?:\.\d+)?px/g)].map((m) => m[0]);
  assert.deepEqual(fixed, []);
});

test('scripts/lab-wave.mjs reads the Lab wave from the code: W0 for any Lab code, W1 for W1 code (LAB-PLAN 6.2)', () => {
  const w1 = w1Names(fs.readFileSync(LAB_LIB, 'utf8'));
  // The plan's W1 additions (2.7.2) are W1 names; W0's reference (L0) is not.
  for (const n of ['normaliseShare', 'extractAppleNewsTarget', 'classifyShare', 'excerptHtml', 'excerptMarkdown', 'excerptFileName', 'textFragment', 'testArticle', 'redactDiagnostics']) assert.ok(w1.includes(n), n);
  for (const n of ['LabLedger', 'labHook', 'labGate', 'LAB_TEXT', 'needsMessage', 'checkedInText', 'deriveLabTopics']) assert.ok(!w1.includes(n), n);
  assert.throws(() => w1Names('export const A = 1;\n'), /no "\/\/ W1 \(L1\)" heading/);
  const wave = (files) => codeWave(files.map(([name, text]) => ({ name, text })), { w1 }).wave;
  const app = ['src/app.js', "import { createApp } from './core.js';\nconst x = { deferred: 1 };\n"];
  assert.equal(wave([app, ['build.mjs', "fs.copyFileSync(SHARE_LIB, 'daylight-share.js');"]]), null);
  // The reviewer's case: WIN0 adds src/lab.js and the daylight-lab.js copy but leaves lab-wave.json at null.
  assert.equal(wave([app, ['src/lab.js', 'export const on = true;']]), 'w0');
  assert.equal(wave([['src/app.js', "import { labGate } from './daylight-lab.js';"]]), 'w0');
  assert.equal(wave([app, ['build.mjs', "fs.copyFileSync(path.join(share, 'daylight-lab.js'), out);"]]), 'w0');
  assert.equal(wave([app, ['src/index.html', '<script type="module" src="daylight-lab.js"></script>']]), 'w0');
  // ...and WIN1 leaving "w0" after w0 opens.
  assert.equal(wave([['src/lab.js', "import { normaliseShare } from './daylight-lab.js';"]]), 'w1');
  assert.equal(wave([['src/app.js', 'const d = describeLabRow(row, now, ctx);']]), 'w1');
  assert.equal(wave([['src/app.js', 'await sender.flushNetwork();']]), 'w1');
  assert.equal(wave([['src/core.js', 'await sender.send(item, { defer: true });']]), 'w1');
  // A WIN1 commit that only uses LAB_TEXT strings (F08's toast, F33's label) but turns the note on, lists a W1 feature
  // or builds one (F02's entry point is W1 on Windows) is W1 all the same.
  const w0lab = ['src/lab.js', "import { LAB_TEXT } from './daylight-lab.js';\nexport const LAB_NOTE_ENABLED = false;\nexport const LAB_FEATURES = [];\nexport const LAB_SERVER_FEATURES = ['F02'];\nexport const BUILT_FEATURES = [];\n"];
  assert.equal(wave([w0lab]), 'w0', 'WIN0’s lab.js');
  assert.equal(wave([['src/lab.js', w0lab[1].replace('LAB_NOTE_ENABLED = false', 'LAB_NOTE_ENABLED = true')]]), 'w1');
  for (const id of ['F01', 'F07', 'F08', 'F09', 'F16', 'F26', 'F33']) {
    assert.equal(wave([['src/lab.js', w0lab[1].replace('LAB_FEATURES = []', `LAB_FEATURES = ['${id}']`)]]), 'w1', id);
  }
  assert.equal(wave([['src/app.js', 'if (r.feature === "F33") toast(LAB_TEXT.copied);']]), 'w1');
  assert.equal(wave([['src/lab.js', w0lab[1].replace('BUILT_FEATURES = []', "BUILT_FEATURES = ['F02']")]]), 'w1');
  // A feature of a later wave, or one Windows doesn't have: the script can't tell, so the publish step fails.
  assert.throws(() => wave([['src/lab.js', w0lab[1].replace('LAB_FEATURES = []', "LAB_FEATURES = ['F22']")]]), /teach scripts\/lab-wave\.mjs/);
  // A copy of the module itself isn't the app's code; a longer name that merely contains a W1 name isn't one.
  assert.equal(wave([['src/daylight-lab.js', 'export function normaliseShare() {}']]), 'w0');
  assert.equal(wave([['src/daylight-lab.js', "export const USE_FEATURES = ['F03', 'F33'];"]]), 'w0');
  assert.equal(wave([app, ['src/core.js', 'const myTextFragmentText2 = 1;']]), null);
  assert.equal(laterWave(null, 'w0'), 'w0');
  assert.equal(laterWave('w1', 'w0'), 'w1');
  assert.equal(laterWave(null, null), null);
});

test('lab-wave.json names the Lab wave of the code here, and one the release gate knows (LAB-PLAN 6.2)', () => {
  const gate = JSON.parse(fs.readFileSync(path.join(root, '..', 'lab-release-gate.json'), 'utf8'));
  const { wave } = JSON.parse(fs.readFileSync(path.join(root, 'lab-wave.json'), 'utf8'));
  assert.ok(wave === null || typeof gate[wave] === 'boolean', `windows/lab-wave.json: unknown wave ${wave}`);
  // Not behind the code: a Lab build can't reach the release with lab-wave.json at null, or at "w0" with W1 code.
  const { declared, code, why, hold } = holdFor();
  assert.equal(declared, wave);
  assert.ok(waveRank(wave) >= waveRank(code), `windows/lab-wave.json says ${wave ?? 'null'}, but the code is ${code} (${why.join('; ')}): set "wave": "${code}"`);
  assert.equal(hold, wave);
  // What the build ships agrees: a dist with daylight-lab.js is Lab code.
  if (fs.existsSync(path.join(dist(), 'daylight-lab.js')) || fs.existsSync(path.join(dist(), 'lab.js'))) assert.notEqual(code, null);
  // The workflow's publish job reads both files before it uploads the installer.
  // A Windows checkout has CRLF line ends.
  const wf = fs.readFileSync(path.join(root, '..', '..', '.github', 'workflows', 'rx-windows.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(wf.includes('reader-experiment/windows/lab-wave.json') && wf.includes('reader-experiment/lab-release-gate.json'));
  // A change to what the build copies or the tests read runs the workflow (the server lane's module and vectors too).
  const paths = wf.slice(wf.indexOf('    paths:'), wf.indexOf('  workflow_dispatch:'));
  for (const p of ['reader-experiment/windows/**', 'reader-experiment/share/js/**', 'reader-experiment/share/vectors/**', 'reader-experiment/server/client/**', 'reader-experiment/server/vectors/**', 'reader-experiment/lab-release-gate.json']) {
    assert.ok(paths.includes(`- '${p}'`), `rx-windows runs on ${p}`);
  }
  // ...and holds the build for the code's own wave too (scripts/lab-wave.mjs, with what it reads checked out).
  for (const p of ['reader-experiment/windows/scripts/lab-wave.mjs', 'reader-experiment/windows/build.mjs', 'reader-experiment/windows/src', 'reader-experiment/share/js/daylight-lab.js']) {
    assert.match(wf, new RegExp(`^ {12}${p.replace(/[.]/g, '\\.')}$`, 'm'), `publish checks out ${p}`);
  }
  assert.match(wf, /wave=\$\(node reader-experiment\/windows\/scripts\/lab-wave\.mjs\)\n/);
  const jobs = wf.slice(wf.search(/^jobs:$/m));
  const names = [...jobs.matchAll(/^ {2}([a-z][\w-]*):$/gm)];
  assert.deepEqual(names.map((m) => m[1]), ['app', 'ui', 'publish']);
  for (const job of names) {
    // The comment block right above the job names its lane.
    const above = jobs.slice(0, job.index).trimEnd().split('\n');
    const block = [];
    while (above.length && /^ {2}#/.test(above.at(-1))) block.push(above.pop());
    assert.ok(block.some((l) => /^ {2}# lane: win$/.test(l)), `job ${job[1]} carries "# lane: win" (LAB-PLAN 6.1)`);
  }
  // publish uploads only after both test jobs, and only when the gate lets the build through.
  assert.match(jobs, /publish:\n[\s\S]*needs: \[app, ui\]/);
  assert.match(jobs, /if: steps\.gate\.outputs\.open == 'true'\n[\s\S]*rx-publish\.sh/);
});
