// Assembles the app's frontend (plain HTML, CSS and ES modules; no bundler) into dist/, which Tauri embeds:
//
//   node build.mjs [--out <dir>]
//
// The protocol library is copied from ../share/js/daylight-share.js, the one source of truth, exactly as the browser
// extension's build does, so protocol fixes reach this app with the next build. So is Lab's (LAB-PLAN 2.7.2):
// ../share/js/daylight-lab.js, unchanged, and the Daylight server's client module ../server/client/daylight-server.js,
// whose one import of the protocol module is pointed at the copy next to it (serverModule).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.join(here, 'src');
export const DIST = path.join(here, 'dist');
export const SHARE_LIB = path.join(here, '..', 'share', 'js', 'daylight-share.js');
export const LAB_LIB = path.join(here, '..', 'share', 'js', 'daylight-lab.js');
export const SERVER_LIB = path.join(here, '..', 'server', 'client', 'daylight-server.js');
const SERVER_IMPORT = "from '../../share/js/daylight-share.js';";

/**
 * The server client module as the window loads it: next to its copy of daylight-share.js. Only the one import line
 * changes; anything else in the module that would need rewriting is an error here, not at run time.
 */
export function serverModule(text = fs.readFileSync(SERVER_LIB, 'utf8')) {
  const n = text.split(SERVER_IMPORT).length - 1;
  if (n !== 1) throw new Error(`daylight-server.js: expected one import of ../../share/js/daylight-share.js, found ${n}`);
  const out = text.replace(SERVER_IMPORT, "from './daylight-share.js';");
  if (/from\s+'\.\.\//.test(out)) throw new Error('daylight-server.js: an import outside the module folder');
  return out;
}

export function buildFrontend(out = DIST) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    fs.cpSync(path.join(SRC, e.name), path.join(out, e.name), { recursive: true });
  }
  fs.copyFileSync(SHARE_LIB, path.join(out, 'daylight-share.js'));
  fs.copyFileSync(LAB_LIB, path.join(out, 'daylight-lab.js'));
  fs.writeFileSync(path.join(out, 'daylight-server.js'), serverModule());
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const out = buildFrontend(i > 0 ? path.resolve(process.argv[i + 1]) : DIST);
  console.log(`built ${path.relative(process.cwd(), out) || '.'}`);
}
