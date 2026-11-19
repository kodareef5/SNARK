// The world tick never jumps. `settime` changes an offset that only display and day-night rules add to it.
// The hour is a closed-form function of the tick, so server and clients agree. The 140-second hour of lazy.ts is a separate unit (D94).

/** At scale 1. The game minute is 2.1 seconds, as players measured the reference game's, so a day is 50.4 minutes (DEV76). */
export const CLOCK_HOUR_TICKS = 3780;
/** At scale 1. */
export const DAY_TICKS = 24 * CLOCK_HOUR_TICKS;
/** Between these hours the day scale runs the clock, outside them the night scale. */
export const SUNRISE = 6;
export const SUNSET = 18;

/** Speed multipliers for the whole cycle, and for the day and the night within it. */
export interface ClockScales {
  readonly cycle: number;
  readonly day: number;
  readonly night: number;
}

export const UNIT_CLOCK: ClockScales = { cycle: 1, day: 1, night: 1 };

/** Ticks from midnight to sunrise, and as many from sunset to midnight. */
const nightHalf = (c: ClockScales): number => (SUNRISE * CLOCK_HOUR_TICKS) / (c.cycle * c.night);
/** Ticks from sunrise to sunset. */
const dayPart = (c: ClockScales): number => ((SUNSET - SUNRISE) * CLOCK_HOUR_TICKS) / (c.cycle * c.day);

/** Not a whole number in general. */
export function cycleTicks(c: ClockScales = UNIT_CLOCK): number {
  return 2 * nightHalf(c) + dayPart(c);
}

/** Ticks since midnight. */
export function dayTick(tick: number, offset: number, c: ClockScales = UNIT_CLOCK): number {
  return (tick + offset) % cycleTicks(c);
}

/** Hours since midnight, 0 .. 24. */
export function hourOfDay(tick: number, offset: number, c: ClockScales = UNIT_CLOCK): number {
  const a = nightHalf(c);
  const b = dayPart(c);
  const p = (tick + offset) % (2 * a + b);
  if (p < a) return (p * c.cycle * c.night) / CLOCK_HOUR_TICKS;
  if (p < a + b) return SUNRISE + ((p - a) * c.cycle * c.day) / CLOCK_HOUR_TICKS;
  return SUNSET + ((p - a - b) * c.cycle * c.night) / CLOCK_HOUR_TICKS;
}

/** Ticks from midnight to `hour`, the inverse of hourOfDay within one cycle. Not a whole number in general. */
export function dayTickOfHour(hour: number, c: ClockScales = UNIT_CLOCK): number {
  const a = nightHalf(c);
  const b = dayPart(c);
  const h = ((hour % 24) + 24) % 24;
  return h < SUNRISE ? (h * CLOCK_HOUR_TICKS) / (c.cycle * c.night) : h < SUNSET ? a + ((h - SUNRISE) * CLOCK_HOUR_TICKS) / (c.cycle * c.day) : a + b + ((h - SUNSET) * CLOCK_HOUR_TICKS) / (c.cycle * c.night);
}

/** The whole-tick offset that puts `tick` at `hour`, to within half a tick. */
export function offsetForHour(tick: number, hour: number, c: ClockScales = UNIT_CLOCK): number {
  const whole = cycleTicks(c);
  const want = dayTickOfHour(hour, c);
  const offset = Math.round((((want - (tick % whole)) % whole) + whole) % whole);
  // An offset that rounds up to the whole cycle is the start of the cycle.
  return offset >= whole ? 0 : offset;
}

/** An hour as CMD_CLOCK carries it: a share of the day in CLOCK_SHARES steps of two game seconds, so a whole minute is exact. */
export const CLOCK_SHARES = 43200;

export function shareOfHour(hour: number): number {
  return Math.round(((((hour % 24) + 24) % 24) * CLOCK_SHARES) / 24) % CLOCK_SHARES;
}

export function hourOfShare(share: number): number {
  return (share * 24) / CLOCK_SHARES;
}

export function isDay(hour: number): boolean {
  return hour >= SUNRISE && hour < SUNSET;
}

export function formatHour(hour: number): string {
  const minutes = Math.floor(hour * 60) % (24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? "0" : ""}${h}:${m < 10 ? "0" : ""}${m}`;
}
