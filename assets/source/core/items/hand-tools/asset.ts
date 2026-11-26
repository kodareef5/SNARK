import { join } from "node:path";
import { shared, type MaterialSpec, type PiecesAsset } from "../../../../../tools/art/spec.ts";
import instruments from "../instruments/asset.ts";

const views = {
  torch: { around: 0.52, above: 1.19 },
  slingshot: { around: 0.35, above: 1.21 },
  club: { around: 0.53, above: 1.16 },
  hatchet_metal: { around: 0.52, above: 1.21 },
  pick_metal: { around: 0.49, above: 1.23 },
  pike: { around: 0.43, above: 1.24, zoom: 2.2, shift: [0.56, 0.56] as const },
  sickle: { around: 0.46, above: 1.20 },
  sword: { around: 0.49, above: 1.25 },
};

const instrument = (name: "wood" | "hide" | "iron" | "bronze" | "rubber"): MaterialSpec =>
  shared(join(import.meta.dir, "../instruments"), `core:instruments/${name}`, instruments.materials[name]);
const swatch = (name: string, tiles: number): MaterialSpec => ({
  base: `tex/${name}_base.png`,
  normal: `tex/${name}_normal.png`,
  height: `tex/${name}_height.png`,
  packed: `tex/${name}_orm.png`,
  tiles,
});

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([object, icon]) => ({ id: `core:${object}`, object, hold: "prop_r", dropped: "auto", icon })),
  materials: {
    wood: instrument("wood"), hide: instrument("hide"), iron: instrument("iron"),
    brass: instrument("bronze"), rubber: instrument("rubber"),
    steel: swatch("steel", 0.16), cloth: swatch("cloth", 0.10), char: swatch("char", 0.10),
  },
  budgets: { triangles: [1500, 750, 360, 176], texture: { top: 256, megabytes: 4.9 } },
} satisfies PiecesAsset;
