// Breeding: the arithmetic of mating, litters and growing up.
//
// The numbers are the reference game's where it publishes them. Nothing here
// keeps state or steps: server/breeding.ts holds the state as moments (when a
// pair has done, when an egg hatches, when a young one is next a hundredth
// more grown), and a client draws a young one at its size from the two numbers
// it is told: how many ticks its growing takes, and the tick it ends. Not the
// tick it began: growing up made slower part way through would put that
// before the world began (D92).

import { TICK_RATE } from "../coords.ts";

/** How long a pair must stay together, both willing, before there is an egg: seconds. Chosen; the reference publishes none. */
export const MATE_SECONDS = 30;
export const MATE_TICKS = MATE_SECONDS * TICK_RATE;
/** How near each other the two must be, metres on the flat. Chosen likewise. */
export const MATE_RANGE = 8;
/** After an egg, a female will not mate again for a time between these, picked evenly: seconds (18 and 48 hours). */
export const MATE_WAIT_MIN = 18 * 3600;
export const MATE_WAIT_MAX = 48 * 3600;
/** Of a hundred matings, this many give twins and this many triplets. */
export const TWINS = 0.1;
export const TRIPLETS = 0.02;

/** Growing up is counted in hundredths. */
export const GROWN = 100;
/** A young one is a baby until this many hundredths grown, then a juvenile until this many, then an adolescent. */
export const STAGE_JUVENILE = 10;
export const STAGE_ADOLESCENT = 50;
export const STAGES: readonly string[] = ["baby", "juvenile", "adolescent", "grown"];
/** At birth a young one has this share of a grown one's health, food and strength to carry; the rest comes evenly as it grows. */
export const BIRTH_SHARE = 0.1;
/** At birth it hungers this many times as fast as a grown one; that falls evenly to once as it grows. */
export const BIRTH_HUNGER = 510;
/** How big a newborn is drawn, as a share of a grown one, where its species does not say. */
export const BIRTH_SCALE = 0.25;

/** How many are born of one mating, from a number drawn evenly from [0, 1). */
export function litter(draw: number): number {
  return draw < TRIPLETS ? 3 : draw < TRIPLETS + TWINS ? 2 : 1;
}

/** How long a female waits before she may mate again, in seconds, from a number drawn evenly from [0, 1). */
export function mateWait(draw: number): number {
  return MATE_WAIT_MIN + (MATE_WAIT_MAX - MATE_WAIT_MIN) * draw;
}

/**
 * How far grown, in whole hundredths, is one whose growing takes `span` ticks
 * and ends at tick `grown`: 0 as it begins, GROWN from the tick it is grown.
 * One that was never young (`grown` 0) is grown.
 */
export function growthStep(span: number, grown: number, tick: number): number {
  if (grown === 0 || tick >= grown) return GROWN;
  const left = grown - tick;
  if (left >= span) return 0;
  return Math.floor(((span - left) * GROWN) / span);
}

/** The first tick at which one whose growing takes `span` ticks and ends at `grown` is `step` hundredths grown. */
export function stepTick(span: number, grown: number, step: number): number {
  return step >= GROWN ? grown : grown - span + Math.ceil((step * span) / GROWN);
}

/** How far along its growing it is at `tick`, 0 to 1: 1 for one that is grown or was never young. */
export function maturity(span: number, grown: number, tick: number): number {
  if (grown === 0 || tick >= grown) return 1;
  const left = grown - tick;
  return left >= span ? 0 : (span - left) / span;
}

/**
 * A young one's growing made `k` times as long from `tick` on: what a rule
 * that speeds growing up does when it changes (k is the old speed over the
 * new). What is left of it is that many times as long, and so is the whole,
 * held to where the hundredth it is in is the one it was in: it is never
 * less grown for it. Writes how long its growing now takes and when it ends
 * into `out`.
 */
export function regrow(span: number, grown: number, tick: number, k: number, out: [number, number]): void {
  out[0] = span;
  out[1] = grown;
  if (grown === 0 || tick >= grown || !(k > 0)) return;
  const step = growthStep(span, grown, tick);
  const left = Math.max(1, Math.ceil((grown - tick) * k));
  // In the same hundredth with that much left, its growing takes no less than `least` ticks and less than `most`.
  const least = Math.ceil((left * GROWN) / (GROWN - step));
  const most = step < GROWN - 1 ? Math.ceil((left * GROWN) / (GROWN - 1 - step)) - 1 : Infinity;
  let next = Math.round(span * k);
  if (next > most) next = most;
  if (next < least) next = least;
  out[0] = next < GROWN ? GROWN : next;
  out[1] = tick + left;
}

/** What is left of a time that a rule divides (how fast an egg hatches), when the rule goes from `was` to `is`: never none. */
export function leftAtSpeed(left: number, was: number, is: number): number {
  return Math.max(1, Math.ceil((left * was) / is));
}

/** What is left of a time that a rule multiplies (how long a female waits), when the rule goes from `was` to `is`: never none. */
export function leftAtPeriod(left: number, was: number, is: number): number {
  return Math.max(1, Math.round((left * is) / was));
}

/** Which of STAGES a young one `step` hundredths grown is in. */
export function stageOf(step: number): number {
  return step >= GROWN ? 3 : step >= STAGE_ADOLESCENT ? 2 : step >= STAGE_JUVENILE ? 1 : 0;
}

/** The share of a grown one's health, food and strength to carry that one `step` hundredths grown has. */
export function youngShare(step: number): number {
  return step >= GROWN ? 1 : BIRTH_SHARE + ((1 - BIRTH_SHARE) * step) / GROWN;
}

/**
 * How many times a grown one's hunger one `step` hundredths grown has. It
 * falls evenly as it grows; within a hundredth it is what it is at the middle
 * of that hundredth, so that the food eaten over the whole of growing up is
 * what the even fall would have eaten.
 */
export function youngHunger(step: number): number {
  return step >= GROWN ? 1 : BIRTH_HUNGER - ((BIRTH_HUNGER - 1) * (step + 0.5)) / GROWN;
}

/**
 * How big one whose growing takes `span` ticks and ends at `grown` is at
 * `tick` (which may fall between ticks), as a share of a grown one: `birth`
 * when it is born, 1 when it is grown, evenly between.
 */
export function youngScale(birth: number, span: number, grown: number, tick: number): number {
  return birth + (1 - birth) * maturity(span, grown, tick);
}
