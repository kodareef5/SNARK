// The wood tier's recipe: a frame of hewn timber, pegged and bolted; weatherboards of uneven width with wavy lower
// edges, nailed at both ends and lapped bay by bay; floors of loose-laid boards on beams; iron where weight bears.
// Ported from the tier's Blender scripts (assets/source/core/structures/wood/model.py and parts.py), drawing from the
// same seeds, so its timbers and boards are the ones those made. It works in their frame: z up, the front at -y.
//
// Levels: 0 is everything, hewn and bowed; 1 is the same boards straight on squared timbers, without pegs or iron;
// 2 is the frame as boxes over panels that wear the boards' picture; 3 and 4 are plain solids in flat colours.
//
// Texture coordinates are metres over the tile, from the corner of the piece's 3 m cell. Boards, deck and timber tile
// every 3 m, one tile to a wall, and fittings every 1 m: 683 and 2,048 pixels a metre at 2,048 pixels.

import { HALF_SIDE_M, outlineBox, type FormDef } from "../../../shared/world/lattice/forms.ts";
import { Shape, add, beamRings, cross, dot, length, roundEven, scale, sub, unit, widths, type FaceMap, type Uv, type Vec } from "./kit.ts";
import type { TierRecipe } from "./lod.ts";
import { PyRandom } from "./mt.ts";

const H = HALF_SIDE_M;
const TILE: Readonly<Record<string, number>> = { boards: 2 * H, deck: 2 * H, timber: 2 * H, fittings: 1 };
/** The boards picture's board lines are 85 pixels down from twelfths of it, and its nail columns a quarter and three quarters across. */
const BOARD_ROLL_V = 85 / 2048;
const BOARD_NAILS = 0.25;

const WALL_T = 0.1; // half the wall's thickness
const PLATE_T = 0.09; // posts and plates
const SILL_T = 0.095;
const TOP_T = 0.1; // the top plate, the heaviest member, out to the wall's faces
const JAMB_T = 0.096; // jambs, lintels and window timbers stand a little proud
const MID_T = 0.087; // a wall's middle post stands a little back
const BRACE_T = 0.08;
const BOARD_TOP = 0.04; // a weatherboard's face at its top, and at its lapped lower edge
const BOARD_LIP = 0.074;
const PANEL_T = (BOARD_TOP + BOARD_LIP) / 2; // a bay drawn as one panel
const ROW = 0.25; // the boards and deck pictures have twelve boards to their 3 m tile
const POST = 0.14; // half a corner post: two walls side by side make a 0.28 m post
const MID = 0.08; // half a wall's middle post
const PLATE = 0.24;
const SILL = 0.22;
const STRAP = 0.0625;
const DROP = 0.02; // the top plate stands this far under the wall's top, and the sill reaches as far under its foot
const ROUGH = 0.011; // how far a hewn timber strays from true
const WAVE = 0.016; // how far a board's lower edge wanders
const SINK = 0.03; // a pillar's top stands this far under its box
const BOX_ERROR = 0.085; // how far a wall's plain box lies from the wall, as the check measures it
const Z: Vec = [0, 0, 1];
const Y: Vec = [0, 1, 0];
const X: Vec = [1, 0, 0];
type Bands = readonly [number, number, number, number];
type Cell = readonly [number, number];

/** The middle of band `band` of a twelve-band sheet, counted from its top. */
const bandV = (band: number): number => 1 - (band + 0.5) / 12;
/** Fittings: end grain cells in the top half, iron bands in the bottom half. */
const CELL = 0.25;
const IRON: Readonly<Record<string, number>> = { plate: 0.4375, rivets: 0.34375, strap: 0.28125, nails: 0.21875 };
const cellUv = (col: number, row: number): Uv => [(col + 0.5) * CELL, 1 - (row + 0.5) * CELL];
const PEG_UV = cellUv(3, 0);
const BOLT_UV: Uv = [0.31, 0.34];

/** Boards or deck on the building grid, u to the right as each face is seen. */
function grid(mat: string): FaceMap {
  const t = TILE[mat]!;
  return (label) => [mat, {
    "-y": (p: Vec): Uv => [(p[0] + H) / t, (p[2] + H) / t],
    "+y": (p: Vec): Uv => [(H - p[0]) / t, (p[2] + H) / t],
    "+x": (p: Vec): Uv => [(p[1] + H) / t, (p[2] + H) / t],
    "-x": (p: Vec): Uv => [(H - p[1]) / t, (p[2] + H) / t],
    "+z": (p: Vec): Uv => [(p[0] + H) / t, (p[1] + H) / t],
    "-z": (p: Vec): Uv => [(p[0] + H) / t, (H - p[1]) / t],
  }[label]!];
}

const AXIS: Readonly<Record<string, number>> = { x: 0, y: 1, z: 2 };

/** A timber with its grain along `axis`, its long faces centred on one band of the sheet, its ends end grain cell `end` or timber. */
function beam(axis: string, band: number, offset = H, end: Cell | null = null, mat = "timber"): FaceMap {
  const a = AXIS[axis]!;
  return (label, lo, hi) => {
    const n = AXIS[label[1]!]!;
    const mid = scale(add(lo, hi), 0.5);
    const t = TILE[mat]!;
    if (n === a) {
      const [o0, o1] = [0, 1, 2].filter((k) => k !== a) as [number, number];
      if (end) {
        const [cu, cv] = cellUv(end[0], end[1]);
        return ["fittings", (p) => [cu + (p[o0]! - mid[o0]!), cv + (p[o1]! - mid[o1]!)]];
      }
      return [mat, (p) => [0.5 + (p[o0]! - mid[o0]!) / t, bandV(band) + (p[o1]! - mid[o1]!) / t]];
    }
    const across = 3 - a - n;
    return [mat, (p) => [(p[a]! + offset) / t, bandV(band) + (p[across]! - mid[across]!) / t]];
  };
}

/** An iron strap or plate along `axis`, u in metres from `start`. */
function iron(axis: string, kind: string, start: number): FaceMap {
  const a = AXIS[axis]!;
  return (label, lo, hi) => {
    const n = AXIS[label[1]!]!;
    const mid = scale(add(lo, hi), 0.5);
    const across = n !== a ? 3 - a - n : (a + 1) % 3;
    return ["fittings", (p) => [p[a]! - start, IRON[kind]! + (p[across]! - mid[across]!)]];
  };
}

const custom = (mat: string, fn: (label: string, p: Vec, lo: Vec, hi: Vec) => Uv): FaceMap => (label, lo, hi) => [mat, (p) => fn(label, p, lo, hi)];
/** A flat level's face: a colour and nothing else. */
const tone = (mat: string): FaceMap => () => [mat, () => [0, 0]];

interface TimberOpts {
  end?: Cell | null;
  chamfer?: number;
  rough?: number;
  seed?: number;
  segs?: number;
  along0?: number;
  mat?: string;
}

/** A squared timber from a to b, each long face on its own band of the timber sheet, its ends end grain cell `end` or timber. */
function timber(p: Shape, a: Vec, b: Vec, w: number, h: number, up: Vec, bands: Bands, o: TimberOpts = {}): void {
  const { end = null, chamfer = 0.016, rough = 0, seed = 0, segs, along0 = 0, mat = "timber" } = o;
  const { rings, base, length: len, n, c, hw, hh } = beamRings(new PyRandom(seed), a, b, w, h, up, chamfer, rough, segs);
  const k2 = c * Math.SQRT2;
  // Each strip's texture coordinate across it, from its first point to its second.
  const acrossOf: readonly (readonly [number, number, number])[] = c > 0
    ? [[bands[0], -hh + c, hh - c], [bands[0], hh - c, hh - c + k2], [bands[1], hw - c, -hw + c], [bands[1], -hw + c, -hw + c - k2], [bands[2], hh - c, -hh + c], [bands[2], -hh + c, -hh + c - k2], [bands[3], -hw + c, hw - c], [bands[3], hw - c, hw - c + k2]]
    : [[bands[0], -hh, hh], [bands[1], hw, -hw], [bands[2], hh, -hh], [bands[3], -hw, hw]];
  p.loft(rings, (k, i, j) => {
    const [band, v0, v1] = acrossOf[k]!;
    return [mat, [(along0 + (len * i) / n) / 3, bandV(band) + (j === k ? v0 : v1) / 3]];
  }, (_, j) => {
    const [s, q] = base[j]!;
    if (end && mat === "timber") return ["fittings", [cellUv(end[0], end[1])[0] + s, cellUv(end[0], end[1])[1] + q]];
    return [mat, [0.5 + s / 3, bandV(bands[0]) + q / 3]];
  });
}

/**
 * A timber: hewn and chamfered on the finest level, squared on the rest. Past the finest its ends are timber too,
 * so a level is drawn with one material fewer, unless `grain` keeps the end grain that marks it from afar.
 */
function member(p: Shape, level: number, a: Vec, b: Vec, w: number, h: number, up: Vec, bands: Bands, end: Cell | null = null, seed = 0, rough = ROUGH, along0 = 0, grain = false): void {
  if (level === 0) timber(p, a, b, w, h, up, bands, { end, rough, seed, along0 });
  else timber(p, a, b, w, h, up, bands, { end: grain ? end : null, chamfer: 0, along0 });
}

/** A timber along a curved path of points, its sections square to the path: an arched brace. */
function bent(p: Shape, path: readonly Vec[], w: number, h: number, up: Vec, band: number, chamfer = 0.014): void {
  const upv = unit(up);
  const [hw, hh, c] = [w / 2, h / 2, chamfer];
  const base: Cell[] = [[hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh], [hw - c, -hh]];
  const along: number[] = [];
  let run = 0;
  const rings = path.map((q, i) => {
    const d = unit(sub(path[Math.min(i + 1, path.length - 1)]!, path[Math.max(i - 1, 0)]!));
    const across = unit(cross(d, upv));
    if (i) run += length(sub(q, path[i - 1]!));
    along.push(run);
    return base.map(([s, t]) => add(add(q, scale(across, s)), scale(upv, t)));
  });
  p.loft(rings, (k, i, j) => {
    const [s, t] = base[j]!;
    return ["timber", [along[i]! / 3, bandV(band + ((k >> 1) % 2)) + ([0, 1, 4, 5].includes(k) ? t : s) / 3]];
  }, (_, j) => ["timber", [0.5 + base[j]![0] / 3, bandV(band) + base[j]![1] / 3]]);
}

/** A short many-sided stud standing `height` out of a face along `normal`: a peg's end, a bolt head, a hinge's knuckle. */
function stud(p: Shape, centre: Vec, normal: Vec, radius: number, height: number, sides: number, uv: Uv): void {
  const n = unit(normal);
  const a = unit(Math.abs(n[2]) < 0.9 ? cross(Z, n) : X);
  const b = cross(n, a);
  const loop = Array.from({ length: sides }, (_, k) => add(scale(a, Math.cos((2 * Math.PI * (k + 0.5)) / sides) * radius), scale(b, Math.sin((2 * Math.PI * (k + 0.5)) / sides) * radius)));
  const rings = [loop.map((q) => add(sub(centre, scale(n, 0.004)), q)), loop.map((q) => add(add(centre, scale(n, height)), scale(q, 0.92)))];
  p.loft(rings, (_, i, j) => ["fittings", [uv[0] + dot(loop[j]!, a), uv[1] + dot(loop[j]!, b) * 0.3 + (i - 0.5) * height]], (_, j) => ["fittings", [uv[0] + dot(loop[j]!, a), uv[1] + dot(loop[j]!, b)]]);
}

/** One weatherboard of a bay as the scripts drew it: where it lies and how its lower edge wanders along each length. */
interface Board {
  z: number;
  w: number;
  row: number;
  lip: number;
  top: number;
  first: boolean;
  spans: { a: number; b: number; wander: number[] }[];
}

/** The boards of one bay between two posts, from z0 on the sill to z1 under the plate, each its own width. */
function boardsOf(x0: number, x1: number, z0: number, z1: number, seed: number, foot: number): Board[] {
  const rng = new PyRandom(seed);
  const n = Math.max(1, roundEven((z1 - z0) / 0.25));
  const out: Board[] = [];
  let z = z0;
  widths(rng, z1 - z0, n, 0.2).forEach((w, k) => {
    const row = Math.min(11, Math.max(0, Math.floor((z + w / 2 - foot) / ROW)));
    const lip = BOARD_LIP + rng.uniform(-0.005, 0.003);
    const top = k < n - 1 ? Math.min(z + w + 0.03, z1) : z1;
    let spans: [number, number][] = [[x0, x1]];
    // Some are two lengths butted together.
    if (x1 - x0 > 0.9 && rng.random() < 0.17) {
      const cut = x0 + (x1 - x0) * rng.uniform(0.3, 0.7);
      spans = [[x0, cut - 0.002], [cut + 0.002, x1]];
    }
    out.push({ z, w, row, lip, top, first: k === 0, spans: spans.map(([a, b]) => ({ a, b, wander: Array.from({ length: b - a > 0.5 ? 4 : 3 }, () => rng.uniform(-WAVE, WAVE)) })) });
    z += w;
  });
  return out;
}

/**
 * Weatherboards across one bay, on both faces. The boards picture has nail columns every 1.5 m; each board is laid on
 * it so a column falls 6 cm inside each of its ends, where it is nailed to the post. The finest level's lower edges
 * wander through three rings on a long board and two on a short one; the next level's are straight.
 */
function bay(p: Shape, level: number, x0: number, x1: number, z0: number, z1: number, seed: number, u0: number, foot: number): void {
  const [start, finish] = [u0 - 0.06 / 3, u0 + 0.5 + 0.06 / 3];
  for (const board of boardsOf(x0, x1, z0, z1, seed, foot)) {
    const { w, row, lip, top } = board;
    const lengths = level === 0 ? board.spans : [{ a: x0, b: x1, wander: [0, 0] }];
    for (const { a, b, wander } of lengths) {
      // The scripts drew four rings on a long board: its two inner ones are met in the middle here.
      const at = level > 0 ? [0, 0] : b - a > 1 ? [wander[0]!, wander.length === 4 ? (wander[1]! + wander[2]!) / 2 : wander[1]!, wander[wander.length - 1]!] : [wander[0]!, wander[wander.length - 1]!];
      const xs = at.map((_, i) => a + ((b - a) * i) / (at.length - 1));
      // The lowest board sits on the sill: it may only rise.
      const zbs = at.map((d) => board.z + (board.first ? Math.abs(d) : d));
      const us = xs.map((x) => start + ((finish - start) * (x - a)) / (b - a));
      const arris = level === 0 ? 0.012 : 0;
      const rings = xs.map((x, i): Vec[] => {
        const zb = zbs[i]!;
        const dh = lip + ((BOARD_TOP - lip) * (top - zb)) / w;
        if (level > 0) return [[x, -lip, zb], [x, lip, zb], [x, dh, top], [x, -dh, top]];
        return [[x, -lip + arris, zb], [x, lip - arris, zb], [x, lip, zb + arris], [x, dh, top], [x, -dh, top], [x, -lip, zb + arris]];
      });
      const v = (i: number, z: number): number => (row + (z - zbs[i]!) / w) / 12 - BOARD_ROLL_V;
      // The front face with its bevel and the top read the picture as it is, the back mirrored.
      const front = level === 0 ? [3, 4, 5] : [2, 3];
      p.loft(rings, (k, i, j) => ["boards", [front.includes(k) ? BOARD_NAILS + us[i]! : BOARD_NAILS + 1 - us[i]!, v(i, rings[i]![j]![2])]], (i, j) => ["boards", [0.5 + rings[i]![j]![1] / 3, v(i, rings[i]![j]![2])]]);
    }
  }
}

/** A bay as one panel that wears the boards' picture from nail column to nail column, as its boards do. `holes` are cut through it. */
function panel(p: Shape, x0: number, x1: number, z0: number, z1: number, foot: number, notch: readonly (readonly [number, number])[] | null = null, hole: readonly (readonly [number, number])[] | null = null): void {
  const u = (x: number): number => -0.06 / 3 + ((1 + 0.12 / 3) * (x - x0)) / (x1 - x0);
  const v = (z: number): number => (z - foot) / 3 - BOARD_ROLL_V;
  const mapping: FaceMap = (label) => ["boards", (q) => [label === "+y" ? BOARD_NAILS + 1 - u(q[0]) : BOARD_NAILS + u(q[0]), v(q[2])]];
  // The outline in (z, x), going round as seen from +y.
  const outline: (readonly [number, number])[] = notch ? notch.map(([x, z]) => [z, x] as const) : [[z0, x0], [z1, x0], [z1, x1], [z0, x1]];
  p.extrude(outline, "y", -PANEL_T, PANEL_T, mapping, hole ? [hole.map(([x, z]) => [z, x] as const)] : []);
}

function bolts(p: Shape, points: readonly Cell[], face: number, level: number, radius = 0.018, out = 0.012): void {
  if (level) return;
  for (const [x, z] of points) for (const s of [-1, 1]) stud(p, [x, s * face, z], [0, s, 0], radius, out, 4, BOLT_UV);
}

/** The square ends of oak pegs driven through a joint, on both faces. */
function pegs(p: Shape, points: readonly Cell[], face: number, level: number, radius = 0.016, out = 0.01): void {
  if (level) return;
  for (const [x, z] of points) for (const s of [-1, 1]) stud(p, [x, s * face, z], [0, s, 0], radius, out, 4, PEG_UV);
}

/** A wall-family form about its collider's origin: half its width, its foot and top, and where its ends yield. */
interface Frame {
  hx: number;
  foot: number;
  top: number;
  /** Where the yield ring stands, from the middle, or the end where the form does not yield. */
  ring: number;
}

function frameOf(form: FormDef): Frame {
  const [u0, v0, u1, v1] = outlineBox(form);
  if (form.outline.length !== 4 || Math.abs(u0 + u1 - 2 * form.at[0]) > 1e-9) throw new Error("wood frames a rectangle about its edge's middle");
  const hx = (u1 - u0) / 2;
  return { hx, foot: v0 - form.at[1], top: v1 - form.at[1], ring: hx - form.yieldBand };
}

/** An upright iron strap on both faces of a member whose faces are at ±face. */
function strapZ(p: Shape, x: number, z0: number, z1: number, face: number): void {
  for (const s of [-1, 1]) {
    const [y0, y1] = [s * (face - 0.004), s * (face + 0.006)].sort((a, b) => a - b) as [number, number];
    p.box([x - STRAP / 2, y0, z0], [x + STRAP / 2, y1, z1], iron("z", "rivets", z0));
  }
}

/** The top plate the whole span, and the sill under the bays. */
function plates(p: Shape, f: Frame, level: number, topBand: number, sillBand: number, seed: number, sillSpans: readonly Cell[]): void {
  const reach = level < 2 ? f.hx : f.ring;
  const zt = (f.top - PLATE + f.top - DROP) / 2;
  member(p, level, [-reach, 0, zt], [reach, 0, zt], 2 * TOP_T, PLATE - DROP, Z, [topBand, topBand + 1, topBand, topBand + 2], [0, 0], seed, ROUGH, f.hx - reach);
  const zs = (f.foot - DROP + f.foot + SILL) / 2;
  sillSpans.forEach(([a, b], i) => {
    const [from, to] = [Math.max(a, -reach), Math.min(b, reach)];
    member(p, level, [from, 0, zs], [to, 0, zs], 2 * SILL_T, SILL + DROP, Z, [sillBand, sillBand + 1, sillBand, sillBand + 2], [1, 0], seed + 1 + i, ROUGH, from + f.hx);
  });
}

/**
 * The corner posts, and past each end a strip a little smaller than the sill, post and top plate it runs past. In a
 * straight run it lies inside the next piece's end; where two walls meet outside it fills the square their ends would
 * leave open. It stops 4 mm inside each face it could meet and stands 8 mm in from its own, and its top and foot slope
 * away along it, so where two meet at a corner their faces cross and none lie in one plane. From level 2 the post is
 * the whole of the wall past its yield ring, so nothing straddles the ring.
 */
function cornerPosts(p: Shape, f: Frame, level: number, bands: readonly [number, number], seed: number): void {
  [-1, 1].forEach((s, k) => {
    const band = bands[k]!;
    if (level < 2) {
      const x = s * (f.hx - POST / 2);
      member(p, level, [x, 0, f.foot + SILL], [x, 0, f.top - PLATE], POST, 2 * PLATE_T, Y, [band, band, band + 1, band + 1], [2, 0], seed + s, ROUGH * 0.5, SILL);
    } else {
      const [x0, x1] = [s * f.ring, s * f.hx].sort((a, b) => a - b) as [number, number];
      p.box([x0, -PLATE_T, f.foot - DROP], [x1, PLATE_T, f.top - DROP], beam("z", band, -f.foot));
    }
  });
  const whole: readonly (readonly [number, number, number])[] = [[f.foot - DROP + 0.004, f.top - DROP - 0.004, PLATE_T]];
  const spans = level === 0 ? [[f.foot - DROP + 0.004, f.foot + SILL, SILL_T], [f.foot + SILL, f.top - PLATE, PLATE_T], [f.top - PLATE, f.top - DROP - 0.004, TOP_T]] as const : whole;
  const slope = 0.012;
  [-1, 1].forEach((s, k) => {
    spans.forEach(([z0, z1, face], n) => {
      const [near, far] = [s * f.hx, s * (f.hx + face - 0.004)];
      const d = face - 0.008;
      const at = (i: number, j: number, up: number): Vec => [i ? far : near, j ? d : -d, up ? z1 - (n === spans.length - 1 ? slope * i : 0) : z0 + (n === 0 ? slope * i : 0)];
      p.block([0, 1].map((i) => [0, 1].map((j) => [0, 1].map((up) => at(i, j, up)))), beam("z", bands[k]!));
    });
  });
}

/** A knee brace from a post up to the plate, bolted at both ends; with `curve` it is arched, bowing toward the corner it braces. */
function knee(p: Shape, level: number, from: Cell, to: Cell, band: number, seed: number, curve = 0): void {
  const [a, b]: [Vec, Vec] = [[from[0], 0, from[1]], [to[0], 0, to[1]]];
  if (level === 0 && curve) {
    const corner: Vec = [a[0], 0, b[2]];
    const half = scale(add(a, b), 0.5);
    const mid = add(half, scale(sub(corner, half), curve));
    bent(p, Array.from({ length: 6 }, (_, i) => {
      const t = i / 5;
      return add(add(scale(a, (1 - t) ** 2), scale(mid, 2 * t * (1 - t))), scale(b, t * t));
    }), 0.1, 2 * BRACE_T, Y, band);
  } else member(p, level, a, b, 0.09, 2 * BRACE_T, Y, [band, band + 1, band, band + 1], null, seed);
  const d = unit(sub(b, a));
  const ends = [add(a, scale(d, 0.12)), sub(b, scale(d, 0.12))].map((q): Cell => [q[0], q[2]]);
  (curve ? pegs : bolts)(p, ends, BRACE_T, level);
}

/** A wall-family form past its pictures: its whole box in the boards' colour, its openings cut through. */
function plainWall(f: Frame, openings: NonNullable<FormDef["openings"]>, at: readonly number[]): Shape {
  const p = new Shape();
  // In (z, x), going round as seen from +y, a doorway being a notch in the foot.
  const outline: Cell[] = [[f.foot, -f.hx]];
  const holes: Cell[][] = [];
  for (const o of [...openings].sort((a, b) => a.x0 - b.x0)) {
    const [x0, x1, z0, z1] = [o.x0 - at[0]!, o.x1 - at[0]!, o.y0 - at[1]!, o.y1 - at[1]!];
    if (z0 <= f.foot + 1e-9) outline.push([f.foot, x0], [z1, x0], [z1, x1], [f.foot, x1]);
    else holes.push([[z0, x0], [z1, x0], [z1, x1], [z0, x1]]);
  }
  outline.push([f.foot, f.hx], [f.top, f.hx], [f.top, -f.hx]);
  // extrude takes (z, x) as its two axes after y, which go round the other way from how these were listed.
  return p.extrude(outline.reverse(), "y", -WALL_T, WALL_T, tone("boards"), holes);
}

/** A wall, a doorframe or a windowframe: sill, plate and corner posts, then what its opening asks for between them. */
function wallFamily(form: FormDef, level: number): Shape | null {
  if (level > 4) return null;
  const f = frameOf(form);
  const openings = form.openings ?? [];
  if (openings.length > 1) throw new Error("wood frames one opening to a wall");
  const p = new Shape();
  if (level === 4) {
    p.box([-f.hx, -WALL_T, f.foot], [f.hx, WALL_T, f.top], tone("boards"));
    // A box lies nearer a wall or a window than a doorway, which it shuts: it may be drawn, and cast its shadow, from nearer.
    if (!openings.some((o) => o.y0 - form.at[1] <= f.foot + 1e-9)) p.error = BOX_ERROR;
    return p;
  }
  if (level === 3) {
    // The plain wall shows its frame round its boards, the posts as wide as its yield band; one with an opening has no triangles to spare for it.
    if (openings.length > 0) return plainWall(f, openings, form.at);
    return p.framed([-f.hx, -WALL_T, f.foot], [f.hx, WALL_T, f.top], [-f.ring, f.foot + SILL, f.ring, f.top - PLATE], tone("timber"), tone("boards"));
  }
  const [sill, head] = [f.foot + SILL, f.top - PLATE];
  const edge = f.hx - POST + 0.02;
  const strip = level < 2 ? edge : f.ring;
  const opening = openings[0];
  const o = opening && { x0: opening.x0 - form.at[0], x1: opening.x1 - form.at[0], z0: opening.y0 - form.at[1], z1: opening.y1 - form.at[1] };
  const pegged = (points: readonly Cell[], face: number, out?: number): void => pegs(p, points, face, level, 0.016, out);
  const straps = (): void => {
    if (level === 0) for (const x of [-f.hx + POST / 2, f.hx - POST / 2]) strapZ(p, x, f.foot + 0.04, sill + 0.3, PLATE_T);
  };
  if (!o) {
    plates(p, f, level, 4, 9, 100, [[-f.hx, f.hx]]);
    cornerPosts(p, f, level, [1, 7], 110);
    member(p, level, [0, 0, sill], [0, 0, head], 2 * MID, 2 * MID_T, Y, [5, 5, 6, 6], [3, 0], 120, ROUGH * 0.5, SILL);
    for (const [s, band] of [[-1, 2], [1, 10]] as const) knee(p, level, [s * (f.hx - POST), head - 0.64], [s * 0.78, head], band, 130 + s);
    if (level < 2) {
      bay(p, level, -edge, -MID + 0.02, sill, head, 140, 0, f.foot);
      bay(p, level, MID - 0.02, edge, sill, head, 141, 0.5, f.foot);
    } else panel(p, -strip, strip, sill, head, f.foot);
    straps();
    pegged([[-f.hx + POST / 2, f.top - PLATE / 2 - 0.01], [f.hx - POST / 2, f.top - PLATE / 2 - 0.01], [0, f.top - PLATE / 2 - 0.01], [0, f.foot + SILL / 2]], TOP_T);
    return p;
  }
  const [xa, xb] = [o.x0, o.x1];
  if (o.z0 <= f.foot + 1e-9) {
    // A doorway: jambs from the floor, a lintel across them, a short stud over it and arched knees.
    const jamb = 0.18;
    const lintelTop = o.z1 + 0.1875;
    const [ra, rb] = [xa - jamb - 0.15, xb + jamb + 0.15];
    plates(p, f, level, 5, 9, 200, [[-f.hx, xa - jamb], [xb + jamb, f.hx]]);
    cornerPosts(p, f, level, [1, 7], 210);
    for (const [s, band, x] of [[-1, 8, xa - jamb / 2], [1, 3, xb + jamb / 2]] as const) member(p, level, [x, 0, f.foot], [x, 0, o.z1], jamb, 2 * JAMB_T, Y, [band, band, band + 1, band + 1], [3, 0], 220 + s, ROUGH * 0.6);
    const zl = (o.z1 + lintelTop) / 2;
    member(p, level, [ra, 0, zl], [rb, 0, zl], 2 * JAMB_T + 0.004, lintelTop - o.z1, Z, [6, 7, 6, 8], [0, 1], 230, ROUGH, f.hx + ra);
    const mid = (xa + xb) / 2;
    if (level < 2) member(p, level, [mid, 0, lintelTop], [mid, 0, head], 0.14, 2 * MID_T, Y, [11, 11, 10, 10], null, 231, ROUGH * 0.4);
    if (level < 2) {
      knee(p, level, [-(f.hx - POST), head - 0.76], [ra + 0.06, head], 10, 239, 0.45);
      knee(p, level, [f.hx - POST, head - 0.76], [rb - 0.06, head], 2, 241, 0.45);
      bay(p, level, -edge, xa - jamb + 0.02, sill, head, 250, 0, f.foot);
      bay(p, level, xb + jamb - 0.02, edge, sill, head, 251, 0.5, f.foot);
      bay(p, level, xa - jamb, mid - 0.05, lintelTop, head, 252, 0.25, f.foot);
      bay(p, level, mid + 0.05, xb + jamb, lintelTop, head, 253, 0.75, f.foot);
    } else {
      // One panel behind jambs and lintel, its notch hidden in them.
      const [na, nb, nz] = [xa - jamb / 2, xb + jamb / 2, o.z1 + 0.09];
      panel(p, -strip, strip, sill, head, f.foot, [[-strip, sill], [-strip, head], [strip, head], [strip, sill], [nb, sill], [nb, nz], [na, nz], [na, sill]]);
    }
    straps();
    pegged([...[xa - jamb / 2, xb + jamb / 2].flatMap((x) => [-0.045, 0.045].map((dz): Cell => [x, zl + dz])), [mid, f.top - PLATE / 2 - 0.01]], JAMB_T + 0.002);
    if (level === 0) {
      // The pintles the door hangs on, on the left jamb as seen from the front, and the keeper its latch drops into.
      const half = (o.z0 + o.z1) / 2;
      for (const z of [half - 0.82, half + 0.82]) p.box([xa, -0.066, z - 0.035], [xa + 0.018, -0.03, z + 0.035], iron("x", "plate", xa));
      p.box([xb - 0.016, -0.07, half + 0.09375], [xb, -0.03, half + 0.17375], iron("x", "plate", xb - 0.016));
    }
    return p;
  }
  // A window: its own jambs, a head and a sill whose horns run past them, a short stud above and below, full bays either side.
  const jamb = 0.15;
  const [ra, rb] = [xa - jamb - 0.17, xb + jamb + 0.17];
  const [sillBottom, headTop] = [o.z0 - 0.13, o.z1 + 0.17];
  const mid = (xa + xb) / 2;
  plates(p, f, level, 11, 3, 300, [[-f.hx, f.hx]]);
  cornerPosts(p, f, level, [5, 0], 310);
  for (const [s, band, x] of [[-1, 8, xa - jamb / 2], [1, 2, xb + jamb / 2]] as const) member(p, level, [x, 0, o.z0], [x, 0, o.z1], jamb, 2 * JAMB_T, Y, [band, band, band + 1, band + 1], [3, 1], 320 + s, ROUGH * 0.4);
  if (level < 2) for (const [z0, z1, band, seed] of [[sill, sillBottom, 9, 322], [headTop, head, 4, 323]] as const) member(p, level, [mid, 0, z0], [mid, 0, z1], 2 * MID * 0.8, 2 * MID_T, Y, [band, band, band + 1, band + 1], null, seed, ROUGH * 0.4);
  // The window sill stands out past the boards to both faces of the wall.
  const zs = (sillBottom + o.z0) / 2;
  member(p, level, [ra, 0, zs], [rb, 0, zs], 0.2, o.z0 - sillBottom, Z, [6, 7, 6, 7], [2, 1], 330, ROUGH, f.hx + ra);
  const zh = (o.z1 + headTop) / 2;
  member(p, level, [ra + 0.03, 0, zh], [rb - 0.03, 0, zh], 2 * JAMB_T + 0.008, headTop - o.z1, Z, [1, 2, 1, 3], [0, 1], 331, ROUGH, f.hx + ra);
  if (level < 2) {
    knee(p, level, [-(f.hx - POST), head - 0.52], [ra - 0.02, head], 10, 339);
    knee(p, level, [f.hx - POST, head - 0.52], [rb + 0.02, head], 4, 341);
    const [sa, sb] = [xa - jamb + 0.02, xb + jamb - 0.02];
    const stud = MID * 0.8 - 0.02;
    bay(p, level, -edge, sa, sill, head, 350, 0, f.foot);
    bay(p, level, sb, edge, sill, head, 351, 0.5, f.foot);
    if (level === 0) {
      bay(p, level, sa - 0.02, mid - stud, sill, sillBottom, 352, 0.25, f.foot);
      bay(p, level, mid + stud, sb + 0.02, sill, sillBottom, 353, 0.75, f.foot);
      bay(p, level, sa - 0.02, mid - stud, headTop, head, 354, 0.25, f.foot);
      bay(p, level, mid + stud, sb + 0.02, headTop, head, 355, 0.75, f.foot);
    } else {
      // Under and over the window the boards run on behind the stud.
      bay(p, level, sa - 0.02, sb + 0.02, sill, sillBottom, 352, 0.25, f.foot);
      bay(p, level, sa - 0.02, sb + 0.02, headTop, head, 354, 0.25, f.foot);
    }
  } else {
    const [ha, hb, hz0, hz1] = [xa - jamb / 2, xb + jamb / 2, o.z0 - 0.065, o.z1 + 0.085];
    panel(p, -strip, strip, sill, head, f.foot, null, [[ha, hz0], [ha, hz1], [hb, hz1], [hb, hz0]]);
  }
  straps();
  pegged([...[xa - jamb / 2, xb + jamb / 2].map((x): Cell => [x, zh]), [ra + 0.07, zh], [rb - 0.07, zh]], JAMB_T + 0.004);
  return p;
}

/**
 * Floorboards across the whole cell, running along X: on the finest level twelve of uneven width over a boarded
 * underlay, their ends falling short of the edge by up to a centimetre and their tops not quite level; past it one slab.
 */
function deck(p: Shape, top: number, thick: number, under: string, level: number, seed: number): void {
  const bottom = top - thick;
  const mapping: FaceMap = (label, lo, hi) => {
    if (label === "-x" || label === "+x") return ["deck", (q) => [0.1 + (q[2] - lo[2]) / 3, (q[1] + H) / 3]];
    if (label === "-z") return [under, (q) => [(q[0] + H) / 3, (H - q[1]) / 3]];
    return grid("deck")(label, lo, hi);
  };
  if (level > 0) {
    p.box([-H, -H, bottom], [H, H, top], mapping);
    return;
  }
  const rng = new PyRandom(seed);
  let y = -H;
  widths(rng, 2 * H, 12, 0.2).forEach((w, row) => {
    const [x0, x1] = [-H + rng.uniform(0, 0.012), H - rng.uniform(0, 0.012)];
    const t = top + rng.uniform(-0.0025, 0);
    const [gap, edge] = [0.003, 0.012];
    const [ya, yb] = [y + gap, y + w - gap];
    // Its top edges eased; the scripts' cup of a millimetre and a half is the picture's to show.
    const section: Cell[] = [[ya, bottom], [yb, bottom], [yb, t - edge * 0.6], [yb - edge, t], [ya + edge, t], [ya, t - edge * 0.6]];
    const rings = [x0, x1].map((x) => section.map(([sy, sz]): Vec => [x, sy, sz]));
    const [from, wide] = [y, w];
    const v = (q: Vec): number => (row + (q[1] - from) / wide) / 12;
    // A board is a prism along x: pulled back at an end it is a shorter board, so no ring is cut through the twelve.
    p.loft(rings, (_, i, j) => ["deck", [(rings[i]![j]![0] + H) / 3, v(rings[i]![j]!)]], (i, j) => ["deck", [0.1 + (rings[i]![j]![2] - top) / 3, v(rings[i]![j]!)]], 0);
    y += w;
  });
  p.box([-H + 0.015, -H + 0.015, bottom - 0.012], [H - 0.015, H - 0.015, bottom + 0.004], mapping);
}

/**
 * A deck of floorboards on a crib of heavy timbers: half-lapped corner blocks showing end grain on alternate faces, two
 * courses of hewn beams between them, and iron dogs round each corner. The blocks reach a little into the ground;
 * nothing of the crib breaks through the deck, so many tiles make one floor.
 */
function foundation(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const [top, bottom] = [form.thick / 2, -form.thick / 2];
  const thick = 0.05;
  if (level === 3) return p.box([-H, -H, bottom], [H, H, top], (label) => tone(label === "+z" ? "deck" : "timber")(label, [0, 0, 0], [0, 0, 0]));
  deck(p, top, thick, "deck", level, 400);
  const blk = 0.24;
  const [r, w] = [1.49, 0.2];
  const mid = (bottom + top - thick) / 2;
  const corners: readonly Cell[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  if (level === 2) {
    // The crib as one block under the deck, and a block at each corner.
    p.box([-r, -r, bottom], [r, r, top - thick], beam("x", 4));
    for (const [sx, sy] of corners) p.box([Math.min(sx * (H - blk), sx * H), Math.min(sy * (H - blk), sy * H), bottom - SINK], [Math.max(sx * (H - blk), sx * H), Math.max(sy * (H - blk), sy * H), top - thick], beam("z", 3));
    return p;
  }
  // Each corner is half-lapped: a short block running each way, one over the other, so end grain shows on the two faces in turn.
  corners.forEach(([sx, sy], i) => {
    [[bottom - SINK, mid], [mid, top - thick]].forEach(([z0, z1], k) => {
      const zc = (z0! + z1!) / 2;
      const [a, b]: [Vec, Vec] = (k + i) % 2 === 0 ? [[sx * (H - blk), sy * (H - blk / 2), zc], [sx * (H - 0.002), sy * (H - blk / 2), zc]] : [[sx * (H - blk / 2), sy * (H - blk), zc], [sx * (H - blk / 2), sy * (H - 0.002), zc]];
      member(p, level, a, b, blk - 0.004, z1! - z0!, Z, [3, 4, 5, 6], [(i + k) % 4, 1], 410 + 2 * i + k, ROUGH * 0.4, 0, true);
    });
  });
  const inner = H - blk;
  [[bottom, mid], [mid, top - thick]].forEach(([z0, z1], c) => {
    const [zc, hgt] = [(z0! + z1!) / 2, z1! - z0!];
    for (const [s, band] of [[-1, 3 + c], [1, 7 + c]] as const) {
      const at = s * (r - w / 2);
      member(p, level, [-inner, at, zc], [inner, at, zc], w, hgt, Z, [band, band + 2, band, band + 4], null, 420 + c * 4 + s, ROUGH, blk);
      member(p, level, [at, -inner, zc], [at, inner, zc], w, hgt, Z, [band + 1, band + 3, band + 1, band + 5], null, 430 + c * 4 + s, ROUGH, blk);
    }
  });
  if (level === 0) {
    // The dogs' bolts are the fittings picture's row of rivets.
    const t = 0.008;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const zc of [mid - 0.075, mid + 0.075]) {
      const sorted = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);
      let [x0, x1] = sorted(sx * (H + t - 0.006), sx * (H - blk - 0.12));
      let [y0, y1] = sorted(sy * (H + t - 0.006), sy * (H - 0.008));
      p.box([x0, y0, zc - 0.03], [x1, y1, zc + 0.03], iron("x", "rivets", x0));
      [x0, x1] = sorted(sx * (H + t - 0.006), sx * (H - 0.008));
      [y0, y1] = sorted(sy * (H - 0.008), sy * (H - blk - 0.12));
      p.box([x0, y0, zc - 0.03], [x1, y1, zc + 0.03], iron("y", "rivets", y0));
    }
  }
  return p;
}

/**
 * Floorboards over four hewn joists inside a rim of beams, with an end-grain block at each corner; the joists' ends
 * show in the rim, and the underside of the boards is the ceiling of the room below.
 */
function ceiling(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const top = form.thick / 2;
  const bottom = -top + 0.01;
  const thick = 0.05;
  // Past the joists' distance one slab as deep as the rim, so its edge is as thick and as dark as it was.
  if (level === 3) return p.box([-H, -H, bottom], [H, H, top], (label) => tone(label[1] === "z" ? "deck" : "timber")(label, [0, 0, 0], [0, 0, 0]));
  if (level === 2) return p.box([-H, -H, bottom], [H, H, top], (label, lo, hi) => {
    return label[1] === "z" ? grid("deck")(label, lo, hi) : beam(label[1] === "y" ? "x" : "y", label[1] === "y" ? 2 : 5)(label, lo, hi);
  });
  deck(p, top, thick, "boards", level, 500);
  const [r, w] = [1.49, 0.16];
  const z1 = top - thick;
  const [zc, hgt] = [(bottom + z1) / 2, z1 - bottom];
  const inner = r - w;
  for (const [s, band] of [[-1, 2], [1, 6]] as const) {
    member(p, level, [-inner, s * (r - w / 2), zc], [inner, s * (r - w / 2), zc], w, hgt, Z, [band, band + 1, band, band + 3], null, 510 + s, ROUGH, H - inner);
    member(p, level, [s * (r - w / 2), -inner, zc], [s * (r - w / 2), inner, zc], w, hgt, Z, [band + 3, band + 4, band + 3, band + 5], null, 520 + s, ROUGH, H - inner);
  }
  ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([sx, sy], i) => {
    const c = [sx * (r - w / 2), sy * (r - w / 2)] as const;
    member(p, level, [c[0], c[1], bottom], [c[0], c[1], z1], w, w, Y, [4, 5, 6, 7], null, 525 + i, ROUGH * 0.3);
  });
  ([[-0.9, 11], [-0.3, 5], [0.3, 8], [0.9, 1]] as const).forEach(([x, band], i) => member(p, level, [x, -inner, zc + 0.012], [x, inner, zc + 0.012], 0.13, hgt - 0.024, Z, [band, band + 1, band, band + 1], null, 530 + i, ROUGH, H - inner));
  if (level === 0) {
    // The joists' ends, flush in the rim.
    for (const s of [-1, 1]) for (const x of [-0.9, -0.3, 0.3, 0.9]) {
      const [y0, y1] = s < 0 ? [s * (r + 0.005), s * r] : [s * r, s * (r + 0.005)];
      p.box([x - 0.065, y0, zc - 0.07], [x + 0.065, y1, zc + 0.07], custom("timber", (_, q) => [0.4 + (q[2] - zc) / 3, bandV(((Math.trunc(x * 4) % 12) + 12) % 12) + (q[0] - x) / 3]));
    }
  }
  return p;
}

/**
 * A hewn post on a flared plinth, under a head that flares and then steps out into a cross of short arms, bolted
 * through with iron plates: a post made to carry a beam each way.
 */
function pillar(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const [u0, , u1] = outlineBox(form);
  // The scripts' post is half a metre square; a thinner one is the same post scaled across.
  const k = (u1 - u0) / 0.5;
  const hz = form.thick / 2;
  if (level === 3) return p.box([-0.25 * k, -0.25 * k, -hz], [0.25 * k, 0.25 * k, hz], tone("timber"));
  const half = 0.18 * k;
  const top = hz - SINK;
  if (level < 2) {
    const flare = (levels: readonly Cell[], band: number): void => {
      const rings = levels.map(([z, h0]): Vec[] => {
        const h = h0 * k;
        const c = Math.min(0.03, h / 4);
        return [[h, -h + c, z], [h, h - c, z], [h - c, h, z], [-h + c, h, z], [-h, h - c, z], [-h, -h + c, z], [-h + c, -h, z], [h - c, -h, z]];
      });
      p.loft(rings, (s, i, j) => ["timber", [(rings[i]![j]![2] + hz) / 3, bandV(band + (s >> 1)) + (rings[i]![j]![0] + rings[i]![j]![1]) / 6]], (i, j) => ["fittings", [cellUv(1, 0)[0] + rings[i]![j]![0] / 2, cellUv(1, 0)[1] + rings[i]![j]![1] / 2]]);
    };
    flare([[-hz, 0.245], [-hz + 0.24, 0.245], [-hz + 0.3, 0.19]], 3);
    flare([[hz - 0.52, 0.19], [hz - 0.42, 0.205], [top, 0.205]], 8);
    ([[0, 2], [1, 9]] as const).forEach(([n, band]) => {
      const z = top - 0.115;
      const [a, b]: [Vec, Vec] = n === 0 ? [[-0.247 * k, 0, z], [0.247 * k, 0, z]] : [[0, -0.247 * k, z], [0, 0.247 * k, z]];
      member(p, level, a, b, (0.16 - 0.004 * n) * k, 0.23 - 0.004 * n, Z, [band, band + 1, band, band + 1], [2 + n, 0], 601 + n, ROUGH * 0.3, 0, true);
    });
  } else {
    p.box([-0.245 * k, -0.245 * k, -hz], [0.245 * k, 0.245 * k, -hz + 0.29], beam("x", 3));
    p.box([-0.205 * k, -0.205 * k, hz - 0.51], [0.205 * k, 0.205 * k, top], beam("x", 8));
    p.box([-0.247 * k, -0.08 * k, top - 0.23], [0.247 * k, 0.08 * k, top], beam("x", 2));
    p.box([-0.078 * k, -0.247 * k, top - 0.226], [0.078 * k, 0.247 * k, top - 0.002], beam("y", 9));
  }
  if (level === 0) timber(p, [0, 0, -hz + 0.29], [0, 0, hz - 0.51], 2 * half, 2 * half, Y, [5, 6, 7, 8], { chamfer: 0.026, rough: ROUGH * 1.2, seed: 600 });
  else member(p, level, [0, 0, -hz + 0.29], [0, 0, hz - 0.51], 2 * half, 2 * half, Y, [5, 6, 7, 8], null, 600);
  if (level === 0) {
    const e = half + 0.008;
    p.box([-e, -e, -hz + 0.46 - STRAP / 2], [e, e, -hz + 0.46 + STRAP / 2], iron("x", "nails", -e));
    for (const s of [-1, 1]) {
      const [y0, y1] = s < 0 ? [s * 0.214 * k, s * 0.203 * k] : [s * 0.203 * k, s * 0.214 * k];
      p.box([-0.17 * k, y0, hz - 0.4], [0.17 * k, y1, hz - 0.33], iron("x", "plate", -0.17 * k));
      for (const x of [-0.12 * k, 0.12 * k]) stud(p, [x, s * 0.214 * k, hz - 0.365], [0, s, 0], 0.014, 0.008, 4, BOLT_UV);
    }
    for (const n of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] as const) stud(p, add(scale(n, 0.247 * k), [0, 0, top - 0.115]), n, 0.016, 0.008, 4, PEG_UV);
  }
  return p;
}

/** Rows of the boards picture with no butt joint. */
const DOOR_ROWS = [10, 3, 7, 0, 4] as const;

/**
 * The door: five thick upright boards whose edges wander, so the gaps between them open and close; ledged and braced
 * on the back; strap hinges on knuckles, a latch and a pull on the front. The front is -y, the side it opens toward,
 * and it hangs on its left edge. Open, it is the same door a quarter turn round its hinge.
 */
function door(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const [u0, v0, u1, v1] = outlineBox(form);
  const [wide, high] = [u1 - u0, v1 - v0];
  const [hw, hh] = [wide / 2, high / 2];
  const [front, back] = [-0.036, 0.006];
  // A quarter turn on the hinge: the door stands out along -y from the doorway's left.
  const open = (q: Vec): Vec => [q[1] + (form.off ?? 0), -q[0] - hw, q[2]];
  const done = (): Shape => (form.plane === "across" ? p.move(open) : p);
  if (level === 3) {
    p.box([-hw, -form.thick / 2, -hh], [hw, form.thick / 2, hh], tone("boards"));
    return done();
  }
  const rng = new PyRandom(700);
  if (level < 2) {
    const ws = widths(rng, wide, DOOR_ROWS.length, 0.16);
    const edges = [-hw];
    for (const w of ws) edges.push(edges[edges.length - 1]! + w);
    const zs = level === 0 ? [0, 1, 2, 3, 4].map((i) => -hh + (hh * 2 * i) / 4) : [-hh, hh];
    // Each inner edge wanders, the same for the boards either side of it, with a gap between.
    const still = zs.map(() => 0);
    const wander = [still, ...edges.slice(1, -1).map(() => zs.map(() => (level === 0 ? rng.uniform(-0.007, 0.007) : 0))), still];
    DOOR_ROWS.forEach((row, j) => {
      const [va, vb] = [row / 12 - BOARD_ROLL_V, (row + 1) / 12 - BOARD_ROLL_V];
      const c = 0.007;
      const rings = zs.map((z0, i): Vec[] => {
        const gl = j === 0 ? 0 : 0.0025 + Math.abs(wander[j]![i]!) * 0.3;
        const gr = j === DOOR_ROWS.length - 1 ? 0 : 0.0025 + Math.abs(wander[j + 1]![i]!) * 0.3;
        const x0 = edges[j]! + wander[j]![i]! + gl;
        const x1 = edges[j + 1]! + wander[j + 1]![i]! - gr;
        let z = z0;
        if (i === 0) z = -hh + (level === 0 ? rng.uniform(0, 0.014) : 0);
        if (i === zs.length - 1) z = hh - (level === 0 ? rng.uniform(0, 0.008) : 0);
        return [[x0 + c, front, z], [x1 - c, front, z], [x1, front + c, z], [x1, back - c, z], [x1 - c, back, z], [x0 + c, back, z], [x0, back - c, z], [x0, front + c, z]];
      });
      const [xa, xb] = [edges[j]!, edges[j + 1]!];
      p.loft(rings, (k, i, jj) => {
        const q = rings[i]![jj]!;
        const t = (q[0] - xa) / (xb - xa);
        // The front face and the edges round it, nailed on the ledges.
        if (k === 6 || k === 7 || k === 0) return ["boards", [BOARD_NAILS + (q[2] + 0.82) / 3.28, va + t * (vb - va)]];
        return ["boards", [(H - q[2]) / 3 + 0.3, vb - t * (vb - va)]];
      }, (i, jj) => ["boards", [0.5 + (rings[i]![jj]![0] - xa) / 3, va + (rings[i]![jj]![1] - front) / 3]]);
    });
  } else p.box([-hw, front, -hh], [hw, back, hh], custom("boards", (_, q) => [(q[2] + H) / 3, (q[0] + hw) / 3 + 0.04]));
  // Two ledges behind the hinge straps, and one brace between them rising from the hinge side to the latch side.
  const ledge = 0.18;
  const xs = hw - 0.025;
  const rails = [-hh + 0.34, hh - 0.34] as const;
  rails.forEach((z, i) => {
    const band = [3, 11][i]!;
    member(p, level, [-xs, (back + 0.04) / 2, z], [xs, (back + 0.04) / 2, z], 0.04 - back, ledge, Z, [band, band + 1, band, band + 1], null, 710 + i, ROUGH * 0.4);
  });
  member(p, level, [-xs + 0.1, (back + 0.036) / 2, rails[0] + ledge / 2 + 0.03], [xs - 0.1, (back + 0.036) / 2, rails[1] - ledge / 2 - 0.03], 0.11, 0.036 - back, Y, [1, 1, 2, 2], null, 720, ROUGH * 0.4);
  if (level < 2) {
    for (const z of rails) {
      // A strap hinge, tapering to a spade tip, on a knuckle at the door's edge.
      const tip = 0.3;
      const outline: Cell[] = [[-hw, z - 0.035], [tip - 0.14, z - 0.022], [tip - 0.02, z - 0.016], [tip + 0.03, z], [tip - 0.02, z + 0.016], [tip - 0.14, z + 0.022], [-hw, z + 0.035]];
      p.extrude(outline.map(([x, zz]) => [zz, x] as const), "y", -0.043, front + 0.004, iron("x", "rivets", -hw));
      stud(p, [-hw + 0.004, -0.05, z - 0.06], [0, 0, 1], 0.016, 0.12, 6, [0.2, 0.43]);
    }
  }
  if (level === 0) {
    for (const z of rails) for (const x of [-0.48, -0.18, 0.12]) stud(p, [x, -0.043, z], [0, -1, 0], 0.011, 0.007, 4, BOLT_UV);
    for (const z of rails) {
      DOOR_ROWS.forEach((_, j) => {
        const x = -hw + ((j + 0.5) * wide) / DOOR_ROWS.length;
        if (x > 0.2) stud(p, [x + 0.05, front, z + 0.04], [0, -1, 0], 0.006, 0.004, 4, BOLT_UV);
      });
    }
  }
  const zp = -0.25;
  if (level < 2) {
    // A latch bar over a keeper, and a D-shaped pull below it.
    const [zl, xl] = [0.02, 0.38];
    p.box([xl, -0.046, zl - 0.012], [hw + 0.012, front + 0.004, zl + 0.012], iron("x", "strap", xl));
    p.box([xl - 0.03, -0.044, zl - 0.04], [xl + 0.01, front + 0.004, zl + 0.04], iron("x", "plate", xl - 0.03));
    p.box([0.47, -0.042, zp - 0.12], [0.53, front + 0.004, zp + 0.12], iron("x", "plate", 0.47));
    for (const dz of [-0.08, 0.08]) p.box([0.488, -0.075, zp + dz - 0.011], [0.512, -0.04, zp + dz + 0.011], iron("y", "strap", -0.075));
    p.box([0.488, -0.085, zp - 0.09], [0.512, -0.07, zp + 0.09], iron("z", "strap", zp - 0.09));
    p.box([0.47, back - 0.004, zp - 0.1], [0.53, 0.016, zp + 0.1], iron("x", "plate", 0.47));
  }
  if (level === 0) p.ring([0.5, 0.025, zp - 0.03], 0.045, 0.008, iron("x", "strap", 0.4));
  return done();
}

/**
 * Stairs up toward -y (the engine's +Z): plank treads with a nosing over boarded risers, between two hewn stringers,
 * solid underneath as the collision is, its sides and back framed like a wall.
 */
function stairs(form: FormDef, level: number): Shape | null {
  if (level > 4) return null;
  const p = new Shape();
  const steps = form.steps!;
  const hz = form.thick / 2;
  const [run, rise] = [(2 * H) / steps, form.thick / steps];
  const s = 1.42;
  const [nose, tread] = [0.025, 0.05];
  // Coarsest, the slope from foot to head; before that, midway between the steps' noses and their roots.
  if (level === 4) return p.extrude([[H, -hz], [-H, hz], [-H, -hz]], "x", -H, H, tone("boards"));
  if (level === 3) return p.extrude([[H, -hz], [H, -hz + rise / 2], [-H + run / 2, hz], [-H, hz], [-H, -hz]], "x", -H, H, tone("boards"));
  const [cut, back] = level === 0 ? [tread, nose] : [0, 0];
  const rear = -H + 0.06; // the solid's back stands in behind the frame and under the top tread
  const solid: FaceMap = (label, lo, hi) => {
    // The sides are boarded upright.
    if (label === "-x" || label === "+x") return ["boards", (q) => [(q[2] + H) / 3, ((q[1] + H) / 3) * (label === "+x" ? 1 : -1) + 0.5]];
    return grid(label === "+z" ? "deck" : "boards")(label, lo, hi);
  };
  // The solid, (y, z) going round as seen from +x: along the floor toward +y, up the first riser, up the steps, down the back.
  const outline: Cell[] = [[rear, -hz], [H - back, -hz]];
  for (let i = 0; i < steps; i++) {
    const yFront = H - i * run - back;
    const zTop = -hz + (i + 1) * rise - cut;
    if (i > 0) outline.push([yFront, zTop - rise]);
    outline.push([yFront, zTop]);
  }
  outline.push([rear, hz - cut]);
  p.extrude(outline, "x", -s, s, solid);
  if (level === 0) {
    const rng = new PyRandom(800);
    for (let i = 0; i < steps; i++) {
      const zTop = -hz + (i + 1) * rise;
      // Each tread two planks across the stair, along X: the wider at the nosing.
      const [yBack, yNose] = [H - (i + 1) * run, H - i * run];
      const seam = yNose - 0.17;
      for (const [y0, y1, nosing] of [[yBack, seam - 0.0015, false], [seam + 0.0015, yNose, true]] as const) {
        const row = rng.randrange(12);
        const e = nosing ? 0.012 : 0.004;
        const sag = rng.uniform(0, 0.002);
        const rings = [-s + rng.uniform(0, 0.01), s - rng.uniform(0, 0.01)].map((x): Vec[] => [[x, y0, zTop - tread], [x, y1, zTop - tread], [x, y1, zTop - e], [x, y1 - e, zTop - sag], [x, y0 + 0.004, zTop - sag], [x, y0, zTop - 0.005]]);
        const v = (q: Vec): number => (row + (q[1] - y0) / (y1 - y0)) / 12;
        p.loft(rings, (_, ii, jj) => ["deck", [(rings[ii]![jj]![0] + H) / 3, v(rings[ii]![jj]!)]], (ii, jj) => ["deck", [0.1 + rings[ii]![jj]![2] / 3, v(rings[ii]![jj]!)]]);
      }
    }
  }
  const hiLine = 0.05 + rise;
  const stringer: Cell[] = [[H, -hz], [H, -hz + hiLine], [-H + hiLine, hz], [-H, hz]];
  for (const [x0, x1, band] of [[-H, -s, 2], [s, H, 9]] as const) {
    p.extrude(stringer, "x", x0, x1, () => ["timber", (q) => {
      const along = (H - q[1] + (q[2] + H)) / Math.SQRT2;
      const across = (q[2] + q[1]) / Math.SQRT2;
      return [along / 3, bandV(band) + (across - hiLine / Math.SQRT2 / 2) / 3];
    }]);
  }
  if (level < 2) {
    const sill = -hz + 0.18;
    [-1, 1].forEach((sx, i) => {
      const x = sx * 1.42;
      member(p, level, [x, -H, (-hz + sill) / 2], [x, H - 0.03, (-hz + sill) / 2], 0.12, sill + hz, Z, sx < 0 ? [4, 5, 4, 5] : [8, 9, 8, 9], null, 810 + i);
      member(p, level, [x, -H + 0.1, sill], [x, -H + 0.1, hz - tread], 0.12, 0.2, X, [6, 6, 7, 7], null, 812 + i, ROUGH * 0.5);
      member(p, level, [x, 0, sill], [x, 0, 0.12], 0.12, 0.2, X, [11, 11, 3, 3], null, 814 + i, ROUGH * 0.5);
    });
    member(p, level, [-1.36, -H + 0.03, (-hz + sill) / 2], [1.36, -H + 0.03, (-hz + sill) / 2], 0.05, sill + hz, Z, [7, 7, 7, 7], null, 816);
    member(p, level, [-1.36, -H + 0.035, 0], [1.36, -H + 0.035, 0], 0.05, 0.18, Z, [10, 10, 10, 10], null, 817);
    member(p, level, [0, -H + 0.03, sill], [0, -H + 0.03, hz - tread], 0.18, 0.06, Y, [5, 5, 5, 5], null, 818, ROUGH * 0.4);
  }
  return p;
}

export const WOOD: TierRecipe = {
  name: "wood",
  rank: 1,
  runPost: true,
  jointHalf: POST,
  // Each is a palette entry (shared/pack/palette.ts), so the match is exact.
  tones: { boards: [176, 120, 84], deck: [198, 142, 104], timber: [94, 60, 40], fittings: [46, 36, 32] },
  split(name, form, level) {
    if (form.layer === "wall") return wallFamily(form, level);
    if (form.layer === "slab" && form.root === "always") return foundation(form, level);
    if (form.layer === "slab" && form.outline.length === 4 && !form.corner && !form.openings) return ceiling(form, level);
    if (form.layer === "post") return pillar(form, level);
    if (form.layer === "leaf" && form.plane !== "flat") return door(form, level);
    if (form.layer === "fill" && form.steps !== undefined) return stairs(form, level);
    throw new Error(`wood has no recipe for ${name} yet`);
  },
};
