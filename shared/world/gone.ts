// Which of a map's own pieces no longer stand in a chunk, as a client far from it is told (S_GONE): the chunk's map slots
// that fell, in ascending order. Slot `s` of a chunk is the map's `s`-th piece there (StructureStore.placeMap), so a client
// that holds the map file knows each by its number alone. The wire layout is documented at S_GONE in shared/net/protocol.ts.

import type { Registry } from "../content/registry.ts";
import type { BitReader, BitWriter } from "../net/codec.ts";
import { MAX_SLOTS_PER_CHUNK, type StructureStore } from "./structures.ts";

/** GoneRadius's default, in metres: how far from a survivor a chunk's list is sent. */
export const GONE_RADIUS = 8192;

/** A chunk with every map piece standing. */
export const NONE_GONE = new Uint16Array(0);

/**
 * Whether a map slot that holds `kind` no longer stands, as the far view takes it. This is the one place that says so, for
 * the server that makes the lists and for a client that reads rows. Today only an empty slot has fallen. A kind that is a
 * fallen piece's heap lies low and counts as fallen too: test it here, by the registry's column for it.
 */
export function fallen(_reg: Registry, kind: number): boolean {
  return kind === 0;
}

/**
 * The map slots of `chunk` that no longer stand, ascending, from the store's list of changed slots. Returns `was` itself
 * where it already says the same, so a caller tells a list that moved by identity. Authority only.
 */
export function goneSlots(reg: Registry, structs: StructureStore, chunk: number, was: Uint16Array): Uint16Array {
  const changed = structs.changedSlots(chunk);
  const kind = structs.chunks[chunk]?.kind;
  let n = 0;
  let same = true;
  for (let i = 0; kind && i < changed.length; i++) {
    if (!fallen(reg, kind[changed[i]!]!)) continue;
    if (same && (n >= was.length || was[n] !== changed[i])) same = false;
    n++;
  }
  if (same && n === was.length) return was;
  if (n === 0) return NONE_GONE;
  const list = new Uint16Array(n);
  for (let i = 0, k = 0; k < n; i++) if (fallen(reg, kind![changed[i]!]!)) list[k++] = changed[i]!;
  return list;
}

/** What one removal took of a chunk's map pieces: how many, the middle of the box they stood in, its foot, and how far across and how tall it was. */
export interface Fell {
  count: number;
  x: number;
  z: number;
  foot: number;
  across: number;
  tall: number;
}

/**
 * Measures the map pieces among the slots of `chunk` that `runs` names (pairs of first slot and count, as a removal logs
 * them), into `out`. A map's slot keeps its place when it is emptied, so this holds after the removal. Authority only.
 */
export function fellIn(structs: StructureStore, chunk: number, runs: readonly number[], out: Fell): Fell {
  const t = structs.chunks[chunk];
  let [x0, y0, z0, x1, y1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  out.count = 0;
  for (let r = 0; t && r < runs.length; r += 2) {
    for (let s = runs[r]!, end = Math.min(t.mapped, s + runs[r + 1]!); s < end; s++) {
      const half = structs.halfYOf(structs.mapKind(chunk, s));
      x0 = Math.min(x0, t.x[s]!);
      x1 = Math.max(x1, t.x[s]!);
      z0 = Math.min(z0, t.z[s]!);
      z1 = Math.max(z1, t.z[s]!);
      y0 = Math.min(y0, t.y[s]! - half);
      y1 = Math.max(y1, t.y[s]! + half);
      out.count++;
    }
  }
  out.x = (x0 + x1) / 2;
  out.z = (z0 + z1) / 2;
  out.foot = y0;
  out.across = Math.max(x1 - x0, z1 - z0);
  out.tall = y1 - y0;
  return out;
}

/** Bits a varint of `v` takes. */
function varintBits(v: number): number {
  return v < 0x80 ? 8 : v < 0x4000 ? 16 : 24;
}

/**
 * Writes S_GONE's fields after its type: the chunk, the version of its list, and the list as runs of slots or as a bit a
 * slot, whichever is fewer bits. An empty list says every map piece of the chunk stands.
 */
export function writeGone(w: BitWriter, chunk: number, version: number, slots: Uint16Array): void {
  w.u16(chunk);
  w.varint(version);
  const n = slots.length;
  let runs = 0;
  let bits = 0;
  for (let i = 0, end = 0; i < n; ) {
    let len = 1;
    while (i + len < n && slots[i + len] === slots[i]! + len) len++;
    bits += varintBits(slots[i]! - end) + 1 + (len > 1 ? varintBits(len - 2) : 0);
    end = slots[i]! + len;
    runs++;
    i += len;
  }
  const span = n > 0 ? slots[n - 1]! + 1 : 0;
  const asBits = n > 0 && varintBits(span) + span < varintBits(runs) + bits;
  w.bool(asBits);
  if (asBits) {
    w.varint(span);
    for (let s = 0, i = 0; s < span; s++) {
      const gone = slots[i] === s;
      w.bool(gone);
      if (gone) i++;
    }
    return;
  }
  w.varint(runs);
  for (let i = 0, end = 0; i < n; ) {
    let len = 1;
    while (i + len < n && slots[i + len] === slots[i]! + len) len++;
    // A run starts past the end of the one before it: the slot between them stands.
    w.varint(slots[i]! - end);
    w.bool(len > 1);
    if (len > 1) w.varint(len - 2);
    end = slots[i]! + len;
    i += len;
  }
}

/** One chunk's list as read: the server's version of it and its slots, ascending. */
export class GoneList {
  version = 0;
  slots: Uint16Array = NONE_GONE;
}

const scratch = new Uint16Array(MAX_SLOTS_PER_CHUNK + 1);

/** Reads what writeGone wrote. Returns the chunk, or -1 if the message is malformed, and then `out` holds nothing of use. */
export function readGone(r: BitReader, out: GoneList): number {
  const chunk = r.u16();
  const version = r.varint();
  const asBits = r.bool();
  let n = 0;
  if (asBits) {
    const span = r.varint();
    if (span > scratch.length || span > r.remainingBits) return -1;
    for (let s = 0; s < span; s++) if (r.bool()) scratch[n++] = s;
  } else {
    const runs = r.varint();
    // A run is nine bits at least.
    if (runs * 9 > r.remainingBits) return -1;
    for (let k = 0, end = 0; k < runs; k++) {
      const first = end + r.varint();
      const len = r.bool() ? r.varint() + 2 : 1;
      if (r.overflow || (k > 0 && first === end) || first + len > scratch.length) return -1;
      for (let s = first; s < first + len; s++) scratch[n++] = s;
      end = first + len;
    }
  }
  if (r.overflow) return -1;
  out.version = version;
  out.slots = n > 0 ? scratch.slice(0, n) : NONE_GONE;
  return chunk;
}
