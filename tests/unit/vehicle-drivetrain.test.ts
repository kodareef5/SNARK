import { expect, test } from "bun:test";
import { ASPHALT, COMPACT } from "../../content/urban/compact.ts";
import { createVehicle, stepVehicle, validateVehicleSpec, type VehicleInput, type VehicleSpec, type VehicleState, type VehicleWorld } from "../../shared/sim/vehicle.ts";
import { drivetrainShifting, engineTorqueAt, stepDrivetrain, validateDrivetrainSpec, vehicleMass, type DrivetrainInput, type VehicleDrivetrainSpec, type VehicleDrivetrainState } from "../../shared/sim/vehicle-drivetrain.ts";

const spec = COMPACT.drivetrain!, dt = 1 / 120;
const flat: VehicleWorld = { support: () => ({ y: 0, normalY: 1, surface: ASPHALT }), blocked: () => null };
const command = (throttle = 0, brake = 0, neutral = false): VehicleInput => ({ throttle, brake, neutral, steer: 0, handbrake: false });
const engineInput = (throttle = 1, forward = 0): DrivetrainInput => ({ throttle, forward, running: true, disengaged: false, neutral: false, wheelRadius: .3 });
const engineState = (): VehicleDrivetrainState => ({ gear: 0, engineRpm: spec.idleRpm, shiftTime: 0, payloadMass: 0 });
function run(s: VehicleState, count: number, input: VehicleInput, p: VehicleSpec = COMPACT): void { for (let i = 0; i < count; i++) stepVehicle(s, input, p, flat); }

// Config tests protect the content boundary, not merely the implementation's current constants.
test("nested drivetrain data rejects missing, nonfinite, unsorted and inconsistent mechanical content", () => {
  expect(() => validateVehicleSpec(COMPACT)).not.toThrow();
  for (const missing of ["wheelRadius", "halfWidth", "brake", "fuelPerSecond"] as const) {
    const incomplete = { ...COMPACT } as Partial<VehicleSpec>; delete incomplete[missing];
    expect(() => validateVehicleSpec(incomplete as VehicleSpec)).toThrow();
  }
  const invalid = [
    null, [], {}, { ...spec, finalDrive: Infinity }, { ...spec, rpmResponse: NaN },
    { ...spec, efficiency: 1.01 }, { ...spec, forwardRatios: [] }, { ...spec, forwardRatios: [2, 3] },
    { ...spec, forwardRatios: [3, 0] }, { ...spec, forwardRatios: [3, undefined] },
    { ...spec, torqueCurve: [[850, 100], [850, 200], [6800, 100]] },
    { ...spec, torqueCurve: [[850, 100], [6800, -1]] },
    { ...spec, torqueCurve: [[900, 100], [6800, 100]] },
    { ...spec, torqueCurve: [[850, 100], [6000, 100]] },
    { ...spec, torqueCurve: [[850, 0], [6800, 0]] },
    { ...spec, torqueCurve: [[850, 100, 20], [6800, 100]] },
    { ...spec, downshiftRpm: spec.upshiftRpm }, { ...spec, shiftDuration: spec.shiftCooldown },
    { ...spec, launchRpm: spec.redlineRpm }, { ...spec, unknownPart: 1 }, { ...spec, toString: 2 },
  ];
  for (const value of invalid) expect(() => validateDrivetrainSpec(value as VehicleDrivetrainSpec)).toThrow();
  expect(() => validateVehicleSpec({ ...COMPACT, mass: 0 })).toThrow();
  expect(() => validateVehicleSpec({ ...COMPACT, mass: Infinity })).toThrow();
});

test("authored torque interpolation and gear multiplication determine actual wheel force", () => {
  const curve = { ...spec, torqueCurve: [[0, 100], [2000, 200], [6800, 100]] as const };
  expect(engineTorqueAt(curve, 1000)).toBe(150);
  expect(engineTorqueAt(curve, 4400)).toBe(150);
  expect(engineTorqueAt(curve, -1)).toBe(100);
  const state = engineState(); state.engineRpm = spec.launchRpm;
  const wheel = stepDrivetrain(state, engineInput(), spec, dt);
  expect(state.gear).toBe(1);
  expect(wheel.drive).toBeCloseTo(engineTorqueAt(spec, spec.launchRpm) * spec.forwardRatios[0]! * spec.finalDrive * spec.efficiency / .3, 8);
  const weaker = { ...spec, torqueCurve: spec.torqueCurve.map(([rpm, torque]) => [rpm, torque * .5] as const) };
  const other = engineState(); other.engineRpm = spec.launchRpm;
  expect(stepDrivetrain(other, engineInput(), weaker, dt).drive).toBeCloseTo(wheel.drive * .5, 8);
});

test("automatic shift cuts wheel torque, then restores it during the anti-hunting cooldown", () => {
  const state = engineState(); state.gear = 1; state.engineRpm = 6000;
  expect(stepDrivetrain(state, engineInput(1, 16), spec, dt).drive).toBe(0);
  expect(state.gear).toBe(2); expect(state.engineRpm).toBeLessThan(6000); expect(state.shiftTime).toBe(spec.shiftCooldown); expect(drivetrainShifting(state.shiftTime, spec)).toBe(true);
  let output = 0;
  for (let i = 0; i < 25; i++) output = stepDrivetrain(state, engineInput(1, 23), spec, dt).drive;
  expect(state.shiftTime).toBeGreaterThan(0); expect(state.gear).toBe(2); expect(output).toBeGreaterThan(0); expect(drivetrainShifting(state.shiftTime, spec)).toBe(false);
  for (let i = 0; i < 65; i++) stepDrivetrain(state, engineInput(1, 23), spec, dt);
  expect(state.gear).toBe(3);
  // Noise at a shift boundary cannot instantly upshift and downshift on alternate substeps.
  const gear = state.gear;
  for (let i = 0; i < 12; i++) stepDrivetrain(state, engineInput(1, i % 2 ? 7 : 23), spec, dt);
  expect(state.gear).toBe(gear);
});

test("reverse first brakes even tiny forward motion and only selects R after a true stop", () => {
  const state = engineState(); state.gear = 1;
  for (const forward of [12, .5, .001]) {
    const result = stepDrivetrain(state, engineInput(-1, forward), spec, dt);
    expect(result.drive).toBe(0); expect(result.opposingBrake).toBe(1); expect(state.gear).toBe(1);
  }
  expect(stepDrivetrain(state, engineInput(-1, 0), spec, dt).drive).toBe(0);
  expect(state.gear).toBe(-1);
  let force = 0;
  for (let i = 0; i < 25; i++) force = stepDrivetrain(state, engineInput(-1, 0), spec, dt).drive;
  expect(force).toBeLessThan(0);
  const car = createVehicle(COMPACT, 0, 0, 0);
  run(car, 45, command(1)); run(car, 180, command(-1));
  expect(car.gear).toBe(-1); expect(car.vz).toBeLessThan(-5); expect(car.vz).toBeGreaterThanOrEqual(-COMPACT.maxReverse);
});

test("neutral free-revs without moving; no fuel removes torque and a stopped empty engine settles to zero rpm", () => {
  const neutral = createVehicle(COMPACT, 0, 0, 0);
  run(neutral, 60, command(1, 0, true));
  expect(neutral.gear).toBe(0); expect(neutral.z).toBe(0); expect(neutral.vz).toBe(0);
  expect(neutral.engineRpm).toBe(spec.redlineRpm); expect(neutral.fuel).toBeLessThan(COMPACT.fuelCapacity);
  const empty = createVehicle(COMPACT, 0, 0, 0, 0, 0);
  run(empty, 60, command(1)); expect(empty.z).toBe(0); expect(empty.engineRpm).toBe(0);
  const lastDrop = createVehicle(COMPACT, 0, 0, 0, 0, .000001);
  run(lastDrop, 60, command(1)); expect(lastDrop.fuel).toBe(0); expect(lastDrop.vz).toBe(0); expect(lastDrop.engineRpm).toBe(0);
});

test("redline and disengaged wheels cannot transmit torque; coast drag opposes travel", () => {
  const state = engineState(); state.gear = 5;
  expect(stepDrivetrain(state, engineInput(1, 100), spec, dt).drive).toBe(0);
  expect(stepDrivetrain(state, { ...engineInput(), disengaged: true }, spec, dt).drive).toBe(0);
  state.gear = 2; state.shiftTime = 0;
  const coast = stepDrivetrain(state, engineInput(0, 14), spec, dt);
  expect(coast.drive).toBe(0); expect(coast.engineDrag).toBeGreaterThan(0);
  const neutral = stepDrivetrain(state, { ...engineInput(0, 14), neutral: true }, spec, dt);
  expect(neutral.engineDrag).toBe(0);
  const overspeed = createVehicle(COMPACT, 0, 0, 0); overspeed.vz = 50;
  run(overspeed, 30, command(1)); expect(overspeed.vz).toBeLessThan(47);
});

test("cargo affects acceleration and fixed brake force without changing the chassis or tyre support", () => {
  const light = createVehicle(COMPACT, 0, 0, 0), loaded = createVehicle(COMPACT, 0, 0, 0);
  loaded.payloadMass = 800;
  expect(vehicleMass(COMPACT, loaded)).toBe(1900);
  run(light, 60, command(1)); run(loaded, 60, command(1));
  expect(loaded.vz).toBeLessThan(light.vz * .8); expect(loaded.z).toBeLessThan(light.z * .8);
  light.vx = loaded.vx = 0; light.vz = loaded.vz = 20; light.z = loaded.z = 0;
  run(light, 120, command(0, 1)); run(loaded, 120, command(0, 1));
  expect(light.vz).toBe(0); expect(loaded.vz).toBe(0); expect(loaded.z).toBeGreaterThan(light.z * 1.35);
  expect(light.grounded).toBe(true); expect(loaded.grounded).toBe(true);
  expect(Math.abs(loaded.rideOffset)).toBeLessThan(COMPACT.clearance);
});

test("large controls clamp identically, nonfinite commands are inert, and mid-shift replay preserves mechanical state", () => {
  const a = createVehicle(COMPACT, 0, 0, 0), b = structuredClone(a);
  run(a, 30, command(1e20)); run(b, 30, command(1)); expect(a).toEqual(b);
  const invalid = createVehicle(COMPACT, 0, 0, 0);
  run(invalid, 30, { throttle: NaN, steer: Infinity, brake: -Infinity, handbrake: false });
  expect(invalid.z).toBe(0); expect(invalid.vz).toBe(0);
  a.payloadMass = 250; let replay: VehicleState | null = null;
  for (let tick = 0; tick < 240; tick++) {
    const input: VehicleInput = { throttle: tick < 180 ? .9 : -1, steer: tick % 90 < 45 ? .15 : -.15, brake: 0, handbrake: tick > 140 && tick < 148, neutral: tick > 120 && tick < 125 };
    stepVehicle(a, input, COMPACT, flat);
    if (replay) { stepVehicle(replay, input, COMPACT, flat); expect(replay).toEqual(a); }
    else if (a.gear > 1 && a.shiftTime > spec.shiftCooldown - spec.shiftDuration) replay = structuredClone(a);
    for (const value of Object.values(a)) if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  }
  expect(replay).not.toBeNull();
});
