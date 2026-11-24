// A vehicle's saved mechanics: a component of its record (`rec.extra`), its layout by the way it moves, how a vehicle
// never saved starts, and how a saved one is read back, clamped to its definition as settings have it now.

import { detAtan2, TAU } from "../../shared/math/scalar.ts";
import type { Body } from "../../shared/sim/character.ts";
import { isBoatVehicle, isRotorVehicle, isWheelVehicle, type VehicleDefinition } from "../../shared/sim/vehicle.ts";
import type { EntityRecord } from "../records.ts";

/** Namespaced extension, preserved by the normal record codec even in builds without vehicles. */
export const VEHICLE_COMPONENT = 0x757262;
/** A single optional byte for a parked vehicle’s warning lights, independent of the saved chassis layout. */
export const PATROL_LAMPS = 0x6c616d;
/**
 * The saved component, little-endian: a version u8 (8 wheeled, 5 rotor, 9 boat), these fields as f32 in this order and
 * whether it stands on its wheels u8, then its mechanical/attitude fields as f32 and whether its engine runs u8.
 */
const VEHICLE_FIELDS = ["vehicleYaw", "vehiclePitch", "vehicleRoll", "steering", "wheelAngle", "fuel", "vehicleYawRate", "vehiclePitchRate", "vehicleRollRate", "vehicleGroundPitch", "vehicleGroundRoll", "vehicleRideOffset", "vehicleRideVelocity", "vx", "vy", "vz", "vehicleGear", "vehicleRpm", "vehicleShiftTime", "vehiclePayloadMass"] as const;
const ROTOR_FIELDS = ["vehicleRotorRpm", "vehicleRotorPhase", "vehicleEngineCondition", "vehicleRotorCondition", "vehicleQx", "vehicleQy", "vehicleQz", "vehicleQw", "vehicleCollective"] as const;
const HULL_FIELDS = ["vehicleEngineCondition", "vehicleQx", "vehicleQy", "vehicleQz", "vehicleQw", "vehicleFlooding", "vehicleHullCondition"] as const;
const BASE_BYTES = 2 + VEHICLE_FIELDS.length * 4;
const formOf = (movement: VehicleDefinition['movement']): { version: number; extra: readonly (typeof ROTOR_FIELDS[number] | typeof HULL_FIELDS[number])[] } =>
  movement === 'rotor' ? { version: 5, extra: ROTOR_FIELDS } : movement === 'boat' ? { version: 9, extra: HULL_FIELDS } : { version: 8, extra: HULL_FIELDS };

/** A vehicle body as one never saved starts: at rest, full of fuel, its engine off, facing the way the body faced. */
export function startVehicle(b: Body, definition: VehicleDefinition): void {
  b.vehicle = true;
  for (const field of VEHICLE_FIELDS) b[field] = 0;
  b.vehicleYaw = b.yaw * TAU / 65536;
  b.grounded = !isBoatVehicle(definition);
  b.fuel = definition.spec.fuelCapacity;
  b.vehicleRpm = isWheelVehicle(definition) ? definition.spec.drivetrain?.idleRpm ?? 0 : 0;
  b.vehicleRotorRpm = b.vehicleRotorPhase = 0;
  b.vehicleEngineCondition = b.vehicleRotorCondition = 1;
  b.vehicleEngineOn = false;
  b.vehicleHullCondition = 1; b.vehicleFlooding = 0;
  b.vehicleQx = b.vehicleQz = b.vehicleCollective = 0;
  b.vehicleQy = Math.fround(Math.sin(b.vehicleYaw / 2)); b.vehicleQw = Math.fround(Math.cos(b.vehicleYaw / 2));
}

/** Reads a saved component into `b`, clamped to the current definition, which settings may have retuned. */
export function restoreVehicle(b: Body, pid: number, saved: Uint8Array, definition: VehicleDefinition): void {
  const { version, extra } = formOf(definition.movement), size = BASE_BYTES + extra.length * 4 + 1;
  if (saved[0] !== version || saved.length !== size) throw new Error(`vehicle ${pid}: its saved state is version ${saved[0]} in ${saved.length} bytes, and this build reads version ${version} in ${size}`);
  const view = new DataView(saved.buffer, saved.byteOffset, saved.byteLength);
  const values = VEHICLE_FIELDS.map((_, i) => view.getFloat32(1 + i * 4, true));
  const rotor = extra.map((_, i) => view.getFloat32(BASE_BYTES + i * 4, true));
  if (!values.every(Number.isFinite) || !rotor.every(Number.isFinite) || saved[BASE_BYTES - 1]! > 1 || saved[saved.length - 1]! > 1) throw new Error(`vehicle ${pid}: its saved state is unreadable`);
  for (let i = 0; i < VEHICLE_FIELDS.length; i++) b[VEHICLE_FIELDS[i]!] = values[i]!;
  b.grounded = saved[BASE_BYTES - 1]! !== 0;
  const clampTo = (v: number, lo: number, hi: number): number => Math.fround(Math.min(hi, Math.max(lo, v)));
  const train = isWheelVehicle(definition) ? definition.spec.drivetrain : undefined;
  const spec = definition.spec, travel = isWheelVehicle(definition) ? definition.spec.suspensionTravel ?? .18 : 0;
  const normal = isBoatVehicle(definition) ? .9 : definition.spec.minGroundNormal;
  const grade = detAtan2(Math.sqrt(1 - normal * normal), normal);
  const wrapped = (v: number): number => { const a = v % TAU; return Math.fround(a - Math.floor((a + TAU / 2) / TAU) * TAU); };
  b.vehicleYaw = wrapped(b.vehicleYaw); b.wheelAngle = wrapped(b.wheelAngle);
  b.vehiclePitch = wrapped(b.vehiclePitch);
  b.vehicleRoll = wrapped(b.vehicleRoll);
  b.vehicleGroundPitch = clampTo(b.vehicleGroundPitch, -grade, grade);
  b.vehicleGroundRoll = clampTo(b.vehicleGroundRoll, -grade, grade);
  const steer = isRotorVehicle(definition) ? 0 : definition.spec.maxSteer;
  b.steering = clampTo(b.steering, -steer, steer);
  b.vehicleYawRate = clampTo(b.vehicleYawRate, -12, 12);
  b.vehiclePitchRate = clampTo(b.vehiclePitchRate, -12, 12);
  b.vehicleRollRate = clampTo(b.vehicleRollRate, -12, 12);
  b.vehicleRideOffset = clampTo(b.vehicleRideOffset, -Math.min(travel * 0.65, spec.clearance * 0.65), travel);
  b.vehicleRideVelocity = clampTo(b.vehicleRideVelocity, -60, 60);
  // Engine/cruise speed is a powered target, not a limit on downhill, impact or dive momentum, including boats.
  b.vx = clampTo(b.vx, -120, 120); b.vy = clampTo(b.vy, -100, 100); b.vz = clampTo(b.vz, -120, 120);
  b.fuel = clampTo(b.fuel, 0, definition.spec.fuelCapacity);
  b.vehicleGear = Math.round(clampTo(b.vehicleGear, -1, isBoatVehicle(definition) ? 1 : train?.forwardRatios.length ?? 12));
  b.vehicleRpm = clampTo(b.vehicleRpm, 0, isBoatVehicle(definition) ? definition.spec.maxRpm : train?.redlineRpm ?? 32767);
  b.vehicleShiftTime = clampTo(b.vehicleShiftTime, 0, isBoatVehicle(definition) ? definition.spec.shiftDelay : train?.shiftCooldown ?? 1);
  // Payload is recomputed from records right after loading.
  b.vehiclePayloadMass = 0;
  if (isRotorVehicle(definition)) {
    b.vehicleRotorRpm = clampTo(rotor[0]!, 0, definition.spec.rotorRpm);
    b.vehicleRotorPhase = wrapped(rotor[1]!);
    b.vehicleEngineCondition = clampTo(rotor[2]!, 0, 1);
    b.vehicleRotorCondition = clampTo(rotor[3]!, 0, 1);
    b.vehicleEngineOn = saved[size - 1] === 1;
    const norm = Math.hypot(rotor[4]!, rotor[5]!, rotor[6]!, rotor[7]!);
    if (norm > 1e-6) {
      b.vehicleQx = Math.fround(rotor[4]! / norm); b.vehicleQy = Math.fround(rotor[5]! / norm);
      b.vehicleQz = Math.fround(rotor[6]! / norm); b.vehicleQw = Math.fround(rotor[7]! / norm);
    } else throw new Error(`vehicle ${pid}: its saved attitude is unreadable`);
    b.vehicleCollective = clampTo(rotor[8]!, 0, 1);
  }
  if (!isRotorVehicle(definition)) {
    b.vehicleEngineCondition = clampTo(rotor[0]!, 0, 1);
    b.vehicleFlooding = clampTo(rotor[5]!, 0, 1);
    b.vehicleHullCondition = clampTo(rotor[6]!, 0, 1);
    b.vehicleEngineOn = saved[size - 1] === 1;
    const norm = Math.hypot(rotor[1]!, rotor[2]!, rotor[3]!, rotor[4]!);
    if (norm > 1e-6) { b.vehicleQx = Math.fround(rotor[1]! / norm); b.vehicleQy = Math.fround(rotor[2]! / norm); b.vehicleQz = Math.fround(rotor[3]! / norm); b.vehicleQw = Math.fround(rotor[4]! / norm); }
    else throw new Error(`vehicle ${pid}: its saved attitude is unreadable`);
  }
  b.yaw = Math.round(b.vehicleYaw * 65536 / TAU) & 65535;
}

/** Writes bodies into their records' components, through one buffer. */
export class VehicleSaver {
  private readonly saving = new Uint8Array(BASE_BYTES + ROTOR_FIELDS.length * 4 + 1);
  private readonly view = new DataView(this.saving.buffer);

  /** Writes `b` as the vehicle component of `rec`. True if that changed what the record holds. */
  write(rec: EntityRecord, b: Body, movement: VehicleDefinition["movement"]): boolean {
    const { version, extra } = formOf(movement);
    const bytes = this.saving.subarray(0, BASE_BYTES + extra.length * 4 + 1), view = this.view;
    bytes[0] = version;
    for (let i = 0; i < VEHICLE_FIELDS.length; i++) view.setFloat32(1 + i * 4, b[VEHICLE_FIELDS[i]!], true);
    bytes[BASE_BYTES - 1] = b.grounded ? 1 : 0;
    if (extra.length) {
      for (let i = 0; i < extra.length; i++) view.setFloat32(BASE_BYTES + i * 4, b[extra[i]!], true);
      bytes[bytes.length - 1] = b.vehicleEngineOn ? 1 : 0;
    }
    const old = rec.extra.get(VEHICLE_COMPONENT);
    if (old?.length === bytes.length && bytes.every((v, i) => old[i] === v)) return false;
    rec.extra.set(VEHICLE_COMPONENT, bytes.slice());
    return true;
  }
}
