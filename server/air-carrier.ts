// The freight carrier's autopilot: from where it should be to the cyclic, collective and pedals of the rotor model.
import type { Body } from "../shared/sim/character.ts";
import type { HelicopterInput } from "../shared/sim/helicopter.ts";
import type { HelicopterSpec } from "../shared/sim/vehicle.ts";

/** Where the carrier should be, how it should face, and how the place itself is moving. */
export interface CarrierGoal { x: number; y: number; z: number; yaw: number; vx: number; vz: number; speed: number; precise: boolean }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Commands that bring the aircraft to the goal and hold it there: brake in time, bank into turns, settle level. */
export function autopilot(b: Body, p: HelicopterSpec, goal: CarrierGoal, out: HelicopterInput): HelicopterInput {
  const dx = goal.x - b.x, dz = goal.z - b.z, far = Math.hypot(dx, dz);
  // The steepest braking the cyclic can give, with room to spare.
  const brake = p.gravity * Math.tan(p.pitchAngle) * .45;
  const top = Math.min(goal.speed, p.maxForward * p.cruiseMultiplier);
  const approach = Math.min(top, Math.sqrt(2 * brake * Math.max(0, far - .3)), far * (goal.precise ? .9 : .6) + 0.0);
  const ux = far > 1e-3 ? dx / far : 0, uz = far > 1e-3 ? dz / far : 0;
  const wantX = goal.vx + ux * approach, wantZ = goal.vz + uz * approach;
  // Velocity error to acceleration, then to the attitude that gives it, in the aircraft's own frame.
  const gain = goal.precise ? 1.1 : .7;
  const ax = (wantX - b.vx) * gain, az = (wantZ - b.vz) * gain;
  const yaw = b.vehicleYaw, sn = Math.sin(yaw), cs = Math.cos(yaw);
  const along = ax * sn + az * cs, side = ax * cs - az * sn;
  const forwardGain = p.gravity * Math.tan(p.pitchAngle), sideGain = p.gravity * Math.tan(p.bankAngle);
  const fast = Math.hypot(wantX, wantZ) > p.maxForward * 1.02;
  const pitchFull = fast ? p.gravity * Math.tan(Math.atan2(Math.sin(p.pitchAngle) * p.cruiseMultiplier ** 2, Math.cos(p.pitchAngle))) : forwardGain;
  out.forward = clamp(along / pitchFull, -1, 1);
  out.right = clamp(-side / sideGain, -1, 1);
  out.cruise = fast;
  // Height: a vertical speed toward the goal, gentle in the last metres.
  const rise = goal.y - b.y;
  const vy = clamp(rise * (goal.precise ? .9 : .6), -p.descendSpeed, p.climbSpeed);
  out.climb = clamp(vy >= 0 ? vy / p.climbSpeed : vy / p.descendSpeed, -1, 1);
  // Nose: along the way while travelling far and fast, to the goal's heading when near.
  const heading = far > 40 && approach > 12 ? Math.atan2(wantX, wantZ) : goal.yaw;
  out.yaw = clamp(angle(heading - yaw) * 1.4 - b.vehicleYawRate * .6, -1, 1);
  out.brake = false; out.direct = false; out.pilot = true;
  return out;
}
