#!/usr/bin/env node
/**
 * Replay a scripted scenario through the brain — no Minecraft needed.
 *
 *   node bin/simulate.js              # the pathfinder-griefer scenario
 *   node bin/simulate.js --persona unfiltered
 *
 * With ANTHROPIC_API_KEY set it calls the real model; without it you see the
 * fallback lines and, more importantly, the trigger/skip decisions.
 */
import { createChatAI } from '../src/index.js';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith('--') ? [[a.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : true]] : [],
  ),
);

const ai = createChatAI({
  username: args.username ?? '3172',
  persona: args.persona ?? 'snarky',
  // The scenario compresses ~2 minutes of game time into a second.
  limits: { globalCooldownMs: 0, perKindCooldownMs: 0, perPlayerCooldownMs: 0 },
});

ai.on('trigger', ({ trigger }) => console.log(`\n  ~ ${trigger.kind}: ${trigger.evidence}`));
ai.on('say', (a) => console.log(`  >> ${a.command}   [${a.source}]`));
ai.on('skip', ({ reason }) => console.log(`  -- silent: ${reason}`));
ai.on('error', (e) => console.log(`  !! ${e.message}`));

const GRIEFER = 'xX_DreamSlayer_Xx';

// A macro check as it actually plays out in the Mist: they plant themselves in
// your face, keep doing it, and narrate the whole thing in chat.
const block = { type: 'pathfinder', state: 'blocked', blockedBy: { name: GRIEFER, distance: 1.4 } };

const script = [
  { type: 'self', username: ai.config.username, area: 'The Mist, Dwarven Mines', activity: 'ghost grinding' },
  { type: 'players', nearby: [{ name: GRIEFER, distance: 2.1 }] },
  { type: 'pathfinder', state: 'running', target: 'ghost spawn' },
  block,
  block,
  block,
  { type: 'chat', raw: `[MVP+] ${GRIEFER}: lol why arent you moving` },
  block,
  { type: 'chat', raw: `[MVP+] ${GRIEFER}: macro check, say something if ur real` },
  block,
  block,
  { type: 'chat', raw: `[MVP+] ${GRIEFER}: ur macroing arent you` },
  block,
  { type: 'chat', raw: `[MVP+] ${GRIEFER}: im reporting you for macroing cheater` },
  { type: 'chat', raw: 'Party > [VIP] SomeFriend: ignore him lol' },
];

console.log(`persona: ${ai.config.persona} | model: ${ai.usingApi ? ai.config.llm.model : 'fallback lines'}\n`);

for (const event of script) {
  const label = event.type === 'chat' ? event.raw : `${event.type}:${event.state ?? ''}`;
  console.log(`[${event.type}] ${label}`);
  await ai.handle(event);
}
