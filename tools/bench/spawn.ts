// Rows for wild spawning at the sizing target: 10,000 spawn regions over an 8 km map filling to 300,000 creatures with nobody
// near, then held, then a hundredth of them killed and replaced. `bun tools/bench/spawn.ts` runs these alone.

import { CORE_CONTENT } from "../../content/core.ts";
import { contentFor, createHost } from "../../server/host.ts";
import { Rules } from "../../server/settings/rules.ts";
import { spawnTables } from "../../server/settings/spawns.ts";
import { Spawner, TICK_MADE } from "../../server/spawner.ts";
import { DeadlineHeap } from "../../shared/sim/schedule.ts";
import { createWorld } from "../../server/world.ts";
import type { MapZone } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Rng } from "../../shared/rng.ts";
import { ENTITY_LIMIT } from "../../shared/sim/entities.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const DIMS = { chunksX: 128, chunksZ: 128 };
const SIDE = 100;
const HOLDS = 30;

const at = (times: number[], q: number): number => [...times].sort((a, b) => a - b)[Math.min(times.length - 1, Math.floor(times.length * q))]!;

export function benchSpawn(section: Section, record: Row): void {
  section(`Wild spawning: ${SIDE * SIDE} regions over 8 km fill to ${SIDE * SIDE * HOLDS} creatures with nobody near, are held, and lose a hundredth`);
  const reg = contentFor(compileContent(CORE_CONTENT).registry!, new Rules());
  const hf = new Heightfield(DIMS, TERRAIN_CELL, -32, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 2);
  // Regions of 30 m every 80 m, each holding thirty parasaurs, which come in groups of one to three.
  const zones: MapZone[] = [];
  for (let k = 0; k < SIDE * SIDE; k++) zones.push({ kind: "spawn", at: [100 + (k % SIDE) * 80, 100 + Math.floor(k / SIDE) * 80], radius: 30, spawns: "core:spawns_proving_herd", count: HOLDS });
  const world = createWorld(reg, DIMS, hf, "bench:spawn", 1, { x: 4096, z: 4096, yaw: 0 }, ENTITY_LIMIT, undefined, undefined, zones);
  const host = createHost(reg, { world, wild: true });
  const sp = host.spawner!;
  // The spawner's own time each tick: its deadlines and its turns.
  let own = 0;
  const due = sp.due.bind(sp);
  const step = sp.step.bind(sp);
  sp.due = (i, stamp) => {
    const t = performance.now();
    due(i, stamp);
    own += performance.now() - t;
  };
  sp.step = (tick) => {
    const t = performance.now();
    step(tick);
    own += performance.now() - t;
  };
  const run = (until: () => boolean, most: number): { ticks: number[]; spawner: number[]; made: number[] } => {
    const out = { ticks: [] as number[], spawner: [] as number[], made: [] as number[] };
    while (!until() && out.ticks.length < most) {
      own = 0;
      const made = sp.made;
      const t = performance.now();
      host.game.tick();
      out.ticks.push(performance.now() - t);
      out.spawner.push(own);
      out.made.push(sp.made - made);
    }
    return out;
  };

  const fill = run(() => sp.regions.every((r) => !r.filling), 100000);
  record("fill: ticks until every region holds its number", fill.ticks.length, "");
  record("fill: creatures made", sp.count, "");
  record("fill: creatures made in one tick, most", Math.max(...fill.made), "", TICK_MADE + 2);
  record("fill: tick time, median", at(fill.ticks, 0.5), "ms", 8);
  record("fill: tick time, 99th percentile", at(fill.ticks, 0.99), "ms", 16);
  record("fill: the spawner's share of a tick, median", at(fill.spawner, 0.5), "ms");

  let ticks = 0;
  const held = run(() => ++ticks > 1800, 1800);
  record("held, a minute: tick time, median", at(held.ticks, 0.5), "ms");
  record("held: the spawner's share of a tick, mean", (held.spawner.reduce((a, b) => a + b, 0) / held.spawner.length) * 1000, "µs", 50);
  record("held: the spawner's share of a tick, worst", Math.max(...held.spawner) * 1000, "µs");
  record("held: creatures made", held.made.reduce((a, b) => a + b, 0), "", 0);

  // What a start on a save of them does: each is counted for the region it stands in.
  const t = performance.now();
  const counted = new Spawner({ ...host, persistence: null, deadlines: new DeadlineHeap(), tables: spawnTables(reg, host.rules, host.lists).tables }, 1);
  counted.begin(false);
  record(`a start: count ${counted.count} saved creatures for their regions`, performance.now() - t, "ms", 1000);

  // A hundredth of them die, spread over the map.
  const rng = new Rng(7);
  const all = [...host.records.byPid.values()];
  const killed = Math.round(sp.count / 100);
  for (let n = 0; n < killed; ) {
    const rec = all[rng.int(all.length)]!;
    if (rec.dead || !host.records.byPid.has(rec.pid)) continue;
    host.survival.add(rec, V_HEALTH, -1e9);
    n++;
  }
  const full = SIDE * SIDE * HOLDS;
  const back = run(() => sp.regions.every((r) => r.count >= r.desired), 20000);
  record(`replace ${killed} killed: seconds until every region holds its number again`, back.ticks.length / 30, "s");
  record("replacing: tick time, median", at(back.ticks, 0.5), "ms");
  record("replacing: the spawner's share of a tick, median", at(back.spawner, 0.5) * 1000, "µs");
  record("replacing: the spawner's share of a tick, worst", Math.max(...back.spawner), "ms");
  record("creatures counted at the end, of at least the number held", sp.count >= full ? full : sp.count, "");
}

if (import.meta.main) {
  benchSpawn(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
