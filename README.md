# minecraft-chat-module

An in-game chat AI that actually knows what's going on around you.

It watches your chat, who's nearby, and what your pathfinder is doing. When
someone plants themselves in front of you at a ghost spot to macro check you,
it tells them to move — and if they keep at it, it stops being polite.

```
[macro_check · anger 1] Dream has stood in front of me 3x in 45s
  >> dream yes im real, macro check over, move

[macro_check · anger 2] ...and came straight back
  >> dream ive answered you twice, im real, go away

[macro_check · anger 3] ...still there after being told twice
  >> DREAM MOVE. IM REAL. YOUVE BEEN IN MY FACE FOR TWO MINUTES.

[chat] [MVP+] xX_DreamSlayer_Xx: ur macroing im reporting you
  >> not macroing, you've just never seen someone play for more than 10 minutes
```

## How it's put together

Two halves, because the API key must never live inside your Minecraft client:

```
Minecraft client                     your machine
┌────────────────────┐   HTTP       ┌──────────────────────────┐
│ ChatTriggers module│ ───events──> │ mcchat brain             │
│  - chat lines      │              │  parse → detect → policy │──> Claude API
│  - nearby players  │ <──replies── │  → sanitize → rate limit │
│  - pathfinder state│              └──────────────────────────┘
└────────────────────┘
```

The brain is plain Node with one dependency (`@anthropic-ai/sdk`). The bridge
binds to `127.0.0.1` and speaks JSON, so anything that can do an HTTP POST can
drive it — ChatTriggers, a Forge mod, a Baritone plugin, or the included
mineflayer adapter.

## Setup

```bash
npm install
cp .env.example .env          # put your ANTHROPIC_API_KEY in here
cp config.example.json config.json
```

Edit `config.json` — `username` is preset to `3172`; change it if your IGN
differs. Then:

```bash
node --env-file=.env bin/mcchat.js            # or: npm start
```

Try it without Minecraft first:

```bash
node bin/simulate.js --persona snarky
```

That replays a scripted griefer (blocks your path three times, then accuses you
of macroing) and prints every decision, including the ones where it chooses to
stay quiet.

For a clickable version, open `web/chat-sandbox.html` in a browser — a fake
Hypixel window where you can talk as another player, step in front of the
pathfinder, and watch the limiter and decision log react. It runs the real
detection, naming, sanitising and rate-limiting logic with the offline canned
lines, so no key and no server are needed.

### Hooking up the client

Copy `chattriggers/` into
`.minecraft/config/ChatTriggers/modules/MCChatAI/`, set `TOKEN` at the top of
`index.js` to match `bridge.token` in your config, and `/ct reload`.

It figures out "someone is blocking me" on its own: a player inside a 4-block
cone in front of you while your position hasn't changed for a second. If your
macro can report its own state, call the exported hook directly and you'll get
much better signal:

```js
MCChatAI.pathfinder('blocked', 'SomePlayer', 1.4);
MCChatAI.pathfinder('running');
```

`/mcchat off` kills it instantly without unloading the module.

The ChatTriggers module targets CT 2.x on 1.8.9; the `Player`/`World` calls may
need small edits on other versions. The brain is unaffected either way.

### Or run it headless

```bash
npm install mineflayer mineflayer-pathfinder
```

```js
import mineflayer from 'mineflayer';
import { createChatAI } from './src/index.js';
import { attach } from './adapters/mineflayer.js';

const bot = mineflayer.createBot({ host: 'localhost', username: 'Tester' });
attach(bot, createChatAI({ username: 'Tester', persona: 'snarky' }));
```

Good for tuning personas on a private server before pointing it at Hypixel.

## Macro checks

The Mist is the most macro-accused grind in the game — ghost macroers really do
run it around the clock — so players constantly run their own checks: they stand
in your face, block your path, or type *"u real?"* to see whether you react like
a person. A macro doesn't. That's the whole test.

So a repeat blocker isn't treated as a griefer who needs telling once. The reply
climbs a ladder, one message per rung:

| Anger | When | Sounds like (snarky) |
|---|---|---|
| 1 | 3 blocks in 45s | "dream yes im real, macro check over, move" |
| 2 | `patience` blocks | "dream ive answered you twice, im real, go away" |
| 3 | `rage` blocks after that | "DREAM MOVE. IM REAL. YOUVE BEEN IN MY FACE FOR TWO MINUTES." |

**Both counts are rolled per player, per session** (`detect.pathfinder.patience`
and `.rage`, default 4–7 then +2–4). Snapping on exactly the third block every
single time is itself a detectable pattern, and a macro check is precisely the
moment somebody is watching for one — so there isn't a fixed number to learn.
The polite rung is never skipped, however the roll lands.

Anger 3 is shouted in caps by the `snarky` and `unfiltered` personas. `chill`
still escalates, but stays in lowercase — it has `shouts: false`.

Verbal checks count too: *"macro check"*, *"u real?"*, *"say something"*,
*"react"*, *"hit me if ur not macroing"* all push the same ladder when they come
from someone standing near you, and they take precedence over the accusation
handler when both match.

Each rung speaks once. Repeating a rung would burn the message budget the next
one needs, so an escalating reply also steps past the per-player cooldown — a
whole macro check plays out inside one 60-second window, and the bot going quiet
mid-argument reads worse than never speaking. Three messages to one player is
still the hard ceiling.

## What makes it speak

| Trigger | Fires when |
|---|---|
| `macro_check` | The same player blocks your path 3× in 45s **and** is still within 4 blocks — then escalates as above |
| `accusation` | Someone says cheat/hack/macro/bot/report **and** it's aimed at you — your name, nearby, blocking you, or replying to your last line |
| `hostile` | "move", "get out", "my spot" from someone next to you |
| `mention` / `whisper` | Your name or short form appears, or someone whispers you |

The thresholds exist because the first version fired on every walk-by and was
unbearable. One person crossing your path is noise; three times in 45 seconds
is a person doing it on purpose. All of it is in `config.detect`.

After a trigger fires, the model still gets the final say on whether to speak —
it returns `respond: false` for arguments that aren't worth continuing.

## What stops it speaking

Auto-chat is the fastest way to get muted, so the limiter is deliberately
strict (`src/chat/policy.js`):

- 8s between any two messages, 4/minute, 30/hour
- 60s before replying to the same player again
- never more than 2 replies to the same person back-to-back
- identical messages inside 5 minutes are dropped (Hypixel eats duplicates anyway)
- a "you are muted" line in chat silences the bot for 15 minutes
- anything starting with `/` gets its slash stripped — a model reply can never
  execute a command
- links, invite codes and IP addresses are blocked outright

`"dryRun": true` runs the whole pipeline and logs what it *would* have said.
Start there.

## Personas

| Persona | Sounds like |
|---|---|
| `chill` | "dream im real, you can stop standing in my path" — never shouts |
| `snarky` *(default)* | "dream standing in my path isn't a personality, move" |
| `unfiltered` | swears, exactly like your example |

Every persona is bound by rules it can't override: no slurs, no attacks on
who someone is, nothing about anyone's real life, no impersonating staff,
nothing sexual. Trash talk about what someone is *doing* is fair game.

`chat.profanity: "clean"` (the default) swaps swears for tamer words on the way
out, so you can run `unfiltered` for the attitude without the mute risk. It
does **not** do letter-substitution to sneak past chat filters — if you want
the words, set `"allow"` and accept the consequences.

## Before you run this on Hypixel

Hypixel's rules treat automated chat responses as a bannable offence, same
category as the macro you're already running. Swearing at players gets you
muted quickly, and `unfiltered` will get you muted faster.

Nothing here hides what it is, evades chat filters, or dodges detection — it
just answers faster than you can type. How much risk that's worth is your call,
but make it knowingly. The safe configuration is `dryRun` first, then `chill`
or `snarky` with `profanity: "clean"`, `speakIn: ["party"]`, and low rate
limits.

## Bridge API

Everything takes `X-Auth: <bridge.token>`.

| Route | Body | Returns |
|---|---|---|
| `POST /event` | one event object | `{ok, actions}` |
| `POST /events` | array of events | `{ok, actions}` |
| `GET /poll` | — | `{actions}` — queued lines, drained on read |
| `GET /health` | — | status, persona, whether the API key resolved |

Events:

```jsonc
{ "type": "chat",       "raw": "[MVP+] Notch: ur macroing" }
{ "type": "pathfinder", "state": "blocked", "blockedBy": { "name": "Notch", "distance": 1.4 } }
{ "type": "players",    "nearby": [{ "name": "Notch", "distance": 2.3 }] }
{ "type": "self",       "area": "The Mist, Dwarven Mines", "activity": "ghost grinding" }
{ "type": "sent",       "message": "what you just typed yourself" }
```

An action back:

```json
{
  "type": "chat",
  "message": "dream move out of my path",
  "command": "/pc dream move out of my path",
  "channel": "party",
  "delayMs": 1240,
  "trigger": "pathfinder_blocked",
  "source": "claude"
}
```

Send `command` verbatim — it already carries `/pc`, `/gc` or `/w <name>` for
non-public channels. `delayMs` is a randomised typing pause; honour it.

## Using it as a library

```js
import { createChatAI } from './src/index.js';

const ai = createChatAI({ username: 'Notch', persona: 'snarky' });
ai.on('say', (action) => yourClient.chat(action.command));
ai.on('skip', ({ reason }) => console.log('stayed quiet:', reason));

await ai.handle({ type: 'chat', raw: '[MVP+] Griefer: ur macroing' });
```

Without `ANTHROPIC_API_KEY` it falls back to per-persona canned lines, so the
detection and rate limiting stay testable offline. The same fallback catches
API timeouts mid-game.

## Layout

```
src/chat/parse.js       Hypixel chat lines -> {sender, content, channel}
src/chat/shortname.js   xX_DreamSlayer_Xx -> Dream; fuzzy mention matching
src/chat/sanitize.js    strip slashes/links, soften profanity, fit the chat box
src/chat/policy.js      cooldowns, rate limits, dedupe, mute handling
src/context/store.js    rolling world state: chat, players, pathfinder, incidents
src/detect/             when something is worth reacting to, and how angry
src/llm/prompt.js       system prompt (cached) + per-event context
src/llm/claude.js       the one API call, structured JSON out
src/brain.js            wires it together, emits 'say' / 'skip'
src/bridge/server.js    localhost HTTP bridge
chattriggers/           the in-game half
adapters/mineflayer.js  headless alternative
bin/simulate.js         replay a scenario with no Minecraft
```

## Tests

```bash
npm test
```

52 tests over name shortening, chat parsing, detector thresholds, the macro-check
escalation ladder, the rate limiter, sanitisation, the bridge, and the full
event→reply path with a mocked API client. No test hits the network.
