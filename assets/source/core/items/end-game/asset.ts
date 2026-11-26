import { join } from "node:path";
import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";
import industrial from "../../structures/industrial-stations/asset.ts";
import tools from "../hand-tools/asset.ts";
import instruments from "../instruments/asset.ts";
import weapons from "../later-weapons/asset.ts";
import saddles from "../saddles-early/asset.ts";
import supplies from "../resource-supplies/asset.ts";

const drop = { around: .52, above: .92 };
const ammoTriangles = [1040, 510, 245, 115];
const jet = ["jet_cannon", "jet_missile_rack", "cannon_round"];
const tile = (asset: string, source: MaterialSpec, tiles: number): MaterialSpec =>
  ({ ...source, dir: join(import.meta.dir, asset), tiles });

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:prod", object: "prod", hold: "prop_r", dropped: "auto", icon: { around: .56, above: 1.14 } },
    ...["plasma_charge", "plasma_cell", "dart_shock"].map(object => ({ id: `core:${object}/dropped`, object, icon: drop, triangles: ammoTriangles })),
  ],
  iconImages: Object.fromEntries(jet.map(item => [`core:${item}/icon`, `icons/${item}.png`])),
  iconMeshes: { "core:jet_missile/icon": "core:rocket_round" },
  materials: {
    steel: tile("../hand-tools", tools.materials.steel, .18),
    rubber: tile("../resource-supplies", supplies.materials.rubber!, .12),
    iron: tile("../saddles-early", saddles.materials.iron!, .12),
    amber: tile("../instruments", instruments.materials.amber, .12),
    optic: { ...tile("../later-weapons", weapons.materials.optic, .12), emissive: .48 },
    ceramic: tile("../../structures/industrial-stations", industrial.materials.cream, .18),
  },
  budgets: { triangles: [1500, 750, 365, 177], texture: { top: 256, megabytes: 4.9 } },
} satisfies PiecesAsset;
