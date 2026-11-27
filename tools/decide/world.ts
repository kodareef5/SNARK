// The lab's world: a server's host with no client and no clock. Without a clock the lane never gives way, so a run does
// not hang on how busy the machine is, and the same seed gives the same world. Every chunk is held awake with its trees
// and rocks, as if a player stood in each.
//
// `bun tools/decide/world.ts --cost` prints what the lab's plan rests on: what a host and a tick cost, that two runs of a
// seed end the same, that the Miami slice loads, that trees are there with no player, and what a ring of rays costs.

import { createHost, type Host } from "../../server/host.ts";
import type { ServerWorld } from "../../server/world.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { hashBytes } from "../../shared/hash.ts";
import { Rng } from "../../shared/rng.ts";
import { writeMap, type MapData } from "../../shared/world/mapfile.ts";
import { HIT_NODE, HIT_STRUCTURE, HIT_TERRAIN, castWorld } from "../../shared/world/ray.ts";
import { miamiSlice } from "../../tests/fixtures/cityslice.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { plainRules } from "../../tests/fixtures/net.ts";
import { corePack } from "../../tests/fixtures/pack.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";

export interface Lab {
  host: Host;
  world: ServerWorld;
  tick(): void;
}

/** A world of `map` seeded by `seed`, all of it awake. */
export function lab(map: MapData, seed = 1): Lab {
  const pack = corePack();
  const host = createHost(coreRegistry(), { map: writeMap(map), seed, dev: true, wild: false, config: plainRules(), clips: pack.clips, rigs: pack.header.rigs });
  for (let chunk = 0; chunk < map.dims.chunksX * map.dims.chunksZ; chunk++) {
    host.creatures.watch(chunk, 1);
    host.harvest?.retain(chunk, 0, 1);
  }
  return { host, world: host.world, tick: () => host.game.tick() };
}

/** One number for where every body is and which way it faces: two runs that end the same have the same. */
export function stateHash(world: ServerWorld): number {
  const e = world.ents;
  let h = hashBytes(new Uint8Array(e.x.buffer, e.x.byteOffset, e.x.byteLength));
  for (const column of [e.y, e.z, e.yaw, e.flags, e.gen]) h = hashBytes(new Uint8Array(column.buffer, column.byteOffset, column.byteLength), h);
  return h;
}

/** A wood on flat ground, `chunks` on a side. */
export function wood(chunks = 4, perChunk = 96): MapData {
  return flatMap(chunks, { nodes: [{ seed: 5, perChunk, kinds: [["core:rock", 1], ["core:tree", 1], ["core:banyan", 1]], allowCell: 0, allow: null }] });
}

const ms = (from: number): number => Math.round((performance.now() - from) * 100) / 100;
const median = (times: number[]): number => [...times].sort((a, b) => a - b)[times.length >> 1]!;

/** A herd wandering in a wood for `ticks`, and where it ends. */
function run(seed: number, ticks: number): { hash: number; setup: number; tick: number } {
  const from = performance.now();
  const w = lab(wood(), seed);
  const rng = new Rng(seed);
  for (let n = 0; n < 40; ) if (w.host.spawnCreature(n % 4 === 0 ? "core:raptor" : "core:dodo", rng.range(40, 216), rng.range(40, 216), 1) >= 0) n++;
  const setup = ms(from);
  const times: number[] = [];
  for (let t = 0; t < ticks; t++) {
    const at = performance.now();
    w.tick();
    times.push(performance.now() - at);
  }
  return { hash: stateHash(w.world), setup, tick: median(times) };
}

/**
 * One ring of `k` headings at knee and chest height above the ground under the point, `reach` metres out: its median and
 * 99th percentile in microseconds, and the share of its rays the ground, something built, and a tree or rock stopped.
 */
function ring(w: Lab, k: number, reach: number): { micros: number; worst: number; ground: number; built: number; nodes: number } {
  const rng = new Rng(9);
  const rings = 20000, hf = w.world.hf;
  const hits = [0, 0, 0, 0];
  const times = new Float64Array(rings);
  for (let i = 0; i < rings; i++) {
    const x = rng.range(40, hf.sizeX - 40), z = rng.range(40, hf.sizeZ - 40), turn = rng.float() * Math.PI * 2;
    const ground = hf.heightAt(x, z);
    const from = performance.now();
    for (let s = 0; s < k; s++) {
      const a = turn + (s / k) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      for (const up of [0.4, 1.2]) hits[castWorld(w.world, x, ground + up, z, dx, 0, dz, reach, true)]!++;
    }
    times[i] = (performance.now() - from) * 1000;
  }
  times.sort();
  const share = (n: number): number => Math.round((n / (rings * k * 2)) * 1000) / 1000, r2 = (v: number): number => Math.round(v * 100) / 100;
  return { micros: r2(times[rings >> 1]!), worst: r2(times[Math.floor(rings * 0.99)]!), ground: share(hits[HIT_TERRAIN]!), built: share(hits[HIT_STRUCTURE]!), nodes: share(hits[HIT_NODE]!) };
}

if (import.meta.main && process.argv.includes("--cost")) {
  const a = run(7, 20 * TICK_RATE), b = run(7, 20 * TICK_RATE), c = run(8, 20 * TICK_RATE);
  console.log(`a host of a 4 by 4 chunk wood with 40 creatures: ${a.setup} ms, then ${b.setup} ms once warm`);
  console.log(`a tick of it, median: ${Math.round(a.tick * 1000)} µs`);
  console.log(`two runs of one seed end the same: ${a.hash === b.hash} (and another seed differs: ${a.hash !== c.hash})`);
  const w = lab(wood(), 1);
  const said = (r: ReturnType<typeof ring>): string => `${r.micros} µs, 99th percentile ${r.worst} (stopped by the ground ${r.ground}, by something built ${r.built}, by a tree or rock ${r.nodes})`;
  for (const k of [8, 12, 16]) console.log(`a ring of ${k} headings, two rays each to 6 m in the wood, with no player: ${said(ring(w, k, 6))}`);
  const from = performance.now();
  const city = lab(miamiSlice().map, 1);
  console.log(`the Miami slice as a lab world: ${ms(from)} ms, ${Math.round(process.memoryUsage().rss / 1048576)} MB resident in all`);
  for (const k of [8, 12, 16]) console.log(`a ring of ${k} headings there: ${said(ring(city, k, 6))}`);
}
