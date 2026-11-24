// Boats: a hull that floats, driven by one or two propellers (shared/sim/boat.ts).

import { boatMeetsCapsule, boatMeetsKind, boatMeetsVehicle, boatWorld } from "../../world/boat.ts";
import { boatJoints, boatMounts, boatShapes } from "../../world/vehicle-shapes.ts";
import { BTN_JUMP, BTN_SPRINT, stepOut } from "../character.ts";
import { stepBoat } from "../boat.ts";
import type { VehicleFamily } from "../families.ts";
import { boatDrives, validateBoatSpec, type BoatVehicleDefinition, type VehicleDefinition } from "../vehicle.ts";
import { loadState, state, storeState, vehicleStep } from "../vehicle-state.ts";

const vec = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const bone = (n: unknown): boolean => typeof n === "string" && n.length > 0 && n.length <= 64;

export const BOAT: VehicleFamily<BoatVehicleDefinition> = {
  name: "boat",
  is: (d: VehicleDefinition): d is BoatVehicleDefinition => d.movement === "boat",
  validateSpec(d) {
    validateBoatSpec(d.spec);
    if (d.family !== undefined && !["offshore", "jon", "pwc", "yacht", "catamaran"].includes(d.family)) throw new Error("invalid boat family");
  },
  validateRig(d) {
    if (d.wheels.length) throw new Error("invalid boat rig");
    if (d.boarding && ![d.boarding.water, d.boarding.ladder, d.boarding.deck].every(vec)) throw new Error("invalid boat boarding route");
    if (d.secondDrive && !d.spec.secondDrive) throw new Error("second boat drive rig has no physical drive");
    for (const p of [d.propeller, d.outboard, d.secondDrive?.propeller, d.secondDrive?.outboard]) if (p && (!bone(p.bone) || !vec(p.axis) || Math.abs(p.axis[0] * p.axis[0] + p.axis[1] * p.axis[1] + p.axis[2] * p.axis[2] - 1) > 1e-6 ||
      !Number.isFinite(p.ratio) || p.ratio === 0 || Math.abs(p.ratio) > 16)) throw new Error("invalid boat propulsion rig");
  },
  step(w, b, moveX, moveZ, buttons, def, pilot) {
    loadState(state, b);
    Object.assign(vehicleStep, stepBoat(state, {
      throttle: moveZ / 127 * ((buttons & BTN_SPRINT) !== 0 ? .25 : 1), steer: -moveX / 127,
      neutral: (buttons & BTN_JUMP) !== 0, pilot,
    }, def, boatWorld(w)));
    stepOut.landSpeed = vehicleStep.landSpeed;
    storeState(b, state);
  },
  parts: (def) => boatShapes(def),
  mounts: (def, frame) => boatMounts(frame, def.spec),
  joints: (def, from, to) => boatJoints(from, to, def.spec),
  jointPivot: (def, joint) => boatDrives(def.spec)[joint]?.outboard?.pivot,
  hazard: "propeller",
  meetsCapsule: (def, frame, x, y, z, radius, height) => boatMeetsCapsule(def, frame, x, y, z, radius, height),
  meetsVehicle: (def, frame, other, otherFrame) => boatMeetsVehicle(def, frame, other, otherFrame),
  meetsKind: (def, parts, kind, sx, sy, sz, syaw, frame, slack) => boatMeetsKind(parts, kind, sx, sy, sz, syaw, def, frame, slack),
};
