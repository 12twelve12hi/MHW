// The Lab wave of the extension's code, read from the code itself (LAB-PLAN 6.2), so that a lab-wave.json left behind
// (at "w0" once W1 code lands, say) can't open the release gate for a Lab build:
//
//   node scripts/lab-wave.mjs            prints the wave the release gate must hold this build for: the later of
//                                        lab-wave.json's and the code's, or nothing when neither has Lab code. Says why
//                                        on stderr. Exits 2 when it can't tell (daylight-lab.js changed shape, or the
//                                        code names a Lab feature of a wave this script doesn't know yet).
//   node scripts/lab-wave.mjs --check    the same, but exits 1 when lab-wave.json is behind the code.
//
// What counts, in src/ (the copied daylight-*.js modules aside) and build.mjs:
//   W0 (any Lab code): src/lab.js or a daylight-lab.js in src/, or anything that names daylight-lab (the module
//       build.mjs copies in).
//   W1: a W1 export of ../share/js/daylight-lab.js (the exports after its "// W1 (L1)" heading: smart intake, excerpts,
//       the Use switches, the test article, diagnostics, fillText…), describeLabRow (F01's rows), the Sender's F07 calls
//       (flushNetwork, send(…, {defer})), LAB_NOTE_ENABLED = true (1.2: from the first build with F01 or F04), or a
//       quoted id of one of the extension's W1 features ('F01', 'F03', … in LAB_FEATURES or BUILT_FEATURES).
// Names are matched in the whole text, comments included, so a mention holds the build rather than letting it through.
//
// Who reads it: rx-extension.yml's publish job (the Chrome zip), build.mjs (the Safari build, which ships inside the
// iPhone and Mac apps: it leaves Lab out while the wave is closed), and test/unit/build.test.mjs, which checks
// lab-wave.json against it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, '..');
export const LAB_LIB = path.join(ROOT, '..', 'share', 'js', 'daylight-lab.js');
export const GATE = path.join(ROOT, '..', 'lab-release-gate.json');
const TEXT = /\.(m?js|html|css|json)$/;

/** Lab features the extension lists from Wave 0 (LAB-PLAN 1.4: the server features), and the plan's W0 items. */
export const W0_FEATURES = ['F00', 'F17', 'F27', 'F02', 'F37', 'F19', 'F36'];
/** The extension's Wave 1 features (LAB-PLAN 1.4 and 3.1, Chrome and Safari). */
export const W1_FEATURES = ['F01', 'F03', 'F04', 'F07', 'F10', 'F11', 'F16', 'F26', 'F33', 'F34'];
/** F01's rows and F07's sending: W1, though their code is in W0's modules. */
export const W1_CALLS = ['describeLabRow', 'flushNetwork'];
const DEFER = /\bdefer\s*:/;
const NOTE_ON = /\bLAB_NOTE_ENABLED\s*=\s*true\b/;
const QUOTED_FEATURE = /['"`](F\d\d)['"`]/g;

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

/** -> {declared, code, why, hold}: hold is the wave to hold the build for (null: no Lab code anywhere). Throws: can't tell. */
export function holdFor(root = ROOT, labLib = LAB_LIB) {
  const declared = JSON.parse(fs.readFileSync(path.join(root, 'lab-wave.json'), 'utf8')).wave ?? null;
  waveRank(declared);
  const { wave: code, why } = codeWave(readTree(root), { w1: w1Names(fs.readFileSync(labLib, 'utf8')) });
  return { declared, code, why, hold: laterWave(declared, code) };
}

/**
 * The release gate for this code (LAB-PLAN 6.2): -> {hold, open, why}. open: no Lab code, or the gate file has the
 * hold wave true. Throws when the wave can't be told (callers hold the build then).
 */
export function releaseGate({ root = ROOT, labLib = LAB_LIB, gate = GATE } = {}) {
  const { hold, why } = holdFor(root, labLib);
  const gates = JSON.parse(fs.readFileSync(gate, 'utf8'));
  return { hold, open: hold == null || gates[hold] === true, why };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { declared, code, why, hold } = holdFor();
    console.error(`extension/lab-wave.json: ${declared ?? 'none'}; the code: ${code ?? 'no Lab code'}${why.length ? ` (${why.slice(0, 6).join('; ')})` : ''}`);
    if (waveRank(code) > waveRank(declared)) {
      console.error(`extension/lab-wave.json is behind the code: it must say "${code}". Holding the build for ${code}.`);
      if (process.argv.includes('--check')) process.exit(1);
    }
    console.log(hold ?? '');
  } catch (e) {
    console.error(`can't tell the Lab wave of the extension's code: ${e.message}`);
    process.exit(2);
  }
}
