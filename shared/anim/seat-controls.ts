import type { Seat } from "../sim/seats.ts";
import type { Pose } from "./clip.ts";
import { fitPilotControls } from "./mount-controls.ts";
import type { Solved } from "./skeleton.ts";

const left = { position: new Float64Array(3) }, right = { position: new Float64Array(3) };

/** Convert authored host-local grip points to the seated pelvis frame, for both authority and presentation. */
export function fitSeatControls(pose: Pose, solved: Solved, rest: Float32Array, scale: Float32Array | null, seat: Seat): number {
  if (!seat.controls) return 0;
  for (let i = 0; i < 3; i++) {
    left.position[i] = seat.controls.left[i]! - seat.anchor[i]!;
    right.position[i] = seat.controls.right[i]! - seat.anchor[i]!;
  }
  return fitPilotControls(pose, solved, rest, scale, left, right);
}
