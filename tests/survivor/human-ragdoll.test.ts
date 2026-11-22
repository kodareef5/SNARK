import { expect, test } from "bun:test";
import { HUMAN, HUMAN_RAGDOLL } from "../../shared/anim/human.ts";
import { Ragdoll } from "../../shared/anim/ragdoll.ts";
import { layHuman } from "../../shared/anim/human-fall.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const STEP = 1 / 30;

function world(slope: number) {
  const dims = { chunksX: 2, chunksZ: 2 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, i * TERRAIN_CELL * slope);
  return { hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
}

/** A survivor standing in the T-pose at (x, y, z), shoved at `push` m/s along +Z. */
function fall(w: ReturnType<typeof world>, x: number, z: number, push: number): Ragdoll {
  const pose = new Pose(HUMAN.bones), now = new Solved(HUMAN.bones);
  pose.rest();
  solve(HUMAN, pose, now);
  const d = new Ragdoll(HUMAN, HUMAN_RAGDOLL);
  d.start(now, now, x, w.hf.heightAt(x, z) + 0.02, z, 0.4, 1);
  d.launch(0, 1, push, push * 2, 0, 0);
  return d;
}

test("a survivor shoved over lies still within three seconds, no joint past its limit, nothing under the ground", () => {
  for (const slope of [0, 0.3]) {
    const w = world(slope);
    for (const push of [2, 6]) {
      const d = fall(w, 40, 40, push);
      let slept = -1;
      for (let f = 1; f <= 3 / STEP && slept < 0; f++) if (!d.step(w, STEP)) slept = f * STEP;
      let past = 0, under = 0;
      for (let i = 1; i < d.n; i++) {
        const [swing, twist] = d.bend(i);
        past = Math.max(past, swing - HUMAN_RAGDOLL.swing[i]!, twist - HUMAN_RAGDOLL.twist[i]!);
      }
      for (let i = 0; i < d.n; i++) under = Math.max(under, w.hf.heightAt(d.x[i * 3]!, d.x[i * 3 + 2]!) - d.x[i * 3 + 1]!);
      expect({ slope, push, slept: slept > 0, past: past < 0.05, under: under < 0.05 }).toEqual({ slope, push, slept: true, past: true, under: true });
    }
  }
});

test("the same shove lays the same body twice", () => {
  const w = world(0.1);
  const [a, b] = [fall(w, 40, 40, 4), fall(w, 40, 40, 4)];
  for (let f = 0; f < 60; f++) { a.step(w, STEP); b.step(w, STEP); }
  expect([...a.checkpoint()]).toEqual([...b.checkpoint()]);
});

test("one laid lying starts low and comes to rest close by", () => {
  const w = world(0);
  const d = layHuman(40, w.hf.heightAt(40, 40), 40, 0.4, true);
  const start = [d.x[0]!, d.x[1]!, d.x[2]!];
  let slept = -1;
  for (let f = 1; f <= 2 / STEP && slept < 0; f++) if (!d.step(w, STEP)) slept = f;
  expect(start[1]! - w.hf.heightAt(40, 40)).toBeLessThan(0.3);
  expect(slept).toBeGreaterThan(0);
  expect(Math.hypot(d.x[0]! - start[0]!, d.x[2]! - start[2]!)).toBeLessThan(0.3);
});
