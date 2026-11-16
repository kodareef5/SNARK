// A moored landmark's reversible deployment, shared by authority and every viewing distance. No propulsion.
import { TICK_RATE } from "../coords.ts";
import type { BitReader, BitWriter } from "../net/codec.ts";
import { validateSailVisualRig, type SailVisualRig } from "./sail-rig.ts";

export const SAIL_TRAVEL_TICKS = 18 * TICK_RATE;
export const MAX_SAIL_GROUPS = 128;
const UNITS = 65535;
const FORMAT = 1;
const STATE_BYTES = 27;

export interface SailTransition {
  readonly from: number;
  readonly target: 0 | 1;
  readonly startedAt: number;
}

/** Frame is the yacht datum, not the control's position; yaw is a native 65536-unit turn. */
export interface SailState extends SailTransition {
  readonly ref: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface SailSource {
  states(): readonly SailState[];
  tick(): number;
}

/** Authored control transform relative to the landmark datum, and its independently drawn cloth rig. */
export interface SailControlDefinition {
  readonly group: string;
  readonly at: readonly [number, number, number];
  readonly yaw: number;
  readonly rig: SailVisualRig;
}

export function validateSailControl(value: SailControlDefinition): readonly string[] {
  if (!value || typeof value !== "object") return ["sails must describe a control and visual rig"];
  const errors: string[] = [];
  if (typeof value.group !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.group)) errors.push("sails.group must name a bounded landmark group");
  if (!Array.isArray(value.at) || value.at.length !== 3 || value.at.some(n => !Number.isFinite(n) || Math.abs(n) > 128)) errors.push("sails.at must be three finite local metres within 128 m");
  if (!Number.isInteger(value.yaw) || value.yaw < 0 || value.yaw > 65535) errors.push("sails.yaw must be a native turn from 0 to 65535");
  errors.push(...validateSailVisualRig(value.rig));
  return errors;
}

/** Signed modular elapsed holds the starting pose if a packet arrives just ahead of the viewer's clock. */
export function sailsProgress(state: SailTransition, tick: number): number {
  if (state.from === state.target || !Number.isFinite(tick)) return state.from;
  const whole = Math.floor(tick), elapsed = Math.max(0, (((whole >>> 0) - state.startedAt) | 0) + tick - whole);
  const move = elapsed / SAIL_TRAVEL_TICKS;
  return state.target === 1 ? Math.min(1, state.from + move) : Math.max(0, state.from - move);
}

/** Quantize once at authority changes, so authority, saved state and viewers evaluate the same curve. */
export function sailTransition(from: number, target: 0 | 1, tick: number): SailTransition {
  return { from: Math.round(Math.max(0, Math.min(1, from)) * UNITS) / UNITS, target, startedAt: Math.floor(tick) >>> 0 };
}

export function encodeSailTransition(state: SailTransition): Uint8Array {
  const data = new Uint8Array(8), v = new DataView(data.buffer);
  v.setUint8(0, FORMAT); v.setUint16(1, Math.round(state.from * UNITS), true);
  v.setUint8(3, state.target); v.setUint32(4, state.startedAt, true);
  return data;
}

/** Unknown versions and malformed saves remain unread; callers must retain their original bytes. */
export function decodeSailTransition(data: Uint8Array): SailTransition | null {
  if (data.length !== 8 || data[0] !== FORMAT || data[3]! > 1) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { from: v.getUint16(1, true) / UNITS, target: v.getUint8(3) as 0 | 1, startedAt: v.getUint32(4, true) };
}

/** Complete authoritative collection, including empty: removal cannot leave a phantom sail assembly. */
export function writeSails(w: BitWriter, states: readonly SailState[]): void {
  w.u8(FORMAT); w.u16(states.length);
  for (const s of states) {
    w.u32(s.ref); w.u16(s.kind); w.f32(s.x); w.f32(s.y); w.f32(s.z); w.u16(s.yaw);
    w.u16(Math.round(s.from * UNITS)); w.u8(s.target); w.u32(s.startedAt);
  }
}

/** Parse atomically, with exact length and a bounded count; an invalid packet changes no scene state. */
export function readSails(r: BitReader, valid: (kind: number, ref: number, x: number, y: number, z: number) => boolean): readonly SailState[] | null {
  const version = r.u8(), count = r.u16();
  if (r.overflow || version !== FORMAT || count > MAX_SAIL_GROUPS || r.remainingBits !== count * STATE_BYTES * 8) return null;
  const states: SailState[] = [], refs = new Set<number>();
  for (let i = 0; i < count; i++) {
    const ref = r.u32(), kind = r.u16(), x = r.f32(), y = r.f32(), z = r.f32(), yaw = r.u16();
    const from = r.u16() / UNITS, target = r.u8(), startedAt = r.u32();
    if (target > 1 || ![x, y, z].every(Number.isFinite) || refs.has(ref) || !valid(kind, ref, x, y, z)) return null;
    refs.add(ref); states.push(Object.freeze({ ref, kind, x, y, z, yaw, from, target: target as 0 | 1, startedAt }));
  }
  return r.overflow ? null : Object.freeze(states);
}
