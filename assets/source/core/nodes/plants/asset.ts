// The low plants: berry bushes, saw palmetto, ferns, sea grape, creeper and the vine that hangs from a ruin's broken
// edges, several individuals of each and what is left of each when it is used up. Built by model.py from the cards and stems in kit.py, each kind's frame in its own
// script, and the numbers of every individual in variants.py.
//
// Level 0 is cut-out cards with the kind's atlas. Level 1 is the same cards in flat colours, berries as small solids:
// what the low setting draws near, and what the others draw once the plant is small on screen. Level 2 has a
// quadrilateral for each card, or a patch for each twig of leaves, and level 3 a few shapes that still say which plant
// it is at a handful of pixels: what the far layer draws.

import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

/** A kind's atlas: every element of it in one cut-out picture, under tex/<name>/. */
const atlas = (name: string, more: Partial<MaterialSpec> = {}): MaterialSpec => ({
  base: `tex/${name}/${name}_base.png`,
  normal: `tex/${name}/${name}_normal.png`,
  packed: `tex/${name}/${name}_orm.png`,
  height: `tex/${name}/${name}_height.png`,
  cutout: true,
  ...more,
});

/**
 * A level's points cannot judge it: level 1 is the finest's cards with no cut-out, and the coarser ones other shapes in
 * the same outline. So each is stated, as the error at which it takes over on medium when the plant stands this many
 * pixels tall on a 1,080-row screen (0.22 of a pixel of error on medium): flat at 28, quadrilaterals at 14, the far
 * shapes at 7. `tall` is the kind's typical height in metres as modelled.
 */
const MEDIUM = 0.22;
const errors = (tall: number): number[] => [28, 14, 7].map((px) => Math.round(((tall * MEDIUM) / px) * 10000) / 10000);

const KINDS: readonly [kind: string, count: number, tall: number][] = [
  ["bush", 4, 1.15],
  ["palmetto", 3, 1.25],
  ["fern", 4, 0.75],
  ["seagrape", 3, 1.4],
  ["creeper", 3, 1.1],
  ["vine", 3, 2.6],
];

const pieces = KINDS.flatMap(([kind, count, tall]) => [
  ...Array.from({ length: count }, (_, i) => ({ id: `core:${kind}_${i + 1}`, object: `${kind}_${i + 1}`, errors: errors(tall) })),
  ...Array.from({ length: count }, (_, i) => ({ id: `core:${kind}_${i + 1}_depleted`, object: `${kind}_${i + 1}_depleted`, errors: errors(tall * 0.6) })),
]);

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces,
  materials: {
    // Each drawn flat, until its pictures come, in its plant's main green from tones.py: an atlas's mean takes in its
    // brown stalks and dead leaves.
    bush: atlas("bush", { regions: "tex/bush/bush_regions.png", flat: [68, 103, 48] }),
    palmetto: atlas("palmetto", { flat: [103, 143, 115] }),
    fern: atlas("fern", { flat: [87, 140, 71] }),
    seagrape: atlas("seagrape", { flat: [78, 121, 59] }),
    creeper: atlas("creeper", { flat: [68, 103, 48] }),
  },
  budgets: { triangles: [1600, 1600, 400, 60], texture: { top: 2048, megabytes: 80 } },
} satisfies PiecesAsset;
