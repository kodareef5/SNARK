// Streets and buildings that meet. A road piece of base/roads.geojson whose line runs through a footprint of
// base/buildings.geojson is settled by its class before any reader takes it:
// - a service way, an alley, a track or a street of one lane yields: a junction in the wall moves clear, the line shifts
//   sideways, the piece narrows, or it ends at the wall;
// - a residential or unclassified street shifts up to 2 m where that clears its whole width, and else keeps its line;
// - a tertiary street, anything above it and every link keeps its line.
// Where a street keeps its line through a footprint the building yields: the piece carries the runs inside as
// `passage_runs`, which the ruins open their ground storey along (passages.ts).
// All of it is worked out in the data's own metres from the piece, the footprints near it and the pieces it joins, so a
// place gets the same line whatever cut is made round it. Left as the data has them: pieces marked bridge, tunnel or
// passage, and small ways that meet a parking structure or a lot's stalls.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { binKey } from "../raster.ts";

export interface RoadFeature { geometry: { type: string; coordinates: number[][] | number[][][] }; properties: Record<string, unknown> }

/** A building's outline in the data's metres, its outer ring first, then its holes. */
export interface Footprint { rings: number[][][]; parking: boolean }

/** Pieces by what became of them; one piece may count under several. `opened` are those a building opens for, `stalls` those kept for a lot's stalls. */
export interface YieldCount { shifted: number; narrowed: number; cut: number; dropped: number; junctions: number; opened: number; parking: number; stalls: number; marked: number }

/** A line in the data's metres, half the width of what ran along it, and whether the data made walks along it. */
export interface Band { line: number[][]; half: number; walked: boolean }

/** The pieces that changed, by row; what became of how many; and the bands of road that are gone. */
export interface Yielded { changed: Map<number, RoadFeature>; count: YieldCount; gone: Band[] }

/** Classes and kinds that carry no traffic: they have no stretch, and do not yield. */
export const NOT_DRIVEN = new Set(["S1710", "S1720", "S1820", "S1830", "footway", "path", "pedestrian", "steps", "cycleway", "bridleway", "corridor"]);
/** The small ways, which yield, and the local streets, which may shift: OpenStreetMap's class, else TIGER's. */
const SMALL = new Set(["service", "track", "S1500", "S1640", "S1730", "S1740", "S1780"]);
const LOCAL_STREETS = new Set(["residential", "unclassified", "living_street", "road", "S1400"]);

/** A line nearer a wall than this runs through the building. */
const TRIGGER = 0.5;
/** The furthest a small way shifts sideways and a local street does, and a junction moves. */
const MAX_SHIFT = 6;
const LOCAL_SHIFT = 2;
const MAX_NODE = 4;
/** Metres between the places along a line its room is measured at. */
const STATION = 1;
/** A cut piece shorter than this is dropped. */
const MIN_STUB = 6;
/** How far out a wall is looked for, which caps the room a street is given. */
const REACH = 8;
/** The least width a small way narrows to: a lane. */
const LEAST = 3;
/** How near a stall's end on its aisle a way is that serves it. */
const STALL_REACH = 4;
/** Conflicts nearer than this along a line are shifted as one. */
const MERGE = 8;
/** How far a shift holds along a line still too near a wall, and the room it keeps to taper in before a held point. */
const HOLD = 40;
const ROOM = 8;

/** A piece's kind: one walked, one marked as crossing a building or another level, and a street by its class. */
const WALKED = 0, MARKED = 1, SMALL_WAY = 2, LOCAL = 3, THROUGH = 4;
const EDGE_BIN = 8, BOX_BIN = 16, LINE_BIN = 16;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const runsOf = (f: RoadFeature): number[][][] => (f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [f.geometry.coordinates as number[][]]);
const widthOf = (f: RoadFeature): number => num(f.properties.width_m) ?? 8;

/** A piece's kind. A local street of one lane is a small way; a class neither list names keeps its line. */
export function kindOf(f: RoadFeature): number {
  const p = f.properties;
  if (NOT_DRIVEN.has(String(p.mtfcc ?? "")) || NOT_DRIVEN.has(String(p.highway ?? ""))) return WALKED;
  if (p.bridge === true || p.tunnel === true || (typeof p.tunnel === "string" && p.tunnel !== "no") || p.covered === true) return MARKED;
  for (const [key, value] of Object.entries(p)) {
    if (/passage/i.test(key) ? value !== false && value !== null && value !== undefined : typeof value === "string" && !/name/i.test(key) && /passage/i.test(value)) return MARKED;
  }
  const named = typeof p.highway === "string" ? p.highway : String(p.mtfcc ?? "");
  if (SMALL.has(named)) return SMALL_WAY;
  if (!LOCAL_STREETS.has(named)) return THROUGH;
  return (num(p.lanes) ?? 2) <= 1 ? SMALL_WAY : LOCAL;
}

/** Half the least width a small way narrows to, never more than its own. */
const leastHalf = (f: RoadFeature): number => Math.min(widthOf(f), LEAST) / 2;

function ringHolds(ring: number[][], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!, zi = ring[i]![1]!, xj = ring[j]![0]!, zj = ring[j]![1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** The footprints' walls, binned. */
class Walls {
  private readonly edge: number[] = [];
  private readonly owner: number[] = [];
  private readonly box: number[] = [];
  private readonly near = new Map<number, number[]>();
  private readonly over = new Map<number, number[]>();
  /** The last gap's nearest point of a wall, where one was within reach, and whether a parking structure was met. */
  hitX = 0;
  hitZ = 0;
  found = false;
  parking = false;
  private readonly prints: readonly Footprint[];

  constructor(prints: readonly Footprint[]) {
    this.prints = prints;
    prints.forEach((p, k) => {
      let lx = Infinity, lz = Infinity, hx = -Infinity, hz = -Infinity;
      for (const ring of p.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const ax = ring[j]![0]!, az = ring[j]![1]!, bx = ring[i]![0]!, bz = ring[i]![1]!;
        if (ax === bx && az === bz) continue;
        const e = this.owner.length;
        this.edge.push(ax, az, bx, bz);
        this.owner.push(k);
        put(this.near, EDGE_BIN, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), e);
        lx = Math.min(lx, ax, bx); lz = Math.min(lz, az, bz); hx = Math.max(hx, ax, bx); hz = Math.max(hz, az, bz);
      }
      this.box.push(lx, lz, hx, hz);
      if (lx <= hx) put(this.over, BOX_BIN, lx, lz, hx, hz, k);
    });
  }

  /** Whether any footprint's box meets this one. */
  about(lx: number, lz: number, hx: number, hz: number): boolean {
    for (let bz = Math.floor(lz / BOX_BIN); bz <= Math.floor(hz / BOX_BIN); bz++) for (let bx = Math.floor(lx / BOX_BIN); bx <= Math.floor(hx / BOX_BIN); bx++) {
      for (const k of this.over.get(binKey(bx, bz)) ?? []) if (this.box[k * 4]! <= hx && this.box[k * 4 + 2]! >= lx && this.box[k * 4 + 1]! <= hz && this.box[k * 4 + 3]! >= lz) return true;
    }
    return false;
  }

  /** 1 where (x, z) is in a footprint, 3 where in a parking structure's, else 0. */
  private in(x: number, z: number): number {
    let flags = 0;
    for (const k of this.over.get(binKey(Math.floor(x / BOX_BIN), Math.floor(z / BOX_BIN))) ?? []) {
      if (x < this.box[k * 4]! || z < this.box[k * 4 + 1]! || x > this.box[k * 4 + 2]! || z > this.box[k * 4 + 3]!) continue;
      const rings = this.prints[k]!.rings;
      if (!ringHolds(rings[0]!, x, z)) continue;
      let hole = false;
      for (let h = 1; h < rings.length && !hole; h++) hole = ringHolds(rings[h]!, x, z);
      if (!hole) flags |= this.prints[k]!.parking ? 3 : 1;
    }
    return flags;
  }

  /** Metres from (x, z) to the nearest wall, `reach` where none is nearer, negative inside a footprint. */
  gap(x: number, z: number, reach = REACH): number {
    let best = reach * reach, of = -1;
    for (let bz = Math.floor((z - reach) / EDGE_BIN); bz <= Math.floor((z + reach) / EDGE_BIN); bz++) for (let bx = Math.floor((x - reach) / EDGE_BIN); bx <= Math.floor((x + reach) / EDGE_BIN); bx++) {
      for (const e of this.near.get(binKey(bx, bz)) ?? []) {
        const ax = this.edge[e * 4]!, az = this.edge[e * 4 + 1]!, ex = this.edge[e * 4 + 2]! - ax, ez = this.edge[e * 4 + 3]! - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
        const qx = ax + ex * t, qz = az + ez * t, d = (x - qx) * (x - qx) + (z - qz) * (z - qz);
        // Of two walls as near, the lesser point, whatever order the footprints come in.
        if (d > best || (d === best && (of < 0 || qx > this.hitX || (qx === this.hitX && qz >= this.hitZ)))) continue;
        best = d; of = e; this.hitX = qx; this.hitZ = qz;
      }
    }
    const inside = this.in(x, z);
    this.found = of >= 0;
    this.parking = (inside & 2) !== 0 || (inside === 0 && of >= 0 && this.prints[this.owner[of]!]!.parking);
    return inside ? -Math.sqrt(best) : Math.sqrt(best);
  }
}

function put(bins: Map<number, number[]>, size: number, lx: number, lz: number, hx: number, hz: number, value: number): void {
  for (let bz = Math.floor(lz / size); bz <= Math.floor(hz / size); bz++) for (let bx = Math.floor(lx / size); bx <= Math.floor(hx / size); bx++) {
    const key = binKey(bx, bz), list = bins.get(key);
    if (list) list.push(value);
    else bins.set(key, [value]);
  }
}

/** The other streets' lines as the data draws them, binned, for the room a shift has. */
class Lines {
  private readonly seg: number[] = [];
  private readonly row: number[] = [];
  private readonly bins = new Map<number, number[]>();
  private readonly features: readonly RoadFeature[];

  constructor(features: readonly RoadFeature[], kinds: readonly number[]) {
    this.features = features;
    features.forEach((f, row) => {
      if (kinds[row]! < SMALL_WAY) return;
      for (const run of runsOf(f)) for (let i = 1; i < run.length; i++) {
        const ax = run[i - 1]![0]!, az = run[i - 1]![1]!, bx = run[i]![0]!, bz = run[i]![1]!;
        put(this.bins, LINE_BIN, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), this.row.length);
        this.seg.push(ax, az, bx, bz);
        this.row.push(row);
      }
    });
  }

  private far(k: number, x: number, z: number): number {
    const ax = this.seg[k * 4]!, az = this.seg[k * 4 + 1]!, ex = this.seg[k * 4 + 2]! - ax, ez = this.seg[k * 4 + 3]! - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    return Math.hypot(x - ax - ex * t, z - az - ez * t);
  }

  /** Whether a line `half` wide moved from (wx, wz) to (x, z) keeps off every street but `own`: a kerb apart, or no nearer than it was. */
  clear(x: number, z: number, wx: number, wz: number, half: number, own: ReadonlySet<number>): boolean {
    const reach = half + 12;
    for (let bz = Math.floor((z - reach) / LINE_BIN); bz <= Math.floor((z + reach) / LINE_BIN); bz++) for (let bx = Math.floor((x - reach) / LINE_BIN); bx <= Math.floor((x + reach) / LINE_BIN); bx++) {
      for (const k of this.bins.get(binKey(bx, bz)) ?? []) {
        if (own.has(this.row[k]!)) continue;
        const d = this.far(k, x, z);
        if (d < half + widthOf(this.features[this.row[k]!]!) / 2 && d < this.far(k, wx, wz) - 0.25) return false;
      }
    }
    return true;
  }
}

/** A point's key to half a metre, as the street graph joins pieces. */
const nodeKey = (x: number, z: number): number => (Math.round(x * 2) + 1048576) * 4194304 + Math.round(z * 2) + 1048576;

/** A point pieces pass through or end at: how many do each, which, whether one of them may not move, and whether one keeps its line there (a marked piece, a street that is no small way). */
interface Node { x: number; z: number; ends: number; mids: number; rows: number[]; fixed: boolean; marked: boolean }

/** Whether other pieces hold the line at a node: none at a dead end or a point of one piece alone. */
const held = (n: Node | undefined): boolean => n !== undefined && n.ends + n.mids >= 2;

/** A run's stations: its points and places between them no more than STATION apart, with the metres along it. */
function stationsOf(run: number[][]): { x: number[]; z: number[]; s: number[]; vertex: boolean[] } {
  const x = [run[0]![0]!], z = [run[0]![1]!], s = [0], vertex = [true];
  for (let i = 1; i < run.length; i++) {
    const ax = x[x.length - 1]!, az = z[z.length - 1]!, bx = run[i]![0]!, bz = run[i]![1]!, from = s[s.length - 1]!;
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 1e-9) continue;
    const n = Math.ceil(l / STATION);
    for (let k = 1; k < n; k++) { x.push(ax + ((bx - ax) * k) / n); z.push(az + ((bz - az) * k) / n); s.push(from + (l * k) / n); vertex.push(false); }
    x.push(bx); z.push(bz); s.push(from + l); vertex.push(true);
  }
  return { x, z, s, vertex };
}

/** Where a junction `need` clear of every wall is, the nearest way out of the wall it stands in or at, or null past MAX_NODE. */
function clearOf(walls: Walls, x: number, z: number, need: number): [number, number] | null {
  const g = walls.gap(x, z, MAX_NODE + 1);
  if (!walls.found) return null;
  const qx = walls.hitX, qz = walls.hitZ, d = Math.hypot(qx - x, qz - z);
  if (d < 1e-6) return null;
  const ux = ((g < 0 ? 1 : -1) * (qx - x)) / d, uz = ((g < 0 ? 1 : -1) * (qz - z)) / d;
  for (let out = need; ; out += 0.25) {
    const tx = qx + ux * out, tz = qz + uz * out;
    if (Math.hypot(tx - x, tz - z) > MAX_NODE) return null;
    if (walls.gap(tx, tz) >= need - 1e-6) return [tx, tz];
  }
}

/** A line's points with the stations between them that lie on it taken out. */
function simplify(points: { x: number; z: number; keep: boolean }[]): number[][] {
  const out: number[][] = [[points[0]!.x, points[0]!.z]];
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!, next = points[i + 1];
    if (!p.keep && next) {
      const a = out[out.length - 1]!, ex = next.x - a[0]!, ez = next.z - a[1]!, l = Math.hypot(ex, ez);
      if (l > 0 && Math.abs((p.x - a[0]!) * ez - (p.z - a[1]!) * ex) / l < 0.01) continue;
    }
    out.push([p.x, p.z]);
  }
  return out;
}

/**
 * The road pieces that change where they meet `footprints`, by their rows in `features`, and what became of how many. A
 * piece not in `changed` is as the data has it. `stalls` are the ends of a lot's stalls on their aisles: a small way
 * that serves one is not cut there.
 */
export function yieldRoads(features: readonly RoadFeature[], footprints: readonly Footprint[], stalls: readonly (readonly [number, number])[] = []): Yielded {
  const count: YieldCount = { shifted: 0, narrowed: 0, cut: 0, dropped: 0, junctions: 0, opened: 0, parking: 0, stalls: 0, marked: 0 };
  const changed = new Map<number, RoadFeature>(), bands: Band[] = [];
  if (footprints.length === 0) return { changed, count, gone: bands };
  const walls = new Walls(footprints);
  const kinds = features.map(kindOf);
  const stallBins = new Map<number, number[]>();
  stalls.forEach(([e, n], k) => put(stallBins, EDGE_BIN, e, n, e, n, k));
  const served = (x: number, z: number): boolean => {
    for (let bz = Math.floor((z - STALL_REACH) / EDGE_BIN); bz <= Math.floor((z + STALL_REACH) / EDGE_BIN); bz++) for (let bx = Math.floor((x - STALL_REACH) / EDGE_BIN); bx <= Math.floor((x + STALL_REACH) / EDGE_BIN); bx++) {
      for (const k of stallBins.get(binKey(bx, bz)) ?? []) if (Math.hypot(stalls[k]![0] - x, stalls[k]![1] - z) <= STALL_REACH) return true;
    }
    return false;
  };

  // The pieces whose line a wall is at, and those of them left as they are.
  const hot: number[] = [], parked = new Set<number>();
  features.forEach((f, row) => {
    if (kinds[row] === WALKED) return;
    let met = false, parking = false;
    for (const run of runsOf(f)) for (let i = 1; i < run.length; i++) {
      const ax = run[i - 1]![0]!, az = run[i - 1]![1]!, bx = run[i]![0]!, bz = run[i]![1]!;
      if (!walls.about(Math.min(ax, bx) - TRIGGER, Math.min(az, bz) - TRIGGER, Math.max(ax, bx) + TRIGGER, Math.max(az, bz) + TRIGGER)) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STATION));
      for (let k = 0; k <= n; k++) {
        if (walls.gap(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, TRIGGER) >= TRIGGER) continue;
        met = true;
        parking ||= walls.parking;
      }
    }
    if (!met) return;
    if (kinds[row] === MARKED) count.marked++;
    else if (parking && kinds[row] === SMALL_WAY) { count.parking++; parked.add(row); }
    else hot.push(row);
  });
  if (hot.length === 0) return { changed, count, gone: bands };

  const nodes = new Map<number, Node>();
  features.forEach((f, row) => {
    for (const run of runsOf(f)) run.forEach((p, i) => {
      const key = nodeKey(p[0]!, p[1]!);
      let n = nodes.get(key);
      if (!n) nodes.set(key, (n = { x: p[0]!, z: p[1]!, ends: 0, mids: 0, rows: [], fixed: false, marked: false }));
      // Two points on one key: the lesser is the node's place, whatever order the rows come in.
      else if (p[0]! < n.x || (p[0] === n.x && p[1]! < n.z)) [n.x, n.z] = [p[0]!, p[1]!];
      if (i === 0 || i === run.length - 1) n.ends++;
      else n.mids++;
      if (n.rows[n.rows.length - 1] !== row) n.rows.push(row);
      if (kinds[row] !== SMALL_WAY) n.fixed = true;
      if (kinds[row] === MARKED || kinds[row]! > SMALL_WAY) n.marked = true;
    });
  });

  // A junction of small ways in or at a wall moves clear, with every piece that meets there.
  const moves = new Map<number, readonly [number, number]>();
  const asked = new Set<number>();
  for (const row of hot) for (const run of runsOf(features[row]!)) for (const p of run) {
    const key = nodeKey(p[0]!, p[1]!), n = nodes.get(key)!;
    if (asked.has(key)) continue;
    asked.add(key);
    if (!held(n) || n.fixed || n.rows.some((r) => parked.has(r)) || walls.gap(n.x, n.z, TRIGGER) >= TRIGGER) continue;
    const to = clearOf(walls, n.x, n.z, Math.max(...n.rows.map((r) => leastHalf(features[r]!))));
    if (!to) continue;
    moves.set(key, [to[0] - n.x, to[1] - n.z]);
    count.junctions++;
  }

  let lines: Lines | null = null;
  for (const row of hot) {
    const f = features[row]!, kind = kinds[row]!, half = widthOf(f) / 2, full = Math.min(half, REACH - 0.5);
    // What a shifted line must keep clear, and how far it may shift: a small way its least width, a local street its whole.
    const least = kind === SMALL_WAY ? leastHalf(f) : full, reach = kind === SMALL_WAY ? MAX_SHIFT : kind === LOCAL ? LOCAL_SHIFT : 0;
    const opens: number[][][] = [];
    let stallsKept = false;
    const own = new Set<number>([row]);
    for (const run of runsOf(f)) for (const p of run) for (const r of nodes.get(nodeKey(p[0]!, p[1]!))!.rows) own.add(r);
    const before = runsOf(f), after: number[][][] = [], starts: number[] = [], numbers: number[] = [];
    const given = Array.isArray(f.properties.runs_from_m) && f.properties.runs_from_m.length === before.length ? (f.properties.runs_from_m as unknown[]).map(Number) : null;
    let walked = num(f.properties.from_m) ?? 0, narrow = Infinity, squeezed = 0, length = 0, shifted = false, cut = false;

    before.forEach((run, r) => {
      if (given) walked = given[r]!;
      const runStart = walked;
      if (run.length < 2) { after.push(run); starts.push(runStart); numbers.push(r); return; }
      const { x, z, s, vertex } = stationsOf(run), n = x.length;
      walked += s[n - 1]!;
      length += s[n - 1]!;
      const dx = new Float64Array(n), dz = new Float64Array(n), nx = new Float64Array(n), nz = new Float64Array(n);
      const pin = new Uint8Array(n), joins = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const node = vertex[i] ? nodes.get(nodeKey(x[i]!, z[i]!)) : undefined;
        if (held(node)) pin[i] = 1;
        if (node?.marked) joins[i] = 1;
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), l = Math.hypot(x[b]! - x[a]!, z[b]! - z[a]!) || 1;
        [nx[i], nz[i]] = [-(z[b]! - z[a]!) / l, (x[b]! - x[a]!) / l];
      }
      // A moved junction takes the line with it: whole while the line is too near a wall, then less and less to the
      // next held point or six times its move. Between two moved junctions the line takes its share of each.
      const share = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const m = pin[i] ? moves.get(nodeKey(x[i]!, z[i]!)) : undefined;
        if (!m) continue;
        shifted = true;
        dx[i]! += m[0]; dz[i]! += m[1]; share[i]! += 1;
        for (const dir of [-1, 1]) {
          let j = i + dir, h = i;
          while (j >= 0 && j < n && !pin[j]) j += dir;
          while (h + dir !== j && Math.abs(s[h + dir]! - s[i]!) <= HOLD && walls.gap(x[h + dir]!, z[h + dir]!, least) < least) h += dir;
          const taper = Math.min(j >= 0 && j < n ? Math.abs(s[j]! - s[h]!) : Infinity, Math.max(12, 6 * Math.hypot(m[0], m[1])));
          for (let k = i + dir; k !== j; k += dir) {
            const w = (k - h) * dir <= 0 ? 1 : 1 - Math.abs(s[k]! - s[h]!) / taper;
            if (w <= 0) break;
            dx[k]! += m[0] * w; dz[k]! += m[1] * w; share[k]! += w;
          }
        }
      }
      for (let i = 0; i < n; i++) if (share[i]! > 1) { dx[i]! /= share[i]!; dz[i]! /= share[i]!; }
      const g = new Float64Array(n);
      for (let i = 0; i < n; i++) g[i] = walls.gap(x[i]! + dx[i]!, z[i]! + dz[i]!);

      // Each stretch of the line still at a wall shifts sideways, by the least that clears its full width, else the most room there is.
      const tried = new Uint8Array(n);
      for (let i0 = 0; i0 < n && reach > 0; i0++) {
        if (g[i0]! >= TRIGGER || tried[i0]) continue;
        let i1 = i0;
        for (let k = i0 + 1; k < n && s[k]! - s[i1]! <= MERGE && (!pin[k] || g[k]! < TRIGGER); k++) if (g[k]! < TRIGGER) i1 = k;
        let fixed = false;
        for (let k = i0; k <= i1; k++) { tried[k] = 1; fixed ||= pin[k] === 1; }
        if (fixed) continue;
        let a = i0, b = i1, p = i0 - 1, q = i1 + 1;
        while (p >= 0 && !pin[p]) p--;
        while (q < n && !pin[q]) q++;
        // The shift holds while the line is too near a wall, short of the room it tapers in before a held point.
        while (a - 1 > p && g[a - 1]! < least && s[i0]! - s[a - 1]! <= HOLD && (p < 0 || s[a - 1]! - s[p]! >= ROOM)) a--;
        while (b + 1 < q && g[b + 1]! < least && s[b + 1]! - s[i1]! <= HOLD && (q >= n || s[q]! - s[b + 1]! >= ROOM)) b++;
        const roomA = p < 0 ? Infinity : s[a]! - s[p]!, roomB = q >= n ? Infinity : s[q]! - s[b]!;
        lines ??= new Lines(features, kinds);
        let best: { d: number; ta: number; tb: number; c: number } | null = null;
        search: for (let mag = 0.25; mag <= reach && roomA >= 2 * mag && roomB >= 2 * mag; mag += 0.25) for (const d of [mag, -mag]) {
          const ta = Math.min(roomA, Math.max(4, Math.min(12, 3 * mag))), tb = Math.min(roomB, Math.max(4, Math.min(12, 3 * mag)));
          let c = full, ok = true;
          for (let k = p + 1; k < q && ok; k++) {
            const w = k < a ? 1 - (s[a]! - s[k]!) / ta : k > b ? 1 - (s[k]! - s[b]!) / tb : 1;
            if (w <= 0) continue;
            const px = x[k]! + dx[k]! + w * d * nx[k]!, pz = z[k]! + dz[k]! + w * d * nz[k]!, gn = walls.gap(px, pz);
            if (k < a || k > b) ok = gn >= Math.min(least, g[k]!) - 0.01;
            else { ok = gn >= least - 1e-6 && lines!.clear(px, pz, x[k]!, z[k]!, half, own); c = Math.min(c, gn); }
          }
          if (!ok) continue;
          if (!best || c > best.c + 0.05) best = { d, ta, tb, c };
          if (c >= full - 1e-6) break search;
        }
        if (!best) continue;
        shifted = true;
        if (best.c < full - 0.05) { narrow = Math.min(narrow, best.c); squeezed += s[b]! - s[a]! + STATION; }
        for (let k = p + 1; k < q; k++) {
          const w = k < a ? 1 - (s[a]! - s[k]!) / best.ta : k > b ? 1 - (s[k]! - s[b]!) / best.tb : 1;
          if (w <= 0) continue;
          dx[k]! += w * best.d * nx[k]!; dz[k]! += w * best.d * nz[k]!;
          g[k] = walls.gap(x[k]! + dx[k]!, z[k]! + dz[k]!);
        }
      }

      const at = (i: number): [number, number] => [x[i]! + dx[i]!, z[i]! + dz[i]!];
      const stalled = (i: number, j: number): boolean => { for (let k = i; k <= j; k++) if (served(x[k]!, z[k]!)) return true; return false; };
      // The road that ran from station i to j, as the data drew it.
      const lose = (i: number, j: number): void => {
        const [a, b] = [Math.max(0, i - 1), Math.min(n - 1, j + 1)];
        bands.push({ half, walked: LOCAL_STREETS.has(typeof f.properties.highway === "string" ? f.properties.highway : String(f.properties.mtfcc ?? "")), line: simplify(Array.from({ length: b - a + 1 }, (_, k) => ({ x: x[a + k]!, z: z[a + k]!, keep: vertex[a + k]! }))) });
      };
      // What is still inside a building: a street that keeps its line opens the building along it, as far again as half
      // its width at each end. A small way is cut out, each end left at the wall; not its mouth on a piece that keeps
      // its line there, nor where it serves a lot's stalls.
      const gone = new Uint8Array(n);
      for (let i0 = 0; i0 < n; i0++) {
        if (g[i0]! >= TRIGGER || (i0 > 0 && g[i0 - 1]! < TRIGGER)) continue;
        let i1 = i0, deepest = g[i0]!, joined = joins[i0] === 1;
        while (i1 + 1 < n && g[i1 + 1]! < TRIGGER) { deepest = Math.min(deepest, g[++i1]!); joined ||= joins[i1] === 1; }
        if (!(deepest < 0)) continue;
        if (kind !== SMALL_WAY) {
          let [a, b] = [i0, i1];
          while (a > 0 && s[i0]! - s[a]! < half) a--;
          while (b < n - 1 && s[b]! - s[i1]! < half) b++;
          opens.push(simplify(Array.from({ length: b - a + 1 }, (_, k) => ({ x: at(a + k)[0], z: at(a + k)[1], keep: vertex[a + k]! }))));
        } else if (joined && s[i1]! - s[i0]! <= ROOM) continue;
        else if (stalled(i0, i1)) stallsKept = true;
        else { gone.fill(1, i0, i1 + 1); lose(i0, i1); }
      }
      if (gone.includes(1)) cut = true;
      else if (dx.every((v) => v === 0) && dz.every((v) => v === 0)) { after.push(run); starts.push(runStart); numbers.push(r); return; }
      /** The point between a clear station and a cut one that stands TRIGGER off the wall, and its share of the way. */
      const wallEnd = (clear: number, cutAt: number): { x: number; z: number; t: number } => {
        const [ax, az] = at(clear), [bx, bz] = at(cutAt);
        let lo = 0, hi = 1;
        for (let k = 0; k < 12; k++) {
          const t = (lo + hi) / 2;
          if (walls.gap(ax + (bx - ax) * t, az + (bz - az) * t, TRIGGER) >= TRIGGER) lo = t;
          else hi = t;
        }
        return { x: ax + (bx - ax) * lo, z: az + (bz - az) * lo, t: lo };
      };
      for (let u = 0; u < n; u++) {
        if (gone[u]) continue;
        let v = u;
        while (v + 1 < n && !gone[v + 1]) v++;
        const points: { x: number; z: number; keep: boolean }[] = [];
        let from = runStart + s[u]!;
        if (u > 0) {
          const e = wallEnd(u, u - 1);
          if (e.t > 0.05) { points.push({ x: e.x, z: e.z, keep: true }); from -= e.t * (s[u]! - s[u - 1]!); }
        }
        let lastS = s[u]!;
        for (let i = u; i <= v; i++) {
          const [px, pz] = at(i), last = points[points.length - 1];
          // Inside a bend a shifted point falls back along the line: it is left out.
          if (last && !pin[i] && i < v && (dx[i] !== 0 || dz[i] !== 0) && (px - last.x) * nz[i]! - (pz - last.z) * nx[i]! < 0.25 * (s[i]! - lastS)) continue;
          points.push({ x: px, z: pz, keep: vertex[i]! || pin[i] === 1 });
          lastS = s[i]!;
        }
        if (v < n - 1) {
          const e = wallEnd(v, v + 1);
          if (e.t > 0.05) points.push({ x: e.x, z: e.z, keep: true });
        }
        const line = simplify(points);
        let metres = 0;
        for (let i = 1; i < line.length; i++) metres += Math.hypot(line[i]![0]! - line[i - 1]![0]!, line[i]![1]! - line[i - 1]![1]!);
        // A run after a cut is numbered by the metre it starts at, so a cut elsewhere along the piece renumbers none.
        const short = !(u === 0 && v === n - 1) && metres < MIN_STUB;
        if (short && stalled(u, v)) stallsKept = true;
        if (!short || stalled(u, v)) { after.push(line); starts.push(from); numbers.push(u === 0 ? r : r + 1000 * Math.ceil(s[u]!)); }
        else lose(u, v);
        u = v;
      }
    });

    if (stallsKept) count.stalls++;
    if (!shifted && !cut && opens.length === 0) continue;
    const properties: Record<string, unknown> = { ...f.properties };
    const did: string[] = [];
    if (shifted) { count.shifted++; did.push("shifted"); }
    // A piece's width is its whole length's: one squeezed past a wall for under a third of it keeps its own.
    if (squeezed * 3 >= length) {
      const width = Math.max(least * 2, Math.floor(narrow * 20) / 10);
      if (width < widthOf(f)) { properties.width_m = width; count.narrowed++; did.push("narrowed"); }
    }
    if (cut) {
      if (after.length > 0) { count.cut++; did.push("cut"); }
      else { count.dropped++; did.push("dropped"); }
      properties.from_m = starts[0] ?? num(f.properties.from_m) ?? 0;
      if (after.length > 1) properties.runs_from_m = starts;
      else delete properties.runs_from_m;
      properties.run_numbers = numbers;
    }
    if (opens.length > 0) {
      count.opened++; did.push("opens");
      properties.passage_runs = opens;
      properties.passage_why = "through street";
    }
    properties.yielded = did.join(" ");
    const geometry = !shifted && !cut ? f.geometry : after.length === 1 ? { type: "LineString", coordinates: after[0]! } : { type: "MultiLineString", coordinates: after };
    changed.set(row, { ...f, geometry, properties });
  }
  return { changed, count, gone: bands };
}

/** The footprints of a work folder, each marked where its label says it is a parking structure. */
export function readFootprints(source: string): Footprint[] {
  const file = join(source, "base/buildings.geojson");
  if (!existsSync(file)) return [];
  const labelFile = join(source, "blocks/labels.json");
  const labels = existsSync(labelFile) ? (JSON.parse(readFileSync(labelFile, "utf8")) as Record<string, { kind?: string | null; primary_use?: string | null } | undefined>) : {};
  const doc = JSON.parse(readFileSync(file, "utf8")) as { features: { geometry: { type: string; coordinates: unknown }; properties: { id?: number } }[] };
  return doc.features.flatMap((f) => {
    const label = labels[String(f.properties.id)];
    const parking = label?.kind === "parking_garage" || label?.primary_use === "Parking";
    return ((f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][]).map((rings) => ({ rings, parking }));
  });
}

/** The ends of a work folder's stalls on their aisles (base/stalls.json). */
export function readStalls(source: string): [number, number][] {
  const file = join(source, "base/stalls.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { fe: number; fn: number }[]).map((s) => [s.fe, s.fn]) : [];
}

/**
 * Metres from (e, n) to the nearest band of road that is gone, negative within it; Infinity where it is more than `reach`,
 * or a road that is left is as near by its own band: the ground there is that road's.
 */
export type Gone = (e: number, n: number, reach: number) => number;

/** Whose ground a place is, for `gone` bands among the roads `left` (the pieces as they stand after yielding). */
export function goneAmong(gone: readonly Band[], left: readonly RoadFeature[]): Gone {
  const far = (seg: readonly number[], k: number, x: number, z: number): number => {
    const ax = seg[k * 4]!, az = seg[k * 4 + 1]!, ex = seg[k * 4 + 2]! - ax, ez = seg[k * 4 + 3]! - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    return Math.hypot(x - ax - ex * t, z - az - ez * t);
  };
  const index = (): { seg: number[]; half: number[]; bins: Map<number, number[]> } => ({ seg: [], half: [], bins: new Map() });
  const add = (into: ReturnType<typeof index>, line: number[][], half: number, where?: ReadonlySet<number>): void => {
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1]![0]!, az = line[i - 1]![1]!, bx = line[i]![0]!, bz = line[i]![1]!;
      if (where && !where.has(binKey(Math.floor(ax / 64), Math.floor(az / 64))) && !where.has(binKey(Math.floor(bx / 64), Math.floor(bz / 64)))) continue;
      put(into.bins, LINE_BIN, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), into.half.length);
      into.seg.push(ax, az, bx, bz);
      into.half.push(half);
    }
  };
  // A line with no step over 48 m, so that its points' 64 m squares tell where it runs.
  const fine = (line: number[][]): number[][] => line.flatMap((p, i) => {
    if (i === 0) return [p];
    const q = line[i - 1]!, steps = Math.ceil(Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) / 48);
    return Array.from({ length: Math.max(1, steps) }, (_, k) => (k + 1 >= steps ? p : [q[0]! + ((p[0]! - q[0]!) * (k + 1)) / steps, q[1]! + ((p[1]! - q[1]!) * (k + 1)) / steps]));
  });
  // Only the roads left that come within a square of one that is gone are kept.
  const lost = index(), stay = index(), about = new Set<number>();
  for (const b of gone) {
    add(lost, b.line, b.half);
    for (const [e, n] of fine(b.line)) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) about.add(binKey(Math.floor(e! / 64) + dx, Math.floor(n! / 64) + dz));
  }
  for (const f of left) if (kindOf(f) !== WALKED) for (const run of runsOf(f)) add(stay, fine(run), widthOf(f) / 2, about);
  const nearest = (from: ReturnType<typeof index>, x: number, z: number, reach: number): number => {
    let best = Infinity;
    for (let bz = Math.floor((z - reach) / LINE_BIN); bz <= Math.floor((z + reach) / LINE_BIN); bz++) for (let bx = Math.floor((x - reach) / LINE_BIN); bx <= Math.floor((x + reach) / LINE_BIN); bx++) {
      for (const k of from.bins.get(binKey(bx, bz)) ?? []) best = Math.min(best, far(from.seg, k, x, z) - from.half[k]!);
    }
    return best;
  };
  return (e, n, reach) => {
    if (gone.length === 0) return Infinity;
    const own = nearest(lost, e, n, reach + 16);
    return own > reach || nearest(stay, e, n, Math.max(0, own) + 16) <= own ? Infinity : own;
  };
}

const kept = new Map<string, { stamp: string; yielded: Yielded; seconds: number; gone: Gone; walked: Gone }>();

/** What yields in a work folder, worked out once for the files as they stand. */
export function yieldOf(source: string, features: readonly RoadFeature[]): Yielded {
  const stamp = ["base/roads.geojson", "base/buildings.geojson", "blocks/labels.json", "base/stalls.json"].map((name) => {
    const file = join(source, name);
    if (!existsSync(file)) return "-";
    const s = statSync(file);
    return `${s.size}:${s.mtimeMs}`;
  }).join("|");
  let got = kept.get(source);
  if (got?.stamp !== stamp) {
    const t0 = performance.now();
    const footprints = readFootprints(source);
    const yielded = yieldRoads(features, footprints, footprints.length > 0 ? readStalls(source) : []);
    const left = yielded.gone.length > 0 ? features.map((f, row) => yielded.changed.get(row) ?? f) : [];
    const gone = goneAmong(yielded.gone, left), walked = goneAmong(yielded.gone.filter((b) => b.walked), left);
    kept.set(source, (got = { stamp, yielded, seconds: (performance.now() - t0) / 1000, gone, walked }));
  }
  return got.yielded;
}

/**
 * The bands of road a work folder's yielding took away, once its roads are read: whose ground a place near one is
 * (`own`), and the same for those of them the data made walks along (`walked`).
 */
export const goneOf = (source: string): { bands: readonly Band[]; own: Gone; walked: Gone } | null => {
  const got = kept.get(source);
  return got ? { bands: got.yielded.gone, own: got.gone, walked: got.walked } : null;
};

/** How many pieces of a work folder yielded and the seconds that took, once its roads are read. */
export const yieldCount = (source: string): { count: YieldCount; seconds: number } | null => {
  const got = kept.get(source);
  return got ? { count: got.yielded.count, seconds: got.seconds } : null;
};

/** The road pieces of the work folder `source` as every reader takes them: base/roads.geojson's rows, those that yield changed. */
export function readRoads<T extends RoadFeature = RoadFeature>(source: string): T[] {
  const file = join(source, "base/roads.geojson");
  if (!existsSync(file)) return [];
  const features = (JSON.parse(readFileSync(file, "utf8")) as { features: T[] }).features;
  for (const [row, f] of yieldOf(source, features).changed) features[row] = f as T;
  return features;
}
