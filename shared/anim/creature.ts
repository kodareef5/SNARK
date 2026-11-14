// A creature's pose from the same packed state a survivor has (shared/anim/pose.ts). The arithmetic is exactly rounded,
// so the server's hit capsules and every client's drawing use the same pose.

import { TAU, detCos, detSin } from "../math/scalar.ts";
import { ACT_NONE } from "../sim/weapon.ts";
import { blendPose, sampleClip, type Pose } from "./clip.ts";
import { gaitShares, playGaits, tickPhase, type Gait, type GaitClip } from "./gait.ts";
import { DIR_STEPS, SPEED_STEP, type AnimState } from "./pose.ts";
import type { Rig } from "./rigs.ts";
import { rayZones, solve, zoneHit } from "./skeleton.ts";

/** Below this speed, in metres per second, a walk with no stride is blended with the idle so that starting off is not a jump. */
const EASE_IN = 1.2;
const single: GaitClip[] = [];

/**
 * The gaits that carry it at `speed`. Where every moving clip has a stride they all blend. Otherwise it walks below
 * `runAt` and runs from it, and a clip with no stride is played by time: null then.
 */
function movesAt(rig: Rig, speed: number, runAt: number): readonly GaitClip[] | null {
  if (rig.gaits.length > 0) return rig.gaits;
  const g = rig.run && (speed >= runAt || !rig.walk) ? rig.runGait : rig.walkGait;
  if (!g) return null;
  single[0] = g;
  return single;
}

/** The stride of its legs at `speed`, 0 where they are not played by distance. Fills rig.w with the gaits' shares. */
export function creatureStride(rig: Rig, speed: number, runAt: number): number {
  const moves = movesAt(rig, speed, runAt);
  // The idle takes what the slowest leaves, but not under a run that only a walk played by time comes before.
  return moves ? gaitShares(moves, speed, moves !== single || moves[0] === rig.walkGait, rig.w) : 0;
}

/**
 * Moves a body's gait on to where it is drawn at `tick`, (x, z) facing `yaw` radians, `size` times as large as it was
 * made. A body seen for the first time starts at the phase the server poses it at.
 */
export function advanceCreature(rig: Rig, g: Gait, st: AnimState, tick: number, runAt: number, x: number, z: number, yaw: number, size: number): void {
  const metres = g.track(x, z, yaw, tick, st.speed * SPEED_STEP, rig.turn, size);
  if (metres < 0) g.phase = tickPhase(tick + st.seed, g.speed, creatureStride(rig, g.speed, runAt));
  else g.step(metres, creatureStride(rig, g.speed, runAt));
}

/**
 * `tick` may fall between ticks. The creature runs from `runAt` metres per second. With `gait` its legs are where that
 * says, and without it where the tick puts them.
 */
export function creaturePose(rig: Rig, st: AnimState, tick: number, runAt: number, out: Pose, gait: Gait | null = null): void {
  // A strike plays on the whole body from the tick it began, for the length of its clip.
  if ((st.action & 7) !== ACT_NONE && rig.attack) {
    const since = (((Math.floor(tick) & 255) - st.actionStart) & 255) + (tick - Math.floor(tick));
    if (since < rig.attack.frames - 1) {
      sampleClip(rig.attack, since, out);
      return;
    }
  }
  const t = tick + st.seed;
  const speed = gait ? gait.speed : st.speed * SPEED_STEP;
  const moves = speed > 0 ? movesAt(rig, speed, runAt) : null;
  const clip = speed > 0 && !moves ? (speed >= runAt && rig.run ? rig.run : (rig.walk ?? rig.run)) : null;
  const stride = moves ? creatureStride(rig, speed, runAt) : 0;
  // The idle is under whatever share the gaits leave.
  if (moves ? rig.w[0]! + (moves.length > 1 ? rig.w[1]! : 0) < 1 : !clip || (speed < EASE_IN && clip === rig.walk)) {
    if (rig.idle) sampleClip(rig.idle, t, out);
    else out.rest();
  }
  // Moving away from where it faces, it plays its gait in reverse.
  const turn = st.dir <= DIR_STEPS / 2 ? st.dir : DIR_STEPS - st.dir;
  const backward = turn > DIR_STEPS / 4;
  if (moves) playGaits(moves, rig.w, gait ? gait.phase : tickPhase(t, speed, stride), backward, out, rig.b, rig.c);
  else if (clip && speed < EASE_IN && rig.idle && clip === rig.walk) {
    sampleClip(clip, backward ? -t : t, rig.b);
    blendPose(out, out, rig.b, speed / EASE_IN);
  } else if (clip) sampleClip(clip, backward ? -t : t, out);
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
