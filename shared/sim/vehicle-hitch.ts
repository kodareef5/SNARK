// A tractor and its trailer share one tick: their substeps alternate, and a ball joint at the fifth wheel joins them.
import { TICK_DT } from "../coords.ts";
import { quatRotate } from "../math/quat.ts";
import { len3, wrapAngle } from "../math/scalar.ts";
import { beginVehicleTick, endVehicleTick, vehicleSubstep } from "./vehicle-chassis.ts";
import { vehicleRotation } from "./vehicle-frame.ts";
import { applyVehicleImpulse, vehicleMassProperties, vehiclePointInverseMass, vehiclePointVelocity } from "./vehicle-rigid.ts";
import type { CarState, VehicleInput, VehicleSpec, VehicleState, VehicleStep, VehicleWorld } from "./vehicle.ts";

type HitchState = VehicleState & Partial<Pick<CarState, "engineCondition" | "engineOn" | "hullCondition" | "flooding">>;

/** How far the trailer may swing about the kingpin before the frames meet: radians either way. */
export const HITCH_YAW = 1.45;
export const HITCH_PITCH = .3;
/** Farther apart than this, the joint is broken rather than solved (a teleport, a respawn). */
export const HITCH_BREAK = 3;
const ITERATIONS = 6, BETA = .25;
const TRAILER_INPUT: VehicleInput = { throttle: 0, steer: 0, brake: 0, handbrake: false, pilot: false };

const q = new Float64Array(4), a = new Float64Array(3), b = new Float64Array(3), va = new Float64Array(3), vb = new Float64Array(3);
const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const;

/** World position of a local point on a body. */
export function hitchPoint(s: VehicleState, local: readonly number[], out: Float64Array | number[]): void {
  vehicleRotation(s, q); quatRotate(q, 0, local[0]!, local[1]!, local[2]!, out, 0);
  out[0] += s.x; out[1] += s.y; out[2] += s.z;
}

/** Distance between the fifth wheel and the kingpin. */
export function hitchGap(tractor: VehicleState, tSpec: VehicleSpec, trailer: VehicleState, rSpec: VehicleSpec): number {
  hitchPoint(tractor, tSpec.fifthWheel!, a); hitchPoint(trailer, rSpec.kingpin!, b);
  return len3(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}


/** Holds one relative rotation rate under its limit: `rate` reads a body's local rate, `inertia` picks its axis. */
function limit(t: HitchState, tSpec: VehicleSpec, r: HitchState, rSpec: VehicleSpec, angle: number, most: number, axis: "yaw" | "pitch", dt: number): void {
  const over = Math.abs(angle) - most;
  if (over <= 0) return;
  const key = axis === "yaw" ? "yawRate" : "pitchRate", sign = Math.sign(angle);
  const it = axis === "yaw" ? vehicleMassProperties(tSpec, t).iy : vehicleMassProperties(tSpec, t).ix;
  const ir = axis === "yaw" ? vehicleMassProperties(rSpec, r).iy : vehicleMassProperties(rSpec, r).ix;
  // Pitch rates are stored negated (vehicle-rigid.ts), so the relative rate flips with them.
  const flip = axis === "yaw" ? 1 : -1;
  const relative = (r[key] - t[key]) * flip * sign;
  const want = -over * BETA / dt;
  if (relative <= want) return;
  const impulse = (relative - want) / (1 / it + 1 / ir);
  r[key] -= impulse / ir * flip * sign;
  t[key] += impulse / it * flip * sign;
}

/** Joins the fifth wheel to the kingpin: point impulses along three axes, then the articulation limits. */
export function solveHitch(t: HitchState, tSpec: VehicleSpec, r: HitchState, rSpec: VehicleSpec, dt = TICK_DT / 4): void {
  for (let i = 0; i < ITERATIONS; i++) {
    hitchPoint(t, tSpec.fifthWheel!, a); hitchPoint(r, rSpec.kingpin!, b);
    for (const n of axes) {
      vehiclePointVelocity(t, tSpec, a[0]!, a[1]!, a[2]!, va); vehiclePointVelocity(r, rSpec, b[0]!, b[1]!, b[2]!, vb);
      const relative = (va[0]! - vb[0]!) * n[0] + (va[1]! - vb[1]!) * n[1] + (va[2]! - vb[2]!) * n[2];
      const error = (a[0]! - b[0]!) * n[0] + (a[1]! - b[1]!) * n[1] + (a[2]! - b[2]!) * n[2];
      const k = vehiclePointInverseMass(t, tSpec, a[0]!, a[1]!, a[2]!, n[0], n[1], n[2]) + vehiclePointInverseMass(r, rSpec, b[0]!, b[1]!, b[2]!, n[0], n[1], n[2]);
      const j = -(relative + error * BETA / dt) / k;
      applyVehicleImpulse(t, tSpec, a[0]!, a[1]!, a[2]!, j * n[0], j * n[1], j * n[2]);
      applyVehicleImpulse(r, rSpec, b[0]!, b[1]!, b[2]!, -j * n[0], -j * n[1], -j * n[2]);
    }
  }
  limit(t, tSpec, r, rSpec, wrapAngle(r.yaw - t.yaw), HITCH_YAW, "yaw", dt);
  limit(t, tSpec, r, rSpec, wrapAngle(r.pitch - t.pitch), HITCH_PITCH, "pitch", dt);
}

/** One tick of a coupled pair. The trailer coasts with its legs up; the tractor takes its driver's input. */
export function stepHitched(t: HitchState, tInput: VehicleInput, tSpec: VehicleSpec, r: HitchState, rSpec: VehicleSpec, w: VehicleWorld, rw: VehicleWorld = w): [VehicleStep, VehicleStep] {
  const tt = beginVehicleTick(t, tInput, tSpec, w), rt = beginVehicleTick(r, TRAILER_INPUT, rSpec, rw);
  for (let substep = 0; substep < 4; substep++) {
    vehicleSubstep(tt, substep);
    vehicleSubstep(rt, substep);
    solveHitch(t, tSpec, r, rSpec);
  }
  return [endVehicleTick(tt), endVehicleTick(rt)];
}
