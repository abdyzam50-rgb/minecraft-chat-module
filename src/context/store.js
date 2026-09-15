/**
 * Rolling snapshot of what is happening around the player.
 *
 * Everything the detectors and the prompt builder need lives here: recent chat,
 * who is nearby, what the pathfinder is doing, and a short history of
 * incidents (someone blocking us, someone accusing us) per player.
 */

const CHAT_HISTORY = 40;
const INCIDENT_HISTORY = 12;

export class ContextStore {
  constructor({ now = () => Date.now(), random } = {}) {
    this.now = now;
    this.random = random ?? Math.random;

    /** @type {{ts:number, sender:string|null, content:string, channel:string, system:boolean, raw:string}[]} */
    this.chat = [];

    /** @type {Map<string, {name:string, lastSeen:number, distance:number|null, blocks:number[], accusations:number[], lastReplyTo:number|null}>} */
    this.players = new Map();

    this.self = {
      username: '',
      server: null,
      area: null,
      activity: null,
      health: null,
    };

    this.pathfinder = {
      active: false,
      state: 'idle', // idle | running | blocked | stuck | stopped
      target: null,
      lastStateChange: 0,
      /** Set while something is physically in our way. */
      blockedBy: null,
      blockedSince: null,
      stopCount: 0,
    };

    /** @type {{ts:number, kind:string, subject:string|null, detail:string}[]} */
    this.incidents = [];

    /** Last thing we said, so we can tell whether a reply is aimed at us. */
    this.lastOutgoing = null;

    /**
     * Who we are currently talking with.
     * @type {Map<string, {since:number, lastTurn:number, turns:number}>}
     */
    this.conversations = new Map();
  }

  player(name) {
    if (!this.players.has(name)) {
      this.players.set(name, {
        name,
        lastSeen: 0,
        distance: null,
        blocks: [],
        /** Times they have TYPED a macro check at us, as opposed to standing there. */
        checks: [],
        accusations: [],
        lastReplyTo: null,
        /** Assigned on their first block — see patienceFor(). */
        patience: null,
        rage: null,
        /** Highest anger level we have actually sent to this player. */
        lastAnger: 0,
      });
    }
    return this.players.get(name);
  }

  addChat(message) {
    const entry = { ts: message.ts ?? this.now(), ...message };
    this.chat.push(entry);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    if (entry.sender) {
      const p = this.player(entry.sender);
      p.lastSeen = entry.ts;
    }
    return entry;
  }

  updateSelf(patch = {}) {
    Object.assign(this.self, patch);
  }

  /** @param {{name:string, distance:number|null}[]} list */
  updateNearby(list = [], ts = this.now()) {
    for (const entry of list) {
      if (!entry?.name) continue;
      const p = this.player(entry.name);
      p.distance = entry.distance ?? null;
      p.lastSeen = ts;
    }
  }

  updatePathfinder(patch = {}, ts = this.now()) {
    const previous = this.pathfinder.state;
    Object.assign(this.pathfinder, patch);
    if (patch.state && patch.state !== previous) {
      this.pathfinder.lastStateChange = ts;
      if (patch.state === 'stopped') this.pathfinder.stopCount += 1;
    }
    if (patch.blockedBy) {
      if (!this.pathfinder.blockedSince) this.pathfinder.blockedSince = ts;
      this.recordBlock(patch.blockedBy, ts);
    } else if (patch.blockedBy === null) {
      this.pathfinder.blockedSince = null;
    }
  }

  /**
   * How many blocks we'll take from this player before the tone changes.
   *
   * Randomised per player, and per session: a bot that always snaps on the
   * third block is itself a detectable pattern, and a macro check is exactly
   * the moment someone is watching for one.
   *
   * @returns {{patience:number, rage:number}} block counts for anger 2 and 3
   */
  patienceFor(name, config) {
    const p = this.player(name);
    if (p.patience === null) {
      const [pMin, pMax] = config.patience;
      const [rMin, rMax] = config.rage;
      // Always strictly above the threshold, so the calm first warning is
      // never skipped no matter how the roll lands.
      p.patience = Math.max(config.threshold + 1, pMin + Math.floor(this.random() * (pMax - pMin + 1)));
      p.rage = p.patience + rMin + Math.floor(this.random() * (rMax - rMin + 1));
    }
    return { patience: p.patience, rage: p.rage };
  }

  recordBlock(name, ts = this.now()) {
    const p = this.player(name);
    p.blocks.push(ts);
    p.lastSeen = ts;
    if (p.blocks.length > INCIDENT_HISTORY) p.blocks.shift();
  }

  /** Remember that a rung of the escalation has been spent on this player. */
  noteAnger(name, anger) {
    const p = this.player(name);
    if (anger > p.lastAnger) p.lastAnger = anger;
  }

  /**
   * They typed a macro check. Standing in someone's path can be an accident
   * three times over; typing "say something if ur real" cannot. Each one is a
   * deliberate act, so these count on their own and much harder than blocks.
   */
  recordCheck(name, ts = this.now()) {
    const p = this.player(name);
    p.checks.push(ts);
    p.lastSeen = ts;
    if (p.checks.length > INCIDENT_HISTORY) p.checks.shift();
  }

  checksWithin(name, windowMs, ts = this.now()) {
    const p = this.players.get(name);
    if (!p) return 0;
    return p.checks.filter((t) => ts - t <= windowMs).length;
  }

  recordAccusation(name, ts = this.now()) {
    const p = this.player(name);
    p.accusations.push(ts);
    if (p.accusations.length > INCIDENT_HISTORY) p.accusations.shift();
  }

  addIncident(kind, subject, detail, ts = this.now()) {
    this.incidents.push({ ts, kind, subject, detail });
    if (this.incidents.length > INCIDENT_HISTORY) this.incidents.shift();
  }

  /** We just answered this player — we are now in a conversation with them. */
  openConversation(name, ts = this.now()) {
    const existing = this.conversations.get(name);
    if (existing) {
      existing.lastTurn = ts;
      existing.turns += 1;
      return existing;
    }
    const fresh = { since: ts, lastTurn: ts, turns: 1 };
    this.conversations.set(name, fresh);
    return fresh;
  }

  /**
   * Are we mid-conversation with them? Once someone is talking to you they
   * stop using your name, so this is what lets "how long you been grinding"
   * count as addressed to us.
   */
  inConversation(name, windowMs, ts = this.now()) {
    const open = this.conversations.get(name);
    return Boolean(open && ts - open.lastTurn <= windowMs);
  }

  /** How many times we have answered them in this exchange. */
  conversationTurns(name) {
    return this.conversations.get(name)?.turns ?? 0;
  }

  recordOutgoing(message, ts = this.now()) {
    this.lastOutgoing = { ts, message };
  }

  /** Blocks by `name` inside the last `windowMs`. */
  blocksWithin(name, windowMs, ts = this.now()) {
    const p = this.players.get(name);
    if (!p) return 0;
    return p.blocks.filter((t) => ts - t <= windowMs).length;
  }

  isNearby(name, radius, ts = this.now()) {
    const p = this.players.get(name);
    if (!p) return false;
    const seenRecently = ts - p.lastSeen <= 30000;
    if (p.distance === null) return seenRecently;
    return seenRecently && p.distance <= radius;
  }

  recentChat(count = 10) {
    return this.chat.slice(-count);
  }
}
