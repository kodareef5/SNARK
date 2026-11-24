// What a base's own walls hide, and what finding that costs (client/core/render/base-occluders.ts), on its own:
// bun tools/bench/occluders.ts [--stacked]
//
// A breeding base: a sealed two-storey base of stone, 24 m square, with 300 creatures and 60 boxes on its floors and a
// 2,000-piece wooden base 30 m behind it, on medium with the installed art. Its triangles and draws from outside, with
// the plates and without, from a raider's eye, from a mount's back and from the air. Then the same base of metal,
// whose walls close on each other over storeys. Then what finding a chunk's plates costs when the chunk is laid out,
// and what putting them in the picture costs a frame. --stacked merges stone's storeys too, to show what the 3 mm
// under a coarser wall's foot costs: it is not how the game draws.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { BasePlates } from "../../client/core/render/base-occluders.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { OCCLUDER } from "../../client/core/render/hide.ts";
import type { ChunkBatch } from "../../client/core/render/passes/near-store.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { corePack } from "../../tests/fixtures/pack.ts";
import { asTextured, boxBase } from "./base.ts";

const row = (name: string, value: number, unit: string): void => console.log(`  ${name.padEnd(76)} ${value.toFixed(unit === "ms" ? 3 : 0).padStart(10)} ${unit}`);
const median = (v: number[]): number => v.sort((a, b) => a - b)[v.length >> 1]!;

const reg = compileContent(CORE_CONTENT).registry!;
const pack = corePack();
const dims = { chunksX: 16, chunksZ: 16 };
const stacked = process.argv.includes("--stacked");

function world() {
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 64);
  hf.heights.fill(32 * 64);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const scene = new Scene({ dims, hf, structs }, reg, pack);
  asTextured(scene);
  scene.assets.tier = tierOf("medium");
  scene.structureDistance = 256;
  if (stacked) ((scene as unknown as { nearStore: { plates: BasePlates } }).nearStore.plates.stacks as Uint8Array).fill(1);
  return { hf, structs, scene, cam: new Camera(), remote: new RemoteSample() };
}

const batches = (scene: Scene): Map<number, ChunkBatch> => (scene as unknown as { nearStore: { batches: Map<number, ChunkBatch> } }).nearStore.batches;

for (const tier of ["stone", "metal"]) {
  console.log(`\nA breeding base of ${tier}, 24 m square on two storeys, 300 creatures and 60 boxes inside, a wooden base behind${stacked ? " (storeys merged)" : ""}`);
  const { structs, scene, cam, remote } = world();
  const [bx, bz] = [400.5, 400.5];
  // 8 by 8 cells with a wall every fourth line: four halls a storey.
  for (const [kind, x, y, z, yaw] of boxBase(reg, tier, bx, 0, bz, 8, 4, 100000).filter(([, , y]) => y < 7)) structs.add(kind, x, y, z, yaw, 1, reg.maxHp[kind]!);
  for (const [kind, x, y, z, yaw] of boxBase(reg, "wood", bx - 9, 0, bz + 54, 14, 3, 2000)) structs.add(kind, x, y, z, yaw, 1, reg.maxHp[kind]!);
  const rng = new Rng(7);
  const kinds = ["core:dodo", "core:raptor", "core:parasaur"].map((id) => reg.index.get(id)!).filter((k) => k !== undefined);
  remote.count = 300;
  for (let n = 0; n < remote.count; n++) [remote.id[n], remote.kind[n], remote.x[n], remote.y[n], remote.z[n], remote.yaw[n], remote.flags[n]] = [100 + n, kinds[n % kinds.length]!, bx + rng.range(1, 23), 0.375 + 3 * (n & 1), bz + rng.range(1, 23), rng.range(0, 6), 1];
  const box = reg.index.get("core:storage_box")!;
  for (let n = 0; n < 60; n++) structs.add(box, bx + rng.range(1, 23), 0.375 + 3 * (n & 1) + reg.halfY[box]!, bz + rng.range(1, 23), 0, 1, 100);
  for (const [name, x, y, z] of [["a raider's eye, 30 m off", bx + 12, 1.7, bz - 30], ["a raider's eye, 12 m off", bx + 12, 1.7, bz - 12], ["a mount's back, 5 m up and 30 m off", bx + 12, 5, bz - 30], ["the air, 25 m up and 40 m off", bx + 12, 25, bz - 40]] as const) {
    [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [x, y, z, 0, Math.atan2(2 - y, 30)];
    const got = [true, false].map((plating) => {
      scene.plating = plating;
      let p = scene.build(cam, remote);
      for (let f = 0; f < 6; f++) p = scene.build(cam, remote);
      return [p.triangles, p.drawCount, scene.hiding.on ? scene.hiding.stats.hidden : 0, scene.hiding.on ? scene.hiding.stats.occluders : 0];
    });
    console.log(`  from ${name}`);
    row("triangles, without the plates", got[1]![0]!, "");
    row("triangles, with them", got[0]![0]!, "");
    row("draws, without the plates", got[1]![1]!, "");
    row("draws, with them", got[0]![1]!, "");
    row("plates in the picture, and boxes they hid", got[0]![3]!, `and ${got[0]![2]}`);
  }
  // What the plates cost a frame from the raider's eye: the frame built with them and without, turn about.
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [bx + 12, 1.7, bz - 30, 0, 0];
  const ms: number[][] = [[], []];
  for (let f = 0; f < 600; f++) {
    cam.yaw = 0.0005 * (f % 40);
    scene.plating = f % 2 === 0;
    const at = performance.now();
    scene.build(cam, remote);
    ms[f % 2]!.push(performance.now() - at);
  }
  row("frame build with the plates, median", median(ms[0]!), "ms");
  row("frame build without them, median", median(ms[1]!), "ms");
}

console.log("\nFinding a chunk's plates when it is laid out");
for (const [n, every, most, tier] of [[14, 3, 2000, "stone"], [21, 1, 20000, "stone"], [21, 1, 20000, "metal"]] as const) {
  const { structs, scene, cam } = world();
  for (const [kind, x, y, z, yaw] of boxBase(reg, tier, 64 * 6 + 0.5, 0, 64 * 6 + 0.5, n, every, most)) structs.add(kind, x, y, z, yaw, 1, reg.maxHp[kind]!);
  [cam.x, cam.y, cam.z, cam.yaw] = [64 * 6 + 32, 1.7, 64 * 6 - 30, 0];
  scene.build(cam, null);
  const chunk = 6 * dims.chunksX + 6, b = batches(scene).get(chunk)!, t = structs.chunks[chunk]!;
  const plates = (scene as unknown as { nearStore: { plates: BasePlates; platable: (kind: number) => boolean } }).nearStore;
  const ms: number[] = [];
  for (let i = 0; i < 200; i++) {
    const at = performance.now();
    plates.plates.of(t, structs.frames, b.at, b.data, b.blocks === b.cells ? null : b.rooms!.shell, plates.platable);
    ms.push(performance.now() - at);
  }
  row(`a chunk of ${most.toLocaleString("en")} pieces of ${tier}: its plates`, b.plates.length / OCCLUDER, "");
  row(`a chunk of ${most.toLocaleString("en")} pieces of ${tier}: to find them, median`, median(ms), "ms");
}
