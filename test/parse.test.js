import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatLine, stripFormatting } from '../src/chat/parse.js';

test('strips colour codes', () => {
  assert.equal(stripFormatting('§a§lHello §rthere'), 'Hello there');
});

test('parses public chat with rank and skyblock level badges', () => {
  const parsed = parseChatLine('§b[123] §b[MVP§c+§b] Notch§f: hey there');
  assert.equal(parsed.sender, 'Notch');
  assert.equal(parsed.content, 'hey there');
  assert.equal(parsed.channel, 'all');
  assert.equal(parsed.system, false);
});

test('parses party, guild and whisper channels', () => {
  assert.equal(parseChatLine('Party > [VIP] Notch: hey').channel, 'party');
  assert.equal(parseChatLine('Guild > [MVP+] Notch [Officer]: hey').channel, 'guild');
  assert.equal(parseChatLine('From [MVP+] Notch: hey').channel, 'whisper');
  assert.equal(parseChatLine('Guild > [MVP+] Notch [Officer]: hey').content, 'hey');
});

test('treats colon-less lines as system messages', () => {
  const parsed = parseChatLine('Notch joined the lobby');
  assert.equal(parsed.sender, null);
  assert.equal(parsed.system, true);
});

test('handles names longer than the vanilla 16-char limit', () => {
  assert.equal(parseChatLine('[MVP+] xX_DreamSlayer_Xx: hi').sender, 'xX_DreamSlayer_Xx');
});
