#!/usr/bin/env node
// Keeps the copies of the capture code equal to its one source, this folder (LAB-PLAN 6.3):
//
//   node share/js/capture/sync.mjs --check <file>...   exit 1 when a copy differs from its source
//   node share/js/capture/sync.mjs --write <file>...   rewrite each copy from its source
//
// A file whose name is clean-html.js or Readability.js is a whole copy (the extension's build output). Any other file
// holds marked blocks, each the source byte for byte between its two marker lines (GetPage.js):
//
//   // BEGIN clean-html            // BEGIN Readability
//   …clean-html.js…                 …Readability.js…
//   // END clean-html              // END Readability
//
// The marker lines may be indented; the block between them is never re-indented. Every run also checks that
// Readability.js is Mozilla Readability 0.6.0 as published on npm (its SHA-256 below). Exit 2: bad usage, a file that
// cannot be read, or a file with no copy in it.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Marker name -> source file in this folder. */
export const SOURCES = { 'clean-html': 'clean-html.js', Readability: 'Readability.js' };
/** SHA-256 of Readability.js in @mozilla/readability 0.6.0 (npm integrity sha512-juG5VWh4…pDT9/QQ==). */
export const READABILITY_VERSION = '0.6.0';
export const READABILITY_SHA256 = '34dcab3d0832d0019f02990eed6b6124e029e8c32b9f0c6f2550544ff8dff174';

const BLOCK_RE = /^([ \t]*\/\/ BEGIN (clean-html|Readability)[ \t]*\r?\n)([\s\S]*?)(^[ \t]*\/\/ END \2[ \t]*$)/gm;

export function source(name, dir = HERE) { return readFileSync(path.join(dir, SOURCES[name]), 'utf8'); }

export function readabilityPinned(dir = HERE) {
  return createHash('sha256').update(readFileSync(path.join(dir, SOURCES.Readability))).digest('hex') === READABILITY_SHA256;
}

/**
 * Compares (or, with write, rewrites) one copy. -> {file, copies: [{name, same}], changed} or throws Error with
 * `code` 'no-copy' when the file holds no copy.
 */
export function syncFile(file, { write = false, dir = HERE } = {}) {
  const text = readFileSync(file, 'utf8');
  const base = path.basename(file);
  const whole = Object.keys(SOURCES).find((n) => SOURCES[n] === base);
  if (whole) {
    const src = source(whole, dir);
    const same = text === src;
    if (!same && write) writeFileSync(file, src);
    return { file, copies: [{ name: whole, same }], changed: !same && write };
  }
  const copies = [];
  const out = text.replace(BLOCK_RE, (block, head, name, body, end) => {
    const src = source(name, dir);
    copies.push({ name, same: body === src });
    return head + src + end;
  });
  if (!copies.length) {
    const e = new Error(`${file}: no copy of ${Object.values(SOURCES).join(' or ')} (no "// BEGIN clean-html" or "// BEGIN Readability" block)`);
    e.code = 'no-copy';
    throw e;
  }
  const changed = write && out !== text;
  if (changed) writeFileSync(file, out);
  return { file, copies, changed };
}

function main(argv) {
  const mode = argv[0];
  const files = argv.slice(1);
  if (mode !== '--check' && mode !== '--write') {
    console.error('usage: node sync.mjs --check|--write <file>...');
    return 2;
  }
  let code = 0;
  if (!readabilityPinned()) {
    console.error(`Readability.js is not Mozilla Readability ${READABILITY_VERSION} as published (SHA-256 ${READABILITY_SHA256})`);
    code = 1;
  }
  for (const f of files) {
    let r;
    try {
      r = syncFile(f, { write: mode === '--write' });
    } catch (e) {
      console.error(e.code === 'no-copy' ? e.message : `${f}: ${e.message}`);
      return 2;
    }
    for (const c of r.copies) {
      if (c.same) console.log(`${f}: ${c.name} is up to date`);
      else if (mode === '--write') console.log(`${f}: ${c.name} rewritten from share/js/capture/${SOURCES[c.name]}`);
      else { console.error(`${f}: ${c.name} differs from share/js/capture/${SOURCES[c.name]} (run sync.mjs --write ${f})`); code = 1; }
    }
  }
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
