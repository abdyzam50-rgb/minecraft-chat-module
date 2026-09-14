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
  assert.match(userPrompt, /Call them "Dream"/);
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
    assert.match(said[0].message, /grinding/, `${persona} should say what it is doing, got "${said[0].message}"`);
    assert.ok(said[0].message.split(/\s+/).length >= 3, `${persona} gave a grunt: "${said[0].message}"`);
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
