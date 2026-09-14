import { getPersona } from '../persona/personas.js';
import { shortName } from '../chat/shortname.js';

/**
 * Canned replies for when the API key is missing, the request times out, or
 * the network is down. Keeps the bot useful offline instead of going silent.
 */
export class FallbackResponder {
  constructor(config) {
    this.config = config;
    this.used = new Map(); // kind -> index, so we rotate instead of repeating
  }

  decide(store, trigger) {
    const persona = getPersona(this.config.persona);
    const lines = persona.fallback[trigger.kind] ?? persona.fallback.mention ?? [];
    if (!lines.length) {
      return { respond: false, message: '', reason: 'no fallback line', source: 'fallback' };
    }

    const index = (this.used.get(trigger.kind) ?? -1) + 1;
    this.used.set(trigger.kind, index);

    const short = trigger.subject
      ? shortName(trigger.subject, { overrides: this.config.shortNames })
      : '';
    const message = lines[index % lines.length]
      .replaceAll('{short}', short)
      .replaceAll('{name}', trigger.subject ?? '')
      .trim();

    return { respond: true, message, reason: 'canned line', source: 'fallback' };
  }
}
