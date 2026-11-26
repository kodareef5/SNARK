import { join } from "node:path";
import { shared, type PiecesAsset } from "../../../../../tools/art/spec.ts";
import worldLoot from "../../props/world-loot/asset.ts";

const source = join(import.meta.dir, "../../props/world-loot");
const ground = { around: 0.59, above: 1.12 };
const names = ["feces_small", "feces_medium", "feces_large", "feces_massive"];

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: names.map(object => ({ id: `core:${object}/dropped`, object, icon: ground })),
  materials: {
    dung: shared(worldLoot.materials.dung.dir ?? source, "core:world-loot/dung", worldLoot.materials.dung),
    dung_fold: shared(worldLoot.materials.dung_fold.dir ?? source, "core:world-loot/dung_fold", worldLoot.materials.dung_fold),
  },
  budgets: { triangles: [880, 440, 220, 110], texture: { top: 256, megabytes: 4.9 } },
} satisfies PiecesAsset;
