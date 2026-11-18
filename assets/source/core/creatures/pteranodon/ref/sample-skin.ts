// Export the native flight skin and pose matrices for authoring distance silhouettes.
import { readFileSync } from "node:fs";
import { writeBones } from "../../../../../../client/core/render/characters.ts";
import { sampleClip } from "../../../../../../shared/anim/clip.ts";
import { buildRig } from "../../../../../../shared/anim/rigs.ts";
import { solve } from "../../../../../../shared/anim/skeleton.ts";
import { parsePack } from "../../../../../../shared/pack/pack.ts";
import { unpackMeshes } from "../../../../../../tools/pack/write.ts";

const pack = parsePack(readFileSync(new URL("../pteranodon.snpk", import.meta.url)));
const rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
const mesh = unpackMeshes(pack).find(m => m.id === "core:pteranodon")!.lods[0]!;
const poses: number[][] = [];
const samples = [
  ["idle", [0, 50]], ["walk", [2, 9]], ["take_off", [8, 19]], ["fly", [5, 15, 22]],
  ["glide", [0]], ["land", [20, 36]], ["barrel_roll", [10]], ["grab", [6]],
] as const;
for (const [name, frames] of samples) {
  for (const frame of frames) {
    sampleClip(rig.clips.get(name)!, frame, rig.a);
    solve(rig, rig.a, rig.solved);
    const matrices = new Float32Array(rig.bones * 12);
    writeBones(matrices, 0, rig.solved, rig.rest, null, 0, 0, 0, 0);
    poses.push(Array.from(matrices));
  }
}
console.log(JSON.stringify({
  names: rig.names, poses, points: Array.from(mesh.positions), triangles: Array.from(mesh.indices),
  joints: Array.from(mesh.joints!), weights: Array.from(mesh.weights!),
}));
