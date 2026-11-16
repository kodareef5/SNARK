import { expect, test } from "bun:test";
import { HELICOPTER as spec, HELICOPTER_VEHICLE as def } from "../../content/vehicles/helicopter.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { createHelicopter, stepHelicopter, type HelicopterInput, type HelicopterState, type HelicopterWorld } from "../../shared/sim/helicopter.ts";
import { validateVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { vehiclePoint, rayVehicle } from "../../shared/sim/vehicle-frame.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { helicopterMeetsCapsule, helicopterMeetsKind, helicopterPlacement, StaticHelicopterWorld } from "../../shared/world/helicopter.ts";
import { StructureStore } from "../../shared/world/structures.ts";

const command = (change: Partial<HelicopterInput> = {}): HelicopterInput => ({ right: 0, forward: 0, yaw: 0, climb: 0, brake: false, cruise: false, direct: false, pilot: true, ...change });
const sky: HelicopterWorld = { support: () => null, blocked: () => null, waterAt: () => -Infinity };
const up = (s: HelicopterState) => 1 - 2 * (s.qx * s.qx + s.qz * s.qz);
function native() {
  const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 2, -16, 1 / 256); hf.heights.fill(4096);
  // 1 thin wall, 2 rooftop, 3 narrow post; all use the real structure broadphase and collision parts.
  const structs = new StructureStore(dims, new Float32Array([0, 12, 8, .12]), new Float32Array([0, 15, .15, 1]), new Float32Array([0, .02, 8, .12]));
  const raw = { hf, structs }; return { raw, hf, structs, world: new StaticHelicopterWorld(raw) };
}
function flight(y = 120): HelicopterState {
  return { ...createHelicopter(spec, 96, y, 96), grounded: false, engineOn: true, rotorRpm: spec.rotorRpm, collective: spec.mass / spec.liftMass };
}
function run(s: HelicopterState, ticks: number, input = command(), world = sky) {
  let blocked: string | null = null, rotor = false, impact = 0;
  for (let i = 0; i < ticks; i++) { const r = stepHelicopter(s, input, def, world); blocked ??= r.blocked; rotor ||= r.rotorHit; impact = Math.max(impact, r.impactSpeed); }
  return { blocked, rotor, impact };
}

test("helicopter content validates its own rotor mechanics and four enclosed seats", () => {
  expect(() => validateVehicleDefinition(def)).not.toThrow();
  expect(def.seats.length).toBe(4);
  expect(() => validateVehicleDefinition({ ...def, wheels: [{ bone: "fake_wheel" }] })).toThrow("invalid helicopter rig");
  expect(() => validateVehicleDefinition({ ...def, spec: { ...spec, liftMass: spec.mass } })).toThrow();
  expect(() => validateVehicleDefinition({ ...def, rotors: [{ ...def.rotors[0]!, axis: [0, 2, 0] }] })).toThrow();
});

test("spin-up is deliberate, hover holds height, and horizontal travel comes from banked thrust", () => {
  const { world } = native(), s = createHelicopter(spec, 96, 0, 64);
  run(s, 1, command({ climb: 1 }), world); run(s, 150, command(), world);
  expect(s.y).toBeCloseTo(0, 6); expect(s.engineOn).toBe(true); expect(s.rotorRpm).toBe(spec.rotorRpm);
  run(s, 150, command({ climb: 1 }), world); expect(s.y).toBeGreaterThan(20);
  run(s, 180, command(), world); const height = s.y;
  run(s, 120, command(), world); expect(Math.abs(s.y - height)).toBeLessThan(.01);
  expect(Math.abs(s.vy)).toBeLessThan(.001);
  const start = s.z; run(s, 90, command({ forward: 1 }), world);
  expect(s.z - start).toBeGreaterThan(10); expect(s.pitch).toBeLessThan(-.2); expect(s.vz).toBeGreaterThan(10);
  const speed = s.vz; stepHelicopter(s, command({ brake: true }), def, world);
  expect(s.vz).toBeGreaterThan(speed * .9); // No hidden instantaneous velocity reset.
  run(s, 180, command({ brake: true }), world); expect(Math.abs(s.vz)).toBeLessThan(.15);
});

test("direct cyclic executes a complete real loop and barrel roll without attitude caps, then recovers through finite torque", () => {
  for (const change of [{ forward: -1 }, { right: 1 }]) {
    const s = flight(240); s.vz = 28; s.collective = .82;
    let inverted = false, uprightAgain = false;
    for (let tick = 0; tick < 140; tick++) {
      stepHelicopter(s, command({ direct: true, ...change }), def, sky);
      inverted ||= up(s) < -.95; uprightAgain ||= inverted && up(s) > .95;
      expect(Math.abs(s.qx ** 2 + s.qy ** 2 + s.qz ** 2 + s.qw ** 2 - 1)).toBeLessThan(2e-6);
    }
    expect(inverted).toBe(true); expect(uprightAgain).toBe(true);
    const before = s.vy;
    stepHelicopter(s, command({ direct: true, brake: true }), def, sky);
    expect(Math.abs(s.vy - before)).toBeLessThan(2);
    run(s, 240, command({ direct: true, brake: true }));
    expect(up(s)).toBeGreaterThan(.999); expect(Math.abs(s.vy)).toBeLessThan(.05);
    expect(Math.sqrt(s.vx ** 2 + s.vz ** 2)).toBeLessThan(.1);
  }
});

test("a vertical dive has real momentum; collective and a flare arrest it only after spending height", () => {
  const s = flight(250); s.qx = Math.SQRT1_2; s.qw = Math.SQRT1_2; s.collective = .3; s.vy = -22;
  run(s, 18, command({ direct: true })); const fall = s.vy, start = s.y;
  expect(fall).toBeLessThan(-25);
  run(s, 180, command({ brake: true }));
  expect(s.y).toBeLessThan(start - 15); expect(up(s)).toBeGreaterThan(.99); expect(s.vy).toBeGreaterThan(-.1);
});

test("overload cannot lift, damage changes available lift, and loss of pilot descends to support and shuts down", () => {
  const { world } = native(), heavy = createHelicopter(spec, 96, 0, 96); heavy.payloadMass = 1200;
  run(heavy, 240, command({ climb: 1 }), world); expect(heavy.y).toBeCloseTo(0, 6);
  const good = flight(), damaged = flight(); damaged.engineCondition = .4; damaged.rotorCondition = .4; damaged.payloadMass = 500;
  run(good, 90, command({ climb: 1 })); run(damaged, 90, command({ climb: 1 }));
  expect(good.y).toBeGreaterThan(130); expect(damaged.y).toBeLessThan(110);
  const unattended = flight(10); run(unattended, 360, command({ pilot: false }), world);
  expect(unattended.grounded).toBe(true); expect(unattended.y).toBeCloseTo(0, 6); expect(unattended.engineOn).toBe(false);
});

test("rooftop landing and placement use support at the roof; rotor disc and tail prevent clipping a thin wall", () => {
  const { raw, world, structs } = native(); structs.add(2, 96, 10, 96, 0, 0, 100);
  expect(helicopterPlacement(raw, 96, 10.15, 96, 0, def)).toBe(true);
  expect(helicopterPlacement(raw, 96, 9, 96, 0, def)).toBe(false);
  const s = flight(18); run(s, 140, command({ climb: -1 }), world);
  expect(s.grounded).toBe(true); expect(s.y).toBeCloseTo(10.15, 3);
  structs.add(1, 96, 15, 115, 0, 0, 100);
  const moving = flight(14); moving.vz = 60;
  const result = run(moving, 60, command({ forward: 1, cruise: true }), world);
  expect(result.blocked).toContain("structure:"); expect(result.rotor).toBe(true);
  expect(moving.z).toBeLessThan(111); expect(result.impact).toBeGreaterThan(20);
});

test("rotor's empty space stays empty; full quaternion transforms agree for placement, actor contacts and seat rays", () => {
  const { world, structs } = native(), s = flight(8);
  // A post beneath the rotor but beside the cabin fits; raised through the disc it does not.
  const post = structs.add(3, s.x + 3.5, s.y + 1, s.z, 0, 0, 100);
  expect(world.blocked(s, s, def)).toBeNull();
  structs.remove(post); structs.add(3, s.x + 3.5, s.y + 3.15, s.z, 0, 0, 100);
  expect(world.blocked(s, s, def)?.rotor).toBe(true);
  expect(helicopterMeetsCapsule(def, s, s.x + 3.5, s.y + 2.6, s.z, .3, 1.7)?.rotor).toBe(true);
  expect(helicopterMeetsKind(structs.parts, 3, s.x + 3.5, s.y + 3.15, s.z, 0, def, s)).toBe(true);
  s.qz = 1; s.qw = 0;
  const out = [0, 0, 0]; vehiclePoint(s, [0, 1, 0], out); expect(out[1]).toBeCloseTo(s.y - 1, 6);
  expect(rayVehicle(def, s.x, s.y, s.z, s.yaw, s.x, s.y - 1, s.z + 8, 0, 0, -1, spec.height, s)).toBeLessThan(8);
});

test("seeded direct and assisted sequences replay to identical state with finite normalized orientation", () => {
  const a = flight(500), b = { ...a }; let seed = 19;
  for (let tick = 0; tick < 600; tick++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const input = command({ right: (seed & 255) / 127.5 - 1, forward: ((seed >>> 8) & 255) / 127.5 - 1,
      yaw: ((seed >>> 16) & 255) / 127.5 - 1, climb: tick % 90 < 30 ? 1 : tick % 90 < 60 ? -1 : 0, direct: tick % 140 < 90, brake: tick % 140 >= 120 });
    stepHelicopter(a, input, def, sky); stepHelicopter(b, input, def, sky);
    if (tick % 30 === 0) { expect(a).toEqual(b); for (const value of Object.values(a)) if (typeof value === "number") expect(Number.isFinite(value)).toBe(true); }
  }
  expect(a.fuel).toBeLessThan(spec.fuelCapacity); expect(TICK_DT).toBe(1 / 30);
});
