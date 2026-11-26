// The person generator: a seed and a population make one look, each part from its own stream.

import { expect, test } from "bun:test";
import { CAST_CATALOGUE } from "../../content/cast/index.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { BEACH, CITY, POPULATIONS, WORKERS } from "../../content/people/defaults.ts";
import { castPerson } from "../../server/cast/people.ts";
import { HAIR_STYLES, HEAD_GROW, LOOK_AGE, LOOK_BEARD, LOOK_BEARD_LENGTH, LOOK_BYTES, LOOK_HAIR, LOOK_HAIR_COLOR, LOOK_HAIR_COLOR_2, LOOK_HAIR_LENGTH, LOOK_REGIONS, LOOK_SEX, REGIONS, lookScales, regionOf, validLook } from "../../shared/anim/look.ts";
import { B_HEAD, HUMAN_BONES } from "../../shared/anim/human.ts";
import type { Character } from "../../shared/cast/state.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { REGION_KEYS, type PopulationDef } from "../../shared/content/kinds/populations.ts";
import { lookOfSeed, personFrom, populationsOf } from "../../shared/people/person.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const SEEDS = Array.from({ length: 1500 }, (_, k) => (Math.imul(k + 1, 0x9e3779b1) >>> 0));
const signed = (b: number) => (b > 127 ? b - 256 : b) / 127;
const mean = (p: PopulationDef, at: (look: Uint8Array) => number) => SEEDS.reduce((s, seed) => s + at(personFrom(seed, p).look), 0) / SEEDS.length;

test("every built-in population makes valid looks that lookScales keeps in reach", () => {
  const scales = new Float32Array(HUMAN_BONES * 3);
  for (const p of POPULATIONS) {
    for (const seed of SEEDS) {
      const { look } = personFrom(seed, p);
      expect([p.id, seed, validLook(look)]).toEqual([p.id, seed, true]);
      lookScales(look, scales);
      for (let a = 0; a < 3; a++) expect(scales[B_HEAD * 3 + a]!).toBeLessThanOrEqual(HEAD_GROW);
      expect(scales.every((v) => Number.isFinite(v) && v > 0.5 && v < 1.5)).toBe(true);
    }
  }
});

test("a seed gives the same person every time, into a fresh array or a used one", () => {
  const out = new Uint8Array(LOOK_BYTES).fill(77);
  for (const seed of [0, 1, 0xffffffff, 123456789]) {
    const a = personFrom(seed, CITY), b = personFrom(seed, CITY, out);
    expect([...b.look]).toEqual([...a.look]);
    expect([b.sex, b.outfit]).toEqual([a.sex, a.outfit]);
    expect(a.look[LOOK_SEX]).toBe(a.sex);
  }
});

test("a choice added to one part changes no other part", () => {
  const hairBytes = new Set([LOOK_HAIR, LOOK_HAIR_COLOR, LOOK_HAIR_COLOR_2, LOOK_HAIR_LENGTH]);
  // A new hair style weighed in, and a new outfit.
  const more: PopulationDef = { ...BEACH, hair: { men: [...BEACH.hair.men, 0, 0, 5], women: [...BEACH.hair.women, 0, 0, 5] }, outfits: [...BEACH.outfits!, { wear: ["core:cloth_boots"], weight: 4 }] };
  let hairMoved = 0, outfitMoved = 0;
  for (const seed of SEEDS) {
    const a = personFrom(seed, BEACH), b = personFrom(seed, more);
    for (let q = 0; q < LOOK_BYTES; q++) if (!hairBytes.has(q)) expect([seed, q, b.look[q]]).toEqual([seed, q, a.look[q]]);
    if (a.look[LOOK_HAIR] !== b.look[LOOK_HAIR]) hairMoved++;
    if (a.outfit !== b.outfit) outfitMoved++;
  }
  expect(hairMoved).toBeGreaterThan(0);
  expect(outfitMoved).toBeGreaterThan(0);
});

test("older workers and young beachgoers are visibly different crowds", () => {
  const age = (l: Uint8Array) => signed(l[LOOK_AGE]!);
  const waist = (l: Uint8Array) => regionOf(l, REGION_KEYS.indexOf("waist"));
  const grey = (l: Uint8Array) => (l[LOOK_HAIR_COLOR] === 7 || l[LOOK_HAIR_COLOR] === 8 ? 1 : 0);
  const bearded = (l: Uint8Array) => (l[LOOK_SEX] === 0 && l[LOOK_BEARD] !== 0 ? 1 : 0);
  const long = (l: Uint8Array) => (l[LOOK_HAIR] === 3 ? 1 : 0);
  expect(mean(WORKERS, age)).toBeGreaterThan(0.5);
  expect(mean(BEACH, age)).toBeLessThan(-0.5);
  expect(mean(WORKERS, waist) - mean(BEACH, waist)).toBeGreaterThan(0.6);
  expect(mean(WORKERS, grey)).toBeGreaterThan(0.3);
  expect(mean(BEACH, grey)).toBe(0);
  expect(mean(WORKERS, bearded)).toBeGreaterThan(mean(BEACH, bearded) * 3);
  expect(mean(BEACH, long)).toBeGreaterThan(mean(WORKERS, long) * 3);
  // Slider ranges hold: a region a population names stays in its span.
  for (const seed of SEEDS) {
    const w = waist(personFrom(seed, WORKERS).look);
    expect(w >= 0.19 && w <= 0.91).toBe(true);
  }
});

test("a crowd has both sexes in its share, and men alone grow beards where women have none", () => {
  const women = mean(CITY, (l) => l[LOOK_SEX]!);
  expect(Math.abs(women - CITY.women)).toBeLessThan(0.05);
  expect(Math.abs(mean(WORKERS, (l) => l[LOOK_SEX]!) - WORKERS.women)).toBeLessThan(0.05);
  for (const seed of SEEDS) {
    const l = personFrom(seed, CITY).look;
    if (l[LOOK_SEX] === 1) expect([l[LOOK_BEARD], l[LOOK_BEARD_LENGTH]]).toEqual([0, 0]);
  }
  // Every region is drawn: no slider sits at neutral for the whole crowd.
  for (let r = 0; r < REGIONS.length; r++) expect(new Set(SEEDS.slice(0, 200).map((s) => personFrom(s, CITY).look[LOOK_REGIONS + r])).size).toBeGreaterThan(10);
});

test("two Cast presets of one character make different people of the name's sex", () => {
  const c: Character = { id: "c1", tier: "extra", archetype: "cast:worker", look: "cast:office", name: "Marisol", seed: 4242, traits: { calm: 0.5, social: 0.5, bold: 0.5, playful: 0.5 }, home: 0, facts: [], relations: {}, touched: 0 };
  const office = castPerson(c, CAST_CATALOGUE.looks.find((l) => l.id === "cast:office"), CAST_CATALOGUE, reg)!;
  const swim = castPerson(c, CAST_CATALOGUE.looks.find((l) => l.id === "cast:swimwear"), CAST_CATALOGUE, reg)!;
  expect([...office.person.look]).not.toEqual([...swim.person.look]);
  expect([office.person.sex, swim.person.sex]).toEqual([1, 1]);
  // The office look keeps its own clothes; swimwear takes what the beach population wears.
  expect(office.wear).toEqual(CAST_CATALOGUE.looks.find((l) => l.id === "cast:office")!.wear);
  expect(BEACH.outfits!.map((o) => o.wear)).toContainEqual([...swim.wear]);
  // A seed form names what made it, and makes the same look again.
  const { born } = swim;
  expect([...lookOfSeed(reg, born.seed, born.population, born.revision)!]).toEqual([...swim.person.look]);
  expect([populationsOf(reg).list[born.population]!.id, born.revision]).toEqual(["core:people_beach", 0]);
  expect(lookOfSeed(reg, born.seed, populationsOf(reg).list.length, 1)).toBeNull();
});

test("a population that is not sound is told plainly", () => {
  const bad = { ...CITY, id: "core:people_bad", women: 2, skin: [0, 0], hair: { men: [1], women: Array(HAIR_STYLES.length + 1).fill(1) }, regions: { tail: [0, 1] as const, waist: [1, 0] as const }, age: [-2, 0] as const, outfits: [{ wear: ["core:stone"], weight: 1 }] } as PopulationDef;
  const errors = compileContent([...CORE_CONTENT, bad]).errors.join("\n");
  for (const want of ["women is a share", "skin wants weights", "hair wants weights", "tail is no body region", "regions: waist is a low and a high", "age is a low and a high", '"core:stone" is not an item/armor']) expect([want, errors.includes(want)]).toEqual([want, true]);
});
