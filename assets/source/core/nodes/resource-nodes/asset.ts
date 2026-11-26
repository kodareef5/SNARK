import { join } from "node:path";
import { shared, type MaterialSpec, type PiecesAsset } from "../../../../../tools/art/spec.ts";
import minerals from "../../items/resource-minerals/asset.ts";

const source = join(import.meta.dir, "../../items/resource-minerals");
const kinds = ["oil_rock", "crystal_rock", "obsidian_rock", "clam"];
const variants = kinds.flatMap(kind => [1, 2].flatMap(variant => [`${kind}_${variant}`, `${kind}_${variant}_depleted`]));
const surface = (name: string, tiles: number, tint: readonly [number, number, number]): MaterialSpec =>
  ({ ...minerals.materials[name]!, dir: source, tiles, tint });

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: variants.map(object => ({
    id: `core:${object}`, object,
    ...(object.startsWith("clam") ? { triangles: [1000, 485, 230, 110] } : {}),
  })),
  materials: {
    bitumen: surface("stone", .20, [.075, .086, .092]),
    rock_dark: surface("stone", .21, [.28, .31, .29]),
    obsidian: { ...surface("obsidian", .20, [.94, .94, .90]), tops: { normal: 64 } },
    quartz: { ...surface("crystal", .18, [1, 1, 1]), tops: { normal: 64 } },
    crystal_host: shared(source, "core:resource-minerals/stone", minerals.materials.stone!),
    clam_shell: surface("stone", .18, [.78, .59, .45]),
    clam_lip: { ...surface("silica_pearls", .18, [.82, .64, .58]), tops: { normal: 64 } },
    pearl: { ...surface("silica_pearls", .18, [1, 1, 1]), tops: { normal: 64 } },
  },
  budgets: { triangles: [1600, 780, 380, 180], texture: { top: 256, megabytes: 4.9 } },
} satisfies PiecesAsset;
