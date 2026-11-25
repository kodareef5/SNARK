// Trims round the shapes past the first nine (client/core/render/trims.ts): a sloped wall's joint by its height at each
// end, a piece over two edges or four storeys, low walls and rails, footings, roofs, and the skirts, eaves and ridges
// laid along a slab's sides with their ends turned to the corner. Stand-in solids take the place of a tier's trims.

import { expect, test } from "bun:test";
import { FIT_ENDS, FIT_YIELD, PIECE_END_IN, PIECE_END_SHIFT, PIECE_FIT_AT, PIECE_STATE_AT } from "../../client/core/render/piece-fit.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Frame } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, CLS_VERTEX } from "../../shared/world/lattice/module.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import { unpackMeshes, type SourceMesh } from "../../tools/pack/write.ts";
import { JointBench, SIDE, piecesPack } from "../../tools/pieces/joints.ts";
import { baseAt, drawn, prism, putAt, putOwn, round, standInSides, standInTrims, type Drawn } from "../fixtures/trims.ts";

const DIMS = { chunksX: 8, chunksZ: 8 };
const O = [0, 0, 0, 0];
/** The corner `i` sides along +X and `j` along +Z from a base's own. */
const at = (i: number, j: number): number[] => [2 * i, 0, 0, 2 * j];

/** A base's own corner in the world, and the base. */
interface Base {
  x: number;
  z: number;
  f: Frame;
}

interface Laying {
  structs: StructureStore;
  reg: Registry;
  /** A base of its own, well inside a chunk, or with its corner where four chunks meet. */
  base: (edge?: boolean) => Base;
}

/** A world `lay` fills, drawn once so that its chunks are laid out: every instance of it as drawn. */
function laid(art: readonly SourceMesh[], lay: (to: Laying) => void): Drawn[] {
  const pack = piecesPack(art);
  let bases = 0, edges = 0;
  const bench = new JointBench(pack, [], SIDE, (structs, reg) => {
    lay({
      structs, reg,
      base: (edge = false) => {
        const n = edge ? edges++ : bases++;
        const [x, z] = edge ? [64 * (1 + (n % 7)), 64 * (1 + Math.floor(n / 7))] : [24 + 64 * (n % 8), 24 + 64 * Math.floor(n / 8)];
        return { x, z, f: baseAt(structs, x, 3, z, 0) };
      },
    });
  });
  bench.draw({ vertex: [64, 64] }, 1.5, 30, 20);
  return drawn(bench.scene, DIMS, pack, new Map(unpackMeshes(pack).map((m) => [m.id, m] as const)));
}

const r2 = (v: number): number => Math.round(v * 100) / 100 || 0;
/** The trims whose middle is within `reach` of (x, z): each its mesh's name and the heights it stands between over the base's level 0. */
const trimsAt = (all: readonly Drawn[], x: number, z: number, reach = 0.5): [string, number, number][] =>
  round(all, x, z, reach).filter((d) => d.trim && Math.hypot((d.lo[0]! + d.hi[0]!) / 2 - x, (d.lo[2]! + d.hi[2]!) / 2 - z) < reach).map((d): [string, number, number] => [d.id.slice(5), r2(d.lo[1]! - 3), r2(d.hi[1]! - 3)]).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
const yieldOf = (all: readonly Drawn[], ref: number): number => all.find((d) => d.ref === ref && !d.trim)!.bytes[PIECE_FIT_AT]! & FIT_YIELD;
/** A side trim's turns: its -X end's and its +X end's, 0 for an end left as its mesh has it. */
const turnsOf = (d: Drawn): [number, number] => [(d.bytes[PIECE_FIT_AT]! & FIT_ENDS) !== 0 ? d.bytes[PIECE_FIT_AT]! & FIT_YIELD : 0, (d.bytes[PIECE_STATE_AT]! >> PIECE_END_SHIFT) & 15];

for (const edge of [false, true]) {
  const where = edge ? " where four chunks meet" : "";
  test(`a sloped wall has a joint at its high end alone, as high as it stands there${where}`, () => {
    const refs: Record<string, number> = {};
    const b: Record<string, Base> = {};
    const all = laid(standInTrims("wood"), ({ structs, reg, base }) => {
      // Alone: high at its own -X end, which is the base's corner.
      const alone = (b.alone = base(edge));
      refs.alone = putAt(structs, reg, alone.f, "core:sloped_wall_left_wood", CLS_EDGE, O, 0, 4);
      // A gable over a wall, its low end at a corner where a wall of the storey above ends too.
      const low = (b.low = base(edge));
      refs.low = putAt(structs, reg, low.f, "core:sloped_wall_right_wood", CLS_EDGE, O, 6, 4);
      refs.beside = putAt(structs, reg, low.f, "core:wall_wood", CLS_EDGE, O, 3, 4);
      // Two gables' high ends at the ridge, over the walls of a gable end.
      const ridge = (b.ridge = base(edge));
      refs.left = putAt(structs, reg, ridge.f, "core:sloped_wall_left_wood", CLS_EDGE, O, 3, 4);
      refs.right = putAt(structs, reg, ridge.f, "core:sloped_wall_right_wood", CLS_EDGE, O, 9, 4);
      putAt(structs, reg, ridge.f, "core:wall_wood", CLS_EDGE, O, 3, 0);
      putAt(structs, reg, ridge.f, "core:wall_wood", CLS_EDGE, O, 9, 0);
    });
    // A joint half a storey high where it is high, none where it comes to nothing, and only the high end gives way.
    expect(trimsAt(all, b.alone!.x, b.alone!.z)).toEqual([["joint_sq_wood", 3, 4.51]]);
    expect(trimsAt(all, b.alone!.x + 3, b.alone!.z)).toEqual([]);
    expect(yieldOf(all, refs.alone!)).toBe(1);
    // The wall beside a low end has its own joint, a storey high, and the gable neither counts there nor gives way.
    expect(trimsAt(all, b.low!.x, b.low!.z)).toEqual([["joint_sq_wood", 3, 6.01]]);
    expect([yieldOf(all, refs.low!) & 1, yieldOf(all, refs.beside!) & 1]).toEqual([0, 1]);
    // At the ridge the walls' joint under, and one over it to the gables' heads: the roof's underside there.
    expect(trimsAt(all, b.ridge!.x, b.ridge!.z)).toEqual([["joint_sq_wood", 0, 3.01], ["joint_sq_wood", 3, 4.51]]);
    expect(trimsAt(all, b.ridge!.x, b.ridge!.z + 3).filter((t) => t[1] === 3)).toEqual([]);
    expect([yieldOf(all, refs.left!), yieldOf(all, refs.right!)]).toEqual([1, 2]);
  });

  test(`a piece over two edges has joints at its two ends alone, and a wall that ends at its middle its own${where}`, () => {
    const refs: Record<string, number> = {};
    const b: Record<string, Base> = {};
    const all = laid(standInTrims("wood"), ({ structs, reg, base }) => {
      const door = (b.door = base(edge));
      refs.door = putAt(structs, reg, door.f, "core:double_doorway_wood", CLS_EDGE, at(-1, 0), 0, 0);
      const met = (b.met = base(edge));
      refs.gate = putAt(structs, reg, met.f, "core:gateway_wood", CLS_EDGE, at(-1, 0), 0, 0);
      refs.half = putAt(structs, reg, met.f, "core:half_wall_wood", CLS_EDGE, O, 3, 0);
    });
    expect(trimsAt(all, b.door!.x, b.door!.z)).toEqual([]);
    expect([trimsAt(all, b.door!.x - 3, b.door!.z), trimsAt(all, b.door!.x + 3, b.door!.z)]).toEqual([[["joint_sq_wood", 0, 3.01]], [["joint_sq_wood", 0, 3.01]]]);
    expect(yieldOf(all, refs.door!)).toBe(3);
    // The half wall's end is closed by a joint as high as itself, on the gateway's face: the gateway's two storeys give none there.
    expect(trimsAt(all, b.met!.x, b.met!.z)).toEqual([["joint_sq_wood", 0, 1.51]]);
    expect(yieldOf(all, refs.half!) & 1).toBe(1);
    expect(trimsAt(all, b.met!.x - 3, b.met!.z)).toEqual([["joint_sq_wood", 0, 3.01], ["joint_sq_wood", 3, 6.01]]);
  });

  test(`a wall four storeys high has a joint a storey, and a run of unlike walls is no run${where}`, () => {
    const refs: Record<string, number> = {};
    const b: Record<string, Base> = {};
    const all = laid([...standInTrims("wood"), ...standInTrims("metal")], ({ structs, reg, base }) => {
      const wood = (b.wood = base(edge));
      refs.tall = putAt(structs, reg, wood.f, "core:large_wall_wood", CLS_EDGE, O, 0, 0);
      refs.low = putAt(structs, reg, wood.f, "core:wall_wood", CLS_EDGE, O, 3, 0);
      // Metal runs on between walls alike: not between a wall and a tall one, which gives way up its whole end.
      const unlike = (b.unlike = base(edge));
      refs.metalTall = putAt(structs, reg, unlike.f, "core:large_wall_metal", CLS_EDGE, O, 0, 0);
      refs.metalLow = putAt(structs, reg, unlike.f, "core:wall_metal", CLS_EDGE, O, 6, 0);
      const posted = (b.post = base(edge));
      refs.posted = putAt(structs, reg, posted.f, "core:large_wall_wood", CLS_EDGE, O, 0, 0);
      putAt(structs, reg, posted.f, "core:pillar_wood", CLS_VERTEX, O, 0, 0);
      const alike = (b.alike = base(edge));
      refs.a = putAt(structs, reg, alike.f, "core:large_wall_metal", CLS_EDGE, O, 0, 0);
      refs.b = putAt(structs, reg, alike.f, "core:large_wall_metal", CLS_EDGE, O, 6, 0);
    });
    // With a joint at every storey its end gives way; with a pillar for the lowest storey's, it does not, and no slit opens by the pillar.
    expect(trimsAt(all, b.post!.x, b.post!.z).map((t) => t[1])).toEqual([3, 6, 9]);
    expect([yieldOf(all, refs.posted!) & 1, yieldOf(all, refs.posted!) & 2]).toEqual([0, 2]);
    const stack = [0, 1, 2, 3].map((k): [string, number, number] => ["joint_sq_wood", 3 * k, 3 * k + 3.01]);
    expect(trimsAt(all, b.wood!.x, b.wood!.z)).toEqual(stack);
    expect(trimsAt(all, b.wood!.x + 3, b.wood!.z)).toEqual(stack);
    expect([yieldOf(all, refs.tall!), yieldOf(all, refs.low!)]).toEqual([3, 3]);
    expect(trimsAt(all, b.unlike!.x, b.unlike!.z).map((t) => t[1])).toEqual([0, 3, 6, 9]);
    expect([yieldOf(all, refs.metalTall!) & 1, yieldOf(all, refs.metalLow!) & 1]).toEqual([1, 1]);
    expect(trimsAt(all, b.alike!.x, b.alike!.z)).toEqual([]);
    expect([yieldOf(all, refs.a!) & 1, yieldOf(all, refs.b!) & 1]).toEqual([0, 0]);
  });

  test(`a joint is as high as the tallest wall at its corner, and a rail or a beam takes none${where}`, () => {
    const refs: Record<string, number> = {};
    const b: Record<string, Base> = {};
    const all = laid(standInTrims("wood"), ({ structs, reg, base }) => {
      const put = (name: string, f: Frame, id: string, d: number, lvl = 0): void => void (refs[name] = putAt(structs, reg, f, `core:${id}_wood`, CLS_EDGE, O, d, lvl));
      put("half", (b.mixed = base(edge)).f, "half_wall", 0);
      put("full", b.mixed.f, "wall", 3);
      put("q0", (b.quarter = base(edge)).f, "quarter_wall", 0);
      put("q1", b.quarter.f, "quarter_wall", 3);
      put("r0", (b.rails = base(edge)).f, "railing", 0);
      put("r1", b.rails.f, "railing", 3);
      put("beam", (b.beam = base(edge)).f, "beam", 0, 3);
      put("rail", (b.by = base(edge)).f, "railing", 0);
      put("wall", b.by.f, "wall", 3);
      put("on", (b.fence = base(edge)).f, "wall", 0);
      refs.footing = putAt(structs, reg, b.fence.f, "core:fence_foundation_wood", CLS_EDGE, O, 0, 0);
      putAt(structs, reg, b.fence.f, "core:fence_foundation_wood", CLS_EDGE, O, 3, 0);
    });
    const here = (name: string, dx = 0, dz = 0): [string, number, number][] => trimsAt(all, b[name]!.x + dx, b[name]!.z + dz);
    expect(here("mixed")).toEqual([["joint_sq_wood", 0, 3.01]]);
    expect([yieldOf(all, refs.half!), yieldOf(all, refs.full!)]).toEqual([3, 3]);
    expect(here("mixed", 3)).toEqual([["joint_sq_wood", 0, 1.51]]);
    expect(here("quarter")).toEqual([["joint_sq_wood", 0, 0.76]]);
    // Rails' posts are their own: no joint at their corner or their ends, and neither gives way. A beam the same.
    expect([here("rails"), here("rails", 3), here("rails", 0, 3)]).toEqual([[], [], []]);
    expect([yieldOf(all, refs.r0!), yieldOf(all, refs.r1!)]).toEqual([0, 0]);
    expect([here("beam"), here("beam", 3), yieldOf(all, refs.beam!)]).toEqual([[], [], 0]);
    // Beside a wall, the wall's free end has its joint as ever and the rail runs into it whole.
    expect([here("by"), yieldOf(all, refs.rail!), yieldOf(all, refs.wall!)]).toEqual([[["joint_sq_wood", 0, 3.01]], 0, 3]);
    // A footing is its own plinth: no skirt and no joint of its own, and it gives way nowhere. The wall on it is jointed as any.
    expect([here("fence"), here("fence", 3), here("fence", 0, 3), yieldOf(all, refs.footing!), yieldOf(all, refs.on!)]).toEqual([[["joint_sq_wood", 0, 3.01]], [["joint_sq_wood", 0, 3.01]], [], 0, 3]);
    expect(all.filter((d) => d.trim && d.id.includes("skirt")).length).toBe(0);
  });
}

test("stone and metal run on through a straight run of the new walls alike, and close one of walls unlike", () => {
  const b: Record<string, Base> = {};
  const refs: Record<string, number[]> = {};
  const runs: [string, string, string, boolean][] = [["walls", "wall", "wall", true], ["halves", "half_wall", "half_wall", true], ["quarters", "quarter_wall", "quarter_wall", true], ["doorways", "double_doorway", "double_doorway", true], ["gables", "sloped_wall_left", "sloped_wall_right", true], ["wall by doorway", "wall", "double_doorway", true], ["half by wall", "half_wall", "wall", false], ["quarter by half", "quarter_wall", "half_wall", false]];
  const all = laid(standInTrims("metal"), ({ structs, reg, base }) => {
    for (const [name, one, other] of runs) {
      const at = (b[name] = base());
      // The second ends at the corner the first begins at, its own +X toward it.
      refs[name] = [putAt(structs, reg, at.f, `core:${one}_metal`, CLS_EDGE, O, 0, 0), putAt(structs, reg, at.f, `core:${other}_metal`, CLS_EDGE, [other === "double_doorway" ? -4 : -2, 0, 0, 0], 0, 0)];
    }
  });
  for (const [name, , , runsOn] of runs) {
    expect([name, trimsAt(all, b[name]!.x, b[name]!.z).length], name).toEqual([name, runsOn ? 0 : 1]);
    expect([name, yieldOf(all, refs[name]![0]!) & 1, yieldOf(all, refs[name]![1]!) & 2], name).toEqual([name, runsOn ? 0 : 1, runsOn ? 0 : 2]);
  }
});

test("a roof gives way on no side in any tier, whatever stands under, beside or over it", () => {
  const roofs: [string, number][] = [];
  const ceilings: number[] = [];
  const tiers = ["thatch", "wood", "stone", "metal"];
  const all = laid(tiers.flatMap(standInTrims), ({ structs, reg, base }) => {
    for (const tier of tiers) {
      const own = (name: string): string => `core:${name}_${tier}`;
      for (const form of ["roof", "roof_hip", "roof_valley"]) {
        const { f } = base();
        // Walls under every side, a gable on two, a wall going on up from one, and a roof beyond another.
        for (const [a, d] of [[O, 0], [O, 3], [at(1, 1), 6], [at(1, 1), 9]] as const) putAt(structs, reg, f, own("wall"), CLS_EDGE, a, d, 0);
        putAt(structs, reg, f, own("sloped_wall_left"), CLS_EDGE, O, 3, 4);
        putAt(structs, reg, f, own("sloped_wall_right"), CLS_EDGE, at(1, 0), 3, 4);
        putAt(structs, reg, f, own("wall"), CLS_EDGE, at(0, 1), 0, 4);
        roofs.push([`${tier} ${form}`, putOwn(structs, reg, f, own(form), CLS_SQUARE, O, 0, 4, 0)], [`${tier} roof beside`, putOwn(structs, reg, f, own("roof"), CLS_SQUARE, at(1, 0), 0, 4, 0)]);
      }
      // Thatch has no triangles.
      for (const form of tier === "thatch" ? [] : ["triangle_roof", "triangle_roof_low"]) {
        const { f } = base();
        for (const d of [0, 2]) putAt(structs, reg, f, own("wall"), CLS_EDGE, O, d, 0);
        putAt(structs, reg, f, own("wall"), CLS_EDGE, at(1, 0), 4, 0);
        roofs.push([`${tier} ${form}`, putOwn(structs, reg, f, own(form), CLS_TRIANGLE, O, 0, 4, 0)]);
      }
      // A ceiling over the same walls does give way, so the roofs' zero is the rule's and not the laying's.
      const { f } = base();
      for (const [a, d] of [[O, 0], [O, 3]] as const) putAt(structs, reg, f, own("wall"), CLS_EDGE, a, d, 0);
      ceilings.push(putAt(structs, reg, f, own("ceiling"), CLS_SQUARE, O, 0, 4));
    }
  });
  expect(roofs.length).toBe(4 * 6 + 3 * 2);
  expect(roofs.map(([name, ref]) => [name, yieldOf(all, ref)])).toEqual(roofs.map(([name]) => [name, 0]));
  expect(ceilings.map((ref) => yieldOf(all, ref))).toEqual([12, 12, 12, 12]);
});

test("skirts meet on the plane that halves each corner: outside, inside, and round a triangle", () => {
  const b: Record<string, Base> = {};
  const all = laid(standInTrims("wood"), ({ structs, reg, base }) => {
    putAt(structs, reg, (b.one = base()).f, "core:foundation_wood", CLS_SQUARE, O, 0, 0);
    // An L of three: five outside corners and one inside.
    const ell = (b.ell = base());
    for (const a of [O, at(1, 0), at(0, 1)]) putAt(structs, reg, ell.f, "core:foundation_wood", CLS_SQUARE, a, 0, 0);
    putAt(structs, reg, (b.tri = base()).f, "core:triangle_foundation_wood", CLS_TRIANGLE, O, 0, 0);
    // A square with a triangle on its north side: corners of 150 degrees where they meet, and 60 at the triangle's point.
    const both = (b.both = base());
    putAt(structs, reg, both.f, "core:foundation_wood", CLS_SQUARE, O, 0, 0);
    putAt(structs, reg, both.f, "core:triangle_foundation_wood", CLS_TRIANGLE, at(0, 1), 0, 0);
    // Two squares that share a corner alone: each skirt meets the other square's at an inside corner.
    const pinch = (b.pinch = base());
    putAt(structs, reg, pinch.f, "core:foundation_wood", CLS_SQUARE, O, 0, 0);
    putAt(structs, reg, pinch.f, "core:foundation_wood", CLS_SQUARE, at(1, 1), 0, 0);
  });
  const skirts = (name: string): Drawn[] => round(all, b[name]!.x + 1.5, b[name]!.z + 1.5, 9).filter((d) => d.trim && d.id === "core:skirt_wood");
  const turns = (name: string): string[] => skirts(name).map((d) => turnsOf(d).join()).sort();
  // A square alone: four skirts, each run on by its own thickness at both ends, so the corner's notch is filled and no more.
  expect(turns("one")).toEqual(["3,3", "3,3", "3,3", "3,3"]);
  const box = (list: Drawn[]): number[] => [Math.min(...list.map((d) => d.lo[0]!)), Math.min(...list.map((d) => d.lo[2]!)), Math.max(...list.map((d) => d.hi[0]!)), Math.max(...list.map((d) => d.hi[2]!))];
  const one = b.one!;
  expect(box(skirts("one")).map((v, k) => r2(v - (k % 2 === 0 ? one.x : one.z)))).toEqual([-0.12, -0.12, 3.12, 3.12]);
  for (const d of skirts("one")) expect(r2(Math.max(d.hi[0]! - d.lo[0]!, d.hi[2]! - d.lo[2]!))).toBe(3.24);
  // The L: eight skirts. The two at its inside corner are cut back there (an inside quarter turn), the four ends in its
  // two straight runs are laid square on their sides' ends, and every other end is run on.
  const inside = PIECE_END_IN | 3;
  expect(turns("ell")).toEqual(["6,3", "6,3", "3,6", "3,6", "3,3", "3,3", `${inside},3`, `3,${inside}`].sort());
  // A triangle: three skirts, each end turned a third of a turn.
  expect(turns("tri")).toEqual(["4,4", "4,4", "4,4"]);
  // The square under a triangle: three skirts on the square and two on the triangle; a twelfth where they meet, a third at the point.
  expect(turns("both")).toEqual(["1,3", "1,4", "3,1", "3,3", "4,1"].sort());
  // At a pinch each end meets the other square's skirt across the open quarter: an inside quarter turn.
  expect(turns("pinch").filter((t) => t.includes(String(inside))).length).toBe(4);
  // No point of any skirt lies inside another's foundation: within its outline, under its top.
  for (const d of skirts("ell")) {
    const ell = b.ell!;
    for (let v = 0; v < d.points.length; v += 3) {
      const [x, z] = [d.points[v]! - ell.x, d.points[v + 2]! - ell.z];
      const within = (x0: number, z0: number): boolean => x > x0 + 1e-4 && x < x0 + 3 - 1e-4 && z > z0 + 1e-4 && z < z0 + 3 - 1e-4;
      expect(within(0, 0) || within(3, 0) || within(0, 3)).toBe(false);
    }
  }
});

test("a tier with an eave has one on each open side of a ceiling, and a tier without is as it was", () => {
  const b: Record<string, Base> = {};
  const refs: Record<string, number> = {};
  const all = laid([...standInTrims("wood"), ...standInSides("wood"), ...standInTrims("metal")], ({ structs, reg, base }) => {
    for (const tier of ["wood", "metal"]) {
      // A hut of two cells: walls under the outer sides, a wall going on up from the east side, and a roof beyond the north side of the second.
      const hut = (b[tier] = base());
      for (const i of [0, 1]) {
        refs[`${tier}${i}`] = putAt(structs, reg, hut.f, `core:ceiling_${tier}`, CLS_SQUARE, at(i, 0), 0, 4);
        putAt(structs, reg, hut.f, `core:wall_${tier}`, CLS_EDGE, at(i, 0), 0, 0);
      }
      putAt(structs, reg, hut.f, `core:wall_${tier}`, CLS_EDGE, O, 3, 0);
      putAt(structs, reg, hut.f, `core:wall_${tier}`, CLS_EDGE, at(2, 0), 3, 4);
      putOwn(structs, reg, hut.f, `core:roof_${tier}`, CLS_SQUARE, at(1, 1), 0, 4, 0);
    }
  });
  const eaves = (name: string): Drawn[] => round(all, b[name]!.x + 3, b[name]!.z + 1.5, 9).filter((d) => d.trim && d.id.includes("eave"));
  expect(eaves("metal")).toEqual([]);
  // South of both, west and north of the first: not east, where a wall stands on the edge, nor north of the second, where a roof lies.
  const wood = b.wood!;
  const sides = eaves("wood").map((d) => [r2((d.lo[0]! + d.hi[0]!) / 2 - wood.x), r2((d.lo[2]! + d.hi[2]!) / 2 - wood.z), ...turnsOf(d)]).sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]!);
  // Each hangs a ceiling's depth from its top and stands 0.30 m out. At the south-west and north-west corners two meet
  // on the corner's plane; in the run along the south side they end square, and by the wall and the roof as made.
  expect(eaves("wood").map((d) => [r2(d.lo[1]! - 3), r2(d.hi[1]! - 3)])).toEqual(eaves("wood").map(() => [2.75, 3]));
  expect(sides).toEqual([[-0.15, 1.5, 3, 3], [1.35, -0.15, 6, 3], [1.35, 3.15, 3, 0], [4.5, -0.15, 0, 6]]);
  // The ceilings still give way to the walls under them, with or without an eave.
  expect([yieldOf(all, refs.wood0!), yieldOf(all, refs.wood1!)]).toEqual([yieldOf(all, refs.metal0!), yieldOf(all, refs.metal1!)]);
  expect(yieldOf(all, refs.wood0!)).toBe(12);
});

test("a ridge lies where two roofs' high sides meet, once, at the height of their tops", () => {
  const b: Record<string, Base> = {};
  const all = laid([...standInTrims("wood"), ...standInSides("wood")], ({ structs, reg, base }) => {
    // Two slopes to a ridge along +X, and beside them two hips whose high corners end it.
    const house = (b.house = base());
    putOwn(structs, reg, house.f, "core:roof_wood", CLS_SQUARE, O, 0, 4, 0);
    putOwn(structs, reg, house.f, "core:roof_wood", CLS_SQUARE, at(0, 1), 0, 4, 6);
    putOwn(structs, reg, house.f, "core:roof_hip_wood", CLS_SQUARE, at(1, 0), 0, 4, 0);
    putOwn(structs, reg, house.f, "core:roof_hip_wood", CLS_SQUARE, at(1, 1), 0, 4, 3);
    // A lean-to: one slope, its high side open. And two slopes side by side that fall the same way.
    const lean = (b.lean = base());
    putOwn(structs, reg, lean.f, "core:roof_wood", CLS_SQUARE, O, 0, 4, 0);
    putOwn(structs, reg, lean.f, "core:roof_wood", CLS_SQUARE, at(1, 0), 0, 4, 0);
    // A valley's two high sides each meet a slope's.
    const ell = (b.ell = base());
    putOwn(structs, reg, ell.f, "core:roof_valley_wood", CLS_SQUARE, O, 0, 4, 0);
    putOwn(structs, reg, ell.f, "core:roof_wood", CLS_SQUARE, at(0, 1), 0, 4, 6);
    putOwn(structs, reg, ell.f, "core:roof_wood", CLS_SQUARE, at(-1, 0), 0, 4, 9);
  });
  const ridges = (name: string): number[][] => round(all, b[name]!.x + 1.5, b[name]!.z + 1.5, 9).filter((d) => d.trim && d.id.includes("ridge")).map((d) => [r2((d.lo[0]! + d.hi[0]!) / 2 - b[name]!.x), r2(d.hi[1]! - 3), r2((d.lo[2]! + d.hi[2]!) / 2 - b[name]!.z), r2(d.hi[0]! - d.lo[0]!)]).sort((p, q) => p[0]! - q[0]!);
  // One bar 3 m long over the shared side, its line at the roofs' tops: a storey, the rise and the slab over the level.
  expect(ridges("house")).toEqual([[1.5, 3 + 1.5 + 0.25 + 0.1, 3, 3]]);
  expect(ridges("lean")).toEqual([]);
  expect(ridges("ell").map((r) => [r[0], r[2]])).toEqual([[0, 1.5], [1.5, 3]]);
});

test("a ridge's end is square where the next runs on in line, and left proud where open", () => {
  const b: Record<string, Base> = {};
  // A ridge cap made 2 cm proud of each end, as a mesh must be to stand clear of its roofs' sides.
  const proud = { id: "core:ridge_wood", lods: [prism([[-1.52, -0.2], [1.52, -0.2], [1.52, 0.2], [-1.52, 0.2]], -0.05, 0.1)] };
  const all = laid([...standInTrims("wood"), ...standInSides("wood").filter((m) => m.id !== proud.id), proud], ({ structs, reg, base }) => {
    // Three pairs of slopes in a line: three ridges in a run along +X.
    const long = (b.long = base());
    for (const i of [0, 1, 2]) {
      putOwn(structs, reg, long.f, "core:roof_wood", CLS_SQUARE, at(i, 0), 0, 4, 0);
      putOwn(structs, reg, long.f, "core:roof_wood", CLS_SQUARE, at(i, 1), 0, 4, 6);
    }
    // A pair alone.
    const one = (b.one = base());
    putOwn(structs, reg, one.f, "core:roof_wood", CLS_SQUARE, O, 0, 4, 0);
    putOwn(structs, reg, one.f, "core:roof_wood", CLS_SQUARE, at(0, 1), 0, 4, 6);
  });
  const spans = (name: string): number[][] => round(all, b[name]!.x + 3, b[name]!.z + 3, 9).filter((d) => d.trim && d.id.includes("ridge")).map((d) => [r2(d.lo[0]! - b[name]!.x), r2(d.hi[0]! - b[name]!.x), r2(d.lo[2]! - b[name]!.z), r2(d.hi[2]! - b[name]!.z)]).sort((p, q) => p[0]! - q[0]! || p[2]! - q[2]!);
  // Each meets the next on their shared corner, and the run's two ends stand proud of the roofs.
  expect(spans("long").map((r) => [r[0], r[1]])).toEqual([[-0.02, 3], [3, 6], [6, 9.02]]);
  // A ridge alone is proud at both ends.
  expect(spans("one").map((r) => [r[0], r[1]])).toEqual([[-0.02, 3.02]]);
});
