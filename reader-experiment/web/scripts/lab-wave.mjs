// The Lab wave of the web sender's code, read from the code itself (LAB-PLAN 6.2), so that a lab-wave.json left behind
// can't open the release gate for a Lab build:
//
//   node scripts/lab-wave.mjs            prints the wave the release gate must hold this build for: the later of
//                                        lab-wave.json's and the code's, or nothing when neither has Lab code. Says why
//                                        on stderr. Exits 2 when it can't tell (daylight-lab.js changed shape, or the
//                                        code names a Lab feature of a wave this script doesn't know yet).
//   node scripts/lab-wave.mjs --check    the same, but exits 1 when lab-wave.json is behind this folder's own code.
//                                        (Code the build copies from the extension holds the build all the same, but
//                                        doesn't fail the check: the ext lane changes it, and only this lane edits
//                                        lab-wave.json. The log says so.)
//
// What counts: this folder's own page files (*.js, *.html, *.css, *.json, *.webmanifest at its top level, build.mjs
// included; not dist/ or scripts/), and the files build.mjs copies in from the extension (logic.js and lab-ui.js),
// because their code ships in this build too. The copied share/ and server/ modules are libraries, not this build's
// Lab code.
//   W0 (any Lab code): web-lab.js, or anything that names daylight-lab (the module build.mjs copies in).
//   W1: a W1 export of ../share/js/daylight-lab.js (the exports after its "// W1 (L1)" heading), the timeline's row
//       text or the outbox's offline calls (W1_CALLS, and send(…, {defer})), LAB_NOTE_ENABLED = true (1.2: from the
//       first build with the timeline or share in place), or a quoted id of a Wave 1 feature of any app (the web's,
//       or the extension's in the copied lab-ui.js).
// Names are matched in the whole text, comments included, so a mention holds the build rather than letting it through.
//
// Who reads it: rx-extension.yml's publish job (send-to-daylight-web.zip) and pages job (GitHub Pages), the web job
// (--check), and ../../extension/test/unit/web-lab.test.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, '..');
export const LAB_LIB = path.join(ROOT, '..', 'share', 'js', 'daylight-lab.js');
export const GATE = path.join(ROOT, '..', 'lab-release-gate.json');
/** The extension's files that build.mjs copies into the site (its SHARED list), by their name in the site. */
export const COPIED = {
  'logic.js': path.join(ROOT, '..', 'extension', 'src', 'logic.js'),
  'lab-ui.js': path.join(ROOT, '..', 'extension', 'src', 'lab-ui.js'),
};
const OWN_TEXT = /\.(m?js|html|css|json|webmanifest)$/;

/** Lab features listed from Wave 0 (LAB-PLAN 1.4: the server features) and the plan's W0 items. */
export const W0_FEATURES = ['F00', 'F17', 'F27', 'F02', 'F37', 'F19', 'F36'];
/** Wave 1 features of every app (LAB-PLAN 3.1); the web's own are F01, F07, F09, F16, F26 and F33. */
export const W1_FEATURES = ['F01', 'F03', 'F04', 'F07', 'F08', 'F09', 'F10', 'F11', 'F15', 'F16', 'F23', 'F26', 'F29', 'F33', 'F34'];
/** The timeline's rows and the outbox's offline sending: W1, though their code is in W0's modules. */
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
  if (at < 0) throw new Error('daylight-lab.js has no "// W1 (L1)" heading: update web/scripts/lab-wave.mjs');
  const names = [...labSource.slice(at).matchAll(/^export (?:async )?(?:function\*? ?|const |let |class )([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  if (!names.length) throw new Error('daylight-lab.js exports nothing under its W1 heading: update web/scripts/lab-wave.mjs');
  return [...new Set(names)];
}

const named = (text, name) => new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text);

/**
 * files: [{name, text}]: the page's own files by name (web-lab.js, build.mjs, …) and the copied ones (logic.js,
 * lab-ui.js). w1: w1Names(daylight-lab.js). -> {wave: null | 'w0' | 'w1', why: []}. Throws when a quoted Lab feature id
 * belongs to no wave this script knows.
 */
export function codeWave(files, { w1 }) {
  const why = [];
  let wave = null;
  for (const f of files) if (f.name === 'web-lab.js') why.push(f.name);
  for (const f of files) if (/daylight-lab/.test(f.text)) why.push(`${f.name} names daylight-lab`);
  if (why.length) wave = 'w0';
  const w1why = [];
  const unknown = [];
  for (const f of files.filter((x) => /\.m?js$/.test(x.name) || x.name.endsWith('.html'))) {
    for (const n of [...w1, ...W1_CALLS]) if (named(f.text, n)) w1why.push(`${f.name} uses ${n}`);
    if (DEFER.test(f.text)) w1why.push(`${f.name} sends with defer (F07)`);
    if (NOTE_ON.test(f.text)) w1why.push(`${f.name} sets LAB_NOTE_ENABLED = true`);
    for (const id of new Set([...f.text.matchAll(QUOTED_FEATURE)].map((m) => m[1]))) {
      if (W1_FEATURES.includes(id)) w1why.push(`${f.name} names ${id}`);
      else if (!W0_FEATURES.includes(id)) unknown.push(`${f.name} names ${id}`);
    }
  }
  if (unknown.length) throw new Error(`a Lab feature of a later wave (${unknown.join('; ')}): teach web/scripts/lab-wave.mjs its wave`);
  if (w1why.length) { wave = 'w1'; why.push(...w1why); }
  return { wave, why };
}

/** The page's own files at the folder's top level, then the copied extension files, as codeWave reads them. */
export function readTree(root = ROOT, copied = COPIED) {
  const files = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isFile() && OWN_TEXT.test(e.name) && e.name !== 'lab-wave.json') files.push({ name: e.name, text: fs.readFileSync(path.join(root, e.name), 'utf8') });
  }
  for (const [name, src] of Object.entries(copied)) files.push({ name, text: fs.readFileSync(src, 'utf8') });
  return files;
}

/**
 * -> {declared, code, own, why, hold}: code is the wave of everything the build ships, own that of this folder's files
 * alone (what lab-wave.json must not fall behind), hold the wave to hold the build for (null: no Lab code anywhere).
 * Throws: can't tell.
 */
export function holdFor(root = ROOT, labLib = LAB_LIB, copied = COPIED) {
  const declared = JSON.parse(fs.readFileSync(path.join(root, 'lab-wave.json'), 'utf8')).wave ?? null;
  waveRank(declared);
  const w1 = w1Names(fs.readFileSync(labLib, 'utf8'));
  const tree = readTree(root, copied);
  const { wave: code, why } = codeWave(tree, { w1 });
  const { wave: own } = codeWave(tree.filter((f) => !Object.hasOwn(copied, f.name)), { w1 });
  return { declared, code, own, why, hold: laterWave(declared, code) };
}

/**
 * The release gate for this code (LAB-PLAN 6.2): -> {hold, open, why}. open: no Lab code, or the gate file has the hold
 * wave true. Throws when the wave can't be told (callers hold the build then).
 */
export function releaseGate({ root = ROOT, labLib = LAB_LIB, gate = GATE, copied = COPIED } = {}) {
  const { hold, why } = holdFor(root, labLib, copied);
  const gates = JSON.parse(fs.readFileSync(gate, 'utf8'));
  return { hold, open: hold == null || gates[hold] === true, why };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { declared, code, own, why, hold } = holdFor();
    console.error(`web/lab-wave.json: ${declared ?? 'none'}; the code: ${code ?? 'no Lab code'}${why.length ? ` (${why.slice(0, 6).join('; ')})` : ''}`);
    if (waveRank(own) > waveRank(declared)) {
      console.error(`web/lab-wave.json is behind this folder's code: it must say "${own}". Holding the build for ${hold}.`);
      if (process.argv.includes('--check')) process.exit(1);
    } else if (waveRank(code) > waveRank(declared)) {
      console.error(`The extension files the build copies are Lab wave ${code}: holding the build for ${code}. Set web/lab-wave.json to "${code}" when this folder's code is.`);
    }
    console.log(hold ?? '');
  } catch (e) {
    console.error(`can't tell the Lab wave of the web sender's code: ${e.message}`);
    process.exit(2);
  }
}
