// Rows for the claims grid (server/claims.ts): what it holds for the sizing target of 500,000 pieces, what it adds to
// setting a piece down, and what the enemy range and the structure cap cost beside a 20,000-piece chunk, against the scan
// of every slot they replaced. `bun tools/bench/claims.ts` runs these alone.

import { CORE_CONTENT } from "../../content/core.ts";
import { ENEMY_FOUNDATION, ENEMY_PILLAR } from "../../server/build.ts";
import { Claims } from "../../server/claims.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Rng } from "../../shared/rng.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { scanNear } from "../../tests/fixtures/enemy-scan.ts";
import { BASE_TIERS, boxBase, type Piece } from "./base.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const DIMS = { chunksX: 128, chunksZ: 128 };
const BASES = 250;
/** The team of the 20,000-piece chunk, and of the foundations laid round a place just out of reach. */
const BIG = 900;
const RING = 901;
const ASKS = 20000;

export function claimsRows(section: Section, record: Row): void {
  section("Claims grid: 500,000 pieces of 250 tribes, and a 20,000-piece chunk");
  const { registry: reg, errors } = compileContent(CORE_CONTENT);
  if (!reg) throw new Error(errors.join("\n"));
  const rng = new Rng(2026);
  const bases: Piece[][] = [];
  for (let b = 0; b < BASES; b++) bases.push(boxBase(reg, BASE_TIERS[b % 3]!, Math.round(rng.range(400, 7790) / 3) * 3 - 21, 0, Math.round(rng.range(400, 7790) / 3) * 3 - 21, 14, 3, 2000));
  const fill = (structs: StructureStore): number => {
    const t0 = performance.now();
    bases.forEach((base, b) => {
      for (const [kind, x, y, z, yaw] of base) structs.add(kind, x, y, z, yaw, b + 1, 100);
    });
    return performance.now() - t0;
  };
  const make = (): StructureStore => new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  // The best of three fills each way, the first of them after one that warms the machine.
  fill(make());
  const bare = Math.min(fill(make()), fill(make()), fill(make()));
  let told = Infinity;
  let structs = make();
  let claims = new Claims(structs, reg.role);
  for (let run = 0; run < 3; run++) {
    structs = make();
    claims = new Claims(structs, reg.role);
    told = Math.min(told, fill(structs));
  }
  record("pieces placed", structs.count, "");
  record("to set them down in a store nobody is told of", bare, "ms");
  record("to set them down with the grid told of each", told, "ms");
  record("team entries, at 20 bytes", claims.entries, "");
  record("foundation and pillar spots, at 16 bytes", claims.spots, "");
  record("memory the grid holds, its 262,144 cells and its spare room included", claims.bytes / 1048576, "MB", 16);
  let t0 = 0;

  // The siege's chunk: a wooden box base of a room a cell, 15 storeys, that fills chunk (20, 20) to its edges.
  const [x0, z0] = [20 * 64, 20 * 64];
  for (const [kind, x, y, z, yaw] of boxBase(reg, "wood", x0 + 0.5, 0, z0 + 0.5, 21, 1, 20000)) structs.add(kind, x, y, z, yaw, BIG, 100);
  record("pieces in the big chunk", structs.chunks[20 * DIMS.chunksX + 20]!.live, "");
  // Another tribe's foundations on every 3 m of the eight cells by eight read from (px, pz) that is not within reach of it.
  const [px, pz] = [100 * 64 + 15, 20 * 64 + 15];
  const foundation = reg.index.get("core:foundation_stone")!;
  for (let i = -24; i <= 24; i++) for (let j = -24; j <= 24; j++) if (Math.hypot(i * 3, j * 3) >= ENEMY_FOUNDATION + 1) structs.add(foundation, px + i * 3, 0, pz + j * 3, 0, RING, 100);

  const spot = new Rng(79);
  /** `ASKS` questions put by `team` at places `at` gives. Returns the mean of each way of answering, how many said yes, and how many differed. */
  const ask = (team: number, at: () => [number, number]): { grid: number; scan: number; near: number; differ: number } => {
    const places = Array.from({ length: ASKS }, at);
    let [near, differ, best] = [0, 0, Infinity];
    // The best of five runs of the lot, as the others hold whatever else the machine was doing.
    for (let run = 0; run < 5; run++) {
      const t = performance.now();
      let n = 0;
      for (const [x, z] of places) if (claims.enemyNear(team, x, z, ENEMY_FOUNDATION, ENEMY_PILLAR)) n++;
      best = Math.min(best, performance.now() - t);
      near = n;
    }
    t0 = performance.now();
    const some = places.slice(0, 200);
    for (const [x, z] of some) if (scanNear(structs, reg.role, team, x, z, ENEMY_FOUNDATION, ENEMY_PILLAR) !== claims.enemyNear(team, x, z, ENEMY_FOUNDATION, ENEMY_PILLAR)) differ++;
    return { grid: best / ASKS, scan: (performance.now() - t0) / some.length, near, differ };
  };
  const inside = (): [number, number] => [x0 + spot.range(0, 64), z0 + spot.range(0, 64)];
  // Off its corner, where the scan still reads the chunk and no foundation of it is within reach.
  const beside = (): [number, number] => [x0 + 64 + spot.range(36, 44), z0 + 64 + spot.range(36, 44)];
  const cases: [string, number, () => [number, number], number][] = [
    ["its own tribe asks inside it", BIG, inside, 0],
    ["another tribe asks inside it", 7, inside, ASKS],
    ["another tribe asks just past its reach", 7, beside, 0],
    ["ringed by foundations just out of reach, the most the grid reads", 7, () => [px + spot.range(-0.4, 0.4), pz + spot.range(-0.4, 0.4)], 0],
  ];
  let differ = 0;
  for (const [name, team, at, yes] of cases) {
    const got = ask(team, at);
    if (got.near !== yes) throw new Error(`${name}: ${got.near} of ${ASKS} had an enemy near, for ${yes}`);
    differ += got.differ;
    record(`enemy range, ${name}`, got.grid, "ms", 0.02);
    record("  the same by the scan of every slot", got.scan, "ms");
  }
  record("answers that differ from the scan's, of 800", differ, "", 0);
  const places = Array.from({ length: ASKS }, inside);
  t0 = performance.now();
  let most = 0;
  for (const [x, z] of places) most = Math.max(most, claims.near(x, z));
  record("structure cap: pieces counted within 96 m of a place in the big chunk", (performance.now() - t0) / ASKS, "ms", 0.02);
  record("  the most it counted", most, "");
  // Last, because a store tells only the newest grid made on it.
  t0 = performance.now();
  const again = new Claims(structs, reg.role);
  record("the grid made again from the standing world, as after a load", performance.now() - t0, "ms", 50);
  if (again.entries !== claims.entries || again.spots !== claims.spots) throw new Error("a grid made again differs");
}

if (import.meta.main) {
  let missed = false;
  claimsRows(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => {
      const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
      if (verdict.includes("MISS")) missed = true;
      console.log(`  ${name.padEnd(72)} ${value.toFixed(value < 10 ? 5 : 1).padStart(12)} ${unit}${verdict}`);
    },
  );
  if (missed) process.exit(1);
}
