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
];

/**
 * Make a model-written line safe to actually type into Minecraft chat.
 *
 * @param {string} raw
 * @param {object} config
 * @param {{shout?: boolean, maxWords?: number, stripNames?: string[]}} [options]
 *   shout uppercases the line last, after profanity softening, so "fuck off"
 *   still becomes "FREAKING OFF" and not a shouted swear you didn't ask for.
 *   maxWords and stripNames enforce brevity on replies that must be tiny —
 *   the model keeps sneaking a name and an extra clause into a two-word
 *   answer, and "all g dream, ty" reads as a script.
 * @returns {{ok: boolean, message: string, reason?: string}}
 */
export function sanitize(raw, config, options = {}) {
  let text = stripFormatting(String(raw ?? '')).replace(/[\r\n\t]+/g, ' ').trim();
  if (!text) return { ok: false, message: '', reason: 'empty' };

  // Strip surrounding quotes the model sometimes adds.
  text = text.replace(/^["'`](.*)["'`]$/s, '$1').trim();

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
    if (words.length > options.maxWords) text = words.slice(0, options.maxWords).join(' ');
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
