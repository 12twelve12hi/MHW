// The W1 (L1) vector cases: normalise.json (F16), and lab-vectors.json's labExcerpt (F11), diagnostics and testArticle
// (F26) sections. generate-lab.mjs imports this and writes both files; every expectation comes from the JavaScript
// reference (../js/daylight-lab.js), and the asserts below pin the cases the plan names (LAB-PLAN 2.8, F11, F16, F26).

import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as ds from '../js/daylight-share.js';
import * as lab from '../js/daylight-lab.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------------------------------------------------------
// normalise.json: normaliseShare({text, url, subject, source}) -> {kind, url, title, excerpt, orig}

const LONG_TWEET = 'This is the best thread on e-paper displays I have read all year. It covers refresh rates, ghosting, '
  + 'warm light and why a 60 Hz reflective screen feels so different from a Kindle when you scroll. Read it before you '
  + 'buy a tablet for reading. Seriously, it is worth the ten minutes.';
const LONG_HEADLINE = 'Live updates: the storm makes landfall near the coast as officials order evacuations, close '
  + 'schools and bridges, open shelters across three counties, warn of flooding along every river in the region, and '
  + 'ask everyone who can to stay home until the weekend while crews work to restore power';
const longPath = (n) => 'https://example.com/' + 'a'.repeat(n - 'https://example.com/'.length);

export const NORMALISE_CASES = [
  // Real "headline + link" shares (LAB-PLAN 2.8, F11.5, F16.1): links, with the headline as the title
  ['NYT app: "Opinion | headline" + short link', { text: 'Opinion | The Real Reason Inflation Is Still Too High, According to Economists https://nyti.ms/3XyZabc' }],
  ['NYT: headline + link with smid', { text: 'The Morning: A Quiet Revolution in Batteries https://www.nytimes.com/2026/10/20/briefing/batteries.html?smid=nytcore-ios-share&referringSource=articleShare' }],
  ['NYT gift link sentence stays a link', { text: 'I’m giving you access to one of my subscriber-only articles. https://www.nytimes.com/2026/10/19/science/octopus-dreams.html?unlocked_article_code=1.abc.XYZ&smid=url-share' }],
  ['Guardian: "headline | section | The Guardian" + link', { text: 'Climate crisis: world on track for 2.7C of heating, UN says | Climate crisis | The Guardian https://www.theguardian.com/environment/2026/oct/20/climate-un-report?CMP=share_btn_url' }],
  ['Guardian app: link with the headline as subject', { text: 'https://www.theguardian.com/world/2026/oct/21/story?CMP=Share_iOSApp_Other', subject: 'Ferry services resume after the strike | World news | The Guardian' }],
  ['Apple News: headline + apple.news link (resolved later by iPhone and Mac)', { text: 'Why the Fed Can’t Stop Worrying — The Atlantic https://apple.news/AJkLmNoPqRsTuVwXyZ' }],
  ['Apple News: link alone with subject', { url: 'https://apple.news/AbC-dEf_123', subject: 'The Year in Tiny Houses' }],
  ['Substack app: "Read “…” by … on Substack:" + open.substack.com', { text: 'Read “The Quiet Year” by Jane Doe on Substack: https://open.substack.com/pub/janedoe/p/the-quiet-year?r=2abc&utm_campaign=post&utm_medium=web&showWelcome=true' }],
  ['Substack: post link with email tracking', { text: 'https://janedoe.substack.com/p/the-quiet-year?utm_source=substack&utm_medium=email&r=2abc&triedRedirect=true' }],
  ['X: a long post + link stays a link (6.5 Q1 b)', { text: `${LONG_TWEET} https://x.com/someone/status/1849123456789012345?s=46&t=AbCdEfGh123` }],
  ['X: twitter.com link with s', { text: 'https://twitter.com/someone/status/1849123456789012345?s=20' }],
  ['Chrome on Android: "Title\\nURL"', { text: 'Why Paper Still Wins for Reading\nhttps://www.example.com/news/paper-wins-123' }],
  ['Chrome on Android: subject + URL as text', { text: 'https://www.example.com/news/paper-wins-123', subject: 'Why Paper Still Wins for Reading' }],
  ['A headline over 40 words + link stays a link', { text: `${LONG_HEADLINE} https://www.example.com/live/storm` }],
  ['Three sentences + link stay a link', { text: 'Big news today. The library is open late. Bring a friend! https://example.org/library' }],
  ['A dash-separated headline', { text: 'Readers Are Back — and They Want Paper - The Verge https://www.theverge.com/2026/10/20/readers' }],
  // Text fragments (#:~:text=) do not make an excerpt under 6.5 Q1 (b): Google adds them to result links
  ['Chrome on Android, a page opened from a Google result: "Title\\nURL#:~:text=" stays a link with its title', { text: 'How to bake bread - BBC Food\nhttps://www.bbc.co.uk/food/bread#:~:text=Knead%20the%20dough' }],
  ['A URL with a text fragment alone stays a link (copied link, URL scheme, intents)', { text: 'https://example.com/article#:~:text=The%20quick%20brown,lazy%20dog' }],
  ['A URL with a text fragment and a subject: the subject is the title', { url: 'https://example.com/a#:~:text=hello', subject: 'My title' }],
  ['Chrome on Android shares a selection ("quote"\\nURL#:~:text=) without "Send as excerpt": a link', { text: '"Lorem ipsum dolor sit amet, consectetur adipiscing elit."\nhttps://example.com/article#:~:text=Lorem%20ipsum%20dolor%20sit' }],
  ['A text fragment and tracking: tracking goes, the fragment stays', { text: 'https://example.com/article?utm_source=share#:~:text=keep%20this' }],
  // Explicit selections (F11 rule 1) and text with no URL (rule 3)
  ['Rule 1: a selection with its page', { text: 'The quick brown fox jumps over the lazy dog.', url: 'https://example.com/fox', subject: 'Fox facts', source: 'selection' }],
  ['Rule 1: a selection without a URL is a note', { text: 'Remember to pack the charger.', source: 'selection' }],
  ['Rule 1: a selection with no text is a link', { text: '  ', url: 'https://example.com/fox', subject: 'Fox facts', source: 'selection' }],
  ['Rule 1: "Send as excerpt" on Chrome’s shared selection: the quote without its quotes', { text: '"Lorem ipsum dolor sit amet, consectetur adipiscing elit."\nhttps://example.com/article#:~:text=Lorem%20ipsum%20dolor%20sit', source: 'selection' }],
  ['Rule 1: curly quotes around a selection with a text fragment', { text: '“A passage worth keeping.” https://example.com/article#:~:text=A%20passage%20worth', subject: 'Article', source: 'selection' }],
  ['Rule 1: quotes stay when the URL has no text fragment', { text: '“To be, or not to be.”', url: 'https://example.com/hamlet', source: 'selection' }],
  ['Rule 1: "Send as excerpt" on a text-fragment URL alone: the fragment’s text', { text: 'https://example.com/article#:~:text=The%20quick%20brown,lazy%20dog', source: 'selection' }],
  ['Rule 1: the fragment’s prefix and suffix are left out', { url: 'https://example.com/article#:~:text=see-,the%20quiet%20year,-ends', source: 'selection' }],
  ['Rule 3: text without a URL is a note', { text: 'Ideas for the weekend:\n- walk\n- read\n' }],
  ['Nothing to send', { text: '' }],
  ['Only whitespace', { text: ' \n\t ' }],
  ['A URL the web URL rule refuses, nothing else', { url: 'ftp://example.com/file' }],
  // Unwrapping without the network (F16 step 3)
  ['Google AMP', { url: 'https://www.google.com/amp/s/www.example.com/story.amp?x=1' }],
  ['Google AMP on google.co.uk', { url: 'https://www.google.co.uk/amp/s/news.example.co.uk/a/b' }],
  ['Google /url?q=', { url: 'https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fpage%3Fid%3D7&sa=D&source=docs&ust=1&usg=AOv' }],
  ['Google /url?url=', { url: 'https://google.com/url?sa=t&url=https%3A%2F%2Fexample.com%2Fpaper&ved=2ah' }],
  ['Google /url with a bad q falls back to url', { url: 'https://www.google.com/url?q=javascript%3Aalert(1)&url=https%3A%2F%2Fexample.com%2Fok' }],
  ['Google /url without a target stays', { url: 'https://www.google.com/url?sa=t' }],
  ['AMP cache /c/s/', { url: 'https://www-example-com.cdn.ampproject.org/c/s/www.example.com/a?utm_source=x' }],
  ['AMP cache /v/s/', { url: 'https://www-example-com.cdn.ampproject.org/v/s/www.example.com/amp/story?amp_js_v=0.1#ref' }],
  ['AMP cache /c/ (http)', { url: 'https://example-org.cdn.ampproject.org/c/example.org/plain' }],
  ['Facebook l.php', { url: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26fbclid%3Dzzz&h=AT0' }],
  ['Facebook lm.facebook.com', { url: 'https://lm.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fm&h=x' }],
  ['Facebook l.php with a broken escape stays (only fbclid-free)', { url: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2F%E0%A4%A&h=AT0' }],
  ['Instagram l.instagram.com', { url: 'https://l.instagram.com/?u=https%3A%2F%2Fexample.com%2Fbio%3Figsh%3Dabc&e=AT1' }],
  ['LinkedIn safety/go', { url: 'https://www.linkedin.com/safety/go?url=https%3A%2F%2Fexample.com%2Fjob&trk=flagship-messaging-web' }],
  ['open.substack.com without tracking', { url: 'https://open.substack.com/pub/someone/p/a-post-title' }],
  ['Nested: Google /url around Facebook around a tracked link', { url: 'https://www.google.com/url?q=https%3A%2F%2Fl.facebook.com%2Fl.php%3Fu%3Dhttps%253A%252F%252Fexample.com%252Fdeep%253Futm_source%253Dfb' }],
  // Tracking parameters (F16 step 4, F16.3)
  ['utm_* go, other parameters keep their order', { url: 'https://example.com/p?a=1&utm_source=x&b=2&utm_medium=y&c' }],
  ['Only tracking: the ? goes', { url: 'https://example.com/p?utm_source=x&gclid=1&fbclid=2' }],
  ['The fragment stays', { url: 'https://example.com/p?fbclid=1#section-2' }],
  ['Names compare exactly: UTM_source stays (byte-identical)', { url: 'https://example.com/p?UTM_source=x&Fbclid=y' }],
  ['Empty pieces go when something is removed', { url: 'https://example.com/?a=1&&utm_source=x&' }],
  ['Every listed name', { url: 'https://example.com/?keep=1&fbclid=a&gclid=b&gbraid=c&wbraid=d&dclid=e&msclkid=f&mc_cid=g&mc_eid=h&igshid=i&igsh=j&yclid=k&twclid=l&ttclid=m&_hsenc=n&_hsmi=o&mkt_tok=p&ref_src=q&ref_url=r&__s=s&sr_share=t&utm_=u' }],
  ['youtu.be: si goes, t stays', { url: 'https://youtu.be/dQw4w9WgXcQ?si=AbCdEf&t=42' }],
  ['youtube.com watch: si goes', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=AbCdEf' }],
  ['music.youtube.com: si goes', { url: 'https://music.youtube.com/watch?v=x&si=y' }],
  ['open.spotify.com: si goes', { url: 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk?si=1a2b3c' }],
  ['si on another site stays', { url: 'https://example.com/?si=1' }],
  ['x.com: s and t go', { url: 'https://x.com/a/status/1?s=46&t=xyz&lang=en' }],
  ['t on another site stays', { url: 'https://vimeo.com/123?t=30s' }],
  ['nytimes.com: smid and smtyp go', { url: 'https://www.nytimes.com/2026/10/20/a.html?smid=nytcore-ios-share&smtyp=cur&action=click' }],
  ['substack.com subdomains: r, triedRedirect, showWelcome go', { url: 'https://someone.substack.com/p/x?r=abc&triedRedirect=true&showWelcome=true&keep=1' }],
  ['r on another site stays', { url: 'https://example.com/search?r=1' }],
  ['Case of host and path kept', { url: 'https://Example.COM/Path/To?Q=1&gclid=x' }],
  ['No query: unchanged', { url: 'https://example.com/plain/path' }],
  // Finding the URL in text (F16 step 1)
  ['Parentheses around a Wikipedia link', { text: 'See (https://en.wikipedia.org/wiki/Foo_(bar)).' }],
  ['Trailing full stop', { text: 'Look at this: https://example.com/a/b.' }],
  ['Trailing ! and ?', { text: 'Wow https://example.com/wow!?' }],
  ['Curly quotes around', { text: 'He said “https://example.com/q”' }],
  ['Single curly quotes and »', { text: 'Link: ‘https://example.com/s’ and «https://example.com/t»' }],
  ['Brackets', { text: '[https://example.com/x]' }],
  ['Angle brackets', { text: 'Mail-style <https://example.com/angle>' }],
  ['Two URLs: the first wins, the second stays in the title', { text: 'Compare https://example.com/one and https://example.com/two' }],
  ['Upper-case scheme', { text: 'HTTPS://EXAMPLE.COM/A' }],
  ['An invalid url field: the text’s URL', { url: 'example.com/not-a-url', text: 'Story https://example.com/real' }],
  ['A comma inside the path stays', { text: 'https://example.com/a,b/c, and more' }],
  // x-orig (LAB-PROTOCOL 2.3): left out over 1,024 characters
  ['x-orig at 1,024 characters is kept', { url: longPath(1024 - '?utm_source=x'.length) + '?utm_source=x' }],
  ['x-orig over 1,024 characters is left out', { url: longPath(1025 - '?utm_source=x'.length) + '?utm_source=x' }],
];

// The x-orig small-frame rule (2.3): built with buildItemFrames, the fields part 0 carries
const KEY_SECRET = new Uint8Array(createHash('sha256').update('vector-secret-1').digest().subarray(0, 16));
const contentBytes = (n) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 32) out.set(createHash('sha256').update('x-orig-content/' + i).digest().subarray(0, Math.min(32, n - i)), i);
  return out;
};
const X_ORIG_ID = createHash('sha256').update('x-orig-id').digest('hex').slice(0, 32);
export const X_ORIG_FRAME_CASES = [
  ['a short link keeps x-orig', { kind: 'url', url: 'https://example.com/story', title: 'Story' }, { 'x-orig': 'https://example.com/story?utm_source=x' }],
  ['x-orig and x-cap together', { kind: 'url', url: 'https://example.com/story', title: 'Story' }, { 'x-cap': 'clean', 'x-orig': 'https://example.com/story?fbclid=1' }],
  ['x-orig would make the frame large: left out', { kind: 'url', url: longPath(2000), title: 'A long link' }, { 'x-orig': longPath(1000) }],
  ['the frame is large anyway: x-orig stays', { kind: 'file', url: 'https://example.com/doc', name: 'doc.bin', mime: 'application/octet-stream', contentLength: 3000 }, { 'x-orig': longPath(900) }],
  ['x-orig over 1,024 characters: left out', { kind: 'url', url: 'https://example.com/s' }, { 'x-orig': longPath(1025) }],
  ['x-orig that fails the web URL rule: left out', { kind: 'url', url: 'https://example.com/s' }, { 'x-orig': 'javascript:alert(1)' }],
  ['an unknown x-cap: left out', { kind: 'url', url: 'https://example.com/s' }, { 'x-cap': 'bogus' }],
  ['x-cap test on a page', { kind: 'page', url: 'https://daylight.invalid/test/' + X_ORIG_ID, contentText: '<!doctype html><p>hi</p>' }, { 'x-cap': 'test' }],
];

// Apple News pages (F16 step 5): extractAppleNewsTarget
export const APPLE_NEWS_CASES = [
  ['redirectToUrlAfterTimeout with escaped slashes', '<html><head><script>function redirectToUrlAfterTimeout(url, t) {}\nredirectToUrlAfterTimeout("https:\\/\\/www.theatlantic.com\\/ideas\\/archive\\/2026\\/10\\/fed\\/680000\\/?x=1\\u0026y=2", 0);</script></head><body><a href="https://apple.news/AJk">Open in News</a></body></html>'],
  ['redirect in single quotes', '<script>redirectToUrlAfterTimeout(\'https://www.example.com/a\', 1000)</script>'],
  ['no redirect: the first link in the body', '<html><head><link href="https://cdn.apple.news/x.css"></head><body class="c"><span>Click <a class="click-here" href="https://www.cnn.com/2026/10/20/a.html?a=1&amp;b=2">here</a></span></body></html>'],
  ['a relative link first, then an absolute one', '<html><body><a href="/relative">x</a><a href=\'https://example.org/b\'>y</a></body></html>'],
  ['links only in head: null', '<html><head><a href="https://example.com/head">x</a></head><body><p>No links</p></body></html>'],
  ['a redirect that fails the web URL rule: the body link', '<script>redirectToUrlAfterTimeout("javascript:void(0)", 0)</script><body><a href="https://example.net/c">c</a></body>'],
  ['an unquoted href', '<body><A HREF=https://example.com/unquoted>u</A></body>'],
  ['nothing at all', 'Not found'],
];

// ---------------------------------------------------------------------------------------------------------------
// labExcerpt: excerpt builders and classifyShare (F11)

const DATE = '2026-10-22';
const BIG = 'word '.repeat(10010).trim(); // 50,049 characters

export const EXCERPT_ITEM_CASES = [
  ['a plain-text selection with its page', { text: 'Reading on paper is slower, and that is the point.\n\nWe remember more when we slow down.', url: 'https://www.example.com/essays/slow-reading?ref=home', pageTitle: 'Slow Reading', date: DATE }],
  ['selection HTML is sanitised', { text: 'First line of a quote that is selected. Second paragraph here.', html: '<div class="x">First line of a <b onclick="x()">quote</b> that is <span style="c">selected</span>.</div><script>alert(1)</script><p>Second <a href="javascript:x">paragraph</a> <a href="https://e.com/?a=1&amp;b=2" target="_blank">here</a>.</p></blockquote></article>', url: 'https://www.example.com/story?x=1', pageTitle: 'The Story', date: DATE }],
  ['a site name given', { text: 'A line.', url: 'https://example.org/p', pageTitle: 'Page', site: 'Example Weekly', date: DATE }],
  ['no page title: the site is the link', { text: 'A line.', url: 'https://www.example.org/p', date: DATE }],
  ['no date', { text: 'A line.', url: 'https://example.org/p', pageTitle: 'Page' }],
  ['a URL that already has a text fragment keeps it', { text: 'Lorem ipsum dolor sit amet', url: 'https://example.com/article#:~:text=Lorem%20ipsum%20dolor%20sit', pageTitle: 'Article', date: DATE }],
  ['a URL with a fragment: the text fragment replaces it, the link drops nothing', { text: 'Section text - with a dash, a comma & an ampersand', url: 'https://example.com/doc#part-2', pageTitle: 'Doc', date: DATE }],
  ['a long first line is cut at 100 characters', { text: 'This first line goes on for well over one hundred characters so that the title has to be cut short with an ellipsis at the end of it.\nSecond line.', url: 'https://example.com/long', pageTitle: 'Long', date: DATE }],
  ['characters to escape in the title and page title', { text: '5 < 6 & "quotes" > here', url: 'https://example.com/esc?a=1&b=2', pageTitle: 'Tom & Jerry <3', date: DATE }],
  ['a note: text without a URL, from Notes', { text: 'Buy oat milk\r\nCall Sam about Friday', app: 'Notes', date: DATE }],
  ['a note without an app', { text: 'Just a thought.', date: DATE }],
  ['a note without an app or a date', { text: 'Just a thought.' }],
  ['a note with emoji words', { text: '🙂 one two three four five six seven', date: DATE }],
  ['empty text: no item', { text: '   ', url: 'https://example.com/' }],
  ['a file name with characters files cannot have', { text: 'What: is * this? <a> "b" | c/d', url: 'https://example.com/f', pageTitle: 'F', date: DATE }],
  ['a local date from a Date-able number is used as given (vectors use strings)', { text: 'Date string with a bad day', url: 'https://example.com/d', pageTitle: 'D', date: '2026-02-30' }],
];

export const SANITIZE_CASES = [
  ['allowed tags stay, attributes go', '<p class="a" id="b">One <strong style="x">two</strong> <em>three</em> <u>u</u> <s>s</s> <sub>1</sub><sup>2</sup> <code>c</code></p>'],
  ['headings, lists, pre and blockquote', '<h1>H1</h1><h6>H6</h6><ul><li>a</li><li>b</li></ul><ol><li>c</li></ol><pre>  x\n  y</pre><blockquote>q</blockquote>'],
  ['block tags become paragraphs', '<section><div>One</div><div>Two</div></section><figure><figcaption>Cap</figcaption></figure><table><tr><td>A</td><td>B</td></tr></table>'],
  ['upper-case tags', '<P>Up</P><B>bold</B><BR><DIV>d</DIV>'],
  ['br forms', 'a<br>b<br/>c<br />d</br>e'],
  ['scripts, styles and friends go with their content', 'a<script>alert(1)</script>b<style>p{}</style>c<noscript>n</noscript>d<template><p>t</p></template>e<iframe src="x">i</iframe>f<svg><text>s</text></svg>g<button>Buy</button>h<select><option>o</option></select>i<textarea>t</textarea>j'],
  ['an unclosed script runs to the end', 'keep<script>var a = "</p>";'],
  ['a custom element named like a dropped one stays as text', '<script-x>kept</script-x> and <scripts>also</scripts>'],
  ['comments, doctype and processing instructions go', '<!DOCTYPE html>a<!-- hidden <b>x</b> -->b<?xml version="1.0"?>c<!-- unclosed'],
  ['links: http(s) only, references undone, then escaped', '<a href="https://e.com/?a=1&amp;b=&quot;2&quot;">ok</a> <a href="JAVASCRIPT:alert(1)">js</a> <a href=\'http://e.com/x\'>single</a> <a href=https://e.com/u>bare</a> <a>none</a> <a href="mailto:x@y.z">mail</a> <a href=" https://e.com/trim ">trim</a> <a data-href="https://e.com/no" title=\'x\'>data</a>'],
  ['stray closing tags are dropped', '</blockquote></article><p>inside</p></body></html><p>after</p>'],
  ['a closing tag closes what was opened after it', '<p><b><i>x</p>y</i>z'],
  ['open tags are closed at the end', '<ul><li><a href="https://e.com/">x'],
  ['text escaping keeps character references', 'a & b &amp; c &copy; &#169; &#xA9; &bogus d < e > f &#12345678; &;'],
  ['a < that starts no tag', '1 < 2 and <3 and < b>'],
  ['a quoted > inside an attribute', '<p title="a > b">t</p><a href="https://e.com/?q=>">gt</a>'],
  ['an unclosed quote: the < is text', '<p title="oops>text</p>'],
  ['images and inputs go', 'a<img src="x.png" alt="pic">b<input value="v">c<hr>d'],
  ['nested lists', '<ul><li>a<ul><li>b</li></ul></li></ul>'],
  ['emoji and combining marks are kept', '<p>Café 🙂 é</p>'],
];

export const SANITIZE_LIMIT_CASES = [
  ['cut at 10 characters', '<p>Hello <b>wonderful</b> world</p>', 10],
  ['a reference counts as one character', '<p>&amp;&amp;&amp;&amp;&amp;xyz</p>', 6],
  ['exactly at the limit: not cut', '<p>12345</p>', 5],
  ['the limit falls between tags', '<p>12345</p><p>6</p>', 5],
  ['tags after the limit with no text: not cut', '<p>12345</p><br><p></p>', 5],
  ['an emoji counts as one', '🙂🙂🙂🙂', 2],
];

export const TEXT_HTML_CASES = [
  ['paragraphs and line breaks', 'One\nline two\n\n\nThree\r\nfour\r\rFive'],
  ['escaping', 'a < b & c > d "e"'],
  ['blank lines with spaces split paragraphs', 'a\n  \t\nb'],
  ['cut at 7 characters', 'abcdefghij', 7],
];

export const FRAGMENT_CASES = [
  ['eight words', 'https://example.com/a', 'one two three four five six seven eight nine ten'],
  ['dash, comma, ampersand and non-ASCII', 'https://example.com/a?x=1', 'self-made, rock & roll — Café'],
  ['an existing fragment is replaced', 'https://example.com/a#old', 'new words'],
  ['no words: the URL as it is', 'https://example.com/a#keep', '   '],
  ['an invalid URL: null', 'example.com/a', 'words'],
  ['too long: the URL as it is', longPath(4090), 'some words here'],
];

export const DATE_CASES = ['2026-10-22', '2026-01-01', '2024-02-29', '2025-02-29', '2026-13-01', '2026-10-22T08:00:00Z', '', null, 'yesterday'];

export const FILE_NAME_CASES = [
  ['six words', 'one two three four five six seven', false],
  ['fewer words', 'Short one', false],
  ['a note', 'Buy oat milk and bread and eggs', true],
  ['no words', '  ', false],
  ['no words, note', '', true],
  ['unsafe characters', 'a/b c:d *e? "f" <g>', false],
  ['a long word', 'x'.repeat(300), false],
];

export const CLASSIFY_CASES = [
  // F11's rules under 6.5 Q1 = (b): rule 1 (an explicit selection) and rule 3 (no URL); rules 2 and 4 are off
  ['rule 1: context menu selection', { text: 'A passage the user selected.', url: 'https://example.com/a', title: 'Page', source: 'selection' }, 'excerpt'],
  ['rule 1: Safari selectionText', { text: '  Selected in Safari.  ', url: 'https://example.com/b', title: 'B', source: 'selection' }, 'excerpt'],
  ['rule 1: "Send as excerpt" on a headline + link', { text: 'Opinion | The Real Reason Inflation Is Still Too High, According to Economists https://nyti.ms/3XyZabc', source: 'selection' }, 'excerpt'],
  ['rule 1: a selection without a URL: a note', { text: 'No link here.', source: 'selection' }, 'note'],
  ['rule 1: "Send as excerpt" on Chrome’s shared selection', { text: '"Quoted words here."\nhttps://example.com/p#:~:text=Quoted%20words%20here', source: 'selection' }, 'excerpt'],
  ['rule 1: "Send as excerpt" on a text fragment alone', { url: 'https://example.com/p#:~:text=start%20words,end%20words', source: 'selection' }, 'excerpt'],
  ['rule 3: no URL: a note', { text: 'Plain text from Notes.' }, 'note'],
  ['rule 2 is off: Chrome’s shared selection without "Send as excerpt" is a link', { text: '"Quoted words here."\nhttps://example.com/p#:~:text=Quoted%20words%20here' }, 'link'],
  ['rule 2 is off: a text fragment alone is a link', { url: 'https://example.com/p#:~:text=start%20words,end%20words' }, 'link'],
  ['rule 2 is off: a Google result’s fragment on "Title\\nURL" is a link', { text: 'How to bake bread - BBC Food\nhttps://www.bbc.co.uk/food/bread#:~:text=Knead%20the%20dough', title: 'How to bake bread - BBC Food' }, 'link'],
  ['rule 4 is off: 40+ words + link is a link', { text: `${LONG_TWEET} https://x.com/a/status/1` }, 'link'],
  ['rule 4 is off: three sentences + link is a link', { text: 'One. Two. Three. https://example.com/three' }, 'link'],
  // Headline + link shares stay links
  ['NYT headline + link', { text: 'Opinion | The Real Reason Inflation Is Still Too High, According to Economists https://nyti.ms/3XyZabc' }, 'link'],
  ['Guardian headline + link', { text: 'Climate crisis: world on track for 2.7C of heating, UN says | Climate crisis | The Guardian https://www.theguardian.com/environment/2026/oct/20/climate-un-report' }, 'link'],
  ['Apple News headline + link', { text: 'Why the Fed Can’t Stop Worrying — The Atlantic https://apple.news/AJkLmNoPqRsTuVwXyZ' }, 'link'],
  ['Substack share', { text: 'Read “The Quiet Year” by Jane Doe on Substack: https://open.substack.com/pub/janedoe/p/the-quiet-year' }, 'link'],
  ['X post + link', { text: 'Thread on e-paper. https://x.com/someone/status/1849123456789012345' }, 'link'],
  ['Chrome on Android Title\\nURL', { text: 'Why Paper Still Wins for Reading\nhttps://www.example.com/news/paper-wins-123' }, 'link'],
  ['a URL alone', { url: 'https://example.com/only' }, 'link'],
  ['nothing', { text: '' }, 'none'],
];

// ---------------------------------------------------------------------------------------------------------------
// diagnostics (F26)

export const REDACT_CASES = [
  'send 0f1e2d3c url sent 201',
  'GET https://ntfy.sh/dls-0123456789abcdef0123456789abcdef/json?poll=1&since=all failed: 429',
  'topic dls-0123456789ABCDEF0123456789abcdef, in a path ntfy.sh/dls-00112233445566778899aabbccddeeff/json',
  'pairing daylightshare://pair?c=ABCDEFGHIJKLMNOPQRSTUVWXYZ23&r=https%3A%2F%2Frelay.example.org',
  'code ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23 and abcdefghijklmnopqrstuvwxyz23 and ABCDEFGHIJKLMNOPQRSTUVWXYZ23',
  'not a code: ABCDEFGHIJKLMNOPQRSTUVWXYZ2 (27) or ABCDEFGHIJKLMNOPQRSTUVWXYZ234 (29) or 0f1e2d3c4b5a69788796a5b4c3d2e1f0',
  'server SERVER-ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23 then daylightserver://setup?c=ABC&r=https://relay.example.org&k=tok',
  'state=server-outdated needs-server error SERVER problem',
  'www.example.com/path and http://localhost:8787/x and chrome-extension://abcdef/popup.html',
  'quotes "https://example.com/a" and <https://example.com/b>',
  'scheme runs: .https://a.example/x 1://b x_y://c git+ssh://d AAAA-AAAA-https://e and ://f; no scheme: a-b-c: 1.2.3',
  '',
];

export const ACTIVITY_CASES = [
  { time: Date.UTC(2026, 9, 20, 8, 0, 0), type: 'send', id: '0f1e2d3c4b5a69788796a5b4c3d2e1f0', kind: 'url', status: 'sent', http: 200 },
  { time: Date.UTC(2026, 9, 20, 8, 0, 30), type: 'ack', id: '0f1e2d3c4b5a69788796a5b4c3d2e1f0', kind: 'url', status: 'delivered' },
  { time: Date.UTC(2026, 9, 20, 8, 1, 0), type: 'poll-error', status: 'GET https://ntfy.sh/dls-0123456789abcdef0123456789abcdef/json failed', http: 429 },
];

export const REPORT_INPUT = {
  app: 'Send to Daylight', version: '1.5.0', platform: 'iphone', lab: true, caps: ['reader-link', 'st', 'tap'],
  checkedIn: Date.UTC(2026, 9, 20, 7, 56, 0), now: Date.UTC(2026, 9, 20, 8, 0, 0), relay: 'https://ntfy.sh',
  rows: [{ status: 'sent' }, { status: 'delivered' }, { status: 'delivered' }, { status: 'failed' }, { status: 'expired' }, { status: 'sending' }],
};

// ---------------------------------------------------------------------------------------------------------------
// Building the expectations

export async function buildW1() {
  const normaliseCases = NORMALISE_CASES.map(([name, input]) => ({ name, input, expect: lab.normaliseShare(input) }));
  const byName = (n) => normaliseCases.find((c) => c.name === n).expect;
  // Pins from the plan (F11.5, F16.1, F16.3, 2.3)
  const firstSelection = normaliseCases.findIndex((c) => c.name.startsWith('Rule 1'));
  assert.ok(firstSelection >= 21);
  for (const c of normaliseCases.slice(0, firstSelection)) assert.equal(c.expect.kind, 'link', `F11.5, F16.1, 6.5 Q1 (b): ${c.name}`);
  assert.equal(byName('NYT app: "Opinion | headline" + short link').title, 'Opinion | The Real Reason Inflation Is Still Too High, According to Economists');
  assert.equal(byName('Chrome on Android: "Title\\nURL"').title, 'Why Paper Still Wins for Reading');
  assert.equal(byName('Substack app: "Read “…” by … on Substack:" + open.substack.com').url, 'https://janedoe.substack.com/p/the-quiet-year');
  assert.equal(byName('Chrome on Android, a page opened from a Google result: "Title\\nURL#:~:text=" stays a link with its title').title, 'How to bake bread - BBC Food');
  assert.equal(byName('A URL with a text fragment and a subject: the subject is the title').title, 'My title');
  assert.equal(byName('Rule 1: "Send as excerpt" on Chrome’s shared selection: the quote without its quotes').excerpt, 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.');
  assert.equal(byName('Rule 1: "Send as excerpt" on a text-fragment URL alone: the fragment’s text').excerpt, 'The quick brown … lazy dog');
  assert.equal(byName('Rule 1: quotes stay when the URL has no text fragment').excerpt, '“To be, or not to be.”');
  assert.equal(byName('Names compare exactly: UTM_source stays (byte-identical)').url, 'https://example.com/p?UTM_source=x&Fbclid=y');
  assert.equal(byName('Names compare exactly: UTM_source stays (byte-identical)').orig, null);
  assert.equal(byName('Only tracking: the ? goes').url, 'https://example.com/p');
  assert.equal(byName('x-orig at 1,024 characters is kept').orig.length, 1024);
  assert.equal(byName('x-orig over 1,024 characters is left out').orig, null);
  assert.equal(byName('Nested: Google /url around Facebook around a tracked link').url, 'https://example.com/deep');
  assert.ok(normaliseCases.length >= 50, 'F16.1: at least 50 vectors');

  const keys = await ds.deriveKeys(KEY_SECRET);
  const xOrigFrames = [];
  for (const [name, item, extras] of X_ORIG_FRAME_CASES) {
    const content = item.contentLength ? contentBytes(item.contentLength) : item.contentText;
    const built = await ds.buildItemFrames(keys, { ...item, id: X_ORIG_ID, sent: '2026-10-20T08:00:00.000Z', content, extras },
      { compress: false, nonces: [new Uint8Array(12)] });
    const { header } = await ds.decryptFrame(keys, 'inbox', built.frames[0]);
    const fields = Object.fromEntries(Object.entries(header).filter(([k]) => k.startsWith('x-')));
    assert.deepEqual(fields, built.extras, name);
    const { contentLength, contentText, ...rest } = item;
    xOrigFrames.push({
      name, item: { ...rest, ...(contentLength ? { contentHex: ds.toHex(content) } : {}), ...(contentText ? { contentText } : {}) },
      extras, expect: { fields, small: ds.isSmallFrame(built.frames[0]) },
    });
  }
  assert.ok(!('x-orig' in xOrigFrames[2].expect.fields) && xOrigFrames[2].expect.small, '2.3: x-orig left out when it would make the frame large');
  assert.ok('x-orig' in xOrigFrames[3].expect.fields && !xOrigFrames[3].expect.small);

  const appleNews = APPLE_NEWS_CASES.map(([name, html]) => ({ name, html, expect: lab.extractAppleNewsTarget(html) }));
  assert.equal(appleNews[0].expect, 'https://www.theatlantic.com/ideas/archive/2026/10/fed/680000/?x=1&y=2');
  assert.equal(appleNews[4].expect, null);

  const normalise = {
    protocol: 'Daylight Share Lab, W1 smart intake (reader-experiment/share/LAB-PROTOCOL.md 2.9; LAB-PLAN F16)',
    generatedBy: 'reader-experiment/share/vectors/generate-lab.mjs',
    notes: [
      'Deterministic: CI regenerates this file and requires no diff.',
      'cases: normaliseShare(input) must equal expect exactly. input: {text?, url?, subject?, source?} (absent = ""). expect: {kind ("link", "excerpt", "note" or "none"), url (cleaned, or null), title (links only, or null), excerpt (excerpts and notes, or null), orig (the URL as shared when the cleaned one differs and it is at most 1,024 characters, or null)}. Under LAB-PLAN 6.5 Q1 = (b), text is an excerpt only for an explicit selection (source "selection"; with a text-fragment URL one pair of quotes is removed, and with no text the fragment\'s own text is used); a note has no URL; every other share is a link, a text-fragment URL included, and a headline + link share keeps the headline (or the subject) as its title.',
      'xOrigFrames: build an item (id X, sent 2026-10-20T08:00:00.000Z; contentHex bytes or contentText UTF-8 for pages and files, no compression) with the Lab extras requested; part 0 must carry exactly expect.fields (its x- header fields), and be small (base64 at most 3,800 characters) when expect.small. x-orig is left out over 1,024 characters, when it fails the web URL rule, and when it alone would turn a small frame into a large one; an unknown x-cap is left out.',
      'appleNews: extractAppleNewsTarget(html) must equal expect (a URL or null).',
    ],
    cases: normaliseCases, xOrigFrames, appleNews,
  };

  // labExcerpt
  const excerptItems = EXCERPT_ITEM_CASES.map(([name, input]) => ({ name, input, expect: lab.excerptItem(input) }));
  assert.equal(excerptItems[0].expect.url, 'https://www.example.com/essays/slow-reading?ref=home#:~:text=Reading%20on%20paper%20is%20slower%2C%20and%20that%20is');
  assert.equal(excerptItems[0].expect.name, 'Excerpt - Reading on paper is slower, and.html');
  assert.ok(excerptItems[1].expect.content.includes('<blockquote><p>First line of a <b>quote</b> that is selected.</p>'));
  assert.ok(!/script|onclick|javascript|<\/article><\/blockquote>/.test(excerptItems[1].expect.content.split('<blockquote>')[1]));
  assert.equal(excerptItems[9].expect.mime, 'text/markdown');
  assert.equal(excerptItems[13].expect, null);
  const sanitize = SANITIZE_CASES.map(([name, html]) => ({ name, html, maxChars: lab.EXCERPT_MAX_CHARS, expect: lab.sanitizeExcerptHtml(html) }))
    .concat(SANITIZE_LIMIT_CASES.map(([name, html, maxChars]) => ({ name, html, maxChars, expect: lab.sanitizeExcerptHtml(html, maxChars) })));
  const allowed = new Set(lab.EXCERPT_TAGS);
  for (const c of sanitize) {
    for (const m of c.expect.html.matchAll(/<\/?([a-z0-9]+)([^>]*)>/g)) {
      assert.ok(allowed.has(m[1]), `F11.3: only the allowed tags (${c.name}: ${m[0]})`);
      assert.ok(m[2] === '' || (m[1] === 'a' && /^ href="https?:\/\/[^"]*"$/.test(m[2])), `F11.3: href only on a (${c.name}: ${m[0]})`);
    }
  }
  const textHtml = TEXT_HTML_CASES.map(([name, text, maxChars = lab.EXCERPT_MAX_CHARS]) => ({ name, text, maxChars, expect: lab.excerptTextHtml(text, maxChars) }));
  const fragments = FRAGMENT_CASES.map(([name, url, text]) => ({ name, url, text, expect: lab.textFragment(url, text) }));
  const dates = DATE_CASES.map((date) => ({ date, expect: lab.excerptDate(date) }));
  assert.equal(dates[0].expect, '22 October 2026');
  const fileNames = FILE_NAME_CASES.map(([name, text, note]) => ({ name, text, note, expect: lab.excerptFileName(text, { note }) }));
  const classify = CLASSIFY_CASES.map(([name, input]) => ({ name, input, expect: lab.classifyShare(input) }));
  for (const [i, [name, , kind]] of CLASSIFY_CASES.entries()) assert.equal(classify[i].expect.kind, kind, `F11.5, 6.5 Q1 (b): ${name}`);
  assert.equal(classify[4].expect.text, 'Quoted words here.');
  assert.equal(classify[5].expect.text, 'start words … end words');
  // The 50,000-character limit (F11.3), pinned by length, hash and ending
  const big = (s) => ({ length: s.length, sha256: sha(s), tail: s.slice(-160) });
  const bigItem = lab.excerptItem({ text: BIG, url: 'https://example.com/big', pageTitle: 'Big', date: DATE });
  const bigHtmlItem = lab.excerptItem({ text: BIG, html: `<p>${BIG}</p>`, url: 'https://example.com/big', pageTitle: 'Big', date: DATE });
  const bigNote = lab.excerptMarkdown({ text: BIG, app: 'Notes', date: DATE });
  assert.ok(bigItem.content.endsWith('<p>(Excerpt trimmed to 50,000 characters.)</p></blockquote></article></body></html>'));
  assert.ok(bigNote.includes('\n\n(Excerpt trimmed to 50,000 characters.)\n\n— shared from Notes on 22 October 2026\n'));
  const limits = {
    input: { textRepeat: 'word ', times: 10010, trim: true, url: 'https://example.com/big', pageTitle: 'Big', date: DATE, app: 'Notes' },
    textItem: big(bigItem.content), htmlItem: big(bigHtmlItem.content), note: big(bigNote),
  };
  const labExcerpt = { items: excerptItems, sanitize, textHtml, fragments, dates, fileNames, classify, limits };

  // diagnostics
  const redact = REDACT_CASES.map((text) => ({ text, expect: lab.redactDiagnostics(text) }));
  for (const c of redact) {
    assert.ok(!/https?:\/\/|dls-[0-9a-f]{32}|daylightserver:|daylightshare:|[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}/i.test(c.expect)
      && !/SERVER-[A-Z0-9]/.test(c.expect), `F26.2: ${c.expect}`);
  }
  const events = ACTIVITY_CASES.map((e) => lab.activityEvent(e));
  const activity = events.map((e) => ({ event: e, line: lab.activityLine(e) }));
  const report = { input: { ...REPORT_INPUT, log: events }, expect: lab.diagnosticsReport({ ...REPORT_INPUT, log: events }) };
  const reportCustom = { input: { ...REPORT_INPUT, lab: false, caps: [], checkedIn: null, relay: 'https://relay.example.org:8443', rows: [], log: [] },
    expect: lab.diagnosticsReport({ ...REPORT_INPUT, lab: false, caps: [], checkedIn: null, relay: 'https://relay.example.org:8443', rows: [], log: [] }) };
  assert.ok(!report.expect.includes('ntfy.sh/') && report.expect.includes('Relay: ntfy.sh'));
  assert.ok(reportCustom.expect.includes('Relay: custom relay') && !reportCustom.expect.includes('relay.example.org'));
  const diagnostics = { redact, activity, reports: [report, reportCustom] };

  // testArticle (F26)
  const testArticle = [
    { id: 'aa'.repeat(16), device: 'Anjan’s iPhone' },
    { id: '0123456789abcdef0123456789abcdef', device: '' },
  ].map((input) => ({ input, expect: lab.testArticle(input) }));
  const words = testArticle[0].expect.content.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length;
  assert.ok(words >= 350 && words <= 450, `F26: about 400 words (${words})`);
  assert.equal(testArticle[0].expect.url, 'https://daylight.invalid/test/' + 'aa'.repeat(16));

  // Inbox lines, cleaned-from and the Use switches (labText additions)
  const kindLines = [
    [{ kind: 'page', extras: {} }], [{ kind: 'page', extras: { 'x-cap': 'seen' }, from: 'iPhone' }], [{ kind: 'page', extras: { 'x-cap': 'clean' } }],
    [{ kind: 'file', extras: { 'x-cap': 'excerpt' }, size: 1200, from: 'Anjan’s Mac' }], [{ kind: 'page', extras: { 'x-cap': 'test' } }],
    [{ kind: 'url', extras: {}, from: 'Chrome' }], [{ kind: 'file', extras: {}, size: 2_345_678 }], [{ kind: 'page', extras: { 'x-cap': 'bogus' } }],
    [{ kind: 'url', extras: { 'x-cap': 'clean' } }], [{ kind: 'file', size: 0 }],
  ].map(([input]) => ({ input, expect: lab.inboxKindLine(input) }));
  const cleanedFrom = ['https://www.example.com/a?utm_source=x', 'https://news.example.org:8443/x', 'https://user@Example.COM/x', 'not a url', null]
    .map((orig) => ({ orig, expect: lab.cleanedFromText(orig) }));
  const use = [
    [{ lab: true }, 'F04'], [{ lab: false }, 'F04'], [{}, 'F16'], [{ lab: true, labUse: { F16: false } }, 'F16'],
    [{ lab: true, labUse: { F16: false } }, 'F04'], [{ lab: true, labUse: { F01: false } }, 'F01'], [{ lab: false }, 'F01'],
    [{ lab: true, labUse: { F33: true } }, 'F33'], [null, 'F03'],
  ].map(([settings, feature]) => ({ settings, feature, expect: lab.labUseOn(settings, feature) }));

  return { normalise, labExcerpt, diagnostics, testArticle, kindLines, cleanedFrom, use };
}
