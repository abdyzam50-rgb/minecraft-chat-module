import test from 'node:test';
import assert from 'node:assert/strict';
import { Policy } from '../src/chat/policy.js';
import { resolveConfig } from '../src/config.js';

function makePolicy(overrides = {}) {
  let clock = 1_000_000;
  const config = resolveConfig({ username: 'Notch', ...overrides });
  const policy = new Policy(config, { now: () => clock });
  return { policy, advance: (ms) => { clock += ms; }, config };
}

const trigger = { kind: 'accusation', subject: 'Griefer', channel: 'all' };

test('enforces the global cooldown', () => {
  const { policy, advance } = makePolicy();
  policy.record(trigger, 'first');
  assert.equal(policy.check({ ...trigger, kind: 'mention', subject: 'Other' }).allowed, false);
  advance(9000);
  assert.equal(policy.check({ ...trigger, kind: 'mention', subject: 'Other' }).allowed, true);
});

test('stops arguing with the same player forever', () => {
  const { policy, advance } = makePolicy({
    limits: { globalCooldownMs: 0, perKindCooldownMs: 0, perPlayerCooldownMs: 0 },
  });
  policy.record(trigger, 'one');
  policy.record(trigger, 'two');
  advance(1000);
  const result = policy.check(trigger);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /in a row/);
});

test('blocks duplicate messages inside the dedupe window', () => {
  const { policy, advance } = makePolicy({
    limits: { globalCooldownMs: 0, perKindCooldownMs: 0, perPlayerCooldownMs: 0, maxConsecutivePerPlayer: 99 },
  });
  policy.record(trigger, 'move please');
  advance(1000);
  assert.equal(policy.check(trigger, 'move please').allowed, false);
  assert.equal(policy.check(trigger, 'something else').allowed, true);
});

test('respects the per-minute ceiling', () => {
  const { policy, advance } = makePolicy({
    limits: { globalCooldownMs: 0, perKindCooldownMs: 0, perPlayerCooldownMs: 0, maxPerMinute: 2 },
  });
  policy.record({ ...trigger, subject: 'A' }, 'a');
  policy.record({ ...trigger, subject: 'B' }, 'b');
  advance(500);
  assert.equal(policy.check({ ...trigger, subject: 'C' }).allowed, false);
  advance(61000);
  assert.equal(policy.check({ ...trigger, subject: 'C' }).allowed, true);
});

test('goes quiet after a server mute', () => {
  const { policy, advance } = makePolicy();
  policy.silence(60000);
  assert.equal(policy.check(trigger).allowed, false);
  advance(61000);
  assert.equal(policy.check(trigger).allowed, true);
});

test('only speaks in enabled channels', () => {
  const { policy } = makePolicy({ chat: { speakIn: ['party'] } });
  assert.equal(policy.check({ ...trigger, channel: 'all' }).allowed, false);
  assert.equal(policy.check({ ...trigger, channel: 'party' }).allowed, true);
  assert.equal(policy.check({ ...trigger, channel: 'whisper' }).allowed, true);
});
