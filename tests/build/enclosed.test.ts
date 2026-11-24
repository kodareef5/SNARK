// The air a base shuts in (shared/world/lattice/rooms.ts), and the pieces the renderer leaves out for it
// (client/core/render/rooms.ts). The flood is asked of rows written by key against a table of every form, placed and
// planned, with no store and no registry: it reads nothing else. The renderer's finder is asked of a store, with each
// kind's own box for its mesh.

import { expect, test } from "bun:test";
import { RoomFinder, Rooms } from "../../client/core/render/rooms.ts";
import { FORMS, PLANNED_FORMS } from "../../content/building/forms.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS, chunkCx, chunkCz } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { classAxis, classAxis60, worldOf } from "../../shared/world/lattice/basis.ts";
import { LEVEL_M, makeFormTable, setForm, type FormDef } from "../../shared/world/lattice/forms.ts";
import { Frame, poseOf, type LatticeKey, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_STEP, CLS_TRIANGLE, CLS_VERTEX, DIRS, canon, canonical, dirTurn, elementCorners, key0, key1 } from "../../shared/world/lattice/module.ts";
import { Cells, NO_REF, Occupancy, formCells } from "../../shared/world/lattice/occupancy.ts";
import { Enclosure, SENSE_BODY, SENSE_SIGHT, enclose, indoorsAt } from "../../shared/world/lattice/rooms.ts";
import { Found, StructureStore } from "../../shared/world/structures.ts";
import { boxBase, layBase } from "../../tools/bench/base.ts";
import { metric, mirror } from "../fixtures/slots.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

const ROWS: [string, FormDef][] = [...Object.entries(FORMS), ...Object.entries(PLANNED_FORMS)];
const forms = makeFormTable(ROWS.length + 1);
ROWS.forEach(([, f], i) => setForm(forms, i + 1, f));
const K = (name: string): number => ROWS.findIndex((r) => r[0] === name) + 1;

type At = readonly [number, number, number, number];
const t = new Int32Array(16);
const cells = new Cells();

/** The key of a piece of form `name` on the element of class `cls` named from corner `at` along `d`, at `lvl`, turned `rot`. */
function keyOf(table: typeof forms, kind: number, cls: number, at: At, d: number, lvl: number, rot = 0): [number, number] {
  t.set(at);
  canonical(cls, t, 0, dirTurn(d, 0), t, 4);
  return [key0(cls, t[4]!, t[5]!, t[6]!), key1(t[7]!, lvl, canon.dir, table.layer[kind]!, rot, 0)];
}

/** Pieces told to one flood by name, and taken away again. */
class Built {
  readonly enc: Enclosure;
  readonly pieces = new Map<number, [kind: number, k0: number, k1: number]>();
  private next = 1;

  constructor(sense = SENSE_SIGHT) {
    this.enc = new Enclosure(forms, sense);
  }

  put(name: string, cls: number, at: At, d: number, lvl: number, rot = 0): number {
    const [k0, k1] = keyOf(forms, K(name), cls, at, d, lvl, rot);
    const ref = this.next++;
    this.pieces.set(ref, [K(name), k0, k1]);
    this.enc.add(K(name), k0, k1, ref);
    return ref;
  }

  take(ref: number): void {
    const [kind, k0, k1] = this.pieces.get(ref)!;
    this.pieces.delete(ref);
    this.enc.remove(kind, k0, k1, ref);
  }

  /** Floods, and gives the air cells found, those in rooms, and the rooms. */
  flood(): number[] {
    expect(this.enc.flood()).toBe(true);
    return [this.enc.found.cells, this.enc.found.inside, this.enc.found.rooms];
  }

  borders(ref: number): boolean {
    return this.enc.borders(...this.pieces.get(ref)!);
  }

  indoors(cls: number, at: At, d: number, lvl: number): boolean {
    return this.enc.indoorsAt(...keyOf(forms, K(cls === CLS_SQUARE ? "foundation" : "triangle_foundation"), cls, at, d, lvl));
  }
}

/** The point `n` half-sides from `at` along direction `d`. */
const along = (at: At, d: number, n = 2): At => [0, 1, 2, 3].map((i) => at[i]! + n * DIRS[(d % 12) * 4 + i]!) as unknown as At;

/** The corner of square (i, j) of a frame's own squares, and its four sides: south, east, north, west. */
const sq = (i: number, j: number): At => [2 * i, 0, 0, 2 * j];
const SIDES: readonly (readonly [di: number, dj: number, d: number])[] = [[0, 0, 0], [1, 0, 3], [0, 1, 0], [0, 0, 3]];
function ring(b: Built, i: number, j: number, lvl: number, names: readonly string[] = ["wall", "wall", "wall", "wall"]): number[] {
  return SIDES.map(([di, dj, d], k) => b.put(names[k]!, CLS_EDGE, sq(i + di, j + dj), d, lvl));
}

test("a square room is shut in by a floor, four walls and a ceiling", () => {
  const b = new Built();
  const floor = b.put("foundation", CLS_SQUARE, sq(0, 0), 0, 0);
  const walls = ring(b, 0, 0, 0);
  expect(b.flood()).toEqual([0, 0, 0]);
  const top = b.put("ceiling", CLS_SQUARE, sq(0, 0), 0, 4);
  expect(b.flood()).toEqual([1, 1, 1]);
  expect([0, 3, 4, -1].map((lvl) => b.indoors(CLS_SQUARE, sq(0, 0), 0, lvl))).toEqual([true, true, false, false]);
  expect(b.indoors(CLS_SQUARE, sq(1, 0), 0, 0)).toBe(false);
  // Each has outside air on its other side.
  expect([floor, top, ...walls].map((ref) => b.borders(ref))).toEqual([true, true, true, true, true, true]);
  // A second room beside it: the wall between them has none, and neither has a thing a room holds.
  b.put("foundation", CLS_SQUARE, sq(1, 0), 0, 0);
  b.put("ceiling", CLS_SQUARE, sq(1, 0), 0, 4);
  for (const [di, dj, d] of [SIDES[0]!, SIDES[1]!, SIDES[2]!]) b.put("wall", CLS_EDGE, sq(1 + di, dj), d, 0);
  const stairs = b.put("stairs", CLS_SQUARE, sq(1, 0), 0, 0);
  expect(b.flood()).toEqual([2, 2, 2]);
  expect([b.borders(walls[1]!), b.borders(walls[3]!), b.borders(stairs)]).toEqual([false, true, false]);
  expect(b.enc.rooms()).toEqual([{ cells: 1, doors: [] }, { cells: 1, doors: [] }]);
});

test("a doorway is shut by a shut door and open with an open one or none", () => {
  const b = new Built();
  b.put("foundation", CLS_SQUARE, sq(0, 0), 0, 0);
  b.put("ceiling", CLS_SQUARE, sq(0, 0), 0, 4);
  const [, , , frame] = ring(b, 0, 0, 0, ["wall", "wall", "wall", "doorframe"]);
  expect(b.flood()).toEqual([1, 0, 0]);
  const door = b.put("door", CLS_EDGE, sq(0, 0), 3, 0);
  expect(b.flood()).toEqual([1, 1, 1]);
  expect(b.enc.rooms()).toEqual([{ cells: 1, doors: [{ ref: frame!, leaf: door, shut: true }] }]);
  b.take(door);
  const open = b.put("door_open", CLS_EDGE, sq(0, 0), 3, 0);
  expect(b.flood()).toEqual([1, 0, 0]);
  b.take(open);
  expect([b.flood(), b.enc.found.doorLeaf[0], b.enc.found.doorShut[0]]).toEqual([[1, 0, 0], NO_REF, 0]);
  // A gateway is wall over its opening: its gate, a level short of it, shuts it.
  const g = new Built();
  for (const i of [0, 1]) {
    g.put("foundation", CLS_SQUARE, sq(i, 0), 0, 0);
    g.put("ceiling", CLS_SQUARE, sq(i, 0), 0, 8);
    for (const lvl of [0, 4]) g.put("wall", CLS_EDGE, sq(i, 1), 0, lvl);
  }
  g.put("large_wall", CLS_EDGE, sq(0, 0), 3, 0);
  g.put("large_wall", CLS_EDGE, sq(2, 0), 3, 0);
  g.put("gateway", CLS_EDGE, sq(0, 0), 0, 0);
  expect(g.flood()).toEqual([2, 0, 0]);
  const gate = g.put("gate", CLS_EDGE, sq(0, 0), 0, 0);
  expect(g.flood()).toEqual([2, 2, 1]);
  g.take(gate);
  expect(g.flood()).toEqual([2, 0, 0]);
});

test("a window is open to sight and shut to a body, and a half wall shuts nothing", () => {
  for (const sense of [SENSE_SIGHT, SENSE_BODY]) {
    const b = new Built(sense);
    b.put("foundation", CLS_SQUARE, sq(0, 0), 0, 0);
    b.put("ceiling", CLS_SQUARE, sq(0, 0), 0, 4);
    const [window] = ring(b, 0, 0, 0, ["windowframe", "wall", "wall", "wall"]);
    expect(b.flood()).toEqual(sense === SENSE_BODY ? [1, 1, 1] : [1, 0, 0]);
    b.take(window!);
    // Two half walls fill the side and close none of it.
    for (const [name, lvl] of [["half_wall", 0], ["half_wall", 2]] as const) b.put(name, CLS_EDGE, sq(0, 0), 0, lvl);
    expect(b.flood()).toEqual([1, 0, 0]);
  }
  // So do a half wall, a quarter wall and a railing, one on the other.
  const b = new Built();
  b.put("foundation", CLS_SQUARE, sq(0, 0), 0, 0);
  b.put("ceiling", CLS_SQUARE, sq(0, 0), 0, 4);
  ring(b, 0, 0, 0, ["half_wall", "wall", "wall", "wall"]);
  for (const [name, lvl] of [["quarter_wall", 2], ["railing", 3]] as const) b.put(name, CLS_EDGE, sq(0, 0), 0, lvl);
  expect(b.flood()).toEqual([1, 0, 0]);
});

test("stairs make two storeys one room, a floor between two, a missing ceiling none", () => {
  const b = new Built();
  for (const i of [0, 1]) b.put("foundation", CLS_SQUARE, sq(i, 0), 0, 0);
  for (const lvl of [0, 4]) {
    for (const i of [0, 1]) for (const j of [0, 1]) b.put("wall", CLS_EDGE, sq(i, j), 0, lvl);
    for (const i of [0, 2]) b.put("wall", CLS_EDGE, sq(i, 0), 3, lvl);
  }
  const mid = b.put("ceiling", CLS_SQUARE, sq(0, 0), 0, 4);
  b.put("stairs", CLS_SQUARE, sq(1, 0), 0, 0);
  b.put("ceiling", CLS_SQUARE, sq(0, 0), 0, 8);
  const top = b.put("ceiling", CLS_SQUARE, sq(1, 0), 0, 8);
  // Over the stairs the air is one cell two storeys high.
  expect([b.flood(), b.borders(mid)]).toEqual([[3, 3, 1], false]);
  const between = b.put("ceiling", CLS_SQUARE, sq(1, 0), 0, 4);
  expect([b.flood(), b.borders(between)]).toEqual([[4, 4, 2], false]);
  b.take(top);
  expect([b.flood(), b.borders(between), b.borders(mid)]).toEqual([[3, 2, 1], true, true]);
  b.take(between);
  expect(b.flood()).toEqual([2, 0, 0]);
  // A hatch in the floor between joins the storeys while it is open.
  b.put("ceiling", CLS_SQUARE, sq(1, 0), 0, 8);
  const hatch = b.put("trapdoor_frame", CLS_SQUARE, sq(1, 0), 0, 4);
  expect(b.flood()).toEqual([4, 4, 1]);
  const leaf = b.put("trapdoor", CLS_SQUARE, sq(1, 0), 0, 4);
  expect(b.flood()).toEqual([4, 4, 2]);
  expect(b.enc.rooms().map((room) => room.doors)).toEqual([[{ ref: hatch, leaf, shut: true }], [{ ref: hatch, leaf, shut: true }]]);
});

test("a room and a terrace half a storey up are each closed at their own levels", () => {
  const b = new Built();
  b.put("foundation", CLS_SQUARE, sq(0, 0), 0, 0);
  b.put("ceiling", CLS_SQUARE, sq(0, 0), 0, 4);
  b.put("foundation", CLS_SQUARE, sq(1, 0), 0, 2);
  b.put("ceiling", CLS_SQUARE, sq(1, 0), 0, 6);
  for (const k of [0, 2, 3]) b.put("wall", CLS_EDGE, sq(SIDES[k]![0], SIDES[k]![1]), SIDES[k]![2], 0);
  for (const k of [0, 1, 2]) b.put("wall", CLS_EDGE, sq(1 + SIDES[k]![0], SIDES[k]![1]), SIDES[k]![2], 2);
  // With nothing between them the room is open under the terrace's floor, and a half wall there closes nothing.
  expect(b.flood()).toEqual([2, 0, 0]);
  const low = b.put("half_wall", CLS_EDGE, sq(1, 0), 3, 0);
  expect(b.flood()).toEqual([2, 0, 0]);
  b.take(low);
  // A wall closes the room, and leaves the terrace open over its top, at levels 4 and 5.
  const between = b.put("wall", CLS_EDGE, sq(1, 0), 3, 0);
  expect([b.flood(), b.borders(between), b.indoors(CLS_SQUARE, sq(0, 0), 0, 1), b.indoors(CLS_SQUARE, sq(1, 0), 0, 3)]).toEqual([[2, 1, 1], true, true, false]);
  // With the wall over it both are rooms. The lower wall still has outside air on it, under the terrace's floor.
  const over = b.put("wall", CLS_EDGE, sq(1, 0), 3, 4);
  expect([b.flood(), b.borders(between), b.borders(over), b.indoors(CLS_SQUARE, sq(1, 0), 0, 5), b.indoors(CLS_SQUARE, sq(1, 0), 0, 1)]).toEqual([[2, 2, 2], true, true, true, false]);
});

test("six triangles round a point are one room behind six walls", () => {
  const b = new Built();
  const centre: At = [0, 0, 0, 0];
  const rim = (k: number): At => along(centre, 2 * k);
  const walls: number[] = [];
  for (let k = 0; k < 6; k++) {
    b.put("triangle_foundation", CLS_TRIANGLE, centre, 2 * k, 0);
    b.put("triangle_ceiling", CLS_TRIANGLE, centre, 2 * k, 4);
    walls.push(b.put("wall", CLS_EDGE, rim(k), 2 * k + 4, 0));
  }
  const post = b.put("pillar", CLS_VERTEX, centre, 0, 0);
  const spoke = b.put("half_wall", CLS_EDGE, centre, 4, 0);
  expect(b.flood()).toEqual([6, 6, 1]);
  expect([b.borders(post), b.borders(spoke), walls.map((ref) => b.borders(ref)).includes(false)]).toEqual([false, false, false]);
  expect([0, 2, 4, 6, 8, 10].map((d) => b.indoors(CLS_TRIANGLE, centre, d, 2))).toEqual([true, true, true, true, true, true]);
  b.take(walls[2]!);
  expect([b.flood(), b.borders(post)]).toEqual([[6, 0, 0], true]);
  // A square built out from that side is one room with them, across the side a triangle and a square share.
  const out = along(rim(2), 5);
  b.put("foundation", CLS_SQUARE, rim(2), 5, 0);
  b.put("ceiling", CLS_SQUARE, rim(2), 5, 4);
  expect(b.flood()).toEqual([7, 0, 0]);
  const outer = [b.put("wall", CLS_EDGE, rim(2), 5, 0), b.put("wall", CLS_EDGE, out, 8, 0), b.put("wall", CLS_EDGE, along(out, 8), 11, 0)];
  expect([b.flood(), b.indoors(CLS_SQUARE, rim(2), 5, 0), b.borders(post)]).toEqual([[7, 7, 1], true, false]);
  b.take(outer[1]!);
  expect(b.flood()).toEqual([7, 0, 0]);
});

test("a roofed attic is closed by gables that slope as its roof does", () => {
  // Two squares under a roof whose ridge is the side between them.
  const b = new Built();
  for (const j of [0, 1]) b.put("foundation", CLS_SQUARE, sq(0, j), 0, 0);
  for (const j of [0, 2]) b.put("wall", CLS_EDGE, sq(0, j), 0, 0);
  for (const j of [0, 1]) for (const i of [0, 1]) b.put("wall", CLS_EDGE, sq(i, j), 3, 0);
  b.put("roof", CLS_SQUARE, sq(0, 0), 0, 4, 0);
  const north = b.put("roof", CLS_SQUARE, sq(0, 1), 0, 4, 2);
  expect(b.flood()).toEqual([2, 0, 0]);
  const gables = [b.put("sloped_wall_right", CLS_EDGE, sq(0, 0), 3, 4), b.put("sloped_wall_right", CLS_EDGE, sq(1, 0), 3, 4), b.put("sloped_wall_left", CLS_EDGE, sq(0, 1), 3, 4), b.put("sloped_wall_left", CLS_EDGE, sq(1, 1), 3, 4)];
  expect(b.flood()).toEqual([2, 2, 1]);
  // Under the roof the air stands as high as the roof does, and a body there is indoors.
  expect([0, 3, 4, 5, 6].map((lvl) => b.indoors(CLS_SQUARE, sq(0, 0), 0, lvl))).toEqual([true, true, true, true, false]);
  b.take(gables[0]!);
  const wrong = b.put("sloped_wall_left", CLS_EDGE, sq(0, 0), 3, 4);
  expect(b.flood()).toEqual([2, 0, 0]);
  b.take(wrong);
  // The same gable turned about stands the other way, and a whole wall closes the side too.
  const turned = b.put("sloped_wall_left", CLS_EDGE, sq(0, 0), 3, 4, 1);
  expect(b.flood()).toEqual([2, 2, 1]);
  b.take(turned);
  b.put("wall", CLS_EDGE, sq(0, 0), 3, 4);
  expect(b.flood()).toEqual([2, 2, 1]);
  // One roof alone has its high side open, which a wall closes and a half wall does not.
  b.take(north);
  b.put("ceiling", CLS_SQUARE, sq(0, 1), 0, 4);
  expect(b.flood()).toEqual([2, 0, 0]);
  const half = b.put("half_wall", CLS_EDGE, sq(0, 1), 0, 4);
  expect(b.flood()).toEqual([2, 0, 0]);
  b.take(half);
  b.put("wall", CLS_EDGE, sq(0, 1), 0, 4);
  expect(b.flood()).toEqual([2, 2, 1]);
});

test("a roof at any turn is open where its pose lifts it, until a gable stands there", () => {
  const frame = new Frame(1, 51200, 1024, 70000, 4321, 1);
  const pose: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
  const axis = new Int32Array(4);
  const v = new Int32Array(2);
  let asked = 0;
  for (const name of ["roof", "roof_hip", "roof_valley", "triangle_roof", "triangle_roof_low"]) {
    const f = forms.def[K(name)]!;
    const cls = f.cls === "square" ? CLS_SQUARE : CLS_TRIANGLE;
    const n = cls === CLS_SQUARE ? 4 : 3;
    for (let dir = 0; dir < (cls === CLS_SQUARE ? 3 : 4); dir++) {
      for (let rot = 0; rot < n; rot++) {
        const at: At = [4, -2, 2, 6];
        const k0 = key0(cls, ...(at.slice(0, 3) as [number, number, number]));
        // The levels the roof's pose lifts each corner of its form, by where that corner is in the world.
        poseOf(frame, k0, key1(at[3], 4, dir, 0, rot, 0), forms, K(name), pose);
        classAxis(pose.yaw, pose.tw, axis, 0);
        classAxis60(pose.yaw, pose.tw, axis, 2);
        const lifted = new Map<string, number>();
        f.outline.forEach(([x, z], j) => {
          const [i, k] = cls === CLS_SQUARE ? [Math.round(x / 1.5), Math.round(z / 1.5)] : [j === 2 ? 2 : 0, j === 1 ? 2 : 0];
          const place = cls === CLS_SQUARE ? [pose.x + i * axis[0]! - k * axis[1]!, pose.z + i * axis[1]! + k * axis[0]!] : [pose.x + i * axis[0]! + k * axis[2]!, pose.z + i * axis[1]! + k * axis[3]!];
          lifted.set(place.join(), Math.round(f.corner![j]! / LEVEL_M));
        });
        const corners = new Int32Array(16);
        corners.set(at);
        elementCorners(cls, corners, 0, dir, corners, 0);
        const corner = (k: number): At => [...corners.subarray(4 * (k % n), 4 * (k % n) + 4)] as unknown as At;
        const rise = (k: number): number => {
          worldOf(frame.basis, frame.ox, frame.oz, corners, 4 * (k % n), v, 0);
          return lifted.get(`${v[0]},${v[1]}`)!;
        };
        expect(Array.from({ length: n }, (_, k) => rise(k)).sort()).toEqual(f.corner!.map((h) => Math.round(h / LEVEL_M)).sort());
        const b = new Built();
        b.put(cls === CLS_SQUARE ? "foundation" : "triangle_foundation", cls, at, dir, 0);
        const [r0, r1] = [key0(cls, at[0], at[1], at[2]), key1(at[3], 4, dir, 0, rot, 0)];
        b.enc.add(K(name), r0, r1, 999);
        const gables: number[] = [];
        for (let k = 0; k < n; k++) {
          const d = dirTurn(dir, k * CLS_STEP[cls]!);
          b.put("wall", CLS_EDGE, corner(k), d, 0);
          // Seen along the edge's own direction, which is the side's or its reverse.
          const [first, last] = d < 6 ? [rise(k), rise(k + 1)] : [rise(k + 1), rise(k)];
          if (first === last && first > 0) gables.push(b.put("wall", CLS_EDGE, corner(k), d, 4));
          else if (first !== last) gables.push((asked++ & 1) === 0 ? b.put(first > last ? "sloped_wall_left" : "sloped_wall_right", CLS_EDGE, corner(k), d, 4) : b.put(first > last ? "sloped_wall_right" : "sloped_wall_left", CLS_EDGE, corner(k), d, 4, 1));
        }
        expect([name, dir, rot, ...b.flood()]).toEqual([name, dir, rot, 1, 1, 1]);
        for (const gable of gables) {
          const piece = b.pieces.get(gable)!;
          b.take(gable);
          expect([name, dir, rot, ...b.flood()]).toEqual([name, dir, rot, 1, 0, 0]);
          b.pieces.set(gable, piece);
          b.enc.add(...piece, gable);
        }
      }
    }
  }
  expect(asked).toBeGreaterThan(40);
});

const tup = new Int32Array(16);

/** All a flood found, by the places of its faces: each cell of outside air, each room's cells and doors, and each piece's answer. */
function picture(enc: Enclosure, pieces: ReadonlyMap<number, [number, number, number]>): string[] {
  const w = enc.found;
  const open: string[] = [];
  const rooms: string[][] = Array.from({ length: w.rooms }, () => []);
  for (let c = 0; c < w.cells; c++) {
    const n = enc.faceCorners(w.face[c]!, tup);
    const cell = `${tup.subarray(0, 4 * n).join()} ${w.lo[c]}-${w.hi[c]}`;
    if (w.room[c]! < 0) open.push(`open ${cell}`);
    else rooms[w.room[c]!]!.push(cell);
  }
  const doors = enc.rooms().map((room) => room.doors.map((d) => `${d.ref}:${d.leaf}:${d.shut}`).sort().join(" "));
  return [...open.sort(), ...rooms.map((room, i) => `room ${room.sort().join(" | ")} doors ${doors[i]}`).sort(), ...[...pieces].map(([ref, piece]) => `${ref} ${enc.borders(...piece)}`).sort()];
}

test("as pieces come and go the air is found as a fresh flood finds it", () => {
  // A house of three by three squares on two storeys, a terrace half a storey up beside it and triangles along its
  // south side, with other pieces for each place: every step puts one of them down or takes it up.
  type Piece = [name: string, cls: number, at: At, d: number, lvl: number, rot: number];
  const all: Piece[] = [];
  const start = new Set<number>();
  const offer = (stands: boolean, name: string, cls: number, at: At, d: number, lvl: number, rot = 0): void => {
    if (stands) start.add(all.length);
    all.push([name, cls, at, d, lvl, rot]);
  };
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      offer(true, "foundation", CLS_SQUARE, sq(i, j), 0, 0);
      for (const lvl of [4, 8]) offer(true, "ceiling", CLS_SQUARE, sq(i, j), 0, lvl);
      offer(false, "trapdoor_frame", CLS_SQUARE, sq(i, j), 0, 4);
      offer(false, "trapdoor", CLS_SQUARE, sq(i, j), 0, 4);
      offer(false, "ceiling", CLS_SQUARE, sq(i, j), 0, 6);
      for (const name of ["roof", "roof_hip", "roof_valley"]) offer(false, name, CLS_SQUARE, sq(i, j), 0, 8, (i + 2 * j) & 3);
      offer(false, "stairs", CLS_SQUARE, sq(i, j), 0, 0);
    }
  }
  for (let line = 0; line <= 3; line++) {
    for (let c = 0; c < 3; c++) {
      for (const [at, d] of [[sq(c, line), 0], [sq(line, c), 3]] as const) {
        const outer = line === 0 || line === 3;
        for (const lvl of [0, 4]) {
          offer(outer || (c + line + lvl) % 3 === 0, "wall", CLS_EDGE, at, d, lvl);
          for (const name of ["doorframe", "windowframe", "door", "door_open", "half_wall", "large_wall"]) offer(false, name, CLS_EDGE, at, d, lvl);
          offer(false, "half_wall", CLS_EDGE, at, d, lvl + 2);
        }
        offer(false, "wall", CLS_EDGE, at, d, 2);
        for (const rot of [0, 1]) for (const name of ["sloped_wall_left", "sloped_wall_right"]) offer(false, name, CLS_EDGE, at, d, 8, rot);
        offer(false, "wall", CLS_EDGE, at, d, 8);
      }
    }
  }
  for (let j = 0; j < 3; j++) {
    offer(true, "foundation", CLS_SQUARE, sq(3, j), 0, 2);
    offer(true, "ceiling", CLS_SQUARE, sq(3, j), 0, 6);
    offer(true, "wall", CLS_EDGE, sq(4, j), 3, 2);
    offer(false, "double_doorway", CLS_EDGE, sq(4, j), 3, 2);
  }
  for (const j of [0, 3]) offer(true, "wall", CLS_EDGE, sq(3, j), 0, 2);
  for (let i = 0; i < 3; i++) {
    // The triangle south of the square's south side, and its two other sides.
    const tip: At = [0, 1, 2, 3].map((k) => sq(i, 0)[k]! + 2 * DIRS[10 * 4 + k]!) as unknown as At;
    offer(true, "triangle_foundation", CLS_TRIANGLE, sq(i, 0), 10, 0);
    offer(true, "triangle_ceiling", CLS_TRIANGLE, sq(i, 0), 10, 4);
    for (const name of ["triangle_roof", "triangle_roof_low"]) offer(false, name, CLS_TRIANGLE, sq(i, 0), 10, 4, i);
    offer(true, "wall", CLS_EDGE, sq(i, 0), 10, 0);
    offer(true, "wall", CLS_EDGE, tip, 2, 0);
    offer(false, "sloped_wall_left", CLS_EDGE, tip, 2, 4);
  }

  const rng = new Rng(20261124);
  const taken = new Occupancy();
  const kept = new Enclosure(forms);
  const pieces = new Map<number, [number, number, number]>();
  let rooms = 0, opened = 0, cut = 0;
  const toggle = (index: number): void => {
    const [name, cls, at, d, lvl, rot] = all[index]!;
    const kind = K(name);
    const [k0, k1] = keyOf(forms, kind, cls, at, d, lvl, rot);
    expect(formCells(forms, kind, k0, k1, cells)).toBe(true);
    if (pieces.has(index)) {
      for (let i = 0; i < cells.n; i++) taken.take(1, cells.k0[i]!, cells.k1[i]!);
      pieces.delete(index);
      kept.remove(kind, k0, k1, index);
      return;
    }
    for (let i = 0; i < cells.n; i++) if (!taken.free(1, cells.k0[i]!, cells.k1[i]!, cells.reach[i]!)) return;
    for (let i = 0; i < cells.n; i++) taken.put(1, cells.k0[i]!, cells.k1[i]!, index, cells.reach[i]!);
    pieces.set(index, [kind, k0, k1]);
    kept.add(kind, k0, k1, index);
  };
  for (const index of start) toggle(index);
  let before = "";
  for (let step = 0; step < 700; step++) {
    if (step > 0) toggle(rng.int(all.length));
    const ran = kept.stale;
    // Every third step the flood is cut into slices, and the last answer stands until the last slice.
    if (step % 3 === 1 && kept.stale) {
      const was = kept.found;
      while (!kept.flood(5)) {
        expect(kept.found).toBe(was);
        cut++;
      }
    } else kept.flood();
    const fresh = new Enclosure(forms);
    for (const [index, piece] of pieces) fresh.add(...piece, index);
    fresh.flood();
    const got = picture(kept, pieces);
    expect(got).toEqual(picture(fresh, pieces));
    // It says the air changed exactly when a cell came, went or changed sides.
    const air = got.filter((line) => !/^\d/.test(line)).flatMap((line) => line.replace(/ doors.*/, "").replace(/^room /, "").split(" | ").map((cell) => `${line.startsWith("open") ? "" : "in "}${cell}`)).sort().join("\n");
    if (ran) expect(kept.changed).toBe(air !== before);
    before = air;
    rooms = Math.max(rooms, kept.found.rooms);
    if (kept.found.inside === 0) opened++;
  }
  // The walk shut rooms and opened them all, and floods were cut short.
  expect([pieces.size > 40, rooms >= 3, opened > 0, opened < 600, cut > 100]).toEqual([true, true, true, true, true]);
});

test("a flood cut short takes up where it stopped, and a new piece starts it over", () => {
  const b = new Built();
  for (let i = 0; i < 6; i++) {
    b.put("foundation", CLS_SQUARE, sq(i, 0), 0, 0);
    b.put("ceiling", CLS_SQUARE, sq(i, 0), 0, 4);
    for (const j of [0, 1]) b.put("wall", CLS_EDGE, sq(i, j), 0, 0);
    if (i > 0) b.put("wall", CLS_EDGE, sq(i, 0), 3, 0);
  }
  const west = b.put("wall", CLS_EDGE, sq(0, 0), 3, 0);
  b.put("wall", CLS_EDGE, sq(6, 0), 3, 0);
  // Six faces, then six cells, four a call.
  let calls = 1;
  while (!b.enc.flood(4)) {
    expect([b.enc.stale, b.enc.found.cells]).toEqual([true, 0]);
    calls++;
  }
  expect([calls, b.enc.stale, b.enc.found.cells, b.enc.found.rooms]).toEqual([3, false, 6, 6]);
  expect(b.enc.flood(1)).toBe(true);
  b.take(west);
  expect([b.enc.flood(7), b.enc.found.inside]).toEqual([false, 6]);
  const window = b.put("windowframe", CLS_EDGE, sq(0, 0), 3, 0);
  expect([b.enc.flood(7), b.enc.found.inside]).toEqual([false, 6]);
  expect([b.enc.flood(7), b.enc.found.inside, b.enc.changed, b.borders(window)]).toEqual([true, 5, true, true]);
});

const U = STRUCT_UNITS;
const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
const found = new Found();

/**
 * A wooden house four squares by three on two storeys from (x0, z0), as the renderer's own test builds it: below, a
 * wall splits it into a west hall with a shut door and a box and an east hall with a window; above is one hall with a box.
 */
function house(structs: StructureStore, reg: Registry, x0: number, z0: number): { door: number; split: number; boxes: number[]; refs: number[] } {
  const k = (id: string): number => reg.index.get(`core:${id}`)!;
  const [F, W, C, DF, D, WF, BOX] = [k("foundation_wood"), k("wall_wood"), k("ceiling_wood"), k("doorframe_wood"), k("door_wood"), k("windowframe_wood"), k("storage_box")];
  const refs: number[] = [];
  // Each piece in the slot of the base its pose is, the first foundation beginning the base.
  const set = metric({ structs, reg }, 1, 1000);
  const add = (kind: number, x: number, y: number, z: number, yaw = 0): number => refs[refs.push(set(kind, x, y, z, yaw)) - 1]!;
  const floor = (s: number): number => 2 * reg.halfY[F]! + s * 3;
  let door = -1, split = -1;
  const boxes: number[] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) add(F, x0 + 1.5 + 3 * i, reg.halfY[F]!, z0 + 1.5 + 3 * j);
  for (let s = 0; s < 2; s++) {
    const y = floor(s) + reg.halfY[W]!;
    for (let i = 0; i < 4; i++) {
      const doorway = s === 0 && i === 0;
      add(doorway ? DF : W, x0 + 1.5 + 3 * i, y, z0);
      if (doorway) door = add(D, x0 + 1.5, floor(0) + reg.halfY[D]!, z0);
      add(W, x0 + 1.5 + 3 * i, y, z0 + 9);
    }
    for (let j = 0; j < 3; j++) {
      add(W, x0, y, z0 + 1.5 + 3 * j, 16384);
      add(s === 0 && j === 1 ? WF : W, x0 + 12, y, z0 + 1.5 + 3 * j, 16384);
      if (s === 0) {
        const ref = add(W, x0 + 6, y, z0 + 1.5 + 3 * j, 16384);
        if (j === 1) split = ref;
      }
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) add(C, x0 + 1.5 + 3 * i, floor(s) + 3 - reg.halfY[C]!, z0 + 1.5 + 3 * j);
    boxes.push(add(BOX, x0 + 3 + 1.5 * s, floor(s) + reg.halfY[BOX]!, z0 + 4.5));
  }
  return { door, split, boxes, refs };
}

/** What the flood of the one frame of `structs` finds: its counts, and whether each of its rows has outside air on it, in the order given. */
function flooded(structs: StructureStore, reg: Registry, order: readonly number[]): { counts: number[]; borders: boolean[] } {
  expect(structs.frames.count).toBe(1);
  const [f] = [...structs.frames.all()];
  const enc = new Enclosure(reg.forms);
  enclose(structs, f!.gid, enc);
  enc.flood();
  const borders = order.map((ref) => {
    expect(structs.keyAt(ref, key)).toBe(true);
    return enc.borders(structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!, key.k0, key.k1);
  });
  return { counts: [enc.found.cells, enc.found.inside, enc.found.rooms], borders };
}

test("a house at an odd yaw has the rooms it has at yaw 0", () => {
  const reg = coreRegistry();
  const straight = flatWorld(4);
  const built = house(straight.structs, reg, 100, 100);
  const pieces = built.refs.filter((ref) => !built.boxes.includes(ref));
  const first = flooded(straight.structs, reg, pieces);
  // Two halls below, one of them open by its window, and one above: 12 cells below and 12 above, 18 of them in two rooms.
  expect(first.counts).toEqual([24, 18, 2]);
  // Only the floor between the west hall and the hall over it has a room on both sides.
  expect(first.borders.filter((b) => !b).length).toBe(6);
  for (const yaw of [2222, 16384 + 777, 40001]) {
    // The same keys in a frame turned `yaw`.
    const turned = flatWorld(4);
    const f = turned.structs.frames.make(128 * U, 192, 128 * U, yaw, 1);
    const placed = pieces.map((ref) => {
      expect(straight.structs.keyAt(ref, key)).toBe(true);
      return turned.structs.place(straight.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!, f.gid, key.k0, key.k1, 1, 1000);
    });
    expect(placed.includes(-1)).toBe(false);
    expect(flooded(turned.structs, reg, placed)).toEqual(first);
    // And as a client is sent them, slot for slot by their keys.
    const sent = flatWorld(4);
    mirror(turned.structs, sent.structs);
    expect(flooded(sent.structs, reg, placed)).toEqual(first);
    // Asked of a point: the west hall is indoors, the east hall and the air over the roof are not.
    const enc = new Enclosure(reg.forms);
    enclose(turned.structs, f.gid, enc);
    enc.flood();
    const floods = new Map([[f.gid, enc]]);
    const air = (i: number, j: number, lvl: number): boolean => indoorsAt(floods, f.gid, key0(CLS_SQUARE, 2 * i, 0, 0), key1(2 * j, lvl, 0, 0, 0, 0));
    expect([air(0, 1, 0), air(3, 1, 0), air(3, 1, 4), air(0, 1, 8), indoorsAt(floods, f.gid + 1, key0(CLS_SQUARE, 0, 0, 0), key1(2, 0, 0, 0, 0, 0))]).toEqual([true, false, true, false, false]);
  }
});

/** A finder that takes each kind's own box for its mesh. */
function finderOf(reg: Registry): RoomFinder {
  const n = reg.defs.length;
  const meshes = Array.from({ length: n }, (_, k) => ({ center: [0, 0, 0], half: [reg.halfX[k]!, reg.halfY[k]!, reg.halfZ[k]!] }));
  return new RoomFinder(reg, Uint16Array.from({ length: n }, (_, k) => k), meshes, []);
}

/** The refs of the pieces the finder leaves out as interior, chunk by chunk, with `kept` rooms brought up to date or fresh ones. */
function interior(structs: StructureStore, finder: RoomFinder, kept?: Map<number, Rooms>): { hidden: number[]; doors: string[] } {
  const hidden: number[] = [];
  const doors: string[] = [];
  for (const chunk of structs.held) {
    const table = structs.chunks[chunk]!;
    const rooms = kept?.get(chunk) ?? new Rooms();
    kept?.set(chunk, rooms);
    if (!finder.find(table, chunkCx(structs.dims, chunk) * CHUNK_SIZE, chunkCz(structs.dims, chunk) * CHUNK_SIZE, rooms, structs.frames)) continue;
    for (let s = 0; s < table.high; s++) if (table.kind[s] !== 0 && rooms.shell[s] === 0) hidden.push(chunk * 65536 + s);
    for (const [slot, flags] of rooms.doors) doors.push(`${chunk * 65536 + slot}:${flags}`);
  }
  return { hidden: hidden.sort((a, b) => a - b), doors: doors.sort() };
}

test("the renderer leaves out a house's inner floor and boxes until a hall is open", () => {
  const reg = coreRegistry();
  const w = flatWorld(4);
  const finder = finderOf(reg);
  const built = house(w.structs, reg, 100, 100);
  const C = reg.index.get("core:ceiling_wood")!;
  const kindOf = (ref: number): number => w.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!;
  const first = interior(w.structs, finder);
  // The floor over the west hall and both boxes. The door is between the air outside and a room.
  expect(first.hidden.map(kindOf).filter((kind) => kind === C).length).toBe(6);
  expect(first.hidden.length).toBe(8);
  expect(built.boxes.every((ref) => first.hidden.includes(ref))).toBe(true);
  expect(first.doors).toEqual([`${built.door}:2`]);
  // The wall between the halls gone, the window opens the west hall: only the upper hall's box stays in.
  const kept = new Map<number, Rooms>();
  expect(interior(w.structs, finder, kept)).toEqual(first);
  w.structs.remove(built.split);
  const opened = interior(w.structs, finder, kept);
  expect(opened).toEqual(interior(w.structs, finder));
  expect(opened.hidden).toEqual([built.boxes[1]!]);
  // A wall set by a pose that is no slot of the base has no key: it closes nothing, and stands hidden in the hall above.
  const loose = w.structs.add(reg.index.get("core:wall_wood")!, 106.4, 2 * reg.halfY[reg.index.get("core:foundation_wood")!]! + 3 + reg.halfY[reg.index.get("core:wall_wood")!]!, 104.5, 16384, 1, 1000);
  expect(w.structs.frameAt(loose)).toBe(0);
  expect(interior(w.structs, finder, kept).hidden).toEqual([built.boxes[1]!, loose].sort((a, b) => a - b));
});

test("as a house's pieces come and go the renderer's rooms stay what fresh ones are", () => {
  const reg = coreRegistry();
  const w = flatWorld(4);
  const finder = finderOf(reg);
  // Across a chunk's edge at x = 128: the part in each chunk is found by itself.
  const live = house(w.structs, reg, 119, 100).refs;
  const kept = new Map<number, Rooms>();
  const rng = new Rng(77);
  const gone: number[][] = [];
  const key = { fr: 0, k0: 0, k1: 0 };
  let most = 0, least = Infinity;
  for (let step = 0; step < 300; step++) {
    const at = rng.int(live.length);
    const ref = live[at]!;
    const table = w.structs.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff;
    if (gone.length > 0 && (live.length === 0 || rng.int(2) === 0)) {
      // Back where it was: a piece of the base in its slot, a box by its pose.
      const [kind, x, y, z, yaw, fr, k0, k1] = gone.splice(rng.int(gone.length), 1)[0] as [number, number, number, number, number, number, number, number];
      const back = fr !== 0 ? w.structs.place(kind, fr, k0, k1, 1, 1000) : w.structs.add(kind, x, y, z, yaw, 1, 1000);
      expect(back).toBeGreaterThanOrEqual(0);
      live.push(back);
    }
    else if (reg.opens[table.kind[s]!] !== 0) w.structs.swap(ref, reg.opens[table.kind[s]!]!);
    else {
      const keyed = w.structs.keyAt(ref, key);
      gone.push([table.kind[s]!, table.x[s]!, table.y[s]!, table.z[s]!, table.yaw[s]!, keyed ? key.fr : 0, key.k0, key.k1]);
      w.structs.remove(ref);
      live.splice(at, 1);
    }
    const now = interior(w.structs, finder, kept);
    expect(now).toEqual(interior(w.structs, finder));
    most = Math.max(most, now.hidden.length);
    least = Math.min(least, now.hidden.length);
  }
  expect([most > 0, least]).toEqual([true, 0]);
});

test("a base split over two frames hides only what one frame's own pieces close", () => {
  const reg = coreRegistry();
  const finder = finderOf(reg);
  const k = (id: string): number => reg.index.get(`core:${id}`)!;
  const [F, W, C, BOX] = [k("foundation_wood"), k("wall_wood"), k("ceiling_wood"), k("storage_box")];
  // Two squares side by side on two storeys with a wall between them. `split` gives the east square to a second frame
  // of the same origin and turn, as a client that was sent the rows in an odd order may have it. The wall between
  // them is the west frame's.
  const build = (split: boolean) => {
    const w = flatWorld(4);
    const west = w.structs.frames.make(100 * U, 192, 100 * U, 0, 1);
    const east = split ? w.structs.frames.make(100 * U, 192, 100 * U, 0, 1) : west;
    const put = (f: typeof west, kind: number, cls: number, at: At, d: number, lvl: number): number => {
      const ref = w.structs.place(kind, f.gid, ...keyOf(reg.forms, kind, cls, at, d, lvl), 1, 1000);
      expect(ref).toBeGreaterThanOrEqual(0);
      return ref;
    };
    const floors: number[] = [];
    const between: number[] = [];
    [west, east].forEach((f, i) => {
      put(f, F, CLS_SQUARE, sq(i, 0), 0, 0);
      floors.push(put(f, C, CLS_SQUARE, sq(i, 0), 0, 4));
      put(f, C, CLS_SQUARE, sq(i, 0), 0, 8);
      for (const lvl of [0, 4]) {
        for (const j of [0, 1]) put(f, W, CLS_EDGE, sq(i, j), 0, lvl);
        put(f, W, CLS_EDGE, sq(2 * i, 0), 3, lvl);
      }
    });
    for (const lvl of [0, 4]) between.push(put(west, W, CLS_EDGE, sq(1, 0), 3, lvl));
    const boxes = [0, 1].map((i) => w.structs.add(BOX, 101.5 + 3 * i, 0.375 + reg.halfY[BOX]!, 101.5, 0, 1, 100));
    return { w, floors, between, boxes };
  };
  // In one frame both squares are rooms on both storeys: their floors, the walls between them and the boxes are interior.
  const whole = build(false);
  const sorted = (refs: number[]): number[] => refs.sort((a, b) => a - b);
  expect(interior(whole.w.structs, finder).hidden).toEqual(sorted([...whole.floors, ...whole.between, ...whole.boxes]));
  // Split, the west square is closed by the west frame's own pieces. The east frame has no wall on its west side, so its
  // air is outside air, and its floor and its box are drawn though nothing could see them.
  const two = build(true);
  expect(two.w.structs.frames.count).toBe(2);
  expect(interior(two.w.structs, finder).hidden).toEqual(sorted([two.floors[0]!, two.boxes[0]!]));
  // The wall between them broken, both are open, and nothing is left out.
  two.w.structs.remove(two.between[0]!);
  whole.w.structs.remove(whole.between[0]!);
  expect([interior(two.w.structs, finder).hidden, interior(whole.w.structs, finder).hidden]).toEqual([[], sorted([...whole.floors, whole.between[1]!, ...whole.boxes])]);
});

test("the bench's bases of 2,000 and 20,000 pieces flood in a few milliseconds", () => {
  const reg = coreRegistry();
  for (const [n, every, most] of [[14, 3, 2000], [21, 1, 20000]] as const) {
    const structs = new StructureStore({ chunksX: 8, chunksZ: 8 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    layBase(structs, boxBase(reg, "wood", 64 * 6 + 0.5, 0, 64 * 6 + 0.5, n, every, most), 1, 1000);
    const [f] = [...structs.frames.all()];
    expect([structs.frames.count, structs.rowsOf(f!.gid, found)]).toEqual([1, most]);
    const enc = new Enclosure(reg.forms);
    let told = Infinity, flood = Infinity;
    for (let run = 0; run < 5; run++) {
      let t0 = performance.now();
      enclose(structs, f!.gid, enc);
      told = Math.min(told, performance.now() - t0);
      t0 = performance.now();
      enc.flood();
      flood = Math.min(flood, performance.now() - t0);
    }
    // Nearly every cell of either is in a room: the larger has a wall on every line, so each of its cells is a room.
    expect(enc.found.inside).toBeGreaterThan(0.95 * enc.found.cells);
    if (every === 1) expect([enc.found.rooms, enc.found.cells > 6000]).toEqual([enc.found.cells, true]);
    // Measured 0.43 and 0.18 ms for 2,000 pieces, 1.7 and 0.6 ms for 20,000: the bounds leave room for a busy machine.
    expect(told).toBeLessThan(40);
    expect(flood).toBeLessThan(20);
  }
});
