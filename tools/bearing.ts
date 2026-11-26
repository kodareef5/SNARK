// What the support rule (shared/world/bearing.ts) says of a map's buildings as the map placed them, nothing broken:
//
//   bun tools/bearing.ts <map.snmap> [--examples n] [--building id]
//
// Every building is gathered whole and judged. A piece that does not stand is one the rule would drop or hang by itself,
// so it is pinned at run time. This prints their share by family, by shape and by the building's recipe, the cost of a
// judgement, and some of them. It also counts the buildings that would lose a storey as placed by the storey rule at the
// default share: none should. With --building it prints one building's pieces level by level.

import { readFileSync } from "node:fs";
import { CORE_CONTENT } from "../content/core.ts";
import { BREAK_FAMILIES } from "../shared/content/breaks.ts";
import { compileContent, withContent, type Registry } from "../shared/content/registry.ts";
import { FALLS, HANGS, PART_FIXED, PART_PLATE, PIN_ALWAYS, Pieces, STANDS, VERDICT, cost, gather, judge, pins } from "../shared/world/bearing.ts";
import { BUILDING_SPANS, type Buildings } from "../shared/world/buildings.ts";
import { parseMap, placeStatics } from "../shared/world/mapfile.ts";
import { StructureStore } from "../shared/world/structures.ts";

export interface BearingCount {
  pieces: number;
  judged: number;
  hang: number;
  fall: number;
  /** Of those, the pieces that touch nothing, and so stand whatever falls. */
  always: number;
}

export interface BearingReport {
  readonly buildings: number;
  /** Buildings with a piece that does not stand. */
  readonly pinned: number;
  /** Buildings that lose a storey as placed, pins and all, by the storey rule at `share`: there should be none. */
  readonly failing: number;
  readonly all: BearingCount;
  readonly families: Record<string, BearingCount>;
  readonly shapes: Record<string, BearingCount>;
  readonly recipes: Record<string, BearingCount>;
  /** Operations of the costliest judgement, its pieces, and milliseconds for every building's. */
  readonly mostOps: number;
  readonly mostPieces: number;
  readonly ms: number;
  readonly examples: string[];
}

const blank = (): BearingCount => ({ pieces: 0, judged: 0, hang: 0, fall: 0, always: 0 });

/** Each building of `buildings` once, as every sector's handle of it. */
export function* eachBuilding(buildings: Buildings): IterableIterator<number[]> {
  const seen = new Set<number>();
  for (const handle of buildings.handles()) {
    if ((buildings.flags(handle) & BUILDING_SPANS) === 0) {
      yield [handle];
      continue;
    }
    const id = buildings.id(handle);
    if (seen.has(id)) continue;
    seen.add(id);
    const all: number[] = [];
    buildings.byId(id, all);
    yield all;
  }
}

/** Judges every building of a map set down in `structs` as placed. */
export function bearingReport(buildings: Buildings, structs: StructureStore, reg: Registry, examples = 0, share = 0.25): BearingReport {
  const families: Record<string, BearingCount> = {}, shapes: Record<string, BearingCount> = {}, recipes: Record<string, BearingCount> = {};
  const all = blank();
  const pieces = new Pieces();
  let out = new Uint8Array(1024), pin = new Uint8Array(1024), again = new Uint8Array(1024);
  let n = 0, pinned = 0, failing = 0, mostOps = 0, mostPieces = 0, ms = 0;
  const shown: string[] = [];
  const seenWhy = new Map<string, number>();
  for (const handles of eachBuilding(buildings)) {
    n++;
    const t0 = performance.now();
    gather(buildings, handles, structs, reg, true, pieces);
    if (out.length < pieces.n) [out, pin, again] = [new Uint8Array(pieces.n * 2), new Uint8Array(pieces.n * 2), new Uint8Array(pieces.n * 2)];
    const down = judge(pieces, out);
    ms += performance.now() - t0;
    if (cost.ops > mostOps) [mostOps, mostPieces] = [cost.ops, pieces.n];
    if (down > 0) {
      pinned++;
      pins(pieces, pin, again);
      if (judge(pieces, again, pin) !== 0) throw new Error(`building ${buildings.id(handles[0]!)} does not stand with its pins`);
    } else pin.fill(0, 0, pieces.n);
    if (share > 0 && judge(pieces, again, pin, share) !== 0) failing++;
    const recipe = (recipes[buildings.recipe(handles[0]!)] ??= blank());
    for (let k = 0; k < pieces.n; k++) {
      const ref = pieces.ref[k]!;
      const id = reg.ids[structs.mapKind(Math.floor(ref / 65536), ref & 0xffff)]!;
      const shape = id.split("_")[1] ?? id;
      const rows = [all, recipe, (families[BREAK_FAMILIES[pieces.family[k]!]!] ??= blank()), (shapes[shape] ??= blank())];
      for (const c of rows) {
        c.pieces++;
        if (pieces.part[k] !== PART_FIXED) c.judged++;
        if ((out[k]! & VERDICT) === HANGS) c.hang++;
        if ((out[k]! & VERDICT) === FALLS) c.fall++;
        if (pin[k] === PIN_ALWAYS) c.always++;
      }
      if ((out[k]! & VERDICT) !== STANDS && examples > 0) {
        const key = `${shape} ${buildings.recipe(handles[0]!)} ${buildings.collapse(handles[0]!)}`;
        const seen = seenWhy.get(key) ?? 0;
        seenWhy.set(key, seen + 1);
        if (seen === 0 && shown.length < examples) shown.push(`${(out[k]! & VERDICT) === HANGS ? "hangs" : "falls"} ${shape} ${pieces.part[k] === PART_PLATE ? "plate" : "rider"} level ${pieces.level[k]} tall ${pieces.tall[k]} at ${pieces.u0[k]}..${pieces.u1[k]}, ${pieces.v0[k]}..${pieces.v1[k]} of ${pieces.cols}x${pieces.rows} walked ${pieces.playable}; ${buildings.recipe(handles[0]!)} ${buildings.form(handles[0]!)} ${buildings.collapse(handles[0]!)} id ${buildings.id(handles[0]!)}`);
      }
    }
  }
  const worst = [...seenWhy.entries()].sort((a, b) => b[1] - a[1]).slice(0, examples).map(([key, count]) => `${String(count).padStart(8)} ${key}`);
  return { buildings: n, pinned, failing, all, families, shapes, recipes, mostOps, mostPieces, ms, examples: [...worst, "", ...shown] };
}

const share = (c: BearingCount): string => `${String(c.pieces).padStart(9)} ${String(c.judged).padStart(9)} ${((100 * c.hang) / Math.max(1, c.pieces)).toFixed(2).padStart(6)} ${((100 * c.fall) / Math.max(1, c.pieces)).toFixed(2).padStart(6)} ${((100 * c.always) / Math.max(1, c.pieces)).toFixed(2).padStart(8)}`;

export function bearingLines(r: BearingReport, most = 24): string[] {
  const lines = [`${r.buildings} buildings, ${r.pinned} with a piece that does not stand as placed, ${r.failing} that lose a storey as placed; ${r.ms.toFixed(0)} ms to judge all; the costliest ${r.mostOps} operations for ${r.mostPieces} pieces`];
  lines.push(`${"".padEnd(16)} ${"pieces".padStart(9)} ${"judged".padStart(9)} ${"hang %".padStart(6)} ${"fall %".padStart(6)} ${"always %".padStart(8)}`);
  lines.push(`${"all".padEnd(16)} ${share(r.all)}`, `${r.all.hang} hang, ${r.all.fall} fall, ${r.all.always} of them with nothing under or beside them`);
  for (const [title, table] of [["by family", r.families], ["by shape", r.shapes], ["by recipe", r.recipes]] as const) {
    lines.push("", title);
    const rows = Object.entries(table).sort((a, b) => b[1].hang + b[1].fall - a[1].hang - a[1].fall).slice(0, most);
    for (const [name, c] of rows) lines.push(`${name.padEnd(16)} ${share(c)}`);
  }
  return [...lines, "", ...r.examples];
}

if (import.meta.main) {
  const words = process.argv.slice(2);
  const number = (flag: string): number => (words.includes(flag) ? Number(words[words.indexOf(flag) + 1]) : 0);
  const file = words.find((w, k) => !w.startsWith("--") && !words[k - 1]?.startsWith("--"));
  if (!file) throw new Error("bun tools/bearing.ts <map.snmap> [--examples n] [--building id]");
  const map = parseMap(new Uint8Array(readFileSync(file)), false);
  if (!map.buildings) throw new Error(`${file} holds no buildings`);
  const { registry, errors } = compileContent(CORE_CONTENT);
  if (!registry) throw new Error(errors.join("\n"));
  const reg = withContent(registry, map.content?.defs ?? []);
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const one = number("--building");
  if (one > 0) {
    const handles: number[] = [];
    map.buildings.byId(one, handles);
    const p = gather(map.buildings, handles, structs, reg, true);
    const out = new Uint8Array(p.n);
    judge(p, out);
    console.log(`${map.buildings.name(handles[0]!) ?? map.buildings.kind(handles[0]!)}: ${p.n} pieces, ${p.cols} by ${p.rows} tiles, ${map.buildings.storeys(handles[0]!)} storeys, ${p.playable} walked, ${map.buildings.recipe(handles[0]!)} ${map.buildings.form(handles[0]!)} ${map.buildings.collapse(handles[0]!)}, ${cost.ops} operations`);
    const rows = Array.from({ length: p.n }, (_, k) => k).sort((a, b) => p.level[a]! - p.level[b]! || p.part[a]! - p.part[b]!);
    for (const k of rows) {
      const ref = p.ref[k]!;
      console.log(`${["stands", "HANGS", "FALLS"][out[k]! & VERDICT]!.padEnd(6)} level ${String(p.level[k]).padStart(2)} tall ${p.tall[k]} ${["fixed", "plate", "rider"][p.part[k]!]} ${(reg.ids[structs.mapKind(Math.floor(ref / 65536), ref & 0xffff)]!.replace("core:zruin_", "")).padEnd(24)} ${p.u0[k]}..${p.u1[k]}, ${p.v0[k]}..${p.v1[k]} bits ${p.bits[k]}`);
    }
  } else for (const line of bearingLines(bearingReport(map.buildings, structs, reg, number("--examples") || 30))) console.log(line);
}
