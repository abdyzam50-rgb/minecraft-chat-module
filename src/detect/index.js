import { mentions, shortName } from '../chat/shortname.js';
import {
  ACCUSATION,
  accusationTarget,
  AGGRESSIVE,
  ACTIVITY_QUESTION,
  WELLBEING_QUESTION,
  CONFIRMATION,
  DENIAL,
  isCompliment,
  nearMiss,
  isGreetingOnly,
  isSmallTalk,
  HOSTILE_NUDGE,
  MACRO_CHECK_TALK,
  MUTE_NOTICE,
  POLITE,
  SPOT_CLAIM,
  looksLikeQuestion,
} from './patterns.js';

/**
 * A trigger is "something happened that might deserve a reply".
 *
 * @typedef {Object} Trigger
 * @property {string} kind        macro_check | accusation | mention | whisper | hostile
 * @property {string|null} subject player the reply is aimed at
 * @property {number} severity    1 (mild) .. 3 (they are really at it)
 * @property {number} [anger]     1 annoyed, 2 fed up, 3 yelling
 * @property {boolean} [conversational] true when they spoke to us, rather than
 *                                 us calling something out unprompted
 * @property {boolean} [escalates] true when this reply continues an exchange
 *                                 we already started, so the limiter gives it
 *                                 one extra turn
 * @property {string} evidence    human-readable reason, also fed to the model
 * @property {string} channel     where to reply
 */

/**
 * Someone standing in front of you at a grind spot is running a macro check:
 * they block your path and watch whether you react like a person. A macro
 * walks into them forever, which is the whole point of the test.
 *
 * So the reply escalates instead of repeating. The counts it escalates at are
 * rolled per player (see ContextStore.patienceFor) — snapping on exactly the
 * third block every time is itself the kind of pattern a checker is looking
 * for.
 */
export function detectPathfinderBlock(store, config, ts = Date.now()) {
  const settings = config.detect.pathfinder;
  const blocker = store.pathfinder.blockedBy;
  if (!blocker) return null;
  if (config.ignore.includes(blocker)) return null;

  const count = store.blocksWithin(blocker, settings.windowMs, ts);
  if (count < settings.threshold) return null;
  if (!store.isNearby(blocker, settings.radius, ts)) return null;

  const { patience, rage } = store.patienceFor(blocker, settings);
  const stalledFor = store.pathfinder.blockedSince ? ts - store.pathfinder.blockedSince : 0;
  const trigger = macroCheckTrigger({ blocker, count, patience, rage, stalledFor, config });

  // One message per rung. Repeating the same level just spends the budget that
  // the next one needs.
  if (trigger.anger <= store.player(blocker).lastAnger) return null;
  return trigger;
}

/** Shapes the trigger for a given block count. Shared with the chat path. */
function macroCheckTrigger({ blocker, count, patience, rage, stalledFor = 0, said = null, config }) {
  let anger = 1;
  if (count >= rage) anger = 3;
  else if (count >= patience) anger = 2;

  const seconds = Math.round(config.detect.pathfinder.windowMs / 1000);
  const evidence = [
    `${blocker} has planted themselves in front of me ${count} times in the last ${seconds}s`,
    stalledFor > 2000 ? ` (route stalled ${Math.round(stalledFor / 1000)}s)` : '',
    said ? `, saying "${said}"` : '',
    '. This is a macro check — they are standing there to see whether I react like a person.',
    anger === 1 ? ' First time I am saying anything about it.' : '',
    anger === 2 ? ' I have already asked them to move and they came straight back.' : '',
    anger === 3 ? ' They have kept it up after being told twice. I am done being polite.' : '',
  ].join('');

  return {
    kind: 'macro_check',
    subject: blocker,
    severity: anger,
    anger,
    escalates: anger > 1,
    evidence,
    channel: 'all',
  };
}

/**
 * The verbal half of a macro check — "u real?", "say something", "react".
 * Counts the same as being blocked, and stacks with it.
 */
export function detectMacroCheckTalk(store, config, message, ts = Date.now()) {
  if (!message.sender || message.system) return null;
  if (message.sender === config.username) return null;
  if (config.ignore.includes(message.sender)) return null;
  if (!MACRO_CHECK_TALK.test(message.content)) return null;

  const settings = config.detect.pathfinder;
  const nearby = store.isNearby(message.sender, config.detect.chatRadius, ts);
  const named = mentions(message.content, config.username, config.aliases);
  if (!nearby && !named) return null;

  // A typed check escalates on its own count, not on the blocking fuse. The
  // fuse is randomised because someone crossing your path three times might
  // genuinely be unlucky; typing "say something if ur real" twice is not bad
  // luck, and a bot that answers the first one politely and then repeats
  // itself — or worse, goes quiet — is the tell.
  store.recordCheck(message.sender, ts);
  const check = config.detect.macroCheck;
  const asked = store.checksWithin(message.sender, check.windowMs, ts);

  let anger = 1;
  if (asked >= check.furiousAt) anger = 3;
  else if (asked >= check.fedUpAt) anger = 2;

  const blocks = store.blocksWithin(message.sender, settings.windowMs, ts);
  const evidence = [
    `${message.sender} typed "${message.content}" at me`,
    asked > 1 ? ` — that is the ${ordinal(asked)} time they have asked` : '',
    blocks ? `, and they have been stood in my path ${blocks}x` : '',
    '. They are macro checking me: the thing they are testing for is whether I answer at all.',
    anger === 2 ? ' I have already answered them once and they asked again.' : '',
    anger === 3 ? ' They have kept asking after being answered twice. They are doing it to wind me up now.' : '',
  ].join('');

  return {
    kind: 'macro_check',
    subject: message.sender,
    severity: anger,
    anger,
    conversational: true,
    // Always answer a typed check, at whatever temper it has reached. Silence
    // is the single thing it is looking for.
    escalates: anger > 1,
    evidence,
    channel: message.channel === 'whisper' ? 'whisper' : message.channel,
  };
}

function ordinal(n) {
  return ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth'][n] ?? `${n}th`;
}

/**
 * They typed something very close to our name, but not it.
 *
 * "3127" for "3172" is a fumbled name, not a different player. Answering it as
 * though it were addressed to us is presumptuous; ignoring it is the thing a
 * bot does. So ask — and remember we asked, so their "no" can be handled.
 */
export function detectNearMiss(store, config, message, ts = Date.now()) {
  if (!config.detect.mention.answerNearMisses) return null;
  if (!message.sender || message.system) return null;
  if (message.sender === config.username) return null;
  if (config.ignore.includes(message.sender)) return null;

  // Already talking to them, or they got it right — nothing to ask about.
  if (mentions(message.content, config.username, config.aliases)) return null;
  if (store.inConversation(message.sender, config.limits.conversation.windowMs, ts)) return null;
  // Do not ask twice about the same fumble.
  if (store.awaitingAnswer(message.sender, config.detect.mention.confirmWindowMs, ts)) return null;
  // Deliberately no distance check. Someone typing our name correctly is
  // answered from anywhere in the lobby, and an attempt at it that missed is
  // the same intent — gating this on proximity meant a player across the area
  // could fumble the name three times and get nothing back. The guards that
  // matter are the edit distance and not mistaking another player's name.

  const others = [...store.players.keys()].filter((n) => n !== message.sender);
  const typo = nearMiss(message.content, config.username, config.aliases, others);
  if (!typo) return null;

  return {
    kind: 'maybe_mention',
    subject: message.sender,
    severity: 1,
    conversational: true,
    uncertain: true,
    typo,
    evidence: `${message.sender} said "${message.content}". They wrote "${typo}", which is nearly my name (${config.username}) but not it — they may have fumbled it, or they may mean someone else.`,
    channel: message.channel === 'whisper' ? 'whisper' : message.channel,
  };
}

/**
 * We asked whether they meant us and they said no. Acknowledge it in as few
 * characters as possible and drop the thread — carrying on talking to someone
 * who just told you they were not addressing you is the giveaway.
 */
export function detectStandDown(store, config, message, ts = Date.now()) {
  if (!message.sender || message.system) return null;
  if (!store.awaitingAnswer(message.sender, config.detect.mention.confirmWindowMs, ts)) return null;

  const text = message.content.trim();
  if (CONFIRMATION.test(text)) return null; // they did mean us; carry on
  if (!DENIAL.test(text)) return null;

  return {
    kind: 'stand_down',
    subject: message.sender,
    severity: 1,
    conversational: true,
    closes: true,
    evidence: `${message.sender} said "${message.content}" — they were not talking to me after all.`,
    channel: message.channel === 'whisper' ? 'whisper' : message.channel,
  };
}

/**
 * Detects someone accusing us of cheating/macroing. Requires the accusation to
 * be aimed at us: our name is in it, they are nearby, they have been blocking
 * us, or they are replying just after we spoke.
 */
export function detectAccusation(store, config, message, ts = Date.now()) {
  if (!message.sender || message.system) return null;
  if (message.sender === config.username) return null;
  if (config.ignore.includes(message.sender)) return null;
  if (!ACCUSATION.test(message.content)) return null;

  const { requireDirected, replyWindowMs } = config.detect.accusation;
  const named = mentions(message.content, config.username, config.aliases);

  // "most people macro that" is a remark about the game, not a charge against
  // us. Defending yourself against it reads as a guilty non-sequitur.
  const target = accusationTarget(message.content, named);
  if (target === 'someone-else') return null;
  const nearby = store.isNearby(message.sender, config.detect.chatRadius, ts);
  const hasHistory = store.blocksWithin(message.sender, 120000, ts) > 0;
  const repliedToUs = store.lastOutgoing && ts - store.lastOutgoing.ts <= replyWindowMs;

  // Pointed straight at us ("u macroing?") needs no further corroboration.
  // Anything vaguer has to be plausibly aimed at us by the situation.
  const directed = target === 'us' || named || nearby || hasHistory || repliedToUs;
  if (requireDirected && !directed) return null;

  const priors = (store.players.get(message.sender)?.accusations ?? []).filter(
    (t) => ts - t <= 300000,
  ).length;

  return {
    kind: 'accusation',
    subject: message.sender,
    severity: priors >= 2 ? 3 : 2,
    conversational: true,
    evidence:
      `${message.sender} said "${message.content}" — they are accusing me of cheating or macroing` +
      (hasHistory ? ', right after blocking my pathfinder' : '') +
      (priors ? `. That is accusation #${priors + 1} from them in the last 5 minutes` : '') +
      '.',
    channel: message.channel === 'whisper' ? 'whisper' : message.channel,
  };
}

/**
 * Someone with a fair claim to the spot: they were here first, they are mining
 * this vein, they asked politely for room. The right answer is to give way —
 * arguing with a reasonable person over a ghost spawn is what a bot would do.
 *
 * Aggression routes to detectHostile instead: "get out of here you clown" is
 * not a request.
 */
export function detectSpotClaim(store, config, message, ts = Date.now()) {
  if (!message.sender || message.system) return null;
  if (message.sender === config.username) return null;
  if (config.ignore.includes(message.sender)) return null;
  if (!SPOT_CLAIM.test(message.content)) return null;

  const polite = POLITE.test(message.content);
  if (AGGRESSIVE.test(message.content) && !polite) return null;

  const named = mentions(message.content, config.username, config.aliases);
  if (!named && !store.isNearby(message.sender, config.detect.spotClaimRadius, ts)) {
    return null;
  }

  return {
    kind: 'spot_claim',
    subject: message.sender,
    severity: 1,
    conversational: true,
    polite,
    /** Saying "ill move" and then not moving is worse than saying nothing. */
    hint: 'relocate',
    evidence:
      `${message.sender} said "${message.content}" — they are laying claim to this spot` +
      (polite ? ' and they asked politely' : '') +
      '. As far as I know they are right.',
    channel: message.channel === 'whisper' ? 'whisper' : message.channel,
  };
}

/** Someone told us to move / to get out — mild hostility, not an accusation. */
export function detectHostile(store, config, message, ts = Date.now()) {
  if (!message.sender || message.system) return null;
  if (message.sender === config.username) return null;
  if (config.ignore.includes(message.sender)) return null;
  if (!HOSTILE_NUDGE.test(message.content)) return null;
  if (!mentions(message.content, config.username, config.aliases) &&
      !store.isNearby(message.sender, config.detect.chatRadius, ts)) {
    return null;
  }

  return {
    kind: 'hostile',
    subject: message.sender,
    severity: 1,
    conversational: true,
    evidence: `${message.sender} said "${message.content}" while standing near me.`,
    channel: message.channel === 'whisper' ? 'whisper' : message.channel,
  };
}

/** Plain mention or whisper — someone is talking to us and wants an answer. */
export function detectMention(store, config, message, ts = Date.now()) {
  if (!config.detect.mention.enabled) return null;
  if (!message.sender || message.system) return null;
  if (message.sender === config.username) return null;
  if (config.ignore.includes(message.sender)) return null;

  const isWhisper = message.channel === 'whisper';
  const named = mentions(message.content, config.username, config.aliases);

  // Nobody keeps saying your name once you are already talking. If we are
  // mid-exchange with them and they are still nearby, their next line is for
  // us whether or not it says "3172".
  // Proximity normally matters here, so a distant player's unrelated chatter is
  // not mistaken for a reply to us. The exception is when we asked them a
  // direct question ("me?"): we started that, so we listen for the answer from
  // wherever they are standing.
  const awaitingReply = store.awaitingAnswer(
    message.sender,
    config.detect.mention.confirmWindowMs,
    ts,
  );
  const continuing =
    !named &&
    store.inConversation(message.sender, config.limits.conversation.windowMs, ts) &&
    (awaitingReply || store.isNearby(message.sender, config.detect.chatRadius, ts));

  // Someone at arm's length saying nothing but hello is talking to us, name or
  // not — and this is what keeps a thread alive when a reply got dropped and
  // no conversation was ever opened.
  const greetingUpClose =
    !named &&
    isGreetingOnly(message.content) &&
    store.isNearby(message.sender, config.detect.mention.greetingRadius, ts);

  if (!named && !continuing && !greetingUpClose &&
      !(isWhisper && config.detect.mention.answerWhispers)) {
    return null;
  }

  // Strip our name out and see whether anything was actually said.
  const remainder = [config.username, shortName(config.username), ...config.aliases]
    .filter(Boolean)
    .reduce((text, name) => text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' '), message.content)
    .replace(/\s+/g, ' ')
    .trim();
  const opener = isGreetingOnly(remainder);
  // "3172" on its own and "yo" are both openers, but they want opposite
  // replies: a bare name call wants "?", a greeting wants a greeting back.
  const greeting = opener && remainder.length > 0;
  // "mb g", "cool cool", "aight bro" — an acknowledgement, not a question.
  const smalltalk = !opener && isSmallTalk(remainder);
  const compliment = !opener && !smalltalk && isCompliment(message.content, named);
  const askedActivity = ACTIVITY_QUESTION.test(message.content);
  // "hows ur day" is not "wyd". Asked together, the personal one wins: they
  // asked after you, and the grind is not an answer to that.
  const askedWellbeing = WELLBEING_QUESTION.test(message.content);

  // Nothing left once the name is gone and it is not a greeting — nothing to
  // answer. (A short message is not the same as an empty one: "wsg" and "idk"
  // are three characters and both want a reply.)
  if (!remainder && !opener) return null;

  return {
    kind: isWhisper ? 'whisper' : 'mention',
    subject: message.sender,
    greeting,
    severity: 1,
    conversational: true,
    opener,
    smalltalk,
    compliment,
    askedActivity: askedActivity && !askedWellbeing,
    askedWellbeing,
    evidence: opener
      ? `${message.sender} just called my name — "${message.content}" — nothing else in it.`
      : smalltalk
      ? `${message.sender} said "${message.content}" — that is an acknowledgement, there is no question in it.`
      : compliment
      ? `${message.sender} said "${message.content}" — that is a compliment, not a question and not an accusation.`
      : `${message.sender} ${isWhisper ? 'whispered' : 'said'} "${message.content}"${
          named ? ` and used my name (${shortName(config.username)})` : ''
        }${continuing ? ', carrying on the conversation we are already having' : ''}.`,
    channel: isWhisper ? 'whisper' : message.channel,
  };
}

/** Hypixel warning us — the caller should go quiet. */
export function detectMuted(message) {
  return message.system && MUTE_NOTICE.test(message.content);
}

/**
 * Run every chat-driven detector and return one trigger, or null.
 *
 * Precedence is fixed rather than sorted by severity, because the phrasings
 * overlap: "macro check, say something if ur real" matches the accusation
 * pattern too, and answering it as a macro check — on the escalation ladder,
 * with the right tone for how long this has been going on — is the better
 * reply. Most specific reading wins.
 *
 * @returns {Trigger|null}
 */
export function detectFromChat(store, config, message, ts = Date.now()) {
  return (
    // A denial answers a question we asked, so it comes before everything.
    detectStandDown(store, config, message, ts) ??
    detectMacroCheckTalk(store, config, message, ts) ??
    detectAccusation(store, config, message, ts) ??
    detectSpotClaim(store, config, message, ts) ??
    detectHostile(store, config, message, ts) ??
    // Before the plain mention: "yo 3712" contains a greeting, but it also
    // contains an attempt at a name that missed. Asking beats assuming.
    detectNearMiss(store, config, message, ts) ??
    detectMention(store, config, message, ts) ??
    null
  );
}
