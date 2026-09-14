import { mentions, shortName } from '../chat/shortname.js';
import { ACCUSATION, HOSTILE_NUDGE, MUTE_NOTICE, looksLikeQuestion } from './patterns.js';

/**
 * A trigger is "something happened that might deserve a reply".
 *
 * @typedef {Object} Trigger
 * @property {string} kind        pathfinder_blocked | accusation | mention | whisper | hostile
 * @property {string|null} subject player the reply is aimed at
 * @property {number} severity    1 (mild) .. 3 (they are really at it)
 * @property {string} evidence    human-readable reason, also fed to the model
 * @property {string} channel     where to reply
 */

/**
 * Detects a player repeatedly standing in front of the pathfinder.
 * Fires only once the same player has blocked us `threshold` times inside the
 * window, so a single unlucky walk-by stays ignored.
 */
export function detectPathfinderBlock(store, config, ts = Date.now()) {
  const { threshold, windowMs, radius } = config.detect.pathfinder;
  const blocker = store.pathfinder.blockedBy;
  if (!blocker) return null;
  if (config.ignore.includes(blocker)) return null;

  const count = store.blocksWithin(blocker, windowMs, ts);
  if (count < threshold) return null;
  if (!store.isNearby(blocker, radius, ts)) return null;

  const stuckFor = store.pathfinder.blockedSince ? ts - store.pathfinder.blockedSince : 0;
  return {
    kind: 'pathfinder_blocked',
    subject: blocker,
    severity: count >= threshold * 2 ? 3 : 2,
    evidence:
      `${blocker} has stepped in front of my pathfinder ${count} times in the last ` +
      `${Math.round(windowMs / 1000)}s (stalled ${Math.round(stuckFor / 1000)}s), so my route keeps stopping.`,
    channel: 'all',
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
  const nearby = store.isNearby(message.sender, config.detect.pathfinder.radius * 3, ts);
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
    evidence:
      `${message.sender} said "${message.content}" — they are accusing me of cheating or macroing` +
      (hasHistory ? ', right after blocking my pathfinder' : '') +
      (priors ? `. That is accusation #${priors + 1} from them in the last 5 minutes` : '') +
      '.',
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
      !store.isNearby(message.sender, config.detect.pathfinder.radius * 3, ts)) {
    return null;
  }

  return {
    kind: 'hostile',
    subject: message.sender,
    severity: 1,
    evidence: `${message.sender} said "${message.content}" while standing near me.`,
    channel: message.channel === 'whisper' ? 'whisper' : message.channel,
  };
}

/** Plain mention or whisper — someone is talking to us and wants an answer. */
export function detectMention(store, config, message) {
  if (!config.detect.mention.enabled) return null;
  if (!message.sender || message.system) return null;
  if (message.sender === config.username) return null;
  if (config.ignore.includes(message.sender)) return null;

  const isWhisper = message.channel === 'whisper';
  const named = mentions(message.content, config.username, config.aliases);
  if (!named && !(isWhisper && config.detect.mention.answerWhispers)) return null;
  if (!isWhisper && !looksLikeQuestion(message.content) && message.content.length < 4) return null;

  return {
    kind: isWhisper ? 'whisper' : 'mention',
    subject: message.sender,
    severity: 1,
    evidence: `${message.sender} ${isWhisper ? 'whispered' : 'said'} "${message.content}"${
      named ? ` and used my name (${shortName(config.username)})` : ''
    }.`,
    channel: isWhisper ? 'whisper' : message.channel,
  };
}

/** Hypixel warning us — the caller should go quiet. */
export function detectMuted(message) {
  return message.system && MUTE_NOTICE.test(message.content);
}

/**
 * Run every chat-driven detector and return the most severe trigger, or null.
 * @returns {Trigger|null}
 */
export function detectFromChat(store, config, message, ts = Date.now()) {
  const candidates = [
    detectAccusation(store, config, message, ts),
    detectHostile(store, config, message, ts),
    detectMention(store, config, message),
  ].filter(Boolean);

  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.severity - a.severity)[0];
}
