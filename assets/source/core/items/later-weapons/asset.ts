import { join } from "node:path";
import { shared, type MaterialSpec, type PieceSpec, type PiecesAsset } from "../../../../../tools/art/spec.ts";
import handTools from "../hand-tools/asset.ts";

const long = { around: 0.50, above: 1.15 };
const compact = { around: 0.53, above: 0.87 };
const views = {
  scope: compact, silencer: compact, flashlight: compact, pistol_fabricated: { ...long, above: 1.1 },
  shotgun_pump: long, rifle_assault: long, laser: compact, bow_compound: { ...long, above: 1.25 }, rifle_sniper: long,
};
const held = new Set(["pistol_fabricated", "shotgun_pump", "rifle_assault", "bow_compound", "rifle_sniper"]);
const reused = ["wood", "brass", "iron", "rubber", "steel"] as const;
function borrowed(name: (typeof reused)[number]): MaterialSpec {
  const source: MaterialSpec = handTools.materials[name];
  return shared(source.dir ?? join(import.meta.dir, "../hand-tools"), source.id ?? `core:hand-tools/${name}`, source);
}
const swatch = (name: string): MaterialSpec => ({
  base: `tex/${name}_base.png`, normal: `tex/${name}_normal.png`,
  height: `tex/${name}_height.png`, packed: `tex/${name}_orm.png`, tiles: 0.10,
});

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([object, icon]): PieceSpec => held.has(object)
    ? { id: `core:${object}`, object, hold: "prop_r", dropped: "auto", icon }
    : { id: `core:${object}/dropped`, object, icon }),
  materials: {
    ...Object.fromEntries(reused.map(name => [name, borrowed(name)])),
    optic: { ...swatch("optic"), tops: { normal: 64 } }, polymer: swatch("polymer"),
  },
  budgets: { triangles: [2700, 1350, 645, 322], texture: { top: 256, megabytes: 4.9 } },
} satisfies PiecesAsset;
