// The background logic end to end in node: a fake browser API, the mock ntfy relay, a local web site, and a
// Receiver (the Daylight's side) from daylight-share.js.
//
// These are v1.1's flows. They run with Lab off here, and again with Lab on, the default (core-lab-on.test.mjs sets
// DLS_TEST_LAB=1), so Lab's send path (labSendTab) keeps them: the same rows, retries, relay trouble and PDFs. With Lab
// on only these differ, each by its LAB branch: the badge shows the most recent row (F01: … until it is delivered;
// a send that failed or made no row shows "!" as v1.1 does), pages go through clean-html.js (F03; the fake's stand-in
// here), and the menu has Lab's entries (F34).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { built } from '../helpers/built.mjs';
import { fakeBrowser } from '../helpers/fake-browser.mjs';
import { startSite } from '../helpers/server.mjs';
import { makePdf } from '../helpers/pdf.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const b = built('chrome');
const core = await b.load('core.js');
const ds = await b.load('daylight-share.js');
const quiet = { warn() {}, log() {} };
const PDF = makePdf({ pages: 3, fillerBytes: 20_000 });
const BIG_PDF = makePdf({ pages: 2, fillerBytes: 10_000_000 }); // a 10 MB PDF: over the protocol's 9 MB
const LAB = process.env.DLS_TEST_LAB === '1';
/** The HTML a page item carries: v1.1's capture, or with Lab on clean-html.js's (the fake's stand-in marks it). */
const sentHtml = (html) => (LAB ? `<!doctype html>\n${html.replace(/^<html/i, '<html data-fake-clean="1"')}` : `<!DOCTYPE html>\n${html}`);

/** fetch as an extension without host permissions sees it: cross-origin requests fail unless CORS allows them. */
function extensionFetch(fb, site, flags) {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (flags.relayStatus && !url.startsWith(site.url) && init.method !== 'GET') {
      return new Response(JSON.stringify({ http: flags.relayStatus }), { status: flags.relayStatus });
    }
    if (url.startsWith(site.url) && !u.pathname.startsWith('/cors/') && !fb.granted.has('http://127.0.0.1/*')) {
      throw new TypeError('Failed to fetch');
    }
    return fetch(url, init);
  };
}

async function setup({ target = 'chrome', native, pdfChunkSize, paired = true, contextMenus = true, now, storage, relayNow } = {}) {
  const relay = await startMockRelay(relayNow ? { now: relayNow } : {});
  const site = await startSite({ pdf: PDF, bigPdf: BIG_PDF });
  const fb = fakeBrowser({ native, contextMenus });
  // v1.1's tests: the plain app with Lab off (LAB-PLAN 1.3; the test hook of 1.7 seeds settings.lab), and the same with
  // Lab on (core-lab-on.test.mjs). Lab's own sending is lab-send.test.mjs.
  await fb.api.storage.local.set({ settings: { lab: LAB } });
  const flags = { relayStatus: 0 };
  const app = core.createApp({ api: fb.api, target, fetch: extensionFetch(fb, site, flags), pdfChunkSize, log: quiet, now, storage });
  const secret = ds.generateSecret();
  const link = await ds.pairingLink({ secret, relay: relay.url, name: 'Test Daylight' });
  const pairing = { secret, relay: relay.url };
  const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage() });
  if (paired) await app.pair({ input: link });
  const rows = async () => (await fb.api.storage.local.get('outbox')).outbox ?? [];
  return {
    relay, site, fb, app, link, secret, receiver, flags, rows,
    async receive() { return (await receiver.pollOnce()).items; },
    close: async () => { await relay.close(); await site.close(); },
  };
}

const articleHtml = '<html><head><title>A quiet article</title></head><body><p id="marker">Marker ✓ ünïcödé</p></body></html>';

test('pairing with a link, a typed code and the Advanced relay', async () => {
  const s = await setup({ paired: false });
  try {
    assert.equal((await s.app.state()).paired, false);
    await assert.rejects(s.app.pair({ input: 'ABCD-EFGH' }), /28 letters/);
    const r = await s.app.pair({ input: s.link, from: '  My   laptop ' });
    assert.deepEqual(r, { name: 'Test Daylight', relay: s.relay.url, notice: null });
    const st = await s.app.state();
    assert.equal(st.paired, true);
    assert.equal(st.name, 'Test Daylight');
    assert.equal(st.from, 'My laptop');
    assert.equal(st.defaultFrom, 'Chrome on Mac');
    assert.equal(st.shortcut, 'Alt+Shift+D');
    // A typed code (lowercase, look-alikes) with the relay typed in Advanced keeps the name it had.
    const code = (await ds.formatCode(s.secret)).toLowerCase().replace(/o/g, '0');
    const again = await s.app.pair({ input: code, relay: s.relay.url + '/' });
    assert.equal(again.notice, 'Pairing updated.', 'the same code: no question, the module’s notice');
    const st2 = await s.app.state();
    assert.equal(st2.relay, s.relay.url);
    assert.equal(st2.name, 'Test Daylight');
    // A typed code alone means ntfy.sh.
    const moved = await s.app.pair({ input: code });
    assert.equal(moved.notice, 'Pairing updated: now sending through ntfy.sh.');
    assert.equal((await s.app.state()).relay, 'https://ntfy.sh');
    // A pasted link names its own relay: Advanced (which Change pairing… fills with the relay in use) doesn't override it.
    const back = await s.app.pair({ input: s.link, relay: 'https://ntfy.sh' });
    assert.equal(back.notice, `Pairing updated: now sending through ${ds.relayHost(s.relay.url)}.`);
    assert.equal((await s.app.state()).relay, s.relay.url);
    // The code typed again with Advanced as Change pairing… fills it: the relay stays.
    assert.equal((await s.app.pair({ input: code, relay: s.relay.url, from: 'Renamed' })).notice, 'Pairing updated.');
    assert.equal((await s.app.state()).relay, s.relay.url);
    assert.equal((await s.app.state()).from, 'Renamed');
  } finally { await s.close(); }
});

test('"Send this page" sends the HTML as a page item; acks mark it delivered', async () => {
  const s = await setup();
  try {
    const tabId = s.fb.addTab({ url: `${s.site.url}/article.html`, title: 'A quiet article', html: articleHtml });
    const res = await s.fb.api.runtime.sendMessage({ type: 'sendTab', tabId }).catch((e) => e);
    // runtime.onMessage isn't wired in this test (background.js does that): call the app directly.
    assert.equal(res, undefined);
    const r = await s.app.onMessage({ type: 'sendTab', tabId });
    assert.equal(r.row.kind, 'page');
    assert.equal(r.row.status, 'sent');
    assert.deepEqual(s.fb.badge.history.slice(-2), LAB ? ['…', '…'] : ['…', '✓'], 'Lab: … until the Daylight has it');

    const items = await s.receive();
    assert.equal(items.length, 1);
    const { header, content } = items[0];
    assert.equal(header.kind, 'page');
    assert.equal(header.url, `${s.site.url}/article.html`);
    assert.equal(header.title, 'A quiet article');
    assert.equal(header.from, 'Chrome on Mac');
    assert.equal(header.app, 'chrome/1.2.3');
    assert.equal(new TextDecoder().decode(content), sentHtml(articleHtml));

    assert.equal((await s.rows())[0].status, 'sent');
    assert.ok(s.fb.local.has(`outbox/${r.row.id}`), 'content kept until delivered');
    await s.app.onAlarm({ name: core.ALARM_TICK });
    assert.equal((await s.rows())[0].status, 'delivered');
    assert.equal(s.fb.local.has(`outbox/${r.row.id}`), false, 'content dropped once delivered');
    assert.ok(s.fb.alarms.has(core.ALARM_SOON), 'a check ~30 s after sending is scheduled');
  } finally { await s.close(); }
});

test('"Send link only" and pages that are too large or unreadable go as url items', async () => {
  const s = await setup();
  try {
    const t1 = s.fb.addTab({ url: 'https://example.com/story?x=1', title: 'A story', html: articleHtml });
    const r1 = await s.app.onMessage({ type: 'sendTab', tabId: t1, linkOnly: true });
    assert.equal(r1.row.kind, 'url');
    assert.deepEqual(s.fb.tabCalls(t1), [], 'link only does not touch the page');

    const big = `<html><body>${'é'.repeat(4.5 * 1024 * 1024)}</body></html>`; // under 8 Mi characters, over 8 MiB as UTF-8
    const t2 = s.fb.addTab({ url: 'https://example.com/big', title: 'Big', html: big });
    const r2 = await s.app.onMessage({ type: 'sendTab', tabId: t2 });
    assert.equal(r2.row.kind, 'url');
    assert.match(r2.note, /larger than 8 MB/);

    const huge = `<html><body>${'x'.repeat(8 * 1024 * 1024 + 10)}</body></html>`;
    const t3 = s.fb.addTab({ url: 'https://example.com/huge', title: 'Huge', html: huge });
    const r3 = await s.app.onMessage({ type: 'sendTab', tabId: t3 });
    assert.equal(r3.row.kind, 'url');

    const t4 = s.fb.addTab({ url: 'https://chromewebstore.google.com/detail/abc', title: 'Store', scriptable: false });
    const r4 = await s.app.onMessage({ type: 'sendTab', tabId: t4 });
    assert.equal(r4.row.kind, 'url');
    assert.match(r4.note, /can’t read this page/);

    const t5 = s.fb.addTab({ url: 'chrome://settings', title: 'Settings', scriptable: false });
    await assert.rejects(s.app.onMessage({ type: 'sendTab', tabId: t5 }), /only web pages/);
    assert.equal(s.fb.badge.text, '!', 'no row: "!", with Lab on too (not the most recent row’s mark)');

    const items = await s.receive();
    assert.deepEqual(items.map((i) => i.header.kind).sort(), ['url', 'url', 'url', 'url']);
    assert.ok(items.find((i) => i.header.url === 'https://example.com/story?x=1' && i.header.title === 'A story'));
    const notes = (await s.rows()).filter((r) => r.note).length;
    assert.equal(notes, 3);
  } finally { await s.close(); }
});

test('a PDF tab is read inside the page, in chunks, and sent as a file item', async () => {
  const s = await setup({ pdfChunkSize: 7000 });
  try {
    const url = `${s.site.url}/files/paper.pdf`;
    const tabId = s.fb.addTab({ url, title: 'paper.pdf', contentType: 'application/pdf' });
    const r = await s.app.onMessage({ type: 'sendTab', tabId });
    assert.equal(r.row.kind, 'file');
    const calls = s.fb.tabCalls(tabId);
    assert.equal(calls.filter((c) => c === 'pdfChunk').length, Math.ceil(PDF.length / 7000));
    assert.equal(calls.at(-1), 'pdfEnd');
    const [item] = await s.receive();
    assert.equal(item.header.kind, 'file');
    assert.equal(item.header.mime, 'application/pdf');
    assert.equal(item.header.name, 'Quiet Paper.pdf', 'Content-Disposition name');
    assert.equal(item.header.title, 'Quiet Paper');
    assert.equal(item.header.url, url);
    assert.deepEqual(item.content, PDF);
    assert.equal(s.fb.granted.size, 0, 'no permission needed');
  } finally { await s.close(); }
});

test('a PDF the page cannot read: CORS-open servers need no permission; others ask, then download or send the link', async () => {
  const s = await setup();
  try {
    // Safari-like: the PDF viewer can't be scripted. The server allows CORS, so the extension downloads it directly.
    const t1 = s.fb.addTab({ url: `${s.site.url}/cors/paper.pdf`, title: 'A paper', scriptable: false });
    const r1 = await s.app.onMessage({ type: 'sendTab', tabId: t1 });
    assert.equal(r1.row.kind, 'file');
    assert.equal(r1.row.name, 'paper.pdf', 'the URL names the file');
    assert.equal(r1.row.title, 'A paper', 'the tab title titles it');

    // Not CORS-open: the popup is asked to request the host permission.
    const url = `${s.site.url}/files/paper.pdf`;
    const t2 = s.fb.addTab({ url, title: 'Quiet', scriptable: false });
    const ask = await s.app.onMessage({ type: 'sendTab', tabId: t2 });
    assert.deepEqual(ask.needsPermission, { origins: ['http://127.0.0.1/*'] });
    assert.equal(s.fb.badge.text, LAB ? '…' : '', 'no error badge while asking (Lab: the most recent row’s mark)');
    // Denied: the link goes, with a note.
    const denied = await s.app.onMessage({ type: 'sendPdf', url: ask.url, title: ask.title, token: ask.token });
    assert.equal(denied.row.kind, 'url');
    assert.match(denied.note, /access to the site/);
    // Granted: downloaded by the extension with the user's cookies.
    const ask2 = await s.app.onMessage({ type: 'sendTab', tabId: t2 });
    s.fb.grant('http://127.0.0.1/*');
    const ok = await s.app.onMessage({ type: 'sendPdf', url: ask2.url, title: ask2.title, token: ask2.token });
    assert.equal(ok.row.kind, 'file');
    assert.equal(ok.row.name, 'Quiet Paper.pdf');

    const items = await s.receive();
    assert.deepEqual(items.map((i) => i.header.kind).sort(), ['file', 'file', 'url']);
    for (const i of items.filter((x) => x.header.kind === 'file')) assert.deepEqual(i.content, PDF);
  } finally { await s.close(); }
});

test('a permission granted after the popup closed sends the PDF once', async () => {
  const s = await setup();
  try {
    const t = s.fb.addTab({ url: `${s.site.url}/files/paper.pdf`, title: 'Quiet', scriptable: false });
    const ask = await s.app.onMessage({ type: 'sendTab', tabId: t });
    s.fb.grant('http://127.0.0.1/*');
    await s.app.onPermissionsAdded({ origins: ['http://127.0.0.1/*'] });
    // The popup survived after all and also asks: it must not send a second copy.
    const again = await s.app.onMessage({ type: 'sendPdf', url: ask.url, title: ask.title, token: ask.token });
    assert.deepEqual(again, { handled: true });
    const items = await s.receive();
    assert.equal(items.length, 1);
    assert.equal(items[0].header.kind, 'file');
  } finally { await s.close(); }
});

test('context menus: link with its text, PDF link downloaded in the page, and fake PDFs refused', async () => {
  const s = await setup();
  try {
    const pageUrl = `${s.site.url}/article.html`;
    const tabId = s.fb.addTab({
      url: pageUrl, title: 'A quiet article', html: articleHtml,
      links: [{ href: 'https://example.com/next', text: '  The next\n story ' }, { href: `${s.site.url}/files/paper.pdf`, text: 'Read the paper' }],
    });
    const tab = await s.fb.api.tabs.get(tabId);
    await s.app.onMenu({ menuItemId: core.MENU.link, linkUrl: 'https://example.com/next', frameId: 0 }, tab);
    await s.app.onMenu({ menuItemId: core.MENU.pdfLink, linkUrl: `${s.site.url}/files/paper.pdf`, frameId: 0 }, tab);
    await s.app.onMenu({ menuItemId: core.MENU.page, frameId: 0 }, tab);
    // A ".pdf" link that serves a sign-in page: not a file; with access granted it falls back to the link.
    s.fb.onRequest(async () => true);
    await s.app.onMenu({ menuItemId: core.MENU.pdfLink, linkUrl: `${s.site.url}/files/fake.pdf`, frameId: 0 }, tab);

    const items = await s.receive();
    const byKind = (k) => items.filter((i) => i.header.kind === k);
    assert.equal(items.length, 4);
    assert.equal(byKind('page').length, 1);
    const link = items.find((i) => i.header.url === 'https://example.com/next');
    assert.equal(link.header.kind, 'url');
    assert.equal(link.header.title, 'The next story');
    const [file] = byKind('file');
    assert.equal(file.header.title, 'Read the paper');
    assert.equal(file.header.name, 'Quiet Paper.pdf');
    assert.deepEqual(file.content, PDF);
    const fake = items.find((i) => i.header.url?.endsWith('/files/fake.pdf'));
    assert.equal(fake.header.kind, 'url');
    assert.match((await s.rows()).find((r) => r.url.endsWith('fake.pdf')).note, /Couldn’t download/);
  } finally { await s.close(); }
});

test('the keyboard command sends the active tab; unpaired, it opens the pairing popup', async () => {
  const s = await setup({ paired: false });
  try {
    s.fb.addTab({ url: 'https://example.com/a', title: 'A', html: articleHtml });
    await s.app.onCommand(core.COMMAND_SEND);
    assert.deepEqual(s.fb.opened, ['popup']);
    await s.app.onMenu({ menuItemId: core.MENU.page }, await s.fb.api.tabs.query({}).then((t) => t[0]));
    assert.deepEqual(s.fb.opened, ['popup', 'popup']);
    await s.app.pair({ input: s.link });
    await s.app.onCommand(core.COMMAND_SEND);
    await s.app.onCommand('something-else');
    const items = await s.receive();
    assert.equal(items.length, 1);
    assert.equal(items[0].header.kind, 'page');
  } finally { await s.close(); }
});

test('a relay that is busy (429): "Waiting to send" with Retry now, a ! badge; Retry now sends it', async () => {
  const s = await setup();
  try {
    s.flags.relayStatus = 429;
    const t = s.fb.addTab({ url: 'https://example.com/a', title: 'A', html: articleHtml });
    const r = await s.app.onMessage({ type: 'sendTab', tabId: t });
    assert.equal(r.row.status, 'failed');
    assert.equal(r.row.errorCode, 'network');
    assert.equal(s.fb.badge.text, LAB ? '…' : '!', 'Lab: it goes again by itself, so it is on its way');
    const L = await b.load('logic.js');
    assert.deepEqual(L.statusInfo(r.row), {
      label: 'Waiting to send', tone: 'busy', hint: 'Couldn’t send right now. It will try again by itself.', action: 'retry-now', retry: 'Retry now',
    });
    s.flags.relayStatus = 0;
    const again = await s.app.onMessage({ type: 'retry', id: r.row.id });
    assert.equal(again.row.status, 'sent');
    assert.equal(again.row.id, r.row.id);
    const items = await s.receive();
    assert.equal(items.length, 1);
    assert.equal(items[0].header.id, r.row.id);
  } finally { await s.close(); }
});

test('a relay that is full (413) waits about 3 hours; the third time it is Not delivered with Try again', async () => {
  let clock = Date.now();
  const s = await setup({ now: () => clock });
  try {
    const L = await b.load('logic.js');
    s.flags.relayStatus = 413;
    const t = s.fb.addTab({ url: 'https://example.com/full', title: 'Full', html: articleHtml });
    const r = await s.app.onMessage({ type: 'sendTab', tabId: t });
    assert.deepEqual([r.row.status, r.row.errorCode], ['failed', 'full']);
    assert.deepEqual(L.statusInfo(r.row, clock), {
      label: 'Waiting to send', tone: 'busy', action: null, retry: null,
      hint: 'A lot has been sent from this network in the last few hours. It will send by itself in about 3 hours.',
    });
    assert.deepEqual(await s.app.tick(), { delivered: 0, resent: 0 }, 'not due before 185 minutes');
    for (let i = 0; i < 2; i++) { clock += 185 * 60000; await s.app.tick(); }
    const row = (await s.rows())[0];
    assert.deepEqual([row.status, row.errorCode, row.slowFails], ['expired', 'full', 3]);
    assert.deepEqual(L.statusInfo(row, clock), {
      label: 'Not delivered', tone: 'bad', action: 'try-again', retry: 'Try again',
      hint: 'Too much was sent from this network for hours, so it stopped trying. Try again later.',
    });
    s.flags.relayStatus = 0;
    const tried = await s.app.onMessage({ type: 'retry', id: row.id });
    assert.equal(tried.row.status, 'sent', 'Try again sends it again');
    assert.equal((await s.receive())[0].header.id, row.id);
  } finally { await s.close(); }
});

test('start sets up menus and the alarm; with nothing to wait for, a tick makes no request', async () => {
  const s = await setup();
  try {
    await s.app.start();
    assert.deepEqual([...s.fb.menus.keys()], LAB
      ? [core.MENU.page, core.MENU.clean, core.MENU.link, core.MENU.selection, core.MENU.image, core.MENU.pdfLink]
      : [core.MENU.page, core.MENU.link, core.MENU.pdfLink]);
    assert.deepEqual(s.fb.menus.get(core.MENU.pdfLink).targetUrlPatterns, core.PDF_LINK_PATTERNS);
    assert.equal(s.fb.alarms.get(core.ALARM_TICK).periodInMinutes, 15);
    const before = s.relay.state.requests.length;
    assert.deepEqual(await s.app.tick(), { delivered: 0, resent: 0 });
    assert.equal(s.relay.state.requests.length, before);
  } finally { await s.close(); }
});

test('an expired page’s stored copy is dropped 14 days after the share, by the alarm, with nothing else waiting', async () => {
  let clock = Date.now();
  const s = await setup({ now: () => clock });
  try {
    const t0 = clock;
    const t = s.fb.addTab({ url: 'https://example.com/never', title: 'Never', html: articleHtml });
    const r = await s.app.onMessage({ type: 'sendTab', tabId: t });
    await s.app.tick(); // after the check a send starts, at the time of the send
    clock = t0 + 7 * 86400000 + 60000;
    await s.app.onAlarm({ name: core.ALARM_TICK });
    const row = (await s.rows())[0];
    assert.deepEqual([row.status, row.errorCode], ['expired', '']);
    assert.ok(s.fb.local.has(`outbox/${r.row.id}`), 'kept for Try again');
    clock = t0 + 10 * 86400000;
    await s.app.onAlarm({ name: core.ALARM_TICK });
    assert.ok(s.fb.local.has(`outbox/${r.row.id}`), 'still kept on day 10');
    clock = t0 + 37 * 86400000;
    const before = s.relay.state.requests.length;
    await s.app.onAlarm({ name: core.ALARM_TICK });
    assert.equal(s.fb.local.has(`outbox/${r.row.id}`), false, 'dropped: more than 14 days after the share (CONTENT_KEEP)');
    assert.equal(s.relay.state.requests.length, before, 'past the ack window (15 days) nothing reads the relay');
    assert.equal((await s.rows())[0].status, 'expired');
  } finally { await s.close(); }
});

test('an expired link is marked delivered when the Daylight comes back and acks the last re-send', async () => {
  let clock = Date.now();
  const s = await setup({ now: () => clock, relayNow: () => clock });
  try {
    const L = await b.load('logic.js');
    const t0 = clock;
    const { row } = await s.app.sendUrl('https://example.com/late', 'Late');
    await s.app.tick();
    clock = t0 + 7 * 86400000 - 30 * 60000;
    assert.equal((await s.app.tick()).resent, 1, 'the last re-send, half an hour before the week is up');
    clock = t0 + 7 * 86400000 + 60000;
    await s.app.onAlarm({ name: core.ALARM_TICK });
    assert.equal((await s.rows())[0].status, 'expired');
    assert.equal(L.statusInfo((await s.rows())[0], clock).retry, 'Try again');
    // The Daylight comes online, finds the re-send still on the relay and acks it.
    clock += 3600000;
    assert.deepEqual((await s.receive()).map((i) => i.header.id), [row.id]);
    await s.app.onAlarm({ name: core.ALARM_TICK });
    const done = (await s.rows())[0];
    assert.equal(done.status, 'delivered');
    assert.deepEqual([L.statusInfo(done, clock).label, L.statusInfo(done, clock).retry], ['Delivered ✓', null]);
  } finally { await s.close(); }
});

test('pairing again: the same code with a new relay keeps the outbox; another code asks first, then clears it', async () => {
  const s = await setup();
  const relay2 = await startMockRelay();
  try {
    s.flags.relayStatus = 429;
    const t = s.fb.addTab({ url: 'https://example.com/a', title: 'A', html: articleHtml });
    const r = await s.app.onMessage({ type: 'sendTab', tabId: t });
    assert.ok(s.fb.local.has(`outbox/${r.row.id}`));
    s.flags.relayStatus = 0;

    // The same Daylight, moved to another relay: no question, the outbox stays and goes through the new relay.
    const code = await ds.formatCode(s.secret);
    const moved = await s.app.onMessage({ type: 'pair', input: code, relay: relay2.url });
    assert.deepEqual(moved, { name: 'Test Daylight', relay: relay2.url, notice: `Pairing updated: now sending through ${ds.relayHost(relay2.url)}.` });
    assert.equal((await s.rows()).length, 1);
    assert.ok(s.fb.local.has(`outbox/${r.row.id}`));
    const resent = await s.app.onMessage({ type: 'retry', id: r.row.id });
    assert.equal(resent.row.status, 'sent');
    const r2 = new ds.Receiver({ pairing: { secret: s.secret, relay: relay2.url }, storage: new ds.MemoryStorage() });
    assert.deepEqual((await r2.pollOnce()).items.map((i) => i.header.id), [r.row.id], 'through the new relay');

    // Another Daylight's code: it asks, in the module's words, and changes nothing until the answer.
    const other = ds.generateSecret();
    const otherCode = await ds.formatCode(other);
    const ask = await s.app.onMessage({ type: 'pair', input: otherCode, relay: s.relay.url });
    const expected = ds.pairingConfirmation({ secret: s.secret, relay: relay2.url, name: 'Test Daylight' },
      { secret: other, relay: s.relay.url, name: '' }, { source: 'app' });
    assert.deepEqual(ask, { needsConfirm: { title: expected.title, lines: expected.lines, button: 'Switch', expect: code } });
    assert.ok(ask.needsConfirm.lines.includes('This replaces Test Daylight. Items not yet delivered to it will not be sent.'));
    assert.equal((await s.rows()).length, 1, 'nothing changes before the answer');
    assert.equal((await s.app.state()).relay, relay2.url);
    // The answer comes after the pairing changed some other way: refused.
    await assert.rejects(s.app.onMessage({ type: 'pair', input: otherCode, confirm: true, expect: 'SOMETHING-ELSE' }), /changed in the meantime/);
    // Switch: the old outbox, its content and the ack cursor go.
    await s.fb.api.storage.local.set({ ackSince: 123 });
    const switched = await s.app.onMessage({ type: 'pair', input: otherCode, relay: s.relay.url, confirm: true, expect: code });
    assert.deepEqual(switched, { name: '', relay: s.relay.url, notice: null });
    assert.equal((await s.rows()).length, 0);
    assert.equal(s.fb.local.has(`outbox/${r.row.id}`), false);
    assert.equal(s.fb.local.has('ackSince'), false);

    await s.app.onMessage({ type: 'unpair' });
    assert.equal((await s.app.state()).paired, false);
    assert.equal(s.fb.local.has('pairing'), false);
    // Nothing paired: a typed code pairs without a question.
    assert.equal((await s.app.onMessage({ type: 'pair', input: code })).notice, null);
  } finally { await s.close(); await relay2.close(); }
});

test('Remove drops a row and its stored content', async () => {
  const s = await setup();
  try {
    s.flags.relayStatus = 429;
    const t = s.fb.addTab({ url: 'https://example.com/a', title: 'A', html: articleHtml });
    const r = await s.app.onMessage({ type: 'sendTab', tabId: t });
    assert.ok(s.fb.local.has(`outbox/${r.row.id}`));
    assert.deepEqual(await s.app.onMessage({ type: 'remove', id: r.row.id }), { removed: true });
    assert.deepEqual(await s.rows(), []);
    assert.equal(s.fb.local.has(`outbox/${r.row.id}`), false);
    assert.deepEqual(await s.app.onMessage({ type: 'remove', id: r.row.id }), { removed: false });
  } finally { await s.close(); }
});

test('a 10 MB PDF sends its link with the shared note; a 5 MB one goes as a file in pieces under the relay’s 2 MB', async () => {
  const s = await setup();
  try {
    const big = s.fb.addTab({ url: `${s.site.url}/files/big.pdf`, title: 'Big', contentType: 'application/pdf' });
    const r = await s.app.onMessage({ type: 'sendTab', tabId: big });
    assert.equal(r.row.kind, 'url');
    assert.equal(r.note, 'The PDF is over 9 MB, so its link was sent.');
    assert.ok(BIG_PDF.length > ds.MAX_ITEM);

    const mid = makePdf({ pages: 2, fillerBytes: 5_000_000 });
    s.site.routes.set('/files/mid.pdf', { type: 'application/pdf', body: Buffer.from(mid) });
    const t = s.fb.addTab({ url: `${s.site.url}/files/mid.pdf`, title: 'Mid', contentType: 'application/pdf' });
    const f = await s.app.onMessage({ type: 'sendTab', tabId: t });
    assert.equal(f.row.kind, 'file');
    assert.equal(f.row.status, 'sent');
    const items = await s.receive();
    const file = items.find((i) => i.header.kind === 'file');
    assert.deepEqual(file.content, mid);
    const attachments = [...s.relay.state.topics.values()].flat().filter((m) => m.attachment);
    assert.equal(attachments.length, 3, 'three frames');
    assert.ok(attachments.every((m) => m.attachment.size <= 2_000_000), attachments.map((m) => m.attachment.size).join(', '));
  } finally { await s.close(); }
});

test('a PDF served without Content-Length is read only until it passes 9 MB, in the page and by the extension; its link goes', async () => {
  const s = await setup();
  try {
    s.site.routes.set('/files/stream.pdf', { type: 'application/pdf', body: Buffer.from(BIG_PDF), chunked: true });
    s.site.routes.set('/cors/stream.pdf', { type: 'application/pdf', body: Buffer.from(BIG_PDF), chunked: true, headers: { 'Access-Control-Allow-Origin': '*' } });
    const head = await fetch(`${s.site.url}/files/stream.pdf`);
    assert.equal(head.headers.get('content-length'), null, 'served without a length');
    await head.body.cancel();
    const inPage = s.fb.addTab({ url: `${s.site.url}/files/stream.pdf`, title: 'Stream', contentType: 'application/pdf' });
    const r1 = await s.app.onMessage({ type: 'sendTab', tabId: inPage });
    assert.deepEqual([r1.row.kind, r1.note], ['url', 'The PDF is over 9 MB, so its link was sent.']);
    assert.ok(s.fb.tabCalls(inPage).includes('pdfStart'));
    assert.equal(s.fb.tabCalls(inPage).filter((c) => c === 'pdfChunk').length, 0, 'nothing was copied out of the page');
    const byExtension = s.fb.addTab({ url: `${s.site.url}/cors/stream.pdf`, title: 'Stream', scriptable: false });
    const r2 = await s.app.onMessage({ type: 'sendTab', tabId: byExtension });
    assert.deepEqual([r2.row.kind, r2.note], ['url', 'The PDF is over 9 MB, so its link was sent.']);
    // In the page, a 300 MB body: read in pieces only until it passes 9 MB.
    let pulled = 0;
    const endless = () => new Response(new ReadableStream({
      pull(c) { pulled++; c.enqueue(new Uint8Array(1_000_000)); if (pulled === 300) c.close(); },
    }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'application/pdf' } });
    const huge = s.fb.addTab({ url: 'https://example.com/huge.pdf', title: 'Huge', contentType: 'application/pdf', fetch: async () => endless() });
    const r3 = await s.app.onMessage({ type: 'sendTab', tabId: huge });
    assert.deepEqual([r3.row.kind, r3.note], ['url', 'The PDF is over 9 MB, so its link was sent.']);
    assert.ok(pulled <= 11, `read ${pulled} MB of 300`);
  } finally { await s.close(); }
});

test('readCapped stops reading a body once it is over the limit', async () => {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(c) { pulled++; c.enqueue(new Uint8Array(1000)); if (pulled === 1000) c.close(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  assert.deepEqual(await core.readCapped(new Response(body), 5500), { tooLarge: true, size: 6000 });
  assert.ok(pulled <= 7, `read ${pulled} of 1000 pieces`);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(cancelled, true, 'the rest is cancelled');
  const ok = await core.readCapped(new Response(new Uint8Array([1, 2, 3])), 3);
  assert.deepEqual([...ok.bytes], [1, 2, 3]);
  const declared = await core.readCapped(new Response('x', { headers: { 'content-length': '9000001' } }), 9000000);
  assert.deepEqual(declared, { tooLarge: true, size: 9000001 });
});

test('Safari asks the app for its pairing when not paired, and ignores errors', async () => {
  let answer = null;
  const asked = [];
  const s = await setup({ target: 'safari', paired: false, native: async (app, msg) => { asked.push(msg); if (answer instanceof Error) throw answer; return answer; } });
  try {
    answer = new Error('no handler');
    assert.equal((await s.app.state()).paired, false);
    answer = { code: await ds.formatCode(s.secret), relay: s.relay.url, name: 'Kitchen Daylight' };
    const st = await s.app.state();
    assert.deepEqual(asked.at(-1), { type: 'getPairing' });
    assert.equal(st.paired, true);
    assert.equal(st.name, 'Kitchen Daylight');
    assert.equal(st.defaultFrom, 'Safari on Mac');
    const n = asked.length;
    await s.app.state();
    assert.equal(asked.length, n, 'not asked again once paired');
    const t = s.fb.addTab({ url: 'https://example.com/a', title: 'A', html: articleHtml });
    await s.app.onMessage({ type: 'sendTab', tabId: t });
    const [item] = await s.receive();
    assert.equal(item.header.app, 'safari/1.2.3');
  } finally { await s.close(); }
});

test('Safari also accepts a pairing link from the app; Chrome never asks', async () => {
  const s = await setup({ target: 'safari', paired: false, native: async () => ({ code: s.link }) });
  try {
    assert.equal((await s.app.state()).name, 'Test Daylight');
  } finally { await s.close(); }
  let asked = 0;
  const c = await setup({ target: 'chrome', paired: false, native: async () => { asked++; return { code: 'x' }; } });
  try {
    await c.app.state();
    assert.equal(asked, 0);
  } finally { await c.close(); }
});

test('a re-send copy that can’t be stored: the item is still sent once, then ends as no longer stored', async () => {
  const area = {
    m: new Map(),
    async get(k) { return this.m.has(k) ? { [k]: structuredClone(this.m.get(k)) } : {}; },
    async set(o) { for (const [k, v] of Object.entries(o)) { if (k.startsWith('outbox/')) throw new Error('QUOTA_BYTES quota exceeded'); this.m.set(k, structuredClone(v)); } },
    async remove(k) { this.m.delete(k); },
  };
  const st = core.areaStorage(area);
  await assert.rejects(st.set('outbox/abc', 'x'), /QUOTA_BYTES/, 'the adapter reports every failed write');
  await st.set('pairing', { code: 'x' });
  assert.deepEqual(await st.get('pairing'), { code: 'x' });

  let clock = Date.now();
  const s = await setup({ storage: st, now: () => clock });
  try {
    const t = s.fb.addTab({ url: 'https://example.com/quota', title: 'Quota', html: articleHtml });
    const r = await s.app.onMessage({ type: 'sendTab', tabId: t });
    assert.equal(r.row.status, 'sent');
    assert.equal(s.relay.state.published, 1, 'sent once');
    clock += 12 * 3600000; // due for a re-send, with nothing to re-send (and the Daylight hasn't picked it up)
    await s.app.tick();
    const row = (await st.get('outbox'))[0];
    assert.deepEqual([row.status, row.errorCode], ['expired', 'gone']);
    assert.equal(s.relay.state.published, 1, 'nothing more was published');
    assert.equal((await s.receive()).length, 1, 'the one copy arrives');
    const L = await b.load('logic.js');
    assert.equal(L.statusInfo(row).hint, 'This is no longer stored on this device. Share it again.');
    assert.equal(L.statusInfo(row).retry, null);
  } finally { await s.close(); }
});

test('messages: errors come back as {ok:false}; other extensions are ignored', async () => {
  const s = await setup({ paired: false });
  try {
    const answer = await new Promise((resolve) => {
      const keep = s.app.handleMessage({ type: 'sendTab', tabId: 1 }, { id: 'fake-extension-id' }, resolve);
      assert.equal(keep, true);
    });
    assert.equal(answer.ok, false);
    assert.match(answer.error, /Pair with your Daylight first|No tab/);
    assert.equal(s.app.handleMessage({ type: 'state' }, { id: 'someone-else' }, () => {}), false);
    const st = await new Promise((resolve) => s.app.handleMessage({ type: 'state' }, { id: 'fake-extension-id' }, resolve));
    assert.equal(st.ok, true);
    assert.equal(st.result.paired, false);
  } finally { await s.close(); }
});

test('a local HTML file (file://) goes as an HTML file item', async () => {
  const s = await setup();
  try {
    const t = s.fb.addTab({ url: 'file:///Users/me/Notes/My%20notes.html', title: 'My notes', html: '<html><body>notes</body></html>' });
    const r = await s.app.onMessage({ type: 'sendTab', tabId: t });
    assert.equal(r.row.kind, 'file');
    const [item] = await s.receive();
    assert.equal(item.header.name, 'My notes.html');
    assert.equal(item.header.mime, 'text/html');
    assert.equal(new TextDecoder().decode(item.content), sentHtml('<html><body>notes</body></html>'));
  } finally { await s.close(); }
});

test('Comfort (F27, not Lab): off by default, saved in settings, kept through renaming, pairing changes and unpairing', async () => {
  const s = await setup({ paired: false });
  try {
    const st = async () => (await s.app.onMessage({ type: 'state' }));
    assert.equal((await st()).comfort, false, 'off by default');
    assert.deepEqual(await s.app.onMessage({ type: 'setComfort', comfort: true }), { comfort: true });
    assert.equal((await s.fb.api.storage.local.get('settings')).settings.comfort, true);
    assert.equal((await st()).comfort, true, 'before pairing too');
    await s.app.pair({ input: s.link, from: 'Kitchen Chrome' });
    await s.app.onMessage({ type: 'setName', from: 'Desk Chrome' });
    assert.deepEqual((await s.fb.api.storage.local.get('settings')).settings, { lab: LAB, from: 'Desk Chrome', comfort: true });
    await s.app.pair({ input: await ds.pairingLink({ secret: ds.generateSecret(), relay: s.relay.url }), confirm: true });
    await s.app.unpair();
    assert.equal((await st()).comfort, true, 'pairing changes and unpairing leave it');
    // Saved together, neither change is lost.
    await Promise.all([s.app.onMessage({ type: 'setName', from: 'Laptop Chrome' }), s.app.onMessage({ type: 'setComfort', comfort: false })]);
    assert.deepEqual((await s.fb.api.storage.local.get('settings')).settings, { lab: LAB, from: 'Laptop Chrome', comfort: false });
    assert.equal((await st()).comfort, false);
  } finally { await s.close(); }
});
