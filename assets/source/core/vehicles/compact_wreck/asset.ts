// The compact's wrecks: rigid pieces a map sets in its streets as statics (a structure/static whose mesh names one).
// wreck.py builds them from ../compact's own model, on its layout, so their pictures are the car's at its last stage:
// ../compact/tex/paint.py paints them beside the car's. The normal and height maps are the car's own.
// `bun run art -- core:compact_wreck` builds it.

import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

const burnt = (name: string, extra: Partial<MaterialSpec> = {}): MaterialSpec => ({
  base: `tex/${name}_base.png`,
  normal: `../compact/tex/${name}_normal.png`,
  packed: `tex/${name}_packed.png`,
  regions: { mask: `tex/${name}_mask.png` },
  height: `../compact/tex/${name}_height.png`,
  ...extra,
});

export default {
  kind: "pieces",
  source: { scripts: ["wreck.py"] },
  pieces: [
    { id: "core:compact_wreck", object: "compact_wreck" },
    { id: "core:compact_wreck_tipped", object: "compact_wreck_tipped" },
  ],
  // What paint is left is region 0, the static's colour. The glass is broken out of its frames.
  materials: {
    body: burnt("body"),
    trim: burnt("trim"),
    cabin: burnt("cabin", { cutout: true }),
  },
  // A street holds many: the finest level is made from the model to the first budget, and only it has its materials.
  flat: 1,
  budgets: {
    triangles: [6000, 2400, 960, 440],
    texture: { top: 2048, megabytes: 80 },
  },
} satisfies PiecesAsset;
