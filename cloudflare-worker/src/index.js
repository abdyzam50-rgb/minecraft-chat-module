const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The shape the sandbox expects back. Gemini uses the OpenAPI dialect, so the
 * types are upper case and additionalProperties is not part of it.
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

/** Keeps the Gemini key on Cloudflare; the static site sends only a prompt. */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(origin, env.ALLOWED_ORIGIN);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, keyConfigured: Boolean(env.GEMINI_API_KEY) }, 200, headers);
    }
    if (request.method !== 'POST' || url.pathname !== '/api/reply') {
      return json({ error: 'not found' }, 404, headers);
    }
    if (!env.GEMINI_API_KEY) return json({ error: 'server is missing GEMINI_API_KEY' }, 500, headers);

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

    const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
    const response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          // 2.5 Flash thinks by default and those tokens come out of this
          // budget, so a small cap returns an empty candidate with
          // finishReason MAX_TOKENS. A one-line chat reply does not need
          // thinking, and turning it off is faster as well as cheaper.
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 800,
          responseMimeType: 'application/json',
          responseSchema: REPLY_SCHEMA,
        },
      }),
    });

    if (!response.ok) {
      const detail = await errorMessage(response);
      console.error('Gemini request failed:', response.status, detail);
      // Gemini's own message names the real problem (bad key, quota, bad
      // model) and contains no secret, so pass it through — a generic 502
      // costs an hour of guessing.
      return json({ error: `Gemini ${response.status}: ${detail}` }, 502, headers);
    }

    const gemini = await response.json();
    const candidate = gemini.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text || '').join('') || '';

    if (!text) {
      const why = candidate?.finishReason || 'no candidate';
      console.error('Gemini returned no text:', why);
      return json({ error: `Gemini returned nothing (${why})` }, 502, headers);
    }

    const reply = parseReply(text);
    return reply ? json(reply, 200, headers) : json({ error: 'Gemini returned unparseable JSON' }, 502, headers);
  },
};

async function errorMessage(response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw).error?.message ?? raw.slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

function parseReply(text) {
  try {
    const reply = JSON.parse(text);
    return {
      respond: Boolean(reply.respond),
      message: String(reply.message || ''),
      reason: String(reply.reason || ''),
    };
  } catch {
    return null;
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
