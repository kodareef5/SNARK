// Benchmark rows for bodies that die and for gaits played by the ground covered: 64 ragdolls falling at once and lying
// still, and what keeping a gait adds to posing 500 walking creatures. Medians of many frames; a busy machine moves them.

import { Pose, sampleClip } from "../../shared/anim/clip.ts";
import { advanceCreature, creaturePose } from "../../shared/anim/creature.ts";
import { Gait } from "../../shared/anim/gait.ts";
import { AnimState, SPEED_STEP, bodySeed } from "../../shared/anim/pose.ts";
import { Ragdoll } from "../../shared/anim/ragdoll.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { corePack } from "../../tests/fixtures/pack.ts";

const median = (times: number[]): number => [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]!;

export function benchRagdoll(section: (title: string) => void, record: (name: string, value: number, unit: string, budget?: number | null) => void): void {
  section("Ragdolls and gaits");
  const pack = corePack();
  const rigs = buildRigs(pack.header.rigs, pack.clips);
  const kinds = ["core:raptor", "core:parasaur"].map((id) => rigs.get(id)!).filter((r) => r.ragdoll && r.death);
  if (kinds.length === 0) return;
  // Rolling ground, two chunks a side, and nothing built on it.
  const dims = { chunksX: 4, chunksZ: 4 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 10 + 3 * Math.sin(i * 0.2) * Math.cos(j * 0.15));
  const none = new Float32Array(1);
  const world = { hf, structs: new StructureStore(dims, none, none, none) };
  const limp = kinds.map((rig) => {
    const pose = new Pose(rig.bones);
    const [now, before] = [new Solved(rig.bones), new Solved(rig.bones)];
    sampleClip(rig.death!, rig.ragdoll!.limp, pose);
    solve(rig, pose, now);
    sampleClip(rig.death!, rig.ragdoll!.limp - 1, pose);
    solve(rig, pose, before);
    return { rig, now, before };
  });
  const drop = (): { doll: Ragdoll; solved: Solved }[] =>
    Array.from({ length: 64 }, (_, k) => {
      const { rig, now, before } = limp[k % limp.length]!;
      const doll = new Ragdoll(rig, rig.ragdoll!);
      const [x, z] = [20 + (k % 8) * 25, 20 + Math.floor(k / 8) * 25];
      doll.start(now, before, x, hf.heightAt(x, z), z, k * 0.7, k % 4 === 3 ? 0.5 : 1);
      return { doll, solved: new Solved(rig.bones) };
    });
  // Two falls to warm up, then the first second of a third, each frame stepped and posed as a client draws it.
  for (let warm = 0; warm < 2; warm++) {
    const set = drop();
    for (let f = 0; f < 120; f++) for (const d of set) if (d.doll.step(world, 1 / 60)) d.doll.pose(d.solved);
  }
  const set = drop();
  const falling: number[] = [];
  for (let f = 0; f < 60; f++) {
    const t = performance.now();
    for (const d of set) if (d.doll.step(world, 1 / 60)) d.doll.pose(d.solved);
    falling.push(performance.now() - t);
  }
  record("64 ragdolls in their first second, a frame, median", median(falling), "ms", 1);
  let asleep = 0;
  for (let f = 0; f < 5 * 60; f++) for (const d of set) if (d.doll.step(world, 1 / 60)) d.doll.pose(d.solved);
  for (const d of set) if (!d.doll.awake) asleep++;
  record("of them at rest after six seconds", asleep, "", null);
  const lying: number[] = [];
  for (let f = 0; f < 60; f++) {
    const t = performance.now();
    for (const d of set) if (d.doll.step(world, 1 / 60)) d.doll.pose(d.solved);
    lying.push(performance.now() - t);
  }
  record("the 64 at rest, a frame, median", median(lying), "ms", 0.05);

  // 500 creatures walking and running, posed as the server poses them, then with a gait each as a client poses them.
  const st = new AnimState();
  const n = 500;
  const gaits = new Map<number, Gait>();
  const pose = (kept: boolean, frames: number): number[] => {
    const times: number[] = [];
    for (let f = 0; f < frames; f++) {
      const t = performance.now();
      for (let i = 0; i < n; i++) {
        const rig = kinds[i % kinds.length]!;
        st.speed = 2 + (i % 11);
        st.seed = bodySeed(i);
        const tick = 1000 + f / 2;
        if (kept) {
          const g = gaits.get(i) ?? gaits.set(i, new Gait()).get(i)!;
          const along = ((st.speed * SPEED_STEP * f) / 60) % 1000;
          advanceCreature(rig, g, st, tick, 4, i * 3, along, 0, 1);
          creaturePose(rig, st, tick, 4, rig.a, g);
        } else creaturePose(rig, st, tick, 4, rig.a);
        solve(rig, rig.a, rig.solved);
      }
      times.push(performance.now() - t);
    }
    return times;
  };
  pose(false, 30);
  pose(true, 30);
  const byTick = median(pose(false, 120));
  const byGround = median(pose(true, 120));
  record("posing 500 creatures by the tick, median", byTick, "ms", null);
  record("posing them by a gait kept for each, median", byGround, "ms", null);
  record("what keeping the gaits adds", ((byGround - byTick) / byTick) * 100, "%", null);
}
