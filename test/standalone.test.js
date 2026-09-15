import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { wrap } from '../web/build-standalone.mjs';

const source = fs.readFileSync('web/chat-sandbox.html', 'utf8');
const html = wrap(source);

test('the page the Artifact runs declares no head of its own', () => {
  // The Artifact platform supplies it and rejects these tags in the source,
  // which is exactly why the standalone copy has to add them.
  assert.doesNotMatch(source, /<!doctype/i);
  assert.doesNotMatch(source, /<head>/i);
  assert.doesNotMatch(source, /<meta charset/i);
});

test('the standalone copy declares utf-8', () => {
  assert.match(html, /<meta charset="utf-8">/);
  // Without this the browser reads the bytes as Latin-1 and every dash,
  // ellipsis and emoji in the page turns into mojibake.
  assert.ok(html.indexOf('<meta charset="utf-8">') < html.indexOf('<body>'));
});

test('characters that were corrupting survive the wrap', () => {
  // Every non-ASCII character the page actually uses, read from the file
  // rather than guessed — these are exactly what the browser was mangling.
  const nonAscii = [...new Set(source.match(/[^\u0000-\u007F]/g) ?? [])];
  assert.ok(nonAscii.length > 0, 'the page does use non-ASCII');
  for (const char of nonAscii) {
    assert.ok(html.includes(char), `lost ${char}`);
  }
  assert.match(html, /is typing…/, 'the typing indicator was the visible symptom');
});

test('exactly one title, hoisted into the head', () => {
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.match(html, /<head>[\s\S]*<title>Hypixel Chat Sandbox<\/title>[\s\S]*<\/head>/);
});

test('font links move to the head, where preconnect is worth something', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /preconnect.*fonts\.googleapis\.com/);
  assert.match(head, /fonts\.googleapis\.com\/css2/);
});

test('the page itself is carried over whole', () => {
  assert.match(html, /function isGreetingOnly/);
  assert.match(html, /function accusationTarget/);
  assert.match(html, /MCCHAT_API_URL/);
  // config.js must still load before the inline script that reads it.
  assert.ok(html.indexOf('src="config.js"') < html.indexOf('window.claude'));
});

test('the page carries the same game knowledge the module does', async () => {
  // The module reads knowledge/skyblock.md at request time; the page cannot,
  // so it is baked in. This fails the moment the two drift.
  const { render } = await import('../web/build-sandbox.mjs');
  const markdown = fs.readFileSync('knowledge/skyblock.md', 'utf8');
  assert.equal(
    render(source, markdown),
    source,
    'web/chat-sandbox.html is stale — run: node web/build-sandbox.mjs',
  );
});

test('the baked knowledge holds the facts the bot got wrong', () => {
  const knowledge = JSON.parse(source.match(/const KNOWLEDGE = ("(?:[^"\\]|\\.)*");/)[1]);
  assert.match(knowledge, /The Forge/);
  assert.match(knowledge, /NPC flipping/);
  assert.match(knowledge, /Zealots/);
  assert.match(knowledge, /NOT early game/);
  assert.match(knowledge, /f7 \/ master mode dungeons — endgame/);
});

test('the page may admit it does not know', () => {
  assert.match(source, /idk tbh/);
  assert.match(source, /Never invent prices, drop rates or advice/);
  assert.match(source, /worse than no answer/);
});
