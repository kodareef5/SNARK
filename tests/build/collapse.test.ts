import { expect, test } from "bun:test";
import { FALL_GRAVITY, FRONT_MS_PER_METRE, Falling, MAX_WAIT_MS } from "../../client/core/rubble.ts";
import { MAX_FALLING } from "../../client/core/render/packet.ts";
import type { Rubble } from "../../client/core/session.ts";
import { FOUNDATION_THICK, WALL_HEIGHT } from "../../content/building.ts";
import { STRUCT_UNITS, TICK_DT } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { Collapse } from "../../shared/world/collapse.ts";
import { fallMost } from "../../server/build.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import type { Site } from "../../shared/world/lattice/place.ts";
import { ROLE_FOUNDATION, ROLE_PILLAR, type Pose } from "../../shared/world/snap.ts";
import { GONE_DESTROYED, GONE_FELL, GONE_KEPT, GONE_TAKEN, StructureStore } from "../../shared/world/structures.ts";
import { Support } from "../../shared/world/support.ts";
import { count, join as joinTo, judge, poseIn, start } from "../fixtures/slots.ts";
import { coreRegistry, flatWorld, type TestWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;

test("what goes together is remembered as one removal a chunk, in runs of slots; one after another in the same moment likewise; and only the last few are kept", () => {
  const w = flatWorld(2);
  const block = w.kind("core:block");
  const a = Array.from({ length: 10 }, (_, k) => w.structs.add(block, 4 + k * 3, 0.5, 8, 0, 0, 100));
  const b = Array.from({ length: 3 }, (_, k) => w.structs.add(block, 70 + k * 3, 0.5, 8, 0, 0, 100));
  const [t0, t1] = [w.structs.chunks[0]!, w.structs.chunks[1]!];
  expect([a.map((r) => r & 0xffff), b.map((r) => r & 0xffff), Math.floor(b[0]! / 65536)]).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 1, 2], 1]);
  const told: [number, number][] = [];
  const changed: number[] = [];
  w.structs.onRemove = (ref, cause) => void told.push([ref, cause]);
  w.structs.onChunkChanged = (chunk) => void changed.push(chunk);
  const [v0, v1] = [t0.version, t1.version];
  // The first seven refs are out of order, with one twice and one never built, so five go and each chunk changes once.
  const refs = Uint32Array.from([a[7]!, b[0]!, a[3]!, a[2]!, a[3]!, a[4]!, 5000, 0, 0]);
  expect(w.structs.removeMany(refs, 7, GONE_FELL, 10, 2, 8, 77)).toBe(5);
  expect([t0.version - v0, t1.version - v1, changed]).toEqual([1, 1, [0, 1]]);
  expect(t0.gone).toEqual([{ version: v0 + 1, cause: GONE_FELL, x: 10, y: 2, z: 8, stamp: 77, radius: 0, runs: [2, 3, 7, 1], left: [], count: 4 }]);
  expect(t1.gone).toEqual([{ version: v1 + 1, cause: GONE_FELL, x: 10, y: 2, z: 8, stamp: 77, radius: 0, runs: [0, 1], left: [], count: 1 }]);
  expect(told.map((p) => p[0]).sort((p, q) => p - q)).toEqual([a[2]!, a[3]!, a[4]!, a[7]!, b[0]!]);
  expect(told.every((p) => p[1] === GONE_FELL)).toBe(true);
  expect([w.structs.count, t0.live, t0.kind[3], t0.mod[3]]).toEqual([8, 6, 0, v0 + 1]);

  expect(w.structs.remove(a[0]!)).toBe(true);
  expect(t0.gone[1]).toEqual({ version: v0 + 2, cause: GONE_TAKEN, x: 4, y: 0.5, z: 8, stamp: 0, radius: 0, runs: [0, 1], left: [], count: 1 });
  // The record is placed at the first of the three.
  for (const k of [9, 8, 5]) expect(w.structs.damage(a[k]!, 1e9, 90)).toBe(0);
  expect(t0.gone.length).toBe(3);
  expect(t0.gone[2]).toEqual({ version: v0 + 5, cause: GONE_DESTROYED, x: 31, y: 0.5, z: 8, stamp: 90, radius: 0, runs: [9, 1, 8, 1, 5, 1], left: [], count: 3 });
  // Damage that does not destroy is a change between, so the next piece destroyed on that tick is another record. So is one on another tick.
  expect(w.structs.damage(a[1]!, 10, 90)).toBe(90);
  w.structs.damage(a[6]!, 1e9, 90);
  w.structs.damage(a[1]!, 1e9, 91);
  expect(t0.gone.slice(3).map((g) => [g.runs, g.stamp])).toEqual([
    [[6, 1], 90],
    [[1, 1], 91],
  ]);
  expect(t0.live).toBe(0);
  expect(t0.goneFloor).toBe(0);

  // goneFloor is the version of the newest record forgotten.
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

/** Builds at random under a builder's rules: each piece joins another, stands, and has nothing in its way. It straddles the corner of four chunks. */
function ramble(w: TestWorld, rng: Rng, tries: number): number[] {
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  const kinds = ["foundation", "wall", "wall", "wall", "wall", "doorframe", "ceiling", "ceiling", "ceiling", "ceiling", "pillar", "stairs", "door"].map((p) => w.kind(`core:${p}_wood`));
  const site: Site = { structs: w.structs, tables: w.reg, heightAt: (x, z) => w.hf.heightAt(x, z), standsAt: (kind, fr, k0, k1) => support.standsAt(kind, fr, k0, k1) };
  const built = [start(w, kinds[0]!, 62.5, FOUNDATION_THICK / 2, 62.5, rng.int(65536), 3, 100)];
  for (let i = 0; i < tries; i++) {
    const target = built[rng.int(built.length)]!;
    const kind = kinds[rng.int(kinds.length)]!;
    const n = count(w, target, kind);
    if (n === 0) continue;
    const k = rng.int(n);
    const turn = rng.int(4);
    if (judge(site, w.reg, target, kind, k, turn) === RESULT_OK) built.push(joinTo(w, target, kind, k, turn, 100));
  }
  return built;
}

/** Destroys `victims` and steps the collapse with `budget` per call, each removal of at most `most(removals so far)` pieces. worst is the most work one call did, and largest the most pieces one removed. */
function bringDown(w: TestWorld, victims: number[], budget: number, most: (made: number) => number = () => 1024): { calls: number; worst: number; fell: number; waves: number; largest: number } {
  const collapse = new Collapse(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  let fell = 0;
  w.structs.onRemove = (ref, cause) => {
    if (cause !== GONE_FELL) collapse.gone(ref);
    else fell++;
  };
  // The collapse begins where the first victim stood.
  const ft = w.structs.chunks[Math.floor(victims[0]! / 65536)]!;
  const began = [ft.x[victims[0]! & 0xffff]!, ft.y[victims[0]! & 0xffff]!, ft.z[victims[0]! & 0xffff]!];
  for (const ref of victims) w.structs.damage(ref, 1e9, 40);
  expect(collapse.busy).toBe(true);
  let calls = 0;
  let tick = 41;
  let worst = 0;
  let largest = 0;
  for (; collapse.busy && calls < 100000; calls++) {
    const allowed = most(collapse.made);
    const removed = collapse.step(budget, tick++, allowed);
    expect(removed).toBeLessThanOrEqual(allowed);
    if (removed > largest) largest = removed;
    if (collapse.spent > worst) worst = collapse.spent;
  }
  expect(collapse.busy).toBe(false);
  expect([collapse.pending, collapse.settled, collapse.fallen]).toEqual([0, 1, fell]);
  for (const t of w.structs.chunks) {
    for (const g of t?.gone ?? []) {
      if (g.cause !== GONE_FELL) continue;
      expect(g.stamp).toBeGreaterThan(40);
      expect([g.x, g.y, g.z]).toEqual(began);
    }
  }
  w.structs.onRemove = null;
  return { calls, worst, fell, waves: collapse.waves, largest };
}

/** The naive way. Removes `victims`, then every piece that does not stand, until everything left does. */
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

test("a collapse leaves what asking piece by piece would, at any work budget and removal bound", () => {
  let fellInAll = 0;
  let mostWaves = 0;
  let chunksTouched = 0;
  for (let seed = 1; seed <= 6; seed++) {
    // Six identical worlds: one for each budget, one to ask piece by piece, and three for removals held to a few pieces.
    const worlds = [0, 1, 2, 3, 4, 5].map(() => flatWorld(4));
    const built = worlds.map((w) => ramble(w, new Rng(seed), 800));
    expect(rows(worlds[1]!)).toEqual(rows(worlds[0]!));
    expect(built[0]!.length).toBeGreaterThan(60);
    chunksTouched = Math.max(chunksTouched, worlds[0]!.structs.chunks.filter((t) => t && t.live > 0).length);
    // The victims are the foundations and pillars on one side of the building (on both sides for every third seed) and a few other pieces.
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
    // A call stops at its budget. It overruns by no more than the node of one piece and the steps of one search.
    expect(big.worst - 16000).toBeLessThan(1000);
    expect(small.worst - 250).toBeLessThan(1000);
    expect(small.calls).toBeGreaterThan(big.calls);
    expect(small.fell).toBe(big.fell);
    fellInAll += big.fell;
    mostWaves = Math.max(mostWaves, small.waves);

    askEach(worlds[2]!, victims);
    expect(rows(worlds[0]!)).toEqual(rows(worlds[2]!));
    expect(rows(worlds[1]!)).toEqual(rows(worlds[2]!));
    // A removal held to one piece, to seven, and to the server's own pace takes more removals and leaves the same.
    const one = bringDown(worlds[3]!, victims, 16000, () => 1);
    const seven = bringDown(worlds[4]!, victims, 250, () => 7);
    const paced = bringDown(worlds[5]!, victims, 16000, fallMost);
    for (const k of [3, 4, 5]) expect(rows(worlds[k]!)).toEqual(rows(worlds[2]!));
    expect([one.fell, seven.fell, paced.fell, one.largest, one.waves]).toEqual([big.fell, big.fell, big.fell, Math.min(1, big.fell), big.fell]);
    expect(seven.largest).toBeLessThanOrEqual(7);
    expect(paced.waves).toBeGreaterThanOrEqual(big.waves);
    // With every foundation and pillar gone, nothing is left.
    if (seed % 3 === 0) expect(w0.structs.count).toBe(0);
  }
  // Guard against trivial buildings. Many pieces fell, in many waves, in more than one chunk.
  expect(fellInAll).toBeGreaterThan(400);
  expect(mostWaves).toBeGreaterThan(8);
  expect(chunksTouched).toBeGreaterThan(1);
});

test("a second break while a collapse runs joins it, and what is left is as if both broke at once", () => {
  for (let seed = 1; seed <= 4; seed++) {
    const [w, naive] = [flatWorld(4), flatWorld(4)];
    const built = ramble(w, new Rng(seed), 800);
    ramble(naive, new Rng(seed), 800);
    const row = (ref: number) => ({ t: w.structs.chunks[Math.floor(ref / 65536)]!, slot: ref & 0xffff });
    const roots = built.filter((ref) => [ROLE_FOUNDATION, ROLE_PILLAR].includes(w.reg.role[row(ref).t.kind[row(ref).slot]!]!));
    const middle = roots.map((ref) => row(ref).t.x[row(ref).slot]!).sort((p, q) => p - q)[roots.length >> 1]!;
    const west = roots.filter((ref) => row(ref).t.x[row(ref).slot]! <= middle);
    const east = roots.filter((ref) => row(ref).t.x[row(ref).slot]! > middle);
    const collapse = new Collapse(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
    w.structs.onRemove = (ref, cause) => void (cause !== GONE_FELL && collapse.gone(ref));
    for (const ref of west) w.structs.damage(ref, 1e9, 40);
    // Three removals of three pieces, and the first collapse is still running when the east side goes.
    let tick = 41;
    while (collapse.made < 3 && collapse.busy) collapse.step(16000, tick++, 3);
    expect([collapse.busy, collapse.made, collapse.fallen]).toEqual([true, 3, 9]);
    for (const ref of east) w.structs.damage(ref, 1e9, tick);
    while (collapse.busy && tick < 100000) collapse.step(16000, tick++, fallMost(collapse.made));
    // One collapse from first to last: its count of removals ran on, and began again only when it settled.
    expect([collapse.busy, collapse.settled, collapse.made, collapse.chunks.size]).toEqual([false, 1, 0, 0]);
    w.structs.onRemove = null;
    askEach(naive, [...west, ...east]);
    expect(rows(w)).toEqual(rows(naive));
    expect(w.structs.count).toBe(0);
  }
});

test("what leaned on a wall falls when the wall loses its footing, though the wall itself is held some other way and stays", () => {
  const worlds = [flatWorld(4), flatWorld(4)];
  const lean = worlds.map((w) => {
    const kind = (piece: string): number => w.kind(`core:${piece}_wood`);
    const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
    /** Joins a piece to `target` in the place that puts it at (x, z). */
    const at = (target: number, piece: string, x: number, z: number): number => {
      const n = count(w, target, kind(piece));
      for (let k = 0; k < n; k++) {
        if (!poseIn(w, target, kind(piece), k, 0, pose) || pose.x !== x * U || pose.z !== z * U) continue;
        return joinTo(w, target, kind(piece), k, 0, 100);
      }
      throw new Error(`no place for a ${piece} at ${x}, ${z}`);
    };
    // Three foundations: north, south of it, and east of that. A wall stands on the north one's east edge and another on
    // the east one's north edge, and one floor lies on the tops of both.
    const north = start(w, kind("foundation"), 100, FOUNDATION_THICK / 2, 100, 0, 3, 100);
    const south = at(north, "foundation", 100, 97);
    const east = at(south, "foundation", 103, 97);
    const wall = at(north, "wall", 101.5, 100);
    const other = at(east, "wall", 103, 98.5);
    const c1 = at(wall, "ceiling", 103, 100);
    const cs = at(other, "ceiling", 103, 97);
    // West of the north wall, a floor on its top and one more beyond.
    const c3 = at(wall, "ceiling", 100, 100);
    // This floor leans on the north wall alone: it is two pieces out from it, and four from the other wall by the way through the pieces.
    const far = at(c3, "ceiling", 97, 100);
    return { north, wall, c1, cs, c3, far };
  });
  const [w, naive] = worlds as [TestWorld, TestWorld];
  const p = lean[0]!;
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  expect([p.wall, p.c1, p.cs, p.c3, p.far].map((ref) => support.standsRef(ref))).toEqual([true, true, true, true, true]);
  // The north foundation goes. Its wall hangs from the floor the other wall holds, so it stays. So does everything near enough the other wall.
  const result = bringDown(w, [p.north], 16000);
  const there = (ref: number): boolean => w.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff] !== 0;
  expect([p.wall, p.c1, p.cs, p.c3].map(there)).toEqual([true, true, true, true]);
  // The far floor is out of the other wall's reach, and the wall it leaned on hangs now and holds nothing, so it falls.
  expect([there(p.far), result.fell]).toEqual([false, 1]);
  askEach(naive, [lean[1]!.north]);
  expect(rows(w)).toEqual(rows(naive));
});

test("two columns that lose their footing at once are two columns, though one is eight kilometres north of the other", () => {
  // A map may be 16 km a side. This one is long enough to hold both.
  const reg = coreRegistry();
  const structs = new StructureStore({ chunksX: 4, chunksZ: 132 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const kind = (piece: string): number => reg.index.get(`core:${piece}_wood`)!;
  const join = (target: number, piece: string, k: number): number => {
    const ref = joinTo({ structs, reg }, target, kind(piece), k, 0, 100);
    expect(ref).toBeGreaterThanOrEqual(0);
    return ref;
  };
  // In the north, a floor on a pillar and a second floor hanging from the side of the first.
  const pillar = start({ structs, reg }, kind("pillar"), 100, WALL_HEIGHT / 2 - 0.125, 8292, 0, 7, 100);
  const floor = join(pillar, "ceiling", 0);
  const hung = join(floor, "ceiling", 1);
  const t = structs.chunks[Math.floor(floor / 65536)]!;
  // In the south, a foundation a lattice step east of that first floor and 8,192 m from it.
  const south = start({ structs, reg }, kind("foundation"), t.x[floor & 0xffff]! + 1 / U, FOUNDATION_THICK / 2, t.z[floor & 0xffff]! - 8192, 0, 7, 100);
  const collapse = new Collapse(structs, reg, () => 0);
  structs.onRemove = (ref, cause) => void (cause !== GONE_FELL && collapse.gone(ref));
  structs.damage(south, 1e9, 40);
  structs.damage(floor, 1e9, 40);
  for (let k = 0; collapse.busy && k < 1000; k++) collapse.step(16000, 41 + k);
  const there = (ref: number): boolean => structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff] !== 0;
  // The floor that hung from the lost one has nothing to hold it.
  expect([collapse.busy, there(pillar), there(hung), collapse.fallen]).toEqual([false, true, false, 1]);
});

test("a piece seen to go waits its turn, drops as a thing dropped does, drifts out from where it began, and is gone when the ground has it", () => {
  const halfY = new Float32Array(8).fill(1.5);
  const f = new Falling(halfY, () => 0);
  const piece = (x: number, y: number, z: number, cause = GONE_FELL, tick = 100, kind = 3): Rubble => ({ kind, x, y, z, yaw: 1000, tw: -1, cause, ox: 10, oy: 4.5, oz: 10, tick, radius: 0, into: 0, map: 0 });
  // Three pieces of one removal in a line going east from its origin, one of a removal two ticks later, and one destroyed outright.
  const list = [piece(13, 4.5, 10), piece(16, 4.5, 10), piece(22, 4.5, 10), piece(13, 7.5, 10, GONE_FELL, 102), piece(40, 1.5, 40, GONE_DESTROYED, 100, 5)];
  f.absorb(list, 5000, 0, 0, 0);
  expect([list.length, f.count, f.taken, f.dropped]).toEqual([0, 5, 5, 0]);
  // Each piece stays put until its turn. The nearest of a removal has no wait, and the others wait 25 ms for each metre beyond it.
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
  // The later removal starts two ticks later, and its nearest piece waits no longer than that.
  expect(at(two - 1)[3]).toBe(7.5);
  expect(at(two + 100)[3]).toBeCloseTo(7.5 - drop(100), 4);
  // A fallen piece drifts away from the collapse's origin (east here) and turns a little. A destroyed piece only drops.
  f.step(5000 + 400);
  expect(f.x[0]!).toBeGreaterThan(13.2);
  expect(f.z[0]!).toBeCloseTo(10, 5);
  expect(f.yaw[0]).not.toBe(1000);
  expect([f.x[4], f.z[4]]).toEqual([40, 40]);
  // A piece is gone when its centre is half its height under the ground. The destroyed one is lowest and goes first.
  const gone = (y0: number): number => Math.sqrt((2 * (y0 + 1.5)) / FALL_GRAVITY) * 1000;
  f.step(5000 + gone(1.5) - 5);
  expect(f.count).toBe(5);
  f.step(5000 + gone(1.5) + 5);
  expect([f.count, Array.from(f.kind.subarray(0, 4))]).toEqual([4, [3, 3, 3, 3]]);
  f.step(5000 + gone(4.5) + 5);
  expect(f.count).toBe(3);
  f.step(5000 + 12 * FRONT_MS_PER_METRE + gone(7.5) + two + 5);
  expect(f.count).toBe(0);

  // No piece waits longer than MAX_WAIT_MS, however late its removal or far its place.
  f.absorb([piece(10.5, 3, 10), piece(300, 3, 10), piece(10.5, 3, 10, GONE_FELL, 400)], 9000, 0, 0, 0);
  f.step(9000 + MAX_WAIT_MS - 1);
  expect(Array.from(f.y.subarray(0, 3)).map((v) => v === 3)).toEqual([false, true, true]);
  f.step(9000 + MAX_WAIT_MS + 50);
  expect(f.y[1]).toBeCloseTo(3 - drop(50), 4);
  expect(f.y[2]).toBeCloseTo(3 - drop(50), 4);
});

test("only so many are shown falling: the nearest to the eye, whatever order they came in", () => {
  const f = new Falling(new Float32Array(4).fill(0.1), () => 0);
  // A row of pieces going away from an eye at the origin, absorbed farthest first, in two lots.
  const row = (from: number, to: number): Rubble[] => {
    const out: Rubble[] = [];
    for (let k = to - 1; k >= from; k--) out.push({ kind: 1, x: k + 1, y: 50, z: 0, yaw: 0, tw: -1, cause: GONE_DESTROYED, ox: 0, oy: 0, oz: 0, tick: 7, radius: 0, into: 0, map: 0 });
    return out;
  };
  const half = MAX_FALLING / 2;
  f.absorb(row(half * 2, half * 3), 0, 0, 50, 0);
  expect([f.count, f.dropped]).toEqual([half, 0]);
  f.absorb(row(0, half * 2), 0, 0, 50, 0);
  f.step(1);
  expect([f.count, f.taken, f.dropped]).toEqual([MAX_FALLING, half * 3, half]);
  const xs = Array.from(f.x.subarray(0, f.count)).sort((a, b) => a - b);
  expect([xs[0], xs[MAX_FALLING - 1]]).toEqual([1, MAX_FALLING]);
  // When they have gone there is room again.
  f.step(60000);
  expect(f.count).toBe(0);
  f.absorb(row(0, 3), 60000, 0, 50, 0);
  expect(f.count).toBe(3);
});
