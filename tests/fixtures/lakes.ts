import { CHUNK_SIZE } from "../../shared/coords.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { MapData } from "../../shared/world/mapfile.ts";
import { MapWater } from "../../shared/world/water.ts";

/**
 * A map of 4 by 4 chunks, the sea in its south, with water standing above it: a pond on a terrace 20 m up, a pond 1.5 m up
 * whose bed goes under the sea's level, and a channel of two reaches, the upper 0.5 m over the lower, between them a step
 * in the water and none in the bed. Ground is 2 m up where nothing else is said. Squares of 2 m.
 */
export const LAKES = {
  sea: 0,
  /** On a terrace 20 m up, ramped from the north of the plain: its middle, radius and surface. */
  high: { x: 190, z: 190, r: 30, surface: 20 },
  low: { x: 70, z: 170, r: 25, surface: 1.5 },
  /** The channel runs along x at z, half `width` wide, its bed at `bed`; the upper reach is x < `step`. */
  river: { z: 80, width: 8, from: 16, to: 124, step: 70, bed: -1, upper: 1.75, lower: 1.25 },
  /** On the plain between the channel and the ponds. */
  spawn: { x: 128, z: 110 },
  cell: 2,
} as const;

const MIN_Y = -32;
const STEP_Y = 1 / 256;
const CHUNKS = 4;

/** The ground of the lakes map at (x, z). */
export function lakesGround(x: number, z: number): number {
  const { high, low, river } = LAKES;
  // The sea in the south: from 2 m at z = 60 down to -4 m at the edge.
  let h = z < 60 ? -4 + (z / 60) * 6 : 2;
  // The terrace: 20.5 m over x 140 to 240, z 150 to 240, ramped down to the plain over z 110 to 150.
  if (x >= 140 && x <= 240 && z >= 110 && z <= 240) h = Math.max(h, z >= 150 ? 20.5 : 2 + ((z - 110) / 40) * 18.5);
  const dh = Math.hypot(x - high.x, z - high.z);
  if (dh < high.r) h = high.surface - Math.min(4, 0.3 + (high.r - dh) * 0.2);
  const dl = Math.hypot(x - low.x, z - low.z);
  if (dl < low.r) h = low.surface - Math.min(3, 0.3 + (low.r - dl) * 0.2);
  if (Math.abs(z - river.z) < river.width && x >= river.from && x <= river.to) h = river.bed;
  return h;
}

/** The lakes map's water: the body number of each 2 m square by where its middle is. */
export function lakesWater(): MapWater {
  const { high, low, river, cell } = LAKES;
  const side = (CHUNKS * CHUNK_SIZE) / cell;
  const grid = new Uint16Array(side * side);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const [x, z] = [(i + 0.5) * cell, (j + 0.5) * cell];
      let b = 0;
      // Each pond's squares reach a square past its rim, onto ground above its surface.
      if (Math.hypot(x - high.x, z - high.z) < high.r + cell) b = 1;
      else if (Math.hypot(x - low.x, z - low.z) < low.r + cell) b = 2;
      else if (Math.abs(z - river.z) < river.width + cell && x >= river.from - cell && x <= river.to + cell) b = x < river.step ? 3 : 4;
      grid[j * side + i] = b;
    }
  }
  const level = (m: number): number => Math.round((m - MIN_Y) / STEP_Y);
  const bodies = [
    { name: "High Pond", level: level(high.surface) },
    { name: "Low Pond", level: level(low.surface) },
    { name: "Channel", level: level(river.upper) },
    { name: "Channel", level: level(river.lower) },
  ];
  return MapWater.fromGrid({ chunksX: CHUNKS, chunksZ: CHUNKS }, MIN_Y, STEP_Y, cell, bodies, grid);
}

/** The lakes map, to write as a file. */
export function lakesMap(): MapData {
  const n = (CHUNKS * CHUNK_SIZE) / TERRAIN_CELL + 1;
  const heights = new Uint16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = Math.round((lakesGround(i * TERRAIN_CELL, j * TERRAIN_CELL) - MIN_Y) / STEP_Y);
  return {
    id: "test:lakes",
    dims: { chunksX: CHUNKS, chunksZ: CHUNKS },
    minY: MIN_Y,
    stepY: STEP_Y,
    seaLevel: LAKES.sea,
    heights,
    tint: new Uint8Array(n * n).fill(1),
    statics: [],
    nodes: [],
    spawns: [{ name: "Plain", x: LAKES.spawn.x, z: LAKES.spawn.z, yaw: 0 }],
    water: lakesWater(),
  };
}
