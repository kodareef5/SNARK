// The rows of a chunk's structures, as a chunk message carries them and as a save keeps them: one layout, written and read
// here. Rows go in ascending slots. Least bit first, as BitWriter writes:
//
//   row    := next(1) [gap]  form
//   gap    := which(2), then the slots passed over less one in 4, 8, 12 or 16 bits
//   form   := same(1) as the row before, IN_PLACE before the first | form(2)
//    0 IN_PLACE  swapped(1) [kind N16]  owner Nv  health
//    1 EMPTY
//    2 FREE      kind N16  x(15) z(15)  ysame(1)[svarint]  yaw N16  owner Nv  health
//    3 KEYED     sym  frame  anchor  level  turn  owner Nv  health
//   sym    := 1: the last keyed row's kind and direction | 01: those of the keyed row before that | 00 N20: kind(16) dir(4)
//   frame  := same(1) as the last keyed row's | N varint, and where that goes whole: def(1) [def]
//   def    := here(1) ? x(15) z(15) : x(32) z(32) ; ysame(1)[svarint] ; yaw N16 ; team: the row's owner(1) | varint
//   anchor := 0 the same | 1 a whole side on: turned(1) [dir(4)] | 2 four differences, each moved(1) [sbits(7)] | 3 four sbits(10)
//   level  := same(1) | the difference sbits(10)
//   turn   := same(1) | rot(2) flip(1)
//   health := full(1) | a stage(8) for an owned piece on the wire, else f32
//
// N is a value named once in the message and then by its place among those named (Named); frames keep 32 places. A keyed
// row's anchor, level, turn and step are told from the last keyed row of its kind and direction. The first such row starts
// from the last keyed row's anchor and level, unturned, a step running along its own direction. A height is told from the
// last height, a frame's level 0 or a free row's. A key's class and layer are its kind's form's.

import { STRUCT_UNITS } from "../coords.ts";
import { type BitReader, type BitWriter, Named } from "../net/codec.ts";
import type { FormTable } from "./lattice/forms.ts";
import type { FrameDef, Frames } from "./lattice/frames.ts";
import { DIRECTIONS, DIRS, LVL_MOST, M_MOST, SIDE, key0, key1, keyDir, keyFlip, keyLvl, keyM0, keyM1, keyM2, keyM3, keyRot } from "./lattice/module.ts";
import { STAGE_FULL, healthStage, stageHealth, type ChunkTable } from "./structures.ts";

export const ROW_IN_PLACE = 0;
export const ROW_EMPTY = 1;
export const ROW_FREE = 2;
export const ROW_KEYED = 3;

/** Frame definitions a session is held to have. One more, and both ends forget them all first. */
export const FRAMES_TOLD = 1024;
const FRAMES_NAMED = 32;
const NEAR_BITS = 7;
const NEAR_MOST = (1 << (NEAR_BITS - 1)) - 1;
const FAR_BITS = 10;
const LEVEL_BITS = 10;
/** The side of a chunk in lattice units, as 15 bits hold a place in it. */
const CHUNK_UNITS = 1 << 15;

const HEAD_BITS = 1 + 2 + 16 + 1 + 2;
const OWNER_BITS = 1 + 40;
const HEALTH_BITS = 1 + 32;
const HEIGHT_BITS = 1 + 40;
const DEF_BITS = 1 + 1 + 64 + HEIGHT_BITS + 17 + 1 + 40;
/** The most bits one row takes: a keyed row far from the last, in a frame defined with it. A free row takes 201. */
export const ROW_BITS_MOST = HEAD_BITS + 2 + 1 + 20 + 1 + 1 + 40 + DEF_BITS + 2 + 4 * FAR_BITS + 1 + LEVEL_BITS + 1 + 3 + OWNER_BITS + HEALTH_BITS;

export interface RowOptions {
  /** A kind as the bytes hold it, by runtime kind, and the reverse with 0 for a kind that is gone. A message holds runtime kinds. */
  readonly kindOut?: Uint16Array;
  readonly kindIn?: Uint16Array;
  /** Health that is not full goes as a float for every piece, as a save keeps it. */
  readonly exact?: boolean;
}

/** The direction a whole side along which is this difference, or -1. */
function stepOf(d0: number, d1: number, d2: number, d3: number): number {
  for (let e = 0; e < DIRECTIONS * 4; e += 4) if (d0 === SIDE * DIRS[e]! && d1 === SIDE * DIRS[e + 1]! && d2 === SIDE * DIRS[e + 2]! && d3 === SIDE * DIRS[e + 3]!) return e >> 2;
  return -1;
}

export class RowCoder {
  /** The slot of the row last written or read. */
  slot = -1;
  /** Frames defined by the rows written since `begin`, in order: theirs to count as told once the bytes are sent (`sent`). */
  readonly defined: number[] = [];

  // The row last read.
  form = ROW_IN_PLACE;
  /** The runtime kind of a free or keyed row, or the kind an in-place row changes to; 0 for none, or one that is gone. */
  kind = 0;
  /** That kind as the bytes held it. */
  saved = 0;
  /** A free row's place in metres and its turn. */
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  /** A keyed row's frame and key. The key is 0, 0 where its kind has no form or its numbers are out of range. */
  fr = 0;
  k0 = 0;
  k1 = 0;
  owner = 0;
  /** The frame this row defined, or null. */
  def: FrameDef | null = null;
  private full = false;
  private hp = 0;
  private dir = 0;

  /** Each kind's most health. A registry made again gives its own. */
  maxHp: Float32Array;
  private readonly forms: FormTable | null;
  private readonly kindOut: Uint16Array | null;
  private readonly kindIn: Uint16Array | null;
  private readonly exact: boolean;
  /** The chunk's corner in lattice units. */
  private x0 = 0;
  private z0 = 0;
  private height = 0;
  private last = ROW_IN_PLACE;
  private readonly kinds = new Named();
  private readonly yaws = new Named();
  private readonly owners = new Named();
  private readonly syms = new Named();
  private readonly frames = new Named(FRAMES_NAMED);
  /** The last keyed row's frame, anchor and level, and the last two syms with their places. */
  private frame = 0;
  private readonly at = new Int16Array(5);
  private sym0 = -1;
  private sym1 = -1;
  private ctx0 = 0;
  private ctx1 = 0;
  /** Per sym: its last row's anchor and level, the direction its last step ran, and its turn and flip. */
  private mem = new Int16Array(16 * 5);
  private along = new Uint8Array(16);
  private turn = new Uint8Array(16);
  /** The frames the reader is held to have been told, or null where frames are not defined in the rows (a save). */
  private told: Set<number> | null = null;
  private readonly scratch: FrameDef = { gid: 0, ox: 0, oy: 0, oz: 0, yaw: 0, team: 0 };

  constructor(forms: FormTable | null, maxHp: Float32Array, opts: RowOptions = {}) {
    this.forms = forms;
    this.maxHp = maxHp;
    this.kindOut = opts.kindOut ?? null;
    this.kindIn = opts.kindIn ?? null;
    this.exact = opts.exact ?? false;
  }

  /**
   * Begins the rows of the chunk whose corner is (x0, z0) metres. The first row's slot is told from `slot`. A writer for
   * a session gives the frames that session has been told.
   */
  begin(x0: number, z0: number, slot = -1, told: Set<number> | null = null): void {
    this.x0 = x0 * STRUCT_UNITS;
    this.z0 = z0 * STRUCT_UNITS;
    this.slot = slot;
    this.height = 0;
    this.last = ROW_IN_PLACE;
    this.kinds.reset();
    this.yaws.reset();
    this.owners.reset();
    this.syms.reset();
    this.frames.reset();
    this.frame = 0;
    this.at.fill(0);
    this.sym0 = this.sym1 = -1;
    this.told = told;
    this.defined.length = 0;
  }

  /** Counts the frames defined since `begin` as told: call once their bytes are sent. */
  sent(): void {
    const told = this.told;
    if (told) for (const gid of this.defined) tell(told, gid);
    this.defined.length = 0;
  }

  /** Room for the sym at place `i`, which starts from the last keyed row's anchor and level. */
  private open(i: number, dir: number): void {
    if (i >= this.along.length) {
      const mem = new Int16Array(this.mem.length * 2);
      mem.set(this.mem);
      this.mem = mem;
      const along = new Uint8Array(this.along.length * 2);
      along.set(this.along);
      this.along = along;
      const turn = new Uint8Array(this.turn.length * 2);
      turn.set(this.turn);
      this.turn = turn;
    }
    this.mem.set(this.at, i * 5);
    this.along[i] = dir;
    this.turn[i] = 0;
  }

  /**
   * Writes the row of slot `s` of `t`. In place, only its owner and health, and its kind if `swapped`. Otherwise an
   * empty slot says only that, and a row with a key goes by it, its frame defined first where the reader has not been told.
   */
  write(w: BitWriter, t: ChunkTable, s: number, inPlace: boolean, swapped: boolean, frames: Frames): void {
    const gap = s - this.slot - 1;
    this.slot = s;
    w.bool(gap === 0);
    if (gap !== 0) {
      const which = gap <= 16 ? 0 : gap <= 256 ? 1 : gap <= 4096 ? 2 : 3;
      w.bits(which, 2);
      w.bits(gap - 1, 4 * which + 4);
    }
    const kind = s < t.high ? t.kind[s]! : 0;
    const gid = t.fr !== null && kind !== 0 ? t.fr[s]! : 0;
    const form = inPlace ? ROW_IN_PLACE : kind === 0 ? ROW_EMPTY : gid !== 0 ? ROW_KEYED : ROW_FREE;
    w.bool(form === this.last);
    if (form !== this.last) w.bits(form, 2);
    this.last = form;
    if (form === ROW_EMPTY) return;
    const out = this.kindOut ? this.kindOut[kind]! : kind;
    const owner = t.owner[s]!;
    if (form === ROW_IN_PLACE) {
      w.bool(swapped);
      if (swapped) this.kinds.write(w, out, 16);
    } else if (form === ROW_FREE) {
      this.kinds.write(w, out, 16);
      w.bits(Math.round(t.x[s]! * STRUCT_UNITS) - this.x0, 15);
      w.bits(Math.round(t.z[s]! * STRUCT_UNITS) - this.z0, 15);
      this.writeHeight(w, Math.round(t.y[s]! * STRUCT_UNITS));
      this.yaws.write(w, t.yaw[s]!, 16);
    } else this.writeKey(w, out, gid, t.k0![s]!, t.k1![s]!, owner, frames);
    this.owners.write(w, owner, 0);
    const max = this.maxHp[kind]!;
    const hp = t.hp[s]!;
    // Nobody's piece (the map's) is told exactly, since its forms turn on its health. An owned one is told its stage.
    const stage = this.exact || owner === 0 ? (hp === max ? STAGE_FULL : 0) : healthStage(hp, max);
    w.bool(stage === STAGE_FULL);
    if (stage === STAGE_FULL) return;
    if (this.exact || owner === 0) w.f32(hp);
    else w.bits(stage, 8);
  }

  private writeHeight(w: BitWriter, y: number): void {
    w.bool(y === this.height);
    if (y !== this.height) w.svarint(y - this.height);
    this.height = y;
  }

  private writeKey(w: BitWriter, kind: number, gid: number, k0: number, k1: number, owner: number, frames: Frames): void {
    const dir = keyDir(k1);
    const sym = kind | (dir << 16);
    let i = this.ctx0;
    if (sym === this.sym0) w.bool(true);
    else {
      w.bool(false);
      w.bool(sym === this.sym1);
      if (sym === this.sym1) i = this.ctx1;
      else {
        this.syms.write(w, sym, 20);
        i = this.syms.at;
        if (this.syms.whole) this.open(i, dir);
      }
      this.sym1 = this.sym0;
      this.ctx1 = this.ctx0;
      this.sym0 = sym;
      this.ctx0 = i;
    }
    w.bool(gid === this.frame);
    if (gid !== this.frame) {
      this.frames.write(w, gid, 0);
      if (this.frames.whole) {
        const f = this.told !== null && !this.told.has(gid) && !this.defined.includes(gid) ? frames.get(gid) : undefined;
        w.bool(f !== undefined);
        if (f) {
          const x = f.ox - this.x0;
          const z = f.oz - this.z0;
          const here = x >= 0 && z >= 0 && x < CHUNK_UNITS && z < CHUNK_UNITS;
          w.bool(here);
          w.bits(here ? x : f.ox, here ? 15 : 32);
          w.bits(here ? z : f.oz, here ? 15 : 32);
          this.writeHeight(w, f.oy);
          this.yaws.write(w, f.yaw, 16);
          w.bool(f.team === owner);
          if (f.team !== owner) w.varint(f.team);
          this.defined.push(gid);
        }
      }
      this.frame = gid;
    }
    const mem = this.mem;
    const at = this.at;
    const o = i * 5;
    const a0 = keyM0(k0);
    const a1 = keyM1(k0);
    const a2 = keyM2(k0);
    const a3 = keyM3(k1);
    const d0 = a0 - mem[o]!;
    const d1 = a1 - mem[o + 1]!;
    const d2 = a2 - mem[o + 2]!;
    const d3 = a3 - mem[o + 3]!;
    if (d0 === 0 && d1 === 0 && d2 === 0 && d3 === 0) w.bits(0, 2);
    else {
      const step = stepOf(d0, d1, d2, d3);
      if (step >= 0) {
        w.bits(1, 2);
        w.bool(step !== this.along[i]);
        if (step !== this.along[i]) w.bits(step, 4);
        this.along[i] = step;
      } else if (Math.max(d0, d1, d2, d3) <= NEAR_MOST && Math.min(d0, d1, d2, d3) >= -NEAR_MOST - 1) {
        w.bits(2, 2);
        w.bool(d0 !== 0);
        if (d0 !== 0) w.sbits(d0, NEAR_BITS);
        w.bool(d1 !== 0);
        if (d1 !== 0) w.sbits(d1, NEAR_BITS);
        w.bool(d2 !== 0);
        if (d2 !== 0) w.sbits(d2, NEAR_BITS);
        w.bool(d3 !== 0);
        if (d3 !== 0) w.sbits(d3, NEAR_BITS);
      } else {
        w.bits(3, 2);
        w.sbits(a0, FAR_BITS);
        w.sbits(a1, FAR_BITS);
        w.sbits(a2, FAR_BITS);
        w.sbits(a3, FAR_BITS);
      }
    }
    const lvl = keyLvl(k1);
    w.bool(lvl === mem[o + 4]);
    if (lvl !== mem[o + 4]) w.sbits(lvl - mem[o + 4]!, LEVEL_BITS);
    const turn = keyRot(k1) | (keyFlip(k1) << 2);
    w.bool(turn === this.turn[i]);
    if (turn !== this.turn[i]) w.bits(turn, 3);
    this.turn[i] = turn;
    mem[o] = at[0] = a0;
    mem[o + 1] = at[1] = a1;
    mem[o + 2] = at[2] = a2;
    mem[o + 3] = at[3] = a3;
    mem[o + 4] = at[4] = lvl;
  }

  /** Reads the next row to this coder's fields. The caller looks at the reader's `overflow` once it has. */
  read(r: BitReader): void {
    if (r.bool()) this.slot++;
    else {
      const which = r.bits(2);
      this.slot += r.bits(4 * which + 4) + 2;
    }
    if (!r.bool()) this.last = r.bits(2);
    const form = (this.form = this.last);
    this.kind = this.saved = this.owner = 0;
    this.def = null;
    if (form === ROW_EMPTY) return;
    if (form === ROW_IN_PLACE) {
      if (r.bool()) this.saved = this.kinds.read(r, 16);
    } else if (form === ROW_FREE) {
      this.saved = this.kinds.read(r, 16);
      this.x = (this.x0 + r.bits(15)) / STRUCT_UNITS;
      this.z = (this.z0 + r.bits(15)) / STRUCT_UNITS;
      if (!r.bool()) this.height += r.svarint();
      this.y = this.height / STRUCT_UNITS;
      this.yaw = this.yaws.read(r, 16);
    } else this.readKey(r);
    const kind = (this.kind = this.kindIn ? (this.kindIn[this.saved] ?? 0) : this.saved);
    this.owner = this.owners.read(r, 0);
    this.full = r.bool();
    if (!this.full) this.hp = this.exact || this.owner === 0 ? r.f32() : r.bits(8);
    if (form !== ROW_KEYED) return;
    // readKey set it.
    const def = this.def as FrameDef | null;
    if (def && def.team === -1) def.team = this.owner;
    const forms = this.forms;
    const at = this.at;
    this.k0 = this.k1 = 0;
    if (!forms || kind >= forms.cls.length || forms.cls[kind]! < 0) return;
    if (Math.max(Math.abs(at[0]!), Math.abs(at[1]!), Math.abs(at[2]!), Math.abs(at[3]!)) > M_MOST || Math.abs(at[4]!) > LVL_MOST) return;
    const turn = this.turn[this.ctx0]!;
    this.k0 = key0(forms.cls[kind]!, at[0]!, at[1]!, at[2]!);
    this.k1 = key1(at[3]!, at[4]!, this.dir, forms.layer[kind]!, turn & 3, turn >> 2);
  }

  private readKey(r: BitReader): void {
    let i = this.ctx0;
    if (!r.bool()) {
      let sym = this.sym1;
      if (r.bool()) i = this.ctx1;
      else {
        sym = this.syms.read(r, 20);
        i = this.syms.at;
        if (this.syms.whole) this.open(i, (sym >>> 16) % DIRECTIONS);
      }
      this.sym1 = this.sym0;
      this.ctx1 = this.ctx0;
      this.sym0 = sym;
      this.ctx0 = i;
    }
    // A sym no row named leaves the kind 0, which no piece has.
    this.saved = this.sym0 < 0 ? 0 : this.sym0 & 0xffff;
    this.dir = this.sym0 < 0 ? 0 : (this.sym0 >>> 16) % DIRECTIONS;
    if (i < 0 || i >= this.along.length) i = this.ctx0 = 0;
    if (!r.bool()) {
      this.frame = this.frames.read(r, 0);
      if (this.frames.whole && r.bool()) {
        const def = (this.def = this.scratch);
        def.gid = this.frame;
        const here = r.bool();
        def.ox = here ? this.x0 + r.bits(15) : r.bits(32) | 0;
        def.oz = here ? this.z0 + r.bits(15) : r.bits(32) | 0;
        if (!r.bool()) this.height += r.svarint();
        def.oy = this.height;
        def.yaw = this.yaws.read(r, 16);
        def.team = r.bool() ? -1 : r.varint();
      }
    }
    this.fr = this.frame;
    const mem = this.mem;
    const at = this.at;
    const o = i * 5;
    const which = r.bits(2);
    at.set(mem.subarray(o, o + 5));
    if (which === 1) {
      if (r.bool()) this.along[i] = r.bits(4) % DIRECTIONS;
      const e = this.along[i]! * 4;
      for (let k = 0; k < 4; k++) at[k] = at[k]! + SIDE * DIRS[e + k]!;
    } else if (which === 2) {
      for (let k = 0; k < 4; k++) if (r.bool()) at[k] = at[k]! + r.sbits(NEAR_BITS);
    } else if (which === 3) {
      for (let k = 0; k < 4; k++) at[k] = r.sbits(FAR_BITS);
    }
    if (!r.bool()) at[4] = at[4]! + r.sbits(LEVEL_BITS);
    if (!r.bool()) this.turn[i] = r.bits(3);
    mem.set(at, o);
  }

  /** The health of the row last read, for a piece whose kind's most is `max`. */
  health(max: number): number {
    return this.full ? max : this.exact || this.owner === 0 ? this.hp : stageHealth(this.hp, max);
  }
}

/** Counts a frame as told in a session's set, which both ends empty before the one past FRAMES_TOLD. */
function tell(told: Set<number>, gid: number): void {
  if (told.size >= FRAMES_TOLD) told.clear();
  told.add(gid);
}

/**
 * The frames a client has had defined: the server's set of those it told, kept by the same rule. A message's definitions
 * count once its rows are read (`settle`), as the server counts them once it is sent.
 */
export class FramesTold {
  private readonly defs = new Map<number, FrameDef>();
  private readonly fresh: FrameDef[] = [];

  get size(): number {
    return this.defs.size + this.fresh.length;
  }

  clear(): void {
    this.defs.clear();
    this.fresh.length = 0;
  }

  get(gid: number): FrameDef | undefined {
    for (const def of this.fresh) if (def.gid === gid) return def;
    return this.defs.get(gid);
  }

  /** Keeps a copy of a definition a row gave. */
  take(def: FrameDef): void {
    this.fresh.push({ ...def });
  }

  /** Counts the definitions taken since the last call, in order. */
  settle(): void {
    for (const def of this.fresh) {
      if (this.defs.size >= FRAMES_TOLD) this.defs.clear();
      this.defs.set(def.gid, def);
    }
    this.fresh.length = 0;
  }
}
