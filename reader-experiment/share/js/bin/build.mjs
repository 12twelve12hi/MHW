#!/usr/bin/env node
// Builds the one-file command line: daylight-send.mjs with its relative imports (daylight-share.js, daylight-lab.js,
// cli-store.mjs) inlined, for Node 22 with no dependencies. CI publishes the result to the release.
//
//   node share/js/bin/build.mjs [out]      (default: share/dist/daylight-send.mjs)
//
// Each inlined module becomes a function run once, in import order, returning its exports, as the extension's classic
// bundle does (extension/build.mjs). They may use only `export function|class|const|let` declarations and
// `import {a, b as c} from './x.js'` / `import * as x from './x.js'`; `node:` imports are merged and hoisted.

import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ENTRY = path.join(HERE, 'daylight-send.mjs');
export const DEFAULT_OUT = path.join(HERE, '..', '..', 'dist', 'daylight-send.mjs');

const REL_IMPORT = /^import\s+(?:\*\s+as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})\s+from\s+'(\.{1,2}\/[^']+)';?[ \t]*$/gm;
const NODE_IMPORT = /^import\s+(?:([A-Za-z_$][\w$]*)|\*\s+as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})\s+from\s+'(node:[^']+)';?[ \t]*$/gm;

export function bundleCli(entry = ENTRY) {
  const mods = new Map();
  const order = [];
  const node = new Map(); // specifier -> {def, ns, named: Map(local -> imported)}
  const bound = new Map(); // local name -> where it comes from, to refuse a clash
  const bind = (local, from) => {
    if (bound.has(local) && bound.get(local) !== from) throw new Error(`build: ${local} is imported twice (${bound.get(local)}, ${from})`);
    bound.set(local, from);
  };
  const entryFile = path.resolve(entry);

  function rewrite(file, body) {
    body = body.replace(NODE_IMPORT, (_, def, ns, names, spec) => {
      const n = node.get(spec) ?? { def: null, ns: null, named: new Map() };
      if (def) { bind(def, `${spec} default`); n.def = def; }
      if (ns) { bind(ns, `${spec} *`); n.ns = ns; }
      if (names) {
        for (const part of names.split(',').map((s) => s.trim()).filter(Boolean)) {
          const [imported, local = imported] = part.split(/\s+as\s+/);
          bind(local, `${spec} ${imported}`);
          n.named.set(local, imported);
        }
      }
      node.set(spec, n);
      return '';
    });
    return body.replace(REL_IMPORT, (_, ns, names, spec) => {
      const dep = visit(path.resolve(path.dirname(file), spec));
      if (ns) return `const ${ns} = ${dep};`;
      const binds = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        const [a, b] = s.split(/\s+as\s+/);
        return b ? `${a}: ${b}` : a;
      });
      return `const { ${binds.join(', ')} } = ${dep};`;
    });
  }

  function visit(file) {
    if (mods.has(file)) {
      if (!mods.get(file).done) throw new Error(`build: import cycle through ${file}`);
      return mods.get(file).id;
    }
    const mod = { id: `__module${mods.size}`, file, exports: [], done: false };
    mods.set(file, mod);
    let body = rewrite(file, readFileSync(file, 'utf8').replace(/^#!.*\n/, ''));
    body = body.replace(/^export\s+(async\s+function\*?|function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, name) => {
      mod.exports.push(name);
      return `${kw} ${name}`;
    });
    if (/^\s*export\b/m.test(body)) throw new Error(`build: ${path.basename(file)}: unsupported export form`);
    if (/^\s*import\b/m.test(body) || /\bimport\s*\(|import\.meta/.test(body)) throw new Error(`build: ${path.basename(file)}: unsupported import`);
    mod.body = body;
    mod.done = true;
    order.push(mod);
    return mod.id;
  }

  const entryBody = rewrite(entryFile, readFileSync(entryFile, 'utf8').replace(/^#!.*\n/, ''));
  if (/^\s*(import|export)\b/m.test(entryBody) || /import\.meta/.test(entryBody)) throw new Error('build: the entry may only import');
  const version = /const VERSION = '([^']+)'/.exec(entryBody)?.[1] ?? '?';
  let out = '#!/usr/bin/env node\n'
    + `// daylight-send ${version}: Send to Daylight from the command line (Lab). Built by reader-experiment/share/js/bin/build.mjs\n`
    + '// from daylight-send.mjs, daylight-share.js, daylight-lab.js and cli-store.mjs. Do not edit; see share/SEND-API.md.\n';
  for (const [spec, n] of node) {
    const parts = [];
    if (n.def) parts.push(n.def);
    if (n.named.size) parts.push(`{ ${[...n.named].map(([local, imported]) => (local === imported ? local : `${imported} as ${local}`)).join(', ')} }`);
    if (parts.length) out += `import ${parts.join(', ')} from '${spec}';\n`;
    if (n.ns) out += `import * as ${n.ns} from '${spec}';\n`;
  }
  for (const m of order) {
    out += `\n// ---- ${path.basename(m.file)}\nconst ${m.id} = (() => {\n${m.body}\nreturn { ${m.exports.join(', ')} };\n})();\n`;
  }
  return out + `\n// ---- ${path.basename(entryFile)}\n${entryBody}`;
}

export function buildCli(out = DEFAULT_OUT) {
  const text = bundleCli();
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, text);
  chmodSync(out, 0o755);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = buildCli(process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT);
  console.log(`wrote ${out}`);
}
