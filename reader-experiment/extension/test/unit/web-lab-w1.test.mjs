// Lab's Wave 1 in the web sender (LAB-PLAN 3.3; card B1) in node: the built site's web-lab.js, web-flush.js and the
// service worker's Background Sync (sw-sync.js, bundled into sw-lab.js), with the page's storage adapter (memory here:
// node has no IndexedDB), the mock relay (with ntfy.sh's limits where it matters) and Lab Daylights from
// daylight-lab.js.
//
//   F16  every link through smart intake: the normalise.json vectors as the page sends them, x-orig, the Use switch;
//        every text-only case through each of the page's entry points (?text=, #text=, the share target, the Link
//        field, the Shortcut), read as app.js reads them (web-logic.js shareFromParams, shareFromEntry)
//   F33  Paste and send's reading of the clipboard; F09 the bookmarklet, read back by the page
//   F01  the timeline's data; What's in Lab's rows with their states and Use switches (6.5 Q5)
//   F07  rows waiting for a connection leave only in capped passes while Lab is on (WebSender, flushPass, flushDue):
//        70 links in three passes with no 429; attachments capped at 18 MB a pass; Background Sync's run (syncFlush)
//   F26  Setup check, the test article along the timeline, the activity log and Copy diagnostics (redacted)
//
//   node --test test/unit/web-lab-w1.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { webBuilt } from '../helpers/web-built.mjs';
import { startMockRelay, NTFY_SH_LIMITS } from '../../../share/js/mock-relay.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const WEB = path.join(here, '..', '..', '..', 'web');
const VECTORS = JSON.parse(fs.readFileSync(path.join(WEB, '..', 'share', 'vectors', 'normalise.json'), 'utf8'));
const w = webBuilt();
// sw-sync.js is bundled into sw-lab.js and not served; it runs here as a module next to the site's copies.
fs.copyFileSync(path.join(WEB, 'sw-sync.js'), path.join(w.dir, 'sw-sync.js'));
const WL = await w.load('web-lab.js');
const WF = await w.load('web-flush.js');
const WS = await w.load('web-storage.js');
const WG = await w.load('web-logic.js');
const SY = await w.load('sw-sync.js');
const ds = await w.load('daylight-share.js');
const L = await w.load('daylight-lab.js');
const { LAB_TEXT } = L;
const quiet = { warn() {}, log() {} };
const MIN = 60000;

/** The page's Lab and a WebSender on one storage, as app.js makes them; a clock the test moves. */
async function setup({ relay: relayOpts = {}, env = {}, paired = true } = {}) {
  let clock = Date.now();
  const now = () => clock;
  const relay = await startMockRelay({ now, ...relayOpts });
  const { storage } = await WS.openStorage();
  const lab = WL.createWebLab({
    storage, now, log: quiet, getPairing: () => ds.loadPairing(storage).catch(() => null),
    getSettings: () => storage.get('settings'), deviceName: async () => 'Web test', appId: WG.APP, env,
  });
  await lab.ensureDefault();
  const secret = ds.generateSecret();
  const pairing = { secret, relay: relay.url, name: 'Lab Daylight' };
  let sender = null;
  if (paired) {
    await ds.savePairing(storage, await ds.parsePairing(await ds.pairingLink(pairing)));
    sender = new WF.WebSender({ pairing: await ds.loadPairing(storage), storage, from: 'Web test', app: WG.APP, now, onAckHeader: lab.hook });
    sender.holdNetwork = true;
  }
  return {
    relay, storage, lab, sender, pairing, now,
    advance: (ms) => { clock += ms; },
    settings: async () => (await storage.get('settings')) ?? {},
    close: () => relay.close(),
  };
}

/** A Lab Daylight (LabInboxSim): it receives, acks and reports `reader` for links and pages, `handed` for files. */
async function labDaylight(pairing, { now = () => Date.now(), stateFor } = {}) {
  const storage = new ds.MemoryStorage();
  const receiver = new ds.Receiver({ pairing, storage, from: 'Daylight', now });
  const labInbox = new L.LabInbox({
    storage, relay: new ds.RelayClient({ relay: pairing.relay }), keys: await ds.deriveKeys(pairing.secret),
    info: () => ({ lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'], live: false }), from: 'Daylight', now,
    autoFlushMs: null,
  });
  const sim = new L.LabInboxSim({ receiver, labInbox, ...(stateFor ? { stateFor } : {}) });
  return { pollOnce: () => sim.pollOnce(), receiver };
}

/** Defers n links, as the page does while the browser is offline (Sender.send defer). */
async function deferLinks(s, n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(await s.sender.send({ kind: 'url', url: `https://example.com/q/${i}`, title: `Queued ${i}` }, { defer: true }));
    s.advance(10);
  }
  return rows;
}

// --- F16: smart intake at every entry point; F33; F09 -------------------------------------------------------------------

test('F16: every link the page sends goes through normaliseShare, as the normalise.json vectors say', () => {
  let n = 0;
  for (const c of VECTORS.cases) {
    const i = c.input;
    // The web sender sends links: selections and notes are F11's (not a web feature), and a URL field it can't read is
    // the plain page's typing rule (normalizeUserUrl), not intake's.
    if (i.source === 'selection' || c.expect.kind !== 'link' || (i.url && !ds.webUrl(i.url))) continue;
    const settings = i.clean === false ? { labUse: { F16: false } } : {};
    const item = WL.labLinkItem({ url: i.url ?? '', text: i.text ?? '', title: i.subject ?? '' }, settings);
    assert.ok(item, c.name);
    assert.equal(item.url, c.expect.url, c.name);
    assert.equal(item.title, c.expect.title && c.expect.title !== item.url ? c.expect.title : '', c.name);
    assert.deepEqual(item.extras ?? {}, c.expect.orig ? { 'x-orig': c.expect.orig } : {}, c.name);
    n++;
  }
  assert.ok(n >= 50, `${n} vectors`);
  // A typed address gets https:// first, as the plain page reads it; text with no address is no link at all.
  assert.deepEqual(WL.labLinkItem({ url: 'example.com/story?utm_source=x', title: 'Typed' }), { kind: 'url', url: 'https://example.com/story', title: 'Typed', extras: { 'x-orig': 'https://example.com/story?utm_source=x' } });
  assert.equal(WL.labLinkItem({ text: 'just a thought' }), null);
  // F16's Use switch off: the link goes exactly as shared, with no x-orig; Lab off is the plain page (app.js).
  assert.deepEqual(WL.labLinkItem({ url: 'https://example.com/a?utm_source=x&fbclid=1' }, { labUse: { F16: false } }), { kind: 'url', url: 'https://example.com/a?utm_source=x&fbclid=1', title: '' });
  // An Android share: the headline stays the title, the link a link (6.5 Q1).
  assert.deepEqual(WL.labLinkItem({ text: 'Opinion | The Real Reason https://nyti.ms/3XyZabc', title: '' }), { kind: 'url', url: 'https://nyti.ms/3XyZabc', title: 'Opinion | The Real Reason' });
});

/**
 * The text-only cases of normalise.json (no url of their own: shared text, with a subject or not) and what the web
 * sender sends for each: the vector's URL and orig, and its title. The web sender has no selections (F11 is not one of
 * its features), so a selection case goes as a plain share: its URL and orig are the vector's, and its title is the
 * text's own.
 */
const TEXT_CASES = VECTORS.cases.filter((c) => c.input.url === undefined && c.input.text !== undefined);
const webExpect = (c) => (c.expect.url ? {
  kind: 'url', url: c.expect.url,
  title: c.input.source ? null : (c.expect.title && c.expect.title !== c.expect.url ? c.expect.title : ''),
  extras: c.expect.orig ? { 'x-orig': c.expect.orig } : {},
} : null);
const enc = encodeURIComponent;

function checkItem(item, want, what) {
  if (!want) { assert.equal(item, null, what); return; }
  assert.ok(item, what);
  assert.equal(item.kind, 'url', what);
  assert.equal(item.url, want.url, what);
  assert.deepEqual(item.extras ?? {}, want.extras, what);
  if (want.title !== null) assert.equal(item.title, want.title, what);
}

test('F16: every text-only case of normalise.json, through each of the page’s entry points, reaches normaliseShare whole (B1)', () => {
  assert.equal(TEXT_CASES.length, 39);
  const pairing = 'daylightshare://pair?c=ABCDEFGHJKMNPQRSTVWXYZ234567&r=https%3A%2F%2Fntfy.sh';
  for (const c of TEXT_CASES) {
    const i = c.input;
    const settings = i.clean === false ? { labUse: { F16: false } } : {};
    const want = webExpect(c);
    const subject = i.subject ? `&title=${enc(i.subject)}` : '';
    // The page's address: ?text= (an installed app's share target with GET, a link) and #text=, as app.js reads it.
    for (const [via, search, hash] of [
      ['?text=', `?autosend=1&text=${enc(i.text)}${subject}`, ''],
      ['#text=', '', `#autosend=1&text=${enc(i.text)}${subject}`],
    ]) {
      const params = WG.readParams(search, hash);
      assert.equal(params.autosend, true);
      checkItem(WL.labShareItem(WG.shareFromParams(params), settings), want, `${c.name} (${via})`);
    }
    // Android's share sheet: sw.js keeps the POSTed {title, text, url}; Chrome on Android shares a link as text.
    checkItem(WL.labShareItem(WG.shareFromEntry({ title: i.subject ?? '', text: i.text, url: '' }), settings), want, `${c.name} (share target)`);
    // The Link field, with the text typed or pasted into it (and a subject in Title).
    checkItem(WL.labLinkItem({ url: i.text, title: i.subject ?? '' }, settings), want, `${c.name} (Link field)`);
    // The Shortcut: its link ends in "&url=" and the shared text is appended, URL-encoded (SHORTCUT.md). It carries no
    // subject, so with one the title is the text's own.
    const prefix = WG.shortcutPrefix('https://h.example/send/', pairing);
    const shortcut = WG.shareFromParams(WG.readParams('', prefix.slice(prefix.indexOf('#')) + enc(i.text)));
    checkItem(WL.labShareItem(shortcut, settings), want && i.subject ? { ...want, title: null } : want, `${c.name} (Shortcut)`);
  }
  // B1's four, through ?text=: the parentheses, the curly quotes, single curly quotes and », and the brackets.
  for (const [text, url] of [
    ['See (https://en.wikipedia.org/wiki/Foo_(bar)).', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
    ['He said “https://example.com/q”', 'https://example.com/q'],
    ['Link: ‘https://example.com/s’ and «https://example.com/t»', 'https://example.com/s'],
    ['[https://example.com/x]', 'https://example.com/x'],
  ]) {
    const share = WG.shareFromParams(WG.readParams(`?autosend=1&text=${enc(text)}`, ''));
    assert.equal(WL.labShareItem(share).url, url, text);
    // Lab off is v1.1's reading, unchanged (sharedLink, which app.js sends with Lab off).
    assert.equal(share.url, ds.findUrl(text), text);
  }
  assert.equal(WG.shareFromParams(WG.readParams(`?text=${enc('See (https://en.wikipedia.org/wiki/Foo_(bar)).')}`, '')).url, 'https://en.wikipedia.org/wiki/Foo_(bar', 'v1.1 with Lab off');
  // A link on its own stays the link as given: the bookmarklet's address (and title), a typed "example.com/story".
  assert.deepEqual(WL.labShareItem(WG.shareFromParams(WG.readParams('', `#autosend=1&url=${enc('https://example.com/a_(b)?utm_source=x')}&title=${enc('A (b)')}`))),
    { kind: 'url', url: 'https://example.com/a_(b)', title: 'A (b)', extras: { 'x-orig': 'https://example.com/a_(b)?utm_source=x' } });
  assert.deepEqual(WL.labShareItem(WG.shareFromParams(WG.readParams('?url=example.com/story', ''))), { kind: 'url', url: 'https://example.com/story', title: '' });
  // typedUrl: an address on its own, never one found inside text.
  assert.equal(WG.typedUrl(' https://a.org/x '), 'https://a.org/x');
  assert.equal(WG.typedUrl('example.com/story'), 'https://example.com/story');
  assert.equal(WG.typedUrl('see https://a.org/x for more'), null);
  assert.equal(WG.typedUrl('“https://a.org/x”'), null);
  assert.equal(WG.typedUrl('javascript:alert(1)'), null);
});

test('F16: a share the page doesn’t send at once fills the Link field with the URL as found and its title; sending the form sends what the share would have', () => {
  for (const c of TEXT_CASES) {
    const i = c.input;
    const settings = i.clean === false ? { labUse: { F16: false } } : {};
    const share = WG.shareFromParams(WG.readParams(`?text=${enc(i.text)}${i.subject ? `&title=${enc(i.subject)}` : ''}`, ''));
    const fields = WL.labShareFields(share);
    const direct = WL.labShareItem(share, settings);
    if (!direct) { assert.deepEqual(fields, { url: '', title: '' }, c.name); continue; }
    assert.equal(ds.webUrl(fields.url), fields.url, c.name);
    assert.deepEqual(WL.labLinkItem({ url: fields.url, title: fields.title }, settings), direct, c.name);
  }
});

test('F33: Paste and send reads a link in copied text, cleaned, with the host its question names; anything else is no link', () => {
  assert.deepEqual(WL.copiedLink('Read https://www.example.org/x?fbclid=1 later'), {
    item: { kind: 'url', url: 'https://www.example.org/x', title: 'Read later', extras: { 'x-orig': 'https://www.example.org/x?fbclid=1' } },
    host: 'example.org',
  });
  assert.equal(WL.copiedLink('no link here'), null);
  assert.equal(WL.copiedLink(''), null);
  assert.equal(WL.copiedLink('javascript:alert(1)'), null);
  assert.equal(L.fillText(LAB_TEXT.copiedLink.confirmShort, { host: 'example.org' }), 'Send example.org?');
});

test('F09: the bookmarklet opens the page with the address and title in the fragment; the page reads them back', () => {
  const code = WL.bookmarklet('https://12twelve12hi.github.io/MHW/send/?lab=1#pair=SECRET');
  assert.equal(code, "javascript:location.href='https://12twelve12hi.github.io/MHW/send/#autosend=1&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)");
  assert.doesNotMatch(code, /SECRET|pair=/, 'no pairing in it: the pairing stays in this browser');
  // A quote in the page's address can't end the string.
  assert.ok(WL.bookmarklet("https://h.example/it's/").startsWith("javascript:location.href='https://h.example/it%27s/#autosend"));
  // Run it on a page: where it goes, the page's own readParams finds the page's address and title, and autosend.
  const ctx = { location: { href: 'https://example.com/story?a=1&b=2#part' }, document: { title: 'A story & more' } };
  vm.runInNewContext(code.slice('javascript:'.length), ctx);
  const u = new URL(ctx.location.href);
  assert.equal(`${u.origin}${u.pathname}`, 'https://12twelve12hi.github.io/MHW/send/');
  assert.deepEqual(WG.readParams(u.search, u.hash), { url: 'https://example.com/story?a=1&b=2#part', title: 'A story & more', autosend: true });
});

// --- What's in Lab, the Use switches, the timeline (F01, 6.5 Q5) ----------------------------------------------------------

test('What’s in Lab: F16 and F33 have a Use switch, on by default; turning one off is kept and read by the page', async () => {
  const s = await setup();
  try {
    assert.deepEqual(WL.WEB_USE_FEATURES, ['F16', 'F33']);
    let o = await s.lab.overview({ refresh: false });
    assert.deepEqual(o.features.map((f) => [f.id, f.use ?? null, f.view ?? null]), [
      ['F01', null, null], ['F07', null, null], ['F09', null, 'view-f09'], ['F16', { on: true }, null], ['F26', null, 'view-setup'], ['F33', { on: true }, null],
    ]);
    assert.deepEqual((await s.lab.page()).use, { F16: true, F33: true });
    assert.deepEqual(await s.lab.setUse('F33', false), { feature: 'F33', on: false });
    assert.deepEqual(await s.lab.setUse('F04', false), { feature: 'F04', on: false }, 'not one of this page’s');
    assert.deepEqual((await s.settings()).labUse, { F33: false });
    o = await s.lab.overview({ refresh: false });
    assert.deepEqual(o.features.find((f) => f.id === 'F33').use, { on: false });
    assert.deepEqual((await s.lab.page()).use, { F16: true, F33: false });
    await s.lab.setUse('F33', true);
    assert.deepEqual((await s.lab.page()).use, { F16: true, F33: true });
    // Lab off: none of it (the one Lab switch still turns all of Lab off).
    await s.lab.setLab(false);
    assert.deepEqual(await s.lab.page(), { lab: false });
    assert.equal(L.labUseOn(await s.settings(), 'F16'), false);
  } finally { await s.close(); }
});

test('F01: the timeline’s data follows a Lab Daylight; the row reads “In your Reader ✓”; the check-in header', async () => {
  const s = await setup();
  try {
    let t = await s.lab.timeline();
    assert.deepEqual([t.inboxLab, t.checkedIn, t.checkedInText], [false, null, LAB_TEXT.neverCheckedIn]);
    assert.equal((await s.lab.overview({ refresh: false })).features[0].short, 'Needs Lab on your Daylight', 'F01 waits for a Lab hello');
    const row = await s.sender.send({ kind: 'url', url: 'https://example.com/one', title: 'One' });
    const day = await labDaylight(s.pairing, { now: s.now });
    await day.pollOnce();
    await s.sender.checkAcks();
    t = await s.lab.timeline();
    assert.equal(t.inboxLab, true);
    assert.equal(t.states[row.id].s, 'reader');
    assert.equal(t.checkedInText, 'Your Daylight checked in just now.');
    const stored = (await s.storage.get('outbox')).find((r) => r.id === row.id);
    const d = L.describeLabRow(stored, s.now(), { lab: true, inboxLab: t.inboxLab, hasCap: t.caps, state: t.states[row.id], online: true });
    assert.deepEqual([d.label, d.sentence, d.stepLine, d.final], ['In your Reader ✓', 'Saved in the Daylight Reader.', 'Sent ✓ · On your Daylight ✓ · In the Reader ✓', true]);
    assert.equal((await s.lab.overview({ refresh: false })).features[0].short, 'Ready');
    const p = await s.lab.page();
    assert.deepEqual([p.lab, p.noteEnabled, p.labNoteShown], [true, true, false]);
    await s.lab.seen('labNoteShown');
    assert.equal((await s.lab.page()).labNoteShown, true, 'the one-time note, once (1.2)');
  } finally { await s.close(); }
});

// --- F07: the offline outbox ----------------------------------------------------------------------------------------------

test('F07: rows waiting for a connection never go in v1.1’s re-send pass while Lab is on; with Lab off they do (1.3)', async () => {
  const s = await setup();
  try {
    const [row] = await deferLinks(s, 1);
    assert.deepEqual([row.status, row.errorCode, row.attempts], ['failed', 'network', 0]);
    s.advance(10 * MIN); // well past its v1.1 back-off
    assert.equal(WF.flushDue(s.sender, await s.sender.list(), s.now()), true, 'due by its back-off: a capped pass is');
    assert.deepEqual(await s.sender.resendDue(), [], 'held while Lab is on');
    s.sender.holdNetwork = false;
    const sent = await s.sender.resendDue();
    assert.deepEqual(sent.map((r) => [r.id, r.status]), [[row.id, 'sent']], 'Lab off: v1.1 sends it');
    assert.equal(WF.flushDue(s.sender, await s.sender.list(), s.now()), false, 'nothing waits');
  } finally { await s.close(); }
});

test('F07.3: 70 links queued offline go out oldest first in three passes of at most 30, 3 minutes apart, with no 429 (ntfy.sh’s limits)', async () => {
  const s = await setup({ relay: { ...NTFY_SH_LIMITS } });
  try {
    const rows = await deferLinks(s, 70);
    const pass = () => WF.flushPass({ storage: s.storage, sender: s.sender, now: s.now });
    let r = await pass();
    assert.equal(r.attempted.length, 30);
    assert.deepEqual(r.attempted.map((x) => x.id), rows.slice(0, 30).map((x) => x.id), 'oldest first');
    assert.ok(r.attempted.every((x) => x.status === 'sent'));
    assert.equal(r.again, WF.FLUSH_GAP_MS, 'it stopped at a cap with every row gone: the next pass in 3 minutes');
    s.advance(MIN);
    r = await pass();
    assert.deepEqual([r.attempted.length, r.again], [0, 2 * MIN], 'too soon: the rest of the 3 minutes');
    s.advance(2 * MIN);
    r = await pass();
    assert.equal(r.attempted.length, 30);
    s.advance(3 * MIN);
    r = await pass();
    assert.deepEqual([r.attempted.length, r.again], [10, null]);
    assert.deepEqual(s.relay.state.limited, [], 'no 429');
    assert.ok((await s.sender.list()).every((x) => x.status === 'sent'));
    const { items } = await new ds.Receiver({ pairing: s.pairing, storage: new ds.MemoryStorage() }).pollOnce();
    assert.deepEqual(items.map((i) => i.header.url), rows.map((x) => x.url), 'all 70, in order');
    // Each pass is in the activity log (F26), with no address or title.
    const log = await s.storage.get(WF.ACTIVITY_KEY);
    assert.equal(log.filter((e) => e.type === 'flush').length, 70);
    assert.doesNotMatch(JSON.stringify(log), /example\.com|Queued/);
  } finally { await s.close(); }
});

test('F07: a pass puts at most 18 MB of attachments on the relay; nothing goes with Lab off or offline', async () => {
  const s = await setup({ relay: { visitorAttachmentTotalBytes: 100_000_000 } });
  try {
    const big = new Uint8Array(5_000_000).map((_, i) => (i * 7919) & 0xff); // doesn't deflate
    for (let i = 0; i < 4; i++) {
      await s.sender.send({ kind: 'file', name: `scan ${i}.pdf`, mime: 'application/pdf', title: `Scan ${i}`, content: big }, { defer: true });
      s.advance(10);
    }
    await s.lab.setLab(false);
    assert.deepEqual(await WF.flushPass({ storage: s.storage, sender: s.sender, now: s.now }), { attempted: [], again: null }, 'Lab off');
    await s.lab.setLab(true);
    assert.deepEqual(await WF.flushPass({ storage: s.storage, sender: s.sender, now: s.now, online: false }), { attempted: [], again: null }, 'offline');
    const before = s.relay.state.publishLog.length;
    const r = await WF.flushPass({ storage: s.storage, sender: s.sender, now: s.now });
    const bytes = s.relay.state.publishLog.slice(before).filter((p) => p.attachment).reduce((n, p) => n + p.bytes, 0);
    assert.equal(r.attempted.length, 3, 'the fourth would take the pass over 18 MB');
    assert.ok(bytes <= 18_000_000 && bytes > 15_000_000, `${bytes} bytes`);
    s.advance(WF.FLUSH_GAP_MS);
    assert.equal((await WF.flushPass({ storage: s.storage, sender: s.sender, now: s.now })).attempted.length, 1);
  } finally { await s.close(); }
});

test('F07, Background Sync: the service worker’s run sends the waiting rows with Lab on, under the outbox lock, and asks again while rows are left', async () => {
  const s = await setup();
  try {
    await deferLinks(s, 35);
    const locked = [];
    const lock = (fn) => { locked.push('outbox'); return fn(); };
    await s.lab.setLab(false);
    assert.deepEqual(await SY.syncFlush({ storage: s.storage, lock, now: s.now }), { attempted: [], retry: false }, 'Lab off: nothing');
    await s.lab.setLab(true);
    await s.storage.set('settings', { ...(await s.settings()), from: 'Web test' });
    let r = await SY.syncFlush({ storage: s.storage, lock, now: s.now, ua: 'Mozilla/5.0 (Linux; Android 14) Mobile' });
    assert.deepEqual([r.attempted.length, r.retry], [30, true], 'a capped pass, then the browser tries again');
    assert.deepEqual(locked, ['outbox', 'outbox']);
    r = await SY.syncFlush({ storage: s.storage, lock, now: s.now });
    assert.deepEqual([r.attempted.length, r.retry], [0, true], 'too soon after the last pass');
    s.advance(WF.FLUSH_GAP_MS);
    r = await SY.syncFlush({ storage: s.storage, lock, now: s.now });
    assert.deepEqual([r.attempted.length, r.retry], [5, false]);
    const { items } = await new ds.Receiver({ pairing: s.pairing, storage: new ds.MemoryStorage() }).pollOnce();
    assert.equal(items.length, 35);
    assert.ok(items.every((i) => i.header.app === WG.APP && i.header.from === 'Web test'), 'sent as the page sends: its app and this device’s name');
    // With no name given, the device's default name, as the page makes it (web-logic.js deviceName).
    await s.storage.set('settings', { lab: true });
    await deferLinks(s, 1);
    s.advance(WF.FLUSH_GAP_MS);
    await SY.syncFlush({ storage: s.storage, lock, now: s.now, ua: 'Mozilla/5.0 (Linux; Android 14) Mobile' });
    const last = (await new ds.Receiver({ pairing: s.pairing, storage: new ds.MemoryStorage() }).pollOnce()).items.at(-1);
    assert.equal(last.header.from, 'Android phone (web)');
    // Not paired: nothing to do.
    const u = await setup({ paired: false });
    try { assert.deepEqual(await SY.syncFlush({ storage: u.storage }), { attempted: [], retry: false }); } finally { await u.close(); }
  } finally { await s.close(); }
});

test('F07, Background Sync: sw-lab.js is one classic script that listens for dls-flush only', async () => {
  const code = fs.readFileSync(path.join(w.dir, 'sw-lab.js'), 'utf8');
  class ServiceWorkerGlobalScope {
    constructor() { this.listeners = {}; this.navigator = { onLine: true, userAgent: 'test' }; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  }
  const self = new ServiceWorkerGlobalScope();
  const opened = [];
  const ctx = vm.createContext({
    self, ServiceWorkerGlobalScope, console, URL, TextEncoder, TextDecoder, crypto: globalThis.crypto, setTimeout, clearTimeout,
    indexedDB: { open: (...a) => { opened.push(a); const req = {}; queueMicrotask(() => { req.error = new Error('no IndexedDB here'); req.onerror?.(); }); return req; } },
  });
  vm.runInContext(code, ctx);
  assert.equal(self.listeners.sync?.length, 1, 'a sync listener, added while the script is first run');
  const waited = [];
  self.listeners.sync[0]({ tag: 'something-else', waitUntil: (p) => waited.push(p) });
  assert.deepEqual([waited.length, opened.length], [0, 0], 'other tags are not its own');
  self.listeners.sync[0]({ tag: WF.SYNC_TAG, waitUntil: (p) => waited.push(p) });
  assert.equal(waited.length, 1);
  await assert.rejects(waited[0], /no IndexedDB here/, 'a failed run fails the event, so the browser tries again');
  assert.deepEqual(opened, [['send-to-daylight', 1]], 'the page’s own database');
});

// --- F26: Setup check, the test article, the activity log and diagnostics -------------------------------------------------

test('F26: Setup check’s lines for the web, with a button only where this page can act; the test article along the timeline', async () => {
  let installed = false, canInstall = false, persisted = false;
  const s = await setup({ env: { installed: () => installed, canInstall: () => canInstall, persisted: async () => persisted, canPersist: () => true, online: () => true } });
  try {
    let c = await s.lab.checks();
    assert.deepEqual(c.checks.map((x) => [x.id, x.line, x.button, x.action]), [
      ['paired', '✓ Pairing', null, null],
      ['installed', '! Installed as an app', null, null],
      ['storage', '! Storage kept by the browser', 'Allow', 'persist'],
    ]);
    assert.equal(c.test, null);
    canInstall = true;
    c = await s.lab.checks();
    assert.deepEqual(c.checks[1].button, LAB_TEXT.buttons['needs-quick-sends'], 'the browser offered to install the page: Open setting opens its prompt');
    installed = true; persisted = true;
    c = await s.lab.checks();
    assert.deepEqual(c.checks.map((x) => x.line), ['✓ Pairing', '✓ Installed as an app', '✓ Storage kept by the browser']);

    // The test article: a page of about 400 words, x-cap test, at daylight.invalid; then followed along.
    const item = await s.lab.testItem();
    assert.equal(item.kind, 'page');
    assert.equal(item.title, 'Test article from Web test');
    assert.ok(item.url.startsWith(L.TEST_URL_PREFIX));
    assert.deepEqual(item.extras, { 'x-cap': 'test' });
    const row = await s.sender.send(item);
    await s.lab.noteTest(row.id);
    c = await s.lab.checks();
    assert.deepEqual([c.test.delivered, c.test.reader, c.test.lines, c.test.label], [false, false, ['Delivered', 'In your Reader'], 'Sent · waiting for your Daylight']);
    // A Lab Daylight that waits for a tap, then takes it to the Reader.
    let state = 'waiting';
    const day = await labDaylight(s.pairing, { now: s.now, stateFor: () => state });
    await day.pollOnce();
    await s.sender.checkAcks();
    c = await s.lab.checks();
    assert.deepEqual([c.test.lines, c.test.label], [['✓ Delivered', 'In your Reader'], 'Waiting for a tap on your Daylight']);
    const { items } = await new ds.Receiver({ pairing: s.pairing, storage: new ds.MemoryStorage() }).pollOnce();
    assert.deepEqual(items[0].extras, { 'x-cap': 'test' }, 'the Inbox sees “Test article” (F03’s row line)');
    s.advance(MIN);
    state = 'reader';
    await day.receiver.storage.remove('seen').catch(() => {});
    const labInbox = new L.LabInbox({ storage: new ds.MemoryStorage(), relay: new ds.RelayClient({ relay: s.pairing.relay }), keys: await ds.deriveKeys(s.pairing.secret), info: () => ({ lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'], live: false }), from: 'Daylight', now: s.now, autoFlushMs: null });
    labInbox.record(row.id, 'reader', Math.floor(s.now() / 1000));
    await labInbox.flush();
    await s.sender.checkAcks();
    c = await s.lab.checks();
    assert.deepEqual([c.test.delivered, c.test.reader, c.test.lines], [true, true, ['✓ Delivered', '✓ In your Reader']]);
    // Lab off: no Setup check.
    await s.lab.setLab(false);
    assert.deepEqual(await s.lab.checks(), { lab: false });
  } finally { await s.close(); }
});

test('F26: an event about a row carries the HTTP status of its last failed publish (http): the re-send pass and F07’s capped pass (Background Sync’s too)', async () => {
  let fail = null; // the mock relay's answer to the next publishes (failPublish), or null to take them
  const s = await setup({ relay: { failPublish: () => fail } });
  try {
    const line = (l) => l.split(' ').slice(1).join(' '); // the activity line without its time
    // The re-send pass (maintain's resendDue, then logChanges): a sent row goes again after RESEND_MESSAGE_MS; the
    // relay refuses it with 429.
    const sent = await s.sender.send({ kind: 'url', url: 'https://example.com/again', title: 'Again' });
    assert.deepEqual([sent.status, sent.http], ['sent', 0]);
    s.advance(ds.RESEND_MESSAGE_MS + MIN);
    fail = 429;
    let before = await s.lab.rowStates();
    await s.sender.resendDue();
    await s.lab.logChanges(before);
    // F07: a row kept offline goes in a capped pass (web-flush.js flushPass, which Background Sync runs too), with the
    // row the 429 left waiting; the relay refuses both with 413.
    const kept = await s.sender.send({ kind: 'url', url: 'https://example.com/kept', title: 'Kept' }, { defer: true });
    fail = 413;
    const pass = await WF.flushPass({ storage: s.storage, sender: s.sender, now: s.now });
    assert.deepEqual(pass.attempted.map((r) => [r.id, r.status, r.http]), [[sent.id, 'failed', 413], [kept.id, 'failed', 413]]);
    // Later passes that go: each row's event is back to "-" (http 0).
    fail = null;
    for (let i = 0; i < 20 && (await s.sender.list()).some((r) => r.status === 'failed'); i++) {
      s.advance(10 * MIN);
      before = await s.lab.rowStates();
      await WF.flushPass({ storage: s.storage, sender: s.sender, now: s.now });
      await s.sender.resendDue();
      await s.lab.logChanges(before);
    }
    const lines = (await s.lab.activity()).lines.map(line);
    const [a, k] = [sent.id.slice(0, 8), kept.id.slice(0, 8)];
    assert.deepEqual(lines.slice(0, 3), [`failed ${a} url failed 429`, `flush ${a} url failed 413`, `flush ${k} url failed 413`]);
    assert.deepEqual(lines.slice(3).sort(), [`sent ${a} url sent -`, `sent ${k} url sent -`].sort());
    assert.match((await s.lab.diagnostics()).text, new RegExp(` flush ${k} url failed 413\n`));
  } finally { await s.close(); }
});

test('F26: the activity log (Lab on only, no title or address) and Copy diagnostics carry no URL, title, code, topic or Server code', async () => {
  const s = await setup();
  try {
    const row = await s.sender.send({ kind: 'url', url: 'https://secret.example/private?token=abc', title: 'A private title' });
    await s.lab.logEvent({ type: 'send', id: row.id, kind: row.kind, status: row.status });
    const before = await s.lab.rowStates();
    await new ds.Receiver({ pairing: s.pairing, storage: new ds.MemoryStorage() }).pollOnce();
    await s.sender.checkAcks();
    await s.lab.logChanges(before);
    const { lines } = await s.lab.activity();
    assert.equal(lines.length, 2);
    assert.match(lines[0], new RegExp(`^\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z send ${row.id.slice(0, 8)} url sent -$`));
    assert.match(lines[1], new RegExp(` delivered ${row.id.slice(0, 8)} url delivered -$`));
    await s.lab.setLab(false);
    await s.lab.logEvent({ type: 'send', id: row.id, kind: 'url', status: 'sent' });
    assert.equal((await s.lab.activity()).lines.length, 2, 'nothing logged with Lab off');
    await s.lab.setLab(true);

    await s.storage.set('server/manualUrl', 'https://daylight-0123456789ab.example.workers.dev');
    const { text } = await s.lab.diagnostics();
    assert.match(text, /^Send to Daylight diagnostics\nApp: Send to Daylight 1\.1\.0 \(web\)\nLab: on\n/);
    assert.match(text, /Outbox: sending 0 · sent 0 · delivered 1 · failed 0 · expired 0/);
    assert.match(text, /Relay: custom relay/);
    const code = await ds.formatCode(s.pairing.secret);
    const keys = await ds.deriveKeys(s.pairing.secret);
    for (const bad of ['secret.example', 'token=abc', 'A private title', code, code.replace(/-/g, ''), keys.inboxTopic, keys.ackTopic, '127.0.0.1', 'workers.dev', 'SERVER-']) {
      assert.ok(!text.includes(bad), `diagnostics carry no ${bad}`);
    }
  } finally { await s.close(); }
});
