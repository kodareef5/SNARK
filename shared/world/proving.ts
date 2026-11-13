// The proving ground: a graybox test map built from code.
//
// A flat checkered plaza with slope strips at fixed angles, a hill, a bowl, a
// staircase, a small house, a long thin wall, pillars, crates and distance
// markers, surrounded by rolling ground. Each feature exists to exercise one
// engine behaviour, so the server, the tests, the headless rasterizer and the
// browser probe all load this same world.
//
// It is generated, not stored: the same code yields the same map everywhere.

import type { MapDims } from "../coords.ts";
import type { Registry } from "../content/registry.ts";
import { hashBytes } from "../hash.ts";
import { Rng } from "../rng.ts";
import { Heightfield, TERRAIN_CELL } from "./heightfield.ts";
import { scatterNodes, type NodeSource } from "./nodes.ts";
import type { StructureStore } from "./structures.ts";

export const PROVING_ID = "proving:1";
export const PROVING_DIMS: MapDims = { chunksX: 8, chunksZ: 8 };
export const PROVING_SPAWN = { x: 256, z: 240, yaw: 0 };
/** Where a dead survivor may return. */
export const PROVING_SPAWNS = [
  { name: "Plaza", ...PROVING_SPAWN },
  { name: "Slopes", x: 228, z: 282, yaw: 0 },
  { name: "Poolside", x: 208, z: 256, yaw: 49152 },
];
/** Where the boot probe stands one creature: in clear view of the spawn point, hiding nothing else it checks. */
/** Half a metre below the plaza, so the bowl is a pool and low ground beyond the plaza holds ponds. */
export const PROVING_SEA_LEVEL = -0.5;
/** Centre of the bowl: 8 m deep, the place to swim and to drown. */
export const PROVING_POOL = { x: 172, z: 256 };
/**
 * Where the probe server stands its one creature, and the colour it gives the
 * creature's first region: not the species' own, so seeing it proves that a
 * body's colours reached the renderer.
 */
export const PROBE_CREATURE = { x: 259, z: 254, color: 6 };
/** Where the probe server stands one body with bones, for the self-check to look at. */
export const PROBE_BODY = { x: 253.5, z: 247 };

/** Slope strips, west to east: 10 to 60 degrees. Entries are tan(angle). */
export const SLOPE_TANS = [0.17632698, 0.36397023, 0.57735027, 0.83909963, 1.19175359, 1.73205081];
export const SLOPE_X0 = 196;
export const SLOPE_WIDTH = 8;
export const SLOPE_Z0 = 290;
const SLOPE_TOP = 12;

const CENTER = 256;
const PLAZA = 96;

function smooth(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function lattice(ix: number, iz: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = smooth(x - ix);
  const v = smooth(z - iz);
  const a = lattice(ix, iz);
  const b = lattice(ix + 1, iz);
  const c = lattice(ix, iz + 1);
  const d = lattice(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function provingHeight(x: number, z: number): number {
  const dx = Math.abs(x - CENTER);
  const dz = Math.abs(z - CENTER);
  const far = dx > dz ? dx : dz;

  // Rolling ground beyond the plaza, rising to a rim at the map edge.
  const rolling = (valueNoise(x / 90, z / 90) * 0.65 + valueNoise(x / 31, z / 31) * 0.35 - 0.4) * 44;
  let h = smooth((far - PLAZA) / 50) * rolling + smooth((far - 200) / 56) * 60;

  // Slope strips rising northward to a shared plateau.
  const strip = Math.floor((x - SLOPE_X0) / SLOPE_WIDTH);
  if (strip >= 0 && strip < SLOPE_TANS.length && z >= SLOPE_Z0 && z <= SLOPE_Z0 + 46) {
    const rise = (z - SLOPE_Z0) * SLOPE_TANS[strip]!;
    h = rise < SLOPE_TOP ? rise : SLOPE_TOP;
  }

  // Hill to the east, bowl to the west.
  const hx = x - 340;
  const hz = z - 256;
  h += 18 * smooth(1 - Math.sqrt(hx * hx + hz * hz) / 40);
  const bx = x - 172;
  const bz = z - 256;
  h -= 8 * smooth(1 - Math.sqrt(bx * bx + bz * bz) / 30);
  return h;
}

export function buildProvingHeightfield(): Heightfield {
  const hf = new Heightfield(PROVING_DIMS, TERRAIN_CELL, -32, 1 / 256);
  hf.seaLevel = PROVING_SEA_LEVEL;
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const x = i * hf.cell;
      const z = j * hf.cell;
      hf.setSample(i, j, provingHeight(x, z));
      const dx = Math.abs(x - CENTER);
      const dz = Math.abs(z - CENTER);
      const strip = Math.floor((x - SLOPE_X0) / SLOPE_WIDTH);
      let tint = (dx > dz ? dx : dz) > PLAZA ? 12 : 1;
      if (strip >= 0 && strip < SLOPE_TANS.length && z >= SLOPE_Z0 && z <= SLOPE_Z0 + 46) tint = 16 + strip;
      hf.tint[j * hf.nx + i] = tint;
    }
  }
  return hf;
}

export function provingMapHash(hf: Heightfield): number {
  const heights = hashBytes(new Uint8Array(hf.heights.buffer, hf.heights.byteOffset, hf.heights.byteLength));
  return hashBytes(new Uint8Array(new Float64Array([hf.seaLevel]).buffer), heights);
}

/** Place the proving ground's structures. Server side; clients receive them by replication. */
export function populateProving(structs: StructureStore, hf: Heightfield, reg: Registry): void {
  const k = (id: string): number => {
    const i = reg.index.get(id);
    if (i === undefined) throw new Error(`proving ground needs content "${id}"`);
    return i;
  };
  const hp = (kind: number): number => {
    const d = reg.defs[kind]!;
    return d.type === "structure" ? d.hp : 0;
  };
  const put = (kind: number, x: number, y: number, z: number, yaw = 0): void => {
    structs.add(kind, x, y, z, yaw, 0, hp(kind));
  };
  const QUARTER = 16384;
  const step = k("core:step");
  const slab = k("core:slab");
  const foundation = k("core:foundation");
  const wall = k("core:wall");
  const ceiling = k("core:ceiling");
  const pillar = k("core:pillar");
  const crate = k("core:crate");
  const block = k("core:block");

  // Staircase: twelve 0.3 m rises onto a raised slab.
  for (let i = 0; i < 12; i++) put(step, 263, 0.15 + 0.3 * i, 276.5 + i, 0);
  put(slab, 263, 3.35, 292.5, 0);

  // House: 6 m square, 3 m walls, doorway on the south-west bay.
  for (const fx of [237.5, 240.5]) {
    for (const fz of [271.5, 274.5]) {
      put(foundation, fx, 0.15, fz);
      put(ceiling, fx, 3.4, fz);
    }
  }
  put(wall, 240.5, 1.8, 270);
  put(wall, 237.5, 1.8, 276);
  put(wall, 240.5, 1.8, 276);
  for (const wz of [271.5, 274.5]) {
    put(wall, 236, 1.8, wz, QUARTER);
    put(wall, 242, 1.8, wz, QUARTER);
  }

  // A 24 m wall only 0.2 m thick: the thing a body must never pass through.
  for (let i = 0; i < 8; i++) put(wall, 277.5 + 3 * i, 1.5, 262);

  // Pillar slalom.
  for (let ix = 0; ix < 5; ix++) {
    for (let iz = 0; iz < 6; iz++) put(pillar, 250 + 3 * ix, 3, 300 + 4 * iz);
  }

  // Jump targets: a crate can be mounted, a block cannot.
  put(block, 250, 1, 262);
  put(block, 250, 3, 262);
  put(block, 253, 1, 262);
  put(crate, 246, 0.5, 262);

  // Scattered crates at arbitrary angles.
  const rng = new Rng(7);
  for (let i = 0; i < 30; i++) {
    put(crate, rng.range(270, 300), 0.5, rng.range(268, 290), rng.int(65536));
  }

  // Distance markers every 50 m to the north.
  for (let z = 350; z <= 500; z += 50) put(pillar, 256, hf.heightAt(256, z) + 3, z);
}

/** Slots for nodes in each chunk of the proving ground. About a third end up holding one. */
export const PROVING_NODES_PER_CHUNK = 96;

/** The proving ground's trees, rocks and bushes: everywhere outside the plaza that is dry and not too steep. */
export function provingNodes(hf: Heightfield, reg: Registry): NodeSource {
  const kinds: number[] = [];
  for (const [id, weight] of [["core:tree", 5], ["core:rock", 3], ["core:bush", 3]] as const) {
    const k = reg.index.get(id);
    if (k !== undefined) for (let i = 0; i < weight; i++) kinds.push(k);
  }
  const outside = (x: number, z: number): boolean => {
    const dx = Math.abs(x - CENTER);
    const dz = Math.abs(z - CENTER);
    // A thin band of nodes hugs the plaza's edge so there is something to gather a short walk from the spawn.
    return (dx > dz ? dx : dz) > PLAZA + 3;
  };
  return scatterNodes(PROVING_DIMS, hf, 0x51ab, PROVING_NODES_PER_CHUNK, kinds, reg.halfY, outside);
}
