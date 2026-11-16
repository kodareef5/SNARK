// Observer precision is independent of the driver's complete f32 flight state.
import { clamp, TAU } from "../math/scalar.ts";
import { quatNormalize, type Numbers } from "../math/quat.ts";

/** Rotor speed is rpm, phase radians. Do not interpolate phase by the shortest arc at flight rpm. */
export function packVehicleRotor(rpm: number, phase: number): number {
  const turn = ((phase % TAU) + TAU) % TAU;
  return ((Math.round(turn * 65536 / TAU) & 65535) | (Math.round(clamp(rpm, 0, 4095)) << 16)) >>> 0;
}
export const unpackRotorRpm = (n: number): number => (n >>> 16) & 4095;
export const unpackRotorPhase = (n: number): number => (n & 65535) * TAU / 65536;

/** Fuel as a tank fraction, two condition fractions and whether the engine is commanded on. */
export function packVehicleSystems(fuel: number, capacity: number, engine: number, rotor: number, on: boolean): number {
  return (Math.round(clamp(capacity > 0 ? fuel / capacity : 0, 0, 1) * 65535) |
    (Math.round(clamp(engine, 0, 1) * 127) << 16) | (Math.round(clamp(rotor, 0, 1) * 127) << 23) |
    (on ? 1 << 30 : 0)) >>> 0;
}
export const unpackVehicleFuel = (n: number): number => (n & 65535) / 65535;
export const unpackEngineCondition = (n: number): number => ((n >>> 16) & 127) / 127;
export const unpackRotorCondition = (n: number): number => ((n >>> 23) & 127) / 127;
export const vehicleEngineRunning = (n: number): boolean => (n & (1 << 30)) !== 0;

const signed = (n: number): number => Math.round(clamp(n, -1, 1) * 32767) & 65535;
const unsign = (n: number): number => ((n & 32768) ? (n & 65535) - 65536 : n & 65535) / 32767;
/** Two signed quaternion components per word, with no Euler pole or inverted-flight limit. */
export const packVehicleQuaternionPair = (a: number, b: number): number => (signed(a) | (signed(b) << 16)) >>> 0;
export function unpackVehicleQuaternion(a: number, b: number, out: Numbers): void {
  out[0] = unsign(a); out[1] = unsign(a >>> 16); out[2] = unsign(b); out[3] = unsign(b >>> 16);
  quatNormalize(out, 0);
}

/** Estimate forward phase across several turns, then unwrap the endpoint to its physically expected turn. */
export function interpolateRotorPhase(a: number, b: number, rpmA: number, rpmB: number, seconds: number, t: number): number {
  const expected = (rpmA + rpmB) * 0.5 * TAU / 60 * seconds;
  const delta = b - a + Math.round((expected - (b - a)) / TAU) * TAU;
  return a + delta * t;
}
