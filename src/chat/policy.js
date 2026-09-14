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

    const last = this.sent[this.sent.length - 1];
    if (last && ts - last.ts < L.globalCooldownMs) {
      return { allowed: false, reason: 'global cooldown' };
    }

    const minute = this.sent.filter((s) => ts - s.ts <= 60000).length;
    if (minute >= L.maxPerMinute) return { allowed: false, reason: 'per-minute limit' };

    const hour = this.sent.filter((s) => ts - s.ts <= 3600000).length;
    if (hour >= L.maxPerHour) return { allowed: false, reason: 'per-hour limit' };

    const sameKind = [...this.sent].reverse().find((s) => s.kind === trigger.kind);
    if (sameKind && ts - sameKind.ts < L.perKindCooldownMs) {
      return { allowed: false, reason: `cooldown for ${trigger.kind}` };
    }

    if (trigger.subject) {
      const samePlayer = [...this.sent].reverse().find((s) => s.subject === trigger.subject);
      if (samePlayer && ts - samePlayer.ts < L.perPlayerCooldownMs) {
        return { allowed: false, reason: `cooldown for ${trigger.subject}` };
      }

      let streak = 0;
      for (let i = this.sent.length - 1; i >= 0; i -= 1) {
        if (this.sent[i].subject !== trigger.subject) break;
        streak += 1;
      }
      if (streak >= L.maxConsecutivePerPlayer) {
        return { allowed: false, reason: `already replied to ${trigger.subject} ${streak}x in a row` };
      }
    }

    if (message) {
      const duplicate = this.sent.find(
        (s) => s.message === message && ts - s.ts <= L.dedupeWindowMs,
      );
      if (duplicate) return { allowed: false, reason: 'duplicate message' };
    }

    return { allowed: true };
  }

  record(trigger, message) {
    const ts = this.now();
    this.sent.push({ ts, message, subject: trigger.subject, kind: trigger.kind });
    // Keep an hour of history; nothing looks further back than that.
    this.sent = this.sent.filter((s) => ts - s.ts <= 3600000);
  }
}
