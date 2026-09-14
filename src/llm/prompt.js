import { getPersona, GRIND_CONTEXT, HARD_RULES } from '../persona/personas.js';
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
    'They cannot stop to type, so you type for them.',
    'You write the single line they would have typed, and nothing else.',
    '',
    'Where you are:',
    ...GRIND_CONTEXT.map((line) => `- ${line}`),
    '',
    'How you write:',
    `- At most ${config.chat.maxLength} characters. One line. No line breaks.`,
    '- Lowercase, clipped, no punctuation fussiness — you are typing mid-grind, not writing prose.',
    '- Refer to other players by their short name (the memorable chunk of their username), never the full decorated username.',
    '- Never explain yourself twice or start with a greeting.',
    '- Do not mention that you are an AI, a model, or a program.',
    '',
    'Sounding like a person, not a script — this matters more than being clever:',
    '- Every line you write must be new. Never reuse a line, a structure, or a joke you have already used, even reworded.',
    '- Vary how you open. Do not start every line with their name, or always with the same verb.',
    '- Vary the length. Sometimes one word is the whole reply. Sometimes it is a full sentence.',
    '- A real person repeating themselves gets shorter and blunter, not longer and wittier.',
    '- React to what is actually in front of you — what they just said, how long this has gone on, where you are — rather than producing a generic line that would fit any argument.',
    '- No catchphrases. If a line feels like something you would say again next time, write a different one.',
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
export function buildUserPrompt(store, config, trigger, ts = Date.now(), options = {}) {
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

  // A mention or whisper only reaches here when nothing hostile matched, so by
  // definition it is someone just talking. Without this the grind context and
  // the persona both push towards a brush-off, and snapping "what" at someone
  // asking a normal question is the least human thing the bot could do.
  if (trigger.kind === 'mention' || trigger.kind === 'whisper') {
    lines.push(
      '',
      'This one is not testing you — they are just talking to you. Answer them properly, the way you would answer someone standing next to you at the same grind. Keep the attitude for people being deliberately annoying.',
      'If they asked something, actually answer it before anything else. Asked what you are doing? Say what you are doing — name the grind. A one-word deflection like "what" or "yeah?" is never the answer to a real question.',
    );
  }

  if (trigger.anger) {
    const persona = getPersona(config.persona);
    lines.push('', ANGER[trigger.anger] ?? ANGER[1]);
    if (trigger.anger >= 3 && persona.shouts) {
      lines.push('Yell it. Write the whole line in capitals — you are shouting, not talking.');
    }
  }
  if (options.avoid?.length) {
    lines.push(
      '',
      'You have already said these, most recent first:',
      ...options.avoid.map((line) => `  "${line}"`),
      'Do not repeat any of them, reword any of them, or reach for the same joke twice. Say something new or say nothing.',
    );
  }

  if (options.rejected) {
    lines.push(
      '',
      `You just tried "${options.rejected}" and it was too close to something above. Write something genuinely different — a different angle, not a synonym swap.`,
    );
  }

  lines.push('', 'Write the one line to send, or decide to stay quiet.');
  return lines.join('\n');
}

/** How the reply should land at each rung of the escalation. */
const ANGER = {
  1: 'Tone: mildly annoyed. Tell them you are real and to move. Do not make a scene about it yet.',
  2: 'Tone: fed up. You have already told them once and they came straight back. Shorter, colder, no politeness left.',
  3: 'Tone: furious. They have ignored you twice and are still stood in your face. Let them have it.',
};

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
