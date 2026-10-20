// End to end on Windows (CI runs it on windows-latest) against the mock relay, with Receivers from daylight-share.js
// playing the Daylight:
//
//   1. installs Send-to-Daylight-windows-setup.exe silently (per user, no admin) and checks what the installer set up:
//      the app, File Explorer's Send to > Daylight shortcut and the daylightshare: link scheme;
//   2. deletes the shortcut and the data folder, then starts the app the way a clicked pairing link does when it isn't
//      running (`exe "daylightshare://pair?…"`, plus --e2e-status <file>: it writes its state to the file as it
//      changes). It must ask first, in the protocol module's words ("Code starts …", the relay), pair nothing before
//      the answer, and stay unpaired on Cancel (--e2e-cancel, a test hook that presses the button). The first run puts
//      the Send to shortcut back;
//   3. opens the same link again while it runs (a second launch, forwarded by the single-instance plugin), and answers
//      Pair (--e2e-confirm);
//   4. starts the app again with files as arguments, exactly as the Send to shortcut does: a PDF, a text file, a 3 MB
//      file (over the relay's 2 MB attachment limit) and one over the protocol's size limit, which is refused with the
//      library's sentence;
//   5. puts a link on the clipboard and starts the app with --e2e-hotkey, which takes the hotkey's code path;
//   6. checks that the Receiver got the four items intact and the status file shows them Delivered;
//   7. opens another Daylight's link with the same name: the question names the other code and says it replaces this
//      one; Cancel keeps the pairing and the history;
//   8. opens the paired Daylight's link with a new relay and name: applied without asking ("Pairing updated: now
//      sending through …"), the history kept, and a file sent next goes through the new relay and is acked there;
//   9. turns on start at login with --e2e-autostart (what the tray menu's switch does) and checks the Run entry;
//  10. restarts the app: the pairing, the history and start at login come back;
//  11. zero-fills outbox.json (what a power cut can leave) and deletes the Run entry, then restarts: the app starts,
//      sets the file aside, says so, puts the Run entry back, and Send To still works;
//  12. updates the default way, "Uninstall before installing" (the old uninstaller, then the installer): the Run entry,
//      the pairing and the history survive;
//  13. starts it once more without arguments (the window opens; screenshot), quits it, uninstalls silently and checks
//      that the shortcut, the link scheme and the start-at-login entry are gone.
//
//   node test/e2e/windows.e2e.mjs --installer out/Send-to-Daylight-windows-setup.exe
//   node test/e2e/windows.e2e.mjs --exe src-tauri/target/release/send-to-daylight.exe     (no install, update, uninstall)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
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
const STORE = path.join(DATA_DIR, 'store');
const AUTOSTART_MARKER = path.join(DATA_DIR, 'start-at-login');
const SCHEME_KEY = 'HKCU\\Software\\Classes\\daylightshare\\shell\\open\\command';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const MACHINE_RUN_KEY = 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
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
let relay2 = null;

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

/** Waits for the status file to satisfy pred; a page that failed to start ends the test at once. */
function waitStatus(what, pred, opts = {}) {
  return waitFor(what, () => {
    const s = readStatus();
    if (s?.bootError) throw Object.assign(new Error(`the window's page failed to start: ${s.bootError}`), { fatal: true });
    return s && pred(s) && s;
  }, { timeout: 60000, ...opts });
}

/** Starts the app (not running yet) with these arguments, detached, as Windows would. */
function startApp(args) {
  appProc = spawn(EXE, args, { detached: true, stdio: 'ignore' });
  appProc.unref();
}

/** The app's process is gone (so the next launch starts a new one rather than handing over to a dying one). */
async function waitGone() {
  await waitFor('the app to exit', () => !spawnSync('tasklist', ['/FI', 'IMAGENAME eq send-to-daylight.exe', '/NH'], { encoding: 'utf8' })
    .stdout.toLowerCase().includes('send-to-daylight.exe'), { timeout: 20000, every: 300 });
}

/** Quits the app, then starts it again in test mode with a fresh status file. -> its first status. */
async function restartApp(what, extra = []) {
  killApp();
  await waitGone();
  fs.rmSync(statusFile, { force: true });
  startApp([...extra, '--e2e-status', statusFile]);
  return waitStatus(what, (s) => s.view === 'view-send' || s.view === 'view-pair' || s.view === 'view-confirm', { timeout: 120000 });
}

const confirmOf = (c) => ({ title: c.title, lines: c.lines, button: c.button });
const allDelivered = (s, n) => s.rows?.length === n && s.rows.every((r) => r.status === 'delivered');
const runEntry = () => (regValue(RUN_KEY, 'Send to Daylight') ?? '').trim().split('\n').pop().trim();
const runEntryOk = (line) => line.toLowerCase().endsWith(`"${EXE}" --autostart`.toLowerCase());

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
  if (relay2) console.log('relay 2 requests:', relay2.state.requests.slice(-30).join('\n  '));
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

  // --- 2. a pairing link starts the app: it asks first; Cancel ------------------------------------------------------
  step('A clicked pairing link starts the app: it asks first, in the protocol’s words; Cancel leaves it unpaired');
  fs.rmSync(SENDTO, { force: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  spawnSync('reg', ['delete', RUN_KEY, '/v', 'Send to Daylight', '/f'], { stdio: 'ignore' }); // from an earlier local run
  relay = await startMockRelay();
  relay2 = await startMockRelay(); // where the Daylight moves in step 8
  const secret = ds.generateSecret();
  const code = await ds.formatCode(secret);
  const link = await ds.pairingLink({ secret, relay: relay.url, name: 'Test Daylight' });
  const receivers = [relay, relay2].map((r) => new ds.Receiver({ pairing: { secret, relay: r.url }, storage: new ds.MemoryStorage(), from: 'Test Daylight' }));
  const received = [];
  let polling = true;
  const pollLoop = (async () => {
    while (polling) {
      for (const [i, rc] of receivers.entries()) {
        try { received.push(...(await rc.pollOnce()).items.map((it) => Object.assign(it, { via: i + 1 }))); } catch (e) { console.log(`receiver ${i + 1}: ${e.message}`); }
      }
      await sleep(400);
    }
  })();

  startApp([link, '--e2e-status', statusFile]);
  const asked = await waitStatus('the pairing question', (s) => s.view === 'view-confirm', { timeout: 120000 });
  const expectFirst = confirmOf(ds.pairingConfirmation(null, await ds.parsePairing(link), { source: 'link' }));
  check(isDeepStrictEqual(asked.confirm, expectFirst), 'it asks before pairing, in the module’s words', JSON.stringify(asked.confirm));
  check(asked.confirm?.lines?.[0] === `Code starts ${code.slice(0, 4)}. Check it matches the code on your Daylight.`, 'the question shows the code’s first group');
  check(asked.confirm?.lines?.includes(`Sends through ${ds.relayHost(relay.url)}.`), 'and the relay, which isn’t ntfy.sh');
  check(asked.confirm?.button === 'Pair', 'its button reads Pair', asked.confirm?.button);
  await sleep(1500);
  check(readStatus()?.paired === false, 'nothing is paired before the answer');
  check(asked.version && asked.version !== '0', 'reports its version', asked.version);
  console.log(`hotkey: ${JSON.stringify(asked.hotkey)}`);
  check(asked.hotkey?.accel === 'Ctrl+Alt+D' || !!asked.hotkey?.error, 'the clipboard hotkey was registered (or says why not)', JSON.stringify(asked.hotkey));

  await waitFor('the Send to shortcut', () => fs.existsSync(SENDTO), { timeout: 20000 }).catch(() => {});
  check(fs.existsSync(SENDTO), 'the first run creates Send to > Daylight', SENDTO);
  let target = '';
  try { target = ps(`(New-Object -ComObject WScript.Shell).CreateShortcut('${SENDTO.replace(/'/g, "''")}').TargetPath`); } catch (e) { target = `error: ${e.message}`; }
  check(target.toLowerCase() === EXE.toLowerCase(), 'the shortcut points at the app', target);
  check(regValue(SCHEME_KEY)?.toLowerCase().includes(EXE.toLowerCase()), 'daylightshare: links open the app');

  launchAgain(['--e2e-cancel'], 'Cancel (test hook)');
  const cancelled = await waitStatus('the pairing screen again', (s) => s.view === 'view-pair');
  check(!cancelled.paired && !cancelled.confirm, 'Cancel leaves it unpaired, on the pairing screen');

  // --- 3. the same link while it runs: Pair -------------------------------------------------------------------------
  step('The link clicked again while it runs (a second launch hands it over): Pair');
  launchAgain([link], 'pairing link');
  const asked2 = await waitStatus('the pairing question', (s) => s.view === 'view-confirm');
  check(isDeepStrictEqual(asked2.confirm, expectFirst), 'the running app asks the same', JSON.stringify(asked2.confirm));
  launchAgain(['--e2e-confirm'], 'Pair (test hook)');
  const paired = await waitStatus('the app to pair', (s) => s.paired);
  check(paired.name === 'Test Daylight' && paired.relay === relay.url && paired.codeStart === code.slice(0, 4),
    'paired with the link’s Daylight once confirmed', `${paired.name} at ${paired.relay}, code ${paired.codeStart}`);
  await waitStatus('the send view', (s) => s.view === 'view-send', { timeout: 10000 }).catch(() => {});
  check(readStatus()?.view === 'view-send', 'it shows the send view', readStatus()?.view);

  // --- 4. Send To: a second launch with file arguments ---------------------------------------------------------------
  step('Send to > Daylight: the app started again with files as arguments');
  const pdfPath = path.join(work, 'Quiet paper – draft.pdf');
  const txtPath = path.join(work, 'Field notes ✓.txt');
  const bigPath = path.join(work, 'Scan 3 MB.pdf');
  const hugePath = path.join(work, 'Too big.pdf');
  const pdf = tinyPdf(120_000);
  const txt = Buffer.from('Field notes from Windows ✓ ünïcödé\r\n'.repeat(300), 'utf8');
  // Over the free relay's 2 MB attachment limit: protocol 1.1 sends it in pieces that fit.
  const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(ds.randomBytes(3 * 1024 * 1024))]);
  // Over the protocol's own limit: refused before it is read, in the library's words.
  const limit = Number.isFinite(ds.MAX_ITEM) ? ds.MAX_ITEM : 64 * 1024 * 1024;
  const hugeSize = limit + 1000;
  const tooBigText = typeof ds.tooBigMessage === 'function' ? ds.tooBigMessage(hugeSize) : 'That file is larger than 64 MB.';
  fs.writeFileSync(pdfPath, pdf);
  fs.writeFileSync(txtPath, txt);
  fs.writeFileSync(bigPath, big);
  fs.writeFileSync(hugePath, Buffer.alloc(hugeSize, 7));
  launchAgain([pdfPath, txtPath, bigPath, hugePath], 'Send To');
  const files = await waitFor('the Daylight to receive three files', () => {
    const f = received.filter((i) => i.header.kind === 'file');
    return f.length >= 3 && f;
  }, { timeout: 120000 });
  const gotPdf = files.find((i) => i.header.name === 'Quiet paper – draft.pdf');
  const gotTxt = files.find((i) => i.header.name === 'Field notes ✓.txt');
  const gotBig = files.find((i) => i.header.name === 'Scan 3 MB.pdf');
  check(gotPdf && Buffer.from(gotPdf.content).equals(pdf), 'the PDF arrives intact', gotPdf ? `${gotPdf.content.length} bytes, ${gotPdf.header.mime}` : `got ${files.map((f) => f.header.name)}`);
  check(gotPdf?.header.mime === 'application/pdf' && gotPdf?.header.title === 'Quiet paper – draft', 'with its name, type and title');
  check(gotTxt && Buffer.from(gotTxt.content).equals(txt), 'the text file arrives intact', gotTxt ? `${gotTxt.content.length} bytes, enc ${gotTxt.header.enc}` : '');
  check(gotBig && Buffer.from(gotBig.content).equals(big), 'a 3 MB file arrives intact (over the relay’s 2 MB attachment limit)', gotBig ? `${gotBig.content.length} bytes` : '');
  check(files.every((f) => f.via === 1), 'through the paired relay');
  check(gotPdf?.header.from === 'Windows PC' && /^windows\//.test(gotPdf?.header.app ?? ''), 'sent from "Windows PC"', `${gotPdf?.header.from} ${gotPdf?.header.app}`);
  const refused = await waitFor('the too-big file to be refused', () => (readStatus()?.log ?? []).find((l) => l.includes('not sent Too big.pdf')), { timeout: 30000 }).catch(() => '');
  check(refused.endsWith(tooBigText), 'a file over the protocol’s limit is refused, saying why', refused.replace(/^\S+ /, ''));

  // --- 5. the clipboard hotkey's path ------------------------------------------------------------------------------
  step('Clipboard hotkey: a link on the clipboard, then the hotkey path (test hook --e2e-hotkey)');
  ps(`Set-Clipboard -Value '${CLIP_URL}'`);
  const clip = ps('Get-Clipboard');
  check(clip === CLIP_URL, 'the clipboard holds the link', clip);
  launchAgain(['--e2e-hotkey'], 'hotkey hook');
  const url = await waitFor('the Daylight to receive the link', () => received.find((i) => i.header.kind === 'url'), { timeout: 90000 });
  check(url.header.url === CLIP_URL, 'the clipboard link arrives', url.header.url);

  // --- 6. acks: Delivered ✓ ------------------------------------------------------------------------------------------
  step('Acks: the status file shows all four Delivered');
  const done = await waitStatus('Delivered for all four items', (s) => (s.rows ?? []).length >= 4 && s.rows.every((r) => r.status === 'delivered'),
    { timeout: 150000, every: 1000 });
  for (const r of done.rows) check(r.status === 'delivered', `Delivered: ${r.kind} ${r.name || r.url}`);
  check(done.rows.length === 4, 'exactly four items in the history (the refused one isn’t)', String(done.rows.length));
  check(received.length === 4, 'the Daylight got each item once', String(received.length));
  const ids = done.rows.map((r) => r.id);

  // --- 7. another Daylight's link: asks, Cancel keeps everything ------------------------------------------------------
  step('Another Daylight’s link, with the same name: it asks and says it replaces this one; Cancel keeps everything');
  const other = ds.generateSecret();
  const otherCode = await ds.formatCode(other);
  const otherLink = await ds.pairingLink({ secret: other, relay: relay.url, name: 'Test Daylight' });
  launchAgain([otherLink], 'another Daylight’s link');
  const asked3 = await waitStatus('the switch question', (s) => s.view === 'view-confirm');
  const expectSwitch = confirmOf(ds.pairingConfirmation({ secret, relay: relay.url, name: 'Test Daylight' }, await ds.parsePairing(otherLink), { source: 'link' }));
  check(isDeepStrictEqual(asked3.confirm, expectSwitch), 'it asks in the module’s words', JSON.stringify(asked3.confirm));
  check(asked3.confirm?.lines?.[0]?.startsWith(`Code starts ${otherCode.slice(0, 4)}.`) && asked3.confirm?.button === 'Switch'
    && asked3.confirm?.lines?.includes('This replaces Test Daylight. Items not yet delivered to it will not be sent.'),
  'names the other code, says it replaces this Daylight, and its button reads Switch');
  launchAgain(['--e2e-cancel'], 'Cancel (test hook)');
  const kept = await waitStatus('the send view again', (s) => s.view === 'view-send');
  check(kept.paired && kept.codeStart === code.slice(0, 4) && kept.relay === relay.url && kept.name === 'Test Daylight', 'Cancel keeps the pairing', `${kept.name}, code ${kept.codeStart}`);
  check(isDeepStrictEqual(kept.rows.map((r) => r.id), ids), 'and the history');

  // --- 8. the same Daylight on another relay, renamed ---------------------------------------------------------------
  step('The paired Daylight’s link with a new relay and name: applied without asking; the history kept');
  const movedLink = await ds.pairingLink({ secret, relay: relay2.url, name: 'Desk Daylight' });
  const notice = ds.pairingConfirmation({ secret, relay: relay.url }, await ds.parsePairing(movedLink), { source: 'link' }).notice;
  launchAgain([movedLink], 'the moved Daylight’s link');
  const moved = await waitStatus('the new relay and its notice', (s) => s.relay === relay2.url && s.statusText === notice, { timeout: 30000 })
    .catch(() => readStatus() ?? {});
  check(moved.relay === relay2.url && moved.view === 'view-send' && !moved.confirm, 'no question for the same Daylight', `${moved.relay}, ${moved.view}`);
  check(moved.statusText === notice, 'the window says so in the module’s words', moved.statusText);
  check(moved.name === 'Desk Daylight', 'the new name is saved and shown', moved.name);
  check(isDeepStrictEqual((moved.rows ?? []).map((r) => r.id), ids), 'the history is kept (same secret)');
  const afterPath = path.join(work, 'After the move.txt');
  const afterBytes = Buffer.from('Sent through the new relay ✓\n'.repeat(40), 'utf8');
  fs.writeFileSync(afterPath, afterBytes);
  launchAgain([afterPath], 'Send To after the move');
  const after = await waitFor('the Daylight to receive it', () => received.find((i) => i.header.name === 'After the move.txt'), { timeout: 90000 });
  check(after.via === 2 && Buffer.from(after.content).equals(afterBytes), 'a file sent next goes through the new relay, intact', `via relay ${after.via}`);
  const five = await waitStatus('Delivered through the new relay', (s) => allDelivered(s, 5), { timeout: 120000, every: 1000 }).catch(() => readStatus());
  check(allDelivered(five, 5), 'and is acked there: five Delivered', JSON.stringify(five?.rows?.map((r) => r.status)));

  // --- 9. start at login ------------------------------------------------------------------------------------------
  step('Start at login: the tray menu’s switch (test hook --e2e-autostart)');
  check(!regValue(RUN_KEY, 'Send to Daylight'), 'off by default');
  launchAgain(['--e2e-autostart'], 'start-at-login hook');
  await waitFor('the start-at-login entry', () => regValue(RUN_KEY, 'Send to Daylight'), { timeout: 20000 }).catch(() => '');
  check(runEntryOk(runEntry()), 'this user’s Run entry starts the app quietly, its path quoted', runEntry());
  check(!regValue(MACHINE_RUN_KEY, 'Send to Daylight'), 'not for every user (the runner is elevated, where the plugin alone writes HKLM)');
  const heard = await waitFor('the window to show it on', () => readStatus()?.autostart === true, { timeout: 15000 }).catch(() => false);
  check(heard, 'Settings shows Start at login on');
  check(fs.existsSync(AUTOSTART_MARKER), 'the choice is kept in the data folder too', AUTOSTART_MARKER);

  // --- 10. restart ---------------------------------------------------------------------------------------------------
  step('Restart: the pairing, the history and start at login come back');
  const back = await restartApp('the app to start again');
  check(back.paired && back.name === 'Desk Daylight' && back.relay === relay2.url && back.codeStart === code.slice(0, 4),
    'the pairing is kept', `${back.name} at ${back.relay}`);
  check(back.view === 'view-send', 'it shows the send view', back.view);
  check(allDelivered(back, 5), 'the five rows are kept, Delivered', JSON.stringify(back.rows?.map((r) => r.status)));
  check(back.autostart === true, 'start at login is still on');

  // --- 11. a damaged outbox and a missing Run entry ----------------------------------------------------------------------
  step('A zero-filled outbox.json (as a power cut can leave it) and no Run entry: the app starts and carries on');
  killApp();
  await waitGone();
  fs.writeFileSync(path.join(STORE, 'outbox.json'), Buffer.alloc(4096));
  spawnSync('reg', ['delete', RUN_KEY, '/v', 'Send to Daylight', '/f'], { stdio: 'ignore' });
  check(!regValue(RUN_KEY, 'Send to Daylight'), 'the Run entry is gone (what an update’s uninstall step does)');
  const damaged = await restartApp('the app to start over the damage');
  await waitStatus('it to say so', (s) => /history couldn’t be read/.test(s.statusText ?? ''), { timeout: 10000 }).catch(() => {});
  const d = readStatus() ?? damaged;
  check(d.view === 'view-send' && d.paired, 'it starts and shows the send view, still paired', d.view);
  check(d.rows?.length === 0, 'the history starts afresh', String(d.rows?.length));
  check(fs.existsSync(path.join(STORE, 'outbox.json.bad')), 'the damaged file is set aside');
  check(/history couldn’t be read/.test(d.statusText ?? ''), 'the window says so', d.statusText);
  await waitFor('the Run entry to come back', () => regValue(RUN_KEY, 'Send to Daylight'), { timeout: 15000 }).catch(() => '');
  check(runEntryOk(runEntry()), 'the app puts its Run entry back (the user had start at login on)', runEntry());
  const latePath = path.join(work, 'After the damage.txt');
  const lateBytes = Buffer.from('Still sending ✓\n', 'utf8');
  fs.writeFileSync(latePath, lateBytes);
  launchAgain([latePath], 'Send To after the damage');
  const late = await waitFor('the Daylight to receive it', () => received.find((i) => i.header.name === 'After the damage.txt'), { timeout: 90000 }).catch(() => null);
  check(late && Buffer.from(late.content).equals(lateBytes), 'Send To still works');
  const one = await waitStatus('Delivered', (s) => allDelivered(s, 1), { timeout: 120000, every: 1000 }).catch(() => readStatus());
  check(allDelivered(one, 1), 'and it is Delivered', JSON.stringify(one?.rows?.map((r) => r.status)));

  // --- 12. update the default way ------------------------------------------------------------------------------------
  if (installer) {
    step('Update the default way, "Uninstall before installing": start at login, the pairing and the history survive');
    killApp();
    await waitGone();
    // What the installer's reinstall page runs: the old uninstaller, without /UPDATE, keeping the data (the box to
    // delete it is unticked); then the install. Silent here, so the uninstaller finishes on its own: wait for it.
    const un = spawnSync(path.join(INSTALL_DIR, 'uninstall.exe'), ['/S'], { timeout: 120000 });
    check(un.status === 0, 'the old uninstaller runs', `exit ${un.status}`);
    await waitFor('the uninstall to finish', () => !fs.existsSync(EXE) && !fs.existsSync(SENDTO), { timeout: 90000 }).catch(() => {});
    check(!regValue(RUN_KEY, 'Send to Daylight'), 'it removes the Run entry (as it always has)');
    check(fs.existsSync(AUTOSTART_MARKER) && fs.existsSync(path.join(STORE, 'pairing.json')), 'and keeps the data folder');
    const re = spawnSync(installer, ['/S'], { timeout: 240000, stdio: 'inherit' });
    must(re.status === 0, 'the new installer finishes', re.error ? String(re.error) : `exit ${re.status}`);
    await waitFor('the installed app', () => fs.existsSync(EXE), { timeout: 60000 });
    check(runEntryOk(runEntry()), 'the installer puts the Run entry back', runEntry());
    check(fs.existsSync(SENDTO), 'and Send to > Daylight');
    const updated = await restartApp('the updated app to start');
    check(updated.paired && updated.name === 'Desk Daylight' && allDelivered(updated, 1), 'the pairing and the history are kept', `${updated.name}, ${updated.rows?.length} rows`);
    check(updated.autostart === true, 'start at login is on');
  }

  // --- 13. window, quit, uninstall ---------------------------------------------------------------------------------
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
    check(!regValue(RUN_KEY, 'Send to Daylight') && !regValue(MACHINE_RUN_KEY, 'Send to Daylight'), 'no start-at-login entry is left');
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
  await relay2?.close();
  console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed${failed ? ' — FAILED' : ''}`);
  process.exit(failed ? 1 : 0);
}
