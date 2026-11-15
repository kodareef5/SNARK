// The egg every species lays, standing on its blunt end, in five sizes: core:egg_xs, _s, _m, _l and _xl, by ARK's
// names for egg sizes, 0.11, 0.16, 0.23, 0.33 and 0.48 m tall (shape.py: SIZES). A prop is drawn at the size it is
// modelled, so a species takes its size by the mesh its egg prop names; the dodo's is core:egg_xs. The shell is one
// material in two colour regions: region 0, the ground, is the egg prop's `color`; region 1, the markings, is the
// second colour an instance carries, and shows the base colour's grey while it carries none. model.py makes the
// meshes and paint.py the pictures, from the shape in shape.py.

import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

const SIZES = ["xs", "s", "m", "l", "xl"];

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: SIZES.map((size) => ({ id: `core:egg_${size}`, object: `egg_${size}` })),
  materials: {
    shell: {
      base: "tex/shell_base.png",
      normal: "tex/shell_normal.png",
      packed: "tex/shell_packed.png",
      regions: { mask: "tex/shell_mask.png" },
      height: "tex/shell_height.png",
    },
  },
  flat: 2,
  budgets: { triangles: [1344, 448, 160, 56], texture: { top: 1024, megabytes: 15 } },
} satisfies PiecesAsset;
