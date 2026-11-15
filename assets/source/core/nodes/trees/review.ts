// Pictures of the trees as the game draws them, with the software rasterizer the tests hold to the game's shader:
// a shore and a hillside of a map made here, the trees scattered over it as nodes, drawn on a graphics tier once the
// card holds all it wants. Not part of the build.
//
//   bun assets/source/core/nodes/trees/review.ts --view hill --tier medium --out artifacts/trees/hill.png
//
// --view: near (one tree a few metres off, --hero N of the kinds, --turn degrees), trunk (its trunk from 3.6 m), mid (one
// tree 30 m off), lineup (the first three kinds side by side, --gap metres apart and twice that off), grove (eye height
// among them), hill (a hillside across the water, 300 m to 1.2 km off), above (the hillside from a flyer). --tier:
// lowpoly, medium, high, ultra. --kinds: the meshes to scatter, comma separated (every tree of this asset by default).
// --size WxH. --hour: of the day, 12 by default. --front: the camera with the sun behind it. --alone: no trees but the
// ones placed by hand. --dense: every slot of a grove planted. --levels: print which level of each mesh is drawn.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { TIERS, tierOf } from "../../../../../client/core/assets/tiers.ts";
import { Camera } from "../../../../../client/core/render/camera.ts";
import { Scene } from "../../../../../client/core/render/scene.ts";
import { RemoteSample } from "../../../../../client/core/session.ts";
import { CORE_CONTENT } from "../../../../../content/core.ts";
import { CHUNK_SIZE, chunkCx, chunkCz, type MapDims } from "../../../../../shared/coords.ts";
import { compileContent } from "../../../../../shared/content/registry.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { Heightfield } from "../../../../../shared/world/heightfield.ts";
import { NodeField, formOf, nodeForms, type NodeSource } from "../../../../../shared/world/nodes.ts";
import { StructureStore } from "../../../../../shared/world/structures.ts";
import { FakeNet } from "../../../../../tests/fixtures/assetnet.ts";
import { SOURCE } from "../../../../../tools/art/source.ts";
import { settle, type ProvingView } from "../../../../../tools/snap.ts";
import { gameFiles } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { Rasterizer } from "../../../../../tools/snap/raster.ts";
import spec from "./asset.ts";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1]! : fallback);
const view = arg("view", "hill");
const tierName = arg("tier", "medium");
const [W, H] = arg("size", "1920x1080").split("x").map(Number) as [number, number];
const trees = arg("kinds", spec.pieces.map((p) => p.id).filter((id) => !id.endsWith("_depleted")).join(",")).split(",");
if (!TIERS.some((t) => t.name === tierName)) throw new Error(`--tier takes ${TIERS.map((t) => t.name).join(", ")}`);

// A map 1.5 km square: sea to the south, a strip of flat shore, then a hill rising to the north.
const DIMS: MapDims = { chunksX: 24, chunksZ: 24 };
const SEA = 0;
const SHORE = 420;
function height(x: number, z: number): number {
  const rise = Math.max(0, z - SHORE - 70);
  const swell = 8 * Math.sin(x / 97) * Math.sin(z / 131) + 4 * Math.sin(x / 41 + z / 57);
  const hill = 150 * (1 - Math.exp(-rise / 320)) + (rise > 0 ? swell * Math.min(1, rise / 120) : 0);
  const beach = z < SHORE ? -4 + (z - SHORE) * 0.02 : Math.min(1.5, (z - SHORE) * 0.03);
  return z < SHORE ? beach : beach + hill + 0.6 * Math.sin(x / 13) * Math.min(1, (z - SHORE) / 40);
}
const hf = new Heightfield(DIMS, 2, -32, 1 / 256);
hf.seaLevel = SEA;
for (let j = 0; j < hf.nz; j++) {
  for (let i = 0; i < hf.nx; i++) {
    const [x, z] = [i * hf.cell, j * hf.cell];
    const y = height(x, z);
    hf.setSample(i, j, y);
    // Sand by the water, dry grass above it, scrub higher up.
    hf.tint[j * hf.nx + i] = y < SEA + 1.2 ? 124 : y > 60 ? 130 : 131;
  }
}

// Each tree mesh as a node kind of its own, so it is drawn as nodes are.
const base = CORE_CONTENT.find((d) => d.type === "node" && d.id === "core:tree")!;
const alone = view === "near" || view === "trunk" || view === "mid" || view === "lineup";
const defs = trees.map((id) => ({ ...base, id, variants: [{ mesh: id }], size: alone ? [1, 1] : [0.85, 1.2] }));
const reg = compileContent([...CORE_CONTENT, ...(defs as typeof CORE_CONTENT)]).registry!;
const kinds = trees.map((id) => reg.index.get(id)!);
const forms = nodeForms(reg);

function mix(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}
// Where the camera stands for the near views, and trees placed by hand in front of it: metres east and north of it,
// which of the trees, and degrees turned.
const CAMERA = { x: 760, z: SHORE + (args.includes("--front") ? 62 : 30) };
const HERO = Number(arg("hero", "3"));
const GAP = Number(arg("gap", "24"));
const HEROES: [number, number, number, number][] =
  view === "near" ? [[1.2, 6.5, HERO, Number(arg("turn", "40"))]] : view === "trunk" ? [[0.3, 3.6, HERO, Number(arg("turn", "40"))]] : view === "mid" ? [[0, 30, HERO, Number(arg("turn", "40"))]] : view === "lineup" ? [[-GAP, GAP * 1.9, 0, 300], [0, GAP * 1.9, 1, 30], [GAP, GAP * 1.9, 2, 120]]
  : view === "grove" ? [[-3.5, 7, 3, 10], [4, 12, 0, 70], [-9, 18, 5, 200], [7, 26, 4, 300], [-2, 34, 1, 120], [12, 40, 2, 20]] : [];
// --front stands the camera with the sun behind it, looking south at trees set south of it; else it looks north, into the sun.
const front = args.includes("--front");
const facing = front ? -1 : 1;
const heroAt = HEROES.map(([dx, dz]) => [CAMERA.x + dx * facing, CAMERA.z + dz * facing] as const);
const chunkOf = (x: number, z: number): number => Math.floor(z / CHUNK_SIZE) * DIMS.chunksX + Math.floor(x / CHUNK_SIZE);

/** Groves with clearings between: a slot is planted where a slow pattern over the map says so. */
const source: NodeSource = {
  perChunk: 48,
  at(chunk, index, out) {
    out.kind = 0;
    if (index >= 40) {
      const k = index - 40;
      if (k >= HEROES.length || chunkOf(...heroAt[k]!) !== chunk) return;
      const [x, z] = heroAt[k]!;
      out.kind = kinds[HEROES[k]![2] % kinds.length]!;
      out.form = formOf(forms, out.kind, 0);
      [out.x, out.y, out.z] = [x, hf.heightAt(x, z), z];
      out.yaw = Math.round((HEROES[k]![3] / 360) * 65536) & 0xffff;
      return;
    }
    if (args.includes("--alone")) return;
    const h = mix(7, chunk, index);
    const g = mix(h, index, chunk);
    const x = (chunkCx(DIMS, chunk) + (h & 0xffff) / 65536) * CHUNK_SIZE;
    const z = (chunkCz(DIMS, chunk) + (h >>> 16) / 65536) * CHUNK_SIZE;
    const y = hf.heightAt(x, z);
    if (y < SEA + 0.25 || hf.slopeCosAt(x, z) < 0.85) return;
    // Only where the camera looks, so the frame's draws suffice: the far layer will draw 256 m tiles, not 64 m chunks.
    if (Math.abs(x - 760) > (view === "hill" || view === "above" ? 560 : 260) || z > SHORE + 700) return;
    const grove = Math.sin(x / 61) * Math.sin(z / 47) + 0.6 * Math.sin(x / 23 + z / 37);
    if (grove < -0.1 && (g & 7) !== 0) return;
    // --dense plants every slot of a grove, as a wood of the far-layer design's density would stand.
    const dense = args.includes("--dense");
    if (!dense && (g >>> 24) % 3 !== 0) return;
    // Clear the ground round where the camera stands and round the trees placed by hand.
    if (HEROES.length > 0 && (Math.hypot(x - CAMERA.x, z - CAMERA.z) < 14 || heroAt.some(([hx, hz]) => Math.hypot(x - hx, z - hz) < 6))) return;
    // A tree seen alone stands in a clearing.
    if ((view === "mid" || view === "lineup") && Math.abs(x - CAMERA.x) < 70 + GAP && (z - CAMERA.z) * facing < 110 + GAP * 2) return;
    // Each kind where it grows: mangroves at the water, palms on the shore and scattered above it, the hardwoods,
    // figs and banyans on the hill, where they are fewer, being wider.
    const band = y < SEA + 1.6 ? "mangrove" : y < SEA + 5 ? "palm" : (g >>> 20) % 5 === 0 ? "palm" : "";
    const here = kinds.filter((_, i) => (band ? trees[i]!.includes(band) : !/palm|mangrove/.test(trees[i]!)));
    const pool = here.length > 0 ? here : kinds;
    if (!band && pool !== kinds && !dense && (g >>> 12) % 3 !== 0) return;
    out.kind = pool[g % pool.length]!;
    out.form = formOf(forms, out.kind, mix(g, chunk, 7));
    out.x = x;
    out.y = y;
    out.z = z;
    out.yaw = (g >>> 8) & 0xffff;
  },
};

const files = await gameFiles(SOURCE);
const port = new FakeNet(files.files, {});
const pack = parsePack(files.files[0]!);
const structs = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
const nodes = new NodeField(DIMS, reg, source);
nodes.retain(12 * DIMS.chunksX + 12, 24, 1, () => false);
const scene = new Scene({ dims: DIMS, hf, structs, nodes: nodes.store }, reg, pack, { manifest: files.manifest, port });
scene.assets.tier = tierOf(tierName);
scene.viewHeight = H;
const cam = new Camera();
cam.aspect = W / H;
scene.hour = Number(arg("hour", "12"));
const at = (x: number, y: number, z: number, yaw: number, pitch: number): void => {
  [cam.x, cam.y, cam.z] = [x, y, z];
  cam.yaw = ((yaw + (front ? 180 : 0)) * Math.PI) / 180;
  cam.pitch = (pitch * Math.PI) / 180;
};
const eye = (x: number, z: number, up = 1.7): number => hf.heightAt(x, z) + up;
if (view === "near") at(CAMERA.x, eye(CAMERA.x, CAMERA.z), CAMERA.z, 8, 22);
else if (view === "trunk") at(CAMERA.x, eye(CAMERA.x, CAMERA.z), CAMERA.z, 5, 6);
else if (view === "grove") at(CAMERA.x, eye(CAMERA.x, CAMERA.z), CAMERA.z, 5, 8);
else if (view === "mid") at(CAMERA.x, eye(CAMERA.x, CAMERA.z), CAMERA.z, 0, 12);
else if (view === "lineup") at(CAMERA.x, eye(CAMERA.x, CAMERA.z), CAMERA.z, 0, 9);
else if (view === "hill") at(760, 55, SHORE - 230, 0, 0);
else if (view === "above") at(760, 160, SHORE - 120, 0, -14);
else throw new Error("--view takes near, trunk, mid, lineup, grove, hill or above");
const raster = new Rasterizer(W, H, pack, hf, files.manifest);
const remote = new RemoteSample();
const proving = { reg, hf, structs, nodes, pack, scene, cam, remote, raster, port, render: () => scene.build(cam, remote) } as unknown as ProvingView;
const frames = settle(proving, 20000);
const p = scene.packet;
const out = resolve(arg("out", `artifacts/trees/${view}-${tierName}.png`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng(W, H, raster.color));
if (args.includes("--levels")) {
  const ids = pack.header.meshes.map((m) => m.id);
  const seen = new Map<string, number>();
  for (let d = 0; d < p.drawCount; d++) {
    const key = `${ids[p.drawMesh[d]!] ?? p.drawMesh[d]} level ${p.drawLod[d]}`;
    seen.set(key, (seen.get(key) ?? 0) + p.drawInstances[d]!);
  }
  console.log([...seen].map(([k, n]) => `${k}: ${n}`).join("\n"));
}
console.log(`${out}: ${tierName}, ${frames} frames to fill the card; ${nodes.store.chunks.reduce((n, c) => n + (c?.live ?? 0), 0)} trees; draws ${p.drawCount}; triangles ${p.triangles}`);
