// Many pictures of a built map from the software rasterizer, as `bun run snap -- --map FILE --graphics TIER` draws one,
// with the asset files read once: bun tools/mapworld/views.ts <file.snmap> <views.json> <out folder> [tier] [only name]
//
// views.json is a list of { "name", "x", "z", "yaw", "pitch", and "up": metres above the ground for the eye, or "y" for a
// height above the sea; "fov" in degrees; "spawn": a spawn point's name, whose place and facing are used }. Engine
// metres and degrees as the map's folder has them.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { chunkAt } from "../../shared/coords.ts";
import { parseMap } from "../../shared/world/mapfile.ts";
import { SOURCE } from "../art/source.ts";
import { provingView, settle } from "../snap.ts";
import { gameFiles } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";

interface View {
  name: string;
  spawn?: string;
  x?: number;
  z?: number;
  y?: number;
  up?: number;
  yaw?: number;
  pitch?: number;
  fov?: number;
  size?: [number, number];
}

const [path, list, folder, tierName = "medium", only] = process.argv.slice(2);
if (!path || !list || !folder) {
  console.error("bun tools/mapworld/views.ts <file.snmap> <views.json> <out folder> [tier] [only name]");
  process.exit(2);
}
const map = parseMap(new Uint8Array(readFileSync(path)));
const views = (JSON.parse(readFileSync(list, "utf8")) as View[]).filter((v) => only === undefined || v.name === only);
const files = await gameFiles(resolve(SOURCE));
mkdirSync(folder, { recursive: true });
for (const v of views) {
  const t0 = performance.now();
  const [w, h] = v.size ?? [1280, 720];
  const view = provingView(w, h, {}, files, map);
  view.scene.assets.tier = tierOf(tierName);
  view.scene.viewHeight = h;
  const cam = view.cam;
  const spawn = v.spawn === undefined ? null : map.spawns.find((s) => s.name === v.spawn);
  if (v.spawn !== undefined && !spawn) throw new Error(`no spawn point "${v.spawn}"`);
  cam.x = spawn?.x ?? v.x ?? cam.x;
  cam.z = spawn?.z ?? v.z ?? cam.z;
  cam.y = v.y ?? view.hf.heightAt(cam.x, cam.z) + (v.up ?? 1.62);
  cam.yaw = v.yaw !== undefined ? (v.yaw * Math.PI) / 180 : spawn ? (spawn.yaw / 65536) * 2 * Math.PI : 0;
  cam.pitch = ((v.pitch ?? -4) * Math.PI) / 180;
  if (v.fov !== undefined) cam.fovY = (v.fov * Math.PI) / 180;
  view.nodes.retain(chunkAt(map.dims, cam.x, cam.z), 4, 1, () => false);
  const frames = settle(view);
  const out = join(folder, `${v.name}.png`);
  writeFileSync(out, encodePng(w, h, view.raster.color));
  console.log(`${out}  ${frames} frames, ${(performance.now() - t0).toFixed(0)} ms, eye ${cam.x.toFixed(0)}, ${cam.y.toFixed(1)}, ${cam.z.toFixed(0)}`);
}
