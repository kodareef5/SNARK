// The streets' overlay (planning/workstreams/streets.md, layer 4): what people and agents write over the rules for a
// street, a stretch of one or a whole neighbourhood, in the city's folder (assets/source/maps/<city>/streets/*.jsonl,
// which tools/maps/city.ts copies into the work folder's streets/). One entry a line, as JSON:
//
//   {"way": 11115704, "name": "Northwest South River Drive", "type": "residential-tidy", "reason": "houses and lawns"}
//   {"at": [-80.1951, 25.7733], "side": "n", "set": {"walk": "full"}, "reason": "an arcade's walk to the shop fronts"}
//   {"line": [[-80.19, 25.77], [-80.19, 25.78]], "set": {"verge": "dirt"}, "reason": "..."}
//   {"area": [[-80.2, 25.77], [-80.19, 25.77], [-80.19, 25.78]], "type": "residential-rough", "reason": "..."}
//
// Each names what it is for by exactly one of `way` (an OpenStreetMap way: every stretch cut from it), `at` (the one
// stretch nearest a point, within AT_WITHIN metres), `line` (every stretch whose middle lies within LINE_WITHIN metres of
// the line and runs along it) or `area` (every stretch whose middle is inside the ring), all in longitude and latitude,
// which a new cut or download leaves where they were. `name` and `class`, where given, must be the stretch's too; `side`
// (n, s, e or w) keeps a `set` to the side facing that way. Then a `type`, a `set` of section fields, or both, a
// `priority` where it is wanted, and a `reason`, which every entry has. An entry that matches no stretch, or whose side
// is no side of any it matches, stops the build, naming its file and line.
//
// Where two entries set one field of a stretch's side, the more particular wins (area, then way, then line, then at);
// of two as particular, the higher `priority` (0 where none is given). The order of the files and of their lines never
// counts: many people and agents write at once, and street.ts --sort reorders a file's lines. Two entries as particular
// and of one priority that would set a field to different values are a conflict, and stop the build, every conflict
// named with both entries' files and lines: one of them wins only where its author has said so by a priority. Those a
// priority settles are listed in the build's report.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSection, type Section } from "./rules.ts";
import type { Run } from "./fit.ts";

export const AT_WITHIN = 15;
export const LINE_WITHIN = 8;
/** How near parallel a stretch runs to a `line` entry's nearest piece: the cosine of 25 degrees. */
const LINE_COS = 0.9;
const KEYS = ["way", "at", "line", "area"] as const;
type Key = (typeof KEYS)[number];
const RANK: Record<Key, number> = { area: 0, way: 1, line: 2, at: 3 };
const ALLOWED = new Set(["way", "at", "line", "area", "name", "class", "side", "type", "set", "priority", "reason"]);

export interface OverlayEntry {
  readonly file: string;
  readonly line: number;
  readonly key: Key;
  readonly way?: number;
  readonly at?: readonly [number, number];
  readonly path?: readonly (readonly [number, number])[];
  readonly name?: string;
  readonly class?: string;
  readonly side?: "n" | "s" | "e" | "w";
  readonly type?: string;
  readonly set?: Section;
  /** Of two entries as particular, the higher wins; 0 where the line gives none. */
  readonly priority: number;
  readonly reason: string;
  readonly text: string;
}

/** The overlay's entries in a work folder's streets/, every file in its name's order and each line in its own, checked. */
export function readOverlay(folder: string, types: readonly string[]): OverlayEntry[] {
  const dir = join(folder, "streets");
  if (!existsSync(dir)) return [];
  const out: OverlayEntry[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
    readFileSync(join(dir, file), "utf8").split("\n").forEach((text, k) => {
      const where = `streets/${file}:${k + 1}`;
      if (!text.trim()) return;
      let e: Record<string, unknown>;
      try { e = JSON.parse(text) as Record<string, unknown>; } catch (err) { throw new Error(`${where}: not a line of JSON (${(err as Error).message})`); }
      for (const name of Object.keys(e)) if (!ALLOWED.has(name)) throw new Error(`${where}: "${name}" is no key of an entry (${[...ALLOWED].join(", ")})`);
      const keys = KEYS.filter((name) => e[name] !== undefined);
      if (keys.length !== 1) throw new Error(`${where}: an entry names its streets by one of way, at, line or area`);
      const key = keys[0]!;
      const lonLat = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number" && Math.abs(v[0]) <= 180 && Math.abs(v[1]) <= 90;
      if (key === "way" && !Number.isInteger(e.way)) throw new Error(`${where}: "way" is an OpenStreetMap way's number`);
      if (key === "at" && !lonLat(e.at)) throw new Error(`${where}: "at" is a [longitude, latitude]`);
      if ((key === "line" || key === "area") && !(Array.isArray(e[key]) && (e[key] as unknown[]).length >= (key === "area" ? 3 : 2) && (e[key] as unknown[]).every(lonLat))) throw new Error(`${where}: "${key}" is a list of [longitude, latitude]`);
      if (typeof e.reason !== "string" || e.reason.trim().length < 4) throw new Error(`${where}: every entry gives its reason`);
      if (e.type === undefined && e.set === undefined) throw new Error(`${where}: an entry sets a type, a section's fields or both`);
      if (e.type !== undefined && !types.includes(e.type as string)) throw new Error(`${where}: type "${String(e.type)}" is none of the street types (${types.join(", ")})`);
      if (e.set !== undefined) checkSection(e.set as Section, where);
      if (e.side !== undefined && !["n", "s", "e", "w"].includes(e.side as string)) throw new Error(`${where}: "side" is n, s, e or w`);
      if (e.side !== undefined && e.set === undefined) throw new Error(`${where}: a side is for a set; a type is the whole stretch's`);
      if (e.priority !== undefined && !(typeof e.priority === "number" && Number.isFinite(e.priority))) throw new Error(`${where}: "priority" is a number, the higher winning`);
      out.push({
        file, line: k + 1, key, ...(key === "way" ? { way: e.way as number } : {}), ...(key === "at" ? { at: e.at as [number, number] } : {}),
        ...(key === "line" || key === "area" ? { path: e[key] as [number, number][] } : {}), ...(e.name !== undefined ? { name: String(e.name) } : {}),
        ...(e.class !== undefined ? { class: String(e.class) } : {}), ...(e.side !== undefined ? { side: e.side as "n" } : {}),
        ...(e.type !== undefined ? { type: e.type as string } : {}), ...(e.set !== undefined ? { set: e.set as Section } : {}), priority: (e.priority as number | undefined) ?? 0, reason: e.reason, text,
      });
    });
  }
  return out;
}

/**
 * An entry's place in its file, as street.ts --sort writes them: by key, then way, place or first point, then its text.
 * It is also how two entries as particular and of one priority are ordered as they apply, so sorting a file changes
 * nothing built.
 */
export function sortedKey(e: Pick<OverlayEntry, "key" | "way" | "at" | "path" | "text">): string {
  const lead = e.way !== undefined ? String(e.way).padStart(12, "0") : e.at ? `${e.at[0].toFixed(6)},${e.at[1].toFixed(6)}` : `${e.path![0]![0].toFixed(6)},${e.path![0]![1].toFixed(6)}`;
  return `${RANK[e.key]}:${lead}:${e.text}`;
}

/** A file of the overlay's text with its entries in sortedKey's order, one a line, blank lines left out: street.ts --sort. */
export function sortOverlay(text: string, file: string): string {
  const keyed = text.split("\n").flatMap((line, k) => {
    if (!line.trim()) return [];
    let e: Record<string, unknown>;
    try { e = JSON.parse(line) as Record<string, unknown>; } catch (err) { throw new Error(`streets/${file}:${k + 1}: not a line of JSON (${(err as Error).message})`); }
    const key = KEYS.find((name) => e[name] !== undefined);
    if (!key) throw new Error(`streets/${file}:${k + 1}: an entry names its streets by one of way, at, line or area`);
    return [{ line, key: sortedKey({ key, way: e.way as number | undefined, at: e.at as [number, number] | undefined, path: (e.line ?? e.area) as [number, number][] | undefined, text: line }) }];
  });
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return keyed.map((k) => `${k.line}\n`).join("");
}

/**
 * The order entries apply in, the least particular first, so the last that sets a field wins: by key (area, way, line,
 * at), then priority, then sortedKey; two of one text (the same entry twice) by file and line, which decides nothing.
 */
function applyOrder(entries: readonly OverlayEntry[]): OverlayEntry[] {
  const keys = new Map(entries.map((e) => [e, sortedKey(e)]));
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return [...entries].sort((a, b) => RANK[a.key] - RANK[b.key] || a.priority - b.priority || cmp(keys.get(a)!, keys.get(b)!) || cmp(a.file, b.file) || a.line - b.line);
}

const middleOf = (xz: Float64Array): [number, number] => {
  const n = xz.length / 2, m = Math.floor(n / 2);
  return n % 2 ? [xz[m * 2]!, xz[m * 2 + 1]!] : [(xz[m * 2 - 2]! + xz[m * 2]!) / 2, (xz[m * 2 - 1]! + xz[m * 2 + 1]!) / 2];
};
const toSegment = (x: number, z: number, ax: number, az: number, bx: number, bz: number): number => {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez, t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
  return Math.hypot(x - ax - ex * t, z - az - ez * t);
};

/** What an entry did to a stretch, for its report. */
export interface Applied { readonly entry: OverlayEntry; readonly sides: readonly number[] }

/**
 * Each stretch's entries, those that match it, in the order they apply (the least particular first, applyOrder), with
 * the sides a `set` reaches. `toMap` turns longitude and latitude into the map's metres; `className` gives a run's class
 * as the rules read it. Throws on an entry that matches nothing, on one whose side is no side of any stretch it matches,
 * and on any conflict (overlayConflicts), every conflict named.
 */
export function matchOverlay(entries: readonly OverlayEntry[], runs: readonly Run[], toMap: (lon: number, lat: number) => [number, number], className: (r: Run) => string): Applied[][] {
  const out: Applied[][] = runs.map(() => []);
  const middles = runs.map((r) => middleOf(r.xz));
  for (const e of applyOrder(entries)) {
    const fits = (r: Run): boolean => (e.name === undefined || r.name === e.name) && (e.class === undefined || className(r) === e.class);
    let hits: number[] = [];
    if (e.key === "way") hits = runs.flatMap((r, k) => (r.way === e.way && fits(r) ? [k] : []));
    else if (e.key === "at") {
      const [x, z] = toMap(e.at![0], e.at![1]);
      let best = -1, near = AT_WITHIN;
      runs.forEach((r, k) => {
        if (!fits(r)) return;
        for (let q = 2; q < r.xz.length; q += 2) {
          const d = toSegment(x, z, r.xz[q - 2]!, r.xz[q - 1]!, r.xz[q]!, r.xz[q + 1]!);
          if (d < near) { near = d; best = k; }
        }
      });
      if (best >= 0) hits = [best];
    } else {
      const path = e.path!.map(([lon, lat]) => toMap(lon, lat));
      if (e.key === "line") {
        hits = runs.flatMap((r, k) => {
          if (!fits(r)) return [];
          const [mx, mz] = middles[k]!;
          let best = Infinity, cos = 0;
          for (let i = 1; i < path.length; i++) {
            const d = toSegment(mx, mz, path[i - 1]![0], path[i - 1]![1], path[i]![0], path[i]![1]);
            if (d < best) {
              best = d;
              const lx = path[i]![0] - path[i - 1]![0], lz = path[i]![1] - path[i - 1]![1], rx = r.xz[r.xz.length - 2]! - r.xz[0]!, rz = r.xz[r.xz.length - 1]! - r.xz[1]!;
              cos = Math.abs(lx * rx + lz * rz) / (Math.hypot(lx, lz) * Math.hypot(rx, rz) || 1);
            }
          }
          return best <= LINE_WITHIN && cos >= LINE_COS ? [k] : [];
        });
      } else {
        hits = runs.flatMap((r, k) => {
          if (!fits(r)) return [];
          const [x, z] = middles[k]!;
          let hit = false;
          for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
            const [xi, zi] = path[i]!, [xj, zj] = path[j]!;
            if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
          }
          return hit ? [k] : [];
        });
      }
    }
    if (hits.length === 0) throw new Error(`streets/${e.file}:${e.line}: matches no stretch of a street in this cut (${e.text.trim()})`);
    // A side keeps the entry's set to the stretches with a side facing it (its type, if it has one, is each stretch's);
    // a side that faces none of them reaches nothing.
    const reached = hits.map((k) => (e.side ? sidesFacing(runs[k]!, e.side) : [0, 1]));
    if (reached.every((s) => s.length === 0)) {
      const faces = hits.slice(0, 6).map((k) => `${runs[k]!.id}${runs[k]!.name ? ` (${runs[k]!.name})` : ""} faces ${facing(runs[k]!)}`).join("; ");
      throw new Error(`streets/${e.file}:${e.line}: its side "${e.side}" is no side of the ${hits.length} stretch${hits.length > 1 ? "es" : ""} it matches: ${faces}${hits.length > 6 ? `; and ${hits.length - 6} more` : ""} (${e.text.trim()})`);
    }
    hits.forEach((k, n) => { if (reached[n]!.length || e.type !== undefined) out[k]!.push({ entry: e, sides: reached[n]! }); });
  }
  const conflicts = overlayConflicts(out).filter((c) => !c.settled);
  if (conflicts.length) {
    throw new Error([
      `streets: ${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""} in the overlay: two entries as particular and of one priority set a field to different values. Give the one meant to win a higher "priority", or take one out.`,
      ...conflicts.map((c) => `  ${conflictText(c, runs)}`),
    ].join("\n"));
  }
  return out;
}

/** The compass points each side of a run faces (sidesFacing), left and then right: "n and s", or "n/e and s/w" at 45 degrees. */
function facing(r: Run): string {
  const points = ["n", "e", "s", "w"] as const;
  return [0, 1].map((s) => points.filter((p) => sidesFacing(r, p).includes(s)).join("/")).join(" and ");
}

/**
 * Two entries as particular that would set one field of a stretch's side to different values, the one that wins by the
 * order they apply in and the other: settled where the winner's priority is the higher, else a conflict, which stops
 * the build. `stretches` is how many stretches it is over and `first` the first of them, by its index in the runs.
 */
export interface Conflict {
  readonly field: string;
  readonly winner: OverlayEntry;
  readonly other: OverlayEntry;
  readonly settled: boolean;
  readonly stretches: number;
  readonly first: number;
}

const valueOf = (e: OverlayEntry, field: string): string | undefined => {
  const v = field === "type" ? e.type : (e.set as Record<string, unknown> | undefined)?.[field];
  return v === undefined ? undefined : JSON.stringify(v);
};

/**
 * Where entries as particular disagree, from matchOverlay's lists: for each field (the type, and each section field a
 * side at a time) of each stretch, the entries of the winner's key that set it to another value than the winner's. Only
 * the entries that decide a field are looked at: where a more particular entry, or a higher priority, sets it after
 * them, their order changes nothing. In the order of their first stretch, then of their files and lines.
 */
export function overlayConflicts(applied: readonly Applied[][]): Conflict[] {
  const found = new Map<string, { field: string; winner: OverlayEntry; other: OverlayEntry; stretches: Set<number>; first: number }>();
  applied.forEach((over, k) => {
    if (over.length < 2) return;
    const fields = new Set<string>();
    for (const a of over) {
      if (a.entry.type !== undefined) fields.add("type");
      for (const f of Object.keys(a.entry.set ?? {})) fields.add(f);
    }
    for (const field of fields) {
      for (const side of field === "type" ? [-1] : [0, 1]) {
        const setters = over.filter((a) => valueOf(a.entry, field) !== undefined && (side < 0 || a.sides.includes(side)));
        const winner = setters.at(-1);
        if (!winner) continue;
        const value = valueOf(winner.entry, field);
        for (const a of setters) {
          if (a === winner || a.entry.key !== winner.entry.key || valueOf(a.entry, field) === value) continue;
          const id = `${winner.entry.file}:${winner.entry.line} ${a.entry.file}:${a.entry.line} ${field}`;
          const c = found.get(id) ?? found.set(id, { field, winner: winner.entry, other: a.entry, stretches: new Set(), first: k }).get(id)!;
          c.stretches.add(k);
        }
      }
    }
  });
  const at = (e: OverlayEntry): string => `${e.file}:${String(e.line).padStart(6, "0")}`;
  return [...found.values()]
    .map((c) => ({ field: c.field, winner: c.winner, other: c.other, settled: c.winner.priority > c.other.priority, stretches: c.stretches.size, first: c.first }))
    .sort((a, b) => a.first - b.first || (at(a.winner) < at(b.winner) ? -1 : at(a.winner) > at(b.winner) ? 1 : 0) || (at(a.other) < at(b.other) ? -1 : at(a.other) > at(b.other) ? 1 : 0) || (a.field < b.field ? -1 : 1));
}

/** A conflict in a line: the field, both entries' files, lines and values, the stretches, and which one wins or would. */
export function conflictText(c: Conflict, runs: readonly Run[]): string {
  const r = runs[c.first]!, where = (e: OverlayEntry): string => `streets/${e.file}:${e.line}`;
  const over = `on ${c.stretches} stretch${c.stretches > 1 ? "es" : ""} (the first ${r.id}${r.name ? `, ${r.name}` : ""})`;
  const both = `${where(c.winner)} sets ${valueOf(c.winner, c.field)} and ${where(c.other)} ${valueOf(c.other, c.field)}`;
  return c.settled
    ? `${c.field} ${over}: ${both}; ${where(c.winner)} wins by its priority, ${c.winner.priority} to ${c.other.priority}`
    : `${c.field} ${over}: ${both}, both ${c.winner.key} entries of priority ${c.winner.priority}; ${where(c.winner)} is later in the overlay's order and would win`;
}

/** A conflict as the build's report lists it. */
export function conflictRecord(c: Conflict, runs: readonly Run[]): Record<string, unknown> {
  const entry = (e: OverlayEntry): Record<string, unknown> => ({ at: `${e.file}:${e.line}`, key: e.key, priority: e.priority, value: JSON.parse(valueOf(e, c.field)!) });
  return { field: c.field, winner: entry(c.winner), other: entry(c.other), settled: c.settled, stretches: c.stretches, first: runs[c.first]!.id };
}

/**
 * The sides of a run whose way out (the normal of its line end to end, left then right of its drawn way) faces a compass
 * point within 60 degrees: in the map's metres x is west and z north.
 */
export function sidesFacing(r: Run, side: "n" | "s" | "e" | "w"): number[] {
  const ex = r.xz[r.xz.length - 2]! - r.xz[0]!, ez = r.xz[r.xz.length - 1]! - r.xz[1]!, l = Math.hypot(ex, ez) || 1;
  const want = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] }[side];
  return [0, 1].filter((s) => {
    const nx = s === 0 ? -ez / l : ez / l, nz = s === 0 ? ex / l : -ex / l;
    return nx * want[0]! + nz * want[1]! > 0.5;
  });
}
