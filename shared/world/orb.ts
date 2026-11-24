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
 * The sizes the content has shells for (content/orb.ts): the radius, the centre's height over the ground, and the
 * facets round the equator, which is the count that cuts the shell into the fewest pieces (tests/world/orb.test.ts).
 */
export const ORB_SIZES = [{ radius: 78, centre: 34, round: 72 }] as const;
/** What every piece of a shell is named by: a kind drawn as nothing, which the orb's own pass draws over. */
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

/** One shape of a shell and where its pieces stand: metres from the axis and over the sphere's centre, and their turns. */
export interface OrbShape {
  readonly kind: string;
  readonly hulls: readonly HullDef[];
  readonly half: readonly [number, number, number];
  readonly at: readonly { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }[];
}

type Point = readonly [number, number, number];
/** A course's piece before it is turned: its parts with +X out from the axis, where its origin is, and how many go round. */
interface Course { readonly parts: readonly (readonly Point[])[]; readonly out: number; readonly up: number; readonly count: number }
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

/** The shapes of the shell of an orb of `radius` with its centre `centre` over the ground and `round` facets round its equator, from the top down. */
export function orbShapes(radius: number, centre: number, round: number): OrbShape[] {
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
  const last = rows.length - 1;
  // Point `j` of row `i`, in the frame of a piece of `count` round: the piece's middle is along +X.
  const at = (i: number, j: number, count: number): Point => {
    const r = rows[i]!, a = (j * TAU) / r.round - PI / count;
    return [lift * r.sin * detCos(a), lift * r.cos, lift * r.sin * detSin(a)];
  };
  // The piece of rows `a` to `b` cut `count` round, or null where it has too many parts or reaches too far.
  const piece = (a: number, b: number, count: number): Course | null => {
    const parts: Point[][] = [];
    for (let i = a; i < b; i++) {
      const top = rows[i]!, low = rows[i + 1]!, wide = low.round / count;
      if (i === 0) {
        // Round the top, each part two facets that meet at it, or one where they are odd.
        for (let j = 0; j < wide; j += 2) parts.push(partOf([at(0, 0, count), ...[0, 1, 2].slice(0, Math.min(3, wide - j + 1)).map((k) => at(1, j + k, count))]));
      } else if (low.round > top.round) {
        // Where a row doubles, each facet above stands on two below.
        for (let j = 0; j < wide / 2; j++) parts.push(partOf([at(i, j, count), at(i, j + 1, count), at(i + 1, 2 * j + 2, count), at(i + 1, 2 * j + 1, count), at(i + 1, 2 * j, count)]));
      } else {
        // Facets one over another on the same meridians share a part, two at most, with its four corners under it.
        const two = i + 2 <= b && rows[i + 2]?.round === low.round, foot = two ? i + 2 : i + 1;
        for (let j = 0; j < wide; j++) {
          const corners = [at(i, j, count), at(i, j + 1, count), at(foot, j + 1, count), at(foot, j, count)];
          parts.push(two ? partOf([...corners, at(i + 1, j, count), at(i + 1, j + 1, count)], corners) : partOf(corners));
        }
        if (two) i++;
      }
    }
    if (parts.length > MOST_PARTS) return null;
    const all = parts.flat();
    let west = Infinity, east = -Infinity, low = Infinity, high = -Infinity;
    for (const p of all) { west = Math.min(west, p[0]); east = Math.max(east, p[0]); low = Math.min(low, p[1]); high = Math.max(high, p[1]); }
    // Its origin is where its furthest corner is nearest: on its middle line, and for a whole ring on the axis.
    const far = (x: number): number => all.reduce((most, p) => Math.max(most, (p[0] - x) * (p[0] - x) + p[2] * p[2]), 0);
    for (let k = 0; k < 16 && count > 1; k++) {
      const [m1, m2] = [west + (east - west) / 3, east - (east - west) / 3];
      if (far(m1) < far(m2)) east = m2;
      else west = m1;
    }
    const [out, up] = [count > 1 ? (west + east) / 2 : 0, snap((low + high) / 2)];
    return Math.sqrt(far(out)) > SPREAD || Math.max(up - low, high - up) > REACH ? null : { parts, out, up, count };
  };
  // Courses from the top down, each the choice of fewest pieces a row: as many rows as fit, cut as few times as fit.
  const shapes: OrbShape[] = [];
  const axes = new Int32Array(4);
  for (let a = 0; a < last; ) {
    let best: Course | null = null, to = a;
    const points = rows[Math.max(a, 1)]!.round;
    for (let count = 1; count <= points; count++) {
      // Not a count that leaves a facet cut, nor one whose first row alone is too wide.
      if (points % count !== 0 || (count > 1 && lift * rows[a + 1]!.sin * detSin(PI / count) > SPREAD)) continue;
      for (let b = a + 1; b <= last; b++) {
        const made = piece(a, b, count);
        if (!made) break;
        if (!best || count * (to - a) < best.count * (b - a)) { best = made; to = b; }
      }
    }
    if (!best) throw new Error(`orb: no piece of the shell fits at row ${a} of a radius of ${radius} m`);
    a = to;
    // Pieces a quarter turn apart share a frame, and so a shape: one for each turn the course has within a quarter.
    const { parts, out, up, count } = best;
    const alike = count % 4 === 0 ? 4 : count % 2 === 0 ? 2 : 1;
    for (let k = 0; k < count / alike; k++) {
      const turn = ((k + 0.5) * TAU) / count, [cos, sin] = [detCos(turn), detSin(turn)];
      const yaw = Math.round(((k + 0.5) * YAW_UNITS) / count) % YAW_UNITS;
      const [x, z] = [snap(out * cos), snap(-out * sin)];
      // A corner written (u, v) is set (u ax + v bx, u az + v bz) / HALF_SIDE from the origin: solved for where it belongs.
      frameAxes(yaw, axes);
      const [ax, az, bx, bz] = [axes[0]!, axes[1]!, axes[2]!, axes[3]!], scale = HALF_SIDE / (ax * bz - bx * az);
      const half: [number, number, number] = [0, 0, 0];
      const hulls = parts.map((part) => ({ corners: part.map((p): Point => {
        const [wx, wz] = [p[0] * cos + p[2] * sin - x, p[2] * cos - p[0] * sin - z];
        const c: Point = [(wx * bz - wz * bx) * scale, p[1] - up, (wz * ax - wx * az) * scale];
        for (let i = 0; i < 3; i++) half[i] = Math.max(half[i]!, Math.abs(c[i]!));
        return c;
      }) }));
      // A quarter turn on takes a place (x, z) to (z, -x).
      const places = Array.from({ length: alike }, (_, j) => {
        const q = (j * 4) / alike, [px, pz] = q === 0 ? [x, z] : q === 1 ? [z, -x] : q === 2 ? [-x, -z] : [-z, x];
        return { x: px, y: up, z: pz, yaw: (yaw + (j * YAW_UNITS) / alike) % YAW_UNITS };
      });
      shapes.push({ kind: `${ORB_COLLIDER}${radius}_${centre}_${shapes.length}`, hulls, half, at: places });
    }
  }
  return shapes;
}

const shells = new Map<(typeof ORB_SIZES)[number], OrbShape[]>();

/** The shapes of the shell of a size the content has one for. */
export function orbShell(radius: number, centre: number): readonly OrbShape[] {
  const size = ORB_SIZES.find((s) => s.radius === radius && s.centre === centre);
  if (!size) throw new Error(`orb: the content has no shell of radius ${radius} m with its centre ${centre} m up`);
  let shell = shells.get(size);
  if (!shell) shells.set(size, (shell = orbShapes(size.radius, size.centre, size.round)));
  return shell;
}

/** The pieces of a site's shell, as a map sets them down. The site must be of a size the content has a shell for. */
export function orbCollision(site: OrbSite): MapStatic[] {
  // The axis and the centre on the lattice a map sets pieces on, so every piece stands exactly where its shape was written for.
  const [x, y, z] = [snap(site.x), snap(site.y + site.centre), snap(site.z)];
  return orbShell(site.radius, site.centre).flatMap((s) => s.at.map((p) => ({ kind: s.kind, x: x + p.x, y: y + p.y, z: z + p.z, yaw: p.yaw })));
}
