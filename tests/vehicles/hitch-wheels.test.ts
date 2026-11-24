import { expect, test } from "bun:test";
import { AIR_TRAILER_VEHICLE } from "../../content/vehicles/air-freight.ts";
import { SEMI } from "../../content/vehicles/heavy-road.ts";
import { Body } from "../../shared/sim/character.ts";
import { beginVehicleTick, vehicleSubstep } from "../../shared/sim/vehicle-chassis.ts";
import { vehicleRotation } from "../../shared/sim/vehicle-frame.ts";
import { loadState, state, staticWorld, trailerState } from "../../shared/sim/vehicle-state.ts";
import type { WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";

const TRACTOR = SEMI.species.vehicle as WheelVehicleDefinition, TRAILER = AIR_TRAILER_VEHICLE;

function body(def: WheelVehicleDefinition, y: number, z: number, roll: number): Body {
  const b = new Body(), q = new Float64Array(4);
  Object.assign(b, { vehicle: true, mode: 1, x: 100, y, z, fuel: def.spec.fuelCapacity, vehicleRoll: roll });
  vehicleRotation({ x: 100, y, z, yaw: 0, pitch: 0, roll }, q);
  [b.vehicleQx, b.vehicleQy, b.vehicleQz, b.vehicleQw] = [q[0]!, q[1]!, q[2]!, q[3]!];
  return b;
}

test("a tractor stepped with its trailer counts its own tyres on the ground, not the trailer's", () => {
  const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 2, -64, 1 / 256);
  hf.heights.fill(64 * 256);
  const world = staticWorld({ hf, structs: new StructureStore(dims, new Float32Array([0]), new Float32Array([0]), new Float32Array([0])) });
  // The tractor lies on its side, wheels in the air; the trailer stands on its own.
  loadState(state, body(TRACTOR, TRACTOR.spec.halfWidth, 30, Math.PI / 2));
  loadState(trailerState, body(TRAILER, 0, 30 + TRACTOR.spec.fifthWheel![2] - TRAILER.spec.kingpin![2], 0));
  const idle = { throttle: 0, steer: 0, brake: 0, handbrake: false, pilot: false };
  const own = beginVehicleTick(state, idle, TRACTOR.spec, world), towed = beginVehicleTick(trailerState, idle, TRAILER.towed ?? TRAILER.spec, world);
  for (let substep = 0; substep < 4; substep++) {
    vehicleSubstep(own, substep);
    vehicleSubstep(towed, substep);
  }
  expect(own.wheels).not.toBe(towed.wheels);
  expect([own.wheels.length, towed.wheels.length > 0]).toEqual([0, true]);
});
