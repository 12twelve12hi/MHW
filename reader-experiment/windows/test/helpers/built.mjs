// Builds the frontend once per test process into a temporary folder (test files run in parallel) and imports from it,
// so the tests exercise the copied daylight-share.js exactly as the app ships it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildFrontend } from '../../build.mjs';

let out = null;

export function dist() {
  out ??= buildFrontend(fs.mkdtempSync(path.join(os.tmpdir(), 'dls-windows-')));
  return out;
}

export const load = (name) => import(pathToFileURL(path.join(dist(), name)).href);
