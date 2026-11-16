import { quatNormalize } from "../math/quat.ts";
import { clamp } from "../math/scalar.ts";
import type { HelicopterState } from "./helicopter.ts";
import type { HelicopterSpec } from "./vehicle.ts";

const q = new Float64Array(4);
/** Fraction of the oriented cabin's vertical extent below the waterline. Works through banks, dives and inversion. */
export function helicopterImmersion(s: Readonly<HelicopterState>, p: HelicopterSpec, water: number): number {
  if (!Number.isFinite(water)) return 0;
  q.set([s.qx, s.qy, s.qz, s.qw]); quatNormalize(q, 0);
  const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!;
  const upY = 1 - 2 * (x * x + z * z), sideY = 2 * (x * y + w * z), forwardY = 2 * (y * z - w * x);
  const centre = s.y + upY * (p.clearance + p.height) / 2;
  const extent = Math.abs(sideY) * p.halfWidth + Math.abs(upY) * (p.height - p.clearance) / 2 + Math.abs(forwardY) * p.halfLength;
  return clamp((water - centre + extent) / Math.max(.01, extent * 2), 0, 1);
}
