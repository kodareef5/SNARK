import { clamp } from "../math/scalar.ts";
import type { HelicopterState } from "./helicopter.ts";
import type { HelicopterSpec } from "./vehicle.ts";

/** Per second at full cabin immersion. These are aircraft handling values, independent of creature ragdolls. */
export const HELICOPTER_WATER_DRAG = 4.5;
export const HELICOPTER_WATER_SPIN_DRAG = 3;
/** The cabin displaces at most 86% of its empty mass: neither a live aircraft nor its wreck floats indefinitely. */
export const HELICOPTER_WATER_SUPPORT = .86;

/** Passive water response shared by a stalled aircraft and its salvage. Never adds rotor thrust or control torque. */
export function stepHelicopterWater(s: HelicopterState, p: HelicopterSpec, immersion: number, dt: number): void {
  const fraction = clamp(immersion, 0, 1);
  const mass = p.mass + clamp(s.payloadMass, 0, 100000);
  const gravity = p.gravity * (1 - HELICOPTER_WATER_SUPPORT * fraction * p.mass / mass);
  // Implicit drag cannot reverse velocity or inject energy, even on the longest permitted substep.
  const keep = 1 / (1 + HELICOPTER_WATER_DRAG * fraction * dt);
  s.vx *= keep; s.vz *= keep; s.vy = (s.vy - gravity * dt) * keep;
  const spin = 1 / (1 + HELICOPTER_WATER_SPIN_DRAG * fraction * dt);
  s.pitchRate *= spin; s.yawRate *= spin; s.rollRate *= spin;
}
