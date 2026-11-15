// Deterministic torque converter/automatic transmission seam. Units are kg, N*m, rpm and seconds.
// No input, inventory, presentation or world dependencies: authority and prediction carry the same small state.
import { clamp, TAU } from "../math/scalar.ts";

export interface VehicleDrivetrainSpec {
  readonly torqueCurve: readonly (readonly [rpm: number, torqueNm: number])[];
  readonly idleRpm: number;
  readonly redlineRpm: number;
  /** Converter slip lets an engine produce launch torque before the wheels reach idle rpm. */
  readonly launchRpm: number;
  readonly rpmResponse: number;
  readonly forwardRatios: readonly number[];
  readonly reverseRatio: number;
  readonly finalDrive: number;
  readonly efficiency: number;
  readonly upshiftRpm: number;
  readonly downshiftRpm: number;
  readonly shiftDuration: number;
  /** Includes the torque interruption, then a guard against repeated shifts. */
  readonly shiftCooldown: number;
  readonly engineBrakeNm: number;
}

export interface VehicleDrivetrainState {
  /** -1 reverse, 0 neutral, 1..forwardRatios.length drive. */
  gear: number;
  engineRpm: number;
  /** Seconds remaining before another automatic shift is allowed. */
  shiftTime: number;
  /** Cargo plus occupants, supplied by the same authoritative/predicted body adapter. */
  payloadMass: number;
}

/** Compatible mechanical default for older definitions; new vehicle types should author their own component. */
export const DEFAULT_DRIVETRAIN: VehicleDrivetrainSpec = {
  torqueCurve: [[850, 180], [1800, 280], [3200, 310], [4800, 300], [6200, 270], [6800, 210]],
  idleRpm: 850, redlineRpm: 6800, launchRpm: 2100, rpmResponse: 12000,
  forwardRatios: [3.2, 2.12, 1.55, 1.17, 0.92], reverseRatio: 3.05, finalDrive: 3.9, efficiency: 0.9,
  upshiftRpm: 5800, downshiftRpm: 2050, shiftDuration: 0.16, shiftCooldown: 0.65, engineBrakeNm: 24,
};

function bounded(n: unknown, min: number, max: number): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
}

/** Reject malformed nested content before simulation; no unchecked ratios or curve indexing in a tick. */
export function validateDrivetrainSpec(s: VehicleDrivetrainSpec): void {
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("invalid vehicle drivetrain");
  const limits: Record<string, readonly [number, number]> = {
    idleRpm: [100, 5000], redlineRpm: [200, 30000], launchRpm: [100, 15000], rpmResponse: [100, 100000],
    reverseRatio: [0.05, 30], finalDrive: [0.1, 20], efficiency: [0.05, 1],
    upshiftRpm: [100, 30000], downshiftRpm: [100, 30000], shiftDuration: [0, 3], shiftCooldown: [0.05, 5], engineBrakeNm: [0, 10000],
  };
  for (const [key, [lo, hi]] of Object.entries(limits)) if (!bounded((s as unknown as Record<string, unknown>)[key], lo, hi)) throw new Error(`invalid drivetrain ${key}`);
  for (const key of Object.keys(s)) if (key !== "torqueCurve" && key !== "forwardRatios" && !Object.hasOwn(limits, key)) throw new Error(`unknown drivetrain field ${key}`);
  if (!(s.idleRpm < s.launchRpm && s.launchRpm < s.upshiftRpm && s.upshiftRpm < s.redlineRpm &&
    s.idleRpm < s.downshiftRpm && s.downshiftRpm < s.upshiftRpm && s.shiftDuration < s.shiftCooldown)) throw new Error("inconsistent drivetrain rpm or shift ranges");
  if (!Array.isArray(s.forwardRatios) || s.forwardRatios.length < 1 || s.forwardRatios.length > 10) throw new Error("invalid drivetrain ratios");
  for (let i = 0; i < s.forwardRatios.length; i++) {
    const ratio = s.forwardRatios[i];
    if (!bounded(ratio, 0.05, 30) || (i > 0 && ratio >= s.forwardRatios[i - 1]!)) throw new Error("drivetrain ratios must descend");
  }
  if (!Array.isArray(s.torqueCurve) || s.torqueCurve.length < 2 || s.torqueCurve.length > 32) throw new Error("invalid drivetrain torque curve");
  let positive = false;
  for (let i = 0; i < s.torqueCurve.length; i++) {
    const point = s.torqueCurve[i];
    if (!Array.isArray(point) || point.length !== 2 || !bounded(point[0], 0, 30000) || !bounded(point[1], 0, 10000) ||
      (i > 0 && point[0] <= s.torqueCurve[i - 1]![0])) throw new Error("invalid drivetrain torque sample");
    positive ||= point[1] > 0;
  }
  if (!positive || s.torqueCurve[0]![0] > s.idleRpm || s.torqueCurve[s.torqueCurve.length - 1]![0] < s.redlineRpm) throw new Error("torque curve must cover idle through redline");
}

/** Linear interpolation avoids non-deterministic transcendental approximations. */
export function engineTorqueAt(s: VehicleDrivetrainSpec, rpm: number): number {
  const points = s.torqueCurve;
  if (rpm <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (rpm <= b[0]) return a[1] + (b[1] - a[1]) * (rpm - a[0]) / (b[0] - a[0]);
  }
  return points[points.length - 1]![1];
}

export function vehicleMass(spec: { readonly mass?: number }, state: { readonly payloadMass: number }): number {
  return (spec.mass ?? 1100) + (Number.isFinite(state.payloadMass) ? Math.max(0, state.payloadMass) : 0);
}

export interface DrivetrainInput {
  throttle: number;
  /** Signed chassis speed along its forward axis, metres/second. */
  forward: number;
  wheelRadius: number;
  running: boolean;
  /** Brake, handbrake or airborne: engine can rev, but its torque does not drive the chassis. */
  disengaged: boolean;
  neutral: boolean;
}
export interface DrivetrainForce {
  drive: number;
  /** Positive engine-drag force; caller stops it at zero like other resistance. */
  engineDrag: number;
  /** Signed pedal opposed to travel is a service brake until the car actually stops. */
  opposingBrake: number;
}
const approach = (value: number, target: number, delta: number): number => value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);
const STOP_SPEED = 0.025;

/** Shared mechanical/audio/wire predicate: cooldown after clutch engagement is not a torque interruption. */
export function drivetrainShifting(shiftTime: number, spec: VehicleDrivetrainSpec = DEFAULT_DRIVETRAIN): boolean {
  return shiftTime > spec.shiftCooldown - spec.shiftDuration + 1e-9;
}

/** One fixed physics substep. Gear changes are mechanical state, not a speed-derived HUD effect. */
export function stepDrivetrain(state: VehicleDrivetrainState, input: DrivetrainInput, spec: VehicleDrivetrainSpec, dt: number): DrivetrainForce {
  const throttle = Number.isFinite(input.throttle) ? clamp(input.throttle, -1, 1) : 0;
  const forward = input.forward, speed = Math.abs(forward), pedal = Math.abs(throttle), desired = throttle > 0 ? 1 : throttle < 0 ? -1 : 0;
  const wheelRpm = speed * 60 / (TAU * input.wheelRadius), opposing = desired * forward < 0;
  const result: DrivetrainForce = { drive: 0, engineDrag: 0, opposingBrake: opposing && !input.neutral ? pedal : 0 };
  // Bounds also make a pre-drivetrain save (all-zero state) a valid neutral vehicle.
  if (!Number.isInteger(state.gear) || state.gear < -1 || state.gear > spec.forwardRatios.length) state.gear = 0;
  if (!Number.isFinite(state.engineRpm)) state.engineRpm = 0;
  state.shiftTime = Math.max(0, Math.min(Number.isFinite(state.shiftTime) ? state.shiftTime : 0, spec.shiftCooldown) - dt);
  if (input.neutral) { state.gear = 0; state.shiftTime = 0; }
  else if (desired && !opposing && (state.gear === 0 || Math.sign(state.gear) !== desired)) {
    const previous = state.gear;
    state.gear = desired;
    if (desired > 0) while (state.gear < spec.forwardRatios.length && wheelRpm * spec.forwardRatios[state.gear - 1]! * spec.finalDrive > spec.upshiftRpm) state.gear++;
    // Initial take-up uses the converter; an actual direction reversal interrupts torque after the stop.
    state.shiftTime = previous === 0 ? spec.shiftCooldown - spec.shiftDuration : spec.shiftCooldown;
  }
  if (state.gear > 0 && state.shiftTime === 0 && !opposing && !input.neutral) {
    const rpm = wheelRpm * spec.forwardRatios[state.gear - 1]! * spec.finalDrive;
    const up = spec.idleRpm + (spec.upshiftRpm - spec.idleRpm) * (0.62 + pedal * 0.38);
    if (state.gear < spec.forwardRatios.length && rpm > up) { state.gear++; state.shiftTime = spec.shiftCooldown; }
    else if (state.gear > 1 && rpm < spec.downshiftRpm && wheelRpm * spec.forwardRatios[state.gear - 2]! * spec.finalDrive < up * 0.9) { state.gear--; state.shiftTime = spec.shiftCooldown; }
  }
  const ratio = (state.gear < 0 ? spec.reverseRatio : state.gear > 0 ? spec.forwardRatios[state.gear - 1]! : 0) * spec.finalDrive;
  const shifting = drivetrainShifting(state.shiftTime, spec);
  const coupled = state.gear !== 0 && !shifting && !input.disengaged;
  const linkedRpm = wheelRpm * ratio;
  // During the clutch interruption the controller matches the selected ratio: an upshift drops rpm.
  // Neutral/air/handbrake free revs remain separate from this automatic rev match.
  const target = input.running ? shifting ? Math.max(spec.idleRpm, linkedRpm) : coupled ? Math.max(spec.idleRpm, linkedRpm, spec.idleRpm + pedal * (spec.launchRpm - spec.idleRpm)) : spec.idleRpm + pedal * (spec.redlineRpm - spec.idleRpm) : coupled ? linkedRpm : 0;
  state.engineRpm = approach(clamp(state.engineRpm, 0, spec.redlineRpm), clamp(target, 0, spec.redlineRpm), spec.rpmResponse * dt);
  if (coupled && !opposing) {
    // No fuel, neutral, shift interruption and the rev limiter all remove wheel torque.
    if (input.running && desired === Math.sign(state.gear) && linkedRpm < spec.redlineRpm) result.drive = desired * pedal * engineTorqueAt(spec, state.engineRpm) * ratio * spec.efficiency / input.wheelRadius;
    if (speed > STOP_SPEED) result.engineDrag = spec.engineBrakeNm * clamp(linkedRpm / spec.redlineRpm, 0, 1) * ratio * spec.efficiency / input.wheelRadius * (1 - pedal);
  }
  return result;
}
