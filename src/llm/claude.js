import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, buildUserPrompt, RESPONSE_SCHEMA } from './prompt.js';

/**
 * Wraps the one API call we make per trigger.
 *
 * The system prompt is constant for a given config, so it is cached; the
 * volatile world state sits in the user message after the cache breakpoint.
 */
export class ClaudeResponder {
  constructor(config, { client } = {}) {
    this.config = config;
    this.systemPrompt = buildSystemPrompt(config);
    this.client = client ?? null;
    this.available = Boolean(client) || Boolean(process.env.ANTHROPIC_API_KEY);
    if (!this.client && this.available) {
      this.client = new Anthropic();
    }
  }

  /**
   * @returns {Promise<{respond:boolean, message:string, reason:string, source:string}>}
   */
  async decide(store, trigger, ts = Date.now(), options = {}) {
    if (!this.client) {
      throw new Error('No Anthropic client: set ANTHROPIC_API_KEY');
    }

    const { model, effort, maxTokens, timeoutMs } = this.config.llm;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.client.messages.create(
        {
          model,
          max_tokens: maxTokens,
          system: [
            { type: 'text', text: this.systemPrompt, cache_control: { type: 'ephemeral' } },
          ],
          messages: [
            { role: 'user', content: buildUserPrompt(store, this.config, trigger, ts, options) },
          ],
          output_config: {
            effort,
            format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
          },
        },
        { signal: controller.signal },
      );

      if (response.stop_reason === 'refusal') {
        return { respond: false, message: '', reason: 'model declined', source: 'claude' };
      }

      const parsed = extractJson(response);
      if (!parsed) {
        return { respond: false, message: '', reason: 'unparseable response', source: 'claude' };
      }
      return {
        respond: Boolean(parsed.respond),
        message: String(parsed.message ?? ''),
        reason: String(parsed.reason ?? ''),
        source: 'claude',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractJson(response) {
  if (response.parsed_output) return response.parsed_output;
  for (const block of response.content ?? []) {
    if (block.type !== 'text') continue;
    try {
      return JSON.parse(block.text);
    } catch {
      const match = block.text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          /* fall through */
        }
      }
    }
  }
  return null;
}
