// The window's page (dist/index.html) in a real Chromium, with a fake bridge in place of Rust, for the accessibility
// baseline (LAB-PLAN F27) and the Lab-off parity baselines (1.7):
//
//   startUi()                    serves dist/ (built once per process) with the CSP Tauri gives the window, and launches
//                                Chromium (Playwright's, or DLS_UI_CHANNEL=msedge for Edge, WebView2's engine);
//   ui.open({kv, ...})           a window: a page at the narrowest width with window.__TAURI__ faked from a seed
//                                (the JSON store's keys, app_info), waiting until the app says it is ready;
//   axe, assertAxeSees, assertNotClipped, unnamed, shot, scaleText    the F27 checks (as the extension's tests do);
//   historyRows, parityRows, seedPaired                                outbox rows in every state of CHANGES-v1.1 2.5;
//   expectBaseline(page, name)   compares locator('body').ariaSnapshot() with test/lab-off-baseline/<name>.yml.
//
// The fake bridge answers every command bridge.js sends (main.rs registers the same, build.test.mjs checks), keeps
// the store in the page (window.__fake.kv: key -> JSON text) and lets a test emit Rust's events (dls://tick, …).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { dist, load } from './built.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
export const SHOTS = path.join(root, 'test-results', 'a11y');
export const BASELINES = path.join(root, 'test', 'lab-off-baseline');

/**
 * The narrowest window is tauri.conf.json's minWidth (360). WebView2 on Windows draws a classic scrollbar (17 px) once
 * the page is taller than the window, and the headless test browser hides scrollbars, so the page is laid out at
 * 360 − 17 = 343 px here: what the narrowest window leaves for the page.
 */
export const MIN_WIDTH = 360;
export const SCROLLBAR = 17;
export const NARROWEST = MIN_WIDTH - SCROLLBAR;

const conf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

export const ds = await load('daylight-share.js');

/** A fixed pairing secret, so the code (and anything built from it) is the same every run. */
export const FIXED_SECRET = Uint8Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 0xff);
export const OTHER_SECRET = Uint8Array.from({ length: 16 }, (_, i) => (i * 53 + 7) & 0xff);

/** What app_info answers: an installed app, not in test mode, with Send to › Daylight set up. */
export function appInfo(over = {}) {
  return {
    version: '1.1.0',
    e2e: { pair: null, status: false },
    sendTo: { path: 'C:\\Users\\you\\AppData\\Roaming\\Microsoft\\Windows\\SendTo\\Daylight.lnk', exists: true, error: '' },
    autostart: false,
    ...over,
  };
}

/** Runs in the page before any of its scripts: window.__TAURI__ answered from the seed, and window.__fake to steer it. */
function fakeTauri(seed) {
  const kv = new Map(Object.entries(seed.kv ?? {}));
  const listeners = {};
  const fake = {
    kv, listeners, calls: [], actions: [], notes: [], info: seed.info,
    emit(name, payload = null) { for (const fn of listeners[name] ?? []) fn({ event: name, payload }); },
    /** An action from outside the window (Send To, the hotkey…): queued as Rust does, then the window is woken. */
    queue(a) { fake.actions.push(a); fake.emit('dls://wake'); },
    json(key) { return kv.has(key) ? JSON.parse(kv.get(key)) : undefined; },
  };
  const handlers = {
    app_info: () => fake.info,
    take_actions: () => fake.actions.splice(0),
    kv_get: ({ key }) => (kv.has(key) ? kv.get(key) : null),
    kv_set: ({ key, value }) => {
      if ((seed.failWrites ?? []).includes(key)) throw `couldn't save ${key}: disk full`;
      kv.set(key, value);
      return null;
    },
    kv_remove: ({ key }) => { kv.delete(key); return null; },
    kv_set_aside: ({ key }) => { kv.delete(key); return null; },
    read_file: () => { throw 'Couldn’t open it (not found).'; },
    read_clipboard: () => seed.clipboard ?? '',
    notify: ({ title, body }) => { fake.notes.push({ title, body }); return null; },
    show_window: () => null,
    hide_window: () => null,
    set_hotkey: ({ accel }) => accel,
    set_autostart: ({ enabled }) => { fake.info.autostart = enabled; return enabled; },
    add_send_to: () => { fake.info.sendTo = { ...fake.info.sendTo, exists: true }; return fake.info.sendTo; },
    e2e_status: () => null,
  };
  window.__fake = fake;
  window.__TAURI__ = {
    core: {
      async invoke(cmd, args = {}) {
        fake.calls.push(cmd);
        const h = handlers[cmd];
        if (!h) throw `unknown command ${cmd}`;
        const v = h(args);
        return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v));
      },
    },
    event: {
      async listen(name, fn) {
        (listeners[name] ??= []).push(fn);
        return () => { listeners[name] = listeners[name].filter((f) => f !== fn); };
      },
    },
  };
}

/** The store's keys as the app writes them (JSON text). */
export function kvOf(values) {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => [k, JSON.stringify(v)]));
}

/** The pairing as savePairing stores it. */
export async function pairingValue({ secret = FIXED_SECRET, relay, name = 'Desk Daylight' } = {}) {
  return { code: await ds.formatCode(secret), relay: ds.normalizeRelay(relay), name };
}

/** Serves dist/ and launches the browser. -> {url, browser, open(seed), close()} */
export async function startUi() {
  const out = dist();
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(out, p === '/' ? 'index.html' : p);
    if (!file.startsWith(out) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      // The window's own policy (tauri.conf.json), so a page change that the app would refuse fails here too.
      'Content-Security-Policy': conf.app.security.csp,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.DLS_UI_CHANNEL || undefined, headless: !process.env.HEADED });

  /**
   * A window on the page. seed: {kv: {key: JSON text}, info, clipboard, failWrites: [keys]}; width (default the
   * narrowest), height, colorScheme, now (a fixed Date.now(), for times that read the same every run).
   * -> the page, once the app has drawn its first view (body[data-ready="1"]); page.errors collects page errors.
   */
  async function open({ width = NARROWEST, height = 640, colorScheme = 'light', now = null, ...seed } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e?.message ?? e)));
    page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
    if (now != null) await page.clock.setFixedTime(now);
    await page.addInitScript(fakeTauri, { info: appInfo(), ...seed });
    await page.goto(`${url}/index.html`);
    await page.waitForSelector('body[data-ready="1"]');
    return page;
  }

  return {
    url, browser, open,
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
}

// --- F27 checks -------------------------------------------------------------------------------------------------------

/** Runs axe-core on the page as it is now; fails with every violation, its nodes and why. */
export async function axe(page, what) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const text = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(' ')}: ${n.failureSummary?.replace(/\n/g, ' ')}`).join('\n')}`).join('\n');
  assert.equal(violations.length, 0, `${what}: axe found\n${text}`);
}

/** Proves axe really reads this page: an unlabelled field put in for a moment is found. */
export async function assertAxeSees(page) {
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'axe-probe'; document.querySelector('main').append(i); });
  const { violations } = await new AxeBuilder({ page }).include('#axe-probe').analyze();
  await page.evaluate(() => document.querySelector('#axe-probe').remove());
  assert.ok(violations.some((v) => v.id === 'label'), 'axe-core found the unlabelled probe');
}

/** Waits until no CSS transition or animation is running (colours change with a transition when the scheme does). */
export async function settled(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
}

/** axe in light and dark, and every control named. */
export async function axeBoth(page, what) {
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await settled(page);
    await axe(page, `${what} (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await settled(page);
  assert.deepEqual(await unnamed(page), [], `${what}: every control has a name`);
}

/**
 * The F27.4 check, in the page. Each text node's box (its nearest element that isn't inline) must hold its text:
 * scrollWidth <= clientWidth and scrollHeight <= clientHeight + 1. Hidden and screen-reader-only text is skipped, and
 * the page itself must not scroll sideways. only: a selector; when set, only boxes inside it are checked.
 * -> [] or the boxes that clip.
 */
export function clipped(page, { only = null } = {}) {
  return page.evaluate(({ only }) => {
    const bad = [];
    const seen = new Set();
    const name = (e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${[...e.classList].map((c) => `.${c}`).join('')}`;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      let e = n.parentElement;
      if (!e || e.closest('.sr-only, script, style, noscript, template')) continue;
      while (e && e !== document.body && ['inline', 'contents'].includes(getComputedStyle(e).display)) e = e.parentElement;
      if (!e || seen.has(e)) continue;
      seen.add(e);
      if (only && !e.closest(only)) continue;
      if (!e.checkVisibility({ visibilityProperty: true, opacityProperty: false })) continue;
      if (e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight + 1) {
        bad.push(`${name(e)} "${e.textContent.trim().slice(0, 50)}": scroll ${e.scrollWidth}x${e.scrollHeight}, client ${e.clientWidth}x${e.clientHeight}`);
      }
    }
    const d = document.documentElement;
    if (d.scrollWidth > d.clientWidth) {
      const out = [...document.body.querySelectorAll('*')].filter((e) => e.checkVisibility() && e.getBoundingClientRect().right > d.clientWidth + 0.5);
      bad.push(`the page scrolls sideways: ${d.scrollWidth} > ${d.clientWidth}, past the edge: ${out.slice(0, 5).map(name).join(', ')}`);
    }
    return bad;
  }, { only });
}

/** Fails when any text on the page is cut short or clipped (F27.4). */
export async function assertNotClipped(page, what, opts) {
  const bad = await clipped(page, opts);
  assert.deepEqual(bad, [], `${what}: text cut short or clipped:\n${bad.join('\n')}`);
}

/** The ARIA snapshot's controls with no accessible name ([] when every control has one). */
export async function unnamed(page) {
  const snap = await page.locator('body').ariaSnapshot();
  return snap.split('\n').filter((l) => /^\s*- (button|textbox|checkbox|switch|combobox|link|radio|slider|spinbutton)\s*(\[.*\])?\s*(:.*)?$/.test(l));
}

export async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** Turns the page's root text up to `scale` times its size (200% text: Windows' text size, or zoom). */
export async function scaleText(page, scale) {
  await page.evaluate((s) => {
    const html = document.documentElement;
    html.dataset.baseFont ??= getComputedStyle(html).fontSize;
    html.style.fontSize = `${parseFloat(html.dataset.baseFont) * s}px`;
  }, scale);
}

// --- fixtures ---------------------------------------------------------------------------------------------------------

const H = 3600000;
const BASE_ROW = { mime: '', size: 0, sent: '', errorCode: '', attempts: 1, slowFails: 0, attemptStarted: 0, attachment: false, error: '', delivered: 0, name: '', title: '', url: '' };
const LONG = 'The slow loris of e-paper: a very long article title about calm reading on the Daylight DC-1 that goes on and on';

/**
 * Outbox rows in each state of CHANGES-v1.1 2.5, with long titles and an unbroken URL, that stay put while a test
 * looks at them (nothing is due for a re-send for minutes).
 */
export function historyRows(now = Date.now()) {
  return [
    { ...BASE_ROW, id: 'a11y-sent', kind: 'url', title: LONG, url: 'https://example.com/long', status: 'sent', created: now - 60000, lastPublish: now },
    { ...BASE_ROW, id: 'a11y-failed', kind: 'file', title: 'Quarterly report with an unusually long file name for a narrow window', name: 'Quarterly report with an unusually long file name for a narrow window.pdf', mime: 'application/pdf', size: 420000, status: 'failed', errorCode: 'network', attempts: 4, created: now - 2 * H, lastPublish: now },
    { ...BASE_ROW, id: 'a11y-delivered', kind: 'file', title: 'Delivered notes', name: 'Delivered notes.txt', mime: 'text/plain', size: 2000, status: 'delivered', created: now - 5 * H, lastPublish: now - 5 * H, delivered: now - 4 * H },
    { ...BASE_ROW, id: 'a11y-expired', kind: 'url', url: 'https://www.example.org/a/very/long/path/without/any/spaces/that/would/overflow/a-narrow-window?with=query&and=more', status: 'expired', created: now - 8 * 24 * H, lastPublish: now - 24 * H },
    { ...BASE_ROW, id: 'a11y-too-large', kind: 'file', title: 'Big scan', name: 'Big scan.pdf', mime: 'application/pdf', size: 14200000, status: 'expired', errorCode: 'too-large', created: now - 30 * H },
    { ...BASE_ROW, id: 'a11y-full', kind: 'url', title: 'A link sent from a busy network', url: 'https://example.com/busy', status: 'failed', errorCode: 'full', slowFails: 1, created: now - 3 * H, lastPublish: now },
  ];
}

/** Outbox rows at fixed ages (newest first), one per state the history shows; times read "1 min ago" … "8 days ago". */
export function parityRows(now) {
  return [
    { ...BASE_ROW, id: 'p-sent', kind: 'url', title: 'A link on its way', url: 'https://example.com/on-its-way', status: 'sent', created: now - 60000, lastPublish: now },
    { ...BASE_ROW, id: 'p-failed', kind: 'url', title: 'A link that waits', url: 'https://example.com/waits', status: 'failed', errorCode: 'network', attempts: 4, created: now - 2 * H, lastPublish: now },
    { ...BASE_ROW, id: 'p-delivered', kind: 'file', title: 'Paper', name: 'Paper.pdf', mime: 'application/pdf', size: 200000, status: 'delivered', created: now - 5 * H, lastPublish: now - 5 * H, delivered: now - 4 * H },
    { ...BASE_ROW, id: 'p-expired', kind: 'url', url: 'https://example.org/never/picked/up', status: 'expired', created: now - 8 * 24 * H, lastPublish: now - 24 * H },
    { ...BASE_ROW, id: 'p-too-large', kind: 'file', title: 'Big scan', name: 'Big scan.pdf', mime: 'application/pdf', size: 14200000, status: 'expired', errorCode: 'too-large', created: now - 30 * H },
    { ...BASE_ROW, id: 'p-full', kind: 'url', title: 'A link from a busy network', url: 'https://example.com/busy', status: 'failed', errorCode: 'full', slowFails: 1, created: now - 3 * 24 * H, lastPublish: now },
  ];
}

// --- Lab-off parity (LAB-PLAN 1.7, F00.2) ---------------------------------------------------------------------------

const UPDATE = process.env.UPDATE_LAB_OFF_BASELINE === '1';

/** The snapshot with what varies by run replaced: the mock relay's port. */
export function normalise(yaml) {
  return yaml.replace(/127\.0\.0\.1(:|%3A)\d+/gi, '127.0.0.1$1<port>').trimEnd() + '\n';
}

export async function snapshot(page) {
  return normalise(await page.locator('body').ariaSnapshot());
}

/**
 * Compares the page's tree with lab-off-baseline/<name>.yml (or records it with UPDATE_LAB_OFF_BASELINE=1).
 * omit: lines (strings, whole and trimmed, or regexes) dropped from the page's tree first. Only for what LAB-PLAN 1.3
 * keeps with Lab off, which is the Lab switch row in Settings and its footer: WIN0 passes those lines, nothing else.
 */
export async function expectBaseline(page, name, { omit = [] } = {}) {
  const drop = (line) => omit.some((o) => (o instanceof RegExp ? o.test(line) : line.trim() === o));
  const got = (await snapshot(page)).split('\n').filter((l) => !drop(l)).join('\n');
  if (UPDATE && omit.length) throw new Error('record baselines without omit');
  const file = path.join(BASELINES, `${name}.yml`);
  if (UPDATE) {
    fs.mkdirSync(BASELINES, { recursive: true });
    fs.writeFileSync(file, got);
    return;
  }
  assert.equal(got, readBaseline(name), `${name}: with Lab off the window must equal the non-Lab baseline (LAB-PLAN 1.7)`);
}

/** lab-off-baseline/<name>.yml, with LF line ends (a Windows checkout has CRLF). */
export function readBaseline(name) {
  const file = path.join(BASELINES, `${name}.yml`);
  assert.ok(fs.existsSync(file), `no Lab-off baseline ${name}.yml (record it with UPDATE_LAB_OFF_BASELINE=1, only with a non-Lab change)`);
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}
