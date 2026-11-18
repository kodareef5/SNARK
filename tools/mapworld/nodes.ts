// What grows and lies where: three zoned layers (tools/map.ts), one of trees and plants, one of stones and one of the sea
// floor, each a picture of 4 m squares whose value names its zone. A square takes its zone from the ground at its middle and round it.

import { S, type Ground, type World } from "./ground.ts";
import type { Vocabulary } from "./ruin-vocabulary.ts";

export const ZONE_CELL = 4;

interface Zone {
  readonly name: string;
  readonly kinds: Record<string, number>;
  readonly bare: number;
}

/** Trees and plants. Young hardwoods are the common tree; figs and banyans break through the ruins. */
export const PLANTS: readonly Zone[] = [
  { name: "mangrove fringe", kinds: { "core:mangrove": 9, "core:fern": 1 }, bare: 4 },
  { name: "beach", kinds: { "core:palm": 3, "core:seagrape": 2, "core:palmetto": 1 }, bare: 26 },
  { name: "dune", kinds: { "core:palm": 4, "core:palmetto": 4, "core:seagrape": 4, "core:bush": 1 }, bare: 7 },
  { name: "hammock", kinds: { "core:tree": 7, "core:oak": 2, "core:fig": 2, "core:banyan": 1, "core:palm": 1, "core:fern": 3, "core:creeper": 2, "core:bush": 2 }, bare: 4 },
  { name: "old garden", kinds: { "core:tree": 4, "core:oak": 2, "core:palm": 3, "core:fig": 1, "core:bush": 2, "core:palmetto": 1, "core:fern": 1 }, bare: 7 },
  { name: "open ground", kinds: { "core:tree": 2, "core:palm": 1, "core:bush": 1, "core:creeper": 1, "core:fern": 1 }, bare: 22 },
  { name: "ruin", kinds: { "core:fig": 2, "core:banyan": 1, "core:tree": 1, "core:creeper": 3, "core:fern": 2 }, bare: 14 },
  { name: "marsh", kinds: { "core:mangrove": 3, "core:fern": 2, "core:palmetto": 1, "core:bush": 1 }, bare: 9 },
  { name: "yard", kinds: { "core:bush": 1, "core:creeper": 2 }, bare: 40 },
  { name: "street garden", kinds: { "core:palm": 1, "core:bush": 1, "core:fern": 2 }, bare: 45 },
  { name: "spill", kinds: { "core:creeper": 2, "core:fern": 1, "core:bush": 1, "core:tree": 1 }, bare: 18 },
  // Among the towers the ground was paved: palms that lined the avenues, and weeds in the cracks.
  { name: "plaza", kinds: { "core:palm": 2, "core:tree": 1, "core:bush": 1, "core:creeper": 1 }, bare: 36 },
  { name: "tower ruin", kinds: { "core:fig": 1, "core:creeper": 2, "core:fern": 1 }, bare: 28 },
  // A city park or a garden square gone wild, open enough to see the ruins round it.
  { name: "park", kinds: { "core:tree": 3, "core:oak": 2, "core:palm": 2, "core:fig": 1, "core:banyan": 1, "core:bush": 1, "core:fern": 1 }, bare: 14 },
  // Behind a beach: palms, sea grape and palmetto, low enough that the ruins behind show over them.
  { name: "coast park", kinds: { "core:palm": 5, "core:seagrape": 3, "core:palmetto": 2, "core:tree": 1, "core:bush": 1 }, bare: 12 },
];

/** Stones: limestone, the concrete of the ruins, and metal where the port, its yards and the wrecks are. */
export const STONES: readonly Zone[] = [
  { name: "rubble", kinds: { "core:rubble": 5, "core:rock": 1, "core:metal_rock": 1 }, bare: 9 },
  { name: "scrap", kinds: { "core:metal_rock": 4, "core:rubble": 3 }, bare: 7 },
  { name: "wreck", kinds: { "core:metal_rock": 8 }, bare: 1 },
  { name: "limestone", kinds: { "core:rock": 2 }, bare: 22 },
  { name: "shore stones", kinds: { "core:rock": 1 }, bare: 40 },
  { name: "street blocks", kinds: { "core:rubble": 1 }, bare: 36 },
];

/**
 * The sea floor: the stations wave's resources that grow under the sea (content/items/nodes.ts), a third layer so every
 * slot of the other two keeps its place. The reference game puts silica pearls' clams "in the deepest areas of the ocean",
 * oil's dark stones "all around the map in the oceans", and crystal under the sea as well as on mountains (Crystal, 180.0:
 * "New Mountain & Underwater Crystal"); so clams and crystal in the channels deeper than 7 m, oil rocks there and in the
 * deeps of 3 to 7 m, and nothing on the flats and shallows. A city map has no mountain or cave, so no obsidian rock grows
 * on it, and obsidian comes from its metal rocks; crystal only from the sea. The weights are chosen.
 */
export const SEA_FLOOR: readonly Zone[] = [
  { name: "channel", kinds: { "core:clam": 3, "core:oil_rock": 2, "core:crystal_rock": 1 }, bare: 26 },
  { name: "deep", kinds: { "core:oil_rock": 2, "core:clam": 1 }, bare: 33 },
];

export const PLANT_SLOTS = 160;
export const STONE_SLOTS = 64;
export const SEA_SLOTS = 16;

const zoneIndex = (list: readonly Zone[], name: string): number => list.findIndex((z) => z.name === name) + 1;

/** Districts whose woods are parks and squares among the ruins, not hammock. */
const URBAN = new Set(["concrete", "deco", "terracotta", "mural"]);

/** Each zone's picture, north up, a byte a square, and the layers that name them. `clear` is true where nothing may stand. */
export function makeNodes(ground: Ground, world: World, clear: (col: number, row: number) => boolean, low: (col: number, row: number) => boolean = () => false, growth?: Vocabulary["growth"]): { plants: Uint8Array; stones: Uint8Array; sea: Uint8Array; across: number; down: number; layers: unknown[] } {
  const { surface, height, shore } = ground;
  const { nx, nz, cell, noiseWest, noiseNorth } = ground.grid;
  const across = (nx - 1) / (ZONE_CELL / cell);
  const down = (nz - 1) / (ZONE_CELL / cell);
  const plants = new Uint8Array(across * down);
  const stones = new Uint8Array(across * down);
  const sea = new Uint8Array(across * down);
  const P = (name: string): number => zoneIndex(PLANTS, name);
  const T = (name: string): number => zoneIndex(STONES, name);
  const W = (name: string): number => zoneIndex(SEA_FLOOR, name);
  const styleAt = (i: number): string => world.districts[ground.district[i]! - 1]?.style ?? "";
  for (let py = 0; py < down; py++) {
    for (let px = 0; px < across; px++) {
      const col = px * 2 + 1;
      const row = py * 2 + 1;
      if (clear(col, row)) continue;
      const i = row * nx + col;
      const s = surface[i]!;
      const h = height[i]!;
      const industrial = styleAt(i) === "industrial" || (shore[i]! < 100 && [-32, 0, 32].some((dy) => [-32, 0, 32].some((dx) => row + dy >= 0 && row + dy < nz && col + dx >= 0 && col + dx < nx && styleAt((row + dy) * nx + col + dx) === "industrial")));
      const towers = (world.districts[ground.district[i]! - 1]?.tall ?? 0) >= 0.5;
      let plant = 0;
      let stone = 0;
      switch (s) {
        case S.MANGROVE:
          plant = P("mangrove fringe");
          break;
        case S.WET_SAND:
        case S.BEACH:
          plant = P("beach");
          stone = T("shore stones");
          break;
        case S.DUNE:
          plant = P("dune");
          stone = T("shore stones");
          break;
        case S.CANOPY:
          plant = shore[i]! < 30 && h < 1.4 ? P("mangrove fringe") : ground.sand[i]! < 150 ? P("coast park") : URBAN.has(styleAt(i)) ? P("park") : P("hammock");
          stone = T("limestone");
          break;
        case S.GREEN:
          plant = shore[i]! < 20 && h < 1.2 ? P("mangrove fringe") : ground.sand[i]! < 150 ? P("coast park") : P("old garden");
          stone = T("limestone");
          break;
        case S.OPEN:
        case S.COURT:
          plant = towers ? P("plaza") : P("open ground");
          stone = T("street blocks");
          break;
        // Desert takes the open ground's plants, as a city's growth sets them, and natural stone.
        case S.DESERT:
          plant = P("open ground");
          stone = T("limestone");
          break;
        case S.YARD:
          plant = P("yard");
          stone = T("scrap");
          break;
        case S.CONTAINER:
          stone = T("scrap");
          break;
        case S.MARSH:
          plant = P("marsh");
          break;
        case S.HEAP:
        case S.FLOOR:
          plant = industrial ? P("yard") : towers ? P("tower ruin") : P("ruin");
          stone = industrial ? T("scrap") : T("rubble");
          break;
        case S.SPILL:
          plant = P("spill");
          stone = industrial ? T("scrap") : T("rubble");
          break;
        case S.STREET:
        case S.HIGHWAY:
        case S.CROSSWALK:
        case S.SIDEWALK:
        case S.PLAZA:
        case S.LOT:
          if (growth && (Math.floor((col + noiseWest / cell) / 3) + Math.floor((row + noiseNorth / cell) / 3)) % 4 === 0) plant = P("street garden");
          stone = T("street blocks");
          break;
        case S.DECK:
          stone = T("scrap");
          break;
        case S.WRECK:
          stone = T("wreck");
          break;
      }
      // Industrial shore growth stays low enough to see the yards from the bay.
      if (industrial && plant) plant = P("yard");
      else if (low(col, row) && plant) plant = P(growth ? "yard" : "street garden");
      plants[py * across + px] = plant;
      stones[py * across + px] = stone;
      sea[py * across + px] = s === S.CHANNEL ? W("channel") : s === S.DEEP ? W("deep") : 0;
    }
  }
  const layer = (seed: number, perChunk: number, zones: readonly Zone[], picture: string): unknown => ({
    seed,
    perChunk,
    // A kind of no weight grows nowhere, and a file's zone names none.
    zones: zones.map((z) => ({ kinds: Object.fromEntries(Object.entries(growth?.zones[z.name]?.kinds ?? z.kinds).filter(([, weight]) => weight > 0)), bare: growth?.zones[z.name]?.bare ?? z.bare })),
    zone: picture,
  });
  return { plants, stones, sea, across, down, layers: [layer(0x4d1a, PLANT_SLOTS, PLANTS, "plants.png"), layer(0x4d1b, STONE_SLOTS, STONES, "stones.png"), layer(0x4d1c, SEA_SLOTS, SEA_FLOOR, "sea.png")] };
}
