// The capture code in share/js/capture/ (LAB-PLAN F03, F10, 6.3): clean-html.js on a DOM, the pinned Readability
// 0.6.0, and sync.mjs, which keeps the extension's and GetPage.js's copies equal to the source.
// The DOM is linkedom (a devDependency: npm ci in share/). Without it these tests are skipped locally and fail in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sync from '../capture/sync.mjs';

const require = createRequire(import.meta.url);
const CAPTURE = fileURLToPath(new URL('../capture/', import.meta.url));
const { cleanHtml } = require('../capture/clean-html.js');
const Readability = require('../capture/Readability.js');

let parseHTML = null;
try { ({ parseHTML } = await import('linkedom')); } catch { parseHTML = null; }
const needsDom = parseHTML ? {} : { skip: process.env.CI ? false : 'linkedom is not installed (npm ci in share/)' };
const dom = (html) => {
  if (!parseHTML) throw new Error('linkedom is not installed: run npm ci in reader-experiment/share');
  return parseHTML(html).document;
};

const FIXTURE = `<!doctype html><html lang="en" onload="track()"><head>
<meta charset="utf-8"><title>Account</title>
<meta name="csrf-token" content="SECRET-CSRF"><meta property="og:access_TOKEN" content="SECRET-OG">
<meta name="description" content="Kept description">
<script>window.secret = "SECRET-INLINE";</script>
<script type="module" src="/app.js"></script>
<script type=" Application/LD+JSON ">{"@type":"Article","headline":"Kept JSON-LD"}</script>
<script type="text/javascript">var x = "SECRET-JS";</script>
</head><body onLoad="init()" class="page">
<h1 onclick="steal()">Logged-in article</h1>
<p>Only members see this paragraph.</p>
<form action="/save"><input type="hidden" name="token" value="SECRET-HIDDEN"><input type="PASSWORD" value="SECRET-PASSWORD">
<input type="text" name="q" value="SECRET-TYPED"><textarea name="note">SECRET-TEXTAREA</textarea>
<select><option value="a" selected>Option A</option><option value="b">Option B</option></select></form>
<a href="javascript:steal()">bad</a> <a href="  JaVa&#x0A;Script:steal()">bad2</a> <a href="https://example.com/ok" onmouseover="x()">ok</a>
<iframe srcdoc="<p>SECRET-SRCDOC</p>" src="https://example.com/frame"></iframe>
<img src="/pic.png" ONERROR="x()" alt="Kept picture">
<template id="dialog"><form><input type=hidden name=authenticity_token value=SECRET-TEMPLATE-TOKEN><input type=password value=SECRET-TEMPLATE-PW></form><script>alert("SECRET-TEMPLATE-JS")</script><button onclick=steal()>SECRET-TEMPLATE-BUTTON</button><template><input type=hidden value=SECRET-NESTED-TEMPLATE></template></template>
<svg><a href="javascript:steal()" xlink:href="javascript:steal()"><text>Kept SVG text</text></a><script>steal()</script></svg>
</body></html>`;

test('clean-html: scripts, handlers, form values, srcdoc, javascript: links and token metas go (F03.2)', needsDom, () => {
  const doc = dom(FIXTURE);
  const before = doc.documentElement.outerHTML;
  const out = cleanHtml(doc.documentElement.cloneNode(true));
  assert.ok(out.startsWith('<!doctype html>\n<html'));
  for (const secret of ['SECRET-CSRF', 'SECRET-OG', 'SECRET-INLINE', 'SECRET-JS', 'SECRET-HIDDEN', 'SECRET-PASSWORD', 'SECRET-TYPED',
    'SECRET-TEXTAREA', 'SECRET-SRCDOC', 'SECRET-TEMPLATE', 'SECRET-NESTED-TEMPLATE', 'track()', 'init()', 'steal()', 'x()', 'app.js',
    'selected', 'javascript:', '<template']) {
    assert.ok(!out.toLowerCase().includes(secret.toLowerCase()), `${secret} is gone`);
  }
  assert.ok(!/<script(?![^>]*ld\+json)/i.test(out), 'only the JSON-LD script stays');
  assert.ok(!/\son[a-z]+=/i.test(out), 'no on* attribute');
  for (const kept of ['Kept JSON-LD', 'Kept description', 'Logged-in article', 'Only members see this paragraph.', 'Option A',
    'https://example.com/ok', 'https://example.com/frame', 'Kept picture', 'name="q"', 'class="page"', 'Kept SVG text']) {
    assert.ok(out.includes(kept), `${kept} stays`);
  }
  assert.equal(doc.documentElement.outerHTML, before, 'the live document is untouched');
});

test('clean-html: a <template> goes with its content, which querySelectorAll never reaches (F03.2)', needsDom, () => {
  const doc = dom('<!doctype html><html><body><p>Kept</p><template><form><input type=hidden value=SECRET-T>'
    + '<input type=password value=SECRET-P></form><script>alert(1)</script><button onclick=x()>b</button></template></body></html>');
  const clone = doc.documentElement.cloneNode(true);
  assert.equal(clone.querySelectorAll('input').length, 0, 'the DOM hides the template\'s inputs from querySelectorAll');
  const out = cleanHtml(clone);
  assert.ok(out.includes('<p>Kept</p>'));
  for (const s of ['SECRET-T', 'SECRET-P', 'alert', 'onclick', '<template']) assert.ok(!out.includes(s), s);
});

test('clean-html: a <noscript> holding markup as text (scripting on) is parsed inertly, cleaned and put back (F03.2)', needsDom, () => {
  // linkedom parses <noscript> as a browser does with scripting off; with scripting on (every real page) its content is
  // one text node, and outerHTML writes it out as it is. Build that shape by hand.
  const doc = dom('<!doctype html><html><head><noscript></noscript></head><body><p>Kept</p><noscript></noscript></body></html>');
  const [inHead, inBody] = doc.querySelectorAll('noscript');
  inHead.textContent = '<link rel="stylesheet" href="/noscript.css"><meta name="csrf-token" content="SECRET-NS-META">';
  inBody.textContent = '<form><input type=hidden name=csrf value=SECRET-NS-HIDDEN><input type=text value=SECRET-NS-TYPED>'
    + '<textarea>SECRET-NS-AREA</textarea></form><img src="/lazy.jpg" onerror="x()" alt="Kept lazy picture">'
    + '<template><input type=password value=SECRET-NS-TEMPLATE></template><script>alert("SECRET-NS-JS")</script>';
  inBody.setAttribute('onclick', 'x()');
  const clone = doc.documentElement.cloneNode(true);
  cleanHtml(clone);
  const [head, body] = clone.querySelectorAll('noscript');
  assert.equal(head.textContent, '<link rel="stylesheet" href="/noscript.css">');
  assert.equal(body.textContent, '<form><input type="text"><textarea></textarea></form><img src="/lazy.jpg" alt="Kept lazy picture">');
  assert.ok(!body.hasAttribute('onclick'));
  // The text alone: no markup, nothing to parse
  const plain = dom('<!doctype html><html><body><noscript></noscript></body></html>');
  plain.querySelector('noscript').textContent = 'Please turn on JavaScript & reload.';
  const c2 = plain.documentElement.cloneNode(true);
  cleanHtml(c2);
  assert.equal(c2.querySelector('noscript').textContent, 'Please turn on JavaScript & reload.');
});

test('clean-html: given the live element, it works on a clone', needsDom, () => {
  const doc = dom('<!doctype html><html><body><p onclick="x()">t</p><script>s()</script></body></html>');
  const out = cleanHtml(doc.documentElement);
  assert.ok(!out.includes('onclick') && !out.includes('s()'));
  assert.ok(doc.documentElement.outerHTML.includes('onclick'), 'the page keeps its handlers');
  assert.equal(cleanHtml(null), '');
});

test('Readability is Mozilla Readability 0.6.0 as published, and extracts an article on the test DOM (F10)', needsDom, () => {
  assert.ok(sync.readabilityPinned(), 'Readability.js matches the pinned SHA-256');
  assert.equal(typeof Readability, 'function');
  const paras = Array.from({ length: 10 }, (_, i) => `<p>Paragraph ${i} of a long article, with enough words, commas, and clauses `
    + 'that Readability scores it as the body of the page rather than as navigation or boilerplate.</p>').join('');
  const doc = dom(`<!doctype html><html><head><title>A story - Example News</title></head><body><nav><a href="/">Home</a>
    <a href="/world">World</a></nav><header>Example News header</header><main><article><h1>A story</h1>${paras}</article></main>
    <footer>Copyright Example News</footer></body></html>`);
  const article = new Readability(doc).parse();
  assert.ok(article.textContent.includes('Paragraph 9 of a long article'));
  for (const junk of ['Copyright Example News', 'Example News header']) assert.ok(!article.textContent.includes(junk), junk);
});

test('sync.mjs: whole copies and marked blocks, --check and --write (6.3)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dls-sync-'));
  const run = (...args) => spawnSync(process.execPath, [path.join(CAPTURE, 'sync.mjs'), ...args], { encoding: 'utf8' });
  try {
    const whole = path.join(dir, 'clean-html.js');
    copyFileSync(path.join(CAPTURE, 'clean-html.js'), whole);
    assert.equal(run('--check', whole).status, 0);
    writeFileSync(whole, readFileSync(whole, 'utf8') + '// edited\n');
    const bad = run('--check', whole);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /clean-html differs/);
    assert.equal(run('--write', whole).status, 0);
    assert.equal(readFileSync(whole, 'utf8'), readFileSync(path.join(CAPTURE, 'clean-html.js'), 'utf8'));

    const src = sync.source('clean-html');
    const getPage = path.join(dir, 'GetPage.js');
    writeFileSync(getPage, `var GetPage = function () {};\n  // BEGIN clean-html\n${src}  // END clean-html\n// BEGIN Readability\nstale\n// END Readability\nrun();\n`);
    const r = run('--check', getPage);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /clean-html is up to date/);
    assert.match(r.stderr, /Readability differs/);
    assert.equal(run('--write', getPage).status, 0);
    const written = readFileSync(getPage, 'utf8');
    assert.ok(written.startsWith('var GetPage = function () {};\n  // BEGIN clean-html\n'));
    assert.ok(written.includes(`// BEGIN Readability\n${sync.source('Readability')}// END Readability\nrun();\n`));
    assert.equal(run('--check', getPage).status, 0);

    const none = path.join(dir, 'other.js');
    writeFileSync(none, 'nothing here\n');
    assert.equal(run('--check', none).status, 2);
    assert.equal(run('--frobnicate').status, 2);
    assert.equal(run('--check').status, 0, 'no files: only the Readability pin');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clean-html.js is a classic script: no import or export, so GetPage.js can inline it', () => {
  const src = readFileSync(path.join(CAPTURE, 'clean-html.js'), 'utf8');
  assert.ok(!/^\s*(import|export)\b/m.test(src));
  assert.doesNotThrow(() => new Function(src)); // eslint-disable-line no-new-func
  // run as a page runs it: the only globals it adds are its two functions
  const page = vm.createContext({});
  vm.runInContext(src, page);
  assert.deepEqual(Object.keys(page).sort(), ['cleanHtml', 'prepareForReadability']);
});
