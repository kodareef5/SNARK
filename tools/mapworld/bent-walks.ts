// The street's edge as bent sections (shared/world/bends.ts, planning/workstreams/bent-sections.md), where a map's rules
// ask for them (street.walks.bent) in place of the walk kit's 8 m slabs and right-angle returns (ruins.ts makeWalks).
// A thin layer over placeKerb, which takes a kerb line with stations and a section and gives pieces: until the street
// model gives kerb lines (shared/world/streets.ts), they are made here from what the build knows.
//
// - Each walked street's kerb, on each side, is its centre line offset by its half width, mitred where it bends, and is
//   judged in slots along it as the walk kit's runs are (open, level ground at the walk's back, clear of the city's
//   pieces, of junctions, of a bridge's way on): walked, a drive or a crossing (cut, now flush), or bare. The slots are
//   as long as fits the room between the corners, about 8 m, so a run ends where it should.
// - Every corner corners.ts rounds, at any angle from 30 to 150 degrees, whose arc's ground is open and level and clear,
//   is an arc on the kerb's face tangent to both kerbs, and the runs of both kerbs begin at its ends.
// - Runs and arcs that meet end to end are one kerb line: its stations run on round the corner and its seed is one, so
//   the walk's panels and wear go on round it. A drive is a flush stretch, joined to the kerb either side by a flare; a
//   run that ends at a junction with no arc is let down to the road by one.
// - Under every piece lie its collision pieces (underPiece); a piece and its collision go into the map as a whole or not.

import { bentJoin, packBend, placeKerb, underPiece, wrapped, type BentKerb, type BentPiece, type Kerb, type KerbLine, type Section } from "../../shared/world/bends.ts";
import { cornersOf, type Corner } from "./corners.ts";
import { S } from "./ground.ts";
import { binKey, hash3 } from "./raster.ts";
import { Mason } from "./ruin-geometry.ts";
import type { Box } from "./ruin-obstacles.ts";
import type { Vocabulary } from "./ruin-vocabulary.ts";
import type { roadIndex } from "./street-cars.ts";
import { junctionAt, streetGraph } from "./street-graph.ts";
import type { Site, StaticPiece } from "./statics.ts";

/** A street class's bent kerb: its kerb, the widths its walk is chosen among by a hash, its panels and how worn it is. */
export interface BentSection { kerb: Kerb; walk: number[]; panel: number; wear: number }
export interface BentRules { sections: Record<string, BentSection> }

/** How long a flare from one kerb to another is, along it. */
const FLARE = 1.4;
/** The slots a kerb is judged in, about this long. */
const SLOT = 8;

/** A point of a kerb's face, and the way the kerb runs there. */
interface Point { x: number; y: number; z: number; dx: number; dz: number }
/** A stretch of kerb, its walk on its left as its points run: its points, its section, and its kerb at each end. */
interface Stretch { points: Point[]; section: Section; flush: boolean; rampStart: boolean; rampEnd: boolean; arc: boolean }

/** Lays the bent kerbs, and says how many of each kind of thing for the build's report. */
export function makeBentWalks(site: Site, v: Vocabulary, accept: (m: Mason) => boolean, way: (box: Box) => boolean, obstacles: { hits: (box: Box, gap?: number, skip?: (p: StaticPiece) => boolean) => boolean }, roads: ReturnType<typeof roadIndex>, graded: ReadonlySet<number>, entrances: readonly { x: number; z: number; dx: number; dz: number; width: number }[]): Record<string, number> {
  const rules = v.street.walks!; const bent = rules.bent!;
  let placing = 0;
  const laidIn: number[] = [];
  const out: Record<string, number> = { pieces: 0, curved: 0, joins: 0, collision: 0, arcs: 0, runs: 0, flush: 0, refused: 0, lines: 0 };
  const { nx, x0, z0, x1, z1 } = site.ground.grid;
  // The map's streets reach past its edges; what lies within a sample of them is laid.
  const inside = (x: number, z: number, margin = 2): boolean => x >= x0 + margin && x <= x1 - margin && z >= z0 + margin && z <= z1 - margin;
  const at = (x: number, z: number): number => Math.round((z1 - z) / 2) * nx + Math.round((x1 - x) / 2);
  const open = new Set<number>([S.OPEN, S.GREEN, S.CANOPY, S.YARD, S.DESERT, S.SIDEWALK]);
  const road = new Set<number>([S.STREET, S.HIGHWAY, S.CROSSWALK]);
  const rubble = (p: StaticPiece): boolean => /_z(skirt1|skirt2|wedge)_/.test(p.kind);
  const onWay = (x: number, z: number): boolean => entrances.some((e) => {
    const along = (x - e.x) * e.dx + (z - e.z) * e.dz;
    return along > -24 && along < 12 && Math.abs((z - e.z) * e.dx - (x - e.x) * e.dz) < e.width / 2 + 1;
  });
  const graph = streetGraph(site);
  const sectionOf = (mtfcc: string): BentSection | undefined => bent.sections[mtfcc];
  /** Whether a kerb's walk may stand at (x, z), `back` metres behind its face: ground open, or road under its face, level with `y`. */
  const ground = (x: number, z: number, back: number, y: number): "ok" | "ground" | "slope" | "bridge" => {
    const i = at(x, z), surface = site.ground.surface[i]!;
    if (site.ground.water[i] || !(open.has(surface) || (back < 1 && road.has(surface)))) return "ground";
    if (Math.abs(site.groundAt(x, z) - y) > rules.flat) return "slope";
    return graded.has(i) || onWay(x, z) ? "bridge" : "ok";
  };

  // The corners' arcs first, each tangent to both kerbs, and where each run begins: by the node, the line, the way out of
  // the node it runs (its sense) and whether the corner turns from it or to it.
  const stretches: Stretch[] = [];
  const begins = new Map<string, number>();
  const beginKey = (node: number, line: number, sense: number, from: boolean): string => `${node}|${line}|${sense}|${from ? "a" : "b"}`;
  const senseOf = (n: { ways: readonly { line: number; dx: number; dz: number; sense: number }[] } | undefined, arm: { line: number; dx: number; dz: number }): number =>
    n?.ways.find((w) => w.line === arm.line && w.dx * arm.dx + w.dz * arm.dz > 0.999)?.sense ?? 0;
  for (const c of rules.returns ? cornersOf(site, rules.returns) : []) {
    const sa = sectionOf(graph.pieces[c.a.line]!.mtfcc), sb = sectionOf(graph.pieces[c.b.line]!.mtfcc);
    if ((!sa && !sb) || !inside(c.px, c.pz, 12)) continue;
    const arc = arcOf(c);
    if (!arc) continue;
    const section = sectionFor(sa ?? sb!, c.a.line, v.seed);
    // Its ground, as a return's: open or painted road under its face, level within the walks' rule, clear of the city.
    const ys = arc.points.map((p) => site.groundAt(p.x, p.z));
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    let why = y < 0.1 ? "low" : "";
    for (let k = 0; k < arc.points.length && !why; k += 2) {
      const p = arc.points[k]!;
      for (const back of [0.3, section.walk]) {
        const w = ground(p.x - arc.out[k]![0] * back, p.z - arc.out[k]![1] * back, back, ys[k]!);
        if (w !== "ok") why = w;
      }
    }
    for (let k = 0; k + 1 < arc.points.length && !why; k++) {
      const a = arc.points[k]!, b = arc.points[k + 1]!, mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const o = arc.out[k]!, back = section.walk / 2;
      const box: Box = { x: mid.x - o[0] * back, y: ys[k]! + 0.075, z: mid.z - o[1] * back, yaw: (Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI - 90, size: [Math.hypot(b.x - a.x, b.z - a.z), 0.15, section.walk] };
      if (obstacles.hits(box, -0.1, rubble) || way(box)) why = "piece";
    }
    if (why) {
      out[`arcRefused_${why}`] = (out[`arcRefused_${why}`] ?? 0) + 1;
      continue;
    }
    out.arcs!++;
    // From its end on b's kerb to its end on a's, which puts its walk, inside it, on its left.
    const points = arc.points.map((p, k) => ({ x: p.x, y: ys[k]!, z: p.z, dx: -arc.way[k]![0], dz: -arc.way[k]![1] })).reverse();
    stretches.push({ points, section, flush: false, rampStart: false, rampEnd: false, arc: true });
    const n = graph.nodeAt(c.x, c.z);
    begins.set(beginKey(n?.key ?? 0, c.a.line, senseOf(n, c.a), true), arc.alongA);
    begins.set(beginKey(n?.key ?? 0, c.b.line, senseOf(n, c.b), false), arc.alongB);
  }

  // Each walked line's kerbs, judged in slots along their faces.
  const lines = new Map<number, typeof roads.segments>();
  for (const s of roads.segments) if (bent.sections[s.mtfcc]) (lines.get(s.line) ?? lines.set(s.line, []).get(s.line)!).push(s);
  for (const [line, all] of lines) {
    if (!all.some((s) => inside(s.ax, s.az, -40) || inside(s.bx, s.bz, -40))) continue;
    // Its runs of segments end to end.
    const runs: (typeof all)[] = [];
    for (const s of all) {
      const last = runs.at(-1)?.at(-1);
      if (last && Math.hypot(last.bx - s.ax, last.bz - s.az) < 0.01) runs.at(-1)!.push(s);
      else runs.push([s]);
    }
    const kerb = sectionFor(bent.sections[all[0]!.mtfcc]!, line, v.seed);
    for (const segs of runs) for (const side of [1, -1] as const) {
      const face = kerbFace(segs, side);
      if (face.length < 2) continue;
      // Where the run may begin and end: at a corner's arc, else short of a junction.
      const first = segs[0]!, last = segs.at(-1)!;
      const nodeA = graph.nodeAt(first.ax, first.az), nodeB = graph.nodeAt(last.bx, last.bz);
      // The side a corner of the first way out turns from is its counter-clockwise side, the side +1 here.
      const from = nodeA ? begins.get(beginKey(nodeA.key, line, 1, side === 1)) : undefined;
      const to = nodeB ? begins.get(beginKey(nodeB.key, line, -1, side === -1)) : undefined;
      const total = face.at(-1)!.s;
      const s0 = from ?? 0, s1 = to === undefined ? total : total - to;
      if (s1 - s0 < 1) continue;
      const count = Math.max(1, Math.round((s1 - s0) / SLOT)), len = (s1 - s0) / count;
      type Slot = "walk" | "flush" | "bare" | "junction" | "off";
      const slots: Slot[] = [];
      for (let k = 0; k < count; k++) {
        const a = s0 + k * len, b = a + len, mid = (a + b) / 2;
        const p = pointAt(face, mid);
        if (!inside(pointAt(face, a).x, pointAt(face, a).z, kerb.walk + 1) || !inside(pointAt(face, b).x, pointAt(face, b).z, kerb.walk + 1)) {
          slots.push("off");
          continue;
        }
        const y = site.groundAt(p.x, p.z);
        // Clear of a junction no arc turns, as the walk kit is: its middle on the centre line.
        const half = first.half;
        if ((from === undefined || mid > total / 2) && (to === undefined || mid < total / 2) && junctionAt(site, p.x - p.nx * half, p.z - p.nz * half, half + rules.fromJunction)) {
          slots.push("junction");
          continue;
        }
        let state: Slot = y < 0.1 ? "bare" : "walk";
        for (const along of [a + 0.2, mid, b - 0.2]) {
          const q = pointAt(face, along);
          for (const back of [0.3, kerb.walk]) if (state === "walk" && ground(q.x + q.nx * back, q.z + q.nz * back, back, y) !== "ok") state = "bare";
        }
        // A crossing over the road or a way in to a building meets the kerb here: it is let down flush for it.
        for (let d = a; d <= b && state === "walk"; d += 1) {
          const q = pointAt(face, d);
          if (graph.onCrossing(q.x + q.nx * 0.3, q.z + q.nz * 0.3, 0)) state = "flush";
        }
        const box: Box = { x: p.x + p.nx * kerb.walk / 2, y: y + 0.075, z: p.z + p.nz * kerb.walk / 2, yaw: (Math.atan2(p.dx, p.dz) * 180) / Math.PI - 90, size: [len, 0.15, kerb.walk] };
        if (state === "walk" && way(box)) state = "flush";
        if (state !== "bare" && obstacles.hits(box, -0.1, rubble)) state = "bare";
        slots.push(state);
      }
      // Runs of slots alike, each a stretch; walked stretches next to a junction let down to the road at that end.
      for (let k = 0; k < count; ) {
        let e = k;
        while (e + 1 < count && slots[e + 1] === slots[k]) e++;
        const state = slots[k]!;
        if (state === "walk" || state === "flush") {
          const a = s0 + k * len, b = s0 + (e + 1) * len;
          const points = slice(face, a, b).map((p) => ({ x: p.x, y: site.groundAt(p.x, p.z), z: p.z, dx: side === 1 ? p.dx : -p.dx, dz: side === 1 ? p.dz : -p.dz }));
          // Walk on the left as the points run: the face runs with the line on side 1 and against it on side -1.
          if (side === -1) points.reverse();
          const flush = state === "flush";
          const rampA = !flush && slots[k - 1] === "junction", rampB = !flush && slots[e + 1] === "junction";
          stretches.push({ points, section: flush ? { ...kerb, kerb: "flush" } : kerb, flush, rampStart: side === 1 ? rampA : rampB, rampEnd: side === 1 ? rampB : rampA, arc: false });
          out[flush ? "flush" : "runs"]!++;
        } else if (state !== "off") out[`slots_${state}`] = (out[`slots_${state}`] ?? 0) + e - k + 1;
        k = e + 1;
      }
    }
  }

  // Stretches end to end are one kerb line, in its order: each one's next is the one that begins within 3 cm of where it ends.
  const startsAt = new Map<number, number[]>();
  stretches.forEach((s, i) => {
    const p = s.points[0]!, k = binKey(Math.floor(p.x), Math.floor(p.z));
    (startsAt.get(k) ?? startsAt.set(k, []).get(k)!).push(i);
  });
  const next = stretches.map((s, i) => {
    const e = s.points.at(-1)!;
    for (let bz = Math.floor(e.z) - 1; bz <= Math.floor(e.z) + 1; bz++) for (let bx = Math.floor(e.x) - 1; bx <= Math.floor(e.x) + 1; bx++) {
      for (const j of startsAt.get(binKey(bx, bz)) ?? []) if (j !== i && Math.hypot(stretches[j]!.points[0]!.x - e.x, stretches[j]!.points[0]!.z - e.z) < 0.03) return j;
    }
    return -1;
  });
  const hasPrev = new Uint8Array(stretches.length);
  for (const n of next) if (n >= 0) hasPrev[n] = 1;
  const done = new Uint8Array(stretches.length);
  const chains: number[][] = [];
  for (const pass of [0, 1]) for (let i = 0; i < stretches.length; i++) {
    // First those with nothing before them, then the loops round a block.
    if (done[i] || (pass === 0 && hasPrev[i])) continue;
    const chain: number[] = [];
    for (let k = i; k >= 0 && !done[k]; k = next[k]!) {
      done[k] = 1;
      chain.push(k);
    }
    chains.push(chain);
  }
  for (const chain of chains) {
    out.lines!++;
    const head = stretches[chain[0]!]!.points[0]!;
    // One seed and wear down the line, and its stations from a place its own.
    const seed = hash3(Math.round(head.x * 4), Math.round(head.z * 4), v.seed) & 255;
    let station = (hash3(Math.round(head.z * 4), Math.round(head.x * 4), v.seed + 1) % 6000) / 10;
    let before: BentKerb | null = null;
    const laid: BentPiece[] = [];
    // An arc takes the kerb of the stretch before it, or after it at the line's head.
    const kerbAt = (k: number): Section => {
      const s = stretches[chain[k]!]!;
      if (!s.arc) return s.section;
      const near = stretches[chain[k - 1] ?? chain[k + 1] ?? chain[k]!]!;
      return near.arc || near.flush ? s.section : { ...s.section, kerb: near.section.kerb, walk: Math.min(near.section.walk, s.section.walk) };
    };
    chain.forEach((index, k) => {
      const s = stretches[index]!;
      const section: Section = { ...kerbAt(k), seed, wear: stretches[chain[0]!]!.section.wear };
      const line: KerbLine = { x: s.points.map((p) => p.x), y: s.points.map((p) => p.y), z: s.points.map((p) => p.z), dx: s.points.map((p) => p.dx), dz: s.points.map((p) => p.dz) };
      const t0 = performance.now();
      const pieces = placeKerb(line, 1, section, station);
      placing += performance.now() - t0;
      station += lengthOf(s.points);
      const kerb = (pieces[0]?.kerb ?? section.kerb) as BentKerb;
      // A flare from the kerb before to this one, as its first piece; a ramp down at a run's end with no arc.
      if (before !== null && before !== kerb && pieces.length > 0 && !s.arc) join(pieces, 0, before, kerb);
      if (s.rampStart && pieces.length > 0 && kerb !== "flush") join(pieces, 0, "flush", kerb);
      if (s.rampEnd && pieces.length > 0 && kerb !== "flush") join(pieces, pieces.length - 1, kerb, "flush");
      before = (pieces.at(-1)?.kind.endsWith("_flush") ? "flush" : kerb);
      laid.push(...pieces);
    });
    // The line's pieces and then their collision, so that a statics part's rows that follow one another are alike and pack
    // small; where the chunks' budgets refuse the line whole, a piece at a time.
    if (!lay(laid)) for (const p of laid) lay([p]);
  }
  // What placing took, the street model's part to come: kerb lines to pieces and their collision, for each chunk with some.
  // Said, not kept in the report, which a build must give the same each time.
  const chunks = new Set<number>(laidIn);
  console.log(`bent walks: ${out.pieces} pieces in ${chunks.size} chunks, placed in ${((placing * 1000) / Math.max(1, chunks.size)).toFixed(0)} us a chunk`);
  return out;

  /** Turns piece `k` of `pieces` into a flare from one kerb to another where the kit has one, cut down to FLARE long from its end. */
  function join(pieces: BentPiece[], k: number, a: BentKerb, b: BentKerb): void {
    const p = pieces[k]!;
    if (p.kind.endsWith("_c") || a === "median" || b === "median") return;
    // A flare to or from a flush kerb is walked as the flush kerb's ramp, which is lower than the raised kerb's box.
    const kind = bentJoin(a, b), kerb = a === "flush" || b === "flush" ? "flush" : p.kerb;
    if (p.bend.half * 2 <= FLARE + 0.5) {
      pieces[k] = { ...p, kind, kerb };
      out.joins!++;
      return;
    }
    // The piece split: the flare at the end that meets the other kerb, the rest as it was.
    const at = k === 0 ? FLARE : p.bend.half * 2 - FLARE;
    const [first, second] = splitStraight(p, at);
    pieces.splice(k, 1, k === 0 ? { ...first, kind, kerb } : first, k === 0 ? second : { ...second, kind, kerb });
    out.joins!++;
  }

  /** Sets pieces down with their collision, all of them or none; whether they were. */
  function lay(pieces: readonly BentPiece[]): boolean {
    if (pieces.length === 0) return true;
    const m = new Mason({ x: pieces[0]!.x, z: pieces[0]!.z, yaw: pieces[0]!.yaw, c: 1, s: 0, width: 0, depth: 0, rings: [] }, pieces[0]!.y);
    const bend = new Int16Array(8);
    for (const p of pieces) {
      packBend(bend, 0, p.bend);
      m.pieces.push({ kind: p.kind, x: p.x, y: p.y, z: p.z, yaw: p.yaw, bend: Array.from(bend) });
    }
    const t0 = performance.now();
    const hits = pieces.flatMap(underPiece);
    placing += performance.now() - t0;
    for (const h of hits) m.pieces.push(h);
    if (!accept(m)) {
      if (pieces.length === 1) out.refused!++;
      return false;
    }
    out.pieces! += pieces.length;
    for (const p of pieces) {
      laidIn.push(Math.floor(p.x / 64) * 4096 + Math.floor(p.z / 64));
      if (p.kind.endsWith("_c")) out.curved!++;
    }
    out.collision! += hits.length;
    return true;
  }
}

/** The walk's widths and kerb of a street of `line`, chosen by a hash. */
function sectionFor(b: BentSection, line: number, seed: number): Section {
  return { kerb: b.kerb, walk: b.walk[hash3(line, 17, seed) % b.walk.length]!, panel: b.panel, seed: 0, wear: b.wear };
}

/** A point of a kerb's face and how far along it is, the way it runs and the way into its walk. */
interface FacePoint { x: number; z: number; s: number; dx: number; dz: number; nx: number; nz: number }

/** A line's kerb's face on `side` (1 its left as drawn, as the walk kit's yaw has it): its centre line offset by its half width, mitred at each bend. */
function kerbFace(segs: readonly { ax: number; az: number; bx: number; bz: number; half: number }[], side: 1 | -1): FacePoint[] {
  const out: FacePoint[] = [];
  const dir = segs.map((s) => {
    const l = Math.hypot(s.bx - s.ax, s.bz - s.az);
    return [(s.bx - s.ax) / l, (s.bz - s.az) / l] as const;
  });
  for (let k = 0; k <= segs.length; k++) {
    const a = dir[Math.max(0, k - 1)]!, b = dir[Math.min(segs.length - 1, k)]!;
    let [dx, dz] = [a[0] + b[0], a[1] + b[1]];
    const l = Math.hypot(dx, dz) || 1;
    [dx, dz] = [dx / l, dz / l];
    // Away from the road on this side, as the walk kit lays it: the way turned a quarter, clockwise for side 1.
    const [nx, nz] = [-dz * side, dx * side];
    const cos = Math.max(0.3, nx * -b[1] * side + nz * b[0] * side);
    const half = segs[Math.min(segs.length - 1, k)]!.half;
    const [cx, cz] = k < segs.length ? [segs[k]!.ax, segs[k]!.az] : [segs[k - 1]!.bx, segs[k - 1]!.bz];
    const x = cx + (nx * half) / cos, z = cz + (nz * half) / cos;
    const s = out.length > 0 ? out.at(-1)!.s + Math.hypot(x - out.at(-1)!.x, z - out.at(-1)!.z) : 0;
    out.push({ x, z, s, dx, dz, nx, nz });
  }
  return out;
}

/** The face at `s` along it, between its points. */
function pointAt(face: readonly FacePoint[], s: number): FacePoint {
  let k = 1;
  while (k < face.length - 1 && face[k]!.s < s) k++;
  const a = face[k - 1]!, b = face[k]!, t = b.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s))) : 0;
  const ex = b.x - a.x, ez = b.z - a.z, l = Math.hypot(ex, ez) || 1;
  return { x: a.x + ex * t, z: a.z + ez * t, s, dx: ex / l, dz: ez / l, nx: a.nx + (b.nx - a.nx) * t, nz: a.nz + (b.nz - a.nz) * t };
}

/** The face from `a` to `b` along it: its ends and its points between. */
function slice(face: readonly FacePoint[], a: number, b: number): FacePoint[] {
  return [pointAt(face, a), ...face.filter((p) => p.s > a + 0.05 && p.s < b - 0.05), pointAt(face, b)];
}

function lengthOf(points: readonly Point[]): number {
  let l = 0;
  for (let k = 1; k < points.length; k++) l += Math.hypot(points[k]!.x - points[k - 1]!.x, points[k]!.z - points[k - 1]!.z);
  return l;
}

/**
 * A corner's arc on the kerb's face, tangent to both kerbs at the radius corners.ts gave it: its points from its end on
 * a's kerb to its end on b's, a quarter metre apart or less, with the way out to the road at each, and how far along
 * each way from the junction its ends are. Its walk lies inside it, on its right as it runs.
 */
function arcOf(c: Corner): { points: { x: number; z: number }[]; out: [number, number][]; way: [number, number][]; alongA: number; alongB: number } | null {
  const half = c.angle / 2, tan = Math.tan(half);
  if (!(tan > 0.05)) return null;
  const ul = Math.hypot(c.a.dx + c.b.dx, c.a.dz + c.b.dz), ux = (c.a.dx + c.b.dx) / ul, uz = (c.a.dz + c.b.dz) / ul;
  const t = c.radius / tan, reach = c.radius / Math.sin(half);
  const cx = c.px + reach * ux, cz = c.pz + reach * uz;
  const ax = c.px + c.a.dx * t, az = c.pz + c.a.dz * t, bx = c.px + c.b.dx * t, bz = c.pz + c.b.dz * t;
  const a0 = Math.atan2(az - cz, ax - cx);
  let sweep = Math.atan2(bz - cz, bx - cx) - a0;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const n = Math.max(2, Math.ceil((Math.abs(sweep) * c.radius) / 0.25));
  const points: { x: number; z: number }[] = [], out: [number, number][] = [], way: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + (sweep * k) / n;
    points.push({ x: cx + c.radius * Math.cos(a), z: cz + c.radius * Math.sin(a) });
    out.push([Math.cos(a), Math.sin(a)]);
    way.push([-Math.sin(a) * Math.sign(sweep), Math.cos(a) * Math.sign(sweep)]);
  }
  return { points, out, way, alongA: (ax - c.x) * c.a.dx + (az - c.z) * c.a.dz, alongB: (bx - c.x) * c.b.dx + (bz - c.z) * c.b.dz };
}

/** A straight piece cut in two `at` metres from its start, each a straight on the same chord. */
function splitStraight(p: BentPiece, at: number): [BentPiece, BentPiece] {
  const b = p.bend, a = (p.yaw * Math.PI) / 180, cx = Math.cos(a), cz = -Math.sin(a), L = b.half * 2;
  const sx = p.x - cx * b.half, sz = p.z - cz * b.half;
  const make = (from: number, to: number, turn0: number, turn1: number): BentPiece => {
    const mid = (from + to) / 2;
    return { ...p, x: sx + cx * mid, z: sz + cz * mid, y: p.y + b.rise * ((2 * mid) / L - 1), bend: { ...b, half: (to - from) / 2, turn0, turn1, station: wrapped(b.station + from), rise: (b.rise * (to - from)) / L } };
  };
  return [make(0, at, b.turn0, 0), make(at, L, 0, b.turn1)];
}

