/**
 * Vernacular the bot needs in order to pass.
 *
 * Two jobs. Comprehension: "u got any mf?" is a question about Magic Find, and
 * a reply that misses that is worse than no reply. And production: a player who
 * writes in full words while everyone around them types "bz" and "ngl" reads
 * as an outsider, which is halfway to reading as a bot.
 *
 * SkyBlock terms below are taken from the community abbreviation guides rather
 * than invented — a wrong term is worse than a missing one.
 */

/** General Minecraft / gaming chat shorthand. */
export const CHAT_SLANG = [
  ['mb', 'my bad'],
  ['np / no worries', 'no problem'],
  ['ty / thx', 'thanks'],
  ['gg', 'good game'],
  ['ez', 'easy'],
  ['ngl', 'not gonna lie'],
  ['fr / frfr', 'for real'],
  ['tbh', 'to be honest'],
  ['ikr', 'i know right'],
  ['idk / idc', "i don't know / i don't care"],
  ['nvm', 'never mind'],
  ['wsg / wsp / wagwan', "what's good — a greeting, answer it like one"],
  ['wyd', 'what you doing'],
  ['hbu / wbu', 'how about you / what about you'],
  ['hru / u good', 'how are you / are you alright'],
  ['nm / nmu', 'nothing much / nothing much, you'],
  ['wdym', 'what do you mean'],
  ['eh? / huh?', "didn't catch that"],
  ['brb / gtg / afk', 'be right back / got to go / away from keyboard'],
  ['lmk', 'let me know'],
  ['ong / istg', 'on god / i swear to god'],
  ['bet / say less', 'agreed, understood'],
  ['no cap / cap', 'no lie / a lie'],
  ['sus', 'suspicious'],
  ['lowkey / highkey', 'slightly / very'],
  ['mid', 'mediocre'],
  ['cracked / goated', 'extremely good'],
  ['washed', 'past their prime'],
  ['W / L', 'win / loss, also used as praise or mockery'],
  ['rip / F', 'sympathy for bad luck'],
  ['bruh / bro / g / twin / gang', 'casual address'],
  ['grinding / farming / camping', 'repeating content for drops'],
  ['u / ur / r / wat / pls', 'ordinary typing shortcuts'],
];

/** SkyBlock-specific terms, by area. */
export const SKYBLOCK_TERMS = [
  ['ah', 'auction house'],
  ['bz / baz', 'bazaar'],
  ['bin', 'buy-it-now auction'],
  ['flip / flipping', 'buying low and reselling'],
  ['lowball', 'offering well under market price'],
  ['k / m / b', 'thousand / million / billion coins'],
  ['purse', 'coins carried'],
  ['npc', 'the vendor price floor'],
  ['insta-buy / insta-sell', 'bazaar instant orders'],
  ['buy order / sell order', 'bazaar limit orders'],
  ['mf', 'magic find (in mining, sometimes mining fortune)'],
  ['ms', 'mining speed'],
  ['hotm', 'heart of the mountain'],
  ['powder', 'mithril / gemstone powder for hotm perks'],
  ['ch', 'crystal hollows'],
  ['div', "divan's gear"],
  ['scatha', 'rare worm in the crystal hollows'],
  ['the mist', 'the ghost area of the dwarven mines — a location: you are "in the mist", and what you kill there is ghosts'],
  ['sorrow / volta / plasma / ghostly boots', 'the ghost drops'],
  ['cata', 'catacombs'],
  ['f1-f7 / m1-m7', 'catacombs floors, normal and master mode'],
  ['carry', 'paying someone to clear content for you'],
  ['comp', 'a floor completion'],
  ['sven / tara / eman / rev / blaze', 'the slayer bosses'],
  ['t4 / t5', 'slayer boss tiers'],
  ['aote / aotd', 'aspect of the end / aspect of the dragons'],
  ['hype / juju / term', 'hyperion / juju shortbow / terminator'],
  ['gdrag', 'golden dragon pet'],
  ['hpb', 'hot potato book'],
  ['clean', 'an item with no enchants or reforge'],
  ['3/4', 'three pieces of one armour set plus one other'],
  ['cc / cd / def / ehp / int / str', 'crit chance, crit damage, defence, effective health, intelligence, strength'],
  ['ironman', 'a profile with no trading'],
  ['mayor', 'the elected mayor and their perks'],
  ['lfg', 'looking for group'],
  ['non', 'a player without a rank or without experience'],
];

/**
 * Renders the glossary for the system prompt. It lives in the cached half, so
 * the length costs almost nothing after the first request.
 */
export function buildSlangSection(config) {
  if (config.slang?.enabled === false) return [];

  const extra = (config.slang?.extra ?? []).map((entry) =>
    Array.isArray(entry) ? `- ${entry[0]} — ${entry[1]}` : `- ${entry}`,
  );

  return [
    'How people around you talk. You know all of this — you read it and you write it, the same as anyone who has played for a while:',
    ...CHAT_SLANG.map(([term, meaning]) => `- ${term} — ${meaning}`),
    '',
    'SkyBlock terms, which you use by default rather than spelling things out:',
    ...SKYBLOCK_TERMS.map(([term, meaning]) => `- ${term} — ${meaning}`),
    ...(extra.length ? ['', 'Also:', ...extra] : []),
    '',
    'Use it the way a person does: naturally, where it fits, not crammed in. Nobody uses five pieces of slang in one line, and a bot trying to sound casual is more obvious than one being plain. Some players type properly — that is fine too, just stay consistent with yourself.',
    'Never use "kys" or anything like it, whatever the local fashion is.',
  ];
}
