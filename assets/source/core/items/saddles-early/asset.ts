import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

const views = {
  saddle_parasaur: { around: 0.86, above: 0.89, roll: -0.08 },
  saddle_pteranodon: { around: 0.46, above: 1.08, roll: 0.18 },
  saddle_raptor: { around: 2.72, above: 0.98, roll: 0.24 },
  saddle_trike: { around: 0.80, above: 0.74 },
  saddle_carbonemys: { around: 0.59, above: 0.91, roll: -0.07 },
};

const swatches = [
  { relief: "leather", tiles: 0.22, colors: ["trail", "russet", "oxblood", "chestnut"] },
  { relief: "weave", tiles: 0.36, colors: ["trail_weave", "olive"] },
  { relief: "suede", tiles: 0.36, colors: ["rawhide"], tops: { normal: 128 } },
  { relief: "wood", tiles: 0.16, colors: ["wood", "dark_wood"] },
  { relief: "iron", tiles: 0.16, colors: ["iron"] },
  { relief: "brass", tiles: 0.16, colors: ["brass"] },
  { relief: "chitin", tiles: 0.16, colors: ["chitin"] },
];

const materials = Object.fromEntries(swatches.flatMap(({ relief, tiles, colors, tops }) => colors.map((name) => [name, {
  base: `tex/${name}_base.png`,
  normal: `tex/${relief}_normal.png`,
  packed: `tex/${relief}_orm.png`,
  height: `tex/${relief}_height.png`,
  tiles,
  tops,
} satisfies MaterialSpec])));

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([object, icon]) => ({ id: `core:${object}/dropped`, object, icon })),
  materials,
  budgets: { triangles: [4000, 2500, 1000, 500], texture: { top: 256, megabytes: 3 } },
} satisfies PiecesAsset;
