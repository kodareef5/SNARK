// A native ground-creature review map: actual terrain, resource nodes and physical collision pieces.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { writeMap, type MapData, type MapStatic } from "../../shared/world/mapfile.ts";

import { made } from "../map.ts";

export const DINOSAUR_COURSE = {
  id: "preview:carbonemys-rex", spawn: { x: 149, z: 112, yaw: 0 },
  pads: [{ x: 158, z: 124 }, { x: 140, z: 128 }],
  slope: { x: 64, z: 168 }, pool: { x: 208, z: 192 },
} as const;

export function dinosaurCourse(): MapData {
  const hf = new Heightfield({ chunksX: 4, chunksZ: 4 }, 2, -32, 1 / 256), statics: MapStatic[] = [];
  for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) {
    const px = x * hf.cell, pz = z * hf.cell;
    // Broad level review pad and running lane, a graded rise west and a shallow-to-deep pool east.
    const rise = Math.max(0, 1 - Math.abs(px - 64) / 26) * Math.max(0, 1 - Math.abs(pz - 168) / 44) * 5;
    const pool = Math.max(0, Math.min(1, (px - 176) / 20, (240 - px) / 12, (pz - 117) / 22, (232 - pz) / 12));
    const y = 1 + rise - pool * 5;
    hf.setSample(x, z, y); hf.tint[z * hf.nx + x] = y < 0 ? 4 : 17;
  }
  // Slalom outside the unobstructed straight lane; ordinary posts reveal body clearance and steering.
  for (let i = 0; i < 4; i++) for (const side of [-1, 1]) statics.push({ kind: "core:pillar", x: 98 + (i % 2 ? 5 : -5) + side * 5, y: 2.5, z: 126 + i * 23, yaw: 0 });
  // Solid end barrier for turning and stopping, with room to turn beside it.
  for (let x = 120; x <= 144; x += 3) statics.push({ kind: "core:wall", x, y: 2.5, z: 228, yaw: 0 });
  const allow = new Uint8Array(32 * 32 / 8);
  for (let z = 14; z < 25; z++) for (let x = 19; x < 22; x++) { const i = z * 32 + x; allow[i >> 3]! |= 1 << (i & 7); }
  return made({ id: DINOSAUR_COURSE.id, dims: hf.dims, minY: hf.minY, stepY: hf.stepY, seaLevel: 0,
    heights: hf.heights, tint: hf.tint, statics,
    nodes: [{ seed: 411, perChunk: 80, kinds: [["core:bush", 5], ["core:tree", 2], ["core:palm", 1]], allowCell: 8, allow }],
    regions: [{ kind: "spawn", spawns: "core:spawns_beach", at: [138, 141], radius: 9, count: 5 }],
    spawns: [{ name: "Dinosaur review paddock", ...DINOSAUR_COURSE.spawn }] });
}

export function writeDinosaurCourse(path: string): string {
  const out = resolve(path); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, writeMap(dinosaurCourse())); return out;
}
