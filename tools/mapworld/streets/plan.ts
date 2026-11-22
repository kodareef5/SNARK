// A map's streets, worked out in its build (planning/workstreams/streets.md): the data's stretches (fit.ts), fitted; each
// one's type and section by the rules (rules.ts) and the city's overlay (overlay.ts); then each sector's streets part
// (shared/world/streets.ts), read back as a page reads it so that the build paints its ground from what the page draws
// (paint.ts), and the report of every stretch (reports/<ruins>/streets.json), which tools/maps/street.ts reads.

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../../shared/coords.ts";
import {
  KERBS, STREET_ONE_WAY, STREET_PAIRED, StreetSectors, VERGES, WALKS, decodeStreets, encodeStreets, heldSide, kerbOf, kindsByte, sideReach,
  type StreetCorner, type StreetSide, type StreetsPart, type Stretch,
} from "../../../shared/world/streets.ts";
import type { MapStreets } from "../../../shared/world/mapfile.ts";
import type { Base } from "../base.ts";
import { planCorners, type ReturnRules } from "../corners.ts";
import type { World } from "../ground.ts";
import { streetGraph } from "../street-graph.ts";
import { cornerWithDrops, dropsOf, withDrops, type HeldPart } from "./drops.ts";
import { fitRuns, readRuns, type Run, type SideFit } from "./fit.ts";
import { conflictRecord, conflictText, matchOverlay, overlayConflicts, readOverlay, sortedKey, type Applied } from "./overlay.ts";
import { sideSection, streetRules, typeOf, widthOf, type Facts, type Rule, type Section, type StreetRules, type StreetType } from "./rules.ts";

/** A side as the rules and the overlay left it, and in metres; and each field an overlay entry set on it. */
export interface SideOut { section: Section; rules: string[]; verge: number; walk: number; held: StreetSide; asked: Record<string, AskedField> }

/** A field an overlay entry set on a side: the value it asked for and the entry, the value in effect, and where those differ, why. */
export interface AskedField { asked: unknown; at: string; effect: unknown; by?: string }

/** A side's fields an overlay entry set, which the kerbs' placing honours (PlannedStreets): its kerb, its verge's kind or width. */
export const ASKED_KERB = 1, ASKED_VERGE = 2;

/**
 * The streets parts as a page holds them, with what the build alone reads of each side, which no part carries: its wear
 * (the kerbs' placing, bent-walks.ts), and which of its kerb and verge an overlay entry set, which the placing takes as
 * asked: a kerb is laid even on a type the bent kerbs leave out, and a verge under half a metre is not paved over.
 */
export class PlannedStreets extends StreetSectors {
  private readonly sides = new Map<StreetsPart, { wear: Float64Array; asked: Uint8Array }>();

  /** Keeps a held part's sides: their wear and what of them an entry set (ASKED_KERB, ASKED_VERGE), two to a stretch in its order. */
  keep(part: StreetsPart, wear: Float64Array, asked: Uint8Array): void {
    this.sides.set(part, { wear, asked });
  }

  /** Side `side` of stretch `stretch` of `part` (a held part): its wear (NaN where none is said) and whether an entry set its kerb and its verge. */
  side(part: StreetsPart, stretch: number, side: number): { wear: number; kerb: boolean; verge: boolean } | null {
    const s = this.sides.get(part);
    if (!s) return null;
    const asked = s.asked[stretch * 2 + side]!;
    return { wear: s.wear[stretch * 2 + side]!, kerb: (asked & ASKED_KERB) !== 0, verge: (asked & ASKED_VERGE) !== 0 };
  }
}

/**
 * One side of a stretch as the build lays it: its type's section and the rules' sets (`facts` the stretch's, this side's
 * laid over them here), then the overlay's entries over it (`over`, in the order they apply), then its widths in metres
 * from its fit `sf`, `seed`, `half` its kerb's distance and `median` its pair's median. A value an overlay entry sets is
 * final: no step below works it out again (a verge from a walk the data draws, a walk giving way to the building line, a
 * verge cut to it, a pair's median side). Where what is in effect still differs from what an entry asked (a verge with no
 * width, a width with no verge or no walk, a walk under 0.6 m, a width held in eighths of a metre), `asked` says why.
 */
export function planSide(rules: StreetRules, type: string, facts: Facts, sf: SideFit, over: readonly Applied[], side: number, seed: number, half: number, median: number): SideOut {
  const { section, rules: fired, from } = sideSection(rules, type, { ...facts, type, side: side === 0 ? "left" : "right", inner: sf.inner, room: sf.room, built: sf.built, green: sf.green, drawn: sf.drawn !== null, tagged: sf.tagged });
  // What the overlay asks of this side, a field at a time: the last entry to set one wins.
  const at: Record<string, string> = {};
  for (const a of over) {
    if (!a.entry.set || !a.sides.includes(side)) continue;
    Object.assign(section, a.entry.set);
    fired.push(`overlay ${a.entry.file}:${a.entry.line}`);
    for (const f of Object.keys(a.entry.set)) from[f] = `overlay ${(at[f] = `${a.entry.file}:${a.entry.line}`)}`;
  }
  const asking: Record<string, unknown> = { ...section };
  const set = (f: keyof Section): boolean => at[f] !== undefined;
  // A width an entry asks for a verge or a walk brings back the verge or the walk a rule took away, of its type's kind.
  for (const [kind, width] of [["verge", "vergeWidth"], ["walk", "walkWidth"]] as const) {
    if (!set(width) || set(kind) || section[kind] !== "none" || !from[kind]?.startsWith("rule ") || widthOf(section[width], 1) <= 0) continue;
    const own = rules.types[type]!.section[kind];
    if (own === undefined || own === "none") continue;
    (section as Record<string, unknown>)[kind] = own;
    from[kind] = `type ${type}, brought back over ${from[kind]} by overlay ${at[width]}`;
  }
  const source = (f: string): string => from[f] ?? "no type or rule";
  // Why a width is what it is, and why a field is not as asked where a step below changed it.
  const by: Record<string, string> = {};
  let verge = section.verge ?? "none", walk = section.walk ?? "none", drawnUsed = false;
  let v = verge === "none" ? 0 : widthOf(section.vergeWidth, shareOf(seed, side * 4 + 1)), vWhy = `vergeWidth ${JSON.stringify(section.vergeWidth ?? 0)} by ${source("vergeWidth")}`;
  if (verge === "none") by.vergeWidth = `no verge: verge "none" by ${source("verge")}`;
  let w = 0, wWhy = "";
  if (sf.inner) {
    // A pair's median: from the kerb to just past its middle, as the median's kind; no walk. A barrier stands on a
    // narrow paved strip, or in rough grass where the median is wide.
    const kind = section.median ?? "none";
    if (!set("verge")) verge = (kind === "barrier" && median >= 4 ? "grass" : MEDIAN_VERGE[kind] ?? "none") as typeof verge;
    else by.median = `verge is set by overlay ${at.verge}`;
    if (!set("vergeWidth")) [v, vWhy] = [verge === "none" ? 0 : median / 2 + 0.25, "the pair's median"];
    if (!set("walk")) walk = "none";
  } else by.median = "not a pair's median side";
  if (walk === "none") by.walkWidth = by.walkAt = `no walk: walk "none" by ${source("walk")}${sf.inner && !set("walk") ? " and a pair's median side" : ""}`;
  else {
    const ww = section.walkWidth ?? 1.5, lo = typeof ww === "number" ? ww : ww[0], hi = typeof ww === "number" ? ww : ww[1];
    w = walk === "full" ? Math.max(lo, Math.min(hi, (Number.isFinite(sf.room) ? sf.room : hi) - v)) : widthOf(ww, shareOf(seed, side * 4 + 2));
    wWhy = walk === "full" ? `the building line ${round(sf.room, 1)} m out` : `walkWidth ${JSON.stringify(ww)} by ${source("walkWidth")}`;
    if (section.walkAt === "drawn") {
      if (sf.drawn === null) by.walkAt = "the data draws no walk on this side";
      else if (set("vergeWidth")) by.walkAt = `vergeWidth is set by overlay ${at.vergeWidth}`;
      else {
        // Where the data draws the walk, the verge between, never more than a metre past the widest the section has.
        const vw = section.vergeWidth ?? 0, most = (typeof vw === "number" ? vw : vw[1]) + 1;
        [v, vWhy, drawnUsed] = [Math.min(most, Math.max(0, sf.drawn - w / 2)), `the walk the data draws ${round(sf.drawn, 1)} m out`, true];
        if (v >= 0.25 && verge === "none" && !set("verge")) verge = "grass";
      }
    }
    // Never past the building line: the walk gives way, and none is left under 0.6 m.
    if (Number.isFinite(sf.room) && walk !== "full" && v + w > sf.room && !set("walkWidth")) [w, wWhy] = [Math.max(0, sf.room - v), `the building line ${round(sf.room, 1)} m out`];
    if (w < 0.6) {
      by.walk = by.walkWidth = `a walk under 0.6 m is none (${round(w)} m: ${wWhy})`;
      [walk, w] = ["none", 0];
    }
  }
  if (Number.isFinite(sf.room) && v > sf.room && !sf.inner && !set("vergeWidth")) [v, vWhy] = [Math.max(0, sf.room), `the building line ${round(sf.room, 1)} m out`];
  // A verge an entry makes none has no width.
  if (set("verge") && verge === "none") v = 0;
  if (v <= 0) {
    if (verge !== "none") by.verge = `no width (${vWhy})`;
    [verge, v] = ["none", 0];
  }
  const kerb = section.kerb ?? "raised";
  const held = heldSide(half, v, w, kindsByte(VERGES.indexOf(verge), WALKS.indexOf(walk), KERBS.indexOf(kerb)));
  const effect: Record<string, unknown> = {
    kerb, verge, vergeWidth: held.verge, walk, walkWidth: held.walk, walkAt: drawnUsed ? "drawn" : "kerb",
    median: sf.inner && !set("verge") ? section.median ?? "none" : "none", parking: section.parking ?? "none", wear: section.wear,
  };
  const asked: Record<string, AskedField> = {};
  for (const [f, where] of Object.entries(at)) {
    const a = asking[f], e = effect[f];
    // Two widths asked for are as asked by any between them the stretch's seed chose, to the eighth of a metre a part
    // holds a width in; one is as asked where it is that one, and else is said held in eighths.
    const between = Array.isArray(a) && typeof e === "number" && e >= a[0] - 1 / 16 && e <= a[1] + 1 / 16 && by[f] === undefined;
    const same = Bun.deepEquals(a, e) || between;
    asked[f] = { asked: a, at: where, effect: e, ...(same ? {} : { by: by[f] ?? (typeof a === "number" && typeof e === "number" && Math.abs(a - e) <= 1 / 16 ? "held in eighths of a metre" : "unknown") }) };
  }
  return { section: { ...section, verge, walk, kerb }, rules: fired, verge: held.verge, walk: held.walk, held, asked };
}

export interface StreetsPlan {
  /** Each sector's part, by its square on the lattice. */
  readonly parts: MapStreets[];
  /** The parts as a page holds them. */
  readonly held: StreetSectors;
  readonly types: readonly string[];
  readonly summary: Record<string, unknown>;
}

/** A hash of a stretch's id and run, the same in every cut and build: its seed. */
function seedOf(id: string, run: number): number {
  let h = 0x811c9dc5 ^ run;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  h ^= h >>> 15;
  return Math.imul(h, 0x2c1b3c6d) >>> 0;
}
/** A share from 0 to 1 of a seed for field `k`. */
const shareOf = (seed: number, k: number): number => ((Math.imul(seed ^ (k * 0x9e3779b9), 0x85ebca6b) >>> 8) & 0xffff) / 65535;
const MEDIAN_VERGE: Record<string, string> = { none: "none", planted: "planted", paved: "paved", barrier: "paved" };
const round = (v: number, k = 2): number => (Number.isFinite(v) ? Number(v.toFixed(k)) : v);

/**
 * The streets of the work folder `source` on the map `base` frames: `world` its districts, `vocab` its vocabulary (the
 * city's own street rules in `streets`, the corners' returns in `street.walks.returns`), `report` the folder its report is
 * written to. `toLattice` turns base metres into lattice metres, which the street graph and the corners are in; the map's
 * own metres are lattice less (x0, z0).
 */
export function planStreets(source: string, base: Base, world: World, vocab: { streets?: { types?: Record<string, StreetType>; rules?: Rule[] }; street?: { walks?: { returns?: ReturnRules } } } | null, report: string, log: (line: string) => void): StreetsPlan {
  const t0 = performance.now();
  const { grid } = base;
  const toMap = (e: number, n: number): [number, number] => [grid.east - e, n - grid.south];
  const lonLatToMap = (lon: number, lat: number): [number, number] => toMap(...base.tm.forward(lon, lat));
  const mapToLonLat = (x: number, z: number): [number, number] => {
    const [lon, lat] = base.tm.inverse(grid.east - x, z + grid.south);
    return [round(lon, 6), round(lat, 6)];
  };
  const toSample = (x: number, z: number): number => {
    const col = Math.round((grid.sizeX - x) / grid.cell), row = Math.round((grid.sizeZ - z) / grid.cell);
    return col < 0 || row < 0 || col >= grid.nx || row >= grid.nz ? -1 : row * grid.nx + col;
  };
  const rules = streetRules(vocab?.streets ?? null);
  const types = Object.keys(rules.types);
  const all = readRuns(source, toMap);
  const className = (r: Run): string => r.highway ?? r.mtfcc;
  // The overlay is matched against every run of the data, so that an entry for a street outside a cut is no error there.
  const entries = readOverlay(source, types);
  const unsorted = new Set(entries.filter((e, k) => k > 0 && entries[k - 1]!.file === e.file && sortedKey(entries[k - 1]!) > sortedKey(e)).map((e) => e.file));
  for (const file of unsorted) log(`streets: streets/${file} is not sorted (bun tools/maps/street.ts <city> --sort sorts it)`);
  const allApplied = matchOverlay(entries, all, lonLatToMap, className);
  // Entries as particular that disagree, each settled by a priority (matchOverlay stops on one that is not): said, and in the report.
  const settled = overlayConflicts(allApplied);
  for (const c of settled) log(`streets: in the overlay, ${conflictText(c, all)}`);
  // The runs on the map, with what reaches past its edge.
  const reach = 40;
  const kept: number[] = [];
  all.forEach((r, k) => {
    let lx = Infinity, lz = Infinity, hx = -Infinity, hz = -Infinity;
    for (let q = 0; q < r.xz.length; q += 2) { lx = Math.min(lx, r.xz[q]!); hx = Math.max(hx, r.xz[q]!); lz = Math.min(lz, r.xz[q + 1]!); hz = Math.max(hz, r.xz[q + 1]!); }
    if (hx >= -reach && lx <= grid.sizeX + reach && hz >= -reach && lz <= grid.sizeZ + reach) kept.push(k);
  });
  const runs = kept.map((k) => all[k]!);
  const applied: Applied[][] = kept.map((k) => allApplied[k]!);
  const fits = fitRuns(runs, base, toMap, world.districts, toSample);
  log(`streets: ${runs.length} stretches fitted, ${fits.filter((f) => f.pair).length} of them one of a pair, in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

  // Each stretch's type and section, side by side.
  const typeCount = new Map<string, { stretches: number; km: number }>(), ruleCount = new Map<string, number>(), setCount = new Map<string, number>();
  const records: string[] = [];
  // What the placing of the kerbs reads of each side and no part carries (PlannedStreets), by stretch and side; and the
  // fields the overlay set on a side, and those not in effect as asked, said.
  const sideWear = new Float64Array(runs.length * 2), sideAsked = new Uint8Array(runs.length * 2);
  let asks = 0;
  const differ: string[] = [];
  const stretches: Stretch[] = runs.map((r, k) => {
    const fit = fits[k]!, seed = seedOf(r.id, r.run);
    // Its type by its street's looks (its way's in its district), so a street keeps one type from junction to junction.
    const street = fit.street, outer = street.filter((s) => !s.inner);
    const facts: Facts = {
      class: className(r), mtfcc: r.mtfcc, name: r.name, district: fit.district, style: fit.style, tall: fit.tall, lanes: r.lanes, width: r.half * 2,
      length: fit.length, angle: fit.angle, slope: fit.slope, oneway: r.oneway !== 0, pair: fit.pair !== null,
      room: Math.min(...(outer.length ? outer : street).map((s) => s.room)), built: Math.max(...street.map((s) => s.built)),
      green: (street[0].green + street[1].green) / 2, drawn: street.some((s) => s.drawn !== null),
    };
    let { type, rule, sure } = typeOf(rules, facts);
    const over = applied[k]!;
    const overType = over.filter((a) => a.entry.type).at(-1);
    if (overType) { type = overType.entry.type!; rule = `overlay ${overType.entry.file}:${overType.entry.line}`; sure = 1; }
    ruleCount.set(rule.startsWith("overlay") ? "overlay" : rule, (ruleCount.get(rule.startsWith("overlay") ? "overlay" : rule) ?? 0) + 1);
    const t = typeCount.get(type) ?? { stretches: 0, km: 0 };
    t.stretches++; t.km += fit.length / 1000;
    typeCount.set(type, t);
    const sides = [0, 1].map((side): SideOut => {
      const out = planSide(rules, type, facts, fit.sides[side]!, over, side, seed, r.half, fit.pair?.median ?? 0);
      for (const id of out.rules) if (!id.startsWith("overlay ")) setCount.set(id, (setCount.get(id) ?? 0) + 1);
      sideWear[k * 2 + side] = out.section.wear ?? NaN;
      sideAsked[k * 2 + side] = (out.asked.kerb ? ASKED_KERB : 0) | (out.asked.verge || out.asked.vergeWidth ? ASKED_VERGE : 0);
      for (const [f, a] of Object.entries(out.asked)) {
        asks++;
        if (a.by !== undefined) differ.push(`${a.at} ${f} on ${r.id}${r.name ? ` (${r.name})` : ""} ${side === 0 ? "left" : "right"}: asked ${JSON.stringify(a.asked)}, in effect ${JSON.stringify(a.effect)}: ${a.by}`);
      }
      return out;
    });
    const mid = Math.floor(r.xz.length / 4) * 2;
    const sideRecord = (s: SideOut, side: number): Record<string, unknown> => {
      const sf = fit.sides[side]!;
      return {
        kerb: s.section.kerb, verge: s.section.verge, vergeWidth: s.verge, walk: s.section.walk, walkWidth: s.walk, median: s.section.median ?? "none", parking: s.section.parking ?? "none", wear: s.section.wear,
        fit: { room: round(sf.room, 1), built: round(sf.built), green: round(sf.green), drawn: sf.drawn === null ? null : round(sf.drawn, 1), drawnShare: round(sf.drawnShare), tagged: sf.tagged, inner: sf.inner }, sets: s.rules,
        ...(Object.keys(s.asked).length > 0 ? { overlay: s.asked } : {}),
      };
    };
    records.push(JSON.stringify({
      i: k, id: r.id, run: r.run, way: r.way, name: r.name, class: className(r), mtfcc: r.mtfcc, lanes: r.lanes, oneway: r.oneway, width: round(r.half * 2, 1),
      length: round(fit.length, 1), angle: round(fit.angle, 1), slope: round(fit.slope, 3), district: fit.district, style: fit.style,
      from: mapToLonLat(r.xz[0]!, r.xz[1]!), mid: mapToLonLat(r.xz[mid]!, r.xz[mid + 1]!), to: mapToLonLat(r.xz[r.xz.length - 2]!, r.xz[r.xz.length - 1]!),
      pair: fit.pair ? { id: runs[fit.pair.stretch]!.id, median: round(fit.pair.median, 1) } : null, fitSure: round(fit.sure),
      facts: Object.fromEntries(Object.entries(facts).map(([key, v]) => [key, typeof v === "number" ? round(v) : v])), type, rule, sure: round(Math.min(sure, fit.sure)),
      overlay: over.map((a) => `${a.entry.file}:${a.entry.line}`), section: { left: sideRecord(sides[0]!, 0), right: sideRecord(sides[1]!, 1) }, seed,
    }));
    return { type: types.indexOf(type), flags: (r.oneway !== 0 ? STREET_ONE_WAY : 0) | (fit.pair ? STREET_PAIRED : 0), seed: seed & 65535, sides: [sides[0]!.held, sides[1]!.held] as const, xz: r.xz };
  });

  // The corners, round every junction of streets on the ground, as the walks' returns are worked out (corners.ts).
  const returns = vocab?.street?.walks?.returns;
  let corners: (StreetCorner & { sx: number; sz: number })[] = [];
  const graph = streetGraph({ source, toLattice: (e, n) => [grid.east + grid.x0 - e, n - (grid.south - grid.z0)] });
  if (returns) {
    const classes = [...new Set(runs.map((r) => r.mtfcc))];
    // Each run's ends, by the node they stand at, so a corner's arm finds its stretch.
    const ends = new Map<string, { k: number; start: boolean }[]>();
    const endKey = (x: number, z: number): string => `${Math.round(x * 2)},${Math.round(z * 2)}`;
    runs.forEach((r, k) => {
      for (const start of [true, false]) {
        const q = start ? 0 : r.xz.length - 2, key = endKey(r.xz[q]!, r.xz[q + 1]!);
        (ends.get(key) ?? ends.set(key, []).get(key)!).push({ k, start });
      }
    });
    for (const c of planCorners(graph, { ...returns, classes, walked: classes })) {
      const nx = c.x - grid.x0, nz = c.z - grid.z0, cx = c.cx - grid.x0, cz = c.cz - grid.z0;
      const end = (ends.get(endKey(nx, nz)) ?? []).find((e) => runs[e.k]!.line === c.a.line);
      if (!end) continue;
      const r = runs[end.k]!, q = end.start ? 0 : r.xz.length - 4;
      const dx = r.xz[q + 2]! - r.xz[q]!, dz = r.xz[q + 3]! - r.xz[q + 1]!;
      const side = dx * (cz - nz) - dz * (cx - nx) > 0 ? 0 : 1;
      corners.push({ cx, cz, radius: c.radius, reach: c.reach, ax: c.ax, az: c.az, bx: c.bx, bz: c.bz, stretch: end.k, side, sx: nx, sz: nz });
    }
  }

  // Each sector's part: the stretches and corners whose reach meets its square; made once to find where each kerb is let
  // down (drops.ts), and again with its drops.
  const [frameX, frameZ] = base.info.frame;
  const chunksX = grid.sizeX / CHUNK_SIZE, chunksZ = grid.sizeZ / CHUNK_SIZE, span = SECTOR_CHUNKS * CHUNK_SIZE;
  let parts: MapStreets[] = [];
  let held = new PlannedStreets();
  let bytes = 0;
  const heldParts: HeldPart[] = [];
  const reachOf = (s: Stretch): number => Math.max(s.sides[0].kerb + sideReach(s.sides[0]), s.sides[1].kerb + sideReach(s.sides[1]));
  const boxes = stretches.map((s) => {
    let lx = Infinity, lz = Infinity, hx = -Infinity, hz = -Infinity;
    for (let q = 0; q < s.xz.length; q += 2) { lx = Math.min(lx, s.xz[q]!); hx = Math.max(hx, s.xz[q]!); lz = Math.min(lz, s.xz[q + 1]!); hz = Math.max(hz, s.xz[q + 1]!); }
    const r = reachOf(s) + 1;
    return [lx - r, lz - r, hx + r, hz + r] as const;
  });
  const makeParts = (): void => {
  parts = [];
  held = new PlannedStreets();
  bytes = 0;
  heldParts.length = 0;
  for (let col = Math.floor(frameX / SECTOR_CHUNKS); col * SECTOR_CHUNKS < frameX + chunksX; col++) {
    for (let row = Math.floor(frameZ / SECTOR_CHUNKS); row * SECTOR_CHUNKS < frameZ + chunksZ; row++) {
      const ox = col * SECTOR_CHUNKS - frameX, oz = row * SECTOR_CHUNKS - frameZ, x0 = ox * CHUNK_SIZE, z0 = oz * CHUNK_SIZE;
      const meets = (b: readonly number[]): boolean => b[2]! >= x0 && b[0]! <= x0 + span && b[3]! >= z0 && b[1]! <= z0 + span;
      const mine = new Map<number, number>();
      boxes.forEach((b, k) => { if (meets(b)) mine.set(k, mine.size); });
      const myCorners = corners.filter((c) => {
        const r = c.reach + 1 + sideReach(stretches[c.stretch]!.sides[c.side]);
        if (!meets([c.cx - r, c.cz - r, c.cx + r, c.cz + r])) return false;
        if (!mine.has(c.stretch)) mine.set(c.stretch, mine.size);
        return true;
      });
      if (mine.size === 0) continue;
      const order = [...mine.keys()];
      const part = { x0, z0, stretches: order.map((k) => stretches[k]!), corners: myCorners.map((c) => ({ ...c, stretch: mine.get(c.stretch)! })) };
      const encoded = encodeStreets(part);
      bytes += encoded.length;
      parts.push({ col, row, bytes: encoded });
      const decoded = decodeStreets(encoded, x0, z0);
      held.put(col * 4096 + row, decoded, Math.max(0, ox), Math.max(0, oz), Math.min(chunksX, ox + SECTOR_CHUNKS), Math.min(chunksZ, oz + SECTOR_CHUNKS));
      held.keep(decoded, Float64Array.from(order.flatMap((k) => [sideWear[k * 2]!, sideWear[k * 2 + 1]!])), Uint8Array.from(order.flatMap((k) => [sideAsked[k * 2]!, sideAsked[k * 2 + 1]!])));
      heldParts.push({ part: decoded, stretches: order, corners: myCorners.map((c) => corners.indexOf(c)) });
    }
  }
  };
  makeParts();
  // Where each kerb is let down flush: at the walk network's crossings, where a service road ends at a kerb, at a corner's ramp.
  const flushStretches = new Set<number>();
  stretches.forEach((s, k) => { if (kerbOf(s.sides[0].kinds) === 1 && kerbOf(s.sides[1].kinds) === 1) flushStretches.add(k); });
  const crossings = graph.crossings.map((c) => ({ ...c, ax: c.ax - grid.x0, az: c.az - grid.z0, bx: c.bx - grid.x0, bz: c.bz - grid.z0 }));
  const drops = dropsOf(held, heldParts, crossings, flushStretches, stretches);
  stretches.forEach((s, k) => { stretches[k] = withDrops(s, k, drops.sides); });
  corners = corners.map((c, k) => cornerWithDrops(c, k, drops.corners));
  makeParts();
  log(`streets: kerbs let down at ${drops.count.crossings} crossings, ${drops.count.drives} drives and ${drops.count.ramps} corners' ramps`);
  const overlayUse = entries.map((e) => ({ at: `${e.file}:${e.line}`, stretches: applied.reduce((n, a) => n + (a.some((x) => x.entry === e) ? 1 : 0), 0) }));
  const summary = {
    stretches: runs.length, km: round(fits.reduce((n, f) => n + f.length, 0) / 1000, 1), corners: corners.length, parts: parts.length, bytes, drops: drops.count,
    types: Object.fromEntries([...typeCount].sort((a, b) => b[1].km - a[1].km).map(([k, v]) => [k, { stretches: v.stretches, km: round(v.km, 1) }])),
    rules: Object.fromEntries([...ruleCount].sort((a, b) => b[1] - a[1])), sets: Object.fromEntries([...setCount].sort((a, b) => b[1] - a[1])), overlay: overlayUse,
    conflicts: settled.map((c) => conflictRecord(c, all)), asked: { fields: asks, differ },
  };
  log(`streets: the overlay set ${asks} fields of a side, ${differ.length} not in effect as asked${differ.length > 0 ? " (each in the report's summary.asked, and street.ts shows it with its stretch):" : ""}`);
  for (const d of differ.slice(0, 20)) log(`streets:   ${d}`);
  if (existsSync(report)) {
    writeFileSync(join(report, "streets.json"), `{\n"summary": ${JSON.stringify(summary)},\n"types": ${JSON.stringify(rules.types)},\n"stretches": [\n${records.join(",\n")}\n]\n}\n`);
  }
  log(`streets: ${runs.length} stretches of ${types.length} types, ${corners.length} corners, ${entries.length} overlay entries; ${parts.length} parts of ${(bytes / 1048576).toFixed(2)} MB, in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return { parts, held, types, summary };
}

