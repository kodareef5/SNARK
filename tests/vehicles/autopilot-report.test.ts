import { expect, test } from "bun:test";
import { AIR_CARRIER_VEHICLE } from "../../content/vehicles/air-freight.ts";
import { Body, stepOut } from "../../shared/sim/character.ts";
import { stepRotorBody, vehicleStep } from "../../shared/sim/vehicle-body.ts";
import { flatWorld } from "../fixtures/world.ts";

test("an autopilot's step reports only what its own craft met, not the vehicle stepped before it", () => {
  const w = flatWorld(), b = new Body();
  Object.assign(b, { vehicle: true, mode: 1, x: 40, z: 40, fuel: AIR_CARRIER_VEHICLE.spec.fuelCapacity });
  // What a boat's propeller strike and a fallen skater left in the shared report.
  Object.assign(vehicleStep, { propHit: true, capsized: true, skateHurt: 1, immersion: .5, propellerImmersion: .5, planing: .5 });
  stepOut.landSpeed = 9;
  stepRotorBody(w, b, { right: 0, forward: 0, yaw: 0, climb: 1, brake: false, cruise: false, direct: false, pilot: true }, AIR_CARRIER_VEHICLE);
  expect([vehicleStep.propHit, vehicleStep.capsized, vehicleStep.skateHurt, vehicleStep.immersion, vehicleStep.propellerImmersion, vehicleStep.planing]).toEqual([false, false, 0, 0, 0, 0]);
  expect(stepOut.landSpeed).toBe(vehicleStep.landSpeed);
});
