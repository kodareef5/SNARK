// Trims: the joint the client draws at a corner where walls end, the skirt under a foundation's open side, and what of
// a piece gives way to them (client/core/render/trims.ts). Stand-in solids take the place of a tier's trim meshes.

import { expect, test } from "bun:test";
import { FIT_CLASS_SHIFT, FIT_NONE, FIT_YIELD, PIECE_FIT_AT, PIECE_MADE_AT, PIECE_FRAMED, PIECE_STATE_AT } from "../../client/core/render/piece-fit.ts";
import { materialIndex } from "../../client/core/texgen/layers.ts";
import { FOUNDATION_THICK } from "../../content/building.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_VERTEX } from "../../shared/world/lattice/module.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { COARSE, COARSE_VIEWS, JointBench, SIDE, fightsOf, piecesPack, tierMeshes } from "../../tools/pieces/joints.ts";
import type { Junction, TierName, WallEnd } from "../../tools/pieces/layout.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { JOINT_HALF, baseAt, drawn, layJunction, putAt, round, standInTrims, turnedBy, type Drawn } from "../fixtures/trims.ts";

const DIMS = { chunksX: 8, chunksZ: 8 };
const O = [0, 0, 0, 0];
const wall = (way: number, left: boolean, storey = 0, tier: TierName = "stone", form = "wall"): WallEnd => ({ form, tier, way, left, storey });

/** A bench whose world `lay` fills, drawn once so that its chunks are laid out, and every instance of it as drawn. */
function benchOf(art: Parameters<typeof piecesPack>[0], lay: (structs: StructureStore, reg: Registry) => void): { bench: JointBench; all: () => Drawn[]; structs: StructureStore } {
  const pack = piecesPack(art);
  let held: StructureStore | null = null;
  const bench = new JointBench(pack, [], SIDE, (structs, reg) => {
    held = structs;
    lay(structs, reg);
  });
  const meshes = new Map(unpackMeshes(pack).map((m) => [m.id, m] as const));
  const all = (): Drawn[] => {
    bench.draw({ vertex: [64, 64] }, 1.5, 30, 20);
    return drawn(bench.scene, DIMS, pack, meshes);
  };
  return { bench, all, structs: held! };
}

const trimsAt = (all: readonly Drawn[], x: number, z: number, reach = 0.5): string[] => round(all, x, z, reach).filter((d) => d.trim && Math.hypot((d.lo[0]! + d.hi[0]!) / 2 - x, (d.lo[2]! + d.hi[2]!) / 2 - z) < reach).map((d) => d.id.slice(5)).sort();
const yieldOf = (d: Drawn): number => d.bytes[PIECE_FIT_AT]! & FIT_YIELD;
const pieceOf = (all: readonly Drawn[], ref: number): Drawn => all.find((d) => d.ref === ref && !d.trim)!;

test("with no trim mesh in the pack nothing is laid, no piece yields, and every piece is still drawn as one", () => {
  let ref = -1;
  const { all } = benchOf([], (structs, reg) => {
    const f = baseAt(structs, 64, 0, 64, 0);
    ref = putAt(structs, reg, f, "core:wall_stone", CLS_EDGE, O, 0, 0);
    putAt(structs, reg, f, "core:wall_stone", CLS_EDGE, O, 3, 0);
    putAt(structs, reg, f, "core:foundation_stone", CLS_SQUARE, O, 0, 0);
    putAt(structs, reg, f, "core:ceiling_stone", CLS_SQUARE, O, 0, 4);
  });
  const got = all();
  expect(got.filter((d) => d.trim).length).toBe(0);
  expect(got.map(yieldOf)).toEqual([0, 0, 0, 0]);
  expect(pieceOf(got, ref).bytes[PIECE_STATE_AT]! & PIECE_FRAMED).toBe(PIECE_FRAMED);
});

test("a corner takes the joint its walls' ways ask for, drawn once by the wall on its lowest way", () => {
  // Each case a base of its own: the ways of its walls round the corner, in twelfths of a turn, and the joint there.
  const cases: [string, number[], string[]][] = [
    ["a free end", [0], ["joint_sq_metal"]],
    ["a corner", [0, 3], ["joint_sq_metal"]],
    ["a tee", [0, 3, 6], ["joint_sq_metal"]],
    ["a cross", [0, 3, 6, 9], ["joint_sq_metal"]],
    ["a straight run of a tier that runs on", [0, 6], []],
    ["120 degrees", [0, 4], ["joint_r15_metal"]],
    ["150 degrees", [0, 5], ["joint_r15_metal"]],
    ["60 degrees", [0, 2], ["joint_r21_metal"]],
    ["60 and 120 degrees", [0, 2, 6], ["joint_r21_metal"]],
    ["a corner of walls 30 degrees round", [1, 4], ["joint_sq_metal"]],
  ];
  const walls: number[][] = [], edged: number[][] = [];
  const { all } = benchOf([...standInTrims("metal"), ...standInTrims("wood")], (structs, reg) => {
    cases.forEach(([, ways], k) => {
      const f = baseAt(structs, 40 + k * 16, 0, 40, 0);
      walls.push(ways.map((d) => putAt(structs, reg, f, "core:wall_metal", CLS_EDGE, O, d, 0)));
      // The same again with its corner on the line between two chunks, where its walls may be either's.
      const g = baseAt(structs, 40 + k * 16, 0, 128, 0);
      edged.push(ways.map((d) => putAt(structs, reg, g, "core:wall_metal", CLS_EDGE, O, d, 0)));
    });
    // Wood shows a post in a straight run.
    const f = baseAt(structs, 40, 0, 80, 0);
    walls.push([0, 6].map((d) => putAt(structs, reg, f, "core:wall_wood", CLS_EDGE, O, d, 0)));
  });
  const got = all();
  cases.forEach(([name, ways, want], k) => {
    expect(trimsAt(got, 40 + k * 16, 40), name).toEqual(want);
    // Each wall's end at the corner gives way where a joint stands, and its far end has a square one of its own.
    for (const [i, ref] of walls[k]!.entries()) {
      const d = pieceOf(got, ref);
      expect(yieldOf(d), `${name}, wall ${i}`).toBe(want.length > 0 ? 3 : 2);
      const far = [40 + k * 16 + 3 * Math.cos((ways[i]! * Math.PI) / 6), 40 + 3 * Math.sin((ways[i]! * Math.PI) / 6)];
      expect(trimsAt(got, far[0]!, far[1]!), `${name}, far end ${i}`).toEqual(["joint_sq_metal"]);
    }
    // The joint is its lowest wall's: it carries that wall's slot.
    const joint = round(got, 40 + k * 16, 40, 0.3).find((d) => d.trim);
    if (joint) expect(joint.ref, name).toBe(walls[k]![0]!);
    expect(trimsAt(got, 40 + k * 16, 128), `${name}, across two chunks`).toEqual(want);
    expect(edged[k]!.map((ref) => yieldOf(pieceOf(got, ref))), `${name}, across two chunks`).toEqual(walls[k]!.map((ref) => yieldOf(pieceOf(got, ref))));
    const across = round(got, 40 + k * 16, 128, 0.3).find((d) => d.trim);
    if (across) expect(across.ref, `${name}, across two chunks`).toBe(edged[k]![0]!);
  });
  expect(new Set(edged.flat().map((ref) => Math.floor(ref / 65536))).size).toBeGreaterThan(2);
  expect(trimsAt(got, 40, 80)).toEqual(["joint_sq_wood"]);
  // A square joint is turned with its walls: 30 degrees round, its corner is not where an unturned one's is.
  const turned = round(got, 40 + 9 * 16, 40, 0.3).find((d) => d.trim)!;
  const reach = Math.max(turned.hi[0]! - (40 + 9 * 16), turned.hi[2]! - 40);
  expect(reach).toBeCloseTo(JOINT_HALF * (Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6)), 3);
});

test("a pillar is its corner's joint, a tier with no trims takes none, and the highest tier at a corner gives the joint", () => {
  const refs: Record<string, number> = {};
  const { all } = benchOf(standInTrims("metal"), (structs, reg) => {
    const put = (name: string, f: ReturnType<typeof baseAt>, id: string, d: number): void => void (refs[name] = putAt(structs, reg, f, id, CLS_EDGE, O, d, 0));
    const pillar = baseAt(structs, 40, 0, 40, 0);
    put("by pillar", pillar, "core:wall_metal", 0);
    putAt(structs, reg, pillar, "core:wall_metal", CLS_EDGE, O, 3, 0);
    putAt(structs, reg, pillar, "core:pillar_metal", CLS_VERTEX, O, 0, 0);
    const stone = baseAt(structs, 56, 0, 40, 0);
    put("stone", stone, "core:wall_stone", 0);
    putAt(structs, reg, stone, "core:wall_stone", CLS_EDGE, O, 3, 0);
    const mixed = baseAt(structs, 72, 0, 40, 0);
    put("stone by metal", mixed, "core:wall_stone", 0);
    put("metal by stone", mixed, "core:wall_metal", 3);
    const low = baseAt(structs, 88, 0, 40, 0);
    put("wood by stone", low, "core:wall_wood", 0);
    putAt(structs, reg, low, "core:wall_stone", CLS_EDGE, O, 3, 0);
  });
  const got = all();
  expect(trimsAt(got, 40, 40)).toEqual([]);
  expect(yieldOf(pieceOf(got, refs["by pillar"]!))).toBe(2);
  expect([trimsAt(got, 56, 40), yieldOf(pieceOf(got, refs.stone!))]).toEqual([[], 0]);
  // Metal is the higher tier and has trims: its joint stands, its wall gives way, and the stone wall, whose mesh has no ring, does not.
  expect(trimsAt(got, 72, 40)).toEqual(["joint_sq_metal"]);
  expect([yieldOf(pieceOf(got, refs["stone by metal"]!)), yieldOf(pieceOf(got, refs["metal by stone"]!)) & 1]).toEqual([0, 1]);
  // Stone is the higher there and has none, so no joint stands and nothing gives way.
  expect(trimsAt(got, 88, 40)).toEqual([]);
});

test("a foundation has a skirt on each side no foundation lies beyond, and a ceiling's side yields to the wall under it", () => {
  let ceiling = -1, open = -1;
  const { all } = benchOf(standInTrims("metal"), (structs, reg) => {
    const f = baseAt(structs, 40, 1, 40, 0);
    putAt(structs, reg, f, "core:foundation_metal", CLS_SQUARE, O, 0, 0);
    putAt(structs, reg, f, "core:foundation_metal", CLS_SQUARE, [2, 0, 0, 0], 0, 0);
    // Walls on the first cell's south and west sides, and a ceiling over each cell.
    putAt(structs, reg, f, "core:wall_metal", CLS_EDGE, O, 0, 0);
    putAt(structs, reg, f, "core:wall_metal", CLS_EDGE, O, 3, 0);
    ceiling = putAt(structs, reg, f, "core:ceiling_metal", CLS_SQUARE, O, 0, 4);
    open = putAt(structs, reg, f, "core:ceiling_metal", CLS_SQUARE, [2, 0, 0, 0], 0, 4);
  });
  const got = all();
  const skirts = got.filter((d) => d.trim && d.id === "core:skirt_metal");
  // Two cells side by side have six open sides. Each skirt hangs from the foundations' top and stands out from its side.
  expect(skirts.length).toBe(6);
  for (const s of skirts) expect([s.hi[1], s.lo[1]].map((y) => Math.round(y! * 100) / 100)).toEqual([1, -1.4]);
  const south = skirts.filter((s) => Math.abs(s.hi[2]! - 40) < 1e-4);
  expect(south.map((s) => Math.round((s.lo[2]! - 40) * 100) / 100)).toEqual([-0.12, -0.12]);
  // The ceiling over the walls gives way on its south (4) and west (8) sides, and the other on none.
  expect([yieldOf(pieceOf(got, ceiling)), yieldOf(pieceOf(got, open))]).toEqual([12, 0]);
  const c = pieceOf(got, ceiling);
  expect([c.lo[0]! - 40, c.lo[2]! - 40, c.hi[0]! - 43, c.hi[2]! - 43].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([0.1, 0.1, 0, 0]);
});

test("walls on two storeys at one corner each have their own joint, a storey high", () => {
  const { all } = benchOf(standInTrims("metal"), (structs, reg) => {
    const f = baseAt(structs, 40, 0, 40, 0);
    putAt(structs, reg, f, "core:wall_metal", CLS_EDGE, O, 0, 0);
    putAt(structs, reg, f, "core:wall_metal", CLS_EDGE, O, 3, 4);
  });
  const got = all();
  const joints = round(got, 40, 40, 0.3).filter((d) => d.trim);
  // A storey each, the upper standing on the level its own wall does.
  expect(joints.map((j) => [j.lo[1], j.hi[1]].map((y) => Math.round(y! * 100) / 100)).sort()).toEqual([[0, 3.01], [3, 6.01]]);
  expect(joints.every((j) => j.bytes[PIECE_FIT_AT]! >> FIT_CLASS_SHIFT === FIT_NONE)).toBe(true);
});

test("a chunk is laid out again when the next chunk gains a wall at a corner on their border", () => {
  let near = -1;
  const { all, structs, bench } = benchOf(standInTrims("metal"), (structs, reg) => {
    // The corner is on the line between two chunks: the wall along +X stands in one, a wall along -X would in the other.
    near = putAt(structs, reg, baseAt(structs, 128, 0, 100, 0), "core:wall_metal", CLS_EDGE, O, 0, 0);
  });
  let got = all();
  expect([trimsAt(got, 128, 100), yieldOf(pieceOf(got, near))]).toEqual([["joint_sq_metal"], 3]);
  const far = putAt(structs, bench.reg, structs.frames.get(structs.frameAt(near))!, "core:wall_metal", CLS_EDGE, O, 6, 0);
  expect(Math.floor(far / 65536)).not.toBe(Math.floor(near / 65536));
  got = all();
  // A straight run of metal has no joint, so the first wall's end no longer gives way.
  expect([trimsAt(got, 128, 100), yieldOf(pieceOf(got, near)), yieldOf(pieceOf(got, far))]).toEqual([[], 2, 2]);
});

/** What the junctions counted with no trims on 2026-11-24 (joints.test.ts): faces in one plane, and their square centimetres. */
const FOUGHT: Record<string, Record<string, readonly [number, number]>> = {
  wood: { "walls 90": [1, 65], tee: [2, 136], cross: [4, 272], "two storeys": [3, 323] },
  stone: { "walls 90": [1, 36], tee: [2, 72], cross: [4, 144], "two storeys": [4, 502] },
};
const NOTCHED: Record<string, Record<string, number>> = { wood: { "walls 90": 0, tee: 0, cross: 0, "two storeys": 0 }, stone: { "walls 90": 3759, tee: 0, cross: 0, "two storeys": 9368 } };

function endsOf(name: string, tier: TierName): WallEnd[] {
  if (name === "walls 90") return [wall(0, false, 0, tier), wall(90, true, 0, tier)];
  if (name === "tee") return [wall(0, false, 0, tier), wall(180, true, 0, tier), wall(90, true, 0, tier)];
  if (name === "cross") return [wall(0, false, 0, tier), wall(90, true, 0, tier), wall(180, true, 0, tier), wall(270, false, 0, tier)];
  return [wall(0, false, 0, tier), wall(90, true, 0, tier), wall(0, false, 1, tier), wall(90, true, 1, tier)];
}

artTest("with joints on, wood and stone corners show through nowhere, leave no outside corner open and lay no more faces in one plane", () => {
  // Wood and stone square to the world, and stone again in a base turned 17 degrees.
  const tiers = ["wood", "stone", "stone"] as const;
  const turn = turnedBy(3095);
  const names = ["walls 90", "tee", "cross", "two storeys"];
  const laid: Junction[][] = [];
  const { bench, all } = benchOf([...tierMeshes(), ...standInTrims("wood"), ...standInTrims("stone")], (structs, reg) => {
    for (const [t, tier] of tiers.entries()) {
      laid.push(names.map((name, k) => {
        const [vx, vz, storeys] = [64 + k * 32, 64 + t * 32, name === "two storeys"];
        return layJunction(structs, reg, baseAt(structs, vx, storeys ? FOUNDATION_THICK : 0, vz, t === 2 ? turn.yaw : 0), name, vx, vz, t === 2 ? turn.degrees : 0, endsOf(name, tier), storeys ? tier : null);
      }));
    }
  });
  const got = all();
  const table: string[] = [];
  const counted: [string, number[], number, number][] = [];
  for (const [t, tier] of tiers.entries()) {
    for (const j of laid[t]!) {
      const [near, far, fought] = [bench.measure(j), bench.measure(j, COARSE, COARSE_VIEWS), fightsOf(round(got, j.vertex[0], j.vertex[1], 4.7))];
      table.push(`${tier}${t === 2 ? " at 17 degrees" : ""} ${j.name}: leak ${near.leak} notch ${near.notch} (was ${NOTCHED[tier]![j.name]}), coarse ${far.leak} ${far.notch}, fights ${fought.faces} ${fought.area} cm2 (was ${FOUGHT[tier]![j.name]!.join(" ")})`);
      counted.push([`${tier}${t === 2 ? " at 17 degrees" : ""} ${j.name}`, [near.leak, near.notch, far.leak, far.notch], fought.faces - FOUGHT[tier]![j.name]![0], fought.area - FOUGHT[tier]![j.name]![1]]);
    }
  }
  if (process.env.SNARK_TRIMS_TABLE) console.log(table.join("\n"));
  for (const [where, seen, faces, area] of counted) {
    expect(seen, where).toEqual([0, 0, 0, 0]);
    expect(faces, `${where}: more faces in one plane`).toBeLessThanOrEqual(0);
    expect(area, `${where}: more of them, in cm2`).toBeLessThanOrEqual(0);
  }
});

test("Tek and Metal share a fitted Tek corner with Tek's finish", () => {
  const meshes = [...standInTrims("metal"), ...standInTrims("tek")];
  const { all } = benchOf(meshes, (structs, reg) => {
    const frame = baseAt(structs, 40, 0, 40, 0);
    putAt(structs, reg, frame, "core:wall_metal", CLS_EDGE, O, 0, 0);
    putAt(structs, reg, frame, "core:wall_tek", CLS_EDGE, O, 3, 0);
  });
  const near = round(all(), 40, 40, .3);
  const joint = near.find(d => d.id === "core:joint_sq_tek");
  expect(joint?.trim).toBe(true);
  expect(joint?.bytes[PIECE_MADE_AT]).toBe(materialIndex("tek_field"));
});
