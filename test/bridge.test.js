import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createChatAI, startBridge } from '../src/index.js';

function mockClient(reply) {
  return {
    messages: {
      async create() {
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }] };
      },
    },
  };
}

async function withBridge(options, run) {
  const ai = createChatAI({
    username: 'Technoblade',
    bridge: { port: 0, token: 'secret' },
    client: mockClient({ respond: true, message: 'dream move', reason: 'blocked' }),
    ...options,
  });
  const server = startBridge(ai, { log: () => {} });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ ai, base });
  } finally {
    server.close();
  }
}

const AUTH = { 'content-type': 'application/json', 'x-auth': 'secret' };

test('rejects requests without the shared token', async () => {
  await withBridge({}, async ({ base }) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 401);
  });
});

test('reports health', async () => {
  await withBridge({}, async ({ base }) => {
    const body = await (await fetch(`${base}/health`, { headers: AUTH })).json();
    assert.equal(body.ok, true);
    assert.equal(body.username, 'Technoblade');
    assert.equal(body.usingApi, true);
  });
});

test('accepts a batch of events and hands back the reply on /poll', async () => {
  await withBridge({}, async ({ base }) => {
    const events = [
      { type: 'players', nearby: [{ name: 'xX_DreamSlayer_Xx', distance: 1.5 }] },
      { type: 'pathfinder', state: 'blocked', blockedBy: { name: 'xX_DreamSlayer_Xx', distance: 1.5 } },
      { type: 'pathfinder', state: 'blocked', blockedBy: { name: 'xX_DreamSlayer_Xx', distance: 1.4 } },
      { type: 'pathfinder', state: 'blocked', blockedBy: { name: 'xX_DreamSlayer_Xx', distance: 1.2 } },
    ];
    const posted = await (
      await fetch(`${base}/events`, { method: 'POST', headers: AUTH, body: JSON.stringify(events) })
    ).json();
    assert.equal(posted.ok, true);
    assert.equal(posted.actions.length, 1);

    const polled = await (await fetch(`${base}/poll`, { headers: AUTH })).json();
    assert.equal(polled.actions.length, 1);
    assert.equal(polled.actions[0].command, 'dream move');

    const empty = await (await fetch(`${base}/poll`, { headers: AUTH })).json();
    assert.equal(empty.actions.length, 0);
  });
});

test('returns a clear error for malformed JSON', async () => {
  await withBridge({}, async ({ base }) => {
    const response = await fetch(`${base}/event`, { method: 'POST', headers: AUTH, body: '{nope' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /invalid JSON/);
  });
});
