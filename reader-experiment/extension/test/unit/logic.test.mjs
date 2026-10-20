import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { built } from '../helpers/built.mjs';

const b = built('chrome');
const L = await b.load('logic.js');
const ds = await b.load('daylight-share.js');
const V = JSON.parse(fs.readFileSync(new URL('../../../share/vectors/test-vectors.json', import.meta.url), 'utf8'));

test('looksLikePdfUrl', () => {
  assert.equal(L.looksLikePdfUrl('https://a.org/papers/x.pdf'), true);
  assert.equal(L.looksLikePdfUrl('https://a.org/papers/X.PDF?dl=1#page=2'), true);
  assert.equal(L.looksLikePdfUrl('https://a.org/a%20b.pdf'), true);
  assert.equal(L.looksLikePdfUrl('https://a.org/pdf/2401.00001'), false);
  assert.equal(L.looksLikePdfUrl('https://a.org/?file=x.pdf'), false);
  assert.equal(L.looksLikePdfUrl('not a url'), false);
});

test('originPattern', () => {
  assert.equal(L.originPattern('https://www.x.org:8443/a/b.pdf?q'), 'https://www.x.org/*');
  assert.equal(L.originPattern('http://127.0.0.1:9000/p.pdf'), 'http://127.0.0.1/*');
  assert.equal(L.originPattern('chrome://settings'), null);
  assert.equal(L.originPattern('nope'), null);
});

test('filenameFromDisposition', () => {
  assert.equal(L.filenameFromDisposition('attachment; filename="report 2026.pdf"'), 'report 2026.pdf');
  assert.equal(L.filenameFromDisposition('inline; filename=plain.pdf'), 'plain.pdf');
  assert.equal(L.filenameFromDisposition("attachment; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf; filename=\"Resume.pdf\""), 'Résumé.pdf');
  assert.equal(L.filenameFromDisposition('attachment; filename="say \\"hi\\".pdf"'), 'say "hi".pdf');
  assert.equal(L.filenameFromDisposition('inline'), '');
  assert.equal(L.filenameFromDisposition(null), '');
});

test('pdfFileName picks the best name and keeps it safe', () => {
  assert.equal(L.pdfFileName({ url: 'https://x.org/a/Quiet%20Paper.pdf' }), 'Quiet Paper.pdf');
  assert.equal(L.pdfFileName({ url: 'https://x.org/dl?id=3', disposition: 'attachment; filename="../../etc/passwd.pdf"' }), 'etc passwd.pdf');
  assert.equal(L.pdfFileName({ url: 'https://arxiv.org/pdf/2401.12345', title: 'Attention: all you need?' }), 'Attention all you need.pdf');
  assert.equal(L.pdfFileName({ url: 'https://arxiv.org/pdf/2401.12345' }), '2401.12345.pdf');
  assert.equal(L.pdfFileName({ url: 'https://x.org/' }), 'document.pdf');
  assert.equal(L.pdfFileName({ url: 'https://x.org/view', title: 'https://x.org/view' }), 'view.pdf');
  const long = L.pdfFileName({ url: `https://x.org/${'a'.repeat(300)}.pdf` });
  assert.ok(long.length <= 120 && long.endsWith('.pdf'), long);
  assert.equal(L.pdfFileName({ url: 'https://x.org/a.PDF' }), 'a.pdf');
});

test('isPdfBytes', () => {
  const enc = (s) => new TextEncoder().encode(s);
  assert.equal(L.isPdfBytes(enc('%PDF-1.7\n...')), true);
  assert.equal(L.isPdfBytes(enc('\n\n  junk %PDF-1.4')), true);
  assert.equal(L.isPdfBytes(enc('<!doctype html><title>Sign in')), false);
  assert.equal(L.isPdfBytes(new Uint8Array(0)), false);
});

test('planForCapture', () => {
  const page = { url: 'https://a.org/x', title: 'X', contentType: 'text/html', html: '<html></html>' };
  assert.deepEqual(L.planForCapture(page, page.url), { kind: 'page' });
  assert.deepEqual(L.planForCapture({ ...page, contentType: 'application/pdf', html: undefined }, page.url), { kind: 'pdf' });
  assert.deepEqual(L.planForCapture({ ...page, html: undefined, tooLarge: true }, page.url), { kind: 'url', reason: 'too-large' });
  assert.deepEqual(L.planForCapture({ ...page, contentType: 'image/png' }, page.url), { kind: 'url', reason: 'media' });
  assert.deepEqual(L.planForCapture(null, 'https://chromewebstore.google.com/detail/x'), { kind: 'url', reason: 'unscriptable' });
  assert.deepEqual(L.planForCapture(null, 'https://a.org/paper.pdf'), { kind: 'pdf' });
  assert.deepEqual(L.planForCapture(null, 'chrome://extensions'), { kind: 'none' });
  assert.deepEqual(L.planForCapture({ ...page, url: 'file:///Users/me/a.html' }, 'file:///Users/me/a.html'), { kind: 'html-file' });
  assert.deepEqual(L.planForCapture({ ...page, url: 'about:blank' }, 'about:blank'), { kind: 'none' });
});

test('names, statuses and labels', () => {
  assert.equal(L.defaultDeviceName('chrome', 'mac'), 'Chrome on Mac');
  assert.equal(L.defaultDeviceName('chrome', 'win'), 'Chrome on Windows');
  assert.equal(L.defaultDeviceName('safari', 'ios'), 'Safari on iPhone');
  assert.equal(L.defaultDeviceName('safari', ''), 'Safari');
  assert.equal(L.kindLabel({ kind: 'file', mime: 'application/pdf' }), 'PDF');
  assert.equal(L.kindLabel({ kind: 'file', name: 'a.epub', mime: 'application/epub+zip' }), 'File');
  assert.equal(L.kindLabel({ kind: 'url' }), 'Link');
  assert.equal(L.displayTitle({ url: 'https://www.a.org/story/' }), 'a.org/story');
  assert.equal(L.relativeTime(1000, 1000 + 10_000), 'just now');
  assert.equal(L.relativeTime(0, 5 * 60_000), '5 min ago');
  assert.equal(L.relativeTime(0, 3 * 3600_000), '3 h ago');
  assert.equal(L.relativeTime(0, 26 * 3600_000), 'yesterday');
});

test('statusInfo follows describeRow for every row of CHANGES-v1.1 2.5 (vectors > statusText)', () => {
  assert.ok(V.statusText.length >= 12);
  const tones = { sending: 'busy', failed: 'busy', sent: 'sent', delivered: 'ok', expired: 'bad' };
  const buttons = { 'retry-now': 'Retry now', 'try-again': 'Try again' };
  for (const c of V.statusText) {
    const info = L.statusInfo(c.row, c.now);
    assert.equal(info.label, c.label, c.name);
    assert.equal(info.hint, c.sentence ?? '', c.name);
    assert.equal(info.action, c.action, c.name);
    assert.equal(info.retry, c.action ? buttons[c.action] : null, `${c.name}: the button`);
    assert.equal(info.tone, tones[c.row.status], `${c.name}: the tone`);
    // After a share: the label, then the sentence.
    const label = /[.…✓]$/.test(c.label) ? c.label : `${c.label}.`;
    assert.equal(L.rowMessage(c.row, c.now), c.sentence ? `${label} ${c.sentence}` : label, c.name);
  }
  const now = Date.now();
  assert.equal(L.rowMessage({ status: 'failed', errorCode: 'network', created: now }, now),
    'Waiting to send. Couldn’t send right now. It will try again by itself.');
  assert.equal(L.rowMessage({ status: 'sent', created: now }, now), 'Sent · waiting for your Daylight.');
  assert.equal(L.rowMessage({ status: 'sending', created: now }, now), 'Sending…');
  assert.equal(L.statusInfo({ status: 'expired', errorCode: 'too-large', size: 14_200_000 }).hint, ds.tooBigMessage(14_200_000));
  assert.equal(L.isTrouble({ status: 'failed' }), true);
  assert.equal(L.isTrouble({ status: 'expired' }), true);
  assert.equal(L.isTrouble({ status: 'sent' }), false);
});

test('PDFs follow the protocol’s one size limit, with the shared notes', () => {
  assert.equal(L.MAX_PDF, ds.MAX_ITEM);
  assert.equal(L.MAX_PDF, 9_000_000);
  assert.equal(L.NOTES['pdf-too-large'], 'The PDF is over 9 MB, so its link was sent.');
  assert.equal(L.NOTES['too-large'], 'The page is larger than 8 MB, so its link was sent.');
});

test('wantsAcks: a row that isn’t delivered and was shared less than 15 days ago (7 days of re-sends + 8 of digests)', () => {
  const now = Date.now();
  const day = 86400000;
  assert.equal(L.ACK_WINDOW_MS, 15 * day);
  assert.equal(L.wantsAcks([], now), false);
  assert.equal(L.wantsAcks(undefined, now), false);
  assert.equal(L.wantsAcks([{ status: 'delivered', created: now }], now), false);
  assert.equal(L.wantsAcks([{ status: 'sent', created: now - day }], now), true);
  assert.equal(L.wantsAcks([{ status: 'expired', created: now - 14 * day }], now), true, 'an expired row can still be acked');
  assert.equal(L.wantsAcks([{ status: 'expired', created: now - 15 * day }], now), false);
  assert.equal(L.wantsAcks([{ status: 'failed', created: now - 16 * day }, { status: 'expired', created: now - 2 * day }], now), true);
});

test('relayForInput: Advanced applies to a typed code; a link names its own relay', async () => {
  const secret = ds.generateSecret();
  const code = await ds.formatCode(secret);
  const link = await ds.pairingLink({ secret, relay: 'https://relay.example.org', name: 'D' });
  const bare = await ds.pairingLink({ secret });
  const at = async (input, adv) => L.relayForInput(await ds.parsePairing(input), input, adv);
  assert.equal(await at(code, ''), 'https://ntfy.sh');
  assert.equal(await at(code, '  '), 'https://ntfy.sh');
  assert.equal(await at(code, 'own.example.net/'), 'https://own.example.net');
  assert.equal(await at(link, 'own.example.net'), 'https://relay.example.org');
  assert.equal(await at(` ${bare.replace('daylightshare', 'DaylightShare')}`, 'own.example.net'), 'https://ntfy.sh');
  assert.throws(() => L.relayForInput({ relay: 'https://ntfy.sh' }, code, 'ftp://x'), (e) => e.code === 'relay');
  assert.equal(L.isPairingLink(link), true);
  assert.equal(L.isPairingLink(code), false);
});
