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
// (n, s, e or w) keeps a `set` to the side facing that way. Then a `type`, a `set` of section fields, or both, and a
// `reason`, which every entry has. An entry that matches no stretch stops the build, naming its file and line. Where
// two entries set one field, the more particular wins (area, then way, then line, then at), and of two as particular
// the later in the files' order (by name) and their lines'.

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
const ALLOWED = new Set(["way", "at", "line", "area", "name", "class", "side", "type", "set", "reason"]);

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
      out.push({
        file, line: k + 1, key, ...(key === "way" ? { way: e.way as number } : {}), ...(key === "at" ? { at: e.at as [number, number] } : {}),
        ...(key === "line" || key === "area" ? { path: e[key] as [number, number][] } : {}), ...(e.name !== undefined ? { name: String(e.name) } : {}),
        ...(e.class !== undefined ? { class: String(e.class) } : {}), ...(e.side !== undefined ? { side: e.side as "n" } : {}),
        ...(e.type !== undefined ? { type: e.type as string } : {}), ...(e.set !== undefined ? { set: e.set as Section } : {}), reason: e.reason, text,
      });
    });
  }
  return out;
}

/** Whether a file's entries are sorted, as street.ts --sort writes them: by key, then way, place or first point. */
export function sortedKey(e: OverlayEntry): string {
  const lead = e.way !== undefined ? String(e.way).padStart(12, "0") : e.at ? `${e.at[0].toFixed(6)},${e.at[1].toFixed(6)}` : `${e.path![0]![0].toFixed(6)},${e.path![0]![1].toFixed(6)}`;
  return `${RANK[e.key]}:${lead}:${e.text}`;
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
 * Each stretch's entries, those that match it, in the order they apply (the least particular first), with the sides a
 * `set` reaches. `toMap` turns longitude and latitude into the map's metres; `className` gives a run's class as the rules
 * read it. Throws on an entry that matches nothing.
 */
export function matchOverlay(entries: readonly OverlayEntry[], runs: readonly Run[], toMap: (lon: number, lat: number) => [number, number], className: (r: Run) => string): Applied[][] {
  const out: Applied[][] = runs.map(() => []);
  const middles = runs.map((r) => middleOf(r.xz));
  const order = entries.map((e, k) => [e, k] as const).sort((a, b) => RANK[a[0].key] - RANK[b[0].key] || a[1] - b[1]);
  for (const [e] of order) {
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
    for (const k of hits) out[k]!.push({ entry: e, sides: e.side ? sidesFacing(runs[k]!, e.side) : [0, 1] });
  }
  return out;
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
