// Commands go out no faster than a player's would, and each one's result is kept until it is asked for.

import type { ClientSession } from "../client/core/session.ts";
import type { BitWriter } from "../shared/net/codec.ts";
import { RESULT_BUSY, RESULT_DENIED, RESULT_ENEMY_NEAR, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_LIMIT, RESULT_LOCKED, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_PIN, RESULT_SHORT, RESULT_STALE, RESULT_TOO_HIGH, RESULT_WAIT } from "../shared/net/protocol.ts";

/** Commands a second, and as many at once. */
const PER_SECOND = 10;
/** A result nobody asked for within this long is forgotten. */
const KEPT_MS = 10000;

const WORDS: Record<number, string> = {
  [RESULT_BUSY]: "the server is busy, try again",
  [RESULT_INVALID]: "the server cannot do that",
  [RESULT_DENIED]: "denied",
  [RESULT_STALE]: "the slot no longer holds that",
  [RESULT_FULL]: "there is no room",
  [RESULT_FAR]: "too far, or out of sight",
  [RESULT_SHORT]: "not enough points, level or ingredients",
  [RESULT_OBSTRUCTED]: "something is in the way",
  [RESULT_NOT_YOURS]: "it is not yours",
  [RESULT_WAIT]: "too soon, wait",
  [RESULT_LOCKED]: "it is locked",
  [RESULT_PIN]: "it wants its PIN",
  [RESULT_NO_SNAP]: "it cannot go there: it must be set on something built, as a simple bed on a foundation",
  [RESULT_TOO_HIGH]: "too far above the ground",
  [RESULT_NO_SUPPORT]: "nothing would hold it up",
  [RESULT_ENEMY_NEAR]: "too near another tribe's foundation",
  [RESULT_LIMIT]: "as many structures stand around here as the server allows",
};

/** Why the server refused, in words. */
export function resultWords(code: number): string {
  return WORDS[code] ?? `refused (code ${code})`;
}

export class Commands {
  /** The last result that answered no command, which is how the use button's refusals arrive, and when it came. -1 for none. */
  news = -1;
  newsAt = 0;

  private readonly session: ClientSession;
  private readonly codes = new Map<number, { code: number; at: number }>();
  private tokens = PER_SECOND;
  private filledAt = 0;
  private now = 0;

  constructor(session: ClientSession) {
    this.session = session;
    session.onResult = (seq, code) => {
      if (seq === 0) {
        this.news = code;
        this.newsAt = this.now;
      } else this.codes.set(seq, { code, at: this.now });
    };
  }

  /** Call once a tick, with the time in milliseconds. */
  step(now: number): void {
    this.tokens = Math.min(PER_SECOND, this.tokens + ((now - this.filledAt) * PER_SECOND) / 1000);
    this.filledAt = now;
    this.now = now;
    for (const [seq, r] of this.codes) if (now - r.at > KEPT_MS) this.codes.delete(seq);
  }

  /** Counts one command against the pace. False if ten have gone in the last second, and then it must not be sent. */
  allow(): boolean {
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }

  /** Returns the command's sequence number, or 0 if it was not sent: the pace forbids it, or the session is not active. */
  send(op: number, args?: (w: BitWriter) => void): number {
    return this.allow() ? this.session.command(op, args) : 0;
  }

  /** The RESULT_ code command `seq` got, once, or -1 while it has none. */
  take(seq: number): number {
    const r = this.codes.get(seq);
    if (!r) return -1;
    this.codes.delete(seq);
    return r.code;
  }
}
