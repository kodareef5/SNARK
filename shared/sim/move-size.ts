import type { MoveParams } from "./character.ts";

/** Mutable only for an owned, cached copy. Registry movement definitions remain immutable. */
export type SizedMove = { -readonly [K in keyof MoveParams]: MoveParams[K] };

/** Body geometry scales with growth; authored speeds, forces, stamina and slope angles retain their own semantics. */
export function copyMoveSize(out: SizedMove, source: MoveParams, size = 1): void {
  out.radius = source.radius * size;
  out.height = source.height * size;
  out.eyeHeight = source.eyeHeight * size;
  out.crouchHeight = source.crouchHeight * size;
  out.crouchEye = source.crouchEye * size;
  out.proneHeight = source.proneHeight * size;
  out.proneEye = source.proneEye * size;
  out.stepUp = source.stepUp * size;
  out.stepDown = source.stepDown * size;
  out.swimDepth = source.swimDepth === undefined ? undefined : source.swimDepth * size;
  out.swimEyeHeight = source.swimEyeHeight === undefined ? undefined : source.swimEyeHeight * size;
}
