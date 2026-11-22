import { expect, test } from "bun:test";
import { ASPHALT } from "../../content/vehicles/compact.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { applyTuning } from "../../shared/content/tuning.ts";
import { quatRotate } from "../../shared/math/quat.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { readBody, writeBody } from "../../shared/net/protocol.ts";
import { Body, BTN_BURST, BTN_SPRINT } from "../../shared/sim/character.ts";
import { createVehicle, isWheelVehicle, stepVehicle, type VehicleSpec, type WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { stepVehicleBody } from "../../shared/sim/vehicle-body.ts";
import { vehicleRotation } from "../../shared/sim/vehicle-frame.ts";
import {
  FIRED_CATCH, FIRED_CUSHION, FIRED_LIFT, boostCooling, cooldownTicks, flipCooling, nozzleStrength, thrustAxis, ZEPHYR_THRUSTERS,
} from "../../shared/sim/vehicle-thrusters.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";

// The thrusters on the sports chassis they are fitted to, on flat asphalt: the module alone, apart from the Zephyr's art.
const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 1, -128, 1 / 256);
for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) hf.setSample(x, z, 0);
const structs = new StructureStore(dims, new Float32Array([0, 90]), new Float32Array([0, .075]), new Float32Array([0, 90]));
const world = new StaticVehicleWorld({ hf, structs }, () => ASPHALT);
const sports = CORE_CONTENT.find((d) => d.id === "core:veloce" && d.type === "species");
const base = sports?.type === "species" && sports.vehicle && isWheelVehicle(sports.vehicle) ? sports.vehicle : null;
if (!base) throw new Error("the sports chassis is missing");
const spec: VehicleSpec = { ...base.spec, mass: 1700, thrusters: ZEPHYR_THRUSTERS };
const coast = { throttle: 0, steer: 0, brake: 0, handbrake: false };
const q = new Float64Array(4), up = new Float64Array(3), nose = new Float64Array(3);
const upOf = (car: ReturnType<typeof createVehicle>): number => { vehicleRotation(car, q); quatRotate(q, 0, 0, 1, 0, up, 0); return up[1]!; };
function settled(speed = 0, s = spec) {
  const car = createVehicle(s, 64, 0, 16); car.vz = speed;
  for (let i = 0; i < 20; i++) stepVehicle(car, coast, s, world);
  return car;
}

const FLIPS = [["a kickflip", 0, 0], ["a roll left", 0, 1], ["a roll right", 0, -1], ["a front flip", 1, 0], ["a back flip", -1, 0]] as const;

for (const [name, throttle, steer] of FLIPS) for (const speed of [0, 20]) test(`${name} at ${speed} m/s hops about three metres and lands on its wheels below the damage speed`, () => {
  const car = settled(speed);
  let apex = 0, landing = -1, lowest = 1, airborne = false, cushioned = false, caught = false;
  for (let t = 0; t < 120; t++) {
    const r = stepVehicle(car, { ...coast, throttle: t === 0 ? throttle : 0, steer: t === 0 ? steer : 0, burst: t < 2 }, spec, world);
    apex = Math.max(apex, car.y); lowest = Math.min(lowest, upOf(car));
    cushioned ||= (car.thrust! & FIRED_CUSHION) !== 0; caught ||= (car.thrust! & FIRED_CATCH) !== 0;
    if (!car.grounded) airborne = true;
    else if (airborne && landing < 0) landing = r.landSpeed;
  }
  expect(apex).toBeGreaterThan(3); expect(apex).toBeLessThan(4.5);
  // Turned all the way over, caught, and down soft: under the 12 m/s at which a landing hurts (server/urban.ts).
  expect(lowest).toBeLessThan(-.99); expect(caught).toBe(true); expect(cushioned).toBe(true);
  expect(landing).toBeGreaterThan(0); expect(landing).toBeLessThan(9);
  expect(upOf(car)).toBeGreaterThan(.999); expect(car.grounded).toBe(true);
  expect(Math.hypot(car.pitchRate, car.rollRate)).toBeLessThan(.05);
  expect(thrustAxis(car.thrust!)).toBe(0);
});

test("each direction turns the car the way it names: A rolls the roof left, D and none right, W the nose down, S up", () => {
  for (const [name, throttle, steer] of FLIPS) {
    const car = settled();
    for (let t = 0; t < 12; t++) stepVehicle(car, { ...coast, throttle: t === 0 ? throttle : 0, steer: t === 0 ? steer : 0, burst: t === 0 }, spec, world);
    vehicleRotation(car, q); quatRotate(q, 0, 0, 1, 0, up, 0); quatRotate(q, 0, 0, 0, 1, nose, 0);
    // +X is the driver's side, the left.
    const want = { "a kickflip": [-1, 0], "a roll left": [1, 0], "a roll right": [-1, 0], "a front flip": [0, -1], "a back flip": [0, 1] }[name];
    expect(Math.sign(Math.round(up[0]! * 2))).toBe(want[0]!); expect(Math.sign(Math.round(nose[1]! * 2))).toBe(want[1]!);
  }
});

test("the boost adds about thirty metres a second over three quarters of one, then waits out its cooldown; with none, held, it runs on", () => {
  const car = settled();
  for (let t = 0; t < 60; t++) stepVehicle(car, { ...coast, throttle: 1 }, spec, world);
  const before = car.vz;
  for (let t = 0; t < 30; t++) stepVehicle(car, { ...coast, throttle: 1, boost: true }, spec, world);
  expect(car.vz - before).toBeGreaterThan(25); expect(car.vz - before).toBeLessThan(36);
  expect(boostCooling(car.thrustCool!)).toBe(ZEPHYR_THRUSTERS.boostCooldownTicks - (30 - ZEPHYR_THRUSTERS.boostTicks));
  const held = car.vz;
  for (let t = 0; t < 30; t++) stepVehicle(car, { ...coast, throttle: 1, boost: true }, spec, world);
  expect(car.vz - held).toBeLessThan(5);
  const free: VehicleSpec = { ...spec, thrusters: { ...ZEPHYR_THRUSTERS, boostCooldownTicks: 0 } }, endless = settled(0, free);
  for (let t = 0; t < 90; t++) stepVehicle(endless, { ...coast, boost: true }, free, world);
  expect(endless.vz).toBeGreaterThan(85);
});

test("a flip waits out its cooldown from the press, and with none a fresh press flips again as soon as it is down", () => {
  const car = settled();
  for (let t = 0; t < 60; t++) stepVehicle(car, { ...coast, burst: t === 0 || t === 50 }, spec, world);
  // The second press came on the ground inside three seconds: nothing.
  expect(thrustAxis(car.thrust!)).toBe(0); expect(flipCooling(car.thrustCool!)).toBe(ZEPHYR_THRUSTERS.flipCooldownTicks - 59);
  const free: VehicleSpec = { ...spec, thrusters: { ...ZEPHYR_THRUSTERS, flipCooldownTicks: 0 } }, again = settled(0, free);
  let lifts = 0, lifting = false;
  for (let t = 0; t < 120; t++) {
    stepVehicle(again, { ...coast, burst: t === 0 || t === 50 }, free, world);
    const now = (again.thrust! & FIRED_LIFT) !== 0; if (now && !lifting) lifts++; lifting = now;
  }
  expect(lifts).toBe(2); expect(upOf(again)).toBeGreaterThan(.999);
  // Held, it does not repeat: each flip is a press.
  const held = settled(0, free); lifts = 0; lifting = false;
  for (let t = 0; t < 120; t++) {
    stepVehicle(held, { ...coast, burst: true }, free, world);
    const now = (held.thrust! & FIRED_LIFT) !== 0; if (now && !lifting) lifts++; lifting = now;
  }
  expect(lifts).toBe(1);
});

test("a flip from a car lying on its roof turns it back onto its wheels", () => {
  const car = createVehicle(spec, 64, 3, 16); car.rollRate = 7;
  for (let i = 0; i < 200; i++) stepVehicle(car, coast, spec, world);
  expect(upOf(car)).toBeLessThan(-.99);
  for (let t = 0; t < 150; t++) stepVehicle(car, { ...coast, burst: t === 0 }, spec, world);
  expect(upOf(car)).toBeGreaterThan(.999); expect(car.grounded).toBe(true);
});

test("a car without thrusters steps exactly as before whatever thruster keys are held, and keeps no thruster state", () => {
  const plain = base.spec, a = createVehicle(plain, 64, 0, 16), b = createVehicle(plain, 64, 0, 16);
  for (let t = 0; t < 90; t++) {
    stepVehicle(a, { ...coast, throttle: 1, steer: t > 40 ? .5 : 0 }, plain, world);
    stepVehicle(b, { ...coast, throttle: 1, steer: t > 40 ? .5 : 0, boost: true, burst: t % 7 === 0 }, plain, world);
  }
  expect(b).toEqual(a); expect(a.thrust ?? 0).toBe(0);
});

test("a flip replayed through the body from any tick of it is the same, and its state crosses the wire whole", () => {
  const def: WheelVehicleDefinition = { ...base, spec };
  const body = new Body(), dirty = new Body(), wire = new Body();
  body.mode = 1; body.vehicle = true; body.x = 64; body.z = 16; body.fuel = spec.fuelCapacity; body.vehicleQw = 1; body.vehicleEngineOn = true;
  const buttons = (t: number): number => (t === 5 ? BTN_BURST : 0) | (t >= 50 && t < 80 ? BTN_SPRINT : 0);
  const states: Body[] = [];
  for (let t = 0; t < 130; t++) {
    stepVehicleBody({ hf, structs }, body, 0, t > 30 ? 127 : 0, buttons(t), def);
    const copy = new Body(); copy.copy(body); states.push(copy);
  }
  expect(states.some((s) => thrustAxis(s.vehicleThrust) !== 0)).toBe(true);
  for (const from of [6, 20, 45, 60]) {
    dirty.copy(states[from]!);
    for (let t = from + 1; t < 130; t++) {
      stepVehicleBody({ hf, structs }, dirty, 0, t > 30 ? 127 : 0, buttons(t), def);
      expect(dirty.equals(states[t]!)).toBe(true);
    }
  }
  for (const s of states) {
    const w = new BitWriter(4096); writeBody(w, s);
    readBody(new BitReader(w.bytes()), wire);
    expect([wire.vehicleThrust, wire.vehicleThrustCool]).toEqual([s.vehicleThrust, s.vehicleThrustCool]);
  }
});

test("the server's cooldowns reach the car's spec in ticks, 0 as none, and leave every other species as it was", () => {
  const tuned = applyTuning(CORE_CONTENT, { thrusters: { boost: 0, flip: 1.5 } });
  expect(CORE_CONTENT.filter((d) => d.type === "species" && d.vehicle && isWheelVehicle(d.vehicle) && d.vehicle.spec.thrusters).map((d) => d.id)).toEqual(["core:zephyr"]);
  for (let i = 0; i < CORE_CONTENT.length; i++) {
    const d = CORE_CONTENT[i]!, t = tuned[i]!;
    if (d.type !== "species" || !d.vehicle || !isWheelVehicle(d.vehicle) || !d.vehicle.spec.thrusters) { expect(t).toBe(d); continue; }
    const spec = t.type === "species" && t.vehicle && isWheelVehicle(t.vehicle) ? t.vehicle.spec.thrusters : undefined;
    expect([spec?.boostCooldownTicks, spec?.flipCooldownTicks]).toEqual([0, 45]);
  }
  expect([cooldownTicks(0), cooldownTicks(-1), cooldownTicks(4), cooldownTicks(1e9)]).toEqual([0, 0, 120, 0xffff]);
});

test("the nozzles that blow are those the move fires: a boost the tail, a lift all four corners, a roll right the left side", () => {
  const car = settled();
  stepVehicle(car, { ...coast, burst: true }, spec, world);
  expect(["nozzle_lift_fl", "nozzle_lift_fr", "nozzle_lift_rl", "nozzle_lift_rr"].map((n) => nozzleStrength(car.thrust!, n))).toEqual([1, 1, 1, 1]);
  expect(nozzleStrength(car.thrust!, "nozzle_boost_l")).toBe(0);
  for (let t = 0; t < 4; t++) stepVehicle(car, coast, spec, world);
  expect(nozzleStrength(car.thrust!, "nozzle_roll_l")).toBeGreaterThan(0); expect(nozzleStrength(car.thrust!, "nozzle_roll_r")).toBe(0);
  expect(nozzleStrength(0, "nozzle_boost_l")).toBe(0);
});
