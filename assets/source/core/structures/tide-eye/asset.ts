import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "pieces",
  source: { scripts: ["model.py", "sextant.py", "lantern.py"] },
  pieces: [
    { id: "core:tide_eye/crown", object: "crown", errors: [0.28, 1.8], budget: [[0, 36000], [500, 12000], [2400, 2000]] },
    { id: "core:tide_eye/glow", object: "glow", errors: [0.12, 0.75] },
    { id: "core:tide_eye/crown_light", object: "glow_crown", errors: [0.2, 1.2] },
    { id: "core:tide_eye/iris", object: "iris", errors: [0.25, 1.1] },
    { id: "core:tide_eye/deck", object: "deck", errors: [0.09, 0.5], budget: [[0, 10000], [250, 3600], [1000, 600]] },
    { id: "core:tide_eye/deck_light", object: "glow_deck", errors: [0.05, 0.3] },
    { id: "core:travel_terminal", object: "console", errors: [0.006, 0.03] },
    { id: "core:tide_eye/sextant", object: "sextant", errors: [0.38, 1.86], budget: [[0, 36000], [500, 12000], [2400, 2000]] },
    { id: "core:tide_eye/needle", object: "needle", errors: [0.14, 0.8] },
    { id: "core:tide_eye/index_light", object: "glow_index", errors: [0.1, 0.6] },
    { id: "core:tide_eye/keel_light", object: "glow_keel", errors: [0.1, 0.6] },
    { id: "core:tide_eye/lantern", object: "lantern", errors: [0.36, 1.84], budget: [[0, 36000], [500, 12000], [2400, 2000]] },
    { id: "core:tide_eye/shutter", object: "shutter", errors: [0.15, 0.82] },
    { id: "core:tide_eye/shutter_light", object: "glow_shutter", errors: [0.10, 0.54] },
    { id: "core:tide_eye/well_light", object: "glow_well", errors: [0.09, 0.55] },
    { id: "core:tide_eye/mast_light", object: "glow_masts", errors: [0.2, 1.2] },
  ],
  // Two trim atlases (paint.py), each eight strips 32 m long: the instrument's own, which all three wear, and the
  // livery, which is the Sextant's fired enamel and the Lantern's copper.
  materials: {
    instrument: { base: "tex/base.png", normal: "tex/normal.png", packed: "tex/orm.png", height: "tex/height.png", regions: "tex/regions.png", tiles: 32 },
    livery: { base: "tex/livery-base.png", normal: "tex/livery-normal.png", packed: "tex/livery-orm.png", height: "tex/livery-height.png", tiles: 32 },
  },
  budgets: { triangles: [36000, 12000, 2000], texture: { top: 2048, megabytes: 64 } },
} satisfies PiecesAsset;
