// What the survivor log writes: varints, a survivor's state in one number, an item as one key, and the name of a segment.
// Each segment is one SQLite file holding a span of wall time; the schema is in store.ts.

import { FLAG_BLUEPRINT, type Inventory } from "../../shared/sim/items.ts";

/** Positions are kept to a quarter of a metre. */
export const QUANTUM = 4;

/** What a survivor was doing at a sample, the low three bits of its state. The rest of the state is the seat (seatOf). */
export const STATE_ALIVE = 0;
export const STATE_OUT = 1;
export const STATE_DEAD = 2;
export const STATE_SPECTATING = 3;
/** The connection is gone and the body lingers in the world. */
export const STATE_AWAY = 4;
export const STATE_NAMES: readonly string[] = ["alive", "unconscious", "dead", "spectating", "away"];

/** `seat` is the content index of what the survivor sits on, or -1. */
export function stateOf(condition: number, seat: number): number {
  return seat < 0 ? condition : condition + (seat + 1) * 8;
}

export function conditionOf(state: number): number {
  return state & 7;
}

/** The content index of what the survivor sat on, or -1. */
export function seatOf(state: number): number {
  return Math.floor(state / 8) - 1;
}

/**
 * An item as an admin tells two apart: its content index, its quality tier and whether it is a blueprint. Durability and
 * spoiling are left out, so a swing or a minute's spoiling is no change.
 */
export function itemKey(item: number, quality: number, blueprint: boolean): number {
  return item * 16 + (quality & 7) * 2 + (blueprint ? 1 : 0);
}

export function keyItem(key: number): number {
  return Math.floor(key / 16);
}

export function keyQuality(key: number): number {
  return (key >> 1) & 7;
}

export function keyBlueprint(key: number): boolean {
  return (key & 1) === 1;
}

/**
 * Everything an inventory holds, by item key: bag, hotbar and worn gear, the rounds loaded in weapons and the attachments
 * fitted to them, as the item ledger counts them. Read as last settled: the log never settles spoiling itself.
 */
export function aggregate(inv: Inventory | null, out: Map<number, number> = new Map()): Map<number, number> {
  out.clear();
  if (!inv) return out;
  for (let s = 0; s < inv.cap; s++) {
    const item = inv.item[s]!;
    if (item === 0) continue;
    const key = itemKey(item, inv.quality[s]!, (inv.flags[s]! & FLAG_BLUEPRINT) !== 0);
    out.set(key, (out.get(key) ?? 0) + inv.count[s]!);
    if (inv.loaded[s]! > 0) out.set(itemKey(inv.ammo[s]!, 0, false), (out.get(itemKey(inv.ammo[s]!, 0, false)) ?? 0) + inv.loaded[s]!);
    if (inv.attach[s] !== 0) out.set(itemKey(inv.attach[s]!, 0, false), (out.get(itemKey(inv.attach[s]!, 0, false)) ?? 0) + 1);
  }
  return out;
}

/** Keys and counts that differ from `was` to `now`, as [key, count now] pairs; a count of 0 is gone. */
export function difference(was: ReadonlyMap<number, number>, now: ReadonlyMap<number, number>): number[] {
  const out: number[] = [];
  for (const [key, n] of now) if (was.get(key) !== n) out.push(key, n);
  for (const key of was.keys()) if (!now.has(key)) out.push(key, 0);
  return out;
}

/** A growing buffer of unsigned and zig-zag varints of any safe integer. */
export class Bytes {
  buf = new Uint8Array(64);
  n = 0;

  private room(k: number): void {
    if (this.n + k <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }

  u(v: number): void {
    this.room(8);
    while (v >= 0x80) {
      this.buf[this.n++] = (v % 0x80) | 0x80;
      v = Math.floor(v / 0x80);
    }
    this.buf[this.n++] = v;
  }

  s(v: number): void {
    this.u(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  put(b: Uint8Array): void {
    this.room(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }

  take(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

/** Reads what Bytes wrote. Past the end it reads zeros and sets `over`. */
export class Cursor {
  buf: Uint8Array;
  pos: number;
  end: number;
  over = false;

  constructor(buf: Uint8Array, pos = 0, end = buf.length) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }

  u(): number {
    let v = 0;
    let scale = 1;
    while (this.pos < this.end) {
      const b = this.buf[this.pos++]!;
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 0x80;
    }
    this.over = true;
    return 0;
  }

  s(): number {
    const v = this.u();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }
}

/** [key, count] pairs as a blob: their number, then each pair. */
export function packPairs(pairs: readonly number[]): Uint8Array {
  const w = new Bytes();
  w.u(pairs.length / 2);
  for (let i = 0; i < pairs.length; i++) w.u(pairs[i]!);
  return w.take();
}

export function unpackPairs(data: Uint8Array): number[] {
  const r = new Cursor(data);
  const n = r.u();
  const out: number[] = [];
  for (let i = 0; i < n * 2 && !r.over; i++) out.push(r.u());
  return out;
}

/** A segment's file: `2026-11-18T09-30-05-123Z-t81000.db`, its first moment and tick. Sorts by time as text. */
export const SEGMENT_NAME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-t(\d+)\.db$/;

export function segmentName(wall: number, tick: number): string {
  return `${new Date(wall).toISOString().replace(/[:.]/g, "-")}-t${tick}.db`;
}

/** The folder of a save's survivor log. */
export function logFolder(dbPath: string): string {
  return `${dbPath}.survivor-log`;
}
