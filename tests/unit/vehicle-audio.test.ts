import { expect, test } from "bun:test";
import { VehicleTelemetry } from "../../client/core/hud.ts";
import { VehicleSoundState, vehicleSoundTargets } from "../../client/core/audio/vehicle.ts";

test("engine load and grounded slip map to bounded sound; an empty tank or inactive seat is silent", () => {
  const v = new VehicleTelemetry();
  v.active = true; v.fuel = .8; v.rpm = 900;
  const idle = vehicleSoundTargets(v);
  v.rpm = 4800; v.load = 1; v.slip = .8;
  const loaded = vehicleSoundTargets(v);
  expect(loaded.firing).toBeGreaterThan(idle.firing);
  expect(loaded.engine).toBeGreaterThan(idle.engine);
  expect(loaded.tire).toBeGreaterThan(0);
  v.grounded = false; expect(vehicleSoundTargets(v).tire).toBe(0);
  v.fuel = 0; expect(vehicleSoundTargets(v).engine).toBe(0);
  v.active = false; expect(vehicleSoundTargets(v).intake).toBe(0);
  v.rpm = NaN; v.load = Infinity;
  expect(Object.values(vehicleSoundTargets(v)).every(Number.isFinite)).toBe(true);
});

test("playback needs a gesture and running platform, and hiding or leaving cancels audible state", () => {
  const sound = new VehicleSoundState(), v = new VehicleTelemetry();
  v.active = true; v.fuel = 1; v.rpm = 900;
  expect(sound.update(v, true, true)).toBe(null);
  sound.unlock();
  expect(sound.update(v, true, false)).toBe(null);
  expect(sound.update(v, true, true)!.engine).toBeGreaterThan(0);
  sound.measure(new Float32Array([.02, -.02]));
  expect(sound.report.audible).toBe(true); expect(sound.report.rms).toBeCloseTo(.02, 6);
  expect(sound.update(v, false, true)).toBe(null); expect(sound.report.audible).toBe(false);
  sound.update(v, true, true); v.stop();
  expect(sound.update(v, true, true)).toBe(null); expect(sound.report.rms).toBe(0);
  sound.reset(); expect(sound.report.unlocked).toBe(false);
});

test("gearshift sound triggers once and a lifecycle reset cannot replay a stale shift", () => {
  const sound = new VehicleSoundState(), v = new VehicleTelemetry();
  v.active = true; v.fuel = 1; v.rpm = 4000; v.load = 1;
  sound.unlock(); expect(sound.update(v, true, true)!.shift).toBe(false);
  v.gear = 2; expect(sound.update(v, true, true)!.shift).toBe(true);
  expect(sound.update(v, true, true)!.shift).toBe(false);
  sound.mute(); v.gear = 3; expect(sound.update(v, true, true)!.shift).toBe(false);
});
