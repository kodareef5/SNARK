// Lazy quantities: values that change at a steady rate and are computed when
// read, never ticked.
//
// Food, water, spoilage, decay, crop growth and taming progress are all "a value
// at some tick, plus a rate". Storing (value, tick) and evaluating on demand
// costs nothing per tick for any number of entities, awake or dormant, and gives
// the same answer after an hour offline as after an hour online.
//
// Amounts are integers in millionths of a unit, and rates are integers per
// tick, so results are exact: reading once after 100,000 ticks equals stepping
// 100,000 times.

/** Units per whole point (a food value of 1 is 1,000,000). */
export const MICRO = 1000000;
/** Ticks in one in-game hour: 140 seconds. */
export const GAME_HOUR_TICKS = 4200;

/** Value at `tick` of a quantity that was `value0` at `tick0` and changes by `rate` per tick, held within [0, max]. */
export function lazyValue(value0: number, tick0: number, rate: number, max: number, tick: number): number {
  const v = value0 + rate * (tick - tick0);
  return v < 0 ? 0 : v > max ? max : v;
}

/** First tick at which a falling quantity is zero, or Infinity if it never gets there. */
export function lazyZeroTick(value0: number, tick0: number, rate: number): number {
  if (value0 <= 0) return tick0;
  if (rate >= 0) return Infinity;
  return tick0 + Math.ceil(value0 / -rate);
}

/** Integer per-tick rate for an amount per in-game hour. */
export function ratePerTick(perHour: number): number {
  return Math.round((perHour * MICRO) / GAME_HOUR_TICKS);
}
