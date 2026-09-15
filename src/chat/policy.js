import { findRepeat } from './similarity.js';

/** Exchanges worth cutting short rather than seeing through. */
const ARGUMENT_KINDS = new Set(['accusation', 'hostile', 'macro_check']);

/**
 * Rate limiting and repeat suppression.
 *
 * Hypixel mutes accounts that spam, drops duplicate messages, and this bot is
 * fast enough to trip both. Everything here exists to keep it under those
 * limits and to stop it bickering with one player forever.
 */
export class Policy {
  constructor(config, { now = () => Date.now() } = {}) {
    this.config = config;
    this.now = now;
    this.sent = []; // {ts, message, subject, kind}
    this.mutedUntil = 0;
  }

  /** Called when Hypixel tells us we're muted; silences the bot for a while. */
  silence(ms = 15 * 60 * 1000) {
    this.mutedUntil = this.now() + ms;
  }

  /**
   * @returns {{allowed: boolean, reason?: string}}
   */
  check(trigger, message = null) {
    const ts = this.now();
    const L = this.config.limits;

    if (ts < this.mutedUntil) {
      return { allowed: false, reason: 'muted or recently warned by the server' };
    }
    if (!this.config.chat.speakIn.includes(trigger.channel) && trigger.channel !== 'whisper') {
      return { allowed: false, reason: `channel "${trigger.channel}" is not enabled` };
    }

    // Someone talking to us is not someone we are nagging. A conversation gets
    // answered at conversation pace and is bounded by its turn count, not by
    // the cooldowns that exist to stop us pestering a player unprompted.
    const C = L.conversation;
    const conversing = Boolean(trigger.conversational);
    const arguing = ARGUMENT_KINDS.has(trigger.kind);

    // A conversation runs at its own pace. A callout we raise because someone
    // is stood in our path remains subject to the normal global cooldown.
    const last = this.sent[this.sent.length - 1];
    const baseGap = conversing ? C.cooldownMs : L.globalCooldownMs;
    const gap = baseGap;
    if (last && ts - last.ts < gap) {
      return {
        allowed: false,
        reason: conversing ? 'still finishing the last reply' : 'global cooldown',
      };
    }

    const minute = this.sent.filter((s) => ts - s.ts <= 60000).length;
    if (minute >= L.maxPerMinute) return { allowed: false, reason: 'per-minute limit' };

    const hour = this.sent.filter((s) => ts - s.ts <= 3600000).length;
    if (hour >= L.maxPerHour) return { allowed: false, reason: 'per-hour limit' };

    // An escalating reply continues an exchange we already started. The
    // per-player and per-kind cooldowns exist to stop the bot nagging the same
    // person about a new thing, so they step aside while the player is actively
    // talking to us.
    //
    // What still bounds it: the global cooldown between messages, the per
    // minute and per-hour caps, and the argument cap below — after three
    // hostile checks or accusations, the player gets silence.
    const escalating = Boolean(trigger.escalates);
    const relaxed = escalating || conversing;
    const kindCooldown = relaxed ? 0 : L.perKindCooldownMs;
    const playerCooldown = relaxed ? 0 : L.perPlayerCooldownMs;

    // How many replies in a row this player may have. A friendly exchange runs
    // as long as they keep talking; an argument gets three, because a real
    // person stops defending themselves and goes back to what they were doing.
    let consecutiveCap = L.maxConsecutivePerPlayer + (escalating ? 1 : 0);
    if (conversing) consecutiveCap = arguing ? C.maxArgumentTurns : C.maxTurns;

    const sameKind = [...this.sent].reverse().find((s) => s.kind === trigger.kind);
    if (sameKind && ts - sameKind.ts < kindCooldown) {
      return { allowed: false, reason: `cooldown for ${trigger.kind}` };
    }

    if (trigger.subject) {
      const samePlayer = [...this.sent].reverse().find((s) => s.subject === trigger.subject);
      if (samePlayer && ts - samePlayer.ts < playerCooldown) {
        return { allowed: false, reason: `cooldown for ${trigger.subject}` };
      }

      // The run of replies to this player, and how much of it was arguing.
      // A friendly chat must not spend the argument budget: three pleasant
      // answers followed by silence the moment they accuse you is backwards.
      const run = [];
      for (let i = this.sent.length - 1; i >= 0; i -= 1) {
        if (this.sent[i].subject !== trigger.subject) break;
        run.push(this.sent[i]);
      }
      const streak = arguing && conversing
        ? run.filter((entry) => ARGUMENT_KINDS.has(entry.kind)).length
        : run.length;

      if (streak >= consecutiveCap) {
        return {
          allowed: false,
          reason: arguing && conversing
            ? `said my piece to ${trigger.subject} ${streak} times — letting it go`
            : `already replied to ${trigger.subject} ${streak}x in a row`,
        };
      }
    }

    if (message) {
      const repeat = findRepeat(message, this.recent(L.dedupeWindowMs, ts).slice(0, this.config.chat.repeatHistory), {
        threshold: this.config.chat.similarityThreshold,
        names: [trigger.subject].filter(Boolean),
      });
      if (repeat.repeat) {
        return {
          allowed: false,
          reason: `too close to something I already said ("${repeat.match}")`,
          repeat,
        };
      }
    }

    return { allowed: true };
  }

  /** Lines sent inside `windowMs`, newest first. */
  recent(windowMs = this.config.limits.dedupeWindowMs, ts = this.now()) {
    return this.sent
      .filter((s) => ts - s.ts <= windowMs)
      .map((s) => s.message)
      .reverse();
  }

  record(trigger, message) {
    const ts = this.now();
    this.sent.push({ ts, message, subject: trigger.subject, kind: trigger.kind });
    // Keep an hour of history; nothing looks further back than that.
    this.sent = this.sent.filter((s) => ts - s.ts <= 3600000);
  }
}
