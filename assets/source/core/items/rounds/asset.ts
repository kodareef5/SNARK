import { join } from "node:path";
import { shared, type MaterialSpec, type PiecesAsset } from "../../../../../tools/art/spec.ts";
import projectiles from "../projectile-drops/asset.ts";

const cartridge = { around: 0.35, above: 1.05 };
const views = {
  round_pistol: cartridge, round_rifle: cartridge, round_shotgun: cartridge,
  round_advanced: cartridge, round_advanced_rifle: cartridge, round_advanced_sniper: cartridge,
  rocket: { around: 0.49, above: 0.90 },
};

const surfaces = ["brass", "iron", "steel", "green", "orange"] as const;
function material(name: (typeof surfaces)[number]): MaterialSpec {
  const source: MaterialSpec = projectiles.materials[name];
  return shared(source.dir ?? join(import.meta.dir, "../projectile-drops"), source.id ?? `core:projectile-drops/${name}`, source);
}

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.entries(views).map(([object, icon]) => ({ id: `core:${object}/dropped`, object, icon })),
  materials: Object.fromEntries(surfaces.map(name => [name, material(name)])),
  budgets: { triangles: [960, 480, 228, 108], texture: { top: 256, megabytes: 4.9 } },
} satisfies PiecesAsset;
