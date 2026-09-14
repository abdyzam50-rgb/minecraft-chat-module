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
  assert.equal(said[0].trigger, 'pathfinder_blocked');
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

test('falls back to canned lines when the API fails', async () => {
  const ai = createChatAI({
    username: 'Technoblade',
    client: mockClient(new Error('503 overloaded')),
  });
  const said = [];
  const errors = [];
  ai.on('say', (a) => said.push(a));
  ai.on('error', (e) => errors.push(e));

  for (const event of griefScript()) await ai.handle(event);
  assert.equal(errors.length, 1);
  assert.equal(said.length, 1);
  assert.equal(said[0].source, 'fallback');
  assert.match(said[0].message, /^Dream/);
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
