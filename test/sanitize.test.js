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
