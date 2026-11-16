// Closed surfaces can still have individual slab caps facing inward after touching islands are welded.
// Inspect the actual native indices: collision support and a whole-mesh signed-volume check miss this defect.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CRUISE_LAYOUT } from "../../content/landmarks/cruise.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";

test("every delivered cruise floor cap faces the visitor above it at all six levels", () => {
  const bytes = readFileSync(new URL("../../assets/source/core/landmarks/cruise/cruise.snpk", import.meta.url));
  const meshes = new Map(unpackMeshes(parsePack(bytes)).map(mesh => [mesh.id, mesh]));
  const floors = CRUISE_LAYOUT.prototypes.filter(p => p.category === "floor"), faults: string[] = [];
  expect(floors.length).toBeGreaterThan(0);
  for (const floor of floors) {
    const mesh = meshes.get(floor.mesh);
    if (!mesh || mesh.lods.length !== 6) { faults.push(`${floor.id}: missing six-level floor`); continue; }
    for (const [level, lod] of mesh.lods.entries()) {
      const p = lod.positions;
      let top = -Infinity, upArea = 0;
      for (let i = 1; i < p.length; i += 3) top = Math.max(top, p[i]!);
      for (let i = 0; i < lod.indices.length; i += 3) {
        const a = lod.indices[i]! * 3, b = lod.indices[i + 1]! * 3, c = lod.indices[i + 2]! * 3;
        // Equal source heights share one quantized native height. This only selects the cap;
        // it does not forgive downward winding or change any positional acceptance tolerance.
        if ([a, b, c].some(v => Math.abs(p[v + 1]! - top) > .00001)) continue;
        const ny = (p[b + 2]! - p[a + 2]!) * (p[c]! - p[a]!) - (p[b]! - p[a]!) * (p[c + 2]! - p[a + 2]!);
        if (ny < 0) faults.push(`${floor.id} L${level} triangle ${i / 3}: downward top cap`);
        else upArea += ny / 2;
      }
      if (!(upArea > 0)) faults.push(`${floor.id} L${level}: no upward floor area`);
    }
  }
  expect(faults).toEqual([]);
});
