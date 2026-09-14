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
pathfinder, and watch the limiter and decision log react. Published as an
Artifact it writes every reply live through Claude on the viewer's own account,
including the repeat guard rewriting a line that came back too similar; opened
as a local file it falls back to the canned lines and says so.

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
| `spot_claim` | Someone near you says they were here first, that they're mining this vein, or politely asks you to move — the bot gives way instead of arguing, and the action carries `hint: "relocate"` so your macro can actually move |
| `hostile` | Genuine aggression from someone next to you — "get out of here you clown" — as opposed to a fair request |
| `mention` / `whisper` | Your name or short form appears, or someone whispers you |

The thresholds exist because the first version fired on every walk-by and was
unbearable. One person crossing your path is noise; three times in 45 seconds
is a person doing it on purpose. All of it is in `config.detect`.

After a trigger fires, the model still gets the final say on whether to speak —
it returns `respond: false` for arguments that aren't worth continuing.

## Never the same line twice

A bot gives itself away by repeating, not by being wrong. Four things guard
against it:

**Canned lines are off by default.** `llm.fallbackOnError` is `false`, so when
the API times out or errors the bot says *nothing*. A stock phrase is the exact
tell this thing exists to avoid, and a person distracted by a grind going quiet
for a minute is completely normal. The canned lines still exist for the offline
simulator — turn them on with `llm: { fallbackOnError: true }` if you want them,
knowing they repeat.

**The model is shown what it already said.** Every request carries the last 8
lines sent (`chat.avoidHistory`) with an instruction not to reuse, reword, or
reach for the same joke twice.

**Near-repeats are caught, not just exact ones.** `"move out of my path"` and
`"move out my path"` are different strings and the same message. `src/chat/similarity.js`
scores candidates against recent lines with a Dice coefficient over character
trigrams, with the addressee's name stripped out so two lines to the same player
stay comparable. Anything at or above `chat.similarityThreshold` (0.55) is a
repeat — rewordings score 0.6–0.9, genuinely different lines score under 0.3.

**A repeat gets one rewrite, then silence.** The rejected line goes back to the
model with "you just tried this, take a different angle, not a synonym swap". If
the second attempt is still too close, the bot says nothing rather than sound
like a script.

Note that `temperature` is not available on Claude Opus 5 — variety comes from
the context and the avoid-list rather than sampling noise, which is the more
reliable source anyway. Effort defaults to `medium`; `low` produces noticeably
more formulaic phrasing.

### Length, names, and one-word replies

Three habits that give a bot away faster than wrong wording:

**Long tidy sentences.** Nobody types those with a macro running and a ghost on
them. `chat.preferredLength` (40 chars) is what the model aims at;
`chat.maxLength` (100) is the wall, not the target.

**Saying their name every line.** "ghosting in mist dream", "lost count dream",
"about 40m dream" — four for four is unmistakably automated. The prompt now says
to mostly leave names out, and if the last two replies to someone both used
their short name, the next request explicitly tells the model to drop it.

**Answering a greeting with a paragraph.** "yo 3172" isn't a question. A mention
that's only your name plus a greeting is flagged `opener`, and the reply is one
or two characters — `?`, `yh?`, `what`, `wha`, `sup`. It doesn't volunteer what
it's doing until asked.

**Answering filler with content.** "mb g", "cool cool", "aight bro" are
acknowledgements — the conversation is closing, not continuing. A message made
entirely of filler words is flagged `smalltalk` and gets a token back (`all g`,
`np`, `cool`) or nothing at all. The prompt says outright that silence is a
normal reply here and often the better one, because re-stating what you're doing
to someone who just said "my bad" is pure robot.

```
Dream: Yo 3172                    ->  ?
Dream: yo 3172 what you upto      ->  just grinding ghosts
Dream: Mb G                       ->  all g
Dream: cool cool                  ->  (nothing)
```

### Slang

`src/persona/slang.js` carries the vernacular, and it does two jobs. **Reading**:
"u got any mf?" is a question about Magic Find, and a reply that misses that is
worse than no reply at all. **Writing**: a player who types in full words while
everyone around them writes "bz" and "ngl" reads as an outsider, which is
halfway to reading as a bot.

Roughly 30 pieces of general chat shorthand (mb, np, ngl, fr, tbh, ikr, wyd,
wsg, ong, bet, no cap, sus, lowkey, mid, cracked, goated, W/L, rip, bruh, g,
twin) and 35 SkyBlock terms (ah, bz, bin, flip, lowball, k/m/b, npc, insta-buy,
mf, ms, hotm, powder, ch, div, scatha, the mist, sorrow/volta/plasma, cata,
f1–f7, m1–m7, carry, comp, sven/tara/eman/rev, t4/t5, aote, hype, juju, term,
gdrag, hpb, clean, 3/4, cc/cd/def/ehp/int/str, ironman, mayor, lfg).

The SkyBlock half is taken from the community abbreviation guides rather than
invented — a bot using a term wrong is more obvious than one not using it at
all. Add your own with `slang.extra`, as `["gexp — guild xp"]` or
`[["gexp", "guild xp"]]`, and switch the whole thing off with
`slang: { enabled: false }`.

It's also told not to overdo it: nobody uses five pieces of slang in one line,
and a bot trying to sound casual is more obvious than one being plain.

### Answering what was actually said

Two ways a bot gives itself away by over-reading a message.

**Taking a general remark personally.** "most people macro that tho" is a
comment about the economy, not a charge against you — but it contains the word
"macro", and the detector used to treat any macro talk from someone nearby as an
accusation. Replying "im not macroing" to that is a non-sequitur *and* a
confession nobody asked for. `accusationTarget()` now looks at which subject
sits nearest the accusing word: "most people macro that" and "that guy is
hacking" are about someone else; "u macro that", "you macroing?" and "im
reporting you for macroing" are about you.

**Raising something nobody mentioned.** It once tacked "move pls" onto a reply
when nobody was anywhere near the path. The prompt now says to answer the
message in front of it and nothing else, and the situation block states plainly
whether anyone is actually in the way — `nobody is in your way right now — do
not ask anyone to move` — so there's no ambiguity to fill in.

### Asking instead of guessing

If it can't tell what someone meant — unfamiliar slang, a typo, a line with no
context — it says so in the shortest way: `uh what?`, `what?`, `wdym`, `eh?`.
Then the other person explains and it answers properly on the next line.

That's what a person does. Guessing is what a bot does, and guessing *wrong* is
far more obvious than asking. The prompt also forbids the two bluffing moves
that usually replace a real answer: answering a question nobody asked, and
producing a vague line that could follow anything.

### Short slang is not noise

`wsg`, `wyd`, `hbu`, `idk`, `gg`, `ty` are three characters and every one of
them wants a reply. A length gate used to drop them all, so "wsg" got silence.
Now they route by meaning:

| | |
|---|---|
| `wsg`, `wsp`, `wagwan` | a greeting — `opener`, answered with `sup` / `nm u` |
| `wyd`, `hbu`, `hru` | real questions — answered properly |
| `gg`, `k`, `mb` | filler — a token back, or nothing |

### Two words means two words

Some replies have to be tiny — a bare call-out, an acknowledgement. Asking the
model nicely wasn't enough: told to answer "mb g" in two words it produced
"all g dream, ty". So for `opener` and `smalltalk` triggers the limit is
enforced after the fact — the addressee's name is stripped and the line is cut
to `chat.terseWords` (2). Normal replies are untouched.

```
model wrote: "all g dream, ty"                          ->  all g
model wrote: "lol all good bro, just farming ghosts"    ->  lol all
model wrote: "been grinding since 4am dream" (normal)   ->  unchanged
```

### Typing like a person

Delay is modelled, not a flat random pause: a beat to read and decide
(`chat.thinkMs`, 400–1400ms) plus time proportional to what gets typed
(`chat.msPerChar`, 45–90ms), capped at `chat.maxDelayMs`. A flat random delay
gives every message the same rhythm regardless of length, which reads as
machinery the moment anyone watches for it. A one-word reply lands in under a
second; a full sentence takes four or five.

## Finishing a conversation

The rate limits exist to stop the bot nagging someone. A conversation is the
opposite of nagging, and the first version couldn't tell them apart — it
answered the first message and then went mute for a minute, which is worse than
never answering.

Two things fix that.

**A line doesn't have to name you to be for you.** Nobody keeps saying your
name once you're already talking. Once the bot has answered someone, their next
messages count as addressed to it — as long as they're still nearby and inside
`limits.conversation.windowMs` (2 minutes). So "oh nice how long you been
grinding" gets an answer, where before it matched nothing at all.

**A reply to someone gets conversation rules, not nag rules.** When the trigger
came from something they said, the per-player and per-kind cooldowns don't
apply and the gap between replies drops to `conversation.cooldownMs` (2.5s).
When the bot is the one speaking up — a macro-check callout nobody asked for —
the full cooldowns still hold.

Turn budgets are what bound it instead, and they differ by what kind of
exchange it is:

| | Turns |
|---|---|
| Chatting (`mention`, `whisper`, `spot_claim`) | `conversation.maxTurns` — 12 |
| Arguing (`accusation`, `hostile`, `macro_check`) | `conversation.maxArgumentTurns` — 3 |

An argument is cut short on purpose. A real person stops defending themselves
to someone calling them a cheater and goes back to what they were doing; trading
shots until one side gives up is exactly what a bot would do. After three the
log says "said my piece — letting it go".

Two rules keep that budget from misfiring:

**Only arguing spends the argument budget.** The turn count for an argument
counts argument replies, not every reply in the run. A friendly chat that turns
sour does not arrive at the accusation with the budget already gone.

**A typed macro check is never suppressed.** "say something if ur real" is
testing for exactly one thing — silence — so a bot that has talked itself into a
rate limit fails it perfectly. Nothing except the mute guards and the repeat
guard can stop that reply. (A macro-check callout *we* raise because someone is
stood in the path is different: nobody is waiting on it, so it paces normally.)

`maxPerMinute` moved from 4 to 8 to leave room for a real back-and-forth. That
is still well inside normal human chat volume.

## What stops it speaking

Auto-chat is the fastest way to get muted, so the limiter is deliberately
strict (`src/chat/policy.js`):

- 8s between unprompted messages (2.5s mid-conversation), 8/minute, 30/hour
- 60s before speaking to the same player again *unprompted* (a reply to them is
  governed by the conversation rules above, not this)
- never more than 2 unprompted messages to the same person back-to-back
- messages too close to a recent one are dropped (see above)
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
non-public channels. `delayMs` is the modelled typing pause; honour it.

`hint` is non-null when the reply promised something. Today the only value is
`"relocate"`, set when the bot has just told someone it will move off their
spot — saying "mb ill move" and then standing there is worse than not replying
at all, so act on it if your macro can.

## Using it as a library

```js
import { createChatAI } from './src/index.js';

const ai = createChatAI({ username: 'Notch', persona: 'snarky' });
ai.on('say', (action) => yourClient.chat(action.command));
ai.on('skip', ({ reason }) => console.log('stayed quiet:', reason));

await ai.handle({ type: 'chat', raw: '[MVP+] Griefer: ur macroing' });
```

Without `ANTHROPIC_API_KEY` it falls back to per-persona canned lines so the
detection and rate limiting stay testable offline — but those lines repeat, so
the fallback is off for API errors by default. Set `llm: { fallbackOnError: true }`
if you would rather have a stock line than silence.

## Layout

```
src/chat/parse.js       Hypixel chat lines -> {sender, content, channel}
src/chat/shortname.js   xX_DreamSlayer_Xx -> Dream; fuzzy mention matching
src/chat/sanitize.js    strip slashes/links, soften profanity, fit the chat box
src/chat/similarity.js  trigram near-duplicate detection, so it never repeats itself
src/persona/slang.js    chat and SkyBlock vernacular, for reading and writing
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

100 tests over name shortening, chat parsing, detector thresholds, the macro-check
escalation ladder, near-duplicate detection, the rewrite-on-repeat path, the
typing model, conversation continuity and turn budgets, one-word openers, filler replies, name fatigue, the rate limiter, sanitisation, the bridge, and the full
event→reply path with a mocked API client. No test hits the network.
