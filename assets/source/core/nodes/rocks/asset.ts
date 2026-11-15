// The rocks: pale coastal limestone (core:rock), the darker stone that carries ore (core:metal_rock) and the rubble of
// the city's buildings (core:rubble). Each individual is carved as a solid by sculpt.py from the numbers in
// variants.py, reduced to a game mesh and baked into pictures of its own by make.py, and read back by model.py. What is
// left of it when used up, `<name>_depleted`, wears its pictures too.

import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

const ROCKS = [
  ...["rock_1", "rock_2", "rock_3", "rock_4", "rock_5", "rock_6"],
  ...["metal_rock_1", "metal_rock_2", "metal_rock_3"],
  ...["rubble_1", "rubble_2", "rubble_3"],
];

/**
 * The surface error each coarser level is drawn at, in metres at the modelled size: the first flat level from about
 * 28 m on medium (3,500 times its error), then 80, 150 and 300 m. The textured finest is for the rock in front of the
 * player; the second level carries a shore full of them. Each was looked at, at the size it is first drawn, on the sheet.
 */
const ERRORS = [0.008, 0.023, 0.043, 0.086];

/** A mesh's own pictures, baked from its solid, in its rock's folder: `rock_1` and `rock_1_depleted` side by side. */
const baked = (name: string): MaterialSpec => {
  const dir = `tex/${name.replace("_depleted", "")}`;
  return { base: `${dir}/${name}_base.png`, normal: `${dir}/${name}_normal.png`, packed: `${dir}/${name}_orm.png` };
};

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: ROCKS.flatMap((name) => [name, `${name}_depleted`]).map((name) => ({ id: `core:${name}`, object: name, errors: ERRORS })),
  materials: Object.fromEntries(ROCKS.flatMap((name) => [name, `${name}_depleted`]).map((name) => [name, baked(name)])),
  // The finest level has the pictures; the rest are flat, coloured triangle by triangle from them.
  flat: 1,
  budgets: { triangles: [3600, 1000, 320, 100, 20], texture: { top: 2048, megabytes: 280 } },
} satisfies PiecesAsset;
