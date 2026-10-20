// Unit tests (Node) for the Claude request (DESIGN.md 9.3, 9.4) with the official SDK and a mocked Claude API:
// the exact request on the wire, response reading (refusal, max_tokens, fallback), cost and every error mapping.
import './testing-global.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { buildParams, countParams, inputChars, makeClient, mapClaudeError, readResponse, costMicros, reserveMicros, SUMMARY_SCHEMA, MODEL, FALLBACK_BETA } from '../src/claude.ts';
import { mockClaude, messageBody, apiError } from './mock-claude.mjs';

const BASE = 'https://claude.test';
const input = (op, extra = {}) => ({ op, mode: 'both', length: 'medium', lang: 'auto', ...extra });
const textDoc = { kind: 'text', text: 'The document text.', title: 'Doc' };

function client(claude, timeout = 10_000) {
  return makeClient('sk-ant-test', (u, i) => claude.handle(u, i), timeout, BASE);
}

test('summary: the exact request (model, beta, fallbacks, effort, structured output, document first, no thinking/tools/prefill)', async () => {
  const claude = mockClaude();
  const params = buildParams(input('summary'), textDoc);
  const res = await client(claude).beta.messages.create(params);
  const [req] = claude.messageRequests();
  assert.equal(req.query, '?beta=true');
  assert.equal(req.headers['anthropic-beta'], FALLBACK_BETA);
  assert.equal(req.headers['x-api-key'], 'sk-ant-test');
  const b = req.body;
  assert.equal(b.model, 'claude-opus-5-5');
  assert.equal(MODEL, 'claude-opus-5-5');
  assert.equal(b.max_tokens, 16000);
  assert.equal(b.fallbacks, 'default');
  assert.equal(b.betas, undefined, 'betas travel as the header, not in the body');
  assert.deepEqual(b.output_config, { effort: 'medium', format: { type: 'json_schema', schema: SUMMARY_SCHEMA } });
  assert.equal(b.thinking, undefined);
  assert.equal(b.tools, undefined);
  assert.equal(b.tool_choice, undefined);
  assert.equal(b.temperature, undefined);
  assert.match(b.system, /untrusted content/);
  assert.match(b.system, /e-paper tablet/);
  assert.equal(b.messages.length, 1);
  assert.equal(b.messages.at(-1).role, 'user', 'no assistant prefill');
  const [doc, instruction] = b.messages[0].content;
  assert.deepEqual(doc, { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'The document text.' }, title: 'Doc' });
  assert.equal(instruction.type, 'text');
  assert.match(instruction.text, /about 250 words, then list 5–8 key points\. Write in the document’s language\./);
  const out = readResponse('summary', res);
  assert.deepEqual(out.result.keyPoints, ['One', 'Two <b>', 'Three']);
  assert.equal(out.result.title, 'A Mock Title');
  assert.equal(out.fallback, false);
  assert.equal(out.model, 'claude-opus-5-5');
});

test('explain is low effort without a format; ask sends history as user/assistant turns, cached document, ending with the user', () => {
  const ex = buildParams(input('explain', { passage: 'p', question: 'why?', lang: 'de' }), null);
  assert.deepEqual(ex.output_config, { effort: 'low' });
  assert.equal(ex.messages[0].content.length, 1);
  assert.match(ex.messages[0].content[0].text, /<passage>\np\n<\/passage>[\s\S]*why\?[\s\S]*"de"/);
  const ask = buildParams(input('ask', { question: 'Q3', history: [{ q: 'Q1', a: 'A1' }, { q: 'Q2', a: 'A2' }] }), textDoc);
  assert.deepEqual(ask.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.deepEqual(ask.messages[0].content[0].cache_control, { type: 'ephemeral' });
  assert.equal(ask.messages[0].content[1].text, 'Q1');
  assert.equal(ask.messages[1].content, 'A1');
  assert.match(ask.messages[4].content[0].text, /^Q3/);
  assert.deepEqual(ask.output_config, { effort: 'medium' });
  const pdf = buildParams(input('summary', { mode: 'keypoints', length: 'short' }), { kind: 'pdf', placeholder: 'dls-src:abc:def', title: 'Paper' });
  assert.deepEqual(pdf.messages[0].content[0].source, { type: 'base64', media_type: 'application/pdf', data: 'dls-src:abc:def' });
  assert.match(pdf.messages[0].content[1].text, /Set summary to an empty string/);
  const cp = countParams(pdf);
  assert.equal(cp.fallbacks, undefined);
  assert.equal(cp.max_tokens, undefined);
  assert.equal(cp.model, MODEL);
  assert.ok(inputChars(ask) > 'Q1A1Q2A2Q3The document text.'.length);
});

test('reading responses: refusal first, then max_tokens; the fallback signal comes from usage.iterations', () => {
  assert.throws(() => readResponse('summary', messageBody({ stop_reason: 'refusal', text: null })), (e) => e.code === 'AI_REFUSED' && e.status === 422);
  assert.throws(() => readResponse('explain', messageBody({ stop_reason: 'max_tokens', text: 'partial' })), (e) => e.code === 'AI_INCOMPLETE');
  const fb = messageBody({ text: 'ok', model: 'claude-opus-5', iterations: [{ type: 'message', model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }] });
  const r = readResponse('ask', fb);
  assert.equal(r.fallback, true);
  assert.equal(r.model, 'claude-opus-5');
  assert.equal(r.result.answer, 'ok');
  // Opus 5.5 rates for the declined hop ($4/MTok in), the fallback's own rates for the rest ($5 in, $25 out).
  assert.equal(costMicros(fb).micros, 100 * 4 + 100 * 5 + 50 * 25);
  assert.equal(costMicros(messageBody({ usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 200 } })).micros,
    Math.ceil(1000 * 4 + 100 * 20 + 500 * 0.2 + 200 * 5));
  assert.equal(reserveMicros(200_000), 1_000_000 + 400_000, 'worst case for 200k input: $1.40');
});

async function errorFor(reply, timeout) {
  const claude = mockClaude().next(reply);
  try { await client(claude, timeout).beta.messages.create(buildParams(input('summary'), textDoc)); } catch (e) { return { e, claude }; }
  throw new Error('no error');
}

test('typed SDK errors map to server answers, by class (9.4)', async () => {
  const cases = [
    [apiError(401, 'authentication_error'), 'AI_KEY_INVALID', 503, 'released', 'AI_KEY_INVALID'],
    [apiError(403, 'permission_error'), 'AI_KEY_INVALID', 503, 'released', 'AI_KEY_INVALID'],
    [apiError(429, 'rate_limit_error', 'slow down', { 'retry-after': '17' }), 'AI_BUSY', 503, 'released', undefined],
    [apiError(529, 'overloaded_error'), 'AI_BUSY', 503, 'released', undefined],
    [apiError(500, 'api_error'), 'AI_BUSY', 503, 'released', undefined],
    [apiError(400, 'invalid_request_error', 'The PDF is unreadable'), 'AI_BAD_INPUT', 422, 'released', undefined],
    [apiError(402, 'billing_error'), 'AI_BILLING', 503, 'released', 'AI_BILLING'],
    [apiError(413, 'request_too_large'), 'AI_TOO_LARGE', 413, 'released', undefined],
  ];
  for (const [reply, code, status, reservation, record] of cases) {
    const { e } = await errorFor(reply);
    assert.ok(e instanceof Anthropic.APIError, `${code} comes from the SDK`);
    const m = mapClaudeError(e);
    assert.equal(m.error.code, code, `${reply.status} -> ${code}`);
    assert.equal(m.error.status, status);
    assert.equal(m.reservation, reservation);
    assert.equal(m.record, record);
  }
  const { e: rl } = await errorFor(apiError(429, 'rate_limit_error', 'x', { 'retry-after': '17' }));
  assert.equal(mapClaudeError(rl).error.extra.retryAfter, 17);
  const { e: ov } = await errorFor(apiError(529, 'overloaded_error'));
  assert.equal(mapClaudeError(ov).error.extra.retryAfter, 30, 'default retryAfter');
});

test('a timeout keeps the reservation; a connection error too; the client never retries', async () => {
  const { e, claude } = await errorFor({ delayMs: 1500 }, 200);
  assert.ok(e instanceof Anthropic.APIConnectionTimeoutError);
  const m = mapClaudeError(e);
  assert.equal(m.error.code, 'AI_TIMEOUT');
  assert.equal(m.error.status, 504);
  assert.equal(m.reservation, 'kept');
  assert.equal(claude.messageRequests().length, 1, 'maxRetries is 0');
  const broken = makeClient('k', async () => { throw new TypeError('fetch failed'); }, 5000, BASE);
  let err;
  try { await broken.beta.messages.create(buildParams(input('summary'), textDoc)); } catch (x) { err = x; }
  assert.ok(err instanceof Anthropic.APIConnectionError);
  assert.equal(mapClaudeError(err).error.code, 'AI_BUSY');
  assert.equal(mapClaudeError(err).reservation, 'kept');
  assert.equal(mapClaudeError(new Error('anything else')).error.code, 'SERVER_ERROR');
});

test('countTokens goes to the beta count endpoint with the same model, system and messages', async () => {
  const claude = mockClaude({ countTokens: () => 123_456 });
  const p = buildParams(input('summary'), textDoc);
  const r = await client(claude).beta.messages.countTokens(countParams(p));
  assert.equal(r.input_tokens, 123_456);
  const [req] = claude.countRequests();
  assert.equal(req.body.model, MODEL);
  assert.deepEqual(req.body.messages, p.messages);
  assert.equal(req.body.system, p.system);
});
