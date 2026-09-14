import test from 'node:test';
import assert from 'node:assert/strict';
import { shortName, mentions } from '../src/chat/shortname.js';

test('shortName picks the memorable chunk', () => {
  assert.equal(shortName('xX_DreamSlayer_Xx'), 'Dream');
  assert.equal(shortName('Technoblade'), 'Techno');
  assert.equal(shortName('Bob123'), 'Bob');
  assert.equal(shortName('Notch'), 'Notch');
  assert.equal(shortName('TheRealGamer99'), 'Real');
});

test('shortName keeps short names intact and never returns a stub', () => {
  assert.equal(shortName('a_b_c'), 'a_b_c');
  assert.equal(shortName(''), '');
});

test('shortName honours overrides case-insensitively', () => {
  assert.equal(shortName('xX_DreamSlayer_Xx', { overrides: { xx_dreamslayer_xx: 'Slayer' } }), 'Slayer');
});

test('mentions matches full names, short forms and clipped forms', () => {
  assert.equal(mentions('techno stop that', 'Technoblade'), true);
  assert.equal(mentions('yo Technoblade', 'Technoblade'), true);
  assert.equal(mentions('dream move', 'xX_DreamSlayer_Xx'), true);
  assert.equal(mentions('nice weather', 'Technoblade'), false);
  assert.equal(mentions('technology rules', 'Technoblade'), false);
});

test('mentions honours configured aliases', () => {
  assert.equal(mentions('oi bladey', 'Technoblade', ['bladey']), true);
});
