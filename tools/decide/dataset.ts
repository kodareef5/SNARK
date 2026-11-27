// Decisions on disk, one folder a point: `.cache/decide/data/<point>/manifest.json` says what the rows are, and
// `rows.bin` holds them, flat and little-endian, one record after another:
//
//   u32 bytes in the rest of the record
//   u32 scene seed, u16 family, u16 map (places in the manifest's lists), u32 ordinal (which answer of the point in the
//   scene it was), u32 tick, i16 the chooser's pick (-1 for none), u8 tables, u8 seeds, u8 readings, u8 1 where the answer
//   as made follows (else 0), two u8 of 0,
//   f32 label (a "yes" point's observed outcome; 0 for a choice)
//   each table: u16 profile (place in the manifest's list), u16 k, f32 state, f32 k * width rows, f32 k bias, u8 k mask,
//   then u8 0 up to a multiple of four
//   f32 k * seeds * readings costs, by candidate, then seed, then reading; NaN where not run or thrown away
//   f32 seeds * readings costs of leaving the point alone at the decision ("today"); NaN where not run
//   where the point adds passes, the answer as made: f32 each table's weight, f32 k probabilities, u8 k mask, then u8 0
//   up to a multiple of four
//
// Imports only the engine, so the pipeline can leave with it.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { profileHash, type Profile } from "../../shared/decide/profile.ts";

/** The three readings of a replay's cost: one second after the decision, five, and at arrival or the horizon. */
export const READINGS = ["1s", "5s", "end"] as const;

export interface TableRow {
  profile: string;
  k: number;
  state: Float32Array;
  rows: Float32Array;
  bias: Float32Array;
  mask: Uint8Array;
}

export interface Decision {
  seed: number;
  family: string;
  map: string;
  ordinal: number;
  tick: number;
  pick: number;
  label: number;
  seeds: number;
  readings: number;
  tables: TableRow[];
  costs: Float32Array;
  today: Float32Array;
  /** Where the point adds its tables as passes: what each counted for, and the answer as the server made it. */
  final?: Final;
}

export interface Final {
  weights: Float32Array;
  out: Float32Array;
  mask: Uint8Array;
}

export interface ProfileNote {
  name: string;
  hash: number;
  state: number;
  width: number;
}

/** One generation run appended to a dataset. */
export interface RunNote {
  made: string;
  revision: string;
  /** Who chose everywhere but the labelled decision: "rule", or a trained scorer's file. */
  under: string;
  scenes: number;
  decisions: number;
  /** Scenes that gave no answer of the point; replays thrown away because the world differed at the decision; replays run with no reseed. */
  none: number;
  thrown: number;
  noReseed: number;
  /** Answers made again from their passes with `combine`, and how many came out as the server made them. */
  checked?: number;
  agreed?: number;
}

export interface Manifest {
  point: string;
  kind: "choice" | "yes";
  profiles: ProfileNote[];
  families: string[];
  maps: string[];
  /** Each scene a decision came from, in the order of the rows. */
  scenes: { seed: number; family: string; map: string }[];
  decisions: number;
  runs: RunNote[];
}

/** Where a point's decisions are kept. */
export function dataDir(point: string, root = ".cache/decide/data"): string {
  return join(root, point);
}

const align = (n: number): number => (n + 3) & ~3;

function place(list: string[], name: string): number {
  let i = list.indexOf(name);
  if (i < 0) {
    i = list.length;
    list.push(name);
  }
  return i;
}

/** A record's bytes, its names placed in (and added to) the manifest's lists. */
export function encode(d: Decision, m: Manifest, profiles: readonly Profile[]): Uint8Array {
  let size = 4 + 4 + 4 + 4 + 4 + 2 + 1 + 1 + 1 + 3 + 4;
  for (const t of d.tables) {
    const p = profiles.find((q) => q.name === t.profile);
    if (!p) throw new Error(`a table of ${t.profile}, which is no profile given`);
    if (!m.profiles.some((n) => n.name === p.name)) m.profiles.push({ name: p.name, hash: profileHash(p), state: p.state.length, width: p.columns.length });
    size += align(4 + 4 * (t.state.length + t.rows.length + t.bias.length) + t.k);
  }
  size += 4 * (d.costs.length + d.today.length);
  const k = d.tables[0]?.k ?? 0;
  if (d.final) size += align(4 * (d.tables.length + k) + k);
  if (d.costs.length !== k * d.seeds * d.readings || d.today.length !== d.seeds * d.readings) throw new Error("costs of the wrong length");
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  let at = 0;
  const u32 = (x: number) => (v.setUint32(at, x >>> 0, true), (at += 4));
  const u16 = (x: number) => (v.setUint16(at, x, true), (at += 2));
  const u8 = (x: number) => (v.setUint8(at, x), (at += 1));
  const f32s = (a: Float32Array) => {
    for (let i = 0; i < a.length; i++, at += 4) v.setFloat32(at, a[i]!, true);
  };
  u32(size - 4);
  u32(d.seed);
  u16(place(m.families, d.family));
  u16(place(m.maps, d.map));
  u32(d.ordinal);
  u32(d.tick);
  v.setInt16(at, d.pick, true);
  at += 2;
  u8(d.tables.length);
  u8(d.seeds);
  u8(d.readings);
  u8(d.final ? 1 : 0);
  at += 2;
  v.setFloat32(at, d.label, true);
  at += 4;
  for (const t of d.tables) {
    u16(m.profiles.findIndex((n) => n.name === t.profile));
    u16(t.k);
    f32s(t.state);
    f32s(t.rows);
    f32s(t.bias);
    out.set(t.mask.subarray(0, t.k), at);
    at = align(at + t.k);
  }
  f32s(d.costs);
  f32s(d.today);
  if (d.final) {
    f32s(d.final.weights);
    f32s(d.final.out);
    out.set(d.final.mask.subarray(0, k), at);
  }
  return out;
}

/** Every record in `bytes`, read with the manifest's lists. */
export function decode(bytes: Uint8Array, m: Manifest): Decision[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Decision[] = [];
  let at = 0;
  while (at < bytes.length) {
    const end = at + 4 + v.getUint32(at, true);
    at += 4;
    const u32 = () => ((at += 4), v.getUint32(at - 4, true));
    const u16 = () => ((at += 2), v.getUint16(at - 2, true));
    const u8 = () => ((at += 1), v.getUint8(at - 1));
    const f32s = (n: number) => {
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++, at += 4) a[i] = v.getFloat32(at, true);
      return a;
    };
    const seed = u32(), family = m.families[u16()]!, map = m.maps[u16()]!, ordinal = u32(), tick = u32();
    const pick = v.getInt16(at, true);
    at += 2;
    const n = u8(), seeds = u8(), readings = u8(), made = u8();
    at += 2;
    const label = v.getFloat32(at, true);
    at += 4;
    const tables: TableRow[] = [];
    for (let i = 0; i < n; i++) {
      const p = m.profiles[u16()]!, k = u16();
      const state = f32s(p.state), rows = f32s(k * p.width), bias = f32s(k);
      const mask = bytes.slice(at, at + k);
      at = align(at + k);
      tables.push({ profile: p.name, k, state, rows, bias, mask });
    }
    const k = tables[0]?.k ?? 0;
    const costs = f32s(k * seeds * readings), today = f32s(seeds * readings);
    let final: Final | undefined;
    if (made) {
      const weights = f32s(n), probs = f32s(k), mask = bytes.slice(at, at + k);
      at = align(at + k);
      final = { weights, out: probs, mask };
    }
    if (at !== end) throw new Error(`a record of ${m.point} ends at ${at}, not ${end}`);
    out.push({ seed, family, map, ordinal, tick, pick, label, seeds, readings, tables, costs, today, ...(final ? { final } : {}) });
  }
  return out;
}

export function emptyManifest(point: string, kind: "choice" | "yes"): Manifest {
  return { point, kind, profiles: [], families: [], maps: [], scenes: [], decisions: 0, runs: [] };
}

export function readManifest(dir: string): Manifest | null {
  const file = join(dir, "manifest.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Manifest) : null;
}

/** A point's dataset: its manifest and every decision, checked against the profiles it names. */
export function readData(dir: string, profiles: readonly Profile[]): { manifest: Manifest; decisions: Decision[] } {
  const manifest = readManifest(dir);
  if (!manifest) throw new Error(`no dataset in ${dir}`);
  for (const n of manifest.profiles) {
    const p = profiles.find((q) => q.name === n.name);
    if (!p) throw new Error(`${dir} holds tables of ${n.name}, which is no profile here`);
    if (profileHash(p) !== n.hash) throw new Error(`${dir} holds tables of other columns of ${n.name}: generate it again`);
  }
  const rows = join(dir, "rows.bin");
  const decisions = existsSync(rows) ? decode(new Uint8Array(readFileSync(rows)), manifest) : [];
  if (decisions.length !== manifest.decisions) throw new Error(`${dir} says ${manifest.decisions} decisions and holds ${decisions.length}`);
  return { manifest, decisions };
}

/** Adds decisions to a dataset as they come, and keeps its manifest. */
export class Writer {
  readonly dir: string;
  readonly manifest: Manifest;
  readonly run: RunNote;
  private readonly profiles: readonly Profile[];

  constructor(dir: string, point: string, kind: "choice" | "yes", profiles: readonly Profile[], run: Omit<RunNote, "scenes" | "decisions" | "none" | "thrown" | "noReseed">, fresh = false) {
    this.dir = dir;
    this.profiles = profiles;
    mkdirSync(dir, { recursive: true });
    const kept = fresh ? null : readManifest(dir);
    if (kept && (kept.point !== point || kept.kind !== kind)) throw new Error(`${dir} holds ${kept.kind} decisions of ${kept.point}`);
    if (kept) readData(dir, profiles);
    else writeFileSync(join(dir, "rows.bin"), new Uint8Array(0));
    this.manifest = kept ?? emptyManifest(point, kind);
    this.run = { ...run, scenes: 0, decisions: 0, none: 0, thrown: 0, noReseed: 0 };
    this.manifest.runs.push(this.run);
  }

  add(d: Decision): void {
    appendFileSync(join(this.dir, "rows.bin"), encode(d, this.manifest, this.profiles));
    this.manifest.scenes.push({ seed: d.seed, family: d.family, map: d.map });
    this.manifest.decisions++;
    this.run.decisions++;
  }

  save(): void {
    writeFileSync(join(this.dir, "manifest.json"), JSON.stringify(this.manifest, null, 1));
  }
}

/** The code's revision, for a manifest or a weights file; "unknown" outside a checkout. */
export function revision(): string {
  try {
    const r = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "unknown";
  } catch {
    return "unknown";
  }
}

/** Mean cost of each candidate over the seeds it has a cost in at `reading`, NaN where it has none. */
export function meanCosts(d: Decision, reading: number): Float64Array {
  const k = d.tables[0]!.k, S = d.seeds, R = d.readings, out = new Float64Array(k);
  for (let c = 0; c < k; c++) {
    let sum = 0, n = 0;
    for (let s = 0; s < S; s++) {
      const v = d.costs[(c * S + s) * R + reading]!;
      if (!Number.isNaN(v)) {
        sum += v;
        n++;
      }
    }
    out[c] = n > 0 ? sum / n : NaN;
  }
  return out;
}

/** Mean cost of leaving the point alone at `reading`, NaN where it was not run. */
export function todayCost(d: Decision, reading: number): number {
  let sum = 0, n = 0;
  for (let s = 0; s < d.seeds; s++) {
    const v = d.today[s * d.readings + reading]!;
    if (!Number.isNaN(v)) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : NaN;
}

/** How often each candidate was best across the seeds at `reading`, ties sharing; 0 for one never run. Sums to 1, or 0 where nothing ran. */
export function targetOf(d: Decision, reading: number): Float64Array {
  const k = d.tables[0]!.k, S = d.seeds, R = d.readings, out = new Float64Array(k);
  let seeds = 0;
  for (let s = 0; s < S; s++) {
    let best = Infinity;
    for (let c = 0; c < k; c++) {
      const v = d.costs[(c * S + s) * R + reading]!;
      if (v < best) best = v;
    }
    if (best === Infinity) continue;
    let ties = 0;
    for (let c = 0; c < k; c++) if (d.costs[(c * S + s) * R + reading] === best) ties++;
    for (let c = 0; c < k; c++) if (d.costs[(c * S + s) * R + reading] === best) out[c] = out[c]! + 1 / ties;
    seeds++;
  }
  if (seeds > 0) for (let c = 0; c < k; c++) out[c] = out[c]! / seeds;
  return out;
}

const b64 = (a: Float32Array | Uint8Array): string => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");
const f32 = (s: string): Float32Array => {
  const b = Buffer.from(s, "base64");
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

/** A decision as JSON, every number exact (NaN too), to pass between processes. */
export function pack(d: Decision): string {
  return JSON.stringify({ ...d, tables: d.tables.map((t) => ({ ...t, state: b64(t.state), rows: b64(t.rows), bias: b64(t.bias), mask: b64(t.mask) })), costs: b64(d.costs), today: b64(d.today), label: b64(Float32Array.of(d.label)), ...(d.final ? { final: { weights: b64(d.final.weights), out: b64(d.final.out), mask: b64(d.final.mask) } } : {}) });
}

export function unpack(s: string): Decision {
  const o = JSON.parse(s) as Record<string, unknown> & { tables: Record<string, string | number>[]; costs: string; today: string; label: string; final?: Record<string, string> };
  return {
    ...(o as unknown as Decision),
    tables: o.tables.map((t) => ({ profile: t.profile as string, k: t.k as number, state: f32(t.state as string), rows: f32(t.rows as string), bias: f32(t.bias as string), mask: new Uint8Array(Buffer.from(t.mask as string, "base64")) })),
    costs: f32(o.costs), today: f32(o.today), label: f32(o.label)[0]!,
    ...(o.final ? { final: { weights: f32(o.final.weights!), out: f32(o.final.out!), mask: new Uint8Array(Buffer.from(o.final.mask!, "base64")) } } : {}),
  };
}
