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
 * wire format, not the vendor, so the key usually belongs to OpenRouter or a
 * similar gateway and is named after it.
 */
const GATEWAY_KEY_NAMES = ['OPENROUTER_API_KEY', 'TOKENROUTER_API_KEY', 'OPENAI_API_KEY'];

function gatewayKeyName(env) {
  return GATEWAY_KEY_NAMES.find((name) => (env[name] || '').trim());
}

function gatewayKey(env) {
  const name = gatewayKeyName(env);
  // Trimmed because a key pasted into a repo secret often carries a trailing
  // newline, and a gateway rejects that as "Invalid token" — which reads as a
  // wrong key rather than a whitespace problem.
  return name ? env[name].trim() : '';
}

/**
 * Everything about the key except the key.
 *
 * A header value with a space, newline or non-ASCII character in the middle is
 * not sent at all, and the gateway then reports a *missing* Authorization
 * header — which reads as code that forgot to set one. Length and shape
 * identify that in one request without putting a secret in a response.
 */
function keyShape(env) {
  const name = gatewayKeyName(env);
  if (!name) return { source: null };
  const key = env[name].trim();
  return {
    source: name,
    length: key.length,
    // Every gateway key is printable ASCII with no spaces. Anything else is
    // what broke the header.
    headerSafe: /^[\x21-\x7e]+$/.test(key),
    // Which gateway issued it, as one bit rather than as characters: /health
    // is public, so it says what the key *is*, never any part of it. An
    // OpenRouter key is sk-or-v1- and 64 hex after it.
    looksLikeOpenRouter: /^sk-or-v1-[0-9a-f]{64}$/.test(key),
  };
}

/**
 * The OpenAI-shaped gateways this Worker knows, each with its own base URL,
 * key and model list.
 *
 * One gateway is not enough. Every free tier is contended by everyone else
 * using it, and they run dry at different moments, so the useful unit is a
 * list of independent services rather than a list of models inside one.
 * Whichever has a key configured joins the chain; the rest cost nothing.
 */
function gateways(env) {
  const list = [];
  // Groq and Cerebras both run open models on their own fast hardware with a
  // free tier, and both speak this wire format, so each costs one secret and
  // no code. They are independent of the routers above, which is the point.
  if ((env.GROQ_API_KEY || '').trim()) {
    list.push({
      name: 'GROQ_API_KEY',
      baseUrl: (env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
      key: env.GROQ_API_KEY.trim(),
      models: splitModels(env.GROQ_MODEL || 'llama-3.3-70b-versatile'),
    });
  }
  if ((env.CEREBRAS_API_KEY || '').trim()) {
    list.push({
      name: 'CEREBRAS_API_KEY',
      baseUrl: (env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1').replace(/\/$/, ''),
      key: env.CEREBRAS_API_KEY.trim(),
      models: splitModels(env.CEREBRAS_MODEL || 'llama-3.3-70b'),
    });
  }
  // Routers last. They resell a shared free pool, so they queue behind
  // everyone else using it, where the services above run the model themselves.
  const shared = gatewayKey(env);
  if (shared) {
    list.push({
      name: gatewayKeyName(env),
      baseUrl: (env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
      key: shared,
      models: splitModels(env.OPENAI_MODEL || 'google/gemma-4-26b-a4b-it:free'),
    });
  }
  return list;
}

function splitModels(value) {
  return value.split(',').map((model) => model.trim()).filter(Boolean);
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

/**
 * Everything worth trying, in order, across every provider that has a key.
 *
 * A quota belongs to one account on one day, not to the request, so falling
 * back only between models of one provider leaves the page dead the moment
 * that provider says no. LLM_PROVIDER picks what goes first.
 */
function attemptsFor(env) {
  const preferred = pickProvider(env);
  const gemini = env.GEMINI_API_KEY
    ? [{
        provider: 'gemini',
        gateway: 'GEMINI_API_KEY',
        model: env.GEMINI_MODEL || 'gemini-3.6-flash',
        key: env.GEMINI_API_KEY.trim(),
      }]
    : [];
  const rest = gateways(env).flatMap((gateway) =>
    gateway.models.map((model) => ({
      provider: 'openai',
      gateway: gateway.name,
      baseUrl: gateway.baseUrl,
      model,
      key: gateway.key,
    })),
  );
  return preferred === 'openai' ? [...rest, ...gemini] : [...gemini, ...rest];
}

/**
 * A reply nobody is waiting for is worth nothing. Someone types in chat and
 * expects an answer in a second or two, so a slow model is a busy model: give
 * each one a short window, and stop walking the list once the whole budget is
 * spent rather than trying all of them and timing out with nothing.
 */
const PER_MODEL_MS = 9_000;
const TOTAL_MS = 25_000;
/** Long enough for a saturated pool to free a worker, short enough to wait. */
const RETRY_WAIT_MS = 1_200;

/** Keeps the API key on Cloudflare; the static site sends only a prompt. */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(origin, env.ALLOWED_ORIGIN);
    const url = new URL(request.url);
    const provider = pickProvider(env);
    const attempts = attemptsFor(env);

    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method === 'GET' && url.pathname === '/health') {
      // The chain is in here because the commonest failure is a deploy
      // pointing at something other than what you think it is.
      return json(
        {
          ok: true,
          keyConfigured: attempts.length > 0,
          provider,
          model: attempts[0]?.model ?? null,
          chain: attempts.map((attempt) => `${attempt.provider}:${attempt.model}`),
          gatewayKey: keyShape(env),
        },
        200,
        headers,
      );
    }
    // What the gateway key can actually reach. Model lists are public
    // information, and guessing ids from a screenshot is how an hour goes
    // into a 401 that turns out to name a model the gateway never had.
    if (request.method === 'GET' && url.pathname === '/models') {
      const all = gateways(env);
      if (!all.length) return json({ error: 'no gateway key configured' }, 500, headers);
      // ?gateway=GROQ_API_KEY picks one; without it, every configured gateway
      // is listed, which is what you want right after adding a key.
      const wanted = url.searchParams.get('gateway');
      const chosen = wanted ? all.filter((gateway) => gateway.name === wanted) : all;
      if (!chosen.length) {
        return json({ error: `no gateway named ${wanted}`, configured: all.map((g) => g.name) }, 404, headers);
      }

      const results = await Promise.all(chosen.map(async (gateway) => {
        try {
          const upstream = await fetch(`${gateway.baseUrl}/models`, {
            signal: AbortSignal.timeout(PER_MODEL_MS),
            headers: { authorization: `Bearer ${gateway.key}` },
          });
          if (!upstream.ok) {
            return {
              gateway: gateway.name,
              baseUrl: gateway.baseUrl,
              status: upstream.status,
              error: await errorMessage(upstream),
            };
          }
          const body = await upstream.json();
          const ids = (body.data ?? []).map((model) => model.id);
          return {
            gateway: gateway.name,
            baseUrl: gateway.baseUrl,
            count: ids.length,
            free: ids.filter(isFreeId),
            all: ids,
          };
        } catch (error) {
          return { gateway: gateway.name, baseUrl: gateway.baseUrl, error: error.message };
        }
      }));
      return json({ gateways: results }, 200, headers);
    }

    if (request.method !== 'POST' || url.pathname !== '/api/reply') {
      return json({ error: 'not found' }, 404, headers);
    }
    if (!attempts.length) {
      return json({ error: 'server has no GEMINI_API_KEY or OPENROUTER_API_KEY' }, 500, headers);
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
      const reply = await replyFromAny(env, attempts, prompt);
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

/**
 * Try each attempt until one answers. Everything short of an answer is this
 * attempt's problem — a spent quota, a saturated free pool, a slow model, an
 * opaque 400 — and the next one is a second away. Only a refused key skips
 * the rest of that provider, since it would be refused identically.
 */
async function replyFromAny(env, attempts, prompt) {
  const deadline = Date.now() + TOTAL_MS;
  const failures = {};
  const refused = new Set();

  // Every failure left once the keys are right is transient capacity — a
  // spent minute of quota, a pool with no free worker. Those clear in
  // seconds, so a second pass costs one short wait and turns a fair number
  // of dead requests into replies. Two passes, because a third would not
  // arrive in time to be worth reading.
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) {
      const remaining = deadline - Date.now();
      // Only worth waiting if there is time to actually use afterwards.
      if (remaining < RETRY_WAIT_MS * 3) break;
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
    }

    for (const attempt of attempts) {
      if (Date.now() >= deadline) break;
      if (refused.has(attempt.gateway)) continue;
      try {
        const reply = attempt.provider === 'gemini'
          ? await replyFromGemini(env, attempt.model, attempt.key, prompt)
          : await tryModel(attempt.baseUrl, attempt.model, attempt.key, prompt);
        // Which one answered: with a chain, /health only names the first.
        return { ...reply, model: attempt.model, provider: attempt.provider };
      } catch (error) {
        if (error.fatal) refused.add(attempt.gateway);
        console.warn(`${attempt.provider}:${attempt.model} ${error.message}`);
        // Only the last word from each model, or one failing twice fills the
        // error with the same sentence written out again.
        failures[attempt.model] = `${attempt.model} ${error.message}`;
      }
    }
  }

  const reported = Object.values(failures);
  throw new Error(`nothing answered (${reported.join('; ') || 'out of time'})`);
}

function geminiError(status, detail) {
  const error = new Error(`${status}: ${detail}`);
  error.fatal = status === 401 || status === 403;
  return error;
}

/** Gateways mark free variants as either "…:free" or "…-free". */
function isFreeId(id) {
  return /[-:]free$/i.test(id);
}

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
      throw geminiError(response.status, detail);
    }
  }
  if (!response.ok) throw geminiError(response.status, await errorMessage(response));

  const gemini = await response.json();
  const candidate = gemini.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text || '').join('') || '';
  if (!text) throw new Error(`Gemini returned nothing (${candidate?.finishReason || 'no candidate'})`);

  const reply = parseReply(text);
  if (!reply) throw new Error('Gemini returned unparseable JSON');
  return reply;
}

async function tryModel(baseUrl, model, key, prompt) {
  let response = await callOpenAI(baseUrl, model, key, prompt, true);

  // Structured-output support varies wildly between models behind these
  // gateways, and the 400 that says so is often no more specific than
  // "Provider returned error". Retrying without the schema is cheap and is
  // the commonest fix, so try it on any 400 rather than only a worded one.
  if (!response.ok && response.status === 400) {
    response = await callOpenAI(baseUrl, model, key, prompt, false);
  }

  if (!response.ok) {
    const error = new Error(`${response.status}: ${await errorMessage(response)}`);
    error.fatal = response.status === 401 || response.status === 403;
    throw error;
  }

  const completion = await response.json();

  // Some gateways report a failure as 200 with an error object and no
  // choices. Left unread, that surfaces as "returned nothing", which says
  // nothing about a rate limit or a model that is down.
  if (completion.error) {
    const error = new Error(`${completion.error.message || 'gateway error'}`);
    error.fatal = /invalid.*(key|token)|unauthorized/i.test(error.message);
    throw error;
  }

  const choice = completion.choices?.[0];
  const message = choice?.message ?? {};

  // A reasoning model may leave content empty and put everything in its own
  // reasoning field, under any of several names depending on the gateway.
  // The answer is in there; it just is not where a chat model puts it.
  const text = message.content || message.reasoning_content || message.reasoning || '';
  if (!text) {
    const shape = Object.keys(message).join(',') || 'no message';
    throw new Error(`returned nothing (${choice?.finish_reason || 'no choice'}; fields: ${shape})`);
  }

  const reply = parseReply(text.replace(THINK_BLOCK, '').trim());
  if (!reply) throw new Error(`returned unparseable JSON (${choice?.finish_reason || 'no reason'})`);
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
    signal: AbortSignal.timeout(PER_MODEL_MS),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });
}

function callOpenAI(baseUrl, model, key, prompt, withSchema) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  // OpenRouter attributes usage to whatever sends these, which is how you tell
  // this site apart from anything else on the same key.
  if (baseUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://minecraft-chat-gemini.abdyzam50.workers.dev';
    headers['X-Title'] = 'Minecraft chat AI sandbox';
  }
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(PER_MODEL_MS),
    headers,
    body: JSON.stringify({
      model,
      // A reasoning model spends its budget thinking before it writes
      // anything, and a cap sized for a one-line reply is entirely consumed
      // before the reply starts — which comes back as an empty answer rather
      // than as an error.
      max_tokens: /reason|think/i.test(model) ? 4000 : 2000,
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
