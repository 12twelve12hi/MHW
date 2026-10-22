// Limits in the Worker (DESIGN.md 2.2, 2.3, 8.2, 9.7, 11.1, 15.2): a feed check counts as an attempt before it starts,
// a hostile feed parses in linear time, the per-run parse budget, 'each' url items only for hosts that resolve to public
// addresses, the D1 size guard, bounded rows read (D1's 5 M/day free quota), and the CPU canary and kill handling for
// email and AI jobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, SERVER, mime, CF_AUTH } from './helpers.mjs';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const rss = (n, { prefix = 'x', pad = 0 } = {}) => `<?xml version="1.0"?><rss version="2.0"><channel><title>F</title>${Array.from({ length: n }, (_, i) =>
  `<item><title>${prefix}${i}</title><link>https://feeds.example/${prefix}/${i}</link><guid>${prefix}-${i}</guid><description>${'d'.repeat(pad)}</description></item>`).join('')}</channel></rss>`;
const feedRow = (t, id, url, extra = '') => t.db.prepare(`INSERT INTO feeds (id, url, mode, next_check, created, last_ok${extra ? ', ' + extra.split('=')[0] : ''}) VALUES (?, ?, 'digest', 0, 0, 1${extra ? ', ' + extra.split('=')[1] : ''})`).bind(id, url).run();

test('a feed check is counted before it starts and undone by its result', async () => {
  const seen = [];
  let t;
  const web = new Map([['feeds.example', async () => {
    seen.push((await t.rows("SELECT errors, last_error, next_check FROM feeds WHERE id = 'aaaaaaaaaaaa'"))[0]);
    return new Response(rss(3), { headers: { 'Content-Type': 'application/rss+xml' } });
  }]]);
  t = await setup({ web });
  try {
    await feedRow(t, 'aaaaaaaaaaaa', 'https://feeds.example/a');
    const T = Date.now();
    const r = await t.cron(T);
    assert.equal(r.steps.feeds, '1');
    assert.deepEqual(seen, [{ errors: 1, last_error: 'SERVER_LIMIT', next_check: T + 2 * HOUR }], 'marked while the fetch runs');
    const [after] = await t.rows("SELECT errors, last_error, next_check FROM feeds WHERE id = 'aaaaaaaaaaaa'");
    assert.deepEqual(after, { errors: 0, last_error: null, next_check: T + HOUR });
  } finally { await t.close(); }
});

test('a feed check cut short (CPU) backs off instead of blocking every run; three failures in a row pause the feed', async () => {
  let hits = 0;
  const web = new Map([['feeds.example', () => { hits++; return new Response(rss(3), { headers: { 'Content-Type': 'application/rss+xml' } }); }]]);
  const t = await setup({ web, knobs: { kill: 'feed-check' } });
  try {
    await feedRow(t, 'aaaaaaaaaaaa', 'https://feeds.example/a');
    const T = Date.now();
    const killed = await t.cron(T);
    assert.match(killed.steps.feeds, /^error:/, 'the check was cut short');
    let [f] = await t.rows("SELECT errors, last_error, next_check, paused FROM feeds WHERE id = 'aaaaaaaaaaaa'");
    assert.deepEqual(f, { errors: 1, last_error: 'SERVER_LIMIT', next_check: T + 2 * HOUR, paused: 0 }, 'the user can see which feed and why');
    await t.dispatch(`${SERVER}/__test/enqueue`, { method: 'POST', body: JSON.stringify({ origin: 'x', kind: 'url', url: 'https://example.com/x' }) });
    const next = await t.cron(T + 60_000);
    assert.equal(next.steps.feeds, undefined, 'not due again on the next run');
    assert.equal(next.steps.outbox, '1', 'the other steps run');
    // After three failed checks in a row, the last cut short, the next due check pauses the feed instead of running.
    await t.db.prepare("UPDATE feeds SET errors = 3, next_check = 0 WHERE id = 'aaaaaaaaaaaa'").run();
    hits = 0;
    await t.cron(T + 120_000);
    [f] = await t.rows("SELECT errors, last_error, paused FROM feeds WHERE id = 'aaaaaaaaaaaa'");
    assert.equal(f.paused, 1);
    assert.equal(f.last_error, 'SERVER_LIMIT');
    assert.equal(hits, 0, 'a paused feed is not fetched');
    const listed = (await t.api('GET', '/v1/feeds')).json.feeds[0];
    assert.equal(listed.paused, true);
    assert.equal(listed.lastError, 'SERVER_LIMIT');
    const un = (await t.api('PATCH', '/v1/feeds/aaaaaaaaaaaa', { json: { paused: false } })).json.feed;
    assert.deepEqual([un.paused, un.lastError, un.errors], [false, null, 0]);
  } finally { await t.close(); }
});

test('a hostile feed of unclosed tags parses in linear time inside a real Cron run', async () => {
  const hostile = '<rss><channel><title>x</title>' + '<item><title>t</title><!--'.repeat(38_000);
  assert.ok(hostile.length > 900_000 && hostile.length < 1024 * 1024);
  const web = new Map([['feeds.example', () => new Response(hostile, { headers: { 'Content-Type': 'application/rss+xml' } })]]);
  const t = await setup({ web });
  try {
    await feedRow(t, 'aaaaaaaaaaaa', 'https://feeds.example/a');
    const t0 = performance.now();
    const r = await t.cron(Date.now());
    const ms = performance.now() - t0;
    assert.equal(r.steps.feeds, '1');
    assert.ok(ms < 10_000, `${Math.round(ms)} ms (the lazy-regex scanner took about a minute for this)`);
    const [f] = await t.rows("SELECT errors, last_error FROM feeds WHERE id = 'aaaaaaaaaaaa'");
    assert.deepEqual(f, { errors: 0, last_error: null });
  } finally { await t.close(); }
});

test('Free parses at most 1 MiB of feeds per run: a feed over what is left waits for the next run, without an error', async () => {
  const hits = [];
  const big = rss(100, { pad: 7000 }); // ≈ 720 KB
  const web = new Map([['feeds.example', (req) => {
    const p = new URL(req.url).pathname;
    hits.push(p);
    const body = p === '/huge' ? rss(160, { pad: 9000 }) : big;
    return new Response(body, { headers: { 'Content-Type': 'application/rss+xml' } });
  }]]);
  const t = await setup({ web });
  try {
    await feedRow(t, 'aaaaaaaaaaaa', 'https://feeds.example/one');
    await t.db.prepare("INSERT INTO feeds (id, url, mode, next_check, created, last_ok) VALUES ('bbbbbbbbbbbb', 'https://feeds.example/two', 'digest', 1, 0, 1)").run();
    const T = Date.now();
    const r = await t.cron(T);
    assert.equal(r.steps.feeds, '1');
    const rows = Object.fromEntries((await t.rows('SELECT id, errors, last_error, next_check FROM feeds')).map((f) => [f.id, f]));
    assert.deepEqual(rows.bbbbbbbbbbbb, { id: 'bbbbbbbbbbbb', errors: 0, last_error: null, next_check: 1 }, 'deferred, not failed');
    assert.equal(rows.aaaaaaaaaaaa.errors, 0);
    const r2 = await t.cron(T + 60_000);
    assert.equal(r2.steps.feeds, '1');
    assert.equal((await t.rows("SELECT last_check FROM feeds WHERE id = 'bbbbbbbbbbbb'"))[0].last_check, T + 60_000);
    // One feed over 1 MiB can never be parsed on Free: TOO_LARGE, shown on the feed.
    await t.db.prepare("INSERT INTO feeds (id, url, mode, next_check, created, last_ok) VALUES ('cccccccccccc', 'https://feeds.example/huge', 'digest', 0, 0, 1)").run();
    await t.cron(T + 120_000);
    const [huge] = await t.rows("SELECT errors, last_error FROM feeds WHERE id = 'cccccccccccc'");
    assert.deepEqual(huge, { errors: 1, last_error: 'TOO_LARGE' });
  } finally { await t.close(); }
});

test("'each' url items only for hosts that resolve, in public DNS, to public addresses (the DC-1 fetches them on the LAN)", async () => {
  const dns = new Map([
    ['192.168.1.1.nip.io', { A: ['192.168.1.1'] }],
    ['fritz.box', 'nxdomain'],
    ['v6.example', { A: ['93.184.215.14'], AAAA: ['fd00::1'] }],
    ['down.example', 'fail'],
  ]);
  const t = await setup({ dns });
  try {
    await t.db.prepare("INSERT INTO feeds (id, url, mode, next_check, created, last_ok, title) VALUES ('aaaaaaaaaaaa', 'https://feeds.example/a', 'each', ?, 0, 1, 'F')").bind(Date.now() + DAY).run();
    const links = {
      lan: 'http://192.168.1.1.nip.io/cgi-bin/reboot', box: 'http://fritz.box/', v6: 'https://v6.example/a', down: 'https://down.example/a', ok: 'https://news.example/story',
    };
    const T = Date.now();
    // The daily digest (07:00 UTC by default) would take the 'digest' entries during that hour: keep it away from T.
    await t.db.prepare("INSERT INTO settings (k, v) VALUES ('digest', ?)").bind(JSON.stringify({ hour: (new Date(T).getUTCHours() + 12) % 24, tz: 'UTC' })).run();
    for (const [i, [key, url]] of Object.entries(links).entries()) {
      await t.db.prepare("INSERT INTO entries (feed_id, key, url, title, first_seen, state) VALUES ('aaaaaaaaaaaa', ?, ?, ?, ?, 'pending')").bind(key, url, key, T - 1000 + i).run();
    }
    const r = await t.cron(T);
    assert.equal(r.steps.each, '0');
    let states = Object.fromEntries((await t.rows('SELECT key, state FROM entries')).map((e) => [e.key, e.state]));
    assert.deepEqual(states, { lan: 'digest', box: 'digest', v6: 'digest', down: 'digest', ok: 'pending' }, 'at most 4 hosts resolved per run');
    assert.equal((await t.cron(T + 60_000)).steps.each, '1');
    states = Object.fromEntries((await t.rows('SELECT key, state FROM entries')).map((e) => [e.key, e.state]));
    assert.deepEqual(states, { lan: 'digest', box: 'digest', v6: 'digest', down: 'digest', ok: 'sent' });
    const items = await t.rows("SELECT title FROM outbox WHERE origin LIKE 'feed:%'");
    assert.deepEqual(items.map((i) => i.title), ['ok']);
    assert.ok(t.dnsLog.includes('A 192.168.1.1.nip.io'));
  } finally { await t.close(); }
});

test('past 400 MB of D1: new feed entries, baselines and mail rows pause, and /v1/status says why', async () => {
  const web = new Map([['feeds.example', () => new Response(rss(3), { headers: { 'Content-Type': 'application/rss+xml' } })]]);
  const t = await setup({ web });
  try {
    const T = Date.now();
    await t.cron(T); // the hourly cleanup measures D1; set the size after it
    let st = (await t.api('GET', '/v1/status')).json;
    assert.equal(st.storage.paused, false);
    await t.db.prepare("INSERT INTO settings (k, v) VALUES ('d1Bytes', '450000000') ON CONFLICT(k) DO UPDATE SET v = excluded.v").run();
    st = (await t.api('GET', '/v1/status')).json;
    assert.equal(st.storage.paused, true);
    assert.equal(st.storage.pausedReason, 'D1_FULL');
    // Mail: accepted (never a bounce) but not stored.
    const res = await t.email(mime({ headers: [CF_AUTH('pass')], subject: 'While full', text: 'x' }));
    assert.equal(res.rejectReason, undefined);
    assert.equal((await t.rows('SELECT * FROM mail')).length, 0);
    assert.deepEqual((await t.api('GET', '/v1/status')).json.usage.email, { received: 1, delivered: 0, dropped: 1 });
    // Feeds: a due check records nothing; a new feed is added without its baseline (recorded on its first check later).
    await feedRow(t, 'aaaaaaaaaaaa', 'https://feeds.example/a');
    const r = await t.cron(T + 60_000);
    assert.equal(r.steps.feeds, 'paused');
    const add = await t.api('POST', '/v1/feeds', { json: { url: 'https://feeds.example/new' } });
    assert.equal(add.status, 201);
    assert.equal(add.json.feed.lastOk, null);
    assert.equal((await t.rows('SELECT * FROM entries')).length, 0);
  } finally { await t.close(); }
});

test('rows read stay bounded: the email caps with 20,000 mail rows kept, and the feed list with 100 feeds × 10,800 sent entries', async () => {
  const t = await setup();
  try {
    const now = Date.now();
    await t.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000)
      INSERT INTO mail (id, received, from_addr, from_domain, from_name, subject, size, state, reason)
      SELECT printf('%032x', i), ?, 'x' || i || '@s' || (i % 500) || '.example', 's' || (i % 500) || '.example', '', 's', 10, 'dropped', 'daily-cap' FROM n`).bind(now - 1000).run();
    await t.email(mime({ headers: [CF_AUTH('pass')], from: 'one@news.example', subject: 'Counted', text: 'x' }), { from: 'one@news.example' });
    const e = await t.lastEmail();
    assert.ok(e.d1 <= 4, `email() used ${e.d1} D1 statements`);
    assert.ok(e.rowsRead < 1000, `email() read ${e.rowsRead} rows (a full scan read 20,000+)`);
    assert.equal((await t.rows("SELECT state FROM mail WHERE subject = 'Counted'"))[0].state, 'queued');

    await t.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 99)
      INSERT INTO feeds (id, url, mode, next_check, created) SELECT printf('%012x', i), 'https://f' || i || '.example/', 'digest', ?, i FROM n`).bind(now + DAY).run();
    await t.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 10799)
      INSERT INTO entries (feed_id, key, first_seen, state, sent_day) SELECT printf('%012x', i % 100), 'k' || i, ?, 'sent', '2026-0' || (1 + i % 9) || '-01' FROM n`).bind(now).run();
    const list = await t.api('GET', '/v1/feeds');
    assert.equal(list.json.feeds.length, 100);
    const read = Number(list.headers.get('X-DLS-Test-Rows-Read'));
    assert.ok(read < 20_000, `GET /v1/feeds read ${read} rows (each feed's count visited every sent entry: 1,080,000)`);
  } finally { await t.close(); }
});

test('a mail flood: rows only for the first 2 × the daily cap, the rest only counted; today’s counts stay right', async () => {
  const t = await setup({ knobs: { mailPerDay: 4, mailPerSender: 100, mailPerDomain: 100 } });
  try {
    for (let i = 0; i < 14; i++) await t.email(mime({ headers: [CF_AUTH('pass')], from: 'flood@x.example', subject: `f${i}`, text: 'x' }), { from: 'flood@x.example' });
    const rows = await t.rows('SELECT state, reason FROM mail ORDER BY received');
    assert.equal(rows.length, 8, 'rows for 2 × 4 messages');
    assert.deepEqual(rows.map((r) => r.state), ['queued', 'queued', 'queued', 'queued', 'dropped', 'dropped', 'dropped', 'dropped']);
    const day = new Date().toISOString().slice(0, 10);
    assert.equal((await t.rows("SELECT n FROM usage WHERE kind = 'email_in' AND day = ?", day))[0].n, 14);
    assert.deepEqual((await t.api('GET', '/v1/email')).json.today, { received: 14, delivered: 0, dropped: 10 });
  } finally { await t.close(); }
});

test('the CPU canary: three calls a minute, then the deploy’s "killed" report is accepted and email shows needs-paid', async () => {
  const t = await setup();
  try {
    await t.lane.hello();
    await t.cron(Date.now());
    for (let i = 0; i < 3; i++) {
      const r = await t.api('POST', '/v1/admin/selftest', { json: {} });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.ok, true);
    }
    assert.equal((await t.api('POST', '/v1/admin/selftest', { json: {} })).status, 429, 'a fourth canary within the minute');
    const st0 = (await t.api('GET', '/v1/status')).json;
    assert.equal(st0.cpu.canary, 'ok');
    assert.equal(st0.features.email.state, 'ready');
    const killed = await t.api('POST', '/v1/admin/selftest', { json: { result: 'killed' } });
    assert.equal(killed.status, 200, 'the report after the three calls is never rate-limited');
    const st = (await t.api('GET', '/v1/status')).json;
    assert.equal(st.cpu.canary, 'killed');
    assert.equal(st.features.email.state, 'needs-paid');
    assert.match(st.features.email.message, /Workers Paid/);
  } finally { await t.close(); }
});

test('mail killed three times waits as waiting-paid on Free (raw kept) and is delivered once the plan is Paid', async () => {
  const t = await setup();
  try {
    await t.email(mime({ headers: [CF_AUTH('pass')], subject: 'Heavy', html: `<p>${'Body. '.repeat(100)}</p>` }));
    const [m] = await t.rows("SELECT id FROM mail WHERE subject = 'Heavy'");
    // Three claims that never finished (each Cron run killed for CPU): running, lease over, attempts 3.
    await t.db.prepare("UPDATE mail SET state = 'running', lease = 0, attempts = 3 WHERE id = ?").bind(m.id).run();
    const T = Date.now();
    await t.cron(T);
    let [row] = await t.rows('SELECT state, reason, attempts FROM mail WHERE id = ?', m.id);
    assert.deepEqual(row, { state: 'waiting-paid', reason: 'SERVER_LIMIT', attempts: 0 });
    assert.ok(await t.env.FILES.get(`m/${m.id}.eml`), 'the raw mail is kept');
    await t.cron(T + 60_000);
    assert.equal((await t.rows('SELECT state FROM mail WHERE id = ?', m.id))[0].state, 'waiting-paid', 'not retried on Free');
    await t.restart({ WORKERS_PLAN: 'paid' });
    await t.cron(T + 120_000);
    [row] = await t.rows('SELECT state, items FROM mail WHERE id = ?', m.id);
    assert.equal(row.state, 'done');
    assert.equal(JSON.parse(row.items).length, 1);
    assert.equal(await t.env.FILES.get(`m/${m.id}.eml`), null);
  } finally { await t.close(); }
});

test('an AI job claimed three times without finishing fails SERVER_LIMIT and leaves no reservation behind', async () => {
  const t = await setup();
  try {
    await t.lane.hello();
    await t.cron(Date.now());
    const j = await t.api('POST', '/v1/ai/jobs', { json: { op: 'explain', passage: 'E = mc^2' } });
    assert.equal(j.status, 202);
    await t.db.prepare("UPDATE jobs SET state = 'running', lease = 0, attempts = 3 WHERE id = ?").bind(j.json.job.id).run();
    await t.cron(Date.now() + 60_000);
    const [job] = await t.rows('SELECT state, error, reserved_micros FROM jobs WHERE id = ?', j.json.job.id);
    assert.deepEqual(job, { state: 'failed', error: 'SERVER_LIMIT', reserved_micros: 0 });
    const [u] = await t.rows("SELECT reserved_micros FROM usage WHERE kind = 'ai'");
    assert.equal(u.reserved_micros, 0);
    assert.equal(t.claude.messageRequests().length, 0);
  } finally { await t.close(); }
});

test('the 51st email item of the day waits until tomorrow', async () => {
  const t = await setup();
  try {
    const T = Date.parse('2026-10-20T12:00:00Z');
    await t.db.prepare("INSERT INTO usage (day, kind, n) VALUES ('2026-10-20', 'email_items', 50)").run();
    await t.email(mime({ headers: [CF_AUTH('pass')], subject: 'Tomorrow', text: 'A note long enough. '.repeat(20) }));
    await t.cron(T);
    assert.equal((await t.rows("SELECT state FROM mail WHERE subject = 'Tomorrow'"))[0].state, 'queued');
    await t.cron(T + DAY);
    assert.equal((await t.rows("SELECT state FROM mail WHERE subject = 'Tomorrow'"))[0].state, 'done');
  } finally { await t.close(); }
});

test('Workers Paid: a forwarded 8 MiB PDF (about 11 statements of frames) is delivered, not failed and deleted', async () => {
  const t = await setup({ plan: 'paid' });
  try {
    const pdf = Buffer.alloc(8 * 1024 * 1024 + 1000);
    for (let i = 0; i < pdf.length; i += 4) pdf.writeUInt32LE((i * 2654435761) >>> 0, i);
    await t.email(mime({ headers: [CF_AUTH('pass')], subject: 'Fwd: big', text: 'Sent from my iPhone', attachments: [{ type: 'application/pdf', name: 'big.pdf', data: pdf }] }));
    const [m] = await t.rows("SELECT id, state FROM mail WHERE subject = 'big'");
    assert.equal(m.state, 'queued');
    const r = await t.cron(Date.now());
    const email = Object.entries(r.steps).find(([k]) => k.startsWith('email'));
    assert.equal(email?.[1], 'true', JSON.stringify(r.steps));
    const [row] = await t.rows('SELECT state, items FROM mail WHERE id = ?', m.id);
    assert.equal(row.state, 'done');
    const [item] = await t.rows('SELECT parts, kind FROM outbox WHERE id = ?', JSON.parse(row.items)[0]);
    assert.equal(item.kind, 'file');
    assert.ok(item.parts >= 8, `${item.parts} frames`);
    assert.equal((await t.rows('SELECT COUNT(*) AS n FROM frames'))[0].n, item.parts);
  } finally { await t.close(); }
});

test('an email the run has no D1 room for goes back to the queue without counting as an attempt', async () => {
  const t = await setup({ plan: 'paid', knobs: { d1Budget: 6 } });
  try {
    const pdf = Buffer.alloc(3 * 1024 * 1024, 7);
    for (let i = 0; i < pdf.length; i += 4) pdf.writeUInt32LE((i * 2246822519) >>> 0, i);
    await t.email(mime({ headers: [CF_AUTH('pass')], subject: 'Fwd: room', text: 'Sent from my iPhone', attachments: [{ type: 'application/pdf', name: 'room.pdf', data: pdf }] }));
    const [m] = await t.rows("SELECT id FROM mail WHERE subject = 'room'");
    const T = Date.now();
    for (let i = 0; i < 5; i++) {
      const r = await t.cron(T + i * 60_000);
      assert.match(JSON.stringify(r.steps), /"email\d":"error:BUDGET/, JSON.stringify(r.steps));
    }
    const [row] = await t.rows('SELECT state, reason, attempts FROM mail WHERE id = ?', m.id);
    assert.deepEqual(row, { state: 'queued', reason: 'BUDGET', attempts: 0 });
    assert.ok(await t.env.FILES.get(`m/${m.id}.eml`), 'the raw mail is kept');
    await t.restart({ TEST_KNOBS: '{}' });
    await t.cron(T + DAY);
    assert.equal((await t.rows('SELECT state FROM mail WHERE id = ?', m.id))[0].state, 'done');
  } finally { await t.close(); }
});
