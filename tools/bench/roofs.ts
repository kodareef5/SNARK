// A roofed estate's draws and triangles from 30 and 60 m on medium at the iPhone's view, and its trims laid whole and again
// after one roof changes: before and after hips. bun var/hips/roofed.ts
import { forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { yields } from "../../client/core/render/piece-fit.ts";
import type { PieceLooks } from "../../client/core/render/piece-state.ts";
import { Trims } from "../../client/core/render/trims.ts";
import { CHUNK_SIZE, STRUCT_UNITS, chunkCx, chunkCz } from "../../shared/coords.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { asTextured } from "./base.ts";
import { VIEW, count } from "./budget.ts";
import { roofKeys } from "../pieces/village.ts";
import { corePack } from "../../tests/fixtures/pack.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";

const tier = process.argv[2] ?? "wood";
const reg = coreRegistry();
const dims = { chunksX: 16, chunksZ: 16 };
const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 64);
hf.heights.fill(32 * 64);
const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
const keys = roofKeys(tier);
let pieces = 0;
// Eighteen estates, two to a chunk, in a block of three by three chunks.
for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) {
  const f = structs.frames.make(Math.round((64 * (6 + i) + 6) * STRUCT_UNITS), Math.round(0.375 * STRUCT_UNITS), Math.round((64 * 6 + 12 + 30 * j) * STRUCT_UNITS), 0, 1);
  for (const k of keys) {
    const kind = reg.index.get(`core:${k.name}_${tier}`);
    if (kind !== undefined && structs.place(kind, f.gid, k.k0, k.k1, 1, reg.maxHp[kind]!) >= 0) pieces++;
  }
}
const scene = new Scene({ dims, hf, structs }, reg, corePack());
asTextured(scene);
[scene.assets.tier, scene.viewHeight] = [forTouch(tierOf("medium"), true), VIEW[1]];
const cam = new Camera();
[cam.aspect, cam.fovY, cam.y] = [VIEW[0] / VIEW[1], (VIEW[2] * Math.PI) / 180, 1.7];
console.log(`${tier}: ${pieces} pieces in 18 estates`);
for (const off of [30, 60]) {
  [cam.x, cam.z, cam.yaw] = [64 * 9 + off, 64 * 7.5, 1.5 * Math.PI];
  for (let f = 0; f < 3; f++) scene.build(cam, null);
  const c = count(scene, scene.build(cam, null));
  console.log(`from ${off} m: ${c.draws} draws, ${c.triangles} triangles, ${c.cast} cast`);
}
// The trims of the estates' middle chunk, laid whole and then by what changed.
const meshes = ["joint_sq", "joint_r15", "joint_r21", "skirt", "eave", "ridge", "hip", "saddle"].map((n) => `core:${n}_${tier}`);
const looks = { flag: new Uint32Array(meshes.length), yields: Uint8Array.from(reg.defs, (_, k) => (reg.forms.def[k] && yields(reg.forms.def[k]!) ? 1 : 0)) };
const chunk = 7 * dims.chunksX + 7, t = structs.chunks[chunk]!;
const x0 = chunkCx(dims, chunk) * CHUNK_SIZE, z0 = chunkCz(dims, chunk) * CHUNK_SIZE;
const time = (incremental: boolean, change: boolean): [number, number] => {
  const trims = new Trims(reg, (id) => meshes.indexOf(id), looks as unknown as PieceLooks);
  trims.incremental = incremental;
  trims.lay(structs, chunk, t, x0, z0);
  const ms: number[] = [];
  let laid = 0;
  for (let n = 0; n < 200; n++) {
    let ref = -1, at: { kind: number; f: number; k0: number; k1: number } | null = null;
    if (change) {
      let s = 0;
      while (!(t.kind[s] !== 0 && reg.forms.def[t.kind[s]!]?.corner)) s++;
      at = { kind: t.kind[s]!, f: t.fr![s]!, k0: t.k0![s]!, k1: t.k1![s]! };
      ref = chunk * 65536 + s;
      structs.remove(ref);
    }
    const a = performance.now();
    laid = trims.lay(structs, chunk, t, x0, z0)!.count;
    ms.push(performance.now() - a);
    if (at) structs.place(at.kind, at.f, at.k0, at.k1, 1, reg.maxHp[at.kind]!);
  }
  ms.sort((p, q) => p - q);
  return [ms[100]!, laid];
};
const [whole, n] = time(false, false);
const [again] = time(true, true);
console.log(`its middle chunk's ${t.live} pieces: ${n} trims; laid whole ${whole.toFixed(3)} ms median, again after a roof goes ${again.toFixed(3)} ms median`);
