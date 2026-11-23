import { expect, test } from "bun:test";
import { AIR_TRAILER_VEHICLE } from "../../content/vehicles/air-freight.ts";
import { SEMI } from "../../content/vehicles/heavy-road.ts";
import { Body } from "../../shared/sim/character.ts";
import { stepHitchedBodies, stepVehicleBody } from "../../shared/sim/vehicle-body.ts";
import { vehicleRotation } from "../../shared/sim/vehicle-frame.ts";
import { hitchGap } from "../../shared/sim/vehicle-hitch.ts";
import { isWheelVehicle, type WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";

const TRACTOR = SEMI.species.vehicle as WheelVehicleDefinition;
const TRAILER = AIR_TRAILER_VEHICLE;

/** Flat for 60 m, then a straight grade (rise per metre) for 140 m, then flat again. */
export function grade(rise: number) {
  const dims = { chunksX: 6, chunksZ: 6 }, hf = new Heightfield(dims, 1, -64, 1 / 256);
  for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) hf.setSample(x, z, Math.max(0, Math.min(140, z - 60)) * rise);
  const structs = new StructureStore(dims, new Float32Array([0]), new Float32Array([0]), new Float32Array([0]));
  return { hf, structs };
}

function body(def: WheelVehicleDefinition, x: number, z: number): Body {
  const b = new Body(), q = new Float64Array(4); b.vehicle = true; b.x = x; b.z = z; b.kind = 0; b.fuel = def.spec.fuelCapacity;
  b.mode = 1;
  vehicleRotation({ x, y: 0, z, yaw: 0, pitch: 0, roll: 0 }, q);
  [b.vehicleQx, b.vehicleQy, b.vehicleQz, b.vehicleQw] = [q[0]!, q[1]!, q[2]!, q[3]!];
  return b;
}

/** A semi with the trailer on its fifth wheel, facing +Z. */
export function rig(x = 100, z = 30) {
  const tractor = body(TRACTOR, x, z), trailer = body(TRAILER, x, z + TRACTOR.spec.fifthWheel![2] - TRAILER.spec.kingpin![2]);
  return { tractor, trailer };
}

const state = (b: Body) => ({ x: b.x, y: b.y, z: b.z, yaw: b.vehicleYaw, pitch: b.vehiclePitch, roll: b.vehicleRoll, qx: b.vehicleQx, qy: b.vehicleQy, qz: b.vehicleQz, qw: b.vehicleQw });
export const gap = (t: Body, r: Body) => hitchGap(state(t) as never, TRACTOR.spec, state(r) as never, TRAILER.towed!);

test("the pair settles with the kingpin on the fifth wheel", () => {
  const world = grade(0), { tractor, trailer } = rig();
  for (let i = 0; i < 90; i++) stepHitchedBodies(world, tractor, 0, 0, 0, TRACTOR, trailer, TRAILER);
  expect(gap(tractor, trailer)).toBeLessThan(.05);
  expect(Math.abs(trailer.vehiclePitch)).toBeLessThan(.03);
});

for (const rise of [0, .06, .1, .14, .2, -.1, -.2]) test("the pair drives a grade of " + rise, () => {
  const world = grade(rise), { tractor, trailer } = rig();
  const solo = rig().tractor;
  let worst = 0, ticks = 0;
  for (; ticks < 900 && tractor.z < 190; ticks++) {
    stepHitchedBodies(world, tractor, 0, 127, 0, TRACTOR, trailer, TRAILER);
    if (ticks > 30) worst = Math.max(worst, gap(tractor, trailer));
  }
  for (let i = 0; i < ticks; i++) stepVehicleBody(world, solo, 0, 127, 0, TRACTOR);
  expect(worst).toBeLessThan(.06);
  // On the grade the trailer leans with it, as the solo tractor does.
  if (tractor.z > 120 && tractor.z < 200) expect(Math.abs(trailer.vehiclePitch - solo.vehiclePitch)).toBeLessThan(.03);
  // The pair is heavier, so it is slower, but it is not stopped where the tractor alone is not.
  if (solo.z > 190) expect(tractor.z).toBeGreaterThan(150);
});

const relativeYaw = (t: Body, r: Body) => { const d = r.vehicleYaw - t.vehicleYaw; return Math.atan2(Math.sin(d), Math.cos(d)); };

test("a full-lock turn swings the trailer behind and keeps it coupled", () => {
  const world = grade(0), { tractor, trailer } = rig(150, 60);
  let worst = 0, most = 0;
  for (let i = 0; i < 600; i++) {
    stepHitchedBodies(world, tractor, i < 90 ? 0 : 127, 90, 0, TRACTOR, trailer, TRAILER);
    worst = Math.max(worst, gap(tractor, trailer)); most = Math.max(most, Math.abs(relativeYaw(tractor, trailer)));
  }
  expect(worst).toBeLessThan(.08);
  expect(most).toBeGreaterThan(.3);
});

test("reversing on lock folds the trailer only to its limit", () => {
  const world = grade(0), { tractor, trailer } = rig(150, 150);
  let worst = 0, most = 0;
  for (let i = 0; i < 900; i++) {
    stepHitchedBodies(world, tractor, 127, -127, 0, TRACTOR, trailer, TRAILER);
    worst = Math.max(worst, gap(tractor, trailer)); most = Math.max(most, Math.abs(relativeYaw(tractor, trailer)));
  }
  expect(worst).toBeLessThan(.1);
  expect(most).toBeLessThan(1.6);
  expect(most).toBeGreaterThan(1);
});
