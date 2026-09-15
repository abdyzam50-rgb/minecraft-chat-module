import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextStore } from '../src/context/store.js';
import { resolveConfig } from '../src/config.js';
import { detectFromChat, detectPathfinderBlock, detectMuted } from '../src/detect/index.js';

const NOW = 1_700_000_000_000;

function setup(overrides = {}, random = () => 0) {
  const config = resolveConfig({ username: overrides.username ?? 'Technoblade', ...overrides });
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

test('a fair claim on the spot is its own thing, not hostility', () => {
  const { config, store } = setup();
  store.updateNearby([{ name: 'Miner', distance: 3 }], NOW);

  const polite = detectFromChat(store, config, chat('Miner', 'excuse me 3172 i was here first'), NOW);
  assert.equal(polite.kind, 'spot_claim');
  assert.equal(polite.polite, true);
  assert.equal(polite.hint, 'relocate');

  const blunt = detectFromChat(store, config, chat('Miner', 'move im mining here'), NOW);
  assert.equal(blunt.kind, 'spot_claim', 'blunt but fair is still a claim');
});

test('actual aggression is not treated as a fair claim', () => {
  const { config, store } = setup();
  store.updateNearby([{ name: 'Rude', distance: 3 }], NOW);
  assert.equal(detectFromChat(store, config, chat('Rude', 'get out of here you clown'), NOW).kind, 'hostile');
});

test('a macro check dressed up as a spot claim is still a macro check', () => {
  const { config, store } = setup();
  store.updateNearby([{ name: 'Checker', distance: 2 }], NOW);
  const trigger = detectFromChat(store, config, chat('Checker', 'move if ur real, i was here first'), NOW);
  assert.equal(trigger.kind, 'macro_check');
});

test('a claim from someone across the lobby is not ours to answer', () => {
  const { config, store } = setup();
  const trigger = detectFromChat(store, config, chat('Stranger', 'i was here first'), NOW);
  assert.equal(trigger, null);
});

test('a bare "move i was here first" works without naming us', () => {
  const { config, store } = setup();
  const text = 'move i was here first';

  for (const distance of [1.8, 6.4, 12.1, 19]) {
    store.updateNearby([{ name: 'Miner', distance }], NOW);
    const trigger = detectFromChat(store, config, chat('Miner', text), NOW);
    assert.equal(trigger?.kind, 'spot_claim', `should fire at ${distance}m`);
  }

  // Far enough away that they are probably talking to someone else.
  store.updateNearby([{ name: 'Miner', distance: 30 }], NOW);
  assert.equal(detectFromChat(store, config, chat('Miner', text), NOW), null);
});

test('a distant claim still counts when it names us', () => {
  const { config, store } = setup();
  store.updateNearby([{ name: 'Miner', distance: 40 }], NOW);
  const trigger = detectFromChat(store, config, chat('Miner', 'techno move i was here first'), NOW);
  assert.equal(trigger?.kind, 'spot_claim');
});

test('short slang is answered, not dropped as noise', () => {
  const { config, store } = setup();
  store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);
  store.openConversation('Dream', NOW);

  const kinds = {};
  for (const text of ['wsg', 'wyd', 'hbu', 'idk', 'gg', 'k']) {
    const trigger = detectFromChat(store, config, chat('Dream', text), NOW);
    assert.ok(trigger, `"${text}" must get a reply, not silence`);
    kinds[text] = trigger.opener ? 'opener' : trigger.smalltalk ? 'smalltalk' : 'mention';
  }

  assert.equal(kinds.wsg, 'opener', 'a greeting, however it is spelled');
  assert.equal(kinds.wyd, 'mention', 'but "what you doing" is a real question');
  assert.equal(kinds.hbu, 'mention');
  assert.equal(kinds.gg, 'smalltalk');
});

test('"wsg 3172" is a greeting, not an essay prompt', () => {
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);
  const trigger = detectFromChat(store, config, chat('Dream', 'wsg 3172'), NOW);
  assert.equal(trigger.opener, true);
});

test('a message that is only our name with nothing else is still an opener', () => {
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);
  assert.equal(detectFromChat(store, config, chat('Dream', '3172'), NOW).opener, true);
});

test('talk about other people macroing is not an accusation against us', () => {
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);
  store.openConversation('Dream', NOW);

  for (const text of [
    'Most people macro that tho',
    'everyone macros ghosts these days',
    'i think some guy was macroing earlier',
    'that guy is hacking',
  ]) {
    const trigger = detectFromChat(store, config, chat('Dream', text), NOW);
    assert.notEqual(trigger?.kind, 'accusation', `"${text}" is not about us`);
  }
});

test('an accusation pointed at us still lands', () => {
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);

  for (const text of ['u macro that', 'you macroing?', '3172 ur macroing', 'im reporting you for macroing']) {
    const trigger = detectFromChat(store, config, chat('Dream', text), NOW);
    assert.equal(trigger?.kind, 'accusation', `"${text}" is aimed at us`);
  }
});

test('a bare insult from someone next to us is still taken personally', () => {
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);
  assert.equal(detectFromChat(store, config, chat('Dream', 'cheater'), NOW)?.kind, 'accusation');
});

test('stacked greetings are still just hello', () => {
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);

  for (const text of ['Yo wsg 3172', 'hey yo 3172', '3172 wsg bro', 'yo 3172', 'hey there 3172']) {
    const trigger = detectFromChat(store, config, chat('Dream', text), NOW);
    assert.equal(trigger?.opener, true, `"${text}" is a greeting, nothing more`);
  }
});

test('a greeting with a question attached is not just a greeting', () => {
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);

  for (const text of ['yo 3172 hows the grind', 'wsg 3172 wyd', '3172 hey whats the ah price']) {
    const trigger = detectFromChat(store, config, chat('Dream', text), NOW);
    assert.notEqual(trigger?.opener, true, `"${text}" asks something`);
  }
});

test('praise is told apart from questions and accusations', () => {
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);

  const compliment = (text) => detectFromChat(store, config, chat('Dream', text), NOW)?.compliment === true;

  assert.ok(compliment('3172 you seem really rich'));
  assert.ok(compliment('3172 u must be loaded'));
  assert.ok(compliment('3172 ur cracked at this'));

  assert.ok(!compliment('3172 u good?'), 'that is asking if we are ok');
  assert.ok(!compliment('3172 how much u made'), 'that is a question');
  assert.equal(detectFromChat(store, config, chat('Dream', '3172 ur macroing'), NOW).kind, 'accusation');
});

test('a typed macro check escalates on how often they ask, not on the blocking fuse', () => {
  const { config, store } = setup({ username: '3172' }, () => 0.5);
  store.updateNearby([{ name: 'Checker', distance: 2 }], NOW);

  const anger = [];
  for (let i = 0; i < 5; i += 1) {
    const trigger = detectFromChat(store, config, chat('Checker', 'macro check, say something if ur real'), NOW);
    assert.equal(trigger?.kind, 'macro_check', `check ${i + 1} must still be answered`);
    anger.push(trigger.anger);
  }
  assert.deepEqual(anger, [1, 2, 3, 3, 3], 'annoyed, fed up, then furious and staying there');
});

test('every repeat of a typed check gets an answer', () => {
  // Silence is the one thing a macro check is testing for, so no repeat may
  // be skipped however many times they ask.
  const { config, store } = setup({ username: '3172' }, () => 0.5);
  store.updateNearby([{ name: 'Checker', distance: 2 }], NOW);
  for (let i = 0; i < 8; i += 1) {
    assert.ok(
      detectFromChat(store, config, chat('Checker', 'u real?'), NOW),
      `check ${i + 1} went unanswered`,
    );
  }
});

test('the temper cools once they stop asking', () => {
  const { config, store } = setup({ username: '3172' }, () => 0.5);
  store.updateNearby([{ name: 'Checker', distance: 2 }], NOW);
  for (let i = 0; i < 3; i += 1) detectFromChat(store, config, chat('Checker', 'u real?'), NOW);

  const later = NOW + config.detect.macroCheck.windowMs + 1000;
  store.updateNearby([{ name: 'Checker', distance: 2 }], later);
  const trigger = detectFromChat(store, config, chat('Checker', 'u real?'), later);
  assert.equal(trigger.anger, 1, 'a check ten minutes later starts civil again');
});

test('standing in the path still uses the randomised fuse', () => {
  // Typing a check is deliberate; walking into someone three times might not
  // be, so that path keeps its slower, randomised escalation.
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Blocker', distance: 2 }], NOW);

  const anger = [];
  for (let i = 0; i < 7; i += 1) {
    store.updatePathfinder({ state: 'blocked', blockedBy: 'Blocker' }, NOW);
    const trigger = detectPathfinderBlock(store, config, NOW);
    if (trigger) {
      anger.push(trigger.anger);
      store.noteAnger('Blocker', trigger.anger);
    }
  }
  assert.deepEqual(anger, [1, 2, 3], 'one message per rung, spread over more blocks');
});

test('a bare greeting from arm\'s length is aimed at us, name or not', () => {
  const { config, store } = setup({ username: '3172' });
  for (const [distance, expected] of [[1.8, true], [5, true], [9, false], [20, false]]) {
    const fresh = setup({ username: '3172' });
    fresh.store.updateNearby([{ name: 'Dream', distance }], NOW);
    const trigger = detectFromChat(fresh.store, fresh.config, chat('Dream', 'yo'), NOW);
    assert.equal(Boolean(trigger), expected, `"yo" at ${distance}m`);
  }
  assert.ok(store);
});

test('a greeting up close is still just a greeting', () => {
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 2 }], NOW);
  assert.equal(detectFromChat(store, config, chat('Dream', 'hello?'), NOW).opener, true);
});

test('a real sentence from someone close still needs our name', () => {
  // Otherwise we would answer every conversation happening next to us.
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 2 }], NOW);
  assert.equal(detectFromChat(store, config, chat('Dream', 'anyone selling sorrow'), NOW), null);
});

test('a fumbled name gets a question, not an assumption', () => {
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);

  const trigger = detectFromChat(store, config, chat('Dream', '3127 you there'), NOW);
  assert.equal(trigger.kind, 'maybe_mention');
  assert.equal(trigger.typo, '3127');
  assert.equal(trigger.uncertain, true);
});

test('transpositions count as one typo, since that is how names get fumbled', () => {
  const { config } = setup({ username: '3172' });
  for (const text of ['3127 u there', 'yo 3712', '3173 hello', 'hey 317', '31722 wsg']) {
    const fresh = setup({ username: '3172' });
    fresh.store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);
    assert.equal(
      detectFromChat(fresh.store, fresh.config, chat('Dream', text), NOW)?.kind,
      'maybe_mention',
      text,
    );
  }
  assert.ok(config);
});

test('another player spelled right is not a typo of ours', () => {
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 3 }, { name: 'Nova_77', distance: 8 }], NOW);
  assert.equal(detectFromChat(store, config, chat('Dream', 'Nova_77 you there'), NOW), null);
  assert.equal(detectFromChat(store, config, chat('Dream', 'anyone got 4000 coins'), NOW), null);
});

test('saying no ends it; saying yes carries on', () => {
  const denied = setup({ username: '3172' });
  denied.store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);
  denied.store.noteAskedWho('Dream', NOW);

  const stand = detectFromChat(denied.store, denied.config, chat('Dream', 'nah not you'), NOW);
  assert.equal(stand.kind, 'stand_down');
  assert.equal(stand.closes, true);

  const confirmed = setup({ username: '3172' });
  confirmed.store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);
  confirmed.store.noteAskedWho('Dream', NOW);
  const yes = detectFromChat(confirmed.store, confirmed.config, chat('Dream', 'yeah u'), NOW);
  assert.notEqual(yes?.kind, 'stand_down', 'a yes is not a stand-down');
});

test('we only ask about a fumble once', () => {
  const { config, store } = setup({ username: '3172' });
  store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);
  assert.equal(detectFromChat(store, config, chat('Dream', '3127 hello'), NOW).kind, 'maybe_mention');
  store.noteAskedWho('Dream', NOW);
  assert.equal(detectFromChat(store, config, chat('Dream', '3127 hello again'), NOW), null);
});

test('the reported fumbles are all recognised, from any distance', () => {
  // Reported from the live site: Nova_77 stands at 24.6m and typed these four.
  for (const [text, expected] of [
    ['3127', 'maybe_mention'],
    ['yo3271', 'maybe_mention'],   // no space between greeting and name
    ['3712', 'maybe_mention'],
    ['hello?', null],              // nothing name-like in it
  ]) {
    const { config, store } = setup({ username: '3172' });
    store.updateNearby([{ name: 'Nova_77', distance: 24.6 }], NOW);
    const trigger = detectFromChat(store, config, chat('Nova_77', text), NOW);
    assert.equal(trigger?.kind ?? null, expected, text);
  }
});

test('a shuffled name counts, a stray number does not', () => {
  const shuffled = setup({ username: '3172' });
  shuffled.store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);
  assert.equal(detectFromChat(shuffled.store, shuffled.config, chat('Dream', '1732'), NOW)?.kind, 'maybe_mention');

  const unrelated = setup({ username: '3172' });
  unrelated.store.updateNearby([{ name: 'Dream', distance: 3 }], NOW);
  assert.equal(detectFromChat(unrelated.store, unrelated.config, chat('Dream', 'anyone got 4000 coins'), NOW), null);
});

test('a greeting and a bare name call are told apart', () => {
  // Reported: xX_DreamSlayer_Xx said "yo" and got back "hbu" — an answer to a
  // question nobody asked. No one opens a conversation that way; they say
  // "yo" back. The two cases look identical to the opener flag, so the
  // trigger has to distinguish them before the prompt can.
  const config = resolveConfig({ username: '3172' });
  const store = new ContextStore(config, () => NOW);
  store.updateNearby([{ name: 'xX_DreamSlayer_Xx', distance: 3.2 }], NOW);

  const greeting = detectFromChat(
    store,
    config,
    store.addChat({ sender: 'xX_DreamSlayer_Xx', content: 'yo', channel: 'all', ts: NOW }),
    NOW,
  );
  assert.ok(greeting, 'a greeting from someone standing next to you is worth answering');
  assert.equal(greeting.opener, true);
  assert.equal(greeting.greeting, true, 'they actually said hello');

  const bare = detectFromChat(
    store,
    config,
    store.addChat({ sender: 'xX_DreamSlayer_Xx', content: '3172', channel: 'all', ts: NOW + 60_000 }),
    NOW + 60_000,
  );
  assert.ok(bare);
  assert.equal(bare.opener, true);
  assert.equal(bare.greeting, false, 'a name with no hello is not a greeting');
});

test('the prompt tells a greeting to greet back, and says what not to reach for', async () => {
  const { buildUserPrompt } = await import('../src/llm/prompt.js');
  const config = resolveConfig({ username: '3172' });
  const store = new ContextStore(config, () => NOW);

  const greeted = buildUserPrompt(
    store,
    config,
    { kind: 'mention', subject: 'Dream', channel: 'all', evidence: 'x', opener: true, greeting: true },
    NOW,
  );
  assert.match(greeted, /greeted you/i);
  assert.match(greeted, /hbu/, 'names the exact word that went wrong');

  const called = buildUserPrompt(
    store,
    config,
    { kind: 'mention', subject: 'Dream', channel: 'all', evidence: 'x', opener: true, greeting: false },
    NOW,
  );
  assert.match(called, /called your name and said nothing else/i);
  assert.ok(!/greeted you/i.test(called), 'a bare name call still wants "?"');
});

test('a question about you is not a question about the grind', () => {
  // Reported: "yo" / "yo" went fine, then "hows ur day?" came back as
  // "dream: grinding ghosts, np". They asked after the player, not the
  // pathfinder, and answering with the grind is a script following a topic
  // rather than a person listening.
  const config = resolveConfig({ username: '3172' });
  const store = new ContextStore(config, () => NOW);
  store.updateNearby([{ name: 'xX_DreamSlayer_Xx', distance: 3.2 }], NOW);

  const asked = (content, ts) =>
    detectFromChat(
      store,
      config,
      store.addChat({ sender: 'xX_DreamSlayer_Xx', content, channel: 'all', ts }),
      ts,
    );

  for (const [i, line] of ['hows ur day 3172?', 'how are you 3172', 'hru 3172', 'you good 3172?'].entries()) {
    // Well apart: lines seconds from each other are one turn, not four.
    const trigger = asked(line, NOW + i * 60_000);
    assert.ok(trigger, `${line} deserves an answer`);
    assert.equal(trigger.askedWellbeing, true, line);
    assert.equal(trigger.askedActivity, false, `${line} is not asking about the grind`);
  }

  // And the grind question still reads as one.
  const activity = asked('what you upto 3172', NOW + 300_000);
  assert.equal(activity.askedActivity, true);
  assert.equal(activity.askedWellbeing, false);
});

test('a burst of messages is read as one turn', () => {
  // Reported: "Yo how ur day?" then "3172?" a second later came back as
  // "yo wsg". Only the second line names us and a name on its own is a
  // call-out, so the question in the first line was never read at all.
  const config = resolveConfig({ username: '3172' });
  const store = new ContextStore(config, () => NOW);
  store.updateNearby([{ name: 'xX_DreamSlayer_Xx', distance: 3.2 }], NOW);

  store.addChat({ sender: 'xX_DreamSlayer_Xx', content: 'Yo how ur day?', channel: 'all', ts: NOW });
  const trigger = detectFromChat(
    store,
    config,
    store.addChat({ sender: 'xX_DreamSlayer_Xx', content: '3172?', channel: 'all', ts: NOW + 1500 }),
    NOW + 1500,
  );

  assert.ok(trigger);
  assert.equal(trigger.askedWellbeing, true, 'the question came a line early, not never');
  assert.equal(trigger.opener, false, 'that is not a bare call-out — they asked something');
});

test('an old line from the same player is not dragged into a new turn', () => {
  const config = resolveConfig({ username: '3172' });
  const store = new ContextStore(config, () => NOW);
  store.updateNearby([{ name: 'xX_DreamSlayer_Xx', distance: 3.2 }], NOW);

  store.addChat({ sender: 'xX_DreamSlayer_Xx', content: 'hows ur day?', channel: 'all', ts: NOW });
  const later = NOW + 5 * 60_000;
  const trigger = detectFromChat(
    store,
    config,
    store.addChat({ sender: 'xX_DreamSlayer_Xx', content: '3172', channel: 'all', ts: later }),
    later,
  );

  assert.ok(trigger);
  assert.equal(trigger.askedWellbeing, false, 'five minutes later is a new conversation');
  assert.equal(trigger.opener, true);
});
