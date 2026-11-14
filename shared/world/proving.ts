// A graybox test map generated from code, so the same code yields the same map everywhere. Each feature exercises one engine
// behaviour, and the server, the tests, the headless rasterizer and the browser probe all load it.

import type { MapDims } from "../coords.ts";
import type { Registry } from "../content/registry.ts";
import { Rng } from "../rng.ts";
import { Heightfield, TERRAIN_CELL } from "./heightfield.ts";
import { nodeLayers, type NodeLayer } from "./mapfile.ts";
import type { NodeSource } from "./nodes.ts";
import type { StructureStore } from "./structures.ts";

export const PROVING_ID = "proving:1";
export const PROVING_DIMS: MapDims = { chunksX: 8, chunksZ: 8 };
export const PROVING_SPAWN = { x: 256, z: 240, yaw: 0 };
/** Respawn choices for a dead survivor. */
export const PROVING_SPAWNS = [
  { name: "Plaza", ...PROVING_SPAWN },
  { name: "Slopes", x: 228, z: 282, yaw: 0 },
  { name: "Poolside", x: 208, z: 256, yaw: 49152 },
];
/** Half a metre below the plaza, so the bowl is a pool and low ground beyond the plaza holds ponds. */
export const PROVING_SEA_LEVEL = -0.5;
/** Centre of the bowl, which is 8 m deep. */
export const PROVING_POOL = { x: 172, z: 256 };
/**
 * Where the probe server stands its one creature, in clear view of the spawn point. `color` goes on its first region and is not
 * the species' own, so seeing it proves that a body's colours reached the renderer.
 */
export const PROBE_CREATURE = { x: 259, z: 254, color: 6 };
/** Where the probe server stands one body with bones, for the self-check. */
export const PROBE_BODY = { x: 253.5, z: 247 };

/** Slope strips west to east, 10 to 60 degrees. Entries are tan(angle). */
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

/** Server side. Clients receive the structures by replication. */
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

  // A staircase of twelve 0.3 m rises onto a raised slab.
  for (let i = 0; i < 12; i++) put(step, 263, 0.15 + 0.3 * i, 276.5 + i, 0);
  put(slab, 263, 3.35, 292.5, 0);

  // A house 6 m square with 3 m walls and a doorway in the south-west bay.
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

  // A 24 m wall only 0.2 m thick, which a body must never pass through.
  for (let i = 0; i < 8; i++) put(wall, 277.5 + 3 * i, 1.5, 262);

  // Pillar slalom.
  for (let ix = 0; ix < 5; ix++) {
    for (let iz = 0; iz < 6; iz++) put(pillar, 250 + 3 * ix, 3, 300 + 4 * iz);
  }

  // Jump targets. A body can get onto a crate but not onto a block.
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

/** Node slots per chunk of the first layer, the trees, rocks and bushes it has always had. About a third end up holding a node. */
export const PROVING_NODES_PER_CHUNK = 96;
/** And of the second, the other kinds, which grow by the height of the ground. */
export const PROVING_ZONED_PER_CHUNK = 48;
const ZONE_CELL = 4;
/** Metres from the middle, along either axis, where the other kinds begin. */
const OTHER_KINDS = 130;

/**
 * The proving ground's nodes, as its map file holds them. Every node stands 3 m or more beyond the plaza's edge. The first layer
 * scatters trees, rocks and bushes over all of that, as it always has, so a world saved before the second came keeps every node
 * where it was and of its kind. The second grows the other kinds from 130 m out, so the woods nearest the plaza are as they
 * were, by a simple rule: mangroves, palms and palmetto by the water, palms, figs and ferns on the low ground, and figs,
 * banyans and rubble higher up.
 */
export function provingNodeLayers(hf: Heightfield): NodeLayer[] {
  const side = PROVING_DIMS.chunksX * 64;
  const beyond = (x: number, z: number): boolean => Math.max(Math.abs(x - CENTER), Math.abs(z - CENTER)) > PLAZA + 3;
  // A bit is a square metre, set by its middle.
  const allow = new Uint8Array((side * side) / 8);
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) if (beyond(x + 0.5, z + 0.5)) allow[(z * side + x) >> 3]! |= 1 << (x & 7);
  const across = side / ZONE_CELL;
  const zone = new Uint8Array(across * across);
  for (let j = 0; j < across; j++) {
    for (let i = 0; i < across; i++) {
      // A square is in a zone by the ground at its middle.
      const x = (i + 0.5) * ZONE_CELL;
      const z = (j + 0.5) * ZONE_CELL;
      if (Math.max(Math.abs(x - CENTER), Math.abs(z - CENTER)) < OTHER_KINDS) continue;
      const above = hf.heightAt(x, z) - PROVING_SEA_LEVEL;
      zone[j * across + i] = above < 2.5 ? 1 : above < 8.5 ? 2 : 3;
    }
  }
  return [
    { seed: 0x51ab, perChunk: PROVING_NODES_PER_CHUNK, kinds: [["core:tree", 5], ["core:rock", 3], ["core:bush", 3]], allowCell: 1, allow },
    {
      seed: 0x51ac,
      perChunk: PROVING_ZONED_PER_CHUNK,
      zones: [
        { bare: 6, kinds: [["core:mangrove", 4], ["core:palm", 3], ["core:palmetto", 3]] },
        { bare: 8, kinds: [["core:palm", 3], ["core:fig", 1], ["core:fern", 3], ["core:palmetto", 2], ["core:rubble", 1]] },
        { bare: 8, kinds: [["core:fig", 2], ["core:banyan", 1], ["core:fern", 3], ["core:rubble", 2], ["core:palm", 1]] },
      ],
      zoneCell: ZONE_CELL,
      zone,
    },
  ];
}

/** The proving ground's nodes on `hf`, which is its ground. */
export function provingNodes(hf: Heightfield, reg: Registry): NodeSource {
  return nodeLayers(PROVING_DIMS, hf, reg, provingNodeLayers(hf))!;
}
