import { CHUNK_SIZE } from "../../shared/coords.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { MapData } from "../../shared/world/mapfile.ts";

/** Flat ground at y = 0, `chunks` on a side, with one spawn point in the middle and no water. */
export function flatMap(chunks = 4, more: Partial<MapData> = {}): MapData {
  const side = (chunks * CHUNK_SIZE) / TERRAIN_CELL + 1;
  return {
    id: "test:flat",
    dims: { chunksX: chunks, chunksZ: chunks },
    minY: -32,
    stepY: 1 / 256,
    seaLevel: -Infinity,
    heights: new Uint16Array(side * side).fill(32 * 256),
    tint: new Uint8Array(side * side).fill(1),
    statics: [],
    nodes: [],
    spawns: [{ name: "Middle", x: (chunks * CHUNK_SIZE) / 2, z: (chunks * CHUNK_SIZE) / 2, yaw: 0 }],
    ...more,
  };
}
