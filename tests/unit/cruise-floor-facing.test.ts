// Closed surfaces can still have individual slab caps facing inward after touching islands are welded.
// Inspect the actual native indices: collision support and a whole-mesh signed-volume check miss this defect.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CRUISE_LAYOUT } from "../../content/landmarks/cruise.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";

test("every delivered cruise floor cap faces the visitor above it at all six levels", () => {
  const bytes = readFileSync(new URL("../../assets/source/core/landmarks/cruise/cruise.snpk", import.meta.url));
  const pack = parsePack(bytes), meshes = new Map(unpackMeshes(pack).map(mesh => [mesh.id, mesh]));
  const headers = new Map(pack.header.meshes.map(mesh => [mesh.id, mesh]));
  const floors = CRUISE_LAYOUT.prototypes.filter(p => p.category === "floor"), faults: string[] = [];
  expect(floors.length).toBeGreaterThan(0);
  for (const floor of floors) {
    const mesh = meshes.get(floor.mesh);
    if (!mesh || mesh.lods.length !== 6) { faults.push(`${floor.id}: missing six-level floor`); continue; }
    // A bounded native module can contain several decks. Every authored top plane
    // must face upward, including caps hidden below the module's highest surface.
    const tops = [...new Set([...floor.hulls.map(h => Math.max(...h.points.map(p => p[1]!))),
      ...floor.boxes.map(b => b.at[1]! + b.half[1]!)])];
    // One native signed-normalized quantization step plus float32 coordinate rounding.
    const tolerance = headers.get(floor.mesh)!.half[1] / 32767 + .000004;
    for (const [level, lod] of mesh.lods.entries()) {
      const p = lod.positions;
      const upArea = tops.map(() => 0);
      for (let i = 0; i < lod.indices.length; i += 3) {
        const a = lod.indices[i]! * 3, b = lod.indices[i + 1]! * 3, c = lod.indices[i + 2]! * 3;
        const top = tops.findIndex(y => [a, b, c].every(v => Math.abs(p[v + 1]! - y) <= tolerance));
        if (top < 0) continue;
        const ny = (p[b + 2]! - p[a + 2]!) * (p[c]! - p[a]!) - (p[b]! - p[a]!) * (p[c + 2]! - p[a + 2]!);
        if (ny < 0) faults.push(`${floor.id} L${level} triangle ${i / 3}: downward top cap`);
        else upArea[top]! += ny / 2;
      }
      for (let i = 0; i < tops.length; i++) if (!(upArea[i]! > 0)) faults.push(`${floor.id} L${level} Y${tops[i]}: no upward floor area`);
    }
  }
  expect(faults).toEqual([]);
});
