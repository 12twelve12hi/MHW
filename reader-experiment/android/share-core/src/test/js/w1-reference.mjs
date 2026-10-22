// Runs the W1 reference functions of share/js/daylight-lab.js (LAB-PROTOCOL 2.9) on a batch of inputs, for
// W1DifferentialTest: the Kotlin port must give the same answer for every input, not only for the vectors.
//   node w1-reference.mjs <daylight-lab.js> <cases.json>   -> prints [{fn, out} | {fn, error}] in the cases' order
// cases.json: [{fn, args: [...]}], fn one of the names below; args are passed as given (objects for the functions that
// take one). Lone surrogates travel as \u escapes in JSON both ways.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [, , lib, file] = process.argv;
const lab = await import(pathToFileURL(lib).href);
const FNS = [
  'normaliseShare', 'classifyShare', 'cleanShareUrl', 'findShareUrl', 'shareTitle', 'textFragmentText', 'withoutTextFragment',
  'extractAppleNewsTarget', 'sanitizeExcerptHtml', 'excerptTextHtml', 'excerptItem', 'excerptMarkdown', 'excerptFileName',
  'excerptTitle', 'textFragment', 'excerptDate', 'redactDiagnostics', 'hostLineText', 'inboxKindLine', 'cleanedFromText',
];
const cases = JSON.parse(readFileSync(file, 'utf8'));
const out = cases.map(({ fn, args }) => {
  if (!FNS.includes(fn)) return { fn, error: `unknown function ${fn}` };
  try {
    const r = lab[fn](...args);
    return { fn, out: r === undefined ? null : r };
  } catch (e) {
    return { fn, error: String(e?.code ?? e?.message ?? e) };
  }
});
process.stdout.write(JSON.stringify(out) + '\n');
