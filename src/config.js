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
    /** medium buys noticeably less formulaic wording for ~a second of latency. */
    effort: 'medium',
    maxTokens: 1000,
    /** Abort the request if it outlives the moment. */
    timeoutMs: 9000,
    /**
     * Ask again when the first line comes back too close to something already
     * said. Costs one extra call, occasionally.
     */
    retryOnRepeat: true,
    /**
     * Canned lines when the API errors out. Off by default: a stock phrase is
     * exactly the tell this bot exists to avoid, and saying nothing is what a
     * person distracted by a grind would do anyway.
     */
    fallbackOnError: false,
  },

  chat: {
    /** Hard cap — 1.8.x clients stop accepting input at 100 chars. */
    maxLength: 100,
    /**
     * What a reply should actually look like. The cap is a wall, not a target:
     * players type a handful of words mid-grind, and long tidy sentences are
     * the giveaway.
     */
    preferredLength: 40,
    /**
     * Hard word cap on replies that are meant to be tiny — a bare call-out or
     * an acknowledgement. Enforced, not requested: the model keeps appending a
     * name and a "ty" to what should be two words.
     */
    terseWords: 2,
    /**
     * Phrasings to fix on the way out. Telling the model not to say something
     * puts the words in front of it; correcting the output is reliable.
     * [pattern, replacement] — patterns are matched case-insensitively.
     */
    corrections: [
      ['\\b(grind|grinding|farm|farming|doing)\\s+(?:the\\s+)?mist\\b', '$1 ghosts'],
      ['\\bkill(ing)?\\s+(?:the\\s+)?mist\\b', 'killing ghosts'],
    ],
    /**
     * clean  — swap profanity for tamer words before sending
     * allow  — send whatever the model wrote
     * Note: no filter-evasion (l3etspeak) is performed in either mode.
     */
    profanity: 'clean',
    /**
     * Typing is modelled, not randomised flat: a pause to read and decide,
     * then time proportional to the length of what gets typed.
     */
    thinkMs: [400, 1400],
    msPerChar: [45, 90],
    maxDelayMs: 7000,
    /**
     * Reject a line this close to one already sent (0-1, trigram Dice).
     * Lower is stricter. 0.55 rejects rewordings, keeps genuine variety.
     */
    similarityThreshold: 0.55,
    /** How many recent lines the model is told to avoid repeating. */
    avoidHistory: 8,
    /** Channels the bot is allowed to talk in. */
    speakIn: ['all', 'party'],
  },

  limits: {
    /** Minimum gap between any two messages. */
    globalCooldownMs: 8000,
    /**
     * Minimum gap between two messages aimed at the same player — applies only
     * when WE started it (a macro-check callout). It never gags a reply to
     * someone who is talking to us; see `conversation` below.
     */
    perPlayerCooldownMs: 60000,
    /** Minimum gap between two messages of the same trigger kind. */
    perKindCooldownMs: 20000,
    maxPerMinute: 8,
    maxPerHour: 30,
    /** Don't answer the same player more than this many times back-to-back. */
    maxConsecutivePerPlayer: 2,
    /** Drop a message identical to one sent inside this window (Hypixel eats dupes). */
    dedupeWindowMs: 300000,

    /**
     * When someone is actually talking to us, the anti-nag limits are the
     * wrong tool — you finish a conversation, you don't ration it.
     */
    conversation: {
      /** Their next message counts as continuing if it lands inside this. */
      windowMs: 120000,
      /** Gap between our replies mid-conversation, instead of the global one. */
      cooldownMs: 2500,
      /** Turns we'll take in a normal exchange before letting it rest. */
      maxTurns: 12,
      /**
       * Turns in an argument. Much lower on purpose: a real person stops
       * defending themselves to someone calling them a cheater, and trading
       * shots forever is exactly what a bot would do.
       */
      maxArgumentTurns: 3,
    },
  },

  /** What the client is actually doing — fed to the model as context. */
  self: {
    area: 'The Mist, Dwarven Mines',
    activity: 'ghost grinding',
  },

  detect: {
    pathfinder: {
      /** Blocking incidents needed inside `windowMs` before we say anything. */
      threshold: 3,
      windowMs: 45000,
      /** How close a player must be to count as "in the way" (blocks). */
      radius: 4,
      /**
       * Standing in front of someone at a grind spot is a macro check: they
       * are watching whether you react like a person. Both numbers below are
       * rolled per player, so the bot never snaps on a fixed count.
       *
       * patience — total blocks before the tone hardens (anger 2)
       * rage     — extra blocks after that before it starts yelling (anger 3)
       */
      patience: [4, 7],
      rage: [2, 4],
    },
    /** How far away someone can be and still plausibly be talking to us. */
    chatRadius: 12,
    /**
     * Spot claims reach further: someone contesting a ghost spawn can easily
     * be fifteen or twenty blocks off and still mean you.
     */
    spotClaimRadius: 20,

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

  /** Chat and SkyBlock vernacular — see src/persona/slang.js. */
  slang: {
    enabled: true,
    /** Your own additions: ["gexp — guild xp"] or [["gexp", "guild xp"]]. */
    extra: [],
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
