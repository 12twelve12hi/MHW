// Lab-off parity (LAB-PLAN 1.7, F00.2): with Lab off, each main screen's accessibility tree must equal the baseline
// recorded from the last non-Lab build, the P0 close-out (v1.1 plus the F27 baseline with Comfort). The tree is
// Playwright's locator('body').ariaSnapshot() (YAML: roles, names and values, in order), which is stable across
// Playwright releases, unlike page.accessibility.snapshot().
//
// Baselines live in test/e2e/lab-off-baseline/<name>.yml. They are re-recorded only together with a matching non-Lab
// change:  UPDATE_LAB_OFF_BASELINE=1 node --test test/e2e/lab-off-parity.e2e.mjs test/e2e/web-lab-off-parity.e2e.mjs
//
// What changes from run to run is replaced before comparing: the mock relay's port, the build's version (CI numbers
// it by run), and the keyboard shortcut and default device name (they differ by platform). Everything else, times
// included, is made the same by the tests: a fixed pairing, fixed names and rows at fixed ages.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const BASELINES = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'e2e', 'lab-off-baseline');
const UPDATE = process.env.UPDATE_LAB_OFF_BASELINE === '1';

/**
 * What LAB-PLAN 1.3 keeps with Lab off, in a settings screen's tree: the Lab switch row and its footer (LAB_TEXT's
 * words). The only lines expectBaseline may omit.
 */
export function labSwitchLines(LAB_TEXT) {
  return [`- text: ${LAB_TEXT.lab}`, `- switch "${LAB_TEXT.lab}"`, `- paragraph: ${LAB_TEXT.switchFooter}`];
}

/**
 * Waits until the extension's first start wrote its Lab default (settings.lab, LAB-PLAN 1.2), so a test that seeds
 * settings afterwards is never overwritten by it. sw: the service worker.
 */
export async function labDefaultWritten(sw) {
  for (let i = 0; i < 100; i++) {
    const s = await sw.evaluate(() => chrome.storage.local.get('settings')).catch(() => ({}));
    if (s?.settings?.lab !== undefined) return s.settings;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the extension never wrote settings.lab');
}

/** A fixed pairing secret, so codes and links in the tree are the same every run. */
export const FIXED_SECRET = Uint8Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 0xff);

/** The snapshot with what varies by run or platform replaced by <port>, <version>, <shortcut> and <default name>. */
export function normalise(yaml) {
  return yaml
    .replace(/127\.0\.0\.1(:|%3A|%253A)\d+/gi, '127.0.0.1$1<port>')
    .replace(/Send to Daylight \d+\.\d+\.\d+ \((chrome|safari)\)/g, 'Send to Daylight <version> ($1)')
    .replace(/(definition: )(?:.+ sends the current page|None\. Set one at chrome:\/\/extensions\/shortcuts|None)$/gm, '$1<shortcut>')
    // The default name for this browser or device ("Chrome on Linux", "Mac (web)") follows the platform.
    .replace(/(\/placeholder: )(?:(?:Chrome|Safari) on \S+|(?:Chrome|Safari)|[^\n]+ \(web\))$/gm, '$1<default name>')
    .trimEnd() + '\n';
}

export async function snapshot(page) {
  return normalise(await page.locator('body').ariaSnapshot());
}

/**
 * Compares the page's tree with lab-off-baseline/<name>.yml (or records it with UPDATE_LAB_OFF_BASELINE=1).
 * omit: lines (strings, whole and trimmed, or regexes) dropped from the page's tree first. Only for what LAB-PLAN 1.3
 * keeps with Lab off, which is the Lab switch row in Settings and its footer: X0 passes those lines, nothing else.
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
  assert.ok(fs.existsSync(file), `no Lab-off baseline ${name}.yml (record it with UPDATE_LAB_OFF_BASELINE=1, only with a non-Lab change)`);
  assert.equal(got, fs.readFileSync(file, 'utf8'), `${name}: with Lab off the screen must equal the non-Lab baseline (LAB-PLAN 1.7)`);
}

/** Outbox rows at fixed ages (newest first), one per state the history shows; times read "1 min ago" … "8 days ago". */
export function parityRows(now = Date.now()) {
  const h = 3600000;
  const base = { mime: '', size: 0, sent: '', errorCode: '', attempts: 1, slowFails: 0, attemptStarted: 0, attachment: false, error: '', delivered: 0, name: '', title: '', url: '' };
  return [
    { ...base, id: 'p-sent', kind: 'page', title: 'A page on its way', url: 'https://example.com/on-its-way', status: 'sent', created: now - 60000, lastPublish: now },
    { ...base, id: 'p-failed', kind: 'url', title: 'A link that waits', url: 'https://example.com/waits', status: 'failed', errorCode: 'network', attempts: 4, created: now - 2 * h, lastPublish: now },
    { ...base, id: 'p-delivered', kind: 'file', title: 'Paper', name: 'Paper.pdf', mime: 'application/pdf', size: 200000, status: 'delivered', created: now - 5 * h, lastPublish: now - 5 * h, delivered: now - 4 * h },
    { ...base, id: 'p-expired', kind: 'url', url: 'https://example.org/never/picked/up', status: 'expired', created: now - 8 * 24 * h, lastPublish: now - 24 * h },
    { ...base, id: 'p-too-large', kind: 'file', title: 'Big scan', name: 'Big scan.pdf', mime: 'application/pdf', size: 14200000, status: 'expired', errorCode: 'too-large', created: now - 30 * h },
    { ...base, id: 'p-full', kind: 'url', title: 'A link from a busy network', url: 'https://example.com/busy', status: 'failed', errorCode: 'full', slowFails: 1, created: now - 3 * 24 * h, lastPublish: now },
  ];
}
