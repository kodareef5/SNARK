// A native map for repeatable water handling and boarding review. It uses the same terrain and static pieces as play.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { writeMap, type MapData, type MapStatic } from "../../shared/world/mapfile.ts";

export const BOAT_COURSE = {
  id: "preview:boat-course", spawn: { x: 131, z: 64, yaw: 0 },
  berths: [{ x: 128, z: 94 }, { x: 112, z: 94 }, { x: 144, z: 94 }],
  water: 0, review: { x: 128, z: 128 },
} as const;

export function boatCourse(): MapData {
  const hf = new Heightfield({ chunksX: 8, chunksZ: 8 }, 2, -32, 1 / 256), statics: MapStatic[] = [];
  for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) {
    const px = x * hf.cell, pz = z * hf.cell;
    // Dry launch shore, a steep-sided harbour, broad deep channel, and a long visible beach at its far end.
    let y = pz < 72 ? .55 : pz < 84 ? .55 - (pz - 72) * .72 : -8;
    if (pz > 330) y = Math.max(y, Math.min(.55, -8 + (pz - 330) * .095));
    if (px < 48 || px > 464) y = Math.max(y, Math.min(.55, -8 + Math.max(48 - px, px - 464) * .3));
    hf.setSample(x, z, y); hf.tint[z * hf.nx + x] = y > -.5 ? 4 : 1;
  }
  for (const berth of BOAT_COURSE.berths) {
    for (let z = 73; z <= 88; z += 3) statics.push({ kind: "core:ceiling", x: berth.x + 3.25, y: .45, z, yaw: 0 });
    for (const z of [76, 88]) statics.push({ kind: "core:pillar", x: berth.x + 4.45, y: -2.1, z, yaw: 0 });
    statics.push({ kind: "core:crate", x: berth.x + 6, y: 1.05, z: 66, yaw: 0 });
  }
  // Two rows of gates, alternating the suggested turn. These are physical half-metre posts, not invisible triggers.
  for (let i = 0; i < 5; i++) {
    const x = 128 + (i % 2 ? 10 : -10), z = 156 + i * 27;
    for (const side of [-1, 1]) statics.push({ kind: "core:pillar", x: x + side * 4.5, y: -1.5, z, yaw: 0 });
  }
  // A thin breakwater beside the course, clear of the straight acceleration lane.
  for (let z = 152; z <= 185; z += 3) statics.push({ kind: "core:wall", x: 168, y: .2, z, yaw: 16384 });
  return { id: BOAT_COURSE.id, dims: hf.dims, minY: hf.minY, stepY: hf.stepY, seaLevel: BOAT_COURSE.water,
    heights: hf.heights, tint: hf.tint, statics, nodes: [], spawns: [{ name: "Launch dock", ...BOAT_COURSE.spawn }] };
}

export function writeBoatCourse(path: string): string {
  const out = resolve(path); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, writeMap(boatCourse())); return out;
}
if (import.meta.main) {
  const at = process.argv.indexOf("--out");
  console.log(writeBoatCourse(at < 0 ? "var/boat-preview/course.snmp" : process.argv[at + 1]!));
}
