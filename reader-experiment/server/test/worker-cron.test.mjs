// The Cron's budgets (DESIGN.md 2.3): with every step due at once, one run stays within D1's 50 statements and 50
// external subrequests per invocation, each step stays inside its allowance, and one failing step never fails the others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, SERVER, mime, CF_AUTH } from './helpers.mjs';

const rss = (name, n, gen = 0) => `<rss><channel><title>${name}</title>${Array.from({ length: n }, (_, i) =>
  `<item><title>${name} ${gen}-${i}</title><link>https://feeds.example/${name}/${gen}-${i}</link><guid>${name}-${gen}-${i}</guid></item>`).join('')}</channel></rss>`;

async function everythingDue(plan) {
  let gen = 0;
  const web = new Map([['feeds.example', (req) => new Response(rss(new URL(req.url).pathname.slice(1), 30, gen), { headers: { 'Content-Type': 'application/rss+xml' } })]]);
  const t = await setup({ web, plan });
  const T = Date.now();
  await t.lane.hello();
  await t.cron(T); // config, acks (hello), cleanup
  for (let i = 0; i < 5; i++) {
    assert.equal((await t.api('POST', '/v1/feeds', { json: { url: `https://feeds.example/f${i}`, mode: i % 2 ? 'digest' : 'each' }, now: T })).status, 201);
  }
  gen = 1;
  for (let i = 0; i < 3; i++) {
    await t.email(mime({ headers: [CF_AUTH('pass')], from: `n${i}@news${i}.example`, subject: `Issue ${i}`, html: `<p>${'Body text. '.repeat(400)}</p>` }), { from: `n${i}@news${i}.example` });
  }
  for (let i = 0; i < 2; i++) assert.equal((await t.api('POST', '/v1/ai/jobs', { json: { op: 'explain', passage: `p${i}` } })).status, 202);
  const big = Array.from({ length: 120_000 }, (_, i) => `<p>${(i * 2654435761 >>> 0).toString(36)}</p>`).join('');
  for (let i = 0; i < 4; i++) {
    await t.dispatch(`${SERVER}/__test/enqueue`, { method: 'POST', body: JSON.stringify(i === 0 ? { origin: 'big', kind: 'page', title: 'Big', text: big } : { origin: `u${i}`, kind: 'url', url: `https://example.com/${i}` }) });
  }
  await t.db.prepare(`INSERT INTO entries (feed_id, key, url, title, first_seen, state) SELECT id, 'p' || id, 'https://feeds.example/pending/' || id, 'Pending', ?, 'pending' FROM feeds`).bind(T).run();
  await t.db.prepare("INSERT INTO settings (k, v) VALUES ('digestNow', 'true') ON CONFLICT(k) DO UPDATE SET v = 'true'").run();
  return { t, T };
}

for (const plan of ['free', 'paid']) {
  // D1 allows 50 queries per invocation on Free and 1,000 on Paid (2.1).
  const d1Max = plan === 'free' ? 50 : 1000;
  test(`worst-case Cron on the ${plan} plan: every step due, within ${d1Max} D1 statements and 50 subrequests`, async () => {
    const { t, T } = await everythingDue(plan);
    try {
      const at = T + 7 * 3600_000; // config slot, ack poll and cleanup all due again; feeds due after an hour
      const report = await t.cron(at);
      if (process.env.DLS_DEBUG) console.log(plan, JSON.stringify(report));
      assert.ok(report.d1 <= d1Max, `D1 statements: ${report.d1}`);
      assert.ok(report.sub <= 50, `subrequests: ${report.sub}`);
      const steps = Object.keys(report.steps);
      for (const s of ['settings', 'config', 'acks', 'outbox', 'feeds', 'each', 'digest']) assert.ok(steps.includes(s), `${s} ran: ${JSON.stringify(report.steps)}`);
      const heavy = steps.filter((s) => /^(email|job)\d/.test(s));
      assert.equal(heavy.length, plan === 'free' ? 1 : 4, `${plan}: heavy steps ${JSON.stringify(report.steps)}`);
      for (const [name, r] of Object.entries(report.steps)) {
        assert.ok(!String(r).startsWith('error:') || String(r).startsWith('error:BUDGET'), `${name}: ${r}`);
      }
      // A few more runs drain the queues without ever passing the limits.
      for (let i = 1; i <= 6; i++) {
        const r = await t.cron(at + i * 60_000);
        assert.ok(r.d1 <= d1Max && r.sub <= 50, JSON.stringify(r));
      }
      const mail = await t.rows("SELECT state FROM mail WHERE state != 'done'");
      assert.deepEqual(mail, [], 'all mail processed');
      const jobs = await t.rows("SELECT state FROM jobs WHERE state != 'done'");
      assert.deepEqual(jobs, [], 'all jobs done');
    } finally { await t.close(); }
  });
}

test('one failing step never fails the others', async () => {
  const t = await setup({ web: new Map([['feeds.example', () => { throw new Error('boom'); }]]) });
  try {
    await t.db.prepare(`INSERT INTO feeds (id, url, mode, next_check, created) VALUES ('aaaaaaaaaaaa', 'https://feeds.example/x', 'each', 0, 0)`).run();
    await t.dispatch(`${SERVER}/__test/enqueue`, { method: 'POST', body: JSON.stringify({ origin: 'x', kind: 'url', url: 'https://example.com/x' }) });
    const r = await t.cron(Date.now());
    assert.equal(r.steps.feeds, '1', 'the feed check failed and was recorded, not thrown');
    assert.equal(r.steps.outbox, '1');
    const [f] = await t.rows("SELECT errors, last_error FROM feeds WHERE id = 'aaaaaaaaaaaa'");
    assert.deepEqual(f, { errors: 1, last_error: 'FETCH_FAILED' });
  } finally { await t.close(); }
});
