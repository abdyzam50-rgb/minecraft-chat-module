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

/** "u", "you", "ur" — the accusation is pointed at whoever is being spoken to. */
const SECOND_PERSON = /\b(?:u|you|ur|your|yours|urself|yourself|yall)\b/gi;

/** Someone else entirely is the subject: "most people macro that". */
const THIRD_PARTY = /\b(?:most|some|many|lots|everyone|everybody|people|they|them|their|he|she|others|anyone|someone|somebody|guy|dude|kid|player|players|everybody)\b/gi;

function lastMatchIndex(pattern, text) {
  pattern.lastIndex = 0;
  let index = -1;
  let match;
  while ((match = pattern.exec(text)) !== null) index = match.index;
  return index;
}

/**
 * Who is the accusation about?
 *
 * "most people macro that" is a remark about the economy, not a charge against
 * you, and answering it with "im not macroing" is both a non-sequitur and a
 * confession nobody asked for. So look at what sits in front of the accusing
 * word: whichever subject is nearest wins.
 *
 * @returns {'us'|'someone-else'|'ambiguous'|'none'}
 */
export function accusationTarget(text, isNamed) {
  const content = String(text ?? '');
  ACCUSATION.lastIndex = 0;
  const match = ACCUSATION.exec(content);
  if (!match) return 'none';
  if (isNamed) return 'us';

  const before = content.slice(0, match.index).toLowerCase();
  const second = lastMatchIndex(SECOND_PERSON, before);
  const third = lastMatchIndex(THIRD_PARTY, before);

  if (third > second) return 'someone-else';
  if (second >= 0) return 'us';
  return 'ambiguous';
}

/** Someone telling us to move / complaining about our pathing. */
export const HOSTILE_NUDGE = new RegExp(
  ['get\\s?out', 'move\\b', 'my\\s?spot', 'stop\\s?follow', 'leave\\b', 'go\\s?away'].join('|'),
  'i',
);

/**
 * A greeting with nothing else in it. "yo 3172" is not a question — it wants
 * "?" or "yh?" back, not a sentence about ghost drops.
 */
const GREETING_WORD =
  /^(?:y+o+|h+e+y+|h+i+|hel+o+|sup|wsup|wsp|wsg|wassup|whats|good|wagwan|oi+|psst|a+y+o*|heya|hiya|hola|there|mate|bro|man|g)$/i;

/**
 * Is the message nothing but greeting? Checked word by word, because people
 * stack them — "yo wsg", "hey yo", "wsg bro" are all still just hello, and
 * answering one with what you happen to be doing is volunteering information
 * nobody asked for.
 */
export function isGreetingOnly(text) {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.every((word) => GREETING_WORD.test(word));
}

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

/** Are they actually asking what we are doing? */
export const ACTIVITY_QUESTION =
  /\bwyd\b|\bwhat\b[^?]{0,20}\b(?:you|u|ur)\b[^?]{0,20}\b(?:doing|do|upto|up\s?to|on|grinding|farming)\b|\bwhat\s?(?:you|u)\s?(?:up\s?to|on)\b|\bhows?\s+the\s+(?:grind|farm)\b/i;

/** Praise, rather than a question or a charge. */
const PRAISE =
  /\b(?:rich|wealthy|loaded|cracked|goated|insane|op|pro|beast|godly|impressive|sick|nuts|mental|fire|sweaty|efficient|quick|fast|grinder)\b|\b(?:really|so|very|pretty|mad|well|proper)\s+good\b|\bgood\s+at\b/i;

/**
 * Is this a compliment aimed at us? Ghost grinding is lucrative and everyone
 * knows it, so "you seem rich" is praise, not an allegation — deflecting it
 * reads as guilt about something nobody raised.
 */
export function isCompliment(text, isNamed) {
  const content = String(text ?? '');
  if (!PRAISE.test(content)) return false;
  if (ACCUSATION.test(content)) return false;
  return isNamed || /\b(?:u|you|ur|your|yours)\b/i.test(content);
}

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

/**
 * Damerau-Levenshtein (optimal string alignment), capped.
 *
 * Counting a transposition as one edit rather than two matters here: swapping
 * two characters is the commonest way to fumble a name, and "3127" for "3172"
 * is exactly the case this exists for.
 */
function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  const rows = [];
  for (let i = 0; i <= a.length; i += 1) rows.push([i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i][j - 1] + 1, rows[i - 1][j] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = value;
      best = Math.min(best, value);
    }
    if (best > cap) return cap + 1;
  }
  return rows[a.length][b.length];
}

/**
 * Did they try to type our name and get it slightly wrong?
 *
 * "3127" for "3172" is a transposition, not a different player, and answering
 * it confidently is as odd as ignoring it. Returns the token they actually
 * typed so the reply can ask about it.
 *
 * @param {string} text
 * @param {string} username
 * @param {string[]} aliases
 * @param {string[]} otherPlayers names we know are around, so a real player's
 *   name is never read as a typo of ours
 * @returns {string|null}
 */
export function nearMiss(text, username, aliases = [], otherPlayers = []) {
  const targets = [username, ...aliases].filter(Boolean).map((t) => t.toLowerCase());
  const known = new Set(otherPlayers.filter(Boolean).map((n) => n.toLowerCase()));

  for (const token of String(text ?? '').split(/[^A-Za-z0-9_]+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    if (known.has(lower)) continue; // that is somebody else, spelled correctly
    for (const target of targets) {
      if (lower === target) return null; // spelled ours correctly; not a near miss
      // Short names need a tighter tolerance or every number looks like a typo.
      const allowed = target.length <= 5 ? 1 : 2;
      if (Math.abs(lower.length - target.length) > allowed) continue;
      if (editDistance(lower, target, allowed) <= allowed) return token;
    }
  }
  return null;
}

/** "no", "not you", "wasn't talking to u" — they meant someone else. */
export const DENIAL =
  /^(?:no+|nah+|nope|not\s?(?:you|u|ur)\b|wasn'?t\s?(?:you|u|talking)|someone\s?else|other\s?(?:guy|one)|different\s?(?:guy|person)|my\s?bad\s?(?:not|wrong))/i;

/** "yeah", "you", "ye" — they did mean us. */
export const CONFIRMATION = /^(?:y(?:e+a*h*|up|es|a)|you|u\b|ur|yh|correct|indeed|mhm)/i;
