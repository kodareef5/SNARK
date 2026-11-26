import { join } from "node:path";
import { shared, type MaterialSpec, type PieceSpec, type PiecesAsset } from "../../../../../tools/art/spec.ts";
import camp from "../../structures/camp/asset.ts";
import handTools from "../hand-tools/asset.ts";
import instruments from "../instruments/asset.ts";
import minerals from "../resource-minerals/asset.ts";
import saddles from "../saddles-early/asset.ts";
import heavySaddles from "../saddles-heavy/asset.ts";
import supplies from "../resource-supplies/asset.ts";

const portables = ["zzzzzskateboard_assembly", "boat_assembly", "helicopter_assembly"];
const skate = ["zzzzzzskate_kicker", "zzzzzzskate_rail", "zzzzzzskate_ledge"];
const kitView = { around: .53, above: .84 };
const pieces: PieceSpec[] = [
  ...portables.map(object => ({ id: `core:${object}/dropped`, object, icon: kitView })),
  ...skate.map(object => ({ id: `core:${object}`, object, icon: { around: .58, above: .66 }, triangles: [1400, 700, 340, 165] })),
  { id: "core:bunk_bed", object: "bunk_bed", icon: { around: 2.50, above: .48 }, triangles: [2600, 1280, 620, 290] },
];

const from = (asset: string, name: string, material: MaterialSpec): MaterialSpec =>
  shared(join(import.meta.dir, "..", asset), `core:${asset}/${name}`, material);
const adjusted = (asset: string, material: MaterialSpec, tiles: number): MaterialSpec =>
  ({ ...material, dir: join(import.meta.dir, "..", asset), tiles });

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces,
  materials: {
    wood: from("saddles-early", "wood", saddles.materials.wood!),
    iron: from("saddles-early", "iron", saddles.materials.iron!),
    rubber: from("resource-supplies", "rubber", supplies.materials.rubber!),
    stone: from("resource-minerals", "stone", minerals.materials.stone!),
    hide: from("saddles-heavy", "leather", heavySaddles.materials.leather!),
    linen: shared(join(import.meta.dir, "../../structures/camp"), "core:camp/linen", camp.materials.linen),
    steel: adjusted("hand-tools", handTools.materials.steel, .26),
    bronze: adjusted("instruments", instruments.materials.bronze, .26),
  },
  budgets: { triangles: [1400, 680, 320, 152], texture: { top: 256, megabytes: 4.9 } },
} satisfies PiecesAsset;
