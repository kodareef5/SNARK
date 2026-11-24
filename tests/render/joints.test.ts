// How building pieces meet where walls join: a junction of each tier is drawn from sixteen sides and may not show
// through, leave an outside corner open or lay two faces in one plane more than it did (tools/pieces/joints.ts).

import { expect } from "bun:test";
import { FORMS } from "../../content/building/forms.ts";
import { COUNTS, JointBench, countsOf, piecesPack, registry, tierMeshes } from "../../tools/pieces/joints.ts";
import { JUNCTIONS, TIERS, tierJunction, type TierName } from "../../tools/pieces/layout.ts";
import { STONE } from "../../tools/pack/pieces/stone.ts";
import { tierShapes } from "../../tools/pack/pieces/tier.ts";
import { WOOD } from "../../tools/pack/pieces/wood.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { test } from "../fixtures/needs-art.ts";

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

test("stone as its recipe makes it meets no worse than the stone it replaces", () => {
  const pack = piecesPack([...tierMeshes(["thatch", "wood"]), ...tierShapes(STONE, FORMS)]);
  const laid = lay()[TIERS.indexOf("stone")]!;
  const bench = new JointBench(pack, laid);
  const meshes = meshesOf(pack);
  for (const j of laid) {
    hold(countsOf(bench, j, meshes), AT_MOST.stone[j.name]!, `recipe stone ${j.name}`);
  }
});
