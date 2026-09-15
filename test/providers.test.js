import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../src/config.js';
import { GeminiResponder } from '../src/llm/gemini.js';
import { createChatAI } from '../src/index.js';

const NOW = 1_700_000_000_000;

function geminiConfig(overrides = {}) {
  return resolveConfig({
    username: '3172',
    llm: { provider: 'gemini', apiKey: 'test-key', ...overrides },
  });
}

test('each provider gets its own default model', () => {
  assert.equal(resolveConfig({ username: '3172' }).llm.model, 'claude-opus-5');
  assert.equal(geminiConfig().llm.model, 'gemini-3.6-flash');
  assert.equal(geminiConfig({ model: 'gemini-2.5-pro' }).llm.model, 'gemini-2.5-pro');
});

test('an unknown provider is rejected at config time', () => {
  assert.throws(
    () => resolveConfig({ username: '3172', llm: { provider: 'gpt' } }),
    /unknown llm.provider/,
  );
});

test('gemini sends the prompt, the schema and the key in the shapes it expects', async () => {
  const seen = {};
  const responder = new GeminiResponder(geminiConfig(), {
    async fetchImpl(url, init) {
      seen.url = url;
      seen.init = init;
      return {
        ok: true,
        async json() {
          return {
            candidates: [{
              content: { parts: [{ text: JSON.stringify({ respond: true, message: 'yh?', reason: 'called' }) }] },
              finishReason: 'STOP',
            }],
          };
        },
      };
    },
  });

  const store = { self: {}, pathfinder: {}, players: new Map(), recentChat: () => [], lastOutgoing: null };
  const result = await responder.decide(store, { kind: 'mention', subject: 'Dream', channel: 'all', evidence: 'x' }, NOW);

  assert.equal(result.message, 'yh?');
  assert.equal(result.source, 'gemini');
  assert.match(seen.url, /gemini-3\.6-flash:generateContent$/);
  assert.equal(seen.init.headers['x-goog-api-key'], 'test-key');

  const body = JSON.parse(seen.init.body);
  assert.ok(body.systemInstruction.parts[0].text.includes('3172'));
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseSchema.type, 'OBJECT', 'gemini wants upper-case types');
  assert.equal(body.generationConfig.responseSchema.properties.respond.type, 'BOOLEAN');
  assert.ok(!('additionalProperties' in body.generationConfig.responseSchema), 'not part of the dialect');
});

test('a gemini error surfaces rather than being swallowed', async () => {
  const responder = new GeminiResponder(geminiConfig(), {
    async fetchImpl() {
      return { ok: false, status: 429, async text() { return 'quota exceeded'; } };
    },
  });
  const store = { self: {}, pathfinder: {}, players: new Map(), recentChat: () => [], lastOutgoing: null };
  await assert.rejects(
    () => responder.decide(store, { kind: 'mention', subject: 'D', channel: 'all', evidence: 'x' }, NOW),
    /Gemini 429/,
  );
});

test('without a key gemini reports itself unavailable instead of throwing at startup', () => {
  const responder = new GeminiResponder(
    resolveConfig({ username: '3172', llm: { provider: 'gemini' } }, {}),
  );
  assert.equal(responder.available, false);
  assert.equal(responder.client, null);
});

test('the brain wires up whichever provider is configured', () => {
  const claude = createChatAI({ username: '3172', client: { messages: { create: async () => ({}) } } });
  assert.equal(claude.responder.name ?? 'claude', 'claude');

  const gemini = createChatAI({ username: '3172', llm: { provider: 'gemini', apiKey: 'k' } });
  assert.equal(gemini.responder.name, 'gemini');
  assert.equal(gemini.usingApi, true);
});

test('resolving one config never leaks into the next', () => {
  // A Claude config fills in its default model. If that write lands in the
  // shared defaults, every later config inherits it.
  const first = resolveConfig({ username: '3172' });
  assert.equal(first.llm.model, 'claude-opus-5');

  const second = resolveConfig({ username: '3172', llm: { provider: 'gemini' } });
  assert.equal(second.llm.model, 'gemini-3.6-flash');

  const third = resolveConfig({ username: '3172' });
  assert.equal(third.llm.model, 'claude-opus-5');

  // Same for anything else nested and mutable.
  first.limits.maxPerMinute = 999;
  assert.notEqual(resolveConfig({ username: '3172' }).limits.maxPerMinute, 999);
});

test('a model left over from another provider is corrected, not sent', () => {
  // Flipping provider by env while config.json still names a Claude model.
  const config = resolveConfig(
    { username: '3172', llm: { model: 'claude-opus-5' } },
    { MCCHAT_PROVIDER: 'gemini' },
  );
  assert.equal(config.llm.provider, 'gemini');
  assert.equal(config.llm.model, 'gemini-3.6-flash');
  assert.equal(config.llm.correctedModel, 'claude-opus-5', 'and it says what it changed');
});

test('an unfamiliar model id is left alone', () => {
  const config = resolveConfig({
    username: '3172',
    llm: { provider: 'gemini', model: 'my-proxy/some-model' },
  });
  assert.equal(config.llm.model, 'my-proxy/some-model');
  assert.equal(config.llm.correctedModel, undefined);
});

test('a matching model is untouched', () => {
  const config = resolveConfig({ username: '3172', llm: { provider: 'gemini', model: 'gemini-2.5-pro' } });
  assert.equal(config.llm.model, 'gemini-2.5-pro');
});
