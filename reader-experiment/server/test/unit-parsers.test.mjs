// Unit tests (Node) for the pure parsers and generators: feeds (8.2), email helpers (7.3, 7.4), HTML escaping and the
// Markdown renderer (7.5, 9.1), the digest page (8.3).
import './testing-global.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, discoverFeed, parseOpml, normalizeArticleUrl, decodeFeed, stripProlog } from '../src/feedparse.ts';
import { dmarcFromHeaders, parseHeaderBlock, findViewInBrowser, cleanSubject, parseFrom, blockPatterns, normalizePattern, documentMime, stripTracking } from '../src/mailparse.ts';
import { esc, renderMarkdown, textToHtml, wrapPage, decodeEntities, plainText, safeHref } from '../src/html.ts';
import { buildDigestHtml } from '../src/digest.ts';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Tom &amp; Jerry&#39;s Blog</title><link>https://blog.example/</link><description>d</description>
<item><title><![CDATA[First <post> & more]]></title><link>https://blog.example/1?utm_source=x</link>
<guid isPermaLink="false">tag:blog.example,2026:1</guid><pubDate>Tue, 20 Oct 2026 09:12:00 GMT</pubDate><dc:creator>Ann</dc:creator>
<description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt; &amp;amp; more&lt;/p&gt;</description></item>
<item><title>No link</title><guid>https://blog.example/2</guid></item>
<item><title>Relative</title><link>/3</link><content:encoded><![CDATA[<p>Full <i>content</i></p>]]></content:encoded></item>
</channel></rss>`;

test('RSS 2.0: CDATA, entities, guid permalinks, relative links, excerpts', () => {
  const f = parseFeed(RSS, 'https://blog.example/feed.xml');
  assert.equal(f.format, 'rss');
  assert.equal(f.title, 'Tom & Jerry’s Blog'.replace('’', "'"));
  assert.equal(f.entries.length, 3);
  const [a, b, c] = f.entries;
  assert.equal(a.title, 'First & more', 'CDATA kept, tags stripped from titles');
  assert.equal(a.id, 'tag:blog.example,2026:1');
  assert.equal(a.author, 'Ann');
  assert.equal(a.published, Date.parse('2026-10-20T09:12:00Z'));
  assert.equal(a.excerpt, 'Hello world & more');
  assert.equal(b.url, 'https://blog.example/2', 'a permalink guid is the link');
  assert.equal(c.url, 'https://blog.example/3');
  assert.equal(c.excerpt, 'Full content');
});

test('RSS 1.0 (RDF), Atom 1.0 and JSON Feed 1.1', () => {
  const rdf = parseFeed(`<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel rdf:about="https://r.example/"><title>RDF</title><link>https://r.example/</link></channel>
    <item rdf:about="https://r.example/a"><title>A</title><link>https://r.example/a</link><dc:date>2026-10-19T10:00:00Z</dc:date></item></rdf:RDF>`, 'https://r.example/rss');
  assert.equal(rdf.format, 'rdf');
  assert.equal(rdf.entries[0].id, 'https://r.example/a');
  assert.equal(rdf.entries[0].published, Date.parse('2026-10-19T10:00:00Z'));
  const atom = parseFeed(`<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title type="html">A &amp;lt;b&amp;gt;</title>
    <link rel="self" href="/feed"/><link rel="alternate" href="https://a.example/"/>
    <entry><title>E</title><link rel="edit" href="/edit/1"/><link href="/posts/1"/><id>urn:uuid:1</id>
    <published>2026-10-18T08:00:00Z</published><author><name>Bea</name></author><content type="html">&lt;p&gt;Body&lt;/p&gt;</content></entry></feed>`, 'https://a.example/feed');
  assert.equal(atom.format, 'atom');
  assert.equal(atom.site, 'https://a.example/');
  assert.equal(atom.entries[0].url, 'https://a.example/posts/1');
  assert.equal(atom.entries[0].author, 'Bea');
  assert.equal(atom.entries[0].excerpt, 'Body');
  const json = parseFeed(JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1', title: 'J', home_page_url: 'https://j.example/',
    items: [{ id: 1, url: 'https://j.example/1', title: 'One', content_html: '<p>x &amp; y</p>', authors: [{ name: 'Cy' }], date_published: '2026-10-17T00:00:00Z' }],
  }), 'https://j.example/feed.json');
  assert.equal(json.format, 'json');
  assert.deepEqual(json.entries[0], { id: '1', url: 'https://j.example/1', title: 'One', author: 'Cy', published: Date.parse('2026-10-17T00:00:00Z'), excerpt: 'x & y' });
});

test('DOCTYPE and ENTITY are ignored: an entity bomb expands to nothing', () => {
  const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">${Array.from({ length: 9 }, (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i || ''};`.repeat(10)}">`).join('')}]>
    <rss><channel><title>&lol9;</title><item><title>&lol9; x</title><link>https://b.example/1</link></item></channel></rss>`;
  const t0 = Date.now();
  const f = parseFeed(bomb, 'https://b.example/');
  assert.ok(Date.now() - t0 < 200);
  assert.equal(f.title, '&lol9;');
  assert.equal(f.entries[0].title, '&lol9; x');
  assert.doesNotMatch(stripProlog(bomb), /ENTITY/);
});

test('broken XML, non-feeds and too many entries', () => {
  assert.equal(parseFeed('<html><body>not a feed</body></html>', 'https://x.example/'), null);
  assert.equal(parseFeed('{"not": "a feed"}', 'https://x.example/'), null);
  assert.equal(parseFeed('', 'https://x.example/'), null);
  const broken = parseFeed('<rss><channel><title>B</title><item><title>ok</title><link>https://x.example/1</link></item><item><title>cut', 'https://x.example/');
  assert.equal(broken.entries.length, 1, 'what can be read is read');
  const many = `<rss><channel>${Array.from({ length: 150 }, (_, i) => `<item><guid>${i}</guid></item>`).join('')}</channel></rss>`;
  assert.equal(parseFeed(many, 'https://x.example/').entries.length, 100);
  const latin1 = Uint8Array.from([...new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><t>'), 0xe9, ...new TextEncoder().encode('</t>')]);
  assert.match(decodeFeed(latin1), /<t>\u00e9<\/t>/, 'the declared encoding is honoured');
});

test('autodiscovery, OPML and article URL normalization', () => {
  const html = `<html><head><link rel="stylesheet" href="/s.css"><link rel="alternate" type="application/atom+xml" href="/atom.xml?a=1&amp;b=2"></head></html>`;
  assert.equal(discoverFeed(html, 'https://site.example/blog/'), 'https://site.example/atom.xml?a=1&b=2');
  assert.equal(discoverFeed('<link rel="alternate" type="text/html" href="/x">', 'https://s.example/'), null);
  const opml = `<?xml version="1.0"?><opml version="2.0"><body><outline text="Group"><outline type="rss" text="A" xmlUrl="https://a.example/rss"/>
    <outline title="B &amp; C" xmlUrl="https://b.example/atom"></outline></outline><outline text="no url"/></body></opml>`;
  assert.deepEqual(parseOpml(opml), [{ url: 'https://a.example/rss', title: 'A' }, { url: 'https://b.example/atom', title: 'B & C' }]);
  assert.equal(normalizeArticleUrl('https://EXAMPLE.com/a/?utm_source=x&id=2&fbclid=1#top'), 'https://example.com/a?id=2');
  assert.equal(normalizeArticleUrl('https://example.com/a/'), normalizeArticleUrl('https://example.com/a'));
});

test('DMARC: only the topmost Authentication-Results, and only when it is Cloudflare’s', () => {
  const block = (lines) => parseHeaderBlock(lines.join('\r\n') + '\r\n\r\nbody');
  const cf = (v) => [`Authentication-Results: mx.cloudflare.net;`, `\tdkim=pass header.d=example.com;`, `\tdmarc=${v} header.from=example.com policy.dmarc=reject;`, `\tspf=pass smtp.mailfrom=example.com`];
  assert.equal(dmarcFromHeaders(block([...cf('pass'), 'From: a@example.com'])), 'pass');
  assert.equal(dmarcFromHeaders(block([...cf('fail'), 'Authentication-Results: evil.example; dmarc=pass', 'From: a@example.com'])), 'fail',
    'a forged lower header cannot override Cloudflare’s verdict');
  assert.equal(dmarcFromHeaders(block(['Authentication-Results: evil.example; dmarc=pass', ...cf('fail')])), null,
    'a topmost header that is not Cloudflare’s gives no verdict');
  assert.equal(dmarcFromHeaders(block([...cf('none')])), 'none');
  assert.equal(dmarcFromHeaders(block(['From: a@example.com'])), null);
  assert.equal(dmarcFromHeaders(block(['ARC-Authentication-Results: i=1; mx.cloudflare.net; dmarc=fail', ...cf('pass')])), 'pass');
});

test('"view in browser": the first 60 anchors, never unsubscribe links, tracking removed, 10 KB anchor text', () => {
  const html = `<a href="https://news.example/unsubscribe?u=1">View in browser</a>
    <a href="https://news.example/web/42?utm_source=mail&mc_cid=9&id=42">View this email in your browser</a>`;
  assert.equal(findViewInBrowser(html), 'https://news.example/web/42?id=42');
  for (const text of ['Read online', 'web version', 'View online', 'Open as a webpage', 'see it on the web', 'View this issue']) {
    assert.equal(findViewInBrowser(`<a href='https://n.example/x'>${text}</a>`), 'https://n.example/x', text);
  }
  assert.equal(findViewInBrowser('<a href="https://n.example/x">Read more</a>'), null);
  assert.equal(findViewInBrowser('<a href="http://192.168.1.1/x">View in browser</a>'), null, 'LAN links are not public');
  assert.equal(findViewInBrowser('<a href="https://n.example/manage">View in browser</a>'), null);
  const filler = Array.from({ length: 60 }, (_, i) => `<a href="https://n.example/${i}">story ${i}</a>`).join('');
  assert.equal(findViewInBrowser(filler + '<a href="https://n.example/web">View in browser</a>'), null, 'only the first 60 anchors');
  const huge = `<a href="https://n.example/big">${'x'.repeat(10_000)} view in browser</a><a href="https://n.example/web">View in browser</a>`;
  const t0 = Date.now();
  assert.equal(findViewInBrowser(huge), 'https://n.example/web', 'anchor text is cut to 200 characters');
  assert.ok(Date.now() - t0 < 100);
  assert.equal(stripTracking('https://a.example/?utm_x=1&gclid=2&q=3'), 'https://a.example/?q=3');
});

test('subjects, senders, block patterns and document types', () => {
  assert.equal(cleanSubject('Re: Fwd: FW: Weekly #3'), 'Weekly #3');
  assert.equal(cleanSubject('  Multiple   spaces '), 'Multiple spaces');
  assert.deepEqual(parseFrom('"Ann \\"A\\" B" <ANN@Example.COM>'), { address: 'ann@example.com', domain: 'example.com', name: 'Ann "A" B' });
  assert.deepEqual(parseFrom('bob@x.example'), { address: 'bob@x.example', domain: 'x.example', name: '' });
  assert.deepEqual(blockPatterns('a@mail.news.example.com'), ['a@mail.news.example.com', '@mail.news.example.com', '@news.example.com', '@example.com']);
  assert.equal(normalizePattern('  @Example.COM '), '@example.com');
  assert.equal(normalizePattern('Alice@Example.com'), 'alice@example.com');
  for (const bad of ['', 'example', '@', 'a@', '<a@b.c>', 'a b@c.d']) assert.equal(normalizePattern(bad), null, bad);
  assert.equal(documentMime('application/pdf', 'x'), 'application/pdf');
  assert.equal(documentMime('application/octet-stream', 'Report.EPUB'), 'application/epub+zip');
  assert.equal(documentMime('text/x-markdown', 'n.md'), 'text/markdown');
  assert.equal(documentMime('application/zip', 'a.zip'), null);
  assert.equal(documentMime('image/png', 'a.png'), null);
});

test('escaping: every interpolated value, and hrefs only when public', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  assert.equal(esc(evil), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc("a'b&c"), 'a&#39;b&amp;c');
  const page = wrapPage({ title: evil, author: evil, published: evil, source: 'email' }, '<p>x</p>');
  assert.doesNotMatch(page, /<img/);
  assert.match(page, /<title>&quot;&gt;&lt;img/);
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('JaVa&#x09;script:alert(1)'), '');
  assert.equal(safeHref('https://a.example/?q="x"'), 'https://a.example/?q=%22x%22');
  assert.equal(decodeEntities('&amp;lt; &#x27; &#39; &mdash; &bogus;'), "&lt; ' ' \u2014 &bogus;");
  assert.equal(plainText('<p>a<script>evil()</script> <b>b</b></p>'), 'a b');
});

test('the Markdown renderer: paragraphs, lists, bold and italic only; everything else escaped', () => {
  const html = renderMarkdown('# Title\n\nSome **bold** and *it* and <script>x()</script> [link](javascript:alert(1))\n\n- one\n- **two**\n\n1. first\n2. second');
  assert.match(html, /<p>Title<\/p>/);
  assert.match(html, /<strong>bold<\/strong> and <em>it<\/em>/);
  assert.match(html, /&lt;script&gt;x\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /<ul><li>one<\/li><li><strong>two<\/strong><\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.equal(renderMarkdown('snake_case_word'), '<p>snake_case_word</p>');
});

test('plain text email -> paragraphs with public URLs linked', () => {
  const html = textToHtml('Hello <you>\nline two\n\nSee https://example.com/a. And http://10.0.0.1/admin too.');
  assert.match(html, /^<p>Hello &lt;you&gt;<br>line two<\/p>/);
  assert.match(html, /<a href="https:\/\/example.com\/a">https:\/\/example.com\/a<\/a>\./);
  assert.match(html, /http:\/\/10.0.0.1\/admin too/);
  assert.doesNotMatch(html, /href="http:\/\/10/);
});

test('the digest page: escaped, public links only, size-capped, in the reader’s time zone', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const entries = [
    { feed_id: 'f1', key: 'k1', url: 'https://a.example/1', title: evil, author: evil, published: Date.parse('2026-10-20T07:12:00Z'), excerpt: evil, first_seen: 0, feed_title: evil },
    { feed_id: 'f2', key: 'k2', url: 'http://192.168.1.1/reboot', title: 'LAN', author: null, published: null, excerpt: null, first_seen: Date.parse('2026-10-20T08:00:00Z'), feed_title: 'F2' },
  ];
  const { html, title, used } = buildDigestHtml(entries, Date.parse('2026-10-20T14:00:00Z'), 'Europe/Berlin', 256 * 1024);
  assert.equal(title, 'Digest · Tue 20 Oct');
  assert.equal(used.length, 2);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<h1>Digest · Tuesday 20 October<\/h1>/);
  assert.match(html, /2 new articles from 2 feeds/);
  assert.match(html, /<h2><a href="https:\/\/a.example\/1">/);
  assert.match(html, /<h2>LAN<\/h2>/, 'a LAN link appears as text only');
  assert.match(html, /20 Oct, 09:12/, 'local time in Berlin (UTC+2)');
  const many = Array.from({ length: 500 }, (_, i) => ({ ...entries[0], key: `k${i}`, title: `T${i}`, excerpt: 'x'.repeat(600), author: 'a', feed_title: 'F' }));
  const capped = buildDigestHtml(many, Date.now(), 'UTC', 32 * 1024, 60);
  assert.ok(capped.used.length > 10 && capped.used.length < 60, String(capped.used.length));
  assert.ok(new TextEncoder().encode(capped.html).length <= 32 * 1024);
  assert.equal(buildDigestHtml(many, Date.now(), 'UTC', 10 * 1024 * 1024, 60).used.length, 60);
});
