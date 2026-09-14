import { mentions, shortName } from '../chat/shortname.js';
import {
  ACCUSATION,
  AGGRESSIVE,
  GREETING_ONLY,
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

  const { patience, rage } = store.patienceFor(message.sender, settings);
  // Being told to prove yourself counts as a block: it is the same test.
  const count = Math.max(settings.threshold, store.blocksWithin(message.sender, settings.windowMs, ts) + 1);

  const trigger = macroCheckTrigger({
    blocker: message.sender,
    count,
    patience,
    rage,
    said: message.content,
    config,
  });
  trigger.conversational = true;
  if (trigger.anger <= store.player(message.sender).lastAnger) return null;
  return trigger;
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
  const nearby = store.isNearby(message.sender, config.detect.chatRadius, ts);
  const hasHistory = store.blocksWithin(message.sender, 120000, ts) > 0;
  const repliedToUs = store.lastOutgoing && ts - store.lastOutgoing.ts <= replyWindowMs;

  const directed = named || nearby || hasHistory || repliedToUs;
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
  const continuing =
    !named &&
    store.inConversation(message.sender, config.limits.conversation.windowMs, ts) &&
    store.isNearby(message.sender, config.detect.chatRadius, ts);

  if (!named && !continuing && !(isWhisper && config.detect.mention.answerWhispers)) return null;
  if (!isWhisper && !looksLikeQuestion(message.content) && message.content.length < 4) return null;

  // Strip our name out and see whether anything was actually said.
  const remainder = [config.username, shortName(config.username), ...config.aliases]
    .filter(Boolean)
    .reduce((text, name) => text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' '), message.content)
    .replace(/\s+/g, ' ')
    .trim();
  const opener = GREETING_ONLY.test(remainder);
  // "mb g", "cool cool", "aight bro" — an acknowledgement, not a question.
  const smalltalk = !opener && isSmallTalk(remainder);

  return {
    kind: isWhisper ? 'whisper' : 'mention',
    subject: message.sender,
    severity: 1,
    conversational: true,
    opener,
    smalltalk,
    evidence: opener
      ? `${message.sender} just called my name — "${message.content}" — nothing else in it.`
      : smalltalk
      ? `${message.sender} said "${message.content}" — that is an acknowledgement, there is no question in it.`
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
    detectMacroCheckTalk(store, config, message, ts) ??
    detectAccusation(store, config, message, ts) ??
    detectSpotClaim(store, config, message, ts) ??
    detectHostile(store, config, message, ts) ??
    detectMention(store, config, message, ts) ??
    null
  );
}
