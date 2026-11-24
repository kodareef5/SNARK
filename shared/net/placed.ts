// S_PLACED: what became of a CMD_PLACE, to the session that sent it. The server writes it and the client reads it here.

import type { BitReader, BitWriter } from "./codec.ts";
import { PLACED_COUNTS, PLACED_ENTITY, PLACED_METRES, PLACED_NONE, PLACED_STRUCTURE, RESULT_OK } from "./protocol.ts";

/** Pieces one answer may name. */
export const PLACED_MOST = 63;

export interface Placed {
  seq: number;
  /** Refs of the pieces placed, in order: chunk * 65536 + slot. */
  refs: number[];
  /** RESULT_OK, or why the command stopped. */
  code: number;
  /** A PLACED_ detail and its one or two numbers: a ref, an entity index, a count and its cap, or metres and the metres needed. */
  detail: number;
  a: number;
  b: number;
  /** A plan's fill: the place in the plan's order to go on from, and -1 for any other placement. `skipped` are pieces passed over as blocked. */
  next: number;
  skipped: number;
}

export function makePlaced(): Placed {
  return { seq: 0, refs: [], code: RESULT_OK, detail: PLACED_NONE, a: 0, b: 0, next: -1, skipped: 0 };
}

/** After the message's kind. */
export function writePlaced(w: BitWriter, p: Placed): void {
  w.u16(p.seq);
  const n = Math.min(p.refs.length, PLACED_MOST);
  w.bits(n, 6);
  let chunk = -1;
  for (let i = 0; i < n; i++) {
    const at = Math.floor(p.refs[i]! / 65536);
    w.bool(at === chunk);
    if (at !== chunk) w.u16((chunk = at));
    w.u16(p.refs[i]! & 0xffff);
  }
  w.bool(p.code !== RESULT_OK);
  if (p.code !== RESULT_OK) {
    w.u8(p.code);
    w.bits(p.detail, 3);
    if (p.detail === PLACED_STRUCTURE) w.u32(p.a);
    else if (p.detail === PLACED_ENTITY) w.varint(p.a);
    else if (p.detail === PLACED_COUNTS || p.detail === PLACED_METRES) {
      w.varint(p.a);
      w.varint(p.b);
    }
  }
  w.bool(p.next >= 0);
  if (p.next >= 0) {
    w.varint(p.next);
    w.varint(p.skipped);
  }
}

/** After the message's kind, into `out`. False for one that runs past its end, or names a detail this client does not know. */
export function readPlaced(r: BitReader, out: Placed): boolean {
  out.seq = r.u16();
  const n = r.bits(6);
  out.refs.length = 0;
  let chunk = 0;
  for (let i = 0; i < n && !r.overflow; i++) {
    if (!r.bool()) chunk = r.u16();
    out.refs.push(chunk * 65536 + r.u16());
  }
  [out.code, out.detail, out.a, out.b] = [RESULT_OK, PLACED_NONE, 0, 0];
  if (r.bool()) {
    out.code = r.u8();
    out.detail = r.bits(3);
    if (out.detail === PLACED_STRUCTURE) out.a = r.u32();
    else if (out.detail === PLACED_ENTITY) out.a = r.varint();
    else if (out.detail === PLACED_COUNTS || out.detail === PLACED_METRES) {
      out.a = r.varint();
      out.b = r.varint();
    } else if (out.detail !== PLACED_NONE) return false;
  }
  [out.next, out.skipped] = [-1, 0];
  if (r.bool()) {
    out.next = r.varint();
    out.skipped = r.varint();
  }
  return !r.overflow;
}
