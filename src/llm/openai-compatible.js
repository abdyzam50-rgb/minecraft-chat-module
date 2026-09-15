import { buildSystemPrompt, buildUserPrompt, RESPONSE_SCHEMA } from './prompt.js';

/**
 * Any OpenAI-shaped `/chat/completions` endpoint.
 *
 * One adapter covers TokenRouter, OpenRouter, Together, Groq, a local Ollama or
 * LM Studio — they all speak the same wire format, so the only thing that
 * changes is `llm.baseUrl` and `llm.model`.
 *
 *   llm: { provider: 'openai', baseUrl: 'https://api.tokenrouter.com/v1',
 *          model: 'z-ai/glm-5.3-free' }
 *
 * Two things differ from the first-party APIs and both are handled here:
 * structured-output support varies wildly between models behind these
 * gateways, and reasoning models emit their thinking inline.
 */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Reasoning models put their working in the reply. Chat wants the answer. */
const THINK_BLOCK = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi;

export class OpenAICompatibleResponder {
  constructor(config, { fetchImpl = globalThis.fetch } = {}) {
    this.config = config;
    this.name = 'openai';
    this.systemPrompt = buildSystemPrompt(config);
    this.fetch = fetchImpl;
    this.baseUrl = (config.llm.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiKey = (config.llm.apiKey || keyForHost(this.baseUrl, process.env)).trim();
    this.available = Boolean(this.apiKey);
    /** Set once a model turns out not to accept a JSON schema. */
    this.schemaUnsupported = false;
  }

  get client() {
    return this.available ? this : null;
  }

  async decide(store, trigger, ts = Date.now(), options = {}) {
    if (!this.available) {
      throw new Error('No key: set OPENAI_API_KEY (or TOKENROUTER_API_KEY / OPENROUTER_API_KEY)');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.llm.timeoutMs);

    try {
      let response = await this.send(store, trigger, ts, options, controller.signal, !this.schemaUnsupported);

      // Plenty of models behind these gateways accept `json_object` but not a
      // schema, and say so with a 400. Drop to the looser mode once and
      // remember, rather than failing every reply.
      if (!response.ok && !this.schemaUnsupported) {
        const detail = await errorMessage(response);
        if (response.status === 400 && /schema|response_format|json/i.test(detail)) {
          this.schemaUnsupported = true;
          response = await this.send(store, trigger, ts, options, controller.signal, false);
        } else {
          throw new Error(`${this.name} ${response.status}: ${detail}`);
        }
      }
      if (!response.ok) {
        throw new Error(`${this.name} ${response.status}: ${await errorMessage(response)}`);
      }

      const body = await response.json();
      const choice = body.choices?.[0];
      const text = choice?.message?.content ?? '';
      if (!text) {
        return {
          respond: false,
          message: '',
          reason: `no content (${choice?.finish_reason ?? 'no choice'})`,
          source: this.name,
        };
      }

      const parsed = parseJson(text.replace(THINK_BLOCK, '').trim());
      if (!parsed) {
        return { respond: false, message: '', reason: 'unparseable response', source: this.name };
      }
      return {
        respond: Boolean(parsed.respond),
        message: String(parsed.message ?? ''),
        reason: String(parsed.reason ?? ''),
        source: this.name,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  send(store, trigger, ts, options, signal, withSchema) {
    return this.fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.llm.model,
        max_tokens: this.config.llm.maxTokens,
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: buildUserPrompt(store, this.config, trigger, ts, options) },
        ],
        response_format: withSchema
          ? { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: RESPONSE_SCHEMA } }
          : { type: 'json_object' },
      }),
    });
  }
}

/**
 * Pick the key that belongs to the host we are about to call, rather than
 * whichever is set first. With several gateways configured at once, sending
 * OpenAI's key to TokenRouter produces a 401 that looks like a bad key.
 */
function keyForHost(baseUrl, env) {
  const host = baseUrl.toLowerCase();
  const named =
    (host.includes('tokenrouter') && env.TOKENROUTER_API_KEY) ||
    (host.includes('openrouter') && env.OPENROUTER_API_KEY) ||
    (host.includes('openai.com') && env.OPENAI_API_KEY) ||
    '';
  // A local Ollama or an unrecognised gateway: any key will do, and most
  // local servers ignore it entirely.
  return named || env.OPENAI_API_KEY || env.TOKENROUTER_API_KEY || env.OPENROUTER_API_KEY || '';
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
