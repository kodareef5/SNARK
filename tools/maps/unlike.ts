// What two built maps hold differently below their parts, each thing with its place on the lattice, for the local gate
// (local-gate.ts): static pieces, what the head lists by place, and the street stretches their builds reported. A part
// that differs says only that its square does; these say where in it.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { bendOf, type MapFile } from "../../shared/world/mapfile.ts";
import { Base } from "../mapworld/base.ts";

/** One thing a map alone holds: its kind ("piece", "vehicle", "stretch" and so on), its place in lattice metres, how far it reaches from there, and what it is. */
export interface Unlike { readonly kind: string; readonly x: number; readonly z: number; readonly reach: number; readonly what: string }

/** Keys with how many of each and a place, compared: each key one side holds more of than the other, once for each more. */
type Tally = Map<string, [number, number, number]>;
const count = (into: Tally, key: string, x: number, z: number): void => {
  const had = into.get(key);
  if (had) had[0]++;
  else into.set(key, [1, x, z]);
};
function only(kind: string, a: Tally, b: Tally, out: Unlike[]): void {
  for (const [side, p, q] of [["a", a, b], ["b", b, a]] as const) {
    for (const [k, [n, x, z]] of p) for (let i = q.get(k)?.[0] ?? 0; i < n; i++) out.push({ kind, x, z, reach: 0, what: `only ${side}: ${k}` });
  }
}

/** The ground two maps both hold, in lattice metres: its east, south, west and north edges (x counts west, z north). */
export function shared(a: MapFile, b: MapFile): [number, number, number, number] {
  const [da, db] = [a.dims, b.dims];
  return [Math.max(da.frameX, db.frameX), Math.max(da.frameZ, db.frameZ), Math.min(da.frameX + da.chunksX, db.frameX + db.chunksX), Math.min(da.frameZ + da.chunksZ, db.frameZ + db.chunksZ)].map((v) => v * CHUNK_SIZE) as [number, number, number, number];
}

/**
 * The static pieces and the head's placed rows (vehicles, spawn points and regions, landmarks, Tide Eyes, orbs) that
 * one of two maps alone holds on the ground both hold. A piece is its kind, place, yaw and bend; a row all it says.
 */
export function unlikePlaces(a: MapFile, b: MapFile): Unlike[] {
  const out: Unlike[] = [], [x0, z0, x1, z1] = shared(a, b);
  const pieces = (m: MapFile, cx: number, cz: number): Tally => {
    const into: Tally = new Map(), s = m.statics, c = (cz - m.dims.frameZ) * m.dims.chunksX + (cx - m.dims.frameX), bends = s.bends.get(c);
    for (let r = s.first[c]!; r < s.first[c + 1]!; r++) {
      const [x, z] = [s.x[r]! + m.dims.frameX * CHUNK_SIZE, s.z[r]! + m.dims.frameZ * CHUNK_SIZE], bend = bendOf(bends, r - s.first[c]!);
      count(into, `${s.kinds[s.kind[r]!]} ${x.toFixed(4)} ${s.y[r]!.toFixed(4)} ${z.toFixed(4)} yaw ${s.yaw[r]}${bend ? ` bend ${Array.from(bend).join(",")}` : ""}`, x, z);
    }
    return into;
  };
  for (let cz = z0 / CHUNK_SIZE; cz < z1 / CHUNK_SIZE; cz++) for (let cx = x0 / CHUNK_SIZE; cx < x1 / CHUNK_SIZE; cx++) only("piece", pieces(a, cx, cz), pieces(b, cx, cz), out);
  // A row's place is its x and z, or the first two numbers of its `at`.
  type Row = { x?: number; z?: number; at?: readonly number[] };
  const rows = (m: MapFile, list: readonly Row[] | undefined): Tally => {
    const into: Tally = new Map();
    for (const r of list ?? []) {
      const [x, z] = [(r.at ? r.at[0]! : r.x!) + m.dims.frameX * CHUNK_SIZE, (r.at ? r.at[1]! : r.z!) + m.dims.frameZ * CHUNK_SIZE];
      if (x >= x0 && x < x1 && z >= z0 && z < z1) count(into, JSON.stringify({ ...r, ...(r.at ? { at: [x, z, ...r.at.slice(2)] } : { x, z }) }), x, z);
    }
    return into;
  };
  const lists: [string, (m: MapFile) => readonly Row[] | undefined][] = [
    ["vehicle", (m) => m.vehicles], ["spawn point", (m) => m.spawns], ["spawn region", (m) => m.regions as readonly Row[] | undefined],
    ["landmark", (m) => m.content?.landmarks], ["tide eye", (m) => m.tideEyes as readonly Row[] | undefined], ["orb", (m) => m.orbs as readonly Row[] | undefined],
  ];
  for (const [kind, of] of lists) only(kind, rows(a, of(a)), rows(b, of(b)), out);
  return out;
}

interface Stretch { id: string; i?: number; run?: number; seed?: number; length: number; mid: [number, number]; pair?: unknown }

/**
 * The street stretches two cuts' builds told differently in their reports (reports/<ruins>/streets.json): its type, its
 * rule, its facts and fit, its sides. A stretch is known by its id and its middle; its number, run and seed are left out,
 * as is which stretch pairs it. Its reach is half its length.
 */
export function unlikeStretches(cutA: string, cutB: string): Unlike[] {
  const load = (cut: string): Map<string, { x: number; z: number; reach: number; told: string }> => {
    const out = new Map<string, { x: number; z: number; reach: number; told: string }>(), reports = join(cut, "reports");
    const file = existsSync(reports) ? readdirSync(reports).map((d) => join(reports, d, "streets.json")).find(existsSync) : undefined;
    if (!file) return out;
    const base = new Base(cut);
    for (const r of (JSON.parse(readFileSync(file, "utf8")) as { stretches: Stretch[] }).stretches) {
      const [e, n] = base.tm.forward(r.mid[0], r.mid[1]);
      const told = JSON.stringify({ ...r, i: 0, run: 0, seed: 0, pair: r.pair ? true : null });
      out.set(`${r.id} ${r.mid.join(",")}`, { x: base.info.frame[0] * CHUNK_SIZE + (base.grid.east - e), z: base.info.frame[1] * CHUNK_SIZE + (n - base.grid.south), reach: r.length / 2, told });
    }
    return out;
  };
  const [a, b] = [load(cutA), load(cutB)], out: Unlike[] = [];
  for (const [side, p, q] of [["a", a, b], ["b", b, a]] as const) {
    for (const [k, s] of p) {
      const other = q.get(k);
      if (other?.told === s.told || (other && side === "b")) continue;
      out.push({ kind: "stretch", x: s.x, z: s.z, reach: s.reach, what: other ? `told differently: ${k}` : `only ${side}: ${k}` });
    }
  }
  return out;
}
