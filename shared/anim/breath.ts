// Authored airway witnesses share the actual KO/get-up pose with rendering and hit tests.
import { detCos, detSin } from "../math/scalar.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { poseCreatureOn, type CreatureAnim } from "./creature.ts";
import { CUE_TORPOR, type AnimState } from "./pose.ts";
import { boneToModel } from "./skeleton.ts";

const point = new Float64Array(3);

/** Null preserves legacy breathing. Yaw is radians; size scales native socket offsets exactly once. */
export function posedSubmerged(a: CreatureAnim, st: AnimState, tick: number, world: CollisionWorld, x: number, y: number, z: number, yaw: number, size = 1): boolean | null {
  const pair = a.rig.breath;
  if (!pair || st.dead || (!st.out && st.cue !== CUE_TORPOR) || !(size > 0) || !Number.isFinite(x + y + z + yaw + size)) return null;
  poseCreatureOn(a, st, tick, world, x, y, z, yaw, size);
  const co = detCos(yaw), sn = detSin(yaw);
  let submerged = true;
  for (let i = 0; i < 2; i++) {
    const s = pair[i]!;
    boneToModel(a.rig.solved, s.bone, s.x, s.y, s.z, point);
    const px = x + size * (co * point[0]! + sn * point[2]!);
    const py = y + size * point[1]!;
    const pz = z + size * (co * point[2]! - sn * point[0]!);
    const water = world.hf.waterAt(px, pz);
    if (!Number.isFinite(px + py + pz) || Number.isNaN(water)) return null;
    if (py >= water) submerged = false;
  }
  return submerged;
}
