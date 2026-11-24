// How building pieces meet where walls join: a junction of each tier is drawn from sixteen sides and may not show
// through, leave an outside corner open or lay two faces in one plane more than it did (tools/pieces/joints.ts).

import { expect } from "bun:test";
import { COUNTS, JointBench, countsOf, piecesPack, registry, tierMeshes } from "../../tools/pieces/joints.ts";
import { JUNCTIONS, TIERS, tierJunction, type TierName } from "../../tools/pieces/layout.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { test } from "../fixtures/needs-art.ts";

/**
 * What each junction counted on 2026-11-24, in the order of COUNTS. A change may lower a number and may not raise one:
 * `bun tools/pieces/sheet.ts --table` prints them again, and `bun tools/pieces/sheet.ts` draws what they count.
 */
const AT_MOST: Record<TierName, Record<string, readonly number[]>> = {
  thatch: { "walls 180": [3, 0, 1, 0, 0, 0], "walls 90": [61, 1615, 3, 743, 1, 5], "tee": [3, 0, 0, 0, 2, 9], "cross": [6, 0, 0, 0, 4, 16], "openings 90": [3, 0, 0, 0, 0, 0], "two storeys": [99, 3494, 6, 1481, 5, 26], "mixed 90": [3, 0, 0, 0, 0, 0] },
  wood: { "walls 180": [0, 0, 0, 0, 0, 0], "walls 90": [0, 0, 0, 0, 0, 0], "tee": [0, 0, 0, 0, 0, 0], "cross": [0, 0, 0, 0, 1, 70], "openings 90": [0, 0, 0, 0, 0, 0], "two storeys": [0, 0, 0, 0, 2, 20], "mixed 90": [0, 0, 0, 0, 0, 0] },
  stone: { "walls 180": [0, 0, 0, 0, 0, 0], "walls 90": [0, 3759, 0, 2218, 1, 36], "tee": [0, 0, 0, 0, 2, 72], "cross": [0, 0, 0, 0, 4, 144], "openings 90": [0, 3757, 0, 2210, 1, 36], "two storeys": [0, 9368, 0, 4936, 3, 488], "mixed 90": [0, 3694, 0, 2189, 0, 0] },
  metal: { "walls 180": [0, 0, 0, 0, 0, 0], "walls 90": [0, 3575, 0, 2138, 1, 100], "tee": [0, 0, 0, 0, 2, 200], "cross": [0, 0, 0, 0, 4, 400], "openings 90": [0, 3575, 0, 2138, 1, 100], "two storeys": [0, 8921, 0, 4765, 3, 600], "mixed 90": [0, 0, 0, 0, 0, 0] },
};

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
      const counted = countsOf(bench, j, meshes);
      const most = AT_MOST[tier][j.name]!;
      COUNTS.forEach((what, k) => expect(counted[k], `${tier} ${j.name}: ${what}`).toBeLessThanOrEqual(most[k]!));
    }
  });
}
