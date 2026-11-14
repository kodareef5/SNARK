import { TICK_RATE } from "../shared/coords.ts";

/** Wrong guesses allowed before the first wait. */
const FREE = 3;
/** The first wait, in ticks. Each further wrong guess doubles it, up to an hour. */
const WAIT = 30 * TICK_RATE;
const LONGEST = 3600 * TICK_RATE;
/** Keys remembered. Past this the oldest half is forgotten. */
const MOST = 4096;

/**
 * Counts wrong passwords by who sent them, across connections. A count kept on the connection starts again at every
 * reconnect, which made a four-digit password a matter of minutes.
 */
export class Guesses {
  private readonly by = new Map<string, { wrong: number; until: number }>();

  /** Ticks `who` must still wait before a guess is judged, or 0. */
  wait(who: string, tick: number): number {
    const e = this.by.get(who);
    return e && e.until > tick ? e.until - tick : 0;
  }

  wrong(who: string, tick: number): void {
    let e = this.by.get(who);
    if (!e) {
      if (this.by.size >= MOST) {
        let drop = MOST / 2;
        for (const key of this.by.keys()) {
          if (drop-- <= 0) break;
          this.by.delete(key);
        }
      }
      this.by.set(who, (e = { wrong: 0, until: 0 }));
    }
    e.wrong++;
    if (e.wrong >= FREE) e.until = tick + Math.min(LONGEST, WAIT * 2 ** Math.min(20, e.wrong - FREE));
  }

  right(who: string): void {
    this.by.delete(who);
  }
}
