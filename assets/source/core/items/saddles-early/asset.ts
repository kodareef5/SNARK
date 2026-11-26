import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

const views = {
  saddle_parasaur: { around: 0.86, above: 0.89, roll: -0.08 },
  saddle_pteranodon: { around: 0.46, above: 1.08, roll: 0.18 },
  saddle_raptor: { around: 2.72, above: 0.98, roll: 0.24 },
  saddle_trike: { around: 0.80, above: 0.74 },
  saddle_carbonemys: { around: 0.59, above: 0.91, roll: -0.07 },
};

const atlases = ["tack_hide", "tack_pad", "tack_fittings"] as const;

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([object, icon]) => ({ id: `core:${object}/dropped`, object, icon })),
  materials: Object.fromEntries(atlases.map((atlas) => [atlas, {
    base: `tex/${atlas}_base.png`,
    normal: `tex/${atlas}_normal.png`,
    packed: `tex/${atlas}_orm.png`,
    height: `tex/${atlas}_height.png`,
    tiles: 3.45,
    tops: { packed: 1024 },
  } satisfies MaterialSpec])),
  budgets: { triangles: [8500, 3000, 1250, 550], texture: { top: 2048, megabytes: 40 } },
} satisfies PiecesAsset;
