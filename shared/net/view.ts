// A view is the sorted list of entities a client holds after applying one snapshot. A snapshot is encoded against the newest
// view the client has acknowledged, so a lost snapshot costs nothing. Entities absent from a delta are unchanged.
//
// Wire form after the snapshot header:
//   count varint, then per op in ascending id order:
//     id gap varint: this id minus the previous id (first: id + 1), so always >= 1
//     op 2 bits: 0 update, 1 create, 2 remove
//     create: kind varint, generation 12 bits, x 22, y 20, z 22, yaw 10, flags 4, pose state 32, then its appearance:
//             revision 4, level varint, [colours? 1][6 x 8], [name? 1][string], [look? 1][28 x 8], [gear? 1][6 x 16],
//             [team? 1][varint], [seat? 1][varint], [young? 1][span 32, grown 32]
//     update: [pos? 1][small? 1][3 x s8 | 22+20+22] [yaw? 1][10] [flags? 1][4]
//             [motion? 1][12] [look? 1][6] [action? 1][14]
//
// Appearance is sent only on create. A change bumps the entity's revision, and the next delta then sends a create for it again.

import { ANIM_ACTION_BITS, ANIM_ACTION_SHIFT, ANIM_LOOK_BITS, ANIM_LOOK_SHIFT, ANIM_MOTION_BITS, ANIM_MOTION_MASK } from "../anim/pose.ts";
import { LOOK_BYTES } from "../anim/look.ts";
import { WORLD_MIN_Y } from "../coords.ts";
import { GEAR_COUNT } from "../sim/entities.ts";
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
const CREATE_BITS = 24 + 2 + 24 + 12 + 64 + 10 + 4 + ANIM_BITS + 4 + 16 + 4 + 48 + 3;
/** In bytes. */
export const MAX_NAME_LENGTH = 72;

/** The appearance of every entity, by entity index. `EntityStore` has these columns. */
export interface Looks {
  readonly level: Uint16Array;
  /** Six bytes for each entity. */
  readonly colors: Uint8Array;
  readonly name: string[];
  readonly look: (Uint8Array | null)[];
  readonly gear: (Uint16Array | null)[];
  readonly team: Uint32Array;
  readonly seat: Uint32Array;
  readonly span: Uint32Array;
  readonly grown: Uint32Array;
}

/** An upper bound on the bits a create for entity `id` takes. */
function createBits(v: Looks, id: number): number {
  const name = v.name[id]!;
  // The optional fields: a look, gear, a team, a seat, an age.
  const look = (v.look[id] ? LOOK_BYTES * 8 : 0) + (v.gear[id] ? GEAR_COUNT * 16 : 0) + (v.team[id] !== 0 ? 40 : 0) + (v.seat[id] !== 0 ? 40 : 0) + (v.span[id] !== 0 || v.grown[id] !== 0 ? 64 : 0);
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

/** The fields a delta compares. The server keeps these for each view it sent, and reads appearance from the store when it writes a create. */
export class SentView {
  /** Server tick of this view. 0 marks an unused or invalid view. */
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
  /** Packed as `AnimState.pack` does. */
  readonly anim = new Uint32Array(MAX_VIEW);
  /** Appearance revision, 4 bits. A change makes the next delta send a create. */
  readonly rev = new Uint8Array(MAX_VIEW);
  /** Not sent. 1 for an entity whose changes go before the others when a snapshot cannot carry them all: a player, or a mount one drives. */
  readonly urgent = new Uint8Array(MAX_VIEW);

  push(id: number, gen: number, kind: number, qx: number, qy: number, qz: number, yaw: number, flags: number, anim: number, rev = 0): boolean {
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
    this.rev[n] = rev;
    this.count = n + 1;
    return true;
  }

  copyFrom(o: SentView, i: number): boolean {
    return this.push(o.id[i]!, o.gen[i]!, o.kind[i]!, o.qx[i]!, o.qy[i]!, o.qz[i]!, o.yaw[i]!, o.flags[i]!, o.anim[i]!, o.rev[i]!);
  }
}

/** A view as a client holds it: each entity with its appearance. */
export class EntityView extends SentView {
  readonly level = new Uint16Array(MAX_VIEW);
  readonly colors = new Uint8Array(MAX_VIEW * 6);
  readonly name: string[] = new Array<string>(MAX_VIEW).fill("");
  /** A survivor's look (LOOK_BYTES), shared by reference and never changed in place. */
  readonly look: (Uint8Array | null)[] = new Array<Uint8Array | null>(MAX_VIEW).fill(null);
  /** GEAR_COUNT content indices, shared by reference. */
  readonly gear: (Uint16Array | null)[] = new Array<Uint16Array | null>(MAX_VIEW).fill(null);
  /** As in `EntityStore`, each 0 for none. */
  readonly team = new Uint32Array(MAX_VIEW);
  readonly seat = new Uint32Array(MAX_VIEW);
  readonly span = new Uint32Array(MAX_VIEW);
  readonly grown = new Uint32Array(MAX_VIEW);

  /** For the entry just pushed. Call it after `appear`, which zeroes these fields. */
  belong(team: number, seat: number, span: number, grown: number): void {
    const n = this.count - 1;
    this.team[n] = team;
    this.seat[n] = seat;
    this.span[n] = span;
    this.grown[n] = grown;
  }

  /** For the entry just pushed. Reads six bytes of `colors` from `at`. */
  appear(rev: number, level: number, colors: Uint8Array, at: number, name: string, look: Uint8Array | null, gear: Uint16Array | null): void {
    const n = this.count - 1;
    this.rev[n] = rev;
    this.level[n] = level;
    for (let k = 0; k < 6; k++) this.colors[n * 6 + k] = colors[at + k]!;
    this.name[n] = name;
    this.look[n] = look;
    this.gear[n] = gear;
    this.team[n] = this.seat[n] = this.span[n] = this.grown[n] = 0;
  }

  override copyFrom(o: EntityView, i: number): boolean {
    if (!super.copyFrom(o, i)) return false;
    this.appear(o.rev[i]!, o.level[i]!, o.colors, i * 6, o.name[i]!, o.look[i]!, o.gear[i]!);
    this.belong(o.team[i]!, o.seat[i]!, o.span[i]!, o.grown[i]!);
    return true;
  }
}

export class ViewRing<V extends SentView> {
  private readonly views: V[] = [];

  constructor(make: () => V) {
    for (let i = 0; i < VIEW_RING; i++) this.views.push(make());
  }

  find(tick: number): V | null {
    const v = this.views[tick % VIEW_RING]!;
    return tick !== 0 && v.tick === tick ? v : null;
  }

  /** Returns the slot for `tick`, emptied. */
  alloc(tick: number): V {
    const v = this.views[tick % VIEW_RING]!;
    v.tick = tick;
    v.count = 0;
    return v;
  }

  at(i: number): V {
    return this.views[i]!;
  }

  clear(): void {
    for (const v of this.views) {
      v.tick = 0;
      v.count = 0;
    }
  }
}

const scratchColors = new Uint8Array(6);

// Encoder scratch, one entry per merged entity.
const opKind = new Uint8Array(MAX_VIEW * 2);
const opBase = new Int16Array(MAX_VIEW * 2);
const opCur = new Int16Array(MAX_VIEW * 2);
/** Positions in the op list of the ops that may be deferred: those of urgent entities, and the rest. */
const urgIndex = new Int16Array(MAX_VIEW * 2);
const optIndex = new Int16Array(MAX_VIEW * 2);
/** Bits each deferrable op takes. Exact for an update but for its id gap, an upper bound for a create. */
const opBits = new Uint16Array(MAX_VIEW * 2);
let admitted = 0;
const K_KEEP = 0;
const K_UPDATE = 1;
const K_CREATE = 2;
const K_REMOVE = 3;
const K_REPLACE = 4;
const K_STALE = 5;
const K_SKIP = 6;

function varintBits(v: number): number {
  return v < 0x80 ? 8 : v < 0x4000 ? 16 : v < 0x200000 ? 24 : 32;
}

/**
 * Lets through a window of the `count` ops in `list` that fits `budgetBits`, starting at `rotate`, and defers the rest.
 * Sets `admitted` and returns where the next window starts, so no entity starves.
 */
function admit(list: Int16Array, count: number, rotate: number, budgetBits: number): number {
  const start = rotate % count;
  let allowed = 0;
  let bits = 0;
  for (; allowed < count; allowed++) {
    const cost = opBits[list[(start + allowed) % count]!]!;
    if (bits + cost > budgetBits) break;
    bits += cost;
  }
  for (let t = allowed; t < count; t++) {
    const k = list[(start + t) % count]!;
    opKind[k] = opKind[k] === K_CREATE ? K_SKIP : K_STALE;
  }
  admitted = allowed;
  return (start + allowed) % count;
}

/**
 * Encodes `cur` (the true state, sorted by id) against `base` (the view the client has, or null) and fills `next` with the
 * view the client will hold after applying it. `budgetBits` bounds the deferrable ops. A deferred op is left out, and `next`
 * records the stale state the client is left with, so later deltas stay correct. Urgent entities are deferred last.
 * `rotate` is where deferral started last time. Returns its new value. `looks` gives the appearance a create carries. The entry of `cur` with id `skip` is left out,
 * so clients around one place can share one `cur`.
 */
export function writeViewDelta(w: BitWriter, base: SentView | null, cur: SentView, next: SentView, budgetBits: number, rotate: number, looks: Looks, skip = -1): number {
  const nb = base ? base.count : 0;
  const nc = cur.count;
  let i = 0;
  let j = 0;
  let n = 0;
  let optional = 0;
  let optionalBits = 0;
  let urgent = 0;
  let urgentBits = 0;
  let written = 0;
  /** One more than the id of the last op, for the size of the next op's id gap. A deferred op between two makes the real gap larger. */
  let last = 0;
  while (i < nb || j < nc) {
    const bid = i < nb ? base!.id[i]! : 0xffffffff;
    const cid = j < nc ? cur.id[j]! : 0xffffffff;
    if (cid === skip) {
      j++;
      continue;
    }
    let bits = 0;
    if (bid < cid) {
      opKind[n] = K_REMOVE;
      opBase[n] = i++;
      written++;
      last = bid + 1;
    } else if (cid < bid) {
      opKind[n] = K_CREATE;
      opCur[n] = j;
      bits = createBits(looks, cid);
      last = cid + 1;
    } else {
      opBase[n] = i;
      opCur[n] = j;
      if (base!.gen[i] !== cur.gen[j] || base!.rev[i] !== cur.rev[j]) {
        opKind[n] = K_REPLACE;
        written++;
        last = cid + 1;
      } else {
        const dx = cur.qx[j]! - base!.qx[i]!;
        const dy = cur.qy[j]! - base!.qy[i]!;
        const dz = cur.qz[j]! - base!.qz[i]!;
        const moved = dx !== 0 || dy !== 0 || dz !== 0;
        const changed = cur.anim[j]! ^ base!.anim[i]!;
        if (!moved && changed === 0 && base!.yaw[i] === cur.yaw[j] && base!.flags[i] === cur.flags[j]) {
          opKind[n] = K_KEEP;
          i++;
          j++;
          n++;
          continue;
        }
        opKind[n] = K_UPDATE;
        // The id gap, the op, and one bit for each of the six parts that may follow.
        bits = varintBits(cid + 1 - last) + 2 + 6;
        if (moved) bits += dx >= -128 && dx <= 127 && dy >= -128 && dy <= 127 && dz >= -128 && dz <= 127 ? 25 : 65;
        if (base!.yaw[i] !== cur.yaw[j]) bits += 10;
        if (base!.flags[i] !== cur.flags[j]) bits += 4;
        if ((changed & ANIM_MOTION_MASK) !== 0) bits += ANIM_MOTION_BITS;
        if (((changed >>> ANIM_LOOK_SHIFT) & LOOK_MASK) !== 0) bits += ANIM_LOOK_BITS;
        if (changed >>> ANIM_ACTION_SHIFT !== 0) bits += ANIM_ACTION_BITS;
        last = cid + 1;
      }
      i++;
    }
    if (bits !== 0) {
      opBits[n] = bits;
      if (cur.urgent[j] === 1) {
        urgIndex[urgent++] = n;
        urgentBits += bits;
      } else {
        optIndex[optional++] = n;
        optionalBits += bits;
      }
    }
    if (cid <= bid) j++;
    n++;
  }

  // Over budget. Urgent ops go first. A rotating window of the others goes through and the rest wait.
  if (urgentBits + optionalBits <= budgetBits) {
    written += urgent + optional;
    rotate = 0;
  } else if (urgentBits <= budgetBits) {
    written += urgent;
    if (optional > 0) {
      rotate = admit(optIndex, optional, rotate, budgetBits - urgentBits);
      written += admitted;
    }
  } else {
    rotate = admit(urgIndex, urgent, rotate, budgetBits);
    written += admitted;
    if (optional > 0) admit(optIndex, optional, 0, 0);
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
      w.varint(looks.level[id]!);
      const c0 = id * 6;
      const colors = looks.colors;
      const coloured = (colors[c0]! | colors[c0 + 1]! | colors[c0 + 2]! | colors[c0 + 3]! | colors[c0 + 4]! | colors[c0 + 5]!) !== 0;
      w.bool(coloured);
      if (coloured) for (let q = 0; q < 6; q++) w.u8(colors[c0 + q]!);
      const name = looks.name[id]!;
      w.bool(name !== "");
      if (name !== "") w.string(name);
      const look = looks.look[id]!;
      w.bool(look !== null);
      if (look) for (let q = 0; q < LOOK_BYTES; q++) w.u8(look[q]!);
      const gear = looks.gear[id]!;
      w.bool(gear !== null);
      if (gear) for (let q = 0; q < GEAR_COUNT; q++) w.u16(gear[q]!);
      // Team, seat and growth are each sent only when set.
      w.bool(looks.team[id] !== 0);
      if (looks.team[id] !== 0) w.varint(looks.team[id]!);
      w.bool(looks.seat[id] !== 0);
      if (looks.seat[id] !== 0) w.varint(looks.seat[id]!);
      const young = looks.span[id] !== 0 || looks.grown[id] !== 0;
      w.bool(young);
      if (young) {
        w.u32(looks.span[id]!);
        w.u32(looks.grown[id]!);
      }
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

/** Returns false if the data is inconsistent. */
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
      let gear: Uint16Array | null = null;
      if (r.bool()) {
        gear = new Uint16Array(GEAR_COUNT);
        for (let q = 0; q < GEAR_COUNT; q++) gear[q] = r.u16();
      }
      const team = r.bool() ? r.varint() : 0;
      const seat = r.bool() ? r.varint() : 0;
      const young = r.bool();
      const span = young ? r.u32() : 0;
      const grown = young ? r.u32() : 0;
      if (present) i++;
      if (kind > 0xffff || level > 0xffff || !next.push(id, gen, kind, qx, qy, qz, yaw, flags, anim)) return false;
      next.appear(rev, level, scratchColors, 0, name, look, gear);
      next.belong(team, seat, span, grown);
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
      next.appear(base!.rev[i]!, base!.level[i]!, base!.colors, i * 6, base!.name[i]!, base!.look[i]!, base!.gear[i]!);
      next.belong(base!.team[i]!, base!.seat[i]!, base!.span[i]!, base!.grown[i]!);
      i++;
    } else return false;
    if (r.overflow) return false;
  }
  while (i < nb) if (!next.copyFrom(base!, i++)) return false;
  return true;
}
