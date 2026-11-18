import { quatMul, quatRotate } from '../math/quat.ts';
import { TAU, detSin, detCos } from '../math/scalar.ts';
import { MODE_WALK, type MoveParams } from '../sim/character.ts';
import type { CollisionWorld } from '../world/collide.ts';
import { GroundMountFrame, groundMountFrame } from '../world/ground-mount.ts';
import { DIR_STEPS, type AnimState } from './pose.ts';
import { prepareBiteAim } from './bite-aim.ts';
import type { Solved } from './skeleton.ts';

const frame = new GroundMountFrame();
/** Prepare once before sampling clips; the same footing can then align the resulting bones without another query. */
export function groundMountMotion(st: AnimState, w: CollisionWorld, p: MoveParams, x: number, y: number, z: number, yaw: number, out: GroundMountFrame): void {
  st.surfaceSpeed = 1; out.supported = false;
  prepareBiteAim(st);
  if (p.lowStance || p.flies || st.mode !== MODE_WALK || st.out || st.held) return;
  groundMountFrame(w, p, x, y, z, yaw, out);
  prepareBiteAim(st, out.supported ? out.rotation : undefined);
  if (!st.grounded || !out.supported || st.speed === 0) return;
  const direction = yaw + st.dir * TAU / DIR_STEPS;
  const climb = (out.nx * detSin(direction) + out.nz * detCos(direction)) / out.ny;
  st.surfaceSpeed = Math.sqrt(1 + climb * climb);
}
/** Apply once to a fresh solved pose, before its ordinary world yaw. Flying, swimming and held poses stay authored; near-ground airborne frames fade by actual clearance. */
export function groundMountPose(solved: Solved, st: AnimState, w: CollisionWorld, p: MoveParams, x: number, y: number, z: number, yaw: number, prepared?: GroundMountFrame): void {
  if (p.lowStance || p.flies || st.mode !== MODE_WALK || st.out || st.held) return;
  const footing = prepared ?? frame;
  if (!prepared) groundMountFrame(w, p, x, y, z, yaw, footing);
  if (!footing.supported) return;
  if (footing.rotation[0] === 0 && footing.rotation[2] === 0 && Math.abs(footing.lift) < 1e-6) return;
  for (let bone = 0; bone < solved.pos.length / 3; bone++) {
    const at = bone * 3;
    quatRotate(footing.rotation, 0, solved.pos[at]!, solved.pos[at + 1]!, solved.pos[at + 2]!, solved.pos, at);
    solved.pos[at + 1]! += footing.lift;
    quatMul(solved.rot, bone * 4, footing.rotation, 0, solved.rot, bone * 4);
  }
}
