// What a dense wood costs a graphics card, counted the way a phone pays for it: the engine's own frames of a wood of
// 160 slots a chunk, trees, rocks and bushes 3 to 2 to 1 (the far-nodes bench's), from eye height at its middle, turned
// through eight headings, each drawn by the software rasterizer once the card holds all it wants. For every draw of the
// near range, every fragment each face it shows covers is counted, drawn or not, at its depth. An opaque surface pays
// only for what is nearest, its hidden layers being rejected before they are shaded. A cut-out (SURFACE with a discard)
// pays for every fragment the GPU does not reject first: those nearer than the opaque surfaces drawn before it. Once
// every opaque draw of a step comes before every cut-out one (scene.ts `cutouts`), that is those in front of the
// nearest opaque surface, the ground included; in the order the draws were made, which the frames are built in, those
// in front of the opaque drawn before them; with every cut-out draw first, those in front of the ground. A pixel's
// cost is its cut-out layers and its nearest opaque layer, at what the measured phone pays a megapixel a layer
// (SURFACE 0.85 ms, LIT 0.47); the canvas is medium's on that phone, 0.59 megapixels, by default. Not part of the build.
//
//   bun assets/source/core/nodes/trees/wood.ts [--tier medium] [--size 1024x576] [--trees core:tree_1,core:tree_2]
//     [--kind core:tree] [--size-range 0.4,0.75] [--out artifacts/trees/wood.png] [--heat artifacts/trees/heat.png]
//     [--map hills.snmap] [--at x,z] [--fov 70] [--rows 576] [--headings 8] [--json]
//
// --trees names the meshes the wood's trees grow as, in place of the content's; --size-range their sizes. --map counts
// on a map file's ground and nodes in place of the hills and their wood, from eye height at (x, z) or the map's first
// spawn point, as the device page's tree rung is drawn (tools/device.ts). --fov is the view's height in degrees, --rows
// the rows levels are chosen for (a page's CSS pixels), and --json prints the counts as one line and no picture.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tierOf } from "../../../../../client/core/assets/tiers.ts";
import { Camera } from "../../../../../client/core/render/camera.ts";
import { NodeChanges } from "../../../../../client/core/render/farnodes.ts";
import { DRAW_BLEND, DRAW_CUTOUT, DRAW_NEAR, DRAW_PULLED, DRAW_SIZED, DRAW_TEXTURED, DRAW_TWO_SIDED, PASS_NEAR, SIZE_REGION, TILE_QUADS, TRANSIENT_BUFFER, type FramePacket } from "../../../../../client/core/render/packet.ts";
import { Scene } from "../../../../../client/core/render/scene.ts";
import { RemoteSample } from "../../../../../client/core/session.ts";
import { CORE_CONTENT } from "../../../../../content/core.ts";
import { chunkAt, type MapDims } from "../../../../../shared/coords.ts";
import { compileContent } from "../../../../../shared/content/registry.ts";
import { INSTANCE_BYTES, parsePack } from "../../../../../shared/pack/pack.ts";
import { Heightfield } from "../../../../../shared/world/heightfield.ts";
import { mapHeightfield, mapNodes, parseMap } from "../../../../../shared/world/mapfile.ts";
import { NodeField, SIZE_UNITS, nodeForms, scatterNodes, type NodeSource } from "../../../../../shared/world/nodes.ts";
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
const tier = tierOf(tierName);
const [W, H] = arg("size", "1024x576").split("x").map(Number) as [number, number];
const json = args.includes("--json");
const turns = Number(arg("headings", "8"));
const SURFACE_MS = 0.85;
const LIT_MS = 0.47;
const PHONE_MP = 0.59;
const EYE = 1.7;

// The wood's trees as content has them, or grown as the meshes named.
const kindId = arg("kind", "core:tree");
const content = CORE_CONTENT.map((d) => {
  if (d.type !== "node" || d.id !== kindId || !args.includes("--trees")) return d;
  const range = arg("size-range", "").split(",").map(Number);
  return { ...d, variants: arg("trees", "").split(",").map((mesh) => ({ mesh })), size: range.length === 2 ? (range as [number, number]) : d.size };
});
const reg = compileContent(content as typeof CORE_CONTENT).registry!;

/** The ground and its nodes: a map file's, or hills 2 km across with the bench's wood on them; and where the eye stands. */
function ground(): { dims: MapDims; hf: Heightfield; source: NodeSource; at: number[] } {
  const at = arg("at", "").split(",").filter((s) => s !== "").map(Number);
  const file = arg("map", "");
  if (file) {
    const map = parseMap(new Uint8Array(readFileSync(file)));
    const hf = mapHeightfield(map);
    const source = mapNodes(map, hf, reg);
    if (!source) throw new Error(`${file} has no nodes`);
    return { dims: map.dims, hf, source, at: at.length === 2 ? at : [map.spawns[0]!.x, map.spawns[0]!.z] };
  }
  const dims = { chunksX: 32, chunksZ: 32 };
  const height = (x: number, z: number): number => 40 + 30 * Math.sin(x / 400) * Math.cos(z / 350) + 8 * Math.sin(x / 53) * Math.sin(z / 61);
  const hf = new Heightfield(dims, 2, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, height(i * hf.cell, j * hf.cell));
  hf.tint.fill(131);
  const kinds = [kindId, kindId, kindId, "core:rock", "core:rock", "core:bush"].map((id) => reg.index.get(id)!);
  const mid = (dims.chunksX * 64) / 2 + 10;
  return { dims, hf, source: scatterNodes(dims, hf, 0xbe7c, 160, nodeForms(reg), () => kinds), at: at.length === 2 ? at : [mid, mid] };
}
const { dims, hf, source, at } = ground();
const [atX, atZ] = at as [number, number];

const files = await gameFiles(SOURCE);
const port = new FakeNet(files.files, {});
const pack = parsePack(files.files[0]!);
const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
const nodes = new NodeField(dims, reg, source);
nodes.retain(chunkAt(dims, atX, atZ), tier.nodes.chunks, 1, () => false);
const farNodes = { nodes: source, held: (c: number) => nodes.isLoaded(c), gone: () => undefined, changes: new NodeChanges(dims) };
const scene = new Scene({ dims, hf, structs, nodes: nodes.store, farNodes }, reg, pack, { manifest: files.manifest, port });
scene.assets.tier = tier;
if (scene.nodesFar) scene.nodesFar.makes = Infinity;
scene.viewHeight = Number(arg("rows", String(H)));
scene.hour = 10;
// In the order the draws were made, so that one frame gives what both orders shade: the picture is the same.
scene.cutouts = "made";
const cam = new Camera();
cam.aspect = W / H;
cam.fovY = (Number(arg("fov", "70")) * Math.PI) / 180;
const raster = new Rasterizer(W, H, pack, hf, files.manifest);
const remote = new RemoteSample();
const proving = { reg, hf, structs, nodes, pack, scene, cam, remote, raster, port, render: () => scene.build(cam, remote) } as unknown as ProvingView;

/** The geometry and instances of a draw, as the rasterizer holds them. */
const card = raster as unknown as {
  decode(mesh: number, level: number, slot: number): { positions: Float32Array; indices: Uint32Array };
  buffers: Map<number, { data: Uint8Array }>;
};

const px = W * H;
/** Per pixel: cut-out fragments; the nearest ground; the nearest opaque so far, the ground included; the nearest opaque draw, and whether it is flat. */
const cut = new Float32Array(px);
const groundAt = new Float32Array(px);
const drawn = new Float32Array(px);
const near = new Float32Array(px);
const nearFlat = new Uint8Array(px);
let [xs, ys, ws] = [new Float32Array(0), new Float32Array(0), new Float32Array(0)];
const room = (n: number): void => {
  if (xs.length < n) [xs, ys, ws] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
};

/** Screen x, y and view depth of a camera-relative point, into the scratch at `v`. */
function project(v: number, x: number, y: number, z: number): void {
  const m = cam.viewProj;
  const w = m[3]! * x + m[7]! * y + m[11]! * z;
  ws[v] = w;
  xs[v] = (((m[0]! * x + m[4]! * y + m[8]! * z) / w) * 0.5 + 0.5) * W;
  ys[v] = (0.5 - ((m[1]! * x + m[5]! * y + m[9]! * z) / w) * 0.5) * H;
}

/** Each pixel whose middle a triangle of the scratch covers, with its view depth there; a face turned away only if `both`. */
function cover(a: number, b: number, c: number, both: boolean, each: (i: number, w: number) => void): void {
  if (ws[a]! < cam.near || ws[b]! < cam.near || ws[c]! < cam.near) return;
  const ax = xs[a]!, ay = ys[a]!, bx = xs[b]!, by = ys[b]!, cx = xs[c]!, cy = ys[c]!;
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  // Screen y runs down, so a face toward the camera winds clockwise here.
  if (area === 0 || (area > 0 && !both)) return;
  const s = area < 0 ? 1 : -1;
  const [ia, ib, ic] = [1 / ws[a]!, 1 / ws[b]!, 1 / ws[c]!];
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const qx = x + 0.5;
      const e0 = ((bx - ax) * (py - ay) - (by - ay) * (qx - ax)) * s;
      const e1 = ((cx - bx) * (py - by) - (cy - by) * (qx - bx)) * s;
      const e2 = ((ax - cx) * (py - cy) - (ay - cy) * (qx - cx)) * s;
      if (e0 > 0 || e1 > 0 || e2 > 0) continue;
      // One over depth runs straight across the screen, each corner's weighed by the edge across from it.
      each(y * W + x, (e0 + e1 + e2) / (e1 * ia + e2 * ib + e0 * ic));
    }
  }
}

/** Every fragment of draw `d`, turned and sized as each instance is. */
function fragments(p: FramePacket, d: number, each: (i: number, w: number) => void): void {
  const flags = p.drawFlags[d]!;
  const lod = card.decode(p.drawMesh[d]!, p.drawLod[d]!, p.drawSlot[d]!);
  const data = card.buffers.get(p.drawBuffer[d]!)!.data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const [from, to] = (flags & DRAW_TEXTURED) !== 0 ? [p.drawFirstIndex[d]!, p.drawFirstIndex[d]! + p.drawIndexCount[d]!] : [0, lod.indices.length];
  const both = (flags & DRAW_TWO_SIDED) !== 0;
  const n = lod.positions.length / 3;
  room(n);
  for (let c = 0; c < p.drawInstances[d]!; c++) {
    const at = (p.drawFirst[d]! + c) * INSTANCE_BYTES;
    const yaw = (view.getUint16(at + 12, true) / 65536) * Math.PI * 2;
    const [s, co] = [Math.sin(yaw), Math.cos(yaw)];
    const grow = (flags & DRAW_SIZED) !== 0 ? data[at + 14 + SIZE_REGION]! / SIZE_UNITS : 1;
    const [ix, iy, iz] = [view.getFloat32(at, true) + p.drawOffset[d * 3]!, view.getFloat32(at + 4, true) + p.drawOffset[d * 3 + 1]!, view.getFloat32(at + 8, true) + p.drawOffset[d * 3 + 2]!];
    for (let v = 0; v < n; v++) {
      const lx = lod.positions[v * 3]! * grow, ly = lod.positions[v * 3 + 1]! * grow, lz = lod.positions[v * 3 + 2]! * grow;
      project(v, co * lx + s * lz + ix, ly + iy, -s * lx + co * lz + iz);
    }
    for (let t = from; t < to; t += 3) cover(lod.indices[t]!, lod.indices[t + 1]!, lod.indices[t + 2]!, both, each);
  }
}

/** The nearest ground in each pixel, from the terrain tiles of the near range as the GPU draws them. */
function groundDepth(p: FramePacket): void {
  groundAt.fill(Infinity);
  const row = TILE_QUADS + 1;
  room(row * row);
  for (let t = 0; t < p.tileCount; t++) {
    if ((p.tilePass[t]! & (1 << PASS_NEAR)) === 0) continue;
    const stride = p.tiles[t * 4 + 3]!;
    const [i0, j0] = [p.tileOrigin[t * 2]!, p.tileOrigin[t * 2 + 1]!];
    for (let gz = 0; gz < row; gz++) {
      for (let gx = 0; gx < row; gx++) {
        const [i, j] = [Math.min(i0 + gx * stride, hf.nx - 1), Math.min(j0 + gz * stride, hf.nz - 1)];
        project(gz * row + gx, i * hf.cell - p.camX, hf.sample(i, j) - p.camY, j * hf.cell - p.camZ);
      }
    }
    const nearer = (i: number, w: number): void => void (w < groundAt[i]! && (groundAt[i] = w));
    for (let gz = 0; gz < TILE_QUADS; gz++) {
      for (let gx = 0; gx < TILE_QUADS; gx++) {
        const a = gz * row + gx;
        cover(a + row + 1, a + 1, a, true, nearer);
        cover(a + row, a + row + 1, a, true, nearer);
      }
    }
  }
}

const totals = { cut: 0, front: 0, old: 0, first: 0, nearest: 0, litNearest: 0, covered: 0, p99: 0, most: 0 };
const byMesh = new Map<string, number>();
const meshIds = (files.manifest ?? pack.header).meshes.map((m) => m.id);
/** By level, the instances and triangles a heading draws, on the mean over the headings. */
const levels = new Map<string, { instances: number; triangles: number }>();
let heat: Float32Array | null = null;
for (let k = 0; k < turns; k++) {
  [cam.x, cam.y, cam.z] = [atX, hf.heightAt(atX, atZ) + EYE, atZ];
  cam.yaw = (k / turns) * Math.PI * 2;
  cam.pitch = 0;
  settle(proving, 20000);
  const p = scene.packet;
  cam.update();
  cut.fill(0);
  near.fill(Infinity);
  nearFlat.fill(0);
  groundDepth(p);
  drawn.set(groundAt);
  // In the order the frame has them: an opaque draw hides from what comes after it, a cut-out one counts its fragments,
  // those nearer than what was drawn before them, and those nearer than the ground. The viewer's own body, bodies, far
  // nodes from their atlas rows, what is seen through and the far range are left out.
  let [old, first] = [0, 0];
  const cutouts: number[] = [];
  for (let d = 0; d < p.drawCount; d++) {
    const flags = p.drawFlags[d]!;
    if (p.drawBuffer[d] === TRANSIENT_BUFFER || p.drawPass[d] !== PASS_NEAR || (flags & (DRAW_PULLED | DRAW_BLEND | DRAW_NEAR)) !== 0) continue;
    const textured = (flags & DRAW_TEXTURED) !== 0;
    const key = `${(meshIds[p.drawMesh[d]!] ?? "?").replace(/_\d+.*$/, "")} level ${p.drawLod[d]}`;
    const tally = levels.get(key) ?? { instances: 0, triangles: 0 };
    if (!textured || p.drawFirstIndex[d] === 0) tally.instances += p.drawInstances[d]! / turns;
    tally.triangles += (((textured ? p.drawIndexCount[d]! : card.decode(p.drawMesh[d]!, p.drawLod[d]!, p.drawSlot[d]!).indices.length) / 3) * p.drawInstances[d]!) / turns;
    levels.set(key, tally);
    if (textured && (flags & DRAW_CUTOUT) !== 0) {
      cutouts.push(d);
      let count = 0;
      fragments(p, d, (i, w) => {
        cut[i]!++;
        count++;
        if (w < drawn[i]!) old++;
        if (w < groundAt[i]!) first++;
      });
      byMesh.set(key, (byMesh.get(key) ?? 0) + count);
      continue;
    }
    fragments(p, d, (i, w) => {
      if (w < drawn[i]!) drawn[i] = w;
      if (w < near[i]!) [near[i], nearFlat[i]] = [w, textured ? 0 : 1];
    });
  }
  // Once every opaque draw is in, those in front of the nearest opaque surface.
  let front = 0;
  for (const d of cutouts) fragments(p, d, (i, w) => void (w < drawn[i]! && front++));
  let cuts = 0, nearest = 0, litNearest = 0, covered = 0;
  for (let i = 0; i < px; i++) {
    cuts += cut[i]!;
    if (near[i]! < Infinity) {
      if (nearFlat[i]) litNearest++;
      else nearest++;
    }
    if (cut[i]! > 0 || near[i]! < Infinity) covered++;
  }
  const sorted = Float32Array.from(cut).sort();
  totals.cut += cuts / turns;
  totals.front += front / turns;
  totals.old += old / turns;
  totals.first += first / turns;
  totals.nearest += nearest / turns;
  totals.litNearest += litNearest / turns;
  totals.covered += covered / turns;
  totals.p99 = Math.max(totals.p99, sorted[Math.floor(sorted.length * 0.99)]!);
  totals.most = Math.max(totals.most, sorted[sorted.length - 1]!);
  if (k === 0) {
    heat = cut.slice();
    const out = arg("out", json ? "" : "artifacts/trees/wood.png");
    if (out) {
      mkdirSync(dirname(resolve(out)), { recursive: true });
      writeFileSync(resolve(out), encodePng(W, H, raster.color));
    }
  }
}
const scale = PHONE_MP / (px / 1e6);
const layers = (n: number): number => Math.round((n / px) * 1000) / 1000;
if (json) {
  console.log(JSON.stringify({ tier: tierName, size: [W, H], rows: scene.viewHeight, fov: Math.round((cam.fovY * 180) / Math.PI), at: [atX, atZ], headings: turns, cut: layers(totals.cut), front: layers(totals.front), old: layers(totals.old), first: layers(totals.first), covered: layers(totals.covered), nearest: layers(totals.nearest), litNearest: layers(totals.litNearest) }));
  process.exit(0);
}
const ms = ((totals.cut * SURFACE_MS + totals.nearest * SURFACE_MS + totals.litNearest * LIT_MS) / 1e6) * scale;
console.log(`${tierName}, ${W}x${H}, ${turns} headings: cut-out layers ${(totals.cut / px).toFixed(2)} a pixel of the screen, ${(totals.cut / Math.max(totals.covered, 1)).toFixed(2)} a pixel of the wood (${((100 * totals.covered) / px).toFixed(0)}% of the screen), 99th percentile ${totals.p99}, most ${totals.most}`);
console.log(`  in front of the nearest opaque surface, the ground's included: ${(totals.front / px).toFixed(2)} a pixel, ${((100 * totals.front) / Math.max(totals.cut, 1)).toFixed(0)}% of them; in the order the draws were made, in front of the opaque drawn before them: ${(totals.old / px).toFixed(2)}; in front of the ground: ${(totals.first / px).toFixed(2)}`);
console.log(`  nearest opaque: textured ${((100 * totals.nearest) / px).toFixed(0)}%, flat ${((100 * totals.litNearest) / px).toFixed(0)}% of the screen`);
console.log(`  on the phone's figures, ${PHONE_MP} MP: cut-out ${((totals.cut * SURFACE_MS) / 1e6 * scale).toFixed(2)} ms, of it in front ${((totals.front * SURFACE_MS) / 1e6 * scale).toFixed(2)} ms; nearest opaque ${(((totals.nearest * SURFACE_MS + totals.litNearest * LIT_MS) / 1e6) * scale).toFixed(2)} ms, ${ms.toFixed(2)} ms in all`);
console.log(`  cut-out layers by mesh and level: ${[...byMesh].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / turns / px).toFixed(2)}`).join(", ")}`);
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
