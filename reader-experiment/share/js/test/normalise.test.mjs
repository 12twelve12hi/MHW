// W1 (L1) of the Lab reference: smart intake (F16), excerpts (F11), the test article and diagnostics (F26), the Inbox's
// row lines and the Use switches. First the vectors, as every port runs them (normalise.json; lab-vectors.json's
// labExcerpt, diagnostics, testArticle and the W1 labText cases), then what no vector can pin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as ds from '../daylight-share.js';
import * as lab from '../daylight-lab.js';
import { startMockRelay } from '../mock-relay.mjs';

const N = JSON.parse(readFileSync(new URL('../../vectors/normalise.json', import.meta.url), 'utf8'));
const V = JSON.parse(readFileSync(new URL('../../vectors/lab-vectors.json', import.meta.url), 'utf8'));
const PV = JSON.parse(readFileSync(new URL('../../vectors/test-vectors.json', import.meta.url), 'utf8'));
const secret1 = ds.fromHex(PV.pairing[0].secretHex);
const sha = (s) => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------------------------------------------------------
// Vectors

test('normalise vectors: at least 50 cases, each exactly (F16.1)', () => {
  assert.ok(N.cases.length >= 50);
  for (const c of N.cases) assert.deepEqual(lab.normaliseShare(c.input), c.expect, c.name);
});

test('normalise vectors: the headline + link shares stay links with the headline as title (F11.5, F16.1)', () => {
  const shares = N.cases.filter((c) => /^(NYT|Guardian|Apple News|Substack|X:|Chrome on Android)/.test(c.name));
  assert.ok(shares.length >= 10);
  for (const c of shares) assert.equal(c.expect.kind, 'link', c.name);
  for (const c of shares.filter((x) => x.input.text && !x.input.text.startsWith('http'))) assert.ok(c.expect.title, c.name);
});

test('normalise vectors: x-orig on part 0, left out over 1,024 characters or when it would make a frame large (2.3)', async () => {
  const keys = await ds.deriveKeys(createHash('sha256').update('vector-secret-1').digest().subarray(0, 16));
  const id = createHash('sha256').update('x-orig-id').digest('hex').slice(0, 32);
  for (const c of N.xOrigFrames) {
    const { contentHex, contentText, ...item } = c.item;
    const content = contentHex ? ds.fromHex(contentHex) : contentText;
    const built = await ds.buildItemFrames(keys, { ...item, id, sent: '2026-10-20T08:00:00.000Z', content, extras: c.extras }, { compress: false });
    const { header } = await ds.decryptFrame(keys, 'inbox', built.frames[0]);
    assert.deepEqual(Object.fromEntries(Object.entries(header).filter(([k]) => k.startsWith('x-'))), c.expect.fields, c.name);
    assert.deepEqual(built.extras, c.expect.fields, c.name);
    assert.equal(ds.isSmallFrame(built.frames[0]), c.expect.small, c.name);
    // and a receiver reads them back as extras (2.3)
    assert.deepEqual(ds.checkItemHeader(header).extras, c.expect.fields, c.name);
  }
});

test('normalise vectors: Apple News pages', () => {
  for (const c of N.appleNews) assert.equal(lab.extractAppleNewsTarget(c.html), c.expect, c.name);
});

test('labExcerpt vectors: items, sanitiser, text, fragments, dates, names and classifyShare (F11.3, F11.5)', () => {
  const E = V.labExcerpt;
  for (const c of E.items) assert.deepEqual(lab.excerptItem(c.input), c.expect, c.name);
  for (const c of E.sanitize) assert.deepEqual(lab.sanitizeExcerptHtml(c.html, c.maxChars), c.expect, c.name);
  for (const c of E.textHtml) assert.deepEqual(lab.excerptTextHtml(c.text, c.maxChars), c.expect, c.name);
  for (const c of E.fragments) assert.equal(lab.textFragment(c.url, c.text), c.expect, c.name);
  for (const c of E.dates) assert.equal(lab.excerptDate(c.date), c.expect, String(c.date));
  for (const c of E.fileNames) assert.equal(lab.excerptFileName(c.text, { note: c.note }), c.expect, c.name);
  for (const c of E.classify) assert.deepEqual(lab.classifyShare(c.input), c.expect, c.name);
  const links = E.classify.filter((c) => !/^rule [123]/.test(c.name) && c.name !== 'nothing');
  assert.ok(links.length >= 7);
  for (const c of links) assert.equal(c.expect.kind, 'link', `F11.5: ${c.name}`);
  const L = E.limits;
  const text = L.input.textRepeat.repeat(L.input.times).trim();
  const pin = (s, want, what) => { assert.equal(s.length, want.length, what); assert.equal(sha(s), want.sha256, what); assert.ok(s.endsWith(want.tail), what); };
  pin(lab.excerptItem({ text, url: L.input.url, pageTitle: L.input.pageTitle, date: L.input.date }).content, L.textItem, 'text');
  pin(lab.excerptItem({ text, html: `<p>${text}</p>`, url: L.input.url, pageTitle: L.input.pageTitle, date: L.input.date }).content, L.htmlItem, 'html');
  pin(lab.excerptMarkdown({ text, app: L.input.app, date: L.input.date }), L.note, 'note');
});

test('diagnostics vectors: redaction, activity lines and reports (F26.2)', () => {
  const D = V.diagnostics;
  for (const c of D.redact) assert.equal(lab.redactDiagnostics(c.text), c.expect, c.text);
  for (const c of D.activity) assert.equal(lab.activityLine(c.event), c.line);
  for (const c of D.reports) assert.equal(lab.diagnosticsReport(c.input), c.expect);
});

test('testArticle vectors (F26)', () => {
  for (const c of V.testArticle) assert.deepEqual(lab.testArticle(c.input), c.expect);
});

test('labText W1 vectors: Inbox row lines, cleaned-from, Use switches', () => {
  for (const c of V.labText.kindLines) assert.equal(lab.inboxKindLine(c.input), c.expect, JSON.stringify(c.input));
  for (const c of V.labText.cleanedFrom) assert.equal(lab.cleanedFromText(c.orig), c.expect, String(c.orig));
  for (const c of V.labText.use) assert.equal(lab.labUseOn(c.settings, c.feature), c.expect, JSON.stringify(c));
  assert.deepEqual(V.labText.useFeatures.map((u) => u.id), lab.USE_FEATURES);
  for (const id of lab.USE_FEATURES) assert.ok(lab.LAB_TEXT.use.footers[id], id);
});

// ---------------------------------------------------------------------------------------------------------------
// What the vectors cannot pin

test('F16.3: a URL whose only change is removed tracking parameters is otherwise byte-identical', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const names = ['a', 'id', 'Q', 'page', 'utm_source', 'utm_x', 'fbclid', 'gclid', 'si', 's', 't', 'smid', 'r', 'keep_me', 'UTM_source', ''];
  const hosts = ['example.com', 'www.youtube.com', 'x.com', 'www.nytimes.com', 'jane.substack.com', 'Example.ORG:8443'];
  for (let i = 0; i < 400; i++) {
    const host = hosts[rnd(hosts.length)];
    const pieces = Array.from({ length: rnd(6) }, () => {
      const n = names[rnd(names.length)];
      return rnd(4) === 0 ? n : `${n}=${['1', 'A%20b', '', 'x=y'][rnd(4)]}`;
    });
    const frag = rnd(3) === 0 ? '#Frag-' + i : '';
    const url = `https://${host}/Path/${i}${pieces.length || rnd(2) ? '?' + pieces.join('&') : ''}${frag}`;
    const out = lab.cleanShareUrl(url);
    const tracked = (p) => {
      const n = p.split('=')[0], h = host.toLowerCase().split(':')[0];
      return n.startsWith('utm_') || lab.TRACKING_PARAMS.includes(n) || (n === 'si' && /youtube\.com$/.test(h))
        || (['s', 't'].includes(n) && h === 'x.com') || (n === 'smid' && /nytimes\.com$/.test(h)) || (n === 'r' && h.endsWith('.substack.com'));
    };
    if (!pieces.some(tracked)) { assert.equal(out, url, url); continue; }
    const kept = pieces.filter((p) => !tracked(p) && p !== '').join('&');
    assert.equal(out, `https://${host}/Path/${i}${kept ? '?' + kept : ''}${frag}`, url);
  }
});

test('normaliseShare: a headline is always a title, however long; excerpts need an explicit selection (6.5 Q1 b)', () => {
  const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ') + '. Another sentence. And a third!';
  const r = lab.normaliseShare({ text: `${long} https://example.com/x` });
  assert.equal(r.kind, 'link');
  assert.equal(r.excerpt, null);
  assert.ok(r.title.startsWith('word0 word1'));
  assert.equal([...r.title].length, ds.MAX_TITLE);
  const s = lab.normaliseShare({ text: long, url: 'https://example.com/x', source: 'selection' });
  assert.equal(s.kind, 'excerpt');
  assert.equal(s.title, null);
  assert.equal(s.excerpt, long);
});

test('normaliseShare: a text fragment alone never makes an excerpt; the title or subject stays (6.5 Q1 b)', () => {
  // Chrome on Android sharing a page opened from a Google result (Google adds the fragment)
  const g = lab.normaliseShare({ text: 'How to bake bread - BBC Food\nhttps://www.bbc.co.uk/food/bread#:~:text=Knead%20the%20dough' });
  assert.deepEqual(g, { kind: 'link', url: 'https://www.bbc.co.uk/food/bread#:~:text=Knead%20the%20dough', title: 'How to bake bread - BBC Food', excerpt: null, orig: null });
  // a bare URL with a fragment (the copied link, the URL scheme, intents, the command line)
  for (const input of [{ url: 'https://example.com/a#:~:text=hello' }, { text: 'https://example.com/a#:~:text=hello' }]) {
    const n = lab.normaliseShare(input);
    assert.equal(n.kind, 'link');
    assert.equal(n.excerpt, null);
    assert.equal(lab.normaliseShare({ ...input, subject: 'My title' }).title, 'My title');
  }
  // the same shares with "Send as excerpt" (source: 'selection') are excerpts
  const quoted = '“Knead the dough.”\nhttps://example.com/bread#:~:text=Knead%20the%20dough';
  assert.equal(lab.normaliseShare({ text: quoted }).kind, 'link');
  assert.deepEqual(lab.normaliseShare({ text: quoted, source: 'selection' }),
    { kind: 'excerpt', url: 'https://example.com/bread#:~:text=Knead%20the%20dough', title: null, excerpt: 'Knead the dough.', orig: null });
  assert.equal(lab.normaliseShare({ url: 'https://example.com/a#:~:text=hello', source: 'selection' }).excerpt, 'hello');
});

test('excerpts: only allowed tags survive hostile selection HTML, and nothing escapes the blockquote (F11.3)', () => {
  const hostile = [
    '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', '<a href="java&#115;cript:alert(1)">x</a>',
    '<a href=" javascript:alert(1)">x</a>', '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    '</blockquote></article><script>alert(1)</script>', '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<p style="background:url(javascript:alert(1))">x</p>', '<a href="https://ok.example/" onclick="alert(1)">ok</a>',
    '<<script>script>alert(1)<</script>/script>', '<scr<script>ipt>alert(1)</scr</script>ipt>', '<p\nonmouseover=alert(1)>x</p>',
  ];
  for (const h of hostile) {
    const { html } = lab.sanitizeExcerptHtml(h);
    for (const m of html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
      assert.ok(lab.EXCERPT_TAGS.includes(m[1]), `${h} -> ${html}`);
      assert.ok(m[2] === '' || /^ href="https?:\/\/[^"]*"$/.test(m[2]), `${h} -> ${html}`);
    }
    assert.ok(!/<script|javascript:|onerror|onload|onclick|onmouseover=/i.test(html.replace(/&lt;[^&]*&gt;|&lt;/g, '')), `${h} -> ${html}`);
    const doc = lab.excerptHtml({ text: 'x', html: h, url: 'https://example.com/' });
    assert.equal(doc.split('</blockquote>').length, 2, `${h}: one blockquote`);
    assert.ok(doc.endsWith('</blockquote></article></body></html>'));
  }
});

test('hostile input stays linear: no rule backtracks over a long run', () => {
  const inputs = [
    () => lab.sanitizeExcerptHtml('<a "'.repeat(60000)),
    () => lab.sanitizeExcerptHtml('<p title="'.repeat(30000) + '>'),
    () => lab.sanitizeExcerptHtml('<!--'.repeat(50000)),
    () => lab.sanitizeExcerptHtml('<script>'.repeat(30000)),
    () => lab.normaliseShare({ text: 'see http://e.com/' + ')'.repeat(200000) }),
    () => lab.normaliseShare({ text: '-'.repeat(200000) + 'x https://e.com/a' }),
    () => lab.normaliseShare({ text: '. '.repeat(100000) + 'https://e.com/a' }),
    () => lab.extractAppleNewsTarget('<body>' + '<a "'.repeat(60000)),
    () => lab.extractAppleNewsTarget('redirectToUrlAfterTimeout("' + 'x'.repeat(200000)),
    // found in review: the drop pass, a tag name with no > after it, and the scheme rule of redactDiagnostics
    () => lab.sanitizeExcerptHtml('<script '.repeat(20000)),
    () => lab.sanitizeExcerptHtml('<style/'.repeat(20000) + '</style'),
    () => lab.sanitizeExcerptHtml('<' + 'a'.repeat(100000)),
    () => lab.sanitizeExcerptHtml('<' + 'a-'.repeat(50000) + ' x'),
    () => lab.redactDiagnostics('AAAA-'.repeat(80000)),
    () => lab.redactDiagnostics('a.'.repeat(100000)),
    () => lab.redactDiagnostics('www.'.repeat(50000)),
    () => lab.redactDiagnostics('a1+'.repeat(100000) + ':/'),
  ];
  for (const [i, run] of inputs.entries()) {
    const t = performance.now();
    run();
    assert.ok(performance.now() - t < 1500, `input ${i} took ${Math.round(performance.now() - t)} ms`);
  }
});

test('excerpts: the 50,000-character limit, in HTML and Markdown (F11.3)', () => {
  const text = 'ab '.repeat(20000);
  const item = lab.excerptItem({ text, url: 'https://example.com/a', pageTitle: 'A', date: '2026-10-22' });
  const quote = item.content.split('<blockquote>')[1].split('</blockquote>')[0];
  assert.ok(quote.endsWith('<p>(Excerpt trimmed to 50,000 characters.)</p>'));
  assert.equal(quote.replace(/<[^>]+>/g, '').length, 50000 + '(Excerpt trimmed to 50,000 characters.)'.length);
  const short = lab.excerptItem({ text: 'ab '.repeat(100), url: 'https://example.com/a' });
  assert.ok(!short.content.includes('trimmed'));
  const md = lab.excerptMarkdown({ text, app: 'Notes', date: '2026-10-22' });
  assert.ok(md.startsWith('ab ab'));
  assert.ok(md.endsWith('\n\n(Excerpt trimmed to 50,000 characters.)\n\n— shared from Notes on 22 October 2026\n'));
});

test('excerpts: a page already in the Reader becomes a new document: a file with its own name and a text fragment (F11.4)', () => {
  const a = lab.excerptItem({ text: 'One passage from the page.', url: 'https://example.com/story', pageTitle: 'Story' });
  const b = lab.excerptItem({ text: 'Another passage from it.', url: 'https://example.com/story', pageTitle: 'Story' });
  assert.equal(a.kind, 'file');
  assert.equal(a.mime, 'text/html');
  assert.notEqual(a.url, b.url);
  assert.ok(a.url.startsWith('https://example.com/story#:~:text='));
  assert.ok(a.content.includes('<a href="https://example.com/story">Story</a>'));
  assert.deepEqual(a.extras, { 'x-cap': 'excerpt' });
});

test('excerptDate: a number is read in local time', () => {
  const ms = new Date(2026, 9, 22, 12).getTime();
  assert.equal(lab.excerptDate(ms), '22 October 2026');
  assert.equal(lab.excerptDate(new Date(2026, 0, 1, 9)), '1 January 2026');
  assert.equal(lab.excerptDate(NaN), '');
});

test('F26.2: copied diagnostics carry no URL, title, pairing code, topic or Server code', async () => {
  const keys = await ds.deriveKeys(secret1);
  const code = await ds.formatCode(secret1);
  const link = await ds.pairingLink({ secret: secret1, relay: 'https://relay.example.org', name: 'Anjan’s Daylight' });
  const title = 'A Very Private Article Title';
  const log = [];
  const add = (e) => { log.splice(0, log.length, ...lab.appendActivity(log, e)); };
  add({ type: 'send', id: 'ab'.repeat(16), kind: 'url', status: 'sent', http: 200, title, url: 'https://secret.example/path' });
  add({ type: 'poll-error', status: `GET https://relay.example.org/${keys.ackTopic}/json failed`, http: 429 });
  add({ type: 'pair', status: `pairing link ${link}` });
  add({ type: 'pair', status: `code ${code}` });
  add({ type: 'server', status: 'code SERVER-ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23 daylightserver://setup?c=x' });
  add({ type: 'topic', status: `${keys.inboxTopic} ${keys.ackTopic}` });
  const early = log.slice();
  for (let i = 0; i < 300; i++) add({ type: 'tick', status: 'ok' });
  assert.equal(log.length, lab.ACTIVITY_MAX);
  assert.ok(!('title' in early[0]) && !('url' in early[0]));
  const text = lab.diagnosticsReport({
    app: 'Send to Daylight', version: '1.5.0', platform: 'iphone', lab: true, caps: ['st'], checkedIn: Date.now() - 60000,
    rows: [{ status: 'sent', title, url: 'https://secret.example/path' }], relay: 'https://relay.example.org', log: early,
  });
  for (const bad of [title, 'secret.example', 'relay.example.org', code, code.replace(/-/g, ''), keys.inboxTopic, keys.ackTopic, 'SERVER-', 'daylightserver', 'daylightshare', 'https://']) {
    assert.ok(!text.includes(bad), `${bad} in:\n${text}`);
  }
  assert.match(text, /Relay: custom relay/);
  assert.match(text, /send abababab url sent 200/);
  const recent = lab.diagnosticsReport({ log });
  assert.equal(recent.trim().split('\n').filter((l) => / tick /.test(l)).length, lab.DIAGNOSTICS_EVENTS);
});

test('the test article: unique URLs, x-cap test, and about 400 words (F26)', () => {
  const a = lab.testArticle({ device: 'Anjan’s iPhone' });
  const b = lab.testArticle({ device: 'Anjan’s iPhone' });
  assert.notEqual(a.url, b.url);
  assert.match(a.url, /^https:\/\/daylight\.invalid\/test\/[0-9a-f]{32}$/);
  assert.equal(a.title, 'Test article from Anjan’s iPhone');
  assert.equal(lab.testArticle({ id: 'cd'.repeat(16) }).title, 'Test article from Send to Daylight');
  assert.throws(() => lab.testArticle({ id: 'nope' }), (e) => e.code === 'id');
  const words = a.content.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length;
  assert.ok(words > 150 && words <= 450, String(words));
});

test('LAB_TEXT W1: typographic apostrophes, and every Use footer says what turning it off does', () => {
  const flat = [];
  const walk = (o) => { for (const v of Object.values(o)) { if (typeof v === 'string') flat.push(v); else if (Array.isArray(v)) flat.push(...v); else walk(v); } };
  walk(lab.LAB_TEXT);
  for (const s of flat) assert.ok(!/[A-Za-z]'[A-Za-z]/.test(s), s);
  for (const id of lab.USE_FEATURES) assert.match(lab.LAB_TEXT.use.footers[id], /^When it’s off, /, id);
});

test('Sender: Lab header fields ride on part 0 of every attempt, and plain items stay exactly v1.1', async () => {
  const relay = await startMockRelay();
  try {
    const storage = new ds.MemoryStorage();
    const pairing = { secret: secret1, relay: relay.url };
    let t = Date.UTC(2026, 9, 20, 8);
    const sender = new ds.Sender({ pairing, storage, now: () => t });
    const n = lab.normaliseShare({ text: 'Story https://example.com/s?utm_source=x' });
    const row = await sender.send({ kind: 'url', url: n.url, title: n.title, extras: { 'x-orig': n.orig } });
    assert.deepEqual(row.extras, { 'x-orig': 'https://example.com/s?utm_source=x' });
    const plain = await sender.send({ kind: 'url', url: 'https://example.com/plain' });
    assert.ok(!('extras' in plain), 'a row shared without extras has no extras field');
    const big = new Uint8Array(4_000_000).map((_, i) => (i * 7919) % 251);
    const file = await sender.send({ kind: 'file', name: 'a.bin', mime: 'application/octet-stream', content: big, extras: { 'x-cap': 'excerpt' } });
    // a re-send carries the same fields
    t += ds.RESEND_MESSAGE_MS + 1;
    await sender.resendDue();
    const received = [];
    const receiver = new ds.Receiver({ pairing, storage: new ds.MemoryStorage(), accept: async (it) => { received.push(it); } });
    await receiver.pollOnce();
    const byId = (id) => received.filter((r) => r.header.id === id);
    assert.deepEqual(byId(row.id)[0].extras, { 'x-orig': 'https://example.com/s?utm_source=x' });
    assert.deepEqual(byId(plain.id)[0].extras, {});
    assert.deepEqual(byId(file.id)[0].extras, { 'x-cap': 'excerpt' });
    const keys = await ds.deriveKeys(secret1);
    const frames = relay.state.topics.get(keys.inboxTopic);
    let withX = 0;
    for (const m of frames) {
      const body = m.attachment ? relay.state.files.get(m.id)?.bytes : ds.fromBase64(m.message);
      if (!body) continue;
      const { header } = await ds.decryptFrame(keys, 'inbox', new Uint8Array(body));
      const x = Object.keys(header).filter((k) => k.startsWith('x-'));
      if (header.id === plain.id) assert.deepEqual(x, []);
      if ((header.part ?? 0) > 0) assert.deepEqual(x, [], 'later parts carry no Lab fields');
      if (x.length) withX += 1;
    }
    assert.equal(withX, 4, 'two attempts each of the link and the file\'s part 0');
  } finally {
    await relay.close();
  }
});
