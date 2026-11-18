// Measure actual finest skin against the ground before and after the native limp handoff.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { writeBones } from "../../client/core/render/characters.ts";
import { sampleClip } from "../../shared/anim/clip.ts";
import { Ragdoll } from "../../shared/anim/ragdoll.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { flatWorld } from "../../tests/fixtures/world.ts";
import { unpackMeshes } from "../pack/write.ts";

const bytes = readFileSync("assets/source/core/creatures/rex/rex.snpk");
const pack = parsePack(bytes), rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
const lod = unpackMeshes(pack).find(m => m.id === "core:rex")!.lods[0]!;
const matrices = new Float32Array(rig.bones * 12);
function sample(clip: string, frame: number, out: Solved = rig.solved): void {
  sampleClip(rig.clips.get(clip)!, frame, rig.a);
  solve(rig, rig.a, out);
}

function clearance(yaw: number, slope: number): { height: number; bone: string } {
  writeBones(matrices, 0, rig.solved, rig.rest, null, 0, 0, 0, yaw);
  let height = Infinity, bone = "";
  for (let i = 0; i < lod.positions.length / 3; i++) {
    const x = lod.positions[i * 3]!, y = lod.positions[i * 3 + 1]!, z = lod.positions[i * 3 + 2]!;
    let above = 0, strongest = -1, joint = 0;
    for (let k = 0; k < 4; k++) {
      const j = lod.joints![i * 4 + k]!, w = lod.weights![i * 4 + k]!, b = 12 * j;
      if (!w) continue;
      const worldX = matrices[b]! * x + matrices[b + 1]! * y + matrices[b + 2]! * z + matrices[b + 3]!;
      const worldY = matrices[b + 4]! * x + matrices[b + 5]! * y + matrices[b + 6]! * z + matrices[b + 7]!;
      above += w * (worldY - slope * worldX);
      if (w > strongest) { strongest = w; joint = j; }
    }
    if (above < height) { height = above; bone = rig.names[joint]!; }
  }
  return { height: Number(height.toFixed(4)), bone };
}
const authored = ["torpor_in", "torpor_idle", "torpor_eat", "torpor_out", "death"].map(clip => {
  const frames = rig.clips.get(clip)!.frames;
  let low = Infinity, high = -Infinity;
  for (let frame = 0; frame < frames; frame++) {
    sample(clip, frame);
    const h = clearance(0, 0).height;
    low = Math.min(low, h); high = Math.max(high, h);
  }
  return { clip, frames, lowest: low, highest: high };
});
const falls = [];
for (const slope of [0, .12, .35]) {
  const w = flatWorld();
  for (let j = 0; j < w.hf.nz; j++) for (let i = 0; i < w.hf.nx; i++) w.hf.setSample(i, j, (i * TERRAIN_CELL - 64) * slope);
  for (let i = 0; i < 8; i++) {
    const yaw = i * Math.PI / 4, doll = new Ragdoll(rig, rig.ragdoll!), before = new Solved(rig.bones);
    sample("death", rig.ragdoll!.limp - 1, before);
    sample("death", rig.ragdoll!.limp);
    doll.start(rig.solved, before, 64, 0, 64, yaw, 1);
    let seconds: number | null = null;
    for (let step = 1; step <= 300; step++) if (!doll.step(w, 1 / 60)) { seconds = step / 60; break; }
    doll.pose(rig.solved);
    falls.push({ slope, yaw, sleep: seconds, ...clearance(yaw, slope) });
  }
}
console.log(JSON.stringify({ pack: createHash("sha256").update(bytes).digest("hex"), authored, falls }, null, 2));
