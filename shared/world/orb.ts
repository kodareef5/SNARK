// An orb: a great lit sphere standing on the ground, its skin a screen. The map head places it once, as it places a
// Tide Eye, so it is drawn whatever chunks a client holds; its collision pieces travel as ordinary statics.
import { STRUCT_UNITS, YAW_UNITS } from "../coords.ts";
import { PI, TAU, detCos, detSin } from "../math/scalar.ts";
import type { HullDef } from "./convex.ts";
import { HALF_SIDE, frameAxes } from "./frame.ts";
import type { MapStatic } from "./mapfile.ts";
import { CAST_PHASE, EYE_PERIOD } from "./tide-eye.ts";

/** Metres: `x`, `z` its axis, `y` the ground there. The sphere's centre is `centre` over the ground and its radius `radius`. */
export interface OrbSite {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Its heading, 65,536 to a turn, as a static's: where longitude 0 of its picture faces. */
  readonly yaw: number;
  readonly radius: number;
  readonly centre: number;
}

// ---- The programme, which every client reads from the server clock and no message carries.
// A scene holds for two cycles of the blue Tide Eye and changes on its cast, with a wipe across the skin.

/** The scenes, in the order the programme shows them. A scene's number is its place here. */
export const ORB_SCENES = ["watcher", "moon", "core", "storm", "tide"] as const;
export type OrbScene = typeof ORB_SCENES[number];
/** Seconds a scene holds, and seconds a change takes to cross the skin. */
export const ORB_HOLD = 2 * EYE_PERIOD;
export const ORB_WIPE = 4;

/** What an orb shows at a moment: the scene, the one before it, and how far the change has crossed, 0 to 1 (1 once done). */
export interface OrbShow {
  scene: number;
  before: number;
  wipe: number;
}

/**
 * What every orb shows at `seconds` on the server clock, into `out`. `only` holds one scene for good (an admin's
 * choice) where it is a scene's number, and -1 leaves the programme to run.
 */
export function orbShow(seconds: number, out: OrbShow, only = -1): OrbShow {
  if (only >= 0) {
    out.scene = out.before = only % ORB_SCENES.length;
    out.wipe = 1;
    return out;
  }
  const since = seconds - CAST_PHASE, slot = Math.floor(since / ORB_HOLD), into = since - slot * ORB_HOLD;
  const n = ORB_SCENES.length;
  out.scene = ((slot % n) + n) % n;
  out.before = (((slot - 1) % n) + n) % n;
  out.wipe = into >= ORB_WIPE ? 1 : into / ORB_WIPE;
  return out;
}

// ---- The shell, which bodies stand on and rays stop at. The engine has no curved collider, so the shell is flat facets:
// convex parts whose outer corners lie on one grid of rows and meridians, so facets meet edge to edge with no lip. A
// course is some rows of that grid, cut into equal pieces round the axis. A turned piece's frame is rounded (frame.ts),
// so each turn within a quarter has a shape of its own, written so that its frame sets every corner where it belongs.
// A site's heading does not turn its shell: a sphere is round, and its pieces keep the turns their shapes were written for.

/**
 * The sizes the content has shells for (content/orb.ts): the radius, the centre's height over the ground, the facets
 * round the equator, and each course from the top down as its last row, its pieces round and how far from the axis a
 * piece's origin is. The courses are what tools/orb/shell.ts fits, and the count round is the one that fits the fewest
 * pieces (tests/world/orb.test.ts).
 */
export const ORB_SIZES = [{ radius: 78, centre: 34, round: 72, courses: [[2, 1, 0], [4, 6, 22.34], [7, 12, 35.83], [11, 18, 54.04], [15, 18, 68.94], [19, 18, 75.39], [24, 18, 72.85]] }] as const;
/** What every piece of an orb's collision is named by: a kind drawn as nothing, which the orb's own pass draws over. */
export const ORB_COLLIDER = "core:zzorb_";
export const orbCollider = (id: string): boolean => id.startsWith(ORB_COLLIDER);

/** Metres across the widest a facet may be before its row has twice as many. */
const WIDE = 8.9;
/** Metres of shell under the facets, and metres a part widens by under its neighbours, which seals their joins. */
const THICK = 3;
const FLARE = 0.3;
/** Metres the shell goes on under the ground. */
const UNDER = 2;
/** The furthest up or down a piece may reach from its origin, and the most parts it may have (shared/content/kinds/shapes.ts). */
const REACH = 15.9;
const MOST_PARTS = 16;
/** The furthest sideways: with the widest walker's radius it must stay inside a route's margin (path.ts ROUTE_MARGIN). */
const SPREAD = 14.5;

/**
 * One shape of an orb's collision and where its pieces stand: metres from the axis and over the ground under it, and
 * their turns. With `turns`, its pieces turn about the axis with the site's heading, as the plinth is drawn.
 */
export interface OrbShape {
  readonly kind: string;
  readonly boxes: readonly { readonly at: Point; readonly half: Point }[];
  readonly hulls: readonly HullDef[];
  readonly half: readonly [number, number, number];
  readonly at: readonly { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }[];
  readonly turns?: true;
}

type Point = readonly [number, number, number];
/** A course's piece before it is turned: its parts with +X out from the axis, from the sphere's centre, and their lowest and highest. */
interface Course { readonly parts: readonly (readonly Point[])[]; readonly low: number; readonly high: number }
/** A shell's grid: how far out its corners stand, and each row's sine and cosine from the top and its points round. */
interface Grid { readonly lift: number; readonly rows: readonly { readonly sin: number; readonly cos: number; readonly round: number }[] }
const snap = (v: number): number => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS;

/** A convex part under the facets between `rim`, points on the sphere: they, and each of `under`, its corners, again under the shell. */
function partOf(rim: readonly Point[], under: readonly Point[] = rim): Point[] {
  let nx = 0, ny = 0, nz = 0;
  for (const p of rim) { nx += p[0]; ny += p[1]; nz += p[2]; }
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  nx /= l; ny /= l; nz /= l;
  // The floor is flat, THICK under the lowest of the rim, and the rim's own outline seen along the part's middle, widened.
  let floor = Infinity, near = Infinity;
  for (const p of rim) {
    const h = p[0] * nx + p[1] * ny + p[2] * nz;
    const ox = p[0] - h * nx, oy = p[1] - h * ny, oz = p[2] - h * nz;
    floor = Math.min(floor, h);
    near = Math.min(near, Math.sqrt(ox * ox + oy * oy + oz * oz));
  }
  floor -= THICK;
  const wider = 1 + FLARE / Math.max(near, 1);
  const out: Point[] = [...rim];
  for (const p of under) {
    const h = p[0] * nx + p[1] * ny + p[2] * nz;
    out.push([nx * floor + (p[0] - h * nx) * wider, ny * floor + (p[1] - h * ny) * wider, nz * floor + (p[2] - h * nz) * wider]);
  }
  return out;
}

const grids = new Map<string, Grid>();

/** The grid of the shell of an orb of `radius` with its centre `centre` over the ground and `round` facets round its equator. */
function gridOf(radius: number, centre: number, round: number): Grid {
  const key = `${radius},${centre},${round}`, known = grids.get(key);
  if (known) return known;
  // Corners stand this far out, so the widest facet's middle is as far inside the true sphere as its corners are outside.
  const tall = (radius * TAU) / round;
  const lift = radius + (WIDE * WIDE + tall * tall) / (16 * radius);
  // The first row has the fewest points, five to nine, that doubling makes `round` of.
  let first = round;
  while (first >= 10 && first % 2 === 0) first /= 2;
  // Rows a facet apart from the top down, each with twice the points of the one above where its facets would be too wide.
  // The last is where the shell ends under the ground, which a row within a quarter of a facet of it moves to.
  const rows: { sin: number; cos: number; round: number }[] = [{ sin: 0, cos: 1, round: 1 }];
  const end = -(centre + UNDER) / lift;
  for (let i = 1; i < round / 2 && rows[i - 1]!.cos > end; i++) {
    const last = detCos((i * TAU) / round) < end + TAU / round / 4;
    const cos = last ? end : detCos((i * TAU) / round), sin = last ? Math.sqrt(1 - end * end) : detSin((i * TAU) / round);
    const before = Math.max(first, rows[i - 1]!.round);
    rows.push({ sin, cos, round: before < round && 2 * lift * sin * detSin(PI / before) > WIDE ? before * 2 : before });
  }
  const grid = { lift, rows };
  grids.set(key, grid);
  return grid;
}

/** The points round each row of that shell's grid, from the top down: what a course may be cut by. */
export function orbRows(radius: number, centre: number, round: number): number[] {
  return gridOf(radius, centre, round).rows.map((r) => r.round);
}

/** The piece of rows `a` to `b` of a grid cut `count` round. */
function courseOf({ lift, rows }: Grid, a: number, b: number, count: number): Course {
  // Point `j` of row `i`, in the piece's frame: its middle is along +X.
  const at = (i: number, j: number): Point => {
    const r = rows[i]!, turn = (j * TAU) / r.round - PI / count;
    return [lift * r.sin * detCos(turn), lift * r.cos, lift * r.sin * detSin(turn)];
  };
  const parts: Point[][] = [];
  for (let i = a; i < b; i++) {
    const top = rows[i]!, low = rows[i + 1]!, wide = low.round / count;
    if (i === 0) {
      // Round the top, each part two facets that meet at it, or one where they are odd.
      for (let j = 0; j < wide; j += 2) parts.push(partOf([at(0, 0), ...[0, 1, 2].slice(0, Math.min(3, wide - j + 1)).map((k) => at(1, j + k))]));
    } else if (low.round > top.round) {
      // Where a row doubles, each facet above stands on two below.
      for (let j = 0; j < wide / 2; j++) parts.push(partOf([at(i, j), at(i, j + 1), at(i + 1, 2 * j + 2), at(i + 1, 2 * j + 1), at(i + 1, 2 * j)]));
    } else {
      // Facets one over another on the same meridians share a part, two at most, with its four corners under it.
      const two = i + 2 <= b && rows[i + 2]?.round === low.round, foot = two ? i + 2 : i + 1;
      for (let j = 0; j < wide; j++) {
        const corners = [at(i, j), at(i, j + 1), at(foot, j + 1), at(foot, j)];
        parts.push(two ? partOf([...corners, at(i + 1, j), at(i + 1, j + 1)], corners) : partOf(corners));
      }
      if (two) i++;
    }
  }
  let low = Infinity, high = -Infinity;
  for (const part of parts) for (const p of part) { low = Math.min(low, p[1]); high = Math.max(high, p[1]); }
  return { parts, low, high };
}

/**
 * How far from the axis the origin of the piece of rows `a` to `b` of that shell, cut `count` round, is best set, to
 * the centimetre: where its furthest corner is nearest. Null where the piece has too many parts or reaches too far
 * from there. For the tool that fits a size's courses (tools/orb/shell.ts).
 */
export function orbCourse(radius: number, centre: number, round: number, a: number, b: number, count: number): number | null {
  const grid = gridOf(radius, centre, round);
  if (count > 1 && grid.lift * grid.rows[a + 1]!.sin * detSin(PI / count) > SPREAD) return null;
  const { parts, low, high } = courseOf(grid, a, b, count);
  if (parts.length > MOST_PARTS || (high - low) / 2 > REACH) return null;
  const all = parts.flat();
  const far = (x: number): number => all.reduce((most, p) => Math.max(most, (p[0] - x) * (p[0] - x) + p[2] * p[2]), 0);
  // On its middle line, and for a whole ring on the axis.
  let [west, east] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  for (let k = 0; k < 24 && count > 1; k++) {
    const [m1, m2] = [west + (east - west) / 3, east - (east - west) / 3];
    if (far(m1) < far(m2)) east = m2;
    else west = m1;
  }
  const out = count > 1 ? Math.round(((west + east) / 2) * 100) / 100 : 0;
  return Math.sqrt(far(out)) > SPREAD ? null : out;
}

// ---- The plinth, the low ring building an orb stands in, as its model has it at a radius of 78
// (assets/source/core/structures/orb/model.py): 32 flat sides, a canopy over a doorway on every eighth.

const PLINTH_MADE = 78;
const PLINTH_SIDES = 32;
/** Metres from the axis of its sections' corners: the roof's inner edge, the wall's foot and head, the eave. And their heights. */
const PLINTH = { inner: 71.63, foot: 76.4, head: 75.7, eave: 75.85, under: -2, sill: 3.2, roof: 5.6 };
/** A canopy and the doorway under it: from the axis, to each side, and from the ground. */
const CANOPY = { near: 74, far: 80.5, half: 5.5, low: 3.2, high: 3.5 };
const DOORWAY = { near: 74, far: 76.25, half: 4, low: -0.5, high: 3.2 };
/** Metres a side runs on past its corners, so a rounded frame leaves no crack between two. */
const LAP = 0.03;

/** The plinth's shapes for an orb of `radius`, their kinds numbered from `first`: a side of its wall and roof, and a canopy with its doorway. */
function plinthOf(radius: number, centre: number, first: number): OrbShape[] {
  const scale = radius / PLINTH_MADE, step = TAU / PLINTH_SIDES;
  // A side's corners stand where the model's do: out by this at a corner, so its flat is as far in as its corners are out.
  const corner = (2 / (1 + detCos(step / 2))) * scale, [cos, sin] = [detCos(step / 2), detSin(step / 2)];
  const { inner, foot, head, eave, under, sill, roof } = PLINTH;
  const [x, y] = [snap(((inner + foot) / 2) * scale), snap(((under + roof) / 2) * scale)];
  // A section along the side: each of its corners at both ends, the ends cut where the next sides meet it.
  const prism = (section: readonly (readonly [number, number])[]): HullDef => ({
    corners: section.flatMap(([r, h]) => [-1, 1].map((end): Point => [r * corner * cos - x, h * scale - y, end * (r * corner * sin + LAP)])),
  });
  // The wall leans in to its head, and the eave and roof stand over it: two parts, since the head is a hollow corner.
  const side: OrbShape = {
    kind: `${ORB_COLLIDER}${radius}_${centre}_${first}`, boxes: [], turns: true,
    hulls: [prism([[inner, under], [foot, under], [head, sill], [inner, sill]]), prism([[inner, sill], [eave, sill], [eave, roof], [inner, roof]])],
    half: [0, 0, 0],
    at: Array.from({ length: PLINTH_SIDES }, (_, k) => ({ x: x * detCos(k * step), y, z: -x * detSin(k * step), yaw: (k * YAW_UNITS) / PLINTH_SIDES })),
  };
  const [cx, cy] = [snap(((CANOPY.near + CANOPY.far) / 2) * scale), snap(((DOORWAY.low + CANOPY.high) / 2) * scale)];
  const box = (b: typeof CANOPY) => ({
    at: [((b.near + b.far) / 2) * scale - cx, ((b.low + b.high) / 2) * scale - cy, 0] as const,
    half: [((b.far - b.near) / 2) * scale, ((b.high - b.low) / 2) * scale, b.half * scale] as const,
  });
  const canopy: OrbShape = {
    kind: `${ORB_COLLIDER}${radius}_${centre}_${first + 1}`, boxes: [box(CANOPY), box(DOORWAY)], hulls: [], turns: true, half: [0, 0, 0],
    at: [0, 1, 2, 3].map((q) => ({ x: [cx, 0, -cx, 0][q]!, y: cy, z: [0, -cx, 0, cx][q]!, yaw: (q * YAW_UNITS) / 4 })),
  };
  return [side, canopy].map((s) => ({ ...s, half: halfOf(s) }));
}

/** Half extents of the box about a shape's origin that holds its boxes and parts. */
function halfOf(s: Pick<OrbShape, "boxes" | "hulls">): [number, number, number] {
  const half: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (const b of s.boxes) half[i] = Math.max(half[i]!, Math.abs(b.at[i]!) + b.half[i]!);
    for (const h of s.hulls) for (const c of h.corners) half[i] = Math.max(half[i]!, Math.abs(c[i]!));
  }
  return half;
}

/**
 * The shapes of an orb's collision: its shell from the top down by `courses`, each its last row, its pieces round and
 * how far from the axis a piece's origin is, then its plinth.
 */
export function orbShapes(radius: number, centre: number, round: number, courses: readonly (readonly [number, number, number])[]): OrbShape[] {
  const shapes: OrbShape[] = [];
  const axes = new Int32Array(4);
  const grid = gridOf(radius, centre, round);
  let a = 0;
  for (const [b, count, out] of courses) {
    const { parts, low, high } = courseOf(grid, a, b, count), up = snap((low + high) / 2);
    a = b;
    // Pieces a quarter turn apart share a frame, and so a shape: one for each turn the course has within a quarter.
    const alike = count % 4 === 0 ? 4 : count % 2 === 0 ? 2 : 1;
    for (let k = 0; k < count / alike; k++) {
      const turn = ((k + 0.5) * TAU) / count, [cos, sin] = [detCos(turn), detSin(turn)];
      const yaw = Math.round(((k + 0.5) * YAW_UNITS) / count) % YAW_UNITS;
      const [x, z] = [snap(out * cos), snap(-out * sin)];
      // A corner written (u, v) is set (u ax + v bx, u az + v bz) / HALF_SIDE from the origin: solved for where it belongs.
      frameAxes(yaw, axes);
      const [ax, az, bx, bz] = [axes[0]!, axes[1]!, axes[2]!, axes[3]!], scale = HALF_SIDE / (ax * bz - bx * az);
      const hulls = parts.map((part) => ({ corners: part.map((p): Point => {
        const [wx, wz] = [p[0] * cos + p[2] * sin - x, p[2] * cos - p[0] * sin - z];
        return [(wx * bz - wz * bx) * scale, p[1] - up, (wz * ax - wx * az) * scale];
      }) }));
      // A quarter turn on takes a place (x, z) to (z, -x).
      const places = Array.from({ length: alike }, (_, j) => {
        const q = (j * 4) / alike, [px, pz] = q === 0 ? [x, z] : q === 1 ? [z, -x] : q === 2 ? [-x, -z] : [-z, x];
        return { x: px, y: centre + up, z: pz, yaw: (yaw + (j * YAW_UNITS) / alike) % YAW_UNITS };
      });
      shapes.push({ kind: `${ORB_COLLIDER}${radius}_${centre}_${shapes.length}`, boxes: [], hulls, half: halfOf({ boxes: [], hulls }), at: places });
    }
  }
  return [...shapes, ...plinthOf(radius, centre, shapes.length)];
}

const shells = new Map<(typeof ORB_SIZES)[number], OrbShape[]>();

/** The shapes of the collision of a size the content has one for. */
export function orbShell(radius: number, centre: number): readonly OrbShape[] {
  const size = ORB_SIZES.find((s) => s.radius === radius && s.centre === centre);
  if (!size) throw new Error(`orb: the content has no shell of radius ${radius} m with its centre ${centre} m up`);
  let shell = shells.get(size);
  if (!shell) shells.set(size, (shell = orbShapes(size.radius, size.centre, size.round, size.courses)));
  return shell;
}

/** The pieces of a site's shell and plinth, as a map sets them down. The site must be of a size the content has a shell for. */
export function orbCollision(site: OrbSite): MapStatic[] {
  // The axis and the ground on the lattice a map sets pieces on, so every piece stands exactly where its shape was written for.
  const [x, y, z] = [snap(site.x), snap(site.y), snap(site.z)];
  const turn = (site.yaw * TAU) / YAW_UNITS, [cos, sin] = [detCos(turn), detSin(turn)];
  return orbShell(site.radius, site.centre).flatMap((s) => s.at.map((p) => (s.turns
    ? { kind: s.kind, x: snap(x + p.x * cos + p.z * sin), y: snap(y + p.y), z: snap(z + p.z * cos - p.x * sin), yaw: (p.yaw + site.yaw) % YAW_UNITS }
    : { kind: s.kind, x: x + p.x, y: y + p.y, z: z + p.z, yaw: p.yaw })));
}
