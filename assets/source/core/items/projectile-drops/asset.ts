import { join } from "node:path";
import { shared, type MaterialSpec, type PiecesAsset } from "../../../../../tools/art/spec.ts";
import handTools from "../hand-tools/asset.ts";
import saddles from "../saddles-early/asset.ts";

const arrow = { around: 0.51, above: 1.2 };
const can = { around: 0.50, above: 0.65 };
const views = {
  arrow_stone: arrow, arrow_tranq: arrow, grenade_smoke: can, arrow_flame: arrow,
  grenade_poison: can, grappling_hook: { ...arrow, above: 0.85 }, dart_tranq: arrow,
  c4: { ...can, above: 0.86 }, arrow_metal: arrow,
};

const fromSaddles = (name: string): MaterialSpec =>
  shared(join(import.meta.dir, "../saddles-early"), `core:saddles-early/${name}`, saddles.materials[name]!);
const fromTools = (name: "steel" | "cloth", tiles: number): MaterialSpec =>
  ({ ...handTools.materials[name], dir: join(import.meta.dir, "../hand-tools"), tiles });
const own = (name: string): MaterialSpec => ({
  base: `tex/${name}_base.png`, normal: `tex/${name}_normal.png`,
  height: `tex/${name}_height.png`, packed: `tex/${name}_orm.png`, tiles: 0.18,
});

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([object, icon]) => ({ id: `core:${object}/dropped`, object, icon })),
  materials: {
    wood: fromSaddles("wood"), hide: fromSaddles("trail"), iron: fromSaddles("iron"), brass: fromSaddles("brass"),
    steel: fromTools("steel", 0.24), cloth: fromTools("cloth", 0.16),
    flint: { ...own("flint"), tops: { normal: 64 } },
    green: own("green"), orange: own("orange"),
  },
  budgets: { triangles: [1000, 520, 256, 128], texture: { top: 256, megabytes: 4.9 } },
} satisfies PiecesAsset;
