// Jets: a fixed wing with a lift fan and a swivel nozzle (shared/sim/jet.ts). Its flight controls chase the pilot's look,
// so its step takes the look the input holds as well as the keys. Loading this file gives the jet's row of the families
// its code (families.ts JET_FAMILY): the server loads it as it starts, a browser when it first meets a jet.

import { TAU } from "../../math/scalar.ts";
import { jetMeetsCapsule, jetMeetsKind, jetMeetsVehicle, jetPlacement, jetWorld } from "../../world/jet.ts";
import { jetShapes } from "../../world/vehicle-shapes.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_MOD, BTN_PRONE, BTN_SPRINT, stepOut } from "../character.ts";
import { JET_FAMILY, type VehicleFamily } from "../families.ts";
import { stepJet, validateJetSpec } from "../jet.ts";
import type { JetVehicleDefinition, VehicleDefinition } from "../vehicle.ts";
import { loadState, state, storeState, vehicleStep } from "../vehicle-state.ts";

/** Radians of a look's yaw or pitch in the input's 1/65536 turns. Pitch is signed: 16384 is straight up. */
const LOOK = TAU / 65536;
const signedLook = (n: number): number => (n > 32767 ? n - 65536 : n) * LOOK;

export const JET: VehicleFamily<JetVehicleDefinition> = {
  name: "jet",
  is: (d: VehicleDefinition): d is JetVehicleDefinition => d.movement === "jet",
  validateSpec(d) {
    validateJetSpec(d.spec);
  },
  // Its wheels are moved by its own parts (client/core/render/jet-parts.ts), so none is listed, and it has no steering wheel.
  validateRig(d) {
    if (d.wheels.length || d.steeringWheel) throw new Error("invalid jet rig");
  },
  step(w, b, moveX, moveZ, buttons, def, pilot, _environment, yaw = b.yaw, pitch = 0) {
    loadState(state, b);
    // The family alone writes these three: a jet's throttle, spool and nozzle in an aircraft's rotor fields.
    state.throttle = b.vehicleCollective; state.spool = b.vehicleRotorRpm; state.nozzle = b.vehicleRotorPhase;
    Object.assign(vehicleStep, stepJet(state, {
      throttle: moveZ / 127, roll: moveX / 127, aimYaw: (yaw & 65535) * LOOK, aimPitch: signedLook(pitch & 65535),
      climb: ((buttons & BTN_JUMP) !== 0 ? 1 : 0) - ((buttons & BTN_CROUCH) !== 0 ? 1 : 0),
      afterburner: (buttons & BTN_SPRINT) !== 0, airbrake: (buttons & BTN_PRONE) !== 0, vtol: (buttons & BTN_MOD) !== 0, pilot,
    }, def, jetWorld(w)));
    vehicleStep.rotorHit = false;
    b.vehicleCollective = state.throttle; b.vehicleRotorRpm = state.spool; b.vehicleRotorPhase = state.nozzle;
    stepOut.landSpeed = vehicleStep.landSpeed;
    storeState(b, state);
  },
  parts: (def) => jetShapes(def),
  mounts: () => null,
  joints: () => undefined,
  jointPivot: () => undefined,
  hazard: null,
  clearSlack: 0,
  supports: (world, x, y, z, yaw, def) => jetPlacement(world, x, y, z, yaw, def),
  movers: (def) => def.spec.bodyBoxes.flatMap(b => [b.at[0]!, b.at[1]!, b.at[2]!, b.half[0]!, b.half[1]!, b.half[2]!]),
  meetsCapsule: (def, frame, x, y, z, radius, height) => jetMeetsCapsule(def, frame, x, y, z, radius, height),
  meetsVehicle: (def, frame, other, otherFrame) => jetMeetsVehicle(def, frame, other, otherFrame),
  meetsKind: (def, parts, kind, sx, sy, sz, syaw, stw, frame, slack) => jetMeetsKind(parts, kind, sx, sy, sz, syaw, stw, def, frame, slack),
};

JET_FAMILY.give(JET as unknown as VehicleFamily);
