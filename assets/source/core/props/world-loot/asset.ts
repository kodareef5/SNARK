import { join } from "node:path";
import { shared, type MaterialSpec, type PiecesAsset } from "../../../../../tools/art/spec.ts";
import handTools from "../../items/hand-tools/asset.ts";
import instruments from "../../items/instruments/asset.ts";
import minerals from "../../items/resource-minerals/asset.ts";
import saddles from "../../items/saddles-early/asset.ts";
import supplies from "../../items/resource-supplies/asset.ts";
import camp from "../../structures/camp/asset.ts";

const local = (path: string): string => join(import.meta.dir, "../..", path);
const reuse = (asset: string, name: string, spec: MaterialSpec): MaterialSpec =>
  shared(local(`items/${asset}`), `core:${asset}/${name}`, spec);
const instrument = (name: "iron" | "rubber" | "bronze", tiles: number): MaterialSpec =>
  ({ ...instruments.materials[name], dir: local("items/instruments"), tiles });
const earth = (tint: readonly [number, number, number]): MaterialSpec => ({
  dir: local("structures/thatch"), base: "tex/earth/earth_base.png", normal: "tex/earth/earth_normal.png",
  height: "tex/earth/earth_height.png", packed: "tex/earth/earth_orm.png", tiles: 0.24, tint,
});
const limestone = (tint: readonly [number, number, number]): MaterialSpec => ({
  ...minerals.materials.stone!, dir: local("items/resource-minerals"), tiles: 0.21, tint,
});

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:bag", object: "bag", triangles: [288, 148, 80, 44] },
    { id: "core:cache", object: "cache", triangles: [1000, 500, 250, 125] },
    { id: "core:event_crate", object: "event_crate" },
    { id: "core:feces", object: "feces", triangles: [288, 144, 72, 36] },
    { id: "core:stone_shot", object: "stone_shot", triangles: [180, 88, 44, 22] },
  ],
  materials: {
    linen: shared(local("structures/camp"), "core:camp/linen", camp.materials.linen),
    cloth: { ...handTools.materials.cloth, dir: local("items/hand-tools"), tiles: 0.16 },
    rubber: reuse("resource-supplies", "rubber", supplies.materials.rubber!),
    iron: reuse("saddles-early", "iron", saddles.materials.iron!),
    crate_iron: instrument("iron", 0.16),
    crate_rubber: instrument("rubber", 0.16),
    crate_bronze: instrument("bronze", 0.28),
    dung: earth([0.41, 0.36, 0.30]),
    dung_fold: earth([0.72, 0.64, 0.47]),
    pebble: limestone([0.70, 0.66, 0.51]),
    pebble_seam: limestone([0.47, 0.50, 0.46]),
  },
  budgets: { triangles: [1250, 615, 295, 145], texture: { top: 256, megabytes: 4.9 } },
} satisfies PiecesAsset;
