// bun tools/bench/mount-scene.ts
// CPU time to build production scene packets, including creature footing and animation. No GPU/browser timing.
// Frozen art makes this runnable without assets/source and keeps the workload comparable across source revisions.
import { cpus } from "node:os";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_ONE_BONE, DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { frozenPack } from "../../tests/fixtures/pack.ts";
import { flatWorld } from "../../tests/fixtures/world.ts";

export interface MountSceneTiming {
  creatures: number;
  moving: number;
  frames: number;
  warmupFrames: number;
  tier: string;
  minimumDrawnBodies: number;
  minimumBones: number;
  maximumBones: number;
  medianMs: number;
  p95Ms: number;
}

/** The original crowd course: mixed raptors/parasaurs on a 26% incline with 15% crossfall, viewed at 720p. */
export function mountSceneTrial(count: number): MountSceneTiming {
  if (![32, 256, 512].includes(count)) throw new Error("Mount scene count must be 32, 256 or 512.");
  const world = flatWorld(4), pack = frozenPack(), state = new AnimState();
  for (const species of ["core:raptor", "core:parasaur"]) {
    if (!pack.meshIndex.has(species) || !pack.header.rigs.some(r => r.id === species)) throw new Error(`Missing frozen creature art: ${species}`);
  }
  const { hf } = world;
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    hf.setSample(i, j, 16 + Math.min(32, Math.max(-32, j * hf.cell - 80)) * .26 + Math.min(30, Math.max(-30, i * hf.cell - 128)) * .15);
  }
  const camera = new Camera();
  camera.x = 128; camera.z = 47; camera.y = hf.heightAt(camera.x, camera.z) + 3;
  camera.yaw = 0; camera.pitch = .2; camera.aspect = 16 / 9;
  const view = new RemoteSample(), scene = new Scene(world, world.reg, pack);
  scene.viewHeight = 720;
  let moving = 0;
  for (let i = 0; i < count; i++) {
    const z = camera.z + 8 + (i % 32) * 1.7;
    const x = camera.x + ((i * 13 % 31) / 31 - .5) * (z - camera.z) * 1.22;
    view.id[i] = i + 1; view.gen[i] = 1; view.kind[i] = world.kind(i % 2 ? "core:parasaur" : "core:raptor");
    view.x[i] = x; view.y[i] = hf.heightAt(x, z); view.z[i] = z;
    view.yaw[i] = i * .13; view.flags[i] = F_GROUNDED;
    const speed = i % 3 ? 2.1 : 0;
    if (speed) moving++;
    state.setMotion(speed, 0, 0, 0); view.anim[i] = state.pack();
  }
  view.tick = 500; view.count = count;
  const warmupFrames = 100, frames = 300, times: number[] = [];
  let minimumDrawnBodies = Infinity, minimumBones = Infinity, maximumBones = 0;
  for (let frame = 0; frame < warmupFrames + frames; frame++) {
    view.tick += .5; // A 60 Hz render clock samples 30 Hz animation ticks; positions stay fixed to isolate scene cost.
    const begin = performance.now(), packet = scene.build(camera, view), elapsed = performance.now() - begin;
    if (frame < warmupFrames) continue;
    if (!Number.isFinite(elapsed) || packet.skipped || packet.dropped) throw new Error("Incomplete mount scene packet.");
    let bodies = 0;
    for (let draw = 0; draw < packet.drawCount; draw++) {
      if (packet.drawFlags[draw]! & (DRAW_SKINNED | DRAW_ONE_BONE)) bodies += packet.drawInstances[draw]!;
    }
    minimumDrawnBodies = Math.min(minimumDrawnBodies, bodies);
    minimumBones = Math.min(minimumBones, packet.boneCount); maximumBones = Math.max(maximumBones, packet.boneCount);
    times.push(elapsed);
  }
  if (minimumDrawnBodies < count / 2 || minimumBones < count || times.length !== frames) throw new Error("Mount crowd was missing or culled out.");
  times.sort((a, b) => a - b);
  return { creatures: count, moving, frames, warmupFrames, tier: scene.assets.tier.name, minimumDrawnBodies, minimumBones, maximumBones,
    medianMs: times[Math.floor(times.length * .5)]!, p95Ms: times[Math.floor(times.length * .95)]! };
}

if (import.meta.main) {
  console.log(JSON.stringify({ benchmark: "mount-scene", machine: cpus()[0]?.model, cores: cpus().length, bun: Bun.version, platform: process.platform, arch: process.arch }));
  for (const count of [32, 256, 512]) console.log(JSON.stringify(mountSceneTrial(count)));
}
