// Finds where to tap on the emulator, for inbox-e2e.sh.
//   node ui-find.mjs node <uiautomator dump.xml> <regex> [package]
//     -> "x y": the centre of the first node whose text or content-desc matches <regex> (case-sensitive), and whose
//        package is [package] when given
//   node ui-find.mjs bounds <uiautomator dump.xml> <regex> [package]
//     -> "left top right bottom" of that node (to swipe a notification away, F15)
//   node ui-find.mjs near <uiautomator dump.xml> <anchor regex> <target regex> [package]
//     -> "x y": the node matching <target regex> (its text, content-desc or resource-id) nearest to the first node
//        matching <anchor regex>, within 200 px above or below it (a notification's expand button, next to its title)
//   node ui-find.mjs card-add <dumpsys window windows.txt> <density dpi>
//     -> "x y": inside the "Add to Reader" button of the Inbox's card over the Reader (WaitingCard: a window titled
//        "Daylight Share"; the button sits at its bottom right, 18 dp from the right edge and 12 dp from the bottom,
//        at least 96 x 48 dp). Used only when uiautomator cannot see the card.
// Exits 1 when there is no such node or window.
import { readFileSync } from 'node:fs';

const [mode, file, arg, pkg] = process.argv.slice(2);
const text = readFileSync(file, 'utf8');
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#10;/g, '\n').replace(/&amp;/g, '&');

// Every node: its text, content-desc, resource-id, package and bounds.
function nodes() {
  const out = [];
  for (const m of text.matchAll(/<node\b[^>]*>/g)) {
    const attr = (name) => unescape(m[0].match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? '');
    const b = attr('bounds').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (!b) continue;
    const [l, t, r, btm] = b.slice(1).map(Number);
    if (r <= l || btm <= t) continue;
    out.push({ text: attr('text'), desc: attr('content-desc'), id: attr('resource-id'), pkg: attr('package'), l, t, r, b: btm });
  }
  return out;
}
const centre = (n) => `${Math.round((n.l + n.r) / 2)} ${Math.round((n.t + n.b) / 2)}`;
const named = (re, n) => re.test(n.text) || re.test(n.desc);

if (mode === 'node' || mode === 'bounds') {
  const re = new RegExp(arg);
  const n = nodes().find((x) => named(re, x) && (!pkg || x.pkg === pkg));
  if (!n) process.exit(1);
  console.log(mode === 'node' ? centre(n) : `${n.l} ${n.t} ${n.r} ${n.b}`);
  process.exit(0);
} else if (mode === 'near') {
  const [, , , , anchorRe, targetRe, inPkg] = process.argv;
  const all = nodes();
  const a = all.find((x) => named(new RegExp(anchorRe), x) && (!inPkg || x.pkg === inPkg));
  if (!a) process.exit(1);
  const re = new RegExp(targetRe);
  const mid = (n) => (n.t + n.b) / 2;
  const hits = all.filter((x) => (named(re, x) || re.test(x.id)) && (!inPkg || x.pkg === inPkg)
    && x.b >= a.t - 200 && x.t <= a.b + 200)
    .sort((x, y) => Math.abs(mid(x) - mid(a)) - Math.abs(mid(y) - mid(a)));
  if (!hits.length) process.exit(1);
  console.log(centre(hits[0]));
  process.exit(0);
} else if (mode === 'card-add') {
  const d = (Number(arg) || 160) / 160;
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /Window #\d+ Window\{[0-9a-f]+ u\d+ Daylight Share\}:/.test(l));
  if (start < 0) process.exit(1);
  for (let i = start + 1; i < lines.length && !/Window #\d+ Window\{/.test(lines[i]); i++) {
    const f = lines[i].match(/(?:^|\s)(?:frame|mFrame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (!f) continue;
    const [, , r, b] = f.slice(1).map(Number);
    console.log(`${Math.round(r - 18 * d - 48 * d)} ${Math.round(b - 12 * d - 24 * d)}`);
    process.exit(0);
  }
  process.exit(1);
} else {
  console.error('usage: ui-find.mjs node|bounds <dump.xml> <regex> [package] | near <dump.xml> <anchor> <target> [package] | card-add <dumpsys.txt> <dpi>');
  process.exit(2);
}
