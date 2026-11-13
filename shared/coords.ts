// World conventions. Every zone and every exported asset uses these.
//
//   Axes        right-handed, +Y up (same as glTF)
//   Units       metres, seconds, radians
//   Origin      a map corner: 0 <= x < sizeX, 0 <= z < sizeZ, sea level y = 0
//   Yaw         rotation about +Y; yaw 0 faces +Z; forward = (sin yaw, 0, cos yaw)
//   Right       forward x up = (-cos yaw, 0, sin yaw)
//   Pitch       positive looks up
//   Chunks      64 m squares, index = cz * chunksX + cx
//   Time        fixed 30 Hz simulation step; a tick number is the world clock

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export const CHUNK_SIZE = 64;
export const MAX_CHUNKS_PER_AXIS = 256;

export const WORLD_MIN_Y = -1024;
export const WORLD_MAX_Y = 3072;

/** Structures sit on a 1/512 m lattice, which float32 holds exactly up to 16 km. */
export const STRUCT_UNITS = 512;
/** Stored yaw steps per full turn. */
export const YAW_UNITS = 65536;

export interface MapDims {
  readonly chunksX: number;
  readonly chunksZ: number;
}

export function mapSizeX(d: MapDims): number {
  return d.chunksX * CHUNK_SIZE;
}

export function mapSizeZ(d: MapDims): number {
  return d.chunksZ * CHUNK_SIZE;
}

export function chunkCount(d: MapDims): number {
  return d.chunksX * d.chunksZ;
}

/** Chunk containing (x, z). Positions outside the map clamp to the edge chunk. */
export function chunkAt(d: MapDims, x: number, z: number): number {
  let cx = Math.floor(x / CHUNK_SIZE);
  let cz = Math.floor(z / CHUNK_SIZE);
  if (cx < 0) cx = 0;
  else if (cx >= d.chunksX) cx = d.chunksX - 1;
  if (cz < 0) cz = 0;
  else if (cz >= d.chunksZ) cz = d.chunksZ - 1;
  return cz * d.chunksX + cx;
}

export function chunkCx(d: MapDims, chunk: number): number {
  return chunk % d.chunksX;
}

export function chunkCz(d: MapDims, chunk: number): number {
  return Math.floor(chunk / d.chunksX);
}
