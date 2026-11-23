import type { Seat } from "../sim/seats.ts";
import type { Pose } from "./clip.ts";
import { fitPilotControls, type MountControl } from "./mount-controls.ts";
import type { Solved } from "./skeleton.ts";
import { quatAxis, quatRotate } from "../math/quat.ts";

const left: MountControl & { position: Float64Array; rotation?: Float64Array } = { position: new Float64Array(3) };
const right: MountControl & { position: Float64Array; rotation?: Float64Array } = { position: new Float64Array(3) };
const rotation = new Float64Array(4), point = new Float64Array(3);

/**
 * Convert authored host-local grip points to the seated pelvis frame, for both authority and presentation. `drop` is how
 * far the seat fit sank the pelvis below the anchor (shared/anim/seat-fit.ts); the grips stay where they are.
 */
export function fitSeatControls(pose: Pose, solved: Solved, rest: Float32Array, scale: Float32Array | null, seat: Seat, steering = 0, drop = 0): number {
  if (!seat.controls) return 0;
  const turn = seat.controls.turn;
  if (turn) quatAxis(rotation, 0, ...turn.axis, steering * turn.ratio);
  left.rotation = right.rotation = turn ? rotation : undefined;
  for (let i = 0; i < 3; i++) {
    left.position[i] = seat.controls.left[i]! - seat.anchor[i]!;
    right.position[i] = seat.controls.right[i]! - seat.anchor[i]!;
  }
  if (turn) for (const [control, grip] of [[left, seat.controls.left], [right, seat.controls.right]] as const) {
    quatRotate(rotation, 0, grip[0] - turn.pivot[0], grip[1] - turn.pivot[1], grip[2] - turn.pivot[2], point, 0);
    for (let i = 0; i < 3; i++) control.position[i] = point[i]! + turn.pivot[i]! - seat.anchor[i]!;
  }
  if (drop) { left.position[1]! += drop; right.position[1]! += drop; }
  return fitPilotControls(pose, solved, rest, scale, left, right, seat.controls.style);
}
