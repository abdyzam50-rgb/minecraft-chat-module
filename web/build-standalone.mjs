#!/usr/bin/env node
/**
 * Wrap the sandbox for hosts that are not the Artifact platform.
 *
 * chat-sandbox.html is written as an Artifact *source*: no doctype, no <html>,
 * no <head>, because the platform supplies those and rejects them in the file.
 * Served directly by Cloudflare it therefore arrives with no charset at all —
 * and with `content-type: text/html` carrying none either, the browser falls
 * back to Latin-1 and every … — · 👻 ⛏ in the page turns to mojibake.
 *
 * So the file stays artifact-shaped and this adds the head the other host needs.
 * One source of truth for the page itself.
 *
 *   node web/build-standalone.mjs web/chat-sandbox.html out/index.html
 */
import fs from 'node:fs';
import path from 'node:path';

/** Mirrors the reset the Artifact platform injects, so both look the same. */
const RESET = ':root{color-scheme:light dark}html,body{margin:0}' +
  'body{font:14px system-ui,-apple-system,sans-serif}' +
  'img{max-width:100%}[hidden]{display:none!important}';

export function wrap(content, { title = 'Hypixel Chat Sandbox' } = {}) {
  // Hoist the tags that belong in <head>. The Artifact platform does this for
  // us; a plain browser will cope with them in <body>, but preconnect hints
  // are wasted there and a duplicated <title> is just sloppy.
  const head = [];
  const body = content.replace(
    /^\s*<(?:title|link|meta)\b[^>]*>(?:[^<]*<\/title>)?\s*/gim,
    (tag) => {
      head.push(tag.trim());
      return '';
    },
  );

  const found = head.join('\n').match(/<title>([^<]*)<\/title>/i);
  const hoisted = head.filter((tag) => !/^<title/i.test(tag));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${found ? found[1] : title}</title>
${hoisted.join('\n')}
<style>${RESET}</style>
</head>
<body>
${body.trimStart()}
</body>
</html>
`;
}

const [, , source, target] = process.argv;
if (source && target) {
  const content = fs.readFileSync(source, 'utf8');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, wrap(content), 'utf8');
  console.log(`wrapped ${source} -> ${target}`);
}
