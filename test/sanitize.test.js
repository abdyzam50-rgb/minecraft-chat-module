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
