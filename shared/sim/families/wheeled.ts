// Wheeled vehicles: cars, vans, off-road, the semi and its trailer (shared/sim/vehicle-chassis.ts), and for now the
// skateboard, a wheeled frame of its own step (shared/sim/skateboard.ts).

import { len3 } from "../../math/scalar.ts";
import { BTN_BURST, BTN_JUMP, BTN_SPRINT, stepOut } from "../character.ts";
import type { VehicleFamily } from "../families.ts";
import { stepSkateboard } from "../skateboard.ts";
import { isSkateboard, stepVehicle, validateVehicleSpec, type VehicleDefinition, type WheelVehicleDefinition } from "../vehicle.ts";
import { loadState, state, staticWorld, storeState, vehicleStep } from "../vehicle-state.ts";
import { carMeetsCapsule, carMeetsKind, carMeetsVehicle } from "../../world/vehicle.ts";
import { carShapes } from "../../world/vehicle-shapes.ts";
import { SKIN, groundUnder } from "../../world/collide.ts";
import { skatePlacement } from "../../world/skate-placement.ts";

const vec = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

export const WHEELED: VehicleFamily<WheelVehicleDefinition> = {
  name: "wheeled",
  is: (d: VehicleDefinition): d is WheelVehicleDefinition => d.movement === undefined || d.movement === "wheeled",
  validateSpec(d) {
    if (d.frame !== undefined && !["car", "sports_car", "van", "off_road", "skateboard"].includes(d.frame)) throw new Error("invalid road vehicle frame");
    validateVehicleSpec(d.spec, isSkateboard(d));
    if (d.towed) validateVehicleSpec(d.towed);
    if (d.passengerAisle !== undefined && (!Number.isFinite(d.passengerAisle) || Math.abs(d.passengerAisle) >= d.spec.halfWidth)) throw new Error("passenger aisle outside cabin");
    if (d.emergencyLights !== undefined && (!Array.isArray(d.emergencyLights) || d.emergencyLights.length < 1 || d.emergencyLights.length > 16 || !d.emergencyLights.every(lamp =>
      lamp && vec(lamp.at) && (lamp.width === undefined || Number.isFinite(lamp.width) && lamp.width > 0 && lamp.width <= 2) && (lamp.color === "red" || lamp.color === "blue") && (lamp.facing === undefined || lamp.facing === "front" || lamp.facing === "rear")))) throw new Error("invalid emergency lamp layout");
    if (d.nozzles !== undefined && (!d.spec.thrusters || !Array.isArray(d.nozzles) || d.nozzles.length < 1 || d.nozzles.length > 16 || !d.nozzles.every(n =>
      n && typeof n.name === "string" && n.name.length > 0 && vec(n.at) && vec(n.dir) && Math.abs(len3(n.dir[0]!, n.dir[1]!, n.dir[2]!) - 1) < .01))) throw new Error("invalid thruster nozzles");
  },
  validateRig() {},
  step(w, b, moveX, moveZ, buttons, def, pilot, environment) {
    if (isSkateboard(def)) {
      vehicleStep.surface = "ground";
      stepSkateboard(w, b, moveX, moveZ, buttons, def.spec, pilot, vehicleStep);
      return;
    }
    const world = staticWorld(w);
    loadState(state, b);
    Object.assign(vehicleStep, stepVehicle(state, { throttle: moveZ / 127, steer: -moveX / 127, brake: 0, handbrake: (buttons & BTN_JUMP) !== 0, pilot,
      boost: (buttons & BTN_SPRINT) !== 0, burst: (buttons & BTN_BURST) !== 0 }, def.spec, environment ?? world));
    stepOut.landSpeed = vehicleStep.landSpeed;
    storeState(b, state);
  },
  parts: (def) => carShapes(def.spec),
  mounts: () => null,
  joints: () => undefined,
  jointPivot: () => undefined,
  hazard: null,
  clearSlack: SKIN,
  // A car stands on the ground under its width; a board on any clear dry surface underfoot.
  supports: (world, x, y, z, _yaw, def) => isSkateboard(def) ? skatePlacement(world, x, y, z) : Math.abs(y - groundUnder(world.hf, x, z, def.spec.halfWidth)) <= .2,
  meetsCapsule: (def, frame, x, y, z, radius, height) => carMeetsCapsule(def.spec, frame, x, y, z, radius, height),
  meetsVehicle: (def, frame, other, otherFrame) => carMeetsVehicle(def.spec, frame, other, otherFrame),
  meetsKind: (def, parts, kind, sx, sy, sz, syaw, frame, slack) => carMeetsKind(parts, kind, sx, sy, sz, syaw, def.spec, frame, slack),
};
