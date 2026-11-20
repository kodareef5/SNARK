// How a fallen Rex settles: drops it from the death clip's limp frame onto a slope, as tests/unit/ragdoll.test.ts does,
// and prints how long it takes to fall asleep at each of that test's six headings. Given a heading, it prints instead
// how far each body moved in each quarter second, to find what keeps moving.
//   bun assets/source/core/creatures/rex/ref/settle.ts [slope, 0.35] [heading in radians]
import { readFileSync } from "node:fs";
import { sampleClip } from "../../../../../../shared/anim/clip.ts";
import { Ragdoll } from "../../../../../../shared/anim/ragdoll.ts";
import { buildRig } from "../../../../../../shared/anim/rigs.ts";
import { Solved, solve } from "../../../../../../shared/anim/skeleton.ts";
import { parsePack } from "../../../../../../shared/pack/pack.ts";
import { TERRAIN_CELL } from "../../../../../../shared/world/heightfield.ts";
import { flatWorld } from "../../../../../../tests/fixtures/world.ts";

const slope = Number(process.argv[2] ?? 0.35);
const pack = parsePack(readFileSync(new URL("../rex.snpk", import.meta.url)));
const rig = buildRig(pack.header.rigs.find((r) => r.id === "core:rex")!, pack.clips)!;
const pose = (frame: number): Solved => {
  const out = new Solved(rig.bones);
  sampleClip(rig.clips.get("death")!, frame, rig.a);
  solve(rig, rig.a, out);
  return out;
};
const w = flatWorld();
for (let j = 0; j < w.hf.nz; j++) for (let i = 0; i < w.hf.nx; i++) w.hf.setSample(i, j, (i * TERRAIN_CELL - 64) * slope);
const names = Array.from({ length: rig.ragdoll!.bone.length }, (_, i) => rig.names[rig.ragdoll!.bone[i]!] ?? `body ${i}`);

function settle(yaw: number, tell: boolean): number {
  const doll = new Ragdoll(rig, rig.ragdoll!);
  doll.start(pose(rig.ragdoll!.limp), pose(rig.ragdoll!.limp - 1), 60, w.hf.heightAt(60, 64), 64, yaw, 1);
  let last = Float64Array.from(doll.x);
  for (let step = 1; step <= 600; step++) {
    const moving = doll.step(w, 1 / 60);
    if (tell && (step % 15 === 0 || !moving)) {
      const moved = names.map((n, i) => `${n} ${(100 * Math.hypot(doll.x[i * 3]! - last[i * 3]!, doll.x[i * 3 + 1]! - last[i * 3 + 1]!, doll.x[i * 3 + 2]! - last[i * 3 + 2]!)).toFixed(1)}`);
      console.log(`${(step / 60).toFixed(2)} s: ${moved.join(", ")} cm`);
      last = Float64Array.from(doll.x);
    }
    if (!moving) return step / 60;
  }
  return Infinity;
}

if (process.argv[3] !== undefined) console.log(`asleep at ${settle(Number(process.argv[3]), true).toFixed(2)} s`);
else for (let k = 0; k < 6; k++) console.log(`heading ${(k * 1.05).toFixed(2)}: asleep at ${settle(k * 1.05, false).toFixed(2)} s`);
