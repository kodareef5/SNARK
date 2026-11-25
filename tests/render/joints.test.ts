// How building pieces meet where walls join: a junction of each tier is drawn from sixteen sides and may not show
// through, leave an outside corner open or lay two faces in one plane more than it did (tools/pieces/joints.ts).

import { expect } from "bun:test";
import { FORMS } from "../../content/building/forms.ts";
import { COARSE, COARSE_VIEWS, COUNTS, JointBench, SIDE, fightsOf, piecesPack, tierMeshes } from "../../tools/pieces/joints.ts";
import { JUNCTIONS, TIERS, mixedWith, type Junction, type TierName, type WallEnd } from "../../tools/pieces/layout.ts";
import { STONE } from "../../tools/pack/pieces/stone.ts";
import { THATCH, THATCH_FORMS } from "../../tools/pack/pieces/thatch.ts";
import { tierShapes, trimShapes } from "../../tools/pack/pieces/tier.ts";
import { WOOD, WOOD_STRIPS } from "../../tools/pack/pieces/wood.ts";
import { bakeMetal } from "../../tools/pack/pieces/metal.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { test } from "../fixtures/needs-art.ts";
import { FOUNDATION_THICK, baseAt, drawn, layJunction, round } from "../fixtures/trims.ts";

/**
 * What each junction counts with the published packs and the joints the client lays, set down by key, in the order of
 * COUNTS. A change may lower a number and may not raise one. With the Blender art and no joints, stone's and metal's
 * outside corners left up to 9,368 and 8,921 notch pixels, thatch's 3,494 with 99 leaking, and wood's faces lay in one
 * plane over 387 cm2. Thatch's two storeys still lay 5 faces in one plane, 34 cm2, under the upper storey's walls.
 */
const AT_MOST: Record<TierName, Record<string, readonly number[]>> = {
  thatch: { "walls 180": [0, 0, 0, 0, 0, 0], "walls 90": [0, 0, 0, 0, 0, 0], "tee": [0, 0, 0, 0, 0, 0], "cross": [0, 0, 0, 0, 0, 0], "openings 90": [0, 0, 0, 0, 0, 0], "two storeys": [0, 0, 0, 0, 5, 34], "mixed 90": [0, 0, 0, 0, 0, 0] },
  wood: { "walls 180": [0, 0, 0, 0, 0, 0], "walls 90": [0, 0, 0, 0, 0, 0], "tee": [0, 0, 0, 0, 0, 0], "cross": [0, 0, 0, 0, 0, 0], "openings 90": [0, 0, 0, 0, 0, 0], "two storeys": [0, 0, 0, 0, 0, 0], "mixed 90": [0, 0, 0, 0, 0, 0] },
  stone: { "walls 180": [0, 0, 0, 0, 0, 0], "walls 90": [0, 0, 0, 0, 0, 0], "tee": [0, 0, 0, 0, 0, 0], "cross": [0, 0, 0, 0, 0, 0], "openings 90": [0, 0, 0, 0, 0, 0], "two storeys": [0, 0, 0, 0, 0, 0], "mixed 90": [0, 0, 0, 0, 0, 0] },
  metal: { "walls 180": [0, 0, 0, 0, 0, 0], "walls 90": [0, 0, 0, 0, 0, 0], "tee": [0, 0, 0, 0, 0, 0], "cross": [0, 0, 0, 0, 0, 0], "openings 90": [0, 0, 0, 0, 0, 0], "two storeys": [0, 0, 0, 0, 0, 0], "mixed 90": [0, 0, 0, 0, 0, 0] },
};

/**
 * Pixels are held exactly. Faces in one plane are held with room: two hewn timbers lie within half a millimetre of each
 * other over a patch that comes and goes as either is cut, so a count may be two faces and a tenth and 10 cm2 over.
 */
function hold(counted: readonly number[], most: readonly number[], where: string): void {
  COUNTS.forEach((what, k) => expect(counted[k], `${where}: ${what}`).toBeLessThanOrEqual(k < 4 ? most[k]! : k === 4 ? most[k]! + 2 : most[k]! * 1.1 + 10));
}

const meshesOf = (pack: JointBench["pack"]) => new Map(unpackMeshes(pack).map((m) => [m.id, m] as const));

for (const tier of TIERS) {
  test(`${tier} junctions leak, gape and fight no more than they did`, () => {
    // Every tier's installed pack, its trims among it, set down by key as a player builds.
    for (const [name, counted] of keyedCounts(installedPack(), tier)) {
      if (process.env.SNARK_MEETS) console.log(`${tier} ${name}: ${counted.join(", ")}`);
      hold(counted, AT_MOST[tier][name]!, `${tier} ${name}`);
    }
  });
}

let installed: JointBench["pack"] | null = null;
const installedPack = (): JointBench["pack"] => (installed ??= piecesPack(tierMeshes([...TIERS])));

/** The walls of one of JUNCTIONS by their ways, as `tierJunction` lays them, and the tier of a house's floors where it has them. */
function endsOf(name: string, tier: TierName): { ends: WallEnd[]; house: TierName | null } {
  const wall = (way: number, left: boolean, form = "wall", storey = 0, of: TierName = tier): WallEnd => ({ form, tier: of, way, left, storey });
  const angle = /^walls (\d+)$/.exec(name);
  if (angle) return { ends: [wall(0, false), wall(Number(angle[1]), true)], house: null };
  if (name === "tee") return { ends: [wall(0, false), wall(180, true), wall(90, true)], house: null };
  if (name === "cross") return { ends: [wall(0, false), wall(90, true), wall(180, true), wall(270, false)], house: null };
  if (name === "openings 90") return { ends: [wall(0, false, "doorframe"), wall(90, true, "windowframe")], house: null };
  if (name === "mixed 90") return { ends: [wall(0, false), wall(90, true, "wall", 0, mixedWith(tier))], house: null };
  return { ends: [wall(0, false), wall(90, true), wall(0, false, "wall", 1), wall(90, true, "wall", 1)], house: tier };
}

/** Each of a tier's JUNCTIONS set down by key in a base of its own, as a player builds, with the trims the client lays: its counts, in the order of COUNTS. */
function keyedCounts(pack: JointBench["pack"], tier: TierName): Map<string, number[]> {
  const laid: Junction[] = [];
  const bench = new JointBench(pack, [], SIDE, (structs, reg) => {
    JUNCTIONS.forEach((name, k) => {
      const { ends, house } = endsOf(name, tier);
      const [vx, vz] = [64 + (k % 4) * 32, 64 + Math.floor(k / 4) * 32];
      laid.push(layJunction(structs, reg, baseAt(structs, vx, house ? FOUNDATION_THICK : 0, vz, 0), name, vx, vz, 0, ends, house));
    });
  });
  bench.draw({ vertex: [64, 64] }, 1.5, 30, 20);
  const got = drawn(bench.scene, { chunksX: 8, chunksZ: 8 }, pack, meshesOf(pack));
  return new Map(laid.map((j) => {
    const [near, far, fought] = [bench.measure(j), bench.measure(j, COARSE, COARSE_VIEWS), fightsOf(round(got, j.vertex[0], j.vertex[1], 4.7))];
    return [j.name, [near.leak, near.notch, far.leak, far.notch, fought.faces, fought.area]] as const;
  }));
}

/** Every tier as its recipe makes it, with its trims, in place of the installed packs, which may be older than the recipes. */
let recipes: JointBench["pack"] | null = null;
const recipePack = (): JointBench["pack"] =>
  (recipes ??= piecesPack([
    ...tierShapes(WOOD, FORMS), ...trimShapes(WOOD),
    ...tierShapes(STONE, FORMS), ...trimShapes(STONE),
    ...tierShapes(THATCH, Object.fromEntries(THATCH_FORMS.map((name) => [name, FORMS[name]]))), ...trimShapes(THATCH),
    ...bakeMetal(FORMS, true),
  ]));

for (const tier of TIERS) {
  test(`${tier} as its recipe makes it, set down by key, meets no worse than it did`, () => {
    for (const [name, counted] of keyedCounts(recipePack(), tier)) {
      if (process.env.SNARK_MEETS) console.log(`recipe ${tier} ${name}: ${counted.join(", ")}`);
      hold(counted, AT_MOST[tier][name]!, `recipe ${tier} ${name}`);
    }
  });
}

/** Corners the client lays a wood joint at, by the ways of their walls: the square post, and the two round ones off the square. */
const JOINTED: readonly (readonly [name: string, joint: string, ways: readonly (readonly [way: number, left: boolean, storey?: number])[]])[] = [
  ["walls 90", "joint_sq_wood", [[0, false], [90, true]]],
  ["tee", "joint_sq_wood", [[0, false], [180, true], [90, true]]],
  ["cross", "joint_sq_wood", [[0, false], [90, true], [180, true], [270, false]]],
  ["two storeys", "joint_sq_wood", [[0, false], [90, true], [0, false, 1], [90, true, 1]]],
  ["walls 180", "joint_sq_wood", [[0, false], [180, true]]],
  ["walls 60", "joint_r21_wood", [[0, false], [60, true]]],
  ["walls 120", "joint_r15_wood", [[0, false], [120, true]]],
  ["walls 150", "joint_r15_wood", [[0, false], [150, true]]],
];

for (const [recipe, what] of [[WOOD, "with no strips"], [WOOD_STRIPS, "with its strips, which the joints fold away"]] as const) {
  test(`wood ${what} and its own joints closes every corner, square or not`, () => {
    // The recipe's walls and trims as the client lays and fits them (client/core/render/trims.ts).
    const pack = piecesPack([...tierMeshes(["thatch", "stone"]), ...tierShapes(recipe, FORMS), ...trimShapes(recipe)]);
    const laid: Junction[] = [];
    const bench = new JointBench(pack, [], SIDE, (structs, reg) => {
      JOINTED.forEach(([name, , ways], k) => {
        const storeys = name === "two storeys";
        const [vx, vz] = [64 + (k % 4) * 32, 64 + Math.floor(k / 4) * 32];
        const ends = ways.map(([way, left, storey]): WallEnd => ({ form: "wall", tier: "wood", way, left, storey: storey ?? 0 }));
        laid.push(layJunction(structs, reg, baseAt(structs, vx, storeys ? FOUNDATION_THICK : 0, vz, 0), name, vx, vz, 0, ends, storeys ? "wood" : null));
      });
    });
    bench.draw({ vertex: [64, 64] }, 1.5, 30, 20);
    const got = drawn(bench.scene, { chunksX: 8, chunksZ: 8 }, pack, meshesOf(pack));
    laid.forEach((j, k) => {
      const [near, far, fought] = [bench.measure(j), bench.measure(j, COARSE, COARSE_VIEWS), fightsOf(round(got, j.vertex[0], j.vertex[1], 4.7))];
      const joints = round(got, j.vertex[0], j.vertex[1], 0.4).filter((d) => d.trim && d.id.includes("joint")).map((d) => d.id.slice(5));
      // The joint its walls' ways ask for stands there, one a storey.
      expect([j.name, ...new Set(joints)]).toEqual([j.name, JOINTED[k]![1]]);
      // No pixel shows through, no outside corner is open, near or from across a yard, and no two faces lie in one plane.
      expect([j.name, near.leak, near.notch, far.leak, far.notch, fought.faces, fought.area]).toEqual([j.name, 0, 0, 0, 0, 0, 0]);
    });
  });
}

// Thatch with its own joints, as the client lays and fits them: the corner pole in place of each wall's own post.

import { THATCH_PLANNED, THATCH_POSTED } from "../../tools/pack/pieces/thatch.ts";

/** Corners the client lays a thatch joint at, by the ways of their walls: the corner pole, and the stouter one where walls meet at 60 degrees. */
const THATCH_JOINTS: readonly (readonly [name: string, joint: string, ways: readonly (readonly [way: number, left: boolean, storey?: number])[]])[] = [
  ["walls 90", "joint_sq_thatch", [[0, false], [90, true]]],
  ["tee", "joint_sq_thatch", [[0, false], [180, true], [90, true]]],
  ["cross", "joint_sq_thatch", [[0, false], [90, true], [180, true], [270, false]]],
  ["two storeys", "joint_sq_thatch", [[0, false], [90, true], [0, false, 1], [90, true, 1]]],
  ["walls 180", "joint_sq_thatch", [[0, false], [180, true]]],
  ["walls 60", "joint_r21_thatch", [[0, false], [60, true]]],
  ["walls 120", "joint_r15_thatch", [[0, false], [120, true]]],
  ["walls 150", "joint_r15_thatch", [[0, false], [150, true]]],
];

for (const [recipe, what] of [[THATCH, "with no posts of its own"], [THATCH_POSTED, "with its posts left on"]] as const) {
  test(`thatch ${what} and its own joints shows through nowhere and leaves no corner open`, () => {
    const forms = Object.fromEntries(THATCH_FORMS.map((name) => [name, FORMS[name]]));
    const pack = piecesPack([...tierMeshes(["wood", "stone"]), ...tierShapes(recipe, forms), ...trimShapes(recipe)]);
    const laid: Junction[] = [];
    const bench = new JointBench(pack, [], SIDE, (structs, reg) => {
      THATCH_JOINTS.forEach(([name, , ways], k) => {
        const storeys = name === "two storeys";
        const [vx, vz] = [64 + (k % 4) * 32, 64 + Math.floor(k / 4) * 32];
        const ends = ways.map(([way, left, storey]): WallEnd => ({ form: "wall", tier: "thatch", way, left, storey: storey ?? 0 }));
        laid.push(layJunction(structs, reg, baseAt(structs, vx, storeys ? FOUNDATION_THICK : 0, vz, 0), name, vx, vz, 0, ends, storeys ? "thatch" : null));
      });
    });
    bench.draw({ vertex: [64, 64] }, 1.5, 30, 20);
    const got = drawn(bench.scene, { chunksX: 8, chunksZ: 8 }, pack, meshesOf(pack));
    const said: string[] = [];
    laid.forEach((j, k) => {
      const [near, far, fought] = [bench.measure(j), bench.measure(j, COARSE, COARSE_VIEWS), fightsOf(round(got, j.vertex[0], j.vertex[1], 4.7))];
      const joints = round(got, j.vertex[0], j.vertex[1], 0.4).filter((d) => d.trim && d.id.includes("joint")).map((d) => d.id.slice(5));
      said.push(`thatch ${what}, ${j.name}: leak ${near.leak}, notch ${near.notch}, from across a yard ${far.leak} and ${far.notch}, faces in one plane ${fought.faces}, ${fought.area} cm2`);
      // The joint its walls' ways ask for stands there, one a storey.
      expect([j.name, ...new Set(joints)]).toEqual([j.name, THATCH_JOINTS[k]![1]]);
      // No pixel shows through and no outside corner is open, near or from across a yard: the post left 45 and 93, and 1,615 and 3,494.
      expect([j.name, near.leak, near.notch, far.leak, far.notch]).toEqual([j.name, 0, 0, 0, 0]);
      // With no posts, faces lie in one plane no more than they did with none of this: nowhere but under a second storey.
      const most = AT_MOST.thatch[j.name] ?? [0, 0, 0, 0, 0, 0];
      if (recipe === THATCH) expect([j.name, fought.faces <= most[4]!, fought.area <= most[5]!]).toEqual([j.name, true, true]);
    });
    if (process.env.SNARK_MEETS) console.log(said.join("\n"));
  });
}

// Stone with its own joints: a quoin where its walls lie square, a pier of drums where they do not.

/** Corners of stone walls by their ways, and the joint the client lays at each: none in a straight run, where stone's pattern runs on. */
const STONE_JOINTED: readonly (readonly [name: string, joint: string | null, ways: readonly (readonly [way: number, left: boolean, storey?: number])[]])[] = [
  ["walls 90", "joint_sq_stone", [[0, false], [90, true]]],
  ["tee", "joint_sq_stone", [[0, false], [180, true], [90, true]]],
  ["cross", "joint_sq_stone", [[0, false], [90, true], [180, true], [270, false]]],
  ["two storeys", "joint_sq_stone", [[0, false], [90, true], [0, false, 1], [90, true, 1]]],
  ["walls 180", null, [[0, false], [180, true]]],
  ["walls 60", "joint_r21_stone", [[0, false], [60, true]]],
  ["walls 120", "joint_r15_stone", [[0, false], [120, true]]],
  ["walls 150", "joint_r15_stone", [[0, false], [150, true]]],
];

test("stone and its own joints closes every corner, square or not, and a straight run is as it was", () => {
  // The recipe's walls and trims as the client lays and fits them (client/core/render/trims.ts).
  const pack = piecesPack([...tierMeshes(["thatch", "wood"]), ...tierShapes(STONE, FORMS), ...trimShapes(STONE)]);
  const laid: Junction[] = [];
  const bench = new JointBench(pack, [], SIDE, (structs, reg) => {
    STONE_JOINTED.forEach(([name, , ways], k) => {
      const storeys = name === "two storeys";
      const [vx, vz] = [64 + (k % 4) * 32, 64 + Math.floor(k / 4) * 32];
      const ends = ways.map(([way, left, storey]): WallEnd => ({ form: "wall", tier: "stone", way, left, storey: storey ?? 0 }));
      laid.push(layJunction(structs, reg, baseAt(structs, vx, storeys ? FOUNDATION_THICK : 0, vz, 0), name, vx, vz, 0, ends, storeys ? "stone" : null));
    });
  });
  bench.draw({ vertex: [64, 64] }, 1.5, 30, 20);
  const got = drawn(bench.scene, { chunksX: 8, chunksZ: 8 }, pack, meshesOf(pack));
  laid.forEach((j, k) => {
    const [near, far, fought] = [bench.measure(j), bench.measure(j, COARSE, COARSE_VIEWS), fightsOf(round(got, j.vertex[0], j.vertex[1], 4.7))];
    const here = round(got, j.vertex[0], j.vertex[1], 0.4);
    const joints = here.filter((d) => d.trim && d.id.includes("joint")).map((d) => d.id.slice(5));
    // The joint its walls' ways ask for stands there, one a storey; in a straight run none does.
    expect([j.name, ...new Set(joints)]).toEqual([j.name, ...(STONE_JOINTED[k]![1] ? [STONE_JOINTED[k]![1]!] : [])]);
    // No pixel shows through, no outside corner is open, near or from across a yard, and no two faces lie in one plane.
    expect([j.name, near.leak, near.notch, far.leak, far.notch, fought.faces, fought.area]).toEqual([j.name, 0, 0, 0, 0, 0, 0]);
    const walls = here.filter((d) => !d.trim && d.id === "core:wall_stone");
    // How near the corner each wall's drawn end stands: pulled back by the yield band where a joint is, and on the corner itself in a run.
    const reach = walls.map((d) => {
      // Along the wall's own way from the corner, which its middle lies on.
      const n = d.points.length / 3;
      let [mx, mz] = [0, 0];
      for (let v = 0; v < d.points.length; v += 3) [mx, mz] = [mx + (d.points[v]! - j.vertex[0]) / n, mz + (d.points[v + 2]! - j.vertex[1]) / n];
      const l = Math.hypot(mx, mz);
      let least = Infinity;
      for (let v = 0; v < d.points.length; v += 3) least = Math.min(least, ((d.points[v]! - j.vertex[0]) * mx + (d.points[v + 2]! - j.vertex[1]) * mz) / l);
      return Math.round(least * 1e4) / 1e4 || 0;
    });
    expect([j.name, ...new Set(reach)]).toEqual([j.name, STONE_JOINTED[k]![1] ? 0.1 : 0]);
  });
});

// Metal with its own joints (joint_sq_metal, joint_r15_metal, joint_r21_metal), as the client lays and fits them: a
// corner post where walls end, a wall's end pulled back to its ring behind it, and nothing at all in a straight run.

/** Corners of metal walls by their ways, and the joint the client lays at each: none where two walls run on. */
const METAL_JOINTS: readonly (readonly [name: string, joint: string | null, ways: readonly (readonly [way: number, left: boolean, storey?: number])[]])[] = [
  ["walls 90", "joint_sq_metal", [[0, false], [90, true]]],
  ["tee", "joint_sq_metal", [[0, false], [180, true], [90, true]]],
  ["cross", "joint_sq_metal", [[0, false], [90, true], [180, true], [270, false]]],
  ["two storeys", "joint_sq_metal", [[0, false], [90, true], [0, false, 1], [90, true, 1]]],
  ["walls 180", null, [[0, false], [180, true]]],
  ["walls 60", "joint_r21_metal", [[0, false], [60, true]]],
  ["walls 120", "joint_r15_metal", [[0, false], [120, true]]],
  ["walls 150", "joint_r15_metal", [[0, false], [150, true]]],
];

test("metal and its own joints closes every corner, square or not, and a straight run is as it was", () => {
  const pack = piecesPack([...tierMeshes(), ...bakeMetal(FORMS, true)]);
  const laid: Junction[] = [];
  const bench = new JointBench(pack, [], SIDE, (structs, reg) => {
    METAL_JOINTS.forEach(([name, , ways], k) => {
      const storeys = name === "two storeys";
      const [vx, vz] = [64 + (k % 4) * 32, 64 + Math.floor(k / 4) * 32];
      const ends = ways.map(([way, left, storey]): WallEnd => ({ form: "wall", tier: "metal", way, left, storey: storey ?? 0 }));
      laid.push(layJunction(structs, reg, baseAt(structs, vx, storeys ? FOUNDATION_THICK : 0, vz, 0), name, vx, vz, 0, ends, storeys ? "metal" : null));
    });
  });
  bench.draw({ vertex: [64, 64] }, 1.5, 30, 20);
  const got = drawn(bench.scene, { chunksX: 8, chunksZ: 8 }, pack, meshesOf(pack));
  const said: string[] = [];
  laid.forEach((j, k) => {
    const [near, far, fought] = [bench.measure(j), bench.measure(j, COARSE, COARSE_VIEWS), fightsOf(round(got, j.vertex[0], j.vertex[1], 4.7))];
    const joints = round(got, j.vertex[0], j.vertex[1], 0.4).filter((d) => d.trim && d.id.includes("joint")).map((d) => d.id.slice(5));
    said.push(`metal with its joints, ${j.name}: ${[...new Set(joints)].join() || "no joint"}, leak ${near.leak}, notch ${near.notch}, from across a yard ${far.leak} and ${far.notch}, faces in one plane ${fought.faces}, ${fought.area} cm2`);
    // The joint its walls' ways ask for stands there, one a storey; two walls in a line have none.
    expect([j.name, ...new Set(joints)]).toEqual([j.name, ...(METAL_JOINTS[k]![1] ? [METAL_JOINTS[k]![1]] : [])]);
    // Each of those walls still reaches the corner: its end's face is half its thickness from it, and pulled back it would be 0.14 m off.
    if (!METAL_JOINTS[k]![1]) for (const d of round(got, j.vertex[0], j.vertex[1], 4.7).filter((d) => d.id.includes("wall"))) {
      let nearest = Infinity;
      for (let v = 0; v < d.points.length; v += 3) nearest = Math.min(nearest, Math.hypot(d.points[v]! - j.vertex[0], d.points[v + 2]! - j.vertex[1]));
      expect(nearest, `${j.name}: ${d.id} ends on the corner`).toBeLessThanOrEqual(0.1001);
    }
    // No pixel shows through, no outside corner is open, near or from across a yard, and no two faces lie in one plane.
    expect([j.name, near.leak, near.notch, far.leak, far.notch, fought.faces, fought.area]).toEqual([j.name, 0, 0, 0, 0, 0, 0]);
  });
  if (process.env.SNARK_MEETS) console.log(said.join("\n"));
});

// The shapes past the first nine, with each tier's own trims as the client lays and fits them.

import { PLANNED_FORMS } from "../../content/building/forms.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Frame } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE } from "../../shared/world/lattice/module.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import type { SourceMesh } from "../../tools/pack/write.ts";
import { showsOver } from "../../tools/pieces/joints.ts";
import { junction, skirtCorner, type Prism } from "../../tools/pieces/layout.ts";
import { putAt, putOwn, type Drawn } from "../fixtures/trims.ts";

const O = [0, 0, 0, 0];
const at = (i: number, j: number): number[] => [2 * i, 0, 0, 2 * j];
/** Metres a sloped wall is judged to near its high end: under its top 0.45 m along, less the gap stone's leaves under a roof. */
const GABLE = 1.1;

interface Shaped {
  name: string;
  /** Metres the base's level 0 stands over the ground: a foundation with skirts is raised to show them. */
  foot?: number;
  /** The corner judged, from the base's own, in sides. */
  corner?: readonly [number, number];
  lay(put: (form: string, cls: number, a: readonly number[], d: number, lvl: number, flipped?: boolean) => void, own: (form: string, cls: number, a: readonly number[], d: number, lvl: number, way: number) => void): void;
  /** The wall ends a line of sight may not pass, and the corners two skirts close, about the corner judged. */
  ends?: (tier: TierName) => WallEnd[];
  skirts?: readonly (readonly [number, number])[];
  looks?: readonly number[];
  /** The joints within 0.4 m of the corner, each the heights it stands between: for a tier whose walls run on, and for one whose do not. */
  joints(runsOn: boolean): [number, number][];
}

const end = (tier: TierName, form: string, way: number, left: boolean, storey = 0, high?: number): WallEnd => ({ form, tier, way, left, storey, ...(high === undefined ? {} : { high }) });

const SHAPED: readonly Shaped[] = [
  {
    // A corner under a roof's eave, the gable over one wall coming down to nothing at it.
    name: "gable at eave",
    lay(put, own) {
      put("wall", CLS_EDGE, O, 0, 0, true);
      put("wall", CLS_EDGE, O, 3, 0);
      put("sloped_wall_right", CLS_EDGE, O, 3, 4);
      own("roof", CLS_SQUARE, O, 0, 4, 0);
    },
    ends: (tier) => [end(tier, "wall", 0, false), end(tier, "wall", 90, true)],
    joints: () => [[0, 3.01]],
  },
  {
    // A gable end: two walls in line, the two gables' high ends over them, and the ridge of two roofs above.
    name: "gable at ridge",
    lay(put, own) {
      put("wall", CLS_EDGE, O, 3, 0);
      put("wall", CLS_EDGE, at(0, -1), 3, 0);
      put("sloped_wall_left", CLS_EDGE, O, 3, 4);
      put("sloped_wall_right", CLS_EDGE, at(0, -1), 3, 4);
      own("roof", CLS_SQUARE, O, 0, 4, 6);
      own("roof", CLS_SQUARE, at(0, -1), 0, 4, 0);
    },
    ends: (tier) => [end(tier, "wall", 90, true), end(tier, "wall", 270, false), end(tier, "sloped_wall_left", 90, true, 1, GABLE), end(tier, "sloped_wall_right", 270, false, 1, GABLE)],
    looks: [1.5, 3.7],
    joints: (runsOn) => (runsOn ? [] : [[0, 3.01], [3, 4.51]]),
  },
  {
    // The head of a lean-to: a gable's high end and the half wall under the roof's high side, over a corner of walls.
    name: "gable at a lean-to's head",
    corner: [0, 1],
    lay(put, own) {
      put("wall", CLS_EDGE, O, 3, 0);
      put("wall", CLS_EDGE, at(0, 1), 0, 0);
      put("sloped_wall_right", CLS_EDGE, O, 3, 4);
      put("half_wall", CLS_EDGE, at(0, 1), 0, 4);
      own("roof", CLS_SQUARE, O, 0, 4, 0);
    },
    ends: (tier) => [end(tier, "wall", 270, false), end(tier, "wall", 0, true), end(tier, "sloped_wall_right", 270, false, 1, GABLE), end(tier, "half_wall", 0, true, 1, 1.5)],
    looks: [1.5, 3.7],
    joints: () => [[0, 3.01], [3, 4.51]],
  },
  {
    name: "half wall beside a wall",
    lay(put) {
      put("half_wall", CLS_EDGE, O, 0, 0, true);
      put("wall", CLS_EDGE, O, 3, 0);
    },
    ends: (tier) => [end(tier, "half_wall", 0, false, 0, 1.5), end(tier, "wall", 90, true)],
    joints: () => [[0, 3.01]],
  },
  {
    name: "railing corner",
    lay(put) {
      put("railing", CLS_EDGE, O, 0, 0, true);
      put("railing", CLS_EDGE, O, 3, 0);
    },
    joints: () => [],
  },
  {
    name: "wall at a double doorway's middle",
    lay(put) {
      put("double_doorway", CLS_EDGE, at(-1, 0), 0, 0, true);
      put("wall", CLS_EDGE, O, 3, 0);
    },
    ends: (tier) => [end(tier, "wall", 90, true)],
    joints: () => [[0, 3.01]],
  },
  {
    name: "large wall beside a wall",
    lay(put) {
      put("large_wall", CLS_EDGE, O, 0, 0, true);
      put("wall", CLS_EDGE, O, 3, 0);
    },
    ends: (tier) => [end(tier, "large_wall", 0, false, 0, 12), end(tier, "wall", 90, true)],
    looks: [1.5, 7.5],
    joints: () => [[0, 3.01], [3, 6.01], [6, 9.01], [9, 12.01]],
  },
  {
    // A footing has no skirt, and the walls on it meet as walls on a foundation do.
    name: "walls on fence foundations at a corner",
    foot: 1,
    lay(put) {
      put("fence_foundation", CLS_EDGE, O, 0, 0, true);
      put("fence_foundation", CLS_EDGE, O, 3, 0);
      put("wall", CLS_EDGE, O, 0, 0, true);
      put("wall", CLS_EDGE, O, 3, 0);
    },
    ends: (tier) => [end(tier, "wall", 0, false), end(tier, "wall", 90, true)],
    joints: () => [[0, 3.01]],
  },
  {
    name: "beam corner",
    lay(put) {
      put("beam", CLS_EDGE, O, 0, 0, true);
      put("beam", CLS_EDGE, O, 3, 0);
    },
    joints: () => [],
  },
  {
    name: "skirts at an outside corner",
    foot: 2,
    lay: (put) => put("foundation", CLS_SQUARE, O, 0, 0),
    skirts: [[90, 360]],
    looks: [1],
    joints: () => [],
  },
  {
    name: "skirts at an inside corner",
    foot: 2,
    lay(put) {
      for (const a of [O, at(-1, 0), at(0, -1)]) put("foundation", CLS_SQUARE, a, 0, 0);
    },
    looks: [1],
    joints: () => [],
  },
  {
    name: "skirts at a triangle's first corner",
    foot: 2,
    lay: (put) => put("triangle_foundation", CLS_TRIANGLE, O, 0, 0),
    skirts: [[60, 360]],
    looks: [1],
    joints: () => [],
  },
  {
    name: "skirts at a triangle's second corner",
    foot: 2,
    corner: [1, 0],
    lay: (put) => put("triangle_foundation", CLS_TRIANGLE, O, 0, 0),
    skirts: [[180, 480]],
    looks: [1],
    joints: () => [],
  },
];

/**
 * What each of SHAPED counted on 2026-11-24 with the tier's own trims laid, after leak and notch pixels, near and from
 * across a yard, which are all 0: faces in one plane and their square centimetres, where there are any. A change may
 * lower one and not raise it. A ridge stands 2 cm past its roofs' sides, so only thatch's gable has faces in one plane
 * there (6 and 1,335 cm2 while a ridge ended in that plane, wood's, stone's and metal's 4 and 33 to 36), rails
 * and beams cross at their corner as they do with no trims, two footings overlap at theirs, and three foundations'
 * sides lie in one plane under a floor held up in the air.
 */
const SHAPED_FIGHTS: Record<string, Record<string, readonly [number, number]>> = {
  wood: { "railing corner": [3, 92], "beam corner": [2, 234], "walls on fence foundations at a corner": [2, 117], "skirts at an inside corner": [10, 261] },
  stone: { "railing corner": [2, 50], "beam corner": [2, 242], "walls on fence foundations at a corner": [1, 42], "skirts at an inside corner": [2, 264] },
  metal: { "gable at eave": [1, 16], "railing corner": [4, 333], "beam corner": [2, 500], "walls on fence foundations at a corner": [3, 398] },
  thatch: { "gable at eave": [1, 8], "gable at ridge": [2, 16], "gable at a lean-to's head": [3, 24], "railing corner": [2, 26], "skirts at an inside corner": [8, 100] },
};

/** The forms SHAPED sets down, as a tier's recipe makes them. */
const SHAPED_FORMS = { ...FORMS, ...Object.fromEntries(["half_wall", "railing", "beam", "fence_foundation", "double_doorway", "large_wall", "roof", "sloped_wall_left", "sloped_wall_right", "triangle_foundation"].map((name) => [name, PLANNED_FORMS[name as keyof typeof PLANNED_FORMS]])) };

function shaped(tier: TierName, art: readonly SourceMesh[]): number {
  const pack = piecesPack(art);
  // A shape is judged where the tier makes every form it sets down.
  const made = new Set(art.map((m) => m.id));
  const shapes = SHAPED.filter((shape) => {
    let all = true;
    const note = (form: string): void => void (all &&= made.has(`core:${form}_${tier}`));
    shape.lay(note, note);
    return all;
  });
  const laid: { j: Junction; at: Shaped }[] = [];
  const bench = new JointBench(pack, [], SIDE, (structs: StructureStore, reg: Registry) => {
    shapes.forEach((shape, k) => {
      const [bx, bz, foot] = [64 + (k % 4) * 32, 64 + Math.floor(k / 4) * 32, shape.foot ?? 0];
      const f: Frame = baseAt(structs, bx, foot, bz, 0);
      shape.lay((form, cls, a, d, lvl, flipped = false) => void putAt(structs, reg, f, `core:${form}_${tier}`, cls, a, d, lvl, 1, flipped), (form, cls, a, d, lvl, way) => void putOwn(structs, reg, f, `core:${form}_${tier}`, cls, a, d, lvl, way));
      const [vx, vz] = [bx + 3 * (shape.corner?.[0] ?? 0), bz + 3 * (shape.corner?.[1] ?? 0)];
      const j = junction(shape.name, vx, vz, shape.ends?.(tier) ?? [], (id) => reg.index.has(id), foot);
      // A skirt's corner is judged from over the ground to under the foundation's own courses, 0.08 m out: the thinnest skirt's depth.
      const corners: Prism[] = (shape.skirts ?? []).map(([a, b]) => skirtCorner(vx, vz, a, b, 0.08, 0.1, foot - 0.4));
      laid.push({ j: { ...j, mitres: [...j.mitres, ...corners], looks: [...(shape.looks ?? [1.5])] }, at: shape });
    });
  });
  bench.draw({ vertex: [64, 64] }, 1.5, 30, 20);
  const got = drawn(bench.scene, { chunksX: 8, chunksZ: 8 }, pack, meshesOf(pack));
  const said: string[] = [];
  const checks: (() => void)[] = [];
  const runsOn = tier === "stone" || tier === "metal";
  for (const { j, at: shape } of laid) {
    const foot = shape.foot ?? 0;
    const [near, far, fought] = [bench.measure(j), bench.measure(j, COARSE, COARSE_VIEWS), fightsOf(round(got, j.vertex[0], j.vertex[1], 4.7), -10)];
    const here: Drawn[] = round(got, j.vertex[0], j.vertex[1], 4.7);
    const joints = round(got, j.vertex[0], j.vertex[1], 0.4).filter((d) => d.trim && d.id.includes("joint"));
    // A joint's foot to the nearest 5 cm: metal's post is sunk a centimetre under its level.
    const stands = joints.map((d): [number, number] => [Math.round((d.lo[1]! - foot) * 20) / 20 || 0, Math.round((d.hi[1]! - foot) * 100) / 100]).sort((p, q) => p[0] - q[0]);
    // Every joint and ridge seen from above with a roof behind it: one that stands out of the roof's top.
    const through = showsOver(here.filter((d) => d.trim && d.id.includes("joint")), here.filter((d) => !d.trim && d.id.includes("roof")), j.vertex[0], j.vertex[1]);
    said.push(`${tier} ${j.name}: leak ${near.leak}, notch ${near.notch}, from across a yard ${far.leak} and ${far.notch}, faces in one plane ${fought.faces}, ${fought.area} cm2, joints ${JSON.stringify(stands)}, through a roof ${through}`);
    checks.push(() => {
      expect([j.name, ...stands]).toEqual([j.name, ...shape.joints(runsOn)]);
      expect([j.name, near.leak, near.notch, far.leak, far.notch, through]).toEqual([j.name, 0, 0, 0, 0, 0]);
      if (!shape.skirts && !shape.name.startsWith("skirts")) expect([j.name, here.filter((d) => d.trim && d.id.includes("skirt")).length]).toEqual([j.name, 0]);
      const most = SHAPED_FIGHTS[tier]![j.name] ?? [0, 0];
      expect([j.name, fought.faces <= most[0] + 2, fought.area <= most[1] * 1.1 + 10]).toEqual([j.name, true, true]);
    });
  }
  if (process.env.SNARK_MEETS) console.log(said.join("\n"));
  for (const check of checks) check();
  return shapes.length;
}

test("wood's new shapes and its own trims close every junction, and no joint stands out of a roof", () => {
  expect(shaped("wood", [...tierMeshes(["thatch", "stone"]), ...tierShapes(WOOD, SHAPED_FORMS), ...trimShapes(WOOD)])).toBe(SHAPED.length);
});

test("stone's new shapes and its own trims close every junction, and no joint stands out of a roof", () => {
  expect(shaped("stone", [...tierMeshes(["thatch", "wood"]), ...tierShapes(STONE, SHAPED_FORMS), ...trimShapes(STONE)])).toBe(SHAPED.length);
});

test("metal's new shapes and its own trims close every junction, and no joint stands out of a roof", () => {
  expect(shaped("metal", [...tierMeshes(), ...bakeMetal(SHAPED_FORMS, true)])).toBe(SHAPED.length);
});

test("thatch's new shapes and its own trims close every junction it makes", () => {
  const forms = Object.fromEntries(Object.entries(SHAPED_FORMS).filter(([name]) => (THATCH_FORMS as readonly string[]).includes(name) || (THATCH_PLANNED as readonly string[]).includes(name)));
  // No large wall, double doorway, beam, footing or triangle in thatch: the gables, low walls, rails and skirts.
  expect(shaped("thatch", [...tierMeshes(["wood", "stone"]), ...tierShapes(THATCH, forms), ...trimShapes(THATCH)])).toBeGreaterThanOrEqual(6);
});
