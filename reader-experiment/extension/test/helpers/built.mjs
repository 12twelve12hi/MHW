// Builds a target into a fresh temporary folder, so every test file tests the current sources.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildTarget } from '../../build.mjs';

/** opts: buildTarget's ({lab: true | false}; a Safari build without it follows the Lab release gate, LAB-PLAN 6.2). */
export function built(target = 'chrome', opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dls-${target}-`));
  const dir = buildTarget(target, root, opts);
  return { dir, root, load: (file) => import(pathToFileURL(path.join(dir, file)).href) };
}
