import fs from 'node:fs';
import path from 'node:path';

/**
 * Facts the bot should treat as true, loaded from a file the user maintains.
 *
 * A different or larger model does not fix wrong game knowledge: SkyBlock's
 * meta changes constantly and every model's training data has a cutoff. What
 * fixes it is telling the bot what is currently true, which is what this is.
 *
 * It lands in the cached half of the prompt, so length is close to free.
 */
export function loadKnowledge(config) {
  const parts = [];

  if (config.knowledge?.file) {
    const file = path.resolve(config.knowledge.file);
    try {
      parts.push(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`Could not read knowledge file ${file}: ${error.message}`);
    }
  }
  if (config.knowledge?.text) parts.push(config.knowledge.text);

  return parts.join('\n\n').trim();
}

/** Renders the knowledge and the honesty rule for the system prompt. */
export function buildKnowledgeSection(config, knowledge) {
  const lines = [];

  if (knowledge) {
    lines.push(
      'What you know about the game. This is current and it overrides anything you think you remember:',
      knowledge,
      '',
    );
  }

  if (config.knowledge?.admitIgnorance !== false) {
    lines.push(
      'What you do not know:',
      '- You grind ghosts. You are not an authority on the rest of the game, and the meta moves constantly.',
      '- If you are not sure, say so: "idk tbh", "no clue mate", "not my area", "ask in hub". A wrong answer given confidently is worse than no answer, and a player who has been on one grind for ten hours genuinely would not know the current early-game meta.',
      '- Never invent prices, drop rates, or advice. Never present a guess as fact.',
      '',
    );
  }

  return lines;
}
