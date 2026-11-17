// A bounded current-tick contact neighbourhood, independent of render interpolation and view deltas.
import { BitWriter, type BitReader } from './codec.ts';
import { handleGen, handleIndex } from '../ids.ts';
import { CHUNK_SIZE, MAX_CHUNKS_PER_AXIS, WORLD_MIN_Y, WORLD_MAX_Y } from '../coords.ts';
import type { VehicleDefinition } from '../sim/vehicle.ts';
import { Body } from '../sim/character.ts';
import { dynamicState, type DynamicResponse, type DynamicState } from '../sim/vehicle-dynamic.ts';

export const MAX_CONTACT_PROXIES = 16;
export const CONTACT_HEADER_BITS = 71;
const encodedProxy = new BitWriter(512);
/** Only observable pose and suspension state. Never serialize Body, controls, inventory mass or health. */
export const CONTACT_LINEAR = ['x', 'y', 'z', 'vx', 'vy', 'vz'] as const;
export const CONTACT_MECHANICAL = ['vehicleYaw', 'vehiclePitch', 'vehicleRoll', 'vehicleQx', 'vehicleQy', 'vehicleQz', 'vehicleQw',
  'vehiclePitchRate', 'vehicleYawRate', 'vehicleRollRate', 'steering', 'vehicleGroundPitch', 'vehicleGroundRoll',
  'vehicleRideOffset', 'vehicleRideVelocity'] as const;
const neutral = new Body();
export interface ContactProxy {
  handle: number; epoch: number; kind: number; response: DynamicResponse; vehicle: boolean; grounded: boolean;
  /** Public nominal mass, not the target's inventory/flooding-dependent authoritative mass. */
  mass: number; radius: number; height: number; state: DynamicState; body: Body;
}
export function contactProxy(): ContactProxy {
  return { handle: 0, epoch: 0, kind: 0, response: 'dynamic', vehicle: false, grounded: false,
    mass: 1, radius: .4, height: 1.8, state: dynamicState(), body: new Body() };
}
export function publicContactBody(source: Body, out: Body): void {
  out.copy(neutral);
  out.kind = source.kind; out.vehicle = source.vehicle; out.grounded = source.grounded;
  for (const key of CONTACT_LINEAR) out[key] = source[key];
  if (source.vehicle) for (const key of CONTACT_MECHANICAL) out[key] = source[key];
}
/** Unknown fast controllers, air/water movement and stale crossings wait for authority. */
export function contactHorizon(p: ContactProxy): number {
  if (p.vehicle || p.response === 'fixed') return 12;
  if (!p.grounded || Math.abs(p.body.vy) > 1) return 0;
  const speed2 = p.body.vx * p.body.vx + p.body.vz * p.body.vz;
  return speed2 < .01 ? 12 : speed2 <= 4 ? 6 : 0;
}
export function contactReach(def: VehicleDefinition): number {
  const { halfWidth: x, halfLength: z } = def.spec;
  return Math.max(Math.sqrt(x * x + z * z), def.movement === 'rotor' ? 7 : 0);
}
/** Conservative swept corridor. Off-road bystanders need no special packet or replay. */
export function contactRelevant(a: Pick<Body, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz'>, b: ContactProxy, reach: number): boolean {
  const x = b.body.x - a.x, z = b.body.z - a.z, vx = b.body.vx - a.vx, vz = b.body.vz - a.vz;
  const t = Math.max(0, Math.min(.5, -(x * vx + z * vz) / Math.max(.001, vx * vx + vz * vz)));
  const r = reach + b.radius + 2;
  return (x + vx * t) * (x + vx * t) + (z + vz * t) * (z + vz * t) <= r * r &&
    Math.abs(b.body.y - a.y + (b.body.vy - a.vy) * t) < b.height + reach + 2;
}
export class ContactSnapshot {
  tick = 0; owner = 0; epoch = 0; count = 0; truncated = false;
  readonly rows = Array.from({ length: MAX_CONTACT_PROXIES }, contactProxy);
}

/** Update the rigid projection after decoding or stepping an ordinary Body. */
export function contactBody(b: Body, s: DynamicState): void {
  s.x = b.x; s.y = b.y; s.z = b.z; s.vx = b.vx; s.vy = b.vy; s.vz = b.vz;
  s.yaw = b.vehicle ? b.vehicleYaw : b.yaw * Math.PI / 32768;
  s.pitch = b.vehiclePitch; s.roll = b.vehicleRoll;
  s.qx = b.vehicle ? b.vehicleQx : 0; s.qy = b.vehicle ? b.vehicleQy : 0;
  s.qz = b.vehicle ? b.vehicleQz : 0; s.qw = b.vehicle ? b.vehicleQw : 1;
  s.pitchRate = b.vehicle ? b.vehiclePitchRate : 0;
  s.yawRate = b.vehicle ? b.vehicleYawRate : 0; s.rollRate = b.vehicle ? b.vehicleRollRate : 0;
  s.payloadMass = b.vehiclePayloadMass; s.flooding = b.vehicleFlooding; s.steering = b.steering;
}
function writeProxy(w: BitWriter, p: ContactProxy): void {
  w.u32(p.handle); w.u32(p.epoch); w.u16(p.kind);
  w.bits(p.response === 'fixed' ? 2 : p.response === 'protected' ? 1 : 0, 2);
  w.bool(p.vehicle); w.bool(p.grounded);
  // Shapes use the authority's doubles: rounding a capsule changes grazing-contact and wall separation results.
  w.f64(p.mass); w.f64(p.radius); w.f64(p.height);
  for (const key of CONTACT_LINEAR) w.f32(p.body[key]);
  if (p.vehicle) for (const key of CONTACT_MECHANICAL) w.f32(p.body[key]);
}
export function writeContacts(w: BitWriter, snapshot: ContactSnapshot, budgetBits: number): void {
  const start = w.pos;
  const active = snapshot.owner !== 0 && budgetBits >= CONTACT_HEADER_BITS;
  w.bool(active);
  if (!active) return;
  w.u32(snapshot.owner); w.u32(snapshot.epoch);
  const header = w.pos;
  w.bits(0, 5); w.bool(false);
  let count = 0;
  const limit = Math.min(MAX_CONTACT_PROXIES, snapshot.count);
  for (; count < limit; count++) {
    encodedProxy.reset();
    writeProxy(encodedProxy, snapshot.rows[count]!);
    // Preflight each public contact row before touching the packet. Even a nearly full packet remains valid.
    if (encodedProxy.overflow || w.pos - start + encodedProxy.pos > budgetBits) break;
    const bytes = encodedProxy.pos >>> 3;
    for (let i = 0; i < bytes; i++) w.u8(encodedProxy.buf[i]!);
    const tail = encodedProxy.pos & 7;
    if (tail) w.bits(encodedProxy.buf[bytes]!, tail);
  }
  const end = w.pos;
  // The reserved header was zero; fill it without discarding the already-written rows.
  w.pos = header; w.bits(count, 5); w.bool(snapshot.truncated || count < snapshot.count); w.pos = end;
}
/** Validate before a spatial query can see the row. Bounds include ordinary edge contact skin. */
export function readContacts(r: BitReader, out: ContactSnapshot, tick: number, sizeX = CHUNK_SIZE * MAX_CHUNKS_PER_AXIS, sizeZ = CHUNK_SIZE * MAX_CHUNKS_PER_AXIS): boolean {
  out.tick = tick; out.count = 0; out.truncated = false; out.owner = out.epoch = 0;
  if (!r.bool()) return !r.overflow;
  out.owner = r.u32(); out.epoch = r.u32(); out.count = r.bits(5); out.truncated = r.bool();
  if (!handleGen(out.owner) || out.count > MAX_CONTACT_PROXIES) return false;
  for (let i = 0; i < out.count; i++) {
    const p = out.rows[i]!, b = p.body;
    p.handle = r.u32(); p.epoch = r.u32(); p.kind = r.u16();
    if (!handleGen(p.handle) || handleIndex(p.handle) === handleIndex(out.owner)) return false;
    for (let j = 0; j < i; j++) if (handleIndex(out.rows[j]!.handle) === handleIndex(p.handle)) return false;
    const response = r.bits(2);
    if (response > 2) return false;
    p.response = response === 2 ? 'fixed' : response === 1 ? 'protected' : 'dynamic';
    p.vehicle = r.bool(); p.grounded = r.bool();
    p.mass = r.f64(); p.radius = r.f64(); p.height = r.f64();
    b.copy(neutral); b.kind = p.kind; b.vehicle = p.vehicle; b.grounded = p.grounded;
    for (const key of CONTACT_LINEAR) b[key] = r.f32();
    if (p.vehicle) for (const key of CONTACT_MECHANICAL) b[key] = r.f32();
    if (!(p.mass >= 1 && p.mass <= 1e6 && p.radius >= .01 && p.radius <= 64 && p.height >= .01 && p.height <= 128) ||
        !(b.x >= -1 && b.x <= sizeX + 1 && b.z >= -1 && b.z <= sizeZ + 1 && b.y >= WORLD_MIN_Y && b.y <= WORLD_MAX_Y) ||
        !(Math.abs(b.vx) <= 256 && Math.abs(b.vy) <= 256 && Math.abs(b.vz) <= 256)) return false;
    if (p.vehicle) {
      for (const key of CONTACT_MECHANICAL) if (!Number.isFinite(b[key]) || Math.abs(b[key]) > 128) return false;
      const norm = b.vehicleQx * b.vehicleQx + b.vehicleQy * b.vehicleQy + b.vehicleQz * b.vehicleQz + b.vehicleQw * b.vehicleQw;
      if (!(norm > .999 && norm < 1.001) || Math.abs(b.vehicleRideOffset) > 2 || Math.abs(b.vehicleRideVelocity) > 64 ||
          Math.abs(b.steering) > Math.PI || Math.abs(b.vehicleGroundPitch) > Math.PI || Math.abs(b.vehicleGroundRoll) > Math.PI || Math.abs(b.vehiclePitchRate) > 64 || Math.abs(b.vehicleYawRate) > 64 || Math.abs(b.vehicleRollRate) > 64) return false;
    }
    contactBody(b, p.state);
  }
  return !r.overflow;
}
