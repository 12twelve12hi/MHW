#!/usr/bin/env node
// daylight-send: send links and files to a Daylight from the command line (LAB-PLAN F09; ../../SEND-API.md).
// Node 22 and nothing else once built: js/bin/build.mjs bundles this file with daylight-share.js, daylight-lab.js and
// cli-store.mjs into one file, dist/daylight-send.mjs, which CI publishes to the release.
//
// Every run first does tick() (acks, then re-sends that are due): re-sends happen only when the command runs, so a
// cron line keeps them going (SEND-API.md). The outbox lives in ~/.config/daylight-send/ (DAYLIGHT_SEND_DIR moves it),
// one folder per pairing, and is safe to use from several runs at once (cli-store.mjs).

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ShareError, Sender, parsePairing, sha256, utf8, toHex, concat, webUrl, cleanTitle, cleanName, MAX_ITEM, tooBigMessage,
  relayHost, PROTOCOL_VERSION,
} from '../daylight-share.js';
import {
  LabLedger, labHook, describeLabRow, normaliseShare, LAB_TEXT, fillText, LAB_LEVEL,
} from '../daylight-lab.js';
import { FileStorage, FileLock } from './cli-store.mjs';

const VERSION = '1.0.0';
const APP = `cli/${VERSION}`;
const DEFAULT_WAIT_S = 120;
const EXIT = { ok: 0, other: 1, timeout: 2, refused: 3 };
/** Lab states after which waiting for the Reader ends: in it (or its queue), or handed to it (documents). */
const REACHED = ['reader', 'queued', 'handed'];
const STOPPED = ['inbox', 'failed'];

const USAGE = `daylight-send ${VERSION}: send links and files to your Daylight (Send to Daylight, Lab)

Usage:
  daylight-send <url|file> [--title T] [--json] [--wait[=secs]] [--wait-for reader|delivered] [--pairing <link|code>]
  daylight-send status [<id>] [--json]      the newest item, or the one with this id (or the start of it)
  daylight-send tick [--json]               check for acks and re-send what is due, nothing else
  daylight-send pair <link|code>            save the pairing for later runs

Options:
  --title T          the item's title
  --json             print {"id","status","label",…} on one line
  --wait[=secs]      wait until your Daylight has it (default ${DEFAULT_WAIT_S} s)
  --wait-for STATE   delivered (as --wait) or reader: wait until the Reader has it (needs Lab on your Daylight)
  --pairing P        a pairing link (daylightshare://pair?…) or the code Daylight Share shows
  --from NAME        the sender name your Daylight shows (default: this computer's name)

The pairing comes from --pairing, else DAYLIGHT_PAIRING, else ~/.config/daylight-send/pairing (daylight-send pair).
Every run first checks for acks and re-sends what is due; re-sends happen only when daylight-send runs, so add
"*/15 * * * * daylight-send tick" to your crontab.

Exit codes: 0 sent (with --wait or --wait-for: delivered, or in the Reader); 2 timed out; 3 refused or too big;
1 anything else.`;

class CliError extends Error {
  constructor(code, message, reason = '') { super(message); this.exit = code; this.reason = reason; }
}

function parseArgs(argv) {
  const o = { _: [], json: false, wait: null, waitFor: null, title: null, pairing: null, from: null, help: false, version: false };
  const bad = (m) => { throw new CliError(EXIT.other, `${m}\nRun daylight-send --help for the options.`, 'usage'); };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (name) => {
      if (a.startsWith(name + '=')) return a.slice(name.length + 1);
      if (i + 1 >= argv.length) bad(`${name} needs a value.`);
      return argv[++i];
    };
    if (a === '--') { o._.push(...argv.slice(i + 1)); break; }
    if (a === '--json') o.json = true;
    else if (a === '--wait') o.wait = DEFAULT_WAIT_S;
    else if (a.startsWith('--wait=')) {
      const s = Number(a.slice(7));
      if (!Number.isFinite(s) || s <= 0) bad('--wait takes a number of seconds, as in --wait=60.');
      o.wait = s;
    } else if (a === '--wait-for' || a.startsWith('--wait-for=')) {
      o.waitFor = value('--wait-for');
      if (o.waitFor !== 'reader' && o.waitFor !== 'delivered') bad('--wait-for takes reader or delivered.');
    } else if (a === '--title' || a.startsWith('--title=')) o.title = value('--title');
    else if (a === '--pairing' || a.startsWith('--pairing=')) o.pairing = value('--pairing');
    else if (a === '--from' || a.startsWith('--from=')) o.from = value('--from');
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--version') o.version = true;
    else if (a.startsWith('-') && a.length > 1) bad(`Unknown option ${a}.`);
    else o._.push(a);
  }
  return o;
}

const home = () => process.env.DAYLIGHT_SEND_DIR
  || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'daylight-send');

async function readPairing(o, dir) {
  let src = o.pairing ?? process.env.DAYLIGHT_PAIRING ?? '';
  if (!src) {
    try { src = (await fsp.readFile(path.join(dir, 'pairing'), 'utf8')).trim(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (!src) throw new CliError(EXIT.other, LAB_TEXT.cli.notPaired, 'not-paired');
  try {
    return await parsePairing(src);
  } catch (e) {
    if (e instanceof ShareError) throw new CliError(EXIT.other, e.message, e.code);
    throw e;
  }
}

/** One outbox per pairing: <dir>/outbox-<16 hex of SHA-256("daylight-send/outbox\0" ‖ secret)>. */
async function outboxDir(dir, pairing) {
  const h = toHex(await sha256(concat(utf8('daylight-send/outbox\0'), pairing.secret)));
  return path.join(dir, `outbox-${h.slice(0, 16)}`);
}

async function context(o) {
  const dir = home();
  const pairing = await readPairing(o, dir);
  const storage = new FileStorage(await outboxDir(dir, pairing));
  const ledger = new LabLedger({ storage });
  const from = cleanName(o.from ?? process.env.DAYLIGHT_FROM ?? os.hostname().split('.')[0]);
  const sender = new Sender({ pairing, storage, from, app: APP, onAckHeader: labHook(ledger) });
  const lock = new FileLock(path.join(dir, 'lock'));
  lockForSignals = lock;
  return { dir, pairing, storage, ledger, sender, lock };
}

/** tick() under the lock: acks (the Lab ledger learns from them too), then re-sends; then the ledger is pruned. */
async function tick(ctx) {
  return ctx.lock.run(async () => {
    const r = await ctx.sender.tick();
    await ctx.ledger.prune((await ctx.sender.list()).map((row) => row.id));
    return r;
  });
}

async function view(ctx, row) {
  const snap = await ctx.ledger.snapshot();
  const st = row.status === 'delivered' ? snap.states[row.id] ?? null : null;
  const d = describeLabRow(row, Date.now(), { lab: true, inboxLab: snap.inboxLab, hasCap: snap.hasCap, state: st });
  return {
    id: row.id, status: row.status, label: d.label, sentence: d.sentence, state: st?.s ?? null, stepLine: d.stepLine,
    kind: row.kind, title: row.title || row.name || row.url,
  };
}

/**
 * A row on stdout: one JSON line with --json, else the title (status), label, sentence, step line and id. With
 * failed: true (the run exits 1 or 3) the sentence goes to stderr instead (F09, SEND-API.md), and also to stderr
 * with --json, where it is in the JSON too.
 */
function print(o, v, { withTitle = false, failed = false } = {}) {
  if (o.json) {
    const { id, status, label, sentence, state, kind } = v;
    process.stdout.write(JSON.stringify({ id, status, label, sentence, state, kind }) + '\n');
  } else {
    const lines = [];
    if (withTitle && v.title) lines.push(v.title);
    lines.push(v.label);
    if (v.sentence && !failed) lines.push(v.sentence);
    if (v.stepLine) lines.push(v.stepLine);
    lines.push(`id ${v.id}`);
    process.stdout.write(lines.join('\n') + '\n');
  }
  if (failed && v.sentence) process.stderr.write(v.sentence + '\n');
}

const MIME = {
  pdf: 'application/pdf', epub: 'application/epub+zip', html: 'text/html', htm: 'text/html', xhtml: 'application/xhtml+xml',
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json', csv: 'text/csv',
  mobi: 'application/x-mobipocket-ebook', azw3: 'application/vnd.amazon.ebook', fb2: 'application/x-fictionbook+xml',
  djvu: 'image/vnd.djvu', cbz: 'application/vnd.comicbook+zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', doc: 'application/msword', rtf: 'application/rtf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** A file as an item. Never sends 0 bytes: an empty or unreadable file is an error with its sentence (F09.5). */
async function fileItem(target, o) {
  const A = LAB_TEXT.automation;
  let st;
  try {
    st = await fsp.stat(target);
  } catch (e) {
    throw new CliError(EXIT.other, e.code === 'ENOENT' || e.code === 'ENOTDIR' ? A.notWebAddress : A.unreadableFile, 'file');
  }
  if (!st.isFile()) throw new CliError(EXIT.other, A.unreadableFile, 'file');
  if (st.size > MAX_ITEM) throw new CliError(EXIT.refused, tooBigMessage(st.size), 'too-large');
  let content;
  try { content = new Uint8Array(await fsp.readFile(target)); } catch { throw new CliError(EXIT.other, A.unreadableFile, 'file'); }
  if (content.length === 0) throw new CliError(EXIT.other, A.emptyFile, 'empty');
  if (content.length > MAX_ITEM) throw new CliError(EXIT.refused, tooBigMessage(content.length), 'too-large');
  const name = path.basename(target);
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return { kind: 'file', name, mime: MIME[ext] ?? 'application/octet-stream', content, title: cleanTitle(o.title ?? '') };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits for a row: 'delivered' (an ack listed it) or 'reader' (a Lab state of REACHED). -> exit code and the row. */
async function waitFor(ctx, id, until, secs) {
  const pollMs = Math.max(50, Number(process.env.DAYLIGHT_SEND_POLL_MS) || 5000);
  const deadline = Date.now() + secs * 1000;
  for (;;) {
    const row = await ctx.lock.run(async () => {
      try { await ctx.sender.checkAcks(); } catch { /* offline: keep waiting */ }
      return (await ctx.sender.list()).find((r) => r.id === id) ?? null;
    });
    if (!row) return { code: EXIT.other, row: null };
    if (row.status === 'delivered') {
      if (until === 'delivered') return { code: EXIT.ok, row };
      const st = await ctx.ledger.state(id);
      if (st && REACHED.includes(st.s)) return { code: EXIT.ok, row };
      if (st && STOPPED.includes(st.s)) return { code: EXIT.other, row };
    }
    if (row.status === 'expired') return { code: EXIT.other, row };
    const left = deadline - Date.now();
    if (left <= 0) return { code: EXIT.timeout, row };
    await sleep(Math.min(pollMs, left));
  }
}

async function cmdSend(target, o) {
  const ctx = await context(o);
  await tick(ctx);
  let item;
  const url = webUrl(target);
  if (url) {
    // Smart intake (F16): the CLI is a Lab entry point
    const n = normaliseShare({ url, subject: o.title ?? '' });
    item = { kind: 'url', url: n.url, title: n.title ?? '', ...(n.orig ? { extras: { 'x-orig': n.orig } } : {}) };
  } else {
    item = await fileItem(target, o);
  }
  let row;
  try {
    row = await ctx.lock.run(() => ctx.sender.send(item));
  } catch (e) {
    if (e instanceof ShareError) throw new CliError(e.code === 'too-large' ? EXIT.refused : EXIT.other, e.message, e.code);
    throw e;
  }
  if (row.status === 'failed' || row.status === 'expired') {
    print(o, await view(ctx, row), { failed: true });
    return row.errorCode === 'refused' ? EXIT.refused : EXIT.other;
  }
  const until = o.waitFor ?? (o.wait !== null ? 'delivered' : null);
  if (!until) { print(o, await view(ctx, row)); return EXIT.ok; }
  const secs = o.wait ?? DEFAULT_WAIT_S;
  const r = await waitFor(ctx, row.id, until, secs);
  if (r.row) print(o, await view(ctx, r.row), { failed: r.code === EXIT.other });
  else process.stderr.write(fillText(LAB_TEXT.cli.noItem, { id: row.id }) + '\n');
  if (r.code === EXIT.timeout) process.stderr.write(fillText(LAB_TEXT.cli.timedOut, { secs, id: row.id }) + '\n');
  return r.code;
}

async function cmdStatus(idArg, o) {
  const ctx = await context(o);
  await tick(ctx);
  const rows = await ctx.sender.list();
  let row;
  if (!idArg) {
    row = rows[0];
    if (!row) throw new CliError(EXIT.other, LAB_TEXT.cli.noItems, 'no-item');
  } else {
    const want = idArg.toLowerCase();
    const found = rows.filter((r) => r.id === want || (want.length >= 4 && r.id.startsWith(want)));
    row = found.length === 1 ? found[0] : rows.find((r) => r.id === want);
    if (!row) throw new CliError(EXIT.other, fillText(LAB_TEXT.cli.noItem, { id: idArg }), 'no-item');
  }
  print(o, await view(ctx, row), { withTitle: true });
  return EXIT.ok;
}

async function cmdTick(o) {
  const ctx = await context(o);
  const r = await tick(ctx);
  if (o.json) process.stdout.write(JSON.stringify(r) + '\n');
  else process.stdout.write(fillText(LAB_TEXT.cli.ticked, r) + '\n');
  return EXIT.ok;
}

async function cmdPair(src, o) {
  if (!src) throw new CliError(EXIT.other, 'daylight-send pair needs the pairing link or code.\nRun daylight-send --help for the options.', 'usage');
  let p;
  try { p = await parsePairing(src); } catch (e) {
    if (e instanceof ShareError) throw new CliError(EXIT.other, e.message, e.code);
    throw e;
  }
  const dir = home();
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'pairing');
  await fsp.writeFile(file + '.tmp', src.trim() + '\n', { mode: 0o600 });
  await fsp.rename(file + '.tmp', file);
  const text = fillText(LAB_TEXT.cli.paired, { name: p.name || LAB_TEXT.shareInPlace.yourDaylight, relay: relayHost(p.relay) });
  process.stdout.write((o.json ? JSON.stringify({ paired: true, name: p.name, relay: p.relay }) : text) + '\n');
  return EXIT.ok;
}

let lockForSignals = null; // the run's lock, let go if the run is interrupted
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(sig, () => { lockForSignals?.release(); process.exit(code); });
}

async function main(argv) {
  let o = { json: argv.includes('--json') };
  try {
    o = parseArgs(argv);
    if (o.help) { process.stdout.write(USAGE + '\n'); return EXIT.ok; }
    if (o.version) { process.stdout.write(`daylight-send ${VERSION} (Daylight Share protocol ${PROTOCOL_VERSION}, Lab ${LAB_LEVEL})\n`); return EXIT.ok; }
    const [cmd, ...rest] = o._;
    if (!cmd) { process.stderr.write(USAGE + '\n'); return EXIT.other; }
    if (cmd === 'status') return await cmdStatus(rest[0], o);
    if (cmd === 'tick') return await cmdTick(o);
    if (cmd === 'pair') return await cmdPair(rest[0], o);
    if (rest.length) throw new CliError(EXIT.other, 'Send one URL or file at a time.\nRun daylight-send --help for the options.', 'usage');
    return await cmdSend(cmd, o);
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    if (o.json && e.reason !== 'usage') {
      process.stdout.write(JSON.stringify({ id: null, status: 'error', error: e.reason, label: e.message }) + '\n');
    }
    process.stderr.write(e.message + '\n');
    return e.exit;
  }
}

const exitNow = async (code) => {
  await new Promise((r) => process.stdout.write('', r));
  await new Promise((r) => process.stderr.write('', r));
  process.exit(code);
};

main(process.argv.slice(2)).then(exitNow, (e) => {
  process.stderr.write(`daylight-send: ${e?.stack ?? e}\n`);
  return exitNow(EXIT.other);
});
