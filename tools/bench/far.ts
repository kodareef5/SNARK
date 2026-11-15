// The far feed's benchmark rows: what it sends a session joining and after, what its scan costs a tick for 100 sessions, a
// siege watched from afar, and a join on D225's link model with the feed and without.
// tools/bench.ts calls benchFar on its world. Run alone (bun tools/bench/far.ts) it makes a world like that one.

import { CORE_CONTENT } from "../../content/core.ts";
import type { Client } from "../../server/game.ts";
import { contentFor, createHost, type Host } from "../../server/host.ts";
import { Rules } from "../../server/settings/rules.ts";
import { createWorld } from "../../server/world.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, TICK_RATE, chunkAt, chunkCx, chunkCz } from "../../shared/coords.ts";
import { hashBytes } from "../../shared/hash.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { LoopbackNet, type LoopbackEnd } from "../../shared/net/loopback.ts";
import { InputBuffer, KEY_BYTES, PROTOCOL_VERSION, S_SNAPSHOT, writeHello, writeInputs } from "../../shared/net/protocol.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../../shared/net/transport.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Summary, FAR_RADIUS, bakeChunk, pieceShapes } from "../../shared/world/tactical.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FAR_SLOTS, farPart } from "../../client/core/render/far.ts";
import { FAR_NODE_BUFFERS, farNodeOf } from "../../client/core/render/farnodes.ts";
import { ATLAS_REGION, type FramePacket } from "../../client/core/render/packet.ts";
import { INSTANCE_BYTES, parsePack } from "../../shared/pack/pack.ts";
import { castle, farWorld } from "../../tests/fixtures/farworld.ts";
import { nodeWorld } from "../../tests/fixtures/nodeworld.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { buildCorePack } from "../pack/build.ts";

type Record = (name: string, value: number, unit: string, budget?: number | null) => void;
type Run = (ticks: number, times: number[] | null) => void;

const mean = (a: number[]): number => (a.length === 0 ? 0 : a.reduce((s, v) => s + v, 0) / a.length);
const median = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;

/** Every session on `host` asks for 2 km, as medium does. Then a join, thirty quiet seconds, and thirty of a siege, with the feed and without. */
export function benchFar(host: Host, run: Run, section: (title: string) => void, record: Record): void {
  const { tactical, game, world } = host;
  const clients = game.clients.filter((c): c is Client => c !== null && c.active);
  section(`The far feed: ${clients.length} sessions asking for ${FAR_RADIUS} m`);
  const stats = tactical.stats;
  record("chunks with far cells on the map", tactical.summaries.filter((s) => s !== null && s.far.filled > 0).length, "");
  // The feed is timed where it runs, and what each session is sent is counted where it is let through.
  type Step = (c: Client, h: unknown) => void;
  const feed = tactical as unknown as { listFar: Step; sendFar: Step };
  const [list, send] = [feed.listFar, feed.sendFar];
  let spent = 0;
  const timed = (step: Step): Step => (c, h) => {
    const t = performance.now();
    step.call(tactical, c, h);
    spent += performance.now() - t;
  };
  feed.listFar = timed(list);
  feed.sendFar = timed(send);
  const bytes = new Float64Array(game.clients.length);
  const spend = game.spendChunkWindow.bind(game);
  game.spendChunkWindow = (c, n) => {
    const ok = spend(c, n);
    if (ok) bytes[c.id] = bytes[c.id]! + n;
    return ok;
  };
  const each = (): number[] => clients.map((c) => bytes[c.id]!);

  for (const c of clients) tactical.ask(c, FAR_RADIUS);
  const [messages, sent] = [stats.far, stats.farBytes];
  run(20 * TICK_RATE, null);
  const joined = each();
  record("far cells sent to each session in its first 20 s, mean", mean(joined) / 1024, "KB");
  record("the same, the most", Math.max(...joined) / 1024, "KB");
  record("bytes a chunk's far message, mean", (stats.farBytes - sent) / Math.max(1, stats.far - messages), "bytes");

  bytes.fill(0);
  const scans: number[] = [];
  for (let i = 0; i < 30 * TICK_RATE; i++) {
    spent = 0;
    run(1, null);
    scans.push(spent);
  }
  record("far cells sent to each session after, mean", mean(each()) / 30 / 1024, "KB/s", 0.2);
  record("the far feed's share of a tick, mean", mean(scans), "ms", 0.05);
  record("the same, worst tick", Math.max(...scans), "ms");

  // The ten base chunks the most sessions are within reach of each lose their highest piece a second.
  const within = (c: Client, chunk: number): boolean => ((chunkCx(world.dims, chunk) + 0.5) * CHUNK_SIZE - c.body.x) ** 2 + ((chunkCz(world.dims, chunk) + 0.5) * CHUNK_SIZE - c.body.z) ** 2 <= FAR_RADIUS ** 2;
  const besieged = tactical.summaries
    .map((s, chunk) => (s && s.far.filled > 0 ? { chunk, n: clients.filter((c) => within(c, chunk)).length } : null))
    .filter((v) => v !== null)
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);
  record("sessions within reach of each besieged chunk, mean", mean(besieged.map((b) => b.n)), "");
  const siege = (radius: number): number[] => {
    host.setSetting("FarRadius", String(radius));
    bytes.fill(0);
    const times: number[] = [];
    for (let second = 0; second < 30; second++) {
      for (const { chunk } of besieged) {
        const t = world.structs.chunks[chunk]!;
        let top = -1;
        for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && (top < 0 || t.y[s]! > t.y[top]!)) top = s;
        if (top >= 0) world.structs.remove(chunk * 65536 + top);
      }
      run(TICK_RATE, times);
    }
    return times;
  };
  const on = siege(FAR_RADIUS);
  const sieged = clients.filter((c) => besieged.some((b) => within(c, b.chunk))).map((c) => bytes[c.id]! / 30 / 1024);
  record("a siege's far cells to each session watching, mean", mean(sieged), "KB/s", 2);
  record("the same, the most", Math.max(0, ...sieged), "KB/s", 2);
  record("tick median through the siege, the feed on", median(on), "ms");
  const off = siege(0);
  record("tick median through the siege, the feed off", median(off), "ms");
  host.setSetting("FarRadius", String(FAR_RADIUS));
  feed.listFar = list;
  feed.sendFar = send;
  game.spendChunkWindow = spend;
  benchFarJoins(section, record);
  benchFarBlocks(section, record);
  benchFarNodes(section, record);
}

/**
 * Far trees, rocks and bushes (D259): the 8 km map of hills, 160 slots a chunk of trees, rocks and bushes 3 to 2 to 1,
 * from its middle at 1,080 rows across 102 degrees. Making tiles, each tier's draws and triangles, and the frame build
 * of a walk across chunk borders.
 */
export function benchFarNodes(section: (title: string) => void, record: Record): void {
  section("Far nodes: the 8 km map's wood, 160 slots a chunk, from its middle");
  const ground = (x: number, z: number): number => 40 + 30 * Math.sin(x / 400) * Math.cos(z / 350) + 8 * Math.sin(x / 53) * Math.sin(z / 61);
  const w = nodeWorld({ chunksX: 128, chunksZ: 128, ground, kinds: ["core:tree", "core:tree", "core:tree", "core:rock", "core:rock", "core:bush"], perChunk: 160, width: 16, height: 9, pack: parsePack(buildCorePack()) });
  w.scene.viewHeight = 1080;
  w.cam.fovY = (70 * Math.PI) / 180;
  w.cam.aspect = 16 / 9;
  const far = w.scene.nodesFar!;
  const makes = far.makes;
  const hook = w.scene as unknown as { farNodes: (cam: unknown) => void };
  const inner = hook.farNodes;
  let spent = 0;
  hook.farNodes = function (this: unknown, cam: unknown): void {
    const t = performance.now();
    inner.call(this, cam);
    spent += performance.now() - t;
  };
  const mid = 4096 + 10;
  /** Stands the body and the camera at (x, z), looking along +x, and builds a frame: its packet, ms, and the far nodes' share. */
  const at = (x: number, z: number, yaw = Math.PI / 2): { p: FramePacket; ms: number; far: number } => {
    w.stand(x, z);
    w.look(x, w.hf.heightAt(x, z) + 1.7, z, yaw, 0);
    spent = 0;
    const t = performance.now();
    const p = w.frame();
    return { p, ms: performance.now() - t, far: spent };
  };
  const nodeDraws = (p: FramePacket): number[] => [...Array(p.drawCount).keys()].filter((d) => p.drawBuffer[d]! >= FAR_NODE_BUFFERS && p.drawBuffer[d]! < FAR_NODE_BUFFERS * 2);
  const tris = w.scene.assets.table.tris;
  // A far draw holds every mesh, each instance its row of the atlas at its mesh's last level.
  const each = (data: Uint8Array, i: number): number => tris[far.meshOfRow(data[i * INSTANCE_BYTES + 14 + ATLAS_REGION]!)]!.at(-1)!;
  const triangles = (p: FramePacket): number => {
    let n = 0;
    for (const d of nodeDraws(p)) {
      const { data } = w.card.get(p.drawBuffer[d]!)!;
      for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) n += each(data, i);
    }
    return n;
  };
  /** Triangles of the far nodes drawn that stand in view and within their kind's reach: what the plan's rows count. */
  const inView = (p: FramePacket): number => {
    let n = 0;
    const runs = new Set<string>();
    for (const d of nodeDraws(p)) {
      const run = `${p.drawBuffer[d]}/${p.drawFirst[d]}`;
      if (runs.has(run)) continue;
      runs.add(run);
      const { data, slots } = w.card.get(p.drawBuffer[d]!)!;
      const f32 = new Float32Array(data.buffer);
      for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
        const [x, y, z] = [0, 1, 2].map((a) => f32[i * 5 + a]! + p.drawOffset[d * 3 + a]!);
        const [chunk, slot] = farNodeOf(w.dims, p.drawBuffer[d]!, slots[i]!);
        // A node short of the band, which a draw fading it in keeps none of, is the near store's.
        const kept = p.drawHand[d] === 0 || Math.hypot(x!, y!, z!) > w.scene.assets.tier.nodes.band[0];
        if (kept && Math.hypot(x!, y!, z!) < far.reachOf(w.field.kindAt(chunk, slot)) && w.cam.boxVisible(x!, y!, z!, x!, y!, z!)) n += each(data, i);
      }
    }
    return n;
  };
  const kinds = ["core:tree", "core:rock", "core:bush"].map(w.kind);
  for (const name of ["lowpoly", "medium", "high", "ultra"]) {
    w.scene.assets.tier = tierOf(name);
    // Made from nothing, a few a frame, nearest first; then a turn of the camera.
    w.scene.resetUploads();
    (far as unknown as { tiles: Map<number, unknown> }).tiles.clear();
    let frames = 0;
    const making: number[] = [];
    for (; frames === 0 || far.pending > 0; frames++) {
      const f = at(mid, mid);
      making.push(f.far);
    }
    const draws: number[] = [];
    const sent: number[] = [];
    const seen: number[] = [];
    const builds: number[] = [];
    for (let k = 0; k < 36; k++) {
      const f = at(mid, mid, (k / 36) * Math.PI * 2);
      draws.push(nodeDraws(f.p).length);
      sent.push(triangles(f.p));
      if (k % 6 === 0) seen.push(inView(f.p));
      builds.push(f.far);
    }
    const reach = kinds.map((k) => far.reachOf(k).toFixed(0)).join(", ");
    record(`${name}: reach of trees, rocks, bushes`, far.reachOf(kinds[0]!), `m (${reach} m)`);
    record(`${name}: frames until every tile is made, and the worst frame's ms of it`, frames, `frames, ${Math.max(...making).toFixed(2)} ms`);
    record(`${name}: far node draws a frame, mean and most`, mean(draws), `(${Math.max(...draws)})`);
    record(`${name}: far node triangles sent a frame, mean and most`, mean(sent), `(${Math.max(...sent)})`);
    record(`${name}: of them in view and in reach, as the plan's row counts, mean and most`, mean(seen), `(${Math.max(...seen)})`, { lowpoly: 39e3, medium: 315e3, high: 0.9e6, ultra: 2.0e6 }[name]);
    record(`${name}: far nodes' share of the frame build, median and worst`, median(builds), `ms, ${Math.max(...builds).toFixed(3)} ms`);
    record(`${name}: tiles held, and their bytes`, (far as unknown as { tiles: Map<number, unknown> }).tiles.size, `tiles, ${(far.bytes / 1048576).toFixed(1)} MB`);
  }
  // A tile made from nothing: one chunk's nodes changing hands remakes its tile; here every chunk of it is new.
  w.scene.assets.tier = tierOf("medium");
  const t = performance.now();
  (far as unknown as { tiles: Map<number, unknown> }).tiles.clear();
  far.makes = Infinity;
  at(mid, mid);
  const all = (far as unknown as { tiles: Map<number, unknown> }).tiles.size;
  record("medium: a tile made from nothing, mean of every tile in reach", (performance.now() - t) / all, `ms (${all} tiles)`);
  far.makes = makes;
  // A walk at 6 m a frame across 2 km, the near field following, once to warm and once measured: the frames that cross
  // a chunk border, where the tiles the near field touched are made again in that frame. The test card keeps no copies.
  w.holdCard = false;
  for (const name of ["lowpoly", "medium", "ultra"]) {
    w.scene.assets.tier = tierOf(name);
    const crossing: number[] = [];
    const share: number[] = [];
    const other: number[] = [];
    for (let round = 0; round < 2; round++) {
      far.makes = Infinity;
      at(mid - 1000, mid + 20);
      far.makes = makes;
      [crossing.length, share.length, other.length] = [0, 0, 0];
      for (let x = mid - 1000; x <= mid + 1000; x += 6) {
        const f = at(x, mid + 20);
        if (Math.floor(x / 64) !== Math.floor((x - 6) / 64)) {
          crossing.push(f.ms);
          share.push(f.far);
        } else other.push(f.ms);
      }
    }
    record(`${name}: a walk, frame build crossing a chunk border, median and worst`, median(crossing), `ms, ${Math.max(...crossing).toFixed(2)} ms`);
    record(`${name}: the far nodes' share of it, worst and median`, Math.max(...share), `ms, ${median(share).toFixed(2)} ms`, 2);
    record(`${name}: a walk, frame build not crossing, median`, median(other), "ms");
  }
}

/**
 * Far blocks on the client (D257, D258): the 8 km map of hills, with castles, piles and huts in 130 and then 480 chunks
 * within 2 km of the camera at its middle, 4 and 15% of the chunks there. The camera turns once round in 120 frames.
 */
export function benchFarBlocks(section: (title: string) => void, record: Record): void {
  section("Far blocks: base chunks within 2 km of the camera on the 8 km map, the camera turning");
  const ground = (x: number, z: number): number => 40 + 30 * Math.sin(x / 400) * Math.cos(z / 350) + 8 * Math.sin(x / 53) * Math.sin(z / 61);
  // The rasterizer is not drawn with, so it is small; the scene chooses levels for 1,080 rows.
  const w = farWorld({ chunks: 128, ground, width: 192, height: 108, pack: parsePack(buildCorePack()) });
  w.scene.viewHeight = 1080;
  const mid = 4096;
  const rng = new Rng(8);
  // Three kinds of base, each baked once in a chunk of its own: a castle, the benchmark's pile of 2,000 pieces, and ten huts with a tower.
  const at = (cx: number, cz: number): [number, number] => [cx * CHUNK_SIZE + 32, cz * CHUNK_SIZE + 32];
  const [castleAt, pileAt, hutsAt] = [at(2, 2), at(4, 2), at(6, 2)];
  castle(w, ...castleAt, w.hf.heightAt(...castleAt));
  const kinds = ["core:foundation", "core:wall", "core:wall", "core:ceiling", "core:ceiling", "core:pillar", "core:crate", "core:block"].map(w.id);
  for (let n = 0; n < 2000; n++) {
    const kind = kinds[rng.int(kinds.length)]!;
    const [x, z] = [pileAt[0] + (rng.int(15) - 7) * 3, pileAt[1] + (rng.int(15) - 7) * 3];
    w.server.add(kind, x, w.hf.heightAt(...pileAt) + rng.int(4) * 3.3 + w.server.halfYOf(kind), z, rng.int(4) * 16384, 1, 1000);
  }
  for (let hut = 0; hut < 10; hut++) {
    const [x, z] = [hutsAt[0] - 30 + rng.int(9) * 6, hutsAt[1] - 30 + rng.int(9) * 6];
    for (const [dx, dz] of [[1.5, 1.5], [4.5, 1.5], [1.5, 4.5], [4.5, 4.5]] as const) w.server.add(w.id("core:foundation_wood"), x + dx, w.hf.heightAt(x, z) + 0.19, z + dz, 0, 1, 100);
    w.server.add(w.id("core:wall_stone"), x + 1.5, w.hf.heightAt(x, z) + 1.88, z + 3, rng.int(4) * 16384, 1, 100);
  }
  for (let i = 0; i < 4; i++) w.server.add(w.id("core:pillar"), hutsAt[0], w.hf.heightAt(...hutsAt) + 3.3 + i * 6, hutsAt[1], 0, 9, 100);
  const bases = [castleAt, pileAt, hutsAt].map(([x, z]) => {
    const s = new Summary();
    const chunk = chunkAt(w.dims, x, z);
    bakeChunk(w.server.chunks[chunk]!, chunkCx(w.dims, chunk) * CHUNK_SIZE, chunkCz(w.dims, chunk) * CHUNK_SIZE, pieceShapes(w.reg), w.hf, s);
    return s.far;
  });
  // Chunks within 2 km of the middle, in a random order: the first 130, then 350 more.
  const spots: number[] = [];
  for (let cz = 0; cz < 128; cz++) for (let cx = 0; cx < 128; cx++) if (Math.hypot(...at(cx, cz).map((v) => v - mid)) <= 2000) spots.push(cz * 128 + cx);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [spots[i], spots[j]] = [spots[j]!, spots[i]!];
  }
  const reach = w.scene.assets.tier.reach;
  const tile = (p: FramePacket): number => p.assetUploads.filter((u) => u.slot >= FAR_SLOTS).length;
  // The scene's far blocks are timed where they run: what they add to a frame is too small to see as a difference.
  const hook = w.scene as unknown as { farBlocks: (cam: unknown) => void };
  const inner = hook.farBlocks;
  let spent = 0;
  hook.farBlocks = function (this: unknown, cam: unknown): void {
    const t = performance.now();
    inner.call(this, cam);
    spent += performance.now() - t;
  };
  /** Frames turning the camera once round, each given its packet, its build's milliseconds and the far blocks' share of them. */
  const turn = (frames: number, each: (p: FramePacket, ms: number, far: number) => void): void => {
    for (let f = 0; f < frames; f++) {
      [w.cam.x, w.cam.z, w.cam.yaw, w.cam.pitch] = [mid, mid, (f / frames) * Math.PI * 2, -0.02];
      w.cam.y = w.hf.heightAt(mid, mid) + 30;
      w.scene.now += 1000 / 60;
      spent = 0;
      const t = performance.now();
      const p = w.scene.build(w.cam, null);
      each(p, performance.now() - t, spent);
    }
  };
  const setReach = (bases: number): void => void (w.scene.assets.tier = { ...w.scene.assets.tier, reach: { ...reach, bases } });
  let sent = 0;
  for (const n of [130, 480]) {
    for (; sent < n; sent++) w.sendCells(spots[sent]!, bases[sent % 3]!);
    setReach(0);
    turn(60, () => {});
    const off: number[] = [];
    const offTris: number[] = [];
    turn(120, (p, ms) => (off.push(ms), offTris.push(p.triangles)));
    setReach(reach.bases);
    // The tiles within 512 m are made in the first frame, and the rest a few a frame, nearest first.
    const making: number[] = [];
    while (making.length < 1000) {
      let made = 0;
      turn(1, (p, _, far) => ((made = tile(p)), made > 0 && making.push(far)));
      if (made === 0) break;
    }
    turn(60, () => {});
    const on: number[] = [];
    const far: number[] = [];
    const draws: number[] = [];
    const tris: number[] = [];
    turn(120, (p, ms, share) => {
      on.push(ms);
      far.push(share);
      draws.push(p.drawFade.subarray(0, p.drawCount).filter((f) => f > 0).length);
      tris.push(p.triangles - offTris[tris.length]!);
    });
    record(`${n} base chunks: frames until every tile is made`, making.length, `frames, the first ${making[0]!.toFixed(2)} ms of blocks, the worst ${Math.max(...making).toFixed(2)}`);
    record(`${n} base chunks: frame build, blocks off, median`, median(off), "ms");
    record(`${n} base chunks: frame build, blocks on, median`, median(on), "ms");
    record(`${n} base chunks: the blocks' share of it, median and worst`, median(far), `ms, ${Math.max(...far).toFixed(3)} ms`);
    record(`${n} base chunks: far draws a frame, mean and most`, mean(draws), `(${Math.max(...draws)})`);
    record(`${n} base chunks: far triangles a frame, mean`, mean(tris), "");
  }
  // A tile remade: one chunk's cells change, so its part is made again and its tile put together and sent.
  const remade: number[] = [];
  const steady: number[] = [];
  for (let k = 0; k < 40; k++) {
    w.sendCells(spots[k]!, bases[(k + 1) % 3]!);
    turn(1, (p, ms) => tile(p) === 1 && remade.push(ms));
    turn(1, (_, ms) => steady.push(ms));
  }
  record("a frame that remakes a tile, less a frame that does not, median", median(remade) - median(steady), "ms");
  for (const [name, cells] of [["castle", bases[0]!], ["pile", bases[1]!], ["huts", bases[2]!]] as const) {
    for (let i = 0; i < 50; i++) farPart(cells, 0, 0, 0, 0, w.hf);
    const t = performance.now();
    let faces = 0;
    for (let i = 0; i < 500; i++) faces = farPart(cells, 0, 0, 0, 0, w.hf).faces;
    record(`blocks of one chunk, the ${name}: triangles, and ms to make`, faces * 2, `triangles, ${((performance.now() - t) / 500).toFixed(3)} ms`);
  }
  // Each tier, at 480 base chunks.
  for (const name of ["lowpoly", "medium", "high", "ultra"]) {
    w.scene.assets.tier = tierOf(name);
    const draws: number[] = [];
    const before = w.scene.assets.residency.reserved;
    let made = 0;
    turn(60, (p) => {
      draws.push(p.drawFade.subarray(0, p.drawCount).filter((f) => f > 0).length);
      made += tile(p);
    });
    record(`${name}: far draws a frame, mean and most`, mean(draws), `(${Math.max(...draws)}), ${made} tiles made, reserve ${((w.scene.assets.residency.reserved - before) / 1024).toFixed(0)} KB more`);
  }
}

export interface FarJoin {
  /** Milliseconds there and back, the share of segments lost, and the line's bytes a second (0 for no limit). */
  rtt: number;
  loss: number;
  bytesPerSecond?: number;
  /** Base chunks within reach of where the survivors join, pieces in the base about them, and creatures walking there. */
  bases: number;
  near: number;
  herd: number;
  seconds: number;
  /** Of the links' losses. */
  seed?: number;
}

export interface FarJoined {
  /** Milliseconds from joining until the near chunks were all held, and the share of frames others stood still: with the feed, then without. */
  nearMs: [number, number];
  frozen: [number, number];
  /** Base chunks the session with the feed held at the end, and the bytes of them it was sent. */
  held: number;
  farBytes: number;
}

const JOIN_DIMS = { chunksX: 64, chunksZ: 8 };
const JOIN_AT = { x: 2080, z: 288 };
let joinMap: Uint8Array<ArrayBuffer> | null = null;

/**
 * A survivor joins beside a base of `near` pieces with `bases` base chunks beyond it in reach, twice on servers and links
 * alike, losses and all: once asking for far cells and once asking for none. The map is flat, 4 km by 512 m.
 */
export function farJoin(o: FarJoin): FarJoined {
  const on = joinOnce(o, FAR_RADIUS);
  const off = joinOnce(o, 0);
  return { nearMs: [on.nearMs, off.nearMs], frozen: [on.frozen, off.frozen], held: on.held, farBytes: on.farBytes };
}

function joinOnce(o: FarJoin, reach: number): { nearMs: number; frozen: number; held: number; farBytes: number } {
  const samples = ((JOIN_DIMS.chunksX * CHUNK_SIZE) / TERRAIN_CELL + 1) * ((JOIN_DIMS.chunksZ * CHUNK_SIZE) / TERRAIN_CELL + 1);
  joinMap ??= writeMap({ id: "bench:join", dims: JOIN_DIMS, minY: -32, stepY: 1 / 256, seaLevel: -Infinity, heights: new Uint16Array(samples).fill(32 * 256), tint: new Uint8Array(samples).fill(1), statics: [], nodes: [], spawns: [{ name: "Middle", ...JOIN_AT, yaw: 0 }] });
  const h = new Harness({}, o.seed ?? 3, 60, { map: joinMap });
  const { world, reg } = h;
  const k = (id: string): number => reg.index.get(`core:${id}`)!;
  const rng = new Rng(17);
  const home = chunkAt(JOIN_DIMS, JOIN_AT.x, JOIN_AT.z);
  const [hx, hz] = [chunkCx(JOIN_DIMS, home), chunkCz(JOIN_DIMS, home)];
  const spots: number[] = [];
  for (let chunk = 0; chunk < JOIN_DIMS.chunksX * JOIN_DIMS.chunksZ; chunk++) {
    const [cx, cz] = [chunkCx(JOIN_DIMS, chunk), chunkCz(JOIN_DIMS, chunk)];
    if (Math.abs(cx - hx) <= 3 && Math.abs(cz - hz) <= 3) continue;
    if (((cx + 0.5) * CHUNK_SIZE - JOIN_AT.x) ** 2 + ((cz + 0.5) * CHUNK_SIZE - JOIN_AT.z) ** 2 > 2000 ** 2) continue;
    spots.push(chunk);
  }
  for (let i = spots.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [spots[i], spots[j]] = [spots[j]!, spots[i]!];
  }
  // Each base chunk holds huts of four foundations and a wall, and a tower: about 150 bytes of cells.
  for (const chunk of spots.slice(0, o.bases)) {
    const [x0, z0] = [chunkCx(JOIN_DIMS, chunk) * CHUNK_SIZE, chunkCz(JOIN_DIMS, chunk) * CHUNK_SIZE];
    for (let hut = 0; hut < 10; hut++) {
      const [x, z] = [x0 + 2 + rng.int(9) * 6, z0 + 2 + rng.int(9) * 6];
      for (const [dx, dz] of [[1.5, 1.5], [4.5, 1.5], [1.5, 4.5], [4.5, 4.5]] as const) world.structs.add(k("foundation_wood"), x + dx, 0.19, z + dz, 0, 1 + hut, 100);
      world.structs.add(k("wall_stone"), x + 1.5, 1.88, z + 3, rng.int(4) * 16384, 1 + hut, 100);
    }
    for (let i = 0, n = 1 + rng.int(6); i < n; i++) world.structs.add(k("pillar"), x0 + 32, 3.3 + i * 6, z0 + 32, 0, 9, 100);
  }
  const kinds = ["foundation_wood", "wall_stone", "ceiling_wood", "pillar_metal"].map(k);
  for (let n = 0; n < o.near; n++) world.structs.add(kinds[rng.int(kinds.length)]!, JOIN_AT.x + (rng.int(41) - 20) * 3, rng.int(4) * 3.3 + 0.2, JOIN_AT.z + (rng.int(41) - 20) * 3, rng.int(4) * 16384, 1, 1000);
  let expected = 0;
  world.structs.chunks.forEach((t, chunk) => {
    if (t && Math.abs(chunkCx(JOIN_DIMS, chunk) - hx) <= 3 && Math.abs(chunkCz(JOIN_DIMS, chunk) - hz) <= 3) expected += t.live;
  });

  for (let n = 0; n < o.herd; ) if (h.host.spawnCreature("core:grazer", JOIN_AT.x + rng.range(-40, 40), JOIN_AT.z + rng.range(-40, 40), 1 + rng.int(30)) >= 0) n++;
  // Asking for none is a command of the same size, so the two streams differ only by the far cells.
  const s = h.join("ada", { tcp: true, latencyMs: o.rtt / 2, loss: o.loss, bytesPerSecond: o.bytesPerSecond ?? 0 });
  const from = h.now;
  let nearMs = -1;
  let frames = 0;
  let frozen = 0;
  h.run(o.seconds * 1000, (now) => {
    s.askFar(reach);
    if (nearMs < 0 && s.world && s.world.structs.count >= expected) nearMs = now - from;
    // From its first second of snapshots, a frame where the newest has been drawn past shows others standing still.
    if (s.latestSnapshot === 0 || now - from < 1000) return;
    frames++;
    if (s.renderClock - s.remoteDelay >= s.latestSnapshot) frozen++;
  });
  return { nearMs, frozen: (100 * frozen) / Math.max(1, frames), held: s.far.chunks.size, farBytes: h.host.tactical.stats.farBytes };
}

/** Joins on D225's link model, with the feed and without, each lossy line over five seeds. */
function benchFarJoins(section: (title: string) => void, record: Record): void {
  section("The far feed on joining: 400 base chunks in reach and a 4,000-piece base beside, asking for 2 km and for none");
  for (const [rtt, loss, rate] of [[50, 0, 0], [100, 0, 0], [180, 0, 0], [100, 0.01, 0], [180, 0.02, 0], [100, 0, 60000]] as const) {
    const runs = Array.from({ length: loss > 0 ? 5 : 1 }, (_, seed) => farJoin({ rtt, loss, bytesPerSecond: rate, bases: 400, near: 4000, herd: 100, seconds: 12, seed: seed + 1 }));
    const name = (what: string): string => `${rtt} ms, ${loss * 100}%${rate ? `, ${rate / 1000} KB/s` : ""}: ${what}`;
    record(name("near chunks held, with the feed"), mean(runs.map((r) => r.nearMs[0])), "ms");
    record(name("near chunks held, without"), mean(runs.map((r) => r.nearMs[1])), "ms");
    record(name("the feed's delay to them, the worst"), Math.max(...runs.map((r) => (100 * (r.nearMs[0] - r.nearMs[1])) / r.nearMs[1])), "%", 5);
    record(name("time others stand still, with the feed"), mean(runs.map((r) => r.frozen[0])), "%");
    record(name("time others stand still, without"), mean(runs.map((r) => r.frozen[1])), "%");
    record(name("base chunks held after 12 s"), Math.min(...runs.map((r) => r.held)), "");
    record(name("far bytes sent"), mean(runs.map((r) => r.farBytes)) / 1024, "KB");
  }
}

/** A client that only says hello, sends inputs and acknowledges snapshots. */
class Bot {
  readonly end: LoopbackEnd;
  private readonly inputs = new InputBuffer(64);
  private readonly w = new BitWriter(256);
  private readonly r = new BitReader();
  private serverTick = 0;
  private sent = 0;

  constructor(net: LoopbackNet, name: string, contentHash: number, seed: number) {
    this.end = net.connect();
    this.end.onMessage = (_ch, data) => {
      if (data[0] !== S_SNAPSHOT) return;
      this.r.reset(data);
      this.r.u8();
      this.serverTick = Math.max(this.serverTick, this.r.u32());
    };
    writeHello(this.w, PROTOCOL_VERSION, contentHash, 0, name, 0, new Uint8Array(KEY_BYTES).fill(seed & 255), defaultLook());
    this.end.send(CH_RELIABLE, this.w.bytes());
  }

  update(worldTick: number): void {
    const target = (this.serverTick || worldTick) + 3;
    if (target <= this.sent) return;
    let count = 0;
    for (let t = Math.max(this.sent + 1, target - 3); t <= target; t++, count++) this.inputs.set(t, 0, 0, 0, 0, 0);
    this.sent = target;
    this.w.reset();
    writeInputs(this.w, this.inputs, this.serverTick, target, count);
    this.end.send(CH_UNRELIABLE, this.w.bytes());
  }
}

/** A row as tools/bench.ts prints it, for running this file alone. */
const printed: Record = (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`);

// With --blocks or --nodes, the far blocks' or the far nodes' rows alone, which need no server.
if (import.meta.main && process.argv.includes("--blocks")) benchFarBlocks((title) => console.log(`\n${title}`), printed);
else if (import.meta.main && process.argv.includes("--nodes")) benchFarNodes((title) => console.log(`\n${title}`), printed);
else if (import.meta.main) {
  // The benchmark's map: 8 km of hills with 250 bases of 2,000 pieces, 40 survivors at one and 60 in pairs at 30 others.
  const reg = contentFor(compileContent(CORE_CONTENT).registry!, new Rules());
  const dims = { chunksX: 128, chunksZ: 128 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 64);
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const [x, z] = [i * hf.cell, j * hf.cell];
      hf.heights[j * hf.nx + i] = Math.round((40 + 30 * Math.sin(x / 400) * Math.cos(z / 350) + 8 * Math.sin(x / 53) * Math.sin(z / 61) + 32) * 64);
    }
  }
  const world = createWorld(reg, dims, hf, "bench:8km", hashBytes(new Uint8Array(hf.heights.buffer, 0, 4096)), { x: 4096, z: 4096, yaw: 0 }, 65536);
  const rng = new Rng(2026);
  const kinds = ["core:foundation", "core:wall", "core:wall", "core:ceiling", "core:ceiling", "core:pillar", "core:crate", "core:block"].map((id) => reg.index.get(id)!);
  const centers: [number, number][] = [];
  for (let b = 0; b < 250; b++) {
    const [cx, cz] = [Math.round(rng.range(400, 7790) / 3) * 3, Math.round(rng.range(400, 7790) / 3) * 3];
    centers.push([cx, cz]);
    const y0 = hf.heightAt(cx, cz);
    // Drawn in the order tools/bench.ts draws them, so the bases are the same.
    for (let n = 0; n < 2000; n++) {
      const kind = kinds[rng.int(kinds.length)]!;
      const x = cx + (rng.int(15) - 7) * 3;
      const z = cz + (rng.int(15) - 7) * 3;
      world.structs.add(kind, x, y0 + rng.int(4) * 3.3 + world.structs.halfYOf(kind), z, rng.int(4) * 16384, 1 + b, 1000);
    }
  }
  const host = createHost(reg, { world, game: { maxClients: 128 } });
  const net = new LoopbackNet(7);
  host.game.listen(net);
  const places = new Map<string, { x: number; y: number; z: number; yaw: number }>();
  for (let i = 0; i < 100; i++) {
    const [bx, bz] = centers[i < 40 ? 0 : 1 + Math.floor((i - 40) / 2)]!;
    const spread = i < 40 ? 20 : 6;
    const [x, z] = [bx + 26 + rng.range(0, spread), bz + rng.range(-spread, spread)];
    places.set(`bot${i}`, { x, y: hf.heightAt(x, z), z, yaw: 0 });
  }
  host.game.savedPosition = (name) => places.get(name) ?? null;
  const bots = Array.from({ length: 100 }, (_, i) => new Bot(net, `bot${i}`, reg.baseHash, i + 1));
  let now = 0;
  const run: Run = (ticks, times) => {
    for (let i = 0; i < ticks; i++) {
      now += 1000 / TICK_RATE;
      net.advance(now);
      const t = performance.now();
      host.game.tick();
      times?.push(performance.now() - t);
      for (const b of bots) b.update(host.world.tick);
    }
  };
  run(300, null);
  const misses: string[] = [];
  const record: Record = (name, value, unit, budget = null) => {
    const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
    if (verdict.includes("MISS")) misses.push(name);
    console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${verdict}`);
  };
  const section = (title: string): void => console.log(`\n${title}`);
  benchFar(host, run, section, record);
  if (misses.length > 0) process.exit(1);
}
