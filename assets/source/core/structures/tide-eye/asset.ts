import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:tide_eye/crown", object: "crown", errors: [0.28, 1.8], budget: [[0, 18000], [500, 6500], [2400, 1500]] },
    { id: "core:tide_eye/glow", object: "glow", errors: [0.12, 0.75] },
    { id: "core:tide_eye/iris", object: "iris", errors: [0.25, 1.1] },
    { id: "core:tide_eye/deck", object: "deck", errors: [0.09, 0.5], budget: [[0, 10000], [250, 3600], [1000, 600]] },
    { id: "core:travel_terminal", object: "console", errors: [0.006, 0.03] },
  ],
  materials: { instrument: { base: "tex/base.png", normal: "tex/normal.png", packed: "tex/orm.png", height: "tex/height.png", regions: "tex/regions.png", tiles: 8 } },
  budgets: { triangles: [20000, 8500, 1500], texture: { top: 1024, megabytes: 20 } },
} satisfies PiecesAsset;
