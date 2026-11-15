// Many pictures of a built map from the software rasterizer, as `bun run snap -- --map FILE --graphics TIER` draws one,
// with the asset files read once: bun tools/mapworld/views.ts <file.snmap> <views.json> <out folder> [tier] [only name]
//
// views.json is a list of { "name", "x", "z", "yaw", "pitch", and "up": metres above the ground for the eye, or "y" for a
// height above the sea; "fov" in degrees; "spawn": a spawn point's name, whose place and facing are used; "look": [x, z,
// metres above the ground] to face, with "pitch" then added }. Engine metres and degrees as the map's folder has them.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { chunkAt, chunkCx, chunkCz } from "../../shared/coords.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { NodeChanges } from "../../client/core/render/farnodes.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { bakeChunk, pieceShapes, Summary, writeFar } from "../../shared/world/tactical.ts";
import { parseMap } from "../../shared/world/mapfile.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { SOURCE } from "../art/source.ts";
import { provingView, settle } from "../snap.ts";
import { gameFiles } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";

interface View {
  name: string;
  isolate?: { first: number; count: number; x: number; y: number; z: number; yaw: number };
  spawn?: string;
  x?: number;
  z?: number;
  y?: number;
  up?: number;
  yaw?: number;
  pitch?: number;
  fov?: number;
  size?: [number, number];
  look?: [number, number, number?];
}

const [path, list, folder, tierName = "medium", only] = process.argv.slice(2);
if (!path || !list || !folder) {
  console.error("bun tools/mapworld/views.ts <file.snmap> <views.json> <out folder> [tier] [only name]");
  process.exit(2);
}
const started = performance.now();
const map = parseMap(new Uint8Array(readFileSync(path)));
const views = (JSON.parse(readFileSync(list, "utf8")) as View[]).filter((v) => only === undefined || only.split(",").includes(v.name));
const files = await gameFiles(resolve(SOURCE));
mkdirSync(folder, { recursive: true });
let farCells: FarStore | null = null;
let city: CityStatics | null = null;
let previousIsolated = false;
const stageX = map.dims.chunksX * 32; const stageZ = map.dims.chunksZ * 32;
const flatHeights = new Uint16Array(map.heights.length).fill(Math.round((2 - map.minY) / map.stepY));
const flatTint = new Uint8Array(map.tint.length).fill(100);
const rendered: { name: string; frames: number; milliseconds: number; eye: number[]; draws: number; dropped: number; casterDropped: number }[] = [];
const small: { w: number; h: number; rgba: Uint8Array }[] = [];
for (const v of views) {
  Bun.gc(true);
  const t0 = performance.now();
  const [w, h] = v.size ?? [1280, 720];
  let activeMap = map;
  if (v.isolate) {
    const i = v.isolate; const a = i.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
    activeMap = { ...map, heights: flatHeights, tint: flatTint, nodes: [], statics: map.statics.slice(i.first, i.first + i.count).map((p) => ({ ...p, x: stageX + (p.x - i.x) * c - (p.z - i.z) * s, z: stageZ + (p.x - i.x) * s + (p.z - i.z) * c, y: p.y - i.y + 2, yaw: (p.yaw - Math.round(i.yaw * 65536 / 360) + 65536) & 65535 })) };
  }
  if (v.isolate || previousIsolated) { farCells = null; city = null; }
  previousIsolated = !!v.isolate;
  const view = provingView(w, h, {}, files, activeMap);
  city ??= new CityStatics(map.dims, activeMap.statics, view.reg);
  // Supply the same far-cell stream and complete near chunks as a stationary live client.
  // The generic snap harness holds the entire map as near rows, overflowing its draw list on a city.
  if (!farCells) {
    farCells = new FarStore();
    const shapes = pieceShapes(view.reg); const summary = new Summary();
    const w = new BitWriter(2048); const r = new BitReader();
    view.structs.chunks.forEach((table, chunk) => {
      if (!table || table.live === 0) return;
      bakeChunk(table, chunkCx(map.dims, chunk) * 64, chunkCz(map.dims, chunk) * 64, shapes, view.hf, summary);
      w.reset(); writeFar(w, chunk, summary.far); r.reset(w.bytes()); farCells!.read(r, map.dims);
    });
  }
  const complete = (chunk: number): boolean => Math.abs(chunkCx(map.dims, chunk) - Math.floor(view.cam.x / 64)) <= 3 && Math.abs(chunkCz(map.dims, chunk) - Math.floor(view.cam.z / 64)) <= 3;
  const scene = new Scene({ dims: map.dims, hf: view.hf, structs: view.structs, nodes: view.nodes.store,
    far: { cells: farCells, complete },
    city: { statics: city, complete },
    farNodes: { nodes: view.nodes.source, held: (c) => view.nodes.isLoaded(c), gone: () => undefined, changes: new NodeChanges(map.dims) }
  }, view.reg, view.pack, view.port ? { manifest: files.manifest, port: view.port } : undefined);
  view.scene = scene;
  if (scene.city) scene.city.makeMs = Infinity;
  view.render = () => { const packet = scene.build(view.cam, view.remote); view.raster.render(packet); return packet; };
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
  if (v.look) {
    // Faces a point: x and z, and metres above the ground there.
    const [lx, lz, up = 0] = v.look;
    const dx = lx - cam.x;
    const dz = lz - cam.z;
    cam.yaw = Math.atan2(dx, dz);
    cam.pitch = Math.atan2(view.hf.heightAt(lx, lz) + up - cam.y, Math.hypot(dx, dz)) + ((v.pitch ?? 0) * Math.PI) / 180;
  }
  if (v.fov !== undefined) cam.fovY = (v.fov * Math.PI) / 180;
  view.nodes.retain(chunkAt(map.dims, cam.x, cam.z), 4, 1, () => false);
  const frames = settle(view);
  const out = join(folder, `${v.name}.png`);
  writeFileSync(out, encodePng(w, h, view.raster.color));
  // A quarter of it, for the contact sheet of every view.
  const half = new Uint8Array((w >> 1) * (h >> 1) * 4);
  for (let y = 0; y < h >> 1; y++) {
    for (let x = 0; x < w >> 1; x++) {
      for (let k = 0; k < 4; k++) {
        const at = (yy: number, xx: number): number => view.raster.color[(yy * w + xx) * 4 + k]!;
        half[(y * (w >> 1) + x) * 4 + k] = (at(2 * y, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x) + at(2 * y + 1, 2 * x + 1)) >> 2;
      }
    }
  }
  rendered.push({ name: v.name, frames, milliseconds: Math.round(performance.now() - t0), eye: [cam.x, cam.y, cam.z], draws: scene.packet.drawCount, dropped: scene.packet.dropped, casterDropped: scene.packet.casterDropped });
  small.push({ w: w >> 1, h: h >> 1, rgba: half });
  console.log(`${out}  ${frames} frames, ${(performance.now() - t0).toFixed(0)} ms, eye ${cam.x.toFixed(0)}, ${cam.y.toFixed(1)}, ${cam.z.toFixed(0)}, dropped ${scene.packet.dropped}`);
}
// Every view at half size, three across, in the order listed.
if (small.length > 1 && !only) {
  const cw = Math.max(...small.map((s) => s.w));
  const across = 3;
  const rows = Math.ceil(small.length / across);
  // Each row as tall as its tallest view.
  const top = [0];
  for (let r = 0; r < rows; r++) top.push(top[r]! + Math.max(...small.slice(r * across, (r + 1) * across).map((s) => s.h)));
  const W = cw * across;
  const H = top[rows]!;
  const sheet = new Uint8Array(W * H * 4);
  small.forEach((s, k) => {
    const [ox, oy] = [(k % across) * cw, top[Math.floor(k / across)]!];
    for (let y = 0; y < s.h; y++) sheet.set(s.rgba.subarray(y * s.w * 4, (y + 1) * s.w * 4), ((oy + y) * W + ox) * 4);
  });
  writeFileSync(join(folder, "sheet.png"), encodePng(W, H, sheet));
  console.log(join(folder, "sheet.png"));
}

writeFileSync(join(folder, only ? `rendering-${only}.json` : "rendering.json"), `${JSON.stringify({ map: map.id, mapHash: map.hash, tier: tierName, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), peakResidentMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)), views: rendered }, null, 2)}\n`);
