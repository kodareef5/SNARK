// A collapse worked out as one thing: what the store remembers of what went,
// that working it out in waves leaves exactly what asking piece by piece
// would, and how a client shows the pieces go.

import { expect, test } from "bun:test";
import { FALL_GRAVITY, FRONT_MS_PER_METRE, Falling, MAX_WAIT_MS } from "../../client/core/rubble.ts";
import { MAX_FALLING } from "../../client/core/render/packet.ts";
import type { Rubble } from "../../client/core/session.ts";
import { FOUNDATION_THICK } from "../../content/building.ts";
import { STRUCT_UNITS, TICK_DT } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { Collapse } from "../../shared/world/collapse.ts";
import { ROLE_FOUNDATION, ROLE_PILLAR, obstructed, poseAt, socketsOf, makeSockets, type Pose } from "../../shared/world/snap.ts";
import { GONE_DESTROYED, GONE_FELL, GONE_KEPT, GONE_TAKEN } from "../../shared/world/structures.ts";
import { Support } from "../../shared/world/support.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;

test("what goes together is remembered as one removal a chunk, in runs of slots; one after another in the same moment likewise; and only the last few are kept", () => {
  const w = flatWorld(2);
  const block = w.kind("core:block");
  // Ten in the first chunk, three in the second.
  const a = Array.from({ length: 10 }, (_, k) => w.structs.add(block, 4 + k * 3, 0.5, 8, 0, 0, 100));
  const b = Array.from({ length: 3 }, (_, k) => w.structs.add(block, 70 + k * 3, 0.5, 8, 0, 0, 100));
  const [t0, t1] = [w.structs.chunks[0]!, w.structs.chunks[1]!];
  expect([a.map((r) => r & 0xffff), b.map((r) => r & 0xffff), Math.floor(b[0]! / 65536)]).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 1, 2], 1]);
  const told: [number, number][] = [];
  const changed: number[] = [];
  w.structs.onRemove = (ref, cause) => void told.push([ref, cause]);
  w.structs.onChunkChanged = (chunk) => void changed.push(chunk);
  const [v0, v1] = [t0.version, t1.version];
  // Out of order, with one given twice and one that was never built: five go, and each chunk changes once.
  const refs = Uint32Array.from([a[7]!, b[0]!, a[3]!, a[2]!, a[3]!, a[4]!, 5000, 0, 0]);
  expect(w.structs.removeMany(refs, 7, GONE_FELL, 10, 2, 8, 77)).toBe(5);
  expect([t0.version - v0, t1.version - v1, changed]).toEqual([1, 1, [0, 1]]);
  expect(t0.gone).toEqual([{ version: v0 + 1, cause: GONE_FELL, x: 10, y: 2, z: 8, stamp: 77, runs: [2, 3, 7, 1], count: 4 }]);
  expect(t1.gone).toEqual([{ version: v1 + 1, cause: GONE_FELL, x: 10, y: 2, z: 8, stamp: 77, runs: [0, 1], count: 1 }]);
  expect(told.map((p) => p[0]).sort((p, q) => p - q)).toEqual([a[2]!, a[3]!, a[4]!, a[7]!, b[0]!]);
  expect(told.every((p) => p[1] === GONE_FELL)).toBe(true);
  expect([w.structs.count, t0.live, t0.kind[3], t0.mod[3]]).toEqual([8, 6, 0, v0 + 1]);

  // One taken away: a removal of its own, beginning where it stood.
  expect(w.structs.remove(a[0]!)).toBe(true);
  expect(t0.gone[1]).toEqual({ version: v0 + 2, cause: GONE_TAKEN, x: 4, y: 0.5, z: 8, stamp: 0, runs: [0, 1], count: 1 });
  // Three destroyed in one moment, nothing else changing between: one removal, which began at the first of them.
  for (const k of [9, 8, 5]) expect(w.structs.damage(a[k]!, 1e9, 90)).toBe(0);
  expect(t0.gone.length).toBe(3);
  expect(t0.gone[2]).toEqual({ version: v0 + 5, cause: GONE_DESTROYED, x: 31, y: 0.5, z: 8, stamp: 90, runs: [9, 1, 8, 1, 5, 1], count: 3 });
  // Harm that does not destroy is a change between: what is destroyed next in that moment is another removal. So is one at another moment.
  expect(w.structs.damage(a[1]!, 10, 90)).toBe(90);
  w.structs.damage(a[6]!, 1e9, 90);
  w.structs.damage(a[1]!, 1e9, 91);
  expect(t0.gone.slice(3).map((g) => [g.runs, g.stamp])).toEqual([
    [[6, 1], 90],
    [[1, 1], 91],
  ]);
  expect(t0.live).toBe(0);
  expect(t0.goneFloor).toBe(0);

  // The last eight are kept; the newest forgotten says how far back the memory goes.
  const more = Array.from({ length: 12 }, (_, k) => w.structs.add(block, 4 + k * 3, 0.5, 20, 0, 0, 100));
  const before = t0.gone.length;
  for (const ref of more) w.structs.remove(ref, GONE_TAKEN, 200 + (ref & 0xffff));
  expect(t0.gone.length).toBe(GONE_KEPT);
  expect(before + 12 - GONE_KEPT).toBe(9);
  expect(t0.goneFloor).toBe(t0.gone[0]!.version - 1);
  expect(t0.gone[GONE_KEPT - 1]!.version).toBe(t0.version);
});

/** Every piece of `w`, as kinds by chunk and slot. */
function rows(w: TestWorld): number[][] {
  return w.structs.chunks.map((t) => (t ? Array.from(t.kind.subarray(0, t.high)) : []));
}

/**
 * Build at random, as a builder may: pieces joined to pieces, each only where
 * it would stand and nothing is in its way. It straddles the corner where four
 * chunks meet.
 */
function ramble(w: TestWorld, rng: Rng, tries: number): number[] {
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  const kinds = ["foundation", "wall", "wall", "wall", "wall", "doorframe", "ceiling", "ceiling", "ceiling", "ceiling", "pillar", "stairs", "door"].map((p) => w.kind(`core:${p}_wood`));
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const sockets = makeSockets();
  const built = [w.structs.add(kinds[0]!, 62.5, FOUNDATION_THICK / 2, 62.5, rng.int(65536), 3, 100)];
  for (let i = 0; i < tries; i++) {
    const target = built[rng.int(built.length)]!;
    const kind = kinds[rng.int(kinds.length)]!;
    const n = socketsOf(w.structs, w.reg, target, kind, sockets);
    if (n === 0 || !poseAt(w.structs, w.reg, target, kind, rng.int(n), rng.int(4), pose)) continue;
    if (obstructed(w.structs, w.reg.parts, kind, pose.x / U, pose.y / U, pose.z / U, pose.yaw)) continue;
    if (!support.stands(kind, pose.x, pose.y, pose.z, pose.yaw)) continue;
    built.push(w.structs.add(kind, pose.x / U, pose.y / U, pose.z / U, pose.yaw, 3, 100));
  }
  return built;
}

/** Destroy `victims` and work the collapse out with `budget` a call. Says how many calls it took, the most work one did, and what fell. */
function bringDown(w: TestWorld, victims: number[], budget: number): { calls: number; worst: number; fell: number; waves: number } {
  const collapse = new Collapse(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  let fell = 0;
  w.structs.onRemove = (ref, cause) => {
    if (cause !== GONE_FELL) collapse.gone(ref);
    else fell++;
  };
  // Where the collapse begins: where the first of them stood.
  const ft = w.structs.chunks[Math.floor(victims[0]! / 65536)]!;
  const began = [ft.x[victims[0]! & 0xffff]!, ft.y[victims[0]! & 0xffff]!, ft.z[victims[0]! & 0xffff]!];
  for (const ref of victims) w.structs.damage(ref, 1e9, 40);
  expect(collapse.busy).toBe(true);
  let calls = 0;
  let tick = 41;
  let worst = 0;
  for (; collapse.busy && calls < 100000; calls++) {
    collapse.step(budget, tick++);
    if (collapse.spent > worst) worst = collapse.spent;
  }
  expect(collapse.busy).toBe(false);
  expect([collapse.pending, collapse.settled, collapse.fallen]).toEqual([0, 1, fell]);
  // What fell is remembered as falling from where the first piece went, at the tick it fell.
  for (const t of w.structs.chunks) {
    for (const g of t?.gone ?? []) {
      if (g.cause !== GONE_FELL) continue;
      expect(g.stamp).toBeGreaterThan(40);
      expect([g.x, g.y, g.z]).toEqual(began);
    }
  }
  w.structs.onRemove = null;
  return { calls, worst, fell, waves: collapse.waves };
}

/** Piece by piece: take away `victims`, then whatever does not stand, again and again until everything left does. */
function askEach(w: TestWorld, victims: number[]): void {
  const ask = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  for (const ref of victims) w.structs.remove(ref);
  for (let changed = true; changed; ) {
    changed = false;
    w.structs.chunks.forEach((t, chunk) => {
      for (let slot = 0; t && slot < t.high; slot++) {
        if (t.kind[slot] === 0 || ask.standsRef(chunk * 65536 + slot)) continue;
        w.structs.remove(chunk * 65536 + slot);
        changed = true;
      }
    });
  }
}

test("worked out in waves, a collapse leaves exactly what asking piece by piece until nothing changes would, whatever its allowance; a small allowance takes more calls and never a longer one", () => {
  let fellInAll = 0;
  let mostWaves = 0;
  let chunksTouched = 0;
  for (let seed = 1; seed <= 6; seed++) {
    // Three worlds built alike: one for each allowance, and one to ask piece by piece.
    const worlds = [0, 1, 2].map(() => flatWorld(4));
    const built = worlds.map((w) => ramble(w, new Rng(seed), 800));
    expect(rows(worlds[1]!)).toEqual(rows(worlds[0]!));
    expect(built[0]!.length).toBeGreaterThan(60);
    chunksTouched = Math.max(chunksTouched, worlds[0]!.structs.chunks.filter((t) => t && t.live > 0).length);
    // What goes: everything that stands by itself on one side of the building (in every third, on both), and a few other pieces.
    const rng = new Rng(seed * 977);
    const w0 = worlds[0]!;
    const row = (ref: number) => ({ t: w0.structs.chunks[Math.floor(ref / 65536)]!, slot: ref & 0xffff });
    const isRoot = (ref: number): boolean => [ROLE_FOUNDATION, ROLE_PILLAR].includes(w0.reg.role[row(ref).t.kind[row(ref).slot]!]!);
    const roots = built[0]!.filter(isRoot);
    const middle = roots.map((ref) => row(ref).t.x[row(ref).slot]!).sort((p, q) => p - q)[roots.length >> 1]!;
    const victims = built[0]!.filter((ref) => (isRoot(ref) ? seed % 3 === 0 || row(ref).t.x[row(ref).slot]! <= middle : rng.int(40) === 0));
    expect(victims.length).toBeGreaterThan(0);

    const big = bringDown(worlds[0]!, victims, 16000);
    const small = bringDown(worlds[1]!, victims, 250);
    // A call stops at its allowance: it overruns by the picture of one piece and the steps of one search, no more,
    // however much is coming down.
    expect(big.worst - 16000).toBeLessThan(1000);
    expect(small.worst - 250).toBeLessThan(1000);
    expect(small.calls).toBeGreaterThan(big.calls);
    expect(small.fell).toBe(big.fell);
    fellInAll += big.fell;
    mostWaves = Math.max(mostWaves, small.waves);

    askEach(worlds[2]!, victims);
    expect(rows(worlds[0]!)).toEqual(rows(worlds[2]!));
    expect(rows(worlds[1]!)).toEqual(rows(worlds[2]!));
    // With nothing left that stands by itself, nothing is left.
    if (seed % 3 === 0) expect(w0.structs.count).toBe(0);
  }
  // The buildings were worth knocking down: plenty fell, some of it wave after wave, across the corner of four chunks.
  expect(fellInAll).toBeGreaterThan(400);
  expect(mostWaves).toBeGreaterThan(8);
  expect(chunksTouched).toBeGreaterThan(1);
});

test("what leaned on a wall falls when the wall loses its footing, though the wall itself is held some other way and stays", () => {
  const worlds = [flatWorld(4), flatWorld(4)];
  const lean = worlds.map((w) => {
    const kind = (piece: string): number => w.kind(`core:${piece}_wood`);
    const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
    const sockets = makeSockets();
    /** Join a piece to `target` in whichever of its places puts it at (x, z). */
    const at = (target: number, piece: string, x: number, z: number): number => {
      const n = socketsOf(w.structs, w.reg, target, kind(piece), sockets);
      for (let k = 0; k < n; k++) {
        if (!poseAt(w.structs, w.reg, target, kind(piece), k, 0, pose) || pose.x !== x * U || pose.z !== z * U) continue;
        return w.structs.add(kind(piece), pose.x / U, pose.y / U, pose.z / U, pose.yaw, 3, 100);
      }
      throw new Error(`no place for a ${piece} at ${x}, ${z}`);
    };
    // Two foundations, north and south, each with a wall on its east edge; floors out east from the walls' tops.
    const north = w.structs.add(kind("foundation"), 100, FOUNDATION_THICK / 2, 100, 0, 3, 100);
    const south = at(north, "foundation", 100, 97);
    const wall = at(north, "wall", 101.5, 100);
    const other = at(south, "wall", 101.5, 97);
    const c1 = at(wall, "ceiling", 103, 100);
    const cs = at(other, "ceiling", 103, 97);
    const c3 = at(c1, "ceiling", 103, 103);
    // The one that leans on the north wall alone: 5.4 m from it, 7.5 m from the south wall, and 6.7 m from the north foundation.
    const far = at(c3, "ceiling", 106, 103);
    return { north, wall, c1, cs, c3, far };
  });
  const [w, naive] = worlds as [TestWorld, TestWorld];
  const p = lean[0]!;
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  expect([p.wall, p.c1, p.cs, p.c3, p.far].map((ref) => support.standsRef(ref))).toEqual([true, true, true, true, true]);
  // The north foundation goes. Its wall hangs from the floors, which the south wall holds: it stays, and so does all that is near enough the south wall.
  const result = bringDown(w, [p.north], 16000);
  const there = (ref: number): boolean => w.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff] !== 0;
  expect([p.wall, p.c1, p.cs, p.c3].map(there)).toEqual([true, true, true, true]);
  // The far floor is out of the south wall's reach, and the wall it leaned on stands on nothing now: it falls,
  // though it is further from the foundation that went than anything a foundation holds.
  expect([there(p.far), result.fell]).toEqual([false, 1]);
  askEach(naive, [lean[1]!.north]);
  expect(rows(w)).toEqual(rows(naive));
});

test("a piece seen to go waits its turn, drops as a thing dropped does, drifts out from where it began, and is gone when the ground has it", () => {
  const halfY = new Float32Array(8).fill(1.5);
  const f = new Falling(halfY, () => 0);
  const piece = (x: number, y: number, z: number, cause = GONE_FELL, tick = 100, kind = 3): Rubble => ({ kind, x, y, z, yaw: 1000, cause, ox: 10, oy: 4.5, oz: 10, tick });
  // Three of one removal, in a line going east from where it began; one of a removal two ticks later; one destroyed outright.
  const list = [piece(13, 4.5, 10), piece(16, 4.5, 10), piece(22, 4.5, 10), piece(13, 7.5, 10, GONE_FELL, 102), piece(40, 1.5, 40, GONE_DESTROYED, 100, 5)];
  f.absorb(list, 5000, 0, 0, 0);
  expect([list.length, f.count, f.taken, f.dropped]).toEqual([0, 5, 5, 0]);
  // Until its turn each stands where it stood: the nearest of a removal has no wait, the others 25 ms a metre beyond it.
  f.step(5000);
  expect(Array.from(f.y.subarray(0, 5))).toEqual([4.5, 4.5, 4.5, 7.5, 1.5]);
  expect([Array.from(f.x.subarray(0, 5)), Array.from(f.kind.subarray(0, 5)), f.yaw[1]]).toEqual([[13, 16, 22, 13, 40], [3, 3, 3, 3, 5], 1000]);
  const at = (ms: number): number[] => (f.step(5000 + ms), Array.from(f.y.subarray(0, f.count)));
  const drop = (ms: number): number => 0.5 * FALL_GRAVITY * (ms / 1000) ** 2;
  const two = 2 * TICK_DT * 1000;
  let y = at(60);
  expect(y[0]).toBeCloseTo(4.5 - drop(60), 4);
  expect(y[1]).toBe(4.5);
  expect(y[4]).toBeCloseTo(1.5 - drop(60), 4);
  y = at(3 * FRONT_MS_PER_METRE + 40);
  expect(y[1]).toBeCloseTo(4.5 - drop(40), 4);
  expect(y[2]).toBe(4.5);
  // The later removal is later by its ticks, and its nearest piece no later than that.
  expect(at(two - 1)[3]).toBe(7.5);
  expect(at(two + 100)[3]).toBeCloseTo(7.5 - drop(100), 4);
  // It drifts away from where the collapse began (east, here) and turns a little; what was destroyed outright only drops.
  f.step(5000 + 400);
  expect(f.x[0]!).toBeGreaterThan(13.2);
  expect(f.z[0]!).toBeCloseTo(10, 5);
  expect(f.yaw[0]).not.toBe(1000);
  expect([f.x[4], f.z[4]]).toEqual([40, 40]);
  // Gone when all of it is under the ground: its middle its half height down. The destroyed one, lowest, goes first.
  const gone = (y0: number): number => Math.sqrt((2 * (y0 + 1.5)) / FALL_GRAVITY) * 1000;
  f.step(5000 + gone(1.5) - 5);
  expect(f.count).toBe(5);
  f.step(5000 + gone(1.5) + 5);
  expect([f.count, Array.from(f.kind.subarray(0, 4))]).toEqual([4, [3, 3, 3, 3]]);
  f.step(5000 + gone(4.5) + 5);
  expect(f.count).toBe(3);
  f.step(5000 + 12 * FRONT_MS_PER_METRE + gone(7.5) + two + 5);
  expect(f.count).toBe(0);

  // However late its removal or far its place, nothing waits long.
  f.absorb([piece(10.5, 3, 10), piece(300, 3, 10), piece(10.5, 3, 10, GONE_FELL, 400)], 9000, 0, 0, 0);
  f.step(9000 + MAX_WAIT_MS - 1);
  expect(Array.from(f.y.subarray(0, 3)).map((v) => v === 3)).toEqual([false, true, true]);
  f.step(9000 + MAX_WAIT_MS + 50);
  expect(f.y[1]).toBeCloseTo(3 - drop(50), 4);
  expect(f.y[2]).toBeCloseTo(3 - drop(50), 4);
});

test("only so many are shown falling: the nearest to the eye, whatever order they came in", () => {
  const f = new Falling(new Float32Array(4).fill(0.1), () => 0);
  // A row of pieces going away from an eye at the origin, told of farthest first, in two lots.
  const row = (from: number, to: number): Rubble[] => {
    const out: Rubble[] = [];
    for (let k = to - 1; k >= from; k--) out.push({ kind: 1, x: k + 1, y: 50, z: 0, yaw: 0, cause: GONE_DESTROYED, ox: 0, oy: 0, oz: 0, tick: 7 });
    return out;
  };
  f.absorb(row(200, 400), 0, 0, 50, 0);
  expect([f.count, f.dropped]).toEqual([MAX_FALLING, 0].map((v, i) => (i === 0 ? Math.min(200, MAX_FALLING) : v)));
  f.absorb(row(0, 200), 0, 0, 50, 0);
  f.step(1);
  expect([f.count, f.taken, f.dropped]).toEqual([MAX_FALLING, 400, 400 - MAX_FALLING]);
  const xs = Array.from(f.x.subarray(0, f.count)).sort((a, b) => a - b);
  expect([xs[0], xs[MAX_FALLING - 1]]).toEqual([1, MAX_FALLING]);
  // When they have gone there is room again.
  f.step(60000);
  expect(f.count).toBe(0);
  f.absorb(row(0, 3), 60000, 0, 50, 0);
  expect(f.count).toBe(3);
});
