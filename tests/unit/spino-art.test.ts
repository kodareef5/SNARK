import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { sampleClip } from "../../shared/anim/clip.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { CREATURE_ASSETS } from "../fixtures/assets.ts";
import { artTest } from "../fixtures/needs-art.ts";

function spino() {
  const asset = CREATURE_ASSETS.find((a) => a.id === "core:spino")!;
  return parsePack(readFileSync(asset.file));
}

artTest("both distant Spino sails meet the back through the high middle of the fin", () => {
  const pack = spino(),
    names = pack.header.rigs[0]!.names!;
  const body = unpackMeshes(pack).find((mesh) => mesh.id === "core:spino")!;
  for (const lod of body.lods.slice(-2)) {
    // A three-sided cross section once lifted the sail clean off the animal
    // at this station. Compare the actual packed roof and sail intersection.
    const station = 0.81;
    let root = Infinity,
      crest = -Infinity,
      back = -Infinity;
    for (let i = 0; i < lod.indices.length; i += 3) {
      const corners = Array.from(lod.indices.subarray(i, i + 3));
      const joints = corners.map((v) => names[lod.bones![v]!]!);
      const sail = joints.every((name) => name.startsWith("sail_"));
      if (!sail && !joints.every((name) => ["pelvis", "spine", "chest"].includes(name))) continue;
      for (let k = 0; k < 3; k++) {
        const a = 3 * corners[k]!,
          b = 3 * corners[(k + 1) % 3]!;
        const za = lod.positions[a + 2]!,
          zb = lod.positions[b + 2]!;
        if ((za - station) * (zb - station) >= 0) continue;
        const y =
          lod.positions[a + 1]! + ((lod.positions[b + 1]! - lod.positions[a + 1]!) * (station - za)) / (zb - za);
        if (sail) {
          root = Math.min(root, y);
          crest = Math.max(crest, y);
        } else back = Math.max(back, y);
      }
    }
    expect(root).toBeLessThan(back + 0.025);
    expect(crest - back).toBeGreaterThan(1.4);
  }
});

artTest("the Spino's dentary opens away from its maxilla and returns to its resting contact", () => {
  const pack = spino(),
    rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
  const clip = rig.clips.get("attack")!,
    upper = rig.names.indexOf("skull"),
    lower = rig.names.indexOf("jaw");
  function gape(frame: number): number {
    sampleClip(clip, frame, rig.a);
    solve(rig, rig.a, rig.solved);
    const a = new Float64Array(3),
      b = new Float64Array(3);
    boneToModel(rig.solved, upper, 0, -0.98, 2.37, a);
    boneToModel(rig.solved, lower, 0, -0.81, 2.14, b);
    return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
  }
  expect(gape(0)).toBeLessThan(0.07);
  expect(gape(7)).toBeGreaterThan(0.65);
  expect(gape(24)).toBeLessThan(0.07);
});
