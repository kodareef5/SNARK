// The person generator: a seed and a population give one person, the same on every engine, so a crowd is sent as seeds
// and every client draws the people the server made. Each part of a person is drawn from its own stream, the seed mixed
// with the part's tag, so a choice added to one part never changes another. Only integer and exactly rounded double
// arithmetic is used.

import {
  BEARD_STYLES, FACE_COUNT, HAIR_STYLES, LOOK_AGE, LOOK_BEARD, LOOK_BEARD_LENGTH, LOOK_BROW, LOOK_BYTES, LOOK_COMPLEXION, LOOK_EYE_COLOR, LOOK_FACE,
  LOOK_HAIR, LOOK_HAIR_COLOR, LOOK_HAIR_COLOR_2, LOOK_HAIR_LENGTH, LOOK_MUSCLE, LOOK_REGIONS, LOOK_SEX, LOOK_SKIN, LOOK_WEIGHT, REGION_COUNT,
} from "../anim/look.ts";
import type { Registry } from "../content/registry.ts";
import { REGION_KEYS, type PopulationDef, type Span } from "../content/kinds/populations.ts";
import { Rng } from "../rng.ts";
import type { Dye, OutfitDoc, PartName, PartSeeds, WornDoc } from "./doc.ts";

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
/** An admin outfit's slots, each on a stream of its own under this tag (wardrobeFrom). */
export const PART_WARDROBE = 10;
/** Each part's tag by its name in a person's locks (shared/people/doc.ts). */
export const PART_TAGS: Readonly<Record<PartName, number>> = {
  sex: PART_SEX, figure: PART_FIGURE, body: PART_BODY, skin: PART_SKIN, hair: PART_HAIR, beard: PART_BEARD, brows: PART_BROWS, face: PART_FACE, outfit: PART_OUTFIT,
};

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

/** A part's stream where `locks` may give the part a seed of its own. */
function stream(seed: number, part: PartName, locks: PartSeeds | null): Rng {
  return new Rng(partSeed(locks?.[part] ?? seed, PART_TAGS[part]));
}

/** The sex a seed gives in a population, drawn alone: a caller that needs one sex tries seeds until it has it. */
export function sexOf(seed: number, population: PopulationDef, locks: PartSeeds | null = null): number {
  return stream(seed, "sex", locks).float() < population.women ? 1 : 0;
}

/**
 * The person `seed` is in `population`, each part in `locks` drawn from its own seed there. Pure: the same bytes for the
 * same seed, population and locks on every engine.
 */
export function personFrom(seed: number, population: PopulationDef, out: Uint8Array = new Uint8Array(LOOK_BYTES), locks: PartSeeds | null = null): Person {
  const p = population;
  out.fill(0, 0, LOOK_BYTES);
  const sex = sexOf(seed, p, locks);
  out[LOOK_SEX] = sex;

  let rng = stream(seed, "figure", locks);
  const age = signedIn(rng, p.age);
  out[LOOK_AGE] = age & 255;
  out[LOOK_WEIGHT] = signedIn(rng, p.weight) & 255;
  out[LOOK_MUSCLE] = signedIn(rng, p.muscle) & 255;

  rng = stream(seed, "body", locks);
  for (let r = 0; r < REGION_COUNT; r++) out[LOOK_REGIONS + r] = signedIn(rng, p.regions?.[REGION_KEYS[r]!] ?? p.build) & 255;

  rng = stream(seed, "skin", locks);
  out[LOOK_SKIN] = Math.max(0, weighted(rng, p.skin));
  out[LOOK_EYE_COLOR] = Math.max(0, weighted(rng, p.eyes));
  out[LOOK_COMPLEXION] = Math.max(0, weighted(rng, p.complexions));

  rng = stream(seed, "hair", locks);
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

  rng = stream(seed, "beard", locks);
  const bearded = rng.float() < (sex === 1 ? p.beard.women : p.beard.men);
  out[LOOK_BEARD] = bearded ? 1 + rng.int(BEARD_STYLES.length - 1) : 0;
  out[LOOK_BEARD_LENGTH] = bearded ? unsignedIn(rng, p.beardLength, LENGTH_MOST) : 0;

  rng = stream(seed, "brows", locks);
  out[LOOK_BROW] = Math.max(0, weighted(rng, p.brows));

  rng = stream(seed, "face", locks);
  const spread: Span = [-p.face, p.face];
  for (let f = 0; f < FACE_COUNT; f++) out[LOOK_FACE + f] = signedIn(rng, spread) & 255;

  rng = stream(seed, "outfit", locks);
  const outfit = weighted(rng, p.outfits?.map((o) => o.weight));
  return { look: out, sex, outfit };
}

/**
 * What `seed` wears of an admin outfit (shared/people/doc.ts): one garment a slot by the slot's weights, in the slot's dye,
 * or null. Each slot is drawn on its own stream, so a choice added to one slot changes no other.
 */
export function wardrobeFrom(seed: number, outfit: OutfitDoc): (WornDoc | null)[] {
  const base = partSeed(seed, PART_WARDROBE);
  return outfit.slots.map((slot, i) => {
    if (!slot) return null;
    const k = weighted(new Rng(partSeed(base, i + 1)), slot.choices.map((c) => c.weight));
    if (k < 0) return null;
    const c = slot.choices[k]!;
    return { garment: c.garment, edition: c.edition, dye: slot.dye };
  });
}

/** A dye's three palette colours as one number, the first in the low byte, as an inventory slot keeps it. */
export const dyeNumber = (d: Dye): number => (d[0] | (d[1] << 8) | (d[2] << 16)) >>> 0;

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

/** The revisions of the cluster's admin populations a world or client holds (server/people/store.ts, its manifest). */
export interface StorePopulations {
  /** Revision `rev` of admin population `id`, or undefined where it is not held. */
  population(id: number, rev: number): PopulationDef | undefined;
}

/**
 * A population's number on the wire: the content's populations first, in registry order, then the cluster's admin
 * populations by store id. A client compiles the content the server does, so both count alike.
 */
export function wireNumber(reg: Registry, ref: string | number): number | undefined {
  const content = populationsOf(reg);
  return typeof ref === "number" ? (Number.isSafeInteger(ref) && ref >= 1 ? content.list.length + ref - 1 : undefined) : content.number.get(ref);
}

/** The admin population's store id a wire number names, or 0 for a content population. */
export function storeIdOf(reg: Registry, number: number): number {
  const n = populationsOf(reg).list.length;
  return number >= n ? number - n + 1 : 0;
}

/**
 * The population a seed form names, or undefined where neither the registry nor `store` holds it. A content population
 * has no revision; an admin one is held at `revision`.
 */
export function populationOf(reg: Registry, number: number, revision: number, store: StorePopulations | null = null): PopulationDef | undefined {
  const list = populationsOf(reg).list;
  return number < list.length ? list[number] : store?.population(number - list.length + 1, revision);
}

/** The look a seed form names, or null for a population or edit the registry and `store` lack. */
export function lookOfSeed(reg: Registry, seed: number, population: number, revision: number, store: StorePopulations | null = null): Uint8Array | null {
  const p = populationOf(reg, population, revision, store);
  return p ? personFrom(seed, p).look : null;
}
