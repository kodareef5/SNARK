import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

const views = {
  saddle_stego: { around: 0.59, above: 0.50, roll: 0.17 },
  saddle_rex: { around: -2.32, above: 0.69, roll: -0.16 },
  saddle_spino: { around: -0.94, above: 0.72, roll: -0.29 },
  saddle_brachio: { around: 0.95, above: 0.40, roll: 0.05 },
};

const materials = Object.fromEntries(["leather", "canvas", "ash", "metal"].map((name) => [name, {
  base: `tex/${name}_base.png`,
  normal: `tex/${name}_normal.png`,
  packed: `tex/${name}_orm.png`,
  height: `tex/${name}_height.png`,
  tiles: 0.16,
} satisfies MaterialSpec]));

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([object, icon]) => ({ id: `core:${object}/dropped`, object, icon })),
  materials,
  budgets: { triangles: [4800, 2150, 800], texture: { top: 128, megabytes: 1 } },
} satisfies PiecesAsset;
