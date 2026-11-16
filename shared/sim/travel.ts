// A static that travels between two states when used (StructureDef.travel), a door with a travel time: a yacht's sails
// set and struck. Its state is three numbers set when it is thrown, from which the server, its save and every client
// work out where it stands at any tick. Nothing is done a tick.

import { TICK_RATE } from "../coords.ts";
import type { BitReader, BitWriter } from "../net/codec.ts";
import type { TravelFacet } from "../content/defs.ts";

/** Steps the progress a travel left from is counted in: 15 bits, beside the bit of the state it goes to. */
export const TRAVEL_STEPS = 32767;
/** Ticks after a throw before the static may be thrown again: a public control is no strobe. */
export const THROW_TICKS = 2 * TICK_RATE;
/** Travelling statics one message may carry. */
export const MAX_TRAVELLING = 255;
/** A row of S_MOTION: ref u32, where it left from and goes to u16, the tick it left u32. */
const ROW_BYTES = 10;

/** Where a static's travel stands: the progress it left from in TRAVEL_STEPS, the state it goes to, and the tick it left. */
export interface TravelState {
  readonly from: number;
  readonly to: 0 | 1;
  readonly at: number;
}

/** Its progress at `tick`, which may be a fraction: 0 at its first state, 1 at its second. */
export function travelProgress(s: TravelState, ticks: number, tick: number): number {
  const p = s.from / TRAVEL_STEPS + (s.to === 1 ? 1 : -1) * (Math.max(0, tick - s.at) / ticks);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** Ticks one whole travel takes. */
export const travelTicks = (t: TravelFacet): number => Math.round(t.seconds * TICK_RATE);

/** Thrown at `tick`: on from where it stands toward the state it was not going to. */
export function thrown(s: TravelState | null, ticks: number, tick: number): TravelState {
  const p = s ? travelProgress(s, ticks, tick) : 0;
  return { from: Math.round(p * TRAVEL_STEPS), to: s?.to === 1 ? 0 : 1, at: tick };
}

/** As a fixture record keeps it: six bytes. */
export function travelBytes(s: TravelState): Uint8Array {
  const out = new Uint8Array(6);
  const v = new DataView(out.buffer);
  v.setUint16(0, (s.to << 15) | s.from, true);
  v.setUint32(2, s.at, true);
  return out;
}

export function readTravelBytes(b: Uint8Array): TravelState {
  if (b.length !== 6) throw new Error("travel: a record's state is six bytes");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const w = v.getUint16(0, true);
  return { from: w & TRAVEL_STEPS, to: (w >> 15) as 0 | 1, at: v.getUint32(2, true) };
}

export function writeTravels(w: BitWriter, states: ReadonlyMap<number, TravelState>): void {
  w.u8(states.size);
  for (const [ref, s] of states) {
    w.u32(ref);
    w.u16((s.to << 15) | s.from);
    w.u32(s.at);
  }
}

/** Every travelling static's state, or null where the message is not whole. */
export function readTravels(r: BitReader): Map<number, TravelState> | null {
  const n = r.u8();
  if (r.overflow || r.remainingBits !== n * ROW_BYTES * 8) return null;
  const out = new Map<number, TravelState>();
  for (let i = 0; i < n; i++) {
    const ref = r.u32(), word = r.u16(), at = r.u32();
    out.set(ref, { from: word & TRAVEL_STEPS, to: (word >> 15) as 0 | 1, at });
  }
  return r.overflow ? null : out;
}
