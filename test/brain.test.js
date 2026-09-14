import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatAI } from '../src/index.js';

/** Stands in for the Anthropic client so tests never hit the network. */
function mockClient(reply, capture = {}) {
  return {
    messages: {
      async create(params) {
        capture.params = params;
        if (reply instanceof Error) throw reply;
        return {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(reply) }],
        };
      },
    },
  };
}

function griefScript(name = 'xX_DreamSlayer_Xx') {
  return [
    { type: 'players', nearby: [{ name, distance: 1.5 }] },
    { type: 'pathfinder', state: 'blocked', blockedBy: { name, distance: 1.5 } },
    { type: 'pathfinder', state: 'blocked', blockedBy: { name, distance: 1.4 } },
    { type: 'pathfinder', state: 'blocked', blockedBy: { name, distance: 1.2 } },
  ];
}

test('repeated blocking produces a chat line aimed at the blocker', async () => {
  const capture = {};
  const ai = createChatAI({
    username: 'Technoblade',
    client: mockClient({ respond: true, message: 'dream move out of my path', reason: 'blocked 3x' }, capture),
  });

  const said = [];
  ai.on('say', (action) => said.push(action));
  for (const event of griefScript()) await ai.handle(event);

  assert.equal(said.length, 1);
  assert.equal(said[0].message, 'dream move out of my path');
  assert.equal(said[0].subject, 'xX_DreamSlayer_Xx');
  assert.equal(said[0].trigger, 'macro_check');
  assert.equal(said[0].command, 'dream move out of my path');
});

test('the prompt carries the short name and the blocking history', async () => {
  const capture = {};
  const ai = createChatAI({
    username: 'Technoblade',
    client: mockClient({ respond: true, message: 'dream move', reason: '' }, capture),
  });
  for (const event of griefScript()) await ai.handle(event);

  const userPrompt = capture.params.messages[0].content;
  assert.match(userPrompt, /they go by "Dream"/);
  assert.match(userPrompt, /you usually do not need to/, 'and is told not to lean on it');
  assert.match(userPrompt, /blocked my path 3x/);
  assert.match(capture.params.system[0].text, /Technoblade/);
  assert.equal(capture.params.system[0].cache_control.type, 'ephemeral');
  assert.equal(capture.params.output_config.format.type, 'json_schema');
});

test('an accusation gets answered in the channel it arrived on', async () => {
  const capture = {};
  const ai = createChatAI({
    username: 'Technoblade',
    client: mockClient({ respond: true, message: 'not macroing, report me then', reason: 'accused' }, capture),
  });

  const said = [];
  ai.on('say', (a) => said.push(a));
  await ai.handle({ type: 'players', nearby: [{ name: 'Accuser', distance: 3 }] });
  await ai.handle({ type: 'chat', raw: 'Party > [VIP] Accuser: ur macroing lol' });

  assert.equal(said.length, 1);
  assert.equal(said[0].channel, 'party');
  assert.equal(said[0].command, '/pc not macroing, report me then');
});

test('respond=false keeps the bot silent', async () => {
  const ai = createChatAI({
    username: 'Technoblade',
    client: mockClient({ respond: false, message: '', reason: 'not aimed at me' }),
  });
  const said = [];
  const skipped = [];
  ai.on('say', (a) => said.push(a));
  ai.on('skip', (s) => skipped.push(s));

  for (const event of griefScript()) await ai.handle(event);
  assert.equal(said.length, 0);
  assert.equal(skipped.at(-1).reason, 'not aimed at me');
});

test('a model line starting with a slash is never sent as a command', async () => {
  const ai = createChatAI({
    username: 'Technoblade',
    client: mockClient({ respond: true, message: '/ban Dream', reason: 'oops' }),
  });
  const said = [];
  ai.on('say', (a) => said.push(a));
  for (const event of griefScript()) await ai.handle(event);

  assert.equal(said.length, 1);
  assert.equal(said[0].command, 'ban Dream');
});

test('stays silent when the API fails, rather than sending a stock line', async () => {
  const ai = createChatAI({
    username: 'Technoblade',
    client: mockClient(new Error('503 overloaded')),
  });
  const said = [];
  const errors = [];
  const skipped = [];
  ai.on('say', (a) => said.push(a));
  ai.on('error', (e) => errors.push(e));
  ai.on('skip', (s) => skipped.push(s));

  for (const event of griefScript()) await ai.handle(event);
  assert.equal(errors.length, 1);
  assert.equal(said.length, 0, 'a canned line here is the exact tell we are avoiding');
  assert.match(skipped.at(-1).reason, /stayed quiet: 503 overloaded/);
});

test('canned lines are available, but only when explicitly asked for', async () => {
  const ai = createChatAI({
    username: 'Technoblade',
    llm: { fallbackOnError: true },
    client: mockClient(new Error('503 overloaded')),
  });
  const said = [];
  ai.on('say', (a) => said.push(a));
  ai.on('error', () => {});

  for (const event of griefScript()) await ai.handle(event);
  assert.equal(said.length, 1);
  assert.equal(said[0].source, 'fallback');
});

test('dry run decides but never queues anything', async () => {
  const ai = createChatAI({
    username: 'Technoblade',
    dryRun: true,
    client: mockClient({ respond: true, message: 'dream move', reason: '' }),
  });
  const said = [];
  ai.on('say', (a) => said.push(a));
  for (const event of griefScript()) await ai.handle(event);

  assert.equal(said.length, 0);
  assert.equal(ai.drain().length, 0);
});

test('going quiet after the server mutes us', async () => {
  const ai = createChatAI({
    username: 'Technoblade',
    client: mockClient({ respond: true, message: 'dream move', reason: '' }),
  });
  const said = [];
  ai.on('say', (a) => said.push(a));

  await ai.handle({ type: 'chat', raw: 'You are muted for 30 minutes' });
  for (const event of griefScript()) await ai.handle(event);
  assert.equal(said.length, 0);
});

test('drain hands queued actions to the bridge exactly once', async () => {
  const ai = createChatAI({
    username: 'Technoblade',
    client: mockClient({ respond: true, message: 'dream move', reason: '' }),
  });
  for (const event of griefScript()) await ai.handle(event);
  assert.equal(ai.drain().length, 1);
  assert.equal(ai.drain().length, 0);
});

test('a sustained macro check escalates to a shouted reply', async () => {
  const replies = ['dream im real move', 'dream ive told you once already', 'dream move, im not a macro'];
  let call = 0;
  const ai = createChatAI({
    username: '3172',
    random: () => 0, // shortest fuse: warn at 3, harden at 4, yell at 6
    limits: { globalCooldownMs: 0 },
    client: {
      messages: {
        async create() {
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify({ respond: true, message: replies[Math.min(call++, 2)], reason: '' }) }],
          };
        },
      },
    },
  });

  const said = [];
  ai.on('say', (a) => said.push(a));
  await ai.handle({ type: 'players', nearby: [{ name: 'xX_DreamSlayer_Xx', distance: 1.5 }] });
  for (let i = 0; i < 6; i += 1) {
    await ai.handle({ type: 'pathfinder', state: 'blocked', blockedBy: { name: 'xX_DreamSlayer_Xx', distance: 1.4 } });
  }

  assert.deepEqual(said.map((a) => a.anger), [1, 2, 3]);
  assert.equal(said[0].message, 'dream im real move');
  assert.equal(said[2].message, 'DREAM MOVE, IM NOT A MACRO', 'anger 3 is shouted');
});

test('the chill persona hardens but never shouts', async () => {
  // Distinct lines per rung — an identical repeat is dropped by the deduper.
  const lines = ['im real, mind moving?', 'thats twice now, please move', 'please stop blocking me'];
  let call = 0;
  const ai = createChatAI({
    username: '3172',
    persona: 'chill',
    random: () => 0,
    limits: { globalCooldownMs: 0 },
    client: {
      messages: {
        async create() {
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify({ respond: true, message: lines[Math.min(call++, 2)], reason: '' }) }],
          };
        },
      },
    },
  });

  const said = [];
  ai.on('say', (a) => said.push(a));
  await ai.handle({ type: 'players', nearby: [{ name: 'Checker', distance: 1.5 }] });
  for (let i = 0; i < 6; i += 1) {
    await ai.handle({ type: 'pathfinder', state: 'blocked', blockedBy: { name: 'Checker', distance: 1.4 } });
  }

  const angriest = said.find((a) => a.anger === 3);
  assert.ok(angriest, 'chill still escalates');
  assert.equal(angriest.message, 'please stop blocking me', 'but not in capitals');
});

test('the prompt tells the model it is being macro checked while ghost grinding', async () => {
  const capture = {};
  const ai = createChatAI({
    username: '3172',
    random: () => 0,
    client: {
      messages: {
        async create(params) {
          capture.params = params;
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ respond: false, message: '', reason: 'quiet' }) }] };
        },
      },
    },
  });

  await ai.handle({ type: 'players', nearby: [{ name: 'Checker', distance: 1.5 }] });
  for (let i = 0; i < 3; i += 1) {
    await ai.handle({ type: 'pathfinder', state: 'blocked', blockedBy: { name: 'Checker', distance: 1.4 } });
  }

  assert.match(capture.params.system[0].text, /Ghosts in the Mist/);
  assert.match(capture.params.system[0].text, /macro checks/);
  assert.match(capture.params.messages[0].content, /macro check/);
  assert.match(capture.params.messages[0].content, /Tone: mildly annoyed/);
});

test('a near-repeat is rewritten, not sent', async () => {
  const replies = [
    'dream move out of my path',
    'dream move out my path',        // a reword — must be caught
    'been at this since 4am, you are not the first to check',
  ];
  let call = 0;
  const prompts = [];
  const ai = createChatAI({
    username: '3172',
    random: () => 0,
    limits: { globalCooldownMs: 0 },
    client: {
      messages: {
        async create(params) {
          prompts.push(params.messages[0].content);
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify({ respond: true, message: replies[call++], reason: '' }) }],
          };
        },
      },
    },
  });

  const said = [];
  ai.on('say', (a) => said.push(a));
  await ai.handle({ type: 'players', nearby: [{ name: 'xX_DreamSlayer_Xx', distance: 1.5 }] });
  for (let i = 0; i < 4; i += 1) {
    await ai.handle({ type: 'pathfinder', state: 'blocked', blockedBy: { name: 'xX_DreamSlayer_Xx', distance: 1.4 } });
  }

  assert.deepEqual(said.map((a) => a.message), [
    'dream move out of my path',
    'been at this since 4am, you are not the first to check',
  ]);
  assert.equal(call, 3, 'the reword cost one extra call');
  assert.match(prompts[2], /too close to something above/);
});

test('the model is shown what it already said', async () => {
  const prompts = [];
  let call = 0;
  const ai = createChatAI({
    username: '3172',
    random: () => 0,
    limits: { globalCooldownMs: 0 },
    client: {
      messages: {
        async create(params) {
          prompts.push(params.messages[0].content);
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify({ respond: true, message: `line ${call++} about ghosts and mist`, reason: '' }) }],
          };
        },
      },
    },
  });

  await ai.handle({ type: 'players', nearby: [{ name: 'Checker', distance: 1.5 }] });
  for (let i = 0; i < 4; i += 1) {
    await ai.handle({ type: 'pathfinder', state: 'blocked', blockedBy: { name: 'Checker', distance: 1.4 } });
  }

  assert.doesNotMatch(prompts[0], /already said these/i, 'nothing to avoid on the first line');
  assert.match(prompts[1], /You have already said these/);
  assert.match(prompts[1], /line 0 about ghosts and mist/);
  assert.match(prompts[1], /Say something new or say nothing/);
});

test('typing delay scales with the length of what was typed', async () => {
  const short = await delayFor('k');
  const long = await delayFor('been grinding this since 4am mate, you are far from the first person to stand there');
  assert.ok(long > short, `${long}ms should exceed ${short}ms`);
  assert.ok(short >= 400, 'still pauses to read the room');
  assert.ok(long <= 7000, 'but never stalls past the moment');

  async function delayFor(message) {
    const ai = createChatAI({
      username: '3172',
      random: () => 0,
      client: mockClient({ respond: true, message, reason: '' }),
    });
    const said = [];
    ai.on('say', (a) => said.push(a));
    await ai.handle({ type: 'players', nearby: [{ name: 'Checker', distance: 1.5 }] });
    for (let i = 0; i < 3; i += 1) {
      await ai.handle({ type: 'pathfinder', state: 'blocked', blockedBy: { name: 'Checker', distance: 1.4 } });
    }
    return said[0].delayMs;
  }
});

test('a friendly question is answered, not brushed off', async () => {
  const capture = {};
  const ai = createChatAI({
    username: '3172',
    client: mockClient({ respond: true, message: 'ghost grinding, been at it since 4am', reason: '' }, capture),
  });
  const said = [];
  ai.on('say', (a) => said.push(a));

  await ai.handle({ type: 'players', nearby: [{ name: 'BlockBuddy', distance: 9 }] });
  await ai.handle({ type: 'chat', raw: '[VIP] BlockBuddy: what you upto 3172?' });

  assert.equal(said.length, 1);
  assert.equal(said[0].trigger, 'mention', 'a friendly question is not an accusation');
  assert.equal(said[0].anger, null, 'and carries no anger');

  const prompt = capture.params.messages[0].content;
  assert.match(prompt, /not testing you/);
  assert.match(prompt, /actually answer it/);
});

test('a hostile mention keeps the attitude', async () => {
  const capture = {};
  const ai = createChatAI({
    username: '3172',
    client: mockClient({ respond: true, message: 'not macroing mate', reason: '' }, capture),
  });
  await ai.handle({ type: 'players', nearby: [{ name: 'Rude', distance: 3 }] });
  await ai.handle({ type: 'chat', raw: '[VIP] Rude: 3172 ur obviously cheating' });

  const prompt = capture.params.messages[0].content;
  assert.doesNotMatch(prompt, /not testing you/, 'the friendly framing must not leak onto an accusation');
});

test('no persona answers a question with a one-word grunt', async () => {
  for (const persona of ['chill', 'snarky', 'unfiltered']) {
    const ai = createChatAI({ username: '3172', persona, llm: { fallbackOnError: true } });
    const said = [];
    ai.on('say', (a) => said.push(a));
    await ai.handle({ type: 'players', nearby: [{ name: 'BlockBuddy', distance: 9 }] });
    await ai.handle({ type: 'chat', raw: '[VIP] BlockBuddy: what you upto 3172?' });

    assert.equal(said.length, 1, `${persona} should answer`);
    assert.match(said[0].message, /grind|ghost/, `${persona} should say what it is doing, got "${said[0].message}"`);
    assert.ok(said[0].message.split(/\s+/).length >= 2, `${persona} gave a grunt: "${said[0].message}"`);
  }
});

test('the model is told to name the grind rather than deflect', async () => {
  const capture = {};
  const ai = createChatAI({
    username: '3172',
    client: mockClient({ respond: true, message: 'just grinding ghosts, you?', reason: '' }, capture),
  });
  await ai.handle({ type: 'players', nearby: [{ name: 'BlockBuddy', distance: 9 }] });
  await ai.handle({ type: 'chat', raw: '[VIP] BlockBuddy: what you upto 3172?' });

  assert.match(capture.params.messages[0].content, /name the grind/);
});

test('a fair claim gets conceded, and differently each time', async () => {
  const ai = createChatAI({
    username: '3172',
    llm: { fallbackOnError: true },
    limits: {
      globalCooldownMs: 0, perPlayerCooldownMs: 0, perKindCooldownMs: 0,
      maxConsecutivePerPlayer: 99, maxPerMinute: 99,
      conversation: { cooldownMs: 0 },
    },
  });
  const said = [];
  ai.on('say', (a) => said.push(a));

  await ai.handle({ type: 'players', nearby: [{ name: 'BlockBuddy', distance: 3 }] });
  for (let i = 0; i < 5; i += 1) {
    await ai.handle({ type: 'chat', raw: '[VIP] BlockBuddy: excuse me 3172 i was here first' });
  }

  assert.equal(said.length, 5, 'it answers every time');
  assert.equal(new Set(said.map((a) => a.message)).size, 5, 'and never the same way twice');
  for (const action of said) {
    assert.equal(action.trigger, 'spot_claim');
    assert.equal(action.hint, 'relocate', 'the client is told to actually move');
    assert.doesNotMatch(action.message, /public lobby|genius|piss/, 'no attitude at a reasonable person');
  }
});

test('the model is told to give way on a spot claim', async () => {
  const capture = {};
  const ai = createChatAI({
    username: '3172',
    client: mockClient({ respond: true, message: 'mb ill move', reason: '' }, capture),
  });
  await ai.handle({ type: 'players', nearby: [{ name: 'BlockBuddy', distance: 3 }] });
  await ai.handle({ type: 'chat', raw: '[VIP] BlockBuddy: excuse me 3172 i was here first' });

  const prompt = capture.params.messages[0].content;
  assert.match(prompt, /fair claim on this spot/);
  assert.match(prompt, /It is not the only way/, 'and told not to make it a catchphrase');
});

/** A conversation where they stop using our name after the first message. */
function conversation(options = {}) {
  let clock = 1_700_000_000_000;
  const replies = [
    'just grinding ghosts, you?',
    'since about 4am, lost track honestly',
    'one voltas and a load of nothing',
    'cheers, you too',
    'yeah ill be here a while yet',
  ];
  let call = 0;
  const ai = createChatAI({
    username: '3172',
    now: () => clock,
    client: {
      messages: {
        async create() {
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify({ respond: true, message: replies[call++ % replies.length], reason: '' }) }],
          };
        },
      },
    },
    ...options,
  });
  return { ai, tick: (ms = 6000) => { clock += ms; } };
}

test('a conversation runs to its end instead of dying after one reply', async () => {
  const { ai, tick } = conversation();
  const said = [];
  ai.on('say', (a) => said.push(a.message));

  await ai.handle({ type: 'players', nearby: [{ name: 'BlockBuddy', distance: 5 }] });
  for (const line of [
    'what you upto 3172?',
    'oh nice how long you been grinding',   // no name from here on
    'any luck with drops?',
    'fair enough, good luck man',
  ]) {
    await ai.handle({ type: 'chat', raw: `[VIP] BlockBuddy: ${line}` });
    tick();
  }

  assert.equal(said.length, 4, `expected all four answered, got ${said.length}: ${said.join(' | ')}`);
});

test('an unnamed line only counts while the conversation is live', async () => {
  const { ai, tick } = conversation();
  const said = [];
  ai.on('say', (a) => said.push(a.message));

  await ai.handle({ type: 'players', nearby: [{ name: 'BlockBuddy', distance: 5 }] });
  await ai.handle({ type: 'chat', raw: '[VIP] BlockBuddy: what you upto 3172?' });
  assert.equal(said.length, 1);

  tick(5 * 60 * 1000); // they wandered off; the exchange is over
  await ai.handle({ type: 'chat', raw: '[VIP] BlockBuddy: anyone selling a bleeding heart' });
  assert.equal(said.length, 1, 'a stray line long after is not ours to answer');
});

test('an argument gets cut short where a chat does not', async () => {
  const { ai, tick } = conversation();
  const said = [];
  const skipped = [];
  ai.on('say', (a) => said.push(a));
  ai.on('skip', (s) => skipped.push(s.reason));

  await ai.handle({ type: 'players', nearby: [{ name: 'Accuser', distance: 4 }] });
  for (let i = 0; i < 6; i += 1) {
    await ai.handle({ type: 'chat', raw: `[MVP+] Accuser: 3172 ur macroing, number ${i}` });
    tick();
  }

  assert.equal(said.length, 3, 'three replies to an accuser, then it drops it');
  assert.match(skipped.at(-1), /letting it go/);
});

test('we still do not nag someone who never spoke to us', async () => {
  const { ai, tick } = conversation({ random: () => 0 });
  const skipped = [];
  ai.on('skip', (s) => skipped.push(s.reason));

  await ai.handle({ type: 'players', nearby: [{ name: 'Checker', distance: 1.5 }] });
  for (let i = 0; i < 4; i += 1) {
    await ai.handle({ type: 'pathfinder', state: 'blocked', blockedBy: { name: 'Checker', distance: 1.4 } });
  }
  // The pathfinder callout is ours, not theirs — the global cooldown still holds.
  assert.ok(skipped.some((r) => /global cooldown/.test(r)), skipped.join(' | '));
});

test('a bare call-out gets a one-word reply, not a life story', async () => {
  const capture = {};
  const ai = createChatAI({
    username: '3172',
    client: mockClient({ respond: true, message: 'yh?', reason: '' }, capture),
  });
  const said = [];
  ai.on('say', (a) => said.push(a));

  await ai.handle({ type: 'players', nearby: [{ name: 'xX_DreamSlayer_Xx', distance: 3 }] });
  await ai.handle({ type: 'chat', raw: '[MVP+] xX_DreamSlayer_Xx: Yo 3172' });

  assert.equal(said.length, 1);
  const prompt = capture.params.messages[0].content;
  assert.match(prompt, /just called my name/);
  assert.match(prompt, /one or two characters/);
});

test('an actual question is not treated as a bare call-out', async () => {
  const capture = {};
  const ai = createChatAI({
    username: '3172',
    client: mockClient({ respond: true, message: 'ghosts in the mist', reason: '' }, capture),
  });
  await ai.handle({ type: 'players', nearby: [{ name: 'Dream', distance: 3 }] });
  await ai.handle({ type: 'chat', raw: '[MVP+] Dream: yo 3172 what you upto' });

  assert.doesNotMatch(capture.params.messages[0].content, /one or two characters/);
});

test('it is told to stop using their name once it has twice running', async () => {
  const prompts = [];
  let call = 0;
  // Every reply name-drops them, which is the habit we want caught.
  const lines = ['ghosting in mist dream', 'lost count dream, been ages', 'about 40m dream'];
  let clock = 1_700_000_000_000;
  const ai = createChatAI({
    username: '3172',
    now: () => clock,
    client: {
      messages: {
        async create(params) {
          prompts.push(params.messages[0].content);
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify({ respond: true, message: lines[call++ % lines.length], reason: '' }) }],
          };
        },
      },
    },
  });

  await ai.handle({ type: 'players', nearby: [{ name: 'xX_DreamSlayer_Xx', distance: 3 }] });
  for (const line of ['yo 3172 hows it going', 'how many hours you been at this', 'how many coins so far']) {
    await ai.handle({ type: 'chat', raw: `[MVP+] xX_DreamSlayer_Xx: ${line}` });
    clock += 6000;
  }

  assert.doesNotMatch(prompts[0], /starting to read as a script/);
  assert.doesNotMatch(prompts[1], /starting to read as a script/);
  assert.match(prompts[2], /Do not use it again/, 'after two name-drops in a row it is told to stop');
});

/** The reported transcript, verbatim. Every line of it must get an answer. */
test('a macro check is answered even after a long friendly chat', async () => {
  // Distinct lines throughout — identical ones would be caught by the repeat
  // guard and this test would be measuring the wrong thing.
  const lines = [
    'yo', 'grinding ghosts rn', 'not sure yet, been about an hour',
    'im real mate', 'yh?', 'still here', 'report me then, i dont care',
  ];
  let clock = 1_700_000_000_000;
  let call = 0;
  const ai = createChatAI({
    username: '3172',
    now: () => clock,
    client: {
      messages: {
        async create() {
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify({ respond: true, message: lines[call++ % lines.length], reason: '' }) }],
          };
        },
      },
    },
  });

  const said = [];
  ai.on('say', (a) => said.push(a));
  await ai.handle({ type: 'players', nearby: [{ name: 'xX_DreamSlayer_Xx', distance: 3 }] });

  for (const line of [
    'Yo 3172',
    'What u upto?',
    'How much u made so far from that',
    'macro check, say something if ur real',
    'Yo?',
    'macro check, say something if ur real',
    'Im reporting u for macroin',
  ]) {
    await ai.handle({ type: 'chat', raw: `[MVP+] xX_DreamSlayer_Xx: ${line}` });
    clock += 7000;
  }

  assert.equal(said.length, 7, `every line needs an answer, got ${said.length}`);
  assert.equal(said[3].trigger, 'macro_check', 'the check is recognised as one');
});

test('a friendly chat does not spend the argument budget', async () => {
  const lines = [
    'yo', 'just grinding ghosts', 'cheers', 'about an hour now', 'one voltas so far',
    'im not cheating', 'report me then', 'think what you like', 'still not a macro',
  ];
  let clock = 1_700_000_000_000;
  let call = 0;
  const ai = createChatAI({
    username: '3172',
    now: () => clock,
    client: {
      messages: {
        async create() {
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify({ respond: true, message: lines[call++ % lines.length], reason: '' }) }],
          };
        },
      },
    },
  });
  const said = [];
  ai.on('say', (a) => said.push(a));
  await ai.handle({ type: 'players', nearby: [{ name: 'Accuser', distance: 4 }] });

  // Five friendly turns first — these must not count as arguing.
  for (const line of ['yo 3172', 'what u upto', 'nice', 'how long', 'any drops']) {
    await ai.handle({ type: 'chat', raw: `[MVP+] Accuser: ${line}` });
    clock += 7000;
  }
  const afterChat = said.length;

  for (let i = 0; i < 4; i += 1) {
    await ai.handle({ type: 'chat', raw: `[MVP+] Accuser: 3172 ur cheating, take ${i}` });
    clock += 7000;
  }

  assert.equal(said.length - afterChat, 3, 'three answers to the accusations, then it lets go');
});

test('an acknowledgement gets a token back, not a paragraph', async () => {
  const capture = {};
  let clock = 1_700_000_000_000;
  const ai = createChatAI({
    username: '3172',
    now: () => clock,
    client: mockClient({ respond: true, message: 'all g', reason: '' }, capture),
  });
  const said = [];
  ai.on('say', (a) => said.push(a));

  await ai.handle({ type: 'players', nearby: [{ name: 'xX_DreamSlayer_Xx', distance: 3 }] });
  await ai.handle({ type: 'chat', raw: '[MVP+] xX_DreamSlayer_Xx: 3172' });
  clock += 7000;
  await ai.handle({ type: 'chat', raw: '[MVP+] xX_DreamSlayer_Xx: Mb G' });

  const prompt = capture.params.messages[0].content;
  assert.match(prompt, /acknowledgement, not a question/);
  assert.match(prompt, /Do not restate what you are doing/);
  assert.match(prompt, /Saying nothing at all is an entirely normal reply/);
  assert.equal(said.at(-1).message, 'all g');
});

test('silence is accepted as the answer to filler', async () => {
  let clock = 1_700_000_000_000;
  let call = 0;
  const ai = createChatAI({
    username: '3172',
    now: () => clock,
    client: {
      messages: {
        async create() {
          // First a real answer, then the model decides the exchange is done.
          const reply = call++ === 0
            ? { respond: true, message: 'just grinding ghosts', reason: '' }
            : { respond: false, message: '', reason: 'nothing left to say' };
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }] };
        },
      },
    },
  });
  const said = [];
  const skipped = [];
  ai.on('say', (a) => said.push(a));
  ai.on('skip', (s) => skipped.push(s.reason));

  await ai.handle({ type: 'players', nearby: [{ name: 'Dream', distance: 3 }] });
  await ai.handle({ type: 'chat', raw: '[MVP+] Dream: 3172 what you upto' });
  clock += 7000;
  await ai.handle({ type: 'chat', raw: '[MVP+] Dream: cool cool' });

  assert.equal(said.length, 1, 'the filler goes unanswered, which is fine');
  assert.equal(skipped.at(-1), 'nothing left to say');
});

test('a real question is never mistaken for filler', async () => {
  const capture = {};
  const ai = createChatAI({
    username: '3172',
    client: mockClient({ respond: true, message: 'just grinding ghosts', reason: '' }, capture),
  });
  await ai.handle({ type: 'players', nearby: [{ name: 'Dream', distance: 3 }] });
  await ai.handle({ type: 'chat', raw: '[MVP+] Dream: cool wheres the ghosts at 3172' });

  assert.doesNotMatch(capture.params.messages[0].content, /acknowledgement, not a question/);
});

test('a terse reply is cut down mechanically, name and all', async () => {
  let clock = 1_700_000_000_000;
  const ai = createChatAI({
    username: '3172',
    now: () => clock,
    // What the model actually produced when asked for two words.
    client: mockClient({ respond: true, message: 'all g dream, ty', reason: '' }),
  });
  const said = [];
  ai.on('say', (a) => said.push(a));

  await ai.handle({ type: 'players', nearby: [{ name: 'xX_DreamSlayer_Xx', distance: 3 }] });
  await ai.handle({ type: 'chat', raw: '[MVP+] xX_DreamSlayer_Xx: 3172' });
  clock += 7000;
  await ai.handle({ type: 'chat', raw: '[MVP+] xX_DreamSlayer_Xx: Mb G' });

  assert.equal(said.at(-1).message, 'all g');
});

test('a normal reply is left alone by the terse rules', async () => {
  const ai = createChatAI({
    username: '3172',
    client: mockClient({ respond: true, message: 'been grinding ghosts since about 4am dream', reason: '' }),
  });
  const said = [];
  ai.on('say', (a) => said.push(a));
  await ai.handle({ type: 'players', nearby: [{ name: 'xX_DreamSlayer_Xx', distance: 3 }] });
  await ai.handle({ type: 'chat', raw: '[MVP+] xX_DreamSlayer_Xx: 3172 how long you been at it' });

  assert.equal(said[0].message, 'been grinding ghosts since about 4am dream');
});

test('the prompt carries the slang it needs to read and write', async () => {
  const capture = {};
  const ai = createChatAI({
    username: '3172',
    slang: { extra: [['gexp', 'guild xp']] },
    client: mockClient({ respond: true, message: 'in the bz', reason: '' }, capture),
  });
  await ai.handle({ type: 'players', nearby: [{ name: 'Dream', distance: 3 }] });
  await ai.handle({ type: 'chat', raw: '[MVP+] Dream: 3172 hows the mf looking' });

  const system = capture.params.system[0].text;
  for (const term of ['mf — magic find', 'bz / baz — bazaar', 'hotm — heart of the mountain', 'ngl', 'sorrow / volta / plasma']) {
    assert.ok(system.includes(term), `missing "${term}"`);
  }
  assert.match(system, /gexp — guild xp/, 'user additions land too');
  assert.match(system, /not crammed in/, 'and it is told not to overdo it');
});

test('slang can be switched off', async () => {
  const capture = {};
  const ai = createChatAI({
    username: '3172',
    slang: { enabled: false },
    client: mockClient({ respond: true, message: 'ok', reason: '' }, capture),
  });
  await ai.handle({ type: 'players', nearby: [{ name: 'Dream', distance: 3 }] });
  await ai.handle({ type: 'chat', raw: '[MVP+] Dream: 3172 hi there mate' });

  assert.doesNotMatch(capture.params.system[0].text, /bazaar/);
});
