// Rows for what 500,000 built pieces cost a server's start: setting the bench's 250 bases down by slot in a world, loading
// them from its save, and a host's start on that save, each the median of several. `bun tools/bench/start.ts` runs these
// alone; `bun run bench` does not. `--dir` names where the save is made, a folder on a disk.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { contentFor, createHost } from "../../server/host.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { Rules } from "../../server/settings/rules.ts";
import { createWorld, type ServerWorld } from "../../server/world.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { hashBytes } from "../../shared/hash.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { benchBases, layBase } from "./base.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const DIMS = { chunksX: 128, chunksZ: 128 };
const REPEATS = 5;

const median = (a: number[]): number => [...a].sort((p, q) => p - q)[a.length >> 1]!;

export function startRows(section: Section, record: Row, parent = "var"): void {
  section("Built pieces at a start: 500,000 in 250 bases, set down, loaded, and a host started on them");
  const hf = new Heightfield(DIMS, TERRAIN_CELL, -32, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.heights[j * hf.nx + i] = Math.round((40 + 30 * Math.sin((i * hf.cell) / 400) * Math.cos((j * hf.cell) / 350) + 32) * 64);
  const mapHash = hashBytes(new Uint8Array(hf.heights.buffer, 0, 4096));
  const rules = new Rules();
  const reg = contentFor(compileContent(CORE_CONTENT).registry!, rules);
  const fresh = (): ServerWorld => createWorld(reg, DIMS, hf, "bench:8km", mapHash, { x: 4096, z: 4096, yaw: 0 }, 1 << 19);
  const { pieces } = benchBases(reg, hf);

  // Each world is told every piece set down, as a server's claims grid is.
  const places: number[] = [];
  let world = fresh();
  for (let n = 0; n < REPEATS; n++) {
    world = fresh();
    Bun.gc(true);
    const t0 = performance.now();
    pieces.forEach((base, b) => layBase(world.structs, base, 1 + b, 1000));
    places.push(performance.now() - t0);
  }
  record("pieces placed", world.structs.count, "");
  record("set them down by slot, the claims told, median", median(places), "ms", 260);
  record("the same, the first", places[0]!, "ms");

  mkdirSync(resolve(parent), { recursive: true });
  const dir = mkdtempSync(join(resolve(parent), "bench-start-"));
  const dbPath = join(dir, "world.db");
  const host = createHost(reg, { dbPath, world, config: rules, commitEvery: 6 });
  host.persistence!.commit();
  host.shutdown();

  const loads: number[] = [];
  let loaded = fresh();
  for (let n = 0; n < REPEATS; n++) {
    loaded = fresh();
    Bun.gc(true);
    const t0 = performance.now();
    const store = new WorldStore(dbPath, reg);
    store.loadChunks(loaded.structs);
    loads.push(performance.now() - t0);
    store.close();
  }
  if (loaded.structs.count !== world.structs.count) throw new Error(`loaded ${loaded.structs.count} of ${world.structs.count}`);
  record("open the save and load them, the claims told, median", median(loads), "ms", 240);
  record("the same, the first", loads[0]!, "ms");
  record("cells taken, bytes a piece", loaded.structs.occupied.bytes / loaded.structs.count, "B", 28);

  const starts: number[] = [];
  for (let n = 0; n < 3; n++) {
    Bun.gc(true);
    const t0 = performance.now();
    const again = createHost(reg, { dbPath, world: fresh(), config: rules, commitEvery: 6 });
    starts.push(performance.now() - t0);
    again.shutdown();
  }
  record("start a host on that save, median of 3", median(starts), "ms", 300);
  rmSync(dir, { recursive: true, force: true });
}

if (import.meta.main) {
  const at = process.argv.indexOf("--dir");
  let missed = false;
  startRows(
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
