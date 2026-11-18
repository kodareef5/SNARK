import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "pieces",
  source: { scripts: ["model.py", "sextant.py"] },
  pieces: [
    { id: "core:tide_eye/crown", object: "crown", errors: [0.28, 1.8], budget: [[0, 18000], [500, 6500], [2400, 1500]] },
    { id: "core:tide_eye/glow", object: "glow", errors: [0.12, 0.75] },
    { id: "core:tide_eye/iris", object: "iris", errors: [0.25, 1.1] },
    { id: "core:tide_eye/deck", object: "deck", errors: [0.09, 0.5], budget: [[0, 10000], [250, 3600], [1000, 600]] },
    { id: "core:travel_terminal", object: "console", errors: [0.006, 0.03] },
    { id: "core:tide_eye/sextant", object: "sextant", errors: [0.38, 1.86], budget: [[0, 20000], [500, 8500], [2400, 1500]] },
    { id: "core:tide_eye/needle", object: "needle", errors: [0.14, 0.8] },
    { id: "core:tide_eye/index_light", object: "glow_index", errors: [0.1, 0.6] },
    { id: "core:tide_eye/keel_light", object: "glow_keel", errors: [0.1, 0.6] },
  ],
  materials: {
    instrument: { base: "tex/base.png", normal: "tex/normal.png", packed: "tex/orm.png", height: "tex/height.png", regions: "tex/regions.png", tiles: 8 },
    enamel: { base: "tex/sextant-base.png", normal: "tex/normal.png", packed: "tex/sextant-orm.png", height: "tex/height.png", tiles: 8 },
  },
  budgets: { triangles: [20000, 8500, 1500], texture: { top: 1024, megabytes: 28 } },
} satisfies PiecesAsset;
