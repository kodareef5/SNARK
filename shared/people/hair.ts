// Hair and beards grow by a clock that is never stepped. A clock's start is a whole number of HAIR_TICK steps, which may lie
// before tick 0 once a survivor moves to a younger world; -1, which no step is, means no clock. A survivor's look holds its hair and beard length as they were
// when its clock started (LOOK_HAIR_LENGTH, LOOK_BEARD_LENGTH), and the clock's start is kept beside it. The length at any
// tick is worked out from those, the tick and the server's rate, in whole numbers only, so the server and every client
// that was sent the same start get the same length at the same tick.

import { LOOK_BEARD_LENGTH, LOOK_HAIR_LENGTH } from "../anim/look.ts";

/** A clock starts on a whole number of these ticks, about 34 s, so a create sends its start in a byte or two. */
export const HAIR_TICK = 1024;
/** No clock: the lengths stay as stored. */
export const NO_CLOCK = -1;
/** The lengths a cut leaves and hair is drawn at: 0 is the style as modelled. Hair grows no longer than the last. */
export const HAIR_STAGES: readonly number[] = [0, 64, 128, 192, 255];
export const HAIR_LONGEST = 255;
/** At a rate of 1000 (HairGrowthSpeedMultiplier 1), one unit of length grows in 40 clock steps: a stage in about a day. */
const STEPS_PER_UNIT = 40_000;
/** The highest rate, in thousandths. */
export const HAIR_RATE_MOST = 1_000_000;

/** The server's HairGrowthSpeedMultiplier as the rate sent and used everywhere: thousandths, whole. */
export function hairRate(multiplier: number): number {
  if (!(multiplier > 0)) return 0;
  return Math.min(HAIR_RATE_MOST, Math.round(multiplier * 1000));
}

/** The start of a clock started at `tick`: the clock step it falls in. */
export function hairClock(tick: number): number {
  return tick > 0 ? Math.floor(tick / HAIR_TICK) * HAIR_TICK : 0;
}

/** A length stored at a clock's `start`, grown at `rate` until `now`. A start of -1 is no clock: the length stays. */
export function lengthAt(stored: number, start: number, now: number, rate: number): number {
  if (start === NO_CLOCK || rate <= 0 || stored >= HAIR_LONGEST) return Math.min(stored, HAIR_LONGEST);
  const steps = Math.floor(now / HAIR_TICK) - Math.floor(start / HAIR_TICK);
  if (steps <= 0) return stored;
  // Steps past those that grow the longest hair change nothing, and a large count would lose whole numbers.
  const most = Math.ceil(((HAIR_LONGEST - stored) * STEPS_PER_UNIT) / rate);
  return Math.min(HAIR_LONGEST, stored + Math.floor((Math.min(steps, most) * rate) / STEPS_PER_UNIT));
}

/** Hair length of `look` at `now`. */
export function hairAt(look: Uint8Array, start: number, now: number, rate: number): number {
  return lengthAt(look[LOOK_HAIR_LENGTH]!, start, now, rate);
}

export function beardAt(look: Uint8Array, start: number, now: number, rate: number): number {
  return lengthAt(look[LOOK_BEARD_LENGTH]!, start, now, rate);
}

/** Writes into `look` its hair and beard as grown at `now`, for a clock that starts again then. */
export function bakeHair(look: Uint8Array, start: number, now: number, rate: number): void {
  const hair = hairAt(look, start, now, rate), beard = beardAt(look, start, now, rate);
  look[LOOK_HAIR_LENGTH] = hair;
  look[LOOK_BEARD_LENGTH] = beard;
}

/**
 * Clock steps of growth since `start` that have not yet made a whole unit of length: a clock started again this many steps
 * before now keeps that growth, to within a step's worth.
 */
export function carrySteps(start: number, now: number, rate: number): number {
  if (start === NO_CLOCK || rate <= 0) return 0;
  const steps = Math.floor(now / HAIR_TICK) - Math.floor(start / HAIR_TICK);
  if (steps <= 0) return 0;
  // A long count is reduced first: whole units of it carry nothing.
  const units = Math.floor((steps * rate) / STEPS_PER_UNIT);
  return Math.floor((steps * rate - units * STEPS_PER_UNIT) / rate);
}

/** The stage a length is drawn at: the longest stage it has reached. */
export function stageOf(length: number): number {
  let s = 0;
  while (s + 1 < HAIR_STAGES.length && length >= HAIR_STAGES[s + 1]!) s++;
  return s;
}
