import { EventEmitter } from 'node:events';
import { resolveConfig } from './config.js';
import { ContextStore } from './context/store.js';
import { parseChatLine } from './chat/parse.js';
import { sanitize, formatForChannel } from './chat/sanitize.js';
import { Policy } from './chat/policy.js';
import { ClaudeResponder } from './llm/claude.js';
import { FallbackResponder } from './llm/fallback.js';
import { detectFromChat, detectPathfinderBlock, detectMuted } from './detect/index.js';
import { getPersona } from './persona/personas.js';

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
    const { client, random, ...configOptions } = options;
    this.config = resolveConfig(configOptions);
    this.store = new ContextStore({ random });
    this.store.updateSelf({ username: this.config.username, ...this.config.self });
    this.policy = new Policy(this.config);
    this.claude = new ClaudeResponder(this.config, { client });
    this.fallback = new FallbackResponder(this.config);
    /** Queue of messages waiting to be picked up by a polling client. */
    this.outbox = [];
    this.pending = null;
  }

  get usingApi() {
    return Boolean(this.claude.client);
  }

  /**
   * Feed one event from the game client.
   * @param {{type:string}} event
   * @returns {Promise<object|null>} the action produced, if any
   */
  async handle(event) {
    const ts = event.ts ?? Date.now();
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
  async respond(trigger, ts = Date.now()) {
    this.emit('trigger', { trigger });

    const gate = this.policy.check(trigger);
    if (!gate.allowed) {
      this.emit('skip', { trigger, reason: gate.reason });
      return null;
    }

    let decision;
    try {
      decision = this.usingApi
        ? await this.claude.decide(this.store, trigger, ts)
        : this.fallback.decide(this.store, trigger);
    } catch (error) {
      this.emit('error', error);
      if (!this.config.llm.fallbackOnError) return null;
      decision = this.fallback.decide(this.store, trigger);
    }

    if (!decision.respond || !decision.message) {
      this.emit('skip', { trigger, reason: decision.reason || 'chose to stay quiet' });
      return null;
    }

    const shout = (trigger.anger ?? 0) >= 3 && getPersona(this.config.persona).shouts;
    const clean = sanitize(decision.message, this.config, { shout });
    if (!clean.ok) {
      this.emit('skip', { trigger, reason: `blocked: ${clean.reason}` });
      return null;
    }

    const final = this.policy.check(trigger, clean.message);
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
      reason: decision.reason,
      source: decision.source,
      delayMs: randomDelay(this.config.chat.typingDelayMs),
      ts: Date.now(),
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

  /** Drain queued actions (used by the HTTP bridge). */
  drain() {
    const actions = this.outbox;
    this.outbox = [];
    return actions;
  }
}

function randomDelay([min, max]) {
  return Math.round(min + Math.random() * Math.max(0, max - min));
}

export function createChatAI(options) {
  return new ChatAI(options);
}
