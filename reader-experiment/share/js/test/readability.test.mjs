// F10.1 (LAB-PLAN 3.3): Clean article keeps at least 90% of the body and drops navigation and footers, on a subset of
// Mozilla Readability's own test pages and on ten news-style pages written for this test (fixtures/articles/, whose
// README says where each comes from). Four more pages hold boxes named like summaries that are navigation, related
// links, a newsletter, an advertisement, a weather box, other news and teasers for other stories, which the step before
// Readability must leave alone.
//
// Clean article is what the extension's captureArticle runs in the tab (extension/src/inject.js) and GetPage.js on an
// iPhone, with the capture code of share/js/capture/, in the order share/README.md gives its callers: on a clone of the
// page, prepareForReadability (clean-html.js: summary boxes such as "Key points" moved into the article's text), then
// Readability 0.6.0, then its article HTML cleaned by cleanHtml in a document of its own. The text it keeps is measured
// in words (letters and digits, case and compatibility forms folded), counted with repeats:
// - kept: of the expected body's words, the share the article has (at least 90%);
// - for Readability's pages, extra: of the article's words, the share that is not in Readability's expected output
//   (at most 10%: no navigation, footers or other page furniture came along);
// - for the news and decoy pages, every line of text in the page's navigation, header, footer, asides, forms, comments
//   and cookie notice (3 words or more) is gone, and the article has at least 150 words (no thin-page warning, F10);
//   on the decoy pages, every line of the decoy boxes is gone too.
// The DOM is linkedom (a devDependency: npm ci in share/). Without it these tests are skipped locally and fail in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { cleanHtml, prepareForReadability } = require('../capture/clean-html.js');
const Readability = require('../capture/Readability.js');

let parseHTML = null;
try { ({ parseHTML } = await import('linkedom')); } catch { parseHTML = null; }
const needsDom = parseHTML ? {} : { skip: process.env.CI ? false : 'linkedom is not installed (npm ci in share/)' };

const ARTICLES = new URL('./fixtures/articles/', import.meta.url);
const READABILITY = new URL('readability/', ARTICLES);
const NEWS = new URL('news/', ARTICLES);
const DECOYS = new URL('decoys/', ARTICLES);
const read = (url) => readFileSync(url, 'utf8');

/**
 * Clean article, as its callers run it: on a clone of the page prepareForReadability, then Readability, then its content
 * cleaned by cleanHtml in a document of its own. With prepare: false, Readability alone on the clone (what Clean
 * article was before the step). -> {html, text, article, moved}
 */
function cleanArticle(html, { prepare = true } = {}) {
  const { document } = parseHTML(html);
  const clone = document.cloneNode(true);
  const moved = prepare ? prepareForReadability(clone) : 0;
  const article = new Readability(clone).parse();
  if (!article || !article.content) return { html: '', text: '', article, moved };
  const { document: doc } = parseHTML('<!doctype html><html><head></head><body></body></html>');
  doc.body.innerHTML = article.content;
  let content = cleanHtml(doc.body);
  const head = '<!doctype html>\n<body>';
  if (content.startsWith(head) && content.endsWith('</body>')) content = content.slice(head.length, -'</body>'.length);
  return { html: content, text: textOf(content), article, moved };
}

/** Elements a reader shows apart from the text around them (textContent would run "<td>Now</td><td>2.10</td>" together). */
const BLOCKS = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'div', 'dl', 'dt', 'figcaption',
  'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);

/** The text of an HTML fragment, as a reader shows it: no markup, blocks and table cells apart. */
function textOf(fragment) {
  const { document } = parseHTML(`<!doctype html><html><head></head><body>${fragment}</body></html>`);
  const out = [];
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) out.push(n.textContent);
      else if (n.nodeType === 1) {
        const block = BLOCKS.has(String(n.localName).toLowerCase());
        if (block) out.push(' ');
        walk(n);
        if (block) out.push(' ');
      }
    }
  };
  walk(document.body);
  return out.join('');
}

/** Words: runs of letters and digits, lowercased, compatibility forms folded (ﬁ is fi), quotes and dashes ignored. */
const words = (text) => String(text).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Of `want`'s words, the share `got` has, counting repeats (a multiset intersection). 1 when `want` has none. */
function share(want, got) {
  const bag = new Map();
  for (const w of got) bag.set(w, (bag.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of want) {
    const n = bag.get(w) ?? 0;
    if (n > 0) { hit++; bag.set(w, n - 1); }
  }
  return want.length ? hit / want.length : 1;
}

const flat = (text) => words(text).join(' ');
const pct = (x) => `${(x * 100).toFixed(1)}%`;

test('the measure: kept and extra count words with repeats, folding case and compatibility forms', () => {
  assert.deepEqual(words('The “Reader’s” ﬁrst-class — 2 Ünïcode words.'), ['the', 'reader', 's', 'first', 'class', '2', 'ünïcode', 'words']);
  assert.equal(share(words('a a b c'), words('a b c')), 0.75, 'a repeat counts once per occurrence');
  assert.equal(share(words('a b'), words('B A extra')), 1);
  assert.equal(share([], words('x')), 1);
  assert.equal(share(words('a b c d e f g h i j'), words('a b c d e f g h i')), 0.9);
});

// ---------------------------------------------------------------------------------------------------------------
// Readability's own test pages (Apache-2.0: readability/LICENSE.md), copied unmodified; pages.json pins each file

const MANIFEST = JSON.parse(read(new URL('pages.json', READABILITY)));
const PAGES = Object.keys(MANIFEST.pages);

test('Readability test pages: the subset is the one pages.json lists, each file unmodified (SHA-256)', () => {
  const dirs = readdirSync(READABILITY, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  assert.deepEqual(dirs, [...PAGES].sort());
  assert.ok(PAGES.length >= 20, `${PAGES.length} pages`);
  for (const page of PAGES) {
    for (const [file, sum] of Object.entries(MANIFEST.pages[page])) {
      assert.equal(createHash('sha256').update(readFileSync(new URL(`${page}/${file}`, READABILITY))).digest('hex'), sum, `${page}/${file}`);
    }
  }
  assert.match(read(new URL('LICENSE.md', READABILITY)), /Licensed under the Apache License, Version 2\.0/);
});

for (const page of PAGES) {
  test(`F10.1 Readability page ${page}: Clean article keeps at least 90% of the expected body and adds at most 10%`, needsDom, (t) => {
    const expected = words(textOf(read(new URL(`${page}/expected.html`, READABILITY))));
    const source = read(new URL(`${page}/source.html`, READABILITY));
    const got = cleanArticle(source);
    const kept = share(expected, words(got.text));
    const extra = 1 - share(words(got.text), expected);
    t.diagnostic(`kept ${pct(kept)} of ${expected.length} words; ${pct(extra)} extra`);
    assert.ok(kept >= 0.9, `${page}: kept ${pct(kept)} of ${expected.length} words`);
    assert.ok(extra <= 0.1, `${page}: ${pct(extra)} of the article is not in the expected body`);
    assert.ok(!/<script(?![^>]*ld\+json)|\son[a-z]+=|javascript:/i.test(got.html), `${page}: the article is cleaned`);
    // what every one of these pages gets today: all of the expected body and nothing else, and the step before
    // Readability finds no summary box here, so Clean article is exactly Readability's
    assert.equal(kept, 1, `${page}: kept ${pct(kept)}`);
    assert.equal(extra, 0, `${page}: ${pct(extra)} extra`);
    assert.equal(got.moved, 0, `${page}: prepareForReadability moved ${got.moved} boxes`);
    assert.equal(got.html, cleanArticle(source, { prepare: false }).html, `${page}: the same article as Readability's alone`);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Ten news-style pages written for this test: news/<name>.html and the body it must keep, news/<name>.txt

const pagesIn = (dir) => readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -'.html'.length)).sort();
const NEWS_PAGES = pagesIn(NEWS);
/**
 * Where a news page keeps what is not the article (none of it holds article text): navigation, the site's header and
 * footer, asides, forms, comments and the cookie notice. F10.1 names navigation and footers. An advertisement placed
 * inside the article's own text is not in this list: Readability keeps its text (lumen-leaf-ereader.html has one).
 */
const FURNITURE = 'nav, body > header, footer, aside, form, .comments, .cookie-banner';

test('the news fixtures: ten pages, each with its expected body', () => {
  assert.equal(NEWS_PAGES.length, 10, NEWS_PAGES.join(', '));
  for (const name of NEWS_PAGES) {
    const body = read(new URL(`${name}.txt`, NEWS));
    assert.ok(words(body).length >= 250, `${name}: ${words(body).length} words of body`);
  }
});

/**
 * The boxes prepareForReadability moves on each news page: storm-warning-live's Key points (a heading and a list beside
 * the live entries, which Readability alone drops: 87% of the body kept) go to the start of the entries. It finds none
 * on the other nine, whose Clean article is exactly Readability's.
 */
const MOVED = { 'storm-warning-live': 1 };

const measured = new Map();
/** Clean article of a page in dir, measured against its body (dir/<name>.txt). */
function measure(dir, name) {
  const key = new URL(name, dir).href;
  if (measured.has(key)) return measured.get(key);
  const html = read(new URL(`${name}.html`, dir));
  const body = read(new URL(`${name}.txt`, dir));
  const got = cleanArticle(html);
  const article = flat(got.text);
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const m = { html, body, got, article, paragraphs, kept: share(words(body), words(got.text)),
    missing: paragraphs.filter((p) => !article.includes(flat(p))) };
  measured.set(key, m);
  return m;
}

/** Each line of text (3 words or more) in the elements a selector finds in a page, flattened. */
function linesIn(html, selector) {
  const { document } = parseHTML(html);
  const lines = new Set();
  for (const region of document.querySelectorAll(selector)) {
    for (const el of [region, ...region.querySelectorAll('*')]) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ');
      const line = el.children.length ? own : el.textContent;
      if (words(line).length >= 3) lines.add(flat(line));
    }
  }
  return [...lines];
}

/** F10.1 on one page: at least 90% of its body, and every paragraph of it word for word but at most one in ten. */
function assertKeepsBody(t, m, name) {
  t.diagnostic(`kept ${pct(m.kept)} of ${words(m.body).length} words; ${m.missing.length} of ${m.paragraphs.length} paragraphs missing`);
  assert.ok(m.kept >= 0.9, `${name}: kept ${pct(m.kept)} of ${words(m.body).length} words`);
  assert.ok(m.missing.length <= Math.floor(m.paragraphs.length / 10), `${name}: paragraphs missing: ${m.missing.map((p) => p.slice(0, 40)).join(' | ')}`);
}

/** F10.1 on one page: the page's furniture is gone (each line of text of 3 words or more), and the article is not thin. */
function assertDropsFurniture(m, name) {
  assert.ok(words(m.got.text).length >= 150, `${name}: ${words(m.got.text).length} words, no thin-page warning`);
  assert.ok(!/<script(?![^>]*ld\+json)|\son[a-z]+=|javascript:/i.test(m.got.html), `${name}: the article is cleaned`);
  const lines = linesIn(m.html, FURNITURE);
  assert.ok(lines.length >= 5, `${name}: ${lines.length} lines of furniture to look for`);
  assert.deepEqual(lines.filter((l) => m.article.includes(l)), [], `${name}: furniture in the article`);
  // and no line of furniture is in the body itself (the fixture is fair)
  assert.deepEqual(lines.filter((l) => m.paragraphs.some((p) => flat(p).includes(l))), [], `${name}: furniture that is also body`);
}

for (const name of NEWS_PAGES) {
  test(`F10.1 news page ${name}: Clean article keeps at least 90% of the body`, needsDom, (t) => {
    assertKeepsBody(t, measure(NEWS, name), name);
  });

  test(`F10.1 news page ${name}: Clean article drops navigation and footers, and is not thin`, needsDom, () => {
    assertDropsFurniture(measure(NEWS, name), name);
  });

  test(`F10.1 news page ${name}: prepareForReadability moves ${MOVED[name] ?? 0} boxes`, needsDom, (t) => {
    const m = measure(NEWS, name);
    const alone = cleanArticle(m.html, { prepare: false });
    assert.equal(m.got.moved, MOVED[name] ?? 0);
    if (!MOVED[name]) {
      assert.equal(m.got.html, alone.html, `${name}: the same article as Readability's alone`);
      return;
    }
    const before = share(words(m.body), words(alone.text));
    t.diagnostic(`Readability alone keeps ${pct(before)} of the body`);
    assert.ok(before < 0.9, `${name}: Readability alone keeps ${pct(before)}, so this page still tests the step`);
  });
}

test('F10.1 news page storm-warning-live: the Key points come first, before the live entries, as on the page', needsDom, () => {
  const { article } = measure(NEWS, 'storm-warning-live');
  const at = (text) => article.indexOf(flat(text));
  assert.ok(at('Key points') >= 0, 'the box\'s heading is in the article');
  assert.ok(at('Key points') < at('An amber warning for wind covers'), 'its heading, then its list');
  assert.ok(at('Gusts of up to 120 kilometres') < at('14:05 Schools to close early'), 'the list, then the newest entry');
});

// ---------------------------------------------------------------------------------------------------------------
// Four pages with boxes named like summaries that are not the article's own text: decoys/<name>.html and its body,
// decoys/<name>.txt. Each box sits in the article beside its text, as storm-warning-live's Key points do, and is named
// or titled as a summary box ("At a glance", "Highlights", "In brief", "Key points", "Takeaways") holding a list. What it
// is gives it away, and prepareForReadability must leave it where it is, so Readability drops it as before.

const DECOY_PAGES = pagesIn(DECOYS);
/** Per page: each decoy box, by selector, and what it is. */
const DECOY_BOXES = {
  'harbour-bridge-repairs': {
    '.at-a-glance': 'navigation: role="navigation", and every item a link to a part of the page',
    '.story-highlights': 'related links: every item a link to another story',
  },
  'market-hall-newsletter': { '.key-points-signup': 'a newsletter: a sign-up name and a form' },
  'river-festival-sponsored': { '.takeaways': 'an advertisement: an ad-slot class, an Advertisement aria-label and an ad-label inside' },
  'valley-night-buses': {
    '.at-a-glance': 'a weather box: role="complementary" only',
    '.in-brief': 'other news: two items of five are links, but links are nearly half of its text',
    '.highlights': 'teasers for other stories: each item an <article> with a headline, and no link (cards a script opens)',
  },
};

/** Each link in el replaced by its text. */
const unlink = (el) => { for (const a of [...el.querySelectorAll('a')]) a.replaceWith(...a.childNodes); };

/**
 * The page with each decoy box turned into a plain summary box: no role, aria-label or id, class="key-points"; in it, no
 * class, id, role or aria-label, its links replaced by their text, its forms, iframes and media removed, and its items'
 * headings and <article>s replaced by what they hold. prepareForReadability must then move every one of them, which
 * shows that only what they are kept them out.
 */
function defused(html, selectors) {
  const { document } = parseHTML(html);
  for (const box of selectors.map((s) => document.querySelector(s))) {
    for (const a of ['role', 'aria-label', 'id']) box.removeAttribute(a);
    box.setAttribute('class', 'key-points');
    for (const el of box.querySelectorAll('*')) for (const a of ['class', 'id', 'role', 'aria-label']) el.removeAttribute(a);
    unlink(box);
    for (const f of [...box.querySelectorAll('form, iframe, video, audio, embed, object')]) f.remove();
    for (const h of [...box.querySelectorAll('li h1, li h2, li h3, li h4, li h5, li h6, li article')]) h.replaceWith(...h.childNodes);
  }
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

test('the decoy fixtures: four pages, each with its expected body and the boxes DECOY_BOXES names', () => {
  assert.deepEqual(DECOY_PAGES, Object.keys(DECOY_BOXES).sort());
  for (const name of DECOY_PAGES) {
    assert.ok(words(read(new URL(`${name}.txt`, DECOYS))).length >= 250, name);
    const html = read(new URL(`${name}.html`, DECOYS));
    for (const selector of Object.keys(DECOY_BOXES[name])) assert.equal(html.split(`class="${selector.slice(1)}`).length, 2, `${name}: one ${selector}`);
  }
});

for (const name of DECOY_PAGES) {
  const boxes = Object.keys(DECOY_BOXES[name]);
  test(`F10.1 decoy page ${name}: Clean article keeps at least 90% of the body and drops navigation and footers`, needsDom, (t) => {
    const m = measure(DECOYS, name);
    assertKeepsBody(t, m, name);
    assertDropsFurniture(m, name);
  });

  const kinds = Object.values(DECOY_BOXES[name]).map((k) => k.split(':')[0]);
  test(`F10.1 decoy page ${name}: prepareForReadability leaves ${[kinds.slice(0, -1).join(', '), kinds.at(-1)].filter(Boolean).join(' and ')} alone`, needsDom, () => {
    const m = measure(DECOYS, name);
    assert.equal(m.got.moved, 0);
    assert.equal(m.got.html, cleanArticle(m.html, { prepare: false }).html, `${name}: the same article as Readability's alone`);
    const lines = linesIn(m.html, boxes.join(', '));
    assert.ok(lines.length >= 3 * boxes.length, `${name}: ${lines.length} lines in its boxes`);
    assert.deepEqual(lines.filter((l) => m.article.includes(l)), [], `${name}: a decoy box in the article`);
    assert.deepEqual(lines.filter((l) => m.paragraphs.some((p) => flat(p).includes(l))), [], `${name}: decoy text that is also body`);
    // the same boxes as plain summary boxes are moved and kept
    const plain = defused(m.html, boxes);
    const got = cleanArticle(plain);
    assert.equal(got.moved, boxes.length, `${name}: defused, every box moves`);
    const text = flat(got.text);
    assert.deepEqual(linesIn(plain, '.key-points').filter((l) => !text.includes(l)), [], `${name}: defused, the boxes are kept`);
  });
}

/**
 * A decoy box with one of its markers left, which alone must keep it out: [page, box, the marker left, the change]. The
 * newsletter's form is enough on its own, and so is an iframe in its place: the list in the box is not then a bare
 * list named by the box's heading.
 */
const ONE_MARKER = [
  ['harbour-bridge-repairs', '.at-a-glance', 'role="navigation"', (box) => { box.removeAttribute('aria-label'); unlink(box); }],
  ['harbour-bridge-repairs', '.at-a-glance', 'its links', (box) => { box.removeAttribute('role'); box.removeAttribute('aria-label'); }],
  ['market-hall-newsletter', '.key-points-signup', 'its sign-up name', (box) => box.querySelector('form').remove()],
  ['market-hall-newsletter', '.key-points-signup', 'its form (class="key-points-box")', (box) => box.setAttribute('class', 'key-points-box')],
  ['market-hall-newsletter', '.key-points-signup', 'its form (no class: its heading names it)', (box) => box.removeAttribute('class')],
  ['market-hall-newsletter', '.key-points-signup', 'an iframe in place of its form (class="key-points-box")', (box) => {
    box.setAttribute('class', 'key-points-box');
    const iframe = box.ownerDocument.createElement('iframe');
    iframe.setAttribute('src', 'https://newsletters.example.net/ashcombe/friday');
    iframe.setAttribute('title', 'Sign up for the Friday email');
    box.querySelector('form').replaceWith(iframe);
  }],
  ['river-festival-sponsored', '.takeaways', 'its ad-slot class', (box) => {
    box.removeAttribute('aria-label');
    box.querySelector('.ad-label').removeAttribute('class');
  }],
  ['river-festival-sponsored', '.takeaways', 'its aria-label', (box) => {
    box.setAttribute('class', 'takeaways');
    box.querySelector('.ad-label').removeAttribute('class');
  }],
  ['river-festival-sponsored', '.takeaways', 'its Advertisement label (class="ad-label")', (box) => {
    box.setAttribute('class', 'takeaways');
    box.removeAttribute('aria-label');
  }],
];

for (const [name, selector, marker, change] of ONE_MARKER) {
  test(`F10.1 decoy page ${name}: ${selector} with ${marker} only stays out`, needsDom, () => {
    const html = read(new URL(`${name}.html`, DECOYS));
    const lines = linesIn(html, selector);
    const { document } = parseHTML(html);
    change(document.querySelector(selector));
    const variant = `<!doctype html>\n${document.documentElement.outerHTML}`;
    assert.notEqual(variant, html);
    const got = cleanArticle(variant);
    assert.equal(got.moved, 0, `${name}: ${selector} with ${marker} only`);
    const text = flat(got.text);
    assert.deepEqual(lines.filter((l) => text.includes(l)), [], `${name}: ${selector} in the article`);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// prepareForReadability on small pages: where else a summary box sits, and what it never touches

const PARAGRAPHS = [
  'Ferry fares on every route across the estuary will rise by five per cent in January, the operator said on Monday, the first increase in three years.',
  'The company blamed the cost of fuel, which has almost doubled since the last rise, and the price of the two new boats that joined the fleet in the spring.',
  'Season tickets will rise by less, by three per cent, and the discount for people who live on the islands will stay at half the full fare, as it is now.',
  'Children under twelve will travel free all year, instead of only in the school holidays, which the operator said would cost it about a million a year.',
  'Passenger groups said they were disappointed, but that the free travel for children would help families who rely on the ferry to reach school and work.',
  'The new fares will be published on the operator\'s website next week, and tickets bought before the end of December can be used at the old price until March.',
];
const BODY = `<div class="article-body">${PARAGRAPHS.map((p) => `<p>${p}</p>`).join('')}</div>`;
const BOX = '<div class="key-points"><h2>Key points</h2><ul><li>Fares rise by five per cent from January.</li><li>Children under twelve travel free all year.</li></ul></div>';
const pageWith = (inside, wrap = 'article') => '<!doctype html><html><head><title>Ferry fares to rise in January - The Estuary Times</title></head><body>'
  + `<nav><a href="/">Home</a> <a href="/news">News</a></nav><main><${wrap} class="story">${inside}</${wrap}></main><footer>The Estuary Times</footer></body></html>`;
/** Where text sits in a Clean article (-1: not there). */
const where = (got, text) => flat(got.text).indexOf(flat(text));

test('prepareForReadability: a box in the article\'s header, or after its text, is kept where it was in the reading order', needsDom, () => {
  for (const [what, inside, first] of [
    ['in the header', `<header><h1>Ferry fares to rise in January</h1>${BOX}</header>${BODY}`, true],
    ['before the text', `<h1>Ferry fares to rise in January</h1>${BOX}${BODY}`, true],
    ['after the text', `<h1>Ferry fares to rise in January</h1>${BODY}${BOX}`, false],
  ]) {
    const html = pageWith(inside);
    assert.equal(where(cleanArticle(html, { prepare: false }), 'Children under twelve travel free all year'), -1, `${what}: Readability alone drops it`);
    const got = cleanArticle(html);
    assert.equal(got.moved, 1, what);
    const box = where(got, 'Key points Fares rise by five per cent from January Children under twelve travel free all year');
    assert.ok(box >= 0, `${what}: kept`);
    assert.equal(box < where(got, PARAGRAPHS[0]), first, `${what}: in its place`);
    assert.equal(box > where(got, PARAGRAPHS[5]), !first, `${what}: in its place`);
  }
});

test('prepareForReadability: a bare list under a "Key takeaways" heading moves with it, an <aside> box becomes a <div>, and two boxes keep their order', needsDom, () => {
  const bare = cleanArticle(pageWith(`<h1>Ferry fares</h1><h3>Key takeaways</h3><ul><li>Fares rise by five per cent from January.</li><li>Children under twelve travel free all year.</li></ul>${BODY}`));
  assert.equal(bare.moved, 1);
  assert.ok(where(bare, 'Key takeaways Fares rise by five per cent') >= 0, 'the heading and its list');

  const aside = BOX.replace('<div class="key-points">', '<aside class="highlights">').replace(/<\/div>$/, '</aside>').replace('Key points', 'Highlights');
  const inBody = BODY.replace('</p><p>', `</p>${aside}<p>`);
  assert.equal(where(cleanArticle(pageWith(inBody), { prepare: false }), 'Children under twelve travel free'), -1, 'Readability alone drops every <aside>');
  const kept = cleanArticle(pageWith(inBody));
  assert.equal(kept.moved, 1);
  assert.ok(where(kept, PARAGRAPHS[0]) < where(kept, 'Highlights Fares rise') && where(kept, 'Highlights Fares rise') < where(kept, PARAGRAPHS[1]), 'in its place');
  assert.ok(!kept.html.includes('<aside'));

  const second = BOX.replace('key-points', 'at-a-glance').replace('Key points', 'At a glance').replace('Fares rise by five per cent from January', 'Season tickets rise by three per cent');
  const two = cleanArticle(pageWith(`<header><h1>Ferry fares</h1>${BOX}</header>${second}${BODY}`));
  assert.equal(two.moved, 2);
  assert.ok(where(two, 'Key points') < where(two, 'At a glance') && where(two, 'At a glance') < where(two, PARAGRAPHS[0]), 'the first box, the second, the text');
});

const LI = '<li>Fares rise by five per cent from January.</li><li>Children under twelve travel free all year.</li>';
/** A box: <div attrs> holding a "Key points" heading, then the list's items, then more (the default: the two items). */
const box = (attrs, items = LI, more = '') => `<div ${attrs}><h2>Key points</h2><ul>${items}</ul>${more}</div>`;
const LINK = 'Read the operator\'s announcement and the new table of fares for every route';
const H1 = '<h1>Ferry fares to rise in January</h1>';
/**
 * Each rule that keeps a box out, on its own: [the rule, the article with a box it turns down, the same box without
 * that one thing]. The first must move nothing, the second its box.
 */
const RULES = [
  ['a furniture role on the box', box('class="key-points" role="complementary"'), box('class="key-points"')],
  ['a furniture tag around it: the article\'s <footer>', `${BODY}<footer>${BOX}</footer>`, `${BODY}<div>${BOX}</div>`],
  ['a furniture name on the box', box('class="key-points newsletter"'), box('class="key-points"')],
  ['a furniture name around it in the article', `<div class="promo"><p>From the Ferry Company</p>${BOX}</div>`, `<div class="extra"><p>From the Ferry Company</p>${BOX}</div>`],
  ['a furniture name in it: an Advertisement label', box('class="key-points"', LI, '<p class="ad-label">Advertisement</p>'), box('class="key-points"', LI, '<p class="label">Advertisement</p>')],
  ['a furniture name on the heading that names a bare list', `<h3 class="newsletter-title">Key takeaways</h3><ul>${LI}</ul>`, `<h3 class="title">Key takeaways</h3><ul>${LI}</ul>`],
  ['fewer than 25 characters', '<div class="key-points"><ul><li>Yes.</li><li>No.</li></ul></div>', '<div class="key-points"><ul><li>Yes, from January.</li><li>No, not in summer.</li></ul></div>'],
  ['no list', '<div class="summary"><h2>Summary</h2><p>Fares rise by five per cent from January, and children under twelve travel free.</p></div>', box('class="summary"')],
  ['a list of one item', box('class="key-points"', '<li>Fares rise by five per cent from January, and children under twelve travel free.</li>'), box('class="key-points"')],
  ['an item with a heading (a teaser)', box('class="key-points"', `<li><h3>Fares</h3> rise by five per cent from January.</li>${LI}`), box('class="key-points"', `<li><b>Fares</b> rise by five per cent from January.</li>${LI}`)],
  ['an item with an <article> (a teaser)', box('class="key-points"', `<li><article>Fares rise by five per cent from January.</article></li>${LI}`), box('class="key-points"', `<li><div>Fares rise by five per cent from January.</div></li>${LI}`)],
  ['half of the items hold a link', box('class="key-points"', '<li>Fares rise by five per cent (<a href="/fares">fares</a>).</li><li>Children under twelve travel free all year.</li>'), box('class="key-points"', '<li>Fares rise by five per cent (fares).</li><li>Children under twelve travel free all year.</li>')],
  ['more than a quarter of its text is links, in fewer than half of its items', box('class="key-points"', `${LI}<li><a href="/fares">${LINK}</a></li>`), box('class="key-points"', `${LI}<li>${LINK}</li>`)],
  ['an iframe in it', box('class="key-points"', LI, '<iframe src="https://video.example.net/embed/ferries" title="Watch: the new boats"></iframe>'), box('class="key-points"')],
  ['a video in it', box('class="key-points"', LI, '<video src="https://video.example.net/ferries.mp4" controls></video>'), box('class="key-points"')],
  ['a form in a box its heading names: not a bare list either', `<div class="key-points-box"><h2>Key points, every Friday</h2><ul>${LI}</ul><form action="/signup"><input type="email" name="email"></form></div>`, `<div class="key-points-box"><h2>Key points, every Friday</h2><ul>${LI}</ul></div>`],
  ['links in a box its heading names: not a bare list either', box('class="key-points"', LI, `<p><a href="/fares">${LINK}</a></p>`), box('class="key-points"', LI, `<p>${LINK}</p>`)],
];

for (const [rule, out, plain] of RULES) {
  test(`prepareForReadability keeps a box out for ${rule}, on its own`, needsDom, () => {
    const at = (b) => (b.startsWith(BODY) ? `${H1}${b}` : `${H1}${b}${BODY}`);
    assert.equal(prepareForReadability(parseHTML(pageWith(at(out))).document), 0, `${rule}: stays out`);
    assert.equal(prepareForReadability(parseHTML(pageWith(at(plain))).document), 1, `${rule}: without it, the box moves`);
  });
}

test('prepareForReadability: nothing moves outside an <article> or <main>, inside the text already, or on the page\'s own document', needsDom, () => {
  for (const [what, html] of [
    ['no article or main', pageWith(`<h1>Ferry fares</h1>${BOX}${BODY}`, 'div').replace(/<\/?main>/g, '')],
    ['already in the text', pageWith(`<h1>Ferry fares</h1>${BODY.replace('</p><p>', `</p>${BOX}<p>`)}`)],
  ]) {
    const got = cleanArticle(html);
    assert.equal(got.moved, 0, what);
    assert.equal(got.html, cleanArticle(html, { prepare: false }).html, what);
  }
  const { document } = parseHTML(pageWith(`<h1>Ferry fares</h1>${BOX}${BODY}`));
  const before = document.documentElement.outerHTML;
  const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = document; // as in a page, where `document` is the live page
  try {
    assert.equal(prepareForReadability(document), 0, 'the live page: never changed');
    assert.equal(document.documentElement.outerHTML, before);
    assert.equal(prepareForReadability(document.cloneNode(true)), 1, 'its clone: the box moves');
  } finally {
    if (had) Object.defineProperty(globalThis, 'document', had); else delete globalThis.document;
  }
  assert.equal(prepareForReadability(null), 0);
});
