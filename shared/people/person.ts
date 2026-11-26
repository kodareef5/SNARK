// The person generator: a seed and a population give one person, the same on every engine, so a crowd is sent as seeds
// and every client draws the people the server made. Each part of a person is drawn from its own stream, the seed mixed
// with the part's tag, so a choice added to one part never changes another. Only integer and exactly rounded double
// arithmetic is used.

import {
  BEARD_STYLES, FACE_COUNT, HAIR_STYLES, LAYOUT_VERSION, LOOK_AGE, LOOK_BEARD, LOOK_BEARD_LENGTH, LOOK_BROW, LOOK_BYTES, LOOK_COMPLEXION, LOOK_EYE_COLOR, LOOK_FACE,
  LOOK_HAIR, LOOK_HAIR_COLOR, LOOK_HAIR_COLOR_2, LOOK_HAIR_LENGTH, LOOK_LAYOUT, LOOK_MUSCLE, LOOK_REGIONS, LOOK_SEX, LOOK_SKIN, LOOK_WEIGHT, REGION_COUNT,
} from "../anim/look.ts";
import type { Registry } from "../content/registry.ts";
import { REGION_KEYS, type PopulationDef, type Span } from "../content/kinds/populations.ts";
import { Rng } from "../rng.ts";

export type { PopulationDef as Population } from "../content/kinds/populations.ts";

/** A person: its look, and what else a population gives it. Hair growth, garments and dye come here as they are built. */
export interface Person {
  readonly look: Uint8Array;
  /** 0 for a man, 1 for a woman (LOOK_SEX). */
  readonly sex: number;
  /** Which of the population's outfits it wears, or -1 where it has none. */
  readonly outfit: number;
}

/** Each part's tag. A new part takes a new tag; a tag is never reused or changed. */
export const PART_SEX = 1;
export const PART_BODY = 2;
export const PART_SKIN = 3;
export const PART_HAIR = 4;
export const PART_BEARD = 5;
export const PART_BROWS = 6;
export const PART_FACE = 7;
export const PART_FIGURE = 8;
export const PART_OUTFIT = 9;

/** The most a look's hair or beard length byte holds that a population's 1 means. */
const LENGTH_MOST = 96;
const GREY = 7;
const WHITE = 8;

/** A part's stream: the seed and the tag mixed through murmur3's finaliser. */
export function partSeed(seed: number, part: number): number {
  let h = (seed ^ Math.imul(part, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** An index drawn by `weights`, a missing weight 0; -1 when none is above 0. */
function weighted(rng: Rng, weights: readonly number[] | undefined): number {
  if (!weights) return -1;
  let total = 0;
  for (const w of weights) total += w > 0 ? w : 0;
  if (!(total > 0)) return -1;
  let r = rng.float() * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]! > 0 ? weights[i]! : 0;
    if (r < w) return i;
    r -= w;
  }
  // Rounding left a sliver past the last: it is the last weighed.
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i]! > 0) return i;
  return -1;
}

/** A whole number in -127..127 for a span in -1..1, nearer its middle than its ends: the mean of two throws. */
function signedIn(rng: Rng, s: Span): number {
  const lo = Math.round(clamp(s[0], -1, 1) * 127), hi = Math.round(clamp(s[1], -1, 1) * 127);
  const t = rng.int(65536) + rng.int(65536);
  return lo + Math.floor(((hi - lo) * t) / 131070 + 0.5);
}

/** A whole number in 0..most for a span in 0..1, evenly. */
function unsignedIn(rng: Rng, s: Span | undefined, most: number): number {
  if (!s) return 0;
  const lo = Math.round(clamp(s[0], 0, 1) * most), hi = Math.round(clamp(s[1], 0, 1) * most);
  return lo + rng.int(hi - lo + 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The sex a seed gives in a population, drawn alone: a caller that needs one sex tries seeds until it has it. */
export function sexOf(seed: number, population: PopulationDef): number {
  return new Rng(partSeed(seed, PART_SEX)).float() < population.women ? 1 : 0;
}

/** The person `seed` is in `population`. Pure: the same bytes for the same seed and population on every engine. */
export function personFrom(seed: number, population: PopulationDef, out: Uint8Array = new Uint8Array(LOOK_BYTES)): Person {
  const p = population;
  out.fill(0, 0, LOOK_BYTES);
  out[LOOK_LAYOUT] = LAYOUT_VERSION;
  const sex = sexOf(seed, p);
  out[LOOK_SEX] = sex;

  let rng = new Rng(partSeed(seed, PART_FIGURE));
  const age = signedIn(rng, p.age);
  out[LOOK_AGE] = age & 255;
  out[LOOK_WEIGHT] = signedIn(rng, p.weight) & 255;
  out[LOOK_MUSCLE] = signedIn(rng, p.muscle) & 255;

  rng = new Rng(partSeed(seed, PART_BODY));
  for (let r = 0; r < REGION_COUNT; r++) out[LOOK_REGIONS + r] = signedIn(rng, p.regions?.[REGION_KEYS[r]!] ?? p.build) & 255;

  rng = new Rng(partSeed(seed, PART_SKIN));
  out[LOOK_SKIN] = Math.max(0, weighted(rng, p.skin));
  out[LOOK_EYE_COLOR] = Math.max(0, weighted(rng, p.eyes));
  out[LOOK_COMPLEXION] = Math.max(0, weighted(rng, p.complexions));

  rng = new Rng(partSeed(seed, PART_HAIR));
  out[LOOK_HAIR] = Math.min(HAIR_STYLES.length - 1, Math.max(0, weighted(rng, sex === 1 ? p.hair.women : p.hair.men)));
  let color = Math.max(0, weighted(rng, p.hairColors));
  // Greying is drawn whatever the age, so an edit of the ages moves no other draw.
  const greying = rng.float();
  if (p.grey) {
    const [from, all] = p.grey, a = age / 127;
    const chance = a <= from ? 0 : a >= all || all === from ? 1 : (a - from) / (all - from);
    if (greying < chance) color = greying < chance * 0.25 ? WHITE : GREY;
  }
  out[LOOK_HAIR_COLOR] = color;
  out[LOOK_HAIR_COLOR_2] = rng.float() < (p.streak ?? 0) ? 1 + Math.max(0, weighted(rng, p.hairColors)) : 0;
  out[LOOK_HAIR_LENGTH] = unsignedIn(rng, p.hairLength, LENGTH_MOST);

  rng = new Rng(partSeed(seed, PART_BEARD));
  const bearded = rng.float() < (sex === 1 ? p.beard.women : p.beard.men);
  out[LOOK_BEARD] = bearded ? 1 + rng.int(BEARD_STYLES.length - 1) : 0;
  out[LOOK_BEARD_LENGTH] = bearded ? unsignedIn(rng, p.beardLength, LENGTH_MOST) : 0;

  rng = new Rng(partSeed(seed, PART_BROWS));
  out[LOOK_BROW] = Math.max(0, weighted(rng, p.brows));

  rng = new Rng(partSeed(seed, PART_FACE));
  const spread: Span = [-p.face, p.face];
  for (let f = 0; f < FACE_COUNT; f++) out[LOOK_FACE + f] = signedIn(rng, spread) & 255;

  rng = new Rng(partSeed(seed, PART_OUTFIT));
  const outfit = weighted(rng, p.outfits?.map((o) => o.weight));
  return { look: out, sex, outfit };
}

/** The populations of a registry in index order: a population's place in `list` is its number on the wire. */
export interface Populations {
  readonly list: readonly PopulationDef[];
  readonly number: ReadonlyMap<string, number>;
}

const tables = new WeakMap<Registry, Populations>();

export function populationsOf(reg: Registry): Populations {
  let t = tables.get(reg);
  if (!t) {
    const list = reg.defs.filter((d): d is PopulationDef => d?.type === "population");
    t = { list, number: new Map(list.map((p, i) => [p.id, i])) };
    tables.set(reg, t);
  }
  return t;
}

/** The look a seed form names, or null for a population or edit the registry lacks. */
export function lookOfSeed(reg: Registry, seed: number, population: number, revision: number): Uint8Array | null {
  const p = populationsOf(reg).list[population];
  return p && p.revision === revision ? personFrom(seed, p).look : null;
}
