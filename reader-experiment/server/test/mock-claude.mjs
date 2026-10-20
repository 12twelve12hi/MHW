// A stand-in for the Claude API (Messages and count_tokens), for tests. It records every request (headers and the parsed
// body, or the raw body when it does not parse) and answers from a queue of scripted replies, else with a default.
//
// const claude = mockClaude(); claude.handle(request) -> Response
// claude.next({status, body, headers, delayMs, stop_reason, text, usage, model, iterations})   queue one reply
// claude.requests  [{path, headers, body, raw}]

export function messageBody({ text = 'OK', stop_reason = 'end_turn', model = 'claude-opus-5-5', usage, iterations } = {}) {
  return {
    id: 'msg_mock', type: 'message', role: 'assistant', model, stop_reason, stop_sequence: null,
    content: text === null ? [] : [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text }],
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...(usage ?? {}), iterations: iterations ?? null },
  };
}

export function apiError(status, type, message = 'mock error', headers = {}) {
  return { status, body: { type: 'error', error: { type, message } }, headers };
}

function defaultCount(body, raw) {
  // About 4 characters per token for text; a PDF's base64 counts far less (pages, not bytes).
  let pdf = 0;
  for (const m of body?.messages ?? []) for (const b of Array.isArray(m.content) ? m.content : []) if (b?.source?.type === 'base64') pdf += b.source.data.length;
  return Math.ceil((raw.length - pdf) / 4 + pdf / 300);
}

export function mockClaude({ countTokens = defaultCount } = {}) {
  const queue = [];
  const requests = [];
  const self = {
    requests,
    next(reply) { queue.push(reply); return self; },
    clear() { queue.length = 0; requests.length = 0; },
    messageRequests: () => requests.filter((r) => r.path === '/v1/messages'),
    countRequests: () => requests.filter((r) => r.path === '/v1/messages/count_tokens'),
    async handle(input, init) {
      const req = typeof input === 'string' || input instanceof URL ? new Request(input, init) : input;
      const url = new URL(req.url);
      const raw = await req.text();
      let body = null;
      try { body = JSON.parse(raw); } catch { body = null; }
      const headers = Object.fromEntries(req.headers);
      requests.push({ path: url.pathname, query: url.search, headers, body, raw });
      if (url.pathname === '/v1/messages/count_tokens') {
        return Response.json({ input_tokens: countTokens(body, raw) });
      }
      if (url.pathname !== '/v1/messages') return Response.json({ type: 'error', error: { type: 'not_found_error', message: 'no' } }, { status: 404 });
      const r = queue.shift() ?? {};
      if (r.delayMs) {
        await new Promise((res, rej) => {
          const t = setTimeout(res, r.delayMs);
          const sig = init?.signal ?? req.signal;
          sig?.addEventListener?.('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); });
        });
      }
      if (r.status && r.status !== 200) {
        return new Response(JSON.stringify(r.body ?? { type: 'error', error: { type: 'api_error', message: 'mock' } }), {
          status: r.status, headers: { 'Content-Type': 'application/json', 'request-id': 'req_mock', ...(r.headers ?? {}) },
        });
      }
      let text = r.text;
      if (text === undefined) {
        text = body?.output_config?.format
          ? JSON.stringify({ title: 'A Mock Title', summary: 'First paragraph.\n\nSecond **bold** paragraph.', key_points: ['One', 'Two <b>', 'Three'], language: 'en' })
          : 'A *mock* answer.\n\n- point one\n- point two';
      }
      return Response.json(r.body ?? messageBody({ ...r, text }), { headers: { 'request-id': 'req_mock' } });
    },
  };
  return self;
}
