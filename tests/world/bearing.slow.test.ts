// The support rule on every building of the built Miami as the map placed it. Needs var/maps/miami.snmap built with its
// buildings (or CITY_MAP naming one); without it these are skipped.

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { withContent } from "../../shared/content/registry.ts";
import { parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { bearingReport } from "../../tools/bearing.ts";
import { coreRegistry } from "../fixtures/world.ts";

const file = process.env.CITY_MAP ?? "var/maps/miami.snmap";

test.skipIf(!existsSync(file))("as placed, the rule leaves under 2% of Miami's pieces to its pins, and with them all stand", async () => {
  const map = parseMap(await Bun.file(file).bytes(), false);
  if (!map.buildings) return;
  const reg = withContent(coreRegistry(), map.content?.defs ?? []);
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  // The report throws if a building does not stand whole with its pins.
  const r = bearingReport(map.buildings, structs, reg);
  expect(r.buildings).toBeGreaterThan(100000);
  expect((r.all.hang + r.all.fall) / r.all.pieces).toBeLessThan(0.02);
  // Pieces with nothing under or beside them, which stand whatever falls: a few hundred in the city.
  expect(r.all.always / r.all.pieces).toBeLessThan(0.0005);
  // What a building is made of stands by the rule alone.
  for (const family of ["pier", "wall", "store"]) expect((r.families[family]!.hang + r.families[family]!.fall) / r.families[family]!.pieces).toBeLessThan(0.001);
  // The costliest building is judged in well under a tick.
  expect(r.mostOps).toBeLessThan(200000);
});
