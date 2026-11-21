// The street's edge as bent sections (shared/world/bends.ts, planning/workstreams/bent-sections.md), where a map's rules
// ask for them (street.walks.bent) in place of the walk kit's 8 m slabs and right-angle returns (ruins.ts makeWalks).
// A thin layer over placeKerb, which takes a kerb line with stations and a section and gives pieces, laid on the street
// model's kerb lines (shared/world/streets.ts kerbLines) and each one's side's section:
//
// - every kerb line of a raised or worn kerb, a stretch's or a corner's arc, but on a type the rule leaves out (highway
//   and alley: their kerbs are flush, drawn by the ground alone), is a kerb line here, its stations the model's;
// - its kerb is the side's: raised or worn; its walk runs from the kerb's face to the walk's far edge where the walk
//   starts at the kerb (a verge of under half a metre is walk), and where a verge of half a metre or more lies between,
//   or the side has no walk (a pair's median), the kerb stands alone;
// - its seed is its stretch's, its wear its type's (the type's `wear` in the street rules), its panels the kerb's;
// - a line is laid where it stands on open ground: in the map, off water, off a bridge's deck and its way on, and clear of
//   what stands there already, where the ground behind its face is level with the road and the street no steeper than
//   one in eight; where the ground across its walk is not level, a way in to a building crosses it or something the city
//   set down stands on it, its kerb stands alone; a stretch's kerb that ends short of a corner's arc is drawn on to the arc's end, and an
//   end that meets no other kerb is let down to the road by a flare;
// - under every piece lie its collision pieces (underPiece); a piece and its collision go into the map as a whole or not;
// - the walk kit's storm drains and utility boxes stand on the straight lengths, as often as the kit has them.

import { BREAK_AT } from "../../content/ruins.ts";
import { bentJoin, bentKind, KERB_BACK, packBend, placeKerb, underPiece, wrapped, type BentKerb, type BentPiece, type Section } from "../../shared/world/bends.ts";
import { kerbLines, kerbOf, walkOf, type KerbLine as StreetKerb } from "../../shared/world/streets.ts";
import { S } from "./ground.ts";
import { binKey, hash3 } from "./raster.ts";
import { Mason } from "./ruin-geometry.ts";
import type { Box } from "./ruin-obstacles.ts";
import type { Vocabulary } from "./ruin-vocabulary.ts";
import type { roadIndex } from "./street-cars.ts";
import { streetRules, type StreetType, type Rule } from "./streets/rules.ts";
import type { Site, StaticPiece } from "./statics.ts";

/** The street types whose kerbs are not laid as pieces (`without`; highway and alley where it is not given). */
export interface BentRules { without?: string[] }

/** How long a flare from one kerb to another is, along it. */
const FLARE = 1.4;
/** About how long the walk kit's slots are, which its utility boxes are counted by. */
const SLOT = 8;
/** A walk's panels' length on a raised kerb and on a worn one. */
const PANEL = { raised: 1.5, worn: 1.2 } as const;
/** The most a stretch's kerb is drawn on to meet a corner's arc. */
const SNAP = 1.3;
/** The steepest street a kerb is laid along, its rise over its length. */
const STEEPEST = 0.125;
/** A verge narrower than this at the kerb is taken as walk, as the walk kit takes it (ruins.ts sectionRefuses). */
const VERGE_LEAST = 0.5;

/** A kerb line to lay: its points in the lattice's metres with their heights and stations, its walk's side and its section. */
interface Run { x: number[]; y: number[]; z: number[]; s: number[]; side: 1 | -1; section: Section; corner: boolean }

/** Lays the bent kerbs on the street model's kerb lines, and says how many of each kind of thing for the build's report. */
export function makeBentWalks(site: Site, v: Vocabulary, accept: (m: Mason) => boolean, way: (box: Box) => boolean, obstacles: { hits: (box: Box, gap?: number, skip?: (p: StaticPiece) => boolean) => boolean }, _roads: ReturnType<typeof roadIndex>, graded: ReadonlySet<number>, entrances: readonly { x: number; z: number; dx: number; dz: number; width: number }[]): Record<string, number> {
  const rules = v.street.walks!, bent = rules.bent!;
  const out: Record<string, number> = { pieces: 0, curved: 0, joins: 0, collision: 0, lines: 0, runs: 0, alone: 0, unlevel: 0, unlaid: 0, ways: 0, snapped: 0, ends: 0, refused: 0, blocked: 0, drains: 0, boxes: 0 };
  const held = site.ground.streets;
  if (!held) return out;
  let placing = 0;
  const laidIn: number[] = [];
  const { nx, x0, z0, x1, z1 } = site.ground.grid;
  const inside = (x: number, z: number): boolean => x >= x0 + 2 && x <= x1 - 2 && z >= z0 + 2 && z <= z1 - 2;
  const at = (x: number, z: number): number => Math.round((z1 - z) / 2) * nx + Math.round((x1 - x) / 2);
  const rubble = (p: StaticPiece): boolean => /_z(skirt1|skirt2|wedge)_/.test(p.kind);
  const onWay = (x: number, z: number): boolean => entrances.some((e) => {
    const along = (x - e.x) * e.dx + (z - e.z) * e.dz;
    return along > -24 && along < 12 && Math.abs((z - e.z) * e.dx - (x - e.x) * e.dz) < e.width / 2 + 1;
  });
  /** Whether a kerb may stand at lattice point (x, z): in the map, off water and off a bridge's deck and its way on. */
  const open = (x: number, z: number): boolean => {
    if (!inside(x, z)) return false;
    const i = at(x, z);
    return !site.ground.water[i] && !graded.has(i) && !onWay(x, z) && site.ground.surface[i] !== S.DEEP;
  };
  // The street rules' types by the index a stretch holds (streets/plan.ts), and each one's wear.
  const street = streetRules((v as { streets?: { types?: Record<string, StreetType>; rules?: Rule[] } }).streets ?? null);
  const types = Object.keys(street.types);
  const without = new Set(bent.without ?? ["highway", "alley"]);

  // Every kerb line of every part, as runs on open ground in the lattice's metres.
  const runs: Run[] = [];
  for (const part of held.parts()) for (const k of kerbLines(held, part)) {
    const type = types[k.type] ?? "";
    if (without.has(type)) continue;
    out.lines!++;
    const kerb = kerbOf(k.kinds) === 2 ? "worn" : "raised";
    const alone = walkOf(k.kinds) === 0 || k.verge >= VERGE_LEAST;
    if (alone) out.alone!++;
    const section: Section = { kerb, walk: alone ? 0 : k.verge + k.walk, panel: PANEL[kerb], seed: k.seed & 255, wear: street.types[type]?.section.wear ?? 0.4 };
    const side = walkSide(k, part.corners), n = k.stations.length;
    const kerbAlone: Section = { ...section, walk: 0 };
    let run: Run | null = null;
    for (let q = 0; q < n; q++) {
      const x = k.xz[q * 2]! + x0, z = k.xz[q * 2 + 1]! + z0;
      if (!open(x, z)) {
        run = null;
        continue;
      }
      // A kerb stands where the ground behind its face is level with the road and the street is no steeper than one in
      // eight; a walk stands level across, so where the ground across it rises or falls more than the walk kit's rule
      // allows, the kerb stands alone there and the ground's walk takes it up.
      const y = site.groundAt(x, z);
      const a = Math.max(0, q - 1), b = Math.min(n - 1, q + 1), ex = k.xz[b * 2]! - k.xz[a * 2]!, ez = k.xz[b * 2 + 1]! - k.xz[a * 2 + 1]!, l = Math.hypot(ex, ez) || 1;
      const nx = (-ez / l) * side, nz = (ex / l) * side;
      const steep = Math.abs(site.groundAt(k.xz[b * 2]! + x0, k.xz[b * 2 + 1]! + z0) - site.groundAt(k.xz[a * 2]! + x0, k.xz[a * 2 + 1]! + z0)) > l * STEEPEST;
      if (steep || Math.abs(site.groundAt(x + nx * 0.5, z + nz * 0.5) - y) > rules.flat) {
        out.unlaid!++;
        run = null;
        continue;
      }
      let here = section;
      if (section.walk > 0) for (const back of [section.walk / 2, section.walk]) if (Math.abs(site.groundAt(x + nx * back, z + nz * back) - y) > rules.flat) here = kerbAlone;
      if (run && run.section !== here) {
        // The two kerbs meet at this point: it ends the one and begins the other.
        const was: Run = run, last = was.x.length - 1;
        runs.push((run = { x: [was.x[last]!], y: [was.y[last]!], z: [was.z[last]!], s: [was.s[last]!], side, section: here, corner: k.corner >= 0 }));
        out.unlevel!++;
      }
      if (!run) runs.push((run = { x: [], y: [], z: [], s: [], side, section: here, corner: k.corner >= 0 }));
      run.x.push(x);
      run.y.push(y);
      run.z.push(z);
      run.s.push(k.stations[q]!);
    }
  }

  // A stretch's kerb is cut where a corner's fill covers it, at its last point a metre short of the arc's end at most: it
  // is drawn on to the arc's end where one is that near, ahead of it.
  const arcEnds = new Map<number, [number, number][]>();
  for (const r of runs) if (r.corner) for (const e of [0, r.x.length - 1]) {
    const key = binKey(Math.floor(r.x[e]! / 4), Math.floor(r.z[e]! / 4));
    (arcEnds.get(key) ?? arcEnds.set(key, []).get(key)!).push([r.x[e]!, r.z[e]!]);
  }
  const arcNear = (x: number, z: number, ux: number, uz: number): [number, number] | null => {
    for (let bz = Math.floor(z / 4) - 1; bz <= Math.floor(z / 4) + 1; bz++) for (let bx = Math.floor(x / 4) - 1; bx <= Math.floor(x / 4) + 1; bx++) {
      for (const [ax, az] of arcEnds.get(binKey(bx, bz)) ?? []) {
        const d = Math.hypot(ax - x, az - z);
        if (d > 0.02 && d < SNAP && ((ax - x) * ux + (az - z) * uz) / d > 0.95) return [ax, az];
      }
    }
    return null;
  };
  for (const r of runs) {
    if (r.corner || r.x.length < 2) continue;
    const n = r.x.length;
    const end = (k: number, prev: number, put: (x: number, z: number, s: number) => void): void => {
      const ex = r.x[k]! - r.x[prev]!, ez = r.z[k]! - r.z[prev]!, l = Math.hypot(ex, ez) || 1;
      const a = arcNear(r.x[k]!, r.z[k]!, ex / l, ez / l);
      if (!a) return;
      put(a[0], a[1], Math.hypot(a[0] - r.x[k]!, a[1] - r.z[k]!));
      out.snapped!++;
    };
    end(n - 1, n - 2, (x, z, d) => { r.x.push(x); r.y.push(site.groundAt(x, z)); r.z.push(z); r.s.push(r.s[n - 1]! + d); });
    end(0, 1, (x, z, d) => { r.x.unshift(x); r.y.unshift(site.groundAt(x, z)); r.z.unshift(z); r.s.unshift(r.s[0]! - d); });
  }

  // Each end that meets no other kerb's end is let down to the road.
  const ends = new Map<number, number>();
  const endKey = (x: number, z: number): number => binKey(Math.floor(x * 4), Math.floor(z * 4));
  for (const r of runs) if (r.x.length >= 2) for (const e of [0, r.x.length - 1]) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const key = binKey(Math.floor(r.x[e]! * 4) + dx, Math.floor(r.z[e]! * 4) + dz);
      ends.set(key, (ends.get(key) ?? 0) + 1);
    }
  }
  const alone = (x: number, z: number): boolean => (ends.get(endKey(x, z)) ?? 0) < 2;

  for (const r of runs) {
    if (r.x.length < 2) continue;
    out.runs!++;
    const t0 = performance.now();
    const pieces = placeKerb({ x: r.x, y: r.y, z: r.z, stations: r.s }, r.side, r.section);
    placing += performance.now() - t0;
    if (pieces.length === 0) continue;
    // The pieces run with the walk on their left: from the run's first point on side 1 and from its last on side -1.
    const [first, last] = r.side === 1 ? [0, r.x.length - 1] : [r.x.length - 1, 0];
    const kerb = pieces[0]!.kerb as BentKerb;
    if (kerb !== "median") {
      if (alone(r.x[first]!, r.z[first]!) && join(pieces, 0, "flush", kerb)) out.ends!++;
      if (alone(r.x[last]!, r.z[last]!) && join(pieces, pieces.length - 1, kerb, "flush")) out.ends!++;
    }
    // Where a way in to a building crosses a piece's walk, or something the city set down stands on it (a stair's foot,
    // a stoop, a column), its kerb stands alone, so the way in and what stands there meet the ground at its height.
    for (let q = 0; q < pieces.length; q++) {
      const p = pieces[q]!;
      if (p.bend.walk <= KERB_BACK + 0.01) continue;
      const box = walkBox(p, p.bend.walk);
      if (!way(box) && !obstacles.hits(box, -0.1, rubble)) continue;
      pieces[q] = { ...p, kind: bentKind("median", p.kind.endsWith("_c")), kerb: "median", bend: { ...p.bend, walk: KERB_BACK, panel: 0 } };
      out.ways!++;
    }
    // Runs of pieces clear of what stands there, each laid whole where the chunks' budgets let it, else a piece at a time.
    let group: BentPiece[] = [];
    const flush = (): void => {
      if (group.length > 0) fixtures(lay(group) ? group : group.filter((p) => lay([p])), r.section.seed);
      group = [];
    };
    for (const p of pieces) {
      if (blocked(p)) {
        out.blocked!++;
        flush();
      } else group.push(p);
    }
    flush();
  }
  // What placing took: kerb lines to pieces and their collision, for each chunk with some. Said, not kept in the report,
  // which a build must give the same each time.
  const chunks = new Set<number>(laidIn);
  console.log(`bent walks: ${out.pieces} pieces in ${chunks.size} chunks, placed in ${((placing * 1000) / Math.max(1, chunks.size)).toFixed(0)} us a chunk`);
  return out;

  /**
   * Whether a piece's kerb and the first of its walk meet what the city has set down there. What stands further back on a
   * walk (a stoop, a column, an awning's post) stands on it, as on a walk drawn by the ground.
   */
  function blocked(p: BentPiece): boolean {
    return obstacles.hits(walkBox(p, Math.max(KERB_BACK, Math.min(0.6, p.bend.walk))), -0.1, rubble);
  }

  /** The box of a piece's chord from its kerb's face `back` metres into its walk, at the kerb's height. */
  function walkBox(p: BentPiece, back: number): Box {
    const a = (p.yaw * Math.PI) / 180;
    return { x: p.x + (Math.sin(a) * back) / 2, y: p.y + 0.075, z: p.z + (Math.cos(a) * back) / 2, yaw: p.yaw, size: [p.bend.half * 2, 0.15, back] };
  }

  /**
   * The walk kit's storm drains and utility boxes on a run's straight lengths of raised or worn kerb with a walk, as the
   * kit has them: a drain in the gutter where it runs lowest, in one 32 m of the line in `gutterEvery`, and a box at the
   * walk's back about one 8 m in `boxEvery`. Each stands on its piece's chord, the kerb's face, at the piece's height there.
   */
  function fixtures(pieces: readonly BentPiece[], seed: number): void {
    let along = 0;
    pieces.forEach((p, k) => {
      const length = p.bend.half * 2, mid = along + length / 2;
      along += length;
      if (!/_(raised|worn)_s$/.test(p.kind) || length < 3 || p.bend.walk < 1) return;
      const before = pieces[k - 1]?.y ?? Infinity, after = pieces[k + 1]?.y ?? Infinity;
      if (p.y <= before && p.y <= after && hash3(seed, Math.floor(mid / 32), v.seed + 3) % rules.gutterEvery === 0 && fixture(p, "zdrain", 0, BREAK_AT.zdrain![2]!)) out.drains!++;
      // A box 2 m on from the middle where the piece is long enough, as the kit's is from its slab's.
      const d = length >= 6 ? 2 : 0;
      if (hash3(Math.round(p.x), Math.round(p.z), v.seed + 7) % rules.boxEvery < Math.max(1, Math.round(length / SLOT)) && fixture(p, "zutility", d, Math.min(p.bend.walk, 2.4) - 0.4)) out.boxes!++;
    });
  }

  /** A shape of the walk kit `d` along piece `p`'s chord from its middle and `back` from the kerb's face, at the chord's height there. */
  function fixture(p: BentPiece, shape: "zdrain" | "zutility", d: number, back: number): boolean {
    const a = (p.yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), mid = BREAK_AT[shape]!;
    const [x, z] = [p.x + c * d + s * back, p.z - s * d + c * back];
    const m = new Mason({ x: x + c * mid[0]!, z: z - s * mid[0]!, yaw: p.yaw, c, s, width: 8, depth: 3, rings: [] }, p.y + (p.bend.rise * d) / p.bend.half);
    m.put(shape, 0, mid[1]!, 0, "concrete");
    return accept(m);
  }

  /** Turns piece `k` of `pieces` into a flare from one kerb to another, cut down to FLARE long from its end; whether it did. */
  function join(pieces: BentPiece[], k: number, a: BentKerb, b: BentKerb): boolean {
    const p = pieces[k]!;
    if (p.kind.endsWith("_c") || a === "median" || b === "median") return false;
    // A flare to or from a flush kerb is walked as the flush kerb's ramp, which is lower than the raised kerb's box.
    const kind = bentJoin(a, b), kerb = a === "flush" || b === "flush" ? "flush" : p.kerb;
    out.joins!++;
    if (p.bend.half * 2 <= FLARE + 0.5) {
      pieces[k] = { ...p, kind, kerb };
      return true;
    }
    // The piece split: the flare at the end that meets the other kerb, the rest as it was.
    const cut = k === 0 ? FLARE : p.bend.half * 2 - FLARE;
    const [one, two] = splitStraight(p, cut);
    pieces.splice(k, 1, k === 0 ? { ...one, kind, kerb } : one, k === 0 ? two : { ...two, kind, kerb });
    return true;
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

/**
 * The side of a kerb line its walk is on, as placeKerb takes it (1 its left as its points run: a quarter turn from the
 * way it runs, from +x toward +z). A stretch's side 0 (its kerb at (-ez, ex) from its centre line) is placeKerb's 1; a
 * corner's walk lies inside its arc, toward its centre.
 */
function walkSide(k: StreetKerb, corners: readonly { cx: number; cz: number }[]): 1 | -1 {
  if (k.corner < 0) return k.side === 0 ? 1 : -1;
  const c = corners[k.corner]!, n = k.stations.length, m = n >> 1;
  const ex = k.xz[Math.min(n - 1, m + 1) * 2]! - k.xz[Math.max(0, m - 1) * 2]!, ez = k.xz[Math.min(n - 1, m + 1) * 2 + 1]! - k.xz[Math.max(0, m - 1) * 2 + 1]!;
  return -ez * (c.cx - k.xz[m * 2]!) + ex * (c.cz - k.xz[m * 2 + 1]!) > 0 ? 1 : -1;
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
