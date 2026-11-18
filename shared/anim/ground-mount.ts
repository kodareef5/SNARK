import { quatMul, quatRotate } from '../math/quat.ts';
import { MODE_WALK, type MoveParams } from '../sim/character.ts';
import type { CollisionWorld } from '../world/collide.ts';
import { GroundMountFrame, groundMountFrame } from '../world/ground-mount.ts';
import type { AnimState } from './pose.ts';
import type { Solved } from './skeleton.ts';

const frame = new GroundMountFrame();
/** Apply once to a fresh solved pose, before its ordinary world yaw. Flying, swimming, falling and held poses stay authored. */
export function groundMountPose(solved: Solved, st: AnimState, w: CollisionWorld, p: MoveParams, x: number, y: number, z: number, yaw: number): void {
  if (p.lowStance || p.flies || !st.grounded || st.mode !== MODE_WALK || st.out || st.held) return;
  groundMountFrame(w, p, x, y, z, yaw, frame);
  if (!frame.supported) return;
  for (let bone = 0; bone < solved.pos.length / 3; bone++) {
    const at = bone * 3;
    quatRotate(frame.rotation, 0, solved.pos[at]!, solved.pos[at + 1]!, solved.pos[at + 2]!, solved.pos, at);
    solved.pos[at + 1]! += frame.lift;
    quatMul(solved.rot, bone * 4, frame.rotation, 0, solved.rot, bone * 4);
  }
}
