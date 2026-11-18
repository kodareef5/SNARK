import { PI, detCos, detSin } from "../math/scalar.ts";
import { quatRotate } from "../math/quat.ts";
import type { MoveParams } from "../sim/character.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { BITE_AIM, creaturePose, type CreatureAnim } from "./creature.ts";
import { groundMountMotion, groundMountPose } from "./ground-mount.ts";
import { PITCH_STEPS, type AnimState } from "./pose.ts";
import { boneToModel, solve } from "./skeleton.ts";
import { GroundMountFrame } from "../world/ground-mount.ts";

/** One creature's posed jaws. Reach keeps the existing species' distance from its root, rather than adding it to its neck. */
export class CreatureBite {
  readonly mouth = new Float64Array(3);
  readonly origin = new Float64Array(3);
  readonly direction = new Float64Array(3);
  readonly anchor = new Float64Array(3);
  reach = 0;
  radius = 0;
}
const frame = new GroundMountFrame();

/** Uses the same clip, mouth socket, head width and ground frame as the rendered creature. False for source-only shapes. */
export function creatureBite(a: CreatureAnim | null, st: AnimState, tick: number, x: number, y: number, z: number, yaw: number, reach: number, out: CreatureBite, world?: CollisionWorld, move?: MoveParams): boolean {
  const socket = a?.rig.sockets.get("mouth");
  if (!a || !socket || !a.attack) return false;
  const rig = a.rig, pose = rig.solved;
  frame.supported = false; st.surfaceSpeed = 1;
  if (world && move) groundMountMotion(st, world, move, x, y, z, yaw, frame);
  creaturePose(a, st, tick, rig.a); solve(rig, rig.a, pose);
  if (world && move) groundMountPose(pose, st, world, move, x, y, z, yaw, frame);
  boneToModel(pose, socket.bone, socket.x, socket.y, socket.z, out.mouth);
  const cap = rig.capA[socket.bone * 3 + 2]! < rig.capB[socket.bone * 3 + 2]! ? rig.capA : rig.capB;
  boneToModel(pose, socket.bone, cap[socket.bone * 3]!, cap[socket.bone * 3 + 1]!, cap[socket.bone * 3 + 2]!, out.origin);
  // The neck's bounded aim defines the forward attack; the head's capsule supplies its volume. Skull rest axes can
  // point up while the bite thrusts forward, so they must not add a second look angle to the attack.
  const pitch = Math.max(-BITE_AIM, Math.min(BITE_AIM, st.pitch * (PI / 2) / PITCH_STEPS));
  out.direction[0] = 0; out.direction[1] = detSin(pitch); out.direction[2] = detCos(pitch);
  if (frame.supported) quatRotate(frame.rotation, 0, 0, out.direction[1]!, out.direction[2]!, out.direction, 0);
  const c = detCos(yaw), s = detSin(yaw), m = out.mouth, d = out.direction, o = out.origin, anchor = out.anchor;
  out.reach = Math.max(0, reach - Math.sqrt(o[0]! * o[0]! + o[2]! * o[2]!));
  // The existing melee ray's .14 m aim tolerance, around this species' authored head width.
  out.radius = Math.max(.06, Math.min(.4, rig.capR[socket.bone]!)) + .14;
  const mx = m[0]!, mz = m[2]!, dx = d[0]!, dz = d[2]!;
  m[0] = x + c * mx + s * mz; m[1]! += y; m[2] = z + c * mz - s * mx;
  const ox = o[0]!, oz = o[2]!;
  o[0] = x + c * ox + s * oz; o[1]! += y; o[2] = z + c * oz - s * ox;
  d[0] = c * dx + s * dz; d[2] = c * dz - s * dx;
  // A jaw already through a wall must not start a ray on its far side. The root joint is inside the creature's chest.
  anchor[0] = x + c * pose.pos[0]! + s * pose.pos[2]!;
  anchor[1] = y + pose.pos[1]!;
  anchor[2] = z + c * pose.pos[2]! - s * pose.pos[0]!;
  return true;
}
