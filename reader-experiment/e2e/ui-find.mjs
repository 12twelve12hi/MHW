// Finds where to tap on the emulator, for inbox-e2e.sh.
//   node ui-find.mjs node <uiautomator dump.xml> <regex> [package]
//     -> "x y": the centre of the first node whose text or content-desc matches <regex> (case-sensitive), and whose
//        package is [package] when given
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

if (mode === 'node') {
  const re = new RegExp(arg);
  for (const m of text.matchAll(/<node\b[^>]*>/g)) {
    const attr = (name) => unescape(m[0].match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? '');
    if (!re.test(attr('text')) && !re.test(attr('content-desc'))) continue;
    if (pkg && attr('package') !== pkg) continue;
    const b = attr('bounds').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (!b) continue;
    const [l, t, r, btm] = b.slice(1).map(Number);
    if (r <= l || btm <= t) continue;
    console.log(`${Math.round((l + r) / 2)} ${Math.round((t + btm) / 2)}`);
    process.exit(0);
  }
  process.exit(1);
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
  console.error('usage: ui-find.mjs node <dump.xml> <regex> [package] | card-add <dumpsys.txt> <dpi>');
  process.exit(2);
}
