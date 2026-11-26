import { join } from "node:path";
import { shared, type MaterialSpec, type PiecesAsset } from "../../../../../tools/art/spec.ts";
import handTools from "../../items/hand-tools/asset.ts";
import minerals from "../../items/resource-minerals/asset.ts";
import earlySaddles from "../../items/saddles-early/asset.ts";
import heavySaddles from "../../items/saddles-heavy/asset.ts";

const mineralSurfaces: Readonly<Record<string, MaterialSpec>> = minerals.materials;
const front = { around: Math.PI - 0.58, above: 0.48, roll: 0 };
const above = { ...front, above: 0.97 };
const views = {
  campfire: above, campfire_lit: above,
  storage_box: front, sleeping_bag: above, bed: { ...front, above: 0.71 },
  standing_torch: front, standing_torch_lit: front,
  cooking_pot: { ...front, above: 0.62 }, cooking_pot_lit: { ...front, above: 0.62 },
  storage_large: front, fireplace: front, fireplace_lit: front,
};

function fromItem(asset: string, name: string, spec: MaterialSpec): MaterialSpec {
  return shared(join(import.meta.dir, `../../items/${asset}`), `core:${asset}/${name}`, spec);
}

const own = (name: string, tiles: number): MaterialSpec => ({
  base: `tex/${name}_base.png`, normal: `tex/${name}_normal.png`,
  height: `tex/${name}_height.png`, packed: `tex/${name}_orm.png`, tiles,
});

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([object, icon]) => ({ id: `core:${object}`, object, icon })),
  materials: {
    wood: fromItem("saddles-early", "wood", earlySaddles.materials.wood!),
    hide: fromItem("saddles-heavy", "leather", heavySaddles.materials.leather!),
    iron: fromItem("saddles-early", "iron", earlySaddles.materials.iron!),
    stone: fromItem("resource-minerals", "stone", mineralSurfaces.stone!),
    coal: { ...handTools.materials.char, dir: join(import.meta.dir, "../../items/hand-tools"), tiles: 0.16 },
    linen: { ...own("linen", 0.36), tops: { normal: 128 } },
    ember: { ...own("ember", 0.18), emissive: 1.25 },
  },
  budgets: { triangles: [3000, 1500, 735, 360], texture: { top: 256, megabytes: 4.9 } },
} satisfies PiecesAsset;
