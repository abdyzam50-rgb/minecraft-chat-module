/**
 * Parse raw Minecraft chat lines into structured messages.
 *
 * Tuned for Hypixel / Hypixel Skyblock, which prefixes lines with rank tags,
 * channel markers and (in Skyblock) a level badge:
 *
 *   [MVP+] Notch: hey
 *   [123] [MVP++] Notch: hey                (skyblock level badge)
 *   Party > [VIP] Notch: hey
 *   Guild > [MVP+] Notch [Officer]: hey
 *   From [MVP+] Notch: hey                  (whisper in)
 *   To Notch: hey                           (whisper out)
 *   Co-op > Notch: hey
 */

const SECTION_CODE = /§[0-9a-fk-or]/gi;
const RANK_TAG = /^\[[^\]]*\]\s*/;

/** Remove §-colour codes and normalise whitespace. */
export function stripFormatting(line) {
  return String(line ?? '')
    .replace(SECTION_CODE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const CHANNELS = [
  [/^Party\s*>\s*/i, 'party'],
  [/^Guild\s*>\s*/i, 'guild'],
  [/^Co-?op\s*>\s*/i, 'coop'],
  [/^Officer\s*>\s*/i, 'guild'],
  [/^From\s+/i, 'whisper'],
  [/^To\s+/i, 'whisper-out'],
];

// Vanilla caps names at 16, but bots and cracked servers exceed it — match up
// to the first non-name character instead of trusting the length.
const USERNAME = /^([A-Za-z0-9_]{2,24})(?=[^A-Za-z0-9_]|$)/;

/**
 * @param {string} raw a single chat line, colour codes optional
 * @returns {{channel: string, sender: string|null, content: string, raw: string, system: boolean}}
 */
export function parseChatLine(raw) {
  const clean = stripFormatting(raw);
  let rest = clean;
  let channel = 'all';

  for (const [pattern, name] of CHANNELS) {
    if (pattern.test(rest)) {
      rest = rest.replace(pattern, '');
      channel = name;
      break;
    }
  }

  // Strip leading badges: skyblock level, rank, guild tag — any number of them.
  while (RANK_TAG.test(rest)) rest = rest.replace(RANK_TAG, '');

  const nameMatch = rest.match(USERNAME);
  if (!nameMatch) {
    return { channel, sender: null, content: clean, raw: clean, system: true };
  }

  const sender = nameMatch[1];
  let after = rest.slice(sender.length).trimStart();

  // Trailing badges between the name and the colon: "Notch [Officer]: hi"
  while (RANK_TAG.test(after)) after = after.replace(RANK_TAG, '');

  if (!after.startsWith(':')) {
    // No colon — this is a system line that happens to start with a name,
    // e.g. "Notch joined the lobby" or "Notch has muted you".
    return { channel, sender: null, content: clean, raw: clean, system: true };
  }

  return {
    channel,
    sender,
    content: after.slice(1).trim(),
    raw: clean,
    system: false,
  };
}
