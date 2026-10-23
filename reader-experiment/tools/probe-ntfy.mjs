// Measures how the real relay behaves where the Daylight Share protocol depends on it (run from CI; ntfy.sh only
// answers from the open internet). Prints one JSON line per probe and a summary. Uses fresh random topics.
//   node reader-experiment/tools/probe-ntfy.mjs [relay]
import { randomBytes } from 'node:crypto';

const relay = (process.argv[2] || 'https://ntfy.sh').replace(/\/+$/, '');
const topic = () => 'dls-probe-' + randomBytes(10).toString('hex');
const results = {};
const out = (name, data) => { results[name] = data; console.log(JSON.stringify({ probe: name, ...data })); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { Firebase: 'no', Cache: 'yes' };

async function put(t, bytes, extra = {}) {
  const t0 = Date.now();
  const r = await fetch(`${relay}/${t}`, { method: 'PUT', headers: { ...H, Filename: 'p.bin', Message: 'probe', ...extra }, body: bytes });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, ms: Date.now() - t0, code: j?.code ?? null, error: j?.error ?? null, id: j?.id ?? null, time: j?.time ?? null,
    attachment: j?.attachment ? { size: j.attachment.size, expires: j.attachment.expires, url: j.attachment.url } : null, body: j ? undefined : text.slice(0, 200) };
}
async function post(t, text) {
  const r = await fetch(`${relay}/${t}`, { method: 'POST', headers: { ...H, 'Content-Type': 'text/plain' }, body: text });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, id: j.id, time: j.time, attachment: !!j.attachment };
}
async function poll(t, since) {
  const r = await fetch(`${relay}/${t}/json?poll=1&since=${encodeURIComponent(since)}`);
  const text = await r.text();
  const msgs = text.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.event === 'message');
  return { status: r.status, truncated: r.headers.get('x-messages-truncated'), ids: msgs.map((m) => m.id), times: msgs.map((m) => m.time) };
}

// 1. The attachment size limit, exactly.
{
  const rows = [];
  for (const n of [1_900_000, 2_000_000, 2_000_001, 2_097_152, 2_097_153]) rows.push({ size: n, ...(await put(topic(), randomBytes(n))) });
  out('attachment-size-limit', { rows: rows.map(({ size, status, code, error }) => ({ size, status, code, error })) });
}

// 2. What a short message body becomes at 4096 and 4097 bytes.
{
  const t = topic();
  const a = await post(t, 'x'.repeat(4096)), b = await post(t, 'x'.repeat(4097));
  out('message-size', { at4096: a, at4097: b });
}

// 3. Since semantics: time inclusive?, unknown id, known id.
{
  const t = topic();
  const a = await post(t, 'A'); await sleep(1500);
  const b = await post(t, 'B'); await sleep(1500);
  out('since', {
    a, b,
    sinceAll: await poll(t, 'all'),
    sinceTimeOfA: await poll(t, String(a.time)),
    sinceTimeOfAplus1: await poll(t, String(a.time + 1)),
    sinceIdOfA: await poll(t, a.id),
    sinceUnknownId: await poll(t, 'AAAAAAAAAAAA'),
    sinceZero: await poll(t, '0'),
  });
}

// 4. When an attachment's "time" is stamped: a slow 1.5 MB upload with a small message published in the middle.
{
  const t = topic();
  const chunk = randomBytes(150_000);
  let i = 0;
  const body = new ReadableStream({ async pull(c) { if (i++ >= 10) return c.close(); await sleep(1000); c.enqueue(chunk); } });
  const started = Math.floor(Date.now() / 1000);
  const slow = fetch(`${relay}/${t}`, { method: 'PUT', duplex: 'half', headers: { ...H, Filename: 'slow.bin', Message: 'slow', 'Content-Length': String(1_500_000) }, body })
    .then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
  await sleep(3000);
  const quick = await post(t, 'quick, published during the slow upload');
  const s = await slow;
  const finished = Math.floor(Date.now() / 1000);
  out('attachment-time', { uploadStarted: started, uploadFinished: finished, slowStatus: s.status, slowTime: s.time, quickTime: quick.time,
    pollOrder: (await poll(t, 'all')).ids.map((id) => (id === s.id ? 'slow' : id === quick.id ? 'quick' : id)) });
}

// 4b. A multi-topic poll, /{a},{b}/json?poll=1&since=… (LAB-PLAN 4.1.1, L2): does one `since` time cursor answer for
// both topics, in what order, and does each line say its topic? The return lane's devices read the shared return topic
// and their own in one request only if it does. Messages: A1 on a, B1 on b, A2 on a, B2 (an attachment) on b, ~1.5 s
// apart, so their times differ. It runs before the visitor-total probe (5), which fills this runner's 20 MB.
{
  const a = topic(), b = topic();
  const name = (t) => (t === a ? 'a' : t === b ? 'b' : t);
  const a1 = await post(a, 'A1'); await sleep(1500);
  const b1 = await post(b, 'B1'); await sleep(1500);
  const a2 = await post(a, 'A2'); await sleep(1500);
  const b2 = await put(b, randomBytes(5000));
  await sleep(1500);
  const pollBoth = async (since) => {
    const r = await fetch(`${relay}/${a},${b}/json?poll=1&since=${encodeURIComponent(since)}`);
    const text = await r.text();
    const msgs = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((m) => m?.event === 'message');
    const label = (m) => (m.id === a1.id ? 'A1' : m.id === b1.id ? 'B1' : m.id === a2.id ? 'A2' : m.id === b2.id ? 'B2' : m.id);
    return { status: r.status, order: msgs.map(label), topics: msgs.map((m) => name(m.topic)), times: msgs.map((m) => m.time),
      attachmentUrl: msgs.filter((m) => m.attachment).map((m) => (m.attachment.url ?? '').startsWith('https://')) };
  };
  const times = { A1: a1.time, B1: b1.time, A2: a2.time, B2: b2.time };
  const sinceAll = await pollBoth('all');
  const sinceTimeB1 = await pollBoth(String(b1.time));
  const sinceTimeA2 = await pollBoth(String(a2.time));
  const sinceAfterB2 = await pollBoth(String(b2.time + 1));
  const sinceIdB1 = await pollBoth(b1.id);
  const sinceIdA1 = await pollBoth(a1.id);
  // One time cursor works when `since=t` filters both topics by time (inclusive) and every line names its topic.
  const want = (since) => Object.entries(times).filter(([, t]) => t !== null && t >= since).map(([k]) => k).sort();
  const oneTimeCursor = sinceAll.status === 200 && b2.status === 200 && sinceAll.order.slice().sort().join() === 'A1,A2,B1,B2'
    && sinceTimeB1.order.slice().sort().join() === want(b1.time).join()
    && sinceTimeA2.order.slice().sort().join() === want(a2.time).join()
    && sinceAfterB2.order.length === 0
    && sinceAll.topics.every((t) => t === 'a' || t === 'b');
  out('multi-topic-poll', { b2Status: b2.status, times, sinceAll, sinceTimeB1, sinceTimeA2, sinceAfterB2, sinceIdB1, sinceIdA1,
    orderedByTime: sinceAll.times.every((t, i) => i === 0 || sinceAll.times[i - 1] <= t), oneTimeCursor });
}

// 5. The per-visitor attachment total: keep uploading 1.9 MB until the relay refuses (stop at 14 = 26.6 MB).
{
  const rows = [];
  let total = 0;
  for (let k = 0; k < 14; k++) {
    const r = await put(topic(), randomBytes(1_900_000));
    rows.push({ k, status: r.status, code: r.code, error: r.error });
    if (r.status >= 300) break;
    total += 1_900_000;
  }
  out('visitor-total', { acceptedBytesThisProbe: total, rows });
}

// 6. CORS preflight for a browser PUT with every header we send (and Authorization, for relay tokens).
{
  const r = await fetch(`${relay}/${topic()}`, { method: 'OPTIONS', headers: { Origin: 'https://example.github.io', 'Access-Control-Request-Method': 'PUT',
    'Access-Control-Request-Headers': 'authorization,filename,message,firebase,cache,content-type' } });
  out('cors', { status: r.status, allowOrigin: r.headers.get('access-control-allow-origin'), allowHeaders: r.headers.get('access-control-allow-headers'), allowMethods: r.headers.get('access-control-allow-methods') });
}

// 7. Rate-limit headers, if any, on a normal request.
{
  const r = await fetch(`${relay}/v1/health`);
  const h = {}; for (const [k, v] of r.headers) if (/rate|limit|retry/i.test(k)) h[k] = v;
  out('headers', { status: r.status, rateHeaders: h });
}

console.log('SUMMARY ' + JSON.stringify(results));
