// Sparse, authoritative corpse checkpoints. Sent on visibility/meaningful revision, never as per-frame bone snapshots.
import type { CarrierFrame } from "../anim/ragdoll.ts";
import { BitReader, BitWriter } from "./codec.ts";

export const CORPSE_BODIES_MAX = 64;
/** Version, count, flags, fall ticks, five f64 pose values, then the ragdoll's 22*n+13 f64 state. */
export const CORPSE_CHECKPOINT_MAX = 45 + (22 * CORPSE_BODIES_MAX + 13) * 8 + 84;
export const CORPSE_PACKET_MAX = 1 + 12 + 2 + CORPSE_CHECKPOINT_MAX;
/** Namespaced extra component; the normal record codec retains it across restarts. */
export const CORPSE_MOTION_COMPONENT = 0x637270;

export interface CorpseCheckpoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly size: number;
  readonly out: boolean;
  readonly air: boolean;
  readonly awake: boolean;
  /** Immutable bindings use the upright rest pose for a physical launch, otherwise the canonical death pose. */
  readonly standing?: boolean;
  readonly carrier?: CarrierFrame;
  readonly ticks: number;
  readonly state: Float64Array;
}

export interface CorpseMotion {
  readonly revision: number;
  readonly tick: number;
  readonly data: Uint8Array;
}
export interface CorpsePacket extends CorpseMotion { readonly id: number }

const CARRIER = 16;
const COMPACT = 32;
const STILL_MATCHES = 64;
const EXACT = 128;
const POSITION = 2048;
const SPEED = 256;
const ROTATION = 32767;

function header(w: BitWriter, c: CorpseCheckpoint, n: number, flags: number): void {
  w.u8(2); w.u8(n);
  w.u8((c.out ? 1 : 0) | (c.air ? 2 : 0) | (c.awake ? 4 : 0) | (c.standing ? 8 : 0) | (c.carrier ? CARRIER : 0) | flags);
  w.u16(c.ticks);
  w.f64(c.x); w.f64(c.y); w.f64(c.z); w.f64(c.yaw); w.f64(c.size);
  if (c.carrier) {
    const { handle, pose } = c.carrier;
    w.u32(handle);
    for (const v of [pose.x, pose.y, pose.z, pose.qx, pose.qy, pose.qz, pose.qw]) w.f64(v);
    for (const v of [c.carrier.vx, c.carrier.vy, c.carrier.vz, c.carrier.wx, c.carrier.wy, c.carrier.wz]) w.f32(v);
  }
}

function bodyCount(c: CorpseCheckpoint): number {
  const n = (c.state.length - 13) / 22;
  if (!Number.isInteger(n) || n < 1 || n > CORPSE_BODIES_MAX) throw new Error("corpse checkpoint: body count outside budget");
  return n;
}

// Exact scalars use two literal tags (f64, f32) and backward references for repeated values.
function writeExact(w: BitWriter, values: Float64Array): void {
  const seen = new Map<number, number>([[0, 2], [1, 3], [-1, 4]]);
  for (const value of values) {
    if (Object.is(value, -0)) { w.varint(0); w.f64(value); continue; }
    const tag = seen.get(value);
    if (tag !== undefined) { w.varint(tag); continue; }
    const short = Math.fround(value) === value;
    w.varint(short ? 1 : 0);
    if (short) w.f32(value);
    else w.f64(value);
    seen.set(value, seen.size + 2);
  }
}

function readExact(r: BitReader, values: Float64Array): boolean {
  const seen = [0, 1, -1];
  for (let i = 0; i < values.length; i++) {
    const tag = r.varint();
    if (tag >= seen.length + 2) return false;
    if (tag >= 2) values[i] = seen[tag - 2]!;
    else {
      const value = tag === 1 ? r.f32() : r.f64();
      values[i] = value;
      if (!Object.is(value, -0)) seen.push(value);
    }
  }
  return !r.overflow;
}

/** Exact state for saves, late arrivals and physics outside the short range. */
export function encodeCorpseCheckpoint(c: CorpseCheckpoint): Uint8Array {
  const n = bodyCount(c), w = new BitWriter(45 + c.state.length * 8 + (c.carrier ? 84 : 0));
  header(w, c, n, EXACT);
  writeExact(w, c.state);
  if (!w.overflow && w.byteLength < w.buf.length) return w.bytes().slice();
  w.reset();
  header(w, c, n, 0);
  for (const value of c.state) w.f64(value);
  return w.bytes();
}

/** A published revision rounds its state in place. Authority and watchers resume these same values. */
export function packCorpseCheckpoint(c: CorpseCheckpoint): Uint8Array {
  const n = bodyCount(c), s = c.state, origins = [c.x, c.y, c.z];
  const scaled = (i: number, start: number, scale: number, position: boolean): number =>
    Math.round((s[i]! - (position ? origins[(i - start) % 3]! : 0)) * scale);
  // A long rig, a fast strike or an unusually old sleep anchor can exceed the short range.
  const groups = [[0, 3 * n, POSITION, true], [3 * n, 9 * n, SPEED, false], [9 * n, 13 * n, ROTATION, false],
    [15 * n, 18 * n, POSITION, true], [18 * n, 22 * n, ROTATION, false]] as const;
  for (const [a, b, scale, position] of groups) for (let i = a; i < b; i++) {
    const q = scaled(i, a, scale, position);
    if (!(q >= -32768 && q <= 32767)) return encodeCorpseCheckpoint(c);
  }
  const same = (from: number, prior: number, count: number): boolean => {
    for (let k = 0; k < count; k++) if (s[from + k] !== s[prior + k]) return false;
    return true;
  };
  const held = same(15 * n, 0, 3 * n) && same(18 * n, 9 * n, 4 * n);
  const w = new BitWriter(45 + (c.carrier ? 84 : 0) + 20 * n * 2 + 18 * n + 60 + 8);
  header(w, c, n, COMPACT | (held ? STILL_MATCHES : 0));
  for (const [a, b, scale, position] of groups) {
    if (held && a >= 15 * n) break;
    for (let i = a; i < b; i++) {
      const q = scaled(i, a, scale, position);
      w.sbits(q, 16);
      s[i] = (position ? origins[(i - a) % 3]! : 0) + q / scale;
    }
  }
  if (held) { s.copyWithin(15 * n, 0, 3 * n); s.copyWithin(18 * n, 9 * n, 13 * n); }
  // Joint limits, including widened ones, and the sleep timer survive without rounding.
  writeExact(w, s.subarray(13 * n, 15 * n));
  w.f64(s[22 * n]!);
  for (let i = 22 * n + 1; i < 22 * n + 5; i++) w.svarint(s[i]!);
  for (let i = 22 * n + 5; i < s.length; i++) w.varint(s[i]!);
  return w.bytes().slice();
}

/** Reject malformed and unbounded state before allocating a rig or mutating any existing corpse. */
export function decodeCorpseCheckpoint(data: Uint8Array): CorpseCheckpoint | null {
  if (data.length < 45 || data.length > CORPSE_CHECKPOINT_MAX) return null;
  const r = new BitReader(data), version = r.u8(), n = r.u8(), flags = r.u8(), ticks = r.u16();
  if (version !== 1 && version !== 2 || n < 1 || n > CORPSE_BODIES_MAX || version === 1 && flags > 15 || ticks > 300) return null;
  const compact = (flags & COMPACT) !== 0, held = (flags & STILL_MATCHES) !== 0;
  const headerBytes = 45 + ((flags & CARRIER) ? 84 : 0);
  const exact = (flags & EXACT) !== 0;
  if (held && !compact || exact && compact) return null;
  const stateLength = 22 * n + 13;
  if (compact && data.length < headerBytes + (held ? 28 : 42) * n + 20) return null;
  if (exact && data.length < headerBytes + stateLength) return null;
  if (!exact && !compact && data.length !== headerBytes + stateLength * 8) return null;
  const x = r.f64(), y = r.f64(), z = r.f64(), yaw = r.f64(), size = r.f64();
  if (![x, y, z, yaw, size].every(Number.isFinite) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || Math.abs(z) > 1e6 || Math.abs(yaw) > 7 || !(size > 0 && size <= 1)) return null;
  let carrier: CarrierFrame | undefined;
  if (flags & CARRIER) {
    const handle = r.u32(), px = r.f64(), py = r.f64(), pz = r.f64(), qx = r.f64(), qy = r.f64(), qz = r.f64(), qw = r.f64();
    const norm = qx * qx + qy * qy + qz * qz + qw * qw;
    if (!handle || !(Math.abs(px) <= 1e6 && Math.abs(py) <= 1e6 && Math.abs(pz) <= 1e6 && norm >= .9 && norm <= 1.1)) return null;
    const vx = r.f32(), vy = r.f32(), vz = r.f32(), wx = r.f32(), wy = r.f32(), wz = r.f32();
    if (![vx, vy, vz, wx, wy, wz].every(Number.isFinite)) return null;
    carrier = { handle, pose: { x: px, y: py, z: pz, qx, qy, qz, qw }, vx, vy, vz, wx, wy, wz };
  }
  const state = new Float64Array(22 * n + 13);
  if (compact) {
    const origins = [x, y, z];
    for (let i = 0; i < 3 * n; i++) state[i] = origins[i % 3]! + r.sbits(16) / POSITION;
    for (let i = 3 * n; i < 9 * n; i++) state[i] = r.sbits(16) / SPEED;
    for (let i = 9 * n; i < 13 * n; i++) state[i] = r.sbits(16) / ROTATION;
    if (held) { state.copyWithin(15 * n, 0, 3 * n); state.copyWithin(18 * n, 9 * n, 13 * n); }
    else {
      for (let i = 15 * n; i < 18 * n; i++) state[i] = origins[i % 3]! + r.sbits(16) / POSITION;
      for (let i = 18 * n; i < 22 * n; i++) state[i] = r.sbits(16) / ROTATION;
    }
    if (!readExact(r, state.subarray(13 * n, 15 * n))) return null;
    state[22 * n] = r.f64();
    for (let i = 22 * n + 1; i < 22 * n + 5; i++) state[i] = r.svarint();
    for (let i = 22 * n + 5; i < state.length; i++) state[i] = r.varint();
  } else if (exact) {
    if (!readExact(r, state)) return null;
  } else for (let i = 0; i < state.length; i++) state[i] = r.f64();
  for (let i = 0; i < state.length; i++) if (!Number.isFinite(state[i]!) || (i < 22 * n && Math.abs(state[i]!) > 1e6)) return null;
  for (let i = 0; i < n; i++) {
    const at = n * 9 + i * 4;
    const norm = state[at]! * state[at]! + state[at + 1]! * state[at + 1]! + state[at + 2]! * state[at + 2]! + state[at + 3]! * state[at + 3]!;
    if (norm < .9 || norm > 1.1) return null;
  }
  if (r.overflow || r.pos !== data.length * 8) return null;
  return { x, y, z, yaw, size, out: (flags & 1) !== 0, air: (flags & 2) !== 0, awake: (flags & 4) !== 0, standing: (flags & 8) !== 0, ticks, state, ...(carrier ? { carrier } : {}) };
}

/** The caller writes the protocol opcode first. Identity is the generation-qualified view ID. */
export function writeCorpseMotion(w: BitWriter, id: number, motion: CorpseMotion): void {
  w.u32(id); w.u32(motion.revision); w.u32(motion.tick); w.blob(motion.data);
}

export function readCorpseMotion(r: BitReader): CorpsePacket | null {
  const id = r.u32(), revision = r.u32(), tick = r.u32(), data = r.blob(CORPSE_CHECKPOINT_MAX);
  if (r.overflow || revision === 0 || !decodeCorpseCheckpoint(data)) return null;
  return { id, revision, tick, data };
}

/** A first-visibility retry can refresh the same revision at a newer authoritative tick. */
export function newerCorpseMotion(next: CorpseMotion, old: CorpseMotion | undefined): boolean {
  return !old || next.revision > old.revision || (next.revision === old.revision && next.tick > old.tick);
}
