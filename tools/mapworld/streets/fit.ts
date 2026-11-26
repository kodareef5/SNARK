// The streets' fit (planning/workstreams/streets.md, layer 2): from the street data and the ground's layers, for every
// stretch of a street on the ground, its line, how much room it has each side out to the building line or the next
// street, how built up and how green each side is, where the data draws a walk along each side, whether it is one of a
// pair of one-way carriageways with a median between, how steep it is and which district it is in. Everything here is in
// the map's own metres (x west, z north from its south-east corner); the base layers are read at the sample nearest.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Base } from "../base.ts";
import type { District } from "../ground.ts";
import { binKey } from "../raster.ts";
import { LONGEST_STEP } from "../../../shared/world/streets.ts";
import { NOT_DRIVEN, readRoads } from "./yield.ts";

export { NOT_DRIVEN };
/** Metres between the places along a stretch its sides are looked at from, and the furthest out each look goes. */
const STATION = 4;
const LOOK = 30;
/** How far out a footprint makes a side built up, and a drawn walk is looked for. */
const BUILT_WITHIN = 15;
const WALK_WITHIN = 15;
/** How far across a pair's partner is looked for, and how near parallel it runs. */
const PAIR_WITHIN = 45;
const PAIR_COS = 0.94;

/** What the data says of a stretch: a run of one road piece of base/roads.geojson, as one line. */
export interface Run {
  /** The piece's id (osm:<way>:<n>, or TIGER's), and which run of it: its place, or the number a cut gave it (yield.ts). */
  readonly id: string;
  readonly run: number;
  /** Its piece's place in base/roads.geojson, as the street graph numbers its lines. */
  readonly line: number;
  readonly way: number | null;
  readonly name: string | null;
  readonly mtfcc: string;
  readonly highway: string | null;
  readonly lanes: number;
  readonly half: number;
  /** 1 one way along the line as drawn, -1 against it, 0 both ways. */
  readonly oneway: number;
  readonly sidewalk: string | null;
  readonly parking: readonly [string | null, string | null];
  readonly maxspeed: number | null;
  /** How its piece yielded to a building (yield.ts): shifted, narrowed, cut, or null. */
  readonly yielded: string | null;
  /** x and z pairs in the map's metres. */
  readonly xz: Float64Array;
}

/** A side's fit: metres from the kerb to the building line or the next street (Infinity, none within LOOK), and shares of its looks. */
export interface SideFit {
  room: number;
  built: number;
  green: number;
  /** Metres from the kerb to the middle of a walk the data draws along this side, or null; and the share of looks that met it. */
  drawn: number | null;
  drawnShare: number;
  /** The data's sidewalk tag on this side: walk, none, separate, or null where it has none. */
  tagged: string | null;
  /** Whether it faces its pair's partner. */
  inner: boolean;
}

export interface StretchFit {
  length: number;
  /** Degrees off the nearest of the map's axes, 0 to 45. */
  angle: number;
  /** Rise over length end to end. */
  slope: number;
  district: string | null;
  style: string | null;
  tall: number;
  /** Left, then right of the drawn way: its own where it has looks enough across, else its street's. */
  sides: [SideFit, SideFit];
  /** Its street's sides: the looks of every stretch of its way in its district, which its type is named by. */
  street: [SideFit, SideFit];
  /** The stretch of a pair across the median, and the median's width, or null. */
  pair: { stretch: number; median: number } | null;
  /** 0 to 1: how much the fit had to go on. */
  sure: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Map metres of base metres (e, n), for a grid with edges east and south. */
export type ToMap = (e: number, n: number) => [number, number];

/** The runs of the work folder's road pieces on the ground that carry traffic, a step longer than LONGEST_STEP cut. */
export function readRuns(source: string, toMap: ToMap): Run[] {
  const out: Run[] = [];
  readRoads(source).forEach((f, line) => {
    const p = f.properties;
    const mtfcc = text(p.mtfcc) ?? "", highway = text(p.highway);
    if (NOT_DRIVEN.has(mtfcc) || NOT_DRIVEN.has(highway ?? "") || p.bridge === true || p.tunnel === true) return;
    const id = text(p.id) ?? `line:${line}`;
    const way = /^osm:(-?\d+)/.exec(id)?.[1];
    const runs = f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [f.geometry.coordinates as number[][]];
    const numbers = Array.isArray(p.run_numbers) ? (p.run_numbers as number[]) : null;
    runs.forEach((run, k) => {
      const pts: number[] = [];
      for (const [e, n] of run) {
        const [x, z] = toMap(e!, n!);
        if (pts.length >= 2) {
          const px = pts[pts.length - 2]!, pz = pts[pts.length - 1]!, l = Math.hypot(x - px, z - pz);
          if (l < 0.01) continue;
          // A step longer than a part holds is cut into equal ones.
          const cuts = Math.ceil(l / LONGEST_STEP);
          for (let c = 1; c < cuts; c++) pts.push(px + ((x - px) * c) / cuts, pz + ((z - pz) * c) / cuts);
        }
        pts.push(x, z);
      }
      if (pts.length < 4) return;
      out.push({
        id, run: numbers?.[k] ?? k, line, way: way === undefined ? null : Number(way), name: text(p.name), mtfcc, highway, lanes: num(p.lanes) ?? 2, half: (num(p.width_m) ?? 8) / 2,
        oneway: num(p.oneway_dir) ?? (p.oneway === true ? 1 : 0), sidewalk: text(p.sidewalk), parking: [text(p.parking_left), text(p.parking_right)], maxspeed: num(p.maxspeed_mph), yielded: text(p.yielded), xz: Float64Array.from(pts),
      });
    });
  });
  return out;
}

/** The data's sidewalk tag on the left side (0) or the right (1). */
function tagged(tag: string | null, side: number): string | null {
  if (!tag) return null;
  if (tag === "no" || tag === "none") return "none";
  if (tag === "separate") return "separate";
  if (tag === "both" || tag === "yes") return "walk";
  if (tag === "left") return side === 0 ? "walk" : "none";
  if (tag === "right") return side === 1 ? "walk" : "none";
  return null;
}

/** A segment of a line, binned. */
interface Seg { ax: number; az: number; bx: number; bz: number; owner: number }
function binned(segs: Seg[], size: number): Map<number, Seg[]> {
  const bins = new Map<number, Seg[]>();
  for (const s of segs) {
    for (let bz = Math.floor(Math.min(s.az, s.bz) / size); bz <= Math.floor(Math.max(s.az, s.bz) / size); bz++) {
      for (let bx = Math.floor(Math.min(s.ax, s.bx) / size); bx <= Math.floor(Math.max(s.ax, s.bx) / size); bx++) {
        const k = binKey(bx, bz);
        (bins.get(k) ?? bins.set(k, []).get(k)!).push(s);
      }
    }
  }
  return bins;
}

/** Where the ray from (x, z) along (ux, uz) for `reach` metres first crosses a segment of `bins` that `keep` keeps: its distance and the segment. */
function cast(bins: Map<number, Seg[]>, size: number, x: number, z: number, ux: number, uz: number, reach: number, keep: (s: Seg) => boolean): { t: number; seg: Seg } | null {
  let best: { t: number; seg: Seg } | null = null;
  const seen = new Set<Seg>();
  const steps = Math.ceil(reach / size) + 1;
  for (let k = 0; k <= steps; k++) {
    const px = x + (ux * reach * k) / steps, pz = z + (uz * reach * k) / steps;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      for (const s of bins.get(binKey(Math.floor(px / size) + dx, Math.floor(pz / size) + dz)) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (!keep(s)) continue;
        // x + ux t = ax + ex u, z + uz t = az + ez u.
        const ex = s.bx - s.ax, ez = s.bz - s.az, den = ux * ez - uz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const rx = s.ax - x, rz = s.az - z, t = (rx * ez - rz * ex) / den, u = (rx * uz - rz * ux) / den;
        if (t >= 0 && t <= reach && u >= 0 && u <= 1 && (!best || t < best.t)) best = { t, seg: s };
      }
    }
  }
  return best;
}

/** Whether point (x, z) is inside a ring of [x, z] points. */
function inside(ring: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!, [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * The fit of every run: `base` the work folder's layers, `toMap` its base metres into the map's, `districts` the world's
 * (their rings in longitude and latitude), and `toSample` a map place's base sample index or -1 off the map.
 */
export function fitRuns(runs: readonly Run[], base: Base, toMap: ToMap, districts: readonly District[], toSample: (x: number, z: number) => number): StretchFit[] {
  const built = base.bytes("buildings"), roads = base.bytes("roads"), biome = base.bytes("biome"), canopy = base.bytes("painted_canopy");
  const use = existsSync(join(base.folder, "base", "use.png")) ? base.bytes("use") : new Uint8Array(built.length);
  const dem = base.elevation();
  const at = (x: number, z: number, layer: Uint8Array): number => { const k = toSample(x, z); return k < 0 ? 0 : layer[k]!; };
  // The drawn walks and the other runs, binned for the rays.
  const walkSegs: Seg[] = [];
  const walks = JSON.parse(readFileSync(join(base.folder, "base/walks.geojson"), "utf8")) as { features: { geometry: { type: string; coordinates: number[][] }; properties: Record<string, unknown> }[] };
  for (const f of walks.features) {
    if (f.properties.kind !== "sidewalk" || f.properties.drawn !== true || f.geometry.type !== "LineString") continue;
    const pts = f.geometry.coordinates.map(([e, n]) => toMap(e!, n!));
    for (let i = 1; i < pts.length; i++) walkSegs.push({ ax: pts[i - 1]![0], az: pts[i - 1]![1], bx: pts[i]![0], bz: pts[i]![1], owner: -1 });
  }
  const walkBins = binned(walkSegs, 16);
  const runSegs: Seg[] = [];
  runs.forEach((r, k) => { for (let q = 2; q < r.xz.length; q += 2) runSegs.push({ ax: r.xz[q - 2]!, az: r.xz[q - 1]!, bx: r.xz[q]!, bz: r.xz[q + 1]!, owner: k }); });
  const runBins = binned(runSegs, 16);
  const rings = districts.map((d) => d.ring.map(([lon, lat]) => toMap(...base.tm.forward(lon, lat))));
  const boxes = rings.map((ring) => [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1])), Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))]);

  const fits: StretchFit[] = runs.map((r) => {
    const p = r.xz, n = p.length / 2;
    let length = 0;
    for (let q = 2; q < p.length; q += 2) length += Math.hypot(p[q]! - p[q - 2]!, p[q + 1]! - p[q - 1]!);
    const ex = p[p.length - 2]! - p[0]!, ez = p[p.length - 1]! - p[1]!;
    const deg = (Math.atan2(Math.abs(ez), Math.abs(ex)) * 180) / Math.PI, angle = Math.min(deg, 90 - deg);
    const h0 = dem[Math.max(0, toSample(p[0]!, p[1]!))] ?? NaN, h1 = dem[Math.max(0, toSample(p[p.length - 2]!, p[p.length - 1]!))] ?? NaN;
    const slope = Number.isFinite(h0) && Number.isFinite(h1) && length > 0 ? Math.abs(h1 - h0) / length : 0;
    // The district its middle is in, a later district over an earlier one as the ground has them.
    const m = Math.floor(n / 2), mx = n % 2 ? p[m * 2]! : (p[m * 2 - 2]! + p[m * 2]!) / 2, mz = n % 2 ? p[m * 2 + 1]! : (p[m * 2 - 1]! + p[m * 2 + 1]!) / 2;
    let district: District | null = null;
    for (let d = districts.length - 1; d >= 0 && !district; d--) {
      const b = boxes[d]!;
      if (mx >= b[0]! && mx <= b[2]! && mz >= b[1]! && mz <= b[3]! && inside(rings[d]!, mx, mz)) district = districts[d]!;
    }
    const sides = (): [SideFit, SideFit] => [0, 1].map((side) => ({ room: Infinity, built: 0, green: 0, drawn: null, drawnShare: 0, tagged: tagged(r.sidewalk, side), inner: false })) as [SideFit, SideFit];
    return { length, angle, slope, district: district?.name ?? null, style: district?.style ?? null, tall: district?.tall ?? 0, sides: sides(), street: sides(), pair: null, sure: 1 };
  });

  // Where three or more runs end at one point there is a junction: a look across from near one sees the street across.
  const ends = new Map<string, number>();
  const endKey = (x: number, z: number): string => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  for (const r of runs) for (const q of [0, r.xz.length - 2]) { const key = endKey(r.xz[q]!, r.xz[q + 1]!); ends.set(key, (ends.get(key) ?? 0) + 1); }
  const junction = (x: number, z: number): boolean => (ends.get(endKey(x, z)) ?? 0) >= 3;

  // The looks across each side from stations along each run, none within JUNCTION_CLEAR of a junction at its ends.
  const partners: Map<string, { stretch: number; side: number; medians: number[] }>[] = runs.map(() => new Map());
  const looks: Looks[] = runs.map((r, k) => {
    const p = r.xz, length = fits[k]!.length;
    const own: Looks = { stations: 0, rooms: [[], []], drawn: [[], []], built: [0, 0], green: [0, 0] };
    const rooms = own.rooms, drawn = own.drawn;
    const startJ = junction(p[0]!, p[1]!), endJ = junction(p[p.length - 2]!, p[p.length - 1]!);
    let along = 0;
    for (let q = 2; q < p.length; q += 2) {
      const ax = p[q - 2]!, az = p[q - 1]!, ex = p[q]! - ax, ez = p[q + 1]! - az, l = Math.hypot(ex, ez);
      if (l <= 0) continue;
      const ux = ex / l, uz = ez / l;
      for (let s = Math.min(l / 2, STATION / 2); s < l; s += STATION) {
        if ((startJ && along + s < JUNCTION_CLEAR) || (endJ && length - along - s < JUNCTION_CLEAR)) continue;
        own.stations++;
        const x = ax + ux * s, z = az + uz * s;
        for (const side of [0, 1]) {
          const nx = side === 0 ? -uz : uz, nz = side === 0 ? ux : -ux;
          // Out from the kerb a metre at a time to the first footprint, or another street's ground past this one's edge.
          let hit = Infinity, building = false;
          for (let t = 0.5; t <= LOOK; t += 1) {
            const px = x + nx * (r.half + t), pz = z + nz * (r.half + t);
            if (at(px, pz, built) > 0) { hit = t; building = true; break; }
            if (t > 1.5 && at(px, pz, roads) !== 0) { hit = t; break; }
          }
          rooms[side]!.push(hit);
          if (building && hit <= BUILT_WITHIN) own.built[side]!++;
          const gx = x + nx * (r.half + 4), gz = z + nz * (r.half + 4);
          const u = at(gx, gz, use), b = at(gx, gz, biome);
          if (u === 6 || u === 7 || b === 3 || at(gx, gz, canopy) > 0) own.green[side]!++;
          // A drawn walk running along this side.
          const w = cast(walkBins, 16, x + nx * r.half, z + nz * r.half, nx, nz, WALK_WITHIN, (g) => {
            const gx2 = g.bx - g.ax, gz2 = g.bz - g.az, gl = Math.hypot(gx2, gz2);
            return gl > 0 && Math.abs((gx2 * ux + gz2 * uz) / gl) > 0.85;
          });
          if (w) drawn[side]!.push(w.t);
          // A one-way partner across, nothing built between.
          if (r.oneway !== 0) {
            const o = cast(runBins, 16, x + nx * (r.half + 0.5), z + nz * (r.half + 0.5), nx, nz, PAIR_WITHIN, (g) => g.owner !== k);
            if (o && (!building || o.t < hit + 0.5)) {
              const other = runs[o.seg.owner]!, gx2 = o.seg.bx - o.seg.ax, gz2 = o.seg.bz - o.seg.az, gl = Math.hypot(gx2, gz2);
              const along = (gx2 * ux + gz2 * uz) / gl;
              // Opposite traffic: one's way of travel against the other's.
              const travel = along * r.oneway * other.oneway;
              if (other.oneway !== 0 && Math.abs(along) > PAIR_COS && travel < 0) {
                const median = o.t + 0.5 - other.half;
                if (median > 0.5) {
                  // By the partner's way, which the data may cut into several stretches along this one.
                  const key = `${other.way ?? other.id}|${side}`, got = partners[k]!.get(key) ?? partners[k]!.set(key, { stretch: o.seg.owner, side, medians: [] }).get(key)!;
                  got.medians.push(median);
                }
              }
            }
          }
        }
      }
      along += l;
    }
    return own;
  });
  // A short stretch between two driveways has few looks or none, and takes its way's (whose stretches are drawn one way);
  // and a street is typed as one, by the looks of every stretch of its name in its district (StretchFit.street).
  const ways = new Map<string, Looks>(), streets = new Map<string, Looks>();
  const gather = (into: Map<string, Looks>, key: string, own: Looks): void => {
    const c = into.get(key) ?? into.set(key, { stations: 0, rooms: [[], []], drawn: [[], []], built: [0, 0], green: [0, 0] }).get(key)!;
    c.stations += own.stations;
    for (const side of [0, 1]) {
      c.rooms[side]!.push(...own.rooms[side]!);
      c.drawn[side]!.push(...own.drawn[side]!);
      c.built[side]! += own.built[side]!;
      c.green[side]! += own.green[side]!;
    }
  };
  runs.forEach((r, k) => {
    gather(ways, `${r.way ?? r.id}|${fits[k]!.district ?? ""}`, looks[k]!);
    gather(streets, streetKey(r, fits[k]!), looks[k]!);
  });
  runs.forEach((r, k) => {
    const fit = fits[k]!, own = looks[k]!, way = ways.get(`${r.way ?? r.id}|${fit.district ?? ""}`)!, street = streets.get(streetKey(r, fit))!;
    const from = own.stations >= OWN_LOOKS ? own : way;
    for (const side of [0, 1]) {
      sideFit(fit.sides[side]!, from, side);
      fit.street[side] = sideFit({ ...fit.sides[side]! }, street, side);
    }
    fit.sure = Math.min(1, 0.4 + from.stations * 0.06);
  });
  // A pair: a partner met from at least half the stations on one side, the median the middle of those met.
  runs.forEach((_, k) => {
    let best: { stretch: number; side: number; medians: number[] } | null = null;
    for (const v of partners[k]!.values()) if (!best || v.medians.length > best.medians.length) best = v;
    const stations = Math.max(1, looks[k]!.stations);
    if (!best || best.medians.length < stations * 0.5) return;
    const ms = best.medians.sort((a, b) => a - b), median = ms[Math.floor(ms.length / 2)]!;
    fits[k]!.pair = { stretch: best.stretch, median };
    pairUp(fits[k]!, best.stretch, best.side, median);
  });
  // A street most of whose length is one of a pair is one all along: a short stretch between two driveways, or at a
  // junction's mouth, takes its street's inner side and median, so the median runs on unbroken.
  const pairedShare = new Map<string, { paired: number; length: number; side: number[]; medians: number[]; stretch: number }>();
  runs.forEach((r, k) => {
    if (r.oneway === 0) return;
    const key = `${r.way ?? r.id}|${fits[k]!.district ?? ""}`, f = fits[k]!;
    const c = pairedShare.get(key) ?? pairedShare.set(key, { paired: 0, length: 0, side: [0, 0], medians: [], stretch: -1 }).get(key)!;
    c.length += f.length;
    if (!f.pair) return;
    c.paired += f.length;
    c.side[f.sides[0].inner ? 0 : 1]! += f.length;
    c.medians.push(f.pair.median);
    c.stretch = f.pair.stretch;
  });
  runs.forEach((r, k) => {
    const c = pairedShare.get(`${r.way ?? r.id}|${fits[k]!.district ?? ""}`);
    if (fits[k]!.pair || !c || c.paired < c.length * 0.5) return;
    const ms = [...c.medians].sort((a, b) => a - b);
    pairUp(fits[k]!, c.stretch, c.side[0]! >= c.side[1]! ? 0 : 1, ms[Math.floor(ms.length / 2)]!);
  });
  return fits;
}

/**
 * A street's key: its name in its district, or where it has none its way's. Its two sides are taken together where it
 * is typed (a street's ways may be drawn either way), so they need not be told apart here.
 */
const streetKey = (r: Run, f: StretchFit): string => `${r.name || r.way || r.id}|${f.district ?? ""}`;

/** Makes a stretch one of a pair: its partner, the median between, and the side facing it, whose room is the median's half. */
function pairUp(fit: StretchFit, stretch: number, side: number, median: number): void {
  fit.pair = { stretch, median };
  for (const sides of [fit.sides, fit.street]) {
    sides[side]!.inner = true;
    sides[side]!.room = Math.min(sides[side]!.room, median / 2);
  }
}

/** A run's or a street's looks across: how many stations, and each side's rooms, drawn walks met, and counts built up and green. */
interface Looks { stations: number; rooms: number[][]; drawn: number[][]; built: number[]; green: number[] }
/** Stations a stretch needs to be fitted by its own looks, not its street's. */
const OWN_LOOKS = 4;
/** Metres from a junction at a stretch's end within which no station looks across. */
const JUNCTION_CLEAR = 8;

/** A side's fit from looks: the room a third of the way up its rooms, the shares, and the middle of the drawn walks met where at least 0.4 met one. */
function sideFit(sf: SideFit, from: Looks, side: number): SideFit {
  const rs = [...from.rooms[side]!].sort((a, b) => a - b), n = from.stations;
  sf.room = rs.length ? rs[Math.floor(rs.length * 0.3)]! : Infinity;
  sf.built = n ? from.built[side]! / n : 0;
  sf.green = n ? from.green[side]! / n : 0;
  const ds = [...from.drawn[side]!].sort((a, b) => a - b);
  sf.drawnShare = n ? ds.length / n : 0;
  sf.drawn = sf.drawnShare >= 0.4 ? ds[Math.floor(ds.length / 2)]! : null;
  return sf;
}
