// Collision support and closed-volume checks do not catch an individually reversed visible floor cap.
import { expect } from "bun:test";
import { test } from "../fixtures/needs-art.ts";
import type { CruiseLayout } from "../../content/landmarks/cruise-layout.ts";
import { CRUISE_LAYOUT } from "../../content/landmarks/cruise.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { cruiseArt, cruiseArtSections, cruiseOwnerLod } from "../fixtures/cruise-art.ts";

test("delivered cruise floor caps face upward, with every authored top present throughout the textured near levels", () => {
  const layout: CruiseLayout = CRUISE_LAYOUT;
  const prototypes = new Map(layout.prototypes.map(p => [p.id, p]));
  const floors = layout.instances.filter(i => i.placed && prototypes.get(i.sourcePrototype ?? i.prototype)!.category === "floor");
  const slabs = new Map(floors.map(instance => {
    const floor = prototypes.get(instance.sourcePrototype ?? instance.prototype)!;
    return [instance.id, [...(floor.hulls ?? []).map(h => [Math.min(...h.points.map(p => p[1]!)), Math.max(...h.points.map(p => p[1]!))]),
      ...(floor.boxes ?? []).map(b => [b.at[1]! - b.half[1]!, b.at[1]! + b.half[1]!])]] as const;
  }));
  const tops = new Map([...slabs].map(([id, parts]) => [id, [...new Set(parts.map(p => p[1]!))]]));
  expect(floors.length).toBeGreaterThan(0);
  const faults: string[] = [];
  for (let level = 0; level < 6; level++) {
    const area = new Map(floors.map(i => [i.id, tops.get(i.id)!.map(() => 0)]));
    const sheets = new Map<string, { up: number; down: number }>();
    for (const section of cruiseArtSections(level)) {
      if (section.prototype.category !== "floor") continue;
      const planes = tops.get(section.instance.id)!;
      const header = cruiseArt.pack.header.meshes[cruiseArt.pack.meshIndex.get(section.mesh)!]!;
      const tolerance = header.half[1] / 32767 + .000004;
      // Far structural unions use 5 mm authored planes. Check those as well as
      // the original plane, retaining the same native quantization tolerance.
      const originY = Math.round(section.instance.at[1]! * STRUCT_UNITS) / STRUCT_UNITS;
      const coarse = level >= 3 ? planes.map(y => Math.round((y + originY) * 200) / 200 - originY) : planes;
      const middle = level >= 4 ? slabs.get(section.instance.id)!.map(([low, high]) =>
        (Math.round((low! + originY) * 200) + Math.round((high! + originY) * 200)) / 400 - originY) : [];
      const lod = cruiseOwnerLod(section), p = lod.positions;
      for (let i = 0; i < lod.indices.length; i += 3) {
        const a = lod.indices[i]! * 3, b = lod.indices[i + 1]! * 3, c = lod.indices[i + 2]! * 3;
        const ny = (p[b + 2]! - p[a + 2]!) * (p[c]! - p[a]!) - (p[b]! - p[a]!) * (p[c + 2]! - p[a + 2]!);
        const mid = middle.findIndex(y => [a,b,c].every(v => Math.abs(p[v + 1]! - y) <= tolerance));
        if (mid >= 0) {
          // The source's24cm slabs retain both sides at their explicit midpoint
          // from500m. Neither upward-only nor downward-only sheets are valid.
          const key = `${section.mesh}/${Math.round((middle[mid]! + originY) * 400)}`;
          const pair = sheets.get(key) ?? { up: 0, down: 0 };
          if (ny > 0) pair.up += ny / 2; else pair.down -= ny / 2;
          sheets.set(key, pair); continue;
        }
        const top = planes.findIndex((y, plane) => [a,b,c].every(v => Math.abs(p[v + 1]! - y) <= tolerance) ||
          [a,b,c].every(v => Math.abs(p[v + 1]! - coarse[plane]!) <= tolerance));
        if (top < 0) continue;
        if (ny < 0) faults.push(`${section.instance.id} L${level}: downward top cap`);
        else area.get(section.instance.id)![top]! += ny / 2;
      }
    }
    if (level >= 4) {
      if (!sheets.size) faults.push(`L${level}: no paired floor midplanes`);
      for (const [key, pair] of sheets) if (!(pair.up > 0 && pair.down > 0) || Math.abs(pair.up - pair.down) > Math.max(1e-5, pair.up * 1e-6))
        faults.push(`${key} L${level}: floor sheet lacks matching upward/downward area`);
    }
    // Merged distant polygons may share one original owner. Near stages retain
    // every original top; distant solid caps and paired sheets are checked above.
    if (level < 2) for (const [id, values] of area) for (let i = 0; i < values.length; i++) {
      if (!(values[i]! > 0)) faults.push(`${id} L${level} Y${tops.get(id)![i]}: no upward floor area`);
    }
  }
  expect(faults.slice(0, 30)).toEqual([]);
});
