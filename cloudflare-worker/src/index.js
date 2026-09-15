const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The shape the sandbox expects back, in Gemini's OpenAPI dialect: upper-case
 * types, and additionalProperties is not part of it.
 *
 * Without this, responseMimeType alone only promises *some* JSON — not JSON
 * with these three fields in it.
 */
const REPLY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    respond: { type: 'BOOLEAN' },
    message: { type: 'STRING' },
    reason: { type: 'STRING' },
  },
  required: ['respond', 'message', 'reason'],
};

/** The same contract in the JSON Schema dialect every OpenAI-shaped gateway wants. */
const REPLY_SCHEMA_JSON = {
  type: 'object',
  properties: {
    respond: { type: 'boolean' },
    message: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['respond', 'message', 'reason'],
  additionalProperties: false,
};

/** Reasoning models put their working in the reply. Chat wants the answer. */
const THINK_BLOCK = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi;

/**
 * The gateway key, under whichever name it was stored. "openai" here is the
 * wire format, not the vendor, so the key usually belongs to TokenRouter or
 * OpenRouter and is named after them.
 */
function gatewayKey(env) {
  const key = env.TOKENROUTER_API_KEY || env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || '';
  // Trimmed because a key pasted into a repo secret often carries a trailing
  // newline, and the gateway rejects that as "Invalid token" — which reads as
  // a wrong key rather than a whitespace problem.
  return key.trim();
}

/**
 * Which upstream to call. Explicit LLM_PROVIDER wins; otherwise whichever key
 * is configured, preferring Gemini so an existing deploy keeps behaving the
 * same after this change.
 */
function pickProvider(env) {
  const explicit = (env.LLM_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'gemini' || explicit === 'openai') return explicit;
  if (env.GEMINI_API_KEY) return 'gemini';
  if (gatewayKey(env)) return 'openai';
  return 'gemini';
}

function keyFor(env, provider) {
  return provider === 'openai' ? gatewayKey(env) : env.GEMINI_API_KEY;
}

function modelFor(env, provider) {
  return provider === 'openai'
    ? env.OPENAI_MODEL || 'z-ai/glm-5.3-free'
    : env.GEMINI_MODEL || 'gemini-3.6-flash';
}

/** Keeps the API key on Cloudflare; the static site sends only a prompt. */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(origin, env.ALLOWED_ORIGIN);
    const url = new URL(request.url);
    const provider = pickProvider(env);
    const key = keyFor(env, provider);
    const model = modelFor(env, provider);

    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method === 'GET' && url.pathname === '/health') {
      // The model and provider are in here because the commonest failure is a
      // deploy pointing at something other than what you think it is.
      return json({ ok: true, keyConfigured: Boolean(key), provider, model }, 200, headers);
    }
    if (request.method !== 'POST' || url.pathname !== '/api/reply') {
      return json({ error: 'not found' }, 404, headers);
    }
    if (!key) {
      const name = provider === 'openai' ? 'TOKENROUTER_API_KEY' : 'GEMINI_API_KEY';
      return json({ error: `server is missing ${name}` }, 500, headers);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'body must be JSON' }, 400, headers);
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt || prompt.length > 12_000) {
      return json({ error: 'prompt must be between 1 and 12000 characters' }, 400, headers);
    }

    try {
      const reply = provider === 'openai'
        ? await replyFromOpenAI(env, model, key, prompt)
        : await replyFromGemini(env, model, key, prompt);
      return json(reply, 200, headers);
    } catch (error) {
      // The upstream's own message names the real problem — a retired model, a
      // bad key, quota — and contains no secret, so pass it through. A generic
      // 502 costs an hour of guessing.
      console.error('upstream failed:', error.message);
      return json({ error: error.message }, 502, headers);
    }
  },
};

async function replyFromGemini(env, model, key, prompt) {
  // Flash models think by default and those tokens come out of
  // maxOutputTokens, so without this a small cap returns an empty candidate
  // with finishReason MAX_TOKENS. A one-line chat reply does not need
  // thinking, and turning it off is faster and cheaper. Support for the
  // field varies by model generation, hence the retry.
  let response = await callGemini(model, key, prompt, { thinkingBudget: 0 });
  if (!response.ok) {
    const detail = await errorMessage(response);
    if (response.status === 400 && /thinking/i.test(detail)) {
      console.warn(`${model} rejected thinkingConfig, retrying without it`);
      response = await callGemini(model, key, prompt, null);
    } else {
      throw new Error(`Gemini ${response.status}: ${detail}`);
    }
  }
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${await errorMessage(response)}`);

  const gemini = await response.json();
  const candidate = gemini.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text || '').join('') || '';
  if (!text) throw new Error(`Gemini returned nothing (${candidate?.finishReason || 'no candidate'})`);

  const reply = parseReply(text);
  if (!reply) throw new Error('Gemini returned unparseable JSON');
  return reply;
}

async function replyFromOpenAI(env, model, key, prompt) {
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.tokenrouter.com/v1').replace(/\/$/, '');

  // Structured-output support varies wildly between models behind these
  // gateways. A model that rejects the schema usually still honours
  // json_object, so drop to that once rather than failing the reply.
  let response = await callOpenAI(baseUrl, model, key, prompt, true);
  if (!response.ok && response.status === 400) {
    const detail = await errorMessage(response);
    if (/schema|response_format|json/i.test(detail)) {
      console.warn(`${model} rejected json_schema, retrying as json_object`);
      response = await callOpenAI(baseUrl, model, key, prompt, false);
    } else {
      throw new Error(`${model} 400: ${detail}`);
    }
  }
  if (!response.ok) throw new Error(`${model} ${response.status}: ${await errorMessage(response)}`);

  const completion = await response.json();
  const choice = completion.choices?.[0];
  const text = choice?.message?.content || '';
  if (!text) throw new Error(`${model} returned nothing (${choice?.finish_reason || 'no choice'})`);

  const reply = parseReply(text.replace(THINK_BLOCK, '').trim());
  if (!reply) throw new Error(`${model} returned unparseable JSON`);
  return reply;
}

function callGemini(model, key, prompt, thinkingConfig) {
  const generationConfig = {
    maxOutputTokens: 800,
    responseMimeType: 'application/json',
    responseSchema: REPLY_SCHEMA,
  };
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;

  return fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });
}

function callOpenAI(baseUrl, model, key, prompt, withSchema) {
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
      response_format: withSchema
        ? { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: REPLY_SCHEMA_JSON } }
        : { type: 'json_object' },
    }),
  });
}

async function errorMessage(response) {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw);
    return parsed.error?.message ?? parsed.message ?? raw.slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

function parseReply(text) {
  const parsed = parseJson(text);
  if (!parsed) return null;
  return {
    respond: Boolean(parsed.respond),
    message: String(parsed.message || ''),
    reason: String(parsed.reason || ''),
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Some models wrap the object in prose or a code fence even when asked not to.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function corsHeaders(origin, allowedOrigin) {
  // CORS blocks other browser origins from reading replies; it is not authentication.
  return {
    'access-control-allow-origin': allowedOrigin || origin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json; charset=utf-8',
    vary: 'Origin',
  };
}

function json(value, status, headers) {
  return new Response(JSON.stringify(value), { status, headers });
}
