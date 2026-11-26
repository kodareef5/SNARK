import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

const views = {
  saddle_parasaur: { around: 0.86, above: 0.89, roll: -0.08 },
  saddle_pteranodon: { around: 0.46, above: 1.08, roll: 0.18 },
  saddle_raptor: { around: 2.72, above: 0.98, roll: 0.24 },
  saddle_trike: { around: 0.80, above: 0.74 },
  saddle_carbonemys: { around: 0.59, above: 0.91, roll: -0.07 },
};

const sewn = ["trail", "russet", "oxblood", "chestnut", "trail_weave", "olive", "rawhide"];
const rigid = ["wood", "dark_wood", "iron", "brass", "chitin"];
const materials = Object.fromEntries([...sewn, ...rigid].map((name) => [name, {
  base: `tex/${name}_base.png`,
  normal: `tex/${name}_normal.png`,
  packed: `tex/${name}_orm.png`,
  height: `tex/${name}_height.png`,
  tiles: sewn.includes(name) ? 0.36 : 0.16,
} satisfies MaterialSpec]));

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([object, icon]) => ({ id: `core:${object}/dropped`, object, icon })),
  materials,
  budgets: { triangles: [4000, 2500, 1000, 500], texture: { top: 256, megabytes: 3 } },
} satisfies PiecesAsset;
