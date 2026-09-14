const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Keeps the Gemini key on Cloudflare; the static site sends only a prompt. */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(origin, env.ALLOWED_ORIGIN);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true }, 200, headers);
    if (request.method !== 'POST' || url.pathname !== '/api/reply') return json({ error: 'not found' }, 404, headers);
    if (!env.GEMINI_API_KEY) return json({ error: 'server is missing GEMINI_API_KEY' }, 500, headers);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'body must be JSON' }, 400, headers); }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt || prompt.length > 12_000) return json({ error: 'prompt must be between 1 and 12000 characters' }, 400, headers);

    const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
    const response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 180, responseMimeType: 'application/json' },
      }),
    });
    if (!response.ok) {
      console.error('Gemini request failed:', response.status, (await response.text()).slice(0, 300));
      return json({ error: 'Gemini could not generate a reply' }, 502, headers);
    }
    const gemini = await response.json();
    const text = gemini.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
    const reply = parseReply(text);
    return reply ? json(reply, 200, headers) : json({ error: 'Gemini returned an invalid reply' }, 502, headers);
  },
};

function parseReply(text) {
  try {
    const reply = JSON.parse(text);
    return { respond: Boolean(reply.respond), message: String(reply.message || ''), reason: String(reply.reason || '') };
  } catch { return null; }
}

function corsHeaders(origin, allowedOrigin) {
  // CORS blocks other browser origins from reading replies; it is not authentication.
  return {
    'access-control-allow-origin': allowedOrigin || origin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json; charset=utf-8',
    'vary': 'Origin',
  };
}

function json(value, status, headers) { return new Response(JSON.stringify(value), { status, headers }); }
