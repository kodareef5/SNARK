import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STREET_PIECES, streetKind } from "../../content/street.ts";
import { gridAt } from "../../tools/mapworld/base.ts";
import { meets, type Box } from "../../tools/mapworld/ruin-obstacles.ts";
import type { Site, StaticPiece } from "../../tools/mapworld/statics.ts";
import { placeRoofPlant, type Roofs } from "../../tools/mapworld/roof-plant.ts";

const RULES = (JSON.parse(readFileSync(join(import.meta.dir, "../../tools/mapworld/rules/default.json"), "utf8")) as { roofs: Roofs }).roofs;
const SIZE = 1024;
const site = (routes: Site["growthRoutes"] = []): Site => ({ ground: { grid: gridAt([-SIZE / 2, -SIZE / 2, SIZE / 2, SIZE / 2]) }, growthRoutes: routes } as unknown as Site);

// A block 32 m square of two storeys, its slabs 8 m tiles: the first floor's whole, the second's over its west half, so
// its roof is the second floor's top over the west half and the first's over the east. A core stands on the high roof.
const FLOOR = 3.4, slab = (x: number, z: number, y: number): StaticPiece => ({ kind: "core:zruin_floor8_concrete", x, y, z, yaw: 0 });
const block: StaticPiece[] = [];
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) block.push(slab(500 + i * 8, 500 + j * 8, FLOOR));
for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) block.push(slab(500 + i * 8, 500 + j * 8, 2 * FLOOR));
const core: StaticPiece = { kind: "core:zruin_zcore_concrete", x: 504, y: 2 * FLOOR + 0.2 + 2, z: 516, yaw: 0 };
const pieces = [...block, core];
const record = (height: number) => [{ id: 1, firstPiece: 0, blocks: block.length, height, yaw: 0 }];
const top = (y: number): number => y + 0.2;
const SIZES = new Map(STREET_PIECES.map((p) => [streetKind(p.name), p]));
const boxes = (p: StaticPiece): Box[] => SIZES.get(p.kind)!.boxes.map((b) => {
  const a = p.yaw * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: p.x + b.at[0] * c + b.at[2] * s, y: p.y + b.at[1], z: p.z - b.at[0] * s + b.at[2] * c, yaw: p.yaw, size: [b.half[0] * 2, b.half[1] * 2, b.half[2] * 2] };
});

test("a flat roof gets its plant: on its top, in from its rim, clear of what stands there, the same each time", () => {
  const { pieces: plant, summary } = placeRoofPlant(site(), pieces, record(12), RULES, 2000);
  expect(plant.length).toBeGreaterThan(3);
  expect(placeRoofPlant(site(), pieces, record(12), RULES, 2000).pieces).toEqual(plant);
  expect(summary.roofs).toBe(1);
  for (const p of plant) {
    // On the high roof's top over the west half, the low roof's over the east.
    expect([p.kind, p.y]).toEqual([p.kind, p.x < 512 ? top(2 * FLOOR) : top(FLOOR)]);
    // Wholly on the block, its rim kept, and nothing of it in the core or another piece of plant.
    for (const b of boxes(p)) {
      const reach = Math.hypot(b.size[0], b.size[2]) / 2;
      expect(Math.min(b.x - 496, b.z - 496, 528 - b.x, 528 - b.z) + reach).toBeGreaterThan(RULES.edge);
      expect(meets(b, { x: core.x, y: core.y, z: core.z, yaw: 0, size: [4, 4, 4] }, 0)).toBe(false);
    }
  }
  for (const [i, p] of plant.entries()) for (const q of plant.slice(i + 1)) expect(boxes(p).some((a) => boxes(q).some((b) => meets(a, b, 0)))).toBe(false);
});

test("a water tank stands only on a tall building, and a solar rack faces south", () => {
  const always = { ...RULES, plant: { ...RULES.plant, tank: { ...RULES.plant.tank!, chance: 1, least: 0 }, solar: { ...RULES.plant.solar!, chance: 1 } } };
  const low = placeRoofPlant(site(), pieces, record(8), always, 2000).pieces, tall = placeRoofPlant(site(), pieces, record(40), always, 2000).pieces;
  expect(low.some((p) => p.kind === streetKind("roof_tank"))).toBe(false);
  expect(tall.some((p) => p.kind === streetKind("roof_tank"))).toBe(true);
  const racks = tall.filter((p) => p.kind.startsWith(streetKind("roof_solar")));
  expect(racks.length).toBeGreaterThan(0);
  for (const p of racks) expect(p.yaw).toBe(0);
});

test("a chunk's budget and a reserved route keep plant off a roof", () => {
  expect(placeRoofPlant(site(), pieces, record(12), RULES, 0).pieces).toEqual([]);
  // A way across the whole of each roof, as a roof garden's path.
  const ways = [FLOOR, 2 * FLOOR].map((y) => ({ points: [{ x: 490, y: top(y), z: 516 }, { x: 540, y: top(y), z: 516 }], width: 40 }));
  expect(placeRoofPlant(site(ways), pieces, record(12), RULES, 2000).pieces).toEqual([]);
});
