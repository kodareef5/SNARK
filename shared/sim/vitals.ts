// Vitals: health, food, water and oxygen as lazy quantities.
//
// Each is a value at a base tick, a rate per tick, and a maximum. Nothing is
// stepped: the value at any tick is computed, and the tick at which one runs
// out is known in advance, so it can be a deadline. The server changes rates
// when circumstances change (a head goes under water, food reaches zero) and
// sends the new numbers; the client's bars then move on their own.

export const V_HEALTH = 0;
export const V_FOOD = 1;
export const V_WATER = 2;
export const V_OXYGEN = 3;
export const V_COUNT = 4;
export const VITAL_NAMES = ["health", "food", "water", "oxygen"] as const;

export class Vitals {
  /** Values at `tick`, in millionths of a point. */
  readonly value = new Float64Array(V_COUNT);
  /** Change per tick, millionths of a point, whole numbers. */
  readonly rate = new Float64Array(V_COUNT);
  readonly max = new Float64Array(V_COUNT);
  tick = 0;
  /** Counts every change, for sending only what a client lacks. */
  version = 0;

  /** Value of vital `i` at `tick`, millionths of a point. */
  at(i: number, tick: number): number {
    const v = this.value[i]! + this.rate[i]! * (tick - this.tick);
    const max = this.max[i]!;
    return v < 0 ? 0 : v > max ? max : v;
  }

  /** Move the base to `tick`, keeping every value what it is at that tick. */
  rebase(tick: number): void {
    for (let i = 0; i < V_COUNT; i++) this.value[i] = this.at(i, tick);
    this.tick = tick;
    this.version++;
  }

  /** First tick at which vital `i` is zero at its current rate, or Infinity. */
  zeroTick(i: number): number {
    const v = this.value[i]!;
    const r = this.rate[i]!;
    if (v <= 0) return this.tick;
    if (r >= 0) return Infinity;
    return this.tick + Math.ceil(v / -r);
  }
}
