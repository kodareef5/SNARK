// Setting a lattice piece down by its slot. A look offers the free slots near it that pieces already built offer the form
// in hand (`candidates`); the builder's client sends the frame and the key of the one chosen; the server works everything
// out again from them (`validate`). Which form offers which slots is the OFFERS table below, over layers, never over kinds.

import { CHUNK_SIZE, STRUCT_UNITS } from "../../coords.ts";
import { PLACED_ENTITY, PLACED_NONE, PLACED_STRUCTURE, RESULT_BODY, RESULT_ENEMY_NEAR, RESULT_FAR, RESULT_INVALID, RESULT_LIMIT, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_OK, RESULT_TERRAIN, RESULT_TOO_HIGH } from "../../net/protocol.ts";
import { BUILD_REACH, SNAP_SEARCH, buried, crosses, obstructed, obstruction, tooHigh, type PieceTables, type Pose } from "../snap.ts";
import { Found, type StructureStore } from "../structures.ts";
import { levelY, worldOf } from "./basis.ts";
import { FORM_LAYERS, HALF_SIDE_M, LEVEL_M, SLOT_CLASSES, type FormLayer, type FormTable, type Rel } from "./forms.ts";
import { baseOrigin, keyFits, ownDir, poseOf, type Frame, type LatticeKey, type LatticePose } from "./frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, CLS_VERTEX, LVL_MOST, M_MOST, SIDE, canon, canonical, cellOf, dirTurn, edgesOverlap, elementCorners, facesOverlap, key0, key1, keyAnchor, keyCls, keyDir, keyFlip, keyLayer, keyLvl, keyM0, keyM1, keyM2, keyM3, tupleEqual, tupleStep, tupleWithin } from "./module.ts";
import { Cells, cellAt, edgeFaces, elementVertices, faceEdges, formCells, vertexFaces } from "./occupancy.ts";

/** Metres from the builder's eye to the piece's middle. The 3 allows for the piece's own size. */
export const PLACE_REACH = BUILD_REACH + 3;
/** Metres a nearer slot must beat the chosen one by to take its place. */
export const SWITCH_MARGIN = 0.25;
/** Metres short of where a look landed that slots are measured from. */
const END_SHORT = 0.05;
/** Metres round a slot's place that a piece offering it stands within: what `validate` searches. */
const ROW_REACH = 4.5;
/** A whole side in metres. */
const SIDE_M = SIDE * HALF_SIDE_M;
/** How much of a slot's score is its distance from the look's end. The rest is its distance from the look's whole line. */
const END_SHARE = 0.75;
/** Levels either side of its neighbour's that a foundation is offered at, where the ground allows. */
const TERRACE = 4;
/** Metres built pieces give way by before a lattice piece is asked against them: those of its own frame, and anything else. */
const GIVE_FRAME = 0.01;
const GIVE_OTHER = 0.05;

/** Which of an offering piece's neighbours a row offers. */
export const SAME = 0, SIDES = 1, ACROSS = 2, POINTS = 3, FACES = 4, ROUND = 5;
/** The level a row offers them at: the offering piece's own, the one its top is on, or the one the held piece's top reaches it from. */
export const LEVEL = 0, TOP = 1, UNDER = 2;

export interface Offer {
  readonly from: FormLayer;
  readonly to: FormLayer;
  /** SAME is its own cell; SIDES a face's edges; ACROSS the faces over each of a face's edges; POINTS a face's corners, the middles of its sides and its centre; FACES the faces either side of an edge; ROUND the faces round a vertex. */
  readonly rel: number;
  readonly at: readonly number[];
  /** The offering piece must close its cell this way: a leaf goes only in a doorway. */
  readonly host?: "doorway";
}

/**
 * What offers what. A row gives slots of the held form's class only. Two rules are not rows: a form that is always a
 * root joins only another, at each level the ground allows; and a whole piece lies on whole sides from its base's origin.
 */
export const OFFERS: readonly Offer[] = [
  { from: "slab", to: "slab", rel: ACROSS, at: [LEVEL] },
  { from: "slab", to: "fill", rel: SAME, at: [LEVEL] },
  { from: "slab", to: "wall", rel: SIDES, at: [LEVEL] },
  { from: "slab", to: "post", rel: POINTS, at: [LEVEL, UNDER] },
  { from: "slab", to: "leaf", rel: SAME, at: [LEVEL], host: "doorway" },
  { from: "wall", to: "wall", rel: SAME, at: [TOP] },
  { from: "wall", to: "slab", rel: FACES, at: [TOP] },
  { from: "wall", to: "leaf", rel: SAME, at: [LEVEL], host: "doorway" },
  { from: "post", to: "post", rel: SAME, at: [TOP, UNDER] },
  { from: "post", to: "slab", rel: ROUND, at: [TOP] },
  { from: "footing", to: "wall", rel: SAME, at: [TOP] },
];

const LEAF = FORM_LAYERS.indexOf("leaf");
const ROWS: (Offer[] | undefined)[] = [];
for (const o of OFFERS) (ROWS[FORM_LAYERS.indexOf(o.from) * 8 + FORM_LAYERS.indexOf(o.to)] ??= []).push(o);

/** Where a piece is to go, and what the checks that are not the lattice's say of a place. */
export interface Site {
  readonly structs: StructureStore;
  readonly tables: PieceTables;
  heightAt(x: number, z: number): number;
  /** Slots 30 and 60 degrees from their frame are offered and taken. Off until a piece of that turn is drawn and held up as it stands. */
  readonly turned?: boolean;
  /** The entity index of a body or a vehicle in the place (metres) of a piece of turn class `tw`, or -1. */
  body?(kind: number, x: number, y: number, z: number, yaw: number, tw: number): number;
  /** Whether another tribe has built too near (x, z). It fills the verdict's detail. */
  enemy?(x: number, z: number, out: Verdict): boolean;
  /** Whether as many pieces stand round (x, z) as may. It fills the verdict's detail. */
  full?(x: number, z: number, out: Verdict): boolean;
  /** Whether a piece at this pose (lattice units) that joins nothing would be held up: a thing, or a base's first piece. */
  stands?(kind: number, x: number, y: number, z: number, yaw: number): boolean;
  /** Whether a piece at this key of a frame would be held up. Every piece that joins a base is asked about so, and a plan's piece. */
  standsAt?(kind: number, fr: number, k0: number, k1: number): boolean;
}

/** What `validate` decided: a RESULT_ code, a PLACED_ detail and its numbers, and the pose in lattice units. */
export interface Verdict {
  code: number;
  detail: number;
  a: number;
  b: number;
  readonly pose: LatticePose;
}

export function makeVerdict(): Verdict {
  return { code: RESULT_OK, detail: PLACED_NONE, a: 0, b: 0, pose: { x: 0, y: 0, z: 0, yaw: 0, tw: 0 } };
}

/** Slots a look offers, the best first: each a frame and a key with no turn, and its score in metres. */
export interface Candidates {
  n: number;
  fr: Uint32Array;
  k0: Uint32Array;
  k1: Uint32Array;
  score: Float64Array;
}

export function makeCandidates(): Candidates {
  return { n: 0, fr: new Uint32Array(64), k0: new Uint32Array(64), k1: new Uint32Array(64), score: new Float64Array(64) };
}

/** The slots one piece offers: keys with no turn, and for a foundation the levels each is from its neighbour's. */
class Offers {
  n = 0;
  readonly k0 = new Uint32Array(96);
  readonly k1 = new Uint32Array(96);
  readonly steps = new Int8Array(96);
}

const U = STRUCT_UNITS;
/** The second word's level, and what is left of it for a cell's column: m3, direction and layer. */
const LVL_BITS = 511 << 10;
const COLUMN = (~(LVL_BITS | (3 << 26) | (1 << 28)) & 0x1fffffff) >>> 0;

const sides = new Cells();
const round = new Cells();
const cells = new Cells();
const offers = new Offers();
const near = new Found();
const cell = { k0: 0, k1: 0 };
const pose: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
const A = new Int32Array(24);
const B = new Int32Array(24);
const PA = new Int32Array(16);
const PB = new Int32Array(16);
const E = new Int32Array(16);
const m = new Int32Array(8);
const v = new Int32Array(2);

/** Whether a whole piece's key lies on whole sides from its base's origin. A post stands on any point. */
function onGrid(k0: number, k1: number): boolean {
  return keyCls(k0) === CLS_VERTEX || ((keyM0(k0) | keyM1(k0) | keyM2(k0) | keyM3(k1)) & 1) === 0;
}

let taking = offers;
let takeTurned = false;

/** Adds the cell (c0, c1) to the offers being made, `steps` levels from its neighbour's. */
function take(c0: number, c1: number, steps: number): void {
  const out = taking;
  if (c0 === 0 || !onGrid(c0, c1) || (!takeTurned && keyDir(c1) % 3 !== 0) || out.n === out.k0.length) return;
  out.k0[out.n] = c0;
  out.k1[out.n] = c1;
  out.steps[out.n++] = steps;
}

/**
 * The slots the piece of kind `by` keyed (k0, k1) offers a piece of kind `held`, to `out`. Slots off the lattice, off the
 * whole sides, or turned where `turned` is off, are left out. Nothing here knows what is built.
 */
function offersOf(forms: FormTable, turned: boolean, held: number, by: number, k0: number, k1: number, out: Offers): void {
  out.n = 0;
  const rows = ROWS[forms.layer[by]! * 8 + forms.layer[held]!];
  const from = forms.def[by]!;
  const root = forms.def[held]!.root === "always";
  // A quarter piece offers nothing and is offered nothing yet: the neighbours here are whole sides.
  if (!rows || (root && from.root !== "always") || forms.size[by] !== SIDE || forms.size[held] !== SIDE) return;
  const cls = forms.cls[held]!;
  const layer = forms.layer[held]!;
  const mine = keyCls(k0);
  taking = out;
  takeTurned = turned;
  for (const row of rows) {
    if (row.host !== undefined && from.closes !== row.host) continue;
    for (const at of row.at) {
      const lvl = keyLvl(k1) + (at === TOP ? forms.span[by]! : at === UNDER ? -forms.span[held]! : 0);
      if (Math.abs(lvl) > LVL_MOST) continue;
      const first = out.n;
      if (row.rel === SAME) {
        if (mine === cls) take(k0, cellAt(k1, lvl, layer), 0);
      } else if (row.rel === SIDES) {
        if (mine < CLS_SQUARE || cls !== CLS_EDGE) continue;
        faceEdges(k0, k1, lvl, layer, sides);
        for (let i = 0; i < sides.n; i++) take(sides.k0[i]!, sides.k1[i]!, 0);
      } else if (row.rel === ACROSS) {
        if (mine < CLS_SQUARE || cls < CLS_SQUARE) continue;
        const own = cellAt(k1, lvl, layer);
        let na = 0;
        if (cls !== mine) {
          keyAnchor(k0, k1, m, 0);
          na = elementCorners(mine, m, 0, keyDir(k1), A, 0);
        }
        faceEdges(k0, k1, lvl, layer, sides);
        for (let i = 0; i < sides.n; i++) {
          if (sides.k0[i] === 0) continue;
          edgeFaces(sides.k0[i]!, sides.k1[i]!, lvl, layer, round);
          // The square to each side of the edge, then the triangle to each. The one on the offering face's side is itself, or lies over it.
          for (let j = cls === CLS_SQUARE ? 0 : 2, end = j + 2; j < end; j++) {
            if (round.k0[j] === 0) continue;
            if (cls === mine) {
              if (round.k0[j] !== k0 || round.k1[j] !== own) take(round.k0[j]!, round.k1[j]!, 0);
              continue;
            }
            keyAnchor(round.k0[j]!, round.k1[j]!, m, 0);
            const nb = elementCorners(cls, m, 0, keyDir(round.k1[j]!), B, 0);
            if (!facesOverlap(A, 0, na, B, 0, nb)) take(round.k0[j]!, round.k1[j]!, 0);
          }
        }
      } else if (row.rel === POINTS) {
        if (mine < CLS_SQUARE || cls !== CLS_VERTEX) continue;
        elementVertices(k0, k1, lvl, layer, round);
        for (let i = 0; i < round.n; i++) take(round.k0[i]!, round.k1[i]!, 0);
        faceEdges(k0, k1, lvl, layer, sides);
        for (let i = 0; i < sides.n; i++) {
          if (sides.k0[i] === 0) continue;
          elementVertices(sides.k0[i]!, sides.k1[i]!, lvl, layer, round);
          take(round.k0[2]!, round.k1[2]!, 0);
        }
      } else if (row.rel === FACES) {
        if (mine !== CLS_EDGE || cls < CLS_SQUARE) continue;
        edgeFaces(k0, k1, lvl, layer, round);
        for (let j = cls === CLS_SQUARE ? 0 : 2, end = j + 2; j < end; j++) take(round.k0[j]!, round.k1[j]!, 0);
      } else if (row.rel === ROUND) {
        if (mine !== CLS_VERTEX || cls < CLS_SQUARE) continue;
        // Twelve squares with a corner there, twelve triangles, then the three squares it is the middle of.
        vertexFaces(k0, k1, lvl, layer, round);
        for (let j = 0; j < round.n; j++) if ((j >= 12 && j < 24) === (cls === CLS_TRIANGLE)) take(round.k0[j]!, round.k1[j]!, 0);
      }
      // A foundation beside a foundation: the same cells at the levels round its neighbour's.
      if (row.rel !== ACROSS || !root) continue;
      const last = out.n;
      for (let steps = -TERRACE; steps <= TERRACE; steps++) {
        if (steps === 0 || Math.abs(lvl + steps) > LVL_MOST) continue;
        for (let i = first; i < last; i++) take(out.k0[i]!, cellAt(out.k1[i]!, lvl + steps, layer), steps);
      }
    }
  }
}

/**
 * The cell a piece of `kind` keyed (k0, k1) names by `rel`, to `cell`: from its slot's reference point, `i` half-sides
 * along its own +X and `j` along its own +Z, to the reference point of a slot of the named class turned as the piece is.
 * False for one off the lattice.
 */
function relCell(forms: FormTable, kind: number, k0: number, k1: number, rel: Rel): boolean {
  const cls = keyCls(k0);
  const dir = keyDir(k1);
  const own = ownDir(forms, kind, k1);
  const across = dirTurn(own, 3);
  keyAnchor(k0, k1, m, 0);
  if (cls === CLS_EDGE || cls === CLS_SQUARE) tupleStep(m, 0, dir, SIDE / 2, m, 0);
  if (cls === CLS_SQUARE) tupleStep(m, 0, dirTurn(dir, 3), SIDE / 2, m, 0);
  tupleStep(m, 0, own, rel.i, m, 0);
  tupleStep(m, 0, across, rel.j, m, 0);
  const to = SLOT_CLASSES.indexOf(rel.cls);
  if (to === CLS_EDGE || to === CLS_SQUARE) tupleStep(m, 0, own, -SIDE / 2, m, 0);
  if (to === CLS_SQUARE) tupleStep(m, 0, across, -SIDE / 2, m, 0);
  canonical(to, m, 0, own, m, 4);
  const lvl = keyLvl(k1) + rel.lvl;
  if (!tupleWithin(m, 4, M_MOST) || Math.abs(lvl) > LVL_MOST) return false;
  cell.k0 = key0(to, m[4]!, m[5]!, m[6]!);
  cell.k1 = key1(m[7]!, lvl, canon.dir, FORM_LAYERS.indexOf(rel.layer), 0, 0);
  return true;
}

/** Whether one of the cells in `cells` covers the level of the cell (c0, c1). */
function covers(c0: number, c1: number): boolean {
  const lvl = keyLvl(c1);
  for (let i = 0; i < cells.n; i++) {
    if (cells.k0[i] !== c0 || ((cells.k1[i]! ^ c1) & COLUMN) !== 0) continue;
    const from = keyLvl(cells.k1[i]!);
    if (lvl >= from && lvl < from + cells.reach[i]!) return true;
  }
  return false;
}

/** `taken` for a piece with a cell off the lattice. */
const OFF = 0x7fffffff;

/** The ref of a piece in a cell that a piece of `kind` keyed (k0, k1) in frame `fr` would cover, -1 for none, or OFF. Leaves its cells in `cells`. */
function taken(structs: StructureStore, forms: FormTable, kind: number, fr: number, k0: number, k1: number): number {
  if (!formCells(forms, kind, k0, k1, cells)) return OFF;
  const occupied = structs.occupied;
  for (let i = 0; i < cells.n; i++) {
    const c1 = cells.k1[i]!;
    const under = occupied.covering(fr, cells.k0[i]!, c1);
    if (under >= 0) return under;
    for (let up = 1; up < cells.reach[i]!; up++) {
      const over = occupied.at(fr, cells.k0[i]!, cellAt(c1, keyLvl(c1) + up, keyLayer(c1)));
      if (over >= 0) return over;
    }
  }
  return -1;
}

/** The ref of a piece in a slot that a piece of `kind` keyed (k0, k1) would block, or -1. */
function blocking(structs: StructureStore, forms: FormTable, kind: number, fr: number, k0: number, k1: number): number {
  const blocks = forms.def[kind]!.blocks;
  if (!blocks) return -1;
  for (const rel of blocks) {
    if (!relCell(forms, kind, k0, k1, rel)) continue;
    const ref = structs.covering(fr, cell.k0, cell.k1);
    if (ref >= 0) return ref;
  }
  return -1;
}

// ---------------------------------------------------------------- how far a look is from a slot

/** The squared distance between the segments p1 to q1 and p2 to q2. Either may be a point. */
function segments(p1x: number, p1y: number, p1z: number, q1x: number, q1y: number, q1z: number, p2x: number, p2y: number, p2z: number, q2x: number, q2y: number, q2z: number): number {
  const ax = q1x - p1x, ay = q1y - p1y, az = q1z - p1z;
  const bx = q2x - p2x, by = q2y - p2y, bz = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = ax * ax + ay * ay + az * az;
  const e = bx * bx + by * by + bz * bz;
  const f = bx * rx + by * ry + bz * rz;
  const c = ax * rx + ay * ry + az * rz;
  let s = 0;
  let t = 0;
  if (a > 1e-12 && e > 1e-12) {
    const b = ax * bx + ay * by + az * bz;
    const den = a * e - b * b;
    s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
    t = (b * s + f) / e;
    if (t < 0) [t, s] = [0, Math.min(1, Math.max(0, -c / a))];
    else if (t > 1) [t, s] = [1, Math.min(1, Math.max(0, (b - c) / a))];
  } else if (e > 1e-12) t = Math.min(1, Math.max(0, f / e));
  else if (a > 1e-12) s = Math.min(1, Math.max(0, -c / a));
  const dx = rx + ax * s - bx * t, dy = ry + ay * s - by * t, dz = rz + az * s - bz * t;
  return dx * dx + dy * dy + dz * dz;
}

/** A slot's shape in metres: its corners in plan, and the heights it runs between (a post stands up from its level). */
const shape = { n: 0, x: new Float64Array(4), z: new Float64Array(4), y0: 0, y1: 0 };

function shapeOf(f: Frame, forms: FormTable, kind: number, k0: number, k1: number): void {
  const cls = keyCls(k0);
  keyAnchor(k0, k1, m, 0);
  const n = elementCorners(cls, m, 0, keyDir(k1), E, 0);
  for (let i = 0; i < n; i++) {
    worldOf(f.basis, f.ox, f.oz, E, 4 * i, v, 0);
    shape.x[i] = v[0]! / U;
    shape.z[i] = v[1]! / U;
  }
  shape.n = n;
  shape.y0 = levelY(f.oy, keyLvl(k1)) / U;
  shape.y1 = cls === CLS_VERTEX ? levelY(f.oy, keyLvl(k1) + forms.span[kind]!) / U : shape.y0;
}

/** Whether (x, z) is over the shape, a face. */
function over(x: number, z: number): boolean {
  let sign = 0;
  for (let i = 0; i < shape.n; i++) {
    const j = i + 1 === shape.n ? 0 : i + 1;
    const side = (shape.x[j]! - shape.x[i]!) * (z - shape.z[i]!) - (shape.z[j]! - shape.z[i]!) * (x - shape.x[i]!);
    if (side === 0) continue;
    if (sign !== 0 && side > 0 !== sign > 0) return false;
    sign = side;
  }
  return true;
}

/** Metres from the segment a to b to the shape. */
function far(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const y = shape.y0;
  if (shape.n === 1) return Math.sqrt(segments(ax, ay, az, bx, by, bz, shape.x[0]!, y, shape.z[0]!, shape.x[0]!, shape.y1, shape.z[0]!));
  if (shape.n === 2) return Math.sqrt(segments(ax, ay, az, bx, by, bz, shape.x[0]!, y, shape.z[0]!, shape.x[1]!, y, shape.z[1]!));
  // Through the face, over it at either end, or else nearest one of its sides.
  if (ay !== by && (ay - y) * (by - y) <= 0) {
    const t = (y - ay) / (by - ay);
    if (over(ax + (bx - ax) * t, az + (bz - az) * t)) return 0;
  }
  let best = Infinity;
  for (let i = 0; i < shape.n; i++) {
    const j = i + 1 === shape.n ? 0 : i + 1;
    best = Math.min(best, segments(ax, ay, az, bx, by, bz, shape.x[i]!, y, shape.z[i]!, shape.x[j]!, y, shape.z[j]!));
  }
  if (over(ax, az)) best = Math.min(best, (ay - y) * (ay - y));
  if (over(bx, bz)) best = Math.min(best, (by - y) * (by - y));
  return Math.sqrt(best);
}

// ---------------------------------------------------------------- choosing

/** Slots found, before they are judged, and where each is in a table keyed by frame and key. */
let cap = 256;
let uFr = new Uint32Array(cap);
let uK0 = new Uint32Array(cap);
let uK1 = new Uint32Array(cap);
let uSteps = new Uint8Array(cap);
let table = new Int32Array(cap * 4);
let order = new Int32Array(cap);
let scores = new Float64Array(cap);
/** Cells that pieces near block, three numbers each: frame, first word, second word. */
const blocked: number[] = [];

function grow(): void {
  cap *= 2;
  const widen = <T extends Uint32Array | Uint8Array>(old: T, next: T): T => (next.set(old), next);
  uFr = widen(uFr, new Uint32Array(cap));
  uK0 = widen(uK0, new Uint32Array(cap));
  uK1 = widen(uK1, new Uint32Array(cap));
  uSteps = widen(uSteps, new Uint8Array(cap));
  order = new Int32Array(cap);
  scores = new Float64Array(cap);
  table = new Int32Array(cap * 4);
}

/** Adds a slot, or keeps the fewer steps of one found before. Returns the count. */
function note(n: number, fr: number, k0: number, k1: number, steps: number): number {
  const mask = table.length - 1;
  let h = (Math.imul(fr, 0x9e3779b1) ^ Math.imul(k0, 0x85ebca6b) ^ Math.imul(k1, 0xc2b2ae35)) >>> 0;
  h = (h ^ (h >>> 15)) & mask;
  for (; table[h] !== 0; h = (h + 1) & mask) {
    const i = table[h]! - 1;
    if (uFr[i] !== fr || uK0[i] !== k0 || uK1[i] !== k1) continue;
    if (steps < uSteps[i]!) uSteps[i] = steps;
    return n;
  }
  table[h] = n + 1;
  uFr[n] = fr;
  uK0[n] = k0;
  uK1[n] = k1;
  uSteps[n] = steps;
  return n + 1;
}

/**
 * The slots a look offers a piece of `kind`, to `out`, the best first. The look runs from (ox, oy, oz) along the unit
 * direction (dx, dy, dz) for `hitT` metres, to what it landed on or to the end of the builder's reach. Rows near its end,
 * in frames of `team`, each offer what OFFERS gives them, and one slot offered twice is one candidate. A slot is kept if it
 * is free, nothing blocks it, its middle is within SNAP_SEARCH of the look's end and in reach of the eye, and for a foundation the
 * ground allows it. Its score is its distance from the look's end, three parts in four, and from the look's whole line, so
 * what the builder points at wins and what the look passes on its way breaks a tie. A foundation off its neighbour's level
 * comes after every one level with it. Ties go by frame and key. Returns how many.
 */
export function candidates(site: Site, kind: number, team: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, hitT: number, out: Candidates): number {
  out.n = 0;
  const structs = site.structs;
  const forms = structs.forms;
  if (!forms || !(kind > 0 && kind < forms.cls.length) || forms.cls[kind]! < 0 || team === 0) return 0;
  const ex = ox + dx * hitT;
  const ez = oz + dz * hitT;
  // Slots are measured from a little short of where the look landed: the builder's side of a floor's top or its underside.
  const short = Math.max(0, hitT - END_SHORT);
  const sx = ox + dx * short;
  const sy = oy + dy * short;
  const sz = oz + dz * short;
  const n = gather(site, forms, kind, team, ex, ez, sx, sy, sz);
  let kept = 0;
  const reach = PLACE_REACH * PLACE_REACH;
  for (let i = 0; i < n; i++) {
    const fr = uFr[i]!;
    const k0 = uK0[i]!;
    const k1 = uK1[i]!;
    const f = structs.frames.get(fr)!;
    shapeOf(f, forms, kind, k0, k1);
    // Its middle is in reach of the look's end, as a socket's place was. Most slots found are not, so this is asked first.
    let mx = 0;
    let mz = 0;
    for (let c = 0; c < shape.n; c++) {
      mx += shape.x[c]! / shape.n;
      mz += shape.z[c]! / shape.n;
    }
    const my = (shape.y0 + shape.y1) / 2;
    if ((mx - sx) * (mx - sx) + (my - sy) * (my - sy) + (mz - sz) * (mz - sz) > SNAP_SEARCH * SNAP_SEARCH) continue;
    if (taken(structs, forms, kind, fr, k0, k1) >= 0 || blocking(structs, forms, kind, fr, k0, k1) >= 0) continue;
    let shut = false;
    for (let b = 0; b < blocked.length && !shut; b += 3) shut = blocked[b] === fr && covers(blocked[b + 1]!, blocked[b + 2]!);
    if (shut) continue;
    poseOf(f, k0, k1, forms, kind, pose);
    const px = pose.x / U - ox;
    const py = pose.y / U - oy;
    const pz = pose.z / U - oz;
    if (px * px + py * py + pz * pz > reach || tooHigh(site.heightAt, site.tables, kind, pose, pose.tw) || buried(site.heightAt, site.tables, kind, pose, pose.tw)) continue;
    const end = far(sx, sy, sz, sx, sy, sz);
    scores[i] = END_SHARE * end + (1 - END_SHARE) * far(ox, oy, oz, sx, sy, sz) + uSteps[i]! * SNAP_SEARCH;
    order[kept++] = i;
  }
  return give(out, kept);
}

/**
 * Every slot that rows of `team` near (x, y, z) metres offer a piece of `kind`, built on or not, whose middle is within
 * SNAP_SEARCH of the point, to `out`, the nearest first. For a builder that names a place and not a look: no reach is
 * asked, and nothing of what stands in a slot. Returns how many.
 */
export function slotsNear(site: Site, kind: number, team: number, x: number, y: number, z: number, out: Candidates): number {
  out.n = 0;
  const structs = site.structs;
  const forms = structs.forms;
  if (!forms || !(kind > 0 && kind < forms.cls.length) || forms.cls[kind]! < 0 || team === 0) return 0;
  const n = gather(site, forms, kind, team, x, z, x, y, z);
  let kept = 0;
  for (let i = 0; i < n; i++) {
    shapeOf(structs.frames.get(uFr[i]!)!, forms, kind, uK0[i]!, uK1[i]!);
    let mx = 0;
    let mz = 0;
    for (let c = 0; c < shape.n; c++) {
      mx += shape.x[c]! / shape.n;
      mz += shape.z[c]! / shape.n;
    }
    const my = (shape.y0 + shape.y1) / 2;
    const far2 = (mx - x) * (mx - x) + (my - y) * (my - y) + (mz - z) * (mz - z);
    if (far2 > SNAP_SEARCH * SNAP_SEARCH) continue;
    scores[i] = Math.sqrt(far2) + uSteps[i]! * SNAP_SEARCH;
    order[kept++] = i;
  }
  return give(out, kept);
}

/**
 * The slots the piece `ref` offers a piece of `kind`, built on or not, to `out` in the order OFFERS gives them: a
 * foundation's other levels after its neighbour's own. Each has a score of 0. Returns how many.
 */
export function slotsOf(site: Site, kind: number, ref: number, out: Candidates): number {
  out.n = 0;
  const structs = site.structs;
  const forms = structs.forms;
  const t = structs.chunks[Math.floor(ref / 65536)];
  const slot = ref & 0xffff;
  if (!forms || !(kind > 0 && kind < forms.cls.length) || forms.cls[kind]! < 0 || !t || !t.fr || slot >= t.high || t.fr[slot] === 0) return 0;
  offersOf(forms, site.turned === true, kind, t.kind[slot]!, t.k0![slot]!, t.k1![slot]!, offers);
  table.fill(0);
  while (offers.n * 2 > cap) grow();
  let n = 0;
  for (let i = 0; i < offers.n; i++) n = note(n, t.fr[slot]!, offers.k0[i]!, offers.k1[i]!, Math.abs(offers.steps[i]!));
  for (let i = 0; i < n; i++) {
    scores[i] = 0;
    order[i] = i;
  }
  return give(out, n, false);
}

/** The first `kept` of `order` to `out`, by score, then by fewest levels off, frame and key; or as they stand. */
function give(out: Candidates, kept: number, sort = true): number {
  const sorted = order.subarray(0, kept);
  if (sort) sorted.sort((a, b) => scores[a]! - scores[b]! || uFr[a]! - uFr[b]! || uK0[a]! - uK0[b]! || uK1[a]! - uK1[b]!);
  if (out.fr.length < kept) {
    out.fr = new Uint32Array(cap);
    out.k0 = new Uint32Array(cap);
    out.k1 = new Uint32Array(cap);
    out.score = new Float64Array(cap);
  }
  for (let i = 0; i < kept; i++) {
    const from = sorted[i]!;
    out.fr[i] = uFr[from]!;
    out.k0[i] = uK0[from]!;
    out.k1[i] = uK1[from]!;
    out.score[i] = scores[from]!;
  }
  return (out.n = kept);
}

/**
 * Notes every slot that rows of `team` near the point (ex, ez) offer a piece of `kind`, each once, and what the rows
 * block. A row is asked if its middle is near enough (sx, sy, sz) for a slot of it to be in reach of there. Returns how many.
 */
function gather(site: Site, forms: FormTable, kind: number, team: number, ex: number, ez: number, sx: number, sy: number, sz: number): number {
  const structs = site.structs;
  const pad = SNAP_SEARCH + 3;
  const rows = structs.query(ex - pad, ez - pad, ex + pad, ez + pad, near);
  const refs = near.refs;
  const turned = site.turned === true;
  // Half the held piece's height, and for a foundation the levels it may be off its neighbour's.
  const tall = (structs.top[kind]! - structs.low[kind]!) / 2 + (forms.def[kind]!.root === "always" ? TERRACE * LEVEL_M : 0);
  table.fill(0);
  blocked.length = 0;
  let n = 0;
  let lastFr = 0;
  let mine = false;
  for (let r = 0; r < rows; r++) {
    const t = structs.chunks[Math.floor(refs[r]! / 65536)]!;
    const slot = refs[r]! & 0xffff;
    const fr = t.fr ? t.fr[slot]! : 0;
    if (fr === 0) continue;
    const by = t.kind[slot]!;
    // A piece offers nothing whose middle is farther from its own than a side along and the two pieces' half heights up.
    const rx = t.x[slot]! - sx;
    const ry = t.y[slot]! - sy;
    const rz = t.z[slot]! - sz;
    const up = (structs.top[by]! - structs.low[by]!) / 2 + tall;
    if (rx * rx + ry * ry + rz * rz > SNAP_SEARCH * SNAP_SEARCH + 2 * SNAP_SEARCH * Math.sqrt(SIDE_M * SIDE_M + up * up) + SIDE_M * SIDE_M + up * up) continue;
    if (fr !== lastFr) mine = structs.frames.get((lastFr = fr))!.team === team;
    if (!mine) continue;
    const blocks = forms.def[by]!.blocks;
    if (blocks) for (const rel of blocks) if (relCell(forms, by, t.k0![slot]!, t.k1![slot]!, rel)) blocked.push(fr, cell.k0, cell.k1);
    offersOf(forms, turned, kind, by, t.k0![slot]!, t.k1![slot]!, offers);
    for (let i = 0; i < offers.n; i++) {
      if ((n + 1) * 2 > cap) {
        // The table is made again from the slots found.
        grow();
        for (let k = 0; k < n; k++) note(k, uFr[k]!, uK0[k]!, uK1[k]!, uSteps[k]!);
      }
      n = note(n, fr, offers.k0[i]!, offers.k1[i]!, Math.abs(offers.steps[i]!));
    }
  }
  return n;
}

/**
 * Which candidate to show when the one shown last was the slot (fr, k0, k1): that one still, unless it is no longer
 * offered or the best beats it by SWITCH_MARGIN. Its turn and flip are not looked at. -1 with nothing offered.
 */
export function choose(c: Candidates, fr: number, k0: number, k1: number): number {
  if (c.n === 0) return -1;
  const held = cellOf(k1);
  for (let i = 1; i < c.n; i++) if (c.fr[i] === fr && c.k0[i] === k0 && c.k1[i] === held) return c.score[0]! < c.score[i]! - SWITCH_MARGIN ? 0 : i;
  return 0;
}

/** The key `i` whole sides along direction `dir` from the key (k0, k1), to `out`: piece `i` of a row. False off the lattice. */
export function runKey(k0: number, k1: number, dir: number, i: number, out: LatticeKey): boolean {
  keyAnchor(k0, k1, m, 0);
  tupleStep(m, 0, dir, i * SIDE, m, 0);
  if (!tupleWithin(m, 0, M_MOST)) return false;
  out.k0 = key0(keyCls(k0), m[0]!, m[1]!, m[2]!);
  out.k1 = ((k1 & ~1023) | (m[3]! + M_MOST + 1)) >>> 0;
  return true;
}

// ---------------------------------------------------------------- judging

/** Whether a piece of `kind` keyed (k0, k1) is offered by a piece of frame `f` standing near `at`, its pose. */
function offered(site: Site, forms: FormTable, kind: number, f: Frame, k0: number, k1: number, at: LatticePose): boolean {
  const structs = site.structs;
  const want = cellOf(k1);
  const x = at.x / U;
  const z = at.z / U;
  const y = at.y / U;
  const rows = structs.query(x - ROW_REACH, z - ROW_REACH, x + ROW_REACH, z + ROW_REACH, near, y - ROW_REACH, y + ROW_REACH);
  for (let r = 0; r < rows; r++) {
    const t = structs.chunks[Math.floor(near.refs[r]! / 65536)]!;
    const slot = near.refs[r]! & 0xffff;
    if (!t.fr || t.fr[slot] !== f.gid || !ROWS[forms.layer[t.kind[slot]!]! * 8 + forms.layer[kind]!]) continue;
    const dx = t.x[slot]! - x;
    const dy = t.y[slot]! - y;
    const dz = t.z[slot]! - z;
    if (dx * dx + dy * dy + dz * dz > ROW_REACH * ROW_REACH) continue;
    offersOf(forms, site.turned === true, kind, t.kind[slot]!, t.k0![slot]!, t.k1![slot]!, offers);
    for (let i = 0; i < offers.n; i++) if (offers.k0[i] === k0 && offers.k1[i] === want) return true;
  }
  return false;
}

/** The corners of a piece's element, to `out`: an edge's piece from its first end to its last. Returns how many. */
function cornersOf(forms: FormTable, kind: number, k0: number, k1: number, out: Int32Array): number {
  const cls = keyCls(k0);
  keyAnchor(k0, k1, m, 0);
  if (cls !== CLS_EDGE) return elementCorners(cls, m, 0, keyDir(k1), out, 0);
  let wide = 1;
  for (const c of forms.def[kind]!.cells ?? []) wide = Math.max(wide, c[0] + 1);
  for (let i = 0; i <= wide; i++) tupleStep(m, 0, keyDir(k1), i * SIDE, out, 4 * i);
  return wide + 1;
}

/** An element's corners as the predicates take them, to `out`: a face's as they are, an edge's piece as its two ends. Returns how many. */
function outline(cls: number, corners: Int32Array, n: number, out: Int32Array): number {
  const count = cls === CLS_EDGE ? 2 : n;
  for (let i = 0; i < count; i++) {
    const from = 4 * (cls === CLS_EDGE && i === 1 ? n - 1 : i);
    for (let k = 0; k < 4; k++) out[4 * i + k] = corners[from + k]!;
  }
  return count;
}

/** Whether a piece on `la` standing `sa` levels and one on `lb` standing `sb` share a height. A slab lies on what ends at its level. */
function levelsMeet(la: number, sa: number, lb: number, sb: number): boolean {
  if (sa === 0) return sb === 0 ? la === lb : lb < la && la < lb + sb;
  return sb === 0 ? la < lb && lb < la + sa : la < lb + sb && lb < la + sa;
}

/**
 * The ref of a built piece that a piece of `kind` keyed (k0, k1) in frame `f`, at `at`, would overlap, or -1. Against a
 * piece of its own frame that shares a corner with it the lattice's own predicates decide, exactly. Against one that shares
 * none, the solids do, since places drift from their ideal ones far along the 30 and 60 degree directions. Against anything
 * else the solids do, the built piece giving way a little. The new piece gives way by nothing.
 */
function crowding(site: Site, forms: FormTable, kind: number, f: Frame, k0: number, k1: number, at: LatticePose): number {
  const structs = site.structs;
  const parts = site.tables.parts;
  const x = at.x / U;
  const y = at.y / U;
  const z = at.z / U;
  const reach = structs.spread[kind]!;
  const rows = structs.query(x - reach, z - reach, x + reach, z + reach, near);
  const cls = keyCls(k0);
  const lvl = keyLvl(k1);
  const span = forms.span[kind]!;
  const leaf = keyLayer(k1) === LEAF;
  const na = cornersOf(forms, kind, k0, k1, A);
  const pa = outline(cls, A, na, PA);
  for (let r = 0; r < rows; r++) {
    const ref = near.refs[r]!;
    const t = structs.chunks[Math.floor(ref / 65536)]!;
    const slot = ref & 0xffff;
    if (!t.fr || t.fr[slot] !== f.gid) {
      if (crosses(structs, parts, kind, x, y, z, at.yaw, at.tw, ref, 0, 0, GIVE_OTHER, 0)) return ref;
      continue;
    }
    const other = t.kind[slot]!;
    const b0 = t.k0![slot]!;
    const b1 = t.k1![slot]!;
    if (!levelsMeet(lvl, span, keyLvl(b1), forms.span[other]!)) continue;
    // A leaf stands in its host's own cell.
    if ((leaf || keyLayer(b1) === LEAF) && b0 === k0 && ((b1 ^ k1) & COLUMN & ~(7 << 23)) === 0) continue;
    const their = keyCls(b0);
    const nb = cornersOf(forms, other, b0, b1, B);
    let shared = false;
    for (let i = 0; i < na && !shared; i++) for (let j = 0; j < nb && !shared; j++) shared = tupleEqual(A, 4 * i, B, 4 * j);
    if (!shared) {
      if (crosses(structs, parts, kind, x, y, z, at.yaw, at.tw, ref, GIVE_FRAME, 0, GIVE_FRAME, 0)) return ref;
      continue;
    }
    if (cls === CLS_VERTEX || their === CLS_VERTEX) continue;
    const pb = outline(their, B, nb, PB);
    if (cls === CLS_EDGE && their === CLS_EDGE ? edgesOverlap(PA, 0, PB, 0) : facesOverlap(PA, 0, pa, PB, 0, pb)) return ref;
  }
  return -1;
}

function refuse(out: Verdict, code: number, detail = PLACED_NONE, a = 0): number {
  out.detail = detail;
  out.a = a;
  return (out.code = code);
}

/** What is asked of any piece once its pose is known, in the order a builder is told of it: bodies, the ground, other tribes, the cap, support. */
function rest(site: Site, kind: number, at: Pose, tw: number, out: Verdict, fr = 0, k0 = 0, k1 = 0): number {
  const x = at.x / U;
  const y = at.y / U;
  const z = at.z / U;
  const body = site.body ? site.body(kind, x, y, z, at.yaw, tw) : -1;
  if (body >= 0) return refuse(out, RESULT_BODY, PLACED_ENTITY, body);
  if (tooHigh(site.heightAt, site.tables, kind, at, tw)) return refuse(out, RESULT_TOO_HIGH);
  if (buried(site.heightAt, site.tables, kind, at, tw)) return refuse(out, RESULT_TERRAIN);
  out.detail = PLACED_NONE;
  if (site.enemy?.(x, z, out)) return (out.code = RESULT_ENEMY_NEAR);
  if (site.full?.(x, z, out)) return (out.code = RESULT_LIMIT);
  // A piece in a slot is asked about by its key. A pose says no slot.
  if (fr !== 0 ? site.standsAt && !site.standsAt(kind, fr, k0, k1) : site.stands && !site.stands(kind, at.x, at.y, at.z, at.yaw)) return refuse(out, RESULT_NO_SUPPORT);
  return (out.code = RESULT_OK);
}

/**
 * Judges a piece of `kind` set by a builder of `team`, whose eye is at (ex, ey, ez) metres, in the slot (k0, k1) of frame
 * `fr`. An eye of NaN is not asked for its reach: a row's later pieces are reached through the row.
 * Returns a RESULT_ code, which `out` holds too with its detail and the pose. In this order: the frame is made and
 * the team's; the key is one the kind may have, on the lattice; some piece standing offers the slot; the pose is on the
 * map; the eye reaches it; its cells are free and nothing blocks them or is blocked by it; it overlaps nothing built
 * (`crowding`); then bodies, the ground, other tribes, the cap and support, as the site answers them.
 */
export function validate(site: Site, kind: number, team: number, fr: number, k0: number, k1: number, ex: number, ey: number, ez: number, out: Verdict): number {
  const structs = site.structs;
  const forms = structs.forms;
  if (!forms || !(kind > 0 && kind < forms.cls.length) || forms.cls[kind]! < 0) return refuse(out, RESULT_INVALID);
  const f = structs.frames.get(fr);
  if (!f) return refuse(out, RESULT_NO_SNAP);
  if (team === 0 || f.team !== team) return refuse(out, RESULT_NOT_YOURS);
  return judge(site, forms, kind, f, k0, k1, ex, ey, ez, out, false);
}

/**
 * `validate` for a plan's piece (server/plans.ts) in the frame `f`, which need not be made yet: under a gid no frame has,
 * it is judged against what stands of other bases. Nothing built need offer its slot, it may be flipped, and it is held
 * up as its key says (Site.standsAt).
 */
export function validatePlan(site: Site, kind: number, team: number, f: Frame, k0: number, k1: number, ex: number, ey: number, ez: number, out: Verdict, reach = PLACE_REACH): number {
  const forms = site.structs.forms;
  if (!forms || !(kind > 0 && kind < forms.cls.length) || forms.cls[kind]! < 0) return refuse(out, RESULT_INVALID);
  if (team === 0 || f.team !== team) return refuse(out, RESULT_NOT_YOURS);
  return judge(site, forms, kind, f, k0, k1, ex, ey, ez, out, true, reach);
}

function judge(site: Site, forms: FormTable, kind: number, f: Frame, k0: number, k1: number, ex: number, ey: number, ez: number, out: Verdict, plan: boolean, reach = PLACE_REACH): number {
  const structs = site.structs;
  const fr = f.gid;
  // No form says yet that it may be flipped.
  if (!keyFits(forms, kind, k0, k1) || (!plan && keyFlip(k1) !== 0) || !formCells(forms, kind, k0, k1, cells)) return refuse(out, RESULT_INVALID);
  const at = out.pose;
  poseOf(f, k0, k1, forms, kind, at);
  const x = at.x / U;
  const y = at.y / U;
  const z = at.z / U;
  if (!(x >= 0 && z >= 0 && x < structs.dims.chunksX * CHUNK_SIZE && z < structs.dims.chunksZ * CHUNK_SIZE)) return refuse(out, RESULT_INVALID);
  if ((forms.size[kind] === SIDE && !onGrid(k0, k1)) || (site.turned !== true && at.tw !== 0) || (!plan && !offered(site, forms, kind, f, k0, k1, at))) return refuse(out, RESULT_NO_SNAP);
  if ((x - ex) * (x - ex) + (y - ey) * (y - ey) + (z - ez) * (z - ez) > reach * reach) return refuse(out, RESULT_FAR);
  let by = taken(structs, forms, kind, fr, k0, k1);
  if (by < 0) by = blocking(structs, forms, kind, fr, k0, k1);
  if (by < 0) {
    // What a piece near blocks, asked against this piece's cells, which `taken` left.
    const rows = structs.query(x - SNAP_SEARCH, z - SNAP_SEARCH, x + SNAP_SEARCH, z + SNAP_SEARCH, near);
    for (let r = 0; r < rows && by < 0; r++) {
      const t = structs.chunks[Math.floor(near.refs[r]! / 65536)]!;
      const slot = near.refs[r]! & 0xffff;
      if (!t.fr || t.fr[slot] !== fr) continue;
      const blocks = forms.def[t.kind[slot]!]!.blocks;
      if (blocks) for (const rel of blocks) if (relCell(forms, t.kind[slot]!, t.k0![slot]!, t.k1![slot]!, rel) && covers(cell.k0, cell.k1)) by = near.refs[r]!;
    }
  }
  if (by < 0) by = crowding(site, forms, kind, f, k0, k1, at);
  if (by >= 0) return refuse(out, RESULT_OBSTRUCTED, PLACED_STRUCTURE, by);
  return rest(site, kind, at, at.tw, out, fr, k0, k1);
}

/**
 * Judges a piece of `kind` that joins nothing, at a pose in lattice units: a base's first piece, or a thing on the ground
 * or on a floor. The eye reaches it; it overlaps nothing built, a thing by `obstructed` and a lattice piece with no give
 * of its own; then as `validate` ends.
 */
export function validateFree(site: Site, kind: number, at: Pose, ex: number, ey: number, ez: number, out: Verdict): number {
  const structs = site.structs;
  const x = at.x / U;
  const y = at.y / U;
  const z = at.z / U;
  out.pose.x = at.x;
  out.pose.y = at.y;
  out.pose.z = at.z;
  out.pose.yaw = at.yaw;
  out.pose.tw = 0;
  if ((x - ex) * (x - ex) + (y - ey) * (y - ey) + (z - ez) * (z - ez) > PLACE_REACH * PLACE_REACH) return refuse(out, RESULT_FAR);
  if (!structs.forms || structs.forms.cls[kind]! < 0) {
    if (obstructed(structs, site.tables.parts, kind, x, y, z, at.yaw)) return refuse(out, RESULT_OBSTRUCTED, PLACED_STRUCTURE, obstruction.ref);
    return rest(site, kind, at, 0, out);
  }
  const reach = structs.spread[kind]!;
  const rows = structs.query(x - reach, z - reach, x + reach, z + reach, near);
  for (let r = 0; r < rows; r++) if (crosses(structs, site.tables.parts, kind, x, y, z, at.yaw, 0, near.refs[r]!, 0, 0, GIVE_OTHER, 0)) return refuse(out, RESULT_OBSTRUCTED, PLACED_STRUCTURE, near.refs[r]!);
  return rest(site, kind, at, 0, out);
}

const origin = { ox: 0, oy: 0, oz: 0 };

/**
 * Sets down the first piece of a new base at a pose in lattice units, owned by `team`: a frame whose origin the piece
 * gives, and the piece in its first slot. Returns the ref, or -1 where the store has no room. Authority only.
 */
export function startBase(structs: StructureStore, kind: number, at: Pose, team: number, hp: number): number {
  const forms = structs.forms!;
  baseOrigin(forms, kind, at.x, at.y, at.z, at.yaw, origin);
  const f = structs.frames.make(origin.ox, origin.oy, origin.oz, at.yaw, team);
  const ref = structs.place(kind, f.gid, key0(forms.cls[kind]!, 0, 0, 0), key1(0, 0, 0, forms.layer[kind]!, 0, 0), team, hp);
  if (ref < 0) structs.frames.drop(f.gid);
  return ref;
}
