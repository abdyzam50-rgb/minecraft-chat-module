import { stripFormatting } from './parse.js';

/** Words swapped out when chat.profanity is "clean". */
const SOFTEN = new Map([
  [/\bfuck(?:ing|ed|er|s)?\b/gi, 'freaking'],
  [/\bshit(?:ty|s)?\b/gi, 'rubbish'],
  [/\bbitch(?:es)?\b/gi, 'clown'],
  [/\bcunt\b/gi, 'clown'],
  [/\bdip\s?shit\b/gi, 'genius'],
  [/\bass(?:hole)?\b/gi, 'muppet'],
  [/\bdick(?:head)?\b/gi, 'muppet'],
  [/\bbastard\b/gi, 'muppet'],
  [/\bretard(?:ed)?\b/gi, 'clueless'],
  [/\bdamn\b/gi, 'darn'],
  [/\bhell\b/gi, 'heck'],
  [/\bpiss\s?off\b/gi, 'buzz off'],
]);

/** Blocked outright in every mode — these get you banned, not just muted. */
const NEVER = [
  /https?:\/\//i,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i,
  /\bdiscord\.gg\//i,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/, // IP addresses

  // Telling someone to hurt themselves. This was a line in the prompt and
  // nothing else, which made it a request: the model complied almost always,
  // and "almost always" is not a safety rule. Softening is not an option
  // either — a reworded "kys" still means it — so the line is dropped and
  // nothing is sent.
  /\bkys\b/i,
  /\bkill\s?(?:your|ur|yo)\s?self\b/i,
  /\b(?:neck|hang)\s?(?:your|ur)\s?self\b/i,
  /\bgo\s?die\b/i,

  // Slurs, in every mode. These were only ever softened, and only when
  // profanity was set to clean — so "allow" let them through, which is not
  // what that setting is for. It buys swearing, not this.
  /\bretard(?:ed|s)?\b/i,
  /\bf[a4]gg?(?:ot|s)?\b/i,
  /\btrann(?:y|ies)\b/i,
  /\bn[i1]gg?(?:er|a)s?\b/i,
  /\bsp[a4]stic\b/i,
];

/**
 * Make a model-written line safe to actually type into Minecraft chat.
 *
 * @param {string} raw
 * @param {object} config
 * @param {{shout?: boolean, maxWords?: number, stripNames?: string[], speakers?: string[]}} [options]
 *   shout uppercases the line last, after profanity softening, so "fuck off"
 *   still becomes "FREAKING OFF" and not a shouted swear you didn't ask for.
 *   maxWords and stripNames enforce brevity on replies that must be tiny —
 *   the model keeps sneaking a name and an extra clause into a two-word
 *   answer, and "all g dream, ty" reads as a script.
 * @returns {{ok: boolean, message: string, reason?: string}}
 */
/**
 * Words that cannot end a sentence — they are always reaching for the next
 * one. Trimming to a word count strands them constantly.
 */
const DANGLING =
  /\s+(?:since|about|of|and|but|or|to|for|with|at|in|on|by|from|than|then|so|because|cause|cos|coz|if|when|while|my|your|ur|the|a|an|is|are|was|been|got|just|still|like|out|up|off|over|into|onto)$/i;

export function sanitize(raw, config, options = {}) {
  let text = stripFormatting(String(raw ?? '')).replace(/[\r\n\t]+/g, ' ').trim();
  if (!text) return { ok: false, message: '', reason: 'empty' };

  // Strip surrounding quotes the model sometimes adds.
  text = text.replace(/^["'`](.*)["'`]$/s, '$1').trim();

  // Reported: "dream: grinding ghosts". Shown chat lines as context, the model
  // sometimes writes one back, speaker prefix and all. In game that prefix is
  // added by the server, so typing it produces "3172: dream: ...".
  //
  // Only a name from this exchange counts. A blanket "word colon" rule would
  // also eat "nah: never" and "8:30 works", which are things people type.
  for (const speaker of options.speakers ?? []) {
    if (!speaker) continue;
    const escaped = String(speaker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefix = new RegExp(`^${escaped}\\s*:\\s+(?=\\S)`, 'i');
    if (prefix.test(text)) {
      text = text.replace(prefix, '').trim();
      break;
    }
  }

  // A leading slash would execute a command instead of sending a message.
  text = text.replace(/^[/\\]+/, '').trim();
  if (!text) return { ok: false, message: '', reason: 'command-only' };

  for (const pattern of NEVER) {
    if (pattern.test(text)) return { ok: false, message: '', reason: 'contains a link or address' };
  }

  if (config.chat.profanity === 'clean') {
    for (const [pattern, replacement] of SOFTEN) {
      text = text.replace(pattern, replacement);
    }
  }

  // Minecraft only accepts a subset of characters in chat.
  text = text.replace(/[^ -~¡-ÿ]/g, '').replace(/\s{2,}/g, ' ').trim();
  if (!text) return { ok: false, message: '', reason: 'no sendable characters' };

  for (const [pattern, replacement] of config.chat.corrections ?? []) {
    text = text.replace(new RegExp(pattern, 'gi'), replacement);
  }

  if (options.stripNames?.length) {
    for (const name of options.stripNames) {
      if (!name || name.length < 2) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'gi'), '$1$2');
    }
    text = text.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  }

  if (options.maxWords) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length > options.maxWords) {
      const cut = words.slice(0, options.maxWords).join(' ');
      // Cutting by word count lands mid-clause: "hey, doing good hbu" becomes
      // "hey, doing", which is worse than the sentence it was shortening.
      // Falling back to the last complete clause gives "hey" — short, and a
      // thing a person would actually type.
      const clause = cut.replace(/[,;:—-]\s*\S*$/, '').trim();
      text = clause && /[,;:—-]/.test(cut) ? clause : cut;
      // A hard word cap lands mid-phrase: "been grinding ghosts since about
      // 4am" cut to four words is "been grinding ghosts since", and "move out
      // of my path" is "move out". A line ending on a word that was reaching
      // for the next one is worse than a shorter line, so drop it.
      // Repeatedly: "move out of my path" cut to four is "move out of", and
      // dropping "of" still leaves "out" reaching for something.
      let trimmed = text;
      for (let i = 0; i < 4 && DANGLING.test(trimmed); i += 1) {
        const shorter = trimmed.replace(DANGLING, '').trim();
        if (!shorter) break;
        trimmed = shorter;
      }
      text = trimmed || text;
    }
    // Do not leave a cut-off fragment such as "get a" or "go fuck" in chat.
    if (options.maxWords <= 2) {
      text = text.replace(/^get a$/i, 'get lost').replace(/^go fuck$/i, 'fuck off');
    }
  }

  // Tidy up whatever the trimming left behind — but never into nothing. "?" is
  // a complete reply to a bare call-out, and stripping its leading punctuation
  // would leave an empty message.
  const tidied = text.replace(/^[\s,;:.!?-]+/, '').replace(/[\s,;:-]+$/, '').trim();
  if (tidied) text = tidied;

  if (options.shout) {
    // Yelling is caps, not punctuation soup — a wall of "!!!" reads as a bot.
    text = text.toUpperCase().replace(/!{2,}/g, '!');
  }

  const max = config.chat.maxLength;
  if (text.length > max) {
    const cut = text.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    text = (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
  }

  return { ok: true, message: text };
}

/**
 * Prefix the line with the right command for its channel.
 * `all` sends a bare message; party/guild/whisper need a command.
 */
export function formatForChannel(message, channel, target) {
  switch (channel) {
    case 'party':
      return `/pc ${message}`;
    case 'guild':
      return `/gc ${message}`;
    case 'coop':
      return `/cc ${message}`;
    case 'whisper':
      return target ? `/w ${target} ${message}` : message;
    default:
      return message;
  }
}
