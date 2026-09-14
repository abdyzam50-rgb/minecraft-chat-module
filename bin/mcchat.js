#!/usr/bin/env node
/**
 * Run the brain as a local service for an in-game module to talk to.
 *
 *   mcchat --username Notch --persona snarky
 *   mcchat --config ./config.json --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { createChatAI } from '../src/index.js';
import { startBridge } from '../src/bridge/server.js';
import { checkProvider } from '../src/check.js';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
mcchat — context-aware Minecraft chat AI

  --config <path>     JSON config file (default: ./config.json if present)
  --username <name>   your in-game name (required)
  --persona <name>    chill | snarky | unfiltered
  --port <n>          bridge port (default 8787)
  --token <secret>    require this in the X-Auth header
  --check             make one real API call and report what came back
  --dry-run           decide and log, never send
  --help
`);
  process.exit(0);
}

const configPath = args.config ?? (fs.existsSync('config.json') ? 'config.json' : null);
let fileConfig = {};
if (configPath) {
  fileConfig = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
  console.log(`[mcchat] loaded ${configPath}`);
}

const overrides = {};
if (args.username) overrides.username = args.username;
if (args.persona) overrides.persona = args.persona;
if (args['dry-run']) overrides.dryRun = true;
if (args.port) overrides.bridge = { port: Number(args.port) };
if (args.token) overrides.bridge = { ...overrides.bridge, token: args.token };

let ai;
try {
  ai = createChatAI({ ...fileConfig, ...overrides });
} catch (error) {
  console.error(`[mcchat] ${error.message}`);
  process.exit(1);
}

ai.on('trigger', ({ trigger }) =>
  console.log(`[trigger] ${trigger.kind} (${trigger.subject ?? '-'}) — ${trigger.evidence}`),
);
ai.on('say', (action) =>
  console.log(`[say] ${action.command}    (${action.source}: ${action.reason})`),
);
ai.on('skip', ({ trigger, reason }) =>
  console.log(`[skip] ${trigger?.kind ?? '-'}: ${reason}`),
);
ai.on('error', (error) => console.error(`[error] ${error.message}`));

if (!ai.usingApi) {
  console.log('[mcchat] ANTHROPIC_API_KEY not set — falling back to canned lines.');
  console.log('[mcchat] Those repeat. Set a key before using this anywhere real.');
}
console.log(`[mcchat] ${ai.config.username} / persona ${ai.config.persona}${ai.config.dryRun ? ' / DRY RUN' : ''}`);
if (ai.config.llm.correctedModel) {
  console.log(
    `[mcchat] llm.model was "${ai.config.llm.correctedModel}", which is not a ${ai.config.llm.provider} model — using ${ai.config.llm.model}`,
  );
}

if (args.check) {
  console.log(`[check] ${ai.config.llm.provider} / ${ai.config.llm.model} — sending one real request...`);
  if (!ai.usingApi) {
    console.error(
      `[check] no key found. Set ${
        ai.config.llm.provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'
      } (or llm.apiKey) and try again.`,
    );
    process.exit(1);
  }
  try {
    const result = await checkProvider(ai);
    console.log(`[check] ok in ${result.ms}ms`);
    console.log(
      result.knowledgeChars
        ? `[check] knowledge file loaded (${result.knowledgeChars} chars)`
        : '[check] no knowledge file — set knowledge.file to knowledge/skyblock.md so it stops guessing about the game',
    );
    console.log(`[check] a player said "wsg" and it replied: ${JSON.stringify(result.message)}`);
    console.log(`[check] respond=${result.respond} reason=${JSON.stringify(result.reason)}`);
    if (result.respond && result.message.split(/\s+/).length > 3) {
      console.log('[check] note: that is longer than a greeting warrants — worth a look');
    }
  } catch (error) {
    console.error(`[check] FAILED: ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

startBridge(ai);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}
