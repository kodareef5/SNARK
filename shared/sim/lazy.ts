// Values that change at a steady rate, stored as (value, tick) and computed when read, never ticked.
// Amounts are integer millionths and rates are integers per tick, so one read after 100,000 ticks equals 100,000 steps.

/** Units per whole point. */
export const MICRO = 1000000;
/** 140 seconds. */
export const GAME_HOUR_TICKS = 4200;

/** Clamped to [0, max]. */
export function lazyValue(value0: number, tick0: number, rate: number, max: number, tick: number): number {
  const v = value0 + rate * (tick - tick0);
  return v < 0 ? 0 : v > max ? max : v;
}

/** The first tick at which the quantity is zero, or Infinity. */
export function lazyZeroTick(value0: number, tick0: number, rate: number): number {
  if (value0 <= 0) return tick0;
  if (rate >= 0) return Infinity;
  return tick0 + Math.ceil(value0 / -rate);
}

/** Integer per-tick rate for an amount per in-game hour. */
export function ratePerTick(perHour: number): number {
  return Math.round((perHour * MICRO) / GAME_HOUR_TICKS);
}
