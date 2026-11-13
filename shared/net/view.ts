// Entity replication: what one client knows about the entities around it.
//
// A view is the sorted list of entities a client holds after applying one
// snapshot. The server keeps the last 32 views it sent to each client; the
// client keeps the last 32 it decoded. A snapshot is encoded against the newest
// view the client has acknowledged, so a lost snapshot costs nothing: the next
// one is still relative to something the client really has.
//
// Entities absent from a delta are unchanged. When the byte budget is too small
// for every change, the server defers some and records the stale state it left
// the client with, so later deltas stay correct. Deferral rotates, so no entity
// starves.
//
// Wire form after the snapshot header:
//   count varint, then per op in ascending id order:
//     id gap varint: this id minus the previous id (first: id + 1), so always >= 1
//     op 2 bits: 0 update, 1 create, 2 remove
//     create: kind varint, generation 12 bits, x 22, y 20, z 22, yaw 10, flags 4,
//             pose state 31, then its appearance: revision 4, level varint,
//             [colours? 1][6 x 8], [name? 1][string], [look? 1][28 x 8]
//     update: [pos? 1][small? 1][3 x s8 | 22+20+22] [yaw? 1][10] [flags? 1][4]
//             [motion? 1][12] [look? 1][6] [action? 1][13]
//
// The pose state is what shared/anim/pose.ts makes a pose from, in three parts
// that change at different rates: how the body moves, where it looks, and what
// it is doing. Each travels only when it changes.
//
// Appearance (level, colour regions, name) changes rarely, so it rides only on
// create. A change bumps the entity's revision, which makes the next delta
// send a create for it again. It therefore arrives with the entity, never
// before or after, and loss is handled by the same baselines as everything else.

import { ANIM_ACTION_BITS, ANIM_ACTION_SHIFT, ANIM_LOOK_BITS, ANIM_LOOK_SHIFT, ANIM_MOTION_BITS, ANIM_MOTION_MASK } from "../anim/pose.ts";
import { LOOK_BYTES } from "../anim/look.ts";
import { WORLD_MIN_Y } from "../coords.ts";
import type { BitReader, BitWriter } from "./codec.ts";

export const VIEW_RING = 32;
export const MAX_VIEW = 512;
/** Position units per metre on the wire. */
export const POS_UNITS = 256;

const OP_UPDATE = 0;
const OP_CREATE = 1;
const OP_REMOVE = 2;

const ANIM_BITS = ANIM_MOTION_BITS + ANIM_LOOK_BITS + ANIM_ACTION_BITS;
const LOOK_MASK = (1 << ANIM_LOOK_BITS) - 1;
const CREATE_BITS = 24 + 2 + 24 + 12 + 64 + 10 + 4 + ANIM_BITS + 4 + 16 + 3 + 48;
/** Longest name carried, in bytes. */
export const MAX_NAME_LENGTH = 72;

const UPDATE_BITS = 24 + 2 + 2 + 64 + 1 + 10 + 1 + 4 + 3 + ANIM_BITS;

/** Bits a create for entry `j` of `v` takes at most: the fixed part plus its name's bytes. */
function createBits(v: EntityView, j: number): number {
  const name = v.name[j]!;
  const look = v.look[j] ? LOOK_BYTES * 8 : 0;
  if (name === "") return CREATE_BITS + look;
  let bytes = 1;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return CREATE_BITS + look + bytes * 8;
}

export function quantX(x: number): number {
  return Math.round(x * POS_UNITS);
}

export function quantY(y: number): number {
  return Math.round((y - WORLD_MIN_Y) * POS_UNITS);
}

export function dequantX(q: number): number {
  return q / POS_UNITS;
}

export function dequantY(q: number): number {
  return q / POS_UNITS + WORLD_MIN_Y;
}

export class EntityView {
  /** Server tick this view belongs to; 0 marks an unused or invalid view. */
  tick = 0;
  count = 0;
  /** Entity slot index. Unique among live entities, ascending. */
  readonly id = new Uint32Array(MAX_VIEW);
  readonly gen = new Uint16Array(MAX_VIEW);
  readonly kind = new Uint16Array(MAX_VIEW);
  readonly qx = new Int32Array(MAX_VIEW);
  readonly qy = new Int32Array(MAX_VIEW);
  readonly qz = new Int32Array(MAX_VIEW);
  /** 10-bit yaw. */
  readonly yaw = new Uint16Array(MAX_VIEW);
  readonly flags = new Uint8Array(MAX_VIEW);
  /** Packed pose state: see `AnimState.pack`. */
  readonly anim = new Uint32Array(MAX_VIEW);
  /** Appearance: revision (4 bits), level, six colour regions, name. */
  readonly rev = new Uint8Array(MAX_VIEW);
  readonly level = new Uint16Array(MAX_VIEW);
  readonly colors = new Uint8Array(MAX_VIEW * 6);
  readonly name: string[] = new Array<string>(MAX_VIEW).fill("");
  /** A survivor's look (LOOK_BYTES), shared by reference and never changed in place; null for none. */
  readonly look: (Uint8Array | null)[] = new Array<Uint8Array | null>(MAX_VIEW).fill(null);

  /** Set the appearance of the entry just pushed. `colors` is read from `at`, six bytes. */
  appear(rev: number, level: number, colors: Uint8Array, at: number, name: string, look: Uint8Array | null): void {
    const n = this.count - 1;
    this.rev[n] = rev;
    this.level[n] = level;
    for (let k = 0; k < 6; k++) this.colors[n * 6 + k] = colors[at + k]!;
    this.name[n] = name;
    this.look[n] = look;
  }

  push(id: number, gen: number, kind: number, qx: number, qy: number, qz: number, yaw: number, flags: number, anim: number): boolean {
    const n = this.count;
    if (n === MAX_VIEW) return false;
    this.id[n] = id;
    this.gen[n] = gen;
    this.kind[n] = kind;
    this.qx[n] = qx;
    this.qy[n] = qy;
    this.qz[n] = qz;
    this.yaw[n] = yaw;
    this.flags[n] = flags;
    this.anim[n] = anim;
    this.count = n + 1;
    return true;
  }

  copyFrom(o: EntityView, i: number): boolean {
    if (!this.push(o.id[i]!, o.gen[i]!, o.kind[i]!, o.qx[i]!, o.qy[i]!, o.qz[i]!, o.yaw[i]!, o.flags[i]!, o.anim[i]!)) return false;
    this.appear(o.rev[i]!, o.level[i]!, o.colors, i * 6, o.name[i]!, o.look[i]!);
    return true;
  }
}

export class ViewRing {
  private readonly views: EntityView[] = [];

  constructor() {
    for (let i = 0; i < VIEW_RING; i++) this.views.push(new EntityView());
  }

  find(tick: number): EntityView | null {
    const v = this.views[tick % VIEW_RING]!;
    return tick !== 0 && v.tick === tick ? v : null;
  }

  /** Claim the slot for `tick`, emptied. */
  alloc(tick: number): EntityView {
    const v = this.views[tick % VIEW_RING]!;
    v.tick = tick;
    v.count = 0;
    return v;
  }

  at(i: number): EntityView {
    return this.views[i]!;
  }

  /** Forget every view, as after a new connection. */
  clear(): void {
    for (const v of this.views) {
      v.tick = 0;
      v.count = 0;
    }
  }
}

const scratchColors = new Uint8Array(6);

// Encoder scratch: one entry per merged entity.
const opKind = new Uint8Array(MAX_VIEW * 2);
const opBase = new Int16Array(MAX_VIEW * 2);
const opCur = new Int16Array(MAX_VIEW * 2);
/** Positions in the op list of the ops that may be deferred. */
const optIndex = new Int16Array(MAX_VIEW * 2);
const K_KEEP = 0;
const K_UPDATE = 1;
const K_CREATE = 2;
const K_REMOVE = 3;
const K_REPLACE = 4;
const K_STALE = 5;
const K_SKIP = 6;

/**
 * Encode `cur` (the true state, sorted by id) relative to `base` (what the
 * client has, or null) and fill `next` with what the client will hold after
 * applying it. `budgetBits` bounds the optional part. `rotate` is where
 * deferral started last time; the new value is returned.
 */
export function writeViewDelta(w: BitWriter, base: EntityView | null, cur: EntityView, next: EntityView, budgetBits: number, rotate: number): number {
  const nb = base ? base.count : 0;
  const nc = cur.count;
  let i = 0;
  let j = 0;
  let n = 0;
  let optional = 0;
  let optionalBits = 0;
  let written = 0;
  while (i < nb || j < nc) {
    const bid = i < nb ? base!.id[i]! : 0xffffffff;
    const cid = j < nc ? cur.id[j]! : 0xffffffff;
    if (bid < cid) {
      opKind[n] = K_REMOVE;
      opBase[n] = i++;
      written++;
    } else if (cid < bid) {
      opKind[n] = K_CREATE;
      opCur[n] = j++;
      optIndex[optional++] = n;
      optionalBits += createBits(cur, j - 1);
    } else {
      opBase[n] = i;
      opCur[n] = j;
      if (base!.gen[i] !== cur.gen[j] || base!.rev[i] !== cur.rev[j]) {
        opKind[n] = K_REPLACE;
        written++;
      } else if (base!.qx[i] === cur.qx[j] && base!.qy[i] === cur.qy[j] && base!.qz[i] === cur.qz[j] && base!.yaw[i] === cur.yaw[j] && base!.flags[i] === cur.flags[j] && base!.anim[i] === cur.anim[j]) {
        opKind[n] = K_KEEP;
      } else {
        opKind[n] = K_UPDATE;
        optIndex[optional++] = n;
        optionalBits += UPDATE_BITS;
      }
      i++;
      j++;
    }
    n++;
  }

  // Over budget: let a rotating window of optional ops through, defer the rest.
  if (optionalBits > budgetBits && optional > 0) {
    const start = rotate % optional;
    let allowed = 0;
    let bits = 0;
    for (; allowed < optional; allowed++) {
      const at = optIndex[(start + allowed) % optional]!;
      const cost = opKind[at] === K_CREATE ? createBits(cur, opCur[at]!) : UPDATE_BITS;
      if (bits + cost > budgetBits) break;
      bits += cost;
    }
    for (let t = allowed; t < optional; t++) {
      const k = optIndex[(start + t) % optional]!;
      opKind[k] = opKind[k] === K_CREATE ? K_SKIP : K_STALE;
    }
    written += allowed;
    rotate = (start + allowed) % optional;
  } else {
    written += optional;
    rotate = 0;
  }

  w.varint(written);
  let prev = 0;
  for (let k = 0; k < n; k++) {
    const kind = opKind[k]!;
    const bi = opBase[k]!;
    const ci = opCur[k]!;
    if (kind === K_KEEP || kind === K_STALE) {
      next.copyFrom(base!, bi);
      continue;
    }
    if (kind === K_SKIP) continue;
    const id = kind === K_REMOVE ? base!.id[bi]! : cur.id[ci]!;
    w.varint(id + 1 - prev);
    prev = id + 1;
    if (kind === K_REMOVE) {
      w.bits(OP_REMOVE, 2);
    } else if (kind === K_CREATE || kind === K_REPLACE) {
      w.bits(OP_CREATE, 2);
      w.varint(cur.kind[ci]!);
      w.bits(cur.gen[ci]!, 12);
      w.bits(cur.qx[ci]!, 22);
      w.bits(cur.qy[ci]!, 20);
      w.bits(cur.qz[ci]!, 22);
      w.bits(cur.yaw[ci]!, 10);
      w.bits(cur.flags[ci]!, 4);
      w.bits(cur.anim[ci]!, ANIM_BITS);
      w.bits(cur.rev[ci]!, 4);
      w.varint(cur.level[ci]!);
      const c0 = ci * 6;
      const colors = cur.colors;
      const coloured = (colors[c0]! | colors[c0 + 1]! | colors[c0 + 2]! | colors[c0 + 3]! | colors[c0 + 4]! | colors[c0 + 5]!) !== 0;
      w.bool(coloured);
      if (coloured) for (let q = 0; q < 6; q++) w.u8(colors[c0 + q]!);
      const name = cur.name[ci]!;
      w.bool(name !== "");
      if (name !== "") w.string(name);
      const look = cur.look[ci]!;
      w.bool(look !== null);
      if (look) for (let q = 0; q < LOOK_BYTES; q++) w.u8(look[q]!);
      next.copyFrom(cur, ci);
    } else {
      w.bits(OP_UPDATE, 2);
      const dx = cur.qx[ci]! - base!.qx[bi]!;
      const dy = cur.qy[ci]! - base!.qy[bi]!;
      const dz = cur.qz[ci]! - base!.qz[bi]!;
      const moved = dx !== 0 || dy !== 0 || dz !== 0;
      w.bool(moved);
      if (moved) {
        const small = dx >= -128 && dx <= 127 && dy >= -128 && dy <= 127 && dz >= -128 && dz <= 127;
        w.bool(small);
        if (small) {
          w.sbits(dx, 8);
          w.sbits(dy, 8);
          w.sbits(dz, 8);
        } else {
          w.bits(cur.qx[ci]!, 22);
          w.bits(cur.qy[ci]!, 20);
          w.bits(cur.qz[ci]!, 22);
        }
      }
      const turned = cur.yaw[ci] !== base!.yaw[bi];
      w.bool(turned);
      if (turned) w.bits(cur.yaw[ci]!, 10);
      const flagged = cur.flags[ci] !== base!.flags[bi];
      w.bool(flagged);
      if (flagged) w.bits(cur.flags[ci]!, 4);
      const changed = cur.anim[ci]! ^ base!.anim[bi]!;
      const motion = (changed & ANIM_MOTION_MASK) !== 0;
      w.bool(motion);
      if (motion) w.bits(cur.anim[ci]! & ANIM_MOTION_MASK, ANIM_MOTION_BITS);
      const look = ((changed >>> ANIM_LOOK_SHIFT) & LOOK_MASK) !== 0;
      w.bool(look);
      if (look) w.bits((cur.anim[ci]! >>> ANIM_LOOK_SHIFT) & LOOK_MASK, ANIM_LOOK_BITS);
      const action = changed >>> ANIM_ACTION_SHIFT !== 0;
      w.bool(action);
      if (action) w.bits(cur.anim[ci]! >>> ANIM_ACTION_SHIFT, ANIM_ACTION_BITS);
      next.copyFrom(cur, ci);
    }
  }
  return rotate;
}

/** Decode a delta against `base` into `next`. Returns false if the data is inconsistent. */
export function readViewDelta(r: BitReader, base: EntityView | null, next: EntityView): boolean {
  const nb = base ? base.count : 0;
  const count = r.varint();
  if (count > MAX_VIEW * 2) return false;
  let i = 0;
  let prev = 0;
  for (let k = 0; k < count; k++) {
    const gap = r.varint();
    if (gap === 0) return false;
    prev += gap;
    const id = prev - 1;
    const op = r.bits(2);
    while (i < nb && base!.id[i]! < id) if (!next.copyFrom(base!, i++)) return false;
    const present = i < nb && base!.id[i] === id;
    if (op === OP_REMOVE) {
      if (present) i++;
    } else if (op === OP_CREATE) {
      const kind = r.varint();
      const gen = r.bits(12);
      const qx = r.bits(22);
      const qy = r.bits(20);
      const qz = r.bits(22);
      const yaw = r.bits(10);
      const flags = r.bits(4);
      const anim = r.bits(ANIM_BITS);
      const rev = r.bits(4);
      const level = r.varint();
      if (r.bool()) for (let q = 0; q < 6; q++) scratchColors[q] = r.u8();
      else scratchColors.fill(0);
      const name = r.bool() ? r.string(MAX_NAME_LENGTH) : "";
      let look: Uint8Array | null = null;
      if (r.bool()) {
        look = new Uint8Array(LOOK_BYTES);
        for (let q = 0; q < LOOK_BYTES; q++) look[q] = r.u8();
      }
      if (present) i++;
      if (kind > 0xffff || level > 0xffff || !next.push(id, gen, kind, qx, qy, qz, yaw, flags, anim)) return false;
      next.appear(rev, level, scratchColors, 0, name, look);
    } else if (op === OP_UPDATE) {
      if (!present) return false;
      let qx = base!.qx[i]!;
      let qy = base!.qy[i]!;
      let qz = base!.qz[i]!;
      let yaw = base!.yaw[i]!;
      let flags = base!.flags[i]!;
      if (r.bool()) {
        if (r.bool()) {
          qx += r.sbits(8);
          qy += r.sbits(8);
          qz += r.sbits(8);
        } else {
          qx = r.bits(22);
          qy = r.bits(20);
          qz = r.bits(22);
        }
      }
      if (r.bool()) yaw = r.bits(10);
      if (r.bool()) flags = r.bits(4);
      let anim = base!.anim[i]!;
      if (r.bool()) anim = (anim & ~ANIM_MOTION_MASK) | r.bits(ANIM_MOTION_BITS);
      if (r.bool()) anim = (anim & ~(LOOK_MASK << ANIM_LOOK_SHIFT)) | (r.bits(ANIM_LOOK_BITS) << ANIM_LOOK_SHIFT);
      if (r.bool()) anim = (anim & ((1 << ANIM_ACTION_SHIFT) - 1)) | (r.bits(ANIM_ACTION_BITS) << ANIM_ACTION_SHIFT);
      if (!next.push(id, base!.gen[i]!, base!.kind[i]!, qx, qy, qz, yaw, flags, anim >>> 0)) return false;
      next.appear(base!.rev[i]!, base!.level[i]!, base!.colors, i * 6, base!.name[i]!, base!.look[i]!);
      i++;
    } else return false;
    if (r.overflow) return false;
  }
  while (i < nb) if (!next.copyFrom(base!, i++)) return false;
  return true;
}
