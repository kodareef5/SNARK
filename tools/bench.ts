// Benchmarks at the sizing target (planning/decisions.md D15). Each row is a measurement and the budget it is held to.
// Results are for the machine they ran on. Record them with it in planning/quality/performance.md.

import { heapStats } from "bun:jsc";
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { cpus, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { Camera } from "../client/core/render/camera.ts";
import { Scene } from "../client/core/render/scene.ts";
import { Falling } from "../client/core/rubble.ts";
import { ClientSession, RemoteSample, type Rubble } from "../client/core/session.ts";
import { AnimState, HumanAnim } from "../shared/anim/pose.ts";
import { ACT_NONE, ACT_SWING } from "../shared/sim/weapon.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { contentFor, createHost, type Host } from "../server/host.ts";
import { loadConfig, loadConfigFolder } from "../server/settings/config.ts";
import { Rules } from "../server/settings/rules.ts";
import { WorldStore } from "../server/persist/store.ts";
import { createWorld, type ServerWorld } from "../server/world.ts";
import { compileContent, type Registry } from "../shared/content/registry.ts";
import { STRUCT_UNITS, TICK_RATE, chunkAt } from "../shared/coords.ts";
import { hashBytes } from "../shared/hash.ts";
import { BitReader, BitWriter } from "../shared/net/codec.ts";
import { LoopbackNet, type LoopbackEnd } from "../shared/net/loopback.ts";
import { BOX_SELF, CMD_MOVE, InputBuffer, KEY_BYTES, PROTOCOL_VERSION, S_SNAPSHOT, writeCommand, writeHello, writeInputs } from "../shared/net/protocol.ts";
import { defaultLook } from "../shared/anim/look.ts";
import { scatterNodes, type NodeSpot } from "../shared/world/nodes.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../shared/net/transport.ts";
import { parsePack } from "../shared/pack/pack.ts";
import { Rng } from "../shared/rng.ts";
import { rollWild } from "../shared/sim/genome.ts";
import { Heightfield, TERRAIN_CELL } from "../shared/world/heightfield.ts";
import { poseAt, type Pose } from "../shared/world/snap.ts";
import { GONE_FELL, StructureStore } from "../shared/world/structures.ts";
import { AUDIO_HEADER, AUTH_BYTES, FRAME_SAMPLES, MODE_TALK, REACH_LOCAL, VOICE_BATCH, flagsOf, readBatch, writeAudio, writeAuth } from "../shared/voice/packet.ts";
import type { VoicePeer } from "../server/voice.ts";
import { crowdRows, fullViewRows } from "./bench/limits.ts";
import { storeRows } from "./bench/store.ts";
import { benchTactical } from "./bench/tactical.ts";
import { buildCorePack } from "./pack/build.ts";
import { stressSet } from "./pack/stress.ts";
import { assetWorld, type Thing } from "../tests/fixtures/assetworld.ts";
import { benchAgent } from "./bench/agent.ts";
import { benchPoses } from "./bench/poses.ts";
import { benchTextured } from "./bench/textured.ts";
import { benchTextures } from "./bench/textures.ts";

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
    writeHello(w, PROTOCOL_VERSION, contentHash, 0, name, 0, key, defaultLook());
    this.end.send(CH_RELIABLE, w.bytes());
  }

  private seq = 0;

  /** Sends the inventory screen's CMD_MOVE for a whole stack between two slots of the bot's inventory. */
  move(from: number, to: number, item: number): void {
    const w = this.w;
    w.reset();
    writeCommand(w, (this.seq = (this.seq + 1) & 0xffff), CMD_MOVE);
    w.bits(BOX_SELF, 1);
    w.varint(from);
    w.bits(BOX_SELF, 1);
    w.varint(to);
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

// Settings are ARK's defaults, or those of the config folder named after --config, to hold a boosted server to the same budgets.
const configAt = process.argv.indexOf("--config");
const configFolder = configAt >= 0 ? (process.argv[configAt + 1] ?? "") : "";
const benchRules = configFolder !== "" ? loadConfigFolder(configFolder).rules : new Rules();
const written = compileContent(CORE_CONTENT).registry!;
const reg = contentFor(written, benchRules);
const dir = mkdtempSync(join(tmpdir(), "snark-bench-"));
if (configFolder !== "") console.log(`settings: ${configFolder}`);
console.log(`SNARK benchmarks  ${cpus()[0]!.model}, ${cpus().length} cores, ${(totalmem() / 2 ** 30).toFixed(0)} GB, Bun ${Bun.version}, ${process.platform} ${process.arch}`);

// ---------------------------------------------------------------- world build
section("World at target scale");
let t0 = performance.now();
const hf = buildTerrain();
const mapHash = hashBytes(new Uint8Array(hf.heights.buffer, 0, 4096));
// Trees, rocks and bushes cover the whole map, at 160 slots a chunk, most of them filled.
const nodeKinds = ["core:tree", "core:tree", "core:tree", "core:rock", "core:rock", "core:bush"].map((id) => reg.index.get(id)!);
const nodeSource = scatterNodes(DIMS, hf, 0xbe7c, 160, nodeKinds, reg.halfY, () => true);
// The entity store is a server's own: it starts at 4,096 slots and doubles as the world fills, up to the MaxEntities setting.
// Settings that allow less than these sections put in the world are passed over, or the spawning below would not end.
const ENTITY_MAX = Math.max(benchRules.num("MaxEntities"), CREATURES + DORMANT_EXTRA + 16384);
const world = createWorld(reg, DIMS, hf, MAP_ID, mapHash, { x: 4096, z: 4096, yaw: 0 }, ENTITY_MAX, undefined, nodeSource);
record("terrain build, 8 km at 2 m", performance.now() - t0, "ms");
const rng = new Rng(2026);
t0 = performance.now();
const centers = buildBases(world, reg, rng);
record(`place ${STRUCTURES} structures in ${BASES} bases`, performance.now() - t0, "ms");
record("structures placed", world.structs.count, "");

const dbPath = join(dir, "world.db");
// More seats than ARK's 70, because the sizing target is 100 players.
const host: Host = createHost(reg, { dbPath, world, config: benchRules, commitEvery: 6, game: { maxClients: 128 } });
const persistence = host.persistence!;
t0 = performance.now();
persistence.commit();
record("first commit: every structure to disk", performance.now() - t0, "ms", 3000);

t0 = performance.now();
let spawned = 0;
while (spawned < CREATURES) if (host.spawnCreature("core:grazer", rng.range(200, 7990), rng.range(200, 7990), 1 + rng.int(150)) >= 0) spawned++;
record(`spawn ${CREATURES} creatures with genomes`, performance.now() - t0, "ms");
record("entity store slots after them, doubled from 4,096", world.ents.cap, "");
t0 = performance.now();
persistence.commit();
record(`commit ${CREATURES} new creature records`, performance.now() - t0, "ms");

// ---------------------------------------------------------------- players
// 40 players are in one fight, and 60 are in pairs at 30 other bases.
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
    sessions.push(new ClientSession(end, { name: `bot${i}`, key: new Uint8Array(KEY_BYTES).fill(i + 1), registry: reg, look: defaultLook(), resolveMap: () => hf, nodes: () => nodeSource }));
    continue;
  }
  bots.push(new Bot(net, `bot${i}`, reg.baseHash, 100 + i));
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
/** How long each database checkpoint between ticks took, in ms. */
const checkpoints: number[] = [];
function run(ticks: number, times: number[] | null): void {
  for (let i = 0; i < ticks; i++) {
    now += tickMs;
    net.advance(now);
    const t = performance.now();
    host.game.tick();
    if (times) times.push(performance.now() - t);
    // As the server's loop does between ticks. It is timed apart, because it runs in the time a tick leaves over.
    const idleAt = performance.now();
    host.idle();
    const idled = performance.now() - idleAt;
    if (idled > 0.2) checkpoints.push(idled);
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
// The first run measured 11.7 KB/s, from about 90 creatures in interest, most of them walking and sent every tick.
// 16 KB/s is 12.5 Mbit/s for a full server. See performance.md.
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
  // Filling a chunk nobody is near is what a player walking into new ground costs.
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
      // Strike the first node in the body's own chunk.
      const table = harvest.field.store.chunks[c.chunk];
      if (table) for (let slot = 0; slot < table.high; slot++) if (table.kind[slot] !== 0 && harvest.strike(c, c.chunk, slot)) break;
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
  // Owner state costs bytes only when it changes. The allowance for a busy survivor is 0.3 KB/s.
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
  // A stored stack runs no code, so the tick and the commit keep their budgets.
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
  // Spawn only in chunks that are not awake. The comparison needs these creatures dormant.
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
record("entity store slots after them", host.world.ents.cap, "");
record("bodies the entity store has refused", host.world.ents.refused, "", 0);
record("creatures awake before", awakeBefore, "");
record("creatures awake after (players wandered into denser ground)", host.creatures.awakeCount, "");
record("tick time, median, 30k creatures", baseline, "ms");
record("tick time, median, 300k creatures (same players)", percentile(after, 0.5), "ms", Math.round((baseline * 1.5 + 0.5) * 100) / 100);

// ---------------------------------------------------------------- combat
section("Combat: 100 players shooting twice a second, things in the air, and a blast in a base");
const pack = parsePack(buildCorePack());
{
  // Zone hits need bodies posed with the clips a real server has.
  world.anim = new HumanAnim(pack.clips);
  const ents = world.ents;
  const k = (name: string): number => reg.index.get(`core:${name}`)!;
  const [bow, arrow, rifle, round] = [k("bow"), k("arrow_stone"), k("rifle"), k("round_rifle")];
  // Nobody dies, so the load stays constant.
  for (const c of host.game.clients) if (c?.active) host.survival.gods.add(c.pid);
  const shots = host.projectiles;
  const firedBefore = shots.fired;
  const struckBefore = shots.struck;
  const aimRng = new Rng(99);
  const fight: number[] = [];
  let most = 0;
  for (let i = 0; i < 600; i++) {
    if (i % 15 === 0) {
      for (const c of host.game.clients) {
        if (!c?.active || c.ent < 0) continue;
        const rec = host.records.byPid.get(c.pid);
        if (!rec) continue;
        // Aim is roughly level, in a random direction. Half shoot arrows and half shoot rifles.
        ents.yaw[c.ent] = aimRng.int(65536);
        ents.pitch[c.ent] = Math.round((aimRng.float() - 0.4) * 2000);
        if (c.id % 2 === 0) shots.launch(c, rec, bow, 0, arrow, 1);
        else shots.launch(c, rec, rifle, 0, round, 1);
      }
    }
    run(1, fight);
    if (shots.flyingCount > most) most = shots.flyingCount;
  }
  fight.sort((a, b) => a - b);
  record("shots fired", shots.fired - firedBefore, "");
  record("shots that hit a body", shots.struck - struckBefore, "");
  record("most arrows in the air at once", most, "");
  record("tick time, median", percentile(fight, 0.5), "ms", 8);
  record("tick time, 99th percentile", percentile(fight, 0.99), "ms", 16);

  // 2,000 arrows in the air at once, shot high so they stay there.
  const step = shots.step.bind(shots);
  const stepTimes: number[] = [];
  shots.step = () => {
    const t = performance.now();
    step();
    stepTimes.push(performance.now() - t);
  };
  const archers = host.game.clients.filter((c) => c?.active && c.ent >= 0).slice(0, 20);
  for (const c of archers) {
    const rec = host.records.byPid.get(c!.pid)!;
    for (let n = 0; n < 100; n++) {
      ents.yaw[c!.ent] = aimRng.int(65536);
      ents.pitch[c!.ent] = 9000 + aimRng.int(5000);
      shots.launch(c!, rec, bow, 0, arrow, 1);
    }
  }
  record("things in the air", shots.flyingCount, "");
  run(60, null);
  stepTimes.sort((a, b) => a - b);
  record("fly 2,000 things one tick, median", percentile(stepTimes, 0.5), "ms", 2);
  record("fly 2,000 things one tick, 99th percentile", percentile(stepTimes, 0.99), "ms", 4);
  shots.step = step;

  // A grenade's blast in the middle of a 2,000-piece base.
  const [bx, bz] = centers[0]!;
  const by = hf.heightAt(bx, bz) + 1;
  const src = { by: null, x: bx, z: bz, item: k("grenade"), base: 788, type: 4, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
  const builtBefore = host.combat.structureHits;
  const blasts: number[] = [];
  for (let n = 0; n < 20; n++) {
    const t = performance.now();
    host.combat.blast(src, bx + n * 1.5 - 15, by, bz + (n % 5) * 2 - 4, 5);
    blasts.push(performance.now() - t);
  }
  blasts.sort((a, b) => a - b);
  record("things built that 20 blasts damaged", host.combat.structureHits - builtBefore, "");
  record("one blast in a 2,000-piece base, median", percentile(blasts, 0.5), "ms", 1);
  record("one blast in a 2,000-piece base, worst", blasts[blasts.length - 1]!, "ms", 4);
  record("items the ledger cannot account for", host.items.audit().length, "", 0);
}

// ---------------------------------------------------------------- collapse
section("Collapse: a 1,500-piece house loses every foundation at once, with the 40 of the fight watching");
/** The house's pieces as the Rubble a client receives, for the client frame section below. */
const wreck: Rubble[] = [];
{
  // 12 by 12 foundations and three storeys of real building pieces, beside the fight.
  const structs = world.structs;
  const piece = (name: string): number => reg.index.get(`core:${name}_stone`)!;
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const add = (name: string, target: number, k: number): number => {
    if (!poseAt(structs, reg, target, piece(name), k, 0, pose)) throw new Error(`no place for a ${name}`);
    return structs.add(piece(name), pose.x / STRUCT_UNITS, pose.y / STRUCT_UNITS, pose.z / STRUCT_UNITS, pose.yaw, 9000, 10000);
  };
  const N = 12;
  const [hx, hz] = [centers[0]![0] + 52, centers[0]![1] - 18];
  const before = structs.count;
  const ground: number[][] = [];
  for (let i = 0; i < N; i++) {
    ground.push([]);
    for (let j = 0; j < N; j++) ground[i]!.push(i === 0 && j === 0 ? structs.add(piece("foundation"), hx, hf.heightAt(hx, hz) + 0.1875, hz, 0, 9000, 15000) : j === 0 ? add("foundation", ground[i - 1]![0]!, 1) : add("foundation", ground[i]![j - 1]!, 0));
  }
  let tiles = ground;
  for (let storey = 0; storey < 3; storey++) {
    tiles = tiles.map((line, i) =>
      line.map((t, j) => {
        const north = add("wall", t, 0);
        add("wall", t, 1);
        if (j === 0) add("wall", t, 2);
        if (i === 0) add("wall", t, 3);
        return add("ceiling", north, 1);
      }),
    );
  }
  const pieces = structs.count - before;
  record("pieces in the house", pieces, "");
  // The same support query runs when a piece is placed.
  t0 = performance.now();
  let asked = 0;
  for (const line of tiles) for (const ref of line) asked += host.build.support.standsRef(ref) ? 1 : 0;
  record("ask whether a piece stands, mean", (performance.now() - t0) / asked, "ms", 0.1);
  run(90, null); // everyone near has it
  const houseChunk = chunkAt(DIMS, hx, hz);
  const watchers = host.game.clients.filter((c) => c?.active && c.known[houseChunk]! > 0).length;
  record("players who have the house", watchers, "");
  const origin = { x: hx, y: hf.heightAt(hx, hz) + 0.1875, z: hz };
  for (const t of structs.chunks) {
    if (!t) continue;
    for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && t.owner[s] === 9000) wreck.push({ kind: t.kind[s]!, x: t.x[s]!, y: t.y[s]!, z: t.z[s]!, yaw: t.yaw[s]!, cause: GONE_FELL, ox: origin.x, oy: origin.y, oz: origin.z, tick: 0 });
  }

  const build = host.build;
  const step = build.step.bind(build);
  const work: number[] = [];
  build.step = () => {
    const t = performance.now();
    step();
    if (build.collapse.busy || work.length === 0) work.push(performance.now() - t);
  };
  const sentBytes = host.game.stats.chunkBytes;
  const fallenBefore = build.fallen;
  const wavesBefore = build.collapse.waves;
  t0 = performance.now();
  for (const ref of ground.flat()) structs.damage(ref, 1e9, world.tick);
  record("destroy 144 foundations", performance.now() - t0, "ms", 2);
  const whole: number[] = [];
  let ticks = 0;
  while (build.collapse.busy && ticks < 900) {
    run(1, whole);
    ticks++;
  }
  run(30, whole); // the last of it reaches everyone
  build.step = step;
  work.sort((a, b) => a - b);
  whole.sort((a, b) => a - b);
  record("pieces that fell", build.fallen - fallenBefore, "");
  record("pieces of the house left standing", structs.count - before, "", 0);
  record("removals they fell in", build.collapse.waves - wavesBefore, "");
  record("ticks until the last was down", ticks, "", 60);
  record("collapse work in a tick, median", percentile(work, 0.5), "ms", 1.5);
  record("collapse work in a tick, worst", work[work.length - 1]!, "ms", 3);
  record("whole tick while it fell, worst", whole[whole.length - 1]!, "ms", 16);
  record("sent to each watcher for all of it", (host.game.stats.chunkBytes - sentBytes) / watchers, "bytes", pieces * 2);
  record("the same told row by row would be at least", pieces * 4, "bytes");
}

// ---------------------------------------------------------------- voice
section("Voice: 100 survivors in one crowd, all talking at once");
{
  // Everyone is within talking range of everyone, which is the relay's worst case.
  const voice = host.voice;
  const ents = world.ents;
  const crowd = centers[0]!;
  const spot = new Rng(77);
  const wires: { peer: VoicePeer; bytes: number; packets: number; heard: Set<number>; ever: Set<number> }[] = [];
  let mostAtOnce = 0;
  const auth = new Uint8Array(AUTH_BYTES);
  for (const c of host.game.clients) {
    if (!c?.active || c.ent < 0) continue;
    const x = crowd[0] + 70 + spot.range(-9, 9);
    const z = crowd[1] + spot.range(-9, 9);
    ents.setPosition(c.ent, x, world.hf.heightAt(x, z), z);
    const wire = { peer: null as unknown as VoicePeer, bytes: 0, packets: 0, heard: new Set<number>(), ever: new Set<number>() };
    wire.peer = voice.connect({
      send(data) {
        wire.bytes += data.length;
        wire.packets++;
        if (data[0] === VOICE_BATCH) readBatch(data, (speaker) => void (wire.heard.add(speaker), wire.ever.add(speaker)));
        return true;
      },
      close() {},
    });
    voice.receive(wire.peer, auth.subarray(0, writeAuth(auth, c.id, voice.token(c))), 0);
    wires.push(wire);
  }
  run(3, null);
  const opus = new Uint8Array(60).fill(7);
  opus[0] = 9 << 3;
  const packet = new Uint8Array(AUDIO_HEADER + opus.length);
  const flags = flagsOf(MODE_TALK, REACH_LOCAL, false, false);
  const before = { ...voice.stats };
  let relay = 0;
  let clock = 1000;
  let seq = 0;
  // Two seconds. Every 20 ms each survivor sends a frame, and the world ticks three times per five frames.
  const frames = 100;
  for (let f = 0; f < frames; f++) {
    const t = performance.now();
    for (const w of wires) voice.receive(w.peer, packet.subarray(0, writeAudio(packet, flags, seq, seq * FRAME_SAMPLES, opus)), clock);
    voice.flush();
    relay += performance.now() - t;
    // Record how many speakers each listener was sent in this frame.
    for (const w of wires) {
      if (w.heard.size > mostAtOnce) mostAtOnce = w.heard.size;
      w.heard.clear();
    }
    seq++;
    clock += 20;
    if (f % 5 === 1 || f % 5 === 3 || f % 5 === 4) run(1, null);
  }
  // Time the routing step alone, while everyone is still talking.
  const routes: number[] = [];
  const due = world.tick - (world.tick % 3);
  for (let k = 0; k < 60; k++) {
    const t = performance.now();
    voice.step(due);
    routes.push(performance.now() - t);
  }
  routes.sort((a, b) => a - b);
  const seconds = (frames * 20) / 1000;
  const packets = wires.length * frames;
  record("survivors talking", wires.length, "");
  record("frames relayed for each packet taken (the most a listener is sent is eight speakers)", (voice.stats.relayed - before.relayed) / (voice.stats.packets - before.packets), "", 8);
  record("most speakers any one listener was sent at once", mostAtOnce, "", 8);
  record("different speakers a listener heard in those two seconds, on average (they are all walking about)", wires.reduce((sum, w) => sum + w.ever.size, 0) / wires.length, "");
  record("relay work for one second of everyone talking", relay / seconds, "ms", 20);
  record("relay work per packet", (relay / packets) * 1000, "us");
  record("working out who hears whom, median", percentile(routes, 0.5), "ms", 0.5);
  record("working out who hears whom, worst", routes[routes.length - 1]!, "ms", 2);
  record("sent to each listener", wires.reduce((sum, w) => sum + w.bytes, 0) / wires.length / seconds / 1000, "KB/s", 31);
  record("packets refused or dropped", voice.stats.malformed + voice.stats.limited + voice.stats.dropped - before.malformed - before.limited - before.dropped, "", 0);
  for (const w of wires) voice.disconnect(w.peer);
}

// ---------------------------------------------------------------- brawl
section("Brawl: all 100 survivors in one 18 m square, with 400 creatures walking among them");
{
  // The voice section left everyone here. Each client now has every other in view, and more moving bodies than a snapshot carries.
  const crowd = centers[0]!;
  const herd = new Rng(78);
  let put = 0;
  for (let tries = 0; put < 400 && tries < 20000; tries++) {
    if (host.spawnCreature("core:grazer", crowd[0] + 70 + herd.range(-40, 40), crowd[1] + herd.range(-40, 40), 1 + herd.int(30)) >= 0) put++;
  }
  run(150, null);
  const sent = host.game.clients.map((c) => (c ? (c.conn as LoopbackEnd).bytesSent : 0));
  const ticks: number[] = [];
  const TICKS = 600;
  run(TICKS, ticks);
  ticks.sort((a, b) => a - b);
  const down = host.game.clients.map((c, i) => (c ? ((c.conn as LoopbackEnd).bytesSent - sent[i]!) / (TICKS / TICK_RATE) : 0)).filter((v) => v > 0);
  record("creatures put among them", put, "");
  record("tick time, median", percentile(ticks, 0.5), "ms", 8);
  record("tick time, 99th percentile", percentile(ticks, 0.99), "ms", 16);
  record("downstream per client", down.reduce((a, v) => a + v, 0) / down.length / 1024, "KB/s", 36);
  record("snapshots the real clients could not decode", sessions.reduce((n, c) => n + c.stats.undecodable, 0), "", 0);
}

// ---------------------------------------------------------------- siege
section("Siege: a 20,000-piece chunk beside that crowd, 50 of its pieces damaged every tick");
/** The chunk the siege section fills, for the client frame section that draws it. */
let siegeChunk = -1;
{
  const crowd = centers[0]!;
  const wall = reg.index.get("core:wall")!;
  siegeChunk = chunkAt(DIMS, crowd[0] + 70, crowd[1]);
  const x0 = (siegeChunk % DIMS.chunksX) * 64;
  const z0 = Math.floor(siegeChunk / DIMS.chunksX) * 64;
  const pieces = new Rng(79);
  const refs: number[] = [];
  // High in the air, so no body touches them. It is the count that is measured.
  for (let n = 0; n < 20000; n++) {
    const ref = world.structs.add(wall, x0 + 1 + pieces.range(0, 62), 200 + pieces.range(0, 60), z0 + 1 + pieces.range(0, 62), 0, 1, 1e9);
    if (ref >= 0) refs.push(ref);
  }
  record("pieces in the chunk", world.structs.chunks[siegeChunk]!.live, "");
  // 256 rows a tick to each client: 80 ticks for the chunk, and the bots' own fists keep changing it meanwhile.
  run(200, null);
  const quiet: number[] = [];
  run(150, quiet);
  quiet.sort((a, b) => a - b);
  commitTimes.length = 0;
  const bytes = host.game.stats.chunkBytes;
  const fire: number[] = [];
  // Counts the times the besieged chunk is written, and the bytes.
  const store = host.persistence!.store;
  const saveChunk = store.saveChunk.bind(store);
  let chunkWrites = 0;
  store.saveChunk = (chunk, t) => {
    if (chunk === siegeChunk) chunkWrites++;
    saveChunk(chunk, t);
  };
  for (let i = 0; i < 300; i++) {
    for (let k = 0; k < 50; k++) world.structs.damage(refs[pieces.int(refs.length)]!, 1);
    run(1, fire);
  }
  fire.sort((a, b) => a - b);
  commitTimes.sort((a, b) => a - b);
  record("tick time before the damage, median", percentile(quiet, 0.5), "ms");
  record("tick time under it, median", percentile(fire, 0.5), "ms", 8);
  record("tick time under it, 99th percentile", percentile(fire, 0.99), "ms", 16);
  // About 17 bytes a damaged piece. 1,500 pieces a second is far more than a raid does, and it is still under a snapshot's share.
  record("sent to each client for the damage", (host.game.stats.chunkBytes - bytes) / host.game.playerCount / 10 / 1024, "KB/s", 30);
  store.saveChunk = saveChunk;
  // The chunk is saved whole, 570 KB of it, but a chunk in which only health changes is written a second apart at most.
  record("times its chunk was written in those ten seconds", chunkWrites, "", 11);
  record("commit time under it, median", percentile(commitTimes, 0.5), "ms", 4);
  record("commit time under it, 99th percentile (a commit that writes the chunk)", percentile(commitTimes, 0.99), "ms", 10);
}

benchTactical(host, siegeChunk, (ticks) => run(ticks, null), section, record);

// ---------------------------------------------------------------- breeding
section("A breeding base: 300 tames all told to mate, 150 young, 100 eggs, and ten survivors among them");
{
  const ents = world.ents;
  const records = host.records;
  const breeding = host.breeding;
  const parasaur = reg.index.get("core:parasaur")!;
  const eggKind = reg.index.get("core:egg_parasaur")!;
  const berry = reg.index.get("core:berry")!;
  // On open ground east of an empty base. Ten survivors stand there, and one of them, a real client, owns the creatures.
  const ox = centers[60]![0] + 70;
  const oz = centers[60]![1] - 30;
  // bot50 (the second real client) and the nine after it were not in the fight, so all ten are alive.
  const keepers = host.game.clients.filter((c) => c?.active && c.ent >= 0 && Number(c.name.slice(3)) >= 50 && Number(c.name.slice(3)) < 60).map((c) => c!);
  const owner = records.byPid.get(keepers.find((c) => c.name === "bot50")!.pid)!;
  const stand = (): void => keepers.forEach((c, i) => ents.setPosition(c.ent, ox + 8 + i * 7, hf.heightAt(ox + 8 + i * 7, oz + 32), oz + 32));
  stand();
  run(90, null);
  const quiet: number[] = [];
  run(300, quiet);
  quiet.sort((a, b) => a - b);

  const place = rng;
  const put = (i: number, row: number): number => {
    // At its place in the rows, or as near as the trees and rocks allow.
    for (let k = 0; k < 60; k++) {
      const wide = 0.4 + k * 0.05;
      const e = host.spawnCreature("core:parasaur", ox + (i % 20) * 4 + place.range(-wide, wide), oz + row * 4 + Math.floor(i / 20) * 4 + place.range(-wide, wide), 1 + place.int(60));
      if (e >= 0) return e;
    }
    throw new Error(`no room for the breeding base (${ents.count} of ${ents.max} bodies in the world)`);
  };
  // 300 adults, alternating female and male four metres apart, all tamed and all set to mate.
  t0 = performance.now();
  for (let i = 0; i < 300; i++) {
    const e = put(i, 0);
    const rec = records.byPid.get(ents.pid[e]!)!;
    rec.genome!.female = i % 2 === 0;
    host.taming.give(rec, owner, 1);
    rec.mating = true;
  }
  // 150 young of every age, each carrying berries to eat as it grows.
  const span = reg.matureTicks[parasaur]!;
  for (let i = 0; i < 150; i++) {
    const e = put(i, 16);
    const rec = records.byPid.get(ents.pid[e]!)!;
    rec.team = owner.team;
    rec.grown = world.tick + 1 + Math.floor(((i + 1) / 151) * span);
    rec.span = span;
    ents.setYoung(e, rec.span, rec.grown);
    host.items.mint(rec, berry, 60);
    host.refreshBody(rec);
    host.creatures.mind.stay(e, 0xffffffff);
    host.creatures.claimed(e);
    host.taming.meal(rec);
  }
  // 100 eggs, each with its own hatch time within the hour.
  for (let i = 0; i < 100; i++) {
    const egg = records.create(eggKind, "parasaur egg");
    egg.genome = rollWild(place, 1 + place.int(60), [3, 5, 6, 7, 9, 12, 15]);
    egg.x = ox + 2 + (i % 20) * 4;
    egg.z = oz + 26 + Math.floor(i / 20) * 1.2;
    egg.y = hf.heightAt(egg.x, egg.z);
    egg.egg = { species: parasaur, span: 2000 + i * 1000, hatchAt: world.tick + 2000 + i * 1000, carrier: 0 };
    host.death.place(egg);
  }
  breeding.resume();
  record("set the base down", performance.now() - t0, "ms");
  stand();
  run(60, null);
  record("pairs, a second after they were told", breeding.pairCount, "");
  const real = sessions[1]!;
  const sentAt = keepers.map((c) => (c.conn as LoopbackEnd).bytesSent);
  const busy: number[] = [];
  run(300, busy);
  busy.sort((a, b) => a - b);
  const perKeeper = keepers.reduce((sum, c, i) => sum + (c.conn as LoopbackEnd).bytesSent - sentAt[i]!, 0) / keepers.length / (300 / TICK_RATE) / 1024;
  record("tick time there before the base, median", percentile(quiet, 0.5), "ms");
  record("tick time with the base awake and mating, median", percentile(busy, 0.5), "ms", Math.round((percentile(quiet, 0.5) * 1.5 + 0.5) * 100) / 100);
  record("tick time with the base awake and mating, 99th percentile", percentile(busy, 0.99), "ms", 16);
  record("downstream per survivor at the base", perKeeper, "KB/s", 34);
  // The real client there must be shown all nine other survivors, however many creatures are in view.
  const shown = new RemoteSample();
  real.sampleRemote(shown);
  const survivorKind = reg.index.get("core:survivor")!;
  let others = 0;
  for (let i = 0; i < shown.count; i++) if (shown.kind[i] === survivorKind) others++;
  record("bodies the real client there is shown (of the 512 a client is shown until it asks)", shown.count, "");
  record("survivors there it is not shown, of the other nine", 9 - Math.min(9, others), "", 0);
  // Time the pair search alone. It checks every willing female against every willing male, once a second.
  const looks: number[] = [];
  const passTick = world.tick - (world.tick % TICK_RATE);
  for (let k = 0; k < 60; k++) {
    const t = performance.now();
    breeding.step(passTick);
    looks.push(performance.now() - t);
  }
  looks.sort((a, b) => a - b);
  record("the look for pairs, median (one tick in thirty)", percentile(looks, 0.5), "ms", 0.5);
  record("the look for pairs, worst", looks[looks.length - 1]!, "ms", 2);
  // Half a minute after they began, every pair finishes on the same tick, so 150 females lay at once.
  const laying: number[] = [];
  run(600, laying);
  laying.sort((a, b) => a - b);
  record("matings that came to something", breeding.mated, "");
  record("eggs laid by them", breeding.laid, "");
  record("worst tick while they all laid", laying[laying.length - 1]!, "ms", 33.3);
  record("meals the young ate of what they carry, in all of that", host.taming.meals, "");
}

// ---------------------------------------------------------------- crowd
// Back where the brawl was. The second real client is alive, and asks for all a view holds.
crowdRows({ section, record, percentile }, host, run, sessions[1]!, centers[0]![0] + 70, centers[0]![1]);

// ---------------------------------------------------------------- restart
section("Between ticks");
// A tick leaves about 30 ms before the next, and the checkpoint runs in that. The worst follows the bulk writes above
// (10,000 containers in one commit, 270,000 creatures in another), which a running server does not make.
checkpoints.sort((a, b) => a - b);
record("database checkpoints so far", checkpoints.length, "");
record("a checkpoint, median", percentile(checkpoints, 0.5), "ms", 10);
record("a checkpoint, worst", checkpoints[checkpoints.length - 1] ?? 0, "ms");

section("Restart");
persistence.commit = commit;
host.shutdown();
record("save size on disk", mb(statSync(dbPath).size), "MB");
t0 = performance.now();
const store = new WorldStore(dbPath, reg);
const restored = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
const count = store.loadChunks(restored);
record(`load ${count} structures and rebuild the collision grid`, performance.now() - t0, "ms", 3000);
t0 = performance.now();
const records = store.loadEntities();
record(`load ${records.length} entity records`, performance.now() - t0, "ms", 3000);
store.close();

// ---------------------------------------------------------------- restart under other settings
section("Restart under other settings: the save of the sizing target, every timer and rate brought over");
{
  // Starts a host on the save twice, under the settings it was saved under and under settings that change every timer and
  // rate a load converts. The difference is the cost of the conversion.
  const fresh = (content: typeof reg): ServerWorld => createWorld(content, DIMS, hf, MAP_ID, mapHash, { x: 4096, z: 4096, yaw: 0 }, ENTITY_MAX, undefined, nodeSource);
  const start = (rules: Rules): { host: Host; ms: number } => {
    Bun.gc(true);
    const at = performance.now();
    const again = createHost(reg, { dbPath, world: fresh(contentFor(written, rules)), config: rules, commitEvery: 6, game: { maxClients: 128 } });
    return { host: again, ms: performance.now() - at };
  };
  const same = start(benchRules);
  record("start a host on the save, same settings", same.ms, "ms");
  same.host.shutdown();
  const was = (name: string): number => benchRules.num(name);
  const other = loadConfig({
    gus: `[ServerSettings]\nDinoCharacterFoodDrainMultiplier=${was("DinoCharacterFoodDrainMultiplier") * 2}\nPlayerCharacterFoodDrainMultiplier=${was("PlayerCharacterFoodDrainMultiplier") * 2}\nResourcesRespawnPeriodMultiplier=${was("ResourcesRespawnPeriodMultiplier") * 0.5}\nItemStackSizeMultiplier=${was("ItemStackSizeMultiplier")}\n`,
    game: `[/script/shootergame.shootergamemode]\nEggHatchSpeedMultiplier=${was("EggHatchSpeedMultiplier") * 2}\nBabyMatureSpeedMultiplier=${was("BabyMatureSpeedMultiplier") * 0.5}\nMatingIntervalMultiplier=${was("MatingIntervalMultiplier") * 2}\nGlobalSpoilingTimeMultiplier=${was("GlobalSpoilingTimeMultiplier") * 2}\nFuelConsumptionIntervalMultiplier=${was("FuelConsumptionIntervalMultiplier") * 0.5}\nGlobalCorpseDecompositionTimeMultiplier=${was("GlobalCorpseDecompositionTimeMultiplier") * 2}\nGlobalItemDecompositionTimeMultiplier=${was("GlobalItemDecompositionTimeMultiplier") * 2}\n`,
  }).rules;
  const moved = start(other);
  // The load converts eggs, young, mating waits, bags, the spoil time of every stack, fires, respawning nodes and every body's rates.
  record("start a host on it under other settings", moved.ms, "ms", 5000);
  record("of that, the bringing over", Math.max(0, moved.ms - same.ms), "ms", 2000);
  let rated = 0;
  for (const rec of moved.host.records.byPid.values()) if (rec.vitals) rated++;
  record("bodies rated again", rated, "");
  t0 = performance.now();
  moved.host.persistence!.commit();
  // One commit writes everything that changed, with the settings it changed under.
  record("the first commit after it", performance.now() - t0, "ms", 5000);
  record("the item ledger still balances after it (0 is yes)", moved.host.items.audit().length, "", 0);
  moved.host.shutdown();
}

// ---------------------------------------------------------------- entity store
storeRows(section, record);

// ---------------------------------------------------------------- client frame
section("Client frame build (headless): standing 60 m from a 2,000-piece base");
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

section("Client frame build (headless): the 20,000-piece chunk told of 50 damaged pieces every frame");
{
  const t = restored.chunks[siegeChunk]!;
  const hit = new Rng(80);
  const times: number[] = [];
  let uploaded = 0;
  scene.build(cam, null);
  for (let i = 0; i < 300; i++) {
    // As a client is told: each damaged row whole, then the chunk's new version.
    const version = t.version + 1;
    for (let k = 0; k < 50; k++) {
      let slot = hit.int(t.high);
      while (t.kind[slot] === 0) slot = hit.int(t.high);
      restored.put(siegeChunk, slot, t.kind[slot]!, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, t.owner[slot]!, t.hp[slot]! - 1, version);
    }
    restored.setVersion(siegeChunk, version);
    const at = performance.now();
    packet = scene.build(cam, null);
    times.push(performance.now() - at);
    for (const u of packet.uploads) uploaded += u.data.length;
  }
  times.sort((a, b) => a - b);
  record("pieces in the chunk", t.live, "");
  record("take the rows in and build the frame, median", percentile(times, 0.5), "ms", 1);
  record("take the rows in and build the frame, 99th percentile", percentile(times, 0.99), "ms", 2);
  record("instance bytes uploaded again in those 300 frames", uploaded, "bytes", 0);
}

section("Client frame build (headless): 300 survivors in view, posed every frame");
{
  scene.structureDistance = 256;
  const crowd = new RemoteSample();
  const survivor = reg.index.get("core:survivor")!;
  const st = new AnimState();
  const crowdRng = new Rng(5);
  // A crowd 5 to 60 m ahead of the camera, walking or running, a third of them swinging.
  cam.yaw = Math.PI / 2 + Math.PI;
  for (let i = 0; i < 300; i++) {
    crowd.id[i] = i + 1;
    crowd.kind[i] = survivor;
    crowd.x[i] = cam.x - 5 - crowdRng.float() * 55;
    crowd.z[i] = cam.z + (crowdRng.float() - 0.5) * 50;
    crowd.y[i] = hf.heightAt(crowd.x[i]!, crowd.z[i]!);
    crowd.yaw[i] = crowdRng.float() * Math.PI * 2;
    st.setMotion(crowdRng.float() * 7, crowdRng.float() * 2, 0, 0);
    st.setAction(i % 3 === 0 ? ACT_SWING : ACT_NONE, i % 2, 100 + (i % 12));
    crowd.anim[i] = st.pack();
  }
  crowd.count = 300;
  crowd.tick = 110;
  const posed: number[] = [];
  for (let i = 0; i < 200; i++) {
    crowd.tick += 0.5;
    const t = performance.now();
    packet = scene.build(cam, crowd);
    posed.push(performance.now() - t);
  }
  posed.sort((a, b) => a - b);
  record("bodies posed in the frame", scene.characters.posed, "");
  record("frame build with them, median", percentile(posed, 0.5), "ms", 4);
  record("frame build with them, 99th percentile", percentile(posed, 0.99), "ms", 8);
  record("draw calls", packet.drawCount, "", 400);
}

section("Client frame build (headless): a breeding base in view, the 512 bodies a client is shown until it asks for more");
{
  // A full view: ten survivors, 300 grown creatures, 150 young of every age, and eggs for the rest.
  const base = new RemoteSample();
  const kinds = { survivor: reg.index.get("core:survivor")!, parasaur: reg.index.get("core:parasaur")!, raptor: reg.index.get("core:raptor")!, egg: reg.index.get("core:egg_parasaur")! };
  const st = new AnimState();
  const baseRng = new Rng(9);
  cam.yaw = Math.PI / 2 + Math.PI;
  const n = 512;
  for (let i = 0; i < n; i++) {
    base.id[i] = i + 1;
    base.kind[i] = i < 10 ? kinds.survivor : i < 460 ? (i % 3 === 0 ? kinds.raptor : kinds.parasaur) : kinds.egg;
    base.x[i] = cam.x - 6 - baseRng.float() * 70;
    base.z[i] = cam.z + (baseRng.float() - 0.5) * 60;
    base.y[i] = hf.heightAt(base.x[i]!, base.z[i]!);
    base.yaw[i] = baseRng.float() * Math.PI * 2;
    base.flags[i] = i < 460 ? 1 : 1 | 8;
    // Each young has its own span, so they are at different ages. A third of the survivors and creatures walk.
    if (i >= 310) {
      base.span[i] = 1000 + Math.floor(baseRng.float() * 1000);
      base.grown[i] = base.span[i]! + 1000;
    }
    st.setMotion(i < 460 && i % 3 === 1 ? 2 + baseRng.float() * 4 : 0, 0, 0, 0);
    st.setAction(ACT_NONE, 0, 0);
    base.anim[i] = st.pack();
  }
  base.count = n;
  base.tick = 2000;
  const built: number[] = [];
  for (let i = 0; i < 200; i++) {
    base.tick += 0.5;
    const t = performance.now();
    packet = scene.build(cam, base);
    built.push(performance.now() - t);
  }
  built.sort((a, b) => a - b);
  record("bodies in view", n, "");
  record("bodies posed in the frame (those the camera can see)", scene.characters.posed, "");
  record("bones used, of the 16,384 medium poses with", packet.boneCount, "", 16384);
  record("triangles submitted", packet.triangles, "", 1500000);
  record("frame build with them, median", percentile(built, 0.5), "ms", 4);
  record("frame build with them, 99th percentile", percentile(built, 0.99), "ms", 8);
  record("draw calls", packet.drawCount, "", 400);
}

fullViewRows({ section, record, percentile }, scene, cam, reg, hf);

section("Client frame build (headless): that house coming down 60 m off");
{
  // The pieces arrive about a hundred a tick, as the server's waves would send them.
  cam.x = wreck[0]!.ox - 30;
  cam.z = wreck[0]!.oz + 18;
  cam.y = hf.heightAt(cam.x, cam.z) + 8;
  cam.yaw = Math.PI / 2 + Math.PI;
  const falling = new Falling(reg.halfY, (x, z) => hf.heightAt(x, z));
  scene.falling = falling;
  wreck.sort((p, q) => Math.hypot(p.x - p.ox, p.z - p.oz) - Math.hypot(q.x - q.ox, q.z - q.oz));
  const taking: number[] = [];
  const fallFrames: number[] = [];
  let most = 0;
  let at = 0;
  for (let f = 0; f < 240; f++) {
    const nowMs = f * (1000 / 60);
    const lot: Rubble[] = [];
    if (f % 2 === 0) for (let k = 0; k < 110 && at < wreck.length; k++) lot.push({ ...wreck[at++]!, tick: f >> 1 });
    let t = performance.now();
    falling.absorb(lot, nowMs, cam.x, cam.y, cam.z);
    falling.step(nowMs);
    taking.push(performance.now() - t);
    if (falling.count > most) most = falling.count;
    t = performance.now();
    packet = scene.build(cam, null);
    if (falling.count > 0) fallFrames.push(performance.now() - t);
  }
  taking.sort((a, b) => a - b);
  fallFrames.sort((a, b) => a - b);
  record("pieces told of", falling.taken, "");
  record("most shown falling at once", most, "", 1024);
  record("take them in and move them, worst frame", taking[taking.length - 1]!, "ms", 1);
  record("frame build while they fall, median", percentile(fallFrames, 0.5), "ms", 1.5);
  record("frame build while they fall, 99th percentile", percentile(fallFrames, 0.99), "ms", 3);
  record("pieces still in the air four seconds on", falling.count, "", 0);
  scene.falling = null;
}

// ---------------------------------------------------------------- assets that stream
section("Asset library (headless): 64 rocks of five levels and a 263,169-vertex plate, over 20 Mbit/s with 50 ms delay");
{
  const set = stressSet();
  const meshOf = (id: string): number => set.manifest.meshes.findIndex((m) => m.id === id);
  const spot = new Rng(21);
  const field: Thing[] = Array.from({ length: 64 }, (_, i) => ({ mesh: meshOf(`stress:rock_${String(i).padStart(2, "0")}`), x: spot.range(-150, 150), z: spot.range(-150, 150) }));
  field.push({ mesh: meshOf("stress:plate"), x: 0, z: 0 });
  const link = { latencyMs: 50, bytesPerSecond: 2.5e6 };
  record("the two files, boot and stream", mb(set.files[0]!.bytes.length + set.files[1]!.bytes.length), "MB");
  record("the boot file", mb(set.files[0]!.bytes.length), "MB", 1);

  // Standing in the middle of the field from nothing.
  const stand = assetWorld(set, field, link);
  let usableAt = -1;
  let wantedAt = -1;
  for (let f = 0; f < 20 * 60 && wantedAt < 0; f++) {
    stand.frame(0);
    if (usableAt < 0 && stand.usable()) usableAt = stand.now();
    if (stand.settled()) wantedAt = stand.now();
  }
  record("time to first usable detail", (usableAt < 0 ? Infinity : usableAt) / 1000, "s", 1.5);
  record("time to the detail wanted", (wantedAt < 0 ? Infinity : wantedAt) / 1000, "s", 6);
  record("bytes fetched for it", mb(stand.r.stats.fetched), "MB");
  const before = stand.r.stats.requests + stand.r.stats.evicted;
  stand.run(10, 0);
  record("requests and evictions in ten seconds standing there", stand.r.stats.requests + stand.r.stats.evicted - before, "", 0);

  // Flying across the field at 25 m/s.
  const fly = assetWorld(set, field, link);
  fly.run(16, -200, 25);
  record("fly-through: bytes fetched over bytes drawn", fly.r.stats.fetched / Math.max(1, fly.r.stats.used), "", 1.3);
  record("fly-through: requests given up, of those made", (100 * fly.r.stats.cancelled) / Math.max(1, fly.r.stats.requests), "%", 15);
  record("fly-through: draws left out", fly.r.stats.skipped, "", 0);
  record("fly-through: most requests under way at once", fly.port.mostAtOnce, "", 6);

  // The same flight with room on the card for a fifth of what it draws.
  const budget = 4 * 1048576;
  const small = assetWorld(set, field, link, { gpuBytes: budget });
  small.run(16, -200, 25);
  record("small card: the most it held, over its budget", small.card.most / budget, "", 1.25);
  record("small card: draws left out", small.r.stats.skipped, "", 0);
  record("small card: how much coarser everything was asked for at the end", small.r.relax, "x");

  // 2,000 things in view, each choosing a level, wanting it and being drawn.
  const many: Thing[] = Array.from({ length: 2000 }, (_, i) => ({ mesh: field[i % 64]!.mesh, x: spot.range(-900, 900), z: spot.range(-900, 900) }));
  const crowd = assetWorld(set, many, { bytesPerSecond: 200e6 });
  crowd.run(3, 0);
  const frames: number[] = [];
  for (let f = 0; f < 600; f++) {
    const t = performance.now();
    crowd.frame(f * 0.2);
    frames.push(performance.now() - t);
  }
  frames.sort((a, b) => a - b);
  record("2,000 things: choose, want and draw each, with the strict card, median", percentile(frames, 0.5), "ms", 0.15);
  record("2,000 things: the same, 99th percentile", percentile(frames, 0.99), "ms", 0.5);
}

benchAgent(section, record);
benchPoses(section, record);
benchTextured(section, record);
await benchTextures(section, record);

rmSync(dir, { recursive: true, force: true });
const misses = rows.filter((r) => r.budget !== null && r.value > r.budget);
const out = resolve(configFolder !== "" ? `artifacts/bench-${configFolder.replace(/\/+$/, "").split("/").pop()}.json` : "artifacts/bench.json");
mkdirSync(resolve("artifacts"), { recursive: true });
writeFileSync(out, JSON.stringify({ machine: `${cpus()[0]!.model}, ${cpus().length} cores`, bun: Bun.version, rows }, null, 2));
console.log(`\n${rows.filter((r) => r.budget !== null).length - misses.length} budgets met, ${misses.length} missed.  ${out}`);
if (misses.length > 0) process.exit(1);
