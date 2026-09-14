import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../src/config.js';
import { buildSystemPrompt } from '../src/llm/prompt.js';

test('the knowledge file lands in the prompt and is marked as authoritative', () => {
  const prompt = buildSystemPrompt(
    resolveConfig({ username: '3172', knowledge: { file: 'knowledge/skyblock.md' } }),
  );
  assert.match(prompt, /overrides anything you think you remember/);
  assert.match(prompt, /The Forge/, 'the real early-game methods are in there');
  assert.match(prompt, /NOT early game/, 'and what not to suggest');
  assert.match(prompt, /f7 \/ master mode dungeons — endgame/);
});

test('inline text can be used instead of, or alongside, a file', () => {
  const prompt = buildSystemPrompt(
    resolveConfig({ username: '3172', knowledge: { text: 'Mayor is Derpy this week.' } }),
  );
  assert.match(prompt, /Mayor is Derpy this week/);
});

test('it is allowed to say it does not know', () => {
  const prompt = buildSystemPrompt(resolveConfig({ username: '3172' }));
  assert.match(prompt, /If you are not sure, say so/);
  assert.match(prompt, /A wrong answer given confidently is worse than no answer/);
  assert.match(prompt, /Never invent prices, drop rates, or advice/);
});

test('the honesty rule can be turned off', () => {
  const prompt = buildSystemPrompt(
    resolveConfig({ username: '3172', knowledge: { admitIgnorance: false } }),
  );
  assert.doesNotMatch(prompt, /If you are not sure, say so/);
});

test('a missing knowledge file fails loudly rather than silently', () => {
  assert.throws(
    () => buildSystemPrompt(resolveConfig({ username: '3172', knowledge: { file: 'nope.md' } })),
    /Could not read knowledge file/,
  );
});
