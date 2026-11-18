// Check emitter-recorded dry road entrances against the exact packed terrain and collision pieces.
import { readFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { mapHeightfield, parseMap, placeStatics, type MapFile } from "../../shared/world/mapfile.ts";
import { castWorld, HIT_NONE, HIT_STRUCTURE, HIT_TERRAIN, rayHit } from "../../shared/world/ray.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { RoadEntrance } from "./bridge-earthwork.ts";

export interface EntranceReport { mapHash: number; entrances: (RoadEntrance & { id: number; name: string | null })[]; }

export function checkBridgeEntrances(file: string, reportFile = file.replace(/\.snmap$/, ".entrances.json")) {
  const map = parseMap(readFileSync(file), false), report = JSON.parse(readFileSync(reportFile, "utf8")) as EntranceReport;
  return evaluateBridgeEntrances(map, report);
}

export function evaluateBridgeEntrances(map: MapFile, report: EntranceReport) {
  if (report.mapHash !== map.hash) throw new Error(`Entrance metadata belongs to map ${report.mapHash}, not ${map.hash}`);
  const compiled = compileContent([...CORE_CONTENT, ...(map.content?.defs ?? [])]);
  if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
  const reg = compiled.registry, hf = mapHeightfield(map);
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const world = { hf, structs };
  const results = report.entrances.map(e => {
    const tracks = [-1.5, 0, 1.5].map(side => {
      let previous = { height: NaN, type: HIT_NONE, road: false }, transitions = 0, largest = 0, biggestOther = 0;
      const edges: { along: number; rise: number; from: string }[] = [];
      for (let step = 0; step <= 2000; step++) {
        const along = -8 + step * .01, x = e.x + e.dx * along - e.dz * side, z = e.z + e.dz * along + e.dx * side;
        const type = castWorld(world, x, e.y + 4, z, 0, -1, 0, 10, true), height = type === HIT_NONE ? NaN : e.y + 4 - rayHit.t;
        const ref = rayHit.ref, chunk = structs.chunks[Math.floor(ref / 65536)], kind = type === HIT_STRUCTURE ? reg.ids[chunk!.kind[ref & 65535]!]! : "";
        // Flat terminal slabs count too; the old cluster probe omitted them and stopped at the first edge.
        const road = type === HIT_STRUCTURE && e.slabs.some(p => p.kind === kind && Math.abs(p.x - chunk!.x[ref & 65535]!) < .01 && Math.abs(p.z - chunk!.z[ref & 65535]!) < .01 && Math.abs(p.y - chunk!.y[ref & 65535]!) < .01);
        if (Number.isFinite(previous.height) && Number.isFinite(height) && road && !previous.road) {
          const rise = height - previous.height;
          edges.push({ along: Number(along.toFixed(2)), rise, from: previous.type === HIT_TERRAIN ? "terrain" : "structure" });
          if (previous.type === HIT_TERRAIN) { largest = Math.max(largest, rise); transitions++; }
          else biggestOther = Math.max(biggestOther, rise);
        }
        previous = { height, type, road };
      }
      return { side, transitions, largest, biggestOther, edges };
    });
    return { id: e.id, name: e.name, x: e.x, z: e.z, tracks, largest: Math.max(...tracks.map(t => t.largest)) };
  });
  const largest = Math.max(0, ...results.map(r => r.largest)), failed = results.filter(r => r.largest > .05);
  return { mapHash: map.hash, entrances: results.length, tracks: results.length * 3, transitions: results.reduce((n, r) => n + r.tracks.reduce((n, t) => n + t.transitions, 0), 0), largest, failed: failed.length, results };
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: bun tools/mapworld/bridge-entrances.ts <file.snmap> [matching.entrances.json]");
  const result = checkBridgeEntrances(file, process.argv[3]);
  console.log(JSON.stringify(result, null, 2));
  if (result.failed) process.exitCode = 1;
}
