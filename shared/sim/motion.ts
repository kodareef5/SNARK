// A static that moves between two states when used (StructureDef.motion), a door with a travel time: a yacht's sails
// set and struck. Its state is three numbers set when it is thrown, from which the server, its save and every client
// work out where it stands at any tick. Nothing is done a tick.

import { TICK_RATE } from "../coords.ts";
import type { BitReader, BitWriter } from "../net/codec.ts";
import type { MotionFacet } from "../content/defs.ts";

/** Steps the progress a motion left from is counted in: 15 bits, beside the bit of the state it goes to. */
export const MOTION_STEPS = 32767;
/** Ticks after a throw before the static may be thrown again: a public control is no strobe. */
export const THROW_TICKS = 2 * TICK_RATE;
/** Moving statics one message may carry. */
export const MAX_MOVING = 255;
/** A row of S_MOTION: ref u32, where it left from and goes to u16, the tick it left u32. */
const ROW_BYTES = 10;

/** Where a static's motion stands: the progress it left from in MOTION_STEPS, the state it goes to, and the tick it left. */
export interface MotionState {
  readonly from: number;
  readonly to: 0 | 1;
  readonly at: number;
}

/** Its progress at `tick`, which may be a fraction: 0 at its first state, 1 at its second. */
export function motionProgress(s: MotionState, ticks: number, tick: number): number {
  const p = s.from / MOTION_STEPS + (s.to === 1 ? 1 : -1) * (Math.max(0, tick - s.at) / ticks);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** Ticks one whole motion takes. */
export const motionTicks = (t: MotionFacet): number => Math.round(t.seconds * TICK_RATE);

/** Thrown at `tick`: on from where it stands toward the state it was not going to. */
export function thrown(s: MotionState | null, ticks: number, tick: number): MotionState {
  const p = s ? motionProgress(s, ticks, tick) : 0;
  return { from: Math.round(p * MOTION_STEPS), to: s?.to === 1 ? 0 : 1, at: tick };
}

/** As a fixture record keeps it: six bytes. */
export function motionBytes(s: MotionState): Uint8Array {
  const out = new Uint8Array(6);
  const v = new DataView(out.buffer);
  v.setUint16(0, (s.to << 15) | s.from, true);
  v.setUint32(2, s.at, true);
  return out;
}

export function readMotionBytes(b: Uint8Array): MotionState {
  if (b.length !== 6) throw new Error("motion: a record's state is six bytes");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const w = v.getUint16(0, true);
  return { from: w & MOTION_STEPS, to: (w >> 15) as 0 | 1, at: v.getUint32(2, true) };
}

export function writeMotions(w: BitWriter, states: ReadonlyMap<number, MotionState>): void {
  w.u8(states.size);
  for (const [ref, s] of states) {
    w.u32(ref);
    w.u16((s.to << 15) | s.from);
    w.u32(s.at);
  }
}

/** Every moving static's state, or null where the message is not whole. */
export function readMotions(r: BitReader): Map<number, MotionState> | null {
  const n = r.u8();
  if (r.overflow || r.remainingBits !== n * ROW_BYTES * 8) return null;
  const out = new Map<number, MotionState>();
  for (let i = 0; i < n; i++) {
    const ref = r.u32(), word = r.u16(), at = r.u32();
    out.set(ref, { from: word & MOTION_STEPS, to: (word >> 15) as 0 | 1, at });
  }
  return r.overflow ? null : out;
}
