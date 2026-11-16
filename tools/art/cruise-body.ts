// Native finest body/armor/hair vertices at selected feasible creator profiles and walking poses.
// This samples actual rendering transforms; it is not a certificate over every creator/animation state.
import { readFileSync } from "node:fs";
import { writeBones } from "../../client/core/render/characters.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { Gait } from "../../shared/anim/gait.ts";
import { HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { defaultLook, lookLift, lookScales, REGION_COUNT, setRegion } from "../../shared/anim/look.ts";
import { AnimState, HumanAnim, humanPose } from "../../shared/anim/pose.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../pack/write.ts";

export interface CruiseBodyPose { value: number; mesh: string; sex: string; speed: number; phase: number; pitch: number; direction: number; }
export interface CruiseBodyVertex { mesh: string; vertex: number; profile: number; at: readonly number[]; }

/** Feasible creator profiles through the renderer's exact matrices, used to distinguish a real strike from an interval overlap. */
export function cruiseBodyVertices(sample: CruiseBodyPose, inspect?: (vertex: CruiseBodyVertex) => void, profiles = Array.from({ length: 3 + REGION_COUNT * 2 }, (_, i) => i)) {
  const bodies = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk", import.meta.url))));
  const clips = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-clips/human-clips.snpk", import.meta.url))));
  const anim = new HumanAnim(clips.clips), selected = unpackMeshes(bodies).filter(m => m.id.startsWith(`core:human_${sample.sex}/`));
  const rest = Float32Array.from(bodies.header.rigs.find(r => r.id === `human_${sample.sex}`)!.rest);
  const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES), scales = new Float32Array(HUMAN_BONES * 3), matrices = new Float32Array(HUMAN_BONES * 12);
  const result = { minimum: [Infinity, Infinity, Infinity], maximum: [-Infinity, -Infinity, -Infinity], witnesses: ["", "", "", "", "", ""] };
  for (const profile of profiles) {
    const look = defaultLook();
    if (profile > 0) for (let r = 0; r < REGION_COUNT; r++) {
      const base = profile === 1 || (profile >= 3 && profile < 3 + REGION_COUNT) ? -1 : 1;
      setRegion(look, r, profile >= 3 && r === (profile - 3) % REGION_COUNT ? -base : base);
    }
    const state = new AnimState(), gait = new Gait(); state.dir = sample.direction; state.pitch = sample.pitch; gait.speed = sample.speed; gait.phase = sample.phase;
    humanPose(anim, state, sample.phase * anim.idle!.frames, pose, gait); lookScales(look, scales); pose.root[1]! += lookLift(scales, rest);
    solve(HUMAN, pose, solved, rest, scales); writeBones(matrices, 0, solved, rest, scales, 0, 0, 0, -sample.direction * Math.PI / 8);
    for (const mesh of selected) { const lod = mesh.lods[0]!;
      for (let v = 0; v < lod.positions.length / 3; v++) {
        const at = [0, 0, 0];
        for (let influence = 0; influence < (lod.joints && lod.weights ? 4 : 1); influence++) {
          const weight = lod.weights?.[v * 4 + influence] ?? 1, bone = lod.joints?.[v * 4 + influence] ?? lod.bones![v]!;
          for (let axis = 0; axis < 3; axis++) { const k = bone * 12 + axis * 4;
            at[axis]! += weight * (matrices[k]! * lod.positions[v * 3]! + matrices[k + 1]! * lod.positions[v * 3 + 1]! + matrices[k + 2]! * lod.positions[v * 3 + 2]! + matrices[k + 3]!);
          }
        }
        for (let axis = 0; axis < 3; axis++) {
          if (at[axis]! < result.minimum[axis]!) { result.minimum[axis] = at[axis]!; result.witnesses[axis] = `${mesh.id} vertex${v} profile${profile} at${at}`; }
          if (at[axis]! > result.maximum[axis]!) { result.maximum[axis] = at[axis]!; result.witnesses[axis + 3] = `${mesh.id} vertex${v} profile${profile} at${at}`; }
        }
        inspect?.({ mesh: mesh.id, vertex: v, profile, at });
      }
    }
  }
  return result;
}

