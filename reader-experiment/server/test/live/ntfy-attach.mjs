// Informational CI probe (DESIGN.md 6.4), run on the GitHub runner, which can reach ntfy.sh: does ntfy.sh keep a message
// published with `Attach: <url>` as a message whose attachment.url is that URL, for 12 hours, without refusing it for
// size? Large files and hosted server frames rest on this. Prints Markdown for the job summary; exits 0 either way.
//
//   node test/live/ntfy-attach.mjs [relay]

import { randomBytes } from 'node:crypto';

const relay = (process.argv[2] ?? 'https://ntfy.sh').replace(/\/+$/, '');
const topic = `dls-probe-${randomBytes(12).toString('hex')}`;
const url = `https://example.com/dls-probe/${randomBytes(8).toString('hex')}/0`;
const lines = ['### ntfy.sh external attachments (informational)', ''];
const check = (ok, text) => lines.push(`- ${ok ? '✅' : '❌'} ${text}`);

try {
  const pub = await fetch(`${relay}/${topic}`, {
    method: 'POST', headers: { Attach: url, Filename: 'dls1.bin', Firebase: 'no', Cache: 'yes' }, body: 'dls1', signal: AbortSignal.timeout(30_000),
  });
  const body = await pub.json().catch(() => ({}));
  check(pub.status === 200, `publish answered ${pub.status} (not refused for size)`);
  check(body.attachment?.url === url, `attachment.url is the given URL (${body.attachment ? Object.keys(body.attachment).join(', ') : 'no attachment'})`);
  const keptHours = body.expires && body.time ? (body.expires - body.time) / 3600 : null;
  check(keptHours === null || keptHours >= 11.9, `kept as a message for ${keptHours === null ? 'an unstated time' : `${keptHours.toFixed(1)} h`}`);
  const poll = await fetch(`${relay}/${topic}/json?poll=1&since=all`, { signal: AbortSignal.timeout(30_000) });
  const listed = (await poll.text()).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((m) => m?.id === body.id);
  check(!!listed && listed.attachment?.url === url, `a poll lists it with the same attachment.url${listed?.attachment?.size ? '' : ' and no size (as expected)'}`);
} catch (e) {
  check(false, `probe failed: ${e?.name ?? 'error'}`);
}
console.log(lines.join('\n'));
