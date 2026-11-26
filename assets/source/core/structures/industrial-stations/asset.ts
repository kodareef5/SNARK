import { join } from "node:path";
import { shared, type MaterialSpec, type PiecesAsset } from "../../../../../tools/art/spec.ts";
import later from "../../items/later-weapons/asset.ts";
import projectiles from "../../items/projectile-drops/asset.ts";

const front = { around: Math.PI - 0.59, above: 0.47, roll: 0 };
const taller = { ...front, above: 0.37 };
const views = {
  generator: front, refrigerator: taller, air_conditioner: front, grinder: front, vault: taller,
  forge_industrial: taller, chemistry_bench: { ...front, above: 0.55 },
  soul_vault: taller, soul_vault_lit: taller, cooker_industrial: front,
};

const own = (name: string, tiles: number): MaterialSpec => ({
  base: `tex/${name}_base.png`, normal: `tex/${name}_normal.png`,
  height: `tex/${name}_height.png`, packed: `tex/${name}_orm.png`, tiles,
});
const enamel: MaterialSpec = { ...own("enamel", 0.38), tops: { normal: 128 } };
const inherited = (name: "iron" | "steel" | "brass"): MaterialSpec => {
  const source: MaterialSpec = projectiles.materials[name];
  return shared(source.dir ?? join(import.meta.dir, "../../items/projectile-drops"), source.id ?? `core:projectile-drops/${name}`, source);
};

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([object, icon]) => ({ id: `core:${object}`, object, icon })),
  materials: {
    steel: inherited("steel"), iron: inherited("iron"), brass: inherited("brass"),
    enamel, cream: { ...enamel, base: "tex/cream_base.png" },
    polymer: { ...later.materials.polymer, dir: join(import.meta.dir, "../../items/later-weapons"), tiles: 0.16 },
    glass: { ...own("glass", 0.18), tops: { normal: 64 } },
    status: { ...own("status", 0.18), emissive: 1.4, indicator: true, tops: { normal: 64 } },
  },
  budgets: { triangles: [3800, 1900, 900, 440], texture: { top: 256, megabytes: 4.9 } },
} satisfies PiecesAsset;
