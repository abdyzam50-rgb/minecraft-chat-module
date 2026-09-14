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
    // A bare "yo <name>" wants "?" back; "mb g" wants "all g" or nothing.
    let key = trigger.kind;
    if (trigger.opener && persona.fallback.opener) key = 'opener';
    else if (trigger.smalltalk && persona.fallback.smalltalk) key = 'smalltalk';
    const entry = persona.fallback[key] ?? persona.fallback.mention ?? [];
    // Some kinds escalate, and store their lines keyed by anger level.
    const lines = Array.isArray(entry) ? entry : entry[trigger.anger ?? 1] ?? entry[1] ?? [];
    if (!lines.length) {
      return { respond: false, message: '', reason: 'no fallback line', source: 'fallback' };
    }

    const slot = `${key}:${trigger.anger ?? 1}`;
    const index = (this.used.get(slot) ?? -1) + 1;
    this.used.set(slot, index);

    const short = trigger.subject
      ? shortName(trigger.subject, { overrides: this.config.shortNames })
      : '';
    const message = lines[index % lines.length]
      .replaceAll('{short}', short)
      .replaceAll('{name}', trigger.subject ?? '')
      .trim();

    return {
      respond: true,
      message,
      reason: `canned line${trigger.anger ? `, anger ${trigger.anger}` : ''}`,
      source: 'fallback',
    };
  }
}
