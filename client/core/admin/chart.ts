// The admin page's charts: a value axis of round steps, a time axis on round times of the reader's clock, and a series as
// runs of points on the chart, broken where the server was not running to time it.

import { MINUTE_FIELDS, type Minutes } from "../../../shared/admin.ts";

/** The spans the charts of minutes show, in ms. The tiles draw the last two minutes by the second. */
export const SPANS: readonly { label: string; ms: number }[] = [
  { label: "1 h", ms: 3_600_000 },
  { label: "6 h", ms: 21_600_000 },
  { label: "24 h", ms: 86_400_000 },
];

/** The longest span held, so a page left open does not grow. */
const HELD_MS = 86_400_000;

/** The minutes held with those just asked for after them, the oldest let go past a day before the newest. */
export function joinMinutes(held: Minutes | null, got: Minutes): Minutes {
  if (!held || held.columns.at.length === 0) return got;
  const at = [...held.columns.at, ...got.columns.at];
  const from = at.findIndex((t) => t >= at.at(-1)! - HELD_MS);
  const columns = {} as Minutes["columns"];
  for (const f of MINUTE_FIELDS) columns[f] = [...held.columns[f], ...got.columns[f]].slice(from);
  return { next: got.next, columns };
}

/** The least step of 1, 2 or 5 times a power of ten that cuts `range` into at most `count` steps. */
export function niceStep(range: number, count: number): number {
  if (!(range > 0)) return 1;
  const rough = range / count;
  const ten = 10 ** Math.floor(Math.log10(rough));
  for (const m of [1, 2, 5, 10]) if (m * ten >= rough - 1e-12 * ten) return m * ten;
  return 10 * ten;
}

/** The value axis for values up to `most`, at least `floor`: its top on a round step, and the steps from 0 to it. */
export function valueAxis(most: number, floor: number, count = 3): { top: number; ticks: number[] } {
  const step = niceStep(Math.max(most, floor), count);
  const top = Math.max(step, Math.ceil(Math.max(most, floor) / step - 1e-9) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { top, ticks };
}

const MINUTE = 60_000;
const DAY = 1440 * MINUTE;
const TIME_STEPS = [1000, 5000, 10_000, 15_000, 30_000, MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, 60 * MINUTE, 120 * MINUTE, 180 * MINUTE, 360 * MINUTE, 720 * MINUTE, DAY, 2 * DAY, 7 * DAY];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A day as the reader's calendar has it: "Tue 18 Nov". `offset` is minutes behind UTC. */
export function dayText(t: number, offset: number): string {
  const local = new Date(t - offset * MINUTE);
  return `${DAYS[local.getUTCDay()]} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`;
}

/** A moment to the second: "Tue 18 Nov 21:04:32". */
export function momentText(t: number, offset: number): string {
  return `${dayText(t, offset)} ${clockText(t, offset, true)}`;
}

/** Whether `t` falls on midnight of the reader's day. */
export function isMidnight(t: number, offset: number): boolean {
  return (t - offset * MINUTE) % DAY === 0;
}

/**
 * Round times between t0 and t1, at most `count` of them, on the reader's clock: `offset` is minutes behind UTC, as
 * Date.getTimezoneOffset gives it, so an hour's mark falls on the hour where the reader is.
 */
export function timeTicks(t0: number, t1: number, count: number, offset: number): number[] {
  const step = timeStep(t0, t1, count);
  const shift = -offset * MINUTE;
  const out: number[] = [];
  for (let t = Math.ceil((t0 + shift) / step) * step - shift; t <= t1; t += step) out.push(t);
  return out;
}

/** The round step timeTicks marks t0 to t1 by. */
export function timeStep(t0: number, t1: number, count: number): number {
  return TIME_STEPS.find((s) => (t1 - t0) / s <= count) ?? TIME_STEPS.at(-1)!;
}

/** A mark of a time axis marked every `step`: the day where marks are days apart or at midnight, else the clock, to the second below a minute. */
export function tickText(t: number, step: number, offset: number): string {
  if (step >= DAY || isMidnight(t, offset)) return dayText(t, offset);
  return clockText(t, offset, step < MINUTE);
}

/** A time as the reader's clock shows it, hours and minutes, and seconds where the step needs them. */
export function clockText(t: number, offset: number, seconds = false): string {
  const local = new Date(t - offset * MINUTE);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(local.getUTCHours())}:${two(local.getUTCMinutes())}${seconds ? `:${two(local.getUTCSeconds())}` : ""}`;
}

/**
 * A series as runs of points on a chart `w` by `h` pixels: x by time from t0 to t1, y by value from 0 at the foot to `top`
 * at the head. Points outside the span are left out, and a run ends where two points are more than `gap` ms apart.
 */
export function chartRuns(at: readonly number[], v: readonly number[], t0: number, t1: number, top: number, w: number, h: number, gap: number): number[][] {
  const runs: number[][] = [];
  let run: number[] | null = null;
  let last = -Infinity;
  for (let i = 0; i < at.length; i++) {
    const t = at[i]!;
    if (t < t0 || t > t1) continue;
    if (!run || t - last > gap) runs.push((run = []));
    run.push(((t - t0) / (t1 - t0)) * w, h - (Math.min(v[i]!, top) / top) * h);
    last = t;
  }
  return runs;
}
