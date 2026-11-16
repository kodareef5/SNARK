// A cheap tuning view, with no city rebuild: bun tools/surfaces/views.ts [medium|high|ultra|lowpoly] [city] [finish|field]
// Every finish at human scale, plus a 512 m field from 150 m and translated cameras for motion inspection.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SURFACE_NAMES } from "../../content/surfaces.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { provingView, settle } from "../snap.ts";
import { SOURCE } from "../art/source.ts";
import { gameFiles } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";
import { boxMesh } from "../pack/write.ts";

const tier = tierOf(process.argv[2] ?? "medium"), city = process.argv[3] ?? "default", only = process.argv[4];
if (only && only !== "field" && !SURFACE_NAMES.some((name) => name === only)) throw new Error(`Unknown finish ${only}: ${SURFACE_NAMES.join(", ")}, or field`);
const colours = [197, 125, 114, 128, 15, 100, 84, 89, 100, 172, 183, 179, 89, 75, 115, 9];
const extra = colours.slice(8).map((c, i) => ({ id: `study:wall-${i}`, lods: [boxMesh([3.5, 2, 0.6], c)] }));
const files = await gameFiles(SOURCE, undefined, extra);
const folder = resolve(`assets/source/surfaces/pictures/studies/${tier.name}-${city}`);
mkdirSync(folder, { recursive: true });
const width = 640, height = 480;
const sheet = new Uint8Array(width * 4 * height * 4 * 4);
const costs: object[] = [];
for (let id = 0; id < 16; id++) {
  if (only && only !== SURFACE_NAMES[id]) continue;
  const view = provingView(width, height, {}, files);
  view.hf.heights.fill(Math.round((2 - view.hf.minY) / view.hf.stepY));
  view.hf.tint.fill(id < 8 ? colours[id]! : 100);
  const structs = new StructureStore(view.hf.dims, view.reg.halfX, view.reg.halfY, view.reg.halfZ, null, view.reg.parts);
  const scene = new Scene({ dims: view.hf.dims, hf: view.hf, structs, mapId: `core:${city}` }, view.reg, view.pack, { manifest: files.manifest, port: view.port! });
  scene.assets.tier = tier; scene.viewHeight = height; scene.hour = 14;
  view.scene = scene; view.remote.count = 0;
  view.cam.x = 256; view.cam.y = id < 8 ? 3.65 : 3.8; view.cam.z = id < 8 ? 251 : 262.5;
  view.cam.yaw = id < 8 ? 0.15 : Math.PI + 0.12; view.cam.pitch = id < 8 ? -0.6 : -0.04;
  if (id >= 8) scene.things.push({ mesh: scene.assets.table.find(`study:wall-${id - 8}`)!, x: 256, y: 4, z: 256, level: -1 });
  settle(view);
  writeFileSync(resolve(folder, `${SURFACE_NAMES[id]}.png`), encodePng(width, height, view.raster.color));
  for (let y = 0; y < height; y++) sheet.set(view.raster.color.subarray(y * width * 4, (y + 1) * width * 4), ((Math.floor(id / 4) * height + y) * width * 4 + (id % 4) * width) * 4);
  costs.push({ name: SURFACE_NAMES[id], draws: scene.packet.drawCount, triangles: scene.packet.triangles, textureBytes: scene.assets.residency.texLedger });
  console.log(`${tier.name} ${SURFACE_NAMES[id]}`);
}
if (!only) writeFileSync(resolve(folder, "sheet.png"), encodePng(width * 4, height * 4, sheet));
writeFileSync(resolve(folder, only ? `${only}-costs.json` : "costs.json"), JSON.stringify(costs, null, 2) + "\n");

// A homogeneous half-kilometre field makes large repeats easy to see. The five frames translate by 25 cm each;
// reproject the same ground points between frames to distinguish texture shimmer from ordinary camera motion.
const motion: object[] = [];
for (const id of only && only !== "field" ? [] : [0, 1, 6]) {
  const w = 960, h = 540, view = provingView(w, h, {}, files);
  view.hf.heights.fill(Math.round((2 - view.hf.minY) / view.hf.stepY)); view.hf.tint.fill(colours[id]!);
  const structs = new StructureStore(view.hf.dims, view.reg.halfX, view.reg.halfY, view.reg.halfZ, null, view.reg.parts);
  const scene = new Scene({ dims: view.hf.dims, hf: view.hf, structs, mapId: `core:${city}` }, view.reg, view.pack, { manifest: files.manifest, port: view.port! });
  scene.assets.tier = tier; scene.viewHeight = h; scene.hour = 14;
  view.scene = scene; view.remote.count = 0;
  view.cam.x = 256; view.cam.y = 152; view.cam.z = 6; view.cam.pitch = -35 * Math.PI / 180; view.cam.yaw = 0;
  settle(view);
  const first = view.raster.color.slice(), points: { x: number; z: number; at: number }[] = [];
  const ray = new Float64Array(3), screen: number[] = [];
  for (let py = 8; py < h - 8; py += 4) for (let px = 8; px < w - 8; px += 4) {
    view.cam.ray((px + 0.5) / w, (py + 0.5) / h, ray);
    const distance = -150 / ray[1]!;
    const x = view.cam.x + ray[0]! * distance, z = view.cam.z + ray[2]! * distance;
    if (distance > 0 && x > 6 && x < 506 && z > 6 && z < 506) points.push({ x, z, at: (py * w + px) * 4 });
  }
  for (let frame = 0; frame < 5; frame++) {
    view.cam.x = 256 + frame * 0.25;
    if (frame) view.raster.render(scene.build(view.cam, view.remote));
    writeFileSync(resolve(folder, `${SURFACE_NAMES[id]}-field-150m-${frame}.png`), encodePng(w, h, view.raster.color));
    const errors: number[] = [];
    for (const p of points) {
      view.cam.project(p.x, 2, p.z, screen);
      const x = screen[0]! * w - 0.5, y = screen[1]! * h - 0.5, ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= w - 1 || iy >= h - 1) continue;
      const fx = x - ix, fy = y - iy;
      for (let c = 0; c < 3; c++) {
        const at = (xx: number, yy: number): number => view.raster.color[(yy * w + xx) * 4 + c]!;
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
