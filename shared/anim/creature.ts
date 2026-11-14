// A creature's pose from the same packed state a survivor has (shared/anim/pose.ts). The arithmetic is exactly rounded,
// so the server's hit capsules and every client's drawing use the same pose.

import { TAU, detCos, detSin } from "../math/scalar.ts";
import { ACT_NONE } from "../sim/weapon.ts";
import { blendPose, sampleClip, type Pose } from "./clip.ts";
import { SPEED_STEP, type AnimState } from "./pose.ts";
import type { Rig } from "./rigs.ts";
import { rayZones, solve, zoneHit } from "./skeleton.ts";

/** Below this speed, in metres per second, the walk is blended with the idle so that starting off is not a jump. */
const EASE_IN = 1.2;

/** `tick` may fall between ticks. The creature runs from `runAt` metres per second. */
export function creaturePose(rig: Rig, st: AnimState, tick: number, runAt: number, out: Pose): void {
  // A strike plays on the whole body from the tick it began, for the length of its clip.
  if ((st.action & 7) !== ACT_NONE && rig.attack) {
    const since = (((Math.floor(tick) & 255) - st.actionStart) & 255) + (tick - Math.floor(tick));
    if (since < rig.attack.frames - 1) {
      sampleClip(rig.attack, since, out);
      return;
    }
  }
  const t = tick + st.seed;
  const speed = st.speed * SPEED_STEP;
  const gait = speed >= runAt && rig.run ? rig.run : (rig.walk ?? rig.run);
  if (speed === 0 || !gait) {
    if (rig.idle) sampleClip(rig.idle, t, out);
    else out.rest();
    return;
  }
  sampleClip(gait, t, out);
  if (speed < EASE_IN && rig.idle && gait === rig.walk) {
    sampleClip(rig.idle, t, rig.b);
    blendPose(out, rig.b, out, speed / EASE_IN);
    for (let k = 0; k < 3; k++) out.root[k] = rig.b.root[k]! + (out.root[k]! - rig.b.root[k]!) * (speed / EASE_IN);
  }
}

/**
 * Returns the zone a ray hits, or 0. The creature stands at (bx, by, bz) facing `yaw` (1/65536 turns). The ray starts at
 * (ox, oy, oz) and runs along the unit direction (dx, dy, dz) no farther than `maxT`. `zoneHit` holds the bone and the distance.
 */
export function rayCreature(rig: Rig, st: AnimState, tick: number, runAt: number, bx: number, by: number, bz: number, yaw: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  // Most rays miss the bounding sphere, so test that first.
  const cx = bx - ox;
  const cy = by + rig.mid - oy;
  const cz = bz - oz;
  const along = cx * dx + cy * dy + cz * dz;
  const off2 = cx * cx + cy * cy + cz * cz - along * along;
  if (off2 > rig.reach * rig.reach || along < -rig.reach || along > maxT + rig.reach) {
    zoneHit.zone = 0;
    zoneHit.bone = -1;
    zoneHit.t = maxT;
    return 0;
  }
  creaturePose(rig, st, tick, runAt, rig.a);
  solve(rig, rig.a, rig.solved);
  // Move the ray into the body's space by undoing its position, then its yaw. Yaw is x' = c x + s z, z' = c z - s x.
  const a = (yaw * TAU) / 65536;
  const s = detSin(a);
  const c = detCos(a);
  const rx = ox - bx;
  const rz = oz - bz;
  return rayZones(rig, rig.solved, c * rx - s * rz, oy - by, s * rx + c * rz, c * dx - s * dz, dy, s * dx + c * dz, maxT);
}
