import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

const views = {
  wood: { around: 0.82, above: 0.58 },
  thatch: { around: 0.38, above: 1.18 },
  fiber: { around: 0.51, above: 1.16 },
  hide: { around: 0.6, above: 1.20 },
  pelt: { around: -0.35, above: 1.04 },
  chitin: { around: 0.59, above: 0.89 },
  keratin: { around: 0.39, above: 1.02 },
  organic_polymer: { around: 0.7, above: 0.94 },
};

// Metres per repeat, as used by the metric charts in model.py.
const repeats = {
  bark: 0.36,
  end_grain: 0.20,
  straw: 0.20,
  bast: 0.20,
  hide: 0.20,
  fur: 0.40,
  chitin: 0.20,
  horn: 0.20,
  wax: 0.20,
};

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([object, icon]) => ({ id: `core:${object}/dropped`, object, icon })),
  materials: Object.fromEntries(Object.entries(repeats).map(([name, tiles]) => [name, {
    base: `tex/${name}_base.png`,
    normal: `tex/${name}_normal.png`,
    packed: `tex/${name}_orm.png`,
    tiles,
  }])),
  budgets: { triangles: [640, 300, 148, 80], texture: { top: 256, megabytes: 4 } },
} satisfies PiecesAsset;
