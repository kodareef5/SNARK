// Authoring checks for the complete port, including the comparison vessel and quay.
import type { Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, MAX_CHUNKS_PER_AXIS, STRUCT_UNITS, WORLD_MAX_Y, WORLD_MIN_Y, YAW_UNITS, chunkAt } from "../../shared/coords.ts";
import type { MapData } from "../../shared/world/mapfile.ts";
import { MAX_SLOTS_PER_CHUNK, type StructureStore } from "../../shared/world/structures.ts";

type StaticMap = Pick<MapData, "id" | "dims" | "statics">;
export interface CruiseMapReport {
  readonly statics: number;
  readonly kinds: number;
  readonly occupiedChunks: number;
  readonly mostInChunk: number;
  readonly faults: readonly string[];
}

/** Linear preflight uses the same rounded origins and chunk limits as native placement. No rows are silently dropped. */
export function cruiseMapPreflight(map: StaticMap, reg?: Registry): CruiseMapReport {
  const faults: string[] = [], kinds = new Set<string>(), placements = new Map<string, number>();
  const { chunksX, chunksZ } = map.dims;
  if (![chunksX, chunksZ].every(n => Number.isInteger(n) && n >= 1 && n <= MAX_CHUNKS_PER_AXIS)) {
    return { statics: map.statics.length, kinds: 0, occupiedChunks: 0, mostInChunk: 0, faults: ["invalid map dimensions"] };
  }
  const counts = new Uint32Array(chunksX * chunksZ);
  let row = 0, occupiedChunks = 0, mostInChunk = 0;
  for (const s of map.statics) {
    const label = `static ${row} (${s.kind})`;
    kinds.add(s.kind);
    const [x, y, z] = [s.x, s.y, s.z].map(v => Math.round(v * STRUCT_UNITS));
    if (![s.x, s.y, s.z].every(Number.isFinite) || x! < 0 || x! >= chunksX * CHUNK_SIZE * STRUCT_UNITS ||
      z! < 0 || z! >= chunksZ * CHUNK_SIZE * STRUCT_UNITS || y! < WORLD_MIN_Y * STRUCT_UNITS || y! > WORLD_MAX_Y * STRUCT_UNITS) {
      faults.push(`${label}: non-finite or out-of-map origin after lattice rounding`);
    } else {
      const c = chunkAt(map.dims, x! / STRUCT_UNITS, z! / STRUCT_UNITS);
      if (counts[c] === 0) occupiedChunks++;
      const count = ++counts[c]!;
      mostInChunk = Math.max(mostInChunk, count);
      if (count === MAX_SLOTS_PER_CHUNK + 1) faults.push(`chunk ${c}: exceeds ${MAX_SLOTS_PER_CHUNK} native structure slots`);
    }
    if (!Number.isInteger(s.yaw) || s.yaw < 0 || s.yaw >= YAW_UNITS) faults.push(`${label}: yaw must be a native unsigned turn`);
    const kind = reg?.index.get(s.kind), def = kind === undefined ? undefined : reg?.defs[kind];
    if (reg && (def?.type !== "structure" || !(reg.halfX[kind!]! > 0))) faults.push(`${label}: not a registered structure`);
    // Opposite states of one public door have the same origin/yaw. Placing both is also a duplicate.
    const family = def?.type === "structure" && def.opens ? [s.kind, def.opens].sort()[0]! : s.kind;
    const key = `${family}|${x},${y},${z}|${s.yaw}`;
    const earlier = placements.get(key);
    if (earlier !== undefined) faults.push(`${label}: duplicates placement or door state of static ${earlier}`);
    else placements.set(key, row);
    row++;
  }
  if (kinds.size > 65535) faults.push("static kind dictionary exceeds the native 16-bit limit");
  return { statics: row, kinds: kinds.size, occupiedChunks, mostInChunk, faults };
}

export function assertCruiseMap(map: StaticMap, reg?: Registry): CruiseMapReport {
  const report = cruiseMapPreflight(map, reg);
  if (report.faults.length) throw new Error(`${map.id}: ${report.faults.join("; ")}`);
  return report;
}

/** Verify a freshly placed complete map, returning each authored map row's actual persistent ref. */
export function assertCruisePlaced(map: StaticMap, structs: StructureStore, reg: Registry): Uint32Array {
  assertCruiseMap(map, reg);
  if (structs.count !== map.statics.length) throw new Error(`${map.id}: placed ${structs.count} of ${map.statics.length} static instances`);
  const slots = new Uint32Array(map.dims.chunksX * map.dims.chunksZ), refs = new Uint32Array(map.statics.length);
  let row = 0;
  for (const s of map.statics) {
    const [x, y, z] = [s.x, s.y, s.z].map(v => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS);
    const c = chunkAt(map.dims, x!, z!), slot = slots[c]!++, t = structs.chunks[c];
    if (!t || t.kind[slot] !== reg.index.get(s.kind) || t.x[slot] !== x || t.y[slot] !== y || t.z[slot] !== z || t.yaw[slot] !== s.yaw) {
      throw new Error(`${map.id}: static ${row} did not retain its authored kind, transform and slot`);
    }
    refs[row++] = c * 65536 + slot;
  }
  return refs;
}
