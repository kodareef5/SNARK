// Each vital is a value at a base tick, a rate per tick and a maximum. Nothing is stepped, and the tick one runs out is known in
// advance, so it can be a deadline. The server sends new rates when they change, and the client's bars then move on their own.

export const V_HEALTH = 0;
export const V_FOOD = 1;
export const V_WATER = 2;
export const V_OXYGEN = 3;
/** Torpor runs the other way from the rest. 0 is well, and at its maximum the body is unconscious. */
export const V_TORPOR = 4;
export const V_COUNT = 5;
export const VITAL_NAMES = ["health", "food", "water", "oxygen", "torpor"] as const;

export class Vitals {
  /** Values at `tick`, in millionths of a point. */
  readonly value = new Float64Array(V_COUNT);
  /** Per tick, in whole millionths of a point. */
  readonly rate = new Float64Array(V_COUNT);
  readonly max = new Float64Array(V_COUNT);
  tick = 0;
  /** Counts every change, for sending only what a client lacks. */
  version = 0;

  at(i: number, tick: number): number {
    const v = this.value[i]! + this.rate[i]! * (tick - this.tick);
    const max = this.max[i]!;
    return v < 0 ? 0 : v > max ? max : v;
  }

  rebase(tick: number): void {
    for (let i = 0; i < V_COUNT; i++) this.value[i] = this.at(i, tick);
    this.tick = tick;
    this.version++;
  }

  /** These three return the first tick the vital reaches the mark at its current rate, or Infinity. */
  fullTick(i: number): number {
    const short = this.max[i]! - this.value[i]!;
    const r = this.rate[i]!;
    if (short <= 0) return this.tick;
    if (r <= 0) return Infinity;
    return this.tick + Math.ceil(short / r);
  }

  /** `level` is in millionths of a point. */
  riseTick(i: number, level: number): number {
    const short = level - this.value[i]!;
    const r = this.rate[i]!;
    if (short <= 0) return this.tick;
    if (r <= 0) return Infinity;
    return this.tick + Math.ceil(short / r);
  }

  zeroTick(i: number): number {
    const v = this.value[i]!;
    const r = this.rate[i]!;
    if (v <= 0) return this.tick;
    if (r >= 0) return Infinity;
    return this.tick + Math.ceil(v / -r);
  }
}
