// The compact abandoned in a ruined street: rigid pieces a map sets down as statics (content/vehicles/wrecks.ts).
// abandoned.py poses them from ../compact's own model, on its layout; ../compact/tex/paint.py paints their pictures beside
// the car's, and the normal and height maps are the car's own. `bun run art -- core:compact_abandoned` builds it.

import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

const weathered = (name: string, extra: Partial<MaterialSpec> = {}): MaterialSpec => ({
  base: `tex/${name}_base.png`,
  normal: `../compact/tex/${name}_normal.png`,
  packed: `tex/${name}_packed.png`,
  regions: { mask: `tex/${name}_mask.png` },
  height: `../compact/tex/${name}_height.png`,
  ...extra,
});

export default {
  kind: "pieces",
  source: { scripts: ["abandoned.py"] },
  pieces: [
    { id: "core:compact_abandoned", object: "compact_abandoned" },
    { id: "core:compact_abandoned_stripped", object: "compact_abandoned_stripped" },
    { id: "core:compact_abandoned_roof", object: "compact_abandoned_roof" },
  ],
  // The paint is region 0, the static's colour, as the car's is the species' (compact.ts).
  materials: {
    body: weathered("body"),
    trim: weathered("trim"),
    cabin: weathered("cabin", { cutout: true }),
  },
  // A street holds many: the finest level is made from the model to the first budget, and only it has its materials.
  flat: 1,
  budgets: {
    triangles: [6000, 2400, 960, 400],
    texture: { top: 2048, megabytes: 80 },
  },
} satisfies PiecesAsset;
