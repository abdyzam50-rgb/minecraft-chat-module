/**
 * Near-duplicate detection for outgoing chat.
 *
 * Exact-match dedupe is not enough to pass as a person. "dream move out of my
 * path" and "dream move out my path" are different strings and the same
 * message, and a player reading chat clocks the pattern immediately.
 *
 * Dice coefficient over character trigrams: reliable on short strings, where
 * word-set overlap is too coarse to mean anything.
 */

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(text) {
  const padded = `  ${text} `;
  const set = new Set();
  for (let i = 0; i < padded.length - 2; i += 1) set.add(padded.slice(i, i + 3));
  return set;
}

/**
 * @returns {number} 0 (nothing in common) .. 1 (identical)
 */
export function similarity(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const first = trigrams(left);
  const second = trigrams(right);
  let shared = 0;
  for (const gram of first) if (second.has(gram)) shared += 1;
  return (2 * shared) / (first.size + second.size);
}

/**
 * Compare with the addressee's name removed — otherwise every line aimed at the
 * same player looks alike just because it opens with their name.
 */
export function similarityIgnoringNames(a, b, names = []) {
  const strip = (text) => {
    let out = normalize(text);
    for (const name of names) {
      const clean = normalize(name);
      if (clean) out = out.split(clean).join(' ');
    }
    return out.replace(/\s+/g, ' ').trim();
  };
  return similarity(strip(a), strip(b));
}

/**
 * @param {string} candidate
 * @param {string[]} recent  previously sent lines, newest first
 * @param {{threshold?: number, names?: string[]}} [options]
 * @returns {{repeat: boolean, score: number, match: string|null}}
 */
export function findRepeat(candidate, recent, options = {}) {
  const { threshold = 0.55, names = [] } = options;
  let worst = { repeat: false, score: 0, match: null };

  for (const previous of recent) {
    const score = similarityIgnoringNames(candidate, previous, names);
    if (score > worst.score) worst = { repeat: score >= threshold, score, match: previous };
  }
  return worst;
}
