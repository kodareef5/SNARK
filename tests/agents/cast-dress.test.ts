// What Cast's people and the built-in populations wear: garments in colours drawn from each piece's dyes, and armour only
// where a role needs it.

import { expect, test } from "bun:test";
import { CAST_CATALOGUE } from "../../content/cast/index.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { CITY, POPULATIONS } from "../../content/people/defaults.ts";
import { castPerson } from "../../server/cast/people.ts";
import type { Character } from "../../shared/cast/state.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { readPopulation, type PopulationDoc } from "../../shared/people/doc.ts";
import { personFrom } from "../../shared/people/person.ts";
import { WARDROBE_NAMES } from "../../shared/sim/items.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const FLAK = ["core:flak_hat", "core:flak_shirt", "core:flak_pants", "core:flak_boots"];
const ARMOURED = new Set(["cast:police"]);
const SEEDS = Array.from({ length: 200 }, (_, k) => Math.imul(k + 1, 0x9e3779b1) >>> 0);
const isGarment = (id: string): boolean => (reg.garmentSlot[reg.index.get(id) ?? -1] ?? -1) >= 0;
const isCloth = (id: string): boolean => {
  const d = reg.defs[reg.index.get(id) ?? -1] as { wear?: { set?: string } } | undefined;
  return d?.wear?.set === "cloth";
};
const character = (look: string, seed: number): Character => ({
  id: "c1", tier: "extra", archetype: "cast:pedestrian", look, name: "Kim", seed, traits: { calm: 0.5, social: 0.5, bold: 0.5, playful: 0.5 }, home: 0, facts: [], relations: {}, touched: 0,
});

test("every built-in outfit is garments, each dyed from colours of its own", () => {
  const outfits = [...POPULATIONS.flatMap((p) => p.outfits ?? []), ...CAST_CATALOGUE.looks.flatMap((l) => l.outfits ?? [])];
  for (const p of POPULATIONS) expect([p.id, (p.outfits ?? []).length > 0]).toEqual([p.id, true]);
  for (const o of outfits) {
    expect(o.wear.filter((id) => !isGarment(id))).toEqual([]);
    expect(o.dyes!.length).toBe(o.wear.length);
  }
});

test("no built-in population or Cast civilian wears cloth armour as clothing", () => {
  for (const look of CAST_CATALOGUE.looks) {
    for (const seed of SEEDS.slice(0, 40)) {
      const body = castPerson(character(look.id, seed), look, CAST_CATALOGUE, reg)!;
      expect([look.id, body.wear.filter(isCloth)]).toEqual([look.id, []]);
      // Everyone has a bottom on; armour goes only to a role that needs it.
      expect([look.id, !!body.wardrobe[WARDROBE_NAMES.indexOf("bottom")]]).toEqual([look.id, true]);
      if (!ARMOURED.has(look.id)) expect([look.id, body.wear]).toEqual([look.id, []]);
    }
  }
});

test("a police officer keeps its flak over a uniform", () => {
  const look = CAST_CATALOGUE.looks.find((l) => l.id === "cast:police")!;
  const body = castPerson(character(look.id, 9), look, CAST_CATALOGUE, reg)!;
  expect([...body.wear].sort()).toEqual([...FLAK].sort());
  expect(body.wardrobe.map((w) => w?.[0] ?? "")).toEqual(["core:tee", "core:jeans", "", "core:trainers", ""]);
});

test("a city crowd of 200 varies in its clothes and their colours", () => {
  const tees = new Set<number>(), dressed = new Set<string>();
  for (const seed of SEEDS) {
    const person = personFrom(seed, CITY), o = CITY.outfits![person.outfit]!;
    dressed.add(`${person.outfit}|${person.dyes.join(",")}`);
    if (o.wear[0] === "core:tee") tees.add(person.dyes[0]!);
  }
  expect(dressed.size).toBeGreaterThan(150);
  expect(tees.size).toBeGreaterThanOrEqual(12);
});

test("a look's own clothes leave the body its population draws", () => {
  const look = CAST_CATALOGUE.looks.find((l) => l.id === "cast:street_plain")!;
  for (const seed of SEEDS.slice(0, 20)) {
    const body = castPerson(character(look.id, seed), look, CAST_CATALOGUE, reg)!;
    expect([...body.person.look]).toEqual([...personFrom(body.born.seed, CITY).look]);
  }
});

test("a copy of a built-in population keeps its outfits' dyes", () => {
  const { type: _t, id: _i, ...doc } = CITY;
  const read = readPopulation(doc as unknown as Record<string, unknown>) as PopulationDoc;
  expect(read.outfits).toEqual(CITY.outfits);
  expect(readPopulation({ ...doc, outfits: [{ wear: ["core:tee"], weight: 1, dyes: [[300]] }] } as unknown as Record<string, unknown>)).toBeString();
});
