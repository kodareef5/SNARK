// Sparse, authoritative corpse checkpoints. Sent on visibility/meaningful revision, never as per-frame bone snapshots.
import { BitReader, BitWriter } from "./codec.ts";

export const CORPSE_BODIES_MAX = 64;
/** Version, count, flags, fall ticks, five f64 pose values, then the ragdoll's 22*n+13 f64 state. */
export const CORPSE_CHECKPOINT_MAX = 45 + (22 * CORPSE_BODIES_MAX + 13) * 8;
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
  readonly ticks: number;
  readonly state: Float64Array;
}

export interface CorpseMotion {
  readonly revision: number;
  readonly tick: number;
  readonly data: Uint8Array;
}
export interface CorpsePacket extends CorpseMotion { readonly id: number }

export function encodeCorpseCheckpoint(c: CorpseCheckpoint): Uint8Array {
  const n = (c.state.length - 13) / 22;
  if (!Number.isInteger(n) || n < 1 || n > CORPSE_BODIES_MAX) throw new Error("corpse checkpoint: body count outside budget");
  const w = new BitWriter(45 + c.state.length * 8);
  w.u8(1); w.u8(n); w.u8((c.out ? 1 : 0) | (c.air ? 2 : 0) | (c.awake ? 4 : 0) | (c.standing ? 8 : 0)); w.u16(c.ticks);
  w.f64(c.x); w.f64(c.y); w.f64(c.z); w.f64(c.yaw); w.f64(c.size);
  for (const value of c.state) w.f64(value);
  return w.bytes();
}

/** Reject malformed and unbounded state before allocating a rig or mutating any existing corpse. */
export function decodeCorpseCheckpoint(data: Uint8Array): CorpseCheckpoint | null {
  if (data.length < 45 || data.length > CORPSE_CHECKPOINT_MAX) return null;
  const r = new BitReader(data), version = r.u8(), n = r.u8(), flags = r.u8(), ticks = r.u16();
  if (version !== 1 || n < 1 || n > CORPSE_BODIES_MAX || flags > 15 || ticks > 300 || data.length !== 45 + (22 * n + 13) * 8) return null;
  const x = r.f64(), y = r.f64(), z = r.f64(), yaw = r.f64(), size = r.f64();
  if (![x, y, z, yaw, size].every(Number.isFinite) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || Math.abs(z) > 1e6 || Math.abs(yaw) > 7 || !(size > 0 && size <= 1)) return null;
  const state = new Float64Array(22 * n + 13);
  for (let i = 0; i < state.length; i++) {
    const value = r.f64();
    if (!Number.isFinite(value)) return null;
    state[i] = value;
  }
  // Position, velocity and spin are finite bounded simulation values. The final cache entries are uint32 revisions.
  for (let i = 0; i < 22 * n; i++) if (Math.abs(state[i]!) > 1e6) return null;
  for (let i = 0; i < n; i++) {
    const at = n * 9 + i * 4;
    const norm = state[at]! * state[at]! + state[at + 1]! * state[at + 1]! + state[at + 2]! * state[at + 2]! + state[at + 3]! * state[at + 3]!;
    if (norm < .9 || norm > 1.1) return null;
  }
  if (r.overflow) return null;
  return { x, y, z, yaw, size, out: (flags & 1) !== 0, air: (flags & 2) !== 0, awake: (flags & 4) !== 0, standing: (flags & 8) !== 0, ticks, state };
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
