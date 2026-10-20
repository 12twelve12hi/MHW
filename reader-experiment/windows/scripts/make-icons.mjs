// Renders the app icons from the extension's icon design (one source: ../../extension/scripts/make-icons.mjs), so the
// Windows app, the browser extension and the web sender share one mark. Run after changing the design, then commit:
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/make-icons.mjs
//
// Needs the extension's dev dependencies (cd ../extension && npm ci) for Playwright's Chromium. Writes:
//   src/icon.svg                     the mark in the window's header
//   src-tauri/icons/tray.png         the notification-area icon (32 px, the simpler 16-px drawing)
//   src-tauri/icons/*.png, icon.ico  app and installer icons, made by `tauri icon` from a 1024-px rendering

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const extension = path.join(root, '..', 'extension');
const { tileSvg } = await import(path.join(extension, 'scripts', 'make-icons.mjs'));
const { chromium } = createRequire(path.join(extension, 'package.json'))('playwright');

const icons = path.join(root, 'src-tauri', 'icons');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-icons-'));

async function render(page, svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: file, omitBackground: true });
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await render(page, tileSvg({ size: 1024 }), 1024, path.join(tmp, 'icon-1024.png'));
fs.mkdirSync(icons, { recursive: true });
await render(page, tileSvg({ size: 32, small: true }), 32, path.join(icons, 'tray.png'));
await browser.close();

execFileSync(path.join(root, 'node_modules', '.bin', 'tauri'), ['icon', path.join(tmp, 'icon-1024.png'), '-o', path.join(tmp, 'out')], { stdio: 'inherit' });
for (const f of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.ico']) {
  fs.copyFileSync(path.join(tmp, 'out', f), path.join(icons, f));
}
fs.writeFileSync(path.join(root, 'src', 'icon.svg'), tileSvg({ size: 128 }) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('wrote src/icon.svg and src-tauri/icons/{tray.png,32x32.png,128x128.png,128x128@2x.png,icon.png,icon.ico}');
