// Benchmarks at the sizing target (planning/decisions.md D15): an 8 km map,
// 500,000 structures, 30,000 creatures, 100 players, one process.
//
//   bun run bench
//
// Each row is a measurement and the budget it is held to. A miss is printed as
// a miss. Results are for the machine they ran on; record them with it in
// planning/quality/performance.md.

import { heapStats } from "bun:jsc";
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { cpus, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { Camera } from "../client/core/render/camera.ts";
import { Scene } from "../client/core/render/scene.ts";
import { ClientSession } from "../client/core/session.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { createHost, type Host } from "../server/host.ts";
import { WorldStore } from "../server/persist/store.ts";
import { createWorld, type ServerWorld } from "../server/world.ts";
import { compileContent, type Registry } from "../shared/content/registry.ts";
import { TICK_RATE, chunkAt } from "../shared/coords.ts";
import { hashBytes } from "../shared/hash.ts";
import { BitReader, BitWriter } from "../shared/net/codec.ts";
import { LoopbackNet, type LoopbackEnd } from "../shared/net/loopback.ts";
import { BOX_SELF, CMD_MOVE, InputBuffer, KEY_BYTES, PROTOCOL_VERSION, S_SNAPSHOT, writeCommand, writeHello, writeInputs } from "../shared/net/protocol.ts";
import { scatterNodes, type NodeSpot } from "../shared/world/nodes.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../shared/net/transport.ts";
import { parsePack } from "../shared/pack/pack.ts";
import { Rng } from "../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../shared/world/heightfield.ts";
import { StructureStore } from "../shared/world/structures.ts";
import { buildCorePack } from "./pack/build.ts";

const PLAYERS = 100;
const STRUCTURES = 500000;
const CREATURES = 30000;
const DORMANT_EXTRA = 270000;
const BASES = 250;
const DIMS = { chunksX: 128, chunksZ: 128 };
const MAP_ID = "bench:8km";

interface Row {
  name: string;
  value: number;
  unit: string;
  budget: number | null;
}
const rows: Row[] = [];
const record = (name: string, value: number, unit: string, budget: number | null = null): void => {
  rows.push({ name, value, unit, budget });
  const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
  console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${verdict}`);
};
const section = (title: string): void => console.log(`\n${title}`);
const percentile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
const mb = (bytes: number): number => bytes / 1048576;

function buildTerrain(): Heightfield {
  const hf = new Heightfield(DIMS, TERRAIN_CELL, -32, 1 / 64);
  for (let j = 0; j < hf.nz; j++) {
    const z = j * hf.cell;
    for (let i = 0; i < hf.nx; i++) {
      const x = i * hf.cell;
      hf.heights[j * hf.nx + i] = Math.round((40 + 30 * Math.sin(x / 400) * Math.cos(z / 350) + 8 * Math.sin(x / 53) * Math.sin(z / 61) + 32) * 64);
      hf.tint[j * hf.nx + i] = 12;
    }
  }
  return hf;
}

/** Bases of mixed pieces on a 3 m lattice, four floors high, 42 m square. Returns their centres. */
function buildBases(world: ServerWorld, reg: Registry, rng: Rng): [number, number][] {
  const kinds = ["core:foundation", "core:wall", "core:wall", "core:ceiling", "core:ceiling", "core:pillar", "core:crate", "core:block"].map((id) => reg.index.get(id)!);
  const each = STRUCTURES / BASES;
  const centers: [number, number][] = [];
  for (let b = 0; b < BASES; b++) {
    const cx = Math.round(rng.range(400, 7790) / 3) * 3;
    const cz = Math.round(rng.range(400, 7790) / 3) * 3;
    centers.push([cx, cz]);
    const y0 = world.hf.heightAt(cx, cz);
    for (let n = 0; n < each; n++) {
      const kind = kinds[rng.int(kinds.length)]!;
      const x = cx + (rng.int(15) - 7) * 3;
      const z = cz + (rng.int(15) - 7) * 3;
      const y = y0 + rng.int(4) * 3.3 + world.structs.halfYOf(kind);
      world.structs.add(kind, x, y, z, rng.int(4) * 16384, 1 + b, 1000);
    }
  }
  return centers;
}

/** A client that only does what the server can observe: says hello, sends inputs, acknowledges snapshots. */
class Bot {
  readonly end: LoopbackEnd;
  private readonly inputs = new InputBuffer(64);
  private readonly w = new BitWriter(256);
  private readonly r = new BitReader();
  private readonly rng: Rng;
  private serverTick = 0;
  private sent = 0;
  private moveX = 0;
  private moveZ = 0;
  private yaw = 0;

  constructor(net: LoopbackNet, name: string, contentHash: number, seed: number) {
    this.rng = new Rng(seed);
    this.end = net.connect();
    this.end.onMessage = (_ch, data) => {
      if ((data[0]! & 15) !== S_SNAPSHOT) return;
      this.r.reset(data);
      this.r.bits(4);
      const tick = this.r.u32();
      if (tick > this.serverTick) this.serverTick = tick;
    };
    const w = this.w;
    const key = new Uint8Array(KEY_BYTES);
    for (let i = 0; i < KEY_BYTES; i++) key[i] = this.rng.int(256);
    writeHello(w, PROTOCOL_VERSION, contentHash, 0, name, 0, key);
    this.end.send(CH_RELIABLE, w.bytes());
  }

  private seq = 0;

  /** Ask to move a whole stack between two of its own slots, as the inventory screen would. */
  move(from: number, to: number, item: number): void {
    const w = this.w;
    w.reset();
    writeCommand(w, (this.seq = (this.seq + 1) & 0xffff), CMD_MOVE);
    w.bits(BOX_SELF, 1);
    w.u8(from);
    w.bits(BOX_SELF, 1);
    w.u8(to);
    w.u16(0);
    w.u16(item);
    this.end.send(CH_RELIABLE, w.bytes());
  }

  update(worldTick: number): void {
    const target = (this.serverTick || worldTick) + 3;
    if (target <= this.sent) return;
    if (this.rng.int(45) === 0) {
      this.moveX = this.rng.int(255) - 127;
      this.moveZ = this.rng.int(255) - 127;
      this.yaw = this.rng.int(65536);
    }
    let count = 0;
    for (let t = Math.max(this.sent + 1, target - 3); t <= target; t++) {
      this.inputs.set(t, this.moveX, this.moveZ, this.yaw, 0, this.rng.int(40) === 0 ? 1 : 0);
      count++;
    }
    this.sent = target;
    this.w.reset();
    writeInputs(this.w, this.inputs, this.serverTick, target, count);
    this.end.send(CH_UNRELIABLE, this.w.bytes());
  }
}

const reg = compileContent(CORE_CONTENT).registry!;
const dir = mkdtempSync(join(tmpdir(), "snark-bench-"));
console.log(`SNARK benchmarks  ${cpus()[0]!.model}, ${cpus().length} cores, ${(totalmem() / 2 ** 30).toFixed(0)} GB, Bun ${Bun.version}, ${process.platform} ${process.arch}`);

// ---------------------------------------------------------------- world build
section("World at target scale");
let t0 = performance.now();
const hf = buildTerrain();
const mapHash = hashBytes(new Uint8Array(hf.heights.buffer, 0, 4096));
// Trees, rocks and bushes over the whole map: 160 slots a chunk, most of them holding one.
const nodeKinds = ["core:tree", "core:tree", "core:tree", "core:rock", "core:rock", "core:bush"].map((id) => reg.index.get(id)!);
const nodeSource = scatterNodes(DIMS, hf, 0xbe7c, 160, nodeKinds, reg.halfY, () => true);
const world = createWorld(reg, DIMS, hf, MAP_ID, mapHash, { x: 4096, z: 4096, yaw: 0 }, CREATURES + DORMANT_EXTRA + 1024, undefined, nodeSource);
record("terrain build, 8 km at 2 m", performance.now() - t0, "ms");
const rng = new Rng(2026);
t0 = performance.now();
const centers = buildBases(world, reg, rng);
record(`place ${STRUCTURES} structures in ${BASES} bases`, performance.now() - t0, "ms");
record("structures placed", world.structs.count, "");

const dbPath = join(dir, "world.db");
const host: Host = createHost(reg, { dbPath, world, commitEvery: 6 });
const persistence = host.persistence!;
t0 = performance.now();
persistence.commit();
record("first commit: every structure to disk", performance.now() - t0, "ms", 3000);

t0 = performance.now();
let spawned = 0;
while (spawned < CREATURES) if (host.spawnCreature("core:grazer", rng.range(200, 7990), rng.range(200, 7990), 1 + rng.int(150)) >= 0) spawned++;
record(`spawn ${CREATURES} creatures with genomes`, performance.now() - t0, "ms");
t0 = performance.now();
persistence.commit();
record(`commit ${CREATURES} new creature records`, performance.now() - t0, "ms");

// ---------------------------------------------------------------- players
// 40 players in one fight; 60 in pairs at 30 other bases.
const net = new LoopbackNet(7);
host.game.listen(net);
const places = new Map<string, { x: number; y: number; z: number; yaw: number }>();
const placeNear = (name: string, base: number, spread: number): void => {
  for (;;) {
    const x = centers[base]![0] + 26 + rng.range(0, spread);
    const z = centers[base]![1] + rng.range(-spread, spread);
    places.set(name, { x, y: hf.heightAt(x, z), z, yaw: 0 });
    return;
  }
};
for (let i = 0; i < PLAYERS; i++) placeNear(`bot${i}`, i < 40 ? 0 : 1 + Math.floor((i - 40) / 2), i < 40 ? 20 : 6);
const savedBefore = host.game.savedPosition;
host.game.savedPosition = (name) => places.get(name) ?? savedBefore?.(name) ?? null;

const bots: Bot[] = [];
const sessions: ClientSession[] = [];
for (let i = 0; i < PLAYERS; i++) {
  // Two real clients among the bots check that the load does not break prediction.
  if (i === 0 || i === 50) {
    const end = net.connect();
    sessions.push(new ClientSession(end, { name: `bot${i}`, key: new Uint8Array(KEY_BYTES).fill(i + 1), registry: reg, resolveMap: () => hf, nodes: () => nodeSource }));
    continue;
  }
  bots.push(new Bot(net, `bot${i}`, reg.hash, 100 + i));
}

const commitTimes: number[] = [];
const commit = persistence.commit.bind(persistence);
persistence.commit = () => {
  const t = performance.now();
  commit();
  commitTimes.push(performance.now() - t);
};

let now = 0;
const tickMs = 1000 / TICK_RATE;
function run(ticks: number, times: number[] | null): void {
  for (let i = 0; i < ticks; i++) {
    now += tickMs;
    net.advance(now);
    const t = performance.now();
    host.game.tick();
    if (times) times.push(performance.now() - t);
    for (const b of bots) b.update(host.world.tick);
    for (const s of sessions) s.update(now, 0.4, 1, (i % 600) / 95, 0, i % 90 === 0 ? 1 : 0);
  }
}

section("Server tick: 100 players, 500k structures, 30k creatures");
run(300, null); // join, initial chunk sync, clock sync
record("players connected", host.game.playerCount, "", null);
record("creatures awake", host.creatures.awakeCount, "");
const sentBefore = host.game.clients.map((c) => (c ? (c.conn as LoopbackEnd).bytesSent : 0));
const recvBefore = bots.map((b) => b.end.bytesSent);
commitTimes.length = 0;
Bun.gc(true);
const objectsBefore = heapStats().objectCount;
const times: number[] = [];
const TICKS = 900;
run(TICKS, times);
Bun.gc(true);
const objectsAfter = heapStats().objectCount;
times.sort((a, b) => a - b);
record("tick time, median", percentile(times, 0.5), "ms", 8);
record("tick time, 99th percentile", percentile(times, 0.99), "ms", 16);
record("tick time, worst", times[times.length - 1]!, "ms", 33.3);
record("creatures stepped through collision per tick", host.creatures.stepped, "");
record("live objects gained over 900 ticks, after collection", objectsAfter - objectsBefore, "", 5000);
commitTimes.sort((a, b) => a - b);
record("commit time, median (every 6 ticks)", percentile(commitTimes, 0.5), "ms", 4);
record("commit time, 99th percentile", percentile(commitTimes, 0.99), "ms", 10);

const seconds = TICKS / TICK_RATE;
const down = host.game.clients.map((c, i) => (c ? ((c.conn as LoopbackEnd).bytesSent - sentBefore[i]!) / seconds : 0));
const fight = host.game.clients.filter((c) => c && Number(c.name.slice(3)) < 40).map((c) => down[c!.id]!);
const spread = host.game.clients.filter((c) => c && Number(c.name.slice(3)) >= 40).map((c) => down[c!.id]!);
const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
record("downstream per client in a 40-player fight", mean(fight) / 1024, "KB/s", 34);
// First guess was 8 KB/s and the first run measured 11.7: about 90 creatures in interest, most of them
// walking, each sent every tick. 16 KB/s is 12.5 Mbit/s for a full server. See performance.md.
record("downstream per client at a quiet base", mean(spread) / 1024, "KB/s", 16);
record("upstream per client", mean(bots.map((b, i) => (b.end.bytesSent - recvBefore[i]!) / seconds)) / 1024, "KB/s", 2);
record("prediction corrections on the two real clients", sessions.reduce((n, s) => n + s.stats.corrections, 0), "");
record("snapshots the real clients could not decode", sessions.reduce((n, s) => n + s.stats.undecodable, 0), "", 0);
record("inputs the server had to repeat (of 90,000)", host.game.stats.heldInputs, "");
record("process memory (resident)", mb(process.memoryUsage().rss), "MB", 2048);

// ---------------------------------------------------------------- nodes
section("Resource nodes: map data plus a sparse overlay");
{
  const spot: NodeSpot = { kind: 0, x: 0, y: 0, z: 0, yaw: 0 };
  let onMap = 0;
  t0 = performance.now();
  for (let chunk = 0; chunk < DIMS.chunksX * DIMS.chunksZ; chunk++) {
    for (let i = 0; i < nodeSource.perChunk; i++) {
      nodeSource.at(chunk, i, spot);
      if (spot.kind !== 0) onMap++;
    }
  }
  const scan = performance.now() - t0;
  record("nodes on the 8 km map", onMap, "");
  const field = host.harvest!.field;
  record("node rows held in memory, near 100 players", field.store.count, "");
  record("memory those rows take (34 bytes each)", mb(field.store.count * 34), "MB", 40);
  // Fill and empty chunks nobody is near: what a player walking into new ground costs.
  const far: number[] = [];
  for (let chunk = 0; chunk < DIMS.chunksX * DIMS.chunksZ && far.length < 400; chunk += 37) if (!field.isLoaded(chunk)) far.push(chunk);
  t0 = performance.now();
  for (const chunk of far) field.retain(chunk, 0, 1, () => false);
  record("fill one chunk of nodes", (performance.now() - t0) / far.length, "ms", 0.2);
  for (const chunk of far) field.retain(chunk, 0, -1, () => false);
  record("work out every node on the map once (not done in play)", scan, "ms");
}

// ---------------------------------------------------------------- everyone working
section("Everyone working: 100 players striking nodes and moving items");
{
  const harvest = host.harvest!;
  const quiet = host.game.clients.map((c) => (c ? (c.conn as LoopbackEnd).bytesSent : 0));
  const botOf = new Map(bots.map((b) => [b.end.peer as unknown, b]));
  commitTimes.length = 0;
  const hitsBefore = harvest.hits;
  const commandsBefore = host.game.stats.commands;
  const work: number[] = [];
  for (let i = 0; i < TICKS; i++) {
    run(1, work);
    if (i % 15 !== 0) continue;
    for (const c of host.game.clients) {
      if (!c?.active || c.ent < 0) continue;
      // The nearest thing to hand: the first node in the body's own chunk.
      const table = harvest.field.store.chunks[c.chunk];
      if (table) for (let slot = 0; slot < table.high; slot++) if (table.kind[slot] !== 0 && harvest.strike(c, c.chunk, slot)) break;
      // And shuffle a stack about, through the same command the inventory screen sends.
      const rec = host.records.byPid.get(c.pid);
      const bot = botOf.get(c.conn);
      if (rec?.inv && bot) {
        const from = rec.inv.item.findIndex((k) => k !== 0);
        if (from >= 0) bot.move(from, (from + 1 + ((i / 15) % 38)) % rec.inv.cap, rec.inv.item[from]!);
      }
    }
  }
  work.sort((a, b) => a - b);
  commitTimes.sort((a, b) => a - b);
  record("node hits landed", harvest.hits - hitsBefore, "");
  record("commands run", host.game.stats.commands - commandsBefore, "");
  record("tick time, median", percentile(work, 0.5), "ms", 8);
  record("tick time, 99th percentile", percentile(work, 0.99), "ms", 16);
  record("commit time, 99th percentile", percentile(commitTimes, 0.99), "ms", 10);
  const busy = host.game.clients.map((c, i) => (c ? ((c.conn as LoopbackEnd).bytesSent - quiet[i]!) / seconds : 0));
  const atBase = host.game.clients.filter((c) => c && Number(c.name.slice(3)) >= 40).map((c) => busy[c!.id]!);
  record("downstream per client at a base, working", mean(atBase) / 1024, "KB/s", 16);
  // Owner state costs bytes only when it changes; the allowance for a busy survivor is 0.3 KB/s.
  record("of which added by working (inventory, experience, nodes)", (mean(atBase) - mean(spread)) / 1024, "KB/s", 0.3);
  record("nodes used up", harvest.goneCount, "");
  const wrong = host.items.audit();
  record("items the ledger cannot account for", wrong.length, "", 0);
}

// ---------------------------------------------------------------- stored stacks
section("Stored stacks: 600,000 stacks in 10,000 containers nobody is near");
{
  const cacheKind = reg.index.get("core:cache")!;
  const stone = reg.index.get("core:stone")!;
  const berry = reg.index.get("core:berry")!;
  t0 = performance.now();
  for (let i = 0; i < 10000; i++) {
    const box = host.records.create(cacheKind, "");
    host.items.mint(box, stone, 3000);
    host.items.mint(box, berry, 3000);
  }
  record("create them", performance.now() - t0, "ms");
  t0 = performance.now();
  persistence.commit();
  record("first commit of 10,000 containers", performance.now() - t0, "ms");
  const stored: number[] = [];
  commitTimes.length = 0;
  run(300, stored);
  stored.sort((a, b) => a - b);
  commitTimes.sort((a, b) => a - b);
  // Nothing about a stored stack runs: the tick and the commit are what they were.
  record("tick time, median, with them in the world", percentile(stored, 0.5), "ms", 8);
  record("commit time, 99th percentile, with them in the world", percentile(commitTimes, 0.99), "ms", 10);
  t0 = performance.now();
  const wrong = host.items.audit();
  record("audit every stack in the world against the ledger", performance.now() - t0, "ms", 1000);
  record("items the ledger cannot account for", wrong.length, "", 0);
}

// ---------------------------------------------------------------- dormancy
section("Dormancy: the same awake load with ten times the creatures");
const baseline = percentile(times, 0.5);
t0 = performance.now();
const awakeBefore = host.creatures.awakeCount;
for (let n = 0; n < DORMANT_EXTRA; ) {
  // Only where no player is near: these must be dormant for the comparison to mean anything.
  const x = rng.range(200, 7990);
  const z = rng.range(200, 7990);
  if (host.creatures.isChunkAwake(chunkAt(DIMS, x, z))) continue;
  if (host.spawnCreature("core:grazer", x, z, 5) >= 0) n++;
}
record(`spawn ${DORMANT_EXTRA} more creatures`, performance.now() - t0, "ms");
run(60, null);
const after: number[] = [];
run(300, after);
after.sort((a, b) => a - b);
record("creatures in the world", host.world.ents.count, "");
record("creatures awake before", awakeBefore, "");
record("creatures awake after (players wandered into denser ground)", host.creatures.awakeCount, "");
record("tick time, median, 30k creatures", baseline, "ms");
record("tick time, median, 300k creatures (same players)", percentile(after, 0.5), "ms", Math.round((baseline * 1.5 + 0.5) * 100) / 100);

// ---------------------------------------------------------------- restart
section("Restart");
persistence.commit = commit;
host.shutdown();
record("save size on disk", mb(statSync(dbPath).size), "MB");
t0 = performance.now();
const store = new WorldStore(dbPath, reg);
const restored = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ);
const count = store.loadChunks(restored);
record(`load ${count} structures and rebuild the collision grid`, performance.now() - t0, "ms", 3000);
t0 = performance.now();
const records = store.loadEntities();
record(`load ${records.length} entity records`, performance.now() - t0, "ms", 3000);
store.close();

// ---------------------------------------------------------------- client frame
section("Client frame build (headless): standing 60 m from a 2,000-piece base");
const pack = parsePack(buildCorePack());
const scene = new Scene({ dims: DIMS, hf, structs: restored }, reg, pack);
const cam = new Camera();
cam.x = centers[0]![0] + 60;
cam.z = centers[0]![1];
cam.y = hf.heightAt(cam.x, cam.z) + 8;
cam.yaw = Math.PI / 2 + Math.PI; // facing -X, toward the base
scene.structureDistance = 256;
t0 = performance.now();
let packet = scene.build(cam, null);
record("first frame, building instance buffers", performance.now() - t0, "ms");
const frame: number[] = [];
for (let i = 0; i < 300; i++) {
  cam.yaw += 0.002;
  const t = performance.now();
  packet = scene.build(cam, null);
  frame.push(performance.now() - t);
}
frame.sort((a, b) => a - b);
record("frame build, median", percentile(frame, 0.5), "ms", 1);
record("frame build, 99th percentile", percentile(frame, 0.99), "ms", 2);
record("terrain tiles (8 km map, 4 km view)", packet.tileCount, "", 200);
record("draw calls, structures within 256 m", packet.drawCount, "", 300);
record("triangles submitted", packet.triangles, "", 1500000);
scene.structureDistance = Infinity;
packet = scene.build(cam, null);
record("draw calls if every base to the horizon were instanced", packet.drawCount, "");
record("triangles if every base to the horizon were instanced", packet.triangles, "");

rmSync(dir, { recursive: true, force: true });
const misses = rows.filter((r) => r.budget !== null && r.value > r.budget);
const out = resolve("artifacts/bench.json");
mkdirSync(resolve("artifacts"), { recursive: true });
writeFileSync(out, JSON.stringify({ machine: `${cpus()[0]!.model}, ${cpus().length} cores`, bun: Bun.version, rows }, null, 2));
console.log(`\n${rows.filter((r) => r.budget !== null).length - misses.length} budgets met, ${misses.length} missed.  ${out}`);
if (misses.length > 0) process.exit(1);
