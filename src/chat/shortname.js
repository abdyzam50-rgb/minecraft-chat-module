/**
 * Turn a Minecraft username into the short form people actually type in chat:
 * "xX_DreamSlayer_Xx" -> "Dream", "Technoblade" -> "Techno", "Bob123" -> "Bob".
 */

const DECOR = /^(?:xX|Xx|_+|-+)|(?:xX|Xx|_+|-+)$/g;

/** Split on separators, digits, and camelCase humps. */
function tokenize(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .filter(Boolean);
}

/** Common noise words that are never the memorable part of a name. */
const FILLER = new Set([
  'the', 'mr', 'its', 'im', 'yt', 'ttv', 'lol', 'xd', 'god', 'king', 'lord',
  'pro', 'noob', 'gamer', 'player', 'official', 'real', 'mc',
]);

/** Drop trailing consonants so "Technobl" reads as "Techno". */
function trimToSyllable(token) {
  let out = token;
  while (out.length > 5 && !/[aeiouy]$/i.test(out)) out = out.slice(0, -1);
  return out;
}

/**
 * @param {string} username
 * @param {{maxLength?: number, overrides?: Record<string,string>}} [options]
 * @returns {string}
 */
export function shortName(username, options = {}) {
  const { maxLength = 8, overrides = {} } = options;
  const name = String(username ?? '').trim();
  if (!name) return '';

  // Manual overrides win, case-insensitively.
  for (const [key, value] of Object.entries(overrides)) {
    if (key.toLowerCase() === name.toLowerCase()) return value;
  }

  // Already short and free of decoration — people just say the whole thing.
  if (name.length <= maxLength && /^[A-Za-z]+$/.test(name)) return name;

  const stripped = name.replace(DECOR, '');
  const tokens = tokenize(stripped);
  if (tokens.length === 0) return name.slice(0, maxLength);

  const meaningful = tokens.filter((t) => t.length >= 3 && !FILLER.has(t.toLowerCase()));
  const pool = meaningful.length ? meaningful : tokens;

  // Prefer the first long-enough token — that's the part people say out loud.
  let pick = pool.find((t) => t.length >= 4) ?? pool[0];
  if (pick.length > maxLength) pick = trimToSyllable(pick.slice(0, maxLength));
  if (pick.length < 3) return name;

  return pick.charAt(0).toUpperCase() + pick.slice(1);
}

/**
 * Does `text` refer to `username`? Matches the full name, the short form and
 * any configured aliases, on word boundaries and case-insensitively.
 */
function wordMatch(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i').test(haystack);
}

export function mentions(text, username, extra = []) {
  const haystack = String(text ?? '').toLowerCase();
  const candidates = [username, shortName(username), ...extra]
    .filter(Boolean)
    .map((c) => String(c).toLowerCase());

  if (candidates.some((needle) => needle.length >= 3 && wordMatch(haystack, needle))) {
    return true;
  }

  // People also clip names freely ("techno" for "Technoblade"), so treat any
  // word in the text that prefixes the username as a mention.
  const full = String(username ?? '').toLowerCase();
  if (full.length < 5) return false;
  return haystack
    .split(/[^a-z0-9_]+/)
    .some((word) => word.length >= 4 && full.startsWith(word));
}
