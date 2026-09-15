import { EventEmitter } from 'node:events';
import { resolveConfig } from './config.js';
import { ContextStore } from './context/store.js';
import { parseChatLine } from './chat/parse.js';
import { sanitize, formatForChannel } from './chat/sanitize.js';
import { Policy } from './chat/policy.js';
import { ClaudeResponder } from './llm/claude.js';
import { GeminiResponder } from './llm/gemini.js';
import { FallbackResponder } from './llm/fallback.js';
import { detectFromChat, detectPathfinderBlock, detectMuted } from './detect/index.js';
import { getPersona } from './persona/personas.js';
import { shortName } from './chat/shortname.js';

/**
 * The brain: feed it game events, it emits chat messages to send.
 *
 * Events:
 *   'say'     -> {message, command, channel, target, trigger, reason, source}
 *   'skip'    -> {trigger, reason}
 *   'trigger' -> {trigger}
 *   'error'   -> Error
 */
export class ChatAI extends EventEmitter {
  constructor(options = {}) {
    super();
    // `client` is an SDK instance, not config — keep it out of the merge.
    const { client, random, now, ...configOptions } = options;
    this.config = resolveConfig(configOptions);
    this.now = now ?? (() => Date.now());
    this.store = new ContextStore({ random, now: this.now });
    this.store.updateSelf({ username: this.config.username, ...this.config.self });
    this.policy = new Policy(this.config, { now: this.now });
    this.responder = this.config.llm.provider === 'gemini'
      ? new GeminiResponder(this.config)
      : new ClaudeResponder(this.config, { client });
    /** @deprecated kept for callers that reached in before providers existed */
    this.claude = this.responder;
    this.fallback = new FallbackResponder(this.config);
    /** Queue of messages waiting to be picked up by a polling client. */
    this.outbox = [];
    this.pending = null;
  }

  get usingApi() {
    return Boolean(this.responder.client);
  }

  /**
   * Feed one event from the game client.
   * @param {{type:string}} event
   * @returns {Promise<object|null>} the action produced, if any
   */
  async handle(event) {
    const ts = event.ts ?? this.now();
    switch (event.type) {
      case 'chat':
        return this.handleChat(event, ts);
      case 'pathfinder':
        return this.handlePathfinder(event, ts);
      case 'players':
        this.store.updateNearby(event.nearby ?? [], ts);
        return null;
      case 'self':
        this.store.updateSelf(event);
        return null;
      case 'sent':
        // Our own outgoing message, echoed back by the client.
        this.store.recordOutgoing(event.message, ts);
        return null;
      default:
        return null;
    }
  }

  async handleChat(event, ts) {
    const parsed = event.sender
      ? { sender: event.sender, content: event.content, channel: event.channel ?? 'all', raw: event.raw ?? '', system: false }
      : parseChatLine(event.raw ?? event.content ?? '');

    const message = this.store.addChat({ ...parsed, ts });

    if (detectMuted(message)) {
      this.policy.silence();
      this.emit('skip', { trigger: null, reason: 'server muted us; going quiet' });
      return null;
    }
    if (message.system || !message.sender) return null;
    if (message.sender === this.config.username) {
      this.store.recordOutgoing(message.content, ts);
      return null;
    }

    const trigger = detectFromChat(this.store, this.config, message, ts);
    if (!trigger) return null;
    if (trigger.kind === 'accusation') this.store.recordAccusation(message.sender, ts);
    return this.respond(trigger, ts);
  }

  async handlePathfinder(event, ts) {
    this.store.updatePathfinder(
      {
        state: event.state ?? this.store.pathfinder.state,
        target: event.target ?? this.store.pathfinder.target,
        active: event.state !== 'stopped' && event.state !== 'idle',
        blockedBy: event.blockedBy?.name ?? event.blockedBy ?? null,
      },
      ts,
    );
    if (event.blockedBy?.distance !== undefined && event.blockedBy?.name) {
      this.store.updateNearby([{ name: event.blockedBy.name, distance: event.blockedBy.distance }], ts);
    }

    const trigger = detectPathfinderBlock(this.store, this.config, ts);
    if (!trigger) return null;
    return this.respond(trigger, ts);
  }

  /** Decide, sanitize, rate-limit and queue a reply for one trigger. */
  async respond(trigger, ts = this.now()) {
    this.emit('trigger', { trigger });

    // They have started a conversation by speaking to us, whether or not we
    // end up answering. Opening it only on a successful send meant one dropped
    // reply — a rate limit, a timeout — made every follow-up that did not
    // repeat our name read as "not aimed at me", and the bot went dead.
    if (trigger.conversational && trigger.subject) {
      this.store.openConversation(trigger.subject, ts);
    }

    const gate = this.policy.check(trigger);
    if (!gate.allowed) {
      this.emit('skip', { trigger, reason: gate.reason });
      return null;
    }

    const avoid = this.policy.recent(this.config.limits.dedupeWindowMs)
      .slice(0, this.config.chat.avoidHistory);
    const nameFatigue = this.nameFatigue(trigger);
    const shout = (trigger.anger ?? 0) >= 3 && getPersona(this.config.persona).shouts;
    // A bare call-out or an acknowledgement gets two words, no name, always.
    const terse = (trigger.opener || trigger.smalltalk)
      ? {
          maxWords: this.config.chat.terseWords,
          stripNames: [trigger.subject, shortName(trigger.subject ?? '', { overrides: this.config.shortNames })],
        }
      : {};

    let decision = await this.think(trigger, ts, { avoid, nameFatigue });
    if (!decision) return null;

    if (!decision.respond || !decision.message) {
      this.emit('skip', { trigger, reason: decision.reason || 'chose to stay quiet' });
      return null;
    }

    let clean = sanitize(decision.message, this.config, { shout, ...terse });
    if (!clean.ok) {
      this.emit('skip', { trigger, reason: `blocked: ${clean.reason}` });
      return null;
    }

    let final = this.policy.check(trigger, clean.message);

    // A near-repeat is the single biggest tell. Give the model one more go with
    // the rejected line in front of it before giving up and saying nothing.
    if (!final.allowed && final.repeat && this.config.llm.retryOnRepeat && this.usingApi) {
      this.emit('skip', { trigger, reason: `${final.reason} — rewriting` });
      const retry = await this.think(trigger, ts, { avoid, nameFatigue, rejected: clean.message });
      if (retry?.respond && retry.message) {
        const retryClean = sanitize(retry.message, this.config, { shout, ...terse });
        if (retryClean.ok) {
          const retryCheck = this.policy.check(trigger, retryClean.message);
          if (retryCheck.allowed) {
            decision = retry;
            clean = retryClean;
            final = retryCheck;
          }
        }
      }
    }

    if (!final.allowed) {
      this.emit('skip', { trigger, reason: final.reason });
      return null;
    }

    const target = trigger.channel === 'whisper' ? trigger.subject : null;
    const action = {
      type: 'chat',
      message: clean.message,
      command: formatForChannel(clean.message, trigger.channel, target),
      channel: trigger.channel,
      target,
      trigger: trigger.kind,
      subject: trigger.subject,
      anger: trigger.anger ?? null,
      /** Something the client should do as well as type, or null. */
      hint: trigger.hint ?? null,
      reason: decision.reason,
      source: decision.source,
      delayMs: typingDelay(clean.message, this.config.chat),
      ts: this.now(),
    };

    if (this.config.dryRun) {
      this.emit('skip', { trigger, reason: `dry run: would have said "${clean.message}"` });
      return action;
    }

    this.policy.record(trigger, clean.message);
    this.store.recordOutgoing(clean.message);
    if (trigger.anger && trigger.subject) this.store.noteAnger(trigger.subject, trigger.anger);
    this.outbox.push(action);
    this.emit('say', action);
    return action;
  }

  /**
   * Have we used this player's name in the last couple of things we said to
   * them? Addressing someone by name every single line is the clearest tell
   * that a script is typing.
   */
  nameFatigue(trigger) {
    if (!trigger.subject) return false;
    const short = shortName(trigger.subject, { overrides: this.config.shortNames }).toLowerCase();
    if (!short) return false;
    const recent = this.policy.sent
      .filter((entry) => entry.subject === trigger.subject)
      .slice(-2);
    return recent.length >= 2 && recent.every((entry) => entry.message.toLowerCase().includes(short));
  }

  /**
   * One attempt at a reply. Returns null when nothing should be said.
   * @returns {Promise<{respond:boolean, message:string, reason:string, source:string}|null>}
   */
  async think(trigger, ts, options) {
    if (!this.usingApi) {
      return this.config.llm.fallbackOnError || !this.responder.available
        ? this.fallback.decide(this.store, trigger)
        : null;
    }
    try {
      return await this.responder.decide(this.store, trigger, ts, options);
    } catch (error) {
      this.emit('error', error);
      if (!this.config.llm.fallbackOnError) {
        this.emit('skip', { trigger, reason: `stayed quiet: ${error.message}` });
        return null;
      }
      return this.fallback.decide(this.store, trigger);
    }
  }

  /** Drain queued actions (used by the HTTP bridge). */
  drain() {
    const actions = this.outbox;
    this.outbox = [];
    return actions;
  }
}

/**
 * How long a person would take to send this: a beat to read the room and
 * decide, then time roughly proportional to what they typed. A flat random
 * delay gives every message the same rhythm no matter its length, which reads
 * as machinery the moment anyone watches for it.
 */
function typingDelay(message, chat) {
  const think = pick(chat.thinkMs);
  const perChar = pick(chat.msPerChar);
  return Math.min(chat.maxDelayMs, Math.round(think + message.length * perChar));
}

function pick([min, max]) {
  return min + Math.random() * Math.max(0, max - min);
}

export function createChatAI(options) {
  return new ChatAI(options);
}
