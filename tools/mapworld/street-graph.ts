// The streets as the street data maps them (tools/mapdata/streets.py), for the pieces that stand in them: the road
// pieces of base/roads.geojson as stretches, joined where they share a point into a graph whose nodes are junctions
// where three ways or more meet, dead ends where one does, and nothing where two do (a way's tags change there, in the
// middle of a block); what the data says of each piece (its class, width, lanes, one way and its sense, sidewalk sides,
// and where the data keeps them its speed, lighting and kerbside parking); the signals, stops and give-ways it maps, each
// with the pieces and the directions of the traffic it governs (base/controls.json, where the data has it); the crossings
// of the walk network (base/walks.geojson); and the parking lots with stalls (base/stalls.json).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { binKey, textSeed } from "./raster.ts";
import { readRoads } from "./streets/yield.ts";

/** A road piece's stretch between two of its points, in engine metres, with its class (TIGER MTFCC) and half width. */
export interface Segment {
  ax: number; az: number; bx: number; bz: number; half: number; mtfcc: string; line: number;
  /** Metres along the whole piece where it starts, which a run the frame left out of the piece's middle adds to. */
  along: number;
}

/** What the data says of a road piece. Sides are of its drawn direction: left, then right. */
export interface Piece {
  id: string; mtfcc: string; highway: string | null; name: string | null; lanes: number; half: number;
  /** 32 bits of its id, what seeds what stands along it. */
  seed: number;
  /** Metres along the whole piece where this cut's line of it starts: 0 but where the frame cut it. */
  from: number;
  /** 1 one way as drawn, -1 one way against it, 0 both ways. */
  oneway: number;
  sidewalk: string | null; bridge: boolean; tunnel: boolean;
  /** Its speed limit in miles an hour, whether it is lit, and how cars stand at its kerb on each side ("no" none). */
  maxspeed: number | null; lit: boolean | null; parking: [string | null, string | null];
}

/** A way out of a node: which way it leaves, its piece, and +1 where that is the way the piece is drawn. */
export interface Way { dx: number; dz: number; line: number; sense: number; }

/** A point pieces share or end at, with the ways out of it (one for each direction, the widest where two overlap). */
export interface StreetNode { x: number; z: number; ways: Way[]; key: number; }

/**
 * A signal, stop, give-way or crossing the data maps (base/controls.json, tools/mapdata/streets.py `controls`): where it
 * is, the traffic it governs (each the line it comes along and the way it travels, a unit vector in engine metres), and a
 * crossing's type (crossing=*).
 */
export interface Marked { x: number; z: number; kind: string; allWay: boolean; crossing: string | null; governs: { line: number; dx: number; dz: number }[]; }

/**
 * A crossing of the walk network, from a to b across the road, `half` its half width; `signal`, its type (crossing=*)
 * and its markings (crossing:markings) where the data says.
 */
export interface Crossing { ax: number; az: number; bx: number; bz: number; half: number; drawn: boolean; signal: boolean | null; type: string | null; markings: string | null; }

/** A parking lot: where its stalls' middle is, and each stall's middle and the middle of its end on the aisle. */
export interface Lot { id: string; x: number; z: number; stalls: [number, number, number, number][]; }

export interface StreetGraph {
  segments: Segment[];
  pieces: Piece[];
  nodes: StreetNode[];
  /** Whether a node where three ways or more meet is within `reach` of (x, z). */
  junction: (x: number, z: number, reach: number) => boolean;
  /** The node at (x, z), keyed to half a metre, or undefined. */
  nodeAt: (x: number, z: number) => StreetNode | undefined;
  marked: Marked[];
  crossings: Crossing[];
  /** Whether (x, z) is within `margin` of a crossing's width. */
  onCrossing: (x: number, z: number, margin: number) => boolean;
  lots: Lot[];
  /** Whether the data maps its controls (controls.json) and the extra road tags; where not, the rules stand in. */
  mapped: { points: boolean; tags: boolean };
}

/** A point's key: its half metres, kept positive, so that a point past the map's edge keeps a key of its own. */
export const nodeKey = (x: number, z: number): number => (Math.round(x * 2) + 65536) * 131072 + Math.round(z * 2) + 65536;

interface Feature<G> { geometry: G; properties: Record<string, unknown> }
type Line = { type: string; coordinates: number[][] | number[][][] };

const read = <T,>(file: string): T | null => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null);
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A road piece's id in the data, or for one the data gives none its row's. */
export const lineId = (f: { properties: Record<string, unknown> }, row: number): string => text(f.properties.id) ?? `line:${row}`;

/** Two texts in order, as ids are ranked where a row's place in the data must not decide. */
export const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The street data of the work folder `source`, its metres turned to the engine's by `toLattice`. */
export function readStreetGraph(source: string, toLattice: (e: number, n: number) => [number, number]): StreetGraph {
  const segments: Segment[] = []; const pieces: Piece[] = [];
  const at = new Map<number, StreetNode>();
  const nodeOf = (x: number, z: number): StreetNode => {
    const key = nodeKey(x, z); let n = at.get(key);
    if (!n) { n = { x, z, ways: [], key }; at.set(key, n); }
    return n;
  };
  const roads = readRoads<Feature<Line>>(source);
  const interior: [number, number, number, [number, number, number][]][] = [];
  let tags = false;
  roads.forEach((f, line) => {
    const p = f.properties;
    const oneway = num(p.oneway_dir) ?? (p.oneway === true ? 1 : 0);
    if ("oneway_dir" in p || "maxspeed_mph" in p || "lit" in p) tags = true;
    pieces.push({
      id: lineId(f, line), seed: textSeed(lineId(f, line)), from: num(p.from_m) ?? 0, mtfcc: text(p.mtfcc) ?? "", highway: text(p.highway), name: text(p.name), lanes: num(p.lanes) ?? 2,
      half: (num(p.width_m) ?? 8) / 2, oneway, sidewalk: text(p.sidewalk), bridge: p.bridge === true, tunnel: p.tunnel === true,
      maxspeed: num(p.maxspeed_mph), lit: typeof p.lit === "boolean" ? p.lit : null, parking: [text(p.parking_left), text(p.parking_right)],
    });
    const runs = f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [f.geometry.coordinates as number[][]];
    // Where each run starts along the whole piece (streets.py runs_from_m); data made before it says only the first's.
    const starts = Array.isArray(p.runs_from_m) && p.runs_from_m.length === runs.length ? (p.runs_from_m as unknown[]).map(Number) : null;
    let walked = pieces[line]!.from;
    for (const [r, run] of runs.entries()) {
      if (starts) walked = starts[r]!;
      const points = run.map(([e, n]) => toLattice(e!, n!)).filter((q, i, all) => i === 0 || Math.hypot(q[0] - all[i - 1]![0], q[1] - all[i - 1]![1]) >= 0.01);
      for (let i = 1; i < points.length; i++) {
        const [ax, az] = points[i - 1]!; const [bx, bz] = points[i]!;
        segments.push({ ax, az, bx, bz, half: pieces[line]!.half, mtfcc: pieces[line]!.mtfcc, line, along: walked });
        walked += Math.hypot(bx - ax, bz - az);
      }
      // A piece's ends are its nodes; a point inside it that another piece shares is a node it passes through.
      for (const [i, [x, z]] of points.entries()) {
        const out: [number, number, number][] = [];
        if (i < points.length - 1) out.push([points[i + 1]![0] - x, points[i + 1]![1] - z, 1]);
        if (i > 0) out.push([points[i - 1]![0] - x, points[i - 1]![1] - z, -1]);
        if (i > 0 && i < points.length - 1 && !at.has(nodeKey(x, z))) { interior.push([x, z, line, out]); continue; }
        const n = nodeOf(x, z);
        for (const [dx, dz, sense] of out) { const l = Math.hypot(dx, dz); n.ways.push({ dx: dx / l, dz: dz / l, line, sense }); }
      }
    }
  });
  // Points inside a piece that another piece reaches after it was read.
  for (const [x, z, line, out] of interior) {
    const n = at.get(nodeKey(x, z)); if (!n) continue;
    for (const [dx, dz, sense] of out) { const l = Math.hypot(dx, dz); n.ways.push({ dx: dx / l, dz: dz / l, line, sense }); }
  }
  // One way out for each direction: two pieces drawn over each other are one way, the wider.
  const nodes = [...at.values()];
  for (const n of nodes) {
    const kept: Way[] = [];
    for (const w of n.ways.sort((a, b) => pieces[b.line]!.half - pieces[a.line]!.half || byText(pieces[a.line]!.id, pieces[b.line]!.id) || a.line - b.line)) if (!kept.some((k) => k.dx * w.dx + k.dz * w.dz > 0.97)) kept.push(w);
    n.ways = kept.sort((a, b) => Math.atan2(a.dz, a.dx) - Math.atan2(b.dz, b.dx));
  }
  const junctions = nodes.filter((n) => n.ways.length >= 3);
  const bins = new Map<number, StreetNode[]>();
  for (const j of junctions) { const k = binKey(Math.floor(j.x / 32), Math.floor(j.z / 32)); if (!bins.has(k)) bins.set(k, []); bins.get(k)!.push(j); }
  const junction = (x: number, z: number, reach: number): boolean => {
    for (let bz = Math.floor((z - reach) / 32); bz <= Math.floor((z + reach) / 32); bz++) for (let bx = Math.floor((x - reach) / 32); bx <= Math.floor((x + reach) / 32); bx++) {
      for (const j of bins.get(binKey(bx, bz)) ?? []) if (Math.hypot(j.x - x, j.z - z) < reach) return true;
    }
    return false;
  };

  // The controls the data maps, on the pieces whose ids it names.
  const byId = new Map(pieces.map((p, i) => [p.id, i]));
  const controls = read<unknown>(join(source, "base/controls.json"));
  const marked: Marked[] = (Array.isArray(controls) ? (controls as Record<string, unknown>[]) : []).flatMap((c) => {
    const e = num(c.e); const n = num(c.n); if (e === null || n === null) return [];
    const [x, z] = toLattice(e, n);
    const governs = (Array.isArray(c.approaches) ? (c.approaches as Record<string, unknown>[]) : []).flatMap((a) => {
      const line = byId.get(String(a.road)); const t = a.travel as number[] | undefined;
      if (line === undefined || !Array.isArray(t)) return [];
      // The way it travels, east and north, as the engine's metres turn it.
      const [tx, tz] = toLattice(e + t[0]!, n + t[1]!);
      return [{ line, dx: tx - x, dz: tz - z }];
    });
    return [{ x, z, kind: text(c.kind) ?? "", allWay: c.all_way === true, crossing: text(c.crossing), governs }];
  });

  // The walk network's crossings.
  const walks = read<{ features: Feature<Line>[] }>(join(source, "base/walks.geojson"))?.features ?? [];
  const crossings: Crossing[] = [];
  for (const f of walks) {
    if (f.properties.kind !== "crossing" || f.geometry.type !== "LineString") continue;
    // A crossing drawn in pieces that run on in one line (a point at each kerb, one on the road's middle) is one piece.
    const run = (f.geometry.coordinates as number[][]).map(([e, n]) => toLattice(e!, n!)).filter((q, i, all) => {
      if (i === 0 || i === all.length - 1) return true;
      const [a, b] = [all[i - 1]!, all[i + 1]!];
      const ux = q[0] - a[0], uz = q[1] - a[1], vx = b[0] - q[0], vz = b[1] - q[1];
      return (ux * vx + uz * vz) / ((Math.hypot(ux, uz) * Math.hypot(vx, vz)) || 1) < 0.985;
    });
    for (let i = 1; i < run.length; i++) {
      crossings.push({ ax: run[i - 1]![0], az: run[i - 1]![1], bx: run[i]![0], bz: run[i]![1], half: (num(f.properties.width_m) ?? 3) / 2, drawn: f.properties.drawn === true, signal: typeof f.properties.signal === "boolean" ? f.properties.signal : null, type: text(f.properties.crossing), markings: text(f.properties.markings) });
    }
  }
  const crossingBins = new Map<number, Crossing[]>();
  for (const c of crossings) {
    const lx = Math.min(c.ax, c.bx) - c.half, hx = Math.max(c.ax, c.bx) + c.half, lz = Math.min(c.az, c.bz) - c.half, hz = Math.max(c.az, c.bz) + c.half;
    for (let bz = Math.floor(lz / 16); bz <= Math.floor(hz / 16); bz++) for (let bx = Math.floor(lx / 16); bx <= Math.floor(hx / 16); bx++) {
      const k = binKey(bx, bz); if (!crossingBins.has(k)) crossingBins.set(k, []); crossingBins.get(k)!.push(c);
    }
  }
  const onCrossing = (x: number, z: number, margin: number): boolean => {
    for (let bz = Math.floor((z - margin) / 16); bz <= Math.floor((z + margin) / 16); bz++) for (let bx = Math.floor((x - margin) / 16); bx <= Math.floor((x + margin) / 16); bx++) {
      for (const c of crossingBins.get(binKey(bx, bz)) ?? []) {
        const ex = c.bx - c.ax, ez = c.bz - c.az, l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((x - c.ax) * ex + (z - c.az) * ez) / l2));
        if (Math.hypot(x - c.ax - ex * t, z - c.az - ez * t) < c.half + margin) return true;
      }
    }
    return false;
  };

  // Lots by their stalls.
  const stalls = read<{ lot: string; e: number; n: number; fe: number; fn: number }[]>(join(source, "base/stalls.json")) ?? [];
  const byLot = new Map<string, [number, number, number, number][]>();
  for (const s of stalls) {
    const [x, z] = toLattice(s.e, s.n); const [fx, fz] = toLattice(s.fe, s.fn);
    if (!byLot.has(s.lot)) byLot.set(s.lot, []); byLot.get(s.lot)!.push([x, z, fx, fz]);
  }
  const lots: Lot[] = [...byLot].map(([id, all]) => ({ id, x: all.reduce((t, q) => t + q[0], 0) / all.length, z: all.reduce((t, q) => t + q[1], 0) / all.length, stalls: all })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { segments, pieces, nodes, junction, nodeAt: (x, z) => at.get(nodeKey(x, z)), marked, crossings, onCrossing, lots, mapped: { points: controls !== null, tags } };
}

const graphs = new Map<string, StreetGraph>();
/** The street graph of a site, read once for each work folder. */
export function streetGraph(site: { source: string; toLattice: (e: number, n: number) => [number, number] }): StreetGraph {
  let g = graphs.get(site.source);
  if (!g) { g = readStreetGraph(site.source, site.toLattice); graphs.set(site.source, g); }
  return g;
}

/** Whether a junction of the street graph (three ways or more) is within `reach` of (x, z): where the ruins' walks end. */
export const junctionAt = (site: { source: string; toLattice: (e: number, n: number) => [number, number] }, x: number, z: number, reach: number): boolean => streetGraph(site).junction(x, z, reach);
