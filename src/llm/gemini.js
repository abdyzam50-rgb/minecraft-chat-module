import { buildSystemPrompt, buildUserPrompt, RESPONSE_SCHEMA } from './prompt.js';

/**
 * Gemini responder — same contract as ClaudeResponder, different backend.
 *
 * Plain fetch against the REST API, so there is no extra dependency. Set
 * GEMINI_API_KEY (or llm.apiKey) and llm.provider: "gemini".
 *
 * Note that a bigger or different model does not make the bot know more about
 * SkyBlock than its training data holds — for anything the meta changes
 * (prices, best money methods, current mayor), the knowledge file is what
 * keeps it right. See src/knowledge.js.
 */
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Gemini's schema dialect is the OpenAPI subset: types are upper case. */
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== 'object') return schema;

  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') continue; // not part of the dialect
    if (key === 'type' && typeof value === 'string') {
      out.type = value.toUpperCase();
    } else {
      out[key] = toGeminiSchema(value);
    }
  }
  return out;
}

export class GeminiResponder {
  constructor(config, { fetchImpl = globalThis.fetch } = {}) {
    this.config = config;
    this.name = 'gemini';
    this.systemPrompt = buildSystemPrompt(config);
    this.fetch = fetchImpl;
    this.apiKey = config.llm.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.available = Boolean(this.apiKey);
  }

  get client() {
    return this.available ? this : null;
  }

  async decide(store, trigger, ts = Date.now(), options = {}) {
    if (!this.available) throw new Error('No Gemini key: set GEMINI_API_KEY');

    const { model, maxTokens, timeoutMs } = this.config.llm;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: this.systemPrompt }] },
          contents: [
            { role: 'user', parts: [{ text: buildUserPrompt(store, this.config, trigger, ts, options) }] },
          ],
          generationConfig: {
            maxOutputTokens: maxTokens,
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(RESPONSE_SCHEMA),
          },
        }),
      });

      if (!response.ok) {
        const raw = await response.text();
        let detail = raw.slice(0, 200);
        try {
          const parsed = JSON.parse(raw);
          detail = parsed.error?.message ?? detail;
        } catch {
          /* keep the raw slice */
        }
        throw new Error(`Gemini ${response.status}: ${detail}`);
      }

      const body = await response.json();
      const candidate = body.candidates?.[0];
      if (!candidate || candidate.finishReason === 'SAFETY') {
        return { respond: false, message: '', reason: 'model declined', source: 'gemini' };
      }

      const text = candidate.content?.parts?.map((part) => part.text).join('') ?? '';
      const parsed = parseJson(text);
      if (!parsed) {
        return { respond: false, message: '', reason: 'unparseable response', source: 'gemini' };
      }
      return {
        respond: Boolean(parsed.respond),
        message: String(parsed.message ?? ''),
        reason: String(parsed.reason ?? ''),
        source: 'gemini',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
