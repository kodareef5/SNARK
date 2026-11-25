// A hull that keeps its attitude as a quaternion, as a helicopter and a boat do: the quaternion back into its state, and the
// yaw, pitch and roll it shows. The angles are display values only; physics, seats and hit geometry keep the quaternion
// through inversion.

import { detAtan2, detCos, detSin, square } from "../math/scalar.ts";
import { quatRotate } from "../math/quat.ts";

/** What of a state the attitude writes. */
export interface RigidAttitude {
  qx: number; qy: number; qz: number; qw: number;
  yaw: number; pitch: number; roll: number;
}

/** Writes `q` into `s` and its angles from it. `up` and `ahead` are left as the hull's up and forward, for the caller. */
export function writeAttitude(s: RigidAttitude, q: Float64Array, up: Float64Array, ahead: Float64Array): void {
  s.qx = q[0]!; s.qy = q[1]!; s.qz = q[2]!; s.qw = q[3]!;
  quatRotate(q, 0, 0, 1, 0, up, 0);
  quatRotate(q, 0, 0, 0, 1, ahead, 0);
  const horizontal = Math.sqrt(square(ahead[0]!) + square(ahead[2]!));
  if (horizontal > 1e-5) s.yaw = detAtan2(ahead[0]!, ahead[2]!);
  s.pitch = detAtan2(ahead[1]!, horizontal);
  s.roll = detAtan2(-(up[0]! * detCos(s.yaw) - up[2]! * detSin(s.yaw)), up[1]!);
}
