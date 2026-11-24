// A collapse on the server at its pace (server/build.ts): how many pieces a removal takes and how often, a claim that
// follows it over many ticks, a fall across chunk borders as a watcher is told it, and a save taken midway.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { FOUNDATION_THICK } from "../../content/building.ts";
import { FALL_FIRST, FALL_MOST, WAVE_TICKS, fallMost } from "../../server/build.ts";
import { CHUNK_SIZE, chunkAt } from "../../shared/coords.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { GONE_FELL, GONE_KEPT } from "../../shared/world/structures.ts";
import { STRUCT_DEMOLISH } from "../../shared/world/upkeep.ts";
import { flatGround } from "../fixtures/arena.ts";
import { builder } from "../fixtures/build.ts";
import { Harness } from "../fixtures/net.ts";
import { NORTH, OVER_FRONT, join as joinTo, start } from "../fixtures/slots.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const OWNER = 9;

/** A wood house `n` foundations square and `storeys` high with its corner at (x, z). Returns its foundations. */
function house(h: Harness, x: number, z: number, n: number, storeys: number): number[] {
  const add = (piece: string, target: number, k: number): number => {
    const ref = joinTo(h.world, target, id(`${piece}_wood`), k, 0, 10000);
    expect(ref).toBeGreaterThanOrEqual(0);
    return ref;
  };
  const ground: number[][] = [];
  for (let i = 0; i < n; i++) {
    ground.push([]);
    for (let j = 0; j < n; j++) ground[i]!.push(i === 0 && j === 0 ? start(h.world, id("foundation_wood"), x, h.world.hf.heightAt(x, z) + FOUNDATION_THICK / 2, z, 0, OWNER, 15000) : j === 0 ? add("foundation", ground[i - 1]![0]!, 1) : add("foundation", ground[i]![j - 1]!, 0));
  }
  let tiles = ground;
  for (let storey = 0; storey < storeys; storey++) {
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
  return ground.flat();
}

/** How many pieces of the house stand in `structs`. */
function standing(structs: Harness["world"]["structs"]): number {
  let n = 0;
  for (const t of structs.chunks) for (let k = 0; t && k < t.high; k++) if (t.kind[k] !== 0 && t.owner[k] === OWNER) n++;
  return n;
}

/** Ticks the server until its collapse is over. Returns the size of each removal and the tick it was made on. */
function fall(h: Harness): { sizes: number[]; at: number[] } {
  const structs = h.world.structs;
  const [sizes, at]: [number[], number[]] = [[], []];
  for (let k = 0; h.host.build.collapse.busy && k < 2000; k++) {
    const had = structs.count;
    h.server.tick();
    if (structs.count === had) continue;
    sizes.push(had - structs.count);
    at.push(h.world.tick);
  }
  expect(h.host.build.collapse.busy).toBe(false);
  return { sizes, at };
}

test("a house falls as a front: a removal every other tick, each larger than the last, none over the most", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const g = flatGround(h, 40, 40);
  const structs = h.world.structs;
  // A hut of 128 pieces goes in three removals over five ticks.
  let ground = house(h, g.x + 4, g.z + 4, 4, 2);
  expect(standing(structs)).toBe(128);
  for (const ref of ground) structs.damage(ref, 1e9, h.world.tick);
  const hut = fall(h);
  expect([hut.sizes, hut.at.map((t) => t - hut.at[0]!), standing(structs)]).toEqual([[32, 52, 28], [0, WAVE_TICKS, 2 * WAVE_TICKS], 0]);
  // One of 600 pieces: each removal takes what the pace allows until the last, which takes what is left.
  ground = house(h, g.x + 4, g.z + 4, 9, 2);
  expect(standing(structs)).toBe(81 + 2 * (81 * 3 + 18));
  for (const ref of ground) structs.damage(ref, 1e9, h.world.tick);
  const big = fall(h);
  expect(big.sizes.reduce((a, b) => a + b, 0)).toBe(2 * (81 * 3 + 18));
  expect(big.sizes.slice(0, -1)).toEqual(big.sizes.slice(0, -1).map((_, k) => fallMost(k)));
  expect(big.sizes[big.sizes.length - 1]!).toBeLessThanOrEqual(fallMost(big.sizes.length - 1));
  expect(big.at.every((t, k) => k === 0 || t - big.at[k - 1]! === WAVE_TICKS)).toBe(true);
  expect([big.sizes.length, big.at[big.at.length - 1]! - big.at[0]! + 1, standing(structs)]).toEqual([7, 13, 0]);
  // The pace starts at the first removal's allowance, gains with each, and stops at the most.
  expect([fallMost(0), fallMost(1) > fallMost(0), fallMost(1000)]).toEqual([FALL_FIRST, true, FALL_MOST]);
});

test("a demolished wall's claim follows the fall over many ticks: the tribe's pieces come back, another's fall", () => {
  const made = builder(["ada", "bob"]);
  const { h, sessions, at, structs, act, has } = made;
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  const team = (s: ClientSession): number => h.host.records.byPid.get(h.client(s)!.pid)!.team;
  const hp = (piece: string): number => reg.maxHp[id(`${piece}_wood`)]!;
  // A foundation, forty-one walls one on another on its north edge, a floor off the top wall, and on it a box of bob's.
  const f = start(h.world, id("foundation_wood"), at.x, at.y + FOUNDATION_THICK / 2, at.z + 3, 0, team(ada), hp("foundation"));
  const walls = [joinTo(h.world, f, id("wall_wood"), NORTH, 0, hp("wall"))];
  for (let k = 0; k < 40; k++) walls.push(joinTo(h.world, walls[k]!, id("wall_wood"), 0, 0, hp("wall")));
  const floor = joinTo(h.world, walls[40]!, id("ceiling_wood"), OVER_FRONT, 0, hp("ceiling"));
  expect([...walls, floor].every((ref) => ref >= 0)).toBe(true);
  const t = structs.chunks[Math.floor(floor / 65536)]!;
  const box = structs.add(id("storage_box"), t.x[floor & 0xffff]!, t.y[floor & 0xffff]! + reg.halfY[id("ceiling_wood")]! + reg.halfY[id("storage_box")]!, t.z[floor & 0xffff]!, 0, team(bob), 500);
  h.run(300);
  expect([walls[40]!, floor, box].map((ref) => h.host.build.support.standsRef(ref))).toEqual([true, true, true]);
  const build = h.host.build;
  const before = { waves: build.collapse.waves, returned: build.returned, fallen: build.fallen, claimed: build.collapse.claimed, rubble: bob.rubble.length };
  const wood = (): number => has(ada, "wood") + [...h.host.records.byPid.values()].filter((r) => r.name === "building materials").reduce((n, r) => n + h.host.items.inv(r).total(id("wood")), 0);
  const had = wood();
  expect(act(ada, walls[0]!, STRUCT_DEMOLISH)).toBe(RESULT_OK);
  h.run(1500);
  // Forty walls and the floor are hers and come back as half their materials, over more removals than one. Bob's box falls.
  expect(build.collapse.busy).toBe(false);
  expect(build.collapse.waves - before.waves).toBeGreaterThanOrEqual(3);
  expect([build.returned - before.returned, build.collapse.claimed - before.claimed, build.fallen - before.fallen]).toEqual([41, 41, 1]);
  expect(wood() - had).toBe(41 * 20 + 30);
  const there = (ref: number): boolean => structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff] !== 0;
  expect([there(f), there(walls[1]!), there(walls[40]!), there(floor), there(box)]).toEqual([true, false, false, false, false]);
  // Only what fell is told as falling.
  expect(bob.rubble.slice(before.rubble).filter((r) => r.cause === GONE_FELL).map((r) => r.kind)).toEqual([id("storage_box")]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a fall across chunk borders reaches a watcher as removals: every piece once, from where it began", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const bob = h.join("bob");
  h.run(600);
  h.say(bob, "enablecheats");
  const g = flatGround(h, 80, 80);
  // The house's middle is the corner of four chunks.
  const corner = [Math.ceil((g.x + 10) / CHUNK_SIZE) * CHUNK_SIZE, Math.ceil((g.z + 10) / CHUNK_SIZE) * CHUNK_SIZE] as const;
  expect([corner[0] + 10 <= g.x + 80, corner[1] + 10 <= g.z + 80]).toEqual([true, true]);
  h.say(bob, `tp ${(corner[0] - 16).toFixed(3)} ${corner[1].toFixed(3)}`);
  const structs = h.world.structs;
  const ground = house(h, corner[0] - 7.5, corner[1] - 7.5, 6, 3);
  const pieces = standing(structs);
  const chunks = structs.chunks.map((t, c) => (t && t.kind.subarray(0, t.high).some((k, s) => k !== 0 && t.owner[s] === OWNER) ? c : -1)).filter((c) => c >= 0);
  expect(chunks.length).toBe(4);
  expect(chunks).toContain(chunkAt(h.world.dims, corner[0] + 1, corner[1] + 1));
  h.run(1500);
  expect(standing(bob.world!.structs)).toBe(pieces);
  const first = structs.chunks[Math.floor(ground[0]! / 65536)]!;
  const began = [first.x[ground[0]! & 0xffff]!, first.y[ground[0]! & 0xffff]!, first.z[ground[0]! & 0xffff]!];
  const seen = bob.rubble.length;
  const waves = h.host.build.collapse.waves;
  const sent = h.server.stats.chunkBytes;
  const from = h.world.tick;
  for (const ref of ground) structs.damage(ref, 1e9, from);
  // No chunk forgets a removal a watcher on a good line still lacks.
  let behind = 0;
  for (let k = 0; k < 90; k++) {
    h.run(1000 / 30);
    for (const c of chunks) behind = Math.max(behind, structs.chunks[c]!.gone.filter((b) => b.version > h.client(bob)!.known[c]!).length);
  }
  expect(behind).toBeLessThan(GONE_KEPT);
  h.run(1000);
  const removals = h.host.build.collapse.waves - waves;
  expect([standing(structs), standing(bob.world!.structs), h.host.build.collapse.busy]).toEqual([0, 0, false]);
  const fell = bob.rubble.slice(seen).filter((r) => r.cause === GONE_FELL);
  expect([pieces, fell.length, new Set(fell.map((r) => `${r.kind} ${r.x} ${r.y} ${r.z}`)).size]).toEqual([396, 360, 360]);
  expect(fell.every((r) => r.ox === began[0] && r.oy === began[1] && r.oz === began[2])).toBe(true);
  // Each removal is one tick's, and a chunk it does not reach is told nothing.
  expect(new Set(fell.map((r) => r.tick)).size).toBe(removals);
  expect(removals).toBe(5);
  // A removal's header is 28 bytes a chunk, so this is the dearest way to be told: five removals over four chunks.
  expect(h.server.stats.chunkBytes - sent).toBeLessThan(pieces * 2);
  expect(bob.stats.undecodable).toBe(0);
});

test("a save taken while a house is falling loads with the fall still running, and it finishes", () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "snark-collapse-"));
  try {
    const dbPath = joinPath(dir, "world.db");
    let h = new Harness({}, 1, 60, { dev: true, dbPath });
    const g = flatGround(h, 40, 40);
    const ground = house(h, g.x + 4, g.z + 4, 9, 2);
    for (let k = 0; k < 12; k++) h.server.tick();
    for (const ref of ground) h.world.structs.damage(ref, 1e9, h.world.tick);
    while (h.host.build.collapse.made < 3) h.server.tick();
    const left = standing(h.world.structs);
    expect(h.host.build.collapse.busy).toBe(true);
    expect(left).toBeGreaterThan(300);
    expect(left).toBeLessThan(2 * (81 * 3 + 18));
    // The server stops here, with pieces in the air.
    h.host.shutdown();

    h = new Harness({}, 1, 60, { dev: true, dbPath });
    expect([standing(h.world.structs), h.host.build.collapse.busy]).toEqual([left, true]);
    const { sizes } = fall(h);
    expect([standing(h.world.structs), sizes.reduce((a, b) => a + b, 0), h.host.build.fallen]).toEqual([0, left, left]);
    expect(sizes.every((n, k) => n <= fallMost(k))).toBe(true);
    // Settled, the next save says so, and the load after it has nothing to go on with.
    for (let k = 0; k < 12; k++) h.server.tick();
    h.host.shutdown();
    h = new Harness({}, 1, 60, { dev: true, dbPath });
    expect([standing(h.world.structs), h.host.build.collapse.busy]).toEqual([0, false]);
    h.host.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
