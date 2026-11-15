// What grows and lies where: two zoned layers (tools/map.ts), one of trees and plants and one of stones, each a picture of
// 4 m squares whose value names its zone. A square takes its zone from the ground at its middle and round it.

import { S, type Ground, type World } from "./ground.ts";

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
  { name: "yard", kinds: { "core:tree": 1, "core:bush": 1, "core:creeper": 1 }, bare: 26 },
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

export const PLANT_SLOTS = 160;
export const STONE_SLOTS = 64;

const zoneIndex = (list: readonly Zone[], name: string): number => list.findIndex((z) => z.name === name) + 1;

/** Districts whose woods are parks and squares among the ruins, not hammock. */
const URBAN = new Set(["concrete", "deco", "terracotta", "mural"]);

/** Each zone's picture, north up, a byte a square, and the layers that name them. `clear` is true where nothing may stand. */
export function makeNodes(ground: Ground, world: World, clear: (col: number, row: number) => boolean): { plants: Uint8Array; stones: Uint8Array; side: number; layers: unknown[] } {
  const { n, surface, height, shore, heaps } = ground;
  const side = (n - 1) / (ZONE_CELL / 2);
  const plants = new Uint8Array(side * side);
  const stones = new Uint8Array(side * side);
  const P = (name: string): number => zoneIndex(PLANTS, name);
  const T = (name: string): number => zoneIndex(STONES, name);
  const styleAt = (i: number): string => world.districts[ground.district[i]! - 1]?.style ?? "";
  for (let py = 0; py < side; py++) {
    for (let px = 0; px < side; px++) {
      const col = px * 2 + 1;
      const row = py * 2 + 1;
      if (clear(col, row)) continue;
      const i = row * n + col;
      const s = surface[i]!;
      const h = height[i]!;
      const industrial = styleAt(i) === "industrial";
      const towers = (world.districts[ground.district[i]! - 1]?.tall ?? 0) >= 0.5;
      const ruin = heaps.owner[i]!;
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
          stone = T("street blocks");
          break;
        case S.DECK:
          stone = T("scrap");
          break;
        case S.WRECK:
          stone = T("wreck");
          break;
      }
      // A ruin's heap in a garden district grows over more readily than one downtown.
      if (ruin >= 0 && plant === P("ruin") && heaps.ruins[ruin]!.crest < 3) plant = P("old garden");
      plants[py * side + px] = plant;
      stones[py * side + px] = stone;
    }
  }
  const layer = (seed: number, perChunk: number, zones: readonly Zone[], picture: string): unknown => ({
    seed,
    perChunk,
    zones: zones.map((z) => ({ kinds: z.kinds, bare: z.bare })),
    zone: picture,
  });
  return { plants, stones, side, layers: [layer(0x4d1a, PLANT_SLOTS, PLANTS, "plants.png"), layer(0x4d1b, STONE_SLOTS, STONES, "stones.png")] };
}
