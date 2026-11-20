// A cheap tuning view, with no city rebuild: bun tools/surfaces/views.ts [medium|high|ultra|lowpoly] [city] [finish|field]
// Every finish at human scale on the ground and on a wall, where a colour of each gives it, under a low sun and a high
// one; plus a 512 m field from 150 m and translated cameras for motion inspection.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FALLBACK_SURFACES, GROUND_SURFACES, SURFACE_NAMES } from "../../content/surfaces.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { provingView, settle } from "../snap.ts";
import { SOURCE } from "../art/source.ts";
import { gameFiles } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { boxMesh } from "../pack/write.ts";

const tier = tierOf(process.argv[2] ?? "medium"), city = process.argv[3] ?? "default", only = process.argv[4];
if (only && only !== "field" && !SURFACE_NAMES.some((name) => name === only)) throw new Error(`Unknown finish ${only}: ${SURFACE_NAMES.join(", ")}, or field`);
// Each finish's colour on the ground and on a wall, the first its tables give it, or -1 where none does.
const ground = SURFACE_NAMES.map((name) => GROUND_SURFACES[name]?.[0] ?? -1);
const wall = SURFACE_NAMES.map((name) => FALLBACK_SURFACES[name]?.[0] ?? -1);
const extra = wall.flatMap((c, i) => (c < 0 ? [] : [{ id: `study:wall-${i}`, lods: [boxMesh([3.5, 2, 0.6], c)] }]));
const files = await gameFiles(SOURCE, undefined, extra);
const folder = resolve(`var/surfaces/views/${tier.name}-${city}`);
mkdirSync(folder, { recursive: true });
const width = 640, height = 480;
/** A low sun and a high one. */
const HOURS = [7.5, 13];
const sheet = new Uint8Array(width * 4 * height * 8 * 4);
const costs: object[] = [];
const view = (fill: number, hour: number) => {
  const v = provingView(width, height, {}, files);
  v.hf.heights.fill(Math.round((2 - v.hf.minY) / v.hf.stepY));
  v.hf.tint.fill(fill);
  const structs = new StructureStore(v.hf.dims, v.reg.halfX, v.reg.halfY, v.reg.halfZ, null, v.reg.parts);
  const scene = new Scene({ dims: v.hf.dims, hf: v.hf, structs, mapId: `core:${city}` }, v.reg, v.pack, { manifest: files.manifest, port: v.port! });
  scene.assets.tier = tier; scene.viewHeight = height; scene.hour = hour;
  v.scene = scene; v.remote.count = 0;
  return v;
};
for (let id = 0; id < 16; id++) {
  if (only && only !== SURFACE_NAMES[id]) continue;
  for (const [k, hour] of HOURS.entries()) for (const onWall of [false, true]) {
    if ((onWall ? wall : ground)[id]! < 0) continue;
    const v = view(onWall ? 100 : ground[id]!, hour);
    v.cam.x = 256; v.cam.y = onWall ? 3.8 : 3.65; v.cam.z = onWall ? 262.5 : 251;
    v.cam.yaw = onWall ? Math.PI + 0.12 : 0.15; v.cam.pitch = onWall ? -0.04 : -0.6;
    if (onWall) v.scene.things.push({ mesh: v.scene.assets.table.find(`study:wall-${id}`)!, x: 256, y: 4, z: 256, level: -1 });
    settle(v);
    const name = `${SURFACE_NAMES[id]}-${onWall ? "wall" : "ground"}-${hour < 10 ? "low" : "high"}`;
    writeFileSync(resolve(folder, `${name}.png`), encodePng(width, height, v.raster.color));
    // The sheet: a row a finish pair, four columns: ground low, wall low, ground high, wall high.
    const col = k * 2 + (onWall ? 1 : 0), row = id;
    if (!only) for (let y = 0; y < height; y++) sheet.set(v.raster.color.subarray(y * width * 4, (y + 1) * width * 4), (((row % 8) * height + y) * width * 8 + (Math.floor(row / 8) * 4 + col) * width) * 4);
    costs.push({ name, draws: v.scene.packet.drawCount, triangles: v.scene.packet.triangles, textureBytes: v.scene.assets.residency.texLedger });
    console.log(`${tier.name} ${name}`);
  }
}
if (!only) writeFileSync(resolve(folder, "sheet.png"), encodePng(width * 8, height * 8, sheet));
writeFileSync(resolve(folder, only ? `${only}-costs.json` : "costs.json"), JSON.stringify(costs, null, 2) + "\n");

// A homogeneous half-kilometre field makes large repeats easy to see. The five frames translate by 25 cm each;
// reproject the same ground points between frames to distinguish texture shimmer from ordinary camera motion.
const motion: object[] = [];
for (const id of only && only !== "field" ? [] : [0, 1, 6]) {
  const w = 960, h = 540, v = provingView(w, h, {}, files);
  v.hf.heights.fill(Math.round((2 - v.hf.minY) / v.hf.stepY)); v.hf.tint.fill(ground[id]!);
  const structs = new StructureStore(v.hf.dims, v.reg.halfX, v.reg.halfY, v.reg.halfZ, null, v.reg.parts);
  const scene = new Scene({ dims: v.hf.dims, hf: v.hf, structs, mapId: `core:${city}` }, v.reg, v.pack, { manifest: files.manifest, port: v.port! });
  scene.assets.tier = tier; scene.viewHeight = h; scene.hour = 14;
  v.scene = scene; v.remote.count = 0;
  v.cam.x = 256; v.cam.y = 152; v.cam.z = 6; v.cam.pitch = -35 * Math.PI / 180; v.cam.yaw = 0;
  settle(v);
  const first = v.raster.color.slice(), points: { x: number; z: number; at: number }[] = [];
  const ray = new Float64Array(3), screen: number[] = [];
  for (let py = 8; py < h - 8; py += 4) for (let px = 8; px < w - 8; px += 4) {
    v.cam.ray((px + 0.5) / w, (py + 0.5) / h, ray);
    const distance = -150 / ray[1]!;
    const x = v.cam.x + ray[0]! * distance, z = v.cam.z + ray[2]! * distance;
    if (distance > 0 && x > 6 && x < 506 && z > 6 && z < 506) points.push({ x, z, at: (py * w + px) * 4 });
  }
  for (let frame = 0; frame < 5; frame++) {
    v.cam.x = 256 + frame * 0.25;
    if (frame) v.raster.render(scene.build(v.cam, v.remote));
    writeFileSync(resolve(folder, `${SURFACE_NAMES[id]}-field-150m-${frame}.png`), encodePng(w, h, v.raster.color));
    const errors: number[] = [];
    for (const p of points) {
      v.cam.project(p.x, 2, p.z, screen);
      const x = screen[0]! * w - 0.5, y = screen[1]! * h - 0.5, ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= w - 1 || iy >= h - 1) continue;
      const fx = x - ix, fy = y - iy;
      for (let c = 0; c < 3; c++) {
        const at = (xx: number, yy: number): number => v.raster.color[(yy * w + xx) * 4 + c]!;
        const sample = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
        errors.push(Math.abs(first[p.at + c]! - sample));
      }
    }
    errors.sort((a, b) => a - b);
    motion.push({ finish: SURFACE_NAMES[id], frame, translationMetres: frame * 0.25, samples: errors.length, meanAbsoluteByteError: errors.reduce((a, b) => a + b, 0) / errors.length, p95ByteError: errors[Math.floor(errors.length * 0.95)] });
  }
  console.log(`${tier.name} ${SURFACE_NAMES[id]} 512m field and motion`);
}
if (motion.length) writeFileSync(resolve(folder, "motion.json"), JSON.stringify(motion, null, 2) + "\n");
