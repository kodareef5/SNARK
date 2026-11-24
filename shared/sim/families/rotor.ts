// Rotor craft: helicopters, the air carrier and the survey drone (shared/sim/helicopter.ts). The carrier flies itself: its
// autopilot gives an analog order (`fly`) where a pilot gives keys (`step`).

import type { CollisionWorld } from "../../world/collide.ts";
import { helicopterWorld } from "../../world/helicopter.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_MOD, BTN_PRIMARY, BTN_PRONE, BTN_SECONDARY, BTN_SPRINT, stepOut, type Body } from "../character.ts";
import type { VehicleFamily } from "../families.ts";
import { stepHelicopter, type HelicopterInput } from "../helicopter.ts";
import { validateHelicopterSpec, type RotorVehicleDefinition, type VehicleDefinition } from "../vehicle.ts";
import { loadState, state, storeState, vehicleStep } from "../vehicle-state.ts";

const vec = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const bone = (n: unknown): boolean => typeof n === "string" && n.length > 0 && n.length <= 64;

/** One tick of a rotor body under an order. */
function fly(w: CollisionWorld, b: Body, input: HelicopterInput, def: RotorVehicleDefinition): void {
  loadState(state, b);
  state.rotorRpm = b.vehicleRotorRpm; state.rotorPhase = b.vehicleRotorPhase; state.collective = b.vehicleCollective;
  state.rotorCondition = b.vehicleRotorCondition;
  Object.assign(vehicleStep, stepHelicopter(state, input, def, helicopterWorld(w)));
  b.vehicleRotorRpm = state.rotorRpm; b.vehicleRotorPhase = state.rotorPhase; b.vehicleCollective = state.collective;
  b.vehicleRotorCondition = state.rotorCondition;
  storeState(b, state);
}

export const ROTOR: VehicleFamily<RotorVehicleDefinition> & { fly: typeof fly } = {
  name: "rotor",
  is: (d: VehicleDefinition): d is RotorVehicleDefinition => d.movement === "rotor",
  validateSpec(d) {
    validateHelicopterSpec(d.spec);
  },
  validateRig(d) {
    if (d.wheels.length || d.steeringWheel || !Array.isArray(d.rotors) || d.rotors.length < 1 || d.rotors.length > 4) throw new Error("invalid helicopter rig");
    for (const rotor of d.rotors) {
      const n = rotor.axis;
      if (!bone(rotor.bone) || !vec(rotor.at) || !vec(n) || Math.abs(n[0] * n[0] + n[1] * n[1] + n[2] * n[2] - 1) > 1e-6 ||
        !Number.isFinite(rotor.radius) || rotor.radius <= 0 || rotor.radius > 16 || !Number.isFinite(rotor.ratio) || rotor.ratio === 0 || Math.abs(rotor.ratio) > 16) throw new Error("invalid helicopter rotor");
      if (rotor.blur && (!Number.isInteger(rotor.blur.blades) || rotor.blur.blades < 2 || rotor.blur.blades > 8 || !Number.isFinite(rotor.blur.chord) || rotor.blur.chord <= 0 || rotor.blur.chord > rotor.radius)) throw new Error("invalid helicopter rotor blur");
    }
  },
  step(w, b, moveX, moveZ, buttons, def, pilot) {
    fly(w, b, {
      right: moveX / 127, forward: moveZ / 127, yaw: ((buttons & BTN_PRIMARY) !== 0 ? 1 : 0) - ((buttons & BTN_SECONDARY) !== 0 ? 1 : 0),
      climb: ((buttons & BTN_JUMP) !== 0 ? 1 : 0) - ((buttons & BTN_CROUCH) !== 0 ? 1 : 0),
      brake: (buttons & BTN_PRONE) !== 0, cruise: (buttons & BTN_SPRINT) !== 0, direct: (buttons & BTN_MOD) !== 0, pilot,
    }, def);
    stepOut.landSpeed = vehicleStep.landSpeed;
  },
  fly,
};
