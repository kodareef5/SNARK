import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { sampleClip } from "../../shared/anim/clip.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { CREATURE_ASSETS } from "../fixtures/assets.ts";
import { artTest } from "../fixtures/needs-art.ts";

function brachio() {
  return parsePack(readFileSync(CREATURE_ASSETS.find((asset) => asset.id === "core:brachio")!.file));
}

artTest("both distant Brachiosaurus meshes keep a projecting muzzle and four broad soles", () => {
  const pack = brachio(),
    names = pack.header.rigs[0]!.names!;
  const body = unpackMeshes(pack).find((mesh) => mesh.id === "core:brachio")!;
  for (const lod of body.lods.slice(-2)) {
    for (const kind of ["fore", "hind"])
      for (const side of ["l", "r"]) {
        const joint = names.indexOf(kind + "_foot_" + side),
          xs: number[] = [];
        for (let v = 0; v < lod.bones!.length; v++) {
          if (lod.bones![v] === joint && lod.positions[3 * v + 1]! < 0.06) xs.push(lod.positions[3 * v]!);
        }
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.64);
      }
    const muzzle: number[] = [];
    for (let v = 0; v < lod.bones!.length; v++) {
      if (names[lod.bones![v]!] === "skull" && lod.positions[3 * v + 2]! > 6.62)
        muzzle.push(lod.positions[3 * v]!);
    }
    expect(Math.max(...muzzle) - Math.min(...muzzle)).toBeGreaterThan(0.22);
  }
});

artTest("the striking forefoot lifts clear and lands during the registered contact window", () => {
  const pack = brachio(),
    rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
  const clip = rig.clips.get("attack")!;
  const foot = rig.names.indexOf("fore_foot_l"),
    other = rig.names.indexOf("fore_foot_r");
  function height(bone: number, frame: number) {
    sampleClip(clip, frame, rig.a);
    solve(rig, rig.a, rig.solved);
    const at = new Float64Array(3);
    boneToModel(rig.solved, bone, 0, -0.12, 0.19, at);
    return at[1]!;
  }
  expect(height(foot, 15) - height(foot, 0)).toBeGreaterThan(0.9);
  expect(Math.abs(height(other, 15) - height(other, 0))).toBeLessThan(0.2);
  expect(Math.abs(height(foot, 22) - height(foot, 0))).toBeLessThan(0.15);
});
