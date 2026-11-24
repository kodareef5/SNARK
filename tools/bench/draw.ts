// What drawing built pieces costs a frame, on its own: bun tools/bench/draw.ts [--trims]
//
// A 20,000-piece wood chunk and a 2,000-piece base, on medium, levels drawn with their materials, as tools/bench.ts
// measures "frame build": the time of Scene.build over 300 frames as the camera turns, median and 99th percentile.
// Then 50 pieces told across a damage stage every frame, with the bytes that sends the card, and the chunk laid out
// again. --trims gives wood stand-in joints and a skirt (tests/fixtures/trims.ts), so the layout finds every corner.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { buildCorePack } from "../pack/build.ts";
import type { SourceMesh } from "../pack/write.ts";
import { asTextured, boxBase } from "./base.ts";

const percentile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
const row = (name: string, value: number, unit: string): void => console.log(`${name.padEnd(74)} ${value.toFixed(unit === "ms" ? 3 : 0)} ${unit}`);

const trims = process.argv.includes("--trims");
const extra: SourceMesh[] = trims ? (await import("../../tests/fixtures/trims.ts")).standInTrims("wood") : [];
const reg = compileContent(CORE_CONTENT).registry!;
const pack = parsePack(buildCorePack(extra));
const dims = { chunksX: 16, chunksZ: 16 };
const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 64);
hf.heights.fill(32 * 64);
const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
// The siege's chunk, and a base of 2,000 pieces well clear of it.
const [sx, sz] = [64 * 6, 64 * 6];
for (const [kind, x, y, z, yaw] of boxBase(reg, "wood", sx + 0.5, 0, sz + 0.5, 21, 1, 20000)) structs.add(kind, x, y, z, yaw, 1, reg.maxHp[kind]!);
for (const [kind, x, y, z, yaw] of boxBase(reg, "wood", 64 * 11, 0, 64 * 11, 14, 3, 2000)) structs.add(kind, x, y, z, yaw, 1, reg.maxHp[kind]!);
const siege = 6 * dims.chunksX + 6;
const t = structs.chunks[siege]!;

const scene = new Scene({ dims, hf, structs }, reg, pack);
asTextured(scene);
scene.assets.tier = tierOf("medium");
scene.structureDistance = 256;
const cam = new Camera();

function frames(name: string, each: () => void = () => {}, after: () => void = () => {}): void {
  const ms: number[] = [];
  for (let i = 0; i < 4; i++) scene.build(cam, null);
  for (let i = 0; i < 300; i++) {
    cam.yaw += 0.002;
    each();
    const at = performance.now();
    scene.build(cam, null);
    ms.push(performance.now() - at);
    after();
  }
  ms.sort((a, b) => a - b);
  row(`${name}, median`, percentile(ms, 0.5), "ms");
  row(`${name}, 99th percentile`, percentile(ms, 0.99), "ms");
}

console.log(`drawing built pieces${trims ? ", wood with stand-in trims" : ""}`);
let at = performance.now();
let packet = scene.build(cam, null);
row("first frame, every chunk laid out", performance.now() - at, "ms");

[cam.x, cam.y, cam.z, cam.yaw] = [64 * 11 + 21 + 60, 8, 64 * 11 + 21, Math.PI / 2 + Math.PI];
frames("the 2,000-piece base from 60 m: frame build");
packet = scene.build(cam, null);
row("its draws", packet.drawCount, "");

[cam.x, cam.y, cam.z, cam.yaw] = [sx + 63.5 + 30, 1.7, sz + 32, Math.PI / 2 + Math.PI];
frames("the 20,000-piece chunk from 30 m: frame build");
packet = scene.build(cam, null);
row("its draws", packet.drawCount, "");
row("its triangles", packet.triangles, "");

// As a client is told: each damaged row whole, then the chunk's new version. Each crosses a stage, there or back.
const hit = new Rng(80);
let uploaded = 0, whole = 0, told = 0;
frames("50 of its pieces told across a stage: take the rows in and build the frame", () => {
  const version = t.version + 1;
  for (let k = 0; k < 50; k++) {
    let slot = hit.int(t.high);
    while (t.kind[slot] === 0) slot = hit.int(t.high);
    const max = reg.maxHp[t.kind[slot]!]!;
    structs.put(siege, slot, t.kind[slot]!, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, t.owner[slot]!, t.hp[slot]! < max ? max : max * 0.6, version);
    told++;
  }
  structs.setVersion(siege, version);
}, () => {
  for (const u of scene.packet.uploads) {
    const bytes = (u as { bytes?: number }).bytes;
    if (bytes === undefined) whole += u.data.length;
    else uploaded += bytes;
  }
});
row("rows told in those frames", told, "");
row("instance bytes sent as parts of the buffer", uploaded, "bytes");
row("instance bytes sent as whole buffers", whole, "bytes");

// The chunk laid out again, as when a piece is set down in it: its shape is made to differ.
const lay: number[] = [];
const kind = reg.index.get("core:storage_box")!;
for (let i = 0; i < 60; i++) {
  const ref = structs.add(kind, sx + 32, 200 + i, sz + 32, 0, 1, 100);
  at = performance.now();
  scene.build(cam, null);
  lay.push(performance.now() - at);
  structs.remove(ref, 0);
}
lay.sort((a, b) => a - b);
row("the 20,000-piece chunk laid out again and the frame built, median", percentile(lay, 0.5), "ms");
row("the 20,000-piece chunk laid out again and the frame built, 99th percentile", percentile(lay, 0.99), "ms");
