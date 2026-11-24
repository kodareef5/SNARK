// Bases set down by key, with squares and triangles of every turn class: for tests of pieces 30 and 60 degrees from their base.
// A piece is an element of the lattice named from a corner (four whole numbers of half-sides) along one of twelve directions.

import { FOUNDATION_THICK } from "../../content/building.ts";
import { PLANNED_FORMS } from "../../content/building/forms.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { HullDef } from "../../shared/world/convex.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { worldOf } from "../../shared/world/lattice/basis.ts";
import { formHalf, type FormDef } from "../../shared/world/lattice/forms.ts";
import type { Frame } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, DIRS, canon, canonical, dirTurn, elementCorners, key0, key1 } from "../../shared/world/lattice/module.ts";
import { flatWorld, wrap, type TestWorld } from "./world.ts";

const U = STRUCT_UNITS;
export const TEAM = 7;
/** Levels in a storey. */
export const STOREY = 4;

export type Tuple = readonly number[];
/** An element of the lattice: its class, a corner and the direction of its first side from there. */
export interface Cell {
  readonly cls: number;
  readonly a: Tuple;
  readonly d: number;
}

/** `a` moved `n` half-sides along direction `d`. */
export function step(a: Tuple, d: number, n: number): number[] {
  const e = dirTurn(d, 0) * 4;
  return [0, 1, 2, 3].map((i) => a[i]! + n * DIRS[e + i]!);
}

const m = new Int32Array(16);
const out = new Int32Array(4);

/** The corners of a cell, from +X toward +Z, the first its own. */
export function cornersOf(c: Cell): number[][] {
  m.set(c.a);
  const n = elementCorners(c.cls, m, 0, dirTurn(c.d, 0), m, 0);
  return Array.from({ length: n }, (_, i) => [...m.subarray(i * 4, i * 4 + 4)]);
}

let turned: Registry | null = null;

/** The core content with a triangle foundation and a triangle ceiling, `test:triangle_foundation` and `test:triangle_ceiling`, as their planned forms have them. */
export function turnedRegistry(): Registry {
  if (turned) return turned;
  const defs = (["triangle_foundation", "triangle_ceiling"] as const).flatMap((name): Def[] => {
    const form: FormDef = PLANNED_FORMS[name];
    const t = form.thick / 2;
    const hull: HullDef = { sixty: true, corners: [[0, -t, 0], [0, t, 0], [3, -t, 0], [3, t, 0], [0, -t, 3], [0, t, 3]] };
    return [
      { type: "shape", id: `test:shape_${name}`, role: "thing", boxes: [], hulls: [hull], form },
      { type: "structure", class: "piece", id: `test:${name}`, mesh: "shape", shape: `test:shape_${name}`, half: formHalf(form), color: 5, hp: 100, material: "core:mat_stone" },
    ];
  });
  const { registry, errors } = compileContent([...CORE_CONTENT, ...defs]);
  if (!registry) throw new Error(errors.join("\n"));
  return (turned = registry);
}

/** Flat ground at y = 0, with the core pieces and the two triangles. */
export function turnedWorld(chunks = 4): TestWorld {
  const flat = flatWorld(chunks);
  return wrap(flat.dims, flat.hf as Heightfield, turnedRegistry());
}

/** A base on flat ground: its foundations stand on the ground, and their top is level 0. */
export class Base {
  readonly w: TestWorld;
  readonly f: Frame;
  /** The height of level 0, in metres. */
  readonly top = FOUNDATION_THICK;

  constructor(w: TestWorld, x: number, z: number, yaw: number) {
    this.w = w;
    this.f = w.structs.frames.make(Math.round(x * U), Math.round(this.top * U), Math.round(z * U), yaw, TEAM);
  }

  /** Sets a piece of kind `id` down in `cell` at level `lvl`, unturned in its slot. Returns its ref. */
  put(id: string, cell: Cell, lvl = 0): number {
    const { structs, reg } = this.w;
    const kind = this.w.kind(id);
    m.set(cell.a);
    canonical(cell.cls, m, 0, dirTurn(cell.d, 0), out, 0);
    const ref = structs.place(kind, this.f.gid, key0(cell.cls, out[0]!, out[1]!, out[2]!), key1(out[3]!, lvl, canon.dir, reg.forms.layer[kind]!, 0, 0), TEAM, 1);
    if (ref < 0) throw new Error(`${id} does not fit at ${cell.a.join()} along ${cell.d}`);
    return ref;
  }

  /** Where the lattice point `a` is in the world, in whole lattice units. */
  units(a: Tuple): [number, number] {
    m.set(a);
    worldOf(this.f.basis, this.f.ox, this.f.oz, m, 0, out, 0);
    return [out[0]!, out[1]!];
  }

  /** The same in metres. */
  at(a: Tuple): [number, number] {
    const [x, z] = this.units(a);
    return [x / U, z / U];
  }
}

/** Pieces of one base, each with the cell it fills. */
export interface Built {
  readonly floors: [number, Cell][];
  readonly walls: [number, Cell][];
  readonly ceilings: [number, Cell][];
  /** The corners of the outline the walls stand on, the inside to the left: wall i runs from corner i to the next. */
  readonly outline: number[][];
  readonly refs: number[];
}

const tri = (a: Tuple, d: number): Cell => ({ cls: CLS_TRIANGLE, a, d });
const square = (a: Tuple, d: number): Cell => ({ cls: CLS_SQUARE, a, d });
const edge = (a: Tuple, d: number): Cell => ({ cls: CLS_EDGE, a, d });
const O: Tuple = [0, 0, 0, 0];

/** The square outside the side that runs from `a` along `e` of a face on its left. */
const outside = (a: Tuple, e: number): Cell => square(step(a, e - 3, 2), e);

function floorsOf(b: Base, cells: Cell[], lvl = 0): [number, Cell][] {
  return cells.map((c) => [b.put(c.cls === CLS_TRIANGLE ? (lvl === 0 ? "test:triangle_foundation" : "test:triangle_ceiling") : lvl === 0 ? "core:foundation_stone" : "core:ceiling_stone", c, lvl), c]);
}

/**
 * The mixed house: a triangle foundation along `d` with a square foundation on each of its sides, a wall on every outside
 * edge and a ceiling over each. Its three squares are one of each turn class.
 */
export function mixedHouse(b: Base, d = 0): Built {
  const corners = [O, step(O, d, 2), step(O, d + 2, 2)];
  const sides = corners.map((a, k) => [a, d + 4 * k] as const);
  const cells = [tri(O, d), ...sides.map(([a, e]) => outside(a, e))];
  const floors = floorsOf(b, cells);
  const outline: number[][] = [];
  const walls: [number, Cell][] = [];
  for (const [a, e] of sides) {
    const far = step(a, e - 3, 2);
    // Out from the triangle's corner, along the square's far side, and back to the triangle's next corner.
    for (const c of [edge(a, e - 3), edge(far, e), edge(step(far, e, 2), e + 3)]) {
      outline.push([...c.a]);
      walls.push([b.put("core:wall_stone", c), c]);
    }
  }
  const ceilings = floorsOf(b, cells, STOREY);
  return { floors, walls, ceilings, outline, refs: [...floors, ...walls, ...ceilings].map(([ref]) => ref) };
}

/** Six triangle foundations round one corner, the first along `d`. */
export function ring(b: Base, d = 0): Built {
  const floors = floorsOf(b, [0, 1, 2, 3, 4, 5].map((k) => tri(O, d + 2 * k)));
  return { floors, walls: [], ceilings: [], outline: [], refs: floors.map(([ref]) => ref) };
}

/** A dodecagon of foundations: six triangles round one corner, a square on each side of that hexagon and a triangle between each two squares. */
export function dodecagon(b: Base, d = 0): Built {
  const cells: Cell[] = [];
  for (let k = 0; k < 6; k++) {
    const corner = step(O, d + 2 * k, 2);
    const e = d + 2 * k + 4;
    cells.push(tri(O, d + 2 * k), outside(corner, e), tri(corner, e - 5));
  }
  const floors = floorsOf(b, cells);
  return { floors, walls: [], ceilings: [], outline: [], refs: floors.map(([ref]) => ref) };
}

/** A row of `n` square foundations along `d`, each with a wall on the side to the right of that way. Wall i runs from outline corner i. */
export function row(b: Base, d: number, n: number): Built {
  const cells = Array.from({ length: n }, (_, k) => square(step(O, d, 2 * k), d));
  const floors = floorsOf(b, cells);
  const walls = cells.map((c): [number, Cell] => [b.put("core:wall_stone", edge(c.a, d)), edge(c.a, d)]);
  return { floors, walls, ceilings: [], outline: [...cells.map((c) => [...c.a]), step(O, d, 2 * n)], refs: [...floors, ...walls].map(([ref]) => ref) };
}
