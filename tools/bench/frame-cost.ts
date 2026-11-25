// The client frame section of tools/bench.ts on its own, with where its time goes: bun tools/bench/frame-cost.ts [--profile] [--repeat n]
//
// The same world as the bench's: an 8 km map, 250 box bases of 2,000 pieces in wood, stone and thatch, and the siege's
// 20,000-piece wooden chunk, drawn with the packs installed. Rows as the bench prints them. --profile times the passes
// of the first frame and of the steady ones, by wrapping the methods that do the work.

import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { NearStore } from "../../client/core/render/passes/near-store.ts";
import { Trims } from "../../client/core/render/trims.ts";
import { RoomFinder } from "../../client/core/render/rooms.ts";
import { BasePlates } from "../../client/core/render/base-occluders.ts";
import { Hiding } from "../../client/core/render/hide.ts";
import { Occlusion } from "../../client/core/render/passes/occlusion.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { chunkAt } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { buildCorePack } from "../pack/build.ts";
import { BASE_TIERS, asTextured, benchBases, boxBase, layBase } from "./base.ts";

const profile = process.argv.includes("--profile");
const firstOnly = process.argv.includes("--first");
const damageOnly = process.argv.includes("--damage");
const steadyOnly = process.argv.includes("--steady");
const at = process.argv.indexOf("--repeat");
const repeat = at >= 0 ? Number(process.argv[at + 1]) : 1;
const framesAt = process.argv.indexOf("--frames");
const FRAMES = framesAt >= 0 ? Number(process.argv[framesAt + 1]) : 300;
const percentile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
const row = (name: string, value: number, unit: string, budget?: number): void => console.log(`${name.padEnd(78)} ${value.toFixed(unit === "ms" ? 3 : 0)} ${unit}${budget === undefined ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`);

// Time spent in each wrapped method, inclusive of what it calls, and how many calls.
const spent = new Map<string, [number, number]>();
function wrap(proto: object, name: string, label = name): void {
  const p = proto as Record<string, (...args: unknown[]) => unknown>;
  const was = p[name]!;
  if (typeof was !== "function") throw new Error(`no method ${name}`);
  p[name] = function (this: unknown, ...args: unknown[]): unknown {
    const t = performance.now();
    try {
      return was.apply(this, args);
    } finally {
      const s = spent.get(label) ?? [0, 0];
      s[0] += performance.now() - t;
      s[1]++;
      spent.set(label, s);
    }
  };
}
function report(title: string, frames: number): void {
  console.log(`  ${title}, ms a frame (calls a frame):`);
  for (const [name, [ms, n]] of [...spent].sort((a, b) => b[1][0] - a[1][0])) console.log(`    ${name.padEnd(40)} ${(ms / frames).toFixed(3).padStart(9)}  (${(n / frames).toFixed(1)})`);
  spent.clear();
}

const DIMS = { chunksX: 128, chunksZ: 128 };
const hf = new Heightfield(DIMS, TERRAIN_CELL, -32, 1 / 64);
for (let j = 0; j < hf.nz; j++) {
  for (let i = 0; i < hf.nx; i++) {
    const x = i * hf.cell, z = j * hf.cell;
    hf.heights[j * hf.nx + i] = Math.round((40 + 30 * Math.sin(x / 400) * Math.cos(z / 350) + 8 * Math.sin(x / 53) * Math.sin(z / 61) + 32) * 64);
    hf.tint[j * hf.nx + i] = 12;
  }
}
const reg = compileContent(CORE_CONTENT).registry!;
const structs = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
const { centers, pieces } = benchBases(reg, hf);
pieces.forEach((base, b) => layBase(structs, base, 1 + b, 1000));
const siegeChunk = chunkAt(DIMS, centers[0]![0] + 70, centers[0]![1]);
{
  const x0 = (siegeChunk % DIMS.chunksX) * 64, z0 = Math.floor(siegeChunk / DIMS.chunksX) * 64;
  layBase(structs, boxBase(reg, "wood", x0 + 0.5, 200, z0 + 0.5, 21, 1, 20000), 1, (kind) => reg.maxHp[kind]!);
}
let t0 = performance.now();
const pack = parsePack(buildCorePack());
console.log(`pack built in ${(performance.now() - t0).toFixed(0)} ms, ${pack.header.meshes.length} meshes; ${structs.held.length} chunks held`);

if (profile) {
  const near = NearStore.prototype as unknown as object;
  for (const name of ["draw", "rebuild", "layTrims", "ranges", "zones", "castChunk", "keeps", "reform", "bordering"]) wrap(near, name, `near.${name}`);
  wrap(Trims.prototype, "lay", "trims.lay");
  wrap(RoomFinder.prototype, "find", "rooms.find");
  wrap(BasePlates.prototype, "of", "plates.of");
  wrap(Scene.prototype, "build", "scene.build");
  for (const name of ["begin", "box", "end", "hidesOver"]) wrap(Hiding.prototype, name, `hide.${name}`);
  for (const name of ["hideDrawn", "platesIn", "nearPiece"]) wrap(Occlusion.prototype, name, `occlusion.${name}`);
}

for (let r = 0; r < repeat; r++) {
  const scene = new Scene({ dims: DIMS, hf, structs }, reg, pack);
  asTextured(scene);
  if (profile) {
    for (const [name, pass] of scene.passes) {
      if (pass.update) wrap(pass, "update", `pass ${name} update`);
      if (pass.draw) wrap(pass, "draw", `pass ${name} draw`);
    }
  }
  const cam = new Camera();
  scene.structureDistance = 256;
  let packet = scene.packet;
  const standOff = (b: number): void => {
    cam.x = centers[b]![0] + 60;
    cam.z = centers[b]![1];
    cam.y = hf.heightAt(cam.x, cam.z) + 8;
    cam.yaw = Math.PI / 2 + Math.PI;
  };
  spent.clear();
  for (const b of damageOnly ? [] : [3, 1, 2]) {
    const tier = BASE_TIERS[b % 3]!;
    standOff(b);
    t0 = performance.now();
    packet = scene.build(cam, null);
    row(`${tier}: first frame, building instance buffers`, performance.now() - t0, "ms");
    if (profile) report(`${tier}: first frame`, 1);
    if (firstOnly) break;
    const frame: number[] = [];
    for (let i = 0; i < FRAMES; i++) {
      cam.yaw += 0.002 * (i % 600 < 300 ? 1 : -1);
      const t = performance.now();
      packet = scene.build(cam, null);
      frame.push(performance.now() - t);
    }
    frame.sort((a, b) => a - b);
    row(`${tier}: frame build, median`, percentile(frame, 0.5), "ms", 1);
    row(`${tier}: frame build, 99th percentile`, percentile(frame, 0.99), "ms", 2);
    row(`${tier}: draw calls, structures within 256 m`, packet.drawCount, "", 300);
    row(`${tier}: triangles submitted`, packet.triangles, "", 1500000);
    if (profile) report(`${tier}: steady frames`, FRAMES);
  }
  if (firstOnly || steadyOnly) continue;
  standOff(0);
  scene.structureDistance = Infinity;
  packet = scene.build(cam, null);
  row("draw calls if every base to the horizon were instanced", packet.drawCount, "");
  row("triangles if every base to the horizon were instanced", packet.triangles, "");
  if (profile) {
    const draws = new Map<string, number>();
    const names = scene.assets.manifest.meshes;
    for (let d = 0; d < packet.drawCount; d++) {
      const id = names[packet.drawMesh[d]!]?.id ?? `mesh ${packet.drawMesh[d]}`;
      const key = `${id.replace(/_(wood|stone|thatch|metal)$/, "_<tier>")} level ${packet.drawLod[d]}`;
      draws.set(key, (draws.get(key) ?? 0) + 1);
    }
    console.log("  draws to the horizon by mesh and level:");
    for (const [k, n] of [...draws].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`    ${k.padEnd(48)} ${n}`);
    spent.clear();
  }

  const t = structs.chunks[siegeChunk]!;
  const hit = new Rng(80);
  const times: number[] = [];
  let uploaded = 0;
  scene.build(cam, null);
  spent.clear();
  for (let i = 0; i < FRAMES; i++) {
    const version = t.version + 1;
    for (let k = 0; k < 50; k++) {
      let slot = hit.int(t.high);
      while (t.kind[slot] === 0) slot = hit.int(t.high);
      structs.put(siegeChunk, slot, t.kind[slot]!, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, t.owner[slot]!, t.hp[slot]! - 1, version);
    }
    structs.setVersion(siegeChunk, version);
    const at = performance.now();
    packet = scene.build(cam, null);
    times.push(performance.now() - at);
    for (const u of packet.uploads) uploaded += u.bytes ?? u.data.length;
  }
  times.sort((a, b) => a - b);
  row("20,000-piece chunk told of 50 damaged pieces: rows in and frame built, median", percentile(times, 0.5), "ms", 1);
  row("the same, 99th percentile", percentile(times, 0.99), "ms", 2);
  row("instance bytes uploaded again in those 300 frames", uploaded, "bytes", 4096);
  if (profile) report("50 damaged pieces, to the horizon", FRAMES);
}
