// End to end on Windows (CI runs it on windows-latest) against the mock relay, with a Receiver from daylight-share.js
// playing the Daylight:
//
//   1. installs Send-to-Daylight-windows-setup.exe silently (per user, no admin) and checks what the installer set up:
//      the app, File Explorer's Send to > Daylight shortcut and the daylightshare: link scheme;
//   2. deletes the shortcut, then starts the installed app in test mode (--e2e-pair <link> --e2e-status <file>): it
//      pairs without showing anything, writes its outbox to the status file as it changes, and (first run) puts the
//      Send to shortcut back;
//   3. starts the app a second time with two files as arguments, exactly as the Send to shortcut does (the running app
//      gets them through the single-instance plugin);
//   4. puts a link on the clipboard and starts the app with --e2e-hotkey, which takes the hotkey's code path;
//   5. checks that the Receiver got all three items intact and the status file shows them Delivered;
//   6. starts it once more without arguments (the window opens; screenshot), quits it, uninstalls silently and checks
//      that the shortcut and the link scheme are gone.
//
//   node test/e2e/windows.e2e.mjs --installer out/Send-to-Daylight-windows-setup.exe
//   node test/e2e/windows.e2e.mjs --exe src-tauri/target/release/send-to-daylight.exe     (no install/uninstall)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const ds = await import(pathToFileURL(path.join(root, '..', 'share', 'js', 'daylight-share.js')).href);

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const installer = arg('installer') && path.resolve(arg('installer'));
const OUT = path.resolve(arg('out') ?? path.join(root, 'test-results'));
const APPDATA = process.env.APPDATA;
const LOCALAPPDATA = process.env.LOCALAPPDATA;
const INSTALL_DIR = path.join(LOCALAPPDATA, 'Send to Daylight');
const EXE = installer ? path.join(INSTALL_DIR, 'send-to-daylight.exe') : path.resolve(arg('exe') ?? '');
const SENDTO = path.join(APPDATA, 'Microsoft', 'Windows', 'SendTo', 'Daylight.lnk');
const DATA_DIR = path.join(APPDATA, 'com.daylight.share.windows');
const SCHEME_KEY = 'HKCU\\Software\\Classes\\daylightshare\\shell\\open\\command';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const CLIP_URL = 'https://example.com/e2e/clipboard?from=windows&n=1';

if (process.platform !== 'win32') { console.error('This test runs on Windows.'); process.exit(2); }
if (!installer && !arg('exe')) { console.error('Pass --installer <setup.exe> or --exe <app.exe>.'); process.exit(2); }

fs.mkdirSync(OUT, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-e2e-'));
const statusFile = path.join(work, 'status.json');
const checks = [];
let failed = false;
let appProc = null;
let relay = null;

function step(name) { console.log(`\n== ${name}`); }
function check(ok, what, detail = '') {
  checks.push({ ok: !!ok, what, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed = true;
  return !!ok;
}
function must(ok, what, detail) { if (!check(ok, what, detail)) throw new Error(`failed: ${what}${detail ? ` (${detail})` : ''}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, fn, { timeout = 60000, every = 250 } = {}) {
  const until = Date.now() + timeout;
  let last;
  for (;;) {
    try { last = await fn(); } catch (e) { if (e.fatal) throw e; last = e; }
    if (last && !(last instanceof Error)) return last;
    if (Date.now() > until) throw new Error(`timed out after ${timeout / 1000} s waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
    await sleep(every);
  }
}

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8' }).trim();
}

function regValue(key, name) {
  const r = spawnSync('reg', ['query', key, ...(name ? ['/v', name] : ['/ve'])], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

function readStatus() {
  try { return JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch { return null; }
}

/** Starts the app the way Explorer or a browser would: a new process with arguments. -> its exit code. */
function launchAgain(args, what) {
  const r = spawnSync(EXE, args, { timeout: 60000, windowsHide: false });
  check(r.status === 0 && !r.error, `${what}: the second launch hands over and exits`, r.error ? String(r.error) : `exit ${r.status}`);
  return r.status;
}

function tinyPdf(fillerBytes) {
  const filler = Buffer.from(ds.randomBytes(fillerBytes)).toString('base64');
  const content = 'BT /F1 18 Tf 24 72 Td (Quiet paper: Send to Daylight on Windows) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${filler.length} >>\nstream\n${filler}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function screenshot(file) {
  try {
    ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; `
      + `$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); `
      + `$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); $bmp.Save('${file}'); $g.Dispose(); $bmp.Dispose()`);
    console.log(`screenshot: ${file}`);
  } catch (e) { console.log(`(no screenshot: ${String(e.message).split('\n')[0]})`); }
}

function killApp() {
  if (appProc?.pid) spawnSync('taskkill', ['/PID', String(appProc.pid), '/T', '/F'], { stdio: 'ignore' });
  spawnSync('taskkill', ['/IM', 'send-to-daylight.exe', '/T', '/F'], { stdio: 'ignore' });
}

function diagnostics() {
  console.log('\n--- diagnostics');
  console.log('app log:', fs.existsSync(`${statusFile}.log`) ? fs.readFileSync(`${statusFile}.log`, 'utf8') : '(none)');
  console.log('status file:', fs.existsSync(statusFile) ? fs.readFileSync(statusFile, 'utf8') : '(none)');
  console.log(spawnSync('tasklist', ['/FI', 'IMAGENAME eq send-to-daylight.exe'], { encoding: 'utf8' }).stdout);
  try { console.log('data folder:', fs.readdirSync(DATA_DIR, { recursive: true }).join(', ')); } catch { console.log('data folder: (none)'); }
  if (relay) console.log('relay requests:', relay.state.requests.slice(-30).join('\n  '));
}

async function main() {
  // --- 1. install -------------------------------------------------------------------------------------------------
  if (installer) {
    step('Install silently (per user)');
    const r = spawnSync(installer, ['/S'], { timeout: 240000, stdio: 'inherit' });
    must(r.status === 0, 'the installer finishes', r.error ? String(r.error) : `exit ${r.status}`);
    await waitFor('the installed app', () => fs.existsSync(EXE), { timeout: 60000 });
    check(true, `installed ${EXE}`);
    check(fs.existsSync(SENDTO), 'the installer adds Send to > Daylight', SENDTO);
    const scheme = regValue(SCHEME_KEY);
    check(scheme && scheme.toLowerCase().includes(EXE.toLowerCase()), 'the installer registers daylightshare: links', (scheme ?? 'missing').trim().split('\n').pop());
    check(fs.existsSync(path.join(INSTALL_DIR, 'uninstall.exe')), 'an uninstaller is in place');
  }
  must(fs.existsSync(EXE), 'the app exists', EXE);

  // --- 2. start in test mode and pair ------------------------------------------------------------------------------
  step('Start the app in test mode; it pairs with the mock Daylight');
  fs.rmSync(SENDTO, { force: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  relay = await startMockRelay();
  const secret = ds.generateSecret();
  const link = await ds.pairingLink({ secret, relay: relay.url, name: 'Test Daylight' });
  const receiver = new ds.Receiver({ pairing: { secret, relay: relay.url }, storage: new ds.MemoryStorage(), from: 'Test Daylight' });
  const received = [];
  let polling = true;
  const pollLoop = (async () => {
    while (polling) {
      try { received.push(...(await receiver.pollOnce()).items); } catch (e) { console.log(`receiver: ${e.message}`); }
      await sleep(400);
    }
  })();

  appProc = spawn(EXE, ['--e2e-pair', link, '--e2e-status', statusFile], { detached: true, stdio: 'ignore' });
  appProc.unref();
  const paired = await waitFor('the app to pair (status file)', () => {
    const s = readStatus();
    if (s?.bootError) throw Object.assign(new Error(`the window's page failed to start: ${s.bootError}`), { fatal: true });
    return s?.paired && s;
  }, { timeout: 120000 });
  check(paired.name === 'Test Daylight' && paired.relay === relay.url, 'paired headlessly from the pairing link', `${paired.name} at ${paired.relay}`);
  check(paired.version && paired.version !== '0', 'reports its version', paired.version);
  console.log(`hotkey: ${JSON.stringify(paired.hotkey)}`);
  check(paired.hotkey?.accel === 'Ctrl+Alt+D' || !!paired.hotkey?.error, 'the clipboard hotkey was registered (or says why not)', JSON.stringify(paired.hotkey));

  await waitFor('the Send to shortcut', () => fs.existsSync(SENDTO), { timeout: 20000 }).catch(() => {});
  check(fs.existsSync(SENDTO), 'the first run creates Send to > Daylight', SENDTO);
  let target = '';
  try { target = ps(`(New-Object -ComObject WScript.Shell).CreateShortcut('${SENDTO.replace(/'/g, "''")}').TargetPath`); } catch (e) { target = `error: ${e.message}`; }
  check(target.toLowerCase() === EXE.toLowerCase(), 'the shortcut points at the app', target);
  check(regValue(SCHEME_KEY)?.toLowerCase().includes(EXE.toLowerCase()), 'daylightshare: links open the app');

  // --- 3. Send To: a second launch with file arguments ---------------------------------------------------------------
  step('Send to > Daylight: the app started again with two files as arguments');
  const pdfPath = path.join(work, 'Quiet paper – draft.pdf');
  const txtPath = path.join(work, 'Field notes ✓.txt');
  const pdf = tinyPdf(120_000);
  const txt = Buffer.from('Field notes from Windows ✓ ünïcödé\r\n'.repeat(300), 'utf8');
  fs.writeFileSync(pdfPath, pdf);
  fs.writeFileSync(txtPath, txt);
  launchAgain([pdfPath, txtPath], 'Send To');
  const files = await waitFor('the Daylight to receive both files', () => {
    const f = received.filter((i) => i.header.kind === 'file');
    return f.length >= 2 && f;
  }, { timeout: 90000 });
  const gotPdf = files.find((i) => i.header.name === 'Quiet paper – draft.pdf');
  const gotTxt = files.find((i) => i.header.name === 'Field notes ✓.txt');
  check(gotPdf && Buffer.from(gotPdf.content).equals(pdf), 'the PDF arrives intact', gotPdf ? `${gotPdf.content.length} bytes, ${gotPdf.header.mime}` : `got ${files.map((f) => f.header.name)}`);
  check(gotPdf?.header.mime === 'application/pdf' && gotPdf?.header.title === 'Quiet paper – draft', 'with its name, type and title');
  check(gotTxt && Buffer.from(gotTxt.content).equals(txt), 'the text file arrives intact', gotTxt ? `${gotTxt.content.length} bytes, enc ${gotTxt.header.enc}` : '');
  check(gotPdf?.header.from === 'Windows PC' && /^windows\//.test(gotPdf?.header.app ?? ''), 'sent from "Windows PC"', `${gotPdf?.header.from} ${gotPdf?.header.app}`);

  // --- 4. the clipboard hotkey's path ------------------------------------------------------------------------------
  step('Clipboard hotkey: a link on the clipboard, then the hotkey path (test hook --e2e-hotkey)');
  ps(`Set-Clipboard -Value '${CLIP_URL}'`);
  const clip = ps('Get-Clipboard');
  check(clip === CLIP_URL, 'the clipboard holds the link', clip);
  launchAgain(['--e2e-hotkey'], 'hotkey hook');
  const url = await waitFor('the Daylight to receive the link', () => received.find((i) => i.header.kind === 'url'), { timeout: 90000 });
  check(url.header.url === CLIP_URL, 'the clipboard link arrives', url.header.url);

  // --- 5. acks: Delivered ✓ ------------------------------------------------------------------------------------------
  step('Acks: the status file shows all three Delivered');
  const done = await waitFor('Delivered for all three items', () => {
    const s = readStatus();
    const rows = s?.rows ?? [];
    return rows.length >= 3 && rows.every((r) => r.status === 'delivered') && s;
  }, { timeout: 150000, every: 1000 });
  for (const r of done.rows) check(r.status === 'delivered', `Delivered: ${r.kind} ${r.name || r.url}`);
  check(done.rows.length === 3, 'exactly three items in the history', String(done.rows.length));
  check(received.length === 3, 'the Daylight got each item once', String(received.length));

  // --- 6. window, quit, uninstall ----------------------------------------------------------------------------------
  step('A plain second launch opens the window');
  launchAgain([], 'plain launch');
  const visible = await waitFor('a visible "Send to Daylight" window', () => {
    const n = ps("@(Get-Process send-to-daylight -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'Send to Daylight' }).Count");
    return Number(n) > 0 && n;
  }, { timeout: 20000, every: 500 }).catch(() => '0');
  check(Number(visible) > 0, 'the window opens', `${visible} visible`);
  await sleep(1500);
  await screenshot(path.join(OUT, 'window.png'));
  check(readStatus()?.view === 'view-send', 'it shows the send view', readStatus()?.view);

  polling = false;
  await pollLoop;
  killApp();
  await sleep(1500);

  if (installer) {
    step('Uninstall silently');
    const un = spawnSync(path.join(INSTALL_DIR, 'uninstall.exe'), ['/S'], { timeout: 120000 });
    check(un.status === 0, 'the uninstaller starts', `exit ${un.status}`);
    await waitFor('the app to be removed', () => !fs.existsSync(EXE), { timeout: 90000 }).catch(() => {});
    check(!fs.existsSync(EXE), 'the app is removed');
    await waitFor('the Send to shortcut to go', () => !fs.existsSync(SENDTO), { timeout: 30000 }).catch(() => {});
    check(!fs.existsSync(SENDTO), 'Send to > Daylight is removed');
    check(!regValue(SCHEME_KEY), 'the daylightshare: scheme is removed');
    check(!regValue(RUN_KEY, 'Send to Daylight'), 'no start-at-login entry is left');
  }
}

try {
  await main();
} catch (e) {
  failed = true;
  console.log(`\nFAIL ${e.message}`);
  diagnostics();
} finally {
  killApp();
  if (fs.existsSync(statusFile)) fs.copyFileSync(statusFile, path.join(OUT, 'status.json'));
  if (fs.existsSync(`${statusFile}.log`)) {
    fs.copyFileSync(`${statusFile}.log`, path.join(OUT, 'app.log'));
    console.log(`\n--- app log\n${fs.readFileSync(`${statusFile}.log`, 'utf8')}`);
  }
  fs.writeFileSync(path.join(OUT, 'e2e-summary.json'), JSON.stringify({ failed, checks }, null, 2));
  await relay?.close();
  console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed${failed ? ' — FAILED' : ''}`);
  process.exit(failed ? 1 : 0);
}
