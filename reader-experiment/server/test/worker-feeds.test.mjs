// Feeds and digests in the Worker (DESIGN.md 8): adding with autodiscovery and a baseline, checks with conditional
// GETs, 'each' items within caps with overflow into the digest, the daily digest across DST changes with no repeats,
// digest overflow, a flooding feed, LAN links, OPML import and the error answers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

const site = new Map(); // path -> {body, type, etag, status}
const hits = [];
function webHandler(req) {
  const u = new URL(req.url);
  hits.push(u.pathname);
  const r = site.get(u.pathname);
  if (!r) return new Response('not found', { status: 404 });
  if (r.etag && req.headers.get('if-none-match') === r.etag) return new Response(null, { status: 304 });
  const body = typeof r.body === 'function' ? r.body() : r.body;
  return new Response(body, { status: r.status ?? 200, headers: { 'Content-Type': r.type ?? 'application/rss+xml', ...(r.etag ? { ETag: r.etag } : {}) } });
}

const rss = (title, items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>https://site.example/</link>${items.map((i) =>
  `<item><title>${i.title ?? i.id}</title><link>${i.link ?? `https://site.example/p/${i.id}`}</link><guid>${i.id}</guid><description>Excerpt of ${i.id}</description>${i.author ? `<author>${i.author}</author>` : ''}</item>`).join('')}</channel></rss>`;

let t;
before(async () => {
  t = await setup({ web: new Map([['site.example', webHandler], ['other.example', webHandler]]), knobs: { feedItemsPerFeedDay: 3 } });
  await t.lane.hello();
});
after(async () => { await t?.close(); });

const now0 = Date.parse('2026-10-20T10:00:00Z');
let feedId;

test('adding a feed: autodiscovery from an HTML page, a baseline that is never sent, the Feed object', async () => {
  site.set('/blog', { type: 'text/html', body: '<html><head><title>Blog</title><link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml"></head></html>' });
  site.set('/feed.xml', { body: rss('Site &amp; Co', [{ id: 'a' }, { id: 'b' }]), etag: '"v1"' });
  const r = await t.api('POST', '/v1/feeds', { json: { url: 'https://site.example/blog', mode: 'each' }, now: now0 });
  assert.equal(r.status, 201, r.text);
  const f = r.json.feed;
  feedId = f.id;
  assert.match(f.id, /^[0-9a-f]{12}$/);
  assert.equal(f.url, 'https://site.example/feed.xml');
  assert.equal(f.title, 'Site & Co');
  assert.equal(f.mode, 'each');
  assert.equal(f.paused, false);
  assert.equal(f.lastError, null);
  assert.deepEqual((await t.rows('SELECT state FROM entries WHERE feed_id = ?', f.id)).map((e) => e.state), ['baseline', 'baseline']);
  await t.cron(now0 + 60_000);
  assert.equal((await t.rows("SELECT * FROM outbox WHERE origin LIKE 'feed:%'")).length, 0, 'the baseline is never sent');
  const list = (await t.api('GET', '/v1/feeds', { now: now0 })).json;
  assert.equal(list.feeds.length, 1);
  assert.deepEqual(Object.keys(list.feeds[0]).sort(), ['created', 'errors', 'id', 'lastCheck', 'lastError', 'lastOk', 'mode', 'paused', 'sentToday', 'site', 'title', 'url']);
  assert.deepEqual(list.digest, { hour: 7, tz: 'UTC', pending: 0, lastSent: null });
});

test('errors: FEED_EXISTS, FEED_INVALID, URL_BLOCKED, FETCH_FAILED', async () => {
  assert.equal((await t.api('POST', '/v1/feeds', { json: { url: 'https://site.example/feed.xml' } })).json.error.code, 'FEED_EXISTS');
  assert.equal((await t.api('POST', '/v1/feeds', { json: { url: 'https://site.example/blog' } })).json.error.code, 'FEED_EXISTS', 'after autodiscovery too');
  site.set('/plain', { type: 'text/html', body: '<html><body>no feed here</body></html>' });
  const inv = await t.api('POST', '/v1/feeds', { json: { url: 'https://site.example/plain' } });
  assert.equal(inv.status, 422);
  assert.equal(inv.json.error.code, 'FEED_INVALID');
  for (const url of ['http://192.168.1.1/feed', 'http://router.lan/rss', 'https://localhost/x', 'ftp://site.example/x']) {
    const b = await t.api('POST', '/v1/feeds', { json: { url } });
    assert.equal(b.json.error.code, 'URL_BLOCKED', url);
  }
  site.set('/broken', { status: 500, body: 'oops' });
  assert.equal((await t.api('POST', '/v1/feeds', { json: { url: 'https://site.example/broken' } })).json.error.code, 'FETCH_FAILED');
  assert.equal((await t.api('POST', '/v1/feeds', { json: { url: 'https://site.example/missing' } })).status, 502);
  assert.equal((await t.api('POST', '/v1/feeds', { json: { url: 'https://site.example/blog', mode: 'often' } })).status, 400);
});

test('a check with an unchanged ETag costs no parsing; new entries in each mode become url items within the caps', async () => {
  let r = await t.api('POST', `/v1/feeds/${feedId}/check`, { json: {}, now: now0 + 120_000 });
  assert.equal(r.status, 200);
  assert.equal(r.json.new, 0);
  assert.equal((await t.api('POST', `/v1/feeds/${feedId}/check`, { json: {}, now: now0 + 130_000 })).status, 429, 'at most once a minute');
  site.set('/feed.xml', { etag: '"v2"', body: rss('Site &amp; Co', [
    { id: 'a' }, { id: 'b' }, { id: 'c', title: 'Story C', author: 'Ann' }, { id: 'd' }, { id: 'e' }, { id: 'lan', link: 'http://192.168.1.1/reboot' }, { id: 'f' },
  ]) });
  r = await t.api('POST', `/v1/feeds/${feedId}/check`, { json: {}, now: now0 + 200_000 });
  assert.equal(r.json.new, 5);
  const states = Object.fromEntries((await t.rows('SELECT key, url, state FROM entries WHERE feed_id = ? AND state != ?', feedId, 'baseline')).map((e) => [e.url ?? 'none', e.state]));
  assert.equal(states.none, 'digest', 'a LAN link is stored without its url and never sent as an item');
  assert.ok(!Object.keys(states).some((u) => u.includes('192.168')));
  await t.cron(now0 + 260_000); // 'each' step: up to the per-feed cap (3 in this test), the rest goes to the digest
  await t.cron(now0 + 320_000); // publish
  const items = await t.lane.poll();
  const urls = items.map((i) => i.header.url).sort();
  assert.equal(urls.length, 3);
  for (const it of items) {
    assert.equal(it.header.kind, 'url');
    assert.equal(it.header.from, 'Feed · Site & Co');
    assert.equal(it.raw['x-origin'], 'feed');
  }
  assert.ok(items.find((i) => i.header.title === 'Story C'));
  const after = (await t.rows('SELECT state, COUNT(*) AS n FROM entries WHERE feed_id = ? GROUP BY state', feedId));
  const by = Object.fromEntries(after.map((x) => [x.state, x.n]));
  assert.equal(by.sent, 3);
  assert.equal(by.digest, 2, 'over the cap: into the digest, plus the LAN entry');
  const list = (await t.api('GET', '/v1/feeds', { now: now0 + 330_000 })).json;
  assert.equal(list.feeds[0].sentToday, 3);
  assert.equal(list.digest.pending, 2);
});

async function addDigestFeed(path, title, ids, now) {
  site.set(path, { body: rss(title, []) });
  const r = await t.api('POST', '/v1/feeds', { json: { url: `https://other.example${path}`, mode: 'digest' }, now });
  assert.equal(r.status, 201, r.text);
  site.set(path, { body: rss(title, ids.map((id) => ({ id: `${path}-${id}`, title: `${title} ${id}`, link: `https://other.example${path}/${id}` }))) });
  return r.json.feed.id;
}

test('the digest at 07:00 in America/Los_Angeles across the DST change, once a day, never repeated', async () => {
  await t.db.prepare("UPDATE entries SET state = 'skipped' WHERE state = 'digest'").run();
  assert.equal((await t.api('PATCH', '/v1/settings', { json: { digest: { hour: 7, tz: 'America/Los_Angeles' } } })).status, 200);
  const d1 = Date.parse('2026-10-31T13:30:00Z'); // 06:30 PDT
  const id = await addDigestFeed('/la', 'LA Feed', [], d1 - 3600_000);
  site.set('/la', { body: rss('LA Feed', [1, 2, 3].map((n) => ({ id: `la-${n}`, title: `LA ${n}`, link: `https://other.example/la/${n}` }))) });
  assert.equal((await t.api('POST', `/v1/feeds/${id}/check`, { json: {}, now: d1 })).json.new, 3);
  const before = (await t.rows("SELECT id FROM outbox WHERE origin LIKE 'digest:%'")).length;
  await t.cron(d1); // 06:30 local: not yet
  assert.equal((await t.rows("SELECT id FROM outbox WHERE origin LIKE 'digest:%'")).length, before);
  await t.cron(Date.parse('2026-10-31T14:05:00Z')); // 07:05 PDT
  let digests = await t.rows("SELECT origin, title FROM outbox WHERE origin LIKE 'digest:%' ORDER BY seq");
  assert.equal(digests.length, before + 1);
  assert.equal(digests.at(-1).origin, 'digest:2026-10-31');
  assert.equal(digests.at(-1).title, 'Digest · Sat 31 Oct');
  await t.cron(Date.parse('2026-10-31T14:35:00Z')); // same hour: no repeat
  assert.equal((await t.rows("SELECT id FROM outbox WHERE origin LIKE 'digest:%'")).length, before + 1);
  // Clocks go back on Sunday 1 November: 07:05 PST is 15:05 UTC; 14:05 UTC is only 06:05 local.
  site.set('/la', { body: rss('LA Feed', [4, 5].map((n) => ({ id: `la-${n}`, title: `LA ${n}`, link: `https://other.example/la/${n}` }))) });
  await t.api('POST', `/v1/feeds/${id}/check`, { json: {}, now: Date.parse('2026-11-01T12:00:00Z') });
  await t.cron(Date.parse('2026-11-01T14:05:00Z'));
  assert.equal((await t.rows("SELECT id FROM outbox WHERE origin LIKE 'digest:%'")).length, before + 1, '06:05 PST: not yet');
  await t.cron(Date.parse('2026-11-01T15:05:00Z'));
  digests = await t.rows("SELECT origin FROM outbox WHERE origin LIKE 'digest:%' ORDER BY seq");
  assert.equal(digests.at(-1).origin, 'digest:2026-11-01');
  assert.equal(digests.length, before + 2);
  const states = (await t.rows("SELECT DISTINCT state FROM entries WHERE feed_id = ? AND state != 'baseline'", id)).map((r) => r.state);
  assert.deepEqual(states, ['digested'], 'digested entries never repeat');
});

test('Europe/Berlin across its DST change, and the digest page delivered to the Lab Inbox', async () => {
  assert.equal((await t.api('PATCH', '/v1/settings', { json: { digest: { hour: 7, tz: 'Europe/Berlin' } } })).status, 200);
  const id = await addDigestFeed('/be', 'Berlin Feed', [], Date.parse('2026-10-24T03:00:00Z'));
  site.set('/be', { body: rss('Berlin Feed', [{ id: 'be-1', title: 'Eins &amp;lt;b&amp;gt;', link: 'https://other.example/be/1' }]) });
  await t.api('POST', `/v1/feeds/${id}/check`, { json: {}, now: Date.parse('2026-10-24T04:00:00Z') });
  await t.cron(Date.parse('2026-10-24T05:05:00Z')); // 07:05 CEST
  site.set('/be', { body: rss('Berlin Feed', [{ id: 'be-2', title: 'Zwei', link: 'https://other.example/be/2' }]) });
  await t.api('POST', `/v1/feeds/${id}/check`, { json: {}, now: Date.parse('2026-10-25T03:00:00Z') });
  await t.cron(Date.parse('2026-10-25T05:05:00Z')); // 06:05 CET after the change: not yet
  await t.cron(Date.parse('2026-10-25T06:05:00Z')); // 07:05 CET
  const origins = (await t.rows("SELECT origin FROM outbox WHERE origin IN ('digest:2026-10-24', 'digest:2026-10-25')")).map((r) => r.origin).sort();
  assert.deepEqual(origins, ['digest:2026-10-24', 'digest:2026-10-25']);
  await t.cron(Date.now());
  await t.cron(Date.now() + 1000);
  const pages = (await t.lane.poll()).filter((i) => i.raw['x-origin'] === 'digest');
  const page = pages.find((p) => p.header.title === 'Digest · Sat 24 Oct');
  assert.ok(page, JSON.stringify(pages.map((p) => p.header.title)));
  const html = new TextDecoder().decode(page.content);
  assert.match(html, /<h1>Digest · Saturday 24 October<\/h1>/);
  assert.match(html, /Eins &lt;b&gt;/, 'a title that reads "<b>" stays text');
  assert.doesNotMatch(html, /<b>/);
  assert.match(page.header.url, /^https:\/\/daylight\.invalid\/i\/[0-9a-f]{32}$/);
  assert.equal(page.header.from, 'Digest');
});

test('digest overflow: at most digestMax articles, the rest skipped, never carried forward; "Send digest now"', async () => {
  const small = await setup({ web: new Map([['other.example', webHandler]]), knobs: { digestMax: 3 } });
  try {
    site.set('/many', { body: rss('Many', []) });
    const f = (await small.api('POST', '/v1/feeds', { json: { url: 'https://other.example/many', mode: 'digest' } })).json.feed;
    site.set('/many', { body: rss('Many', [1, 2, 3, 4, 5].map((n) => ({ id: `m-${n}`, link: `https://other.example/m/${n}` }))) });
    assert.equal((await small.api('POST', `/v1/feeds/${f.id}/check`, { json: {}, now: Date.now() + 120_000 })).json.new, 5);
    assert.equal((await small.api('POST', '/v1/digest/send', { json: {} })).status, 202);
    await small.cron(Date.now() + 180_000);
    const by = Object.fromEntries((await small.rows('SELECT state, COUNT(*) AS n FROM entries WHERE feed_id = ? GROUP BY state', f.id)).map((x) => [x.state, x.n]));
    assert.equal(by.digested, 3);
    assert.equal(by.skipped, 2);
    const [d] = await small.rows("SELECT origin FROM outbox WHERE origin LIKE 'digest:%'");
    assert.match(d.origin, /^digest:\d{4}-\d\d-\d\d:\d+$/, 'a digest sent on request has its own id');
    assert.equal((await small.api('GET', '/v1/feeds')).json.digest.pending, 0);
  } finally { await small.close(); }
});

test('a flooding feed: 20 new entries per check at most, paused after 3 floods; un-pausing clears FEED_FLOOD', async () => {
  let gen = 0;
  site.set('/flood', { body: () => rss('Flood', Array.from({ length: 100 }, (_, i) => ({ id: `fl-${gen}-${i}` }))) });
  const f = (await t.api('POST', '/v1/feeds', { json: { url: 'https://other.example/flood', mode: 'digest' }, now: now0 })).json.feed;
  for (let i = 1; i <= 3; i++) {
    gen++;
    const r = await t.api('POST', `/v1/feeds/${f.id}/check`, { json: {}, now: now0 + i * 120_000 });
    assert.equal(r.json.new, 20, `check ${i}`);
    assert.equal(r.json.feed.paused, i === 3);
  }
  const [row] = await t.rows('SELECT paused, last_error, floods FROM feeds WHERE id = ?', f.id);
  assert.deepEqual(row, { paused: 1, last_error: 'FEED_FLOOD', floods: 3 });
  assert.equal((await t.rows("SELECT COUNT(*) AS n FROM entries WHERE feed_id = ? AND state != 'baseline'", f.id))[0].n, 60);
  const un = await t.api('PATCH', `/v1/feeds/${f.id}`, { json: { paused: false, title: 'Renamed' } });
  assert.equal(un.json.feed.paused, false);
  assert.equal(un.json.feed.lastError, null);
  assert.equal(un.json.feed.title, 'Renamed');
  assert.equal((await t.api('DELETE', `/v1/feeds/${f.id}`)).status, 204);
  assert.equal((await t.rows('SELECT COUNT(*) AS n FROM entries WHERE feed_id = ?', f.id))[0].n, 0, 'its entries are dropped');
});

test('OPML import: validated on the first check, which records the baseline', async () => {
  site.set('/o1', { body: rss('O1', [{ id: 'o1-a' }]) });
  site.set('/o2', { body: rss('O2', [{ id: 'o2-a' }]) });
  const opml = `<?xml version="1.0"?><opml><body>
    <outline text="O1" xmlUrl="https://other.example/o1"/><outline text="O2" xmlUrl="https://other.example/o2"/>
    <outline text="LAN" xmlUrl="http://10.0.0.5/rss"/><outline text="dup" xmlUrl="https://site.example/feed.xml"/></body></opml>`;
  const r = await t.api('POST', '/v1/feeds/import?mode=each', { body: opml, headers: { 'Content-Type': 'text/x-opml' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.added.map((f) => f.url), ['https://other.example/o1', 'https://other.example/o2']);
  assert.deepEqual(r.json.skipped.map((s) => s.reason), ['URL_BLOCKED', 'FEED_EXISTS']);
  await t.cron(Date.now() + 10_000);
  const added = r.json.added.map((f) => f.id);
  const entries = await t.rows('SELECT state FROM entries WHERE feed_id IN (?, ?)', ...added);
  assert.ok(entries.length >= 2 && entries.every((e) => e.state === 'baseline'));
  assert.equal((await t.api('POST', '/v1/feeds/import', { body: 'x', headers: { 'Content-Type': 'image/png' } })).status, 415);
});
