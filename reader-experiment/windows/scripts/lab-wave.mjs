// The Lab wave of the code in this folder, read from the code itself (LAB-PLAN 6.2), so that a lab-wave.json left at
// null (or at "w0" once W1 code lands) can't open the release gate for a Lab build:
//
//   node scripts/lab-wave.mjs            prints the wave the release gate must hold this build for: the later of
//                                        lab-wave.json's and the code's, or nothing when neither has Lab code. Says why
//                                        on stderr. Exits 2 when it can't tell (daylight-lab.js missing or changed, or
//                                        the code names a Lab feature of a wave this script doesn't know yet).
//   node scripts/lab-wave.mjs --check    the same, but exits 1 when lab-wave.json is behind the code.
//
// What counts, in src/ (the copied daylight-*.js modules aside) and build.mjs:
//   W0 (any Lab code): src/lab.js or a daylight-lab.js in src/; anything that names daylight-lab (the module WIN0
//       copies in).
//   W1 (in src/*.js): a W1 export of ../share/js/daylight-lab.js (the exports after its "// W1 (L1)" heading: smart
//       intake, excerpts, the Use switches, the test article, diagnostics…), describeLabRow (F01's rows), the Sender's
//       F07 calls (flushNetwork, send(…, {defer})), LAB_NOTE_ENABLED = true (1.2: from the first build with F01 or
//       F04), a quoted id of one of Windows' W1 features ('F01', 'F08', 'F33'… in LAB_FEATURES or anywhere else), or
//       any feature in BUILT_FEATURES (W0 runs none; F02's entry point is W1 on Windows, LAB-PLAN 3.1).
// Names are matched in the whole text, comments included, so a mention holds the build rather than letting it through.
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

/** Lab features Windows names from Wave 0 (LAB-PLAN 3.1: F00, F17, F27; 1.4: Files over 9 MB in What's in Lab). */
export const W0_FEATURES = ['F00', 'F17', 'F27', 'F02'];
/** Windows' Wave 1 features (LAB-PLAN 3.1; F02's entry point too, which BUILT_FEATURES tells). */
export const W1_FEATURES = ['F01', 'F07', 'F08', 'F09', 'F16', 'F26', 'F33'];
/** F01's rows and F07's sending: W1 for Windows (LAB-PLAN 3.1), though their code is in W0's modules. */
export const W1_CALLS = ['describeLabRow', 'flushNetwork'];
const DEFER = /\bdefer\s*:/;
const NOTE_ON = /\bLAB_NOTE_ENABLED\s*=\s*true\b/;
const QUOTED_FEATURE = /['"`](F\d\d)['"`]/g;
const BUILT = /\bBUILT_FEATURES\s*=\s*\[([^\]]*)\]/g;

const named = (text, name) => new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text);

/**
 * files: [{name, text}] with names relative to this folder (src/…, build.mjs). w1: w1Names(daylight-lab.js).
 * -> {wave: null | 'w0' | 'w1', why: []}. Throws when a quoted Lab feature id belongs to no wave this script knows.
 */
export function codeWave(files, { w1 }) {
  const why = [];
  let wave = null;
  const own = files.filter((f) => f.name === 'build.mjs' || (f.name.startsWith('src/') && !/(^|\/)daylight-[\w-]+\.js$/.test(f.name)));
  for (const f of files) if (f.name === 'src/lab.js' || /^src\/(.*\/)?daylight-lab\.js$/.test(f.name)) why.push(f.name);
  for (const f of own) if (/daylight-lab/.test(f.text)) why.push(`${f.name} names daylight-lab`);
  if (why.length) wave = 'w0';
  const w1why = [];
  const unknown = [];
  for (const f of own.filter((x) => x.name.startsWith('src/') && /\.m?js$/.test(x.name))) {
    for (const n of [...w1, ...W1_CALLS]) if (named(f.text, n)) w1why.push(`${f.name} uses ${n}`);
    if (DEFER.test(f.text)) w1why.push(`${f.name} sends with defer (F07)`);
    if (NOTE_ON.test(f.text)) w1why.push(`${f.name} sets LAB_NOTE_ENABLED = true`);
    for (const id of new Set([...f.text.matchAll(QUOTED_FEATURE)].map((m) => m[1]))) {
      if (W1_FEATURES.includes(id)) w1why.push(`${f.name} names ${id}`);
      else if (!W0_FEATURES.includes(id)) unknown.push(`${f.name} names ${id}`);
    }
    for (const m of f.text.matchAll(BUILT)) {
      const built = [...m[1].matchAll(QUOTED_FEATURE)].map((x) => x[1]);
      if (built.length) w1why.push(`${f.name} builds ${built.join(', ')} (BUILT_FEATURES)`);
    }
  }
  if (unknown.length) throw new Error(`a Lab feature of a later wave (${unknown.join('; ')}): teach scripts/lab-wave.mjs its wave`);
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
