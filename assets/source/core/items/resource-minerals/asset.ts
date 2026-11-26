import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

const views = {
  stone: { around: 0.55, above: 0.65 },
  flint: { around: 0.46, above: 0.98 },
  crystal: { around: 0.48, above: 0.28 },
  obsidian: { around: 0.80, above: 0.52 },
  ore: { around: 0.60, above: 0.62 },
  ingot: { around: 0.52, above: 0.64 },
  silica_pearls: { around: 0.22, above: 0.94 },
  charcoal: { around: 0.70, above: 0.84 },
};

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([name, icon]) => ({
    id: `core:${name}/dropped`,
    object: name,
    icon,
  })),
  materials: Object.fromEntries(Object.keys(views).map((name) => [name, {
    base: `tex/${name}_base.png`,
    normal: `tex/${name}_normal.png`,
    packed: `tex/${name}_orm.png`,
  }])),
  budgets: { triangles: [640, 340, 144], texture: { top: 128, megabytes: 2 } },
} satisfies PiecesAsset;
