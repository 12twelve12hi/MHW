// Accessibility checks shared by the popup's and the web sender's tests (LAB-PLAN F27):
//
//   axe(page, what)          axe-core (@axe-core/playwright, pinned) must report no violations (F27.1);
//   clipped(page, opts)      every element with text: scrollWidth <= clientWidth and scrollHeight <= clientHeight + 1,
//                            and no horizontal page scroll (F27.4);
//   unnamed(page)            controls without an accessible name, from the ARIA snapshot (every control labelled);
//   shot(page, name)         a screenshot in test-results/a11y/, uploaded by CI for review (not compared);
//   historyRows(now)         outbox rows in every state of CHANGES-v1.1 2.5, with long titles, that stay put while a
//                            test looks at them (nothing is due for a re-send for minutes).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';

export const SHOTS = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'test-results', 'a11y');

/** Runs axe-core on the page as it is now; fails with every violation, its nodes and why. */
export async function axe(page, what) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const text = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(' ')}: ${n.failureSummary?.replace(/\n/g, ' ')}`).join('\n')}`).join('\n');
  assert.equal(violations.length, 0, `${what}: axe found\n${text}`);
}

/**
 * The F27.4 check, in the page. Each text node's box (its nearest element that isn't inline) must hold its text:
 * scrollWidth <= clientWidth and scrollHeight <= clientHeight + 1. Hidden text and screen-reader-only text are skipped.
 * only: a selector; when set, only boxes inside it are checked (the status text at 200%). -> [] or the boxes that clip.
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
    if (d.scrollWidth > d.clientWidth) bad.push(`the page scrolls sideways: ${d.scrollWidth} > ${d.clientWidth}`);
    return bad;
  }, { only });
}

/** Proves axe really reads this page (an extension page, say): an unlabelled field put in for a moment is found. */
export async function assertAxeSees(page) {
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'axe-probe'; document.querySelector('main').append(i); });
  const { violations } = await new AxeBuilder({ page }).include('#axe-probe').analyze();
  await page.evaluate(() => document.querySelector('#axe-probe').remove());
  assert.ok(violations.some((v) => v.id === 'label'), 'axe-core found the unlabelled probe');
}

/** Fails when any text on the page is cut short (F27.4). */
export async function assertNotClipped(page, what, opts) {
  const bad = await clipped(page, opts);
  assert.deepEqual(bad, [], `${what}: text cut short or clipped:\n${bad.join('\n')}`);
}

/** The roles of the ARIA snapshot's controls with no accessible name ([] when every control has one). */
export async function unnamed(page) {
  const snap = await page.locator('body').ariaSnapshot();
  return snap.split('\n').filter((l) => /^\s*- (button|textbox|checkbox|switch|combobox|link|radio|slider|spinbutton)\s*(\[.*\])?\s*(:.*)?$/.test(l));
}

export async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** Turns the page's root text up to `scale` times its size (200% text, as with browser zoom or a larger text size). */
export async function scaleText(page, scale) {
  await page.evaluate((s) => {
    const html = document.documentElement;
    html.dataset.baseFont ??= getComputedStyle(html).fontSize;
    html.style.fontSize = `${parseFloat(html.dataset.baseFont) * s}px`;
  }, scale);
}

const LONG = 'The slow loris of e-paper: a very long article title about calm reading on the Daylight DC-1 that goes on and on';

/**
 * Outbox rows in each state of CHANGES-v1.1 2.5, with long titles and an unbroken URL. The popup shows the first five
 * (all but the full relay's), the web sender all six.
 */
export function historyRows(now = Date.now()) {
  const h = 3600000;
  const base = { mime: '', size: 0, sent: '', errorCode: '', attempts: 1, slowFails: 0, attemptStarted: 0, attachment: false, error: '', delivered: 0 };
  return [
    { ...base, id: 'a11y-sent', kind: 'page', title: LONG, url: 'https://example.com/long', name: '', status: 'sent', created: now - 60000, lastPublish: now },
    { ...base, id: 'a11y-failed', kind: 'file', title: 'Quarterly report with an unusually long file name for a narrow screen', url: '', name: 'Quarterly report with an unusually long file name for a narrow screen.pdf', mime: 'application/pdf', size: 420000, status: 'failed', errorCode: 'network', attempts: 4, created: now - 2 * h, lastPublish: now },
    { ...base, id: 'a11y-delivered', kind: 'page', title: 'Delivered page', url: 'https://example.com/delivered', name: '', status: 'delivered', created: now - 5 * h, lastPublish: now - 5 * h, delivered: now - 4 * h },
    { ...base, id: 'a11y-expired', kind: 'url', title: '', url: 'https://www.example.org/a/very/long/path/without/any/spaces/that/would/overflow/a-narrow-popup?with=query&and=more', name: '', status: 'expired', errorCode: '', created: now - 8 * 24 * h, lastPublish: now - 24 * h },
    { ...base, id: 'a11y-too-large', kind: 'file', title: 'Big scan', url: '', name: 'Big scan.pdf', mime: 'application/pdf', size: 14200000, status: 'expired', errorCode: 'too-large', created: now - 30 * h, lastPublish: 0 },
    { ...base, id: 'a11y-full', kind: 'url', title: 'A link sent from a busy network', url: 'https://example.com/busy', name: '', status: 'failed', errorCode: 'full', slowFails: 1, created: now - 3 * h, lastPublish: now },
  ];
}
