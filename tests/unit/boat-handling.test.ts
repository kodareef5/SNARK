import { expect, test } from "bun:test";
import { BOAT as spec } from "../../content/vehicles/boat-spec.ts";
import { HELICOPTER_VEHICLE } from "../../content/vehicles/helicopter.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { quatAxis, quatRotate } from "../../shared/math/quat.ts";
import { boatPropellerPoint, boatRestY, createBoat, stepBoat, type BoatInput, type BoatState, type BoatWorld } from "../../shared/sim/boat.ts";
import { stepBoatWreck } from "../../shared/sim/boat-wreck.ts";
import { validateBoatSpec, type BoatVehicleDefinition, type RotorVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { vehiclePoint } from "../../shared/sim/vehicle-frame.ts";
import { boatMeetsCapsule, boatMeetsVehicle, boatPlacement, StaticBoatWorld } from "../../shared/world/boat.ts";
import { helicopterMeetsVehicle } from "../../shared/world/helicopter.ts";
import { boatOutboardFrame } from "../../shared/world/vehicle-shapes.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { MapWater } from "../../shared/world/water.ts";

const def: BoatVehicleDefinition = { id: "test:boat", movement: "boat", spec, seats: [], doors: [], wheels: [], actionTicks: 1, beltline: 1.36 };
const command = (change: Partial<BoatInput> = {}): BoatInput => ({ throttle: 0, steer: 0, neutral: false, pilot: true, ...change });
const sea: BoatWorld = { waterAt: () => 0, groundAt: () => -20, blocked: () => null, penetration: () => null };
function boat(payload = 0): BoatState { const s = createBoat(spec, 96, boatRestY(spec, 0, payload), 96); s.payloadMass = payload; return s; }
function run(s: BoatState, ticks: number, input = command(), world = sea) {
  let impact = 0, blocked: string | null = null, prop = false, plane = 0;
  for (let tick = 0; tick < ticks; tick++) { const r = stepBoat(s, input, def, world); impact = Math.max(impact, r.impactSpeed); blocked ??= r.blocked; prop ||= r.propHit; plane = Math.max(plane, r.planing); }
  return { impact, blocked, prop, plane };
}
function native() {
  const dims = { chunksX: 8, chunksZ: 8 }, hf = new Heightfield(dims, 2, -32, 1 / 256); hf.heights.fill(4096); hf.seaLevel = 0;
  const structs = new StructureStore(dims, new Float32Array([0, 12, .10, 12, .08]), new Float32Array([0, 4, 4, .1, .08]), new Float32Array([0, .025, .10, 12, .08]));
  const raw = { hf, structs }; return { hf, structs, raw, world: new StaticBoatWorld(raw) };
}

test("boat volume validates and exact rest draft deepens with finite cargo capacity", () => {
  expect(() => validateBoatSpec(spec)).not.toThrow();
  expect(boatRestY(spec, 12)).toBeCloseTo(11.65, 6);
  expect(boatRestY(spec, 12, 1000)).toBeCloseTo(11.4, 6);
  expect(boatRestY(spec, 12, spec.displacement)).toBe(-Infinity);
  expect(() => validateBoatSpec({ ...spec, draft: .7 })).toThrow("draft");
  expect(() => validateBoatSpec({ ...spec, buoyancyPoints: [] })).toThrow();
});

test("a dropped boat displaces water and settles without a sea-height teleport", () => {
  const s = boat(); s.y = 2.5;
  stepBoat(s, command(), def, sea); expect(s.y).toBeGreaterThan(2.45); expect(s.vy).toBeLessThan(0);
  run(s, 300); expect(s.y).toBeCloseTo(-.35, 2); expect(Math.abs(s.vy)).toBeLessThan(.01);
  expect(s.grounded).toBe(false); expect(Math.abs(s.pitch)).toBeLessThan(.005);
  const loaded = boat(1000); run(loaded, 90); expect(loaded.y).toBeCloseTo(-.6, 3);
});

test("thrust spools, neutral coasts, and reversing spends momentum before moving astern", () => {
  const s = boat(); stepBoat(s, command({ throttle: 1 }), def, sea);
  expect(s.engineRpm).toBeLessThan(spec.maxRpm / 4); expect(s.vz).toBeLessThan(.1);
  run(s, 240, command({ throttle: 1 })); const speed = s.vz;
  expect(speed).toBeGreaterThan(14);
  stepBoat(s, command({ neutral: true }), def, sea);
  expect(s.gear).toBe(0); expect(s.vz).toBeGreaterThan(speed * .97);
  const coast = s.z; run(s, 30, command({ neutral: true })); expect(s.z - coast).toBeGreaterThan(8);
  run(s, 60, command({ throttle: 1 })); const before = s.vz;
  stepBoat(s, command({ throttle: -1 }), def, sea); expect(s.vz).toBeGreaterThan(before * .97);
  let neutral = false, reversed = false;
  for (let i = 0; i < 600; i++) { stepBoat(s, command({ throttle: -1 }), def, sea); neutral ||= s.gear === 0; reversed ||= s.vz < -.5; }
  expect(neutral).toBe(true); expect(reversed).toBe(true); expect(s.gear).toBe(-1); expect(s.vz).toBeGreaterThan(-spec.maxReverse * 1.2);
});

test("stern thrust gives low-speed docking yaw and reverses the yaw when backing", () => {
  const forward = boat(), reverse = boat();
  run(forward, 60, command({ throttle: .35, steer: .8 })); run(reverse, 60, command({ throttle: -.35, steer: .8 }));
  expect(forward.yaw).toBeGreaterThan(.05); expect(reverse.yaw).toBeLessThan(-.03);
  expect(Math.hypot(forward.vx, forward.vz)).toBeLessThan(4);
  const yaw = forward.yaw; run(forward, 30, command({ neutral: true, steer: -.8 }));
  expect(forward.yaw).toBeGreaterThan(yaw); // A wheel turn in neutral cannot rotate the boat instantly.
});

test("planing rises and trims the actual hull, cargo costs acceleration, and a cut settles back", () => {
  const light = boat(), heavy = boat(1000);
  const report = run(light, 300, command({ throttle: 1 })); run(heavy, 300, command({ throttle: 1 }));
  expect(report.plane).toBeGreaterThan(.8); expect(light.y).toBeGreaterThan(-.3); expect(light.pitch).toBeGreaterThan(.015);
  expect(light.z).toBeGreaterThan(heavy.z + 5); expect(heavy.y).toBeLessThan(light.y - .1);
  run(light, 1500, command({ neutral: true })); expect(light.y).toBeCloseTo(-.35, 2); expect(Math.abs(light.pitch)).toBeLessThan(.01);
});

test("turns retain lateral momentum and bank under hydrodynamic torque", () => {
  const s = boat(); run(s, 240, command({ throttle: 1 })); const before = s.vz;
  stepBoat(s, command({ throttle: 1, steer: 1 }), def, sea); expect(s.vz).toBeGreaterThan(before * .97);
  let heel = 0;
  for (let i = 0; i < 90; i++) { stepBoat(s, command({ throttle: 1, steer: .65 }), def, sea); heel = Math.max(heel, Math.abs(s.roll)); }
  expect(s.yaw).toBeGreaterThan(.3); expect(heel).toBeGreaterThan(.015); expect(heel).toBeLessThan(.65);
  expect(Math.hypot(s.vx, s.vz)).toBeGreaterThan(5);
});

test("terminal thrust balances resistance in both gears without a velocity limiter", () => {
  for (const direction of [1, -1]) {
    const s = boat(); run(s, 1200, command({ throttle: direction }));
    const speed = Math.abs(s.vz), nominal = direction > 0 ? spec.maxForward : spec.maxReverse;
    expect(speed).toBeGreaterThan(nominal * .85); expect(speed).toBeLessThan(nominal * 1.12);
    s.vz = direction * nominal * 1.5;
    stepBoat(s, command({ throttle: direction }), def, sea);
    expect(Math.abs(s.vz)).toBeGreaterThan(nominal * 1.4); // Resistance dissipates excess speed over time.
  }
});

test("fuel, propulsion health and load matter; a dry or airborne propeller cannot propel", () => {
  const healthy = boat(), damaged = boat(); damaged.engineCondition = .2;
  run(healthy, 90, command({ throttle: 1 })); run(damaged, 90, command({ throttle: 1 }));
  expect(healthy.z).toBeGreaterThan(damaged.z + 2); expect(healthy.fuel).toBeLessThan(spec.fuelCapacity);
  const empty = boat(); empty.fuel = 0; run(empty, 60, command({ throttle: 1 })); expect(empty.vz).toBe(0);
  const air = boat(); air.y = 50; run(air, 20, command({ throttle: 1 })); expect(air.vz).toBe(0); expect(air.y).toBeLessThan(50);
  const land = native(); land.hf.heights.fill(8192); const dry = createBoat(spec, 96, .29, 96);
  run(dry, 90, command({ throttle: 1 }), land.world); expect(Math.abs(dry.z - 96)).toBeLessThan(.02);
});

test("native placement requires true lake level, a deep footprint, and clear solid geometry", () => {
  const n = native(); expect(boatPlacement(n.raw, 96, -.35, 96, 0, def)).toBe(true);
  expect(boatPlacement(n.raw, 96, 0, 96, 0, def)).toBe(false);
  n.hf.heights.fill(8128); expect(boatPlacement(n.raw, 96, -.35, 96, 0, def)).toBe(false);
  n.hf.heights.fill(4096);
  const grid = new Uint16Array(256 * 256); for (let z = 40; z < 60; z++) for (let x = 40; x < 60; x++) grid[z * 256 + x] = 1;
  n.hf.water = MapWater.fromGrid(n.hf.dims, n.hf.minY, n.hf.stepY, 2, [{ name: "Raised lake", level: 10752 }], grid);
  expect(boatPlacement(n.raw, 96, 9.65, 96, 0, def)).toBe(true);
  expect(boatPlacement(n.raw, 96, -.35, 96, 0, def)).toBe(false);
  n.structs.add(2, 96, 10, 96, 0, 0, 100); expect(boatPlacement(n.raw, 96, 9.65, 96, 0, def)).toBe(false);
});

test("a boat floats on a raised lake as on the sea, at the lake's own surface", () => {
  const n = native();
  const grid = new Uint16Array(256 * 256); for (let z = 30; z < 70; z++) for (let x = 30; x < 70; x++) grid[z * 256 + x] = 1;
  n.hf.water = MapWater.fromGrid(n.hf.dims, n.hf.minY, n.hf.stepY, 2, [{ name: "Raised lake", level: 10752 }], grid);
  const s = createBoat(spec, 96, boatRestY(spec, 10) + .4, 96);
  run(s, 300, command(), n.world);
  expect(s.y).toBeCloseTo(boatRestY(spec, 10), 1);
  expect(Math.hypot(s.vx, s.vy, s.vz)).toBeLessThan(.1);
});

test("swept hull catches a thin wall and a glancing touch retains tangential travel", () => {
  const n = native(); n.structs.add(1, 96, 0, 108, 0, 0, 100);
  const s = boat(); s.vz = 60; const hit = run(s, 30, command(), n.world);
  expect(hit.blocked).toContain("structure:"); expect(hit.impact).toBeGreaterThan(35); expect(s.z).toBeLessThan(105);
  const glancing = boat(); glancing.z = 104.5; glancing.vx = 12; glancing.vz = .6;
  const brush = run(glancing, 15, command(), n.world); expect(brush.impact).toBeLessThan(3); expect(glancing.x).toBeGreaterThan(98);
  expect(n.world.blocked(s, s, def)).toBeNull();
});

test("the propeller meets shallows and full quaternion collision follows an inverted hull", () => {
  const n = native(), s = boat(); n.structs.add(4, 96.2, -.27, 91.7, 0, 0, 100); s.vz = -5;
  const report = run(s, 15, command({ throttle: -1 }), n.world); expect(report.prop).toBe(true);
  const inverted = boat(); inverted.y = 5; inverted.qz = 1; inverted.qw = 0;
  expect(boatMeetsCapsule(def, inverted, 96, 3.5, 96, .3, 1.8)).not.toBeNull();
  expect(boatMeetsCapsule(def, inverted, 96, 6.2, 96, .3, 1.8)).toBeNull();
});

test("steering sweeps the propeller and engine joint through its actual pivot, including a stationary dock strike", () => {
  const n = native(), straight = boat(), turned = { ...straight, steering: spec.maxSteer };
  n.structs.add(4, 96.43, -.27, 92.29, 0, 0, 100);
  expect(n.world.blocked(straight, straight, def)).toBeNull();
  expect(n.world.blocked(turned, turned, def)?.propeller).toBe(true);
  expect(n.world.blocked(straight, turned, def)?.propeller).toBe(true);
  expect(boatMeetsCapsule(def, turned, 96.43, -.3, 92.29, .035, .06)?.propeller).toBe(true);
  expect(boatMeetsCapsule(def, straight, 96.43, -.3, 92.29, .035, .06)).toBeNull();
  const local = new Float64Array(3), actual = new Float64Array(3), expected = new Float64Array(3);
  turned.qx = .2; turned.qy = .3; turned.qz = .1; turned.qw = Math.sqrt(.86);
  boatPropellerPoint(spec, turned.steering, local); vehiclePoint(turned, local, expected);
  const mount = boatOutboardFrame(turned, spec), pivot = spec.outboard!.pivot, at = spec.propeller.at;
  quatRotate([mount.qx, mount.qy, mount.qz, mount.qw], 0, at[0] - pivot[0], at[1] - pivot[1], at[2] - pivot[2], actual, 0);
  expect(actual[0]! + mount.x).toBeCloseTo(expected[0]!, 8);
  expect(actual[1]! + mount.y).toBeCloseTo(expected[1]!, 8);
  expect(actual[2]! + mount.z).toBeCloseTo(expected[2]!, 8);
});

test("mixed boat and rotor queries preserve open cockpit space in both directions", () => {
  const narrow: RotorVehicleDefinition = { ...HELICOPTER_VEHICLE, rotors: [], spec: { ...HELICOPTER_VEHICLE.spec,
    halfWidth: .1, halfLength: .1, height: .2, clearance: .01, skidHalfWidth: .05, skidHalfLength: .05, engineBox: undefined, bodyBoxes: [],
    tail: { from: [0, .1, 0], to: [0, .1, -.1], radius: .03 },
  } };
  const s = boat(), rotor = { x: 96, y: .8, z: 96, yaw: 0, pitch: 0, roll: 0 };
  expect(boatMeetsVehicle(def, s, narrow, rotor)).toBeNull();
  expect(helicopterMeetsVehicle(narrow, rotor, def, s)).toBeNull();
  rotor.x = 97.25;
  expect(boatMeetsVehicle(def, s, narrow, rotor)).not.toBeNull();
  expect(helicopterMeetsVehicle(narrow, rotor, def, s)).not.toBeNull();
});

test("a shoaling beach arrests the hull and an exposed prop cannot drive it inland", () => {
  const n = native();
  for (let z = 0; z < n.hf.nz; z++) for (let x = 0; x < n.hf.nx; x++) n.hf.setSample(x, z, Math.min(1, -3 + Math.max(0, z * 2 - 96) * .15));
  const s = boat(); s.vz = 10;
  const report = run(s, 360, command({ throttle: 1 }), n.world);
  expect(report.blocked).toBe("terrain"); expect(s.z).toBeGreaterThan(100);
  expect(stepBoat(s, command({ throttle: 1 }), def, n.world).propellerImmersion).toBe(0);
  expect(n.world.blocked(s, s, def)).toBeNull();
  const stranded = s.z; run(s, 180, command({ throttle: 1 }), n.world);
  expect(s.z - stranded).toBeLessThan(.1);
});

test("diagonal map-edge contact remains outside solids and keeps the whole hull inside", () => {
  const n = native(), s = boat(); s.x = s.z = n.hf.sizeX - 8; s.vx = s.vz = 70;
  const report = run(s, 30, command(), n.world);
  expect(report.blocked).toBe("map-edge"); expect(n.world.blocked(s, s, def)).toBeNull();
  expect(s.x).toBeLessThan(n.hf.sizeX - 1); expect(s.z).toBeLessThan(n.hf.sizeZ - 3);
});

test("capsize shuts the motor, floods gradually, and never secretly restores an upright pose", () => {
  const s = boat(); s.qz = 1; s.qw = 0; s.y = .5; s.engineOn = true; s.engineRpm = spec.maxRpm;
  stepBoat(s, command({ throttle: 1 }), def, sea);
  expect(s.engineOn).toBe(false); expect(s.flooding).toBeGreaterThan(0); expect(s.flooding).toBeLessThan(.01);
  run(s, 420, command({ throttle: 1 })); expect(s.flooding).toBeGreaterThan(.9); expect(s.y).toBeLessThan(-1);
  expect(1 - 2 * (s.qx * s.qx + s.qz * s.qz)).toBeLessThan(0); expect(s.hullCondition).toBe(1);
});

test("overload and a flooded wreck sink to actual seabed, preserving attitude and finite collision", () => {
  const fresh = boat(); stepBoatWreck(fresh, def, sea);
  expect(fresh.y).toBeCloseTo(-.35, 3); expect(fresh.flooding).toBeGreaterThan(0); expect(fresh.flooding).toBeLessThan(.01);
  const overloaded = boat(); overloaded.payloadMass = 4000; run(overloaded, 180); expect(overloaded.y).toBeLessThan(-2);
  const n = native(), wreck = boat(); wreck.flooding = 1; const q = new Float64Array(4); quatAxis(q, 0, 0, 0, 1, .25);
  wreck.qx = q[0]!; wreck.qy = q[1]!; wreck.qz = q[2]!; wreck.qw = q[3]!;
  stepBoatWreck(wreck, def, n.world); expect(Math.abs(wreck.qz)).toBeGreaterThan(.11);
  let settled = false; for (let i = 0; i < 1800; i++) settled ||= stepBoatWreck(wreck, def, n.world);
  expect(settled).toBe(true); expect(wreck.y).toBeLessThan(-14); expect(n.world.blocked(wreck, wreck, def)).toBeNull();
  expect(Math.hypot(wreck.qx, wreck.qy, wreck.qz, wreck.qw)).toBeCloseTo(1, 5); expect(wreck.engineOn).toBe(false);
});

test("a tilted splash and hostile controls stay finite and keep a normalized quaternion", () => {
  const s = boat(); s.y = 4; s.qx = .3; s.qw = Math.sqrt(.91); s.vx = 12; s.vy = -18;
  for (let i = 0; i < 180; i++) {
    stepBoat(s, command({ throttle: i % 2 ? Infinity : NaN, steer: NaN }), def, sea);
    expect(Object.values(s).every(n => typeof n === "boolean" || Number.isFinite(n))).toBe(true);
    expect(Math.abs(s.qx * s.qx + s.qy * s.qy + s.qz * s.qz + s.qw * s.qw - 1)).toBeLessThan(2e-6);
  }
  expect(TICK_DT).toBeGreaterThan(0);
});


test("head-on and oblique wall contacts settle under buoyancy and reverse out without a hidden velocity freeze", () => {
  for (const yaw of [0, 34 * Math.PI / 180]) {
    const n = native(); n.structs.add(1, 100, 0, 116, 0, 0, 100);
    const s = createBoat(spec, 96, boatRestY(spec, 0), 104, yaw); s.vx = 12 * Math.sin(yaw); s.vz = 12 * Math.cos(yaw);
    let hit = false;
    for (let tick = 0; tick < 120; tick++) {
      const tangent = s.vx, report = stepBoat(s, command({ throttle: .5 }), def, n.world);
      if (report.blocked) {
        hit = true;
        if (yaw > 0) expect(s.vx).toBeGreaterThan(tangent * .5);
        break;
      }
    }
    expect(hit).toBe(true);
    run(s, 90, command({ neutral: true }), n.world);
    expect(Math.abs(s.y - boatRestY(spec, 0))).toBeLessThan(.05);
    const x = s.x, z = s.z;
    run(s, 150, command({ throttle: -1 }), n.world);
    expect(Math.hypot(s.x - x, s.z - z)).toBeGreaterThan(3);
    expect(n.world.blocked(s, s, def)).toBeNull();
  }
});

test("boat initial overlap escapes its original face, preserves the far side and checks a second obstacle", () => {
  const n = native(); n.structs.add(1, 96, 0, 108, 0, 0, 100);
  const s = createBoat(spec, 96, boatRestY(spec, 0), 104.7);
  expect(n.world.penetration(s, def)!.depth!).toBeGreaterThan(.05);
  expect(n.world.blocked(s, { ...s, z: 104.2 }, def)).toBeNull();
  expect(n.world.blocked(s, { ...s, z: 110 }, def)).not.toBeNull();
  n.structs.add(1, 96, 0, 100, 0, 0, 100);
  expect(n.world.blocked(s, { ...s, z: 103.5 }, def)).not.toBeNull();
});

test("an embedded outboard recovers through a bounded clear path before steering away", () => {
  const n = native(), straight = boat(), turned = { ...straight, steering: spec.maxSteer };
  n.structs.add(4, 96.43, -.27, 92.29, 0, 0, 100);
  expect(n.world.blocked(turned, turned, def)?.propeller).toBe(true);
  run(turned, 30, command(), n.world);
  expect(n.world.blocked(turned, turned, def)).toBeNull();
  expect(Math.hypot(turned.x - straight.x, turned.z - straight.z)).toBeLessThan(.3);
});
