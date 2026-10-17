import { test } from 'node:test';
import assert from 'node:assert/strict';
import { built } from '../helpers/built.mjs';

const b = built('chrome');
const L = await b.load('logic.js');

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
  assert.equal(L.statusInfo({ status: 'sending' }).label, 'Sending…');
  assert.equal(L.statusInfo({ status: 'sent' }).label, 'Sent');
  assert.equal(L.statusInfo({ status: 'delivered' }).label, 'Delivered ✓');
  assert.deepEqual([L.statusInfo({ status: 'failed' }).label, L.statusInfo({ status: 'failed' }).retry], ['Not delivered', true]);
  assert.equal(L.statusInfo({ status: 'expired' }).retry, true);
  assert.equal(L.kindLabel({ kind: 'file', mime: 'application/pdf' }), 'PDF');
  assert.equal(L.kindLabel({ kind: 'file', name: 'a.epub', mime: 'application/epub+zip' }), 'File');
  assert.equal(L.kindLabel({ kind: 'url' }), 'Link');
  assert.equal(L.displayTitle({ url: 'https://www.a.org/story/' }), 'a.org/story');
  assert.equal(L.relativeTime(1000, 1000 + 10_000), 'just now');
  assert.equal(L.relativeTime(0, 5 * 60_000), '5 min ago');
  assert.equal(L.relativeTime(0, 3 * 3600_000), '3 h ago');
  assert.equal(L.relativeTime(0, 26 * 3600_000), 'yesterday');
});
