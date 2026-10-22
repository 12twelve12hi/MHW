// The web sender's accessibility with Lab on and off (LAB-PLAN F27.1 and F27.4 for the Lab screens; card B0), in a real
// Chromium: axe-core finds no violations, light and dark, Comfort off and on; every control has a name; with Comfort
// on at 360 px nothing is clipped; at 200% text the notes wrap. Screens: pairing, sending and Settings with Lab off and
// on, What's in Lab with a note open, the Daylight server section (not set up, and ready), and the send view's
// re-pairing follow-up. Screenshots go to test-results/web-lab (uploaded by CI for review, not compared).
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/e2e/web-lab-a11y.e2e.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { webBuilt } from '../helpers/web-built.mjs';
import { axe, assertAxeSees, assertNotClipped, unnamed, scaleText, historyRows } from '../helpers/a11y.mjs';
import { startFakeWorker, statusJson } from '../helpers/fake-worker.mjs';
import { startMockRelay } from '../../../share/js/mock-relay.mjs';

const w = webBuilt();
const ds = await w.load('daylight-share.js');
const S = await w.load('daylight-server.js');
const { LAB_TEXT } = await w.load('daylight-lab.js');
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'test-results', 'web-lab');

let relay, site, worker, front, browser;

/** The stand-in server on another origin, with the server's CORS answer (DESIGN 10.2). */
async function corsFront(target) {
  const CORS = {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-DLS-Source-Name', 'Access-Control-Max-Age': '86400',
  };
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = {};
    for (const h of ['authorization', 'content-type']) if (req.headers[h]) headers[h] = req.headers[h];
    const r = await fetch(target + req.url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    res.writeHead(r.status, { ...CORS, 'Content-Type': 'application/json' });
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://localhost:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}

before(async () => {
  relay = await startMockRelay();
  site = await w.serve();
  worker = await startFakeWorker();
  front = await corsFront(worker.url);
  browser = await chromium.launch({ channel: 'chromium', headless: !process.env.HEADED });
});

after(async () => {
  await browser?.close();
  await front?.close();
  await worker?.close();
  await relay?.close();
  await site?.close();
});

const ready = (page) => page.waitForSelector('body[data-ready="1"]');

async function store(page, items) {
  await page.evaluate(async (i) => {
    const { openStorage } = await import('./web-storage.js');
    const { storage } = await openStorage();
    for (const [k, v] of Object.entries(i)) await storage.set(k, v);
  }, items);
  await page.reload();
  await ready(page);
}

async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

/** axe in light and dark, and no unnamed control. */
async function axeBoth(page, what) {
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await axe(page, `${what} (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  assert.deepEqual(await unnamed(page), [], `${what}: every control has a name`);
}

/** axe both ways, and with Comfort nothing clipped at this width; then a screenshot. */
async function check(page, what, name, comfort) {
  await axeBoth(page, `${what}${comfort ? ', Comfort' : ''}`);
  if (comfort) await assertNotClipped(page, `${what}, Comfort`);
  await shot(page, `${name}${comfort ? '-comfort' : ''}`);
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('#view-settings:not([hidden])');
}

test('Lab off and on: pairing, sending and Settings have no axe violations, light and dark, Comfort off and on; nothing clipped at 360 px', { timeout: 240000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 } });
  const page = await ctx.newPage();
  await page.goto(`${site.url}/`);
  await ready(page);
  await assertAxeSees(page);
  const code = await ds.formatCode(ds.generateSecret());
  try {
    for (const lab of [false, true]) {
      for (const comfort of [false, true]) {
        const tag = `Lab ${lab ? 'on' : 'off'}`;
        const sfx = `lab-${lab ? 'on' : 'off'}`;
        await page.evaluate(async () => {
          const { openStorage } = await import('./web-storage.js');
          await (await openStorage()).storage.remove('pairing');
        });
        await store(page, { settings: { from: 'A11y web', lab, comfort } });
        assert.equal(await page.evaluate(() => document.body.classList.contains('comfort')), comfort);
        await check(page, `web: pairing, ${tag}`, `a11y-pair-${sfx}`, comfort);
        await openSettings(page);
        if (lab) await page.waitForFunction(() => document.querySelector('#server-sub').textContent !== '');
        assert.equal(await page.isVisible('#lab-rows'), lab);
        await check(page, `web: settings before pairing, ${tag}`, `a11y-settings-unpaired-${sfx}`, comfort);

        await store(page, { pairing: { code, relay: relay.url, name: 'A11y Daylight' }, outbox: historyRows() });
        await check(page, `web: sending, ${tag}`, `a11y-send-${sfx}`, comfort);
        await openSettings(page);
        await page.waitForFunction(() => document.querySelector('#shortcut-link').textContent !== '');
        if (lab) await page.waitForFunction(() => document.querySelector('#server-sub').textContent !== '');
        await check(page, `web: settings, ${tag}`, `a11y-settings-${sfx}`, comfort);
      }
    }
  } finally { await ctx.close(); }
});

test('Lab’s screens: What’s in Lab with a note open, the Daylight server (not set up, ready) and the re-pairing follow-up; notes wrap at 200%', { timeout: 300000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.url });
  const page = await ctx.newPage();
  await page.goto(`${site.url}/`);
  await ready(page);
  try {
    for (const comfort of [false, true]) {
      const tag = comfort ? ', Comfort' : '';
      const secret = ds.generateSecret();
      await page.evaluate(async () => {
        const { openStorage } = await import('./web-storage.js');
        const { storage } = await openStorage();
        for (const k of await storage.keys()) if (k.startsWith('server/') || k.startsWith('lab/')) await storage.remove(k);
      });
      await store(page, { settings: { from: 'A11y web', lab: true, comfort }, pairing: { code: await ds.formatCode(secret), relay: relay.url, name: 'A11y Daylight' } });

      await openSettings(page);
      await page.click('#open-whats-in-lab');
      await page.waitForSelector('body[data-fresh="1"]', { timeout: 20000 });
      await axeBoth(page, `web: What’s in Lab${tag}`);
      await page.getByRole('button', { name: LAB_TEXT.features.F37.name, exact: true }).click();
      await page.locator('li[data-feature="F37"] .lab-note-body[data-state="needs-server"]').waitFor();
      await check(page, 'web: What’s in Lab, a note open', 'a11y-whats-note', comfort);
      await scaleText(page, 2);
      await assertNotClipped(page, `web: What’s in Lab at 200%${tag}`);
      await shot(page, `a11y-whats-note-200${comfort ? '-comfort' : ''}`);
      await scaleText(page, 1);
      await page.getByRole('button', { name: '‹ Back' }).click();

      await page.click('#open-server');
      await page.waitForSelector('body[data-fresh="1"]', { timeout: 20000 });
      await check(page, 'web: Daylight server, not set up', 'a11y-server', comfort);
      // A bad setup link says why, and a good one asks first: both on screen for axe.
      await page.getByLabel(LAB_TEXT.serverSection.setupRow, { exact: true }).fill('https://daylight-0123456789ab.example.workers.dev/setup#SETUP-AAAA');
      await page.getByRole('button', { name: LAB_TEXT.serverSection.setupButton, exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.lab-server-setup-said')?.textContent !== '');
      await axeBoth(page, `web: Daylight server, a refused setup link${tag}`);
      await page.getByLabel(LAB_TEXT.serverSection.setupRow, { exact: true }).fill(await S.formatSetupLink('https://daylight-0123456789ab.example.workers.dev', new Uint8Array(16).fill(7)));
      await page.getByRole('button', { name: LAB_TEXT.serverSection.setupButton, exact: true }).click();
      await page.waitForSelector('.lab-server-setup-confirm:not([hidden])');
      await check(page, 'web: Daylight server, the setup link’s question', 'a11y-server-setup-confirm', comfort);
      await page.getByRole('button', { name: LAB_TEXT.serverSection.setupCancel, exact: true }).click();

      worker.state.token = (await S.deriveServerValues(await S.deriveServerSeed(secret))).authToken;
      worker.state.status = statusJson({ features: { ai: 'needs-key' }, lastSeen: new Date(Date.now() - 300000).toISOString(), usd: 0.5, limitUsd: 3 });
      await page.getByLabel(LAB_TEXT.serverSection.serverAddress).fill(front.url);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.lab-server-ready')?.textContent === 'Ready', null, { timeout: 15000 });
      await check(page, 'web: Daylight server, ready', 'a11y-server-ready', comfort);
      await scaleText(page, 2);
      await assertNotClipped(page, `web: Daylight server at 200%${tag}`);
      await scaleText(page, 1);
      await page.getByRole('button', { name: '‹ Back' }).click();

      // Another Daylight while this server is known: the follow-up in the send view.
      await page.click('#repair');
      await page.fill('#code', await ds.formatCode(ds.generateSecret()));
      await page.click('#pair-btn');
      await page.waitForSelector('#view-confirm:not([hidden])');
      await page.click('#confirm-yes');
      await page.waitForSelector('#repaired:not([hidden])');
      await check(page, 'web: the re-pairing follow-up', 'a11y-repaired', comfort);
      await page.getByRole('region', { name: LAB_TEXT.serverRow }).getByRole('button', { name: LAB_TEXT.noteButton, exact: true }).click();
    }
  } finally { await ctx.close(); }
});
