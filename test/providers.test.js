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

/** Any OpenAI-shaped gateway: TokenRouter, OpenRouter, Groq, local Ollama. */
function openaiConfig(overrides = {}) {
  return resolveConfig({
    username: '3172',
    llm: {
      provider: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://api.tokenrouter.com/v1',
      model: 'z-ai/glm-5.3-free',
      ...overrides,
    },
  });
}

const stubStore = () => ({
  self: {}, pathfinder: {}, players: new Map(), recentChat: () => [], lastOutgoing: null,
});
const stubTrigger = { kind: 'mention', subject: 'Dream', channel: 'all', evidence: 'x' };

test('an openai-shaped gateway gets the standard chat-completions shape', async () => {
  const { OpenAICompatibleResponder } = await import('../src/llm/openai-compatible.js');
  const seen = {};
  const responder = new OpenAICompatibleResponder(openaiConfig(), {
    async fetchImpl(url, init) {
      seen.url = url;
      seen.init = init;
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: JSON.stringify({ respond: true, message: 'yh?', reason: 'called' }) }, finish_reason: 'stop' }] };
        },
      };
    },
  });

  const result = await responder.decide(stubStore(), stubTrigger, NOW);
  assert.equal(result.message, 'yh?');
  assert.equal(result.source, 'openai');
  assert.equal(seen.url, 'https://api.tokenrouter.com/v1/chat/completions');
  assert.equal(seen.init.headers.authorization, 'Bearer test-key');

  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'z-ai/glm-5.3-free');
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].role, 'user');
  assert.equal(body.response_format.type, 'json_schema');
});

test('a model that refuses a schema falls back to json_object, once', async () => {
  const { OpenAICompatibleResponder } = await import('../src/llm/openai-compatible.js');
  const formats = [];
  const responder = new OpenAICompatibleResponder(openaiConfig(), {
    async fetchImpl(url, init) {
      const format = JSON.parse(init.body).response_format.type;
      formats.push(format);
      if (format === 'json_schema') {
        return { ok: false, status: 400, async text() { return JSON.stringify({ error: { message: 'response_format json_schema is not supported' } }); } };
      }
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: '{"respond":true,"message":"ok","reason":"r"}' } }] };
        },
      };
    },
  });

  assert.equal((await responder.decide(stubStore(), stubTrigger, NOW)).message, 'ok');
  assert.deepEqual(formats, ['json_schema', 'json_object']);

  // It remembers, so the next reply does not waste a round trip.
  await responder.decide(stubStore(), stubTrigger, NOW);
  assert.deepEqual(formats, ['json_schema', 'json_object', 'json_object']);
});

test('a reasoning model\'s thinking is stripped before parsing', async () => {
  const { OpenAICompatibleResponder } = await import('../src/llm/openai-compatible.js');
  const responder = new OpenAICompatibleResponder(openaiConfig({ model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free' }), {
    async fetchImpl() {
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: '<think>They said my name. Keep it short.</think>\n{"respond":true,"message":"yh?","reason":"called"}' } }] };
        },
      };
    },
  });
  assert.equal((await responder.decide(stubStore(), stubTrigger, NOW)).message, 'yh?');
});

test('provider openai insists on a model, since the gateway decides', () => {
  assert.throws(
    () => resolveConfig({ username: '3172', llm: { provider: 'openai', apiKey: 'k' } }),
    /llm.model is required for provider "openai"/,
  );
});

test('the brain wires up the openai provider too', () => {
  const ai = createChatAI({
    username: '3172',
    llm: { provider: 'openai', apiKey: 'k', baseUrl: 'https://api.tokenrouter.com/v1', model: 'z-ai/glm-5.3-free' },
  });
  assert.equal(ai.responder.name, 'openai');
  assert.equal(ai.usingApi, true);
});

test('the key is chosen by gateway host, not by whichever env var is set first', async () => {
  const { OpenAICompatibleResponder } = await import('../src/llm/openai-compatible.js');
  const saved = { ...process.env };
  process.env.OPENAI_API_KEY = 'openai-key';
  process.env.TOKENROUTER_API_KEY = 'tokenrouter-key';
  process.env.OPENROUTER_API_KEY = 'openrouter-key';
  try {
    const at = (baseUrl) =>
      new OpenAICompatibleResponder(
        resolveConfig({ username: '3172', llm: { provider: 'openai', baseUrl, model: 'm' } }),
      ).apiKey;

    assert.equal(at('https://api.tokenrouter.com/v1'), 'tokenrouter-key');
    assert.equal(at('https://openrouter.ai/api/v1'), 'openrouter-key');
    assert.equal(at('https://api.openai.com/v1'), 'openai-key');
    // An unrecognised host — a local Ollama, say — takes whatever there is.
    assert.equal(at('http://127.0.0.1:11434/v1'), 'openai-key');
  } finally {
    process.env = saved;
  }
});

test('an explicit apiKey still wins over anything in the environment', async () => {
  const { OpenAICompatibleResponder } = await import('../src/llm/openai-compatible.js');
  const saved = { ...process.env };
  process.env.TOKENROUTER_API_KEY = 'tokenrouter-key';
  try {
    assert.equal(new OpenAICompatibleResponder(openaiConfig({ apiKey: 'explicit' })).apiKey, 'explicit');
  } finally {
    process.env = saved;
  }
});
