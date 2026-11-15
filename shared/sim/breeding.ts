// Breeding arithmetic, with the reference game's numbers where it publishes them. server/breeding.ts holds the state.
// Growth is stored as its span in ticks and the tick it ends. Slowing growth part way would put a start tick before tick 0 (D92).

import { TICK_RATE } from "../coords.ts";

/** A willing pair must stay together this long before there is an egg. Chosen, because the reference publishes none. */
export const MATE_SECONDS = 30;
export const MATE_TICKS = MATE_SECONDS * TICK_RATE;
/**
 * ARK's mating range is "loosely based on the size of the adult creature" and given for none. Chosen: two metres, and two
 * body widths of the adult more, between the middles of the pair. A dodo's is 2.9 m, a raptor's 4.4 m, a parasaur's 6.4 m.
 */
export const MATE_REACH = 2;
export const MATE_WIDTHS = 2;

/** Horizontal metres between a pair of a species whose adult body has radius `radius`. */
export function mateRange(radius: number): number {
  return MATE_REACH + MATE_WIDTHS * 2 * radius;
}

/** ARK's dodo defecates every 100 to 300 seconds, picked evenly. ARK says only that others go as they eat, so all go so. */
export const FECES_MIN = 100;
export const FECES_MAX = 300;
/**
 * ARK keeps at most 6 unfertilised eggs within a range it does not give. Chosen: of the same egg, within 10 m of where the
 * next would lie. Fertilised eggs are not counted, as in ARK.
 */
export const EGG_LIMIT = 6;
export const EGG_LIMIT_RANGE = 10;

/** In seconds. `draw` is uniform in [0, 1). */
export function fecesWait(draw: number): number {
  return FECES_MIN + (FECES_MAX - FECES_MIN) * draw;
}
/** Seconds a female waits after an egg before mating again, picked evenly between these (18 and 48 hours). */
export const MATE_WAIT_MIN = 18 * 3600;
export const MATE_WAIT_MAX = 48 * 3600;
/** Shares of all matings. */
export const TWINS = 0.1;
export const TRIPLETS = 0.02;

/** Growth is counted in hundredths. */
export const GROWN = 100;
/** Hundredths grown at which a baby becomes a juvenile, and a juvenile an adolescent. */
export const STAGE_JUVENILE = 10;
export const STAGE_ADOLESCENT = 50;
export const STAGES: readonly string[] = ["baby", "juvenile", "adolescent", "grown"];
/** A newborn has this share of an adult's health, food and carry weight. The rest comes evenly as it grows. */
export const BIRTH_SHARE = 0.1;
/** A newborn's hunger is this multiple of an adult's. It falls evenly to 1 as it grows. */
export const BIRTH_HUNGER = 510;
/** A newborn's drawn size as a share of an adult's, when its species gives none. */
export const BIRTH_SCALE = 0.25;

/** `draw` is uniform in [0, 1). */
export function litter(draw: number): number {
  return draw < TRIPLETS ? 3 : draw < TRIPLETS + TWINS ? 2 : 1;
}

/** In seconds. */
export function mateWait(draw: number): number {
  return MATE_WAIT_MIN + (MATE_WAIT_MAX - MATE_WAIT_MIN) * draw;
}

/** Whole hundredths grown, for growth that takes `span` ticks and ends at tick `grown`. `grown` 0 means never young, which counts as grown. */
export function growthStep(span: number, grown: number, tick: number): number {
  if (grown === 0 || tick >= grown) return GROWN;
  const left = grown - tick;
  if (left >= span) return 0;
  return Math.floor(((span - left) * GROWN) / span);
}

/** The first tick at which it is `step` hundredths grown. */
export function stepTick(span: number, grown: number, step: number): number {
  return step >= GROWN ? grown : grown - span + Math.ceil((step * span) / GROWN);
}

/** Growth as a fraction, 0 to 1. */
export function maturity(span: number, grown: number, tick: number): number {
  if (grown === 0 || tick >= grown) return 1;
  const left = grown - tick;
  return left >= span ? 0 : (span - left) / span;
}

/**
 * Makes the rest of a growth `k` times as long from `tick` on, for a change of the growth-speed rule (k is the old speed over the new).
 * The span scales too, clamped so the young stays in the hundredth it was in. Writes the new span and end tick to `out`.
 */
export function regrow(span: number, grown: number, tick: number, k: number, out: [number, number]): void {
  out[0] = span;
  out[1] = grown;
  if (grown === 0 || tick >= grown || !(k > 0)) return;
  const step = growthStep(span, grown, tick);
  const left = Math.max(1, Math.ceil((grown - tick) * k));
  // A span from `least` to `most` ticks keeps it in the same hundredth with that much left.
  const least = Math.ceil((left * GROWN) / (GROWN - step));
  const most = step < GROWN - 1 ? Math.ceil((left * GROWN) / (GROWN - 1 - step)) - 1 : Infinity;
  let next = Math.round(span * k);
  if (next > most) next = most;
  if (next < least) next = least;
  out[0] = next < GROWN ? GROWN : next;
  out[1] = tick + left;
}

/** The time left when a rule that divides it (hatch speed) goes from `was` to `is`. At least 1. */
export function leftAtSpeed(left: number, was: number, is: number): number {
  return Math.max(1, Math.ceil((left * was) / is));
}

/** The same for a rule that multiplies the time (the mating wait). */
export function leftAtPeriod(left: number, was: number, is: number): number {
  return Math.max(1, Math.round((left * is) / was));
}

/** An index into STAGES. */
export function stageOf(step: number): number {
  return step >= GROWN ? 3 : step >= STAGE_ADOLESCENT ? 2 : step >= STAGE_JUVENILE ? 1 : 0;
}

export function youngShare(step: number): number {
  return step >= GROWN ? 1 : BIRTH_SHARE + ((1 - BIRTH_SHARE) * step) / GROWN;
}

/** Sampled at the middle of the hundredth, so the food eaten over the whole of growing up matches the even fall. */
export function youngHunger(step: number): number {
  return step >= GROWN ? 1 : BIRTH_HUNGER - ((BIRTH_HUNGER - 1) * (step + 0.5)) / GROWN;
}

/** Drawn size as a share of an adult's. `tick` may be fractional. */
export function youngScale(birth: number, span: number, grown: number, tick: number): number {
  return birth + (1 - birth) * maturity(span, grown, tick);
}
