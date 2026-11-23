// What holds a city building up. A building's pieces are gathered into columns from its map slots (`gather`), and one
// sweep upward says of each whether it stands, hangs or falls (`judge`). Nothing is kept a piece between two judgements.
//
// A place is in half tiles of the building's frame (shared/world/buildings.ts): an odd number is a tile's middle, an even
// one an edge or a corner. A level is a height in storeys from the frame's base: a wall of storey 2 has its foot on level
// 2, and the slab it stands on lies at level 2, the lid of storey 1.
//
// The sweep, a level at a time:
// - A slab's cell is held where something that carries stands under one of its sides, corners or its middle, or a stair
//   is in its tile or the next. A cell that is not held stands between two that do, hangs beside one, and else falls.
//   A slab falls when more than half its cells do. Above the storeys walked, a level's slabs that touch are one roof,
//   which stands while a third of the cells at its edge are held.
// - Any other piece rides what carries under it or a standing slab cell it touches, by most of the places it covers. On
//   a hanging cell it hangs, where its shape has a hung form.
// - A piece with no family, a piece outside the frame and a piece somebody owns never fall.
//
// - In a building of 4 m bays, a cell beside a held one stands too: a slab reaches 4 m past what holds it.
//
// The ruins are composed loosely, so some pieces do not stand by this rule as the map placed them. Those are a
// building's pins (`pins`). A pinned piece stands while anything stands under or beside it: something that carries, at
// any height, under a place it covers or the next, a slab cell it touches, a cell next to one of its own. One that had
// none of those as placed always stands. With its pins, a building nothing has broken stands whole.
//
// A piece that falls leaves its heap where something still stands right under its foot (RESTS), and else nothing.

import { BREAK_FAMILIES, FORM_HEAP, FORM_HUNG, FORM_OPEN, formKind } from "../content/breaks.ts";
import type { Registry } from "../content/registry.ts";
import { YAW_UNITS } from "../coords.ts";
import { STOREY, STOREY_SLACK, blankFrame, type Buildings } from "./buildings.ts";
import type { StructureStore } from "./structures.ts";

/** What the rule says of a piece, in the low two bits of its answer. */
export const STANDS = 0, HANGS = 1, FALLS = 2;
export const VERDICT = 3;
/** Added to an answer: its foot is on the ground or on something that stands, so fallen it leaves its heap there. */
export const RESTS = 4;

/** A piece's part in the rule: one that never falls, a slab over tiles, or one that rides what is under it. */
export const PART_FIXED = 0, PART_PLATE = 1, PART_RIDER = 2;
/** A piece's bits: it carries what rests on it, its shape has a hung form, its slot is empty, it hangs already, it is a heap. */
export const BIT_CARRIES = 1, BIT_CAN_HANG = 2, BIT_GONE = 4, BIT_HUNG = 8, BIT_HEAP = 16;
/** It is being taken away: judged, and it holds nothing. A heap may lie on it. Its foot is on its level's floor. */
export const BIT_GHOST = 32, BIT_UNDER = 64, BIT_FOOTED = 128;

const family = (name: (typeof BREAK_FAMILIES)[number]): number => BREAK_FAMILIES.indexOf(name);
const SLAB = family("slab"), BAR = family("bar"), PIER = family("pier");
/** Families that carry what stands on them while whole or breached. A sill, a parapet, a pitched roof and a fixture carry nothing. */
const CARRIES = new Uint8Array(BREAK_FAMILIES.length);
for (const name of ["pier", "beam", "wall", "panel", "window", "store", "curtain", "clad", "balcony", "deck", "shell"] as const) CARRIES[family(name)] = 1;
/** A fin carries as a post does where it is this tall, in metres. A sill and a trim carry nothing. */
const POST = 3;
/** A slab reaches one bay of this many metres past the cell that holds it. */
const REACH = 4;
/** A pin: the piece stands while something it touches does, or always. */
export const PIN_WHILE = 1, PIN_ALWAYS = 2;
/** A piece's foot is on its level's floor within this many metres. */
const FOOT = 0.5;
/** A piece's reach is taken this much of a half tile wider, so one a little off its line still covers it. */
const SLACK = 0.25;
/** The share of a roof's edge cells that must be held, as one over it. */
const ROOF_SHARE = 3;
/** Passes in which a cell may come to stand between two that stand. */
const SPAN_PASSES = 4;

/** One building's pieces as columns, in the order of its handles and their runs. */
export class Pieces {
  n = 0;
  ref = new Uint32Array(64);
  part = new Uint8Array(64);
  /** The level its foot is on. */
  level = new Uint8Array(64);
  /** Storeys it is tall, 1 at least. */
  tall = new Uint8Array(64);
  bits = new Uint8Array(64);
  family = new Uint8Array(64);
  /** The half tiles it covers, each end counted, held within the frame. */
  u0 = new Int16Array(64);
  u1 = new Int16Array(64);
  v0 = new Int16Array(64);
  v1 = new Int16Array(64);
  cols = 0;
  rows = 0;
  /** Metres a tile. */
  bay = 8;
  /** Storeys walked: slabs above them are roofs. */
  playable = 0;
  /** Per tile, 1 where a stair stands. */
  stairs = new Uint8Array(0);

  /** Bytes held. */
  get bytes(): number {
    return this.ref.byteLength + this.part.byteLength * 5 + this.u0.byteLength * 4 + this.stairs.byteLength;
  }

  private grow(): void {
    const cap = this.ref.length * 2;
    const more = <T extends Uint32Array | Uint8Array | Int16Array>(a: T): T => {
      const b = new (a.constructor as new (n: number) => T)(cap);
      b.set(a);
      return b;
    };
    this.ref = more(this.ref);
    this.part = more(this.part);
    this.level = more(this.level);
    this.tall = more(this.tall);
    this.bits = more(this.bits);
    this.family = more(this.family);
    this.u0 = more(this.u0);
    this.u1 = more(this.u1);
    this.v0 = more(this.v0);
    this.v1 = more(this.v1);
  }

  /** Room for one more piece, and its place among them. */
  next(): number {
    if (this.n === this.ref.length) this.grow();
    return this.n++;
  }
}

const frame = blankFrame();

/**
 * Gathers the pieces of the building under `handles` (every sector's handle of it) from `structs` into `out`. With
 * `placed`, each is taken whole as the map set it down; else as its row stands now, those of `going` as being taken
 * away. Returns `out`.
 */
export function gather(buildings: Buildings, handles: readonly number[], structs: StructureStore, reg: Registry, placed: boolean, out: Pieces = new Pieces(), going: ReadonlySet<number> | null = null): Pieces {
  const first = handles[0]!;
  buildings.frame(first, frame);
  const { c, s, bay, cols, rows } = frame;
  out.n = 0;
  out.cols = cols;
  out.rows = rows;
  out.bay = bay;
  out.playable = buildings.playable(first);
  if (out.stairs.length < cols * rows) out.stairs = new Uint8Array(cols * rows);
  else out.stairs.fill(0, 0, cols * rows);
  const t = buildings.table(first), b = first & 0xffff;
  for (let q = t.stairAt[b]!; q < t.stairAt[b + 1]!; q++) if (t.stairI[q]! < cols && t.stairJ[q]! < rows) out.stairs[t.stairJ[q]! * cols + t.stairI[q]!] = 1;
  const [mostU, mostV] = [2 * cols, 2 * rows];
  for (const handle of handles) {
    buildings.eachRun(handle, (chunk, slot0, count) => {
      const rowsOf = structs.chunks[chunk];
      if (!rowsOf) return;
      for (let slot = slot0; slot < slot0 + count; slot++) {
        const k = out.next();
        out.ref[k] = chunk * 65536 + slot;
        const mapKind = structs.mapKind(chunk, slot);
        const kind = placed ? mapKind : rowsOf.kind[slot]!;
        const fam = reg.breakFamily[mapKind]!;
        out.family[k] = fam;
        out.part[k] = PART_FIXED;
        out.bits[k] = kind === 0 ? BIT_GONE : 0;
        out.level[k] = 0;
        out.tall[k] = 1;
        out.u0[k] = out.u1[k] = out.v0[k] = out.v1[k] = 0;
        if (fam === 0 || mapKind === 0 || (!placed && rowsOf.owner[slot] !== 0)) continue;
        // Its reach along the frame, by the quarter turn it is nearest to.
        const side = (((rowsOf.yaw[slot]! - frame.yaw) & (YAW_UNITS - 1)) + YAW_UNITS / 8) >> 14;
        const [hx, hz] = [structs.halfXOf(mapKind), structs.halfZOf(mapKind)];
        const eu = ((side & 1 ? hz : hx) / bay) * 2, ev = ((side & 1 ? hx : hz) / bay) * 2;
        const dx = rowsOf.x[slot]! - frame.x, dz = rowsOf.z[slot]! - frame.z;
        const pu = ((dx * c - dz * s) / bay) * 2 + cols, pv = ((dx * s + dz * c) / bay) * 2 + rows;
        let u0 = Math.ceil(pu - eu - SLACK), u1 = Math.floor(pu + eu + SLACK);
        let v0 = Math.ceil(pv - ev - SLACK), v1 = Math.floor(pv + ev + SLACK);
        if (u0 > u1) u0 = u1 = Math.round(pu);
        if (v0 > v1) v0 = v1 = Math.round(pv);
        // With its middle outside the frame it was placed by no tile: a porch on its own posts.
        const [mu, mv] = [Math.round(pu), Math.round(pv)];
        if (mu < 0 || mv < 0 || mu > mostU || mv > mostV) continue;
        out.u0[k] = u0 < 0 ? 0 : u0;
        out.u1[k] = u1 > mostU ? mostU : u1;
        out.v0[k] = v0 < 0 ? 0 : v0;
        out.v1[k] = v1 > mostV ? mostV : v1;
        const y = rowsOf.y[slot]! - frame.base;
        const foot = Math.floor((y + structs.low[mapKind]! + STOREY_SLACK) / STOREY);
        const height = Math.round((structs.top[mapKind]! - structs.low[mapKind]!) / STOREY);
        out.tall[k] = height < 1 ? 1 : height > 255 ? 255 : height;
        const form = kind === 0 ? 0 : reg.breakSet[kind] !== 0 ? reg.breakForm[kind]! : 0;
        let bits = out.bits[k]!;
        const carries = CARRIES[fam] === 1 || fam === SLAB || (fam === BAR && structs.top[mapKind]! - structs.low[mapKind]! >= POST);
        const ghost = going !== null && going.has(out.ref[k]!);
        if (ghost) bits |= BIT_GHOST;
        else if (kind !== 0 && (form < FORM_OPEN ? carries : form === FORM_OPEN && reg.breakBears[kind] === 1)) bits |= BIT_CARRIES;
        if (!ghost && carries && fam !== SLAB && form <= FORM_OPEN) bits |= BIT_UNDER;
        if (fam === SLAB || y + structs.low[mapKind]! - foot * STOREY <= FOOT) bits |= BIT_FOOTED;
        // A pier with no foot falls: only a slab and what is fixed to one hang.
        if (fam !== PIER && formKind(reg, mapKind, FORM_HUNG, 0) !== 0) bits |= BIT_CAN_HANG;
        if (form === FORM_HUNG) bits |= BIT_HUNG;
        if (form === FORM_HEAP) bits |= BIT_HEAP;
        out.bits[k] = bits;
        // A slab lies at the level its top is at. One that lies over no tile's middle rides as a wall does.
        const level = fam === SLAB ? Math.round((y + structs.top[mapKind]!) / STOREY) : foot;
        out.level[k] = level < 0 ? 0 : level > 255 ? 255 : level;
        const plate = fam === SLAB && odd(out.u0[k]!, out.u1[k]!) && odd(out.v0[k]!, out.v1[k]!);
        out.part[k] = plate ? PART_PLATE : PART_RIDER;
      }
    });
  }
  return out;
}

/** Whether a tile's middle lies in a..b. */
const odd = (a: number, b: number): boolean => b > a || (a & 1) === 1;

/** The ends of what a piece covering a..b holds up: without its two ends where it covers three places or more. */
const inner0 = (a: number, b: number): number => (b - a >= 2 ? a + 1 : a);
const inner1 = (a: number, b: number): number => (b - a >= 2 ? b - 1 : b);

/**
 * Scratch of `judge`, grown as buildings need. Per place, the level up to which something stands over it: that carries,
 * that holds a slab's cell, and that a heap may lie on.
 */
let rideTop = new Uint8Array(0), holdTop = new Uint8Array(0), restTop = new Uint8Array(0);
/** Per tile at the level in hand: 1 for a slab, 2 for one that carries; whether it is held; its state; and what stands there for a rider. */
let has = new Uint8Array(0), held = new Uint8Array(0), state = new Uint8Array(0), bears = new Uint8Array(0);
let mark = new Uint32Array(0), touched = new Uint32Array(0), queue = new Uint32Array(0), order = new Uint32Array(0);
const starts = new Uint32Array(258);
let marks = 0;

/** What the last judgement cost: pieces, places and cells looked at. */
export const cost = { ops: 0 };

/**
 * Says of each of `p`'s pieces whether it stands, hangs or falls, into `out`, with RESTS where its foot is on something
 * that stands. `pin` gives each piece's pin, if any. Returns how many do not stand.
 */
export function judge(p: Pieces, out: Uint8Array, pin: Uint8Array | null = null): number {
  const { n, cols, rows } = p;
  const W = 2 * cols + 1, H = 2 * rows + 1, tiles = cols * rows;
  if (rideTop.length < W * H) [rideTop, holdTop, restTop] = [new Uint8Array(W * H), new Uint8Array(W * H), new Uint8Array(W * H)];
  else {
    rideTop.fill(0, 0, W * H);
    holdTop.fill(0, 0, W * H);
    restTop.fill(0, 0, W * H);
  }
  if (has.length < tiles) {
    [has, held, state, bears] = [new Uint8Array(tiles), new Uint8Array(tiles), new Uint8Array(tiles), new Uint8Array(tiles)];
    [mark, touched, queue] = [new Uint32Array(tiles), new Uint32Array(tiles), new Uint32Array(tiles)];
  }
  if (order.length < n) order = new Uint32Array(n);
  // The pieces by level.
  starts.fill(0);
  let top = 0;
  for (let k = 0; k < n; k++) {
    out[k] = STANDS | RESTS;
    if (p.part[k] === PART_FIXED || (p.bits[k]! & BIT_GONE) !== 0) continue;
    starts[p.level[k]! + 2]!++;
    if (p.level[k]! > top) top = p.level[k]!;
  }
  for (let f = 0; f <= top; f++) starts[f + 2]! += starts[f + 1]!;
  for (let k = 0; k < n; k++) if (p.part[k] !== PART_FIXED && (p.bits[k]! & BIT_GONE) === 0) order[starts[p.level[k]! + 1]!++] = k;
  let down = 0;
  cost.ops = n;
  for (let f = 0; f <= top; f++) {
    const from = starts[f]!, to = starts[f + 1]!;
    if (from === to) continue;
    // Level 0 is the ground, which holds everything whose foot is on it.
    if (f > 0) down += level(p, out, pin, f, from, to);
    else for (let q = from; q < to; q++) if ((p.bits[order[q]!]! & BIT_FOOTED) === 0) out[order[q]!] = STANDS;
    // What stands holds up the level over its top.
    for (let q = from; q < to; q++) {
      const k = order[q]!, bits = p.bits[k]!;
      if (p.part[k] !== PART_RIDER || (out[k]! & VERDICT) !== STANDS || (bits & BIT_GHOST) !== 0) continue;
      const upTo = f + p.tall[k]! > 255 ? 255 : f + p.tall[k]!;
      if ((bits & BIT_UNDER) !== 0) for (let v = p.v0[k]!; v <= p.v1[k]!; v++) for (let u = p.u0[k]!; u <= p.u1[k]!; u++) if (restTop[v * W + u]! < upTo) restTop[v * W + u] = upTo;
      if ((bits & BIT_CARRIES) === 0 || p.family[k] === SLAB) continue;
      for (let v = p.v0[k]!; v <= p.v1[k]!; v++) for (let u = p.u0[k]!; u <= p.u1[k]!; u++) if (rideTop[v * W + u]! < upTo) rideTop[v * W + u] = upTo;
      const [a0, a1, b0, b1] = [inner0(p.u0[k]!, p.u1[k]!), inner1(p.u0[k]!, p.u1[k]!), inner0(p.v0[k]!, p.v1[k]!), inner1(p.v0[k]!, p.v1[k]!)];
      for (let v = b0; v <= b1; v++) for (let u = a0; u <= a1; u++) if (holdTop[v * W + u]! < upTo) holdTop[v * W + u] = upTo;
    }
  }
  return down;
}

/** Whether a slab that carries stands in `cell`. */
const stands = (cell: number): boolean => has[cell] === 2 && state[cell] === STANDS;

/** Whether a stair is in tile (i, j) of `p` or in one beside it. */
function stairBy(p: Pieces, i: number, j: number): boolean {
  const { cols, rows, stairs } = p, cell = j * cols + i;
  return (stairs[cell]! | (i > 0 ? stairs[cell - 1]! : 0) | (i + 1 < cols ? stairs[cell + 1]! : 0) | (j > 0 ? stairs[cell - cols]! : 0) | (j + 1 < rows ? stairs[cell + cols]! : 0)) === 1;
}

/** Whether `tops` reaches level `f` at a place within `reach` of tile-middle place (u, v). */
function over(tops: Uint8Array, u: number, v: number, f: number, W: number, H: number, reach: number): boolean {
  for (let dv = -reach; dv <= reach; dv++) {
    if (v + dv < 0 || v + dv >= H) continue;
    for (let du = -reach; du <= reach; du++) if (u + du >= 0 && u + du < W && tops[(v + dv) * W + u + du]! >= f) return true;
  }
  return false;
}

/** Judges the pieces `order[from..to)` of level `f` over what stands under it. Returns how many do not stand. */
function level(p: Pieces, out: Uint8Array, pin: Uint8Array | null, f: number, from: number, to: number): number {
  const { cols, rows } = p;
  const W = 2 * cols + 1, H = 2 * rows + 1;
  let down = 0, cells = 0, plates = 0;
  // The level's slab cells.
  for (let q = from; q < to; q++) {
    const k = order[q]!;
    if (p.part[k] !== PART_PLATE || (p.bits[k]! & BIT_GHOST) !== 0) continue;
    plates++;
    const carries = (p.bits[k]! & BIT_CARRIES) !== 0;
    for (let v = p.v0[k]! | 1; v <= p.v1[k]!; v += 2) {
      for (let u = p.u0[k]! | 1; u <= p.u1[k]!; u += 2) {
        const cell = (v >> 1) * cols + (u >> 1);
        if (has[cell] === 0) {
          touched[cells++] = cell;
          held[cell] = bears[cell] = 0;
          state[cell] = FALLS;
          has[cell] = 1;
        }
        if (carries) has[cell] = 2;
      }
    }
  }
  cost.ops += cells * 9;
  for (let q = 0; q < cells; q++) {
    const cell = touched[q]!;
    const i = cell % cols, j = (cell - i) / cols;
    if (!over(holdTop, 2 * i + 1, 2 * j + 1, f, W, H, 1) && !stairBy(p, i, j)) continue;
    held[cell] = 1;
    state[cell] = STANDS;
  }
  if (f > p.playable) {
    // A roof: the level's cells that touch are one plate.
    marks++;
    for (let q = 0; q < cells; q++) {
      if (mark[touched[q]!] === marks) continue;
      let head = 0, tail = 0, edges = 0, borne = 0;
      queue[tail++] = touched[q]!;
      mark[touched[q]!] = marks;
      while (head < tail) {
        const cell = queue[head++]!;
        const i = cell % cols, j = (cell - i) / cols;
        let inside = 0;
        for (let side = 0; side < 4; side++) {
          const ni = i + (side === 0 ? -1 : side === 1 ? 1 : 0), nj = j + (side === 2 ? -1 : side === 3 ? 1 : 0);
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows || has[nj * cols + ni] === 0) continue;
          inside++;
          if (mark[nj * cols + ni] !== marks) {
            mark[nj * cols + ni] = marks;
            queue[tail++] = nj * cols + ni;
          }
        }
        if (inside < 4) {
          edges++;
          borne += held[cell]!;
        }
      }
      cost.ops += tail * 4;
      const all = borne * ROOF_SHARE >= edges ? STANDS : FALLS;
      for (let k = 0; k < tail; k++) state[queue[k]!] = all;
    }
  } else if (cells > 0) {
    // A cell that is not held stands between two that stand, each way.
    for (let pass = 0, moved = true; pass < SPAN_PASSES && moved; pass++) {
      moved = false;
      cost.ops += cells;
      for (let q = 0; q < cells; q++) {
        const cell = touched[q]!;
        if (state[cell] === STANDS) continue;
        const i = cell % cols, j = (cell - i) / cols;
        if ((i > 0 && i + 1 < cols && stands(cell - 1) && stands(cell + 1)) || (j > 0 && j + 1 < rows && stands(cell - cols) && stands(cell + cols))) {
          state[cell] = STANDS;
          moved = true;
        }
      }
    }
    // Beside one that stands it hangs; in short bays, beside one that is held it stands.
    const reach = p.bay <= REACH;
    for (let q = 0; q < cells; q++) {
      const cell = touched[q]!;
      if (state[cell] === STANDS) continue;
      const i = cell % cols, j = (cell - i) / cols;
      let best = 0;
      for (let side = 0; side < 4; side++) {
        const ni = i + (side === 0 ? -1 : side === 1 ? 1 : 0), nj = j + (side === 2 ? -1 : side === 3 ? 1 : 0);
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows || !stands(nj * cols + ni)) continue;
        const near = reach && held[nj * cols + ni] === 1 ? 2 : 1;
        if (near > best) best = near;
      }
      // Kept apart until every cell has looked, so none stands by one that only now does.
      bears[cell] = best;
    }
    for (let q = 0; q < cells; q++) {
      const cell = touched[q]!;
      if (bears[cell] !== 0) state[cell] = bears[cell] === 2 ? STANDS : HANGS;
      bears[cell] = 0;
    }
  }
  // Each slab by most of its cells.
  let waits = 0;
  for (let q = from; q < to; q++) {
    const k = order[q]!;
    if (p.part[k] !== PART_PLATE) continue;
    const ghost = (p.bits[k]! & BIT_GHOST) !== 0;
    let all = 0, fell = 0, hung = 0, rests = 0;
    for (let v = p.v0[k]! | 1; v <= p.v1[k]!; v += 2) {
      for (let u = p.u0[k]! | 1; u <= p.u1[k]!; u += 2) {
        const st = ghost ? FALLS : state[(v >> 1) * cols + (u >> 1)]!;
        all++;
        if (st === FALLS) fell++;
        else if (st === HANGS) hung++;
        if (rests === 0 && over(restTop, u, v, f, W, H, 1)) rests = RESTS;
      }
    }
    let verdict = fell * 2 > all ? FALLS : (fell + hung) * 2 >= all ? ((p.bits[k]! & (BIT_CAN_HANG | BIT_HUNG)) !== 0 ? HANGS : FALLS) : STANDS;
    if (verdict !== STANDS && pin !== null && pin[k] !== 0 && !ghost) {
      if (pin[k] === PIN_ALWAYS) verdict = STANDS;
      else waits++;
    }
    out[k] = verdict | rests;
  }
  // A pinned slab stands while a cell of its own or one beside them does not fall, or something stands under it or them.
  for (let moved = waits > 0; moved; ) {
    moved = false;
    for (let q = from; q < to; q++) {
      const k = order[q]!;
      if (p.part[k] !== PART_PLATE || (out[k]! & VERDICT) === STANDS || pin![k] !== PIN_WHILE || (p.bits[k]! & BIT_GHOST) !== 0) continue;
      let on = false;
      for (let v = p.v0[k]! | 1; v <= p.v1[k]! && !on; v += 2) {
        for (let u = p.u0[k]! | 1; u <= p.u1[k]! && !on; u += 2) {
          const i = u >> 1, j = v >> 1, cell = j * cols + i;
          on = state[cell] !== FALLS || (i > 0 && has[cell - 1] !== 0 && state[cell - 1] !== FALLS) || (i + 1 < cols && has[cell + 1] !== 0 && state[cell + 1] !== FALLS) || (j > 0 && has[cell - cols] !== 0 && state[cell - cols] !== FALLS) || (j + 1 < rows && has[cell + cols] !== 0 && state[cell + cols] !== FALLS) || over(rideTop, u, v, 1, W, H, 2);
        }
      }
      cost.ops += 25;
      if (!on) continue;
      out[k] = STANDS | (out[k]! & RESTS);
      moved = true;
      for (let v = p.v0[k]! | 1; v <= p.v1[k]!; v += 2) for (let u = p.u0[k]! | 1; u <= p.u1[k]!; u += 2) state[(v >> 1) * cols + (u >> 1)] = STANDS;
    }
  }
  // What a cell gives a rider: 2 where a slab that carries stands, 1 where one hangs.
  for (let q = from; q < to && plates > 0; q++) {
    const k = order[q]!;
    if (p.part[k] !== PART_PLATE || (p.bits[k]! & BIT_GHOST) !== 0) continue;
    const verdict = out[k]! & VERDICT;
    if (verdict !== STANDS) down++;
    if (verdict === FALLS || (p.bits[k]! & BIT_CARRIES) === 0) continue;
    const now = verdict === STANDS ? 2 : 1;
    for (let v = p.v0[k]! | 1; v <= p.v1[k]!; v += 2) for (let u = p.u0[k]! | 1; u <= p.u1[k]!; u += 2) if (bears[(v >> 1) * cols + (u >> 1)]! < now) bears[(v >> 1) * cols + (u >> 1)] = now;
  }
  // What rides at this level, by most of the places it holds to.
  for (let q = from; q < to; q++) {
    const k = order[q]!;
    if (p.part[k] !== PART_RIDER) continue;
    const [a0, a1, b0, b1] = [inner0(p.u0[k]!, p.u1[k]!), inner1(p.u0[k]!, p.u1[k]!), inner0(p.v0[k]!, p.v1[k]!), inner1(p.v0[k]!, p.v1[k]!)];
    const bits = p.bits[k]!;
    let all = 0, sound = 0, loose = 0, rests = 0;
    for (let v = b0; v <= b1; v++) {
      for (let u = a0; u <= a1; u++) {
        all++;
        const cell = cellBy(u, v, cols, W, H);
        const on = rideTop[v * W + u]! >= f ? 2 : cell;
        if (on === 2) sound++;
        else if (on === 1) loose++;
        if (cell === 2 || restTop[v * W + u]! >= f) rests = RESTS;
      }
    }
    cost.ops += all * 5;
    let verdict = sound * 2 >= all ? STANDS : (sound + loose) * 2 >= all && (bits & (BIT_CAN_HANG | BIT_HUNG)) !== 0 ? HANGS : FALLS;
    if (verdict !== STANDS && pin !== null && pin[k] !== 0 && (bits & BIT_GHOST) === 0) {
      // Pinned, it stands while anything stands under a place it covers or the next, or a cell it touches does.
      let on = pin[k] === PIN_ALWAYS;
      for (let v = p.v0[k]!; v <= p.v1[k]! && !on; v++) for (let u = p.u0[k]!; u <= p.u1[k]!; u++) if (cellBy(u, v, cols, W, H) !== 0 || over(rideTop, u, v, 1, W, H, 1)) on = true;
      cost.ops += 9;
      if (on) verdict = STANDS;
    }
    out[k] = verdict | ((bits & BIT_FOOTED) !== 0 ? rests : 0);
    if (verdict !== STANDS && (bits & BIT_GHOST) === 0) down++;
  }
  for (let q = 0; q < cells; q++) has[touched[q]!] = held[touched[q]!] = bears[touched[q]!] = 0;
  return down;
}

/** What the slab cells that touch place (u, v) give a rider: one cell for a tile's middle, two for an edge, four for a corner. */
function cellBy(u: number, v: number, cols: number, W: number, H: number): number {
  let best = 0;
  for (let tv = (v - 1) | 1; tv <= v + 1; tv += 2) {
    if (tv < 0 || tv >= H) continue;
    for (let tu = (u - 1) | 1; tu <= u + 1; tu += 2) {
      if (tu < 0 || tu >= W) continue;
      const cell = (tv >> 1) * cols + (tu >> 1);
      if (has[cell] !== 0 && bears[cell]! > best) best = bears[cell]!;
    }
  }
  return best;
}

/**
 * A building's pins from its pieces gathered as the map placed them (`gather` with `placed`): for each piece, 0, PIN_WHILE
 * or PIN_ALWAYS, into `pin`. `out` is scratch of the same length. Returns how many are pinned.
 */
export function pins(p: Pieces, pin: Uint8Array, out: Uint8Array): number {
  pin.fill(0, 0, p.n);
  if (judge(p, out) === 0) return 0;
  let n = 0;
  for (let k = 0; k < p.n; k++) {
    if ((out[k]! & VERDICT) === STANDS) continue;
    pin[k] = PIN_WHILE;
    n++;
  }
  // What still does not stand has nothing under or beside it.
  if (judge(p, out, pin) !== 0) for (let k = 0; k < p.n; k++) if ((out[k]! & VERDICT) !== STANDS) pin[k] = PIN_ALWAYS;
  return n;
}
