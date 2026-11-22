import { expect, test } from "bun:test";
import { COMPACT, COMPACT_VEHICLE } from "../../content/vehicles/compact.ts";
import { BOAT_VEHICLE } from "../../content/vehicles/boat.ts";
import { HELICOPTER_VEHICLE } from "../../content/vehicles/helicopter.ts";
import { dynamicState, DynamicScratch, resolveDynamicContact, type DynamicBody, type DynamicContact, type DynamicResult } from "../../shared/sim/vehicle-dynamic.ts";
import { vehicleMassProperties } from "../../shared/sim/vehicle-rigid.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { carMeetsVehicle } from "../../shared/world/vehicle.ts";
import { boatMeetsVehicle } from "../../shared/world/boat.ts";
import { helicopterMeetsVehicle } from "../../shared/world/helicopter.ts";

const reg = coreRegistry(), car = reg.vehicle[reg.index.get("core:compact")!]!;
const vacuum = { free: () => true, overlap: () => null };
function body(mass: number): DynamicBody { return { prior: dynamicState(), state: dynamicState(), spec: null, mass, response: "dynamic" }; }
function result(): DynamicResult { return { signedClosingSpeed: 0, pointSpeedA: 0, pointSpeedB: 0, impulse: 0, deltaSpeedA: 0, deltaSpeedB: 0, unresolved: false }; }
function contact(): DynamicContact { return { t: 1, x: 0, y: 0, z: 0, nx: 1, ny: 0, nz: 0, depth: 0 }; }

test("both query directions retain the car's bevel clearance beneath rotor and outboard parts", () => {
  const car = { x: 20, y: 0, z: 30, yaw: 0, pitch: 0, roll: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  const boat = { x: 20, y: .01, z: 35.85, yaw: 0, pitch: 0, roll: Math.PI, qx: 0, qy: 0, qz: 1, qw: 0 };
  const heli = { x: 20, y: 3.35, z: 36.2, yaw: Math.PI, pitch: 0, roll: Math.PI, qx: 1, qy: 0, qz: 0, qw: 0 };
  expect(carMeetsVehicle(COMPACT, car, BOAT_VEHICLE, boat)).toBeNull();
  expect(boatMeetsVehicle(BOAT_VEHICLE, boat, COMPACT_VEHICLE, car)).toBeNull();
  expect(carMeetsVehicle(COMPACT, car, HELICOPTER_VEHICLE, heli)).toBeNull();
  expect(helicopterMeetsVehicle(HELICOPTER_VEHICLE, heli, COMPACT_VEHICLE, car)).toBeNull();
  // Raising the real parts into the bevel must hit in both directions too.
  boat.y += .2; heli.y += .2;
  expect(carMeetsVehicle(COMPACT, car, BOAT_VEHICLE, boat)).not.toBeNull();
  expect(boatMeetsVehicle(BOAT_VEHICLE, boat, COMPACT_VEHICLE, car)).not.toBeNull();
  expect(carMeetsVehicle(COMPACT, car, HELICOPTER_VEHICLE, heli)).not.toBeNull();
  expect(helicopterMeetsVehicle(HELICOPTER_VEHICLE, heli, COMPACT_VEHICLE, car)).not.toBeNull();
});

test("finite moving bodies preserve momentum and tangent speed without gaining energy", () => {
  const a = body(1100), b = body(150), hit = contact(), out = result();
  a.state.vx = 20; a.state.vz = 3; b.state.vx = -4; b.state.vz = -2;
  const momentum = a.mass * a.state.vx + b.mass * b.state.vx;
  const energy = .5 * a.mass * (20 * 20 + 9) + .5 * b.mass * (16 + 4);
  resolveDynamicContact(a, b, hit, vacuum, new DynamicScratch(), out);
  expect(out.signedClosingSpeed).toBe(24);
  expect(a.mass * a.state.vx + b.mass * b.state.vx).toBeCloseTo(momentum, 8);
  expect([a.state.vz, b.state.vz]).toEqual([3, -2]);
  expect(.5 * a.mass * (a.state.vx * a.state.vx + 9) + .5 * b.mass * (b.state.vx * b.state.vx + 4)).toBeLessThan(energy);
  expect(a.mass * out.deltaSpeedA).toBeCloseTo(b.mass * out.deltaSpeedB, 8);
});

test("signed point rotation separates an outgoing corner and strikes the mirrored incoming corner", () => {
  for (const x of [1, -1]) {
    const a = body(vehicleMassProperties(car.spec, { payloadMass: 0 }).mass), b = body(80), hit = contact(), out = result();
    Object.assign(a, { spec: car.spec }); b.response = "fixed";
    a.state.vz = 4; a.state.yawRate = 8;
    hit.x = x; hit.y = vehicleMassProperties(car.spec, a.state).comY; hit.z = 2;
    hit.nx = 0; hit.nz = 1;
    resolveDynamicContact(a, b, hit, vacuum, new DynamicScratch(), out);
    expect(out.signedClosingSpeed).toBeCloseTo(4 - 8 * x, 10);
    if (x > 0) { expect(out.impulse).toBe(0); expect(a.state.vz).toBe(4); expect(a.state.yawRate).toBe(8); }
    else { expect(out.impulse).toBeGreaterThan(0); expect(a.state.vz).toBeLessThan(4); }
  }
});

test("a swept fixed contact removes normal travel while retaining the whole tangent remainder", () => {
  const a = body(1100), b = body(80), hit = contact(), out = result();
  b.response = "fixed"; a.state.x = .5; a.state.z = 1; a.state.vx = 2; a.state.vz = 10;
  hit.t = .5; hit.x = .25; hit.z = .5;
  resolveDynamicContact(a, b, hit, vacuum, new DynamicScratch(), out);
  expect(a.state.x).toBeLessThanOrEqual(.25); expect(a.state.z).toBe(1); expect(a.state.vz).toBe(10);
  expect(b.state.vx).toBe(0); expect(b.state.x).toBe(0);
});

test("a protected controller is blocked by its own inward walk without becoming a motor for the vehicle", () => {
  const a = body(1100), b = body(80), hit = contact(), out = result();
  a.state.z = .5; a.state.vz = 15; b.response = "protected";
  b.prior.x = 1.5; b.state.x = 1.2; b.state.vx = -7; hit.t = .5; hit.x = 1.35;
  resolveDynamicContact(a, b, hit, vacuum, new DynamicScratch(), out);
  expect(out.impulse).toBe(0); expect(a.state.vx).toBe(0); expect(a.state.z).toBe(.5); expect(a.state.vz).toBe(15);
  expect(b.state.x).toBeGreaterThan(1.2); expect(b.state.vx).toBe(0);
});

test("a body blocked by the world removes unusable closing speed, in either pair order, without erasing tangent motion", () => {
  for (const reverse of [false, true]) {
    const car = body(1100), actor = body(40), hit = contact(), out = result(), scratch = new DynamicScratch();
    car.state.x = .2; car.state.vx = 12; car.state.vz = 3;
    actor.state.vx = 6; actor.state.vz = -2;
    hit.t = .5; hit.x = .1;
    if (reverse) hit.nx = -1;
    const world = { free: (body: DynamicBody, from: Readonly<DynamicBody["state"]>) => body !== actor || body.state.x <= from.x, overlap: () => null };
    const before = .5 * (car.mass * (12 ** 2 + 3 ** 2) + actor.mass * (6 ** 2 + 2 ** 2));
    resolveDynamicContact(reverse ? actor : car, reverse ? car : actor, hit, world, scratch, out);
    expect(car.state.x).toBeLessThan(.1); expect(actor.state.x).toBe(0);
    expect(car.state.vx).toBeCloseTo(-1.44, 10); expect(actor.state.vx).toBe(0);
    expect([car.state.vz, actor.state.vz]).toEqual([3, -2]);
    const after = .5 * (car.mass * (car.state.vx ** 2 + car.state.vz ** 2) + actor.mass * (actor.state.vx ** 2 + actor.state.vz ** 2));
    expect(after).toBeLessThan(before); expect(out.unresolved).toBe(false);
    expect(reverse ? out.deltaSpeedA : out.deltaSpeedB).toBe(0);
  }
});

test("a secondary overlap blocked vertically does not make horizontal motion infinite-mass", () => {
  const a = body(1100), b = body(1100), hit = contact(), out = result();
  a.state.vx = 12;
  let queries = 0;
  const world = {
    free: (body: DynamicBody, _from: Readonly<DynamicBody["state"]>, blocker: Float64Array) => { blocker[1] = 1; return body.state.y >= 0; },
    overlap: () => ++queries === 1 ? { ...hit, nx: .95, ny: -.3122498999, depth: .02 } : null,
  };
  resolveDynamicContact(a, b, hit, world, new DynamicScratch(), out);
  expect(b.state.vx).toBeGreaterThan(6); expect(a.state.vx).toBeGreaterThan(5);
  expect(a.mass * a.state.vx + b.mass * b.state.vx).toBeCloseTo(1100 * 12, 8);
});

test("world-constrained pairs preserve allowed motion without adding energy, including retreating and rotating bodies", () => {
  for (const rigid of [false, true]) for (const reverse of [false, true]) for (const angle of [0, .4]) for (const otherSpeed of [-5, 0, 6]) {
    const a = body(1100), b = body(rigid ? 1100 : 40), hit = contact(), out = result();
    if (rigid) { a.spec = b.spec = car.spec; a.mass = b.mass = vehicleMassProperties(car.spec, a.state).mass; }
    a.state.x = .2; a.state.vx = 12; a.state.vz = 3; b.state.vx = otherSpeed; b.state.vz = -2;
    if (rigid) { a.state.yawRate = 1; b.state.pitchRate = .2; b.state.yawRate = -.4; }
    hit.t = .5; hit.x = .1; hit.y = .6; hit.z = .3;
    if (reverse) hit.nx = -1;
    const nx = -Math.cos(angle), ny = Math.sin(angle);
    const world = { free: (body: DynamicBody, _from: Readonly<DynamicBody["state"]>, blocker: Float64Array) => {
      blocker[0] = nx; blocker[1] = ny; blocker[2] = 0; blocker[3] = 1; blocker[4] = .4; blocker[5] = -.3;
      return body !== b;
    }, overlap: () => null };
    const energy = (body: DynamicBody) => {
      const s = body.state, m = body.spec ? vehicleMassProperties(body.spec, s) : null;
      return .5 * body.mass * (s.vx ** 2 + s.vy ** 2 + s.vz ** 2) + (m ? .5 * (m.ix * s.pitchRate ** 2 + m.iy * s.yawRate ** 2 + m.iz * s.rollRate ** 2) : 0);
    };
    const before = energy(a) + energy(b);
    resolveDynamicContact(reverse ? b : a, reverse ? a : b, hit, world, new DynamicScratch(), out);
    expect(energy(a) + energy(b)).toBeLessThanOrEqual(before + 1e-6);
    expect(Number.isFinite(out.impulse)).toBe(true); expect(out.impulse).toBeGreaterThanOrEqual(0);
    if (!rigid) expect([a.state.vz, b.state.vz]).toEqual([3, -2]);
  }
});

test("a pair trapped between two world blockers stops instead of restituting into either wall", () => {
  const a = body(1100), b = body(1100), hit = contact(), out = result();
  a.state.x = .2; a.state.vx = 12; b.state.vx = -12; hit.t = .5;
  resolveDynamicContact(a, b, hit, { free: () => false, overlap: () => null }, new DynamicScratch(), out);
  expect(a.state.vx).toBeCloseTo(0, 10); expect(b.state.vx).toBeCloseTo(0, 10);
  expect(Number.isFinite(out.impulse)).toBe(true); expect(out.impulse).toBeGreaterThan(0);
});
