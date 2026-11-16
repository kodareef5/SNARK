import { quatNormalize } from "../math/quat.ts";
import { clamp } from "../math/scalar.ts";
import type { HelicopterState } from "./helicopter.ts";
import type { HelicopterSpec } from "./vehicle.ts";

const q = new Float64Array(4);
/** Fraction of the oriented cabin's vertical extent below the waterline. Works through banks, dives and inversion. */
export function helicopterImmersion(s: Readonly<HelicopterState>, p: HelicopterSpec, water: number): number {
  return boxImmersion(s, water, [0, (p.clearance + p.height) / 2, 0], [p.halfWidth, (p.height - p.clearance) / 2, p.halfLength]);
}

/** An inverted engine can enter water before the cabin. A dipped mast alone does not flood the engine. */
export function helicopterEngineImmersion(s: Readonly<HelicopterState>, p: HelicopterSpec, water: number): number {
  return p.engineBox ? boxImmersion(s, water, p.engineBox.at, p.engineBox.half) : 0;
}

function boxImmersion(s: Readonly<HelicopterState>, water: number, at: readonly number[], half: readonly number[]): number {
  if (!Number.isFinite(water)) return 0;
  q.set([s.qx, s.qy, s.qz, s.qw]); quatNormalize(q, 0);
  const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!;
  const upY = 1 - 2 * (x * x + z * z), sideY = 2 * (x * y + w * z), forwardY = 2 * (y * z - w * x);
  const centre = s.y + sideY * at[0]! + upY * at[1]! + forwardY * at[2]!;
  const extent = Math.abs(sideY) * half[0]! + Math.abs(upY) * half[1]! + Math.abs(forwardY) * half[2]!;
  return clamp((water - centre + extent) / Math.max(.01, extent * 2), 0, 1);
}
