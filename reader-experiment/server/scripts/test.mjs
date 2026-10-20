// npm test: builds the test bundle (wrangler, with __TESTING__ defined) once, then runs every test file with node:test.
// The unit tests run in Node; the worker and end-to-end tests run the bundle in workerd through Miniflare.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', '.build-test', '--define', '__TESTING__:true', '--no-minify'], {
  cwd: root, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
const only = process.argv.slice(2);
const files = (only.length ? only : fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join('test', f)));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=3', '--test-timeout=600000', ...files], {
  cwd: root, stdio: 'inherit', env: { ...process.env, DLS_SKIP_BUILD: '1' },
});
process.exit(r.status ?? 1);
