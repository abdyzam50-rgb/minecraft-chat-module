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
  ['hbu / wbu', 'how about you / what about you — good after a greeting ("yo hbu"), odd as a whole reply to one'],
  ['hru / u good', 'how are you / are you alright'],
  ['nm / nmu', 'nothing much / nothing much, you — an answer to "wyd", so it needs the question first'],
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
  ['aight / ight / alr / all g', 'alright / all good — acknowledgement or agreement'],
  ['nbd / dw / yw', 'no big deal / do not worry / you are welcome'],
  ['gl / glhf / wp', 'good luck / good luck have fun / well played'],
  ['lol / lmao / lmfao / smh', 'laughing or mild disbelief — use only when something is actually funny or surprising'],
  ['fs / imo / imho / tbf', 'for sure / in my opinion / in my humble opinion / to be fair'],
  ['idrm / rn / atm / bc', "i do not remember / right now / at the moment / because"],
  ['js / ion / yk / yall', 'just / i do not / you know / you all; ion is chat spelling, not the science word'],
  ['cba', 'cannot be bothered'],
  ['fym / fwiw', 'what do you mean (stronger than wdym) / for what it is worth'],
  ['wb', 'welcome back'],
  ['pmo', 'context-dependent: "put me on" (recommend it) or "pissing me off"; ask if unclear'],
  ['deadass', 'seriously; emphatic agreement or disbelief'],
  ['cooked / lock in', 'doing badly or doomed / focus and play seriously'],
  ['aura / aura farming', 'social coolness / doing something for social credit, usually jokingly'],
  ['valid / based', 'fair or good / admirably direct or correct, often half-joking'],
  ['brodie / unc', 'casual address / an older or out-of-touch player, usually teasing'],
  ['gm / gn', 'good morning / good night'],
  ['inv / req / add', 'invite me / send a friend request / add me'],
  ['dm / msg', 'direct message / message'],
  ['watcha / whatcha / whatchu / wut u doin', 'what are you doing — casual activity question; small spelling differences carry the same intent'],
  ['how r u / how ya doin', 'how are you — a wellbeing question, not a question about the grind'],
  ['up2 / sup2', 'up to / what are you up to'],
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
  ['sb', 'SkyBlock'],
  ['lbin', 'lowest current buy-it-now price; a quick reference, not automatically an item value'],
  ['c/o / s/b / b/o', 'current offer / starting bid / buyout in an auction'],
  ['nw', 'net worth — estimated profile value, often only an estimate'],
  ['mp', 'magical power from accessories'],
  ['pf', 'party finder'],
  ['secrets / s+ / pb', 'dungeon room secrets / S+ score / personal best'],
  ['rng meter', 'a meter that lets dungeon or slayer players target rare drops over time'],
  ['fd', 'final destination armour, usually for enderman slayer'],
  ['necron / storm / maxor / goldor', 'the four Wither armour sets used in dungeons'],
  ['crimson / aurora / terror / hollow', 'Kuudra armour sets, often called attributes gear'],
  ['kuudra', 'Crimson Isle boss with tiers including t1-t5'],
  ['fuming', 'fuming potato book upgrade'],
  ['recomb / recom', 'recombobulator upgrade that increases an item rarity'],
  ['g6p6', 'growth 6 and protection 6 enchantments'],
  ['gexp', 'guild experience'],
  ['req', 'requirement — gear, level, completion, or stat needed to join'],
  ['eman carry / kuudra carry', 'paying a stronger player or party to clear the named content'],
  ['frag run', 'repeating dungeon entrance runs for boss fragments'],
  ['diana / aatrox / derpy / cole', 'mayors with event-specific perks; current perks can change'],
  ['coop', 'players sharing one SkyBlock profile'],
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
    'Meanings are for comprehension first. Do not force slang into a reply, do not imitate a word the other player did not use unless it genuinely fits, and ask a short clarifying question when an abbreviation is ambiguous.',
    'Never use "kys" or anything like it, whatever the local fashion is.',
  ];
}
