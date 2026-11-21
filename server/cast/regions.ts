// How lively each part of the map should be. A region's heat is where players spend their time: it rises in minutes
// while they are there and fades over hours after, so a well-played neighbourhood stays busy and a new one wakes as
// players arrive. Each region paces itself as Left 4 Dead's director does: relax, build, peak, fade, round again, with
// the lengths drawn at random and spikiness stretching the quiet and sharpening the peaks, so players see something
// now and then rather than the same hum everywhere.

import type { Pace, Region } from "../../shared/cast/state.ts";
import { Rng } from "../../shared/rng.ts";

/** Heat's half-lives in seconds: rising while players are in a region, and fading once they have gone. */
const RISE_S = 600, FADE_S = 6 * 3600;
/** Seconds each pace lasts, as [least, most] at spikiness 0; spikiness lengthens relax and shortens the rest. */
const PACE_S: Record<Pace, [number, number]> = { relax: [240, 480], build: [90, 180], peak: [90, 240], fade: [60, 150] };
const NEXT: Record<Pace, Pace> = { relax: "build", build: "peak", peak: "fade", fade: "relax" };
/** How many stories a player sees at once in each pace, before activity scales it. */
export const PACE_STORIES: Record<Pace, number> = { relax: 2, build: 3, peak: 5, fade: 2 };

export class Regions {
  readonly byIndex = new Map<number, Region>();
  private readonly rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  get(i: number, tick: number): Region {
    let r = this.byIndex.get(i);
    if (!r) {
      r = { heat: 0, players: 0, pace: "relax", next: tick + Math.floor(this.rng.range(0, 1) * 600), extras: 0, cooldowns: {} };
      this.byIndex.set(i, r);
    }
    return r;
  }

  /** Counts the players in each region and moves heat toward it over `dt` seconds; regions with neither heat nor
   * players are let go. */
  warm(counts: ReadonlyMap<number, number>, dt: number, tick: number): void {
    for (const [i, n] of counts) this.get(i, tick).players = n;
    for (const [i, r] of this.byIndex) {
      const n = counts.get(i) ?? 0;
      r.players = n;
      const half = n > r.heat ? RISE_S : FADE_S;
      r.heat += (n - r.heat) * (1 - Math.pow(0.5, dt / half));
      if (r.heat < 0.001 && n === 0 && !Object.keys(r.cooldowns).length) this.byIndex.delete(i);
    }
  }

  /** Steps each region's pace whose time has come. `rate` is ticks a second. */
  pace(tick: number, rate: number, spikiness: number): void {
    for (const r of this.byIndex.values()) {
      if (tick < r.next) continue;
      r.pace = NEXT[r.pace];
      const [lo, hi] = PACE_S[r.pace];
      const stretch = r.pace === "relax" ? 1 + spikiness * 1.5 : 1 - spikiness * 0.4;
      r.next = tick + Math.round(this.rng.range(lo, hi) * stretch * rate);
    }
  }

  /** Clears cooldowns that have run out. */
  tidy(tick: number): void {
    for (const r of this.byIndex.values()) for (const k of Object.keys(r.cooldowns)) if (r.cooldowns[k]! <= tick) delete r.cooldowns[k];
  }
}
