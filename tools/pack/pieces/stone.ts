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
import { Carved, add, cross, dot, scale, sub, unit, type Uv, type Vec } from "./kit.ts";
import { yieldPlanes, type TierRecipe } from "./lod.ts";
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
function block(front: readonly P2[], back: readonly P2[], bevel: number, riseFront: readonly number[], riseBack: readonly number[]): Side[] {
  const n = front.length;
  const bev = front.map(() => bevel);
  const Pf = front.map(([x, y]): Vec => [x, y, CORE]);
  const Tf = inset(front, bev).map(([x, y], i): Vec => [x, y, CORE + riseFront[i]!]);
  const Pb = back.map(([x, y]): Vec => [x, y, -CORE]);
  const Tb = inset(back, bev).map(([x, y], i): Vec => [x, y, -CORE - riseBack[i]!]);
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

  /** A face already looking outward. Texture coordinates are held inside the picture, as the scripts held them. */
  face(pts: readonly Vec[], mat: string, uv: UvMap, normals?: readonly Vec[], along?: number): void {
    const keep: number[] = [];
    pts.forEach((p, i) => {
      if (keep.length === 0 || apart(p, pts[keep[keep.length - 1]!]!)) keep.push(i);
    });
    while (keep.length > 1 && !apart(pts[keep[0]!]!, pts[keep[keep.length - 1]!]!)) keep.pop();
    if (keep.length < 3) return;
    const kit = (p: Vec): Vec => [p[0], -p[2], p[1]];
    const held = (c: number): number => Math.min(Math.max(c, 0), 1);
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
  /** The wall's outline keeps its crowns as geometry: the stones cut at the span's edge along the cut, and the top course whole. */
  outline?: boolean;
}

/** A shaped stone on a frame, in both halves where it runs past the span's edge, cut to the half-spaces in `keep`. */
function lay(b: Build, frame: Frame, s: Stone, look: Look, mat: string, o: Laying = {}): void {
  const wraps = Math.max(...s.footprint.map((p) => p[0])) > TILE + 1e-9;
  const [base, face] = breaksOf(s, o.notch ?? Infinity, o.facet ?? Infinity);
  for (const shift of wraps ? [0, -TILE] : [0]) {
    const risen = o.outline === true && s.course === 0;
    let sides = stoneSides(frame, s.footprint, base, face, look, shift, risen);
    const planes = [...(o.keep ?? [])];
    if (wraps) planes.push(shift === 0 ? keepBelow(frame, TILE) : keepAbove(frame, 0));
    for (const plane of planes) sides = clipSolid(sides, plane);
    if (wraps && o.outline && !risen) sides = crownedCut(sides, frame, s.footprint, look, shift, planes[planes.length - 1]!);
    // The footprint is the first face, and stays so through every cut.
    if (o.least !== undefined && sides.length >= 4 && Math.abs(area2(sides[0]!.pts.map((p) => frame.on(p)))) < o.least) continue;
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
function throughBlock(b: Build, { front, back, rise }: Through, mat: string, grain?: string): void {
  const z = CORE + rise.reduce((sum, r) => sum + r, 0) / rise.length;
  const rect = (outline: readonly P2[], at: number): Vec[] => {
    const [x0, x1, y0, y1] = box2(outline);
    return [[x0, y0, at], [x1, y0, at], [x1, y1, at], [x0, y1, at]];
  };
  const [f, k] = [rect(front, z), rect(back, -z)];
  b.convex([{ pts: f }, { pts: k }, ...f.map((q, i) => ({ pts: [q, f[(i + 1) % 4]!, k[(i + 1) % 4]!, k[i]!] }))], mat, throughUv(grain));
}

/** A wall, a doorframe or a windowframe with every stone a solid of its own. */
function wallFine(o: Opening | null): Build {
  const b = new Build();
  b.rings = [[0, -H + T], [0, H - T]];
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
  // The rim has a corner on each yield ring, but for a flat level, which has none.
  const rings = whole ? [] : [-H + T, H - T];
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

/** A wall-family piece with each face one flat sheet, every stone a cell of it shaded as its crown. */
function wallSheet(o: Opening | null): Build {
  const b = new Build();
  b.rings = [[0, -H + T], [0, H - T]];
  sheet(b, o, { cells: (frame) => [...wallTiles(frame, beside(o)), ...(o ? frameTiles(o) : [])], half: CORE + FACE });
  if (!o) return b;
  // The jamb stones and the lintel stand proud of the sheet as plain blocks.
  for (const jamb of jambsOf(o)) throughBlock(b, jamb, "dressed");
  throughBlock(b, lintelOf(o), "timber", "x");
  sillOrThreshold(b, o, 1);
  return b;
}

/** A wall-family piece as a plain solid that wears the pictures: its walling whole, the jambs a column each side, the lintel over them. */
function wallPlain(o: Opening | null): Build {
  const b = new Build();
  // Cut at the yield rings, so no cell crosses one.
  const strips = (u0: number, u1: number, v0: number, v1: number): Tile[] => {
    const us = [u0, ...[T, TILE - T].filter((u) => u > u0 + 1e-9 && u < u1 - 1e-9), u1];
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

function wallFamily(name: string, form: FormDef, level: number): Build | null {
  const o = openingOf(name, form);
  if (level === 0) return wallFine(o);
  if (level === 1) return wallSheet(o);
  if (level === 2) return wallPlain(o);
  if (level === 3 && o) return wallFar(o);
  if (level > (o ? 4 : 3)) return null;
  const b = new Build();
  b.box([-H, -H, -T], [H, H, T], "masonry");
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
/** An open door stands at a right angle on its hinge at the doorway's left, swung toward the front. */
const PIVOT: P2 = [-0.68, 0.02];

function door(form: FormDef, level: number): Build | null {
  if (level > 3) return null;
  const b = new Build();
  const [u0, v0, u1, v1] = outlineBox(form);
  if (Math.abs(u1 - u0 - 2 * DW) > 1e-9) throw new Error("stone's door is five planks 1.4 m across");
  const dh = (v1 - v0) / 2;
  if (form.plane === "across") b.turn = ([x, y, z]) => [PIVOT[0] - (z - PIVOT[1]), y, PIVOT[1] + (x - PIVOT[0])];
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
  for (const yc of straps) {
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

export const STONE: TierRecipe = {
  name: "stone",
  rank: 2,
  runPost: false,
  jointHalf: T,
  // Each is a palette entry (shared/pack/palette.ts), so the match is exact.
  tones: { masonry: [157, 153, 147], flags: [128, 128, 128], dressed: [203, 201, 175], timber: [125, 87, 69], iron: [46, 43, 36] },
  split(name, form, level) {
    const made = (): Build | null => {
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
};
