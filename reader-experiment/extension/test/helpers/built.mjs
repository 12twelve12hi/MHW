// Builds a target into a fresh temporary folder, so every test file tests the current sources.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildTarget } from '../../build.mjs';

export function built(target = 'chrome') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dls-${target}-`));
  const dir = buildTarget(target, root);
  return { dir, root, load: (file) => import(pathToFileURL(path.join(dir, file)).href) };
}
