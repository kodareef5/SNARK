// A base's interior: the pieces of a chunk seen only from rooms its own pieces close. Pieces snap to rooms 3 m a side on
// the lattice of the piece they were joined to, whose axes are whole-number vectors at any turn (shared/world/frame.ts),
// so a room is found by whole numbers, exactly. Outside air floods through the rooms from the open air round them and
// from any room whose floor reaches past the chunk, so a chunk's border hides nothing. A wall, a floor and a ceiling
// close a room's side, a doorframe only while a shut door stands in it, a window frame never. A piece is shell where a
// room it closes, or any its mesh reaches, is outside air; the rest is seen only from inside its rooms.

import { RISE } from "../../../content/building.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS } from "../../../shared/coords.ts";
import { HALF_SIDE, frameAxes } from "../../../shared/world/frame.ts";
import { ROLE_CEILING, ROLE_DOOR, ROLE_FOUNDATION, ROLE_WALL } from "../../../shared/world/snap.ts";
import type { ChunkTable } from "../../../shared/world/structures.ts";

/** What a kind is to the rooms it stands among. A thing stands in them and closes nothing. */
const THING = 0;
const FLOOR = 1;
const WALL = 2;
const DOORWAY = 3;
const WINDOW = 4;
const SHUT = 5;
const OPEN = 6;

/** A room's `closed` bits: its side toward the next room along a, toward the next along b, and its floor; a doorway on either side, and a shut door in it. */
const SIDE_A = 1;
const SIDE_B = 2;
const BELOW = 4;
const DOORWAY_A = 8;
const DOORWAY_B = 16;
const SHUT_A = 32;
const SHUT_B = 64;
/** The bit a piece of each FORM sets on the room it closes, by its face: a floor, a side along a, a side along b. */
const BITS: readonly (readonly number[])[] = [[0, 0, 0], [BELOW, 0, 0], [0, SIDE_A, SIDE_B], [0, DOORWAY_A, DOORWAY_B], [0, 0, 0], [0, SHUT_A, SHUT_B], [0, 0, 0]];

/** Per door slot: open when the rooms were found, and between outside air and an inside room then. */
export const DOOR_OPEN = 1;
export const DOOR_FRONTIER = 2;

/** Lattice units of a storey and of a chunk's side. */
const STOREY = RISE * STRUCT_UNITS;
const SPAN = CHUNK_SIZE * STRUCT_UNITS;
const QUARTER = 16384;
/** Rooms of open air kept round a lattice's own, from which outside air floods in. Past them all is outside air. */
const MARGIN = 1;
/** Past these a chunk's pieces are all shell: lattices in one chunk, and rooms of all of them. */
const MOST_LATTICES = 64;
const MOST_ROOMS = 1 << 21;
/**
 * Metres a mesh may reach past a room's side, and down into its floor, and still be hidden. A wall is seen into between
 * its boards: an inner wall's end 0.1 m into an outer one shows from outside.
 */
const IN_SIDE = 0.005;
const IN_FLOOR = 0.05;
/** Metres of slack in telling a piece's shape. */
const SLACK = 0.01;
/** Rooms a side's mesh reaches besides the two it closes: past its ends, over its storey's top, under its floor, or any other. */
const REACH_ENDS = 1;
const REACH_UP = 2;
const REACH_DOWN = 4;
const REACH_ELSE = 8;

/** The rooms of one lattice: its turn, its axes (whole-number, a half side long), the residues of its rooms' middles, and its grid. */
class Lattice {
  index = 0;
  within = 0;
  c = 0;
  s = 0;
  /** The square of an axis' length, and how many cells a metre is. */
  l2 = 0;
  per = 0;
  /** Residues of a room's middle along each axis (mod 2 l2) and of a storey's floor (mod STOREY), in lattice units. */
  ru = 0;
  rv = 0;
  ry = 0;
  a0 = 0;
  b0 = 0;
  k0 = 0;
  na = 0;
  nb = 0;
  nk = 0;
  closed = new Uint8Array(0);
  /** 1 for a room of outside air, and as it was before the last flood. */
  outside = new Uint8Array(0);
  was = new Uint8Array(0);

  /** Whether room (a, b, k) is outside air, as anything off the grid is. */
  open(a: number, b: number, k: number): boolean {
    const i = a - this.a0, j = b - this.b0, l = k - this.k0;
    return i < 0 || j < 0 || l < 0 || i >= this.na || j >= this.nb || l >= this.nk || this.outside[(l * this.nb + j) * this.na + i] === 1;
  }

  /**
   * Whether every room the box reaches is inside: about (x, y, z) metres, `da` and `db` metres along the lattice's axes
   * and `dy` up, `ha`, `hb` and `hy` metres to each side.
   */
  holds(x: number, y: number, z: number, da: number, db: number, dy: number, ha: number, hb: number, hy: number, under: number): boolean {
    const m = 2 * this.l2;
    const X = x * STRUCT_UNITS, Z = z * STRUCT_UNITS;
    const ca = (X * this.c - Z * this.s - this.ru) / m + da * this.per;
    const cb = (X * this.s + Z * this.c - this.rv) / m + db * this.per;
    const sa = Math.max(0, ha - IN_SIDE) * this.per, sb = Math.max(0, hb - IN_SIDE) * this.per;
    const low = ((y + dy - hy + IN_FLOOR) * STRUCT_UNITS - this.ry) / STOREY;
    const high = ((y + dy + hy + under) * STRUCT_UNITS - this.ry) / STOREY;
    const k0 = Math.floor(low), k1 = Math.max(k0, Math.ceil(high) - 1);
    for (let a = Math.ceil(ca - sa - 0.5), a1 = Math.floor(ca + sa + 0.5); a <= a1; a++) {
      for (let b = Math.ceil(cb - sb - 0.5), b1 = Math.floor(cb + sb + 0.5); b <= b1; b++) {
        for (let k = k0; k <= k1; k++) if (this.open(a, b, k)) return false;
      }
    }
    return true;
  }
}

/**
 * A chunk's rooms, kept with what is drawn of it: its lattices, and per slot the room each piece closes or stands before,
 * so that after a few pieces change only theirs are found again. Asked each frame whether the camera is near an inside one.
 */
export class Rooms {
  /** The chunk's version they stand at, or -1 where they are to be found whole; and pieces left out since (RoomFinder.update). */
  version = -1;
  loose = 0;
  readonly lattices: Lattice[] = [];
  /** Per slot: its lattice, or -1; its room in that lattice's grid; and its FORM * 4 plus how it bounds the room (0 under it, 1 or 2 a side along a or b). */
  lattice = new Int8Array(0);
  cell = new Int32Array(0);
  code = new Uint8Array(0);
  /** Per slot, 0 for a piece seen only from inside rooms; and each door's DOOR_ flags. */
  shell = new Uint8Array(0);
  readonly doors = new Map<number, number>();
  /** Whether any room is inside, and the box round those rooms in metres. */
  inside = false;
  readonly box = new Float64Array(6);

  /** Whether a ball of `r` metres about (x, y, z) reaches an inside room. */
  near(x: number, y: number, z: number, r: number): boolean {
    const box = this.box;
    if (!this.inside || x < box[0]! - r || y < box[1]! - r || z < box[2]! - r || x > box[3]! + r || y > box[4]! + r || z > box[5]! + r) return false;
    for (const l of this.lattices) {
      const m = 2 * l.l2;
      const X = x * STRUCT_UNITS, Z = z * STRUCT_UNITS;
      const ca = (X * l.c - Z * l.s - l.ru) / m, cb = (X * l.s + Z * l.c - l.rv) / m;
      const ck = (y * STRUCT_UNITS - l.ry) / STOREY;
      const ra = r * l.per, rk = (r * STRUCT_UNITS) / STOREY;
      for (let a = Math.ceil(ca - ra - 0.5), a1 = Math.floor(ca + ra + 0.5); a <= a1; a++) {
        for (let b = Math.ceil(cb - ra - 0.5), b1 = Math.floor(cb + ra + 0.5); b <= b1; b++) {
          for (let k = Math.floor(ck - rk), k1 = Math.floor(ck + rk); k <= k1; k++) if (!l.open(a, b, k)) return true;
        }
      }
    }
    return false;
  }
}

/** Finds which of a chunk's pieces are shell. One per scene; its scratch grows to the largest chunk. */
export class RoomFinder {
  /**
   * Per kind: what it is to its rooms, which rooms its mesh reaches besides those it closes (REACH_), its half height in
   * lattice units, and its mesh's box about its origin in its own frame (middle x, y, z, then half x, y, z) in metres.
   */
  private readonly form: Uint8Array;
  private readonly reach: Uint8Array;
  private readonly halfY: Int32Array;
  private readonly box: Float32Array;
  /** The slots changed since the rooms were last found (update), how many, and whether any closed or opened a side. */
  private changed = new Int32Array(0);
  private count = 0;
  private touched = false;
  /** Per slot of a chunk being found whole: its room along a, b and up. */
  private ra = new Int32Array(0);
  private rb = new Int32Array(0);
  private rk = new Int32Array(0);
  private queue = new Int32Array(0);
  private readonly axes = new Int32Array(4);
  private readonly ext = new Int32Array(MOST_LATTICES * 6);

  /** Metres a mesh must end under its storey's top: the most any floor's coarser levels lie from its finest. */
  private under = 0;

  /** `meshes` are the pack's, with their bounds over every level; `errors` each level's error by mesh (AssetTable). */
  constructor(reg: Registry, meshOf: Uint16Array, meshes: readonly { readonly center: readonly number[]; readonly half: readonly number[] }[], errors: readonly (readonly number[])[]) {
    const n = reg.defs.length;
    this.form = new Uint8Array(n);
    this.reach = new Uint8Array(n);
    this.halfY = new Int32Array(n);
    this.box = new Float32Array(n * 6);
    const half = HALF_SIDE / STRUCT_UNITS;
    const { start, box, hulls } = reg.parts;
    for (let k = 1; k < n; k++) {
      const mesh = meshes[meshOf[k]!];
      for (let i = 0; i < 3 && mesh; i++) {
        this.box[k * 6 + i] = mesh.center[i]!;
        this.box[k * 6 + 3 + i] = mesh.half[i]!;
      }
      this.halfY[k] = Math.round(reg.halfY[k]! * STRUCT_UNITS);
      const role = reg.role[k]!;
      if (hulls && hulls.start[k + 1]! > hulls.start[k]!) continue;
      const p = start[k]! * 6, boxes = start[k + 1]! - start[k]!;
      // One box over the whole of a room's floor or side, laid in the middle of it.
      const whole = boxes === 1 && Math.abs(box[p]!) < SLACK && Math.abs(box[p + 2]!) < SLACK && box[p + 3]! >= half - SLACK;
      if ((role === ROLE_FOUNDATION || role === ROLE_CEILING) && whole && box[p + 5]! >= half - SLACK) this.form[k] = FLOOR;
      else if (role === ROLE_WALL) this.form[k] = reg.doorway[k] === 1 ? DOORWAY : whole && box[p + 4]! >= reg.halfY[k]! - SLACK ? WALL : WINDOW;
      else if (role === ROLE_DOOR) {
        // A shut door lies across its doorway, in the wall's plane.
        let across = true;
        for (let q = p; q < p + boxes * 6; q += 6) across &&= box[q + 5]! < box[q + 3]! && Math.abs(box[q + 2]!) <= box[q + 5]!;
        this.form[k] = across ? SHUT : OPEN;
      }
    }
    // A mesh reaching a storey's top shows where a ceiling's coarser level sinks under it.
    for (let k = 1; k < n; k++) if (this.form[k] === FLOOR) for (const e of errors[meshOf[k]!] ?? []) this.under = Math.max(this.under, e);
    for (let k = 1; k < n; k++) {
      // Which rooms its mesh reaches besides those it closes: its floor's column, or its side's storey of the two rooms.
      const b = this.box, at = k * 6, form = this.form[k]!;
      const along = Math.abs(b[at]!) + b[at + 3]!, across = Math.abs(b[at + 2]!) + b[at + 5]!;
      const foot = b[at + 1]! - b[at + 4]! + IN_FLOOR + reg.halfY[k]!, top = b[at + 1]! + b[at + 4]! + this.under + reg.halfY[k]!;
      if (form === FLOOR) this.reach[k] = along > half + IN_SIDE || across > half + IN_SIDE ? REACH_ELSE : 0;
      else if (form !== THING) this.reach[k] = (along > half + IN_SIDE ? REACH_ENDS : 0) | (top > RISE ? REACH_UP : 0) | (foot < 0 ? REACH_DOWN : 0) | (across > 2 * half + IN_SIDE ? REACH_ELSE : 0);
    }
  }

  /** 0 for a kind that is a shut door, 1 for an open one, -1 for any other. */
  door(kind: number): number {
    const form = this.form[kind];
    return form === SHUT ? 0 : form === OPEN ? 1 : -1;
  }

  /**
   * Finds which pieces of the chunk at (x0, z0) metres are seen only from inside rooms, into `rooms`: what was found of
   * the chunk before, brought up to date by the slots changed since where they are few. Whether any piece is inside, and
   * so whether its `shell` and `doors` stand.
   */
  find(t: ChunkTable, x0: number, z0: number, rooms: Rooms): boolean {
    const kept = rooms.version >= 0 && this.update(t, rooms);
    if (!kept && !this.lay(t, rooms)) {
      rooms.version = -1;
      return (rooms.inside = false);
    }
    rooms.version = t.version;
    // Where the changes closed or opened no room's side, or left every room as open to the air as it was, only the
    // pieces changed are sorted again.
    let same = kept;
    if (!kept || this.touched) {
      let inside = 0;
      for (const l of rooms.lattices) {
        if (same) l.was.set(l.outside);
        l.outside.fill(0);
        inside += this.flood(l, x0, z0);
        for (let at = 0; same && at < l.outside.length; at++) same = l.was[at] === l.outside[at];
      }
      rooms.inside = inside > 0;
    }
    if (same) {
      for (let i = 0; i < this.count; i++) {
        rooms.doors.delete(this.changed[i]!);
        this.sort(t, rooms, this.changed[i]!);
      }
    } else {
      rooms.doors.clear();
      for (let slot = 0; slot < t.high; slot++) this.sort(t, rooms, slot);
      const box = rooms.box;
      box[0] = box[1] = box[2] = Infinity;
      box[3] = box[4] = box[5] = -Infinity;
      for (const l of rooms.lattices) this.bound(l, box);
    }
    return rooms.inside;
  }

  /** Finds the rooms of every piece of the chunk afresh. Whether a room may be shut in. */
  private lay(t: ChunkTable, rooms: Rooms): boolean {
    const lattices = rooms.lattices;
    lattices.length = 0;
    if (rooms.lattice.length < t.high) {
      const n = Math.max(t.high, rooms.lattice.length * 2);
      rooms.lattice = new Int8Array(n);
      rooms.cell = new Int32Array(n);
      rooms.code = new Uint8Array(n);
      rooms.shell = new Uint8Array(n);
    }
    if (this.ra.length < t.high) {
      const n = Math.max(t.high, this.ra.length * 2);
      this.ra = new Int32Array(n);
      this.rb = new Int32Array(n);
      this.rk = new Int32Array(n);
    }
    rooms.lattice.fill(-1);
    rooms.loose = 0;
    const axes = this.axes, forms = this.form, halfY = this.halfY;
    const lattice = rooms.lattice, code = rooms.code, ra = this.ra, rb = this.rb, rk = this.rk;
    const kinds = t.kind, xs = t.x, ys = t.y, zs = t.z, yaws = t.yaw;
    let within = -1, c = 0, s = 0, l2 = 0;
    // The lattice the last piece stood on: its index (-1 for none), turn and residues.
    let li = -1, lw = -1, lu = 0, lv = 0, ly = 0;
    let floors = 0, walls = 0;
    // Each lattice's least room along a, b and up, then its most.
    const ext = this.ext;
    for (let i = 0; i < ext.length; i++) ext[i] = i % 6 < 3 ? 1 << 30 : -(1 << 30);
    for (let slot = 0; slot < t.high; slot++) {
      const kind = kinds[slot]!;
      const form = forms[kind]!;
      if (kind === 0 || form === THING) continue;
      const yaw = yaws[slot]!;
      if ((yaw & (QUARTER - 1)) !== within) {
        within = yaw & (QUARTER - 1);
        frameAxes(within, axes);
        c = axes[0]!;
        s = axes[2]!;
        l2 = c * c + s * s;
      }
      const X = xs[slot]! * STRUCT_UNITS, Z = zs[slot]! * STRUCT_UNITS, Y = ys[slot]! * STRUCT_UNITS;
      // A floor's room is over its middle, from its top. A side's is the room before it along the axis it faces, from its foot.
      let u = X * c - Z * s, v = X * s + Z * c, level = Y + halfY[kind]!, face = 0;
      if (form !== FLOOR) {
        level = Y - halfY[kind]!;
        face = (yaw >> 14) & 1 ? 1 : 2;
        if (face === 1) u -= l2;
        else v -= l2;
      }
      const m = 2 * l2;
      let a = (u - lu) / m, b = (v - lv) / m, k = (level - ly) / STOREY;
      if (lw !== within || (a | 0) !== a || (b | 0) !== b || (k | 0) !== k) {
        lu = ((u % m) + m) % m;
        lv = ((v % m) + m) % m;
        ly = ((level % STOREY) + STOREY) % STOREY;
        lw = within;
        li = this.latticeOf(lattices, within, lu, lv, ly);
        if (li < 0) {
          if (lattices.length === MOST_LATTICES) {
            lw = -1;
            continue;
          }
          const l = new Lattice();
          l.index = li = lattices.length;
          l.within = within;
          l.c = c;
          l.s = s;
          l.l2 = l2;
          l.per = STRUCT_UNITS / (2 * Math.sqrt(l2));
          l.ru = lu;
          l.rv = lv;
          l.ry = ly;
          lattices.push(l);
        }
        a = (u - lu) / m;
        b = (v - lv) / m;
        k = (level - ly) / STOREY;
      }
      lattice[slot] = li;
      ra[slot] = a;
      rb[slot] = b;
      rk[slot] = k;
      code[slot] = form * 4 + face;
      if (form === FLOOR) floors++;
      else if (form === WALL || form === DOORWAY) walls++;
      const e = li * 6, k0 = face === 0 ? k - 1 : k, a1 = face === 1 ? a + 1 : a, b1 = face === 2 ? b + 1 : b;
      if (a < ext[e]!) ext[e] = a;
      if (b < ext[e + 1]!) ext[e + 1] = b;
      if (k0 < ext[e + 2]!) ext[e + 2] = k0;
      if (a1 > ext[e + 3]!) ext[e + 3] = a1;
      if (b1 > ext[e + 4]!) ext[e + 4] = b1;
      if (k > ext[e + 5]!) ext[e + 5] = k;
    }
    // A room is shut in by a floor under it, another over it and four sides.
    if (floors < 2 || walls < 4) return false;
    let total = 0;
    for (const l of lattices) {
      const e = l.index * 6;
      l.a0 = ext[e]! - MARGIN;
      l.b0 = ext[e + 1]! - MARGIN;
      l.k0 = ext[e + 2]! - MARGIN;
      l.na = ext[e + 3]! - ext[e]! + 1 + 2 * MARGIN;
      l.nb = ext[e + 4]! - ext[e + 1]! + 1 + 2 * MARGIN;
      l.nk = ext[e + 5]! - ext[e + 2]! + 1 + 2 * MARGIN;
      total += l.na * l.nb * l.nk;
    }
    if (total > MOST_ROOMS) return false;
    for (const l of lattices) {
      l.closed = new Uint8Array(l.na * l.nb * l.nk);
      l.outside = new Uint8Array(l.na * l.nb * l.nk);
      l.was = new Uint8Array(l.na * l.nb * l.nk);
    }
    const cell = rooms.cell;
    for (let slot = 0; slot < t.high; slot++) {
      if (lattice[slot]! < 0) continue;
      const l = lattices[lattice[slot]!]!;
      const at = ((rk[slot]! - l.k0) * l.nb + rb[slot]! - l.b0) * l.na + ra[slot]! - l.a0;
      cell[slot] = at;
      l.closed[at]! |= BITS[code[slot]! >> 2]![code[slot]! & 3]!;
    }
    return true;
  }

  /**
   * Brings the rooms up to date with the slots changed since they were found, where those are few. A piece standing past
   * the rooms held, as one that grows the base does, is left out: it closes nothing, and is shell, until they are found
   * whole, once as many are left out as would have them found whole now. Whether it could.
   */
  private update(t: ChunkTable, rooms: Rooms): boolean {
    if (rooms.lattice.length < t.high) return false;
    const mod = t.mod, since = rooms.version, most = Math.max(64, t.high >> 4);
    let changed = rooms.loose;
    for (let slot = 0; slot < t.high; slot++) if (mod[slot]! > since && ++changed > most) return false;
    const axes = this.axes, lattices = rooms.lattices;
    this.count = 0;
    this.touched = false;
    if (this.changed.length < most) this.changed = new Int32Array(most);
    for (let slot = 0; slot < t.high; slot++) {
      if (mod[slot]! <= since) continue;
      this.changed[this.count++] = slot;
      // What the slot held closes nothing now. No two pieces close one side, as they would stand in each other.
      const was = rooms.lattice[slot]!;
      if (was >= 0) lattices[was]!.closed[rooms.cell[slot]!]! &= ~BITS[rooms.code[slot]! >> 2]![rooms.code[slot]! & 3]!;
      this.touched ||= was >= 0;
      rooms.lattice[slot] = -1;
      const kind = t.kind[slot]!, form = this.form[kind]!;
      if (kind === 0 || form === THING) continue;
      const yaw = t.yaw[slot]!, within = yaw & (QUARTER - 1);
      frameAxes(within, axes);
      const c = axes[0]!, s = axes[2]!, l2 = c * c + s * s, m = 2 * l2;
      const X = t.x[slot]! * STRUCT_UNITS, Z = t.z[slot]! * STRUCT_UNITS, Y = t.y[slot]! * STRUCT_UNITS;
      let u = X * c - Z * s, v = X * s + Z * c, level = Y + this.halfY[kind]!, face = 0;
      if (form !== FLOOR) {
        level = Y - this.halfY[kind]!;
        face = (yaw >> 14) & 1 ? 1 : 2;
        if (face === 1) u -= l2;
        else v -= l2;
      }
      const ru = ((u % m) + m) % m, rv = ((v % m) + m) % m, ry = ((level % STOREY) + STOREY) % STOREY;
      const li = this.latticeOf(lattices, within, ru, rv, ry);
      const l = li >= 0 ? lattices[li]! : null;
      const i = l ? (u - ru) / m - l.a0 : 0, j = l ? (v - rv) / m - l.b0 : 0, k = l ? (level - ry) / STOREY - l.k0 : 0;
      // Its rooms must lie off the grid's edge, as every room a piece closes does.
      if (!l || i < 1 || j < 1 || k < (face === 0 ? 2 : 1) || i + (face === 1 ? 1 : 0) > l.na - 2 || j + (face === 2 ? 1 : 0) > l.nb - 2 || k > l.nk - 2) {
        rooms.loose++;
        continue;
      }
      const at = (k * l.nb + j) * l.na + i;
      rooms.lattice[slot] = li;
      rooms.cell[slot] = at;
      rooms.code[slot] = form * 4 + face;
      l.closed[at]! |= BITS[form]![face]!;
      this.touched = true;
    }
    return true;
  }

  /** The index in `lattices` of the one of this turn and these residues, or -1. */
  private latticeOf(lattices: readonly Lattice[], within: number, ru: number, rv: number, ry: number): number {
    for (let i = 0; i < lattices.length; i++) {
      const o = lattices[i]!;
      if (o.within === within && o.ru === ru && o.rv === rv && o.ry === ry) return i;
    }
    return -1;
  }

  /** Sorts the piece in `slot`: 0 in the rooms' `shell` where it is seen only from inside rooms, else 1; and sets a door's flags. */
  private sort(t: ChunkTable, rooms: Rooms, slot: number): void {
    const kind = t.kind[slot]!, li = rooms.lattice[slot]!, lattices = rooms.lattices;
    let hidden = false;
    if (kind === 0) hidden = false;
    else if (li >= 0) {
      // The room it stands on or before, and the room under it or beyond it.
      const l = lattices[li]!, out = l.outside, at = rooms.cell[slot]!, form = rooms.code[slot]! >> 2, face = rooms.code[slot]! & 3, plane = l.na * l.nb;
      const other = face === 0 ? at - plane : face === 1 ? at + 1 : at + l.na;
      const near = out[at]!, far = out[other]!;
      if (form >= SHUT) rooms.doors.set(slot, (form === OPEN ? DOOR_OPEN : 0) | (near !== far ? DOOR_FRONTIER : 0));
      const r = this.reach[kind]!;
      hidden = near === 0 && far === 0;
      if (hidden && (r & REACH_ELSE) !== 0) hidden = this.within(t, slot, l);
      else if (hidden && r !== 0) {
        // The rooms past a side's ends lie along the other axis; over and under it, those and its own two a storey off.
        const ends = (r & REACH_ENDS) === 0 ? 0 : face === 1 ? l.na : 1;
        hidden = clear(out, at, other, ends) && ((r & REACH_UP) === 0 || clear(out, at + plane, other + plane, ends)) && ((r & REACH_DOWN) === 0 || clear(out, at - plane, other - plane, ends));
      }
    } else {
      for (let i = 0; !hidden && i < lattices.length; i++) hidden = this.within(t, slot, lattices[i]!);
    }
    rooms.shell[slot] = hidden ? 0 : 1;
  }

  /**
   * Floods outside air through a lattice's rooms. Returns how many are inside. The grid's edge is outside air, and so is
   * the room within it next to it, since every side a piece closes lies between two rooms of a piece; so only rooms off
   * the edge are walked, and each of their neighbours is on the grid.
   */
  private flood(l: Lattice, x0: number, z0: number): number {
    const { na, nb, nk, closed, outside } = l;
    const plane = na * nb, n = plane * nk;
    if (this.queue.length < n) this.queue = new Int32Array(Math.max(n, this.queue.length * 2));
    const queue = this.queue;
    let tail = 0;
    const m = 2 * l.l2;
    const X0 = x0 * STRUCT_UNITS, Z0 = z0 * STRUCT_UNITS;
    for (let j = 0; j < nb; j++) {
      for (let i = 0; i < na; i++) {
        const edge = i === 0 || j === 0 || i === na - 1 || j === nb - 1;
        // A room whose floor reaches past the chunk is open to what the chunk does not hold.
        let rim = edge || i === 1 || j === 1 || i === na - 2 || j === nb - 2;
        const u = l.ru + (l.a0 + i) * m, v = l.rv + (l.b0 + j) * m;
        for (let corner = 0; corner < 4 && !rim; corner++) {
          const cu = u + (corner & 1 ? l.l2 : -l.l2), cv = v + (corner & 2 ? l.l2 : -l.l2);
          const X = (cu * l.c + cv * l.s) / l.l2 - X0, Z = (cv * l.c - cu * l.s) / l.l2 - Z0;
          rim = X < 0 || Z < 0 || X > SPAN || Z > SPAN;
        }
        for (let k = 0, at = j * na + i; k < nk; k++, at += plane) {
          if (edge || k === 0 || k === nk - 1) outside[at] = 1;
          else if (rim || k === 1 || k === nk - 2) {
            outside[at] = 1;
            queue[tail++] = at;
          }
        }
      }
    }
    // A doorway is closed by a shut door in it.
    const shutA = (f: number): boolean => (f & SIDE_A) !== 0 || (f & (DOORWAY_A | SHUT_A)) === (DOORWAY_A | SHUT_A);
    const shutB = (f: number): boolean => (f & SIDE_B) !== 0 || (f & (DOORWAY_B | SHUT_B)) === (DOORWAY_B | SHUT_B);
    for (let head = 0; head < tail; ) {
      const at = queue[head++]!;
      const f = closed[at]!;
      let next = at + 1;
      if (!shutA(f) && outside[next] === 0) {
        outside[next] = 1;
        queue[tail++] = next;
      }
      next = at - 1;
      if (!shutA(closed[next]!) && outside[next] === 0) {
        outside[next] = 1;
        queue[tail++] = next;
      }
      next = at + na;
      if (!shutB(f) && outside[next] === 0) {
        outside[next] = 1;
        queue[tail++] = next;
      }
      next = at - na;
      if (!shutB(closed[next]!) && outside[next] === 0) {
        outside[next] = 1;
        queue[tail++] = next;
      }
      next = at + plane;
      if ((closed[next]! & BELOW) === 0 && outside[next] === 0) {
        outside[next] = 1;
        queue[tail++] = next;
      }
      next = at - plane;
      if ((f & BELOW) === 0 && outside[next] === 0) {
        outside[next] = 1;
        queue[tail++] = next;
      }
    }
    return Math.max(0, (na - 2) * (nb - 2) * (nk - 2)) - tail;
  }

  /** Whether every room the mesh of the piece in `slot` reaches is an inside room of `l`. */
  private within(t: ChunkTable, slot: number, l: Lattice): boolean {
    const kind = t.kind[slot]!, yaw = t.yaw[slot]!;
    const box = this.box, at = kind * 6;
    const cx = box[at]!, cy = box[at + 1]!, cz = box[at + 2]!, hx = box[at + 3]!, hy = box[at + 4]!, hz = box[at + 5]!;
    // Turned square to the lattice, its box is its mesh's; turned otherwise, as far as the mesh reaches at any turn.
    if ((yaw & (QUARTER - 1)) !== l.within) {
      const side = Math.hypot(Math.abs(cx) + hx, Math.abs(cz) + hz);
      return l.holds(t.x[slot]!, t.y[slot]!, t.z[slot]!, 0, 0, cy, side, side, hy, this.under);
    }
    const q = (yaw >> 14) & 3;
    const da = q === 0 ? cx : q === 1 ? cz : q === 2 ? -cx : -cz;
    const db = q === 0 ? cz : q === 1 ? -cx : q === 2 ? -cz : cx;
    return q & 1 ? l.holds(t.x[slot]!, t.y[slot]!, t.z[slot]!, da, db, cy, hz, hx, hy, this.under) : l.holds(t.x[slot]!, t.y[slot]!, t.z[slot]!, da, db, cy, hx, hz, hy, this.under);
  }

  /** Grows `box` round a lattice's inside rooms, in metres. */
  private bound(l: Lattice, box: Float64Array): void {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, k0 = Infinity, k1 = -Infinity;
    for (let k = 0, at = 0; k < l.nk; k++) {
      for (let j = 0; j < l.nb; j++) {
        for (let i = 0; i < l.na; i++, at++) {
          if (l.outside[at] === 1) continue;
          if (i < a0) a0 = i;
          if (i > a1) a1 = i;
          if (j < b0) b0 = j;
          if (j > b1) b1 = j;
          if (k < k0) k0 = k;
          k1 = k;
        }
      }
    }
    if (a0 > a1) return;
    const m = 2 * l.l2;
    for (let corner = 0; corner < 4; corner++) {
      const u = l.ru + (l.a0 + (corner & 1 ? a1 : a0)) * m + (corner & 1 ? l.l2 : -l.l2);
      const v = l.rv + (l.b0 + (corner & 2 ? b1 : b0)) * m + (corner & 2 ? l.l2 : -l.l2);
      const x = (u * l.c + v * l.s) / l.l2 / STRUCT_UNITS, z = (v * l.c - u * l.s) / l.l2 / STRUCT_UNITS;
      box[0] = Math.min(box[0]!, x);
      box[2] = Math.min(box[2]!, z);
      box[3] = Math.max(box[3]!, x);
      box[5] = Math.max(box[5]!, z);
    }
    box[1] = Math.min(box[1]!, (l.ry + (l.k0 + k0) * STOREY) / STRUCT_UNITS);
    box[4] = Math.max(box[4]!, (l.ry + (l.k0 + k1 + 1) * STOREY) / STRUCT_UNITS);
  }
}

/** Whether rooms `at` and `other` are inside, and with `ends` the rooms that far either side of each. */
function clear(out: Uint8Array, at: number, other: number, ends: number): boolean {
  return out[at] === 0 && out[other] === 0 && (ends === 0 || (out[at - ends] === 0 && out[at + ends] === 0 && out[other - ends] === 0 && out[other + ends] === 0));
}
