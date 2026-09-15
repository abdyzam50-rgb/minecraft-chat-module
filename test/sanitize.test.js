import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, formatForChannel } from '../src/chat/sanitize.js';
import { resolveConfig } from '../src/config.js';

const clean = resolveConfig({ username: 'Notch' });
const raw = resolveConfig({ username: 'Notch', chat: { profanity: 'allow' } });

test('strips a leading slash so a reply can never run a command', () => {
  const result = sanitize('/msg Notch hi', clean);
  assert.equal(result.ok, true);
  assert.ok(!result.message.startsWith('/'));
});

test('rejects links and addresses in both modes', () => {
  assert.equal(sanitize('join https://evil.example', clean).ok, false);
  assert.equal(sanitize('join discord.gg/abc', raw).ok, false);
});

test('softens profanity only in clean mode', () => {
  assert.ok(!/fuck/i.test(sanitize('fuck off dipshit', clean).message));
  assert.equal(sanitize('fuck off', raw).message, 'fuck off');
});

test('truncates on a word boundary', () => {
  const config = resolveConfig({ username: 'Notch', chat: { maxLength: 20 } });
  const result = sanitize('this line is definitely far too long for the chat box', config);
  assert.ok(result.message.length <= 20);
  assert.ok(!result.message.endsWith(' '));
});

test('drops newlines and surrounding quotes', () => {
  assert.equal(sanitize('"hey\nthere"', clean).message, 'hey there');
});

test('formats per channel', () => {
  assert.equal(formatForChannel('hi', 'all'), 'hi');
  assert.equal(formatForChannel('hi', 'party'), '/pc hi');
  assert.equal(formatForChannel('hi', 'whisper', 'Notch'), '/w Notch hi');
});

test('fixes phrasings no player uses, and leaves the correct ones alone', () => {
  assert.equal(sanitize('nah just grinding mist g', clean).message, 'nah just grinding ghosts g');
  assert.equal(sanitize('been farming the mist all night', clean).message, 'been farming ghosts all night');
  assert.equal(sanitize('doing mist for sorrow', clean).message, 'doing ghosts for sorrow');

  // "in the mist" is a location and stays put.
  assert.equal(sanitize('in the mist grinding ghosts', clean).message, 'in the mist grinding ghosts');
  assert.equal(sanitize('grinding ghosts rn', clean).message, 'grinding ghosts rn');
});

test('corrections are configurable', () => {
  const config = resolveConfig({
    username: 'Notch',
    chat: { corrections: [['\\bcata\\b', 'catacombs']] },
  });
  assert.equal(sanitize('doing cata later', config).message, 'doing catacombs later');
});

test('a punctuation-only reply survives the terse trim', () => {
  // "?" is a complete answer to a bare call-out. Tidying its leading
  // punctuation away left an empty message, which was sent as nothing at all.
  const terse = { maxWords: 2, stripNames: ['Nova_77', 'Nova'] };
  for (const text of ['?', 'yh?', '!', '...']) {
    const result = sanitize(text, clean, terse);
    assert.equal(result.ok, true, text);
    assert.equal(result.message, text);
  }
});

test('the terse trim still does its job', () => {
  const terse = { maxWords: 2, stripNames: ['xX_DreamSlayer_Xx', 'Dream'] };
  assert.equal(sanitize('all g dream, ty', clean, terse).message, 'all g');
  assert.equal(sanitize('Dream alr', clean, terse).message, 'alr');
});

test('trimming to a word count never leaves half a clause', () => {
  // Observed live: "hey, doing good hbu" trimmed to two words came out as
  // "hey, doing" — a fragment, which is a worse reply than the sentence it
  // was shortening. Fall back to the last complete clause instead.
  const config = resolveConfig({ username: '3172' });
  assert.equal(sanitize('hey, doing good hbu', config, { maxWords: 2 }).message, 'hey');
  assert.equal(sanitize('yo, whats good man', config, { maxWords: 2 }).message, 'yo');

  // With no clause break there is nothing to fall back to, so a plain cut
  // still applies — and it must not empty a reply that had content.
  assert.equal(sanitize('just grinding ghosts here', config, { maxWords: 2 }).message, 'just grinding');
  assert.equal(sanitize('?', config, { maxWords: 2 }).message, '?');
  assert.equal(sanitize('yo wsg', config, { maxWords: 2 }).message, 'yo wsg');
});
