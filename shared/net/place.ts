// CMD_PLACE: where the piece in hand is to go. The client writes it and the server reads it here. A piece that joins a
// base is a frame and a key, and the server works its pose out again from them (shared/world/lattice/place.ts).

import type { BitReader, BitWriter } from "./codec.ts";

/** In a slot of a base; the first piece of a new base, or a thing, on open ground; a thing on a floor. */
export const PLACE_JOIN = 0;
export const PLACE_NEW = 1;
export const PLACE_REST = 2;
/** Pieces one command may set down in a row: its key stepped whole sides along a direction. */
export const PLACE_RUN_MOST = 32;

export interface PlaceRequest {
  /** Which of the held item's forms. */
  variant: number;
  mode: number;
  /** PLACE_JOIN: the frame's gid and the key's two words, with its turn. */
  fr: number;
  k0: number;
  k1: number;
  /** PLACE_JOIN: how many pieces, and the direction (0 to 11) each is a whole side on from the last. */
  count: number;
  step: number;
  /** PLACE_REST: the floor's ref. */
  floor: number;
  /** PLACE_NEW and PLACE_REST: lattice units, a facing, and for a foundation steps up or down. */
  x: number;
  z: number;
  yaw: number;
  lift: number;
}

export function makePlaceRequest(): PlaceRequest {
  return { variant: 0, mode: PLACE_JOIN, fr: 0, k0: 0, k1: 0, count: 1, step: 0, floor: 0, x: 0, z: 0, yaw: 0, lift: 0 };
}

/** After the command's kind. */
export function writePlace(w: BitWriter, p: PlaceRequest): void {
  w.u8(p.variant);
  w.bits(p.mode, 2);
  if (p.mode === PLACE_JOIN) {
    w.varint(p.fr);
    w.u32(p.k0);
    w.u32(p.k1);
    w.bool(p.count > 1);
    if (p.count > 1) {
      w.bits(p.step, 4);
      w.bits(p.count - 1, 5);
    }
    return;
  }
  if (p.mode === PLACE_REST) w.u32(p.floor);
  w.sbits(p.x, 32);
  w.sbits(p.z, 32);
  w.u16(p.yaw);
  if (p.mode === PLACE_NEW) w.sbits(p.lift, 8);
}

/** After the command's kind, into `out`. False for one that runs past its end or names no mode. */
export function readPlace(r: BitReader, out: PlaceRequest): boolean {
  out.variant = r.u8();
  out.mode = r.bits(2);
  out.count = 1;
  out.step = out.lift = out.floor = 0;
  if (out.mode === PLACE_JOIN) {
    out.fr = r.varint();
    out.k0 = r.u32();
    out.k1 = r.u32();
    if (r.bool()) {
      out.step = r.bits(4);
      out.count = r.bits(5) + 1;
    }
    return !r.overflow && out.step < 12;
  }
  if (out.mode !== PLACE_NEW && out.mode !== PLACE_REST) return false;
  if (out.mode === PLACE_REST) out.floor = r.u32();
  out.x = r.sbits(32);
  out.z = r.sbits(32);
  out.yaw = r.u16();
  if (out.mode === PLACE_NEW) out.lift = r.sbits(8);
  return !r.overflow;
}

const one = makePlaceRequest();

/** A piece, or a row of `count`, in the slot (k0, k1) of frame `fr`. */
export function writeJoin(w: BitWriter, variant: number, fr: number, k0: number, k1: number, count = 1, step = 0): void {
  [one.variant, one.mode, one.fr, one.k0, one.k1, one.count, one.step] = [variant, PLACE_JOIN, fr, k0, k1, count, step];
  writePlace(w, one);
}

/** A base's first piece, or a thing, on open ground at (x, z) lattice units. */
export function writeNew(w: BitWriter, variant: number, x: number, z: number, yaw: number, lift = 0): void {
  [one.variant, one.mode, one.x, one.z, one.yaw, one.lift] = [variant, PLACE_NEW, x, z, yaw, lift];
  writePlace(w, one);
}

/** A thing on the floor `floor`, its middle over (x, z) lattice units. */
export function writeRest(w: BitWriter, variant: number, floor: number, x: number, z: number, yaw: number): void {
  [one.variant, one.mode, one.floor, one.x, one.z, one.yaw] = [variant, PLACE_REST, floor, x, z, yaw];
  writePlace(w, one);
}
