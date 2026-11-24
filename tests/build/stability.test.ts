// Stability: how firmly a piece stands, as one whole number read from the pieces and never stored.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLOOR_THICK, FOUNDATION_THICK, WALL_HEIGHT } from "../../content/building.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { Rng } from "../../shared/rng.ts";
import { Collapse } from "../../shared/world/collapse.ts";
import { FORM_LAYERS } from "../../shared/world/lattice/forms.ts";
import type { LatticeKey } from "../../shared/world/lattice/frames.ts";
import { CLS_SQUARE, key0, key1 } from "../../shared/world/lattice/module.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import type { Site } from "../../shared/world/lattice/place.ts";
import { Found, GONE_FELL } from "../../shared/world/structures.ts";
import { FALL_MOST, STABILITY, Support } from "../../shared/world/support.ts";
import { NORTH, count, join as joinTo, judge, put, raised, set, slot, start } from "../fixtures/slots.ts";
import { coreRegistry, flatWorld, wrap, type TestWorld } from "../fixtures/world.ts";

const SLAB = FORM_LAYERS.indexOf("slab");
const dir = mkdtempSync(join(tmpdir(), "snark-stability-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function setup(yaw = 0, w = flatWorld(4)) {
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  const kind = (piece: string, tier = "wood"): number => w.kind(`core:${piece}_${tier}`);
  /** Builds a piece in place `k` of `target`, whether or not it would stand. */
  const join = (target: number, piece: string, k: number, tier = "wood"): number => {
    const ref = joinTo(w, target, kind(piece, tier), k);
    expect(ref).toBeGreaterThanOrEqual(0);
    return ref;
  };
  const foundation = (x: number, z: number): number => start(w, kind("foundation"), x, FOUNDATION_THICK / 2, z, yaw, 7);
  /** A pillar with its foot in the ground. */
  const pillar = (x: number, z: number, tier = "wood"): number => start(w, kind("pillar", tier), x, WALL_HEIGHT / 2 - 0.125, z, yaw, 7);
  const s = (ref: number): number => support.stability(ref);
  return { w, support, join, foundation, pillar, kind, s };
}

/** Every row of `w` that is built, as refs. */
function refsOf(w: TestWorld): number[] {
  const out: number[] = [];
  w.structs.chunks.forEach((t, chunk) => {
    for (let slot = 0; t && slot < t.high; slot++) if (t.kind[slot] !== 0) out.push(chunk * 65536 + slot);
  });
  return out;
}

/** Each built row's stability by its kind and place. */
function numbers(w: TestWorld): Map<string, number> {
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  const out = new Map<string, number>();
  for (const ref of refsOf(w)) {
    const t = w.structs.chunks[Math.floor(ref / 65536)]!;
    const slot = ref & 0xffff;
    out.set(`${t.kind[slot]} ${t.x[slot]} ${t.y[slot]} ${t.z[slot]} ${t.yaw[slot]}`, support.stability(ref));
  }
  return out;
}

/** Builds at random under a builder's rules, across the corner of four chunks: each piece joins another, stands, and has nothing in its way. */
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

/** The keyed pieces of `w` as kind and key, and each frame's origin. */
function keyed(w: TestWorld): { pieces: [number, number, number, number][]; frames: [number, number, number, number, number, number][] } {
  const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
  const pieces: [number, number, number, number][] = [];
  for (const ref of refsOf(w)) if (w.structs.keyAt(ref, key)) pieces.push([w.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!, key.fr, key.k0, key.k1]);
  return { pieces, frames: [...w.structs.frames.all()].map((f) => [f.gid, f.ox, f.oy, f.oz, f.yaw, f.team]) };
}

/** Each keyed piece's stability by its frame and key, asked one at a time. */
function byKey(w: TestWorld, plain = true): Map<string, number> {
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  if (!plain) support.plain = false;
  const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
  const out = new Map<string, number>();
  for (const ref of refsOf(w)) if (w.structs.keyAt(ref, key)) out.set(`${key.fr} ${key.k0} ${key.k1}`, support.stability(ref));
  return out;
}

const sorted = (m: Map<string, number>): [string, number][] => [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1));

test("floors off a pillar are 4, 2 and 0, round the corner 0, and no further; off a wall 3 and 1; at four facings", () => {
  for (const yaw of [0, 9000, 16384, 31000]) {
    const { join, pillar, foundation, s, support } = setup(yaw);
    const p = pillar(100, 100);
    const c00 = join(p, "ceiling", 0);
    const c10 = join(c00, "ceiling", 1);
    const c20 = join(c10, "ceiling", 1);
    const c30 = join(c20, "ceiling", 1);
    const c11 = join(c10, "ceiling", 0);
    const c21 = join(c20, "ceiling", 0);
    expect([p, c00, c10, c20, c30, c11, c21].map(s)).toEqual([4, 4, 2, 0, -1, 0, -1]);
    // A wall needs 1: it stands on the rim of the first piece out and not of the second. Stairs stand on any floor that stands.
    const rim = [join(c00, "wall", 1), join(c10, "wall", 1), join(c20, "wall", 1)];
    expect(rim.map(s)).toEqual([3, 1, -1]);
    expect(rim.map((r) => support.standsRef(r))).toEqual([true, true, false]);

    const f = foundation(140, 100);
    const walls = [0, 1, 2, 3].map((k) => join(f, "wall", k));
    const over = join(walls[1]!, "ceiling", 1);
    const out1 = join(walls[1]!, "ceiling", 0);
    const out2 = join(out1, "ceiling", 0);
    const out3 = join(out2, "ceiling", 0);
    expect([f, ...walls, over, out1, out2, out3].map(s)).toEqual([4, 4, 4, 4, 4, 3, 3, 1, -1]);
    // Upper walls stand through the floor as columns. On the rims out from the wall they are 2 and 0, and 0 does not stand.
    const upper = [0, 1, 2, 3].map((k) => join(over, "wall", k));
    const outer = [join(out1, "wall", 0), join(out2, "wall", 0)];
    expect([...upper, ...outer].map(s)).toEqual([4, 4, 4, 4, 2, 0]);
    expect(outer.map((r) => support.standsRef(r))).toEqual([true, false]);
    expect([join(out1, "stairs", 0), join(out2, "stairs", 0)].map(s)).toEqual([3, 1]);
    // A door has its doorway's number.
    const frame = join(out1, "doorframe", 1);
    expect([s(frame), s(join(frame, "door", 0))]).toEqual([2, 2]);
  }
  expect(STABILITY).toBe(4);
});

test("distance is along the way through the pieces: the floor beside the second piece out from a wall is not held, 5.4 m from the wall", () => {
  const { join, foundation, s, support } = setup(0);
  const wall = join(foundation(100, 100), "wall", 1);
  const out1 = join(wall, "ceiling", 0);
  const side = join(out1, "ceiling", 1);
  const far = join(side, "ceiling", 0);
  expect([out1, side, far].map(s)).toEqual([3, 1, -1]);
  // With the piece between them built, it is the same three links away.
  const out2 = join(out1, "ceiling", 0);
  expect([s(out2), s(far), support.standsRef(far)]).toEqual([1, -1, false]);
});

test("a post holds the slab over its middle fully, one on a side's middle by 3 and one on a corner by 2; a post hung from a slab holds nothing", () => {
  const { w, kind, foundation, s } = setup(0);
  const fr = w.structs.frameAt(foundation(100, 100));
  // Places are half-sides of 1.5 m from the foundation's corner at (98.5, 98.5), and levels quarter storeys over its top.
  const post = (i: number, j: number, lvl = 0): number => set(w, fr, kind("pillar"), i, j, lvl);
  const slab = (i: number, j: number, lvl = 4): number => set(w, fr, kind("ceiling"), i, j, lvl);
  // A post on the foundation's corner, a slab with that corner, and one beyond it, 6.7 m from the foundation.
  const corner = post(2, 2);
  const a = slab(3, 3);
  const b = slab(5, 3);
  expect([corner, a, b].map(s)).toEqual([4, 2, 0]);
  // A post on the middle of the foundation's west side holds the slab west of it by 3.
  expect([post(0, 1), slab(-1, 1)].map(s)).toEqual([4, 3]);
  // A post hung under the far corner of the slab at 2 stands, and the slab that shares only that corner with it is not held by it.
  const hung = post(4, 4);
  const diagonal = slab(5, 5);
  expect([s(hung), s(diagonal)]).toEqual([1, -1]);
  // A post standing on that corner holds the slab a storey up by 2 less than the post has.
  const up = post(4, 4, 4);
  expect([s(up), s(slab(5, 5, 8))]).toEqual([1, -1]);

  // With the foundation gone, the slab 6.7 m from it falls too: what stood straight on the foundation is followed.
  const collapse = new Collapse(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  w.structs.onRemove = (ref, cause) => void (cause !== GONE_FELL && collapse.gone(ref));
  w.structs.remove(refsOf(w)[0]!);
  for (let k = 0; collapse.busy && k < 100; k++) collapse.step(16000, k + 1);
  expect([collapse.busy, w.structs.count]).toEqual([false, 0]);
});

test("a ring of floors and walls with nothing under it holds nothing, in a base that has a foundation elsewhere", () => {
  const { w, kind, foundation, support } = setup(0);
  const f = foundation(100, 100);
  const fr = w.structs.frameAt(f);
  const ring = [[10, 10], [12, 10], [12, 12], [10, 12]].map(([i, j]) => w.structs.place(kind("ceiling"), fr, key0(CLS_SQUARE, i!, 0, 0), key1(j!, 4, 0, SLAB, 0, 0), 7, 1));
  expect(ring.every((r) => r >= 0)).toBe(true);
  const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
  // A wall on each one's north side, a storey down: hung under it.
  const hung = ring.map((r) => {
    expect(slot(w, r, kind("wall"), NORTH, 0, key)).toBe(true);
    return put(w, kind("wall"), raised(key, -4), 7);
  });
  expect(hung.every((r) => w.structs.frameAt(r) === fr)).toBe(true);
  expect([...ring, ...hung].map((r) => support.stability(r))).toEqual([-1, -1, -1, -1, -1, -1, -1, -1]);
  expect([...ring, ...hung].map((r) => support.standsRef(r))).toEqual([false, false, false, false, false, false, false, false]);
  expect(support.stability(f)).toBe(4);
  expect(support.stability(0x7fff0000)).toBe(-1);
});

test("a piece not yet built has the number it has once built, and taking a piece up and setting it down again changes no number", () => {
  const w = flatWorld(4);
  ramble(w, new Rng(11), 500);
  const before = sorted(byKey(w));
  expect(before.length).toBeGreaterThan(60);
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
  const rng = new Rng(5);
  let asked = 0;
  for (const ref of refsOf(w)) {
    if (!w.structs.keyAt(ref, key) || rng.int(3) !== 0) continue;
    const t = w.structs.chunks[Math.floor(ref / 65536)]!;
    const [kind, owner] = [t.kind[ref & 0xffff]!, t.owner[ref & 0xffff]!];
    const was = support.stability(ref);
    w.structs.remove(ref);
    // The frame goes with its last row, and then there is nowhere to ask about.
    if (w.structs.frames.get(key.fr)) expect(support.stabilityAt(kind, key.fr, key.k0, key.k1)).toBe(was);
    expect(w.structs.place(kind, key.fr, key.k0, key.k1, owner, 100)).toBeGreaterThanOrEqual(0);
    asked++;
  }
  expect(asked).toBeGreaterThan(20);
  expect(sorted(byKey(w))).toEqual(before);
});

test("every number is the same whatever order the pieces were set down in, read one by one or in one pass, with triangles looked for or not", () => {
  let pieces = 0;
  let failing = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const built = flatWorld(4);
    ramble(built, new Rng(seed), 600);
    const { pieces: list, frames } = keyed(built);
    pieces += list.length;
    // Some pieces taken away with nothing judged, so that some numbers are low and some pieces are held by nothing.
    const gone = new Set<number>();
    const pick = new Rng(seed * 31);
    for (let k = 0; k < list.length; k++) if (pick.int(6) === 0) gone.add(k);
    const want = (w: TestWorld): [string, number][] => sorted(byKey(w));
    const lay = (order: number[], skip: Set<number> | null): TestWorld => {
      const w = flatWorld(4);
      for (const [gid, ox, oy, oz, yaw, team] of frames) w.structs.frames.make(ox, oy, oz, yaw, team, gid);
      for (const k of order) {
        if (skip?.has(k)) continue;
        const [kind, fr, k0, k1] = list[k]!;
        expect(w.structs.place(kind, fr, k0, k1, 3, 100)).toBeGreaterThanOrEqual(0);
      }
      return w;
    };
    const inOrder = list.map((_, k) => k);
    const whole = want(lay(inOrder, null));
    // Set down again by their keys in another store, the pieces have the numbers they had.
    expect(whole).toEqual(want(built));
    const holed = want(lay(inOrder, gone));
    failing += holed.filter((p) => p[1] < 1).length;
    const rng = new Rng(seed * 7919);
    for (let round = 0; round < 3; round++) {
      const order = [...inOrder];
      for (let k = order.length - 1; k > 0; k--) {
        const j = rng.int(k + 1);
        [order[k], order[j]] = [order[j]!, order[k]!];
      }
      expect(want(lay(order, null))).toEqual(whole);
      const w = lay(order, gone);
      expect(want(w)).toEqual(holed);
      expect(sorted(byKey(w, false))).toEqual(holed);
      // Taken away after being built, the same pieces leave the same numbers as never having been built.
      const full = lay(order, null);
      const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
      const at = new Map(list.map((p, k) => [`${p[1]} ${p[2]} ${p[3]}`, k]));
      for (const ref of refsOf(full)) if (full.structs.keyAt(ref, key) && gone.has(at.get(`${key.fr} ${key.k0} ${key.k1}`)!)) full.structs.remove(ref);
      expect(want(full)).toEqual(holed);

      // One pass over each frame gives every piece the number it has asked alone, and a piece stands when its number is what its form needs.
      const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
      const rows = new Found();
      const out = new Int8Array(4096);
      const one = byKey(w);
      for (const [gid] of frames) {
        const n = support.stabilities(gid, rows, out);
        for (let i = 0; i < n; i++) {
          const ref = rows.refs[i]!;
          w.structs.keyAt(ref, key);
          expect([ref, out[i]]).toEqual([ref, one.get(`${key.fr} ${key.k0} ${key.k1}`)!]);
          const need = w.reg.forms.def[w.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!]!.need ?? 0;
          expect([ref, support.standsRef(ref)]).toEqual([ref, out[i]! >= need]);
        }
      }
    }
  }
  expect(pieces).toBeGreaterThan(300);
  expect(failing).toBeGreaterThan(40);
});

test("what a piece holds and what holds it agree from both ends", () => {
  const w = flatWorld(4);
  ramble(w, new Rng(3), 600);
  const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  let held = 0;
  for (const ref of refsOf(w)) {
    if (w.structs.frameAt(ref) === 0) continue;
    const n = support.node(ref)!;
    for (const by of n.sup) expect([ref, support.node(by)!.links.includes(ref)]).toEqual([ref, true]);
    for (const on of n.over) {
      const o = support.node(on)!;
      // What stands on it at no cost has it as a holder at no cost, unless that piece stands by itself and was not asked.
      if (!o.root) expect([on, o.cost[o.sup.indexOf(ref)]]).toEqual([on, 0]);
      held++;
    }
    for (const other of n.links) expect([ref, support.node(other)!.links.includes(ref)]).toEqual([ref, true]);
  }
  expect(held).toBeGreaterThan(40);
});

test("after a save and a load every piece has the number it had", () => {
  for (let seed = 1; seed <= 3; seed++) {
    const w = flatWorld(4);
    const built = ramble(w, new Rng(seed + 20), 600);
    // A box on a floor, and some pieces taken away with nothing judged.
    const rng = new Rng(seed);
    for (const ref of built) if (rng.int(7) === 0 && ref !== built[0]) w.structs.remove(ref);
    const before = numbers(w);
    expect(before.size).toBeGreaterThan(60);
    const store = new WorldStore(join(dir, `stability-${seed}.db`), w.reg);
    store.transaction(() => {
      for (const chunk of w.structs.held) store.saveChunk(chunk, w.structs);
    });
    const loaded = flatWorld(4);
    expect(store.loadChunks(loaded.structs)).toBe(w.structs.count);
    store.close();
    expect(sorted(numbers(loaded))).toEqual(sorted(before));
    expect([...before.values()].some((v) => v < 1)).toBe(true);
  }
});

test("the top of a tower of 30 storeys is asked about in work that grows with its height and no faster; its foot in no more than a hut's", () => {
  const tower = (storeys: number) => {
    const { w, support, join, foundation } = setup(0);
    let tile = foundation(100, 100);
    let first = -1;
    let top = first;
    for (let storey = 0; storey < storeys; storey++) {
      const walls = [0, 1, 2, 3].map((k) => join(tile, "wall", k));
      if (storey === 0) first = walls[0]!;
      top = walls[0]!;
      tile = join(walls[0]!, "ceiling", 1);
    }
    const ask = (ref: number): number => {
      support.work = 0;
      expect(support.stability(ref)).toBeGreaterThan(0);
      return support.work;
    };
    return { w, floor: ask(tile), wall: ask(top), foot: ask(first), visited: (support.stability(tile), support.visited) };
  };
  const [hut, mid, tall] = [tower(1), tower(15), tower(30)];
  expect(tall.w.structs.count).toBe(1 + 30 * 5);
  // A question goes down one column: a piece a storey, not the tower's 150.
  expect(tall.visited).toBeLessThan(40);
  expect(tall.floor).toBeLessThan(1000);
  expect(tall.floor - mid.floor).toBeLessThan(mid.floor - hut.floor + 60);
  expect(tall.wall).toBeLessThan(tall.floor);
  expect(tall.foot).toBe(hut.foot);
});

test("pieces of every material have the same numbers, and a material that says a higher one reaches further", () => {
  const tiers = ["wood", "stone", "metal", "thatch"];
  const deck = (w: TestWorld, tier: (k: number) => string): number[] => {
    const { join, pillar, s } = setup(0, w);
    const floor = [join(pillar(100, 100, "stone"), "ceiling", 0, tier(0))];
    for (let k = 0; k < 4; k++) floor.push(join(floor[k]!, "ceiling", 1, tier(k + 1)));
    return floor.map(s);
  };
  expect(deck(flatWorld(4), (k) => tiers[k % 4]!)).toEqual([4, 2, 0, -1, -1]);
  // The same content with metal at 6: metal goes three out, and wood on the end of it is no further out than wood goes.
  const { registry, errors } = compileContent(CORE_CONTENT.map((d) => (d.type === "material" && d.id === "core:mat_metal" ? { ...d, stability: 6 } : d)));
  expect(errors).toEqual([]);
  const strong = registry as Registry;
  const world = (): TestWorld => wrap(flatWorld(4).dims, flatWorld(4).hf, strong);
  expect(deck(world(), () => "metal")).toEqual([6, 4, 2, 0, -1]);
  expect(deck(world(), () => "wood")).toEqual([4, 2, 0, -1, -1]);
  expect(deck(world(), (k) => (k < 2 ? "metal" : "wood"))).toEqual([6, 4, 0, -1, -1]);
  expect(deck(world(), (k) => (k < 2 ? "wood" : "metal"))).toEqual([4, 2, 2, 0, -1]);
  expect(coreRegistry().stabilityCap[coreRegistry().index.get("core:wall_metal")!]).toBe(4);
});

/** Removes `victim` and works the collapse out. Returns the refs that fell. */
function felled(w: TestWorld, victim: number): number[] {
  const collapse = new Collapse(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
  const fell: number[] = [];
  w.structs.onRemove = (ref, cause) => {
    if (cause !== GONE_FELL) collapse.gone(ref);
    else fell.push(ref);
  };
  w.structs.remove(victim);
  for (let k = 0; collapse.busy && k < 10000; k++) collapse.step(16000, k + 1);
  expect(collapse.busy).toBe(false);
  w.structs.onRemove = null;
  return fell.sort((a, b) => a - b);
}

test("what would fall with a piece is what falls when it is removed, things on the floors too, and nothing is changed by asking", () => {
  let fellInAll = 0;
  let most = 0;
  for (let seed = 1; seed <= 3; seed++) {
    const make = (): { w: TestWorld; built: number[] } => {
      const w = flatWorld(4);
      const built = ramble(w, new Rng(seed + 40), 500);
      // A storage box in the middle of every third floor.
      const box = w.kind("core:storage_box");
      for (const ref of built) {
        const t = w.structs.chunks[Math.floor(ref / 65536)]!;
        const slot = ref & 0xffff;
        if (t.kind[slot] === w.kind("core:ceiling_wood") && ref % 3 === 0) w.structs.add(box, t.x[slot]!, t.y[slot]! + FLOOR_THICK / 2 + w.reg.halfY[box]!, t.z[slot]!, 0, 3, 100);
      }
      return { w, built };
    };
    const first = make();
    const rng = new Rng(seed * 101);
    const victims = [first.built[0]!, ...first.built.filter(() => rng.int(12) === 0)];
    for (const victim of victims) {
      const { w } = make();
      const support = new Support(w.structs, w.reg, (x, z) => w.hf.heightAt(x, z));
      const out = new Uint32Array(FALL_MOST);
      const rows = refsOf(w).join();
      const n = support.wouldFall(victim, out);
      expect(refsOf(w).join()).toBe(rows);
      expect(n).toBeLessThan(FALL_MOST);
      const said = Array.from(out.subarray(0, n)).sort((a, b) => a - b);
      expect([victim, said]).toEqual([victim, felled(w, victim)]);
      fellInAll += n;
      most = Math.max(most, n);
    }
  }
  expect(fellInAll).toBeGreaterThan(100);
  expect(most).toBeGreaterThan(30);
});

test("what would fall is listed up to 256 pieces and no further", () => {
  const { w, support, join, foundation } = setup(0);
  const f = foundation(100, 100);
  let tile = f;
  for (let storey = 0; storey < 60; storey++) {
    const walls = [0, 1, 2, 3].map((k) => join(tile, "wall", k));
    tile = join(walls[0]!, "ceiling", 1);
  }
  const out = new Uint32Array(400);
  expect(support.wouldFall(f, out)).toBe(FALL_MOST);
  const said = new Set(out.subarray(0, FALL_MOST));
  expect([said.size, said.has(f), FALL_MOST]).toEqual([256, false, 256]);
  expect(support.wouldFall(tile, out)).toBe(0);
  expect(support.wouldFall(f, out.subarray(0, 10))).toBe(10);
  expect(felled(w, f).length).toBe(300);
});
