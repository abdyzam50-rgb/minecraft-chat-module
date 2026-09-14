import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextStore } from '../src/context/store.js';
import { resolveConfig } from '../src/config.js';
import { detectFromChat, detectPathfinderBlock, detectMuted } from '../src/detect/index.js';

const NOW = 1_700_000_000_000;

function setup(overrides = {}, random = () => 0) {
  const config = resolveConfig({ username: 'Technoblade', ...overrides });
  const store = new ContextStore({ now: () => NOW, random });
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
  assert.equal(trigger.kind, 'macro_check');
  assert.equal(trigger.subject, 'Griefer');
  assert.equal(trigger.anger, 1);
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

test('a macro check escalates: warn, then harden, then yell', () => {
  // random() === 0 rolls the shortest fuse: patience 4, rage 6.
  const { config, store } = setup();
  store.updateNearby([{ name: 'Checker', distance: 2 }], NOW);

  const anger = [];
  for (let i = 0; i < 7; i += 1) {
    store.updatePathfinder({ state: 'blocked', blockedBy: 'Checker' }, NOW);
    const trigger = detectPathfinderBlock(store, config, NOW);
    anger.push(trigger ? trigger.anger : 0);
  }
  assert.deepEqual(anger, [0, 0, 1, 2, 2, 3, 3]);
});

test('the fuse is randomised per player, never a fixed count', () => {
  const short = setup({}, () => 0);
  const long = setup({}, () => 0.999);
  const settings = short.config.detect.pathfinder;

  assert.deepEqual(short.store.patienceFor('A', settings), { patience: 4, rage: 6 });
  assert.deepEqual(long.store.patienceFor('A', settings), { patience: 7, rage: 11 });
});

test('the polite stage is never skipped, however the roll lands', () => {
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    const { config, store } = setup({}, () => r);
    const { patience } = store.patienceFor('A', config.detect.pathfinder);
    assert.ok(patience > config.detect.pathfinder.threshold, `patience ${patience} must exceed the threshold`);
  }
});

test('"u real?" counts as a macro check when they are next to us', () => {
  const { config, store } = setup();
  store.updateNearby([{ name: 'Checker', distance: 2 }], NOW);
  const trigger = detectFromChat(store, config, chat('Checker', 'u real?'), NOW);
  assert.equal(trigger.kind, 'macro_check');
  assert.match(trigger.evidence, /macro check/);
});

test('macro-check talk from across the lobby is ignored', () => {
  const { config, store } = setup();
  const trigger = detectFromChat(store, config, chat('Stranger', 'say something'), NOW);
  assert.equal(trigger, null);
});
