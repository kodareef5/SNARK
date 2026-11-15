// What a dense wood costs a graphics card, counted the way a phone pays for it: the engine's own frames of a wood of
// 160 slots a chunk, trees, rocks and bushes 3 to 2 to 1 (the far-nodes bench's), from eye height at its middle, turned
// through eight headings, each drawn by the software rasterizer once the card holds all it wants. For every draw the
// frame carries, every fragment each of its front faces covers is counted, drawn or not: a cut-out (SURFACE with a
// discard) pays each of them, since it gets no early depth rejection, and an opaque surface pays only for what is
// nearest, its hidden layers being rejected before they are shaded. A pixel's cost is its cut-out layers and its
// nearest opaque layer, at what the measured phone pays a megapixel a layer (SURFACE 0.85 ms, LIT 0.47); the canvas is
// medium's on that phone, 0.59 megapixels, by default. Not part of the build.
//
//   bun assets/source/core/nodes/trees/wood.ts [--tier medium] [--size 1024x576] [--trees core:tree_1,core:tree_2]
//     [--kind core:tree] [--size-range 0.4,0.75] [--out artifacts/trees/wood.png] [--heat artifacts/trees/heat.png]
//
// --trees names the meshes the wood's trees grow as, in place of the content's; --size-range their sizes.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tierOf } from "../../../../../client/core/assets/tiers.ts";
import { Camera } from "../../../../../client/core/render/camera.ts";
import { NodeChanges } from "../../../../../client/core/render/farnodes.ts";
import { DRAW_CUTOUT, DRAW_SIZED, DRAW_TEXTURED, TRANSIENT_BUFFER, SIZE_REGION } from "../../../../../client/core/render/packet.ts";
import { Scene } from "../../../../../client/core/render/scene.ts";
import { RemoteSample } from "../../../../../client/core/session.ts";
import { CORE_CONTENT } from "../../../../../content/core.ts";
import { chunkAt, type MapDims } from "../../../../../shared/coords.ts";
import { compileContent } from "../../../../../shared/content/registry.ts";
import { INSTANCE_BYTES, parsePack } from "../../../../../shared/pack/pack.ts";
import { Heightfield } from "../../../../../shared/world/heightfield.ts";
import { NodeField, SIZE_UNITS, nodeForms, scatterNodes } from "../../../../../shared/world/nodes.ts";
import { StructureStore } from "../../../../../shared/world/structures.ts";
import { FakeNet } from "../../../../../tests/fixtures/assetnet.ts";
import { SOURCE } from "../../../../../tools/art/source.ts";
import { settle, type ProvingView } from "../../../../../tools/snap.ts";
import { gameFiles } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { Rasterizer } from "../../../../../tools/snap/raster.ts";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1]! : fallback);
const tierName = arg("tier", "medium");
const [W, H] = arg("size", "1024x576").split("x").map(Number) as [number, number];
const SURFACE_MS = 0.85;
const LIT_MS = 0.47;
const PHONE_MP = 0.59;

const DIMS: MapDims = { chunksX: 32, chunksZ: 32 };
const ground = (x: number, z: number): number => 40 + 30 * Math.sin(x / 400) * Math.cos(z / 350) + 8 * Math.sin(x / 53) * Math.sin(z / 61);
const hf = new Heightfield(DIMS, 2, -32, 1 / 256);
for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, ground(i * hf.cell, j * hf.cell));
hf.tint.fill(131);

// The wood's trees as content has them, or grown as the meshes named.
const kindId = arg("kind", "core:tree");
const content = CORE_CONTENT.map((d) => {
  if (d.type !== "node" || d.id !== kindId || !args.includes("--trees")) return d;
  const range = arg("size-range", "").split(",").map(Number);
  return { ...d, variants: arg("trees", "").split(",").map((mesh) => ({ mesh })), size: range.length === 2 ? (range as [number, number]) : d.size };
});
const reg = compileContent(content as typeof CORE_CONTENT).registry!;
const forms = nodeForms(reg);
const kinds = [kindId, kindId, kindId, "core:rock", "core:rock", "core:bush"].map((id) => reg.index.get(id)!);
const source = scatterNodes(DIMS, hf, 0xbe7c, 160, forms, () => kinds);

const files = await gameFiles(SOURCE);
const port = new FakeNet(files.files, {});
const pack = parsePack(files.files[0]!);
const structs = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
const nodes = new NodeField(DIMS, reg, source);
const MID = (DIMS.chunksX * 64) / 2 + 10;
nodes.retain(chunkAt(DIMS, MID, MID), 3, 1, () => false);
const farNodes = { nodes: source, held: (c: number) => nodes.isLoaded(c), gone: () => undefined, changes: new NodeChanges(DIMS) };
const scene = new Scene({ dims: DIMS, hf, structs, nodes: nodes.store, farNodes }, reg, pack, { manifest: files.manifest, port });
scene.assets.tier = tierOf(tierName);
if (scene.nodesFar) scene.nodesFar.makes = Infinity;
scene.viewHeight = H;
scene.hour = 10;
const cam = new Camera();
cam.aspect = W / H;
const raster = new Rasterizer(W, H, pack, hf, files.manifest);
const remote = new RemoteSample();
const proving = { reg, hf, structs, nodes, pack, scene, cam, remote, raster, port, render: () => scene.build(cam, remote) } as unknown as ProvingView;

/** The geometry and instances of a draw, as the rasterizer holds them. */
const card = raster as unknown as {
  decode(mesh: number, level: number, slot: number): { positions: Float32Array; indices: Uint32Array };
  buffers: Map<number, { data: Uint8Array }>;
};

const totals = { cut: 0, nearest: 0, litNearest: 0, covered: 0, ms: 0, p99: 0, most: 0 };
const byMesh = new Map<string, number>();
const meshIds = (files.manifest ?? pack.header).meshes.map((m) => m.id);
/** By level, the instances and triangles a heading draws, on the mean over the headings. */
const levels = new Map<string, { instances: number; triangles: number }>();
let heat: Float32Array | null = null;
const turns = 8;
for (let k = 0; k < turns; k++) {
  [cam.x, cam.y, cam.z] = [MID, hf.heightAt(MID, MID) + 1.7, MID];
  cam.yaw = (k / turns) * Math.PI * 2;
  cam.pitch = 0;
  settle(proving, 20000);
  const p = scene.packet;
  cam.update();
  const vp = cam.viewProj;
  const cut = new Float32Array(W * H);
  // Nearest opaque depth and whether it is lit flat.
  const near = new Float32Array(W * H).fill(Infinity);
  const nearFlat = new Uint8Array(W * H);
  for (let d = 0; d < p.drawCount; d++) {
    const flags = p.drawFlags[d]!;
    const textured = (flags & DRAW_TEXTURED) !== 0;
    const cutout = textured && (flags & DRAW_CUTOUT) !== 0;
    const lod = card.decode(p.drawMesh[d]!, p.drawLod[d]!, p.drawSlot[d]!);
    const transient = p.drawBuffer[d] === TRANSIENT_BUFFER;
    if (transient) continue;
    const data = card.buffers.get(p.drawBuffer[d]!)!.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const [from, to] = textured ? [p.drawFirstIndex[d]!, p.drawFirstIndex[d]! + p.drawIndexCount[d]!] : [0, lod.indices.length];
    const n = lod.positions.length / 3;
    const sx = new Float32Array(n), sy = new Float32Array(n), sw = new Float32Array(n);
    let count = 0;
    const key = `${(meshIds[p.drawMesh[d]!] ?? "?").replace(/_\d+.*$/, "")} level ${p.drawLod[d]}`;
    const tally = levels.get(key) ?? { instances: 0, triangles: 0 };
    if (!textured || from === 0) tally.instances += p.drawInstances[d]! / turns;
    tally.triangles += (((to - from) / 3) * p.drawInstances[d]!) / turns;
    levels.set(key, tally);
    for (let c = 0; c < p.drawInstances[d]!; c++) {
      const at = (p.drawFirst[d]! + c) * INSTANCE_BYTES;
      const yaw = (view.getUint16(at + 12, true) / 65536) * Math.PI * 2;
      const [s, co] = [Math.sin(yaw), Math.cos(yaw)];
      const grow = (flags & DRAW_SIZED) !== 0 ? data[at + 14 + SIZE_REGION]! / SIZE_UNITS : 1;
      const [ix, iy, iz] = [view.getFloat32(at, true) + p.drawOffset[d * 3]!, view.getFloat32(at + 4, true) + p.drawOffset[d * 3 + 1]!, view.getFloat32(at + 8, true) + p.drawOffset[d * 3 + 2]!];
      for (let v = 0; v < n; v++) {
        const lx = lod.positions[v * 3]! * grow, ly = lod.positions[v * 3 + 1]! * grow, lz = lod.positions[v * 3 + 2]! * grow;
        const x = co * lx + s * lz + ix, y = ly + iy, z = -s * lx + co * lz + iz;
        const w = vp[3]! * x + vp[7]! * y + vp[11]! * z;
        sw[v] = w;
        sx[v] = (((vp[0]! * x + vp[4]! * y + vp[8]! * z) / w) * 0.5 + 0.5) * W;
        sy[v] = (0.5 - ((vp[1]! * x + vp[5]! * y + vp[9]! * z) / w) * 0.5) * H;
      }
      for (let t = from; t < to; t += 3) {
        const a = lod.indices[t]!, b = lod.indices[t + 1]!, e = lod.indices[t + 2]!;
        if (sw[a]! < cam.near || sw[b]! < cam.near || sw[e]! < cam.near) continue;
        const area = (sx[b]! - sx[a]!) * (sy[e]! - sy[a]!) - (sx[e]! - sx[a]!) * (sy[b]! - sy[a]!);
        // Screen y runs down, so a face toward the camera winds clockwise here.
        if (area >= 0) continue;
        const x0 = Math.max(0, Math.floor(Math.min(sx[a]!, sx[b]!, sx[e]!)));
        const x1 = Math.min(W - 1, Math.ceil(Math.max(sx[a]!, sx[b]!, sx[e]!)));
        const y0 = Math.max(0, Math.floor(Math.min(sy[a]!, sy[b]!, sy[e]!)));
        const y1 = Math.min(H - 1, Math.ceil(Math.max(sy[a]!, sy[b]!, sy[e]!)));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const px = x + 0.5, py = y + 0.5;
            const e0 = (sx[b]! - sx[a]!) * (py - sy[a]!) - (sy[b]! - sy[a]!) * (px - sx[a]!);
            const e1 = (sx[e]! - sx[b]!) * (py - sy[b]!) - (sy[e]! - sy[b]!) * (px - sx[b]!);
            const e2 = (sx[a]! - sx[e]!) * (py - sy[e]!) - (sy[a]! - sy[e]!) * (px - sx[e]!);
            if (e0 > 0 || e1 > 0 || e2 > 0) continue;
            const i = y * W + x;
            if (cutout) {
              cut[i]!++;
              count++;
              continue;
            }
            // Depth at the pixel, near enough: the triangle's nearest corner.
            const depth = Math.min(sw[a]!, sw[b]!, sw[e]!);
            if (depth < near[i]!) {
              near[i] = depth;
              nearFlat[i] = textured ? 0 : 1;
            }
          }
        }
      }
    }
    if (cutout) byMesh.set(`level ${p.drawLod[d]}`, (byMesh.get(`level ${p.drawLod[d]}`) ?? 0) + count);
  }
  let cuts = 0, nearest = 0, litNearest = 0, covered = 0;
  for (let i = 0; i < W * H; i++) {
    cuts += cut[i]!;
    if (near[i]! < Infinity) {
      if (nearFlat[i]) litNearest++;
      else nearest++;
    }
    if (cut[i]! > 0 || near[i]! < Infinity) covered++;
  }
  const sorted = Float32Array.from(cut).sort();
  totals.cut += cuts / turns;
  totals.nearest += nearest / turns;
  totals.litNearest += litNearest / turns;
  totals.covered += covered / turns;
  totals.p99 = Math.max(totals.p99, sorted[Math.floor(sorted.length * 0.99)]!);
  totals.most = Math.max(totals.most, sorted[sorted.length - 1]!);
  if (k === 0) {
    heat = cut;
    const out = resolve(arg("out", "artifacts/trees/wood.png"));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, encodePng(W, H, raster.color));
  }
}
const px = W * H;
const scale = PHONE_MP / (px / 1e6);
const ms = ((totals.cut * SURFACE_MS + totals.nearest * SURFACE_MS + totals.litNearest * LIT_MS) / 1e6) * scale;
console.log(`${tierName}, ${W}x${H}, ${turns} headings: cut-out layers ${(totals.cut / px).toFixed(2)} a pixel of the screen, ${(totals.cut / Math.max(totals.covered, 1)).toFixed(2)} a pixel of the wood (${((100 * totals.covered) / px).toFixed(0)}% of the screen), 99th percentile ${totals.p99}, most ${totals.most}`);
console.log(`  nearest opaque: textured ${((100 * totals.nearest) / px).toFixed(0)}%, flat ${((100 * totals.litNearest) / px).toFixed(0)}% of the screen`);
console.log(`  on the phone's figures, ${PHONE_MP} MP: cut-out ${((totals.cut * SURFACE_MS) / 1e6 * scale).toFixed(2)} ms, nearest opaque ${(((totals.nearest * SURFACE_MS + totals.litNearest * LIT_MS) / 1e6) * scale).toFixed(2)} ms, ${ms.toFixed(2)} ms in all`);
console.log(`  cut-out layers by level: ${[...byMesh].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / turns / px).toFixed(2)}`).join(", ")}`);
const all = [...levels.values()].reduce((n, l) => n + l.triangles, 0);
console.log(`  drawn a heading: ${(all / 1000).toFixed(0)} k triangles; by level ${[...levels].sort().map(([k, l]) => `${k} ${l.instances.toFixed(0)} drawn, ${(l.triangles / 1000).toFixed(0)} k`).join("; ")}`);
if (args.includes("--heat") && heat) {
  const img = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    const t = Math.min(1, heat[i]! / 10);
    img.set([255 * Math.min(1, t * 2), 255 * Math.max(0, 1 - Math.abs(t - 0.5) * 2), 255 * Math.max(0, 1 - t * 2), 255], i * 4);
  }
  const out = resolve(arg("heat", "artifacts/trees/heat.png"));
  writeFileSync(out, encodePng(W, H, img));
}
