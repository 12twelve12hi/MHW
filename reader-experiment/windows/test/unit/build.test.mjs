// The build (one source for the protocol library), the Tauri configuration and the bridge's storage adapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dist, load } from '../helpers/built.mjs';
import { SHARE_LIB } from '../../build.mjs';

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

test('the installer hooks add and remove Send to > Daylight', () => {
  const nsh = fs.readFileSync(path.join(tauriDir, conf.bundle.windows.nsis.installerHooks), 'utf8');
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

test('versions are pinned', () => {
  const cargo = fs.readFileSync(path.join(tauriDir, 'Cargo.toml'), 'utf8');
  for (const m of cargo.matchAll(/^(tauri[\w-]*|windows) = (.+)$/gm)) assert.match(m[2], /"=\d+\.\d+\.\d+"/, `${m[1]} is pinned`);
  assert.ok(fs.existsSync(path.join(tauriDir, 'Cargo.lock')));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const [name, v] of Object.entries(pkg.devDependencies)) assert.match(v, /^\d+\.\d+\.\d+$/, `${name} is pinned`);
  assert.ok(fs.existsSync(path.join(root, 'package-lock.json')));
});

test('appStorage keeps JSON values in Rust’s files; the re-send copy is best effort', async () => {
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
    await s.set('outbox/abc', 'A'.repeat(200)); // fails quietly
    assert.equal(await s.get('outbox/abc'), undefined);
    const real = globalThis.__TAURI__.core.invoke;
    globalThis.__TAURI__.core.invoke = async () => { throw new Error('disk full'); };
    await assert.rejects(s.set('outbox', []), /disk full/, 'the outbox itself must be saved');
    globalThis.__TAURI__.core.invoke = real;
    await s.remove('pairing');
    assert.equal(files.has('pairing'), false);
    assert.deepEqual(await bridge.readFile('C:\\x'), new Uint8Array([1, 2, 3]));
  } finally {
    delete globalThis.__TAURI__;
  }
});
