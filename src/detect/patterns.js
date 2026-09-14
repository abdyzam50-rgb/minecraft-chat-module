/** Shared phrase matching for the detectors. */

/** Accusations of cheating, macroing, botting, autoclicking. */
export const ACCUSATION = new RegExp(
  [
    'cheat(?:er|ing|s)?',
    'hack(?:er|ing|s|usator)?',
    'hacc?ing',
    'macro(?:ing|er|s)?',
    'botting',
    '(?:you|u|ur|your|yo)\\s*(?:re|r)?\\s*a?\\s*bot\\b',
    'autoclick(?:er|ing)?',
    'auto\\s?click',
    'script(?:ing|er)?',
    'forge\\s?mod(?:s)?\\s?ban',
    'unfair\\s?advantage',
    'i(?:\'| a)?m\\s?reporting\\s?(?:you|u)',
    'report(?:ing|ed)?\\s?(?:you|u)\\b',
    'gonna\\s?get\\s?(?:you|u)\\s?banned',
    'ban(?:nable|ned)?\\s?(?:soon|for\\s?this)',
  ].join('|'),
  'i',
);

/**
 * Things people say while macro checking — standing in your face to see if you
 * react like a human. Hitting any of these is as good as them blocking you.
 */
export const MACRO_CHECK_TALK = new RegExp(
  [
    '\\bmacro\\s?check',
    '\\b(?:u|you|ur|are\\s?(?:u|you))\\s+(?:real|afk|alive|human|a\\s?bot)\\b',
    '\\b(?:say|type|do)\\s+(?:something|smth|anything)\\b',
    '\\b(?:react|respond)\\b',
    '\\bhit\\s?me\\s?if\\b',
    '\\bmove\\s?if\\s?(?:u|you|ur)\\b',
    '\\bprove\\s+(?:u|you|ur|your)\\s*(?:re|r)?\\s*(?:not|human|real)\\b',
    '\\bchecking\\s+(?:if|u|you)\\b',
  ].join('|'),
  'i',
);

/**
 * Someone laying a fair claim to the spot — they were here first, or they are
 * mining this vein, or they are politely asking for room. Different from
 * hostility: this one deserves a "mb, ill move", not attitude.
 */
export const SPOT_CLAIM = new RegExp(
  [
    '\\b(?:was|were)\\s?(?:here|there)\\s?first\\b',
    '\\bi\\s?was\\s?here\\b',
    '\\bbeen\\s?(?:here|farming|mining|grinding)\\s?(?:first|longer|a\\s?while|since|for)\\b',
    '\\b(?:this\\s?is\\s?)?my\\s?(?:spot|vein|lane|corner|area)\\b',
    '\\b(?:im|i\\s?am|i\\s?m)\\s?(?:mining|farming|grinding|killing|working)\\s?(?:here|this)\\b',
    '\\b(?:can|could|would)\\s?(?:you|u)\\s?(?:please\\s?)?(?:move|shift|go)\\b',
    '\\bmind\\s?moving\\b',
    '\\b(?:you|u)\\s?(?:took|stole|nicked)\\s?my\\b',
    '\\bi\\s?had\\s?(?:this|that)\\b',
  ].join('|'),
  'i',
);

/** Politeness markers — "excuse me" turns a demand into a request. */
export const POLITE = /\b(?:excuse\s?me|please|pls|sorry|mind\s?if|would\s?you|could\s?you|thanks|ty)\b/i;

/** Real aggression, as opposed to a blunt but fair request. */
export const AGGRESSIVE = /\b(?:fuck|piss|shut\s?up|idiot|clown|dumb|stupid|loser|trash|get\s?(?:out|lost)|go\s?away|scram)\b/i;

/** Someone telling us to move / complaining about our pathing. */
export const HOSTILE_NUDGE = new RegExp(
  ['get\\s?out', 'move\\b', 'my\\s?spot', 'stop\\s?follow', 'leave\\b', 'go\\s?away'].join('|'),
  'i',
);

/**
 * A greeting with nothing else in it. "yo 3172" is not a question — it wants
 * "?" or "yh?" back, not a sentence about ghost drops.
 */
export const GREETING_ONLY =
  /^(?:y+o+|h+e+y+|h+i+|hello|hell+o+|sup|wsup|wsp|wsg|wassup|whats\s?good|wagwan|oi+|psst|a+y+o*|heya|hiya|hola|yo+)?[\s!?.,]*$/i;

/**
 * Words that carry no content on their own. A message made entirely of these
 * is an acknowledgement — "mb g", "cool cool", "aight bro" — and wants a token
 * back or nothing at all, never a sentence.
 */
const FILLER_WORDS = new Set([
  'mb', 'my', 'bad', 'soz', 'sorry', 'apologies',
  'all', 'g', 'good', 'np', 'no', 'worries', 'problem', 'fine',
  'cool', 'nice', 'aight', 'ight', 'alr', 'alright', 'ok', 'okay', 'kk', 'k',
  'gotcha', 'ic', 'i', 'see', 'fair', 'enough', 'true', 'word', 'bet', 'facts',
  'lol', 'lmao', 'lmfao', 'haha', 'hahaha', 'hah', 'xd', 'rip',
  'gg', 'ty', 'thanks', 'thx', 'tysm', 'cheers', 'ez',
  'yh', 'yeah', 'ya', 'yep', 'yup', 'nah', 'oh', 'ah', 'ahh', 'damn',
  'bro', 'man', 'mate', 'lad', 'dude', 'bruh', 'gang', 'twin',
]);

/**
 * Is the whole message filler? Checked against what is left after our own name
 * is stripped out.
 */
export function isSmallTalk(text) {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.every((word) => FILLER_WORDS.has(word));
}

/**
 * Shorthand questions. These are three letters long and carry a real question,
 * so they must not be mistaken for noise.
 */
export const SHORT_QUESTION = /^(?:wyd|wbu|hbu|wu|hru|u\s?(?:good|ok|gud)|ya\s?good)[\s!?.]*$/i;

/** A question aimed at us. */
export function looksLikeQuestion(text) {
  return (
    /\?\s*$/.test(text) ||
    SHORT_QUESTION.test(String(text ?? '').trim()) ||
    /^(what|why|how|who|where|when|are|is|do|does|can|u\s|you\s)/i.test(text)
  );
}

/** Hypixel telling us we've been muted or warned — always stop talking. */
export const MUTE_NOTICE = /(you (?:are|have been) (?:muted|banned)|cannot send|blocked by hypixel|punish)/i;
