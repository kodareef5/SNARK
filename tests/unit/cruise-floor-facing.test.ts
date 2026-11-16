// Collision support and closed-volume checks do not catch an individually reversed visible floor cap.
import { expect, test } from "bun:test";
import type { CruiseLayout } from "../../content/landmarks/cruise-layout.ts";
import { CRUISE_LAYOUT } from "../../content/landmarks/cruise.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { cruiseArt, cruiseArtSections, cruiseOwnerLod } from "../fixtures/cruise-art.ts";

test("delivered cruise floor caps face upward, with every authored top present throughout the textured near levels", () => {
  const layout: CruiseLayout = CRUISE_LAYOUT;
  const prototypes = new Map(layout.prototypes.map(p => [p.id, p]));
  const floors = layout.instances.filter(i => i.placed && prototypes.get(i.sourcePrototype ?? i.prototype)!.category === "floor");
  const tops = new Map(floors.map(instance => {
    const floor = prototypes.get(instance.sourcePrototype ?? instance.prototype)!;
    return [instance.id, [...new Set([...(floor.hulls ?? []).map(h => Math.max(...h.points.map(p => p[1]!))),
      ...(floor.boxes ?? []).map(b => b.at[1]! + b.half[1]!)])]] as const;
  }));
  expect(floors.length).toBeGreaterThan(0);
  const faults: string[] = [];
  for (let level = 0; level < 6; level++) {
    const area = new Map(floors.map(i => [i.id, tops.get(i.id)!.map(() => 0)]));
    for (const section of cruiseArtSections(level)) {
      if (section.prototype.category !== "floor") continue;
      const planes = tops.get(section.instance.id)!;
      const header = cruiseArt.pack.header.meshes[cruiseArt.pack.meshIndex.get(section.mesh)!]!;
      const tolerance = header.half[1] / 32767 + .000004;
      // Far structural unions use 5 mm authored planes. Check those as well as
      // the original plane, retaining the same native quantization tolerance.
      const originY = Math.round(section.instance.at[1]! * STRUCT_UNITS) / STRUCT_UNITS;
      const coarse = level >= 3 ? planes.map(y => Math.round((y + originY) * 200) / 200 - originY) : planes;
      const lod = cruiseOwnerLod(section), p = lod.positions;
      for (let i = 0; i < lod.indices.length; i += 3) {
        const a = lod.indices[i]! * 3, b = lod.indices[i + 1]! * 3, c = lod.indices[i + 2]! * 3;
        const top = planes.findIndex((y, plane) => [a,b,c].every(v => Math.abs(p[v + 1]! - y) <= tolerance) ||
          [a,b,c].every(v => Math.abs(p[v + 1]! - coarse[plane]!) <= tolerance));
        if (top < 0) continue;
        const ny = (p[b + 2]! - p[a + 2]!) * (p[c]! - p[a]!) - (p[b]! - p[a]!) * (p[c + 2]! - p[a + 2]!);
        if (ny < 0) faults.push(`${section.instance.id} L${level}: downward top cap`);
        else area.get(section.instance.id)![top]! += ny / 2;
      }
    }
    // Authored exterior-only far levels may omit hidden interior slabs. Their remaining caps must still face up.
    if (level < 2) for (const [id, values] of area) for (let i = 0; i < values.length; i++) {
      if (!(values[i]! > 0)) faults.push(`${id} L${level} Y${tops.get(id)![i]}: no upward floor area`);
    }
  }
  expect(faults.slice(0, 30)).toEqual([]);
});
