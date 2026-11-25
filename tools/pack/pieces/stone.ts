// The stone tier's recipe: rough-cut limestone laid in lime mortar, dressed jamb stones, oak lintels, sills and beams,
// flagstone floors and an iron-bound oak door. Ported from the tier's Blender scripts (layout.py, parts.py and model.py
// under assets/source/core/structures/stone), drawing from the same seeds, so its stones are the ones those made and
// the painted pictures fit them joint for joint. It works in their frame, the game's: +y up, the front at +z.
//
// Levels: 0 is every stone a solid of its own with a flat face shaded as its crown, the top course and the stones cut
// at a wall's ends crowned as the scripts crowned them; 1 is each face of a piece one flat sheet welded from a cell to a
// stone, each cell shaded as the stone it is, bevels and all; 2 is plain solids that wear the pictures; 3 and 4 are
// plain solids in flat colours. The pictures' normal maps hold a stone's grain and not its crown, so the crown is here.
//
// Texture coordinates are metres over the 3 m tile from a face's top left corner, as the pictures are painted.

import { HALF_SIDE_M, outlineBox, type FormDef } from "../../../shared/world/lattice/forms.ts";
import { Carved, add, beamRings, clip, cross, dot, gateLeaves, inset as insetPlan, length, mirror, place, planeAt, planeMoved, rimStrips, scale, slabOn, sub, unit, uprightPlane, type Flat, type Plane as KitPlane, type Shape, type SlabMap, type Uv, type Vec } from "./kit.ts";
import { planOf, yieldPlanes, type TierRecipe } from "./lod.ts";
import { PyRandom } from "./mt.ts";

const H = HALF_SIDE_M;
const TILE = 2 * H;
type P2 = readonly [number, number];
/** Texture coordinates of a point as the scripts gave them: v runs down from a picture's first row. */
type UvMap = (p: Vec) => Uv;

// The laid patterns, in metres on the building grid: u runs right across a face as it is seen and v down from its top.

/** The bed joints of a wall's eight courses, top first. The door's head and the window's head and sill each fall on one. */
const BEDS = [0, 0.35, 0.6875, 1.1, 1.45, 1.8, 2.2, 2.6, 3.0] as const;
type Head = number | P2;
/** Each course's head joints. A pair is a joint that leans: where it meets the bed above, and below. A course's last stone wraps into the next span. */
const HEADS: readonly (readonly Head[])[] = [
  [0.154, [0.571, 0.588], [1.466, 1.449], 2.15, 2.444],
  [0.4, [1.236, 1.252], [1.975, 1.958], 2.6],
  [0.53, 2.46],
  [0.4, [1.012, 1.028], [2.03, 2.015], 2.59],
  [0.55, 1.593, 2.47],
  [0.25, [0.792, 0.778], 1.33, [1.868, 1.884], 2.7],
  [0.5, [1.082, 1.097], 1.5, 2.124, 2.52],
  [0.3, [0.9, 0.884], [1.716, 1.731], 2.75],
];
/** Stones laid two to a course: the course, the head joint the stone starts at, and v of the bed between the two. */
const STACKED: readonly (readonly [number, number, number])[] = [[0, 2.15, 0.17], [6, 1.5, 2.39], [1, 0.4, 0.47], [3, 2.03, 1.25], [4, 0.55, 1.62], [7, 0.9, 2.86], [5, 0.25, 1.95]];
/** Stones two courses tall: the course and the head joint each starts at. The course below is cut back round it. */
const JUMPERS: readonly (readonly [number, number])[] = [[5, 1.33]];
/** One course laid as two thin ones between two of its head joints. Over a window the lower one is the lintel. */
const SPLIT = { course: 2, from: 0.53, to: 2.46, bed: 0.85, upper: [1.443], lower: [1.266, 1.859] } as const;
/** Where a door or a window cuts the courses: its edges, the jamb courses with their outer joints, the lintel, and the sill's v. */
interface Cut {
  open: P2;
  jambs: readonly (readonly [number, number, number])[];
  lintel: readonly [number, number, number];
  sill: number;
}
const DOOR: Cut = { open: [0.8, 2.2], jambs: [2, 3, 4, 5, 6, 7].map((k) => [k, HEADS[k]![0] as number, HEADS[k]![HEADS[k]!.length - 1] as number] as const), lintel: [1, 0.4, 2.6], sill: TILE };
const WINDOW: Cut = { open: [0.9, 2.1], jambs: [[3, 0.4, 2.59], [4, 0.55, 2.47]], lintel: [2, 0.53, 2.46], sill: 1.8 };

// How a stone sits in its cell: drawn in from its joints, broken at its corners, risen from the mortar and crowned.
const GAP_IN: P2 = [0.006, 0.022];
const CHIP: P2 = [0.012, 0.05];
const BREAK: P2 = [0.05, 0.09];
const MORTAR_DEPTH = 0.04;
const RISE: P2 = [0.02, 0.04];
const BEVEL: P2 = [0.014, 0.03];
const CROWN: P2 = [0.016, 0.034];

/** Flagstones, the top of a foundation or a ceiling: u along x and v along z, joints along all four edges. */
const FLAG_ROWS = [0, 0.75, 1.35, 2.2, 3.0] as const;
const FLAG_JOINTS = [[0.539, 1.154, 1.894], [0.872, 1.457, 2.193], [1.061, 1.934], [0.696, 1.636, 2.268]] as const;
const FLAG_GAP: P2 = [0.004, 0.012];
const FLAG_CHIP: P2 = [0.008, 0.03];
const FLAG_BEVEL: P2 = [0.008, 0.016];

const T = 0.1; // half a wall's thickness
const MD = MORTAR_DEPTH;
const CORE = T - MD;
/** A wall's top stands this far below its box, and its core reaches as far below, so a wall stood on another closes the joint. */
const GAP = 0.004;
/** How far a stone's face stands from the mortar where a level draws it flat. */
const FACE = 0.034;
/** A walling stone's corner is broken off its face where the break's lesser side is this long: one in five of them, every hard break among them. The rest are the painting's. */
const FACET = 0.034;
/** What a cut leaves of a stone on the stairs is laid where it covers this much of the mortar, in square metres. */
const LEAST = 0.02;
/** A flag's corner is broken where its break's lesser side is this long. */
const FLAG_NOTCH = 0.02;

interface Cell {
  course: number;
  name: string;
  /** Top left, top right, bottom right, bottom left. A stone that wraps runs past u = 3. */
  quad: P2[];
  band?: string;
}
interface Stone extends Cell {
  /** The quad it is drawn into, the breaks at its corners, and the quad broken by them: eight points. */
  footprint: P2[];
  chips: P2[];
  outline: P2[];
}
/** How a stone's face stands: its rise at each corner, its bevel on each edge, its crown and where the crown is. */
interface Look {
  rise: readonly number[];
  bevel: readonly number[];
  crown: number;
  at: P2;
}

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** The scripts' stream for a name: Python's generator seeded with the name's CRC-32. */
function rng(...key: (string | number)[]): PyRandom {
  let c = 0xffffffff;
  for (const ch of key.join("/")) c = CRC[(c ^ ch.charCodeAt(0)) & 255]! ^ (c >>> 8);
  return new PyRandom((c ^ 0xffffffff) >>> 0);
}

const top = (j: Head): number => (typeof j === "number" ? j : j[0]);
const bottom = (j: Head): number => (typeof j === "number" ? j : j[1]);
const cell = (u0: number, u1: number, v0: number, v1: number): P2[] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
const span = (values: readonly number[]): [number, number] => [Math.min(...values), Math.max(...values)];
const box2 = (poly: readonly P2[]): [number, number, number, number] => [...span(poly.map((p) => p[0])), ...span(poly.map((p) => p[1]))];

/** The part of a quad between two heights. */
function between(quad: readonly P2[], va: number, vb: number): P2[] {
  const [[ua, v0], [ub], [ud, v1], [uc]] = quad as [P2, P2, P2, P2];
  const at = (t: number, b: number, v: number): number => t + ((b - t) * (v - v0)) / (v1 - v0);
  return [[at(ua, uc, va), va], [at(ub, ud, va), va], [at(ub, ud, vb), vb], [at(ua, uc, vb), vb]];
}

/** The stones of one span of wall face. */
function masonry(): Cell[] {
  let stones: Cell[] = [];
  HEADS.forEach((heads, k) => {
    const [v0, v1] = [BEDS[k]!, BEDS[k + 1]!];
    const n = heads.length;
    for (let i = 0; i < n; i++) {
      const [a, b] = [heads[i]!, heads[(i + 1) % n]!];
      const shift = i === n - 1 ? TILE : 0;
      const quad: P2[] = [[top(a), v0], [top(b) + shift, v0], [bottom(b) + shift, v1], [bottom(a), v1]];
      const name = `k${k}s${i}`;
      if (k === SPLIT.course && Math.abs(top(a) - SPLIT.from) < 1e-9 && Math.abs(top(b) - SPLIT.to) < 1e-9) {
        for (const [band, va, vb, inner] of [["u", v0, SPLIT.bed, SPLIT.upper], ["l", SPLIT.bed, v1, SPLIT.lower]] as const) {
          const edges = [SPLIT.from, ...inner, SPLIT.to];
          for (let j = 0; j + 1 < edges.length; j++) stones.push({ course: k, band, name: `${name}${band}${j}`, quad: cell(edges[j]!, edges[j + 1]!, va, vb) });
        }
        continue;
      }
      const stack = STACKED.find((s) => s[0] === k && Math.abs(s[1] - top(a)) < 1e-9);
      if (stack) stones.push({ course: k, name: name + "a", quad: between(quad, v0, stack[2]) }, { course: k, name: name + "b", quad: between(quad, stack[2], v1) });
      else stones.push({ course: k, name, quad });
    }
  });
  for (const [k, start] of JUMPERS) {
    const jumper = stones.find((s) => s.course === k && Math.abs(s.quad[0]![0] - start) < 1e-9)!;
    const [tl, tr, br, bl] = jumper.quad as [P2, P2, P2, P2];
    const v2 = BEDS[k + 2]!;
    const side = (t: P2, b: P2, v: number): number => t[0] + ((b[0] - t[0]) * (v - t[1])) / (b[1] - t[1]);
    const left = (v: number): number => side(tl, bl, v);
    const right = (v: number): number => side(tr, br, v);
    jumper.quad = [tl, tr, [right(v2), v2], [left(v2), v2]];
    jumper.name += "j";
    const kept: Cell[] = [];
    for (const s of stones) {
      const q = s.quad as [P2, P2, P2, P2];
      if (s.course !== k + 1) {
        kept.push(s);
        continue;
      }
      const [x0, x1] = span(q.map((p) => p[0]));
      const [a, b] = [left(q[0][1]), right(q[0][1])];
      if (x1 <= a + 1e-6 || x0 >= b - 1e-6) kept.push(s);
      else if (x0 < a) kept.push({ ...s, quad: [q[0], [left(q[1][1]), q[1][1]], [left(q[2][1]), q[2][1]], q[3]] });
      else if (x1 > b) kept.push({ ...s, quad: [[right(q[0][1]), q[0][1]], q[1], q[2], [right(q[3][1]), q[3][1]]] });
    }
    stones = kept;
  }
  return stones;
}

/** The flagstones of one floor. */
function flags(): Cell[] {
  const out: Cell[] = [];
  for (let r = 0; r + 1 < FLAG_ROWS.length; r++) {
    const edges = [0, ...FLAG_JOINTS[r]!, TILE];
    for (let i = 0; i + 1 < edges.length; i++) out.push({ course: r, name: `r${r}f${i}`, quad: cell(edges[i]!, edges[i + 1]!, FLAG_ROWS[r]!, FLAG_ROWS[r + 1]!) });
  }
  return out;
}

function along2(a: P2, b: P2, d: number): P2 {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [a[0] + ((b[0] - a[0]) * d) / l, a[1] + ((b[1] - a[1]) * d) / l];
}

/** A quad with each corner cut off by (along the top or bottom edge, along the side): eight points, top edge first. */
function broken(quad: readonly P2[], chips: readonly P2[]): P2[] {
  const [tl, tr, br, bl] = quad as [P2, P2, P2, P2];
  const [[a0, b0], [a1, b1], [a2, b2], [a3, b3]] = chips as [P2, P2, P2, P2];
  return [along2(tl, tr, a0), along2(tr, tl, a1), along2(tr, br, b1), along2(br, tr, b2), along2(br, bl, a2), along2(bl, br, a3), along2(bl, tl, b3), along2(tl, bl, b0)];
}

/** A stone of a pattern given its own shape. */
function shaped(stone: Cell, gap: P2 = GAP_IN, chip: P2 = CHIP, hard: P2 = BREAK, brokenShare = 0.3): Stone {
  const r = rng("shape", stone.name);
  const pair = (of: P2): P2 => [r.uniform(of[0], of[1]), r.uniform(of[0], of[1])];
  const gaps = [0, 1, 2, 3].map(() => pair(gap));
  let chips = [0, 1, 2, 3].map(() => pair(chip));
  if (r.random() < brokenShare) chips[r.randrange(4)] = pair(hard);
  const [tl, tr, br, bl] = stone.quad as [P2, P2, P2, P2];
  // Each corner moved in from its joints.
  const foot: P2[] = [[tl[0] + gaps[0]![0], tl[1] + gaps[0]![1]], [tr[0] - gaps[1]![0], tr[1] + gaps[1]![1]], [br[0] - gaps[2]![0], br[1] - gaps[2]![1]], [bl[0] + gaps[3]![0], bl[1] - gaps[3]![1]]];
  // No break may reach past half of its edge.
  const width = Math.min(foot[1]![0] - foot[0]![0], foot[2]![0] - foot[3]![0]);
  const height = Math.min(foot[3]![1] - foot[0]![1], foot[2]![1] - foot[1]![1]);
  chips = chips.map(([a, b]) => [Math.min(a, width * 0.35), Math.min(b, height * 0.35)] as const);
  return { ...stone, footprint: foot, chips, outline: broken(foot, chips) };
}

/** How a walling stone's face stands. */
function lookOf(stone: Cell): Look {
  const r = rng("face", stone.name);
  const rise = r.uniform(RISE[0], RISE[1]);
  const corners = [0, 1, 2, 3].map(() => rise - r.uniform(0, 0.01));
  const bevel = [0, 1, 2, 3].map(() => r.uniform(BEVEL[0], BEVEL[1]));
  const crown = r.uniform(CROWN[0], CROWN[1]);
  return { rise: corners, bevel, crown, at: [r.uniform(0.32, 0.68), r.uniform(0.3, 0.62)] };
}

let laid: { stone: Stone; look: Look }[] | null = null;
/** Every walling stone of a face with its shape and its look. */
const walling = (): { stone: Stone; look: Look }[] => (laid ??= masonry().map((s) => ({ stone: shaped(s), look: lookOf(s) })));
const flagStones = (): Stone[] => flags().map((s) => shaped(s, FLAG_GAP, FLAG_CHIP, [0.03, 0.05], 0.2));

/** A polygon with each edge moved inward by its inset. It goes round anticlockwise as its numbers are plotted. */
function inset(poly: readonly P2[], insets: readonly number[]): P2[] {
  const n = poly.length;
  const lines = poly.map(([x0, y0], i) => {
    const [x1, y1] = poly[(i + 1) % n]!;
    const l = Math.hypot(x1 - x0, y1 - y0);
    const [dx, dy] = [(x1 - x0) / l, (y1 - y0) / l];
    return [x0 - dy * insets[i]!, y0 + dx * insets[i]!, dx, dy] as const;
  });
  return lines.map((q, i) => {
    const p = lines[(i + n - 1) % n]!;
    const den = p[2] * q[3] - p[3] * q[2];
    if (Math.abs(den) < 1e-9) return [q[0], q[1]] as const;
    const a = ((q[0] - p[0]) * q[3] - (q[1] - p[1]) * q[2]) / den;
    return [p[0] + a * p[2], p[1] + a * p[3]] as const;
  });
}

/** A stone's face: its footprint moved in by its bevels, and broken at the corners a little less than the footprint is. */
function faceRing(foot: readonly P2[], chips: readonly P2[], bevels: readonly number[]): P2[] {
  const ring = inset(foot, bevels);
  const tw = Math.min(ring[1]![0] - ring[0]![0], ring[2]![0] - ring[3]![0]);
  const th = Math.min(ring[3]![1] - ring[0]![1], ring[2]![1] - ring[1]![1]);
  return broken(ring, chips.map(([a, b]) => [Math.min(a * 0.6, tw * 0.3), Math.min(b * 0.6, th * 0.3)] as const));
}

const area2 = (poly: readonly P2[]): number => 0.5 * poly.reduce((sum, p, i) => sum + p[0] * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * p[1], 0);
/** A convex profile moved in by `by` on every side, whichever way round it runs. */
const shrink = (profile: readonly P2[], by: number): P2[] => (area2(profile) < 0 ? inset([...profile].reverse(), profile.map(() => by)).reverse() : inset(profile, profile.map(() => by)));
/** A rectangle about (cx, cz) with its corners cut by `cut`, anticlockwise. */
const octagon = (cx: number, cz: number, hx: number, hz: number, cut: number): P2[] => [[cx - hx + cut, cz - hz], [cx + hx - cut, cz - hz], [cx + hx, cz - hz + cut], [cx + hx, cz + hz - cut], [cx + hx - cut, cz + hz], [cx - hx + cut, cz + hz], [cx - hx, cz + hz - cut], [cx - hx, cz - hz + cut]];

/** The part of a convex polygon where every `sides` entry (a, b, c) has a u + b v <= c. */
function clip2(poly: readonly P2[], sides: readonly (readonly [number, number, number])[]): P2[] {
  let out = [...poly];
  for (const [a, b, c] of sides) {
    const from = out;
    out = [];
    from.forEach((p, k) => {
      const q = from[(k + 1) % from.length]!;
      const [dp, dq] = [a * p[0] + b * p[1] - c, a * q[0] + b * q[1] - c];
      if (dp <= 1e-9) out.push(p);
      if ((dp < -1e-9 && dq > 1e-9) || (dp > 1e-9 && dq < -1e-9)) out.push([p[0] + ((q[0] - p[0]) * dp) / (dp - dq), p[1] + ((q[1] - p[1]) * dp) / (dp - dq)]);
    });
  }
  return out.length >= 3 && Math.abs(area2(out)) > 1e-7 ? out : [];
}
/** The sides of the box from (u0, v0) to (u1, v1), for clip2. */
const within2 = (u0: number, u1: number, v0: number, v1: number): (readonly [number, number, number])[] => [[-1, 0, -u0], [1, 0, u1], [0, -1, -v0], [0, 1, v1]];

function newell(pts: readonly Vec[]): Vec {
  const n = [0, 0, 0];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    n[0]! += (p[1] - q[1]) * (p[2] + q[2]);
    n[1]! += (p[2] - q[2]) * (p[0] + q[0]);
    n[2]! += (p[0] - q[0]) * (p[1] + q[1]);
  });
  // Divided as the scripts divide, so a face at 45 degrees takes the axis it took there.
  const l = Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]! + n[2]! * n[2]!) || 1;
  return [n[0]! / l, n[1]! / l, n[2]! / l];
}
const mean = (pts: readonly Vec[]): Vec => scale(pts.reduce((sum, p) => add(sum, p), [0, 0, 0] as Vec), 1 / pts.length);
const apart = (a: Vec, b: Vec): boolean => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) > 1e-9;
const angleAt = (at: Vec, a: Vec, b: Vec): number => Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(a, at)), unit(sub(b, at))))));

// Straight along a face's own axis: (u axis, v axis) for each outward direction, the picture the right way round from outside.
const AXES: readonly (readonly [readonly [Vec, Vec], readonly [Vec, Vec]])[] = [
  [[[0, 0, -1], [0, -1, 0]], [[0, 0, 1], [0, -1, 0]]],
  [[[1, 0, 0], [0, 0, 1]], [[1, 0, 0], [0, 0, -1]]],
  [[[1, 0, 0], [0, -1, 0]], [[-1, 0, 0], [0, -1, 0]]],
];
const AXIS: Readonly<Record<string, Vec>> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** A mapping along the face's nearest axis. `grain` is the axis a material's u follows where the face lies along it. */
function straight(n: Vec, grain?: string, shift: P2 = [0, 0]): UvMap {
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(n[i]!) > Math.abs(n[k]!)) k = i;
  let [ua, va] = AXES[k]![n[k]! > 0 ? 0 : 1]!;
  // Turned a quarter so that u runs with the grain, the picture still the right way round.
  if (grain && Math.abs(dot(AXIS[grain]!, va)) > 0.5) [ua, va] = [scale(va, -1), ua];
  return (p) => [dot(p, ua) / TILE + 0.5 + shift[0], dot(p, va) / TILE + 0.5 + shift[1]];
}

/** A face to lay stones on: `o` is where u = v = 0, u runs right as the face is seen, v down, and n is outward. */
class Frame {
  readonly o: Vec;
  readonly u: Vec;
  readonly v: Vec;
  readonly n: Vec;
  readonly shift: P2;

  constructor(o: Vec, u: Vec, v: Vec, n: Vec, shift: P2 = [0, 0]) {
    [this.o, this.u, this.v, this.n, this.shift] = [o, u, v, n, shift];
  }

  at(u: number, v: number, h = 0): Vec {
    return add(add(add(this.o, scale(this.u, u)), scale(this.v, v)), scale(this.n, h));
  }

  readonly uv: UvMap = (p) => {
    const d = sub(p, this.o);
    return [dot(d, this.u) / TILE + this.shift[0], dot(d, this.v) / TILE + this.shift[1]];
  };

  /** Where a point lies across the frame. */
  on(p: Vec): P2 {
    const d = sub(p, this.o);
    return [dot(d, this.u), dot(d, this.v)];
  }

  /** The same face stood `by` further out. */
  out(by: number): Frame {
    return new Frame(add(this.o, scale(this.n, by)), this.u, this.v, this.n, this.shift);
  }
}

/** A face of a solid before it is turned outward. `smooth` shades it with its smooth neighbours; `field` gives its normal at a point. */
interface Side {
  pts: Vec[];
  smooth?: boolean;
  field?: (p: Vec) => Vec;
  /** It looks outward as it is given. */
  turned?: boolean;
  /** The way it looks, where that is known exactly: a cut's own plane, so a cut at 45 degrees is mapped one way every time. */
  facing?: Vec;
}
type Plane = readonly [Vec, Vec];

/** The part of a convex solid on the side of the plane through p0 that n points away from, the cut closed with a face. */
function clipSolid(sides: readonly Side[], [p0, n]: Plane): Side[] {
  const out: Side[] = [];
  const on: Vec[] = [];
  for (const side of sides) {
    const kept: Vec[] = [];
    side.pts.forEach((a, i) => {
      const b = side.pts[(i + 1) % side.pts.length]!;
      const [da, db] = [dot(sub(a, p0), n), dot(sub(b, p0), n)];
      if (da <= 1e-12) {
        kept.push(a);
        if (Math.abs(da) <= 1e-12) on.push(a);
      }
      if ((da < -1e-12 && db > 1e-12) || (db < -1e-12 && da > 1e-12)) {
        const x = add(a, scale(sub(b, a), da / (da - db)));
        kept.push(x);
        on.push(x);
      }
    });
    if (kept.length >= 3) out.push({ ...side, pts: kept });
  }
  const cap: Vec[] = [];
  for (const p of on) if (cap.every((q) => apart(p, q))) cap.push(p);
  if (cap.length >= 3) {
    const mid = mean(cap);
    const e1 = unit(sub(cap[0]!, mid));
    const e2 = cross(n, e1);
    const turn = (p: Vec): number => Math.atan2(dot(sub(p, mid), e2), dot(sub(p, mid), e1));
    out.push({ pts: cap.sort((a, b) => turn(a) - turn(b)), facing: n });
  }
  return out;
}

/** Heights over a quad, between the rise at each of its corners, by where a point lies across and down its box. */
function ringHeights(quad: readonly P2[], rises: readonly number[]): (u: number, v: number) => number {
  const [u0, u1, v0, v1] = box2(quad);
  return (u, v) => {
    const s = Math.min(Math.max((u - u0) / (u1 - u0), 0), 1);
    const t = Math.min(Math.max((v - v0) / (v1 - v0), 0), 1);
    const [above, below] = [rises[0]! + (rises[1]! - rises[0]!) * s, rises[3]! + (rises[2]! - rises[3]!) * s];
    return above + (below - above) * t;
  };
}

/**
 * The normal of a stone's crown at a point of its face: the scripts drew a crown as a fan of four faces up to an apex off
 * the stone's middle and shaded them as one surface. This is that shading, for a face drawn flat.
 */
function crownField(frame: Frame, foot: readonly P2[], look: Look): (u: number, v: number) => Vec {
  const h = ringHeights(foot, look.rise);
  const [u0, u1, v0, v1] = box2(foot);
  const ring = inset(foot, look.bevel);
  const [cu, cv] = [u0 + (u1 - u0) * look.at[0], v0 + (v1 - v0) * look.at[1]];
  const apex = frame.at(cu, cv, h(cu, cv) + look.crown);
  const at = ring.map(([u, v]) => frame.at(u, v, h(u, v)));
  const fan = at.map((p, i) => {
    const n = unit(cross(sub(at[(i + 1) % 4]!, p), sub(apex, p)));
    return dot(n, frame.n) < 0 ? scale(n, -1) : n;
  });
  // At each corner of the face, the two fan faces that meet there, each by the angle it has at the corner.
  const corner = at.map((p, i) => unit(add(scale(fan[(i + 3) % 4]!, angleAt(p, at[(i + 3) % 4]!, apex)), scale(fan[i]!, angleAt(p, at[(i + 1) % 4]!, apex)))));
  const [a0, a1, b0, b1] = box2(ring);
  return (u, v) => {
    const s = Math.min(Math.max((u - a0) / (a1 - a0), 0), 1);
    const t = Math.min(Math.max((v - b0) / (b1 - b0), 0), 1);
    const [above, below] = [add(scale(corner[0]!, 1 - s), scale(corner[1]!, s)), add(scale(corner[3]!, 1 - s), scale(corner[2]!, s))];
    return unit(add(scale(above, 1 - t), scale(below, t)));
  };
}

/**
 * The normal of a stone as it stands, at a point of its cell: its crown on its face, its bevel between its face and its
 * footprint, the wall's own on the mortar round it.
 */
function stoneNormal(frame: Frame, foot: readonly P2[], look: Look): (u: number, v: number) => Vec {
  const h = ringHeights(foot, look.rise);
  const ring = inset(foot, look.bevel);
  const crown = look.crown > 0 ? crownField(frame, foot, look) : (): Vec => frame.n;
  const P = foot.map(([u, v]) => frame.at(u, v));
  const F = ring.map(([u, v]) => frame.at(u, v, h(u, v)));
  const bevel = P.map((p, i) => {
    const n = newell([p, P[(i + 1) % 4]!, F[(i + 1) % 4]!, F[i]!]);
    return dot(n, frame.n) < 0 ? scale(n, -1) : n;
  });
  // How far a point lies outside side i of a quad that goes round anticlockwise as its numbers are plotted.
  const beyond = (quad: readonly P2[], i: number, u: number, v: number): number => {
    const [a, c] = [quad[i]!, quad[(i + 1) % 4]!];
    return -((c[0] - a[0]) * (v - a[1]) - (c[1] - a[1]) * (u - a[0])) / Math.hypot(c[0] - a[0], c[1] - a[1]);
  };
  return (u, v) => {
    const out = ring.map((_, i) => beyond(ring, i, u, v));
    const most = out.indexOf(Math.max(...out));
    if (out[most]! <= 0) return crown(u, v);
    return foot.every((_, i) => beyond(foot, i, u, v) <= 0) ? bevel[most]! : frame.n;
  };
}

/**
 * A stone's normals for a cell drawn flat: one at each corner of the cell, blended across it, the nearest such blend to
 * the stone as it stands. Its bevels are then in the shading of its edges, as they are in the light it gives back from afar.
 */
function seenFlat(quad: readonly P2[], normalAt: (u: number, v: number) => Vec): (u: number, v: number) => Vec {
  const [u0, u1, v0, v1] = box2(quad);
  const N = 16;
  const sum: Vec[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const [a, c] = [(i + 0.5) / N, (j + 0.5) / N];
    const n = normalAt(u0 + a * (u1 - u0), v0 + c * (v1 - v0));
    [(1 - a) * (1 - c), a * (1 - c), a * c, (1 - a) * c].forEach((w, k) => (sum[k] = add(sum[k]!, scale(n, w / (N * N)))));
  }
  // The least-squares blend: these are the rows of the inverse of the blend's own weights against each other.
  const corner = [0, 1, 2, 3].map((k) => add(add(scale(sum[k]!, 16), scale(add(sum[(k + 1) % 4]!, sum[(k + 3) % 4]!), -8)), scale(sum[(k + 2) % 4]!, 4)));
  return (u, v) => {
    const a = Math.min(Math.max((u - u0) / (u1 - u0), 0), 1);
    const c = Math.min(Math.max((v - v0) / (v1 - v0), 0), 1);
    const [above, below] = [add(scale(corner[0]!, 1 - a), scale(corner[1]!, a)), add(scale(corner[3]!, 1 - a), scale(corner[2]!, a))];
    return unit(add(scale(above, 1 - c), scale(below, c)));
  };
}

/**
 * The faces of a stone laid on a frame: its footprint on the mortar, bevelled up to a face that stands `look.rise` out.
 * The face is flat and shaded as its crown where it has one, or with `risen` rises to the crown's apex as the scripts
 * drew it. `base` and `face` are the breaks at the corners of each, none for a corner left whole. `shift` moves it along u.
 */
function stoneSides(frame: Frame, foot: readonly P2[], base: readonly P2[], face: readonly P2[], look: Look, shift = 0, risen = false): Side[] {
  const h = ringHeights(foot, look.rise);
  const P = broken(foot, base).map(([u, v]) => frame.at(u + shift, v));
  const F = faceRing(foot, face, look.bevel).map(([u, v]) => frame.at(u + shift, v, h(u, v)));
  const n = P.length;
  const sides: Side[] = [{ pts: P }, ...P.map((p, i) => ({ pts: [p, P[(i + 1) % n]!, F[(i + 1) % n]!, F[i]!] }))];
  if (look.crown > 0) {
    const field = crownField(frame, foot, look);
    const shaded = (p: Vec): Vec => field(frame.on(p)[0] - shift, frame.on(p)[1]);
    if (risen) {
      const [u0, u1, v0, v1] = box2(foot);
      const [cu, cv] = [u0 + (u1 - u0) * look.at[0], v0 + (v1 - v0) * look.at[1]];
      const apex = frame.at(cu + shift, cv, h(cu, cv) + look.crown);
      sides.push(...F.map((p, i) => ({ pts: [p, F[(i + 1) % n]!, apex], field: shaded })));
    } else sides.push({ pts: F, field: shaded });
  } else sides.push({ pts: F });
  // A corner left whole has its two points in one place.
  return sides.map((s) => ({ ...s, pts: tidy(s.pts) })).filter((s) => s.pts.length >= 3);
}

/**
 * Gives a stone cut at the span's edge its crown again along the cut, as the scripts drew it there: two corners on the
 * cut's upper edge, where it crosses the crown's two ridges, as high as the crown stood. The stones at a wall's end are
 * its outline at a corner, and the cut is what a free end shows.
 */
function crownedCut(sides: Side[], frame: Frame, foot: readonly P2[], look: Look, shift: number, [p0, n]: Plane): Side[] {
  const face = sides.findIndex((s) => s.field);
  const cap = sides.length - 1;
  if (face < 0 || cap === face) return sides;
  const pts = sides[face]!.pts;
  const onCut = (p: Vec): boolean => Math.abs(dot(sub(p, p0), n)) < 1e-9;
  const first = pts.findIndex((p, i) => onCut(p) && onCut(pts[(i + 1) % pts.length]!));
  if (first < 0) return sides;
  // Round the face from the cut's first corner: a, then c, then the corners clear of the cut.
  const [a, c, ...clear] = pts.map((_, i) => pts[(first + i) % pts.length]!) as [Vec, Vec, ...Vec[]];
  const h = ringHeights(foot, look.rise);
  const [u0, u1, v0, v1] = box2(foot);
  const [cu, cv] = [u0 + (u1 - u0) * look.at[0], v0 + (v1 - v0) * look.at[1]];
  const top = h(cu, cv) + look.crown;
  const u = frame.on(a)[0] - shift;
  // The crown's ridges run from its apex to the face's corners: the two on the cut's side of the apex are crossed.
  const ring = inset(foot, look.bevel);
  const crossed = (u > cu ? [1, 2] : [0, 3]).map((k) => {
    const [ru, rv] = ring[k]!;
    const t = Math.min(Math.max((u - cu) / (ru - cu), 0), 1);
    return { v: cv + t * (rv - cv), at: frame.at(u + shift, cv + t * (rv - cv), top + t * (h(ru, rv) - top)) };
  });
  // In the order they come from a to c, and only where they fall between the two.
  const [va, vc] = [frame.on(a)[1], frame.on(c)[1]];
  const ridge = crossed.filter((r) => (r.v - va) * (r.v - vc) < -1e-6).sort((x, y) => (x.v - y.v) * Math.sign(vc - va)).map((r) => r.at);
  if (ridge.length < 2 || clear.length < 1) return sides;
  const [m1, m2] = [ridge[0]!, ridge[1]!];
  const piece = (of: Vec[]): Side => ({ ...sides[face]!, pts: of });
  const fan = [piece([m1, clear[clear.length - 1]!, a]), piece([m2, c, clear[0]!]), piece([m1, m2, clear[0]!]), ...clear.slice(1).map((q, i) => piece([m1, clear[i]!, q]))];
  const cut = sides[cap]!.pts;
  const at = cut.findIndex((p, i) => [a, c].some((q) => !apart(p, q)) && [a, c].some((q) => !apart(cut[(i + 1) % cut.length]!, q)));
  if (at < 0) return sides;
  const between = !apart(cut[at]!, a) ? [m1, m2] : [m2, m1];
  return [...sides.slice(0, face), ...sides.slice(face + 1, cap), ...fan, { pts: [...cut.slice(0, at + 1), ...between, ...cut.slice(at + 1)] }];
}

/** A face's corners without those that repeat the one before. */
function tidy(pts: readonly Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of pts) if (out.length === 0 || apart(p, out[out.length - 1]!)) out.push(p);
  while (out.length > 1 && !apart(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
}

/**
 * The faces of a block through a wall from one face to the other: a jamb stone or a lintel. Its outline on each face is
 * in the piece's (x, y), corner for corner, where it stands on the mortar; on each it is bevelled in and risen.
 */
function block(front: readonly P2[], back: readonly P2[], bevel: number, riseFront: readonly number[], riseBack: readonly number[], core = CORE): Side[] {
  const n = front.length;
  const bev = front.map(() => bevel);
  const Pf = front.map(([x, y]): Vec => [x, y, core]);
  const Tf = inset(front, bev).map(([x, y], i): Vec => [x, y, core + riseFront[i]!]);
  const Pb = back.map(([x, y]): Vec => [x, y, -core]);
  const Tb = inset(back, bev).map(([x, y], i): Vec => [x, y, -core - riseBack[i]!]);
  // A six-cornered face is cut as the scripts' was, and lit as one face: its two middle corners stand in line with their neighbours.
  const faced = (F: Vec[], out: number): Side[] => {
    if (n !== 6) return [{ pts: F }];
    const round = newell(F)[2] * out > 0 ? F : [...F].reverse();
    const whole = newell(round);
    return [[0, 1, 2], [3, 4, 5], [5, 0, 2], [2, 3, 5]].map((of) => ({ pts: of.map((k) => round[k]!), field: () => whole, turned: true }));
  };
  const sides: Side[] = [...faced(Tf, 1), ...faced(Tb, -1)];
  for (const [P, F] of [[Pf, Tf], [Pb, Tb]] as const) P.forEach((p, i) => sides.push({ pts: [p, P[(i + 1) % n]!, F[(i + 1) % n]!, F[i]!] }));
  Pf.forEach((p, i) => sides.push({ pts: [p, Pf[(i + 1) % n]!, Pb[(i + 1) % n]!, Pb[i]!] }));
  return sides;
}

/** A point of a profile across `axis` at `t` along it: for x a profile is (z, y), for y (x, z), for z (x, y). */
const put = (axis: string, a: number, b: number, t: number): Vec => (axis === "x" ? [t, b, a] : axis === "y" ? [a, t, b] : [a, b, t]);

/** The faces of a solid swept along an axis through cross-sections, each a place along it and a profile, its ends closed. */
function loft(axis: string, stations: readonly (readonly [number, readonly P2[]])[]): Side[] {
  const rings = stations.map(([t, profile]) => profile.map(([a, b]) => put(axis, a, b, t)));
  const n = rings[0]!.length;
  const sides: Side[] = [{ pts: rings[0]! }, { pts: rings[rings.length - 1]! }];
  for (let r = 0; r + 1 < rings.length; r++) for (let i = 0; i < n; i++) sides.push({ pts: [rings[r]![i]!, rings[r]![(i + 1) % n]!, rings[r + 1]![(i + 1) % n]!, rings[r + 1]![i]!] });
  return sides;
}

/** One level of one piece as it is gathered, in the game's frame. */
class Build {
  readonly shape = new Carved();
  /** Where the piece yields, for `spans`: an axis of the kit's frame and a place on it. */
  rings: [number, number][] = [];
  /** Moves every corner as it is taken: a door swung open. */
  turn: ((p: Vec) => Vec) | null = null;
  /** Texture coordinates run on past the picture's edge, which repeats: a piece wider than a span, or laid at another scale. */
  free = false;

  /** A face already looking outward. Texture coordinates are held inside the picture, as the scripts held them. */
  face(pts: readonly Vec[], mat: string, uv: UvMap, normals?: readonly Vec[], along?: number): void {
    const keep: number[] = [];
    pts.forEach((p, i) => {
      if (keep.length === 0 || apart(p, pts[keep[keep.length - 1]!]!)) keep.push(i);
    });
    while (keep.length > 1 && !apart(pts[keep[0]!]!, pts[keep[keep.length - 1]!]!)) keep.pop();
    if (keep.length < 3) return;
    // A cut through a piece's own middle leaves a coordinate a rounding off nought, which is nought.
    const nought = (c: number): number => (this.free && Math.abs(c) < 1e-12 ? 0 : c);
    const kit = (p: Vec): Vec => [nought(p[0]), nought(-p[2]), nought(p[1])];
    const held = (c: number): number => (this.free ? c : Math.min(Math.max(c, 0), 1));
    const moved = (p: Vec): Vec => (this.turn ? this.turn(p) : p);
    this.shape.face({
      points: keep.map((i) => kit(moved(pts[i]!))),
      uvs: keep.map((i) => {
        const [u, v] = uv(pts[i]!);
        return [held(u), 1 - held(v)] as const;
      }),
      mat,
      ...(normals ? { normals: keep.map((i) => kit(normals[i]!)) } : {}),
      ...(along === undefined ? {} : { along }),
    });
  }

  /** The axis a solid of these corners runs along where it crosses a yield ring, pulled back whole and not cut. */
  spans(pts: readonly Vec[]): number | undefined {
    for (const [axis, at] of this.rings) {
      const side = pts.map((p) => [p[0], -p[2], p[1]][axis]! - at);
      if (side.some((d) => d > 1e-6) && side.some((d) => d < -1e-6)) return axis;
    }
    return undefined;
  }

  /**
   * A convex solid from its faces, each turned to look away from the solid's middle. `uvOf` gives each face's mapping by
   * its normal. With `whole`, a solid that crosses a yield ring is not cut there.
   */
  convex(sides: readonly Side[], mat: string | ((n: Vec) => string), uvOf: (n: Vec) => UvMap, whole = false): void {
    const all = sides.flatMap((s) => s.pts);
    const mid = mean(all);
    const along = whole ? this.spans(all) : undefined;
    const turned = sides.map((s) => {
      // A face given turned is part of a larger one, and is mapped as that is.
      if (s.turned) return { ...s, n: s.field ? s.field(s.pts[0]!) : newell(s.pts) };
      if (s.facing) return dot(newell(s.pts), s.facing) < 0 ? { ...s, pts: [...s.pts].reverse(), n: s.facing } : { ...s, n: s.facing };
      const n = newell(s.pts);
      return dot(n, sub(mean(s.pts), mid)) < 0 ? { ...s, pts: [...s.pts].reverse(), n: scale(n, -1) } : { ...s, n };
    });
    // A smooth face's normal at a corner is that of the smooth faces round it, each by the angle it has there.
    const sums = new Map<string, Vec>();
    const key = (p: Vec): string => p.map((c) => c.toFixed(7)).join();
    for (const s of turned) {
      if (!s.smooth) continue;
      s.pts.forEach((p, i) => sums.set(key(p), add(sums.get(key(p)) ?? [0, 0, 0], scale(s.n, angleAt(p, s.pts[(i + s.pts.length - 1) % s.pts.length]!, s.pts[(i + 1) % s.pts.length]!)))));
    }
    for (const s of turned) {
      const normals = s.field ? s.pts.map(s.field) : s.smooth ? s.pts.map((p) => unit(sums.get(key(p))!)) : undefined;
      this.face(s.pts, typeof mat === "string" ? mat : mat(s.n), uvOf(s.n), normals, along);
    }
  }

  box(lo: Vec, hi: Vec, mat: string | ((n: Vec) => string), grain?: string, shift: P2 = [0, 0], whole = false): void {
    const c: Vec[] = [];
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) c.push([x, y, z]);
    const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    this.convex(quads.map((q) => ({ pts: q.map((i) => c[i]!) })), mat, (n) => straight(n, grain, shift), whole);
  }

  /** A convex profile run from a0 to a1 along `axis`. */
  prism(profile: readonly P2[], axis: string, a0: number, a1: number, mat: string | ((n: Vec) => string), grain?: string, shift: P2 = [0, 0], whole = false): void {
    this.convex(loft(axis, [[a0, profile], [a1, profile]]), mat, (n) => straight(n, grain, shift), whole);
  }

  /** A flat face of one colour or picture, turned to look along `out`. */
  flat(pts: readonly Vec[], out: Vec, mat: string, uv: UvMap = straight(out), normals?: readonly Vec[], along?: number): void {
    const back = dot(newell(pts), out) < 0;
    this.face(back ? [...pts].reverse() : pts, mat, uv, normals && back ? [...normals].reverse() : normals, along);
  }
}

const FRONT = new Frame([-H, H, CORE], [1, 0, 0], [0, -1, 0], [0, 0, 1]);
const BACK = new Frame([H, H, -CORE], [-1, 0, 0], [0, -1, 0], [0, 0, -1]);

/** A mapping for the faces of a part laid on a frame: through the frame where they face out with it, else along their own axis. */
const on = (frame: Frame) => (n: Vec): UvMap => (dot(n, frame.n) > 0.3 ? frame.uv : straight(n));
const throughUv = (grain?: string) => (n: Vec): UvMap => (n[2] > 0.3 ? FRONT.uv : n[2] < -0.3 ? BACK.uv : straight(n, grain));
/** The half-spaces where a frame's u is no more than `u`, no less, and where its v is no less than `v`. */
const keepBelow = (frame: Frame, u: number): Plane => [frame.at(u, 0), frame.u];
const keepAbove = (frame: Frame, u: number): Plane => [frame.at(u, 0), scale(frame.u, -1)];
const keepLower = (frame: Frame, v: number): Plane => [frame.at(0, v), scale(frame.v, -1)];

let atlas: [number, number, number, number][] | null = null;
/** The walling stones that lie wholly inside the masonry picture, each as its footprint's box. */
const pictured = (): [number, number, number, number][] => (atlas ??= walling().map(({ stone }) => box2(stone.outline)).filter(([u0, u1]) => u0 > 0.02 && u1 < TILE - 0.02));

/**
 * A mapping that lays one walling stone of the masonry picture over a block's face, so a block that is not part of a
 * wall's pattern still wears a whole stone of it. `box` is the face's extent along the two axes from `origin`.
 */
function ontoStone(origin: Vec, ua: Vec, va: Vec, box: readonly [number, number, number, number], key: readonly (string | number)[]): UvMap {
  const [a0, a1, b0, b1] = box;
  const [w, h] = [a1 - a0, b1 - b0];
  const unlike = (t: readonly number[]): number => Math.abs(Math.log((t[1]! - t[0]!) / (t[3]! - t[2]!) / (w / h))) + 0.6 * Math.abs(Math.log((t[1]! - t[0]!) / w)) + 0.6 * Math.abs(Math.log((t[3]! - t[2]!) / h));
  const near = pictured().map((t) => [unlike(t), t] as const).sort((x, y) => x[0] - y[0]);
  const t = near[rng("atlas", ...key).randrange(Math.min(3, near.length))]![1];
  return (p) => {
    const d = sub(p, origin);
    return [(t[0] + ((dot(d, ua) - a0) / w) * (t[1] - t[0])) / TILE, (t[2] + ((dot(d, va) - b0) / h) * (t[3] - t[2])) / TILE];
  };
}

type Faced = readonly (readonly [n: Vec, ua: Vec, va: Vec, box: readonly [number, number, number, number]])[];
/** A mapping for a block with a stone of the masonry picture on each of its faces that look along one of `faces`. */
function stoneFaced(origin: Vec, faces: Faced, key: readonly (string | number)[]): (normal: Vec) => UvMap {
  const maps = faces.map(([n, ua, va, box]) => [n, ontoStone(origin, ua, va, box, [...key, `(${n.join(", ")})`])] as const);
  return (normal) => maps.find(([n]) => dot(normal, n) > 0.7)?.[1] ?? straight(normal);
}

/** No corner broken. */
const WHOLE: readonly P2[] = [[0, 0], [0, 0], [0, 0], [0, 0]];

/** The breaks a level draws at a stone's corners: those of its footprint on the mortar, and those of its face. */
function breaksOf(s: Stone, notch: number, facet: number): [P2[], P2[]] {
  const none: P2 = [0, 0];
  const size = s.chips.map(([a, b]) => Math.min(a, b));
  return [s.chips.map((c, i) => (size[i]! >= notch ? c : none)), s.chips.map((c, i) => (size[i]! >= facet ? c : none))];
}

interface Laying {
  keep?: readonly Plane[];
  uvOf?: (n: Vec) => UvMap;
  /** The least a corner's break is to be cut down to the mortar, and to be cut off the face. */
  notch?: number;
  facet?: number;
  /** A stone that crosses a yield ring is pulled back whole: its picture squeezes inside one stone, which has no joint to show it. */
  whole?: boolean;
  /** What is left of a stone cut by `keep` is laid only if it covers this many square metres of the mortar. */
  least?: number;
  /** `least` is asked only of a stone the cut took something from. */
  cutOnly?: boolean;
  /** The wall's outline keeps its crowns as geometry: the stones cut at the span's edge along the cut, and the top course whole. */
  outline?: boolean;
  /** The top course alone keeps its crowns as geometry. */
  risen?: boolean;
  /** The pattern runs on past this span's right edge in the same piece, or came in over its left: a stone that wraps is laid whole, once. */
  runsOut?: boolean;
  runsIn?: boolean;
}

/** A shaped stone on a frame, in both halves where it runs past the span's edge, cut to the half-spaces in `keep`. */
function lay(b: Build, frame: Frame, s: Stone, look: Look, mat: string, o: Laying = {}): void {
  const wraps = Math.max(...s.footprint.map((p) => p[0])) > TILE + 1e-9;
  const [base, face] = breaksOf(s, o.notch ?? Infinity, o.facet ?? Infinity);
  for (const shift of wraps ? [0, -TILE] : [0]) {
    if (shift !== 0 && o.runsIn) continue;
    const cut = wraps && !(shift === 0 && o.runsOut);
    const risen = (o.outline === true || o.risen === true) && s.course === 0;
    let sides = stoneSides(frame, s.footprint, base, face, look, shift, risen);
    const planes = [...(o.keep ?? [])];
    if (cut) planes.push(shift === 0 ? keepBelow(frame, TILE) : keepAbove(frame, 0));
    for (const plane of planes) sides = clipSolid(sides, plane);
    if (cut && o.outline && !risen) sides = crownedCut(sides, frame, s.footprint, look, shift, planes[planes.length - 1]!);
    // The footprint is the first face, and stays so through every cut.
    if (o.least !== undefined && sides.length >= 4 && Math.abs(area2(sides[0]!.pts.map((p) => frame.on(p)))) < Math.min(o.least, o.cutOnly ? Math.abs(area2(s.footprint)) - 1e-6 : Infinity)) continue;
    if (sides.length >= 4) b.convex(sides, mat, o.uvOf ?? on(frame), o.whole);
  }
}

/** One cell of a face drawn flat: its outline on the frame, what it is drawn with, and its normal at a point where it is shaded round. */
interface Tile {
  poly: readonly P2[];
  mat: string;
  uv?: UvMap;
  field?: (u: number, v: number) => Vec;
}

/**
 * Cells laid flat on a frame, each cut to every one of `regions` (convex, as sides for clip2). The cells tile the face
 * apart: the solid they belong to is closed by welding it.
 */
function tiles(b: Build, frame: Frame, cells: readonly Tile[], regions: readonly (readonly (readonly [number, number, number])[])[]): void {
  for (const c of cells) {
    for (const region of regions) {
      const poly = clip2(c.poly, region);
      if (poly.length < 3) continue;
      const pts = poly.map(([u, v]) => frame.at(u, v));
      b.flat(pts, frame.n, c.mat, c.uv ?? frame.uv, c.field && poly.map(([u, v]) => c.field!(u, v)), b.spans(pts));
    }
  }
}

/** A face's walling stones as cells, each whole to the middle of its joints and shaded as the stone it is. A stone that wraps is in both halves. */
function wallTiles(frame: Frame, keep: (s: Stone) => boolean = () => true): Tile[] {
  const out: Tile[] = [];
  for (const { stone, look } of walling()) {
    if (!keep(stone)) continue;
    const field = seenFlat(stone.quad, stoneNormal(frame, stone.footprint, look));
    const wraps = Math.max(...stone.quad.map((p) => p[0])) > TILE + 1e-9;
    for (const shift of wraps ? [0, -TILE] : [0]) out.push({ poly: stone.quad.map(([u, v]) => [u + shift, v] as const), mat: "masonry", field: (u, v) => field(u - shift, v) });
  }
  return out;
}

// Walls

interface Opening {
  kind: "door" | "window";
  spec: Cut;
  /** The opening's edges in x, and its head and foot in y. */
  x0: number;
  x1: number;
  head: number;
  foot: number;
  /** The lintel's top in y, and its ends as the pattern's joints. */
  lintelTop: number;
  ll: number;
  lr: number;
}

/** A wall-family form's opening as the pattern has it. The pattern is laid to one span and one storey, and to content's door and window. */
function openingOf(name: string, form: FormDef): Opening | null {
  const [u0, v0, u1, v1] = outlineBox(form);
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
  if (form.outline.length !== 4 || !near(u0 - form.at[0], -H) || !near(u1 - form.at[0], H) || !near(v0 - form.at[1], -H) || !near(v1 - form.at[1], H) || !near(form.thick, 2 * T)) throw new Error(`stone ${name}: its pattern is laid to a wall one span wide, one storey high and ${2 * T} m thick`);
  const openings = form.openings ?? [];
  if (openings.length === 0) return null;
  const o = openings[0]!;
  const kind = o.y0 - form.at[1] <= -H + 1e-9 ? "door" : "window";
  const spec = kind === "door" ? DOOR : WINDOW;
  const [lk, ll, lr] = spec.lintel;
  const lintel = kind === "door" ? [BEDS[lk]!, BEDS[lk + 1]!] : [SPLIT.bed, BEDS[lk + 1]!];
  const made: Opening = { kind, spec, x0: spec.open[0] - H, x1: spec.open[1] - H, head: H - lintel[1]!, foot: H - spec.sill, lintelTop: H - lintel[0]!, ll, lr };
  if (openings.length > 1 || !near(o.x0 - form.at[0], made.x0) || !near(o.x1 - form.at[0], made.x1) || !near(o.y0 - form.at[1], made.foot) || !near(o.y1 - form.at[1], made.head)) throw new Error(`stone ${name}: its opening is not where the pattern's joints leave one`);
  return made;
}

const inRun = (s: Cell, course: number, left: number, right: number, band?: string): boolean => {
  const [u0, u1] = span(s.quad.map((p) => p[0]));
  return s.course === course && u0 >= left - 1e-6 && u1 <= right + 1e-6 && (band === undefined || s.band === band);
};
/** Whether a walling stone stands beside an opening: its jamb stones and its lintel take the place of the others. */
const beside = (o: Opening | null) => (s: Cell): boolean => {
  if (!o) return true;
  const [lk, ll, lr] = o.spec.lintel;
  return !o.spec.jambs.some(([k, l, r]) => inRun(s, k, l, r)) && !inRun(s, lk, ll, lr, o.kind === "window" ? "l" : undefined);
};

/** The worn threshold stone between a doorway's jambs, or a window's oak sill, weathered to a slope at the front. */
function sillOrThreshold(b: Build, o: Opening, level: number): void {
  if (o.kind === "door") {
    if (level === 0) b.prism([[-T, -H - GAP], [T, -H - GAP], [T, -H + 0.008], [T - 0.012, -H + 0.02], [-T + 0.012, -H + 0.02], [-T, -H + 0.008]], "x", o.x0, o.x1, "dressed");
    else b.box([o.x0, -H - GAP, -T], [o.x1, -H + 0.02, T], "dressed");
    return;
  }
  const sb = o.foot - 0.09;
  b.prism([[-T - 0.006, sb], [T + 0.05, sb], [T + 0.05, o.foot - 0.035], [T + 0.02, o.foot], [-T - 0.006, o.foot]], "x", o.x0 - 0.18, o.x1 + 0.18, "timber", "x");
}

/** A stone through the wall from one face to the other: its outline on each face in the piece's (x, y), and its rise from the mortar at each corner. */
interface Through {
  front: P2[];
  back: P2[];
  rise: number[];
}

/** An opening's jamb stones, dressed: their outer ends are the pattern's head joints on each face, and they sit on one another with no mortar between. */
function jambsOf(o: Opening): Through[] {
  const out: Through[] = [];
  for (const [k, l, r] of o.spec.jambs) {
    const [yt, yb] = [H - BEDS[k]!, H - BEDS[k + 1]!];
    for (const side of [-1, 1]) {
      const g = rng(o.kind, "jamb", k, side);
      const [gf, gk] = [g.uniform(0.005, 0.011), g.uniform(0.005, 0.011)];
      const [xf, xb] = side < 0 ? [l - H + gf, H - r + gk] : [r - H - gf, H - l - gk];
      const outline = (x: number): P2[] => (side < 0 ? [[x, yb], [o.x0, yb], [o.x0, yt], [x, yt]] : [[o.x1, yb], [x, yb], [x, yt], [o.x1, yt]]);
      // Prouder than any walling stone, so the jambs read as the stones that carry the opening.
      out.push({ front: outline(xf), back: outline(xb), rise: [0, 1, 2, 3].map(() => MD + 0.026 + g.uniform(0, 0.008)) });
    }
  }
  return out;
}

/** An opening's lintel, hewn oak, a little proud, its faces in three facets along it. */
function lintelOf(o: Opening): Through {
  const g = rng(o.kind, "lintel");
  const [gl, gr, gt] = [g.uniform(0.006, 0.012), g.uniform(0.006, 0.012), g.uniform(0.006, 0.012)];
  const high = o.lintelTop - gt;
  const mid = (o.ll + o.lr) / 2 - H + g.uniform(-0.15, 0.15);
  const outline = (x0: number, x1: number): P2[] => [[x0, o.head], [mid, o.head], [x1, o.head], [x1, high], [mid, high + g.uniform(-0.006, 0.004)], [x0, high]];
  const front = outline(o.ll - H + gl, o.lr - H - gr);
  return { front, back: outline(H - o.lr + gr, H - o.ll + gl), rise: [0.004, -0.005, 0.006, 0, 0.008, -0.003].map((d) => MD + 0.022 + d) };
}

/** A stone through the wall as a plain block, each face as proud as the stone's is on average. */
function throughBlock(b: Build, { front, back, rise }: Through, mat: string, grain?: string, core = CORE): void {
  const z = core + rise.reduce((sum, r) => sum + r, 0) / rise.length;
  const rect = (outline: readonly P2[], at: number): Vec[] => {
    const [x0, x1, y0, y1] = box2(outline);
    return [[x0, y0, at], [x1, y0, at], [x1, y1, at], [x0, y1, at]];
  };
  const [f, k] = [rect(front, z), rect(back, -z)];
  b.convex([{ pts: f }, { pts: k }, ...f.map((q, i) => ({ pts: [q, f[(i + 1) % 4]!, k[(i + 1) % 4]!, k[i]!] }))], mat, throughUv(grain));
}

/** A wall, a doorframe or a windowframe with every stone a solid of its own. */
function wallFine(o: Opening | null, rings: [number, number][]): Build {
  const b = new Build();
  b.rings = rings;
  if (!o) b.box([-H, -H - GAP, -CORE], [H, H - GAP, CORE], "masonry");
  else {
    // The core: two posts a centimetre back from the jamb stones, and what is above and below the opening.
    b.box([-H, -H - GAP, -CORE], [o.x0 - 0.01, H - GAP, CORE], "masonry");
    b.box([o.x1 + 0.01, -H - GAP, -CORE], [H, H - GAP, CORE], "masonry");
    b.box([o.x0 - 0.02, o.lintelTop - 0.015, -CORE], [o.x1 + 0.02, H - GAP, CORE], "masonry");
    if (o.kind === "window") b.box([o.x0 - 0.02, -H - GAP, -CORE], [o.x1 + 0.02, o.foot - 0.01, CORE], "masonry");
  }
  const keep = beside(o);
  for (const frame of [FRONT, BACK]) for (const { stone, look } of walling()) if (keep(stone)) lay(b, frame, stone, look, "masonry", { facet: FACET, whole: true, outline: true });
  if (!o) return b;
  for (const { front, back, rise } of jambsOf(o)) b.convex(block(front, back, 0.018, rise, [...rise].reverse()), "dressed", throughUv());
  const lintel = lintelOf(o);
  b.convex(block(lintel.front, lintel.back, 0.016, lintel.rise, lintel.rise), "timber", throughUv("x"));
  sillOrThreshold(b, o, 0);
  return b;
}

/** A level of a wall-family piece drawn as one flat sheet through the wall: what each face is cut into, and how thick it stands. */
interface Sheet {
  /** The cells of a face on its frame, which tile it but for the opening. */
  cells: (frame: Frame) => Tile[];
  half: number;
  /** The cells are the face's own outline already, to its very top, and are taken as they come. */
  whole?: boolean;
}

/**
 * A wall-family piece as one closed sheet: both faces cut into cells, its rim and the reveals of its opening between
 * them. The rim has corners on the yield rings, so its outline is exact where an end is pulled back.
 */
function sheet(b: Build, o: Opening | null, { cells, half, whole }: Sheet): void {
  // The rim has a corner on each yield ring, which the build is told of; a flat level is told of none.
  const rings = b.rings.map(([, at]) => at);
  const from = b.shape.faces.length;
  const [topV, footV] = [whole ? 0 : GAP, TILE];
  // What is left of the face round the opening, as boxes: over it the whole width, beside it, and under a window.
  const regions = !o || whole ? [within2(0, TILE, topV, footV)] : [
    within2(0, TILE, topV, H - o.head), within2(0, o.spec.open[0], H - o.head, H - o.foot), within2(o.spec.open[1], TILE, H - o.head, H - o.foot),
    ...(o.kind === "window" ? [within2(0, TILE, H - o.foot, footV)] : []),
  ];
  for (const frame of [FRONT, BACK]) tiles(b, frame.out(half - CORE), cells(frame), regions);
  const [y0, y1] = [H - footV, H - topV];
  const through = (a: P2, c: P2, out: Vec, mat = "masonry", grain?: string): void => b.flat([[a[0], a[1], half], [c[0], c[1], half], [c[0], c[1], -half], [a[0], a[1], -half]], out, mat, straight(out, grain));
  const runs = (x0: number, x1: number, y: number, out: Vec): void => {
    const xs = [x0, ...rings.filter((x) => x > x0 && x < x1), x1];
    for (let i = 0; i + 1 < xs.length; i++) through([xs[i]!, y], [xs[i + 1]!, y], out);
  };
  runs(-H, H, y1, [0, 1, 0]);
  through([-H, y0], [-H, y1], [-1, 0, 0]);
  through([H, y0], [H, y1], [1, 0, 0]);
  if (!o) runs(-H, H, y0, [0, -1, 0]);
  else {
    const open = o.kind === "door";
    if (open) runs(-H, o.x0, y0, [0, -1, 0]);
    runs(open ? o.x1 : -H, H, y0, [0, -1, 0]);
    // The reveals are the jamb stones' sides, the head the lintel's underside.
    through([o.x0, o.foot], [o.x0, o.head], [1, 0, 0], "dressed");
    through([o.x1, o.foot], [o.x1, o.head], [-1, 0, 0], "dressed");
    through([o.x0, o.head], [o.x1, o.head], [0, -1, 0], "timber", "x");
    if (!open) through([o.x0, o.foot], [o.x1, o.foot], [0, 1, 0]);
  }
  b.shape.weld(from);
}

/** The jamb stones and the lintel of an opening as cells of a face. */
function frameTiles(o: Opening): Tile[] {
  const out: Tile[] = [];
  for (const [k, l, r] of o.spec.jambs) {
    out.push({ poly: cell(l, o.spec.open[0], BEDS[k]!, BEDS[k + 1]!), mat: "dressed" }, { poly: cell(o.spec.open[1], r, BEDS[k]!, BEDS[k + 1]!), mat: "dressed" });
  }
  out.push({ poly: cell(o.ll, o.lr, H - o.lintelTop, H - o.head), mat: "timber" });
  return out;
}

/** A wall-family piece with each face one flat sheet, every stone a cell of it shaded as the stone it is. */
function wallSheet(o: Opening | null, rings: [number, number][]): Build {
  const b = new Build();
  b.rings = rings;
  sheet(b, o, { cells: (frame) => [...wallTiles(frame, beside(o)), ...(o ? frameTiles(o) : [])], half: CORE + FACE });
  if (!o) return b;
  // The jamb stones and the lintel stand proud of the sheet as plain blocks.
  for (const jamb of jambsOf(o)) throughBlock(b, jamb, "dressed");
  throughBlock(b, lintelOf(o), "timber", "x");
  sillOrThreshold(b, o, 1);
  return b;
}

/** A wall-family piece as a plain solid that wears the pictures: its walling whole, the jambs a column each side, the lintel over them. */
function wallPlain(o: Opening | null, rings: [number, number][]): Build {
  const b = new Build();
  b.rings = rings;
  // Cut at the yield rings, so no cell crosses one.
  const strips = (u0: number, u1: number, v0: number, v1: number): Tile[] => {
    const us = [u0, ...rings.map(([, at]) => at + H).filter((u) => u > u0 + 1e-9 && u < u1 - 1e-9), u1];
    return us.slice(1).map((u, i) => ({ poly: cell(us[i]!, u, v0, v1), mat: "masonry" }));
  };
  sheet(b, o, {
    half: T,
    cells: () => {
      if (!o) return strips(0, TILE, 0, TILE);
      // The jamb columns are as wide as the jamb stones are on average.
      const wide = o.spec.jambs.reduce((sum, [, l]) => sum + (o.spec.open[0] - l), 0) / o.spec.jambs.length;
      const [ja, jb] = [o.spec.open[0] - wide, o.spec.open[1] + wide];
      const [lt, lb, foot] = [H - o.lintelTop, H - o.head, H - o.foot];
      return [
        ...strips(0, TILE, 0, lt), ...strips(0, o.ll, lt, lb), ...strips(o.lr, TILE, lt, lb), { poly: cell(o.ll, o.lr, lt, lb), mat: "timber" },
        ...strips(0, ja, lb, foot), ...strips(jb, TILE, lb, foot), { poly: cell(ja, o.spec.open[0], lb, foot), mat: "dressed" }, { poly: cell(o.spec.open[1], jb, lb, foot), mat: "dressed" },
        ...(o.kind === "window" ? strips(0, TILE, foot, TILE) : []),
      ];
    },
  });
  if (o) sillOrThreshold(b, o, 2);
  return b;
}

/** A wall with an opening in flat colours: the wall's outline with the opening through it and the lintel's colour over it. */
function wallFar(o: Opening): Build {
  const b = new Build();
  const [a, c] = o.spec.open;
  const [lt, lb, foot] = [H - o.lintelTop, H - o.head, H - o.foot];
  // Each cell runs from the wall's outline to the opening's, so the only corners are those two outlines' and the lintel's.
  const cells: Tile[] = [
    { poly: [[0, 0], [TILE, 0], [c, lt], [a, lt]], mat: "masonry" }, { poly: cell(a, c, lt, lb), mat: "timber" },
    { poly: [[0, 0], [a, lt], [a, lb], [a, foot], [0, TILE]], mat: "masonry" }, { poly: [[TILE, 0], [TILE, TILE], [c, foot], [c, lb], [c, lt]], mat: "masonry" },
    ...(o.kind === "window" ? [{ poly: [[0, TILE], [a, foot], [c, foot], [TILE, TILE]] as P2[], mat: "masonry" }] : []),
  ];
  sheet(b, o, { half: T, whole: true, cells: () => cells });
  return b;
}

/**
 * Sets a level's foot as far under the piece's box as a wall's core reaches at the finest level. A wall's top stands
 * that far under its box or on it at every level, so no level of a wall leaves a seam over any level of the wall or the
 * floor under it.
 */
function sunk(b: Build, foot: number): Build {
  for (const f of b.shape.faces) if (f.points.some((p) => Math.abs(p[2] - foot) < 1e-9)) f.points = f.points.map((p): Vec => (Math.abs(p[2] - foot) < 1e-9 ? [p[0], p[1], foot - GAP] : p));
  return b;
}

function wallFamily(name: string, form: FormDef, level: number): Build | null {
  const o = openingOf(name, form);
  const rings = yieldPlanes(form);
  if (level === 0) return wallFine(o, rings);
  if (level === 1) return sunk(wallSheet(o, rings), -H);
  if (level === 2) return sunk(wallPlain(o, rings), -H);
  if (level === 3 && o) return sunk(wallFar(o), -H);
  if (level > (o ? 4 : 3)) return null;
  const b = new Build();
  b.box([-H, -H - GAP, -T], [H, H, T], "masonry");
  // A box lies nearer a window than a doorway, which it shuts: it may be drawn from nearer.
  if (o?.kind === "window") b.shape.error = 0.085;
  return b;
}

// Floors

const topFrame = (y: number): Frame => new Frame([-H, y, -H], [1, 0, 0], [0, 0, 1], [0, 1, 0]);
const flagged = (n: Vec): string => (n[1] > 0.5 ? "flags" : "masonry");

/** Flagstones on a bed, each a slab a centimetre thick, level but for a millimetre or two. */
function flagstones(b: Build, bed: number): void {
  const frame = topFrame(bed);
  for (const s of flagStones()) {
    const r = rng("flag rise", s.name);
    const rise = r.uniform(0.009, 0.012);
    const look: Look = { rise: [0, 1, 2, 3].map(() => rise - r.uniform(0, 0.0015)), bevel: [0, 1, 2, 3].map(() => r.uniform(FLAG_BEVEL[0], FLAG_BEVEL[1])), crown: 0, at: [0.5, 0.5] };
    const [base, face] = breaksOf(s, FLAG_NOTCH, FLAG_NOTCH);
    b.convex(stoneSides(frame, s.footprint, base, face, look), "flags", on(frame), true);
  }
}

/** Plinth joints along each side of a foundation between its corner blocks, as shares of the run between them. */
const PLINTH: Readonly<Record<string, readonly number[]>> = { "+z": [0.37, 0.71], "-z": [0.29, 0.55, 0.81], "+x": [0.42, 0.78], "-x": [0.33, 0.64] };
/** How far in from a foundation's box its plinth stones stand on their mortar. */
const PD = 0.035;
/** How far in from a foundation's side the bed under a wall is raised to the wall's foot: past the wall's core. */
const WALL_BAND = 0.11;

/** A foundation's corner block: the signs of its corner, how far it reaches along x and z, its outline at its foot and its head, and the stone each outer face wears. */
interface CornerBlock {
  sx: number;
  sz: number;
  a: number;
  b: number;
  y1: number;
  foot: P2[];
  head: P2[];
  uvOf: (n: Vec) => UvMap;
}

/** A big block at each corner of a foundation, standing a little proud of both faces, battered as the plinth stones are. */
function cornerBlocks(bottomY: number, bed: number): CornerBlock[] {
  const out: CornerBlock[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = rng("corner", sx, sz);
    const [a, b, p] = [g.uniform(0.44, 0.62), g.uniform(0.44, 0.62), g.uniform(0.004, 0.014)];
    const cut = g.uniform(0.015, 0.03);
    const y1 = bed - g.uniform(0.003, 0.008);
    const ring = (proud: number): P2[] => {
      const [x0, x1] = span([sx * (H - a), sx * (H + proud)]);
      const [z0, z1] = span([sz * (H - b), sz * (H + proud)]);
      return octagon((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, cut);
    };
    const [foot, head] = [ring(p + 0.014), ring(p - 0.004)];
    const origin: Vec = [sx * H, y1, sz * H];
    // Each outer face wears a walling stone: the axes as the face is seen, and the block's extent along them.
    const faces: Faced = ([[[sx, 0, 0], [0, 0, -sx], [0, -1, 0]], [[0, 0, sz], [sz, 0, 0], [0, -1, 0]]] as const).map(([n, ua, va]) => {
      const proj = [...foot, ...head].map(([px, pz]) => (px - origin[0]) * ua[0] + (pz - origin[2]) * ua[2]);
      return [n, ua, va, [...span(proj), 0, y1 - bottomY]] as const;
    });
    out.push({ sx, sz, a, b, y1, foot, head, uvOf: stoneFaced(origin, faces, ["corner", sx, sz]) });
  }
  return out;
}

/** A plinth stone of a foundation's side: its shape on the side's frame, its look, and the stone of the masonry picture it wears. */
interface PlinthStone {
  stone: Stone;
  look: Look;
  faced: UvMap;
}
/** A foundation's side between its corner blocks: the frame its stones are laid on, the blocks at its ends, and its stones. */
interface PlinthSide {
  frame: Frame;
  ends: [CornerBlock, CornerBlock];
  cuts: number[];
  stones: PlinthStone[];
}

function plinthSides(bottomY: number, bed: number, corners: readonly CornerBlock[]): PlinthSide[] {
  const at = (sx: number, sz: number): CornerBlock => corners.find((c) => c.sx === sx && c.sz === sz)!;
  const sides: [string, Frame, CornerBlock, CornerBlock, boolean][] = [
    ["+z", new Frame([-H, bed, H - PD], [1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0.1]), at(-1, 1), at(1, 1), true],
    ["-z", new Frame([H, bed, -H + PD], [-1, 0, 0], [0, -1, 0], [0, 0, -1], [0, 0.3]), at(1, -1), at(-1, -1), true],
    ["+x", new Frame([H - PD, bed, H], [0, 0, -1], [0, -1, 0], [1, 0, 0], [0, 0.5]), at(1, 1), at(1, -1), false],
    ["-x", new Frame([-H + PD, bed, -H], [0, 0, 1], [0, -1, 0], [-1, 0, 0], [0, 0.7]), at(-1, -1), at(-1, 1), false],
  ];
  return sides.map(([name, frame, first, last, alongX]) => {
    const [start, end] = alongX ? [first.a, last.a] : [first.b, last.b];
    const cuts = [start, ...PLINTH[name]!.map((f) => start + (TILE - start - end) * f), TILE - end];
    const stones = cuts.slice(1).map((u, i): PlinthStone => {
      const stone = shaped({ course: 0, name: `plinth${name}${i}`, quad: cell(cuts[i]!, u, 0, bed - bottomY) }, [0.004, 0.012], [0.012, 0.045], [0.04, 0.07], 0.25);
      const r = rng("plinth face", name, i);
      // Battered: the foot of each stone stands further out than its head, as a wall that holds ground back does.
      const out = PD + r.uniform(-0.004, 0.008);
      const rise = [out - 0.006, out - 0.006 + r.uniform(-0.003, 0.003), out + 0.014, out + 0.014 + r.uniform(-0.003, 0.003)];
      const look: Look = { rise, bevel: [0, 1, 2, 3].map(() => r.uniform(0.016, 0.03)), crown: r.uniform(0.004, 0.01), at: [r.uniform(0.4, 0.6), r.uniform(0.4, 0.6)] };
      return { stone, look, faced: ontoStone(frame.o, frame.u, frame.v, box2(stone.outline), ["plinth", name, i]) };
    });
    return { frame, ends: [first, last], cuts, stones };
  });
}

function foundation(form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const b = new Build();
  const [topY, bottomY] = [form.thick / 2, -form.thick / 2];
  if (level >= 2) {
    b.box([-H, bottomY, -H], [H, topY, H], flagged);
    return b;
  }
  const bed = topY - 0.012;
  const corners = cornerBlocks(bottomY, bed);
  const sides = plinthSides(bottomY, bed, corners);
  if (level === 1) {
    // One block: flags on top, and round it each corner block and plinth stone a cell that wears the stone it wears close to.
    const from = b.shape.faces.length;
    b.flat([[-H, topY, -H], [H, topY, -H], [H, topY, H], [-H, topY, H]], [0, 1, 0], "flags");
    b.flat([[-H, bottomY, -H], [H, bottomY, -H], [H, bottomY, H], [-H, bottomY, H]], [0, -1, 0], "masonry");
    for (const { frame, ends, cuts, stones } of sides) {
      const depth = topY - bottomY;
      const flush = new Frame(add(frame.at(0, bed - topY), scale(frame.n, PD)), frame.u, frame.v, frame.n);
      const cells: Tile[] = [
        { poly: cell(0, cuts[0]!, 0, depth), mat: "masonry", uv: ends[0].uvOf(frame.n) },
        ...stones.map(({ faced }, i): Tile => ({ poly: cell(cuts[i]!, cuts[i + 1]!, 0, depth), mat: "masonry", uv: faced })),
        { poly: cell(cuts[cuts.length - 1]!, TILE, 0, depth), mat: "masonry", uv: ends[1].uvOf(frame.n) },
      ];
      tiles(b, flush, cells, [within2(0, TILE, 0, depth)]);
    }
    b.shape.weld(from);
    return b;
  }
  b.box([-H + PD, bottomY, -H + PD], [H - PD, bed, H - PD], flagged);
  // Under where a wall's core stands, the bed is raised to the wall's foot: no line of sight passes along a joint between two flags there.
  for (const [x0, x1, z0, z1] of [[-H + PD, H - PD, H - WALL_BAND, H - PD], [-H + PD, H - PD, -H + PD, -H + WALL_BAND], [H - WALL_BAND, H - PD, -H + WALL_BAND, H - WALL_BAND], [-H + PD, -H + WALL_BAND, -H + WALL_BAND, H - WALL_BAND]] as const) b.box([x0, bed, z0], [x1, topY - GAP, z1], flagged);
  flagstones(b, bed);
  const ch = 0.014;
  for (const c of corners) b.convex(loft("y", [[bottomY, shrink(c.foot, ch)], [bottomY + ch, c.foot], [c.y1 - ch, c.head], [c.y1, shrink(c.head, ch)]]), "masonry", c.uvOf);
  // Between them, plinth stones on each side, every corner broken as the scripts broke it.
  for (const { frame, stones } of sides) {
    for (const { stone, look, faced } of stones) lay(b, frame, stone, look, "masonry", { notch: 0, facet: 0, uvOf: (n) => (dot(n, frame.n) > 0.3 ? faced : straight(n)) });
  }
  return b;
}

/** A hewn oak beam: its section a little out of true and not quite the same at both ends. `keep` names a side, "lo" or "hi", cut square by the piece's edge. */
function beam(b: Build, axis: string, centre: number, half: number, run: P2, low: number, high: number, key: string, keep = ""): void {
  const g = rng("beam", key);
  const jit = (): number => g.uniform(-0.006, 0.006);
  const section = (): P2[] => {
    let [lo, hi] = [centre - half, centre + half];
    if (keep !== "lo") lo += jit();
    if (keep !== "hi") hi += jit();
    const under = low + jit();
    const [c1, c2] = [g.uniform(0.012, 0.028), g.uniform(0.012, 0.028)];
    return [[lo, high], ...(keep === "lo" ? [[lo, under] as const] : [[lo, under + c1] as const, [lo + c1, under] as const]), ...(keep === "hi" ? [[hi, under] as const] : [[hi - c2, under] as const, [hi, under + c2] as const]), [hi, high]];
  };
  const [first, second] = [section(), section()];
  b.convex(loft(axis, [[run[0], first], [run[1], second]]), "timber", (n) => straight(n, axis), true);
}

/** Where a ceiling's beams run each way: two across the slab and half a beam along each edge, which meets its neighbour's half under the joint. */
const BEAMS: readonly (readonly [number, number, string])[] = [[-0.5, 0.08, ""], [0.5, 0.08, ""], [H - 0.04, 0.04, "hi"], [-H + 0.04, 0.04, "lo"]];
const BAYS: readonly P2[] = [[-H + 0.04, -0.58], [-0.42, 0.42], [0.58, H - 0.04]];
/** Python's word for a number that is not whole: its shortest, as this is. */
const py = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

function ceiling(form: FormDef, level: number): Build | null {
  if (level > 4) return null;
  const b = new Build();
  b.rings = yieldPlanes(form);
  const [topY, bottomY] = [form.thick / 2, -form.thick / 2];
  const soffit = -0.005;
  if (level === 4) {
    b.box([-H, bottomY, -H], [H, topY, H], flagged);
    return b;
  }
  if (level >= 2) {
    // One block as deep as the slab and its beams, the beams' timber round the lower half of its edge as the edge beams are.
    b.flat([[-H, topY, -H], [H, topY, -H], [H, topY, H], [-H, topY, H]], [0, 1, 0], "flags");
    b.flat([[-H, bottomY, -H], [H, bottomY, -H], [H, bottomY, H], [-H, bottomY, H]], [0, -1, 0], "masonry");
    for (const [out, a, c] of [[[0, 0, 1], [-H, H], [H, H]], [[0, 0, -1], [-H, -H], [H, -H]], [[1, 0, 0], [H, -H], [H, H]], [[-1, 0, 0], [-H, -H], [-H, H]]] as const) {
      for (const [y0, y1, mat, grain] of [[soffit, topY, "masonry", undefined], [bottomY, soffit, "timber", out[0] === 0 ? "x" : "z"]] as const) {
        b.flat([[a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]]], out, mat, straight(out, grain));
      }
    }
    return b;
  }
  const bed = topY - 0.012;
  if (level === 1) {
    // The slab whole, its underside a cell to each bay between the beams, and the beams square, each way run through.
    const from = b.shape.faces.length;
    b.flat([[-H, topY, -H], [H, topY, -H], [H, topY, H], [-H, topY, H]], [0, 1, 0], "flags");
    for (const [out, a, c] of [[[0, 0, 1], [-H, H], [H, H]], [[0, 0, -1], [-H, -H], [H, -H]], [[1, 0, 0], [H, -H], [H, H]], [[-1, 0, 0], [-H, -H], [-H, H]]] as const) {
      b.flat([[a[0], soffit, a[1]], [c[0], soffit, c[1]], [c[0], topY, c[1]], [a[0], topY, a[1]]], out as Vec, "masonry");
    }
    const edges = [-H, -0.5, 0.5, H];
    BAYS.forEach(([x0, x1], i) => BAYS.forEach(([z0, z1], j) => {
      const faced = ontoStone([0, soffit, 0], [1, 0, 0], [0, 0, -1], [x0, x1, -z1, -z0], ["bay", i, j]);
      b.flat([[edges[i]!, soffit, edges[j]!], [edges[i + 1]!, soffit, edges[j]!], [edges[i + 1]!, soffit, edges[j + 1]!], [edges[i]!, soffit, edges[j + 1]!]], [0, -1, 0], "masonry", faced);
    }));
    b.shape.weld(from);
    for (const [centre, half] of BEAMS) {
      b.box([-H, bottomY, centre - half], [H, soffit, centre + half], "timber", "x", [0, 0], true);
      b.box([centre - half, bottomY + 0.02, -H], [centre + half, soffit, H], "timber", "z", [0, 0], true);
    }
    return b;
  }
  b.box([-H, soffit, -H], [H, bed, H], flagged);
  flagstones(b, bed);
  // Between the beams the underside of the flags is rough stone, a walling stone of the masonry picture to each bay.
  BAYS.forEach(([x0, x1], i) => BAYS.forEach(([z0, z1], j) => {
    const drop = rng("bay", i, j).uniform(0.006, 0.014);
    const faced = ontoStone([0, soffit - drop, 0], [1, 0, 0], [0, 0, -1], [x0, x1, -z1, -z0], ["bay", i, j]);
    const sides = loft("y", [[soffit - drop, cell(x0, x1, z0, z1)], [soffit + 0.003, cell(x0, x1, z0, z1)]]);
    b.convex(sides, "masonry", (n) => (n[1] < -0.5 ? faced : straight(n)), true);
  }));
  // The beams one way run whole; the others are cut between them.
  for (const [centre, half, keep] of BEAMS) beam(b, "x", centre, half, [-H, H], bottomY, 0, `('x', ${py(centre)})`, keep);
  for (const [centre, half, keep] of BEAMS) for (const [z0, z1] of BAYS) beam(b, "z", centre, half, [z0, z1], bottomY + 0.02, 0, `('z', ${py(centre)}, ${py(z0)})`, keep);
  return b;
}

// Pillars

/** The top block stops short of the pillar's box: a ceiling laid on a pillar has its top level with the pillar's. */
const PILLAR_BLOCKS = [0.52, 0.47, 0.55, 0.44, 0.5, 0.505] as const;
const PILLAR_FACES: readonly (readonly [Vec, Vec, Vec])[] = [[[0, 0, 1], [1, 0, 0], [0, -1, 0]], [[1, 0, 0], [0, 0, -1], [0, -1, 0]], [[0, 0, -1], [-1, 0, 0], [0, -1, 0]], [[-1, 0, 0], [0, 0, 1], [0, -1, 0]]];

function pillar(form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const b = new Build();
  const [u0, , u1] = outlineBox(form);
  const w = (u1 - u0) / 2;
  const hy = form.thick / 2;
  if (level === 3) {
    b.box([-w, -hy, -w], [w, hy, w], "masonry");
    return b;
  }
  const from = b.shape.faces.length;
  let y = -hy;
  PILLAR_BLOCKS.forEach((height, i) => {
    const g = rng("pillar", i);
    const [y0, y1] = [y, y + height];
    y = y1;
    const turn = (g.uniform(-1.2, 1.2) * Math.PI) / 180;
    const [dx, dz] = [g.uniform(-0.004, 0.004), g.uniform(-0.004, 0.004)];
    const [hx, hz] = [w + g.uniform(-0.012, 0.01), w + g.uniform(-0.012, 0.01)];
    const [cut, ch] = [g.uniform(0.012, 0.03), g.uniform(0.012, 0.022)];
    const [c, s] = [Math.cos(turn), Math.sin(turn)];
    const turned = (profile: readonly P2[]): P2[] => profile.map(([x, z]) => [c * x + s * z + dx, -s * x + c * z + dz] as const);
    const full = octagon(0, 0, hx, hz, cut);
    const inner = shrink(full, ch);
    const sides = loft("y", [[y0, turned(inner)], [y0 + ch, turned(full)], [y1 - ch, turned(full)], [y1, turned(inner)]]);
    // Each of the four broad sides is pitched out to a crown, so the block reads as a rough-hewn stone.
    const made = [...sides.slice(0, 10), ...sides.slice(18)];
    const crowns: { quad: Vec[]; apex: Vec }[] = [];
    sides.slice(10, 18).forEach((side, k) => {
      if (k % 2 === 1) {
        made.push(side);
        return;
      }
      const m = mean(side.pts);
      const my = m[1] + g.uniform(-0.06, 0.06);
      const out = Math.hypot(m[0], m[2]) || 1;
      const crown = g.uniform(0.008, 0.02);
      const apex: Vec = [m[0] + (m[0] / out) * crown, my, m[2] + (m[2] / out) * crown];
      crowns.push({ quad: side.pts, apex });
      side.pts.forEach((p, j) => made.push({ pts: [p, side.pts[(j + 1) % 4]!, apex], smooth: true }));
    });
    const reach = Math.max(hx, hz) + 0.02;
    const uvOf = stoneFaced([0, y1, 0], PILLAR_FACES.map(([n, ua, va]) => [n, ua, va, [-reach, reach, 0, y1 - y0]] as const), ["pillar", i]);
    if (level === 0) {
      b.convex(made, "masonry", uvOf);
      return;
    }
    // Further off the block is four flat sides of the pillar, each shaded as its crown.
    for (const { quad, apex } of crowns) {
      const n = PILLAR_FACES.map((f) => f[0]).reduce((best, f) => (dot(f, newell(quad)) ** 2 > dot(best, newell(quad)) ** 2 ? f : best));
      const out = dot(n, mean(quad)) < 0 ? scale(n, -1) : n;
      const fan = quad.map((p, j) => {
        const f = unit(cross(sub(quad[(j + 1) % 4]!, p), sub(apex, p)));
        return dot(f, out) < 0 ? scale(f, -1) : f;
      });
      const normals = quad.map((p, j) => unit(add(scale(fan[(j + 3) % 4]!, angleAt(p, quad[(j + 3) % 4]!, apex)), scale(fan[j]!, angleAt(p, quad[(j + 1) % 4]!, apex)))));
      // Each corner of the crowned side, set square on the pillar's own.
      const square = quad.map((p): Vec => [out[0] !== 0 ? out[0] * w : Math.sign(p[0]) * w, p[1] < (y0 + y1) / 2 ? y0 : y1, out[2] !== 0 ? out[2] * w : Math.sign(p[2]) * w]);
      b.flat(square, out, "masonry", uvOf(out), normals);
    }
  });
  if (level > 0) {
    b.flat([[-w, -hy, -w], [w, -hy, -w], [w, -hy, w], [-w, -hy, w]], [0, -1, 0], "masonry");
    b.flat([[-w, y, -w], [w, y, -w], [w, y, w], [-w, y, w]], [0, 1, 0], "masonry");
    b.shape.weld(from);
  }
  return b;
}

// Stairs

/** The flight's two cheeks and its back, as the frame each is walled on and the half-spaces its walling is cut to. */
function flightFaces(inFrom: number, rise: number): { frame: Frame; keep: Plane[] }[] {
  // The cheeks rise with the flight, their top on the line through the nosings' feet, and stop short of the back, whose walling holds the corners.
  const slope: Plane = [[0, 0, 0], [0, Math.SQRT1_2, -Math.SQRT1_2]];
  const right = new Frame([H - inFrom, H, H], [0, 0, -1], [0, -1, 0], [1, 0, 0]);
  const left = new Frame([-H + inFrom, H, -H], [0, 0, 1], [0, -1, 0], [-1, 0, 0]);
  const rear = new Frame([-H, H, H - inFrom], [1, 0, 0], [0, -1, 0], [0, 0, 1]);
  return [{ frame: right, keep: [slope, keepAbove(right, MD)] }, { frame: left, keep: [slope, keepBelow(left, TILE - MD)] }, { frame: rear, keep: [keepLower(rear, rise)] }];
}

function stairs(form: FormDef, level: number): Build | null {
  if (level > 4) return null;
  const b = new Build();
  const steps = form.steps!;
  const rise = form.thick / steps;
  if (Math.abs(form.thick - TILE) > 1e-9) throw new Error("stone stairs are walled with one span of the pattern: a flight a storey high and a span long");
  /** A (z, y) outline run along x: a face to each of its sides, and its two ends, cut into `ends` where it is not convex. `mat` is told a face's normal and its middle. */
  const slab = (profile: readonly P2[], x0: number, x1: number, mat: (n: Vec, mid: Vec) => string, ends: readonly (readonly [readonly P2[], string])[] = [[profile, mat([1, 0, 0], [0, 0, 0])]]): void => {
    const round = area2(profile) < 0 ? [...profile].reverse() : [...profile];
    for (const [end, of] of ends) {
      b.flat(end.map(([z, y]): Vec => [x1, y, z]), [1, 0, 0], of);
      b.flat(end.map(([z, y]): Vec => [x0, y, z]), [-1, 0, 0], of);
    }
    round.forEach(([za, ya], i) => {
      const [zb, yb] = round[(i + 1) % round.length]!;
      const out = unit([0, -(zb - za), yb - ya]);
      b.flat([[x0, ya, za], [x0, yb, zb], [x1, yb, zb], [x1, ya, za]], out, mat(out, [0, (ya + yb) / 2, (za + zb) / 2]));
    });
  };
  const dressedOver = (n: Vec): string => (n[1] > 0.5 ? "dressed" : "masonry");
  // Coarsest, the slope from foot to head; before that, midway between the steps' noses and their roots.
  if (level === 4) {
    slab([[-H, -H], [H, -H], [H, H]], -H, H, dressedOver);
    return b;
  }
  if (level === 3) {
    slab([[-H, -H], [H, -H], [H, H], [H - rise / 2, H], [-H, -H + rise / 2]], -H, H, dressedOver);
    return b;
  }
  if (level === 2) {
    // One stepped solid. Each tread's end is a dressed square as the tread blocks' are, and the top tread's back is dressed.
    const root = (i: number): P2 => [-H + i * rise, -H + i * rise];
    const under = (i: number): P2 => [-H + (i + 1) * rise, -H + i * rise];
    const outline: P2[] = [];
    const ends: [P2[], string][] = [];
    const foot: P2 = [H, -H];
    for (let i = 0; i < steps; i++) {
      outline.push(root(i), [root(i)[0], root(i + 1)[1]]);
      ends.push([[root(i), [root(i)[0], root(i + 1)[1]], root(i + 1), under(i)], "dressed"]);
      // What is under the treads, as a fan from the back's foot.
      if (i > 0) ends.push([[foot, root(i), under(i - 1)], "masonry"], [[foot, under(i), root(i)], "masonry"]);
    }
    slab([...outline, root(steps), under(steps - 1), foot, under(0)], -H, H, (n, mid) => (n[1] < -0.5 || (n[2] > 0.5 && mid[1] < H - rise) ? "masonry" : "dressed"), ends);
    return b;
  }
  const inFrom = level === 0 ? MD : MD - FACE;
  const back = H - inFrom;
  // The mass under the treads, to the line through their inner corners, which the treads hide.
  const mass: P2[] = [[-H + rise, -H], [back, -H], [back, H - rise], [H - rise, H - rise], [-H + rise, -H + rise]];
  const faces = flightFaces(inFrom, rise);
  // Under the top tread the back's first course is a sliver: one long stone there, in place of seven.
  const sliver = shaped({ course: 0, name: "stairs back top", quad: cell(0, TILE, rise, BEDS[1]!) }, [0.006, 0.014], [0, 0], [0, 0], 0);
  const below = (s: Cell): boolean => s.course > 0;
  if (level === 0) {
    slab(mass, -H + inFrom, H - inFrom, () => "masonry");
    faces.forEach(({ frame, keep }, k) => {
      for (const { stone, look } of walling()) if (k < 2 || below(stone)) lay(b, frame, stone, look, "masonry", { keep, least: LEAST });
    });
    const rear = faces[2]!.frame;
    b.convex(stoneSides(rear, [[sliver.footprint[0]![0], rise], [sliver.footprint[1]![0], rise], sliver.footprint[2]!, sliver.footprint[3]!], WHOLE, WHOLE, { rise: [0.03, 0.03, 0.03, 0.03], bevel: [0, 0.02, 0.02, 0.02], crown: 0, at: [0.5, 0.5] }), "masonry", on(rear));
    for (let i = 0; i < steps; i++) {
      const [z0, z1, y0, y1] = [-H + i * rise, -H + (i + 1) * rise, -H + i * rise, -H + (i + 1) * rise];
      const g = rng("step", i);
      // Each tread two dressed blocks, their tops not quite level and their nosings worn by their own amounts.
      const split = g.uniform(-0.75, 0.75);
      for (const [x0, x1] of [[-H, split - 0.002], [split + 0.002, H]] as const) {
        const [dy, nose] = [g.uniform(-0.004, 0.002), g.uniform(0.02, 0.04)];
        const shift: P2 = [g.uniform(-0.3, 0.3), g.uniform(-0.3, 0.3)];
        b.prism([[z0, y0], [z1, y0], [z1, y1 + dy], [z0 + nose, y1 + dy], [z0, y1 + dy - nose]], "x", x0, x1, "dressed", undefined, shift);
      }
    }
    return b;
  }
  // Each cheek and the back one flat sheet, every stone a cell of it.
  const from = b.shape.faces.length;
  b.flat([[-back, -H, -H + rise], [back, -H, -H + rise], [back, -H, back], [-back, -H, back]], [0, -1, 0], "masonry");
  b.flat([[-back, -H, -H + rise], [back, -H, -H + rise], [back, -H + rise, -H + rise], [-back, -H + rise, -H + rise]], [0, 0, -1], "masonry");
  b.flat([[-back, -H + rise, -H + rise], [back, -H + rise, -H + rise], [back, H - rise, H - rise], [-back, H - rise, H - rise]], [0, 1, -1], "masonry");
  b.flat([[-back, H - rise, H - rise], [back, H - rise, H - rise], [back, H - rise, back], [-back, H - rise, back]], [0, 1, 0], "masonry");
  faces.forEach(({ frame }, k) => {
    // The cheek's outline on its frame, where u runs from the back on the right and from the foot on the left.
    const outline: P2[] = mass.map(([z, y]) => [k === 0 ? H - z : z + H, H - y] as const);
    const cells = k < 2 ? wallTiles(frame) : [...wallTiles(frame, below), { poly: sliver.quad, mat: "masonry" }];
    tiles(b, frame, cells, [k === 2 ? within2(inFrom, TILE - inFrom, rise, TILE) : sidesOf(outline)]);
  });
  b.shape.weld(from);
  // Each tread one square block the width of the flight.
  for (let i = 0; i < steps; i++) b.box([-H, -H + i * rise, -H + i * rise], [H, -H + (i + 1) * rise, -H + (i + 1) * rise], "dressed");
  return b;
}

/** A convex outline's sides for clip2, whichever way round it runs. */
function sidesOf(poly: readonly P2[]): (readonly [number, number, number])[] {
  const round = area2(poly) < 0 ? [...poly].reverse() : poly;
  return round.map(([u, v], i) => {
    const [nu, nv] = round[(i + 1) % round.length]!;
    return [nv - v, -(nu - u), (nv - v) * u - (nu - u) * v] as const;
  });
}

// The door

const DW = 0.7;
const DT = 0.04;
const DOOR_FOOT = 0.02; // it clears the threshold

/**
 * The door: five oak planks on ledges and braces, hung on three iron strap hinges, with a ring to pull it by. Open, it
 * is the same door a quarter turn round its hinge at the doorway's left, swung toward the front: the line its row's
 * box turns on, 2 cm in from its hung edge and in front of its middle. One of a pair has no ledges from 60 m.
 */
function door(form: FormDef, level: number, pair = false): Build | null {
  if (level > 3) return null;
  const b = new Build();
  const [u0, v0, u1, v1] = outlineBox(form);
  if (Math.abs(u1 - u0 - 2 * DW) > 1e-9) throw new Error("stone's door is five planks 1.4 m across");
  const dh = (v1 - v0) / 2;
  const off = form.off ?? 0;
  if (form.plane === "across") b.turn = ([x, y, z]) => [off - z, y, x + DW];
  const [y0, y1] = [-dh + DOOR_FOOT, dh];
  const [faceZ, backZ] = [0.034, -0.016];
  if (level === 3) {
    b.box([-DW, y0, -DT], [DW, y1, DT], "timber", "y");
    return b;
  }
  if (level === 2) b.box([-DW, y0, backZ], [DW, y1, faceZ], "timber", "y");
  else {
    // Five oak planks of their own widths and thicknesses, their arrises taken off and their ends not quite level.
    let x = -DW;
    [0.3, 0.26, 0.29, 0.27, 0.28].forEach((w, k) => {
      const g = rng("plank", k);
      const [a, c] = [x, x + w];
      const fz = faceZ - g.uniform(0, 0.004);
      const worn = g.uniform(0.005, 0.009);
      const cp = level === 0 ? worn : 0;
      const profile: P2[] = cp > 0 ? [[a + cp, backZ], [c - cp, backZ], [c, backZ + cp], [c, fz - cp], [c - cp, fz], [a + cp, fz], [a, fz - cp], [a, backZ + cp]] : [[a, backZ], [c, backZ], [c, fz], [a, fz]];
      const [lo, hi] = [y0 + g.uniform(0, 0.008), y1 - g.uniform(0, 0.006)];
      b.convex(loft("y", [[lo, profile], [hi, profile]]), "timber", (n) => straight(n, "y", [((k * 0.31) % 0.5) - 0.25, ((k * 0.17) % 0.4) - 0.2]));
      x = c;
    });
  }
  const straps = [-0.82, 0, 0.82];
  for (const yc of straps) {
    if (level === 2) {
      b.box([-DW + 0.01, yc - 0.035, faceZ], [DW - 0.01, yc + 0.035, DT], "iron", "x");
      continue;
    }
    // An iron strap hinge across the door: square at the hinge, narrowing to a spear point near the far edge.
    const section = (half: number): P2[] => [[faceZ, yc - half], [DT, yc - half], [DT, yc + half], [faceZ, yc + half]];
    b.convex(loft("x", [[-DW + 0.004, section(0.035)], [DW - 0.16, section(0.035)], [DW - 0.06, section(0.004)]]), "iron", (n) => straight(n, "x"));
  }
  // Ledges across the back, and braces between them rising from the hinge side.
  for (const yc of pair && level === 2 ? [] : straps) {
    if (level === 0) b.prism([[backZ, yc - 0.07], [backZ, yc + 0.07], [-DT + 0.006, yc + 0.07], [-DT, yc + 0.064], [-DT, yc - 0.064], [-DT + 0.006, yc - 0.07]], "x", -DW + 0.08, DW - 0.08, "timber", "x");
    else b.box([-DW + 0.08, yc - 0.07, -DT], [DW - 0.08, yc + 0.07, backZ], "timber", "x");
  }
  if (level === 2) return b;
  for (const [ya, yb] of [[straps[0]!, straps[1]!], [straps[1]!, straps[2]!]]) {
    const [from, to]: [P2, P2] = [[-DW + 0.2, ya], [DW - 0.2, yb]];
    const l = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const d: P2 = [(to[0] - from[0]) / l, (to[1] - from[1]) / l];
    const p: P2 = [-d[1], d[0]];
    const corners: P2[] = [...[-0.055, 0.055].map((s) => [from[0] + p[0] * s, from[1] + p[1] * s] as const), ...[0.055, -0.055].map((s) => [to[0] + p[0] * s, to[1] + p[1] * s] as const)];
    // The grain runs along the brace.
    const grain: UvMap = (q) => [(q[0] * d[0] + q[1] * d[1]) / TILE + 0.5, (q[0] * p[0] + q[1] * p[1]) / TILE + 0.3];
    b.convex(loft("z", [[-DT + 0.002, corners], [backZ, corners]]), "timber", (n) => (Math.abs(n[2]) > 0.5 ? grain : straight(n)));
  }
  // A plate above the middle strap for the ring the door is pulled by.
  b.box([0.41, 0.075, faceZ], [0.49, 0.155, DT], "iron");
  if (level === 1) return b;
  // Rivet heads along the straps.
  for (const yc of straps) for (const xc of [-0.56, -0.19, 0.19, 0.56]) {
    const base: Vec[] = [[xc - 0.011, yc - 0.011, DT], [xc + 0.011, yc - 0.011, DT], [xc + 0.011, yc + 0.011, DT], [xc - 0.011, yc + 0.011, DT]];
    b.convex([{ pts: base }, ...base.map((q, k) => ({ pts: [q, base[(k + 1) % 4]!, [xc, yc, DT + 0.007] as Vec] }))], "iron", (n) => straight(n));
  }
  // The knuckles the straps are forged round, which turn on pins in the jamb: seen at the door's edge when it stands open.
  for (const yc of straps) {
    const knuckle = Array.from({ length: 8 }, (_, k): P2 => [-DW + 0.012 * Math.cos((k * Math.PI) / 4), 0.03 + 0.012 * Math.sin((k * Math.PI) / 4)]);
    b.convex(loft("y", [[yc - 0.05, knuckle], [yc + 0.05, knuckle]]), "iron", (n) => straight(n));
  }
  // The ring, lying flat against the door, its faces turned out from the tube.
  const [centre, radius, tube, around, across]: [Vec, number, number, number, number] = [[0.45, 0.07, DT + 0.009], 0.05, 0.008, 8, 4];
  const at = (i: number, j: number): Vec => {
    const [a, c] = [(2 * Math.PI * i) / around, (2 * Math.PI * j) / across];
    const r = radius + tube * Math.cos(c);
    return [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a), centre[2] + tube * Math.sin(c)];
  };
  for (let i = 0; i < around; i++) for (let j = 0; j < across; j++) {
    const quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    const a = (2 * Math.PI * (i + 0.5)) / around;
    const out = sub(mean(quad), [centre[0] + radius * Math.cos(a), centre[1] + radius * Math.sin(a), centre[2]]);
    const turned = dot(newell(quad), out) < 0 ? [...quad].reverse() : quad;
    b.face(turned, "iron", straight(newell(turned)));
  }
  return b;
}

/**
 * A double door: the door's own leaf hung on the doorway's left jamb, and the same leaf in a mirror on its right. Open,
 * each is that leaf a quarter turn round on its own jamb, as an open door is: the row's `pair` is the mirror. From 386 m
 * the shut pair is one block, and an open one a sheet to a leaf, seen from both sides.
 */
function doubleDoor(form: FormDef, level: number): Build | null {
  if (level > 4) return null;
  const [u0, v0, u1, v1] = outlineBox(form);
  const open = form.plane === "across";
  const wide = open ? u1 - u0 : (u1 - u0) / 2;
  const [y0, y1] = [v0 - form.at[1] + DOOR_FOOT, v1 - form.at[1]];
  if (level === 4) {
    const b = new Build();
    if (!open) b.box([-wide, y0, -DT], [wide, y1, DT], "timber", "y");
    else for (const s of [-1, 1]) for (const out of [-1, 1]) b.flat([[s * (form.off! - form.at[0]), y0, 0], [s * (form.off! - form.at[0]), y0, wide], [s * (form.off! - form.at[0]), y1, wide], [s * (form.off! - form.at[0]), y1, 0]], [out, 0, 0], "timber");
    return b;
  }
  // One leaf as a door's row has it: about its own middle shut, and open by where its thickness stands from the pair's middle.
  const row: FormDef = { ...form, outline: [[-wide / 2, v0], [wide / 2, v0], [wide / 2, v1], [-wide / 2, v1]], ...(open ? { off: (form.off ?? 0) - form.at[0] } : {}) };
  const [left, right] = [door(row, level, true), door(row, level, true)];
  if (!left || !right) return null;
  if (!open) for (const leaf of [left, right]) place(leaf.shape, (q) => [q[0] - wide / 2, q[1], q[2]]);
  left.shape.faces.push(...mirror(right.shape, 0).faces);
  return left;
}

// The forms past the first nine. Each is built from its row alone, in the mason's own members: walling is the wall's
// pattern, laid from the piece's foot and its -x end and cut to the piece, as stones (`layWall`) or as a sheet
// (`panel`); dressed stones are blocks through the wall; flags are the floor's pattern cut to the piece.

/** An upright form's box about its collider's origin: its ends, its foot and top, half its thickness and half its core's. */
interface WallBox {
  x0: number;
  x1: number;
  foot: number;
  top: number;
  half: number;
  core: number;
}

function wallBox(form: FormDef): WallBox {
  const [u0, v0, u1, v1] = outlineBox(form);
  const half = form.thick / 2;
  return { x0: u0 - form.at[0], x1: u1 - form.at[0], foot: v0 - form.at[1], top: v1 - form.at[1], half, core: half - MD };
}

/** A half-plane of a piece's face in its own (x, y): where a x + b y <= c. A region is what lies inside every one of its sides. */
type Half2 = readonly [number, number, number];
type Region = readonly Half2[];
const below = (y: number): Half2 => [0, 1, y];
const above = (y: number): Half2 => [0, -1, -y];
const leftOf = (x: number): Half2 => [1, 0, x];
const rightOf = (x: number): Half2 => [-1, 0, -x];

/** The frames the wall's pattern is laid on to cover both faces of a box: a tile to each span and storey, from the foot and from each face's own left end. */
function faceTiles(w: WallBox): { frame: Frame; last: boolean; runsIn: boolean; runsOut: boolean }[] {
  const out: { frame: Frame; last: boolean; runsIn: boolean; runsOut: boolean }[] = [];
  const [nx, ny] = [Math.ceil((w.x1 - w.x0) / TILE - 1e-6), Math.ceil((w.top - w.foot) / TILE - 1e-6)];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const y = w.foot + (j + 1) * TILE;
    const at = { last: j === ny - 1, runsIn: i > 0, runsOut: i < nx - 1 };
    out.push({ frame: new Frame([w.x0 + i * TILE, y, w.core], [1, 0, 0], [0, -1, 0], [0, 0, 1]), ...at });
    out.push({ frame: new Frame([w.x1 - i * TILE, y, -w.core], [-1, 0, 0], [0, -1, 0], [0, 0, -1]), ...at });
  }
  return out;
}

/** A region of a piece's face as sides on one of its frames, for clip2. */
const onFrame = (frame: Frame, region: Region): Half2[] => region.map(([a, b, c]) => [a * frame.u[0], -b, c - a * frame.o[0] - b * frame.o[1]] as const);
/** Sides on a frame as the half-spaces a stone laid on it is cut to. */
const planesOn = (frame: Frame, sides: readonly Half2[]): Plane[] => sides.map(([a, b, c]) => [frame.at((a * c) / (a * a + b * b), (b * c) / (a * a + b * b)), add(scale(frame.u, a), scale(frame.v, b))] as const);

/**
 * The wall's stones on both faces of a box, each cut to every region it reaches. A stone that lies in two regions is
 * two stones there, which is seen only where the regions' own edge is a joint.
 */
function layWall(b: Build, w: WallBox, regions: readonly Region[], o: Laying = {}): void {
  for (const { frame, last, runsIn, runsOut } of faceTiles(w)) {
    for (const { stone, look } of walling()) {
      for (const region of regions) lay(b, frame, stone, look, "masonry", { whole: true, cutOnly: true, ...o, runsIn, runsOut, outline: o.outline === true && last, risen: o.risen === true && last, keep: planesOn(frame, onFrame(frame, region)) });
    }
  }
}

/**
 * A face's walling as fewer cells: two stones laid in one course's height are one cell, and so is a course laid as two
 * thin ones. A cell is still shaded as the stones in it stand. For a sheet larger than a wall's.
 */
function coarseTiles(frame: Frame): Tile[] {
  const groups = new Map<string, { stone: Stone; look: Look }[]>();
  for (const laid of walling()) {
    const key = /^(k\d+s\d+)(?:a|b|[ul]\d+)$/.exec(laid.stone.name)?.[1] ?? laid.stone.name;
    groups.set(key, [...(groups.get(key) ?? []), laid]);
  }
  const out: Tile[] = [];
  for (const group of groups.values()) {
    const [v0, v1] = span(group.flatMap(({ stone }) => stone.quad.map((q) => q[1])));
    const [upper, lower] = [v0, v1].map((v, k) => group.map(({ stone }) => stone.quad).filter((q) => Math.abs(q[k * 2]![1] - v) < 1e-9).sort((a, c) => a[0]![0] - c[0]![0]));
    const quad: P2[] = [upper![0]![0]!, upper![upper!.length - 1]![1]!, lower![lower!.length - 1]![2]!, lower![0]![3]!];
    const normals = group.map(({ stone, look }) => ({ box: box2(stone.quad), at: stoneNormal(frame, stone.footprint, look) }));
    // The normal of whichever of its stones a point lies on.
    const field = seenFlat(quad, (u, v) => (normals.find(({ box }) => u >= box[0] && u <= box[1] && v >= box[2] && v <= box[3]) ?? normals[0]!).at(u, v));
    const wraps = Math.max(...quad.map((q) => q[0])) > TILE + 1e-9;
    for (const shift of wraps ? [0, -TILE] : [0]) out.push({ poly: quad.map(([u, v]) => [u + shift, v] as const), mat: "masonry", field: (u, v) => field(u - shift, v) });
  }
  return out;
}

/** A cell of a sheet given in the piece's own (x, y), the same on both faces: a dressed block, a lintel. */
interface PanelCell {
  poly: readonly P2[];
  mat: string;
  uv?: UvMap;
  /** How far its corners' normals lean out from its middle: a block shaded as if its arrises were taken off. */
  pillow?: number;
}

interface Panel {
  /** How far each face stands from the piece's middle. */
  half: number;
  /** The piece's outline in (x, y), and each of its sides' material and grain where it is not masonry. */
  outline: readonly P2[];
  rim?: (side: number) => readonly [string, string?];
  /** What the pattern's cells are cut to, and the cells of a face on one of its frames. */
  regions?: readonly Region[];
  cells?: (frame: Frame) => Tile[];
  blocks?: (front: boolean) => readonly PanelCell[];
}

/**
 * An upright piece of any outline as one closed sheet: both faces cut into cells, and its rim between them, with a
 * corner on each yield ring so that its outline is exact where an end is pulled back.
 */
function panel(b: Build, w: WallBox, p: Panel): void {
  const from = b.shape.faces.length;
  if (p.cells && p.regions) {
    for (const { frame } of faceTiles(w)) tiles(b, frame.out(p.half - w.core), p.cells(frame), p.regions.map((r) => [...onFrame(frame, r), ...within2(0, TILE, 0, TILE)]));
  }
  for (const front of [true, false]) {
    const z = front ? p.half : -p.half;
    for (const c of p.blocks?.(front) ?? []) {
      const pts = c.poly.map(([x, y]): Vec => [x, y, z]);
      const mid = mean(pts);
      const normals = c.pillow ? pts.map((q) => unit(add(scale(unit(sub(q, mid)), c.pillow!), [0, 0, front ? 1 : -1]))) : undefined;
      b.flat(pts, [0, 0, front ? 1 : -1], c.mat, c.uv ?? (front ? FRONT.uv : BACK.uv), normals, b.spans(pts));
    }
  }
  const rings = b.rings.filter(([axis]) => axis === 0).map(([, at]) => at);
  const turn = Math.sign(area2(p.outline));
  p.outline.forEach((a, k) => {
    const c = p.outline[(k + 1) % p.outline.length]!;
    const out = unit([(c[1] - a[1]) * turn, -(c[0] - a[0]) * turn, 0]);
    const [mat, grain] = p.rim?.(k) ?? ["masonry"];
    const ts = [0, ...rings.map((x) => (x - a[0]) / (c[0] - a[0])).filter((t) => t > 1e-9 && t < 1 - 1e-9).sort((x, y) => x - y), 1];
    for (let i = 0; i + 1 < ts.length; i++) {
      const [q, r] = [ts[i]!, ts[i + 1]!].map((t): P2 => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]) as [P2, P2];
      b.flat([[q[0], q[1], p.half], [r[0], r[1], p.half], [r[0], r[1], -p.half], [q[0], q[1], -p.half]], out, mat, straight(out, grain));
    }
  });
  b.shape.weld(from);
}

/** A face's tile cut at the yield rings and no further: the cells of a level that wears the pictures plain. */
const plainCells = (b: Build) => (frame: Frame): Tile[] => {
  const us = [0, ...b.rings.filter(([axis]) => axis === 0).map(([, at]) => (at - frame.o[0]) * frame.u[0]).filter((u) => u > 1e-9 && u < TILE - 1e-9).sort((x, y) => x - y), TILE];
  return us.slice(1).map((u, i) => ({ poly: cell(us[i]!, u, 0, TILE), mat: "masonry" }));
};

/** A dressed coping course is this deep. */
const COPING = 0.13;
/** How far a dressed block's face stands from the mortar: prouder than the walling, as the jambs are. */
const DRESSED = MD + 0.026;

/** The stones of a coping course along the top of a box, about `long` metres each, the wall's ends flat on its own. */
function copingStones(w: WallBox, key: string, long = 0.78): Through[] {
  const g = rng("coping", key);
  const count = Math.max(1, Math.round((w.x1 - w.x0) / long));
  const edges = [w.x0, ...Array.from({ length: count - 1 }, (_, i) => w.x0 + ((w.x1 - w.x0) * (i + 1 + g.uniform(-0.18, 0.18))) / count), w.x1];
  const [yb, yt] = [w.top - COPING, w.top - GAP];
  return edges.slice(1).map((x1, i) => {
    const [a, c] = [edges[i]! + (i === 0 ? 0 : g.uniform(0.003, 0.006)), x1 - (i === count - 1 ? 0 : g.uniform(0.003, 0.006))];
    const outline: P2[] = [[a, yb], [c, yb], [c, yt], [a, yt]];
    return { front: outline, back: outline, rise: [0, 1, 2, 3].map(() => DRESSED + g.uniform(-0.002, 0.004)) };
  });
}

/** A dressed block through a wall as a plain block, its two faces shaded as if its arrises were taken off. */
function pillowBlock(b: Build, { front, rise }: Through, core: number, mat = "dressed", pillow = 0.22, grain?: string): void {
  const z = core + rise.reduce((sum, r) => sum + r, 0) / rise.length;
  const [f, k] = [z, -z].map((at) => front.map(([x, y]): Vec => [x, y, at])) as [Vec[], Vec[]];
  const mid = mean(f);
  const lean = (out: number) => (p: Vec): Vec => unit(add(scale(unit([p[0] - mid[0], p[1] - mid[1], 0]), pillow), [0, 0, out]));
  b.convex([{ pts: f, field: lean(1) }, { pts: k, field: lean(-1) }, ...f.map((q, i) => ({ pts: [q, f[(i + 1) % f.length]!, k[(i + 1) % f.length]!, k[i]!] }))], mat, throughUv(grain), true);
}

/** A dressed block through a wall, its arrises taken off on both faces. A block across a yield ring is pulled back whole. */
function dressedBlock(b: Build, s: Through, core: number, bevel = 0.014, mat = "dressed", grain?: string): void {
  b.convex(block(s.front, s.back, bevel, s.rise, s.rise.length === 4 ? [...s.rise].reverse() : s.rise, core), mat, throughUv(grain), true);
}

/**
 * A half wall or a quarter wall: the wall's own lower courses, so its beds run on into the wall beside it, under a
 * dressed coping course that stands a little proud. A battlement, a parapet, a sill wall.
 */
function lowWall(name: string, form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const w = wallBox(form);
  const b = new Build();
  b.free = true;
  b.rings = yieldPlanes(form);
  if (level === 3) {
    b.box([w.x0, w.foot, -w.half], [w.x1, w.top, w.half], "masonry");
    return b;
  }
  const under = w.top - COPING;
  if (level === 0) {
    b.box([w.x0, w.foot - GAP, -w.core], [w.x1, under + 0.03, w.core], "masonry");
    layWall(b, w, [[below(under)]], { facet: FACET, least: LEAST });
    for (const s of copingStones(w, name)) dressedBlock(b, s, w.core);
    return b;
  }
  const outline: P2[] = [[w.x0, w.foot], [w.x1, w.foot], [w.x1, under], [w.x0, under]];
  if (level === 1) panel(b, w, { half: w.core + FACE, outline, regions: [[below(under)]], cells: (frame) => wallTiles(frame) });
  else panel(b, w, { half: w.half, outline, regions: [[below(under)]], cells: plainCells(b) });
  // The coping one stone from end to end, which a yield ring leaves whole.
  b.box([w.x0, under, -w.core - DRESSED], [w.x1, w.top - GAP, w.core + DRESSED], "dressed", undefined, [0, 0], true);
  return b;
}

/**
 * A strip of foundation under a wall where no floor is: a plinth course, its stones battered as a foundation's are,
 * on both faces of a core of rubble.
 */
function footing(form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const w = wallBox(form);
  const b = new Build();
  b.free = true;
  b.rings = yieldPlanes(form);
  const outline: P2[] = [[w.x0, w.foot], [w.x1, w.foot], [w.x1, w.top], [w.x0, w.top]];
  if (level === 3) {
    b.box([w.x0, w.foot, -w.half], [w.x1, w.top, w.half], "masonry");
    return b;
  }
  const depth = w.top - w.foot;
  const sides = ([[1, new Frame([w.x0, w.top, w.half - PD], [1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0.1])], [-1, new Frame([w.x1, w.top, -w.half + PD], [-1, 0, 0], [0, -1, 0], [0, 0, -1], [0, 0.3])]] as const).map(([side, frame]) => {
    const g = rng("footing", side);
    const count = Math.max(2, Math.round((w.x1 - w.x0) / 0.8));
    const cuts = [0, ...Array.from({ length: count - 1 }, (_, i) => ((w.x1 - w.x0) * (i + 1 + g.uniform(-0.2, 0.2))) / count), w.x1 - w.x0];
    const stones = cuts.slice(1).map((u, i) => {
      const stone = shaped({ course: 0, name: `footing${side}${i}`, quad: cell(cuts[i]!, u, 0.004, depth) }, [0.004, 0.012], [0.012, 0.045], [0.04, 0.07], 0.25);
      const r = rng("footing face", side, i);
      const out = PD + r.uniform(-0.006, 0.004);
      const look: Look = { rise: [out - 0.008, out - 0.008 + r.uniform(-0.003, 0.003), out + 0.012, out + 0.012 + r.uniform(-0.003, 0.003)], bevel: [0, 1, 2, 3].map(() => r.uniform(0.016, 0.03)), crown: r.uniform(0.004, 0.01), at: [r.uniform(0.4, 0.6), r.uniform(0.4, 0.6)] };
      return { stone, look, faced: ontoStone(frame.o, frame.u, frame.v, box2(stone.outline), ["footing", side, i]), x: [frame.o[0] + frame.u[0] * cuts[i]!, frame.o[0] + frame.u[0] * u] as const };
    });
    return { side, frame, stones };
  });
  if (level === 0) {
    b.box([w.x0, w.foot, -w.half + PD], [w.x1, w.top, w.half - PD], "masonry");
    for (const { frame, stones } of sides) for (const { stone, look, faced } of stones) lay(b, frame, stone, look, "masonry", { notch: 0, facet: 0, whole: true, uvOf: (n) => (dot(n, frame.n) > 0.3 ? faced : straight(n)) });
    return b;
  }
  // One block, each plinth stone a cell that wears the stone it wears close to; further off, the picture plain.
  if (level === 1) panel(b, w, { half: w.half, outline, blocks: (front) => sides[front ? 0 : 1]!.stones.map(({ faced, x }) => ({ poly: [[x[0], w.foot], [x[1], w.foot], [x[1], w.top], [x[0], w.top]], mat: "masonry", uv: faced, pillow: 0.16 })) });
  else panel(b, w, { half: w.half, outline, regions: [[above(w.foot), below(w.top)]], cells: plainCells(b) });
  return b;
}

/** A beam's joints at its underside, as shares of half its span from its middle. */
const ARCH_JOINTS = [0.14, 0.4, 0.68] as const;

/** The stones of a flat arch from x0 to x1 between two heights: a keystone, voussoirs whose joints lean to one point `centre` metres under it, and a springer at each end. */
function flatArch(x0: number, x1: number, y0: number, y1: number, joints: readonly number[], centre: number, key: string, gap = 0.004): (Through & { keystone: boolean })[] {
  const g = rng("arch", key);
  const [mid, half] = [(x0 + x1) / 2, (x1 - x0) / 2];
  const lean = (centre + y1 - y0) / centre;
  const at = [...[...joints].reverse().map((f) => -f * half), ...joints.map((f) => f * half)];
  // Each joint's place at the underside and at the top, the ends upright.
  const lines: P2[] = [[x0 - mid, x0 - mid], ...at.map((x): P2 => [x, x * lean]), [x1 - mid, x1 - mid]];
  return lines.slice(1).map((r, i) => {
    const l = lines[i]!;
    const [gl, gr] = [i === 0 ? 0 : gap, i === lines.length - 2 ? 0 : gap];
    const outline: P2[] = [[mid + l[0] + gl, y0], [mid + r[0] - gr, y0], [mid + r[1] - gr, y1], [mid + l[1] + gl, y1]];
    const keystone = i === joints.length;
    return { front: outline, back: outline, keystone, rise: [0, 1, 2, 3].map(() => MD + (keystone ? 0.03 : 0.012) + g.uniform(0, 0.005)) };
  });
}

/**
 * A beam across an edge where a wall's top would be: a flat arch of dressed stone, seven voussoirs with a keystone
 * that stands proud, on a core of mortar.
 */
function archBeam(form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const w = wallBox(form);
  const b = new Build();
  b.free = true;
  b.rings = yieldPlanes(form);
  const [y0, y1] = [w.foot, w.top - GAP];
  const outline: P2[] = [[w.x0, y0], [w.x1, y0], [w.x1, y1], [w.x0, y1]];
  const stones = flatArch(w.x0, w.x1, y0, y1, ARCH_JOINTS, 3.2 * (y1 - y0), "beam");
  if (level === 0) {
    b.box([w.x0 + 0.004, y0 + 0.004, -w.core], [w.x1 - 0.004, y1 - 0.004, w.core], "masonry");
    for (const s of stones) dressedBlock(b, s, w.core, 0.016);
    return b;
  }
  if (level === 3) {
    b.box([w.x0, w.foot, -w.half], [w.x1, w.top, w.half], "dressed");
    return b;
  }
  const dressed = (): readonly [string] => ["dressed"];
  if (level === 1) panel(b, w, { half: w.core + MD + 0.014, outline, rim: dressed, blocks: () => flatArch(w.x0, w.x1, y0, y1, ARCH_JOINTS, 3.2 * (y1 - y0), "beam", 0).map((s) => ({ poly: s.front, mat: "dressed", pillow: 0.2 })) });
  else panel(b, w, { half: w.half, outline, rim: dressed, blocks: () => [{ poly: outline, mat: "dressed" }] });
  return b;
}

/** How deep a gable's raking coping is, measured upright, and how long its footstone is at the low end, where the gable is all one dressed stone. */
const RAKE = 0.15;
const FOOTSTONE = 0.72;

/**
 * The gable under a roof's sloped side: coursed walling under a raking coping of dressed stones, and at its low end
 * one footstone the whole height. Its top is its outline's own, to the last bit. It is built high at its -x end, and
 * the other hand is that one in a mirror.
 */
function gable(form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const w = wallBox(form);
  const b = new Build();
  b.free = true;
  // Built as the left hand: the right hand's rings are the same two, mirrored onto each other.
  b.rings = yieldPlanes(form);
  const right = form.outline.some(([u, v]) => v - form.at[1] > w.foot + 1e-9 && u - form.at[0] > (w.x0 + w.x1) / 2);
  const done = (): Build => {
    if (right) mirror(b.shape, 0);
    return b;
  };
  const slope = (w.top - w.foot) / (w.x1 - w.x0);
  /** The top's height over x, and the walling's under the coping. */
  const top = (x: number): number => w.foot + slope * (w.x1 - x);
  const under = (x: number): number => top(x) - RAKE;
  const tip = w.x1 - RAKE / slope;
  if (level === 3) {
    b.prism([[w.x0, w.foot], [w.x1, w.foot], [w.x0, w.top]], "z", -w.half, w.half, "masonry");
    return done();
  }
  const walling: Region = [[slope, 1, w.foot + slope * w.x1 - RAKE]];
  const foot = Math.min(tip, w.x1 - FOOTSTONE);
  // The coping's stones from the high end down to the footstone, then the footstone.
  const g = rng("rake", "gable");
  const count = Math.max(1, Math.round((foot - w.x0) / 0.75));
  const edges = [w.x0, ...Array.from({ length: count - 1 }, (_, i) => w.x0 + ((foot - w.x0) * (i + 1 + g.uniform(-0.15, 0.15))) / count), foot];
  const stones: Through[] = edges.slice(1).map((x1, i) => {
    const [a, c] = [edges[i]! + (i === 0 ? 0 : 0.004), x1 - 0.004];
    const outline: P2[] = [[a, under(a)], [c, under(c)], [c, top(c)], [a, top(a)]];
    return { front: outline, back: outline, rise: [0, 1, 2, 3].map(() => DRESSED + g.uniform(-0.002, 0.004)) };
  });
  const footstone: P2[] = [[foot, w.foot], [w.x1, w.foot], [foot, top(foot)]];
  if (level === 0) {
    b.prism([[w.x0, w.foot - GAP], [foot, w.foot - GAP], [foot, under(foot)], [w.x0, under(w.x0)]], "z", -w.core, w.core, "masonry");
    layWall(b, w, [[...walling, leftOf(foot - 0.004)]], { facet: FACET, least: LEAST });
    for (const s of stones) dressedBlock(b, s, w.core);
    // The footstone is cut at the ring it crosses: the gable's low end has no other corner there.
    b.convex(block(footstone, footstone, 0.014, footstone.map(() => DRESSED), footstone.map(() => DRESSED), w.core), "dressed", throughUv());
    return done();
  }
  const outline: P2[] = [[w.x0, w.foot], [foot, w.foot], [foot, under(foot)], [w.x0, under(w.x0)]];
  if (level === 1) panel(b, w, { half: w.core + FACE, outline, regions: [[...walling, leftOf(foot)]], cells: (frame) => wallTiles(frame) });
  else panel(b, w, { half: w.half, outline, regions: [[...walling, leftOf(foot)]], cells: plainCells(b) });
  // The coping one dressed stone along the rake, and the footstone.
  for (const [k, profile] of ([[[w.x0, under(w.x0)], [foot, under(foot)], [foot, top(foot)], [w.x0, w.top]], footstone] as const).entries()) b.convex(loft("z", [[-w.core - DRESSED, profile], [w.core + DRESSED, profile]]), "dressed", throughUv(), k === 0);
  return done();
}

/** An opening that stands on the piece's foot: its two sides and its head, about the collider's origin. */
function doorwayOf(name: string, form: FormDef, w: WallBox): { x0: number; x1: number; head: number } {
  const o = form.openings?.[0];
  if (!o || form.openings!.length > 1 || Math.abs(o.y0 - form.at[1] - w.foot) > 1e-9) throw new Error(`stone ${name}: one opening, standing on the piece's foot`);
  return { x0: o.x0 - form.at[0], x1: o.x1 - form.at[0], head: o.y1 - form.at[1] };
}

/** The outline of a wall with a doorway through its foot, going round anticlockwise, and which of its sides are the doorway's two reveals and its head. */
const doorwayOutline = (w: WallBox, d: { x0: number; x1: number; head: number }, top: number): P2[] => [[w.x0, w.foot], [d.x0, w.foot], [d.x0, d.head], [d.x1, d.head], [d.x1, w.foot], [w.x1, w.foot], [w.x1, top], [w.x0, top]];

/** A jamb is long and short work: a flat stone a course high that reaches far into the wall, then an upright one two courses high that does not. */
const JAMB_LONG: P2 = [0.66, 0.8];
const JAMB_SHORT: P2 = [0.28, 0.34];

/**
 * A doorway two edges wide: the wall's own courses, jambs of dressed stones long and short by turns, each a course
 * high, and one oak lintel over the opening that bears a foot on each jamb. The walling is cut against the jambs.
 */
function wideDoorway(name: string, form: FormDef, level: number): Build | null {
  if (level > 4) return null;
  const w = wallBox(form);
  const d = doorwayOf(name, form, w);
  const b = new Build();
  b.free = true;
  if (level === 4) {
    b.box([w.x0, w.foot, -w.half], [w.x1, w.top, w.half], "masonry");
    return b;
  }
  if (level < 3) b.rings = yieldPlanes(form);
  // The courses under the opening's head, from the foot up, each a jamb stone on either side.
  const beds = [...[...BEDS].reverse().map((v) => w.foot + TILE - v).filter((y) => y < d.head - 0.05), d.head];
  const g = rng("wide", name);
  // Each side's stones from the foot: the left begins with a flat one, the right with an upright one.
  const jambs = [-1, 1].flatMap((side) => {
    const out: { side: number; yb: number; yt: number; at: number; rise: number[] }[] = [];
    for (let m = 0, long = side < 0; m + 1 < beds.length; long = !long) {
      const high = long || m + 2 >= beds.length ? 1 : 2;
      const reach = g.uniform(...(long ? JAMB_LONG : JAMB_SHORT));
      out.push({ side, yb: beds[m]!, yt: beds[m + high]!, at: side < 0 ? d.x0 - reach : d.x1 + reach, rise: [0, 1, 2, 3].map(() => DRESSED + g.uniform(0, 0.008)) });
      m += high;
    }
    return out;
  });
  const jambBox = (j: (typeof jambs)[number], joint = 0): P2[] => (j.side < 0 ? [[j.at + joint, j.yb], [d.x0, j.yb], [d.x0, j.yt], [j.at + joint, j.yt]] : [[d.x1, j.yb], [j.at - joint, j.yb], [j.at - joint, j.yt], [d.x1, j.yt]]);
  // The lintel lies in the course over the head where the head is a bed, and is a third of a metre deep where it is not.
  const over = [...BEDS].map((v) => w.foot + TILE - v).filter((y) => y > d.head + 0.2 && y < d.head + 0.5).pop() ?? Math.min(d.head + 0.34, w.top - 0.1);
  const [ll, lr] = [Math.max(w.x0 + 0.2, d.x0 - 0.6), Math.min(w.x1 - 0.2, d.x1 + 0.6)];
  const joint = level === 0 ? 0.008 : 0;
  const top = level === 3 ? w.top : w.top - GAP;
  const regions: Region[] = [[above(over), below(top)], [above(d.head), below(over), leftOf(ll - joint)], [above(d.head), below(over), rightOf(lr + joint)], ...jambs.map((j): Region => [above(j.yb), below(j.yt), j.side < 0 ? leftOf(j.at) : rightOf(j.at)])];
  const outline = doorwayOutline(w, d, top);
  const rim = (k: number): readonly [string, string?] => (k === 1 || k === 3 ? ["dressed"] : k === 2 ? ["timber", "x"] : ["masonry"]);
  const lintel = (): Through => {
    const high = over - 0.008;
    const outline: P2[] = [[ll + 0.008, d.head], [lr - 0.008, d.head], [lr - 0.008, high], [ll + 0.008, high - 0.005]];
    return { front: outline, back: outline, rise: [0.004, 0.006, 0, -0.003].map((r) => MD + 0.022 + r) };
  };
  if (level === 0) {
    b.box([w.x0, w.foot - GAP, -w.core], [d.x0 - 0.01, w.top - GAP, w.core], "masonry");
    b.box([d.x1 + 0.01, w.foot - GAP, -w.core], [w.x1, w.top - GAP, w.core], "masonry");
    b.box([d.x0 - 0.02, over - 0.015, -w.core], [d.x1 + 0.02, w.top - GAP, w.core], "masonry");
    layWall(b, w, regions, { risen: true, least: LEAST });
    // Plain blocks shaded round: eight jamb stones with their arrises cut are 130 triangles the walling needs.
    for (const j of jambs) pillowBlock(b, { front: jambBox(j, 0.006), back: jambBox(j, 0.006), rise: j.rise }, w.core);
    pillowBlock(b, lintel(), w.core, "timber", 0.1, "x");
    // The worn threshold stone between the jambs.
    b.box([d.x0, w.foot - GAP, -w.half], [d.x1, w.foot + 0.02, w.half], "dressed");
    return b;
  }
  if (level === 3) {
    // Flat: the two piers and the head, and the lintel's colour over the opening.
    const cells: PanelCell[] = [
      { poly: [[w.x0, w.foot], [d.x0, w.foot], [d.x0, d.head], [d.x0, over], [w.x0, top]], mat: "masonry" }, { poly: [[d.x1, w.foot], [w.x1, w.foot], [w.x1, top], [d.x1, over], [d.x1, d.head]], mat: "masonry" },
      { poly: [[d.x0, d.head], [d.x1, d.head], [d.x1, over], [d.x0, over]], mat: "timber" }, { poly: [[d.x0, over], [d.x1, over], [w.x1, top], [w.x0, top]], mat: "masonry" },
    ];
    panel(b, w, { half: w.half, outline, rim, blocks: () => cells });
    return b;
  }
  const lintelCell: PanelCell = { poly: [[ll, d.head], [lr, d.head], [lr, over], [ll, over]], mat: "timber" };
  if (level === 1) {
    panel(b, w, {
      half: w.core + FACE, outline, rim, regions, cells: coarseTiles,
      blocks: () => [...jambs.map((j): PanelCell => ({ poly: jambBox(j), mat: "dressed", pillow: 0.2 })), lintelCell],
    });
    throughBlock(b, lintel(), "timber", "x", w.core);
    return b;
  }
  // The jambs a column each side, as wide as the jamb stones are on average.
  const wide = jambs.reduce((sum, j) => sum + Math.abs(j.at - (j.side < 0 ? d.x0 : d.x1)) * (j.yt - j.yb), 0) / (2 * (d.head - w.foot));
  panel(b, w, {
    half: w.half, outline, rim, cells: plainCells(b),
    regions: [[above(over), below(top)], [above(d.head), below(over), leftOf(ll)], [above(d.head), below(over), rightOf(lr)], [below(d.head), leftOf(d.x0 - wide)], [below(d.head), rightOf(d.x1 + wide)]],
    blocks: () => [lintelCell, { poly: [[d.x0 - wide, w.foot], [d.x0, w.foot], [d.x0, d.head], [d.x0 - wide, d.head]], mat: "dressed" }, { poly: [[d.x1, w.foot], [d.x1 + wide, w.foot], [d.x1 + wide, d.head], [d.x1, d.head]], mat: "dressed" }],
  });
  return b;
}

/**
 * A wall several storeys high in one piece: the wall's pattern storey on storey, under a dressed coping. Close to, each
 * face is one sheet whose stones are cells shaded as the stones they are, as a wall is from 19 m: every stone a solid
 * is four walls' triangles in one piece. From 19 m its courses are cells, shaded round at their beds.
 */
function tallWall(name: string, form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const w = wallBox(form);
  const b = new Build();
  b.free = true;
  if (level === 3) {
    b.box([w.x0, w.foot, -w.half], [w.x1, w.top, w.half], "masonry");
    return b;
  }
  b.rings = yieldPlanes(form);
  const under = w.top - COPING;
  const outline: P2[] = [[w.x0, w.foot], [w.x1, w.foot], [w.x1, under], [w.x0, under]];
  if (level === 0) {
    panel(b, w, { half: w.core + FACE, outline, regions: [[below(under)]], cells: coarseTiles });
    for (const s of copingStones(w, name)) dressedBlock(b, s, w.core);
    return b;
  }
  if (level === 1) {
    const strips = plainCells(b);
    // A course's normals lean up at its upper bed and down at its lower.
    const courses = (frame: Frame): Tile[] => strips(frame).flatMap((strip) => BEDS.slice(1).map((v1, k): Tile => {
      const v0 = BEDS[k]!;
      return { poly: cell(strip.poly[0]![0], strip.poly[1]![0], v0, v1), mat: "masonry", field: (_, v) => unit(add(frame.n, scale(frame.v, 0.5 * ((v - v0) / (v1 - v0) - 0.5)))) };
    }));
    panel(b, w, { half: w.core + FACE, outline, regions: [[below(under)]], cells: courses });
  } else panel(b, w, { half: w.half, outline, regions: [[below(under)]], cells: plainCells(b) });
  b.box([w.x0, under, -w.core - DRESSED], [w.x1, w.top - GAP, w.core + DRESSED], "dressed", undefined, [0, 0], true);
  return b;
}

/** Where a gate's three strap hinges are, between its foot and its top: its gateway has a pintle at each. */
const hingesOf = (foot: number, top: number): number[] => [foot + 0.47, (foot + top) / 2, top - 0.47];
/** A gateway's pier is dressed blocks tall and short by turns, about this high a pair. */
const PIER_PAIR = 0.875;

/**
 * A gateway two edges wide and two storeys high: two piers of dressed blocks, tall and proud by turns with short ones
 * that stand back, and over the opening a flat arch whose voussoirs lean to one point far under it, with a keystone.
 * Nothing stands in its opening, which its gate fills. From 386 m it is a flat frame seen from both faces.
 */
function gatehouse(name: string, form: FormDef, level: number): Build | null {
  if (level > 4) return null;
  const w = wallBox(form);
  const d = doorwayOf(name, form, w);
  const b = new Build();
  b.free = true;
  if (level === 4) {
    // Twelve triangles cannot close a frame, and a box would shut the opening.
    const points = doorwayOutline(w, d, w.top).map(([x, y]): Vec => [x, 0, y]);
    const tris = [0, 1, 2, 0, 2, 7, 2, 3, 7, 3, 6, 7, 3, 5, 6, 3, 4, 5];
    for (const front of [true, false]) b.shape.faces.push({ points, uvs: points.map(() => [0, 0] as const), mat: "dressed", tris: front ? tris.flatMap((_, i) => (i % 3 === 0 ? [tris[i]!, tris[i + 2]!, tris[i + 1]!] : [])) : tris });
    b.shape.error = w.half;
    return b;
  }
  if (level < 3) b.rings = yieldPlanes(form);
  const top = level === 3 ? w.top : w.top - GAP;
  const outline = doorwayOutline(w, d, top);
  const dressed = (): readonly [string] => ["dressed"];
  const g = rng("gateway", name);
  // Each pier's courses from the foot to the opening's head.
  const pairs = Math.max(1, Math.round((d.head - w.foot) / PIER_PAIR));
  const scaleY = (d.head - w.foot) / (pairs * PIER_PAIR);
  const beds = Array.from({ length: 2 * pairs + 1 }, (_, i) => w.foot + (Math.floor(i / 2) * PIER_PAIR + (i % 2) * 0.5) * scaleY);
  const bed = level === 0 ? 0.003 : 0;
  const blocks = ([[w.x0, d.x0], [d.x1, w.x1]] as const).flatMap(([x0, x1], side) => beds.slice(1).map((yt, i) => {
    const tall = i % 2 === 0;
    const o: P2[] = [[x0, beds[i]! + bed], [x1, beds[i]! + bed], [x1, yt - bed], [x0, yt - bed]];
    return { front: o, back: o, tall, side, rise: [0, 1, 2, 3].map(() => (tall ? DRESSED + 0.008 : MD + 0.01) + g.uniform(0, 0.004)) };
  }));
  // The arch's joints at its underside: the springers end on the piers' inner faces.
  const half = (w.x1 - w.x0) / 2;
  const span = (d.x1 - d.x0) / 2 / half;
  const arch = flatArch(w.x0, w.x1, d.head, top, [0.085 * span, 0.3 * span, 0.53 * span, 0.765 * span, span], 5.6, name, level === 0 ? 0.004 : 0);
  if (level === 0) {
    for (const [x0, x1] of [[w.x0 + 0.004, d.x0 - 0.004], [d.x1 + 0.004, w.x1 - 0.004]] as const) b.box([x0, w.foot - GAP, -w.core], [x1, d.head, w.core], "masonry");
    b.box([w.x0 + 0.004, d.head + 0.004, -w.core], [w.x1 - 0.004, top - 0.004, w.core], "masonry");
    for (const s of blocks) dressedBlock(b, s, w.core, s.tall ? 0.022 : 0.014);
    for (const s of arch) dressedBlock(b, s, w.core, 0.02);
    // The pintles the gate hangs on, in front of its leaves.
    for (const y of hingesOf(w.foot + 0.02, d.head - 0.015)) for (const [x0, x1] of [[d.x0, d.x0 + 0.045], [d.x1 - 0.045, d.x1]] as const) b.box([x0, y - 0.07, 0.1], [x1, y + 0.07, 0.15], "iron");
    return b;
  }
  if (level === 1) {
    panel(b, w, { half: w.core + DRESSED, outline, rim: dressed, blocks: () => [...blocks, ...arch].map((s) => ({ poly: s.front, mat: "dressed", pillow: 0.22 })) });
    return b;
  }
  const band: P2[] = [[w.x0, d.head], [d.x0, d.head], [d.x1, d.head], [w.x1, d.head], [w.x1, top], [w.x0, top]];
  panel(b, w, { half: w.half, outline, rim: dressed, blocks: () => [{ poly: [[w.x0, w.foot], [d.x0, w.foot], [d.x0, d.head], [w.x0, d.head]], mat: "dressed" }, { poly: [[d.x1, w.foot], [w.x1, w.foot], [w.x1, d.head], [d.x1, d.head]], mat: "dressed" }, { poly: band, mat: "dressed" }] });
  return b;
}

/**
 * A gate of two leaves that meet in the middle: oak planks on three ledges and two braces a leaf, hung on long iron
 * strap hinges riveted through, and barred across the back in iron brackets. The front is +z. Open, each leaf is
 * turned a quarter on its own pier, as an open door is, and the bar is lifted out. From 386 m an open gate is a sheet
 * to a leaf, seen from both sides.
 */
function gate(form: FormDef, level: number): Build | null {
  const open = form.plane === "across";
  if (level > (open ? 4 : 3)) return null;
  const b = new Build();
  b.free = true;
  // The open row is one leaf across the edge, with its pair: the gate is two of its width, about its pair's middle.
  const [u0, , u1] = outlineBox(form);
  const w = open ? { ...wallBox(form), x0: -(u1 - u0), x1: u1 - u0 } : wallBox(form);
  if (open) {
    // A quarter turn on the line the shut row's box turns into the open one's on; the right leaf in a mirror.
    const [off, hx] = [(form.off ?? 0) - form.at[0], u1 - u0];
    b.turn = ([x, y, z]) => (x < 0 ? [off - z, y, x + hx] : [z - off, y, hx - x]);
  }
  if (level === 4) {
    b.turn = null;
    const x = (form.off ?? 0) - form.at[0];
    for (const s of [-1, 1]) for (const out of [-1, 1]) b.flat([[s * x, w.foot, 0], [s * x, w.foot, w.x1], [s * x, w.top, w.x1], [s * x, w.top, 0]], [out, 0, 0], "timber");
    return b;
  }
  if (level === 3) {
    if (!open) b.box([w.x0, w.foot, -w.half], [w.x1, w.top, w.half], "timber", "y");
    else for (const [x0, x1] of [[w.x0, -0.006], [0.006, w.x1]] as const) b.box([x0, w.foot, -w.half], [x1, w.top, w.half], "timber", "y");
    return b;
  }
  const [foot, top] = [w.foot + 0.02, w.top - 0.015];
  const mid = (w.x0 + w.x1) / 2;
  // Through its thickness: the bar, the ledges, the planks, the straps.
  const [barZ, backZ, faceZ, ironZ] = [-w.half, -w.half + 0.05, w.half - 0.08, w.half - 0.015];
  const hinges = hingesOf(foot, top);
  const leaves = gateLeaves((w.x1 - w.x0) / 2 - 0.012, foot, top, 2, 0.28, 3, 0.47, 0.012);
  leaves.forEach((leaf, n) => {
    const [x0, x1] = [mid + leaf.x0, mid + leaf.x1];
    const near = leaf.hinge < 0 ? x0 : x1;
    if (level === 0) {
      leaf.boards.forEach(([a0, a1], k) => {
        const g = rng("gate plank", n, k);
        const [a, c] = [mid + a0 + 0.002, mid + a1 - 0.002];
        const fz = ironZ - g.uniform(0, 0.005);
        const cp = g.uniform(0.006, 0.01);
        const profile: P2[] = [[a, faceZ], [c, faceZ], [c, fz - cp], [c - cp, fz], [a + cp, fz], [a, fz - cp]];
        const [lo, hi] = [foot + g.uniform(0, 0.012), top - g.uniform(0, 0.01)];
        b.convex(loft("y", [[lo, profile], [hi, profile]]), "timber", (nrm) => straight(nrm, "y", [((k * 0.31 + n * 0.17) % 0.5) - 0.25, ((k * 0.17) % 0.4) - 0.2]));
      });
    } else b.box([x0, foot, faceZ], [x1, top, ironZ], "timber", "y");
    hinges.forEach((yc) => {
      // A strap hinge across the leaf: square at the hinge, narrowing to a spear point short of the meeting edge.
      const at = (t: number): number => near - leaf.hinge * t * (x1 - x0);
      const section = (h: number): P2[] => [[ironZ - 0.004, yc - h], [w.half, yc - h], [w.half, yc + h], [ironZ - 0.004, yc + h]];
      if (level === 2) b.box([Math.min(at(0.004), at(0.8)), yc - 0.05, ironZ], [Math.max(at(0.004), at(0.8)), yc + 0.05, w.half], "iron", "x");
      else b.convex(loft("x", [[at(0.002), section(0.055)], [at(0.66), section(0.05)], [at(0.84), section(0.006)]]), "iron", (nrm) => straight(nrm, "x"));
      if (level === 2) return;
      // The ledge behind it.
      b.box([x0 + 0.05, yc - 0.1, backZ], [x1 - 0.05, yc + 0.1, faceZ], "timber", "x");
      if (level > 0) return;
      for (const t of [0.12, 0.34, 0.56]) {
        const xc = at(t);
        const base: Vec[] = [[xc - 0.018, yc - 0.018, w.half], [xc + 0.018, yc - 0.018, w.half], [xc + 0.018, yc + 0.018, w.half], [xc - 0.018, yc + 0.018, w.half]];
        b.convex([{ pts: base }, ...base.map((q, k) => ({ pts: [q, base[(k + 1) % 4]!, [xc, yc, w.half + 0.012] as Vec] }))], "iron", (nrm) => straight(nrm));
      }
      // The knuckle the strap is forged round, on the pintle in the pier.
      const knuckle = Array.from({ length: 6 }, (_, k): P2 => [near + 0.022 * Math.cos((k * Math.PI) / 3), w.half + 0.022 * Math.sin((k * Math.PI) / 3) - 0.004]);
      b.convex(loft("y", [[yc - 0.07, knuckle], [yc + 0.07, knuckle]]), "iron", (nrm) => straight(nrm));
    });
    if (level === 2) return;
    // A brace between each two ledges, rising from the hinge side.
    for (let i = 0; i + 1 < hinges.length; i++) {
      const [from, to]: [P2, P2] = [[near - leaf.hinge * 0.25, hinges[i]! + 0.1], [near - leaf.hinge * (x1 - x0 - 0.25), hinges[i + 1]! - 0.1]];
      const l = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const dir: P2 = [(to[0] - from[0]) / l, (to[1] - from[1]) / l];
      const across: P2 = [-dir[1], dir[0]];
      const corners: P2[] = [...[-0.07, 0.07].map((k) => [from[0] + across[0] * k, from[1] + across[1] * k] as const), ...[0.07, -0.07].map((k) => [to[0] + across[0] * k, to[1] + across[1] * k] as const)];
      const grain: UvMap = (q) => [(q[0] * dir[0] + q[1] * dir[1]) / TILE + 0.5, (q[0] * across[0] + q[1] * across[1]) / TILE + 0.3];
      b.convex(loft("z", [[backZ + 0.004, corners], [faceZ, corners]]), "timber", (nrm) => (Math.abs(nrm[2]) > 0.5 ? grain : straight(nrm)));
    }
  });
  if (level === 2) return b;
  // The bar across the back of both leaves, in an iron bracket on each. It is lifted out to open the gate.
  const y = foot + 1.3;
  const reach = (w.x1 - w.x0) / 2 - 0.5;
  if (!open) b.box([mid - reach, y - 0.08, barZ + 0.006], [mid + reach, y + 0.08, backZ - 0.004], "timber", "x");
  if (level === 0) for (const x of [-reach * 0.6, reach * 0.6]) b.box([mid + x - 0.05, y - 0.11, barZ], [mid + x + 0.05, y + 0.1, backZ], "iron");
  return b;
}

// Floors on any outline: the floor's flags cut to the piece, and a plinth of battered stones between corner blocks.

/** A flat form's outline about its collider's origin, as (x, z). */
const planXZ = (form: FormDef): P2[] => form.outline.map(([u, v]): P2 => [u - form.at[0], v - form.at[2]]);
/** A convex outline's sides for clip2, each moved in by `by`. */
const sidesIn = (poly: readonly P2[], by: number): Half2[] => sidesOf(poly).map(([a, c, d]) => [a, c, d - by * Math.hypot(a, c)] as const);
/** Sides given in the piece's (x, z) as sides on a level frame whose u is x and v is z. */
const onLevel = (frame: Frame, sides: readonly Half2[]): Half2[] => sides.map(([a, c, d]) => [a, c, d - a * frame.o[0] - c * frame.o[2]] as const);
const middle2 = (poly: readonly P2[]): P2 => [poly.reduce((sum, q) => sum + q[0], 0) / poly.length, poly.reduce((sum, q) => sum + q[1], 0) / poly.length];

/** The frame the floor's flags are laid on over an outline: the pattern from the outline's least corner, and from its middle row for a piece half a side across. */
function flagFrame(plan: readonly P2[], bed: number): Frame {
  const [x0, , z0, z1] = box2(plan);
  return new Frame([x0, bed, z1 - z0 < H + 1e-6 ? z0 - H : z0], [1, 0, 0], [0, 0, 1], [0, 1, 0]);
}

/**
 * The floor's flags on a frame, each cut to every region it reaches and to `planes`: a flag at the piece's edge is a
 * cut flag, and the picture runs on to the cut. `tilesV` lays the pattern again past its far edge.
 */
function layFlags(b: Build, frame: Frame, regions: readonly (readonly Half2[])[], planes: readonly Plane[] = [], whole: readonly P2[] = WHOLE, tilesV = 1): void {
  for (let j = 0; j < tilesV; j++) {
    const at = new Frame(frame.at(0, j * TILE), frame.u, frame.v, frame.n);
    for (const s of flagStones()) {
      const r = rng("flag rise", s.name);
      const rise = r.uniform(0.009, 0.012);
      const look: Look = { rise: [0, 1, 2, 3].map(() => rise - r.uniform(0, 0.0015)), bevel: [0, 1, 2, 3].map(() => r.uniform(FLAG_BEVEL[0], FLAG_BEVEL[1])), crown: 0, at: [0.5, 0.5] };
      const [base, face] = whole === WHOLE ? [WHOLE, WHOLE] : breaksOf(s, FLAG_NOTCH, FLAG_NOTCH);
      for (const region of regions) {
        let sides = stoneSides(at, s.footprint, base, face, look);
        for (const plane of [...planesOn(at, region.map(([a, c, d]) => [a, c, d - c * j * TILE] as const)), ...planes]) sides = clipSolid(sides, plane);
        // The footprint is the first face: a remnant a hand across is not laid.
        if (sides.length >= 4 && Math.abs(area2(sides[0]!.pts.map((q) => at.on(q)))) > 0.006) b.convex(sides, "flags", on(at), true);
      }
    }
  }
}

/** A corner block of a plinth: its outline at its foot and its head, how far it reaches along each of its two sides, and the stone each outer face wears. */
interface PlinthCorner {
  foot: P2[];
  head: P2[];
  y1: number;
  /** Along the side that leaves the corner, and along the one that comes to it. */
  reach: [number, number];
  uvOf: (n: Vec) => UvMap;
}

/** A plinth round a convex outline: a block at each corner, a little proud and battered, and stones between them on each side. */
function plinthRound(plan: readonly P2[], bottomY: number, bed: number, key: string): { corners: PlinthCorner[]; sides: PlinthSide2[] } {
  const n = plan.length;
  const mid = middle2(plan);
  const dir = (a: P2, c: P2): P2 => {
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    return [(c[0] - a[0]) / l, (c[1] - a[1]) / l];
  };
  /** The way out of the outline across the side from corner k. */
  const outOf = (k: number): P2 => {
    const [a, c] = [plan[k]!, plan[(k + 1) % n]!];
    const d = dir(a, c);
    const o: P2 = [d[1], -d[0]];
    return (a[0] - mid[0]) * o[0] + (a[1] - mid[1]) * o[1] > 0 ? o : [-o[0], -o[1]];
  };
  const corners = plan.map((c, k): PlinthCorner => {
    const g = rng("corner", key, k);
    const [next, prev] = [plan[(k + 1) % n]!, plan[(k + n - 1) % n]!];
    const [dn, dp] = [dir(c, next), dir(c, prev)];
    // No longer than a third of its side.
    const long = (to: P2): number => Math.min(g.uniform(0.44, 0.62), Math.hypot(to[0] - c[0], to[1] - c[1]) * 0.3);
    const [a, e, proud, cut] = [long(next), long(prev), g.uniform(0.004, 0.014), g.uniform(0.015, 0.03)];
    const y1 = bed - g.uniform(0.003, 0.008);
    const [on, op] = [outOf(k), outOf((k + n - 1) % n)];
    const deep = 0.16;
    // The corner, along each side, and in from each: its inner ends are square to the faces the next stones lie on.
    const ring = (by: number): P2[] => {
      const at = (along: P2, t: number, out: P2, w: number): P2 => [c[0] + along[0] * t + out[0] * w, c[1] + along[1] * t + out[1] * w];
      return [at(dn, cut, on, by), at(dn, a, on, by), at(dn, a, on, -deep), at(dp, e, op, -deep), at(dp, e, op, by), at(dp, cut, op, by)];
    };
    const [foot, head] = [ring(proud + 0.014), ring(proud - 0.004)];
    const origin: Vec = [c[0], y1, c[1]];
    const faces: Faced = [on, op].map((o) => {
      const [nrm, ua]: [Vec, Vec] = [[o[0], 0, o[1]], [o[1], 0, -o[0]]];
      const proj = [...foot, ...head].map(([px, pz]) => (px - origin[0]) * ua[0] + (pz - origin[2]) * ua[2]);
      return [nrm, ua, [0, -1, 0] as Vec, [...span(proj), 0, y1 - bottomY]] as const;
    });
    return { foot, head, y1, reach: [a, e], uvOf: stoneFaced(origin, faces, ["corner", key, k]) };
  });
  const sides = plan.map((c, k): PlinthSide2 => {
    const next = plan[(k + 1) % n]!;
    const o = outOf(k);
    const [nrm, ua]: [Vec, Vec] = [[o[0], 0, o[1]], [o[1], 0, -o[0]]];
    // The side's left end as it is seen from outside.
    const first = (next[0] - c[0]) * ua[0] + (next[1] - c[1]) * ua[2] > 0;
    const [e0, start, end] = first ? [c, corners[k]!.reach[0], corners[(k + 1) % n]!.reach[1]] : [next, corners[(k + 1) % n]!.reach[1], corners[k]!.reach[0]];
    const length = Math.hypot(next[0] - c[0], next[1] - c[1]);
    const frame = new Frame([e0[0] - o[0] * PD, bed, e0[1] - o[1] * PD], ua, [0, -1, 0], nrm, [0, 0.1 + 0.2 * k]);
    const g = rng("plinth", key, k);
    const count = Math.max(1, Math.round((length - start - end) / 0.72));
    const cuts = [start, ...Array.from({ length: count - 1 }, (_, i) => start + ((length - start - end) * (i + 1 + g.uniform(-0.15, 0.15))) / count), length - end];
    const stones = cuts.slice(1).map((u, i): PlinthStone => {
      const stone = shaped({ course: 0, name: `plinth ${key} ${k} ${i}`, quad: cell(cuts[i]!, u, 0, bed - bottomY) }, [0.004, 0.012], [0.012, 0.045], [0.04, 0.07], 0.25);
      const r = rng("plinth face", key, k, i);
      const out = PD + r.uniform(-0.004, 0.008);
      const look: Look = { rise: [out - 0.006, out - 0.006 + r.uniform(-0.003, 0.003), out + 0.014, out + 0.014 + r.uniform(-0.003, 0.003)], bevel: [0, 1, 2, 3].map(() => r.uniform(0.016, 0.03)), crown: r.uniform(0.004, 0.01), at: [r.uniform(0.4, 0.6), r.uniform(0.4, 0.6)] };
      return { stone, look, faced: ontoStone(frame.o, frame.u, frame.v, box2(stone.outline), ["plinth", key, k, i]) };
    });
    return { frame, length, cuts, stones, ends: first ? [corners[k]!, corners[(k + 1) % n]!] : [corners[(k + 1) % n]!, corners[k]!] };
  });
  return { corners, sides };
}

interface PlinthSide2 {
  frame: Frame;
  length: number;
  cuts: number[];
  stones: PlinthStone[];
  ends: [PlinthCorner, PlinthCorner];
}

/**
 * A foundation on any convex outline: a triangle's, or a quarter's. Flags cut to the outline on a core of rubble, in a
 * plinth of battered stones between corner blocks, as a square's is.
 */
function plinthed(name: string, form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const b = new Build();
  b.free = true;
  const plan = planXZ(form);
  const [topY, bottomY] = [form.thick / 2, -form.thick / 2];
  const flagsOn = flagFrame(plan, topY);
  const at = (y: number) => (q: P2): Vec => [q[0], y, q[1]];
  if (level >= 2) {
    b.convex(loft("y", [[bottomY, plan], [topY, plan]]), flagged, (n) => (n[1] > 0.5 ? flagsOn.uv : straight(n)));
    return b;
  }
  const bed = topY - 0.012;
  const { corners, sides } = plinthRound(plan, bottomY, bed, name);
  if (level === 1) {
    // One block: its top the flags' picture, and round it each corner block and plinth stone a cell.
    const from = b.shape.faces.length;
    b.flat(plan.map(at(topY)), [0, 1, 0], "flags", flagsOn.uv);
    b.flat(plan.map(at(bottomY)), [0, -1, 0], "masonry");
    for (const { frame, length, cuts, stones, ends } of sides) {
      const depth = topY - bottomY;
      const flush = new Frame(add(frame.at(0, bed - topY), scale(frame.n, PD)), frame.u, frame.v, frame.n);
      const cells: Tile[] = [
        { poly: cell(0, cuts[0]!, 0, depth), mat: "masonry", uv: ends[0].uvOf(frame.n) },
        ...stones.map(({ faced }, i): Tile => ({ poly: cell(cuts[i]!, cuts[i + 1]!, 0, depth), mat: "masonry", uv: faced })),
        { poly: cell(cuts[cuts.length - 1]!, length, 0, depth), mat: "masonry", uv: ends[1].uvOf(frame.n) },
      ];
      tiles(b, flush, cells, [within2(0, length, 0, depth)]);
    }
    b.shape.weld(from);
    return b;
  }
  const core = shrink(plan, PD);
  b.convex(loft("y", [[bottomY, core], [bed, core]]), flagged, (n) => straight(n));
  // The bed raised to a wall's foot inside each side, as a square's is.
  const inner = shrink(plan, WALL_BAND);
  core.forEach((a, k) => {
    const j = (k + 1) % core.length;
    const strip = [a, core[j]!, inner[j]!, inner[k]!];
    b.convex(loft("y", [[bed, strip], [topY - GAP, strip]]), flagged, (n) => straight(n));
  });
  layFlags(b, new Frame(flagsOn.at(0, 0, bed - topY), flagsOn.u, flagsOn.v, flagsOn.n), [onLevel(flagsOn, sidesIn(plan, 0.005))], [], []);
  const ch = 0.014;
  for (const c of corners) b.convex(loft("y", [[bottomY, shrink(c.foot, ch)], [bottomY + ch, c.foot], [c.y1 - ch, c.head], [c.y1, shrink(c.head, ch)]]), "masonry", c.uvOf);
  for (const { frame, stones } of sides) {
    for (const { stone, look, faced } of stones) lay(b, frame, stone, look, "masonry", { notch: 0, facet: 0, uvOf: (n) => (dot(n, frame.n) > 0.3 ? faced : straight(n)) });
  }
  return b;
}

/** A straight oak member between two points of a floor's underside, `wide` across and from `low` up to `high`, its ends cut on the upright planes through `ends`, each a point and the way out past it. */
function joist(b: Build, from: P2, to: P2, wide: number, low: number, high: number, key: string, ends: readonly (readonly [P2, P2])[] = []): void {
  const g = rng("joist", key);
  const l = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const d: P2 = [(to[0] - from[0]) / l, (to[1] - from[1]) / l];
  const across: P2 = [-d[1], d[0]];
  // A little out of true, as a hewn beam is, and not the same at both ends.
  const section = (t: number): Vec[] => {
    const [a, c, under, cut] = [-wide / 2 + g.uniform(-0.005, 0.005), wide / 2 + g.uniform(-0.005, 0.005), low + g.uniform(-0.004, 0.004), g.uniform(0.012, 0.024)];
    return ([[a, high], [a, under + cut], [a + cut, under], [c - cut, under], [c, under + cut], [c, high]] as const).map(([w, y]): Vec => [from[0] + d[0] * t + across[0] * w, y, from[1] + d[1] * t + across[1] * w]);
  };
  // Built long and cut to its ends.
  const rings = [section(-0.5), section(l + 0.5)];
  let sides: Side[] = [{ pts: rings[0]! }, { pts: rings[1]! }, ...rings[0]!.map((q, i) => ({ pts: [q, rings[0]![(i + 1) % 6]!, rings[1]![(i + 1) % 6]!, rings[1]![i]!] }))];
  const planes: Plane[] = ends.length > 0 ? ends.map(([at, out]) => [[at[0], 0, at[1]], [out[0], 0, out[1]]] as const) : [[[from[0], 0, from[1]], [-d[0], 0, -d[1]]], [[to[0], 0, to[1]], [d[0], 0, d[1]]]];
  for (const plane of planes) sides = clipSolid(sides, plane);
  // Twice as far up as across: on neither of its cut arrises does the picture run to a line.
  const grain: UvMap = (q) => [(q[0] * d[0] + q[2] * d[1]) / TILE + 0.5, (q[0] * across[0] + q[2] * across[1] + 2 * q[1]) / TILE + 0.5];
  b.convex(sides, "timber", () => grain);
}

/**
 * A triangle of ceiling: flags cut to the triangle on a slab, an oak beam inside each side, mitred at the corners,
 * three joists from the middle to the sides' middles, and rough stone in the three bays between them.
 */
function triCeiling(name: string, form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const b = new Build();
  b.free = true;
  const plan = planXZ(form);
  const [topY, bottomY] = [form.thick / 2, -form.thick / 2];
  const soffit = -0.005;
  const flagsOn = flagFrame(plan, topY);
  const at = (y: number) => (q: P2): Vec => [q[0], y, q[1]];
  const mid = middle2(plan);
  const n = plan.length;
  if (level === 3) {
    b.convex(loft("y", [[bottomY, plan], [topY, plan]]), flagged, (nrm) => straight(nrm));
    return b;
  }
  const side = (y0: number, y1: number, mat: string): void => plan.forEach((a, k) => {
    const c = plan[(k + 1) % n]!;
    const out: Vec = unit([-(c[1] - a[1]), 0, c[0] - a[0]]);
    const way = dot(out, [(a[0] + c[0]) / 2 - mid[0], 0, (a[1] + c[1]) / 2 - mid[1]]) > 0 ? out : scale(out, -1);
    b.flat([[a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]]], way, mat, straight(way, mat === "timber" ? (Math.abs(way[2]) > Math.abs(way[0]) ? "x" : "z") : undefined));
  });
  if (level === 2) {
    // One block as deep as the slab and its beams, the beams' timber round the lower half of its edge.
    b.flat(plan.map(at(topY)), [0, 1, 0], "flags", flagsOn.uv);
    b.flat(plan.map(at(bottomY)), [0, -1, 0], "masonry");
    side(soffit, topY, "masonry");
    side(bottomY, soffit, "timber");
    return b;
  }
  const rim = 0.08;
  const inner = shrink(plan, rim);
  /** The three bays under the slab, each from the middle out to a corner between two joists. */
  const half = (a: P2, c: P2): P2 => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
  const bays = plan.map((_, k): P2[] => [mid, half(inner[(k + n - 1) % n]!, inner[k]!), inner[k]!, half(inner[k]!, inner[(k + 1) % n]!)]);
  const bayUv = (k: number, y: number): UvMap => {
    const [u0, u1, v0, v1] = box2(bays[k]!);
    return ontoStone([0, y, 0], [1, 0, 0], [0, 0, -1], [u0, u1, -v1, -v0], ["tri bay", name, k]);
  };
  if (level === 1) {
    const from = b.shape.faces.length;
    b.flat(plan.map(at(topY)), [0, 1, 0], "flags", flagsOn.uv);
    side(soffit, topY, "masonry");
    // The underside: the three bays, and a strip under each rim beam.
    bays.forEach((bay, k) => b.flat(bay.map(at(soffit)), [0, -1, 0], "masonry", bayUv(k, soffit)));
    plan.forEach((a, k) => {
      const j = (k + 1) % n;
      b.flat([a, plan[j]!, inner[j]!, inner[k]!].map(at(soffit)), [0, -1, 0], "masonry");
    });
    b.shape.weld(from);
  } else {
    b.convex(loft("y", [[soffit, plan], [topY - 0.012, plan]]), flagged, (nrm) => straight(nrm));
    layFlags(b, new Frame(flagsOn.at(0, 0, -0.012), flagsOn.u, flagsOn.v, flagsOn.n), [onLevel(flagsOn, sidesIn(plan, 0.004))], [], []);
    bays.forEach((bay, k) => {
      const drop = rng("tri bay", name, k).uniform(0.006, 0.014);
      const faced = bayUv(k, soffit - drop);
      b.convex(loft("y", [[soffit - drop, shrink(bay, 0.05)], [soffit + 0.003, shrink(bay, 0.05)]]), "masonry", (nrm) => (nrm[1] < -0.5 ? faced : straight(nrm)));
    });
  }
  // A beam inside each side, its ends mitred on the lines to the corners, and a joist from the middle to each side's.
  plan.forEach((a, k) => {
    const c = plan[(k + 1) % n]!;
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const d: P2 = [(c[0] - a[0]) / l, (c[1] - a[1]) / l];
    const inward: P2 = (mid[0] - a[0]) * -d[1] + (mid[1] - a[1]) * d[0] > 0 ? [-d[1], d[0]] : [d[1], -d[0]];
    const line = (q: P2): P2 => [q[0] + inward[0] * rim * 0.5, q[1] + inward[1] * rim * 0.5];
    // Past a corner is the far side of the line from the middle through it.
    const mitre = (corner: P2, other: P2): readonly [P2, P2] => {
      const across: P2 = [-(corner[1] - mid[1]), corner[0] - mid[0]];
      const way = (other[0] - corner[0]) * across[0] + (other[1] - corner[1]) * across[1] > 0 ? -1 : 1;
      return [corner, [across[0] * way, across[1] * way]];
    };
    if (level === 0) joist(b, line(a), line(c), rim - 0.006, bottomY, 0, `${name} rim ${k}`, [mitre(a, c), mitre(c, a)]);
    else {
      b.convex(loft("y", [[bottomY, [a, c, inner[(k + 1) % n]!, inner[k]!]], [soffit, [a, c, inner[(k + 1) % n]!, inner[k]!]]]), "timber", (nrm) => straight(nrm, Math.abs(d[0]) > 0.7 ? "x" : "z"));
    }
    const to = half(inner[k]!, inner[(k + 1) % n]!);
    if (level === 0) joist(b, mid, to, 0.13, bottomY + 0.02, 0, `${name} joist ${k}`);
    else {
      const reach = Math.hypot(to[0] - mid[0], to[1] - mid[1]);
      const dj: P2 = [(to[0] - mid[0]) / reach, (to[1] - mid[1]) / reach];
      const aj: P2 = [-dj[1] * 0.065, dj[0] * 0.065];
      const quad: P2[] = [[mid[0] + aj[0], mid[1] + aj[1]], [to[0] + aj[0], to[1] + aj[1]], [to[0] - aj[0], to[1] - aj[1]], [mid[0] - aj[0], mid[1] - aj[1]]];
      b.convex(loft("y", [[bottomY + 0.02, quad], [soffit, quad]]), "timber", (nrm) => straight(nrm, Math.abs(dj[0]) > 0.7 ? "x" : "z"));
    }
  });
  return b;
}

/** A hatch's leaf stands this far clear of its hole on each side. */
const HATCH_CLEAR = 0.004;

/**
 * A ceiling with a hatch through it: flags cut round the hole on a slab, an oak beam inside each side as a ceiling
 * has, trimmers the whole way across beside the hole and headers between them, and rough stone in the bays.
 */
function hatchFrame(name: string, form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const b = new Build();
  b.free = true;
  if (level < 3) b.rings = yieldPlanes(form);
  const o = form.openings?.[0];
  if (!o || form.outline.length !== 4) throw new Error(`stone ${name}: a square slab with one hole`);
  const [x0, x1, z0, z1] = [o.x0 - form.at[0], o.x1 - form.at[0], o.y0 - form.at[2], o.y1 - form.at[2]];
  const [topY, bottomY] = [form.thick / 2, -form.thick / 2];
  const soffit = -0.005;
  const flagsOn = topFrame(topY);
  /** The slab and its flags are four parts round the hole: two the whole width, and two between them. */
  const parts: [number, number, number, number][] = [[-H, H, -H, z0], [-H, H, z1, H], [-H, x0, z0, z1], [x1, H, z0, z1]];
  if (level === 3) {
    const square: P2[] = [[-H, -H], [H, -H], [H, H], [-H, H]];
    const hole: P2[] = [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]];
    b.shape.extrude(square, "z", bottomY, topY, (label) => [label === "+z" ? "flags" : "masonry", () => [0, 0]], [hole]);
    return b;
  }
  /** The slab as one closed sheet down to `low`, with a corner on each yield ring; with `band`, the beams' timber round its edge under the soffit. */
  const sheetBlock = (low: number, band: boolean): void => {
    const from = b.shape.faces.length;
    // Every part runs along x past the rings across it: only the two whole-width ones reach a ring along it.
    for (const [u0, u1, v0, v1] of parts) {
      b.flat([[u0, topY, v0], [u1, topY, v0], [u1, topY, v1], [u0, topY, v1]], [0, 1, 0], "flags", flagsOn.uv, undefined, 0);
      b.flat([[u0, low, v0], [u1, low, v0], [u1, low, v1], [u0, low, v1]], [0, -1, 0], "masonry", undefined, undefined, 0);
    }
    const edges: readonly (readonly [Vec, P2, P2, boolean])[] = [[[0, 0, 1], [-H, H], [H, H], band], [[0, 0, -1], [-H, -H], [H, -H], band], [[1, 0, 0], [H, -H], [H, H], band], [[-1, 0, 0], [-H, -H], [-H, H], band], [[0, 0, -1], [x0, z1], [x1, z1], false], [[0, 0, 1], [x0, z0], [x1, z0], false], [[-1, 0, 0], [x1, z0], [x1, z1], false], [[1, 0, 0], [x0, z0], [x0, z1], false]];
    for (const [out, a, c, banded] of edges) {
      const along = a[0] === c[0] ? 1 : 0;
      const cuts = [a[along], ...b.rings.filter(([axis]) => axis === along).map(([, v]) => (along === 1 ? -v : v)).filter((v) => v > Math.min(a[along], c[along]) + 1e-9 && v < Math.max(a[along], c[along]) - 1e-9).sort((p0, p1) => p0 - p1), c[along]];
      for (let i = 0; i + 1 < cuts.length; i++) {
        const [p0, p1] = [cuts[i]!, cuts[i + 1]!].map((v): P2 => (along === 0 ? [v, a[1]] : [a[0], v])) as [P2, P2];
        for (const [y0, y1, mat] of banded ? ([[soffit, topY, "masonry"], [low, soffit, "timber"]] as const) : ([[low, topY, "masonry"]] as const)) b.flat([[p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]]], out, mat, straight(out, mat === "timber" ? (along === 0 ? "x" : "z") : undefined));
      }
    }
    b.shape.weld(from);
  };
  if (level === 2) {
    sheetBlock(bottomY, true);
    return b;
  }
  const bed = topY - 0.012;
  const trim = 0.13;
  // The bays between the beams: a row either side of the hole, and one at each of its other two sides.
  const [a0, a1, c0, c1] = [x0 - trim, x1 + trim, z0 - trim, z1 + trim];
  const bays: [number, number, number, number][] = [[-H + 0.08, H - 0.08, -H + 0.08, c0], [-H + 0.08, H - 0.08, c1, H - 0.08], [-H + 0.08, a0, c0 + trim, c1 - trim], [a1, H - 0.08, c0 + trim, c1 - trim]];
  if (level === 1) sheetBlock(soffit, false);
  else {
    for (const [u0, u1, v0, v1] of parts) b.box([u0, soffit, v0], [u1, bed, v1], flagged);
    layFlags(b, new Frame(flagsOn.at(0, 0, bed - topY), flagsOn.u, flagsOn.v, flagsOn.n), parts.map(([u0, u1, v0, v1]) => within2(u0 + H, u1 + H, v0 + H, v1 + H)), [], []);
    bays.forEach(([u0, u1, v0, v1], k) => {
      const drop = rng("hatch bay", k).uniform(0.006, 0.014);
      const faced = ontoStone([0, soffit - drop, 0], [1, 0, 0], [0, 0, -1], [u0, u1, -v1, -v0], ["hatch bay", k]);
      b.convex(loft("y", [[soffit - drop, cell(u0, u1, v0, v1)], [soffit + 0.003, cell(u0, u1, v0, v1)]]), "masonry", (n) => (n[1] < -0.5 ? faced : straight(n)), true);
    });
  }
  // Half a beam along each edge, as a ceiling has; the trimmers beside the hole run whole, and the headers between them.
  const edge: readonly (readonly [number, number, string])[] = [[H - 0.04, 0.04, "hi"], [-H + 0.04, 0.04, "lo"]];
  const square = (axis: string, centre: number, half: number, run: P2, low: number): void => (axis === "x" ? b.box([run[0], low, centre - half], [run[1], soffit, centre + half], "timber", "x", [0, 0], true) : b.box([centre - half, low, run[0]], [centre + half, soffit, run[1]], "timber", "z", [0, 0], true));
  const member = (axis: string, centre: number, half: number, run: P2, low: number, key: string, keep = ""): void => (level === 0 ? beam(b, axis, centre, half, run, low, 0, key, keep) : square(axis, centre, half, run, low));
  for (const [centre, half, keep] of edge) {
    member("x", centre, half, [-H, H], bottomY, `hatch x ${centre}`, keep);
    member("z", centre, half, [-H + 0.08, H - 0.08], bottomY + 0.02, `hatch z ${centre}`, keep);
  }
  for (const [k, centre] of [z0 - trim / 2, z1 + trim / 2].entries()) member("x", centre, trim / 2 - 0.004, [-H + 0.08, H - 0.08], bottomY + 0.01, `hatch trimmer ${k}`);
  for (const [k, centre] of [x0 - trim / 2, x1 + trim / 2].entries()) member("z", centre, trim / 2 - 0.004, [z0 - 0.004, z1 + 0.004], bottomY + 0.03, `hatch header ${k}`);
  return b;
}

/**
 * The hatch's leaf: five oak planks on two ledges under them, hung on two iron strap hinges along its -z side, with a
 * ring to lift it by near the other. It lies in its frame's hole, its top a hair under the floor's. Open, it hangs
 * from its hinge side: the same leaf a quarter turn down.
 */
function hatch(form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const b = new Build();
  b.free = true;
  const [u0, v0, u1, v1] = outlineBox(form);
  // The open row is the leaf hanging: its outline is the leaf's thickness along the hinge side, and its `thick` the leaf's length.
  const open = v1 - v0 < form.thick;
  const [thick, far] = open ? [v1 - v0, v0 + form.thick] : [form.thick, v1];
  const [x0, x1, z0, z1] = [u0 - form.at[0] + HATCH_CLEAR, u1 - form.at[0] - HATCH_CLEAR, v0 - form.at[2] + HATCH_CLEAR, far - form.at[2] - HATCH_CLEAR];
  // It turns down on the line half its thickness in from its hinge side, at the middle of its thickness: the one line the shut row's box turns into the open one's on.
  const hinge = v0 - form.at[2] + thick / 2;
  if (open) b.turn = ([x, y, z]) => [x, hinge - z, hinge + y];
  const top = thick / 2 - 0.004;
  const bottom = top - 0.045;
  if (level === 3) {
    b.box([x0, bottom, z0], [x1, top, z1], "timber", "z");
    return b;
  }
  if (level === 2) b.box([x0, bottom, z0], [x1, top, z1], "timber", "z");
  else {
    const g = rng("hatch planks");
    const shares = [0.21, 0.19, 0.2, 0.19, 0.21].map((w) => w + g.uniform(-0.012, 0.012));
    const sum = shares.reduce((acc, w) => acc + w, 0);
    let x = x0;
    shares.forEach((share, k) => {
      const [a, c] = [x + (k === 0 ? 0 : 0.002), x + ((x1 - x0) * share) / sum - (k === shares.length - 1 ? 0 : 0.002)];
      x += ((x1 - x0) * share) / sum;
      const ty = top - g.uniform(0, 0.003);
      const cp = level === 0 ? g.uniform(0.005, 0.008) : 0;
      const profile: P2[] = cp > 0 ? [[a, bottom], [c, bottom], [c, ty - cp], [c - cp, ty], [a + cp, ty], [a, ty - cp]] : [[a, bottom], [c, bottom], [c, ty], [a, ty]];
      b.convex(loft("z", [[z0, profile], [z1, profile]]), "timber", (n) => straight(n, "z", [((k * 0.31) % 0.5) - 0.25, ((k * 0.17) % 0.4) - 0.2]));
    });
  }
  // Two ledges under the planks, across them: far enough in that the open leaf's hang clear under its frame.
  for (const z of [z0 + 0.34, z1 - 0.34]) b.box([x0 + 0.04, bottom - 0.035, z - 0.07], [x1 - 0.04, bottom, z + 0.07], "timber", "x");
  for (const xc of [x0 + 0.3, x1 - 0.3]) {
    // A strap hinge from the hung side, narrowing to a spear point past the middle.
    const section = (half: number): P2[] => [[xc - half, top - 0.002], [xc + half, top - 0.002], [xc + half, top + 0.006], [xc - half, top + 0.006]];
    if (level === 2) b.box([xc - 0.035, top - 0.002, z0], [xc + 0.035, top + 0.006, z0 + 0.8], "iron", "z");
    else b.convex(loft("z", [[z0 + 0.002, section(0.035)], [z0 + 0.72, section(0.03)], [z0 + 0.84, section(0.004)]]), "iron", (n) => straight(n, "z"));
    if (level > 0) continue;
    for (const zc of [z0 + 0.12, z0 + 0.4, z0 + 0.66]) {
      const base: Vec[] = [[xc - 0.011, top + 0.006, zc - 0.011], [xc + 0.011, top + 0.006, zc - 0.011], [xc + 0.011, top + 0.006, zc + 0.011], [xc - 0.011, top + 0.006, zc + 0.011]];
      b.convex([{ pts: base }, ...base.map((q, k) => ({ pts: [q, base[(k + 1) % 4]!, [xc, top + 0.012, zc] as Vec] }))], "iron", (n) => straight(n));
    }
  }
  if (level === 2) return b;
  // A plate near the far side, and on the finest level the ring that lies on it.
  const [px, pz] = [(x0 + x1) / 2, z1 - 0.2];
  b.box([px - 0.06, top - 0.002, pz - 0.045], [px + 0.06, top + 0.005, pz + 0.045], "iron");
  if (level === 1) return b;
  const [radius, tube, around, across] = [0.045, 0.007, 8, 4];
  const at = (i: number, j: number): Vec => {
    const [a, c] = [(2 * Math.PI * i) / around, (2 * Math.PI * j) / across];
    const r = radius + tube * Math.cos(c);
    return [px + r * Math.cos(a), top + 0.012 + tube * Math.sin(c), pz - 0.03 + r * Math.sin(a)];
  };
  for (let i = 0; i < around; i++) for (let j = 0; j < across; j++) {
    const quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    const a = (2 * Math.PI * (i + 0.5)) / around;
    const out = sub(mean(quad), [px + radius * Math.cos(a), top + 0.012, pz - 0.03 + radius * Math.sin(a)]);
    const turned = dot(newell(quad), out) < 0 ? [...quad].reverse() : quad;
    b.face(turned, "iron", straight(newell(turned)));
  }
  return b;
}

/**
 * A ramp up toward +z: its two cheeks and its back walled as the stairs' are, cut to the slope, and the slope paved
 * with the floor's flags, the pattern laid again where the slope is longer than it.
 */
function ramp(name: string, form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const b = new Build();
  b.free = true;
  const tops = form.corner!.map((h) => h - form.at[1]);
  const [lo, hi] = [Math.min(...tops), Math.max(...tops)];
  const plan = planXZ(form);
  const [x0, x1, z0, z1] = box2(plan);
  if (Math.abs(x1 - x0 - TILE) > 1e-9 || Math.abs(z1 - z0 - TILE) > 1e-9 || hi - lo > TILE || tops.some((t, k) => Math.abs(t - (plan[k]![1] > 0 ? hi : lo)) > 1e-9)) throw new Error(`stone ${name}: a ramp a span square that rises toward +z by no more than a storey`);
  const rise = hi - lo;
  const long = Math.hypot(TILE, rise);
  const [sin, cos] = [rise / long, TILE / long];
  /** The slope's own height over z, and its plane `by` under it, square to it. */
  const yAt = (z: number): number => lo + (rise * (z - z0)) / TILE;
  const under = (by: number): Plane => [[0, yAt(0) - by / cos, 0], [0, cos, -sin]];
  const paved = new Frame([x0, lo, z0], [1, 0, 0], [0, sin, cos], [0, cos, -sin]);
  const wedge = (inFrom: number, by: number): P2[] => [[z0 + (by / cos) * (TILE / rise), lo], [z1 - inFrom, lo], [z1 - inFrom, yAt(z1 - inFrom) - by / cos]];
  if (level >= 2) {
    b.convex(loft("x", [[x0, wedge(0, 0)], [x1, wedge(0, 0)]]), (n) => (n[1] > 0.5 ? "flags" : "masonry"), (n) => (n[1] > 0.5 ? paved.uv : straight(n)));
    return b;
  }
  const pave = 0.012;
  const inFrom = level === 0 ? MD : MD - FACE;
  // The cheeks' walling hangs from a storey over the foot, as the stairs' does, so its courses run on into a wall's.
  const top = lo + TILE;
  const right = new Frame([x1 - inFrom, top, z1], [0, 0, -1], [0, -1, 0], [1, 0, 0]);
  const left = new Frame([x0 + inFrom, top, z0], [0, 0, 1], [0, -1, 0], [-1, 0, 0]);
  const rear = new Frame([x0, top, z1 - inFrom], [1, 0, 0], [0, -1, 0], [0, 0, 1]);
  if (level === 0) {
    b.convex(loft("x", [[x0 + inFrom, wedge(inFrom, pave)], [x1 - inFrom, wedge(inFrom, pave)]]), "masonry", (n) => straight(n));
    const faces: { frame: Frame; keep: Plane[] }[] = [{ frame: right, keep: [under(pave), keepAbove(right, MD)] }, { frame: left, keep: [under(pave), keepBelow(left, TILE - MD)] }, { frame: rear, keep: [under(pave)] }];
    for (const { frame, keep } of faces) for (const { stone, look } of walling()) lay(b, frame, stone, look, "masonry", { keep, least: LEAST, cutOnly: true });
    // The paving: cut level at the foot, and upright at the head, where the floor above begins.
    layFlags(b, paved.out(-pave), [within2(0, TILE, 0, long + 0.1)], [[[0, lo, 0], [0, -1, 0]], [[0, 0, z1], [0, 0, 1]]], WHOLE, Math.ceil(long / TILE));
    return b;
  }
  // Each cheek and the back one flat sheet, every stone a cell of it, and the slope one sheet, every flag a cell.
  const from = b.shape.faces.length;
  const back = z1 - inFrom;
  const [xa, xb] = [x0 + inFrom, x1 - inFrom];
  b.flat([[xa, lo, z0], [xb, lo, z0], [xb, lo, back], [xa, lo, back]], [0, -1, 0], "masonry");
  const flush = paved.out(0);
  const flagCells: Tile[] = Array.from({ length: Math.ceil(long / TILE) }, (_, j) => flags().map((s): Tile => ({ poly: s.quad.map(([u, v]) => [u, v + j * TILE] as const), mat: "flags" }))).flat();
  // The slope's own sheet runs from cheek to cheek and from the foot to the back's face.
  const reach = (back - z0) / cos;
  tiles(b, flush, flagCells, [within2(inFrom, TILE - inFrom, 0, reach)]);
  const outline: P2[] = [[z0, lo], [back, lo], [back, yAt(back)]];
  for (const [frame, k] of [[right, 0], [left, 1], [rear, 2]] as const) {
    const poly: P2[] = outline.map(([z, y]) => [k === 0 ? z1 - z : z - z0, top - y] as const);
    tiles(b, frame, wallTiles(frame), [k === 2 ? within2(inFrom, TILE - inFrom, top - yAt(back), TILE) : sidesOf(poly)]);
  }
  b.shape.weld(from);
  return b;
}

// Roofs. These are built in the kit's own frame, z up and the front at -y, on the kit's slabs and cuts, to the rules
// wood's are: a roof's top is the plane through its row's corner heights, what stands on it is built by height over its
// low side and by upright thickness, and its lowest course runs out past a low side. So two faces agree along any side
// they share, whatever their slopes, and a stone roof meets a wooden one.

/** A roof's courses to a third of its rise are the flags' own rows, so a course is a row of the picture: where each begins, as a share of the third. */
const COURSE_AT = [...FLAG_ROWS].reverse().map((v) => 1 - v / TILE);
/** How far a roof's lowest course runs out past its low side, measured level. */
const EAVE = 0.3;
/** A slate's thickness at its head, at its butt, and the eave course's, measured upright. */
const LAP_HEAD = 0.013;
const LAP_BUTT = 0.033;
const EAVE_COURSE = 0.062;
/** The oak boards under the slates, measured upright, and how far their top lies under the roof's own plane. */
const SARK = 0.04;
const SARK_DROP = 0.002;
/** A roof's rim timbers lie on its sides' own lines, as wide as its yield band and as deep as its slab: a wall under a side meets them, and the ring cuts none along its length. */
const RIM = 0.1;
/** A low side's plate runs out over the wall under it, short of its outer face, and down onto the wall's top, which stands 4 mm under the storey's line. */
const PLATE_OUT = 0.096;
const SEAT = 0.006;
/** The rafter under a fold is this wide. */
const FOLD = 0.16;
const RAFTER = 0.2;
/** The saddle stones that cap a ridge (`ridgeStones`): how far each reaches down the slope, and its top over the ridge's line at the ridge and at its edge. */
const CAP = { wide: 0.22, top: 0.075, drop: 0.068 } as const;

/** One flat face of a roof: its corners in plan, what each side is, and its own axes, along its contours and up its slope. */
interface Facet {
  poly: Flat[];
  kinds: ("eave" | "ridge" | "rake" | "fold")[];
  /** The height of its lowest contour, and metres it rises to a level metre. */
  lo: number;
  g: number;
  up: Flat;
  along: Flat;
  /** Where its lowest contour meets the side of the cell its contours are counted from. */
  o: Flat;
  /** The axis of the kit's frame its contours run along. */
  axis: number;
}

/** The point of a facet `a` along its contours, `s` level metres up its slope and `n` upright over its plane. */
const onFacet = (f: Facet, a: number, s: number, n = 0): Vec => [f.o[0] + a * f.along[0] + s * f.up[0], f.o[1] + a * f.along[1] + s * f.up[1], f.lo + s * f.g + n];
const facetAt = (f: Facet, q: Flat): [number, number] => [(q[0] - f.o[0]) * f.along[0] + (q[1] - f.o[1]) * f.along[1], (q[0] - f.o[0]) * f.up[0] + (q[1] - f.o[1]) * f.up[1]];
const heightOn = (f: Facet, q: Flat): number => f.lo + facetAt(f, q)[1] * f.g;

/** A roof form's flat faces: one, or two where its four corners are folded on the diagonal through the odd one. */
function facetsOf(form: FormDef): { plan: Flat[]; tops: number[]; facets: Facet[]; fold: number; hip: boolean } {
  const plan = planOf(form);
  const tops = form.corner!.map((h) => h - form.at[1]);
  const n = plan.length;
  const [lo, hi] = [Math.min(...tops), Math.max(...tops)];
  const odd = tops.findIndex((h, k) => tops.filter((t) => Math.abs(t - h) < 1e-9).length === 1 && n === 4 && tops.filter((t) => Math.abs(t - tops[(k + 1) % n]!) < 1e-9).length === 3);
  const fold = Math.max(0, odd);
  const lists = odd < 0 ? [plan.map((_, k) => k)] : [[fold, (fold + 1) % n, (fold + 2) % n], [fold, (fold + 2) % n, (fold + 3) % n]];
  const facets = lists.map((list): Facet => {
    const poly = list.map((k) => plan[k]!);
    // The plane through three of its corners: its slope is the way its height grows fastest.
    const [a, c, e] = [0, 1, 2].map((i): Vec => [poly[i]![0], poly[i]![1], tops[list[i]!]!]);
    const nrm = cross(sub(c!, a!), sub(e!, a!));
    const [gx, gy] = [-nrm[0] / nrm[2], -nrm[1] / nrm[2]];
    const g = Math.hypot(gx, gy);
    const up: Flat = [gx / g, gy / g];
    const along: Flat = [up[1], -up[0]];
    const low = poly[list.findIndex((k) => Math.abs(tops[k]! - lo) < 1e-9)]!;
    // Contours are counted from the cell's own side, so the picture's joints fall alike on every face.
    const least = Math.min(...plan.map((q) => q[0] * along[0] + q[1] * along[1]));
    const back = least - (low[0] * along[0] + low[1] * along[1]);
    const kinds = list.map((k, i) => {
      const j = list[(i + 1) % list.length]!;
      if ((j - k + n) % n !== 1) return "fold" as const;
      if (Math.abs(tops[k]! - tops[j]!) > 1e-9) return "rake" as const;
      return Math.abs(tops[k]! - lo) < 1e-9 ? ("eave" as const) : ("ridge" as const);
    });
    return { poly, kinds, lo, g, up, along, o: [low[0] + back * along[0], low[1] + back * along[1]], axis: Math.abs(along[0]) > 0.5 ? 0 : 1 };
  });
  return { plan, tops, facets, fold, hip: odd >= 0 && Math.abs(tops[fold]! - hi) < 1e-9 };
}

/** The upright planes a facet's parts are cut to: each side's own, an eave's moved out to where its slates end. */
const facetSides = (f: Facet): KitPlane[] => f.poly.map((a, k) => planeMoved(uprightPlane(a, f.poly[(k + 1) % f.poly.length]!), f.kinds[k] === "eave" ? EAVE : 0));

/**
 * How a facet wears the flags as slates: a third of the roof's rise is one height of the picture, so each of its rows
 * is a course, and it is as large across as it is up the slope. One mapping the whole face over, so a face drawn flat
 * wears the same slates as one whose courses are solid.
 */
const slateUv = (f: Facet, rise: number) => (q: Vec): Uv => {
  const [a, s] = facetAt(f, [q[0], q[1]]);
  return [(a * 3 * f.g) / (rise * Math.sqrt(1 + f.g * f.g)), (3 * s * f.g) / rise];
};

/**
 * A facet's courses of stone slates, each lapping the one under it, cut to the facet's sides. A course is one length
 * of stone along the contour: its slates' joints are the picture's. The lowest runs out over an eave as a double
 * course, which covers the top of the wall the roof stands on. Past the finest level the eave course alone is solid.
 */
function slates(p: Shape, level: number, f: Facet, rise: number, eave = f.kinds.includes("eave")): void {
  const spans = f.poly.map((q) => facetAt(f, q)[0]);
  const [a0, a1] = [Math.min(...spans) - EAVE - 0.05, Math.max(...spans) + EAVE + 0.05];
  // The same thicknesses on every face of every roof, so courses meet across a hip, a valley and a side.
  const g = rng("slates");
  const uv = slateUv(f, rise);
  const heights = [0, 1, 2].flatMap((third) => COURSE_AT.slice(0, -1).map((c) => ((third + c) * rise) / 3)).concat(rise);
  const from = p.faces.length;
  const up = (height: number): number => height / f.g;
  for (let i = 0; i + 1 < heights.length; i++) {
    const [s0, s1] = [up(heights[i]!), up(heights[i + 1]!)];
    const head = i === heights.length - 2 ? s1 : s1 + up(0.015);
    const t = LAP_BUTT + g.uniform(-0.004, 0.003);
    const first = i === 0 && eave;
    if (level > 0 && !first) continue;
    const section: Flat[] = !first ? [[s0, 0], [head, 0], [head, LAP_HEAD], [s0, t]] : level === 0 ? [[-EAVE, 0], [head, 0], [head, LAP_HEAD], [up(0.05), EAVE_COURSE], [-EAVE, EAVE_COURSE]] : [[-EAVE, 0], [s1, 0], [s1, 0.022], [up(0.05), EAVE_COURSE], [-EAVE, EAVE_COURSE]];
    const rings = [a0, a1].map((a) => section.map(([s, n]) => onFacet(f, a, s, n)));
    p.loft(rings, (_, r, j) => ["flags", uv(rings[r]![j]!)], (r, j) => ["flags", uv(rings[r]![j]!)], f.axis);
  }
  for (const side of facetSides(f)) clip(p, side, null, from);
}

/**
 * What closes a roof member where it is cut: its own material, the picture laid across two ways that no cut of a roof
 * lies along both of, so it runs to a line on none. A cut's own face would carry on a narrow strip's.
 */
const cutOf = (mat: string) => (q: Vec): readonly [string, Uv] => [mat, [dot(q, CUT_ACROSS) / TILE, dot(q, CUT_UP) / TILE]];
const CUT_AWAY = unit([Math.cos(0.3), Math.sin(0.3), 2]);
const CUT_ACROSS = unit(cross(CUT_AWAY, [0, 0, 1]));
const CUT_UP = cross(CUT_AWAY, CUT_ACROSS);

/** The axis two points lie along, if they lie along one. */
function axisOf(a: Vec, c: Vec): number | undefined {
  const moved = [0, 1, 2].filter((k) => Math.abs(c[k]! - a[k]!) > 1e-9);
  return moved.length === 1 ? moved[0] : undefined;
}

/**
 * A straight member in the kit's frame from a to c, `w` across and `h` along `up`: oak, hewn a little out of true on
 * the finest level, or a dressed stone. One that lies along an axis is left whole by a yield ring across it.
 */
function member(p: Shape, level: number, a: Vec, c: Vec, w: number, h: number, up: Vec, key: string, mat = "timber", chamfer = 0.014): void {
  const g = rng("member", key);
  const hewn = level === 0 && mat === "timber";
  const made = beamRings(g, a, c, w, h, up, level === 0 ? chamfer : 0, hewn ? 0.005 : 0, hewn ? Math.max(1, Math.round(length(sub(c, a)) / 1.5)) : 1);
  const shift = g.uniform(0, 1);
  const count = made.base.length;
  // Each face a strip of the picture along the member, its grain running with it.
  const around = (k: number): number => (k * 0.37 + shift) % 1;
  p.loft(made.rings, (k, i, j) => [mat, [(i * made.length) / made.n / TILE + shift, around(k) + (j === k ? 0 : Math.max(w, h) / count / TILE)]], (i, j) => [mat, [shift + made.base[j]![0] / TILE, shift + made.base[j]![1] / TILE + i * 0.3]], axisOf(a, c));
}

/**
 * A roof: stone slates in lapped courses on oak boards, over a frame like a ceiling's. Its rim is oak on each side's
 * own line, as deep as the slab: a rake board along a sloped side, a beam along a high one, and along a low one a plate
 * that runs out over the wall under it and bears on its top. Common rafters lie between, their tails out under the
 * eave. A hip's fold is capped by a roll of dressed stone that climbs onto a saddle at its high corner, and a valley's
 * lined by a dressed gutter stone out to its low corner, where its lowest course is an eave course.
 */
function roof(form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const b = new Build();
  const p = b.shape;
  const { plan, tops, facets, fold, hip } = facetsOf(form);
  const n = plan.length;
  const rise = Math.max(...tops) - Math.min(...tops);
  const folded = facets.length > 1;
  /** The facet a side of the outline lies on, and what the side is. */
  const facetOf = (k: number): Facet => facets.find((f) => f.poly.includes(plan[k]!) && f.poly.includes(plan[(k + 1) % n]!))!;
  const kindOf = (k: number): Facet["kinds"][number] => {
    const f = facetOf(k);
    return f.kinds[f.poly.indexOf(plan[k]!)]!;
  };
  const slab: SlabMap = (part, k) => {
    const f = facets[Math.min(k, facets.length - 1)]!;
    if (part === "top") return ["flags", slateUv(f, rise)];
    // The boards under the slates run along the contours, and a side is a beam's.
    if (part === "under") return ["timber", (q) => [facetAt(f, [q[0], q[1]])[0] / TILE, facetAt(f, [q[0], q[1]])[1] / TILE]];
    return ["timber", (q) => [(q[0] + q[1]) / TILE, 0.3 + q[2] / TILE]];
  };
  const lowest = Math.min(...tops) - form.thick;
  const eaves = plan.map((_, k) => kindOf(k) === "eave");
  const raked = plan.map((_, k) => kindOf(k) === "rake");
  const axis = (k: number): number | undefined => axisOf([plan[k]![0], plan[k]![1], 0], [plan[(k + 1) % n]![0], plan[(k + 1) % n]![1], 0]);
  /** A rim timber's faces: its grain along its side, each on its own strip of the timber picture. */
  const rimMap = (k: number): SlabMap => {
    const [a, c] = [plan[k]!, plan[(k + 1) % n]!];
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const f = facetOf(k);
    return (part) => ["timber", (q) => {
      const along = ((q[0] - a[0]) * (c[0] - a[0]) + (q[1] - a[1]) * (c[1] - a[1])) / l;
      const across = (-(q[0] - a[0]) * (c[1] - a[1]) + (q[1] - a[1]) * (c[0] - a[0])) / l;
      return [along / TILE + 0.17 * k, (part === "side" ? 0.1 : 0.6) + (part === "side" ? q[2] - heightOn(f, [q[0], q[1]]) + form.thick / 2 : across) / TILE];
    }];
  };
  /** The rim's timbers, one a side, from what each carries down to the slab's underside, a plate's onto the wall's top. */
  const rim = (top: (k: number) => number): void => rimStrips(plan, eaves.map((e) => (e ? PLATE_OUT : 0)), RIM, raked).forEach((quad, k) => {
    const f = facetOf(k);
    const from = p.faces.length;
    slabOn(p, quad, quad.map((q) => heightOn(f, q) - top(k)), eaves[k] ? quad.map(() => lowest - SEAT) : form.thick - top(k), rimMap(k), 0, raked[k] ? undefined : axis(k));
    // A rake board runs on past a low side to the plate's face, and ends level on the wall there as the plate does.
    if (raked[k]) clip(p, planeAt([0, 0, lowest - SEAT], [0, 0, -1]), cutOf("timber"), from);
  });
  if (level === 3) {
    // One solid: its top wears the slates' colour, and it runs out to a thin edge over each eave.
    const moved = insetPlan(plan, eaves.map((e) => (e ? -EAVE : 0)));
    const out = moved.map((q, k) => Math.hypot(q[0] - plan[k]![0], q[1] - plan[k]![1]) > 1e-9);
    const high = moved.map((q, k) => heightOn(out[k] ? facets.find((f) => f.poly.includes(plan[k]!) && f.kinds.includes("eave"))! : facetOf(k), q) + 0.02);
    const low = moved.map((_, k) => (out[k] ? high[k]! - 0.07 : tops[k]! - form.thick));
    slabOn(p, moved, high, low, slab, fold);
    return b;
  }
  if (level === 2) {
    // The slab as deep as its row to every side, its top wearing the slates; a thin edge out over each eave; and the plates.
    slabOn(p, plan, tops.map((h) => h + 0.02), form.thick + 0.02, slab, fold);
    rimStrips(plan, eaves.map((e) => (e ? EAVE : 0)), 0).forEach((quad, k) => {
      if (eaves[k]) slabOn(p, quad, quad.map((q) => heightOn(facetOf(k), q) + 0.02), 0.07, slab, 0, axis(k));
    });
    rimStrips(plan, eaves.map((e) => (e ? PLATE_OUT : 0)), RIM, raked).forEach((quad, k) => {
      if (eaves[k]) slabOn(p, quad, quad.map((q) => heightOn(facetOf(k), q) - 0.05), quad.map(() => lowest - SEAT), rimMap(k), 0, axis(k));
    });
    return b;
  }
  facets.forEach((f) => {
    const from = p.faces.length;
    // A valley's lowest course is an eave course too, as thick as those of the slopes beside it at its low corner.
    slates(p, level, f, rise, f.kinds.includes("eave") || (folded && !hip));
    // A valley's courses stop short of its fold, where the stone that lines it shows.
    if (folded && !hip) clip(p, planeMoved(facetSides(f)[f.kinds.indexOf("fold")]!, -0.09), null, from);
  });
  // The boards alone, or past the finest the slates and their boards as one sheet that wears the slates.
  if (level === 0) slabOn(p, plan, tops.map((h) => h - SARK_DROP), SARK, slab, fold);
  else slabOn(p, plan, tops.map((h) => h + 0.022), SARK + SARK_DROP + 0.022, slab, fold);
  // A plate stands up to its eave course, and the rest to the boards.
  rim((k) => (eaves[k] ? 0.003 : SARK + SARK_DROP));
  const edge = insetPlan(plan, 0.004);
  const within = edge.map((a, k) => uprightPlane(a, edge[(k + 1) % n]!));
  const floor = planeAt([0, 0, lowest], [0, 0, -1]);
  if (folded) {
    const [a, c] = [plan[(fold + 2) % n]!, plan[fold]!];
    const [za, zc] = [tops[(fold + 2) % n]!, tops[fold]!];
    const run = Math.hypot(c[0] - a[0], c[1] - a[1]);
    // The rafter under the fold. Under a hip it stands as far down as the faces fall away over its width.
    const drop = SARK + SARK_DROP + RAFTER / 2 + (hip ? (FOLD / 2) * facets[0]!.g * Math.SQRT1_2 : 0);
    let from = p.faces.length;
    member(p, level, [a[0], a[1], za - drop], [c[0], c[1], zc - drop], FOLD, RAFTER / Math.hypot(1, (zc - za) / run), [0, 0, 1], "fold");
    for (const side of [...within, floor]) clip(p, side, cutOf("timber"), from);
    from = p.faces.length;
    if (hip) {
      // The dressed roll that caps a hip, from the corner of the eave courses up the fold. Where the saddle begins it
      // climbs onto it, and ends as high as the roll of a ridge's saddle stones, whose end it and the next hip's close.
      const reach = facets.every((f) => f.kinds.includes("eave")) ? EAVE * Math.SQRT2 - 0.02 : 0;
      const on = (d: number, lift: number): Vec => [c[0] - ((c[0] - a[0]) * d) / run, c[1] - ((c[1] - a[1]) * d) / run, zc - (d * (zc - za)) / run + lift];
      const kink = CAP.wide * Math.SQRT2;
      const path: Vec[] = [on(run + reach, 0.03), on(kink, 0.03), [...on(-0.06, 0).slice(0, 2), zc + CAP.top + 0.012 + (0.06 * (CAP.top + 0.012 + (kink * (zc - za)) / run - 0.03)) / kink] as unknown as Vec];
      for (const k of [0, 1]) member(p, level, path[k]!, path[k + 1]!, 0.11, 0.06, [0, 0, 1], `roll ${k}`, "dressed", 0.018);
      for (const side of [...plan.map((q, k) => planeMoved(uprightPlane(q, plan[(k + 1) % n]!), eaves[k] ? EAVE : 0)), planeAt([0, 0, zc + CAP.top + 0.035], [0, 0, 1])]) clip(p, side, cutOf("dressed"), from);
      // The saddle at its high corner: the end of a ridge's saddle stones, turned down each face to the fold. A ridge's
      // trim butts its side, and with the hip beside it the three faces close the ridge's end.
      const [d1, d2] = [plan[(fold + 1) % n]!, plan[(fold + n - 1) % n]!].map((q): Flat => [(q[0] - c[0]) / (2 * H), (q[1] - c[1]) / (2 * H)]);
      const at = (i: number, j: number): Flat => [c[0] + d1![0] * i + d2![0] * j, c[1] + d1![1] * i + d2![1] * j];
      const [near, far] = [0.001, CAP.wide];
      const saddle = [at(near, near), at(far, near), at(far, far), at(near, far)];
      const dressed: SlabMap = () => ["dressed", (q) => [(q[0] + q[1]) / TILE + 0.5, 0.5 + q[2] / TILE]];
      slabOn(p, saddle, [zc + CAP.top, zc - CAP.drop, zc - CAP.drop, zc - CAP.drop], saddle.map((q) => Math.min(...facets.map((f) => heightOn(f, q))) - SARK_DROP), dressed, 0);
    } else {
      // The gutter stone that lines a valley, from its low corner, where it is cut to the sides, to just short of its high one.
      const [t0, t1] = [-0.2 / run, 1 - 0.14 / run];
      member(p, level, [a[0] + (c[0] - a[0]) * t0, a[1] + (c[1] - a[1]) * t0, za + (zc - za) * t0 + 0.03], [a[0] + (c[0] - a[0]) * t1, a[1] + (c[1] - a[1]) * t1, za + (zc - za) * t1 + 0.03], 0.26, 0.036, [0, 0, 1], "gutter", "dressed", 0);
      for (const side of within) clip(p, side, cutOf("dressed"), from);
    }
  }
  facets.forEach((f, i) => {
    const k = Math.sqrt(1 + f.g * f.g);
    const spans = f.poly.map((q) => facetAt(f, q)[1]);
    // Their ends on the rim's inner faces, which are the yield rings.
    const sides = f.poly.map((a, s2) => planeMoved(uprightPlane(a, f.poly[(s2 + 1) % f.poly.length]!), f.kinds[s2] === "fold" ? -0.07 : -RIM));
    for (const [j, a] of level === 0 ? [0.75, 2.25].entries() : []) {
      // A common rafter up the slope, a third of the way in from each side: from 19 m the boards' picture is all of it.
      const from = p.faces.length;
      const off = -(SARK + SARK_DROP + RAFTER / 2);
      member(p, level, onFacet(f, a, Math.min(...spans), off), onFacet(f, a, Math.max(...spans), off), 0.12, RAFTER / k, [0, 0, 1], `common ${i} ${j}`);
      for (const side of sides) clip(p, side, cutOf("timber"), from);
    }
    if (level > 0 || !f.kinds.includes("eave")) return;
    // Rafter tails under the eave course, each narrower than the rafter of a roof that runs on below, so it lies inside it.
    const from = p.faces.length;
    for (const a of [0.055, 0.75, 2.25, 2.945]) member(p, 1, onFacet(f, a, -EAVE + 0.035, -0.054), onFacet(f, a, 0.02, -0.054), 0.085, 0.09, [0, 0, 1], `tail ${i} ${a}`);
    f.kinds.forEach((kind, s2) => {
      if (kind !== "eave") clip(p, facetSides(f)[s2]!, cutOf("timber"), from);
    });
  });
  return b;
}

/** A column's ring: a square of half `w` about the pillar's line with its corners cut by `cut`. Cut far enough it is an octagon. */
const ringOf = (w: number, cut: number): P2[] => octagon(0, 0, w, w, cut);
const ROUND = 2 - Math.SQRT2;

/**
 * A thin pillar: a column of dressed stone. A square base block, four eight-sided drums whose beds are cut back, and a
 * square cap block under the floor it carries. Its drums are shaded round.
 */
function column(form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const b = new Build();
  b.free = true;
  const [u0, , u1] = outlineBox(form);
  const w = (u1 - u0) / 2;
  const hy = form.thick / 2;
  // It stops short of its box, as a pillar's top block does.
  const [foot, top] = [-hy, hy - 0.015];
  if (level === 3) {
    b.box([-w * 0.85, -hy, -w * 0.85], [w * 0.85, hy, w * 0.85], "dressed");
    return b;
  }
  const r = w * 0.86;
  const [base, cap] = [foot + 0.26, top - 0.2];
  const dressed = (key: string): ((n: Vec) => UvMap) => {
    const g = rng("column", key);
    const shift: P2 = [g.uniform(0, 1), g.uniform(0, 1)];
    return (n) => straight(n, undefined, shift);
  };
  /** A solid through rings of eight corners, its upright faces between `round` stations shaded as one round surface. */
  const turned = (stations: readonly (readonly [number, P2[]])[], round: readonly number[], key: string): void => {
    const sides = loft("y", stations);
    const n = 8;
    b.convex(sides.map((side, k) => (k >= 2 && round.includes(Math.floor((k - 2) / n)) ? { ...side, smooth: true } : side)), "dressed", dressed(key));
  };
  const ch = level === 0 ? 0.014 : 0;
  // The base and the cap: square blocks, their arrises cut, the cap drawn in to the shaft under it.
  if (level === 0) {
    turned([[foot, ringOf(w - ch, 0.02)], [foot + ch, ringOf(w, 0.02)], [base - 0.05, ringOf(w, 0.02)], [base, ringOf(r + 0.01, (r + 0.01) * ROUND)]], [], "base");
    turned([[cap, ringOf(r + 0.01, (r + 0.01) * ROUND)], [cap + 0.07, ringOf(w, 0.02)], [top - ch, ringOf(w, 0.02)], [top, ringOf(w - ch, 0.02)]], [], "cap");
    const g = rng("column drums");
    const beds = [base, ...[0.26, 0.5, 0.76].map((f) => base + (cap - base) * (f + g.uniform(-0.02, 0.02))), cap];
    beds.slice(1).forEach((y1, i) => {
      const y0 = beds[i]!;
      const rr = r + g.uniform(-0.004, 0.004);
      const turn = g.uniform(-0.03, 0.03);
      const ring = (by: number): P2[] => ringOf(rr - by, (rr - by) * ROUND).map(([x, z]) => [x * Math.cos(turn) + z * Math.sin(turn), -x * Math.sin(turn) + z * Math.cos(turn)] as const);
      turned([[y0, ring(0.012)], [y0 + 0.012, ring(0)], [y1 - 0.012, ring(0)], [y1, ring(0.012)]], [1], `drum ${i}`);
    });
    return b;
  }
  b.box([-w, foot, -w], [w, base, w], "dressed");
  b.box([-w, cap + 0.04, -w], [w, top, w], "dressed");
  turned([[base, ringOf(r, r * ROUND)], [cap + 0.04, ringOf(r, r * ROUND)]], [0], "shaft");
  return b;
}

/**
 * A railing: a balustrade of dressed stone. A plinth rail and a coping rail between half posts at its ends and a post
 * in its middle, and square balusters set on the diagonal between them. Far off it is its two rails and its post.
 */
function balustrade(form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const w = wallBox(form);
  const b = new Build();
  b.free = true;
  if (level < 3) b.rings = yieldPlanes(form);
  const [low, high] = [w.foot + 0.11, w.top - 0.1];
  const out = w.half + 0.02;
  const map = (key: string): [undefined, P2] => {
    const g = rng("railing", key);
    return [undefined, [g.uniform(0, 1), g.uniform(0, 1)]];
  };
  // The rails: the lower one's top weathered, the upper one a coping that stands out over the balusters.
  if (level === 0) {
    b.prism([[-w.half, w.foot], [w.half, w.foot], [w.half, low - 0.02], [w.half - 0.02, low], [-w.half + 0.02, low], [-w.half, low - 0.02]], "x", w.x0, w.x1, "dressed", ...map("plinth"));
    b.prism([[-out, high + 0.012], [-out + 0.012, high], [out - 0.012, high], [out, high + 0.012], [out, w.top - 0.022], [out - 0.022, w.top], [-out + 0.022, w.top], [-out, w.top - 0.022]], "x", w.x0, w.x1, "dressed", ...map("coping"));
  } else {
    b.box([w.x0, w.foot, -w.half], [w.x1, low, w.half], "dressed", ...map("plinth"));
    b.box([w.x0, high, -out], [w.x1, w.top, out], "dressed", ...map("coping"));
  }
  // Half a post at each end, which two railings in a row make whole, and a post in the middle.
  const post = 0.09;
  const mid = (w.x0 + w.x1) / 2;
  const posts: P2[] = [[w.x0, w.x0 + post], [mid - post, mid + post], [w.x1 - post, w.x1]];
  posts.forEach(([x0, x1], k) => {
    if (level < 3 || k === 1) b.box([x0, low, -w.half], [x1, high, w.half], "dressed", ...map(`post ${k}`));
  });
  if (level === 3) return b;
  // The balusters of each bay: square, set on the diagonal, twice as far apart from across a yard.
  const across = Math.min(0.04, w.half - 0.008);
  for (let bay = 0; bay + 1 < posts.length; bay++) {
    const [x0, x1] = [posts[bay]![1], posts[bay + 1]![0]];
    const count = Math.max(1, Math.round((x1 - x0) / (level === 2 ? 0.38 : 0.19)) - 1);
    for (let i = 0; i < count; i++) {
      const xc = x0 + ((x1 - x0) * (i + 1)) / (count + 1);
      const reach = level === 2 ? across * 1.5 : across;
      b.prism([[xc - reach, 0], [xc, -across], [xc + reach, 0], [xc, across]], "y", low, high, "dressed", undefined, [(i * 0.37) % 1, (bay * 0.41 + i * 0.13) % 1]);
    }
  }
  return b;
}

/**
 * A ladder: two oak rails and a rung every 0.3 m, the rails shod and capped in iron. It stands on the wall's face,
 * where its row puts it, and reads its thickness and its place from the row.
 */
function ladder(form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const w = wallBox(form);
  const b = new Build();
  b.free = true;
  const at = form.off ?? 0;
  // Its back toward the wall, at -z of its own middle.
  const [back, front] = [at - w.half + 0.004, at + w.half - 0.006];
  const rail = 0.06;
  const [foot, top] = [w.foot, w.top - 0.01];
  for (const [k, s] of [-1, 1].entries()) {
    const [x0, x1] = s < 0 ? [w.x0, w.x0 + rail] : [w.x1 - rail, w.x1];
    const cp = level === 0 ? 0.01 : 0;
    const profile: P2[] = cp > 0 ? [[x0, back], [x1, back], [x1, front - cp], [x1 - cp, front], [x0 + cp, front], [x0, front - cp]] : [[x0, back], [x1, back], [x1, front], [x0, front]];
    b.convex(loft("y", [[foot, profile], [top, profile]]), "timber", (n) => straight(n, "y", [k * 0.37, k * 0.21]));
    if (level > 0) continue;
    // An iron shoe at its foot and a band at its head.
    for (const [y0, y1] of [[foot, foot + 0.1], [top - 0.14, top - 0.06]] as const) b.box([x0 - 0.004, y0, back], [x1 + 0.004, y1, front + 0.004], "iron");
  }
  if (level === 3) return b;
  const count = Math.max(1, Math.round((w.top - w.foot) / 0.3));
  const zc = (back + front) / 2 + 0.008;
  for (let i = 0; i < count; i++) {
    if (level === 2 && i % 2 === 1) continue;
    const y = w.foot + ((i + 0.5) * (w.top - w.foot)) / count;
    // A rung on edge, let into the rails.
    const h = level === 2 ? 0.032 : 0.02;
    b.prism([[zc - h, y], [zc, y - h * 1.2], [zc + h, y], [zc, y + h * 1.2]], "x", w.x0 + rail - 0.012, w.x1 - rail + 0.012, "timber", "x", [(i * 0.31) % 1, (i * 0.17) % 1]);
  }
  return b;
}

// Trims: what the client draws where pieces meet (client/core/render/trims.ts). A joint stands on its corner from the
// level up a storey and a centimetre, and is cut to a lower wall by setting every point over n quarter storeys and a
// centimetre down onto that height (piece-fit.ts). So a joint has a bed at each height it may be cut to, the stone
// under each of those beds is as wide as any over it, and its level faces all wear the picture alike: cut, what was
// over the bed lies flat on the stone under it and is not seen.

/** The beds of a joint's stones: a stone ends on each height a joint may be cut to, with one between each two. */
const JOINT_BEDS = [0, 0.36, 0.76, 1.11, 1.51, 1.86, 2.26, 2.61, 3.01] as const;
/** Half the width of a quoin's stones: the long ones, which end on the heights a joint is cut to, and the short ones between. */
const QUOIN_LONG = 0.165;
const QUOIN_SHORT = 0.13;
/** How far under its top a quoin's topmost stone begins to draw in. */
const QUOIN_CAP = 0.07;

/** A face of a trim given by its corners and the way it looks, shaded as a dressed block where `pillow` says how far its corners' normals lean from its middle. */
function trimFace(b: Build, pts: readonly Vec[], out: Vec, mat: string, uv: UvMap, pillow = 0): void {
  const mid = mean(pts);
  const n = unit(out);
  const normals = pillow > 0 ? pts.map((q) => unit(add(n, scale(unit(sub(sub(q, mid), scale(n, dot(sub(q, mid), n)))), pillow)))) : undefined;
  b.flat(pts, out, mat, uv, normals);
}

/** Level faces of a joint wear the picture by where they lie, so two that lie on one another are one to the eye. */
const levelUv: UvMap = (q) => [q[0] / TILE + 0.5, q[2] / TILE + 0.5];

/**
 * The square joint: a quoin. Dressed stones up the corner, long and short by turns: a long one stands 3.5 cm proud of
 * the short one under it on all four faces, so each wall that ends in the corner sees long and short work up its end.
 * The walls' ends lie inside it.
 */
function quoin(level: number): Build {
  const b = new Build();
  b.free = true;
  const high = JOINT_BEDS[JOINT_BEDS.length - 1]!;
  const square = (half: number, y: number): Vec[] => [[-half, y, -half], [half, y, -half], [half, y, half], [-half, y, half]];
  const sides: readonly Vec[] = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
  if (level === 3) {
    // Far off, a post of three sides: eight triangles close nothing wider.
    const three = Array.from({ length: 3 }, (_, k): P2 => [Math.cos((2 * Math.PI * k) / 3) * QUOIN_LONG * 1.6, Math.sin((2 * Math.PI * k) / 3) * QUOIN_LONG * 1.6]);
    b.convex(loft("y", [[0, three], [high, three]]), "dressed", (n) => straight(n));
    return b;
  }
  const mean2 = (QUOIN_LONG + QUOIN_SHORT) / 2;
  if (level === 2) {
    b.box([-mean2, 0, -mean2], [mean2, high, mean2], "dressed");
    return b;
  }
  const g = rng("quoin");
  /** The upright faces between two rings, each a stone's face with its own place in the picture. */
  const band = (lower: readonly Vec[], upper: readonly Vec[], pillow: number): void => {
    for (let k = 0; k < 4; k++) {
      const shift: P2 = [g.uniform(0, 1), g.uniform(0, 1)];
      const pts = [lower[k]!, lower[(k + 1) % 4]!, upper[(k + 1) % 4]!, upper[k]!];
      const across: Vec = [-sides[k]![2], 0, sides[k]![0]];
      trimFace(b, pts, sides[k]!, "dressed", (q) => [dot(q, across) / TILE + shift[0], -q[1] / TILE + shift[1]], pillow);
    }
  };
  /** The level ring between two squares at one height, looking up or down. */
  const ledge = (inner: readonly Vec[], outer: readonly Vec[], up: number): void => {
    for (let k = 0; k < 4; k++) trimFace(b, [inner[k]!, inner[(k + 1) % 4]!, outer[(k + 1) % 4]!, outer[k]!], [0, up, 0], "dressed", levelUv);
  };
  trimFace(b, square(level === 0 ? QUOIN_SHORT : mean2, 0), [0, -1, 0], "dressed", levelUv);
  if (level === 1) {
    // One shaft with a ring at each height it may be cut to, each length shaded as a stone.
    const heights = JOINT_BEDS.filter((_, i) => i % 2 === 0);
    heights.slice(1).forEach((y1, i) => band(square(mean2, heights[i]!), square(mean2, y1), 0.18));
    trimFace(b, square(mean2, high), [0, 1, 0], "dressed", levelUv);
    return b;
  }
  JOINT_BEDS.slice(1).forEach((y1, i) => {
    const y0 = JOINT_BEDS[i]!;
    const long = i % 2 === 1;
    const half = long ? QUOIN_LONG : QUOIN_SHORT;
    const last = i === JOINT_BEDS.length - 2;
    band(square(half, y0), square(half, last ? y1 - QUOIN_CAP : y1), 0.22);
    if (!long) return;
    // A long stone's bed and its top, out past the short stones under and over it. Its top is level to its arris:
    // weathered, the stones folded onto it by a cut would stand out over the slope.
    ledge(square(QUOIN_SHORT, y0), square(half, y0), -1);
    if (!last) return ledge(square(QUOIN_SHORT, y1), square(half, y1), 1);
    // The topmost stone alone is weathered, in to a flat that an eave's course covers.
    band(square(half, y1 - QUOIN_CAP), square(QUOIN_SHORT - 0.03, y1), 0);
    trimFace(b, square(QUOIN_SHORT - 0.03, y1), [0, 1, 0], "dressed", levelUv);
  });
  return b;
}

/**
 * A round joint: a pier of dressed drums, twelve sides shaded round, a drum to each quarter storey so that a bed lies
 * at each height it may be cut to. `reach` is from the corner to its arrises, and an arris lies `turn` round from +x.
 */
function pier(level: number, reach: number, turn: number, key: string): Build {
  const b = new Build();
  b.free = true;
  const high = JOINT_BEDS[JOINT_BEDS.length - 1]!;
  if (level === 3) {
    const three = Array.from({ length: 3 }, (_, k): P2 => [Math.cos((2 * Math.PI * k) / 3) * reach * 1.2, Math.sin((2 * Math.PI * k) / 3) * reach * 1.2]);
    b.convex(loft("y", [[0, three], [high, three]]), "dressed", (n) => straight(n));
    return b;
  }
  if (level === 2) {
    const half = reach * 0.8;
    b.box([-half, 0, -half], [half, high, half], "dressed");
    return b;
  }
  const g = rng("pier", key);
  const nought = (c: number): number => (Math.abs(c) < 1e-12 ? 0 : c);
  const at = (k: number, y: number): Vec => [nought(Math.cos(turn + (Math.PI * (k % 12)) / 6) * reach), y, nought(Math.sin(turn + (Math.PI * (k % 12)) / 6) * reach)];
  const out = (k: number, lean: number): Vec => unit([Math.cos(turn + (Math.PI * k) / 6), lean, Math.sin(turn + (Math.PI * k) / 6)]);
  const heights = level === 0 ? JOINT_BEDS.filter((_, i) => i % 2 === 0) : [0, high];
  heights.slice(1).forEach((y1, i) => {
    const y0 = heights[i]!;
    const shift: P2 = [g.uniform(0, 1), g.uniform(0, 1)];
    // A drum's normals lean out of its beds, so a bed is seen where two drums' shading meets.
    const lean = level === 0 ? 0.14 : 0;
    for (let k = 0; k < 12; k++) {
      const pts = [at(k, y0), at(k + 1, y0), at(k + 1, y1), at(k, y1)];
      const mid = out(k + 0.5, 0);
      // The picture goes round with the pier, a face to each twelfth of its girth.
      const us = [(k * Math.PI * reach) / 6 / TILE + shift[0], ((k + 1) * Math.PI * reach) / 6 / TILE + shift[0]];
      const normals = [out(k, -lean), out(k + 1, -lean), out(k + 1, lean), out(k, lean)];
      const back = dot(newell(pts), mid) < 0;
      const order = back ? [3, 2, 1, 0] : [0, 1, 2, 3];
      b.shape.face({ points: order.map((j) => [pts[j]![0], -pts[j]![2], pts[j]![1]] as Vec), uvs: order.map((j) => [us[j === 0 || j === 3 ? 0 : 1]!, 1 - (-pts[j]![1] / TILE + shift[1])] as const), mat: "dressed", normals: order.map((j) => [normals[j]![0], -normals[j]![2], normals[j]![1]] as Vec) });
    }
  });
  const ring = (y: number): Vec[] => Array.from({ length: 12 }, (_, k) => at(k, y));
  trimFace(b, ring(0), [0, -1, 0], "dressed", levelUv);
  trimFace(b, ring(high), [0, 1, 0], "dressed", levelUv);
  return b;
}

/** The skirt's section, out from the foundation's side and down from its top: a weathered top, a nose, a drip under it, and a battered face down to its foot. */
const SKIRT: readonly P2[] = [[0, -0.02], [0.105, -0.085], [0.105, -0.17], [0.086, -0.19], [0.12, -2.4], [0, -2.4]];
/** The skirt turns its section round each end of its side in these steps, in degrees from the way out: two skirts at any outside corner close it between them, and their steps do not fall on one another. */
const SKIRT_TURN = [90, 50, 0] as const;

/**
 * The skirt under a foundation's open side: a plinth course. A dressed water table, its top weathered, over a
 * battered face of walling that goes down into the ground. It hangs from the middle of the side, +X along it and +Z
 * out, and at each end it turns a quarter round the corner.
 */
function skirt(level: number): Build {
  const b = new Build();
  b.free = true;
  const face: UvMap = (q) => [(q[0] + H) / TILE, (-0.19 - q[1]) / TILE];
  if (level === 3) {
    // Its face alone: two triangles close nothing.
    const [top, foot] = [SKIRT[1]!, SKIRT[4]!];
    b.flat([[-H, foot[1], foot[0]], [H, foot[1], foot[0]], [H, top[1], top[0]], [-H, top[1], top[0]]], [0, 0, 1], "masonry", face);
    return b;
  }
  if (level === 2) {
    b.convex(loft("x", [[-H, [SKIRT[0]!, SKIRT[1]!, SKIRT[4]!]], [H, [SKIRT[0]!, SKIRT[1]!, SKIRT[4]!]]]), (n) => (n[1] > 0.3 ? "dressed" : "masonry"), (n) => (n[2] > 0.5 ? face : straight(n)));
    return b;
  }
  const section = level === 0 ? SKIRT : [SKIRT[0]!, SKIRT[1]!, SKIRT[3]!, SKIRT[4]!, SKIRT[5]!];
  const mats = level === 0 ? ["dressed", "dressed", "dressed", "masonry", "masonry"] : ["dressed", "dressed", "masonry", "masonry"];
  const steps = level === 0 ? SKIRT_TURN : [90, 0];
  const from = b.shape.faces.length;
  /** The way a part of the section looks, in (z, y): it goes round with the solid on its right. */
  const outOf = (k: number): P2 => {
    const [a, c] = [section[k]!, section[k + 1]!];
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    return [-(c[1] - a[1]) / l, (c[0] - a[0]) / l];
  };
  const dressedUv: UvMap = (q) => [(q[0] + H) / TILE, 0.5 + (q[1] - q[2]) / TILE];
  for (let k = 0; k + 1 < section.length; k++) {
    const [a, c] = [section[k]!, section[k + 1]!];
    const o = outOf(k);
    const out: Vec = [0, o[1], o[0]];
    const quad = (x0: number, x1: number): Vec[] => [[x0, a[1], a[0]], [x1, a[1], a[0]], [x1, c[1], c[0]], [x0, c[1], c[0]]];
    if (level === 0 && k < 2) {
      // The water table's stones, each shaded as a block.
      const g = rng("skirt stones");
      const cuts = [-H, ...[0.19, 0.4, 0.62, 0.81].map((f) => -H + TILE * (f + g.uniform(-0.03, 0.03))), H];
      cuts.slice(1).forEach((x1, i) => trimFace(b, quad(cuts[i]!, x1), out, "dressed", dressedUv, 0.16));
    } else if (level === 0 && k === 3) {
      // The battered face: its top course a cell to a stone, and under it the picture plain.
      const down = unit([0, c[1] - a[1], c[0] - a[0]]);
      const frame = new Frame([-H, a[1], a[0]], [1, 0, 0], down, out);
      const reach = Math.hypot(c[0] - a[0], c[1] - a[1]);
      tiles(b, frame, [...wallTiles(frame, (st) => st.course === 0), { poly: cell(0, TILE, BEDS[1]!, reach), mat: "masonry" }], [within2(0, TILE, 0, reach)]);
    } else trimFace(b, quad(-H, H), out, mats[k]!, mats[k] === "dressed" ? dressedUv : face);
    // Round each end, about the upright line through the side's own end.
    for (const end of [-1, 1]) {
      for (let s = 0; s + 1 < steps.length; s++) {
        const turned = (q: P2, degrees: number): Vec => [end * (H + q[0] * Math.cos((degrees * Math.PI) / 180)), q[1], q[0] * Math.sin((degrees * Math.PI) / 180)];
        const half = ((steps[s]! + steps[s + 1]!) / 2) * (Math.PI / 180);
        const way: Vec = [end * o[0] * Math.cos(half), o[1], o[0] * Math.sin(half)];
        const pts = [turned(a, steps[s]!), turned(a, steps[s + 1]!), turned(c, steps[s + 1]!), turned(c, steps[s]!)];
        trimFace(b, pts, way, mats[k]!, mats[k] === "dressed" ? dressedUv : (q) => [(q[0] + H + end * q[2]) / TILE, (-0.19 - q[1]) / TILE]);
      }
    }
  }
  // Its back, against the foundation and the next skirt's end: the side's own length, and the section at each end.
  const [top, foot] = [section[0]![1], section[section.length - 1]![1]];
  b.flat([[-H, foot, 0], [H, foot, 0], [H, top, 0], [-H, top, 0]], [0, 0, -1], "masonry");
  for (const end of [-1, 1]) b.flat(section.map(([z, y]): Vec => [end * (H + z), y, 0]), [0, 0, -1], "masonry");
  b.shape.weld(from);
  return b;
}

/**
 * The capping along a ridge where two roofs' high sides meet: saddle stones of dressed stone, six to a side's length,
 * each shaded as a block. It lies along x on the ridge's own line, which is at its origin's height. No client draws it yet.
 */
function ridgeStones(level: number): Build {
  const b = new Build();
  b.free = true;
  const [wide, top, drop, thick] = [0.22, 0.075, 0.068, 0.034];
  const uv: UvMap = (q) => [(q[0] + H) / TILE, 0.5 + q[2] / TILE];
  if (level === 3) {
    b.flat([[-H, 0.02, -wide], [H, 0.02, -wide], [H, 0.02, wide], [-H, 0.02, wide]], [0, 1, 0], "dressed", uv);
    return b;
  }
  if (level === 2) {
    b.convex(loft("x", [[-H, [[0, top], [wide, -drop], [-wide, -drop]]], [H, [[0, top], [wide, -drop], [-wide, -drop]]]]), "dressed", () => uv);
    return b;
  }
  const from = b.shape.faces.length;
  // Its section in (z, y): the two wings' tops, their edges and their undersides.
  const section: P2[] = [[0, top], [wide, -drop], [wide, -drop - thick], [0, top - thick], [-wide, -drop - thick], [-wide, -drop]];
  const g = rng("ridge stones");
  const cuts = level === 0 ? [-H, ...[1, 2, 3, 4, 5].map((i) => -H + (TILE * (i + g.uniform(-0.12, 0.12))) / 6), H] : [-H, H];
  section.forEach((a, k) => {
    const c = section[(k + 1) % section.length]!;
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    // It goes round with the stone on its right as it is seen from +x.
    const out: Vec = [0, (c[0] - a[0]) / l, -(c[1] - a[1]) / l];
    const tops = k === 0 || k === 5;
    for (let i = 0; i + 1 < (tops ? cuts.length : 2); i++) {
      const [x0, x1] = tops ? [cuts[i]!, cuts[i + 1]!] : [-H, H];
      trimFace(b, [[x0, a[1], a[0]], [x1, a[1], a[0]], [x1, c[1], c[0]], [x0, c[1], c[0]]], out, "dressed", uv, tops && level === 0 ? 0.2 : 0);
    }
  });
  // Each end in two parts, one to a wing.
  for (const [x, way] of [[-H, -1], [H, 1]] as const) for (const part of [[0, 1, 2, 3], [0, 3, 4, 5]]) b.flat(part.map((k): Vec => [x, section[k]![1], section[k]![0]]), [way, 0, 0], "dressed", (q) => [0.5 + q[2] / TILE, 0.5 + q[1] / TILE]);
  b.shape.weld(from);
  return b;
}

/** Stone's trims by the names the client finds them under, each at its four levels. */
function stoneTrims(): Record<string, Shape[]> {
  const levels = (make: (level: number) => Build): Shape[] => [0, 1, 2, 3].map((level) => make(level).shape);
  return {
    joint_sq: levels(quoin),
    // A flat faces each wall at 120 and 150 degrees, and an arris lies in the notch between two walls at 60, where the wider pier is.
    joint_r15: levels((level) => pier(level, 0.17, Math.PI / 12, "r15")),
    joint_r21: levels((level) => pier(level, 0.22, 0, "r21")),
    skirt: levels(skirt),
    ridge: levels(ridgeStones),
  };
}

type Maker = (name: string, form: FormDef, level: number) => Build | null;
/** A form that stands as a wall does, each of its levels with its foot sunk under its box as a wall's is. */
const footed = (make: Maker): Maker => (name, form, level) => {
  const b = make(name, form, level);
  return b && sunk(b, wallBox(form).foot);
};

/** The forms past the first nine, by name. */
const PLANNED: Readonly<Record<string, Maker>> = {
  half_wall: footed(lowWall),
  quarter_wall: footed(lowWall),
  fence_foundation: (_, form, level) => footing(form, level),
  beam: (_, form, level) => archBeam(form, level),
  sloped_wall_left: footed((_, form, level) => gable(form, level)),
  sloped_wall_right: footed((_, form, level) => gable(form, level)),
  double_doorway: footed(wideDoorway),
  large_wall: footed(tallWall),
  gateway: footed(gatehouse),
  gate: (_, form, level) => gate(form, level),
  gate_open: (_, form, level) => gate(form, level),
  double_door: (_, form, level) => doubleDoor(form, level),
  double_door_open: (_, form, level) => doubleDoor(form, level),
  trapdoor_open: (_, form, level) => hatch(form, level),
  triangle_foundation: plinthed,
  quarter_foundation: plinthed,
  triangle_ceiling: triCeiling,
  trapdoor_frame: hatchFrame,
  trapdoor: (_, form, level) => hatch(form, level),
  ramp,
  thin_pillar: (_, form, level) => column(form, level),
  railing: (_, form, level) => balustrade(form, level),
  ladder: (_, form, level) => ladder(form, level),
  roof: (_, form, level) => roof(form, level),
  roof_hip: (_, form, level) => roof(form, level),
  roof_valley: (_, form, level) => roof(form, level),
  triangle_roof: (_, form, level) => roof(form, level),
  triangle_roof_low: (_, form, level) => roof(form, level),
};

export const STONE: TierRecipe = {
  name: "stone",
  rank: 2,
  runPost: false,
  jointHalf: QUOIN_LONG,
  // Each is a palette entry (shared/pack/palette.ts), so the match is exact.
  tones: { masonry: [157, 153, 147], flags: [128, 128, 128], dressed: [203, 201, 175], timber: [125, 87, 69], iron: [46, 43, 36] },
  split(name, form, level) {
    const made = (): Build | null => {
      const planned = PLANNED[name];
      if (planned) return planned(name, form, level);
      if (form.layer === "wall") return wallFamily(name, form, level);
      if (form.layer === "slab" && form.root === "always") return foundation(form, level);
      if (form.layer === "slab" && form.outline.length === 4 && !form.corner && !form.openings) return ceiling(form, level);
      if (form.layer === "post") return pillar(form, level);
      if (form.layer === "leaf" && form.plane !== "flat") return door(form, level);
      if (form.layer === "fill" && form.steps !== undefined) return stairs(form, level);
      throw new Error(`stone has no recipe for ${name} yet`);
    };
    return made()?.shape ?? null;
  },
  trims: stoneTrims,
};
