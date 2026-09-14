/**
 * Headless adapter — runs the whole thing on a mineflayer bot instead of your
 * own client. Useful for testing the responses without risking your account,
 * and for alt accounts.
 *
 *   npm install mineflayer mineflayer-pathfinder
 *
 *   import { attach } from './adapters/mineflayer.js';
 *   const bot = mineflayer.createBot({ host: 'localhost', username: 'Tester' });
 *   attach(bot, createChatAI({ username: 'Tester' }));
 */

const NEARBY_RADIUS = 16;

/**
 * @param {import('mineflayer').Bot} bot
 * @param {import('../src/brain.js').ChatAI} ai
 */
export function attach(bot, ai, { snapshotMs = 2000 } = {}) {
  bot.on('message', (jsonMsg) => {
    ai.handle({ type: 'chat', raw: jsonMsg.toString() }).catch((e) => ai.emit('error', e));
  });

  ai.on('say', (action) => {
    setTimeout(() => bot.chat(action.command), action.delayMs);
  });

  const timer = setInterval(() => {
    if (!bot.entity) return;
    const nearby = Object.values(bot.players)
      .filter((p) => p.entity && p.username !== bot.username)
      .map((p) => ({ name: p.username, distance: bot.entity.position.distanceTo(p.entity.position) }))
      .filter((p) => p.distance <= NEARBY_RADIUS);

    ai.handle({ type: 'players', nearby });
    ai.handle({
      type: 'self',
      username: bot.username,
      health: bot.health,
      area: bot.game?.dimension ?? null,
    });
  }, snapshotMs);

  // mineflayer-pathfinder emits these; wire them straight through.
  bot.on('path_update', (results) => {
    ai.handle({
      type: 'pathfinder',
      state: results.status === 'noPath' ? 'stuck' : 'running',
      target: describeGoal(bot),
      blockedBy: blockerInFront(bot),
    });
  });
  bot.on('goal_reached', () => ai.handle({ type: 'pathfinder', state: 'idle' }));
  bot.on('path_reset', (reason) => {
    ai.handle({
      type: 'pathfinder',
      state: reason === 'stuck' ? 'blocked' : 'stopped',
      blockedBy: blockerInFront(bot),
    });
  });

  bot.once('end', () => clearInterval(timer));
  return () => clearInterval(timer);
}

/** Closest player within 4 blocks and roughly in front of us. */
function blockerInFront(bot) {
  if (!bot.entity) return null;
  const yaw = bot.entity.yaw;
  const look = { x: -Math.sin(yaw), z: -Math.cos(yaw) };

  let best = null;
  for (const player of Object.values(bot.players)) {
    if (!player.entity || player.username === bot.username) continue;
    const delta = player.entity.position.minus(bot.entity.position);
    const distance = Math.hypot(delta.x, delta.z);
    if (distance > 4 || distance < 0.1) continue;
    const dot = (delta.x / distance) * look.x + (delta.z / distance) * look.z;
    if (dot < 0.55) continue;
    if (!best || distance < best.distance) best = { name: player.username, distance };
  }
  return best;
}

function describeGoal(bot) {
  const goal = bot.pathfinder?.goal;
  if (!goal) return null;
  if (goal.x !== undefined) return `${Math.round(goal.x)},${Math.round(goal.y ?? 0)},${Math.round(goal.z)}`;
  return goal.constructor?.name ?? null;
}
