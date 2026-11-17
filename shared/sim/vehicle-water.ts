// Four finite-volume samples act on the same chassis. Flooding represents lost trapped air, not lost vehicle HP.
import { quatRotate } from "../math/quat.ts";
import { clamp, len3 } from "../math/scalar.ts";
import { vehicleRotation } from "./vehicle-frame.ts";
import { applyVehicleImpulse, vehicleMassProperties, vehiclePointVelocity } from "./vehicle-rigid.ts";
import type { CarState, VehicleSpec, VehicleState, VehicleWorld } from "./vehicle.ts";

type WaterState = VehicleState & Partial<Pick<CarState, "engineCondition" | "engineOn" | "hullCondition" | "flooding">>;
export interface CarWater { immersion: number; intakeWet: boolean }
const q = new Float64Array(4), point = new Float64Array(3), up = new Float64Array(3), right = new Float64Array(3), ahead = new Float64Array(3), velocity = new Float64Array(3);
const forces = new Float64Array(16);
const water: CarWater = { immersion: 0, intakeWet: false };

/** Reused result. Samples an oriented box's vertical extent; it is a bounded float-volume approximation. */
export function applyCarWater(s: WaterState, p: VehicleSpec, w: VehicleWorld, dt: number): CarWater {
  water.immersion = 0; water.intakeWet = false;
  vehicleRotation(s, q); quatRotate(q, 0, 0, 1, 0, up, 0); quatRotate(q, 0, 1, 0, 0, right, 0); quatRotate(q, 0, 0, 0, 1, ahead, 0);
  const half = Math.max(.05, Math.abs(right[1]!) * p.halfWidth * .5 + Math.abs(up[1]!) * p.height * .4 + Math.abs(ahead[1]!) * p.halfLength * .5);
  const { mass } = vehicleMassProperties(p, s), gravity = p.gravity ?? 18;
  const hull = clamp(s.hullCondition ?? 1, 0, 1), flood = clamp(s.flooding ?? 0, 0, 1);
  const displacement = (p.mass ?? 1100) * 1.6 * (1 - flood) * (.65 + .35 * hull);
  let index = 0;
  for (const x of [-p.halfWidth * .5, p.halfWidth * .5]) for (const z of [-p.halfLength * .5, p.halfLength * .5]) {
    quatRotate(q, 0, x, p.height * .4, z, point, 0);
    const px = s.x + point[0]!, py = s.y + point[1]!, pz = s.z + point[2]!, level = w.waterAt(px, pz);
    const fraction = Number.isFinite(level) ? clamp((level - py + half) / (2 * half), 0, 1) : 0;
    water.immersion += fraction / 4;
    vehiclePointVelocity(s, p, px, py, pz, velocity);
    const buoyancy = displacement * gravity * fraction / 4;
    const damping = -velocity[1]! * mass * fraction;
    forces[index++] = px; forces[index++] = py; forces[index++] = pz; forces[index++] = Math.max(0, buoyancy + damping) * dt;
  }
  for (let i = 0; i < forces.length; i += 4) applyVehicleImpulse(s, p, forces[i]!, forces[i + 1]!, forces[i + 2]!, 0, forces[i + 3]!, 0);
  quatRotate(q, 0, 0, p.height * .65, p.wheelbase * .4, point, 0);
  const intake = w.waterAt(s.x + point[0]!, s.z + point[2]!);
  water.intakeWet = Number.isFinite(intake) && s.y + point[1]! < intake;
  if (water.intakeWet) { s.engineCondition = 0; s.engineOn = false; }
  // A healthy empty compact loses useful trapped-air support in about twenty seconds in calm water.
  const ingress = water.immersion * (.024 + (1 - hull) * .1 + (up[1]! < .2 ? .06 : 0));
  s.flooding = clamp(flood + (water.immersion > .001 ? ingress : -.02) * dt, 0, 1);
  return water;
}

/** Passive drag: implicit attenuation cannot reverse velocity or inject energy on a fast water entry. */
export function dragCarInWater(s: VehicleState, immersion: number, dt: number): void {
  if (immersion <= 0) return;
  const horizontal = len3(s.vx, 0, s.vz), keep = 1 / (1 + immersion * (1 + .2 * horizontal) * dt);
  s.vx *= keep; s.vz *= keep;
  s.vy /= 1 + immersion * (3 + 3 * Math.abs(s.vy)) * dt;
  const angular = 1 / (1 + immersion * 2.5 * dt);
  s.pitchRate *= angular; s.yawRate *= angular; s.rollRate *= angular;
}
