import { expect, test } from "bun:test";
import { JET as spec, JET_VEHICLE as def } from "../../content/vehicles/jet.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { Body, BTN_JUMP, BTN_MOD, BTN_SPRINT, MODE_WALK } from "../../shared/sim/character.ts";
import { createJet, jetLift, stepJet, type JetInput, type JetState, type JetWorld } from "../../shared/sim/jet.ts";
import { JET_SPEED_CAP, validateVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { stepVehicleBody } from "../../shared/sim/vehicle-body.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StaticJetWorld } from "../../shared/world/jet.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { coreRegistry } from "../fixtures/world.ts";

const command = (change: Partial<JetInput> = {}): JetInput => ({ throttle: 0, roll: 0, aimYaw: 0, aimPitch: 0, climb: 0, afterburner: false, airbrake: false, vtol: false, pilot: true, ...change });
const sky: JetWorld = { support: () => null, blocked: () => null, waterAt: () => -Infinity };
const speed = (s: JetState): number => Math.hypot(s.vx, s.vy, s.vz);
function ground() {
  const dims = { chunksX: 8, chunksZ: 64 }, hf = new Heightfield(dims, 2, -16, 1 / 256); hf.heights.fill(4096);
  const structs = new StructureStore(dims, new Float32Array([0]), new Float32Array([0]), new Float32Array([0]));
  const raw = { hf, structs };
  return { raw, world: new StaticJetWorld(raw) };
}
function flying(y: number, v: number): JetState {
  return { ...createJet(spec, 256, y, 200), grounded: false, engineOn: true, vz: v, gear: 0, nozzle: 0, spool: 1, throttle: 1 };
}
function run(s: JetState, ticks: number, input: JetInput | ((s: JetState, tick: number) => JetInput), world = sky): { most: number; land: number; blocked: string | null } {
  let most = 0, land = 0, blocked: string | null = null;
  for (let t = 0; t < ticks; t++) {
    const r = stepJet(s, typeof input === "function" ? input(s, t) : input, def, world);
    most = Math.max(most, speed(s)); land = Math.max(land, r.landSpeed); blocked ??= r.blocked;
  }
  return { most, land, blocked };
}

test("the jet's content validates, and no jet may be tuned past the speed cap", () => {
  expect(() => validateVehicleDefinition(def)).not.toThrow();
  expect(def.seats.filter(s => s.driver)).toHaveLength(1);
  expect(def.seats[0]!.weapons).toBe(false);
  expect(() => validateVehicleDefinition({ ...def, spec: { ...spec, topSpeed: JET_SPEED_CAP + 1 } })).toThrow();
  expect(() => validateVehicleDefinition({ ...def, spec: { ...spec, maxForward: JET_SPEED_CAP + 1 } })).toThrow();
  expect(() => validateVehicleDefinition({ ...def, spec: { ...spec, stallSpeed: spec.cruiseSpeed } })).toThrow();
  expect(() => validateVehicleDefinition({ ...def, weapons: { missiles: { ...def.weapons!.missiles!, count: 0 } } })).toThrow("invalid vehicle missiles");
  // What it fires: a hitscan 25 mm round, and a missile that goes off as a rocket does, with a wider blast.
  const reg = coreRegistry(), id = (name: string): number => reg.index.get(name)!;
  expect([reg.damage[id("core:cannon_round")], reg.ammoSpeed[id("core:cannon_round")], reg.power[id("core:jet_cannon")]]).toEqual([60, 0, 1]);
  expect([reg.damage[id("core:jet_missile")], reg.ammoBlast[id("core:jet_missile")], reg.structureMul[id("core:jet_missile_rack")]]).toEqual([2400, 10, 7350 / 250]);
});

test("military thrust holds about 120 m/s level, the afterburner about 160, and no dive passes 180", () => {
  const s = flying(1200, 100);
  run(s, 1800, command({ throttle: 1 }));
  expect(speed(s)).toBeGreaterThan(116); expect(speed(s)).toBeLessThan(123);
  expect(Math.abs(s.y - 1200)).toBeLessThan(40);
  const burn = run(s, 1800, command({ throttle: 1, afterburner: true }));
  expect(speed(s)).toBeGreaterThan(155); expect(burn.most).toBeLessThan(163);
  expect(s.shiftTime).toBe(1);
  const dive = run(s, 900, (j) => command({ throttle: 1, afterburner: true, aimYaw: j.yaw, aimPitch: -1.45 }));
  expect(dive.most).toBeGreaterThan(170); expect(dive.most).toBeLessThanOrEqual(JET_SPEED_CAP + 1e-3);
});

test("past its critical angle the wing stalls, and a slow jet with its nose high falls", () => {
  const critical = jetLift(spec, spec.criticalAngle);
  expect(critical).toBeCloseTo(1, 6);
  expect(jetLift(spec, spec.criticalAngle * .5)).toBeLessThan(critical);
  expect(jetLift(spec, spec.criticalAngle * 1.4)).toBeLessThan(critical * .8);
  expect(jetLift(spec, 1.2)).toBeGreaterThan(0);
  // Slow and climbing with the lift fan off: the speed bleeds, the nose drops and the height goes.
  const s = flying(600, 70); s.throttle = 0; s.spool = 0;
  let top = s.y;
  for (let t = 0; t < 600; t++) { stepJet(s, command({ aimPitch: .8 }), def, sky); top = Math.max(top, s.y); }
  expect(top).toBeGreaterThan(610);
  expect(s.y).toBeLessThan(top - 100);
  // The same jet at 35 m/s with the throttle closed: on the wing alone it sinks; with the lift fan it holds its height.
  const wing = { ...flying(600, 35), throttle: 0, spool: 0 }, fan = { ...wing, nozzle: 1 };
  run(wing, 150, command()); run(fan, 150, command({ vtol: true }));
  expect(wing.y).toBeLessThan(580); expect(Math.abs(fan.y - 600)).toBeLessThan(2);
});

test("a hard pull is held within the g limit", () => {
  const s = flying(1500, 150);
  let most = 0, vx = s.vx, vy = s.vy, vz = s.vz;
  for (let t = 0; t < 120; t++) {
    stepJet(s, command({ throttle: 1, aimPitch: 1.45 }), def, sky);
    const load = Math.hypot(s.vx - vx, s.vy - vy + spec.gravity * TICK_DT, s.vz - vz) / TICK_DT / spec.gravity;
    most = Math.max(most, load); vx = s.vx; vy = s.vy; vz = s.vz;
  }
  expect(most).toBeGreaterThan(4);
  expect(most).toBeLessThanOrEqual(spec.gLimit + .2);
  expect(s.pitch).toBeGreaterThan(.5);
});

test("VTOL lifts it off the ground, holds a hover, and carries it into wing-borne flight", () => {
  const { world } = ground(), s = createJet(spec, 256, 0, 200);
  run(s, 30, command({ vtol: true }), world);
  expect(s.grounded).toBe(true); expect(s.y).toBeCloseTo(0, 3);
  run(s, 240, command({ vtol: true, climb: 1 }), world);
  expect(s.grounded).toBe(false); expect(s.y).toBeGreaterThan(20); expect(s.engineOn).toBe(true);
  run(s, 150, command({ vtol: true }), world);
  const height = s.y;
  run(s, 60, command({ vtol: true }), world);
  expect(Math.abs(s.y - height)).toBeLessThan(.05); expect(speed(s)).toBeLessThan(.5);
  // Full throttle with VTOL still on: the fan fades out by speed and the wing takes the weight without a fall.
  let lowest = s.y;
  const rise = run(s, 900, () => command({ vtol: true, throttle: 1, aimPitch: .02 }), world);
  for (let t = 0; t < 60; t++) { stepJet(s, command({ vtol: true, throttle: 1, aimPitch: .02 }), def, world); lowest = Math.min(lowest, s.y); }
  expect(rise.blocked).toBeNull();
  expect(speed(s)).toBeGreaterThan(90); expect(s.gear).toBe(0);
  expect(lowest).toBeGreaterThan(height - 10);
});

test("on the runway it rolls, rotates and lifts off, and lands on its wheels and brakes to a stop", () => {
  const { world } = ground(), s = createJet(spec, 256, 0, 200);
  let liftoff = -1;
  for (let t = 0; t < 600 && s.y < 30; t++) {
    stepJet(s, command({ throttle: 1, afterburner: true, aimPitch: .2 }), def, world);
    if (liftoff < 0 && !s.grounded) liftoff = t;
    if (s.grounded) expect(Math.abs(s.vx)).toBeLessThan(.01);
  }
  expect(liftoff).toBeGreaterThan(0);
  expect(s.y).toBeGreaterThan(30);
  const landing = { ...flying(40, 62), vy: -2.5, gear: 1, spool: .5, throttle: .5 };
  let stopped = -1, land = 0;
  for (let t = 0; t < 1800 && stopped < 0; t++) {
    const r = stepJet(landing, command({ throttle: -1, airbrake: landing.grounded, aimPitch: -.04 }), def, world);
    land = Math.max(land, r.landSpeed);
    if (landing.grounded && Math.hypot(landing.vx, landing.vz) < .1) stopped = t;
  }
  expect(stopped).toBeGreaterThan(0);
  expect(land).toBeGreaterThan(0); expect(land).toBeLessThan(4);
  expect(landing.y).toBeCloseTo(0, 2);
});

test("the same inputs give the same bits, through the shared vehicle body as on its own", () => {
  const { raw } = ground();
  const fly = (): Body => {
    const b = new Body(); b.kind = 1; b.mode = MODE_WALK; b.vehicle = true; b.x = 256; b.z = 200; b.y = 0; b.grounded = true;
    b.vehicleQw = 1; b.fuel = spec.fuelCapacity; b.vehicleGear = 1; b.vehicleEngineCondition = 1;
    for (let t = 0; t < 600; t++) {
      const buttons = BTN_MOD | (t < 200 ? BTN_JUMP : 0) | (t > 400 ? BTN_SPRINT : 0);
      stepVehicleBody(raw, b, t % 90 < 30 ? 64 : 0, t > 250 ? 127 : 0, buttons, def, TICK_DT, (t * 37) & 65535, true, undefined, t > 300 ? 1200 : 0);
    }
    return b;
  };
  const a = fly(), b = fly();
  expect(a.y).toBeGreaterThan(5);
  expect(a.vehicleCollective).toBeGreaterThan(0);
  for (const key of ["x", "y", "z", "vx", "vy", "vz", "vehicleQx", "vehicleQy", "vehicleQz", "vehicleQw", "fuel", "vehicleCollective", "vehicleRotorRpm", "vehicleRotorPhase"] as const) {
    expect(a[key]).toBe(b[key]);
    expect(Math.fround(a[key])).toBe(a[key]);
  }
});
