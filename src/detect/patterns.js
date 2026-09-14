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

/** Someone telling us to move / complaining about our pathing. */
export const HOSTILE_NUDGE = new RegExp(
  ['get\\s?out', 'move\\b', 'my\\s?spot', 'stop\\s?follow', 'leave\\b', 'go\\s?away'].join('|'),
  'i',
);

/** A question aimed at us. */
export function looksLikeQuestion(text) {
  return /\?\s*$/.test(text) || /^(what|why|how|who|where|when|are|is|do|does|can|u\s|you\s)/i.test(text);
}

/** Hypixel telling us we've been muted or warned — always stop talking. */
export const MUTE_NOTICE = /(you (?:are|have been) (?:muted|banned)|cannot send|blocked by hypixel|punish)/i;
