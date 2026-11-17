import { expect, test } from "bun:test";
import { HELICOPTER as spec, HELICOPTER_VEHICLE as def } from "../../content/vehicles/helicopter.ts";
import { createHelicopter, stepHelicopter, type HelicopterInput, type HelicopterState, type HelicopterWorld } from "../../shared/sim/helicopter.ts";
import { helicopterImmersion } from "../../shared/sim/helicopter-immersion.ts";
import { stepHelicopterWreck } from "../../shared/sim/helicopter-wreck.ts";

const idle: HelicopterInput = { right: 0, forward: 0, yaw: 0, climb: 0, brake: false, cruise: false, direct: false, pilot: true };
const command: HelicopterInput = { right: 1, forward: -1, yaw: 1, climb: 1, brake: false, cruise: true, direct: true, pilot: true };
const water: HelicopterWorld = { support: () => null, blocked: () => null, waterAt: () => 10 };
const dry: HelicopterWorld = { ...water, waterAt: () => -Infinity };
function flight(y: number): HelicopterState {
  return { ...createHelicopter(spec, 64, y, 64), grounded: false, engineOn: true, rotorRpm: spec.rotorRpm, collective: spec.mass / spec.liftMass };
}

test("a five-metre-per-second ditch keeps finite momentum, stalls on entry and settles into sinking without a float timer", () => {
  const s = flight(10 - spec.clearance + .05);
  s.vx = 5; s.vy = -5;
  let touched = false;
  for (let tick = 0; tick < 2; tick++) { const report = stepHelicopter(s, idle, def, water); touched ||= report.water; }
  expect(touched).toBe(true); expect(s.engineOn).toBe(false);
  expect(s.vx).toBeGreaterThan(3.5); expect(s.vx).toBeLessThan(5);
  const at = s.y;
  for (let tick = 0; tick < 300; tick++) stepHelicopter(s, command, def, water);
  expect(s.y).toBeLessThan(at - 4);
  expect(Math.abs(s.vx)).toBeLessThan(.001);
  expect(s.vy).toBeGreaterThan(-.58); expect(s.vy).toBeLessThan(-.54);
  expect(s.engineOn).toBe(false); expect(s.rotorRpm).toBe(0);
});

test("fully immersed live aircraft and wrecks share finite long-term sinking and passive angular damping", () => {
  const live = flight(0), wreck = { ...live };
  for (const s of [live, wreck]) { s.vx = 5; s.vy = -8; s.vz = -3; s.pitchRate = .7; s.yawRate = -.5; s.rollRate = 1; }
  for (let tick = 0; tick < 3600; tick++) {
    stepHelicopter(live, command, def, water); stepHelicopterWreck(wreck, def, water);
  }
  for (const s of [live, wreck]) {
    expect(s.y).toBeLessThan(-60); expect(s.y).toBeGreaterThan(-75);
    expect(s.vy).toBeCloseTo(-.56, 4);
    expect(Math.abs(s.vx) + Math.abs(s.vz)).toBeLessThan(1e-6);
    expect(Math.abs(s.pitchRate) + Math.abs(s.yawRate) + Math.abs(s.rollRate)).toBeLessThan(1e-6);
    expect(s.engineOn).toBe(false);
    expect(s.qx * s.qx + s.qy * s.qy + s.qz * s.qz + s.qw * s.qw).toBeCloseTo(1, 5);
    for (const value of Object.values(s)) if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  }
});

test("wet cyclic, pedals, collective and recovery cannot add aircraft control torque or rotor lift", () => {
  const neutral = flight(0), commanded = { ...neutral }, recovery = { ...neutral };
  neutral.vy = commanded.vy = recovery.vy = -2;
  neutral.rollRate = commanded.rollRate = recovery.rollRate = .8;
  for (let tick = 0; tick < 60; tick++) {
    stepHelicopter(neutral, idle, def, water);
    stepHelicopter(commanded, command, def, water);
    stepHelicopter(recovery, { ...command, brake: true, pilot: false }, def, water);
    expect(commanded).toEqual(neutral); expect(recovery).toEqual(neutral);
  }
  expect(neutral.y).toBeLessThan(0);
  // Spinning rotors cannot launch from solid support under water either.
  const grounded = { ...flight(0), grounded: true, collective: 1 };
  stepHelicopter(grounded, command, def, { ...water, support: () => ({ y: 0, pitch: 0, roll: 0 }) });
  expect(grounded.grounded).toBe(true); expect(grounded.y).toBe(0);
});

test("immersion follows an inverted hull above the surface and transitions smoothly instead of a half-submerged switch", () => {
  const inverted = flight(11), upright = { ...inverted };
  inverted.qx = 1; inverted.qw = 0; inverted.vx = upright.vx = 5; inverted.vy = upright.vy = -5;
  expect(helicopterImmersion(inverted, spec, 10)).toBeGreaterThan(.5);
  expect(helicopterImmersion(upright, spec, 10)).toBe(0);
  expect(stepHelicopter(inverted, command, def, water).water).toBe(true);
  expect(stepHelicopter(upright, idle, def, water).water).toBe(false);
  expect(inverted.y).toBeGreaterThan(10); expect(inverted.vx).toBeLessThan(upright.vx);
  const partial = flight(10 - spec.clearance - (spec.height - spec.clearance) * .49), more = { ...partial, y: partial.y - .02 * (spec.height - spec.clearance) };
  partial.vx = more.vx = 5; partial.vy = more.vy = -3;
  stepHelicopterWreck(partial, def, water); stepHelicopterWreck(more, def, water);
  expect(Math.abs(partial.vx - more.vx)).toBeLessThan(.03);
  expect(Math.abs(partial.vy - more.vy)).toBeLessThan(.03);
});

test("water support is bounded by the empty hull displacement so cargo increases the eventual sinking speed", () => {
  const light = flight(0), heavy = { ...light, payloadMass: spec.mass };
  for (let tick = 0; tick < 300; tick++) { stepHelicopter(light, idle, def, water); stepHelicopter(heavy, idle, def, water); }
  expect(light.vy).toBeCloseTo(-.56, 4);
  expect(heavy.vy).toBeCloseTo(-2.28, 4);
  expect(heavy.y).toBeLessThan(light.y - 10);
});

test("a finite water plane below the aircraft leaves dry controls and motion identical to open air", () => {
  const a = flight(100), b = { ...a };
  for (let tick = 0; tick < 180; tick++) {
    const input = tick < 90 ? idle : { ...idle, forward: .5, right: .25 };
    stepHelicopter(a, input, def, dry); stepHelicopter(b, input, def, water);
    expect(b).toEqual(a);
  }
});

test("a solid contact rollback cannot restore a running engine after water entry in the same tick", () => {
  const s = flight(10 - spec.clearance + .05); s.vx = 5; s.vy = -5;
  let queries = 0;
  const report = stepHelicopter(s, idle, def, { ...water, blocked: () => ++queries === 2 ? { reason: "waterline-wall", rotor: false, nx: 1, ny: 0, nz: 0 } : null });
  expect(report.blocked).toBe("waterline-wall"); expect(report.water).toBe(true);
  expect(s.engineOn).toBe(false); expect(s.engineRpm).toBe(0);
});
