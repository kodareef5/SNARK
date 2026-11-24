// Rows for built pieces by frame and key on the wire and on disk, at the sizing target of 500,000 pieces in 250 bases and
// one 20,000-piece chunk: bytes a piece, the commit that writes the chunk, and the load. `bun tools/bench/keyed.ts` runs
// these alone; `bun run bench` does not. `--dir` names where the save is made, a folder on a disk.

import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { Rng } from "../../shared/rng.ts";
import { RowCoder } from "../../shared/world/rows.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { BASE_TIERS, boxBase } from "./base.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const DIMS = { chunksX: 128, chunksZ: 128 };
const BASES = 250;
const EACH = 2000;
/** A chunk no base reaches, for the 20,000 pieces. */
const SIEGE = 2 * DIMS.chunksX + 2;

const median = (a: number[]): number => [...a].sort((p, q) => p - q)[a.length >> 1]!;

export function keyedRows(section: Section, record: Row, parent = "var"): void {
  section("Keyed rows: 500,000 pieces in 250 bases and a 20,000-piece chunk, on the wire and on disk");
  const { registry: reg, errors } = compileContent(CORE_CONTENT);
  if (!reg) throw new Error(errors.join("\n"));
  const make = (): StructureStore => new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const structs = make();
  const rng = new Rng(2026);
  for (let b = 0; b < BASES; b++) {
    const [x, z] = [Math.round(rng.range(400, 7790) / 3) * 3 - 21, Math.round(rng.range(400, 7790) / 3) * 3 - 21];
    for (const [kind, px, py, pz, yaw] of boxBase(reg, BASE_TIERS[b % 3]!, x, 0, z, 14, 3, EACH)) structs.add(kind, px, py, pz, yaw, b + 1, reg.maxHp[kind]!);
  }
  const refs: number[] = [];
  for (const [kind, x, y, z, yaw] of boxBase(reg, "wood", 2 * 64 + 0.5, 200, 2 * 64 + 0.5, 21, 1, 20000)) refs.push(structs.add(kind, x, y, z, yaw, 999, reg.maxHp[kind]!));
  const siege = structs.chunks[SIEGE]!;
  record("pieces placed", structs.count, "");
  record("frames", structs.frames.count, "");

  // The wire: every chunk whole to a session that has been told no frame.
  const w = new BitWriter(4 << 20);
  const coder = new RowCoder(structs.forms, reg.maxHp);
  const told = new Set<number>();
  let bits = 0;
  let t0 = performance.now();
  for (const c of structs.held) {
    const t = structs.chunks[c]!;
    w.reset();
    coder.begin((c % DIMS.chunksX) * 64, Math.floor(c / DIMS.chunksX) * 64, -1, told);
    for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0) coder.write(w, t, s, false, false, structs.frames);
    coder.sent();
    bits += w.pos;
    if (c === SIEGE) record("the 20,000-piece chunk's rows on the wire, a piece", w.pos / 8 / siege.live, "B", 3.6);
  }
  record("every row on the wire, a piece", bits / 8 / structs.count, "B", 3.6);
  record("to write every row once", performance.now() - t0, "ms");

  mkdirSync(resolve(parent), { recursive: true });
  const dir = mkdtempSync(join(resolve(parent), "bench-keyed-"));
  const path = join(dir, "world.db");
  let store = new WorldStore(path, reg);
  t0 = performance.now();
  store.transaction(() => {
    for (const c of structs.held) store.saveChunk(c, structs);
    store.setMeta("tick", 1);
  });
  record("first commit: every structure to disk", performance.now() - t0, "ms", 3000);
  const size = (where: string): number => (store.db.query(`SELECT sum(length(data)) AS n FROM chunk_structs ${where}`).get() as { n: number }).n;
  record("chunk rows on disk, a piece, all undamaged", size("") / structs.count, "B", 5);
  record("the 20,000-piece chunk on disk", size(`WHERE chunk = ${SIEGE}`) / 1024, "KB");

  // The siege's commits: 50 pieces a tick lose a stage, and the chunk is written whole once a second.
  const hits = new Rng(79);
  const commits: number[] = [];
  for (let n = 0; n < 60; n++) {
    for (let k = 0; k < 1500; k++) {
      const ref = refs[hits.int(refs.length)]!;
      structs.damage(ref, reg.maxHp[siege.kind[ref & 0xffff]!]! / 200);
    }
    t0 = performance.now();
    store.transaction(() => store.saveChunk(SIEGE, structs));
    commits.push(performance.now() - t0);
    // The server empties the log between ticks, not in a commit.
    if (n % 8 === 7) store.db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  }
  record("a commit that writes the 20,000-piece chunk, median", median(commits), "ms", 1.5);
  record("the same, worst of 60", Math.max(...commits), "ms", 1.5);
  record("that chunk on disk with its damage, a piece", size(`WHERE chunk = ${SIEGE}`) / siege.live, "B");
  store.close();
  record("save size on disk", statSync(path).size / 1048576, "MB");

  const loads: number[] = [];
  let loaded = make();
  for (let n = 0; n < 5; n++) {
    loaded = make();
    t0 = performance.now();
    store = new WorldStore(path, reg);
    const count = store.loadChunks(loaded);
    loads.push(performance.now() - t0);
    store.close();
    if (count !== structs.count) throw new Error(`loaded ${count} of ${structs.count}`);
  }
  record(`open, check and load ${structs.count} structures, median of 5`, median(loads), "ms", 400);
  record("the same, best", Math.min(...loads), "ms");
  record("frames after the load", loaded.frames.count, "", structs.frames.count);
  let off = 0;
  for (const c of structs.held) {
    const [t, u] = [structs.chunks[c]!, loaded.chunks[c]!];
    for (let s = 0; s < t.high; s++) if ((t.fr?.[s] ?? 0) !== (u.fr?.[s] ?? 0) || (t.k0?.[s] ?? 0) !== (u.k0?.[s] ?? 0) || (t.k1?.[s] ?? 0) !== (u.k1?.[s] ?? 0) || t.hp[s] !== u.hp[s]) off++;
  }
  record("loaded rows whose frame, key or health is not what was saved", off, "", 0);
  rmSync(dir, { recursive: true, force: true });
}

if (import.meta.main) {
  const at = process.argv.indexOf("--dir");
  let missed = false;
  keyedRows(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => {
      const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
      if (verdict.includes("MISS")) missed = true;
      console.log(`  ${name.padEnd(64)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${verdict}`);
    },
    at >= 0 ? process.argv[at + 1] : undefined,
  );
  if (missed) process.exit(1);
}
