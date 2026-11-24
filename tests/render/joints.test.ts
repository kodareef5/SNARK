// How building pieces meet where walls join: a junction of each tier is drawn from sixteen sides and may not show
// through, leave an outside corner open or lay two faces in one plane more than it did (tools/pieces/joints.ts).

import { expect } from "bun:test";
import { FORMS } from "../../content/building/forms.ts";
import { COARSE, COARSE_VIEWS, COUNTS, JointBench, SIDE, countsOf, fightsOf, piecesPack, registry, tierMeshes } from "../../tools/pieces/joints.ts";
import { JUNCTIONS, TIERS, tierJunction, type Junction, type TierName, type WallEnd } from "../../tools/pieces/layout.ts";
import { STONE } from "../../tools/pack/pieces/stone.ts";
import { THATCH, THATCH_FORMS } from "../../tools/pack/pieces/thatch.ts";
import { tierShapes, trimShapes } from "../../tools/pack/pieces/tier.ts";
import { WOOD, WOOD_JOINTED } from "../../tools/pack/pieces/wood.ts";
import { bakeMetal } from "../../tools/pack/pieces/metal.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { test } from "../fixtures/needs-art.ts";
import { FOUNDATION_THICK, baseAt, drawn, layJunction, round } from "../fixtures/trims.ts";

/**
 * What each junction counted on 2026-11-24, wood as its Blender scripts made it, in the order of COUNTS. A change may lower a number and may not raise one:
 * `bun tools/pieces/sheet.ts --table` prints them again, and `bun tools/pieces/sheet.ts` draws what they count.
 */
const AT_MOST: Record<TierName, Record<string, readonly number[]>> = {
  thatch: { "walls 180": [3, 0, 1, 0, 0, 0], "walls 90": [61, 1615, 3, 304, 1, 5], "tee": [3, 0, 0, 0, 2, 9], "cross": [6, 0, 0, 0, 4, 16], "openings 90": [3, 0, 0, 0, 0, 0], "two storeys": [99, 3494, 6, 604, 9, 36], "mixed 90": [3, 0, 0, 0, 0, 0] },
  wood: { "walls 180": [0, 0, 0, 0, 0, 0], "walls 90": [0, 0, 0, 0, 1, 65], "tee": [0, 0, 0, 0, 2, 136], "cross": [0, 0, 0, 0, 4, 272], "openings 90": [0, 0, 0, 0, 2, 387], "two storeys": [0, 0, 0, 0, 3, 323], "mixed 90": [0, 0, 0, 0, 0, 0] },
  stone: { "walls 180": [0, 0, 0, 0, 0, 0], "walls 90": [0, 3759, 0, 992, 1, 36], "tee": [0, 0, 0, 0, 2, 72], "cross": [0, 0, 0, 0, 4, 144], "openings 90": [0, 3757, 0, 987, 1, 36], "two storeys": [0, 9368, 0, 2206, 4, 502], "mixed 90": [0, 3694, 0, 984, 0, 0] },
  metal: { "walls 180": [0, 0, 0, 0, 0, 0], "walls 90": [0, 3575, 0, 961, 1, 100], "tee": [0, 0, 0, 0, 2, 200], "cross": [0, 0, 0, 0, 4, 400], "openings 90": [0, 3575, 0, 961, 1, 100], "two storeys": [0, 8921, 0, 2141, 3, 600], "mixed 90": [0, 0, 0, 0, 0, 0] },
};

/**
 * Pixels are held exactly. Faces in one plane are held with room: two hewn timbers lie within half a millimetre of each
 * other over a patch that comes and goes as either is cut, so a count may be two faces and a tenth and 10 cm2 over.
 */
function hold(counted: readonly number[], most: readonly number[], where: string): void {
  COUNTS.forEach((what, k) => expect(counted[k], `${where}: ${what}`).toBeLessThanOrEqual(k < 4 ? most[k]! : k === 4 ? most[k]! + 2 : most[k]! * 1.1 + 10));
}

let made: { bench: JointBench; meshes: ReturnType<typeof meshesOf>; laid: ReturnType<typeof lay> } | null = null;
const meshesOf = (pack: JointBench["pack"]) => new Map(unpackMeshes(pack).map((m) => [m.id, m] as const));
const lay = () => TIERS.map((tier, t) => JUNCTIONS.map((name, k) => tierJunction(name, tier, 64 + k * 32, 64 + t * 32, (id) => registry().index.has(id))));

/** Every tier's junctions in one flat world, built once. */
function world() {
  if (made) return made;
  const pack = piecesPack(tierMeshes());
  const laid = lay();
  return (made = { bench: new JointBench(pack, laid.flat()), meshes: meshesOf(pack), laid });
}

for (const tier of TIERS) {
  test(`${tier} junctions leak, gape and fight no more than they did`, () => {
    const { bench, meshes, laid } = world();
    for (const j of laid[TIERS.indexOf(tier)]!) {
      hold(countsOf(bench, j, meshes), AT_MOST[tier][j.name]!, `${tier} ${j.name}`);
    }
  });
}

test("wood as its recipe makes it meets no worse than the wood it replaces", () => {
  // The recipe's own shapes in place of the installed pack's, which may be older than the recipe.
  const pack = piecesPack([...tierMeshes(["thatch", "stone"]), ...tierShapes(WOOD, FORMS)]);
  const laid = lay()[TIERS.indexOf("wood")]!;
  const bench = new JointBench(pack, laid);
  const meshes = meshesOf(pack);
  for (const j of laid) {
    hold(countsOf(bench, j, meshes), AT_MOST.wood[j.name]!, `recipe wood ${j.name}`);
  }
});

test("metal as its recipe makes it meets no worse than the boxes it replaces", () => {
  // The recipe's meshes need no pictures and no pack: they stand in for the grey boxes, whose counts AT_MOST holds.
  const pack = piecesPack([...tierMeshes(), ...bakeMetal(FORMS)]);
  const laid = lay()[TIERS.indexOf("metal")]!;
  const bench = new JointBench(pack, laid);
  const meshes = meshesOf(pack);
  for (const j of laid) {
    const counted = countsOf(bench, j, meshes);
    hold(counted, AT_MOST.metal[j.name]!, `recipe metal ${j.name}`);
    // A corner's open notch is the boxes' own to the pixel, until joints are drawn there.
    expect([j.name, counted[0], counted[1]]).toEqual([j.name, 0, AT_MOST.metal[j.name]![1]!]);
  }
});

test("stone as its recipe makes it meets no worse than the stone it replaces", () => {
  const pack = piecesPack([...tierMeshes(["thatch", "wood"]), ...tierShapes(STONE, FORMS)]);
  const laid = lay()[TIERS.indexOf("stone")]!;
  const bench = new JointBench(pack, laid);
  const meshes = meshesOf(pack);
  for (const j of laid) {
    hold(countsOf(bench, j, meshes), AT_MOST.stone[j.name]!, `recipe stone ${j.name}`);
  }
});

test("thatch as its recipe makes it meets no worse than the thatch it replaces", () => {
  const forms = Object.fromEntries(THATCH_FORMS.map((name) => [name, FORMS[name]]));
  const pack = piecesPack([...tierMeshes(["wood", "stone"]), ...tierShapes(THATCH, forms)]);
  const laid = lay()[TIERS.indexOf("thatch")]!;
  const bench = new JointBench(pack, laid);
  const meshes = meshesOf(pack);
  for (const j of laid) hold(countsOf(bench, j, meshes), AT_MOST.thatch[j.name]!, `recipe thatch ${j.name}`);
});

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

for (const [recipe, what] of [[WOOD_JOINTED, "with no strips"], [WOOD, "with its strips, which the joints fold away"]] as const) {
  test(`wood ${what} and its own joints closes every corner, square or not`, () => {
    // The recipe's walls and trims as the client lays and fits them (client/core/render/trims.ts): what turning wood's switch gives.
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

import { THATCH_JOINTED } from "../../tools/pack/pieces/thatch.ts";

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

for (const [recipe, what] of [[THATCH_JOINTED, "with no posts of its own"], [THATCH, "with its posts left on"]] as const) {
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
      if (recipe === THATCH_JOINTED) expect([j.name, fought.faces <= most[4]!, fought.area <= most[5]!]).toEqual([j.name, true, true]);
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
