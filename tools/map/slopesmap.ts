// A map for pictures of the sloped statics far off: flat ground 2.5 km square with a district of the small ruin of
// tools/snap/slopes.ts in its middle, six by six of them 60 m apart, each turned on from the last, and views of it from
// each far city level's distance for tools/map/cityviews.ts.
//
//   bun tools/map/slopesmap.ts [folder]   writes <folder>/slopes.snmap and <folder>/views.json (folder var/maps by default)
//   bun tools/map/cityviews.ts var/maps/slopes.snmap var/maps/views.json <out folder> --tier medium

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS } from "../../shared/coords.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { slopeRuin } from "../snap/slopes.ts";

const CHUNKS = 40;
const GROUND = 2;
const MIN_Y = -32;
const STEP_Y = 1 / 256;
const SIDE = CHUNKS * CHUNK_SIZE;
/** The district's middle. */
const MID = SIDE / 2;

const reg = compileContent(CORE_CONTENT).registry!;
const snapped = (v: number): number => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS;
const statics: MapStatic[] = [];
for (let i = 0; i < 6; i++) {
  for (let j = 0; j < 6; j++) {
    const [ox, oz] = [MID + (i - 2.5) * 60, MID + (j - 2.5) * 60];
    const turn = ((i * 6 + j) * 23) % 360;
    const [c, s] = [Math.cos((turn * Math.PI) / 180), Math.sin((turn * Math.PI) / 180)];
    // A piece's +X turned `turn` degrees is (cos, -sin) in the world and its +Z (sin, cos), as the frame turns it.
    for (const p of slopeRuin(reg)) {
      statics.push({ kind: p.kind, x: snapped(ox + c * p.x + s * p.z), y: snapped(GROUND + p.y), z: snapped(oz - s * p.x + c * p.z), yaw: Math.round(((p.deg + turn) / 360) * 65536) & 0xffff });
    }
  }
}
const samples = (SIDE / TERRAIN_CELL + 1) ** 2;
const heights = new Uint16Array(samples).fill((GROUND - MIN_Y) / STEP_Y);
const file = writeMap({ id: "slopes", dims: { chunksX: CHUNKS, chunksZ: CHUNKS }, minY: MIN_Y, stepY: STEP_Y, seaLevel: -Infinity, heights, tint: new Uint8Array(samples).fill(1), statics, nodes: [], spawns: [{ name: "South", x: MID, z: MID - 400, yaw: 0 }] });
const folder = process.argv[2] ?? "var/maps";
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, "slopes.snmap"), file);
// From the near rows, then from each far level's distance on medium (client/core/assets/tiers.ts), the far ones narrowed so
// the district fills the picture as much as the near one.
const look = [MID, MID, 2] as const;
const views = [
  { name: "near", x: MID - 40, z: MID - 130, up: 30, look, fov: 50 },
  { name: "box-300m", x: MID - 90, z: MID - 300, up: 90, look, fov: 30 },
  { name: "lattice-800m", x: MID - 240, z: MID - 760, up: 220, look, fov: 14 },
  { name: "mass-1600m", x: MID - 480, z: MID - 1520, up: 420, look, fov: 7 },
];
writeFileSync(join(folder, "views.json"), JSON.stringify(views, null, 1));
console.log(`${join(folder, "slopes.snmap")}: ${statics.length} statics, ${(file.length / 1048576).toFixed(1)} MB`);
