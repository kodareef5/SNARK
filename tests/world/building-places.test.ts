// The check of a map's buildings against what its layouts knew (tools/mapworld/building-places.ts), on the built city.

import { expect, test } from "bun:test";
import { parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { decodeKnown, encodeKnown } from "../../tools/mapworld/buildings.ts";
import { PARTS, comparePlaces, partOf, placesLines } from "../../tools/mapworld/building-places.ts";
import { builtCity } from "../fixtures/buildings.ts";
import { coreRegistry } from "../fixtures/world.ts";

const city = builtCity();
const map = parseMap(writeMap(city.map));
const reg = coreRegistry();

test("every piece of the built city stands at the tile and storey its layout placed it at", () => {
  const r = comparePlaces(map.statics, map.buildings!, city.places, reg);
  const owned = city.of.filter((b) => b >= 0).length;
  expect([r.buildings, r.pieces, r.lost, PARTS.reduce((n, p) => n + r.parts[p].pieces, 0)]).toEqual([4, owned, 0, owned]);
  for (const p of PARTS) {
    const c = r.parts[p];
    // Every tile by its middle, edge or corner, and every storey by the piece's origin or its foot.
    expect([p, c.tiled - c.touch, c.pieces - c.foot]).toEqual([p, 0, 0]);
  }
  // A slab is its storey's lid by its origin alone; a wall stands on an edge, so its own tile is often the next one; a
  // pier of two storeys has its origin in the upper.
  const { slab, wall, pier, stairs } = r.parts;
  expect([slab.pieces > 80, slab.storey === slab.pieces, wall.tile < wall.tiled, pier.storey < pier.pieces, stairs.storey === stairs.pieces]).toEqual([true, true, true, true, true]);
  expect(r.examples.every((e) => e.why.includes("its foot"))).toBe(true);
  const lines = placesLines(r);
  expect([lines[0], lines.filter((l) => PARTS.some((p) => l.startsWith(p))).length, lines.some((l) => l.startsWith("all "))]).toEqual([`${owned} pieces of 4 buildings; 0 the build knew a building for and the map does not`, 8, true]);
});

test("a piece placed by another tile than it stands at is counted and shown", () => {
  const moved = decodeKnown(encodeKnown(city.places));
  expect(moved).toEqual(city.places);
  // The first slab the layouts placed by a tile, said to be three tiles along.
  let row = -1;
  for (let chunk = 0, r = 0; chunk < moved.counts.length; chunk++) {
    for (let slot = 0; slot < moved.counts[chunk]!; slot++, r++) {
      if (row < 0 && moved.i[r]! >= 0 && map.statics.kinds[map.statics.kind[map.statics.first[chunk]! + slot]!]!.includes("_floor8_")) row = r;
    }
  }
  moved.i[row] = moved.i[row]! + 3;
  moved.storey[row] = moved.storey[row]! + 2;
  const r = comparePlaces(map.statics, map.buildings!, moved, reg, 3);
  expect([r.parts.slab.tiled - r.parts.slab.under, r.parts.slab.pieces - r.parts.slab.foot]).toEqual([1, 1]);
  const shown = r.examples.find((e) => e.part === "slab")!;
  expect([shown.kind, shown.known[0], /^\d+\.\d m from its tile's middle$/.test(shown.why)]).toEqual(["core:zruin_floor8_concrete", moved.i[row], true]);
  expect(placesLines(r).some((l) => l.includes("floor8_concrete at") && l.includes(shown.why))).toBe(true);
});

test("a piece's part is its family's, a stair's its shape's, and what breaks as nothing is dressing", () => {
  expect(["floor8", "pier16", "wall4", "beam8", "fin4", "zpanel8", "zbalc", "zwin", "zcurt", "zdeck", "zparapet8", "zshaft8", "zclad4", "zpitch8", "flight", "landing", "rubble4", "zcounter", "plate30"].map((shape) => partOf(`core:zruin_${shape}_concrete`)))
    .toEqual(["slab", "pier", "wall", "wall", "wall", "wall", "facade module", "facade module", "facade module", "facade module", "facade module", "shell", "shell", "roof", "stairs", "stairs", "dressing", "dressing", "dressing"]);
});
