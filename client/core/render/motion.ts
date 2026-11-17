// The parts of statics that move when used (StructureDef.motion): each drawn as one piece on a bone of its own, its
// placement eased between the two its content gives. A static at rest keeps the pose it was last given.

import type { MotionFacet, PartPlacement } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { motionProgress, motionTicks, type MotionState } from "../../../shared/sim/motion.ts";
import type { MapStatics } from "../../../shared/world/mapfile.ts";

/** What the scene draws moving parts from: every static's state as the server told it, the clock, and the map's statics. */
export interface MotionSource {
  states(): ReadonlyMap<number, MotionState>;
  tick(): number;
  statics(): MapStatics | null;
}

/** Floats a part's pose takes: its 3x4 matrix from the static's origin, row by row, and how much it is scaled at most. */
export const PART_FLOATS = 13;

/** A static of the map that moves when used. `pose` holds each part's at `posed`, the progress it was last given, -1 for none. */
export interface Moving {
  readonly ref: number;
  readonly kind: number;
  readonly facet: MotionFacet;
  readonly ticks: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly color: number;
  readonly pose: Float32Array;
  /** Each part's level, as the last frame chose it. */
  readonly level: Int8Array;
  /** Per part, 1 for one placed alike at both ends of the motion, which never moves. */
  readonly fixed: Uint8Array;
  posed: number;
  progress: number;
}

const ONE: readonly [number, number, number] = [1, 1, 1];
const NONE: readonly [number, number, number, number] = [0, 0, 0, 1];

/** The map's moving statics, once its statics have come. */
export function movingOf(reg: Registry, statics: MapStatics): Moving[] {
  const out: Moving[] = [];
  const kinds = statics.kinds.map((id) => reg.index.get(id) ?? 0);
  for (let c = 0; c + 1 < statics.first.length; c++) {
    for (let row = statics.first[c]!; row < statics.first[c + 1]!; row++) {
      const kind = kinds[statics.kind[row]!]!, facet = reg.motion[kind];
      if (!facet) continue;
      const d = reg.defs[kind]!;
      out.push({ ref: c * 65536 + row - statics.first[c]!, kind, facet, ticks: motionTicks(facet), x: statics.x[row]!, y: statics.y[row]!, z: statics.z[row]!, yaw: statics.yaw[row]!, color: d.type === "structure" ? d.color : 0, pose: new Float32Array(facet.parts.length * PART_FLOATS), level: new Int8Array(facet.parts.length).fill(-1), fixed: Uint8Array.from(facet.parts, (part) => (JSON.stringify(part.from) === JSON.stringify(part.to) ? 1 : 0)), posed: -1, progress: 0 });
    }
  }
  return out;
}

/** Its progress now, and its parts posed at it where they are not already. */
export function poseMoving(t: Moving, state: MotionState | undefined, tick: number): void {
  const p = state ? motionProgress(state, t.ticks, tick) : 0;
  t.progress = p;
  if (p === t.posed) return;
  t.posed = p;
  const e = p * p * (3 - 2 * p), a = (t.yaw / 65536) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
  const parts = t.facet.parts;
  for (let i = 0; i < parts.length; i++) partPose(t.pose, i * PART_FLOATS, parts[i]!.from, parts[i]!.to, e, s, c);
}

/**
 * A part's matrix between its placements at `e`, from its static's origin turned by the yaw whose sine and cosine are `s`
 * and `c` as a rigid instance is turned: offset and scale straight, the turn by the shorter way, normalised.
 */
function partPose(out: Float32Array, at: number, from: PartPlacement, to: PartPlacement, e: number, s: number, c: number): void {
  const q0 = from.turn ?? NONE, q1 = to.turn ?? NONE, s0 = from.scale ?? ONE, s1 = to.scale ?? ONE;
  const sign = q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3] < 0 ? -1 : 1;
  let x = q0[0] + (sign * q1[0] - q0[0]) * e, y = q0[1] + (sign * q1[1] - q0[1]) * e, z = q0[2] + (sign * q1[2] - q0[2]) * e, w = q0[3] + (sign * q1[3] - q0[3]) * e;
  const n = Math.hypot(x, y, z, w);
  x /= n; y /= n; z /= n; w /= n;
  const sx = s0[0] + (s1[0] - s0[0]) * e, sy = s0[1] + (s1[1] - s0[1]) * e, sz = s0[2] + (s1[2] - s0[2]) * e;
  const tx = from.at[0] + (to.at[0] - from.at[0]) * e, ty = from.at[1] + (to.at[1] - from.at[1]) * e, tz = from.at[2] + (to.at[2] - from.at[2]) * e;
  // The turn's rows, each column scaled, and then the static's yaw: x' = c x + s z, z' = c z - s x.
  const r00 = (1 - 2 * (y * y + z * z)) * sx, r01 = 2 * (x * y - z * w) * sy, r02 = 2 * (x * z + y * w) * sz;
  const r10 = 2 * (x * y + z * w) * sx, r11 = (1 - 2 * (x * x + z * z)) * sy, r12 = 2 * (y * z - x * w) * sz;
  const r20 = 2 * (x * z - y * w) * sx, r21 = 2 * (y * z + x * w) * sy, r22 = (1 - 2 * (x * x + y * y)) * sz;
  out[at] = c * r00 + s * r20; out[at + 1] = c * r01 + s * r21; out[at + 2] = c * r02 + s * r22; out[at + 3] = c * tx + s * tz;
  out[at + 4] = r10; out[at + 5] = r11; out[at + 6] = r12; out[at + 7] = ty;
  out[at + 8] = c * r20 - s * r00; out[at + 9] = c * r21 - s * r01; out[at + 10] = c * r22 - s * r02; out[at + 11] = c * tz - s * tx;
  out[at + 12] = Math.max(sx, sy, sz);
}
