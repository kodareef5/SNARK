// Hips and saddles laid between roofs (client/core/render/trims.ts): a hip on a sloped side two roofs share where
// neither face rises from it and they are not in one plane, drawn once, +X up the slope; a saddle on the high corner
// hips end at, drawn once. On bases at yaw 0 and at an odd yaw, on pieces turned 30 and 60 degrees, and where four
// chunks meet. Stand-in solids mark each trim's ends.

import { expect, test } from "bun:test";
import type { Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { SourceLod } from "../../tools/pack/write.ts";
import { worldOf } from "../../shared/world/lattice/basis.ts";
import { riseAt, type Frame } from "../../shared/world/lattice/frames.ts";
import { CLS_SQUARE, CLS_TRIANGLE, SIDE as LATTICE_SIDE, canon, canonical, dirTurn, elementCorners, key0, key1, keyAnchor, keyDir, tupleStep } from "../../shared/world/lattice/module.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import { unpackMeshes, type SourceMesh } from "../../tools/pack/write.ts";
import { JointBench, SIDE, piecesPack } from "../../tools/pieces/joints.ts";
import { TEAM, baseAt, drawn, prism, standInSides, standInTrims, turnedBy, type Drawn } from "../fixtures/trims.ts";

const DIMS = { chunksX: 8, chunksZ: 8 };
/** The base's level the roofs are at, and the height of their tops over the base's level 0 at a low and a high corner. */
const LVL = 4;
const LOW_TOP = 3 + 0.25, HIGH_TOP = 3 + 0.25 + 1.5;

/** Two solids as one level. */
function joined(a: SourceLod, b: SourceLod): SourceLod {
  const n = a.positions.length / 3;
  return { positions: Float32Array.from([...a.positions, ...b.positions]), colors: Uint8Array.from([...a.colors, ...b.colors]), indices: Uint32Array.from([...a.indices, ...Array.from(b.indices, (v) => v + n)]) };
}

/** A cube 2 cm across about (x, y, z) of a trim's frame. */
const dot = (x: number, y: number, z: number): SourceLod => prism([[x - 0.01, z - 0.01], [x + 0.01, z - 0.01], [x + 0.01, z + 0.01], [x - 0.01, z + 0.01]], y - 0.01, y + 0.01);

/** A hip marked at its two ends on its line, low at -X and high at +X, and a saddle marked at its corner. */
export function standInHips(tier: string): SourceMesh[] {
  return [
    { id: `core:hip_${tier}`, lods: [joined(dot(1.5, 0.75, 0), dot(-1.5, -0.75, 0))] },
    { id: `core:saddle_${tier}`, lods: [dot(0, 0, 0)] },
  ];
}

const middle = (d: Drawn, from: number): number[] => [0, 1, 2].map((k) => {
  let sum = 0;
  for (let v = 0; v < 8; v++) sum += d.points[(from + v) * 3 + k]!;
  return sum / 8;
});
/** A hip's high end and low end, x, y, z each, and a saddle's corner. */
const ends = (d: Drawn): number[][] => [middle(d, 0), middle(d, 8)];

interface Base {
  f: Frame;
}

/** The world (x, z) of the lattice point `t` of base `f`. */
function world(f: Frame, t: readonly number[]): [number, number] {
  const at = new Int32Array(2);
  worldOf(f.basis, f.ox, f.oz, Int32Array.from(t), 0, at, 0);
  return [at[0]! / STRUCT_UNITS, at[1]! / STRUCT_UNITS];
}

/** The lattice point `n` sides from `t` along way `d`. */
function step(t: readonly number[], d: number, n = 1): number[] {
  const m = Int32Array.from([...t, 0, 0, 0, 0]);
  tupleStep(m, 0, d, n * LATTICE_SIDE, m, 4);
  return Array.from(m.subarray(4, 8));
}

/**
 * Sets a roof down on the face named from corner `a` along `d`, turned so that each lattice point of `high` is a corner
 * where it rises most, and each of `low` one where it rises least. Returns its ref.
 */
function roof(structs: StructureStore, reg: Registry, f: Frame, id: string, cls: number, a: readonly number[], d: number, high: readonly (readonly number[])[], low: readonly (readonly number[])[] = [], lvl = LVL): number {
  const kind = reg.index.get(id)!;
  const m = new Int32Array(24);
  m.set(a);
  canonical(cls, m, 0, dirTurn(d, 0), m, 4);
  const k0 = key0(cls, m[4]!, m[5]!, m[6]!);
  for (let rot = 0; rot < reg.forms.turns[kind]!; rot++) {
    const k1 = key1(m[7]!, lvl, canon.dir, reg.forms.layer[kind]!, rot, 0);
    const rise = riseAt(reg.forms, kind, k0, k1);
    keyAnchor(k0, k1, m, 8);
    const n = elementCorners(cls, m, 8, keyDir(k1), m, 8);
    const rises = Array.from({ length: n }, (_, c) => (rise >> (3 * c)) & 7);
    const corners = Array.from({ length: n }, (_, c) => world(f, Array.from(m.subarray(8 + 4 * c, 12 + 4 * c))));
    const riseOf = (t: readonly number[]): number => {
      const w = world(f, t);
      const c = corners.findIndex((q) => Math.hypot(q[0] - w[0], q[1] - w[1]) < 1e-3);
      return c < 0 ? -1 : rises[c]!;
    };
    if (!high.every((t) => riseOf(t) === Math.max(...rises)) || !low.every((t) => riseOf(t) === Math.min(...rises))) continue;
    const ref = structs.place(kind, f.gid, k0, k1, TEAM, reg.maxHp[kind]!);
    if (ref < 0) throw new Error(`${id} does not fit along ${d}`);
    return ref;
  }
  throw new Error(`${id} along ${d} has no turn with those rises at those corners`);
}

/** A world `lay` fills, drawn once so that its chunks are laid out: its trims as drawn. */
function laid(art: readonly SourceMesh[], lay: (structs: StructureStore, reg: Registry, base: (yaw: number, edge?: boolean) => Base) => void): Drawn[] {
  const pack = piecesPack(art);
  let bases = 0, edges = 0;
  const bench = new JointBench(pack, [], SIDE, (structs, reg) => {
    lay(structs, reg, (yaw, edge = false) => {
      const n = edge ? edges++ : bases++;
      const [x, z] = edge ? [64 * (1 + (n % 7)), 64 * (1 + Math.floor(n / 7))] : [24 + 64 * (n % 8), 24 + 64 * Math.floor(n / 8)];
      return { f: baseAt(structs, x, 3, z, yaw) };
    });
  });
  bench.draw({ vertex: [64, 64] }, 1.5, 30, 20);
  return drawn(bench.scene, DIMS, pack, new Map(unpackMeshes(pack).map((m) => [m.id, m] as const))).filter((d) => d.trim);
}

const r2 = (v: number): number => Math.round(v * 100) / 100 || 0;
const near = (all: readonly Drawn[], x: number, z: number, reach = 6): Drawn[] => all.filter((d) => Math.hypot((d.lo[0]! + d.hi[0]!) / 2 - x, (d.lo[2]! + d.hi[2]!) / 2 - z) < reach);
/** The hips about (x, z): each its high end's and its low end's place over the base's level 0, from (x, z), rounded and sorted. */
const hipsAt = (all: readonly Drawn[], x: number, z: number, tier = "wood"): number[][] =>
  near(all, x, z).filter((d) => d.id === `core:hip_${tier}`).map((d) => ends(d).flatMap((p) => [r2(p[0]! - x), r2(p[1]! - 3), r2(p[2]! - z)])).sort((a, b) => a.join().localeCompare(b.join()));
const saddlesAt = (all: readonly Drawn[], x: number, z: number, tier = "wood"): number[][] =>
  near(all, x, z).filter((d) => d.id === `core:saddle_${tier}`).map((d) => [r2(middle(d, 0)[0]! - x), r2(middle(d, 0)[1]! - 3), r2(middle(d, 0)[2]! - z)]);

const ART = (tiers: readonly string[]): SourceMesh[] => tiers.flatMap((tier) => [...standInTrims(tier), ...standInSides(tier), ...(tier === "thatch" ? [] : standInHips(tier))]);
const O = [0, 0, 0, 0];

/** Where a hip from `high` down to `low` is expected, as `hipsAt` lists it. */
const hipFrom = (f: Frame, v: readonly number[], high: readonly number[], low: readonly number[]): number[] => {
  const [vx, vz] = world(f, v), [hx, hz] = world(f, high), [lx, lz] = world(f, low);
  return [r2(hx - vx), HIGH_TOP, r2(hz - vz), r2(lx - vx), LOW_TOP, r2(lz - vz)];
};
const sorted = (rows: number[][]): number[][] => rows.sort((a, b) => a.join().localeCompare(b.join()));

for (const [yaw, edge, where] of [[0, false, "at yaw 0"], [turnedBy(5003).yaw, false, "at an odd yaw"], [turnedBy(17000).yaw, true, "at an odd yaw where four chunks meet"]] as const) {
  test(`six triangles round a corner take six hips and one saddle there, turned 0 or 30 degrees, ${where}`, () => {
    const b: Record<string, Frame> = {};
    const all = laid(ART(["wood"]), (structs, reg, base) => {
      for (const turn of [0, 1]) {
        const f = (b[turn] = base(yaw, edge && turn === 0).f);
        for (let k = 0; k < 6; k++) roof(structs, reg, f, "core:triangle_roof_wood", CLS_TRIANGLE, O, 2 * k + turn, [O]);
      }
    });
    for (const turn of [0, 1]) {
      const f = b[turn]!, [x, z] = world(f, O);
      const want = sorted(Array.from({ length: 6 }, (_, k) => hipFrom(f, O, O, step(O, 2 * k + turn))));
      expect(hipsAt(all, x, z), `turned ${30 * turn}`).toEqual(want);
      expect(saddlesAt(all, x, z), `turned ${30 * turn}`).toEqual([[0, HIGH_TOP, 0]]);
    }
  });

  test(`a ridge's end hipped with three triangles takes four hips and a saddle at the ridge's end, ${where}`, () => {
    const b: Record<string, Frame> = {};
    const all = laid(ART(["wood"]), (structs, reg, base) => {
      const f = (b.end = base(yaw, edge).f);
      // Two slopes to a ridge along +X, from the base's corner to Q a side on.
      const q = step(O, 0);
      roof(structs, reg, f, "core:roof_wood", CLS_SQUARE, step(O, 9), 0, [O, q]);
      roof(structs, reg, f, "core:roof_wood", CLS_SQUARE, O, 0, [O, q]);
      // Round Q from its south to its north, three triangles high there.
      for (const d of [9, 11, 1]) roof(structs, reg, f, "core:triangle_roof_wood", CLS_TRIANGLE, q, d, [q]);
    });
    const f = b.end!, q = step(O, 0), [x, z] = world(f, q);
    expect(hipsAt(all, x, z)).toEqual(sorted([9, 11, 1, 3].map((d) => hipFrom(f, q, q, step(q, d)))));
    expect(saddlesAt(all, x, z)).toEqual([[0, HIGH_TOP, 0]]);
    expect(near(all, x, z).filter((d) => d.id === "core:ridge_wood").length).toBe(1);
  });

  test(`two faces turned 30 or 60 degrees take a hip where both fall away from their side, ${where}`, () => {
    const b: Record<string, Frame> = {};
    const all = laid(ART(["wood"]), (structs, reg, base) => {
      // Two triangles round a bay, a pair of each turn.
      for (const d of [0, 1, 2]) {
        const f = (b[`bay${d}`] = base(yaw).f);
        roof(structs, reg, f, "core:triangle_roof_wood", CLS_TRIANGLE, O, d, [O]);
        roof(structs, reg, f, "core:triangle_roof_wood", CLS_TRIANGLE, O, d + 2, [O]);
      }
      // A slope turned 30 degrees and a triangle on its sloped side, high at its high corner.
      const f = (b.crease = base(yaw).f);
      roof(structs, reg, f, "core:roof_wood", CLS_SQUARE, O, 1, [O, step(O, 4)]);
      roof(structs, reg, f, "core:triangle_roof_wood", CLS_TRIANGLE, O, 11, [O]);
    });
    for (const d of [0, 1, 2]) {
      const f = b[`bay${d}`]!, [x, z] = world(f, O);
      expect(hipsAt(all, x, z), `bay turned ${30 * d}`).toEqual([hipFrom(f, O, O, step(O, d + 2))]);
      expect(saddlesAt(all, x, z), `bay turned ${30 * d}`).toEqual([[0, HIGH_TOP, 0]]);
    }
    const f = b.crease!, [x, z] = world(f, O);
    expect(hipsAt(all, x, z)).toEqual([hipFrom(f, O, O, step(O, 1))]);
    expect(saddlesAt(all, x, z)).toEqual([[0, HIGH_TOP, 0]]);
  });
}

test("no hip where faces meet in one plane, in a valley, off their level, or over a step", () => {
  const b: Record<string, Frame> = {};
  const all = laid(ART(["wood"]), (structs, reg, base) => {
    // A valley: two triangles low at their shared corner.
    let f = (b.valley = base(turnedBy(5003).yaw).f);
    roof(structs, reg, f, "core:triangle_roof_low_wood", CLS_TRIANGLE, O, 0, [], [O]);
    roof(structs, reg, f, "core:triangle_roof_low_wood", CLS_TRIANGLE, O, 2, [], [O]);
    // One plane: a triangle high at the corner and the low triangle beside it, high there too.
    f = b.plane = base(0).f;
    roof(structs, reg, f, "core:triangle_roof_wood", CLS_TRIANGLE, O, 0, [O]);
    roof(structs, reg, f, "core:triangle_roof_low_wood", CLS_TRIANGLE, O, 2, [O], [step(O, 2)]);
    // Squares in one plane: two slopes side by side, and a slope and the hip that ends it.
    f = b.squares = base(0).f;
    roof(structs, reg, f, "core:roof_wood", CLS_SQUARE, O, 0, [step(O, 3), step(step(O, 3), 0)]);
    roof(structs, reg, f, "core:roof_wood", CLS_SQUARE, step(O, 0), 0, [step(step(O, 0), 3), step(step(O, 0, 2), 3)]);
    roof(structs, reg, f, "core:roof_hip_wood", CLS_SQUARE, step(O, 0, 2), 0, [step(step(O, 0, 2), 3)]);
    // Two triangles a storey apart, and two whose shared side runs high to low against low to high.
    f = b.apart = base(0).f;
    roof(structs, reg, f, "core:triangle_roof_wood", CLS_TRIANGLE, O, 0, [O]);
    roof(structs, reg, f, "core:triangle_roof_wood", CLS_TRIANGLE, O, 2, [O], [], LVL + 4);
    f = b.step = base(0).f;
    roof(structs, reg, f, "core:triangle_roof_wood", CLS_TRIANGLE, O, 0, [O]);
    roof(structs, reg, f, "core:triangle_roof_wood", CLS_TRIANGLE, O, 2, [step(O, 2)]);
  });
  for (const name of ["valley", "plane", "squares", "apart", "step"]) {
    const [x, z] = world(b[name]!, O);
    expect([name, near(all, x, z, 8).filter((d) => d.id.includes("hip") || d.id.includes("saddle")).length]).toEqual([name, 0]);
  }
});

test("a hip between tiers is drawn once, by the roof whose tier has one", () => {
  const b: Record<string, Frame> = {};
  const all = laid(ART(["wood", "thatch", "stone"]), (structs, reg, base) => {
    // A thatch slope and a wood triangle on its sloped side, each laid first; and a stone pair, which draws its own.
    for (const first of ["thatch", "wood"]) {
      const f = (b[first] = base(0).f);
      const put = (tier: string): number => (tier === "thatch" ? roof(structs, reg, f, "core:roof_thatch", CLS_SQUARE, O, 0, [O, step(O, 3)]) : roof(structs, reg, f, "core:triangle_roof_wood", CLS_TRIANGLE, O, 10, [O]));
      put(first);
      put(first === "thatch" ? "wood" : "thatch");
    }
    const f = (b.stone = base(0).f);
    roof(structs, reg, f, "core:triangle_roof_stone", CLS_TRIANGLE, O, 0, [O]);
    roof(structs, reg, f, "core:triangle_roof_wood", CLS_TRIANGLE, O, 2, [O]);
  });
  for (const first of ["thatch", "wood"]) {
    const [x, z] = world(b[first]!, O);
    expect(near(all, x, z).filter((d) => d.id.includes("hip")).map((d) => d.id), first).toEqual(["core:hip_wood"]);
    expect(near(all, x, z).filter((d) => d.id.includes("saddle")).map((d) => d.id), first).toEqual(["core:saddle_wood"]);
  }
  const [x, z] = world(b.stone!, O);
  expect(near(all, x, z).filter((d) => d.id.includes("hip") || d.id.includes("saddle")).length).toBe(2);
});
