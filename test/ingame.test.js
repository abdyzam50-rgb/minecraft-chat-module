import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createChatAI, startBridge } from '../src/index.js';

/**
 * The seam nobody has run: chattriggers/index.js talking to src/bridge/server.js.
 *
 * Every payload below is copied from what the ChatTriggers module actually
 * posts, and every field read from a reply is one it actually reads. The unit
 * tests elsewhere use hand-written events, which cannot catch the two of them
 * drifting apart.
 */

/** Replies in order, so a session can be driven through several turns. */
function scriptedClient(messages) {
  const queue = [...messages];
  return {
    messages: {
      async create() {
        const message = queue.shift() ?? 'nah';
        return {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify({ respond: true, message, reason: 'test' }) }],
        };
      },
    },
  };
}

async function withGame(options, run) {
  const ai = createChatAI({
    username: '3172',
    bridge: { port: 0, token: 'secret' },
    client: scriptedClient(options.replies ?? ['yh?']),
    ...options,
  });
  const server = startBridge(ai, { log: () => {} });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  // Exactly what chattriggers/index.js sends: JSON body, X-Auth header.
  const post = (path, payload) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth': 'secret' },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
  const poll = () =>
    fetch(`${base}/poll`, { headers: { 'X-Auth': 'secret' } }).then((r) => r.json());

  try {
    await run({ ai, post, poll });
  } finally {
    server.close();
  }
}

test('a whole in-game exchange works end to end over the bridge', async () => {
  await withGame({ replies: ['yh?'] }, async ({ post, poll }) => {
    // The tick handler's world snapshot, verbatim from the module.
    await post('/events', [
      { type: 'players', nearby: [{ name: 'Nova_77', distance: 3.2 }] },
      { type: 'self', username: '3172', health: 20 },
    ]);

    // The chat listener posts the raw line as ChatLib.getChatMessage gives it.
    await post('/event', { type: 'chat', raw: 'Nova_77: yo 3172' });

    const { actions } = await poll();
    assert.equal(actions.length, 1, 'one reply queued for the client to type');

    const action = actions[0];
    // These three fields are what drain() in the module reads. If any is
    // renamed, the bot goes silent in game while every unit test still passes.
    assert.equal(typeof action.command, 'string');
    assert.ok(action.command.length > 0);
    assert.equal(typeof action.delayMs, 'number');
    assert.ok(action.delayMs > 0);

    // ChatLib.say() on a string starting with "/" would run a command.
    assert.ok(!action.command.startsWith('/'), 'never type a slash command by accident');

    // Draining is destructive: the module polls every 10 ticks and must not
    // retype the same line each time.
    assert.deepEqual((await poll()).actions, []);
  });
});

test('the pathfinder hook a macro calls directly produces a call-out', async () => {
  await withGame({ replies: ['nova move'] }, async ({ post, poll }) => {
    await post('/event', { type: 'players', nearby: [{ name: 'Nova_77', distance: 1.4 }] });

    // MCChatAI.pathfinder("blocked", name, distance) — the exported hook.
    for (const distance of [1.4, 1.3, 1.2, 1.1]) {
      await post('/event', {
        type: 'pathfinder',
        state: 'blocked',
        blockedBy: { name: 'Nova_77', distance },
      });
    }

    const { actions } = await poll();
    assert.ok(actions.length >= 1, 'repeated blocking eventually gets a reply');
    assert.ok(!actions[0].command.startsWith('/'));
  });
});

test('the module sends distance-only blockers, with no nearby list yet', async () => {
  // On a fresh launch the tick that reports a stall can beat the 40-tick
  // snapshot, so the brain meets a player it has never seen.
  await withGame({ replies: ['move pls'] }, async ({ post }) => {
    for (const distance of [1.4, 1.3, 1.2, 1.1]) {
      const body = await post('/event', {
        type: 'pathfinder',
        state: 'blocked',
        blockedBy: { name: 'Nova_77', distance },
      });
      assert.equal(body.ok, true, 'never a 500 just because nearby is unknown');
    }
  });
});

test('our own line coming back through the chat listener is not answered', async () => {
  // register('chat') matches ${*}, so everything we type is echoed to us.
  await withGame({ replies: ['yh?'] }, async ({ post, poll }) => {
    await post('/event', { type: 'chat', raw: '3172: yh?' });
    assert.deepEqual((await poll()).actions, [], 'answering ourselves would loop forever');
  });
});

test('dry run hands the client nothing to type, by either route', async () => {
  await withGame({ dryRun: true, replies: ['yh?'] }, async ({ post, poll }) => {
    await post('/event', { type: 'players', nearby: [{ name: 'Nova_77', distance: 3.2 }] });
    const body = await post('/event', { type: 'chat', raw: 'Nova_77: yo 3172' });

    // Two routes reach the game: /poll, which the ChatTriggers module uses,
    // and the POST response, which the bridge documents as usable directly.
    // Dry run has to close both, or the first real in-game test types.
    assert.deepEqual(body.actions, [], 'the POST response must not carry it either');
    assert.deepEqual((await poll()).actions, [], 'dry run must never reach the game');
  });
});

test('dry run still says what it would have said', async () => {
  await withGame({ dryRun: true, replies: ['yh?'] }, async ({ ai, post }) => {
    const skipped = [];
    ai.on('skip', (event) => skipped.push(event.reason));
    await post('/event', { type: 'players', nearby: [{ name: 'Nova_77', distance: 3.2 }] });
    await post('/event', { type: 'chat', raw: 'Nova_77: yo 3172' });
    assert.ok(
      skipped.some((reason) => reason.includes('would have said')),
      'the whole point of a dry run is seeing the line',
    );
  });
});

test('a malformed chat line does not take the bridge down', async () => {
  await withGame({}, async ({ post }) => {
    for (const raw of ['', '   ', 'Â§7[MVP+] weird colour codes', '3172', ':::']) {
      const body = await post('/event', { type: 'chat', raw });
      assert.equal(body.ok, true, `survived ${JSON.stringify(raw)}`);
    }
  });
});
