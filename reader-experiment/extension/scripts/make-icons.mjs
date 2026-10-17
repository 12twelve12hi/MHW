// Renders the extension and web app icons from the SVGs below into PNGs with the Playwright Chromium, so the committed
// PNGs always match the SVG sources. Run after changing a design:  node scripts/make-icons.mjs
//   (needs PLAYWRIGHT_BROWSERS_PATH pointing at an installed Chromium, e.g. /opt/pw-browsers)

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extIcons = path.join(here, '..', 'src', 'icons');
const webIcons = path.join(here, '..', '..', 'web', 'icons');

const INK = '#141414';
const PAPER = '#f7f5f0';

// The mark: a sun rising over the horizon ("into the Daylight"). Bold enough to read at 16 px, where it keeps only
// three rays.
function glyph({ color, small = false, stroke = 9 }) {
  const cx = 64, cy = small ? 77 : 75, r = small ? 22 : 19;
  const inner = r + (small ? 10 : 9), outer = r + (small ? 24 : 21);
  const angles = small ? [-140, -90, -40] : [-165, -127.5, -90, -52.5, -15];
  let rays = '';
  for (const deg of angles) {
    const a = (deg * Math.PI) / 180;
    rays += `M${(cx + Math.cos(a) * inner).toFixed(2)} ${(cy + Math.sin(a) * inner).toFixed(2)}`
      + `L${(cx + Math.cos(a) * outer).toFixed(2)} ${(cy + Math.sin(a) * outer).toFixed(2)}`;
  }
  const sw = small ? 12 : stroke;
  return `<g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="${sw}">
    <path d="M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}Z" fill="${color}" stroke="none"/>
    <path d="${rays}"/>
    <path d="M${small ? 24 : 26} ${cy + 10}H${small ? 104 : 102}"/>
  </g>`;
}

export const tileSvg = ({ size = 128, small = false } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect x="4" y="4" width="120" height="120" rx="28" fill="${INK}"/>
  <rect x="4" y="4" width="120" height="120" rx="28" fill="none" stroke="${PAPER}" stroke-opacity=".22" stroke-width="3"/>
  ${glyph({ color: PAPER, small })}
</svg>`;

// Safari draws toolbar icons as monochrome templates, so its toolbar icon is the bare glyph in black.
export const toolbarSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  ${glyph({ color: '#000000', stroke: 11 })}
</svg>`;

// Maskable app icons need the mark inside the central 80 % circle, on a full-bleed background.
export const maskableSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="${INK}"/>
  <g transform="translate(64 64) scale(.72) translate(-64 -64)">${glyph({ color: PAPER })}</g>
</svg>`;

export const appleTouchSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="${INK}"/>
  <g transform="translate(64 64) scale(.86) translate(-64 -64)">${glyph({ color: PAPER })}</g>
</svg>`;

async function render(page, svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: file, omitBackground: true });
  console.log('wrote', path.relative(process.cwd(), file));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(extIcons, { recursive: true });
  fs.mkdirSync(webIcons, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const s of [16, 32, 48, 128]) await render(page, tileSvg({ size: s, small: s <= 32 }), s, path.join(extIcons, `icon-${s}.png`));
  fs.writeFileSync(path.join(extIcons, 'icon.svg'), tileSvg({ size: 128 }) + '\n');
  fs.writeFileSync(path.join(extIcons, 'toolbar.svg'), toolbarSvg() + '\n');
  for (const s of [16, 32]) await render(page, toolbarSvg().replace('width="128" height="128"', `width="${s}" height="${s}"`), s, path.join(extIcons, `toolbar-${s}.png`));
  await render(page, tileSvg({ size: 192 }), 192, path.join(webIcons, 'icon-192.png'));
  await render(page, tileSvg({ size: 512 }), 512, path.join(webIcons, 'icon-512.png'));
  await render(page, maskableSvg(512), 512, path.join(webIcons, 'maskable-512.png'));
  await render(page, appleTouchSvg(180), 180, path.join(webIcons, 'apple-touch-icon.png'));
  await render(page, tileSvg({ size: 32, small: true }), 32, path.join(webIcons, 'favicon-32.png'));
  fs.writeFileSync(path.join(webIcons, 'icon.svg'), tileSvg({ size: 128 }) + '\n');
  await browser.close();
}
