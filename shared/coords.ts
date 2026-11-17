// World conventions. Every zone and every exported asset uses these.
//
//   Axes        right-handed, +Y up (same as glTF)
//   Units       metres, seconds, radians
//   Origin      a map corner: 0 <= x < sizeX, 0 <= z < sizeZ, sea level y = 0
//   Yaw         rotation about +Y; yaw 0 faces +Z; forward = (sin yaw, 0, cos yaw)
//   Right       forward x up = (-cos yaw, 0, sin yaw)
//   Pitch       positive looks up
//   Time        a tick number is the world clock

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

/**
 * Chunks a side of the fixed lattice every map sits on (262 km). Its columns count west as x does and its rows north as z
 * does, so a chunk's column and row on it do not change when its map is widened on any side.
 */
export const FRAME_CHUNKS = 4096;
/** Chunks a side of a sector, 1,024 m. A display origin is a lattice point on a sector's corner. */
export const SECTOR_CHUNKS = 16;
/** Where a map that does not say sits: its south-east corner in the middle of the lattice. */
export const FRAME_MIDDLE = FRAME_CHUNKS / 2;

/**
 * A map's extent in chunks, counted from its south-east corner, and where it sits on the lattice. A place's displayed
 * coordinate, in units of 102.4 m, is (originX - frameX - x / 64) * 0.625 east of the display origin and
 * (originZ - frameZ - z / 64) * 0.625 south of it. Without them, a map is at FRAME_MIDDLE and its origin is the default
 * (`framed`).
 */
export interface MapDims {
  readonly chunksX: number;
  readonly chunksZ: number;
  /** The lattice column and row of the extent's south-east corner, where x = 0 and z = 0. */
  readonly frameX?: number;
  readonly frameZ?: number;
  /**
   * The display origin, 0,0 of the coordinates players read: the lattice point at the north-west corner of the ground the
   * map is expected ever to cover, on a sector's corner, so at or west of frameX + chunksX and at or north of frameZ + chunksZ.
   */
  readonly originX?: number;
  readonly originZ?: number;
}

/** A MapDims that says where it sits: a map file's always does. */
export type FramedDims = Required<MapDims>;

/**
 * `d` with its frame and display origin, the defaults where it gives none: the south-east corner at FRAME_MIDDLE, and the
 * origin the nearest sector corner at or beyond the extent's north-west corner.
 */
export function framed(d: MapDims): FramedDims {
  if (d.frameX !== undefined && d.frameZ !== undefined && d.originX !== undefined && d.originZ !== undefined) return d as FramedDims;
  const frameX = d.frameX ?? FRAME_MIDDLE;
  const frameZ = d.frameZ ?? FRAME_MIDDLE;
  return {
    chunksX: d.chunksX,
    chunksZ: d.chunksZ,
    frameX,
    frameZ,
    originX: d.originX ?? Math.ceil((frameX + d.chunksX) / SECTOR_CHUNKS) * SECTOR_CHUNKS,
    originZ: d.originZ ?? Math.ceil((frameZ + d.chunksZ) / SECTOR_CHUNKS) * SECTOR_CHUNKS,
  };
}

/** The chunk's frame key: its row on the lattice times FRAME_CHUNKS plus its column, below 2^24. */
export function frameKey(d: MapDims, chunk: number): number {
  return ((d.frameZ ?? FRAME_MIDDLE) + chunkCz(d, chunk)) * FRAME_CHUNKS + (d.frameX ?? FRAME_MIDDLE) + chunkCx(d, chunk);
}

/** The chunk whose frame key is `key`, or -1 if it is outside the map. */
export function chunkOfKey(d: MapDims, key: number): number {
  const cx = (key % FRAME_CHUNKS) - (d.frameX ?? FRAME_MIDDLE);
  const cz = Math.floor(key / FRAME_CHUNKS) - (d.frameZ ?? FRAME_MIDDLE);
  return key >= 0 && key < FRAME_CHUNKS * FRAME_CHUNKS && cx >= 0 && cx < d.chunksX && cz >= 0 && cz < d.chunksZ ? cz * d.chunksX + cx : -1;
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

/** Positions outside the map clamp to the edge chunk. */
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
