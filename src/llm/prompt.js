import { getPersona, HARD_RULES } from '../persona/personas.js';
import { shortName } from '../chat/shortname.js';

/**
 * The system prompt is deliberately static for a given config so the Anthropic
 * prompt cache can hold it — everything that changes per event goes in the
 * user message.
 */
export function buildSystemPrompt(config) {
  const persona = getPersona(config.persona);
  const self = shortName(config.username, { overrides: config.shortNames });

  return [
    `You are the chat voice of a Minecraft player called ${config.username} (people call them "${self}").`,
    'They are grinding on Hypixel Skyblock with a pathfinding macro running, so they cannot stop to type.',
    'You write the single line they would have typed, and nothing else.',
    '',
    'How you write:',
    `- At most ${config.chat.maxLength} characters. One line. No line breaks.`,
    '- Lowercase, clipped, no punctuation fussiness — you are typing mid-grind, not writing prose.',
    '- Refer to other players by their short name (the memorable chunk of their username), never the full decorated username.',
    '- Never explain yourself twice or start with a greeting.',
    '- Do not mention that you are an AI, a model, or a program.',
    '',
    `Tone (${persona.label}):`,
    ...persona.rules.map((r) => `- ${r}`),
    '',
    'Hard limits — these override tone:',
    ...HARD_RULES.map((r) => `- ${r}`),
    '',
    'You also decide whether to speak at all. Staying silent is the right call when:',
    '- the message was not really aimed at you',
    '- you already made this point recently',
    '- replying would just extend an argument that is going nowhere',
    'Set respond=false in those cases and leave message empty.',
  ].join('\n');
}

function formatChat(entries, ts) {
  if (!entries.length) return '(no recent chat)';
  return entries
    .map((e) => {
      const age = Math.max(0, Math.round((ts - e.ts) / 1000));
      const who = e.sender ?? 'server';
      const channel = e.channel && e.channel !== 'all' ? `[${e.channel}] ` : '';
      return `  -${age}s ${channel}${who}: ${e.content}`;
    })
    .join('\n');
}

function formatNearby(store, ts) {
  const nearby = [...store.players.values()]
    .filter((p) => ts - p.lastSeen <= 60000)
    .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))
    .slice(0, 6);
  if (!nearby.length) return '(nobody nearby)';
  return nearby
    .map((p) => {
      const parts = [`  ${p.name}`];
      if (p.distance !== null) parts.push(`${p.distance.toFixed(1)}m away`);
      const blocks = p.blocks.filter((t) => ts - t <= 120000).length;
      if (blocks) parts.push(`blocked my path ${blocks}x in 2min`);
      return parts.join(' — ');
    })
    .join('\n');
}

/** The per-event half of the prompt: current world state plus the trigger. */
export function buildUserPrompt(store, config, trigger, ts = Date.now()) {
  const subjectShort = trigger.subject
    ? shortName(trigger.subject, { overrides: config.shortNames })
    : null;

  const lines = [
    'Current situation:',
    `  area: ${store.self.area ?? 'unknown'}`,
    `  doing: ${store.self.activity ?? 'unknown'}`,
    `  pathfinder: ${store.pathfinder.state}${
      store.pathfinder.target ? ` towards ${store.pathfinder.target}` : ''
    }${store.pathfinder.blockedBy ? `, blocked by ${store.pathfinder.blockedBy}` : ''}`,
    '',
    'Players nearby:',
    formatNearby(store, ts),
    '',
    'Recent chat (newest last):',
    formatChat(store.recentChat(12), ts),
    '',
    `What just happened (${trigger.kind}):`,
    `  ${trigger.evidence}`,
  ];

  if (trigger.subject) {
    lines.push('', `Reply to ${trigger.subject}. Call them "${subjectShort}".`);
  }
  if (store.lastOutgoing && ts - store.lastOutgoing.ts < 120000) {
    lines.push(
      '',
      `You last said, ${Math.round((ts - store.lastOutgoing.ts) / 1000)}s ago: "${store.lastOutgoing.message}"`,
      'Do not repeat that point — either add something new or stay quiet.',
    );
  }

  lines.push('', 'Write the one line to send, or decide to stay quiet.');
  return lines.join('\n');
}

export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    respond: { type: 'boolean', description: 'Whether to send anything at all.' },
    message: { type: 'string', description: 'The exact chat line to send. Empty when respond is false.' },
    reason: { type: 'string', description: 'One short phrase explaining the call, for logs.' },
  },
  required: ['respond', 'message', 'reason'],
  additionalProperties: false,
};
