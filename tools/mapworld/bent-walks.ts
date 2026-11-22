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
// - a line is laid where it stands on open ground: in the map, off water, off a bridge's deck and its way on, where the
//   ground behind its face is level with the road and the street no steeper than one in eight; where the ground across
//   its walk is not level, its kerb stands alone. Each is judged over a run of points, not one at a time: a stretch that
//   fails for under FILL metres between two that pass is laid on, and one that passes for under ISLAND between two that
//   fail is not, so a kerb on ground that sits on the line is not laid in dashes;
// - where the line's stretch is dropped (kerbLines' drops: a crossing, a drive, a corner's ramp), its kerb is let down
//   flush there by a flare at each end;
// - an end of a kerb that meets no other kerb's end is let down to the road by a flare, and an end of a walk that meets no
//   other walk's end is let down to the ground over its last SINK_LENGTH (bends.ts sink), so no walk ends in a step;
// - a way in to a building crosses a walk as it crosses the ground; what the city set down on a walk is cut round where it
//   stands CUT_ROUND or more behind the kerb's face (the piece's walk ends at it, the piece split so only its length is),
//   and stands on the walk where it is nearer; a piece whose kerb and first 0.6 m of walk meet it is left out;
// - under every piece lie its collision pieces (underPiece), which the map does not store but makes again from the bends
//   where it is read (mapfile.ts); a piece and its collision go into the build's list as a whole or not;
// - the walk kit's storm drains and utility boxes stand on the straight lengths, as often as the kit has them.

import { BREAK_AT } from "../../content/ruins.ts";
import { SINK_LENGTH, bentJoin, bentKind, HIT_PREFIX, KERB_BACK, packBend, placeKerb, underPiece, wrapped, type BentKerb, type BentPiece, type Section } from "../../shared/world/bends.ts";
import { DROP_CROSSING, DROP_RAMP, kerbLines, kerbOf, walkOf, type KerbLine as StreetKerb } from "../../shared/world/streets.ts";
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
/** A stretch of a line failing a level test for under FILL metres between two that pass is laid on; one passing for under ISLAND between two that fail is not. */
const FILL = 3, ISLAND = 2;
/** How far short of a corner's centre its walk ends at most. */
const CORNER_INSIDE = 0.3;
/** What stands on a walk this far or more behind the kerb's face is cut round; what stands nearer stands on the walk. */
const CUT_ROUND = 1;
/** The least walk a piece is cut down to round what stands on it, from the kerb's face, and how far short of it it stops. */
const CUT_LEAST = KERB_BACK + 0.6, CUT_SHORT = 0.05;

/**
 * A kerb line to lay: its points in the lattice's metres with their heights and stations, its walk's side, its section and
 * its drops; and its stretches by station, made once its points are final (spansOf).
 */
interface Run { x: number[]; y: number[]; z: number[]; s: number[]; side: 1 | -1; section: Section; corner: boolean; drops: number[]; spans?: DropSpan[] }

/** A point of a line: off open ground, not level, its kerb alone (its walk not level), its kerb and walk. */
const OFF = 0, UNLEVEL = 1, ALONE = 2, WALKED = 3;

/** Lays the bent kerbs on the street model's kerb lines, and says how many of each kind of thing for the build's report. */
export function makeBentWalks(site: Site, v: Vocabulary, accept: (m: Mason) => boolean, way: (box: Box) => boolean, obstacles: { hits: (box: Box, gap?: number, skip?: (p: StaticPiece) => boolean) => boolean; meeting: (box: Box, gap?: number, skip?: (p: StaticPiece) => boolean) => { p: StaticPiece; box: Box }[] }, _roads: ReturnType<typeof roadIndex>, graded: ReadonlySet<number>, entrances: readonly { x: number; z: number; dx: number; dz: number; width: number }[]): Record<string, number> {
  const rules = v.street.walks!, bent = rules.bent || {};
  const out: Record<string, number> = { pieces: 0, curved: 0, joins: 0, collision: 0, lines: 0, runs: 0, alone: 0, unlevel: 0, unlaid: 0, filled: 0, snapped: 0, ends: 0, sunk: 0, ledges: 0, dropped: 0, droppedMetres: 0, narrowed: 0, standing: 0, refused: 0, blocked: 0, drains: 0, boxes: 0 };
  const held = site.ground.streets;
  if (!held) return out;
  let placing = 0;
  const began = performance.now();
  const laidIn: number[] = [];
  /** What stands on the walks, by the start of its kind: cut round, or standing on the walk. */
  const standing = new Map<string, number>();
  const { nx, x0, z0, x1, z1 } = site.ground.grid;
  const inside = (x: number, z: number): boolean => x >= x0 + 2 && x <= x1 - 2 && z >= z0 + 2 && z <= z1 - 2;
  const at = (x: number, z: number): number => Math.round((z1 - z) / 2) * nx + Math.round((x1 - x) / 2);
  // Rubble is not what stands on a kerb or a walk, nor another kerb's collision what stands on a walk.
  const rubble = (p: StaticPiece): boolean => /_z(skirt1|skirt2|wedge)_/.test(p.kind);
  const passed = (p: StaticPiece): boolean => rubble(p) || p.kind.startsWith(HIT_PREFIX);
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
    // A corner's walk lies inside its arc: no wider than its radius less a little, or it folds over itself round the
    // arc's centre (a downtown walk of 8.5 m round a corner of 4 m).
    const most = k.corner >= 0 ? Math.max(KERB_BACK + 0.6, part.corners[k.corner]!.radius - CORNER_INSIDE) : Infinity;
    const section: Section = { kerb, walk: alone ? 0 : Math.min(most, k.verge + k.walk), panel: PANEL[kerb], seed: k.seed & 255, wear: street.types[type]?.section.wear ?? 0.4 };
    const side = walkSide(k, part.corners), n = k.stations.length;
    const kerbAlone: Section = { ...section, walk: 0 };
    // Each point's state, then judged over the line.
    const state = new Uint8Array(n), ys = new Float64Array(n);
    for (let q = 0; q < n; q++) {
      const x = k.xz[q * 2]! + x0, z = k.xz[q * 2 + 1]! + z0;
      if (!open(x, z)) continue;
      // A kerb stands where the ground behind its face is level with the road and the street is no steeper than one in
      // eight; a walk stands level across, so where the ground across it rises or falls more than the walk kit's rule
      // allows, the kerb stands alone there and the ground's walk takes it up.
      const y = (ys[q] = site.groundAt(x, z));
      const a = Math.max(0, q - 1), b = Math.min(n - 1, q + 1), ex = k.xz[b * 2]! - k.xz[a * 2]!, ez = k.xz[b * 2 + 1]! - k.xz[a * 2 + 1]!, l = Math.hypot(ex, ez) || 1;
      const nx = (-ez / l) * side, nz = (ex / l) * side;
      const steep = Math.abs(site.groundAt(k.xz[b * 2]! + x0, k.xz[b * 2 + 1]! + z0) - site.groundAt(k.xz[a * 2]! + x0, k.xz[a * 2 + 1]! + z0)) > l * STEEPEST;
      if (steep || Math.abs(site.groundAt(x + nx * 0.5, z + nz * 0.5) - y) > rules.flat) {
        state[q] = UNLEVEL;
        continue;
      }
      state[q] = WALKED;
      if (section.walk > 0) for (const back of [section.walk / 2, section.walk]) if (Math.abs(site.groundAt(x + nx * back, z + nz * back) - y) > rules.flat) state[q] = ALONE;
    }
    out.filled! += judged(state, k.stations);
    let run: Run | null = null;
    for (let q = 0; q < n; q++) {
      if (state[q]! < ALONE) {
        if (state[q] === UNLEVEL) out.unlaid!++;
        run = null;
        continue;
      }
      const here = state[q] === ALONE || section.walk === 0 ? kerbAlone : section;
      const x = k.xz[q * 2]! + x0, z = k.xz[q * 2 + 1]! + z0;
      if (run && run.section !== here) {
        // The two kerbs meet at this point: it ends the one and begins the other.
        const was: Run = run, last = was.x.length - 1;
        runs.push((run = { x: [was.x[last]!], y: [was.y[last]!], z: [was.z[last]!], s: [was.s[last]!], side, section: here, corner: k.corner >= 0, drops: k.drops ? Array.from(k.drops) : [] }));
        out.unlevel!++;
      }
      if (!run) runs.push((run = { x: [], y: [], z: [], s: [], side, section: here, corner: k.corner >= 0, drops: k.drops ? Array.from(k.drops) : [] }));
      run.x.push(x);
      run.y.push(ys[q]!);
      run.z.push(z);
      run.s.push(k.stations[q]!);
    }
  }

  // A stretch's kerb is cut where a corner's fill covers it, at its last point a metre short of the arc's end at most: it
  // is drawn on to the arc's end where one is that near, ahead of it. The street model's lines meet their arcs end to end
  // (kerbLines), so this is for what the ground's tests cut short of an arc.
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

  // Each run's ends by where they stand: how many kerbs end there, how many of them with a walk, and how many let down flush.
  const ends = new Map<number, { kerbs: number; walks: number; flush: number }>();
  const endKey = (x: number, z: number): number => binKey(Math.floor(x * 4), Math.floor(z * 4));
  const flushAt = (r: Run, s: number): boolean => r.section.walk > 0 && spansOf(r).some((sp) => sp.how === "flush" && s >= sp.a - 0.01 && s <= sp.b + 0.01);
  for (const r of runs) if (r.x.length >= 2) for (const e of [0, r.x.length - 1]) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const key = binKey(Math.floor(r.x[e]! * 4) + dx, Math.floor(r.z[e]! * 4) + dz);
      const got = ends.get(key) ?? { kerbs: 0, walks: 0, flush: 0 };
      got.kerbs++;
      if (r.section.walk > 0) got.walks++;
      if (flushAt(r, r.s[e]!)) got.flush++;
      ends.set(key, got);
    }
  }
  const endOf = (x: number, z: number): { kerbs: number; walks: number; flush: number } => ends.get(endKey(x, z)) ?? { kerbs: 0, walks: 0, flush: 0 };

  for (const r of runs) {
    if (r.x.length < 2) continue;
    out.runs!++;
    const t0 = performance.now();
    const pieces = placeRun(r);
    placing += performance.now() - t0;
    if (pieces.length === 0) continue;
    // The pieces run with the walk on their left: from the run's first point on side 1 and from its last on side -1.
    const [first, last] = r.side === 1 ? [0, r.x.length - 1] : [r.x.length - 1, 0];
    const kerb = r.section.walk > 0 ? r.section.kerb : "median";
    if (kerb !== "median") {
      // An end that meets no other kerb, or meets one let down flush, is let down to the road by a flare, unless it is let down already.
      const end = (e: number): boolean => {
        const there = endOf(r.x[e]!, r.z[e]!);
        return !flushAt(r, r.s[e]!) && (there.kerbs < 2 || there.flush > 0);
      };
      if (end(first) && join(pieces, 0, "flush", kerb)) out.ends!++;
      if (end(last) && join(pieces, pieces.length - 1, kerb, "flush")) out.ends!++;
      // An end of the walk that meets no other walk's end is let down to the ground.
      if (endOf(r.x[first]!, r.z[first]!).walks < 2) sinkEnd(pieces, 0, -1);
      if (endOf(r.x[last]!, r.z[last]!).walks < 2) sinkEnd(pieces, pieces.length - 1, 1);
    }
    // What the city set down on a piece's walk: cut round where it stands back from the kerb, else standing on the walk.
    for (let q = 0; q < pieces.length; q++) {
      const cut = cutRound(pieces[q]!);
      if (cut) {
        pieces.splice(q, 1, ...cut);
        q += cut.length - 1;
      }
    }
    // Runs of pieces clear of what stands there, each laid whole where the chunks' budgets let it, else a piece at a time;
    // a walk that ends where a piece is left out is let down to the ground before it.
    let group: BentPiece[] = [];
    const flush = (): void => {
      if (group.length > 0) fixtures(lay(group) ? group : group.filter((p) => lay([p])), r.section.seed);
      group = [];
    };
    for (let q = 0; q < pieces.length; q++) {
      const p = pieces[q]!;
      if (blocked(p)) {
        out.blocked!++;
        if (group.length > 0) sinkEnd(group, group.length - 1, 1);
        flush();
        if (q + 1 < pieces.length && !pieces[q + 1]!.bend.sink) sinkEnd(pieces, q + 1, -1);
      } else group.push(p);
    }
    flush();
  }
  // What placing took: kerb lines to pieces and their collision, for each chunk with some. Said, not kept in the report,
  // which a build must give the same each time.
  const chunks = new Set<number>(laidIn);
  console.log(`bent walks: ${out.pieces} pieces in ${chunks.size} chunks, placed in ${((placing * 1000) / Math.max(1, chunks.size)).toFixed(0)} us a chunk, ${((performance.now() - began) / 1000).toFixed(1)} s in all`);
  console.log(`bent walks: ${out.filled} points laid on over a short failing stretch, ${out.sunk} walk ends let down to the ground and ${out.ledges} left as a step, ${out.dropped} kerbs dropped over ${out.droppedMetres!.toFixed(0)} m, ${out.narrowed} cut round what stands on the walk and ${out.standing} standing on it`);
  console.log(`bent walks: on the walks, ${[...standing].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  out.droppedMetres = Math.round(out.droppedMetres!);
  return out;

  /** A run's stretches by station (dropSpans), once its points are final. */
  function spansOf(r: Run): DropSpan[] {
    return (r.spans ??= dropSpans(r.s[0]!, r.s[r.s.length - 1]!, r.drops, r.section.walk > 0));
  }

  /** A run's pieces, its dropped stretches flush with a flare at each end, in the order that puts its walk on the left. */
  function placeRun(r: Run): BentPiece[] {
    const spans = spansOf(r);
    for (const sp of spans) if (sp.drop && sp.how === "flush") {
      out.dropped!++;
      out.droppedMetres! += sp.b - sp.a;
    }
    const kerb = r.section.kerb;
    const laid = spans.map((sp) => {
      if (sp.how === "gap") return [];
      const line = slice(r, sp.a, sp.b);
      if (line.x.length < 2) return [];
      const section: Section = sp.how === "flush" ? { ...r.section, kerb: "flush" } : r.section;
      // A flare is one piece between its two ends, the way the street runs at each.
      const flare = sp.how === "down" || sp.how === "up";
      const pieces = placeKerb(flare ? { x: [line.x[0]!, line.x.at(-1)!], y: [line.y[0]!, line.y.at(-1)!], z: [line.z[0]!, line.z.at(-1)!], dx: [line.dx![0]!, line.dx!.at(-1)!], dz: [line.dz![0]!, line.dz!.at(-1)!], stations: [line.stations[0]!, line.stations.at(-1)!] } : line, r.side, section);
      return pieces.map((p) => {
        const along = r.side === 1 ? sp.how : sp.how === "down" ? "up" : sp.how === "up" ? "down" : sp.how;
        if (along === "down") return { ...p, kind: bentJoin(kerb, "flush"), kerb: "flush" as const };
        if (along === "up") return { ...p, kind: bentJoin("flush", kerb), kerb: "flush" as const };
        return sp.tactile && p.kerb === "flush" ? { ...p, bend: { ...p.bend, tactile: true } } : p;
      });
    });
    return (r.side === 1 ? laid : laid.reverse()).flat();
  }

  /**
   * Of run `r`, its points from station a to station b, with a point put in at each where none is, and the way the line
   * runs at the two ends; its stations as placeKerb takes them on the run's side, so a stretch of a run is laid with the
   * stations it has in the whole of it.
   */
  function slice(r: Run, a: number, b: number): { x: number[]; y: number[]; z: number[]; s: number[]; stations: number[]; dx?: number[]; dz?: number[] } {
    const x: number[] = [], y: number[] = [], z: number[] = [], s: number[] = [];
    const put = (q: number, t: number): void => {
      const w = q + 1 < r.x.length ? t : 0, n = Math.min(q + 1, r.x.length - 1);
      x.push(r.x[q]! + (r.x[n]! - r.x[q]!) * w);
      y.push(r.y[q]! + (r.y[n]! - r.y[q]!) * w);
      z.push(r.z[q]! + (r.z[n]! - r.z[q]!) * w);
      s.push(r.s[q]! + (r.s[n]! - r.s[q]!) * w);
    };
    const find = (st: number): [number, number] => {
      let q = 0;
      while (q + 2 < r.s.length && r.s[q + 1]! <= st) q++;
      const span = r.s[q + 1]! - r.s[q]!;
      return [q, span > 0 ? Math.min(1, Math.max(0, (st - r.s[q]!) / span)) : 0];
    };
    const [qa, ta] = find(a), [qb, tb] = find(b);
    put(qa, ta);
    for (let q = qa + 1; q <= qb; q++) if (r.s[q]! - s[s.length - 1]! > 0.05 && b - r.s[q]! > 0.05) put(q, 0);
    if (b - s[s.length - 1]! > 0.05) put(qb, tb);
    // placeKerb takes a run's stations as they are on side 1 and from its last point on side -1; shifted so a stretch of
    // the run has the stations the whole run gives it.
    const shift = r.side === 1 ? 0 : r.s[0]! + r.s[r.s.length - 1]! - s[0]! - s[s.length - 1]!;
    // The way the run runs at each end of the stretch, from its own points on either side.
    const way = (st: number): [number, number] => {
      const [q] = find(st), n = Math.min(q + 1, r.x.length - 1), ex = r.x[n]! - r.x[q]!, ez = r.z[n]! - r.z[q]!, l = Math.hypot(ex, ez) || 1;
      return [ex / l, ez / l];
    };
    if (a <= r.s[0]! + 0.01 && b >= r.s[r.s.length - 1]! - 0.01) return { x, y, z, s, stations: s.map((v) => v + shift) };
    const [ax, az] = way(a), [bx, bz] = way(b);
    const dx = x.map((_, i) => (i === 0 ? ax : i === x.length - 1 ? bx : NaN)), dz = z.map((_, i) => (i === 0 ? az : i === z.length - 1 ? bz : NaN));
    // Between its ends the ways are its points' own; placeKerb takes them all or none, so they are filled in as it would.
    for (let i = 1; i + 1 < x.length; i++) {
      const ex = x[i + 1]! - x[i - 1]!, ez = z[i + 1]! - z[i - 1]!, l = Math.hypot(ex, ez) || 1;
      [dx[i], dz[i]] = [ex / l, ez / l];
    }
    return { x, y, z, s, stations: s.map((v) => v + shift), dx, dz };
  }

  /**
   * Piece `k` of `pieces` with its walk let down to the ground toward its end (`toward` 1) or its start (-1): the piece
   * itself where it is short enough, else cut so SINK_LENGTH of it at that end sinks. Counted as a step left where it
   * cannot be (a long curve), and said as a walk let down where it is.
   */
  function sinkEnd(pieces: BentPiece[], k: number, toward: 1 | -1): void {
    const p = pieces[k];
    if (!p || p.bend.walk <= KERB_BACK + 0.01) return;
    const length = p.bend.half * 2;
    // A short piece whose walk is let down at its other end already: its two halves each let down toward their own end,
    // or where it is too short for that, its kerb alone.
    if (p.bend.sink === -toward && length <= 2 * SINK_LENGTH + 0.5) {
      // A flush kerb or a flare keeps its kerb: its walk is let down at one end only.
      if (p.kind.includes("_flush")) {
        out.ledges!++;
        return;
      }
      if (length < SINK_LENGTH || p.kind.endsWith("_c")) pieces[k] = { ...p, kind: bentKind("median", p.kind.endsWith("_c")), kerb: "median", bend: { ...p.bend, sink: 0, walk: KERB_BACK, panel: 0 } };
      else {
        const [one, two] = splitStraight(p, length / 2);
        pieces.splice(k, 1, { ...one, bend: { ...one.bend, sink: -1 } }, { ...two, bend: { ...two.bend, sink: 1 } });
      }
      out.sunk!++;
      return;
    }
    if (length <= SINK_LENGTH + 0.5) {
      pieces[k] = { ...p, bend: { ...p.bend, sink: toward } };
      out.sunk!++;
      return;
    }
    if (p.kind.endsWith("_c")) {
      out.ledges!++;
      return;
    }
    const [one, two] = splitStraight(p, toward === 1 ? length - SINK_LENGTH : SINK_LENGTH);
    pieces.splice(k, 1, toward === 1 ? one : { ...one, bend: { ...one.bend, sink: -1 } }, toward === 1 ? { ...two, bend: { ...two.bend, sink: 1 } } : two);
    out.sunk!++;
  }

  /**
   * A piece cut round what the city set down on its walk, or null where nothing stands on it or what stands there stands on
   * the walk: its walk ending CUT_SHORT before the nearest of it that stands CUT_ROUND or more behind the kerb's face, and a
   * straight split so the cut walk is only as long as that is along it, the rest of it as it was.
   */
  function cutRound(p: BentPiece): BentPiece[] | null {
    if (p.bend.walk <= KERB_BACK + 0.01) return null;
    const met = obstacles.meeting(walkBox(p, p.bend.walk), -0.1, passed);
    if (met.length === 0) return null;
    const a = (p.yaw * Math.PI) / 180, cx = Math.cos(a), cz = -Math.sin(a);
    // Each thing's corners in the piece's chord's frame: along from its middle, across from its face.
    let back = Infinity, lo = Infinity, hi = -Infinity, near = false;
    for (const { p: q, box } of met) {
      const b = (box.yaw * Math.PI) / 180, bc = Math.cos(b), bs = Math.sin(b);
      let least = Infinity, l0 = Infinity, l1 = -Infinity;
      for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const ox = box.x + bc * u * box.size[0] / 2 + bs * w * box.size[2] / 2 - p.x, oz = box.z - bs * u * box.size[0] / 2 + bc * w * box.size[2] / 2 - p.z;
        const along = ox * cx + oz * cz, across = ox * -cz + oz * cx;
        least = Math.min(least, across);
        l0 = Math.min(l0, along);
        l1 = Math.max(l1, along);
      }
      const family = q.kind.replace(/^core:/, "").replace(/_[a-z0-9]+$/, "").replace(/\d+$/, "");
      if (least < CUT_ROUND) {
        near = true;
        standing.set(`${family} on`, (standing.get(`${family} on`) ?? 0) + 1);
        continue;
      }
      standing.set(`${family} cut`, (standing.get(`${family} cut`) ?? 0) + 1);
      back = Math.min(back, least - CUT_SHORT);
      lo = Math.min(lo, l0);
      hi = Math.max(hi, l1);
    }
    if (back === Infinity) {
      if (near) out.standing!++;
      return null;
    }
    out.narrowed!++;
    const walk = Math.max(CUT_LEAST, Math.min(p.bend.walk, back));
    const cut = (q: BentPiece): BentPiece => ({ ...q, bend: { ...q.bend, walk } });
    const L = p.bend.half * 2, m0 = Math.max(0, lo - 0.3 + p.bend.half), m1 = Math.min(L, hi + 0.3 + p.bend.half);
    if (p.kind.endsWith("_c") || p.kind.includes("_flush") || p.bend.sink || m1 - m0 > L - 1) return [cut(p)];
    // Split so only what stands there has its walk cut: before it, it, and after it, each at least half a metre.
    const parts: BentPiece[] = [];
    let rest = p, done = 0;
    for (const at of [m0, m1]) {
      if (at - done < 0.5 || L - at < 0.5) continue;
      const [one, two] = splitStraight(rest, at - done);
      parts.push(one);
      rest = two;
      done = at;
    }
    parts.push(rest);
    return parts.map((q) => {
      const mid = (q.x - p.x) * cx + (q.z - p.z) * cz + p.bend.half;
      return mid >= m0 - 0.01 && mid <= m1 + 0.01 ? cut(q) : q;
    });
  }

  /**
   * Whether a piece's kerb and the first of its walk meet what the city has set down there. What stands further back on a
   * walk (a stoop, a column, an awning's post) is cut round or stands on it (cutRound).
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
      if (!/_(raised|worn)_s$/.test(p.kind) || length < 3 || p.bend.walk < 1 || p.bend.sink) return;
      const before = pieces[k - 1]?.y ?? Infinity, after = pieces[k + 1]?.y ?? Infinity;
      if (p.y <= before && p.y <= after && hash3(seed, Math.floor(mid / 32), v.seed + 3) % rules.gutterEvery === 0 && fixture(p, "zdrain", 0, BREAK_AT.zdrain![2]!)) out.drains!++;
      // A box 2 m on from the middle where the piece is long enough, as the kit's is from its slab's.
      const d = length >= 6 ? 2 : 0;
      if (hash3(Math.round(p.x), Math.round(p.z), v.seed + 7) % rules.boxEvery < Math.max(1, Math.round(length / SLOT)) && fixture(p, "zutility", d, Math.min(p.bend.walk, 2.4) - 0.4)) out.boxes!++;
    });
  }

  /**
   * A shape of the walk kit `d` along piece `p`'s chord from its middle and `back` from the kerb's face, at the chord's
   * height there. A box stands nowhere a way in to a building crosses the walk, as the kit's never did: its slab was cut there.
   */
  function fixture(p: BentPiece, shape: "zdrain" | "zutility", d: number, back: number): boolean {
    const a = (p.yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), mid = BREAK_AT[shape]!;
    const [x, z] = [p.x + c * d + s * back, p.z - s * d + c * back];
    if (shape === "zutility" && way({ x, y: p.y, z, yaw: p.yaw, size: [1, 1.3, 0.6] })) return false;
    const m = new Mason({ x: x + c * mid[0]!, z: z - s * mid[0]!, yaw: p.yaw, c, s, width: 8, depth: 3, rings: [] }, p.y + (p.bend.rise * d) / p.bend.half);
    m.put(shape, 0, mid[1]!, 0, "concrete");
    return accept(m);
  }

  /** Turns piece `k` of `pieces` into a flare from one kerb to another, cut down to FLARE long from its end; whether it did. */
  function join(pieces: BentPiece[], k: number, a: BentKerb, b: BentKerb): boolean {
    const p = pieces[k]!;
    if (p.kind.endsWith("_c") || p.kind.includes("_flush") || a === "median" || b === "median") return false;
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
 * A line's points' states judged over the line, in place, by their stations: a stretch not level (or its walk not level)
 * for under FILL metres between two that are is taken as they are, and a stretch laid (or walked) for under ISLAND
 * between two that are not is taken as they are. Gives how many points were laid on.
 */
export function judged(state: Uint8Array, stations: Float64Array): number {
  let filled = 0;
  // Between two points at or over `least`, a stretch under it for under FILL metres is raised to the lesser of the two.
  const fill = (least: number, under: (v: number) => boolean): void => {
    for (let q = 0; q < state.length; ) {
      if (!under(state[q]!) || q === 0 || state[q - 1]! < least) {
        q++;
        continue;
      }
      let e = q;
      while (e < state.length && under(state[e]!)) e++;
      if (e < state.length && state[e]! >= least && stations[e]! - stations[q - 1]! <= FILL) {
        const to = Math.min(state[q - 1]!, state[e]!);
        for (let k = q; k < e; k++) if (state[k] !== OFF) {
          state[k] = to;
          filled++;
        }
      }
      q = e;
    }
  };
  // A stretch at or over `least` for under ISLAND metres between two under it is lowered to `to`.
  const island = (least: number, to: number): void => {
    for (let q = 0; q < state.length; ) {
      if (state[q]! < least) {
        q++;
        continue;
      }
      let e = q;
      while (e < state.length && state[e]! >= least) e++;
      if (q > 0 && e < state.length && stations[e - 1]! - stations[q]! < ISLAND) for (let k = q; k < e; k++) state[k] = Math.min(state[k]!, to);
      q = e;
    }
  };
  // Short failing stretches first, short passing ones then: no kerb is laid in dashes, nor in crumbs.
  fill(ALONE, (s) => s === UNLEVEL);
  fill(WALKED, (s) => s === ALONE);
  island(WALKED, ALONE);
  island(ALONE, UNLEVEL);
  return filled;
}

/** A stretch of a run by station: laid as its kerb, flared down to flush, flush, flared up, or cut (a kerb alone's crossing). */
export interface DropSpan {
  a: number;
  b: number;
  readonly how: "kerb" | "down" | "flush" | "up" | "gap";
  /** A crossing's or a corner ramp's flush kerb, which draws a pad. */
  readonly tactile: boolean;
  /** A stretch the model marks as dropped; a flush stretch between two drops too near to flare between is not one. */
  readonly drop: boolean;
}

/**
 * A run's stretches by station, from s0 to s1, its drops (from, to and kind, three a drop, in the order of their stations)
 * let down flush with a flare at each end where it has a walk, and cut where it is a kerb alone. Drops nearer each other
 * than two flares are one flush stretch, the kerb between them flush too, so no drop is laid as raised kerb: a second
 * crossing 1 m past the first stood in the first one's flare and was left out. A drop the run holds only an end of is
 * another run's, but where its middle is in this run.
 */
export function dropSpans(s0: number, s1: number, drops: readonly number[], walked: boolean): DropSpan[] {
  // The run's drops, those too near to flare between gathered into one stretch.
  const near = walked ? 2 * FLARE : 0.5;
  const groups: { a: number; b: number; drops: [number, number, boolean][] }[] = [];
  for (let k = 0; k + 2 < drops.length; k += 3) {
    const d0 = Math.max(s0, drops[k]!), d1 = Math.min(s1, drops[k + 1]!), kind = drops[k + 2]!, middle = (drops[k]! + drops[k + 1]!) / 2;
    if (d1 - d0 < 0.5 && (d1 <= d0 || middle < s0 || middle > s1)) continue;
    const tactile = kind === DROP_CROSSING || kind === DROP_RAMP, last = groups[groups.length - 1];
    if (last && d0 < last.b + near) {
      last.drops.push([d0, d1, tactile]);
      last.b = Math.max(last.b, d1);
    } else groups.push({ a: d0, b: d1, drops: [[d0, d1, tactile]] });
  }
  const spans: DropSpan[] = [];
  let from = s0;
  for (const g of groups) {
    if (!walked) {
      // A kerb alone is cut where it is dropped: the crossing runs through it at the road's height.
      if (g.a > from) spans.push({ a: from, b: g.a, how: "kerb", tactile: false, drop: false });
      spans.push({ a: g.a, b: g.b, how: "gap", tactile: g.drops.some((d) => d[2]), drop: true });
      from = g.b;
      continue;
    }
    const f0 = Math.max(from, g.a - FLARE), f1 = Math.min(s1, g.b + FLARE);
    if (f0 > from + 0.01) spans.push({ a: from, b: f0, how: "kerb", tactile: false, drop: false });
    if (g.a - f0 > 0.3) spans.push({ a: f0, b: g.a, how: "down", tactile: false, drop: false });
    // Each drop flush with its own pad or none, and the kerb between two of them flush with none.
    let at = g.a - f0 > 0.3 ? g.a : f0;
    for (const [d0, d1, tactile] of g.drops) {
      if (d0 > at + 0.01) spans.push({ a: at, b: d0, how: "flush", tactile: false, drop: false });
      if (d1 > Math.max(at, d0)) spans.push({ a: Math.max(at, d0), b: d1, how: "flush", tactile, drop: true });
      at = Math.max(at, d1);
    }
    if (f1 - g.b > 0.3) spans.push({ a: g.b, b: f1, how: "up", tactile: false, drop: false });
    else spans[spans.length - 1]!.b = f1;
    from = f1;
  }
  if (s1 - from > 0.01) spans.push({ a: from, b: s1, how: "kerb", tactile: false, drop: false });
  return spans;
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
