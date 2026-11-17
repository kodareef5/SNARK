// Pictures of what the frame's budget (client/core/render/budget.ts) gives up in the device page's elder stand, drawn by
// the software rasterizer as the iPhone draws medium: 585 by 1,003 device pixels, levels chosen for its 669 CSS rows and
// 70 degrees high. From the stand's spot (devicescene.ts STAND) the camera turns to the elder oak nearest 20 m off and
// to the one nearest 60 m off, and each view is drawn whole, as its distance asks, and as the budget draws it once its
// squeeze has settled. It prints each picture's triangles, crowns near and squeeze.
//
// With --alone, one elder oak by itself on the same hills, seen from 20 m and 60 m: whole, and at a squeeze held where
// the stand's settled (--squeeze, else 3), with a crop round it made larger; and from 20 m with every leaf draw cut to
// 100, 60 and 30% of its run, the sprays first that tools/pack/sprays.ts ranks first. Not part of the build; it holds
// about 5 GB.
//
//   bun assets/source/core/nodes/trees/squeeze.ts [--alone] [--squeeze 3] [--leaves 1,0.6,0.3]
//     [--out planning/reference/round9-pictures/frame-budget]

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../../../../client/core/assets/tiers.ts";
import { STAND, terrainWood } from "../../../../../client/core/devicescene.ts";
import { Camera } from "../../../../../client/core/render/camera.ts";
import { NodeChanges } from "../../../../../client/core/render/farnodes.ts";
import { DRAW_CUTOUT, type FramePacket } from "../../../../../client/core/render/packet.ts";
import { Scene } from "../../../../../client/core/render/scene.ts";
import { RemoteSample } from "../../../../../client/core/session.ts";
import { CORE_CONTENT } from "../../../../../content/core.ts";
import { chunkAt } from "../../../../../shared/coords.ts";
import { compileContent } from "../../../../../shared/content/registry.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { mapHeightfield, mapNodes, parseMap, resolveNodes, writeMap } from "../../../../../shared/world/mapfile.ts";
import { NodeField, nodeForms, type NodeSource } from "../../../../../shared/world/nodes.ts";
import { StructureStore } from "../../../../../shared/world/structures.ts";
import { FakeNet } from "../../../../../tests/fixtures/assetnet.ts";
import { SOURCE } from "../../../../../tools/art/source.ts";
import { benchHills } from "../../../../../tools/bench/terrain.ts";
import { settle, type ProvingView } from "../../../../../tools/snap.ts";
import { gameFiles } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { Rasterizer } from "../../../../../tools/snap/raster.ts";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1]! : fallback);
const out = resolve(arg("out", "planning/reference/round9-pictures/frame-budget"));
const alone = args.includes("--alone");
const [W, H, ROWS, FOV] = [585, 1003, 669, 70];
const EYE = 1.7;
/** A crop is made about this many pixels across. */
const CROP = 800;

const reg = compileContent(CORE_CONTENT).registry!;
const forms = nodeForms(reg);
const oak = reg.index.get("core:oak")!;
const hills = benchHills();
const map = parseMap(writeMap(resolveNodes({ id: "device:hills", dims: hills.dims, minY: hills.minY, stepY: hills.stepY, seaLevel: -Infinity, heights: hills.heights, tint: hills.tint.fill(12), statics: [], nodes: [terrainWood(hills.dims)], spawns: [{ name: "Middle", x: 4096, z: 4096, yaw: 0 }] }, reg)));
const hf = mapHeightfield(map);
// The elder oak of the second variant at its kind's largest size, alone where the stand's spot is.
const form = forms.first[oak]! + forms.steps[oak]! * 2 - 1;
const lone: NodeSource = {
  perChunk: 1,
  at(chunk, index, spot) {
    spot.kind = 0;
    if (chunk !== chunkAt(map.dims, STAND.x, STAND.z) || index !== 0) return;
    Object.assign(spot, { kind: oak, form, x: STAND.x, y: hf.heightAt(STAND.x, STAND.z), z: STAND.z, yaw: 0 });
  },
};
const source = alone ? lone : mapNodes(map, hf, reg)!;
const tier = tierOf("medium");
const files = await gameFiles(SOURCE);
const port = new FakeNet(files.files, {});
const pack = parsePack(files.files[0]!);
const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
const nodes = new NodeField(map.dims, reg, source);
nodes.retain(chunkAt(map.dims, STAND.x, STAND.z), tier.nodes.chunks, 1, () => false);
const farNodes = { nodes: source, held: (c: number) => nodes.isLoaded(c), gone: () => undefined, changes: new NodeChanges(map.dims) };
const scene = new Scene({ dims: map.dims, hf, structs, nodes: nodes.store, farNodes }, reg, pack, { manifest: files.manifest, port });
scene.assets.tier = tier;
if (scene.nodesFar) scene.nodesFar.makes = Infinity;
scene.viewHeight = ROWS;
scene.hour = 10;
const cam = new Camera();
[cam.aspect, cam.fovY] = [W / H, (FOV * Math.PI) / 180];
const raster = new Rasterizer(W, H, pack, hf, files.manifest);
const remote = new RemoteSample();
const view = { reg, hf, structs, nodes, pack, scene, cam, remote, raster, port, render: () => scene.build(cam, remote) } as unknown as ProvingView;

/** The elder oaks held near, where each stands. */
const oaks: { x: number; y: number; z: number }[] = [];
for (const t of nodes.store.chunks) {
  if (!t) continue;
  for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && forms.depleted[t.kind[s]!] === 0 && forms.kind[t.kind[s]!] === oak) oaks.push({ x: t.x[s]!, y: t.y[s]!, z: t.z[s]! });
}

/** Stands the camera at eye height at (x, z), looking at an oak's crown, 9 m up it. */
function face(x: number, z: number, t: { x: number; y: number; z: number }): void {
  [cam.x, cam.y, cam.z] = [x, hf.heightAt(x, z) + EYE, z];
  cam.yaw = Math.atan2(t.x - cam.x, t.z - cam.z);
  cam.pitch = Math.atan2(t.y + 9 - cam.y, Math.hypot(t.x - cam.x, t.z - cam.z));
}

/**
 * Builds frames, the rasterizer taking each one's uploads, until the card is filled and the squeeze has settled, or is
 * held at `squeeze` where that is not below 0 (null for the budget off); then draws one, with every oak's leaves cut to
 * `leaves` of their run.
 */
function drawn(squeeze: number | null, leaves = 1): FramePacket {
  const b = scene.budget;
  [b.on, b.held] = [squeeze !== null, squeeze !== null && squeeze >= 0];
  b.reset();
  if (b.held) b.squeeze = squeeze!;
  for (let round = 0; round < 8; round++) {
    const before = b.squeeze;
    settle(view, 20000);
    for (let f = 0; f < 150; f++) {
      scene.now += 1000 / 60;
      port.advance(scene.now);
      const p = scene.build(cam, remote);
      p.drawCount = p.tileCount = 0;
      raster.render(p);
    }
    if (round > 0 && Math.abs(b.squeeze - before) < 0.01) break;
  }
  settle(view, 20000);
  scene.now += 1000 / 60;
  const p = scene.build(cam, remote);
  if (leaves < 1) for (let d = 0; d < p.drawCount; d++) if ((p.drawFlags[d]! & DRAW_CUTOUT) !== 0 && /:oak_/.test(pack.header.meshes[p.drawMesh[d]!]?.id ?? "")) p.drawIndexCount[d] = Math.floor((p.drawIndexCount[d]! / 3) * leaves) * 3;
  raster.render(p);
  console.log(`  ${(p.triangles / 1e6).toFixed(2)} M triangles, crowns near ${(b.last.crowns / 1e6).toFixed(2)} M, squeeze ${b.squeeze.toFixed(2)}, ${p.drawCount} draws`);
  return p;
}

/** The picture now in the rasterizer, and a crop `size` pixels square round the middle made about CROP pixels across. */
function save(name: string, size = 0): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${name}.png`), encodePng(W, H, raster.color));
  console.log(`${name}.png`);
  if (size <= 0) return;
  const k = Math.max(1, Math.round(CROP / size));
  const S = size * k;
  const px = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const sx = Math.min(W - 1, Math.max(0, Math.round(W / 2 - size / 2 + x / k)));
      const sy = Math.min(H - 1, Math.max(0, Math.round(H / 2 - size / 2 + y / k)));
      px.set(raster.color.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * S + x) * 4);
    }
  }
  writeFileSync(join(out, `${name}-crop.png`), encodePng(S, S, px));
}

if (!alone) {
  const at = [STAND.x, STAND.z] as const;
  for (const metres of [20, 60]) {
    const t = oaks.reduce((a, b) => (Math.abs(Math.hypot(b.x - at[0], b.z - at[1]) - metres) < Math.abs(Math.hypot(a.x - at[0], a.z - at[1]) - metres) ? b : a));
    face(at[0], at[1], t);
    console.log(`the stand, toward the elder oak ${Math.hypot(t.x - at[0], t.z - at[1]).toFixed(1)} m off, whole and as the budget draws it`);
    drawn(null);
    save(`stand-${metres}m-whole`);
    drawn(-1);
    save(`stand-${metres}m-budget`);
  }
} else {
  const t = oaks[0]!;
  const squeeze = Number(arg("squeeze", "3"));
  for (const metres of [20, 60]) {
    face(t.x, t.z - metres, t);
    // The oak, some 20 m wide and 17 m tall, with room round it.
    const size = Math.min(W, Math.round((26 / metres) * (H / (2 * Math.tan((FOV * Math.PI) / 360)))));
    console.log(`an elder oak alone ${metres} m off, whole and at a squeeze of ${squeeze}`);
    drawn(null);
    save(`oak-${metres}m-whole`, size);
    drawn(squeeze);
    save(`oak-${metres}m-budget`, size);
  }
  face(t.x, t.z - 20, t);
  for (const share of arg("leaves", "1,0.6,0.3").split(",").map(Number)) {
    console.log(`an elder oak alone 20 m off, its leaves cut to ${Math.round(share * 100)}%`);
    drawn(null, share);
    save(`oak-20m-leaves-${Math.round(share * 100)}`, W);
  }
}
console.log(`pictures in ${out}`);
