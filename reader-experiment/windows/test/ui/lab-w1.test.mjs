// Lab's Wave 1 in the Windows window (LAB-PLAN 3.3, Windows parts; card WIN1): dist/index.html in Chromium (WebView2's
// engine) with the window's CSP and a fake bridge in place of Rust (test/helpers/ui.mjs), the mock relay, and Daylights
// from daylight-share.js and daylight-lab.js answering on it.
//
//   F01   the timeline's rows (2.5): the label on every row, the sentence and step line on the newest row and the rows
//         that are not final, the details behind the title elsewhere; "{label}. {sentence}" for screen readers with no
//         step count; the check-in header; a Lab Daylight's In your Reader ✓ after a tick (F01.1, F01.6);
//   F02e  "Send files over 9 MB ›" under the too-big sentence, its needs-server note; none with Lab off (F02e.1);
//   F07   offline: Waiting for connection in the queue, "Waiting to send ({n})" with Cancel; back online it goes (F07.1,
//         F07.2);
//   F09   a send link's question: Send sends, Cancel doesn't; Lab off and not paired say why (F09.3); quick=1 with quick
//         sends off: the needs-quick-sends note under it, whose Open setting opens What's in Lab at the switch, in view
//         with its footer (1.5, 1.6);
//   F16   a dropped text goes whole to smart intake: B1's four normalise.json cases; Lab off, v1.1's findUrl;
//   F26   Setup check: its lines and buttons, the test article followed to the Reader, the activity log, Copy
//         diagnostics (F26.1-3);
//   F33   "Send copied link" shows the host and Send first; its Use switch off is v1.1's command; the tray's words
//         follow (F33.3);
//   6.5 Q5  the Use switches and quick sends on What's in Lab's rows;
//   F27   axe-core on each, light and dark; with Comfort at 100%, 200% and 225% text nothing is clipped.
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/ui/lab-w1.test.mjs   (HEADED=1 to watch)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startUi, ds, kvOf, pairingValue, parityRows, axeBoth, assertNotClipped, shot, scaleText,
} from '../helpers/ui.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const L = await import('../../../share/js/daylight-lab.js');
const S = await import('../../../server/client/daylight-server.js');
const { LAB_TEXT } = L;
const NOW = Date.UTC(2026, 9, 20, 8, 0, 0);
const MIN = 60000;
const H = 60 * MIN;
const ANDROID = (at) => ({ android: { lab: 1, app: 'android/1.5.0', caps: ['reader-link', 'st', 'tap'], poll: at, live: false, at } });

let ui, relay;
before(async () => { relay = await startMockRelay(); ui = await startUi(); });
after(async () => { await ui?.close(); await relay?.close(); });

const stored = (page, key) => page.evaluate((k) => window.__fake.json(k), key);

/**
 * A pairing of its own for each test: the mock relay keeps what earlier tests published, so a test that reads the
 * inbox or ack topic gets only its own frames. -> {secret, pairing (as the store keeps it), kv(settings, extra)}
 */
async function fresh() {
  const secret = ds.generateSecret();
  const pairing = await pairingValue({ relay: relay.url, secret });
  return { secret, pairing, kv: (settings = { lab: true, labNoteShown: true }, extra = {}) => kvOf({ pairing, settings, ...extra }) };
}

/** The parity rows (one per v1.1 state) and three delivered rows a Lab Daylight reported on: reader, waiting, handed. */
function timelineRows(now = NOW) {
  const rows = parityRows(now);
  const base = rows.find((r) => r.id === 'p-delivered');
  const reader = { ...base, id: 'p-reader', kind: 'url', title: 'A story in the Reader', name: '', mime: '', url: 'https://example.com/read', created: now - 30 * MIN, delivered: now - 29 * MIN };
  const waiting = { ...base, id: 'p-waiting', title: 'A PDF that waits for a tap', name: 'Waits.pdf', created: now - 20 * MIN, delivered: now - 19 * MIN };
  return [rows[0], waiting, reader, ...rows.slice(1)];
}

/** A paired store with a Lab Daylight heard 2 minutes ago, its states, and the note already seen. */
async function labStore({ settings = {}, rows = timelineRows(), states = { 'p-reader': { s: 'reader', t: 1 }, 'p-waiting': { s: 'waiting', t: 1 }, 'p-delivered': { s: 'handed', t: 1 } } } = {}) {
  return kvOf({
    pairing: (await fresh()).pairing, outbox: rows,
    settings: { lab: true, labNoteShown: true, ...settings },
    'lab/inbox': ANDROID(NOW - 2 * MIN), 'lab/heard': NOW - 2 * MIN, 'lab/states': states,
  });
}

const rowOf = (page, id) => page.locator(`li[data-id="${id}"]`);

async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('#view-settings:not([hidden])');
}

async function openWhats(page) {
  await openSettings(page);
  await page.getByRole('button', { name: LAB_TEXT.whatsInLab, exact: true }).click();
  await page.waitForSelector('#view-whats:not([hidden]) #whats[data-fresh="1"]', { timeout: 15000 });
}

const feature = (page, id) => page.locator(`li.lab-feature[data-feature="${id}"]`);
const tick = (page) => page.evaluate(() => window.__fake.emit('dls://tick'));
const isVisible = (loc) => loc.evaluate((e) => e.checkVisibility());

// --- F01 the timeline -------------------------------------------------------------------------------------------------

test('F01: the timeline’s rows (2.5): labels everywhere, sentence and step line on the newest row and rows not final, details behind the title; the check-in header; the queue', { timeout: 120000 }, async () => {
  const page = await ui.open({ kv: await labStore(), now: NOW, height: 1400 });
  assert.equal(await page.textContent('#lab-checkin'), 'Your Daylight checked in 2 min ago.');
  // The newest row (sent): its sentence is none (sent < 1 day) and its step line shows.
  const sent = rowOf(page, 'p-sent');
  assert.equal(await sent.locator('.st').textContent(), 'Sent · waiting for your Daylight');
  assert.equal(await sent.locator('.lab-steps').textContent(), 'Sent ✓ · On your Daylight … · In the Reader');
  assert.equal(await isVisible(sent.locator('.lab-steps')), true);
  // Not final (waiting): sentence and step line show.
  const waiting = rowOf(page, 'p-waiting');
  assert.equal(await waiting.locator('.st').textContent(), LAB_TEXT.rows.waiting.label);
  assert.equal(await isVisible(waiting.locator('.sentence')), true);
  assert.equal(await waiting.locator('.sentence').textContent(), LAB_TEXT.rows.waiting.sentence);
  assert.equal(await waiting.locator('.lab-steps').textContent(), 'Sent ✓ · On your Daylight ✓ · In the Reader …');
  // Final and not newest (reader, handed): the label only; the title opens the details.
  const reader = rowOf(page, 'p-reader');
  assert.equal(await reader.locator('.st').textContent(), 'In your Reader ✓');
  assert.equal(await isVisible(reader.locator('.lab-steps')), false);
  const open = reader.getByRole('button', { name: 'A story in the Reader', exact: true });
  assert.equal(await open.getAttribute('aria-expanded'), 'false');
  await open.click();
  assert.equal(await open.getAttribute('aria-expanded'), 'true');
  assert.equal(await isVisible(reader.locator('.lab-steps')), true);
  assert.equal(await reader.locator('.lab-steps').textContent(), 'Sent ✓ · On your Daylight ✓ · In the Reader ✓');
  assert.equal(await rowOf(page, 'p-delivered').locator('.st').textContent(), 'Handed to the Reader');
  // Screen readers (F01.6): "{label}. {sentence}" on every Lab row, never the step line.
  assert.equal(await waiting.locator('.lab-row-a11y').textContent(), `${LAB_TEXT.rows.waiting.label}. ${LAB_TEXT.rows.waiting.sentence}`);
  assert.equal(await reader.locator('.lab-row-a11y').textContent(), 'In your Reader ✓. Saved in the Daylight Reader.');
  const tree = await page.locator('#history').ariaSnapshot();
  assert.ok(!/Sent ✓ ·|On your Daylight ✓ ·/.test(tree), `no step line for screen readers:\n${tree}`);
  assert.ok(tree.includes('Waiting for a tap on your Daylight. Tap its notice on your Daylight to add it to the Reader.'));
  // F07's queue: "Waiting to send (2)" above Recent, with Cancel (and Retry now where it helps).
  const queue = page.getByRole('region', { name: L.fillText(LAB_TEXT.queue.heading, { n: 2 }), exact: true });
  assert.deepEqual(await queue.locator('li').evaluateAll((lis) => lis.map((li) => li.dataset.id)), ['p-failed', 'p-full']);
  assert.equal(await queue.getByRole('button', { name: 'Retry now: A link that waits', exact: true }).count(), 1);
  assert.equal(await queue.getByRole('button', { name: 'Cancel: A link from a busy network', exact: true }).count(), 1);
  assert.equal(await page.locator('#history li[data-id="p-failed"]').count(), 0, 'not in Recent too');
  await axeBoth(page, 'the timeline');
  await shot(page, 'lab-timeline');
  // Cancel removes it (= Remove).
  await queue.getByRole('button', { name: 'Cancel: A link from a busy network', exact: true }).click();
  await page.waitForFunction(() => !window.__fake.json('outbox').some((r) => r.id === 'p-full'));
  await page.waitForSelector('#lab-queue-h:text("Waiting to send (1)")');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('F01.1: a Lab Daylight acks, then reports In your Reader: the row says so after the next check, and its change is announced', { timeout: 60000 }, async () => {
  const f = await fresh();
  const page = await ui.open({ kv: f.kv() });
  const pairing = { secret: f.secret, relay: relay.url };
  const labInbox = new L.LabInbox({
    storage: new ds.MemoryStorage(), relay: new ds.RelayClient({ relay: relay.url }), keys: await ds.deriveKeys(f.secret),
    info: () => ({ lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'], live: false }), from: 'Daylight', autoFlushMs: null,
  });
  const sim = new L.LabInboxSim({ receiver: new ds.Receiver({ pairing, storage: new ds.MemoryStorage() }), labInbox });
  // A send link (F09), answered Send: the link goes.
  await page.evaluate(() => window.__fake.queue({ type: 'send', link: 'daylightshare://send?url=https%3A%2F%2Fexample.com%2Ffresh&title=Fresh' }));
  await page.getByRole('button', { name: LAB_TEXT.automation.send, exact: true }).click();
  await page.waitForSelector('#history li');
  await sim.pollOnce(); // acks first, then reader
  await tick(page);
  const row = page.locator('#history li').first();
  await row.locator('.st:text("In your Reader ✓")').waitFor({ timeout: 10000 });
  assert.equal(await row.locator('.lab-steps').textContent(), 'Sent ✓ · On your Daylight ✓ · In the Reader ✓', 'the newest row shows its step line');
  await page.waitForFunction(() => document.querySelector('#announce').textContent.startsWith('In your Reader ✓: Fresh'));
  assert.equal(await page.textContent('#lab-checkin'), 'Your Daylight checked in just now.');
  // The window shows: no toast (the row says it).
  assert.deepEqual(await page.evaluate(() => window.__fake.notes), []);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// --- F09 send links ------------------------------------------------------------------------------------------------------

test('F09: a send link asks “Send to {name}?” with its title and host; Cancel sends nothing, Send sends; Lab off and unpaired say why', { timeout: 90000 }, async () => {
  const page = await ui.open({ kv: (await fresh()).kv() });
  const link = 'daylightshare://send?url=' + encodeURIComponent('https://example.com/story?utm_source=x') + '&title=A%20story&quick=1';
  await page.evaluate((l) => window.__fake.queue({ type: 'send', link: l }), link);
  const ask = page.getByRole('group', { name: 'Send to Desk Daylight?', exact: true });
  await ask.waitFor();
  assert.deepEqual(await ask.locator('.lab-question-line').allTextContents(), ['A story', 'example.com']);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), LAB_TEXT.automation.send, 'Send has the focus');
  assert.ok(await page.evaluate(() => window.__fake.calls.includes('show_window')), 'the window opens to ask');
  // quick=1 while quick sends are off (the default): the question says why under Send and Cancel.
  assert.equal(await ask.locator('.lab-question-note .lab-note-text').textContent(), LAB_TEXT.needs['needs-quick-sends']);
  await axeBoth(page, 'a send link’s question');
  await shot(page, 'lab-send-link');
  await ask.getByRole('button', { name: LAB_TEXT.automation.cancel, exact: true }).click();
  assert.equal(await ask.count(), 0);
  assert.deepEqual(await stored(page, 'outbox') ?? [], [], 'Cancel sends nothing; quick=1 needs the setting (off by default)');
  await page.evaluate((l) => window.__fake.queue({ type: 'send', link: l }), link);
  await ask.getByRole('button', { name: LAB_TEXT.automation.send, exact: true }).click();
  await page.waitForFunction(() => (window.__fake.json('outbox') ?? []).length === 1);
  const [row] = await stored(page, 'outbox');
  assert.deepEqual([row.url, row.title, row.extras], ['https://example.com/story', 'A story', { 'x-orig': 'https://example.com/story?utm_source=x' }]);
  // Not a web address.
  await page.evaluate(() => window.__fake.queue({ type: 'send', link: 'daylightshare://send?url=C%3A%5Csecret.pdf' }));
  await page.waitForFunction((t) => document.querySelector('#status').textContent === t, LAB_TEXT.automation.notWebAddress);
  // Lab off: the Lab-off sentence.
  await page.evaluate(() => { window.__fake.kv.set('settings', JSON.stringify({ lab: false, labNoteShown: true })); });
  await page.evaluate((l) => window.__fake.queue({ type: 'send', link: l }), link);
  await page.waitForFunction((t) => document.querySelector('#status').textContent === t, 'Turn on Lab in Send to Daylight to use this.');
  assert.equal(await ask.count(), 0);
  await page.context().close();

  const unpaired = await ui.open({ kv: kvOf({ settings: { lab: true, labNoteShown: true } }) });
  await unpaired.evaluate((l) => window.__fake.queue({ type: 'send', link: l }), link);
  await unpaired.waitForFunction((t) => document.querySelector('#pair-error').textContent === t, LAB_TEXT.needs['needs-pairing']);
  await unpaired.context().close();
});

test('F09: quick=1 while “Allow quick sends from other apps” is off: under the question, the needs-quick-sends note with Open setting, which opens What’s in Lab at the switch, in view with its footer, and never changes it', { timeout: 90000 }, async () => {
  const page = await ui.open({ kv: await labStore(), now: NOW, height: 420 });
  const link = 'daylightshare://send?url=' + encodeURIComponent('https://example.com/quick') + '&title=Quick&quick=1';
  const why = LAB_TEXT.needs['needs-quick-sends'];
  assert.equal(L.needsMessage('needs-quick-sends', { platform: 'windows' }), why);
  await page.evaluate((l) => window.__fake.queue({ type: 'send', link: l }), link);
  const ask = page.getByRole('group', { name: 'Send to Desk Daylight?', exact: true });
  await ask.waitFor();
  const box = ask.locator('.lab-question-note');
  // One sentence and one button (1.5), with OK, in a polite live region under Send and Cancel; and the question's
  // description, so a screen reader says it with the question as the focus lands on Send.
  assert.equal(await box.getAttribute('aria-live'), 'polite');
  assert.equal(await box.locator('.lab-note-body').getAttribute('data-state'), 'needs-quick-sends');
  assert.equal(await box.locator('.lab-note-text').textContent(), why);
  assert.deepEqual(await box.locator('button').allTextContents(), [LAB_TEXT.buttons['needs-quick-sends'], LAB_TEXT.noteButton]);
  assert.equal(await ask.evaluate((e) => document.getElementById(e.getAttribute('aria-describedby'))?.textContent), why);
  assert.ok(await ask.evaluate((e) => {
    const send = e.querySelector('.lab-question-send');
    return !!(send.compareDocumentPosition(e.querySelector('.lab-question-note')) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), 'the note comes after Send and Cancel');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), LAB_TEXT.automation.send, 'Send has the focus');
  await axeBoth(page, 'a quick send link’s question with its note');
  await shot(page, 'lab-send-link-quick-off');
  // OK closes the note; the question stays, and Send has the focus.
  await box.getByRole('button', { name: LAB_TEXT.noteButton, exact: true }).click();
  assert.equal(await box.locator('.lab-note-body').count(), 0);
  assert.equal(await ask.count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), LAB_TEXT.automation.send);
  // Closed for this question: Settings and back draw the question again, without it.
  await openSettings(page);
  await page.locator('#close-settings').click();
  await ask.waitFor();
  assert.equal(await box.locator('.lab-note-body').count(), 0);
  // The link again, then Open setting: What's in Lab, its switch focused and in view with its footer, still off.
  await page.evaluate((l) => window.__fake.queue({ type: 'send', link: l }), link);
  await box.locator('.lab-note-text').waitFor();
  await box.getByRole('button', { name: LAB_TEXT.buttons['needs-quick-sends'], exact: true }).click();
  await page.waitForSelector('#view-whats:not([hidden])');
  const quick = feature(page, 'F09').getByRole('switch', { name: LAB_TEXT.automation.quickSends, exact: true });
  await page.waitForFunction(() => document.activeElement?.closest?.('[data-feature="F09"]') && document.activeElement.type === 'checkbox', null, { timeout: 15000 });
  await page.waitForSelector('#whats[data-fresh="1"]', { timeout: 15000 });
  assert.ok(await quick.evaluate((e) => e === document.activeElement), 'the switch has the focus, also after the live answer');
  const inView = await page.evaluate(() => {
    const slot = document.querySelector('li.lab-feature[data-feature="F09"] .lab-use');
    const r = [slot.querySelector('input.switch'), slot.querySelector('.switch-footer')].map((x) => x.getBoundingClientRect());
    return { ok: r.every((b) => b.top >= 0 && b.bottom <= window.innerHeight), scrolled: document.scrollingElement.scrollTop, r: r.map((b) => [b.top, b.bottom]), h: window.innerHeight, sh: document.scrollingElement.scrollHeight };
  });
  assert.ok(inView.ok, 'the switch and its footer are on screen ' + JSON.stringify(inView));
  assert.ok(inView.scrolled > 0, 'scrolled to them (they start below the fold of a 420 px window)');
  assert.equal(await quick.isChecked(), false, 'Open setting never changes it');
  assert.notEqual((await stored(page, 'settings'))?.labQuickSends, true);
  assert.equal(await quick.evaluate((e) => document.getElementById(e.getAttribute('aria-describedby')).textContent), LAB_TEXT.automation.quickSendsFooter);
  await axeBoth(page, 'What’s in Lab opened at quick sends');
  // Turned on here, Back to Settings, Back to the send view: the question is still there, now without the note; Send
  // sends it.
  await quick.click();
  await page.waitForFunction(() => window.__fake.json('settings')?.labQuickSends === true);
  await page.locator('#whats-back').click();
  await page.waitForSelector('#view-settings:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'open-whats');
  await page.locator('#close-settings').click();
  await ask.waitFor();
  assert.equal(await ask.locator('.lab-question-note').count(), 0);
  await ask.getByRole('button', { name: LAB_TEXT.automation.send, exact: true }).click();
  await page.waitForFunction(() => (window.__fake.json('outbox') ?? []).some((r) => r.url === 'https://example.com/quick'));
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// --- F16 a dropped text -------------------------------------------------------------------------------------------------

test('F16: a dropped text goes whole to smart intake (B1): B1’s four normalise.json cases send the vectors’ URLs; with Lab off, v1.1’s findUrl', { timeout: 90000 }, async () => {
  const B1_FOUR = [
    ['See (https://en.wikipedia.org/wiki/Foo_(bar)).', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
    ['He said “https://example.com/q”', 'https://example.com/q'],
    ['Link: ‘https://example.com/s’ and «https://example.com/t»', 'https://example.com/s'],
    ['[https://example.com/x]', 'https://example.com/x'],
  ];
  const drop = (page, text) => page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    document.querySelector('#drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, text);
  const sent = (page, n) => page.waitForFunction((k) => (window.__fake.json('outbox') ?? []).length === k, n);
  const page = await ui.open({ kv: (await fresh()).kv() });
  let n = 0;
  for (const [text] of B1_FOUR) { await drop(page, text); await sent(page, ++n); }
  const rows = (await stored(page, 'outbox')).slice().reverse();
  assert.deepEqual(rows.map((r) => r.url), B1_FOUR.map(([, url]) => url));
  assert.equal(rows[0].title, 'See', 'the words around the link are its title');
  // Lab off: v1.1 exactly, which cut the Wikipedia link short.
  await page.evaluate(() => { window.__fake.kv.set('settings', JSON.stringify({ lab: false, labNoteShown: true })); });
  await drop(page, B1_FOUR[0][0]);
  await sent(page, ++n);
  const [off] = await stored(page, 'outbox');
  assert.deepEqual([off.url, off.title], [ds.findUrl(B1_FOUR[0][0]), '']);
  assert.equal(off.url, 'https://en.wikipedia.org/wiki/Foo_(bar');
  // No address in it: the drop's own sentence.
  await drop(page, 'no address here');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Only files and web links (http and https) can be sent.');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// --- F33 the copied link --------------------------------------------------------------------------------------------------

test('F33: “Send copied link” reads the clipboard on the click and shows the host with Send first; its Use switch off is v1.1’s command', { timeout: 90000 }, async () => {
  const clipboard = 'Quiet reading https://www.example.com/a?utm_source=news&id=2';
  const page = await ui.open({ kv: (await fresh()).kv(), clipboard });
  const button = page.getByRole('button', { name: LAB_TEXT.copiedLink.chip, exact: true });
  assert.equal(await button.count(), 1);
  await page.waitForFunction((t) => window.__fake.trayLabel === t, LAB_TEXT.copiedLink.chip);
  await button.click();
  const ask = page.getByRole('group', { name: 'Send example.com to Desk Daylight?', exact: true });
  await ask.waitFor();
  assert.deepEqual(await stored(page, 'outbox') ?? [], [], 'nothing is sent before Send');
  await axeBoth(page, 'the copied link’s question');
  await shot(page, 'lab-copied-link');
  await ask.getByRole('button', { name: LAB_TEXT.automation.cancel, exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'send-clip');
  await button.click();
  await ask.getByRole('button', { name: LAB_TEXT.automation.send, exact: true }).click();
  await page.waitForFunction(() => (window.__fake.json('outbox') ?? []).length === 1);
  const [row] = await stored(page, 'outbox');
  assert.deepEqual([row.url, row.title], ['https://www.example.com/a?id=2', 'Quiet reading']);
  // F33's Use switch, in What's in Lab: off, the window's button is v1.1's command again, and so is the tray's entry.
  await openWhats(page);
  const use = feature(page, 'F33').getByRole('switch', { name: L.fillText(LAB_TEXT.use.a11y, { feature: LAB_TEXT.features.F33.name }), exact: true });
  assert.equal(await use.isChecked(), true);
  await use.click();
  await page.waitForFunction(() => window.__fake.json('settings')?.labUse?.F33 === false);
  await page.waitForFunction(() => window.__fake.trayLabel === 'Send clipboard link');
  await page.locator('#whats-back').click();
  await page.locator('#close-settings').click();
  await page.getByRole('button', { name: 'Send the link on the clipboard', exact: true }).click();
  await page.waitForFunction(() => (window.__fake.json('outbox') ?? []).length === 2);
  assert.equal(await page.locator('.lab-question-body').count(), 0, 'no question: v1.1’s command sends at once');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// --- F02's entry point and F07 offline -------------------------------------------------------------------------------------

test('F02e.1: a file refused as too big shows the too-big sentence and, with Lab on, “Send files over 9 MB ›”: needs-server, Copy Server code; none with Lab off', { timeout: 90000 }, async () => {
  const big = 'C:\\Users\\you\\Scans\\Big scan.pdf';
  for (const lab of [true, false]) {
    const f = await fresh();
    const page = await ui.open({ kv: f.kv({ lab, labNoteShown: true }), bigFiles: { [big]: 14200000 } });
    await page.evaluate((p) => window.__fake.queue({ type: 'files', paths: [p] }), big);
    await page.waitForFunction(() => /Too big to send/.test(document.querySelector('#status').textContent));
    assert.equal(await page.textContent('#status'), `Couldn’t send Big scan.pdf: ${ds.tooBigMessage(14200000)}`);
    const entry = page.getByRole('button', { name: LAB_TEXT.bigFiles, exact: true });
    if (!lab) {
      assert.equal(await entry.count(), 0, 'Lab off: v1.1’s screen');
      await page.context().close();
      continue;
    }
    await entry.click();
    await page.waitForSelector('#lab-after .lab-note-body[data-state="needs-server"]', { timeout: 6000 });
    assert.equal(await page.textContent('#lab-after .lab-note-text'), LAB_TEXT.needs['needs-server']);
    await page.getByRole('button', { name: LAB_TEXT.buttons['needs-server'], exact: true }).click();
    await page.waitForSelector('#lab-after .lab-note-follow');
    const code = await S.formatServerCode(await S.deriveServerSeed(f.secret), { relay: relay.url });
    assert.deepEqual(await page.evaluate(() => window.__fake.clipboard), [code]);
    await axeBoth(page, 'F02’s entry point with its note');
    await shot(page, 'lab-big-files');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  }
});

test('F07: offline, a share waits in “Waiting to send (1)” as Waiting for connection, with Cancel; back online it goes', { timeout: 90000 }, async () => {
  const page = await ui.open({ kv: (await fresh()).kv() });
  await page.context().setOffline(true);
  await page.evaluate(() => window.__fake.queue({ type: 'clipboard', text: 'https://example.com/offline', error: '' }));
  const queue = page.getByRole('region', { name: L.fillText(LAB_TEXT.queue.heading, { n: 1 }), exact: true });
  await queue.waitFor();
  const row = queue.locator('li').first();
  assert.equal(await row.locator('.st').textContent(), LAB_TEXT.rows.offline.label);
  assert.equal(await row.locator('.sentence').textContent(), LAB_TEXT.rows.offline.sentence);
  assert.equal(await row.getByRole('button', { name: 'Cancel: example.com/offline', exact: true }).count(), 1);
  assert.equal(await row.locator('.retry').count(), 0, 'no Retry now while offline: it goes by itself');
  assert.equal(await page.textContent('#status'), `${LAB_TEXT.rows.offline.label}. ${LAB_TEXT.rows.offline.sentence}`);
  const [stored1] = await stored(page, 'outbox');
  assert.deepEqual([stored1.status, stored1.errorCode, stored1.attempts], ['failed', 'network', 0], 'deferred: nothing was published');
  await axeBoth(page, 'offline, the queue');
  await shot(page, 'lab-offline');
  await page.context().setOffline(false);
  await page.waitForFunction(() => window.__fake.json('outbox')?.[0]?.status === 'sent', null, { timeout: 15000 });
  await page.waitForSelector('#lab-queue[hidden]', { state: 'attached' });
  assert.equal(await page.locator('#history li .st').first().textContent(), 'Sent · waiting for your Daylight');
  assert.deepEqual(page.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
  await page.context().close();
});

// --- What's in Lab's switches and F26 Setup check ----------------------------------------------------------------------------

test('6.5 Q5 and F09: What’s in Lab’s Use switches (Clean links, Send copied link) and “Allow quick sends from other apps”, each with its footer', { timeout: 90000 }, async () => {
  const page = await ui.open({ kv: await labStore(), now: NOW });
  await openWhats(page);
  for (const id of ['F16', 'F33']) {
    const sw = feature(page, id).getByRole('switch', { name: L.fillText(LAB_TEXT.use.a11y, { feature: LAB_TEXT.features[id].name }), exact: true });
    assert.equal(await sw.isChecked(), true, `${id} on by default`);
    assert.equal(await sw.evaluate((e) => document.getElementById(e.getAttribute('aria-describedby')).textContent), LAB_TEXT.use.footers[id]);
    assert.equal(await feature(page, id).locator('label').textContent(), LAB_TEXT.use.label);
  }
  for (const id of ['F01', 'F07', 'F26']) assert.equal(await feature(page, id).locator('input').count(), 0, `${id} has no switch`);
  const quick = feature(page, 'F09').getByRole('switch', { name: LAB_TEXT.automation.quickSends, exact: true });
  assert.equal(await quick.isChecked(), false, 'off by default');
  assert.equal(await quick.evaluate((e) => document.getElementById(e.getAttribute('aria-describedby')).textContent), LAB_TEXT.automation.quickSendsFooter);
  // Short states: the Lab Daylight speaks Lab, so everything is Ready.
  assert.deepEqual(await page.locator('li.lab-feature .lab-short').allTextContents(), ['Ready', 'Ready', 'Ready', 'Ready', 'Ready', 'Ready']);
  await axeBoth(page, 'What’s in Lab with its switches');
  await shot(page, 'lab-whats-w1');
  await quick.click();
  await page.waitForFunction(() => window.__fake.json('settings')?.labQuickSends === true);
  const clean = feature(page, 'F16').getByRole('switch');
  await clean.click();
  await page.waitForFunction(() => window.__fake.json('settings')?.labUse?.F16 === false);
  // A Ready feature with a switch: a click on the row moves the focus to it.
  await feature(page, 'F09').locator('.lab-row').click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === null && document.activeElement?.closest?.('[data-feature="F09"]') && document.activeElement.type === 'checkbox');
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('F26: Setup check’s lines and buttons, the test article followed to the Reader, the activity log and Copy diagnostics', { timeout: 120000 }, async () => {
  const info = { version: '1.2.0', e2e: { pair: null, status: false, lab: null }, sendTo: { path: 'C:\\Users\\you\\AppData\\Roaming\\Microsoft\\Windows\\SendTo\\Daylight.lnk', exists: true, error: '' }, autostart: false };
  const f = await fresh();
  const page = await ui.open({ kv: f.kv(), info, notifications: 'off', height: 1200 });
  await openWhats(page);
  await feature(page, 'F26').locator('.lab-row').click();
  await page.waitForSelector('#view-setup:not([hidden]) .lab-checks');
  assert.equal(await page.textContent('#setup-h'), LAB_TEXT.setup.title);
  assert.deepEqual(await page.locator('.lab-check-text').allTextContents(), ['✓ Pairing', '✓ Send to shortcut', '! Open at login', '✓ Hotkey', '! Notifications']);
  await axeBoth(page, 'Setup check');
  await shot(page, 'lab-setup');
  // Each unmet check has a button that opens where it is set (F26.3): Windows' Settings, or this app's.
  await page.getByRole('button', { name: `${LAB_TEXT.buttons['needs-notifications']}: ${LAB_TEXT.setup.checks.notifications}`, exact: true }).click();
  await page.waitForFunction(() => window.__fake.openedSettings === 1);
  // The test article (F26.1): it goes, and the checklist follows it along the timeline.
  await page.getByRole('button', { name: LAB_TEXT.setup.testSend, exact: true }).click();
  await page.waitForSelector('.lab-test-title');
  assert.equal(await page.textContent('.lab-test-title'), 'Test article from Windows PC');
  assert.equal(await page.textContent('.lab-test-label'), 'Sent · waiting for your Daylight');
  assert.equal(await page.textContent('.lab-test-footer'), LAB_TEXT.setup.testFooter);
  const labInbox = new L.LabInbox({
    storage: new ds.MemoryStorage(), relay: new ds.RelayClient({ relay: relay.url }), keys: await ds.deriveKeys(f.secret),
    info: () => ({ lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'], live: false }), from: 'Daylight', autoFlushMs: null,
  });
  const got = await new L.LabInboxSim({ receiver: new ds.Receiver({ pairing: { secret: f.secret, relay: relay.url }, storage: new ds.MemoryStorage() }), labInbox }).pollOnce();
  assert.deepEqual(got.items.map((i) => [i.header.kind, i.extras['x-cap']]), [['page', 'test']]);
  await tick(page);
  await page.waitForFunction(() => [...document.querySelectorAll('.lab-test-tick')].length === 2, null, { timeout: 10000 });
  assert.deepEqual(await page.locator('.lab-test-tick').allTextContents(), [`✓ ${LAB_TEXT.setup.delivered}`, `✓ ${LAB_TEXT.setup.inReader}`]);
  assert.equal(await page.textContent('.lab-test-label'), 'In your Reader ✓');
  // The activity log: events, newest first, with no title or address.
  await page.locator('.lab-activity summary').click();
  const lines = await page.locator('.lab-activity-list li').allTextContents();
  assert.ok(lines.length >= 3, lines.join('\n'));
  assert.match(lines[0], / state [0-9a-f]{8} page reader -$/);
  assert.ok(lines.every((l) => !/http|Test article/.test(l)));
  // Copy diagnostics (F26.2): redacted.
  await page.getByRole('button', { name: LAB_TEXT.setup.copyDiagnostics, exact: true }).click();
  await page.waitForFunction((t) => document.querySelector('.lab-diagnostics-said').textContent === t, LAB_TEXT.setup.copied);
  const text = (await page.evaluate(() => window.__fake.clipboard)).at(-1);
  assert.match(text, /^Send to Daylight diagnostics\nApp: Send to Daylight 1\.2\.0 \(windows\)\nLab: on\n/);
  for (const no of ['http', 'Test article', f.pairing.code, 'Desk Daylight']) assert.ok(!text.includes(no), `no ${no} in the diagnostics`);
  await axeBoth(page, 'Setup check with the test article and the activity log');
  await shot(page, 'lab-setup-done');
  // Open setting for start at login: Settings, at that setting, which it doesn't change.
  await page.getByRole('button', { name: `${LAB_TEXT.buttons['needs-quick-sends']}: ${LAB_TEXT.setup.checks.loginItem}`, exact: true }).click();
  await page.waitForSelector('#view-settings:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'autostart');
  assert.equal(await page.isChecked('#autostart'), false);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('F01’s Needs Lab on your Daylight: with no hello, the timeline row in What’s in Lab says so, and a click says how', { timeout: 60000 }, async () => {
  const page = await ui.open({ kv: (await fresh()).kv() });
  await openWhats(page);
  assert.equal(await feature(page, 'F01').locator('.lab-short').textContent(), LAB_TEXT.short['needs-inbox']);
  await feature(page, 'F01').locator('.lab-row').click();
  await page.waitForSelector('.lab-note-body[data-state="needs-inbox"]');
  assert.equal(await feature(page, 'F01').locator('.lab-note-text').textContent(), LAB_TEXT.needs['needs-inbox']);
  await page.context().close();
});

// --- F27 with Comfort --------------------------------------------------------------------------------------------------------

for (const scale of [1, 2, 2.25]) {
  const pct = `${Math.round(scale * 100)}%`;
  test(`with Comfort at ${pct} text, Wave 1’s views clip nothing at the narrowest window (the note, the timeline and queue, the questions, F02’s entry, What’s in Lab’s switches, Setup check)`, { timeout: 180000 }, async () => {
    const kv = await labStore({ settings: { comfort: true, labNoteShown: false } });
    const page = await ui.open({ kv, now: NOW, clipboard: 'https://www.a-very-long-host-name-for-a-narrow-window.example.org/path', bigFiles: { 'C:\\big.pdf': 14200000 }, notifications: 'off' });
    await scaleText(page, scale);
    const check = async (what) => {
      await assertNotClipped(page, `${what}, Comfort, ${pct} text`);
      if (scale === 1) await axeBoth(page, `${what}, Comfort`);
    };
    await page.locator('#lab-note .lab-note-body').waitFor();
    // Every final row open, so its details are checked too.
    for (const b of await page.locator('.item-open').all()) await b.click();
    await check('the send view: the note, the timeline, the queue');
    await page.locator('#send-clip').click();
    await page.locator('#lab-clip .lab-question-body').waitFor();
    // quick=1 with quick sends off: the question carries the needs-quick-sends note and Open setting.
    await page.evaluate(() => window.__fake.queue({ type: 'send', link: 'daylightshare://send?url=https%3A%2F%2Fwww.example.org%2Fa-long-path&title=A%20title%20long%20enough%20to%20wrap%20at%20large%20text%20sizes&quick=1' }));
    await page.locator('#lab-sendlink .lab-question-note .lab-note-body').waitFor();
    await page.evaluate(() => window.__fake.queue({ type: 'files', paths: ['C:\\big.pdf'] }));
    await page.locator('#lab-after .nav-row').waitFor();
    await page.locator('#lab-after .nav-row').click();
    await page.locator('#lab-after .lab-note-body').waitFor({ timeout: 6000 });
    await check('the send view: both questions and F02’s entry with its note');
    await shot(page, `lab-send-w1-${pct.replace('%', '')}-comfort`);
    await openWhats(page);
    await check('What’s in Lab with its switches');
    await feature(page, 'F26').locator('.lab-row').click();
    await page.waitForSelector('#view-setup:not([hidden]) .lab-checks');
    await page.getByRole('button', { name: LAB_TEXT.setup.testSend, exact: true }).click();
    await page.waitForSelector('.lab-test-title');
    await page.locator('.lab-activity summary').click();
    await check('Setup check with the test article and the activity log');
    await shot(page, `lab-setup-${pct.replace('%', '')}-comfort`);
    assert.deepEqual(page.errors.filter((e) => !/Failed to load resource/.test(e)), []);
    await page.context().close();
  });
}

test('switching Lab off or on changes the rows’ words without announcing them as new states', { timeout: 60000 }, async () => {
  const page = await ui.open({ kv: await labStore(), now: NOW });
  await page.waitForTimeout(300);
  assert.equal(await page.textContent('#announce'), '');
  for (const on of [false, true]) {
    await openSettings(page);
    await page.getByRole('switch', { name: LAB_TEXT.lab, exact: true }).click();
    await page.waitForFunction((v) => window.__fake.json('settings')?.lab === v, on);
    await page.locator('#close-settings').click();
    await page.waitForSelector('#view-send:not([hidden])');
    await page.waitForTimeout(300);
    assert.equal(await rowOf(page, 'p-reader').locator('.st').textContent(), on ? 'In your Reader ✓' : 'Delivered ✓');
    assert.equal(await page.textContent('#announce'), '', `Lab ${on ? 'on' : 'off'}: nothing said`);
  }
  await page.context().close();
});

test('F01’s toast: a link that reaches the Reader while the window is in the notification area shows “In your Reader: {title}”', { timeout: 60000 }, async () => {
  const f = await fresh();
  const page = await ui.open({ kv: f.kv() });
  // Rust hides the window to the notification area and says so (WebView2 still tells the page it is visible).
  await page.evaluate(() => { window.__fake.shown = false; window.__fake.emit('dls://shown', false); });
  const labInbox = new L.LabInbox({
    storage: new ds.MemoryStorage(), relay: new ds.RelayClient({ relay: relay.url }), keys: await ds.deriveKeys(f.secret),
    info: () => ({ lab: 1, app: 'android/1.5.0', caps: ['st', 'tap', 'reader-link'], live: false }), from: 'Daylight', autoFlushMs: null,
  });
  const sim = new L.LabInboxSim({ receiver: new ds.Receiver({ pairing: { secret: f.secret, relay: relay.url }, storage: new ds.MemoryStorage() }), labInbox });
  await page.evaluate(() => window.__fake.queue({ type: 'clipboard', text: 'Calm reading https://example.com/calm', error: '' }));
  await page.waitForFunction(() => (window.__fake.json('outbox') ?? []).length === 1);
  await sim.pollOnce();
  await tick(page);
  await page.waitForFunction(() => window.__fake.notes.some((n) => n.title.startsWith('In your Reader:')), null, { timeout: 10000 });
  const toast = (await page.evaluate(() => window.__fake.notes)).find((n) => n.title.startsWith('In your Reader:'));
  assert.deepEqual(toast, { title: L.fillText(LAB_TEXT.readerToast, { title: 'Calm reading' }), body: LAB_TEXT.rows.reader.sentence });
  assert.deepEqual((await page.evaluate(() => window.__fake.notes)).map((n) => n.title), ['Sent to Desk Daylight', 'In your Reader: Calm reading'], 'the hotkey’s “Sent to {name}” (F08), then the toast, once');
  await page.context().close();
});
