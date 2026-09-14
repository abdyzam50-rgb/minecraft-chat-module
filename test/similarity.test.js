import test from 'node:test';
import assert from 'node:assert/strict';
import { similarity, similarityIgnoringNames, findRepeat } from '../src/chat/similarity.js';

test('identical and unrelated lines sit at the extremes', () => {
  assert.equal(similarity('move please', 'move please'), 1);
  assert.ok(similarity('move out of my path', 'anyone selling a bleeding heart') < 0.2);
});

test('catches rewordings that exact-match dedupe would let through', () => {
  assert.ok(similarity('move out of my path', 'move out my path') > 0.55);
  assert.ok(similarity('im not macroing, been grinding a while', 'not macroing, ive just been here a while') > 0.55);
});

test('ignores the addressee so two lines to one player are still comparable', () => {
  const a = 'dream move out of my path';
  const b = 'dream stop standing in front of me';
  assert.ok(similarity(a, b) < similarityIgnoringNames(a, b, ['dream']) + 0.2);
  assert.ok(similarityIgnoringNames(a, b, ['dream']) < 0.4, 'different lines stay different');
});

test('findRepeat reports the line it clashed with', () => {
  const recent = ['report me then, ill wait', 'dream move out of my path'];
  const result = findRepeat('move out my path', recent, { threshold: 0.55, names: ['dream'] });
  assert.equal(result.repeat, true);
  assert.equal(result.match, 'dream move out of my path');
});

test('findRepeat passes a genuinely new line', () => {
  const recent = ['dream move out of my path', 'report me then, ill wait'];
  const result = findRepeat('been here since 4am, this is just what grinding looks like', recent, {
    threshold: 0.55,
    names: ['dream'],
  });
  assert.equal(result.repeat, false);
});

test('empty history never counts as a repeat', () => {
  assert.equal(findRepeat('anything', []).repeat, false);
});
