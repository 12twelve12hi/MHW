// The Lab wave of the code in this folder, read from the code itself (LAB-PLAN 6.2), so that a lab-wave.json left at
// null (or at "w0" once W1 code lands) can't open the release gate for a Lab build:
//
//   node scripts/lab-wave.mjs            prints the wave the release gate must hold this build for: the later of
//                                        lab-wave.json's and the code's, or nothing when neither has Lab code. Says why
//                                        on stderr. Exits 2 when it can't tell (daylight-lab.js missing or changed).
//   node scripts/lab-wave.mjs --check    the same, but exits 1 when lab-wave.json is behind the code.
//
// What counts:
//   W0 (any Lab code): src/lab.js or a daylight-lab.js in src/; anything in src/ or build.mjs that names daylight-lab
//       (the module WIN0 copies in).
//   W1: src/ naming a W1 export of ../share/js/daylight-lab.js (the exports after its "W1 (L1)" heading: smart intake,
//       excerpts, the test article, diagnostics…), describeLabRow (F01's rows), or the Sender's F07 calls
//       (flushNetwork, send(…, {defer})).
// rx-windows.yml's publish job runs it before it uploads; test/unit/build.test.mjs checks lab-wave.json against it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, '..');
export const LAB_LIB = path.join(ROOT, '..', 'share', 'js', 'daylight-lab.js');
const TEXT = /\.(m?js|html|css|json)$/;

/** Waves in order: null (no Lab code) < "w0" < "w1" < … */
export function waveRank(wave) {
  if (wave == null || wave === '') return -1;
  const m = /^w(\d+)$/.exec(wave);
  if (!m) throw new Error(`not a Lab wave: ${wave}`);
  return Number(m[1]);
}

export const laterWave = (a, b) => (waveRank(a) >= waveRank(b) ? (a || null) : (b || null));

/** The names daylight-lab.js exports under its W1 heading (L1). Throws when the heading is gone: then nobody can tell. */
export function w1Names(labSource) {
  const at = labSource.search(/^\/\/ W1 \(L1\)/m);
  if (at < 0) throw new Error('daylight-lab.js has no "// W1 (L1)" heading: update scripts/lab-wave.mjs');
  const names = [...labSource.slice(at).matchAll(/^export (?:async )?(?:function\*? ?|const |let |class )([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  if (!names.length) throw new Error('daylight-lab.js exports nothing under its W1 heading: update scripts/lab-wave.mjs');
  return [...new Set(names)];
}

/** F01's rows and F07's sending: W1 for Windows (LAB-PLAN 3.1), though their code is in W0's modules. */
export const W1_CALLS = ['describeLabRow', 'flushNetwork'];
const DEFER = /\bdefer\s*:/;

/**
 * files: [{name, text}] with names relative to this folder (src/…, build.mjs). -> {wave: null | 'w0' | 'w1', why: []}
 */
export function codeWave(files, { w1 }) {
  const why = [];
  let wave = null;
  const src = files.filter((f) => f.name.startsWith('src/') && !/(^|\/)daylight-[\w-]+\.js$/.test(f.name));
  for (const f of files) if (f.name === 'src/lab.js' || /^src\/(.*\/)?daylight-lab\.js$/.test(f.name)) why.push(f.name);
  for (const f of files) {
    if ((f.name === 'build.mjs' || f.name.startsWith('src/')) && /daylight-lab/.test(f.text)) why.push(`${f.name} names daylight-lab`);
  }
  if (why.length) wave = 'w0';
  const w1why = [];
  const names = [...w1, ...W1_CALLS];
  for (const f of src.filter((x) => /\.m?js$/.test(x.name))) {
    for (const n of names) if (new RegExp(`(?<![\\w$])${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(f.text)) w1why.push(`${f.name} uses ${n}`);
    if (DEFER.test(f.text)) w1why.push(`${f.name} sends with defer (F07)`);
  }
  if (w1why.length) { wave = 'w1'; why.push(...w1why); }
  return { wave, why };
}

/** This folder's src/ (every text file) and build.mjs, as codeWave reads them. */
export function readTree(root = ROOT) {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (TEXT.test(e.name)) files.push({ name: rel, text: fs.readFileSync(path.join(root, rel), 'utf8') });
    }
  };
  walk('src');
  const build = path.join(root, 'build.mjs');
  if (fs.existsSync(build)) files.push({ name: 'build.mjs', text: fs.readFileSync(build, 'utf8') });
  return files;
}

/** -> {declared, code, why, hold}: hold is the wave to hold the build for (null: no Lab code anywhere). */
export function holdFor(root = ROOT, labLib = LAB_LIB) {
  const declared = JSON.parse(fs.readFileSync(path.join(root, 'lab-wave.json'), 'utf8')).wave ?? null;
  waveRank(declared);
  const { wave: code, why } = codeWave(readTree(root), { w1: w1Names(fs.readFileSync(labLib, 'utf8')) });
  return { declared, code, why, hold: laterWave(declared, code) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { declared, code, why, hold } = holdFor();
    console.error(`lab-wave.json: ${declared ?? 'none'}; the code: ${code ?? 'no Lab code'}${why.length ? ` (${why.slice(0, 6).join('; ')})` : ''}`);
    if (waveRank(code) > waveRank(declared)) {
      console.error(`lab-wave.json is behind the code: it must say "${code}". Holding the build for ${code}.`);
      if (process.argv.includes('--check')) process.exit(1);
    }
    console.log(hold ?? '');
  } catch (e) {
    console.error(`can't tell the Lab wave of this code: ${e.message}`);
    process.exit(2);
  }
}
