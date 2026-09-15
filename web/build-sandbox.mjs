#!/usr/bin/env node
/**
 * Inject knowledge/skyblock.md into the sandbox page.
 *
 * The Node module reads that file at request time (src/knowledge.js). The page
 * cannot — it is a static file served to a browser — so the facts are baked in
 * here instead, from the same source, and a test fails if the two drift.
 *
 * This exists because the page was asked "whats a good early game money making
 * meta?" and answered "just grinding ghosts". It had nothing to answer with:
 * the knowledge file was wired into the module and never into the page.
 *
 *   node web/build-sandbox.mjs          # rewrite the page in place
 *   node web/build-sandbox.mjs --check  # fail if it is out of date
 */
import fs from 'node:fs';

const PAGE = 'web/chat-sandbox.html';
const SOURCE = 'knowledge/skyblock.md';
const BEGIN = '  // >>> generated from knowledge/skyblock.md — run web/build-sandbox.mjs';
const END = '  // <<< generated';

/** The page sends the prompt as one string, so the markdown goes in verbatim. */
export function buildBlock(markdown) {
  const body = markdown
    .replace(/\r\n/g, '\n')
    .trim()
    // Drop the file's own notes-to-self; they are instructions for the human
    // maintaining it, not facts for the model.
    .replace(/^Edit this file\.[\s\S]*?Facts, not essays\.\n+/m, '');

  return [
    BEGIN,
    `  const KNOWLEDGE = ${JSON.stringify(body)};`,
    END,
  ].join('\n');
}

export function render(page, markdown) {
  const start = page.indexOf(BEGIN);
  const end = page.indexOf(END);
  const block = buildBlock(markdown);

  if (start === -1 || end === -1) {
    throw new Error(`Markers missing from ${PAGE}. Expected:\n${BEGIN}\n  ...\n${END}`);
  }
  return page.slice(0, start) + block + page.slice(end + END.length);
}

const page = fs.readFileSync(PAGE, 'utf8');
const markdown = fs.readFileSync(SOURCE, 'utf8');
const next = render(page, markdown);

if (process.argv.includes('--check')) {
  if (next !== page) {
    console.error(`${PAGE} is out of date with ${SOURCE}. Run: node web/build-sandbox.mjs`);
    process.exit(1);
  }
  console.log(`${PAGE} is in sync with ${SOURCE}`);
} else if (next !== page) {
  fs.writeFileSync(PAGE, next, 'utf8');
  console.log(`updated ${PAGE} from ${SOURCE}`);
} else {
  console.log(`${PAGE} already in sync`);
}
