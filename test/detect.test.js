import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextStore } from '../src/context/store.js';
import { resolveConfig } from '../src/config.js';
import { detectFromChat, detectPathfinderBlock, detectMuted } from '../src/detect/index.js';

const NOW = 1_700_000_000_000;

function setup(overrides = {}) {
  const config = resolveConfig({ username: 'Technoblade', ...overrides });
  const store = new ContextStore({ now: () => NOW });
  store.updateSelf({ username: config.username });
  return { config, store };
}

function chat(sender, content, channel = 'all') {
  return { sender, content, channel, system: false, raw: `${sender}: ${content}` };
}

test('ignores a single walk-by in front of the pathfinder', () => {
  const { config, store } = setup();
  store.updateNearby([{ name: 'Griefer', distance: 2 }], NOW);
  store.updatePathfinder({ state: 'blocked', blockedBy: 'Griefer' }, NOW);
  assert.equal(detectPathfinderBlock(store, config, NOW), null);
});

test('fires once someone blocks repeatedly', () => {
  const { config, store } = setup();
  store.updateNearby([{ name: 'Griefer', distance: 2 }], NOW);
  store.recordBlock('Griefer', NOW - 2000);
  store.recordBlock('Griefer', NOW - 1000);
  store.updatePathfinder({ state: 'blocked', blockedBy: 'Griefer' }, NOW);

  const trigger = detectPathfinderBlock(store, config, NOW);
  assert.equal(trigger.kind, 'pathfinder_blocked');
  assert.equal(trigger.subject, 'Griefer');
});

test('never targets an ignored player', () => {
  const { config, store } = setup({ ignore: ['Griefer'] });
  store.updateNearby([{ name: 'Griefer', distance: 2 }], NOW);
  for (let i = 0; i < 5; i += 1) store.recordBlock('Griefer', NOW - i * 500);
  store.updatePathfinder({ state: 'blocked', blockedBy: 'Griefer' }, NOW);
  assert.equal(detectPathfinderBlock(store, config, NOW), null);
});

test('catches cheating accusations aimed at us', () => {
  const { config, store } = setup();
  store.updateNearby([{ name: 'Accuser', distance: 3 }], NOW);
  const trigger = detectFromChat(store, config, chat('Accuser', 'ur macroing bro'), NOW);
  assert.equal(trigger.kind, 'accusation');
  assert.equal(trigger.subject, 'Accuser');
});

test('ignores accusations aimed at someone else across the lobby', () => {
  const { config, store } = setup();
  const trigger = detectFromChat(store, config, chat('Stranger', 'that guy is hacking'), NOW);
  assert.equal(trigger, null);
});

test('an accusation naming us counts even from far away', () => {
  const { config, store } = setup();
  const trigger = detectFromChat(store, config, chat('Stranger', 'techno is 100% cheating'), NOW);
  assert.equal(trigger?.kind, 'accusation');
});

test('accusations outrank plain mentions', () => {
  const { config, store } = setup();
  store.updateNearby([{ name: 'Accuser', distance: 3 }], NOW);
  const trigger = detectFromChat(store, config, chat('Accuser', 'techno ur cheating'), NOW);
  assert.equal(trigger.kind, 'accusation');
});

test('answers whispers', () => {
  const { config, store } = setup();
  const trigger = detectFromChat(store, config, chat('Friend', 'you there?', 'whisper'), NOW);
  assert.equal(trigger.kind, 'whisper');
  assert.equal(trigger.channel, 'whisper');
});

test('recognises a server mute notice', () => {
  assert.equal(detectMuted({ system: true, content: 'You are muted for 1h' }), true);
  assert.equal(detectMuted({ system: true, content: 'Welcome to Hypixel' }), false);
});
