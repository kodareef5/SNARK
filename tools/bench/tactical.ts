// The map's benchmark rows: what baking a chunk costs, and what the two feeds cost a client and a tick.
// tools/bench.ts calls it after the siege, on that world. Run alone (bun tools/bench/tactical.ts) it makes a world of its own.

import { ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { contentFor, createHost, type Host } from "../../server/host.ts";
import { Rules } from "../../server/settings/rules.ts";
import { createWorld } from "../../server/world.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, TICK_RATE, chunkAt, chunkCx, chunkCz } from "../../shared/coords.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { LoopbackNet } from "../../shared/net/loopback.ts";
import { KEY_BYTES } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { Summary, bakeChunk, pieceShapes, writeCells } from "../../shared/world/tactical.ts";

type Record = (name: string, value: number, unit: string, budget?: number | null) => void;

/** `chunk` holds the 20,000 pieces. `run` steps the server and its clients that many ticks. */
export function benchTactical(host: Host, chunk: number, run: (ticks: number) => void, section: (title: string) => void, record: Record): void {
  section("The map: a 20,000-piece chunk baked, and the two feeds over thirty seconds");
  const world = host.world;
  const reg = world.reg;
  const shapes = pieceShapes(reg);
  const summary = new Summary();
  const table = world.structs.chunks[chunk]!;
  const [x0, z0] = [chunkCx(world.dims, chunk) * CHUNK_SIZE, chunkCz(world.dims, chunk) * CHUNK_SIZE];
  const bakes: number[] = [];
  for (let i = 0; i < 300; i++) {
    const t = performance.now();
    bakeChunk(table, x0, z0, shapes, world.hf, summary);
    bakes.push(performance.now() - t);
  }
  bakes.sort((a, b) => a - b);
  record(`bake of its ${table.live} pieces, median`, bakes[150]!, "ms", 0.5);
  record("the same, 99th percentile", bakes[297]!, "ms");
  const w = new BitWriter(1024);
  writeCells(w, chunk, summary, 0);
  record("its 4 m cells as one message", w.byteLength, "bytes", 780);
  w.reset();
  writeCells(w, chunk, summary, 3);
  record("its 32 m cells as one message", w.byteLength, "bytes", 16);

  // Everyone has had the map around them by now. What follows is what staying costs.
  const tactical = host.tactical;
  const sync = tactical.sync.bind(tactical);
  let spent = 0;
  tactical.sync = (c) => {
    const t = performance.now();
    sync(c);
    spent += performance.now() - t;
  };
  const stats = tactical.stats;
  const [cellBytes, markBytes, baked] = [stats.cellBytes, stats.markBytes, stats.bakes];
  const ticks: number[] = [];
  const TICKS = 30 * TICK_RATE;
  for (let i = 0; i < TICKS; i++) {
    spent = 0;
    run(1);
    ticks.push(spent);
  }
  tactical.sync = sync;
  ticks.sort((a, b) => a - b);
  const clients = Math.max(1, host.game.playerCount);
  record("structure cells sent to each client", (stats.cellBytes - cellBytes) / clients / 30 / 1024, "KB/s");
  record("marks sent to each client", (stats.markBytes - markBytes) / clients / 30 / 1024, "KB/s");
  record("both feeds, per client", (stats.cellBytes - cellBytes + stats.markBytes - markBytes) / clients / 30 / 1024, "KB/s", 0.5);
  record("chunks baked in those thirty seconds", stats.bakes - baked, "");
  record("the map's share of a tick, median", ticks[Math.floor(TICKS / 2)]!, "ms");
  record("the map's share of a tick, worst", ticks[TICKS - 1]!, "ms");
}

if (import.meta.main) {
  // A 4 km map with 120 bases of twelve tribes on it, sixteen survivors in two tribes of eight with thirty creatures each, and
  // the 20,000-piece chunk. Half of the survivors walk, so their marks change every second.
  const reg = contentFor(compileContent(CORE_CONTENT).registry!, new Rules());
  const dims = { chunksX: 64, chunksZ: 64 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 64);
  hf.heights.fill(32 * 64);
  const world = createWorld(reg, dims, hf, "bench:map", 1, { x: 2048, z: 2048, yaw: 0 }, 4096);
  const host = createHost(reg, { world, game: { maxClients: 32 } });
  const rng = new Rng(5);
  const kinds = ["core:foundation_wood", "core:wall_stone", "core:ceiling_wood", "core:pillar_metal"].map((id) => reg.index.get(id)!);
  for (let b = 0; b < 120; b++) {
    const [cx, cz] = [rng.range(200, 3900), rng.range(200, 3900)];
    for (let n = 0; n < 400; n++) world.structs.add(kinds[rng.int(kinds.length)]!, cx + (rng.int(15) - 7) * 3, rng.int(4) * 3.3 + 0.2, cz + (rng.int(15) - 7) * 3, rng.int(4) * 16384, 1 + (b % 12), 1000);
  }
  const big = chunkAt(dims, 3000, 3000);
  for (let n = 0; n < 20000; n++) world.structs.add(reg.index.get("core:wall")!, 2945 + rng.range(0, 62), 200 + rng.range(0, 60), 2945 + rng.range(0, 62), 0, 1, 1e9);
  const net = new LoopbackNet(3);
  host.game.listen(net);
  const sessions: ClientSession[] = [];
  for (let i = 0; i < 16; i++) sessions.push(new ClientSession(net.connect(), { name: `bot${i}`, key: new Uint8Array(KEY_BYTES).fill(i + 1), registry: reg, look: defaultLook(), resolveMap: () => hf }));
  let now = 0;
  const run = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      now += 1000 / TICK_RATE;
      net.advance(now);
      host.game.tick();
      sessions.forEach((s, k) => s.update(now, 0, k % 2, k + now / 20000, 0, 0));
    }
  };
  run(30);
  const recOf = (i: number) => host.records.byPid.get(host.game.clients.find((c) => c?.name === `bot${i}`)!.pid)!;
  for (const first of [0, 8]) {
    host.tribes.create(recOf(first), `Tribe ${first}`);
    for (let i = first + 1; i < first + 8; i++) {
      host.tribes.invite(recOf(first), recOf(i), true);
      host.tribes.accept(recOf(i));
    }
    for (let n = 0; n < 30; ) {
      // A spot inside a base is tried again elsewhere.
      const e = host.spawnCreature("core:dummy", rng.range(300, 3800), rng.range(300, 3800), 1);
      if (e >= 0 && host.taming.give(host.records.byPid.get(world.ents.pid[e]!)!, recOf(first), 0, "forced")) n++;
    }
  }
  const rows: string[] = [];
  const record: Record = (name, value, unit, budget = null) => {
    const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
    rows.push(verdict);
    console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${verdict}`);
  };
  const stats = host.tactical.stats;
  // The first twenty seconds are the join: every base within the radius, at the minimap's zoom.
  run(20 * TICK_RATE);
  console.log("\nThe map: sixteen survivors join a 4 km map with 120 bases on it");
  record("structure cells sent to each as it joined", stats.cellBytes / 16 / 1024, "KB");
  record("chunks baked at the start and since", stats.bakes, "");
  benchTactical(host, big, run, (title) => console.log(`\n${title}`), record);
  if (rows.some((v) => v.includes("MISS"))) process.exit(1);
}
