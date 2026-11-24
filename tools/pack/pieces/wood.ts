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
import { Shape, add, beamRings, clip, clipTo, cross, dot, fanSlab, gateLeaves, inset, ladderSticks, length, mirror, place, planeAt, planeMoved, railingSticks, roundEven, scale, slabOn, sub, unit, uprightPlane, widths, type FaceMap, type Flat, type Plane, type Stick, type Uv, type Vec } from "./kit.ts";
import { planOf, type TierRecipe } from "./lod.ts";
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
  /** The axis it runs along, where a yield ring across it may leave it whole. */
  along?: number;
}

/** A squared timber from a to b, each long face on its own band of the timber sheet, its ends end grain cell `end` or timber. */
function timber(p: Shape, a: Vec, b: Vec, w: number, h: number, up: Vec, bands: Bands, o: TimberOpts = {}): void {
  const { end = null, chamfer = 0.016, rough = 0, seed = 0, segs, along0 = 0, mat = "timber", along } = o;
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
  }, along);
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
function bay(p: Shape, level: number, x0: number, x1: number, z0: number, z1: number, seed: number, u0: number, foot: number, lean = false): void {
  const [start, finish] = [u0 - 0.06 / 3, u0 + 0.5 + 0.06 / 3];
  for (const board of boardsOf(x0, x1, z0, z1, seed, foot)) {
    const { w, row, lip, top } = board;
    const lengths = level === 0 ? board.spans : [{ a: x0, b: x1, wander: [0, 0] }];
    for (const { a, b, wander } of lengths) {
      // The scripts drew four rings on a long board: its two inner ones are met in the middle here.
      // A wall of two edges in one piece has no triangles for a long board's middle ring.
      const at = level > 0 ? [0, 0] : b - a > 1 && !lean ? [wander[0]!, wander.length === 4 ? (wander[1]! + wander[2]!) / 2 : wander[1]!, wander[wander.length - 1]!] : [wander[0]!, wander[wander.length - 1]!];
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
  // A wall two edges long is hewn in three lengths, where the scripts' way would make six.
  if (level === 0 && f.hx > H) timber(p, [-reach, 0, zt], [reach, 0, zt], 2 * TOP_T, PLATE - DROP, Z, [topBand, topBand + 1, topBand, topBand + 2], { end: [0, 0], rough: ROUGH, seed, segs: 3 });
  else member(p, level, [-reach, 0, zt], [reach, 0, zt], 2 * TOP_T, PLATE - DROP, Z, [topBand, topBand + 1, topBand, topBand + 2], [0, 0], seed, ROUGH, f.hx - reach);
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
function cornerPosts(p: Shape, f: Frame, level: number, bands: readonly [number, number], seed: number, strips: boolean): void {
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
  if (strips) endStrips(p, f, level, bands);
}

/** The strips past a wall's two ends, which fill an outside corner where no joint is drawn: `cornerPosts` says how they lie. */
function endStrips(p: Shape, f: Frame, level: number, bands: readonly [number, number], ends: readonly number[] = [-1, 1]): void {
  const whole: readonly (readonly [number, number, number])[] = [[f.foot - DROP + 0.004, f.top - DROP - 0.004, PLATE_T]];
  const spans = level === 0 ? [[f.foot - DROP + 0.004, f.foot + SILL, SILL_T], [f.foot + SILL, f.top - PLATE, PLATE_T], [f.top - PLATE, f.top - DROP - 0.004, TOP_T]] as const : whole;
  const slope = 0.012;
  ends.forEach((s) => {
    const k = s < 0 ? 0 : 1;
    spans.forEach(([z0, z1, face], n) => {
      const [near, far] = [s * f.hx, s * (f.hx + face - 0.004)];
      const d = face - 0.008;
      const at = (i: number, j: number, up: number): Vec => [i ? far : near, j ? d : -d, up ? z1 - (n === spans.length - 1 ? slope * i : 0) : z0 + (n === 0 ? slope * i : 0)];
      p.block([0, 1].map((i) => [0, 1].map((j) => [0, 1].map((up) => at(i, j, up)))), beam("z", bands[k]!));
    });
  });
}

/** A knee brace from a post up to the plate, bolted at both ends; with `curve` it is arched, bowing toward the corner it braces. */
function knee(p: Shape, level: number, from: Cell, to: Cell, band: number, seed: number, curve = 0, lengths = 5): void {
  const [a, b]: [Vec, Vec] = [[from[0], 0, from[1]], [to[0], 0, to[1]]];
  if (level === 0 && curve) {
    const corner: Vec = [a[0], 0, b[2]];
    const half = scale(add(a, b), 0.5);
    const mid = add(half, scale(sub(corner, half), curve));
    bent(p, Array.from({ length: lengths + 1 }, (_, i) => {
      const t = i / lengths;
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
function wallFamily(form: FormDef, level: number, strips: boolean): Shape | null {
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
    if (level === 0) for (const x of [-f.hx + POST / 2, f.hx - POST / 2]) strapZ(p, x, f.foot + 0.04, Math.min(sill + 0.3, head), PLATE_T);
  };
  if (!o) {
    plates(p, f, level, 4, 9, 100, [[-f.hx, f.hx]]);
    cornerPosts(p, f, level, [1, 7], 110, strips);
    member(p, level, [0, 0, sill], [0, 0, head], 2 * MID, 2 * MID_T, Y, [5, 5, 6, 6], [3, 0], 120, ROUGH * 0.5, SILL);
    // A wall under a metre has no room for knees.
    if (head - 0.64 > sill) for (const [s, band] of [[-1, 2], [1, 10]] as const) knee(p, level, [s * (f.hx - POST), head - 0.64], [s * 0.78, head], band, 130 + s);
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
    cornerPosts(p, f, level, [1, 7], 210, strips);
    for (const [s, band, x] of [[-1, 8, xa - jamb / 2], [1, 3, xb + jamb / 2]] as const) member(p, level, [x, 0, f.foot], [x, 0, o.z1], jamb, 2 * JAMB_T, Y, [band, band, band + 1, band + 1], [3, 0], 220 + s, ROUGH * 0.6);
    const zl = (o.z1 + lintelTop) / 2;
    member(p, level, [ra, 0, zl], [rb, 0, zl], 2 * JAMB_T + 0.004, lintelTop - o.z1, Z, [6, 7, 6, 8], [0, 1], 230, ROUGH, f.hx + ra);
    const mid = (xa + xb) / 2;
    if (level < 2) member(p, level, [mid, 0, lintelTop], [mid, 0, head], 0.14, 2 * MID_T, Y, [11, 11, 10, 10], null, 231, ROUGH * 0.4);
    if (level < 2) {
      knee(p, level, [-(f.hx - POST), head - 0.76], [ra + 0.06, head], 10, 239, 0.45, f.hx > H ? 3 : 5);
      knee(p, level, [f.hx - POST, head - 0.76], [rb - 0.06, head], 2, 241, 0.45, f.hx > H ? 3 : 5);
      bay(p, level, -edge, xa - jamb + 0.02, sill, head, 250, 0, f.foot, f.hx > H);
      bay(p, level, xb + jamb - 0.02, edge, sill, head, 251, 0.5, f.foot, f.hx > H);
      bay(p, level, xa - jamb, mid - 0.05, lintelTop, head, 252, 0.25, f.foot, f.hx > H);
      bay(p, level, mid + 0.05, xb + jamb, lintelTop, head, 253, 0.75, f.foot, f.hx > H);
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
      // A doorway two leaves wide hangs one on each jamb, and they latch on each other.
      if (xb - xa > 2) for (const z of [half - 0.82, half + 0.82]) p.box([xb - 0.018, -0.066, z - 0.035], [xb, -0.03, z + 0.035], iron("x", "plate", xb - 0.018));
      else p.box([xb - 0.016, -0.07, half + 0.09375], [xb, -0.03, half + 0.17375], iron("x", "plate", xb - 0.016));
    }
    return p;
  }
  // A window: its own jambs, a head and a sill whose horns run past them, a short stud above and below, full bays either side.
  const jamb = 0.15;
  const [ra, rb] = [xa - jamb - 0.17, xb + jamb + 0.17];
  const [sillBottom, headTop] = [o.z0 - 0.13, o.z1 + 0.17];
  const mid = (xa + xb) / 2;
  plates(p, f, level, 11, 3, 300, [[-f.hx, f.hx]]);
  cornerPosts(p, f, level, [5, 0], 310, strips);
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
function deck(p: Shape, top: number, thick: number, under: string, level: number, seed: number, rect: readonly [number, number, number, number] = [-H, -H, H, H]): void {
  const [x0, y0, x1, y1] = rect;
  const bottom = top - thick;
  const mapping: FaceMap = (label, lo, hi) => {
    if (label === "-x" || label === "+x") return ["deck", (q) => [0.1 + (q[2] - lo[2]) / 3, (q[1] + H) / 3]];
    if (label === "-z") return [under, (q) => [(q[0] + H) / 3, (H - q[1]) / 3]];
    return grid("deck")(label, lo, hi);
  };
  if (level > 0) {
    p.box([x0, y0, bottom], [x1, y1, top], mapping);
    return;
  }
  const rng = new PyRandom(seed);
  let y = y0;
  widths(rng, y1 - y0, Math.round((y1 - y0) / ROW), 0.2).forEach((w, row) => {
    const [xa, xb] = [x0 + rng.uniform(0, 0.012), x1 - rng.uniform(0, 0.012)];
    const t = top + rng.uniform(-0.0025, 0);
    const [gap, edge] = [0.003, 0.012];
    const [ya, yb] = [y + gap, y + w - gap];
    // Its top edges eased; the scripts' cup of a millimetre and a half is the picture's to show.
    const section: Cell[] = [[ya, bottom], [yb, bottom], [yb, t - edge * 0.6], [yb - edge, t], [ya + edge, t], [ya, t - edge * 0.6]];
    const rings = [xa, xb].map((x) => section.map(([sy, sz]): Vec => [x, sy, sz]));
    const [from, wide] = [y, w];
    const v = (q: Vec): number => (row + (q[1] - from) / wide) / 12;
    // A board is a prism along x: pulled back at an end it is a shorter board, so no ring is cut through the twelve.
    p.loft(rings, (_, i, j) => ["deck", [(rings[i]![j]![0] + H) / 3, v(rings[i]![j]!)]], (i, j) => ["deck", [0.1 + (rings[i]![j]![2] - top) / 3, v(rings[i]![j]!)]], 0);
    y += w;
  });
  p.box([x0 + 0.015, y0 + 0.015, bottom - 0.012], [x1 - 0.015, y1 - 0.015, bottom + 0.004], mapping);
}

/**
 * A deck of floorboards on a crib of heavy timbers: half-lapped corner blocks showing end grain on alternate faces, two
 * courses of hewn beams between them, and iron dogs round each corner. The blocks reach a little into the ground;
 * nothing of the crib breaks through the deck, so many tiles make one floor.
 */
function foundation(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  // Its outline's rectangle about its collider's origin: the whole cell, or a quarter of one from its low corner.
  const [u0, v0, u1, v1] = outlineBox(form);
  const [cx, cy, hx, hy] = [(u0 + u1) / 2 - form.at[0], -((v0 + v1) / 2 - form.at[2]), (u1 - u0) / 2, (v1 - v0) / 2];
  const [top, bottom] = [form.thick / 2, -form.thick / 2];
  const thick = 0.05;
  if (level === 3) return p.box([cx - hx, cy - hy, bottom], [cx + hx, cy + hy, top], (label) => tone(label === "+z" ? "deck" : "timber")(label, [0, 0, 0], [0, 0, 0]));
  deck(p, top, thick, "deck", level, 400, [cx - hx, cy - hy, cx + hx, cy + hy]);
  const blk = 0.24;
  const [rx, ry, w] = [hx - 0.01, hy - 0.01, 0.2];
  const mid = (bottom + top - thick) / 2;
  const corners: readonly Cell[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  if (level === 2) {
    // The crib as one block under the deck, and a block at each corner.
    p.box([cx - rx, cy - ry, bottom], [cx + rx, cy + ry, top - thick], beam("x", 4));
    for (const [sx, sy] of corners) p.box([cx + Math.min(sx * (hx - blk), sx * hx), cy + Math.min(sy * (hy - blk), sy * hy), bottom - SINK], [cx + Math.max(sx * (hx - blk), sx * hx), cy + Math.max(sy * (hy - blk), sy * hy), top - thick], beam("z", 3));
    return p;
  }
  // Each corner is half-lapped: a short block running each way, one over the other, so end grain shows on the two faces in turn.
  corners.forEach(([sx, sy], i) => {
    [[bottom - SINK, mid], [mid, top - thick]].forEach(([z0, z1], k) => {
      const zc = (z0! + z1!) / 2;
      const [a, b]: [Vec, Vec] = (k + i) % 2 === 0 ? [[cx + sx * (hx - blk), cy + sy * (hy - blk / 2), zc], [cx + sx * (hx - 0.002), cy + sy * (hy - blk / 2), zc]] : [[cx + sx * (hx - blk / 2), cy + sy * (hy - blk), zc], [cx + sx * (hx - blk / 2), cy + sy * (hy - 0.002), zc]];
      member(p, level, a, b, blk - 0.004, z1! - z0!, Z, [3, 4, 5, 6], [(i + k) % 4, 1], 410 + 2 * i + k, ROUGH * 0.4, 0, true);
    });
  });
  const [ix, iy] = [hx - blk, hy - blk];
  [[bottom, mid], [mid, top - thick]].forEach(([z0, z1], c) => {
    const [zc, hgt] = [(z0! + z1!) / 2, z1! - z0!];
    for (const [s, band] of [[-1, 3 + c], [1, 7 + c]] as const) {
      member(p, level, [cx - ix, cy + s * (ry - w / 2), zc], [cx + ix, cy + s * (ry - w / 2), zc], w, hgt, Z, [band, band + 2, band, band + 4], null, 420 + c * 4 + s, ROUGH, blk);
      member(p, level, [cx + s * (rx - w / 2), cy - iy, zc], [cx + s * (rx - w / 2), cy + iy, zc], w, hgt, Z, [band + 1, band + 3, band + 1, band + 5], null, 430 + c * 4 + s, ROUGH, blk);
    }
  });
  if (level === 0) {
    // The dogs' bolts are the fittings picture's row of rivets.
    const t = 0.008;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const zc of [mid - 0.075, mid + 0.075]) {
      const sorted = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);
      let [x0, x1] = sorted(cx + sx * (hx + t - 0.006), cx + sx * (hx - blk - 0.12));
      let [y0, y1] = sorted(cy + sy * (hy + t - 0.006), cy + sy * (hy - 0.008));
      p.box([x0, y0, zc - 0.03], [x1, y1, zc + 0.03], iron("x", "rivets", x0));
      [x0, x1] = sorted(cx + sx * (hx + t - 0.006), cx + sx * (hx - 0.008));
      [y0, y1] = sorted(cy + sy * (hy - 0.008), cy + sy * (hy - blk - 0.12));
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
  const sill = -hz + 0.18;
  if (level < 2) {
    [-1, 1].forEach((sx, i) => {
      const x = sx * 1.42;
      member(p, level, [x, -H, (-hz + sill) / 2], [x, H - 0.03, (-hz + sill) / 2], 0.12, sill + hz, Z, sx < 0 ? [4, 5, 4, 5] : [8, 9, 8, 9], null, 810 + i);
      member(p, level, [x, -H + 0.1, sill], [x, -H + 0.1, hz - tread], 0.12, 0.2, X, [6, 6, 7, 7], null, 812 + i, ROUGH * 0.5);
      member(p, level, [x, 0, sill], [x, 0, 0.12], 0.12, 0.2, X, [11, 11, 3, 3], null, 814 + i, ROUGH * 0.5);
    });
  }
  // The back's sill, rail and post stay a level longer: they are what its tall wall is known by.
  member(p, level, [-1.36, -H + 0.03, (-hz + sill) / 2], [1.36, -H + 0.03, (-hz + sill) / 2], 0.05, sill + hz, Z, [7, 7, 7, 7], null, 816);
  member(p, level, [-1.36, -H + 0.035, 0], [1.36, -H + 0.035, 0], 0.05, 0.18, Z, [10, 10, 10, 10], null, 817);
  member(p, level, [0, -H + 0.03, sill], [0, -H + 0.03, hz - tread], 0.18, 0.06, Y, [5, 5, 5, 5], null, 818, ROUGH * 0.4);
  return p;
}


// The forms past the first nine. Each is built from its row alone, by the same members the nine are built of: `member`
// for a timber, `bay` and `panel` for weatherboards, `deck` for floorboards, and the kit's `clip` where one must end
// on a slant. Another tier follows the same steps with its own members.

/** A roof's courses of boards to its rise: they lie at the same heights on every face, so they meet across every hip, valley and side. */
const COURSES = 12;
/** How far a roof's lowest course runs out past its low side, measured level. */
const EAVE = 0.3;
/** A roof board's thickness at its head, at its butt, and the eave board's, measured upright. */
const LAP_HEAD = 0.013;
const LAP_BUTT = 0.033;
const EAVE_BOARD = 0.062;
/** The boards under the courses, measured upright, and how far their top lies under the roof's own plane. */
const SARK = 0.04;
const SARK_DROP = 0.002;
/** A roof's rim timber is this wide, and stands this far in from the side: clear of the yield ring, so the ring cuts no timber along its length. */
const RIM = 0.16;
const RIM_IN = 0.115;
const RAFTER = 0.2;

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
  /** The axis of the recipe's frame its contours run along. */
  axis: number;
}

/**
 * The point of a facet `a` along its contours, `s` level metres up its slope and `n` upright over its plane. What is
 * built by height and upright thickness is the same along a side two faces share, whatever their slopes.
 */
function onFacet(f: Facet, a: number, s: number, n = 0): Vec {
  return [f.o[0] + a * f.along[0] + s * f.up[0], f.o[1] + a * f.along[1] + s * f.up[1], f.lo + s * f.g + n];
}
/** A facet's own plane moved `by` upright, looking up out of it. */
const facetPlane = (f: Facet, by = 0): Plane => planeAt(add(onFacet(f, 0, 0), [0, 0, by]), [-f.g * f.up[0], -f.g * f.up[1], 1]);
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
    const [a, b, c] = [0, 1, 2].map((i): Vec => [poly[i]![0], poly[i]![1], tops[list[i]!]!]);
    const nrm = cross(sub(b, a), sub(c, a));
    const [gx, gy] = [-nrm[0] / nrm[2], -nrm[1] / nrm[2]];
    const g = Math.hypot(gx, gy);
    const up: Flat = [gx / g, gy / g];
    const along: Flat = [up[1], -up[0]];
    const low = poly[list.findIndex((k) => Math.abs(tops[k]! - lo) < 1e-9)]!;
    // Contours are counted from the cell's own side, so a course's nails fall over the same rafters on every face.
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

/** The upright planes a facet's parts are cut to: each side's own, an eave's moved out to where its boards end. */
const facetSides = (f: Facet, eaves = EAVE): Plane[] => f.poly.map((a, k) => planeMoved(uprightPlane(a, f.poly[(k + 1) % f.poly.length]!), f.kinds[k] === "eave" ? eaves : 0));

/**
 * A facet's courses of boards, each lapping the one under it, running along the contours and cut to the facet's
 * sides. The lowest runs out over an eave as one thick board, which covers the top of the wall the roof stands on.
 * With `wavy`, a course's lower edge wanders in its middle; it is true at its ends, where the next face's course meets it.
 */
function courses(p: Shape, level: number, f: Facet, rise: number, seed: number, wavy: boolean): void {
  const eave = f.kinds.includes("eave");
  const spans = f.poly.map((q) => facetAt(f, q)[0]);
  const [a0, a1] = [Math.min(...spans) - EAVE - 0.05, Math.max(...spans) + EAVE + 0.05];
  // A wavy course has a ring at each end of the face, where it is true, and one between, where it wanders.
  const as = level === 0 && wavy ? [a0, Math.min(...spans), (a0 + a1) / 2, Math.max(...spans), a1] : [a0, a1];
  const middle = as.length === 5 ? 2 : -1;
  const rng = new PyRandom(seed);
  const from = p.faces.length;
  for (let i = level === 0 ? 0 : COURSES; i < COURSES; i++) {
    // Every measure up the slope is a height over the low side, so two faces of different slopes agree where they meet.
    const up = (height: number): number => height / f.g;
    const [s0, s1] = [up((i * rise) / COURSES), up(((i + 1) * rise) / COURSES)];
    const head = i === COURSES - 1 ? s1 : s1 + up(0.015);
    const t = LAP_BUTT + rng.uniform(-0.004, 0.003);
    const wander = rng.uniform(-0.008, 0.008);
    const first = i === 0 && eave;
    const rings = as.map((a, r): Vec[] => {
      const butt = s0 + (r === middle && !first ? wander : 0);
      const section: Flat[] = first
        ? [[-EAVE, 0], [head, 0], [head, LAP_HEAD], [up(0.05), EAVE_BOARD], [-EAVE + 0.012, EAVE_BOARD], [-EAVE, EAVE_BOARD - 0.012]]
        : [[butt, 0], [head, 0], [head, LAP_HEAD], [butt + up(0.006), t], [butt, t - 0.01]];
      return section.map(([s, n]) => onFacet(f, a, s, n));
    });
    const uv = (r: number, j: number): Uv => {
      const [, s] = facetAt(f, [rings[r]![j]![0], rings[r]![j]![1]]);
      return [as[r]! / 3, (i + (s - s0) / (s1 - s0)) / 12 - BOARD_ROLL_V];
    };
    p.loft(rings, (_, r, j) => ["boards", uv(r, j)], (r, j) => ["boards", uv(r, j)], f.axis);
  }
  if (level > 0 && eave) {
    // Past the finest the courses are the picture's, and the eave board alone stands out of it.
    const s1 = rise / COURSES / f.g;
    const rings = as.map((a) => ([[-EAVE, 0], [s1, 0], [s1, 0.022], [0.05 / f.g, EAVE_BOARD], [-EAVE, EAVE_BOARD]] as const).map(([s, n]) => onFacet(f, a, s, n)));
    const uv = (r: number, j: number): Uv => [as[r]! / 3, facetAt(f, [rings[r]![j]![0], rings[r]![j]![1]])[1] / s1 / 12 - BOARD_ROLL_V];
    p.loft(rings, (_, r, j) => ["boards", uv(r, j)], (r, j) => ["boards", uv(r, j)], f.axis);
  }
  for (const side of facetSides(f)) clip(p, side, null, from);
}

/** The axis two points lie along, if they lie along one. */
function axisOf(a: Vec, b: Vec): number | undefined {
  const moved = [0, 1, 2].filter((k) => Math.abs(b[k]! - a[k]!) > 1e-9);
  return moved.length === 1 ? moved[0] : undefined;
}

interface SparOpts {
  /** How many lengths the hewn one is in: one to a metre and a half unless given. */
  segs?: number;
  rough?: number;
  end?: Cell | null;
  chamfer?: number;
}

/**
 * A timber of one of the new forms: hewn on the finest level, squared past it. One that lies along an axis is marked
 * so, and a yield ring across it leaves it whole: pulled back, it is a shorter timber.
 */
function spar(p: Shape, level: number, a: Vec, b: Vec, w: number, h: number, up: Vec, bands: Bands, seed: number, o: SparOpts = {}): void {
  const axis = axisOf(a, b);
  const along = axis === undefined ? {} : { along: axis };
  const rough = o.rough ?? ROUGH * 0.6;
  if (level === 0) timber(p, a, b, w, h, up, bands, { end: o.end ?? null, rough, seed, segs: o.segs ?? Math.max(1, Math.round(length(sub(b, a)) / 1.5)), ...(o.chamfer === undefined ? {} : { chamfer: o.chamfer }), ...along });
  else timber(p, a, b, w, h, up, bands, { chamfer: 0, ...along });
}

/**
 * A roof: boards in lapped courses on an underlay of boards, over a frame like a ceiling's: a beam inside each level
 * side, a rafter inside each sloped one and under a fold, and common rafters between, their tails out under the eave.
 * A hip's fold is capped by a roll and a valley's lined by a board. Its top is the plane through the form's corner
 * heights, the courses standing on it, and its sides are upright.
 */
function roof(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
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
  // The courses' picture as a flat face wears it: a row to a course.
  const top = (f: Facet): ((q: Vec) => Uv) => (q) => {
    const [a, s] = facetAt(f, [q[0], q[1]]);
    return [a / 3, (s * f.g) / rise - BOARD_ROLL_V];
  };
  const slab = (part: "top" | "under" | "side", k: number): readonly [string, (q: Vec) => Uv] => (part === "side" ? beam("x", 6)("-y", X, X) : ["boards", top(facets[Math.min(k, facets.length - 1)]!)]);
  if (level >= 2) {
    // One solid: its top wears the courses' picture, and it runs out to a thin edge over each eave.
    const moved = inset(plan, plan.map((_, k) => (kindOf(k) === "eave" ? -EAVE : 0)));
    const out = moved.map((q, k) => Math.hypot(q[0] - plan[k]![0], q[1] - plan[k]![1]) > 1e-9);
    const high = moved.map((q, k) => heightOn(out[k] ? facets.find((f) => f.poly.includes(plan[k]!) && f.kinds.includes("eave"))! : facetOf(k), q) + 0.02);
    const low = moved.map((_, k) => (out[k] ? high[k]! - 0.07 : tops[k]! - form.thick));
    return slabOn(p, moved, high, low, level === 3 ? (part) => tone(part === "side" ? "timber" : "boards")("", X, X) : slab, fold);
  }
  facets.forEach((f) => {
    const from = p.faces.length;
    // Only a square slope's courses wander: its sides are where a course is true. A fold or a triangle's side crosses
    // every course somewhere along it, and there it must meet the next face's.
    courses(p, level, f, rise, 900, !folded && n === 4);
    // A valley's courses stop short of its fold, where the board that lines it shows.
    if (folded && !hip) clip(p, planeMoved(facetSides(f)[f.kinds.indexOf("fold")]!, -0.09), null, from);
  });
  // The underlay alone, or past the finest the courses and their underlay as one sheet that wears the courses' picture.
  if (level === 0) slabOn(p, plan, tops.map((h) => h - SARK_DROP), SARK, slab, fold);
  else slabOn(p, plan, tops.map((h) => h + 0.022), SARK + SARK_DROP + 0.022, slab, fold);
  const under = facets.map((f) => facetPlane(f, -SARK - SARK_DROP));
  const edge = inset(plan, 0.004);
  const within = edge.map((a, k) => uprightPlane(a, edge[(k + 1) % n]!));
  plan.forEach((a, k) => {
    const b = plan[(k + 1) % n]!;
    const f = facetOf(k), kind = kindOf(k);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const inward: Flat = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    const at = (q: Flat, z: number): Vec => [q[0] + inward[0] * (RIM_IN + RIM / 2), q[1] + inward[1] * (RIM_IN + RIM / 2), z];
    const [za, zb] = [tops[k]!, tops[(k + 1) % n]!];
    const from = p.faces.length;
    if (kind === "rake") {
      // A principal rafter under the sloped side, its top cut to the boards it carries.
      const drop = SARK + RAFTER / 2 - 0.06;
      spar(p, level, at(a, za - drop), at(b, zb - drop), RIM, RAFTER / Math.hypot(1, (zb - za) / l), Z, [2 + k, 3 + k, 2 + k, 4 + k], 910 + k, { segs: 2 });
    } else {
      // A level beam inside a low side or a high one, from the slab's underside up to the boards.
      const [z0, z1] = [za - form.thick, za + (RIM_IN + RIM) * f.g];
      spar(p, level, at(a, (z0 + z1) / 2), at(b, (z0 + z1) / 2), RIM, z1 - z0, Z, [5 + k, 6 + k, 5 + k, 7 + k], 920 + k, { segs: 2 });
    }
    // Under a hip a rim timber runs on past the fold, under the other face: it is cut to both.
    for (const plane of [...within.filter((_, j) => j !== k), ...(hip ? under : [under[facets.indexOf(f)]!])]) clip(p, plane, null, from);
  });
  if (folded) {
    const [a, b] = [plan[(fold + 2) % n]!, plan[fold]!];
    const [za, zb] = [tops[(fold + 2) % n]!, tops[fold]!];
    const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // The rafter under the fold. Under a hip it stands as far down as the faces fall away over its width.
    const drop = SARK + SARK_DROP + RAFTER / 2 + (hip ? (RIM / 2) * facets[0]!.g * Math.SQRT1_2 : 0);
    let from = p.faces.length;
    spar(p, level, [a[0], a[1], za - drop], [b[0], b[1], zb - drop], RIM, RAFTER / Math.hypot(1, (zb - za) / run), Z, [9, 10, 9, 11], 930, { segs: 2 });
    for (const side of [...within, planeAt([0, 0, Math.min(...tops) - form.thick], [0, 0, -1])]) clip(p, side, null, from);
    from = p.faces.length;
    if (hip) {
      // The roll that caps a hip, planed, out to the corner of the eave boards.
      const reach = facets.every((f) => f.kinds.includes("eave")) ? EAVE * Math.SQRT2 - 0.02 : 0;
      timber(p, [a[0] - ((b[0] - a[0]) * reach) / run, a[1] - ((b[1] - a[1]) * reach) / run, za - (reach * (zb - za)) / run + 0.03], [b[0], b[1], zb + 0.03], 0.09, 0.06, Z, [1, 2, 1, 2], { chamfer: level === 0 ? 0.014 : 0, end: level === 0 ? [3, 1] : null });
      for (const side of plan.map((q, k) => planeMoved(uprightPlane(q, plan[(k + 1) % n]!), kindOf(k) === "eave" ? EAVE : 0))) clip(p, side, null, from);
    } else {
      // The board that lines a valley, its ends square and just short of the corners.
      const [t0, t1] = [0.14 / run, 1 - 0.14 / run];
      timber(p, [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, za + (zb - za) * t0 + 0.03], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, za + (zb - za) * t1 + 0.03], 0.26, 0.036, Z, [8, 9, 8, 9], { chamfer: 0 });
    }
  }
  facets.forEach((f, i) => {
    const k = Math.sqrt(1 + f.g * f.g);
    const spans = f.poly.map((q) => facetAt(f, q)[1]);
    // Clear of the yield rings, their ends in the beams.
    const sides = f.poly.map((a, s) => planeMoved(uprightPlane(a, f.poly[(s + 1) % f.poly.length]!), f.kinds[s] === "fold" ? -0.07 : -RIM_IN - 0.02));
    for (const [j, a] of [0.75, 2.25].entries()) {
      // A common rafter up the slope, under each of the boards' nail lines.
      const from = p.faces.length;
      const off = -(SARK + SARK_DROP + RAFTER / 2);
      spar(p, level, onFacet(f, a, Math.min(...spans), off), onFacet(f, a, Math.max(...spans), off), 0.12, RAFTER / k, Z, [3 * j + i, 3 * j + i + 1, 3 * j + i, 3 * j + i + 2], 940 + 10 * i + j, { segs: 2 });
      for (const side of sides) clip(p, side, null, from);
    }
    if (level > 0 || !f.kinds.includes("eave")) return;
    // Rafter tails under the eave boards, each narrower than the rafter of a roof that runs on below, so it lies inside it.
    const from = p.faces.length;
    for (const a of [0.055, 0.75, 2.25, 2.945]) timber(p, onFacet(f, a, -EAVE + 0.035, -0.054), onFacet(f, a, 0.02, -0.054), 0.085, 0.09, Z, [4, 5, 4, 5], { chamfer: 0 });
    f.kinds.forEach((kind, s) => {
      if (kind !== "eave") clip(p, facetSides(f)[s]!, null, from);
    });
  });
  return p;
}

/** A wall-family form's frame from any outline that stands on a level foot about its edge's middle: a sloped wall's is its box's. */
function boxFrame(form: FormDef): Frame {
  const [u0, v0, u1, v1] = outlineBox(form);
  const hx = (u1 - u0) / 2;
  return { hx, foot: v0 - form.at[1], top: v1 - form.at[1], ring: hx - form.yieldBand };
}

/**
 * The gable under a roof's sloped side: a sill, a post at its high end and a stud in its middle, weatherboards, and a
 * rake along its top. It is built as a wall whose top runs level, then cut by the plane its outline's top lies in,
 * which is the plane through the corner heights of the roof over it: so its top lies in that plane to the last bit.
 * It is built high at its -x end, and the other hand is that one in a mirror.
 */
function gable(form: FormDef, level: number, strips: boolean): Shape | null {
  if (level > 3) return null;
  const f = boxFrame(form);
  const p = new Shape();
  const right = form.outline.some(([u, v]) => v > 1e-9 && u > form.at[0]);
  const rise = f.top - f.foot;
  // The top's plane, and the height it has over x.
  const slope = planeAt([f.hx, 0, f.foot], [rise, 0, 2 * f.hx]);
  const at = (x: number): number => f.foot + (rise * (f.hx - x)) / (2 * f.hx);
  const done = (): Shape => (right ? mirror(p, 0) : p);
  if (level === 3) {
    p.extrude([[f.top, -f.hx], [f.foot, f.hx], [f.foot, -f.hx]], "y", -WALL_T, WALL_T, tone("boards"));
    return done();
  }
  const sill = f.foot + SILL;
  const edge = f.hx - POST + 0.02;
  const rake = 0.2;
  const zs = (f.foot - DROP + sill) / 2;
  if (level < 2) {
    member(p, level, [-f.hx, 0, zs], [f.hx, 0, zs], 2 * SILL_T, SILL + DROP, Z, [9, 10, 9, 11], [1, 0], 1001, ROUGH, 0);
    const x = -f.hx + POST / 2;
    member(p, level, [x, 0, sill], [x, 0, f.top + 0.05], POST, 2 * PLATE_T, Y, [1, 1, 2, 2], [2, 0], 1002, ROUGH * 0.5, SILL);
    member(p, level, [0, 0, sill], [0, 0, at(0) + 0.05], 2 * MID, 2 * MID_T, Y, [5, 5, 6, 6], [3, 0], 1003, ROUGH * 0.5, SILL);
    bay(p, level, -edge, -MID + 0.02, sill, at(-edge), 1004, 0, f.foot);
    bay(p, level, MID - 0.02, edge, sill, at(MID - 0.02), 1005, 0.5, f.foot);
  } else {
    p.box([-f.hx, -PLATE_T, f.foot - DROP], [-f.ring, PLATE_T, f.top + 0.05], beam("z", 1, -f.foot));
    p.box([-f.ring, -SILL_T, f.foot - DROP], [f.hx, SILL_T, sill], beam("x", 9));
    panel(p, -f.ring, f.ring, sill, at(-f.ring), f.foot);
  }
  // The rake: a timber along the slope, built a little over the plane and cut to it.
  const drop = (rake / 2 - 0.006) * Math.hypot(1, rise / (2 * f.hx));
  const [lo, hi]: [Vec, Vec] = [[f.hx + 0.1, 0, at(f.hx + 0.1) - drop], [-f.hx - 0.1, 0, at(-f.hx - 0.1) - drop]];
  const raked = p.faces.length;
  if (level === 0) timber(p, lo, hi, 2 * TOP_T, rake, Z, [4, 5, 4, 6], { rough: ROUGH * 0.6, seed: 1006, segs: 2 });
  else timber(p, lo, hi, 2 * TOP_T, rake, Z, [4, 5, 4, 6], { chamfer: 0 });
  // Its high end is upright, on the wall's own end.
  clip(p, planeAt([-f.hx, 0, 0], [-1, 0, 0]), (q) => ["timber", [0.5 + q[1] / 3, bandV(4) + (q[2] - f.top) / 3]], raked);
  if (strips) endStrips(p, { ...f, top: f.top + 0.05 }, level, [1, 1], [-1]);
  // Cut to the slope, to the foot the sill reaches under, and to the low end.
  clip(p, slope, (q) => ["timber", [(q[0] + f.hx) / 3, bandV(4) + q[1] / 3]]);
  clip(p, planeAt([f.hx, 0, 0], X));
  clip(p, planeAt([0, 0, f.foot - DROP], [0, 0, -1]));
  if (level === 0) {
    strapZ(p, -f.hx + POST / 2, f.foot + 0.04, sill + 0.3, PLATE_T);
    const back = Math.hypot(1, rise / (2 * f.hx)) * (rake / 2);
    pegs(p, [[-f.hx + POST / 2, f.top - back - 0.05], [0, at(0) - back], [0, f.foot + SILL / 2]], TOP_T, level);
  }
  return done();
}

/**
 * Floorboards on an outline that is no rectangle: along each side, and mitred on the lines from its middle to its
 * corners, so a triangle's floor looks the same whichever way it is turned and meets the boards of the square or the
 * triangle next to it along their own length. Three rings of boards, as wide as the picture's rows nearly. Past the
 * finest level it is one slab whose top wears the boards the same way.
 */
function fanDeck(p: Shape, plan: readonly Flat[], top: number, thick: number, under: string, level: number, seed: number): void {
  const bottom = top - thick;
  const n = plan.length;
  const g: Flat = [plan.reduce((sum, q) => sum + q[0], 0) / n, plan.reduce((sum, q) => sum + q[1], 0) / n];
  if (level > 0) {
    fanSlab(p, plan, bottom, top, (part, k) => [part === "under" ? under : "deck", (q, along, inward) => (part === "side" ? [0.1 + (q[2] - bottom) / 3, along / 3] : [along / 3, (inward + k) / 3])]);
    return;
  }
  const rng = new PyRandom(seed);
  const reach = Math.abs((plan[1]![0] - plan[0]![0]) * (g[1] - plan[0]![1]) - (plan[1]![1] - plan[0]![1]) * (g[0] - plan[0]![0])) / Math.hypot(plan[1]![0] - plan[0]![0], plan[1]![1] - plan[0]![1]);
  const rows = Math.max(1, Math.round(reach / 0.29));
  const wide = widths(rng, reach, rows, 0.2);
  const [gap, ease] = [0.003, 0.012];
  plan.forEach((a, k) => {
    const b = plan[(k + 1) % n]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [dx, dy] = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    // The lines to the two corners, which this side's boards are mitred on.
    const mitres = [planeMoved(uprightPlane(g, a), -gap), planeMoved(uprightPlane(b, g), -gap)];
    let d = 0;
    wide.forEach((w, row) => {
      const t = top + rng.uniform(-0.0025, 0);
      const [da, db] = [d + gap, d + w - gap];
      const section: Cell[] = [[da, bottom], [db, bottom], [db, t - ease * 0.6], [db - ease, t], [da + ease, t], [da, t - ease * 0.6]];
      const rings = [-0.3, l + 0.3].map((along) => section.map(([inward, z]): Vec => [a[0] + dx * along - dy * inward, a[1] + dy * along + dx * inward, z]));
      const [from, across] = [d, w];
      const uv = (q: Vec): Uv => [((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / 3, ((row + 4 * k) % 12 + (-(q[0] - a[0]) * dy + (q[1] - a[1]) * dx - from) / across) / 12];
      const first = p.faces.length;
      p.loft(rings, (_, i, j) => ["deck", uv(rings[i]![j]!)], (i, j) => ["deck", uv(rings[i]![j]!)]);
      for (const mitre of mitres) clip(p, mitre, (q) => ["deck", [0.1 + (q[2] - top) / 3, uv(q)[1]]], first);
      d += w;
    });
  });
  p.extrude(inset(plan, 0.015), "z", bottom - 0.012, bottom + 0.004, (label) => [label === "-z" ? under : "deck", (q) => [(q[0] + H) / 3, (H - q[1]) / 3]]);
}

/** A box built along x and turned to lie along a side of a plan: from `o`, x along (dx, dy). */
function turnedBox(p: Shape, o: Flat, d: Flat, lo: Vec, hi: Vec, mapping: FaceMap): void {
  const from = p.faces.length;
  p.box(lo, hi, mapping);
  place(p, (q) => [o[0] + d[0] * q[0] - d[1] * q[1], o[1] + d[1] * q[0] + d[0] * q[1], q[2]], from);
}

/**
 * A triangle of foundation: the fan of floorboards on a crib as a square's, two courses of hewn beams along each side
 * between corner blocks that are lapped the other way on each course, so end grain shows on a corner's two faces in turn.
 */
function triFoundation(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const plan = planOf(form);
  const n = plan.length;
  const [top, bottom] = [form.thick / 2, -form.thick / 2];
  const thick = 0.05;
  if (level === 3) return p.extrude(plan, "z", bottom, top, (label) => tone(label === "+z" ? "deck" : "timber")(label, X, X));
  fanDeck(p, plan, top, thick, "deck", level, 1100);
  const [blk, w] = [0.3, 0.2];
  const mid = (bottom + top - thick) / 2;
  const side = (k: number): { a: Flat; b: Flat; l: number; d: Flat; inward: Flat } => {
    const [a, b] = [plan[k]!, plan[(k + 1) % n]!];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { a, b, l, d: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], inward: [-(b[1] - a[1]) / l, (b[0] - a[0]) / l] };
  };
  const along = (k: number, t: number, inward: number, z: number): Vec => {
    const e = side(k);
    return [e.a[0] + e.d[0] * t + e.inward[0] * inward, e.a[1] + e.d[1] * t + e.inward[1] * inward, z];
  };
  if (level === 2) {
    p.extrude(inset(plan, 0.01), "z", bottom, top - thick, (label) => beam("x", 4)(label[1] === "z" ? label : "-y", X, X));
    return p;
  }
  const edge = inset(plan, 0.002);
  [[bottom - SINK, mid], [mid, top - thick]].forEach(([z0, z1], course) => {
    const zc = (z0! + z1!) / 2;
    for (let k = 0; k < n; k++) {
      const e = side(k);
      // A block at this side's first corner or its last, lying along it, its end cut by the side it meets there.
      const first = (k + course) % 2 === 0;
      const from = p.faces.length;
      const [t0, t1] = first ? [-0.2, blk] : [e.l - blk, e.l + 0.2];
      member(p, level, along(k, t0, 0.12, zc), along(k, t1, 0.12, zc), 0.236, z1! - z0!, Z, [3, 4, 5, 6], [(k + course) % 4, 1], 1110 + 2 * k + course, ROUGH * 0.4, 0, true);
      clipTo(p, edge, 0, (q) => ["fittings", [cellUv((k + course) % 4, 1)[0] + (q[0] + q[1]) * 0.3, cellUv((k + course) % 4, 1)[1] + (q[2] - zc)]], from);
      // The beam between this side's two corners, into both blocks.
      const band = 3 + course + 4 * (k % 2);
      member(p, level, along(k, blk - 0.03, 0.01 + w / 2, Math.max(z0!, bottom) / 2 + z1! / 2), along(k, e.l - blk + 0.03, 0.01 + w / 2, Math.max(z0!, bottom) / 2 + z1! / 2), w, z1! - Math.max(z0!, bottom), Z, [band, band + 2, band, band + 4], null, 1120 + 4 * k + course, ROUGH, blk);
    }
  });
  if (level === 0) {
    // An iron dog on each face of each corner, as a square's has.
    for (let k = 0; k < n; k++) {
      const e = side(k);
      const from = p.faces.length;
      for (const [t0, t1] of [[-0.02, blk + 0.12], [e.l - blk - 0.12, e.l + 0.02]] as const) for (const zc of [mid - 0.075, mid + 0.075]) turnedBox(p, e.a, e.d, [t0, -0.002, zc - 0.03], [t1, 0.008, zc + 0.03], iron("x", "rivets", t0));
      // Two millimetres proud of its own side, and of the sides it meets at the corners.
      clipTo(p, plan, -0.002, null, from);
    }
  }
  return p;
}

/**
 * A triangle of ceiling: the fan of floorboards in a rim of beams mitred at the corners, on joists from a boss in
 * the middle out to each corner, where the boards' mitres are nailed, and to the middle of each side.
 */
function triCeiling(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const plan = planOf(form);
  const n = plan.length;
  const top = form.thick / 2;
  const bottom = -top + 0.01;
  const thick = 0.05;
  const g: Flat = [plan.reduce((sum, q) => sum + q[0], 0) / n, plan.reduce((sum, q) => sum + q[1], 0) / n];
  if (level === 3) return p.extrude(plan, "z", bottom, top, (label) => tone(label[1] === "z" ? "deck" : "timber")(label, X, X));
  if (level === 2) return fanSlab(p, plan, bottom, top, (part, k) => (part === "side" ? ["timber", (q, along) => [along / 3, bandV(2 + 3 * k) + q[2] / 3]] : [part === "top" ? "deck" : "boards", (_, along, inward) => [along / 3, (inward + k) / 3]]));
  fanDeck(p, plan, top, thick, "boards", level, 1200);
  const w = 0.16;
  const z1 = top - thick;
  const [zc, hgt] = [(bottom + z1) / 2, z1 - bottom];
  plan.forEach((a, k) => {
    const b = plan[(k + 1) % n]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [d, inward]: [Flat, Flat] = [[(b[0] - a[0]) / l, (b[1] - a[1]) / l], [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]];
    const at = (t: number): Vec => [a[0] + d[0] * t + inward[0] * (0.01 + w / 2), a[1] + d[1] * t + inward[1] * (0.01 + w / 2), zc];
    // A rim beam, mitred on the lines to its two corners.
    let from = p.faces.length;
    member(p, level, at(-0.2), at(l + 0.2), w, hgt, Z, [2 + 3 * k, 3 + 3 * k, 2 + 3 * k, 4 + 3 * k], null, 1210 + k, ROUGH, 0);
    clip(p, uprightPlane(g, a), null, from);
    clip(p, uprightPlane(b, g), null, from);
    // A joist to this corner and one to the middle of this side, their ends in the rim.
    const rim = inset(plan, 0.01 + w - 0.02);
    for (const [j, to] of ([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]] as const).entries()) {
      from = p.faces.length;
      member(p, level, [g[0], g[1], zc + 0.012], [to[0], to[1], zc + 0.012], j === 0 ? 0.13 : 0.11, hgt - 0.024, Z, [(5 * k + j) % 10, (5 * k + j) % 10 + 1, (5 * k + j) % 10, (5 * k + j) % 10 + 1], null, 1220 + 2 * k + j, ROUGH * 0.6, 0);
      clipTo(p, rim, 0, null, from);
    }
  });
  // The boss the joists meet in.
  const boss = Array.from({ length: 2 * n }, (_, i): Flat => [g[0] + 0.15 * Math.cos((Math.PI * (i + 0.5)) / n), g[1] + 0.15 * Math.sin((Math.PI * (i + 0.5)) / n)]);
  p.extrude(boss, "z", bottom - 0.02, z1, (label) => beam(label[1] === "z" ? "x" : "z", 7)(label, [g[0], g[1], bottom], [g[0], g[1], z1]));
  return p;
}

/**
 * A ceiling with a hatch through it: the rim and corner blocks of a ceiling, floorboards cut round the hole, and two
 * trimmer joists with two headers between them, flush with the hole's sides.
 */
function hatchFrame(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const o = form.openings![0]!;
  // The hole about the collider's origin, in the recipe's frame.
  const [hx0, hx1, hy0, hy1] = [o.x0 - form.at[0], o.x1 - form.at[0], -(o.y1 - form.at[2]), -(o.y0 - form.at[2])];
  const top = form.thick / 2;
  const bottom = -top + 0.01;
  const thick = 0.05;
  const hole: Cell[] = [[hx0, hy0], [hx1, hy0], [hx1, hy1], [hx0, hy1]];
  const square: Cell[] = [[-H, -H], [H, -H], [H, H], [-H, H]];
  if (level === 3) return p.extrude(square, "z", bottom, top, (label) => tone(label[1] === "z" ? "deck" : "timber")(label, X, X), [hole]);
  if (level === 2) return p.extrude(square, "z", bottom, top, (label, lo, hi) => (label[1] === "z" ? grid("deck")(label, lo, hi) : beam(label[1] === "y" ? "x" : "y", label[1] === "y" ? 2 : 5)(label, lo, hi)), [hole]);
  // Boards run along x: whole lengths past the hole's two sides, and short ones either side of it.
  for (const [k, rect] of ([[-H, -H, H, hy0], [-H, hy1, H, H], [-H, hy0, hx0, hy1], [hx1, hy0, H, hy1]] as const).entries()) deck(p, top, thick, "boards", level, 1300 + k, rect);
  const [r, w] = [1.49, 0.16];
  const z1 = top - thick;
  const [zc, hgt] = [(bottom + z1) / 2, z1 - bottom];
  const inner = r - w;
  for (const [s, band] of [[-1, 2], [1, 6]] as const) {
    member(p, level, [-inner, s * (r - w / 2), zc], [inner, s * (r - w / 2), zc], w, hgt, Z, [band, band + 1, band, band + 3], null, 1310 + s, ROUGH, H - inner);
    member(p, level, [s * (r - w / 2), -inner, zc], [s * (r - w / 2), inner, zc], w, hgt, Z, [band + 3, band + 4, band + 3, band + 5], null, 1320 + s, ROUGH, H - inner);
  }
  ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([sx, sy], i) => {
    const c = [sx * (r - w / 2), sy * (r - w / 2)] as const;
    member(p, level, [c[0], c[1], bottom], [c[0], c[1], z1], w, w, Y, [4, 5, 6, 7], null, 1325 + i, ROUGH * 0.3);
  });
  const trim = 0.13;
  const back = 0.006;
  // Trimmers the whole way across beside the hole, and headers between them at its other two sides: a hewn face's stray back from it.
  for (const [i, x] of [hx0 - trim / 2 - back, hx1 + trim / 2 + back].entries()) member(p, level, [x, -inner, zc + 0.012], [x, inner, zc + 0.012], trim, hgt - 0.024, Z, [11 - 6 * i, 11 - 6 * i + 1, 11 - 6 * i, 11 - 6 * i + 1], null, 1330 + i, ROUGH * 0.5, H - inner);
  for (const [i, y] of [hy0 - trim / 2 - back, hy1 + trim / 2 + back].entries()) member(p, level, [hx0, y, zc + 0.012], [hx1, y, zc + 0.012], trim, hgt - 0.024, Z, [8 - 7 * i, 8 - 7 * i + 1, 8 - 7 * i, 8 - 7 * i + 1], null, 1340 + i, ROUGH * 0.5, 0);
  return p;
}

/** How far a hatch's leaf stands clear of its hole on each side. */
const HATCH_CLEAR = 0.004;

/**
 * The hatch's leaf: six boards whose edges wander, on two ledges under them, hung on two strap hinges along its
 * +y side (the engine's -Z), with a ring to lift it by near the other. It lies in its frame's hole, its top a hair
 * under the floor's.
 */
function hatch(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const [u0, v0, u1, v1] = outlineBox(form);
  const [x0, x1, y0, y1] = [u0 - form.at[0] + HATCH_CLEAR, u1 - form.at[0] - HATCH_CLEAR, -(v1 - form.at[2]) + HATCH_CLEAR, -(v0 - form.at[2]) - HATCH_CLEAR];
  const top = form.thick / 2 - 0.004;
  const bottom = top - 0.045;
  if (level === 3) return p.box([x0, y0, bottom], [x1, y1, top], tone("deck"));
  const rng = new PyRandom(1400);
  const count = 6;
  if (level < 2) {
    const ws = widths(rng, x1 - x0, count, 0.16);
    const edges = [x0];
    for (const w of ws) edges.push(edges[edges.length - 1]! + w);
    const ys = level === 0 ? [y0, (y0 + y1) / 2, y1] : [y0, y1];
    const still = ys.map(() => 0);
    const wander = [still, ...edges.slice(1, -1).map(() => ys.map(() => (level === 0 ? rng.uniform(-0.006, 0.006) : 0))), still];
    for (let j = 0; j < count; j++) {
      const row = DOOR_ROWS[j % DOOR_ROWS.length]!;
      const c = 0.007;
      const rings = ys.map((y, i): Vec[] => {
        const [xa, xb] = [edges[j]! + wander[j]![i]! + (j === 0 ? 0 : 0.0025), edges[j + 1]! + wander[j + 1]![i]! - (j === count - 1 ? 0 : 0.0025)];
        return [[xa, y, bottom], [xb, y, bottom], [xb, y, top - c], [xb - c, y, top], [xa + c, y, top], [xa, y, top - c]];
      });
      const uv = (q: Vec): Uv => [(q[1] - y0) / 3, (row + (q[0] - edges[j]!) / (edges[j + 1]! - edges[j]!)) / 12];
      p.loft(rings, (_, i, k) => ["deck", uv(rings[i]![k]!)], (i, k) => ["deck", [0.1 + (rings[i]![k]![2] - top) / 3, uv(rings[i]![k]!)[1]]]);
    }
  } else p.box([x0, y0, bottom], [x1, y1, top], custom("deck", (_, q) => [(q[1] - y0) / 3, (q[0] - x0) / 3]));
  // Two ledges under the boards, across them.
  const rails = [y0 + 0.3, y1 - 0.3] as const;
  rails.forEach((y, i) => member(p, level, [x0 + 0.03, y, bottom - 0.02], [x1 - 0.03, y, bottom - 0.02], 0.16, 0.04, Z, [3 + 8 * i, 4 + 8 * i, 3 + 8 * i, 4 + 8 * i], null, 1410 + i, ROUGH * 0.4));
  if (level < 2) {
    // Strap hinges from the hinge side, tapering to a spade tip, each on a knuckle at the leaf's edge.
    for (const x of [x0 + 0.3, x1 - 0.3]) {
      const tip = y1 - 0.75;
      const outline: Cell[] = [[x - 0.035, y1], [x - 0.022, tip + 0.14], [x - 0.016, tip + 0.02], [x, tip - 0.03], [x + 0.016, tip + 0.02], [x + 0.022, tip + 0.14], [x + 0.035, y1]];
      p.extrude(outline, "z", top - 0.004, top + 0.006, iron("y", "rivets", y1));
      if (level === 0) for (const y of [y1 - 0.12, y1 - 0.4]) stud(p, [x, y, top + 0.006], [0, 0, 1], 0.011, 0.006, 4, BOLT_UV);
    }
    // A plate near the far side, and the ring that lies on it.
    const [px, py] = [(x0 + x1) / 2, y0 + 0.2];
    p.box([px - 0.06, py - 0.04, top - 0.004], [px + 0.06, py + 0.04, top + 0.005], iron("x", "plate", px - 0.06));
    if (level === 0) {
      const from = p.faces.length;
      p.ring([px, 0, 0], 0.045, 0.007, iron("x", "strap", 0.4), 8, 4);
      // Built standing, and laid flat on the plate.
      place(p, (q) => [q[0], py + 0.02 - q[2], top + 0.011 + q[1]], from);
    }
  }
  return p;
}

/**
 * A strip of foundation under a wall or a railing where no floor is: two courses of hewn beams, end grain at their
 * ends, dogged together with iron, reaching a little into the ground.
 */
function footing(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const f = frameOf(form);
  const p = new Shape();
  const half = form.thick / 2 - 0.005;
  const top = f.top - 0.005;
  if (level >= 2) return p.box([-f.hx, -half, f.foot], [f.hx, half, top], level === 3 ? tone("timber") : beam("x", 4));
  const mid = (f.foot + top) / 2;
  [[f.foot - SINK, mid], [mid, top]].forEach(([z0, z1], course) => {
    member(p, level, [-f.hx, 0, (z0! + z1!) / 2], [f.hx, 0, (z0! + z1!) / 2], 2 * half - 0.01 * course, z1! - z0!, Z, [3 + course, 5 + course, 3 + course, 7 + course], [course, 1], 1500 + course, ROUGH, 0, true);
  });
  if (level === 0) {
    for (const x of [-f.hx + 0.35, 0, f.hx - 0.35]) for (const s of [-1, 1]) {
      const [y0, y1] = s < 0 ? [s * (half + 0.004), s * (half - 0.006)] : [s * (half - 0.006), s * (half + 0.004)];
      p.box([x - STRAP / 2, y0, mid - 0.11], [x + STRAP / 2, y1, mid + 0.11], iron("z", "rivets", mid - 0.11));
    }
  }
  return p;
}

/** A beam across an edge where a wall's top would be: one heavy hewn timber, an iron band near each end and pegs through it. */
function crossBeam(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const f = frameOf(form);
  const p = new Shape();
  const half = form.thick / 2 - 0.012;
  const [z0, z1] = [f.foot + 0.012, f.top - DROP];
  if (level >= 2) return p.box([-f.hx, -half, z0], [f.hx, half, z1], level === 3 ? tone("timber") : beam("x", 4));
  if (level === 0) timber(p, [-f.hx, 0, (z0 + z1) / 2], [f.hx, 0, (z0 + z1) / 2], 2 * half, z1 - z0, Z, [4, 5, 4, 6], { end: [0, 0], chamfer: 0.03, rough: ROUGH, seed: 1600, segs: 3 });
  else timber(p, [-f.hx, 0, (z0 + z1) / 2], [f.hx, 0, (z0 + z1) / 2], 2 * half, z1 - z0, Z, [4, 5, 4, 6], { chamfer: 0 });
  if (level === 0) {
    for (const x of [-f.hx + 0.42, f.hx - 0.42]) {
      p.box([x - STRAP / 2, -half - 0.008, z0 - 0.008], [x + STRAP / 2, half + 0.008, z1 + 0.008], iron("z", "rivets", z0));
      pegs(p, [[x + 0.14 * Math.sign(x), (z0 + z1) / 2 - 0.09], [x + 0.14 * Math.sign(x), (z0 + z1) / 2 + 0.09]], half, level, 0.02);
    }
  }
  return p;
}

/** A stick of a railing, a ladder or a gate as a timber: `wide` across in the piece's plane and `deep` through it. */
function stick(p: Shape, level: number, s: Stick, bands: Bands, seed: number, o: SparOpts = {}): void {
  if (level === 0) timber(p, s.a, s.b, s.wide, s.deep, Y, bands, { rough: o.rough ?? ROUGH * 0.4, seed, segs: o.segs ?? Math.max(1, Math.round(length(sub(s.b, s.a)) / 1.5)), end: o.end ?? null, ...(o.chamfer === undefined ? {} : { chamfer: o.chamfer }) });
  else timber(p, s.a, s.b, s.wide, s.deep, Y, bands, { chamfer: 0 });
}

/**
 * A railing: a handrail and a foot rail between half posts at its ends and a post in its middle, and a cross of
 * braces in each bay, pegged where they meet. Far off it is its two rails.
 */
function railing(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const f = frameOf(form);
  const p = new Shape();
  const deep = form.thick - 0.012;
  const sticks = railingSticks(f.hx, f.foot, f.top - 0.012, [0.075, deep], [0.09, deep - 0.01], [0.05, 0.03]);
  sticks.forEach((s, k) => {
    if (s.what === "brace" && level >= 2) return;
    if (s.what === "post" && level === 3) return;
    const band = (3 * k) % 10;
    stick(p, level, s, [band, band + 1, band, band + 1], 1700 + k, s.what === "rail" ? { end: [k % 4, 0] } : {});
  });
  if (level === 0) {
    const posts = sticks.filter((s) => s.what === "post");
    const rails = sticks.filter((s) => s.what === "rail");
    pegs(p, posts.slice(1, -1).flatMap((q) => rails.map((r): Cell => [q.a[0], r.a[2]])), deep / 2, level, 0.014, 0.008);
    // Where the braces of a bay cross.
    pegs(p, posts.slice(0, -1).map((q, i): Cell => [(q.a[0] + posts[i + 1]!.a[0]) / 2 + (i === 0 ? 0.0225 : 0) - (i === posts.length - 2 ? 0.0225 : 0), (rails[0]!.a[2] + rails[1]!.a[2]) / 2]), 0.03, level, 0.012, 0.008);
  }
  return p;
}

/**
 * A ladder: two hewn rails and a rung every 0.3 m, each set on edge and let through the rails, so its end grain shows
 * on their outer sides. It stands off the wall's face by the little its row leaves it.
 */
function ladder(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const [u0, v0, u1, v1] = outlineBox(form);
  const [half, foot, top] = [(u1 - u0) / 2, v0 - form.at[1], v1 - form.at[1]];
  // The front is -y: the row's `off` is toward the engine's +Z.
  const near = -(form.off ?? 0) + form.thick / 2 - 0.006;
  const far = -(form.off ?? 0) - form.thick / 2 + 0.004;
  const sticks = ladderSticks(2 * half, foot, top, (near + far) / 2, [0.06, near - far], 0.036, 0.3, 0.012);
  sticks.forEach((s, k) => {
    if (s.what === "rail") return stick(p, level, s, [2 + 5 * k, 3 + 5 * k, 2 + 5 * k, 3 + 5 * k], 1800 + k, { segs: 2, end: [k, 0] });
    if (level === 3 || (level === 2 && k % 2 === 1)) return;
    // A rung on edge, toward the front of the rails.
    const y = (near + far) / 2 - 0.012;
    const [a, b]: [Vec, Vec] = [[s.a[0], y, s.a[2]], [s.b[0], y, s.b[2]]];
    timber(p, a, b, s.wide * (level === 2 ? 1.6 : 1), s.deep * (level === 2 ? 1.6 : 1), [0, 1, 1], [(k * 5) % 11, (k * 5) % 11, (k * 5) % 11 + 1, (k * 5) % 11 + 1], { chamfer: 0, end: level === 0 ? [k % 4, 1] : null });
  });
  return p;
}

/**
 * A ramp up toward -y (the engine's +Z): planks across it with a cleat on every other one, between two stringers that
 * stand a little over them, solid underneath as the collision is, its sides and back framed like the stairs'.
 */
function ramp(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const p = new Shape();
  const plan = planOf(form);
  const tops = form.corner!.map((h) => h - form.at[1]);
  const [lo, hi] = [Math.min(...tops), Math.max(...tops)];
  const run = 2 * H;
  const k = Math.hypot(run, hi - lo) / run;
  const at = (y: number): number => lo + ((hi - lo) * (H - y)) / run;
  if (level === 3) return slabOn(p, plan, tops, plan.map(() => lo), () => tone("boards")("", X, X));
  const s = 1.42;
  const plank = 0.05;
  const cut = level === 0 ? plank * k : 0;
  const rear = -H + 0.06;
  // The solid under the planks, (y, z) going round as seen from +x: its top is the planks' underside.
  const front = H - (cut * run) / (hi - lo);
  const rows = 17;
  const span = (run * k) / rows;
  p.extrude([[rear, lo], [front, lo], [rear, at(rear) - cut]], "x", -s, s, (label, a, b) => {
    if (label === "-x" || label === "+x") return ["boards", (q) => [(q[2] + H) / 3, ((q[1] + H) / 3) * (label === "+x" ? 1 : -1) + 0.5]];
    // The slope wears the planks where there are none of their own.
    if (label === "+z" || label === "+y") return ["deck", (q) => [(q[0] + H) / 3, ((H - q[1]) * k) / span / 12]];
    return grid("boards")(label, a, b);
  });
  const slope = planeAt([0, H, lo], [0, hi - lo, run]);
  const on = (x: number, t: number, n: number): Vec => [x, H - t / k - (n * (hi - lo)) / (run * k), lo + (t * (hi - lo)) / (run * k) + n / k];
  if (level === 0) {
    const rng = new PyRandom(1900);
    const from = p.faces.length;
    for (let i = 0; i < rows; i++) {
      const [t0, t1] = [i * span + 0.0015, (i + 1) * span - 0.0015];
      const row = rng.randrange(12);
      const sag = rng.uniform(0, 0.002);
      const rings = [-s + rng.uniform(0, 0.01), s - rng.uniform(0, 0.01)].map((x): Vec[] => ([[t0, -plank], [t1, -plank], [t1, -0.006], [t1 - 0.006, -sag], [t0 + 0.006, -sag], [t0, -0.006]] as const).map(([t, n]) => on(x, t, n)));
      const v = (j: number): number => (row + [0, 1, 1, 0.96, 0.04, 0][j]!) / 12;
      p.loft(rings, (_, r, j) => ["deck", [(rings[r]![j]![0] + H) / 3, v(j)]], (r, j) => ["deck", [0.1 + (j < 2 ? -plank : 0) / 3, v(j)]]);
      // A cleat for the foot on every other plank.
      if (i % 2 === 1) timber(p, on(-1.2, (i + 0.5) * span, 0.008), on(1.2, (i + 0.5) * span, 0.008), 0.045, 0.028, [0, -(hi - lo), run], [i % 11, i % 11, i % 11 + 1, i % 11 + 1], { chamfer: 0.006 });
    }
    // The lowest plank runs out on the floor.
    clip(p, planeAt([0, 0, lo], [0, 0, -1]), null, from);
  }
  // A stringer each side, from the floor to the head, a little over the planks.
  const over = 0.03, deep = 0.32;
  const stringer: Cell[] = [[H, lo], [H, lo + over], [-H, hi + over], [-H, hi - deep], [H - (deep * run) / (hi - lo), lo]];
  for (const [x0, x1, band] of [[-H, -s, 2], [s, H, 9]] as const) {
    p.extrude(stringer, "x", x0, x1, () => ["timber", (q) => [((H - q[1]) * k) / 3, bandV(band) + (q[2] - at(q[1])) / 3]]);
  }
  const sill = lo + 0.18;
  if (level < 2) {
    [-1, 1].forEach((sx, i) => {
      const x = sx * s;
      const from = p.faces.length;
      member(p, level, [x, -H, (lo + sill) / 2], [x, H - 0.4, (lo + sill) / 2], 0.12, sill - lo, Z, sx < 0 ? [4, 5, 4, 5] : [8, 9, 8, 9], null, 1910 + i);
      member(p, level, [x, -H + 0.1, sill], [x, -H + 0.1, hi], 0.12, 0.2, X, [6, 6, 7, 7], null, 1912 + i, ROUGH * 0.5);
      member(p, level, [x, 0, sill], [x, 0, at(0)], 0.12, 0.2, X, [11, 11, 3, 3], null, 1914 + i, ROUGH * 0.5);
      // Their tops end in the stringer.
      clip(p, planeMoved(slope, -0.06), null, from);
    });
  }
  // The back's sill, rail and post, as the stairs' have.
  member(p, level, [-1.36, -H + 0.03, (lo + sill) / 2], [1.36, -H + 0.03, (lo + sill) / 2], 0.05, sill - lo, Z, [7, 7, 7, 7], null, 1916);
  member(p, level, [-1.36, -H + 0.035, (lo + hi) / 2], [1.36, -H + 0.035, (lo + hi) / 2], 0.05, 0.18, Z, [10, 10, 10, 10], null, 1917);
  member(p, level, [0, -H + 0.03, sill], [0, -H + 0.03, hi - 0.1], 0.18, 0.06, Y, [5, 5, 5, 5], null, 1918, ROUGH * 0.4);
  return p;
}

/**
 * A wall four storeys high in one piece. It reads as four walls stacked: sill and top plate, posts the whole height,
 * a girt where each storey's plate and the next one's sill would lie, a knee each side under the plate and under the
 * second girt, and boards in eight bays. Its boards are straight laps, as a wall's are from 19 m: wandering edges on
 * eighty boards are more than one piece may cost.
 */
function tallWall(form: FormDef, level: number, strips: boolean): Shape | null {
  if (level > 4) return null;
  const f = frameOf(form);
  const p = new Shape();
  if (level === 4) return p.box([-f.hx, -WALL_T, f.foot], [f.hx, WALL_T, f.top], tone("boards"));
  if (level === 3) return p.framed([-f.hx, -WALL_T, f.foot], [f.hx, WALL_T, f.top], [-f.ring, f.foot + SILL, f.ring, f.top - PLATE], tone("timber"), tone("boards"));
  const storeys = Math.round((f.top - f.foot) / (2 * H));
  const lines = Array.from({ length: storeys + 1 }, (_, i) => f.foot + ((f.top - f.foot) * i) / storeys);
  const edge = f.hx - POST + 0.02;
  // The frame: plates, corner posts and a middle post the whole height.
  const reach = level < 2 ? f.hx : f.ring;
  const zt = (f.top - PLATE + f.top - DROP) / 2, zs = (f.foot - DROP + f.foot + SILL) / 2;
  if (level < 2) {
    spar(p, level, [-reach, 0, zt], [reach, 0, zt], 2 * TOP_T, PLATE - DROP, Z, [4, 5, 4, 6], 2000, { segs: 2, end: [0, 0], rough: ROUGH });
    spar(p, level, [-reach, 0, zs], [reach, 0, zs], 2 * SILL_T, SILL + DROP, Z, [9, 10, 9, 11], 2001, { segs: 2, end: [1, 0], rough: ROUGH });
    for (const [s, band] of [[-1, 1], [1, 7]] as const) spar(p, level, [s * (f.hx - POST / 2), 0, f.foot + SILL], [s * (f.hx - POST / 2), 0, f.top - PLATE], POST, 2 * PLATE_T, Y, [band, band, band + 1, band + 1], 2010 + s, { segs: 2, rough: ROUGH * 0.5 });
    spar(p, level, [0, 0, f.foot + SILL], [0, 0, f.top - PLATE], 2 * MID, 2 * MID_T, Y, [5, 5, 6, 6], 2012, { segs: 2, rough: ROUGH * 0.5 });
    if (strips) endStrips(p, f, 1, [1, 7]);
  } else {
    p.box([-reach, -TOP_T, f.top - PLATE], [reach, TOP_T, f.top - DROP], beam("x", 4));
    p.box([-reach, -SILL_T, f.foot - DROP], [reach, SILL_T, f.foot + SILL], beam("x", 9));
    for (const [s, band] of [[-1, 1], [1, 7]] as const) {
      const [x0, x1] = [s * f.ring, s * f.hx].sort((a, b) => a - b) as [number, number];
      p.box([x0, -PLATE_T, f.foot - DROP], [x1, PLATE_T, f.top - DROP], beam("z", band, -f.foot));
    }
    p.box([-MID, -MID_T, f.foot + SILL], [MID, MID_T, f.top - PLATE], beam("z", 5, -f.foot));
  }
  lines.slice(1, -1).forEach((line, i) => {
    // A girt as deep as a plate and a sill together, between the posts.
    const [z0, z1] = [line - PLATE + DROP, line + SILL];
    if (level < 2) spar(p, level, [-edge, 0, (z0 + z1) / 2], [edge, 0, (z0 + z1) / 2], 2 * JAMB_T, z1 - z0, Z, [(3 * i + 2) % 10, (3 * i + 3) % 10, (3 * i + 2) % 10, (3 * i + 4) % 10], 2020 + i, { segs: 1, rough: ROUGH * 0.7 });
    else p.box([-f.ring, -JAMB_T, z0], [f.ring, JAMB_T, z1], beam("x", (3 * i + 2) % 10));
  });
  for (let i = 0; i < storeys; i++) {
    const [sill, head] = [lines[i]! + SILL, lines[i + 1]! - PLATE + (i === storeys - 1 ? 0 : DROP)];
    if (level === 0) {
      bay(p, 1, -edge, -MID + 0.02, sill, head, 2040 + 2 * i, 0, lines[i]!);
      bay(p, 1, MID - 0.02, edge, sill, head, 2041 + 2 * i, 0.5, lines[i]!);
    } else if (level === 1) {
      panel(p, -edge, -MID + 0.02, sill, head, lines[i]!);
      panel(p, MID - 0.02, edge, sill, head, lines[i]!);
    } else panel(p, -f.ring, f.ring, sill, head, lines[i]!);
    // Knees under the plate, and under the girt half way up.
    if (level < 2 && (i === storeys - 1 || i === Math.floor(storeys / 2) - 1)) for (const [s, band] of [[-1, 2], [1, 10]] as const) member(p, level, [s * (f.hx - POST), 0, head - 0.64], [s * 0.78, 0, head], 0.09, 2 * BRACE_T, Y, [band, band + 1, band, band + 1], null, 2030 + i + s);
  }
  if (level === 0) {
    for (const x of [-f.hx + POST / 2, f.hx - POST / 2]) strapZ(p, x, f.foot + 0.04, f.foot + SILL + 0.3, PLATE_T);
    pegs(p, [[0, f.top - PLATE / 2 - 0.01], [0, f.foot + SILL / 2], [0, lines[Math.floor(storeys / 2)]!]], TOP_T, level);
  }
  return p;
}

/**
 * A gateway two edges wide and two storeys high: two posts of heavy timber on plinths, and over them a lintel beam
 * under a top plate, pegged at each post. Nothing stands in its opening, which its gate fills. From 386 m it is a
 * flat frame seen from both faces: twelve triangles cannot be a closed frame, and a box would shut the opening.
 */
function gateway(form: FormDef, level: number): Shape | null {
  if (level > 4) return null;
  const f = frameOf(form);
  const p = new Shape();
  const o = form.openings![0]!;
  const [xa, xb, zo] = [o.x0 - form.at[0], o.x1 - form.at[0], o.y1 - form.at[1]];
  const half = form.thick / 2;
  if (level >= 3) {
    // In (z, x), going round as seen from +y: the frame with its opening a notch in the foot.
    const outline: Cell[] = [[f.foot, -f.hx], [f.foot, xa], [zo, xa], [zo, xb], [f.foot, xb], [f.foot, f.hx], [f.top, f.hx], [f.top, -f.hx]];
    if (level === 3) return p.extrude([...outline].reverse(), "y", -half, half, tone("timber"));
    const tris = [0, 1, 2, 0, 2, 7, 2, 3, 7, 3, 6, 7, 3, 5, 6, 3, 4, 5];
    for (const y of [-1, 1]) {
      const points = outline.map(([z, x]): Vec => [x, 0, z]);
      p.faces.push({ points, uvs: points.map(() => [0, 0] as const), mat: "timber", tris: y < 0 ? tris : tris.flatMap((_, i) => (i % 3 === 0 ? [tris[i]!, tris[i + 2]!, tris[i + 1]!] : [])) });
    }
    p.error = half;
    return p;
  }
  const beamTop = f.top - 0.27;
  const plinth = 0.5;
  for (const [s, x0, x1] of [[-1, -f.hx, xa], [1, xb, f.hx]] as const) {
    const [xc, wide] = [(x0 + x1) / 2, x1 - x0];
    if (level === 2) {
      p.box([x0 + 0.012, -half + 0.012, f.foot], [x1 - 0.012, half - 0.012, zo], beam("z", s < 0 ? 1 : 7, -f.foot));
      continue;
    }
    // A plinth block, and the post on it up into the lintel.
    spar(p, level, [xc, 0, f.foot - SINK], [xc, 0, f.foot + plinth], wide - 0.004, 2 * half - 0.004, Y, [3, 4, 5, 6], 2100 + s, { segs: 1, rough: ROUGH * 0.4, chamfer: 0.03 });
    spar(p, level, [xc, 0, f.foot + plinth], [xc, 0, zo + 0.05], wide - 0.05, 2 * half - 0.05, Y, s < 0 ? [1, 1, 2, 2] : [7, 7, 8, 8], 2102 + s, { segs: 3, rough: ROUGH, chamfer: 0.04 });
    if (level === 0) {
      for (const z of [f.foot + plinth + 0.5, zo - 0.7]) p.box([x0 + 0.017, -half + 0.017, z - STRAP / 2], [x1 - 0.017, half - 0.017, z + STRAP / 2], iron("x", "rivets", x0));
      // The pintles the gate hangs on, on the post's inner side.
      const inner = s < 0 ? x1 : x0;
      for (const z of [f.foot + 0.9, (f.foot + zo) / 2, zo - 0.9]) p.box([Math.min(inner, inner - s * 0.03), -0.09, z - 0.05], [Math.max(inner, inner - s * 0.03), -0.03, z + 0.05], iron("z", "plate", z - 0.05));
      pegs(p, [[xc - 0.1, (zo + beamTop) / 2 - 0.1], [xc + 0.1, (zo + beamTop) / 2 - 0.1], [xc - 0.1, (zo + beamTop) / 2 + 0.1], [xc + 0.1, (zo + beamTop) / 2 + 0.1]], half - 0.01, level, 0.024, 0.014);
    }
  }
  if (level === 2) {
    p.box([-f.hx, -half, zo], [f.hx, half, f.top - DROP], beam("x", 4));
    return p;
  }
  // The lintel beam across both posts, and the plate over it.
  spar(p, level, [-f.hx, 0, (zo + beamTop) / 2], [f.hx, 0, (zo + beamTop) / 2], 2 * half - 0.02, beamTop - zo, Z, [5, 6, 5, 7], 2110, { segs: 4, rough: ROUGH, end: [0, 1], chamfer: 0.03 });
  spar(p, level, [-f.hx, 0, (beamTop + f.top - DROP) / 2], [f.hx, 0, (beamTop + f.top - DROP) / 2], 2 * half, f.top - DROP - beamTop, Z, [9, 10, 9, 11], 2111, { segs: 4, rough: ROUGH, end: [0, 0] });
  return p;
}

/**
 * A gate of two leaves that meet in the middle: upright boards on three ledges and two braces a leaf, hung on long
 * strap hinges at each ledge, and barred across the back. The front is -y. One piece of 5 by 5.25 m: its boards are
 * straight, a board to a row of the picture, and its iron is what marks it from afar.
 */
function gate(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const f = frameOf(form);
  const p = new Shape();
  const half = form.thick / 2;
  if (level === 3) return p.box([-f.hx, -half, f.foot], [f.hx, half, f.top], tone("boards"));
  const [front, back] = [-half, -half + 0.055];
  const [foot, top] = [f.foot + 0.02, f.top - 0.015];
  const leaves = gateLeaves(f.hx - 0.012, foot, top, 2, 0.25, 3, 0.45);
  const rng = new PyRandom(2200);
  for (const [n, leaf] of leaves.entries()) {
    if (level === 0) {
      leaf.boards.forEach(([x0, x1], j) => {
        const row = DOOR_ROWS[(j + 2 * n) % DOOR_ROWS.length]!;
        const [z0, z1] = [foot + rng.uniform(0, 0.015), top - rng.uniform(0, 0.012)];
        const [xa, xb] = [x0 + 0.003, x1 - 0.003];
        const rings = [z0, z1].map((z): Vec[] => [[xa, front + 0.006, z], [xa + 0.006, front, z], [xb - 0.006, front, z], [xb, front + 0.006, z], [xb, back, z], [xa, back, z]]);
        p.loft(rings, (_, i, k) => ["boards", [BOARD_NAILS + (rings[i]![k]![2] - foot) / 3, (row + (rings[i]![k]![0] - x0) / (x1 - x0)) / 12 - BOARD_ROLL_V]], (i, k) => ["boards", [0.5 + rings[i]![k]![1] / 3, (row + (rings[i]![k]![0] - x0) / (x1 - x0)) / 12 - BOARD_ROLL_V]], 2);
      });
    } else p.box([leaf.x0, front, foot], [leaf.x1, back, top], custom("boards", (_, q) => [BOARD_NAILS + (q[2] - foot) / 3, (q[0] - leaf.x0) / 3 - BOARD_ROLL_V]));
    const near = leaf.hinge < 0 ? leaf.x0 : leaf.x1;
    leaf.ledges.forEach((z, i) => {
      // A ledge across the back, and on the front a strap hinge over it, on a knuckle at the leaf's hung side.
      spar(p, level, [leaf.x0 + 0.04, back + 0.04, z], [leaf.x1 - 0.04, back + 0.04, z], 0.08, 0.2, Z, [3 + 4 * i, 4 + 4 * i, 3 + 4 * i, 4 + 4 * i], 2210 + 3 * n + i, { segs: 1, rough: ROUGH * 0.5 });
      if (level === 2) return;
      const tip = near - leaf.hinge * 1.5;
      const strap = (x: number): number => near - leaf.hinge * x;
      const outline: Cell[] = [[strap(0), z - 0.06], [strap(1.1), z - 0.035], [strap(1.42), z - 0.03], [tip, z], [strap(1.42), z + 0.03], [strap(1.1), z + 0.035], [strap(0), z + 0.06]];
      p.extrude(outline.map(([x, zz]) => [zz, x] as const), "y", front - 0.01, front + 0.002, iron("x", "rivets", Math.min(near, tip)));
      if (level > 0) return;
      stud(p, [near + leaf.hinge * 0.004, front - 0.016, z - 0.1], [0, 0, 1], 0.022, 0.2, 6, [0.2, 0.43]);
      for (const x of [0.25, 0.75, 1.25]) stud(p, [strap(x), front - 0.01, z], [0, -1, 0], 0.016, 0.01, 4, BOLT_UV);
    });
    if (level < 2) leaf.braces.forEach(([a, b], i) => {
      const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
      const l = Math.hypot(dx, dz);
      // Between the ledges, clear of both.
      const [ta, tb] = [0.22 / l, 1 - 0.22 / l];
      spar(p, level, [a[0] + dx * ta, back + 0.035, a[1] + dz * ta], [a[0] + dx * tb, back + 0.035, a[1] + dz * tb], 0.16, 0.07, Y, [1 + 5 * i, 1 + 5 * i, 2 + 5 * i, 2 + 5 * i], 2230 + 2 * n + i, { segs: 1, rough: ROUGH * 0.5 });
    });
  }
  if (level < 2) {
    // The bar across the back, in an iron bracket on each leaf.
    const z = foot + 1.25;
    spar(p, level, [-1.6, back + 0.08 + 0.045, z], [1.6, back + 0.08 + 0.045, z], 0.09, 0.15, Z, [8, 9, 8, 9], 2240, { segs: 1, rough: ROUGH * 0.5, end: [2, 0] });
    if (level === 0) for (const x of [-1.1, 1.1]) p.box([x - 0.04, back + 0.07, z - 0.1], [x + 0.04, back + 0.08 + 0.097, z + 0.085], iron("z", "plate", z - 0.1));
  }
  return p;
}

// Trims: what the client draws where pieces meet (client/core/render/trims.ts). A joint stands on its corner from the
// level up a storey, and is cut to a lower wall's height by clamping every vertex over n quarter storeys and a
// centimetre down onto that height (piece-fit.ts). So a joint's shaft is the same section all the way up, with a ring
// of vertices at each height it may be cut to, and its head lies inside that section: cut, the head folds flat onto
// the shaft and the post ends in a level top, its end grain in a rim of timber, and has no pegs.

/** The heights a joint may be cut to, a centimetre over one, two and three quarter storeys, and its own. */
const JOINT_RINGS = [0.76, 1.51, 2.26] as const;
const JOINT_HIGH = 3;
/** Half the width of the square joint: a wall's corner post and a centimetre. */
const JOINT_HALF = POST + 0.01;
const JOINT_CAP = 0.01;

/** A face a trim has no back for: given looking outward, into a level that is drawn open where it is never seen. */
function sheet(p: Shape, points: Vec[], mat: string, uv: (q: Vec) => Uv): void {
  p.faces.push({ points, uvs: points.map(uv), mat });
}

/**
 * A post on a corner: `sides` sides, `reach` from the corner to each of its arrises, turned so that an arris lies
 * `turn` round from +x. On the finest level it is hewn a little out of true between its foot and its head, its head
 * is drawn in to a flat a centimetre over the storey, and `pegged` puts an oak peg through each face under the head.
 */
function post(level: number, sides: number, reach: number, turn: number, pegged: boolean, band: number, seed: number): Shape {
  const p = new Shape();
  const rng = new PyRandom(seed);
  // A square post's arrises are taken off on the finest level: two points to a corner.
  const eased = sides === 4 && level === 0 ? 0.022 : 0;
  const count = eased ? 8 : sides;
  const ring = (z: number, r: number, rough: number): Vec[] => Array.from({ length: count }, (_, k): Vec => {
    const corner = eased ? Math.floor(k / 2) : k;
    const t = turn + (2 * Math.PI * corner) / sides;
    const at = r + rng.uniform(-1, 1) * rough;
    // Back along the side before the corner, or on along the side after it.
    const along = eased ? t + (k % 2 === 0 ? -1 : 1) * ((3 * Math.PI) / 4) : 0;
    return [Math.cos(t) * at + Math.cos(along) * eased, Math.sin(t) * at + Math.sin(along) * eased, z];
  });
  // Each face a strip of one timber's band, its grain running up.
  const side = (k: number, i: number, j: number, rings: Vec[][]): readonly [string, Uv] => {
    const wide = eased && k % 2 === 0 ? eased * Math.SQRT2 : 2 * reach * Math.sin(Math.PI / sides) - 2 * eased;
    return ["timber", [rings[i]![j]![2] / 3, bandV((band + (sides === 4 ? k >> (eased ? 1 : 0) : k % 2)) % 12) + ((j === k ? -0.5 : 0.5) * wide) / 3]];
  };
  const grain = (q: Vec): Uv => [cellUv(1, 0)[0] + q[0] / 2.4, cellUv(1, 0)[1] + q[1] / 2.4];
  if (level === 3) {
    // Far off, a post of three sides: eight triangles close nothing wider.
    const three = Array.from({ length: 3 }, (_, k): Cell => [Math.cos((2 * Math.PI * k) / 3) * reach * 1.25, Math.sin((2 * Math.PI * k) / 3) * reach * 1.25]);
    return p.extrude(three, "z", 0, JOINT_HIGH + JOINT_CAP, tone("timber"));
  }
  if (level === 2) {
    const half = reach * Math.cos(Math.PI / sides) * (sides === 4 ? 1 : 0.96);
    const c = sides === 4 ? reach * Math.SQRT1_2 : half;
    if (sides === 4 && Math.abs(Math.cos(turn)) > 0.99) throw new Error("a square post's sides are along the axes");
    return p.box([-c, -c, 0], [c, c, JOINT_HIGH + JOINT_CAP], beam("z", band));
  }
  // Past the finest level a round post is one length: cut, its picture squeezes, from 19 m off.
  const heights = level === 0 || sides === 4 ? [0, ...JOINT_RINGS, JOINT_HIGH - 0.06] : [0];
  const rings = heights.map((z, i) => ring(z, reach, level === 0 && i > 0 && i < heights.length - 1 ? ROUGH * 0.3 : 0));
  // The head: drawn in over its last six centimetres to a flat that stands a centimetre over the storey.
  rings.push(ring(JOINT_HIGH + JOINT_CAP, reach * 0.8, 0));
  p.loft(rings, (k, i, j) => side(k, i, j, rings), (i, j) => ["fittings", grain(rings[i]![j]!)]);
  if (pegged && level === 0) {
    for (let k = 0; k < sides; k++) {
      const t = turn + (2 * Math.PI * (k + 0.5)) / sides;
      const out = reach * Math.cos(Math.PI / sides);
      stud(p, [Math.cos(t) * out, Math.sin(t) * out, JOINT_HIGH - 0.2], [Math.cos(t), Math.sin(t), 0], 0.02, 0.01, 4, PEG_UV);
    }
  }
  return p;
}

/**
 * The skirt under a foundation's open side: a bearer with a weathered top, upright boards hanging from it, and a post
 * at each end and in the middle. It hangs from the middle of the side, its top at the foundation's, 0.12 m out from
 * the side: 2 cm proud of a wall's face. It is drawn sunk into the ground, so nothing is spent on its foot.
 */
function skirt(level: number): Shape {
  const p = new Shape();
  const [out, deep, bear, lip] = [0.12, 2.4, 0.2, 0.035];
  const boards: (q: Vec) => Uv = (q) => [q[2] / 3, (q[0] + H) / 3];
  if (level === 3) {
    // Its face alone: two triangles close nothing.
    sheet(p, [[-H, -out, -deep], [H, -out, -deep], [H, -out, -lip], [-H, -out, -lip]], "boards", boards);
    return p;
  }
  // Its face and its weathered top, closed by a back that slants in to its foot.
  if (level === 2) return p.extrude([[0, 0], [-out, -deep], [-out, -lip]], "x", -H, H, (label) => (label === "-y" ? ["boards", boards] : ["timber", (q) => [(q[0] + H) / 3, bandV(4) + q[1] / 3]]));
  // The bearer, (y, z) going round as seen from +x.
  p.extrude([[0, 0], [0, -bear], [-out, -bear], [-out, -lip]], "x", -H, H, (label) => [label[1] === "x" ? "fittings" : "timber", label[1] === "x" ? (q) => [cellUv(2, 1)[0] + q[1] + out / 2, cellUv(2, 1)[1] + q[2] + bear / 2] : (q) => [(q[0] + H) / 3, bandV(label === "+z" ? 5 : 4) + (label === "+z" ? q[1] : q[2] + bear / 2) / 3]]);
  p.box([-H, -out + 0.02, -deep], [H, -0.015, -bear], custom("boards", (_, q) => boards(q)));
  if (level === 1) return p;
  for (const [x0, x1, band] of [[-H, -H + 0.08, 2], [-0.08, 0.08, 7], [H - 0.08, H, 10]] as const) {
    p.box([x0, -out, -deep], [x1, -0.01, -bear + 0.004], beam("z", band));
    stud(p, [(x0 + x1) / 2, -out, -bear / 2 - 0.02], [0, -1, 0], 0.018, 0.01, 4, PEG_UV);
  }
  return p;
}

/**
 * The capping along a ridge where two roofs' high sides meet: two boards laid to the slopes and a roll along their
 * joint, nailed down. It lies along x on the ridge's own line, which is at its origin's height. No client draws it yet.
 */
function ridge(level: number): Shape {
  const p = new Shape();
  const [wide, top, drop] = [0.22, 0.075, 0.068];
  const wing = (s: number, q: Vec): Uv => [(q[0] + H) / 3, (s < 0 ? 3 : 8) / 12 - BOARD_ROLL_V + Math.abs(q[1]) / 3];
  if (level === 3) {
    sheet(p, [[-H, wide, 0.02], [-H, -wide, 0.02], [H, -wide, 0.02], [H, wide, 0.02]], "boards", () => [0, 0]);
    return p;
  }
  // Its two slopes over a flat underside.
  if (level === 2) return p.extrude([[0, top], [wide, -drop], [-wide, -drop]], "x", -H, H, () => ["boards", (q) => wing(Math.sign(q[1]) || 1, q)]);
  // The two boards as one solid, (y, z) going round as seen from +x.
  p.extrude([[0, top], [wide, -drop], [wide, -drop - 0.032], [0, top - 0.03], [-wide, -drop - 0.032], [-wide, -drop]], "x", -H, H, () => ["boards", (q) => wing(Math.sign(q[1]) || 1, q)]);
  if (level === 1) return p;
  timber(p, [-H, 0, top + 0.012], [H, 0, top + 0.012], 0.05, 0.05, [0, 1, 1], [1, 1, 2, 2], { chamfer: 0, end: [3, 0] });
  for (const x of [-1.05, 1.05]) for (const s of [-1, 1]) stud(p, [x, s * 0.14, top - (0.14 * (top + drop)) / wide], [0, s * (top + drop), wide], 0.012, 0.006, 4, BOLT_UV);
  return p;
}

/** Wood's trims by the names the client finds them under, each at its four levels. */
function woodTrims(): Record<string, Shape[]> {
  const levels = (make: (level: number) => Shape): Shape[] => [0, 1, 2, 3].map(make);
  return {
    // A hewn corner post with a pegged head. It holds the corner posts of the walls that end in it, a centimetre
    // past their inner sides, so none of its faces lies in a plane with one of theirs.
    joint_sq: levels((level) => post(level, 4, JOINT_HALF * Math.SQRT2, Math.PI / 4, true, 1, 2300)),
    // Round posts where walls meet off the square: a flat faces each wall at 120 and 150 degrees, and an arris lies
    // in the notch between two walls at 60, where the wider post is.
    joint_r15: levels((level) => post(level, 12, 0.15, Math.PI / 12, false, 5, 2301)),
    joint_r21: levels((level) => post(level, 12, 0.21, 0, false, 8, 2302)),
    skirt: levels(skirt),
    ridge: levels(ridge),
  };
}

/** The forms past the first nine, by name: each is built from its row's numbers alone. */
const PLANNED: Readonly<Record<string, (form: FormDef, level: number, strips: boolean) => Shape | null>> = {
  half_wall: wallFamily,
  quarter_wall: wallFamily,
  double_doorway: wallFamily,
  large_wall: tallWall,
  sloped_wall_left: gable,
  sloped_wall_right: gable,
  railing,
  beam: crossBeam,
  fence_foundation: footing,
  gateway,
  gate,
  ladder,
  ramp,
  triangle_foundation: triFoundation,
  triangle_ceiling: triCeiling,
  trapdoor_frame: hatchFrame,
  trapdoor: hatch,
  quarter_foundation: foundation,
  corner_pillar: pillar,
  thin_pillar: pillar,
  roof,
  roof_hip: roof,
  roof_valley: roof,
  triangle_roof: roof,
  triangle_roof_low: roof,
};

/** The wood tier. With `strips`, a wall's ends carry the strips that fill an outside corner where no joint is drawn. */
export function woodRecipe(strips: boolean): TierRecipe {
  return {
    name: "wood",
    rank: 1,
    runPost: true,
    jointHalf: JOINT_HALF,
    // Each is a palette entry (shared/pack/palette.ts), so the match is exact.
    tones: { boards: [176, 120, 84], deck: [198, 142, 104], timber: [94, 60, 40], fittings: [46, 36, 32] },
    split(name, form, level) {
      const planned = PLANNED[name];
      if (planned) return planned(form, level, strips);
      if (form.layer === "wall") return wallFamily(form, level, strips);
      if (form.layer === "slab" && form.root === "always") return foundation(form, level);
      if (form.layer === "slab" && form.outline.length === 4 && !form.corner && !form.openings) return ceiling(form, level);
      if (form.layer === "post") return pillar(form, level);
      if (form.layer === "leaf" && form.plane !== "flat") return door(form, level);
      if (form.layer === "fill" && form.steps !== undefined) return stairs(form, level);
      throw new Error(`wood has no recipe for ${name} yet`);
    },
    trims: woodTrims,
  };
}

// THE SWITCH. Wood's joints are drawn once its pack holds core:joint_sq_wood (client/core/render/trims.ts), and its
// walls' strips then stand inside them. Make this `woodRecipe(false)` in the commit that publishes that pack.
export const WOOD: TierRecipe = woodRecipe(true);
/** Wood as it is with joints drawn: every wall ends flat on its collider's ends. */
export const WOOD_JOINTED: TierRecipe = woodRecipe(false);
