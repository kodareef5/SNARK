// How a creature stands and moves: its pose from what it is doing.
//
// The same packed state a survivor has (shared/anim/pose.ts) says how fast a
// creature is going and whether it is striking; its rig has a clip for each.
// Standing it idles; moving it walks, and from a speed its species gives it
// runs; a strike is the whole body's, from the tick it began. Between
// standing and walking the two are blended by speed, so starting off is not a
// jump. Exactly rounded arithmetic throughout: the server, which hits a
// creature where its capsules are, and every client, which draws it there,
// get the same pose.

import { TAU, detCos, detSin } from "../math/scalar.ts";
import { ACT_NONE } from "../sim/weapon.ts";
import { blendPose, sampleClip, type Pose } from "./clip.ts";
import { SPEED_STEP, type AnimState } from "./pose.ts";
import type { Rig } from "./rigs.ts";
import { rayZones, solve, zoneHit } from "./skeleton.ts";

/** Below this speed a creature's walk is blended with its standing: metres per second. */
const EASE_IN = 1.2;

/**
 * The pose of a creature on `rig` in the state `st` at `tick` (which may fall
 * between ticks). It runs from `runAt` metres per second.
 */
export function creaturePose(rig: Rig, st: AnimState, tick: number, runAt: number, out: Pose): void {
  // A strike, from when it began, for as long as its clip is.
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
 * The zone a ray hits on a creature, or 0. It stands at (bx, by, bz) facing
 * `yaw` (1/65536 turns) in the state `st` at `tick`. The ray starts at (ox,
 * oy, oz) and runs along the unit direction (dx, dy, dz) no farther than
 * `maxT`. `zoneHit` holds the bone and the distance.
 */
export function rayCreature(rig: Rig, st: AnimState, tick: number, runAt: number, bx: number, by: number, bz: number, yaw: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  // Cheap rejection first: most rays pass nowhere near.
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
  // Into the body's space: undo its place, then its yaw (x' = c x + s z, z' = c z - s x).
  const a = (yaw * TAU) / 65536;
  const s = detSin(a);
  const c = detCos(a);
  const rx = ox - bx;
  const rz = oz - bz;
  return rayZones(rig, rig.solved, c * rx - s * rz, oy - by, s * rx + c * rz, c * dx - s * dz, dy, s * dx + c * dz, maxT);
}
