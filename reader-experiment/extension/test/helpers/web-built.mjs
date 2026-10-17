// Builds the web sender into a fresh temporary folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSite, serve } from '../../../web/build.mjs';

export function webBuilt() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-web-'));
  const { out, build } = buildSite(path.join(dir, 'site'));
  return { dir: out, build, load: (f) => import(pathToFileURL(path.join(out, f)).href), serve: () => serve(out) };
}
