// Assembles the app's frontend (plain HTML, CSS and ES modules; no bundler) into dist/, which Tauri embeds:
//
//   node build.mjs [--out <dir>]
//
// The protocol library is copied from ../share/js/daylight-share.js, the one source of truth, exactly as the browser
// extension's build does, so protocol fixes reach this app with the next build.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.join(here, 'src');
export const DIST = path.join(here, 'dist');
export const SHARE_LIB = path.join(here, '..', 'share', 'js', 'daylight-share.js');

export function buildFrontend(out = DIST) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    fs.cpSync(path.join(SRC, e.name), path.join(out, e.name), { recursive: true });
  }
  fs.copyFileSync(SHARE_LIB, path.join(out, 'daylight-share.js'));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const out = buildFrontend(i > 0 ? path.resolve(process.argv[i + 1]) : DIST);
  console.log(`built ${path.relative(process.cwd(), out) || '.'}`);
}
