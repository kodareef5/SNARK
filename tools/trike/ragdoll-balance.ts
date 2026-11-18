// Diagnose source compound-foot balance without mutating a native pack or solver.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { writeBones } from "../../client/core/render/characters.ts";
import { CreatureAnim } from "../../shared/anim/creature.ts";
import { layCorpse } from "../../shared/anim/corpse.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { Solved } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { groundUnder } from "../../shared/world/collide.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";
import { unpackMeshes } from "../pack/write.ts";

const bytes = readFileSync("assets/source/core/creatures/trike/trike.snpk");
const pack = parsePack(new Uint8Array(bytes)), mesh = unpackMeshes(pack).find(m => m.id === "core:trike")!.lods[0]!;
const reg = coreRegistry(), kind = reg.index.get("core:trike")!;
const hf = new Heightfield({ chunksX: 4, chunksZ: 4 }, 2, -32, 1 / 256);
for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) hf.setSample(x, z, 1 + .18 * (z * hf.cell - 94) + .07 * (x * hf.cell - 128));
const world = { hf, structs: new StructureStore(hf.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
const trials = [];
for (const name of ["authored", "same-supports-reversed", "same-supports-reversed-bounded"] as const) {
  const rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
  if (name !== "authored") for (const end of ["front", "back"]) for (const side of ["l", "r"]) {
    const a = rig.names.indexOf(`${end}_toes_${side}`), b = rig.names.indexOf(`${end}_pad_${side}`);
    // These bones share their authored origin and orientation. Exchange the
    // two supports exactly: their union in every posed toe frame is unchanged.
    for (const values of [rig.capA, rig.capB]) {
      const old = values.slice(a * 3, a * 3 + 3);
      values.copyWithin(a * 3, b * 3, b * 3 + 3); values.set(old, b * 3);
    }
    const old = rig.capR[a]!; rig.capR[a] = rig.capR[b]!; rig.capR[b] = old;
  }
  if (name.endsWith("bounded")) for (let j = 0; j < rig.ragdoll!.bone.length; j++) {
    const bone = rig.names[rig.ragdoll!.bone[j]!]!;
    const angles = bone.includes("_upper_") ? [85, 45] : bone.includes("_lower_") ? [90, 10] : bone.includes("_foot_") ? [90, 35] : bone.includes("_toes_") ? [25, 10] : null;
    if (angles) { rig.ragdoll!.swing[j] = angles[0]! * Math.PI / 180; rig.ragdoll!.twist[j] = angles[1]! * Math.PI / 180; }
  }
  const anim = new CreatureAnim(rig, 2.5, reg.move[kind]!.swimSpeed, reg.combat[kind] ?? null), rows = [];
  for (const i of [0, 2, 4, 6, 8, 10, 12, 14]) {
    const x = 72 + i % 4 * 36, z = 72 + Math.floor(i / 4) * 36, y = groundUnder(hf, x, z, reg.move[kind]!.radius), yaw = i * .7;
    const solved = new Solved(rig.bones), doll = layCorpse(anim, false, false, x, y, z, yaw, 1, solved)!;
    let sleep: number | null = null, awakeAt3 = false;
    for (let frame = 0; frame < 600; frame++) {
      doll.step(world, 1 / 60);
      if (frame === 179) awakeAt3 = doll.awake;
      if (!doll.awake) { sleep = (frame + 1) / 60; break; }
    }
    doll.pose(solved);
    const matrices = new Float32Array(rig.bones * 12); writeBones(matrices, 0, solved, rig.rest, null, x, y, z, yaw);
    let skinMinimum = Infinity, skinBelow3mm = 0, witness = -1;
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
      const p = [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) for (let k = 0; k < 4; k++) {
        const at = mesh.joints![vertex * 4 + k]! * 12 + axis * 4;
        p[axis]! += mesh.weights![vertex * 4 + k]! * (matrices[at]! * mesh.positions[vertex * 3]! + matrices[at + 1]! * mesh.positions[vertex * 3 + 1]! + matrices[at + 2]! * mesh.positions[vertex * 3 + 2]! + matrices[at + 3]!);
      }
      const clearance = p[1]! - hf.heightAt(p[0]!, p[2]!);
      if (clearance < skinMinimum) { skinMinimum = clearance; witness = vertex; }
      if (clearance < -.003) skinBelow3mm++;
    }
    rows.push({ i, x, y, z, yaw, size: 1, awakeAt3, sleep, skinMinimum, skinBelow3mm, witness });
  }
  trials.push({ name, rows });
}
const report = { pack_sha256: createHash("sha256").update(bytes).digest("hex"),
  scope: "Read-only source trials on the unchanged mixed-corpse benchmark terrain/positions, Trike rows only. The final skin measurement is separate from the three-second sleep gate. In-memory support reversal and joint limits are diagnostics, not accepted source changes.", trials };
writeFileSync("var/trike-art/ragdoll-balance.json", JSON.stringify(report, null, 2) + "\n");
console.log(report);
