// Pictures of what the frame's budget (client/core/render/budget.ts) gives up in the device page's elder stand, drawn by
// the software rasterizer as the iPhone draws medium: 585 by 1,003 device pixels, levels chosen for its 669 CSS rows and
// 70 degrees. From the stand's spot (devicescene.ts STAND) the camera turns to the elder oak nearest 20 m off and to the
// one nearest 60 m off; each view is drawn whole, as its distance asks, and as the budget draws it once its squeeze has
// settled, with a crop round the oak made larger. Then the oak 20 m off with every crown's leaves at 100, 60
// and 30%, the sprays drawn first as tools/pack/sprays.ts ranks them. It prints each picture's triangles, crowns near
// and squeeze. Not part of the build; it holds about 5 GB.
//
//   bun assets/source/core/nodes/trees/squeeze.ts [--out planning/reference/round9-pictures/frame-budget]
//     [--leaves 1,0.6,0.3] [--only leaves]

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
import { mapHeightfield, mapNodes, parseMap, writeMap } from "../../../../../shared/world/mapfile.ts";
import { NodeField, nodeForms } from "../../../../../shared/world/nodes.ts";
import { StructureStore } from "../../../../../shared/world/structures.ts";
import { FakeNet } from "../../../../../tests/fixtures/assetnet.ts";
import { SOURCE } from "../../../../../tools/art/source.ts";
import { benchHills } from "../../../../../tools/bench/terrain.ts";
import { settle, type ProvingView } from "../../../../../tools/snap.ts";
import { gameFiles } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { Rasterizer } from "../../../../../tools/snap/raster.ts";

const args = process.argv.slice(2);
const out = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1]! : "planning/reference/round9-pictures/frame-budget");
const [W, H, ROWS, FOV] = [585, 1003, 669, 70];
const EYE = 1.7;
/** A crop is made this many pixels across, or as near as whole pixels allow. */
const CROP = 800;

const reg = compileContent(CORE_CONTENT).registry!;
const hills = benchHills();
const map = parseMap(writeMap({ id: "device:hills", dims: hills.dims, minY: hills.minY, stepY: hills.stepY, seaLevel: -Infinity, heights: hills.heights, tint: hills.tint.fill(12), statics: [], nodes: [terrainWood(hills.dims)], spawns: [{ name: "Middle", x: 4096, z: 4096, yaw: 0 }] }));
const hf = mapHeightfield(map);
const source = mapNodes(map, hf, reg)!;
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
[cam.x, cam.y, cam.z] = [STAND.x, hf.heightAt(STAND.x, STAND.z) + EYE, STAND.z];
const raster = new Rasterizer(W, H, pack, hf, files.manifest);
const remote = new RemoteSample();
const view = { reg, hf, structs, nodes, pack, scene, cam, remote, raster, port, render: () => scene.build(cam, remote) } as unknown as ProvingView;

/** The elder oaks of the stand, where each stands and how far from the camera. */
const oaks: { x: number; y: number; z: number; far: number }[] = [];
const forms = nodeForms(reg);
for (const t of nodes.store.chunks) {
  if (!t) continue;
  for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && forms.depleted[t.kind[s]!] === 0 && reg.defs[forms.kind[t.kind[s]!]!]?.id === "core:oak") oaks.push({ x: t.x[s]!, y: t.y[s]!, z: t.z[s]!, far: Math.hypot(t.x[s]! - cam.x, t.z[s]! - cam.z) });
}
const nearest = (metres: number) => oaks.reduce((a, b) => (Math.abs(b.far - metres) < Math.abs(a.far - metres) ? b : a));

/** Turns the camera to look at a crown's middle, 9 m up the oak. */
function face(t: { x: number; y: number; z: number }): void {
  cam.yaw = Math.atan2(t.x - cam.x, t.z - cam.z);
  cam.pitch = Math.atan2(t.y + 9 - cam.y, Math.hypot(t.x - cam.x, t.z - cam.z));
}

/** Builds frames, the rasterizer taking each one's uploads, until the card is filled and the squeeze has settled; then draws one. */
function drawn(on: boolean, leaves = 1): FramePacket {
  scene.budget.on = on;
  for (let round = 0; round < 8; round++) {
    const before = scene.budget.squeeze;
    settle(view, 20000);
    for (let f = 0; f < 150; f++) {
      scene.now += 1000 / 60;
      port.advance(scene.now);
      const p = scene.build(cam, remote);
      p.drawCount = p.tileCount = 0;
      raster.render(p);
    }
    if (round > 0 && Math.abs(scene.budget.squeeze - before) < 0.01) break;
  }
  settle(view, 20000);
  scene.now += 1000 / 60;
  const p = scene.build(cam, remote);
  // Every crown's leaves cut to a share of their run, as the scene draws a thinned crown.
  if (leaves < 1) for (let d = 0; d < p.drawCount; d++) if ((p.drawFlags[d]! & DRAW_CUTOUT) !== 0 && /:(tree|oak|fig|banyan|mangrove|palm)_/.test(pack.header.meshes[p.drawMesh[d]!]?.id ?? "")) p.drawIndexCount[d] = Math.floor((p.drawIndexCount[d]! / 3) * leaves) * 3;
  raster.render(p);
  return p;
}

/** The picture now in the rasterizer, and a crop round (cx, cy) `size` pixels square made about CROP pixels across. */
function save(name: string, crop: { cx: number; cy: number; size: number } | null): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${name}.png`), encodePng(W, H, raster.color));
  if (!crop) return;
  const k = Math.max(1, Math.round(CROP / crop.size));
  const S = crop.size * k;
  const px = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const sx = Math.min(W - 1, Math.max(0, Math.round(crop.cx - crop.size / 2 + x / k)));
      const sy = Math.min(H - 1, Math.max(0, Math.round(crop.cy - crop.size / 2 + y / k)));
      px.set(raster.color.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * S + x) * 4);
    }
  }
  writeFileSync(join(out, `${name}-crop.png`), encodePng(S, S, px));
}

const said = (name: string, p: FramePacket): void => console.log(`${name}: ${(p.triangles / 1e6).toFixed(2)} M triangles, crowns near ${(scene.budget.last.crowns / 1e6).toFixed(2)} M, squeeze ${scene.budget.squeeze.toFixed(2)}, ${p.drawCount} draws`);

const shares = (args.includes("--leaves") ? args[args.indexOf("--leaves") + 1]! : "1,0.6,0.3").split(",").map(Number);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
for (const metres of only === "leaves" ? [] : [20, 60]) {
  const t = nearest(metres);
  face(t);
  // The oak's crown is at the middle of the view; the crop holds what of it the view shows.
  const size = Math.min(H, Math.round((22 / t.far) * (ROWS / (2 * Math.tan((FOV * Math.PI) / 360))) * (H / ROWS)));
  const crop = { cx: W / 2, cy: H / 2, size: Math.min(size, W) };
  console.log(`the elder oak ${t.far.toFixed(1)} m off`);
  scene.budget.reset();
  said(`  whole, ${metres} m`, drawn(false));
  save(`elder-${metres}m-whole`, crop);
  said(`  budget, ${metres} m`, drawn(true));
  save(`elder-${metres}m-budget`, crop);
}

face(nearest(20));
for (const share of shares) {
  scene.budget.reset();
  said(`  leaves ${share * 100}%`, drawn(false, share));
  save(`elder-20m-leaves-${Math.round(share * 100)}`, { cx: W / 2, cy: H / 2, size: 400 });
}
console.log(`pictures in ${out}`);
