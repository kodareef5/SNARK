// Manual full-deck complement to the native room/route gate. Uses the same floor-only collision queries, never visual bounds.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { CRUISE_COLLISION_PROTOTYPES, CRUISE_LAYOUT } from "../../content/landmarks/cruise.ts";
import type { CruiseRoom } from "../../content/landmarks/cruise-layout.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { cruiseRoomFloors } from "../../tests/fixtures/cruise-floors.ts";
import { CRUISE_COURSE, cruiseCourse, cruiseWorldPoint } from "./course.ts";
import { assertCruiseMap } from "./preflight.ts";

export function auditCruiseDeckFloors() {
  const began = performance.now(), compiled = compileContent(CORE_CONTENT);
  if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
  const map = cruiseCourse(), reg = withContent(compiled.registry, map.content?.defs ?? []); assertCruiseMap(map, reg);
  const floors = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const kinds = new Set(CRUISE_COLLISION_PROTOTYPES.filter(p => p.category === "floor" || p.art?.kind === "floor").map(p => p.id));
  let expected = 0;
  for (const s of map.statics) if (kinds.has(s.kind)) { floors.add(reg.index.get(s.kind)!, s.x, s.y, s.z, s.yaw, 0, 10000); expected++; }
  if (floors.count !== expected) throw new Error(`floor placement lost ${expected - floors.count} rows`);
  const plans: CruiseRoom[] = CRUISE_LAYOUT.decks.map(d => {
    const points = d.outlines.flat();
    if (!points.length) throw new Error(`deck ${d.id} has no occupied outline`);
    return { id: `deck ${d.id}`, node: "", label: `deck ${d.id}`, deck: d.id, section: "all-deck-plan",
      bounds: { min: [Math.min(...points.map(p => p[0]!)), d.floorY, Math.min(...points.map(p => p[1]!))],
        max: [Math.max(...points.map(p => p[0]!)), d.floorY + 2.6, Math.max(...points.map(p => p[1]!))] },
      entry: [], routeTarget: [], footprint: { polygons: d.outlines, holes: d.voids.map(v => v.polygon) } };
  });
  const hf = new Heightfield(map.dims, TERRAIN_CELL, map.minY, map.stepY, map.heights, map.tint);
  const decks = cruiseRoomFloors({ hf, structs: floors }, plans, CRUISE_LAYOUT.decks, cruiseWorldPoint);
  const sources = ["content/landmarks/cruise-layout.json", "content/landmarks/cruise.ts", "content/landmarks/cruise-layout.ts",
    "tools/cruise/floors.ts", "tools/cruise/course.ts", "shared/world/landmark.ts", "shared/world/ray.ts", "shared/world/convex.ts",
    "shared/world/structures.ts", "shared/world/frame.ts", "tests/fixtures/cruise-floors.ts"];
  return { scope: "All authored deck outline polygons minus explicit voids; native floor-only vertical rays on <=0.5 m grid and polygon edges, 0.02 m boundary inset. Supplemental sampled coverage, not a proof of every interior point.",
    sources: Object.fromEntries(sources.map(path => [path, createHash("sha256").update(readFileSync(resolve(import.meta.dir, "../..", path))).digest("hex")])),
    placement: CRUISE_COURSE.vessel, floorInstances: floors.count, samples: decks.reduce((n, d) => n + d.samples, 0),
    missing: decks.reduce((n, d) => n + d.missing, 0), elapsedMs: performance.now() - began, decks };
}

if (import.meta.main) {
  const out = resolve(import.meta.dir, "../..", process.argv[2] ?? "var/cruise-preview/floors.json"), report = auditCruiseDeckFloors();
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ out, floorInstances: report.floorInstances, samples: report.samples, missing: report.missing, elapsedMs: report.elapsedMs }));
  if (report.missing || report.decks.some(d => !d.samples)) process.exitCode = 1;
}
