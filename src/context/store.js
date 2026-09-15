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
    /** Mood, not a decision: {score, ts} decayed on read. See noteAnnoyance. */
    this.annoyance = { score: 0, ts: 0 };
    this.startedAt = this.now();

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
        /** When we last asked them "me?" after they fumbled our name. */
        askedWhoTs: null,
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

  /**
   * A player who keeps badgering us gets no more attention.
   *
   * Three is deliberately low: past that they are not asking anything, they
   * are poking. The anger ladder still completes first, because it runs on
   * blocks rather than on typed checks.
   */
  isPestering(name, windowMs = 300000, ts = this.now()) {
    const p = this.players.get(name);
    if (!p) return false;
    const checks = p.checks.filter((t) => ts - t <= windowMs).length;
    const accusations = p.accusations.filter((t) => ts - t <= windowMs).length;
    return checks >= 3 || accusations >= 3;
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

  /** We asked whether they meant us, and are waiting to hear. */
  noteAskedWho(name, ts = this.now()) {
    this.player(name).askedWhoTs = ts;
  }

  awaitingAnswer(name, windowMs, ts = this.now()) {
    const asked = this.players.get(name)?.askedWhoTs;
    return Boolean(asked && ts - asked <= windowMs);
  }

  /** They said it was not us. Drop the thread and stop assuming. */
  closeConversation(name) {
    this.conversations.delete(name);
    const p = this.players.get(name);
    if (p) p.askedWhoTs = null;
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

  /**
   * Add to the mood, after shedding whatever has faded since last time.
   *
   * Decay happens on read and on write rather than on a timer, so a session
   * that sits quiet for ten minutes comes back calm without anything having
   * to run in the background.
   */
  noteAnnoyance(points, config, ts = this.now()) {
    this.annoyance.score = this.annoyanceScore(config, ts) + points;
    this.annoyance.ts = ts;
    return this.annoyance.score;
  }

  /** The mood right now, with time already taken off it. */
  annoyanceScore(config, ts = this.now()) {
    const { decayPerMinute } = config.detect.annoyance;
    if (!this.annoyance.ts) return this.annoyance.score;
    const minutes = (ts - this.annoyance.ts) / 60000;
    return Math.max(0, this.annoyance.score - minutes * decayPerMinute);
  }

  /**
   * Which rung of the mood we are on: 0 is fine, the top is about to walk.
   * Levels are thresholds, so tuning them does not touch any other code.
   */
  annoyanceLevel(config, ts = this.now()) {
    const score = this.annoyanceScore(config, ts);
    const { levels } = config.detect.annoyance;
    let level = 0;
    levels.forEach((threshold, index) => {
      if (score >= threshold) level = index;
    });
    return level;
  }

  /** Has it gone past the point where a person would just change lobby? */
  hasHadEnough(config, ts = this.now()) {
    const { leaveAt, minUptimeMs } = config.detect.annoyance;
    if (!leaveAt) return false;
    // Not in the first minutes of a session: quitting instantly on one insult
    // is not a person losing patience, it is a tantrum.
    if (ts - this.startedAt < minUptimeMs) return false;
    return this.annoyanceScore(config, ts) >= leaveAt;
  }
}
