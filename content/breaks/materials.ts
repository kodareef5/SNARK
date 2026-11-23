// The city's eight materials: what harms a piece built of one, the health of one half of it, the energy that rams
// through a half, and what a half's heap gives. Stucco, paint, tar and gravel are skins on one of these, not materials.
// This file reads no shape, so content/ruins.ts may read it.

import type { MaterialDef } from "../../shared/content/defs.ts";
import { shapeBreaks, type Family } from "./families.ts";

export type CityMaterial = "concrete" | "block" | "steel" | "sheet" | "timber" | "tile" | "plaster" | "glass";

// These ids sort after every id there was, so no index moves and a map built before them keeps its kinds.
export const cityMaterial = (name: CityMaterial): string => `core:zzzzzzmat_${name}`;

/**
 * `takes` multiplies a hit by its type, and a type not named does nothing: tools are melee, and nothing here takes a
 * pierce. `ram` is in joules, as a felled tree's work is. Concrete's is for a panel: a server spares what bears.
 * `heap` is what one half gives in all; the counts are a first guess.
 */
const ROWS: Readonly<Record<CityMaterial, Omit<MaterialDef, "type" | "id">>> = {
  concrete: { takes: { explosive: 2.33 }, health: 7800, ram: 1_500_000, heap: [{ item: "core:stone", count: 40 }, { item: "core:flint", count: 10 }, { item: "core:ore", count: 6 }] },
  block: { takes: { explosive: 3.5 }, health: 5000, ram: 180_000, heap: [{ item: "core:stone", count: 30 }] },
  steel: { takes: { explosive: 0.3 }, health: 12000, heap: [{ item: "core:ore", count: 30 }] },
  sheet: { takes: { melee: 0.25, explosive: 1.5 }, health: 1500, ram: 40_000, heap: [{ item: "core:ore", count: 8 }] },
  timber: { takes: { melee: 0.5, fire: 3, explosive: 1 }, health: 2500, ram: 30_000, heap: [{ item: "core:wood", count: 30 }] },
  tile: { takes: { melee: 0.3, fire: 0.5, explosive: 2.5 }, health: 3000, ram: 30_000, heap: [{ item: "core:stone", count: 12 }, { item: "core:wood", count: 15 }] },
  plaster: { takes: { melee: 0.5, bullet: 0.1, fire: 1, explosive: 4 }, health: 1200, ram: 15_000, heap: [{ item: "core:wood", count: 4 }] },
  glass: { takes: { melee: 1, bullet: 1, explosive: 6 }, health: 150, ram: 8000 },
};

export const CITY_MATERIALS: readonly MaterialDef[] = (Object.keys(ROWS) as CityMaterial[]).map((name) => ({ type: "material", id: cityMaterial(name), ...ROWS[name] }));

/** The health of the panes of one half of a glazed piece: the top slice of the piece's health, which goes first. */
export const PANE_HEALTH = ROWS.glass.health!;

/** Finishes that are painted steel, whatever their recipe. */
const STEEL = ["steel", "rust", "blue"], CONCRETE = ["concrete", "tar", "fracture"];

/**
 * What a piece of `family` in the finish named `finish`, of the recipe `made` if it has one, is built of. A partition or
 * a fixture is plaster whatever it is painted; clay on a pitched roof is tile on timber; a sheet recipe is sheet; and
 * every painted, stucco, render or block finish that is not steel or concrete is block.
 */
export function materialOf(family: Family, finish: string, made?: string): CityMaterial {
  if (family === "interior") return "plaster";
  if (family === "roof" && finish === "clay") return "tile";
  if (made === "corrugated" || made === "seam") return "sheet";
  if (STEEL.includes(finish)) return "steel";
  return CONCRETE.includes(finish) ? "concrete" : "block";
}

/** The health of a whole piece of `shape` and `size` (full metres) built of `material`: a half's, times its halves and its family's toughness. */
export function pieceHealth(material: CityMaterial, shape: string, size: readonly [number, number, number]): number {
  const { halves, tough } = shapeBreaks(shape, size);
  return ROWS[material].health! * halves * tough;
}
