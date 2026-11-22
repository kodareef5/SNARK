// The physics lane: physics is never slowed, thinned or cut short once it has begun, so it is given its time first and
// the work that can wait (path searches, the spawner's fills) is fitted round it. Each tick the lane keeps how long the
// physics took so far and the most it took lately; work that can wait asks `room()` how many milliseconds the tick still
// has once that physics is allowed for, and stops or comes back next tick when there are none. A physics system is
// bounded by what it admits (a cap on what it starts), never by the clock: the lane only
// ever shortens the work that can wait.

import { TICK_RATE } from "../shared/coords.ts";

/** Ms of a tick everything is fitted into, leaving the rest of the 33.3 for the collector and the snapshots. */
export const LANE_TARGET_MS = 20;
/** Ms always kept for physics, however little it took lately: a brawl that starts this tick has its time. */
export const LANE_RESERVE_MS = 6;
/** How fast the remembered most a tick's physics took falls back, a share a tick: about two seconds to halve. */
const PEAK_FALL = 1 - 1 / (2 * TICK_RATE);

export class Lane {
  /** Ms of the tick fitted into; a test sets it lower to see the work that can wait give way. */
  target = LANE_TARGET_MS;
  reserve = LANE_RESERVE_MS;
  /** Ms the physics took this tick so far, and in the last tick. */
  physicsMs = 0;
  lastMs = 0;
  /** The most a tick's physics took lately, falling back slowly. */
  peak = 0;
  /** Ticks in which some work that can wait gave way, and the most physics took in any tick since the start. */
  yielded = 0;
  worst = 0;
  private began = 0;
  private entered = -1;
  private yieldedNow = false;
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /** Starts a tick. */
  begin(): void {
    this.lastMs = this.physicsMs;
    if (this.physicsMs > this.worst) this.worst = this.physicsMs;
    this.peak = Math.max(this.physicsMs, this.peak * PEAK_FALL);
    this.physicsMs = 0;
    this.entered = -1;
    this.yieldedNow = false;
    this.began = this.now();
  }

  /** Physics begins: its time is the lane's until `leave`. Nested calls count once. */
  enter(): void {
    if (this.entered < 0) this.entered = this.now();
  }

  leave(): void {
    if (this.entered < 0) return;
    this.physicsMs += this.now() - this.entered;
    this.entered = -1;
  }

  /**
   * Ms the work that can wait may still spend this tick: the target, less what the tick has spent, less what physics
   * still may take (the more of its reserve and its recent most, less what it has had).
   */
  room(): number {
    const owed = Math.max(this.reserve, this.peak) - this.physicsMs;
    return this.target - (this.now() - this.began) - (owed > 0 ? owed : 0);
  }

  /** Whether work that can wait may go on; a tick in which it may not is counted once. */
  may(): boolean {
    if (this.room() > 0) return true;
    if (!this.yieldedNow) {
      this.yieldedNow = true;
      this.yielded++;
    }
    return false;
  }
}
