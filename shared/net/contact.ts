// A bounded current-tick contact neighbourhood, independent of render interpolation and view deltas.
import { BitWriter, type BitReader } from './codec.ts';
import { BUTTON_BITS, readBody, writeBody } from './protocol.ts';
import { Body } from '../sim/character.ts';
import { dynamicState, type DynamicResponse, type DynamicState } from '../sim/vehicle-dynamic.ts';

export const MAX_CONTACT_PROXIES = 16;
export const CONTACT_HEADER_BITS = 71;
const encodedProxy = new BitWriter(512);
const mechanicalFloats = ['vehicleYaw', 'vehiclePitch', 'vehicleRoll', 'steering', 'wheelAngle', 'fuel',
  'vehicleGroundPitch', 'vehicleGroundRoll', 'vehicleRideOffset', 'vehicleRideVelocity', 'vehicleRpm',
  'vehicleShiftTime', 'vehicleRotorRpm', 'vehicleRotorPhase', 'vehicleEngineCondition', 'vehicleRotorCondition',
  'vehicleCollective', 'vehicleHullCondition'] as const;
export interface ContactProxy {
  handle: number; epoch: number; kind: number; response: DynamicResponse; vehicle: boolean; grounded: boolean;
  mass: number; radius: number; height: number; state: DynamicState; body: Body;
  /** The last authority-applied controls may be held briefly; future decisions and damage remain unknown. */
  native: boolean; pilot: boolean; tamed: boolean; moveX: number; moveZ: number; yaw: number; pitch: number; buttons: number;
}
export function contactProxy(): ContactProxy {
  return { handle: 0, epoch: 0, kind: 0, response: 'dynamic', vehicle: false, grounded: false,
    mass: 1, radius: .4, height: 1.8, state: dynamicState(), body: new Body(),
    native: false, pilot: false, tamed: false, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 };
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
  w.u32(p.handle); w.u32(p.epoch);
  w.bits(p.response === 'fixed' ? 2 : p.response === 'protected' ? 1 : 0, 2);
  w.f32(p.mass); w.u16(Math.round(p.radius * 1024)); w.u16(Math.round(p.height * 1024));
  w.bool(p.native); w.bool(p.pilot); w.bool(p.tamed);
  w.sbits(p.moveX, 8); w.sbits(p.moveZ, 8); w.u16(p.yaw); w.sbits(p.pitch, 16); w.bits(p.buttons, BUTTON_BITS);
  writeBody(w, p.body);
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
    // Preflight each variable-size Body before touching the packet. Even a nearly full packet remains valid.
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
export function readContacts(r: BitReader, out: ContactSnapshot, tick: number): boolean {
  out.tick = tick; out.count = 0; out.truncated = false; out.owner = out.epoch = 0;
  if (!r.bool()) return !r.overflow;
  out.owner = r.u32(); out.epoch = r.u32(); out.count = r.bits(5); out.truncated = r.bool();
  if (out.count > MAX_CONTACT_PROXIES) return false;
  for (let i = 0; i < out.count; i++) {
    const p = out.rows[i]!, s = p.state;
    p.handle = r.u32(); p.epoch = r.u32();
    const response = r.bits(2);
    if (response > 2) return false;
    p.response = response === 2 ? 'fixed' : response === 1 ? 'protected' : 'dynamic';
    p.mass = r.f32(); p.radius = r.u16() / 1024; p.height = r.u16() / 1024;
    p.native = r.bool(); p.pilot = r.bool(); p.tamed = r.bool();
    p.moveX = r.sbits(8); p.moveZ = r.sbits(8); p.yaw = r.u16(); p.pitch = r.sbits(16); p.buttons = r.bits(BUTTON_BITS);
    readBody(r, p.body);
    p.kind = p.body.kind; p.vehicle = p.body.vehicle; p.grounded = p.body.grounded;
    contactBody(p.body, s);
    if (p.vehicle) for (const key of mechanicalFloats) if (!Number.isFinite(p.body[key])) return false;
    const norm = s.qx * s.qx + s.qy * s.qy + s.qz * s.qz + s.qw * s.qw;
    if (!(p.mass > 0 && p.radius > 0 && p.height > 0 && norm > .9 && norm < 1.1) ||
        ![s.x, s.y, s.z, s.vx, s.vy, s.vz, s.yaw, s.pitchRate, s.yawRate, s.rollRate, s.payloadMass, s.flooding, s.steering, p.mass].every(Number.isFinite)) return false;
  }
  return !r.overflow;
}
