// Time of day. The world clock (`tick`) never jumps: every lazy quantity and
// deadline is measured on it. What an admin changes with `settime` is an
// offset added to it for display and day-night rules only.

import { GAME_HOUR_TICKS } from "./lazy.ts";

export const DAY_TICKS = 24 * GAME_HOUR_TICKS;

/** Ticks since midnight, 0 .. DAY_TICKS - 1. */
export function dayTick(tick: number, offset: number): number {
  return (tick + offset) % DAY_TICKS;
}

/** Hours since midnight, 0 .. 24. */
export function hourOfDay(tick: number, offset: number): number {
  return dayTick(tick, offset) / GAME_HOUR_TICKS;
}

/** The offset that makes `tick` fall at `hour` (0 .. 24) of the day. */
export function offsetForHour(tick: number, hour: number): number {
  const want = Math.round((((hour % 24) + 24) % 24) * GAME_HOUR_TICKS) % DAY_TICKS;
  return (want - (tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
}

export function formatHour(hour: number): string {
  const minutes = Math.floor(hour * 60) % (24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? "0" : ""}${h}:${m < 10 ? "0" : ""}${m}`;
}
