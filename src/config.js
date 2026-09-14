/**
 * Configuration defaults and merging.
 *
 * Resolution order (later wins): DEFAULTS -> config file -> options passed to
 * createChatAI() -> a small set of environment variables.
 */

export const DEFAULTS = {
  /** Your in-game name. Required for mention/accusation targeting. */
  username: '',

  /** Extra names people call you by, so "hey drm" still counts as a mention. */
  aliases: [],

  /** chill | snarky | unfiltered — see src/persona/personas.js */
  persona: 'snarky',

  llm: {
    model: 'claude-opus-5',
    /** low keeps in-game latency down; raise for wittier replies. */
    effort: 'low',
    maxTokens: 1000,
    /** Abort the request if it outlives the moment. */
    timeoutMs: 8000,
    /** Fall back to canned lines when the API errors or times out. */
    fallbackOnError: true,
  },

  chat: {
    /** 1.8.x clients cap the chat box at 100 chars. Hypixel allows 256. */
    maxLength: 100,
    /**
     * clean  — swap profanity for tamer words before sending
     * allow  — send whatever the model wrote
     * Note: no filter-evasion (l3etspeak) is performed in either mode.
     */
    profanity: 'clean',
    /** Simulated typing delay before the message goes out. */
    typingDelayMs: [600, 1800],
    /** Channels the bot is allowed to talk in. */
    speakIn: ['all', 'party'],
  },

  limits: {
    /** Minimum gap between any two messages. */
    globalCooldownMs: 8000,
    /** Minimum gap between two messages aimed at the same player. */
    perPlayerCooldownMs: 60000,
    /** Minimum gap between two messages of the same trigger kind. */
    perKindCooldownMs: 20000,
    maxPerMinute: 4,
    maxPerHour: 30,
    /** Don't answer the same player more than this many times back-to-back. */
    maxConsecutivePerPlayer: 2,
    /** Drop a message identical to one sent inside this window (Hypixel eats dupes). */
    dedupeWindowMs: 300000,
  },

  detect: {
    pathfinder: {
      /** Blocking incidents needed inside `windowMs` before we say anything. */
      threshold: 3,
      windowMs: 45000,
      /** How close a player must be to count as "in the way" (blocks). */
      radius: 4,
    },
    accusation: {
      /** Only fire if the accuser is nearby, mentioned us, or just talked to us. */
      requireDirected: true,
      /** How long after our own message a reply still counts as directed at us. */
      replyWindowMs: 30000,
    },
    mention: {
      enabled: true,
      /** Answer whispers even when they don't include a question. */
      answerWhispers: true,
    },
  },

  /** Names that are never targeted or answered (friends, staff, your alts). */
  ignore: [],

  /** Manual short forms: { "xX_DreamSlayer_Xx": "Dream" } */
  shortNames: {},

  bridge: {
    host: '127.0.0.1',
    port: 8787,
    /** Shared secret the in-game module sends as X-Auth. Empty disables the check. */
    token: '',
  },

  /** Log decisions without sending anything. */
  dryRun: false,
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep merge that treats arrays as replacements, not concatenations. */
export function merge(base, override) {
  if (!isPlainObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(base?.[key]) ? merge(base[key], value) : value;
  }
  return out;
}

function fromEnv(env) {
  const patch = {};
  if (env.MCCHAT_PORT) patch.bridge = { port: Number(env.MCCHAT_PORT) };
  if (env.MCCHAT_TOKEN) patch.bridge = { ...patch.bridge, token: env.MCCHAT_TOKEN };
  if (env.MCCHAT_MODEL) patch.llm = { model: env.MCCHAT_MODEL };
  if (env.MCCHAT_USERNAME) patch.username = env.MCCHAT_USERNAME;
  if (env.MCCHAT_PERSONA) patch.persona = env.MCCHAT_PERSONA;
  return patch;
}

export function resolveConfig(options = {}, env = process.env) {
  const config = merge(merge(DEFAULTS, options), fromEnv(env));
  const errors = [];

  if (!config.username) {
    errors.push('config.username is required (your in-game name)');
  }
  if (!['chill', 'snarky', 'unfiltered'].includes(config.persona)) {
    errors.push(`unknown persona "${config.persona}"`);
  }
  if (!['clean', 'allow'].includes(config.chat.profanity)) {
    errors.push(`chat.profanity must be "clean" or "allow"`);
  }
  if (errors.length) {
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}
